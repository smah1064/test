'use strict';

// Findings of the security test round (24 Nov): slow patterns, disk filling, leaks and lock-outs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { pageImages } = require('../src/importer');
const { sanitizeSvg } = require('../src/security');

let server;
let base;
let dataDir;
const OPEN = { max: 1e6, ms: 1000 };
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-secqa-'));
  const app = createApp({ dataDir, adminPassword: 'Str0ng!Passw0rd-2026', limits: { designs: [OPEN], orders: [OPEN], accountSignup: [OPEN] }, cleanupEvery: 0, requireApproval: false, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
async function mug() {
  const created = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await art(1200, 1050) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  return (await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
}
const CUSTOMER = { name: 'Test', phone: '01022223333', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' };

test('crafted pages and SVGs are read in linear time (no freezing the shop)', () => {
  for (const html of ['<script application/ld+json'.repeat(110000), '<meta property=x '.repeat(150000), '<title'.repeat(400000), '<img src=a '.repeat(250000)]) {
    const t = Date.now();
    pageImages(html, 'https://shop.example/p');
    assert.ok(Date.now() - t < 1500, `page took ${Date.now() - t} ms`);
  }
  const ok = pageImages('<title>T</title><meta property="og:title" content="Mug"><script type="application/ld+json">{"image":"https://cdn.example/a.jpg"}</script>', 'https://shop.example/p');
  assert.strictEqual(ok.title, 'Mug');
  assert.deepStrictEqual(ok.images, ['https://cdn.example/a.jpg']);
  for (const svg of ['<text>' + 'url('.repeat(160000) + '</text>', '<style>' + '@import '.repeat(100000) + '</style>']) {
    const t = Date.now();
    sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`);
    assert.ok(Date.now() - t < 1500, `svg took ${Date.now() - t} ms`);
  }
  const clean = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(#g);b:url(http://evil/x)} @import url(http://evil/a.css);</style></svg>');
  assert.match(clean, /url\(#g\)/);
  assert.doesNotMatch(clean, /evil|@import/);
});

test('a design id does not lead to its order; order again is limited per order', async () => {
  const d = await mug();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total })).json();
  const q2 = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(q2.items[0].ordered, true);
  assert.ok(!JSON.stringify(q2).includes(o.id), 'the quote does not name the order');
  const got = await (await fetch(`${base}/api/designs/${d.id}`)).json();
  assert.ok(!JSON.stringify(got).includes(o.id), 'the design does not name the order');
  const codes = [];
  // (6 an hour: items can be ordered again one by one.)
  for (let i = 0; i < 7; i++) codes.push((await post(`/api/orders/${o.id}/reorder?k=${o.key}`, {})).status);
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 200, 429]);
});

test('sign-in locks say nothing about which accounts exist; a known admin browser is never locked out by others', async () => {
  // A number with no account locks after the same number of wrong passwords as a real one.
  const unknown = [];
  for (let i = 0; i < 11; i++) unknown.push((await post('/api/account/login', { login: '01099998888', password: 'wrong-' + i }, { 'X-Forwarded-For': `198.51.100.${i}` })).status);
  assert.strictEqual(unknown[unknown.length - 1], 429);
  // Admin: sign in once (this browser gets the mark), then 50 wrong passwords from everywhere.
  const pw = 'Str0ng!Passw0rd-2026';
  const first = await post('/api/admin/login', { password: pw }, { 'X-Forwarded-For': '203.0.113.1' });
  assert.strictEqual(first.status, 200);
  const mark = (first.headers.get('set-cookie') || '').match(/pod-admin-device=[^;]+/)[0];
  for (let i = 0; i < 50; i++) await post('/api/admin/login', { password: 'guess' + i }, { 'X-Forwarded-For': `192.0.2.${i % 10}` });
  assert.strictEqual((await post('/api/admin/login', { password: pw }, { 'X-Forwarded-For': '203.0.113.9' })).status, 429, 'a new browser is locked');
  assert.strictEqual((await post('/api/admin/login', { password: pw }, { 'X-Forwarded-For': '203.0.113.9', cookie: mark })).status, 200, 'the known browser is not');
  assert.strictEqual((await post('/api/admin/login', { password: pw }, { 'X-Forwarded-For': '203.0.113.9', cookie: 'pod-admin-device=zz.forged' })).status, 429, 'a forged mark is not');
});

test('coupon codes that do not work are limited per visitor', async () => {
  const d = await mug();
  const codes = [];
  for (let i = 0; i < 17; i++) codes.push((await post('/api/cart/quote', { designIds: [d.id], couponCode: 'GUESS' + i }, { 'X-Forwarded-For': '198.18.0.7' })).status);
  assert.strictEqual(codes[0], 200);
  assert.strictEqual(codes[16], 429);
  assert.strictEqual((await post('/api/cart/quote', { designIds: [d.id] }, { 'X-Forwarded-For': '198.18.0.7' })).status, 200, 'prices without a code still work');
});
