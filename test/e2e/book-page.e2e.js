'use strict';

// QA (25 Nov), the kids' book page in the browser: "Make my book" pressed again from the keyboard while the book
// was being made made more books; phone Back after "Add to cart" kept editing the book in the cart (a brother's
// book replaced it); the form said "please type" for a choice and a photo and didn't go to the photo box; the
// highlighted page thumbnail scrolled out of sight on a phone; an Arabic hint sat on the left of an empty box.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

/** A plain JPEG "photo" (a face-ish oval on a background) for the photo box. */
async function photo() {
  const sharp = require('sharp');
  const svg = '<svg width="600" height="750"><rect width="600" height="750" fill="#9ab"/><ellipse cx="300" cy="330" rx="170" ry="220" fill="#e8b996"/><circle cx="240" cy="300" r="18" fill="#333"/><circle cx="360" cy="300" r="18" fill="#333"/></svg>';
  return { name: 'child.jpg', mimeType: 'image/jpeg', buffer: await sharp(Buffer.from(svg)).jpeg().toBuffer() };
}
async function context(browser, lang, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}
async function openBook(ctx, base, id = 'dream-jobs') {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(`${base}/book?b=${id}`);
  await page.waitForSelector('#bk:not([hidden]) #bk-questions [data-q="name"]');
  return page;
}
const lastToast = (page) => page.evaluate(() => { const all = document.querySelectorAll('#toast-root .toast'); return all.length ? all[all.length - 1].textContent : ''; });

test('kids book: Enter pressed again while the book is made makes one book; Back after "Add to cart" starts a new book', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'en');
    const page = await openBook(ctx, srv.base);
    const made = [];
    const updated = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/books\/dream-jobs\/designs$/.test(r.url())) made.push(r.url());
      if (r.method() === 'PUT' && /\/api\/books\/designs\//.test(r.url())) updated.push(r.url());
    });
    // A phone's Back shows the page again from the browser's back-forward cache, as it was when it left for the
    // cart. Playwright's browser keeps no such cache, so the trip to the cart is stopped (the page stays as it
    // was) and the page is then shown again the way the cache does it.
    await page.route(/\/cart\?added=1$/, (route) => route.abort('aborted'));
    const backFromCart = () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    const cartLines = () => page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'));

    await page.fill('#q-name', 'Laila');
    await page.click('[data-q="gender"][data-v="girl"]');
    await page.setInputFiles('#bk-file', await photo());
    await page.waitForSelector('#bk-crop:not([hidden])');
    // The QA case: the focused button pressed three times from the keyboard while the first save runs.
    await page.focus('#bk-make');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#bk-make').disabled && !document.querySelector('#bk-add').disabled, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    assert.strictEqual(made.length, 1, 'one book on the server');

    await page.click('#bk-add');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]').length === 1);
    const firstId = (await cartLines())[0].designId;
    await backFromCart();
    // That book is in the cart: the page is a new book now.
    await page.waitForFunction(() => document.querySelector('#bk-make').textContent === 'Show my book');
    assert.strictEqual(await page.isDisabled('#bk-add'), true, 'nothing to add until the new book is made');
    assert.strictEqual(await page.isVisible('#bk-photo-empty'), true, 'a new photo is asked for');
    assert.strictEqual(await page.inputValue('#q-name'), 'Laila', 'the answers stay as a start');

    // The QA case: the brother's name and photo, the book made, then "Add to cart".
    await page.fill('#q-name', 'Omar');
    await page.click('[data-q="gender"][data-v="boy"]');
    await page.setInputFiles('#bk-file', await photo());
    await page.waitForSelector('#bk-crop:not([hidden])');
    await page.click('#bk-make');
    await page.waitForFunction(() => !document.querySelector('#bk-add').disabled, null, { timeout: 60000 });
    await page.click('#bk-add');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]').length === 2, null, { timeout: 10000 });
    const cart = await cartLines();
    assert.strictEqual(cart[0].designId, firstId, 'the first book is still in the cart');
    assert.notStrictEqual(cart[1].designId, firstId, "the brother's book is a book of its own");
    assert.strictEqual(made.length, 2);
    assert.deepStrictEqual(updated, [], 'the first book was not changed');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('kids book on a phone (Arabic): "choose" for a choice, the photo box for the photo; the page thumbnail stays in sight; an Arabic hint on the right', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'ar', { width: 390, height: 844 });
    const page = await openBook(ctx, srv.base);

    // The highlighted thumbnail stays inside the strip, page after page.
    for (let i = 0; i < 12; i++) {
      await page.click('#bk-next');
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
    const inView = await page.evaluate(() => {
      const strip = document.querySelector('#bk-thumbs').getBoundingClientRect();
      const r = document.querySelector('#bk-thumbs button.active').getBoundingClientRect();
      return { left: r.left >= strip.left - 1 && r.right <= strip.right + 1, scrolls: document.querySelector('#bk-thumbs').scrollWidth > document.querySelector('#bk-thumbs').clientWidth };
    });
    assert.ok(inView.scrolls, 'the strip scrolls on a phone');
    assert.ok(inView.left, 'the page thumbnail is in sight');

    // A choice is chosen, not typed.
    await page.fill('#q-name', 'Laila');
    await page.click('#bk-make');
    assert.strictEqual(await lastToast(page), 'من فضلك اختار: ولد ولا بنت');
    // The photo is added, and the page goes to the photo box.
    await page.click('[data-q="gender"][data-v="girl"]');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.click('#bk-make');
    assert.strictEqual(await lastToast(page), 'من فضلك ضيف صورة الطفل');
    await page.waitForFunction(() => {
      const r = document.querySelector('#bk-photo-empty').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }, null, { timeout: 5000 });

    // One field in Arabic letters: "this box", not "these".
    await page.fill('#q-name', 'ليلى');
    await page.click('#bk-make');
    assert.strictEqual(await lastToast(page), 'من فضلك اكتب الخانة دي بحروف إنجليزي: اسم الطفل');

    // The colouring book has no dedication; the story book's: an empty box follows the page (right to left),
    // and what is typed in English runs left to right.
    const story = await openBook(ctx, srv.base, 'space-hero');
    assert.strictEqual(await story.$eval('#q-dedication', (el) => getComputedStyle(el).direction), 'rtl');
    await story.fill('#q-dedication', 'With love');
    assert.strictEqual(await story.$eval('#q-dedication', (el) => getComputedStyle(el).direction), 'ltr');
    assert.deepStrictEqual(page.errors, []);
    assert.deepStrictEqual(story.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
