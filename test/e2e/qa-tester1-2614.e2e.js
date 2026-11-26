'use strict';

// Tester 1 (10 pm Cairo, 26 Nov): the ready-design page opened scrolled down on smaller phones (centring the chosen
// product's chip scrolled the whole page), hiding the top of the picture and its zoom button.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

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

for (const [w, h] of [[360, 640], [360, 740], [740, 360]]) {
  test(`ready-design page at ${w}×${h}: opens at the top, the chosen product's chip in sight in its row`, { timeout: 60000 }, async () => {
    for (const lang of ['ar', 'en']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      try {
        await page.goto(`${srv.base}/design?id=xm-trees-holly-plaid`);
        await page.waitForSelector('#dp-products .active', { timeout: 20000 });
        await page.waitForTimeout(1200);
        assert.strictEqual(await page.evaluate(() => Math.round(window.scrollY)), 0, `${lang}: the page starts at the top`);
        const seen = await page.evaluate(() => {
          const a = document.querySelector('#dp-products .active').getBoundingClientRect();
          const row = document.getElementById('dp-products').getBoundingClientRect();
          return a.left >= row.left - 1 && a.right <= row.right + 1;
        });
        assert.ok(seen, `${lang}: the chosen chip is in sight in its row`);
      } finally {
        await ctx.close();
      }
    }
  });
}
