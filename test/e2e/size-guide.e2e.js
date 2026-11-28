'use strict';

// Owner, 28 Nov: the site is prepaid and every piece is printed to order, so the clothing gets a size guide: the
// measurements (typical, ± 2 cm), the fit, a size finder, and one tick in the cart that the sizes were checked.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
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

async function ctxFor(lang, viewport = { width: 1300, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}
const watch = (page) => { const errors = []; page.on('pageerror', (e) => errors.push(String(e))); return errors; };

test('the shop: every garment has a guide; a mug has none', async () => {
  const { products } = await (await fetch(`${srv.base}/api/products`)).json();
  const tee = products.find((p) => p.id === 'tshirt');
  assert.deepStrictEqual(tee.sizeGuide.rows.map((r) => r.id), ['S', 'M', 'L', 'XL', '2XL', '3XL']);
  assert.ok(tee.sizeGuide.approx && tee.sizeGuide.fit.en && tee.sizeGuide.fit.ar);
  for (const p of products.filter((x) => x.category === 'apparel' && x.sizes.length > 1)) assert.ok(p.sizeGuide, `${p.id} has a size guide`);
  assert.strictEqual(products.find((p) => p.id === 'mug').sizeGuide, undefined);
});

test('product page (phone, Arabic and English): Size guide, the table and the finder', { timeout: 60000 }, async () => {
  for (const lang of ['en', 'ar']) {
    const ctx = await ctxFor(lang, { width: 360, height: 780 });
    try {
      const page = await ctx.newPage();
      const errors = watch(page);
      await page.goto(`${srv.base}/product?id=tshirt`);
      await page.waitForSelector('#pp-size-guide [data-size-guide]');
      assert.match(await page.textContent('#pp-size-guide'), lang === 'en' ? /Size guide/ : /دليل المقاسات/);
      await page.click('#pp-size-guide [data-size-guide]');
      await page.waitForSelector('.sg-modal');
      assert.strictEqual(await page.locator('.sg-table [data-sg-row]').count(), 6);
      await page.fill('.sg-finder input[name=height]', '178');
      await page.fill('.sg-finder input[name=weight]', '75');
      await page.click('.sg-finder button[type=submit]');
      await page.waitForFunction(() => /L/.test(document.querySelector('.sg-result').textContent));
      assert.match(await page.textContent('.sg-result'), lang === 'en' ? /We suggest L\./ : /بنقترح مقاس L/);
      // QA 28 Nov: Arabic-Indic digits typed on a phone are read (the boxes dropped them), and impossible numbers
      // get no size.
      await page.fill('.sg-finder input[name=height]', '١٧٨');
      await page.fill('.sg-finder input[name=weight]', '٧٥');
      await page.click('.sg-finder button[type=submit]');
      assert.strictEqual(await page.inputValue('.sg-finder input[name=height]'), '١٧٨', 'the typed digits stay');
      assert.match(await page.textContent('.sg-result'), lang === 'en' ? /We suggest L\./ : /بنقترح مقاس L/);
      await page.fill('.sg-finder input[name=height]', '250');
      await page.fill('.sg-finder input[name=weight]', '300');
      await page.click('.sg-finder button[type=submit]');
      assert.match(await page.textContent('.sg-result'), lang === 'en' ? /Check the height and weight/ : /راجع الطول والوزن/);
      assert.strictEqual(await page.locator('.sg-table tr.sg-hint').count(), 0, 'no size marked');
      await page.fill('.sg-finder input[name=height]', '178');
      await page.fill('.sg-finder input[name=weight]', '75');
      await page.click('.sg-finder button[type=submit]');
      // Nothing to choose on this page (sizes are chosen in the editor).
      assert.strictEqual(await page.$('[data-sg-use]'), null);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(scroll <= 0, `no sideways scrolling (${scroll})`);
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.$('.sg-modal'), null, 'Escape closes it');
      assert.deepStrictEqual(errors, []);
    } finally {
      await ctx.close();
    }
  }
});

test('editor: the size finder picks the size (kids by height)', { timeout: 90000 }, async () => {
  const ctx = await ctxFor('en');
  try {
    const page = await openEditor(ctx, srv.base, 'kidstee');
    await page.waitForSelector('#size-guide-link [data-size-guide]');
    await page.click('#size-guide-link [data-size-guide]');
    await page.waitForSelector('.sg-modal');
    assert.strictEqual(await page.$('.sg-finder input[name=weight]'), null, 'kids: height only');
    await page.fill('.sg-finder input[name=height]', '120');
    await page.click('.sg-finder button[type=submit]');
    await page.waitForSelector('[data-sg-use="6-8"]');
    await page.click('[data-sg-use="6-8"]');
    await page.waitForFunction(() => window.__editor.st.sizeId === '6-8');
    assert.ok(await page.$('#sizes [data-size="6-8"].active'), 'the chip shows it');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('cart: clothing needs the size tick before ordering; a mug alone needs none', { timeout: 180000 }, async () => {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const post = (url, body) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const entry = async (productId, color, size) => {
    const r = await (await post('/api/designs', { productId, color, size, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
    for (const name of r.files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
      await fetch(`${srv.base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
    }
    const d = await (await fetch(`${srv.base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } })).json();
    return { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
  };
  const shirt = await entry('tshirt', 'white', 'M');
  const mug = await entry('mug', 'white', '11oz');
  const ctx = await ctxFor('en');
  try {
    const page = await ctx.newPage();
    const errors = watch(page);
    await page.goto(`${srv.base}/cart`);
    await page.evaluate((list) => POD.setCart(list), [shirt, mug]);
    await page.goto(`${srv.base}/cart`);
    await page.waitForFunction(() => document.querySelectorAll('[data-proof-for] .proof-short').length === 2, null, { timeout: 60000 });
    await page.waitForSelector('#size-ok:not([hidden])');
    assert.match(await page.textContent('#size-ok-list'), /Classic T-Shirt: M/);
    assert.ok(await page.$('#size-ok [data-size-guide="tshirt"]'), 'its guide at hand');
    await page.check('#proof-ok-box');
    await page.fill('#name', 'Mona Ali');
    await page.fill('#phone', '01012345678');
    await page.selectOption('#governorate', 'cairo');
    await page.fill('#city', 'Nasr City');
    await page.fill('#address', '12 Abbas El Akkad St');
    let ordered = 0;
    page.on('request', (r) => { if (/\/api\/orders$/.test(r.url()) && r.method() === 'POST') ordered++; });
    await page.click('#place-order');
    await page.waitForSelector('#size-ok.nudge');
    assert.ok(await page.isVisible('#size-ok-nudge'));
    await page.waitForTimeout(500);
    assert.strictEqual(ordered, 0, 'not ordered before the size tick');
    // Untick the shirt: only the mug, no size tick asked.
    await page.click(`[data-sel="${shirt.designId}"]`);
    await page.waitForSelector('#size-ok[hidden]', { state: 'attached' });
    await page.click(`[data-sel="${shirt.designId}"]`);
    await page.waitForSelector('#size-ok:not([hidden])');
    await page.check('#size-ok-box');
    await Promise.all([page.waitForURL(/\/order/, { timeout: 60000 }), page.click('#place-order')]);
    assert.strictEqual(ordered, 1);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});
