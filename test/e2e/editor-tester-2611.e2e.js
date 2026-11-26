'use strict';

// Tester 1 (4 pm Cairo, 26 Nov), the editor redesign's loose ends: no lone "Front" pill on a one-sided product on a
// computer; an empty design's check list says "Nothing to check yet" (not "Everything will print sharp"); the phone's
// ⋯ menu closes when its language button is used; a text emptied and left is taken away; a restored draft shows
// "Saved"; phone messages sit above the floating Undo / Live preview; a ready design's SVG carries the shop's artwork.
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
const desk = (lang = 'en') => browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 }).then(async (c) => { await c.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* */ } }, lang); return c; });
const phone = (lang = 'ar') => browser.newContext(loadPlaywright().devices['Pixel 7']).then(async (c) => { await c.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* */ } }, lang); return c; });

test('computer: a one-sided product has no lone "Front" pill; an empty design\'s check says "Nothing to check yet" only', { timeout: 90000 }, async () => {
  const ctx = await desk();
  try {
    const products = (await (await fetch(`${srv.base}/api/products`)).json()).products;
    const one = products.find((p) => p.sides.length === 1 && !p.paged && !p.embroidery);
    assert.ok(one, 'a one-sided product');
    const page = await openEditor(ctx, srv.base, one.id);
    assert.strictEqual(await page.isVisible('#side-tabs'), false, `${one.id}: no lone pill`);
    const two = await openEditor(ctx, srv.base, 'tshirt');
    assert.strictEqual(await two.isVisible('#side-tabs'), true, 'a T-shirt keeps Front / Back');
    const list = await two.textContent('#check-list');
    assert.match(list, /Nothing to check yet/);
    assert.doesNotMatch(list, /print sharp/);
    await two.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await two.waitForFunction(() => /print sharp|sample/i.test(document.getElementById('check-list').textContent));
    assert.deepStrictEqual([...page.errors, ...two.errors], []);
  } finally {
    await ctx.close();
  }
});

test('phone: the ⋯ menu closes after its language button; an emptied new heading is taken away; messages clear Undo and Live preview', { timeout: 90000 }, async () => {
  const ctx = await phone('ar');
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await page.click('#ed-more');
    await page.waitForSelector('#ed-menu:not([hidden])');
    await page.click('#ed-menu [data-lang-toggle]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.strictEqual(await page.isHidden('#ed-menu'), true, 'the menu closed');
    // Text: a heading ready to type; emptied, then left.
    await page.click('.tools [data-flyout="text"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    await page.fill('#p-text', '');
    await page.locator('#p-text').dispatchEvent('input');
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); const c = window.__editor.canvas; c.discardActiveObject(); c.requestRenderAll(); });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 0);
    // A message (nothing designed, Add to cart) sits above the floating buttons.
    await page.evaluate(() => document.getElementById('add-to-cart').click());
    await page.waitForSelector('#toast-root .toast');
    const pos = await page.evaluate(() => ({ toast: document.querySelector('#toast-root .toast').getBoundingClientRect().bottom, undo: document.getElementById('undo').getBoundingClientRect().top, preview: document.getElementById('preview-open').getBoundingClientRect().top }));
    assert.ok(pos.toast <= pos.undo && pos.toast <= pos.preview, JSON.stringify(pos));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('phone: a restored draft shows "Saved"', { timeout: 90000 }, async () => {
  const ctx = await phone('en');
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForSelector('#ed-saved:not([hidden])', { timeout: 15000 });
    await page.reload();
    await page.waitForFunction(() => window.__editor && window.__editor.canvas.getObjects().length === 1, null, { timeout: 30000 });
    await page.waitForSelector('#ed-saved:not([hidden])', { timeout: 5000 });
  } finally {
    await ctx.close();
  }
});

test('a ready design\'s SVG print file carries the shop\'s artwork (no empty picture)', { timeout: 90000 }, async () => {
  const ctx = await desk();
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=xm-trees-holly-plaid&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.type === 'image'), null, { timeout: 30000 });
    const svg = await page.evaluate(async () => { const ed = window.__editor; return ed.exportSvg(ed.st.product.sides[0]); });
    const hrefs = [...svg.matchAll(/<image[^>]*href="([^"]{0,60})/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0, 'a picture');
    assert.ok(hrefs.every((h) => h.startsWith('data:image/')), JSON.stringify(hrefs));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
