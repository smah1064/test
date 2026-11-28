'use strict';
// Calibration-card detection (public/js/calib-detect.js) on synthetic photos: the card from its layout, ray-traced
// through a pinhole camera with perspective, blur and noise (test/helpers/synth-card.js).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/js/calib-detect');
const { renderScene } = require('./helpers/synth-card');

const deg = Math.PI / 180;
const CUP = { axisX: 290, heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 };
const cornerErr = (r, sc) => Math.max(...r.corners.map((p, i) => Math.hypot(p[0] - sc.finders[i][0], p[1] - sc.finders[i][1])));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const yawCam = (a, dist = 1000, x = 190, y = 120) => ({ pos: [x + dist * Math.sin(a * deg), y, -dist * Math.cos(a * deg)], target: [x, y, 0] });

test('a card facing the camera: exact corners, scale, white balance, no tilt', () => {
  const sc = renderScene({ cup: CUP });
  const t = Date.now();
  const r = C.detectCard(sc.img);
  const ms = Date.now() - t;
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.reason, undefined);
  assert.ok(cornerErr(r, sc) <= 1, `corners ${cornerErr(r, sc)}`);
  assert.ok(r.rmsPx <= 1);
  assert.strictEqual(r.points, 24);
  near(r.pxPerMm, 2.4, 0.024, 'px per mm'); // f 2400 px at 1 m
  near(r.tiltDeg, 0, 1, 'tilt');
  assert.deepStrictEqual(r.gates, { sharp: true, tilt: true, exposure: true, fit: true });
  // Warm light (cast 1, .97, .9): the gains undo it and bring the paper to ≈ 240.
  near(r.wb[0] / r.wb[2], 0.9, 0.02, 'wb ratio');
  near(238 * r.wb[0], 240, 4, 'paper red'); near(214 * r.wb[2], 240, 4, 'paper blue');
  assert.ok(ms < 1500, `detection took ${ms} ms`);
});

test('8° of perspective with blur and noise: corners within 1 px', () => {
  const sc = renderScene({ cup: CUP, camera: yawCam(8), blur: 1, noise: 3, seed: 7 });
  const r = C.detectCard(sc.img);
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(cornerErr(r, sc) <= 1, `corners ${cornerErr(r, sc)}`);
  assert.ok(r.rmsPx <= 1, `rms ${r.rmsPx}`);
  near(r.tiltDeg, 8, 1.5, 'tilt (focal length estimated from the perspective)');
  assert.strictEqual(r.cam.fEstimated, true);
  // H maps card mm to image px like the true one, everywhere on the card.
  for (const [x, y] of [[0, 0], [210, 0], [0, 200], [210, 200], [105, 100]]) {
    const a = C.cardToImage(r.H, x, y), b = C.cardToImage(sc.H, x, y);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1.5, `card corner ${x},${y}`);
    const back = C.imageToCard(r.Hinv, a[0], a[1]);
    near(back[0], x, 1e-6); near(back[1], y, 1e-6);
  }
});

test('pitch, roll and a closer camera; upside down and sideways cards keep their corner order', () => {
  for (const [camera, extra] of [
    [{ pos: [150, 120 - 600 * Math.sin(6 * deg), -600], target: [150, 120, 0], rollDeg: 5 }, { blur: 0.8, noise: 2 }],
    [{ pos: [105, 100, -700], target: [105, 100, 0], rollDeg: 180 }, { blur: 0.6 }],
    [{ pos: [105, 100, -900], target: [105, 100, 0], rollDeg: 90 }, {}],
  ]) {
    const sc = renderScene({ cup: CUP, camera, ...extra });
    const r = C.detectCard(sc.img);
    assert.strictEqual(r.ok, true, r.reason);
    assert.ok(cornerErr(r, sc) <= 1, `roll ${camera.rollDeg}: corners ${cornerErr(r, sc)}`);
  }
});

test('a big photo is detected on a ≤ 1600 px copy and refined on the full image', () => {
  const sc = renderScene({ cup: CUP, width: 3000, height: 2250, samples: 1, blur: 0.6, noise: 2, camera: { pos: [200, 110, -900], target: [190, 120, 0], rollDeg: -4 } });
  const t = Date.now();
  const r = C.detectCard(sc.img);
  const ms = Date.now() - t;
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(cornerErr(r, sc) <= 1, `corners ${cornerErr(r, sc)}`);
  assert.ok(ms < 2000, `detection took ${ms} ms`);
});

