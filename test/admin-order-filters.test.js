'use strict';

// Admin → Orders: search and filters (public/js/admin-order-filters.js). The page's own file runs in a sandbox with a
// small stand-in POD: the search (order numbers, phones in every form, Arabic letters and digits as typed), each
// status chip and filter, the day an order was placed in Cairo, the sort, the kept filters, and the words in both
// languages. No server, no browser (test/e2e/admin-order-filters.e2e.js drives the real dashboard).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const SOURCE = read('js/admin-order-filters.js');

/** The module with a stand-in POD (and, when given, what this browser tab kept). */
function load({ lang = 'en', kept } = {}) {
  const window = {};
  window.POD = {
    lang,
    t: (k, p) => k + (p ? JSON.stringify(p) : ''),
    tr: (v) => (v && typeof v === 'object' ? v[lang] || v.en || '' : v == null ? '' : String(v)),
    num: (n) => String(n),
    plural: (base, n) => `${base}:${n}`,
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    applyI18n() {},
  };
  const store = new Map(kept === undefined ? [] : [['pod-admin-order-filters', typeof kept === 'string' ? kept : JSON.stringify(kept)]]);
  const ctx = { window, Intl, Date, console, setTimeout, clearTimeout };
  if (kept !== undefined) ctx.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'admin-order-filters.js' });
  return window.AdminOrderFilters;
}
const F = load();
const plain = (x) => JSON.parse(JSON.stringify(x));

const MUG = { productId: 'mug', productName: { en: 'Ceramic Mug', ar: 'مج سيراميك' }, status: 'queued' };
const TEE = { productId: 'tshirt', productName: { en: 'Classic T-Shirt', ar: 'تيشيرت كلاسيك' }, status: 'queued' };
let seq = 1000;
/** An order as GET /api/admin/orders gives it (the owner's answer: with total and coupon). */
function order(over = {}) {
  seq += 1;
  const { customer, ...rest } = over;
  return {
    id: `o-${seq}`,
    number: `POD-${seq}`,
    createdAt: '2026-11-20T10:00:00.000Z',
    status: 'received',
    customer: { name: 'Mona Adel', phone: '01012345678', email: 'mona@example.com', city: 'Nasr City', governorate: 'cairo', governorateName: { en: 'Cairo', ar: 'القاهرة' }, address: '3 Street 9', ...customer },
    items: [{ ...MUG }],
    payment: { method: 'cod', status: 'pending' },
    delivery: { speed: 'standard', by: '2026-11-27' },
    shipment: null,
    coupon: null,
    total: 425,
    ...rest,
  };
}
const ids = (list) => list.map((o) => o.number);
const run = (all, filters, ctx = {}) => F.apply(all, { ...plain(F.DEFAULTS), ...filters }, { today: '2026-11-25', ...ctx });
const found = (all, q, ctx) => ids(run(all, { q }, ctx).list);

// ---------- Search ----------
test('phone numbers match in any form: 0, +20, 0020, no prefix, spaces and dashes, Arabic digits, a piece of it', () => {
  const a = order({ customer: { phone: '01012345678' } });
  const b = order({ customer: { name: 'Karim', phone: '01122233344' } });
  const all = [a, b];
  for (const q of ['01012345678', '+201012345678', '00201012345678', '1012345678', '201012345678', '٠١٠١٢٣٤٥٦٧٨', '+٢٠١٠١٢٣٤٥٦٧٨', '۰۱۰۱۲۳۴۵۶۷۸',
    '+20 101 234 5678', '010-1234-5678', '(010) 1234 5678', '0020 10 1234 5678', '45678', '٥٦٧٨']) {
    assert.deepStrictEqual(found(all, q), [a.number], q);
  }
  assert.deepStrictEqual(found(all, '+20 112 223 3344'), [b.number]);
  assert.deepStrictEqual(found(all, '01212345678'), []);
  // A phone kept with the country code matches the local form too.
  const c = order({ customer: { phone: '+20 155 000 1111' } });
  assert.deepStrictEqual(found([c], '01550001111'), [c.number]);
  // "+20" alone says nothing yet: everything still shows while the number is typed.
  assert.deepStrictEqual(found(all, '+20'), ids(all));
  // The keys themselves.
  assert.strictEqual(F.phoneKey('+20 101-234-5678'), '1012345678');
  assert.strictEqual(F.phoneKey('00201012345678'), '1012345678');
  assert.strictEqual(F.phoneKey('٠١٠١٢٣٤٥٦٧٨'), '1012345678');
  assert.strictEqual(F.phoneKey('1012345678'), '1012345678');
  assert.strictEqual(F.phoneKey('0223456789'), '223456789'); // a Cairo landline
});

