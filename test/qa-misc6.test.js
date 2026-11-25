'use strict';

// QA tester 2 (25 Nov): the Products editor's number boxes dropping Arabic digits (and an emptied price going back
// to the original without a word), the zip upload calling a 2400 px picture "under 600 px", white artwork hardly
// visible in the proof's print file, and the kids' book page saying "English letters" twice (once as a red error).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const designUpload = require('../src/design-upload');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** A page with i18n.js (+ more strings) and common.js: the shop's own POD, in Arabic or English. */
function shopPage(lang, strings = []) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const listeners = {};
  const el = () => ({ style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null });
  const document = {
    readyState: 'complete', documentElement: el(), body: null, title: '',
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener: (type, fn, capture) => { (listeners[type] = listeners[type] || []).push({ fn, capture: Boolean(capture) }); },
    dispatchEvent: (ev) => { for (const l of listeners[ev.type] || []) l.fn(ev); },
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
  return { context, POD: window.POD, STRINGS: window.POD_STRINGS, listeners };
}
/** Pieces of a screen's code (functions and consts written at two spaces), to run on their own. */
function grab(src, re, what) {
  const m = src.match(re);
  assert.ok(m, `${what} in the code`);
  return m[0];
}
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---------- 1. Products editor: number boxes take any digits ----------
const PM = read('js/admin-products.js');
/** admin-products.js's number-box helpers (numText, numProblem, numAttrs, emptyHint) with the shop's POD. */
function numberBoxes(lang, P = null) {
  const page = shopPage(lang, ['js/i18n-admin-products.js']);
  const code = [
    grab(PM, / {2}const numText = [^\n]*\n/, 'numText'),
    grab(PM, / {2}function numProblem\(el\) \{[\s\S]*?\n {2}\}\n/, 'numProblem'),
    grab(PM, / {2}function numAttrs\([^)]*\) \{[\s\S]*?\n {2}\}\n/, 'numAttrs'),
    grab(PM, / {2}function emptyHint\(el\) \{[\s\S]*?\n {2}\}\n/, 'emptyHint'),
  ].join('');
  const ctx = page.context;
  Object.assign(ctx, { t: page.POD.t, S: { P }, helpers: null });
  vm.runInNewContext(`${code}\nhelpers = { numText, numProblem, numAttrs, emptyHint };`, ctx);
  /** A box drawn with numAttrs(opts), holding `value` ({ defaultValue, name } as drawn). */
  const box = (value, opts = {}, { name = 'x', defaultValue = '1' } = {}) => {
    const attrs = Object.fromEntries([...ctx.helpers.numAttrs(opts).matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] === undefined ? '' : m[2]]));
    const dataset = {};
    for (const [k, v] of Object.entries(attrs)) if (/^data-(min|max)$/.test(k)) dataset[k.slice(5)] = v;
    return { value, name, defaultValue, dataset, hasAttribute: (a) => a in attrs };
  };
  return { ...ctx.helpers, box, POD: page.POD };
}

