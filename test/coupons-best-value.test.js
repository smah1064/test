'use strict';

// Coupons, "best value wins" (owner, 26 Nov): a coupon can apply automatically (no code). At checkout the shop applies
// the one coupon that saves the customer the most: an automatic one, or the code they typed. One discount per order.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../src/app');

function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const PRINT = png(1200, 1600);
const PREVIEW = png(60, 72);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' };

let server;
let base;
let dataDir;
let token;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-bestvalue-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner', limits: { designs: [OPEN], orders: [OPEN], couponTry: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner' }) })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: JSON.stringify(body) });
const admin = (url, method, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-lang': 'en' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function mug() {
  const res = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
  const { id, uploadToken, files } = await res.json();
  for (const name of files) await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW });
  return (await (await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).json()).id;
}
/** An order as the shop keeps it (its coupon, discount and total). */
const savedOrder = (id) => {
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const orders = Array.isArray(db.orders) ? db.orders : Object.values(db.orders || {});
  return orders.find((o) => o.id === id);
};
const quote = async (ids, couponCode, phone) => (await post('/api/cart/quote', { designIds: ids, ...(couponCode ? { couponCode } : {}), ...(phone ? { phone } : {}) })).json();
async function coupon(body) {
  const r = await admin('/api/admin/coupons', 'POST', { type: 'percent', ...body });
  assert.strictEqual(r.status, 201, await r.clone().text());
  return r.json();
}

test('an automatic coupon applies with no code; a typed code that saves more wins; one that saves less is told, not refused', async () => {
  const auto = await coupon({ code: 'AUTO10', value: 10, auto: true });
  assert.strictEqual(auto.auto, true);
  const id = await mug(); // 250 EGP + 75 shipping
  // No code: the automatic one.
  const q1 = await quote([id]);
  assert.deepStrictEqual([q1.coupon && q1.coupon.code, q1.coupon && q1.coupon.auto, q1.discount], ['AUTO10', true, 25]);
  assert.strictEqual(q1.total, 250 - 25 + 75);
  // A typed code worth more: it wins.
  await coupon({ code: 'BIG20', value: 20 });
  const q2 = await quote([id], 'BIG20');
  assert.deepStrictEqual([q2.coupon.code, Boolean(q2.coupon.auto), q2.discount, q2.couponError], ['BIG20', false, 50, null]);
  // A typed code worth less: the automatic one stays, and the customer is told why (not a refusal).
  await coupon({ code: 'SMALL5', value: 5 });
  const q3 = await quote([id], 'SMALL5');
  assert.strictEqual(q3.coupon.code, 'AUTO10');
  assert.strictEqual(q3.couponBeaten, true);
  assert.match(q3.couponError, /AUTO10.*saves more than SMALL5/);
  // Ordered with the weaker code typed: the better offer is what the order gets.
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [id], couponCode: 'SMALL5', expectedTotal: q3.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const order = await o.json();
  const saved = savedOrder(order.id);
  assert.deepStrictEqual([saved.coupon.code, saved.coupon.auto, saved.discount, saved.total], ['AUTO10', true, 25, q3.total]);
  // Paused: no longer applied.
  await admin(`/api/admin/coupons/${auto.id}`, 'PUT', { active: false });
  await admin(`/api/admin/coupons/${(await (await admin('/api/admin/coupons', 'GET')).json()).coupons.find((c) => c.code === 'BIG20').id}`, 'PUT', { active: false });
});

test('of several automatic coupons the best value wins, free shipping counted as the shipping it saves; limits still count', async () => {
  const list = (await (await admin('/api/admin/coupons', 'GET')).json()).coupons;
  for (const c of list) if (c.active) await admin(`/api/admin/coupons/${c.id}`, 'PUT', { active: false });
  await coupon({ code: 'SHIPFREE', type: 'freeship', auto: true }); // saves 75 on a 250 mug
  await coupon({ code: 'TEN', value: 10, auto: true }); // saves 25
  const id = await mug();
  const q = await quote([id]);
  assert.deepStrictEqual([q.coupon.code, q.coupon.freeShipping, q.shipping, q.total], ['SHIPFREE', true, 0, 250]);
  // A bigger order: 30% (once per customer) beats free shipping…
  await coupon({ code: 'FORTY', value: 40, auto: true, perCustomer: 1 }); // saves 100
  const q2 = await quote([id]);
  assert.deepStrictEqual([q2.coupon.code, q2.discount], ['FORTY', 100]);
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [id], expectedTotal: q2.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  // …but only once for this phone: the next order from it gets the next best (free shipping, 75).
  const id2 = await mug();
  const q3 = await quote([id2], undefined, CUSTOMER.phone);
  assert.strictEqual(q3.coupon.code, 'SHIPFREE', 'the next best for this phone');
  const o2 = await post('/api/orders', { customer: CUSTOMER, designIds: [id2], expectedTotal: q3.total });
  assert.strictEqual(o2.status, 201, await o2.clone().text());
  assert.strictEqual(savedOrder((await o2.json()).id).coupon.code, 'SHIPFREE');
});

test('the dashboard can turn "apply automatically" on and off', async () => {
  const c = await coupon({ code: 'TOGGLE', value: 3 });
  assert.strictEqual(c.auto, undefined);
  const on = await (await admin(`/api/admin/coupons/${c.id}`, 'PUT', { auto: true })).json();
  assert.strictEqual(on.auto, true);
  const off = await (await admin(`/api/admin/coupons/${c.id}`, 'PUT', { auto: false })).json();
  assert.strictEqual(off.auto, undefined);
});
