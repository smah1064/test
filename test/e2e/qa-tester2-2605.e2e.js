'use strict';

// Tester 2's run at 9 am Cairo (26 Nov), in the browser: the SVG print file of a line with one bold word keeps what
// reaches below the line (Arabic dots, tails); the print-area arrows go back to the standard spot from 1 cm.
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

test('SVG print file: a line with one bold word is a picture with room below the text\'s box', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    const svg = await page.evaluate(async () => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const o = new fabric.IText('اسمي Ahmed عمري 25', { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000', fontFamily: 'Cairo' });
      ed.canvas.add(o);
      o.setSelectionStyles({ fontWeight: 'bold' }, 5, 10);
      ed.canvas.requestRenderAll();
      const r = o.getBoundingRect(true, true);
      const text = await ed.exportSvg(ed.st.product.sides[0]);
      return { text: typeof text === 'string' ? text : await text.text(), boxH: r.height, boxTop: r.top };
    });
    const m = svg.text.match(/<image [^>]*y="([\d.-]+)"[^>]*height="([\d.]+)"/);
    assert.ok(m, 'the line is a picture');
    assert.ok(Number(m[2]) > svg.boxH * 1.2, `picture ${m[2]} taller than the box ${Math.round(svg.boxH)}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('T-shirt: ↓ once, then ↑ is the standard spot again', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await page.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      ed.canvas.add(new fabric.IText('HI', { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' }));
      ed.canvas.fire('object:modified');
    });
    await page.waitForSelector('#place-field:not([hidden])', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[data-nudge="0,1"]').click());
    assert.match(await page.textContent('#place-info'), /1 cm lower/);
    await page.evaluate(() => document.querySelector('[data-nudge="0,-1"]').click());
    assert.strictEqual((await page.textContent('#place-info')).trim(), 'Standard position');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
