'use strict';

// Editor redesign, stage 4 (owner's go, 26 Nov), phones: five wide tools (Text, Image, Templates, Stickers, More); the
// rarer tools are in More, each with a line saying what it does. The tools can sit just above the price bar, switched
// on per phone with ?tools=bottom until it has been checked on real Android phones (?tools=top switches it off).
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function open(browser, base, { lang = 'ar', viewport = { width: 412, height: 839 }, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=tshirt${query}`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
/** The tools a customer sees, in reading order (right to left in Arabic). */
const tools = (page) => page.evaluate(() => {
  const shown = [...document.querySelectorAll('.tools .tool')].filter((b) => b.offsetWidth > 0);
  shown.sort((a, b) => (document.dir === 'rtl' ? b.getBoundingClientRect().left - a.getBoundingClientRect().left : a.getBoundingClientRect().left - b.getBoundingClientRect().left));
  return { names: shown.map((b) => b.dataset.flyout || b.dataset.sheet || b.id), small: shown.filter((b) => b.offsetWidth < 44 || b.offsetHeight < 44).length };
});

test('phones: five tools; More lists the rest and opens them', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
        const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport });
        assert.deepStrictEqual(await tools(page), { names: ['text', 'upload', 'templates', 'stickers', 'more'], small: 0 }, `${lang} ${viewport.width}`);
        await page.click('.tools [data-flyout="more"]');
        const rows = await page.$$eval('#flyout-more .more-row', (xs) => xs.filter((x) => !x.hidden).map((x) => ({ k: x.dataset.more, note: x.querySelector('small').textContent.length > 5, h: x.offsetHeight >= 44 })));
        assert.deepStrictEqual(rows.map((r) => r.k), ['shapes', 'library', 'layers', 'place']);
        assert.ok(rows.every((r) => r.note && r.h));
        await page.click('#flyout-more [data-more="shapes"]');
        await page.waitForSelector('#flyout-shapes:not([hidden])');
        assert.strictEqual(await page.isVisible('#flyout-more'), false);
        await page.click('#flyout-shapes .fly-close');
        await page.click('.tools [data-flyout="more"]');
        await page.click('#flyout-more [data-more="layers"]');
        await page.waitForSelector('#sec-layers', { state: 'visible' });
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('phones: ?tools=bottom puts the tools just above the price bar (and stays on); ?tools=top puts them back', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { query: '&tools=bottom' });
    const where = () => page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { toolsTop: Math.round(r('.tools').top), toolsBottom: Math.round(r('.tools').bottom), stageBottom: Math.round(r('.stage-wrap').bottom), footTop: Math.round(r('.panel-foot').top), footBottom: Math.round(r('.panel-foot').bottom), h: innerHeight };
    });
    let w = await where();
    assert.ok(w.toolsTop >= w.stageBottom - 1 && w.toolsBottom <= w.footTop + 1, `tools between the design and the price bar: ${JSON.stringify(w)}`);
    assert.ok(w.footBottom <= w.h + 0.5, 'the price bar is on screen');
    // Kept on this phone.
    await page.goto(`${srv.base}/editor?product=tshirt`);
    await page.waitForFunction(() => window.__editor);
    w = await where();
    assert.ok(w.toolsTop >= w.stageBottom - 1, 'still at the bottom');
    await page.goto(`${srv.base}/editor?product=tshirt&tools=top`);
    await page.waitForFunction(() => window.__editor);
    w = await where();
    assert.ok(w.toolsBottom <= 120, `back at the top: ${JSON.stringify(w)}`);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
