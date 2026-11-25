'use strict';

// QA (wording, 25 Nov): the Arabic comma instead of "·" next to Arabic digits, Egyptian Arabic instead of
// formal Arabic in customer messages, counted words instead of "(s)", the brand in every page title, more
// words for the home search, Arabic file names kept out of the English name of uploaded designs, and admin
// number boxes that take Arabic digits. No server, no browser: the pages' own lines are run as they are.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** Every string of the shop's pages (i18n.js and the i18n-*.js files), as the pages load them. */
function strings() {
  const window = {};
  window.window = window;
  const ctx = { window, document: { addEventListener() {} }, localStorage: { getItem: () => null } };
  const files = fs.readdirSync(path.join(__dirname, '../public/js')).filter((f) => /^i18n-.*\.js$/.test(f));
  for (const f of ['i18n.js', ...files]) vm.runInNewContext(read(`js/${f}`), ctx);
  return window.POD_STRINGS;
}
const S = strings();
/** A const or function taken from a page's source, run on its own. */
function grab(file, re, name, ctx = {}) {
  const m = read(file).match(re);
  assert.ok(m, `${name} in ${file}`);
  return vm.runInNewContext(`${m[0]}\n${name}`, ctx);
}

// ---------- 1. "·" next to Arabic digits ----------
test('POD.sep: the Arabic comma on Arabic pages, " · " on English ones', () => {
  const re = /const sep = \(\) => [^\n]+;/;
  assert.strictEqual(grab('js/common.js', re, 'sep', { lang: 'ar' })(), '، ');
  assert.strictEqual(grab('js/common.js', re, 'sep', { lang: 'en' })(), ' · ');
  assert.match(read('js/common.js'), /t, tr, arabicDigits, latinDigits, sep,/);
});

