'use strict';

// Packs priced the wrong way round: the owner's own price for a small pack stays fixed (1 brochure at 40)
// while the other packs follow the product's price, so a lower product price can make a bigger pack cost
// less in total than a smaller one (10 brochures at 35). The admin warns about it (Products → Prices as the
// owner types, Accounts → Prices before and after saving); saving still works.
//  - accounting.cheaperBiggerPacks(product): the problems at the product's prices as they stand;
//  - public/js/pack-prices.js (shared with the admin screens): the prices the server will save for the
//    boxes as typed (the same as cleanPricing + applyPricing, for any boxes), and the same problems.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createApp } = require('../src/app');
const { PRODUCTS } = require('../src/products');
const accounting = require('../src/accounting');
const PACKS = require('../public/js/pack-prices.js');

let server;
let base;
let dataDir;
let token;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-packwarn-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const admin = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
const byId = (id) => PRODUCTS.find((p) => p.id === id);
const SMALL_PACK_PRODUCTS = ['postcards', 'foldedcards', 'giftvouchers', 'bookmarks', 'brochures', 'menus', 'folders', 'booklets'];
/** A warning list as [bigger, its price, smaller, its price]. */
const short = (list) => list.map((w) => [w.bigger.id, w.bigger.price, w.smaller.id, w.smaller.price]);
/** The product's warnings with these saved prices laid over (the shop's prices go back afterwards). */
function warningsWith(id, pricing) {
  accounting.applyPricing(PRODUCTS, { [id]: pricing });
  try {
    return short(accounting.cheaperBiggerPacks(byId(id)));
  } finally {
    accounting.applyPricing(PRODUCTS, {});
  }
}

test('built-in prices: no pack costs less than a smaller one', () => {
  accounting.applyPricing(PRODUCTS, {});
  for (const p of PRODUCTS) assert.deepStrictEqual(accounting.cheaperBiggerPacks(p), [], p.id);
});

test("the owner's own price for 1 brochure with a lower product price: the bigger packs that cost less", () => {
  // The owner's example: 1 brochure at 40, the product's price down to 175 → 10 brochures at 35.
  assert.deepStrictEqual(warningsWith('brochures', { basePrice: 175, packs: { 1: 40 } }), [['10', 35, '1', 40]]);
  accounting.applyPricing(PRODUCTS, { brochures: { basePrice: 175, packs: { 1: 40 } } });
  const [w] = accounting.cheaperBiggerPacks(byId('brochures'));
  assert.deepStrictEqual(w.bigger.label, { en: '10 brochures', ar: '10 بروشورات' }, 'labels to show');
  assert.deepStrictEqual(w.smaller.label, { en: '1 brochure', ar: 'بروشور واحد' });
  accounting.applyPricing(PRODUCTS, {});
  // Lower still: 25 brochures (32) too; one line per problem.
  assert.deepStrictEqual(warningsWith('brochures', { basePrice: 100, packs: { 1: 40 } }), [['10', 20, '1', 40], ['25', 32, '1', 40]]);
  // Raised back: none (10 brochures at 100).
  assert.deepStrictEqual(warningsWith('brochures', { basePrice: 500, packs: { 1: 40 } }), []);
  // The same price is not less: no warning (1 and 10 brochures both at 40).
  assert.deepStrictEqual(warningsWith('brochures', { basePrice: 200, packs: { 1: 40 } }), []);
  // An own price for a bigger pack and a higher product price: 1 brochure (5%) passes 10 brochures at 50.
  assert.deepStrictEqual(warningsWith('brochures', { basePrice: 1200, packs: { 10: 50 } }), [['10', 50, '1', 60]]);
});

