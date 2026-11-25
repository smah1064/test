'use strict';

// An item the customer approved that can't be printed as it is (owner's request, 25 Nov): the team sends it back to
// Review with a reason (only while it waits to print or is on the press). There the shop fixes the file, and the
// customer approves the new proof with a note of what changed, or asks the customer to change it and send it again.
// The customer hears nothing in between, and never sees the team's reason.
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
let token = null;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-sendback-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function admin(url, opts = {}) {
  if (!token) token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  return fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
const adminJson = (url, body, headers = {}) => admin(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { ...rgb, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();

/** A mug the customer approved at checkout: it goes straight to the print queue. */
async function approvedMug() {
  const res = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } });
  const created = await res.json();
  for (const name of created.files) {
    let data = await art(60, 52);
    if (name.endsWith('-print.png')) data = await art(MUG.w, MUG.h);
    if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data })).status, 204);
  }
  const d = await (await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
  const proof = await (await fetch(`${base}/api/designs/${d.id}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json();
  assert.strictEqual(o.items[0].status, 'queued', 'approved: waiting to print');
  return { o, it: o.items[0], d };
}
const setStatus = (itemId, status) => admin(`/api/admin/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
const reviewList = async () => (await (await admin('/api/admin/review')).json()).items;
const reopen = (itemId, note) => adminJson(`/api/admin/items/${itemId}/review`, { action: 'reopen', note });

test('an approved job goes back to Review with the team\'s reason; the customer sees no reason and hears nothing', async () => {
  const { o, it } = await approvedMug();
  // A reason is required.
  const none = await reopen(it.id, '  ');
  assert.strictEqual(none.status, 400);
  const r = await reopen(it.id, 'The logo is too close to the handle.');
  assert.strictEqual(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.strictEqual(body.status, 'review');
  assert.deepStrictEqual(body.warnings, []);
  const rv = (await reviewList()).find((x) => x.id === it.id);
  assert.ok(rv, 'in Review');
  assert.ok(rv.review.reasons.includes('reopened'));
  assert.strictEqual(rv.review.reopenReason, 'The logo is too close to the handle.');
  // The customer's order page: being checked, without the team's reason anywhere.
  const pub = await (await fetch(`${base}/api/orders/${o.id}?k=${o.key}`)).json();
  assert.strictEqual(pub.items[0].status, 'review');
  assert.ok(!JSON.stringify(pub).includes('too close to the handle'), 'the reason stays with the team');
  assert.ok(!pub.items[0].review.reasons.includes('reopened'));
  // Not in the print queue any more.
  const q = await (await admin('/api/admin/queue')).json();
  assert.ok(![...q.printing, ...q.waiting].some((x) => x.id === it.id));
  // The shop decides it can print after all: approve, and it is back in the queue (the customer approved these files).
  const back = await adminJson(`/api/admin/items/${it.id}/review`, { action: 'approve' });
  assert.strictEqual((await back.json()).status, 'queued');
});

test('fixed by the shop: the new file goes to the customer with a note of what changed, and prints only once approved', async () => {
  const { o, it, d } = await approvedMug();
  assert.strictEqual((await reopen(it.id, 'Text too thin for a mug.')).status, 200);
  const note = 'We made the text thicker so it prints clearly — الخط بقى أتقل';
  const rep = await admin(`/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent(note) }, body: await art(MUG.w, MUG.h, { r: 10, g: 10, b: 10 }) });
  assert.strictEqual(rep.status, 200, await rep.clone().text());
  const after = await rep.json();
  assert.strictEqual(after.status, 'awaiting_approval');
  // The proof page shows the note; the history has it too.
  const t = after.proofLink.split('t=')[1];
  const proof = await (await fetch(`${base}/api/proofs/${t}`)).json();
  assert.strictEqual(proof.note, note);
  const pub = await (await fetch(`${base}/api/orders/${o.id}?k=${o.key}`)).json();
  assert.strictEqual(pub.items[0].approvals.at(-1).note, note);
  // Nothing prints from the new file until the customer approves it.
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).status, 409);
  const p2 = await (await fetch(`${base}/api/designs/${d.id}/proof`)).json();
  const yes = await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: p2.proofHash });
  assert.strictEqual((await yes.json()).status, 'queued');
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).status, 200);
});

test('or the customer is asked to change it: their edit link is ready to send', async () => {
  const { it } = await approvedMug();
  assert.strictEqual((await reopen(it.id, 'Photo too blurry at this size.')).status, 200);
  const ch = await adminJson(`/api/admin/items/${it.id}/review`, { action: 'changes', note: 'Please send a sharper photo.' });
  assert.strictEqual(ch.status, 200);
  const rv = (await reviewList()).find((x) => x.id === it.id);
  assert.strictEqual(rv.status, 'changes_requested');
  assert.match(rv.reviseLink, /^\/editor\?design=.+&rt=/);
});

test('only while it waits to print or is on the press; the press and printing houses are warned about', async () => {
  const { it } = await approvedMug();
  // On the press: can be sent back.
  assert.strictEqual((await setStatus(it.id, 'printing')).status, 200);
  // Sent to a printing house by WhatsApp first: the answer says so (to stop it there).
  const house = await (await adminJson('/api/admin/houses', { name: 'Cairo Mugs', whatsapp: '01001234567', prefer: 'whatsapp' })).json();
  assert.strictEqual((await adminJson(`/api/admin/items/${it.id}/send`, { houseId: house.id, channel: 'whatsapp', formats: ['png'] })).status, 200);
  const r = await (await reopen(it.id, 'Wrong colour profile.')).json();
  assert.strictEqual(r.status, 'review');
  assert.deepStrictEqual(r.warnings.map((w) => [w.kind, w.house]), [['house', 'Cairo Mugs']]);
  // Printed: too late to send back here.
  const other = await approvedMug();
  assert.strictEqual((await setStatus(other.it.id, 'printing')).status, 200);
  assert.strictEqual((await setStatus(other.it.id, 'printed')).status, 200);
  const late = await reopen(other.it.id, 'Too late?');
  assert.strictEqual(late.status, 409);
  assert.strictEqual((await late.json()).code, 'reopenNotNow');
});
