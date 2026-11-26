'use strict';

// Tester 1's run at 2 am Cairo (26 Nov): navy counts as a blue in the home search; a printing house is told
// "Laser engraving" / "Laser cutting", not ENGRAVE / LASERCUT.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dispatch = require('../src/dispatch');
const { PRODUCTS } = require('../src/products');

const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function home() {
  const S = vm.runInNewContext(`${page.slice(page.indexOf('// search-kit:start'), page.indexOf('// search-kit:end'))}\nSEARCH`);
  const ALIASES = vm.runInNewContext(`(${page.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  const block = page.slice(page.indexOf('const catName = '), page.indexOf('// Real product photos'));
  const { CATEGORIES } = require('../src/products');
  const ctx = { products: PRODUCTS, categories: CATEGORIES, ALIASES, SEARCH: S, norm: S.norm, loose: S.loose, POD: { assetId: (p) => p.base || p.id } };
  const { found } = vm.runInNewContext(`${block}\n({ found })`, ctx);
  return (q) => PRODUCTS.filter((p) => found(p, S.query(q))).map((p) => p.id);
}
const hasNavy = (id) => (PRODUCTS.find((p) => p.id === id).colors || []).some((c) => /navy/i.test(c.id + ' ' + (c.name && c.name.en)));

test('home search: "blue t-shirt", "تيشرت ازرق", "dark blue hoodie" find the navy ones; "navy" doesn\'t pull in every blue', () => {
  const find = home();
  assert.ok(hasNavy('tshirt') && hasNavy('hoodie'), 'the T-shirt and the hoodie come in navy');
  assert.ok(find('blue t-shirt').includes('tshirt'), JSON.stringify(find('blue t-shirt')));
  assert.ok(find('تيشرت ازرق').includes('tshirt'), JSON.stringify(find('تيشرت ازرق')));
  assert.ok(find('dark blue hoodie').includes('hoodie'), JSON.stringify(find('dark blue hoodie')));
  assert.ok(find('navy blue t-shirt').includes('tshirt'));
  for (const id of find('navy')) assert.ok(hasNavy(id), `${id} found by "navy" has navy`);
});

test('send to a printing house: laser items say Laser engraving / Laser cutting in both languages', () => {
  assert.strictEqual(dispatch.methodName({ process: 'engrave' }, 'en'), 'Laser engraving');
  assert.strictEqual(dispatch.methodName({ process: 'engrave' }, 'ar'), 'حفر بالليزر');
  assert.strictEqual(dispatch.methodName({ process: 'lasercut' }, 'en'), 'Laser cutting');
  assert.strictEqual(dispatch.methodName({ process: 'lasercut' }, 'ar'), 'قص بالليزر');
  const laser = PRODUCTS.filter((p) => p.laser).length;
  assert.ok(laser > 0);
});
