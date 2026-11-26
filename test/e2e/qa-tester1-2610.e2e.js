'use strict';

// Tester 1 (6 pm Cairo, 26 Nov), in the browser: a typed coupon that only saves less than an automatic offer was
// dropped (and the offer then wasn't for this phone); the cart's quantity box went to the least when emptied or given
// "abc" / 0; the computer counter said "type how many under it" over no boxes; the print check missed sample details
// sharing a line; the book's choices had no group name or pressed state; approvals in Arabic put a code at the far left.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

let srv;
let browser;
let token;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});
function post(url, body, headers = {}) {
  return fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
const PHONE = '01098765432';
const CUSTOMER = { name: 'Mona Adel', phone: PHONE, governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' };
async function mug(text = 'hi') {
  const made = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text }] } } } })).json();
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const up = await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
    assert.strictEqual(up.status, 204, name);
  }
  return (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
}
const cartEntry = (d) => ({ designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() });
async function cartWith(entry) {
  const ctx = await newContext(browser);
  await ctx.addInitScript((e) => { if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${srv.base}/cart`);
  await page.waitForFunction(() => document.getElementById('total').textContent.trim() !== '', null, { timeout: 30000 });
  return { ctx, page };
}

test('cart: a typed code beaten by the automatic offer stays typed; with a phone that used the offer, it is the coupon', { timeout: 120000 }, async () => {
  const admin = (body) => post('/api/admin/coupons', body, { Authorization: `Bearer ${token}` });
  const once = await admin({ code: 'ONCE30', type: 'percent', value: 30, auto: true, perCustomer: 1 });
  assert.strictEqual(once.status, 201, await once.clone().text());
  assert.strictEqual((await admin({ code: 'MINE10', type: 'percent', value: 10 })).status, 201);
  // This phone has had the offer already.
  const first = await mug('first');
  const q = await (await post('/api/cart/quote', { designIds: [first.id] })).json();
  const proof = await (await fetch(`${srv.base}/api/designs/${first.id}/proof`)).json();
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [first.id], expectedTotal: q.total, approvals: { [first.id]: { proofHash: proof.proofHash } } });
  assert.strictEqual(o.status, 201, await o.clone().text());

  const d = await mug('second');
  const { ctx, page } = await cartWith(cartEntry(d));
  try {
    await page.waitForFunction(() => document.getElementById('coupon-code').textContent === 'ONCE30', null, { timeout: 15000 });
    await page.click('#coupon-open'); // (the field behind "Have a discount code?": owner, 26 Nov)
    await page.fill('#coupon', 'MINE10');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => /ONCE30/.test(document.getElementById('coupon-msg').textContent), null, { timeout: 15000 });
    assert.strictEqual(await page.inputValue('#coupon'), 'MINE10', 'the code stays typed in');
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('pod-coupon')), 'MINE10');
    assert.strictEqual(await page.evaluate(() => document.getElementById('coupon-msg').classList.contains('bad')), false, 'said, not as a mistake');
    // The phone is typed: the offer isn't for it any more, the customer's own code is.
    await page.fill('#phone', PHONE);
    await page.press('#phone', 'Tab');
    await page.waitForFunction(() => document.getElementById('coupon-code').textContent === 'MINE10', null, { timeout: 15000 });
    assert.strictEqual(await page.isHidden('#coupon-auto'), true);
    assert.match(await page.textContent('#discount'), /25/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
    await fetch(`${srv.base}/api/admin/coupons/${(await once.json()).id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ active: false }) });
  }
});

