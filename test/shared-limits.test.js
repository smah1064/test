'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const security = require('../src/security');

/** Two copies of the shop on the same data folder (as on a host that runs several). */
async function twoCopies(dir, password) {
  const servers = [];
  for (let i = 0; i < 2; i++) {
    const app = createApp({ dataDir: dir, adminPassword: password, cleanupEvery: 0, requireApproval: false, captcha: null });
    servers.push(await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }));
  }
  return servers;
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;
const post = (s, p, body, headers = {}) => fetch(urlOf(s) + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('shared sign-in limits: admin wrong passwords count across copies and survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shared-'));
  const pw = 'Str0ng!Passw0rd-2026';
  let [a, b] = await twoCopies(dir, pw);
  try {
    const ip = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 3; i++) assert.strictEqual((await post(a, '/api/admin/login', { password: 'guess' + i }, ip)).status, 401);
    for (let i = 3; i < 5; i++) assert.strictEqual((await post(b, '/api/admin/login', { password: 'guess' + i }, ip)).status, 401);
    // Five wrong passwords spread over two copies: both copies refuse, even the right password.
    assert.strictEqual((await post(a, '/api/admin/login', { password: pw }, ip)).status, 429);
    assert.strictEqual((await post(b, '/api/admin/login', { password: pw }, ip)).status, 429);
    // Another visitor is not affected.
    assert.strictEqual((await post(b, '/api/admin/login', { password: pw }, { 'X-Forwarded-For': '203.0.113.8' })).status, 200);
    // A restarted copy still remembers.
    a.close();
    b.close();
    [a, b] = await twoCopies(dir, pw);
    assert.strictEqual((await post(a, '/api/admin/login', { password: pw }, ip)).status, 429);
    // The file keeps no IP addresses.
    const file = fs.readFileSync(path.join(dir, '.signin-limits.json'), 'utf8');
    assert.doesNotMatch(file, /203\.0\.113/);
  } finally {
    a.close();
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shared sign-in limits: customer wrong passwords for one account count across copies', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shared-'));
  const [a, b] = await twoCopies(dir, 'Str0ng!Passw0rd-2026');
  try {
    const user = { name: 'Mona Adel', phone: '01055566677', password: 'a-long-password-1' };
    assert.strictEqual((await post(a, '/api/account/signup', user)).status, 201);
    // Ten wrong passwords for the account from different visitors, half on each copy.
    for (let i = 0; i < 10; i++) {
      const r = await post(i % 2 ? b : a, '/api/account/login', { login: user.phone, password: 'wrong-' + i }, { 'X-Forwarded-For': `198.51.100.${i}` });
      assert.strictEqual(r.status, 401, `wrong ${i}`);
    }
    // Now the account is locked on both copies, even with the right password from a new visitor.
    for (const s of [a, b]) {
      const r = await post(s, '/api/account/login', { login: user.phone, password: user.password }, { 'X-Forwarded-For': '198.51.100.99' });
      assert.strictEqual(r.status, 429);
    }
  } finally {
    a.close();
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SharedLimiter: same answers as the in-memory limiter, and falls back when the file cannot be used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shared-'));
  try {
    const rules = [{ max: 3, ms: 60e3 }];
    const one = new security.SharedLimiter(path.join(dir, 'l.json'));
    const two = new security.SharedLimiter(path.join(dir, 'l.json'));
    assert.strictEqual(one.hit('k', rules), 0);
    assert.strictEqual(two.hit('k', rules), 0);
    assert.strictEqual(one.hit('k', rules), 0);
    assert.ok(two.hit('k', rules) > 0, 'fourth hit refused by the other instance');
    assert.ok(typeof one.check('k', rules) === 'number');
    two.clear('k');
    assert.strictEqual(typeof one.check('k', rules), 'object');
    // A folder that doesn't exist: still limits, in memory.
    const lost = new security.SharedLimiter(path.join(dir, 'missing', 'l.json'));
    for (let i = 0; i < 3; i++) assert.strictEqual(lost.hit('k', rules), 0);
    assert.ok(lost.hit('k', rules) > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