test('cardScale: card mm are real mm on a card printed at 97 %', () => {
  const sc = renderScene({ cup: CUP, cardScale: 0.97 });
  const r = C.detectCard(sc.img, { cardScale: 0.97 });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(cornerErr(r, sc) <= 1);
  const tl = C.imageToCard(r.Hinv, ...r.corners[0]);
  near(tl[0], 25 * 0.97, 0.15); near(tl[1], 25 * 0.97, 0.15);
  const br = C.imageToCard(r.Hinv, ...r.corners[3]);
  near(br[0] - tl[0], 160 * 0.97, 0.2, 'finder spacing in real mm');
  near(r.pxPerMm, 2.4, 0.03, 'px per real mm');
  assert.strictEqual(r.cardScale, 0.97);
});

test('gates: tilted, blurry, too dark, too bright, not found', () => {
  let r = C.detectCard(renderScene({ cup: CUP, camera: yawCam(13) }).img);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'tilted'); assert.strictEqual(r.gates.tilt, false);
  assert.ok(r.tiltDeg > 10 && r.tiltDeg < 16, `tilt ${r.tiltDeg}`);
  assert.ok(r.H && r.corners, 'a gated result still carries the card');

  r = C.detectCard(renderScene({ cup: CUP, blur: 3.5, camera: { pos: [190, 120, -700], target: [190, 120, 0] } }).img);
  assert.strictEqual(r.reason, 'blurry'); assert.strictEqual(r.gates.sharp, false);

  r = C.detectCard(renderScene({ cup: CUP, paper: { white: 70, black: 10 }, background: { top: [62, 62, 60], bottom: [55, 55, 54] } }).img);
  assert.strictEqual(r.reason, 'tooDark'); assert.strictEqual(r.gates.exposure, false);

  r = C.detectCard(renderScene({ cup: CUP, paper: { white: 255, black: 60 }, cast: [1, 1, 1] }).img);
  assert.strictEqual(r.reason, 'tooBright'); assert.strictEqual(r.gates.exposure, false);

  r = C.detectCard({ data: new Uint8ClampedArray(800 * 600 * 4).fill(200), width: 800, height: 600 });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'notFound']);
  r = C.detectCard({ data: new Uint8ClampedArray(400 * 300 * 4).fill(20), width: 400, height: 300 });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'tooDark']);
});

test('taps: four rough taps in any order snap to the finders', () => {
  const sc = renderScene({ cup: CUP, blur: 0.8, noise: 2 });
  const taps = sc.finders.map(([x, y], i) => [x + [9, -7, 5, -11][i], y + [-6, 8, 10, -4][i]]);
  const r = C.fromTaps(sc.img, [taps[2], taps[0], taps[3], taps[1]]);
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.method, 'tap');
  assert.strictEqual(r.lowAccuracy, undefined);
  assert.ok(cornerErr(r, sc) <= 1, `corners ${cornerErr(r, sc)}`);

  // Checker covered (a hand, a glare): auto detection fails, the taps alone are accepted with low accuracy.
  const img = { ...sc.img, data: new Uint8ClampedArray(sc.img.data) };
  const [x0, y0] = sc.project(30, 45, 0), [x1, y1] = sc.project(180, 155, 0);
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
    const p = (y * img.width + x) * 4; img.data[p] = 120; img.data[p + 1] = 60; img.data[p + 2] = 30;
  }
  const auto = C.detectCard(img);
  assert.deepStrictEqual([auto.ok, auto.reason], [false, 'notFound']);
  const tap = C.fromTaps(img, taps);
  assert.strictEqual(tap.ok, true, tap.reason);
  assert.strictEqual(tap.lowAccuracy, true);
  assert.strictEqual(tap.rmsPx, null);
  assert.ok(cornerErr(tap, sc) <= 1.5, `corners ${cornerErr(tap, sc)}`);

  assert.deepStrictEqual([C.fromTaps(sc.img, taps.slice(0, 3)).reason], ['notFound']);
  assert.deepStrictEqual([C.fromTaps(sc.img, [[10, 10], [11, 10], [12, 10], [13, 10]]).ok], [false]);
});

test('focalFromExif35: 35 mm-equivalent focal length to px', () => {
  near(C.focalFromExif35(43.267, 4000, 3000), 5000, 1e-6);
  assert.strictEqual(C.focalFromExif35(0, 4000, 3000), undefined);
});
