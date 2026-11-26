'use strict';

// Tester 1's run at midnight Cairo (26 Nov), on the server: a fixed coupon saved as 7.5 EGP before the whole-pound
// rule can still be paused and its note changed (only a newly typed amount must be whole); a new 7.5 is refused.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

test('an older 7.5 EGP coupon: pausing it and changing its note work; typing 7.5 again or for another is refused', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-c75-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const owner = (await call('POST', '/api/admin/login', { password: 'secret' })).json.token;
    const made = await call('POST', '/api/admin/coupons', { code: 'OLDHALF', type: 'fixed', value: 7, active: true }, owner);
    assert.strictEqual(made.status, 201, JSON.stringify(made.json));
    // As saved before the rule (25 Nov): 7.5 off.
    app.locals.store.mutate((db) => { db.coupons.find((c) => c.code === 'OLDHALF').value = 7.5; });
    const id = made.json.id;
    const paused = await call('PUT', `/api/admin/coupons/${id}`, { active: false }, owner);
    assert.strictEqual(paused.status, 200, JSON.stringify(paused.json));
    assert.strictEqual(paused.json.active, false);
    assert.strictEqual(paused.json.value, 7.5, 'the amount stays as it was');
    const noted = await call('PUT', `/api/admin/coupons/${id}`, { note: 'old one' }, owner);
    assert.strictEqual(noted.status, 200, JSON.stringify(noted.json));
    // Changing the amount: whole pounds.
    assert.strictEqual((await call('PUT', `/api/admin/coupons/${id}`, { value: 8.5 }, owner)).status, 400);
    assert.strictEqual((await call('PUT', `/api/admin/coupons/${id}`, { value: 8 }, owner)).status, 200);
    // A new coupon at 7.5: refused as before.
    assert.strictEqual((await call('POST', '/api/admin/coupons', { code: 'NEWHALF', type: 'fixed', value: 7.5, active: true }, owner)).status, 400);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
