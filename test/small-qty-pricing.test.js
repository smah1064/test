'use strict';

// Small packs (from 1 copy: brochures, booklets, menus, cards, bookmarks…) when the owner changes prices:
//  - a lower product price: the small packs keep their share of it (never negative, never under 1 EGP),
//    and the shop (/api/products), the cart quote, the order and the admin all agree on the amount;
//  - the owner's own price for a pack still wins (and is never under 1 EGP either); it is the pack's own
//    final price, kept whatever the product's price does (QA: it was kept as an amount off the product's
//    price, so raising the price made 1 brochure dearer than 10), and emptying it follows the price again;
//  - a lower price is never refused because of the small packs;
//  - costs: a size's cost can take something off the blank (1 bookmark, not a pack of 25),
//    and an item never costs less than nothing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
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
/** Brochures: a small pack that follows the product's price costs its share of it (built-in price of 500). */
const follow = (base, builtIn) => Math.max(1, Math.round((base * builtIn) / 500));

/** The product's saved prices as they are in the data file. */
const dbFile = () => path.join(dataDir, 'db.json');
const savedPricing = (id) => (JSON.parse(fs.readFileSync(dbFile(), 'utf8')).pricing || {})[id];
/** Saved prices written to the data file by another copy of the app (here: as an earlier version saved them). */
function writeSavedPricing(id, record) {
  const db = fs.existsSync(dbFile()) ? JSON.parse(fs.readFileSync(dbFile(), 'utf8')) : {};
  db.pricing = { ...(db.pricing || {}), [id]: record };
  fs.writeFileSync(`${dbFile()}.next`, JSON.stringify(db, null, 2));
  fs.renameSync(`${dbFile()}.next`, dbFile());
}

/**
 * The Products screen's final-price column before saving (updateFinals in public/js/admin-products.js),
 * for the product as the admin API gives it and the boxes as typed ({ basePrice, 'ps.<size>': text }).
 */
