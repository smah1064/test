'use strict';

// The product manager (admin → Products): hiding products, stock, sold-out colours and sizes,
// print setup, new products made from another one, photos, prices, and the staff sign-in
// that only opens the Products screen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-catalog-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const req = (method, url, body, token) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (url, body, token) => req('POST', url, body, token);
const put = (url, body, token = owner) => req('PUT', url, body, token);
const shop = async () => (await (await fetch(`${base}/api/products`)).json()).products;
const byId = (id) => PRODUCTS.find((p) => p.id === id);
const CUSTOMER = { name: 'Test', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '1 Street' };

async function makeDesign(id, { color, size, sides } = {}) {
  const p = byId(id);
  const sz = p.sizes.find((z) => z.id === size) || p.sizes.find((z) => !z.soldOut && !z.off);
  const use = (sides || [p.sides[0].id]).map((sid) => p.sides.find((s) => s.id === sid));
  const res = await post('/api/designs', { productId: id, color: color || p.colors.find((c) => !c.soldOut && !c.off).id, size: sz.id, sides: Object.fromEntries(use.map((s) => [s.id, { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } }])) });
  if (res.status !== 201) return { status: res.status, body: await res.json() };
  const created = await res.json();
  for (const name of created.files) {
    const side = use.find((s) => name.startsWith(`${s.id}-`));
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, sz.id) + 2 * (side.bleedIn || 0);
      const hIn = (printWidthFor(p, side, sz.id) * side.printArea.h) / side.printArea.w + 2 * (side.bleedIn || 0);
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: '#2050c0' } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return { status: 201, body: await done.json() };
}
const order = (designIds) => post('/api/orders', { customer: CUSTOMER, designIds });

test('a hidden product leaves the shop, can\'t be designed or ordered, and comes back when shown', async () => {
  const before = await makeDesign('mug');
  assert.strictEqual(before.status, 201);
  const r = await put('/api/admin/catalog/mug', { status: 'hidden', hiddenReason: 'stock', hiddenNote: 'waiting for the supplier' });
  assert.strictEqual(r.status, 200);
  const row = await r.json();
  assert.strictEqual(row.visible, false);
  assert.strictEqual(row.hiddenReason, 'stock');
  assert.ok(!(await shop()).some((p) => p.id === 'mug'));
  const lib = await (await fetch(`${base}/api/library`)).json();
  assert.ok(lib.designs.every((d) => !(d.products || []).includes('mug')), 'ready designs no longer offer it');
  const again = await makeDesign('mug');
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.code, 'productUnavailable');
  // A mug already in a cart: the cart says why, and the order is refused.
  const quote = await (await post('/api/cart/quote', { designIds: [before.body.id] })).json();
  assert.strictEqual(quote.items[0].unavailable, 'productUnavailable');
  assert.match(quote.items[0].unavailableText, /available|متاح/);
  const o = await order([before.body.id]);
  assert.strictEqual(o.status, 409);
  assert.strictEqual((await o.json()).code, 'productUnavailable');
  // Shown again: orderable.
  await put('/api/admin/catalog/mug', { status: 'live' });
  assert.ok((await shop()).some((p) => p.id === 'mug'));
  assert.strictEqual((await order([before.body.id])).status, 201);
});

test('counted stock goes down with every order, stops orders it can\'t cover and hides the product at 0', async () => {
  await put('/api/admin/catalog/tote', { stock: 2, lowStockAt: 3 });
  const listed = (await shop()).find((p) => p.id === 'tote');
  assert.strictEqual(listed.fewLeft, 2, 'shows "only 2 left"');
  assert.strictEqual(listed.stock, undefined, 'the count itself stays in the admin');
  const a = await makeDesign('tote');
  const b = await makeDesign('tote');
  const c = await makeDesign('tote');
  assert.strictEqual((await order([a.body.id])).status, 201);
  const tooMany = await order([b.body.id, c.body.id]);
  assert.strictEqual(tooMany.status, 409);
  assert.strictEqual((await tooMany.json()).code, 'notEnoughStock');
  assert.strictEqual((await order([b.body.id])).status, 201);
  const row = await (await req('GET', '/api/admin/catalog/tote', undefined, owner)).json();
  assert.strictEqual(row.stock, 0);
  assert.strictEqual(row.visible, false);
  assert.ok(!(await shop()).some((p) => p.id === 'tote'), 'sold out: not in the shop');
  await put('/api/admin/catalog/tote', { stock: null });
  assert.ok((await shop()).some((p) => p.id === 'tote'), 'not counted any more: back');
});

