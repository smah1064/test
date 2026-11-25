'use strict';

// "Order again" with only some items (owner's request, 25 Nov): each item's own button, and a list to tick.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };

async function placeOrder(base) {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ids = [];
  for (const productId of ['tshirt', 'mug']) {
    const spec = productId === 'mug' ? { productId, color: 'white', size: '11oz' } : { productId, color: 'black', size: 'M' };
    const r = await (await post('/api/designs', { ...spec, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
    for (const name of r.files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
      await fetch(`${base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
    }
    await fetch(`${base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } });
    ids.push(r.id);
  }
  const q = await (await post('/api/cart/quote', { designIds: ids })).json();
  // Each proof approved, as the cart does.
  const approvals = {};
  for (const id of ids) approvals[id] = { proofHash: (await (await fetch(`${base}/api/designs/${id}/proof`)).json()).proofHash };
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, approvals });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const body = await o.json();
  return body.order || body;
}

test('order again: tick only the mug, or use one item\'s own button', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const order = await placeOrder(srv.base);
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/order?id=${order.id}`);
    await page.waitForSelector('[data-act="reorder"]');
    // Each item has its own button.
    assert.strictEqual(await page.locator('[data-act="reorder-item"]').count(), 2);
    // "Order again": the list, both ticked; untick the T-shirt, add the mug only.
    await page.click('[data-act="reorder"]');
    await page.waitForSelector('[data-pick]');
    assert.deepStrictEqual(await page.$$eval('[data-pick]', (xs) => xs.map((x) => x.checked)), [true, true]);
    await page.locator('[data-pick]').first().uncheck();
    assert.match(await page.textContent('[data-act="reorder-picked"]'), /\(1\)/);
    await page.click('[data-act="reorder-picked"]');
    await page.waitForURL(/\/cart/, { timeout: 30000 });
    const cart = await page.evaluate(() => POD.getCart().map((i) => i.productId));
    assert.deepStrictEqual(cart, ['mug']);
    // One item's own button: the T-shirt joins it.
    await page.goto(`${srv.base}/order?id=${order.id}`);
    await page.waitForSelector('[data-act="reorder-item"]');
    await page.locator('[data-act="reorder-item"]').first().click();
    await page.waitForURL(/\/cart/, { timeout: 30000 });
    assert.deepStrictEqual(await page.evaluate(() => POD.getCart().map((i) => i.productId)), ['mug', 'tshirt']);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
