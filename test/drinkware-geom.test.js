'use strict';
// Round drinkware geometry (public/js/drinkware-geom.js): the fan template of a tapered band, its maps and drawings.
const test = require('node:test');
const assert = require('node:assert');
const geom = require('../public/js/drinkware-geom');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const EXAMPLE = { topMm: 0, heightMm: 120, d1Mm: 90, d2Mm: 65, gapMm: 0, safeMm: 3 };

test('the worked example: D1 90, D2 65, h 120', () => {
  const f = geom.fanOf(EXAMPLE, null);
  assert.strictEqual(f.template, 'fan');
  near(f.s, 120.65, 0.01, 's');
  near(f.Ro, 434.3, 0.05, 'Ro');
  near(f.Ri, 313.7, 0.05, 'Ri');
  near((f.theta * 180) / Math.PI, 37.3, 0.05, 'full sweep'); // no gap: the full sweep
  near(f.Wrect, Math.PI * 90, 1e-9, 'long arc');
  near(f.Hrect, f.s, 1e-9);
  assert.strictEqual(f.wideTop, true);
  near(geom.squeezePct(f), 27.8, 0.05, 'squeeze');
});

test('the seam gap and the handle are taken off at the narrow radius', () => {
  const f = geom.fanOf({ ...EXAMPLE, gapMm: 5 }, { y0Mm: 20, y1Mm: 90, widthMm: 12 });
  near(f.phi, 2 * Math.PI - (5 + 12 + 2 * 3) / 32.5, 1e-9);
  near(f.theta, (f.phi * (45 - 32.5)) / f.s, 1e-12);
  // Bounding box of the fan.
  near(f.W, 2 * f.Ro * Math.sin(f.theta / 2), 1e-9);
  near(f.H, f.Ro - f.Ri * Math.cos(f.theta / 2), 1e-9);
});

test('forward and inverse maps round-trip, corners land on the arcs', () => {
  for (const print of [EXAMPLE, { ...EXAMPLE, d1Mm: 65, d2Mm: 90, gapMm: 5 }]) {
    const f = geom.fanOf(print, null);
    for (const u of [0, 0.1, 0.5, 0.77, 1]) {
      for (const v of [0, 0.3, 1]) {
        const [X, Y] = geom.fanXY(u, v, f);
        const [u2, v2] = geom.fanUV(X, Y, f);
        near(u2, u, 1e-9, 'u');
        near(v2, v, 1e-9, 'v');
        assert.ok(X >= -1e-9 && X <= f.W + 1e-9 && Y >= -1e-9 && Y <= f.H + 1e-9, 'inside the box');
      }
    }
    // The band's wide edge lies on the outer radius, the narrow edge on the inner one.
    const cy = f.wideTop ? f.Ro : f.H - f.Ro;
    const wideV = f.wideTop ? 0 : 1;
    const [X0, Y0] = geom.fanXY(0.3, wideV, f);
    near(Math.hypot(X0 - f.W / 2, Y0 - cy), f.Ro, 1e-9, 'outer arc');
    const [X1, Y1] = geom.fanXY(0.3, 1 - wideV, f);
    near(Math.hypot(X1 - f.W / 2, Y1 - cy), f.Ri, 1e-9, 'inner arc');
  }
});

test('the wide edge at the bottom flips the fan (v = 0 is still the band top)', () => {
  const f = geom.fanOf({ ...EXAMPLE, d1Mm: 65, d2Mm: 90 }, null);
  assert.strictEqual(f.wideTop, false);
  const top = geom.fanXY(0.5, 0, f);
  const bottom = geom.fanXY(0.5, 1, f);
  assert.ok(top[1] < bottom[1], 'the band top is higher on the page');
  near(bottom[1], f.H, 1e-9, 'the wide arc touches the bottom of the box at the centre');
});

test('a straight body gives a plain rectangle', () => {
  const f = geom.fanOf({ topMm: 10, heightMm: 90, d1Mm: 80, d2Mm: 80.3, gapMm: 5, safeMm: 3 }, null);
  assert.strictEqual(f.template, 'rect');
  assert.strictEqual(f.Ro, null);
  assert.strictEqual(f.theta, null);
  near(f.Wrect, (2 * Math.PI - 5 / 40) * 40.15, 1e-9);
  assert.strictEqual(f.Hrect, 90);
  assert.deepStrictEqual(geom.fanXY(0.5, 0.5, f), [f.W / 2, f.H / 2]);
  assert.deepStrictEqual(geom.fanUV(f.W / 2, f.H / 2, f), [0.5, 0.5]);
});

test('a gap that leaves nothing to print throws', () => {
  assert.throws(() => geom.fanOf({ ...EXAMPLE, gapMm: 300 }, null));
  assert.throws(() => geom.fanOf({ ...EXAMPLE, d2Mm: 0 }, null));
});

test('fitArea keeps the aspect inside 400 × 420, centred in 500 × 600', () => {
  const a = geom.fitArea(282.7, 120.6);
  assert.strictEqual(a.w, 400);
  near(a.h / a.w, 120.6 / 282.7, 0.001);
  near(a.x + a.w / 2, 250, 0.1);
  near(a.y + a.h / 2, 300, 0.1);
  const tall = geom.fitArea(100, 300);
  assert.strictEqual(tall.h, 420);
});

test('drawings: the unrolled band and the front view are 500 × 600 SVGs with the colour slots', () => {
  const spec = { print: { ...EXAMPLE, gapMm: 5 }, handle: { y0Mm: 20, y1Mm: 90, widthMm: 12 }, profile: [[0, 45], [120, 32.5]] };
  const u = geom.unrolledSvg(spec);
  assert.match(u, /^<svg [^>]*viewBox="0 0 500 600"/);
  assert.match(u, /\{\{C\}\}/);
  assert.match(u, /\{\{L\}\}/);
  assert.ok(!/NaN|undefined/.test(u));
  const v = geom.silhouetteSvg(spec.profile, { print: spec.print, handle: spec.handle });
  assert.match(v, /^<svg [^>]*viewBox="0 0 500 600"/);
  assert.match(v, /\{\{S\}\}/);
  assert.ok(!/NaN|undefined/.test(v));
  // Every coordinate stays in the drawing.
  for (const n of v.replace(/xmlns="[^"]*"/, "").match(/-?\d+(\.\d+)?/g).map(Number)) assert.ok(n > -1 && n < 601, `coordinate ${n}`);
  assert.throws(() => geom.silhouetteSvg([[0, 40]]));
  near(geom.radiusAt(spec.profile, 60), 38.75, 1e-9);
});
