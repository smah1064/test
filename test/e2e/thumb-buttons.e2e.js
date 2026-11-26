'use strict';

// Thumb-size buttons, step 1 (owner's go 26 Nov): on phones (820px and less) the header's account icon, Cart and
// language button, the product page's colour circles, the ready-design page's sizes, the kids' book's Boy / Girl
// and cover, and the home page's "All products" buttons can each be hit in a 44 x 44 px box (checked point by
// point with document.elementFromPoint, so an invisible hit area counts), neighbouring colour circles' areas
// don't overlap, the header is no taller than without the change, and no page scrolls sideways at 360px.
// Computers (1366px) look exactly as without the change.
//
// "Without the change" is the same page with the "Thumb-size buttons, step 1" section cut out of styles.css.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

const SECTION_START = '/* ==========================================================================\n   Thumb-size buttons, step 1';
const SECTION_END = '/* (end of Thumb-size buttons, step 1) */';

let srv;
let browser;
let devices;
test.before(async () => {
  srv = await startServer();
  const pw = loadPlaywright();
  devices = pw.devices;
  browser = await pw.chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** A context in `lang`; `without` serves styles.css without the thumb-size section (the look before it). */
async function context(lang, opts, without = false) {
  const { defaultBrowserType, ...rest } = opts; // (Chromium for every device)
  const ctx = await browser.newContext({ ...rest, serviceWorkers: 'block' });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ }
  }, lang);
  if (without) {
    await ctx.route('**/css/styles.css*', async (route) => {
      const res = await route.fetch();
      const css = await res.text();
      const a = css.indexOf(SECTION_START);
      const b = css.indexOf(SECTION_END);
      assert.ok(a > 0 && b > a, 'the thumb-size section is marked in styles.css');
      await route.fulfill({ response: res, body: css.slice(0, a) + css.slice(b + SECTION_END.length) });
    });
  }
  return ctx;
}
const PIXEL_7 = () => devices['Pixel 7'];
const PHONE_360 = () => ({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
const DESKTOP = { viewport: { width: 1366, height: 900 } };

/** Open a page and wait until its header (and the part we measure) is drawn in its language. */
async function open(ctx, url, waitFor) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(srv.base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const h = document.querySelector('.site-header');
    if (!h) return true;
    const cart = h.querySelector('.cart-link');
    return (!cart || h.querySelector('[data-account-link]')) && (!h.querySelector('.lang-toggle') || h.querySelector('.lang-toggle').textContent.trim());
  }, null, { timeout: 30000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}

/**
 * In the page: for each visible element matching `sel` (scrolled to the middle of the screen unless it is in the
 * header), its box, how far from its centre a tap still lands on it (tapW x tapH), and whether every point of the
 * 44 x 44 box centred on it (within its 44px circle) lands on it.
 */
function tapAreas(sel) {
  const hits = (el, x, y) => {
    const h = document.elementFromPoint(x, y);
    return Boolean(h) && (h === el || el.contains(h));
  };
  return [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
    if (!el.closest('.site-header')) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 40 && hits(el, cx + dx * (d + 1), cy + dy * (d + 1))) d++;
      return d;
    };
    // Points every 5.25px across the box, its edges included (21px out: the box's pixels are -22..+22), but not its
    // corners: a round 44px button (the header's search) or a chip with round corners is still a 44px target, so
    // the points checked are those within the 44px circle inside the box.
    const misses = [];
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const ox = i * 5.25;
        const oy = j * 5.25;
        if (Math.hypot(ox, oy) > 21.5) continue;
        if (!hits(el, cx + ox, cy + oy)) misses.push([ox, oy]);
      }
    }
    return {
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      cx,
      cy: cy + window.scrollY,
      tapW: reach(-1, 0) + reach(1, 0) + 1,
      tapH: reach(0, -1) + reach(0, 1) + 1,
      misses,
    };
  });
}

/** Every page the shared header is on (an unknown address shows the 404 page). */
const HEADER_PAGES = ['/', '/cart', '/designs', '/design?id=mesh-fady', '/product?id=tshirt', '/book?b=space-hero', '/photos',
  '/account', '/order', '/invoice', '/proof', '/share', '/view', '/rights', '/privacy', '/admin', '/no-such-page'];

/** The targets: page, what to wait for, and the selectors measured there. */
const TARGETS = [
  ['/', '#product-grid .hm-gstart', ['.site-header .acct-link', '.site-header .cart-link', '.site-header .lang-toggle', '.site-header .site-search-btn', '#product-grid .hm-gstart', '#product-grid .hm-gdetails']],
  ['/product?id=tshirt', '#pp-swatches .swatch', ['#pp-swatches .swatch']],
  ['/design?id=mesh-fady', '#dp-sizes .chip', ['#dp-sizes .chip', '#dp-colors .swatch']],
  ['/book?b=space-hero', '#bk-sizes .chip', ['#bk-questions [data-choice="gender"] .chip', '#bk-questions [data-choice]:not(.bk-pics) .chip', '#bk-sizes .chip']],
];