test('order numbers: POD-1014, 1014, Arabic digits, any case', () => {
  const a = order({ number: 'POD-1014' });
  const b = order({ number: 'POD-1015' });
  for (const q of ['POD-1014', 'pod-1014', '1014', '١٠١٤', 'POD ١٠١٤', ' pod-1014 ']) assert.deepStrictEqual(found([a, b], q), ['POD-1014'], q);
  assert.deepStrictEqual(found([a, b], '101'), ['POD-1014', 'POD-1015']);
});

test('names, email, city and governorate in both languages, ignoring case, Arabic letter variants and short vowels', () => {
  const ahmed = order({ customer: { name: 'أحمد سعيد', email: 'Ahmed.Said@Example.com', city: 'مصر الجديدة', governorate: 'giza', governorateName: { en: 'Giza', ar: 'الجيزة' } } });
  const fatma = order({ customer: { name: 'فاطمة مُنى', email: null, city: 'Smouha', governorate: 'alexandria', governorateName: { en: 'Alexandria', ar: 'الإسكندرية' } } });
  const karim = order({ customer: { name: 'Karim Adel', city: 'Nasr City', email: 'karim@mail.test' } });
  const all = [ahmed, fatma, karim];
  const is = (q, want) => assert.deepStrictEqual(found(all, q), want.map((o) => o.number), q);
  is('احمد', [ahmed]);
  is('إحمد', [ahmed]);
  is('أحمد', [ahmed]);
  is('فاطمه', [fatma]);
  is('مني', [fatma]); // ى typed as ي, and the vowel mark on مُنى ignored
  is('KARIM', [karim]);
  is('ahmed.said@example.com', [ahmed]);
  is('example.com', [ahmed]);
  is('مصر الجديده', [ahmed]); // every word, ة as ه
  is('smouha', [fatma]);
  is('الاسكندريه', [fatma]); // إ as ا, ة as ه
  is('alexandria', [fatma]);
  is('الجيزة', [ahmed]);
  is('cairo', [karim]);
  is('القاهرة', [karim]);
  // Every word must match (in any field): a name and a governorate together.
  is('karim cairo', [karim]);
  is('karim giza', []);
});

test('products (Arabic and English), the tracking number and the courier', () => {
  const mug = order();
  const tee = order({ items: [{ ...TEE, status: 'shipped' }], status: 'shipped', shipment: { courier: 'Bosta', trackingNumber: '7788-AB', shippedAt: '2026-11-22T10:00:00Z', deliveredAt: null } });
  const all = [mug, tee];
  assert.deepStrictEqual(found(all, 'mug'), [mug.number]);
  assert.deepStrictEqual(found(all, 'سيراميك'), [mug.number]);
  assert.deepStrictEqual(found(all, 'تيشيرت'), [tee.number]);
  assert.deepStrictEqual(found(all, 'T-Shirt'), [tee.number]);
  assert.deepStrictEqual(found(all, '7788-AB'), [tee.number]);
  assert.deepStrictEqual(found(all, '٧٧٨٨'), [tee.number]);
  assert.deepStrictEqual(found(all, 'bosta'), [tee.number]);
});

