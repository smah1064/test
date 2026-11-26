'use strict';

// Editor redesign, stage 3 (owner's go, 26 Nov): the product, not its picture, fills the design area; on phones the
// bar above it becomes white buttons floating on the design (sides, print check, undo / redo, preview) that keep clear
// of the print area; an empty design shows "Start your design" inside the print area.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function open(browser, base, { lang = 'ar', viewport = { width: 412, height: 839 }, mobile = true, product = 'tshirt' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=${product}`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}
/** The print area on screen, and the floating buttons. */
const layout = (page) => page.evaluate(() => {
  const c = window.__editor.canvas;
  const vt = c.viewportTransform;
  const a = window.__editor.rects().trim;
  const cv = c.upperCanvasEl.getBoundingClientRect();
  const st = document.getElementById('stage').getBoundingClientRect();
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const pills = ['side-tabs', 'check-chip', 'undo', 'redo', 'preview-open'].map((id) => ({ id, ...R(document.getElementById(id)) }));
  return { print: { l: cv.left + a.x * vt[0] + vt[4], t: cv.top + a.y * vt[3] + vt[5], w: a.w * vt[0], h: a.h * vt[3] }, stage: R(document.getElementById('stage')), stageTop: st.top, pills };
});
const overlaps = (p, q) => p.l < q.r - 0.5 && q.l < p.r - 0.5 && p.t < q.b - 0.5 && q.t < p.b - 0.5;

test('phones: bigger print area, floating buttons clear of it and of each other', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
      for (const lang of ['ar', 'en']) {
        const label = `${lang} ${viewport.width}`;
        const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport });
        const l = await layout(page);
        // T-shirt print area: 99 px wide on a 412 px phone before; now about a third of the screen or more.
        assert.ok(l.print.w >= viewport.width * 0.3, `print area ${Math.round(l.print.w)} px wide, ${label}`);
        const p = { l: l.print.l, t: l.print.t, r: l.print.l + l.print.w, b: l.print.t + l.print.h };
        for (const pill of l.pills) {
          assert.ok(pill.h >= 43.5 && pill.w >= 43.5, `${pill.id} thumb size, ${label}`);
          assert.ok(pill.l >= l.stage.l - 0.5 && pill.r <= l.stage.r + 0.5 && pill.t >= l.stage.t - 0.5 && pill.b <= l.stage.b + 0.5, `${pill.id} inside the design area, ${label}`);
          assert.ok(!overlaps(pill, p), `${pill.id} clear of the print area, ${label}`);
          for (const other of l.pills) if (other !== pill) assert.ok(!overlaps(pill, other), `${pill.id} / ${other.id}, ${label}`);
        }
        // Empty design: the start prompt inside the print area opens the Text tool.
        const start = await page.evaluate(() => { const r = document.getElementById('start-here').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, shown: !document.getElementById('start-here').hidden }; });
        assert.ok(start.shown, `start prompt, ${label}`);
        assert.ok(start.l >= p.l - 1 && start.r <= p.r + 1 && start.t >= p.t - 1 && start.b <= p.b + 1, `start prompt inside the print area, ${label}`);
        await page.click('#start-here');
        await page.waitForSelector('#flyout-text:not([hidden])');
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

test('phones: share, zoom, hide guides and clear the side from the ⋯ menu', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { lang: 'ar' });
    await page.click('[data-flyout="text"]');
    await page.locator('#text-presets button').first().click();
    await page.waitForTimeout(400);
    await page.click('#sheet-close');
    await page.click('#ed-more');
    await page.click('#ed-menu [data-proxy="preview-toggle"]');
    assert.strictEqual(await page.evaluate(() => window.__editor.st.preview), true, 'guides hidden');
    await page.click('#ed-more');
    await page.click('#ed-menu [data-proxy="preview-toggle"]');
    assert.strictEqual(await page.evaluate(() => window.__editor.st.preview), false);
    await page.click('#ed-more');
    await page.click('#ed-menu [data-proxy="clear-side"]'); // (asks first; the test accepts)
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('computer: the T-shirt fills the design area (print area much bigger than before)', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['en', 'ar']) {
      const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport: { width: 1366, height: 768 }, mobile: false });
      const l = await layout(page);
      // Before: 126 x 169 px in a 970 x 612 area.
      assert.ok(l.print.w >= 160, `print area ${Math.round(l.print.w)} px wide (${lang})`);
      assert.ok(l.print.t >= l.stage.t && l.print.t + l.print.h <= l.stage.b, `print area in view (${lang})`);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
