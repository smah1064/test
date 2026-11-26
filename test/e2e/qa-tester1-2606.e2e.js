'use strict';

// Tester 1's run at 10 am Cairo (26 Nov), in the browser: "Undo" in the cart's message can be clicked again; a ready
// design's light words stay light after Undo on a dark colour; text made smaller to fit grows back when it gets
// shorter; the bigger-pack tip counts each paper on its own; a theme searched with a product word ("egypt mug")
// finds that theme's designs on that product.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
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

/** A finished mug design (as the editor makes it); its cart entry. */
async function mugEntry(base) {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of r.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
    await fetch(`${base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
  }
  const d = await (await fetch(`${base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } })).json();
  return { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
}
const addText = (page, text, size = 40) => page.evaluate(([s, fs]) => {
  const ed = window.__editor;
  const a = ed.st.product.sides[0].printArea;
  const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: fs, fill: '#000' });
  ed.canvas.add(o);
  ed.canvas.setActiveObject(o);
  ed.canvas.fire('object:modified', { target: o });
}, [text, size]);

test('cart: Remove, then a real click on "Undo" in the message puts the item back', { timeout: 90000 }, async () => {
  const item = await mugEntry(srv.base);
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/cart`);
    await page.evaluate((list) => POD.setCart(list), [item]);
    await page.goto(`${srv.base}/cart`);
    await page.waitForSelector('[data-remove]', { state: 'attached' });
    await page.evaluate(() => document.querySelector('[data-remove]').click());
    await page.waitForFunction(() => POD.getCart().length === 0);
    // (A click the browser makes at the button's place: it fails if the message lets clicks through to the page.)
    await page.click('.toast-undo button', { timeout: 5000 });
    await page.waitForFunction((id) => POD.getCart().some((x) => x.designId === id), item.designId, { timeout: 5000 });
  } finally {
    await ctx.close();
  }
});

test('a ready design on black, then Undo: its words keep the light ink, and follow a later switch back to white', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-error-404-sloth-beanie&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.text && /ERROR/.test(o.text)), null, { timeout: 30000 });
    const fills = () => page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text && /ERROR|NOT FOUND/.test(o.text)).map((o) => String(o.fill).toLowerCase()));
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'black');
    await page.waitForTimeout(400);
    await page.click('#undo');
    await page.waitForTimeout(400);
    const after = await fills();
    assert.ok(after.length >= 2 && after.every((f) => f !== '#111111'), `light on black after Undo: ${after}`);
    assert.ok(await page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text && /ERROR/.test(o.text)).every((o) => o.wordsFill)), 'still knows its words\' own colour');
    await page.click('#swatches [data-color="white"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'white');
    await page.waitForTimeout(400);
    assert.ok((await fills()).every((f) => f === '#111111'), 'dark again on white');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('text made smaller for a long line grows back for a short one (never past its size)', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'Hi');
    await page.waitForSelector('#p-text');
    const scale = () => page.evaluate(() => window.__editor.canvas.getActiveObject().scaleX);
    await page.fill('#p-text', 'فريق Ebda3 2026 فريق Ebda3 2026 فريق Ebda3 2026 فريق Ebda3 2026');
    await page.waitForTimeout(300);
    assert.ok((await scale()) < 0.5, 'made smaller to fit');
    await page.fill('#p-text', 'Hi there');
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await scale()) - 1) < 1e-6, `back to its own size (${await scale()})`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('bookmarks: 5 matte + 9 glossy singles: the tip names a pack for each paper, not one 10-pack', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'bookmarks');
    await addText(page, 'BM', 20);
    await page.waitForSelector('#qty-field .qty-in', { timeout: 15000 });
    await page.selectOption('#qty-add', 'gloss');
    await page.waitForSelector('#qty-field .qty-in[data-qc="gloss"][data-qz="1"]');
    const box = (c) => page.locator(`#qty-field .qty-in[data-qc="${c}"][data-qz="1"]`);
    await box('matte').fill('5');
    await box('matte').dispatchEvent('change');
    await page.waitForTimeout(300);
    await box('gloss').fill('9');
    await box('gloss').dispatchEvent('change');
    await page.waitForFunction(() => [...document.querySelectorAll('#toast-root .toast')].some((x) => /each as a pack/.test(x.textContent)), null, { timeout: 5000 });
    const tip = await page.evaluate(() => [...document.querySelectorAll('#toast-root .toast')].map((x) => x.textContent).find((x) => /each as a pack/.test(x)));
    assert.match(tip, /10 copies of Matte white \+ 10 copies of Glossy white/, tip);
    assert.match(tip, /you chose 14 copies/, tip);
    // In Arabic: "١٠ نسخ" (three to ten copies), not "١٠ نسخة".
    const ar = await page.evaluate(() => { POD.setLang('ar'); return POD.plural('qty.copies', 10); });
    assert.strictEqual(ar, '١٠ نسخ');
  } finally {
    await ctx.close();
  }
});

test('ready designs: "egypt mug" finds the Egypt designs, on the mug', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'en'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/designs?q=egypt`);
    await page.waitForSelector('.design-card', { timeout: 20000 });
    const plain = await page.locator('.design-card').count();
    assert.ok(plain > 0, 'Egypt designs');
    await page.goto(`${srv.base}/designs?q=${encodeURIComponent('egypt mug')}`);
    await page.waitForSelector('.design-card', { timeout: 20000 });
    assert.ok((await page.locator('.design-card').count()) > 0);
    assert.match(await page.textContent('#design-count'), /Mug/i);
    assert.match(await page.getAttribute('.design-card', 'href'), /product=mug/);
  } finally {
    await ctx.close();
  }
});
