'use strict';

// QA tester 1 (26 Nov), the automatic file check:
//   A. An 8-page booklet with only its cover designed said "Ready to print", though pages 2–8 print blank. The check
//      now warns (a warning: a blank page can be on purpose) with the page numbers in the page's digits.
//   B. Arabic text set in an English-only font ("Lilita One") passed: the browser drew some other font and the SVG
//      print file names a font with no Arabic letters. The check now warns and suggests an Arabic font.
// Both show wherever the checks show: the cart's and /proof's proof (proof-ui.js) and the dashboard (admin.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { preflight, ARABIC_FOR } = require('../src/preflight');
const { getProduct, printWidthFor } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], designsAll: [OPEN], orders: [OPEN] };
const MUG = { w: 2590, h: 1049 };
let server;
let base;
let dataDir;
let app;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2603-'));
  app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** A finished design (layout, files, /complete) and its proof. `print(name)` makes each print file. */
async function finished(body, print) {
  const res = await post('/api/designs', body);
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let data;
    if (name.endsWith('-print.png')) data = await print(name);
    else if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    else data = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data })).status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return (await fetch(`${base}/api/designs/${created.id}/proof`)).json();
}

// ---------- A. Booklet pages left blank ----------
const booklet = getProduct('booklets');
/** A booklet page's print file: white paper edge to edge (bleed included) at 160 DPI, a dark block in the middle. */
async function bookletPage(sizeId) {
  const side = booklet.sides[0];
  const a = side.printArea;
  const wIn = printWidthFor(booklet, side, sizeId) + 2 * side.bleedIn;
  const hIn = (printWidthFor(booklet, side, sizeId) * a.h) / a.w + 2 * side.bleedIn;
  const w = Math.round(wIn * 160);
  const h = Math.round(hIn * 160);
  return sharp({ create: { width: w, height: h, channels: 4, background: '#ffffff' } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h / 4), channels: 4, background: '#223344' } }, left: Math.round(w / 3), top: Math.round(h / 3) }])
    .png().toBuffer();
}
const bookletBody = (sizeId, pageIds) => ({
  productId: 'booklets', color: 'matte', size: sizeId, options: { binding: 'right' },
  sides: Object.fromEntries(pageIds.map((id) => [id, { editor: { objects: [{ type: 'i-text', text: `Page ${id}`, fontFamily: 'Cairo' }] } }])),
});
const byId = (proof, id) => proof.preflight.checks.filter((c) => c.id === id);

test('an 8-page booklet with only its cover designed warns that pages 2–8 print blank (a warning, not a problem)', async () => {
  const page = await bookletPage('8-1');
  const proof = await finished(bookletBody('8-1', ['front']), () => page);
  assert.strictEqual(proof.preflight.status, 'warn', JSON.stringify(proof.preflight));
  assert.deepStrictEqual(proof.preflight.checks, [{ id: 'blankPages', level: 'warn', params: { pages: '2–8', count: 7, total: 8 } }]);
  assert.ok(!proof.review.needed, 'a warning: the order goes on without our team checking it');
});

test('a booklet with gaps lists each run of blank pages; the back cover is the last page', async () => {
  const page = await bookletPage('16-1');
  const proof = await finished(bookletBody('16-1', ['front', 'p2', 'p5', 'p6', 'p15']), () => page);
  assert.deepStrictEqual(byId(proof, 'blankPages'), [{ id: 'blankPages', level: 'warn', params: { pages: '3–4, 7–14, 16', count: 11, total: 16 } }]);
  const one = await finished(bookletBody('8-1', ['front', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']), () => page);
  assert.deepStrictEqual(byId(one, 'blankPages'), [{ id: 'blankPages', level: 'warn', params: { pages: '8', count: 1, total: 8 } }], 'only the back cover');
});

test('a fully designed booklet gets no blank-page warning ("Ready to print")', async () => {
  const page = await bookletPage('8-1');
  const proof = await finished(bookletBody('8-1', ['front', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'back']), () => page);
  assert.deepStrictEqual(byId(proof, 'blankPages'), []);
  assert.strictEqual(proof.preflight.status, 'pass', JSON.stringify(proof.preflight));
});

test('other products with an undesigned side (a mug\'s back, a shirt\'s back) get no blank-page warning', async () => {
  const shirt = getProduct('tshirt');
  const front = shirt.sides.find((s) => s.id === 'front');
  const r = await preflight({ id: 'd', productId: 'tshirt', size: { id: shirt.sizes[0].id }, sides: [{ id: 'front', widthIn: 10, heightIn: 12, bleedIn: front.bleedIn || 0 }] }, { product: shirt, readFile: async () => { throw new Error('ENOENT'); } });
  assert.ok(!r.checks.some((c) => c.id === 'blankPages'));
});

// ---------- B. Arabic text in a font without Arabic letters ----------
const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
const mug = (objects) => finished({ productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects } } } }, () => art(MUG.w, MUG.h));

