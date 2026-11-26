'use strict';

// Tester 2 (5 pm Cairo, 26 Nov): a typed decimal ("2.5") was read as 25 in the editor's size table and the cart's box.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

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

test('"2.5" is 2 in the editor\'s size table and in the cart\'s box (not 25)', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'bookmarks', '&size=1');
    await page.waitForSelector('#qty-field .qty-in[data-qz="1"]');
    const box = page.locator('#qty-field .qty-in[data-qz="1"]').first();
    await box.fill('2.5');
    await box.press('Tab');
    await page.waitForTimeout(500);
    assert.strictEqual(await box.inputValue(), '2', 'the box says what is counted');
    const lines = await page.evaluate(() => JSON.stringify(window.__editor.st.qty));
    assert.match(lines, /"1":2\b/, lines);
    assert.doesNotMatch(lines, /"1":25/);
    // The cart: a mug, then "2.5" typed in its box.
    const mug = await openEditor(ctx, srv.base, 'mug');
    await mug.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const o = new fabric.IText('MUG', { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
      ed.canvas.add(o);
      ed.canvas.fire('object:modified', { target: o });
    });
    await mug.click('#add-to-cart');
    await mug.waitForURL(/\/cart/, { timeout: 60000 });
    await mug.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
    await mug.fill('.cart-qty .qty-n', '2.5');
    await mug.press('.cart-qty .qty-n', 'Enter');
    await mug.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 2; }, null, { timeout: 30000 });
    // Persian digits are read too.
    await mug.fill('.cart-qty .qty-n', '۳');
    await mug.press('.cart-qty .qty-n', 'Enter');
    await mug.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 3; }, null, { timeout: 30000 });
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