test('a coupon code is searched only for people who see amounts, and only when the order answer has it', () => {
  const a = order({ coupon: 'EID20' });
  const b = order();
  assert.deepStrictEqual(found([a, b], 'eid20', { coupons: true }), [a.number]);
  assert.deepStrictEqual(found([a, b], 'EID20', { coupons: false }), [], 'not for people without amounts');
  // Operations: the server leaves the coupon (and the total) out; nothing to find.
  const { coupon, total, ...ops } = a;
  assert.deepStrictEqual(found([ops, b], 'EID20', { coupons: true }), []);
});

// ---------- Status chips ----------
test('each status chip, with live counts within the search and the more filters', () => {
  const o = {
    received: order(),
    review: order({ status: 'in_review', items: [{ ...MUG, status: 'review' }, { ...TEE }] }),
    awaiting: order({ status: 'in_review', items: [{ ...MUG, status: 'awaiting_approval' }] }),
    changes: order({ status: 'in_review', items: [{ ...MUG, status: 'changes_requested' }] }),
    printing: order({ status: 'in_production', items: [{ ...MUG, status: 'printing' }, { ...TEE, status: 'printed' }] }),
    ready: order({ status: 'in_production', items: [{ ...MUG, status: 'printed' }, { ...TEE, status: 'printed' }] }),
    shipped: order({ status: 'shipped', items: [{ ...MUG, status: 'shipped' }], shipment: { courier: 'Bosta', shippedAt: '2026-11-22T10:00:00Z' } }),
    delivered: order({ status: 'delivered', items: [{ ...MUG, status: 'shipped' }], shipment: { shippedAt: '2026-11-22T10:00:00Z', deliveredAt: '2026-11-23T10:00:00Z' } }),
    // The courier's delivery day makes it delivered even when the status lags (as admin.js's orderState).
    deliveredAt: order({ status: 'shipped', items: [{ ...MUG, status: 'shipped' }], shipment: { shippedAt: '2026-11-21T10:00:00Z', deliveredAt: '2026-11-22T10:00:00Z' } }),
    late: order({ delivery: { speed: 'express', by: '2026-11-24' } }),
    lateShipped: order({ status: 'shipped', items: [{ ...MUG, status: 'shipped' }], delivery: { speed: 'standard', by: '2026-11-20' }, shipment: { shippedAt: '2026-11-19T10:00:00Z' } }),
    dueToday: order({ delivery: { speed: 'standard', by: '2026-11-25' } }),
    deliveredLate: order({ status: 'delivered', items: [{ ...MUG, status: 'shipped' }], delivery: { speed: 'standard', by: '2026-11-01' }, shipment: { deliveredAt: '2026-11-02T10:00:00Z' } }),
    // Printed and handed to the courier (shippedAt) but the status not updated yet: not "ready to ship" any more.
    printedShipped: order({ status: 'in_production', items: [{ ...MUG, status: 'printed' }], shipment: { shippedAt: '2026-11-24T10:00:00Z' } }),
  };
  const all = Object.values(o);
  const r = run(all, {});
  const chip = (c) => ids(run(all, { chip: c }).list).sort();
  const want = (...keys) => keys.map((k) => o[k].number).sort();
  assert.deepStrictEqual(chip('all'), ids(all).sort());
  assert.deepStrictEqual(chip('review'), want('review'));
  assert.deepStrictEqual(chip('customer'), want('awaiting', 'changes'));
  assert.deepStrictEqual(chip('received'), want('received', 'late', 'dueToday'));
  assert.deepStrictEqual(chip('in_production'), want('printing', 'ready', 'printedShipped'));
  assert.deepStrictEqual(chip('ready'), want('ready'));
  assert.deepStrictEqual(chip('shipped'), want('shipped', 'lateShipped'));
  assert.deepStrictEqual(chip('delivered'), want('delivered', 'deliveredAt', 'deliveredLate'));
  assert.deepStrictEqual(chip('late'), want('late', 'lateShipped'), 'by-day passed in Cairo, not delivered (shipped still counts)');
  assert.deepStrictEqual(plain(r.counts), { all: 14, review: 1, customer: 2, received: 3, in_production: 3, ready: 1, shipped: 2, delivered: 3, late: 2 });
  // Counts follow the search and the more filters (not the chip picked).
  const express = run(all, { speed: 'express', chip: 'review' });
  assert.deepStrictEqual(plain(express.counts), { all: 1, review: 0, customer: 0, received: 1, in_production: 0, ready: 0, shipped: 0, delivered: 0, late: 1 });
  assert.deepStrictEqual(express.list, []);
  // "Late" is by the day in Cairo: the next day, the one due today is late too.
  assert.deepStrictEqual(ids(run(all, { chip: 'late' }, { today: '2026-11-26' }).list).sort(), want('late', 'lateShipped', 'dueToday'));
  // admin.js's own orderState is used when given.
  const custom = run(all, { chip: 'delivered' }, { state: (x) => (x === o.received ? 'delivered' : x.status) });
  assert.deepStrictEqual(ids(custom.list).sort(), want('received', 'delivered', 'deliveredLate'));
  // An unknown chip (an old kept value) shows everything.
  assert.strictEqual(run(all, { chip: 'nope' }).list.length, all.length);
});

