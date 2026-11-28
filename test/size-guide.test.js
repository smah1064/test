'use strict';

// Clothing size guides (owner, 28 Nov): typical measurements and the size finder's rule.
const test = require('node:test');
const assert = require('node:assert');
const { GUIDES, suggest } = require('../src/size-guide');
const { PRODUCTS } = require('../src/products');

const ADULT = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

test('every garment with sizes has a guide with a row per size, the fit in both languages', () => {
  for (const p of PRODUCTS.filter((x) => x.category === 'apparel' && x.sizes.length > 1)) {
    assert.ok(p.sizeGuide, p.id);
    assert.deepStrictEqual(p.sizeGuide.rows.map((r) => r.id), p.sizes.map((s) => s.id), p.id);
    assert.ok(p.sizeGuide.fit.en && p.sizeGuide.fit.ar, p.id);
    for (const r of p.sizeGuide.rows) for (const c of p.sizeGuide.cols) assert.ok(r[c] != null, `${p.id} ${r.id} ${c}`);
  }
});

test('measurements grow with the size', () => {
  for (const [id, g] of Object.entries(GUIDES)) {
    const ids = Object.keys(g.rows).filter((k) => ADULT.includes(k));
    for (const c of g.cols.filter((x) => x !== 'height')) {
      const v = ids.map((k) => g.rows[k][c]);
      assert.ok(v.every((x, i) => i === 0 || x >= v[i - 1]), `${id} ${c}: ${v}`);
    }
  }
});

test('size finder: adults by height and weight (the bigger of the two), kids and babies by height', () => {
  assert.strictEqual(suggest('tshirt', ADULT, { height: 160, weight: 55 }), 'S');
  assert.strictEqual(suggest('tshirt', ADULT, { height: 178, weight: 75 }), 'L');
  assert.strictEqual(suggest('tshirt', ADULT, { height: 190, weight: 70 }), '2XL', 'tall and slim: the length decides');
  assert.strictEqual(suggest('tshirt', ADULT, { height: 165, weight: 95 }), '2XL', 'short and heavy: the chest decides');
  assert.strictEqual(suggest('tshirt', ADULT, { height: 210, weight: 140 }), '3XL');
  // QA 28 Nov: impossible numbers get no size.
  assert.strictEqual(suggest('tshirt', ADULT, { height: 50, weight: 20 }), null);
  assert.strictEqual(suggest('tshirt', ADULT, { height: 250, weight: 300 }), null);
  assert.strictEqual(suggest('kidstee', ['2-4', '4-6', '6-8', '8-10', '10-12'], { height: 250 }), null);
  assert.strictEqual(suggest('onesie', ['0-3', '3-6', '6-12', '12-18'], { height: 150 }), null);
  assert.strictEqual(suggest('tshirt', ADULT, { height: 178 }), null, 'adults need both');
  assert.strictEqual(suggest('kidstee', ['2-4', '4-6', '6-8', '8-10', '10-12'], { height: 120 }), '6-8');
  assert.strictEqual(suggest('kidstee', ['2-4', '4-6', '6-8', '8-10', '10-12'], { height: 160 }), '10-12');
  assert.strictEqual(suggest('onesie', ['0-3', '3-6', '6-12', '12-18'], { height: 65 }), '3-6');
  assert.strictEqual(suggest('jersey', ['kids', ...ADULT], { height: 135, weight: 30 }), 'kids');
  assert.strictEqual(suggest('mug', ['11oz'], { height: 170, weight: 70 }), null);
});
