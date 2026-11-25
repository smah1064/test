'use strict';

// The mouse pad pack (src/library-packs/mousepads.js): 6 edge-to-edge pictures cut to
// the mouse pad's shape, offered on the mouse pad only.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sharp = require('sharp');
const pack = require('../src/library-packs/mousepads');
const { SEED, productsFor } = require('../src/library');
const { PRODUCTS } = require('../src/products');

test('the mouse pad pack has 6 designs with unique ids and names, in the shop', () => {
  assert.strictEqual(pack.designs.length, 6);
  assert.strictEqual(new Set(pack.designs.map((d) => d.id)).size, 6);
  for (const d of pack.designs) {
    assert.match(d.id, /^mp-[a-z-]+$/);
    assert.ok(d.name.en && /[؀-ۿ]/.test(d.name.ar), d.id);
    assert.ok(SEED.includes(d));
  }
});

test('the mouse pad pictures fill the pad at print size and go on the mouse pad only', async () => {
  const pad = PRODUCTS.find((p) => p.id === 'mousepad');
  const area = pad.sides[0].printArea;
  for (const d of pack.designs) {
    const m = await sharp(path.join(__dirname, '../public', d.items[0].src)).metadata();
    assert.ok(Math.abs(m.width / m.height - area.w / area.h) < 0.01, d.id);
    assert.ok(m.width / pad.sides[0].printWidthIn >= 300, `${d.id} prints at 300 DPI`);
    assert.deepStrictEqual(productsFor(d), ['mousepad']);
    assert.strictEqual(d.items[0].full, true, `${d.id} fills the pad edge to edge`);
  }
});
