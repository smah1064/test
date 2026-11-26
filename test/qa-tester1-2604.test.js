'use strict';

// Tester 1's run at 6 am Cairo (26 Nov), on the server: a coupon for other products says so before asking for a
// bigger order; a job sent twice to one printing house warns about that house once; the dashboard's Arabic counts
// say jobs, not orders.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const coupons = require('../src/coupons');

test('coupon for hoodies with a 1,000 minimum: a mugs-only cart hears "doesn\'t apply", not "spend more"', () => {
  const c = { active: true, type: 'percent', value: 10, products: ['hoodie'], categories: [], minOrder: 1000 };
  assert.strictEqual(coupons.apply(c, { lines: [{ productId: 'mug', category: 'drinkware', price: 500 }] }).reason, 'couponNoItems');
  assert.strictEqual(coupons.apply(c, { lines: [{ productId: 'mug', category: 'drinkware', price: 1250 }] }).reason, 'couponNoItems');
  assert.strictEqual(coupons.apply(c, { lines: [{ productId: 'hoodie', category: 'apparel', price: 600 }] }).reason, 'couponMinOrder');
  assert.strictEqual(coupons.apply(c, { lines: [{ productId: 'hoodie', category: 'apparel', price: 600 }, { productId: 'mug', category: 'drinkware', price: 500 }] }).ok, true);
});

test('dashboard: the Arabic Review counts say jobs (شغلانة), not orders (طلب)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  for (const k of ['rv.count.one', 'rv.count.two', 'rv.count.few', 'rv.count.many', 'rv.queueNotice.one', 'rv.queueNotice.two', 'rv.queueNotice.few', 'rv.queueNotice.many']) {
    const line = src.split('\n').find((l) => l.includes(`'${k}'`));
    assert.ok(line, k);
    assert.match(line, /شغلان/, k);
    assert.doesNotMatch(line.split("', '")[1] || '', /طلب/, k);
  }
});

test('reopened job: one warning per printing house, however often it was sent there', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(src, /byHouse\.set\(sd\.houseId \|\| sd\.houseName, sd\)/);
});
