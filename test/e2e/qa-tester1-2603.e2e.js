'use strict';

// Tester 1's run at 4 am Cairo (26 Nov), in the browser: a ready design added from a share link opens on its page;
// Arabic typed in an English-only font gets an Arabic font of the same feel; ↑ after the print area went as low as it
// goes is the standard spot; a quantity over 1,000 is said; typing after a double-click replaces the whole sample;
// switching product asks before a side's design is dropped; one word can be made bold.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');
const { Library } = require('../../src/library');

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

const addText = async (page, text) => {
  await page.evaluate((s) => {
    const ed = window.__editor;
    const a = ed.st.product.sides[0].printArea;
    const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000', fontFamily: 'Montserrat' });
    ed.canvas.add(o);
    ed.canvas.setActiveObject(o);
    ed.canvas.requestRenderAll();
  }, text);
};

test('a ready design added from a share link opens on its own page', { timeout: 60000 }, async () => {
  const lib = new Library(srv.dataDir);
  const meta = lib.addCustom({
    name: { ar: 'تجربة', en: 'Share test' }, category: 'text', product: 'tshirt', color: 'white',
    objects: [{ type: 'i-text', version: '5.3.0', left: 120, top: 120, width: 200, height: 45, fontSize: 40, text: 'Hello', fontFamily: 'Montserrat', fill: '#000000' }],
    area: { x: 100, y: 100, w: 300, h: 380 },
  });
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/design?id=${meta.id}`);
    await page.waitForFunction(() => !document.getElementById('dp-missing').hidden || document.querySelector('#dp-products, .dp-products, [data-dp-product]'), null, { timeout: 20000 });
    assert.strictEqual(await page.isHidden('#dp-missing'), true, '"this design isn\'t available" is not shown');
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('Arabic typed in Lilita One becomes Lalezar (not plain Cairo)', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'ARGUING');
    await page.evaluate(() => { const o = window.__editor.canvas.getActiveObject(); o.set({ fontFamily: 'Lilita One' }); });
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', 'نقاش');
    await page.waitForFunction(() => window.__editor.canvas.getActiveObject().fontFamily !== 'Lilita One', null, { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().fontFamily), 'Lalezar');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('hoodie: ↓ as far as it goes, then ↑ is the standard spot', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie', '&color=white&size=M');
    await addText(page, 'HI');
    await page.waitForSelector('#place-field:not([hidden])', { timeout: 15000 });
    for (let i = 0; i < 6; i++) await page.evaluate(() => document.querySelector('[data-nudge="0,1"]').click());
    const low = await page.textContent('#place-info');
    assert.match(low, /lower/, low);
    await page.evaluate(() => document.querySelector('[data-nudge="0,-1"]').click());
    const info = await page.textContent('#place-info');
    // A whole cm higher than where it was, or the standard spot: never past it.
    const lowCm = Number((low.match(/([\d.]+) cm lower/) || [])[1]);
    if (lowCm < 1) assert.strictEqual(info.trim(), 'Standard position', `${low} → ${info}`);
    else assert.doesNotMatch(info, /higher/, `${low} → ${info}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('typing after a double-click on a new sample text replaces all of it', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 1);
    const sample = await page.evaluate(() => window.__editor.canvas.getObjects()[0].text);
    assert.ok(/\s/.test(sample), `a sample of several words (${sample})`);
    const at = await page.evaluate(() => {
      const ed = window.__editor;
      const o = ed.canvas.getObjects()[0];
      const r = ed.canvas.upperCanvasEl.getBoundingClientRect();
      const p = fabric.util.transformPoint(o.getCenterPoint(), ed.canvas.viewportTransform);
      // The last word of the sample (right of the centre).
      return { x: r.left + p.x + (o.getScaledWidth() * ed.canvas.getZoom()) / 4, y: r.top + p.y };
    });
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(() => window.__editor.canvas.getObjects()[0].isEditing, null, { timeout: 5000 });
    await page.keyboard.type('Hello');
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getObjects()[0].text), 'Hello');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a quantity over 1,000 is put back to 1,000 and said', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'TEAM');
    await page.waitForSelector('#qty-field .qty-in', { timeout: 15000 });
    const box = page.locator('#qty-field .qty-in').first();
    await box.fill('5000');
    await box.dispatchEvent('change');
    await page.waitForSelector('#toast-root .toast.error', { timeout: 5000 });
    assert.match(await page.textContent('#toast-root .toast.error'), /1,000/);
    assert.strictEqual(await box.inputValue(), '1000');
  } finally {
    await ctx.close();
  }
});

test('switching to a product with no room for the back: asked first; "Cancel" keeps the T-shirt and its back', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const asked = [];
  let answer = false;
  page.on('dialog', (d) => { asked.push(d.message()); (answer ? d.accept() : d.dismiss()).catch(() => {}); });
  try {
    await page.goto(`${srv.base}/editor?product=tshirt&color=white&size=M`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
    await addText(page, 'FRONT');
    await page.evaluate(() => window.__editor.st.designs && window.__editor.canvas.fire('object:modified'));
    // A design on the back too.
    await page.evaluate(() => document.querySelector('[data-side="back"]').click());
    await page.waitForFunction(() => window.__editor.st.side === 'back');
    await addText(page, 'BACK');
    await page.evaluate(() => window.__editor.canvas.fire('object:modified'));
    await page.selectOption('#product-select', 'mug');
    await page.waitForTimeout(800);
    assert.strictEqual(asked.length, 1, 'asked once');
    assert.strictEqual(await page.evaluate(() => window.__editor.st.product.id), 'tshirt', 'still the T-shirt');
    assert.strictEqual(await page.inputValue('#product-select'), 'tshirt');
    answer = true;
    await page.selectOption('#product-select', 'mug');
    await page.waitForFunction(() => window.__editor.st.product.id === 'mug', null, { timeout: 15000 });
  } finally {
    await ctx.close();
  }
});

test('one word made bold (B next to the chosen word): only that word', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'Hello World');
    await page.waitForSelector('.word-chip[data-word="1"]', { timeout: 15000 });
    await page.click('.word-chip[data-word="1"]');
    await page.waitForSelector('[data-act="word-bold"]');
    await page.click('[data-act="word-bold"]');
    await page.waitForFunction(() => {
      const o = window.__editor.canvas.getActiveObject() || window.__editor.canvas.getObjects()[0];
      return o.getSelectionStyles(6, 11).every((s) => s.fontWeight === 'bold');
    }, null, { timeout: 5000 });
    const first = await page.evaluate(() => window.__editor.canvas.getObjects()[0].getSelectionStyles(0, 5).map((s) => s.fontWeight || null));
    assert.ok(first.every((w) => w !== 'bold'), `"Hello" stays as it was (${first})`);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getObjects()[0].fontWeight), 'normal');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a ready design\'s near-black words take the light ink on a black T-shirt (the sloths, the coffee animals)', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=sq-error-404-sloth-beanie&color=black&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.text && /ERROR/.test(o.text)), null, { timeout: 30000 });
    const fills = await page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text && /ERROR|NOT FOUND/.test(o.text)).map((o) => String(o.fill).toLowerCase()));
    assert.ok(fills.length >= 2, String(fills));
    assert.ok(fills.every((f) => f !== '#111111'), `light on black: ${fills}`);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
