'use strict';

// Plain items (owner, 28 Nov: glass tumblers and cups sold without printing, beside the UV DTF wraps): a ready
// "design" of kind 'blank' with no print files; its price is the product's (with options) times the quantity; it is
// ordered without an approval and goes straight to the queue.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

const OPEN = [{ max: 1e6, ms: 1000 }];
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-blank-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: OPEN, designsAll: OPEN }, cleanupEvery: 0, requireApproval: true, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const call = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('a plain glass: made, priced by quantity, ordered without approval, no print files', async () => {
  const { products } = await (await call('GET', '/api/products')).json();
  const glass = products.find((p) => p.blank);
  assert.ok(glass, 'a plain glass product');
  const unit = glass.basePrice + (glass.sizes[0].surcharge || 0);
  const r = await call('POST', '/api/blanks', { productId: glass.id, qty: 3 });
  assert.strictEqual(r.status, 201);
  const made = await r.json();
  assert.strictEqual(made.price, unit * 3);
  assert.strictEqual(made.qty, 3);
  // Nothing to print, so nothing to check: its proof passes (QA 28 Nov: "print file missing" in the cart).
  const proof = await (await call('GET', `/api/designs/${made.id}/proof`)).json();
  assert.strictEqual(proof.preflight.status, 'pass', JSON.stringify(proof.preflight));
  // Its picture is there.
  assert.strictEqual((await fetch(base + made.previewUrl)).status, 200);
  // Not for a printed product, nor a silly quantity; the cart's − / + is not for it.
  assert.strictEqual((await call('POST', '/api/blanks', { productId: 'tshirt' })).status, 404);
  assert.strictEqual((await call('POST', '/api/blanks', { productId: glass.id, qty: 0 })).status, 400);
  assert.strictEqual((await call('POST', '/api/blanks', { productId: glass.id, qty: 21 })).status, 400);
  assert.strictEqual((await call('POST', `/api/designs/${made.id}/quantity`, { qty: 5 })).status, 409);
  // QA 28 Nov: a printed design can't be made on a plain glass (it would be priced as the plain glass).
  const printed = await call('POST', '/api/designs', { productId: glass.id, color: glass.colors[0].id, size: glass.sizes[0].id, sides: { front: { editor: { objects: [] } } } });
  assert.strictEqual(printed.status, 400);
  assert.strictEqual((await printed.json()).error, 'Unknown product');
  // Ordered with no approval asked (requireApproval is on), straight to the queue.
  const q = await (await call('POST', '/api/cart/quote', { designIds: [made.id] })).json();
  const o = await call('POST', '/api/orders', { customer: { name: 'Mona', phone: '01011112222', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' }, designIds: [made.id], expectedTotal: q.total });
  const order = await o.json();
  assert.strictEqual(o.status, 201, JSON.stringify(order));
  const login = await (await call('POST', '/api/admin/login', { password: 'secret' })).json();
  const auth = { Authorization: 'Bearer ' + login.token };
  const { orders } = await (await call('GET', '/api/admin/orders', undefined, auth)).json();
  const item = orders.find((x) => x.id === order.id).items[0];
  assert.strictEqual(item.kind, 'blank');
  assert.strictEqual(item.status, 'queued');
  assert.strictEqual(item.copies, 3);
  assert.strictEqual(item.price, unit * 3);
  // No print files; its picture only.
  assert.strictEqual((await call('GET', `/api/admin/files/${made.id}/front?format=png`, undefined, auth)).status, 404);
  assert.strictEqual((await call('GET', `/api/admin/files/${made.id}/front?format=proof`, undefined, auth)).status, 200);
});
