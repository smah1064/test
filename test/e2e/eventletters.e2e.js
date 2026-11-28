'use strict';

// QA 28 Nov: Giant Event Letters ("up to 3 characters, 60 cm tall") let 9 small letters through as "Ready to print"
// at the 3-letter price. The editor now stops more letters than the size has, and letters that don't fill its height.
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

async function setText(page, text, heightShare) {
  await page.evaluate(({ text, heightShare }) => {
    const { canvas } = window.__editor;
    for (const o of canvas.getObjects().filter((x) => !x.excludeFromExport && x.name !== '__cropper')) canvas.remove(o);
    const area = window.__editor.st.product.sides[0].printArea;
    const t = new fabric.IText(text, { fontFamily: 'Cairo', fontSize: 100, originX: 'center', originY: 'center', left: area.x + area.w / 2, top: area.y + area.h / 2 });
    t.scaleToHeight(area.h * heightShare);
    if (t.getScaledWidth() > area.w * 0.95) t.scaleToWidth(area.w * 0.95);
    canvas.add(t);
    canvas.fire('object:modified', { target: t });
  }, { text, heightShare });
  await page.waitForTimeout(800);
}
const chip = (page) => page.evaluate(() => document.querySelector('.check-chip') && document.querySelector('.check-chip').className);

test('Giant Event Letters: more letters than the size, or letters smaller than its height, are stopped', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'eventletters');
    const L = await page.evaluate(() => window.__editor.st.product.laser);
    assert.strictEqual(L.maxPieces, 3, 'the product says how many letters');
    assert.strictEqual(L.fillHeight, true);
    // 9 letters, small: refused.
    await setText(page, 'MOHAMED 30', 0.3);
    assert.match(await chip(page), /bad/, 'stopped in the editor');
    const t0 = Date.now();
    await page.click('#add-to-cart');
    await page.waitForTimeout(2500);
    assert.ok(!/\/cart/.test(page.url()), `not added (${Date.now() - t0} ms)`);
    // 3 letters filling the height: fine.
    await setText(page, 'S&M', 0.95);
    assert.ok(!/bad/.test(await chip(page)), await chip(page));
    // 3 letters, small: refused.
    await setText(page, 'S&M', 0.4);
    assert.match(await chip(page), /bad/, 'letters smaller than the size');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('server print check: too many letters fail', async () => {
  const { preflight } = require('../../src/preflight');
  const { getProduct } = require('../../src/products');
  const product = (getProduct && getProduct('eventletters')) || require('../../src/products').PRODUCTS.find((p) => p.id === 'eventletters');
  const area = product.sides[0].printArea;
  const editor = { [product.sides[0].id]: { objects: [{ type: 'i-text', text: 'MOHAMED 30', height: area.h * 0.3, scaleY: 1 }] } };
  const files = { 'editor.json': JSON.stringify(editor) };
  const r = await preflight({ sides: [{ id: product.sides[0].id, widthIn: 59, heightIn: 23.6, bleedIn: 0 }] }, { product, readFile: async (n) => { if (!files[n]) throw new Error('missing'); return files[n]; } });
  const ids = r.checks.map((c) => c.id);
  assert.ok(ids.includes('tooManyPieces'), ids.join(','));
  assert.ok(ids.includes('lettersSmall'), ids.join(','));
});
