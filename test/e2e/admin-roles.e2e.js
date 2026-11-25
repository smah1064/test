'use strict';

// Admin → roles and approvals, in the browser. The server's half (roles, approvals, the activity log, staff with
// setup links) is answered here with page.route() as its API contract says; everything else is a real server,
// signed in as the owner. Each role sees its own tabs; Operations never sees an amount; a staff member's change to
// products or money comes back "sent to an owner for approval" (HTTP 202): a neutral toast, the form as typed, the
// "My requests" badge one more. Owners approve or reject, manage the team and read the activity log.
// Arabic and English at 1366 and 360 px: no sideways scrolling. ROLES_UI_SHOTS=<dir> saves screenshots there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const { loadPlaywright, startServer } = require('./helpers');

const SHOTS = process.env.ROLES_UI_SHOTS || '';
const read = (f) => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');
const R = (() => {
  const window = {};
  vm.runInNewContext(read('js/admin-roles.js'), { window });
  return window.AdminRoles;
})();
const permsOf = (roles) => [...new Set(roles.flatMap((r) => R.ROLE_PERMS[r]))];

const NOUR = { id: 'u-nour', name: 'Nour نور' };
const HALA = { id: 'u-hala', name: 'Hala هالة' };
const MONA = { id: 'u-mona', name: 'Mona منى' };
const SESSIONS = {
  owner: { id: 'u-nour', roles: ['owner'], perms: R.PERMS, name: 'nour', shown: 'Nour نور', pendingApprovals: 3, myPending: 0 },
  emergency: { roles: ['owner'], perms: R.PERMS, name: 'owner', shown: '', emergency: true, pendingApprovals: 3, myPending: 0, weakPassword: false },
  finance: { id: 'u-hala', roles: ['finance'], perms: permsOf(['finance']), name: 'hala', shown: 'Hala هالة', pendingApprovals: 0, myPending: 1 },
  operations: { id: 'u-omar', roles: ['operations'], perms: permsOf(['operations']), name: 'omar', shown: 'Omar عمر', pendingApprovals: 0, myPending: 0 },
  catalogue: { id: 'u-mona', roles: ['catalogue'], perms: permsOf(['catalogue']), name: 'mona', shown: 'Mona منى', pendingApprovals: 0, myPending: 1 },
};
const STAFF = [
  { id: 'u-nour', name: 'Nour نور', username: 'nour', roles: ['owner'], active: true, createdAt: '2026-10-01T09:00:00Z', lastSignIn: '2026-11-25T08:10:00Z', setupPending: false },
  { id: 'u-hala', name: 'Hala هالة', username: 'hala', roles: ['finance'], active: true, createdAt: '2026-10-03T09:00:00Z', lastSignIn: '2026-11-24T18:45:00Z', setupPending: false },
  { id: 'u-omar', name: 'Omar Abdel Rahman عمر عبد الرحمن', username: 'omar.ops', roles: ['operations', 'catalogue'], active: false, createdAt: '2026-10-05T09:00:00Z', setupPending: false },
  { id: 'u-mona', name: 'Mona منى', username: 'mona', roles: ['catalogue'], active: true, createdAt: '2026-11-20T09:00:00Z', setupPending: true },
];
const APPROVALS = [
  { id: 'ap1', at: '2026-11-25T09:30:00Z', by: HALA, roles: ['finance'], action: 'pricing.update', summary: { en: 'Mug: price 250 → 270 EGP', ar: 'المج: السعر 250 ← 270 ج.م.' }, details: { en: 'Base price: 250 → 270\nSize 15oz: +30 → +40', ar: 'السعر الأساسي: 250 ← 270\nمقاس 15oz: +30 ← +40' }, method: 'PUT', path: '/api/admin/pricing/mug', status: 'pending' },
  { id: 'ap2', at: '2026-11-25T10:05:00Z', by: MONA, roles: ['catalogue'], action: 'catalog.update', summary: { en: 'Classic T-Shirt: name changed', ar: 'التيشيرت الكلاسيك: الاسم اتغير' }, method: 'PUT', path: '/api/admin/catalog/tshirt', status: 'pending' },
  { id: 'ap5', at: '2026-11-25T11:00:00Z', by: MONA, roles: ['catalogue'], action: 'library.delete', summary: { en: 'Ready design "Eid Mubarak" deleted', ar: 'التصميم الجاهز «عيد مبارك» اتمسح' }, method: 'DELETE', path: '/api/admin/library/eid-1', status: 'pending' },
  { id: 'ap3', at: '2026-11-24T15:00:00Z', by: HALA, roles: ['finance'], action: 'coupon.create', summary: { en: 'New coupon EID20 (20%)', ar: 'كوبون جديد EID20 (20%)' }, method: 'POST', path: '/api/admin/coupons', status: 'approved', decidedBy: NOUR, decidedAt: '2026-11-24T16:00:00Z', note: 'OK for Eid' },
  { id: 'ap4', at: '2026-11-23T12:00:00Z', by: MONA, roles: ['catalogue'], action: 'catalog.update', summary: { en: 'Baseball Cap: colours changed', ar: 'الكاب: الألوان اتغيرت' }, method: 'PUT', path: '/api/admin/catalog/cap', status: 'failed', decidedBy: NOUR, decidedAt: '2026-11-23T13:00:00Z', error: { en: 'The product changed meanwhile', ar: 'المنتج اتغير في الوقت ده' } },
];
const ACTIVITY = [
  { id: 'e1', at: '2026-11-25T11:00:00Z', who: MONA, roles: ['catalogue'], action: 'library.delete', summary: { en: 'Ready design "Eid Mubarak" deleted (sent for approval)', ar: 'مسح التصميم الجاهز «عيد مبارك» (اتبعت للموافقة)' }, method: 'DELETE', path: '/api/admin/library/eid-1', status: 202, approvalId: 'ap5' },
  { id: 'e2', at: '2026-11-25T10:20:00Z', who: { id: 'u-omar', name: 'Omar عمر' }, roles: ['operations'], action: 'order.ship', summary: { en: 'Order ORD-1001 marked shipped (Bosta 7788-AB)', ar: 'الطلب ORD-1001 اتعلّم إنه اتشحن (Bosta 7788-AB)' }, method: 'PATCH', path: '/api/admin/orders/x/shipment', status: 200 },
  { id: 'e3', at: '2026-11-25T07:55:00Z', who: { id: 'owner', name: 'Owner (emergency)' }, roles: ['owner'], action: 'login', summary: { en: 'Signed in with the emergency owner password', ar: 'دخل بكلمة سر الطوارئ' }, method: 'POST', path: '/api/admin/login', status: 200, emergency: true },
  { id: 'e4', at: '2026-11-24T19:00:00Z', who: HALA, roles: ['finance'], action: 'expense.create', summary: { en: '=Expense 300 EGP, "packaging"', ar: 'مصروف 300 ج.م. «تغليف»' }, method: 'POST', path: '/api/admin/expenses', status: 403 },
];
/** Money fields the server leaves out for people without orders.amounts. */
const MONEY_KEYS = new Set(['total', 'subtotal', 'shipping', 'shippingFee', 'discount', 'price', 'unitPrice', 'orderTotal', 'spent', 'cost', 'profit', 'amount', 'expressFee', 'deliveryFee']);
function stripMoney(v) {
  if (Array.isArray(v)) return v.map(stripMoney);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => !(MONEY_KEYS.has(k) && typeof x === 'number')).map(([k, x]) => [k, stripMoney(x)]));
}
/** Changes to products and money (a staff member's wait for an owner). */
const NEEDS_OWNER = /^\/api\/admin\/(catalog|pricing|coupons|expenses|houses|product-houses|library|accounts\/settings|items\/[^/]+\/cost|orders\/[^/]+\/shipping-cost)(\/|$)/;

