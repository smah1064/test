'use strict';
// Preflight of tapered drinkware sides (side.fan): the print must be as wide as the fan's long arc (fanMismatch),
// and the squeeze at the narrow edge is reported (fanTemplate, info).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { preflight } = require('../src/preflight');
const geom = require('../public/js/drinkware-geom');
const drinkware = require('../src/drinkware');
const { getProduct } = require('../src/products');

const spec = drinkware.buildSpec({ kind: 'cup', material: 'gloss', typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 120 } });
const product = drinkware.applyTo(structuredClone(getProduct('tumbler')), spec);
const ps = product.sides[0];
const fan = geom.fanOf(spec.print, null);

async function run(widthIn, sideFan = ps.fan) {
  const dpi = 150;
  const heightIn = Math.round(((widthIn * ps.printArea.h) / ps.printArea.w) * 1000) / 1000;
  const w = Math.round(widthIn * dpi);
  const h = Math.round(heightIn * dpi);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.4}" fill="#c00"/></svg>`);
  const png = await sharp(svg).png().toBuffer();
  const side = { id: 'front', widthIn, heightIn, bleedIn: 0, widthPx: w, heightPx: h, dpi, ...(sideFan ? { fan: sideFan } : {}) };
  const design = { id: 'd1', productId: product.id, process: product.process, kind: 'product', sides: [side] };
  return preflight(design, { product, readFile: async (name) => { if (name !== 'front-print.png') throw new Error('ENOENT'); return png; } });
}

test('a print as wide as the fan\'s long arc passes, with the squeeze as info', async () => {
  const r = await run(ps.printWidthIn);
  assert.strictEqual(r.status, 'pass', JSON.stringify(r.checks));
  const info = r.checks.find((c) => c.id === 'fanTemplate');
  assert.deepStrictEqual(info, { id: 'fanTemplate', level: 'info', side: 'front', params: { squeezePct: geom.squeezePct(fan) } });
  assert.ok(!r.checks.some((c) => c.id === 'fanMismatch'));
});

test('a print of another width (old measurements) fails with fanMismatch', async () => {
  const r = await run(Math.round(ps.printWidthIn * 1.03 * 1000) / 1000);
  assert.strictEqual(r.status, 'fail');
  const c = r.checks.find((x) => x.id === 'fanMismatch');
  assert.ok(c, JSON.stringify(r.checks));
  assert.strictEqual(c.level, 'fail');
  assert.strictEqual(c.side, 'front');
  assert.strictEqual(c.params.arcMm, Math.round(fan.Wrect * 10) / 10);
  // Within 1% is fine.
  const ok = await run(Math.round(ps.printWidthIn * 1.008 * 1000) / 1000);
  assert.ok(!ok.checks.some((x) => x.id === 'fanMismatch'));
});

test('sides without a fan get neither check; a broken fan fails', async () => {
  const r = await run(ps.printWidthIn, null);
  assert.ok(!r.checks.some((c) => c.id === 'fanMismatch' || c.id === 'fanTemplate'));
  const bad = await run(ps.printWidthIn, { r1: 45 });
  assert.ok(bad.checks.some((c) => c.id === 'fanMismatch' && c.level === 'fail'));
});
