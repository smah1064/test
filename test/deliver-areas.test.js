'use strict';

// Big or fragile pieces go by the shop's own van, in Cairo and Giza only (CNC and UV products, owner's go 27 Nov): a
// product, or one of its sizes, with `deliverTo` is refused for another governorate, naming the item and where it goes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PRODUCTS } = require('../src/products');
// (The shop copies the products when it loads: the limit is set on the plaque's biggest size before that.)
const plaque = PRODUCTS.find((p) => p.id === 'plaque');
const big = plaque.sizes[plaque.sizes.length - 1];
const small = plaque.sizes[0];
big.deliverTo = ['cairo', 'giza'];
const { createApp } = require('../src/app');

function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const OPEN = [{ max: 1e6, ms: 1000 }];
const send = (base, method, url, body, lang = 'en') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': lang }, body: body === undefined ? undefined : JSON.stringify(body) });
async function design(base, productId, color, size) {
  const { id, uploadToken, files } = await (await send(base, 'POST', '/api/designs', { productId, color, size, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>') : name.includes('print') ? png(1200, 1600) : png(60, 72);
    await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body });
  }
  return (await (await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).json()).id;
}
const customer = (governorate, phone) => ({ name: 'Sara Ahmed', phone, governorate, city: 'Center', address: '12 Tahrir St' });

test('an item delivered in Cairo and Giza only is refused elsewhere, naming it and where it goes; the shop shows the limit', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-areas-'));
  const app = createApp({ dataDir, adminPassword: 'pw', limits: { designs: OPEN, orders: OPEN }, cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // The catalogue carries the limit to the shop's pages.
    const shop = await (await send(base, 'GET', '/api/products')).json();
    assert.deepStrictEqual(shop.products.find((p) => p.id === 'plaque').sizes.find((z) => z.id === big.id).deliverTo, ['cairo', 'giza']);
    const far = await design(base, 'plaque', 'clear', big.id);
    const r = await send(base, 'POST', '/api/orders', { customer: customer('alexandria', '01012340001'), designIds: [far] });
    assert.strictEqual(r.status, 409, await r.clone().text());
    const body = await r.json();
    assert.strictEqual(body.code, 'deliverOnlyIn');
    assert.match(body.error, /Cairo and Giza/);
    assert.match(body.error, /Acrylic Photo Plaque/);
    const ar = await (await send(base, 'POST', '/api/orders', { customer: customer('alexandria', '01012340001'), designIds: [far] }, 'ar')).json();
    assert.match(ar.error, /القاهرة والجيزة/);
    // Giza: delivered.
    const ok = await send(base, 'POST', '/api/orders', { customer: customer('giza', '01012340002'), designIds: [far] });
    assert.strictEqual(ok.status, 201, await ok.clone().text());
    // The other size of the same product goes anywhere.
    const near = await design(base, 'plaque', 'clear', small.id);
    const anywhere = await send(base, 'POST', '/api/orders', { customer: customer('aswan', '01012340003'), designIds: [near] });
    assert.strictEqual(anywhere.status, 201, await anywhere.clone().text());
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