/** The server's half for one browser context: who signs in, and what each new route answers. */
async function mockServer(ctx, role, ownerToken, log) {
  const session = { ok: true, ...SESSIONS[role] };
  const owner = session.roles.includes('owner');
  let n = 0;
  const approvals = APPROVALS.map((a) => ({ ...a }));
  const staff = STAFF.map((u) => ({ ...u }));
  await ctx.route('**/api/admin/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch (e) { return null; } };
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    log.push({ m, p, q: url.search, body: m === 'GET' ? null : body() });
    if (p === '/api/admin/login' && m === 'POST') return json(200, { token: ownerToken, expiresAt: '2026-11-26T12:00:00Z', ...session });
    if (p === '/api/admin/session') return json(200, session);
    if (p === '/api/admin/logout') return route.fulfill({ status: 204 });
    if (p === '/api/admin/me/password') return json(200, { ok: true });
    if (p === '/api/admin/setup') {
      const b = body();
      return b.token === 'good' ? json(200, { ok: true, username: 'sara' }) : json(410, { error: 'This link has expired.', code: 'setupExpired' });
    }
    if (p === '/api/admin/approvals' && m === 'GET') {
      const mine = owner ? approvals : approvals.filter((a) => a.by.id === session.id);
      return json(200, { approvals: url.searchParams.get('status') === 'pending' ? mine.filter((a) => a.status === 'pending') : mine });
    }
    let am = /^\/api\/admin\/approvals\/([^/]+)(?:\/(approve|reject))?$/.exec(p);
    if (am) {
      const a = approvals.find((x) => x.id === am[1]);
      const note = (body() || {}).note;
      if (am[2] === 'approve') Object.assign(a, a.id === 'ap2' ? { status: 'failed', error: { en: 'Product not found', ar: 'المنتج مش موجود' } } : { status: 'approved' }, { decidedBy: NOUR, decidedAt: new Date().toISOString(), note });
      else if (am[2] === 'reject') Object.assign(a, { status: 'rejected', decidedBy: NOUR, decidedAt: new Date().toISOString(), note });
      else Object.assign(a, { status: 'cancelled', decidedAt: new Date().toISOString() });
      return json(200, { approval: a });
    }
    if (p === '/api/admin/activity') {
      const who = url.searchParams.get('who');
      const list = owner ? ACTIVITY : ACTIVITY.filter((e) => e.who.id === session.id);
      return json(200, { entries: who ? list.filter((e) => e.who.id === who) : list });
    }
    if (p === '/api/admin/staff' && m === 'GET') return json(200, { staff });
    if (p === '/api/admin/staff' && m === 'POST') {
      const b = body();
      const user = { id: 'u-' + b.username, name: b.name, username: b.username, roles: b.roles, active: true, setupPending: true, createdAt: new Date().toISOString() };
      staff.push(user);
      return json(201, { user, setupLink: '/admin?setup=tok-' + b.username });
    }
    am = /^\/api\/admin\/staff\/([^/]+)(\/setup-link)?$/.exec(p);
    if (am) {
      const u = staff.find((x) => x.id === am[1]);
      if (am[2]) return json(200, { setupLink: '/admin?setup=again-' + u.username });
      if (m === 'PATCH') return json(200, { user: Object.assign(u, body()) });
      if (m === 'DELETE') return route.fulfill({ status: 204 });
    }
    // A staff member's change to products or money waits for an owner.
    if (!owner && m !== 'GET' && NEEDS_OWNER.test(p)) {
      n += 1;
      return json(202, { pending: true, approval: { id: 'new-' + n, summary: { en: `Change ${n} to ${p.split('/')[3]}`, ar: `تعديل ${n} على ${p.split('/')[3]}` } } });
    }
    // Operations: the server leaves the amounts out of orders, the queue and customers.
    if (!session.perms.includes('orders.amounts') && m === 'GET' && /^\/api\/admin\/(orders|queue|customers|review|dtf-items)$/.test(p)) {
      const res = await route.fetch();
      return json(res.status(), stripMoney(await res.json()));
    }
    return route.continue();
  });
}

