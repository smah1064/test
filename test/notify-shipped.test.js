'use strict';

// The "your order has shipped" email. No real email is sent: fetch is replaced by a fake
// that records what would go to Brevo (at a fake URL).
const test = require('node:test');
const assert = require('node:assert');

const notify = require('../src/notify');

const realFetch = global.fetch;
let sent = [];
let reply = { ok: true, status: 201, body: '{"messageId":"x"}' };
function fakeFetch(url, init) {
  sent.push({ url: String(url), init, body: JSON.parse(init.body) });
  return Promise.resolve({ ok: reply.ok, status: reply.status, text: async () => reply.body });
}

const ENV = { BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', BREVO_API_URL: 'http://brevo.invalid/v3/smtp/email', SITE_URL: '' };
const saved = {};
test.beforeEach(() => {
  sent = [];
  reply = { ok: true, status: 201, body: '{"messageId":"x"}' };
  for (const [k, v] of Object.entries(ENV)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }
  global.fetch = fakeFetch;
});
test.afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const item = (over = {}) => ({
  id: 'i1', productName: { en: 'T-shirt', ar: 'تيشيرت' }, color: { name: { en: 'Black', ar: 'أسود' }, hex: '#000' },
  size: { label: { en: 'M', ar: 'M' } }, sides: [{ id: 'front', name: { en: 'Front', ar: 'أمام' } }], price: 450, status: 'shipped', ...over,
});
const order = (over = {}) => ({
  id: '3f1d2c4b-0000-4000-8000-000000000001', number: 'POD-1001', createdAt: '2026-11-20T10:00:00Z', lang: 'en',
  customer: { name: 'Mona', phone: '01012345678', email: 'mona@example.test', governorate: 'cairo', city: 'Nasr City', address: '1 St' },
  items: [item(), item({ id: 'i2', productName: { en: 'Mug', ar: 'مج' }, copies: 3, price: 600 })],
  subtotal: 1050, shipping: 60, total: 1110, payment: { method: 'cod', status: 'pending' },
  shipment: { courier: 'Bosta', trackingNumber: 'BST-778899', trackingUrl: 'https://bosta.co/tracking-shipment/?track_num=BST-778899', eta: '2026-11-26', shippedAt: '2026-11-23T09:00:00Z', deliveredAt: null },
  ...over,
});

test('sends the shipped email with the courier, tracking and links', async () => {
  const r = await notify.orderShipped(order(), { siteUrl: 'https://shop.example.test/' });
  assert.deepStrictEqual(r, { email: 'sent' });
  assert.strictEqual(sent.length, 1);
  const { url, init, body } = sent[0];
  assert.strictEqual(url, ENV.BREVO_API_URL);
  assert.strictEqual(init.headers['api-key'], 'test-key');
  assert.deepStrictEqual(body.to, [{ email: 'mona@example.test' }]);
  assert.strictEqual(body.sender.email, 'shop@example.test');
  assert.match(body.subject, /Your order POD-1001 is on its way/);
  for (const part of [body.htmlContent, body.textContent]) {
    assert.match(part, /Bosta/);
    assert.match(part, /BST-778899/);
    assert.match(part, /T-shirt · Black · M · Front/);
    assert.match(part, /Mug .*3 copies/);
    assert.match(part, /https:\/\/shop\.example\.test\/order\?id=3f1d2c4b-0000-4000-8000-000000000001/);
    assert.match(part, /https:\/\/shop\.example\.test\/invoice\?id=3f1d2c4b-0000-4000-8000-000000000001/);
    assert.match(part, /bosta\.co\/tracking-shipment/);
    assert.match(part, /Expected delivery/);
    assert.match(part, /2026/);
  }
  assert.match(body.htmlContent, /dir="ltr"/);
  assert.match(body.textContent, /Cash on delivery/);
});

test('SITE_URL wins over the passed siteUrl, and works without a shipment', async () => {
  process.env.SITE_URL = 'https://ebda3.example.test';
  const r = await notify.orderShipped(order({ shipment: null }), { siteUrl: 'http://localhost:3000' });
  assert.strictEqual(r.email, 'sent');
  const { body } = sent[0];
  assert.match(body.textContent, /https:\/\/ebda3\.example\.test\/order\?id=/);
  assert.doesNotMatch(body.textContent, /localhost/);
  assert.doesNotMatch(body.textContent, /Tracking number|Courier/);
});

test('skips customers without an email, and when email is not set up', async () => {
  const noEmail = order();
  delete noEmail.customer.email;
  assert.deepStrictEqual(await notify.orderShipped(noEmail, { siteUrl: 'https://x.test' }), { email: 'skipped', reason: 'noEmail' });
  assert.deepStrictEqual(await notify.orderShipped(order({ customer: { name: 'A', email: '  ' } })), { email: 'skipped', reason: 'noEmail' });
  process.env.BREVO_API_KEY = '';
  assert.deepStrictEqual(await notify.orderShipped(order()), { email: 'skipped', reason: 'emailOff' });
  assert.strictEqual(sent.length, 0);
});

test('Arabic orders get the Arabic email', async () => {
  const r = await notify.orderShipped(order({ lang: 'ar', payment: { method: 'cod', status: 'paid' } }), { siteUrl: 'https://shop.example.test' });
  assert.strictEqual(r.email, 'sent');
  const { body } = sent[0];
  assert.match(body.subject, /طلبك POD-1001 في الطريق ليك/);
  assert.match(body.htmlContent, /dir="rtl"/);
  assert.match(body.htmlContent, /lang="ar"/);
  assert.match(body.textContent, /أهلًا Mona/);
  assert.match(body.textContent, /تيشيرت · أسود · M · أمام/);
  assert.match(body.textContent, /شركة الشحن: Bosta/);
  assert.match(body.textContent, /رقم التتبع: BST-778899/);
  assert.match(body.textContent, /الاستلام المتوقع/);
  assert.match(body.htmlContent, /الفاتورة/);
  // Paid already: no "cash on delivery" reminder.
  assert.doesNotMatch(body.textContent, /الدفع عند الاستلام/);
});

test('escapes customer and admin text in the HTML, and ignores unsafe tracking links', async () => {
  const evil = '<script>alert(1)</script>';
  await notify.orderShipped(order({
    number: 'POD-1<b>',
    customer: { name: `Eve ${evil}`, email: 'eve@example.test' },
    items: [item({ productName: { en: `Cap "${evil}"`, ar: 'كاب' } })],
    shipment: { courier: `Bad & <img src=x onerror=alert(1)>`, trackingNumber: `"><svg onload=alert(1)>`, trackingUrl: 'javascript:alert(1)', eta: null },
  }), { siteUrl: 'https://shop.example.test' });
  const html = sent[0].body.htmlContent;
  assert.doesNotMatch(html, /<script>|<img src=x|<svg onload|<b>|javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Bad &amp; &lt;img/);
  assert.match(html, /&quot;&gt;&lt;svg/);
  assert.match(html, /POD-1&lt;b&gt;/);
});

test('reports a failed send without throwing', async () => {
  reply = { ok: false, status: 401, body: '{"message":"Key not found"}' };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await notify.orderShipped(order(), { siteUrl: 'https://x.test' });
    assert.strictEqual(r.email, 'failed');
    assert.match(r.error, /Brevo 401/);
    global.fetch = () => Promise.reject(new Error('network down'));
    assert.strictEqual((await notify.orderShipped(order())).email, 'failed');
    assert.strictEqual((await notify.orderShipped(null)).email, 'skipped');
  } finally {
    console.warn = warn;
  }
});
