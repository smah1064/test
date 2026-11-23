'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../src/app');

/** Build a tiny valid RGBA PNG of the given size. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return out;
}

const EDITOR = { objects: [{ type: 'i-text', text: 'hi' }] };
const SIDE = { editor: EDITOR };
const PRINT = png(3600, 4800);
const PREVIEW = png(60, 72);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-test-'));
  const app = createApp({ dataDir, adminPassword: 'secret' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = (url, options = {}) =>
  fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', 'x-admin-password': 'secret', ...(options.headers || {}) } });

const CUSTOMER = { name: 'سارة أحمد', phone: '٠١٠ ١٢٣٤ ٥٦٧٨', governorate: 'giza', city: 'الدقي', address: '12 شارع التحرير، الدور 3' };

async function upload(id, token, name, body) {
  return fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': token, 'Content-Type': 'application/octet-stream' }, body });
}

/** Create a design the way the editor does: layout, then files, then complete. */
async function makeDesign(overrides = {}, { complete = true } = {}) {
  const res = await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: SIDE }, ...overrides });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id, uploadToken, files } = await res.json();
  for (const name of files) {
    const body = name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW;
    const up = await upload(id, uploadToken, name, body);
    assert.strictEqual(up.status, 204, name);
  }
  if (!complete) return { id, uploadToken };
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('lists products with print areas', async () => {
  const body = await (await fetch(base + '/api/products')).json();
  assert.ok(body.products.length >= 13);
  assert.strictEqual(body.currency, 'EGP');
  assert.strictEqual(body.governorates.length, 27);
  for (const p of body.products) {
    assert.ok(p.name.en && p.name.ar, `${p.id} needs English and Arabic names`);
    assert.ok(body.categories.some((c) => c.id === p.category), `${p.id} has a known category`);
    for (const c of p.colors) assert.ok(c.name.en && c.name.ar, `${p.id}/${c.id} colour names`);
    for (const s of p.sizes) assert.ok(s.label.en && s.label.ar, `${p.id}/${s.id} size labels`);
  }
  const tee = body.products.find((p) => p.id === 'tshirt');
  assert.deepStrictEqual(tee.sides.map((s) => s.id), ['front', 'back']);
  assert.ok(tee.sides[0].printHeightIn > tee.sides[0].printWidthIn);
});

test('saves a design, prices it on the server and records print specs', async () => {
  const d = await makeDesign({ size: '2XL', sides: { front: SIDE, back: SIDE } });
  assert.strictEqual(d.price, 450 + 50 + 100);
  assert.strictEqual(d.status, 'ready');
  assert.strictEqual(d.uploadTokenHash, undefined);
  assert.strictEqual(d.sides.length, 2);
  assert.strictEqual(d.sides[0].widthPx, 3600);
  assert.strictEqual(d.sides[0].dpi, 300);
  assert.strictEqual(d.sides[0].hasSvg, true);
  const preview = await fetch(base + d.previewUrl);
  assert.strictEqual(preview.status, 200);
  assert.strictEqual(preview.headers.get('content-type'), 'image/png');
  const reopened = await (await fetch(`${base}/api/designs/${d.id}`)).json();
  assert.deepStrictEqual(reopened.editor.front, EDITOR);
  assert.strictEqual(reopened.uploadTokenHash, undefined);
});

test('rejects invalid designs', async () => {
  const cases = [
    [{ productId: 'nope', color: 'black', size: 'M', sides: { front: SIDE } }, /Unknown product/],
    [{ productId: 'tshirt', color: 'purple', size: 'M', sides: { front: SIDE } }, /colour/],
    [{ productId: 'mug', color: 'white', size: '11oz', sides: { back: SIDE } }, /Unknown side/],
    [{ productId: 'tshirt', color: 'black', size: 'M', sides: {} }, /at least one side/],
    [{ productId: 'tshirt', color: 'black', size: 'M', sides: { front: { ...SIDE, editor: { objects: [] } } } }, /no design/],
  ];
  for (const [body, re] of cases) {
    const res = await post('/api/designs', body);
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, re);
  }
});

test('print files are only available to admins', async () => {
  const d = await makeDesign();
  assert.strictEqual((await fetch(`${base}/api/admin/files/${d.id}/front`)).status, 401);
  const ok = await admin(`/api/admin/files/${d.id}/front`);
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers.get('content-disposition'), /tshirt-front\.png/);
});

