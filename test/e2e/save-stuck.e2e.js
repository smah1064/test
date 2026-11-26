'use strict';

// Owner, 26 Nov: "Save" kept showing "Saving the design…" for over 2 minutes (a poster with a ready design, on
// Firefox). Whatever the browser's storage does, the cover goes, the customer is told, and the next save works.
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
const addText = (page, text) => page.evaluate((s) => {
  const ed = window.__editor;
  const a = ed.st.product.sides[0].printArea;
  const o = new fabric.IText(s, { left: a.x + a.w / 2, top: a.y + a.h / 2, originX: 'center', originY: 'center', fontSize: 40, fill: '#000' });
  ed.canvas.add(o);
  ed.canvas.fire('object:modified', { target: o });
}, text);
const coverShown = (page) => page.evaluate(() => !document.getElementById('busy').hidden);

test('the storage never answers, then refuses: "Saving…" goes each time, the customer is told; then it saves again', { timeout: 150000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'poster', '&library=xm-trees-holly-plaid');
    await addText(page, 'sherif');
    await page.waitForTimeout(1500); // (the save a moment after the change)
    // 1. The browser's storage never answers.
    await page.evaluate(() => { window.__realSet = POD.drafts.set; POD.drafts.set = () => new Promise(() => {}); });
    await page.evaluate(() => document.getElementById('save-draft').click());
    await page.waitForFunction(() => !document.getElementById('busy').hidden, null, { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 70000 });
    assert.match(await page.textContent('#toast-root, .toast-wrap, body'), /Could not save the design on this device/);
    // 2. It refuses straight away (an error inside the save).
    await page.evaluate(() => { POD.drafts.set = () => Promise.reject(new Error('QuotaExceededError')); });
    await page.evaluate(() => document.getElementById('save-draft').click());
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 10000 });
    assert.strictEqual(await coverShown(page), false);
    // 3. Storage back: the next save works (the failed ones don't hold it up).
    await page.evaluate(() => { POD.drafts.set = window.__realSet; });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('save-draft').click());
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => /Saved/.test(document.body.textContent), null, { timeout: 10000 });
    const saved = await page.evaluate(async () => { const d = await POD.drafts.get('poster'); return d && Object.values(d.designs).flat().some((o) => o.text === 'sherif'); });
    assert.strictEqual(saved, true, 'kept on this device');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('an error in any queued editor step never leaves the cover on the page', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    await addText(page, 'MUG');
    await page.waitForTimeout(1200);
    // The save's own picture step throws.
    await page.evaluate(() => { window.__realSet = POD.drafts.set; POD.drafts.set = () => { throw new Error('boom'); }; });
    await page.evaluate(() => document.getElementById('save-draft').click());
    await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 10000 });
    assert.strictEqual(await coverShown(page), false);
  } finally {
    await ctx.close();
  }
});
