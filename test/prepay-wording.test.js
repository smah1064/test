'use strict';

// Paying in advance only, from launch (owner's decision; wording prepared with the owner's OK, 26 Nov, kept off
// until the owner says so): one switch (src/payment-wording.js, PREPAY_ONLY), off by default. Off, the shop says
// what it says today (cash on delivery); on, nothing promises cash on delivery: the API tells the pages, the
// pages' texts have their prepay wording, and the server's messages and emails change with it. Orders are made
// the same way either way. No real message is sent: fetch is replaced by a fake that records what would go out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const notify = require('../src/notify');
const { PREPAY_ONLY } = require('../src/payment-wording');

/** A promise of cash on delivery, in either language ("الاستلام المتوقع", the day it is expected, is a date, not a promise). */
const COD = /عند الاستلام|عند استلام|الدفع عند|كاش|cash on delivery|on delivery|in cash/i;
const codIn = (s) => COD.test(String(s).replace(/الاستلام المتوقع/g, '')) || /الاستلام/.test(String(s).replace(/الاستلام المتوقع/g, ''));

// ---------- The switch ----------
test('the switch is off: the shop keeps cash on delivery until the owner says so', () => {
  assert.strictEqual(PREPAY_ONLY, false);
});

// ---------- The pages' texts (public/js/i18n*.js) ----------
function strings() {
  const window = {};
  window.window = window;
  const ctx = { window, document: { addEventListener() {} }, localStorage: { getItem: () => null } };
  const dir = path.join(__dirname, '../public/js');
  for (const f of ['i18n.js', ...fs.readdirSync(dir).filter((x) => /^i18n-.*\.js$/.test(x))]) vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
  return window.POD_STRINGS;
}
const S = strings();

// Today's texts, exactly as they were before the switch: shown as they are while it is off.
const TODAY = {
  'home.step3.text': ['Pay cash on delivery anywhere in Egypt and follow each item from the print queue to your door.', 'ادفع كاش عند الاستلام في أي مكان في مصر، وتابع كل قطعة من الطباعة لحد التوصيل.'],
  'hm.b3.title': ['Cash on delivery', 'الدفع عند الاستلام'],
  'hm.b3.text': ['Pay when your order arrives', 'ادفع لما الطلب يوصلك'],
  'hm.a4': ['Cash on delivery: you pay the courier when your order arrives.', 'الدفع عند الاستلام: بتدفع للمندوب لما الطلب يوصلك.'],
  'design.note': ['Each piece is printed one at a time after you order. Cash on delivery.', 'كل قطعة بتتطبع لوحدها بعد ما تطلب. والدفع عند الاستلام.'],
  'order.waMessage': ['Hello! I\'d like to confirm my order {n}:\n{items}\nTotal: {total} (cash on delivery)\nName: {name}', 'أهلًا! عايز أأكد طلبي رقم {n}:\n{items}\nالإجمالي: {total} (الدفع عند الاستلام)\nالاسم: {name}'],
  'checkout.cod': ['Cash on delivery', 'الدفع عند الاستلام'],
  'checkout.codText': ['Pay the courier in cash when your order arrives.', 'ادفع للمندوب كاش عند استلام الطلب.'],
  'order.payCod': ['Cash on delivery: {amount}', 'الدفع عند الاستلام: {amount}'],
  'invoice.paidOnDelivery': ['Paid on delivery', 'اتدفع عند الاستلام'],
  'invoice.amountDue': ['Amount due on delivery', 'المبلغ المطلوب عند الاستلام'],
  'photos.dlvCod': ['💵 Cash on delivery available', '💵 الدفع عند الاستلام متاح'],
  'admin.collect': ['Cash on delivery: collect {amount}', 'الدفع عند الاستلام: تحصيل {amount}'],
  'ship.cod': ['Cash on delivery', 'الدفع عند الاستلام'],
  'acc.collected': ['Shipped (cash due/collected)', 'اتشحن (فلوس محصلة/مستحقة)'],
};
// The customer's texts that promise cash on delivery today: each has a prepay wording that doesn't.
const CUSTOMER_KEYS = ['home.step3.text', 'hm.b3.title', 'hm.b3.text', 'hm.a4', 'design.note', 'order.waMessage', 'checkout.cod', 'checkout.codText', 'order.payCod', 'invoice.paidOnDelivery', 'invoice.amountDue', 'photos.dlvCod'];

