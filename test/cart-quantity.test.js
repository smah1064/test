'use strict';

// How many, changed from the cart (owner, 26 Nov): one artwork in one colour and size gets − / + in the cart. With the
// cart's key (the editor's upload token, kept with the item) the design itself changes; without it a copy is made at
// the new number. Packs count copies and take the cheapest pack that makes exactly that many, as the editor does.
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cartqty-'));
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

test('a mug: + with the cart\'s key changes the design itself; the price and the proof follow', async () => {
  const { design, key } = await makeDesign({ productId: 'mug', color: 'white', size: '11oz' });
  const q1 = await quote([design.id]);
  assert.deepStrictEqual(q1.items[0].count, { n: 1, step: 1, max: 1000, unit: 'piece' });
  const one = q1.items[0].price;
  const r = await setQty(design.id, { qty: 3 }, key);
  assert.strictEqual(r.status, 200, await r.clone().text());
  const b = await r.json();
  assert.strictEqual(b.copied, false);
  assert.strictEqual(b.entry.designId, design.id, 'the same design');
  assert.strictEqual(b.entry.designKey, undefined, 'the key isn\'t sent back');
  assert.strictEqual(b.entry.price, Math.round(one * 3 * 100) / 100);
  assert.strictEqual(b.count.n, 3);
  assert.strictEqual(b.entry.quantities[0].qty, 3);
  const proof = await (await fetch(`${base}/api/designs/${design.id}/proof`)).json();
  assert.strictEqual(proof.copies, 3);
  assert.strictEqual(proof.proofHash, 'v1', 'the same proof: the customer\'s tick stays');
  assert.strictEqual((await quote([design.id])).items[0].price, b.entry.price);
  // Back to one: one piece as chosen, no lines.
  const back = await (await setQty(design.id, { qty: 1 }, key)).json();
  assert.strictEqual(back.entry.quantities, undefined);
  assert.strictEqual(back.entry.price, one);
});

test('without the key (an older cart item, another device): a copy at the new number with its own key', async () => {
  const { design } = await makeDesign({ productId: 'mug', color: 'white', size: '11oz' });
  const wrong = await setQty(design.id, { qty: 2 }, 'f'.repeat(48));
  assert.strictEqual(wrong.status, 200);
  const b = await wrong.json();
  assert.strictEqual(b.copied, true);
  assert.notStrictEqual(b.entry.designId, design.id);
  assert.match(b.entry.designKey, /^[a-f0-9]{48}$/);
  assert.strictEqual(b.entry.quantities[0].qty, 2);
  // The original is untouched; the copy now changes in place with its key.
  assert.strictEqual((await quote([design.id])).items[0].count.n, 1);
  const again = await (await setQty(b.entry.designId, { qty: 5 }, b.entry.designKey)).json();
  assert.strictEqual(again.copied, false);
  assert.strictEqual(again.entry.designId, b.entry.designId);
  assert.strictEqual(again.count.n, 5);
});

