// Admin-only API used by the web dashboard.
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { db, getSettings, setSettings } = require('../db');
const { requireAuth } = require('../auth');
const { localDate, monthDays, parseHHMM } = require('../util');
const { buildMonthlyReport, reportToXlsx, reportToCsv } = require('../report');
const { clientIp, parseIpList, formatIpList, suggestEntry, isPrivate } = require('../network');

const router = express.Router();
router.use(requireAuth('admin'));

const bad = (res, msg) => res.status(400).json({ error: msg });

// ---------- Sites ----------
function validSite(b) {
  const lat = Number(b.lat), lng = Number(b.lng), radius = Number(b.radius_m);
  if (!b.name || !String(b.name).trim()) return 'Name is required';
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return 'Latitude is invalid';
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) return 'Longitude is invalid';
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) return 'Radius must be 10–5000 m';
  const { error } = parseIpList(b.office_ips);
  if (error) return `Office Wi-Fi: ${error}`;
  return null;
}
const officeIps = (b) => formatIpList(parseIpList(b.office_ips).entries);

// The address this admin's request comes from — used by "Use this network"
// when an admin sets up a location while standing in the office.
router.get('/my-ip', (req, res) => {
  const ip = clientIp(req);
  res.json({ ip, suggestion: suggestEntry(ip), private: isPrivate(ip) });
});

