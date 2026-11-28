'use strict';

// QA tester 2 (25 Nov, bugs 15 and 16), in the browser: a product page opened earlier saves only what was changed on
// it. A colleague's other-language name or description, embroidery price, or print side switched off meanwhile stays.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

/** The admin page signed in as the owner, with a product open (and its newest copy read, so it's settled). */
async function openProduct(browser, base, id) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(`${base}/admin`);
  await page.fill('#password', 'secret');
  await page.press('#password', 'Enter');
  await page.waitForSelector('#dash:not([hidden])');
  await page.click('[data-tab="products"]');
  await page.waitForSelector(`#pm-root [data-pm-act="edit"][data-id="${id}"]`);
  const latest = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/admin/catalog/${id}`));
  await page.click(`#pm-root [data-pm-act="edit"][data-id="${id}"]`);
  await page.waitForSelector('#pm-sec-tech');
  await latest;
  await page.waitForTimeout(150);
  return page;
}
/** Click a section's Save and wait for its PUT; returns the body sent. */
async function saveSection(page, id, sec) {
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/admin/catalog/${id}`));
  await page.click(`[data-pm-save="${sec}"]`);
  const r = await put;
  assert.strictEqual(r.status(), 200, await r.text());
  await page.waitForFunction((s) => document.querySelector(`[data-pm-save="${s}"]`).disabled, sec);
  return JSON.parse(r.request().postData());
}

let srv;
let browser;
let api;
let owner;
test.before(async () => {
  const { chromium } = loadPlaywright();
  srv = await startServer();
  browser = await chromium.launch();
  api = async (url, method, body, token = owner) => {
    const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  owner = (await api('/api/admin/login', 'POST', { password: 'secret' }, null)).json.token;
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});
const get = async (id) => (await api(`/api/admin/catalog/${id}`, 'GET')).json;

test('Products › Name and description: fixing one language keeps a colleague\'s other language (bug 15)', { timeout: 90000 }, async () => {
  const page = await openProduct(browser, srv.base, 'sweatshirt');
  const was = await get('sweatshirt');
  assert.strictEqual(await page.inputValue('[name="name.ar"]'), 'سويتشيرت');

  // A colleague changes the Arabic name and description meanwhile.
  const arDesc = 'سويتشيرت ميلتون تقيل ودافي.';
  assert.strictEqual((await api('/api/admin/catalog/sweatshirt', 'PUT', { name: { en: was.name.en, ar: 'سويتشيرت مريح' }, description: { en: was.description.en, ar: arDesc } })).status, 200);

  // Here, on the page opened before: only the English name and description.
  await page.fill('[name="name.en"]', 'Cozy Sweatshirt');
  await page.fill('[name="desc.en"]', 'A soft fleece crewneck.');
  await saveSection(page, 'sweatshirt', 'basics');
  let now = await get('sweatshirt');
  assert.deepStrictEqual(now.name, { en: 'Cozy Sweatshirt', ar: 'سويتشيرت مريح' }, 'the colleague\'s Arabic name stays');
  assert.deepStrictEqual(now.description, { en: 'A soft fleece crewneck.', ar: arDesc }, 'the colleague\'s Arabic description stays');
  // The page shows what is saved now.
  assert.strictEqual(await page.inputValue('[name="name.ar"]'), 'سويتشيرت مريح');

  // The other way round: the colleague changes the English name; here only the Arabic description changes.
  assert.strictEqual((await api('/api/admin/catalog/sweatshirt', 'PUT', { name: { en: 'Warm Sweatshirt', ar: 'سويتشيرت مريح' } })).status, 200);
  await page.fill('[name="desc.ar"]', 'سويتشيرت ناعم.');
  const sent = await saveSection(page, 'sweatshirt', 'basics');
  assert.ok(!('name' in sent), `the name wasn't changed here: not sent (${JSON.stringify(sent)})`);
  now = await get('sweatshirt');
  assert.deepStrictEqual(now.name, { en: 'Warm Sweatshirt', ar: 'سويتشيرت مريح' });
  assert.deepStrictEqual(now.description, { en: 'A soft fleece crewneck.', ar: 'سويتشيرت ناعم.' });
  assert.deepStrictEqual(page.errors, []);
  await page.context().close();
});

