'use strict';

/**
 * Plain glasses sold without printing (`blank: true`, 28 Nov 2026) and the UV DTF wraps that go on them, in the
 * browser (English and Arabic, a 360 px phone):
 *  - a plain glass's page has no editor choices and no ready designs: a quantity (1-20) and "Add to cart", which
 *    sends POST /api/blanks { productId, color, size, qty, options } and puts a `kind: 'blank'` entry on top of the
 *    cart, then goes to /cart;
 *  - the glass links to its wrap, and the wrap says the glass is sold separately and links to it;
 *  - on the home page, "Start" on a plain glass opens its page, not the editor.
 * POST /api/blanks is the main session's route: while the server answers 404 for it, the test answers it the way the
 * contract says (201 { id, price, qty }) and says so; once the route is there, the real one is used.
 *
 * Run:  node --test test/e2e/glass-blanks.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;
let live = false;

test.before(async () => {
  srv = await startServer();
  const probe = await fetch(`${srv.base}/api/blanks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'glasscan16', color: 'clear', size: '16oz', qty: 1, options: null }) });
  live = probe.status !== 404;
  if (!live) console.log('# POST /api/blanks is not on the server yet: answered by the test (201 { id, price, qty })');
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function phone(lang) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('pod-lang', l);
    } catch (e) { /* ignore */ }
  }, lang);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.sent = [];
  await page.route('**/api/blanks', async (route) => {
    const req = route.request();
    page.sent.push(JSON.parse(req.postData() || 'null'));
    if (live) return route.continue();
    const b = JSON.parse(req.postData() || '{}');
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: `blank-test-${Date.now()}`, price: 180 * b.qty, qty: b.qty }) });
  });
  // The cart page itself is not under test here: a stand-in, so the entry can be read as it was written.
  await page.route('**/cart?added=1', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>cart</title><p id="cart-stub">cart</p>' }));
  return { ctx, page };
}

for (const lang of ['en', 'ar']) {
  test(`a plain glass (${lang}) goes straight to the cart with its quantity, no editor`, { timeout: 90000 }, async () => {
    const { ctx, page } = await phone(lang);
    try {
      await page.goto(`${srv.base}/product?id=glasscan16`, { waitUntil: 'load' });
      // (The page is shown, then filled once the photos' list has come.)
      await page.waitForSelector('#pp-blank:not([hidden])');
      assert.ok(await page.isVisible('#pp-blank'), 'the add-to-cart box is shown');
      assert.ok(await page.isHidden('#pp-choices'), 'no "start designing" choices');
      assert.ok(await page.isHidden('#pp-ready'), 'no ready designs');
      assert.strictEqual(await page.locator('#pp-blank-qty option').count(), 20);
      assert.strictEqual(await page.getAttribute('#pp-pair a', 'href'), '/product?id=uvwrap16', 'links to its wrap');
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(scroll <= 0, `no sideways scrolling (${scroll} px)`);
      await page.selectOption('#pp-blank-qty', '3');
      assert.notStrictEqual((await page.textContent('#pp-blank-total')).trim(), '', 'the total for 3 is shown');
      await Promise.all([page.waitForURL(/\/cart\?added=1$/), page.click('#pp-blank-add')]);
      assert.deepStrictEqual(page.sent[0], { productId: 'glasscan16', color: 'clear', size: '16oz', qty: 3, options: null });
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'));
      const top = cart[0];
      assert.ok(top && top.kind === 'blank', 'a blank entry on top of the cart');
      assert.strictEqual(top.productId, 'glasscan16');
      assert.strictEqual(top.qty, 3);
      assert.strictEqual(top.copies, 3);
      assert.ok(top.designId && top.price > 0 && top.productName.ar && top.sizeLabel.en && top.colorName.en && top.previewUrl && top.addedAt);
      assert.deepStrictEqual(top.sides, []);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('a wrap says its glass is sold separately and keeps the editor', { timeout: 60000 }, async () => {
  const { ctx, page } = await phone('en');
  try {
    await page.goto(`${srv.base}/product?id=uvwraptaper`, { waitUntil: 'load' });
    await page.waitForSelector('#pp-pair:not([hidden])');
    assert.ok(await page.isHidden('#pp-blank'));
    assert.ok(await page.isVisible('#pp-scratch'));
    assert.match(await page.getAttribute('#pp-scratch', 'href'), /^\/editor\?product=uvwraptaper/);
    assert.match(await page.textContent('#pp-pair'), /glass is sold separately/i);
    assert.strictEqual(await page.getAttribute('#pp-pair a', 'href'), '/product?id=glasstaper');
    assert.ok(await page.locator('#pp-grid .pp-design').count() >= 6, 'the wrap designs are offered');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('home: "Start" on a plain glass opens its page, not the editor', { timeout: 90000 }, async () => {
  const { ctx, page } = await phone('en');
  try {
    await page.goto(`${srv.base}/`, { waitUntil: 'load' });
    await page.waitForSelector('#product-grid .hm-gcard');
    const showAll = page.locator('[data-show-all]');
    if (await showAll.count()) await showAll.first().click();
    const start = page.locator('#product-grid a.hm-gstart[href*="glasscan20"]');
    assert.strictEqual(await start.count(), 1);
    assert.strictEqual(await start.getAttribute('href'), '/product?id=glasscan20');
    assert.strictEqual(await page.locator('#product-grid a[href="/editor?product=glasscan20"]').count(), 0);
  } finally {
    await ctx.close();
  }
});
