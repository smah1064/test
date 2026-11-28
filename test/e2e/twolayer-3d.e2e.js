'use strict';

/**
 * The two-layer wood pieces (28 Nov 2026): each opens in the editor with one of its ready designs and its 3D
 * preview builds without errors: the raised layer on the board, the door hanger's rope, the key holder's hooks,
 * the invitation's stand, and the cut pieces standing in their wooden base (public/js/preview3d.js placeBoard,
 * jute, hooks, standBase).
 *
 * Run:  node --test test/e2e/twolayer-3d.e2e.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

let srv;
let browser;

test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

const CASES = [
  ['calligraphypanel', 'walnut'],
  ['doorhanger', 'olive'],
  ['keyholder', 'black'],
  ['ramadanlight', 'wood'],
  ['couplestand', 'gold'],
  ['woodinvite', 'white'],
];

test('each two-layer product opens with its own ready design and builds its 3D preview', async () => {
  const { designs } = require('../../src/library-packs/cnc-twolayer');
  for (const [product, color] of CASES) {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const first = designs.find((d) => d.product === product);
    assert.ok(first, `${product}: a ready design`);
    await page.goto(`${srv.base}/editor?library=${first.id}&product=${product}&color=${color}`, { waitUntil: 'networkidle' });
    await page.click('#preview-open');
    await page.waitForSelector('#pv-body canvas.pv-canvas');
    await page.locator('[data-pv-tab="3d"]').click();
    await page.waitForFunction(() => {
      const c = document.querySelector('#pv-body canvas:not(.pv-canvas)');
      return c && c.width > 0;
    });
    await page.waitForTimeout(1500);
    // Something is drawn: the 3D canvas is not one flat colour.
    const varied = await page.evaluate(() => {
      const c = document.querySelector('#pv-body canvas:not(.pv-canvas)');
      const g = document.createElement('canvas');
      g.width = 64;
      g.height = 64;
      const x = g.getContext('2d');
      x.drawImage(c, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return seen.size;
    });
    assert.ok(varied > 8, `${product}: the 3D view shows the piece (${varied} tones)`);
    assert.deepStrictEqual(errors, [], product);
    await page.close();
  }
});
