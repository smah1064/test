'use strict';

// Photo prints: many photos in one cart item, each a print-ready JPEG at 300 DPI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, CATEGORIES } = require('../src/products');
const { readZip } = require('../src/merge-data');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let token;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-photos-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], reorder: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function admin(url) {
  if (!token) token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  return fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
}
const px = (cm) => Math.round((cm / 2.54) * 300);
const jpeg = (w, h, rgb = '#3a7bd5') => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg({ quality: 80 }).toBuffer();
const PHOTOS = [
  { size: '10x15', copies: 2, orientation: 'portrait', dpi: 320 },
  { size: '13x18', copies: 1, orientation: 'landscape', dpi: 280 },
  { size: '20x30', copies: 1, orientation: 'portrait', dpi: 96 },
];
const CM = { '10x15': [10, 15], '13x18': [13, 18], '15x20': [15, 20], '20x30': [20, 30] };
const dims = (p) => { const [a, b] = CM[p.size].map(px); return p.orientation === 'landscape' ? [b, a] : [a, b]; };

/** Create a photo set and upload its files; `make(i, name)` can return other bytes. */
async function makeSet(body = {}, make) {
  const res = await post('/api/photosets', { color: 'gloss', options: { border: 'white' }, photos: PHOTOS, ...body });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const c = await res.json();
  for (const name of c.files) {
    const i = Number(name.match(/(\d{3})/)[1]) - 1;
    const p = (body.photos || PHOTOS)[i];
    let data = make && (await make(i, name));
    if (!data) data = name.startsWith('photo-') ? await jpeg(...dims(p)) : await jpeg(200, 300);
    const r = await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
    if (r.status !== 204) return { created: c, putStatus: r.status };
  }
  const done = await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } });
  return { created: c, done };
}

test('the photo prints product: lab sizes and prices, glossy or matte, border choice', () => {
  const p = PRODUCTS.find((x) => x.id === 'photoprints');
  assert.strictEqual(p.kind, 'photoset');
  assert.ok(CATEGORIES.some((c) => c.id === p.category));
  assert.deepStrictEqual(p.sizes.map((z) => [z.id, p.basePrice + z.surcharge]), [['10x15', 15], ['13x18', 25], ['15x20', 35], ['20x30', 70]]);
  assert.deepStrictEqual(p.colors.map((c) => c.id), ['gloss', 'matte']);
  assert.deepStrictEqual(p.options[0].choices.map((c) => c.id), ['none', 'white']);
});

test('a photo set is checked before anything is uploaded', async () => {
  const bad = async (body) => (await post('/api/photosets', { color: 'gloss', photos: PHOTOS, ...body })).status;
  assert.strictEqual(await bad({ photos: [] }), 400);
  assert.strictEqual(await bad({ photos: Array.from({ length: 101 }, () => PHOTOS[0]) }), 400);
  assert.strictEqual(await bad({ photos: [{ ...PHOTOS[0], size: '9x9' }] }), 400);
  assert.strictEqual(await bad({ photos: [{ ...PHOTOS[0], copies: 0 }] }), 400);
  assert.strictEqual(await bad({ photos: [{ ...PHOTOS[0], copies: 51 }] }), 400);
  assert.strictEqual(await bad({ photos: [{ ...PHOTOS[0], copies: 1.5 }] }), 400);
  assert.strictEqual(await bad({ color: 'gold' }), 400);
  assert.strictEqual(await bad({ options: { border: 'gold' } }), 400);
});

