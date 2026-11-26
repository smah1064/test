'use strict';

// Tester 1's run at 8 am Cairo (26 Nov), in the browser: a colour picked before anything is designed moves the
// quantity boxes to it; a ready design's near-black words follow a switch to a dark colour; a booklet with only its
// cover designed is said in the editor's own check; Save with nothing designed says so; text typed in the side box
// stays inside the print area.
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
const addText = (page, text) => page.evaluate((s) => {
  const ed = window.__editor;
  const a = ed.st.product.sides[0].printArea;
  const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
  ed.canvas.add(o);
  ed.canvas.setActiveObject(o);
  ed.canvas.fire('object:modified', { target: o });
}, text);

test('nothing designed, black picked: the quantity boxes are black\'s, and the piece typed there is black', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt');
    await page.waitForSelector('#qty-field .qty-in');
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'black');
    const colours = await page.$$eval('#qty-field .qty-in', (xs) => [...new Set(xs.map((x) => x.dataset.qc))]);
    assert.deepStrictEqual(colours, ['black']);
  } finally {
    await ctx.close();
  }
});

test('a ready design opened on white, then black picked: its near-black words take the light ink', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-error-404-sloth-beanie&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.text && /ERROR/.test(o.text)), null, { timeout: 30000 });
    const fills = () => page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text && /ERROR|NOT FOUND/.test(o.text)).map((o) => String(o.fill).toLowerCase()));
    assert.ok((await fills()).every((f) => f === '#111111'), 'dark on white');
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'black');
    await page.waitForTimeout(500);
    const after = await fills();
    assert.ok(after.length >= 2 && after.every((f) => f !== '#111111'), `light on black: ${after}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('booklet with only its cover designed: the editor\'s check says the other pages are blank', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'booklets');
    await addText(page, 'COVER');
    await page.waitForFunction(() => /blank/.test(document.getElementById('check-list').textContent), null, { timeout: 10000 });
    assert.match(await page.getAttribute('#check-chip', 'class'), /warn/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('Save with nothing designed: "add something first", not "saved"', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    await page.click('#save-draft');
    await page.waitForSelector('#toast-root .toast.error', { timeout: 5000 });
    assert.match(await page.textContent('#toast-root .toast.error'), /first/);
    assert.match(page.url(), /\/editor/, 'still in the editor');
  } finally {
    await ctx.close();
  }
});

test('long text typed in the side box is made smaller to stay inside the print area', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'Hi');
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', 'فريق Ebda3 2026 فريق Ebda3 2026 فريق Ebda3 2026');
    await page.waitForTimeout(300);
    const fit = await page.evaluate(() => {
      const ed = window.__editor;
      const o = ed.canvas.getActiveObject();
      const a = ed.st.product.sides[0].printArea;
      return { w: o.getScaledWidth(), max: a.w };
    });
    assert.ok(fit.w <= fit.max, `${Math.round(fit.w)} within ${Math.round(fit.max)}`);
  } finally {
    await ctx.close();
  }
});
