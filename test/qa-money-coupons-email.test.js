'use strict';

// QA (25 Nov), low-priority server fixes:
//  - order messages show whole amounts like the site and the invoice ("٣٥٠ ج.م.", "EGP 350"), with
//    two decimals only when there are piastres;
//  - coupon discounts are whole pounds (SAVE10 on a 35 EGP bookmark is 4 EGP off, not 3.50), the same
//    in the cart's quote, on the order and in the Accounts report;
//  - sign-up keeps only emails that can receive mail, after dropping the dot / comma / semicolon a
//    phone leaves at the end ("dot.test@gmail.com." is "dot.test@gmail.com");
//  - the share page isolates a reply's name from its date.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');
const notify = require('../src/notify');
const coupons = require('../src/coupons');
const customers = require('../src/customers');
const accounting = require('../src/accounting');

// ---------- Money in the order messages ----------
const realFetch = global.fetch;
const ENV = {
  BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', BREVO_API_URL: 'http://brevo.invalid/v3/smtp/email', MAIL_FROM_NAME: '',
  ADMIN_EMAIL: 'admin@example.test', ADMIN_LANG: 'ar', CALLMEBOT_PHONE: '201000000000', CALLMEBOT_APIKEY: 'k', CALLMEBOT_URL: 'http://wa.invalid/whatsapp.php',
  SITE_URL: 'https://shop.example.test',
};
/** Runs fn with the notification settings on and fetch recording what would be sent. */
async function capture(fn, over = {}) {
  const sent = [];
  const saved = {};
  for (const [k, v] of Object.entries({ ...ENV, ...over })) { saved[k] = process.env[k]; process.env[k] = v; }
  global.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('http://wa.invalid/')) sent.push(new URL(u).searchParams.get('text'));
    else { const b = JSON.parse(init.body); sent.push(b.subject, b.htmlContent, b.textContent); }
    return Promise.resolve({ ok: true, status: 200, text: async () => 'Message queued' });
  };
  try {
    await fn();
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return sent;
}
const n = (en, ar) => ({ en, ar });
const mkOrder = (over = {}) => ({
  id: 'o-1', number: 'POD-3001', lang: 'ar',
  customer: { name: 'Mona', phone: '01012345678', email: 'mona@example.test', governorate: 'cairo', city: 'Nasr City', address: '1 Street' },
  items: [
    { id: 'a', productName: n('T-shirt', 'تيشيرت'), color: { name: n('White', 'أبيض') }, size: { label: n('M', 'M') }, sides: [{ id: 'front', name: n('Front', 'الأمام') }], price: 300, copies: 1 },
    { id: 'b', productName: n('Mug', 'مج'), color: { name: n('White', 'أبيض') }, size: { label: n('11 oz', '11 أونصة') }, sides: [{ id: 'm', name: n('Side 1', 'جهة 1') }], price: 50, copies: 1 },
  ],
  subtotal: 350, discount: 35, coupon: { code: 'SAVE10' }, shipping: 75, total: 390,
  payment: { method: 'cod', status: 'pending' },
  shipment: { courier: 'Bosta', trackingNumber: 'BST-1' },
  ...over,
});

test('order messages show whole pounds without ".00", in Arabic and English', async () => {
  for (const lang of ['ar', 'en']) {
    const texts = await capture(async () => {
      await notify.orderPlaced(mkOrder({ lang }), { lang });
      await notify.orderShipped(mkOrder({ lang }), {});
    }, { ADMIN_LANG: lang });
    // WhatsApp + admin email + customer email + shipped email (subject, HTML, text).
    assert.strictEqual(texts.length, 1 + 3 + 3 + 3);
    const all = texts.join('\n');
    if (lang === 'ar') {
      for (const amount of ['٣٠٠', '٥٠', '٣٥٠', '٣٥', '٧٥', '٣٩٠']) assert.match(all, new RegExp(`(^|[^٠-٩])${amount}\\sج\\.م\\.`), amount);
      assert.doesNotMatch(all, /٫٠٠/);
      assert.match(all, /-\u200f?٣٥\sج\.م\./, 'the discount');
    } else {
      for (const amount of ['300', '50', '350', '35', '75', '390']) assert.match(all, new RegExp(`EGP\\s${amount}(?![.\\d])`), amount);
      assert.doesNotMatch(all, /\d\.00\b/);
    }
    // The total, in every message that has it, and in the admin's subject.
    const total = lang === 'ar' ? /٣٩٠\sج\.م\./ : /EGP\s390(?![.\d])/;
    const withTotal = texts.filter((x) => /Total|الإجمالي/.test(x));
    assert.strictEqual(withTotal.length, 1 + 2 + 2 + 2);
    for (const t of withTotal) assert.match(t, total, t.slice(0, 80));
    assert.match(texts.find((x) => /^(New order|طلب جديد) POD-3001 · /.test(x)), total);
  }
});

