'use strict';

// "Save for later" in the cart: kept on the account with the cart, and the latest move wins across devices.
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-later-'));
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

const putRaw = (who, body) => fetch(base + '/api/account/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: who.cookie, 'X-Account': who.id }, body: JSON.stringify(body) });

test('items saved for later stay on the account, apart from the cart, and the latest move wins', async () => {
  const me = await signUp('01055550001');
  const [a, b] = [await mug(), await mug()];
  // Phone: both in the cart, then b saved for later.
  let r = await putRaw(me, { items: [{ designId: a.id }, { designId: b.id, later: true, movedAt: '2026-11-24T10:00:00Z' }], base: [] });
  assert.strictEqual(r.status, 200, await r.clone().text());
  let items = (await (await getCart(me)).json()).items;
  assert.deepStrictEqual(items.map((i) => [i.designId, Boolean(i.later)]), [[a.id, false], [b.id, true]]);
  assert.strictEqual(items[1].movedAt, '2026-11-24T10:00:00.000Z');
  // Laptop with an old page (b still in its cart, never moved): the phone's move is kept.
  r = await putRaw(me, { items: [{ designId: a.id }, { designId: b.id }], base: [a.id, b.id] });
  items = (await r.json()).items;
  assert.strictEqual(items.find((i) => i.designId === b.id).later, true);
  // Laptop moves it back later: that newer move wins.
  r = await putRaw(me, { items: [{ designId: a.id }, { designId: b.id, movedAt: '2026-11-24T11:00:00Z' }], base: [a.id, b.id] });
  items = (await r.json()).items;
  assert.ok(!items.find((i) => i.designId === b.id).later);
  // Junk in the flag is ignored.
  r = await putRaw(me, { items: [{ designId: a.id, later: 'yes', movedAt: 'not a date' }], base: [a.id, b.id] });
  items = (await r.json()).items;
  assert.ok(!items[0].later && !items[0].movedAt);
});