test('Products editor: no type="number" box is left; every number box is a [data-num] text box', () => {
  const code = PM.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n'); // (the comments may name it)
  assert.doesNotMatch(code, /type=\\?"number\\?"|type=number|input\[type=number\]/, 'a type="number" box drops what an Arabic keyboard types');
  // Each box the editor draws, by name: its attributes come from numAttrs.
  const named = ['stock', 'lowStockAt', 'basePrice', 'extraSidePrice', 'embW', 'embH', 'embPrice', 'embColors', "'ns.add'", "'ns.scale'"];
  for (const n of named) {
    const name = n.startsWith("'") ? n : `'${n}'`;
    assert.match(PM, new RegExp(`inp\\(${name.replace(/\./g, '\\.')}, [^\\n]*numAttrs\\(`), `${n}: drawn with numAttrs`);
  }
  for (const k of ['pa', 'pw', 'safe', 'bleed']) assert.match(PM, new RegExp(`inp\\(\`${k}\\.\\$\\{k\\}[^\\n]*numAttrs\\(`), `${k}: drawn with numAttrs`);
  assert.match(PM, /class="pm-vs-in"[^\n]*numAttrs\(/, 'the stock grid');
  assert.match(PM, /numAttrs\(\{ min: 0, whole: true \}\)\} name="vsAll"/, '"set all to"');
  assert.match(PM, /<input \$\{numAttrs\(\{ neg: true \}\)\} id="\$\{fieldId\('ps\.' \+ z\.id\)\}" name="ps\./, 'each size\'s add-on');
  // 17 kinds of boxes, all read through val()/numText (no el.value for numbers).
  assert.ok((PM.match(/numAttrs\(\{/g) || []).length >= 17, String((PM.match(/numAttrs\(\{/g) || []).length));
  assert.doesNotMatch(PM, /Number\(el\.value\)/);
  assert.match(grab(PM, / {2}const val = \(name\) => \{[\s\S]*?\n {2}\};\n/, 'val'), /hasAttribute\('data-num'\)\) return numText\(el\)/);
});

test('Products editor: a number box reads Arabic and Persian digits and the Arabic decimal mark, and says what is wrong', () => {
  const minus = String.fromCharCode(0x2212);
  for (const lang of ['ar', 'en']) {
    const { numText, numProblem, box, POD } = numberBoxes(lang);
    const t = POD.t;
    assert.strictEqual(numText(box('٢٧٠')), '270', 'the QA case: ٢٧٠ is 270 (the number box left it empty)');
    assert.strictEqual(numText(box('۲۷۰')), '270', 'Persian digits');
    assert.strictEqual(numText(box('١٢٫٥')), '12.5', 'the Arabic decimal mark');
    assert.strictEqual(numText(box(' ١ ٢٠٠ ')), '1200', 'spaces left out');
    assert.strictEqual(numText(box(`${minus}٢١٠`)), '-210', 'a typographic minus');
    assert.strictEqual(numProblem(box('٢٧٠', { min: 1 })), '');
    assert.strictEqual(numProblem(box('27o', { min: 1 })), t('num.bad'), 'not a number');
    assert.strictEqual(numProblem(box('1,5')), t('num.bad'), 'a comma is not taken as anything');
    assert.strictEqual(numProblem(box('0', { min: 1 })), t('num.min', { min: POD.num(1) }));
    assert.strictEqual(numProblem(box('٣٠٠', { min: 0, max: 200 })), t('pm.num.max', { max: POD.num(200) }));
    assert.strictEqual(numProblem(box('٣٫٥', { min: 0, whole: true })), t('num.whole'));
    assert.strictEqual(numProblem(box('-15', { neg: true })), '', 'a size add-on may take something off');
    // Empty: fine unless the box needs a number (a stock count: "0 if there is none"; the embroidery size: just a number).
    assert.strictEqual(numProblem(box('', { min: 1 })), '');
    assert.strictEqual(numProblem(box('', { min: 0, whole: true, need: true })), t('num.empty'));
    assert.strictEqual(numProblem(box('', { min: 1, max: 40, need: true })), t('pm.num.empty'));
    assert.ok(t('pm.num.max', { max: POD.num(200) }).includes(lang === 'ar' ? '٢٠٠' : '200'), 'in the page\'s digits');
  }
  const { numAttrs } = numberBoxes('en');
  assert.match(numAttrs({ min: 0, whole: true }), /^type="text" inputmode="numeric" [^\n]*dir="ltr" data-num data-min="0" data-whole$/);
  assert.match(numAttrs({ min: 1 }), /inputmode="decimal"/);
  assert.doesNotMatch(numAttrs({ neg: true }), /inputmode/, 'boxes that may be under 0 keep the keyboard with a minus sign');
});

test('Products editor: an emptied price box says what saving it does (back to the original price, with the amount)', () => {
  const n = (en, ar) => ({ en, ar });
  const P = {
    id: 'cap', basePrice: 270, extraSidePrice: null,
    sizes: [{ id: 'one', label: n('One size', 'مقاس واحد'), surcharge: 0 }, { id: 'xl', label: n('XL', 'XL'), surcharge: 30 }, { id: '1', label: n('1 card', 'كارت'), surcharge: -10, smallPack: true }],
    original: { prices: { basePrice: 300, extraSidePrice: 50, sizes: { one: 0, xl: 20, 1: -5 } } },
  };
  const want = {
    ar: { base: 'فاضية: لما تحفظ هيرجع السعر الأصلي (٣٠٠ ج.م.).', xl: 'فاضية: لما تحفظ هترجع الزيادة الأصلية (+٢٠ ج.م.).', one: 'فاضية: لما تحفظ هترجع زي الأصل من غير زيادة.', pack: 'فاضية: لما تحفظ الكمية دي هترجع تمشي مع السعر الأساسي.' },
    en: { base: 'Empty: back to the original price (EGP 300) when you save.', xl: 'Empty: back to the original add-on (+EGP 20) when you save.', one: 'Empty: back to the original, no add-on, when you save.', pack: 'Empty: this pack follows the base price again when you save.' },
  };
  // (Intl puts direction marks round Arabic money: compared without them.)
  const bare = (s) => s.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  for (const lang of ['ar', 'en']) {
    const { emptyHint, box } = numberBoxes(lang, P);
    const empty = (name, defaultValue = '1') => bare(emptyHint(box('', {}, { name, defaultValue })));
    assert.strictEqual(empty('basePrice'), bare(want[lang].base), `${lang}: the QA case (the cap's 300)`);
    assert.strictEqual(empty('ps.xl'), bare(want[lang].xl));
    assert.strictEqual(empty('ps.one'), bare(want[lang].one));
    assert.strictEqual(empty('ps.1'), bare(want[lang].pack), 'a small pack follows the base price again');
    assert.strictEqual(empty('extraSidePrice', ''), '', 'a box drawn empty: its help says it already');
    assert.match(empty('extraSidePrice', '60'), lang === 'ar' ? /٥٠/ : /50/);
    assert.strictEqual(empty('stock'), '', 'only price boxes');
  }
});

test('Products editor: wrong boxes are checked before saving, and the new words exist in both languages', () => {
  // save(): the section's number boxes are checked first; a wrong one stops it before anything is sent.
  const save = grab(PM, / {2}async function save\(name\) \{[\s\S]*?\n {2}\}\n/, 'save');
  assert.ok(save.indexOf('badNum(name)') > -1 && save.indexOf('badNum(name)') < save.indexOf("send('PUT'"), 'checked before sending');
  assert.match(save, /if \(bad\) \{[\s\S]*?return;\n {4}\}/);
  const badNum = grab(PM, / {2}function badNum\(name\) \{[\s\S]*?\n {2}\}\n/, 'badNum');
  assert.match(badNum, /el\.disabled \|\| el\.hasAttribute\('data-no-dirty'\) \|\| el\.closest\('\[hidden\], \.is-hidden'\)/, 'hidden or helper boxes are not saved, so not checked');
  // "back to original" empties the price boxes (they were found by type=number).
  assert.match(PM, /#pm-sec-prices input\[data-num\]/);
  const { STRINGS } = shopPage('en', ['js/i18n-admin-products.js']);
  for (const k of ['pm.empty.price', 'pm.empty.original', 'pm.empty.addon', 'pm.empty.noAddon', 'pm.empty.follows', 'pm.num.max', 'pm.num.empty', 'num.bad', 'num.min', 'num.whole', 'num.empty']) {
    assert.ok(Array.isArray(STRINGS[k]) && STRINGS[k][0] && STRINGS[k][1], k);
    assert.doesNotMatch(STRINGS[k][1], /محل/, `${k}: the site is never called محل`);
    assert.deepStrictEqual((STRINGS[k][0].match(/\{\w+\}/g) || []).sort(), (STRINGS[k][1].match(/\{\w+\}/g) || []).sort(), `${k}: same placeholders`);
  }
  const css = read('css/admin-products.css');
  assert.match(css, /#pm-root input\[data-num\]\[aria-invalid="true"\] \{ border-color: var\(--bad\); \}/);
  assert.match(css, /\.pm-num-msg\.is-bad \{ color: var\(--bad\); \}/);
});

// ---------- 2. Zip upload: "too small" says the drawing's size ----------
const svgPng = (w, h, body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).png().toBuffer();

test('zip upload: a big picture with a small drawing in see-through margins is too small, and says both sizes', async () => {
  // The QA case: 2400 px wide, the drawing inside about 540 × 380 px.
  const a = await designUpload.analyze(await svgPng(2400, 1800, '<rect x="930" y="710" width="540" height="380" fill="#1d4fa8"/>'), 'cat.png');
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, 'tooSmall');
  assert.ok(Math.abs(a.w - 540) <= 40 && Math.abs(a.h - 380) <= 40, `the drawing: ${a.w} × ${a.h}`);
  assert.deepStrictEqual([a.pictureW, a.pictureH], [2400, 1800], 'the picture itself');
  assert.deepStrictEqual(designUpload.skipSizes(a), { w: a.w, h: a.h, pictureW: 2400, pictureH: 1800 });
  // A picture small itself: its size only.
  const small = await designUpload.analyze(await svgPng(400, 300, '<rect width="400" height="300" fill="#2a9d8f"/><circle cx="200" cy="150" r="90" fill="#e76f51"/>'), 'small.png');
  assert.deepStrictEqual(designUpload.skipSizes(small), { w: 400, h: 300 });
  // Big enough once trimmed: used.
  assert.strictEqual((await designUpload.analyze(await svgPng(2400, 1800, '<rect x="600" y="400" width="1200" height="900" fill="#1d4fa8"/>'), 'ok.png')).ok, true);
  // Anything else keeps nothing (and nothing odd is kept).
  for (const x of [{ ok: false, reason: 'notPicture' }, { ok: false, reason: 'tooSmall' }, { ok: false, reason: 'tooSmall', w: '5', h: 3 }, null, { ok: true, w: 10, h: 10 }]) {
    assert.deepStrictEqual(designUpload.skipSizes(x), {}, JSON.stringify(x));
  }
  assert.deepStrictEqual(designUpload.skipSizes({ ok: false, reason: 'tooSmall', w: 500, h: 400, pictureW: -1, pictureH: 9 }), { w: 500, h: 400 });
});

test('zip upload: the files not used say the drawing\'s real size, in both languages and the page\'s digits', () => {
  const src = read('js/admin-uploads.js');
  const code = grab(src, / {2}const MIN_SIDE = 600;\n/, 'MIN_SIDE') + grab(src, / {2}function skipWhy\(s\) \{[\s\S]*?\n {2}\}\n/, 'skipWhy');
  assert.strictEqual(designUpload.LIMITS.MIN_SIDE, 600, 'the same limit as the server');
  assert.match(grab(src, / {2}function skippedHtml\(\) \{[\s\S]*?\n {2}\}\n/, 'skippedHtml'), /esc\(skipWhy\(s\)\)/);
  const why = (lang, s) => {
    const page = shopPage(lang, ['js/i18n-admin-uploads.js']);
    Object.assign(page.context, { t: page.POD.t, has: (k) => Boolean(page.STRINGS[k]), out: null, s });
    vm.runInNewContext(`${code}\nout = skipWhy(s);`, page.context);
    return page.context.out;
  };
  const inside = { path: 'cat.png', reason: 'tooSmall', w: 540, h: 380, pictureW: 2400, pictureH: 1800 };
  assert.strictEqual(why('en', inside), 'too small to print: the drawing inside is only 540 × 380 px (the picture is 2400 × 1800 px, with empty margins round the drawing), and it needs 600 px on its long side');
  assert.strictEqual(why('ar', inside), 'صغيرة أوي على الطباعة: الرسمة اللي جوّه ٥٤٠ × ٣٨٠ بكسل بس (الصورة نفسها ٢٤٠٠ × ١٨٠٠ بكسل وحوالين الرسمة فراغ)، ولازم ٦٠٠ بكسل في الضلع الطويل');
  assert.strictEqual(why('en', { reason: 'tooSmall', w: 400, h: 300 }), 'too small to print: 400 × 300 px, and it needs 600 px on its long side');
  assert.strictEqual(why('ar', { reason: 'tooSmall', w: 400, h: 300 }), 'صغيرة أوي على الطباعة: ٤٠٠ × ٣٠٠ بكسل، ولازم ٦٠٠ بكسل في الضلع الطويل');
  // Without the sizes (an upload read before): it still says empty margins don't count.
  assert.match(why('en', { reason: 'tooSmall' }), /under 600 px on the long side, not counting empty margins/);
  assert.match(why('ar', { reason: 'tooSmall' }), /أقل من ٦٠٠ بكسل في الضلع الطويل، من غير الفراغ/);
  assert.strictEqual(why('en', { reason: 'tooBig' }), 'the picture is too big to read (too many pixels)');
  const { STRINGS } = shopPage('en', ['js/i18n-admin-uploads.js']);
  for (const k of ['up.reason.tooSmall', 'up.reason.tooSmallSize', 'up.reason.tooSmallInside']) {
    assert.deepStrictEqual((STRINGS[k][0].match(/\{\w+\}/g) || []).sort(), (STRINGS[k][1].match(/\{\w+\}/g) || []).sort(), `${k}: same placeholders`);
    assert.doesNotMatch(STRINGS[k][1], /محل/);
  }
});

// ---------- 3. Proof: dark checks behind light artwork ----------
function proofUi(lang) {
  const page = shopPage(lang, ['js/i18n-proof.js']);
  vm.runInNewContext(read('js/proof-ui.js'), page.context);
  return { ...page, PODProof: page.context.window.PODProof };
}
const PROOF = {
  product: { name: { en: 'T-shirt', ar: 'تيشيرت' } }, color: { name: { en: 'Black', ar: 'أسود' }, hex: '#16181d' }, size: { label: { en: 'M', ar: 'M' } },
  sides: [{ id: 'front', name: { en: 'Front', ar: 'الأمام' }, widthIn: 12, heightIn: 16, previewUrl: '/files/designs/d1/front-preview.png', artworkUrl: '/files/designs/d1/front-proof.png?v=1' }],
  preflight: { status: 'pass', checks: [] },
};

test('proof: the print file\'s box has a "Dark background" button, and picks dark checks by itself for light artwork', () => {
  for (const lang of ['ar', 'en']) {
    const { PODProof, POD, listeners } = proofUi(lang);
    const html = PODProof.html(PROOF);
    const btn = html.match(/<button type="button" class="proof-bg-btn" data-proof-bg aria-pressed="false" title="([^"]+)">[\s\S]*?<span>([^<]+)<\/span><\/button>/);
    assert.ok(btn, 'the button, not pressed at first');
    assert.strictEqual(btn[2], POD.t('proof.bgDark'));
    assert.strictEqual(btn[2], lang === 'ar' ? 'خلفية غامقة' : 'Dark background');
    assert.match(html, /<div class="proof-art-box" data-proof-art="\/files\/designs\/d1\/front-proof\.png\?v=1"><a class="proof-art"/);
    // The file has loaded: light artwork round see-through parts gets the dark checks, and keeps them when redrawn.
    const loadL = listeners.load.find((l) => l.capture);
    const clickL = listeners.click;
    assert.ok(loadL && clickL && clickL.length, 'listens for the file loading (capture) and for the button');
    assert.match(String(loadL.fn), /lightArtwork\(img\)/);
  }
  const ui = read('js/proof-ui.js');
  const light = grab(ui, / {2}function lightArtwork\(img\) \{[\s\S]*?\n {2}\}\n/, 'lightArtwork');
  // Run it on pictures, with a canvas that hands back their pixels.
  const run = (pixels, w, h) => {
    const ctx = {
      document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) },
      img: { naturalWidth: w, naturalHeight: h }, out: null,
    };
    vm.runInNewContext(`${light}\nout = lightArtwork(img);`, ctx);
    return ctx.out;
  };
  const picture = (fill) => {
    const px = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) px.set(fill(i), i * 4);
    return px;
  };
  const clear = [0, 0, 0, 0];
  assert.strictEqual(run(picture((i) => (i < 30 ? [255, 255, 255, 255] : clear)), 10, 10), true, 'white lettering on see-through');
  assert.strictEqual(run(picture((i) => (i < 30 ? [250, 220, 40, 255] : clear)), 10, 10), true, 'yellow is light too');
  assert.strictEqual(run(picture((i) => (i < 30 ? [22, 24, 29, 255] : clear)), 10, 10), false, 'dark lettering');
  assert.strictEqual(run(picture((i) => (i < 20 ? [255, 255, 255, 255] : i < 50 ? [22, 24, 29, 255] : clear)), 10, 10), false, 'mostly dark');
  assert.strictEqual(run(picture(() => [255, 255, 255, 255]), 10, 10), false, 'nothing see-through: the checks don\'t show anyway');
  assert.strictEqual(run(picture(() => clear), 10, 10), false, 'nothing at all');
  // Dark checks: still checks (the see-through parts show), and the button's pressed look.
  const css = read('css/proof.css');
  assert.match(css, /\.proof-art-box\.is-dark \.proof-art \{[^}]*conic-gradient\(#2a2e35 25%, #3b4048 0 50%, #2a2e35 0 75%, #3b4048 0\)/);
  assert.match(css, /\.proof-bg-btn\[aria-pressed="true"\]/);
  const { STRINGS } = shopPage('en', ['js/i18n-proof.js']);
  for (const k of ['proof.bgDark', 'proof.bgDarkHelp']) {
    assert.ok(STRINGS[k][0] && STRINGS[k][1], k);
    assert.doesNotMatch(STRINGS[k][1], /محل/);
  }
});

test('proof: the background chosen with the button stays when the cart draws the proof again', () => {
  const { PODProof, listeners } = proofUi('en');
  const url = PROOF.sides[0].artworkUrl;
  const classes = new Set();
  const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const box = { dataset: { proofArt: url }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const pic = { querySelector: (sel) => (sel === '[data-proof-bg]' ? btn : box) };
  box.closest = () => pic;
  const target = { closest: (sel) => (sel === '[data-proof-bg]' ? target : pic) };
  for (const l of listeners.click) l.fn({ target });
  assert.ok(classes.has('is-dark'));
  assert.strictEqual(btn.attrs['aria-pressed'], 'true');
  assert.match(PODProof.html(PROOF), /aria-pressed="true"[\s\S]*class="proof-art-box is-dark" data-proof-art=/, 'drawn again: still dark');
  for (const l of listeners.click) l.fn({ target });
  assert.match(PODProof.html(PROOF), /aria-pressed="false"[\s\S]*class="proof-art-box" data-proof-art=/, 'and back');
  // Once the customer chose, the file loading again doesn't change it.
  const img = { tagName: 'IMG', closest: () => box, naturalWidth: 0, naturalHeight: 0 };
  for (const l of listeners.load) l.fn({ target: img });
  assert.ok(!classes.has('is-dark'));
});

// ---------- 4. Kids' book: "English letters" once, as a hint ----------
test('kids book: "English letters" is said once, as a hint; an error only on a field with Arabic letters in it', () => {
  const html = read('book.html');
  assert.doesNotMatch(html, /book\.englishNote|class="notice"/, 'no notice box before anything is typed');
  const js = read('js/book.js');
  assert.strictEqual((js.match(/book\.englishHint/g) || []).length, 1, 'the hint, once');
  assert.match(js, /<p class="muted small bk-en-hint" id="bk-en-hint"/, 'as a hint (muted), not a notice');
  assert.match(js, /aria-describedby="bk-en-hint"/, 'the name boxes point to it');
  // The red line only comes on a field with right-to-left letters (markLatin), as it's typed.
  const mark = grab(js, / {2}function markLatin\(el\) \{[\s\S]*?\n {2}\}\n/, 'markLatin');
  assert.match(mark, /const bad = RTL_RE\.test\(el\.value \|\| ''\);/);
  assert.match(mark, /if \(bad && field && !note\)/);
  const { STRINGS } = shopPage('en');
  assert.strictEqual(STRINGS['book.englishNote'], undefined, 'the second wording is gone');
  assert.ok(STRINGS['book.englishHint'][0] && STRINGS['book.englishHint'][1]);
  assert.ok(STRINGS['book.latinNote'][0] && STRINGS['book.latinNote'][1]);
});