async function signIn(browser, srv, role, { lang = 'en', width = 1366, username } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const log = [];
  await mockServer(ctx, role, srv.ownerToken, log);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${srv.base}/admin`);
  if (role !== 'emergency') await page.fill('#username', username || SESSIONS[role].name);
  await page.fill('#password', 'a-long-password');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.waitForTimeout(400);
  return { ctx, page, log };
}
const visibleTabs = (page) => page.evaluate(() => [...document.querySelectorAll('[data-tab]')].filter((b) => !b.hidden).map((b) => b.dataset.tab));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page, name, fullPage = true) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
async function openTab(page, tab, wait) {
  await page.click(`[data-tab="${tab}"]`);
  if (wait) await page.waitForSelector(wait);
  await page.waitForTimeout(300);
}

// ---------- A real server with two orders ----------
let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  // A customer with an account (Customers lists accounts), who orders the first one.
  const signup = await post('/api/account/signup', { name: 'منى عادل', phone: '01012345678', password: 'a-long-password-1' });
  assert.strictEqual(signup.status, 201, await signup.clone().text());
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const art = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
  // One order ready to print (a sharp print file), one waiting in Review (a print file too small: low DPI).
  for (const [name, w, h] of [['منى عادل', 2590, 1049], ['Karim Adel', 1200, 1050]]) {
    const created = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
    for (const f of created.files) {
      const data = f.endsWith('-print.png') ? await art(w, h) : f.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
      await fetch(`${srv.base}/api/designs/${created.id}/files/${f}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
    }
    const d = await (await fetch(`${srv.base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
    const proof = await (await fetch(`${srv.base}/api/designs/${d.id}/proof`)).json();
    const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
    const o = await post('/api/orders', { customer: { name, phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' }, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } }, w > 2000 ? { cookie } : {});
    assert.strictEqual(o.status, 201, await o.clone().text());
  }
  srv.ownerToken = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('Operations: its own tabs, no amounts anywhere, shipping work without "Mark paid"', { timeout: 90000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360]]) {
    const { ctx, page } = await signIn(browser, srv, 'operations', { lang, width });
    assert.deepStrictEqual(await visibleTabs(page), ['queue', 'review', 'orders', 'film', 'houses', 'customers', 'rights', 'approvals', 'activity']);
    const who = await page.textContent('#admin-who');
    assert.match(who, lang === 'en' ? /Omar عمر.* · Operations/ : /Omar عمر.* · التشغيل/);
    assert.strictEqual(await page.textContent('#ap-tab-label'), lang === 'en' ? 'My requests' : 'طلباتي');
    // The queue: the item's details (payment) without an amount.
    await page.waitForSelector('#stats .stat');
    const det = page.locator('#tab-queue [data-toggle-item]').first();
    assert.ok(await det.count(), 'an item waiting to print');
    await det.click();
    await page.waitForSelector('#tab-queue .queue-details dl.spec');
    assert.match(await page.textContent('#tab-queue .queue-details dl.spec'), lang === 'en' ? /Cash on delivery/ : /الدفع عند الاستلام/);
    let text = await page.textContent('#tab-queue');
    assert.doesNotMatch(text, /EGP|ج\.م|NaN|undefined/, 'no amounts in the queue');
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}: queue`);
    await shot(page, `ops-queue-${lang}-${width}`);
    // Orders: no Total column, no invoice, no "Mark paid"; the shipping work is there.
    await openTab(page, 'orders', '#orders tr.order-row');
    assert.strictEqual(await page.isHidden('#orders-total-col'), true);
    assert.strictEqual(await page.locator('#orders tr.order-row').first().locator('td').count(), 5);
    await page.click('#orders [data-ship-toggle]');
    await page.waitForSelector('.ship-box');
    text = await page.textContent('#tab-orders');
    assert.doesNotMatch(text, /EGP|ج\.م|NaN|undefined/, 'no amounts in the orders');
    assert.strictEqual(await page.locator('.ship-box a[href^="/invoice"], .ship-box a[href^="/order"]').count(), 0, 'the invoice and the order page have the amounts');
    assert.strictEqual(await page.locator('.ship-box [data-pay]').count(), 0, 'no "Mark paid" without payments');
    assert.strictEqual(await page.locator('.ship-box [data-ship-shipped]').count(), 1, 'shipping work');
    assert.strictEqual(await page.isHidden('#notify-card'), true, 'the notifications setup is the owner\'s');
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}: orders`);
    await shot(page, `ops-orders-${lang}-${width}`);
    await openTab(page, 'customers', '#cu-list .cu-row');
    text = await page.textContent('#cu-list');
    assert.doesNotMatch(text, /EGP|ج\.م|NaN|undefined/, 'no amounts for customers');
    assert.match(text, lang === 'en' ? /2 orders · last/ : /٢ طلب، آخر/, 'the orders counted, no total');
    assert.ok(await page.locator('[data-cu-reset]').count() > 0, 'customers.contact');
    // Printing houses: Operations changes them (houses.edit).
    await openTab(page, 'houses');
    assert.strictEqual(await page.isVisible('#house-form'), true);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
});

test('Finance: orders with amounts, read-only, Mark paid; coupons, expenses and prices wait for an owner (toast, form as typed, badge)', { timeout: 90000 }, async () => {
  const { ctx, page, log } = await signIn(browser, srv, 'finance');
  assert.deepStrictEqual(await visibleTabs(page), ['orders', 'accounts', 'coupons', 'approvals', 'activity']);
  assert.match(await page.textContent('#dash-title'), /Accounts/, 'Finance starts on Accounts');
  assert.strictEqual(await page.textContent('#ap-count'), '1');
  // Orders: the Total column and Mark paid, no shipping buttons (orders read-only).
  await openTab(page, 'orders', '#orders tr.order-row');
  assert.strictEqual(await page.isVisible('#orders-total-col'), true);
  assert.match(await page.textContent('#orders'), /EGP/);
  await page.click('#orders [data-ship-toggle]');
  await page.waitForSelector('.ship-box');
  assert.strictEqual(await page.locator('.ship-box [data-pay]').count(), 1);
  assert.strictEqual(await page.locator('.ship-box [data-ship-save], .ship-box [data-ship-shipped], .ship-box [data-ship-delivered]').count(), 0);
  assert.strictEqual(await page.locator('.ship-box input[data-ship-field]:not([disabled])').count(), 0);
  // A new coupon: sent for approval, the form keeps what was typed, nothing red.
  await openTab(page, 'coupons');
  await page.fill('#cp-code', 'EID25');
  await page.fill('#cp-value', '25');
  await page.click('#cp-form button[type=submit]');
  await page.waitForSelector('.toast.toast-pending');
  assert.match(await page.textContent('.toast.toast-pending'), /^Sent to an owner for approval: Change 1 to coupons$/);
  assert.strictEqual(await page.inputValue('#cp-code'), 'EID25', 'the form as typed');
  assert.match(await page.textContent('#cp-msg'), /Sent to an owner for approval/);
  assert.strictEqual(await page.locator('.toast.error').count(), 0);
  assert.strictEqual(await page.textContent('#ap-count'), '2', 'My requests: one more');
  await shot(page, 'fin-coupon-pending-en-1366', false);
  assert.deepStrictEqual(log.filter((r) => r.m === 'POST' && r.p === '/api/admin/coupons').map((r) => r.body.code), ['EID25']);
  // Accounts → Prices: a price typed and saved waits too; the row keeps it.
  await openTab(page, 'accounts');
  await page.click('[data-acc-view="prices"]');
  const box = page.locator('[data-price-field="mug"][data-key="basePrice"]');
  await box.waitFor();
  await box.fill('275');
  await page.click('[data-price-save="mug"]');
  await page.waitForFunction(() => document.querySelectorAll('.toast.toast-pending').length >= 2);
  assert.strictEqual(await page.inputValue('[data-price-field="mug"][data-key="basePrice"]'), '275');
  assert.strictEqual(await page.locator('.toast.error').count(), 0);
  // Expenses: the same.
  await page.click('[data-acc-view="expenses"]');
  await page.fill('#exp-amount', '300');
  await page.fill('#exp-desc', 'تغليف');
  await page.click('#acc-exp-form button[type=submit]');
  await page.waitForFunction(() => /Sent to an owner/.test(document.getElementById('exp-msg').textContent));
  assert.strictEqual(await page.inputValue('#exp-amount'), '300');
  assert.strictEqual(await page.textContent('#ap-count'), '4');
  // My requests: their own, with what happened; one still waiting can be cancelled.
  await openTab(page, 'approvals', '.ap-item');
  assert.deepStrictEqual(await page.$$eval('.ap-item', (els) => els.map((e) => e.dataset.ap)), ['ap1', 'ap3']);
  assert.strictEqual(await page.locator('.ap-item [data-ap-act="approve"]').count(), 0, 'only owners approve');
  await page.click('#ap-ap1 [data-ap-act="cancel"]');
  await page.waitForSelector('#ap-ap1.ap-st-cancelled');
  assert.match(await page.textContent('#ap-ap1'), /Request cancelled/);
  await shot(page, 'fin-my-requests-en-1366');
  assert.strictEqual(await page.isHidden('#ap-count'), true, 'nothing of theirs waits now');
  // Activity: their own (no person filter, no Who column).
  await openTab(page, 'activity', '.act-table');
  assert.strictEqual(await page.locator('#act-who').count(), 0);
  assert.deepStrictEqual(await page.$$eval('.act-table thead th', (th) => th.length), 3);
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Catalogue: Review read-only, prices read-only, a product change waits for an owner with the section as typed', { timeout: 90000 }, async () => {
  const { ctx, page, log } = await signIn(browser, srv, 'catalogue', { lang: 'ar', width: 360 });
  assert.deepStrictEqual(await visibleTabs(page), ['review', 'library', 'products', 'approvals', 'activity']);
  await page.waitForSelector('#pm-root .pm-row');
  assert.strictEqual(await page.locator('[data-pm-act="staff"]').count(), 0, 'staff are on their own tab now');
  await page.click('[data-pm-act="edit"][data-id="tshirt"]');
  await page.waitForSelector('#pm-sec-basics');
  // Prices: read-only (prices.edit is the owner's and Finance's).
  assert.strictEqual(await page.locator('#pm-sec-prices input:not([disabled])').count(), 0);
  assert.strictEqual(await page.locator('#pm-sec-prices [data-pm-save]').count(), 0);
  await page.fill('[name="name.en"]', 'Classic Tee');
  await page.click('[data-pm-save="basics"]');
  await page.waitForSelector('.toast.toast-pending');
  assert.match(await page.textContent('.toast.toast-pending'), /^اتبعت لصاحب الموقع للموافقة: تعديل ١ على catalog$/);
  assert.strictEqual(await page.inputValue('[name="name.en"]'), 'Classic Tee', 'the section as typed');
  assert.strictEqual(await page.isVisible('#pm-sec-basics .pm-dirty'), true, 'not saved (not live yet)');
  assert.strictEqual(await page.isHidden('#pm-sec-basics > .pm-err'), true, 'nothing red');
  assert.strictEqual(await page.textContent('#ap-count'), '٢');
  assert.ok(log.some((r) => r.m === 'PUT' && r.p === '/api/admin/catalog/tshirt' && r.body.name));
  assert.strictEqual(await overflow(page), 0, 'products at 360');
  await shot(page, 'cat-product-ar-360', false);
  // Review: looking only.
  await openTab(page, 'review');
  const open = page.locator('[data-rv-toggle]').first();
  if (await open.count()) {
    await open.click();
    await page.waitForSelector('.rv-readonly');
    assert.strictEqual(await page.locator('[data-rv-act]').count(), 0);
    await page.locator('.rv-readonly').scrollIntoViewIfNeeded();
    await shot(page, 'cat-review-ar-360', false);
    assert.strictEqual(await overflow(page), 0, 'review at 360');
  }
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('Owner: Approvals (approve → live, approve → failed with the reason, reject with a note), badge follows', { timeout: 90000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360], ['ar', 1366], ['en', 360]]) {
    const { ctx, page, log } = await signIn(browser, srv, 'owner', { lang, width });
    const tabs = await visibleTabs(page);
    assert.deepStrictEqual(tabs.slice(-3), ['staff', 'approvals', 'activity']);
    assert.strictEqual(tabs.length, 15);
    assert.strictEqual(await page.textContent('#ap-count'), lang === 'en' ? '3' : '٣');
    await openTab(page, 'approvals', '.ap-item');
    assert.deepStrictEqual(await page.$$eval('.ap-item', (els) => els.map((e) => e.dataset.ap)), ['ap5', 'ap2', 'ap1'], 'waiting, newest first');
    assert.match(await page.textContent('#ap-ap1'), lang === 'en' ? /Hala هالة.*Finance.*Mug: price 250 → 270 EGP.*Base price: 250 → 270/s : /Hala هالة.*الحسابات.*المج: السعر ٢٥٠ ← ٢٧٠/s);
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}: approvals`);
    await shot(page, `owner-approvals-${lang}-${width}`);
    if (lang === 'en' && width === 1366) {
      await page.click('#ap-ap1 [data-ap-act="approve"]');
      await page.waitForSelector('#ap-ap1.ap-st-approved');
      assert.match(await page.textContent('#ap-ap1 .ro-msg'), /Approved: the change is live now/);
      assert.strictEqual(await page.textContent('#ap-count'), '2');
      await page.click('#ap-ap2 [data-ap-act="approve"]');
      await page.waitForSelector('#ap-ap2.ap-st-failed');
      assert.match(await page.textContent('#ap-ap2'), /Approved, but it couldn’t be applied: Product not found/);
      await page.fill('#ap-note-ap5', 'Keep it for next Eid');
      await page.click('#ap-ap5 [data-ap-act="reject"]');
      await page.waitForSelector('#ap-ap5.ap-st-rejected');
      assert.match(await page.textContent('#ap-ap5'), /Rejected by \u2068Nour نور\u2069, .*Note: Keep it for next Eid/s);
      assert.strictEqual(await page.isHidden('#ap-count'), true);
      assert.deepStrictEqual(log.filter((r) => /approve|reject/.test(r.p)).map((r) => [r.p, r.body]), [['/api/admin/approvals/ap1/approve', {}], ['/api/admin/approvals/ap2/approve', {}], ['/api/admin/approvals/ap5/reject', { note: 'Keep it for next Eid' }]]);
      await shot(page, 'owner-approvals-decided-en-1366');
      // All: the decided ones with who decided, the note and the reason.
      await page.click('[data-ap-view="all"]');
      await page.waitForSelector('#ap-ap4');
      assert.match(await page.textContent('#ap-ap4'), /Why: The product changed meanwhile/);
      assert.match(await page.textContent('#ap-ap3'), /Approved by \u2068Nour نور\u2069, .*Note: OK for Eid/s);
    }
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
});

