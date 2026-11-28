'use strict';

// The shop as an installed app, in the browser: the worker installs, pages open as before while it runs, with no
// connection a page shows the shop's own "no connection" page (both languages) and "Try again" works once back;
// on an iPhone the footer's "Install the app" says how.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

test('installed app: the worker, the offline page, back online, and the iPhone install steps', { timeout: 90000 }, async () => {
  const { chromium, devices } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'allow' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // On a computer browser that offers no install here: no install link.
    assert.strictEqual(await page.isVisible('[data-install-app]'), false);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    // Online, with the worker in charge: pages open as before.
    await page.goto(`${srv.base}/designs`);
    assert.match(await page.title(), /إبداع|ebda3/);

    // No connection: the shop's own page, in both languages, at the address asked for.
    await ctx.setOffline(true);
    await page.goto(`${srv.base}/cart`).catch(() => {});
    await page.waitForSelector('text=مفيش اتصال بالإنترنت');
    assert.ok(await page.isVisible('text=No internet connection'));
    assert.match(page.url(), /\/cart$/);

    // Back online: "Try again" opens the page.
    await ctx.setOffline(false);
    await page.click('a.btn');
    await page.waitForSelector('#coupon, .cart-empty, main', { timeout: 15000 });
    assert.doesNotMatch(await page.content(), /مفيش اتصال بالإنترنت/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();

    // iPhone (Safari has no install offer): the footer link says how.
    const phone = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    const p2 = await phone.newPage();
    await p2.goto(`${srv.base}/`);
    await p2.waitForSelector('[data-install-app]', { state: 'visible' });
    await p2.click('[data-install-app]');
    await p2.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => /الشاشة الرئيسية|Home Screen/.test(el.textContent)));
    await phone.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
