'use strict';

// Search in the header (UX item A), on phones (360px, iPhone 13, Pixel 7) and a computer, in Arabic and English:
// the magnifier opens the bar (box focused, 16px), suggestions as you type (picture, name, from-price), a suggestion
// opens its product, Enter opens the home page's results, Escape closes and gives focus back, nothing found says so,
// the header is as tall as before while closed, and no page scrolls sideways.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;
let devices;
test.before(async () => {
  srv = await startServer();
  const pw = loadPlaywright();
  devices = pw.devices;
  browser = await pw.chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function context(lang, opts) {
  const { defaultBrowserType, ...rest } = opts; // (Chromium for every device)
  const ctx = await browser.newContext({ ...rest, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ }
  }, lang);
  return ctx;
}
const PHONE_360 = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1366, height: 800 } };
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const items = (page) => page.$$eval('.site-search-item', (as) => as.map((a) => ({
  href: a.getAttribute('href'),
  name: a.querySelector('.site-search-name').textContent,
  price: a.querySelector('.site-search-price').textContent,
  img: Boolean(a.querySelector('img')),
  h: a.getBoundingClientRect().height,
})));

test('open, type, suggestions, Escape closes; header height unchanged; no sideways scroll', { timeout: 180000 }, async () => {
  const sizes = { '360px': PHONE_360, 'iPhone 13': devices['iPhone 13'], 'Pixel 7': devices['Pixel 7'], '1366px': DESKTOP };
  for (const lang of ['ar', 'en']) {
    for (const [name, size] of Object.entries(sizes)) {
      const ctx = await context(lang, size);
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${srv.base}/cart`);
        await page.waitForSelector('[data-account-link]');
        await page.evaluate(() => document.fonts.ready);
        const where = `${lang} ${name}`;
        const before = await page.evaluate(() => document.querySelector('.site-header').offsetHeight);
        // (111 on phones since Thumb-size buttons, step 2: the chips under the header are 44 px tall, it was 109.)
        assert.strictEqual(before, name === '1366px' ? 61 : 111, `${where}: the header's height while closed`);
        const btn = page.locator('[data-site-search]');
        const box = await btn.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, `${where}: a 44px tap target (${box.width}×${box.height})`);
        assert.strictEqual(await btn.getAttribute('aria-label'), lang === 'ar' ? 'دوّر' : 'Search', where);
        assert.strictEqual(await btn.getAttribute('aria-expanded'), 'false', where);
        // Before the account icon, in reading order (right of it in Arabic).
        const acct = await page.locator('[data-account-link]').boundingBox();
        assert.ok(lang === 'ar' ? box.x > acct.x : box.x < acct.x, `${where}: before the account icon`);

        await btn.click();
        assert.strictEqual(await btn.getAttribute('aria-expanded'), 'true', where);
        const input = page.locator('.site-search input');
        assert.ok(await input.evaluate((el) => el === document.activeElement), `${where}: the box is focused`);
        assert.ok(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), `${where}: 16px (no zoom on iPhones)`);
        assert.strictEqual(await input.getAttribute('aria-label'), lang === 'ar' ? 'دوّر على منتج' : 'Search products', where);

        await page.keyboard.type(lang === 'ar' ? 'مج' : 'mug');
        await page.waitForSelector('.site-search-item');
        const got = await items(page);
        assert.ok(got.length >= 3 && got.length <= 5, `${where}: up to five suggestions (${got.length})`);
        assert.deepStrictEqual(got.slice(0, 3).map((x) => x.href), ['/product?id=mug', '/product?id=magicmug', '/product?id=couplemugs'], where);
        assert.strictEqual(got[0].name, lang === 'ar' ? 'مج سيراميك' : 'Ceramic Mug', where);
        assert.match(got[0].price, lang === 'ar' ? /^من .*٢٥٠/ : /^from EGP\s?250$/, `${where}: the from-price in the page's digits`);
        for (const x of got) assert.ok(x.img && x.h >= 44, `${where}: a picture and a tall enough row`);
        assert.ok(await noSideways(page) <= 0, `${where}: no sideways scroll while open`);

        await page.locator('.site-search input').fill('xyzq');
        await page.waitForSelector('.site-search-none:not([hidden])');
        assert.strictEqual(await page.locator('.site-search-none').textContent(), lang === 'ar' ? 'مالقيناش حاجة بالاسم ده. جرّب كلمة تانية' : 'Nothing found with that name. Try another word.', where);
        assert.ok(await page.locator('.site-search-list').isHidden(), where);

        await page.keyboard.press('Escape');
        assert.ok(await page.locator('#site-search').isHidden(), `${where}: Escape closes`);
        assert.strictEqual(await btn.getAttribute('aria-expanded'), 'false', where);
        assert.ok(await btn.evaluate((el) => el === document.activeElement), `${where}: focus back on the magnifier`);
        assert.strictEqual(await page.evaluate(() => document.querySelector('.site-header').offsetHeight), before, where);
        assert.ok(await noSideways(page) <= 0, `${where}: no sideways scroll`);
        assert.deepStrictEqual(errors, [], where);
      } finally {
        await ctx.close();
      }
    }
  }
});