router.get('/sites', (req, res) => {
  res.json(db.prepare('SELECT * FROM sites ORDER BY name').all());
});
router.post('/sites', (req, res) => {
  const err = validSite(req.body || {});
  if (err) return bad(res, err);
  const { name, lat, lng, radius_m } = req.body;
  const info = db
    .prepare('INSERT INTO sites (name, lat, lng, radius_m, office_ips) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).trim(), +lat, +lng, +radius_m, officeIps(req.body));
  res.status(201).json(db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/sites/:id', (req, res) => {
  const err = validSite(req.body || {});
  if (err) return bad(res, err);
  const { name, lat, lng, radius_m } = req.body;
  db.prepare('UPDATE sites SET name = ?, lat = ?, lng = ?, radius_m = ?, office_ips = ? WHERE id = ?').run(
    String(name).trim(), +lat, +lng, +radius_m, officeIps(req.body), req.params.id
  );
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id));
});
router.delete('/sites/:id', (req, res) => {
  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Employees ----------
const USER_FIELDS = `u.id, u.emp_code, u.name, u.role, u.site_id, u.active, u.created_at,
  u.device_model, (u.device_id IS NOT NULL) AS device_bound, s.name AS site_name`;

router.get('/employees', (req, res) => {
  res.json(
    db.prepare(`SELECT ${USER_FIELDS} FROM users u LEFT JOIN sites s ON s.id = u.site_id ORDER BY u.role DESC, u.name`).all()
  );
});

router.post('/employees', (req, res) => {
  const { emp_code, name, password, site_id, role } = req.body || {};
  if (!emp_code || !String(emp_code).trim()) return bad(res, 'Employee code is required');
  if (!name || !String(name).trim()) return bad(res, 'Name is required');
  if (!password || String(password).length < 6) return bad(res, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE emp_code = ?').get(String(emp_code).trim())) return bad(res, 'Employee code already exists');
  const info = db
    .prepare('INSERT INTO users (emp_code, name, role, password_hash, site_id) VALUES (?, ?, ?, ?, ?)')
    .run(String(emp_code).trim(), String(name).trim(), role === 'admin' ? 'admin' : 'employee', bcrypt.hashSync(String(password), 10), site_id || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/employees/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(b.name).trim(), u.id);
  if (b.site_id !== undefined) db.prepare('UPDATE users SET site_id = ? WHERE id = ?').run(b.site_id || null, u.id);
  if (b.active !== undefined) {
    if (u.id === req.user.id && !b.active) return bad(res, "You can't disable your own account");
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
  }
  if (b.password) {
    if (String(b.password).length < 6) return bad(res, 'Password must be at least 6 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.password), 10), u.id);
  }
  if (b.reset_device) db.prepare('UPDATE users SET device_id = NULL, device_model = NULL WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// ---------- Attendance log ----------
router.get('/attendance', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDate();
  const params = [date];
  let where = 'a.local_date = ?';
  if (req.query.user_id) {
    where += ' AND a.user_id = ?';
    params.push(req.query.user_id);
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.type, a.ts, a.lat, a.lng, a.accuracy_m, a.distance_m, a.via_network, a.source, a.ip,
              u.emp_code, u.name, s.name AS site_name
         FROM attendance a JOIN users u ON u.id = a.user_id LEFT JOIN sites s ON s.id = a.site_id
        WHERE ${where} ORDER BY a.ts DESC`
    )
    .all(...params);
  const totalEmployees = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='employee' AND active=1").get().n;
  const present = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM attendance WHERE local_date = ? AND type='in'").get(date).n;
  const inside = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT user_id, type FROM attendance a WHERE local_date = ?
         AND ts = (SELECT MAX(ts) FROM attendance b WHERE b.user_id = a.user_id AND b.local_date = a.local_date)) WHERE type='in'`
    )
    .get(date).n;
  res.json({ date, records: rows, stats: { total_employees: totalEmployees, present, currently_in: inside } });
});

router.get('/attendance/:id/photo', (req, res) => {
  const row = db.prepare('SELECT photo FROM attendance WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).end();
  const abs = path.resolve(config.photoDir, row.photo);
  if (!abs.startsWith(config.photoDir + path.sep) || !fs.existsSync(abs)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.type('jpeg').sendFile(abs);
});

router.get('/rejected', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(
    db
      .prepare(
        `SELECT r.id, r.ts, r.code, r.reason, r.lat, r.lng, r.details, u.emp_code, u.name
           FROM rejected_attempts r LEFT JOIN users u ON u.id = r.user_id
          ORDER BY r.ts DESC LIMIT ?`
      )
      .all(limit)
  );
});

// ---------- Reports ----------
router.get('/reports/monthly', async (req, res) => {
  const month = req.query.month || localDate().slice(0, 7);
  if (!monthDays(month)) return bad(res, 'month must be YYYY-MM');
  const report = buildMonthlyReport(month);
  const format = req.query.format || 'json';
  if (format === 'xlsx') {
    res.attachment(`attendance-${month}.xlsx`);
    return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await reportToXlsx(report));
  }
  if (format === 'csv') {
    const which = req.query.sheet === 'daily' ? 'daily' : 'summary';
    res.attachment(`attendance-${month}-${which}.csv`);
    return res.type('text/csv; charset=utf-8').send(reportToCsv(report, which));
  }
  res.json(report);
});

router.get('/reports/archive', (req, res) => {
  const files = fs
    .readdirSync(config.reportDir)
    .filter((f) => /^attendance-\d{4}-\d{2}\.xlsx$/.test(f))
    .sort()
    .reverse()
    .map((f) => ({ file: f, month: f.slice(11, 18), size: fs.statSync(path.join(config.reportDir, f)).size }));
  res.json(files);
});

router.get('/reports/archive/:file', (req, res) => {
  const f = req.params.file;
  if (!/^attendance-\d{4}-\d{2}\.xlsx$/.test(f)) return res.status(404).end();
  const abs = path.join(config.reportDir, f);
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.download(abs);
});

// ---------- Settings ----------
function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
router.get('/settings', (req, res) => {
  const tz = process.env.TZ && validTz(process.env.TZ) ? process.env.TZ : Intl.DateTimeFormat().resolvedOptions().timeZone;
  res.json({ ...getSettings(), timezone: tz, today: localDate() });
});
router.put('/settings', (req, res) => {
  const b = req.body || {};
  if (b.work_start !== undefined && parseHHMM(b.work_start) === null) return bad(res, 'Work start must be HH:MM');
  if (b.work_end !== undefined && parseHHMM(b.work_end) === null) return bad(res, 'Work end must be HH:MM');
  if (b.grace_minutes !== undefined && !(Number(b.grace_minutes) >= 0)) return bad(res, 'Grace minutes must be a number');
  if (b.weekend_days !== undefined && !/^([0-6](,[0-6])*)?$/.test(String(b.weekend_days).replace(/\s/g, ''))) {
    return bad(res, 'Weekend days must be numbers 0–6 separated by commas');
  }
  if (b.weekend_days !== undefined) b.weekend_days = String(b.weekend_days).replace(/\s/g, '');
  if (b.holidays !== undefined) {
    const list = String(b.holidays).split(/[\s,]+/).filter(Boolean);
    if (list.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return bad(res, 'Holidays must be YYYY-MM-DD dates');
    b.holidays = list.join(',');
  }
  res.json(setSettings(b));
});

module.exports = router;
