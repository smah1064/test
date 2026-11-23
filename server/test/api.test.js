const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'att-test-'));
process.env.COMPANY_TZ = 'UTC';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_CODE = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';

const { createApp } = require('../src/index');
const { db } = require('../src/db');

const SITE = { lat: 24.7136, lng: 46.6753 };
const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);

let base, server;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function api(method, url, { token, body, device, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-device-id'] = device;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

function punchForm(type, overrides = {}) {
  const f = new FormData();
  const fields = {
    type,
    lat: SITE.lat + 0.0003, // ~33 m north of the site
    lng: SITE.lng,
    accuracy: 12,
    is_mocked: false,
    dev_mode: false,
    rooted: false,
    capture_age_sec: 4,
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  f.append('photo', new Blob([fakeJpeg], { type: 'image/jpeg' }), 'selfie.jpg');
  return f;
}

test('full attendance flow', async () => {
  // Admin logs in and sets up a site and an employee
  let r = await api('POST', '/api/auth/login', { body: { emp_code: 'admin', password: 'admin123', portal: 'admin' } });
  assert.equal(r.status, 200);
  const admin = r.data.token;

  r = await api('POST', '/api/admin/sites', { token: admin, body: { name: 'HQ', ...SITE, radius_m: 100 } });
  assert.equal(r.status, 201);
  const siteId = r.data.id;

  r = await api('POST', '/api/admin/employees', {
    token: admin,
    body: { emp_code: 'E001', name: 'Sara Ali', password: 'secret1', site_id: siteId },
  });
  assert.equal(r.status, 201);

  // Employee cannot log in to the admin portal or without a device id
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E001', password: 'secret1', portal: 'admin' } });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E001', password: 'secret1' } });
  assert.equal(r.status, 400);

  // First login binds the phone
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E001', password: 'secret1', device_id: 'phone-A', device_model: 'Pixel 9' } });
  assert.equal(r.status, 200);
  const emp = r.data.token;
  const auth = { token: emp, device: 'phone-A' };

  // A second phone is refused
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E001', password: 'secret1', device_id: 'phone-B' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'DEVICE_MISMATCH');
  r = await api('GET', '/api/attendance/me', { token: emp, device: 'phone-B' });
  assert.equal(r.status, 403);

  // Blocked punches
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in', { dev_mode: true }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'DEV_MODE');
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in', { is_mocked: true }) });
  assert.equal(r.data.code, 'MOCK_LOCATION');
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in', { lat: SITE.lat + 0.01 }) });
  assert.equal(r.data.code, 'OUT_OF_RANGE');
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in', { accuracy: 400 }) });
  assert.equal(r.data.code, 'LOW_ACCURACY');
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in', { capture_age_sec: 3600 }) });
  assert.equal(r.data.code, 'STALE');

  // Check out before check in
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('out') });
  assert.equal(r.status, 409);

  // Valid check in, duplicate check in, valid check out
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in') });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.site, 'HQ');
  const inId = r.data.id;
  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('in') });
  assert.equal(r.status, 409);

  r = await api('GET', '/api/attendance/me', auth);
  assert.equal(r.data.checked_in, true);

  r = await api('POST', '/api/attendance', { ...auth, form: punchForm('out') });
  assert.equal(r.status, 201);

  // Admin sees photo, log, blocked attempts and report
  r = await api('GET', `/api/admin/attendance/${inId}/photo`, { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.data[0], 0xff);

  r = await api('GET', '/api/admin/attendance', { token: admin });
  assert.equal(r.data.records.length, 2);
  assert.equal(r.data.stats.present, 1);

  r = await api('GET', '/api/admin/rejected', { token: admin });
  assert.deepEqual(new Set(r.data.map((x) => x.code)), new Set(['DEV_MODE', 'MOCK_LOCATION', 'OUT_OF_RANGE', 'LOW_ACCURACY', 'STALE']));

  const month = new Date().toISOString().slice(0, 7);
  r = await api('GET', `/api/admin/reports/monthly?month=${month}`, { token: admin });
  assert.equal(r.status, 200);
  const row = r.data.summary.find((s) => s.emp_code === 'E001');
  assert.equal(row.present_days + (row.offday_present_days || 0), 1);
  assert.equal(row.blocked_attempts, 3); // DEV_MODE, MOCK_LOCATION, OUT_OF_RANGE

  r = await api('GET', `/api/admin/reports/monthly?month=${month}&format=xlsx`, { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.data.slice(0, 2).toString(), 'PK');

  r = await api('GET', `/api/admin/reports/monthly?month=${month}&format=csv&sheet=daily`, { token: admin });
  assert.match(r.data.toString(), /Sara Ali/);

  // Admin resets device -> employee can bind a new phone
  const empId = db.prepare("SELECT id FROM users WHERE emp_code='E001'").get().id;
  r = await api('PUT', `/api/admin/employees/${empId}`, { token: admin, body: { reset_device: true } });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E001', password: 'secret1', device_id: 'phone-B' } });
  assert.equal(r.status, 200);

  // Employees can't reach admin endpoints
  r = await api('GET', '/api/admin/employees', { token: r.data.token, device: 'phone-B' });
  assert.equal(r.status, 403);
});

