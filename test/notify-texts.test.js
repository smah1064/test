'use strict';

// The texts of the order messages (admin WhatsApp, admin and customer emails, the
// "shipped" email and the printing-house message) in Arabic and English: quantities,
// name lists and photo sets, Arabic counting and digits, the shop's name and delivery.
// Nothing is sent: fetch is replaced by a fake that records what would go out.
const test = require('node:test');
const assert = require('node:assert');

const notify = require('../src/notify');
const dispatch = require('../src/dispatch');

const realFetch = global.fetch;
let sent = [];
function fakeFetch(url, init) {
  const u = String(url);
  if (u.startsWith('http://wa.invalid/')) sent.push({ kind: 'whatsapp', text: new URL(u).searchParams.get('text') });
  else sent.push({ kind: 'email', body: JSON.parse(init.body) });
  return Promise.resolve({ ok: true, status: 200, text: async () => 'Message queued' });
}

const ENV = {
  BREVO_API_KEY: 'test-key', MAIL_FROM: 'shop@example.test', BREVO_API_URL: 'http://brevo.invalid/v3/smtp/email', MAIL_FROM_NAME: '',
  ADMIN_EMAIL: 'admin@example.test', ADMIN_LANG: 'ar', CALLMEBOT_PHONE: '201000000000', CALLMEBOT_APIKEY: 'k', CALLMEBOT_URL: 'http://wa.invalid/whatsapp.php',
  SITE_URL: 'https://shop.example.test',
};
const saved = {};
test.beforeEach(() => {
  sent = [];
  for (const [k, v] of Object.entries(ENV)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }
  global.fetch = fakeFetch;
});
test.afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const n = (en, ar) => ({ en, ar });
const WHITE = { name: n('White', 'أبيض') };
const BLACK = { name: n('Black', 'أسود') };
const GLOSS = { name: n('Glossy', 'لامع') };
const FRONT = [{ id: 'front', name: n('Front', 'الأمام') }];
const items = () => [
  // 30 white M + 25 black L.
  {
    id: 'a', productName: n('T-shirt', 'تيشيرت'), color: WHITE, size: { label: n('M', 'M') }, sides: FRONT, price: 24750, copies: 55,
    quantities: [{ color: WHITE, size: { label: n('M', 'M') }, qty: 30, unitPrice: 450 }, { color: BLACK, size: { label: n('L', 'L') }, qty: 25, unitPrice: 450 }],
  },
  // A name list of 40 certificates.
  { id: 'b', productName: n('Certificate', 'شهادة'), color: { name: n('White', 'أبيض') }, size: { label: n('A4', 'A4') }, sides: FRONT, price: 2000, copies: 40, merge: { count: 40, columns: ['Name'] } },
  // A photo set: 4 photos, 7 prints in 3 sizes, white border.
  {
    id: 'c', kind: 'photoset', productName: n('Photo Prints', 'طباعة الصور'), color: GLOSS, size: { label: n('4 photos · 7 prints', '4 صور · 7 نسخ') },
    sides: [{ id: 'front', name: n('Photos', 'الصور') }], price: 170, copies: 7,
    photos: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], options: { border: { id: 'white', name: n('White border', 'إطار أبيض') } },
    quantities: [
      { color: GLOSS, size: { label: n('10 × 15 cm', '10 × 15 سم') }, qty: 5, unitPrice: 15 },
      { color: GLOSS, size: { label: n('13 × 18 cm', '13 × 18 سم') }, qty: 1, unitPrice: 25 },
      { color: GLOSS, size: { label: n('20 × 30 cm', '20 × 30 سم') }, qty: 1, unitPrice: 70 },
    ],
  },
  // A mug, 11 copies.
  { id: 'd', productName: n('Mug', 'مج'), color: { name: n('White', 'أبيض') }, size: { label: n('11 oz', '11 أونصة') }, sides: [{ id: 'mug1', name: n('Side 1', 'جهة 1') }], price: 1100, copies: 11 },
];
const order = (over = {}) => ({
  id: 'o-1', number: 'POD-2001', lang: 'ar',
  customer: { name: 'منى <b>', phone: '01012345678', email: 'mona@example.test', governorate: 'cairo', city: 'مدينة نصر', address: '1 شارع', notes: 'Ring <twice>' },
  items: items(), subtotal: 28020, shipping: 100, total: 28120, payment: { method: 'cod', status: 'pending' },
  delivery: { speed: 'express', days: 2, by: '2026-11-26' },
  shipment: { courier: 'Bosta', trackingNumber: 'BST-1', trackingUrl: '', eta: '2026-11-26' },
  ...over,
});

const LATIN_COUNTS = /\d+ (منتج|نسخ|قطع|أيام|يوم|اسم)|×\d|^\d+\./m;

