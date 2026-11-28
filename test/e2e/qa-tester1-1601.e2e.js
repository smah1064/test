'use strict';

// QA tester 1 (25 Nov, 4:01 pm Cairo run): Undo got stuck after a light/dark garment colour change, and colouring
// one word coloured the wrong letters when an emoji came before it.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

test('undo keeps going back after a light/dark colour change; one word coloured right after an emoji', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    const count = () => page.evaluate(() => window.__editor.canvas.getObjects().length);
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    await page.fill('#p-text', 'first');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#text-presets [data-i="1"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 2);
    await page.waitForTimeout(500);
    await page.click('#swatches [data-color="black"]');
    await page.waitForTimeout(500);
    // Undo, again and again: it goes back through the edits (it used to stay where it was).
    const seen = [];
    for (let i = 0; i < 6; i++) {
      // (Greyed out once there's nothing more to undo.)
      if (await page.isDisabled('#undo')) break;
      await page.click('#undo');
      await page.waitForTimeout(350);
      seen.push(await count());
    }
    assert.ok(seen.includes(1), `undo removed the second text: ${seen.join(',')}`);
    assert.strictEqual(seen[seen.length - 1], 0, `and went back to the empty side: ${seen.join(',')}`);
    // Redo comes forward again.
    await page.click('#redo');
    await page.waitForTimeout(350);
    assert.ok((await count()) >= 1, 'redo works');

    // One word coloured after emoji: the word itself, nothing else.
    const mug = await openEditor(ctx, srv.base, 'mug');
    await mug.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await mug.waitForFunction(() => window.__editor.canvas.getActiveObject());
    await mug.fill('#p-text', '😀😀 hello world');
    await mug.waitForSelector('.word-chips [data-word]');
    await mug.evaluate(() => [...document.querySelectorAll('.word-chips [data-word]')].find((c) => c.textContent.trim() === 'hello').click());
    await mug.waitForSelector('#p-wordcolor');
    await mug.evaluate(() => { const c = document.getElementById('p-wordcolor'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); });
    const red = await mug.evaluate(() => {
      const o = window.__editor.canvas.getActiveObject();
      const g = fabric.util.string.graphemeSplit(o.text);
      return g.map((ch, i) => ((o.getStyleAtPosition(i) || {}).fill === '#ff0000' ? ch : ' ')).join('').trim();
    });
    assert.strictEqual(red, 'hello');
    assert.deepStrictEqual(page.errors, []);
    assert.deepStrictEqual(mug.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
