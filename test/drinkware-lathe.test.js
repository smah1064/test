'use strict';

// The 3D lathe model of measured drinkware (public/js/preview3d-lathe.js): profile → lathe points, arc-length UVs,
// and where the customer's design lands on the wrap canvas (centred at the front, phi/2π of the circumference, in
// the print band by arc length).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// A browser ES module with no imports: loaded as a data: URL so node treats it as a module without a warning.
const SRC = fs.readFileSync(path.join(__dirname, '../public/js/preview3d-lathe.js'), 'utf8');
const load = () => import(`data:text/javascript;base64,${Buffer.from(SRC).toString('base64')}`);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// A tapered tumbler, in inches: 120 mm high, 90 mm across the rim, 65 mm across the base.
const IN = (mm) => mm / 25.4;
const TAPER = [[0, IN(45)], [IN(120), IN(32.5)]];

test('cleanProfile sorts from the rim down, drops bad and repeated points; hasProfile needs two', async () => {
  const L = await load();
  assert.deepStrictEqual(L.cleanProfile([[2, 1], [0, 1.5], [0, 1.5], ['x', 1], [1, NaN], [1, 1.2]]), [[0, 1.5], [1, 1.2], [2, 1]]);
  assert.strictEqual(L.hasProfile({ profile: [[0, 1]] }), false);
  assert.strictEqual(L.hasProfile({}), false);
  assert.strictEqual(L.hasProfile({ profile: TAPER }), true);
});

test('lathePoints run from the base up, centred on y = 0, with the radius at each height', async () => {
  const L = await load();
  const H = IN(120);
  const pts = L.lathePoints(TAPER);
  assert.strictEqual(pts.length, 2);
  near(pts[0][0], IN(32.5)); // base first (outward normals in three's LatheGeometry)
  near(pts[0][1], -H / 2);
  near(pts[1][0], IN(45));
  near(pts[1][1], H / 2);
  // Inner wall: inset and cut at the floor, with an interpolated point there.
  const inner = L.lathePoints(TAPER, { inset: 0.1, toY: H - 0.3 });
  near(inner[0][1], -H / 2 + 0.3);
  near(inner[0][0], L.radiusAt(TAPER, H - 0.3) - 0.1);
  near(inner[inner.length - 1][0], IN(45) - 0.1);
});

test('radius and arc length along a tapered profile', async () => {
  const L = await load();
  const H = IN(120);
  near(L.radiusAt(TAPER, 0), IN(45));
  near(L.radiusAt(TAPER, H / 2), IN((45 + 32.5) / 2));
  near(L.radiusAt(TAPER, H * 2), IN(32.5)); // clamped
  const slant = Math.hypot(H, IN(12.5));
  near(L.arcAt(TAPER, H), slant);
  near(L.arcAt(TAPER, H / 2), slant / 2);
  near(L.maxRadius(TAPER), IN(45));
  near(L.heightOf(TAPER), H);
});

test('UVs: u = angle round (seam at u = 0/1), v = arc length (rim at v = 1), base-up order', async () => {
  const L = await load();
  // A curved profile so arc length differs from point index.
  const prof = [[0, 1.5], [0.2, 1.5], [3, 1.3], [4, 1.0]];
  const uv = L.latheUVs(prof, 4);
  assert.strictEqual(uv.length, 5 * 4 * 2);
  const acc = L.arcLengths(prof);
  const total = acc[3];
  // First ring: points from the base up.
  near(uv[0], 0);
  near(uv[1], 0); // base
  near(uv[3], 1 - acc[2] / total, 1e-6);
  near(uv[7], 1); // rim
  near(uv[uv.length - 2], 1); // last ring: u = 1
  // Not the point index: the short rim segment gets only its share of v.
  assert.ok(Math.abs(uv[5] - 2 / 3) > 0.05);
});

test('bandRect: the design is centred at the front, phi/2π wide, between the band edges by arc length', async () => {
  const L = await load();
  const H = IN(120);
  const phi = 2 * Math.PI - 5 / 32.5; // a 5 mm seam gap at the narrow radius
  const m = { profile: TAPER, band: { y0In: IN(10), y1In: IN(110), phi } };
  const { w, h } = L.wrapSize(TAPER);
  assert.strictEqual(w, 2048);
  const slant = Math.hypot(H, IN(12.5));
  near(h, Math.round((2048 * slant) / (2 * Math.PI * IN(45))), 0);
  const r = L.bandRect(m, { id: 'front' }, w, h);
  near(r.w, (phi / (2 * Math.PI)) * w);
  near(r.x + r.w / 2, w / 2);
  near(r.y / h, IN(10) / H, 1e-9); // linear profile: arc ∝ depth
  near((r.y + r.h) / h, IN(110) / H, 1e-9);
});

test('bandOf falls back to the side print size; handleOf reads a band or defaults; finishOf', async () => {
  const L = await load();
  const m = { profile: [[0, 1.5], [4, 1.5]] };
  const b = L.bandOf(m, { printWidthIn: 8, printHeightIn: 3 });
  near(b.y0In, 0.5);
  near(b.y1In, 3.5);
  near(b.phi, 8 / 1.5);
  assert.strictEqual(L.handleOf({ ...m, handle: false }), null);
  const d = L.handleOf({ ...m, handle: true });
  assert.ok(d.y0In > 0 && d.y1In < 4 && d.y1In > d.y0In);
  assert.deepStrictEqual(L.handleOf({ ...m, handle: true, handleBand: { y0In: 0.6, y1In: 3.1 } }), { y0In: 0.6, y1In: 3.1 });
  assert.deepStrictEqual(L.handleOf({ ...m, handle: { y0In: 0.7, y1In: 3 } }), { y0In: 0.7, y1In: 3 });
  assert.deepStrictEqual(L.finishOf({ finish: 'gloss' }), { kind: 'ceramic', opts: {} });
  assert.deepStrictEqual(L.finishOf({ finish: 'matte' }), { kind: 'plastic', opts: { roughness: 0.6 } });
  assert.deepStrictEqual(L.finishOf({ finish: 'metal' }), { kind: 'metal', opts: {} });
  assert.deepStrictEqual(L.finishOf({ material: 'metal' }), { kind: 'metal', opts: {} });
});
