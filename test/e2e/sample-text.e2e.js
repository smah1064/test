'use strict';

// A text preset added and never changed («نصك هنا», "Your Text"): a note on the design, a warning in the print
// check, the question on Add to cart, and the proof in the cart warns instead of "Ready to print" (owner, 26 Nov).
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('an unchanged sample text is flagged in the editor and on the proof; typing over it clears the note', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      const ctx = await newContext(browser);
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* none */ } }, lang);
      const page = await ctx.newPage();
      const errors = [];
      const dialogs = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
      await page.setViewportSize({ width: 360, height: 760 });
      await page.goto(`${srv.base}/editor?product=mug`);
      await page.waitForFunction(() => window.__editor);
      await page.click('[data-flyout="text"]');
      await page.locator('#text-presets button').first().click();
      await page.waitForTimeout(500);
      const sample = lang === 'ar' ? 'نصك هنا' : 'Your Text';
      assert.ok(await page.locator('#sample-note').isVisible(), 'the note shows on the design');
      assert.match(await page.locator('#sample-note').innerText(), new RegExp(sample));
      assert.match(await page.getAttribute('#check-chip', 'class'), /\bwarn\b/);
      // No sideways scroll at 360 px with the note showing.
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

      if (lang === 'ar') {
        // "Change it" puts the cursor in the text box; once typed over, the note and the warning go.
        await page.click('#sample-note-edit');
        await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'p-text');
        assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'p-text');
        assert.ok(await page.locator('#sample-note').isHidden(), 'hidden while typing');
        await page.fill('#p-text', 'سارة');
        await page.locator('#p-text').dispatchEvent('input');
        await page.evaluate(() => document.activeElement.blur());
        await page.waitForTimeout(400);
        assert.ok(await page.locator('#sample-note').isHidden());
        assert.match(await page.getAttribute('#check-chip', 'class'), /\bok\b/);
      } else {
        // Added as it is: the customer is asked, and the proof in the cart warns.
        await page.click('#add-to-cart');
        await page.waitForURL(/\/cart/, { timeout: 30000 });
        assert.ok(dialogs.some((m) => m.includes(sample)), 'asked before adding');
        await page.waitForSelector('.cart-proof .pf-box', { timeout: 30000 });
        const cls = await page.locator('.cart-proof .pf-box').first().getAttribute('class');
        assert.match(cls, /pf-warn/);
        assert.match(await page.locator('.cart-proof').first().innerText(), /sample text/);
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
