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
  // The box round the drawing's visible pieces (not its whole frame).
  const pts = [];
  const ink = (x) => { const k = x._objects; if (k && k.length) { k.forEach(ink); return; } const d = x._getNonTransformedDimensions(); const m = x.calcTransformMatrix(); for (const [a, b] of [[-0.5, -0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5]]) pts.push(fabric.util.transformPoint(new fabric.Point(a * d.x, b * d.y), m)); };
  ink(o);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const box = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
  return { box, src: o.artSrc, light: o.artLight, recoloured: Boolean(o.artRecoloured), colours: [...new Set(leaves.filter((f) => typeof f === 'string').map((f) => new fabric.Color(f).toHex()))], cx: Math.round(c.x), cy: Math.round(c.y), angle: o.angle || 0, w: Math.round(o.getScaledWidth()), h: Math.round(o.getScaledHeight()) };
});

test('phone: the Santa drawing gets Colour (whole drawing) and Change drawing', { timeout: 150000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie', '&library=xm-ho-ho-ho&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((x) => x.type === 'group' && /^art:/.test(x.name || '')), null, { timeout: 30000 });
    const before = await art(page);
    assert.ok(before && before.src, 'the drawing remembers its art');
    // QA 28 Nov: the drawing a design opens with hugs its pieces (its box was the whole quote's frame).
    const hug = await page.evaluate(() => { const o = window.__editor.canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || '')); const r = o.getBoundingRect(true, true); return { trim: o.artTrim, w: r.width, h: r.height }; });
    assert.ok(hug.trim, 'trimmed');
    assert.ok(Math.abs(hug.w - (before.box.r - before.box.l)) <= 3 && Math.abs(hug.h - (before.box.b - before.box.t)) <= 3, JSON.stringify({ hug, box: before.box }));
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
    // QA 28 Nov: the new drawing never covers the words, stays inside the print area and is no bigger than the old one.
    const A = onBlack.box;
    const B = swapped.box;
    const layout = await page.evaluate(() => {
      const { canvas } = window.__editor;
      const words = canvas.getObjects().filter((x) => /text/i.test(x.type)).map((x) => x.getBoundingRect(true, true));
      const o = canvas.getObjects().find((x) => x.type === 'group' && /^art:/.test(x.name || ''));
      const r = o.getBoundingRect(true, true);
      return { words, r };
    });
    for (const w of layout.words) {
      const overlap = Math.max(0, Math.min(B.r, w.left + w.width) - Math.max(B.l, w.left)) * Math.max(0, Math.min(B.b, w.top + w.height) - Math.max(B.t, w.top));
      assert.ok(overlap <= 4, `covers the words: ${JSON.stringify({ B, w })}`);
    }
    assert.ok((B.r - B.l) <= (A.r - A.l) + 2 && (B.b - B.t) <= (A.b - A.t) + 2, 'no bigger than the old drawing');
    assert.ok(Math.abs(layout.r.width - (B.r - B.l)) <= 3 && Math.abs(layout.r.height - (B.b - B.t)) <= 3, `its box is its pieces: ${JSON.stringify({ r: layout.r, B })}`);
    // Only drawings that stand alone are offered.
    assert.ok(await page.$$eval('#el-strip [data-swapart], [data-swap-list] [data-swapart]', (l) => l.length) <= 10);
    // One Undo goes straight back to the drawing before the change (QA 28 Nov: the first Undo left no drawing).
    await page.evaluate(() => { const b = document.querySelector('#undo, [data-act="undo"], button[aria-label*="Undo"], button[aria-label*="تراجع"]'); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
    await page.waitForTimeout(800);
    const back = await art(page);
    assert.ok(back && back.src === onBlack.src, `one Undo: ${back && back.src}`);
    // The small pictures are cut to the drawing.
    const thumb = await page.evaluate(async (s) => { const r = await fetch('/api/art-thumb?src=' + encodeURIComponent(s)); return [r.status, r.headers.get('content-type')]; }, first);
    assert.deepStrictEqual(thumb, [200, 'image/webp']);
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
  // Only drawings that stand alone (one compact picture), without words, each with its white copy (QA 28 Nov).
  assert.ok(ok.items.length >= 2 && ok.items.every((a) => /-nowords\.svg$/.test(a.src) && /-nowords-white\.svg$/.test(a.dark)), JSON.stringify(ok.items));
  assert.ok(!ok.items.some((a) => /holiday-baking-team|merry-and-bright|season-greetings/.test(a.src)), 'no scattered decorations');
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
