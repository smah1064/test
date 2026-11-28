'use strict';

// Tester 2's run at 1 am Cairo (26 Nov), in the editor: a link with &size= / &color= reopened (reload) over the
// customer's draft: the pieces in the cart follow the size and colour on screen, and the link's choice is used once
// (a reload keeps what the customer picked after it).
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
const lines = (page) => page.evaluate(() => Object.entries(window.__editor.st.qty || {}).flatMap(([c, row]) => Object.entries(row || {}).filter(([, n]) => n > 0).map(([z, n]) => `${c}/${z}:${n}`)));
const waitDraft = (page) => page.waitForTimeout(1800); // (the draft is saved a moment after a change)

test('T-shirt opened with &size=M: pick L, reload, pick XL: one piece in XL, as shown', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&size=M');
    await page.evaluate(() => { const ed = window.__editor; ed.canvas.add(new fabric.IText('HELLO', { left: 200, top: 200, fontSize: 40, fill: '#000' })); });
    await page.click('#sizes [data-size="L"]');
    await page.waitForFunction(() => window.__editor.st.sizeId === 'L');
    await waitDraft(page);
    await page.reload();
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product && window.__editor.canvas.getObjects().length > 0, null, { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => window.__editor.st.sizeId), 'L', 'the reload keeps the size picked (the link\'s M was used once)');
    assert.deepStrictEqual(await lines(page), [`${await page.evaluate(() => window.__editor.st.colorId)}/L:1`]);
    await page.click('#sizes [data-size="XL"]');
    await page.waitForFunction(() => window.__editor.st.sizeId === 'XL');
    const color = await page.evaluate(() => window.__editor.st.colorId);
    assert.deepStrictEqual(await lines(page), [`${color}/XL:1`], 'the piece follows the size on screen');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('T-shirt opened with &color=black: pick white, reload: white on screen and in the cart', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=black&size=M');
    await page.evaluate(() => { const ed = window.__editor; ed.canvas.add(new fabric.IText('HELLO', { left: 200, top: 200, fontSize: 40, fill: '#fff' })); });
    await page.click('#swatches [data-color="white"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'white');
    await waitDraft(page);
    await page.reload();
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product && window.__editor.canvas.getObjects().length > 0, null, { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => window.__editor.st.colorId), 'white');
    assert.deepStrictEqual(await lines(page), ['white/M:1']);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('A draft in white L, then a product-page link for black: black on screen, and the one piece follows it', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=L');
    await page.evaluate(() => { const ed = window.__editor; ed.canvas.add(new fabric.IText('HELLO', { left: 200, top: 200, fontSize: 40, fill: '#000' })); });
    await waitDraft(page);
    await page.goto(`${srv.base}/editor?product=tshirt&color=black&size=XL`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product && window.__editor.canvas.getObjects().length > 0, null, { timeout: 30000 });
    const st = await page.evaluate(() => ({ c: window.__editor.st.colorId, z: window.__editor.st.sizeId }));
    assert.deepStrictEqual(st, { c: 'black', z: 'XL' }, 'the link picked on the product page wins');
    assert.deepStrictEqual(await lines(page), ['black/XL:1'], 'and the piece follows it');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
