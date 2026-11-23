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

const OPEN_LIMITS = { designs: [{ max: 1e6, ms: 1000 }], orders: [{ max: 1e6, ms: 1000 }], shares: [{ max: 1e6, ms: 1000 }] };
let server;
let base;
let dataDir;
let app;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-test-'));
  app = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0 });
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
let adminToken = null;
async function signIn(at = base, password = 'secret') {
  const res = await fetch(at + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  return res.ok ? (await res.json()).token : null;
}
const admin = async (url, options = {}) => {
  adminToken ||= await signIn();
  return fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) } });
};

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
  const first = q.waiting.find((i) => i.designId === a.id);
  const second = q.waiting.find((i) => i.designId === b.id);
  assert.ok(first && second);
  // Several items can be printing at once, started in any order.
  assert.strictEqual((await admin(`/api/admin/items/${second.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printing' }) })).status, 200);
  assert.strictEqual((await admin(`/api/admin/items/${first.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printing' }) })).status, 200);
  q = await (await admin('/api/admin/queue')).json();
  assert.ok([first.id, second.id].every((id) => q.printing.some((i) => i.id === id)));

  await admin(`/api/admin/items/${first.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printed' }) });
  q = await (await admin('/api/admin/queue')).json();
  assert.ok(q.printing.some((i) => i.id === second.id));
  assert.ok(q.toShip.some((i) => i.id === first.id));

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
  assert.strictEqual((await fetch(base + '/api/admin/queue', { headers: { 'x-admin-password': 'secret' } })).status, 401);
  assert.strictEqual((await fetch(base + '/api/admin/queue', { headers: { Authorization: 'Bearer not-a-real-session-token-123' } })).status, 401);
});

test('admin sign-in: sessions, sign-out and lockout after 5 wrong passwords', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-auth-'));
  const app2 = make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', cleanupEvery: 0 });
  const s2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  const at = `http://127.0.0.1:${s2.address().port}`;
  try {
    const login = (password) => fetch(at + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const ok = await login('Str0ng!Passw0rd-2026');
    assert.strictEqual(ok.status, 200);
    const { token, weakPassword } = await ok.json();
    assert.strictEqual(weakPassword, false);
    const auth = { Authorization: `Bearer ${token}` };
    assert.strictEqual((await fetch(at + '/api/admin/queue', { headers: auth })).status, 200);
    await fetch(at + '/api/admin/logout', { method: 'POST', headers: auth });
    assert.strictEqual((await fetch(at + '/api/admin/queue', { headers: auth })).status, 401, 'token ends at sign-out');
    for (let i = 0; i < 5; i++) assert.strictEqual((await login('guess' + i)).status, 401);
    const locked = await login('Str0ng!Passw0rd-2026');
    assert.strictEqual(locked.status, 429, 'locked even with the right password');
    assert.match((await locked.json()).error, /15 min/);
  } finally {
    s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual((await (await post('/api/admin/login', { password: 'secret' })).json()).weakPassword, true);
});

test('security headers and page Content-Security-Policy', async () => {
  const page = await fetch(base + '/editor');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
  // Every inline script on every page is allowed by its hash (nothing else).
  const { inlineScriptHashes } = require('../src/security');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'public')).filter((n) => n.endsWith('.html'))) {
    const name = f.replace(/\.html$/, '');
    const res = await fetch(base + '/' + (name === 'index' ? '' : name));
    const html = await res.text();
    const pol = res.headers.get('content-security-policy');
    for (const h of inlineScriptHashes(html)) assert.ok(pol.includes(h), `${name}: inline script allowed`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${name}: no inline event handlers`);
  }
  const api = await fetch(base + '/api/products');
  assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
});

test('rate limits on new designs and orders', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-limit-'));
  const app2 = make({ dataDir: dir, adminPassword: 'secret', cleanupEvery: 0, limits: { designs: [{ max: 2, ms: 60e3 }], orders: [{ max: 1, ms: 60e3 }] } });
  const s2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  const at = `http://127.0.0.1:${s2.address().port}`;
  try {
    const mk = () => fetch(at + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'rect' }] } } } }) });
    assert.strictEqual((await mk()).status, 201);
    assert.strictEqual((await mk()).status, 201);
    const third = await mk();
    assert.strictEqual(third.status, 429);
    // A made-up X-Forwarded-For entry does not get around the limit: the
    // hosting proxy appends the real address (here 127.0.0.1) after it.
    const spoof = await fetch(at + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9, 127.0.0.1' }, body: '{}' });
    assert.strictEqual(spoof.status, 429);
    const order = () => fetch(at + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer: CUSTOMER, designIds: [] }) });
    assert.strictEqual((await order()).status, 400);
    assert.strictEqual((await order()).status, 429);
  } finally {
    s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uploaded SVGs are cleaned of scripts and outside links', async () => {
  const { sanitizeSvg } = require('../src/security');
  const bad = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
    <script>alert(2)</script><foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
    <style>@import url(https://evil.example/x.css); @font-face{src:url("data:font/woff2;base64,AAAA")}</style>
    <a href="javascript:alert(3)"><text>Hi &lt;script&gt;</text></a>
    <image xlink:href="https://evil.example/track.png"/><image xlink:href="data:image/png;base64,iVBORw0KGgo="/>
    <rect fill="url(#grad)" clip-path="url(#c1)" onclick='x()'/></svg>`;
  const out = sanitizeSvg(bad);
  assert.doesNotMatch(out, /<script|onload|onclick|foreignObject|iframe|evil\.example|javascript:/i);
  assert.match(out, /data:font\/woff2/);
  assert.match(out, /data:image\/png/);
  assert.match(out, /url\(#grad\)/);
  assert.match(out, /Hi &lt;script&gt;/);
});

test('clean-up removes old unordered designs, keeps ordered ones', async () => {
  const d = await makeDesign();
  const old = await makeDesign();
  const ordered = await makeDesign();
  assert.strictEqual((await post('/api/orders', { customer: CUSTOMER, designIds: [ordered.id] })).status, 201);
  // Age two designs by 40 days.
  const longAgo = new Date(Date.now() - 40 * 864e5).toISOString();
  for (const id of [old.id, ordered.id]) app.locals.store.db.designs[id].createdAt = longAgo;
  const result = app.locals.cleanup();
  assert.ok(result.designs >= 1);
  assert.strictEqual((await fetch(base + '/api/designs/' + old.id)).status, 404);
  assert.strictEqual((await fetch(base + '/api/designs/' + ordered.id)).status, 200);
  assert.strictEqual((await fetch(base + '/api/designs/' + d.id)).status, 200);
});

test('orders and designs survive a restart', async () => {
  const d = await makeDesign();
  await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] });
  const app2 = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0 });
  const s2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  const at = `http://127.0.0.1:${s2.address().port}`;
  const res = await fetch(`${at}/api/admin/orders`, { headers: { Authorization: `Bearer ${await signIn(at)}` } });
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

test('the DTF gang sheet page and its API are gone', async () => {
  assert.strictEqual((await fetch(base + '/gangsheet')).status, 404);
  assert.strictEqual((await post('/api/gangsheets', { items: [] })).status, 404);
});

test('items can switch between DTG and DTF; DTF/DTG files and the shared film are produced', async () => {
  const d = await makeDesign({ productId: 'polo', color: 'black', size: 'L', sides: { front: SIDE, back: SIDE } });
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
  const itemId = order.items[0].id;
  const sharp = require('sharp');

  let r = await admin(`/api/admin/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ process: 'sublimation' }) });
  assert.strictEqual(r.status, 400, 'polo cannot be sublimated');
  r = await admin(`/api/admin/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ process: 'dtg' }) });
  assert.strictEqual((await r.json()).process, 'dtg');

  const white = await sharp(Buffer.from(await (await admin(`/api/admin/files/${d.id}/front?format=dtg-white`)).arrayBuffer())).metadata();
  assert.strictEqual(white.channels, 4);
  const film = await admin(`/api/admin/files/${d.id}/back?format=dtf-film`);
  assert.match(film.headers.get('content-disposition'), /dtf-film\.png/);
  // The customer's design as a PDF: one page per side.
  const prev = await admin(`/api/admin/files/${d.id}/front?format=preview-pdf`);
  assert.strictEqual(prev.status, 200);
  assert.match(prev.headers.get('content-disposition'), /-preview\.pdf/);
  const prevBuf = Buffer.from(await prev.arrayBuffer());
  assert.strictEqual(prevBuf.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual((prevBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 2, 'front and back');
  assert.strictEqual((await fetch(`${base}/api/admin/files/${d.id}/front?format=preview-pdf`)).status, 401);

  r = await admin(`/api/admin/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ process: 'dtf' }) });
  assert.strictEqual((await r.json()).process, 'dtf');
  const list = await (await admin('/api/admin/dtf-items')).json();
  assert.ok(list.items.some((i) => i.id === itemId));
  const batch = await admin('/api/admin/dtf-film', { method: 'POST', body: JSON.stringify({ itemIds: [itemId] }) });
  assert.strictEqual(batch.status, 200);
  assert.ok(Number(batch.headers.get('x-film-length-in')) > 0);
  assert.strictEqual(Buffer.from(await batch.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const after = (await (await admin('/api/admin/dtf-items')).json()).items.find((i) => i.id === itemId);
  assert.match(after.filmBatch.id, /^F\d+$/);
});

test('product card pictures are recoloured photos', async () => {
  const res = await fetch(base + '/api/thumbs/hoodie/black.webp');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/webp');
  const meta = await require('sharp')(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.hasAlpha], [640, 640, true]);
  assert.strictEqual((await fetch(base + '/api/thumbs/hoodie/purple.webp')).status, 404);
  assert.strictEqual((await fetch(base + '/api/thumbs/nope/black.webp')).status, 404);
});

test('photo quality boost enlarges and keeps transparency', async () => {
  const sharp = require('sharp');
  const res = await fetch(base + '/api/enhance', { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-scale': '2.5' }, body: png(200, 100) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('x-scale'), '2.5');
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepStrictEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['png', 500, 250, true]);
  const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c33' } }).jpeg().toBuffer();
  const r2 = await fetch(base + '/api/enhance', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-scale': '9' }, body: jpg });
  assert.strictEqual(r2.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual(r2.headers.get('x-scale'), '4'); // capped at 4x
  const bad = await fetch(base + '/api/enhance', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not an image at all, just some text here') });
  assert.strictEqual(bad.status, 400);
});

test('shared designs: create, view, reply, open a copy, link preview', async () => {
  const preview = 'data:image/png;base64,' + png(60, 72).toString('base64');
  const bad = await post('/api/shares', { productId: 'tshirt', sides: {} });
  assert.strictEqual(bad.status, 400);
  const res = await post('/api/shares', { productId: 'tshirt', color: 'navy', size: 'L', sides: { front: { objects: [{ type: 'i-text', text: 'hi' }] } }, previews: { front: preview } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const sh = await res.json();
  assert.match(sh.id, /^[A-Za-z0-9_-]{12}$/);
  assert.strictEqual(sh.color.id, 'navy');
  assert.deepStrictEqual(sh.sides.map((s) => s.id), ['front']);
  const img = await fetch(base + sh.sides[0].preview);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');

  const up = await post(`/api/shares/${sh.id}/feedback`, { vote: 'up', name: 'Mona' });
  assert.strictEqual(up.status, 201);
  assert.strictEqual((await post(`/api/shares/${sh.id}/feedback`, { vote: 'change', comment: '' })).status, 400);
  const ch = await (await post(`/api/shares/${sh.id}/feedback`, { vote: 'change', comment: 'Bigger name <b>please</b>' })).json();
  assert.deepStrictEqual(ch.feedback.map((f) => f.vote), ['up', 'change']);
  assert.strictEqual(ch.feedback[1].comment, 'Bigger name <b>please</b>'); // stored as text; pages escape it

  const copy = await (await fetch(`${base}/api/shares/${sh.id}/design`)).json();
  assert.strictEqual(copy.productId, 'tshirt');
  assert.strictEqual(copy.editor.front.objects[0].text, 'hi');

  const page = await (await fetch(`${base}/s/${sh.id}`)).text();
  assert.match(page, new RegExp(`og:image" content="http://[^"]+/api/shares/${sh.id}/preview/front.png"`));
  assert.strictEqual((await fetch(`${base}/s/AAAAAAAAAAAA`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/shares/../../etc`)).status, 404);
});

test('AI help is off without a key, and returns cleaned, structured results with one', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepStrictEqual(await (await fetch(base + '/api/ai/status')).json(), { enabled: false, perDay: 15 });
  assert.strictEqual((await post('/api/ai/slogans', { about: 'x' })).status, 503);

  // A stand-in for the Claude API that answers with fixed structured output.
  const http = require('http');
  const seen = [];
  const answers = {
    slogans: { slogans: [{ text: 'أحلى أخ في الدنيا', font: 'Lalezar' }, { text: 'Best Bro Ever', font: 'Lalezar' }, { text: '   ', font: 'Anton' }] },
    logos: { logos: [{ title: 'Bold', items: [
      { kind: 'shape', text: '', font: 'Cairo', bold: false, shape: 'circle', size: 2, x: 0.5, y: 0.5, color: '#ff5a36', background: 'none', backgroundColor: '#000000', curve: 0, letterSpacing: 0, angle: 0 },
      { kind: 'text', text: 'أحمد', font: 'Anton', bold: true, shape: 'circle', size: 0.2, x: 0.5, y: 0.5, color: 'red', background: 'pill', backgroundColor: '#16181d', curve: 30, letterSpacing: 200, angle: 0 },
      { kind: 'shape', text: '', font: 'Cairo', bold: false, shape: 'spaceship', size: 0.2, x: 0.5, y: 0.5, color: '#000000', background: 'none', backgroundColor: '#000000', curve: 0, letterSpacing: 0, angle: 0 },
    ] }] },
  };
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push(j);
      const kind = JSON.stringify(j.output_config.format.schema).includes('logos') ? 'logos' : 'slogans';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text: JSON.stringify(answers[kind]) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  try {
    const s = await (await post('/api/ai/slogans', { about: 'my brother', tone: 'funny', lang: 'both' })).json();
    assert.deepStrictEqual(s.slogans.map((x) => x.text), ['أحلى أخ في الدنيا', 'Best Bro Ever']);
    assert.strictEqual(s.slogans[1].font, 'Bebas Neue'); // an Arabic font on English text is replaced
    assert.strictEqual(s.left, 14);
    assert.strictEqual(seen[0].model, 'claude-haiku-5-5');
    assert.strictEqual(seen[0].output_config.format.type, 'json_schema');
    assert.strictEqual(seen[0].output_config.effort, 'low');
    assert.strictEqual(seen[0].temperature, undefined);

    assert.strictEqual((await post('/api/ai/logos', { name: '  ' })).status, 400);
    const l = await (await post('/api/ai/logos', { name: 'أحمد', style: 'sporty', garment: '#1f2023' })).json();
    const items = l.logos[0].items;
    assert.strictEqual(items.length, 2); // unknown shape dropped
    assert.strictEqual(items[0].w, 0.95); // size clamped
    assert.deepStrictEqual([items[1].font, items[1].fill, items[1].bgShape, items[1].curve, items[1].spacing], ['Lalezar', '#16181d', 'pill', 30, undefined]);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    mock.close();
  }
});

test('new orders notify the shop on WhatsApp and email, and email the customer', async () => {
  const http = require('http');
  const got = { email: [], whatsapp: [] };
  let failWhatsApp = false;
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url.startsWith('/email')) {
        got.email.push({ key: req.headers['api-key'], ...JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end('{"messageId":"x"}');
      }
      const u = new URL(req.url, 'http://x');
      got.whatsapp.push(Object.fromEntries(u.searchParams));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(failWhatsApp ? '<p>APIKey is invalid</p>' : '<p>Message queued. You will receive it in a few seconds.</p>');
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const m = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, {
    BREVO_API_KEY: 'brevo-test', BREVO_API_URL: `${m}/email`, MAIL_FROM: 'shop@example.com', ADMIN_EMAIL: 'owner@example.com',
    CALLMEBOT_PHONE: '+201000000000', CALLMEBOT_APIKEY: '123456', CALLMEBOT_URL: `${m}/wa`, SHOP_WHATSAPP: '+20 100 000 0000',
  });
  const waitFor = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 30)); };
  try {
    assert.strictEqual((await (await fetch(base + '/api/products')).json()).contact.whatsapp, '201000000000');
    assert.deepStrictEqual(await (await admin('/api/admin/notifications')).json(), { adminWhatsApp: true, adminEmail: true, customerEmail: true, customerWhatsAppButton: true });

    const d = await makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: SIDE } });
    const res = await post('/api/orders', { customer: { ...CUSTOMER, email: 'sara@example.com', notes: 'Ring <twice>' }, designIds: [d.id] }, { 'x-lang': 'en' });
    assert.strictEqual(res.status, 201);
    const order = await res.json();
    await waitFor(() => got.email.length === 2 && got.whatsapp.length === 1);

    const wa = got.whatsapp[0];
    assert.strictEqual(wa.phone, '+201000000000');
    assert.strictEqual(wa.apikey, '123456');
    assert.match(wa.text, new RegExp(`طلب جديد ${order.number}`));
    assert.match(wa.text, /01012345678/);
    assert.match(wa.text, /\/admin$/);

    const toAdmin = got.email.find((e) => e.to[0].email === 'owner@example.com');
    const toCustomer = got.email.find((e) => e.to[0].email === 'sara@example.com');
    assert.strictEqual(toAdmin.key, 'brevo-test');
    assert.deepStrictEqual(toAdmin.sender, { email: 'shop@example.com', name: 'OneOff Print' });
    assert.match(toAdmin.subject, new RegExp(order.number));
    assert.match(toAdmin.htmlContent, /Ring &lt;twice&gt;/); // customer text is escaped
    assert.match(toCustomer.subject, /We received your order/); // the customer ordered in English
    assert.match(toCustomer.htmlContent, new RegExp(`/order\\?id=${order.id}`));
    assert.doesNotMatch(toCustomer.htmlContent, /01012345678/); // no phone number in the customer email

    await new Promise((r) => setTimeout(r, 100)); // the result is saved right after sending
    const again = (await (await admin('/api/admin/orders')).json()).orders.find((o) => o.id === order.id);
    assert.deepStrictEqual([again.notifications.adminWhatsApp, again.notifications.adminEmail, again.notifications.customerEmail], ['sent', 'sent', 'sent']);

    // A failing channel is recorded but never blocks the order.
    failWhatsApp = true;
    const t = await (await admin('/api/admin/notifications/test', { method: 'POST' })).json();
    assert.strictEqual(t.adminWhatsApp, 'failed');
    assert.match(t.adminWhatsAppError, /invalid/i);
    assert.strictEqual(t.adminEmail, 'sent');
  } finally {
    for (const k of ['BREVO_API_KEY', 'BREVO_API_URL', 'MAIL_FROM', 'ADMIN_EMAIL', 'CALLMEBOT_PHONE', 'CALLMEBOT_APIKEY', 'CALLMEBOT_URL', 'SHOP_WHATSAPP']) delete process.env[k];
    mock.close();
  }
});

test('ready-made designs: starter catalog, owner adds from a share link, hides and deletes', async () => {
  const lib = await (await fetch(base + '/api/library')).json();
  assert.ok(lib.designs.length >= 25, 'starter designs');
  const cats = new Set(lib.designs.map((d) => d.category));
  for (const c of ['funny', 'ramadan', 'football']) assert.ok(cats.has(c), c);
  const one = await (await fetch(base + '/api/library/' + lib.designs[0].id)).json();
  assert.strictEqual(one.kind, 'template');
  assert.ok(one.items.length > 0);
  assert.strictEqual((await fetch(base + '/api/library/nope')).status, 404);

  // The owner shares a design from the editor, then adds it to the shop.
  const preview = 'data:image/png;base64,' + png(60, 72).toString('base64');
  const sh = await (await post('/api/shares', { productId: 'hoodie', color: 'black', size: 'L', sides: { front: { objects: [{ type: 'i-text', text: 'Shop design', left: 250, top: 300 }] } }, previews: { front: preview } })).json();
  assert.strictEqual((await admin('/api/admin/library', { method: 'POST', body: JSON.stringify({ share: `http://x/s/${sh.id}` }) })).status, 400); // a name is required
  const added = await (await admin('/api/admin/library', { method: 'POST', body: JSON.stringify({ share: `https://shop.example/s/${sh.id}`, nameAr: 'تصميم المحل', category: 'funny' }) })).json();
  assert.match(added.id, /^c-[0-9a-f]{12}$/);
  assert.strictEqual(added.product, 'hoodie');
  const full = await (await fetch(base + '/api/library/' + added.id)).json();
  assert.strictEqual(full.objects[0].text, 'Shop design');
  assert.ok(full.area && full.area.w > 0);
  assert.strictEqual((await fetch(base + added.preview)).headers.get('content-type'), 'image/png');
  assert.strictEqual((await (await fetch(base + '/api/library')).json()).designs[0].id, added.id); // newest first

  // Hide a starter design, delete the owner's one.
  assert.strictEqual((await admin(`/api/admin/library/${one.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: true }) })).status, 200);
  assert.ok(!(await (await fetch(base + '/api/library')).json()).designs.some((d) => d.id === one.id));
  assert.strictEqual((await fetch(base + '/api/library/' + one.id)).status, 404);
  assert.ok((await (await admin('/api/admin/library')).json()).designs.find((d) => d.id === one.id).hidden);
  await admin(`/api/admin/library/${one.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
  assert.strictEqual((await admin(`/api/admin/library/${one.id}`, { method: 'DELETE' })).status, 404); // starter designs can only be hidden
  assert.strictEqual((await admin(`/api/admin/library/${added.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await fetch(base + '/api/library/' + added.id)).status, 404);
  assert.strictEqual((await fetch(base + '/api/library')).status, 200);
  assert.strictEqual((await fetch(base + '/api/admin/library')).status, 401);
});

test('personalised books: create, preview pages, edit, order, print PDF', async () => {
  const sharp = require('sharp');
  const face = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#c99' } })
    .composite([{ input: Buffer.from('<svg width="500" height="500"><circle cx="250" cy="250" r="160" fill="#e8b996"/><circle cx="190" cy="220" r="18" fill="#222"/><circle cx="310" cy="220" r="18" fill="#222"/><path d="M180 320 Q250 380 320 320" stroke="#922" stroke-width="12" fill="none"/></svg>') }])
    .jpeg().toBuffer();
  const dataUrl = 'data:image/jpeg;base64,' + face.toString('base64');
  const answers = { name: 'يوسف', gender: 'boy', birthday: '2019-03-12', city: 'القاهرة', father: 'أحمد', mother: 'منى', fruit: 'mango', animal: 'cat', friend: 'عمر' };

  const list = await (await fetch(base + '/api/books')).json();
  assert.deepStrictEqual(list.books.map((b) => b.id).sort(), ['dream-jobs', 'space-hero']);

  // Missing answer and missing photo are refused.
  const noName = await post('/api/books/space-hero/designs', { answers: { ...answers, name: '' }, face: dataUrl });
  assert.strictEqual(noName.status, 400);
  const noPhoto = await post('/api/books/space-hero/designs', { answers });
  assert.strictEqual(noPhoto.status, 400);

  const res = await post('/api/books/space-hero/designs', { answers, lang: 'ar', face: dataUrl, size: 'hard' });
  assert.strictEqual(res.status, 201);
  const d = await res.json();
  assert.ok(d.editToken && d.pages === 14 && d.price === 850);
  assert.strictEqual(d.answers, undefined, 'answers are not echoed');
  const page = await fetch(`${base}/api/books/designs/${d.id}/pages/4.jpg`);
  assert.strictEqual(page.status, 200);
  assert.strictEqual((await sharp(Buffer.from(await page.arrayBuffer())).metadata()).width, 720);
  assert.strictEqual((await fetch(base + d.previewUrl)).status, 200);

  // Edit without the token is refused; with it the answers change.
  const put = (body, token) => fetch(`${base}/api/books/designs/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-edit-token': token } : {}) }, body: JSON.stringify(body) });
  assert.strictEqual((await put({ answers }, null)).status, 403);
  const upd = await put({ answers: { ...answers, name: 'Laila', gender: 'girl' }, lang: 'en', size: 'soft' }, d.editToken);
  assert.strictEqual(upd.status, 200);
  assert.strictEqual((await upd.json()).price, 650);
  const back = await (await fetch(`${base}/api/books/designs/${d.id}`, { headers: { 'x-edit-token': d.editToken } })).json();
  assert.strictEqual(back.answers.name, 'Laila');

  // Colouring book makes the line-art face too.
  const cb = await (await post('/api/books/dream-jobs/designs', { answers: { name: 'ليلى', gender: 'girl' }, face: dataUrl })).json();
  assert.strictEqual((await fetch(`${base}/api/books/designs/${cb.id}/pages/3.jpg`)).status, 200);

  // Order both; the admin gets a print-ready PDF; the book can no longer be edited.
  const order = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id, cb.id] });
  assert.strictEqual(order.status, 201);
  const o = await order.json();
  assert.ok(o.items.every((i) => i.kind === 'book'));
  assert.strictEqual((await put({ answers }, d.editToken)).status, 403);
  const pdf = await admin(`/api/admin/files/${d.id}/book?format=book-pdf`);
  assert.strictEqual(pdf.status, 200);
  const buf = Buffer.from(await pdf.arrayBuffer());
  const bprev = Buffer.from(await (await admin(`/api/admin/files/${d.id}/book?format=preview-pdf`)).arrayBuffer());
  assert.strictEqual((bprev.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 14, 'every book page');
  assert.strictEqual(buf.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual((buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 14);
});

test('AI books: one cartoon face for the preview, every page redrawn after the order', async () => {
  const http = require('http');
  const sharp = require('sharp');
  const calls = [];
  // A stand-in for the Gemini API: returns an image tinted orange so we can tell it was used.
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const j = JSON.parse(body || '{}');
      calls.push({ url: req.url, key: req.headers['x-goog-api-key'], parts: j.contents[0].parts.length, config: j.generationConfig });
      const size = j.generationConfig && j.generationConfig.imageConfig && j.generationConfig.imageConfig.imageSize === '2K' ? 2048 : 768;
      const img = await sharp({ create: { width: size, height: size, channels: 3, background: '#ff8800' } }).png().toBuffer();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: img.toString('base64') } }] }, finishReason: 'STOP' }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  try {
    const face = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d9a27e' } }).jpeg().toBuffer();
    const dataUrl = 'data:image/jpeg;base64,' + face.toString('base64');
    const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
    assert.strictEqual((await (await fetch(base + '/api/books/space-hero')).json()).ai, true);

    const d = await (await post('/api/books/space-hero/designs', { answers, face: dataUrl, aiConsent: true })).json();
    assert.strictEqual(d.cartoon, 'ready', 'preview uses the AI cartoon face');
    assert.strictEqual(calls.length, 1, 'only one image for the preview');
    assert.ok(/:generateContent$/.test(calls[0].url) && calls[0].key === 'test-key' && calls[0].parts === 3);
    // Changing an answer does not make another image.
    await fetch(`${base}/api/books/designs/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-edit-token': d.editToken }, body: JSON.stringify({ answers: { ...answers, friend: 'Salma' }, aiConsent: true }) });
    assert.strictEqual(calls.length, 1);

    // Without consent: no AI at all.
    const plain = await (await post('/api/books/space-hero/designs', { answers, face: dataUrl })).json();
    assert.strictEqual(plain.cartoon, 'off');
    assert.strictEqual(calls.length, 1);

    const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id, plain.id] })).json();
    const itemId = order.items.find((i) => i.designId === d.id).id;
    let item;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const q = await (await admin('/api/admin/orders')).json();
      item = q.orders.flatMap((o) => o.items).find((it) => it.id === itemId);
      if (item.redraw && item.redraw.status === 'done') break;
    }
    assert.strictEqual(item.redraw.status, 'done');
    assert.strictEqual(item.redraw.done, 12);
    assert.strictEqual(calls.length, 13, '1 preview + 12 redrawn pages');
    assert.ok(calls.slice(1).every((c) => c.config.imageConfig.imageSize === '2K'));
    const plainItem = (await (await admin('/api/admin/orders')).json()).orders.flatMap((o) => o.items).find((it) => it.designId === plain.id);
    assert.strictEqual(plainItem.redraw.status, 'off');

    // The redrawn page is used in the book (orange from the mock).
    const page = await fetch(`${base}/api/books/designs/${d.id}/pages/4.jpg?v=x`);
    const st = await sharp(Buffer.from(await page.arrayBuffer())).extract({ left: 20, top: 20, width: 60, height: 60 }).stats();
    assert.ok(st.channels[0].mean > 200 && st.channels[2].mean < 80, 'page 4 shows the redrawn picture');
    const pdf = await admin(`/api/admin/files/${d.id}/book?format=book-pdf`);
    assert.strictEqual(pdf.status, 200);
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_BASE;
    mock.close();
  }
});

test('AI books: an AQ. key the Gemini API rejects is used on Vertex AI', async () => {
  const http = require('http');
  const sharp = require('sharp');
  const urls = [];
  const mock = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      urls.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      if (!/publishers\/google/.test(req.url)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }));
      }
      const img = await sharp({ create: { width: 768, height: 1024, channels: 3, background: '#ff8800' } }).png().toBuffer();
      res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: img.toString('base64') } }] }, finishReason: 'STOP' }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.GEMINI_API_KEY = 'AQ.test-key';
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  const file = require.resolve('../src/cartoon');
  const cached = require.cache[file];
  delete require.cache[file];
  try {
    const cartoon = require('../src/cartoon');
    const face = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d9a27e' } }).jpeg().toBuffer();
    const out = await cartoon.cartoonFace(face, face, 'story');
    assert.ok(out.length > 0);
    assert.strictEqual(urls.length, 2, 'Gemini API first, then Vertex AI');
    await cartoon.cartoonFace(face, face, 'story');
    assert.strictEqual(urls.length, 3, 'remembers Vertex AI');
    assert.ok(/publishers\/google/.test(urls[2]));
  } finally {
    require.cache[file] = cached;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_BASE;
    mock.close();
  }
});

test('AI and EPS files are drawn to a transparent PNG for the editor', async () => {
  const sharp = require('sharp');
  const eps = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n%%EndComments\n1 0 0 setrgbcolor newpath 100 50 40 0 360 arc fill\nshowpage\n%%EOF\n');
  const send = (body) => fetch(base + '/api/artwork', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': '800' }, body });
  let r = await send(eps);
  assert.strictEqual(r.status, 200);
  const out = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.format, 'png');
  assert.strictEqual(meta.channels, 4);
  assert.ok(Math.abs(meta.width - meta.height) <= 2 && meta.width > 300, 'trimmed to the circle');
  // An .ai file saved "PDF compatible" is a PDF inside.
  const PDF = require('pdfkit');
  const ai = await new Promise((resolve) => { const d = new PDF({ size: [600, 300] }); const b = []; d.on('data', (c) => b.push(c)); d.on('end', () => resolve(Buffer.concat(b))); d.rect(50, 50, 200, 100).fill('#0055ff'); d.end(); });
  r = await send(ai);
  assert.strictEqual(r.status, 200);
  const m2 = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.ok(m2.width > m2.height * 1.8, 'the rectangle, 2:1');
  // Not a design file / nothing drawn.
  assert.strictEqual((await send(Buffer.from('just text'))).status, 400);
  assert.strictEqual((await send(Buffer.from('%!PS\nshowpage\n'))).status, 400);
});

const png4 = (w, h) => png(w, h);
test('two copies of the app on one data folder share orders, sign-ins and edits', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-two-'));
  const start = (a) => new Promise((resolve) => { const s = a.listen(0, () => resolve(s)); });
  const A = await start(make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', limits: OPEN_LIMITS, cleanupEvery: 0 }));
  const B = await start(make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', limits: OPEN_LIMITS, cleanupEvery: 0 }));
  const at = (s) => `http://127.0.0.1:${s.address().port}`;
  const j = (url, body, headers = {}) => fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  try {
    // Designs made on alternating copies, then orders placed on both.
    const designs = [];
    for (let i = 0; i < 6; i++) {
      const srv = i % 2 ? B : A;
      const d = await (await j(`${at(srv)}/api/designs`, { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'rect' }] } } } })).json();
      const png = png4(3600, 4800);
      await fetch(`${at(srv)}/api/designs/${d.id}/files/front-print.png`, { method: 'PUT', headers: { 'x-upload-token': d.uploadToken }, body: png });
      await fetch(`${at(srv)}/api/designs/${d.id}/files/front-preview.png`, { method: 'PUT', headers: { 'x-upload-token': d.uploadToken }, body: png4(600, 720) });
      const done = await fetch(`${at(i % 2 ? A : B)}/api/designs/${d.id}/complete`, { method: 'POST', headers: { 'x-upload-token': d.uploadToken } });
      assert.strictEqual(done.status, 200, 'a design started on one copy can be finished on the other');
      designs.push(d.id);
    }
    const o1 = await (await j(`${at(A)}/api/orders`, { customer: CUSTOMER, designIds: designs.slice(0, 3) })).json();
    const o2 = await (await j(`${at(B)}/api/orders`, { customer: CUSTOMER, designIds: designs.slice(3) })).json();
    assert.notStrictEqual(o1.number, o2.number, 'order numbers are unique across copies');

    // Sign in on A, use the session on B; both orders are visible on both copies.
    const { token } = await (await j(`${at(A)}/api/admin/login`, { password: 'Str0ng!Passw0rd-2026' })).json();
    const auth = { Authorization: `Bearer ${token}` };
    for (const srv of [A, B]) {
      const r = await fetch(`${at(srv)}/api/admin/orders`, { headers: auth });
      assert.strictEqual(r.status, 200);
      const ids = (await r.json()).orders.map((o) => o.id);
      assert.ok(ids.includes(o1.id) && ids.includes(o2.id), 'both orders on both copies');
    }
    // Status change on B is not lost when A saves something else.
    const itemId = o1.items[0].id;
    assert.strictEqual((await fetch(`${at(B)}/api/admin/items/${itemId}`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'printing' }) })).status, 200);
    await j(`${at(A)}/api/designs`, { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'rect' }] } } } });
    const after = (await (await fetch(`${at(A)}/api/admin/orders`, { headers: auth })).json()).orders.flatMap((o) => o.items).find((i) => i.id === itemId);
    assert.strictEqual(after.status, 'printing');
    // Sign out on B ends the session on A too.
    await fetch(`${at(B)}/api/admin/logout`, { method: 'POST', headers: auth });
    assert.strictEqual((await fetch(`${at(A)}/api/admin/queue`, { headers: auth })).status, 401);
    // The file on disk has everything.
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.strictEqual(db.orders.length, 2);
    assert.strictEqual(Object.keys(db.designs).length, 7);
  } finally {
    A.close();
    B.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
