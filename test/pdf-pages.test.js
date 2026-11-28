'use strict';

// Booklets: a whole PDF, one picture per page (POST /api/artwork/pages).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { createApp } = require('../src/app');

let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-pdfpages-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function pdf(n) {
  return new Promise((resolve) => {
    const d = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < n; i++) {
      d.addPage({ size: [420, 595], margin: 0 });
      d.rect(0, 0, 420, 595).fill(i % 2 ? '#1c7ed6' : '#e03131');
    }
    d.end();
  });
}
const send = (body, headers = {}) => fetch(`${base}/api/artwork/pages`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-page-w': '420', 'x-page-h': '595', ...headers }, body });

test('every page of a PDF comes back as a page picture, in order', async () => {
  const r = await send(await pdf(3));
  assert.strictEqual(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.strictEqual(body.pages.length, 3);
  assert.strictEqual(body.more, false);
  const second = await sharp(Buffer.from(body.pages[1].split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(second.info.width / second.info.height - 420 / 595) < 0.01, 'each page keeps its own shape');
  assert.ok(second.info.width >= 1000, 'about 200 DPI');
  const mid = (Math.floor(second.info.height / 2) * second.info.width + Math.floor(second.info.width / 2)) * second.info.channels;
  assert.ok(second.data[mid + 2] > 150 && second.data[mid] < 80, 'page 2 is the blue one');
});

test('a PDF longer than asked says so, and only PDFs are taken', async () => {
  const body = await (await send(await pdf(5), { 'x-max-pages': '4' })).json();
  assert.strictEqual(body.pages.length, 4);
  assert.strictEqual(body.more, true);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const bad = await send(png);
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).code, 'pdfOnly');
});

test('a booklet from a PDF is printed from the PDF pages themselves, with what was added on top', async () => {
  const { PRODUCTS, printWidthFor } = require('../src/products');
  const p = PRODUCTS.find((x) => x.id === 'booklets');
  const up = await (await send(await pdf(4))).json();
  assert.match(up.pdfId, /^[a-f0-9]{24}$/);
  assert.deepStrictEqual(up.boxes[0], { x: 0, y: 0, w: 420, h: 595 });
  const side = p.sides[0];
  const a = side.printArea;
  const u = a.w / side.printWidthIn;
  const bU = side.bleedIn * u;
  // The page picture covering the page with its bleed, as the editor places it.
  const s = Math.max((a.w + 2 * bU) / 420, (a.h + 2 * bU) / 595);
  const pageObj = (page) => ({ type: 'image', originX: 'center', originY: 'center', left: a.x + a.w / 2, top: a.y + a.h / 2, width: 420, height: 595, scaleX: s, scaleY: s, angle: 0, pdfSrc: { id: up.pdfId, page } });
  const ids = ['front', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'back'];
  const sides = Object.fromEntries(ids.map((id, i) => [id, { editor: { objects: i < 4 ? [pageObj(i), ...(id === 'p2' ? [{ type: 'i-text', text: 'Added' }] : [])] : [{ type: 'i-text', text: 'x' }] } }]));
  const res = await fetch(`${base}/api/designs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'booklets', color: p.colors[0].id, size: '8-50', sides }) });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  assert.ok(created.files.includes('p2-overlay.png'), 'the text on page 2 comes as its own layer');
  assert.ok(!created.files.includes('p3-overlay.png'));
  for (const name of created.files) {
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print') || name.includes('overlay')) {
      const wIn = printWidthFor(p, side, '8-50') + 2 * side.bleedIn;
      const hIn = (printWidthFor(p, side, '8-50') * a.h) / a.w + 2 * side.bleedIn;
      const transparent = name.includes('overlay');
      // Each page its own colour (the PDF writer keeps one copy of identical pictures); the added layer is a black box on clear.
      const colour = { r: 30 + 25 * ids.indexOf(name.split('-')[0]), g: 80, b: 200, alpha: 1 };
      body = transparent
        ? await sharp({ create: { width: Math.round(wIn * 150), height: Math.round(hIn * 150), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 200, height: 100, channels: 4, background: '#000000' } }, left: 50, top: 50 }]).png().toBuffer()
        : await sharp({ create: { width: Math.round(wIn * 150), height: Math.round(hIn * 150), channels: 4, background: colour } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const r = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(r.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  const { token } = await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) })).json();
  const get = async (format) => Buffer.from(await (await fetch(`${base}/api/admin/files/${created.id}/front?format=${format}`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
  const count = (buf, re) => (buf.toString('latin1').match(re) || []).length;
  const reading = await get('booklet-pdf');
  assert.strictEqual(count(reading, /\/Type\s*\/Page\b/g), 8);
  // Pages 1-4 from the PDF (no pictures), page 2's added layer (one picture with its transparency), pages 5-8 from their print files.
  // 4 print-file pages + the added layer, plus their masks (pictures with transparency are two); none for pages 1-4.
  const pics = count(reading, /\/Subtype\s*\/Image/g);
  assert.ok(pics >= 5 && pics <= 7, `${pics} pictures`);
  const imposed = await get('booklet-imposed');
  assert.strictEqual(count(imposed, /\/Type\s*\/Page\b/g), 4);
  assert.match(imposed.toString('latin1'), /\/TrimBox/);
  const original = await get('source-pdf');
  assert.strictEqual(count(original, /\/Type\s*\/Page\b/g), 4, 'the customer\'s own PDF');
});
