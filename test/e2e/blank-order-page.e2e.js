'use strict';

// QA 28 Nov: 3 plain glasses (sold unprinted) showed on the order page as "3 names", with a "Front" print side, an
// approved proof and "printing starts soon". Now: "3 pieces", no side, no proof line, and prepared rather than printed.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('order page: plain glasses read as pieces, with no print side or proof', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const api = async (method, url, body) => {
      const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    // QA 28 Nov: in the cart, a plain glass had a proof box saying its print file was missing, and needed the tick.
    {
      const ctx = await newContext(browser);
      await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'en'); } catch (e) { /* ignore */ } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${srv.base}/product?id=glasstaper`, { waitUntil: 'load' });
      await page.waitForSelector('#pp-blank-add');
      await Promise.all([page.waitForURL(/\/cart/), page.click('#pp-blank-add')]);
      await page.waitForSelector('.cart-item', { timeout: 20000 });
      await page.waitForTimeout(1500);
      const text = await page.textContent('main');
      assert.doesNotMatch(text, /print file is missing|could not be read/i, text);
      assert.strictEqual(await page.$('.cart-proof-title'), null, 'no proof box for a plain glass');
      assert.ok(await page.isHidden('#proof-ok'), 'nothing to tick');
      // The cart's − / + (owner, 28 Nov): 1 → 2 glasses, the price doubles.
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]')[0]);
      assert.ok(await page.$('[data-qstep="1"]'), 'a + button for the plain glass');
      await page.click('[data-qstep="1"]');
      await page.waitForFunction((p) => { const c = JSON.parse(localStorage.getItem('pod-cart-v2') || '[]')[0]; return c && c.price === p * 2; }, before.price, { timeout: 15000 });
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]')[0]);
      assert.strictEqual(after.kind, 'blank');
      assert.strictEqual(after.designId, before.designId, 'the same item, changed in place');
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
    const { products } = (await api('GET', '/api/products')).body;
    const glass = products.find((p) => p.blank);
    assert.ok(glass, 'a plain glass');
    const made = await api('POST', '/api/blanks', { productId: glass.id, qty: 3 });
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    const q = (await api('POST', '/api/cart/quote', { designIds: [made.body.id] })).body;
    const o = await api('POST', '/api/orders', { customer: { name: 'Mona', phone: '01011112222', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' }, designIds: [made.body.id], expectedTotal: q.total });
    assert.strictEqual(o.status, 201, JSON.stringify(o.body));
    for (const lang of ['en', 'ar']) {
      const ctx = await newContext(browser);
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const url = o.body.orderUrl || o.body.url || `/order?id=${encodeURIComponent(o.body.id)}${o.body.key ? `&k=${encodeURIComponent(o.body.key)}` : ''}`;
      await page.goto(srv.base + url);
      await page.waitForSelector('.order-items .cart-item', { timeout: 30000 });
      const item = await page.textContent('.order-items .cart-item');
      const now = await page.textContent('.track-hint').catch(() => '');
      if (lang === 'en') {
        assert.match(item, /3 pieces/, item);
        assert.doesNotMatch(item, /names|Front|approved/i, item);
        assert.doesNotMatch(now, /print/i, now);
      } else {
        assert.match(item, /٣ قطع/, item);
        assert.doesNotMatch(item, /أسماء|الأمام|وافقت/, item);
        assert.doesNotMatch(now, /الطباعة/, now);
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
    // QA 28 Nov: the dashboard's Queue said nothing about 3 glasses (the packer would send 1), showed a NaN print size
    // and the stock note twice, with print-file tools.
    for (const lang of ['en', 'ar']) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${srv.base}/admin`);
      await page.fill('#password', 'secret');
      await page.click('#login button[type=submit]');
      await page.waitForSelector('#dash:not([hidden])');
      await page.waitForSelector('.queue-row', { timeout: 20000 });
      const row = page.locator('.queue-row').filter({ hasText: o.body.number ? String(o.body.number) : '' }).first();
      const rowText = await row.textContent();
      assert.match(rowText, lang === 'en' ? /3 pieces/ : /٣ قطع/, rowText);
      assert.doesNotMatch(rowText, lang === 'en' ? /Front/ : /الأمام/, rowText);
      await row.locator('[data-toggle-item]').click();
      await page.waitForSelector('.queue-row.is-open', { timeout: 10000 });
      const details = await page.evaluate(() => { const r = document.querySelector('.queue-row.is-open'); let n = r.nextElementSibling; return r.textContent + ' ' + (n ? n.textContent : ''); });
      assert.doesNotMatch(details, /NaN|undefined/, details);
      assert.match(details, lang === 'en' ? /Pieces to pack/ : /القطع المطلوب تجهيزها/, details);
      const note = lang === 'en' ? 'Plain item from stock' : 'منتج سادة من المخزن';
      assert.strictEqual(details.split(note).length - 1, 1, 'the stock note once');
      assert.strictEqual(await page.$('.queue-row.is-open ~ * [data-download*="preview-pdf"], [data-back-open]'), null, 'no print-file tools');
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
