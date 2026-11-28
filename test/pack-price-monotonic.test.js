'use strict';

// Owner, 27 Nov: "How come more quantity is cheaper than less?" DL envelopes in the cart: 900 copies (500 + 4 × 100)
// cost 2,450 while 1,000 (2 × 500) cost 2,100; 800 cost 2,100 and 1,100 cost 2,450. More copies must never cost less
// than fewer, on every product sold in packs. The price of N copies is now the cheapest packs that make at least N.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { coverPrice } = require('../src/pack-price');
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

test('coverPrice: the cheapest packs that make at least that many', () => {
  const env = [{ copies: 100, price: 350 }, { copies: 250, price: 750 }, { copies: 500, price: 1050 }];
  assert.strictEqual(coverPrice(env, 1000), 2100);
  assert.strictEqual(coverPrice(env, 900), 2100, '900 never more than 1,000');
  assert.strictEqual(coverPrice(env, 100), 350);
  let last = 0;
  for (let n = 50; n <= 5000; n += 50) {
    const p = coverPrice(env, n);
    assert.ok(p >= last, `${n}: ${p} < ${last}`);
    last = p;
  }
});

test('every product sold in packs: in the cart, more copies never cost less', { timeout: 600000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-packs-'));
  const app = createApp({ dataDir, adminPassword: 'pw', limits: { designs: OPEN, designsAll: OPEN, quantity: OPEN }, cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const { products } = await (await json('GET', '/api/products')).json();
    const packProducts = products.filter((p) => !p.kind && !p.merge && p.sizes.some((z) => z.pack && z.copies > 0));
    assert.ok(packProducts.length >= 5, 'pack products found');
    const problems = [];
    for (const p of packProducts) {
      const size = p.sizes.find((z) => z.pack && z.copies > 0);
      const colour = p.colors.find((c) => !c.off && !c.soldOut) || p.colors[0];
      const side = p.sides[0].id;
      const made = await (await json('POST', '/api/designs', { productId: p.id, color: colour.id, size: size.id, sides: { [side]: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
      if (!made.id) { problems.push(`${p.id}: design not made (${JSON.stringify(made).slice(0, 120)})`); continue; }
      for (const name of made.files) await fetch(`${base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>') : name.includes('print') ? png(800, 600) : png(60, 72) });
      const done = await fetch(`${base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } });
      if (done.status !== 200) { problems.push(`${p.id}: not completed (${done.status})`); continue; }
      const family = p.sizes.filter((z) => z.pack && z.copies > 0 && z.family === size.family);
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const step = family.reduce((a, z) => gcd(a, z.copies), 0);
      const most = Math.max(...family.map((z) => z.copies));
      let id = made.id;
      let key = null;
      let last = { copies: 0, price: 0 };
      for (let copies = step; copies <= Math.min(most * 3, 4000); copies += step) {
        const r = await json('POST', `/api/designs/${id}/quantity`, { copies }, key ? { 'x-design-key': key } : {});
        if (r.status === 400) continue; // (not made of whole packs)
        const b = await r.json();
        if (r.status !== 200) { problems.push(`${p.id} ${copies}: ${r.status} ${JSON.stringify(b).slice(0, 120)}`); break; }
        id = b.entry.designId;
        key = b.entry.designKey || key;
        if (b.entry.price < last.price - 0.001) problems.push(`${p.id}: ${copies} copies cost ${b.entry.price}, ${last.copies} cost ${last.price}`);
        last = { copies, price: b.entry.price };
      }
    }
    assert.deepStrictEqual(problems, []);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
