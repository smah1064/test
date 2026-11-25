'use strict';

// The funny sarcastic quotes pack (src/library-packs/sarcastic.js): unique ids, the
// artwork files (and their white copies for dark colours) exist and are clean
// one-colour vectors, and every design goes on clothes, mugs and home products in
// light and dark colours.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pack = require('../src/library-packs/sarcastic');
const { SEED, productsFor, CATEGORIES } = require('../src/library');
const { PRODUCTS } = require('../src/products');

const file = (src) => path.join(__dirname, '../public', src);

test('the sarcastic pack has 22 designs with unique ids and names', () => {
  assert.strictEqual(pack.designs.length, 22);
  const ids = new Set(pack.designs.map((d) => d.id));
  assert.strictEqual(ids.size, 22);
  for (const d of pack.designs) {
    assert.match(d.id, /^sq-[a-z0-9-]+$/);
    assert.ok(d.name.en && /[؀-ۿ]/.test(d.name.ar), d.id);
    assert.ok(CATEGORIES.some((c) => c.id === d.category), d.id);
    assert.ok(SEED.includes(d), `${d.id} is in the shop`);
  }
});

test('the sarcastic artwork files exist, dark and white, and are plain vectors', () => {
  for (const d of pack.designs.filter((x) => x.items[0].src.endsWith('.svg'))) {
    const [art] = d.items;
    assert.strictEqual(art.kind, 'image');
    for (const [src, fill] of [[art.src, '#16181d'], [art.dark, '#ffffff']]) {
      assert.match(src, /^\/img\/art\/sarcastic\/[a-z0-9-]+\.svg$/);
      const svg = fs.readFileSync(file(src), 'utf8');
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/, src);
      assert.doesNotMatch(svg, /<(script|image|foreignObject|style)|on\w+=|href=/i, src);
      const fills = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]));
      assert.deepStrictEqual([...fills], [fill], src);
    }
  }
});

test('the colour pictures are full-size transparent PNGs, shown on light colours', async () => {
  const sharp = require('sharp');
  const sloths = pack.designs.filter((d) => d.items[0].src.endsWith('.png'));
  assert.strictEqual(sloths.length, 6);
  for (const d of sloths) {
    const [art] = d.items;
    assert.match(art.src, /^\/img\/art\/sarcastic\/[a-z0-9-]+\.png$/);
    assert.strictEqual(art.dark, undefined);
    assert.strictEqual(d.color, 'white');
    const m = await sharp(file(art.src)).metadata();
    assert.ok(m.hasAlpha && Math.max(m.width, m.height) >= 3000, `${art.src} ${m.width}x${m.height}`);
  }
});

test('sarcastic designs go on clothes, mugs and home products, light and dark', () => {
  const ok = new Set(PRODUCTS.map((p) => p.id));
  for (const d of pack.designs) {
    const list = productsFor(d);
    for (const id of ['tshirt', 'hoodie', 'sweatshirt', 'mug', 'cushion', 'tote']) assert.ok(list.includes(id), `${d.id} on ${id}`);
    for (const id of list) assert.ok(ok.has(id), `${d.id}: unknown product ${id}`);
  }
  // With the white copy, a design shown on a white T-shirt goes on the same products as one shown on black.
  const onWhite = pack.designs.find((d) => d.color === 'white');
  const onBlack = pack.designs.find((d) => d.color === 'black');
  assert.deepStrictEqual(productsFor(onWhite), productsFor(onBlack));
});
