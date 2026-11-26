'use strict';

// The order page and invoice with the order's secret key, and the team's 30-minute view from the dashboard
// (owner's decision, 25 Nov: Operations sees no amounts; the order number alone no longer opens an order).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
let srv;
let browser;
let order;
let ownerToken;
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function placeOrder() {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const ids = [];
  for (const productId of ['tshirt', 'mug']) {
    const spec = productId === 'mug' ? { productId, color: 'white', size: '11oz' } : { productId, color: 'black', size: 'M' };
    const r = await (await post('/api/designs', { ...spec, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi', left: 40, top: 40, fontSize: 40, fill: '#ffffff', styles: [] }] } } } })).json();
    for (const name of r.files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(1200, 1200) : await png(60, 72);
      await fetch(`${srv.base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
    }
    await fetch(`${srv.base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } });
    ids.push(r.id);
  }
  const q = await (await post('/api/cart/quote', { designIds: ids })).json();
  const approvals = {};
  for (const id of ids) approvals[id] = { proofHash: (await (await fetch(`${srv.base}/api/designs/${id}/proof`)).json()).proofHash };
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, approvals });
  assert.strictEqual(o.status, 201, await o.clone().text());
  return o.json();
}
async function addMember(username, roles) {
  const r = await (await post('/api/admin/staff', { name: username, username, roles }, { Authorization: `Bearer ${ownerToken}` })).json();
  const token = new URL(r.setupLink).searchParams.get('setup');
  const done = await post('/api/admin/setup', { token, password: `${username}-long-password` });
  assert.strictEqual(done.status, 200, await done.clone().text());
}
/** The order's amounts as the page writes them ("525 EGP" in some form): none may show for Operations. */
const moneyOnPage = (page) => page.evaluate((o) => {
  const text = document.body.innerText;
  return [o.total, o.subtotal, ...o.items.map((i) => i.price)].filter((n) => n > 0).map((n) => POD.money(n)).filter((m) => text.includes(m));
}, order);

test.before(async () => {
  srv = await startServer();
  ownerToken = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  order = await placeOrder();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('the customer\'s link opens the order and its invoice; the number alone says where the right link is', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The number alone.
  await page.goto(`${srv.base}/order?id=${order.id}`);
  await page.waitForSelector('.card.empty h2');
  assert.strictEqual(await page.textContent('.card.empty h2'), 'Open your order from its link');
  assert.match(await page.textContent('.card.empty p'), /order email/);
  assert.deepStrictEqual(await moneyOnPage(page), []);
  assert.ok(await page.isVisible('a[href="/account"]'));
  // In Arabic too (the message is asked again in the new language).
  await page.evaluate(() => POD.setLang('ar'));
  await page.waitForFunction(() => /افتح طلبك/.test(document.querySelector('.card.empty h2').textContent));
  await page.waitForFunction(() => /إيميل الطلب/.test(document.querySelector('.card.empty p').textContent));
  await page.evaluate(() => POD.setLang('en'));

  // The customer's link: the order, with the key on its own links.
  await page.goto(`${srv.base}/order?id=${order.id}&k=${order.key}`);
  await page.waitForSelector('[data-act="reorder"]');
  assert.match(await page.textContent('h1'), new RegExp(`Order no\\. ${order.number.replace(/^POD-/, '')}$`)); // (without the shop's "POD-": UX item 7)
  assert.ok((await moneyOnPage(page)).length > 0, 'the customer sees the amounts');
  const invoiceHref = await page.getAttribute('.order-actions a', 'href');
  assert.strictEqual(invoiceHref, `/invoice?id=${order.id}&k=${order.key}`);
  await page.click('.order-actions a');
  await page.waitForSelector('#invoice');
  assert.strictEqual(await page.getAttribute('#inv-back', 'href'), `/order?id=${order.id}&k=${order.key}`);
  // The invoice by number alone.
  await page.goto(`${srv.base}/invoice?id=${order.id}`);
  await page.waitForSelector('.card.empty h2');
  assert.strictEqual(await page.textContent('.card.empty h2'), 'Open your invoice from your order link');
  assert.deepStrictEqual(errors, []);
  await ctx.close();
});

test('a guest\'s order kept on this device opens by number, and the address bar gets its key', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  await ctx.addInitScript((o) => {
    try { localStorage.setItem('pod-my-orders', JSON.stringify([{ number: o.number, link: `/order?id=${o.id}&k=${o.key}`, date: o.createdAt, total: o.total }])); } catch (e) { /* ignore */ }
  }, order);
  const page = await ctx.newPage();
  await page.goto(`${srv.base}/order?id=${order.id}`);
  await page.waitForSelector('[data-act="reorder"]');
  await page.waitForFunction((k) => new URL(location.href).searchParams.get('k') === k, order.key);
  await ctx.close();
});

test('"edit and send again" in the editor asks with the key, and goes back to the order with it', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const asked = [];
  page.on('request', (r) => { if (new RegExp(`/api/orders/${order.id}(/items/[\\w-]+/revise)?$`).test(r.url().split('?')[0])) asked.push(r.headers()['x-order-key'] || null); });
  const it = order.items[0];
  await page.goto(`${srv.base}/editor?design=${it.designId}&revise=${order.id}.${it.id}&k=${order.key}`);
  // This item isn't waiting for changes: the editor says so and goes back to the order (with its key).
  await page.waitForURL(new RegExp(`/order\\?id=${order.id}&k=${order.key}$`), { timeout: 30000 });
  assert.ok(asked.length && asked.every((k) => k === order.key), `the editor sent the key: ${JSON.stringify(asked)}`);
  await page.waitForSelector('[data-act="reorder"]');
  await ctx.close();
});

