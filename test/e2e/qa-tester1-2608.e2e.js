'use strict';

// Tester 1 (4 pm Cairo, 26 Nov), ready designs shown as 1200 px copies and printed from the originals:
// a cropped picture printed whole (squeezed into the cropped box); "Remove background" was undone in the print;
// an original that failed to load quietly printed the small copy.
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
const artPic = (page) => page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.type === 'image' && o.printSrc), null, { timeout: 30000 });

test('a cropped ready-design picture prints the same part, from the original', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=xm-trees-holly-plaid');
    await artPic(page);
    const r = await page.evaluate(async () => {
      const ed = window.__editor;
      const o = ed.canvas.getObjects().find((x) => x.type === 'image' && x.printSrc);
      // Crop to the top-left quarter, keeping its size on the product.
      const shown = [o.width * o.scaleX, o.height * o.scaleY];
      o.set({ cropX: 0, cropY: 0, width: o.width / 2, height: o.height / 2, scaleX: o.scaleX, scaleY: o.scaleY });
      const mean = (cv) => {
        const c = document.createElement('canvas');
        c.width = 40; c.height = 40;
        c.getContext('2d').drawImage(cv, 0, 0, 40, 40);
        const d = c.getContext('2d').getImageData(0, 0, 40, 40).data;
        const out = [];
        for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
        return out;
      };
      const part = (x) => { const el = x.getElement(); const W = el.naturalWidth || el.width; const H = el.naturalHeight || el.height; return [x.cropX / W, x.cropY / H, x.width / W, x.height / H]; };
      const partBefore = part(o);
      const before = mean(o.toCanvasElement({ withoutTransforms: true }));
      const sizeBefore = [o.width * o.scaleX, o.height * o.scaleY];
      await window.POD_DESIGN.usePrintSources(ed.canvas);
      const after = mean(o.toCanvasElement({ withoutTransforms: true }));
      const diff = before.reduce((a, v, i) => a + Math.abs(v - after[i]), 0) / before.length;
      return { diff, partBefore, partAfter: part(o), sizeBefore, sizeAfter: [o.width * o.scaleX, o.height * o.scaleY], swapped: o.printSwapped, natural: o.getElement().naturalWidth, shown };
    });
    assert.strictEqual(r.swapped, true);
    assert.ok(r.natural > 1200, `printed from the original (${r.natural} px)`);
    assert.ok(Math.abs(r.sizeAfter[0] - r.sizeBefore[0]) < 0.5 && Math.abs(r.sizeAfter[1] - r.sizeBefore[1]) < 0.5, 'the same size on the product');
    r.partAfter.forEach((v, i) => assert.ok(Math.abs(v - r.partBefore[i]) < 0.002, `the same part of the original: ${r.partBefore} vs ${r.partAfter}`));
    assert.ok(r.diff < 12, `the same part of the picture (mean difference ${r.diff.toFixed(1)})`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('"Remove background" on a ready-design picture: the print uses the new pixels', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=xm-trees-holly-plaid');
    await artPic(page);
    await page.evaluate(() => {
      const ed = window.__editor;
      const o = ed.canvas.getObjects().find((x) => x.type === 'image' && x.printSrc);
      ed.canvas.setActiveObject(o);
      ed.canvas.requestRenderAll();
    });
    await page.waitForSelector('[data-act="removebg"]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[data-act="removebg"]').click());
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 60000 });
    const left = await page.evaluate(() => window.__editor.canvas.getObjects().filter((x) => x.type === 'image').map((x) => x.printSrc || null));
    assert.ok(left.every((x) => !x), `no original left to swap back in: ${JSON.stringify(left)}`);
  } finally {
    await ctx.close();
  }
});

test('the original can\'t be loaded: nothing is added, the customer is told', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=xm-trees-holly-plaid&color=white&size=M');
    await artPic(page);
    const src = await page.evaluate(() => window.__editor.canvas.getObjects().find((x) => x.printSrc).printSrc);
    await page.route((u) => u.pathname === new URL(src, 'http://x').pathname, (r) => r.abort());
    await page.evaluate(() => document.getElementById('add-to-cart').click());
    await page.waitForFunction(() => /full-size picture didn't load/.test(document.body.textContent), null, { timeout: 60000 });
    assert.match(page.url(), /\/editor/);
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]').length), 0);
    assert.strictEqual(await page.evaluate(() => document.getElementById('busy').hidden), true);
  } finally {
    await ctx.close();
  }
});

test('right after a ready design opens, Undo is off and Ctrl+Z keeps it', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-not-lazy');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => window.__editor.canvas.getObjects().length);
    assert.strictEqual(await page.isDisabled('#undo'), true, 'nothing to undo yet');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getObjects().length), n, 'still there');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('Arabic dates have the month in words; paper, cover and fabric products say so instead of "Colour"', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/editor?product=booklets`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 });
    assert.match(await page.evaluate(() => POD.date('2026-11-26T13:02:00Z')), /٢٦ نوفمبر ٢٠٢٦/);
    assert.strictEqual((await page.textContent('#color-label')).trim(), 'الغلاف:');
    await page.goto(`${srv.base}/product?id=flyers`);
    await page.waitForSelector('#pp-color-label');
    await page.waitForFunction(() => document.getElementById('pp-color-label').textContent.trim() !== '');
    assert.strictEqual((await page.textContent('#pp-color-label')).trim(), 'الورق:');
  } finally {
    await ctx.close();
  }
});
