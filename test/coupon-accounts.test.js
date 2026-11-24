'use strict';

// A coupon for one product comes off that product in the accounts' per-product table (QA report 24 Nov).
const test = require('node:test');
const assert = require('node:assert');
const accounting = require('../src/accounting');
const coupons = require('../src/coupons');

const order = (couponItems) => ({
  id: 'o1', number: 'EB-1', customer: { name: 'Sara' }, createdAt: '2026-11-24T10:00:00Z', subtotal: 700, discount: 125, shipping: 0, total: 575,
  coupon: { code: 'MUG50', discount: 125, ...(couponItems ? { items: couponItems } : {}) },
  items: [
    { id: 'a', productId: 'tshirt', productName: { en: 'T-shirt' }, size: { id: 'M' }, sides: [{ id: 'front' }], price: 450, status: 'queued' },
    { id: 'b', productId: 'mug', productName: { en: 'Mug' }, size: { id: '11oz' }, sides: [{ id: 'front' }], price: 250, status: 'queued' },
  ],
});
const sales = (o) => Object.fromEntries(accounting.report({ orders: [o], costs: {}, expenses: [], settings: {} }).products.map((p) => [p.productId, p.sales]));

test('the coupon tells which lines it came off', () => {
  const c = { code: 'MUG50', active: true, type: 'percent', value: 50, products: ['mug'], categories: [] };
  const r = coupons.apply(c, { lines: [{ productId: 'tshirt', category: 'apparel', price: 450 }, { productId: 'mug', category: 'home', price: 250 }] });
  assert.strictEqual(r.discount, 125);
  assert.deepStrictEqual(r.lines, [1]);
});

test('a one-product coupon lowers only that product in the per-product table', () => {
  assert.deepStrictEqual(sales(order(['b'])), { tshirt: 450, mug: 125 });
  // Orders saved before the items were kept: shared by price as before.
  const old = sales(order(null));
  assert.ok(old.tshirt < 450 && Math.abs(old.tshirt + old.mug - 575) < 0.01);
});
