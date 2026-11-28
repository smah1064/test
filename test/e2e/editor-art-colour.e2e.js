'use strict';

// Owner, 28 Nov (QA chat, the owner's iPhone): a ready design's drawing (the Santa in "Ho! Ho! Ho!") could not be
// recoloured or swapped: only Delete / Duplicate / Ungroup. Now: Colour recolours the whole drawing at once (and it then
// stays as coloured when the product colour changes), and Change drawing offers the pack's other drawings, put in at
// the same place, size, turn and colour.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, openEditor } = require('./helpers');

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

const art = (page) => page.evaluate(() => {
  const o = window.__editor.canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || ''));
  if (!o) return null;
  const leaves = [];
  const walk = (x) => { const k = x._objects; if (k && k.length) k.forEach(walk); else leaves.push(x.fill); };
  walk(o);
  const c = o.getCenterPoint();
  return { src: o.artSrc, light: o.artLight, recoloured: Boolean(o.artRecoloured), colours: [...new Set(leaves.filter((f) => typeof f === 'string').map((f) => new fabric.Color(f).toHex()))], cx: Math.round(c.x), cy: Math.round(c.y), angle: o.angle || 0, w: Math.round(o.getScaledWidth()), h: Math.round(o.getScaledHeight()) };
});

test('phone: the Santa drawing gets Colour (whole drawing) and Change drawing', { timeout: 150000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie', '&library=xm-ho-ho-ho&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((x) => x.type === 'group' && /^art:/.test(x.name || '')), null, { timeout: 30000 });
    const before = await art(page);
    assert.ok(before && before.src, 'the drawing remembers its art');
    await page.evaluate(() => {
      const { canvas } = window.__editor;
      const o = canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || ''));
      canvas.setActiveObject(o);
      canvas.fire('selection:created', { selected: [o] });
    });
    await page.waitForSelector('#el-bar [data-el="colour"]', { timeout: 10000 });
    assert.ok(await page.$('#el-bar [data-el="swap"]'), 'Change drawing in the bar');
    // Colour: every piece at once.
    await page.click('#el-bar [data-el="colour"]');
    await page.click('#el-strip [data-pal="fill"][data-c]:nth-child(3)');
    await page.waitForTimeout(300);
    const coloured = await art(page);
    assert.strictEqual(coloured.colours.length, 1, `one colour: ${coloured.colours}`);
    assert.notDeepStrictEqual(coloured.colours, before.colours, 'recoloured');
    assert.ok(coloured.recoloured, 'counts as recoloured by hand');
    // The product turns black: a drawing coloured by hand stays as coloured (no white copy swapped in).
    await page.evaluate(() => { const b = document.querySelector('[data-color="black"]'); if (b) b.click(); });
    await page.waitForTimeout(1500);
    assert.strictEqual(await page.evaluate(() => window.__editor.st.colorId), 'black', 'the hoodie is black now');
    const onBlack = await art(page);
    assert.deepStrictEqual(onBlack.colours, coloured.colours, 'kept the colour');
    // Change drawing: another drawing of the pack, same place, turn and colour, fitted in the same box.
    await page.evaluate(() => { const { canvas } = window.__editor; const o = canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || '')); canvas.setActiveObject(o); canvas.fire('selection:created', { selected: [o] }); });
    await page.click('#el-bar [data-el="swap"]');
    await page.waitForSelector('#el-strip [data-swapart]', { timeout: 10000 });
    const first = await page.getAttribute('#el-strip [data-swapart]', 'data-swapart');
    await page.click('#el-strip [data-swapart]');
    await page.waitForFunction((s) => window.__editor.canvas.getObjects().some((x) => x.artSrc === s), first, { timeout: 10000 });
    const swapped = await art(page);
    assert.strictEqual(swapped.src, first);
    assert.ok(Math.abs(swapped.cx - onBlack.cx) <= 2 && Math.abs(swapped.cy - onBlack.cy) <= 2, 'same place');
    assert.ok(swapped.w <= onBlack.w + 2 && swapped.h <= onBlack.h + 2 && (Math.abs(swapped.w - onBlack.w) <= 2 || Math.abs(swapped.h - onBlack.h) <= 2), 'fitted in the same box');
    assert.deepStrictEqual(swapped.colours, coloured.colours, 'same colour');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('licensed art and stickers: no Colour, no Change drawing; the art list refuses licensed folders', async () => {
  const r = await fetch(`${srv.base}/api/art-similar?src=${encodeURIComponent('/img/art/licensed-spiderman/x.svg')}`);
  assert.strictEqual(r.status, 404);
  const ok = await (await fetch(`${srv.base}/api/art-similar?src=${encodeURIComponent('/img/art/christmas/ho-ho-ho-nowords.svg')}`)).json();
  assert.ok(ok.items.length > 5 && ok.items.every((a) => /-nowords\.svg$/.test(a.src) && /-nowords-white\.svg$/.test(a.dark)), 'drawings without words, each with its white copy');
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie', '&library=xm-ho-ho-ho&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((x) => x.type === 'group' && /^art:/.test(x.name || '')), null, { timeout: 30000 });
    // The same drawing marked as licensed artwork: left exactly as supplied.
    const items = await page.evaluate(() => {
      const { canvas } = window.__editor;
      const o = canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || ''));
      o.set({ artSrc: '/img/art/licensed-spiderman/spidey.svg', artDark: '/img/art/licensed-spiderman/spidey-white.svg' });
      canvas.setActiveObject(o);
      canvas.fire('selection:created', { selected: [o] });
      return [...document.querySelectorAll('#el-bar [data-el]')].map((b) => b.dataset.el);
    });
    assert.ok(!items.includes('colour') && !items.includes('swap'), `licensed: ${items}`);
    assert.strictEqual(await page.$('#p-artfill'), null, 'no colour in the settings');
  } finally {
    await ctx.close();
  }
});
