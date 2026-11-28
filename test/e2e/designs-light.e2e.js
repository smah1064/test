'use strict';

/**
 * Owner (26 Nov): "Make the ready-designs lists light and short" (/designs, public/js/designs.js). On a phone two
 * designs in a row; 24 at a time, then "Show more" as on the product page (kept for Back, a new search or filter
 * starts again at 24); the cards' artwork from the small copies (/img-w/320/art/...), not the 2–3 MB print files;
 * "All" takes one design from each category in turn, Christmas first until 7 January (Cairo's date).
 *
 * Run:  node --test test/e2e/designs-light.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;
let devices;
let lib;

test.before(async () => {
  srv = await startServer();
  const pw = loadPlaywright();
  devices = pw.devices;
  browser = await pw.chromium.launch();
  lib = await (await fetch(`${srv.base}/api/library`)).json();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** A phone (Pixel 7, 412 px; or 360 px) with the shop in `lang`; `now` fakes the date. */
async function phone(lang, { width, now } = {}) {
  const opts = width ? { viewport: { width, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { ...devices['Pixel 7'] };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('pod-lang', l);
    } catch (e) { /* ignore */ }
  }, lang);
  const page = await ctx.newPage();
  if (now) await page.clock.setFixedTime(new Date(now));
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return { ctx, page };
}
const CARDS = '#design-grid .design-card';
const cardCount = (page) => page.$$eval(CARDS, (els) => els.length);
const ids = (page) => page.$$eval(CARDS, (els) => els.map((el) => el.dataset.place));
const catOf = (id) => (lib.designs.find((d) => d.id === id) || {}).category;
/** Arabic-Indic digits back to a number. */
const arNum = (s) => Number(String(s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[^0-9]/g, ''));
async function open(page, query = '') {
  await page.goto(`${srv.base}/designs${query}`, { waitUntil: 'load' });
  await page.waitForSelector(CARDS);
}

test('phone (412 px, Arabic): two designs in a row, 24 then "Show more (N left)", which adds 24', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('ar');
  try {
    await open(page);
    assert.strictEqual(await page.evaluate(() => innerWidth), 412);
    assert.strictEqual(await cardCount(page), 24);
    // Two in a row: the first two side by side (the first on the right, in Arabic), the third under them.
    const boxes = await page.$$eval(CARDS, (els) => els.slice(0, 3).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, right: r.right }; }));
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1, 'the first two on one row');
    assert.ok(boxes[0].x > boxes[1].x, 'right to left');
    assert.ok(boxes[2].y > boxes[0].y + 50, 'the third on the next row');
    assert.ok(boxes[0].w > 150 && boxes[0].w < 200, `cards scaled to fit (${boxes[0].w})`);
    // The price line fits in its card.
    const fits = await page.$$eval(`${CARDS} .price`, (els) => els.slice(0, 6).every((p) => { const c = p.closest('.design-card').getBoundingClientRect(); const r = p.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && p.scrollWidth <= p.clientWidth + 1; }));
    assert.ok(fits, 'price lines fit');
    const total = arNum(await page.textContent('#design-count'));
    assert.ok(total > 100, `${total} designs`);
    const more = page.locator('#design-more button');
    const want = (n) => `اعرض تصميمات أكتر (فاضل ${String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])})`;
    assert.strictEqual((await more.textContent()).trim(), want(total - 24));
    // The same look as the product page's button.
    assert.strictEqual(await page.getAttribute('#design-more', 'class'), 'pp-more');
    await more.click();
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 48, CARDS);
    assert.strictEqual((await more.textContent()).trim(), want(total - 48));
    // The keyboard goes on at the first design just shown.
    assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('#design-grid .design-card')].indexOf(document.activeElement)), 24);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

for (const lang of ['ar', 'en']) {
  test(`360 px (${lang}): no sideways scroll, before and after "Show more"`, { timeout: 120000 }, async () => {
    const { ctx, page } = await phone(lang, { width: 360 });
    try {
      await open(page);
      const check = async () => {
        const m = await page.evaluate((s) => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          out: [...document.querySelectorAll(s)].filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).length,
          cols: new Set([...document.querySelectorAll(s)].map((el) => Math.round(el.getBoundingClientRect().left))).size,
        }), CARDS);
        assert.ok(m.sw <= m.cw, `no sideways scroll (${m.sw} > ${m.cw})`);
        assert.strictEqual(m.out, 0, 'every card on the screen sideways');
        assert.strictEqual(m.cols, 2, 'two in a row at 360 px too');
      };
      await check();
      await page.click('#design-more button');
      await page.waitForFunction((s) => document.querySelectorAll(s).length === 48, CARDS);
      await check();
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  });
}

