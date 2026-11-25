'use strict';

// The shop edits the customer's design itself (owner's request, 25 Nov): from Review, the job's design opens in the
// shop's editor; the new version goes to the customer for approval with a note of what changed, or is printed
// without asking with a note of why, which is an owner's decision (held in Approvals when anyone else asks).
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
let ops;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shopedit-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0 });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
  assert.strictEqual((await call('/api/admin/staff', 'POST', { name: 'Ops', username: 'opsedit', roles: ['operations'], password: 'operations-pass-26' }, owner)).status, 201);
  ops = (await call('/api/admin/login', 'POST', { username: 'opsedit', password: 'operations-pass-26' })).json.token;
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
  return { status: r.status, json, text };
}
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { ...rgb, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
async function mugDesign(text = 'Hi', rgb, productId = 'mug') {
  const created = (await call('/api/designs', 'POST', { productId, color: 'white', size: productId === 'mug' ? '11oz' : undefined, sides: { front: { editor: { objects: [{ type: 'i-text', text }] } } } })).json;
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await art(MUG.w, MUG.h, rgb) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52, rgb);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  return (await call(`/api/designs/${created.id}/complete`, 'POST', undefined, null, { 'x-upload-token': created.uploadToken })).json;
}
async function sentBack() {
  const d = await mugDesign();
  const proof = (await call(`/api/designs/${d.id}/proof`)).json;
  const q = (await call('/api/cart/quote', 'POST', { designIds: [d.id] })).json;
  const o = (await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json;
  const it = o.items[0];
  assert.strictEqual(it.status, 'queued');
  const back = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: 'The text is too close to the handle' }, owner);
  assert.strictEqual(back.status, 200, back.text);
  return { o, it, d };
}
const pub = async (o) => (await call(`/api/orders/${o.id}?k=${o.key}`)).json.items[0];

test('edited by the shop and sent to the customer: a new version to approve, with the note of what changed', async () => {
  const { o, it, d } = await sentBack();
  const nd = await mugDesign('Hi there', { r: 20, g: 120, b: 20 });
  const r = await call(`/api/admin/items/${it.id}/shop-edit`, 'POST', { designId: nd.id, baseDesignId: d.id, note: 'Moved the text 1 cm away from the handle' }, ops);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.status, 'awaiting_approval');
  assert.ok(r.json.proofLink);
  const p = await pub(o);
  assert.strictEqual(p.status, 'awaiting_approval');
  assert.strictEqual(p.designId, nd.id);
  assert.strictEqual(p.price, it.price, 'the price agreed at checkout');
  assert.strictEqual(p.review.note, 'Moved the text 1 cm away from the handle');
  const edited = p.approvals.find((a) => a.action === 'edited');
  assert.ok(edited && edited.note && !edited.name, JSON.stringify(edited));
  // The customer approves the new version from the proof link.
  const t = r.json.proofLink.split('t=')[1];
  const view = (await call(`/api/proofs/${t}`)).json;
  assert.strictEqual(view.proof.version, 2);
  const yes = await call(`/api/proofs/${t}`, 'POST', { decision: 'approve', proofHash: view.proof.proofHash });
  assert.strictEqual(yes.status, 200, yes.text);
  assert.strictEqual((await pub(o)).status, 'queued');
});

test('printed without asking: an owner\'s at once; anyone else\'s waits for an owner, then prints', async () => {
  // The owner.
  const a = await sentBack();
  const n1 = await mugDesign('Fixed', { r: 0, g: 0, b: 160 });
  const r1 = await call(`/api/admin/items/${a.it.id}/shop-edit/print`, 'POST', { designId: n1.id, baseDesignId: a.d.id, note: 'Only moved it 1 cm; the customer agreed by phone' }, owner);
  assert.strictEqual(r1.status, 200, r1.text);
  const p1 = await pub(a.o);
  assert.strictEqual(p1.status, 'queued');
  assert.strictEqual(p1.designId, n1.id);
  assert.strictEqual(p1.approval.by, 'shop');
  assert.ok(!('decidedBy' in p1.approval), 'the team\'s names stay the team\'s');
  assert.ok(!JSON.stringify(p1.approvals).includes('agreed by phone'), 'the team\'s reason stays the team\'s');
  assert.ok(!JSON.stringify(p1).includes('agreed by phone'));
  // Operations: held for an owner; the job stays in Review, marked.
  const b = await sentBack();
  const n2 = await mugDesign('Fixed 2', { r: 0, g: 140, b: 160 });
  const held = await call(`/api/admin/items/${b.it.id}/shop-edit/print`, 'POST', { designId: n2.id, baseDesignId: b.d.id, note: 'Colour corrected only' }, ops);
  assert.strictEqual(held.status, 202, held.text);
  assert.strictEqual((await pub(b.o)).status, 'review');
  const rv = (await call('/api/admin/review', 'GET', undefined, owner)).json.items.find((x) => x.id === b.it.id);
  assert.ok(rv.shopEditWaiting, 'the Review card says an owner is asked');
  const list = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals;
  const card = list.find((x) => x.id === (held.json.approval || held.json).id);
  assert.ok(/Colour corrected only/.test(card.summary.en), card.summary.en);
  assert.ok(card.pics && card.pics.length === 2, JSON.stringify(card.pics));
  const ok = await call(`/api/admin/approvals/${card.id}/approve`, 'POST', {}, owner);
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.approval.status, 'approved', JSON.stringify(ok.json.approval));
  const p2 = await pub(b.o);
  assert.strictEqual(p2.status, 'queued');
  assert.strictEqual(p2.designId, n2.id);
  const adm = (await call('/api/admin/orders', 'GET', undefined, owner)).json;
  const ai = (adm.orders || adm).find((x) => x.id === b.o.id).items[0];
  assert.ok(ai.approval.decidedBy, 'the owner who decided is kept for the team');
});

test('refused: no note, an old version, another product, a job not in Review, a waiting edit gone stale', async () => {
  const { it, d } = await sentBack();
  const nd = await mugDesign('X');
  assert.strictEqual((await call(`/api/admin/items/${it.id}/shop-edit`, 'POST', { designId: nd.id, baseDesignId: d.id, note: ' ​ ' }, ops)).json.code, 'shopEditNoteNeeded');
  assert.strictEqual((await call(`/api/admin/items/${it.id}/shop-edit`, 'POST', { designId: nd.id, baseDesignId: nd.id, note: 'x' }, ops)).json.code, 'shopEditStale');
  // (Another product's design: refused.)
  const other = (await call('/api/designs', 'POST', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'T' }] } } } })).json;
  assert.ok((await call(`/api/admin/items/${it.id}/shop-edit`, 'POST', { designId: other.id, baseDesignId: d.id, note: 'x' }, ops)).status >= 400);
  // Held for an owner, then the job moves on (approved as it was): the waiting edit fails with its reason.
  const held = await call(`/api/admin/items/${it.id}/shop-edit/print`, 'POST', { designId: nd.id, baseDesignId: d.id, note: 'small fix' }, ops);
  assert.strictEqual(held.status, 202, held.text);
  assert.strictEqual((await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'approve' }, owner)).status, 200);
  const late = await call(`/api/admin/approvals/${(held.json.approval || held.json).id}/approve`, 'POST', {}, owner);
  assert.ok(late.json.approval ? late.json.approval.status === 'failed' : late.status >= 400, late.text);
  // Not in Review any more: refused.
  assert.strictEqual((await call(`/api/admin/items/${it.id}/shop-edit`, 'POST', { designId: nd.id, baseDesignId: d.id, note: 'x' }, owner)).json.code, 'notInReview');
});
