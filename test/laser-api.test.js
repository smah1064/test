'use strict';

// Laser products end to end: a design is made, the shop downloads the LightBurn file, the engraving and the cut lines.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let token;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-laser-'));
  const app = createApp({ dataDir, adminPassword: 'secret-pass-123', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await post('/api/admin/login', { password: 'secret-pass-123' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
/** A print PNG with two filled blobs (or one when `joined`), the size of the product's print area at 300 DPI. */
async function printPng(product, joined) {
  const sd = product.sides[0];
  const w = Math.round(sd.printWidthIn * 300);
  const h = Math.round((w * sd.printArea.h) / sd.printArea.w);
  const blobs = joined
    ? `<rect x="${w * 0.2}" y="${h * 0.3}" width="${w * 0.6}" height="${h * 0.3}" fill="#d4af37"/>`
    : `<circle cx="${w * 0.3}" cy="${h / 2}" r="${h * 0.15}" fill="#d4af37"/><circle cx="${w * 0.7}" cy="${h / 2}" r="${h * 0.15}" fill="#d4af37"/>`;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${blobs}</svg>`)).png().toBuffer();
}
async function design(productId, color, size, joined = true) {
  const product = PRODUCTS.find((p) => p.id === productId);
  const created = await (await post('/api/designs', { productId, color, size, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Laila' }] } } } })).json();
  assert.ok(created.id, JSON.stringify(created));
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await printPng(product, joined) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await sharp({ create: { width: 60, height: 60, channels: 4, background: '#fff' } }).png().toBuffer();
    const put = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
    assert.ok(put.ok, await put.clone().text());
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return created.id;
}
const file = (id, format) => fetch(`${base}/api/admin/files/${id}/front?format=${format}`, { headers: { Authorization: `Bearer ${token}` } });

test('every laser product has materials with an engraved tone, a laser kind and a laser process', () => {
  // (The CNC products, 27 Nov, use the same one-tone mode in their own categories, made by 'cnc'.)
  const laser = PRODUCTS.filter((p) => p.laser && p.process !== 'cnc');
  assert.strictEqual(laser.length, 12); // (+ the engraved pen and wallet, 25 Nov)
  assert.deepStrictEqual(PRODUCTS.filter((p) => p.laser && p.process === 'cnc').map((p) => p.id), ['calligraphy', 'villasign', 'woodnameplate', 'nameart', 'rehal', 'eventletters']);
  for (const p of PRODUCTS.filter((x) => x.laser)) {
    if (p.process !== 'cnc') assert.strictEqual(p.category, 'laser');
    assert.ok(['engrave', 'lasercut', 'cnc'].includes(p.process), p.id);
    assert.strictEqual(p.mix.colors, false, `${p.id}: one design is one material`);
    for (const c of p.colors) assert.match(c.ink, /^#[0-9a-f]{6}$/i, `${p.id}/${c.id}`);
    assert.ok(p.cardArt.includes('{{I}}'), p.id);
  }
});

test('cake topper: the LightBurn file has the cut outline (no engraving), sized in mm', async () => {
  const id = await design('caketopper', 'gold', '20');
  const res = await file(id, 'laser-svg');
  assert.strictEqual(res.status, 200, await res.clone().text());
  const svg = await res.text();
  assert.ok(Math.abs(Number(/width="([\d.]+)mm"/.exec(svg)[1]) - 200) < 0.1, svg.slice(0, 200));
  assert.match(svg, /stroke="#ff0000"/);
  assert.doesNotMatch(svg, /<image/);
  assert.strictEqual((await file(id, 'cut-svg')).status, 200);
});

test('door sign: engraving bitmap plus the rounded board outline', async () => {
  const id = await design('doorsign', 'walnut', '30x15');
  const svg = await (await file(id, 'laser-svg')).text();
  assert.match(svg, /<image/);
  assert.match(svg, /stroke="#ff0000"/);
  const png = Buffer.from(await (await file(id, 'engrave-png')).arrayBuffer());
  const meta = await sharp(png).metadata();
  assert.strictEqual(Math.round(meta.width / 254 * 25.4), 300, 'width 300 mm at 254 DPI');
});

test('laser formats only exist for laser products', async () => {
  const id = await design('mug', 'white', '11oz');
  assert.strictEqual((await file(id, 'png')).status, 200);
  assert.strictEqual((await file(id, 'laser-svg')).status, 404);
});

test('laser downloads each have their own file name (LightBurn file, cut lines, engraving, plain SVG)', async () => {
  const id = await design('engrpen', 'black', '1');
  const names = {};
  for (const f of ['laser-svg', 'cut-svg', 'engrave-png', 'svg', 'png']) {
    const res = await file(id, f);
    assert.strictEqual(res.status, 200, `${f}: ${await res.clone().text()}`);
    names[f] = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')[1];
  }
  assert.strictEqual(new Set(Object.values(names)).size, 5, JSON.stringify(names));
  assert.match(names['laser-svg'], /-laser-lightburn\.svg$/);
  assert.match(names['cut-svg'], /-cut-lines\.svg$/);
  assert.match(names['engrave-png'], /-engrave\.png$/);
});
