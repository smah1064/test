'use strict';

/**
 * Browser test of QA wave 4 (shop, 25 Nov): on a ready design (/design, public/js/design.js) no size of a garment
 * looks picked until the customer picks one ("Pick your size"); a tap, a link with &size= or "Which size?" marks
 * it; a picked size sold out in another colour is un-picked and said. In the cart (public/cart.html), a coupon
 * code typed with Arabic letters is told that codes are English letters and numbers, in the page's language,
 * without asking the shop.
 *
 * Run:  node --test test/e2e/shop4.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

let srv;
let browser;
let owner;

test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  owner = (await (await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) })).json()).token;
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

const setStock = (id, variantStock) => fetch(`${srv.base}/api/admin/catalog/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner}` }, body: JSON.stringify({ variantStock }) });
const drawn = (page) => page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 30000 });
async function openDesign(query) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${srv.base}/design?${query}`, { waitUntil: 'load' });
  await drawn(page);
  return page;
}
/** The sizes as shown: the ones marked, and the hint. */
const sizes = (page) => page.evaluate(() => ({
  active: [...document.querySelectorAll('#dp-sizes .chip.active')].map((b) => b.dataset.size),
  pressed: [...document.querySelectorAll('#dp-sizes [aria-pressed="true"]')].map((b) => b.dataset.size),
  hint: document.getElementById('dp-size-hint').hidden ? null : document.getElementById('dp-size-hint').textContent,
  size: new URLSearchParams(location.search).get('size'),
  edit: new URL(document.getElementById('dp-edit').href).searchParams.get('size'),
}));

test('clothes: no size looks picked until one is; a tap, the link and "Which size?" mark it', { timeout: 120000 }, async () => {
  const page = await openDesign('id=xm-noel&product=tshirt&color=black');
  try {
    assert.deepStrictEqual(await sizes(page), { active: [], pressed: [], hint: ': Pick your size', size: null, edit: null });
    // Add to cart asks, and nothing is marked meanwhile.
    await page.click('#dp-add');
    assert.ok(await page.isVisible('#size-ask'));
    await page.click('#size-ask-cancel');
    assert.deepStrictEqual((await sizes(page)).active, []);
    // A tap.
    await page.click('#dp-sizes [data-size="L"]');
    await drawn(page);
    assert.deepStrictEqual(await sizes(page), { active: ['L'], pressed: ['L'], hint: null, size: 'L', edit: 'L' });
    // Another garment with that size: still picked; a cap (one size): its size, as before.
    await page.click('#dp-products [data-product="cap"]');
    await drawn(page);
    assert.deepStrictEqual((await sizes(page)).active, ['one']);
    assert.strictEqual((await sizes(page)).hint, null);
    await page.click('#dp-products [data-product="hoodie"]');
    await drawn(page);
    assert.deepStrictEqual(await sizes(page), { active: ['L'], pressed: ['L'], hint: null, size: 'L', edit: 'L' });
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
  // A link with &size=.
  const linked = await openDesign('id=xm-noel&product=tshirt&color=black&size=M');
  try {
    assert.deepStrictEqual(await sizes(linked), { active: ['M'], pressed: ['M'], hint: null, size: 'M', edit: 'M' });
  } finally {
    await linked.context().close();
  }
  // "Which size?" marks the size picked there (a design with a sample name: the name question keeps the page).
  const baby = await openDesign('id=ce-welcome-baby');
  try {
    assert.deepStrictEqual((await sizes(baby)).active, []);
    await baby.click('#dp-add');
    await baby.click('#size-ask [data-ask-size="6-12"]');
    assert.ok(await baby.isVisible('#name-ask'));
    assert.deepStrictEqual(await sizes(baby), { active: ['6-12'], pressed: ['6-12'], hint: null, size: '6-12', edit: '6-12' });
  } finally {
    await baby.context().close();
  }
});

test('clothes: a picked size sold out in another colour is un-picked and said', { timeout: 90000 }, async () => {
  assert.strictEqual((await setStock('tshirt', { 'white|S': 0, 'white|L': 0, 'black|L': 2 })).status, 200);
  const page = await openDesign('id=xm-noel&product=tshirt&color=black');
  try {
    // Nothing picked: the first size (used behind the scenes) sold out in white moves without a word.
    await page.click('#dp-colors [data-color="white"]');
    await drawn(page);
    assert.strictEqual(await page.$$eval('.toast', (els) => els.length), 0);
    assert.deepStrictEqual((await sizes(page)).active, []);
    await page.click('#dp-colors [data-color="black"]');
    await drawn(page);
    // "Only 2 left" of black L once L is picked, not before.
    assert.ok(!(await page.isVisible('#dp-few')));
    await page.click('#dp-sizes [data-size="L"]');
    await drawn(page);
    assert.strictEqual(await page.textContent('#dp-few'), 'Only 2 left');
    await page.click('#dp-colors [data-color="white"]');
    await page.waitForSelector('.toast');
    assert.match(await page.textContent('.toast'), /^L is sold out in this colour\. Pick another size\.$/);
    const s = await sizes(page);
    assert.deepStrictEqual(s.active, []);
    assert.strictEqual(s.hint, ': Pick your size');
    assert.strictEqual(s.size, null);
    await drawn(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.context().close();
    await setStock('tshirt', null);
  }
});

test('cart: a coupon code in Arabic letters is told so in the page\'s language, without asking the shop', { timeout: 90000 }, async () => {
  const page = await openDesign('id=xm-noel&product=cap&color=black');
  try {
    await page.click('#dp-add');
    await page.waitForURL(/\/cart\?added=1/, { timeout: 60000 });
    await page.waitForSelector('#coupon');
    let asked = 0;
    page.on('request', (r) => { if (/\/api\/cart\/quote/.test(r.url()) && /عيد/.test(r.postData() || '')) asked += 1; });
    await page.fill('#coupon', 'عيد٢٠');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => document.getElementById('coupon-msg').textContent !== '');
    assert.strictEqual(await page.textContent('#coupon-msg'), 'Coupon codes are in English letters and numbers, like EID20');
    assert.strictEqual(await page.inputValue('#coupon'), 'عيد20');
    assert.strictEqual(await page.getAttribute('#coupon', 'aria-invalid'), 'true');
    // In Arabic.
    await page.click('[data-lang-toggle]');
    await page.waitForFunction(() => /كود الخصم/.test(document.getElementById('coupon-msg').textContent));
    assert.strictEqual(await page.textContent('#coupon-msg'), 'كود الخصم بيتكتب بحروف إنجليزي وأرقام، زي EID20');
    assert.strictEqual(asked, 0, 'the shop was not asked');
    // Typing another code clears it; an English one is asked about as before.
    await page.fill('#coupon', 'EID20');
    assert.strictEqual(await page.textContent('#coupon-msg'), '');
    await page.click('#coupon-apply');
    await page.waitForFunction(() => document.getElementById('coupon-msg').textContent !== '');
    assert.strictEqual(await page.textContent('#coupon-msg'), 'كود الخصم ده غير صحيح');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
