'use strict';

// Ramadan lanterns (CNC & Laser chat, 28 Nov): a name that doesn't fit the plaque, or takes more lines than it holds,
// stops "Add to cart" with a message (the workshop can't cut it); one that fits goes to the cart.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

test('lantern name plaque: a name too long for the plaque, or on too many lines, is stopped', { timeout: 150000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    // (The lanterns are drafts: shown in the shop here, with a price, the way the owner will when they're ready.)
    const token = (await (await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) })).json()).token;
    const live = await fetch(`${srv.base}/api/admin/catalog/familyfanous`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ status: 'live', prices: { basePrice: 500 } }) });
    assert.strictEqual(live.status, 200, await live.text());
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'familyfanous');
    assert.strictEqual(await page.evaluate(() => window.__editor.st.product.id), 'familyfanous');
    const put = (text, k) => page.evaluate(({ text, k }) => {
      const { canvas, st } = window.__editor;
      for (const o of canvas.getObjects().filter((x) => !x.excludeFromExport && x.name !== '__cropper')) canvas.remove(o);
      const a = st.product.sides[0].printArea;
      const t = new fabric.IText(text, { fontFamily: 'Cairo', fontSize: 40, originX: 'center', originY: 'center', left: a.x + a.w / 2, top: a.y + a.h / 2 });
      t.scaleToWidth(a.w * k);
      canvas.add(t);
      canvas.fire('object:modified', { target: t });
    }, { text, k });
    // Far wider than the plaque.
    await put('عائلة محمد عبد الرحمن الكبيرة جدا', 2.5);
    await page.waitForTimeout(500);
    await page.click('#add-to-cart');
    await page.waitForTimeout(2500);
    assert.ok(!/\/cart/.test(page.url()), 'not added');
    // Three lines on a two-line plaque.
    await put('أحمد\nمنى\nسارة', 0.5);
    await page.waitForTimeout(500);
    await page.click('#add-to-cart');
    await page.waitForTimeout(2500);
    assert.ok(!/\/cart/.test(page.url()), 'too many lines: not added');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
