'use strict';

// Tester 2's run at 1 am Cairo (26 Nov), on the server: an item waiting for the customer's changes prints as it is
// only with a note; a cost request without its field changes nothing; the owner's own changes read in full in the
// activity log; typed values keep their own digits there in Arabic; the stock message uses the shop's Arabic digits.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN] };
const CUSTOMER = { name: 'ليلى سمير', phone: '01055556666', governorate: 'cairo', city: 'المعادي', address: '3 شارع 9' };
const MUG = { w: 2590, h: 1049 };
let server;
let base;
let dataDir;
let token = null;
let app;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2601-'));
  app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function admin(url, opts = {}) {
  if (!token) token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  return fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
const adminSend = (method, url, body, headers = {}) => admin(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
async function approvedMug() {
  const created = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    let data = await art(60, 52);
    if (name.endsWith('-print.png')) data = await art(MUG.w, MUG.h);
    if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data })).status, 204);
  }
  const d = await (await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
  const proof = await (await fetch(`${base}/api/designs/${d.id}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json();
  return { o, it: o.items[0] };
}
const activity = async () => (await (await admin('/api/admin/activity')).json()).entries || [];

test('waiting for the customer\'s changes: Approve needs a note saying why it prints as it is', async () => {
  const { it } = await approvedMug();
  assert.strictEqual((await adminSend('POST', `/api/admin/items/${it.id}/review`, { action: 'reopen', note: 'Blurry photo' })).status, 200);
  assert.strictEqual((await adminSend('POST', `/api/admin/items/${it.id}/review`, { action: 'changes', note: 'Please send a sharper photo.' })).status, 200);
  const bare = await adminSend('POST', `/api/admin/items/${it.id}/review`, { action: 'approve' }, { 'x-lang': 'ar' });
  assert.strictEqual(bare.status, 400);
  const body = await bare.json();
  assert.strictEqual(body.code, 'changesApproveNote');
  assert.match(body.error, /العميل مطلوب منه تعديل/);
  const ok = await adminSend('POST', `/api/admin/items/${it.id}/review`, { action: 'approve', note: 'Customer said on WhatsApp: print it as it is' });
  assert.strictEqual(ok.status, 200, await ok.clone().text());
});

test('a cost request without its field is refused and the saved cost stays; null still clears it', async () => {
  const { o, it } = await approvedMug();
  assert.strictEqual((await adminSend('PATCH', `/api/admin/items/${it.id}/cost`, { actualCost: 100 })).status, 200);
  assert.strictEqual((await adminSend('PATCH', `/api/admin/items/${it.id}/cost`, {})).status, 400);
  assert.strictEqual((await adminSend('PATCH', `/api/admin/orders/${o.id}/shipping-cost`, { actualShipping: 60 })).status, 200);
  assert.strictEqual((await adminSend('PATCH', `/api/admin/orders/${o.id}/shipping-cost`, { shipping: 0 })).status, 400);
  const store = app.locals.store;
  assert.strictEqual(store.findItem(it.id).item.actualCost, 100, 'the item\'s cost stays');
  assert.strictEqual(store.getOrder(o.id).actualShipping, 60, 'the shipping cost stays');
  assert.strictEqual((await adminSend('PATCH', `/api/admin/items/${it.id}/cost`, { actualCost: null })).status, 200, 'an emptied box clears it');
  assert.strictEqual(store.findItem(it.id).item.actualCost, undefined);
});

test('the owner\'s own changes read in full in the activity log; a typed coupon code keeps its digits in Arabic', async () => {
  const lib = await (await fetch(`${base}/api/library`)).json();
  const id = lib.designs[0].id;
  assert.strictEqual((await adminSend('PATCH', '/api/admin/library', { ids: [id], hidden: true })).status, 200);
  assert.strictEqual((await adminSend('POST', '/api/admin/coupons', { code: '2026', type: 'percent', value: 10, active: true })).status, 201);
  const list = await activity();
  const paused = list.find((e) => e.action === 'PATCH /api/admin/library');
  assert.ok(paused, JSON.stringify(list.slice(0, 3)));
  assert.match(paused.summary.en, /pause/i, JSON.stringify(paused.summary));
  const coupon = list.find((e) => e.action === 'POST /api/admin/coupons');
  assert.ok(coupon && coupon.summary && coupon.summary.ar.includes('⁨2026⁩'), JSON.stringify(coupon && coupon.summary));
});
