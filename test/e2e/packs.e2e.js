'use strict';

// Packs (owner, 25 Nov): a typed number that reaches a bigger, cheaper pack moves to it, and packs count copies.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

test('packs: 10 × "1 bookmark" becomes 1 × "10 bookmarks", booklets move to the 10-copy size, totals in copies', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const cells = (page) => page.evaluate(() => [...document.querySelectorAll('#qty-field .qty-in')].filter((i) => i.value).map((i) => `${i.dataset.qz}=${i.value}`));
    const type = async (page, sel, v) => {
      const box = page.locator(sel).first();
      await box.fill(v);
      await box.press('Tab');
      await page.waitForTimeout(400);
    };

    const page = await openEditor(ctx, srv.base, 'bookmarks', '&size=1');
    await page.waitForSelector('#qty-field .qty-in');
    await type(page, '#qty-field .qty-in[data-qz="1"]', '10');
    assert.deepStrictEqual(await cells(page), ['10=1']);
    assert.match(await page.textContent('#qty-field .qty-sum'), /10 copies in total/);
    assert.match(await page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' ')), /Cheaper as a bigger amount: changed to 1 × 10 bookmarks/);
    // Not cheaper: kept as typed.
    await type(page, '#qty-field .qty-in[data-qz="1"]', '3');
    assert.deepStrictEqual(await cells(page), ['1=3', '10=1']);
    assert.match(await page.textContent('#qty-field .qty-sum'), /13 copies in total/);

    // One size for all colours: the size above changes too.
    const bk = await openEditor(ctx, srv.base, 'booklets', '&size=8-1');
    await bk.waitForSelector('#qty-field .qty-in');
    await type(bk, '#qty-field .qty-in', '20');
    assert.deepStrictEqual(await cells(bk), ['8-10=2']);
    assert.strictEqual(await bk.evaluate(() => window.__editor.st.sizeId), '8-10');

    // Clothes still count pieces.
    const ts = await openEditor(ctx, srv.base, 'tshirt');
    await ts.waitForSelector('#qty-field');
    assert.doesNotMatch(await ts.textContent('#qty-field'), /cop(y|ies)/);
    for (const p of [page, bk, ts]) assert.deepStrictEqual(p.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('editor number boxes take Arabic digits ("٨٠" is 80) and arrow keys still step', { timeout: 60000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'mug');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getActiveObject());
    await page.waitForSelector('#p-size');
    await page.fill('#p-size', '٨٠');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fontSize), 80);
    await page.focus('#p-size');
    await page.keyboard.press('ArrowUp');
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fontSize), 81);
    // (The rotation box sits in a folded group: typed into as a customer's keyboard would.)
    await page.evaluate(() => { const b = document.getElementById('p-angle'); b.value = '-١٥'; b.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(() => Math.round(window.__editor.canvas.getActiveObject().angle)), -15);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
