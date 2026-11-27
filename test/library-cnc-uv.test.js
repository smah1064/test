'use strict';

// The ready designs of the CNC and UV products (src/library-packs/cnc-uv.js, 27 Nov 2026): each product
// has its own (3 or more, in Arabic and English), they open on their own product at its print area's
// shape, the one-tone CNC pieces read in one tone, the cut ones use heavy fonts, and no other design
// spills onto these products.
const test = require('node:test');
const assert = require('node:assert');
const { designs } = require('../src/library-packs/cnc-uv');
const { SEED, productsFor, OWN_DESIGNS_ONLY } = require('../src/library');
const { PRODUCTS } = require('../src/products');

const IDS = ['calligraphy', 'villasign', 'acrylicnameplate', 'woodnameplate', 'shield', 'quranbox', 'nameart', 'rehal', 'glassaward', 'qrstand', 'favourtags', 'uvdtf', 'eventletters'];
const ONE_TONE = ['calligraphy', 'villasign', 'woodnameplate', 'nameart', 'rehal', 'eventletters'];
const CUT = ['nameart', 'eventletters'];
// Heavy fonts with no hairlines: letters cut out of acrylic or wood hold together.
const HEAVY = ['Lalezar', 'Lemonada', 'Jomhuria', 'Lilita One', 'Bungee', 'Caprasimo', 'Chewy', 'Anton'];
const product = (id) => PRODUCTS.find((p) => p.id === id);
const texts = (d) => d.items.filter((i) => i.kind === 'text').map((i) => i.text);

test('the 13 CNC and UV products exist and take only their own designs', () => {
  assert.deepStrictEqual(IDS.filter((id) => !product(id)), [], 'products missing from src/products.js');
  assert.deepStrictEqual([...OWN_DESIGNS_ONLY].sort(), IDS.slice().sort());
  for (const id of IDS) {
    const on = SEED.filter((d) => productsFor(d).includes(id));
    const foreign = on.filter((d) => !designs.includes(d) || d.product !== id);
    assert.deepStrictEqual(foreign.map((d) => d.id), [], `${id}: designs from elsewhere`);
  }
});

test('every new product has at least 3 designs, in Arabic and English, opening on it at its shape', () => {
  const problems = [];
  for (const id of IDS) {
    const p = product(id);
    const mine = designs.filter((d) => d.product === id);
    if (mine.length < 3) problems.push(`${id}: ${mine.length} designs`);
    const all = mine.flatMap(texts);
    if (!all.some((t) => /[؀-ۿ]/.test(t)) || !all.some((t) => /[A-Za-z]/.test(t))) problems.push(`${id}: needs Arabic and English`);
    for (const d of mine) {
      if (!SEED.includes(d)) problems.push(`${d.id}: not in the library`);
      if (!(Array.isArray(d.products) && d.products.length === 1 && d.products[0] === id)) problems.push(`${d.id}: products should be [${id}]`);
      if (productsFor(d).join() !== id) problems.push(`${d.id}: offered on ${productsFor(d).join()}`);
      if (!p) continue;
      if (!p.colors.some((c) => c.id === d.color)) problems.push(`${d.id}: no ${id} colour ${d.color}`);
      const a = p.sides[0].printArea;
      const z = a.readyZone || { w: 1, h: 1 };
      const shape = (a.w * z.w) / (a.h * z.h);
      if (Math.abs(d.aspect - shape) > 0.02) problems.push(`${d.id}: drawn for ${d.aspect.toFixed(3)}, print area ${shape.toFixed(3)}`);
    }
  }
  for (const d of designs) if (!IDS.includes(d.product)) problems.push(`${d.id}: on ${d.product}`);
  assert.deepStrictEqual(problems, []);
});

test('years say 2026 or 2027, never 2025 (Latin or Arabic digits)', () => {
  const toLatin = (s) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
  for (const d of designs) {
    for (const t of [...texts(d), d.name.en, d.name.ar].map(toLatin)) {
      assert.doesNotMatch(t, /2025/, `${d.id}: ${t}`);
      for (const y of t.match(/\b20\d\d\b/g) || []) assert.ok(y === '2026' || y === '2027', `${d.id}: ${t}`);
    }
  }
});

test('one-tone CNC designs use no colours; cut pieces use heavy fonts only', () => {
  const problems = [];
  for (const d of designs.filter((x) => ONE_TONE.includes(x.product))) {
    for (const i of d.items) {
      for (const k of ['fill', 'bg', 'glow', 'extrude', 'shadow']) if (i[k]) problems.push(`${d.id}: ${k} on "${i.text || i.shape || i.art}"`);
      if (i.kind === 'sticker' || i.kind === 'image') problems.push(`${d.id}: full-colour ${i.kind}`);
      if (i.kind === 'art' && !/^tabler:/.test(i.art)) problems.push(`${d.id}: ${i.art} is not a line icon`);
    }
    if (product(d.product) && !product(d.product).laser) problems.push(`${d.product}: expected a one-tone (laser) product`);
  }
  for (const d of designs.filter((x) => CUT.includes(x.product))) {
    for (const i of d.items) if (i.kind === 'text' && !HEAVY.includes(i.font)) problems.push(`${d.id}: ${i.font} is too thin to cut`);
  }
  assert.deepStrictEqual(problems, []);
});

test('the QR stand leaves a plain square for the customer\'s own code; no Quran text on the box or stand', () => {
  for (const d of designs.filter((x) => x.product === 'qrstand')) {
    assert.ok(d.items.some((i) => i.kind === 'shape' && i.shape === 'rounded' && i.fill === '#ffffff' && i.w >= 0.5), `${d.id}: a white square`);
    assert.ok(!d.items.some((i) => i.kind === 'art' && /qr/i.test(i.art)), `${d.id}: no drawn code`);
  }
  for (const d of designs.filter((x) => x.product === 'quranbox' || x.product === 'rehal')) {
    assert.ok(!texts(d).some((t) => /بسم الله|الرحمن|ربي|سورة/.test(t)), d.id);
  }
});
