'use strict';

// The cart on the customer's account: kept as design ids, rebuilt from the designs, private to the account.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN], draftSave: [OPEN] };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-acart-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false, captcha: null });
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
async function signUp(phone) {
  const r = await post('/api/account/signup', { name: 'Salma', phone, password: 'a-long-password-1' });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const me = (await r.json()).customer;
  return { id: me.id, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const getCart = (who) => fetch(base + '/api/account/cart', { headers: { cookie: who.cookie } });
const putCart = (who, items, account = who.id) => fetch(base + '/api/account/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: who.cookie, 'X-Account': account }, body: JSON.stringify({ items }) });

test('the cart follows the account: ids only, rebuilt from the designs, private, ordered items drop out', async () => {
  assert.strictEqual((await fetch(base + '/api/account/cart')).status, 401, 'signed out');
  const salma = await signUp('01011112222');
  const other = await signUp('01033334444');
  const [a, b] = [await mug(), await mug()];
  assert.deepStrictEqual((await (await getCart(salma)).json()).items, []);

  // Junk, duplicates and made-up prices are ignored: entries come from the designs.
  const put = await putCart(salma, [
    { designId: a.id, addedAt: '2026-11-24T10:00:00Z', price: 1 },
    { designId: b.id, addedAt: '2026-11-24T10:05:00Z' },
    { designId: a.id },
    { designId: '00000000-0000-4000-8000-000000000000' },
    { designId: '../../etc' },
    null,
  ]);
  assert.strictEqual(put.status, 200, await put.clone().text());
  const got = await getCart(salma);
  assert.strictEqual(got.headers.get('x-account'), salma.id);
  const items = (await got.json()).items;
  assert.deepStrictEqual(items.map((i) => i.designId), [a.id, b.id]);
  assert.strictEqual(items[0].price, a.price);
  assert.match(items[0].previewUrl, new RegExp(`/files/designs/${a.id}/`));
  assert.strictEqual(items[0].addedAt, '2026-11-24T10:00:00.000Z');

  // Another customer sees only their own (empty) cart, and can't write Salma's.
  assert.deepStrictEqual((await (await getCart(other)).json()).items, []);
  assert.strictEqual((await putCart(other, [{ designId: a.id }], salma.id)).status, 409);
  assert.deepStrictEqual((await (await getCart(salma)).json()).items.map((i) => i.designId), [a.id, b.id]);

  // Ordered (here or on another device): gone from the account's cart.
  const q = await (await post('/api/cart/quote', { designIds: [a.id] })).json();
  const o = await post('/api/orders', { customer: { name: 'Salma', phone: '01011112222', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' }, designIds: [a.id], expectedTotal: q.total }, { cookie: salma.cookie });
  assert.strictEqual(o.status, 201, await o.clone().text());
  assert.deepStrictEqual((await (await getCart(salma)).json()).items.map((i) => i.designId), [b.id]);
  assert.strictEqual((await (await putCart(salma, [{ designId: a.id }, { designId: b.id }])).json()).items.length, 1, 'an ordered design is not kept');
});
