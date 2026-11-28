'use strict';

// Tester 2's run at 11 pm Cairo (25 Nov), in the editor: a failed print-file upload doesn't lock the page; Group and
// Ungroup are one step in Undo, with the pieces where they were; the pack chip follows the one pack in the boxes;
// "Move 1 cm" moves exactly 1 cm a tap; the check says when another side has something to check.
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
const addText = (page, text, x, y) => page.evaluate(([txt, left, top]) => {
  const ed = window.__editor;
  const t = new fabric.IText(txt, { left, top, fontSize: 40, fill: '#000' });
  ed.canvas.add(t);
  return ed.canvas.getObjects().length;
}, [text, x, y]);
const positions = (page) => page.evaluate(() => window.__editor.canvas.getObjects().map((o) => `${o.type}:${Math.round(o.left)},${Math.round(o.top)}`));

test('a print file that fails to upload: the error is said and the page is free again (no "Uploading 2/3" coming back)', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'mug', '&color=white&size=11oz');
  try {
    await addText(page, 'HELLO', 200, 200);
    let failed = false;
    await page.route(/\/api\/designs\/[^/]+\/files\//, async (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Upload broke' }) });
      }
      await new Promise((r) => setTimeout(r, 800)); // the others finish after the failure
      return route.continue();
    });
    await page.click('#add-to-cart');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Upload broke/.test(t.textContent)), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    assert.strictEqual(await page.isHidden('#busy'), true, 'the uploading cover is gone and stays gone');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('Group, then Undo: one step back, both texts where they were; Ungroup, then Undo: the group back in place', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
  try {
    await addText(page, 'AAA', 180, 200);
    await addText(page, 'BBB', 260, 320);
    await page.evaluate(() => { const ed = window.__editor; ed.canvas.discardActiveObject(); });
    const before = await positions(page);
    // Select both and group.
    await page.evaluate(() => {
      const ed = window.__editor;
      ed.canvas.setActiveObject(new fabric.ActiveSelection(ed.canvas.getObjects(), { canvas: ed.canvas }));
      ed.canvas.requestRenderAll();
    });
    await page.waitForSelector('[data-act="group"]');
    await page.click('[data-act="group"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1 && window.__editor.canvas.getObjects()[0].type === 'group');
    await page.evaluate(() => window.__editor.canvas.discardActiveObject());
    await page.click('#undo');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 2);
    assert.deepStrictEqual(await positions(page), before, 'one Undo: the two texts back where they were');
    // Group again, ungroup, click away, Undo: the group, in its place.
    await page.evaluate(() => {
      const ed = window.__editor;
      ed.canvas.setActiveObject(new fabric.ActiveSelection(ed.canvas.getObjects(), { canvas: ed.canvas }));
    });
    await page.click('[data-act="group"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects()[0].type === 'group');
    const grouped = await positions(page);
    await page.evaluate(() => window.__editor.canvas.setActiveObject(window.__editor.canvas.getObjects()[0]));
    await page.waitForSelector('[data-act="ungroup"]');
    await page.click('[data-act="ungroup"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 2);
    await page.evaluate(() => window.__editor.canvas.discardActiveObject());
    assert.deepStrictEqual(await positions(page), before, 'ungrouped: the texts where they were');
    await page.click('#undo');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    assert.deepStrictEqual(await positions(page), grouped, 'one Undo: the group, where it was');
    await page.click('#undo');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 2);
    assert.deepStrictEqual(await positions(page), before);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('packs: the one pack left in the boxes lights its chip, and another chip moves it (postcards)', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'postcards');
  try {
    await page.waitForSelector('#qty-field .qty-in[data-qz="10"]');
    await page.fill('#qty-field .qty-in[data-qz="10"]', '1');
    await page.dispatchEvent('#qty-field .qty-in[data-qz="10"]', 'change');
    await page.fill('#qty-field .qty-in[data-qz="1"]', '0');
    await page.dispatchEvent('#qty-field .qty-in[data-qz="1"]', 'change');
    await page.waitForFunction(() => window.__editor.st.sizeId === '10');
    await page.click('#sizes [data-size="25"]');
    await page.waitForFunction(() => window.__editor.st.sizeId === '25');
    const st = await page.evaluate(() => window.__editor.st.qty);
    const lines = Object.values(st).flatMap((row) => Object.entries(row).filter(([, n]) => n > 0));
    assert.deepStrictEqual(lines, [['25', 1]], JSON.stringify(st));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('"Move 1 cm" moves 1 cm a tap: 16 taps say 16 cm, not 17', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
  try {
    await page.evaluate(() => { const d = document.querySelector('[data-nudge="0,1"]'); if (d) d.closest('details,[hidden]') && (d.closest('details') ? d.closest('details').open = true : null); });
    const down = await page.$('[data-nudge="0,1"]');
    for (let i = 0; i < 4; i++) await page.evaluate(() => document.querySelector('[data-nudge="0,1"]').click());
    assert.ok(down);
    const info4 = await page.textContent('#place-info');
    assert.match(info4, /\b4\b/, info4);
    assert.doesNotMatch(info4, /4[.,]5/, info4);
    for (let i = 0; i < 12; i++) await page.evaluate(() => document.querySelector('[data-nudge="0,1"]').click());
    const info16 = await page.textContent('#place-info');
    const st = await page.evaluate(() => window.__editor.st.offsets[window.__editor.st.side]);
    // As far as the zone lets it go: never more than 1 cm a tap.
    assert.doesNotMatch(info16, /\b17\b/, info16);
    assert.ok(st && st.dy > 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('the check says when another side still has something to check (the front is fine, the back has text outside)', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
  try {
    await page.evaluate(async () => {
      const ed = window.__editor;
      const sides = ed.st.product.sides.map((s) => s.id);
      document.querySelector(`[data-side="${sides[1]}"]`).click();
    });
    await page.waitForFunction(() => window.__editor.st.side !== window.__editor.st.product.sides[0].id);
    // A text far outside the back's print area.
    await page.evaluate(() => {
      const ed = window.__editor;
      ed.canvas.add(new fabric.IText('OUTSIDE', { left: 5, top: 5, fontSize: 30, fill: '#000' }));
    });
    await page.waitForFunction(() => document.getElementById('check-chip').className.includes('warn') || document.getElementById('check-chip').className.includes('bad'));
    await page.evaluate(() => document.querySelector(`[data-side="${window.__editor.st.product.sides[0].id}"]`).click());
    await page.waitForFunction(() => window.__editor.st.side === window.__editor.st.product.sides[0].id);
    await page.waitForTimeout(500);
    const chip = await page.evaluate(() => ({ cls: document.getElementById('check-chip').className, text: document.getElementById('check-chip').textContent }));
    assert.match(chip.cls, /warn/, JSON.stringify(chip));
    assert.match(chip.text, /check/i, JSON.stringify(chip));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
