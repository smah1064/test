'use strict';

// QA (shop, 25 Nov, wave 4): on a ready design no size of a garment looks picked until the customer picks one;
// the cart never says "Only 0 left… order fewer"; a coupon code typed with Arabic letters is told that codes are
// English letters and numbers (and the admin's "3-24 letters" message says English letters too).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');
const { MESSAGES, format } = require('../src/i18n');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
function strings() {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  return window.POD_STRINGS;
}

test('the new words are in both languages, Egyptian Arabic, and the site is never called محل', () => {
  const S = strings();
  assert.deepStrictEqual([...S['design.pickSize']], ['Pick your size', 'اختار مقاسك']);
  assert.match(S['sizeSoldOutPick'][0], /^\{size\} is sold out in this colour\. Pick another size\.$/);
  assert.match(S['sizeSoldOutPick'][1], /^مقاس \{size\} خلصان في اللون ده\. اختار مقاس تاني\.$/);
  assert.deepStrictEqual([...S['coupon.latinOnly']], ['Coupon codes are in English letters and numbers, like EID20', 'كود الخصم بيتكتب بحروف إنجليزي وأرقام، زي EID20']);
  for (const k of ['design.pickSize', 'sizeSoldOutPick', 'coupon.latinOnly']) assert.doesNotMatch(S[k][1], /محل/, k);
  for (const k of ['stockNoneLeft', 'stockInCart', 'couponCodeBad']) {
    assert.ok(MESSAGES[k] && MESSAGES[k].en && MESSAGES[k].ar, `${k} in English and Arabic`);
    assert.doesNotMatch(MESSAGES[k].ar, /محل/, k);
  }
});

test('stock: "Only 0 left… order fewer" is never said; a few left still is', () => {
  const name = { en: 'Classic T-Shirt (Black · L)', ar: 'تيشيرت كلاسيك (أسود · L)' };
  for (const lang of ['en', 'ar']) {
    const none = format('notEnoughStock', { name: name[lang], left: 0 }, lang);
    assert.strictEqual(none, format('stockNoneLeft', { name: name[lang] }, lang));
    assert.doesNotMatch(none, /\b0\b|٠|Only|fewer|عدد أقل|بس/, `${lang}: ${none}`);
    assert.ok(none.includes(name[lang]), none);
    const inCart = format('stockInCart', { name: name[lang] }, lang);
    assert.doesNotMatch(inCart, /\b0\b|٠|Only|fewer|عدد أقل/, `${lang}: ${inCart}`);
  }
  assert.strictEqual(format('notEnoughStock', { name: name.en, left: 0 }, 'en'), 'No more pieces of Classic T-Shirt (Black · L) are left for this item.');
  assert.strictEqual(format('notEnoughStock', { name: name.ar, left: 0 }, 'ar'), 'مفيش قطع تانية فاضلة من تيشيرت كلاسيك (أسود · L) للمنتج ده.');
  assert.strictEqual(format('stockInCart', { name: name.en }, 'en'), 'The last pieces of Classic T-Shirt (Black · L) are in another item in your cart.');
  assert.strictEqual(format('stockInCart', { name: name.ar }, 'ar'), 'آخر قطع من تيشيرت كلاسيك (أسود · L) في منتج تاني في سلتك.');
  // Some left: as before.
  assert.strictEqual(format('notEnoughStock', { name: name.en, left: 2 }, 'en'), 'Only 2 of Classic T-Shirt (Black · L) left. Please order fewer pieces.');
  assert.strictEqual(format('notEnoughStock', { name: name.ar, left: 2 }, 'ar'), 'فاضل ٢ بس من تيشيرت كلاسيك (أسود · L). اطلب عدد أقل.');
});

test('admin coupons: the code rule says English letters (Arabic digits as the page shows them)', () => {
  assert.strictEqual(format('couponCodeBad', {}, 'en'), 'Codes are 3-24 English letters or numbers (no spaces), like EID20');
  assert.strictEqual(format('couponCodeBad', {}, 'ar'), 'الكود من ٣ لـ ٢٤ حرف إنجليزي أو رقم (من غير مسافات)، زي EID20');
});

