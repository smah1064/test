'use strict';

// QA fixes in the messages, the invoice and EPS artwork:
// - the printing-house message and the order notifications use one digit style per language:
//   Arabic size labels ("30 × 40 سم") show ١٢٣ like the counts next to them, codes (2XL, A4) stay;
// - the invoice keeps the customer's name (and city) on the column's side, whatever its script;
// - an EPS file without a %%EndComments line is drawn at full size (it was drawn at 72 dpi, so the
//   editor showed a false "low resolution" warning).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createApp } = require('../src/app');
const notify = require('../src/notify');
const dispatch = require('../src/dispatch');

const n = (en, ar) => ({ en, ar });
const WHITE = { name: n('White', 'أبيض') };
const BLACK = { name: n('Black', 'أسود') };
const FRONT = [{ id: 'front', name: n('Front', 'الأمام') }];
const POSTER = {
  id: 'p', productName: n('Poster', 'بوستر'), color: WHITE, size: { label: n('30 × 40 cm', '30 × 40 سم') }, sides: FRONT, price: 900, copies: 3,
  quantities: [
    { color: WHITE, size: { label: n('30 × 40 cm', '30 × 40 سم') }, qty: 2, unitPrice: 300 },
    { color: WHITE, size: { label: n('A2 (42 × 59.4 cm)', 'A2 (42 × 59.4 سم)') }, qty: 1, unitPrice: 300 },
  ],
};
const SHIRT = { id: 's', productName: n('Hoodie', 'هودي'), color: BLACK, size: { label: n('2XL', '2XL') }, sides: FRONT, price: 500, copies: 1 };
const MUG = { id: 'm', productName: n('Mug', 'مج'), color: WHITE, size: { label: n('11 oz (325 ml)', '325 مل') }, sides: [{ id: 'mug1', name: n('Side 1', 'جهة 1') }], price: 300, copies: 1 };
const order = (over = {}) => ({
  id: 'o-1', number: 'POD-3001', lang: 'ar',
  customer: { name: 'منى', phone: '01012345678', email: 'mona@example.test', governorate: 'cairo', city: 'مدينة نصر', address: 'شارع' },
  items: [POSTER, SHIRT, MUG], subtotal: 1700, shipping: 0, total: 1700, payment: { method: 'cod', status: 'pending' },
  shipment: { courier: 'Bosta' },
  ...over,
});
/** Latin digits that are not part of an id (POD-3001) or a code (2XL, A2). */
const latinDigits = (text) => text.replace(/POD-3001|2XL|A2\b/g, '').match(/\d+/g);

test('printing-house message: the size label uses the message\'s digits', () => {
  const o = order();
  const args = { house: { name: 'مطبعة' }, order: o, design: { sides: [] }, files: [], expires: '2026-12-24T00:00:00Z' };
  for (const item of [{ ...POSTER, process: 'paper', position: 1 }, { ...POSTER, quantities: null, process: 'paper', position: 1 }, { ...SHIRT, process: 'dtf', position: 2 }]) {
    const wa = dispatch.whatsappText({ ...args, item, lang: 'ar' });
    const mail = dispatch.emailBody({ ...args, item, lang: 'ar', attached: false });
    for (const text of [wa, mail.text, mail.html.replace(/<[^>]+>/g, ' '), mail.subject]) assert.strictEqual(latinDigits(text), null, text);
  }
  const wa = dispatch.whatsappText({ ...args, item: { ...POSTER, process: 'paper', position: 1 }, lang: 'ar' });
  assert.match(wa, /\*اللون \/ المقاس:\* أبيض، ٣٠ × ٤٠ سم ×٢؛ أبيض، A2 \(٤٢ × ٥٩٫٤ سم\) ×١/);
  assert.match(dispatch.whatsappText({ ...args, item: { ...SHIRT, process: 'dtf', position: 2 }, lang: 'ar' }), /أسود، 2XL/);
  const one = dispatch.whatsappText({ ...args, item: { ...POSTER, quantities: null, process: 'paper', position: 1 }, lang: 'ar' });
  assert.match(one, /\*اللون \/ المقاس:\* أبيض، ٣٠ × ٤٠ سم\n/);
  // English keeps Latin digits.
  const en = dispatch.whatsappText({ ...args, item: { ...POSTER, process: 'paper', position: 1 }, lang: 'en' });
  assert.match(en, /\*Colour \/ size:\* White · 30 × 40 cm ×2, White · A2 \(42 × 59\.4 cm\) ×1/);
  assert.doesNotMatch(en, /[٠-٩]/);
});

