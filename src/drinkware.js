'use strict';
/**
 * Round drinkware made from measurements ("New product from photo", slice 1: typed numbers only).
 *
 * A cup, tumbler, mug or bottle is a catalogue clone of `tumbler` (no handle) or `mug` (handle) that carries a
 * `drinkware` spec on its edit (db.catalog.products[id].drinkware). src/catalog.js lays it over the product with
 * applyTo(): one print side, the band UNROLLED to a rectangle (Wrect × Hrect, see public/js/drinkware-geom.js), the
 * fan geometry for the print files when the body is tapered, a lathe 3D model and the public `drink` subset.
 *
 * buildSpec(input) -> spec        input = the POST /api/admin/photo-products/from-measurements body:
 *   { kind, handle:{ widthMm, y0Mm, y1Mm }|null, typed:{ heightMm, topDiaMm, bottomDiaMm, printTopMm, printHeightMm },
 *     material, gapMm?, safeMm? }   (id, name and price are the catalogue's business, not the spec's)
 *   Throws an Error with `.key` (an i18n message key), `.field` and `.params` on bad input.
 * applyTo(p, spec)  -> p           lays the spec over a fresh copy of the template product (in place).
 * templateFor(spec) -> 'mug' | 'tumbler'
 * fanFor(spec)      -> geom.fanOf(spec.print, spec.handle) (what src/fan-files.js takes)
 */
const geom = require('../public/js/drinkware-geom');

const KINDS = ['tumbler', 'cup', 'mug', 'bottle'];
const MATERIALS = ['gloss', 'matte', 'metal'];
const LIMITS = {
  heightMm: [30, 400],
  diaMm: [20, 200],
  taper: 0.5, // |D1 − D2| / height
  bandMinMm: 10,
  handleWidthMm: [5, 120],
  gapMm: [0, 50],
  safeMm: [0, 20],
};
const MM_PER_IN = 25.4;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r4 = (n) => Math.round(n * 10000) / 10000;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fail(key, field, params = {}) {
  const e = new Error(key);
  e.key = key;
  e.field = field;
  e.params = params;
  return e;
}
/** A number in [min, max] (strings of digits allowed, true/arrays not), or throws. */
function numIn(v, [min, max], key, field) {
  const ok = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
  const n = ok ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw fail(key, field, { min, max });
  return n;
}

function buildSpec(input) {
  const b = isObj(input) ? input : {};
  const kind = b.kind === undefined ? 'tumbler' : b.kind;
  if (!KINDS.includes(kind)) throw fail('photoProductBadKind', 'kind');
  const material = b.material === undefined || b.material === null || b.material === '' ? (kind === 'tumbler' ? 'metal' : 'gloss') : b.material;
  if (!MATERIALS.includes(material)) throw fail('photoProductBadMaterial', 'material');
  const t = isObj(b.typed) ? b.typed : {};
  const heightMm = r1(numIn(t.heightMm, LIMITS.heightMm, 'photoProductBadHeight', 'typed.heightMm'));
  const topDiaMm = r1(numIn(t.topDiaMm, LIMITS.diaMm, 'photoProductBadDiameter', 'typed.topDiaMm'));
  const bottomDiaMm = r1(numIn(t.bottomDiaMm, LIMITS.diaMm, 'photoProductBadDiameter', 'typed.bottomDiaMm'));
  if (Math.abs(topDiaMm - bottomDiaMm) / heightMm > LIMITS.taper) throw fail('photoProductTooTapered', 'typed.bottomDiaMm', { max: LIMITS.taper });
  const printTopMm = r1(numIn(t.printTopMm, [0, heightMm], 'photoProductBadBand', 'typed.printTopMm'));
  const printHeightMm = r1(numIn(t.printHeightMm, [LIMITS.bandMinMm, heightMm], 'photoProductBadBand', 'typed.printHeightMm'));
  if (printTopMm + printHeightMm > heightMm + 0.05) throw fail('photoProductBadBand', 'typed.printHeightMm', { min: LIMITS.bandMinMm, max: r1(heightMm - printTopMm) });
  const gapMm = b.gapMm === undefined || b.gapMm === null || b.gapMm === '' ? 5 : r1(numIn(b.gapMm, LIMITS.gapMm, 'photoProductBadGap', 'gapMm'));
  const safeMm = b.safeMm === undefined || b.safeMm === null || b.safeMm === '' ? 3 : r1(numIn(b.safeMm, LIMITS.safeMm, 'photoProductBadGap', 'safeMm'));

  let handle = null;
  if (b.handle !== undefined && b.handle !== null && b.handle !== false) {
    if (!isObj(b.handle)) throw fail('photoProductBadHandle', 'handle');
    const widthMm = r1(numIn(b.handle.widthMm, LIMITS.handleWidthMm, 'photoProductBadHandle', 'handle.widthMm'));
    const y0Mm = r1(numIn(b.handle.y0Mm, [0, heightMm], 'photoProductBadHandle', 'handle.y0Mm'));
    const y1Mm = r1(numIn(b.handle.y1Mm, [0, heightMm], 'photoProductBadHandle', 'handle.y1Mm'));
    if (!(y1Mm - y0Mm >= 5)) throw fail('photoProductBadHandle', 'handle.y1Mm');
    handle = { y0Mm, y1Mm, widthMm };
  }

  // The diameter along the body is linear between the rim and the base (slice 1: two typed points).
  const diaAt = (y) => topDiaMm + ((bottomDiaMm - topDiaMm) * y) / heightMm;
  const print = { topMm: printTopMm, heightMm: printHeightMm, d1Mm: r2(diaAt(printTopMm)), d2Mm: r2(diaAt(printTopMm + printHeightMm)), gapMm, safeMm };
  try {
    geom.fanOf(print, handle);
  } catch (e) {
    throw fail('photoProductBadHandle', handle ? 'handle.widthMm' : 'gapMm'); // the gap and the handle leave nothing to print
  }
  return {
    v: 1, shootId: null, kind, material,
    dims: { heightMm, topDiaMm, bottomDiaMm },
    profile: [[0, r2(topDiaMm / 2)], [heightMm, r2(bottomDiaMm / 2)]],
    print,
    handle,
    mockup: null,
    assetsVer: 0, checkedAt: null, checkedBy: null,
  };
}