test('a suggestion opens its product; the keyboard reaches the suggestions; the ✕ closes', { timeout: 60000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const ctx = await context(lang, devices['Pixel 7']);
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/privacy`);
      await page.click('[data-site-search]');
      await page.keyboard.type(lang === 'ar' ? 'تيشيرت أبيض' : 'white t-shirt');
      await page.waitForSelector('.site-search-item');
      assert.strictEqual(await page.locator('.site-search-item').first().getAttribute('href'), '/product?id=tshirt', lang);
      // Down arrow: the first suggestion; up again: the box.
      await page.keyboard.press('ArrowDown');
      assert.ok(await page.evaluate(() => document.activeElement.classList.contains('site-search-item')), `${lang}: ArrowDown`);
      await page.keyboard.press('ArrowUp');
      assert.ok(await page.evaluate(() => document.activeElement.matches('.site-search input')), `${lang}: ArrowUp`);
      await page.locator('[data-site-search-close]').click();
      assert.ok(await page.locator('#site-search').isHidden(), `${lang}: the ✕ closes`);
      assert.ok(await page.evaluate(() => document.activeElement.matches('[data-site-search]')), `${lang}: focus back`);
      // Open again: the words are still there; tap the T-shirt.
      await page.click('[data-site-search]');
      await page.waitForSelector('.site-search-item');
      await page.locator('.site-search-item').first().tap();
      await page.waitForURL(/\/product\?id=tshirt$/);
    } finally {
      await ctx.close();
    }
  }
});

test('Enter opens the home page\'s full results for the words', { timeout: 60000 }, async () => {
  for (const [lang, words] of [['ar', 'مج'], ['en', 'cards']]) {
    const ctx = await context(lang, PHONE_360);
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/designs`);
      await page.click('[data-site-search]');
      await page.keyboard.type(words);
      await page.keyboard.press('Enter');
      await page.waitForURL((u) => u.pathname === '/' && u.searchParams.get('q') === words && u.hash === '#products');
      await page.waitForSelector('.hm-gcard');
      assert.strictEqual(await page.inputValue('#home-q'), words, `${lang}: the home box has the words`);
      assert.match(await page.textContent('#home-count'), lang === 'ar' ? /مج/ : /cards/, lang);
      const first = await page.locator('.hm-gcard h3 a').first().getAttribute('href');
      assert.strictEqual(first, lang === 'ar' ? '/product?id=mug' : '/product?id=greetingcard', lang);
      assert.ok(await noSideways(page) <= 0, `${lang}: no sideways scroll`);
    } finally {
      await ctx.close();
    }
  }
});