// ---------- More filters ----------
test('payment, delivery speed, governorate and product filters', () => {
  const paid = order({ payment: { method: 'cod', status: 'paid' }, customer: { governorate: 'giza', governorateName: { en: 'Giza', ar: 'الجيزة' } } });
  const express = order({ delivery: { speed: 'express', by: '2026-11-24' }, items: [{ ...TEE }, { ...MUG }] });
  const old = order({ delivery: null, items: [{ ...TEE }] }); // before delivery speeds: standard
  const all = [paid, express, old];
  const with_ = (f) => ids(run(all, f).list).sort();
  assert.deepStrictEqual(with_({ pay: 'paid' }), [paid.number]);
  assert.deepStrictEqual(with_({ pay: 'unpaid' }), [express.number, old.number].sort());
  assert.deepStrictEqual(with_({ speed: 'express' }), [express.number]);
  assert.deepStrictEqual(with_({ speed: 'standard' }), [paid.number, old.number].sort());
  assert.deepStrictEqual(with_({ gov: 'giza' }), [paid.number]);
  assert.deepStrictEqual(with_({ gov: 'cairo' }), [express.number, old.number].sort());
  assert.deepStrictEqual(with_({ product: 'tshirt' }), [express.number, old.number].sort(), 'any of its items');
  assert.deepStrictEqual(with_({ product: 'mug' }), [paid.number, express.number].sort());
  assert.deepStrictEqual(with_({ product: 'tshirt', pay: 'unpaid', speed: 'express', q: 'mona' }), [express.number], 'all together');
  // The lists offer what the orders have, by name.
  const c = F.choices(all);
  assert.deepStrictEqual(plain(c.gov), [{ value: 'cairo', label: 'Cairo' }, { value: 'giza', label: 'Giza' }]);
  assert.deepStrictEqual(plain(c.product), [{ value: 'tshirt', label: 'Classic T-Shirt' }, { value: 'mug', label: 'Ceramic Mug' }].sort((a, b) => a.label.localeCompare(b.label)));
  const ar = load({ lang: 'ar' }).choices(all);
  assert.deepStrictEqual(plain(ar.gov.map((g) => g.label)), ['الجيزة', 'القاهرة']);
});

