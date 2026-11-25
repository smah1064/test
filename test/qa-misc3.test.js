'use strict';

// QA (25 Nov): the kids' book added twice by a double tap, a grown-up's birthday refused, the accounts
// cost boxes losing what was typed, the scrambled Arabic print size, the uncounted "items without costs"
// note, the private-preview form emptied by the refresh, and the home rows' arrows pointing inward.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const books = require('../src/books');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** i18n.js + common.js with just enough of a browser for them to load (as test/qa-wave2-shop.test.js). */
function loadPOD(lang) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const document = { readyState: 'complete', documentElement: {}, body: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} };
  const window = { addEventListener() {} };
  const context = { window, document, localStorage, sessionStorage: localStorage, setTimeout() {}, clearTimeout() {}, CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } }, console };
  vm.runInNewContext(read('js/i18n.js'), context);
  vm.runInNewContext(read('js/common.js'), context);
  return window.POD;
}

const BOOK = books.BOOKS['space-hero'];
const ANSWERS = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
const dateError = (birthday) => {
  try {
    books.cleanAnswers(BOOK, { ...ANSWERS, birthday });
    return null;
  } catch (e) {
    return e.message;
  }
};

test('kids book: a birthday before 1990 (a book for a grown-up) is a real birthday; before 1900 or to come is not', () => {
  assert.strictEqual(dateError('1985-05-10'), null);
  assert.strictEqual(dateError('1950-01-31'), null);
  assert.strictEqual(dateError(books.OLDEST_BIRTHDAY), null);
  assert.strictEqual(books.OLDEST_BIRTHDAY, '1900-01-01');
  assert.strictEqual(dateError('1899-12-31'), 'bookBadDate');
  assert.strictEqual(dateError('2999-01-01'), 'bookBadDate');
  assert.strictEqual(dateError('2019-02-30'), 'bookBadDate');
  // Only written in the story: "born on 10 May 1985".
  assert.strictEqual(books.cleanAnswers(BOOK, { ...ANSWERS, birthday: '1985-05-10' }).birthday, '1985-05-10');
  assert.strictEqual(books.formatDate('1985-05-10', 'en'), '10 May 1985');
  // The book page gets the first day allowed with the question (its date box, its own message).
  const q = books.publicBook(BOOK).questions.find((x) => x.type === 'date');
  assert.strictEqual(q.min, '1900-01-01');
  const page = read('js/book.js');
  assert.doesNotMatch(page, /1990-01-01/);
  assert.match(page, /min="\$\{esc\(q\.min \|\| '1900-01-01'\)\}"/);
});