test('no warning for products without own pack prices, whatever the price (down to 1 EGP packs)', () => {
  for (const id of SMALL_PACK_PRODUCTS) {
    const d = accounting.defaultsFor(id);
    for (const f of [0.01, 0.05, 0.2, 0.37, 0.5, 0.8, 0.9, 1.1, 1.5, 2]) {
      const price = Math.max(1, Math.round(d.basePrice * f));
      // (Booklets above 2250: 32 pages × 25 copies keeps its share of the price, which then passes the
      // 50-copy booklet's fixed add-on; a real problem, checked below.)
      if (id === 'booklets' && price > 2250) continue;
      assert.deepStrictEqual(warningsWith(id, { basePrice: price }), [], `${id} at ${price}`);
    }
  }
  // Booklets at 3000 with no prices of their own: 50 copies of 32 pages (4500) do cost less than 25 (5000).
  assert.deepStrictEqual(warningsWith('booklets', { basePrice: 3000 }), [['32-50', 4500, '32-25', 5000]]);
});

test('only packs of the same kind are compared (sheet size, pages), and sizes that are off are left out', () => {
  // Menus at 50 with A3 × 1 at 300 of its own: A3 × 10 (250) costs less; A4 × 10 (50) is another sheet.
  assert.deepStrictEqual(warningsWith('menus', { basePrice: 50, packs: { 'A3-1': 300 } }), [['A3-10', 250, 'A3-1', 300]]);
  // Booklets at 700 with 16 pages × 1 copy at 500: 16 pages × 10 copies (436) costs less; 8 pages × 10 (280) is another booklet.
  assert.deepStrictEqual(warningsWith('booklets', { basePrice: 700, packs: { '16-1': 500 } }), [['16-10', 436, '16-1', 500]]);
  // A size that is off isn't sold: no warning about it.
  accounting.applyPricing(PRODUCTS, { brochures: { basePrice: 175, packs: { 1: 40 } } });
  const p = byId('brochures');
  const off = { ...p, sizes: p.sizes.map((z) => (z.id === '10' ? { ...z, off: true } : z)) };
  assert.deepStrictEqual(accounting.cheaperBiggerPacks(off), []);
  accounting.applyPricing(PRODUCTS, {});
  // Pack ids: count and kind.
  assert.deepStrictEqual(['10', 'A4-25', '16-50', '50x30-100', '85x200', 'M'].map(PACKS.packOf), [{ kind: '', count: 10 }, { kind: 'A4', count: 25 }, { kind: '16', count: 50 }, { kind: '50x30', count: 100 }, null, null]);
  // Products with no small packs (business cards, banners, window stickers…) aren't checked.
  assert.deepStrictEqual(warningsWith('bizcards', { sizes: { 200: -100 } }), []);
});

// ---------- The admin screens' prices before saving = what the server saves ----------
/** A small pseudo-random sequence (the same every run). */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
/** A small pack's amount on top of `base` when it follows the price (the server's packSurcharge). */
function shareAmount(d, id, b) {
  if (b === d.basePrice) return d.sizes[id];
  return Math.max(1, Math.round((b * (d.basePrice + d.sizes[id])) / d.basePrice)) - b;
}
const snapshot = (p) => JSON.parse(JSON.stringify({ basePrice: p.basePrice, sizes: p.sizes.map((z) => ({ id: z.id, label: z.label, surcharge: z.surcharge, ...(z.smallPack ? { smallPack: true } : {}), ...(z.ownPrice ? { ownPrice: true } : {}) })) }));

