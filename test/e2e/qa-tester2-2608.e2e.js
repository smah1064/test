'use strict';

// Tester 2 (3 pm Cairo, 26 Nov): the editor page jumped up after the print-check chip on 1024–1199 px screens; a
// colour tapped with one word selected while typing coloured the whole line.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

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
async function editorAt(width, product = 'mug') {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'en'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${srv.base}/editor?product=${product}`);
  await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 });
  return { ctx, page };
}

for (const width of [1024, 1100, 1199]) {
  test(`${width} px: the print-check chip shows the check without moving the page`, { timeout: 60000 }, async () => {
    const { ctx, page } = await editorAt(width);
    try {
      await page.click('.tools .tool[data-flyout="text"]');
      await page.click('#text-presets button >> nth=0');
      await page.waitForSelector('#check-chip:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(1500); // (the panel settles: the page is taller than the window here)
      await page.click('#check-chip');
      await page.waitForTimeout(1500);
      assert.strictEqual(await page.evaluate(() => window.scrollY), 0, 'the page stays where it is');
      const top = await page.evaluate(() => document.getElementById('sec-check').getBoundingClientRect().top);
      assert.ok(top >= 0 && top < 800, `the check is on the screen (${top})`);
      // The tools bar is still on the screen.
      const bar = await page.evaluate(() => document.querySelector('.tools').getBoundingClientRect().top);
      assert.ok(bar >= 0, `tools at ${bar}`);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('one word selected while typing + a colour: only that word changes colour', { timeout: 60000 }, async () => {
  const { ctx, page } = await editorAt(1366);
  try {
    await page.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const o = new fabric.IText('Hello Ahmed 2026', { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#111111' });
      ed.canvas.add(o);
      ed.canvas.setActiveObject(o);
      o.enterEditing();
      o.selectionStart = 6;
      o.selectionEnd = 11;
      ed.canvas.requestRenderAll();
    });
    await page.waitForSelector('#props [data-pal="fill"], #el-strip [data-pal="fill"]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('#props [data-pal="fill"][data-c]:not([data-c="#111111"]), #el-strip [data-pal="fill"]:not([data-c="#111111"])').click());
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const o = window.__editor.canvas.getObjects().find((x) => x.text === 'Hello Ahmed 2026');
      const at = (i) => (o.getSelectionStyles(i, i + 1)[0] || {}).fill || o.fill;
      return { whole: o.fill, hello: at(0), ahmed: at(7), year: at(13) };
    });
    assert.strictEqual(r.whole, '#111111', 'the line keeps its colour');
    assert.strictEqual(r.hello, '#111111');
    assert.strictEqual(r.year, '#111111');
    assert.notStrictEqual(r.ahmed, '#111111', 'the selected word took the colour');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
