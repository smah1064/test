'use strict';

// Editor redesign, stage 6 (owner's go, 26 Nov), phones: a chosen element gets its own tools in place of the tool row
// (Done, Font, Size, Colour, Style, Format, More for a text) and each opens one short strip while the product stays
// big; More opens the full settings; Done takes the selection off and the tool row comes back.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function open(browser, base, { lang = 'ar', viewport = { width: 412, height: 839 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
const obj = (page) => page.evaluate(() => { const o = window.__editor.canvas.getActiveObject(); return o ? { font: o.fontFamily, fill: o.fill, size: o.fontSize, weight: o.fontWeight } : null; });

test('phones: a chosen text has its own tools and short strips; the product stays big', { timeout: 150000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
        const label = `${lang} ${viewport.width}`;
        const { ctx, page, errors } = await open(browser, srv.base, { lang, viewport });
        await page.click('.tools [data-flyout="text"]');
        await page.waitForSelector('#p-text');
        await page.fill('#p-text', lang === 'ar' ? 'سارة' : 'Sara');
        await page.dispatchEvent('#p-text', 'input');
        await page.evaluate(() => document.activeElement.blur());
        await page.click('#sheet-close');
        // The text's own tools, in place of the tool row.
        const bar = await page.evaluate(() => ({
          tools: getComputedStyle(document.querySelector('.tools')).display,
          items: [...document.querySelectorAll('#el-bar [data-el]')].map((b) => b.dataset.el),
          small: [...document.querySelectorAll('#el-bar [data-el]')].filter((b) => b.offsetWidth < 43.5 || b.offsetHeight < 43.5).length,
          inside: [...document.querySelectorAll('#el-bar [data-el]')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
        }));
        assert.deepStrictEqual(bar, { tools: 'none', items: ['done', 'font', 'size', 'colour', 'fx', 'format', 'more'], small: 0, inside: true }, label);
        // Font strip: a card changes the font.
        await page.click('#el-bar [data-el="font"]');
        await page.waitForSelector('#el-strip:not([hidden]) .font-card');
        const before = await obj(page);
        const other = await page.$eval('#el-strip .font-card:not(.active)', (b) => b.dataset.font);
        await page.click(`#el-strip .font-card[data-font="${other}"]`);
        await page.waitForFunction((f) => window.__editor.canvas.getActiveObject().fontFamily === f, other);
        // With a strip open the design area keeps most of the screen (the settings sheet left it 260 px on 839).
        const room = await page.evaluate(() => document.querySelector('.stage-wrap').getBoundingClientRect().height);
        assert.ok(room >= viewport.height * 0.5, `design area ${Math.round(room)} px, ${label}`);
        // Colour, size, format.
        await page.click('#el-bar [data-el="colour"]');
        await page.click('#el-strip [data-pal="fill"][data-c="#e03131"]');
        assert.strictEqual((await obj(page)).fill, '#e03131');
        await page.click('#el-bar [data-el="size"]');
        await page.click('#el-strip [data-strip-step="2"]');
        assert.strictEqual((await obj(page)).size, before.size + 2);
        await page.click('#el-bar [data-el="format"]');
        await page.click('#el-strip [data-toggle="bold"]');
        // (Bold loads the font's bold letters first.)
        await page.waitForFunction((w) => window.__editor.canvas.getActiveObject().fontWeight !== w, before.weight, { timeout: 5000 });
        // More: the full settings; Done: nothing chosen, the tool row back.
        await page.click('#el-bar [data-el="more"]');
        await page.waitForSelector('#p-text', { state: 'visible' });
        await page.click('#el-bar [data-el="done"]');
        assert.strictEqual(await obj(page), null);
        assert.notStrictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.tools')).display), 'none');
        assert.strictEqual(await page.isVisible('#el-bar'), false);
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

test('phones: a sticker gets Done and More; its bubble has copy and delete', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { lang: 'ar' });
    await page.click('.tools [data-flyout="stickers"]');
    await page.locator('#sticker-grid [data-sticker]').first().click();
    await page.waitForFunction(() => window.__editor.canvas.getActiveObject());
    await page.waitForTimeout(400);
    assert.deepStrictEqual(await page.$$eval('#el-bar [data-el]', (xs) => xs.map((x) => x.dataset.el)), ['done', 'more']);
    assert.deepStrictEqual(await page.$$eval('#float-bar [data-fb]', (xs) => xs.map((x) => x.dataset.fb)), ['duplicate', 'delete']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('phones: Crop from a photo\'s own bar shows Cancel, Free, Square and Apply, and Apply ends it', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await open(browser, srv.base, { lang: 'en', viewport: { width: 360, height: 740 } });
    // A plain 600 x 400 PNG (built in the page, no file on disk).
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#3b82f6'; g.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#file-input', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.type === 'image'), null, { timeout: 20000 });
    await page.waitForSelector('#el-bar [data-el="crop"]');
    await page.click('#el-bar [data-el="crop"]');
    assert.deepStrictEqual(await page.$$eval('#el-bar [data-el]', (xs) => xs.map((x) => x.dataset.el)), ['crop-cancel', 'crop-free', 'crop-square', 'crop-apply']);
    await page.click('#el-bar [data-el="crop-square"]');
    await page.click('#el-bar [data-el="crop-apply"]');
    await page.waitForSelector('#el-bar [data-el="crop"]');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
