'use strict';

// The cart on a phone (owner's UX changes, 26 Nov): a short proof until it is approved, "Place order" that points to
// the box to tick, the free-shipping bar, "Another copy" and "Save for later" in a "⋯" menu, and "My saved designs"
// as one line under the items.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer } = require('./helpers');

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

async function phone(browser, lang) {
  const { devices } = loadPlaywright();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}

async function openCart(ctx, base, items) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/cart`);
  await page.evaluate((list) => POD.setCart(list), items);
  await page.goto(`${base}/cart`);
  await page.waitForSelector('#proof-ok:not([hidden])');
  return { page, errors };
}

test('cart (Arabic, 360px): short proof, "Place order" points to the box, free-shipping bar, "⋯" menu, saved designs line', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const items = [await mugEntry(srv.base), await mugEntry(srv.base)];
    const ctx = await phone(browser, 'ar');
    const { page, errors } = await openCart(ctx, srv.base, items);
    await page.waitForFunction(() => document.querySelectorAll('.proof-short').length === 2);

    // #2: not approved yet, a short card: the checks' verdict, the spec line, "See proof details"; the whole proof on demand.
    const first = page.locator('[data-proof-for] >> nth=0');
    assert.strictEqual(await first.locator('.proof-sides').count(), 0, 'the full proof is folded away');
    // (This design's checks have something to say: it is shown in the short card in full, never folded away.)
    const verdict = await first.evaluate((el) => ({ pass: el.querySelector('.proof-short-st') && el.querySelector('.proof-short-st').textContent, box: [...el.querySelectorAll('.proof-short ~ .pf-box')].map((x) => x.className + ': ' + x.textContent.trim().slice(0, 80)) }));
    assert.strictEqual(verdict.pass, null, 'no "Ready to print" over a problem');
    assert.match(verdict.box.join('\n'), /^pf-box pf-fail: فريقنا هيراجع ده قبل الطباعة/);
    assert.match(await first.locator('.proof-short-spec').textContent(), /أبيض/);
    assert.strictEqual(await page.getAttribute('#tog-0', 'aria-expanded'), 'false');
    await page.click('#tog-0');
    await page.waitForSelector('[data-proof-for] >> nth=0 >> .proof-sides');
    assert.strictEqual(await page.getAttribute('#tog-0', 'aria-expanded'), 'true');
    await page.click('#tog-0');
    await page.waitForSelector('[data-proof-for] >> nth=0 >> .proof-short');

    // #3: "Place order" looks ready; pressed too early it orders nothing and points to the tick right by it (one tick
    // for both of the customer's own designs since the owner's change of 26 Nov; test/e2e/checkout-ux.e2e.js).
    assert.strictEqual(await page.isDisabled('#place-order'), false);
    let ordered = 0;
    page.on('request', (r) => { if (/\/api\/orders$/.test(r.url()) && r.method() === 'POST') ordered += 1; });
    await page.click('#place-order');
    await page.waitForSelector('#proof-ok.nudge');
    assert.match(await page.textContent('#proof-ok .nudge-note'), /علّم هنا الأول/);
    assert.match(await page.textContent('#proof-ok .nudge-note'), /تأكيد الطلب/);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'proof-ok-box');
    assert.strictEqual(await page.locator('[data-proof-for] [data-approve]').count(), 0, 'no box on the items');
    assert.strictEqual(ordered, 0);
    await page.check('#proof-ok-box');
    await page.waitForFunction(() => !document.querySelector('#proof-ok.nudge'));
    assert.strictEqual(await page.locator('[data-proof-for].ok').count(), 2, 'both approved by the one tick');

    // #4: how much is left for free shipping, with a bar.
    const bar = page.locator('#free-note [role="progressbar"]');
    await bar.waitFor();
    const max = Number(await bar.getAttribute('aria-valuemax'));
    assert.ok(max > 500, 'the free-shipping amount');
    assert.strictEqual(Number(await bar.getAttribute('aria-valuenow')), items[0].price + items[1].price);
    assert.match(await page.textContent('#free-note .free-msg'), /^فاضل .+ وياخد طلبك شحن مجاني/);
    assert.strictEqual(await page.getAttribute('#free-note .free-more', 'href'), '/#products');
    // (Filled from the start side: the right in Arabic.)
    const fill = await page.evaluate(() => { const b = document.querySelector('.free-bar').getBoundingClientRect(); const f = document.querySelector('.free-bar > span').getBoundingClientRect(); return { right: Math.abs(b.right - f.right), share: f.width / b.width }; });
    assert.ok(fill.right < 1, 'fills from the right in Arabic');
    assert.ok(Math.abs(fill.share - (items[0].price + items[1].price) / max) < 0.02, `share ${fill.share}`);

    // #5: the price by the name; "Edit design" and "Remove" in sight, the rest in the "⋯" menu.
    assert.match(await page.textContent('[data-entry-for] >> nth=0 >> .item-head .price'), /\S/);
    assert.strictEqual(await page.isVisible('[data-entry-for] >> nth=0 >> [data-later]'), false);
    assert.strictEqual(await page.getAttribute('#more-0', 'aria-label'), 'خيارات تانية');
    assert.strictEqual(await page.getAttribute('#more-0', 'aria-expanded'), 'false');
    const tap = await page.locator('#more-0').evaluate((b) => { const r = b.getBoundingClientRect(); const a = getComputedStyle(b, '::after'); return { w: r.width - parseFloat(a.left) - parseFloat(a.right), h: r.height - parseFloat(a.top) - parseFloat(a.bottom) }; });
    assert.ok(tap.w >= 44 && tap.h >= 44, `tap target ${JSON.stringify(tap)}`);
    await page.click('#more-0');
    assert.strictEqual(await page.getAttribute('#more-0', 'aria-expanded'), 'true');
    assert.ok(await page.isVisible('#more-menu-0 a[href^="/editor?design="]'), 'Another copy');
    assert.ok(await page.isVisible('#more-menu-0 [data-later]'), 'Save for later');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.isVisible('#more-menu-0'), false, 'Escape closes it');
    await page.click('#more-0');
    await page.click('h1');
    assert.strictEqual(await page.isVisible('#more-menu-0'), false, 'a tap elsewhere closes it');
    // Keyboard: Enter opens it with the first choice focused.
    await page.focus('#more-0');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('more-item')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'more-0');

    // Save the second for later: #9, "My saved designs" right under the items, one line that opens in place.
    await page.click('#more-1');
    await page.click('#more-menu-1 [data-later]');
    await page.waitForSelector('#saved:not([hidden]) .saved-line');
    assert.strictEqual(await page.evaluate(() => document.getElementById('items').nextElementSibling.id), 'saved');
    assert.match(await page.textContent('#saved .saved-title'), /تصميماتي المحفوظة \(١\)/);
    assert.match(await page.textContent('#saved .saved-sum'), /مج سيراميك/);
    assert.strictEqual(await page.getAttribute('#saved [data-saved-open]', 'aria-expanded'), 'false');
    assert.strictEqual(await page.isVisible('#saved [data-to-cart]'), false);
    await page.click('#saved [data-saved-open]');
    await page.waitForSelector('#saved [data-to-cart]');
    assert.strictEqual(await page.getAttribute('#saved [data-saved-open]', 'aria-expanded'), 'true');
    // The saved one isn't counted: still on the way to free shipping, with one item.
    await page.waitForFunction(() => document.querySelectorAll('[data-entry-for]').length === 1);

    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('cart (English): free shipping reached says so; an empty cart shows the saved designs in full', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const one = await mugEntry(srv.base);
    const catalog = await (await fetch(`${srv.base}/api/products`)).json();
    const over = catalog.pricing.freeShippingOver;
    const n = Math.ceil(over / one.price);
    const items = [one];
    for (let i = 1; i < n; i++) items.push(await mugEntry(srv.base));
    const ctx = await phone(browser, 'en');
    const { page, errors } = await openCart(ctx, srv.base, items);
    await page.waitForSelector('#free-note .free-done');
    assert.strictEqual((await page.textContent('#free-note')).trim(), '✓ Your order ships free');
    assert.strictEqual(await page.locator('#free-note [role="progressbar"]').count(), 0);
    // English: "More options", and a short proof with "See proof details".
    assert.strictEqual(await page.getAttribute('#more-0', 'aria-label'), 'More options');
    assert.match(await page.textContent('#tog-0'), /See proof details/);
    // Everything saved for later: the cart is empty and the saved designs show in full, not as one line.
    await page.evaluate(() => { for (const it of POD.getCart()) POD.moveItem(it.designId, true); });
    await page.reload();
    await page.waitForSelector('#saved:not([hidden]) [data-to-cart]');
    assert.strictEqual(await page.locator('#saved .saved-line').count(), 0);
    assert.strictEqual(await page.isVisible('#free-note'), false);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
