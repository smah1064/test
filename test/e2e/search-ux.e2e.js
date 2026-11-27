'use strict';

// Search UX item 4 (owner's OK, 27 Nov), on a phone (Pixel 7) in Arabic and English, and at 360 px:
// (a) a search that finds nothing offers things to tap: «جرّب دول:» with the home page's top 4 best sellers, a few ready
//     designs (the shop's pictures) and the link to all ready designs (44 px tall), in the header's dropdown and on the
//     full results page after Enter;
// (b) «هدية عيد ميلاد» / "birthday gift" list the mug, the T-shirt and the cushion first (they found only the invitation
//     cards, the welcome sign and the wrapping paper before).
// No page scrolls sideways.
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
  const ctx = await browser.newContext(rest);
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ }
  }, lang);
  return ctx;
}
const PHONE_360 = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const BEST4 = ['/product?id=tshirt', '/product?id=mug', '/product?id=bizcards', '/product?id=stickersheet'];
const WORDS = {
  ar: { nonsense: 'زززز', gift: 'هدية عيد ميلاد', none: 'مالقيناش حاجة بالاسم ده.', try: 'جرّب دول:', all: 'شوف كل التصميمات الجاهزة', designs: 'أو ابدأ من تصميم جاهز:' },
  en: { nonsense: 'xyzq', gift: 'birthday gift', none: 'Nothing found with that name.', try: 'Try these:', all: 'See all ready designs', designs: 'Or start from a ready design:' },
};

test('nothing found: the 4 best sellers, 3 ready designs and the link to all of them, in the dropdown and on the results page', { timeout: 180000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const w = WORDS[lang];
    for (const [name, size] of [['Pixel 7', devices['Pixel 7']], ['360px', PHONE_360]]) {
      const where = `${lang} ${name}`;
      const ctx = await context(lang, size);
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${srv.base}/cart`);
        await page.waitForSelector('[data-account-link]');
        await page.click('[data-site-search]');
        await page.keyboard.type(w.nonsense);
        await page.waitForSelector('.site-search-try-list .site-search-item');
        assert.strictEqual((await page.locator('.site-search-none').textContent()).trim(), w.none, where);
        assert.ok(await page.locator('.site-search-list').isHidden(), `${where}: no suggestions of the words`);
        assert.strictEqual((await page.locator('.site-search-try-title').first().textContent()).trim(), w.try, where);
        // The top 4 best sellers, as the suggestions look (picture, name, from-price), each a 44 px tap target.
        const best = await page.$$eval('.site-search-try-list .site-search-item', (as) => as.map((a) => ({
          href: a.getAttribute('href'), h: a.getBoundingClientRect().height, img: Boolean(a.querySelector('img')), price: a.querySelector('.site-search-price').textContent,
        })));
        assert.deepStrictEqual(best.map((x) => x.href), BEST4, where);
        for (const x of best) assert.ok(x.img && x.h >= 44 && x.price, `${where}: ${x.href} a picture, a price, 44 px tall (${x.h})`);
        // Three ready designs, their pictures loaded (the shop's own small pictures: nothing drawn here).
        await page.waitForFunction(() => document.querySelectorAll('.site-search-design img').length === 3
          && [...document.querySelectorAll('.site-search-design img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
        assert.strictEqual((await page.locator('.site-search-try-title').nth(1).textContent()).trim(), w.designs, where);
        const designs = await page.$$eval('.site-search-design', (as) => as.map((a) => ({ href: a.getAttribute('href'), h: a.getBoundingClientRect().height, name: a.textContent.trim() })));
        for (const d of designs) assert.ok(/^\/design\?id=[\w-]+&product=[\w-]+$/.test(d.href) && d.h >= 44 && d.name, `${where}: a ready design ${JSON.stringify(d)}`);
        // The link to all ready designs: 44 px tall, on the screen (the results scroll on their own if needed).
        const all = page.locator('.site-search-all');
        assert.strictEqual(await all.getAttribute('href'), '/designs', where);
        assert.match(await all.textContent(), new RegExp(w.all), where);
        await all.scrollIntoViewIfNeeded();
        const box = await all.boundingBox();
        assert.ok(box.height >= 44, `${where}: the link is 44 px tall (${box.height})`);
        assert.ok(box.y + box.height <= (size.viewport.height) + 1, `${where}: the link can be seen`);
        assert.ok(await sideways(page) <= 0, `${where}: no sideways scroll (dropdown)`);
        // The arrow keys reach them too.
        await page.locator('.site-search input').focus();
        await page.keyboard.press('ArrowDown');
        assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute('href')), BEST4[0], `${where}: ArrowDown`);
        await page.keyboard.press('ArrowUp');

        // Enter: the full results page says so too, with the same 4 cards, ready designs and the link.
        await page.locator('.site-search input').press('Enter');
        await page.waitForURL((u) => u.pathname === '/' && u.searchParams.get('q') === w.nonsense);
        await page.waitForSelector('.home-empty');
        assert.strictEqual((await page.locator('#product-grid > .home-try-title').textContent()).trim(), w.try, where);
        assert.deepStrictEqual(await page.$$eval('.hm-gcard h3 a', (as) => as.map((a) => a.getAttribute('href'))), BEST4, `${where}: results page`);
        await page.waitForSelector('.home-try-grid .design-card');
        const cards = await page.$$eval('.home-try-grid .design-card', (as) => as.map((a) => ({ href: a.getAttribute('href'), src: a.querySelector('img').getAttribute('src') })));
        assert.ok(cards.length >= 3 && cards.length <= 4, `${where}: ${cards.length} ready designs`);
        for (const c of cards) assert.ok(/^\/design\?id=/.test(c.href) && /^\/img-w\/\d+\/designed\//.test(c.src), `${where}: ${JSON.stringify(c)}`);
        const link = page.locator('.home-try-all');
        assert.strictEqual(await link.getAttribute('href'), '/designs', where);
        assert.match(await link.textContent(), new RegExp(w.all), where);
        const lb = await link.boundingBox();
        assert.ok(lb.height >= 44, `${where}: the results page's link is 44 px tall (${lb.height})`);
        assert.ok(await sideways(page) <= 0, `${where}: no sideways scroll (results)`);
        // Tappable: it opens the ready designs.
        if (name === 'Pixel 7') {
          await link.scrollIntoViewIfNeeded();
          await link.tap();
          await page.waitForURL((u) => u.pathname === '/designs');
        }
        assert.deepStrictEqual(errors, [], where);
      } finally {
        await ctx.close();
      }
    }
  }
});

