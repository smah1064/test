'use strict';

// QA tester 1 (25 Nov, 6:01 pm Cairo): a corrected file racing "Start printing", refused changes half-saving,
// coupons saved whole undoing a colleague's change, "#POD" read backwards in Arabic, raw codes on approval cards,
// and invisible direction marks in team names.
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
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa1801-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0 });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function call(url, method = 'GET', body, token, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text };
}
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { ...rgb, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
async function approvedMug() {
  const created = (await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json;
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await art(MUG.w, MUG.h) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  const d = (await call(`/api/designs/${created.id}/complete`, 'POST', undefined, null, { 'x-upload-token': created.uploadToken })).json;
  const proof = (await call(`/api/designs/${d.id}/proof`)).json;
  const q = (await call('/api/cart/quote', 'POST', { designIds: [d.id] })).json;
  return (await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json;
}

test('a corrected file being saved and "Start printing" at the same moment: the job never prints the old file unseen', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  const replace = call(`/api/admin/items/${it.id}/replacement/front`, 'PUT', await art(MUG.w, MUG.h, { r: 10, g: 10, b: 10 }), owner, { 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent('Darker') });
  const start = call(`/api/admin/items/${it.id}`, 'PATCH', { status: 'printing' }, owner);
  const [r1, r2] = await Promise.all([replace, start]);
  assert.strictEqual(r1.status, 200, r1.text);
  // Either "Start printing" came first (then the replacement was refused, which it wasn't) or it was refused.
  assert.strictEqual(r2.status, 409, r2.text);
  assert.ok(['fileBeingReplaced', 'notApproved'].includes(r2.json.code), r2.json.code);
  const pub = (await call(`/api/orders/${o.id}?k=${o.key}`)).json;
  assert.strictEqual(pub.items[0].status, 'awaiting_approval', 'waits for the customer\'s OK of the new file');
});

test('refused changes keep nothing: a staff name with a refused owner role, a photo order with a bad main photo', async () => {
  // A team member whose password the owner typed can't be made an owner here; the new name isn't kept either.
  const add = await call('/api/admin/staff', 'POST', { name: 'Hala', username: 'hala1801', roles: ['operations'] }, owner);
  assert.strictEqual(add.status, 201, add.text);
  assert.ok([200, 204].includes((await call(`/api/admin/staff/${add.json.id}/password`, 'PUT', { password: 'typed-by-the-owner-1' }, owner)).status));
  const refused = await call(`/api/admin/staff/${add.json.id}`, 'PATCH', { name: 'Hala Renamed', roles: ['owner'] }, owner);
  assert.strictEqual(refused.status, 409);
  const row = (await call('/api/admin/staff', 'GET', undefined, owner)).json.staff.find((u) => u.id === add.json.id);
  assert.strictEqual(row.name, 'Hala');
  // Two photos, then a new order with a main photo that isn't one of them: refused, the order stays.
  const png = (c) => sharp({ create: { width: 400, height: 400, channels: 3, background: c } }).png().toBuffer();
  await call('/api/admin/catalog/notebook/photos', 'POST', await png('#cc3333'), owner, { 'Content-Type': 'image/png' });
  const two = await call('/api/admin/catalog/notebook/photos', 'POST', await png('#3333cc'), owner, { 'Content-Type': 'image/png' });
  const ids = two.json.photos.map((p) => p.id);
  assert.strictEqual(ids.length, 2);
  const bad = await call('/api/admin/catalog/notebook/photos', 'PUT', { order: [...ids].reverse(), main: 'not-a-photo' }, owner);
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual((await call('/api/admin/catalog/notebook', 'GET', undefined, owner)).json.photos.map((p) => p.id), ids);
});

test('coupons: an edit sends what changed and keeps a colleague\'s pause; the list\'s switch changes only on/off', async () => {
  const c = (await call('/api/admin/coupons', 'POST', { code: 'KEEP10', type: 'percent', value: 10, maxUses: 50, note: 'first' }, owner)).json;
  // B pauses it.
  assert.strictEqual((await call(`/api/admin/coupons/${c.id}`, 'PUT', { active: false }, owner)).status, 200);
  // A, on a form opened before, changes only the note.
  const r = await call(`/api/admin/coupons/${c.id}`, 'PUT', { note: 'new note' }, owner);
  assert.strictEqual(r.status, 200, r.text);
  const now = (await call('/api/admin/coupons', 'GET', undefined, owner)).json.coupons.find((x) => x.id === c.id);
  assert.strictEqual(now.active, false, 'still paused');
  assert.strictEqual(now.note, 'new note');
  assert.strictEqual(now.value, 10);
  assert.strictEqual(now.maxUses, 50);
  // A value changed meanwhile isn't undone by the switch.
  assert.strictEqual((await call(`/api/admin/coupons/${c.id}`, 'PUT', { value: 25 }, owner)).status, 200);
  assert.strictEqual((await call(`/api/admin/coupons/${c.id}`, 'PUT', { active: true }, owner)).status, 200);
  const after = (await call('/api/admin/coupons', 'GET', undefined, owner)).json.coupons.find((x) => x.id === c.id);
  assert.strictEqual(after.value, 25);
  assert.strictEqual(after.active, true);
  // Still checked as a whole: a bad change is refused, and a deleted coupon is gone.
  assert.strictEqual((await call(`/api/admin/coupons/${c.id}`, 'PUT', { value: 500 }, owner)).status, 400);
  assert.strictEqual((await call('/api/admin/coupons/no-such-coupon', 'PUT', { note: 'x' }, owner)).status, 404);
});

test('Arabic activity: the order number reads "#POD-…" left to right; team names lose invisible direction marks', async () => {
  const o = await approvedMug();
  assert.strictEqual((await call(`/api/admin/orders/${o.id}/payment`, 'PATCH', { status: 'paid' }, owner)).status, 200);
  const act = (await call('/api/admin/activity', 'GET', undefined, owner)).json;
  const line = (act.entries || act.items || act.activity || []).find((x) => x.summary && /POD-/.test(x.summary.en));
  assert.ok(line, JSON.stringify(Object.keys(act)));
  assert.ok(line.summary.ar.includes(`⁦#${o.number}⁩`), line.summary.ar);
  assert.ok(!line.summary.en.includes('⁦'), 'English as it was');
  const add = await call('/api/admin/staff', 'POST', { name: '‮nimda‬', username: 'bidi1801', roles: ['operations'] }, owner);
  assert.strictEqual(add.status, 201, add.text);
  assert.strictEqual(add.json.user.name, 'nimda');
});
