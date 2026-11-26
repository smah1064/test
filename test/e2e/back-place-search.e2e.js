'use strict';

/**
 * QA (26 Nov), on a phone (360 px): Back from a product returns to the same card of the home page's "All products"
 * (Arabic and English), and Back from a ready design to the same card of /designs. Both pages draw their cards once
 * the shop's lists have come, after the browser has put the page back where it was (the FAQ, or the top), so the
 * place is kept in the history entry (as the product page does for its ready designs). And the home search finds a
 * colour's other forms (شنطة سوداء, تيشرت بيضا, هودي رصاصي, gray hoodie, beige cap), keyring, سلسلة مفاتيح, leaflets
 * and a calendar with a year; "hat" is the cap, and كتيب lists the booklets before the bookmarks.
 *
 * Run:  node --test test/e2e/back-place-search.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;

test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** A 360 px phone with the shop in `lang`. */
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
  return { ctx, page };
}

/** Where a card is on the screen (its top, from the top of the window) and whether it is in view. */
const onScreen = (page, sel) => page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), seen: r.bottom > 0 && r.top < window.innerHeight };
});

for (const lang of ['en', 'ar']) {
  test(`home (${lang}, 360 px): Back from the 41st product of "All products" comes back to that card, not the FAQ`, { timeout: 120000 }, async () => {
    const { ctx, page } = await phone(lang);
    try {
      await page.goto(`${srv.base}/`, { waitUntil: 'load' });
      await page.waitForSelector('#product-grid .hm-gcard');
      const cards = page.locator('#product-grid .hm-gcard');
      assert.ok((await cards.count()) > 45, 'the whole catalogue is listed');
      const card = cards.nth(40);
      const id = await card.getAttribute('data-place');
      assert.ok(id, 'the card names its product');
      const sel = `#product-grid .hm-gcard[data-place="${id}"]`;
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      const y = await page.evaluate(() => window.scrollY);
      assert.ok(y > 5000, `scrolled down the catalogue (${y})`);
      const before = await onScreen(page, sel);
      await card.locator('h3 a').click();
      await page.waitForURL(/\/product\?id=/);
      await page.goBack();
      await page.waitForSelector(sel);
      await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 80, y, { timeout: 10000 });
      const after = await onScreen(page, sel);
      assert.ok(after.seen, `the card is in view again (${JSON.stringify(after)})`);
      assert.ok(Math.abs(after.top - before.top) < 80, `at the same height on the screen (${before.top} → ${after.top})`);
      // It stays there (nothing drawn later moves it away).
      await page.waitForTimeout(800);
      assert.ok((await onScreen(page, sel)).seen, 'still in view');
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('home (360 px): Back after a search comes back to the same results and the same card', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('en');
  try {
    await page.goto(`${srv.base}/?q=card`, { waitUntil: 'load' });
    await page.waitForSelector('#product-grid .hm-gcard');
    const cards = page.locator('#product-grid .hm-gcard');
    const n = await cards.count();
    assert.ok(n >= 6, `"card" lists ${n} products`);
    const card = cards.nth(n - 2);
    const id = await card.getAttribute('data-place');
    await card.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await card.locator('.hm-gdetails').click();
    await page.waitForURL(/\/product\?id=/);
    await page.goBack();
    await page.waitForSelector(`#product-grid .hm-gcard[data-place="${id}"]`);
    assert.strictEqual(await page.inputValue('#home-q'), 'card');
    assert.strictEqual(await cards.count(), n);
    await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 80, y, { timeout: 10000 });
    assert.ok((await onScreen(page, `#product-grid .hm-gcard[data-place="${id}"]`)).seen);
  } finally {
    await ctx.close();
  }
});

for (const lang of ['en', 'ar']) {
  test(`/designs (${lang}, 360 px): Back from the 40th design comes back to that design, not the top`, { timeout: 120000 }, async () => {
    const { ctx, page } = await phone(lang);
    try {
      await page.goto(`${srv.base}/designs`, { waitUntil: 'load' });
      await page.waitForSelector('#design-grid .design-card');
      const cards = page.locator('#design-grid .design-card');
      const total = await cards.count();
      assert.ok(total > 100, `${total} designs`);
      const card = cards.nth(39);
      const id = await card.getAttribute('data-place');
      assert.ok(id, 'the card names its design');
      const sel = `#design-grid .design-card[data-place="${id}"]`;
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      const y = await page.evaluate(() => window.scrollY);
      assert.ok(y > 5000, `scrolled down the designs (${y})`);
      const before = await onScreen(page, sel);
      await card.click();
      await page.waitForURL(/\/design\?id=/);
      await page.goBack();
      await page.waitForSelector(sel);
      await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 80, y, { timeout: 10000 });
      assert.strictEqual(await cards.count(), total, 'every design is listed again');
      const after = await onScreen(page, sel);
      assert.ok(after.seen && Math.abs(after.top - before.top) < 80, `the design is where it was (${before.top} → ${JSON.stringify(after)})`);
      await page.waitForTimeout(800);
      assert.ok((await onScreen(page, sel)).seen, 'still in view');
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('/designs (360 px): Back keeps a search and a product, and the place in their list', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('en');
  try {
    await page.goto(`${srv.base}/designs?product=tshirt`, { waitUntil: 'load' });
    await page.waitForSelector('#design-grid .design-card');
    const cards = page.locator('#design-grid .design-card');
    const n = await cards.count();
    assert.ok(n > 30, `${n} designs on the T-shirt`);
    const card = cards.nth(29);
    const id = await card.getAttribute('data-place');
    await card.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await card.click();
    await page.waitForURL(/\/design\?id=.*product=tshirt/);
    await page.goBack();
    await page.waitForSelector(`#design-grid .design-card[data-place="${id}"]`);
    assert.strictEqual(await page.inputValue('#design-product'), 'tshirt');
    assert.strictEqual(await cards.count(), n);
    await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 80, y, { timeout: 10000 });
  } finally {
    await ctx.close();
  }
});

test('home search in the browser: colours in their other forms, keyring, leaflets, a calendar with a year, hat, كتيب', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('ar');
  try {
    await page.goto(`${srv.base}/`, { waitUntil: 'load' });
    await page.waitForSelector('#product-grid .hm-gcard');
    /** The products the search lists, in their order. */
    const search = async (q) => {
      await page.fill('#home-q', q);
      await page.press('#home-q', 'Enter');
      await page.waitForFunction((want) => new URLSearchParams(location.search).get('q') === want, q.trim());
      return page.$$eval('#product-grid .hm-gcard', (els) => els.map((el) => el.dataset.place));
    };
    const want = {
      'شنطة سوداء': ['tote'],
      'شنطة سودا': ['tote'],
      'تيشرت بيضا': ['tshirt'],
      'تيشيرت سودا': ['tshirt'],
      'هودي رصاصي': ['hoodie'],
      'gray hoodie': ['hoodie'],
      'gray t-shirt': ['tshirt'],
      'beige cap': ['cap'],
      'سلسلة مفاتيح': ['keychain'],
      keyring: ['keychain'],
      leaflets: ['flyers'],
      'calendar 2026': ['calendar', 'deskcalendar'],
      'نتيجة 2027': ['calendar', 'deskcalendar'],
    };
    for (const [q, ids] of Object.entries(want)) {
      const got = await search(q);
      for (const id of ids) assert.ok(got.includes(id), `"${q}" lists ${id} (got ${got.join(', ') || 'nothing'})`);
      assert.strictEqual(got[0], ids[0], `"${q}": ${got.join(', ')}`);
    }
    assert.deepStrictEqual(await search('hat'), ['cap']);
    const booklets = await search('كتيب');
    assert.strictEqual(booklets[0], 'booklets', `كتيب: ${booklets.join(', ')}`);
    assert.ok(booklets.indexOf('bookmarks') > 0, `كتيب: ${booklets.join(', ')}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
