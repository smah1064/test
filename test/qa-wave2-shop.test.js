'use strict';

// QA wave 2 (shop): counted words in both languages ("1 product", "منتج واحد / منتجين / ٣ منتجات / ١١ منتج").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** i18n.js + common.js in a page that has no header or cart (just enough of a browser for them to load). */
function loadPOD(lang) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const document = {
    readyState: 'complete',
    documentElement: {},
    body: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
  };
  const window = { addEventListener() {} };
  const context = { window, document, localStorage, sessionStorage: localStorage, setTimeout() {}, clearTimeout() {}, CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } }, console };
  vm.runInNewContext(read('js/i18n.js'), context);
  vm.runInNewContext(read('js/common.js'), context);
  return window.POD;
}

test('the form of a counted word: one, two, few (3 to 10) and many', () => {
  const { pluralForm } = loadPOD('en');
  const forms = (list) => list.map(pluralForm).join(' ');
  assert.strictEqual(forms([1, 2, 3, 7, 10]), 'one two few few few');
  assert.strictEqual(forms([0, 11, 12, 99, 100, 101, 102]), 'many many many many many many many');
  assert.strictEqual(forms([103, 110, 111, 1003]), 'few few many few');
});

test('search results: "1 product" in English, Egyptian Arabic for 1, 2, 3-10 and 11+ in Arabic digits', () => {
  const en = loadPOD('en');
  const found = (P, n) => P.plural('home.found', n, { q: 'mug' });
  assert.strictEqual(found(en, 1), '1 product for "mug"');
  assert.strictEqual(found(en, 2), '2 products for "mug"');
  assert.strictEqual(found(en, 5), '5 products for "mug"');
  assert.strictEqual(found(en, 23), '23 products for "mug"');
  assert.strictEqual(found(en, 1500), '1,500 products for "mug"');

  const ar = loadPOD('ar');
  assert.strictEqual(found(ar, 1), 'منتج واحد لـ "mug"');
  assert.strictEqual(found(ar, 2), 'منتجين لـ "mug"');
  assert.strictEqual(found(ar, 3), '٣ منتجات لـ "mug"');
  assert.strictEqual(found(ar, 10), '١٠ منتجات لـ "mug"');
  assert.strictEqual(found(ar, 11), '١١ منتج لـ "mug"');
  assert.strictEqual(found(ar, 49), '٤٩ منتج لـ "mug"');
  // What the customer typed stays as typed (only the shop's own numbers change digits).
  assert.strictEqual(ar.plural('home.found', 4, { q: 'A5 2026' }), '٤ منتجات لـ "A5 2026"');
  for (const n of [1, 2, 3, 10, 11, 120]) assert.doesNotMatch(found(ar, n), /[0-9]/, `no Western digits on an Arabic page (${n})`);
});

test('every counted string comes in all four forms, in both languages', () => {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  for (const form of ['one', 'two', 'few', 'many']) {
    const pair = window.POD_STRINGS[`home.found.${form}`];
    assert.ok(Array.isArray(pair) && pair[0] && pair[1], `home.found.${form}`);
  }
  assert.strictEqual(window.POD_STRINGS['home.found'], undefined, 'no uncounted form left to use by mistake');
});

test('the phone example is plainly an example, one number in the digits a keypad types (owner, 26 Nov)', () => {
  assert.strictEqual(loadPOD('en').t('checkout.phonePh'), 'e.g. 01012345678');
  // (The number in an isolate, so the page's Arabic digits leave it as it is typed.)
  assert.strictEqual(loadPOD('ar').t('checkout.phonePh'), 'مثال: \u206801012345678\u2069');
});
