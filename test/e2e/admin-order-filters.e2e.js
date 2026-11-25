'use strict';

// Admin → Orders: search, status chips, more filters, Clear, 50 at a time, in the browser against a real server with
// real orders (design → files → complete → quote → order with approvals). The owner searches by phone in any form,
// Arabic letters and digits, order number and coupon; the chips and a filter narrow the list; the filters survive a
// tab switch, a reload and the 15-second refresh (focus and scroll stay put); a language switch follows at once.
// Operations (no amounts) gets no coupon search and nothing about money. Arabic at 360 px: no sideways scrolling.
// ORDER_FILTERS_SHOTS=<dir> saves screenshots there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadPlaywright, startServer } = require('./helpers');

const SHOTS = process.env.ORDER_FILTERS_SHOTS || '';
let srv;
let browser;
let ownerToken;
const O = {}; // the orders the tests look for, by role in the story
const FILLERS = 47;
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asOwner = (url, method, body) => fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { assert.ok(r.ok, `${method} ${url}: ${r.status} ${await r.clone().text()}`); return r.json().catch(() => null); });

const pngs = {};
const png = (w, h) => (pngs[`${w}x${h}`] ||= sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer());
/** A finished design: a mug (a sharp print file, or one too small that the shop must check) or a T-shirt. */
async function design(productId, low = false) {
  const spec = productId === 'mug' ? { productId, color: 'white', size: '11oz' } : { productId, color: 'black', size: 'M' };
  const r = await (await post('/api/designs', { ...spec, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of r.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
      : name.includes('print') ? await (productId === 'mug' ? (low ? png(1200, 1050) : png(2590, 1049)) : png(3600, 4800)) : await png(60, 72);
    const up = await fetch(`${srv.base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
    assert.strictEqual(up.status, 204);
  }
  const done = await fetch(`${srv.base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } });
  assert.strictEqual(done.status, 200);
  return r.id;
}
async function placeOrder(customer, { products = [['mug']], delivery, couponCode } = {}) {
  const ids = [];
  for (const [p, low] of products) ids.push(await design(p, low));
  const q = await (await post('/api/cart/quote', { designIds: ids, delivery, couponCode })).json();
  const approvals = {};
  for (const id of ids) approvals[id] = { proofHash: (await (await fetch(`${srv.base}/api/designs/${id}/proof`)).json()).proofHash };
  const o = await post('/api/orders', { customer: { address: '3 Street 9', ...customer }, designIds: ids, expectedTotal: q.total, approvals, delivery, couponCode });
  assert.strictEqual(o.status, 201, await o.clone().text());
  return o.json();
}
async function addMember(username, roles) {
  const r = await asOwner('/api/admin/staff', 'POST', { name: username, username, roles });
  const token = new URL(r.setupLink, srv.base).searchParams.get('setup');
  const done = await post('/api/admin/setup', { token, password: `${username}-long-password` });
  assert.strictEqual(done.status, 200, await done.clone().text());
}

test.before(async () => {
  srv = await startServer();
  ownerToken = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  await asOwner('/api/admin/coupons', 'POST', { code: 'EID20', type: 'percent', value: 20 });
  // 47 plain new orders (so the list has more than 50), a few at a time.
  for (let k = 0; k < FILLERS; k += 8) {
    await Promise.all(Array.from({ length: Math.min(8, FILLERS - k) }, (_, j) => placeOrder({ name: `Filler ${k + j}`, phone: `0155${String(k + j).padStart(7, '0')}`, governorate: 'sharqia', city: 'Zagazig' })));
  }
  // The six the tests look for (the newest, at the top of the list).
  O.delivered = await placeOrder({ name: 'Mona Adel', phone: '01012345678', email: 'mona@example.com', governorate: 'cairo', city: 'Nasr City' }, { couponCode: 'EID20' });
  O.shipped = await placeOrder({ name: 'كريم عادل', phone: '01122233344', governorate: 'alexandria', city: 'سموحة' }, { products: [['tshirt']], delivery: 'express' });
  O.review = await placeOrder({ name: 'Sara Hassan', phone: '01299988877', email: 'sara@example.com', governorate: 'giza', city: 'Dokki' }, { products: [['mug', true]] });
  O.customer = await placeOrder({ name: 'يوسف إبراهيم', phone: '01566677788', governorate: 'dakahlia', city: 'Mansoura' }, { products: [['mug', true]] });
  O.ready = await placeOrder({ name: 'Laila Mostafa', phone: '01033344455', governorate: 'cairo', city: 'Maadi' }, { products: [['tshirt'], ['mug']] });
  O.received = await placeOrder({ name: 'أحمد سعيد', phone: '01244455566', governorate: 'giza', city: 'الهرم' });
  // Move them along as the shop would.
  const items = async (o) => (await asOwner('/api/admin/orders', 'GET')).orders.find((x) => x.id === o.id).items;
  await asOwner(`/api/admin/orders/${O.delivered.id}/shipment`, 'PATCH', { courier: 'Aramex', trackingNumber: '5566', delivered: true });
  await asOwner(`/api/admin/orders/${O.delivered.id}/payment`, 'PATCH', { status: 'paid' });
  await asOwner(`/api/admin/orders/${O.shipped.id}/shipment`, 'PATCH', { courier: 'Bosta', trackingNumber: '7788-AB', shipped: true });
  const changes = await items(O.customer);
  assert.strictEqual(changes[0].status, 'review', 'a print file too small waits for the shop');
  await asOwner(`/api/admin/items/${changes[0].id}/review`, 'POST', { action: 'changes', note: 'Please send a bigger picture' });
  for (const it of await items(O.ready)) await asOwner(`/api/admin/items/${it.id}`, 'PATCH', { status: 'printed' });
  await addMember('opsfilter', ['operations']);
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function signIn({ username = '', password = 'secret', lang = 'en', width = 1366 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${srv.base}/admin`);
  if (username) await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.click('[data-tab="orders"]');
  await page.waitForSelector('#orders tr.order-row');
  return { ctx, page };
}
const rows = (page) => page.$$eval('#orders tr.order-row td:first-child strong', (els) => els.map((e) => e.textContent));
const count = (page) => page.textContent('#of-count');
const chipNumbers = (page) => page.$$eval('[data-of-chip]', (bs) => Object.fromEntries(bs.map((b) => [b.dataset.ofChip, b.querySelector('[data-of-n]').textContent])));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Type in the search box and wait for the list to follow (it waits for the typing to pause). */
async function search(page, q) {
  await page.fill('#of-q', q);
  await page.waitForFunction((v) => AdminOrderFilters.filters.q === v, q);
}
async function chip(page, c) {
  await page.click(`[data-of-chip="${c}"]`);
  await page.waitForFunction((v) => AdminOrderFilters.filters.chip === v, c);
}
/** A screenshot (ORDER_FILTERS_SHOTS); `tall`: the filters at the top of a taller window (phones). */
async function shot(page, name, { tall = 0 } = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const size = page.viewportSize();
  if (tall) {
    await page.setViewportSize({ width: size.width, height: tall });
    await page.evaluate(() => window.scrollTo(0, document.getElementById('order-filters').getBoundingClientRect().top + window.scrollY - document.querySelector('.site-header').offsetHeight - 12));
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  if (tall) await page.setViewportSize(size);
}

test('owner: search by phone, number, Arabic letters and digits, coupon; chips; a filter; clear; 50 at a time', { timeout: 180000 }, async () => {
  const { ctx, page } = await signIn();
  const total = FILLERS + 6;
  // 50 at a time, newest first.
  assert.strictEqual((await rows(page)).length, 50);
  assert.strictEqual(await count(page), `Showing 50 of ${total} orders`);
  assert.strictEqual((await rows(page))[0], O.received.number);
  assert.strictEqual(await page.textContent('#orders-more button'), 'Show 3 more');
  // A redraw (as the refresh does) leaves the focused "Show more" button as it is.
  await page.focus('#orders-more button');
  await page.evaluate(() => { document.getElementById('orders-more').firstChild.dataset.mark = '1'; });
  await page.evaluate(async () => AdminOrderFilters.view((await (await fetch('/api/admin/orders', { headers: { Authorization: `Bearer ${sessionStorage.getItem('pod-admin-token')}` } })).json()).orders));
  assert.deepStrictEqual(await page.evaluate(() => [document.activeElement.dataset.mark, document.activeElement.hasAttribute('data-of-more')]), ['1', true]);
  await page.click('#orders-more button');
  assert.strictEqual((await rows(page)).length, total);
  assert.strictEqual(await count(page), `All orders: ${total}`);
  assert.strictEqual(await page.isHidden('#orders-more'), true);
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelectorAll('#orders tr.order-row')[50].querySelector('[data-ship-toggle]')), 'focus on the first of the new ones');
  // Every control has a label; the chips are toggle buttons; the count is announced.
  assert.deepStrictEqual(await page.$$eval('#order-filters input, #order-filters select', (els) => els.filter((e) => !(e.labels && e.labels.length && e.labels[0].textContent.trim())).map((e) => e.id)), []);
  assert.strictEqual(await page.getAttribute('#of-count', 'aria-live'), 'polite');
  assert.strictEqual(await page.getAttribute('[data-of-chip="all"]', 'aria-pressed'), 'true');
  assert.strictEqual(await page.getAttribute('#of-chips', 'role'), 'group');
  assert.match(await page.getAttribute('#of-q', 'placeholder'), /coupon/, 'the owner may search coupons');
  assert.deepStrictEqual(await chipNumbers(page), { all: String(total), review: '1', customer: '1', received: String(FILLERS + 1), in_production: '0', ready: '1', shipped: '1', delivered: '1', late: '0' });

  // ---------- Search ----------
  const finds = async (q, want, why = q) => { await search(page, q); assert.deepStrictEqual(await rows(page), want.map((o) => o.number), why); };
  await finds('+20 112 223 3344', [O.shipped]);
  await finds('01122233344', [O.shipped]);
  await finds('1122233344', [O.shipped]);
  await finds('٠١٠١٢٣٤٥٦٧٨', [O.delivered], 'a phone in Arabic digits');
  await finds('+201012345678', [O.delivered]);
  await finds(O.shipped.number, [O.shipped]);
  await finds(O.shipped.number.replace(/\D/g, ''), [O.shipped], 'the number without POD-');
  await finds(O.shipped.number.replace(/\D/g, '').replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]), [O.shipped], 'the number in Arabic digits');
  await finds('كريم', [O.shipped]);
  await finds('احمد', [O.received], 'أحمد typed without the hamza');
  await finds('الاسكندريه', [O.shipped], 'the governorate, إ and ة typed as ا and ه');
  await finds('alexandria', [O.shipped]);
  await finds('SARA@example.com', [O.review]);
  await finds('7788-AB', [O.shipped]);
  await finds('aramex', [O.delivered]);
  await finds('EID20', [O.delivered], 'the coupon code, for the owner');
  await finds('mona cairo', [O.delivered], 'every word');
  await finds('تيشيرت', [O.ready, O.shipped], 'a product in Arabic');
  assert.strictEqual(await count(page), `Showing 2 of ${total} orders`);
  assert.strictEqual(await page.isVisible('#of-clear'), true);
  // Nothing found: says so, with Clear filters.
  await search(page, 'zzzz');
  assert.strictEqual(await page.textContent('#orders .of-empty p'), 'No orders match these filters.');
  assert.match(await page.innerHTML('#orders .of-empty'), /<bdi dir="auto">zzzz<\/bdi>/);
  await page.click('#orders .of-empty [data-of-clear]');
  await page.waitForFunction(() => AdminOrderFilters.filters.q === '');
  assert.strictEqual((await rows(page)).length, 50, 'back to the first 50');
  assert.strictEqual(await page.inputValue('#of-q'), '');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'of-q', 'focus back in the search box');
  assert.strictEqual(await page.isHidden('#of-clear'), true);

  // ---------- Chips ----------
  for (const [c, o] of [['review', O.review], ['customer', O.customer], ['ready', O.ready], ['shipped', O.shipped], ['delivered', O.delivered]]) {
    await chip(page, c);
    assert.deepStrictEqual(await rows(page), [o.number], c);
    assert.deepStrictEqual(await page.$$eval('[data-of-chip][aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.ofChip)), [c]);
  }
  await chip(page, 'late');
  assert.strictEqual(await page.isVisible('#orders .of-empty'), true);
  await chip(page, 'received');
  assert.strictEqual(await count(page), `Showing ${FILLERS + 1} of ${total} orders`);
  // Chip numbers follow the search.
  await search(page, 'giza');
  assert.deepStrictEqual(await rows(page), [O.received.number]);
  assert.deepStrictEqual(await chipNumbers(page), { all: '2', review: '1', customer: '0', received: '1', in_production: '0', ready: '0', shipped: '0', delivered: '0', late: '0' });
  await page.click('#of-clear');
  await page.waitForFunction(() => AdminOrderFilters.filters.chip === 'all' && AdminOrderFilters.filters.q === '');

  // ---------- More filters ----------
  assert.strictEqual(await page.isHidden('#of-more'), true);
  await page.click('#of-more-btn');
  assert.strictEqual(await page.getAttribute('#of-more-btn', 'aria-expanded'), 'true');
  assert.deepStrictEqual(await page.$$eval('#of-gov option', (os) => os.map((o) => o.textContent)), ['All governorates', 'Alexandria', 'Cairo', 'Dakahlia', 'Giza', 'Sharqia']);
  assert.deepStrictEqual(await page.$$eval('#of-product option', (os) => os.map((o) => o.value)), ['', 'mug', 'tshirt']);
  await page.selectOption('#of-gov', 'cairo');
  assert.deepStrictEqual(await rows(page), [O.ready.number, O.delivered.number]);
  assert.strictEqual(await page.textContent('#of-more-n'), '1');
  await page.selectOption('#of-pay', 'paid');
  assert.deepStrictEqual(await rows(page), [O.delivered.number]);
  await page.selectOption('#of-pay', '');
  await page.selectOption('#of-gov', '');
  await page.selectOption('#of-speed', 'express');
  assert.deepStrictEqual(await rows(page), [O.shipped.number]);
  await page.selectOption('#of-speed', '');
  await page.selectOption('#of-product', 'tshirt');
  assert.deepStrictEqual(await rows(page), [O.ready.number, O.shipped.number]);
  // Placed: every order is from today (Cairo); none up to yesterday.
  const today = await page.evaluate(() => AdminOrderFilters.cairoDay(new Date()));
  await page.fill('#of-from', today);
  assert.deepStrictEqual(await rows(page), [O.ready.number, O.shipped.number]);
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  await page.fill('#of-from', '');
  await page.fill('#of-to', yesterday);
  assert.strictEqual(await page.isVisible('#orders .of-empty'), true);
  assert.strictEqual(await page.textContent('#of-more-n'), '2');
  await page.click('#of-clear');
  assert.strictEqual((await rows(page)).length, 50);
  assert.deepStrictEqual(await page.$$eval('#of-more select, #of-more input', (els) => els.map((e) => e.value)), ['', '', '', '', '', '']);
  assert.strictEqual(await page.isVisible('#of-more'), true, '"More filters" stays open');
  assert.strictEqual(await page.isHidden('#of-more-n'), true);

  // ---------- Sort ----------
  await page.selectOption('#of-sort', 'old');
  assert.match((await rows(page))[0], /^POD-/);
  assert.ok(!(await rows(page)).includes(O.received.number), 'the newest are on the next page now');
  await page.selectOption('#of-sort', 'due');
  assert.strictEqual((await rows(page))[0], O.shipped.number, 'express: due soonest');
  await page.selectOption('#of-sort', 'new');

  // ---------- Kept: a tab switch, a reload, the 15-second refresh ----------
  await search(page, 'كريم');
  await page.click('[data-tab="queue"]');
  await page.waitForSelector('#tab-queue:not([hidden])');
  await page.click('[data-tab="orders"]');
  await page.waitForSelector('#orders tr.order-row');
  assert.strictEqual(await page.inputValue('#of-q'), 'كريم');
  assert.deepStrictEqual(await rows(page), [O.shipped.number]);
  await page.reload();
  await page.waitForSelector('#orders tr.order-row');
  assert.strictEqual(await page.inputValue('#of-q'), 'كريم');
  assert.deepStrictEqual(await rows(page), [O.shipped.number]);
  assert.strictEqual(await page.isVisible('#of-more'), true);
  // A long list, scrolled down, the cursor in the search box: the refresh changes neither.
  await search(page, 'pod');
  assert.strictEqual(await count(page), `Showing 50 of ${total} matching orders, ${total} in all`);
  await page.evaluate(() => { const q = document.getElementById('of-q'); q.focus({ preventScroll: true }); q.setSelectionRange(1, 1); window.scrollTo(0, 900); });
  const before = await page.evaluate(() => ({ y: window.scrollY, rows: document.querySelectorAll('#orders tr.order-row').length }));
  assert.ok(before.y > 800, `scrolled: ${before.y}`);
  await page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/orders', { timeout: 20000 });
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await page.evaluate(() => ({ id: document.activeElement.id, at: document.activeElement.selectionStart, y: window.scrollY, rows: document.querySelectorAll('#orders tr.order-row').length, q: document.getElementById('of-q').value })),
    { id: 'of-q', at: 1, y: before.y, rows: before.rows, q: 'pod' });

  // ---------- Language: at once ----------
  await chip(page, 'review');
  await page.click('[data-lang-toggle]');
  await page.waitForFunction(() => document.documentElement.lang === 'ar');
  assert.strictEqual(await page.textContent('[data-of-chip="review"] span'), 'محتاجة مراجعة');
  assert.strictEqual(await page.textContent('[data-of-chip="all"] [data-of-n]'), String(total).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]));
  assert.strictEqual(await count(page), `ظاهر ١ من ${String(total).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])} طلب`);
  assert.strictEqual(await page.textContent('label[for="of-q"]'), 'دوّر في الطلبات');
  assert.strictEqual(await page.textContent('#of-gov option[value=""]'), 'كل المحافظات');
  assert.strictEqual(await page.textContent('#of-sort option[value="due"]'), 'ميعاد التسليم، الأقرب الأول');
  assert.strictEqual(await page.inputValue('#of-q'), 'pod');
  await page.click('[data-lang-toggle]');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.click('#of-clear');

  // Screenshots: English on a desktop, More filters open, a search for a phone number.
  await shot(page, 'owner-en-1366-all');
  await search(page, '+20 112 223 3344');
  await shot(page, 'owner-en-1366-phone-search');
  await page.click('#of-clear');
  // Signed out: the next person starts with no filters.
  await search(page, 'كريم');
  await page.click('#logout');
  await page.waitForSelector('#login:not([hidden])');
  assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('pod-admin-order-filters')), null);
  assert.strictEqual(await page.inputValue('#of-q'), '');
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Arabic at 360 px: the filters fit, no sideways scrolling, big enough to tap, mixed names in their own direction', { timeout: 90000 }, async () => {
  const { ctx, page } = await signIn({ lang: 'ar', width: 360 });
  assert.strictEqual(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.strictEqual(await overflow(page), 0);
  assert.strictEqual(await count(page), 'ظاهر ٥٠ من ٥٣ طلب');
  await shot(page, 'owner-ar-360-top', { tall: 900 });
  await page.click('#of-more-btn');
  await chip(page, 'customer');
  assert.deepStrictEqual(await rows(page), [O.customer.number]);
  assert.strictEqual(await overflow(page), 0, 'with More filters open');
  // Fingers: chips, buttons and boxes at least 44 px high.
  const small = await page.$$eval('#order-filters button:not([hidden]), #order-filters select, #order-filters input', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.dataset.ofChip));
  assert.deepStrictEqual(small, []);
  // Nothing in the filters wider than the screen.
  const wide = await page.$$eval('#order-filters *', (els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5).map((e) => e.id || e.className));
  assert.deepStrictEqual(wide, []);
  // An English name in the Arabic page's empty message stays in its own direction.
  await search(page, 'Mona Adel');
  assert.match(await page.innerHTML('#orders .of-empty'), /<bdi dir="auto">Mona Adel<\/bdi>/, '(this chip has no Mona)');
  await chip(page, 'all');
  assert.deepStrictEqual(await rows(page), [O.delivered.number]);
  assert.strictEqual(await overflow(page), 0);
  await page.click('#of-clear');
  await chip(page, 'review');
  await shot(page, 'owner-ar-360-more-open', { tall: 1500 });
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Operations: the same search and chips, no coupon search, nothing about amounts (English desktop, Arabic phone)', { timeout: 90000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360]]) {
    const { ctx, page } = await signIn({ username: 'opsfilter', password: 'opsfilter-long-password', lang, width });
    assert.strictEqual(await page.isHidden('#orders-total-col'), true);
    assert.strictEqual(await page.locator('#orders tr.order-row').first().locator('td').count(), 5);
    assert.doesNotMatch(await page.getAttribute('#of-q', 'placeholder'), /coupon|الكوبون/);
    // Sort and filters: nothing by money.
    assert.deepStrictEqual(await page.$$eval('#of-sort option', (os) => os.map((o) => o.value)), ['new', 'old', 'due']);
    assert.deepStrictEqual(await page.$$eval('#order-filters select', (ss) => ss.map((s) => s.id)), ['of-sort', 'of-pay', 'of-speed', 'of-gov', 'of-product']);
    await page.click('#of-more-btn');
    assert.doesNotMatch(await page.textContent('#tab-orders'), /EGP|ج\.م|NaN|undefined/, 'no amounts');
    assert.doesNotMatch(await page.textContent('#order-filters'), /total|الإجمالي|amount|المبلغ|price|السعر|EGP|ج\.م/i, 'nothing about money in the filters');
    // The coupon isn't in their answer: not found by its code.
    await search(page, 'EID20');
    assert.strictEqual(await page.isVisible('#orders .of-empty'), true);
    assert.strictEqual((await rows(page)).length, 0);
    await search(page, '+20 112 223 3344');
    assert.deepStrictEqual(await rows(page), [O.shipped.number]);
    await page.click('#of-clear');
    assert.deepStrictEqual(await chipNumbers(page), lang === 'en'
      ? { all: '53', review: '1', customer: '1', received: '48', in_production: '0', ready: '1', shipped: '1', delivered: '1', late: '0' }
      : { all: '٥٣', review: '١', customer: '١', received: '٤٨', in_production: '٠', ready: '١', shipped: '١', delivered: '١', late: '٠' });
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}`);
    await shot(page, `ops-${lang}-${width}`, { tall: width === 360 ? 1500 : 0 });
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
});
