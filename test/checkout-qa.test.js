'use strict';

// Customer-side fixes from the checkout QA round, checked without a browser:
// "Orders on this device" after a quietly expired session, the invoice of a delivered
// cash-on-delivery order, a free-shipping coupon on the invoice, Arabic counts and the new texts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** A small stand-in for common.js's POD: t / tr / esc / money / num in one language. */
function fakePod(strings, lang) {
  const digits = (s) => (lang === 'ar' ? String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s));
  return {
    lang,
    t: (key, params) => {
      const pair = strings[key];
      if (!pair) return key;
      return pair[lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? params[k] : ''));
    },
    tr: (v) => (v && typeof v === 'object' ? v[lang] || v.en || '' : v == null ? '' : String(v)),
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    money: (n) => digits(`EGP ${n}`),
    num: (n) => digits(n),
    orderNo: (n) => digits(String(n).replace(/^POD-/i, '')),
    date: (d) => String(d),
    api: async () => { throw new Error('no network'); },
    orderKey: (id, k) => k || '', orderHeaders: (k) => (k ? { 'x-order-key': k } : {}), orderPath: (p, id, k) => `/${p}?id=${encodeURIComponent(id)}${k ? `&k=${k}` : ''}`,
  };
}

function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function aftercare(local) {
  const window = { POD_STRINGS: {} };
  window.window = window;
  vm.runInNewContext(read('js/i18n-aftercare.js'), { window, localStorage: local });
  return window.PODAftercare;
}

test('orders on this device: kept unless the order really belongs to a signed-in account', () => {
  const order = (n, account) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, number: `POD-100${n}`, total: 100, createdAt: '2026-11-24T10:00:00Z', ...(account === undefined ? {} : { account }) });
  const numbers = (local) => JSON.parse(local.getItem('pod-my-orders') || '[]').map((o) => o.number);

  // The browser still thinks it is signed in, but the shop placed the order as a guest's.
  const local = storage({ 'pod-acct': 'c0ffee00-0000-4000-8000-000000000001' });
  const A = aftercare(local);
  A.rememberOrder(order(1, false));
  assert.deepStrictEqual(numbers(local), ['POD-1001']);
  // On the account: not kept here (a shared phone's next user must not see it).
  A.rememberOrder(order(2, true));
  assert.deepStrictEqual(numbers(local), ['POD-1001']);
  // An older answer without the field: the signed-in marker decides, as before.
  A.rememberOrder(order(3));
  assert.deepStrictEqual(numbers(local), ['POD-1001']);
  const guest = storage();
  aftercare(guest).rememberOrder(order(4));
  assert.deepStrictEqual(numbers(guest), ['POD-1004']);
});

/** Renders invoice.js for an order and returns the invoice's HTML. */
async function invoiceHtml(order, lang) {
  const window = { POD_STRINGS: {} };
  vm.runInNewContext(read('js/i18n.js'), { window });
  vm.runInNewContext(read('js/i18n-invoice.js'), { window });
  const strings = window.POD_STRINGS; // i18n.js sets its own object
  const POD = fakePod(strings, lang);
  POD.api = async () => order;
  const el = () => ({ innerHTML: '', hidden: false, href: '', addEventListener() {} });
  const els = { content: el(), 'inv-actions': el(), 'inv-back': el(), 'inv-print': el() };
  const document = {
    title: '',
    getElementById: (id) => els[id],
    querySelector: () => ({}),
    createElement: () => ({}),
    head: { appendChild() {} },
    addEventListener() {},
  };
  vm.runInNewContext(read('js/invoice.js'), { POD, document, location: { search: '?id=' + order.id }, URLSearchParams, window: { print() {} } });
  await new Promise((r) => setImmediate(r));
  return els.content.innerHTML;
}

const ORDER = {
  id: '11111111-1111-4111-8111-111111111111', number: 'POD-1042', createdAt: '2026-11-20T10:00:00Z',
  status: 'shipped', customer: { name: 'منى', city: 'الدقي', governorate: { en: 'Giza', ar: 'الجيزة' } },
  items: [{ productName: { en: 'Business cards', ar: 'كروت شخصية' }, color: { name: { en: 'Matte', ar: 'مطفي' } }, size: { label: '100' }, sides: [{ name: { en: 'Front', ar: 'الأمام' } }], price: 450, copies: 3, unitPrice: 150, merge: { count: 3 } }],
  subtotal: 450, discount: 0, coupon: 'SHIPFREE', shipping: 0, delivery: { speed: 'standard', fee: 0 }, total: 450,
  payment: { method: 'cod', status: 'pending' }, shipment: { shippedAt: '2026-11-22T10:00:00Z', deliveredAt: null },
};

test('invoice: a delivered cash-on-delivery order is paid, with nothing left to pay', async () => {
  const before = await invoiceHtml(ORDER, 'en');
  assert.match(before, /Not paid yet/);
  assert.match(before, /Amount due on delivery/);
  const delivered = { ...ORDER, status: 'delivered', shipment: { ...ORDER.shipment, deliveredAt: '2026-11-24T10:00:00Z' } };
  const en = await invoiceHtml(delivered, 'en');
  assert.match(en, /Paid on delivery/);
  assert.doesNotMatch(en, /Not paid yet|Amount due on delivery/);
  const ar = await invoiceHtml(delivered, 'ar');
  assert.match(ar, /اتدفع عند الاستلام/);
  assert.doesNotMatch(ar, /لم يُدفع بعد|المبلغ المطلوب عند الاستلام/);
});

test('invoice: a free-shipping coupon has its line; Arabic copies counted 3–10 in the plural', async () => {
  const en = await invoiceHtml(ORDER, 'en');
  assert.match(en, /SHIPFREE/);
  assert.match(en, /Free shipping/);
  const ar = await invoiceHtml(ORDER, 'ar');
  assert.match(ar, /× ٣ نسخ،/);
  assert.doesNotMatch(ar, /٣ نسخة/);
  const eleven = await invoiceHtml({ ...ORDER, items: [{ ...ORDER.items[0], copies: 11, price: 1650, merge: { count: 11 } }] }, 'ar');
  assert.match(eleven, /× ١١ نسخة،/);
});

test('new texts exist in English and Egyptian Arabic', () => {
  const window = { POD_STRINGS: {} };
  window.window = window;
  vm.runInNewContext(read('js/i18n.js'), { window });
  for (const f of ['js/i18n-aftercare.js', 'js/i18n-proof.js', 'js/i18n-invoice.js']) vm.runInNewContext(read(f), { window });
  const strings = window.POD_STRINGS; // i18n.js sets its own object
  for (const k of ['order.waiting_you', 'proofPage.doneRejectEdit', 'proofPage.toOrderEdit', 'invoice.paidOnDelivery', 'invoice.copies.few', 'invoice.qty.names.few', 'proof.names.few']) {
    assert.ok(Object.prototype.toString.call(strings[k]) === '[object Array]' && strings[k].length === 2 && strings[k].every((v) => typeof v === 'string' && v.trim()), k);
    assert.match(strings[k][1], /[؀-ۿ]/, k);
  }
  assert.strictEqual(strings['order.waiting_you'][1], 'مستنيين ردك');
  // The name list never reads «٣ اسم».
  assert.doesNotMatch(strings['proof.names'][1].replace('{n}', '٣'), /٣ اسم/);
});
