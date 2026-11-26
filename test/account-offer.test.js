'use strict';

// After a guest order, the order page offers "Save your orders": a new account from the order's own name and
// mobile, with a password typed there; the order (and this browser's other guest orders from that mobile) go on
// it (owner's OK, UX item 8, 26 Nov). Only on the browser the order was placed from (the order's shared link alone
// isn't enough: QA 26 Nov), never for a mobile that already has an account.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], reorder: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN] };
const CUSTOMER = { name: 'Mona Ali', phone: '01033334444', governorate: 'giza', city: 'Dokki', address: '5 Nile St', email: 'mona@example.com' };
let server;
let base;
let dataDir;

async function start() {
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-acctoffer-'));
  await start();
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(url, method = 'GET', body, token, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
async function makeDesign(headers = {}) {
  const res = await call('/api/designs', 'POST', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } }, null, headers);
  assert.strictEqual(res.status, 201, res.text);
  const { id, uploadToken, files } = res.json;
  for (const name of files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken }, body });
    assert.strictEqual(up.status, 204);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200);
  return id;
}
async function placeOrder(headers = {}, customer = CUSTOMER) {
  const ids = [await makeDesign(headers), await makeDesign(headers)];
  const q = (await call('/api/cart/quote', 'POST', { designIds: ids })).json;
  const o = await call('/api/orders', 'POST', { customer, designIds: ids, expectedTotal: q.total, orderKey: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }, null, headers);
  assert.strictEqual(o.status, 201, o.text);
  // (The browser the order was placed from: its pod_orders cookie.)
  const here = (o.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_orders='));
  return { ...o.json, here };
}

const cookieFrom = (r) => (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => /^pod_c(ust)?[a-z_]*=/.test(c) && !c.endsWith('='));

test('a guest order offers an account; the password alone makes it, the order is on it, and the offer is gone', async () => {
  const order = await placeOrder();
  const key = { Cookie: order.here };
  const seen = await call(`/api/orders/${order.id}`, 'GET', undefined, null, key);
  assert.strictEqual(seen.status, 200, seen.text);
  assert.deepStrictEqual(seen.json.accountOffer, { phone: '01033334444' });
  // Without the key: neither the offer nor the account.
  const bare = await call(`/api/orders/${order.id}/account`, 'POST', { password: 'long-enough-pass' }, null, { 'x-lang': 'en' });
  assert.strictEqual(bare.status, 403);
  // A short password: the account page's own message.
  const short = await call(`/api/orders/${order.id}/account`, 'POST', { password: 'short' }, null, { ...key, 'x-lang': 'en' });
  assert.strictEqual(short.status, 400);
  assert.strictEqual(short.json.code, 'acctPasswordShort');
  const made = await call(`/api/orders/${order.id}/account`, 'POST', { password: 'long-enough-pass' }, null, key);
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.customer.phone, '01033334444');
  assert.strictEqual(made.json.customer.name, 'Mona Ali');
  const session = cookieFrom(made);
  assert.ok(session, 'signed in on this browser');
  const mine = await call('/api/account/orders', 'GET', undefined, null, { Cookie: session });
  assert.strictEqual(mine.status, 200, mine.text);
  assert.deepStrictEqual(mine.json.orders.map((o) => o.id), [order.id]);
  // The order is on the account now: no offer, and asking again is refused.
  const after = await call(`/api/orders/${order.id}`, 'GET', undefined, null, key);
  assert.strictEqual(after.json.accountOffer, undefined);
  assert.strictEqual((await call(`/api/orders/${order.id}/account`, 'POST', { password: 'long-enough-pass' }, null, key)).status, 403);
  // The same password signs in with the mobile.
  const login = await call('/api/account/login', 'POST', { login: '01033334444', password: 'long-enough-pass' });
  assert.strictEqual(login.status, 200, login.text);
});

test('a mobile that already has an account: no offer, and no second account', async () => {
  const order = await placeOrder();
  const key = { Cookie: order.here };
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, key)).json.accountOffer, undefined);
  const again = await call(`/api/orders/${order.id}/account`, 'POST', { password: 'another-long-pass' }, null, key);
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.json.code, 'acctPhoneTaken');
});

test('the order\'s link alone (shared on WhatsApp, opened elsewhere): the order shows, but no offer and no account', async () => {
  const order = await placeOrder({}, { ...CUSTOMER, phone: '01077778888', email: '' });
  const link = { 'x-order-key': order.key };
  const seen = await call(`/api/orders/${order.id}`, 'GET', undefined, null, link);
  assert.strictEqual(seen.status, 200, seen.text);
  assert.strictEqual(seen.json.accountOffer, undefined, 'no offer and no mobile for whoever has the link');
  const made = await call(`/api/orders/${order.id}/account`, 'POST', { password: 'someone-elses-pass' }, null, link);
  assert.strictEqual(made.status, 403);
  // The customer, on their own browser, still can.
  assert.ok((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { Cookie: order.here })).json.accountOffer);
});