test('order messages keep two decimals when there are piastres', async () => {
  const texts = await capture(() => notify.orderPlaced(mkOrder({ subtotal: 35, discount: 3.5, shipping: 75, total: 106.5 }), { lang: 'ar' }));
  const all = texts.join('\n');
  assert.match(all, /١٠٦٫٥٠\sج\.م\./);
  assert.match(all, /٣٫٥٠\sج\.م\./);
  assert.match(all, /(^|[^٠-٩٫])٣٥\sج\.م\./);
  const en = await capture(() => notify.orderShipped(mkOrder({ lang: 'en', total: 106.5 }), {}));
  assert.match(en.join('\n'), /EGP\s106\.50/);
});

// ---------- Coupon discounts in whole pounds ----------
const coupon = (over) => ({ code: 'SAVE10', active: true, type: 'percent', value: 10, products: [], categories: [], ...over });
const line = (price, productId = 'bookmarks') => ({ productId, category: 'stationery', price });
const off = (c, ...prices) => coupons.apply(coupon(c), { lines: prices.map((p) => line(p)) }).discount;

test('coupon discounts are rounded to whole pounds', () => {
  assert.strictEqual(off({}, 35), 4, '10% of 35 is 3.50: 4');
  assert.strictEqual(off({}, 34), 3, '10% of 34 is 3.40: 3');
  assert.strictEqual(off({}, 35, 35, 35), 11, '10% of 105 is 10.50: 11');
  assert.strictEqual(off({ value: 15 }, 45), 7, '15% of 45 is 6.75: 7');
  assert.strictEqual(off({ value: 20 }, 450), 90, 'whole amounts stay as they are');
  assert.strictEqual(off({ value: 100 }, 35), 35, 'never more than the items');
  // 1% of 35 is 0.35: no pound off, so the coupon isn't applied at all (see qa-svg-coupon.test.js).
  assert.deepStrictEqual(coupons.apply(coupon({ value: 1 }), { lines: [line(35)] }), { ok: false, reason: 'couponNoDiscount' });
  // The cap: never more than it (a cap with piastres stops at the pound under it).
  assert.strictEqual(off({ value: 50, maxDiscount: 100 }, 450), 100);
  assert.strictEqual(off({ maxDiscount: 2.5 }, 35), 2);
  // Fixed amounts: as they are, unless they have piastres; never more than the items.
  assert.strictEqual(off({ type: 'fixed', value: 20 }, 35), 20);
  assert.strictEqual(off({ type: 'fixed', value: 50 }, 35), 35);
  assert.strictEqual(off({ type: 'fixed', value: 12.4 }, 35), 12);
  assert.strictEqual(off({ type: 'fixed', value: 12.5 }, 35), 13);
  // Only the products it is for count.
  const r = coupons.apply(coupon({ products: ['bookmarks'] }), { lines: [line(450, 'tshirt'), line(35)] });
  assert.strictEqual(r.discount, 4);
  assert.deepStrictEqual(r.lines, [1]);
  // Free shipping takes nothing off the items.
  assert.strictEqual(off({ type: 'freeship', value: 0 }, 35), 0);
});

// ---------- Through the shop ----------
const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Test', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '1 Street' };
let server;
let base;
let dataDir;
let token;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa-money-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const admin = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });

