'use strict';

// Tester 2's run at 7 am Cairo (26 Nov), in the browser: Cancel on "switch product?" keeps the price as it was;
// messages don't block the button under them, a new message clears the old errors, and a language switch clears
// them; the searched words in "no designs match" keep their order; a few copies that cost more than a bigger pack get
// a tip; the live preview's tabs fit a 360px Arabic phone.
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
const addText = (page, text, side) => page.evaluate(([s, sd]) => {
  const ed = window.__editor;
  const a = (ed.st.product.sides.find((x) => x.id === sd) || ed.st.product.sides[0]).printArea;
  const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
  ed.canvas.add(o);
  ed.canvas.fire('object:modified', { target: o });
}, [text, side]);

test('menus with glossy lamination: Cancel on "switch product?" keeps the price with the lamination', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(`${srv.base}/editor?product=menus`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
    // An option with a price (glossy lamination +50).
    const opt = await page.$('[data-opt][data-choice]:not(.active)');
    assert.ok(opt, 'an option to pick');
    const before = await page.textContent('#price');
    await opt.click();
    await page.waitForFunction((b) => document.getElementById('price').textContent !== b, before, { timeout: 5000 });
    await addText(page, 'FRONT', 'front');
    await page.evaluate(() => document.querySelector('[data-side="back"]') && document.querySelector('[data-side="back"]').click());
    await page.waitForTimeout(300);
    await addText(page, 'BACK', 'back');
    await page.waitForTimeout(300);
    const priceBefore = await page.textContent('#price');
    await page.selectOption('#product-select', 'poster');
    await page.waitForTimeout(800);
    assert.strictEqual(await page.evaluate(() => window.__editor.st.product.id), 'menus');
    assert.strictEqual(await page.textContent('#price'), priceBefore, 'the same price as before');
  } finally {
    await ctx.close();
  }
});

test('messages: taps go through them, a new one clears the old errors, a language switch clears them', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/account`);
    await page.waitForFunction(() => window.POD && POD.toast);
    await page.evaluate(() => { POD.toast('Password too common', 'error'); POD.toast('Still too common', 'error'); });
    assert.strictEqual(await page.locator('#toast-root .toast.error').count(), 1, 'one error at a time');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#toast-root .toast')).pointerEvents), 'none');
    assert.strictEqual(await page.getAttribute('#toast-root .toast', 'dir'), 'auto');
    await page.evaluate(() => POD.toast('Account created ✓'));
    assert.strictEqual(await page.locator('#toast-root .toast.error').count(), 0, 'the old error went with the success');
    await page.evaluate(() => POD.setLang('ar'));
    assert.strictEqual(await page.locator('#toast-root .toast').count(), 0, 'gone with the language switch');
  } finally {
    await ctx.close();
  }
});

test('"no designs match": English words on the Arabic page keep their order (in their own <bdi>)', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/designs?q=${encodeURIComponent('Hello World!')}`);
    await page.waitForSelector('.design-empty h2', { timeout: 20000 });
    assert.strictEqual(await page.textContent('.design-empty h2 bdi'), 'Hello World!');
  } finally {
    await ctx.close();
  }
});

test('9 menus cost more than a 10-pack: a tip says so', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'menus');
    await addText(page, 'MENU', 'front');
    await page.waitForSelector('#qty-field .qty-in', { timeout: 15000 });
    const box = page.locator('#qty-field .qty-in').first();
    await box.fill('9');
    await box.dispatchEvent('change');
    await page.waitForFunction(() => [...document.querySelectorAll('#toast-root .toast')].some((x) => /10 copies/.test(x.textContent)), null, { timeout: 5000 });
  } finally {
    await ctx.close();
  }
});

test('live preview on a 360px Arabic phone: every tab inside the screen (booklets)', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  const page = await openEditor(ctx, srv.base, 'booklets');
  try {
    await addText(page, 'كتيب');
    await page.evaluate(() => document.getElementById('preview-open').click());
    await page.waitForSelector('.pv-tabs [data-pv-tab="proof"]', { state: 'visible', timeout: 15000 });
    const out = await page.evaluate(() => [...document.querySelectorAll('.pv-tabs .side-tab')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect()).filter((r) => r.left < -1 || r.right > innerWidth + 1).length);
    assert.strictEqual(out, 0, 'no tab past the screen\'s edge');
  } finally {
    await ctx.close();
  }
});
