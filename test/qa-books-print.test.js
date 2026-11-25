'use strict';

// QA (25 Nov), the kids' books: the colouring book's PDF had an odd number of pages (its back cover printed on
// the front of the last sheet), its captions printed solid navy instead of hollow letters to colour in, and
// an emoji at the name limit was cut in half (a replacement mark on the cover).
const test = require('node:test');
const assert = require('node:assert');
const books = require('../src/books');

test('every book prints an even number of pages, the back cover last (a blank page before it when needed)', () => {
  for (const book of Object.values(books.BOOKS)) {
    const pages = books.printPages(book);
    assert.strictEqual(pages.length % 2, 0, `${book.id}: ${pages.length} pages`);
    assert.strictEqual(book.pages[pages[pages.length - 1]].type, 'back', book.id);
    assert.strictEqual(book.pages[pages[0]].type, 'cover', book.id);
    // Every page of the book is in it once, in order; only blanks are added.
    assert.deepStrictEqual(pages.filter((i) => i !== null), book.pages.map((_, i) => i), book.id);
  }
  const coloring = books.printPages(books.BOOKS['dream-jobs']);
  assert.strictEqual(coloring.length, books.BOOKS['dream-jobs'].pages.length + 1);
  assert.strictEqual(coloring[coloring.length - 2], null, 'the blank page is just before the back cover');
  assert.deepStrictEqual(books.printPages(books.BOOKS['space-hero']), books.BOOKS['space-hero'].pages.map((_, i) => i), 'an even book is unchanged');
});

test('the colouring book PDF has an even number of pages', { timeout: 120e3 }, async () => {
  const book = books.BOOKS['dream-jobs'];
  const pdf = await books.bookPdf({ book, answers: { name: 'Laila', gender: 'girl' } }, { title: 'test' });
  const count = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.strictEqual(count % 2, 0, `${count} pages`);
  assert.strictEqual(count, books.printPages(book).length);
});

/** White areas shut in by lines in a part of a page (x0, y0, x1, y1 as fractions): hollow letters have one each. */
async function enclosedWhite(n, px, box) {
  const book = books.BOOKS['dream-jobs'];
  const { data, info } = await (await books.renderPage({ book, answers: { name: 'Laila', gender: 'girl' } }, n, px)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const [x0, y0, x1, y1] = box.map((v) => Math.round(v * px));
  const W = x1 - x0;
  const H = y1 - y0;
  const white = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) white[y * W + x] = data[((y0 + y) * info.width + x0 + x) * info.channels] >= 128 ? 1 : 0;
  const seen = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (!white[i] || seen[i]) continue;
    const area = [i];
    seen[i] = 1;
    let edge = false;
    for (let c = 0; c < area.length; c++) {
      const j = area[c];
      const x = j % W;
      const y = (j - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) {
        if (k >= 0 && white[k] && !seen[k]) { seen[k] = 1; area.push(k); }
      }
    }
    if (!edge && area.length >= 6) count++;
  }
  return count;
}

test('colouring book captions are hollow letters to colour in (an outline, white inside), not solid', async () => {
  const book = books.BOOKS['dream-jobs'];
  const doctor = book.pages.findIndex((p) => p.img === 'doctor');
  const belongs = book.pages.findIndex((p) => p.type === 'belongs');
  // Solid letters only leave the holes of letters like "o" and "a" white; hollow letters leave every letter white inside.
  const letters = (i) => books.fill(book.pages[i].caption.en, { name: 'Laila', gender: 'girl' }, 'en').replace(/\s/g, '').length;
  const onDoctor = await enclosedWhite(doctor, 900, [0.08, 0.85, 0.92, 0.945]);
  assert.ok(onDoctor >= letters(doctor), `doctor page: ${onDoctor} hollows for ${letters(doctor)} letters`);
  const onBelongs = await enclosedWhite(belongs, 900, [0.02, 0.85, 0.98, 0.97]);
  assert.ok(onBelongs >= letters(belongs), `"belongs to" page: ${onBelongs} hollows for ${letters(belongs)} letters`);
});

test('a name or dedication at its limit keeps an emoji whole (cut between letters, never inside one)', () => {
  const book = books.BOOKS['space-hero'];
  const base = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
  const max = book.questions.find((q) => q.id === 'name').max;
  // One letter short of the limit, then an emoji (two UTF-16 units): it doesn't fit, so it goes whole.
  const over = books.cleanAnswers(book, { ...base, name: 'A'.repeat(max - 1) + '😀' }).name;
  assert.strictEqual(over, 'A'.repeat(max - 1));
  assert.ok(over.isWellFormed());
  // It fits: kept.
  assert.strictEqual(books.cleanAnswers(book, { ...base, name: 'A'.repeat(max - 2) + '😀' }).name, 'A'.repeat(max - 2) + '😀');
  // A flag (two code points) and a skin-tone emoji are never split either.
  for (const emoji of ['🇪🇬', '👍🏽']) {
    for (let k = max - emoji.length - 2; k <= max; k++) {
      const name = books.cleanAnswers(book, { ...base, name: 'B'.repeat(k) + emoji + 'C' }).name;
      assert.ok(name.isWellFormed(), name);
      assert.ok(name.length <= max, name);
      assert.ok(name === 'B'.repeat(k) + emoji + 'C' || name === 'B'.repeat(k) + emoji || name === 'B'.repeat(Math.min(k, max)), `${k}: ${name}`);
    }
  }
  const dmax = book.questions.find((q) => q.id === 'dedication').max;
  const dedication = books.cleanAnswers(book, { ...base, dedication: 'x'.repeat(dmax - 1) + '💛' }).dedication;
  assert.strictEqual(dedication, 'x'.repeat(dmax - 1));
  assert.ok(dedication.isWellFormed());
});

