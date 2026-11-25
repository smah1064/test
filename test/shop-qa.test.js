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

test('accounts: correct sign-ins never lock the owner out; text-only names; clearing the address; drafts name the account', async () => {
  const user = { name: 'Sara Ali', phone: '01033344455', password: 'a-long-password-1' };
  const up = await post('/api/account/signup', user);
  assert.strictEqual(up.status, 201, await up.clone().text());
  for (let i = 0; i < 14; i++) {
    const r = await post('/api/account/login', { login: user.phone, password: user.password }, { 'X-Forwarded-For': `10.9.0.${i}` });
    assert.strictEqual(r.status, 200, `sign-in ${i + 1}`);
  }
  assert.strictEqual((await post('/api/account/signup', { name: { a: 1 }, phone: '01033344466', password: 'a-long-password-1' })).status, 400);
  const login = await post('/api/account/login', { login: user.phone, password: user.password });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = (await login.json()).customer;
  const put = (body) => fetch(base + '/api/account', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.strictEqual((await put({ name: 'Sara Ali', address: { governorate: 'cairo', city: 'Nasr', address: '1 st' } })).status, 200);
  const cleared = await (await put({ name: 'Sara Ali', address: { governorate: '', city: '', address: '' } })).json();
  assert.strictEqual(cleared.customer.address, null);
  const draft = await fetch(base + '/api/account/drafts/tshirt', { headers: { cookie } });
  assert.strictEqual(draft.status, 204, 'no draft: an empty answer');
  assert.strictEqual(draft.headers.get('x-account'), me.id);
});

test('share link previews use the shop address, not the Host header', async () => {
  const pic = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#c33' } }).png().toBuffer();
  const sh = await post('/api/shares', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { objects: [{ type: 'i-text', text: 'x' }] } }, previews: { front: `data:image/png;base64,${pic.toString('base64')}` } });
  assert.strictEqual(sh.status, 201, await sh.clone().text());
  const { id } = await sh.json();
  const html = await (await fetch(`${base}/s/${id}`, { headers: { Host: 'evil.example', 'X-Forwarded-Proto': 'https' } })).text();
  assert.doesNotMatch(html, /evil\.example/);
});

test('an order sent again with its one-time key gives the same order (the first answer got lost)', async () => {
  const d = await makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const key = 'k-0123456789abcdef-retry';
  const body = { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, orderKey: key };
  const first = await post('/api/orders', body);
  assert.strictEqual(first.status, 201);
  const o1 = await first.json();
  const again = await post('/api/orders', body);
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await again.json()).id, o1.id);
  const found = await fetch(`${base}/api/orders/by-key/${key}`);
  assert.strictEqual(found.status, 200);
  const o2 = await found.json();
  assert.strictEqual(o2.id, o1.id);
  assert.strictEqual(o2.orderKey, undefined, 'the key is not shown back');
  assert.strictEqual((await fetch(`${base}/api/orders/by-key/k-not-a-real-key-000000`)).status, 204, 'not placed: an empty answer');
  assert.strictEqual((await fetch(`${base}/api/orders/by-key/short`)).status, 204);
});

test('QA batch: sign-in limits count wrong passwords only; drafts saved for another account are refused; ordered items and sample days in the quote', async () => {
  const user = { name: 'Nour Ali', phone: '01077788899', password: 'a-long-password-1' };
  assert.strictEqual((await post('/api/account/signup', user)).status, 201);
  // 12 correct sign-ins from one address: never locked.
  for (let i = 0; i < 12; i++) assert.strictEqual((await post('/api/account/login', { login: user.phone, password: user.password }, { 'X-Forwarded-For': '10.7.7.7' })).status, 200, `sign-in ${i + 1}`);
  const login = await post('/api/account/login', { login: user.phone, password: user.password });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = (await login.json()).customer;
  const put = (who) => fetch(base + '/api/account/drafts/tshirt', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie, ...(who ? { 'X-Account': who } : {}) }, body: JSON.stringify({ designs: { front: [] }, savedAt: new Date().toISOString() }) });
  assert.strictEqual((await put('someone-else')).status, 409);
  assert.ok([200, 204].includes((await put(me.id)).status));
  // An ordered design in the cart: the quote says which order it went into.
  const d = await makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total })).json();
  const q2 = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(q2.items[0].gone, true);
  assert.strictEqual(q2.items[0].ordered, true);
  assert.strictEqual(q2.items[0].orderedIn, undefined, 'a design id must not lead to its order');
  // A sample first: the expected day moves two business days.
  const plain = await (await post('/api/cart/quote', { designIds: [d.id], delivery: 'express' })).json();
  const sample = await (await post('/api/cart/quote', { designIds: [d.id], delivery: 'express', sample: true })).json();
  assert.ok(sample.delivery.by > plain.delivery.by, `${sample.delivery.by} after ${plain.delivery.by}`);
  assert.strictEqual(sample.delivery.sampleDays, 2);
});

test('QA batch: phone marks and dashes, +20 customer search, money in messages', async () => {
  for (const v of ['؜01012345678', '010–1234—5678', '010‑1234−5678']) assert.strictEqual(normalizeEgyptMobile(v), '01012345678', JSON.stringify(v));
  const { format } = require('../src/i18n');
  assert.match(format('couponMinOrder', { amount: 1000 }, 'en'), /EGP\s?1,000/);
  assert.match(format('couponMinOrder', { amount: 1000 }, 'ar'), /١٬?٠٠٠/);
  token = token || (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  assert.strictEqual((await post('/api/account/signup', { name: 'Search Me', phone: '01005556677', password: 'a-long-password-1' })).status, 201);
  const found = await (await fetch(`${base}/api/admin/customers?q=${encodeURIComponent('+20 100 555 6677')}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.ok((found.customers || []).some((c) => c.phone === '01005556677'));
});

test('the cart price check looks at a few phone numbers a day per visitor, not any number (coupon use stays private)', async () => {
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  assert.strictEqual((await post('/api/admin/coupons', { code: 'ONLYONCE', type: 'fixed', value: 20, perCustomer: 1 }, { Authorization: `Bearer ${token}` })).status, 201);
  const mk = () => makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  const used = '01055500011';
  const d1 = await mk();
  const q1 = await (await post('/api/cart/quote', { designIds: [d1.id], couponCode: 'ONLYONCE' }, { 'X-Forwarded-For': '10.77.0.1' })).json();
  assert.strictEqual((await post('/api/orders', { customer: { ...CUSTOMER, phone: used }, designIds: [d1.id], couponCode: 'ONLYONCE', expectedTotal: q1.total }, { 'X-Forwarded-For': '10.77.0.1' })).status, 201);
  const d2 = await mk();
  const ask = (phone) => post('/api/cart/quote', { designIds: [d2.id], couponCode: 'ONLYONCE', phone }, { 'X-Forwarded-For': '10.77.0.9' }).then((r) => r.json());
  // Three other numbers, then the used one: no longer looked at for this visitor (the quote can't tell).
  for (const p of ['01055500021', '01055500022', '01055500023']) assert.strictEqual((await ask(p)).discount, 20);
  assert.strictEqual((await ask(used)).discount, 20);
  // The order still refuses it.
  const o = await post('/api/orders', { customer: { ...CUSTOMER, phone: used }, designIds: [d2.id], couponCode: 'ONLYONCE', expectedTotal: (await ask(used)).total }, { 'X-Forwarded-For': '10.77.0.9' });
  assert.strictEqual(o.status, 409);
});
