'use strict';
// Measuring drinkware from photos (public/js/drinkware-measure.js): synthetic cups (ray-traced cones, cylinders, a
// leaning cup, a mug with a handle) standing with their axis in the plane of a synthetic calibration card.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/js/calib-detect');
const M = require('../public/js/drinkware-measure');
const { renderScene, cupTruth } = require('./helpers/synth-card');

const pct = (a, b) => (100 * (a - b)) / b;
const within = (a, b, p, msg) => assert.ok(Math.abs(pct(a, b)) <= p, `${msg}: ${a} vs ${b} (${pct(a, b).toFixed(2)} %)`);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

/** Photo -> card -> rectified crop round the cup -> mask -> measurement, as the wizard does it. */
function shoot(cup, scene = {}, view = 'front') {
  const sc = renderScene({ cup, ...scene });
  const card = C.detectCard(sc.img);
  assert.strictEqual(card.ok, true, card.reason);
  const r = Math.max(cup.topDiaMm, cup.bottomDiaMm) / 2 + (cup.handle ? cup.handle.reachMm + 10 : 0);
  const roi = { x: cup.axisX - r - 25, y: 200 - cup.heightMm - 30, w: 2 * r + 50, h: cup.heightMm + 45 };
  const rect = M.rectify(sc.img, card, { pxPerMm: 5, roi });
  const mask = M.maskFromBackground(rect.img, { card, rect });
  const fn = view === 'side' ? M.measureSide : M.measureFront;
  return { sc, card, rect, mask, m: fn(rect.img, mask, { ...rect, card }) };
}

test('tapered tumbler at 1 m: height between the side corners and both diameters within 1 %', () => {
  const cup = { axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 };
  const { m, rect } = shoot(cup, { blur: 0.7, noise: 2 });
  within(m.heightMm, 120, 1, 'height');
  within(m.topDiaMm, 90, 1, 'top');
  within(m.bottomDiaMm, 65, 1, 'bottom');
  near(m.leanDeg, 0, 0.3, 'lean');
  // Rectified px: the rim's centre at card (290, 80), the base at y 200.
  const px = (x, y) => [(x - rect.offsetMm[0]) * rect.pxPerMm, (y - rect.offsetMm[1]) * rect.pxPerMm];
  near(m.axisXpx, px(290, 80)[0], 2, 'axis');
  near(m.rimYpx, px(290, 80)[1], 2.5, 'rim');
  near(m.baseYpx, px(290, 200)[1], 2.5, 'base');
  // Profile: ≤ 64 points from the rim down, ends = the diameters, a straight cone in between.
  assert.ok(m.profile.length >= 8 && m.profile.length <= 64);
  assert.strictEqual(m.profile[0][0], 0);
  near(m.profile[0][1], m.topDiaMm / 2, 0.06);
  near(m.profile[m.profile.length - 1][0], m.heightMm, 0.11);
  near(m.profile[m.profile.length - 1][1], m.bottomDiaMm / 2, 0.06);
  for (let i = 1; i < m.profile.length; i++) assert.ok(m.profile[i][0] > m.profile[i - 1][0], 'monotone y');
  for (const [y, r] of m.profile) near(r, 45 - (12.5 * y) / 120, 0.5, `r at ${y}`);
  assert.ok(M.bandLinearityMm(m.profile, { topMm: 10, heightMm: 95 }) <= 0.5);
  assert.ok(m.outline.length > 50 && m.outline.length <= 400);
  assert.strictEqual(m.handleSeen, false);
});

test('a camera high above the rim, close and off to one side, and a camera low and close', () => {
  const cup = { axisX: 285, heightMm: 95, topDiaMm: 82, bottomDiaMm: 82 };
  for (const camera of [{ pos: [200, 20, -800], target: [200, 120, 0] }, { pos: [200, 150, -650], target: [200, 130, 0] }]) {
    const { m } = shoot(cup, { camera, blur: 0.8, noise: 2 });
    within(m.heightMm, 95, 1, `height, camera at y ${camera.pos[1]}`);
    within(m.topDiaMm, 82, 1, 'top');
    within(m.bottomDiaMm, 82, 1, 'bottom');
  }
});