test('off: every text is today\'s, word for word', () => {
  for (const [k, v] of Object.entries(TODAY)) assert.deepStrictEqual(Array.from(S[k]), v, k);
});

test('on: every customer text that promises cash on delivery has a prepay wording, in English and Egyptian Arabic, that doesn\'t', () => {
  for (const k of CUSTOMER_KEYS) {
    const p = S[`${k}.prepay`];
    assert.ok(Array.isArray(p) && p.length === 2 && p[0] && p[1], `${k}.prepay`);
    for (const s of p) assert.ok(!codIn(s), `${k}.prepay: ${s}`);
    assert.match(p[1], /[؀-ۿ]/, `${k}.prepay is Arabic`);
    assert.doesNotMatch(p[0], /[؀-ۿ]/, `${k}.prepay is English`);
    assert.doesNotMatch(p[1], /محل/, 'the shop is never called محل');
    // The same {placeholders} as the text it stands for.
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.strictEqual(holes(p[0]), holes(S[k][0]), k);
    assert.strictEqual(holes(p[1]), holes(S[k][1]), k);
  }
  // No payment method is named: it isn't chosen yet.
  const all = Object.entries(S).filter(([k]) => k.endsWith('.prepay')).flatMap(([, v]) => v).join('\n');
  assert.doesNotMatch(all, /card|visa|fawry|instapay|wallet|كارت|فيزا|فوري|محفظة|إنستاباي/i);
  // And every prepay wording stands for a text that exists.
  for (const k of Object.keys(S).filter((x) => x.endsWith('.prepay'))) assert.ok(S[k.slice(0, -'.prepay'.length)], k);
  // The new words, as agreed.
  assert.deepStrictEqual(Array.from(S['checkout.cod.prepay']), ['Pay when you order', 'الدفع مقدّمًا وقت الطلب']);
  assert.match(S['hm.b3.text.prepay'][1], /ادفع وانت بتطلب/);
  assert.match(S['checkout.codText.prepay'][1], /مفيش حاجة تدفعها للمندوب/);
  assert.match(S['checkout.codText.prepay'][0], /Nothing to pay the courier/);
});

test('the pages pick the prepay wording only while the switch is on (common.js t)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/common.js'), 'utf8');
  assert.match(src, /const pair = \(prepayOnly && STRINGS\[key \+ '\.prepay'\]\) \|\| STRINGS\[key\];/);
  assert.match(src, /let prepayOnly = false;/);
  assert.match(src, /payment\.set\(catalog && catalog\.payment\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/order.html'), 'utf8'), /if \(order\.shop\) POD\.payment\.set\(order\.shop\.payment\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/invoice.js'), 'utf8'), /if \(order\.shop\) POD\.payment\.set\(order\.shop\.payment\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8'), /if \(r\.payment\) POD\.payment\.set\(r\.payment\);/);
});

// ---------- The API ----------
const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN] };
const CUSTOMER = { name: 'Mona Ali', phone: '01011112222', governorate: 'giza', city: 'Dokki', address: '5 Nile St' };