test('Operations: "Customer page" opens the 30-minute team view without amounts or the customer\'s buttons', { timeout: 90000 }, async () => {
  await addMember('opsteam', ['operations']);
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${srv.base}/admin`);
  await page.fill('#username', 'opsteam');
  await page.fill('#password', 'opsteam-long-password');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.click('[data-tab="orders"]');
  await page.waitForSelector(`[data-ship-toggle="${order.id}"]`);
  await page.click(`[data-ship-toggle="${order.id}"]`);
  await page.waitForSelector(`[data-team-view="order"][data-order="${order.id}"]`);
  assert.strictEqual(await page.locator(`[data-team-view="invoice"][data-order="${order.id}"]`).count(), 0, 'no invoice for Operations');
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click(`[data-team-view="order"][data-order="${order.id}"]`)]);
  tab.on('pageerror', (e) => errors.push(String(e)));
  await tab.waitForURL(/\/order\?id=.+&team=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  await tab.waitForSelector('.team-view');
  assert.match(await tab.textContent('.team-view'), /Team view/);
  assert.match(await tab.textContent('.team-view'), /Amounts are hidden for your role/);
  assert.match(await tab.textContent('h1'), new RegExp(`Order no\\. ${order.number.replace(/^POD-/, '')}$`));
  assert.deepStrictEqual(await moneyOnPage(tab), [], 'no amounts on the team view');
  for (const sel of ['[data-act="reorder"]', '[data-act="reorder-item"]', '#order-wa', '.order-actions', '[data-act="copy-customer"]']) {
    assert.strictEqual(await tab.locator(sel).count(), 0, `${sel} is not there`);
  }
  // Nothing in the page's address or storage opens the customer's own page.
  assert.ok(!tab.url().includes(order.key));
  assert.strictEqual(await tab.evaluate(() => localStorage.getItem('pod-my-orders')), null);
  // A team link that has ended (or was never made): says so, with the way back.
  await tab.goto(`${srv.base}/order?id=${order.id}&team=${'x'.repeat(40)}.${'y'.repeat(43)}`);
  await tab.waitForSelector('.card.empty h2');
  assert.strictEqual(await tab.textContent('.card.empty h2'), 'This team link has ended');
  assert.ok(await tab.isVisible('a[href="/admin"]'));
  assert.deepStrictEqual(errors, []);
  await ctx.close();
});

test('an owner\'s team view: amounts, the invoice, and the customer\'s link to pass on; the link copied to another browser shows nothing', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
  const page = await ctx.newPage();
  // The emergency owner sign-in (no username).
  await page.goto(`${srv.base}/admin`);
  await page.fill('#password', 'secret');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.click('[data-tab="orders"]');
  await page.waitForSelector(`[data-ship-toggle="${order.id}"]`);
  await page.click(`[data-ship-toggle="${order.id}"]`);
  await page.waitForSelector(`[data-team-view="invoice"][data-order="${order.id}"]`);
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click(`[data-team-view="order"][data-order="${order.id}"]`)]);
  await tab.waitForSelector('.team-view');
  assert.ok((await moneyOnPage(tab)).length > 0, 'an owner sees the amounts');
  assert.ok(!/hidden/.test(await tab.textContent('.team-view')));
  await tab.click('[data-act="copy-customer"]');
  await tab.waitForFunction(() => document.body.innerText.includes("Customer's link copied"));
  const copied = await tab.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.endsWith(`/order?id=${order.id}&k=${order.key}`), copied);
  const teamUrl = tab.url();
  // The team's invoice.
  await tab.click('.order-actions a');
  await tab.waitForSelector('#invoice');
  assert.match(await tab.getAttribute('#inv-back', 'href'), /&team=/);
  // The same team link pasted in another browser: "This team link has ended", no amounts.
  const other = await newContext(browser);
  const p2 = await other.newPage();
  await p2.goto(teamUrl);
  await p2.waitForSelector('.card.empty h2');
  assert.strictEqual(await p2.textContent('.card.empty h2'), 'This team link has ended');
  assert.deepStrictEqual(await moneyOnPage(p2), []);
  await other.close();
  await ctx.close();
});

test('a customer with no email: the shop\'s edit link (WhatsApp) opens the editor on any phone and sends the new version', { timeout: 120000 }, async () => {
  // A big run of mugs: checked by the shop first, which asks for a change.
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const make = async () => {
    const r = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', quantities: [{ color: 'white', size: '11oz', qty: 60 }], sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi', left: 40, top: 40, fontSize: 40, fill: '#222222', styles: [] }] } } } })).json();
    for (const name of r.files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(2590, 1049) : await png(60, 52);
      await fetch(`${srv.base}/api/designs/${r.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': r.uploadToken }, body });
    }
    await fetch(`${srv.base}/api/designs/${r.id}/complete`, { method: 'POST', headers: { 'x-upload-token': r.uploadToken } });
    return r.id;
  };
  const id = await make();
  const q = await (await post('/api/cart/quote', { designIds: [id] })).json();
  const proof = await (await fetch(`${srv.base}/api/designs/${id}/proof`)).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [id], expectedTotal: q.total, approvals: { [id]: { proofHash: proof.proofHash } } })).json();
  const it = o.items[0];
  assert.strictEqual(it.status, 'review');
  const auth = { Authorization: `Bearer ${ownerToken}` };
  assert.strictEqual((await post(`/api/admin/items/${it.id}/review`, { action: 'changes', note: 'Please make the text bigger.' }, auth)).status, 200);
  const rv = (await (await fetch(`${srv.base}/api/admin/review`, { headers: auth })).json()).items.find((x) => x.id === it.id);
  assert.match(rv.reviseLink, /^\/editor\?design=.+&rt=/);

  // A fresh phone (nothing stored, no order link): the edit link alone.
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  await page.goto(srv.base + rv.reviseLink);
  await page.waitForSelector('.revise-bar');
  assert.match(await page.textContent('.revise-bar'), /Please make the text bigger/);
  await page.waitForFunction(() => window.__editor);
  await page.click('#add-to-cart');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 60000 });
  assert.ok(dialogs.some((m) => /Sent!/.test(m)), JSON.stringify(dialogs));
  const after = (await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json()).items[0];
  assert.strictEqual(after.status, 'review');
  assert.notStrictEqual(after.designId, id);
  assert.deepStrictEqual(errors, []);
  await ctx.close();
});