test('kids book: too early or not come yet is said as such, in both languages', () => {
  const en = loadPOD('en');
  const ar = loadPOD('ar');
  assert.strictEqual(en.t('book.dateTooOld', { field: 'Birthday', year: 1900 }), 'Birthday: please choose a date from 1900 on');
  assert.strictEqual(ar.t('book.dateTooOld', { field: 'تاريخ الميلاد', year: 1900 }), 'تاريخ الميلاد: اختار تاريخ من سنة ١٩٠٠ أو بعدها من فضلك');
  assert.match(en.t('book.dateFuture', { field: 'Birthday' }), /^Birthday: that day hasn't come yet/);
  assert.match(ar.t('book.dateFuture', { field: 'تاريخ الميلاد' }), /^تاريخ الميلاد: اليوم ده لسه ماجاش/);
  for (const k of ['book.dateTooOld', 'book.dateFuture']) assert.doesNotMatch(ar.t(k, { field: 'x', year: 1900 }), /محل/);
});

test('kids book: one tap at a time on "Add to cart", and a book already in the cart is never put in twice', () => {
  const src = read('js/book.js');
  const handler = src.slice(src.indexOf("$('bk-add').addEventListener('click'"), src.indexOf('renderForm();\n  renderThumbs();'));
  assert.match(handler, /if \(state\.adding\) return;\s*state\.adding = true;/);
  // The line of the same design is replaced where it is; a new line only for a design not in the cart.
  assert.match(handler, /const at = cart\.findIndex\(\(c\) => c\.designId === d\.id\);\s*if \(at >= 0\) cart\[at\] = item;\s*else cart\.push\(item\);/);
  assert.doesNotMatch(handler, /cart\[state\.cartIndex\] = item/);
  // The button shows it is busy (and the busy state survives the redraw when the book is made first).
  assert.match(src, /\$\('bk-add'\)\.disabled = !state\.design \|\| !!state\.adding;/);
});

test('accounts: the "items without costs" note is counted (one, two, 3-10, 11+) in both languages', () => {
  const en = loadPOD('en');
  const ar = loadPOD('ar');
  const note = (P, n) => P.plural('acc.missing', n);
  assert.match(note(en, 1), /^1 item has no costs filled in, so its cost counts as 0\./);
  assert.match(note(en, 2), /^2 items have no costs/);
  assert.match(note(en, 9), /^9 items have no costs/);
  assert.match(note(en, 11), /^11 items have no costs/);
  assert.match(note(ar, 1), /^منتج واحد مالهوش تكاليف متسجلة، فتكلفته محسوبة صفر\./);
  assert.match(note(ar, 2), /^منتجين مالهمش تكاليف متسجلة، فتكلفتهم محسوبة صفر\./);
  assert.match(note(ar, 9), /^٩ منتجات مالهمش تكاليف متسجلة، فتكلفتهم/);
  assert.match(note(ar, 11), /^١١ منتج مالهمش تكاليف متسجلة، فتكلفتهم/);
  for (const n of [1, 2, 9, 11]) {
    assert.doesNotMatch(note(ar, n), /محل|acc\.missing/);
    assert.match(note(ar, n), /«الأسعار والتكاليف»/);
    assert.match(note(en, n), /"Prices & costs"/);
  }
  assert.match(read('js/admin.js'), /\$\('acc-missing'\)\.textContent = POD\.plural\('acc\.missing', tt\.missingCosts\);/);
});

test('accounts: saving a real cost never redraws the cost box being typed in', () => {
  const src = read('js/admin.js');
  const at = src.indexOf("$('tab-accounts').addEventListener('change'");
  const change = src.slice(src.indexOf('const itemId = el.dataset.accItemCost;', at), src.indexOf("$('acc-ship-save')"));
  // The value is read when the box is left, before anything is awaited...
  assert.ok(change.indexOf("const value = el.value === '' ? null : Number(el.value);") < change.indexOf('await adminApi'));
  assert.doesNotMatch(change, /JSON\.stringify\(\{ actual(Cost|Shipping): el\.value/);
  // ...and the redraw after the save keeps the boxes while one is typed in (no full refreshAccounts()).
  assert.doesNotMatch(change, /refreshAccounts\(\)/);
  assert.match(change, /renderAccounts\(\{ keepBoxes: true \}\)/);
  assert.match(src, /if \(keepBoxes && \(typingCost\(\) \|\| costSaving\)\) \{\s*updateOrdersInPlace\(\);\s*acc\.redrawOrders = true;\s*return;/);
  // Leaving the boxes brings the full table back.
  assert.match(change, /addEventListener\('focusout'/);
});

test('admin item details: only numbers and units sit in the left-to-right part of the print size', () => {
  const src = read('js/admin.js');
  const line = src.match(/item\.sides\.map\(\(s\) => `<dt>\$\{esc\(t\('admin\.spec\.print'[^\n]*/)[0];
  const ltr = [...line.matchAll(/<bdi dir="ltr">([\s\S]*?)<\/bdi>/g)].map((m) => m[1]);
  assert.strictEqual(ltr.length, 2);
  for (const part of ltr) assert.doesNotMatch(part, /admin\.bleed|t\(/, part);
  assert.match(line, /<bdi>\$\{esc\(t\('admin\.bleed'/);
});

test('private preview: the refresh keeps both invite boxes, the cursor and the message', () => {
  const src = read('js/admin-preview.js');
  const show = src.slice(src.indexOf('    async show() {'), src.indexOf('    onLang() {'));
  assert.match(show, /redrawKeepingForm\(\)/);
  const keep = src.slice(src.indexOf('function redrawKeepingForm'), src.indexOf('return {\n    init'));
  assert.match(keep, /\['pv-name', 'pv-own'\]/);
  assert.match(keep, /setSelectionRange/);
  assert.match(keep, /if \(said\) say\(said\.text, said\.bad, said\.key\);/);
});

test('home rows: the arrows are not flipped a second time in Arabic (as the book pages)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
  assert.doesNotMatch(css, /html\[dir="rtl"\] \.hm-arrow\s*\{[^}]*scaleX\(-1\)/);
  assert.doesNotMatch(css, /\.bk-nav[^{]*\{[^}]*scaleX/);
  // ‹ before › in both: the browser mirrors them in right-to-left text.
  assert.match(read('index.html'), /data-scroll="-1"[^>]*>‹<\/button><button type="button" class="hm-arrow" data-scroll="1"[^>]*>›<\/button>/);
});
