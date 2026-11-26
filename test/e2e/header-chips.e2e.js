'use strict';

// The header on phones (360px, iPhone 13, Pixel 7): the full logo in the page's language, account, Cart and the
// language button on top; the menu links as swipeable chips under it, the current page's chip dark, Kids' books
// reachable, and no page scrolling sideways in Arabic or English. Computers keep the one-row menu.
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

async function phone(lang, opts) {
  const { defaultBrowserType, ...rest } = opts; // (Chromium for every device)
  const ctx = await browser.newContext({ ...rest, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ }
  }, lang);
  return ctx;
}
const PHONE_360 = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };

/** What the header shows: which logo, the visible top-row links, the chips (label, active, box) and the page width. */
const readHeader = () => {
  const vis = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const row = document.querySelector('.site-header .nav-chips');
  const rr = row.getBoundingClientRect();
  return {
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    logo: [...document.querySelectorAll('.site-header .brand-logo')].filter(vis).map((i) => i.className.replace('brand-logo ', '')),
    top: [...document.querySelectorAll('.site-header .inner > nav > *')].filter(vis).map((a) => a.getAttribute('href') || (a.hasAttribute('data-site-search') ? 'search' : 'lang')),
    rowShown: vis(row),
    row: { left: rr.left, right: rr.right, scrollW: row.scrollWidth, clientW: row.clientWidth },
    chips: [...row.querySelectorAll('a')].filter(vis).map((a) => {
      const r = a.getBoundingClientRect();
      return { chip: a.dataset.chip, text: a.textContent.trim(), active: a.classList.contains('active'), h: r.height, left: r.left, right: r.right };
    }),
  };
};

test('phones, both languages: full logo, top row, chips row; no sideways scroll on five pages', { timeout: 120000 }, async () => {
  const sizes = { '360px': PHONE_360, 'iPhone 13': devices['iPhone 13'], 'Pixel 7': devices['Pixel 7'] };
  for (const lang of ['ar', 'en']) {
    for (const [name, size] of Object.entries(sizes)) {
      const ctx = await phone(lang, size);
      try {
        for (const url of ['/', '/cart', '/designs', '/account', '/product?id=tshirt']) {
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          await page.goto(srv.base + url);
          await page.waitForFunction(() => document.querySelector('.nav-chips a').textContent.trim() !== '');
          await page.evaluate(() => document.fonts.ready);
          const h = await page.evaluate(readHeader);
          const where = `${lang} ${name} ${url}`;
          assert.ok(h.scrollW <= h.clientW, `${where}: no sideways scroll (${h.scrollW} > ${h.clientW})`);
          assert.deepStrictEqual(h.logo, [lang === 'ar' ? 'brand-ar' : 'brand-en'], `${where}: the full logo in the page's language`);
          assert.deepStrictEqual(h.top, ['search', '/account', '/cart', 'lang'], `${where}: search, account, Cart and the language button on top`);
          assert.ok(h.rowShown, `${where}: the chips row shows`);
          assert.deepStrictEqual(h.chips.map((c) => c.chip), ['products', 'designs', 'photos', 'books', 'tshirt', 'mug'], where);
          for (const c of h.chips) assert.ok(c.h >= 40, `${where}: ${c.chip} is ${c.h}px tall`);
          assert.ok(h.row.scrollW > h.row.clientW, `${where}: the row is swiped (more chips than fit)`);
          // The first chip starts at the page's start side, 16px in (right in Arabic) — unless the row was swiped
          // to show the current page's chip.
          const first = h.chips[0];
          if (h.chips.find((c) => c.active) === first || !h.chips.some((c) => c.active)) {
            if (lang === 'ar') assert.ok(Math.abs(h.row.right - first.right - 16) <= 1, `${where}: first chip 16px from the right (${h.row.right - first.right})`);
            else assert.ok(Math.abs(first.left - h.row.left - 16) <= 1, `${where}: first chip 16px from the left (${first.left - h.row.left})`);
          }
          const active = h.chips.filter((c) => c.active).map((c) => c.chip);
          const want = { '/': ['products'], '/designs': ['designs'], '/product?id=tshirt': ['tshirt'] }[url] || [];
          assert.deepStrictEqual(active, want, `${where}: the current page's chip`);
          for (const c of h.chips.filter((x) => x.active)) assert.ok(c.left >= -1 && c.right <= h.clientW + 1, `${where}: the active chip is on screen`);
          assert.deepStrictEqual(errors, [], where);
          await page.close();
        }
      } finally {
        await ctx.close();
      }
    }
  }
});

test('phones: Kids\' books is reachable from the chips (swiped into view, then tapped)', { timeout: 60000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const ctx = await phone(lang, PHONE_360);
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/cart`);
      const chip = page.locator('.site-header .nav-chips a[data-chip="books"]');
      await chip.waitFor({ state: 'visible' });
      assert.strictEqual((await chip.textContent()).trim(), lang === 'ar' ? 'كتب الأطفال' : 'Kids\' books');
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await page.waitForURL(/\?cat=kids#products$/);
      await page.waitForFunction(() => document.querySelector('.nav-chips a[data-chip="books"]').classList.contains('active'));
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sw <= 0, `${lang}: no sideways scroll on the kids' books list`);
      // The page's own list is on the kids' books.
      await page.waitForSelector('.cat-chips .chip.active[data-cat="kids"]', { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  }
});

test('the mug page: the Mugs chip (last) is dark and swiped into view, in Arabic (RTL) and English', { timeout: 60000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const ctx = await phone(lang, devices['iPhone 13']);
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/product?id=mug`);
      await page.waitForFunction(() => document.querySelector('.nav-chips a.active'));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      const h = await page.evaluate(readHeader);
      const mug = h.chips.find((c) => c.chip === 'mug');
      assert.ok(mug.active, lang);
      assert.ok(mug.left >= h.row.left - 1 && mug.right <= h.row.right + 1, `${lang}: Mugs on screen (${mug.left}..${mug.right})`);
    } finally {
      await ctx.close();
    }
  }
});

test('computers (1366px): the one-row menu as before, no chips row', { timeout: 60000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const ctx = await phone(lang, { viewport: { width: 1366, height: 800 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/designs`);
      await page.waitForSelector('[data-account-link]');
      const h = await page.evaluate(readHeader);
      assert.strictEqual(h.rowShown, false, lang);
      assert.deepStrictEqual(h.top, ['/#products', '/designs', '/photos', '/?cat=kids#products', 'search', '/account', '/cart', 'lang'], lang);
      assert.deepStrictEqual(h.logo, [lang === 'ar' ? 'brand-ar' : 'brand-en'], lang);
      assert.strictEqual(await page.evaluate(() => document.querySelector('.site-header').offsetHeight), 61, lang);
    } finally {
      await ctx.close();
    }
  }
});
