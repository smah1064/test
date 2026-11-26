'use strict';

// A name list's names are customers' data (owner's OK, 26 Nov, from the security review): the cart item keeps the
// list's key, so "Edit" from the cart brings the names back; the design's id alone (in public picture links) doesn't,
// and the editor then asks for the list again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test('name list: the cart item keeps its key; reopened from the cart the names are back, by id alone they aren\'t', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-names-'));
  const csv = path.join(dir, 'names.csv');
  fs.writeFileSync(csv, 'Name\nAli Hassan\nMona Adel\n');
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    await page.goto(`${srv.base}/editor?product=greetingcard`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
    await page.setInputFiles('#merge-file', csv);
    await page.waitForFunction(() => window.__editor.st.mergeList && window.__editor.st.mergeList.rows.length === 2, null, { timeout: 15000 });
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const item = await page.evaluate(() => POD.getCart()[0]);
    assert.ok(item && item.merge && item.merge.count === 2, JSON.stringify(item));
    assert.match(item.listKey || '', /^[A-Za-z0-9_-]{20,40}$/, 'the key is kept with the cart item');
    // "Edit" from the cart: the names are there.
    await page.goto(`${srv.base}/editor?design=${item.designId}&cart=0`);
    await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.mergeList, null, { timeout: 30000 });
    assert.deepStrictEqual(await page.evaluate(() => window.__editor.st.mergeList.rows.map((r) => r[0])), ['Ali Hassan', 'Mona Adel']);
    // Another browser with only the design's id: no names, and the editor says to upload the list again.
    const other = await newContext(browser);
    try {
      const p2 = await other.newPage();
      await p2.goto(`${srv.base}/editor?design=${item.designId}`);
      await p2.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product && window.__editor.st.product.id === 'greetingcard', null, { timeout: 30000 });
      await p2.waitForSelector('#toast-root .toast.error', { timeout: 5000 });
      assert.match(await p2.textContent('#toast-root .toast.error'), /name list/i);
      assert.strictEqual(await p2.evaluate(() => window.__editor.st.mergeList), null);
      const r = await (await fetch(`${srv.base}/api/designs/${item.designId}`)).json();
      assert.ok(!JSON.stringify(r).includes('Ali Hassan'));
    } finally {
      await other.close();
    }
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