test('the prices the admin works out before saving are the prices the server saves (any boxes, both screens)', () => {
  const rand = rng(20261125);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let checked = 0;
  let ambiguous = 0;
  try {
    for (const id of SMALL_PACK_PRODUCTS) {
      const d = accounting.defaultsFor(id);
      for (let i = 0; i < 80; i++) {
        // Prices as they stand: maybe a price of the owner's, maybe some packs at prices of their own.
        const now = {};
        if (rand() < 0.7) now.basePrice = Math.round(d.basePrice * (0.1 + rand() * 2));
        const packs = {};
        for (const z of byId(id).sizes) if (z.smallPack && rand() < 0.35) packs[z.id] = Math.round(1 + rand() * d.basePrice);
        if (Object.keys(packs).length) now.packs = packs;
        accounting.applyPricing(PRODUCTS, { [id]: now });
        const p = byId(id);
        const shown = snapshot(p);
        // The boxes: left as shown, emptied, a new amount, or the amount that is the pack's share of the new price.
        const newBase = pick(['', p.basePrice, Math.round(d.basePrice * (0.05 + rand() * 2.5)), Math.round(d.basePrice * rand() * 100) / 100 + 1]);
        const b = newBase === '' ? d.basePrice : Math.round(Number(newBase) * 100) / 100;
        const asText = rand() < 0.5;
        const form = { basePrice: asText ? String(newBase) : newBase, extraSidePrice: '', sizes: {} };
        for (const z of p.sizes) {
          const how = pick(['shown', 'shown', 'empty', 'new', 'share']);
          let v = z.surcharge;
          if (how === 'empty') v = '';
          else if (how === 'new') v = Math.round(1 - b + rand() * (b + 300));
          else if (how === 'share' && z.smallPack) v = shareAmount(d, z.id, b);
          form.sizes[z.id] = asText ? String(v) : v;
        }
        const preview = PACKS.savedPrices(shown, d, form);
        // As the Accounts screen sees the row (it doesn't say which packs have prices of their own).
        const rowNow = PACKS.withOwnPrices({ ...shown, sizes: shown.sizes.map(({ ownPrice, ...z }) => z) }, d);
        const accountsPreview = PACKS.savedPrices(rowNow, d, form);
        const r = accounting.cleanPricing(p, form);
        if (r.error) continue; // refused by the server: the screen shows the error on saving
        accounting.applyPricing(PRODUCTS, { [id]: r.pricing });
        const saved = Object.fromEntries(byId(id).sizes.map((z) => [z.id, accounting.round2(byId(id).basePrice + z.surcharge)]));
        assert.deepStrictEqual(preview, saved, `${id} #${i}: ${JSON.stringify({ now, form })}`);
        assert.deepStrictEqual(PACKS.cheaperBiggerPacks(shown.sizes, preview), accounting.cheaperBiggerPacks(byId(id)), `${id} #${i}: warnings`);
        // Accounts reads a pack's own price from its amount: the same, unless that own price happens to be
        // exactly the pack's share of today's price.
        const misread = rowNow.sizes.filter((z, k) => z.smallPack && Boolean(z.ownPrice) !== Boolean(shown.sizes[k].ownPrice));
        if (misread.length) {
          ambiguous++;
          for (const z of misread) assert.strictEqual(z.surcharge, Math.max(shareAmount(d, z.id, shown.basePrice), 1 - shown.basePrice), `${id} #${i}: ${z.id}`);
        } else assert.deepStrictEqual(accountsPreview, saved, `${id} #${i} (Accounts): ${JSON.stringify({ now, form })}`);
        checked++;
      }
    }
  } finally {
    accounting.applyPricing(PRODUCTS, { reset: {} });
  }
  assert.ok(checked > 400, `checked ${checked}`);
  assert.ok(ambiguous < checked / 20, `ambiguous ${ambiguous}`);
});

// ---------- Through the admin's own screens ----------
/**
 * The Products screen's prices section as the owner types (updateFinals in public/js/admin-products.js):
 * the final-price column and the warnings it shows before saving.
 */
