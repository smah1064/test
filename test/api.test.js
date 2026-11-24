'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../src/app');
const PRODUCTS_BY_ID = Object.fromEntries(require('../src/products').PRODUCTS.map((p) => [p.id, p]));

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
  app = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false });
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
  const app2 = make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', cleanupEvery: 0, requireApproval: false });
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
  const app2 = make({ dataDir: dir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false, limits: { designs: [{ max: 2, ms: 60e3 }], orders: [{ max: 1, ms: 60e3 }] } });
  const s2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  const at = `http://127.0.0.1:${s2.address().port}`;
  try {
    const mk = () => fetch(at + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'rect' }] } } } }) });
    const first = await mk();
    assert.strictEqual(first.status, 201);
    const d1 = await first.json();
    const designId = d1.id;
    const secondRes = await mk();
    assert.strictEqual(secondRes.status, 201);
    const d2 = await secondRes.json();
    const finish = async (d) => {
      for (const name of d.files) {
        const body = name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW;
        await fetch(`${at}/api/designs/${d.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': d.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
      }
      const done = await fetch(`${at}/api/designs/${d.id}/complete`, { method: 'POST', headers: { 'x-upload-token': d.uploadToken } });
      assert.strictEqual(done.status, 200, await done.clone().text());
    };
    const third = await mk();
    assert.strictEqual(third.status, 429);
    // A made-up X-Forwarded-For entry does not get around the limit: the
    // hosting proxy appends the real address (here 127.0.0.1) after it.
    const spoof = await fetch(at + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9, 127.0.0.1' }, body: '{}' });
    assert.strictEqual(spoof.status, 429);
    const order = (designIds) => fetch(at + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer: CUSTOMER, designIds }) });
    // Mistakes in the form don't use up the limit (customers can fix a typo)...
    assert.strictEqual((await order([])).status, 400);
    assert.strictEqual((await order([])).status, 400);
    assert.strictEqual((await order([designId])).status, 400, 'design not finished');
    assert.strictEqual((await order([designId])).status, 400, 'still not counted');
    // ...orders that pass every check do.
    await finish(d1);
    await finish(d2);
    assert.strictEqual((await order([d1.id])).status, 201);
    assert.strictEqual((await order([d2.id])).status, 429);
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
  const app2 = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false });
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
  // A 30 x 40 poster prints 30 cm wide (the 45 x 60 one 45 cm).
  const wIn = require('../src/products').printWidthFor(require('../src/products').getProduct('poster'), { printWidthIn: 17.7 }, '30x40');
  assert.ok(Math.abs(wIn * 2.54 - 30) < 0.1);
  assert.strictEqual(meta.density, Math.round(3600 / (wIn + 0.25)), 'DPI embedded');
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
  // Page = trim + bleed: 11.8 x 15.7 in (30 x 40 cm) + 2 x 0.125 in.
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdfText);
  assert.ok(Math.abs(Number(mb[1]) - (wIn + 0.25) * 72) < 0.5, 'page width ' + mb[1]);

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

test('the DTF film holds one transfer per piece of an item', async () => {
  const filmFor = async (body) => {
    const d = await makeDesign({ productId: 'polo', color: 'black', size: 'L', sides: { front: SIDE }, ...body });
    const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
    const itemId = order.items[0].id;
    assert.strictEqual((await admin(`/api/admin/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ process: 'dtf' }) })).status, 200);
    const film = await admin('/api/admin/dtf-film', { method: 'POST', body: JSON.stringify({ itemIds: [itemId] }) });
    assert.strictEqual(film.status, 200);
    const pdf = Buffer.from(await film.arrayBuffer()).toString('latin1');
    return { length: Number(film.headers.get('x-film-length-in')), labels: (pdf.match(/ · Front · /g) || []).length };
  };
  const one = await filmFor({});
  const six = await filmFor({ quantities: [{ color: 'black', size: 'L', qty: 2 }, { color: 'black', size: 'XL', qty: 4 }] });
  assert.ok(six.length > one.length, `${six.length} in for 6 pieces vs ${one.length} in for 1`);
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
  const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };

  // The books are printed in English: Arabic letters would scramble the sentences.
  const arabic = await post('/api/books/space-hero/designs', { answers: { ...answers, name: 'يوسف' }, face: dataUrl });
  assert.strictEqual(arabic.status, 400);
  assert.match((await arabic.json()).error, /English letters/);

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
  const cb = await (await post('/api/books/dream-jobs/designs', { answers: { name: 'Laila', gender: 'girl' }, face: dataUrl })).json();
  assert.strictEqual((await fetch(`${base}/api/books/designs/${cb.id}/pages/3.jpg`)).status, 200);

  // A girl gets the girl pictures (every page that shows the child has one).
  const fs = require('fs');
  const path = require('path');
  const books = require('../src/books');
  for (const book of Object.values(books.BOOKS)) {
    for (const page of book.pages.filter((pg) => pg.img && pg.face)) {
      const ext = book.kind === 'coloring' && page.type !== 'cover' ? 'png' : 'jpg';
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'book-assets', book.dir, `${page.img}-girl.${ext}`)), `${book.dir}/${page.img} has a girl picture`);
    }
  }
  const pageOf = async (gender) => (await books.renderPage({ book: books.BOOKS['space-hero'], answers: { name: 'Sam', gender, city: 'Cairo', father: 'A', mother: 'B' } }, 2, 200, { noText: true })).raw().toBuffer();
  assert.notDeepStrictEqual(await pageOf('girl'), await pageOf('boy'));

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
  // A real-size file with a photo in it, drawn at full size (3000 px): Ghostscript's
  // banded mode crashed here ("memory access out of bounds") before -dMaxBitmap.
  const photo = await sharp({ create: { width: 1600, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg().toBuffer();
  const big = await new Promise((resolve) => { const d = new PDF({ size: [600, 400] }); const b = []; d.on('data', (c) => b.push(c)); d.on('end', () => resolve(Buffer.concat(b))); d.image(photo, 40, 40, { width: 400 }); d.fontSize(40).text('Logo', 450, 100); d.end(); });
  r = await fetch(base + '/api/artwork', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': '3000' }, body: big });
  assert.strictEqual(r.status, 200, await r.clone().text());
  assert.ok((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width > 2000);
  // Illustrator EPS files often have a white artboard behind the design: it becomes transparent,
  // white parts inside the design stay.
  const boxed = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 300 200\n%%EndComments\n1 1 1 setrgbcolor 0 0 300 200 rectfill\n0.1 0.2 0.6 setrgbcolor newpath 150 100 70 0 360 arc fill\n1 1 1 setrgbcolor 135 85 30 30 rectfill\nshowpage\n%%EOF\n');
  r = await send(boxed);
  assert.strictEqual(r.status, 200);
  const cut = Buffer.from(await r.arrayBuffer());
  const cm = await sharp(cut).metadata();
  assert.ok(Math.abs(cm.width - cm.height) <= 2, 'trimmed to the circle, not the white page');
  const at = async (fx, fy) => [...(await sharp(cut).extract({ left: Math.floor(cm.width * fx), top: Math.floor(cm.height * fy), width: 1, height: 1 }).raw().toBuffer())];
  assert.strictEqual((await at(0.02, 0.02))[3], 0, 'white artboard removed');
  assert.deepStrictEqual((await at(0.5, 0.5)).slice(0, 4), [255, 255, 255, 255], 'white inside the design kept');
  // Not a design file / nothing drawn.
  assert.strictEqual((await send(Buffer.from('just text'))).status, 400);
  assert.strictEqual((await send(Buffer.from('%!PS\nshowpage\n'))).status, 400);
});

test('printing houses: per-product default, send by email or WhatsApp with signed links', async () => {
  const http = require('http');
  const mails = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { mails.push(JSON.parse(body)); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"messageId":"x"}'); });
  });
  await new Promise((r) => mock.listen(0, r));
  try {
    assert.strictEqual((await fetch(base + '/api/admin/houses')).status, 401);
    // Add two printing houses (Egyptian numbers become international).
    let r = await admin('/api/admin/houses', { method: 'POST', body: JSON.stringify({ name: 'Cairo Tees', email: 'jobs@cairotees.example', whatsapp: '010 1234 5678', prefer: 'email' }) });
    assert.strictEqual(r.status, 201);
    const tees = await r.json();
    assert.strictEqual(tees.whatsapp, '201012345678');
    r = await admin('/api/admin/houses', { method: 'POST', body: JSON.stringify({ name: 'Mug Masters', whatsapp: '+971 50 123 4567', prefer: 'email' }) });
    const mugs = await r.json();
    assert.strictEqual(mugs.prefer, 'whatsapp', 'no email, so WhatsApp');
    assert.strictEqual((await admin('/api/admin/houses', { method: 'POST', body: JSON.stringify({ name: 'Nobody' }) })).status, 400);
    // Default house per product.
    r = await admin('/api/admin/product-houses', { method: 'PUT', body: JSON.stringify({ productId: 'tshirt', houseId: tees.id }) });
    assert.deepStrictEqual((await r.json()).productHouses.tshirt, tees.id);
    const list = await (await admin('/api/admin/houses')).json();
    assert.strictEqual(list.houses.length, 2);
    assert.ok(list.products.some((p) => p.id === 'mug'));

    const d = await makeDesign({ sides: { front: SIDE, back: SIDE } });
    const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
    const itemId = order.items[0].id;
    const send = (body, lang = 'en') => admin(`/api/admin/items/${itemId}/send`, { method: 'POST', headers: { 'x-lang': lang }, body: JSON.stringify(body) });

    // Email without Brevo set up: a clear message.
    r = await send({ houseId: tees.id, channel: 'email', formats: ['pdf', 'preview-pdf'] });
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /Email is not set up/);

    Object.assign(process.env, { BREVO_API_KEY: 'brevo-test', BREVO_API_URL: `http://127.0.0.1:${mock.address().port}/email`, MAIL_FROM: 'shop@example.com' });
    r = await send({ houseId: tees.id, channel: 'email', formats: ['pdf', 'preview-pdf'], note: 'Rush please' });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const sent = await r.json();
    assert.strictEqual(sent.status, 'sent');
    assert.strictEqual(mails.length, 1);
    const mail = mails[0];
    assert.deepStrictEqual(mail.to, [{ email: 'jobs@cairotees.example' }]);
    assert.match(mail.subject, new RegExp(order.number));
    assert.deepStrictEqual(mail.attachment.map((a) => a.name).sort(), [`${order.number}-tshirt-back.pdf`, `${order.number}-tshirt-front.pdf`, `${order.number}-tshirt-preview.pdf`].sort());
    assert.match(mail.htmlContent, /Rush please/);
    assert.ok(!mail.htmlContent.includes(CUSTOMER.address), 'no customer address');
    assert.strictEqual(sent.item.sends.length, 1);
    assert.strictEqual(sent.item.sends[0].houseName, 'Cairo Tees');

    // The links in the email download the files, without signing in.
    const links = [...mail.textContent.matchAll(/https?:\/\/\S+\/dl\/(\S+)/g)].map((m) => m[1]);
    assert.strictEqual(links.length, 3);
    const dl = await fetch(`${base}/dl/${links[0]}`);
    assert.strictEqual(dl.status, 200);
    assert.strictEqual(Buffer.from(await dl.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    const bad = links[0].slice(0, -2) + (links[0].endsWith('AA') ? 'BB' : 'AA');
    assert.strictEqual((await fetch(`${base}/dl/${bad}`)).status, 404);

    // WhatsApp: a wa.me link with the job and links, for the admin to send.
    r = await send({ houseId: mugs.id, channel: 'whatsapp', formats: ['preview-pdf'] }, 'ar');
    const wa = await r.json();
    assert.strictEqual(wa.status, 'opened');
    assert.match(wa.whatsappUrl, /^https:\/\/wa\.me\/971501234567\?text=/);
    const text = decodeURIComponent(wa.whatsappUrl.split('text=')[1]);
    assert.match(text, /أهلًا Mug Masters/);
    assert.match(text, /\/dl\//);
    assert.strictEqual(mails.length, 1, 'no email for WhatsApp');
    r = await send({ houseId: mugs.id, channel: 'email', formats: ['pdf'] });
    assert.strictEqual(r.status, 400, 'house has no email');
    r = await send({ houseId: tees.id, channel: 'email', formats: ['nope'] });
    assert.strictEqual(r.status, 400);

    // Deleting a house clears it from products.
    await admin(`/api/admin/houses/${tees.id}`, { method: 'DELETE' });
    const after = await (await admin('/api/admin/houses')).json();
    assert.strictEqual(after.houses.length, 1);
    assert.strictEqual(after.productHouses.tshirt, undefined);
  } finally {
    for (const k of ['BREVO_API_KEY', 'BREVO_API_URL', 'MAIL_FROM']) delete process.env[k];
    mock.close();
  }
});

test('accounts: change prices, set costs, profit per order, expenses, CSV', async () => {
  assert.strictEqual((await fetch(base + '/api/admin/pricing')).status, 401);
  const pr = await (await admin('/api/admin/pricing')).json();
  const tee = pr.products.find((p) => p.id === 'tshirt');
  assert.strictEqual(tee.basePrice, 450);
  const put = (body) => admin('/api/admin/pricing/tshirt', { method: 'PUT', body: JSON.stringify(body) });
  try {
    // New price + 2XL surcharge, and costs.
    let r = await put({ basePrice: 500, extraSidePrice: 120, sizes: { '2XL': 70 }, costs: { blank: 150, printFirst: 60, printExtra: 40, other: 10, sizes: { '2XL': 20 } } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const row = await r.json();
    assert.strictEqual(row.basePrice, 500);
    assert.strictEqual(row.unitCost, 220);
    assert.strictEqual(row.unitProfit, 280);
    // The shop shows and charges the new price; other products keep theirs.
    const shop = await (await fetch(base + '/api/products')).json();
    assert.strictEqual(shop.products.find((p) => p.id === 'tshirt').basePrice, 500);
    assert.strictEqual(shop.products.find((p) => p.id === 'tshirt').sizes.find((z) => z.id === '2XL').surcharge, 70);
    assert.strictEqual(shop.products.find((p) => p.id === 'hoodie').sizes.find((z) => z.id === '2XL').surcharge, 50, 'hoodie keeps its own sizes');
    assert.strictEqual((await put({ basePrice: -5 })).status, 400);

    const d = await makeDesign({ size: '2XL', sides: { front: SIDE, back: SIDE } });
    const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
    assert.strictEqual(order.items[0].price, 500 + 70 + 120);
    // The report counts Cairo days (just after midnight in Cairo it is still yesterday in UTC).
    const today = require('../src/accounting').localDay(order.createdAt);

    // Later cost changes don't rewrite this order.
    await put({ basePrice: 500, extraSidePrice: 120, sizes: { '2XL': 70 }, costs: { blank: 999 } });
    await admin('/api/admin/accounts/settings', { method: 'PUT', body: JSON.stringify({ shippingCost: 45 }) });
    let rep = await (await admin(`/api/admin/accounts?from=${today}&to=${today}`)).json();
    let o = rep.orders.find((x) => x.id === order.id);
    assert.strictEqual(o.itemCost, 150 + 20 + 60 + 40 + 10);
    assert.strictEqual(o.shippingCost, 45);
    assert.strictEqual(o.profit, order.total - 280 - 45);

    // Correct the real cost of the item and the real shipping.
    await admin(`/api/admin/items/${order.items[0].id}/cost`, { method: 'PATCH', body: JSON.stringify({ actualCost: 300 }) });
    await admin(`/api/admin/orders/${order.id}/shipping-cost`, { method: 'PATCH', body: JSON.stringify({ actualShipping: 60 }) });
    const e = await (await admin('/api/admin/expenses', { method: 'POST', body: JSON.stringify({ date: today, amount: 1000, category: 'marketing', description: 'Facebook ads' }) })).json();
    assert.strictEqual((await admin('/api/admin/expenses', { method: 'POST', body: JSON.stringify({ date: 'x', amount: 5 }) })).status, 400);
    rep = await (await admin(`/api/admin/accounts?from=${today}&to=${today}`)).json();
    o = rep.orders.find((x) => x.id === order.id);
    assert.strictEqual(o.itemCost, 300);
    assert.strictEqual(o.profit, order.total - 300 - 60);
    assert.strictEqual(rep.totals.expenses, 1000);
    assert.strictEqual(rep.totals.netProfit, Math.round((rep.totals.grossProfit - 1000) * 100) / 100);
    assert.ok(rep.products.some((p) => p.productId === 'tshirt' && p.units >= 1));
    // Nothing in a range with no orders.
    const empty = await (await admin('/api/admin/accounts?from=2001-01-01&to=2001-01-31')).json();
    assert.strictEqual(empty.totals.orders, 0);

    const csv = await admin(`/api/admin/accounts.csv?from=${today}&to=${today}`);
    assert.match(csv.headers.get('content-disposition'), /accounts-.*\.csv/);
    const text = await csv.text();
    assert.ok(text.includes(order.number) && text.includes('Facebook ads') && text.includes('Net profit'));
    await admin(`/api/admin/expenses/${e.id}`, { method: 'DELETE' });
  } finally {
    // Back to the built-in prices for the other tests.
    await put({ basePrice: 450, extraSidePrice: 100, sizes: { '2XL': 50 }, costs: {} });
  }
  const back = await (await fetch(base + '/api/products')).json();
  assert.strictEqual(back.products.find((p) => p.id === 'tshirt').basePrice, 450);
});

test('moved print area: kept inside the garment zone, shown to the printer in cm', async () => {
  const products = (await (await fetch(base + '/api/products')).json()).products;
  assert.ok(products.find((p) => p.id === 'tshirt').sides[0].moveZone, 'tees can move');
  assert.ok(!products.find((p) => p.id === 'mug').sides[0].moveZone, 'mugs cannot');
  // 30 units lower, and far too far left (clamped to the zone).
  const d = await makeDesign({ sides: { front: { editor: { ...EDITOR, offset: { dx: -999, dy: 30 } } } } });
  const saved = await (await fetch(`${base}/api/designs/${d.id}`)).json();
  const zone = products.find((p) => p.id === 'tshirt').sides[0].moveZone;
  const area = products.find((p) => p.id === 'tshirt').sides[0].printArea;
  assert.deepStrictEqual(saved.editor.front.offset, { dx: zone.x - area.x, dy: 30 });
  assert.ok(saved.sides[0].offsetCm.y > 5 && saved.sides[0].offsetCm.x < 0);
  // A product that can't move ignores it.
  const mug = await makeDesign({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { ...EDITOR, offset: { dx: 0, dy: 40 } } } } });
  const m = await (await fetch(`${base}/api/designs/${mug.id}`)).json();
  assert.strictEqual(m.editor.front.offset, undefined);
  assert.strictEqual(m.sides[0].offsetCm, undefined);
  // The admin sees it on the order.
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
  const q = await (await admin('/api/admin/queue')).json();
  const it = q.waiting.find((i) => i.orderId === order.id);
  assert.deepStrictEqual(it.sides[0].offsetCm, saved.sides[0].offsetCm);
});

test('AI background removal: route answers clearly when the model is not available', async () => {
  const before = process.env.BG_MODEL_PATH;
  process.env.BG_MODEL_PATH = path.join(os.tmpdir(), 'no-such-model.onnx');
  try {
    assert.deepStrictEqual(await (await fetch(base + '/api/remove-bg')).json(), { ai: true });
    const img = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    const r = await fetch(base + '/api/remove-bg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: img });
    assert.strictEqual(r.status, 503, 'the editor then uses the quick plain-background method');
    assert.strictEqual((await fetch(base + '/api/remove-bg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('x') })).status, 400);
  } finally {
    if (before === undefined) delete process.env.BG_MODEL_PATH;
    else process.env.BG_MODEL_PATH = before;
  }
});

test('coupons: admin creates them, checkout applies them, limits hold', async () => {
  const mk = (body) => admin('/api/admin/coupons', { method: 'POST', body: JSON.stringify(body) });
  assert.strictEqual((await fetch(base + '/api/admin/coupons')).status, 401);
  assert.strictEqual((await mk({ code: 'a', type: 'percent', value: 10 })).status, 400, 'code too short');
  let r = await mk({ code: 'eid 20', type: 'percent', value: 20, maxDiscount: 100, perCustomer: 1 });
  assert.strictEqual(r.status, 201);
  const eid = await r.json();
  assert.strictEqual(eid.code, 'EID20');
  assert.strictEqual((await mk({ code: 'EID20', type: 'fixed', value: 5 })).status, 409, 'unique code');
  await mk({ code: 'SHIPFREE', type: 'freeship', minOrder: 100 });
  await mk({ code: 'HOMEONLY', type: 'fixed', value: 50, categories: ['home'] });
  await mk({ code: 'OLD', type: 'fixed', value: 50, endsOn: '2001-01-31' });

  const d = await makeDesign({ size: 'M' });
  const quote = (couponCode) => post('/api/cart/quote', { designIds: [d.id], couponCode }).then((x) => x.json());
  let q = await quote('eid20');
  assert.strictEqual(q.coupon.discount, Math.min(100, Math.round(d.price * 20) / 100));
  assert.strictEqual(q.total, Math.round((d.price - q.discount + q.shipping) * 100) / 100);
  q = await quote('SHIPFREE');
  assert.strictEqual(q.shipping, 0);
  q = await quote('HOMEONLY');
  assert.match(q.couponError, /does not apply/);
  q = await quote('OLD');
  assert.match(q.couponError, /expired/);
  q = await quote('NOPE');
  assert.match(q.couponError, /not valid/);

  // Order with the coupon: the discount is on the order, and the same phone can't use it twice.
  q = await quote('EID20');
  r = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: 'EID20', expectedTotal: q.total });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const order = await r.json();
  assert.strictEqual(order.discount, q.discount);
  assert.strictEqual(order.coupon, 'EID20');
  assert.strictEqual(order.total, q.total);
  const d2 = await makeDesign({ size: 'M' });
  r = await post('/api/orders', { customer: CUSTOMER, designIds: [d2.id], couponCode: 'EID20' });
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).error, /already used/);
  // Admin sees the use and the discount given.
  const list = await (await admin('/api/admin/coupons')).json();
  const row = list.coupons.find((c) => c.code === 'EID20');
  assert.strictEqual(row.uses, 1);
  assert.strictEqual(row.discountGiven, order.discount);
  // Pausing it stops it.
  await admin(`/api/admin/coupons/${eid.id}`, { method: 'PUT', body: JSON.stringify({ ...row, active: false }) });
  assert.match((await post('/api/cart/quote', { designIds: [d2.id], couponCode: 'EID20' }).then((x) => x.json())).couponError, /not valid/);
  // Renaming a used code keeps its uses (they are counted by the coupon, not its code).
  r = await admin(`/api/admin/coupons/${eid.id}`, { method: 'PUT', body: JSON.stringify({ ...row, code: 'EID21', active: true }) });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const renamed = (await (await admin('/api/admin/coupons')).json()).coupons.find((c) => c.code === 'EID21');
  assert.strictEqual(renamed.uses, 1);
  r = await post('/api/orders', { customer: CUSTOMER, designIds: [d2.id], couponCode: 'EID21' });
  assert.strictEqual(r.status, 409, 'still used by this phone');
});

test('accounts report: coupon discounts are shared over the products', () => {
  const accounting = require('../src/accounting');
  const it = (id, productId, price) => ({ id, productId, productName: { en: productId }, price, status: 'queued', sides: [{}] });
  const orders = [{ id: 'o1', number: 1, createdAt: new Date().toISOString(), customer: { name: 'x' }, items: [it('a', 'tshirt', 450), it('b', 'mug', 310)], subtotal: 760, discount: 76, coupon: { code: 'SAVE10' }, shipping: 75, total: 759 }];
  const r = accounting.report({ orders, costs: {}, expenses: [], settings: {} });
  const by = Object.fromEntries(r.products.map((p) => [p.productId, p]));
  assert.strictEqual(by.tshirt.sales + by.mug.sales, 760 - 76);
  assert.strictEqual(by.tshirt.sales, 405);
  assert.strictEqual(by.mug.sales, 279);
});

test('customer accounts: sign up, sign in, orders, address, password', async () => {
  const call = (url, body, cookie, method = 'POST') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
  assert.deepStrictEqual((await (await fetch(base + '/api/account')).json()).customer, null);
  assert.strictEqual((await call('/api/account/signup', { name: 'Mona', phone: '01112223334', password: 'short' })).status, 400);
  let r = await call('/api/account/signup', { name: 'Mona Ali', phone: '0111 222 3334', email: 'Mona@Example.com', password: 'longenough1' });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const c1 = cookieOf(r);
  assert.match(c1, /^pod_c=/);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.strictEqual((await r.json()).customer.phone, '01112223334');
  assert.strictEqual((await call('/api/account/signup', { name: 'Other', phone: '01112223334', password: 'longenough2' })).status, 409, 'phone taken');
  // Wrong password / right password (by phone or email).
  assert.strictEqual((await call('/api/account/login', { login: '01112223334', password: 'nope-nope' })).status, 401);
  r = await call('/api/account/login', { login: 'mona@example.com', password: 'longenough1' });
  assert.strictEqual(r.status, 200);
  const c2 = cookieOf(r);
  assert.strictEqual((await (await fetch(base + '/api/account', { headers: { cookie: c2 } })).json()).customer.name, 'Mona Ali');
  // An order placed while signed in is in the account, and its address is kept.
  const d = await makeDesign();
  r = await fetch(base + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c2 }, body: JSON.stringify({ customer: { ...CUSTOMER, phone: '01112223334' }, designIds: [d.id] }) });
  assert.strictEqual(r.status, 201);
  const order = await r.json();
  const mine = await (await fetch(base + '/api/account/orders', { headers: { cookie: c2 } })).json();
  assert.deepStrictEqual(mine.orders.map((o) => o.id), [order.id]);
  assert.strictEqual((await fetch(base + '/api/account/orders')).status, 401, 'signed out');
  const me = (await (await fetch(base + '/api/account', { headers: { cookie: c2 } })).json()).customer;
  assert.strictEqual(me.address.city, CUSTOMER.city);
  // Profile update; password change signs out the other device.
  r = await call('/api/account', { name: 'Mona A.', email: '', address: { governorate: 'giza', city: 'Dokki', address: 'X st' } }, c2, 'PUT');
  assert.strictEqual((await r.json()).customer.address.city, 'Dokki');
  assert.strictEqual((await call('/api/account/password', { current: 'wrong', password: 'newpassword9' }, c2)).status, 401);
  r = await call('/api/account/password', { current: 'longenough1', password: 'newpassword9' }, c2);
  assert.strictEqual(r.status, 200);
  const c3 = cookieOf(r);
  assert.strictEqual((await (await fetch(base + '/api/account', { headers: { cookie: c1 } })).json()).customer, null, 'old device signed out');
  assert.strictEqual((await (await fetch(base + '/api/account', { headers: { cookie: c3 } })).json()).customer.name, 'Mona A.');
  // A forged cookie is ignored; sign out clears it.
  assert.strictEqual((await (await fetch(base + '/api/account', { headers: { cookie: c3.slice(0, -2) + 'xx' } })).json()).customer, null);
  r = await call('/api/account/logout', undefined, c3);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  // Forgot password answers the same whether or not the account exists.
  const a = await (await call('/api/account/forgot', { login: '01112223334' })).json();
  const b = await (await call('/api/account/forgot', { login: '01099999999' })).json();
  assert.deepStrictEqual(a, b);
});

test('sign in with Google: redirect, callback, account linking', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-oauth-'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  let profileFor = {};
  const oauthFetch = async (url, opts) => {
    assert.strictEqual(url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(opts.body);
    assert.strictEqual(form.get('client_secret'), 'sec');
    const p = profileFor[form.get('code')];
    if (!p) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    const claims = { iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...p };
    return new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` }), { status: 200 });
  };
  const gapp = createApp({ dataDir: dir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false, oauthConfig: { google: { clientId: 'cid', clientSecret: 'sec' }, facebook: null }, oauthFetch });
  const srv = await new Promise((resolve) => { const s = gapp.listen(0, () => resolve(s)); });
  const B = `http://127.0.0.1:${srv.address().port}`;
  const get = (u, cookie) => fetch(B + u, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const cookies = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]);
  try {
    assert.deepStrictEqual((await (await get('/api/account')).json()).providers, { google: true, facebook: false });
    assert.strictEqual((await (await fetch(base + '/api/account')).json()).providers.google, false, 'off without keys');
    // Not set up: back to the account page with a message.
    let r = await get('/auth/facebook');
    assert.strictEqual(r.headers.get('location'), '/account?oauth=unavailable');
    // Start: off to Google with our client id and a state tied to a cookie.
    r = await get('/auth/google?next=cart');
    assert.strictEqual(r.status, 302);
    const to = new URL(r.headers.get('location'));
    assert.strictEqual(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.strictEqual(to.searchParams.get('client_id'), 'cid');
    assert.strictEqual(to.searchParams.get('redirect_uri'), `${B}/auth/google/callback`);
    const state = to.searchParams.get('state');
    const sc = cookies(r).find((c) => c.startsWith('pod_o='));
    // A forged or missing state is refused.
    r = await get(`/auth/google/callback?code=c1&state=nope`, sc);
    assert.strictEqual(r.headers.get('location'), '/account?oauth=failed&next=cart');
    r = await get(`/auth/google/callback?code=c1&state=${state}`);
    assert.match(r.headers.get('location'), /oauth=failed/);
    // Cancelled at Google.
    r = await get(`/auth/google/callback?error=access_denied&state=${state}`, sc);
    assert.match(r.headers.get('location'), /oauth=cancelled/);
    // Success: a new account, signed in, back to the cart.
    profileFor = { c1: { sub: 'g-1', email: 'Nour@Example.com', name: 'Nour Hassan' } };
    r = await get(`/auth/google/callback?code=c1&state=${state}`, sc);
    assert.strictEqual(r.headers.get('location'), '/cart');
    const session = cookies(r).find((c) => c.startsWith('pod_c='));
    let me = (await (await get('/api/account', session)).json()).customer;
    assert.strictEqual(me.email, 'nour@example.com');
    assert.strictEqual(me.name, 'Nour Hassan');
    assert.strictEqual(me.phone, '');
    assert.strictEqual(me.hasPassword, false);
    assert.strictEqual(me.linked.google, true);
    // Add a mobile number and set a password (no current password needed).
    r = await fetch(B + '/api/account', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: session }, body: JSON.stringify({ name: 'Nour Hassan', email: 'nour@example.com', phone: '01234567890' }) });
    assert.strictEqual((await r.json()).customer.phone, '01234567890');
    r = await fetch(B + '/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: session }, body: JSON.stringify({ password: 'newpassword1' }) });
    assert.strictEqual(r.status, 200);
    // The same Google account next time: the same customer.
    r = await get('/auth/google');
    const st2 = new URL(r.headers.get('location')).searchParams.get('state');
    profileFor = { c2: { sub: 'g-1', email: 'nour@example.com', name: 'Nour' } };
    r = await get(`/auth/google/callback?code=c2&state=${st2}`, cookies(r).find((c) => c.startsWith('pod_o=')));
    assert.strictEqual(r.headers.get('location'), '/account');
    me = (await (await get('/api/account', cookies(r).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.strictEqual(me.phone, '01234567890');
    // An account that only typed an email (never proven) is NOT joined: someone
    // could have typed another person's address. Google proves the owner, so the
    // Google sign-in gets its own account and the typed email is taken off the other.
    await fetch(B + '/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Attacker', phone: '01098765432', email: 'omar@example.com', password: 'longenough1' }) });
    r = await get('/auth/google');
    let st3 = new URL(r.headers.get('location')).searchParams.get('state');
    profileFor = { c3: { sub: 'g-2', email: 'omar@example.com', name: 'Omar G' } };
    r = await get(`/auth/google/callback?code=c3&state=${st3}`, cookies(r).find((c) => c.startsWith('pod_o=')));
    me = (await (await get('/api/account', cookies(r).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.strictEqual(me.name, 'Omar G', 'a new account, not the one that typed the email');
    assert.strictEqual(me.phone, '');
    assert.strictEqual(me.email, 'omar@example.com');
    const attacker = await fetch(B + '/api/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: '01098765432', password: 'longenough1' }) });
    const atk = (await (await get('/api/account', cookies(attacker).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.strictEqual(atk.email, '', 'the unproven email was removed');
    assert.strictEqual(atk.linked.google, false);
    const secret = Buffer.from(fs.readFileSync(path.join(dir, '.session-secret'), 'utf8').trim(), 'hex');
    const ckey = require('crypto').createHmac('sha256', secret).update('customer-sessions').digest();
    // A reset link proves only the email it was sent to: change the account's
    // email afterwards (to someone else's) and the old link no longer works.
    r = await fetch(B + '/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mallory', phone: '01055556666', email: 'mallory@example.com', password: 'longenough1' }) });
    const mal = await r.json();
    const malCookie = cookies(r).find((c) => c.startsWith('pod_c='));
    const malLink = require('../src/customers').resetToken(ckey, { id: mal.customer.id, pv: 1, email: 'mallory@example.com' }, 1, 'e');
    r = await fetch(B + '/api/account', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: malCookie }, body: JSON.stringify({ name: 'Mallory', email: 'victim@example.com' }) });
    assert.strictEqual(r.status, 200, await r.clone().text());
    r = await fetch(B + '/api/account/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: malLink, password: 'newpassword9' }) });
    assert.notStrictEqual(r.status, 200, 'the old link must not work after the email changed');
    r = await get('/auth/google');
    let stV = new URL(r.headers.get('location')).searchParams.get('state');
    profileFor = { cv: { sub: 'g-victim', email: 'victim@example.com', name: 'Victim' } };
    r = await get(`/auth/google/callback?code=cv&state=${stV}`, cookies(r).find((c) => c.startsWith('pod_o=')));
    me = (await (await get('/api/account', cookies(r).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.notStrictEqual(me.id, mal.customer.id, 'the victim gets their own account');
    // A password account whose email is proven (its emailed reset link was used) IS joined.
    r = await fetch(B + '/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Laila', phone: '01011223344', email: 'laila@example.com', password: 'longenough1' }) });
    const lailaId = (await r.json()).customer.id;
    // The link the shop emails (made here with the shop's own key).
    const emailed = require('../src/customers').resetToken(ckey, { id: lailaId, pv: 1, email: 'laila@example.com' }, 1, 'e');
    r = await fetch(B + '/api/account/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: emailed, password: 'newpassword9' }) });
    assert.strictEqual(r.status, 200);
    r = await get('/auth/google');
    st3 = new URL(r.headers.get('location')).searchParams.get('state');
    profileFor = { c5: { sub: 'g-9', email: 'laila@example.com', name: 'Laila G' } };
    r = await get(`/auth/google/callback?code=c5&state=${st3}`, cookies(r).find((c) => c.startsWith('pod_o=')));
    me = (await (await get('/api/account', cookies(r).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.strictEqual(me.id, lailaId, 'joined: the email was proven');
    assert.strictEqual(me.phone, '01011223344');
    assert.strictEqual(me.linked.google, true);
    // An unverified email does not link to someone else's account.
    r = await get('/auth/google');
    const st4 = new URL(r.headers.get('location')).searchParams.get('state');
    profileFor = { c4: { sub: 'g-3', email: 'omar@example.com', email_verified: false, name: 'Mallory' } };
    r = await get(`/auth/google/callback?code=c4&state=${st4}`, cookies(r).find((c) => c.startsWith('pod_o=')));
    me = (await (await get('/api/account', cookies(r).find((c) => c.startsWith('pod_c=')))).json()).customer;
    assert.strictEqual(me.phone, '');
    assert.strictEqual(me.email, '');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import a design from a link: pictures found, unsafe links refused, rights required', async () => {
  const importer = require('../src/importer');
  // Finding a product page's main pictures.
  const html = `<html><head><title>Cool tee</title><meta property="og:image" content="/img/front.jpg?v=1&amp;w=1200">
    <script type="application/ld+json">{"@type":"Product","image":["https://cdn.shop.com/a.png",{"url":"https://cdn.shop.com/b.png"}]}</script></head>
    <body><img src="/logo.svg"><img width="40" src="/tiny.png"><img data-src="/gallery/2.jpg"></body></html>`;
  const found = importer.pageImages(html, 'https://shop.com/p/1');
  assert.deepStrictEqual(found.images, ['https://shop.com/img/front.jpg?v=1&w=1200', 'https://cdn.shop.com/a.png', 'https://cdn.shop.com/b.png', 'https://shop.com/gallery/2.jpg']);
  assert.strictEqual(found.title, 'Cool tee');
  // Private and odd addresses are never fetched.
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1', '0.0.0.0']) assert.ok(importer.privateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '2606:4700::1111']) assert.ok(!importer.privateAddress(ip), ip);
  for (const u of ['http://127.0.0.1/x', 'http://localhost/', 'file:///etc/passwd', 'ftp://a.com/x', 'http://user:pw@a.com/', 'http://a.com:8080/', 'http://[::1]/']) {
    assert.throws(() => importer.checkUrl(u), (e) => ['importBlocked', 'importBadUrl'].includes(e.code), u);
  }
  await assert.rejects(importer.safeGet('http://127.0.0.1:' + new URL(base).port + '/api/products', { maxBytes: 1e6, accept: '*/*' }), (e) => ['importBlocked', 'importBadUrl'].includes(e.code));

  // The routes, with the internet replaced by a stub.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-import-'));
  const sharp = require('sharp');
  const pic = await sharp({ create: { width: 900, height: 700, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const pages = {
    'https://shop.com/p/1': { type: 'text/html; charset=utf-8', body: Buffer.from(html) },
    'https://shop.com/img/front.jpg?v=1&w=1200': { type: 'image/png', body: pic },
    'https://shop.com/notapic': { type: 'image/png', body: Buffer.from('<svg onload=alert(1)>') },
  };
  const importGet = async (url) => {
    const p = pages[url];
    if (!p) throw new importer.ImportError('importFailed', '404');
    return { url, ...p };
  };
  const iapp = createApp({ dataDir: dir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false, importGet });
  const srv = await new Promise((resolve) => { const s = iapp.listen(0, () => resolve(s)); });
  const B = `http://127.0.0.1:${srv.address().port}`;
  try {
    let r = await fetch(B + '/api/import/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://shop.com/p/1' }) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).images.length, 4);
    r = await fetch(B + '/api/import/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'javascript:alert(1)' }) });
    assert.strictEqual(r.status, 400);
    r = await fetch(B + '/api/import/image?url=' + encodeURIComponent('https://shop.com/img/front.jpg?v=1&w=1200'));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'image/png');
    assert.strictEqual(r.headers.get('x-image-size'), '900x700');
    r = await fetch(B + '/api/import/image?thumb=1&url=' + encodeURIComponent('https://shop.com/img/front.jpg?v=1&w=1200'));
    assert.strictEqual((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width, 320);
    r = await fetch(B + '/api/import/image?url=' + encodeURIComponent('https://shop.com/notapic'));
    assert.strictEqual(r.status, 422, 'not a picture');
    // A design with an imported picture needs the rights confirmation.
    const imported = { type: 'image', src: 'data:image/png;base64,AA', importSource: 'https://shop.com/p/1', left: 250, top: 300, width: 10, height: 10 };
    const body = (extra) => JSON.stringify({ productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [imported] } } }, ...extra });
    r = await fetch(B + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({}) });
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /confirm/);
    r = await fetch(B + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ rightsConfirmed: true }) });
    assert.strictEqual(r.status, 201);
    // Rights holders can ask for a takedown.
    r = await fetch(B + '/api/takedown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Brand Co', contact: 'legal@brand.com', details: 'Our logo is used on design X' }) });
    assert.strictEqual(r.status, 201);
    r = await fetch(B + '/api/takedown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await fetch(B + '/rights')).status, 200);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fabric: pattern tile, repeat and size are kept, repeat preview for the print house', async () => {
  const sharp = require('sharp');
  // A design whose pattern settings are partly wrong: the server keeps only valid values.
  let d = await makeDesign({ productId: 'curtains', color: 'blackout', size: '140x270', sides: { front: { ...SIDE, editor: { ...SIDE.editor, pattern: { repeat: 'halfdrop', tileCm: 999 } } } } }, { complete: false });
  let full = await (await fetch(`${base}/api/designs/${d.id}`)).json();
  assert.deepStrictEqual(full.editor.front.pattern, { repeat: 'halfdrop', tileCm: 45 }, 'tile size falls back to the default');
  d = await makeDesign({ productId: 'fabric', color: 'poplin', size: '3m', sides: { front: { ...SIDE, editor: { ...SIDE.editor, pattern: { repeat: 'mirror', tileCm: 20 } } } } });
  assert.strictEqual(d.sides[0].widthIn, Math.round((20 / 2.54) * 100) / 100, 'the tile prints at 20 cm');
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] })).json();
  const item = (await (await admin('/api/admin/orders')).json()).orders.find((o) => o.id === order.id).items[0];
  assert.deepStrictEqual(item.pattern, { repeat: 'mirror', tileCm: 20, fabricCm: [145, 300] });
  const r = await admin(`/api/admin/files/${d.id}/front?format=repeat`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /repeat-mirror-20cm-145x300cm\.jpg/);
  const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.strictEqual(meta.format, 'jpeg');
  assert.strictEqual(meta.height, 6000, 'the long side is at most 6000 px');
  assert.strictEqual(meta.width, 2900);
  // Not a fabric: no repeat file.
  const tee = await makeDesign();
  assert.strictEqual((await admin(`/api/admin/files/${tee.id}/front?format=repeat`)).status, 404);
});

