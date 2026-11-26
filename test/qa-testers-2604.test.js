'use strict';

// Testers' runs at 4 and 5 am Cairo (26 Nov), on the server: a one-letter checkout name is refused (as an account
// refuses it); a sold-out cover names the book in the page's language; a job switched from DTG to DTF says DTF on its
// proof; the activity log says what a price change was; the apps' latest build is never below the oldest allowed;
// a job whose corrected file is being saved on another copy of the app can't start printing there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { Store } = require('../src/store');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], designsAll: [OPEN], bookSaves: [OPEN], orders: [OPEN] };
const CUSTOMER = { name: 'Salma Adel', phone: '01055556666', governorate: 'cairo', city: 'Maadi', address: '3 Street 9' };
let dir;
let A;
let B;
let token = null;
const start = (a) => new Promise((resolve) => { const s = a.listen(0, () => resolve(s)); });
const at = (s) => `http://127.0.0.1:${s.address().port}`;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t-2604-'));
  const opts = { dataDir: dir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 };
  A = await start(createApp(opts));
  B = await start(createApp(opts));
});
test.after(() => {
  A.close();
  B.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const send = (srv, method, url, body, headers = {}) => fetch(at(srv) + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function admin(srv, method, url, body) {
  if (!token) token = (await (await send(A, 'POST', '/api/admin/login', { password: 'secret' })).json()).token;
  return send(srv, method, url, body, { Authorization: `Bearer ${token}` });
}
const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
async function tshirt() {
  const created = await (await send(A, 'POST', '/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    let data = await art(60, 72);
    if (name.endsWith('-print.png')) data = await art(3600, 4800);
    if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.strictEqual((await fetch(`${at(A)}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data })).status, 204);
  }
  return (await fetch(`${at(A)}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
}
async function order(srv, id, customer = CUSTOMER) {
  const proof = await (await send(srv, 'GET', `/api/designs/${id}/proof`)).json();
  const q = await (await send(srv, 'POST', '/api/cart/quote', { designIds: [id] })).json();
  return send(srv, 'POST', '/api/orders', { customer, designIds: [id], expectedTotal: q.total, approvals: { [id]: { proofHash: proof.proofHash } } });
}

test('checkout: a one-letter name is refused (an account needs two letters too)', async () => {
  const d = await tshirt();
  for (const name of ['م', 'A', ' A ']) {
    const r = await order(A, d.id, { ...CUSTOMER, name });
    assert.strictEqual(r.status, 400, name);
    assert.strictEqual((await r.json()).code, 'nameShort', name);
  }
  const ar = await (await fetch(`${at(A)}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ar' }, body: JSON.stringify({ customer: { ...CUSTOMER, name: 'م' }, designIds: [d.id] }) })).json();
  assert.match(ar.error, /حرفين/);
  assert.strictEqual((await order(A, d.id, { ...CUSTOMER, name: 'Mo' })).status, 201);
});

test('kids book: a sold-out cover names the book in the page\'s language (Arabic page, English book)', async () => {
  const face = `data:image/jpeg;base64,${(await sharp({ create: { width: 400, height: 400, channels: 3, background: '#c99' } }).jpeg().toBuffer()).toString('base64')}`;
  new Store(dir).mutate((db) => { db.catalog = { ...(db.catalog || {}), products: { ...((db.catalog || {}).products || {}), storybook: { sizes: { hard: { soldOut: true } } } } }; });
  try {
    const r = await fetch(`${at(A)}/api/books/space-hero/designs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ar' }, body: JSON.stringify({ answers: { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' }, face, size: 'hard', lang: 'en' }) });
    assert.strictEqual(r.status, 409);
    const msg = (await r.json()).error;
    assert.doesNotMatch(msg, /Story Book/, msg);
    assert.match(msg, /[؀-ۿ]/);
  } finally {
    new Store(dir).mutate((db) => { delete db.catalog.products.storybook; });
  }
});

test('a job switched from DTG to DTF: its proof says DTF', async () => {
  const d = await tshirt();
  const o = await (await order(A, d.id)).json();
  const it = o.items[0];
  assert.strictEqual((await admin(A, 'PATCH', `/api/admin/items/${it.id}`, { process: 'dtf' })).status, 200);
  // Sent back to the customer with a note: the proof page they open.
  const r = await admin(A, 'POST', `/api/admin/items/${it.id}/review`, { action: 'reopen', note: 'Check the colours' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const reviewed = await r.json();
  assert.strictEqual(reviewed.proof.process, 'dtf', 'the shop\'s review shows DTF');
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  const saved = db.orders.find((x) => x.id === o.id).items[0];
  assert.strictEqual(saved.process, 'dtf');
  const tok = saved.proofToken || saved.reviseToken;
  if (saved.proofToken) {
    const p = await (await send(A, 'GET', `/api/proofs/${tok}`)).json();
    assert.strictEqual(p.proof.process, 'dtf', 'the customer\'s proof page shows DTF');
  }
});

test('activity log: a selling-price change reads "price old → new", not "(costs)"', async () => {
  const before = (await (await admin(A, 'GET', '/api/admin/pricing')).json());
  const row = (before.products || before.rows || before).find ? (before.products || before.rows || before).find((p) => p.id === 'mug') : null;
  const base = row ? row.basePrice : 150;
  assert.strictEqual((await admin(A, 'PUT', '/api/admin/pricing/mug', { basePrice: base + 10 })).status, 200);
  const entries = (await (await admin(A, 'GET', '/api/admin/activity')).json()).entries || [];
  const e = entries.find((x) => /pricing\/mug/.test(x.path || ''));
  assert.ok(e, 'logged');
  const en = (e.summary && e.summary.en) || '';
  assert.match(en, /price .*→/, en);
  assert.doesNotMatch(en, /\(costs\)/, en);
  await admin(A, 'PUT', '/api/admin/pricing/mug', { basePrice: base });
});

test('phone apps: the latest build is never below the oldest one allowed', async () => {
  fs.writeFileSync(path.join(dir, 'app-config.json'), JSON.stringify({ android: { minBuild: 20000, latestBuild: 10000 } }));
  const c = await (await send(A, 'GET', '/app/config.json')).json();
  assert.strictEqual(c.android.minBuild, 20000);
  assert.strictEqual(c.android.latestBuild, 20000);
  fs.rmSync(path.join(dir, 'app-config.json'), { force: true });
});

test('a corrected file being saved on one copy: "start printing" on the other copy waits', async () => {
  const d = await tshirt();
  const o = await (await order(A, d.id)).json();
  const it = o.items[0];
  // Copy A is saving a corrected file for this job (its lock in the data folder).
  const lock = path.join(dir, 'locks', `replacing-${it.id}`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '99999');
  try {
    const r = await admin(B, 'PATCH', `/api/admin/items/${it.id}`, { status: 'printing' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).code, 'fileBeingReplaced');
  } finally {
    fs.rmSync(lock, { force: true });
  }
  assert.strictEqual((await admin(B, 'PATCH', `/api/admin/items/${it.id}`, { status: 'printing' })).status, 200);
});
