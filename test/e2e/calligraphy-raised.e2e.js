'use strict';

/**
 * Owner (28 Nov): the layered calligraphy board shows its design as a raised gold layer, 5 mm high
 * (model.raised in src/products.js), in the live preview: in 3D the design's traced outline stands up from a
 * truly round board (public/js/preview3d.js raisedBlock, boardShape); in the realistic view it gets a shadow
 * and a lit rim (public/js/preview.js raise).
 *
 * Run:  node --test test/e2e/calligraphy-raised.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;
let devices;

test.before(async () => {
  srv = await startServer();
  const pw = loadPlaywright();
  devices = pw.devices;
  browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** The realistic preview's pixels for the Bismillah design; `flat` strips model.raised from the products. */
async function realistic(flat) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (flat) {
    await page.route('**/api/products*', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const p of body.products) if (p.id === 'calligraphy') delete p.model.raised;
      await route.fulfill({ response: res, json: body });
    });
  }
  await page.goto(`${srv.base}/editor?library=cnc-cal-bismillah&product=calligraphy&color=walnut`, { waitUntil: 'networkidle' });
  await page.click('#preview-open');
  await page.waitForSelector('#pv-body canvas.pv-canvas');
  const data = await page.evaluate(() => {
    const c = document.querySelector('#pv-body canvas.pv-canvas');
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  });
  return { ctx, page, data, errors };
}

test('the calligraphy board is 5 mm raised in the product data', async () => {
  const { products } = await (await fetch(`${srv.base}/api/products`)).json();
  const p = products.find((x) => x.id === 'calligraphy');
  assert.ok(Math.abs(p.model.raised * 25.4 - 5) < 0.2, `raised ${p.model.raised} in`);
  // This one and the two-layer wood pieces (28 Nov: test/e2e/twolayer-3d.e2e.js); the other boards stay engraved flat.
  assert.deepStrictEqual(products.filter((x) => x.model && x.model.raised).map((x) => x.id).sort(), ['calligraphy', 'calligraphypanel', 'doorhanger', 'keyholder', 'woodinvite']);
});

test('realistic view: the raised design has a shadow and a rim; 3D view opens without errors', async () => {
  const up = await realistic(false);
  const flat = await realistic(true);
  assert.strictEqual(up.data.length, flat.data.length);
  let changed = 0;
  let darker = 0;
  for (let i = 0; i < up.data.length; i += 4) {
    const a = up.data[i] + up.data[i + 1] + up.data[i + 2];
    const b = flat.data[i] + flat.data[i + 1] + flat.data[i + 2];
    if (Math.abs(a - b) > 24) changed++;
    if (b - a > 24) darker++;
  }
  const total = up.data.length / 4;
  assert.ok(changed > total * 0.002, `the raised look changes the picture (${changed} of ${total} px)`);
  assert.ok(darker > total * 0.001, `a shadow beside the design (${darker} px darker)`);
  assert.ok(changed < total * 0.2, 'only around the design, not the whole picture');

  await up.page.locator('[data-pv-tab="3d"]').click();
  await up.page.waitForFunction(() => {
    const c = document.querySelector('#pv-body canvas:not(.pv-canvas)');
    return c && c.width > 0;
  });
  await up.page.waitForTimeout(800);
  assert.deepStrictEqual(up.errors, []);
  assert.deepStrictEqual(flat.errors, []);
  await up.ctx.close();
  await flat.ctx.close();
});