function productsPreview(P, form) {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/admin-products.js'), 'utf8');
  const m = src.match(/ {2}function updateFinals\(\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(m, 'updateFinals in admin-products.js');
  const cells = P.sizes.map((z) => ({ dataset: { final: z.id }, textContent: '' }));
  vm.runInNewContext(`${m[0]}\nupdateFinals();`, {
    S: { P }, POD: { money: (v) => v }, t: (k) => k, POD_PACKS: require('../public/js/pack-prices.js'), showPackWarnings: () => {},
    val: (name) => (form[name] !== undefined ? String(form[name]) : undefined),
    root: { querySelectorAll: () => cells },
  });
  return Object.fromEntries(cells.map((c) => [c.dataset.final, c.textContent]));
}
/**
 * Save prices from the Products screen: every box as it shows it (text), with the owner's typing on
 * top. Returns what the screen showed before saving and the prices saved.
 */
async function productsScreenSave(id, { basePrice, sizes = {} } = {}) {
  const P0 = await (await admin(`/api/admin/catalog/${id}`)).json();
  const form = { basePrice: String(basePrice != null ? basePrice : P0.basePrice), extraSidePrice: P0.extraSidePrice == null ? '' : String(P0.extraSidePrice) };
  for (const z of P0.sizes) form[`ps.${z.id}`] = String(sizes[z.id] !== undefined ? sizes[z.id] : z.surcharge || 0);
  const preview = productsPreview(P0, form);
  const r = await admin(`/api/admin/catalog/${id}`, 'PUT', { prices: { basePrice: form.basePrice, extraSidePrice: form.extraSidePrice, sizes: Object.fromEntries(P0.sizes.map((z) => [z.id, form[`ps.${z.id}`]])) } });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const P = await r.json();
  return { preview, saved: Object.fromEntries(P.sizes.map((z) => [z.id, P.basePrice + z.surcharge])), P };
}
/** Every place that shows or charges a price agrees: Accounts, the Products screen and the shop. */
async function everywhere(id, want, msg) {
  assert.deepStrictEqual(rowPrices(await priceRow(id)), want, `${msg}: Accounts`);
  const P = await (await admin(`/api/admin/catalog/${id}`)).json();
  assert.deepStrictEqual(Object.fromEntries(P.sizes.map((z) => [z.id, P.basePrice + z.surcharge])), want, `${msg}: Products screen`);
  assert.deepStrictEqual(await shopPrices(id), want, `${msg}: /api/products`);
}

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
  // (+ the wooden invitation's one A4 keepsake, 28 Nov.)
  assert.strictEqual(marked.length, 28, marked.join(' '));
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
    // A new product price leaves the owner's price for the pack as it is (the others follow).
    r = await savePrices('brochures', { basePrice: 420 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    prices = rowPrices(await r.json());
    assert.deepStrictEqual([prices[1], prices[10]], [50, 84]);
    const d = await makeDesign(byId('brochures'), '1');
    assert.strictEqual(d.price, 50);
    await quoteAndOrder(d, 50);
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

test("QA: a pack price the owner set stays that pack's price when the product's price goes up, then down", async () => {
  try {
    // Brochures at 250, and 1 brochure at 40 EGP (typed as -210 against 250): saved as the pack's own price.
    let r = await savePrices('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    let row = await r.json();
    const want250 = { 1: 40, 10: 50, 25: 80, 100: 250, 250: 600, 500: 1000, 1000: 1650 };
    assert.deepStrictEqual(rowPrices(row), want250);
    assert.strictEqual(row.sizes.find((z) => z.id === '1').surcharge, -210, 'the box shows -210');
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 250, packs: { 1: 40 } }, 'its price, not an amount off the product price');
    await everywhere('brochures', want250, '250');

    // The product price raised to 600, every size left as shown (the 1-brochure box still says -210).
    r = await savePrices('brochures', { basePrice: 600 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const want600 = { 1: 40, 10: 120, 25: 192, 100: 600, 250: 950, 500: 1350, 1000: 2000 };
    assert.deepStrictEqual(rowPrices(await r.json()), want600, 'was 390 / 120 / 192');
    await everywhere('brochures', want600, '600');
    assert.ok(want600[1] < want600[10], '1 brochure is not dearer than 10');
    const d = await makeDesign(byId('brochures'), '1');
    assert.strictEqual(d.price, 40, 'design');
    await quoteAndOrder(d, 40);

    // Lowered to 200, every size left as shown (the box now says -560): not refused, and still 40.
    r = await savePrices('brochures', { basePrice: 200 });
    assert.strictEqual(r.status, 200, `not refused: ${await r.clone().text()}`);
    const want200 = { 1: 40, 10: 40, 25: 64, 100: 200, 250: 550, 500: 950, 1000: 1600 };
    assert.deepStrictEqual(rowPrices(await r.json()), want200);
    await everywhere('brochures', want200, '200');
    assert.ok(want200[1] <= want200[10], '1 brochure is not dearer than 10');
    const d2 = await makeDesign(byId('brochures'), '1');
    assert.strictEqual(d2.price, 40, 'design');
    await quoteAndOrder(d2, 40);
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 200, packs: { 1: 40 } });
  } finally {
    await reset('brochures');
  }
});

test("a pack's own price survives the product's price going up and down, from both admin screens, and the Products screen shows it before saving", async () => {
  try {
    // Set on the Products screen: the final-price column says 40 before saving, as saved.
    let s = await productsScreenSave('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.deepStrictEqual(s.preview, s.saved, 'preview = saved');
    assert.strictEqual(s.saved[1], 40);
    assert.ok(s.P.sizes.find((z) => z.id === '1').ownPrice, 'marked as its own price');
    assert.ok(!s.P.sizes.find((z) => z.id === '10').ownPrice, 'the others follow the price');

    // Up and down, saved from one screen then the other, every size left as shown.
    for (const [base, screen] of [[900, 'products'], [200, 'accounts'], [1000, 'products'], [333, 'accounts'], [500, 'products'], [260, 'products']]) {
      let saved;
      if (screen === 'products') {
        s = await productsScreenSave('brochures', { basePrice: base });
        assert.deepStrictEqual(s.preview, s.saved, `${base}: the Products screen's preview = saved`);
        saved = s.saved;
      } else {
        const r = await savePrices('brochures', { basePrice: base });
        assert.strictEqual(r.status, 200, await r.clone().text());
        saved = rowPrices(await r.json());
      }
      assert.strictEqual(saved[1], 40, `${base}: 1 brochure keeps its own price`);
      assert.deepStrictEqual([saved[10], saved[25], saved[100]], [follow(base, 100), follow(base, 160), base], `${base}: the others follow`);
      await everywhere('brochures', saved, String(base));
      assert.deepStrictEqual(savedPricing('brochures'), { ...(base !== 500 ? { basePrice: base } : {}), packs: { 1: 40 } });
    }

    // A price typed for another pack while the product's price changes: read against the new price, and
    // the preview agrees (1 brochure still 40, 10 brochures now 100 of their own, 25 follow 600).
    s = await productsScreenSave('brochures', { basePrice: 600, sizes: { 10: -500 } });
    assert.deepStrictEqual(s.preview, s.saved, 'preview = saved');
    assert.deepStrictEqual([s.saved[1], s.saved[10], s.saved[25]], [40, 100, 192]);
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 600, packs: { 1: 40, 10: 100 } });

    // Booklets of 10 with 32 pages cost more than the product's price: the preview follows the price too
    // (it showed 850 + 60 = 910 where the server charges 907).
    const b = await productsScreenSave('booklets', { basePrice: 850 });
    assert.deepStrictEqual(b.preview, b.saved, 'booklets: preview = saved');
    assert.strictEqual(b.saved['32-10'], 907);
  } finally {
    await reset('brochures');
    await reset('booklets');
  }
});

test("emptying a pack's own price makes it follow the product's price again (both admin screens)", async () => {
  try {
    // Accounts → Prices.
    let r = await savePrices('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    r = await savePrices('brochures', { sizes: { 1: '' } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual(rowPrices(await r.json())[1], 13, '5% of 250');
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 250 });
    r = await savePrices('brochures', { basePrice: 600 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual(rowPrices(await r.json())[1], 30, '5% of 600');
    await everywhere('brochures', { 1: 30, 10: 120, 25: 192, 100: 600, 250: 950, 500: 1350, 1000: 2000 }, 'following again');

    // The Products screen: the box emptied while the price changes; the preview shows the share too.
    let s = await productsScreenSave('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.strictEqual(s.saved[1], 40);
    s = await productsScreenSave('brochures', { basePrice: 600, sizes: { 1: '' } });
    assert.deepStrictEqual(s.preview, s.saved, 'preview = saved');
    assert.strictEqual(s.saved[1], 30);
    assert.ok(!s.P.sizes.find((z) => z.id === '1').ownPrice);
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 600 });
    s = await productsScreenSave('brochures', { basePrice: 300 });
    assert.strictEqual(s.saved[1], 15, 'follows: 5% of 300');
  } finally {
    await reset('brochures');
  }
});

test('pack prices saved by the earlier version (an amount added to the product price) are read at the price they were saved with', async () => {
  try {
    // What the earlier version saved for "brochures at 250, 1 brochure at 40".
    writeSavedPricing('brochures', { basePrice: 250, sizes: { 1: -210 } });
    await everywhere('brochures', { 1: 40, 10: 50, 25: 80, 100: 250, 250: 600, 500: 1000, 1000: 1650 }, 'as before');
    // Raised to 600 as shown: the pack keeps 40, and is saved as its own price from now on.
    let r = await savePrices('brochures', { basePrice: 600 });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.deepStrictEqual([rowPrices(await r.json())[1], (await shopPrices('brochures'))[10]], [40, 120]);
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 600, packs: { 1: 40 } });

    // Saved without a product price: it was written against the built-in price (500): 1 brochure at 40.
    writeSavedPricing('brochures', { sizes: { 1: -460 } });
    assert.strictEqual((await shopPrices('brochures'))[1], 40);
    const s = await productsScreenSave('brochures', { basePrice: 300 });
    assert.deepStrictEqual(s.preview, s.saved);
    assert.strictEqual(s.saved[1], 40);

    // The earlier version had already changed the pack's price when the product's price changed
    // (40 at 250 became 390 at 600, and the record only knows 600): it keeps the price the shop charges,
    // a lower product price is no longer refused because of it, and the owner can set it again.
    writeSavedPricing('brochures', { basePrice: 600, sizes: { 1: -210, 250: 400 } });
    await everywhere('brochures', { 1: 390, 10: 120, 25: 192, 100: 600, 250: 1000, 500: 1350, 1000: 2000 }, 'as charged');
    r = await savePrices('brochures', { basePrice: 200 });
    assert.strictEqual(r.status, 200, `not refused: ${await r.clone().text()}`);
    assert.deepStrictEqual(savedPricing('brochures'), { basePrice: 200, sizes: { 250: 400 }, packs: { 1: 390 } });
    r = await savePrices('brochures', { sizes: { 1: 40 - 200 } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    await everywhere('brochures', { 1: 40, 10: 40, 25: 64, 100: 200, 250: 600, 500: 950, 1000: 1600 }, 'set again');
  } finally {
    await reset('brochures');
  }
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
