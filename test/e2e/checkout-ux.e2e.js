'use strict';

// Checkout (owner's OK, 26 Nov, from the 8:31 pm UX review of cart / checkout / order), on a phone in Arabic and English
// and on a computer:
//  8. a ready design added as it is needs no tick (the order takes it as approved, recorded as a ticked one); the
//     customer's own design has one short tick right by "Place order", required, the colours note behind "Details";
//  9. standard and express show their whole delivery price (EGP 75 / EGP 175, free shipping respected), as big cards;
// 10. the thank-you box starts with the order number and the total; "Save your orders" is under the order, one line
//     that opens on a tap;
// 11. the coupon field folds into "Have a discount code?", and stays open with a code in use or a word about one;
// 12. the mobile's example is light, plainly an example, left to right, with the phone keypad.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

let srv;
let browser;
let shop; // /api/products: the real shipping, express fee and free-shipping amount
let ownerToken;
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();

test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
  shop = await (await fetch(`${srv.base}/api/products`)).json();
  ownerToken = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  const c = await post('/api/admin/coupons', { code: 'SAVE10', type: 'percent', value: 10 }, { Authorization: `Bearer ${ownerToken}` });
  assert.strictEqual(c.status, 201, await c.clone().text());
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** A finished mug design sent as `editor` says (the customer's own by default); its cart entry. */
async function mugEntry(editor = { objects: [{ type: 'i-text', text: 'hi' }] }) {
  const r = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor } } })).json();
  for (const name of r.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
    await fetch(`${srv.base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } })).json();
  return { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
}

async function phone(lang) {
  const { devices } = loadPlaywright();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}
/** The cart with these items, every proof shown. */
async function openCart(ctx, items) {
  const page = await newPage(ctx);
  await page.goto(`${srv.base}/cart`);
  await page.evaluate((list) => POD.setCart(list), items);
  await page.goto(`${srv.base}/cart`);
  await page.waitForFunction((n) => document.querySelectorAll('[data-proof-for] .proof-short').length === n, items.length, { timeout: 60000 });
  return page;
}
async function fillDetails(page, lang) {
  await page.fill('#name', lang === 'ar' ? 'منى علي' : 'Mona Ali');
  await page.fill('#phone', '01012345678');
  await page.selectOption('#governorate', 'cairo');
  await page.fill('#city', lang === 'ar' ? 'مدينة نصر' : 'Nasr City');
  await page.fill('#address', lang === 'ar' ? '١٢ شارع عباس العقاد' : '12 Abbas El Akkad St');
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The order just placed, as the customer's page reads it. */
async function placedOrder(page) {
  await page.waitForURL(/\/order\?/, { timeout: 60000 });
  await page.waitForSelector('.placed', { timeout: 30000 });
  return page.evaluate(async () => {
    const u = new URL(location.href);
    const id = u.searchParams.get('id');
    return POD.api('/api/orders/' + encodeURIComponent(id), { headers: POD.orderHeaders(POD.orderKey(id, u.searchParams.get('k'))) });
  });
}
const money = (page, n) => page.evaluate((x) => POD.money(x), n);

test('API: a ready design added as it is is approved without a tick and recorded so; own designs still need theirs', { timeout: 60000 }, async () => {
  const order = (ids, approvals) => post('/api/orders', { customer: { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas St' }, designIds: ids, approvals, orderKey: `k-${Math.random()}` });
  const proof = async (id) => (await fetch(`${srv.base}/api/designs/${id}/proof`)).json();
  const objects = [{ type: 'i-text', text: 'hi' }];
  const ready = await mugEntry({ objects, library: 'mesh-fady' });
  const named = await mugEntry({ objects, library: 'mesh-fady', named: true });
  const unknown = await mugEntry({ objects, library: 'no-such-design' });
  const own = await mugEntry();
  assert.strictEqual((await proof(ready.designId)).ready, true);
  for (const d of [named, unknown, own]) assert.strictEqual((await proof(d.designId)).ready, undefined, 'the customer\'s own words or design');
  // The customer's own: no approval, no order (as before).
  for (const d of [named, unknown, own]) assert.strictEqual((await order([d.designId], {})).status, 400);
  // The ready one: approved as it is, recorded like a ticked one.
  const r = await order([ready.designId], {});
  assert.strictEqual(r.status, 201, await r.clone().text());
  const it = (await r.json()).items[0];
  assert.strictEqual(it.approval.via, 'checkout');
  assert.strictEqual(it.approval.proofHash, 'v1');
  assert.strictEqual(it.approvals[0].action, 'approved');
  // Mixed: the own design's approval is still checked against its proof.
  const ready2 = await mugEntry({ objects, library: 'mesh-fady' });
  const own2 = await mugEntry();
  assert.strictEqual((await order([ready2.designId, own2.designId], { [own2.designId]: { proofHash: 'v9' } })).status, 409);
  assert.strictEqual((await order([ready2.designId, own2.designId], { [own2.designId]: { proofHash: 'v1' } })).status, 201);
});

test('phone, Arabic: a ready design has no tick and is ordered; full delivery prices as big cards; coupon link; phone example; thank-you box', { timeout: 180000 }, async () => {
  const ctx = await phone('ar');
  const page = await newPage(ctx);
  try {
    // A ready design from its page, added as it is.
    await page.goto(`${srv.base}/design?id=mesh-fady&product=mug&color=white`);
    await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 60000 });
    await page.click('#dp-add');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    await page.waitForSelector('[data-proof-for] .proof-short', { timeout: 60000 });
    await page.waitForSelector('[data-proof-for].ok');
    // #8: no tick at all, "Ready design" on its proof.
    assert.strictEqual(await page.isVisible('#proof-ok'), false);
    assert.strictEqual(await page.locator('#cart-layout input[type="checkbox"]:visible').count(), 0, 'nothing to tick');
    assert.match(await page.textContent('[data-proof-for] .cart-proof-ok'), /تصميم جاهز/);
    assert.strictEqual(await page.textContent('#approve-status'), '');

    // #12: the mobile's example, left to right, light, with the phone keypad.
    const ph = await page.evaluate(() => { const el = document.getElementById('phone'); return { text: el.placeholder, dir: el.dir, css: getComputedStyle(el).direction, type: el.type, mode: el.inputMode, color: getComputedStyle(el, '::placeholder').color }; });
    assert.strictEqual(ph.text.replace(/[⁦-⁩]/g, ''), 'مثال: 01012345678');
    assert.deepStrictEqual([ph.dir, ph.css, ph.type, ph.mode], ['ltr', 'ltr', 'tel', 'tel']);
    const grey = ph.color.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(Math.min(...grey) > 120, `a light grey example: ${ph.color}`);

    // #11: the coupon field folded into a link.
    assert.strictEqual(await page.textContent('#coupon-open'), 'عندك كود خصم؟');
    assert.strictEqual(await page.isVisible('#coupon'), false);
    assert.ok((await page.locator('#coupon-open').boundingBox()).height >= 44);

    // #9: each delivery option with its whole price, from the shop's own settings; whole cards, 44 px or more.
    const standard = await money(page, shop.pricing.shipping);
    const express = await money(page, shop.pricing.shipping + shop.delivery.expressFee);
    await page.waitForFunction(() => document.getElementById('dlv-fee-express').textContent !== '');
    assert.strictEqual(await page.textContent('#dlv-fee-standard'), standard);
    assert.strictEqual(await page.textContent('#dlv-fee-express'), express);
    assert.match(express, /١٧٥/);
    for (const box of await page.locator('.dlv-opt').all()) {
      const b = await box.boundingBox();
      assert.ok(b.height >= 44 && b.width > 280, `a big card: ${JSON.stringify(b)}`);
    }
    // A tap anywhere on the card picks it (here on its price).
    await page.click('#dlv-fee-express');
    assert.strictEqual(await page.isChecked('input[name="delivery"][value="express"]'), true);
    await page.waitForSelector('#express-line:not([hidden])');
    await page.click('.dlv-opt:has(input[value="standard"]) .dlv-main');
    assert.strictEqual(await page.isChecked('input[name="delivery"][value="standard"]'), true);
    assert.strictEqual(await noSideways(page), 0, 'no sideways scroll');

    // Ordered without ticking anything.
    await fillDetails(page, 'ar');
    await page.waitForFunction(() => document.getElementById('express-line').hidden);
    const total = await page.textContent('#total');
    await page.click('#place-order');
    const order = await placedOrder(page);
    assert.strictEqual(order.items[0].approval.via, 'checkout', 'approved as it is, recorded as a ticked one');

    // #10: the number and the total at the top, in the thank-you box; "Save your orders" under the order, one line.
    const sum = await page.textContent('.placed .placed-sum');
    assert.ok(sum.includes(await page.evaluate((n) => POD.t('order.title', { n: POD.orderNo(n) }), order.number)), sum);
    assert.match(sum, /^طلب رقم [٠-٩]+/);
    assert.ok(sum.includes(total), `${sum} has ${total}`);
    const order1 = await page.evaluate(() => {
      const top = (s) => document.querySelector(s).getBoundingClientRect().top;
      return { sum: top('.placed-sum'), placedText: top('.placed > p:not(.placed-sum)'), h1: top('h1'), summary: top('.summary'), offer: top('.acct-offer') };
    });
    assert.ok(order1.sum < order1.placedText && order1.sum < order1.h1, 'first in the box');
    assert.ok(order1.offer > order1.summary, '"Save your orders" under the order details');
    assert.strictEqual(await page.isVisible('#offer-pass'), false, 'folded to one line');
    assert.ok((await page.locator('#acct-offer-open').boundingBox()).height <= 70);
    assert.match(await page.textContent('#acct-offer-open'), /احفظ طلباتك في حساب/);
    await page.click('#acct-offer-open');
    assert.strictEqual(await page.isVisible('#offer-pass'), true);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'offer-pass');
    assert.strictEqual(await page.getAttribute('#acct-offer-open', 'aria-expanded'), 'true');
    assert.strictEqual(await noSideways(page), 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('phone, Arabic: a design with text added in the editor gets one short tick by "Place order", required', { timeout: 180000 }, async () => {
  // Made in the editor (a computer's), then in the phone's cart.
  const desk = await newContext(browser);
  let entry;
  try {
    const ed = await openEditor(desk, srv.base, 'mug');
    await ed.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await ed.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    await ed.click('#add-to-cart');
    await ed.waitForURL(/\/cart/, { timeout: 60000 });
    [entry] = await ed.evaluate(() => POD.getCart());
  } finally {
    await desk.close();
  }
  const ctx = await phone('ar');
  try {
    const page = await openCart(ctx, [entry]);
    await page.waitForSelector('#proof-ok:not([hidden])');
    // #8: one short line by the button; nothing to tick on the item itself.
    assert.strictEqual(await page.textContent('#proof-ok label'), 'شفت المعاينة ومتأكد إن التصميم زي ما عايزه');
    assert.strictEqual(await page.locator('[data-proof-for] [data-approve]').count(), 0);
    assert.strictEqual(await page.locator('[data-proof-for] .proof-screen-note').count(), 0, 'the long note is not on the item');
    const near = await page.evaluate(() => {
      const box = document.getElementById('proof-ok').getBoundingClientRect();
      const btn = document.getElementById('place-order').getBoundingClientRect();
      const label = document.querySelector('#proof-ok label').getBoundingClientRect();
      return { gap: btn.top - box.bottom, label: label.height, next: document.getElementById('proof-ok').nextElementSibling.id };
    });
    assert.strictEqual(near.next, 'place-order', 'right before the button');
    assert.ok(near.gap >= 0 && near.gap < 24, `next to the button: ${near.gap}`);
    assert.ok(near.label >= 44 && near.label < 70, `short, and a thumb's size: ${near.label}`);
    // The colours note behind "Details".
    assert.strictEqual(await page.textContent('#proof-ok-more'), 'تفاصيل');
    assert.strictEqual(await page.isVisible('#proof-ok-note'), false);
    await page.click('#proof-ok-more');
    assert.strictEqual(await page.getAttribute('#proof-ok-more', 'aria-expanded'), 'true');
    assert.match(await page.textContent('#proof-ok-note'), /بروفة على الشاشة/);
    await page.click('#proof-ok-more');
    assert.strictEqual(await page.isVisible('#proof-ok-note'), false);

    // Required: "Place order" without it orders nothing and stays here, at the tick.
    await fillDetails(page, 'ar');
    let ordered = 0;
    page.on('request', (r) => { if (/\/api\/orders$/.test(r.url()) && r.method() === 'POST') ordered += 1; });
    await page.click('#place-order');
    await page.waitForSelector('#proof-ok.nudge');
    assert.match(await page.textContent('#proof-ok-nudge'), /علّم هنا الأول/);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'proof-ok-box');
    await page.waitForFunction(() => { const r = document.getElementById('proof-ok').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(/\/cart/.test(page.url()));
    assert.strictEqual(ordered, 0);
    assert.strictEqual(await noSideways(page), 0);

    await page.check('#proof-ok-box');
    await page.waitForFunction(() => !document.querySelector('#proof-ok.nudge'));
    assert.strictEqual(await page.isVisible('#proof-ok-nudge'), false);
    await page.click('#place-order');
    const order = await placedOrder(page);
    assert.strictEqual(order.items[0].approval.via, 'checkout');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('phone, English: the tick and "Details", full prices, the coupon link opening and staying open, the example', { timeout: 180000 }, async () => {
  const ctx = await phone('en');
  try {
    const page = await openCart(ctx, [await mugEntry()]);
    await page.waitForSelector('#proof-ok:not([hidden])');
    assert.strictEqual(await page.textContent('#proof-ok label'), 'I’ve checked the preview and the design is how I want it');
    assert.strictEqual(await page.textContent('#proof-ok-more'), 'Details');
    assert.strictEqual(await page.getAttribute('#phone', 'placeholder'), 'e.g. 01012345678');
    await page.waitForFunction(() => document.getElementById('dlv-fee-express').textContent !== '');
    assert.strictEqual(await page.textContent('#dlv-fee-standard'), await money(page, shop.pricing.shipping));
    assert.strictEqual(await page.textContent('#dlv-fee-express'), await money(page, shop.pricing.shipping + shop.delivery.expressFee));
    assert.match(await page.textContent('#dlv-fee-express'), /175/);

    // #11: the link opens the field; a refused code keeps it open with its reason; an applied one too, after a reload.
    assert.strictEqual(await page.textContent('#coupon-open'), 'Have a discount code?');
    assert.strictEqual(await page.isVisible('#coupon'), false);
    await page.click('#coupon-open');
    assert.strictEqual(await page.isVisible('#coupon'), true);
    assert.strictEqual(await page.isVisible('#coupon-open'), false);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'coupon');
    await page.fill('#coupon', 'NOPE77');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => document.getElementById('coupon-msg').classList.contains('bad'), null, { timeout: 15000 });
    assert.strictEqual(await page.isVisible('#coupon'), true);
    await page.reload();
    await page.waitForSelector('[data-proof-for] .proof-short', { timeout: 60000 });
    assert.strictEqual(await page.isVisible('#coupon'), false, 'a new visit of the page: folded again');
    await page.click('#coupon-open');
    await page.fill('#coupon', 'SAVE10');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => document.getElementById('coupon-code').textContent === 'SAVE10', null, { timeout: 15000 });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('coupon-code').textContent === 'SAVE10', null, { timeout: 30000 });
    assert.strictEqual(await page.isVisible('#coupon'), true, 'open with a code in use');
    assert.strictEqual(await page.inputValue('#coupon'), 'SAVE10');
    assert.strictEqual(await page.isVisible('#coupon-open'), false);
    assert.strictEqual(await noSideways(page), 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('computer, English: free shipping reached: standard is free, express its own fee; the coupon link and the cards too', { timeout: 180000 }, async () => {
  const one = await mugEntry();
  const items = [one];
  while (items.length * one.price < shop.pricing.freeShippingOver) items.push(await mugEntry());
  const ctx = await newContext(browser);
  try {
    const page = await openCart(ctx, items);
    await page.waitForSelector('#free-note .free-done', { timeout: 30000 });
    assert.strictEqual(await page.textContent('#dlv-fee-standard'), 'Free shipping');
    assert.strictEqual(await page.textContent('#dlv-fee-express'), await money(page, shop.delivery.expressFee));
    await page.click('.dlv-opt:has(input[value="express"])');
    await page.waitForFunction(() => !document.getElementById('express-line').hidden);
    assert.strictEqual(await page.textContent('#express-fee'), await money(page, shop.delivery.expressFee));
    for (const box of await page.locator('.dlv-opt').all()) assert.ok((await box.boundingBox()).height >= 44);
    assert.strictEqual(await page.isVisible('#coupon-open'), true);
    assert.strictEqual(await page.isVisible('#coupon'), false);
    // One tick for all of the customer's own designs.
    await page.check('#proof-ok-box');
    assert.strictEqual(await page.locator('[data-proof-for].ok').count(), items.length);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a ready design with the customer\'s own name typed in is theirs to check: the tick is asked for', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  const page = await newPage(ctx);
  try {
    await page.goto(`${srv.base}/design?id=lz-puzzle-laila-en`);
    await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 60000 });
    const before = await page.getAttribute('#dp-img', 'src');
    await page.fill('#dp-name-0', 'SARA');
    await page.waitForFunction((b) => document.getElementById('dp-img').src !== b && document.getElementById('dp-spin').hidden, before, { timeout: 30000 });
    const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
    await page.click('#dp-add');
    const id = /\/api\/designs\/([^/]+)\/complete$/.exec((await done).url())[1];
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    assert.strictEqual((await (await fetch(`${srv.base}/api/designs/${id}/proof`)).json()).ready, undefined);
    await page.waitForSelector('#proof-ok:not([hidden])', { timeout: 60000 });
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