test('editor library: icons and stickers searchable in Arabic and English', async () => {
  const q = async (term, type = 'all', page = 0) => (await fetch(`${base}/api/assets/search?q=${encodeURIComponent(term)}&type=${type}&page=${page}`)).json();
  const popular = await q('');
  assert.ok(popular.items.length >= 20, 'something to show before typing');
  const heartAr = await q('قلب');
  const heartEn = await q('heart');
  assert.ok(heartAr.total > 50);
  assert.strictEqual(heartAr.items[0].id, heartEn.items[0].id, 'Arabic finds the same as English');
  assert.match(heartAr.items[0].body, /<path/);
  assert.ok((await q('الكورة')).items.slice(0, 5).some((i) => /football|soccer/.test(i.id)), 'with ال, and football first');
  const icons = await q('cat', 'icon');
  assert.ok(icons.items.length && icons.items.every((i) => i.kind === 'icon'));
  assert.ok((await q('cat', 'sticker')).items.every((i) => i.kind === 'sticker'));
  const p0 = await q('star');
  const p1 = await q('star', 'all', 1);
  assert.ok(p0.more && p1.items.length && p1.items[0].id !== p0.items[0].id, 'pages');
  assert.strictEqual((await q('qqqzzz')).total, 0);
  assert.strictEqual((await q('كلمةمشموجودة')).total, 0);
});

