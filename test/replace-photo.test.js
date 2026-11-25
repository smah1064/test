'use strict';

// "Problem with this file?" on photo prints and kids' books (not made in the editor; owner's decision, 25 Nov): the
// team puts in a better photo in Review, with a note of what changed, and the customer approves the new proof.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-rphoto-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], books: [OPEN] }, cleanupEvery: 0, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, headers: { Authorization: `Bearer ${owner}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const jpeg = (w, h, rgb = '#3a7bd5') => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg({ quality: 80 }).toBuffer();
const prod = PRODUCTS.find((p) => p.id === 'photoprints');
const px = (cm) => Math.round((cm / 2.54) * prod.photo.dpi);
const sizeCm = (id) => prod.sizes.find((z) => z.id === id).cm;

async function order(designId) {
  const proof = await (await fetch(`${base}/api/designs/${designId}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [designId] })).json();
  const r = await post('/api/orders', { customer: CUSTOMER, designIds: [designId], expectedTotal: q.total, approvals: { [designId]: { proofHash: proof.proofHash } } });
  assert.strictEqual(r.status, 201, await r.clone().text());
  return r.json();
}
async function sendBack(it) {
  const r = await admin(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: 'Photo too blurry to print' });
  assert.strictEqual(r.status, 200, await r.text());
}
const replace = (it, n, body, note = 'Sharper photo from the customer') => admin(`/api/admin/items/${it.id}/photo/${n}`, 'PUT', body, { 'Content-Type': 'image/jpeg', ...(note ? { 'x-review-note': encodeURIComponent(note) } : {}) });

test('photo prints: one photo replaced (cut to its print size), the customer approves the new proof', async () => {
  const photos = [{ size: '10x15', copies: 2, orientation: 'portrait' }, { size: '13x18', copies: 1, orientation: 'landscape' }];
  const c = await (await post('/api/photosets', { color: 'gloss', photos })).json();
  for (const name of c.files) {
    const i = Number(name.match(/(\d{3})/)[1]) - 1;
    const [a, b] = sizeCm(photos[i].size).map(px);
    const data = name.startsWith('photo-') ? await jpeg(...(photos[i].orientation === 'landscape' ? [b, a] : [a, b])) : await jpeg(200, 300);
    await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
  }
  assert.strictEqual((await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } })).status, 200);
  const o = await order(c.id);
  const it = o.items[0];
  await sendBack(it);
  // Refused: no note, not a picture, no such photo.
  assert.strictEqual((await (await replace(it, 1, await jpeg(1000, 1500), '')).json()).code, 'photoNoteNeeded');
  assert.strictEqual((await replace(it, 1, Buffer.from('not a picture at all, just some text bytes'))).status, 400);
  assert.strictEqual((await replace(it, 9, await jpeg(1000, 1500))).status, 404);
  // A landscape photo for a portrait print: filled to its size.
  const r = await replace(it, 1, await jpeg(2400, 1600, '#cc3300'));
  assert.strictEqual(r.status, 200, await r.clone().text());
  const rv = await r.json();
  assert.strictEqual(rv.status, 'awaiting_approval');
  assert.ok(rv.proofLink);
  const file = path.join(dataDir, 'files', c.id, 'photo-001.jpg');
  const meta = await sharp(file).metadata();
  const [a, b] = sizeCm('10x15').map(px);
  assert.deepStrictEqual([meta.width, meta.height], [a, b], 'its print size');
  assert.ok(fs.existsSync(path.join(dataDir, 'files', c.id, 'photo-001.v1.jpg')), 'the old photo is kept');
  // The customer's proof link: the new version, with the note; approving queues it.
  const t = rv.proofLink.split('t=')[1];
  const view = await (await fetch(`${base}/api/proofs/${t}`)).json();
  assert.strictEqual(view.proof.version, 2);
  assert.match(view.note, /Sharper photo/);
  const yes = await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: view.proof.proofHash });
  assert.strictEqual(yes.status, 200, await yes.clone().text());
  // On the press: no more replacing.
  assert.strictEqual((await admin(`/api/admin/items/${it.id}`, 'PATCH', { status: 'printing' })).status, 200);
  assert.strictEqual((await replace(it, 2, await jpeg(1000, 1500))).status, 409);
});

test('kids\' book: the child\'s photo replaced; the drawings are made again from it; the customer approves', async () => {
  const faceUrl = 'data:image/jpeg;base64,' + (await jpeg(400, 400, '#c99')).toString('base64');
  const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
  const res = await post('/api/books/space-hero/designs', { answers, face: faceUrl });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const d = await res.json();
  const o = await order(d.id);
  const it = o.items[0];
  await sendBack(it);
  // "Ask for changes" isn't for a book: the customer has nothing to change it with.
  const ask = await admin(`/api/admin/items/${it.id}/review`, 'POST', { action: 'changes', note: 'Send a clearer photo' });
  assert.strictEqual(ask.status, 409);
  assert.strictEqual((await ask.json()).code, 'changesNotForKind');
  const before = fs.readFileSync(path.join(dataDir, 'files', d.id, 'face.jpg'));
  const r = await replace(it, 'face', await jpeg(900, 1200, '#3399cc'), 'A clearer photo of Yousef');
  assert.strictEqual(r.status, 200, await r.clone().text());
  const rv = await r.json();
  assert.strictEqual(rv.status, 'awaiting_approval');
  const after = fs.readFileSync(path.join(dataDir, 'files', d.id, 'face.jpg'));
  assert.ok(!after.equals(before), 'the new photo');
  assert.ok(fs.existsSync(path.join(dataDir, 'files', d.id, 'face.v1.jpg')), 'the old one kept');
  assert.strictEqual((await replace(it, 1, await jpeg(500, 500))).status, 404, 'a book has one photo: face');
  const t = rv.proofLink.split('t=')[1];
  const view = await (await fetch(`${base}/api/proofs/${t}`)).json();
  assert.match(view.note, /clearer photo/);
  assert.strictEqual((await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: view.proof.proofHash })).status, 200);
});