test('sold-out and switched-off colours and sizes', async () => {
  const r = await put('/api/admin/catalog/hoodie', { colors: { black: { soldOut: true }, navy: { off: true } }, sizes: { XL: { soldOut: true }, '3XL': { off: true }, M: { label: { en: 'Medium', ar: 'وسط' } } } });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const p = (await shop()).find((x) => x.id === 'hoodie');
  assert.ok(p.colors.find((c) => c.id === 'black').soldOut);
  assert.ok(!p.colors.some((c) => c.id === 'navy'), 'off colours are left out');
  assert.ok(p.sizes.find((z) => z.id === 'XL').soldOut);
  assert.ok(!p.sizes.some((z) => z.id === '3XL'));
  assert.strictEqual(p.sizes.find((z) => z.id === 'M').label.en, 'Medium');
  assert.strictEqual((await makeDesign('hoodie', { color: 'black' })).body.code, 'colorUnavailable');
  assert.strictEqual((await makeDesign('hoodie', { color: 'navy' })).body.code, 'colorUnavailable');
  assert.strictEqual((await makeDesign('hoodie', { size: 'XL' })).body.code, 'sizeUnavailable');
  assert.strictEqual((await makeDesign('hoodie', { size: 'M' })).status, 201);
  // At least one colour must stay on.
  const all = Object.fromEntries(byId('hoodie').colors.map((c) => [c.id, { off: true }]));
  const bad = await put('/api/admin/catalog/hoodie', { colors: all });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).code, 'needOneColor');
  // Added colour and size.
  const add = await put('/api/admin/catalog/hoodie', { addColors: [{ id: 'mint', name: { en: 'Mint', ar: 'نعناعي' }, hex: '#98ff98' }], addSizes: [{ id: '4XL', label: { en: '4XL', ar: '4XL' }, surcharge: 120 }] });
  assert.strictEqual(add.status, 200, await add.clone().text());
  const p2 = (await shop()).find((x) => x.id === 'hoodie');
  assert.ok(p2.colors.some((c) => c.id === 'mint' && c.hex === '#98ff98'));
  assert.strictEqual(p2.sizes.find((z) => z.id === '4XL').surcharge, 120);
  const d = await makeDesign('hoodie', { color: 'mint', size: '4XL' });
  assert.strictEqual(d.status, 201);
  assert.strictEqual(d.body.price, p2.basePrice + 120);
});

test('print setup: print width, margins and the print area are used for new designs', async () => {
  const r = await put('/api/admin/catalog/poster', { sides: { front: { printWidthCm: 40, safeMm: 8, bleedMm: 4 } } });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const row = await r.json();
  assert.strictEqual(row.sides[0].printWidthCm, 40);
  assert.strictEqual(row.sides[0].safeMm, 8);
  const d = await makeDesign('poster');
  assert.strictEqual(d.status, 201);
  assert.ok(Math.abs(d.body.sides[0].widthIn * 2.54 - 40 * (byId('poster').sizes[0].printScale || 1)) < 0.05, 'the print is 40 cm wide');
  // The print area must stay inside the drawing.
  const bad = await put('/api/admin/catalog/poster', { sides: { front: { area: { x: 450, y: 10, w: 100, h: 100 } } } });
  assert.strictEqual(bad.status, 400);
  const moved = await put('/api/admin/catalog/poster', { sides: { front: { area: { x: 120, y: 100, w: 260, h: 340 } } } });
  assert.strictEqual(moved.status, 200);
  assert.deepStrictEqual((await shop()).find((p) => p.id === 'poster').sides[0].printArea.w, 260);
  // Undo everything: the poster as written again.
  const reset = await req('DELETE', '/api/admin/catalog/poster', undefined, owner);
  assert.strictEqual(reset.status, 200);
  assert.strictEqual((await reset.json()).sides[0].printArea.w, byId('poster').sides[0].printArea.w);
});

