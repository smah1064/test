'use strict';

// The Christmas pack (src/library-packs/christmas.js): 4 whole printed cards on the
// card products only, and 28 one-colour quotes (dark + white vector copies) for
// clothes, mugs, home and postcards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pack = require('../src/library-packs/christmas');
const { SEED, productsFor, CATEGORIES } = require('../src/library');
const { PRODUCTS } = require('../src/products');

const file = (src) => path.join(__dirname, '../public', src);
const cards = pack.designs.filter((d) => d.id.startsWith('xm-card-'));
const trees = pack.designs.filter((d) => d.id.startsWith('xm-trees-'));
const quotes = pack.designs.filter((d) => !d.id.startsWith('xm-card-') && !d.id.startsWith('xm-trees-'));

test('the Christmas pack has 4 cards, 28 quotes and 4 tree pictures with unique ids, names and its category', () => {
  assert.strictEqual(cards.length, 4);
  assert.strictEqual(quotes.length, 28);
  assert.strictEqual(trees.length, 4);
  assert.strictEqual(new Set(pack.designs.map((d) => d.id)).size, 36);
  assert.ok(CATEGORIES.some((c) => c.id === 'christmas' && c.name.ar && c.name.en));
  for (const d of pack.designs) {
    assert.match(d.id, /^xm-[a-z-]+$/);
    assert.ok(d.name.en && /[؀-ۿ]/.test(d.name.ar), d.id);
    assert.strictEqual(d.category, 'christmas');
    assert.ok(SEED.includes(d), `${d.id} is in the shop`);
  }
});

test('the Christmas card pictures exist at print size and go on the card products only', async () => {
  for (const d of cards) {
    const [art] = d.items;
    assert.match(art.src, /^\/img\/art\/christmas\/card-[a-z-]+\.png$/);
    const m = await sharp(file(art.src)).metadata();
    assert.ok(m.width >= 1500 && m.height >= 2100, `${art.src} ${m.width}x${m.height}`);
    assert.deepStrictEqual([...productsFor(d)].sort(), ['foldedcards', 'greetingcard', 'postcards']);
  }
});

test('the Christmas quotes are clean one-colour vectors with a white copy', () => {
  for (const d of quotes) {
    const [art] = d.items;
    for (const [src, fill] of [[art.src, '#16181d'], [art.dark, '#ffffff']]) {
      assert.match(src, /^\/img\/art\/christmas\/[a-z0-9-]+\.svg$/);
      const svg = fs.readFileSync(file(src), 'utf8');
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+"/, src);
      assert.doesNotMatch(svg, /<(script|image|foreignObject|style)|on\w+=|href=/i, src);
      assert.deepStrictEqual([...new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]))], [fill], src);
    }
  }
});

test('the Christmas tree pictures are full-size transparent PNGs, on light and dark colours', async () => {
  for (const d of trees) {
    const [art] = d.items;
    assert.match(art.src, /^\/img\/art\/christmas\/trees-[a-z-]+\.png$/);
    assert.strictEqual(art.dark, art.src);
    const m = await sharp(file(art.src)).metadata();
    assert.ok(m.hasAlpha && Math.max(m.width, m.height) >= 3000, `${art.src} ${m.width}x${m.height}`);
    assert.deepStrictEqual(productsFor(d), productsFor(quotes[0]));
  }
});

test('the Christmas quotes go on clothes, mugs, home and postcards', () => {
  for (const d of quotes) {
    const list = productsFor(d);
    for (const id of ['tshirt', 'hoodie', 'sweatshirt', 'kidstee', 'mug', 'cushion', 'tote', 'postcards']) assert.ok(list.includes(id), `${d.id} on ${id}`);
    // (Not on greeting / folded cards: they keep their text-only designs.)
    assert.ok(!list.includes('greetingcard') && !list.includes('foldedcards'), d.id);
    for (const id of list) assert.ok(PRODUCTS.some((p) => p.id === id), id);
  }
});
