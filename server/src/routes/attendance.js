// Employee-facing endpoints used by the mobile app.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings } = require('../db');
const { requireAuth } = require('../auth');
const { t, en } = require('../i18n');
const { clientIp, ipMatches } = require('../network');
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
  // Office Wi-Fi status, so the page can warn before the selfie is taken:
  // 'ok' = on an office network, 'off' = must be but isn't, null = not required.
  const mySites = u.site_id
    ? db.prepare('SELECT office_ips FROM sites WHERE id = ?').all(u.site_id)
    : db.prepare('SELECT office_ips FROM sites').all();
  const ip = clientIp(req);
  let officeNetwork = null;
  if (mySites.some((s) => s.office_ips && ipMatches(s.office_ips, ip))) officeNetwork = 'ok';
  else if (mySites.length && mySites.every((s) => s.office_ips)) officeNetwork = 'off';
  const s = getSettings();
  const today = todayRecords(u.id);
  res.json({
    user: { id: u.id, emp_code: u.emp_code, name: u.name },
    site,
    office_network: officeNetwork,
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

// Logs the blocked attempt for admins (in English) and answers the app in
// the employee's language. `code` is also the i18n message key.
function reject(req, res, status, code, params, extra = {}) {
  db.prepare(
    'INSERT INTO rejected_attempts (user_id, ts, reason, code, lat, lng, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    new Date().toISOString(),
    en(code, params),
    code,
    Number.isFinite(extra.lat) ? extra.lat : null,
    Number.isFinite(extra.lng) ? extra.lng : null,
    JSON.stringify({ ...extra.details, ua: req.get('user-agent') || null })
  );
  return res.status(status).json({ error: t(req, code, params), code });
}

// Indoor GPS in a browser can be imprecise. When office Wi-Fi already proves
// the employee is at the office, accept fixes up to this vague.
const MAX_ACCURACY_ON_OFFICE_NETWORK_M = 1000;

// POST /api/attendance  (multipart/form-data)
//   type=in|out, lat, lng, accuracy, is_mocked, dev_mode, rooted,
//   capture_age_sec, app_version, source=app|web, photo=<jpeg>
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
    source: b.source === 'web' ? 'web' : 'app',
    ip: clientIp(req),
  };

  if (type !== 'in' && type !== 'out') return res.status(400).json({ error: 'type must be "in" or "out"' });

  // 1. Device integrity — reported by the app and logged for admins, even
  //    when the app couldn't get a location fix.
  if (details.dev_mode) {
    return reject(req, res, 403, 'DEV_MODE', {}, { lat, lng, details });
  }
  if (details.is_mocked) {
    return reject(req, res, 403, 'MOCK_LOCATION', {}, { lat, lng, details });
  }
  if (details.rooted) {
    return reject(req, res, 403, 'ROOTED', {}, { lat, lng, details });
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: t(req, 'LOCATION_MISSING') });
  }

  // 2. Selfie must be present, a real JPEG, and freshly taken.
  const photo = req.file;
  if (!photo || photo.buffer.length < 1024 || photo.buffer[0] !== 0xff || photo.buffer[1] !== 0xd8) {
    return res.status(400).json({ error: t(req, 'SELFIE_REQUIRED') });
  }
  const age = Number(b.capture_age_sec);
  if (!Number.isFinite(age) || age < 0 || age > config.maxCaptureAgeSec) {
    return reject(req, res, 400, 'STALE', {}, { lat, lng, details: { ...details, age } });
  }

  // 3. Office Wi-Fi. A location with office network addresses only accepts
  //    check-ins from those networks — from the web page or the app alike, so
  //    nobody can skip the check by claiming to be a different client.
  let sites = req.user.site_id
    ? db.prepare('SELECT * FROM sites WHERE id = ?').all(req.user.site_id)
    : db.prepare('SELECT * FROM sites').all();
  if (sites.length === 0) {
    return res.status(400).json({ error: t(req, 'NO_SITES') });
  }
  const onNetwork = sites.filter((s) => s.office_ips && ipMatches(s.office_ips, details.ip));
  const viaNetwork = onNetwork.length > 0;
  if (viaNetwork) {
    sites = onNetwork;
  } else {
    const gpsOnly = sites.filter((s) => !s.office_ips);
    if (gpsOnly.length === 0) {
      return reject(req, res, 403, 'NOT_OFFICE_NETWORK', {}, { lat, lng, details });
    }
    sites = gpsOnly;
  }

  // 4. GPS quality and geofence. On office Wi-Fi the check is lenient: the
  //    fix only needs to plausibly overlap the site.
  const maxAccuracy = viaNetwork ? MAX_ACCURACY_ON_OFFICE_NETWORK_M : config.maxGpsAccuracyM;
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maxAccuracy) {
    return reject(
      req, res, 400, 'LOW_ACCURACY',
      { acc: Number.isFinite(accuracy) ? Math.round(accuracy) : '?' },
      { lat, lng, details }
    );
  }
  let best = null;
  for (const s of sites) {
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (!best || d < best.d) best = { site: s, d };
  }
  const allowed = best.site.radius_m + (viaNetwork ? accuracy : 0);
  if (best.d > allowed) {
    return reject(
      req, res, 403, 'OUT_OF_RANGE',
      { distance: Math.round(best.d), site: best.site.name, radius: Math.round(best.site.radius_m) },
      { lat, lng, details: { ...details, site_id: best.site.id, distance_m: Math.round(best.d) } }
    );
  }

  // 5. Sequence: can't check in twice or check out without checking in.
  const today = todayRecords(req.user.id);
  const last = today[today.length - 1];
  if (type === 'in' && last && last.type === 'in') return res.status(409).json({ error: t(req, 'ALREADY_IN') });
  if (type === 'out' && (!last || last.type === 'out')) return res.status(409).json({ error: t(req, 'NOT_IN') });

  // 6. Save.
  const now = new Date();
  const date = localDate(now);
  const rel = path.join(String(req.user.id), date.slice(0, 7), `${date}_${now.getTime()}_${type}.jpg`);
  const abs = path.join(config.photoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, photo.buffer);

  const info = db
    .prepare(
      `INSERT INTO attendance (user_id, type, ts, local_date, lat, lng, accuracy_m, distance_m, site_id, photo, device_id,
                               ip, via_network, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id, type, now.toISOString(), date, lat, lng, accuracy, Math.round(best.d), best.site.id, rel,
      req.user.device_id, details.ip, viaNetwork ? 1 : 0, details.source
    );

  res.status(201).json({
    id: info.lastInsertRowid,
    type,
    ts: now.toISOString(),
    site: best.site.name,
    distance_m: Math.round(best.d),
    via_network: viaNetwork,
  });
});

// Multer errors (e.g. photo too large) -> JSON
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: t(req, 'UPLOAD_ERROR', { detail: err.message }) });
  next(err);
});

module.exports = router;
