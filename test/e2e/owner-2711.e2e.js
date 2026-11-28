'use strict';

// Owner, 27 Nov: on an iPad whose storage refused or hung, "Add to cart" stayed on "Checking print files…" for about 2
// minutes (the item was saved; tidying its draft away was waited for without end); and the newest items in the cart
// were at the bottom. Also: in the editor, more copies of a pack product never cost less than fewer.
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

async function addHeart(page) {
  await page.evaluate(() => {
    const { canvas } = window.__editor;
    const r = new fabric.Rect({ left: 250, top: 300, width: 60, height: 60, fill: '#f4a3a8', originX: 'center', originY: 'center' });
    canvas.add(r);
    canvas.fire('object:modified', { target: r });
  });
  await page.waitForTimeout(400);
}

test('a stuck draft store never holds "Add to cart" up; the newest item is at the top of the cart', { timeout: 150000 }, async () => {
  const ctx = await newContext(browser);
  try {
    let page = await openEditor(ctx, srv.base, 'mug');
    await addHeart(page);
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2'))[0].productId);
    assert.strictEqual(first, 'mug');
    // The browser's storage hangs (as it did on the owner's iPad): the draft store never answers.
    page = await openEditor(ctx, srv.base, 'tshirt', '&size=M');
    await addHeart(page);
    await page.evaluate(() => {
      const never = () => new Promise(() => {});
      window.POD.drafts.set = never;
      window.POD.drafts.remove = never;
    });
    await addHeart(page);
    await page.waitForTimeout(1200); // (a draft save is on its way and never ends)
    const t0 = Date.now();
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 30000 });
    const took = Date.now() - t0;
    assert.ok(took < 20000, `took ${took} ms`);
    const order = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2')).map((it) => it.productId));
    assert.deepStrictEqual(order, ['tshirt', 'mug'], 'the newest on top');
    await page.waitForSelector('#items .cart-entry');
    const shown = await page.evaluate(() => [...document.querySelectorAll('#items .cart-entry')].map((e) => e.querySelector('h3').textContent));
    assert.match(shown[0], /T-Shirt/i);
  } finally {
    await ctx.close();
  }
});

test('editor: 900 DL envelopes never cost more than 1,000', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'dlenvelopes');
    await addHeart(page);
    // Read the editor's own total for each mix through its price box.
    const total = async (q) => {
      await page.evaluate((qq) => { const { st } = window.__editor; st.qty = { [st.colorId]: qq }; }, q);
      await page.evaluate(() => document.querySelector('#qty-field') && document.querySelector('#qty-field').dispatchEvent(new Event('focusout')));
      await page.evaluate(() => window.__editor.canvas.fire('object:modified', { target: window.__editor.canvas.getObjects()[0] }));
      await page.waitForTimeout(300);
      return page.evaluate(() => Number(document.getElementById('price').textContent.replace(/[^\d.]/g, '')));
    };
    const nineHundred = await total({ 500: 1, 100: 4 });
    const thousand = await total({ 500: 2 });
    assert.ok(nineHundred > 0 && thousand > 0, `${nineHundred} ${thousand}`);
    assert.ok(nineHundred <= thousand, `900 copies ${nineHundred} > 1,000 copies ${thousand}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

// Owner's phone (Samsung, 384 px wide), 27 Nov: the whole editor sat shifted sideways. The buy bar's price could not
// shrink beside the wide "Add to cart" button on screens 361–417 px, so the page was wider than the screen.
test('editor on a 384 px and a 412 px phone: the page is never wider than the screen (Arabic and English)', { timeout: 120000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const width of [384, 412]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      try {
        const page = await openEditor(ctx, srv.base, 'calligraphy', '&library=cnc-cal-bismillah&color=walnut');
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, x: window.scrollX }));
        assert.ok(m.sw <= m.cw, `${lang} ${width}: page ${m.sw} px wide on a ${m.cw} px screen`);
        assert.strictEqual(m.x, 0, `${lang} ${width}: scrolled sideways`);
      } finally {
        await ctx.close();
      }
    }
  }
});
