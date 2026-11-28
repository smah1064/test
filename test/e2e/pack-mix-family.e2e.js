'use strict';

// Packs of one family mix on every product (owner, 26 Nov), in the browser: the editor's own "How many?" takes the
// cheapest mix (11 menus: a 10-pack and a single), and an item mixed in the cart opens in the editor with both packs.
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
const post = (url, body) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const lines = (page) => page.evaluate(() => Object.entries(window.__editor.st.qty || {}).flatMap(([c, row]) => Object.entries(row).filter(([, n]) => n > 0).map(([z, n]) => `${z}:${n}`)).sort());

test('editor: 11 menus typed become a 10-pack and a single; the table shows both', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'menus', '&size=A4-1');
    await page.waitForSelector('#qty-field .qty-in', { timeout: 15000 });
    await page.fill('#qty-field .qty-in', '11');
    await page.press('#qty-field .qty-in', 'Tab'); // (as a customer leaves the box)
    await page.waitForFunction(() => Object.values(window.__editor.st.qty || {}).some((row) => Object.keys(row).length === 2), null, { timeout: 15000 });
    assert.deepStrictEqual(await lines(page), ['A4-10:1', 'A4-1:1'].sort());
    const boxes = await page.$$eval('#qty-field .qty-in', (els) => els.map((e) => [e.dataset.qz, e.value]));
    assert.ok(boxes.some(([z, v]) => z === 'A4-10' && v === '1') && boxes.some(([z, v]) => z === 'A4-1' && v === '1'), JSON.stringify(boxes));
    assert.ok(boxes.every(([z]) => /^A4-/.test(z)), 'only the A4 packs');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('cart → editor: menus mixed in the cart (11) open with both packs, and come back as they were', { timeout: 150000 }, async () => {
  const made = await (await post('/api/designs', { productId: 'menus', color: 'matte', size: 'A4-1', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Menu', left: 100, top: 100, fontSize: 40, fill: '#000000', styles: [] }] } } } })).json();
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
  const entry = { designId: d.id, designKey: made.uploadToken.length === 48 ? made.uploadToken : undefined, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
  const ctx = await newContext(browser);
  await ctx.addInitScript((e) => { if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/cart`);
    await page.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
    await page.fill('.cart-qty .qty-n', '11');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities.length === 2; }, null, { timeout: 30000 })
      .catch(async (e) => { throw new Error(`${e.message}\n${await page.evaluate(() => localStorage.getItem('pod-cart-v2'))}\n${await page.textContent('.cart-entry').catch(() => '')}`); });
    const [item] = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'));
    assert.deepStrictEqual(item.quantities.map((l) => `${l.size.id}:${l.qty}`).sort(), ['A4-10:1', 'A4-1:1'].sort());
    // Edit design: both packs in the editor.
    await page.goto(`${srv.base}/editor?design=${encodeURIComponent(item.designId)}&cart=0`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 })
      .catch((e) => { throw new Error(`${e.message} ${JSON.stringify(page.errors)} ${page.url()}`); });
    await page.waitForSelector('#qty-field .qty-in', { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.deepStrictEqual(await lines(page), ['A4-10:1', 'A4-1:1'].sort());
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
