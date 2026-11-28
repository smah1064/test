'use strict';

// The laser product templates (src/library-packs/laser.js) are drawn for their own
// product: each is offered only there, on one of its materials, at its print area's shape.
const test = require('node:test');
const assert = require('node:assert');
const { designs } = require('../src/library-packs/laser');
const { SEED } = require('../src/library');
const { PRODUCTS } = require('../src/products');

test('every laser template fits its own laser product', () => {
  const problems = [];
  for (const d of designs) {
    const p = PRODUCTS.find((x) => x.id === d.product);
    if (!p || !p.laser) { problems.push(`${d.id}: not a laser product (${d.product})`); continue; }
    const a = p.sides[0].printArea;
    if (Math.abs(d.aspect - a.w / a.h) > 0.01) problems.push(`${d.id}: aspect ${d.aspect} vs ${a.w / a.h}`);
    if (!(Array.isArray(d.products) && d.products.length === 1 && d.products[0] === d.product)) problems.push(`${d.id}: products should be [${d.product}]`);
    if (!SEED.includes(d)) problems.push(`${d.id}: not in the library`);
  }
  assert.deepStrictEqual(problems, []);
});

test('every laser product has 4 to 6 templates, in Arabic and English', () => {
  // (The CNC products, also one-tone `laser` ones, have their own pack: test/library-cnc-uv.test.js.)
  const cnc = new Set(require('../src/library-packs/cnc-uv').designs.map((d) => d.product));
  // (The two-layer wood pieces, 28 Nov, take theirs from src/library-packs/cnc-twolayer.js: the same rule.)
  // (And the Ramadan lanterns from src/library-packs/lanterns.js.)
  const twoLayer = [...require('../src/library-packs/cnc-twolayer').designs, ...require('../src/library-packs/lanterns').designs];
  for (const p of PRODUCTS.filter((x) => x.laser && !cnc.has(x.id))) {
    const mine = [...designs, ...twoLayer].filter((d) => d.product === p.id);
    assert.ok(mine.length >= 4 && mine.length <= 7, `${p.id}: ${mine.length} templates`);
    const texts = mine.flatMap((d) => d.items.filter((i) => i.kind === 'text').map((i) => i.text));
    assert.ok(texts.some((t) => /[؀-ۿ]/.test(t)) && texts.some((t) => /[A-Za-z]/.test(t)), `${p.id}: needs Arabic and English`);
  }
});
