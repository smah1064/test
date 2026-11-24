'use strict';

// Sign-out ends the session on the server; old drafts are forgotten; the shop's revision message.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const notify = require('../src/notify');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN], draftSave: [OPEN] };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-signout-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const who = async (cookie) => (await (await fetch(base + '/api/account', { headers: { cookie } })).json()).customer;

test('signing out ends that session on the server: a copied cookie stops working, other devices stay signed in', async () => {
  const up = await post('/api/account/signup', { name: 'Salma', phone: '01055556666', password: 'a-long-password-1' });
  assert.strictEqual(up.status, 201, await up.clone().text());
  const phone = up.headers.get('set-cookie').split(';')[0];
  await new Promise((r) => setTimeout(r, 1100)); // a separate sign-in (tokens are per second)
  const login = await post('/api/account/login', { login: '01055556666', password: 'a-long-password-1' });
  assert.strictEqual(login.status, 200, await login.clone().text());
  const laptop = login.headers.get('set-cookie').split(';')[0];
  assert.ok(await who(phone));
  const copy = phone; // someone copied the phone's cookie before sign-out
  const out = await post('/api/account/logout', {}, { cookie: phone });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(await who(copy), null, 'the copied cookie no longer works');
  assert.strictEqual((await fetch(base + '/api/account/cart', { headers: { cookie: copy } })).status, 401);
  assert.ok(await who(laptop), 'the laptop stays signed in');
  // Signing out again with the dead cookie, or with none, is harmless.
  assert.strictEqual((await post('/api/account/logout', {}, { cookie: copy })).status, 200);
  assert.strictEqual((await post('/api/account/logout', {})).status, 200);
});

test('drafts not touched for 120 days are forgotten on the next save', async () => {
  const up = await post('/api/account/signup', { name: 'Nour', phone: '01077778888', password: 'a-long-password-1' });
  const cookie = up.headers.get('set-cookie').split(';')[0];
  const id = (await up.json()).customer.id;
  const save = (pid) => fetch(`${base}/api/account/drafts/${pid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ designs: { front: { objects: [] } } }) });
  assert.strictEqual((await save('mug')).status, 200);
  assert.strictEqual((await save('tshirt')).status, 200);
  const idxFile = path.join(dataDir, 'accounts', id, 'drafts', 'index.json');
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  idx.mug.savedAt = new Date(Date.now() - 121 * 86400e3).toISOString();
  fs.writeFileSync(idxFile, JSON.stringify(idx));
  assert.strictEqual((await save('hoodie')).status, 200);
  const after = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  assert.deepStrictEqual(Object.keys(after).sort(), ['hoodie', 'tshirt']);
  assert.ok(!fs.existsSync(path.join(dataDir, 'accounts', id, 'drafts', 'mug.json')));
});

test('the shop is told when a customer sends a new version', () => {
  const order = { number: 'EB-1042', items: [{ id: 'a', productName: { ar: 'مج', en: 'Mug' } }, { id: 'b', productName: { ar: 'تيشيرت', en: 'T-shirt' } }] };
  const en = notify.revisionText(order, order.items[1], { admin: 'https://ebda3.me/admin' }, 'en');
  assert.match(en, /EB-1042/);
  assert.match(en, /item 2 \(T-shirt\)/);
  assert.match(en, /https:\/\/ebda3\.me\/admin/);
  const ar = notify.revisionText(order, order.items[0], { admin: '' }, 'ar');
  assert.match(ar, /مج/);
  assert.match(ar, /نسخة جديدة/);
  assert.doesNotMatch(ar, /undefined|https/);
});
