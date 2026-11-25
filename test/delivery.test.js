'use strict';

// Delivery speed: standard within 5 business days, express within 2 for a fee on top of shipping.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { businessDaysAfter, deliveryFor, expressFee, shippingFor, SHIPPING_FLAT } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-delivery-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const CUSTOMER = { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1 شارع' };

async function makeDesign() {
  const res = await post('/api/designs', { productId: 'bizcards', color: 'gloss', size: '100', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Mona' }] } } } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const c = await res.json();
  for (const name of c.files) {
    const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1110, 698) : await png(60, 40);
    assert.strictEqual((await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data })).status, 204);
  }
  const done = await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('business days skip Friday and Saturday, counted from the next day (Cairo time)', () => {
  assert.strictEqual(businessDaysAfter('2026-11-24T10:00:00Z', 2), '2026-11-26'); // Tue -> Thu
  assert.strictEqual(businessDaysAfter('2026-11-26T10:00:00Z', 2), '2026-11-30'); // Thu -> Sun, Mon
  assert.strictEqual(businessDaysAfter('2026-11-27T10:00:00Z', 5), '2026-12-03'); // Fri -> Sun..Thu
  // 23:30 in Cairo on Thursday is already Thursday there, though Thursday 21:30 UTC.
  assert.strictEqual(businessDaysAfter('2026-11-26T21:30:00Z', 1), '2026-11-29');
  assert.deepStrictEqual(deliveryFor('express', '2026-11-24T10:00:00Z'), { speed: 'express', days: 2, fee: expressFee(), by: '2026-11-26' });
  assert.strictEqual(deliveryFor('anything else').speed, 'standard');
  assert.strictEqual(deliveryFor().fee, 0);
});

test('the catalog tells the pages the delivery times and the express fee', async () => {
  const cat = await (await fetch(base + '/api/products')).json();
  assert.deepStrictEqual(cat.delivery, { standardDays: 5, expressDays: 2, expressFee: expressFee() });
});

test('express delivery adds its fee to the shipping, and the order keeps the speed and the day', async () => {
  const d = await makeDesign();
  const std = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(std.delivery.speed, 'standard');
  assert.strictEqual(std.shipping, shippingFor(d.price));
  assert.deepStrictEqual(std.deliveryOptions.map((o) => [o.speed, o.days]), [['standard', 5], ['express', 2]]);
  const exp = await (await post('/api/cart/quote', { designIds: [d.id], delivery: 'express' })).json();
  assert.strictEqual(exp.shipping, std.shipping + expressFee());
  assert.strictEqual(exp.total, std.total + expressFee());
  // The standard total is refused for an express order: the customer must see what they pay.
  const wrong = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], delivery: 'express', expectedTotal: std.total });
  assert.strictEqual(wrong.status, 409);
  assert.strictEqual((await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], delivery: 'tomorrow', expectedTotal: exp.total })).status, 400);
  const res = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], delivery: 'express', expectedTotal: exp.total });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const order = await res.json();
  assert.strictEqual(order.total, exp.total);
  assert.strictEqual(order.delivery.speed, 'express');
  assert.strictEqual(order.delivery.fee, expressFee());
  assert.match(order.delivery.by, /^\d{4}-\d{2}-\d{2}$/);
  const again = await (await fetch(`${base}/api/orders/${order.id}?k=${order.key}`)).json();
  assert.deepStrictEqual(again.delivery, order.delivery);
  // The shop sees it too.
  const { token } = await (await post('/api/admin/login', { password: 'secret' })).json();
  const admin = await (await fetch(base + '/api/admin/orders', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.strictEqual(admin.orders.find((o) => o.id === order.id).delivery.speed, 'express');
});

test('an order without a choice is standard delivery at the usual shipping', async () => {
  const d = await makeDesign();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const res = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const order = await res.json();
  assert.strictEqual(order.delivery.speed, 'standard');
  assert.strictEqual(order.delivery.days, 5);
  assert.strictEqual(order.shipping, SHIPPING_FLAT);
});
