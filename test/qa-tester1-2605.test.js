'use strict';

// Tester 1's run at 8 am Cairo (26 Nov), on the server: a coupon code sent as a list is no code (it slipped past the
// wrong-guess limit and still took the discount); text sent as an object is a bad request (400), not a server error.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const coupons = require('../src/coupons');

let server;
let base;
let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2605-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', cleanupEvery: 0 });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a coupon code sent as a list or an object is no code', () => {
  assert.strictEqual(coupons.normCode(['QATEST10']), '');
  assert.strictEqual(coupons.normCode({ code: 'X' }), '');
  assert.strictEqual(coupons.normCode('eid٢٠'), 'EID20');
  assert.strictEqual(coupons.normCode(2026), '2026');
});

test('text sent as an object ({"toString": 1}): 400, never 500', async () => {
  const bad = { toString: 1 };
  for (const [url, body] of [
    ['/api/account/login', { login: bad, password: 'x' }],
    ['/api/account/login', { login: '01012345678', password: bad }],
    ['/api/account/forgot', { login: bad }],
    ['/api/account/reset', { token: bad, password: 'a-long-password-1' }],
  ]) {
    const r = await post(url, body);
    assert.ok(r.status < 500, `${url}: ${r.status}`);
  }
  const q = await post('/api/cart/quote', { designIds: [], couponCode: ['QATEST10'] });
  assert.strictEqual(q.status, 200);
  assert.strictEqual((await q.json()).coupon, null);
});
