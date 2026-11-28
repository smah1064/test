'use strict';

// QA tester 2 (25 Nov, 09:01): text stays readable after Undo or a product switch to a darker colour, and
// opening a ready design doesn't overwrite the customer's own saved design for that product.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

test('undo after a colour change, and a switch to a product without the colour, keep text readable', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    const fill = () => page.evaluate(() => window.__editor.canvas.getObjects()[0].fill.toLowerCase());
    assert.strictEqual(await fill(), '#16181d');
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects()[0].fill.toLowerCase() === '#ffffff');
    await page.click('#undo');
    await page.waitForTimeout(400);
    assert.strictEqual(await fill(), '#ffffff', 'undo keeps white text on the black shirt');
    // Back to white, then to the hoodie (no white): the text follows the hoodie's colour.
    await page.click('#swatches [data-color="white"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects()[0].fill.toLowerCase() === '#16181d');
    await page.selectOption('#product-select', 'hoodie');
    await page.waitForFunction(() => window.__editor.st.product.id === 'hoodie');
    await page.waitForTimeout(600);
    assert.strictEqual(await page.evaluate(() => window.__editor.st.colorId), 'black');
    assert.strictEqual(await fill(), '#ffffff', 'white text on the black hoodie');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('opening a ready design keeps the customer\'s own saved design until this one is changed', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    // The customer's own design for the mug, saved.
    const mine = await openEditor(ctx, srv.base, 'mug');
    await mine.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await mine.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    await mine.evaluate(() => { const ed = window.__editor; const tx = ed.canvas.getObjects()[0]; tx.set({ text: 'MY OWN' }); ed.canvas.fire('text:changed', { target: tx }); ed.canvas.fire('object:modified', { target: tx }); });
    await mine.waitForFunction(async () => { const d = await window.POD.drafts.get('mug'); return d && JSON.stringify(d.designs).includes('MY OWN'); }, null, { timeout: 15000 });
    await mine.close();
    // A ready design for the mug opens: nothing is overwritten by just looking.
    const lib = await (await fetch(`${srv.base}/api/library`)).json();
    const ready = lib.designs.find((d) => (d.products || []).includes('mug') && d.kind === 'template');
    assert.ok(ready, 'a ready design for the mug');
    // (Every write to the saved designs is noted: reading them back across tabs isn't reliable in a test browser.)
    await ctx.addInitScript(() => {
      window.__draftOps = [];
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) { if (this.name === 'drafts') window.__draftOps.push(`put ${k}`); return put.apply(this, arguments); };
      const del = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (k) { if (this.name === 'drafts') window.__draftOps.push(`delete ${k}`); return del.apply(this, arguments); };
    });
    const page = await openEditor(ctx, srv.base, 'mug', `&library=${encodeURIComponent(ready.id)}`);
    // The bar says the saved design is kept (so it was found), and nothing is written over it by just looking.
    await page.waitForSelector('.draft-bar [data-held="open"]');
    await page.waitForTimeout(2500);
    assert.deepStrictEqual(await page.evaluate(() => window.__draftOps), []);
    // A change to this one: it is saved in its place (as the bar said), and the bar goes.
    await page.evaluate(() => { const ed = window.__editor; const o = ed.canvas.getObjects()[0]; o.set({ left: o.left + 5 }); o.setCoords(); ed.canvas.fire('object:modified', { target: o }); });
    await page.waitForFunction(() => window.__draftOps.includes('put mug'), null, { timeout: 15000 });
    assert.strictEqual(await page.locator('.draft-bar [data-held="open"]').count(), 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('typing before a coloured word (canvas or side box) keeps the colour and the choice on that word', { timeout: 60000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'mug');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getActiveObject());
    // "Second line here" typed in the side box, then "line" chosen and coloured red.
    await page.fill('#p-text', 'Second line here');
    await page.waitForSelector('.word-chips [data-word]');
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.word-chips [data-word]')];
      chips.find((c) => c.textContent.trim() === 'line').click();
    });
    await page.waitForSelector('#p-wordcolor');
    await page.evaluate(() => { const c = document.getElementById('p-wordcolor'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); });
    const redWord = () => page.evaluate(() => {
      const o = window.__editor.canvas.getActiveObject();
      return [...o.text].map((ch, i) => ((o.getStyleAtPosition(i) || {}).fill === '#ff0000' ? ch : ' ')).join('').trim();
    });
    assert.strictEqual(await redWord(), 'line');
    // Words typed before it in the side box: still "line" in red, still the chosen word.
    await page.fill('#p-text', 'My Second line here');
    await page.waitForTimeout(300);
    assert.strictEqual(await redWord(), 'line');
    assert.strictEqual(await page.evaluate(() => { const s = window.__editor.st; return s.wordSel; }), 2);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
