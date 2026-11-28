'use strict';

// Owner, 26 Nov ("900 for this price while 1000 is cheaper?!", for every product sold in packs): the editor says when
// a few more copies cost less, as the cart does.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

test('900 envelopes: the editor makes them 500 + 4 × 100 and says 1,000 cost less', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'dlenvelopes', '&size=100');
    await page.waitForSelector('#qty-field .qty-in[data-qz="100"]');
    const box = page.locator('#qty-field .qty-in[data-qz="100"]').first();
    await box.fill('9');
    await box.press('Tab');
    await page.waitForTimeout(600);
    const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '));
    assert.match(toasts, /1,000 envelopes|1000 envelopes|1,000 copies|1000 copies/, toasts);
    assert.match(toasts, /2,100|2100/, toasts);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
