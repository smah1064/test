'use strict';

// Tester 2's run at 11 am Cairo (26 Nov), in the browser: a ready design's one-colour drawing takes its white copy on a
// dark colour (and back, and after Undo); quantities typed for several sizes follow a new colour, and a new product;
// taking out the shown colour's row shows a colour still ordered; an emptied text is no printed side; words coloured
// one by one count in the checks; the booklet check chip counts the blank pages; sideways text isn't made smaller
// while it fits; text made smaller to fit still grows back after Undo and Redo; a {field} chip doesn't stack a copy.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

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
const addText = (page, text, opts = {}) => page.evaluate(([s, o]) => {
  const ed = window.__editor;
  const a = (ed.st.product.sides.find((x) => x.id === ed.st.side) || ed.st.product.sides[0]).printArea;
  const t = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000', ...o });
  ed.canvas.add(t);
  ed.canvas.setActiveObject(t);
  ed.canvas.fire('object:modified', { target: t });
}, [text, opts]);
const keys = (page) => page.evaluate(() => window.__editor.checkIssues().map((i) => i.key));
const typeQty = async (page, c, z, n) => {
  const box = page.locator(`#qty-field .qty-in[data-qc="${c}"][data-qz="${z}"]`);
  await box.fill(String(n));
  await box.dispatchEvent('change');
  await page.waitForTimeout(150);
};

test('a ready drawing (Noel): white copy on black, kept after Undo, the normal copy back on white', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&library=xm-noel&color=white&size=M');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.artSrc), null, { timeout: 30000 });
    const art = () => page.evaluate(() => {
      const o = window.__editor.canvas.getObjects().find((x) => x.artSrc);
      return { light: o.artLight, fills: [...new Set((o._objects || [o]).map((x) => String(x.fill).toLowerCase()))], w: Math.round(o.getScaledWidth()), x: Math.round(o.left) };
    });
    const before = await art();
    assert.strictEqual(before.light, false);
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.artSrc && o.artLight), null, { timeout: 10000 });
    const dark = await art();
    assert.deepStrictEqual(dark.fills, ['#ffffff'], 'the white copy');
    assert.deepStrictEqual([dark.w, dark.x], [before.w, before.x], 'same size and place');
    assert.ok(!(await keys(page)).includes('check.inkOnColour'));
    await page.click('#undo');
    await page.waitForTimeout(600);
    assert.strictEqual((await art()).light, true, 'still the white copy after Undo');
    await page.click('#swatches [data-color="white"]');
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.artSrc && !o.artLight), null, { timeout: 10000 });
    assert.deepStrictEqual((await art()).fills, before.fills);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a one-colour drawing that would vanish on the shirt is said in the check', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=black&size=M');
    await page.evaluate(() => {
      const ed = window.__editor;
      const a = ed.st.product.sides[0].printArea;
      const g = new fabric.Group([new fabric.Rect({ width: 60, height: 60, fill: '#111111' }), new fabric.Circle({ radius: 30, left: 70, fill: '#111111' })], { left: a.x + 40, top: a.y + 40 });
      ed.canvas.add(g);
      ed.canvas.fire('object:modified', { target: g });
    });
    assert.ok((await keys(page)).includes('check.inkOnColour'));
  } finally {
    await ctx.close();
  }
});

