'use strict';

/**
 * Browser test of the customer's own name on a ready design (/design, public/js/design.js):
 * a design with a sample name ("LAILA") has a box for the customer's own; what is typed is in the
 * picture, the cart and the stored print files; added unchanged, "Put your own name?" is asked
 * (after "Which size?" for clothes, never with it); a design without a sample name is added as before.
 *
 * Run:  node --test test/e2e/own-name.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, startServer, newContext } = require('./helpers');

let srv;
let browser;

test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** Open a ready design and wait for its picture. */
async function openDesign(id) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${srv.base}/design?id=${id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:') && document.getElementById('dp-spin').hidden, null, { timeout: 30000 });
  return page;
}
/** The words stored for a design added to the cart (editor.json, every side). */
function storedTexts(designId) {
  const ed = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'files', designId, 'editor.json'), 'utf8'));
  return Object.values(ed).flatMap((s) => s.objects.filter((o) => typeof o.text === 'string').map((o) => o.text));
}
/** The design id of a finished upload (the page goes on to the cart at once, so not from the response body). */
const doneId = (res) => /\/api\/designs\/([^/]+)\/complete$/.exec(res.url())[1];
const focused = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);

test('LAILA: the question, the keyboard, then the typed name in the picture and the stored design', { timeout: 90000 }, async () => {
  const page = await openDesign('lz-puzzle-laila-en');
  try {
    assert.ok(await page.isVisible('#dp-names'));
    assert.strictEqual(await page.getAttribute('#dp-name-0', 'placeholder'), 'LAILA');
    // Unchanged: asked, naming the sample; Escape and a click outside close it, back on Add to cart.
    await page.click('#dp-add');
    assert.ok(await page.isVisible('#name-ask'));
    assert.match(await page.textContent('#name-ask-note'), /This design says “⁨LAILA⁩”/);
    assert.strictEqual(await focused(page), 'name-ask-write');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.isVisible('#name-ask')));
    assert.strictEqual(await focused(page), 'dp-add');
    await page.click('#dp-add');
    await page.mouse.click(5, 5);
    assert.ok(!(await page.isVisible('#name-ask')));
    // "Write my name": to the box; the picture follows the name.
    await page.click('#dp-add');
    await page.click('#name-ask-write');
    assert.strictEqual(await focused(page), 'dp-name-0');
    const before = await page.getAttribute('#dp-img', 'src');
    await page.keyboard.type('omar');
    await page.waitForFunction((b) => document.getElementById('dp-img').src !== b && document.getElementById('dp-spin').hidden, before, { timeout: 30000 });
    assert.match(await page.getAttribute('#dp-edit', 'href'), /&name=omar$/);
    // Added: no question now, and the stored design says OMAR (a sample in capitals takes the name in capitals).
    const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
    await page.click('#dp-add');
    assert.ok(!(await page.isVisible('#name-ask')));
    const res = await done;
    assert.strictEqual(res.status(), 200);
    const design = { id: doneId(res) };
    await page.waitForURL(/\/cart\?added=1/, { timeout: 30000 });
    assert.deepStrictEqual(storedTexts(design.id), ['OMAR']);
    assert.ok(fs.statSync(path.join(srv.dataDir, 'files', design.id, 'front-print.png')).size > 1000);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('clothes: "Which size?" first, then the name; "Order it with" adds the sample as it is', { timeout: 90000 }, async () => {
  const page = await openDesign('ce-welcome-baby');
  try {
    await page.click('#dp-add');
    assert.ok(await page.isVisible('#size-ask'));
    assert.ok(!(await page.isVisible('#name-ask')), 'never both at once');
    await page.click('#size-ask [data-ask-size]');
    assert.ok(!(await page.isVisible('#size-ask')));
    assert.ok(await page.isVisible('#name-ask'));
    assert.match(await page.textContent('#name-ask-keep'), /Order it with “⁨آدم⁩”/);
    const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
    await page.click('#name-ask-keep');
    const res = await done;
    assert.strictEqual(res.status(), 200);
    const design = { id: doneId(res) };
    assert.ok(storedTexts(design.id).includes('آدم'));
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a design without a sample name: no box, no question', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/design?id=mesh-fady&product=mug&color=white`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('dp-img').src.startsWith('blob:'), null, { timeout: 30000 });
    assert.ok(!(await page.isVisible('#dp-names')));
    const done = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
    await page.click('#dp-add');
    assert.ok(!(await page.isVisible('#name-ask')));
    assert.strictEqual((await done).status(), 200);
  } finally {
    await ctx.close();
  }
});
