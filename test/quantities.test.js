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

test('team kit: names and numbers on the back, each row in its own size', async () => {
  const sides = { front: SIDE, back: { editor: { objects: [{ type: 'i-text', text: '{Name}' }, { type: 'i-text', text: '{Number}' }] } } };
  const rows = [['Ahmed', '10', 'L'], ['منى', '7', 'm'], ['Omar', '9', 'أطفال 8–12'], ['Karim', '1', 'XL']];
  const box = { x: 100, y: 200, w: 500, h: 300 };
  // A size that the jersey doesn't come in is refused, with the row.
  let r = await post('/api/designs', { productId: 'jersey', color: 'red', size: 'M', sides, merge: { columns: ['Name', 'Number', 'Size'], rows: [...rows, ['Zed', '4', 'XXXXL']], sides: { back: { box } } } });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /5/);
  r = await post('/api/designs', { productId: 'jersey', color: 'red', size: 'M', sides, merge: { columns: ['Name', 'Number', 'Size'], rows, sides: { back: { box } } } });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const created = await r.json();
  const pics = await Promise.all(rows.map(() => png(box.w, box.h)));
  const d = await upload(created, { 'back-merge.bin': Buffer.concat(pics) });
  const want = unit('jersey', 'L', 2) + unit('jersey', 'M', 2) + unit('jersey', 'kids', 2) + unit('jersey', 'XL', 2);
  assert.strictEqual(d.copies, 4);
  assert.strictEqual(d.price, want);
  const by = Object.fromEntries(d.quantities.map((l) => [l.size.id, l.qty]));
  assert.deepStrictEqual(by, { L: 1, M: 1, kids: 1, XL: 1 });
  // The shop gets the names alone (for transfers) with each piece's size in the file name.
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const tok = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  const zip = await fetch(`${base}/api/admin/files/${d.id}/back?format=merge-names-zip`, { headers: { Authorization: `Bearer ${tok}` } });
  assert.strictEqual(zip.status, 200);
  const names = [...require('../src/merge-data').readZip(Buffer.from(await zip.arrayBuffer())).keys()];
  assert.ok(names.includes('0001-Ahmed-10-L.png'), names.join(' '));
  assert.ok(names.some((n) => n.startsWith('0003-Omar-9-')));
  assert.ok(names.includes('back-placement.txt'));
  // The full print PDF keeps garments transparent (no white box around the print).
  const pdf = await fetch(`${base}/api/admin/files/${d.id}/back?format=merge-pdf`, { headers: { Authorization: `Bearer ${tok}` } });
  assert.strictEqual(pdf.status, 200);
  assert.match(Buffer.from(await pdf.arrayBuffer()).toString('latin1'), /\/SMask/);
});

test('team kit in the admin: one DTF transfer per name, no single-file replacement of the names, a names-only ZIP', async () => {
  const sides = { back: { editor: { objects: [{ type: 'i-text', text: '{Name}' }] } } };
  const rows = [['Ahmed', 'L'], ['Mona', 'M'], ['Omar', 'XL']];
  const box = { x: 100, y: 200, w: 500, h: 300 };
  const r = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides, merge: { columns: ['Name', 'Size'], rows, sides: { back: { box } } } });
  assert.strictEqual(r.status, 201, await r.clone().text());
  // Each row's picture is a different colour, to see it on the film.
  const pics = await Promise.all([[200, 0, 0], [0, 160, 0], [0, 0, 200]].map(([r1, g, b]) => sharp({ create: { width: box.w, height: box.h, channels: 4, background: { r: r1, g, b, alpha: 1 } } }).png().toBuffer()));
  const d = await upload(await r.json(), { 'back-merge.bin': Buffer.concat(pics) });
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total })).json();
  const item = order.items[0];
  const { token } = await (await post('/api/admin/login', { password: 'secret' })).json();
  const admin = (url, opts = {}) => fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  assert.strictEqual((await admin(`/api/admin/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ process: 'dtf' }) })).status, 200);
  const film = await admin('/api/admin/dtf-film', { method: 'POST', body: JSON.stringify({ itemIds: [item.id] }) });
  assert.strictEqual(film.status, 200, await film.clone().text());
  const pdf = Buffer.from(await film.arrayBuffer()).toString('latin1');
  // Three different pictures on the film (the background with each row's name), not one picture three times.
  assert.ok((pdf.match(/\/Subtype\s*\/Image/g) || []).length >= 3, 'three transfers');
  // The name side can't be replaced by one file.
  const rep = await admin(`/api/admin/items/${item.id}/replacement/back`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: await png(1200, 1600) });
  assert.strictEqual(rep.status, 409);
  assert.strictEqual((await rep.json()).code, 'replaceNames');
  // The names-only ZIP keeps its name on every download.
  const names = [];
  for (let i = 0; i < 2; i++) names.push((await admin(`/api/admin/files/${d.id}/back?format=merge-names-zip`)).headers.get('content-disposition'));
  assert.match(names[0], /-3-names-only\.zip/);
  assert.strictEqual(names[0], names[1]);
});