test('the day an order was placed is its day in Cairo (winter and summer time), from and to inclusive', () => {
  assert.strictEqual(F.cairoDay('2026-11-24T22:30:00Z'), '2026-11-25'); // 00:30 in Cairo (UTC+2)
  assert.strictEqual(F.cairoDay('2026-11-24T21:30:00Z'), '2026-11-24'); // 23:30
  assert.strictEqual(F.cairoDay('2026-07-01T21:30:00Z'), '2026-07-02'); // 00:30, summer time (UTC+3)
  assert.strictEqual(F.cairoDay('2026-07-01T20:30:00Z'), '2026-07-01'); // 23:30
  assert.strictEqual(F.cairoDay('not a date'), '');
  const lateNight = order({ createdAt: '2026-11-24T22:30:00Z' });
  const evening = order({ createdAt: '2026-11-24T21:30:00Z' });
  const summer = order({ createdAt: '2026-07-01T21:30:00Z' });
  const all = [lateNight, evening, summer];
  const between = (from, to) => ids(run(all, { from, to }).list).sort();
  assert.deepStrictEqual(between('2026-11-25', '2026-11-25'), [lateNight.number]);
  assert.deepStrictEqual(between('2026-11-24', '2026-11-24'), [evening.number]);
  assert.deepStrictEqual(between('2026-11-24', ''), [lateNight.number, evening.number].sort(), 'from only');
  assert.deepStrictEqual(between('', '2026-11-24'), [evening.number, summer.number].sort(), 'to only');
  assert.deepStrictEqual(between('2026-07-02', '2026-07-02'), [summer.number]);
  assert.deepStrictEqual(between('2026-07-01', '2026-07-01'), []);
  assert.deepStrictEqual(between('2026-11-25', '2026-07-02'), ids(all).sort(), 'typed the wrong way round: the days between');
});

// ---------- Sort ----------
test('sort: newest first (default), oldest first, due date soonest (delivered after the open ones, no date last)', () => {
  const a = order({ createdAt: '2026-11-20T10:00:00Z', delivery: { speed: 'standard', by: '2026-11-27' } });
  const b = order({ createdAt: '2026-11-22T10:00:00Z', delivery: { speed: 'express', by: '2026-11-24' } });
  const c = order({ createdAt: '2026-11-21T10:00:00Z', delivery: null });
  const d = order({ createdAt: '2026-11-19T10:00:00Z', delivery: { speed: 'standard', by: '2026-11-24' } });
  const done = order({ createdAt: '2026-11-10T10:00:00Z', status: 'delivered', delivery: { speed: 'standard', by: '2026-11-15' }, shipment: { deliveredAt: '2026-11-14T10:00:00Z' } });
  const all = [b, c, a, d, done]; // (the server's newest-first order, roughly)
  assert.deepStrictEqual(ids(run(all, {}).list), [b, c, a, d, done].map((o) => o.number));
  assert.deepStrictEqual(ids(run(all, { sort: 'new' }).list), [b, c, a, d, done].map((o) => o.number));
  assert.deepStrictEqual(ids(run(all, { sort: 'old' }).list), [done, d, a, c, b].map((o) => o.number));
  // Same day due: the older order first.
  assert.deepStrictEqual(ids(run(all, { sort: 'due' }).list), [d, b, a, c, done].map((o) => o.number));
  // Sorting never changes the list it was given.
  assert.deepStrictEqual(ids(all), [b, c, a, d, done].map((o) => o.number));
});

// ---------- Kept filters, 50 at a time ----------
test('filters kept for the tab come back cleaned; unknown or broken values are dropped', () => {
  const s = (v) => plain(F.sanitize(v));
  assert.deepStrictEqual(s(null), plain(F.DEFAULTS));
  assert.deepStrictEqual(s({ q: 'x'.repeat(300), chip: 'late', pay: 'free', speed: 'express', from: '2026-11-01', to: '25/11/2026', gov: 'giza', product: 'mug', sort: 'total', more: 'yes', limit: 120 }),
    { q: 'x'.repeat(100), chip: 'late', pay: '', speed: 'express', from: '2026-11-01', to: '', gov: 'giza', product: 'mug', sort: 'new', more: false, limit: 150 });
  assert.strictEqual(s({ limit: 1e9 }).limit, 50);
  assert.strictEqual(F.isFiltered(F.DEFAULTS), false);
  assert.strictEqual(F.isFiltered({ ...F.DEFAULTS, sort: 'old', more: true }), false, 'the sort is not a filter');
  assert.strictEqual(F.isFiltered({ ...F.DEFAULTS, q: '  ' }), false);
  assert.strictEqual(F.isFiltered({ ...F.DEFAULTS, chip: 'late' }), true);
  assert.strictEqual(F.moreCount({ ...F.DEFAULTS, pay: 'paid', from: '2026-11-01', to: '2026-11-02', product: 'mug' }), 3, 'the dates count once');
});