test('Arabic order messages: quantities, names, photo sets, Arabic digits and the shop name', async () => {
  await notify.orderPlaced(order(), { origin: 'https://shop.example.test', lang: 'ar' });
  const wa = sent.find((s) => s.kind === 'whatsapp').text;
  const [toAdmin, toCustomer] = ['admin@example.test', 'mona@example.test'].map((to) => sent.find((s) => s.kind === 'email' && s.body.to[0].email === to).body);

  assert.match(toCustomer.subject, /^تم استلام طلبك POD-2001 · إبداع$/);
  assert.match(wa, /٤ منتجات · الإجمالي/);
  assert.match(wa, /⚡ توصيل سريع: خلال يومين عمل/);
  for (const text of [wa, toAdmin.textContent, toCustomer.textContent, toAdmin.htmlContent, toCustomer.htmlContent]) {
    assert.match(text, /تيشيرت · ٥٥ قطعة \(أبيض · M ×٣٠، أسود · L ×٢٥\) · الأمام/);
    assert.match(text, /شهادة · أبيض · A4 · الأمام · قائمة أسماء: ٤٠ اسم/);
    assert.match(text, /طباعة الصور · لامع · ٤ صور · ٧ نسخ \(١٠ × ١٥ سم ×٥، ١٣ × ١٨ سم ×١، ٢٠ × ٣٠ سم ×١\) · إطار أبيض/);
    assert.match(text, /مج · أبيض · ١١ أونصة · جهة ١ · ١١ نسخة/);
    assert.match(text, /⚡ توصيل سريع خلال يومين عمل \(حتى /);
    assert.doesNotMatch(text, /ebda3/);
    assert.doesNotMatch(text, LATIN_COUNTS);
  }
  for (const mail of [toAdmin, toCustomer]) {
    assert.match(mail.textContent, /^١\. تيشيرت/m);
    assert.match(mail.textContent, /^٤\. مج/m);
    assert.match(mail.htmlContent, />إبداع</);
    assert.match(mail.htmlContent, /٣\. طباعة الصور/);
  }
  // Customer text stays escaped in the HTML.
  assert.match(toAdmin.htmlContent, /Ring &lt;twice&gt;/);
  assert.match(toCustomer.htmlContent, /منى &lt;b&gt;/);
  assert.doesNotMatch(toCustomer.htmlContent, /<b>/);
});

test('English order messages keep Latin digits and the English name', async () => {
  process.env.ADMIN_LANG = 'en';
  await notify.orderPlaced(order({ delivery: { speed: 'standard', days: 5, by: '2026-11-30' } }), { origin: '', lang: 'en' });
  const wa = sent.find((s) => s.kind === 'whatsapp').text;
  const mails = sent.filter((s) => s.kind === 'email').map((s) => s.body);
  assert.strictEqual(mails.length, 2);
  assert.match(mails.find((m) => m.to[0].email === 'mona@example.test').subject, /We received your order POD-2001 · ebda3/);
  assert.match(wa, /4 items · Total/);
  for (const text of [wa, ...mails.flatMap((m) => [m.textContent, m.htmlContent])]) {
    assert.match(text, /T-shirt · 55 pieces \(White · M ×30, Black · L ×25\) · Front/);
    assert.match(text, /Certificate · White · A4 · Front · Name list: 40 names/);
    assert.match(text, /Photo Prints · Glossy · 4 photos · 7 copies \(10 × 15 cm ×5, 13 × 18 cm ×1, 20 × 30 cm ×1\) · White border/);
    assert.match(text, /Mug · White · 11 oz · Side 1 · 11 copies/);
    assert.match(text, /Standard delivery within 5 business days \(by /);
    assert.doesNotMatch(text, /[٠-٩]/);
  }
  for (const m of mails) {
    assert.match(m.textContent, /^1\. T-shirt/m);
    assert.match(m.htmlContent, />ebda3</);
  }
});

test('Arabic standard delivery uses Arabic digits and counting', async () => {
  await notify.orderPlaced(order({ delivery: { speed: 'standard', days: 5, by: '2026-11-30' } }), { lang: 'ar' });
  const wa = sent.find((s) => s.kind === 'whatsapp').text;
  assert.match(wa, /توصيل عادي خلال ٥ أيام عمل \(حتى /);
  sent = [];
  await notify.orderPlaced(order({ items: items().slice(0, 1), delivery: { speed: 'standard', days: 12, by: '2026-12-08' } }), { lang: 'ar' });
  const one = sent.find((s) => s.kind === 'whatsapp').text;
  assert.match(one, /منتج واحد · الإجمالي/);
  assert.match(one, /توصيل عادي خلال ١٢ يوم عمل/);
});

test('the shipped email shows quantities, names and photo sets in both languages', async () => {
  await notify.orderShipped(order(), {});
  const ar = sent[0].body;
  assert.match(ar.subject, /^طلبك POD-2001 في الطريق ليك · إبداع$/);
  for (const text of [ar.textContent, ar.htmlContent]) {
    assert.match(text, /١\. تيشيرت · ٥٥ قطعة \(أبيض · M ×٣٠، أسود · L ×٢٥\)/);
    assert.match(text, /٢\. شهادة · أبيض · A4 · الأمام · قائمة أسماء: ٤٠ اسم/);
    assert.match(text, /٣\. طباعة الصور · لامع · ٤ صور · ٧ نسخ/);
    assert.match(text, /١١ نسخة/);
    assert.doesNotMatch(text, /ebda3/);
    assert.doesNotMatch(text, LATIN_COUNTS);
  }
  sent = [];
  await notify.orderShipped(order({ lang: 'en' }), {});
  const en = sent[0].body;
  assert.match(en.subject, /Your order POD-2001 is on its way · ebda3/);
  assert.match(en.textContent, /1\. T-shirt · 55 pieces \(White · M ×30, Black · L ×25\) · Front/);
  assert.match(en.textContent, /Name list: 40 names/);
  assert.match(en.textContent, /4 photos · 7 copies/);
});

test('printing-house messages: Arabic name, digits and سم', () => {
  const o = order();
  const design = { sides: [{ name: n('Front', 'الأمام'), widthIn: 10, heightIn: 12, offsetCm: { y: 3, x: -1.5 } }] };
  const args = { house: { name: 'مطبعة' }, order: o, item: { ...o.items[0], process: 'dtf', position: 1 }, design, files: [], expires: '2026-12-24T00:00:00Z' };
  const ar = dispatch.whatsappText({ ...args, lang: 'ar' });
  assert.match(ar, /لـ إبداع:/);
  assert.match(ar, /POD-2001 \(١\/٤\)/);
  assert.match(ar, /أبيض، M ×٣٠؛ أسود، L ×٢٥/);
  assert.match(ar, /\*الكمية:\* ٥٥/);
  assert.match(ar, /الأمام ٢٥٫٤ × ٣٠٫٥ سم \(متحرك ٣ سم لتحت و١٫٥ سم شمال/);
  assert.match(ar, /روابط التحميل شغالة لحد الخميس، ٢٤ ديسمبر\./);
  assert.doesNotMatch(ar.replace('POD-2001', ''), /ebda3|\bcm\b|\d/); // the order number is an id
  const mail = dispatch.emailBody({ ...args, lang: 'ar', attached: false });
  assert.match(mail.text, /لـ إبداع:/);
  assert.match(mail.html, /٢٥٫٤ × ٣٠٫٥ سم/);
  const en = dispatch.whatsappText({ ...args, lang: 'en' });
  assert.match(en, /for ebda3:/);
  assert.match(en, /POD-2001 \(1\/4\)/);
  assert.match(en, /Front 25\.4 × 30\.5 cm \(moved 3 cm lower, 1\.5 cm left/);
  assert.match(en, /\*Quantity:\* 55/);
});

test('order messages count packs in copies: 1 × 200 + 1 × 1000 business cards is 1,200 copies, not 2 pieces (QA 25 Nov)', async () => {
  process.env.ADMIN_LANG = 'en';
  const cards = {
    id: 'k', productId: 'bizcards', productName: n('Business Cards', 'كروت شخصية'), color: WHITE, size: { label: n('200 cards', '200 كارت') }, sides: FRONT, price: 1000, copies: 2,
    // (Older orders have no pack marks on their lines: the product says.)
    quantities: [{ color: WHITE, size: { id: '200', label: n('200 cards', '200 كارت') }, qty: 1, unitPrice: 250 }, { color: WHITE, size: { id: '1000', label: n('1000 cards', '1000 كارت') }, qty: 1, unitPrice: 600 }],
  };
  await notify.orderPlaced(order({ items: [cards] }), { origin: '', lang: 'en' });
  const wa = sent.find((s) => s.kind === 'whatsapp').text;
  assert.match(wa, /Business Cards · White · 1200 copies \(200 cards ×1, 1000 cards ×1\)/);
  assert.doesNotMatch(wa, /2 pieces/);
});

test('the plain-text order email has the same sums as the HTML one (they add up to the total)', async () => {
  process.env.ADMIN_LANG = 'en';
  await notify.orderPlaced(order({ lang: 'en', discount: 100, coupon: { code: 'EID20' } }), { origin: '', lang: 'en' });
  const mail = sent.find((s) => s.kind === 'email' && s.body.to[0].email === 'mona@example.test').body;
  assert.match(mail.textContent, /Subtotal: EGP 28,020|Items: EGP 28,020|28,020/);
  assert.match(mail.textContent, /EID20\): -\S*EGP\s100/);
  assert.match(mail.textContent, /Shipping \(.*\): \S*EGP\s100/);
});
