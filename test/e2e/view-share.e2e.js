'use strict';

// View-only links from the editor (owner's decision, 26 Nov): a booklet's pages or a two-sided product's sides, sent to
// flip through. The link follows the design: every save (and the cart) sends the latest version to the same link.
// Products with one side keep the link where friends reply.
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
const addText = async (page, text, side) => {
  if (side && (await page.evaluate(() => window.__editor.st.side)) !== side) {
    await page.evaluate((sd) => document.querySelector(`[data-side="${sd}"]`).click(), side);
    await page.waitForFunction((sd) => window.__editor.st.side === sd, side);
  }
  return addTextHere(page, text, side);
};
const addTextHere = (page, text, side) => page.evaluate(([s, sd]) => {
  const ed = window.__editor;
  const a = (ed.st.product.sides.find((x) => x.id === (sd || ed.st.side)) || ed.st.product.sides[0]).printArea;
  const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
  ed.canvas.add(o);
  ed.canvas.fire('object:modified', { target: o });
}, [text, side]);
const viewOf = async (url) => (await fetch(`${srv.base}/api/views/${new URL(url).searchParams.get('id')}`)).json();

test('booklet: "Share" makes a view-only link with every page; Save sends the latest version to the same link', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'booklets');
    await addText(page, 'COVER');
    await page.evaluate(() => document.getElementById('share-open').click());
    await page.waitForSelector('#view-share:not([hidden])', { timeout: 60000 });
    assert.strictEqual(await page.isHidden('#opinion-share'), true, 'the reply link only when asked for');
    const url = await page.inputValue('#view-url');
    assert.match(url, /\/view\?id=[A-Za-z0-9_-]{12}$/);
    assert.match(await page.getAttribute('#view-wa', 'href'), /^https:\/\/wa\.me\/\?text=/);
    assert.match(await page.getAttribute('#view-mail', 'href'), /^mailto:\?subject=/);
    const v1 = await viewOf(url);
    const pagesNow = await page.evaluate(() => window.__editor.st.product.sides.length);
    assert.strictEqual(v1.kind, 'pages');
    assert.ok(v1.pages.length >= 8 && v1.pages.length <= pagesNow, `${v1.pages.length} pages`);
    // Changed and saved: the same link shows the new version.
    await page.click('#share-close');
    await addText(page, 'MORE');
    await page.evaluate(() => document.getElementById('save-draft').click());
    await page.waitForFunction(async (u) => {
      const r = await fetch(`/api/views/${new URL(u).searchParams.get('id')}`);
      return (await r.json()).updatedAt;
    }, url, { timeout: 30000 });
    const v2 = await (async () => { for (let i = 0; i < 40; i++) { const v = await viewOf(url); if (v.updatedAt !== v1.updatedAt) return v; await new Promise((r) => setTimeout(r, 500)); } return null; })();
    assert.ok(v2, 'updated by the save');
    assert.notStrictEqual(v2.pages[0].url, v1.pages[0].url);
    // Another person opens the page's pictures with nothing but the link.
    const img = await fetch(srv.base + v2.pages[0].url);
    assert.strictEqual(img.status, 200);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('T-shirt front and back: two sides on the product; added to the cart, the cart item keeps the link', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    await page.goto(`${srv.base}/editor?product=tshirt&color=white&size=M`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
    await addText(page, 'FRONT', 'front');
    await page.waitForTimeout(300);
    await addText(page, 'BACK', 'back');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('share-open').click());
    await page.waitForSelector('#view-share:not([hidden])', { timeout: 60000 });
    const v = await viewOf(await page.inputValue('#view-url'));
    assert.strictEqual(v.kind, 'sides');
    assert.deepStrictEqual(v.pages.map((p) => p.name.en), ['Front', 'Back']);
    await page.click('#share-close');
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const item = await page.evaluate(() => POD.getCart()[0]);
    assert.strictEqual(item.view && item.view.id, v.id, 'the cart item keeps its link');
  } finally {
    await ctx.close();
  }
});

test('a mug (one side): "Share" is the link where friends reply, as before', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    await addText(page, 'MUG');
    await page.evaluate(() => document.getElementById('share-open').click());
    await page.waitForSelector('#opinion-share:not([hidden])', { timeout: 60000 });
    await page.waitForFunction(() => /\/s\//.test(document.getElementById('share-url').value), null, { timeout: 30000 });
    assert.strictEqual(await page.isHidden('#view-share'), true);
  } finally {
    await ctx.close();
  }
});