test('view(): what this tab kept is applied, 50 orders at a time; a broken kept value starts clean', () => {
  const all = [];
  for (let k = 0; k < 130; k++) all.push(order({ createdAt: new Date(Date.UTC(2026, 10, 1) + k * 3600e3).toISOString(), customer: { name: k % 2 ? 'Odd One' : 'Even One' } }));
  all.reverse();
  const fresh = load({ kept: undefined });
  assert.strictEqual(fresh.view(all).length, 50);
  assert.strictEqual(fresh.view(all)[0], all[0], 'the same order objects, newest first');
  const kept = load({ kept: { q: 'odd', limit: 100, sort: 'old' } });
  const shown = kept.view(all);
  assert.strictEqual(shown.length, 65);
  assert.ok(shown.every((o) => o.customer.name === 'Odd One'));
  assert.ok(Date.parse(shown[0].createdAt) < Date.parse(shown[1].createdAt), 'oldest first');
  assert.strictEqual(plain(kept.filters).q, 'odd');
  assert.strictEqual(load({ kept: '{not json' }).view(all).length, 50);
  assert.deepStrictEqual(plain(load({ kept: '{not json' }).filters), plain(F.DEFAULTS));
  // No sessionStorage at all (private mode): works with the defaults.
  assert.strictEqual(load().view(all).length, 50);
  assert.deepStrictEqual(load().view([]), []);
});

test('the empty message names the search in its own direction (<bdi>) and offers Clear filters', () => {
  const m = load({ kept: { q: 'Mona <b>' } });
  const html = m.emptyHtml();
  assert.match(html, /of\.none/);
  assert.match(html, /<bdi dir="auto">Mona &#60;b&#62;<\/bdi>/);
  assert.match(html, /data-of-clear/);
});

// ---------- Words ----------
test('every text in English and Egyptian Arabic; "صاحب الموقع" not "محل"; no "·" beside Arabic numbers', () => {
  const window = { POD_STRINGS: {} };
  vm.runInNewContext(read('js/i18n.js'), { window });
  vm.runInNewContext(read('js/i18n-admin-shipping.js'), { window });
  const S = window.POD_STRINGS;
  const keys = new Set([...SOURCE.matchAll(/['"`](of\.[A-Za-z_.]+?)['"`]/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')));
  for (const m of SOURCE.matchAll(/data-i18n(?:-[a-z]+)?="([\w.]+)"/g)) keys.add(m[1]);
  for (const c of F.CHIPS) keys.add(`of.chip.${c}`);
  for (const base of ['of.orders', 'of.matching']) for (const f of ['one', 'two', 'few', 'many']) keys.add(`${base}.${f}`);
  for (const base of ['of.orders', 'of.matching']) keys.delete(base);
  keys.add('ship.paid');
  keys.add('ship.unpaid');
  keys.add('delivery.standard');
  assert.ok(keys.size > 40, `found ${keys.size} keys`);
  for (const k of keys) {
    const pair = S[k];
    assert.ok(Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1], `${k} in both languages`);
    assert.match(pair[1], /[؀-ۿ]/, `${k} is Arabic`);
    assert.doesNotMatch(pair[1], /محل/, `${k}: the site is never "محل"`);
    assert.doesNotMatch(pair[1], /·/, `${k}: no "·" in Arabic`);
  }
  // Placeholders the same in both languages.
  for (const k of keys) {
    const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    if (k !== 'of.countAll') assert.strictEqual(holes(S[k][1]), holes(S[k][0]), `${k} placeholders`);
  }
});