test('quantities: White M 3 + L 2, then Black: the whole row follows; taking out the shown colour shows the other', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'TEAM');
    await page.waitForSelector('#qty-field .qty-in[data-qc="white"][data-qz="L"]', { timeout: 15000 });
    await typeQty(page, 'white', 'M', 3);
    await typeQty(page, 'white', 'L', 2);
    await page.click('#swatches [data-color="black"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'black');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await page.evaluate(() => window.__editor.st.qty), { black: { M: 3, L: 2 } });
    // Navy too, then the shown colour's row taken out: the shirt shows Navy.
    await page.selectOption('#qty-add', 'navy');
    await page.waitForSelector('#qty-field .qty-in[data-qc="navy"][data-qz="L"]');
    await typeQty(page, 'navy', 'L', 4);
    await page.click('[data-qdel="black"]');
    await page.waitForFunction(() => window.__editor.st.colorId === 'navy', null, { timeout: 5000 });
    assert.deepStrictEqual(Object.keys(await page.evaluate(() => window.__editor.st.qty)), ['navy']);
    assert.strictEqual(await page.evaluate(() => window.__editor.st.qty.navy.L), 4);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('T-shirt White M 2 + L 3, then Hoodie (no white): the 5 pieces follow to the hoodie\'s colour', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    await page.goto(`${srv.base}/editor?product=tshirt&color=white&size=M`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
    await addText(page, 'TEAM');
    await page.waitForSelector('#qty-field .qty-in[data-qc="white"][data-qz="L"]', { timeout: 15000 });
    await typeQty(page, 'white', 'M', 2);
    await typeQty(page, 'white', 'L', 3);
    await page.selectOption('#product-select', 'hoodie');
    await page.waitForFunction(() => window.__editor.st.product.id === 'hoodie', null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const q = await page.evaluate(() => ({ colour: window.__editor.st.colorId, qty: window.__editor.st.qty }));
    assert.deepStrictEqual(q.qty, { [q.colour]: { M: 2, L: 3 } });
  } finally {
    await ctx.close();
  }
});

test('an emptied text on the back: not a printed side, not priced', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await addText(page, 'FRONT');
    await page.waitForTimeout(300);
    const front = await page.textContent('#price');
    await page.evaluate(() => document.querySelector('[data-side="back"]').click());
    await page.waitForFunction(() => window.__editor.st.side === 'back');
    await addText(page, 'BACK');
    await page.waitForTimeout(300);
    assert.notStrictEqual(await page.textContent('#price'), front, 'the back costs more while it says something');
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', '   ');
    await page.waitForTimeout(400);
    assert.strictEqual(await page.textContent('#price'), front, 'an emptied text costs nothing');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('words coloured one by one: 7 threads on an embroidered cap, one near-black word on a black shirt', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    let page = await openEditor(ctx, srv.base, 'cap', '&method=embroidery');
    await addText(page, 'a b c d e f g', { fontSize: 60, fill: '#d0202a' });
    await page.evaluate(() => {
      const o = window.__editor.canvas.getActiveObject();
      ['#111111', '#1b2550', '#0ca678', '#f59f00', '#7048e8', '#e64980', '#868e96'].forEach((c, i) => o.setSelectionStyles({ fill: c }, i * 2, i * 2 + 1));
      window.__editor.canvas.fire('object:modified', { target: o });
    });
    assert.ok((await keys(page)).includes('check.embColorsN'), 'more than 6 threads');
    page = await openEditor(ctx, srv.base, 'tshirt', '&color=black&size=M');
    await addText(page, 'Happy Birthday Ahmed', { fill: '#ffffff' });
    assert.ok(!(await keys(page)).includes('check.inkOnColour'));
    await page.evaluate(() => {
      const o = window.__editor.canvas.getActiveObject();
      o.setSelectionStyles({ fill: '#111111' }, 15, 20);
      window.__editor.canvas.fire('object:modified', { target: o });
    });
    assert.ok((await keys(page)).includes('check.inkOnColour'), 'the dark word is said');
  } finally {
    await ctx.close();
  }
});

test('booklet with the sample text on its cover: the chip counts the blank pages too', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'booklets');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForFunction(() => /blank/.test(document.getElementById('check-list').textContent), null, { timeout: 10000 });
    const items = await page.locator('#check-list li').count();
    assert.match(await page.textContent('#check-chip'), new RegExp(`${items} to check`));
  } finally {
    await ctx.close();
  }
});

test('sideways text on a phone case isn\'t made smaller while it fits; a fitted text grows back after Undo and Redo', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    let page = await openEditor(ctx, srv.base, 'phonecase');
    await addText(page, 'CASE', { angle: 90, fontSize: 30 });
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', 'CASE MY PHONE');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getActiveObject().scaleX), 1);

    page = await openEditor(ctx, srv.base, 'mug');
    await addText(page, 'Hi');
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', 'A long line for the mug that will not fit at this size at all, no way');
    await page.waitForTimeout(300);
    assert.ok((await page.evaluate(() => window.__editor.canvas.getActiveObject().scaleX)) < 1);
    await page.click('#undo');
    await page.waitForTimeout(400);
    await page.click('#redo');
    await page.waitForTimeout(400);
    await page.evaluate(() => { const ed = window.__editor; ed.canvas.setActiveObject(ed.canvas.getObjects()[0]); ed.canvas.fire('selection:created', { selected: [ed.canvas.getObjects()[0]] }); });
    await page.waitForSelector('#p-text');
    await page.fill('#p-text', 'أب');
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await page.evaluate(() => window.__editor.canvas.getObjects()[0].scaleX)) - 1) < 1e-6, 'its own size again');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('360px phone: the sample-text note never covers the new text or its handles', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white&size=M');
    await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const note = document.getElementById('sample-note');
      if (!note || note.hidden) return { hidden: true };
      const ed = window.__editor;
      const o = ed.canvas.getObjects()[0];
      const cr = ed.canvas.upperCanvasEl.getBoundingClientRect();
      const br = o.getBoundingRect();
      const n = note.getBoundingClientRect();
      return { hidden: false, noteTop: n.top, noteBottom: n.bottom, objTop: cr.top + br.top - 50, objBottom: cr.top + br.top + br.height + 10 };
    });
    if (!r.hidden) assert.ok(r.noteBottom <= r.objTop || r.noteTop >= r.objBottom, JSON.stringify(r));
  } finally {
    await ctx.close();
  }
});
