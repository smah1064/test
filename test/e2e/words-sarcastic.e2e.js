'use strict';

// A sarcastic ready design opened in the editor: its words are ordinary text objects (in the fonts chosen for
// the drawn lettering) over the words-free drawing, which is its own layer; a word is changed by double-clicking
// it and typing, and on a dark colour both the drawing and the words turn white.
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

const layers = (page) => page.evaluate(() => window.__editor.canvas.getObjects().map((o) => ({
  type: o.type, name: o.name, text: o.text, font: o.fontFamily, weight: String(o.fontWeight), fill: typeof o.fill === 'string' ? o.fill : '', left: Math.round(o.left), top: Math.round(o.top),
})));
const waitForWords = (page, n) => page.waitForFunction((k) => window.__editor.canvas.getObjects().filter((o) => o.type === 'i-text').length === k, n, { timeout: 30000 });
/** Where an object's centre is on the page. */
const onPage = (page, index) => page.evaluate((k) => {
  const ed = window.__editor;
  const o = ed.canvas.getObjects()[k];
  const r = ed.canvas.upperCanvasEl.getBoundingClientRect();
  const p = fabric.util.transformPoint(o.getCenterPoint(), ed.canvas.viewportTransform);
  return { x: r.left + (p.x * r.width) / ed.canvas.width, y: r.top + (p.y * r.height) / ed.canvas.height };
}, index);

test('"I\'m not arguing": the drawing without its words, then the four lines as text you can edit', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-not-arguing&color=white');
  try {
    await waitForWords(page, 4);
    const objs = await layers(page);
    assert.strictEqual(objs.length, 5, JSON.stringify(objs));
    assert.strictEqual(objs[0].name, 'art:not-arguing-nowords', 'the drawing, without its words, at the bottom');
    assert.notStrictEqual(objs[0].type, 'i-text');
    assert.deepStrictEqual(objs.slice(1).map((o) => [o.type, o.text, o.font]), [
      ['i-text', 'I’m not', 'Kalam'],
      ['i-text', 'ARGUING', 'Lilita One'],
      ['i-text', 'I’m just explaining why', 'Kalam'],
      ['i-text', 'I’M RIGHT', 'Lilita One'],
    ]);
    // In the drawing's order, top to bottom, the dark ink on a white T-shirt.
    const tops = objs.slice(1).map((o) => o.top);
    assert.deepStrictEqual([...tops].sort((a, b) => a - b), tops);
    for (const o of objs.slice(1)) assert.match(o.fill, /^#(16181d|000000)$/i, o.text);
    // The fonts really loaded (not a fallback): the editor measures with them.
    assert.ok(await page.evaluate(() => document.fonts.check('40px "Lilita One"') && document.fonts.check('bold 40px "Kalam"')));

    // Double-click "ARGUING" and type over it.
    await page.waitForTimeout(500);
    const at = await onPage(page, 2);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(() => { const o = window.__editor.canvas.getActiveObject(); return o && o.type === 'i-text' && o.isEditing; }, null, { timeout: 10000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('SHOUTING');
    await page.keyboard.press('Escape');
    const after = await layers(page);
    assert.deepStrictEqual(after.map((o) => o.text || o.name), ['art:not-arguing-nowords', 'I’m not', 'SHOUTING', 'I’m just explaining why', 'I’M RIGHT']);
    assert.strictEqual(after[2].font, 'Lilita One', 'the new words keep the font');
    assert.deepStrictEqual([after[0].left, after[0].top], [objs[0].left, objs[0].top], 'the drawing did not move');
    // A font from the editor's list can be chosen for it like for any text.
    assert.ok(await page.evaluate(() => window.POD_DESIGN.FONTS.english.includes('Lilita One') && window.POD_DESIGN.FONTS.english.includes('Yesteryear')));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('on a black T-shirt the white copy of the words-free drawing is used and the words are white', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-wrong-once&color=black');
  try {
    await waitForWords(page, 4);
    const objs = await layers(page);
    assert.strictEqual(objs[0].name, 'art:wrong-once-nowords-white');
    assert.deepStrictEqual(objs.slice(1).map((o) => o.text), ['I thought', 'I WAS WRONG ONCE...', 'But I Was', 'MISTAKEN']);
    for (const o of objs.slice(1)) assert.match(o.fill, /^#fff(fff)?$/i, o.text);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
