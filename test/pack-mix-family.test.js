'use strict';

// Packs of one family mix on every product (owner, 26 Nov): menus, flyers, notepads, labels, magnets and booklets take
// the cheapest mix of packs of the same paper size or page count (11 menus: a 10-pack and a single, not 11 singles);
// another paper size or page count is still a design of its own.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
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
const PRINT = png(1200, 1600);
const PREVIEW = png(60, 72);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const OPEN = { max: 1e6, ms: 1000 };

let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-packmix-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: JSON.stringify(body) });
async function makeDesign(body, print = PRINT) {
  const res = await post('/api/designs', { sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } }, ...body });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id, uploadToken, files } = await res.json();
  for (const name of files) {
    const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? print : PREVIEW });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return { design: await done.json(), key: uploadToken };
}
const quote = async (ids) => (await post('/api/cart/quote', { designIds: ids })).json();
const setQty = (id, body, key) => post(`/api/designs/${id}/quantity`, body, key ? { 'x-design-key': key } : {});
const one = (pid, color, size) => makeDesign({ productId: pid, color, size });

test('the cart\'s − / + takes the cheapest mix of one family\'s packs: 11 menus, 24 booklets, 600 flyers', async () => {
  // Menus: 11 copies, a 10-pack and a single (about 380), not 11 singles (1,430).
  const m = await one('menus', 'matte', 'A4-1');
  const single = (await quote([m.design.id])).items[0].price;
  const eleven = await (await setQty(m.design.id, { copies: 11 }, m.key)).json();
  assert.deepStrictEqual(eleven.entry.quantities.map((l) => [l.size.id, l.qty]).sort(), [['A4-1', 1], ['A4-10', 1]]);
  assert.ok(eleven.entry.price < single * 11 * 0.5, `${eleven.entry.price} vs 11 singles ${single * 11}`);
  // Booklets: 25 then one fewer: 24 as packs of 8-page booklets, far less than 24 singles.
  const b = await one('booklets', 'matte', '8-1');
  const bSingle = (await quote([b.design.id])).items[0].price;
  const t25 = await (await setQty(b.design.id, { copies: 25 }, b.key)).json();
  const t24 = await (await setQty(b.design.id, { copies: 24 }, b.key)).json();
  assert.ok(t24.entry.quantities.every((l) => /^8-/.test(l.size.id)), 'all 8-page packs');
  assert.strictEqual(t24.entry.quantities.reduce((n, l) => n + l.qty * l.size.copies, 0), 24);
  assert.ok(t24.entry.price < bSingle * 24 * 0.6, `${t24.entry.price} vs 24 singles ${bSingle * 24}`);
  assert.ok(t25.entry.price > 0);
  // Flyers (packs of 100, 500, 1000): 600 is a 500 and a 100.
  const f = await one('flyers', (await (await fetch(base + '/api/products')).json()).products.find((p) => p.id === 'flyers').colors[0].id, 'A5-100');
  const six = await (await setQty(f.design.id, { copies: 600 }, f.key)).json();
  assert.deepStrictEqual(six.entry.quantities.map((l) => [l.size.id, l.qty]).sort(), [['A5-100', 1], ['A5-500', 1]]);
  // The order takes it as it is.
  const order = await post('/api/orders', { customer: { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' }, designIds: [m.design.id, b.design.id, f.design.id] });
  assert.strictEqual(order.status, 201, await order.clone().text());
});

test('a design of one product: packs of one paper size together; another paper size is refused', async () => {
  const sides = { front: { editor: { objects: [{ type: 'i-text', text: 'Menu' }] } } };
  const ok = await post('/api/designs', { productId: 'menus', color: 'matte', size: 'A4-1', sides, quantities: [{ color: 'matte', size: 'A4-1', qty: 1 }, { color: 'matte', size: 'A4-10', qty: 2 }] });
  assert.strictEqual(ok.status, 201, await ok.clone().text());
  const bad = await post('/api/designs', { productId: 'menus', color: 'matte', size: 'A4-1', sides, quantities: [{ color: 'matte', size: 'A4-1', qty: 1 }, { color: 'matte', size: 'A3-10', qty: 1 }] });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).code, 'qtyNoSizes');
  const labels = await post('/api/designs', { productId: 'labels', color: (await (await fetch(base + '/api/products')).json()).products.find((p) => p.id === 'labels').colors[0].id, size: '50x30-100', sides: { [(await (await fetch(base + '/api/products')).json()).products.find((p) => p.id === 'labels').sides[0].id]: sides.front }, quantities: [{ color: (await (await fetch(base + '/api/products')).json()).products.find((p) => p.id === 'labels').colors[0].id, size: '50x30-100', qty: 1 }, { color: (await (await fetch(base + '/api/products')).json()).products.find((p) => p.id === 'labels').colors[0].id, size: '75x45-100', qty: 1 }] });
  assert.strictEqual(labels.status, 400, 'another label size is another print');
});