test('lines with numbers join their parts with the page\'s separator, not a fixed " · "', () => {
  const uses = {
    'js/product.js': /product\.sizes\.map\(sizeText\)\.join\(esc\(POD\.sep\(\)\)\)/,
    'js/photos.js': /counted\('photos\.n', n\)\}\$\{POD\.sep\(\)\}\$\{counted\('photos\.prints', prints\)\}/,
    'js/saved-designs.js': /\.map\(esc\)\.join\(POD\.sep\(\)\)/,
    'js/share.js': /\[tr\(share\.productName\), tr\(share\.color\.name\), share\.size \? tr\(share\.size\.label\) : ''\]\.filter\(Boolean\)\.join\(POD\.sep\(\)\)/,
    'js/account.js': /POD\.date\(o\.createdAt\)\)\}\$\{esc\(POD\.sep\(\)\)\}/,
    'js/admin-preview.js': /p\.visits \? `\$\{POD\.sep\(\)\}/,
    'js/preview.js': /flipLabel\(s\)\)\}<span class="muted">\$\{esc\(POD\.sep\(\)\)\}/,
  };
  for (const [file, re] of Object.entries(uses)) assert.match(read(file), re, file);
  // The upload's time left, after "Uploading 3 of 10".
  assert.match(read('js/photos.js'), /\$\('ph-up-eta'\)\.textContent = eta \? `\$\{POD\.sep\(\)\}\$\{eta\}` : '';/);
  assert.match(read('photos.html'), /<span id="ph-up-text"[^>]*><\/span><span class="muted ph-up-eta"/);
  // The invoice (its own SEP, as the order page and the cart) and the admin's zip uploads.
  const inv = read('js/invoice.js');
  assert.strictEqual(vm.runInNewContext(`${inv.match(/const SEP = \(\) => [^\n]+;/)[0]}\nSEP`, { POD: { lang: 'ar' } })(), '، ');
  assert.strictEqual((inv.match(/\.filter\(Boolean\)\.join\(SEP\(\)\)/g) || []).length, 3);
  const up = read('js/admin-uploads.js');
  assert.doesNotMatch(up, /join\(' · '\)|<\/strong> · /);
  assert.strictEqual((up.match(/join\(POD\.sep\(\)\)/g) || []).length, 5);
});

test('no Arabic string puts "·" next to a digit or a number', () => {
  const NUM = '(?:[0-9٠-٩]|\\{(?:n|count|total|price|fee|max|min|dpi|w|h|l|c|date|items|orders|v|prints|photos|done|size|pt|mm|amount|len|tile|percent|pos|i|a|b|number)\\})';
  const re = new RegExp(`${NUM}\\s*·|·\\s*${NUM}`);
  // (admin → Products' strings are another change's.)
  const left = Object.entries(S).filter(([k, v]) => Array.isArray(v) && !k.startsWith('pm.') && re.test(v[1] || '')).map(([k]) => k);
  assert.deepStrictEqual(left, []);
  for (const k of ['photos.drop', 'photos.dlvStandard', 'proof.pixels', 'printArea', 'embArea', 'rv.resolution', 'up.drop', 'up.summary']) {
    assert.doesNotMatch(S[k][1], /·/, `${k} (Arabic)`);
    assert.match(S[k][0], /·/, `${k}: English keeps its " · "`);
  }
});

// ---------- 2. Egyptian Arabic in customer messages ----------
test('customer messages are in Egyptian Arabic, not formal Arabic', () => {
  const ADMIN = /^(admin|houses|cp|acc|cu|lib|notify|fmt|process|method|rv|ship|pm|up|rd|num)\./;
  const FORMAL = /هل تريد|سيتم|تعذّر|تعذر|يمكنك|لم يتم|لا يوجد|لا توجد|جارٍ|جاري |الآن|حاليًا|يتجاوز|سيظهر|على أي حال/;
  const formal = Object.entries(S).filter(([k, v]) => Array.isArray(v) && !ADMIN.test(k) && FORMAL.test(v[1] || '')).map(([k]) => k);
  assert.deepStrictEqual(formal, []);
  const want = {
    'draft.startNewConfirm': 'تبدأ تصميم جديد؟ تصميمك المحفوظ للمنتج ده هيتمسح.',
    'draft.restored': 'رجّعنالك تصميمك المحفوظ.',
    'draft.saveTitle': 'احفظ التصميم وارجع للمنتجات. تقدر تكمّله في أي وقت.',
    'draft.saveFailed': 'معرفناش نحفظ التصميم على الجهاز ده.',
    'msg.badImage': 'معرفناش نقرا الملف ده كصورة',
    'msg.openFailed': 'معرفناش نفتح التصميم: {msg}',
    'msg.loadFailed': 'معرفناش نحمّل المنتجات',
    'msg.saveCartFailed': 'معرفناش نحفظ السلة في المتصفح ده',
    'check.cut': 'جزء من {name} طالع برّه الحافة وهيتقص.',
    'check.lowres': 'دقة {name} قليلة ({dpi} DPI) وهيطلع مش واضح. صغّره أو استخدم صورة أكبر.',
    'design.notFound': 'التصميم ده مش متاح.',
    'proof.loadFailed': 'معرفناش نحمّل البروفة.',
  };
  for (const [k, ar] of Object.entries(want)) assert.strictEqual(S[k][1], ar, k);
  assert.match(S['check.confirm'][1], /\{list\}\n\nتضيف التصميم للسلة برضه؟$/);
  assert.match(S['msg.lowResConfirm'][1], /^الصور دي دقتها قليلة وممكن تتطبع مش واضحة:/);
  // The site is never called محل.
  for (const [k, v] of Object.entries(S)) if (Array.isArray(v)) assert.doesNotMatch(v[1] || '', /محل(?!ي)/, k);
});

test('server messages to shoppers are in Egyptian Arabic too, with Arabic digits in their own words', () => {
  const { MESSAGES, format } = require('../src/i18n');
  assert.strictEqual(MESSAGES.enhanceBad.ar, 'معرفناش نحسّن الصورة دي.');
  assert.strictEqual(MESSAGES.houseMany.ar, 'تقدر تحفظ لحد ٥٠ مطبعة بس');
  assert.strictEqual(MESSAGES.houseEmailFailed.ar, 'معرفناش نبعت الإيميل. جرّب تاني أو ابعت على واتساب.');
  const FORMAL = /هل تريد|سيتم|تعذّر|تعذر|يمكنك|لم يتم|لم نتمكن|لا يمكن|يجب أن|ليس |لا يوجد|حدث خطأ|الآن|حاليًا|غدًا|أحد التصميمات/;
  const shopper = ['unknownColor', 'unknownSize', 'sidesRequired', 'designAtLeastOne', 'sideEmpty', 'notPng', 'badPng', 'aiOff', 'aiKey', 'aiBusy', 'aiFailed', 'aiRefused', 'aiLimit',
    'enhanceBad', 'artworkBad', 'artworkEmpty', 'tooFast', 'shareNotFound', 'badPhone', 'duplicateDesign', 'designGone', 'designOrdered', 'proofNotFound', 'proofDone', 'serverError', 'houseMany', 'houseEmailFailed'];
  for (const k of shopper) assert.doesNotMatch(MESSAGES[k].ar, FORMAL, k);
  assert.strictEqual(format('houseMany', {}, 'ar'), 'تقدر تحفظ لحد ٥٠ مطبعة بس');
  assert.strictEqual(format('houseMany', {}, 'en'), 'You can save up to 50 printing houses');
});

// ---------- 3. Counted words, not "(s)" ----------
test('no "(s)" plurals; the counted texts come in all four forms', () => {
  for (const [k, v] of Object.entries(S)) if (Array.isArray(v) && !k.startsWith('pm.')) assert.doesNotMatch(v[0], /\w\(s\)/, k);
  for (const base of ['order.meta', 'draft.fixedOutside', 'track.reorderPartial', 'admin.redraw.kept', 'pf.photoLowRes']) {
    for (const f of ['one', 'two', 'few', 'many']) assert.ok(Array.isArray(S[`${base}.${f}`]) && S[`${base}.${f}`][0] && S[`${base}.${f}`][1], `${base}.${f}`);
  }
  assert.match(S['order.meta.one'][0], /1 item, printed individually/);
  assert.match(S['order.meta.few'][1], /\{n\} منتجات/);
  assert.match(S['order.meta.many'][1], /\{n\} منتج وكل/);
  assert.match(S['track.reorderPartial.two'][1], /منتجين/);
  assert.match(S['draft.fixedOutside.one'][0], /^1 element that had slipped outside the print area was moved back in\.$/);
  // Arabic counting: 1, 2, 3–10 (and 103–110), 11 and up.
  const form = grab('js/common.js', /const pluralForm = \(n\) => [^\n]+;/, 'pluralForm');
  assert.deepStrictEqual([1, 2, 3, 10, 11, 100, 103, 0].map(form), ['one', 'two', 'few', 'few', 'many', 'many', 'few', 'many']);
  // The pages pick the form.
  assert.match(read('order.html'), /POD\.plural\('order\.meta', o\.items\.length, \{ status:/);
  assert.match(read('order.html'), /POD\.plural\('track\.reorderPartial', reo\.added\)/);
  assert.match(read('js/account.js'), /POD\.plural\('track\.reorderPartial', r\.added\)/);
  assert.match(read('js/admin.js'), /POD\.plural\('admin\.redraw\.kept', r\.failed\.length\)/);
});

// ---------- 4. The brand in the page title ----------
test('the kids\' book and the 404 page put the brand in the tab title, in the page\'s language', () => {
  assert.match(read('js/book.js'), /document\.title = `\$\{tr\(product\.name\)\} · \$\{t\('brand'\)\}`;/);
  for (const f of fs.readdirSync(path.join(__dirname, '../public/js'))) assert.doesNotMatch(read(`js/${f}`), /document\.title = [^\n]*· ebda3/, f);
  const key = read('404.html').match(/<body data-title-key="([^"]+)"/)[1];
  assert.deepStrictEqual([...S[key]], ['Page not found · ebda3', 'الصفحة مش موجودة · إبداع']);
  for (const page of ['rights.html', 'privacy.html', 'book.html']) {
    const k = read(page).match(/<body data-title-key="([^"]+)"/)[1];
    assert.match(S[k][0], / · ebda3$/, page);
    assert.match(S[k][1], / · إبداع$/, page);
  }
});

// ---------- 5. Home search ----------
test('home search: بيزنس, كروت بيزنس, كاتلوج, pillowcase and اطفال find their products', () => {
  const src = read('index.html');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end'));
  const SEARCH = vm.runInNewContext(`${kit}\nSEARCH`);
  const aliases = vm.runInNewContext(`(${src.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  const { PRODUCTS, CATEGORIES } = require('../src/products');
  const cat = (id) => (CATEGORIES.find((c) => c.id === id) || { name: {} }).name;
  const idx = Object.fromEntries(PRODUCTS.map((p) => [p.id, SEARCH.index([p.id, p.name.en, p.name.ar, p.description && p.description.en, p.description && p.description.ar, cat(p.category).en, cat(p.category).ar, aliases[p.id] || ''].join(' '), true)]));
  const find = (q) => Object.keys(idx).filter((id) => SEARCH.match(idx[id], SEARCH.query(q))).sort();
  for (const [q, id] of Object.entries({ 'بيزنس': 'bizcards', 'بزنس': 'bizcards', 'كروت بيزنس': 'bizcards', 'كروت بزنس': 'bizcards', 'كاتلوج': 'booklets', 'pillowcase': 'cushion', 'pillowcases': 'cushion', 'pillow case': 'cushion', 'children': 'kidstee' })) {
    assert.ok(find(q).includes(id), `"${q}" finds ${id} (got ${find(q).join(', ') || 'nothing'})`);
  }
  // The same thing in either language finds the same products.
  assert.deepStrictEqual(find('بيزنس'), find('business'));
  assert.deepStrictEqual(find('اطفال'), find('kids'));
  assert.deepStrictEqual(find('أطفال'), find('kids'));
  assert.deepStrictEqual(find('كروت بيزنس'), find('business cards'));
  assert.ok(find('kids').length >= 6);
});

