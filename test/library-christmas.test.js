'use strict';

// The Christmas cards pack (src/library-packs/christmas.js): unique ids, the card
// pictures exist at print size (5 × 7 in at 300 DPI), and the designs go on the
// card products only.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sharp = require('sharp');
const pack = require('../src/library-packs/christmas');
const { SEED, productsFor, CATEGORIES } = require('../src/library');
const { PRODUCTS } = require('../src/products');

test('the Christmas pack has 4 cards with unique ids, names and its category', () => {
  assert.strictEqual(pack.designs.length, 4);
  assert.strictEqual(new Set(pack.designs.map((d) => d.id)).size, 4);
  assert.ok(CATEGORIES.some((c) => c.id === 'christmas' && c.name.ar && c.name.en));
  for (const d of pack.designs) {
    assert.match(d.id, /^xm-card-[a-z-]+$/);
    assert.ok(d.name.en && /[؀-ۿ]/.test(d.name.ar), d.id);
    assert.ok(SEED.includes(d), `${d.id} is in the shop`);
  }
});

test('the Christmas card pictures exist at print size', async () => {
  for (const d of pack.designs) {
    const [art] = d.items;
    assert.match(art.src, /^\/img\/art\/christmas\/card-[a-z-]+\.png$/);
    const m = await sharp(path.join(__dirname, '../public', art.src)).metadata();
    assert.ok(m.width >= 1500 && m.height >= 2100, `${art.src} ${m.width}x${m.height}`);
  }
});

test('Christmas cards go on the card products only', () => {
  for (const d of pack.designs) {
    const list = productsFor(d);
    assert.deepStrictEqual([...list].sort(), ['foldedcards', 'greetingcard', 'postcards']);
    for (const id of list) assert.ok(PRODUCTS.some((p) => p.id === id), id);
    assert.ok(list.includes(d.product));
  }
});