test('cart: a code with Arabic letters is told so on the page, without asking the shop; Arabic digits still work', () => {
  const src = read('cart.html');
  const couponOf = src.match(/const couponOf = \(s\) => [\s\S]*?\.replace\(\/\\s\+\/g, ''\);/);
  const notLatin = src.match(/const notLatin = \(code\) => [^\n]+;/);
  assert.ok(couponOf && notLatin, 'couponOf and notLatin');
  const check = vm.runInNewContext(`${couponOf[0]}\n${notLatin[0]}\n(s) => notLatin(couponOf(s))`);
  for (const s of ['عيد20', 'عيد٢٠', 'eid عيد', 'خصم', 'ÉTÉ20']) assert.strictEqual(check(s), true, s);
  for (const s of ['EID20', 'eid٢٠', 'EID۲۰', 'ＥＩＤ２０', ' e i d 2 0 ', 'SALE-50', 'VIP_1', '']) assert.strictEqual(check(s), false, s);
  // Said in the page's language (its own words, by key: never sent to the shop to be reworded), before any question to the shop.
  const apply = src.slice(src.indexOf('const applyCoupon = async () => {'), src.indexOf("document.getElementById('coupon-apply').addEventListener"));
  assert.ok(apply.indexOf('if (notLatin(code))') < apply.indexOf('setCoupon(code);'));
  assert.match(apply, /couponNote = \{ code, key: 'coupon\.latinOnly'/);
  assert.match(src, /const refusalText = \(r\) => \(r\.key \? t\(r\.key\) :/);
  assert.match(src, /const needsWords = \(r\) => Boolean\(r\) && !r\.key &&/);
});

test('/design: clothes show no size picked until one is picked, with "Pick your size" by the sizes', () => {
  const src = read('js/design.js');
  assert.match(src, /const asksSize = \(\) => state\.product\.category === 'apparel' && state\.product\.sizes\.length > 1;/);
  assert.match(src, /const sizeChosen = \(\) => !asksSize\(\) \|\| pickedSize === state\.size\.id;/);
  assert.match(src, /const needsSize = \(\) => !sizeChosen\(\);/);
  // The chips: marked (and pressed) only once chosen.
  assert.match(src, /const on = chosen && s\.id === size\.id;\s*return `<button type="button" class="chip \$\{on \? 'active' : ''\}" data-size="\$\{esc\(s\.id\)\}" aria-pressed="\$\{on\}">/);
  assert.match(src, /\$\('dp-size-hint'\)\.hidden = chosen;/);
  // "Only n left" of a size only once that size is picked.
  assert.match(src, /const few = \(chosen && POD\.comboFew\(product, color\.id, size\.id\)\) \|\| product\.fewLeft \|\| 0;/);
  // "Which size?" marks the size picked there.
  const sizeAsk = src.slice(src.indexOf("$('size-ask').addEventListener('click'"), src.indexOf('// ---------- A sample name left as it is'));
  assert.match(sizeAsk, /pickedSize = size\.id;\s*renderOptions\(\);/);
  // The hint sits in the size label, hidden until the page says otherwise.
  const html = read('design.html');
  assert.match(html, /<label><span data-i18n="design\.size"><\/span><span id="dp-size-hint" hidden>: <span class="dp-size-hint" data-i18n="design\.pickSize"><\/span><\/span><\/label><div class="chips" id="dp-sizes">/);
});

// ---------- The cart's prices (POST /api/cart/quote) with the last pieces of a size ----------
const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shop4-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const req = (method, url, body, token, lang) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(lang ? { 'x-lang': lang } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (url, body, token, lang) => req('POST', url, body, token, lang);
const byId = (id) => PRODUCTS.find((p) => p.id === id);

async function makeDesign(id, color, size) {
  const p = byId(id);
  const side = p.sides[0];
  const res = await post('/api/designs', { productId: id, color, size, sides: { [side.id]: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, size) + 2 * (side.bleedIn || 0);
      const hIn = (printWidthFor(p, side, size) * side.printArea.h) / side.printArea.w + 2 * (side.bleedIn || 0);
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: '#2050c0' } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return (await done.json()).id;
}

test('cart: the second item for the last piece of a size never says "Only 0 left"; a coupon in Arabic letters is not valid', async () => {
  const r = await req('PUT', '/api/admin/catalog/tshirt', { variantStock: { 'black|L': 1 } }, owner);
  assert.strictEqual(r.status, 200, await r.clone().text());
  const a = await makeDesign('tshirt', 'black', 'L');
  const b = await makeDesign('tshirt', 'black', 'L');
  for (const lang of ['en', 'ar']) {
    const q = await (await post('/api/cart/quote', { designIds: [a, b] }, null, lang)).json();
    assert.deepStrictEqual(q.items.map((i) => i.unavailable || null), [null, 'notEnoughStock'], JSON.stringify(q.items));
    const text = q.items[1].unavailableText;
    assert.doesNotMatch(text, /\b0\b|٠|Only|fewer|عدد أقل/, `${lang}: ${text}`);
    assert.ok(text.includes(lang === 'ar' ? 'تيشيرت' : 'T-Shirt') && text.includes('L)'), text);
    assert.match(text, lang === 'ar' ? /في منتج تاني في سلتك/ : /in another item in your cart/);
  }
  // The shop's answer to a code in Arabic letters, for anyone asking it directly: not valid (never the admin's code rule).
  for (const [lang, re] of [['en', /^This coupon code is not valid$/], ['ar', /^كود الخصم ده غير صحيح$/]]) {
    const q = await (await post('/api/cart/quote', { designIds: [a], couponCode: 'عيد20' }, null, lang)).json();
    assert.match(q.couponError, re);
  }
  await req('PUT', '/api/admin/catalog/tshirt', { variantStock: null }, owner);
});
