'use strict';

// Editor redesign, stage 5 (owner's go, 26 Nov), phones: Text puts a heading straight onto the product, chosen, its
// sample words selected in the text box with the focus there (the keyboard opens on a real phone), so typing replaces
// them. Heading / subheading / line of text are one tap above it; "Ready styles" opens the full list. The computer
// keeps the list of styles.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function open(browser, base, { lang = 'ar', viewport = { width: 412, height: 839 }, mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=tshirt`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
const state = (page) => page.evaluate(() => {
  const c = window.__editor.canvas;
  const o = c.getActiveObject();
  const f = document.getElementById('p-text');
  return {
    objects: c.getObjects().length,
    selected: Boolean(o),
    text: o && o.text,
    size: o && o.fontSize,
    focus: document.activeElement && document.activeElement.id,
    wholeSelected: Boolean(f && f.selectionStart === 0 && f.selectionEnd === f.value.length && f.value.length > 0),
    kinds: [...document.querySelectorAll('.text-kinds [data-kind]')].filter((b) => b.offsetWidth).map((b) => b.dataset.kind + (b.classList.contains('active') ? '*' : '')),
  };
});

test('phones: Text puts a heading on the product, ready to type over; heading / subheading / line one tap away', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
        const label = `${lang} ${viewport.width}`;
        const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport });
        await page.click('.tools [data-flyout="text"]');
        await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'p-text');
        let s = await state(page);
        assert.strictEqual(s.objects, 1, label);
        assert.strictEqual(s.selected, true, label);
        assert.strictEqual(s.focus, 'p-text', label);
        assert.strictEqual(s.wholeSelected, true, `the sample words are selected, ${label}`);
        assert.deepStrictEqual(s.kinds, ['0*', '1', '2', 'all'], label);
        assert.strictEqual(await page.isVisible('#flyout-text'), false, 'no list in the way');
        const heading = s.size;
        // A line of text instead: smaller, still the sample, still ready to type over.
        await page.click('.text-kinds [data-kind="2"]');
        await page.waitForTimeout(300);
        s = await state(page);
        assert.ok(s.size < heading, `smaller (${s.size} < ${heading}), ${label}`);
        assert.deepStrictEqual(s.kinds, ['0', '1', '2*', 'all']);
        // Typing replaces the sample.
        await page.fill('#p-text', lang === 'ar' ? 'سارة' : 'Sara');
        await page.dispatchEvent('#p-text', 'input');
        assert.strictEqual((await state(page)).text, lang === 'ar' ? 'سارة' : 'Sara');
        // A heading again keeps the words typed.
        await page.click('.text-kinds [data-kind="0"]');
        await page.waitForTimeout(300);
        s = await state(page);
        assert.strictEqual(s.text, lang === 'ar' ? 'سارة' : 'Sara');
        assert.strictEqual(s.size, heading);
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

test('phones: "Ready styles" on an untouched sample swaps it for the full list', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { lang: 'ar' });
    await page.click('.tools [data-flyout="text"]');
    await page.waitForSelector('.text-kinds [data-kind="all"]');
    await page.click('.text-kinds [data-kind="all"]');
    await page.waitForSelector('#flyout-text:not([hidden])');
    assert.strictEqual((await state(page)).objects, 0, 'the untouched sample made room');
    await page.locator('#text-presets .text-preset').nth(4).click();
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('computer: Text still opens the list of styles', { timeout: 60000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { lang: 'en', viewport: { width: 1366, height: 768 }, mobile: false });
    await page.click('.tools [data-flyout="text"]');
    await page.waitForSelector('#flyout-text:not([hidden])');
    assert.strictEqual((await state(page)).objects, 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
