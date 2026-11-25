'use strict';

// QA (shop, tester 1, 25 Nov): short Arabic words in the home search, the share page's "thanks" and the broken
// invoice / proof links after a language switch, the order page's date ("shipped on 10:18" was when it was placed),
// compound first names in the account greeting, long names on ready designs, and the account's "Sign in instead".
// No server, no browser: the pages' own code is run with just enough of a page around it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const STRINGS = (() => {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  for (const f of ['js/i18n-aftercare.js', 'js/i18n-proof.js', 'js/i18n-invoice.js']) vm.runInNewContext(read(f), { window });
  return window.POD_STRINGS;
})();
const ARABIC = /[؀-ۿ]/;

// ---------- 1. Home search: a three-letter Arabic word is a word ----------
function homeSearch() {
  const src = read('index.html');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end'));
  const SEARCH = vm.runInNewContext(`${kit}\nSEARCH`);
  const aliases = vm.runInNewContext(`(${src.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  const { PRODUCTS, CATEGORIES } = require('../src/products');
  const cat = (id) => (CATEGORIES.find((c) => c.id === id) || { name: {} }).name;
  // (As the home page: true, a longer word without its ي is still looked for anywhere.)
  const idx = Object.fromEntries(PRODUCTS.map((p) => [p.id, SEARCH.index([p.id, p.name.en, p.name.ar, p.description && p.description.en, p.description && p.description.ar, cat(p.category).en, cat(p.category).ar, aliases[p.id] || aliases[p.base] || ''].join(' '), true)]));
  return { SEARCH, find: (q) => Object.keys(idx).filter((id) => SEARCH.match(idx[id], SEARCH.query(q))) };
}

test('home search: كيس finds the bags, not the phone cases, mouse pads and keychains; ليل is not in 55 products', () => {
  const { SEARCH, find } = homeSearch();
  for (const q of ['كيس', 'أكياس', 'اكياس', 'الكيس']) {
    const got = find(q);
    for (const id of ['tote', 'paperbags', 'lunchbag']) assert.ok(got.includes(id), `"${q}" finds ${id} (got ${got.join(', ') || 'nothing'})`);
    // (Their category is إكسسوارات: كيس without its ي, "كس", is inside it.)
    for (const id of ['phonecase', 'mousepad', 'deskmat', 'keychain', 'namelabels', 'folders', 'banners']) assert.ok(!got.includes(id), `"${q}" is not the ${id}`);
    assert.deepStrictEqual(got.sort(), find('شنطة').sort(), `"${q}" finds what شنطة finds`);
  }
  // ليل: not the لل of للأعمال, للأفراح… (55 products before).
  assert.ok(find('ليل').length <= 3, `ليل: ${find('ليل').join(', ')}`);
  // A three-letter word is still found as a word, at the start of one, and as what it names.
  assert.ok(find('كوب').includes('mug'));
  assert.ok(find('صور').includes('photoprints'), 'صور: the start of صورة / صور');
  assert.ok(find('فرح').includes('invitations'), 'فرح: a wedding');
  assert.ok(find('مخد').includes('cushion'), 'مخد: the start of مخدة, while typing');
  // Longer words keep the forgiving search (without the ي, anywhere), and one or two letters are as before.
  assert.ok(find('تشيرت').includes('tshirt'));
  assert.ok(find('كو').includes('mug'));
  // The same on /designs (no "anywhere"): كيس is not in إكسسوارات, but is a bag.
  assert.ok(!SEARCH.match(SEARCH.index('Accessories إكسسوارات'), SEARCH.query('كيس')));
  assert.ok(!SEARCH.match(SEARCH.index('إكسسوارات', true), SEARCH.query('كيس')));
  assert.ok(SEARCH.match(SEARCH.index('شنطة قماش'), SEARCH.query('كيس')));
  assert.ok(SEARCH.match(SEARCH.index('ليلة العيد'), SEARCH.query('ليل')), 'ليل: the start of ليلة');
  assert.ok(!SEARCH.match(SEARCH.index('كروت للأعمال', true), SEARCH.query('ليل')));
  assert.ok(SEARCH.match(SEARCH.index('كيس مخدة'), SEARCH.query('كيس مخدة')));
});

// ---------- A page's script run with a few elements around it ----------
function element(id) {
  return {
    id, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', src: '', alt: '', href: '', dataset: {},
    on: {},
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); },
    focus() {},
    querySelector: () => null,
  };
}
/** A POD whose language can be switched, with the pages' real words. */
function pod(lang) {
  const P = {
    lang,
    t: (key, params) => {
      const pair = STRINGS[key];
      if (!pair) return key;
      return pair[P.lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? params[k] : ''));
    },
    tr: (v) => (v && typeof v === 'object' ? v[P.lang] || v.en || '' : v == null ? '' : String(v)),
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    money: (n) => `EGP ${n}`,
    num: (n) => String(n),
    sep: () => (P.lang === 'ar' ? '، ' : ' · '),
    toast() {},
  };
  return P;
}
function page(script, { search = '', pathname = '/', api }) {
  const els = {};
  const docListeners = {};
  const document = {
    title: '',
    activeElement: null,
    getElementById: (id) => (els[id] ||= element(id)),
    querySelector: () => element('x'),
    createElement: () => element('x'),
    head: { appendChild() {} },
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
  };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const POD = pod('ar');
  POD.api = api;
  vm.runInNewContext(read(script), { POD, document, localStorage, location: { search, pathname, reload() {} }, URLSearchParams, window: { print() {} }, Intl, setTimeout, console });
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    els, POD, tick,
    async switchTo(lang) {
      POD.lang = lang;
      for (const fn of docListeners['pod:langchange'] || []) fn();
      await tick();
      await tick();
    },
  };
}

// ---------- 2. Share page: "thanks" in the page's language ----------
test('share page: after sending, the thanks line follows a language switch', async () => {
  const share = {
    id: 'abcdefghijkl', productName: { en: 'T-shirt', ar: 'تيشيرت' }, color: { name: { en: 'Black', ar: 'أسود' } }, size: { label: 'M' },
    sides: [{ id: 'front', name: { en: 'Front', ar: 'الأمام' }, preview: '/x.png' }], feedback: [],
  };
  const p = page('js/share.js', {
    pathname: '/s/abcdefghijkl',
    api: async (url, opts) => (opts && opts.method === 'POST' ? { ...share, feedback: [{ vote: 'up', at: '2026-11-25T10:00:00Z' }] } : share),
  });
  await p.tick();
  assert.strictEqual(p.els['share-body'].hidden, false);
  for (const fn of p.els['vote-up'].on.click) await fn();
  await p.tick();
  assert.strictEqual(p.els['share-thanks'].hidden, false);
  assert.strictEqual(p.els['share-thanks'].textContent, STRINGS['share.thanks'][1]);
  await p.switchTo('en');
  assert.strictEqual(p.els['share-thanks'].textContent, 'Thanks! Your opinion was sent.');
  assert.ok(p.els['vote-up'].disabled && p.els['vote-change'].disabled, 'one vote');
  await p.switchTo('ar');
  assert.strictEqual(p.els['share-thanks'].textContent, 'شكرًا! رأيك اتبعت.');
});

// ---------- 3. Broken invoice and proof links: heading and message in one language ----------
test('invoice?id=bad: the heading and the message follow the page language', async () => {
  let calls = 0;
  const box = {};
  const p = page('js/invoice.js', {
    search: '?id=bad',
    api: async () => {
      calls++;
      // The site answers in the language it is asked in (the page's).
      throw Object.assign(new Error(box.p ? box.p.POD.t('order.notFound') : 'الطلب ده مش موجود'), { status: 404, code: 'orderNotFound' });
    },
  });
  box.p = p;
  await p.tick();
  const html = () => p.els.content.innerHTML;
  assert.match(html(), /الطلب ده مش موجود/);
  assert.doesNotMatch(html(), /Order not found/);
  await p.switchTo('en');
  assert.match(html(), /<h2>Order not found<\/h2>/);
  assert.doesNotMatch(html(), ARABIC, html());
  await p.switchTo('ar');
  assert.doesNotMatch(html(), /[A-Za-z]{3,}(?![^<]*>)/, html());
  assert.strictEqual(calls, 1, 'a missing order is not asked for again');
});

test('invoice: another failure is asked again in the new language (no connection: said in it)', async () => {
  const p = page('js/invoice.js', {
    search: '?id=00000000-0000-4000-8000-000000000000',
    api: async () => { throw Object.assign(new Error('مفيش اتصال بالإنترنت. اتأكد من الاتصال وحاول تاني.'), { network: true }); },
  });
  await p.tick();
  assert.match(p.els.content.innerHTML, /مفيش اتصال/);
  await p.switchTo('en');
  assert.match(p.els.content.innerHTML, /No internet connection/);
  assert.doesNotMatch(p.els.content.innerHTML, ARABIC);
});

test('proof?id=bad (no proof link) and a proof that could not load: one language after a switch', async () => {
  const p = page('js/proof-page.js', { search: '?id=bad', api: async () => { throw new Error('not asked'); } });
  await p.tick();
  const html = () => p.els.content.innerHTML;
  assert.match(html(), new RegExp(STRINGS['proofPage.gone'][1]));
  assert.match(html(), new RegExp(STRINGS['proofPage.noToken'][1]));
  await p.switchTo('en');
  assert.match(html(), /This proof link no longer works/);
  assert.match(html(), /This page needs the link from your email or WhatsApp message\./);
  assert.doesNotMatch(html(), ARABIC, html());

  const q = page('js/proof-page.js', { search: '?t=abc', api: async () => { throw Object.assign(new Error(STRINGS['msg.network'][1]), { network: true }); } });
  await q.tick();
  assert.match(q.els.content.innerHTML, /مفيش اتصال/);
  assert.match(q.els.content.innerHTML, /data-act="reload"/);
  await q.switchTo('en');
  assert.match(q.els.content.innerHTML, /No internet connection/);
  assert.match(q.els.content.innerHTML, />Try again</);
  assert.doesNotMatch(q.els.content.innerHTML, ARABIC);
});

// ---------- 4. Order page: the date under the number is when it was placed ----------
test('order page: "shipped, dated 10:18" is gone; the date is said to be when the order was placed', () => {
  for (const k of ['order.meta', 'order.meta.one', 'order.meta.two', 'order.meta.few', 'order.meta.many']) {
    const [en, ar] = STRINGS[k];
    assert.match(en, /^\{status\} · placed on \{date\} · /, k);
    assert.match(ar, /^\{status\}، اتطلب يوم \{date\}، /, k);
    assert.doesNotMatch(ar, /بتاريخ/, k);
  }
  const src = read('order.html');
  assert.match(src, /POD\.plural\('order\.meta', o\.items\.length, \{ status: t\('order\.' \+ shownStatus\(o\)\), date: placedOn\(o\.createdAt\) \}\)/);
  const line = src.match(/const placedOn = \(iso\) => [^\n]+;/)[0];
  const placedOn = (lang) => vm.runInNewContext(`${line}\nplacedOn`, { POD: { lang } });
  // (Cairo time, as the shop's customers see it.)
  const at = '2026-11-25T08:18:00Z';
  const en = placedOn('en')(at);
  const ar = placedOn('ar')(at);
  assert.match(en, /25 November 2026/);
  assert.match(ar, /٢٥ نوفمبر ٢٠٢٦/);
  assert.doesNotMatch(ar, /،/, 'no comma inside the date: the line\'s commas part what it says');
});

// ---------- 5. Greeting: compound first names stay whole ----------
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

test('account greeting: "عبد الرحمن" is greeted whole, not "عبد" (servant)', () => {
  const { firstName } = loadPOD('ar');
  const cases = {
    'عبد الرحمن محمد': 'عبد الرحمن',
    'عبد الله أحمد': 'عبد الله',
    'عبد الفتاح': 'عبد الفتاح',
    'عبد ال رحمن حسن': 'عبد ال رحمن',
    'عبدالرحمن محمد': 'عبدالرحمن',
    'أبو بكر محمد': 'أبو بكر',
    'ابو بكر': 'ابو بكر',
    'أم كلثوم إبراهيم': 'أم كلثوم',
    'ام كلثوم': 'ام كلثوم',
    'محمد عبد الرحمن': 'محمد',
    'سارة أحمد': 'سارة',
    'Abdel Rahman Mohamed': 'Abdel Rahman',
    'Abd El Rahman Mohamed': 'Abd El Rahman',
    'abd el rahman': 'abd el rahman',
    'Abdul Aziz Hassan': 'Abdul Aziz',
    'Abd Allah Omar': 'Abd Allah',
    'Abu Bakr Ali': 'Abu Bakr',
    'Abo El Magd Hassan': 'Abo El Magd',
    'Um Kalthoum Ali': 'Um Kalthoum',
    'Umm Kulthum': 'Umm Kulthum',
    'El Sayed Mahmoud': 'El Sayed',
    'Al Hassan Ali': 'Al Hassan',
    'Mohamed Abdel Rahman': 'Mohamed',
    'Sara': 'Sara',
    'عبد': 'عبد',
    '  Omar   Khaled ': 'Omar',
    '': '',
  };
  for (const [name, want] of Object.entries(cases)) assert.strictEqual(firstName(name), want, name);
  assert.strictEqual(firstName(null), '');
  // The account page greets with it.
  assert.match(read('js/account.js'), /t\('acct\.hello', \{ name: POD\.firstName\(me\.name\)\.replace\(\/ \/g, '\\u00a0'\) \}\)/);
  assert.doesNotMatch(read('js/account.js'), /name\.split\(' '\)\[0\]/);
});

// ---------- 6. Ready designs: a long name is never cut inside a word ----------
test('design page: the name boxes take more than fits, and say when the last words are left out', () => {
  const src = read('js/design.js');
  assert.match(src, /maxlength="\$\{s\.max \+ 30\}"/, 'the box itself never cuts a word short');
  assert.match(src, /const cutShort = \(\) => samples\.some\(\(s, k\) => typed\(s, k\) !== D\.cleanName\(names\[k\], Infinity\)\);/);
  assert.match(src, /\$\('dp-names-cut'\)\.hidden = !cutShort\(\);/);
  const [en, ar] = STRINGS['design.name.cut'];
  assert.match(en, /whole words/);
  assert.match(ar, /كلمات/);
  assert.doesNotMatch(ar, /محل/);
});

// ---------- 7. Account → Details: another account's number, for someone signed in ----------
test('account details: a number or email another account has is said so, not "Sign in instead"', () => {
  const src = read('js/account.js');
  assert.match(src, /acctPhoneTaken: \['acct\.phoneUsedOther', 'pf-phone'\]/);
  assert.match(src, /acctEmailTaken: \['acct\.emailUsedOther', 'pf-email'\]/);
  assert.deepStrictEqual([...STRINGS['acct.phoneUsedOther']], ['This mobile number is already used by another account.', 'رقم الموبايل ده مستخدم في حساب تاني.']);
  assert.deepStrictEqual([...STRINGS['acct.emailUsedOther']], ['This email is already used by another account.', 'الإيميل ده مستخدم في حساب تاني.']);
  // (Signing up keeps the site's own words: there, "Sign in instead" is right.)
  const { MESSAGES } = require('../src/i18n');
  if (MESSAGES) assert.match(MESSAGES.acctPhoneTaken.en, /Sign in instead/);
});