test('technology and embroidery', async () => {
  const bad = await put('/api/admin/catalog/mug', { process: 'dtf' });
  assert.strictEqual(bad.status, 400, 'a mug can\'t be printed with DTF');
  const r = await put('/api/admin/catalog/tshirt', { process: 'dtf', methods: ['dtf'], embroidery: { at: 'center', cm: [12, 8], surcharge: 200, maxColors: 8 } });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const t = (await shop()).find((p) => p.id === 'tshirt');
  assert.strictEqual(t.process, 'dtf');
  assert.deepStrictEqual(t.methods, ['dtf']);
  assert.strictEqual(t.embroidery.surcharge, 200);
  assert.ok(Math.abs(t.embroidery.widthIn * 2.54 - 12) < 0.1);
  await put('/api/admin/catalog/tshirt', { embroidery: false });
  assert.strictEqual((await shop()).find((p) => p.id === 'tshirt').embroidery, undefined, 'embroidery turned off');
  // A mug can't be embroidered.
  assert.strictEqual((await put('/api/admin/catalog/mug', { embroidery: { at: 'center', cm: [5, 5], surcharge: 10 } })).status, 400);
  await req('DELETE', '/api/admin/catalog/tshirt', undefined, owner);
  assert.ok((await shop()).find((p) => p.id === 'tshirt').embroidery, 'back as written');
});

