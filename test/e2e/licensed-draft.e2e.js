'use strict';

/**
 * Browser test of a draft licensed collection (src/licensed.js, src/library-packs/licensed-spiderman.js):
 * a visitor never sees it; a browser signed in to the dashboard opens a design, types the child's name and
 * age, sees the © notice (no editor button), adds it to the cart and places a full test order, whose print
 * file is stored and which Review flags as licensed artwork. The artwork is placeholders.
 *
 * Run:  node --test test/e2e/licensed-draft.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, startServer, newContext } = require('./helpers');

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('a visitor never sees the draft collection', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto(`${srv.base}/designs`, { waitUntil: 'load' });
  const lib = await page.evaluate(() => POD.api('/api/library'));
  assert.ok(lib.designs.length > 20);
  assert.ok(!lib.designs.some((d) => d.licensed), 'no licensed design listed');
  assert.ok(!lib.categories.some((c) => c.id === 'licensed-spiderman'), 'its category isn\'t named');
  const one = await page.evaluate(() => fetch('/api/library/lic-sm-invitation').then((r) => r.status));
  assert.strictEqual(one, 404);
  await ctx.close();
});

test('the team: name and age, the notice, no editor, a full test order with its print file', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  // Signed in to the dashboard in this browser (sets the team's cookie).
  await page.goto(`${srv.base}/`, { waitUntil: 'load' });
  const login = await page.evaluate(() => fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) }).then((r) => r.status));
  assert.strictEqual(login, 200);

  const lib = await page.evaluate(() => POD.api('/api/library'));
  const mine = lib.designs.filter((d) => d.licensed);
  assert.deepStrictEqual(mine.map((d) => d.id).sort(), ['lic-sm-favor-bag', 'lic-sm-invitation', 'lic-sm-stickers', 'lic-sm-thankyou', 'lic-sm-welcome-sign']);
  for (const d of mine) assert.strictEqual(d.products.length, 1, `${d.id}: one product only`);
  const forEditor = await page.evaluate(() => POD.api('/api/library?for=editor'));
  assert.ok(!forEditor.designs.some((d) => d.licensed), 'never offered in the editor');

  await page.goto(`${srv.base}/design?id=lic-sm-invitation`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 30000 });
  assert.strictEqual(await page.isVisible('#dp-edit'), false, 'no editor button');
  assert.strictEqual(await page.isVisible('#dp-lic-draft'), true, 'draft line');
  assert.match(await page.textContent('#dp-lic-notice'), /©.*Used under license/);
  // Two boxes: the child's name, then the age (numbers keyboard).
  const boxes = page.locator('#dp-names input');
  assert.strictEqual(await boxes.count(), 2);
  assert.strictEqual(await boxes.nth(1).getAttribute('inputmode'), 'numeric');
  await boxes.nth(0).fill('Omar');
  await boxes.nth(1).fill('7');

  const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()) && r.ok(), { timeout: 60000 });
  await page.click('#dp-add');
  const res = await done;
  const designId = /\/api\/designs\/([^/]+)\/complete$/.exec(res.url())[1];
  await page.waitForURL(/\/cart/, { timeout: 30000 });
  const ed = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'files', designId, 'editor.json'), 'utf8'));
  const texts = Object.values(ed).flatMap((s) => s.objects.filter((o) => typeof o.text === 'string').map((o) => o.text));
  assert.ok(texts.some((x) => x.includes('Omar')), texts.join(' | '));
  assert.ok(texts.some((x) => x.includes('7')), texts.join(' | '));
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'files', designId, 'front-print.png')), 'print file stored');

  // Checkout, as a customer would.
  await page.waitForSelector('#place-order');
  await page.fill('#name', 'Test Order');
  await page.fill('#phone', '01012345678');
  await page.selectOption('#governorate', 'cairo');
  await page.fill('#city', 'Nasr City');
  await page.fill('#address', '12 Abbas El Akkad St');
  // (A name was typed in: the customer ticks "I've checked the preview", as for any design of their own.)
  await page.check('#proof-ok-box');
  await page.click('#place-order');
  await page.waitForURL(/\/order\?/, { timeout: 60000 }).catch(async (e) => {
    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true });
    throw new Error(`${e.message} | ${await page.evaluate(() => [...document.querySelectorAll('.toast, .error, [role=alert], .field-error')].map((x) => x.textContent).join(' / '))}`);
  });
  const order = await page.evaluate(async () => {
    const u = new URL(location.href);
    const id = u.searchParams.get('id');
    return POD.api('/api/orders/' + encodeURIComponent(id), { headers: POD.orderHeaders(POD.orderKey(id, u.searchParams.get('k'))) });
  });
  assert.strictEqual(order.items.length, 1);
  const proof = await page.evaluate((id) => POD.api(`/api/designs/${id}/proof`), designId);
  assert.ok(proof.review.reasons.includes('licensed'), JSON.stringify(proof.review));
  assert.deepStrictEqual(page.errors, []);
  await ctx.close();
});

test('a visitor can\'t add or order a draft licensed design, even by its address', { timeout: 60000 }, async () => {
  const r = await fetch(`${srv.base}/api/designs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'invitations', colorId: 'matte', sizeId: '13x18', sides: { front: { editor: { version: '5.3.0', objects: [{ type: 'i-text', text: 'x' }], library: 'lic-sm-invitation', area: { x: 0, y: 0, w: 1, h: 1 } } } } }),
  });
  assert.ok(r.status === 404 || r.status === 400, String(r.status));
});