test('a slightly leaning cup: the axis is fitted and the cup measured upright', () => {
  const cup = { axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, leanDeg: 2.5 };
  const { m } = shoot(cup, { blur: 0.7, noise: 2 });
  near(m.leanDeg, 2.5, 0.3, 'lean');
  within(m.heightMm, 120, 1, 'height');
  within(m.topDiaMm, 90, 1, 'top');
  within(m.bottomDiaMm, 65, 1, 'bottom');
});

test('the card seen at an angle (6° yaw): widths corrected for the oblique view', () => {
  const deg = Math.PI / 180;
  const cup = { axisX: 280, heightMm: 100, topDiaMm: 80, bottomDiaMm: 80 };
  const { m } = shoot(cup, { camera: { pos: [200 + 1000 * Math.sin(6 * deg), 120, -1000 * Math.cos(6 * deg)], target: [200, 120, 0] } });
  within(m.heightMm, 100, 1, 'height');
  within(m.topDiaMm, 80, 1, 'top');
  assert.ok(m.widthCorr < 1);
});

test('side shot: the handle band within 2 mm, and no handle on a tumbler', () => {
  const mug = { axisX: 285, heightMm: 110, topDiaMm: 88, bottomDiaMm: 70, handle: { y0Mm: 20, y1Mm: 90, reachMm: 25 } };
  const { m } = shoot(mug, { blur: 0.7, noise: 2 }, 'side');
  const truth = cupTruth(mug).handle;
  assert.ok(m.handle, 'handle found');
  near(m.handle.y0Mm, truth.y0Mm, 2, 'y0');
  near(m.handle.y1Mm, truth.y1Mm, 2, 'y1');
  near(m.handle.widthMm, truth.widthMm, 2, 'width (how far it sticks out)');
  assert.strictEqual(m.handle.reachMm, m.handle.widthMm);
  assert.strictEqual(m.handle.side, 'right');
  within(m.heightMm, 110, 1, 'height (the handle is ignored)');
  within(m.topDiaMm, 88, 1, 'top');
  within(m.bottomDiaMm, 70, 1, 'bottom');

  const left = { axisX: 300, heightMm: 95, topDiaMm: 82, bottomDiaMm: 82, handle: { y0Mm: 15, y1Mm: 80, reachMm: 28, side: -1 } };
  const s2 = shoot(left, {}, 'side').m;
  assert.strictEqual(s2.handle.side, 'left');
  near(s2.handle.y0Mm, 15, 2); near(s2.handle.y1Mm, 80, 2); near(s2.handle.widthMm, cupTruth(left).handle.widthMm, 2);

  const s3 = shoot({ axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 }, {}, 'side').m;
  assert.strictEqual(s3.handle, null);
});

test('maskFromBackground: the cup is the mask, the card is never part of it', () => {
  const cup = { axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 };
  const sc = renderScene({ cup, width: 1200, height: 900, focalPx: 1800, noise: 2 });
  const card = C.detectCard(sc.img);
  // On the photo itself (card from H).
  const mask = M.maskFromBackground(sc.img, { card });
  let inCard = 0, inCup = 0, total = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (!mask.data[y * mask.width + x]) continue;
    total++;
    const [u, v] = C.imageToCard(card.Hinv, x + 0.5, y + 0.5);
    if (u >= 0 && u <= 210 && v >= 0 && v <= 200) inCard++;
    if (Math.abs(u - 290) < 47 && v > 75 && v < 205) inCup++;
  }
  assert.strictEqual(inCard, 0);
  assert.ok(inCup / total > 0.99, `${inCup} / ${total}`);
  // Expected area: the trapezoid (90 + 65) / 2 × 120 mm, plus the rim and base caps, at 1.8 px/mm.
  const area = total / (1.8 * 1.8);
  assert.ok(area > 9300 && area < 9900, `area ${area}`);

  // The same in rectified space, and rectifyMask carries the photo's mask there.
  const rect = M.rectify(sc.img, card, { pxPerMm: 4, roi: { x: 150, y: 40, w: 220, h: 180 } });
  const rm = M.maskFromBackground(rect.img, { card, rect });
  const moved = M.rectifyMask(mask, card, rect);
  assert.strictEqual(moved.width, rm.width); assert.strictEqual(moved.height, rm.height);
  let both = 0, either = 0;
  for (let k = 0; k < rm.data.length; k++) { if (rm.data[k] && moved.data[k]) both++; if (rm.data[k] || moved.data[k]) either++; }
  assert.ok(both / either > 0.97, `overlap ${both / either}`);
});

