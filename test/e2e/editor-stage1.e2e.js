'use strict';

// Editor redesign, stage 1 (owner's go, 26 Nov): one look, the basics first, thumb-size controls.
// Phones: the text's words, font, size and colour come first; every control in the bars and sheets is at least
// 44 x 44 px; the print check says what it means in words; one piece is a − / + counter with the size-and-colour
// table one tap away; text boxes are 16 px (an iPhone zooms the page into smaller ones).
// Computer: Escape, or a click on the grey around the product, takes the selection off; the quantity table fits.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function openEditor(browser, base, { lang = 'ar', viewport = { width: 412, height: 839 }, mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=tshirt`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
async function addText(page) {
  await page.click('.tools [data-flyout="text"]');
  // (Phones, editor redesign stage 5: Text adds a heading at once; the computer opens the list of styles.)
  if (await page.isVisible('#flyout-text')) await page.locator('#text-presets button').first().click();
  await page.waitForSelector('#p-text');
  await page.waitForSelector('#p-text');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(300);
}
/** Visible controls in the editor's bars and sheet that are smaller than 44 x 44 px (the site header is stage 2). */
const smallControls = (page) => page.evaluate(() => {
  const out = [];
  const roots = document.querySelectorAll('.tools, .stage-bar, .panel');
  roots.forEach((root) => root.querySelectorAll('button, summary, select, input:not([type=checkbox]):not([type=range]), textarea').forEach((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.visibility === 'hidden' || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return;
    // Colour dots and swatches keep their drawn size; an invisible ring around them makes the tap area 44 px.
    if (e.matches('.pal, .swatch')) {
      const ring = e.matches('.pal') ? getComputedStyle(e, '::after') : getComputedStyle(e, '::before');
      const grow = -parseFloat(ring.top || '0') * 2;
      if (ring.content !== 'none' && r.width + grow >= 43.5 && r.height + grow >= 43.5) return;
    }
    if (e.matches('.qty-chip, .buy-sum') && getComputedStyle(e, '::after').content !== 'none') return;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${e.tagName.toLowerCase()}#${e.id}.${String(e.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }));
  return out;
});

test('phones: the text settings start with words, font, size and colour; every control is thumb size', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
      for (const lang of ['ar', 'en']) {
        const { ctx, page, errors } = await openEditor(browser, srv.base, { lang, viewport });
        const label = `${lang} ${viewport.width}`;
        assert.deepStrictEqual(await smallControls(page), [], `nothing selected, ${label}`);
        await addText(page);
        // Order on screen: words, font, size, colour; move / copy / order / delete after them.
        const tops = await page.evaluate(() => {
          const top = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
          return { words: top('#p-text'), font: top('#p-font-picker'), size: top('#p-size'), colour: top('.basic-colour [data-pal="fill"]'), actions: top('.quick-actions') };
        });
        assert.ok(tops.words < tops.font && tops.font < tops.size && tops.size < tops.colour && tops.colour < tops.actions, `order ${label}: ${JSON.stringify(tops)}`);
        assert.deepStrictEqual(await smallControls(page), [], `text selected, ${label}`);
        // 16 px in every text box (no iPhone zoom).
        const fonts = await page.evaluate(() => [...document.querySelectorAll('.panel textarea, .panel input[type=text], .panel select')].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
        assert.ok(fonts.length && fonts.every((f) => f >= 16), `text boxes ${label}: ${fonts}`);
        // The size's − and + step it; a colour dot colours the text.
        const before = await page.evaluate(() => window.__editor.canvas.getActiveObject().fontSize);
        await page.click('[data-numstep="1"][data-for="p-size"]');
        assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fontSize), before + 2);
        await page.click('.basic-colour [data-pal="fill"][data-c="#e03131"]');
        assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fill), '#e03131');
        // The print check in words (on the design, once the settings sheet is closed: stage 3 floats it there).
        await page.click('#sheet-close');
        await page.waitForTimeout(200);
        const chip = await page.evaluate(() => { const s = document.querySelector('#check-chip span'); return s && s.offsetWidth > 0 ? s.textContent.trim() : ''; });
        assert.ok(chip.length > 3, `check chip words ${label}: "${chip}"`);
        // No sideways scroll.
        assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `sideways ${label}`);
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('phones: one piece is a − / + counter; the size-and-colour table is one tap away', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await openEditor(browser, srv.base, { lang: 'ar' });
    await page.click('[data-sheet="product"]');
    await page.waitForSelector('#qty-field .qty-step .qty-n');
    // The extra price of the bigger sizes is on the label line; the chips are the sizes alone, in one row.
    const sizes = await page.evaluate(() => ({ note: document.getElementById('size-note').textContent, chips: [...document.querySelectorAll('#sizes .chip')].map((c) => c.textContent.trim()), rows: new Set([...document.querySelectorAll('#sizes .chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size }));
    assert.match(sizes.note, /2XL/);
    assert.deepStrictEqual(sizes.chips, ['S', 'M', 'L', 'XL', '2XL', '3XL']);
    assert.strictEqual(sizes.rows, 1);
    await page.click('#sizes [data-size="M"]');
    await page.click('#qty-field [data-qstep="1"]');
    await page.click('#qty-field [data-qstep="1"]');
    assert.strictEqual(await page.textContent('#qty-field .qty-n'), '٣');
    // The table, to add another size.
    await page.click('#qty-field [data-qgrid]');
    await page.waitForSelector('#qty-field .qty-in[data-qz="M"]');
    assert.strictEqual(await page.inputValue('#qty-field .qty-in[data-qz="M"]'), '3');
    await page.fill('#qty-field .qty-in[data-qz="L"]', '2');
    await page.dispatchEvent('#qty-field .qty-in[data-qz="L"]', 'change');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#qty-chip'), /٥/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('computer: Escape and a click on the grey around the product take the selection off; the quantity table fits the panel', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const lang of ['en', 'ar']) {
      const { ctx, page, errors } = await openEditor(browser, srv.base, { lang, viewport: { width: 1366, height: 768 }, mobile: false });
      const selected = () => page.evaluate(() => Boolean(window.__editor.canvas.getActiveObject()));
      await addText(page);
      await page.click('.flyout:not([hidden]) .fly-close').catch(() => {});
      assert.strictEqual(await selected(), true);
      await page.keyboard.press('Escape');
      assert.strictEqual(await selected(), false, 'Escape');
      await page.waitForSelector('#sec-product', { state: 'visible' });
      // Select again, then click the grey area beside the canvas.
      await page.evaluate(() => { const c = window.__editor.canvas; c.setActiveObject(c.getObjects()[0]); c.requestRenderAll(); });
      // (Away from the panel docked beside the tools: stage 7.)
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.click(lang === 'ar' ? box.x + 12 : box.x + box.width - 12, box.y + box.height - 12);
      assert.strictEqual(await selected(), false, 'click on the grey');
      // The quantity table: every box inside the panel.
      const fits = await page.evaluate(() => {
        const panel = document.querySelector('.panel-scroll').getBoundingClientRect();
        return [...document.querySelectorAll('#qty-field .qty-in')].every((i) => { const r = i.getBoundingClientRect(); return r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5; });
      });
      assert.strictEqual(fits, true, `quantity table fits (${lang})`);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