test('Products › Technology & embroidery: changing the thread colours keeps a colleague\'s embroidery price (bug 16)', { timeout: 90000 }, async () => {
  const page = await openProduct(browser, srv.base, 'cap');
  const was = (await get('cap')).embroiderySpec;
  assert.strictEqual(was.surcharge, 100);
  assert.strictEqual(await page.inputValue('[name="embPrice"]'), '100');

  // A colleague raises the embroidery price meanwhile.
  assert.strictEqual((await api('/api/admin/catalog/cap', 'PUT', { embroidery: { ...was, surcharge: 200 } })).status, 200);

  // Here: only the thread colours, 6 → 8.
  await page.fill('[name="embColors"]', '8');
  const sent = await saveSection(page, 'cap', 'tech');
  assert.ok(!('process' in sent) && !('methods' in sent), `the technology wasn't changed here (${JSON.stringify(sent)})`);
  const now = (await get('cap')).embroiderySpec;
  assert.strictEqual(now.surcharge, 200, 'the colleague\'s price stays');
  assert.strictEqual(now.maxColors, 8, 'the change made here is saved');
  assert.deepStrictEqual(now.cm, was.cm);
  const shop = (await (await fetch(`${srv.base}/api/products`)).json()).products.find((p) => p.id === 'cap');
  assert.strictEqual(shop.embroidery.surcharge, 200, 'customers pay the new price');

  // And the other way round: a colleague changes the thread colours, the price is changed here.
  assert.strictEqual((await api('/api/admin/catalog/cap', 'PUT', { embroidery: { ...now, maxColors: 10 } })).status, 200);
  await page.fill('[name="embPrice"]', '250');
  await saveSection(page, 'cap', 'tech');
  const after = (await get('cap')).embroiderySpec;
  assert.strictEqual(after.surcharge, 250);
  assert.strictEqual(after.maxColors, 10, 'the colleague\'s thread colours stay');
  assert.deepStrictEqual(page.errors, []);
  await page.context().close();
});

test('Products › Print areas: changing the front margin keeps a colleague\'s back side switched off (bug 16)', { timeout: 90000 }, async () => {
  const page = await openProduct(browser, srv.base, 'tote');
  assert.strictEqual(await page.isChecked('[name="on.back"]'), true);

  // A colleague switches the back side off meanwhile.
  assert.strictEqual((await api('/api/admin/catalog/tote', 'PUT', { sides: { back: { off: true } } })).status, 200);

  // Here: only the front's safe margin.
  await page.fill('[name="safe.front"]', '8');
  await saveSection(page, 'tote', 'print');
  let now = await get('tote');
  const side = (p, id) => p.sides.find((s) => s.id === id);
  assert.strictEqual(side(now, 'back').off, true, 'the colleague\'s change stays');
  assert.strictEqual(side(now, 'front').safeMm, 8, 'the change made here is saved');
  assert.ok(!side(now, 'front').off);

  // A colleague moves the front print area; here the back side is switched on again: the area stays where they put it.
  const area = { x: 160, y: 270, w: 180, h: 220 };
  assert.strictEqual((await api('/api/admin/catalog/tote', 'PUT', { sides: { front: { safeMm: 8, area }, back: { off: true } } })).status, 200);
  await page.check('[name="on.back"]');
  await saveSection(page, 'tote', 'print');
  now = await get('tote');
  assert.ok(!side(now, 'back').off, 'switched on here');
  assert.deepStrictEqual(side(now, 'front').printArea, area, 'the colleague\'s print area stays');
  assert.strictEqual(side(now, 'front').safeMm, 8);
  assert.deepStrictEqual(page.errors, []);
  await page.context().close();
});