test('phones (Pixel 7 and 360px), Arabic and English: every target can be hit in a 44 x 44 box', { timeout: 240000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const [devName, dev] of [['Pixel 7', PIXEL_7()], ['360px', PHONE_360()]]) {
      const ctx = await context(lang, dev);
      try {
        for (const [url, waitFor, sels] of TARGETS) {
          const page = await open(ctx, url, waitFor);
          for (const sel of sels) {
            const found = await page.evaluate(tapAreas, sel);
            assert.ok(found.length > 0, `${lang} ${devName} ${url}: ${sel} is on the page`);
            for (const f of found) {
              const where = `${lang} ${devName} ${url} ${sel} "${f.label}" (${f.w}x${f.h}, tap ${f.tapW}x${f.tapH})`;
              assert.ok(f.tapW >= 44 && f.tapH >= 44, `${where}: tap area at least 44 x 44`);
              assert.deepStrictEqual(f.misses, [], `${where}: every point of the 44 x 44 box lands on it`);
            }
          }
          if (/swatch/.test(sels.join())) {
            // Neighbouring colour circles: their 44 x 44 areas don't overlap (centres 44px or more apart).
            const sel = sels.find((s) => /swatch/.test(s));
            const c = await page.evaluate(tapAreas, sel);
            for (let i = 1; i < c.length; i++) {
              const sameRow = Math.abs(c[i].cy - c[i - 1].cy) < 1;
              const gap = sameRow ? Math.abs(c[i].cx - c[i - 1].cx) : Math.abs(c[i].cy - c[i - 1].cy);
              assert.ok(gap >= 44, `${lang} ${devName} ${url}: circles ${i - 1} and ${i} are ${gap}px apart, their tap areas overlap`);
            }
          }
          assert.deepStrictEqual(page.errors, [], `${lang} ${devName} ${url}`);
          await page.close();
        }
      } finally {
        await ctx.close();
      }
    }
  }
});

/** The header's height (and its top row's), the page's sideways scroll, and the top row's items on screen. */
const readHeader = () => {
  const h = document.querySelector('.site-header');
  if (!h || getComputedStyle(h).display === 'none') return { none: true, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  const inner = h.querySelector('.inner');
  const items = [...h.querySelectorAll('.inner > nav > *')].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
  const tops = items.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  return {
    height: h.getBoundingClientRect().height,
    inner: inner ? inner.getBoundingClientRect().height : 0,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    offScreen: tops.filter((r) => r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5).length,
    outside: inner ? tops.filter((r) => r.top < inner.getBoundingClientRect().top - 0.5 || r.bottom > inner.getBoundingClientRect().bottom + 0.5).length : 0,
  };
};

test('every page with the shared header: no taller than before, no sideways scroll at 360px (and on small tablets)', { timeout: 300000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const [devName, dev, pages] of [
      ['360px', PHONE_360(), HEADER_PAGES],
      ['Pixel 7', PIXEL_7(), ['/', '/cart', '/product?id=tshirt']],
      ['601px', { viewport: { width: 601, height: 900 } }, ['/', '/cart']],
      ['700px', { viewport: { width: 700, height: 900 } }, ['/', '/cart']],
      ['768px', { viewport: { width: 768, height: 1000 } }, ['/', '/cart']],
      ['820px', { viewport: { width: 820, height: 1000 } }, ['/', '/cart']],
    ]) {
      const now = await context(lang, dev);
      const before = await context(lang, dev, true);
      try {
        for (const url of pages) {
          const where = `${lang} ${devName} ${url}`;
          const p1 = await open(now, url);
          const p0 = await open(before, url);
          const h1 = await p1.evaluate(readHeader);
          const h0 = await p0.evaluate(readHeader);
          assert.ok(h1.scrollW <= h1.clientW, `${where}: no sideways scroll (${h1.scrollW} > ${h1.clientW})`);
          if (!h0.none) {
            assert.strictEqual(h1.height, h0.height, `${where}: the header is as tall as before`);
            assert.strictEqual(h1.inner, h0.inner, `${where}: the header's top row is as tall as before`);
            assert.strictEqual(h1.offScreen, 0, `${where}: the top row's buttons are all on screen`);
            assert.strictEqual(h1.outside, 0, `${where}: the top row's buttons stay inside the row`);
          }
          assert.deepStrictEqual(p1.errors, [], where);
          await p1.close();
          await p0.close();
        }
      } finally {
        await now.close();
        await before.close();
      }
    }
  }
});

test('phones: today\'s header heights (109px with the chips row, 56px top row)', { timeout: 60000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const ctx = await context(lang, PIXEL_7());
    try {
      const page = await open(ctx, '/');
      const h = await page.evaluate(readHeader);
      assert.strictEqual(Math.round(h.inner), 56, lang);
      assert.strictEqual(Math.round(h.height), 109, lang);
    } finally {
      await ctx.close();
    }
  }
});

test('computers (1366px): the header and every target exactly as without the change', { timeout: 180000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const now = await context(lang, DESKTOP);
    const before = await context(lang, DESKTOP, true);
    try {
      for (const [url, waitFor, sels] of TARGETS) {
        const p1 = await open(now, url, waitFor);
        const p0 = await open(before, url, waitFor);
        const h1 = await p1.evaluate(readHeader);
        const h0 = await p0.evaluate(readHeader);
        assert.strictEqual(h1.height, h0.height, `${lang} ${url}: header height`);
        assert.strictEqual(Math.round(h1.height), 61, `${lang} ${url}: today's 61px header`);
        const boxes = (sel) => [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return [r.left, r.top + window.scrollY, r.width, r.height].map((v) => Math.round(v * 10) / 10);
        });
        for (const sel of sels) {
          assert.deepStrictEqual(await p1.evaluate(boxes, sel), await p0.evaluate(boxes, sel), `${lang} ${url} ${sel}: same place and size`);
        }
        await p1.close();
        await p0.close();
      }
    } finally {
      await now.close();
      await before.close();
    }
  }
});