test('prices from the product screen', async () => {
  const r = await put('/api/admin/catalog/cushion', { prices: { basePrice: 399 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await shop()).find((p) => p.id === 'cushion').basePrice, 399);
  assert.strictEqual((await put('/api/admin/catalog/cushion', { prices: { basePrice: -5 } })).status, 400);
});

test('a new product made from another one: hidden until published, then designable and orderable', async () => {
  const r = await post('/api/admin/catalog', { id: 'kids-cap', template: 'cap', name: { en: 'Kids cap', ar: 'كاب أطفال' } }, owner);
  assert.strictEqual(r.status, 201, await r.clone().text());
  const row = await r.json();
  assert.strictEqual(row.status, 'hidden');
  assert.strictEqual(row.template, 'cap');
  assert.strictEqual(row.name.en, 'Kids cap');
  assert.strictEqual((await post('/api/admin/catalog', { id: 'kids-cap', template: 'cap' }, owner)).status, 400, 'code taken');
  assert.strictEqual((await post('/api/admin/catalog', { id: 'Bad Id', template: 'cap' }, owner)).status, 400);
  assert.strictEqual((await post('/api/admin/catalog', { id: 'x-book', template: 'storybook-space' }, owner)).status, 400);
  assert.ok(!(await shop()).some((p) => p.id === 'kids-cap'));
  await put('/api/admin/catalog/kids-cap', { status: 'live', prices: { basePrice: 180 } });
  const list = await shop();
  const kc = list.find((p) => p.id === 'kids-cap');
  assert.ok(kc, 'published');
  assert.strictEqual(kc.base, 'cap', 'the shop knows which product\'s pictures to use');
  assert.strictEqual(list.indexOf(kc), list.findIndex((p) => p.id === 'cap') + 1, 'listed right after its template');
  assert.strictEqual(kc.basePrice, 180);
  const lib = await (await fetch(`${base}/api/library`)).json();
  assert.strictEqual(lib.designs.some((d) => (d.products || []).includes('cap')), lib.designs.some((d) => (d.products || []).includes('kids-cap')), 'gets the cap\'s ready designs');
  const d = await makeDesign('kids-cap');
  assert.strictEqual(d.status, 201);
  assert.strictEqual(d.body.price, 180);
  assert.strictEqual((await order([d.body.id])).status, 201);
  // Products are never deleted (even one nobody ordered): removed from the shop, and back any time.
  assert.strictEqual((await req('DELETE', '/api/admin/catalog/kids-cap', undefined, owner)).status, 409);
  await post('/api/admin/catalog', { id: 'temp-mug', template: 'mug' }, owner);
  const del = await req('DELETE', '/api/admin/catalog/temp-mug', undefined, owner);
  assert.strictEqual(del.status, 409);
  assert.strictEqual((await del.json()).code, 'productsKept');
  assert.strictEqual((await req('GET', '/api/admin/catalog/temp-mug', undefined, owner)).status, 200);
  await put('/api/admin/catalog/kids-cap', { status: 'removed' });
  assert.ok(!(await shop()).some((p) => p.id === 'kids-cap'));
  const back = await put('/api/admin/catalog/kids-cap', { status: 'live' });
  assert.strictEqual((await back.json()).basePrice, 180, 'back with its price and everything');
  assert.ok((await shop()).some((p) => p.id === 'kids-cap'));
});

test('product photos: uploaded, served, ordered, and the main one leads', async () => {
  const img = (bg) => sharp({ create: { width: 900, height: 700, channels: 3, background: bg } }).jpeg().toBuffer();
  const up = (buf, type = 'image/jpeg') => fetch(`${base}/api/admin/catalog/notebook/photos`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': type }, body: buf });
  assert.strictEqual((await up(await img('#ff0000'))).status, 201);
  const second = await up(await img('#00ff00'));
  const row = await second.json();
  assert.strictEqual(row.photos.length, 2);
  const shown = (await shop()).find((p) => p.id === 'notebook');
  assert.strictEqual(shown.mainPhoto, shown.photos[0].url);
  const file = await fetch(base + shown.photos[1].url);
  assert.strictEqual(file.status, 200);
  assert.strictEqual(file.headers.get('content-type'), 'image/webp');
  const r = await put('/api/admin/catalog/notebook/photos', { main: row.photos[1].id, order: [row.photos[1].id, row.photos[0].id] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await shop()).find((p) => p.id === 'notebook').mainPhoto, row.photos[1].url);
  assert.strictEqual((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(200)), 'image/svg+xml')).status, 400, 'only photos');
  assert.strictEqual((await req('DELETE', `/api/admin/catalog/notebook/photos/${row.photos[0].id}`, undefined, owner)).status, 200);
  assert.strictEqual((await fetch(base + row.photos[0].url)).status, 404);
  assert.strictEqual((await fetch(`${base}/catalog-photos/notebook/..%2f..%2fsecret.webp`)).status, 404);
});

test('product managers sign in with their own password and only reach the Products screen', async () => {
  const add = await post('/api/admin/staff', { name: 'Mona', username: 'mona', password: 'a-long-password' }, owner);
  assert.strictEqual(add.status, 201);
  const staff = (await add.json());
  assert.strictEqual((await post('/api/admin/staff', { name: 'X', username: 'mona', password: 'another-long-one' }, owner)).status, 400, 'username taken');
  assert.strictEqual((await post('/api/admin/login', { username: 'mona', password: 'wrong-password' })).status, 401);
  const login = await (await post('/api/admin/login', { username: 'mona', password: 'a-long-password' })).json();
  assert.strictEqual(login.role, 'products');
  const tok = login.token;
  assert.strictEqual((await (await req('GET', '/api/admin/session', undefined, tok)).json()).role, 'products');
  assert.strictEqual((await req('GET', '/api/admin/catalog', undefined, tok)).status, 200);
  const edit = await put('/api/admin/catalog/apron', { status: 'hidden', hiddenReason: 'season' }, tok);
  assert.strictEqual(edit.status, 200);
  assert.strictEqual((await edit.json()).updatedBy, 'mona');
  for (const url of ['/api/admin/orders', '/api/admin/staff', '/api/admin/pricing', '/api/admin/accounts', '/api/admin/library']) {
    assert.strictEqual((await req('GET', url, undefined, tok)).status, 401, url);
  }
  assert.strictEqual((await post('/api/admin/staff', { name: 'Y', username: 'yasser', password: 'a-long-password' }, tok)).status, 401);
  // The log says who changed what.
  const cat = await (await req('GET', '/api/admin/catalog', undefined, owner)).json();
  assert.ok(cat.log.some((l) => l.who === 'mona' && l.productId === 'apron'));
  // A new password signs them out everywhere; a removed account can't sign in.
  assert.strictEqual((await put(`/api/admin/staff/${staff.id}/password`, { password: 'brand-new-password' })).status, 204);
  assert.strictEqual((await req('GET', '/api/admin/catalog', undefined, tok)).status, 401);
  assert.strictEqual((await req('DELETE', `/api/admin/staff/${staff.id}`, undefined, owner)).status, 204);
  assert.strictEqual((await post('/api/admin/login', { username: 'mona', password: 'brand-new-password' })).status, 401);
});