test('photos must be JPEGs of the exact print size', async () => {
  const png = await sharp({ create: { width: px(10), height: px(15), channels: 3, background: '#fff' } }).png().toBuffer();
  const asPng = await makeSet({}, (i, name) => (i === 0 && name.startsWith('photo-') ? png : null));
  assert.strictEqual(asPng.putStatus, 400);
  const small = await makeSet({}, (i, name) => (i === 1 && name.startsWith('photo-') ? jpeg(800, 600) : null));
  assert.strictEqual(small.done.status, 400);
  assert.match((await small.done.json()).error, /2/);
  // Files that weren't asked for are refused.
  const { created } = await makeSet();
  assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/files/photo-009.jpg`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: await jpeg(10, 10) })).status, 403);
});

test('a finished set: price per photo and copies, contact sheet, proof with a low-resolution warning', async () => {
  const { created, done } = await makeSet();
  assert.strictEqual(created.price, 2 * 15 + 25 + 70);
  assert.strictEqual(done.status, 200, await done.clone().text());
  const d = await done.json();
  assert.strictEqual(d.price, 125);
  assert.strictEqual(d.copies, 4);
  assert.strictEqual(d.size.label.en.startsWith('3 photos · 4 prints'), true);
  assert.match(d.size.label.ar, /^٣ صور · ٤ نسخ/);
  assert.match(d.size.label.en, /White border/);
  const sheet = await fetch(base + d.previewUrl);
  assert.strictEqual(sheet.status, 200);
  assert.strictEqual(sheet.headers.get('content-type'), 'image/png');
  const proof = await (await fetch(`${base}/api/designs/${d.id}/proof`)).json();
  assert.strictEqual(proof.photos.length, 3);
  assert.deepStrictEqual(proof.photos.map((p) => [p.size.id, p.copies]), [['10x15', 2], ['13x18', 1], ['20x30', 1]]);
  assert.strictEqual(proof.preflight.status, 'warn');
  assert.deepStrictEqual(proof.preflight.checks.map((c) => [c.id, c.params.photos]), [['photoLowRes', '3']]);
  assert.strictEqual(proof.review.needed, false);
  assert.strictEqual((await fetch(base + proof.photos[0].url)).status, 200);
  assert.strictEqual((await fetch(`${base}/files/designs/${d.id}/photos/9.jpg`)).status, 404);
  // The cart quote charges the same.
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(q.items[0].price, 125);
});

test('ordered: one item with every photo, a ZIP for the print shop sorted by size, prints counted in the accounts', async () => {
  const { done } = await makeSet({ photos: [...PHOTOS, { size: '10x15', copies: 3, orientation: 'landscape', dpi: 300 }] });
  const d = await done.json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await post('/api/orders', { customer: { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1 شارع' }, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const order = await o.json();
  const item = order.items[0];
  assert.strictEqual(item.kind, 'photoset');
  assert.strictEqual(item.price, 2 * 15 + 25 + 70 + 3 * 15);
  assert.strictEqual(item.copies, 7);
  assert.strictEqual(item.photos.length, 4);
  // Prints per size, with each size's price (the invoice shows these lines).
  assert.deepStrictEqual(item.quantities.map((l) => [l.size.id, l.qty, l.unitPrice]), [['10x15', 5, 15], ['13x18', 1, 25], ['20x30', 1, 70]]);
  assert.strictEqual(item.unitPrice, null);
  const dispatch = require('../src/dispatch');
  const msg = dispatch.whatsappText({ house: { name: 'X' }, order: { number: order.number, items: [{}] }, item: { ...item, position: 1 }, design: { sides: [] }, files: [], lang: 'en', expires: '2026-12-24T00:00:00Z' });
  assert.match(msg, /\*Quantity:\* 7/);
  assert.match(msg, /10 × 15 cm · White border ×5/, 'the border goes with each size');
  // The print shop's ZIP: by size, then photo number, named with the copies; a list and a readme.
  const zip = await admin(`/api/admin/files/${d.id}/front?format=photos-zip`);
  assert.strictEqual(zip.status, 200, await zip.clone().text());
  assert.match(zip.headers.get('content-disposition'), /-photos\.zip/);
  const entries = readZip(Buffer.from(await zip.arrayBuffer()));
  assert.deepStrictEqual([...entries.keys()], ['README.txt', 'list.csv', '10x15/001_10x15_x2.jpg', '10x15/004_10x15_x3.jpg', '13x18/002_13x18_x1.jpg', '20x30/003_20x30_x1.jpg']);
  const readme = entries.get('README.txt').toString();
  assert.match(readme, /Glossy · White border/);
  assert.match(readme, /10x15 cm: 5 prints/);
  const meta = await sharp(entries.get('13x18/002_13x18_x1.jpg')).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [px(18), px(13)]);
  assert.strictEqual(meta.density, 300, 'marked 300 DPI so print software prints them at their real size');
  // The default download is the ZIP; the proof picture too.
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).headers.get('content-type'), 'application/zip');
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front?format=proof`)).status, 200);
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front?format=png`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/admin/files/${d.id}/front?format=photos-zip`)).status, 401);
  // The accounts count prints, at each size's cost.
  const accounting = require('../src/accounting');
  const costs = { photoprints: { sizes: { '10x15': 3, '13x18': 5, '20x30': 12 } } };
  assert.strictEqual(accounting.itemCostFrom(costs, item).total, 5 * 3 + 5 + 12);
  const r = accounting.report({ orders: [{ ...order, customer: { name: 'x' }, items: [item] }], costs: {}, expenses: [], settings: {} });
  assert.strictEqual(r.products.find((p) => p.productId === 'photoprints').units, 7);
  // Order again: the same photos, ready for the cart at today's prices.
  const again = await (await post(`/api/orders/${order.id}/reorder?k=${order.key}`, {})).json();
  assert.strictEqual(again.skipped.length, 0);
  assert.strictEqual(again.items[0].price, item.price);
  assert.strictEqual(again.items[0].sizeLabel.en, item.size.label.en);
  assert.strictEqual(again.items[0].copies, undefined, 'no "price each" for prints of different sizes');
});

test('the shop grid shows a picture for photo prints and the editor is not used for them', async () => {
  const r = await fetch(base + '/api/thumbs/photoprints/gloss.webp', { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/mockups/photoprints-card.webp');
  assert.strictEqual((await fetch(base + '/mockups/photoprints-card.webp')).status, 200);
  // The editor's designs API refuses photo prints (they are ordered on the photos page).
  assert.strictEqual((await post('/api/designs', { productId: 'photoprints', color: 'gloss', size: '10x15', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } })).status, 400);
});

test('a lost answer to "complete" can be asked again with the same token; Arabic counts from 101 up', async () => {
  const many = [{ size: '10x15', copies: 50, orientation: 'portrait', dpi: 300 }, { size: '10x15', copies: 50, orientation: 'portrait', dpi: 300 }, { size: '10x15', copies: 3, orientation: 'portrait', dpi: 300 }];
  const { created, done } = await makeSet({ photos: many });
  const d = await done.json();
  assert.match(d.size.label.ar, /^٣ صور · ١٠٣ نسخ/);
  const again = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(again.status, 200);
  const d2 = await again.json();
  assert.strictEqual(d2.id, d.id);
  assert.strictEqual(d2.price, d.price);
  assert.strictEqual(d2.doneTokenHash, undefined);
  assert.strictEqual(d2.uploadTokenHash, undefined);
  // Another token gets nothing.
  assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': 'nope' } })).status, 403);
});
