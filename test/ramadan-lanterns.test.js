'use strict';

/**
 * The Ramadan lanterns (28 Nov 2026): Family Fanous and Arabesque Arch, drafts until the owner confirms the price,
 * size and stock. See src/products.js "Ramadan lanterns" and test/e2e/ramadan-lanterns.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PRODUCTS } = require('../src/products');
const catalog = require('../src/catalog');
const { designs } = require('../src/library-packs/lanterns');

const byId = (id) => PRODUCTS.find((p) => p.id === id);
const IDS = ['familyfanous', 'arabesquelantern'];

test('two bilingual laser products, drafts: no price, one size without measurements, no stock, not in the shop', () => {
  assert.deepStrictEqual(byId('familyfanous').name, { en: 'Family Fanous', ar: 'فانوس العيلة' });
  assert.deepStrictEqual(byId('arabesquelantern').name, { en: 'Arabesque Arch Lantern', ar: 'فانوس الأرابيسك' });
  for (const id of IDS) {
    const p = byId(id);
    assert.strictEqual(p.category, 'laser');
    assert.strictEqual(p.basePrice, 0, `${id}: price not set`);
    assert.strictEqual(p.status, 'hidden');
    assert.strictEqual(p.stock, undefined);
    assert.deepStrictEqual(p.sizes.map((z) => z.id), ['std']);
    assert.ok(!/\d\s*(cm|سم)/.test(JSON.stringify(p.sizes)), `${id}: no unconfirmed measurements in the size`);
    assert.strictEqual(catalog.visible(p), false);
    // Even shown by mistake, a product without a price is never sold.
    assert.strictEqual(catalog.visible({ ...p, status: 'live' }), false);
    assert.strictEqual(catalog.visible({ ...p, status: 'live', basePrice: 450 }), true);
  }
});

test('the plaque: Family Fanous two lines, Arabesque one name; the text has to fit', () => {
  assert.deepStrictEqual(byId('familyfanous').nameplate, { lines: 2, fitText: true });
  assert.deepStrictEqual(byId('arabesquelantern').nameplate, { lines: 1, fitText: true });
  // The crescent and star are part of Family Fanous's drawing, above the name area.
  const ff = byId('familyfanous').sides[0];
  assert.match(ff.svg, /M236 248 a16 16 0 1 0 14 26/);
  assert.ok(ff.printArea.y > 270, 'the name goes under the crescent');
});

test('each lantern has its own gallery photo, clean-plaque preview photo and mask', () => {
  const life = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'lifestyle', 'index.json'), 'utf8'));
  for (const id of IDS) {
    assert.strictEqual(life[id].file, `/img/lifestyle/${id}.webp`);
    assert.ok(life[id].alt.en && life[id].alt.ar);
    for (const f of [`img/lifestyle/${id}.webp`, `mockups/photos/${id}-front.webp`, `mockups/photos/${id}-front-mask.png`]) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', f)), f);
    }
  }
  const mock = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'photo-mockups.js'), 'utf8');
  for (const id of IDS) assert.match(mock, new RegExp(`'${id}:front'`));
});

test('ready names: Arabic and English on each lantern, offered only there, the sample marked', () => {
  for (const id of IDS) {
    const mine = designs.filter((d) => d.product === id);
    assert.ok(mine.length >= 4, id);
    assert.ok(mine.every((d) => d.products.length === 1 && d.products[0] === id));
    const texts = mine.flatMap((d) => d.items.map((i) => i.text));
    assert.ok(texts.some((x) => /[؀-ۿ]/.test(x)) && texts.some((x) => /[A-Za-z]/.test(x)), id);
    assert.ok(mine.every((d) => d.items.some((i) => i.sampleName)), `${id}: the name is the customer's`);
    assert.ok(mine.every((d) => d.items.every((i) => !i.fill)), `${id}: one engraved tone`);
  }
  assert.ok(designs.some((d) => d.product === 'familyfanous' && d.items.map((i) => i.text).join(' ') === 'عائلة حسن'));
  assert.ok(designs.some((d) => d.product === 'arabesquelantern' && d.items[0].text === 'لارا'));
});
