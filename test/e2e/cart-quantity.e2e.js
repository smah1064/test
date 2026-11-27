'use strict';

// The cart's − / + (owner, 26 Nov): a customer with an item in the cart changes how many there, without the editor.
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
const cartNow = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'));
const priceText = (page) => page.textContent('.cart-entry .price');

test('a mug from the editor: + twice in the cart makes three, the same design, the price follows', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    await page.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const o = new fabric.IText('MUG', { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
      ed.canvas.add(o);
      ed.canvas.fire('object:modified', { target: o });
    });
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const [item] = await cartNow(page);
    assert.match(item.designKey || '', /^[a-f0-9]{48}$/, 'the cart keeps the design\'s key');
    await page.waitForSelector('.cart-qty [data-qstep="1"]', { timeout: 30000 });
    assert.strictEqual(await page.inputValue('.cart-qty .qty-n'), '1');
    assert.strictEqual(await page.isDisabled('.cart-qty [data-qstep="-1"]'), true, 'not below one');
    const before = await priceText(page);
    await page.click('.cart-qty [data-qstep="1"]');
    await page.click('.cart-qty [data-qstep="1"]');
    assert.strictEqual(await page.inputValue('.cart-qty .qty-n'), '3');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 3; }, null, { timeout: 30000 });
    const [after] = await cartNow(page);
    assert.strictEqual(after.designId, item.designId, 'the same design, changed in place');
    assert.strictEqual(after.price, Math.round(item.price * 3 * 100) / 100);
    await page.waitForFunction((b) => document.querySelector('.cart-entry .price').textContent !== b, before, { timeout: 15000 });
    assert.match(await page.textContent('.cart-entry .meta'), /3 pieces/);
    // Typed: 2, then Enter.
    await page.fill('.cart-qty .qty-n', '2');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 2; }, null, { timeout: 30000 });
    assert.match(await page.textContent('#total'), /\d/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('menus added before the key: 10 copies become one 10-pack (a copy of the design); 9 never cost more than 10', { timeout: 120000 }, async () => {
  // A design made through the shop's API, put in the cart the way older carts kept it (no key).
  const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const made = await (await post('/api/designs', { productId: 'menus', color: 'matte', size: 'A4-1', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Menu' }] } } } })).json();
  const sharp = require('sharp');
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const up = await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const d = await (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
  const entry = { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
  const ctx = await newContext(browser);
  await ctx.addInitScript((e) => { if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/cart`);
    await page.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
    assert.strictEqual(await page.textContent('.cart-qty-label'), 'Copies');
    await page.fill('.cart-qty .qty-n', '10');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForSelector('.cart-qty-note', { timeout: 30000 });
    assert.match(await page.textContent('.cart-qty-note'), /Cheaper as 1 × A4 × 10, so we changed it for you/);
    const [ten] = await cartNow(page);
    assert.notStrictEqual(ten.designId, d.id, 'a copy (no key in the cart)');
    assert.match(ten.designKey || '', /^[a-f0-9]{48}$/, 'with its own key now');
    assert.ok(ten.price < d.price * 10, `${ten.price}`);
    // One fewer: nine copies never cost more than ten (owner, 27 Nov: more copies never cheaper), so no tip to take ten.
    await page.click('.cart-qty [data-qstep="-1"]');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 9; }, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const [nine] = await cartNow(page);
    assert.strictEqual(nine.designId, ten.designId, 'changed in place with its key');
    assert.ok(nine.price <= ten.price + 0.001, `9 copies ${nine.price} > 10 copies ${ten.price}`);
    assert.strictEqual(await page.$('[data-qtake]'), null, 'no "cheaper" tip');
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('several sizes in one item: no − / + (changed in the editor, as the note says)', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const made = await (await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', quantities: [{ color: 'white', size: 'M', qty: 2 }, { color: 'white', size: 'L', qty: 1 }], sides: { front: { editor: { objects: [{ type: 'i-text', text: 'T' }] } } } })).json();
    const sharp = require('sharp');
    for (const name of made.files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
        : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
      await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
    }
    const d = await (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
    const entry = { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, quantities: d.quantities, copies: 3, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
    await page.goto(`${srv.base}/cart`);
    await page.evaluate((e) => { localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
    await page.reload();
    await page.waitForSelector('.cart-entry .price');
    await page.waitForFunction(() => document.getElementById('total').textContent.trim() !== '', null, { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.strictEqual(await page.$('.cart-qty'), null);
    assert.match(await page.textContent('#cart-note'), /Edit design/);
  } finally {
    await ctx.close();
  }
});
