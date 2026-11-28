'use strict';

/**
 * The two-layer wood pieces (owner's go, 28 Nov 2026; CNC & Laser chat): a board with the customer's design cut
 * as a second layer and raised on it (tall calligraphy panel, door hanger, key holder, wooden invitation), or one
 * cut piece standing in a wooden base (Ramadan light, couple names stand). See src/products.js "Two-layer wood pieces".
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PRODUCTS, priceFor } = require('../src/products');

const byId = (id) => PRODUCTS.find((p) => p.id === id);
// id: [category, process, base price, { size: price }, laser kind, model extras]
const SPEC = {
  calligraphypanel: ['home', 'cnc', 1600, { '40x80': 1600, '60x120': 2800 }, 'engrave', { raised: 0.2 }],
  doorhanger: ['home', 'cnc', 450, { 30: 450, 40: 650 }, 'engrave', { raised: 0.12, rope: true }],
  keyholder: ['home', 'cnc', 380, { '30x12': 380, '45x18': 550 }, 'engrave', { raised: 0.16, hooks: 5 }],
  ramadanlight: ['laser', 'lasercut', 350, { 25: 350, 35: 500 }, 'cut', { stand: true, candle: true }],
  couplestand: ['laser', 'lasercut', 450, { 30: 450 }, 'cut', { stand: true }],
  woodinvite: ['laser', 'engrave', 3500, { 'A5-25': 3500, 'A5-50': 6500, 'A5-100': 12000, 'A4-1': 450 }, 'engrave', { raised: 0.08, base: 'wood' }],
};

test('the six two-layer products exist with their prices, process and 3D model', () => {
  for (const [id, [category, process, base, prices, kind, model]] of Object.entries(SPEC)) {
    const p = byId(id);
    assert.ok(p, id);
    assert.strictEqual(p.category, category, id);
    assert.strictEqual(p.process, process, id);
    assert.strictEqual(p.basePrice, base, id);
    assert.deepStrictEqual(Object.fromEntries(p.sizes.map((z) => [z.id, priceFor(p, z.id, 1)])), Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v])), id);
    assert.strictEqual(p.laser.kind, kind, id);
    for (const [k, v] of Object.entries(model)) assert.deepStrictEqual(p.model[k], v, `${id}: model.${k}`);
    assert.ok(p.name.ar && p.name.en && p.description.ar && p.description.en, id);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'lifestyle', `${id}.webp`)), `${id}: product photo`);
  }
});

test('raised pieces: each colour is a board and a raised layer, wood or gold; boards plain or painted wood', () => {
  for (const id of ['calligraphypanel', 'doorhanger', 'keyholder', 'woodinvite']) {
    for (const c of byId(id).colors) {
      assert.match(c.hex, /^#[0-9a-f]{6}$/i, `${id}/${c.id}`);
      assert.match(c.ink, /^#[0-9a-f]{6}$/i, `${id}/${c.id}`);
      assert.notStrictEqual(c.hex.toLowerCase(), c.ink.toLowerCase(), `${id}/${c.id}: the layer shows on the board`);
      assert.ok(['wood', 'painted'].includes(c.board), `${id}/${c.id}: board`);
      // Gold is metal; every other raised layer is wood.
      assert.strictEqual(c.inkFinish === 'wood', !/gold/i.test(c.name.en), `${id}/${c.id}: finish`);
    }
  }
});

test('cut pieces come out as one piece, with an LED (not a flame) tea light on the Ramadan light', () => {
  for (const id of ['ramadanlight', 'couplestand']) assert.deepStrictEqual(byId(id).laser, { kind: 'cut', bridgeMm: 2.5, pieces: 'one' }, id);
  assert.match(byId('ramadanlight').description.en, /LED tea light/);
  assert.match(byId('ramadanlight').description.ar, /شمعة LED/);
});

test('bigger sizes are the same shape; the invitation is 25, 50 or 100 A5 cards or one A4 keepsake', () => {
  assert.strictEqual(byId('calligraphypanel').sizes[1].printScale, 1.5);
  assert.strictEqual(byId('doorhanger').sizes[1].printScale, 1.3333);
  assert.strictEqual(byId('keyholder').sizes[1].printScale, 1.5);
  assert.strictEqual(byId('ramadanlight').sizes[1].printScale, 1.4);
  const inv = byId('woodinvite');
  assert.deepStrictEqual(inv.sizes.map((z) => z.copies), [25, 50, 100, 1]);
  assert.ok(Math.abs(inv.sizes[3].printScale - 21 / 14.8) < 0.001);
  assert.strictEqual(inv.sizes[3].smallPack, true);
});

test('no cash-on-delivery promise and no «مجسم» (it reads as «مج», the mug, in the search)', () => {
  for (const id of Object.keys(SPEC)) {
    const all = JSON.stringify([byId(id).name, byId(id).description]);
    assert.ok(!/cash on delivery|الدفع عند الاستلام/i.test(all), id);
    assert.ok(!all.includes('مجسم'), id);
  }
});

test('the door hanger is cut as a true circle at 30 and 40 cm; the invitation is A5 (14.8 × 21 cm)', async () => {
  const laserFiles = require('../src/laser');
  const sharp = require('sharp');
  const hanger = byId('doorhanger');
  assert.ok(hanger.laser.radiusMm >= 200, 'half of the 40 cm board or more');
  // A blank 40 cm board: its cut is two half-circle arcs' worth (four arcs of radius 200), no straight sides.
  const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
  const svg = await laserFiles.cutSvg(png, { widthMm: 400, heightMm: 400, laser: hanger.laser });
  assert.match(svg, /A200 200 0 0 1/);
  assert.doesNotMatch(svg, /H(?!200)\d/, 'no straight edges');
  const a = byId('woodinvite').sides[0].printArea;
  assert.ok(Math.abs((14.8 * a.h) / a.w - 21) < 0.02, `A5 height ${((14.8 * a.h) / a.w).toFixed(2)} cm`);
});