test('order notifications: size labels, print areas and products in the message\'s digits', async () => {
  const realFetch = global.fetch;
  const ENV = {
    BREVO_API_KEY: 'k', MAIL_FROM: 'shop@example.test', BREVO_API_URL: 'http://brevo.invalid/v3/smtp/email', ADMIN_EMAIL: 'admin@example.test',
    ADMIN_LANG: 'ar', CALLMEBOT_PHONE: '201000000000', CALLMEBOT_APIKEY: 'k', CALLMEBOT_URL: 'http://wa.invalid/whatsapp.php', SITE_URL: 'https://shop.example.test',
  };
  const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  let sent = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    sent.push(u.startsWith('http://wa.invalid/') ? { text: new URL(u).searchParams.get('text') } : JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => 'Message queued' };
  };
  Object.assign(process.env, ENV);
  try {
    await notify.orderPlaced(order(), { origin: '', lang: 'ar' });
    await notify.orderShipped(order(), {});
    await notify.proofMessage(order(), { productName: n('Set of 4 coasters', 'طقم 4 قطع') }, { kind: 'proof', link: 'https://shop.example.test/proof' });
    assert.strictEqual(sent.length, 5);
    const texts = sent.flatMap((s) => (s.text ? [s.text] : [s.subject, s.textContent, s.htmlContent.replace(/<[^>]+>/g, ' ')]));
    for (const text of texts) assert.strictEqual(latinDigits(text.replace(/01012345678|https:\/\/\S+/g, '')), null, text);
    const wa = sent[0].text;
    assert.match(wa, /بوستر · أبيض · ٣ قطع \(٣٠ × ٤٠ سم ×٢، A2 \(٤٢ × ٥٩٫٤ سم\) ×١\) · الأمام/);
    assert.match(wa, /هودي · أسود · 2XL · الأمام/);
    assert.match(wa, /مج · أبيض · ٣٢٥ مل · جهة ١/);
    assert.match(sent[4].subject + sent[4].textContent, /طقم ٤ قطع/);
    // The customer's own text is not touched.
    assert.match(wa, /01012345678/);
    assert.match(notify.revisionText(order(), POSTER, { admin: '' }, 'ar'), /القطعة ١ \(بوستر\)/);

    // English: Latin digits everywhere.
    sent = [];
    process.env.ADMIN_LANG = 'en';
    await notify.orderPlaced(order({ lang: 'en' }), { origin: '', lang: 'en' });
    assert.strictEqual(sent.length, 3);
    for (const s of sent) assert.doesNotMatch(s.text || s.textContent + s.htmlContent, /[٠-٩]/);
    assert.match(sent[0].text, /Poster · White · 3 pieces \(30 × 40 cm ×2, A2 \(42 × 59\.4 cm\) ×1\) · Front/);
    assert.match(sent[0].text, /Mug · White · 11 oz \(325 ml\) · Side 1/);
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

/** Renders invoice.js for an order (as test/checkout-qa.test.js does) and returns the invoice's HTML. */
async function invoiceHtml(ord, lang) {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  const window = { POD_STRINGS: {} };
  vm.runInNewContext(read('js/i18n.js'), { window });
  vm.runInNewContext(read('js/i18n-invoice.js'), { window });
  const strings = window.POD_STRINGS;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const POD = {
    lang,
    t: (key, params) => (strings[key] ? strings[key][lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? params[k] : '')) : key),
    tr: (v) => (v && typeof v === 'object' ? v[lang] || v.en || '' : v == null ? '' : String(v)),
    esc, money: (x) => `EGP ${x}`, num: (x) => String(x), orderNo: (x) => String(x).replace(/^POD-/i, ""), api: async () => ord,
    orderKey: (id, k) => k || '', orderHeaders: (k) => (k ? { 'x-order-key': k } : {}), orderPath: (p, id, k) => `/${p}?id=${encodeURIComponent(id)}${k ? `&k=${k}` : ''}`,
    // (Cash on delivery, as during the preview: src/payment-wording.js.)
    payment: { prepayOnly: false, set() {} },
  };
  const el = () => ({ innerHTML: '', hidden: false, href: '', addEventListener() {} });
  const els = { content: el(), 'inv-actions': el(), 'inv-back': el(), 'inv-print': el() };
  const document = { title: '', getElementById: (id) => els[id], querySelector: () => ({}), createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} };
  vm.runInNewContext(read('js/invoice.js'), { POD, document, location: { search: '?id=' + ord.id }, URLSearchParams, window: { print() {} } });
  await new Promise((r) => setImmediate(r));
  return els.content.innerHTML;
}

