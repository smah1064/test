'use strict';

// The cart like Amazon's (owner, 28 Nov): every item ticked by default, "Deselect all" / "Select all", the sums and
// "Place order (N items)" for the ticked items only, an order of only those (the unticked ones stay in the cart), and
// Share on each item (the phone's share sheet with the pictures, else a view-only link copied).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer } = require('./helpers');

/** A finished design of `productId` with these sides (as the editor makes it); its cart entry. */
async function entry(base, productId, color, size, sides = ['front']) {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await (await post('/api/designs', { productId, color, size, sides: Object.fromEntries(sides.map((s) => [s, { editor: { objects: [{ type: 'i-text', text: 'hi' }] } }])) })).json();
  assert.ok(r.files, JSON.stringify(r));
  for (const name of r.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
    await fetch(`${base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
  }
  const d = await (await fetch(`${base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } })).json();
  return { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
}
const mug = (base) => entry(base, 'mug', 'white', '11oz');

async function phone(browser, lang, init) {
  const { devices } = loadPlaywright();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  if (init) await ctx.addInitScript(init);
  return ctx;
}
async function desktop(browser, lang, init) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  if (init) await ctx.addInitScript(init);
  return ctx;
}
async function openCart(ctx, base, items) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/cart`);
  await page.evaluate((list) => POD.setCart(list), items);
  await page.goto(`${base}/cart`);
  await page.waitForFunction((n) => document.querySelectorAll('[data-proof-for] .proof-short').length === n, items.length, { timeout: 60000 });
  return { page, errors };
}
async function fillDetails(page) {
  await page.fill('#name', 'Mona Ali');
  await page.fill('#phone', '01012345678');
  await page.selectOption('#governorate', 'cairo');
  await page.fill('#city', 'Nasr City');
  await page.fill('#address', '12 Abbas El Akkad St');
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sumOf = (page) => page.evaluate(() => ({
  subtotal: document.getElementById('subtotal').textContent,
  count: document.getElementById('sel-count').textContent,
  place: document.getElementById('place-order').textContent,
  disabled: document.getElementById('place-order').disabled,
  sel: document.getElementById('sel-sum').textContent,
  all: document.getElementById('sel-all').textContent,
  boxes: [...document.querySelectorAll('[data-sel]')].map((b) => b.checked),
}));
/** The sums settled: the shop's answer for exactly the ticked items is in. */
const settled = (page) => page.waitForTimeout(600);

test('cart selection (English, desktop): all ticked, untick one, sums and count follow, order only the ticked, the rest stays', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const items = [await mug(srv.base), await mug(srv.base), await mug(srv.base)];
    const ctx = await desktop(browser, 'en');
    const { page, errors } = await openCart(ctx, srv.base, items);
    await settled(page);
    const money = (n) => page.evaluate((x) => POD.money(x), n);
    const price = items[0].price;

    // All ticked by default: real checkboxes with labels.
    let s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [true, true, true]);
    assert.strictEqual(s.subtotal, await money(price * 3));
    assert.strictEqual(s.place, 'Place order (3 items)');
    assert.strictEqual(s.count, '(3 items)');
    assert.strictEqual(s.sel, '3 of 3 items selected');
    assert.strictEqual(s.all, 'Deselect all items');
    assert.match(await page.locator('#sel-1').evaluate((el) => el.labels[0].textContent), /Order .*Mug.* now/i);

    // Untick the second: the sums, the count and the button follow; the item stays, marked.
    await page.uncheck('#sel-1');
    await settled(page);
    s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [true, false, true]);
    assert.strictEqual(s.subtotal, await money(price * 2));
    assert.strictEqual(s.place, 'Place order (2 items)');
    assert.strictEqual(s.sel, '2 of 3 items selected');
    assert.strictEqual(s.all, 'Select all items');
    assert.strictEqual(await page.locator('.cart-entry.is-off').count(), 1);
    assert.match(await page.textContent('.cart-entry.is-off .sel-off-note'), /stays in your cart/);
    // Remembered on this device, by design.
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-off'))), [items[1].designId]);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('[data-sel]').length === 3);
    assert.deepStrictEqual((await sumOf(page)).boxes, [true, false, true]);

    // Keyboard: Space on a box ticks it.
    await page.focus('#sel-1');
    await page.keyboard.press('Space');
    await settled(page);
    assert.deepStrictEqual((await sumOf(page)).boxes, [true, true, true]);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'sel-1', 'focus kept on the box');

    // Deselect all: nothing to order, the button disabled with a hint; Select all brings them back.
    await page.click('#sel-all');
    await settled(page);
    s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [false, false, false]);
    assert.strictEqual(s.disabled, true);
    assert.strictEqual(s.place, 'Place order');
    assert.strictEqual(await page.isVisible('#sel-nothing'), true);
    assert.match(await page.textContent('#sel-nothing'), /Tick at least one item/);
    assert.strictEqual(s.all, 'Select all items');
    await page.click('#sel-all');
    await settled(page);
    s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [true, true, true]);
    assert.strictEqual(s.disabled, false);
    assert.strictEqual(await page.isVisible('#sel-nothing'), false);

    // Order only the first and third: the second stays in the cart as it was.
    await page.uncheck('#sel-1');
    await settled(page);
    let sent = null;
    page.on('request', (r) => { if (/\/api\/orders$/.test(r.url()) && r.method() === 'POST') sent = JSON.parse(r.postData()); });
    await fillDetails(page);
    await page.check('#proof-ok-box');
    await page.click('#place-order');
    await page.waitForURL(/\/order\?/, { timeout: 60000 });
    assert.deepStrictEqual(sent.designIds, [items[0].designId, items[2].designId]);
    assert.deepStrictEqual(Object.keys(sent.approvals).sort(), [items[0].designId, items[2].designId].sort());
    const left = await page.evaluate(() => POD.getCart());
    assert.strictEqual(left.length, 1);
    assert.deepStrictEqual(left[0], items[1], 'the unticked item stays exactly as it was');
    // Back in the cart: it is there, still unticked.
    await page.goto(`${srv.base}/cart`);
    await page.waitForFunction(() => document.querySelectorAll('[data-sel]').length === 1);
    s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [false]);
    assert.strictEqual(s.disabled, true);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('cart selection (Arabic, 360px phone): counts in Arabic, saved for later comes back ticked, no sideways scroll', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const items = [await mug(srv.base), await mug(srv.base)];
    const ctx = await phone(browser, 'ar');
    const { page, errors } = await openCart(ctx, srv.base, items);
    await settled(page);
    let s = await sumOf(page);
    assert.strictEqual(s.place, 'تأكيد الطلب (منتجين)');
    assert.strictEqual(s.all, 'شيل الاختيار من الكل');
    assert.strictEqual(await noSideways(page), 0);
    // The tick sits on the picture's start side (right, in Arabic).
    const pos = await page.evaluate(() => {
      const b = document.querySelector('.sel-check').getBoundingClientRect();
      const p = document.querySelector('.cart-pic').getBoundingClientRect();
      return { right: Math.abs(b.right - p.right), w: b.width, h: b.height };
    });
    assert.ok(pos.right < 10, JSON.stringify(pos));
    assert.ok(pos.w >= 44 && pos.h >= 44, 'a 44 px tap target');
    await page.uncheck('#sel-0');
    await settled(page);
    s = await sumOf(page);
    assert.strictEqual(s.place, 'تأكيد الطلب (منتج واحد)');
    assert.strictEqual(s.sel, 'مختار ١ من ٢');
    assert.strictEqual(await page.textContent('#bar-count'), '(منتج واحد)');
    assert.strictEqual(await noSideways(page), 0);
    // Save the unticked one for later, then back: it comes back ticked (saved items are never in the order).
    await page.click('#more-0');
    await page.click('#more-menu-0 [data-later]');
    await page.waitForFunction(() => document.querySelectorAll('[data-sel]').length === 1);
    assert.deepStrictEqual(await page.evaluate(() => localStorage.getItem('pod-cart-off')), null);
    await page.evaluate((id) => { POD.moveItem(id, false); }, items[0].designId);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('[data-sel]').length === 2);
    assert.deepStrictEqual((await sumOf(page)).boxes, [true, true]);
    assert.strictEqual(await noSideways(page), 0);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('share (phone, Web Share with files): the item\'s picture is shared with a short line', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const items = [await mug(srv.base)];
    const ctx = await phone(browser, 'en', () => {
      window.__shared = [];
      navigator.canShare = (d) => Boolean(d && d.files && d.files.length);
      navigator.share = async (d) => { window.__shared.push({ title: d.title, text: d.text, url: d.url || null, files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) }); };
    });
    const { page, errors } = await openCart(ctx, srv.base, items);
    assert.match(await page.textContent('#share-0'), /Share/);
    assert.match(await page.getAttribute('#share-0', 'aria-label'), /Share a picture of your/);
    await page.click('#share-0');
    await page.waitForFunction(() => window.__shared.length === 1);
    const [sh] = await page.evaluate(() => window.__shared);
    assert.strictEqual(sh.files.length, 1);
    assert.strictEqual(sh.files[0].type, 'image/png');
    assert.ok(sh.files[0].size > 0);
    assert.match(sh.files[0].name, /^ebda3-mug\.png$/);
    assert.match(sh.text, /made on ebda3\.me/);
    assert.strictEqual(sh.url, null, 'no link with the pictures');
    assert.doesNotMatch(JSON.stringify(sh), new RegExp(items[0].designId), 'nothing private shared');
    assert.strictEqual(await noSideways(page), 0);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('share fallback (no Web Share, Arabic): a view-only link is made, copied and shown; keys never in it', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const shirt = await entry(srv.base, 'tshirt', 'white', 'M', ['front', 'back']);
    const ctx = await desktop(browser, 'ar', () => {
      delete Navigator.prototype.share;
      delete Navigator.prototype.canShare;
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s) => { window.__copied.push(s); } }, configurable: true });
    });
    const { page, errors } = await openCart(ctx, srv.base, [shirt]);
    assert.strictEqual(await page.evaluate(() => typeof navigator.share), 'undefined');
    let posted = null;
    page.on('request', (r) => { if (/\/api\/views$/.test(r.url()) && r.method() === 'POST') posted = JSON.parse(r.postData()); });
    await page.click('#share-0');
    await page.waitForFunction(() => window.__copied.length === 1, null, { timeout: 30000 });
    const url = (await page.evaluate(() => window.__copied))[0];
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/view\?id=[A-Za-z0-9_-]{12}$/);
    assert.deepStrictEqual(posted.pages.map((p) => p.side).sort(), ['back', 'front']);
    assert.strictEqual(posted.productId, 'tshirt');
    // "Link copied" said, and the link shown to copy by hand.
    await page.waitForSelector('.toast');
    assert.match(await page.textContent('#toast-root'), /اتنسخ اللينك/);
    assert.strictEqual(await page.inputValue('[data-share-url]'), url);
    // The link is kept with the item (as the editor keeps it); its key never in the link.
    const kept = await page.evaluate(() => POD.getCart()[0].view);
    assert.ok(kept && kept.key && url.endsWith(kept.id));
    assert.ok(!url.includes(kept.key) && !url.includes(shirt.designId));
    // The link opens the view page with the pictures.
    const v = await (await fetch(srv.base + '/api/views/' + kept.id)).json();
    assert.strictEqual(v.pages.length, 2);
    // Shared again: the same link (no new one).
    posted = null;
    await page.click('[data-share-close]');
    await page.click('#share-0');
    await page.waitForFunction(() => window.__copied.length === 2);
    assert.strictEqual((await page.evaluate(() => window.__copied))[1], url);
    assert.strictEqual(posted, null);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('an unticked item whose number changes into a copy (new design) stays unticked; the ticked one is ordered alone', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const menu = await entry(srv.base, 'menus', 'matte', 'A4-1');
    const cup = await mug(srv.base);
    const ctx = await desktop(browser, 'en');
    const { page, errors } = await openCart(ctx, srv.base, [menu, cup]);
    await page.uncheck('#sel-0');
    await settled(page);
    await page.fill('#qty-n-0', '10');
    await page.press('#qty-n-0', 'Enter');
    await page.waitForFunction((id) => POD.getCart()[0].designId !== id, menu.designId, { timeout: 30000 });
    await settled(page);
    const now = await page.evaluate(() => POD.getCart()[0].designId);
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-off'))), [now]);
    const s = await sumOf(page);
    assert.deepStrictEqual(s.boxes, [false, true]);
    assert.strictEqual(s.place, 'Place order (1 item)');
    assert.strictEqual(s.subtotal, await page.evaluate((x) => POD.money(x), cup.price));
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('a plain item (kind \'blank\') in the cart: ticked, no − / +, no editor, its fixed number shown; unticking it changes the sums', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const r = await fetch(srv.base + '/api/blanks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'glasscan16', qty: 3 }) });
    const done = await r.json();
    assert.strictEqual(r.status, 201, JSON.stringify(done));
    // As the product page puts it in the cart (public/js/product.js).
    const glass = {
      designId: done.id, productId: 'glasscan16', productName: done.productName, colorName: done.color.name, sizeLabel: done.size.label,
      sides: [], price: done.price, previewUrl: done.previewUrl, addedAt: new Date().toISOString(), kind: 'blank', qty: 3, copies: 3,
    };
    const cup = await mug(srv.base);
    for (const lang of ['en', 'ar']) {
      const ctx = await phone(browser, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${srv.base}/cart`);
      await page.evaluate((list) => { POD.setCart(list); localStorage.removeItem('pod-cart-off'); }, [glass, cup]);
      await page.goto(`${srv.base}/cart`);
      await page.waitForFunction(() => document.querySelectorAll('[data-sel]').length === 2);
      await settled(page);
      let s = await sumOf(page);
      assert.deepStrictEqual(s.boxes, [true, true]);
      assert.strictEqual(s.subtotal, await page.evaluate((x) => POD.money(x), glass.price + cup.price));
      // No − / + and no editor for the plain item (the shop refuses − / + for it); the mug keeps its own.
      const g = page.locator('.cart-entry').nth(0);
      assert.strictEqual(await g.locator('[data-qstep]').count(), 0);
      assert.strictEqual(await g.locator('a[href^="/editor"]').count(), 0);
      const meta = await g.locator('.meta').textContent();
      assert.match(meta, lang === 'en' ? /3 pieces/ : /٣ قطع/);
      assert.match(meta, lang === 'en' ? /Plain, no printing/ : /سادة، من غير طباعة/);
      assert.doesNotMatch(meta, lang === 'en' ? /names/ : /اسم/);
      assert.strictEqual(await page.locator('.cart-entry').nth(1).locator('a[href^="/editor"]').count() > 0, true);
      // Untick the glass: only the mug is counted.
      await page.uncheck('#sel-0');
      await settled(page);
      s = await sumOf(page);
      assert.strictEqual(s.subtotal, await page.evaluate((x) => POD.money(x), cup.price));
      assert.strictEqual(s.place, lang === 'en' ? 'Place order (1 item)' : 'تأكيد الطلب (منتج واحد)');
      assert.strictEqual(await noSideways(page), 0);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