test('places an order with one print job per design and works through the queue one at a time', async () => {
  const a = await makeDesign();
  const b = await makeDesign({ productId: 'mug', color: 'white', size: '11oz' });
  const res = await post('/api/orders', { customer: CUSTOMER, designIds: [a.id, b.id] });
  assert.strictEqual(res.status, 201);
  const order = await res.json();
  assert.match(order.number, /^POD-\d+$/);
  assert.strictEqual(order.items.length, 2);
  assert.strictEqual(order.subtotal, 700);
  assert.strictEqual(order.shipping, 75);
  assert.strictEqual(order.total, 775);
  assert.strictEqual(order.currency, 'EGP');
  assert.deepStrictEqual(order.payment, { method: 'cod', status: 'pending' });
  assert.strictEqual(order.status, 'received');
  assert.strictEqual(order.customer.phone, undefined, 'public order view must not leak the phone number');
  assert.strictEqual(order.customer.governorate.ar, 'الجيزة');

  // A design cannot be ordered twice.
  const again = await post('/api/orders', { customer: CUSTOMER, designIds: [a.id] });
  assert.strictEqual(again.status, 409);

  let q = await (await admin('/api/admin/queue')).json();
  assert.strictEqual(q.current.designId, a.id);
  assert.strictEqual(q.upNext[0].designId, b.id);

  const [first, second] = [q.current, q.upNext[0]];
  assert.strictEqual((await admin(`/api/admin/items/${first.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printing' }) })).status, 200);
  // Only one item on the press at a time.
  const busy = await admin(`/api/admin/items/${second.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printing' }) });
  assert.strictEqual(busy.status, 409);

  await admin(`/api/admin/items/${first.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printed' }) });
  q = await (await admin('/api/admin/queue')).json();
  assert.strictEqual(q.current.id, second.id);
  assert.strictEqual(q.toShip[0].id, first.id);

  const pub = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.strictEqual(pub.status, 'in_production');
  assert.deepStrictEqual(pub.items[0].history.map((h) => h.status), ['queued', 'printing', 'printed']);
});

test('validates checkout details', async () => {
  const d = await makeDesign();
  const bad = await post('/api/orders', { customer: { ...CUSTOMER, email: 'nope' }, designIds: [d.id] });
  assert.strictEqual(bad.status, 400);
  const badPhone = await post('/api/orders', { customer: { ...CUSTOMER, phone: '12345' }, designIds: [d.id] }, { 'x-lang': 'ar' });
  assert.strictEqual(badPhone.status, 400);
  assert.match((await badPhone.json()).error, /رقم موبايل/);
  const noGov = await post('/api/orders', { customer: { ...CUSTOMER, governorate: 'atlantis' }, designIds: [d.id] });
  assert.strictEqual(noGov.status, 400);
  const empty = await post('/api/orders', { customer: CUSTOMER, designIds: [] });
  assert.strictEqual(empty.status, 400);
  const dup = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id, d.id] });
  assert.strictEqual(dup.status, 400);
});

test('admin endpoints require the password', async () => {
  assert.strictEqual((await fetch(base + '/api/admin/queue')).status, 401);
  assert.strictEqual((await fetch(base + '/api/admin/queue', { headers: { 'x-admin-password': 'wrong' } })).status, 401);
});

test('orders and designs survive a restart', async () => {
  const d = await makeDesign();
  await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] });
  const app2 = createApp({ dataDir, adminPassword: 'secret' });
  const s2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/admin/orders`, { headers: { 'x-admin-password': 'secret' } });
  const { orders } = await res.json();
  s2.close();
  assert.ok(orders.some((o) => o.items.some((i) => i.designId === d.id)));
});

test('normalises Egyptian mobile numbers', () => {
  const { normalizeEgyptMobile } = require('../src/egypt');
  assert.strictEqual(normalizeEgyptMobile('+20 100 123 4567'), '01001234567');
  assert.strictEqual(normalizeEgyptMobile('٠١١٢٣٤٥٦٧٨٩'), '01123456789');
  assert.strictEqual(normalizeEgyptMobile('0020 155 555 1234'), '01555551234');
  assert.strictEqual(normalizeEgyptMobile('0131234567'), null);
  assert.strictEqual(normalizeEgyptMobile('02 2345 6789'), null);
});

test('stores the normalised phone for the courier and admin', async () => {
  const d = await makeDesign();
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
  const { orders } = await (await admin('/api/admin/orders')).json();
  const o = orders.find((x) => x.id === order.id);
  assert.strictEqual(o.customer.phone, '01012345678');
  assert.strictEqual(o.customer.governorateName.en, 'Giza');
});

test('error messages follow the shopper language', async () => {
  const en = await post('/api/designs', { productId: 'nope' });
  assert.strictEqual((await en.json()).error, 'Unknown product');
  const ar = await post('/api/designs', { productId: 'nope' }, { 'x-lang': 'ar' });
  assert.strictEqual((await ar.json()).error, 'منتج غير معروف');
});

test('uploads need the token, the right file type and every file before completing', async () => {
  const { id, uploadToken } = await makeDesign({}, { complete: false });
  assert.strictEqual((await upload(id, 'wrong', 'front-print.png', PRINT)).status, 403);
  assert.strictEqual((await upload(id, uploadToken, 'front-print.png', Buffer.from('not a png at all, just text'))).status, 400);
  assert.strictEqual((await upload(id, uploadToken, 'back-print.png', PRINT)).status, 400, 'side not in design');
  assert.strictEqual((await upload(id, uploadToken, '../db.json', PRINT)).status, 404);
  // Not completed yet: cannot be ordered.
  const early = await post('/api/orders', { customer: CUSTOMER, designIds: [id] });
  assert.strictEqual(early.status, 400);

  const fresh = await (await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: SIDE } })).json();
  const incomplete = await fetch(`${base}/api/designs/${fresh.id}/complete`, { method: 'POST', headers: { 'x-upload-token': fresh.uploadToken } });
  assert.strictEqual(incomplete.status, 400, 'missing files');
});

test('admin can download PNG, mirrored PNG, SVG, PDF, PDF with crop marks and CMYK TIFF', async () => {
  const d = await makeDesign({ productId: 'poster', color: 'black', size: '30x40' });
  const get = (format) => admin(`/api/admin/files/${d.id}/front?format=${format}`);
  const sharp = require('sharp');

  const pngRes = await get('png');
  const meta = await sharp(Buffer.from(await pngRes.arrayBuffer())).metadata();
  assert.strictEqual(meta.density, Math.round(3600 / (17.7 + 0.25)), 'DPI embedded');
  assert.ok(meta.icc, 'sRGB profile embedded');

  const mir = await get('png-mirror');
  assert.strictEqual(mir.status, 200);
  assert.match(mir.headers.get('content-disposition'), /mirrored\.png/);

  const svg = await get('svg');
  assert.match(await svg.text(), /<svg/);

  const pdf = Buffer.from(await (await get('pdf')).arrayBuffer());
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  const pdfText = pdf.toString('latin1');
  assert.match(pdfText, /\/TrimBox/);
  assert.match(pdfText, /\/BleedBox/);
  // Page = trim + bleed: 17.7 x 23.6 in + 2 x 0.125 in.
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdfText);
  assert.ok(Math.abs(Number(mb[1]) - (17.7 + 0.25) * 72) < 0.5, 'page width ' + mb[1]);

  const marks = Buffer.from(await (await get('pdf-marks')).arrayBuffer()).toString('latin1');
  const mb2 = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(marks);
  assert.ok(Number(mb2[1]) > Number(mb[1]), 'crop-mark margin added');

  const tif = await sharp(Buffer.from(await (await get('tiff')).arrayBuffer())).metadata();
  assert.strictEqual(tif.space, 'cmyk');
  assert.strictEqual(tif.channels, 4);

  assert.strictEqual((await get('exe')).status, 404);
  assert.strictEqual((await fetch(`${base}/api/admin/files/${d.id}/front?format=pdf`)).status, 401);
});

test('CMYK proof returns a PNG of the same size', async () => {
  const res = await fetch(base + '/api/proof', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png(40, 30) });
  assert.strictEqual(res.status, 200);
  const meta = await require('sharp')(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.format], [40, 30, 'png']);
});
