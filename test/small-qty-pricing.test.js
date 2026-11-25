'use strict';

// Small packs (from 1 copy: brochures, booklets, menus, cards, bookmarks…) when the owner changes prices:
//  - a lower product price: the small packs keep their share of it (never negative, never under 1 EGP),
//    and the shop (/api/products), the cart quote, the order and the admin all agree on the amount;
//  - the owner's own price for a pack still wins (and is never under 1 EGP either);
//  - a lower price is never refused because of the small packs;
//  - costs: a size's cost can take something off the blank (1 bookmark, not a pack of 25),
//    and an item never costs less than nothing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');
const accounting = require('../src/accounting');

const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Test', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '1 Street' };
let server;
let base;
let dataDir;
let token;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-smallqty-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const admin = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
const byId = (id) => PRODUCTS.find((p) => p.id === id);

/** A product's row in Accounts → Prices. */
async function priceRow(id) {
  return (await (await admin('/api/admin/pricing')).json()).products.find((p) => p.id === id);
}
/**
 * Save a product's prices and costs the way Accounts → Prices does: every field as the screen shows
 * it (the sizes' amounts as they stand now), with the owner's changes on top.
 */
async function savePrices(id, { basePrice, sizes = {}, costs = {}, costSizes = {} } = {}) {
  const row = await priceRow(id);
  const body = {
    basePrice: basePrice != null ? basePrice : row.basePrice,
    extraSidePrice: row.extraSidePrice,
    sizes: Object.fromEntries(row.sizes.map((s) => [s.id, sizes[s.id] !== undefined ? sizes[s.id] : s.surcharge])),
    costs: { ...row.costs, ...costs, sizes: Object.fromEntries(row.sizes.map((s) => [s.id, costSizes[s.id] !== undefined ? costSizes[s.id] : s.costExtra])) },
  };
  return admin(`/api/admin/pricing/${id}`, 'PUT', body);
}
/** Back to the built-in prices and no costs. */
async function reset(id) {
  const r = await admin(`/api/admin/pricing/${id}`, 'PUT', { costs: {} });
  assert.strictEqual(r.status, 200, await r.clone().text());
}
/** What the shop shows: each size's price ({ sizeId: EGP }). */
async function shopPrices(id) {
  const p = (await (await fetch(base + '/api/products')).json()).products.find((x) => x.id === id);
  return Object.fromEntries(p.sizes.map((z) => [z.id, p.basePrice + z.surcharge]));
}
const rowPrices = (row) => Object.fromEntries(row.sizes.map((z) => [z.id, row.basePrice + z.surcharge]));

/** Make a design the way the editor does (layout, files, complete) on the given sides. */
async function makeDesign(p, sizeId, extra = {}, only = null) {
  const sides = Object.fromEntries(p.sides.filter((s) => !only || only.includes(s.id)).map((s) => [s.id, { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } }]));
  const res = await post('/api/designs', { productId: p.id, color: p.colors[0].id, size: sizeId, sides, ...extra });
  assert.strictEqual(res.status, 201, `${p.id}: ${await res.clone().text()}`);
  const created = await res.json();
  for (const name of created.files) {
    const side = p.sides.find((s) => name.startsWith(`${s.id}-`));
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, sizeId) + 2 * side.bleedIn;
      const hIn = (printWidthFor(p, side, sizeId) * side.printArea.h) / side.printArea.w + 2 * side.bleedIn;
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, `${p.id} ${name}`);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, `${p.id}: ${await done.clone().text()}`);
  return done.json();
}

/** The design's price in the cart quote and on the order, which must agree with `want`. */
async function quoteAndOrder(d, want) {
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual(q.items[0].price, want, 'cart quote');
  const r = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id] });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const order = await r.json();
  assert.strictEqual(order.items[0].price, want, 'order');
  return order;
}

test('built-in prices are unchanged: small packs as written', async () => {
  assert.deepStrictEqual(await shopPrices('brochures'), { 1: 25, 10: 100, 25: 160, 100: 500, 250: 850, 500: 1250, 1000: 1900 });
  const booklets = await shopPrices('booklets');
  assert.deepStrictEqual([booklets['8-1'], booklets['8-10'], booklets['8-25'], booklets['8-50'], booklets['32-10']], [90, 360, 560, 900, 960]);
  // Every small pack is marked, and only those.
  const marked = PRODUCTS.flatMap((p) => p.sizes.filter((z) => z.smallPack).map((z) => `${p.id}/${z.id}`));
  assert.strictEqual(marked.length, 27, marked.join(' '));
  for (const id of ['postcards', 'foldedcards', 'giftvouchers', 'bookmarks', 'brochures', 'menus', 'folders', 'booklets']) {
    assert.ok(byId(id).sizes.some((z) => z.smallPack), `${id} has small packs`);
  }
  assert.ok(!byId('tshirt').sizes.some((z) => z.smallPack));
});

