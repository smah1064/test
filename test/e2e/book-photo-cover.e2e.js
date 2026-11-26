'use strict';

// QA (26 Nov), the kids' book page: a 60 x 40 px photo was taken with no word (it printed blurred; the photo prints
// page warns for the same picture), and a cover marked sold out in admin → Products was a normal choice (the order
// went through). The page now warns about a face too small to print sharply (keep it or pick another photo, never
// blocked) and shows a sold-out cover as the editor shows a sold-out size.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

/** A JPEG "photo" of w x h px: a face-ish oval on a background. */
async function photo(w, h) {
  const sharp = require('sharp');
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 600 750" preserveAspectRatio="none"><rect width="600" height="750" fill="#9ab"/><ellipse cx="300" cy="330" rx="170" ry="220" fill="#e8b996"/><circle cx="240" cy="300" r="18" fill="#333"/><circle cx="360" cy="300" r="18" fill="#333"/></svg>`;
  return { name: 'child.jpg', mimeType: 'image/jpeg', buffer: await sharp(Buffer.from(svg)).jpeg().toBuffer() };
}
async function context(browser, lang, init = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(([l, saved]) => {
    try {
      localStorage.setItem('pod-lang', l);
      for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    } catch (e) { /* ignore */ }
  }, [lang, init]);
  return ctx;
}
async function openBook(ctx, base, id) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(`${base}/book?b=${id}`);
  await page.waitForSelector('#bk:not([hidden]) #bk-questions [data-q="name"]');
  return page;
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toast-root .toast')].map((el) => el.textContent));
const visible = (page, sel) => page.isVisible(sel);