test('rectify: card plane at the asked scale, white-balanced, limited in size', () => {
  const sc = renderScene({ width: 800, height: 600, focalPx: 1200, camera: { pos: [105, 100, -600], target: [105, 100, 0] } });
  const card = C.detectCard(sc.img);
  assert.strictEqual(card.ok, true, card.reason);
  const r = M.rectify(sc.img, card, { pxPerMm: 2, roi: { x: 0, y: 0, w: 210, h: 200 } });
  assert.deepStrictEqual([r.img.width, r.img.height, r.pxPerMm, r.offsetMm], [420, 400, 2, [0, 0]]);
  // Paper (between the colour row and the checker, x 100, y 47) comes out neutral ≈ 240.
  const p = (47 * 2 * 420 + 100 * 2) * 4;
  for (let c = 0; c < 3; c++) near(r.img.data[p + c], 240, 6, `paper channel ${c}`);
  // The checker's top-left square is black, the next one white.
  assert.ok(r.img.data[(120 * 420 + 90) * 4] < 60 && r.img.data[(120 * 420 + 130) * 4] > 200);
  // Outside the photo: transparent.
  const out = M.rectify(sc.img, card, { pxPerMm: 1, roi: { x: -2000, y: 0, w: 10, h: 10 } });
  assert.strictEqual(out.img.data[3], 0);
  const big = M.rectify(sc.img, card, { pxPerMm: 10, maxPixels: 1e5 });
  assert.ok(big.img.width * big.img.height <= 1.02e5 && big.pxPerMm < 10);
});

test('bandLinearityMm: 0 on a straight cone, the bulge on a curved body', () => {
  const cone = Array.from({ length: 13 }, (_, i) => [i * 10, 45 - (12.5 * i * 10) / 120]);
  assert.strictEqual(M.bandLinearityMm(cone, { topMm: 10, heightMm: 100 }), 0);
  const belly = cone.map(([y, r]) => [y, r + 2 * Math.sin((Math.PI * y) / 120)]);
  near(M.bandLinearityMm(belly, { topMm: 0, heightMm: 120 }), 2, 0.05);
  near(M.bandLinearityMm(belly, { printTopMm: 30, printHeightMm: 60 }), 2 - 2 * Math.sin(Math.PI / 4), 0.05);
  assert.strictEqual(M.bandLinearityMm([], { topMm: 0, heightMm: 10 }), 0);
});

test('compare: % difference of the photo from the typed numbers, warning over 2 %', () => {
  const typed = { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 };
  assert.deepStrictEqual(M.compare(typed, { heightMm: 121.2, topDiaMm: 92.7, bottomDiaMm: 63.5 }), { heightPct: 1, topPct: 3, bottomPct: -2.3, warn: ['topPct', 'bottomPct'] });
  assert.deepStrictEqual(M.compare(typed, { heightMm: 122.4, topDiaMm: 90 }), { heightPct: 2, topPct: 0, bottomPct: null, warn: [] });
  assert.deepStrictEqual(M.compare({}, null), { heightPct: null, topPct: null, bottomPct: null, warn: [] });
});
