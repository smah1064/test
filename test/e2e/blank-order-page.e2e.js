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
  } finally {
    await browser.close();
    await srv.close();
  }
});
