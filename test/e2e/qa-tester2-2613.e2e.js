'use strict';

// Tester 2 (11 pm Cairo, 26 Nov), in the browser: a phone case's design went on a T-shirt's back (its one side is
// called "back"); a colour chosen on a ready design's page was ignored once that design had been opened before; white
// words on their own pill were "hard to see on White"; the zoom buttons stayed clickable at 800% and 50%; the size
// table showed 0 while the order stayed at one piece; four of the shop's Christmas cards opened with "5 pt" text.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor, openQtyTable } = require('./helpers');

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

async function addText(page) {
  await page.click('.tools [data-flyout="text"]');
  if (await page.isVisible('#flyout-text')) await page.locator('#text-presets button').first().click();
  await page.waitForSelector('#p-text');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(300);
}
const sides = (page) => page.evaluate(() => {
  const { st } = window.__editor;
  return { side: st.side, filled: Object.entries(st.designs).filter(([, o]) => (o || []).length).map(([k]) => k).sort() };
});
const inkWarnings = (page) => page.evaluate(() => window.__editor.checkIssues().filter((i) => i.key === 'check.inkOnColour').length);

test('a phone case\'s design goes on the front of a T-shirt, tote or notebook, and that side is shown', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'phonecase');
    await addText(page);
    assert.deepStrictEqual(await sides(page), { side: 'back', filled: ['back'] });
    for (const id of ['tshirt', 'phonecase', 'tote', 'phonecase', 'notebook']) {
      await page.selectOption('#product-select', id);
      await page.waitForFunction((p) => window.__editor.st.product.id === p, id);
      await page.waitForTimeout(400);
      const want = id === 'phonecase' ? 'back' : 'front';
      assert.deepStrictEqual(await sides(page), { side: want, filled: [want] }, id);
    }
    assert.deepStrictEqual(page.errors, []);
    // A two-sided product keeps its sides by name: a T-shirt's back stays the tote's back.
    const shirt = await openEditor(ctx, srv.base, 'tshirt');
    await shirt.click('#side-tabs [data-side="back"]');
    await shirt.waitForFunction(() => window.__editor.st.side === 'back');
    await addText(shirt);
    await shirt.selectOption('#product-select', 'tote');
    await shirt.waitForFunction(() => window.__editor.st.product.id === 'tote');
    await shirt.waitForTimeout(400);
    assert.deepStrictEqual(await sides(shirt), { side: 'back', filled: ['back'] });
    assert.deepStrictEqual(shirt.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a ready design opened before follows the colour on its page; one recoloured in the editor keeps its colour', { timeout: 150000 }, async () => {
  const ctx = await newContext(browser);
  const startFromPage = async (page, colour) => {
    await page.goto(`${srv.base}/design?id=st-gaming-lvl-99`);
    await page.waitForSelector('#dp-edit[href]');
    if (colour) {
      await page.click(`.dp-colors [data-color="${colour}"], [data-color="${colour}"]`);
      await page.waitForFunction((c) => new RegExp(`color=${c}`).test(document.getElementById('dp-edit').href) && /pick=1/.test(document.getElementById('dp-edit').href), colour);
    } else assert.doesNotMatch(await page.getAttribute('#dp-edit', 'href'), /pick=1/);
    await page.click('#dp-edit');
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    return page.evaluate(() => window.__editor.st.colorId);
  };
  try {
    // Opened once on white, nothing changed: kept on this device as the customer's copy.
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=st-gaming-lvl-99&color=white');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length > 0);
    await page.waitForTimeout(1500);
    const shown = await (async () => { await page.goto(`${srv.base}/design?id=st-gaming-lvl-99`); await page.waitForSelector('#dp-edit[href]'); return /color=([a-z]+)/.exec(await page.getAttribute('#dp-edit', 'href'))[1]; })();
    assert.notStrictEqual(shown, 'white');
    // The design's page shows its own colour: the editor opens in it (it opened on white).
    assert.strictEqual(await startFromPage(page), shown);
    assert.doesNotMatch(page.url(), /pick=|color=/, 'used once');
    // Recoloured in the editor: that colour is the customer's, kept when started again from the page as it shows.
    await page.click('#swatches [data-color="red"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'red');
    await page.evaluate(() => window.__editor.canvas.fire('object:modified'));
    await page.waitForTimeout(1500);
    assert.strictEqual(await startFromPage(page), 'red');
    // A colour chosen on the page just now wins over it.
    assert.strictEqual(await startFromPage(page, 'navy'), 'navy');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('words on their own pill, or on a shape, are not "hard to see" on the garment; on the garment they still are', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    // The shop's own card: white words on their own pink pill, on a white card.
    let page = await openEditor(ctx, srv.base, 'greetingcard', '&library=ce-big-sister&color=white');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length > 0);
    await page.waitForTimeout(800);
    assert.strictEqual(await inkWarnings(page), 0);
    await page.close();
    page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await addText(page);
    await page.evaluate(() => { const o = window.__editor.canvas.getObjects()[0]; o.set({ fill: '#ffffff' }); window.__editor.canvas.requestRenderAll(); });
    assert.strictEqual(await inkWarnings(page), 1, 'white words straight on a white shirt');
    // A navy panel under them.
    await page.evaluate(() => {
      const { canvas } = window.__editor;
      const o = canvas.getObjects()[0];
      const r = new fabric.Rect({ left: o.left, top: o.top, originX: o.originX, originY: o.originY, width: o.getScaledWidth() * 1.4, height: o.getScaledHeight() * 1.6, fill: '#1b2a4a' });
      canvas.insertAt(r, 0);
    });
    assert.strictEqual(await inkWarnings(page), 0, 'on a navy panel');
    // Their own background colour instead.
    await page.evaluate(() => { const { canvas } = window.__editor; canvas.remove(canvas.getObjects()[0]); canvas.getObjects()[0].set({ backgroundColor: '#e64980' }); });
    assert.strictEqual(await inkWarnings(page), 0, 'on their own pink pill');
    // An outline-only frame round them is not a surface.
    await page.evaluate(() => {
      const { canvas } = window.__editor;
      const o = canvas.getObjects()[0];
      o.set({ backgroundColor: '' });
      canvas.insertAt(new fabric.Rect({ left: o.left, top: o.top, originX: o.originX, originY: o.originY, width: o.getScaledWidth() * 1.4, height: o.getScaledHeight() * 1.6, fill: 'transparent', stroke: '#000', strokeWidth: 3 }), 0);
    });
    assert.strictEqual(await inkWarnings(page), 1, 'inside an outline frame, on the shirt');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('zoom: + is off at 800% and − at 50%', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt');
    assert.strictEqual(await page.isDisabled('#zoom-in'), false);
    for (let i = 0; i < 14 && !(await page.isDisabled('#zoom-in')); i++) await page.click('#zoom-in');
    assert.strictEqual(await page.isDisabled('#zoom-in'), true);
    assert.match(await page.textContent('#zoom-label'), /^800%$/);
    assert.strictEqual(await page.isDisabled('#zoom-out'), false);
    for (let i = 0; i < 20 && !(await page.isDisabled('#zoom-out')); i++) await page.click('#zoom-out');
    assert.strictEqual(await page.isDisabled('#zoom-out'), true);
    assert.match(await page.textContent('#zoom-label'), /^50%$/);
    assert.strictEqual(await page.isDisabled('#zoom-in'), false);
    await page.click('#zoom-fit');
    assert.strictEqual(await page.isDisabled('#zoom-out'), false);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('size table: 0, letters or nothing in the only box shows the 1 piece that is ordered', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&size=M');
    await openQtyTable(page);
    const box = '#qty-field .qty-in[data-qz="M"]';
    for (const typed of ['0', 'abc', '']) {
      await page.fill(box, typed);
      await page.press(box, 'Tab');
      await page.waitForTimeout(300);
      // (The table may be drawn again once the focus leaves it.)
      assert.strictEqual(await page.inputValue(box), '1', JSON.stringify(typed));
      assert.strictEqual(await page.evaluate(() => Object.values(window.__editor.st.qty || {}).reduce((n, row) => n + Object.values(row).reduce((a, b) => a + b, 0), 0)), 1);
    }
    // A real number stays as typed.
    await page.fill(box, '3');
    await page.press(box, 'Tab');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.inputValue(box), '3');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('the shop\'s Christmas cards open on the A6 card without a "very small text" warning', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    for (const id of ['xm-card-mailbox', 'xm-card-stocking', 'xm-card-tree', 'xm-card-hot-chocolate']) {
      const page = await openEditor(ctx, srv.base, 'greetingcard', `&library=${id}&color=white&size=A6`);
      await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.text && o.text.startsWith('MAY')), null, { timeout: 30000 });
      await page.waitForTimeout(600);
      const tiny = await page.evaluate(() => window.__editor.checkIssues().filter((i) => i.key === 'check.tiny').map((i) => i.params));
      assert.deepStrictEqual(tiny, [], id);
      // The wish stays inside the card's gold frame (the middle 90% of its width).
      const fits = await page.evaluate(() => {
        const { canvas } = window.__editor;
        const wish = canvas.getObjects().find((o) => o.text && o.text.startsWith('MAY'));
        const art = canvas.getObjects().find((o) => o.type === 'image');
        const w = wish.getBoundingRect(true);
        const a = art.getBoundingRect(true);
        return w.left >= a.left + a.width * 0.05 && w.left + w.width <= a.left + a.width * 0.95;
      });
      assert.ok(fits, id);
      assert.deepStrictEqual(page.errors, []);
      await page.close();
    }
  } finally {
    await ctx.close();
  }
});
