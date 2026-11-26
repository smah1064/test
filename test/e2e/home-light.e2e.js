'use strict';

// The home page on a phone (owner's OK, UX items B and D, 26 Nov): the four "why order here" points under the banner,
// photos at about the size they are shown, 8 products then "Show all" (kept for Back), a search shows everything it finds.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('home on a phone: the four points, sized photos, 8 products then "Show all"', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      const ctx = await newContext(browser);
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* none */ } }, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.setViewportSize({ width: 360, height: 760 });
      await page.goto(`${srv.base}/`);
      await page.waitForSelector('.hm-gcard');
      // B: four points, between the banner and the tiles.
      assert.strictEqual(await page.locator('.hm-trust li').count(), 4);
      assert.match(await page.locator('.hm-trust').innerText(), lang === 'ar' ? /بتشوف البروفة/ : /You see the proof/);
      // F: the price note shows on phones too.
      assert.ok(await page.locator('.hm-price-note').isVisible(), 'price note on phones');
      // D: 8 products, and a button for the rest.
      const total = await page.evaluate(() => Number((document.querySelector('[data-show-all]').textContent.match(/[\d٠-٩]+/) || ['0'])[0].replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)));
      assert.strictEqual(await page.locator('.hm-gcard').count(), 8);
      assert.ok(total > 10, `total ${total}`);
      // The shop's photos come through the sized copies, and they load.
      const srcs = await page.$$eval('img.hm-life, img.hm-hero-photo', (imgs) => imgs.map((i) => i.getAttribute('srcset') || ''));
      assert.ok(srcs.length && srcs.every((s) => /\/img-w\/320\/(lifestyle|designed)\//.test(s)), srcs[0]);
      const hero = await page.evaluate(() => fetch(document.querySelector('img.hm-hero-photo').currentSrc).then((r) => r.status));
      assert.strictEqual(hero, 200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
      // "Show all": every product, the next one focused; Back from a product keeps them all.
      await page.click('[data-show-all]');
      assert.strictEqual(await page.locator('.hm-gcard').count(), total);
      await page.locator('.hm-gcard h3 a').nth(9).click();
      await page.waitForURL(/\/product\?id=/);
      await page.goBack();
      await page.waitForSelector('.hm-gcard');
      await page.waitForFunction((n) => document.querySelectorAll('.hm-gcard').length === n, total);
      // A search shows everything it finds, with no button.
      await page.goto(`${srv.base}/?q=${encodeURIComponent(lang === 'ar' ? 'تيشيرت' : 'shirt')}#products`);
      await page.waitForSelector('.hm-gcard');
      assert.strictEqual(await page.locator('[data-show-all]').count(), 0);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