test('admin customers: search and a 24-hour password reset link', async () => {
  const r0 = await post('/api/account/signup', { name: 'Hoda Kamal', phone: '01155566677', password: 'firstpass1' });
  assert.strictEqual(r0.status, 201);
  assert.strictEqual((await fetch(base + '/api/admin/customers')).status, 401);
  const found = await (await admin('/api/admin/customers?q=0115556')).json();
  const hoda = found.customers.find((c) => c.name === 'Hoda Kamal');
  assert.ok(hoda, 'found by part of the mobile');
  assert.strictEqual(hoda.orders, 0);
  assert.strictEqual((await (await admin('/api/admin/customers?q=hoda')).json()).customers.length >= 1, true, 'by name');
  const link = await (await admin(`/api/admin/customers/${hoda.id}/reset-link`, { method: 'POST' })).json();
  assert.strictEqual(link.hours, 24);
  assert.strictEqual(link.whatsapp, 'https://wa.me/201155566677');
  const token = new URL(link.url).searchParams.get('reset');
  let r = await post('/api/account/reset', { token, password: 'secondpass2' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  assert.strictEqual((await post('/api/account/reset', { token, password: 'thirdpass33' })).status, 400, 'works once');
  assert.strictEqual((await post('/api/account/login', { login: '01155566677', password: 'secondpass2' })).status, 200);
});

test('embroidery: DST encoding is exact, logos are digitised, orders get the DST', async () => {
  const E = require('../src/embroidery');
  const sharp = require('sharp');
  for (let dx = -121; dx <= 121; dx += 3) {
    for (let dy = -121; dy <= 121; dy += 5) {
      const r = E.readRecord(...E.record(dx, dy, 'stitch'));
      assert.deepStrictEqual([r.dx, r.dy, r.kind], [dx, dy, 'stitch']);
    }
  }
  assert.strictEqual(E.readRecord(...E.record(10, -20, 'jump')).kind, 'jump');
  assert.strictEqual(E.readRecord(...E.record(0, 0, 'color')).kind, 'color');
  // A two-colour logo, 90 x 90 mm.
  const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><circle cx="450" cy="380" r="300" fill="#d0202a"/><rect x="100" y="740" width="700" height="120" fill="#1b2550"/></svg>')).png().toBuffer();
  const d = await E.digitize(logo, 90, 90);
  assert.deepStrictEqual(d.colors.map((c) => c.name), ['Red', 'Navy']);
  assert.ok(d.stitches > 1000 && d.trims < 10, `${d.stitches} stitches, ${d.trims} trims`);
  const dst = E.toDst(d, 'TEST');
  assert.strictEqual(dst.buffer.length % 3, 512 % 3);
  assert.match(dst.buffer.slice(0, 20).toString('latin1'), /^LA:TEST/);
  // Every record read back lands inside the design, ends with the end mark.
  let x = 0;
  let y = 0;
  let colors = 0;
  let end = false;
  for (let i = 512; i < dst.buffer.length; i += 3) {
    const r = E.readRecord(dst.buffer[i], dst.buffer[i + 1], dst.buffer[i + 2]);
    if (r.kind === 'end') { end = true; break; }
    if (r.kind === 'color') colors++;
    x += r.dx;
    y += r.dy;
    assert.ok(Math.abs(x) <= 460 && Math.abs(y) <= 460, 'inside 92 x 92 mm');
  }
  assert.ok(end);
  assert.strictEqual(colors, 1);
  // Through the shop: an embroidered polo costs more and its order has the DST.
  const plain = await makeDesign({ productId: 'polo', color: 'white', size: 'M' });
  const emb = await makeDesign({ productId: 'polo', color: 'white', size: 'M', method: 'embroidery' });
  assert.strictEqual(emb.price, plain.price + 150);
  assert.strictEqual(emb.method, 'embroidery');
  assert.ok(emb.emb && Array.isArray(emb.emb.colors), 'digitised when the design was saved');
  assert.ok(emb.emb.warnings.includes('empty'), 'the blank test print has nothing to stitch');
  assert.strictEqual((await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', method: 'embroidery', sides: { back: SIDE } })).status, 400, 'front only');
  // The embroidery box can be moved from the left chest, kept on the garment's printable zone; the shop gets the cm.
  const moved = await makeDesign({ productId: 'tshirt', color: 'white', size: 'M', method: 'embroidery', sides: { front: { editor: { ...SIDE.editor, offset: { dx: -40, dy: 30 } } } } });
  const mf = moved.sides.find((x) => x.id === 'front');
  assert.ok(mf.offsetCm && mf.offsetCm.x < 0 && mf.offsetCm.y > 0, JSON.stringify(mf));
  const far = await makeDesign({ productId: 'tshirt', color: 'white', size: 'M', method: 'embroidery', sides: { front: { editor: { ...SIDE.editor, offset: { dx: 0, dy: 5000 } } } } });
  const zone = PRODUCTS_BY_ID.tshirt.sides[0].moveZone || PRODUCTS_BY_ID.tshirt.sides[0].printArea;
  const ea = PRODUCTS_BY_ID.tshirt.embroidery.area;
  const perCm = ea.w / (PRODUCTS_BY_ID.tshirt.embroidery.widthIn * 2.54);
  assert.ok(far.sides[0].offsetCm.y <= (zone.y + zone.h - ea.h - ea.y) / perCm + 0.5, 'kept on the garment');
  const order = await (await post('/api/orders', { customer: CUSTOMER, designIds: [emb.id] })).json();
  const item = (await (await admin('/api/admin/orders')).json()).orders.find((o) => o.id === order.id).items[0];
  assert.strictEqual(item.process, 'embroidery');
  assert.ok(item.emb, 'the item carries the thread list');
  const r = await admin(`/api/admin/files/${emb.id}/front?format=dst`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /embroidery\.dst/);
  assert.strictEqual((await admin(`/api/admin/files/${plain.id}/front?format=dst`)).status, 404);
});

test('a print file far too small for the product is refused', async () => {
  const r = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: SIDE } });
  const { id, uploadToken, files } = await r.json();
  for (const name of files) {
    const body = name.endsWith('.svg') ? SVG : name.includes('print') ? png(2, 2) : PREVIEW;
    await upload(id, uploadToken, name, body);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 400);
  assert.match((await done.json()).error, /too small/);
});

const png4 = (w, h) => png(w, h);
test('two copies of the app on one data folder share orders, sign-ins and edits', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-two-'));
  const start = (a) => new Promise((resolve) => { const s = a.listen(0, () => resolve(s)); });
  const A = await start(make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false }));
  const B = await start(make({ dataDir: dir, adminPassword: 'Str0ng!Passw0rd-2026', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false }));
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
