'use strict';

// QA (25 Nov): the kids' book thumbnails keeping their labels in the old language, the printing-house
// message ("·" next to Arabic digits, the links' last day written as 2026-12-25), the missing
// "24 pages × 100 copies" booklet, and the staff member's name after a reload of the admin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createApp } = require('../src/app');
const dispatch = require('../src/dispatch');
const { PRODUCTS, pageSides } = require('../src/products');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

// ---------- Kids book: the page thumbnails follow the language ----------
/** A fake element: takes whatever book.js sets on it. */
function fakeEl() {
  const attrs = {};
  return {
    hidden: false, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, insertAdjacentHTML() {}, querySelectorAll: () => [], querySelector: () => null,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
    getContext: () => new Proxy({}, { get: () => () => {} }), getBoundingClientRect: () => ({ top: 0, width: 100 }),
  };
}
/** book.js on a page with i18n.js + common.js, the shop language `lang`. Returns { POD, labels() }. */
async function loadBookPage(lang) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const els = {};
  const listeners = {};
  let thumbs = { html: null, buttons: [] };
  // The thumbnails as book.js drew them (#bk-thumbs's HTML), the same objects until it is drawn again.
  const thumbButtons = () => {
    const html = els['bk-thumbs'] ? els['bk-thumbs'].innerHTML : '';
    if (thumbs.html !== html) {
      thumbs = { html, buttons: [...html.matchAll(/<button [^>]*aria-label="([^"]*)"/g)].map((m) => { const b = fakeEl(); b.setAttribute('aria-label', m[1]); return b; }) };
    }
    return thumbs.buttons;
  };
  const document = {
    readyState: 'complete', documentElement: {}, body: null, title: '',
    getElementById: (id) => (els[id] = els[id] || fakeEl()),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '#bk-thumbs button' ? thumbButtons() : []),
    createElement: fakeEl,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: (ev) => { for (const fn of listeners[ev.type] || []) fn(ev); },
  };
  const window = { addEventListener() {}, scrollTo() {}, scrollY: 0 };
  const context = {
    window, document, localStorage, sessionStorage: localStorage, location: { search: '?b=space-hero', href: '' }, URLSearchParams,
    matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, console,
    CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
  };
  vm.runInNewContext(read('js/i18n.js'), context);
  vm.runInNewContext(read('js/common.js'), context);
  const POD = window.POD;
  const n = (en, ar) => ({ en, ar });
  const product = { id: 'book-space-hero', kind: 'book', book: 'space-hero', name: n('Space hero', 'بطل الفضاء'), basePrice: 500, sizes: [{ id: 'a4', label: n('A4', 'A4'), surcharge: 0 }] };
  const book = { id: 'space-hero', pages: 3, questions: [], title: n('{name} in space', '{name} في الفضاء'), blurb: n('A story', 'حكاية'), ai: false };
  Object.assign(POD, {
    loadCatalog: async () => ({ products: [product] }),
    api: async () => book,
    getCart: () => [],
    sizeNote: () => '',
    toast() {},
  });
  context.POD = POD;
  vm.runInNewContext(read('js/book.js'), context);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { POD, labels: () => thumbButtons().map((b) => b.getAttribute('aria-label')), main: () => els['bk-img'].alt };
}

test('kids book: the page thumbnails\' labels change with the language, in that language\'s digits', async () => {
  const page = await loadBookPage('ar');
  assert.deepStrictEqual(page.labels(), ['صفحة ١ من الكتاب', 'صفحة ٢ من الكتاب', 'صفحة ٣ من الكتاب']);
  assert.strictEqual(page.main(), 'صفحة ١ من الكتاب');
  page.POD.setLang('en');
  assert.deepStrictEqual(page.labels(), ['Page 1 of the book', 'Page 2 of the book', 'Page 3 of the book']);
  assert.strictEqual(page.main(), 'Page 1 of the book');
  page.POD.setLang('ar');
  assert.deepStrictEqual(page.labels(), ['صفحة ١ من الكتاب', 'صفحة ٢ من الكتاب', 'صفحة ٣ من الكتاب']);
});

