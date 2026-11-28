'use strict';

// Which ready designs are offered on which products (src/library.js FITS and
// productsFor): the subject decides, the print area's shape and name fields
// narrow it, and the shop sends the list with every design.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SEED, FITS, CATEGORIES, Library, productsFor, noGeneralDesigns } = require('../src/library');
const { PRODUCTS } = require('../src/products');
const laserPack = require('../src/library-packs/laser');
const cncPack = require('../src/library-packs/cnc-uv');
const wrapPack = require('../src/library-packs/uv-wraps');

const byId = (id) => SEED.find((d) => d.id === id);
const onProduct = (pid) => SEED.filter((d) => productsFor(d).includes(pid));
// (The CNC and UV products take only their own designs, like the laser ones: src/library-packs/cnc-uv.js.)
const general = (p) => !noGeneralDesigns(p);
// Products that take general designs but have only a few, or none because of
// their shape (a tall design looks lost on a very wide desk mat or DL envelope).
const FEW = { bizcards: 10, letterhead: 6, invoicebook: 6, rollup: 10, deskmat: 0, dlenvelopes: 0,
  // Shop print (the business designs only) and very wide or very tall pieces.
  brochures: 10, folders: 10, booklets: 10, menus: 6, labels: 6, windowstickers: 6, giftvouchers: 0, banners: 0, placecards: 0, bookmarks: 0 };
const MIN = 15;

test('the fit table names real subjects and products', () => {
  const productIds = new Set(PRODUCTS.map((p) => p.id));
  const cats = new Set(PRODUCTS.map((p) => p.category));
  const problems = [];
  for (const [subject, rule] of Object.entries(FITS)) {
    if (!CATEGORIES.some((c) => c.id === subject)) problems.push(`unknown subject ${subject}`);
    for (const id of [...(rule.products || []), ...(rule.not || []), ...(rule.shownOn || [])]) if (!productIds.has(id)) problems.push(`${subject}: unknown product ${id}`);
    for (const c of rule.cats || []) if (!cats.has(c)) problems.push(`${subject}: unknown product category ${c}`);
  }
  for (const c of CATEGORIES) if (!FITS[c.id]) problems.push(`subject ${c.id} has no row in FITS`);
  for (const d of SEED) {
    for (const id of [...(d.alsoProducts || []), ...(d.notProducts || [])]) if (!productIds.has(id)) problems.push(`${d.id}: unknown product ${id}`);
  }
  assert.deepStrictEqual(problems, []);
});

test('every design is offered on some products, including the one it is shown on', () => {
  const problems = [];
  for (const d of SEED) {
    const list = productsFor(d);
    if (!list.length) problems.push(`${d.id}: offered nowhere`);
    else if (!list.includes(d.product)) problems.push(`${d.id}: shown on ${d.product} but not offered there`);
  }
  assert.deepStrictEqual(problems, []);
});

test('designs go where a customer would buy them', () => {
  const on = (id, pid) => productsFor(byId(id)).includes(pid);
  // Business: cards and shop print, not baby clothes.
  for (const pid of ['bizcards', 'letterhead', 'logostickers', 'paperbags', 'polo', 'mug', 'apron']) assert.ok(on('pp-biz-cafe', pid), `cafe logo on ${pid}`);
  for (const pid of ['onesie', 'kidstee', 'deskmat', 'prayermat', 'eidenvelopes', 'invitations']) assert.ok(!on('pp-biz-cafe', pid), `cafe logo not on ${pid}`);
  assert.ok(on('pp-biz-staff', 'idcards') && on('pp-biz-staff', 'polo') && !on('pp-biz-staff', 'letterhead') && !on('pp-biz-staff', 'paperbags'), 'staff shirt');
  assert.ok(on('pp-biz-finisher', 'certificates'), 'events get certificates');
  assert.deepStrictEqual(productsFor(byId('cd-team-en')), ['bizcards'], 'team business cards with {fields}');
  // Baby: onesie, cards and gifts, not business print.
  for (const pid of ['onesie', 'greetingcard', 'cushion', 'mug']) assert.ok(on('ce-welcome-baby', pid), `welcome baby on ${pid}`);
  for (const pid of ['bizcards', 'deskmat', 'letterhead', 'jersey']) assert.ok(!on('ce-welcome-baby', pid), `welcome baby not on ${pid}`);
  assert.ok(!on('ce-mama-2orayeb', 'onesie') && on('ce-mama-2orayeb', 'tshirt'), 'mum to be: adult T-shirt, not a onesie');
  assert.ok(on('ce-big-sister', 'kidstee') && !on('ce-30-fabulous', 'kidstee'), 'kids clothes');
  // Kids: kids clothes and school things, not adult T-shirts.
  assert.ok(on('pp-kids-dino-roar', 'kidstee') && on('pp-kids-dino-roar', 'lunchbag') && !on('pp-kids-dino-roar', 'tshirt'), 'kids');
  assert.strictEqual(byId('pp-kids-dino-roar').product, 'kidstee', 'kids designs are shown on a kids T-shirt');
  assert.deepStrictEqual(['ce-welcome-baby', 'ce-big-sister', 'ce-mama-2orayeb'].map((id) => byId(id).product), ['onesie', 'kidstee', 'tshirt']);
  // Wedding: invitations and gifts, not Eid envelopes.
  assert.ok(on('ce-save-the-date', 'invitations') && on('ce-just-married', 'couplemugs') && !on('ce-just-married', 'eidenvelopes'), 'wedding');
  // Funny: clothes, mugs, phone cases; not prayer mats or business cards.
  assert.ok(on('mesh-fady', 'mug') && on('mesh-fady', 'phonecase') && on('mesh-fady', 'cap') && !on('mesh-fady', 'prayermat') && !on('mesh-fady', 'bizcards'), 'funny');
  // Prayer mat: Islamic phrases and the Ramadan / Eid greetings, not the food jokes.
  assert.ok(on('fa-isl-mashallah', 'prayermat') && on('fa-ram-kareem-gold', 'prayermat') && !on('fa-ram-foul', 'prayermat'), 'prayer mat');
  // (Its cream calligraphy, drawn for a dark green T-shirt, would not show on the white mat.)
  assert.ok(on('fa-isl-alhamdulillah', 'mug') && !on('fa-isl-alhamdulillah', 'prayermat'), 'cream on white');
  assert.ok(on('eid-mubarak', 'eidenvelopes') && !on('kammel', 'eidenvelopes'), 'Eid envelopes');
});

