'use strict';

// QA (26 Nov): the Arabic Activity log and Approvals turned the digits of typed values Arabic-Indic (tracking
// 7834512690 → ٧٨٣٤٥١٢٦٩٠, printing house "مطبعة 01012345678", a coupon "2026"). The server wraps each typed value
// in its summaries in first-strong isolates (U+2068 … U+2069): the page keeps their digits as typed, turns the
// shop's own numbers around them Arabic-Indic, and reads a line that starts with a Latin code as Arabic.
// The two lists are answered here with page.route() as the server's contract says; the rest is a real server,
// signed in with the owner's shared password.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

const F = '\u2068';
const P = '\u2069';
const WHO = { id: 'u-hala', name: 'Hala هالة', username: 'hala' };
const ACTIVITY = [
  { id: 'e1', at: '2026-11-25T11:00:00Z', who: WHO, roles: ['operations'], action: 'order.ship', status: 200, method: 'PATCH', path: '/api/admin/orders/x/shipment', summary: { en: `Order 1001 shipped, tracking ${F}7834512690${P}`, ar: `الطلب 1001 اتشحن، رقم التتبع ${F}7834512690${P}` } },
  { id: 'e2', at: '2026-11-25T10:00:00Z', who: WHO, roles: ['operations'], action: 'house.create', status: 200, method: 'POST', path: '/api/admin/houses', summary: { en: `New printing house ${F}مطبعة 01012345678${P} for 3 products`, ar: `مطبعة جديدة ${F}مطبعة 01012345678${P} لـ 3 منتجات` } },
  { id: 'e3', at: '2026-11-25T09:00:00Z', who: WHO, roles: ['operations'], action: 'order.ship', status: 200, method: 'PATCH', path: '/api/admin/orders/y/shipment', summary: { en: `${F}BST-1234${P} shipped (2 items)`, ar: `${F}BST-1234${P} اتشحن (2 قطع)` } },
];
const APPROVALS = [
  { id: 'ap1', at: '2026-11-25T09:30:00Z', by: WHO, roles: ['finance'], action: 'coupon.create', status: 'pending', method: 'POST', path: '/api/admin/coupons', summary: { en: `New coupon: ${F}2026${P} (15 uses)`, ar: `كوبون جديد: ${F}2026${P} (15 مرة)` }, changes: [{ field: { en: 'Code', ar: 'الكود' }, value: { en: `${F}2026${P}`, ar: `${F}2026${P}` } }, { field: { en: 'Uses', ar: 'مرات الاستخدام' }, value: { en: '15', ar: '15' } }] },
];

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('Arabic Activity log and Approvals: typed values keep their digits, the shop\'s numbers are Arabic-Indic', { timeout: 90000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  await ctx.route('**/api/admin/activity**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: ACTIVITY, more: false }) }));
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

    // Activity log.
    await page.click('[data-tab="activity"]');
    await page.waitForSelector('.act-table .act-row');
    const what = await page.$$eval('.act-row td:nth-child(3) > span:first-child', (els) => els.map((e) => ({ text: e.textContent, dir: getComputedStyle(e).direction })));
    assert.strictEqual(what.length, 3);
    assert.strictEqual(what[0].text, `الطلب ١٠٠١ اتشحن، رقم التتبع ${F}7834512690${P}`);
    assert.strictEqual(what[1].text, `مطبعة جديدة ${F}مطبعة 01012345678${P} لـ ٣ منتجات`);
    assert.strictEqual(what[2].text, `${F}BST-1234${P} اتشحن (٢ قطع)`);
    // (A line that starts with a typed Latin code still reads as Arabic, right to left: the isolate is skipped.)
    assert.deepStrictEqual(what.map((w) => w.dir), ['rtl', 'rtl', 'rtl']);
    // The code itself is drawn in one piece, left to right: "BST" left of "1234".
    const order = await page.evaluate(() => {
      const span = document.querySelectorAll('.act-row td:nth-child(3) > span:first-child')[2];
      const text = span.firstChild;
      const box = (from, to) => {
        const r = document.createRange();
        r.setStart(text, from);
        r.setEnd(text, to);
        return r.getBoundingClientRect();
      };
      const s = text.data.indexOf('BST');
      const d = text.data.indexOf('1234');
      return { bst: box(s, s + 3).left, num: box(d, d + 4).left, arabic: box(text.data.indexOf('اتشحن'), text.data.indexOf('اتشحن') + 5).left };
    });
    assert.ok(order.bst < order.num, `BST before 1234: ${JSON.stringify(order)}`);
    assert.ok(order.arabic < order.bst, `the Arabic words to its left (RTL): ${JSON.stringify(order)}`);

    // Approvals.
    await page.click('[data-tab="approvals"]');
    await page.waitForSelector('#ap-ap1 .ap-summary');
    assert.strictEqual(await page.textContent('#ap-ap1 .ap-summary'), `كوبون جديد: ${F}2026${P} (١٥ مرة)`);
    const dd = await page.$$eval('#ap-ap1 .ap-changes dd', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(dd, [`${F}2026${P}`, '١٥']);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});
