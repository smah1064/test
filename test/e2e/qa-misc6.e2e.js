'use strict';

// QA tester 2 (25 Nov), in the browser: the Products editor's number boxes take Arabic digits (and an emptied
// price says what saving it does), white artwork shows on dark checks in the cart's proof, and the kids' book page
// says "English letters" once, as a hint.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

async function arabicContext(browser, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  return ctx;
}
async function signIn(ctx, base) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(`${base}/admin`);
  await page.fill('#password', 'secret');
  await page.press('#password', 'Enter');
  await page.waitForSelector('#dash:not([hidden])');
  return page;
}
async function openProduct(page, id) {
  await page.click('[data-tab="products"]');
  await page.waitForSelector(`#pm-root [data-pm-act="edit"][data-id="${id}"]`);
  await page.click(`#pm-root [data-pm-act="edit"][data-id="${id}"]`);
  await page.waitForSelector('#pm-sec-prices');
}

test('Products editor (Arabic): ٢٧٠ is 270 and is saved; an emptied price says what it goes back to; a wrong one is not sent', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await arabicContext(browser);
    const page = await signIn(ctx, srv.base);
    await openProduct(page, 'cap');
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/api\/admin\/catalog\/cap$/.test(r.url())) sent.push(JSON.parse(r.postData())); });
    const shopPrice = () => page.evaluate(async () => (await (await fetch('/api/products')).json()).products.find((p) => p.id === 'cap').basePrice);
    assert.strictEqual(await shopPrice(), 300);

    // The QA case: typed with an Arabic keyboard.
    await page.fill('#pm-f-basePrice', '');
    await page.type('#pm-f-basePrice', '٢٧٠');
    assert.strictEqual(await page.inputValue('#pm-f-basePrice'), '٢٧٠', 'the box keeps what was typed (a number box dropped it)');
    assert.match(await page.textContent('[data-final="one"]'), /٢٧٠/);
    await page.click('[data-pm-save="prices"]');
    await page.waitForFunction(() => document.querySelector('[data-pm-save="prices"]').disabled);
    assert.strictEqual(sent.at(-1).prices.basePrice, '270');
    assert.strictEqual(await shopPrice(), 270);

    // Emptied: the box says it goes back to the original price (300), and the column shows it.
    await page.fill('#pm-f-basePrice', '');
    const hint = await page.textContent('#pm-f-basePrice-msg');
    assert.match(hint, /فاضية: لما تحفظ هيرجع السعر الأصلي/);
    assert.match(hint, /٣٠٠/);
    assert.strictEqual(await page.getAttribute('#pm-f-basePrice', 'aria-invalid'), 'false', 'a hint, not an error');
    assert.match(await page.textContent('[data-final="one"]'), /٣٠٠/);

    // Not a number: said under the box and in the section; nothing is sent.
    await page.fill('#pm-f-basePrice', '٢٧o');
    assert.match(await page.textContent('#pm-f-basePrice-msg'), /اكتب رقم/);
    assert.strictEqual(await page.getAttribute('#pm-f-basePrice', 'aria-invalid'), 'true');
    assert.strictEqual(await page.textContent('[data-final="one"]'), '—');
    const before = sent.length;
    await page.click('[data-pm-save="prices"]');
    await page.waitForSelector('#pm-sec-prices .pm-err:not([hidden])');
    assert.match(await page.textContent('#pm-sec-prices .pm-err'), /السعر الأساسي: اكتب رقم/);
    assert.strictEqual(sent.length, before, 'not sent');
    assert.strictEqual(await shopPrice(), 270);

    // The Arabic decimal mark in a size's add-on; then emptied boxes saved: back to the original price.
    await page.fill('#pm-f-basePrice', '٣٠٠');
    await page.fill('#pm-f-ps_one', '١٢٫٥');
    assert.match(await page.textContent('[data-final="one"]'), /٣١٢٫٥/);
    await page.click('[data-pm-save="prices"]');
    await page.waitForFunction(() => document.querySelector('[data-pm-save="prices"]').disabled);
    assert.deepStrictEqual(sent.at(-1).prices.sizes, { one: '12.5' });
    await page.fill('#pm-f-basePrice', '');
    await page.fill('#pm-f-ps_one', '');
    assert.match(await page.textContent('#pm-f-ps_one-msg'), /فاضية: لما تحفظ هترجع زي الأصل من غير زيادة/);
    await page.click('[data-pm-save="prices"]');
    await page.waitForFunction(() => document.querySelector('[data-pm-save="prices"]').disabled);
    assert.strictEqual(await shopPrice(), 300);

    // Stock in Arabic digits; a fraction is refused before it is sent.
    await page.check('[name=stockMode][value=whole]');
    await page.fill('#pm-f-stock', '٤٥');
    await page.fill('#pm-f-lowStockAt', '٣٫٥');
    const n = sent.length;
    await page.click('[data-pm-save="avail"]');
    await page.waitForSelector('#pm-sec-avail .pm-err:not([hidden])');
    assert.strictEqual(sent.length, n);
    await page.fill('#pm-f-lowStockAt', '٣');
    await page.click('[data-pm-save="avail"]');
    await page.waitForFunction(() => document.querySelector('[data-pm-save="avail"]').disabled);
    assert.deepStrictEqual([sent.at(-1).stock, sent.at(-1).lowStockAt], [45, 3]);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Products editor: the pack-price warning still shows for prices typed in Arabic digits', { timeout: 60000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await signIn(ctx, srv.base);
    await openProduct(page, 'brochures');
    // 1 brochure at 40 of its own (175 − 135), the price lowered to 175: 10 brochures at 35 cost less.
    await page.fill('#pm-f-basePrice', '١٧٥');
    await page.fill('#pm-f-ps_1', '-١٣٥');
    await page.waitForSelector('[data-pack-warn] .pack-warn');
    assert.match(await page.textContent('[data-pack-warn]'), /10 brochures \(EGP\s?35\) costs less than 1 brochure \(EGP\s?40\)/);
    // Saving still works, and the warning is the same after.
    await page.click('[data-pm-save="prices"]');
    await page.waitForFunction(() => document.querySelector('[data-pm-save="prices"]').disabled);
    assert.match(await page.textContent('[data-pack-warn]'), /10 brochures \(EGP\s?35\) costs less than 1 brochure \(EGP\s?40\)/);
    // Raised again (۴۰۰, Persian digits): gone.
    await page.fill('#pm-f-basePrice', '۴۰۰');
    await page.waitForFunction(() => !document.querySelector('[data-pack-warn] .pack-warn'));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('cart proof: white lettering is shown on dark checks, and "Dark background" switches it', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=black');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getObjects()[0].fill.toLowerCase()), '#ffffff', 'white on the black shirt');
    await page.click('#add-to-cart');
    // "Which size?"
    await page.click('#size-ask [data-ask-size="M"]');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    await page.waitForSelector('.proof-art-box.is-dark', { timeout: 30000 });
    assert.strictEqual(await page.getAttribute('[data-proof-bg]', 'aria-pressed'), 'true');
    assert.strictEqual((await page.textContent('[data-proof-bg]')).trim(), 'Dark background');
    // The checks still show (see-through parts), dark.
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.proof-art-box.is-dark .proof-art')).backgroundImage);
    assert.match(bg, /conic-gradient/);
    await page.click('[data-proof-bg]');
    assert.strictEqual(await page.evaluate(() => document.querySelector('.proof-art-box').classList.contains('is-dark')), false);
    assert.strictEqual(await page.getAttribute('[data-proof-bg]', 'aria-pressed'), 'false');
    // The cart draws its proofs again on a language switch: the choice stays.
    await page.click('[data-lang-toggle]');
    await page.waitForFunction(() => document.querySelector('[data-proof-bg]') && document.querySelector('[data-proof-bg]').textContent.trim() === 'خلفية غامقة');
    assert.strictEqual(await page.evaluate(() => document.querySelector('.proof-art-box').classList.contains('is-dark')), false);
    await page.click('[data-proof-bg]');
    assert.strictEqual(await page.evaluate(() => document.querySelector('.proof-art-box').classList.contains('is-dark')), true);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('kids book: "English letters" once, as a hint; an error only once Arabic letters are typed', { timeout: 60000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    for (const lang of ['ar', 'en']) {
      const ctx = lang === 'ar' ? await arabicContext(browser, 360) : await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${srv.base}/book?b=space-hero`);
      await page.waitForSelector('#bk:not([hidden]) #bk-en-hint');
      const said = () => page.evaluate(() => ({
        hints: [...document.querySelectorAll('.bk-panel p')].filter((p) => /English letters|بحروف إنجليزي/.test(p.textContent)).map((p) => p.className),
        notices: document.querySelectorAll('.bk-panel .notice').length,
      }));
      assert.deepStrictEqual(await said(), { hints: ['muted small bk-en-hint'], notices: 0 }, `${lang}: once, as a hint`);
      await page.fill('#q-name', 'نور');
      await page.waitForSelector('.bk-latin-note');
      assert.strictEqual(await page.getAttribute('#q-name', 'aria-invalid'), 'true');
      await page.fill('#q-name', 'Nour');
      await page.waitForFunction(() => !document.querySelector('.bk-latin-note'));
      assert.strictEqual(await page.getAttribute('#q-name', 'aria-invalid'), 'false');
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
