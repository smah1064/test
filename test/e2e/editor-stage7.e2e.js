'use strict';

// Editor redesign, stage 7 (owner's go, 26 Nov), computer (1200 px and wider): one 56 px top bar (logo, product and
// "Saved", undo / redo, Share, Live preview, account, cart, language); tool lists and the chosen element's settings in
// a panel docked beside the tools, whose room is always kept so choosing something never moves the product; the
// right-hand column always shows the product and the order; view controls float on the design area.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function open(browser, base, { lang = 'en', viewport = { width: 1366, height: 768 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=tshirt`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}
const R = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const overlap = (p, q) => p.l < q.r - 0.5 && q.l < p.r - 0.5 && p.t < q.b - 0.5 && q.t < p.b - 0.5;

test('computer: top bar, docked panel, fixed product column, floating view controls', { timeout: 150000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      for (const lang of ['en', 'ar']) {
        const label = `${lang} ${viewport.width}`;
        const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport });
        const top = await page.evaluate(() => ({
          header: getComputedStyle(document.querySelector('.site-header')).display,
          h: Math.round(document.getElementById('ed-top').getBoundingClientRect().height),
          inTop: ['undo', 'redo', 'share-open', 'preview-open'].every((id) => document.getElementById(id).closest('#ed-top') && document.getElementById(id).offsetWidth > 0),
        }));
        assert.deepStrictEqual(top, { header: 'none', h: 56, inTop: true }, label);
        // Nothing chosen: the Text list is docked; the product column shows the product.
        assert.strictEqual(await page.isVisible('#flyout-text'), true, label);
        assert.strictEqual(await page.isVisible('#swatches'), true, label);
        // Choosing a text: its settings in the docked panel; nothing moves; the product column stays.
        const before = await R(page, '.canvas-container');
        await page.locator('#text-presets button').first().click();
        await page.waitForSelector('#props-dock #p-text', { state: 'visible' });
        const after = await R(page, '.canvas-container');
        assert.ok(Math.abs(after.l - before.l) < 1 && Math.abs(after.t - before.t) < 1 && Math.abs(after.w - before.w) < 1, `the product stays where it is, ${label}`);
        assert.strictEqual(await page.evaluate(() => document.querySelector('.panel-scroll').firstElementChild.id), 'sec-product');
        assert.strictEqual(await page.isVisible('#swatches'), true);
        // The print area: in the free part of the design area, clear of the dock and of the floating controls.
        const pa = await page.evaluate(() => {
          const c = window.__editor.canvas; const vt = c.viewportTransform; const a = window.__editor.rects().trim; const cv = c.upperCanvasEl.getBoundingClientRect();
          const l = cv.left + a.x * vt[0] + vt[4]; const t = cv.top + a.y * vt[3] + vt[5];
          return { l, t, r: l + a.w * vt[0], b: t + a.h * vt[3], w: a.w * vt[0] };
        });
        assert.ok(pa.w >= 160, `print area ${Math.round(pa.w)} px, ${label}`);
        const dock = await R(page, '#props-dock');
        const stage = await R(page, '#stage');
        assert.ok(!overlap(pa, dock), `print area clear of the docked panel, ${label}`);
        assert.ok(pa.t >= stage.t && pa.b <= stage.b, `print area in view, ${label}`);
        for (const sel of ['.zoom-group', '#side-tabs', '#check-chip']) {
          const p = await R(page, sel);
          assert.ok(!overlap(p, pa), `${sel} clear of the print area, ${label}`);
          assert.ok(!overlap(p, dock), `${sel} clear of the docked panel, ${label}`);
        }
        // Layers from the rail, with Clear side.
        await page.click('.tools [data-flyout="layers"]');
        await page.waitForSelector('#flyout-layers #layers li', { state: 'visible' });
        assert.strictEqual(await page.isVisible('#flyout-layers [data-proxy-clear]'), true);
        assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `sideways, ${label}`);
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('computer: smaller windows (1024, 1180) keep the earlier layout, whole and without sideways scroll', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const width of [1024, 1180]) {
      const { ctx, page, errors } = await open(browser, srv.base, { viewport: { width, height: 768 } });
      assert.strictEqual(await page.isVisible('.site-header'), true);
      assert.strictEqual(await page.isVisible('#props-dock'), false);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
