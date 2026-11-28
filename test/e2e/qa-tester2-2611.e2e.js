'use strict';

// Tester 2 (9 pm Cairo, 26 Nov), in the browser: the cart's box writes "1,000" and then read "2,000" as 2 (the comma
// as a decimal mark); the order page spread "○ White: 11 oz ×2" across the whole card.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

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
async function mug(extra = {}) {
  const made = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', ...extra, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
  }
  return (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
}

for (const lang of ['en', 'ar']) {
  test(`cart (${lang}): "1,000" typed as the box writes it is a thousand, not 1`, { timeout: 120000 }, async () => {
    const d = await mug();
    const entry = { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
    const ctx = await newContext(browser);
    await ctx.addInitScript((a) => { try { localStorage.setItem('pod-lang', a.lang); if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([a.entry])); } catch (e) { /* ignore */ } }, { lang, entry });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const qty = () => page.evaluate(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities ? c[0].quantities[0].qty : 1; });
    try {
      await page.goto(`${srv.base}/cart`);
      await page.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
      await page.fill('.cart-qty .qty-n', '5');
      await page.press('.cart-qty .qty-n', 'Enter');
      await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 5; }, null, { timeout: 30000 });
      // A thousand, written as the box itself writes it: "1,000" / "١٬٠٠٠" (it was read as 1).
      await page.fill('.cart-qty .qty-n', lang === 'en' ? '1,000' : '١٬٠٠٠');
      await page.press('.cart-qty .qty-n', 'Enter');
      await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 1000; }, null, { timeout: 30000 });
      assert.strictEqual(await qty(), 1000);
      const shown = await page.inputValue('.cart-qty .qty-n');
      assert.match(shown, lang === 'en' ? /^1,000$/ : /^١٬?٠٠٠$/, shown);
      // A decimal mark still ends the number: "12.5" is 12.
      await page.fill('.cart-qty .qty-n', '12.5');
      await page.press('.cart-qty .qty-n', 'Enter');
      await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 12; }, null, { timeout: 30000 });
      assert.deepStrictEqual(errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('order page: "○ White: 11 oz ×2" stays together at the line\'s start', { timeout: 120000 }, async () => {
  const d = await mug({ quantities: [{ color: 'white', size: '11oz', qty: 2 }] });
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const proof = await (await fetch(`${srv.base}/api/designs/${d.id}/proof`)).json();
  const o = await post('/api/orders', { customer: { name: 'Mona Adel', phone: '01066667777', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' }, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const order = await o.json();
  for (const lang of ['en', 'ar']) {
    for (const width of [1366, 412]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      try {
        await page.goto(`${srv.base}/order?id=${order.id}&k=${order.key}`);
        await page.waitForSelector('.qty-break .qty-row .qty-sizes', { timeout: 20000 });
        const r = await page.$eval('.qty-break .qty-row', (row) => {
          const box = (el) => el.getBoundingClientRect();
          const parts = [row.querySelector('.qty-dot'), row.querySelector('.qty-color'), row.querySelector('.qty-sizes')].filter(Boolean).map(box);
          return { span: Math.max(...parts.map((p) => p.right)) - Math.min(...parts.map((p) => p.left)), parts: parts.length };
        });
        assert.strictEqual(r.parts, 3);
        assert.ok(r.span < 260, `${lang} ${width}px: the line's pieces take ${Math.round(r.span)} px`);
      } finally {
        await ctx.close();
      }
    }
  }
});
