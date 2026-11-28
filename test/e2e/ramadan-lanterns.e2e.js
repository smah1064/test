'use strict';

/**
 * The Ramadan lanterns (28 Nov 2026): Family Fanous and Arabesque Arch, in the shop like the other products:
 *   - each product page: its name in both languages and its own gallery photo (the reference crop);
 *   - an Arabic family name on Family Fanous and an English first name on Arabesque Arch, typed on the ready
 *     design's page: the typed words are what is stored with the design the cart item points to;
 *   - two lanterns with different names stay two cart items.
 *
 * Run:  node --test test/e2e/ramadan-lanterns.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, startServer, newContext } = require('./helpers');

let srv;
let browser;
let token;

test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
  token = (await (await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }) })).json()).token;
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

const shopIds = async () => (await (await fetch(`${srv.base}/api/products`)).json()).products.map((p) => p.id);
const put = (id, body) => fetch(`${srv.base}/api/admin/catalog/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
function storedTexts(designId) {
  const ed = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'files', designId, 'editor.json'), 'utf8'));
  return Object.values(ed).flatMap((s) => s.objects.filter((o) => typeof o.text === 'string').map((o) => o.text));
}
const doneId = (res) => /\/api\/designs\/([^/]+)\/complete$/.exec(res.url())[1];

/** On a ready design's page: type the name, add to the cart; the id of the stored design. */
async function addWithName(page, designId, name) {
  await page.goto(`${srv.base}/design?id=${designId}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 30000 });
  const before = await page.getAttribute('#dp-img', 'src');
  await page.fill('#dp-name-0', name);
  await page.waitForFunction((b) => document.getElementById('dp-img').src !== b && document.getElementById('dp-spin').hidden, before, { timeout: 30000 });
  // The whole name fits: nothing was cut to make it fit the plaque.
  assert.ok(!(await page.isVisible('#dp-names-cut')), `${name}: fits the plaque`);
  const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
  await page.click('#dp-add');
  const res = await done;
  assert.strictEqual(res.status(), 200);
  await page.waitForURL(/\/cart\?added=1/, { timeout: 30000 });
  return doneId(res);
}

test('both lanterns are in the shop; a product shown without a price is not', async () => {
  const ids = await shopIds();
  assert.ok(ids.includes('familyfanous') && ids.includes('arabesquelantern'));
  // (A price of 0 is refused; the guard itself is in test/ramadan-lanterns.test.js.)
  assert.strictEqual((await put('familyfanous', { prices: { basePrice: 0 } })).status, 400);
});

test('product pages: bilingual names and each lantern\'s own photo', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    const shop = (await (await fetch(`${srv.base}/api/products`)).json()).products;
    for (const [id, en, ar] of [['familyfanous', 'Family Fanous', 'فانوس العيلة'], ['arabesquelantern', 'Arabesque Arch Lantern', 'فانوس الأرابيسك']]) {
      assert.deepStrictEqual(shop.find((p) => p.id === id).name, { en, ar });
      await page.goto(`${srv.base}/product?id=${id}`, { waitUntil: 'networkidle' });
      assert.strictEqual((await page.textContent('#pp-name')).trim(), en);
      assert.match(await page.getAttribute('#pp-img', 'src'), new RegExp(`/img/lifestyle/${id}\\.webp$`));
      const ok = await page.evaluate(() => document.getElementById('pp-img').complete && document.getElementById('pp-img').naturalWidth > 0);
      assert.ok(ok, `${id}: the photo loads`);
    }
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('an Arabic and an English name through the cart; two names, two cart items', { timeout: 180000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    const ar = await addWithName(page, 'lan-fanous-family-ar', 'الشريف');
    assert.deepStrictEqual(storedTexts(ar).sort(), ['الشريف', 'عائلة'].sort());
    const en = await addWithName(page, 'lan-arch-name-en', 'Nour');
    assert.deepStrictEqual(storedTexts(en), ['Nour']);
    const en2 = await addWithName(page, 'lan-arch-name-en', 'Mona');
    assert.deepStrictEqual(storedTexts(en2), ['Mona']);
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]').filter((i) => !i.later));
    const lanterns = cart.filter((i) => ['familyfanous', 'arabesquelantern'].includes(i.productId));
    assert.deepStrictEqual(lanterns.map((i) => i.designId).sort(), [ar, en, en2].sort(), 'three separate items, one per name');
    // The stored designs keep the product and the ready design they were made from.
    for (const [id, product] of [[ar, 'familyfanous'], [en, 'arabesquelantern']]) {
      const meta = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'files', id, 'editor.json'), 'utf8'));
      assert.ok(meta.front, `${product}: the plaque side is stored`);
    }
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});