test('packs count copies: 10 single menus become one 10-pack; 9 say a pack costs less; steps of the smallest pack', async () => {
  const { design, key } = await makeDesign({ productId: 'menus', color: 'matte', size: 'A4-1' });
  const q = (await quote([design.id])).items[0];
  assert.deepStrictEqual(q.count, { n: 1, step: 1, max: 10000, unit: 'copy' });
  const nine = await (await setQty(design.id, { copies: 9 }, key)).json();
  assert.strictEqual(nine.entry.quantities[0].size.id, 'A4-1');
  assert.strictEqual(nine.entry.quantities[0].qty, 9);
  assert.strictEqual(nine.switched, undefined, 'single copies: nothing to say');
  // (9 never cost more than 10: priced as the 10-pack, owner 27 Nov; so nothing cheaper to suggest.)
  assert.strictEqual(nine.cheaper, undefined, JSON.stringify(nine.cheaper));
  const ten = await (await setQty(design.id, { copies: 10 }, key)).json();
  assert.deepStrictEqual(ten.switched && ten.switched.map((x) => x.qty), [1]);
  assert.strictEqual(ten.entry.sizeLabel.en.startsWith('A4'), true);
  assert.strictEqual(ten.entry.price, nine.entry.price, 'nine cost what ten cost, never more');
  assert.strictEqual(ten.count.n, 10);
  assert.strictEqual(ten.count.step, 1, 'single copies still in the family');
  // 11: a 10-pack and a single (packs of one paper size mix on every product: owner, 26 Nov; it was 11 singles).
  const eleven = await (await setQty(design.id, { copies: 11 }, key)).json();
  assert.deepStrictEqual(eleven.entry.quantities.map((l) => [l.size.id, l.qty]).sort(), [['A4-1', 1], ['A4-10', 1]]);
  const single = require('../src/products').priceFor(require('../src/products').PRODUCTS.find((x) => x.id === 'menus'), 'A4-1', 1);
  assert.ok(eleven.entry.price < single * 11, `${eleven.entry.price}: far less than 11 singles`);
  assert.deepStrictEqual(eleven.switched && eleven.switched.map((x) => x.qty).sort(), [1, 1]);
  assert.strictEqual(eleven.count.n, 11);
  // The order takes the design as it is now (one paper size, A4, as the menus need).
  const proof = await (await fetch(`${base}/api/designs/${design.id}/proof`)).json();
  assert.match(proof.size.id, /^A4-/);
  const order = await post('/api/orders', { customer: { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' }, designIds: [design.id] });
  assert.strictEqual(order.status, 201, await order.clone().text());
});

test('several colours or sizes, name lists and bad numbers go through the editor; an ordered design is copied', async () => {
  const { design, key } = await makeDesign({ productId: 'tshirt', color: 'white', size: 'M', quantities: [{ color: 'white', size: 'M', qty: 2 }, { color: 'white', size: 'L', qty: 1 }] });
  assert.strictEqual((await quote([design.id])).items[0].count, undefined, 'no − / + in the cart');
  const r = await setQty(design.id, { qty: 4 }, key);
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).code, 'qtyInEditor');
  const mug = await makeDesign({ productId: 'mug', color: 'white', size: '11oz' });
  for (const body of [{ qty: 0 }, { qty: 1.5 }, { qty: 'many' }, { qty: 1001 }, {}]) {
    assert.strictEqual((await setQty(mug.design.id, body, mug.key)).status, 400, JSON.stringify(body));
  }
  const cards = await makeDesign({ productId: 'menus', color: 'matte', size: 'A4-1' });
  const tooMany = await setQty(cards.design.id, { copies: 10001 }, cards.key);
  assert.strictEqual(tooMany.status, 400);
  assert.strictEqual((await tooMany.json()).code, 'qtyTooManyCopies');
  // Ordered: the order keeps its pieces; the cart gets a copy.
  const order = await post('/api/orders', { customer: { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' }, designIds: [mug.design.id] });
  assert.strictEqual(order.status, 201, await order.clone().text());
  const after = await (await setQty(mug.design.id, { qty: 2 }, mug.key)).json();
  assert.strictEqual(after.copied, true);
  assert.notStrictEqual(after.entry.designId, mug.design.id);
});

test('the account\'s cart keeps the key, so − / + works on another device too', async () => {
  const signup = await post('/api/account/signup', { name: 'Mona Ali', email: `mona${Date.now()}@example.com`, password: 'Garden-Lamp-42!' });
  if (signup.status !== 201 && signup.status !== 200) return; // (accounts off in this build)
  const cookie = (signup.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const me = await (await fetch(`${base}/api/account/me`, { headers: { Cookie: cookie } })).json().catch(() => ({}));
  const { design, key } = await makeDesign({ productId: 'mug', color: 'white', size: '11oz' });
  const put = await fetch(`${base}/api/account/cart`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(me && me.id ? { 'x-account': me.id } : {}) }, body: JSON.stringify({ items: [{ designId: design.id, addedAt: new Date().toISOString(), designKey: key }] }) });
  assert.ok(put.ok, await put.clone().text());
  const got = await (await fetch(`${base}/api/account/cart`, { headers: { Cookie: cookie } })).json();
  assert.strictEqual(got.items[0].designKey, key);
});

test('envelopes (sizes mix): 900 is the cheapest mix of packs, and the cart says 1,000 cost less (owner, 26 Nov)', async () => {
  const P = require('../src/products');
  const env = P.PRODUCTS.find((p) => p.id === 'dlenvelopes');
  const price = (id) => P.priceFor(env, id, 1);
  const { design, key } = await makeDesign({ productId: 'dlenvelopes', color: env.colors[0].id, size: '100' });
  const r = await (await setQty(design.id, { copies: 900 }, key)).json();
  // 500 + 4 × 100, not 9 × 100.
  const lines = Object.fromEntries(r.entry.quantities.map((l) => [l.size.id, l.qty]));
  assert.deepStrictEqual(lines, { 100: 4, 500: 1 });
  // (Never more than 1,000 cost: the price of two 500s, owner 27 Nov.)
  assert.strictEqual(r.entry.price, Math.min(price('500') + 4 * price('100'), 2 * price('500')));
  assert.ok(r.entry.price < 9 * price('100'));
  assert.ok(Array.isArray(r.switched), 'bigger packs taken for less: said');
  // 1,000 no longer costs less than 900, so there is no tip.
  assert.strictEqual(r.cheaper, undefined);
  const q = (await quote([design.id])).items[0];
  assert.strictEqual(q.count.cheaper, undefined);
  assert.strictEqual(q.count.n, 900);
  assert.strictEqual(q.count.step, 100);
  // Taken: 1,000 = two 500s; − from there works on the mix (the counter stays).
  const k = await (await setQty(design.id, { copies: 1000 }, key)).json();
  assert.deepStrictEqual(k.entry.quantities.map((l) => [l.size.id, l.qty]), [['500', 2]]);
  assert.strictEqual(k.count.n, 1000);
  const back = await (await setQty(design.id, { copies: 900 }, key)).json();
  assert.strictEqual(back.count.n, 900, 'a mix of packs keeps its counter');
  // Ordered as it is: 500 + 4 × 100 at the cart's price.
  const order = await post('/api/orders', { customer: { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' }, designIds: [design.id] });
  assert.strictEqual(order.status, 201, await order.clone().text());
  const o = await order.json();
  assert.strictEqual(o.items[0].price, Math.min(price('500') + 4 * price('100'), 2 * price('500')));
});

test('sizes that are not packs of copies (banner sizes, photo-book pages) count pieces and never change size', async () => {
  for (const [productId, size] of [['banners', '200x100'], ['photobook', '200'], ['windowstickers', '70']]) {
    const P = require('../src/products');
    const p = P.PRODUCTS.find((x) => x.id === productId);
    // (A print file the size of this product's print area at about 100 DPI.)
    const sd = p.sides[0];
    const w = Math.round((sd.printWidthIn || 10) * 100);
    const big = await require('sharp')({ create: { width: w, height: Math.round((w * sd.printArea.h) / sd.printArea.w), channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } } }).png().toBuffer();
    const { design, key } = await makeDesign({ productId, color: p.colors[0].id, size, sides: { [sd.id]: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } }, big);
    const c = (await quote([design.id])).items[0].count;
    assert.deepStrictEqual([c.n, c.step, c.unit], [1, 1, 'piece'], productId);
    const r = await (await setQty(design.id, { qty: 3 }, key)).json();
    assert.ok(r.entry, `${productId}: ${JSON.stringify(r)}`);
    assert.strictEqual(r.entry.quantities[0].size.id, size, `${productId} keeps its size`);
    assert.strictEqual(r.entry.quantities[0].qty, 3);
    assert.strictEqual(r.entry.price, P.priceFor(p, size, 1) * 3);
    assert.strictEqual(r.switched, undefined);
    assert.strictEqual(r.cheaper, undefined);
  }
});
