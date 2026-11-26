'use strict';

// Tester 2's run at 3 am Cairo (26 Nov), in the browser: a cart holding only a kids book doesn't give the editor's
// advice (edit quantities, duplicate a design, the "Print colours" view).
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

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

async function bookInCart(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 500;
    const g = c.getContext('2d');
    g.fillStyle = '#9ab';
    g.fillRect(0, 0, 400, 500);
    g.fillStyle = '#e8b996';
    g.beginPath();
    g.ellipse(200, 220, 110, 150, 0, 0, Math.PI * 2);
    g.fill();
    const face = c.toDataURL('image/jpeg', 0.9);
    const r = await (await fetch('/api/books/dream-jobs/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { name: 'Laila', gender: 'girl' }, face }) })).json();
    POD.setCart([{ designId: r.id, bookId: r.bookId, editToken: r.editToken, productId: r.productId, productName: r.productName, colorName: r.color.name, sizeLabel: r.size.label, sides: r.sides.map((s) => s.name), price: r.price, previewUrl: r.previewUrl }]);
    return r.id;
  });
}

test('cart with only a kids book: no "edit quantities / duplicate" tip and no "Print colours" note', { timeout: 90000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/cart`);
    const id = await bookInCart(page);
    await page.goto(`${srv.base}/cart`);
    await page.waitForSelector(`[data-proof-for="${id}"] .proof-screen-note`, { timeout: 30000 });
    assert.strictEqual(await page.isHidden('#cart-note'), true, 'the editor tip is hidden');
    const note = await page.textContent(`[data-proof-for="${id}"] .proof-screen-note`);
    assert.doesNotMatch(note, /Print colours/, note);
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});