function productsScreen(P, form) {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/admin-products.js'), 'utf8');
  const m = src.match(/ {2}function updateFinals\(\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(m, 'updateFinals in admin-products.js');
  const cells = P.sizes.map((z) => ({ dataset: { final: z.id }, textContent: '' }));
  let warnings = null;
  vm.runInNewContext(`${m[0]}\nupdateFinals();`, {
    S: { P }, POD: { money: (v) => v }, t: (k) => k, POD_PACKS: PACKS,
    showPackWarnings: (p, prices) => { warnings = PACKS.cheaperBiggerPacks(p.sizes, prices); },
    val: (name) => (form[name] !== undefined ? String(form[name]) : undefined),
    root: { querySelectorAll: () => cells },
  });
  return { finals: Object.fromEntries(cells.map((c) => [c.dataset.final, c.textContent])), warnings: short(warnings) };
}
/** Type into the Products screen's prices (every box as shown, with the owner's typing on top), then save. */
async function productsTypeAndSave(id, { basePrice, sizes = {} } = {}) {
  const P0 = await (await admin(`/api/admin/catalog/${id}`)).json();
  const form = { basePrice: String(basePrice != null ? basePrice : P0.basePrice), extraSidePrice: P0.extraSidePrice == null ? '' : String(P0.extraSidePrice) };
  for (const z of P0.sizes) form[`ps.${z.id}`] = String(sizes[z.id] !== undefined ? sizes[z.id] : z.surcharge || 0);
  const before = productsScreen(P0, form);
  const r = await admin(`/api/admin/catalog/${id}`, 'PUT', { prices: { basePrice: form.basePrice, extraSidePrice: form.extraSidePrice, sizes: Object.fromEntries(P0.sizes.map((z) => [z.id, form[`ps.${z.id}`]])) } });
  assert.strictEqual(r.status, 200, `saving is never refused for a warning: ${await r.clone().text()}`);
  const P = await r.json();
  // After saving the section shows the warnings for the prices as saved.
  const after = short(PACKS.cheaperBiggerPacks(P.sizes, Object.fromEntries(P.sizes.map((z) => [z.id, P.basePrice + z.surcharge]))));
  return { before: before.warnings, finals: before.finals, after, server: short(accounting.cheaperBiggerPacks(byId(id))) };
}
/** Type into an Accounts → Prices row (packWarnings in public/js/admin.js), then save it. */
async function accountsTypeAndSave(id, { basePrice, sizes = {} } = {}) {
  const row = (await (await admin('/api/admin/pricing')).json()).products.find((p) => p.id === id);
  const edits = { ...(basePrice != null ? { basePrice } : {}), ...Object.fromEntries(Object.entries(sizes).map(([k, v]) => [`size:${k}`, v])) };
  const v = (k, def) => (edits[k] !== undefined ? edits[k] : def);
  const body = { basePrice: v('basePrice', row.basePrice), extraSidePrice: row.extraSidePrice, sizes: Object.fromEntries(row.sizes.map((z) => [z.id, v(`size:${z.id}`, z.surcharge)])), costs: { ...row.costs, sizes: {} } };
  const warnOf = (r, form) => short(PACKS.cheaperBiggerPacks(r.sizes, PACKS.savedPrices(PACKS.withOwnPrices(r, r.defaults), r.defaults, form)));
  const before = warnOf(row, body);
  const res = await admin(`/api/admin/pricing/${id}`, 'PUT', body);
  assert.strictEqual(res.status, 200, `saving is never refused for a warning: ${await res.clone().text()}`);
  const saved = await res.json();
  const after = warnOf(saved, { basePrice: saved.basePrice, sizes: Object.fromEntries(saved.sizes.map((z) => [z.id, z.surcharge])) });
  return { before, after, server: short(accounting.cheaperBiggerPacks(byId(id))) };
}
async function reset(id) {
  const r = await admin(`/api/admin/pricing/${id}`, 'PUT', { costs: {} });
  assert.strictEqual(r.status, 200, await r.clone().text());
}

test('Products → Prices: the warning shows as the owner lowers the price, goes when it is raised again, and saving works', async () => {
  try {
    // 1 brochure at 40 of its own (typed as -210 against 250): no problem, 10 brochures are 50.
    let s = await productsTypeAndSave('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    // The price lowered to 175 (the 1-brochure box left as shown): 10 brochures at 35, before and after saving.
    s = await productsTypeAndSave('brochures', { basePrice: 175 });
    assert.deepStrictEqual(s.before, [['10', 35, '1', 40]], 'before saving');
    assert.deepStrictEqual(s.after, s.before, 'after saving');
    assert.deepStrictEqual(s.server, s.before, 'the server agrees');
    assert.deepStrictEqual([s.finals[1], s.finals[10]], [40, 35], 'the final-price column');
    // Lower: two problems.
    s = await productsTypeAndSave('brochures', { basePrice: 100 });
    assert.deepStrictEqual(s.before, [['10', 20, '1', 40], ['25', 32, '1', 40]]);
    assert.deepStrictEqual(s.server, s.before);
    // Raised again: gone.
    s = await productsTypeAndSave('brochures', { basePrice: 400 });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    // The pack's own price raised over 10 brochures' price instead: back again, then emptied (follows): gone.
    s = await productsTypeAndSave('brochures', { sizes: { 1: -310 } });
    assert.deepStrictEqual(s.before, [['10', 80, '1', 90]]);
    assert.deepStrictEqual(s.server, s.before);
    s = await productsTypeAndSave('brochures', { sizes: { 1: '' } });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    assert.strictEqual(s.finals[1], 20, '5% of 400');
    // A regular pack's box emptied goes back to its original add-on (250 brochures: 400 + 350), as saved.
    s = await productsTypeAndSave('brochures', { sizes: { 250: '' } });
    assert.strictEqual(s.finals[250], 750);
  } finally {
    await reset('brochures');
  }
});

test('Accounts → Prices: the same warning before and after saving, and saving works', async () => {
  try {
    let s = await accountsTypeAndSave('brochures', { basePrice: 250, sizes: { 1: -210 } });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    s = await accountsTypeAndSave('brochures', { basePrice: 175 });
    assert.deepStrictEqual(s.before, [['10', 35, '1', 40]], 'before saving');
    assert.deepStrictEqual(s.after, s.before, 'after saving');
    assert.deepStrictEqual(s.server, s.before, 'the server agrees');
    s = await accountsTypeAndSave('brochures', { basePrice: 600 });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    // Menus: an A3 single sheet at 300 of its own, then the price down to 50.
    s = await accountsTypeAndSave('menus', { sizes: { 'A3-1': 50 } });
    assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []]);
    s = await accountsTypeAndSave('menus', { basePrice: 50 });
    assert.deepStrictEqual(s.before, [['A3-10', 250, 'A3-1', 300]]);
    assert.deepStrictEqual([s.after, s.server], [s.before, s.before]);
  } finally {
    await reset('brochures');
    await reset('menus');
  }
});

test('no warning on either screen for products without prices of their own for their packs', async () => {
  try {
    for (const [id, price] of [['postcards', 60], ['bookmarks', 20], ['brochures', 100], ['folders', 2000], ['booklets', 300]]) {
      const s = await productsTypeAndSave(id, { basePrice: price });
      assert.deepStrictEqual([s.before, s.after, s.server], [[], [], []], id);
      const a = await accountsTypeAndSave(id, { basePrice: Math.round(price * 1.3) });
      assert.deepStrictEqual([a.before, a.after, a.server], [[], [], []], id);
    }
  } finally {
    for (const id of ['postcards', 'bookmarks', 'brochures', 'folders', 'booklets']) await reset(id);
  }
});

test('the warning is written in both languages, and the admin page loads the shared code before the screens', () => {
  const window = {};
  const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  vm.runInNewContext(read('js/i18n.js'), { window });
  vm.runInNewContext(read('js/i18n-admin-products.js'), { window });
  const S = window.POD_STRINGS;
  for (const k of ['pm.packWarn.title', 'pm.packWarn.line', 'pm.packWarn.help']) {
    assert.ok(Array.isArray(S[k]) && S[k][0] && S[k][1], k);
    assert.doesNotMatch(S[k][1], /محل/, `${k}: the site is never called محل`);
    assert.deepStrictEqual((S[k][0].match(/\{\w+\}/g) || []).sort(), (S[k][1].match(/\{\w+\}/g) || []).sort(), `${k}: same placeholders`);
  }
  assert.deepStrictEqual(S['pm.packWarn.line'][0].match(/\{\w+\}/g), ['{big}', '{bigPrice}', '{small}', '{smallPrice}']);
  const html = read('admin.html');
  const at = (f) => html.indexOf(`<script src="/js/${f}"></script>`);
  assert.ok(at('pack-prices.js') > at('common.js') && at('pack-prices.js') < at('admin-products.js') && at('admin-products.js') < at('admin.js'));
});