// ---------- Printing-house message ----------
const n = (en, ar) => ({ en, ar });
const WHITE = { name: n('White', 'أبيض') };
const BLACK = { name: n('Black', 'أسود') };
const ML = { label: n('325 ml', '325 مل') };
const MUG = {
  position: 1, productName: n('Mug', 'مج'), process: 'sublimation', color: WHITE, size: ML,
  quantities: [{ color: WHITE, size: ML, qty: 3 }, { color: BLACK, size: ML, qty: 2 }],
};
const ARGS = {
  house: { name: 'X' }, design: { sides: [] }, files: [{ label: 'PDF', url: 'https://x/dl/abc', name: 'a.pdf' }], expires: '2026-12-25T10:00:00.000Z',
  order: { number: 'POD-3001', items: [{}], delivery: { speed: 'express', by: '2026-11-26' } },
};
const messages = (item, lang) => {
  const wa = dispatch.whatsappText({ ...ARGS, item, lang });
  const mail = dispatch.emailBody({ ...ARGS, item, lang, attached: false });
  return { wa, mail, all: [wa, mail.text, mail.html.replace(/<[^>]+>/g, ' ')] };
};

test('printing-house message: in Arabic the Arabic comma joins colour and size, never "·" next to Arabic digits', () => {
  const { wa, all } = messages(MUG, 'ar');
  assert.match(wa, /\*اللون \/ المقاس:\* أبيض، ٣٢٥ مل ×٣؛ أسود، ٣٢٥ مل ×٢\n/);
  const one = messages({ ...MUG, quantities: null }, 'ar');
  assert.match(one.wa, /\*اللون \/ المقاس:\* أبيض، ٣٢٥ مل\n/);
  for (const text of [...all, ...one.all]) assert.doesNotMatch(text, /[٠-٩]\s*·|·\s*[٠-٩]/, text);
  // Only a colour or only a size: no comma left over.
  assert.match(messages({ ...MUG, quantities: null, size: null }, 'ar').wa, /\*اللون \/ المقاس:\* أبيض\n/);
  assert.match(messages({ ...MUG, quantities: [{ size: ML, qty: 4 }] }, 'ar').wa, /\*اللون \/ المقاس:\* ٣٢٥ مل ×٤\n/);
  // English as before.
  const en = messages(MUG, 'en');
  assert.match(en.wa, /\*Colour \/ size:\* White · 325 ml ×3, Black · 325 ml ×2\n/);
  assert.match(messages({ ...MUG, quantities: null }, 'en').wa, /\*Colour \/ size:\* White · 325 ml\n/);
});

test('printing-house message: the download links\' last day is written out like the express day', () => {
  const ar = messages(MUG, 'ar');
  const en = messages(MUG, 'en');
  for (const text of ar.all) {
    assert.match(text, /روابط التحميل شغالة لحد الجمعة، ٢٥ ديسمبر\./, text);
    assert.match(text, /لازم يوصل للعميل لحد الخميس، ٢٦ نوفمبر/, text); // (the same way)
    assert.doesNotMatch(text, /٢٠٢٦-١٢-٢٥|2026-12-25/, text);
    assert.doesNotMatch(text.replace('POD-3001', ''), /\d/, text);
  }
  for (const text of en.all) {
    assert.match(text, /Download links work until Friday 25 December\./, text);
    assert.match(text, /expects it by Thursday 26 November/, text);
    assert.doesNotMatch(text, /2026-12-25/, text);
  }
  // Without express: the links' day is still written out.
  const std = dispatch.whatsappText({ ...ARGS, order: { number: 'POD-3001', items: [{}] }, item: MUG, lang: 'en', expires: '2027-01-04T23:59:00.000Z' });
  assert.match(std, /Download links work until Monday 4 January\./);
});

// ---------- Booklets: 24 pages × 100 copies ----------
test('booklets: every page count comes in 100 copies too, 24 pages halfway between 16 and 32 like every other row', () => {
  const p = PRODUCTS.find((x) => x.id === 'booklets');
  const price = (id) => p.basePrice + p.sizes.find((z) => z.id === id).surcharge;
  const ids = p.sizes.map((z) => z.id);
  for (const copies of [1, 10, 25, 50, 100]) {
    for (const pages of [8, 16, 24, 32]) assert.ok(ids.includes(`${pages}-${copies}`), `${pages}-${copies}`);
    assert.strictEqual(price(`24-${copies}`), (price(`16-${copies}`) + price(`32-${copies}`)) / 2, `24 × ${copies}`);
  }
  assert.strictEqual(price('24-100'), 3200);
  // In its place in the list, labelled like its neighbours, not a small pack, 24 pages printed.
  assert.deepStrictEqual(ids.slice(ids.indexOf('8-100')), ['8-100', '16-100', '24-100', '32-100']);
  const z = p.sizes.find((x) => x.id === '24-100');
  assert.deepStrictEqual(z.label, { en: '24 pages × 100 copies', ar: '24 صفحة × 100 نسخة' });
  assert.strictEqual(z.pack, true);
  assert.ok(!z.smallPack);
  assert.strictEqual(z.pages, 24);
  const sides = pageSides(p, '24-100').map((s) => s.id);
  assert.strictEqual(sides.length, 24);
  assert.deepStrictEqual([sides[0], sides[1], sides[22], sides[23]], ['front', 'p2', 'p23', 'back']);
  // Fewer copies of the same booklet never cost more than more copies, and each copy costs less in 100s.
  assert.ok(price('24-50') < price('24-100') && price('24-100') / 100 < price('24-50') / 50);
});

