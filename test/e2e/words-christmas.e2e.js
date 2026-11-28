'use strict';

// Christmas quotes in the editor: the drawn words are ordinary text (double-tap to type), the drawing its own layer.
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
  type: o.type, name: o.name, text: o.text, font: o.fontFamily, fill: o.fill,
  box: (({ left, top, width, height }) => ({ left, top, width, height }))(o.getBoundingRect(true, true)),
  centre: o.getCenterPoint(),
})));

test('"It’s cold outside": the drawing without its words, then the words as text in Cookie, editable', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M&library=xm-cold-outside');
  try {
    await page.waitForFunction(() => window.__editor.canvas.getObjects().filter((o) => o.type === 'i-text').length === 3, null, { timeout: 20000 });
    const objs = await layers(page);
    assert.deepStrictEqual(objs.map((o) => o.type), ['group', 'i-text', 'i-text', 'i-text']);
    assert.strictEqual(objs[0].name, 'art:cold-outside-nowords');
    assert.deepStrictEqual(objs.slice(1).map((o) => [o.text, o.font, o.fill]), [['It’s', 'Cookie', '#16181d'], ['Cold', 'Cookie', '#16181d'], ['Outside', 'Cookie', '#16181d']]);
    // Top to bottom. (The drawing's box hugs its own pieces now, not the whole quote's frame: QA 28 Nov.)
    assert.ok(await page.evaluate(() => window.__editor.canvas.getObjects()[0].artTrim), 'the drawing is cut to its pieces');
    assert.ok(objs[1].centre.y < objs[2].centre.y && objs[2].centre.y < objs[3].centre.y);
    // Double-click "Cold" and type.
    const at = await page.evaluate(() => {
      const ed = window.__editor;
      const t = ed.canvas.getObjects().find((o) => o.text === 'Cold');
      const p = fabric.util.transformPoint(t.getCenterPoint(), ed.canvas.viewportTransform);
      const r = ed.canvas.upperCanvasEl.getBoundingClientRect();
      const k = r.width / ed.canvas.getWidth();
      return { x: r.left + p.x * k, y: r.top + p.y * k };
    });
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(() => { const a = window.__editor.canvas.getActiveObject(); return a && a.type === 'i-text' && a.isEditing; }, null, { timeout: 5000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Warm');
    await page.evaluate(() => window.__editor.canvas.getActiveObject().exitEditing());
    const after = await layers(page);
    assert.deepStrictEqual(after.filter((o) => o.type === 'i-text').map((o) => o.text), ['It’s', 'Warm', 'Outside']);
    assert.strictEqual(after[0].name, 'art:cold-outside-nowords', 'the drawing is untouched');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('on a black T-shirt: the white drawing without its words, the words in white', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt', '&color=black&size=M&library=xm-jingle-bells');
  try {
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.type === 'i-text'), null, { timeout: 20000 });
    const objs = await layers(page);
    assert.deepStrictEqual(objs.map((o) => [o.type, o.name]), [['group', 'art:jingle-bells-nowords-white'], ['i-text', 'Text']]);
    assert.deepStrictEqual([objs[1].text, objs[1].font, objs[1].fill], ['Jingle\nBells', 'Dancing Script', '#ffffff']);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
