'use strict';

// The spiral notebook's back cover can carry a design too (owner, 26 Nov): two covers, the second at the
// notebook's price for a second side; the back is drawn as seen from behind (spiral on the other edge).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/products');

test('notebook: front and back covers, the same print size, the back mirrored; a design on both costs the second-side price', () => {
  const n = P.PRODUCTS.find((p) => p.id === 'notebook');
  assert.deepStrictEqual(n.sides.map((s) => s.id), ['front', 'back']);
  const [front, back] = n.sides;
  assert.strictEqual(back.printWidthIn, front.printWidthIn);
  assert.deepStrictEqual([back.printArea.w, back.printArea.h, back.printArea.y], [front.printArea.w, front.printArea.h, front.printArea.y]);
  assert.strictEqual(back.printArea.x, 500 - front.printArea.x - front.printArea.w, 'mirrored');
  assert.match(back.name.ar, /الخلفي/);
  for (const size of n.sizes) assert.strictEqual(P.priceFor(n, size.id, 2) - P.priceFor(n, size.id, 1), 50);
});
