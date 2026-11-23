// Employee-facing endpoints used by the mobile app.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings } = require('../db');
const { requireAuth } = require('../auth');
const { localDate, haversineM, toBool, monthDays } = require('../util');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPhotoBytes, files: 1 },
});

router.use(requireAuth('employee'));

function todayRecords(userId) {
  return db
    .prepare('SELECT id, type, ts, distance_m, site_id FROM attendance WHERE user_id = ? AND local_date = ? ORDER BY ts')
    .all(userId, localDate());
}

router.get('/me', (req, res) => {
  const u = req.user;
  const site = u.site_id ? db.prepare('SELECT id, name, lat, lng, radius_m FROM sites WHERE id = ?').get(u.site_id) : null;
  const s = getSettings();
  const today = todayRecords(u.id);
  res.json({
    user: { id: u.id, emp_code: u.emp_code, name: u.name },
    site,
    company_name: s.company_name,
    work_start: s.work_start,
    work_end: s.work_end,
    today,
    checked_in: today.length > 0 && today[today.length - 1].type === 'in',
  });
});

router.get('/history', (req, res) => {
  const m = monthDays(req.query.month || localDate().slice(0, 7));
  if (!m) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const rows = db
    .prepare(
      `SELECT a.id, a.type, a.ts, a.local_date, a.distance_m, s.name AS site_name
         FROM attendance a LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.user_id = ? AND a.local_date BETWEEN ? AND ?
        ORDER BY a.ts DESC`
    )
    .all(req.user.id, m.days[0], m.days[m.days.length - 1]);
  res.json({ records: rows });
});

function reject(req, res, status, code, reason, extra = {}) {
  db.prepare(
    'INSERT INTO rejected_attempts (user_id, ts, reason, code, lat, lng, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    new Date().toISOString(),
    reason,
    code,
    Number.isFinite(extra.lat) ? extra.lat : null,
    Number.isFinite(extra.lng) ? extra.lng : null,
    JSON.stringify({ ...extra.details, ua: req.get('user-agent') || null })
  );
  return res.status(status).json({ error: reason, code });
}

// POST /api/attendance  (multipart/form-data)
//   type=in|out, lat, lng, accuracy, is_mocked, dev_mode, rooted,
//   capture_age_sec, app_version, photo=<jpeg>
router.post('/', upload.single('photo'), (req, res) => {
  const b = req.body || {};
  const type = b.type;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const accuracy = Number(b.accuracy);
  const details = {
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    is_mocked: toBool(b.is_mocked),
    dev_mode: toBool(b.dev_mode),
    rooted: toBool(b.rooted),
    app_version: b.app_version || null,
  };

  if (type !== 'in' && type !== 'out') return res.status(400).json({ error: 'type must be "in" or "out"' });

  // 1. Device integrity — reported by the app and logged for admins, even
  //    when the app couldn't get a location fix.
  if (details.dev_mode) {
    return reject(req, res, 403, 'DEV_MODE', 'Developer options are turned on. Turn them off and try again.', { lat, lng, details });
  }
  if (details.is_mocked) {
    return reject(req, res, 403, 'MOCK_LOCATION', 'A fake-GPS / mock location was detected. Punch blocked.', { lat, lng, details });
  }
  if (details.rooted) {
    return reject(req, res, 403, 'ROOTED', 'This phone is rooted or jailbroken and cannot be used for attendance.', { lat, lng, details });
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Location is missing' });
  }

  // 2. Selfie must be present, a real JPEG, and freshly taken.
  const photo = req.file;
  if (!photo || photo.buffer.length < 1024 || photo.buffer[0] !== 0xff || photo.buffer[1] !== 0xd8) {
    return res.status(400).json({ error: 'A selfie taken with the in-app camera is required' });
  }
  const age = Number(b.capture_age_sec);
  if (!Number.isFinite(age) || age < 0 || age > config.maxCaptureAgeSec) {
    return reject(req, res, 400, 'STALE', 'The selfie is too old. Please take a new one.', { lat, lng, details: { ...details, age } });
  }

  // 3. GPS quality and geofence.
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > config.maxGpsAccuracyM) {
    return reject(
      req, res, 400, 'LOW_ACCURACY',
      `GPS signal is too weak (±${Number.isFinite(accuracy) ? Math.round(accuracy) : '?'} m). Move near a window or outside and try again.`,
      { lat, lng, details }
    );
  }

  const sites = req.user.site_id
    ? db.prepare('SELECT * FROM sites WHERE id = ?').all(req.user.site_id)
    : db.prepare('SELECT * FROM sites').all();
  if (sites.length === 0) {
    return res.status(400).json({ error: 'No work location is set up yet. Contact your admin.' });
  }
  let best = null;
  for (const s of sites) {
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (!best || d < best.d) best = { site: s, d };
  }
  if (best.d > best.site.radius_m) {
    return reject(
      req, res, 403, 'OUT_OF_RANGE',
      `You are ${Math.round(best.d)} m from ${best.site.name}. You must be within ${Math.round(best.site.radius_m)} m.`,
      { lat, lng, details: { ...details, site_id: best.site.id, distance_m: Math.round(best.d) } }
    );
  }

  // 4. Sequence: can't check in twice or check out without checking in.
  const today = todayRecords(req.user.id);
  const last = today[today.length - 1];
  if (type === 'in' && last && last.type === 'in') return res.status(409).json({ error: 'You are already checked in' });
  if (type === 'out' && (!last || last.type === 'out')) return res.status(409).json({ error: 'You are not checked in' });

  // 5. Save.
  const now = new Date();
  const date = localDate(now);
  const rel = path.join(String(req.user.id), date.slice(0, 7), `${date}_${now.getTime()}_${type}.jpg`);
  const abs = path.join(config.photoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, photo.buffer);

  const info = db
    .prepare(
      `INSERT INTO attendance (user_id, type, ts, local_date, lat, lng, accuracy_m, distance_m, site_id, photo, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, type, now.toISOString(), date, lat, lng, accuracy, Math.round(best.d), best.site.id, rel, req.user.device_id);

  res.status(201).json({
    id: info.lastInsertRowid,
    type,
    ts: now.toISOString(),
    site: best.site.name,
    distance_m: Math.round(best.d),
  });
});

// Multer errors (e.g. photo too large) -> JSON
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
  next(err);
});

module.exports = router;
