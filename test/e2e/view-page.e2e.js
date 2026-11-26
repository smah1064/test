'use strict';

// The view-only page (/view?id=…, owner's decision 26 Nov): a booklet or a product's sides sent by WhatsApp or email
// for someone to look at. Its API (/api/views/<id>) is mocked here with page pictures made on the spot.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

const COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#0c8599', '#5c940d', '#495057', '#e8590c'];
/** A page picture: its own colour and its number in big type. */
async function picture(n, w, h) {
  const sharp = require('sharp');
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${COLORS[n % COLORS.length]}"/>`
    + `<rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.84}" height="${h * 0.84}" fill="none" stroke="#fff" stroke-width="6"/>`
    + `<text x="${w / 2}" y="${h * 0.6}" font-size="${Math.round(h * 0.3)}" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">${n + 1}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
}

const PAGE_W = 600;
const PAGE_H = 848;
function bookletView(id, rtl, n = 8) {
  return {
    id,
    productId: 'booklet',
    productName: { en: 'Booklet A5', ar: 'كتيّب A5' },
    kind: 'pages',
    rtl,
    pages: Array.from({ length: n }, (_, i) => ({ name: { en: `Page ${i + 1}`, ar: `صفحة ${i + 1}` }, url: `/api/views/${id}/page/${i}.jpg?v=3`, w: PAGE_W, h: PAGE_H })),
    updatedAt: '2026-11-26T10:00:00.000Z',
    makeOwn: '/product?id=booklet',
  };
}
const VIEWS = {
  bookltr: bookletView('bookltr', false),
  bookrtl: bookletView('bookrtl', true),
  card: {
    id: 'card',
    productId: 'bizcard',
    productName: { en: 'Business cards', ar: 'كروت بيزنس' },
    kind: 'sides',
    rtl: false,
    pages: [
      { name: { en: 'Front', ar: 'الوش' }, url: '/api/views/card/page/0.jpg?v=1', w: 1000, h: 700 },
      { name: { en: 'Back', ar: 'الضهر' }, url: '/api/views/card/page/1.jpg?v=1', w: 1000, h: 700 },
    ],
    updatedAt: '2026-11-26T10:00:00.000Z',
    makeOwn: '/product?id=bizcard',
  },
};

let srv;
let browser;
const pictures = new Map();
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/**
 * A browser with the page's language set and /api/views mocked. `log` collects the page pictures asked for, in
 * order ("bookltr/3"); `delay` holds each picture back that long.
 */
async function open(id, { lang = 'en', viewport = { width: 412, height: 915 }, reduce = true, delay = 0, isMobile = false } = {}) {
  // (No app worker: page.route can't see what the worker fetches.)
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: reduce ? 'reduce' : 'no-preference', isMobile, hasTouch: isMobile });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const log = [];
  await ctx.route('**/api/views/**', async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/^\/api\/views\/([^/]+)(?:\/page\/(\d+)\.jpg)?$/);
    if (!m) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'viewNotFound', error: 'Not found' }) });
    const [, vid, n] = m;
    if (n !== undefined) {
      const v = VIEWS[vid];
      const p = v && v.pages[Number(n)];
      if (!p) return route.fulfill({ status: 404, body: '' });
      log.push(`${vid}/${n}`);
      const key = `${n}:${p.w}x${p.h}`;
      if (!pictures.has(key)) pictures.set(key, await picture(Number(n), p.w, p.h));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: pictures.get(key) });
    }
    if (vid === 'expired') return route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ code: 'viewExpired', error: 'This link has expired.' }) });
    if (!VIEWS[vid]) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'viewNotFound', error: 'Not found.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VIEWS[vid]) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  page.log = log;
  page.ctx = ctx;
  await page.goto(`${srv.base}/view${id === null ? '' : `?id=${encodeURIComponent(id)}`}`);
  return page;
}
const ready = (page) => page.waitForSelector('#vw-body:not([hidden]) .vw-img');
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const count = (page) => text(page, '#vw-count');
/** The page number(s) of the picture(s) on screen, from their addresses: [3] or, on a computer, { left, right }. */
const shown = (page) => page.evaluate(() => {
  const num = (img) => (img ? Number(img.getAttribute('src').match(/\/page\/(\d+)\.jpg/)[1]) : null);
  const frame = document.querySelector('#vw-view > .vw-frame');
  if (frame) return num(frame.querySelector('img'));
  return { left: num(document.querySelector('.vw-left img')), right: num(document.querySelector('.vw-right img')) };
});
async function waitCount(page, want) {
  await page.waitForFunction((w) => document.querySelector('#vw-count').textContent.trim() === w, want, { timeout: 5000 }).catch(() => {});
  assert.strictEqual(await count(page), want);
}
/** Drag across the picture (a swipe), dx pixels sideways. */
async function swipe(page, dx) {
  const r = await page.$eval('#vw-stage', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(r.x - dx / 2, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x, r.y + 4, { steps: 3 });
  await page.mouse.move(r.x + dx / 2, r.y + 6, { steps: 3 });
  await page.mouse.up();
}
/** A finger swipe (real touch events, so the page's touch-action rules apply), dx pixels sideways. */
async function fingerSwipe(page, dx) {
  const r = await page.$eval('#vw-stage', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const cdp = await page.context().newCDPSession(page);
  const at = (f) => [{ x: r.x - dx / 2 + dx * f, y: r.y + 3 * f }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (const f of [0.25, 0.5, 0.75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(f) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const box = (page, sel) => page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; });
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
/** Nothing about money or the customer on the page. */
async function noShopBits(page) {
  const all = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(all, /ج\.م|EGP|جنيه|price|السعر/i, 'no price');
  for (const sel of ['.cart-link', '[data-cart-count]', '#vote-up', '.acct-link', '.nav-chips', '[data-site-search]']) {
    assert.strictEqual(await page.$(sel), null, `no ${sel}`);
  }
}

test('a booklet on a phone (English, left-bound): next and back, arrows, swipe, thumbnails, "Page 3 of 8", Make your own at the end', { timeout: 60000 }, async () => {
  const page = await open('bookltr', { lang: 'en', viewport: { width: 412, height: 915 } });
  try {
    await ready(page);
    assert.strictEqual(await text(page, '#vw-name'), 'Booklet A5');
    assert.strictEqual(await page.$eval('#vw-title bdi', (e) => e.id), 'vw-name', 'the name in <bdi>');
    assert.strictEqual(await text(page, '.vw-sub'), 'Shared to view only');
    assert.match(await page.title(), /^Booklet A5 · ebda3$/);
    await waitCount(page, 'Page 1 of 8');
    assert.strictEqual(await shown(page), 0);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'Page 1');
    assert.strictEqual(await page.isDisabled('#vw-prev'), true);
    assert.strictEqual(await page.$eval('#vw-count', (e) => e.getAttribute('aria-live')), 'polite');
    assert.strictEqual(await page.$eval('#vw-prev', (e) => e.getAttribute('aria-label')), 'Previous page');
    assert.strictEqual(await page.$eval('#vw-next', (e) => e.getAttribute('aria-label')), 'Next page');
    // Left-bound: next is on the right; both are big enough to tap.
    const prev = await box(page, '#vw-prev');
    const next = await box(page, '#vw-next');
    assert.ok(next.x > prev.x, 'next on the right');
    assert.ok(prev.w >= 44 && prev.h >= 44 && next.w >= 44 && next.h >= 44, 'tap targets');
    // Only the page on screen and the next one are asked for first.
    await page.waitForFunction(() => [...document.querySelectorAll('#vw-thumbs img')].every((i) => i.complete && i.getAttribute('src')));
    assert.deepStrictEqual(page.log.slice(0, 2), ['bookltr/0', 'bookltr/1']);
    assert.strictEqual(new Set(page.log).size, page.log.length, 'each picture asked for once');

    await page.click('#vw-next');
    await waitCount(page, 'Page 2 of 8');
    assert.strictEqual(await shown(page), 1);
    await page.keyboard.press('ArrowRight');
    await waitCount(page, 'Page 3 of 8');
    assert.strictEqual(await shown(page), 2);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'Page 3');
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'Page 2 of 8');
    // Dragging the page to the left shows the next one.
    await swipe(page, -180);
    await waitCount(page, 'Page 3 of 8');
    await swipe(page, 180);
    await waitCount(page, 'Page 2 of 8');
    assert.strictEqual(await shown(page), 1);
    // A small up-and-down drag is a scroll, not a page turn.
    await swipe(page, 20);
    assert.strictEqual(await count(page), 'Page 2 of 8');

    // Thumbnails: every page, the one on screen marked; jump to the last one.
    assert.strictEqual(await page.$$eval('#vw-thumbs .vw-thumb', (b) => b.length), 8);
    assert.deepStrictEqual(await page.$$eval('#vw-thumbs .vw-thumb.active', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Page 2']);
    assert.strictEqual(await page.isVisible('#vw-end'), false, 'Make your own waits for the end');
    await page.click('#vw-thumbs .vw-thumb:last-child');
    await waitCount(page, 'Page 8 of 8');
    assert.strictEqual(await shown(page), 7);
    assert.strictEqual(await page.isDisabled('#vw-next'), true);
    assert.strictEqual(await page.isVisible('#vw-end'), true);
    assert.strictEqual(await text(page, '#vw-end-title'), 'That\'s the last page');
    assert.strictEqual(await page.$eval('#vw-make', (a) => a.getAttribute('href')), '/product?id=booklet');
    assert.strictEqual(await text(page, '#vw-make'), 'Make your own on ebda3');
    // And in the footer all along.
    assert.strictEqual(await page.isVisible('#vw-make-foot'), true);
    assert.strictEqual(await page.$eval('#vw-make-foot', (a) => a.getAttribute('href')), '/product?id=booklet');
    // Only the logo, the language button and Make your own lead anywhere.
    const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    assert.deepStrictEqual([...new Set(links.filter((h) => !/^\/(privacy|rights)$/.test(h)))].sort(), ['/', '/product?id=booklet']);
    assert.ok(await noSideways(page), 'no sideways scroll');
    await noShopBits(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }
});

test('an Arabic booklet (bound on the right) on a 360 px phone: next is on the left, Arabic digits, the language switch keeps the pictures', { timeout: 60000 }, async () => {
  const page = await open('bookrtl', { lang: 'ar', viewport: { width: 360, height: 740 }, isMobile: true });
  try {
    await ready(page);
    assert.deepStrictEqual(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]), ['ar', 'rtl']);
    assert.strictEqual(await text(page, '#vw-name'), 'كتيّب A5');
    assert.strictEqual(await text(page, '.vw-sub'), 'متشارك للمشاهدة بس');
    await waitCount(page, 'صفحة ١ من ٨');
    const prev = await box(page, '#vw-prev');
    const next = await box(page, '#vw-next');
    assert.ok(next.x < prev.x, 'next on the left');
    assert.strictEqual(await page.$eval('#vw-next', (e) => e.getAttribute('aria-label')), 'الصفحة اللي بعد');
    // The left arrow key, and dragging the page to the right, go forward.
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'صفحة ٢ من ٨');
    await swipe(page, 160);
    await waitCount(page, 'صفحة ٣ من ٨');
    assert.strictEqual(await shown(page), 2);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'صفحة ٣');
    await page.click('#vw-next');
    await waitCount(page, 'صفحة ٤ من ٨');
    await page.keyboard.press('ArrowRight');
    await waitCount(page, 'صفحة ٣ من ٨');
    await page.click('#vw-prev');
    await waitCount(page, 'صفحة ٢ من ٨');
    // A finger: to the right goes forward, to the left back.
    await fingerSwipe(page, 150);
    await waitCount(page, 'صفحة ٣ من ٨');
    await fingerSwipe(page, -150);
    await waitCount(page, 'صفحة ٢ من ٨');
    await page.click('#vw-next');
    await waitCount(page, 'صفحة ٣ من ٨');
    // The thumbnails read the same way: page 1 on the right.
    await page.waitForFunction(() => [...document.querySelectorAll('#vw-thumbs img')].every((i) => i.getAttribute('src')));
    const [t1, t2] = await page.$$eval('#vw-thumbs .vw-thumb', (bs) => bs.slice(0, 2).map((b) => b.getBoundingClientRect().left));
    assert.ok(t1 > t2, 'page 1 to the right of page 2');
    assert.strictEqual(await page.$eval('#vw-thumbs .vw-thumb:nth-child(3) .vw-thumb-n', (e) => e.textContent), '٣');
    // The picture fits the screen and keeps its shape.
    const f = await box(page, '.vw-frame');
    assert.ok(f.x >= 0 && f.right <= 360, `inside the screen (${f.x}–${f.right})`);
    assert.ok(Math.abs(f.w / f.h - PAGE_W / PAGE_H) < 0.01, 'its own shape');
    assert.ok(await noSideways(page), 'no sideways scroll at 360 px');

    // English: the texts change, the picture on screen stays (nothing asked for again).
    await page.evaluate(() => { document.querySelector('.vw-frame img').dataset.mark = 'same'; });
    const asked = page.log.length;
    await page.click('[data-lang-toggle]');
    await waitCount(page, 'Page 3 of 8');
    assert.deepStrictEqual(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]), ['en', 'ltr']);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.dataset.mark), 'same', 'the same picture');
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'Page 3');
    assert.strictEqual(await text(page, '#vw-name'), 'Booklet A5');
    assert.strictEqual(await text(page, '.vw-sub'), 'Shared to view only');
    assert.strictEqual(await page.title(), 'Booklet A5 · ebda3');
    assert.strictEqual(page.log.length, asked, 'no picture loaded again');
    // The booklet still turns the way it is bound.
    assert.ok((await box(page, '#vw-next')).x < (await box(page, '#vw-prev')).x, 'next still on the left');
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'Page 4 of 8');
    assert.ok(await noSideways(page));
    await noShopBits(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }
});

test('a booklet on a computer: the cover alone, then two pages side by side, then the back cover alone (both bindings)', { timeout: 90000 }, async () => {
  // Left-bound, English, 1366 px.
  let page = await open('bookltr', { lang: 'en', viewport: { width: 1366, height: 768 } });
  try {
    await ready(page);
    await waitCount(page, 'Page 1 of 8');
    assert.deepStrictEqual(await shown(page), { left: null, right: 0 }, 'the cover alone, on the right of the spine');
    assert.strictEqual(await page.$eval('.vw-book', (b) => b.dataset.shift), 'right', 'moved to the middle');
    // Only the cover and the first spread first.
    await page.waitForFunction(() => [...document.querySelectorAll('#vw-thumbs img')].every((i) => i.complete && i.getAttribute('src')));
    assert.deepStrictEqual(page.log.slice(0, 3), ['bookltr/0', 'bookltr/1', 'bookltr/2']);
    await page.click('#vw-next');
    await waitCount(page, 'Pages 2–3 of 8');
    assert.deepStrictEqual(await shown(page), { left: 1, right: 2 });
    assert.strictEqual(await page.$eval('.vw-book', (b) => b.dataset.shift), '');
    assert.deepStrictEqual(await page.$$eval('#vw-thumbs .vw-thumb.active', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Page 2', 'Page 3']);
    // The two pages side by side fill the space, each in its shape.
    const l = await box(page, '.vw-left .vw-paper');
    const r = await box(page, '.vw-right .vw-paper');
    assert.ok(Math.abs(l.right - r.x) < 1.5 && Math.abs(l.w - r.w) < 1 && Math.abs(l.w / l.h - PAGE_W / PAGE_H) < 0.01, 'two pages round the spine');
    assert.ok(l.w * 2 > 500, `big enough (${Math.round(l.w * 2)} px wide)`);
    assert.ok(r.bottom <= 768, 'the whole spread on the screen');
    await page.keyboard.press('ArrowRight');
    await waitCount(page, 'Pages 4–5 of 8');
    await page.click('#vw-next');
    await waitCount(page, 'Pages 6–7 of 8');
    assert.strictEqual(await page.isVisible('#vw-end'), false);
    await page.click('#vw-next');
    await waitCount(page, 'Page 8 of 8');
    assert.deepStrictEqual(await shown(page), { left: 7, right: null }, 'the back cover, on the left');
    // "Make your own" in the other half, in sight.
    assert.strictEqual(await page.isVisible('#vw-end'), true);
    assert.strictEqual(await page.$eval('#vw-end', (e) => e.parentElement.classList.contains('vw-right')), true, 'beside the back cover');
    assert.strictEqual(await page.$eval('.vw-book', (b) => b.dataset.shift), '', 'the booklet stays open');
    const end = await box(page, '#vw-end');
    const back = await box(page, '.vw-left .vw-paper');
    assert.ok(end.x >= back.right && end.bottom <= 768, 'beside it, on the screen');
    assert.strictEqual(await text(page, '#vw-end-title'), 'That\'s the last page');
    // A click on a page turns it towards its side: the back cover (left) goes back.
    await page.click('.vw-left .vw-paper');
    await waitCount(page, 'Pages 6–7 of 8');
    assert.strictEqual(await page.isVisible('#vw-end'), false);
    assert.strictEqual(await page.$eval('#vw-end', (e) => e.parentElement.id), 'vw-body', 'back under the buttons');
    await page.click('.vw-right .vw-paper');
    await waitCount(page, 'Page 8 of 8');
    // A thumbnail jumps to its spread.
    await page.click('#vw-thumbs .vw-thumb:nth-child(4)');
    await waitCount(page, 'Pages 4–5 of 8');
    assert.ok(await noSideways(page));
    await noShopBits(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }

  // Bound on the right, Arabic: the cover to the left of the spine, then page 2 on the right.
  page = await open('bookrtl', { lang: 'ar', viewport: { width: 1366, height: 768 } });
  try {
    await ready(page);
    await waitCount(page, 'صفحة ١ من ٨');
    assert.deepStrictEqual(await shown(page), { left: 0, right: null });
    assert.strictEqual(await page.$eval('.vw-book', (b) => b.dataset.shift), 'left');
    await page.click('#vw-next');
    await waitCount(page, 'صفحات ٢–٣ من ٨');
    assert.deepStrictEqual(await shown(page), { left: 2, right: 1 }, 'the right-hand page first');
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'صفحات ٤–٥ من ٨');
    assert.deepStrictEqual(await shown(page), { left: 4, right: 3 });
    // The left page goes forward in an Arabic booklet.
    await page.click('.vw-left .vw-paper');
    await waitCount(page, 'صفحات ٦–٧ من ٨');
    await page.click('#vw-next');
    await waitCount(page, 'صفحة ٨ من ٨');
    assert.deepStrictEqual(await shown(page), { left: null, right: 7 }, 'the back cover on the right');
    assert.strictEqual(await page.$eval('#vw-end', (e) => e.parentElement.classList.contains('vw-left')), true, 'Make your own on the left');
    assert.strictEqual(await text(page, '#vw-make'), 'اعمل تصميمك على إبداع');
    // Narrower than 900 px: one page at a time, the same place in the booklet.
    await page.click('#vw-prev');
    await waitCount(page, 'صفحات ٦–٧ من ٨');
    await page.setViewportSize({ width: 600, height: 900 });
    await waitCount(page, 'صفحة ٦ من ٨');
    await page.waitForSelector('#vw-view > .vw-frame');
    assert.strictEqual(await shown(page), 5);
    await page.click('#vw-thumbs .vw-thumb:last-child');
    await waitCount(page, 'صفحة ٨ من ٨');
    assert.strictEqual(await page.$eval('#vw-end', (e) => e.parentElement.id), 'vw-body', 'under the buttons on a phone');
    assert.strictEqual(await page.isVisible('#vw-end'), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('.vw-book .vw-left #vw-end', { timeout: 5000 });
    await waitCount(page, 'صفحة ٨ من ٨');
    await page.click('#vw-prev');
    await waitCount(page, 'صفحات ٦–٧ من ٨');
    await page.setViewportSize({ width: 600, height: 900 });
    await waitCount(page, 'صفحة ٦ من ٨');
    await page.setViewportSize({ width: 1280, height: 800 });
    await waitCount(page, 'صفحات ٦–٧ من ٨');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }

  // With the page turning (no reduced motion): the turned page lands where it should.
  page = await open('bookltr', { lang: 'en', viewport: { width: 1366, height: 768 }, reduce: false });
  try {
    await ready(page);
    await page.click('#vw-next');
    assert.strictEqual(await count(page), 'Pages 2–3 of 8', 'the page number at once');
    assert.ok(await page.$('.vw-leaf'), 'a page turning');
    await page.waitForFunction(() => !document.querySelector('.vw-leaf'), null, { timeout: 3000 });
    assert.deepStrictEqual(await shown(page), { left: 1, right: 2 });
    // Two clicks in a row: two pages turned.
    await page.click('#vw-next');
    await page.click('#vw-next');
    await page.waitForFunction(() => !document.querySelector('.vw-leaf'), null, { timeout: 3000 });
    assert.strictEqual(await count(page), 'Pages 6–7 of 8');
    assert.deepStrictEqual(await shown(page), { left: 5, right: 6 });
    await page.click('#vw-prev');
    await page.waitForFunction(() => !document.querySelector('.vw-leaf'), null, { timeout: 3000 });
    assert.deepStrictEqual(await shown(page), { left: 3, right: 4 });
    // To the back cover and back: "Make your own" shows beside it, then goes.
    await page.click('#vw-next');
    await page.click('#vw-next');
    await page.waitForFunction(() => !document.querySelector('.vw-leaf'), null, { timeout: 3000 });
    assert.deepStrictEqual(await shown(page), { left: 7, right: null });
    assert.strictEqual(await page.isVisible('.vw-right #vw-end'), true);
    await page.click('#vw-prev');
    assert.ok(await page.isVisible('.vw-right #vw-end'), 'still there while the page turns over it');
    await page.waitForFunction(() => !document.querySelector('.vw-leaf'), null, { timeout: 3000 });
    assert.deepStrictEqual(await shown(page), { left: 5, right: 6 });
    assert.strictEqual(await page.isVisible('#vw-end'), false);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }
});

test('a two-sided product: Front / Back tabs, arrows and swipe, one big picture', { timeout: 60000 }, async () => {
  let page = await open('card', { lang: 'en', viewport: { width: 1366, height: 768 } });
  try {
    await ready(page);
    assert.strictEqual(await text(page, '#vw-name'), 'Business cards');
    assert.deepStrictEqual(await page.$$eval('#vw-tabs [role="tab"]', (b) => b.map((x) => [x.textContent, x.getAttribute('aria-selected')])), [['Front', 'true'], ['Back', 'false']]);
    assert.strictEqual(await shown(page), 0);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'Front');
    assert.strictEqual(await page.isVisible('#vw-thumbs'), false, 'no page thumbnails');
    const f = await box(page, '.vw-frame');
    assert.ok(Math.abs(f.w / f.h - 1000 / 700) < 0.01, 'its own shape');
    assert.ok(f.bottom <= 768 && f.w > 500, 'big, and on the screen');
    await page.click('#vw-tabs [role="tab"]:nth-child(2)');
    await waitCount(page, 'Back (2 of 2)');
    assert.strictEqual(await shown(page), 1);
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'Back');
    assert.strictEqual(await page.$eval('#vw-stage', (s) => s.getAttribute('aria-labelledby')), 'vw-tab-1');
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'Front (1 of 2)');
    await swipe(page, -200);
    await waitCount(page, 'Back (2 of 2)');
    assert.strictEqual(await page.isVisible('#vw-end'), true, 'Make your own under the sides');
    assert.strictEqual(await page.isVisible('#vw-end-title'), false, 'no "last page" for sides');
    assert.strictEqual(await page.$eval('#vw-make', (a) => a.getAttribute('href')), '/product?id=bizcard');
    await noShopBits(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }

  // Arabic phone: the first tab on the right, and the left arrow goes to the next side.
  page = await open('card', { lang: 'ar', viewport: { width: 360, height: 740 }, isMobile: true });
  try {
    await ready(page);
    const tabs = await page.$$eval('#vw-tabs [role="tab"]', (b) => b.map((x) => ({ t: x.textContent, x: x.getBoundingClientRect().left, h: x.getBoundingClientRect().height })));
    assert.deepStrictEqual(tabs.map((x) => x.t), ['الوش', 'الضهر']);
    assert.ok(tabs[0].x > tabs[1].x, 'Front on the right');
    assert.ok(tabs.every((x) => x.h >= 44), 'tabs big enough to tap');
    await waitCount(page, 'الوش (١ من ٢)');
    await page.keyboard.press('ArrowLeft');
    await waitCount(page, 'الضهر (٢ من ٢)');
    assert.strictEqual(await page.$eval('.vw-frame img', (i) => i.alt), 'الضهر');
    await fingerSwipe(page, -160);
    await waitCount(page, 'الوش (١ من ٢)');
    assert.strictEqual(await text(page, '#vw-make'), 'اعمل تصميمك على إبداع');
    const f = await box(page, '.vw-frame');
    assert.ok(f.x >= 0 && f.right <= 360, 'inside the screen');
    assert.ok(await noSideways(page), 'no sideways scroll at 360 px');
    await noShopBits(page);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }
});

test('the picture\'s place is kept while it loads (no jump)', { timeout: 60000 }, async () => {
  const page = await open('bookltr', { lang: 'en', viewport: { width: 390, height: 844 }, delay: 700 });
  try {
    await page.waitForSelector('#vw-body:not([hidden]) .vw-frame');
    const before = await box(page, '.vw-frame');
    const bar = await box(page, '#vw-bar');
    assert.ok(before.h > 300, `room kept (${before.h} px)`);
    await page.waitForFunction(() => document.querySelector('.vw-frame img').complete);
    const after = await box(page, '.vw-frame');
    assert.deepStrictEqual([after.y, after.h], [before.y, before.h]);
    assert.strictEqual((await box(page, '#vw-bar')).y, bar.y, 'the buttons stay put');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.ctx.close();
  }
});

test('an old or wrong link: "This link doesn\'t work any more", ask for a new one, a link home', { timeout: 60000 }, async () => {
  const cases = [
    ['missing1234', 'en', 'This link doesn\'t work any more', 'Ask whoever sent it to you for a new one.'],
    ['expired', 'en', 'This link doesn\'t work any more', 'Ask whoever sent it to you for a new one.'],
    ['expired', 'ar', 'الرابط ده مبقاش شغال', 'اطلب من اللي بعتهولك رابط جديد.'],
    [null, 'ar', 'الرابط ده مبقاش شغال', 'اطلب من اللي بعتهولك رابط جديد.'],
  ];
  for (const [id, lang, title, line] of cases) {
    const page = await open(id, { lang, viewport: { width: 360, height: 740 } });
    try {
      await page.waitForSelector('#vw-gone:not([hidden])');
      assert.strictEqual(await text(page, '#vw-gone h1'), title, `${id} ${lang}`);
      assert.strictEqual(await text(page, '#vw-gone p'), line);
      assert.strictEqual(await page.$eval('#vw-gone a', (a) => a.getAttribute('href')), '/');
      assert.strictEqual(await page.isVisible('#vw-body'), false);
      assert.strictEqual(await page.isVisible('#vw-make-foot'), false, 'no Make your own without a design');
      assert.ok(await noSideways(page), 'no sideways scroll');
      await noShopBits(page);
      // (The browser itself notes the 404 / 410 answer.)
      assert.deepStrictEqual(page.errors.filter((e) => !/status of 4(04|10)/.test(e)), [], `${id} ${lang}`);
    } finally {
      await page.ctx.close();
    }
  }
});
