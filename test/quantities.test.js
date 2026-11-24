'use strict';

// One artwork, many pieces: identical items, the same artwork in several sizes
// and colours, and related items with their own names / numbers and sizes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, priceFor } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], mergeParse: [OPEN] };
const CUSTOMER = { name: 'كابتن الفريق', phone: '01022223333', governorate: 'cairo', city: 'مدينة نصر', address: '7 شارع عباس العقاد' };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qty-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const png = (w, h, alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 20, g: 90, b: 200, alpha } } }).png().toBuffer();
const SIDE = { editor: { objects: [{ type: 'i-text', text: 'TEAM' }] } };
const unit = (pid, size, sides = 1) => priceFor(PRODUCTS.find((p) => p.id === pid), size, sides);

async function upload(created, extra = {}) {
  for (const name of created.files) {
    const body = extra[name] || (name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') || name.includes('merge-base') ? await png(1200, 1600, 0.5) : await png(60, 72));
    const r = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(r.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('products say where sizes and colours can be mixed', () => {
  const p = (id) => PRODUCTS.find((x) => x.id === id).mix;
  assert.deepStrictEqual(p('tshirt'), { colors: true, sizes: true });
  assert.strictEqual(p('poster').sizes, false, 'a bigger poster is a bigger print');
  assert.strictEqual(p('canvas').colors, false, 'the canvas "colour" is its printed edge');
  assert.strictEqual(p('fabric').sizes, false);
});

test('one artwork in several sizes and colours: one design, the full price', async () => {
  const quantities = [{ color: 'black', size: 'S', qty: 2 }, { color: 'black', size: 'M', qty: 5 }, { color: 'black', size: 'L', qty: 3 }, { color: 'white', size: 'M', qty: 2 }, { color: 'white', size: '2XL', qty: 1 }];
  const res = await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: SIDE }, quantities });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const d = await upload(await res.json());
  const want = 12 * unit('tshirt', 'M') + unit('tshirt', '2XL');
  assert.strictEqual(d.copies, 13);
  assert.strictEqual(d.price, want);
  assert.strictEqual(d.quantities.length, 5);
  assert.strictEqual(d.quantities.find((l) => l.size.id === '2XL').unitPrice, unit('tshirt', '2XL'));
  // Cart, order: one line with every piece.
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(q.items[0].price, want);
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const item = (await o.json()).items[0];
  assert.strictEqual(item.copies, 13);
  assert.strictEqual(item.price, want);
  assert.deepStrictEqual(item.quantities.map((l) => [l.color.id, l.size.id, l.qty]), [['black', 'S', 2], ['black', 'M', 5], ['black', 'L', 3], ['white', 'M', 2], ['white', '2XL', 1]]);

  // Several identical pieces.
  const same = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: SIDE }, quantities: [{ color: 'white', size: '11oz', qty: 12 }] });
  assert.strictEqual(same.status, 201, await same.clone().text());
  const m = await upload(await same.json());
  assert.strictEqual(m.price, 12 * unit('mug', '11oz'));
  assert.strictEqual(m.copies, 12);
  // One piece, as chosen: no breakdown at all.
  const one = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: SIDE }, quantities: [{ color: 'white', size: '11oz', qty: 1 }] });
  const o1 = await upload(await one.json());
  assert.strictEqual(o1.quantities, undefined);
  assert.strictEqual(o1.price, unit('mug', '11oz'));
});

test('sizes and colours only mix where the print file is the same', async () => {
  const bad = async (body, status = 400) => {
    const r = await post('/api/designs', { sides: { front: SIDE }, ...body });
    assert.strictEqual(r.status, status, JSON.stringify(body));
  };
  const poster = PRODUCTS.find((x) => x.id === 'poster');
  await bad({ productId: 'poster', color: poster.colors[0].id, size: poster.sizes[0].id, quantities: [{ color: poster.colors[0].id, size: poster.sizes[1].id, qty: 2 }] });
  await bad({ productId: 'canvas', color: 'wrap', size: '30x45', quantities: [{ color: 'white', size: '30x45', qty: 1 }] });
  await bad({ productId: 'tshirt', color: 'black', size: 'M', quantities: [{ color: 'purple', size: 'M', qty: 1 }] });
  await bad({ productId: 'tshirt', color: 'black', size: 'M', quantities: [{ color: 'black', size: 'M', qty: 0 }] });
  await bad({ productId: 'tshirt', color: 'black', size: 'M', quantities: [{ color: 'black', size: 'M', qty: 2.5 }] });
  await bad({ productId: 'tshirt', color: 'black', size: 'M', quantities: [{ color: 'black', size: 'M', qty: 600 }, { color: 'black', size: 'L', qty: 600 }] });
  // Same size, more posters: fine.
  const r = await post('/api/designs', { productId: 'poster', color: poster.colors[0].id, size: poster.sizes[0].id, sides: { front: SIDE }, quantities: [{ color: poster.colors[0].id, size: poster.sizes[0].id, qty: 3 }] });
  assert.strictEqual(r.status, 201, await r.clone().text());
});

test('name lists are only on paper and label products, not clothing (owner\'s choice)', async () => {
  const sides = { back: { editor: { objects: [{ type: 'i-text', text: '{Name}' }] } } };
  const merge = { columns: ['Name', 'Size'], rows: [['Ahmed', 'L'], ['Mona', 'M']], sides: { back: { box: { x: 100, y: 200, w: 500, h: 300 } } } };
  for (const productId of ['tshirt', 'kidstee', 'hoodie', 'kidshoodie', 'ziphoodie', 'sweatshirt', 'polo', 'oversized', 'jersey']) {
    const p = PRODUCTS.find((x) => x.id === productId);
    assert.ok(!p.merge, `${productId} has no name list`);
    const r = await post('/api/designs', { productId, color: p.colors[0].id, size: p.sizes[0].id, sides, merge });
    assert.strictEqual(r.status, 400, productId);
  }
  const withLists = PRODUCTS.filter((p) => p.merge).map((p) => p.id).sort();
  assert.deepStrictEqual(withLists, ['bizcards', 'certificates', 'greetingcard', 'idcards', 'invitations', 'namelabels', 'stickersheet']);
});
