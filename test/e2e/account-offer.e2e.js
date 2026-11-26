'use strict';

// After a guest order the order page offers "Save your orders": the mobile is filled in from the order, a
// password is typed, and the order is on the new account (owner's OK, UX item 8, 26 Nov). Also: the account
// page says what an account gives, and the order number reads «طلب رقم ١٠٠١» (UX item 7).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
async function guestOrder(base) {
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
  const d = await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
  for (const name of d.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    await fetch(`${base}/api/designs/${d.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': d.uploadToken }, body });
  }
  await fetch(`${base}/api/designs/${d.id}/complete`, { method: 'POST', headers: { 'x-upload-token': d.uploadToken } });
  const q = await post('/api/cart/quote', { designIds: [d.id] });
  const approvals = { [d.id]: { proofHash: (await (await fetch(`${base}/api/designs/${d.id}/proof`)).json()).proofHash } };
  return post('/api/orders', { customer: { name: 'سارة محمود', phone: '01055556666', governorate: 'giza', city: 'الدقي', address: '٥ شارع النيل' }, designIds: [d.id], expectedTotal: q.total, approvals, orderKey: `cart-${Date.now()}` });
}

test('"Save your orders" on the order page makes the account with a password only; the account page says why', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const order = await guestOrder(srv.base);
    assert.ok(order.id && order.key, JSON.stringify(order));
    const ctx = await newContext(browser);
    await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 360, height: 760 });

    await page.goto(`${srv.base}/account`);
    await page.waitForSelector('#acct-why-h');
    assert.match(await page.locator('.acct-why').innerText(), /ليه تعمل حساب؟[\s\S]*تتابع طلباتك/);

    await page.goto(`${srv.base}/order?id=${order.id}&k=${order.key}&new=1`);
    await page.waitForSelector('.acct-offer');
    assert.strictEqual(await page.locator('h1').innerText(), 'طلب رقم ١٠٠١');
    assert.strictEqual(await page.inputValue('#offer-phone'), '٠١٠٥٥٥٥٦٦٦٦');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at 360 px');
    // What is typed survives the page's own refresh.
    await page.fill('#offer-pass', 'sara-pass-2026');
    await page.evaluate(() => document.dispatchEvent(new Event('pod:langchange')));
    await page.click('#acct-offer-form button[type="submit"]');
    await page.waitForSelector('.acct-offer-ok');
    assert.match(await page.locator('.acct-offer-ok').innerText(), /حسابك جاهز/);

    await page.goto(`${srv.base}/account`);
    await page.waitForSelector('.acct-order-title');
    assert.deepStrictEqual(await page.locator('.acct-order-title').allInnerTexts(), ['طلب رقم ١٠٠١']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
