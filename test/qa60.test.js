'use strict';

// Findings of the 60-minute test round (24 Nov): coupons and shipping, the account cart, send again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let token;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa60-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], accountSignup: [OPEN], draftSave: [OPEN], reorder: [OPEN] }, cleanupEvery: 0, requireApproval: false, captcha: null });
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
  return fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
async function mug(qty = 1) {
  const body = { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } }, ...(qty > 1 ? { quantities: [{ color: 'white', size: '11oz', qty }] } : {}) };
  const created = await (await post('/api/designs', body)).json();
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await art(1200, 1050) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  return (await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
}
const CUSTOMER = { name: 'أحمد علي', phone: '01033332222', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' };

test('a coupon never makes the order cost more (free shipping is judged before the discount)', async () => {
  const d = await mug(6); // 6 mugs: at or over the free-shipping line
  const plain = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.ok(plain.subtotal >= plain.freeShippingOver, `${plain.subtotal} ≥ ${plain.freeShippingOver}`);
  assert.strictEqual(plain.shipping, 0);
  assert.strictEqual((await admin('/api/admin/coupons', { method: 'POST', body: JSON.stringify({ code: 'FIX50', type: 'fixed', value: 50, active: true }) })).status, 201);
  const q = await (await post('/api/cart/quote', { designIds: [d.id], couponCode: 'FIX50' })).json();
  assert.strictEqual(q.discount, 50);
  assert.ok(q.total <= plain.total, `${q.total} ≤ ${plain.total}`);
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: 'FIX50', expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  assert.strictEqual((await o.json()).total, q.total);
});

test('the account cart merges: an old page on one device neither drops nor brings back items', async () => {
  const r = await post('/api/account/signup', { name: 'Salma', phone: '01055554444', password: 'a-long-password-1' });
  const me = (await r.json()).customer;
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const put = (items, baseIds) => fetch(base + '/api/account/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie, 'X-Account': me.id }, body: JSON.stringify({ items: items.map((id) => ({ designId: id })), base: baseIds }) }).then((x) => x.json()).then((j) => j.items.map((i) => i.designId));
  const [x, y, z] = [(await mug()).id, (await mug()).id, (await mug()).id];
  assert.deepStrictEqual(await put([x], []), [x]); // the laptop adds X
  // The phone's page was opened before: it knows nothing (base []) and adds Y: X stays.
  assert.deepStrictEqual((await put([y], [])).sort(), [x, y].sort());
  // The laptop removes X (it had agreed on X and Y).
  assert.deepStrictEqual(await put([y], [x, y]), [y]);
  // The phone (still agreed on X, Y) adds Z: X doesn't come back.
  assert.deepStrictEqual((await put([x, y, z], [x, y])).sort(), [y, z].sort());
});

test('send again: same pieces are accepted after a price-list change; the sample request and a fresh approval follow', async () => {
  const d = await mug(60);
  const proof = await (await fetch(`${base}/api/designs/${d.id}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash, sample: true } } })).json();
  const it = o.items[0];
  assert.strictEqual(it.status, 'review');
  // The shop raises the mug price, then asks for changes.
  assert.strictEqual((await admin('/api/admin/pricing/mug', { method: 'PUT', body: JSON.stringify({ basePrice: 999 }) })).status, 200);
  assert.strictEqual((await admin(`/api/admin/items/${it.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'changes', note: 'Darker text' }) })).status, 200);
  const nd = await mug(60);
  const r = await post(`/api/orders/${o.id}/items/${it.id}/revise?k=${o.key}`, { designId: nd.id });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const after = (await r.json()).items[0];
  assert.strictEqual(after.price, it.price, 'the price agreed at checkout stays');
  assert.strictEqual(after.approval == null, true, 'the old approval does not stand for the new version');
  const rv = (await (await admin('/api/admin/review')).json()).items.find((x) => x.id === it.id);
  assert.ok(rv.review.reasons.includes('sample'), JSON.stringify(rv.review.reasons));
  assert.strictEqual(rv.sample, true);
});

test('customer search ignores Arabic spelling variants', async () => {
  assert.strictEqual((await post('/api/account/signup', { name: 'أحمد علي', phone: '01066667777', password: 'a-long-password-1' })).status, 201);
  const find = async (q) => (await (await admin('/api/admin/customers?q=' + encodeURIComponent(q))).json()).customers.map((c) => c.name);
  assert.ok((await find('احمد')).includes('أحمد علي'));
  assert.ok((await find('احمد على')).includes('أحمد علي'));
});
