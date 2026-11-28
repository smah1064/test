'use strict';

// QA 28 Nov: the UV DTF wraps for clear glass showed an opaque white cup in 3D, and the Ramadan lanterns showed only
// their name plaque drawn as a big board. Now the wraps sit on see-through glass and the lanterns have no 3D tab.
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

test('UV DTF wraps: clear glass in 3D, the design on it', { timeout: 120000 }, async () => {
  for (const id of ['uvwrap16', 'uvwraptaper']) {
    const ctx = await newContext(browser);
    try {
      const page = await openEditor(ctx, srv.base, id);
      await page.evaluate(() => {
        const ed = window.__editor;
        const a = ed.st.product.sides[0].printArea;
        const t = new fabric.IText('Mariam', { fontFamily: 'Cairo', fontSize: 80, fill: '#e3122b', originX: 'center', originY: 'center', left: a.x + a.w / 2, top: a.y + a.h / 2 });
        ed.canvas.add(t);
        ed.canvas.fire('object:modified', { target: t });
      });
      await page.click('#preview-open');
      await page.waitForSelector('#pv:not([hidden])');
      await page.evaluate(() => { document.getElementById('pv-spin').checked = false; });
      await page.click('[data-pv-tab="3d"]');
      await page.waitForFunction(() => { const el = document.getElementById('pv-3d'); return el && el.__pod3d && el.querySelector('canvas'); }, null, { timeout: 30000 });
      await page.evaluate(() => document.getElementById('pv-3d').__pod3d.ready);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
      // The body is see-through: no large opaque white area on the cup.
      const look = await page.evaluate(() => {
        const cv = document.querySelector('#pv-3d canvas');
        const c = document.createElement('canvas');
        c.width = cv.width; c.height = cv.height;
        const x = c.getContext('2d');
        x.drawImage(cv, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let red = 0; let white = 0; let n = 0;
        for (let i = 0; i < d.length; i += 16) {
          n++;
          if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) red++;
          if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245 && d[i + 3] > 250) white++;
        }
        return { red: red / n, white: white / n };
      });
      assert.ok(look.red > 0.002, `${id}: the design shows (${JSON.stringify(look)})`);
      assert.strictEqual(await page.evaluate(() => (window.__editor.st.product.model || {}).finish), 'glass');
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  }
});

test('lanterns: no 3D tab', { timeout: 60000 }, async () => {
  for (const id of ['familyfanous', 'arabesquelantern']) {
    const ctx = await newContext(browser);
    try {
      const page = await openEditor(ctx, srv.base, id);
      await page.click('#preview-open');
      await page.waitForSelector('#pv:not([hidden])');
      assert.ok(await page.isHidden('[data-pv-tab="3d"]'), `${id}: no 3D tab`);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  }
});