// ---------- Server: the shop sells it; the admin session says who is signed in ----------
let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa-misc4-'));
  const OPEN = { max: 1e6, ms: 1000 };
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const req = (method, url, body, token) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (url, body, token) => req('POST', url, body, token);

test('booklets: the shop lists 24 pages × 100 copies and a design of it keeps its 24 pages', async () => {
  const shop = (await (await fetch(`${base}/api/products`)).json()).products;
  const p = shop.find((x) => x.id === 'booklets');
  const ids = p.sizes.map((z) => z.id);
  assert.ok(ids.indexOf('16-100') > 0 && ids.indexOf('24-100') === ids.indexOf('16-100') + 1 && ids.indexOf('32-100') === ids.indexOf('24-100') + 1, ids.join());
  const z = p.sizes.find((x) => x.id === '24-100');
  assert.strictEqual(p.basePrice + z.surcharge, 3200);
  const sides = Object.fromEntries(['front', 'p2', 'p23', 'back'].map((id) => [id, { editor: { objects: [{ type: 'i-text', text: id }] } }]));
  const r = await post('/api/designs', { productId: 'booklets', color: 'matte', size: '24-100', options: { binding: 'right' }, sides });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const d = await r.json();
  assert.ok(d.files.some((f) => f.startsWith('p23-')), d.files.join());
  // A page past the 24th is not part of this size.
  const bad = await post('/api/designs', { productId: 'booklets', color: 'matte', size: '24-100', options: { binding: 'right' }, sides: { ...sides, p24: sides.p2 } });
  assert.strictEqual(bad.status, 400);
});

test('admin: after a reload the header shows the staff member\'s name, not the username', async () => {
  // The page takes the person's name from the session (shown), the username only when there is none.
  assert.match(read('js/admin.js'), /const r = await adminApi\('\/api\/admin\/session'\);\s*\/\/[^\n]*\n\s*setAccess\(r, r\.shown \|\| r\.name\);/);
  assert.match(read('js/admin-roles.js'), /shown: \(typeof a\.shown === 'string' && a\.shown\) \|\| name \|\| fallbackName,/);
  const add = await post('/api/admin/staff', { name: 'Mostafa مصطفى', username: 'mostafa', password: 'a-long-password' }, owner);
  assert.strictEqual(add.status, 201, await add.clone().text());
  const login = await (await post('/api/admin/login', { username: 'mostafa', password: 'a-long-password' })).json();
  assert.strictEqual(login.shown, 'Mostafa مصطفى', 'right after signing in');
  assert.strictEqual(login.name, 'mostafa', '(name: the username, as in the session)');
  assert.ok(login.id, 'their id, so the Staff screen knows which row is theirs');
  const session = await (await req('GET', '/api/admin/session', undefined, login.token)).json();
  assert.strictEqual(session.role, 'catalogue', 'a product manager is the catalogue role now');
  assert.strictEqual(session.name, 'mostafa');
  // The owner's session names no one.
  const own = await (await req('GET', '/api/admin/session', undefined, owner)).json();
  assert.strictEqual(own.role, 'owner');
  assert.strictEqual(own.shown, undefined);
});

test('admin: the session returns the staff member\'s name to show (shown)', async () => {
  const login = await (await post('/api/admin/login', { username: 'mostafa', password: 'a-long-password' })).json();
  const session = await (await req('GET', '/api/admin/session', undefined, login.token)).json();
  assert.strictEqual(session.shown, 'Mostafa مصطفى');
});