test('kids book: a photo too small to print sharply is said (Arabic and English), the customer keeps it or picks another', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    // Arabic, the colouring book: the QA's 60 x 40 photo.
    const ar = await openBook(await context(browser, 'ar'), srv.base, 'dream-jobs');
    const made = [];
    ar.on('request', (r) => { if (r.method() === 'POST' && /\/api\/books\/dream-jobs\/designs$/.test(r.url())) made.push(r.url()); });
    await ar.fill('#q-name', 'Laila');
    await ar.click('[data-q="gender"][data-v="girl"]');
    assert.strictEqual(await visible(ar, '#bk-lowres'), false, 'nothing said before a photo');
    await ar.setInputFiles('#bk-file', await photo(60, 40));
    await ar.waitForSelector('#bk-crop:not([hidden])');
    await ar.waitForSelector('#bk-lowres:not([hidden])');
    const arText = await ar.textContent('#bk-lowres');
    assert.match(arText, /الوش في الصورة دي صغير، فممكن يطلع مش واضح في الكتاب/);
    assert.doesNotMatch(arText, /محل/);
    assert.match(await ar.textContent('#bk-lowres label[for="bk-file"]'), /اختار صورة تانية/);
    assert.strictEqual(await ar.getAttribute('#bk-lowres', 'role'), 'status');
    // Kept: the note goes, and the book is made with it (never blocked).
    await ar.click('#bk-lowres-ok');
    assert.strictEqual(await visible(ar, '#bk-lowres'), false);
    await ar.click('#bk-make');
    await ar.waitForFunction(() => !document.querySelector('#bk-add').disabled, null, { timeout: 60000 });
    assert.strictEqual(made.length, 1, 'the book was made with the small photo');
    // Another small photo: said again.
    await ar.setInputFiles('#bk-file', await photo(60, 40));
    await ar.waitForSelector('#bk-lowres:not([hidden])');
    // "Choose another photo" opens the photo picker; a good photo: nothing to say.
    const [chooser] = await Promise.all([ar.waitForEvent('filechooser'), ar.click('#bk-lowres label[for="bk-file"]')]);
    await chooser.setFiles(await photo(1200, 1500));
    await ar.waitForSelector('#bk-lowres', { state: 'hidden' });
    assert.deepStrictEqual(ar.errors, []);

    // English, the story book (its biggest face prints bigger): a good photo is fine until the face is zoomed in a lot.
    const en = await openBook(await context(browser, 'en'), srv.base, 'space-hero');
    await en.setInputFiles('#bk-file', await photo(600, 750));
    await en.waitForSelector('#bk-crop:not([hidden])');
    assert.strictEqual(await visible(en, '#bk-lowres'), false, 'a 600 x 750 photo at the usual zoom prints fine');
    await en.$eval('#bk-zoom', (el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await en.waitForSelector('#bk-lowres:not([hidden])');
    assert.match(await en.textContent('#bk-lowres'), /The face in this photo is small, so it may print blurry in the book\./);
    assert.match(await en.textContent('#bk-lowres-ok'), /Use this one anyway/);
    // Zoomed out again: nothing to say.
    await en.$eval('#bk-zoom', (el) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await en.waitForSelector('#bk-lowres', { state: 'hidden' });
    // The language switch says it in the other language.
    await en.$eval('#bk-zoom', (el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await en.click('[data-lang-toggle]');
    await en.waitForFunction(() => /الوش في الصورة دي صغير/.test(document.querySelector('#bk-lowres').textContent));
    assert.strictEqual(await visible(en, '#bk-lowres'), true);
    assert.deepStrictEqual(en.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('kids book: a sold-out cover shows "Sold out" and can\'t be picked; a chosen one that sold out moves to the one left, said', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const call = async (method, url, body, token) => {
      const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      assert.ok(r.ok, `${method} ${url}: ${r.status} ${await r.clone().text()}`);
      return r.json();
    };
    const owner = (await call('POST', '/api/admin/login', { password: 'secret' })).token;
    // The story book's hardcover marked sold out (admin → Products).
    await call('PUT', '/api/admin/catalog/storybook', { sizes: { hard: { soldOut: true } } }, owner);
    const shop = (await call('GET', '/api/products')).products;
    const story = shop.find((p) => p.id === 'storybook');
    assert.ok(story.sizes.find((z) => z.id === 'hard').soldOut, 'the shop marks it');

    // The customer had chosen the hardcover before (the page remembers it): the softcover now, said so.
    const en = await openBook(await context(browser, 'en', { 'pod-book-space-hero': JSON.stringify({ size: 'hard', answers: {} }) }), srv.base, 'space-hero');
    await en.waitForFunction(() => document.querySelectorAll('#toast-root .toast').length > 0);
    assert.ok((await toasts(en)).includes('Hardcover is sold out right now, so we picked Softcover.'), (await toasts(en)).join(' | '));
    const chips = () => en.$$eval('#bk-sizes .chip', (els) => els.map((el) => ({ text: el.textContent.trim(), sold: el.classList.contains('sold-out'), active: el.classList.contains('active'), disabled: el.getAttribute('aria-disabled') })));
    assert.deepStrictEqual(await chips(), [
      { text: 'Softcover', sold: false, active: true, disabled: null },
      { text: 'Hardcover Sold out', sold: true, active: false, disabled: 'true' },
    ]);
    const soft = story.basePrice + story.sizes.find((z) => z.id === 'soft').surcharge;
    assert.match(await en.textContent('#bk-price'), new RegExp(String(soft)));
    // Tapping it: not picked, the page says why. (aria-disabled: Playwright would wait for it to be enabled.)
    await en.click('#bk-sizes .chip.sold-out', { force: true });
    assert.ok((await toasts(en)).includes('Hardcover is sold out right now. Please choose another cover.'));
    assert.strictEqual(await en.$eval('#bk-sizes .chip.active', (el) => el.dataset.size), 'soft');
    // Arabic: "خلصان", as in the editor.
    await en.click('[data-lang-toggle]');
    await en.waitForFunction(() => /خلصان/.test(document.querySelector('#bk-sizes .chip.sold-out').textContent));
    assert.strictEqual(await en.textContent('#bk-sizes .chip.sold-out .sold-tag'), 'خلصان');
    assert.deepStrictEqual(en.errors, []);

    // The colouring book's softcover sold out by its stock count (colour and size at 0: the editor's data too):
    // a first visit starts on the hardcover, and the book is made with it.
    await call('PUT', '/api/admin/catalog/coloringbook', { variantStock: { 'std|soft': 0, 'std|hard': 5 } }, owner);
    const ar = await openBook(await context(browser, 'ar'), srv.base, 'dream-jobs');
    assert.strictEqual(await ar.$eval('#bk-sizes .chip.active', (el) => el.dataset.size), 'hard');
    assert.strictEqual(await ar.$eval('#bk-sizes .chip.sold-out', (el) => el.dataset.soldSize), 'soft');
    assert.match(await ar.textContent('#bk-sizes .chip.sold-out'), /غلاف عادي\s*خلصان/);
    const sent = [];
    ar.on('request', (r) => { if (r.method() === 'POST' && /\/api\/books\/dream-jobs\/designs$/.test(r.url())) sent.push(JSON.parse(r.postData()).size); });
    await ar.fill('#q-name', 'Laila');
    await ar.click('[data-q="gender"][data-v="girl"]');
    await ar.setInputFiles('#bk-file', await photo(600, 750));
    await ar.waitForSelector('#bk-crop:not([hidden])');
    await ar.click('#bk-make');
    await ar.waitForFunction(() => !document.querySelector('#bk-add').disabled, null, { timeout: 60000 });
    assert.deepStrictEqual(sent, ['hard']);
    assert.deepStrictEqual(ar.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