async function shop(options) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-prepay-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0, requireApproval: false, ...options });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (url, method = 'GET', body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return {
    call,
    async close() {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    async order() {
      const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
      const d = await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
      assert.strictEqual(d.status, 201);
      for (const name of d.json.files) {
        const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
        await fetch(`${base}/api/designs/${d.json.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': d.json.uploadToken }, body });
      }
      await fetch(`${base}/api/designs/${d.json.id}/complete`, { method: 'POST', headers: { 'x-upload-token': d.json.uploadToken } });
      const q = await call('/api/cart/quote', 'POST', { designIds: [d.json.id] });
      const o = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [d.json.id], expectedTotal: q.json.total });
      assert.strictEqual(o.status, 201, JSON.stringify(o.json));
      return o.json;
    },
  };
}

for (const [name, options, expected] of [['off (the default)', {}, false], ['on', { prepayOnly: true }, true]]) {
  test(`API, switch ${name}: the catalogue, the order (and its page) and the dashboard say prepayOnly ${expected}; the order is made as always`, { timeout: 60000 }, async () => {
    const s = await shop(options);
    try {
      const cat = await s.call('/api/products');
      assert.deepStrictEqual(cat.json.payment, { prepayOnly: expected });
      const o = await s.order();
      assert.deepStrictEqual(o.shop.payment, { prepayOnly: expected });
      assert.deepStrictEqual(o.payment, { method: 'cod', status: 'pending' }, 'orders are made as before');
      const again = await s.call(`/api/orders/${o.id}`, 'GET', undefined, { 'x-order-key': o.key });
      assert.strictEqual(again.status, 200);
      assert.deepStrictEqual(again.json.shop.payment, { prepayOnly: expected });
      const token = (await s.call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
      const session = await s.call('/api/admin/session', 'GET', undefined, { Authorization: `Bearer ${token}` });
      assert.deepStrictEqual(session.json.payment, { prepayOnly: expected });
    } finally {
      await s.close();
    }
  });
}

// ---------- The server's messages and emails (src/notify.js) ----------
const realFetch = global.fetch;
let sent = [];
const ENV = {
  BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', BREVO_API_URL: 'http://brevo.invalid/v3/smtp/email', MAIL_FROM_NAME: '',
  ADMIN_EMAIL: 'admin@example.test', ADMIN_LANG: 'ar', CALLMEBOT_PHONE: '201000000000', CALLMEBOT_APIKEY: 'k', CALLMEBOT_URL: 'http://wa.invalid/whatsapp.php',
  SITE_URL: 'https://shop.example.test',
};
/** Everything a call to notify would send, as text: [{ to, subject, html, text }]. */
async function capture(fn, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries({ ...ENV, ...env })) { saved[k] = process.env[k]; process.env[k] = v; }
  sent = [];
  global.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('http://wa.invalid/')) sent.push({ to: 'whatsapp', text: new URL(u).searchParams.get('text') });
    else { const b = JSON.parse(init.body); sent.push({ to: b.to[0].email, subject: b.subject, html: b.htmlContent, text: b.textContent }); }
    return Promise.resolve({ ok: true, status: 200, text: async () => 'Message queued' });
  };
  try {
    await fn();
    return sent;
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const order = (over = {}) => ({
  id: '3f1d2c4b-0000-4000-8000-000000000001', number: 'POD-1001', createdAt: '2026-11-20T10:00:00Z', lang: 'ar', linkKey: 'k'.repeat(32),
  customer: { name: 'Mona', phone: '01012345678', email: 'mona@example.test', governorate: 'cairo', city: 'Nasr City', address: '1 St' },
  items: [{ id: 'i1', productName: { en: 'Mug', ar: 'مج' }, color: { name: { en: 'White', ar: 'أبيض' } }, size: { label: { en: '11 oz', ar: '11 أونصة' } }, sides: [{ id: 'front', name: { en: 'Front', ar: 'الأمام' } }], price: 350, copies: 1 }],
  subtotal: 350, shipping: 75, total: 425, payment: { method: 'cod', status: 'pending' },
  delivery: { speed: 'standard', days: 5, by: '2026-11-30' },
  shipment: { courier: 'Bosta', trackingNumber: 'BST-1', trackingUrl: '', eta: '2026-11-30', shippedAt: '2026-11-26T09:00:00Z' },
  ...over,
});
const flat = (list) => list.map((m) => [m.subject, m.html, m.text].filter(Boolean).join('\n')).join('\n----\n');

test('messages, switch off: word for word as without the switch, cash on delivery as today', async () => {
  for (const [lang, adminLang] of [['ar', 'ar'], ['en', 'en']]) {
    const env = { ADMIN_LANG: adminLang };
    const before = await capture(() => notify.orderPlaced(order({ lang }), { origin: 'https://shop.example.test', lang }), env);
    const off = await capture(() => notify.orderPlaced(order({ lang }), { origin: 'https://shop.example.test', lang, prepayOnly: false }), env);
    assert.deepStrictEqual(off, before, `${lang}: the default is off`);
    const shippedBefore = await capture(() => notify.orderShipped(order({ lang }), { siteUrl: 'https://shop.example.test' }), env);
    const shippedOff = await capture(() => notify.orderShipped(order({ lang }), { siteUrl: 'https://shop.example.test', prepayOnly: false }), env);
    assert.deepStrictEqual(shippedOff, shippedBefore);
    const all = flat([...off, ...shippedOff]);
    if (lang === 'ar') {
      assert.match(off.find((m) => m.to === 'whatsapp').text, /\(الدفع عند الاستلام\)/);
      assert.match(off.find((m) => m.to === 'mona@example.test').text, /الإجمالي \(الدفع عند الاستلام\): /);
      assert.match(shippedOff[0].text, /طلبك اتشحن وفي الطريق ليك! جهّز المبلغ للمندوب عند الاستلام\./);
      assert.match(shippedOff[0].text, /الإجمالي \(الدفع عند الاستلام\): /);
    } else {
      assert.match(off.find((m) => m.to === 'whatsapp').text, /\(Cash on delivery\)/);
      assert.match(off.find((m) => m.to === 'mona@example.test').text, /Total \(Cash on delivery\): /);
      assert.match(shippedOff[0].text, /Please have the amount ready for the courier on delivery\./);
    }
    assert.ok(codIn(all));
  }
});

test('messages, switch on: payment in advance, nothing to pay the courier, no promise of cash on delivery', async () => {
  for (const lang of ['ar', 'en']) {
    const env = { ADMIN_LANG: lang };
    const placed = await capture(() => notify.orderPlaced(order({ lang }), { origin: 'https://shop.example.test', lang, prepayOnly: true }), env);
    const shipped = await capture(() => notify.orderShipped(order({ lang }), { siteUrl: 'https://shop.example.test', prepayOnly: true }), env);
    assert.strictEqual(placed.length, 3, 'admin WhatsApp, admin email, customer email');
    assert.strictEqual(shipped.length, 1);
    const all = flat([...placed, ...shipped]);
    assert.ok(!codIn(all), all);
    if (lang === 'ar') {
      assert.match(placed.find((m) => m.to === 'whatsapp').text, /\(الدفع مقدّمًا\)/);
      assert.match(placed.find((m) => m.to === 'mona@example.test').text, /الإجمالي \(الدفع مقدّمًا\): /);
      assert.match(shipped[0].text, /طلبك اتشحن وفي الطريق ليك! ومفيش حاجة تدفعها للمندوب\./);
      assert.match(shipped[0].html, /الإجمالي \(الدفع مقدّمًا\): /);
    } else {
      assert.match(placed.find((m) => m.to === 'mona@example.test').text, /Total \(Payment in advance\): /);
      assert.match(shipped[0].text, /There is nothing to pay the courier\./);
    }
    // Paid: as today (no word on how).
    const paid = await capture(() => notify.orderShipped(order({ lang, payment: { method: 'cod', status: 'paid' } }), { siteUrl: 'https://shop.example.test', prepayOnly: true }), env);
    const paidOff = await capture(() => notify.orderShipped(order({ lang, payment: { method: 'cod', status: 'paid' } }), { siteUrl: 'https://shop.example.test' }), env);
    assert.deepStrictEqual(paid, paidOff);
  }
});