test('Arabic text in Lilita One warns that the font has no Arabic letters and suggests an Arabic font', async () => {
  const proof = await mug([
    { type: 'i-text', text: 'عيد ميلاد سعيد يا أحلى ماما في الدنيا كلها', fontFamily: 'Lilita One' },
    // Inside a group too, with the family written as CSS would.
    { type: 'group', objects: [{ type: 'textbox', text: 'Omar & عمر', fontFamily: '"Pacifico", cursive' }] },
    // Not these: English in an English font, Arabic in an Arabic font, a hidden text.
    { type: 'i-text', text: 'Happy birthday', fontFamily: 'Lilita One' },
    { type: 'i-text', text: 'عيد سعيد', fontFamily: 'Lalezar' },
    { type: 'i-text', text: 'مخفي', fontFamily: 'Anton', visible: false },
  ]);
  assert.deepStrictEqual(byId(proof, 'fontNoArabic'), [
    { id: 'fontNoArabic', level: 'warn', side: 'front', params: { name: 'عيد ميلاد سعيد يا أحلى ماما…', font: 'Lilita One', suggest: 'Lalezar' } },
    { id: 'fontNoArabic', level: 'warn', side: 'front', params: { name: 'Omar & عمر', font: 'Pacifico', suggest: 'Aref Ruqaa' } },
  ]);
  assert.notStrictEqual(proof.preflight.status, 'pass', 'not "Ready to print"');
  assert.ok(!proof.review.needed, 'a warning only');
});

test('Arabic text in an Arabic font, and English in any font, get no font warning', async () => {
  const proof = await mug([
    { type: 'i-text', text: 'عيد ميلاد سعيد', fontFamily: 'Cairo' },
    { type: 'textbox', text: 'كل سنة وانت طيب ٢٠٢٦', fontFamily: 'Aref Ruqaa' },
    { type: 'i-text', text: 'Happy birthday, Mama!', fontFamily: 'Lilita One' },
  ]);
  assert.deepStrictEqual(byId(proof, 'fontNoArabic'), []);
});

test('a side the shop replaced with its own file is not judged by the old texts', async () => {
  const files = { 'front-print.png': await art(MUG.w, MUG.h), 'editor.json': JSON.stringify({ front: { objects: [{ type: 'i-text', text: 'مرحبا', fontFamily: 'Anton' }] } }) };
  const design = { id: 'd', productId: 'mug', sides: [{ id: 'front', widthIn: 8.5, heightIn: 3.44, bleedIn: 0, widthPx: MUG.w, heightPx: MUG.h }] };
  const readFile = async (name) => {
    if (!(name in files)) throw new Error('ENOENT');
    return Buffer.from(files[name]);
  };
  const before = await preflight(design, { readFile, product: getProduct('mug') });
  assert.deepStrictEqual(before.checks.filter((c) => c.id === 'fontNoArabic').map((c) => c.params), [{ name: 'مرحبا', font: 'Anton', suggest: 'Lalezar' }]);
  const after = await preflight({ ...design, replaced: { front: 2 } }, { readFile, product: getProduct('mug') });
  assert.deepStrictEqual(after.checks.filter((c) => c.id === 'fontNoArabic'), []);
  // No layout kept, or one that can't be read: nothing to say, and nothing breaks.
  files['editor.json'] = '{not json';
  assert.deepStrictEqual((await preflight(design, { readFile, product: getProduct('mug') })).checks.filter((c) => c.id === 'fontNoArabic'), []);
});