// ---------- The words around the books (in the browser's own string files) ----------
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
/** i18n.js (+ more string files) and common.js with just enough of a browser to load (as test/qa-misc3.test.js). */
function loadPOD(lang, { fetch, more = [] } = {}) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const document = { readyState: 'complete', documentElement: {}, body: null, title: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} };
  const window = { addEventListener() {} };
  const context = { window, document, localStorage, sessionStorage: localStorage, setTimeout() {}, clearTimeout() {}, CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } }, console, fetch };
  vm.runInNewContext(read('js/i18n.js'), context);
  for (const f of more) vm.runInNewContext(read(f), context);
  vm.runInNewContext(read('js/common.js'), context);
  return window.POD;
}

test('admin book card (Arabic): "300 DPI" keeps its order and the line has one kind of digits', () => {
  const ar = loadPOD('ar');
  const text = ar.t('fmt.book-pdf');
  assert.ok(text.includes('\u2066٣٠٠ DPI\u2069'), text);
  assert.doesNotMatch(text, /[0-9]/, 'no 0-9 next to ٣');
  assert.match(text, /٣ مم/);
  assert.strictEqual(loadPOD('en').t('fmt.book-pdf'), 'Book PDF (all pages, 300 DPI, 3 mm bleed)');
  // The print size line (admin.js) passes the bleed as text, so it stays in 0-9 like the sizes beside it.
  assert.strictEqual(ar.t('admin.bleed', { mm: '3' }), '+ 3 مم هامش قص');
  assert.match(read('js/admin.js'), /t\('admin\.bleed', \{ mm: String\(/);
});

test('"Order again" on a book whose photo was deleted gives the real rule: 30 days after shipping', () => {
  for (const lang of ['en', 'ar']) {
    const POD = loadPOD(lang, { more: ['js/i18n-aftercare.js'] });
    const line = POD.t('track.skip.photoGone', { n: 1, name: 'Book' });
    assert.match(line, lang === 'en' ? /30 days after shipping/ : /٣٠ يوم بعد الشحن/, line);
    assert.doesNotMatch(line, /7|٧/, line);
  }
});

test('kids book form: a choice is "chosen", the photo "added", one field in Arabic letters is "this box"', () => {
  const ar = loadPOD('ar');
  assert.strictEqual(ar.t('book.missingChoice', { field: 'ولد ولا بنت' }), 'من فضلك اختار: ولد ولا بنت');
  assert.strictEqual(ar.t('book.missingPhoto'), 'من فضلك ضيف صورة الطفل');
  assert.strictEqual(ar.t('book.latinField', { field: 'اسم الطفل' }), 'من فضلك اكتب الخانة دي بحروف إنجليزي: اسم الطفل');
  const src = read('js/book.js');
  assert.match(src, /'book\.missingPhoto'/);
  assert.match(src, /'book\.latinField'/);
});

test('/product?id=<no such product> says "not found"; a paused one keeps "not available right now"', async () => {
  const reply = (status, body) => async () => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  const box = () => ({ hidden: true, innerHTML: '', classList: { add() {}, toggle() {} }, addEventListener() {} });
  const catalog = { products: [] };
  for (const lang of ['en', 'ar']) {
    // No such product: the shop answers 404.
    let POD = loadPOD(lang, { fetch: reply(404, { error: 'Unknown product' }) });
    let info = await POD.productState('no-such-thing');
    assert.strictEqual(info.state, 'notFound');
    let b = box();
    POD.showUnavailable(b, info, catalog);
    assert.ok(b.innerHTML.includes(POD.esc(POD.t('pp.notFound'))), b.innerHTML);
    assert.ok(!b.innerHTML.includes(POD.esc(POD.t('unavail.title'))), b.innerHTML);
    assert.ok(!b.innerHTML.includes(POD.esc(POD.t('avail.lookAroundAll'))), b.innerHTML);
    // Paused: as before.
    POD = loadPOD(lang, { fetch: reply(200, { id: 'mug', name: { en: 'Mug', ar: 'مج' }, category: 'home', available: false, state: 'paused' }) });
    info = await POD.productState('mug');
    b = box();
    POD.showUnavailable(b, info, catalog);
    assert.ok(b.innerHTML.includes(POD.esc(POD.t('unavail.title'))), b.innerHTML);
    // No connection: the shop couldn't say, so "not available right now" (not "not found").
    POD = loadPOD(lang, { fetch: async () => { throw new Error('offline'); } });
    info = await POD.productState('mug');
    assert.strictEqual(info.state, 'unknown');
    b = box();
    POD.showUnavailable(b, info, catalog);
    assert.ok(b.innerHTML.includes(POD.esc(POD.t('unavail.title'))), b.innerHTML);
  }
});