test('monthly report marks absences and lateness', async () => {
  const { buildMonthlyReport } = require('../src/report');
  const { setSettings } = require('../src/db');
  setSettings({ weekend_days: '', work_start: '09:00', grace_minutes: '10' });
  const u = db
    .prepare("INSERT INTO users (emp_code, name, password_hash, created_at) VALUES ('E900','Old Hand','x','2020-01-01 00:00:00')")
    .run();
  const ins = db.prepare(
    "INSERT INTO attendance (user_id, type, ts, local_date, lat, lng, photo) VALUES (?, ?, ?, ?, 0, 0, 'x.jpg')"
  );
  ins.run(u.lastInsertRowid, 'in', '2025-03-03T09:05:00.000Z', '2025-03-03'); // on time (within grace)
  ins.run(u.lastInsertRowid, 'out', '2025-03-03T17:05:00.000Z', '2025-03-03');
  ins.run(u.lastInsertRowid, 'in', '2025-03-04T09:45:00.000Z', '2025-03-04'); // 45 min late
  ins.run(u.lastInsertRowid, 'out', '2025-03-04T16:00:00.000Z', '2025-03-04'); // left early
  ins.run(u.lastInsertRowid, 'in', '2025-03-05T08:55:00.000Z', '2025-03-05'); // forgot to check out

  const rep = buildMonthlyReport('2025-03');
  const s = rep.summary.find((x) => x.emp_code === 'E900');
  assert.equal(s.working_days, 31);
  assert.equal(s.present_days, 3);
  assert.equal(s.absent_days, 28);
  assert.equal(s.late_days, 1);
  assert.equal(s.late_minutes, 45);
  assert.equal(s.early_leave_days, 1);
  assert.equal(s.missing_checkouts, 1);
  assert.equal(s.worked_hours, 14.25);
  const d4 = rep.daily.find((x) => x.emp_code === 'E900' && x.date === '2025-03-04');
  assert.equal(d4.status, 'Late');
  assert.equal(d4.first_in, '09:45');
});

test('integrity violations are logged even without location or photo', async () => {
  let r = await api('POST', '/api/auth/login', { body: { emp_code: 'admin', password: 'admin123' } });
  const admin = r.data.token;
  await api('POST', '/api/admin/employees', { token: admin, body: { emp_code: 'E002', name: 'Omar', password: 'secret2' } });
  r = await api('POST', '/api/auth/login', { body: { emp_code: 'E002', password: 'secret2', device_id: 'phone-C' } });
  const f = new FormData();
  f.append('type', 'in');
  f.append('dev_mode', 'true');
  r = await api('POST', '/api/attendance', { token: r.data.token, device: 'phone-C', form: f });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'DEV_MODE');
  r = await api('GET', '/api/admin/rejected', { token: admin });
  assert.ok(r.data.some((x) => x.emp_code === 'E002' && x.code === 'DEV_MODE'));
});

test('employee-facing messages follow Accept-Language, admin log stays English', async () => {
  const login = (lang, body) =>
    fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': lang },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));

  let r = await login('ar', { emp_code: 'E001', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'رمز الموظف أو كلمة المرور غير صحيحة');
  r = await login('en', { emp_code: 'E001', password: 'wrong' });
  assert.equal(r.data.error, 'Wrong employee code or password');
  r = await login('ar-SA,ar;q=0.9,en;q=0.5', { emp_code: 'E001', password: 'wrong' });
  assert.match(r.data.error, /كلمة المرور/);

  // Out-of-range punch in Arabic, with the numbers and site name filled in
  r = await login('ar', { emp_code: 'E001', password: 'secret1', device_id: 'phone-B' });
  assert.equal(r.status, 200);
  const form = punchForm('in', { lat: SITE.lat + 0.01 });
  const res = await fetch(base + '/api/attendance', {
    method: 'POST',
    headers: { authorization: `Bearer ${r.data.token}`, 'x-device-id': 'phone-B', 'accept-language': 'ar' },
    body: form,
  });
  const body = await res.json();
  assert.equal(body.code, 'OUT_OF_RANGE');
  assert.match(body.error, /^أنت على بُعد \d+ م من HQ\. يجب أن تكون ضمن 100 م\.$/);

  const admin = (await api('POST', '/api/auth/login', { body: { emp_code: 'admin', password: 'admin123' } })).data.token;
  const log = (await api('GET', '/api/admin/rejected', { token: admin })).data;
  assert.match(log[0].reason, /^You are \d+ m from HQ\. You must be within 100 m\.$/);
});
