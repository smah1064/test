'use strict';

// Paying in advance only, from launch (src/payment-wording.js; wording prepared with the owner's OK, 26 Nov, kept
// off until the owner says so). The shop both ways, on a phone, in Arabic and English: switched off, the home
// page, a ready design, the cart, an order, its invoice and the photos page say cash on delivery as today, with no
// word of the money-back guarantee and no way to its page; switched on, nothing on them promises cash on delivery,
// the new words are there, the guarantee is on the home page, a ready design, the editor, checkout and the order
// page (with its own page), the ways to pay are named, and the order page's payment box is calm, not red.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, startServer } = require('./helpers');

/** Where the switched-on screenshots go (phone, Arabic), when SHOTS_DIR is set. */
const SHOTS = process.env.SHOTS_DIR || '';

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
/**
 * A promise of cash on delivery ("الاستلام المتوقع", the day it is expected, is a date, not a promise; "فودافون كاش",
 * Vodafone Cash, is a way to pay in advance).
 */
const COD = /الاستلام|عند استلام|كاش|cash on delivery|on delivery|in cash/i;
const codOn = (text) => COD.exec(text.replace(/الاستلام المتوقع|فودافون كاش/g, ''));
/** Any word of the money-back guarantee, or a way to pay in advance (only while switched on). */
const GUAR = /ضمان|استرجاع|guarantee|money back|money-back|instapay|إنستاباي|vodafone|فودافون/i;

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
    { name: 'cart', url: '/cart', ready: () => Boolean(document.querySelector('#proof-ok:not([hidden])')) && Boolean(document.querySelector('[data-i18n="checkout.cod"]').textContent) },
    { name: 'order', url: `/order?id=${order.id}&k=${order.key}`, ready: () => Boolean(document.querySelector('.pay-box')) },
    { name: 'invoice', url: `/invoice?id=${order.id}&k=${order.key}`, ready: () => Boolean(document.querySelector('.inv-pay-status')) },
    { name: 'photos', url: '/photos', ready: () => document.querySelectorAll('#ph-terms li').length > 0 },
    { name: 'editor', url: '/editor?product=mug', ready: () => Boolean(window.__editor && window.__editor.st && window.__editor.st.product) },
  ];
}