test('Owner: Staff & roles (add → one-time link by WhatsApp, can\'t take away their own owner role, turn someone off), change my password', { timeout: 90000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360], ['ar', 1366], ['en', 360]]) {
    const { ctx, page, log } = await signIn(browser, srv, 'owner', { lang, width });
    await openTab(page, 'staff', '.st-row');
    assert.strictEqual(await page.locator('.st-row').count(), 4);
    const me = page.locator('[data-st-row="u-nour"]');
    assert.strictEqual(await me.locator('[data-st-act="off"], [data-st-act="remove"]').count(), 0, 'not themselves');
    assert.match(await page.textContent('[data-st-row="u-mona"]'), lang === 'en' ? /Hasn’t set a password yet/ : /لسه معملش كلمة السر/);
    assert.match(await page.textContent('[data-st-row="u-omar"]'), lang === 'en' ? /Turned off/ : /متوقف/);
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}: staff`);
    await shot(page, `owner-staff-${lang}-${width}`);
    if (lang === 'en' && width === 1366) {
      await me.locator('[data-st-act="edit"]').click();
      const ownerBox = me.locator('input[value="owner"]');
      assert.deepStrictEqual([await ownerBox.isChecked(), await ownerBox.isDisabled()], [true, true]);
      await me.locator('input[value="finance"]').check();
      await me.locator('[type=submit]').click();
      await page.waitForFunction(() => /Saved\./.test(document.querySelector('[data-st-row="u-nour"]').textContent));
      assert.deepStrictEqual(log.find((r) => r.m === 'PATCH' && r.p === '/api/admin/staff/u-nour').body, { name: 'Nour نور', roles: ['owner', 'finance'] });
      // Turn Hala off (signed out everywhere).
      await page.click('[data-st-row="u-hala"] [data-st-act="off"]');
      await page.waitForSelector('[data-st-row="u-hala"].is-off');
      assert.deepStrictEqual(log.find((r) => r.m === 'PATCH' && r.p === '/api/admin/staff/u-hala').body, { active: false });
      // Add someone: no password here, a one-time link to send.
      await page.fill('#st-name', 'Sara سارة');
      await page.fill('#st-user', 'Sara.Ops');
      await page.check('#st-add input[value="operations"]');
      await page.click('#st-add [type=submit]');
      await page.waitForSelector('#st-link');
      assert.deepStrictEqual(log.find((r) => r.m === 'POST' && r.p === '/api/admin/staff').body, { name: 'Sara سارة', username: 'sara.ops', roles: ['operations'] });
      const link = await page.inputValue('#st-link-url');
      assert.strictEqual(link, `${srv.base}/admin?setup=tok-sara.ops`);
      const wa = await page.getAttribute('#st-wa', 'href');
      assert.ok(wa.startsWith('https://wa.me/?text='));
      const text = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
      assert.match(text, /^Hi Sara, this is your link to set your password for the ebda3 admin \(your username: sara\.ops\)\. It works once, within 48 hours:\n/);
      assert.ok(text.endsWith(link));
      assert.strictEqual(await page.inputValue('#st-name'), '', 'a fresh form');
      await shot(page, 'owner-staff-link-en-1366');
      // A new link (a forgotten password).
      await page.click('[data-st-row="u-mona"] [data-st-act="link"]');
      await page.waitForFunction(() => /setup=again-mona$/.test(document.getElementById('st-link-url').value));
      // My password.
      await page.click('#me-btn');
      assert.match(await page.textContent('#me-who'), /Nour نور.* · Owner/);
      await page.click('#me-pw');
      await page.fill('#me-cur', 'old-password-1');
      await page.fill('#me-new', 'short');
      await page.fill('#me-new2', 'short');
      await page.click('.me-dlg [type=submit]');
      assert.match(await page.textContent('.me-dlg .ro-err'), /at least 10 characters/);
      await page.fill('#me-new', 'a-much-longer-one');
      await page.fill('#me-new2', 'a-much-longer-one');
      await shot(page, 'owner-password-en-1366');
      await page.click('.me-dlg [type=submit]');
      await page.waitForSelector('.me-dlg', { state: 'detached' });
      assert.deepStrictEqual(log.find((r) => r.p === '/api/admin/me/password').body, { current: 'old-password-1', password: 'a-much-longer-one' });
    }
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
});

test('Owner: Activity log (newest first, who, filters, CSV), Arabic and English', { timeout: 90000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360], ['ar', 1366], ['en', 360]]) {
    const { ctx, page, log } = await signIn(browser, srv, 'owner', { lang, width });
    await openTab(page, 'activity', '.act-table');
    assert.strictEqual(await page.locator('.act-row').count(), 4);
    const first = await page.textContent('.act-row:first-child');
    // (11:00 UTC is 13:00 in Cairo.)
    assert.match(first, lang === 'en' ? /25 Nov 2026, 13:00.*Mona منى.*Catalogue.*Sent for approval.*Approval/s : /٢٥ نوفمبر ٢٠٢٦.*١:٠٠.*Mona منى.*اتبعت للموافقة/s);
    assert.match(await page.textContent('.act-row:nth-child(3)'), lang === 'en' ? /Emergency login/ : /دخول طوارئ/);
    assert.strictEqual(await overflow(page), 0, `${lang} ${width}: activity`);
    await shot(page, `owner-activity-${lang}-${width}`);
    if (lang === 'en' && width === 1366) {
      await page.selectOption('#act-who', 'u-hala');
      await page.waitForFunction(() => document.querySelectorAll('.act-row').length === 1);
      assert.ok(log.some((r) => r.p === '/api/admin/activity' && /who=u-hala/.test(r.q)));
      await page.fill('#act-from', '2026-11-25');
      await page.fill('#act-to', '2026-11-20');
      await page.dispatchEvent('#act-to', 'change');
      assert.strictEqual(await page.isVisible('#act-range'), true, 'from after to');
      await page.fill('#act-to', '2026-11-25');
      await page.dispatchEvent('#act-to', 'change');
      await page.waitForFunction(() => document.getElementById('act-range').hidden);
      assert.ok(log.some((r) => r.p === '/api/admin/activity' && /from=2026-11-25/.test(r.q) && /to=2026-11-25/.test(r.q)));
      await page.selectOption('#act-who', '');
      await page.fill('#act-from', '');
      await page.fill('#act-to', '');
      await page.dispatchEvent('#act-to', 'change');
      await page.waitForFunction(() => document.querySelectorAll('.act-row').length === 4);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#act-csv')]);
      assert.match(dl.suggestedFilename(), /^activity-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
      assert.strictEqual(lines.length, 5);
      assert.strictEqual(lines[0], 'When (Cairo),Time (UTC),Who,Roles,What,Result,HTTP,Method,Path,Approval,Emergency login');
      assert.match(lines[1], /Mona منى,Catalogue,/);
      assert.match(lines[4], /"'=Expense 300 EGP, ""packaging""",Refused,403/, 'quoted, never a formula');
    }
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
});

test('the emergency owner login: a warning bar, no "Change my password"; signing in without a username', { timeout: 60000 }, async () => {
  for (const [lang, width] of [['ar', 360], ['en', 1366]]) {
    const { ctx, page, log } = await signIn(browser, srv, 'emergency', { lang, width });
    assert.deepStrictEqual(log.find((r) => r.p === '/api/admin/login').body, { password: 'a-long-password' }, 'no username: the shared password');
    assert.strictEqual(await page.isVisible('#emergency-bar'), true);
    assert.strictEqual(await page.textContent('#emergency-bar'), lang === 'en' ? 'Emergency owner login — every action is logged' : 'دخول الطوارئ لصاحب الموقع — كل حاجة بتتعمل بتتسجل');
    await page.click('#me-btn');
    assert.strictEqual(await page.isHidden('#me-pw'), true);
    assert.strictEqual(await page.textContent('#me-who'), lang === 'en' ? 'Owner (emergency login)' : 'صاحب الموقع (دخول الطوارئ)');
    assert.strictEqual(await overflow(page), 0);
    // The menu stays inside the screen.
    const pop = await page.$eval('.me-pop', (el) => { const r = el.getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth]; });
    assert.deepStrictEqual(pop, [true, true]);
    await shot(page, `emergency-${lang}-${width}`);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  }
  // The sign-in form itself, both languages, phone width.
  for (const lang of ['ar', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
    const page = await ctx.newPage();
    await page.goto(`${srv.base}/admin`);
    await page.waitForSelector('#login:not([hidden])');
    assert.strictEqual(await page.isVisible('#username'), true);
    assert.match(await page.textContent('#login-hint'), lang === 'en' ? /leave the username empty/ : /سيب اسم المستخدم فاضي/);
    assert.strictEqual(await overflow(page), 0);
    await shot(page, `login-${lang}-360`);
    await ctx.close();
  }
});

test('setting a password from the one-time link: the rules, done with the username, an expired link', { timeout: 60000 }, async () => {
  for (const [lang, width] of [['en', 1366], ['ar', 360]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
    const log = [];
    await mockServer(ctx, 'owner', srv.ownerToken, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/admin?setup=good`);
    await page.waitForSelector('#setup:not([hidden])');
    assert.strictEqual(await page.isHidden('#login'), true);
    await page.fill('#setup-pw', 'short');
    await page.fill('#setup-pw2', 'short');
    await page.click('#setup [type=submit]');
    assert.match(await page.textContent('#setup-err'), lang === 'en' ? /at least 10 characters/ : /١٠ حروف على الأقل/);
    await page.fill('#setup-pw', 'a-good-long-one');
    await page.fill('#setup-pw2', 'a-good-long-two');
    await page.click('#setup [type=submit]');
    assert.match(await page.textContent('#setup-err'), lang === 'en' ? /aren't the same/ : /مش زي بعض/);
    await page.fill('#setup-pw2', 'a-good-long-one');
    await shot(page, `setup-${lang}-${width}`);
    await page.click('#setup [type=submit]');
    await page.waitForSelector('#setup-done:not([hidden])');
    assert.deepStrictEqual(log.find((r) => r.p === '/api/admin/setup').body, { token: 'good', password: 'a-good-long-one' });
    assert.strictEqual((await page.textContent('#setup-done-text')).replace(/[⁨⁩]/g, ''), lang === 'en' ? 'Done — sign in with your username sara' : 'تمام — ادخل باسم المستخدم بتاعك sara');
    assert.strictEqual(await page.evaluate(() => location.search), '', 'the used link leaves the address');
    assert.strictEqual(await overflow(page), 0);
    await shot(page, `setup-done-${lang}-${width}`);
    await page.click('#setup-go');
    assert.strictEqual(await page.inputValue('#username'), 'sara');
    // An expired or used link.
    await page.goto(`${srv.base}/admin?setup=old`);
    await page.fill('#setup-pw', 'a-good-long-one');
    await page.fill('#setup-pw2', 'a-good-long-one');
    await page.click('#setup [type=submit]');
    await page.waitForFunction(() => !document.getElementById('setup-err').hidden);
    assert.match(await page.textContent('#setup-err'), lang === 'en' ? /expired or was already used/ : /خلص أو اتستخدم/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  }
});
