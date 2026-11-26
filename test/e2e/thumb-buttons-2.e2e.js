'use strict';

// Thumb-size buttons, step 2 (owner's go 26 Nov): on phones (820px and less) the home page's category chips, the
// section chips under the site header (600px and less) and the editor's own colour circles (its product sheet)
// can each be hit in a 44 x 44 px box (checked point by point with document.elementFromPoint, as in step 1, so an
// invisible hit area counts), neighbouring colour circles' areas don't overlap, the header grows only 2 px (the
// chips' 4 px less the 2 px above them) on the pages with the chips row and not at all elsewhere, stays sticky with
// nothing overlapping, the editor's own top bar is untouched, and no page scrolls sideways at 360px.
// Computers (1366px) look exactly as without the change.
//
// "Without the change" is the same page with the "Thumb-size buttons, step 2" section cut out of styles.css.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

const SECTION_START = '/* ==========================================================================\n   Thumb-size buttons, step 2';
const SECTION_END = '/* (end of Thumb-size buttons, step 2) */';

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

/** A context in `lang`; `without` serves styles.css without the step 2 section (the look before it). */
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
      assert.ok(a > 0 && b > a, 'the step 2 section is marked in styles.css');
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
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.errors = errors;
  await page.goto(srv.base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const h = document.querySelector('.site-header');
    if (!h) return true;
    const cart = h.querySelector('.cart-link');
    const chip = h.querySelector('.nav-chips a');
    return (!cart || h.querySelector('[data-account-link]')) && (!h.querySelector('.lang-toggle') || h.querySelector('.lang-toggle').textContent.trim())
      && (!chip || chip.textContent.trim());
  }, null, { timeout: 30000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}

/** The editor on a phone with its product sheet open (the colour circles showing). */
async function openEditorSheet(ctx) {
  const page = await open(ctx, '/editor?product=tshirt');
  await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.click('#ed-prod');
  await page.waitForSelector('#swatches .swatch', { state: 'visible' });
  await page.waitForTimeout(400);
  return page;
}

/**
 * In the page: for each visible element matching `sel`, brought into view (a header chip is swiped into the middle
 * of its row; anything else is scrolled to the middle of the screen), its box, how far from its centre a tap still
 * lands on it (tapW x tapH), and whether every point of the 44 x 44 box centred on it (within its 44px circle, as
 * in step 1) lands on it.
 */
function tapAreas(sel) {
  const hits = (el, x, y) => {
    const h = document.elementFromPoint(x, y);
    return Boolean(h) && (h === el || el.contains(h));
  };
  return [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
    if (el.closest('.site-header')) el.scrollIntoView({ block: 'nearest', inline: 'center' });
    else el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 40 && hits(el, cx + dx * (d + 1), cy + dy * (d + 1))) d++;
      return d;
    };
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
      cx: cx + window.scrollX,
      cy: cy + window.scrollY,
      tapW: reach(-1, 0) + reach(1, 0) + 1,
      tapH: reach(0, -1) + reach(0, 1) + 1,
      misses,
    };
  });
}

function assertTargets(found, where) {
  assert.ok(found.length > 0, `${where}: on the page`);
  for (const f of found) {
    const w = `${where} "${f.label}" (${f.w}x${f.h}, tap ${f.tapW}x${f.tapH})`;
    assert.ok(f.tapW >= 44 && f.tapH >= 44, `${w}: tap area at least 44 x 44`);
    assert.deepStrictEqual(f.misses, [], `${w}: every point of the 44 x 44 box lands on it`);
  }
}