test('«هدية عيد ميلاد» / "birthday gift": the mug, the T-shirt and the cushion first, in the dropdown and the results', { timeout: 120000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const w = WORDS[lang];
    const ctx = await context(lang, devices['Pixel 7']);
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/privacy`);
      await page.click('[data-site-search]');
      await page.keyboard.type(w.gift);
      await page.waitForSelector('.site-search-list .site-search-item');
      const got = await page.$$eval('.site-search-list .site-search-item', (as) => as.map((a) => a.getAttribute('href')));
      assert.deepStrictEqual(got.slice(0, 3).sort(), ['/product?id=cushion', '/product?id=mug', '/product?id=tshirt'], `${lang} dropdown: ${got}`);
      assert.ok(await page.locator('.site-search-try').isHidden(), `${lang}: found something, so no "try these"`);
      assert.ok(await sideways(page) <= 0, `${lang}: no sideways scroll`);
      await page.keyboard.press('Enter');
      await page.waitForURL((u) => u.pathname === '/' && u.searchParams.get('q') === w.gift);
      await page.waitForSelector('.hm-gcard');
      const cards = await page.$$eval('.hm-gcard h3 a', (as) => as.map((a) => a.getAttribute('href')));
      assert.deepStrictEqual(cards.slice(0, 3).sort(), ['/product?id=cushion', '/product?id=mug', '/product?id=tshirt'], `${lang} results: ${cards}`);
      // The invitation cards are still there, after the gifts.
      assert.ok(cards.indexOf('/product?id=invitations') > 3, `${lang}: the invitations after the gifts`);
      assert.strictEqual(await page.locator('.home-empty').count(), 0, lang);
      assert.ok(await sideways(page) <= 0, `${lang}: no sideways scroll (results)`);
    } finally {
      await ctx.close();
    }
  }
});
