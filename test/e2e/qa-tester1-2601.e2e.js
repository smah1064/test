'use strict';

// Tester 1's run at midnight Cairo (26 Nov), in the browser: /design with no design says "isn't available" (not a
// blank, orderable T-shirt); the account page's messages follow a language switch; the editor's "add something
// first" message keeps clear of the canvas hint and of the phone's price bar; invoice dates are Cairo dates.
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

test('/design and /design?id= show "this design isn\'t available", nothing to order', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    for (const url of ['/design', '/design?id=', '/design?id=%20']) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(srv.base + url);
      await page.waitForSelector('#dp-missing:not([hidden])', { timeout: 15000 });
      assert.doesNotMatch(await page.content(), /library=undefined/, url);
      assert.deepStrictEqual(errors, [], url);
      await page.close();
    }
  } finally {
    await ctx.close();
  }
});

test('Account › Delete my account: the "wrong password" message turns Arabic with the page', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(`${srv.base}/account`);
    const made = await page.evaluate(async () => (await fetch('/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sara Ali', phone: '01012345678', email: 'sara@example.com', password: 'long-enough-pass' }) })).status);
    assert.ok([200, 201].includes(made), `signed up (${made})`);
    await page.goto(`${srv.base}/account?view=security`);
    await page.waitForSelector('#del-open:visible');
    await page.click('#del-open');
    await page.check('#del-sure');
    await page.fill('#del-pw', 'not-the-password');
    await page.click('#del-go');
    await page.waitForFunction(() => !document.getElementById('del-msg').hidden && /current password/i.test(document.getElementById('del-msg').textContent));
    await page.evaluate(() => POD.setLang('ar'));
    await page.waitForFunction(() => document.documentElement.lang === 'ar');
    const msg = await page.textContent('#del-msg');
    assert.match(msg, /كلمة المرور الحالية/, msg);
    // Closed and the language switched again: it stays closed.
    await page.click('#del-cancel');
    await page.evaluate(() => POD.setLang('en'));
    assert.strictEqual(await page.isHidden('#del-box'), true);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('Editor, nothing designed, Add to cart: the message hides the canvas hint, and on a phone sits above the price bar', { timeout: 90000 }, async () => {
  for (const phone of [false, true]) {
    const c = phone ? await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }) : await newContext(browser);
    if (phone) await c.addInitScript(() => { try { localStorage.setItem('pod-lang', 'en'); } catch (e) { /* ignore */ } });
    const page = await openEditor(c, srv.base, 'tshirt', '&color=white&size=M');
    try {
      await page.waitForSelector('#stage-hint:not([hidden])');
      await page.evaluate(() => document.getElementById('add-to-cart').click());
      await page.waitForSelector('#toast-root .toast.error');
      assert.strictEqual(await page.isVisible('#stage-hint'), false, 'the hint steps aside while the message shows');
      if (phone) {
        const pos = await page.evaluate(() => ({ toast: document.querySelector('#toast-root .toast.error').getBoundingClientRect().bottom, bar: document.querySelector('.panel-foot').getBoundingClientRect().top }));
        assert.ok(pos.toast <= pos.bar, `the message (bottom ${pos.toast}) is above the price bar (top ${pos.bar})`);
      }
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await c.close();
    }
  }
});

test('Invoice: an order at 00:08 Cairo time is dated that day, on a phone set to UTC', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'UTC' });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'en'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  try {
    // The order as the server would send it, placed at 22:08 UTC on 25 Nov (00:08 on the 26th in Cairo).
    await page.route(/\/api\/orders\/ord-test-1$/, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'ord-test-1', number: 'EB-1001', createdAt: '2026-11-25T22:08:00.000Z', status: 'received', total: 450, subtotal: 400, shipping: 50, discount: 0,
        customer: { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' },
        items: [{ id: 'it1', productId: 'tshirt', productName: { en: 'T-shirt', ar: 'تيشيرت' }, quantity: 1, unitPrice: 400, lineTotal: 400, colorId: 'white', sizeId: 'M', sides: ['front'] }],
      }),
    }));
    await page.goto(`${srv.base}/invoice?id=ord-test-1&k=${'a'.repeat(32)}`);
    await page.waitForFunction(() => /November/.test(document.body.textContent));
    const text = await page.textContent('body');
    assert.match(text, /26 November 2026/, 'the Cairo date');
    assert.doesNotMatch(text, /25 November 2026/);
  } finally {
    await ctx.close();
  }
});