test('invoice: the customer\'s name and city are isolated, not given their own direction', async () => {
  const base = { id: '11111111-1111-4111-8111-111111111111', number: 'POD-3001', createdAt: '2026-11-20T10:00:00Z', items: [], subtotal: 0, shipping: 0, total: 0, payment: { method: 'cod', status: 'pending' } };
  for (const lang of ['ar', 'en']) {
    for (const customer of [{ name: 'John <Smith>', city: 'Nasr City', governorate: n('Cairo', 'القاهرة') }, { name: 'منى أحمد', city: 'الدقي', governorate: n('Giza', 'الجيزة') }]) {
      const html = await invoiceHtml({ ...base, customer }, lang);
      const who = /<p class="who"[^>]*>(.*?)<\/p>/.exec(html);
      assert.ok(who, html);
      assert.doesNotMatch(who[0], /dir=/, 'the paragraph keeps the column\'s direction and alignment');
      assert.strictEqual(who[1], `<bdi>${customer.name.replace('<', '&#60;').replace('>', '&#62;')}</bdi>`);
      const comma = lang === 'ar' ? '، ' : ', ';
      assert.ok(html.includes(`<p><bdi>${customer.city}</bdi>${comma}${customer.governorate[lang]}</p>`), html);
    }
  }
});

test('EPS without %%EndComments is drawn at full size, like one with it', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa-msg-'));
  const app = createApp({ dataDir, adminPassword: 'pw', cleanupEvery: 0, requireApproval: false, limits: { artwork: [{ max: 1e6, ms: 1000 }] } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const sharp = require('sharp');
  const size = async (eps) => {
    const r = await fetch(base + '/api/artwork', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': '800' }, body: Buffer.from(eps) });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    return [m.width, m.height];
  };
  // A red circle of 80 pt on a 200 x 100 pt artwork: the circle itself gets the 800 px (it was 320 px:
  // the artwork's box fitted into 800 px).
  const draw = '1 0 0 setrgbcolor newpath 100 50 40 0 360 arc fill\nshowpage\n%%EOF\n';
  try {
    const withEnd = await size(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n%%EndComments\n${draw}`);
    assert.ok(withEnd[0] >= 790 && withEnd[0] <= 800 && Math.abs(withEnd[0] - withEnd[1]) <= 2, `with %%EndComments: ${withEnd}`);
    const cases = {
      'no %%EndComments': `%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: tiny\n%%Pages: 1\n%%BoundingBox: 0 0 200 100\n${draw}`,
      'no %%EndComments, Windows line ends': `%!PS-Adobe-3.0 EPSF-3.0\r\n%%BoundingBox: 0 0 200 100\r\n${draw.replace(/\n/g, '\r\n')}`,
      'only a %%HiResBoundingBox': `%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 200.0 100.0\n${draw}`,
      'the box after a blank line, then a prolog': `%!PS-Adobe-3.0 EPSF-3.0\n%%Title: x\n\n%%BoundingBox: 0 0 200 100\n%%BeginProlog\n%%EndProlog\n${draw}`,
      // Off the page's corner: drawn at 72 dpi it was cut off by the 800 x 800 page.
      'a box far from 0 0': `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 900 900 1100 1000\n1 0 0 setrgbcolor newpath 1000 950 40 0 360 arc fill\nshowpage\n%%EOF\n`,
      '(atend), the box in the trailer': `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: (atend)\n%%EndComments\n1 0 0 setrgbcolor newpath 100 50 40 0 360 arc fill\nshowpage\n%%Trailer\n%%BoundingBox: 0 0 200 100\n%%EOF\n`,
    };
    for (const [name, eps] of Object.entries(cases)) assert.deepStrictEqual(await size(eps), withEnd, name);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