test('phones (Pixel 7 and 360px), Arabic and English: category chips, header chips and the editor\'s colour circles can be hit in a 44 x 44 box', { timeout: 240000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const [devName, dev] of [['Pixel 7', PIXEL_7()], ['360px', PHONE_360()]]) {
      const ctx = await context(lang, dev);
      try {
        const where = `${lang} ${devName}`;
        const home = await open(ctx, '/', '#cats .chip');
        // Home page: the category chips, 44 px tall, the first one on the page's start side (right in Arabic).
        const cats = await home.evaluate(tapAreas, '#cats .chip');
        assertTargets(cats, `${where} / #cats .chip`);
        assert.ok(cats.length >= 6, `${where}: the categories are all there (${cats.length})`);
        for (const c of cats) assert.ok(c.h >= 44 && c.w >= 48, `${where} "${c.label}": 44 px tall, 48 wide (${c.w}x${c.h})`);
        const side = await home.evaluate(() => {
          const row = document.getElementById('cats').getBoundingClientRect();
          const first = document.querySelector('#cats .chip').getBoundingClientRect();
          return { start: first.left - row.left, end: row.right - first.right };
        });
        assert.ok(lang === 'ar' ? Math.abs(side.end) <= 1 : Math.abs(side.start) <= 1, `${where}: "All" on the start side (${JSON.stringify(side)})`);
        // The section chips under the header (every one, swiped into view).
        const chips = await home.evaluate(tapAreas, '.site-header .nav-chips a');
        assertTargets(chips, `${where} / header chips`);
        assert.strictEqual(chips.length, 6, `${where}: six chips`);
        for (const c of chips) assert.ok(c.h >= 44, `${where} "${c.label}": 44 px tall (${c.h})`);
        assert.ok(await home.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${where} /: no sideways scroll`);
        assert.deepStrictEqual(home.errors, [], `${where} /`);
        await home.close();

        // The editor's product sheet: the colour circles, neighbours' areas apart, a sold-out circle too.
        const ed = await openEditorSheet(ctx);
        const sw = await ed.evaluate(tapAreas, '#swatches .swatch');
        assertTargets(sw, `${where} editor #swatches`);
        assert.ok(sw.length >= 2, `${where}: the T-shirt has colours`);
        for (let i = 1; i < sw.length; i++) {
          const sameRow = Math.abs(sw[i].cy - sw[i - 1].cy) < 1;
          const gap = sameRow ? Math.abs(sw[i].cx - sw[i - 1].cx) : Math.abs(sw[i].cy - sw[i - 1].cy);
          assert.ok(gap >= 44, `${where} editor: circles ${i - 1} and ${i} are ${gap}px apart, their tap areas overlap`);
        }
        // (A sold-out circle: marked here as the editor marks it; it keeps its stroke and its 44 x 44 area.)
        await ed.evaluate(() => document.querySelector('#swatches .swatch:nth-child(2)').classList.add('sold-out'));
        const sold = await ed.evaluate(tapAreas, '#swatches .swatch.sold-out');
        assertTargets(sold, `${where} editor sold-out circle`);
        assert.notStrictEqual(await ed.evaluate(() => getComputedStyle(document.querySelector('#swatches .swatch.sold-out'), '::before').backgroundImage), 'none', `${where}: the sold-out stroke still shows`);
        assert.ok(await ed.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${where} editor: no sideways scroll`);
        assert.deepStrictEqual(ed.errors, [], `${where} editor`);
        await ed.close();
      } finally {
        await ctx.close();
      }
    }
  }
});

/** Every page the shared header is on (an unknown address shows the 404 page). */
const HEADER_PAGES = ['/', '/cart', '/designs', '/design?id=mesh-fady', '/product?id=tshirt', '/book?b=space-hero', '/photos',
  '/account', '/order', '/invoice', '/proof', '/share', '/view', '/rights', '/privacy', '/admin', '/no-such-page'];

/** The header: its height, its top row's, the chips row's, whether the top row's items stay above the chips, and the page's width. */
const readHeader = () => {
  const h = document.querySelector('.site-header');
  const doc = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  if (!h || getComputedStyle(h).display === 'none') return { none: true, ...doc };
  const inner = h.querySelector('.inner');
  const row = h.querySelector('.nav-chips');
  const rowShown = Boolean(row) && getComputedStyle(row).display !== 'none';
  const top = [...h.querySelectorAll('.inner > nav > *, .inner > .brand')].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
  const lowest = Math.max(...top.map((el) => el.getBoundingClientRect().bottom));
  const chips = rowShown ? [...row.querySelectorAll('a')].map((a) => a.getBoundingClientRect()) : [];
  const hr = h.getBoundingClientRect();
  return {
    ...doc,
    position: getComputedStyle(h).position,
    height: hr.height,
    inner: inner ? inner.getBoundingClientRect().height : 0,
    rowShown,
    // The top row's buttons end above the chips (no overlap), the chips end inside the header.
    clear: rowShown ? Math.min(...chips.map((c) => c.top)) - lowest : null,
    inside: rowShown ? chips.every((c) => c.bottom <= hr.bottom + 0.5) : true,
  };
};

test('every page with the shared header (360px, Pixel 7): 2 px taller with the chips row, otherwise as before; sticky, nothing overlapping, no sideways scroll', { timeout: 300000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const [devName, dev, pages] of [['360px', PHONE_360(), HEADER_PAGES], ['Pixel 7', PIXEL_7(), ['/', '/cart', '/product?id=tshirt', '/designs', '/admin']]]) {
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
          assert.strictEqual(Boolean(h1.none), Boolean(h0.none), where);
          if (!h1.none) {
            assert.strictEqual(h1.inner, h0.inner, `${where}: the header's top row is as tall as before`);
            assert.strictEqual(h1.height - h0.height, h1.rowShown ? 2 : 0, `${where}: header ${h0.height} -> ${h1.height}`);
            assert.strictEqual(h1.position, 'sticky', `${where}: the header stays sticky`);
            if (h1.rowShown) {
              assert.ok(h1.clear >= 0, `${where}: the top row's buttons end above the chips (${h1.clear}px apart)`);
              assert.ok(h1.inside, `${where}: the chips end inside the header`);
              // Scrolled down: the header is still at the top and its chips are still what a tap hits.
              const stuck = await p1.evaluate(() => {
                window.scrollTo(0, 600);
                const h = document.querySelector('.site-header');
                // (A chip on screen: the row may be swiped to the page's own chip, T-shirts on the T-shirt's page.)
                const a = [...h.querySelectorAll('.nav-chips a')].find((x) => {
                  const b = x.getBoundingClientRect();
                  return b.left >= 0 && b.right <= document.documentElement.clientWidth;
                });
                const r = a.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { top: h.getBoundingClientRect().top, scrolled: window.scrollY > 0, hit: Boolean(hit) && (hit === a || a.contains(hit)) };
              });
              if (stuck.scrolled) assert.deepStrictEqual({ top: stuck.top, hit: stuck.hit }, { top: 0, hit: true }, `${where}: sticky, chips on top when scrolled`);
            }
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

test('phones: today\'s header heights (111px with the chips row, 56px top row); the editor keeps its own top bar', { timeout: 120000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const dev of [PIXEL_7(), PHONE_360()]) {
      const ctx = await context(lang, dev);
      const before = await context(lang, dev, true);
      try {
        const page = await open(ctx, '/');
        const h = await page.evaluate(readHeader);
        assert.strictEqual(Math.round(h.inner), 56, lang);
        assert.strictEqual(Math.round(h.height), 111, lang);
        // The editor on a phone shows its own 56 px bar, not the site header, with or without the change.
        const bar = (p) => p.evaluate(() => ({
          header: getComputedStyle(document.querySelector('.site-header')).display,
          top: document.getElementById('ed-top').getBoundingClientRect().height,
        }));
        const e1 = await open(ctx, '/editor?product=tshirt', '#ed-top');
        const e0 = await open(before, '/editor?product=tshirt', '#ed-top');
        assert.deepStrictEqual(await bar(e1), { header: 'none', top: 56 }, `${lang} editor`);
        assert.deepStrictEqual(await bar(e1), await bar(e0), `${lang} editor: as before`);
      } finally {
        await ctx.close();
        await before.close();
      }
    }
  }
});

test('small tablets (601px to 820px): the header exactly as before (no chips row there)', { timeout: 120000 }, async () => {
  for (const lang of ['ar', 'en']) {
    for (const w of [601, 700, 820]) {
      const dev = { viewport: { width: w, height: 1000 } };
      const now = await context(lang, dev);
      const before = await context(lang, dev, true);
      try {
        const p1 = await open(now, '/', '#cats .chip');
        const p0 = await open(before, '/', '#cats .chip');
        const h1 = await p1.evaluate(readHeader);
        assert.deepStrictEqual(h1, await p0.evaluate(readHeader), `${lang} ${w}px`);
        assert.ok(h1.scrollW <= h1.clientW, `${lang} ${w}px: no sideways scroll`);
        assertTargets(await p1.evaluate(tapAreas, '#cats .chip'), `${lang} ${w}px #cats .chip`);
      } finally {
        await now.close();
        await before.close();
      }
    }
  }
});

test('computers (1366px): the header, the category chips and the editor\'s colour circles exactly as without the change', { timeout: 180000 }, async () => {
  const boxes = (sel) => [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    const b = getComputedStyle(el, '::before');
    return [r.left, r.top + window.scrollY, r.width, r.height].map((v) => Math.round(v * 10) / 10).concat([b.content, b.inset]);
  });
  for (const lang of ['ar', 'en']) {
    const now = await context(lang, DESKTOP);
    const before = await context(lang, DESKTOP, true);
    try {
      for (const [url, waitFor, sels] of [
        ['/', '#cats .chip', ['.site-header', '.site-header .inner > nav > *', '#cats .chip', '#product-grid > *']],
        ['/editor?product=tshirt', '#swatches .swatch', ['.site-header', '#swatches .swatch', '#sizes .chip']],
      ]) {
        const p1 = await open(now, url, waitFor);
        const p0 = await open(before, url, waitFor);
        await p1.waitForTimeout(300);
        await p0.waitForTimeout(300);
        const h1 = await p1.evaluate(readHeader);
        assert.strictEqual(h1.height, (await p0.evaluate(readHeader)).height, `${lang} ${url}: header height`);
        if (url === '/') assert.strictEqual(Math.round(h1.height), 61, `${lang} ${url}: today's 61px header`);
        for (const sel of sels) {
          assert.deepStrictEqual(await p1.evaluate(boxes, sel), await p0.evaluate(boxes, sel), `${lang} ${url} ${sel}: same place and size`);
        }
        assert.deepStrictEqual(p1.errors, [], `${lang} ${url}`);
        await p1.close();
        await p0.close();
      }
    } finally {
      await now.close();
      await before.close();
    }
  }
});