test('laser, CNC and UV designs keep their own product lists', () => {
  for (const d of [...laserPack.designs, ...cncPack.designs]) {
    assert.strictEqual(byId(d.id), d);
    assert.deepStrictEqual(productsFor(d), [d.product]);
    assert.strictEqual(productsFor(d), d.products);
  }
});

test('no general design on fabric, photo prints, books, laser, CNC or UV products', () => {
  const own = new Set([...laserPack.designs, ...cncPack.designs].map((d) => d.id));
  // (The UV DTF cup wraps' own pack is drawn once for all four wraps: src/library-packs/uv-wraps.js.)
  const wraps = new Set(wrapPack.designs.map((d) => d.id));
  for (const p of PRODUCTS.filter((x) => !general(x))) {
    const bad = onProduct(p.id).filter((d) => !(own.has(d.id) && d.product === p.id) && !(wraps.has(d.id) && wrapPack.WRAPS.includes(p.id)));
    assert.deepStrictEqual(bad.map((d) => d.id), [], p.id);
  }
});

test('name-list designs only on name-list products; shapes suit the print area', () => {
  const field = /\{[^{}]+\}/;
  for (const d of SEED.filter((x) => (x.items || []).some((i) => i.kind === 'text' && field.test(i.text)))) {
    for (const pid of productsFor(d)) assert.ok(PRODUCTS.find((p) => p.id === pid).merge, `${d.id} on ${pid}`);
  }
  // A T-shirt-shaped design is not offered on a very wide area.
  assert.ok(!productsFor(byId('kora-hayaty')).includes('deskmat'));
  assert.ok(productsFor(byId('kora-hayaty')).includes('mug'), 'a mug shows one side at a time');
});

test('every product that takes general designs has enough of them, and every subject stays', () => {
  const low = [];
  for (const p of PRODUCTS.filter(general)) {
    const n = onProduct(p.id).length;
    const min = p.id in FEW ? FEW[p.id] : MIN;
    if (n < min) low.push(`${p.id}: ${n} designs (want ${min})`);
  }
  assert.deepStrictEqual(low, []);
  for (const c of CATEGORIES) {
    const designs = SEED.filter((d) => d.category === c.id);
    assert.ok(designs.length && designs.every((d) => productsFor(d).length), `subject ${c.id}`);
  }
});

test('the shop sends every design with its products; designs the owner adds go on their own product', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libfit-'));
  try {
    const lib = new Library(dir);
    assert.ok(lib.visible().every((d) => Array.isArray(d.products) && d.products.length));
    const meta = lib.addCustom({ name: { en: 'x', ar: 'x' }, category: 'funny', product: 'hoodie', color: 'black', objects: [], area: { x: 0, y: 0, w: 300, h: 400 } });
    const mine = lib.get(meta.id);
    assert.ok(mine.products.includes('hoodie') && mine.products.includes('mug') && !mine.products.includes('fabric'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
