'use strict';

// "New product from photo", slice 1, in the browser: Products → New product → "From measurements (cups, tumblers)".
// A tapered tumbler typed with an Arabic keyboard (Arabic digits, a comma decimal), the drawings and the "narrows by"
// line, the print band fixed to fit, the hidden product made; its Measurements section, the workshop files, the
// owner's "Dimensions checked", new measurements (the check is cleared), and the Arabic page has no English left.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

async function context(browser, lang, width = 1024, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
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
async function openForm(page) {
  await page.click('[data-tab="products"]');
  await page.waitForSelector('#pm-root [data-pm-act="new"]');
  await page.click('#pm-root [data-pm-act="new"]');
  await page.click('dialog [data-dlg-dw]');
  await page.waitForSelector('dialog.dw-dlg [data-dw-side] svg');
}
/** English words left in a text (codes, units and file types aside). */
const englishIn = (s) => (s.match(/[A-Za-z]{2,}/g) || []).filter((w) => !['SVG', 'PDF'].includes(w));

test('From measurements (Arabic, iPad): a tapered tumbler, its fan drawing and squeeze, the hidden product, files, the owner\'s check', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'ar', 820, 1180);
    const page = await signIn(ctx, srv.base);
    await openForm(page);
    const dlg = page.locator('dialog.dw-dlg');
    assert.strictEqual(await page.evaluate(() => document.documentElement.dir), 'rtl');
    // Nothing typed yet: no list of mistakes, the template waits.
    assert.strictEqual(await dlg.locator('[data-dw-problems]').isHidden(), true);
    assert.match(await dlg.locator('[data-dw-fan]').textContent(), /صلّح المقاسات/);

    // Typed with an Arabic keyboard; "90,0" with a comma.
    await page.fill('#dw-height', '١٢٠');
    await page.fill('#dw-top', '90,0');
    await page.fill('#dw-bottom', '٦٥');
    await page.fill('#dw-bandTop', '١٠');
    await page.fill('#dw-bandH', '١٣٠');
    // 10 + 130 > 120: said, with a button that makes it fit.
    await page.waitForSelector('dialog.dw-dlg [data-dw-problems]:not([hidden]) [data-dw-fix="band"]');
    assert.match(await dlg.locator('[data-dw-problems]').textContent(), /برّه الكوباية/);
    assert.ok(await dlg.locator('.dw-over').count() >= 1, 'the part past the bottom is drawn in red');
    await page.click('dialog.dw-dlg [data-dw-fix="band"]');
    assert.strictEqual(await page.inputValue('#dw-bandH'), '110');
    await page.waitForSelector('dialog.dw-dlg [data-dw-squeeze]');
    assert.strictEqual(await dlg.locator('[data-dw-problems]').isHidden(), true);

    // The fan: radii, sweep, width × height, and how much narrower the design is at the bottom.
    // d1 = 90 − 25·10/120 ≈ 87.9, d2 = 65 → 1 − 32.5/43.96 ≈ 26.1 %.
    const facts = await dlg.locator('[data-dw-facts]').textContent();
    assert.match(facts, /نص القطر الخارجي/);
    assert.match(facts, /زاوية الفتحة/);
    assert.match(await dlg.locator('[data-dw-squeeze]').textContent(), /أضيق بـ ٢٦٫١% من تحت/);
    assert.ok(await dlg.locator('[data-dw-fan] .dw-tpl').count() === 1, 'the fan is drawn');
    assert.ok(await dlg.locator('[data-dw-side] .dw-band').count() === 1, 'the print band is drawn on the cup');

    // A straight cup: the plain rectangle, no "narrows" line; back to tapered.
    await page.fill('#dw-bottom', '٩٠');
    await page.waitForSelector('dialog.dw-dlg [data-dw-squeeze]', { state: 'detached' });
    assert.match(await dlg.textContent(), /مستطيل عادي/);
    await page.fill('#dw-bottom', '٦٥');
    await page.waitForSelector('dialog.dw-dlg [data-dw-squeeze]');

    // The product.
    await page.fill('#dw-ar', 'تمبلر مخروطي');
    await page.fill('#dw-en', 'Tapered tumbler');
    await page.fill('#dw-id', 'tapered-tumbler');
    await page.fill('#dw-price', '٤٥٠');
    const leftovers = englishIn(await dlg.evaluate((d) => d.innerText));
    assert.deepStrictEqual(leftovers, [], 'the Arabic form has no English left');
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /from-measurements$/.test(r.url())) sent.push(JSON.parse(r.postData())); });
    await page.click('dialog.dw-dlg [data-dlg-ok]');
    await page.waitForSelector('#pm-sec-measure');
    assert.deepStrictEqual(sent[0], {
      kind: 'tumbler', handle: null,
      typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 10, printHeightMm: 110 },
      material: 'metal', gapMm: 5, safeMm: 3, id: 'tapered-tumbler', name: { en: 'Tapered tumbler', ar: 'تمبلر مخروطي' }, price: 450,
    });

    // The edit page: the badge, the Measurements section instead of the print-area editor, the check needed first.
    assert.match(await page.textContent('#pm-ehead'), /من المقاسات/);
    assert.strictEqual(await page.locator('#pm-sec-print').count(), 0);
    assert.match(await page.textContent('#pm-banner'), /يراجع المقاسات الأول/);
    const sec = page.locator('#pm-sec-measure');
    assert.match(await sec.textContent(), /ارتفاع ١٢٠ مم/);
    assert.match(await sec.textContent(), /ارتفاعها ١١٠ مم/);
    assert.ok(await sec.locator('[data-dw-unchecked] [data-pm-act="dw-check"]').count() === 1);
    assert.deepStrictEqual(englishIn(await sec.evaluate((d) => d.innerText)), [], 'the Arabic section has no English left');
    assert.deepStrictEqual(englishIn(await page.locator('#pm-banner').evaluate((d) => d.innerText)), []);

    // The workshop files answer 200.
    for (const f of ['template.svg', 'template.pdf', 'spec.pdf']) {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/admin/catalog/tapered-tumbler/${f}`)),
        page.click(`#pm-sec-measure [data-dw-file="${f}"]`),
      ]);
      assert.strictEqual(res.status(), 200, f);
      assert.match(res.headers()['content-type'], f.endsWith('svg') ? /svg/ : /pdf/, f);
    }

    // The owner's "Dimensions checked" (the confirm is accepted), then the product can be shown in the shop.
    await page.click('#pm-sec-measure [data-pm-act="dw-check"]');
    await page.waitForSelector('#pm-sec-measure [data-dw-checked]');
    assert.match(await page.textContent('#pm-sec-measure [data-dw-checked]'), /راجعها \u2068?صاحب الموقع/);
    await page.click('#pm-banner [data-pm-act="publish"]');
    await page.waitForFunction(() => !document.querySelector('#pm-banner'));
    assert.match(await page.textContent('#pm-ehead'), /على الموقع/);

    // New measurements: the form opens filled, the check is cleared.
    await page.click('#pm-sec-measure [data-pm-act="dw-remeasure"]');
    await page.waitForSelector('dialog.dw-dlg [data-dw-side] svg');
    assert.strictEqual(await page.inputValue('#dw-height'), '120');
    assert.strictEqual(await page.locator('dialog.dw-dlg #dw-id').count(), 0, 'no code or names when re-measuring');
    await page.fill('#dw-bandH', '١٠٠');
    await page.click('dialog.dw-dlg [data-dlg-ok]');
    await page.waitForSelector('dialog.dw-dlg', { state: 'detached' });
    await page.waitForSelector('#pm-sec-measure [data-dw-unchecked]');
    assert.match(await page.textContent('#pm-sec-measure'), /ارتفاعها ١٠٠ مم/);

    // The list: the badge, and no "New product from this" for it.
    await page.click('[data-pm-act="back"]');
    await page.waitForSelector('#pm-root .pm-row[data-id="tapered-tumbler"]');
    const row = page.locator('#pm-root .pm-row[data-id="tapered-tumbler"]');
    assert.match(await row.textContent(), /من المقاسات/);
    assert.strictEqual(await row.locator('[data-pm-act="copy"]').count(), 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('From measurements (English, phone): fits the screen, a mug with a handle, wrong boxes are said', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'en', 390, 844);
    const page = await signIn(ctx, srv.base);
    await openForm(page);
    const dlg = page.locator('dialog.dw-dlg');
    await page.check('dialog.dw-dlg input[name=kind][value=mug]');
    assert.strictEqual(await page.isChecked('dialog.dw-dlg input[name=handle][value=yes]'), true, 'a mug has a handle');
    assert.strictEqual(await page.isChecked('dialog.dw-dlg input[name=material][value=gloss]'), true);
    assert.strictEqual(await page.inputValue('#dw-id'), 'mug-2');
    await page.fill('#dw-height', '95');
    await page.fill('#dw-top', '82');
    await page.fill('#dw-bottom', '82');
    await page.fill('#dw-bandTop', '8');
    await page.fill('#dw-bandH', '80');
    await page.fill('#dw-hw', '1x');
    await page.waitForSelector('dialog.dw-dlg [data-dw-problems]:not([hidden])');
    assert.match(await dlg.locator('[data-dw-problems]').textContent(), /Handle width where it meets the cup: Type a number/);
    await page.fill('#dw-hw', '18');
    await page.fill('#dw-hy0', '15');
    await page.fill('#dw-hy1', '75');
    await page.waitForSelector('dialog.dw-dlg [data-dw-facts]');
    assert.match(await dlg.textContent(), /Straight cup: the print is a plain rectangle/);
    assert.ok(await dlg.locator('[data-dw-side] .dw-handle').count() === 1, 'the handle is drawn');
    // Nothing wider than the phone.
    const over = await page.evaluate(() => {
      const d = document.querySelector('dialog.dw-dlg');
      return { page: document.documentElement.scrollWidth - innerWidth, dlg: d.scrollWidth - d.clientWidth, right: d.getBoundingClientRect().right - innerWidth };
    });
    assert.ok(over.page <= 0 && over.dlg <= 1 && over.right <= 0, JSON.stringify(over));
    // Names missing: said, nothing sent.
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && /from-measurements$/.test(r.url())) posts += 1; });
    await page.click('dialog.dw-dlg [data-dlg-ok]');
    await page.waitForSelector('dialog.dw-dlg .pm-err:not([hidden])');
    assert.strictEqual(posts, 0);
    await page.fill('#dw-ar', 'مج الصباح');
    await page.fill('#dw-en', 'Morning mug');
    await page.click('dialog.dw-dlg [data-dlg-ok]');
    await page.waitForSelector('#pm-sec-measure');
    assert.match(await page.textContent('#pm-sec-measure'), /18 mm wide, 15–75 mm from the rim/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