const templateFor = (spec) => (spec && spec.handle ? 'mug' : 'tumbler');
const fanFor = (spec) => geom.fanOf(spec.print, spec.handle);

/** Lay a drinkware spec over a fresh copy of its template product (in place; returns p). */
function applyTo(p, spec) {
  const fan = fanFor(spec);
  const first = p.sides[0] || { id: 'front', name: { en: 'Front', ar: 'الأمام' } };
  const side = {
    id: first.id,
    name: first.name,
    svg: geom.unrolledSvg(spec),
    printArea: geom.fitArea(fan.Wrect, fan.Hrect),
    printWidthIn: r3(fan.Wrect / MM_PER_IN),
    wrap: { view: geom.silhouetteSvg(spec.profile, { print: spec.print, handle: spec.handle }) },
    safeIn: r3(fan.safeMm / MM_PER_IN),
    bleedIn: first.bleedIn || 0,
  };
  if (fan.template === 'fan') {
    side.fan = { r1: r4(fan.r1), r2: r4(fan.r2), s: r4(fan.s), Ro: r4(fan.Ro), Ri: r4(fan.Ri), theta: r4(fan.theta), phi: r4(fan.phi), wideTop: fan.wideTop, gapMm: fan.gapMm, safeMm: fan.safeMm };
  }
  p.sides = [side];
  // One physical size: the template's first, without a print scale (the geometry is the measured one).
  if (p.sizes && p.sizes.length) {
    const { printScale, ...z } = p.sizes[0];
    p.sizes = [z];
  }
  const maxR = Math.max(...spec.profile.map((q) => q[1]));
  p.model = {
    type: 'mug',
    diameterIn: r3((2 * maxR) / MM_PER_IN),
    heightIn: r3(spec.dims.heightMm / MM_PER_IN),
    material: spec.material === 'metal' ? 'metal' : 'ceramic',
    handle: Boolean(spec.handle),
    lid: false,
    profile: spec.profile.map(([y, r]) => [r3(y / MM_PER_IN), r3(r / MM_PER_IN)]),
    band: { y0In: r3(spec.print.topMm / MM_PER_IN), y1In: r3((spec.print.topMm + spec.print.heightMm) / MM_PER_IN), phi: r4(fan.phi) },
    finish: spec.material,
    // Where the handle meets the body (inches from the rim), for the 3D model.
    handleBand: spec.handle ? { y0In: r3(spec.handle.y0Mm / MM_PER_IN), y1In: r3(spec.handle.y1Mm / MM_PER_IN) } : null,
  };
  p.drink = { kind: spec.kind, material: spec.material, dims: { ...spec.dims }, template: fan.template, mockup: spec.mockup || null };
  return p;
}

module.exports = { buildSpec, applyTo, templateFor, fanFor, KINDS, MATERIALS, LIMITS };