test('the cards\' artwork comes from the small copies (/img-w/320/art/...), not the print files', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('ar');
  try {
    const art = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (/^\/(img|img-w\/\d+)\/art\//.test(u.pathname)) art.push(u.pathname);
    });
    await open(page);
    // The pictures on the screen are drawn, then those of the next 24.
    const drawn = (n) => page.waitForFunction(([s, k]) => [...document.querySelectorAll(`${s} img`)].slice(0, k).every((img) => img.getAttribute('src')), [CARDS, n], { timeout: 60000 });
    await drawn(4);
    await page.click('#design-more button');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction((s) => [...document.querySelectorAll(`${s} img`)].slice(-4).every((img) => img.getAttribute('src')), CARDS, { timeout: 60000 });
    // The Christmas designs are pictures (most others are drawn shapes and words).
    await page.click('#design-cats [data-cat="christmas"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await drawn(6);
    const raster = (p) => /\.(png|webp|jpe?g)$/i.test(p);
    const small = art.filter((p) => p.startsWith('/img-w/320/art/'));
    const big = art.filter((p) => raster(p) && !p.startsWith('/img-w/320/'));
    assert.ok(small.length >= 4, `small copies used (${small.length})`);
    assert.deepStrictEqual(big, [], 'no original (or 1200 px) artwork for the list');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('"All" mixes the categories, Christmas first until 7 January (Cairo); one category keeps its order', { timeout: 180000 }, async () => {
  const catIds = lib.categories.map((c) => c.id);
  /** The first 24 of "All" on a given day. */
  const firstOn = async (now, query = '') => {
    const { ctx, page } = await phone('ar', { now });
    try {
      await open(page, query);
      assert.deepStrictEqual(page.errors, []);
      return await ids(page);
    } finally {
      await ctx.close();
    }
  };
  // In the season: today, Christmas Eve, and 21:30 UTC on 7 January (23:30 in Cairo, still the 7th there).
  for (const now of ['2026-11-26T12:00:00Z', '2026-12-24T12:00:00Z', '2027-01-07T21:30:00Z']) {
    const first = await firstOn(now);
    const cats = first.map(catOf);
    // The first two are Christmas designs (owner, 26 Nov), then every subject takes its turn in the shop's order
    // (Christmas too, at its usual place).
    assert.deepStrictEqual(cats.slice(0, 2), ['christmas', 'christmas'], `${now}: two Christmas designs first (${cats.slice(0, 4)})`);
    const rest = cats.slice(2);
    assert.strictEqual(new Set(rest).size, rest.length, `${now}: then one from each subject (${rest.join(',')})`);
    assert.deepStrictEqual(rest, catIds.filter((c) => rest.includes(c)));
    assert.ok(cats.filter((c) => c === 'christmas').length <= 3);
  }
  // From 8 January in Cairo (22:30 UTC on the 7th is 00:30 on the 8th there): Christmas takes its usual turn.
  for (const now of ['2027-01-07T22:30:00Z', '2027-03-01T12:00:00Z']) {
    const first = await firstOn(now);
    const cats = first.map(catOf);
    assert.notStrictEqual(cats[0], 'christmas', `${now}: not Christmas first`);
    assert.strictEqual(new Set(cats).size, 24, `${now}: 24 categories`);
    assert.deepStrictEqual(cats, catIds.filter((c) => cats.includes(c)), `${now}: in the shop's order of categories`);
  }
  // Each category's designs keep their usual order; one category alone too.
  const xmas = lib.designs.filter((d) => d.category === 'christmas').map((d) => d.id);
  const shown = await firstOn('2026-11-26T12:00:00Z', '?cat=christmas');
  assert.deepStrictEqual(shown, xmas.filter((id) => shown.includes(id)).slice(0, shown.length));
  assert.strictEqual(shown[0], xmas.find((id) => shown.includes(id)));
});

test('a new search, category or product starts again at 24', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('en');
  try {
    await open(page);
    const more = async () => {
      const n = await cardCount(page);
      await page.click('#design-more button');
      await page.waitForFunction(([s, k]) => document.querySelectorAll(s).length > k, [CARDS, n]);
    };
    await more();
    assert.strictEqual(await cardCount(page), 48);
    // A category with more than 24 designs.
    const big = lib.categories.find((c) => lib.designs.filter((d) => d.category === c.id).length > 30);
    await page.click(`#design-cats [data-cat="${big.id}"]`);
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 24, CARDS);
    assert.match(await page.textContent('#design-more button'), /^Show more designs \(\d+ more\)$/);
    await more();
    assert.strictEqual(await cardCount(page), 48);
    // Back to "All", then a search.
    await page.click('#design-cats [data-cat="all"]');
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 24, CARDS);
    await more();
    await page.fill('#design-q', 'christmas');
    await page.press('#design-q', 'Enter');
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 24 && /q=christmas/.test(location.search), CARDS);
    assert.ok(await page.isVisible('#design-more button'), 'more Christmas designs to show');
    await more();
    assert.ok((await cardCount(page)) > 24);
    // A product.
    await page.selectOption('#design-product', 'tshirt');
    await page.waitForFunction((s) => document.querySelectorAll(s).length <= 24 && /product=tshirt/.test(location.search), CARDS);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('Back from a ready design keeps "Show more" and the place on the page', { timeout: 120000 }, async () => {
  const { ctx, page } = await phone('ar');
  try {
    await open(page);
    await page.click('#design-more button');
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 48, CARDS);
    const late = page.locator(CARDS).nth(41);
    const id = await late.getAttribute('data-place');
    await late.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 2000, `scrolled ${y}`);
    await late.click();
    await page.waitForURL(/\/design\?id=/);
    await page.goBack();
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 48, CARDS, { timeout: 15000 });
    await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 80, y, { timeout: 10000 });
    const r = await page.$eval(`${CARDS}[data-place="${id}"]`, (el) => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
    assert.ok(r, 'the design followed is in view again');
    // Picking a category (here "All" again) then starts again at 24.
    await page.click('#design-cats [data-cat="all"]');
    await page.waitForFunction((s) => document.querySelectorAll(s).length === 24, CARDS);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
