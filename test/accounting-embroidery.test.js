'use strict';

// Costs of embroidered items and booklets (Accounts): the stitching has its own cost per piece,
// and a booklet costs its blank plus the pages that carry a design.
const test = require('node:test');
const assert = require('node:assert');
const { itemCostFrom } = require('../src/accounting');

const costs = {
  tshirt: { blank: 100, printFirst: 50, printExtra: 30, embroidery: 45, other: 10 },
  cap: { blank: 60, printFirst: 40, embroidery: 35 },
  booklets: { blank: 20, printFirst: 8, printExtra: 6 },
};

test('embroidery is its own cost, not a printed side', () => {
  // Print on the front and back plus embroidery on the chest.
  const a = itemCostFrom(costs, { productId: 'tshirt', sides: [{ id: 'front', process: 'dtg' }, { id: 'emb', process: 'embroidery' }, { id: 'back', process: 'dtg' }] });
  assert.deepStrictEqual([a.blank, a.print, a.embroidery, a.other, a.total], [100, 80, 45, 10, 235]);
  // Embroidery only (as saved now, and as items saved before sides carried their process).
  const b = itemCostFrom(costs, { productId: 'cap', process: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }] });
  assert.deepStrictEqual([b.print, b.embroidery, b.total], [0, 35, 95]);
  const old = itemCostFrom(costs, { productId: 'cap', process: 'embroidery', sides: [{ id: 'front' }] });
  assert.deepStrictEqual([old.print, old.embroidery, old.total], [0, 35, 95]);
  // Printed only: no embroidery cost.
  const c = itemCostFrom(costs, { productId: 'tshirt', sides: [{ id: 'front' }] });
  assert.deepStrictEqual([c.print, c.embroidery, c.total], [50, 0, 160]);
  // Several pieces: every piece is stitched.
  const d = itemCostFrom(costs, { productId: 'cap', process: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }], quantities: [{ size: { id: 'one' }, qty: 3 }] });
  assert.strictEqual(d.embroidery, 105);
  assert.strictEqual(d.total, 285);
});

test('a booklet costs its blank plus its designed pages', () => {
  const pages = ['front', 'p3', 'p5', 'back'].map((id) => ({ id }));
  const r = itemCostFrom(costs, { productId: 'booklets', sides: pages });
  assert.deepStrictEqual([r.blank, r.print, r.total], [20, 8 + 3 * 6, 46]);
});