test('a lower price: small packs keep their share of it, and the shop, the quote and the order agree', async () => {
  try {
    // Brochures 500 → 450: 1 brochure was 25 (5%), so 22.5 → 23; 10 = 90 (20%), 25 = 144 (32%).
    let r = await savePrices('brochures', { basePrice: 450 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    let row = await r.json();
    const want450 = { 1: 23, 10: 90, 25: 144, 100: 450, 250: 800, 500: 1200, 1000: 1850 };
    assert.deepStrictEqual(rowPrices(row), want450, 'admin');
    assert.deepStrictEqual(await shopPrices('brochures'), want450, '/api/products');
    // The shop page's "from" price and the size chips use the same amounts (none negative).
    assert.ok(Object.values(await shopPrices('brochures')).every((v) => v >= 1));

    // Saved again from the screen, which now shows the 1-brochure pack at -427: it keeps following the price.
    r = await savePrices('brochures', { basePrice: 400 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    row = await r.json();
    assert.deepStrictEqual([rowPrices(row)[1], rowPrices(row)[10], rowPrices(row)[25]], [20, 80, 128]);
    const shop = await shopPrices('brochures');
    assert.deepStrictEqual([shop[1], shop[10], shop[25], shop[250]], [20, 80, 128, 750]);

    // Ordered: the design, the cart quote and the order are charged what the shop shows.
    const d = await makeDesign(byId('brochures'), '1');
    assert.strictEqual(d.price, 20);
    await quoteAndOrder(d, 20);

    // Booklets 900 → 850 (an 8-page booklet of 1 was charged 40 instead of about 90): 85 now.
    r = await savePrices('booklets', { basePrice: 850 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const b850 = rowPrices(await r.json());
    assert.deepStrictEqual([b850['8-1'], b850['8-10'], b850['8-25'], b850['8-50'], b850['16-1'], b850['32-10']], [85, 340, 529, 850, 132, 907]);
    assert.deepStrictEqual(await shopPrices('booklets'), b850, '/api/products');
    const bk = await makeDesign(byId('booklets'), '8-1', { options: { binding: 'left' } }, ['front', 'p3', 'back']);
    assert.strictEqual(bk.price, 85);
    await quoteAndOrder(bk, 85);

    // A very low price: the small packs never go under 1 EGP.
    r = await savePrices('brochures', { basePrice: 5 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const low = rowPrices(await r.json());
    assert.deepStrictEqual([low[1], low[10], low[25], low[100]], [1, 1, 2, 5]);
    assert.ok(Object.values(await shopPrices('brochures')).every((v) => v >= 1));
  } finally {
    await reset('brochures');
    await reset('booklets');
  }
  assert.deepStrictEqual((await shopPrices('brochures'))[1], 25, 'back to the built-in prices');
  assert.deepStrictEqual((await shopPrices('booklets'))['8-1'], 90);
});

test('a lower price is never refused because of the small packs (Accounts and the product page)', async () => {
  try {
    // Booklets at 800 used to be refused ("prices cannot go below 1"): the 8-page booklet of 1 was 800 - 810.
    let r = await savePrices('booklets', { basePrice: 800 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const b800 = rowPrices(await r.json());
    assert.strictEqual(b800['8-1'], 80);
    assert.ok(Object.values(b800).every((v) => v >= 1));
    // Products screen: only the price sent (empty sizes = as built), and the amounts the screen shows.
    r = await admin('/api/admin/catalog/brochures', 'PUT', { prices: { basePrice: 450 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    let P = await r.json();
    assert.strictEqual(P.basePrice + P.sizes.find((z) => z.id === '1').surcharge, 23);
    r = await admin('/api/admin/catalog/brochures', 'PUT', { prices: { basePrice: '300', extraSidePrice: '', sizes: Object.fromEntries(P.sizes.map((z) => [z.id, String(z.surcharge)])) } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    P = await r.json();
    assert.strictEqual(P.basePrice + P.sizes.find((z) => z.id === '1').surcharge, 15, '5% of 300');
    assert.strictEqual((await shopPrices('brochures'))[1], 15);
    // A new product made from it keeps the same prices, still following its own price.
    r = await admin('/api/admin/catalog', 'POST', { id: 'brochures-b', template: 'brochures', name: { en: 'B', ar: 'ب' }, prices: { basePrice: P.basePrice, extraSidePrice: '', sizes: Object.fromEntries(P.sizes.map((z) => [z.id, z.surcharge])) } });
    assert.strictEqual(r.status, 201, await r.clone().text());
    const made = await r.json();
    assert.ok(!made.warning, made.warning);
    assert.strictEqual(made.basePrice + made.sizes.find((z) => z.id === '1').surcharge, 15);
    r = await savePrices('brochures-b', { basePrice: 200 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual(rowPrices(await r.json())[1], 10);
    // Still refused: a price under 1, or a pack's own price that makes it free.
    assert.strictEqual((await savePrices('booklets', { basePrice: 0 })).status, 400);
    assert.strictEqual((await savePrices('booklets', { basePrice: 800, sizes: { '8-1': -800 } })).status, 400);
  } finally {
    await reset('booklets');
    await reset('brochures');
  }
});

test("the owner's own price for a small pack wins, and is never under 1 EGP", async () => {
  try {
    // 1 brochure at 50 (the owner's own price), at a product price of 450 (it would follow to 23).
    let r = await savePrices('brochures', { basePrice: 450, sizes: { 1: -400 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    let prices = rowPrices(await r.json());
    assert.deepStrictEqual([prices[1], prices[10]], [50, 90]);
    assert.strictEqual((await shopPrices('brochures'))[1], 50);
    // A new product price leaves the owner's amount as it is (the others follow).
    r = await savePrices('brochures', { basePrice: 420 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    prices = rowPrices(await r.json());
    assert.deepStrictEqual([prices[1], prices[10]], [20, 84]);
    const d = await makeDesign(byId('brochures'), '1');
    assert.strictEqual(d.price, 20);
    await quoteAndOrder(d, 20);
    // Back to following the price: the field emptied.
    r = await savePrices('brochures', { basePrice: 420, sizes: { 1: '' } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual(rowPrices(await r.json())[1], 21, '5% of 420');
    // An own price saved some other way (or before a PRICE_FACTOR change) that would be under 1 EGP: 1 EGP.
    accounting.applyPricing(PRODUCTS, { brochures: { basePrice: 450, sizes: { 1: -470 } } });
    const p = byId('brochures');
    assert.strictEqual(p.basePrice + p.sizes.find((z) => z.id === '1').surcharge, 1);
  } finally {
    await reset('brochures');
  }
  // Every request lays the saved prices over again.
  assert.strictEqual((await shopPrices('brochures'))[1], 25);
});

test('costs: a size can take something off the blank (1 bookmark), and an item never costs less than nothing', async () => {
  try {
    // A pack of 25 bookmarks costs 60 blank + 20 printing; 1 bookmark needs only 10 of it.
    let r = await savePrices('bookmarks', { costs: { blank: 60, printFirst: 20 }, costSizes: { 1: -70 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const row = await r.json();
    assert.strictEqual(row.sizes.find((z) => z.id === '1').costExtra, -70);
    const d = await makeDesign(byId('bookmarks'), '1', {}, ['front']);
    assert.strictEqual(d.price, 35);
    const order = await quoteAndOrder(d, 35);
    const today = accounting.localDay(order.createdAt);
    const rep = await (await admin(`/api/admin/accounts?from=${today}&to=${today}`)).json();
    const o = rep.orders.find((x) => x.id === order.id);
    assert.strictEqual(o.itemCost, 10);
    assert.strictEqual(o.items[0].cost, 10);
    assert.deepStrictEqual(o.items[0].costParts, { blank: -10, print: 20, embroidery: 0, other: 0 });
    // The pack of 25 still costs the whole blank.
    const costs = { bookmarks: { blank: 60, printFirst: 20, sizes: { 1: -70 } } };
    assert.strictEqual(accounting.itemCostFrom(costs, { productId: 'bookmarks', size: { id: '25' }, sides: [{}] }).total, 80);
    // Too much taken off: the item costs nothing, not less (and its parts still add up).
    r = await savePrices('bookmarks', { costSizes: { 1: -500 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const c = accounting.itemCostFrom({ bookmarks: { blank: 60, printFirst: 20, other: 5, sizes: { 1: -500 } } }, { productId: 'bookmarks', size: { id: '1' }, sides: [{}, {}] });
    assert.strictEqual(c.total, 0);
    assert.strictEqual(c.blank + c.print + c.embroidery + c.other, 0);
    const lines = accounting.itemCostFrom({ bookmarks: { blank: 60, printFirst: 20, sizes: { 1: -500 } } }, { productId: 'bookmarks', size: { id: '1' }, sides: [{}], quantities: [{ size: { id: '1' }, qty: 3 }, { size: { id: '25' }, qty: 1 }] });
    assert.strictEqual(lines.total, 80, 'the single bookmarks cost nothing, the pack of 25 costs 80');
    const d2 = await makeDesign(byId('bookmarks'), '1', {}, ['front']);
    const order2 = await quoteAndOrder(d2, 35);
    const rep2 = await (await admin(`/api/admin/accounts?from=${today}&to=${today}`)).json();
    assert.strictEqual(rep2.orders.find((x) => x.id === order2.id).itemCost, 0);
    // Still refused: something that isn't a number, and a negative blank or printing cost.
    assert.strictEqual((await savePrices('bookmarks', { costSizes: { 1: 'abc' } })).status, 400);
    assert.strictEqual((await savePrices('bookmarks', { costs: { blank: -5 } })).status, 400);
  } finally {
    await reset('bookmarks');
  }
});