test('bad input is refused with the field named', async () => {
  for (const body of [
    { name: { en: '', ar: 'x' } },
    { status: 'gone' },
    { stock: -1 },
    { stock: 1.5 },
    { category: 'nope' },
    { sides: { nope: { printWidthCm: 10 } } },
    { sides: { front: { printWidthCm: 0 } } },
    { addColors: [{ id: 'x', name: { en: 'X', ar: 'س' }, hex: 'red' }] },
    { colors: { nope: { off: true } } },
    { methods: ['dtg'] }, // a mug
  ]) {
    const r = await put('/api/admin/catalog/mug', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
  // HTML in names is stripped.
  const r = await put('/api/admin/catalog/mug', { name: { en: 'Mug <b>x</b>', ar: 'مج' } });
  assert.strictEqual((await r.json()).name.en, 'Mug  b x /b'.replace(/\s+/g, ' '));
  assert.strictEqual((await req('PUT', '/api/admin/catalog/mug', { status: 'live' })).status, 401, 'needs sign-in');
});

test('the cart warns about stock before checkout, books can be hidden, and hidden products keep their name', async () => {
  await put('/api/admin/catalog/apron', { status: 'live', stock: 1 });
  const a = await makeDesign('apron');
  const b = await makeDesign('apron');
  const q = await (await post('/api/cart/quote', { designIds: [a.body.id, b.body.id] })).json();
  assert.ok(q.items.every((i) => i.unavailable === 'notEnoughStock'), JSON.stringify(q.items));
  assert.match(q.items[0].unavailableText, /1/);
  const one = await (await post('/api/cart/quote', { designIds: [a.body.id] })).json();
  assert.strictEqual(one.items[0].unavailable, undefined, 'one piece is fine');
  await put('/api/admin/catalog/apron', { stock: null });
  // Books.
  const book = PRODUCTS.find((p) => p.kind === 'book');
  const r = await put(`/api/admin/catalog/${book.id}`, { status: 'hidden', hiddenReason: 'season' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  assert.ok(!(await shop()).some((p) => p.id === book.id));
  const made = await post(`/api/books/${book.book}/designs`, {});
  assert.strictEqual(made.status, 409);
  await put(`/api/admin/catalog/${book.id}`, { status: 'live' });
  // A hidden product's name, for saved drafts.
  await put('/api/admin/catalog/bottle', { status: 'hidden' });
  const n = await (await fetch(`${base}/api/products/bottle/name`)).json();
  assert.strictEqual(n.available, false);
  assert.ok(n.name.ar);
  assert.strictEqual((await fetch(`${base}/api/products/nope/name`)).status, 404);
});

test('a product made from another one gets that product\'s photo as its card picture', async () => {
  await post('/api/admin/catalog', { id: 'big-mug', template: 'mug' }, owner);
  const own = await fetch(`${base}/api/thumbs/big-mug/white.webp`);
  const tpl = await fetch(`${base}/api/thumbs/mug/white.webp`);
  assert.strictEqual(own.status, 200);
  assert.strictEqual(Buffer.compare(Buffer.from(await own.arrayBuffer()), Buffer.from(await tpl.arrayBuffer())), 0);
});

test('QA fixes: no free or negative sizes, added colours kept, refused orders take no stock, strict values', async () => {
  // A size can't make the product cost nothing or less.
  const neg = await put('/api/admin/catalog/sign', { addSizes: [{ id: 'free', label: { en: 'Free', ar: 'مجاني' }, surcharge: -100000 }] });
  assert.strictEqual(neg.status, 400);
  // Colours added earlier can be marked sold out without sending them again.
  assert.strictEqual((await put('/api/admin/catalog/sign', { addColors: [{ id: 'gold', name: { en: 'Gold', ar: 'دهبي' }, hex: '#d4af37' }] })).status, 200);
  const sold = await put('/api/admin/catalog/sign', { colors: { gold: { soldOut: true } } });
  assert.strictEqual(sold.status, 200, await sold.clone().text());
  assert.ok((await sold.json()).colors.find((c) => c.id === 'gold').soldOut);
  // Strict values.
  for (const body of [{ stock: true }, { name: ['a', 'b'] }, { embroidery: { at: 'chest', cm: [9, 9], surcharge: 100, maxColors: 2.5 } }]) {
    assert.strictEqual((await put('/api/admin/catalog/hoodie', body)).status, 400, JSON.stringify(body));
  }
  // lowStockAt 0: never "only n left".
  await put('/api/admin/catalog/mousepad', { stock: 3, lowStockAt: 0 });
  assert.strictEqual((await shop()).find((p) => p.id === 'mousepad').fewLeft, undefined);
  await put('/api/admin/catalog/mousepad', { stock: null, lowStockAt: null });
  // A new product's name in both languages.
  const half = await post('/api/admin/catalog', { id: 'retro-tee', template: 'tshirt', name: { en: 'Retro Tee' } }, owner);
  assert.strictEqual(half.status, 400);
  assert.strictEqual((await half.json()).field, 'name');
  // An order refused for stock takes nothing off the other products in it.
  await put('/api/admin/catalog/keychain', { stock: 5 });
  await put('/api/admin/catalog/coasters', { stock: 0, status: 'live' });
  await put('/api/admin/catalog/coasters', { stock: 1 });
  const k = await makeDesign('keychain');
  const c1 = await makeDesign('coasters');
  const c2 = await makeDesign('coasters');
  const o = await order([k.body.id, c1.body.id, c2.body.id]);
  assert.strictEqual(o.status, 409);
  const row = await (await req('GET', '/api/admin/catalog/keychain', undefined, owner)).json();
  assert.strictEqual(row.stock, 5, 'nothing taken off');
  await put('/api/admin/catalog/keychain', { stock: null });
  await put('/api/admin/catalog/coasters', { stock: null });
});

test('selling prices are the owner\'s, and wrong staff passwords never lock the owner out', async () => {
  const add = await post('/api/admin/staff', { name: 'Hana', username: 'hana', password: 'hana-long-password' }, owner);
  assert.strictEqual(add.status, 201);
  const tok = (await (await post('/api/admin/login', { username: 'hana', password: 'hana-long-password' })).json()).token;
  const r = await put('/api/admin/catalog/apron', { prices: { basePrice: 1 } }, tok);
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).code, 'ownerOnly');
  // Other changes still work for them, and a new product they make starts at the template's prices.
  assert.strictEqual((await put('/api/admin/catalog/apron', { lowStockAt: 4 }, tok)).status, 200);
  const made = await (await post('/api/admin/catalog', { id: 'hana-mug', template: 'mug', name: { en: 'Hana mug', ar: 'مج هنا' }, prices: { basePrice: 2 } }, tok)).json();
  assert.strictEqual(made.basePrice, byId('mug').basePrice);
  // Five wrong staff passwords: staff sign-in waits, the owner signs in as usual.
  for (let i = 0; i < 6; i++) await post('/api/admin/login', { username: 'hana', password: 'wrong-password-x' });
  assert.strictEqual((await post('/api/admin/login', { username: 'hana', password: 'hana-long-password' })).status, 429);
  const own = await post('/api/admin/login', { password: 'secret-owner-pass' });
  assert.strictEqual(own.status, 200, 'the owner is not locked out');
});