test('the file check knows the same English-only fonts and Arabic matches as the editor and fonts.css', () => {
  const tpl = read('js/templates.js');
  const fonts = vm.runInNewContext(`(${tpl.match(/const FONTS = (\{[\s\S]*?\n {2}\});/)[1]})`);
  const editorFor = vm.runInNewContext(`(${tpl.match(/const ARABIC_FOR = (\{[\s\S]*?\n {2}\});/)[1]})`);
  assert.deepStrictEqual({ ...ARABIC_FOR }, { ...editorFor }, 'src/preflight.js ARABIC_FOR = public/js/templates.js ARABIC_FOR');
  assert.deepStrictEqual(Object.keys(ARABIC_FOR).sort(), [...fonts.english].sort(), 'every English font has an Arabic match');
  const css = fs.readFileSync(path.join(__dirname, '../public/fonts/fonts.css'), 'utf8');
  const arabicFaces = new Set([...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'[^}]*unicode-range:\s*([^;]+);/g)].filter((m) => /U\+06/.test(m[2])).map((m) => m[1]));
  for (const f of fonts.english) assert.ok(!arabicFaces.has(f), `${f} has no Arabic letters`);
  for (const f of new Set(Object.values(ARABIC_FOR))) assert.ok(arabicFaces.has(f) && fonts.arabic.includes(f), `${f} draws Arabic`);
});

// ---------- The words, in both languages, wherever the checks show ----------
/** A page with i18n.js (+ more strings) and common.js: the shop's own POD, in Arabic or English. */
function shopPage(lang, strings = []) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const el = () => ({ style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null });
  const document = {
    readyState: 'complete', documentElement: el(), body: null, title: '',
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {},
  };
  const window = { addEventListener() {}, scrollTo() {}, scrollY: 0 };
  const context = {
    window, document, localStorage, sessionStorage: localStorage, location: { search: '', href: '', pathname: '/' }, URLSearchParams,
    matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, console,
    CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
  };
  vm.runInNewContext(read('js/i18n.js'), context);
  for (const f of strings) vm.runInNewContext(read(f), context);
  vm.runInNewContext(read('js/common.js'), context);
  context.POD = window.POD;
  return context;
}
/** The proof's check box (cart and /proof), as text. */
function proofChecks(lang, checks, sides = []) {
  const ctx = shopPage(lang, ['js/i18n-proof.js']);
  vm.runInNewContext(read('js/proof-ui.js'), ctx);
  const html = ctx.window.PODProof.checksHtml({ sides, preflight: { status: 'warn', checks } });
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
/** The dashboard's review card line for a check (admin.js checkText). */
function adminCheck(lang, c) {
  const ctx = shopPage(lang, ['js/i18n-review.js']);
  const src = read('js/admin.js').match(/ {2}function checkText\(c\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(src, 'checkText in admin.js');
  Object.assign(ctx, { t: ctx.POD.t, hasStr: (k) => Boolean(ctx.window.POD_STRINGS[k]), c, out: null });
  vm.runInNewContext(`${src[0]}\nout = checkText(c);`, ctx);
  return ctx.out;
}
const BLANK = { id: 'blankPages', level: 'warn', params: { pages: '2–8', count: 7, total: 8 } };
const GAPS = { id: 'blankPages', level: 'warn', params: { pages: '3–4, 7–14, 16', count: 11, total: 16 } };
const BACK = { id: 'blankPages', level: 'warn', params: { pages: '8', count: 1, total: 8 } };
const FONT = { id: 'fontNoArabic', level: 'warn', side: 'front', params: { name: 'عيد سعيد', font: 'Lilita One', suggest: 'Lalezar' } };

test('blank pages read right in both languages, page numbers in the page\'s digits (proof and dashboard)', () => {
  for (const say of [proofChecks, (lang, [c]) => adminCheck(lang, c)]) {
    const ar = say('ar', [BLANK]);
    assert.match(ar, /الصفحات ٢–٨ من ٨ مفيش عليها تصميم وهتطلع فاضية \(صفحة ١ هي الغلاف الأمامي وصفحة ٨ الغلاف الخلفي\)/, ar);
    assert.ok(!/[0-9]/.test(ar), `no 0-9 digits in Arabic: ${ar}`);
    const en = say('en', [BLANK]);
    assert.match(en, /Pages 2–8 of 8 have nothing on them and will print blank \(page 1 is the front cover, page 8 the back cover\)/, en);
    assert.match(say('ar', [GAPS]), /الصفحات ٣–٤، ٧–١٤، ١٦ من ١٦/);
    assert.match(say('en', [GAPS]), /Pages 3–4, 7–14, 16 of 16/);
    assert.match(say('ar', [BACK]), /صفحة ٨ من ٨ مفيش عليها تصميم/);
    assert.match(say('en', [BACK]), /Page 8 of 8 has nothing on it/);
  }
  // The proof says "please look" (not "Ready to print") above it.
  assert.match(proofChecks('en', [BLANK]), /Please look at this before you approve/);
  assert.doesNotMatch(proofChecks('en', [BLANK]), /Ready to print/);
});

test('Arabic in an English-only font reads right in both languages, with the Arabic font to pick (proof and dashboard)', () => {
  const sides = [{ id: 'front', name: { en: 'Front', ar: 'الأمام' } }];
  const ar = proofChecks('ar', [FONT], sides);
  assert.match(ar, /«\u2068عيد سعيد\u2069» مكتوب بخط \u2068Lilita One\u2069، والخط ده مفيهوش حروف عربي، فهيتطبع بخط تاني\. اختار خط عربي، زي \u2068Lalezar\u2069/, ar);
  assert.match(ar, /الأمام/, 'on which side');
  const en = proofChecks('en', [FONT], sides);
  assert.match(en, /The text “\u2068عيد سعيد\u2069” is in \u2068Lilita One\u2069, a font with no Arabic letters, so it will print in a different font\. Choose an Arabic font, such as \u2068Lalezar\u2069/, en);
  assert.match(adminCheck('ar', FONT), /«عيد سعيد» مكتوب بخط Lilita One، والخط ده مفيهوش حروف عربي.*زي Lalezar/);
  assert.match(adminCheck('en', FONT), /The text “عيد سعيد” is in Lilita One, a font with no Arabic letters.*such as Lalezar/);
  // The editor's own check list has its words ready too (check.fontNoArabic), and the editor can reach the matches.
  const ctx = shopPage('ar');
  assert.notStrictEqual(ctx.POD.t('check.fontNoArabic'), 'check.fontNoArabic');
  assert.match(read('js/templates.js'), /window\.POD_DESIGN = \{[^}]*\bARABIC_FOR\b/);
});