// What each page says, switched off (today's words) and on (the new ones), by language.
const EXPECT = {
  off: {
    ar: {
      home: ['ادفع كاش عند الاستلام في أي مكان في مصر', 'الدفع عند الاستلام', 'ادفع لما الطلب يوصلك', 'الدفع عند الاستلام: بتدفع للمندوب لما الطلب يوصلك.'],
      editor: [],
      design: ['والدفع عند الاستلام.'],
      cart: ['الدفع عند الاستلام', 'ادفع للمندوب كاش عند استلام الطلب.'],
      order: ['الدفع عند الاستلام: ', 'ادفع للمندوب كاش عند استلام الطلب.'],
      invoice: ['الدفع عند الاستلام', 'المبلغ المطلوب عند الاستلام'],
      photos: ['💵 الدفع عند الاستلام متاح'],
    },
    en: {
      home: ['Pay cash on delivery anywhere in Egypt', 'Cash on delivery', 'Pay when your order arrives', 'Cash on delivery: you pay the courier when your order arrives.'],
      editor: [],
      design: ['Cash on delivery.'],
      cart: ['Cash on delivery', 'Pay the courier in cash when your order arrives.'],
      order: ['Cash on delivery: ', 'Pay the courier in cash when your order arrives.'],
      invoice: ['Cash on delivery', 'Amount due on delivery'],
      photos: ['💵 Cash on delivery available'],
    },
  },
  on: {
    ar: {
      home: ['بنوصّل لأي مكان في مصر', 'الدفع مقدّمًا', 'ادفع وانت بتطلب، ومفيش حاجة للمندوب', 'بتدفع مقدّمًا وانت بتطلب، بالكارت أو فودافون كاش أو إنستاباي، ومفيش حاجة تدفعها للمندوب لما الطلب يوصلك.', 'ضمان استرجاع فلوسك لو المطبوع مش زي التصميم'],
      design: ['والدفع مقدّمًا وقت الطلب.', 'مضمون: لو المطبوع مش زي التصميم، نطبعهولك تاني ببلاش أو ترجعلك فلوسك.'],
      cart: ['الدفع مقدّمًا وقت الطلب', 'مفيش حاجة تدفعها للمندوب لما الطلب يوصلك.', 'ادفع بالكارت أو فودافون كاش أو إنستاباي.', 'ضمان استرجاع الفلوس', 'لو المطبوع مش زي التصميم'],
      order: ['الدفع مقدّمًا: ', 'مفيش حاجة تدفعها للمندوب لما الطلب يوصلك.', 'ضمان استرجاع الفلوس', 'على واتساب أو الإيميل خلال ٧ أيام من ما الطلب يوصلك', 'تفاصيل الضمان'],
      invoice: ['الدفع مقدّمًا', 'المبلغ المطلوب'],
      photos: ['🧾 الدفع مقدّمًا وقت الطلب: كارت أو فودافون كاش أو إنستاباي'],
      editor: ['مضمون: لو المطبوع مش زي التصميم، نطبعهولك تاني ببلاش أو ترجعلك فلوسك.'],
    },
    en: {
      home: ['Delivered anywhere in Egypt.', 'Pay in advance', 'Pay when you order, nothing to pay the courier', 'You pay in advance when you order, by card, Vodafone Cash or InstaPay', 'Money-back guarantee if the print doesn\'t match the design'],
      design: ['Pay when you order.', 'Guaranteed: if the print doesn\'t match your design, we reprint it free or give you your money back.'],
      cart: ['Pay when you order', 'Nothing to pay the courier when your order arrives.', 'Pay by card, Vodafone Cash or InstaPay.', 'Money-back guarantee', 'if the print doesn\'t match the design'],
      order: ['Payment in advance: ', 'Nothing to pay the courier when your order arrives.', 'Money-back guarantee', 'on WhatsApp or by email within 7 days of delivery', 'Guarantee details'],
      invoice: ['Payment in advance', 'Amount due'],
      photos: ['🧾 Pay in advance, when you order: card, Vodafone Cash or InstaPay'],
      editor: ['Guaranteed: if the print doesn\'t match your design, we reprint it free or give you your money back.'],
    },
  },
};
/** The guarantee's page: the owner's rules (26 Nov), in both languages. */
const GUARANTEE_PAGE = {
  ar: [
    'ضماننا: اللي شفته هو اللي هيوصلك',
    'الطباعة مش زي البروفة: الألوان مختلفة بشكل واضح، أو جزء من التصميم مقصوص، أو الطباعة مش واضحة، أو التصميم في مكان غلط.',
    'القطعة وصلت بايظة، أو وصلك حاجة غير اللي طلبتها',
    'لو غيّرت رأيك: كل قطعة بتتعمل مخصوص لشخص واحد',
    'نطبعلك القطعة تاني ببلاش، أو ترجعلك فلوسك.',
    'خلال ٧ أيام من يوم ما الطلب يوصلك.',
    'صوّر القطعة صورة واضحة.',
    'ابعتها مع رقم الطلب على واتساب أو بالإيميل',
    'مش محتاج ترجّع القطعة.',
    'بنفس الطريقة اللي دفعت بيها (كارت أو فودافون كاش أو إنستاباي)، خلال ٧ أيام.',
  ],
  en: [
    'Our guarantee: what you see is what you get',
    'The print doesn\'t match the preview: the colours are clearly off, part of the design is cut off, the print is blurry, or it\'s in the wrong place.',
    'The item arrives damaged, or it isn\'t what you ordered',
    'Changing your mind: every piece is made for one person',
    'A free reprint of the item, or your money back.',
    'Within 7 days of delivery.',
    'Take a clear photo of the item.',
    'Send it with your order number on WhatsApp or by email',
    'No need to send the item back.',
    'The same way you paid (card, Vodafone Cash or InstaPay), within 7 days.',
  ],
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
          // The way to the guarantee's page: a link only while switched on, where the page shows the guarantee.
          const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].filter((a) => /\/guarantee/.test(a.getAttribute('href'))).map((a) => ({ href: a.getAttribute('href'), shown: a.getClientRects().length > 0, text: a.textContent.trim() })));
          if (prepayOnly) {
            const hit = codOn(text);
            assert.strictEqual(hit, null, `${lang} ${p.name}: promises cash on delivery ("${hit && text.slice(Math.max(0, hit.index - 60), hit.index + 60)}")`);
            if (['home', 'design', 'cart', 'order', 'editor'].includes(p.name)) {
              assert.ok(links.length >= 1 && links.every((l) => l.href === '/guarantee' && l.shown && l.text), `${lang} ${p.name}: the guarantee, linked and shown: ${JSON.stringify(links)}`);
            }
          } else {
            if (p.name !== 'editor') assert.ok(codOn(text), `${lang} ${p.name}: today's words`);
            const hit = GUAR.exec(text);
            assert.strictEqual(hit, null, `${lang} ${p.name}: off, no guarantee or way to pay ("${hit && text.slice(Math.max(0, hit.index - 60), hit.index + 60)}")`);
            assert.deepStrictEqual(links, [], `${lang} ${p.name}: nothing links to the guarantee`);
            assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('[data-prepay-only]')].filter((el) => !el.hidden || el.textContent.trim()).length), 0, `${lang} ${p.name}: its parts hidden and empty`);
          }
          // A phone: no sideways scroll.
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${lang} ${p.name}: no sideways scroll`);
          if (p.name === 'order') {
            // The payment box: today's red warning while off; calm (green) once paid in advance.
            const box = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.pay-box')); return { border: s.borderTopColor, bg: s.backgroundColor, ok: document.querySelector('.pay-box').classList.contains('pay-box-ok') }; });
            if (prepayOnly) {
              assert.ok(box.ok, 'calm box');
              assert.notStrictEqual(box.border, 'rgb(202, 61, 26)', 'not the red warning');
              assert.strictEqual(box.bg, 'rgb(238, 248, 241)', 'a light green');
            } else {
              assert.deepStrictEqual(box, { border: 'rgb(202, 61, 26)', bg: 'rgb(255, 240, 235)', ok: false }, 'as today');
            }
          }
          if (prepayOnly && lang === 'ar' && SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            await page.evaluate(() => document.querySelectorAll('.hm-faq details').forEach((d) => { d.open = true; }));
            const spot = { home: '.hm-benefits', design: '#dp-add', cart: '#place-order', order: '.guar-card', photos: '#ph-terms', editor: '#add-to-cart' }[p.name];
            if (spot && await page.$(spot)) await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), spot);
            await page.screenshot({ path: path.join(SHOTS, `on-ar-${p.name}.png`) });
          }
          if (p.name === 'order') {
            // The message to the shop on WhatsApp (its button shows when the shop has a number).
            const wa = await page.evaluate((o) => POD.t('order.waMessage', { n: o.number, items: '1. mug', total: POD.money(o.total), name: o.customer.name }), order);
            assert.ok(wa.includes(WA[mode][lang]), wa);
            if (prepayOnly) assert.strictEqual(codOn(wa), null, wa);
          }
        }
        // The guarantee's page: its rules while on; while off, not found.
        const res = await page.goto(`${srv.base}/guarantee`, { waitUntil: 'load' });
        if (prepayOnly) {
          assert.strictEqual(res.status(), 200);
          await page.waitForFunction(() => Boolean(document.querySelector('[data-i18n="gu.title"]').textContent));
          const text = await pageText(page);
          for (const want of GUARANTEE_PAGE[lang]) assert.ok(text.includes(want), `${lang} guarantee page: "${want}" in ${text.slice(0, 3000)}`);
          assert.strictEqual(codOn(text), null, `${lang} guarantee page: no cash on delivery`);
          assert.strictEqual(await page.title(), lang === 'ar' ? 'ضمان استرجاع الفلوس · إبداع' : 'Money-back guarantee · ebda3');
          assert.strictEqual(await page.evaluate(() => document.documentElement.dir), lang === 'ar' ? 'rtl' : 'ltr');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${lang} guarantee page: no sideways scroll`);
          if (lang === 'ar' && SHOTS) {
            await page.screenshot({ path: path.join(SHOTS, 'on-ar-guarantee.png'), fullPage: true });
          }
        } else {
          assert.strictEqual(res.status(), 404);
          assert.doesNotMatch(await pageText(page), GUAR);
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