// ---------- 6. Arabic file names and the English name ----------
test('a design uploaded with an Arabic file name gets an empty English name; Latin names only the English one', () => {
  const file = 'js/admin-uploads.js';
  const src = read(file);
  const ARABIC = src.match(/const ARABIC = [^\n]+;/)[0];
  const boxes = vm.runInNewContext(`${ARABIC}\n${src.match(/function nameBoxes\(name\) \{[\s\S]*?\n  \}/)[0]}\nnameBoxes`);
  const plain = (o) => JSON.parse(JSON.stringify(o));
  assert.deepStrictEqual(plain(boxes({ en: 'فانوس', ar: 'فانوس' })), { en: '', ar: 'فانوس' });
  assert.deepStrictEqual(plain(boxes({ en: 'فانوس رمضان 2', ar: 'فانوس رمضان 2' })), { en: '', ar: 'فانوس رمضان 2' });
  assert.deepStrictEqual(plain(boxes({ en: 'Happy cat', ar: 'Happy cat' })), { en: 'Happy cat', ar: '' });
  // A name made in both languages stays.
  assert.deepStrictEqual(plain(boxes({ en: 'Design 12', ar: 'تصميم 12' })), { en: 'Design 12', ar: 'تصميم 12' });
  // The boxes start from it, and publishing checks the English name (empty, or with Arabic letters).
  assert.match(src, /ed\.set\(item\.id, \{\n\s+name: nameBoxes\(item\.name\),/);
  assert.match(src, /return ARABIC\.test\(en\) \? 'nameEnArabic' : !en \? 'nameEnMissing' : '';/);
  assert.match(src, /say\(\(\) => t\('up\.needNameEn', \{ what: designs\(noName\.length\) \}\), true\);/);
  assert.match(src, /name: sentName\(i\)/);
  for (const k of ['up.needNameEn', 'up.code.nameEnArabic', 'up.code.nameEnMissing']) {
    assert.ok(S[k] && S[k][0] && S[k][1], k);
    assert.match(S[k][1], /بحروف إنجليزي/, k);
  }
});

// ---------- 7. Admin number boxes and Arabic digits ----------
test('admin number boxes take Arabic and Persian digits and the Arabic decimal separator', () => {
  const latinDigits = grab('js/common.js', /const latinDigits = \(s\) => [\s\S]*?\.replace\(\/\\u066B\/g, '\.'\);/, 'latinDigits');
  assert.strictEqual(latinDigits('١٥'), '15');
  assert.strictEqual(latinDigits('۱۲٫۵'), '12.5');
  assert.strictEqual(latinDigits('٢٠٠'), '200');
  assert.strictEqual(latinDigits('15.5'), '15.5');
  const html = read('admin.html');
  for (const [id, mode, min, whole] of [['cp-value', 'decimal', '0.01'], ['cp-max', 'decimal', '0'], ['cp-min', 'decimal', '0'], ['cp-uses', 'numeric', '1', true], ['cp-per', 'numeric', '1', true], ['exp-amount', 'decimal', '0.01'], ['acc-ship-cost', 'decimal', '0']]) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /type="text"/, id);
    assert.match(tag, new RegExp(`inputmode="${mode}"`), id);
    assert.match(tag, new RegExp(`data-min="${min.replace('.', '\\.')}"`), id);
    assert.strictEqual(/data-whole/.test(tag), Boolean(whole), `${id}: whole numbers only`);
  }
  // admin.js reads them through POD.latinDigits and keeps the old checks.
  const src = read('js/admin.js');
  const run = vm.runInNewContext(`${src.match(/const numText = [^\n]+;/)[0]}\n${src.match(/function numProblem\(el\) \{[\s\S]*?\n  \}/)[0]}\n({ numText, numProblem })`, {
    POD: { latinDigits, num: String },
    t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  const box = (value, min, whole) => ({ value, dataset: min == null ? {} : { min }, hasAttribute: (a) => a === 'data-whole' && Boolean(whole) });
  assert.strictEqual(run.numText(box('١٥٫٥')), '15.5');
  assert.strictEqual(run.numText(box('١٬٠٠٠')), '1000');
  assert.strictEqual(run.numProblem(box('١٥', '0.01')), '');
  assert.strictEqual(run.numProblem(box('', '0.01')), '');
  assert.strictEqual(run.numProblem(box('٠', '0.01')), 'num.min {"min":"0.01"}');
  assert.strictEqual(run.numProblem(box('٢٫٥', '1', true)), 'num.whole');
  assert.strictEqual(run.numProblem(box('abc', '0')), 'num.bad');
  for (const id of ['cp-value', 'cp-max', 'cp-min', 'cp-uses', 'cp-per', 'exp-amount', 'acc-ship-cost']) assert.match(src, new RegExp(`numValue\\(\\$\\('${id}'\\)\\)`), id);
  for (const k of ['num.bad', 'num.whole', 'num.min']) assert.ok(S[k] && S[k][0] && S[k][1], k);
});
