'use strict';
// Supplier packs (scripts/supplier-pack.js): each pack must cover every product the site makes with that method,
// so a new product can't be left out of the sheet the printing houses answer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PRODUCTS } = require('../src/products');

const DIR = path.join(__dirname, '..', 'scripts', 'supplier-packs');
const packs = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'general.js').map((f) => [f.slice(0, -3), require(path.join(DIR, f))]);

test('every supplier pack lists exactly the products of its method', () => {
  assert.ok(packs.length > 0);
  for (const [id, pack] of packs) {
    const want = PRODUCTS.filter((p) => p.process === id).map((p) => p.id).sort();
    assert.deepStrictEqual([...pack.products].sort(), want, `${id} pack products`);
    for (const key of Object.keys(pack.productNotes || {})) assert.ok(pack.products.includes(key), `${id}: note for unknown product ${key}`);
  }
});

test('supplier packs have their texts, never name ebda3, and never promise cash on delivery or call the site a shop', () => {
  const general = require(path.join(DIR, 'general.js'));
  for (const prices of [true, false]) {
    const g = general({ prices, brand: { name: { ar: 'اسم', en: 'Name' } } });
    assert.strictEqual(g.questions.some((q) => /الأسعار/.test(q.q)), prices);
    for (const [id, pack] of packs) {
      for (const k of ['title', 'subtitle', 'short', 'filesIntro']) assert.ok(pack[k], `${id}.${k}`);
      assert.ok(pack.files.length && pack.questions.length && pack.confirm.length);
      const all = JSON.stringify([pack, g, g.steps(pack), pack.test ? pack.test.html('Name') : '']);
      assert.doesNotMatch(all, /محل|عند الاستلام|ebda3|إبداع|الموقع/i);
    }
  }
});
