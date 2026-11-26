'use strict';

// Tester 2 (7 pm Cairo, 26 Nov), in the browser: 11 or more pieces read "qty.unitPieces" under the editor's price;
// after "too many tries" on a coupon code the cart lost the automatic offer and every order ended in "prices
// changed"; a booklet's view-only page scrolled sideways on computers while its cover was shown.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('editor: 11 and more pieces read as words under the price, in English and Arabic', { timeout: 60000 }, async () => {
  for (const lang of ['en', 'ar']) {
    const ctx = await newContext(browser);
    if (lang === 'ar') await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
    try {
      const page = await openEditor(ctx, srv.base, 'mug');
      await page.waitForSelector('#qty-field [data-qstep="1"]', { timeout: 15000 });
      for (let i = 1; i < 11; i++) await page.click('#qty-field [data-qstep="1"]');
      await page.waitForFunction(() => /11|١١/.test(document.getElementById('qty-field').textContent), null, { timeout: 10000 });
      await page.waitForTimeout(400);
      // (The line under the price: "White, 325 ml, 11 pieces"; on phones it sits in the buy bar.)
      const line = await page.textContent('#buy-sum');
      assert.doesNotMatch(line, /qty\.unitPieces/, `${lang}: no raw words (${line})`);
      assert.match(line, lang === 'en' ? /11 pieces/ : /١١ قطعة/);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  }
});

test('cart: too many coupon tries from here: the code comes off with the reason, the automatic offer and its total stay', { timeout: 120000 }, async () => {
  const token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  const auto = await post('/api/admin/coupons', { code: 'AUTO20', type: 'percent', value: 20, auto: true }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(auto.status, 201, await auto.clone().text());
  const made = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'tries' }] } } } })).json();
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
  const entry = { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
  // Wrong codes from this address until the shop says "too many tries".
  for (let i = 0; i < 40; i++) {
    const r = await post('/api/cart/quote', { designIds: [d.id], couponCode: `WRONG${i}` });
    if (r.status === 429) break;
  }
  const ctx = await newContext(browser);
  await ctx.addInitScript((e) => { if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/cart`);
    await page.waitForFunction(() => document.getElementById('coupon-code').textContent === 'AUTO20', null, { timeout: 30000 });
    const total = await page.textContent('#total');
    await page.fill('#coupon', 'MYCODE');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => document.getElementById('coupon-msg').textContent.trim() !== '' && !document.getElementById('coupon-apply').disabled, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert.strictEqual(await page.textContent('#coupon-code'), 'AUTO20', 'the offer stays');
    assert.strictEqual(await page.textContent('#total'), total, 'the total with the offer');
    assert.match(await page.textContent('#coupon-msg'), /many|try again|minute/i);
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('pod-coupon')), null, 'the code came off');
    // The next price check (as before ordering) answers, with the offer.
    const q = await page.evaluate(async (id) => {
      const r = await fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designIds: [id] }) });
      return { status: r.status, body: await r.json() };
    }, d.id);
    assert.strictEqual(q.status, 200);
    assert.strictEqual(q.body.coupon.code, 'AUTO20');
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
    await fetch(`${srv.base}/api/admin/coupons/${(await auto.json()).id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ active: false }) });
  }
});

/** A booklet's view-only page with its API answered here (as test/e2e/view-page.e2e.js does). */
async function bookletView(lang, rtl, width) {
  const W = 600;
  const H = 848;
  const view = {
    id: 'bk1', productId: 'booklet', productName: { en: 'Booklet A5', ar: 'كتيّب A5' }, kind: 'pages', rtl,
    pages: Array.from({ length: 8 }, (_, i) => ({ name: { en: `Page ${i + 1}`, ar: `صفحة ${i + 1}` }, url: `/api/views/bk1/page/${i}.jpg?v=1`, w: W, h: H })),
    updatedAt: '2026-11-26T10:00:00.000Z', makeOwn: '/product?id=booklet',
  };
  const jpg = await sharp({ create: { width: W, height: H, channels: 3, background: '#1971c2' } }).jpeg().toBuffer();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  await ctx.route('**/api/views/**', (route) => (/\/page\/\d+\.jpg/.test(route.request().url())
    ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpg })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) })));
  const page = await ctx.newPage();
  await page.goto(`${srv.base}/view?id=bk1`);
  await page.waitForSelector('.vw-book', { timeout: 15000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

for (const [lang, rtl] of [['en', true], ['ar', false]]) {
  test(`view-only booklet (${lang} page, ${rtl ? 'right' : 'left'}-bound) on computers: the cover alone never makes the page scroll sideways`, { timeout: 60000 }, async () => {
    for (const width of [1024, 1280, 1366]) {
      const { ctx, page } = await bookletView(lang, rtl, width);
      try {
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, shift: document.querySelector('.vw-book').dataset.shift || '' }));
        assert.ok(m.shift, `the cover is shifted to the middle (${JSON.stringify(m)})`);
        assert.ok(m.sw <= m.w, `${width}px: page ${m.sw} wide`);
        // The cover is still seen whole.
        const r = await page.evaluate(() => {
          const slot = [...document.querySelectorAll('.vw-book .vw-slot')].find((s) => !s.classList.contains('vw-empty'));
          const b = slot.getBoundingClientRect();
          return { left: b.left, right: b.right };
        });
        assert.ok(r.left >= 0 && r.right <= width, JSON.stringify(r));
      } finally {
        await ctx.close();
      }
    }
  });
}