test('cart: the quantity box emptied, "abc" or 0 goes back to the number it had (not the least)', { timeout: 120000 }, async () => {
  const d = await mug('qty');
  const { ctx, page } = await cartWith(cartEntry(d));
  const qtyNow = () => page.evaluate(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities ? c[0].quantities[0].qty : 1; });
  try {
    await page.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
    await page.fill('.cart-qty .qty-n', '7');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 7; }, null, { timeout: 30000 });
    for (const typed of ['', 'abc', '0', '٠']) {
      await page.fill('.cart-qty .qty-n', typed);
      await page.press('.cart-qty .qty-n', 'Enter');
      await page.waitForTimeout(600);
      assert.strictEqual(await page.inputValue('.cart-qty .qty-n'), '7', `"${typed}"`);
      assert.strictEqual(await qtyNow(), 7, `"${typed}" kept 7`);
    }
    // A real number still changes it.
    await page.fill('.cart-qty .qty-n', '4');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'); return c[0] && c[0].quantities && c[0].quantities[0].qty === 4; }, null, { timeout: 30000 });
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('editor on a computer: the − 1 + counter says how many, not "type how many under it"', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await page.waitForSelector('#qty-field .qty-step [data-qstep="1"]', { timeout: 15000 });
    assert.strictEqual(await page.$('#qty-field .qty-in'), null, 'the counter, no boxes');
    const sum = await page.textContent('#qty-field .qty-sum');
    assert.doesNotMatch(sum, /Choose a size|under it/);
    assert.match(sum, /1 piece/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('print check: a sample phone or email sharing a line is flagged; a customer\'s own words beside a dot are not', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    const flagged = await page.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const texts = ['01001234567   |   sara@example.com', 'سارة أحمد  •  sara@example.com', 'القاهرة، مصر · 0100 123 4567 · info@company.com', 'اسم الشركة', 'Elegant · Modern', '01112223334 | mona@mail.com'];
      for (const [i, s] of texts.entries()) ed.canvas.add(new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + 20 + i * 30, originX: 'center', originY: 'center', fontSize: 18, fill: '#000' }));
      return ed.checkIssues().filter((x) => x.key === 'check.sampleText').map((x) => x.obj.text);
    });
    assert.deepStrictEqual(flagged.sort(), ['01001234567   |   sara@example.com', 'سارة أحمد  •  sara@example.com', 'القاهرة، مصر · 0100 123 4567 · info@company.com', 'اسم الشركة'].sort());
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('book: each question\'s choices are a group named by the question, the picked one pressed', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/book?b=dream-jobs`);
    await page.waitForSelector('#bk:not([hidden]) #bk-questions [data-choice]');
    const groups = await page.$$eval('#bk-questions [data-choice]', (els) => els.map((g) => ({
      role: g.getAttribute('role'),
      name: (document.getElementById(g.getAttribute('aria-labelledby')) || {}).textContent || '',
      pressed: [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')),
    })));
    assert.ok(groups.length >= 1);
    for (const g of groups) {
      assert.strictEqual(g.role, 'group');
      assert.ok(g.name.trim(), 'named');
      assert.ok(g.pressed.every((p) => p === 'true' || p === 'false'), JSON.stringify(g.pressed));
    }
    const choice = await page.$('#bk-questions [data-choice] button:last-child');
    await choice.click();
    const after = await page.$eval('#bk-questions [data-choice]', (g) => [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')));
    assert.strictEqual(after[after.length - 1], 'true');
    assert.strictEqual(after.filter((p) => p === 'true').length, 1);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('approvals in Arabic: a code or an English value sits beside its label, not at the far left', { timeout: 90000 }, async () => {
  const WHO = { id: 'u-hala', name: 'Hala هالة', username: 'hala' };
  const APPROVALS = [{ id: 'ap9', at: '2026-11-26T15:30:00Z', by: WHO, roles: ['finance'], action: 'coupon.create', status: 'pending', method: 'POST', path: '/api/admin/coupons', summary: { en: 'New coupon: EID20', ar: 'كوبون جديد: EID20' }, changes: [{ field: { en: 'code', ar: 'الكود' }, value: { en: 'EID20', ar: 'EID20' } }, { field: { en: 'type', ar: 'النوع' }, value: { en: 'percent off', ar: 'نسبة خصم' } }] }];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  await ctx.route('**/api/admin/approvals**', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: APPROVALS }) })
    : route.continue()));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="approvals"]');
    await page.waitForSelector('#ap-ap9 .ap-changes dd');
    const rows = await page.$$eval('#ap-ap9 .ap-changes dd', (els) => els.map((dd) => {
      const v = dd.querySelector('bdi');
      return { text: dd.textContent, ddRight: dd.getBoundingClientRect().right, valueRight: v.getBoundingClientRect().right, dir: v.getAttribute('dir') };
    }));
    assert.deepStrictEqual(rows.map((r) => [r.text, r.dir]), [['EID20', 'ltr'], ['نسبة خصم', 'rtl']]);
    for (const r of rows) assert.ok(Math.abs(r.ddRight - r.valueRight) < 2, `the value starts at the label's side: ${JSON.stringify(r)}`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});
