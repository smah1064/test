'use strict';

// "New product from photo", slice 2, in the browser: Products → New product → "From photos (cups, tumblers)".
// Fixture photos are ray-traced by test/helpers/synth-card.js: the card standing upright with a tapered tumbler
// (120 mm tall, Ø 90 → 65 mm) beside it in its plane, 1 m from a phone camera, with noise, as JPEG.
// The flow: the ruler check, the shot list (a good front, a too-dark side then a good one, a print-area photo whose
// card corner is covered so it is tapped by hand with the loupe), stopping and carrying on from the New product
// dialog, the measurements (photo within 2 % of the typed numbers; amber when not), the drawing, the hidden product,
// and the owner's overlay check with a nudge. Background removal is off here: the browser cuts the cup out itself.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

process.env.BG_REMOVAL = 'off';

// ---------- Fixture photos (test/helpers/synth-card.js: the card and a cup ray-traced through a pinhole camera) ----------
const { renderScene, cupTruth, toJpeg } = require('../helpers/synth-card');

const CUP = { axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 };
/**
 * A photo of the card standing upright with the tumbler beside it, 1 m away. opts: dark (multiply: too dark),
 * cover (a white sticker over the left part of the top-left corner square, so the card isn't found by itself).
 */
async function scene({ dark = 1, cover = false, seed = 7, camera } = {}) {
  const W = 2000;
  const H = 1500;
  const r = renderScene({ width: W, height: H, cup: CUP, noise: 2, seed, ...(camera ? { camera } : {}) });
  const d = r.img.data;
  if (dark !== 1) for (let i = 0; i < d.length; i += 4) { d[i] *= dark; d[i + 1] *= dark; d[i + 2] *= dark; }
  if (cover) {
    // The finder is 28 mm (about 80 px here): white over its left 40 %, its centre square left alone.
    const [fx, fy] = r.finders[0];
    const k = Math.hypot(r.finders[1][0] - fx, r.finders[1][1] - fy) / 160; // px per mm
    for (let y = Math.round(fy - 16 * k); y < fy + 16 * k; y++) {
      for (let x = Math.round(fx - 16 * k); x < fx - 3.5 * k; x++) {
        const i = (y * W + x) * 4;
        d[i] = 240; d[i + 1] = 238; d[i + 2] = 232;
      }
    }
  }
  return { jpg: await toJpeg(r.img, 90), W, H, finders: r.finders, truth: cupTruth(CUP) };
}

async function context(browser, lang, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: false });
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
async function openNew(page) {
  await page.click('[data-tab="products"]');
  await page.waitForSelector('#pm-root [data-pm-act="new"]');
  await page.click('#pm-root [data-pm-act="new"]');
  await page.waitForSelector('dialog [data-dlg-pp]');
}
/** English words left in a text (codes, units and file types aside). */
const englishIn = (s) => (s.match(/[A-Za-z]{2,}/g) || []).filter((w) => !['SVG', 'PDF'].includes(w));
const file = (name, jpg) => ({ name, mimeType: 'image/jpeg', buffer: jpg });
const badge = (page, v) => page.locator(`dialog.pp-dlg [data-pp-tile="${v}"] [data-pp-badge]`);
async function noOverflow(page, sel) {
  return page.evaluate((s) => {
    const d = document.querySelector(s);
    return { page: document.documentElement.scrollWidth - innerWidth, el: d ? d.scrollWidth - d.clientWidth : 0, right: d ? d.getBoundingClientRect().right - innerWidth : 0 };
  }, sel);
}