/** A one-bookmark design (35 EGP), printed on the front only. */
async function bookmark() {
  const p = PRODUCTS.find((x) => x.id === 'bookmarks');
  const side = p.sides.find((s) => s.id === 'front');
  const res = await post('/api/designs', { productId: p.id, color: p.colors[0].id, size: '1', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, '1') + 2 * (side.bleedIn || 0);
      const hIn = (printWidthFor(p, side, '1') * side.printArea.h) / side.printArea.w + 2 * (side.bleedIn || 0);
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: '#2050c0' } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('SAVE10 on a 35 EGP bookmark: 4 EGP off in the cart, on the order and in the accounts', async () => {
  const r = await admin('/api/admin/coupons', 'POST', { code: 'SAVE10', type: 'percent', value: 10 });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const d = await bookmark();
  assert.strictEqual(d.price, 35);
  const q = await (await post('/api/cart/quote', { designIds: [d.id], couponCode: 'save10' })).json();
  assert.strictEqual(q.subtotal, 35);
  assert.strictEqual(q.discount, 4);
  assert.strictEqual(q.coupon.discount, 4);
  assert.strictEqual(q.total, 35 - 4 + q.shipping);
  assert.ok(Number.isInteger(q.total), `a whole total to collect: ${q.total}`);

  const res = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: 'SAVE10', expectedTotal: q.total });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const order = await res.json();
  assert.strictEqual(order.discount, 4);
  assert.strictEqual(order.total, q.total);

  const day = accounting.localDay(new Date().toISOString());
  const rep = await (await admin(`/api/admin/accounts?from=${day}&to=${day}`)).json();
  const row = rep.orders.find((o) => o.number === order.number);
  assert.strictEqual(row.discount, 4);
  assert.strictEqual(row.total, q.total);
  assert.strictEqual(rep.totals.discounts, 4);
  assert.strictEqual(rep.products.find((p) => p.productId === 'bookmarks').sales, 31);
  const list = await (await admin('/api/admin/coupons')).json();
  assert.strictEqual(list.coupons.find((c) => c.code === 'SAVE10').discountGiven, 4);
});

// ---------- Emails that can receive mail ----------
test('sign-up: the end dot / comma a phone leaves is dropped; addresses that can\'t receive mail are refused', async () => {
  const signup = (phone, email) => post('/api/account/signup', { name: 'Dot Test', phone, email, password: 'a-long-password-1' });
  let r = await signup('01011110001', 'Dot.Test@Gmail.com.');
  assert.strictEqual(r.status, 201, await r.clone().text());
  assert.strictEqual((await r.json()).customer.email, 'dot.test@gmail.com');
  // Signing in with the same slip finds the account.
  r = await post('/api/account/login', { login: ' dot.test@gmail.com. ', password: 'a-long-password-1' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  // The same address with the end dot is the same account.
  assert.strictEqual((await signup('01011110002', 'dot.test@gmail.com')).status, 409);

  const good = ['a@b.com,', 'x.y+tag@mail.example.co.uk', 'name@my-shop.eg', 'Ali@Example.COM ;'];
  const bad = ['a@b..com', 'a..b@c.com', 'a@b', 'a@b.c', 'a@-b.com', 'a@b-.com', 'a b@c.com', 'a@b.com,c@d.com', 'a,b@c.com', '<a@b.com>', 'a@b_c.com', '@b.com', 'a@.com', 'a@b.c0m', 'x'.repeat(195) + '@b.com'];
  let phone = 10;
  for (const email of bad) {
    r = await signup(`010111100${phone++}`, email);
    assert.strictEqual(r.status, 400, `${email}: ${await r.clone().text()}`);
  }
  for (const email of good) {
    r = await signup(`010111100${phone++}`, email);
    assert.strictEqual(r.status, 201, `${email}: ${await r.clone().text()}`);
    assert.strictEqual((await r.json()).customer.email, customers.cleanEmail(email));
  }
  assert.deepStrictEqual(['a@b.com,', 'Ali@Example.COM ;', 'dot.test@gmail.com..', ' a@b.com;, '].map(customers.cleanEmail), ['a@b.com', 'ali@example.com', 'dot.test@gmail.com', 'a@b.com']);
  // No email at all is still fine.
  assert.strictEqual((await signup('01011110099', '')).status, 201);
});

// ---------- Share page replies ----------
test('share page: a reply\'s name is isolated from its date', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'share.js'), 'utf8');
  // (Then the line separator: the Arabic comma in Arabic, " · " in English.)
  assert.match(src, /<bdi>\$\{esc\(f\.name\)\}<\/bdi>\$\{esc\(POD\.sep\(\)\)\}/);
  assert.doesNotMatch(src, /esc\(f\.name\) \+ ' · '/);
});
