'use strict';

// The wellbeing quotes pack (src/library-packs/wellbeing.js): 4 pictures with their
// own background, small enough that they go on small products only.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sharp = require('sharp');
const pack = require('../src/library-packs/wellbeing');
const { SEED, productsFor } = require('../src/library');
const { PRODUCTS } = require('../src/products');

test('the wellbeing pack has 4 designs with unique ids and names, in the shop', () => {
  assert.strictEqual(pack.designs.length, 4);
  assert.strictEqual(new Set(pack.designs.map((d) => d.id)).size, 4);
  for (const d of pack.designs) {
    assert.match(d.id, /^wb-[a-z-]+$/);
    assert.ok(d.name.en && /[؀-ۿ]/.test(d.name.ar), d.id);
    assert.ok(SEED.includes(d));
  }
});

test('the wellbeing pictures exist and go on small products only', async () => {
  for (const d of pack.designs) {
    const [art] = d.items;
    const m = await sharp(path.join(__dirname, '../public', art.src)).metadata();
    assert.ok(m.width >= 1599 && m.height >= 1279, art.src);
    const list = productsFor(d);
    assert.deepStrictEqual([...list].sort(), ['magicmug', 'magnets', 'mug', 'notebook', 'postcards', 'tumbler']);
    for (const id of list) assert.ok(PRODUCTS.some((p) => p.id === id), id);
    for (const id of ['tshirt', 'hoodie', 'cushion', 'poster']) assert.ok(!list.includes(id), `${d.id} not on ${id}`);
  }
});
