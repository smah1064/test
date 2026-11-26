'use strict';

// Editor redesign, stage 2 (owner's go, 26 Nov), phones: one slim top bar (logo, "Saved", the product button, ⋯),
// a buy bar with the price, what is being bought ("White, M, 1 piece" / "choose a size") and one orange button;
// Save keeps the customer in the editor; Add to cart with no size asks in a short sheet and waits for a confirm;
// the print check opens its own short sheet.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function openPhone(browser, base, lang, viewport = { width: 412, height: 839 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${base}/editor?product=tshirt`);
  await page.waitForFunction(() => window.__editor);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
async function addName(page, words) {
  await page.click('[data-flyout="text"]');
  await page.locator('#text-presets button').first().click();
  await page.waitForSelector('#p-text');
  await page.fill('#p-text', words);
  await page.dispatchEvent('#p-text', 'input');
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); const c = window.__editor.canvas; c.discardActiveObject(); c.requestRenderAll(); c.fire('selection:cleared'); });
  await page.waitForTimeout(900); // (the design saves itself a moment after a change)
}

test('phones: top bar with the product button and ⋯ menu; buy bar says what is bought; nothing cut or sideways', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const viewport of [{ width: 412, height: 839 }, { width: 360, height: 740 }]) {
      for (const lang of ['ar', 'en']) {
        const label = `${lang} ${viewport.width}`;
        const { ctx, page, errors } = await openPhone(browser, srv.base, lang, viewport);
        const bars = await page.evaluate(() => ({
          header: getComputedStyle(document.querySelector('.site-header')).display,
          top: Math.round(document.getElementById('ed-top').getBoundingClientRect().height),
          save: getComputedStyle(document.getElementById('save-draft')).display,
          sideways: document.documentElement.scrollWidth > innerWidth,
        }));
        assert.deepStrictEqual(bars, { header: 'none', top: 56, save: 'none', sideways: false }, label);
        assert.match(await page.textContent('#ed-prod-name'), lang === 'ar' ? /تيشيرت/ : /T-Shirt/i);
        // No size yet: the buy bar asks for one.
        assert.match(await page.textContent('#buy-sum'), lang === 'ar' ? /اختار المقاس/ : /choose a size/);
        assert.strictEqual(await page.evaluate(() => document.getElementById('buy-sum').classList.contains('ask')), true);
        // Not saved before anything is designed; saved after.
        assert.strictEqual(await page.isVisible('#ed-saved'), false, `no saved mark yet, ${label}`);
        await addName(page, lang === 'ar' ? 'سارة' : 'Sara');
        assert.strictEqual(await page.isVisible('#ed-saved'), true, `saved mark, ${label}`);
        // The product button opens the product sheet; a size there shows in the bar and under the price.
        await page.click('#ed-prod');
        await page.waitForSelector('#sizes [data-size="M"]', { state: 'visible' });
        await page.click('#sizes [data-size="M"]');
        await page.click('#sheet-close');
        assert.match(await page.textContent('#ed-prod-sub'), /M/);
        assert.match(await page.textContent('#buy-sum'), lang === 'ar' ? /M.*قطعة واحدة/ : /M.*1 piece/);
        // The ⋯ menu: cart, account, products, the other language, save; Escape closes it.
        await page.click('#ed-more');
        const items = await page.$$eval('#ed-menu a, #ed-menu button', (xs) => xs.filter((x) => x.offsetParent).map((x) => x.getAttribute('href') || x.dataset.proxy || x.id || (x.hasAttribute('data-lang-toggle') ? 'lang' : '')));
        // (Stage 3: share, zoom to the print area, hide the guides and clear the side moved here from the bar.)
        assert.deepStrictEqual(items, ['/cart', '/account', '/#products', 'lang', 'share-open', 'zoom-print', 'preview-toggle', 'ed-save', 'clear-side']);
        assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('#ed-menu a, #ed-menu button')].every((x) => x.getBoundingClientRect().height >= 44)), true);
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.isVisible('#ed-menu'), false);
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('phones: Save keeps the customer in the editor; Add to cart with no size waits for a confirm', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await openPhone(browser, srv.base, 'ar');
    await addName(page, 'سارة');
    await page.click('#ed-more');
    await page.click('#ed-save');
    await page.waitForSelector('#toast-root .toast');
    assert.match(await page.textContent('#toast-root .toast'), /تصميماتي المحفوظة/);
    assert.match(page.url(), /\/editor/, 'still in the editor');
    // Add to cart, no size: the sheet asks; a size alone adds nothing.
    await page.click('#add-to-cart');
    await page.waitForSelector('#size-ask', { state: 'visible' });
    assert.strictEqual(await page.isDisabled('#size-ask-ok'), true);
    await page.click('#size-ask [data-ask-size="L"]');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.isVisible('#size-ask'), true, 'a size alone does not add');
    assert.match(page.url(), /\/editor/);
    assert.strictEqual(await page.isDisabled('#size-ask-ok'), false);
    await page.click('#size-ask-ok');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2') || '[]'));
    assert.strictEqual(cart.length, 1);
    assert.strictEqual(cart[0].sizeLabel.en, 'L');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('phones: the print check opens its own short sheet', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const { ctx, page, errors } = await openPhone(browser, srv.base, 'ar');
    await page.click('[data-flyout="text"]');
    await page.locator('#text-presets button').first().click(); // the sample words, left as they are
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); const c = window.__editor.canvas; c.discardActiveObject(); c.requestRenderAll(); c.fire('selection:cleared'); });
    await page.waitForFunction(() => /warn|bad/.test(document.getElementById('check-chip').className));
    await page.click('#check-chip');
    await page.waitForSelector('#check-list li', { state: 'visible' });
    const sheet = await page.evaluate(() => ({ title: document.getElementById('sheet-title').textContent, product: getComputedStyle(document.getElementById('sec-product')).display }));
    assert.deepStrictEqual(sheet, { title: 'فحص الطباعة', product: 'none' });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
