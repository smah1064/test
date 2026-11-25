'use strict';

// A ready design opened in the editor, a text added under it: its font and colour are at the top of the side
// panel (they were below the long product, size and print-place settings, out of sight: owner, 25 Nov).
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('the selected text\'s settings come first in the side panel; the product settings again once nothing is selected', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const lib = await (await fetch(`${srv.base}/api/library?product=tshirt`)).json();
    const ready = lib.designs.find((d) => d.kind === 'template') || lib.designs[0];
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${srv.base}/editor?product=tshirt&library=${encodeURIComponent(ready.id)}&color=black`);
    await page.waitForFunction(() => window.__editor);
    await page.waitForTimeout(800);
    const panel = () => page.evaluate(() => {
      const fill = document.getElementById('p-fill');
      const r = fill && fill.getBoundingClientRect();
      return { first: document.querySelector('.panel-scroll').firstElementChild.id, fillInView: Boolean(r && r.top >= 0 && r.bottom <= innerHeight) };
    });
    await page.click('[data-flyout="text"]');
    await page.locator('#text-presets button').first().click();
    await page.waitForTimeout(400);
    assert.deepStrictEqual(await panel(), { first: 'sec-props', fillInView: true });
    // The colour works from there.
    await page.click('[data-pal="fill"][data-c="#ff5a36"]');
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fill), '#ff5a36');
    // Nothing selected: the product settings first again.
    await page.evaluate(() => { const c = window.__editor.canvas; c.discardActiveObject(); c.requestRenderAll(); c.fire('selection:cleared'); });
    await page.waitForTimeout(300);
    assert.strictEqual((await panel()).first, 'sec-product');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
