'use strict';

// The owner's decisions of 26 Nov (afternoon): pack products are sold online up to 10,000 copies of one design (more
// on WhatsApp); background removal and photo boost take real photo files only (PNG, JPEG, WebP by their own first
// bytes, whatever type the request says); a photo saved as PDF says how many real pixels it has, for the editor's
// print check (QA 26 Nov).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
let dir;
let server;
let base;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-owner-2606-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: { designs: [OPEN], designsAll: [OPEN], removeBg: [OPEN], removeBgAll: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });

test('pack products: up to 10,000 copies of one design online, more is refused with the WhatsApp note', async () => {
  const design = (quantities) => post('/api/designs', { productId: 'bookmarks', color: 'matte', size: '50', quantities, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Read' }] } } } });
  const ok = await design([{ color: 'matte', size: '50', qty: 150 }, { color: 'gloss', size: '50', qty: 50 }]);
  assert.strictEqual(ok.status, 201, await ok.clone().text()); // 10,000 copies
  const over = await design([{ color: 'matte', size: '50', qty: 150 }, { color: 'gloss', size: '50', qty: 51 }]);
  assert.strictEqual(over.status, 400);
  const body = await over.json();
  assert.strictEqual(body.code, 'qtyTooManyCopies');
  assert.match(body.error, /10,000 copies.*WhatsApp/);
  // Pieces (not packs) are as before: 1,000 T-shirts is fine.
  const tees = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', quantities: [{ color: 'white', size: 'M', qty: 600 }, { color: 'white', size: 'L', qty: 400 }], sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Team' }] } } } });
  assert.strictEqual(tees.status, 201, await tees.clone().text());
});

test('photo boost and background removal take real photo files only', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="red"/></svg>'.padEnd(200, ' '));
  for (const url of ['/api/enhance', '/api/remove-bg']) {
    const r = await post(url, svg, { 'Content-Type': 'image/png' });
    assert.strictEqual(r.status, 400, url);
    assert.strictEqual((await r.json()).code, 'enhanceBad', url);
  }
  const png = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#3a6' } }).png().toBuffer();
  const r = await post('/api/enhance', png, { 'Content-Type': 'image/png', 'x-scale': '2' });
  assert.strictEqual(r.status, 200, await r.clone().text());
});

test('a small photo saved as PDF: the converter says its real pixels (X-Artwork-Photo-Px)', async (t) => {
  try {
    require.resolve('@okathira/ghostpdl-wasm');
  } catch (e) {
    t.skip('Ghostscript is not installed');
    return;
  }
  const PDFDocument = require('pdfkit');
  const w = 300;
  const h = 200;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; px[i] = (x * 7 + y * 3) % 200; px[i + 1] = ((x * y) % 180) + 20; px[i + 2] = (x + y * 5) % 220; }
  const jpg = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  const file = await new Promise((resolve) => {
    const d = new PDFDocument({ size: [w, h], margin: 0 });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.image(jpg, 0, 0, { width: w, height: h });
    d.end();
  });
  const r = await fetch(`${base}/api/artwork`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': '3000' }, body: file });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const real = /^(\d+)x(\d+)$/.exec(r.headers.get('x-artwork-photo-px') || '');
  assert.ok(real, 'the real pixels are said');
  assert.ok(Math.abs(Number(real[1]) - w) <= 4 && Math.abs(Number(real[2]) - h) <= 4, real[0]);
  const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.ok(meta.width > 2000, 'the picture itself is drawn big, as before');
});
