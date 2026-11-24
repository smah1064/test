'use strict';

// Shop fixes from the QA runs: couple mugs, phone numbers pasted from phones, coupons per customer in the cart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { normalizeEgyptMobile } = require('../src/egypt');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let token;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shopqa-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const CUSTOMER = { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1 شارع' };

async function makeDesign(body) {
  const res = await post('/api/designs', body);
  assert.strictEqual(res.status, 201, await res.clone().text());
  const c = await res.json();
  for (const name of c.files) {
    const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1050 : 52, channels: 4, background: '#c33' } }).png().toBuffer();
    const r = await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
    assert.strictEqual(r.status, 204, `${name}: ${await r.text()}`);
  }
  const done = await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('couple mugs (sides "mug1" and "mug2") can be designed and ordered', async () => {
  const side = { editor: { objects: [{ type: 'i-text', text: 'Love' }] } };
  const d = await makeDesign({ productId: 'couplemugs', color: 'white', size: '11oz', sides: { mug1: side, mug2: side } });
  assert.deepStrictEqual(d.sides.map((s) => s.id), ['mug1', 'mug2']);
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
});

test('phone numbers copied from contacts or WhatsApp are understood', () => {
  for (const v of ['‪+20 10 1234 5678‬', '‎01012345678', '+2001012345678', '٠١٠١٢٣٤٥٦٧٨', '0020 101 234 5678', '01012345678﻿']) {
    assert.strictEqual(normalizeEgyptMobile(v), '01012345678', JSON.stringify(v));
  }
  assert.strictEqual(normalizeEgyptMobile('+20012345678'), null);
});

test('a name of invisible characters only is refused', async () => {
  const d = await makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const r = await post('/api/orders', { customer: { ...CUSTOMER, name: '​‎ ' }, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(r.status, 400);
});

test('the cart quote checks a per-customer coupon against the phone typed at checkout; guests get no draft error', async () => {
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  const c = await post('/api/admin/coupons', { code: 'ONCEEACH', type: 'fixed', value: 20, perCustomer: 1 }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(c.status, 201, await c.clone().text());
  const mk = () => makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  const d1 = await mk();
  const q1 = await (await post('/api/cart/quote', { designIds: [d1.id], couponCode: 'ONCEEACH' })).json();
  assert.strictEqual((await post('/api/orders', { customer: CUSTOMER, designIds: [d1.id], couponCode: 'ONCEEACH', expectedTotal: q1.total })).status, 201);
  const d2 = await mk();
  const other = await (await post('/api/cart/quote', { designIds: [d2.id], couponCode: 'ONCEEACH', phone: '01099999999' })).json();
  assert.strictEqual(other.discount, 20);
  const same = await (await post('/api/cart/quote', { designIds: [d2.id], couponCode: 'ONCEEACH', phone: '‪+20 10 1234 5678‬' })).json();
  assert.strictEqual(same.discount, 0);
  assert.ok(same.couponError);
  const guest = await fetch(base + '/api/account/drafts/tshirt');
  assert.strictEqual(guest.status, 204);
});