test('From photos (Arabic, iPad): card, shot list with retake and tapped corners, carry on, measurements, drawing, hidden product, overlay check', { timeout: 300000 }, async () => {
  const [front, dark, side, covered] = await Promise.all([
    scene(), scene({ dark: 0.13, seed: 3 }), scene({ seed: 11, camera: { pos: [210, 120, -1050], target: [210, 120, 0] } }), scene({ cover: true, seed: 5 }),
  ]);
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'ar', 820, 1180);
    const page = await signIn(ctx, srv.base);
    await openNew(page);
    assert.match(await page.textContent('dialog [data-dlg-pp]'), /من الصور/);
    await page.click('dialog [data-dlg-pp]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="start"]');
    const dlg = page.locator('dialog.pp-dlg');
    assert.strictEqual(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.deepStrictEqual(englishIn(await dlg.evaluate((d) => d.innerText)), [], 'the Arabic start page has no English left');
    assert.ok(await dlg.locator('.pp-diagram').count() >= 1, 'the set-up diagram');

    // The card downloads (a PDF).
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/photo-products/card.pdf')),
      page.click('dialog.pp-dlg [data-pp-card]'),
    ]);
    assert.strictEqual(res.status(), 200);
    assert.match(res.headers()['content-type'], /pdf/);

    // The ruler check: far off is refused; 99,5 (Arabic comma) is 99.5 %.
    await page.fill('#pp-ruler', '٨٠');
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg .pp-err:not([hidden])');
    assert.match(await dlg.locator('.pp-err').textContent(), /اطبع الكارت تاني/);
    await page.fill('#pp-ruler', '٩٩٫٥');
    assert.match(await dlg.locator('[data-pp-ruler-say]').textContent(), /٩٩٫٥%/);
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="shots"]');
    const sid = await page.evaluate(async () => {
      const r = await fetch('/api/admin/photo-products', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('pod-admin-token') } });
      return (await r.json()).shoots[0];
    });
    assert.strictEqual(sid.kind, 'tumbler');
    assert.strictEqual(sid.handle, false);

    // Eight tiles, each with its framing diagram; front needed.
    assert.strictEqual(await dlg.locator('[data-pp-tile]').count(), 8);
    assert.strictEqual(await dlg.locator('[data-pp-tile] .pp-diagram').count(), 8);
    assert.match(await dlg.locator('[data-pp-tile="front"] .pp-need').textContent(), /لازم/);
    // Next without a front photo: said.
    await page.click('dialog.pp-dlg [data-pp-next]');
    assert.match(await dlg.locator('.pp-err').textContent(), /صورة الوش/);

    // The front: found at once. The photo sent is a JPEG ≤ 3000 px.
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/shots\/\w+$/.test(r.url())) sent.push({ type: r.headers()['content-type'], url: r.url() }); });
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="front"]', file('front.jpg', front.jpg));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="front"] [data-pp-badge="ok"]', { timeout: 60000 });
    assert.match(await badge(page, 'front').textContent(), /الكارت باين/);
    assert.strictEqual(sent[0].type, 'image/jpeg');
    await page.waitForSelector('dialog.pp-dlg [data-pp-thumb="front"] img');

    // The side, too dark: retake, with the reason in words; then a good one.
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="side"]', file('side.jpg', dark.jpg));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="side"] [data-pp-badge="retake"]', { timeout: 60000 });
    assert.match(await badge(page, 'side').textContent(), /صوّر تاني: /);
    assert.ok(await dlg.locator('[data-pp-tap="side"]').count() === 1, 'tapping the corners is offered');
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="side"]', file('side.jpg', side.jpg));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="side"] [data-pp-badge="ok"]', { timeout: 60000 });

    // The print area: a corner square covered, so the card isn't found; tapped by hand with the loupe.
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="print"]', file('print.jpg', covered.jpg));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="print"] [data-pp-badge="retake"]', { timeout: 60000 });
    await page.click('dialog.pp-dlg [data-pp-tap="print"]');
    await page.waitForSelector('dialog.pp-tap-dlg canvas[data-pp-tapimg]');
    const tap = page.locator('dialog.pp-tap-dlg');
    assert.deepStrictEqual(englishIn(await tap.evaluate((d) => d.innerText)), []);
    const box = await tap.locator('canvas[data-pp-tapimg]').boundingBox();
    const at = ([x, y]) => [box.x + (x / covered.W) * box.width, box.y + (y / covered.H) * box.height];
    // A wrong tap, undone; the loupe shows under a pressed finger (a mouse held down and moved).
    const [wx, wy] = at([1200, 1200]);
    await page.mouse.click(wx, wy);
    assert.match(await tap.locator('[data-pp-count]').textContent(), /١ من ٤/);
    await page.click('dialog.pp-tap-dlg [data-pp-tundo]');
    const [ax, ay] = at(covered.finders[0]);
    await page.mouse.move(ax + 30, ay + 30);
    await page.mouse.down();
    await page.mouse.move(ax, ay, { steps: 4 });
    assert.strictEqual(await tap.locator('[data-pp-loupe]').isVisible(), true, 'the loupe shows while pressing');
    await page.mouse.up();
    assert.strictEqual(await tap.locator('[data-pp-loupe]').isVisible(), false);
    for (const p of covered.finders.slice(1)) { const [x, y] = at(p); await page.mouse.click(x, y); }
    assert.match(await tap.locator('[data-pp-count]').textContent(), /٤ من ٤/);
    await page.click('dialog.pp-tap-dlg [data-pp-tuse]');
    await page.waitForSelector('dialog.pp-tap-dlg', { state: 'detached' });
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="print"] [data-pp-badge="ok"]');
    assert.match(await badge(page, 'print').textContent(), /باليد/);
    assert.deepStrictEqual(englishIn(await dlg.evaluate((d) => d.innerText)), [], 'the Arabic shot list has no English left');

    // Stop here (everything is saved) and carry on from the New product dialog.
    await page.click('dialog.pp-dlg [data-pp-close]');
    await page.waitForSelector('dialog.pp-dlg', { state: 'detached' });
    await openNew(page);
    await page.waitForSelector(`dialog [data-pp-resume="${sid.id}"]`);
    await page.click(`dialog [data-pp-resume="${sid.id}"]`);
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="measure"]');

    // Measurements: the photo's numbers beside the typed ones (the front photo measured here: no server cut-out).
    await page.waitForSelector('dialog.pp-dlg [data-pp-photo="height"]', { timeout: 90000 });
    const photo = {};
    for (const k of ['height', 'top', 'bottom']) photo[k] = await dlg.locator(`[data-pp-photo="${k}"]`).textContent();
    const num = (s) => Number(s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace(/[^\d.]/g, ''));
    const want = { height: 120, top: 90, bottom: 65 };
    for (const k of Object.keys(want)) assert.ok(Math.abs(num(photo[k]) - want[k]) / want[k] < 0.02, `${k}: photo ${photo[k]} vs ${want[k]}`);
    await page.fill('#pp-m-height', '١٣٠');
    await page.waitForSelector('dialog.pp-dlg [data-pp-row="height"].is-warn');
    assert.strictEqual(await dlg.locator('[data-pp-diffwarn]').isVisible(), true);
    // "Use" copies the photo's number; typed back to the ruler's.
    await page.click('dialog.pp-dlg [data-pp-use="height"]');
    assert.ok(Math.abs(Number(await page.inputValue('#pp-m-height')) - 120) < 2.4);
    await page.fill('#pp-m-height', '120');
    await page.fill('#pp-m-top', '٩٠');
    await page.fill('#pp-m-bottom', '٦٥');
    await page.fill('#pp-m-bandTop', '١٠');
    await page.fill('#pp-m-bandH', '١٠٠');
    assert.strictEqual(await dlg.locator('.pp-mrow.is-warn').count(), 0, 'within 2 %');
    assert.strictEqual(await dlg.locator('[data-pp-diffwarn]').isVisible(), false);
    assert.deepStrictEqual(englishIn(await dlg.evaluate((d) => d.innerText)), [], 'the Arabic measurements have no English left');
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /photo-products\/[a-f0-9]{12}$/.test(r.url())) puts.push(JSON.parse(r.postData())); });
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="build"]');
    const put = puts.find((b) => b.typed);
    assert.deepStrictEqual(put.typed, { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 10, printHeightMm: 100, handle: null });
    assert.ok(put.measured && put.measured.profile.length >= 2 && put.measured.front.pxPerMm > 0, 'the photo measurements are saved');

    // The drawing: the straightened photo with the outline and the print band; the flat template.
    await page.waitForSelector('dialog.pp-dlg [data-pp-front-svg] .pp-o-outline');
    assert.strictEqual(await dlg.locator('[data-pp-front-svg] .pp-o-band').count(), 1);
    assert.match(await dlg.textContent(), /اتقصّت على الخلفية السادة/);
    assert.strictEqual(await page.isChecked('dialog.pp-dlg input[name=pp-material][value=metal]'), true);
    assert.deepStrictEqual(englishIn(await dlg.evaluate((d) => d.innerText)), [], 'the Arabic drawing step has no English left');
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="product"]', { timeout: 60000 });

    // The product.
    await page.fill('#pp-ar', 'تمبلر من الصور');
    await page.fill('#pp-en', 'Photo tumbler');
    await page.fill('#pp-id', 'photo-tumbler');
    await page.fill('#pp-price', '٤٢٠');
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('#pm-sec-measure [data-pp-overlay]', { timeout: 60000 });
    assert.match(await page.textContent('#pm-ehead'), /من الصور/);
    assert.match(await page.textContent('#pm-sec-measure'), /ارتفاع ١٢٠ مم/);

    // The owner's overlay check: outline, band and test grid over the photo; see-through slider; a nudge.
    await page.click('#pm-sec-measure [data-pp-overlay]');
    await page.waitForSelector('dialog.pp-ov-dlg [data-pp-ov-draw] .pp-o-outline');
    const ov = page.locator('dialog.pp-ov-dlg');
    assert.strictEqual(await ov.locator('.pp-o-band').count(), 1);
    assert.strictEqual(await ov.locator('.pp-o-grid').count(), 1);
    await page.waitForFunction(() => { const i = document.querySelector('dialog.pp-ov-dlg [data-pp-ov-img]'); return i && i.getBBox().width > 0; });
    const imgOk = await page.evaluate(async () => {
      const href = document.querySelector('dialog.pp-ov-dlg [data-pp-ov-img]').getAttribute('href');
      const r = await fetch(href);
      return { status: r.status, type: r.headers.get('content-type') };
    });
    assert.deepStrictEqual(imgOk, { status: 200, type: 'image/webp' });
    await ov.locator('[data-pp-opacity]').fill('40');
    assert.strictEqual(await ov.locator('[data-pp-ov-draw]').evaluate((g) => g.style.opacity), '0.4');
    await page.click('dialog.pp-ov-dlg [data-pp-nudge="axis+"]');
    assert.match(await ov.locator('[data-pp-moved]').textContent(), /النص ٠٫٥ مم/);
    assert.deepStrictEqual(englishIn(await ov.evaluate((d) => d.innerText)), [], 'the Arabic overlay check has no English left');
    const checks = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /drinkware\/check$/.test(r.url())) checks.push(JSON.parse(r.postData())); });
    await page.click('dialog.pp-ov-dlg [data-pp-ovok]');
    await page.waitForSelector('#pm-sec-measure [data-dw-checked]');
    assert.ok(checks[0] && checks[0].photo && checks[0].photo.axisXpx > 0 && checks[0].photo.pxPerMm > 0, JSON.stringify(checks[0]));
    // Then it can be shown on the site.
    await page.click('#pm-banner [data-pm-act="publish"]');
    await page.waitForFunction(() => !document.querySelector('#pm-banner'));
    // The session made its product: no longer offered to carry on.
    await page.click('[data-pm-act="back"]');
    await openNew(page);
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator(`dialog [data-pp-resume="${sid.id}"]`).count(), 0);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('From photos (English, phone): the steps fit the screen; a photo that isn\'t a picture is said; a mug\'s handle from the side photo', { timeout: 200000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await context(browser, 'en', 390, 844);
    const page = await signIn(ctx, srv.base);
    await openNew(page);
    await page.click('dialog [data-dlg-pp]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="start"]');
    await page.check('dialog.pp-dlg input[name=pp-kind][value=mug]');
    assert.strictEqual(await page.isChecked('dialog.pp-dlg input[name=pp-handle][value=yes]'), true, 'a mug has a handle');
    let over = await noOverflow(page, 'dialog.pp-dlg');
    assert.ok(over.page <= 0 && over.el <= 1 && over.right <= 0, JSON.stringify(over));
    await page.fill('#pp-ruler', '100');
    assert.match(await page.textContent('dialog.pp-dlg [data-pp-ruler-say]'), /right size/);
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="shots"]');
    // A mug: the side photo is needed too.
    assert.match(await page.textContent('dialog.pp-dlg [data-pp-tile="side"] .pp-need'), /Needed/);
    over = await noOverflow(page, 'dialog.pp-dlg');
    assert.ok(over.page <= 0 && over.el <= 1 && over.right <= 0, JSON.stringify(over));
    // The capture input asks for the camera.
    assert.strictEqual(await page.getAttribute('dialog.pp-dlg [data-pp-file="front"]', 'capture'), 'environment');
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="front"]', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a picture at all') });
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="front"] [data-pp-badge="fail"]');
    assert.match(await page.textContent('dialog.pp-dlg [data-pp-tile="front"] [data-pp-badge]'), /isn't a photo/);
    // Back to the start: the kind is fixed now.
    await page.click('dialog.pp-dlg [data-pp-back]');
    assert.strictEqual(await page.isDisabled('dialog.pp-dlg input[name=pp-kind][value=tumbler]'), true);
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-body][data-step="shots"]');

    // A mug: the front (handle behind), the side with the handle showing; its sizes come from the side photo.
    const mug = { axisX: 290, heightMm: 95, topDiaMm: 82, bottomDiaMm: 82 };
    const [mf, ms] = [renderScene({ width: 2000, height: 1500, cup: mug, noise: 2, seed: 2 }), renderScene({ width: 2000, height: 1500, cup: { ...mug, handle: { y0Mm: 15, y1Mm: 75, reachMm: 25, side: 1 } }, noise: 2, seed: 4 })];
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="front"]', file('front.jpg', await toJpeg(mf.img, 90)));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="front"] [data-pp-badge="ok"]', { timeout: 60000 });
    await page.click('dialog.pp-dlg [data-pp-next]');
    assert.match(await page.textContent('dialog.pp-dlg .pp-err'), /side photo/);
    await page.setInputFiles('dialog.pp-dlg [data-pp-file="side"]', file('side.jpg', await toJpeg(ms.img, 90)));
    await page.waitForSelector('dialog.pp-dlg [data-pp-tile="side"] [data-pp-badge="ok"]', { timeout: 60000 });
    await page.click('dialog.pp-dlg [data-pp-next]');
    await page.waitForSelector('dialog.pp-dlg [data-pp-photo="hw"]', { timeout: 90000 });
    const hy0 = Number(await page.inputValue('#pp-m-hy0'));
    const hy1 = Number(await page.inputValue('#pp-m-hy1'));
    assert.ok(Math.abs(hy0 - 15) <= 3 && Math.abs(hy1 - 75) <= 3, `handle ${hy0}–${hy1} mm`);
    assert.ok(Number(await page.inputValue('#pp-m-hw')) > 10, 'the handle reach from the side photo');
    over = await noOverflow(page, 'dialog.pp-dlg');
    assert.ok(over.page <= 0 && over.el <= 1 && over.right <= 0, JSON.stringify(over));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
