'use strict';

// Paying in advance only, from launch (src/payment-wording.js; wording prepared with the owner's OK, 26 Nov, kept
// off until the owner says so). The shop both ways, on a phone, in Arabic and English: switched off, the home
// page, a ready design, the cart, an order, its invoice and the photos page say cash on delivery as today;
// switched on, nothing on them promises cash on delivery and the new words are there.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer } = require('./helpers');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
/** A promise of cash on delivery ("الاستلام المتوقع", the day it is expected, is a date, not a promise). */
const COD = /الاستلام|عند استلام|كاش|cash on delivery|on delivery|in cash/i;
const codOn = (text) => COD.exec(text.replace(/الاستلام المتوقع/g, ''));

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
const post = (base, url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** A finished mug design (as the editor makes it). */
async function mugDesign(base) {
  const r = await (await post(base, '/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of r.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
    await fetch(`${base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
  }
  return (await fetch(`${base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } })).json();
}
const cartEntry = (d) => ({ designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() });
/** A local test order (approved proofs), as the order-key test places one. */
async function placeOrder(base) {
  const d = await mugDesign(base);
  const q = await (await post(base, '/api/cart/quote', { designIds: [d.id] })).json();
  const proofHash = (await (await fetch(`${base}/api/designs/${d.id}/proof`)).json()).proofHash;
  const o = await post(base, '/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash } } });
  assert.strictEqual(o.status, 201, await o.clone().text());
  return o.json();
}

async function phone(browser, lang) {
  const { devices } = loadPlaywright();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}
/** Every word of the page, shown or not (closed FAQ answers too), and its WhatsApp text where it has one. */
const pageText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('script, style, noscript, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  while (walk.nextNode()) out.push(walk.currentNode.nodeValue);
  return out.join(' ').replace(/\s+/g, ' ');
});

/** The pages to check: where to go, what to wait for. */
function pages(srv, order, designId) {
  return [
    { name: 'home', url: '/', ready: () => document.querySelectorAll('#product-grid > *').length > 0 && Boolean(document.querySelector('[data-i18n="hm.b3.title"]').textContent) },
    { name: 'design', url: `/design?id=${encodeURIComponent(designId)}`, ready: () => !document.getElementById('dp-spin') || document.getElementById('dp-spin').hidden },
    { name: 'cart', url: '/cart', ready: () => Boolean(document.querySelector('[data-approve]')) && Boolean(document.querySelector('[data-i18n="checkout.cod"]').textContent) },
    { name: 'order', url: `/order?id=${order.id}&k=${order.key}`, ready: () => Boolean(document.querySelector('.pay-box')) },
    { name: 'invoice', url: `/invoice?id=${order.id}&k=${order.key}`, ready: () => Boolean(document.querySelector('.inv-pay-status')) },
    { name: 'photos', url: '/photos', ready: () => document.querySelectorAll('#ph-terms li').length > 0 },
  ];
}

// What each page says, switched off (today's words) and on (the new ones), by language.
const EXPECT = {
  off: {
    ar: {
      home: ['ادفع كاش عند الاستلام في أي مكان في مصر', 'الدفع عند الاستلام', 'ادفع لما الطلب يوصلك', 'الدفع عند الاستلام: بتدفع للمندوب لما الطلب يوصلك.'],
      design: ['والدفع عند الاستلام.'],
      cart: ['الدفع عند الاستلام', 'ادفع للمندوب كاش عند استلام الطلب.'],
      order: ['الدفع عند الاستلام: ', 'ادفع للمندوب كاش عند استلام الطلب.'],
      invoice: ['الدفع عند الاستلام', 'المبلغ المطلوب عند الاستلام'],
      photos: ['💵 الدفع عند الاستلام متاح'],
    },
    en: {
      home: ['Pay cash on delivery anywhere in Egypt', 'Cash on delivery', 'Pay when your order arrives', 'Cash on delivery: you pay the courier when your order arrives.'],
      design: ['Cash on delivery.'],
      cart: ['Cash on delivery', 'Pay the courier in cash when your order arrives.'],
      order: ['Cash on delivery: ', 'Pay the courier in cash when your order arrives.'],
      invoice: ['Cash on delivery', 'Amount due on delivery'],
      photos: ['💵 Cash on delivery available'],
    },
  },
  on: {
    ar: {
      home: ['بنوصّل لأي مكان في مصر', 'الدفع مقدّمًا', 'ادفع وانت بتطلب، ومفيش حاجة للمندوب', 'بتدفع مقدّمًا وانت بتطلب، ومفيش حاجة تدفعها للمندوب لما الطلب يوصلك.'],
      design: ['والدفع مقدّمًا وقت الطلب.'],
      cart: ['الدفع مقدّمًا وقت الطلب', 'مفيش حاجة تدفعها للمندوب لما الطلب يوصلك.'],
      order: ['الدفع مقدّمًا: ', 'مفيش حاجة تدفعها للمندوب لما الطلب يوصلك.'],
      invoice: ['الدفع مقدّمًا', 'المبلغ المطلوب'],
      photos: ['🧾 الدفع مقدّمًا وقت الطلب'],
    },
    en: {
      home: ['Delivered anywhere in Egypt.', 'Pay in advance', 'Pay when you order, nothing to pay the courier', 'You pay in advance when you order'],
      design: ['Pay when you order.'],
      cart: ['Pay when you order', 'Nothing to pay the courier when your order arrives.'],
      order: ['Payment in advance: ', 'Nothing to pay the courier when your order arrives.'],
      invoice: ['Payment in advance', 'Amount due'],
      photos: ['🧾 Pay in advance, when you order'],
    },
  },
};
const WA = { off: { ar: '(الدفع عند الاستلام)', en: '(cash on delivery)' }, on: { ar: '(الدفع مقدّمًا)', en: '(payment in advance)' } };

for (const prepayOnly of [false, true]) {
  const mode = prepayOnly ? 'on' : 'off';
  test(`prepay switch ${mode}: home, ready design, cart, order, invoice and photos (phone, Arabic and English)`, { timeout: 240000 }, async () => {
    const srv = await startServer(prepayOnly ? { prepayOnly: true } : {});
    const browser = await loadPlaywright().chromium.launch();
    try {
      const order = await placeOrder(srv.base);
      const lib = await (await fetch(`${srv.base}/api/library`)).json();
      const designId = lib.designs[0].id;
      const entry = cartEntry(await mugDesign(srv.base));
      for (const lang of ['ar', 'en']) {
        const ctx = await phone(browser, lang);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${srv.base}/cart`);
        await page.evaluate((list) => POD.setCart(list), [entry]);
        for (const p of pages(srv, order, designId)) {
          await page.goto(srv.base + p.url, { waitUntil: 'load' });
          await page.waitForFunction(p.ready, null, { timeout: 30000 });
          assert.strictEqual(await page.evaluate(() => POD.payment.prepayOnly), prepayOnly, `${p.name}: the page knows`);
          const text = await pageText(page);
          for (const want of EXPECT[mode][lang][p.name]) assert.ok(text.includes(want), `${mode} ${lang} ${p.name}: "${want}" in ${text.slice(0, 3000)}`);
          if (prepayOnly) {
            const hit = codOn(text);
            assert.strictEqual(hit, null, `${lang} ${p.name}: promises cash on delivery ("${hit && text.slice(Math.max(0, hit.index - 60), hit.index + 60)}")`);
          } else {
            assert.ok(codOn(text), `${lang} ${p.name}: today's words`);
          }
          if (p.name === 'order') {
            // The message to the shop on WhatsApp (its button shows when the shop has a number).
            const wa = await page.evaluate((o) => POD.t('order.waMessage', { n: o.number, items: '1. mug', total: POD.money(o.total), name: o.customer.name }), order);
            assert.ok(wa.includes(WA[mode][lang]), wa);
            if (prepayOnly) assert.strictEqual(codOn(wa), null, wa);
          }
        }
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      }
    } finally {
      await browser.close();
      await srv.close();
    }
  });
}
