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
 * describe(spec)    -> { en, ar }   a plain description from the kind, material, handle and size (applyTo sets it as the
 *                                   product's description, so the template's own text, e.g. the steel travel tumbler's,
 *                                   never shows on a ceramic cup; the owner's own description, when written, wins).
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
  let fan;
  try {
    fan = geom.fanOf(print, handle);
  } catch (e) {
    throw fail('photoProductBadHandle', handle ? 'handle.widthMm' : 'gapMm'); // the gap and the handle leave nothing to print
  }
  // Room left to print inside the safe margin (QA 28 Nov: a 49 mm gap and 20 mm margins on a 20 mm cup left a
  // 13.8 mm wrap with no safe area at all): at least 20 mm each way.
  const MIN_PRINT_MM = 20;
  if (fan.Wrect - 2 * safeMm < MIN_PRINT_MM || fan.Hrect - 2 * safeMm < MIN_PRINT_MM) throw fail('photoProductNoRoom', fan.Wrect - 2 * safeMm < MIN_PRINT_MM ? 'gapMm' : 'safeMm', { min: MIN_PRINT_MM });
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

const fmt1 = (n) => String(Math.round(n * 10) / 10);
/** The volume inside the measured profile (frustums between its points), in ml. */
function volumeMl(profile) {
  let v = 0;
  for (let i = 1; i < profile.length; i++) {
    const [y0, ra] = profile[i - 1];
    const [y1, rb] = profile[i];
    v += (Math.PI * (y1 - y0) * (ra * ra + ra * rb + rb * rb)) / 3;
  }
  return v / 1000;
}
/**
 * The one size's label: "≈ 490 ml · 11 × 9 cm" / "حوالي 490 مل · 11 × 9 سم" (height × widest diameter; the outside
 * volume rounded to 10 ml, so "about"). Digits as the other size labels are kept (the pages show them in Arabic).
 */
function sizeLabel(spec) {
  const ml = Math.round(volumeMl(spec.profile) / 10) * 10;
  const h = fmt1(spec.dims.heightMm / 10);
  const d = fmt1((2 * Math.max(...spec.profile.map((q) => q[1]))) / 10);
  return { en: `≈ ${ml} ml · ${h} × ${d} cm`, ar: `حوالي ${ml} مل · ${h} × ${d} سم` };
}
/** The one colour of a measured product: neutral, named after its material. */
function colorsFor(spec) {
  if (spec && spec.material === 'metal') return [{ id: 'steel', name: { en: 'Stainless steel', ar: 'ستانلس ستيل' }, hex: '#c9ccd1' }];
  if (spec && spec.material === 'matte') return [{ id: 'white', name: { en: 'White, matte', ar: 'أبيض مطفي' }, hex: '#ffffff' }];
  return [{ id: 'white', name: { en: 'White, glossy', ar: 'أبيض لامع' }, hex: '#ffffff' }];
}

// Kind: [English noun, Egyptian Arabic noun, Arabic feminine?]
const KIND_WORDS = {
  cup: ['cup', 'كوباية', true],
  mug: ['mug', 'مج', false],
  tumbler: ['tumbler', 'تمبلر', false],
  bottle: ['bottle', 'زمزمية', true],
};
/**
 * A neutral description made only from what was measured and chosen: no promises the product may not keep
 * (dishwasher, insulation, lid…), "stainless steel" only when the material is metal.
 */
function describe(spec) {
  const [en, ar, fem] = KIND_WORDS[spec.kind] || KIND_WORDS.cup;
  const g = (m, f) => (fem ? f : m);
  const h = spec.dims.heightMm;
  const d = spec.dims.topDiaMm;
  const band = spec.print.heightMm;
  const handle = Boolean(spec.handle);
  const Cap = en[0].toUpperCase() + en.slice(1);
  const enHead = spec.material === 'metal' ? `Stainless steel ${en}` : `${Cap} with a ${spec.material === 'matte' ? 'matte' : 'glossy'} finish`;
  const arHead = spec.material === 'metal' ? `${ar} ستانلس ستيل` : `${ar} ${spec.material === 'matte' ? g('مطفي', 'مطفية') : g('لامع', 'لامعة')}`;
  return {
    en: `${enHead}${handle ? (spec.material === 'metal' ? ' with a handle' : ', with a handle') : ''}. Your design is printed around the body (print area ${band} mm high), made for this ${en}'s own measured size: ${h} mm tall, ${d} mm across the top.`,
    ar: `${arHead}${handle ? ' بإيد' : ''}. تصميمك بيتطبع حوالين ${g('الجسم بتاعه', 'الجسم بتاعها')} (ارتفاع منطقة الطباعة ${band} مم)، على ${g('مقاسه', 'مقاسها')} المظبوط: ${g('ارتفاعه', 'ارتفاعها')} ${h} مم و${g('قطره', 'قطرها')} من فوق ${d} مم.`,
  };
}

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
  // One physical size: the template's first (its id and surcharge), without a print scale (the geometry is the
  // measured one), named from the measurements instead of the template's "20 oz (590 ml)".
  if (p.sizes && p.sizes.length) {
    const { printScale, ...z } = p.sizes[0];
    p.sizes = [{ ...z, label: sizeLabel(spec) }];
  }
  // One neutral colour named after the material, instead of the template's list (the owner adds more on the
  // product's page: catalog.clean takes colorsFor() as the product's own colours).
  p.colors = colorsFor(spec);
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
  // (Before the edit's own description is laid on: the owner's text wins.)
  p.description = describe(spec);
  p.drink = { kind: spec.kind, material: spec.material, dims: { ...spec.dims }, template: fan.template, mockup: spec.mockup || null };
  return p;
}

// ---------- Slice 2: measured from photos (src/photo-product-routes.js) ----------
const DIFF_WARN_PCT = 2; // typed vs measured: a warning above this (typed wins)
const PROFILE_FAR = 0.15; // a measured radius further than this from the typed cone: the profile is not used
const MAX_PROFILE = 64;
const pct = (measured, typed) => r1(((measured - typed) / typed) * 100);

/** Typed vs measured, in % of the typed value: { heightPct, topPct, bottomPct, warn: [keys over 2 %] }. */
function diffsOf(typed, measured) {
  const out = { heightPct: pct(measured.heightMm, typed.heightMm), topPct: pct(measured.topDiaMm, typed.topDiaMm), bottomPct: pct(measured.bottomDiaMm, typed.bottomDiaMm) };
  out.warn = ['heightPct', 'topPct', 'bottomPct'].filter((k) => Math.abs(out[k]) > DIFF_WARN_PCT);
  return out;
}

/**
 * The measured profile laid onto the typed size (typed wins): y scaled to the typed height, and each radius moved by
 * the difference between the typed cone and the measured end-to-end cone at that height, so the ends are the typed
 * diameters and only the measured curvature is kept. null when it can't be used: fewer than 3 points, more than 64,
 * not in order, or a radius more than 15 % off the typed cone.
 */
function profileOnTyped(typed, measured) {
  const pts = measured && Array.isArray(measured.profile) ? measured.profile : null;
  if (!pts || pts.length < 3 || pts.length > MAX_PROFILE) return null;
  const mh = pts[pts.length - 1][0] - pts[0][0];
  if (!(mh > 0)) return null;
  const tr = (f) => (typed.topDiaMm + (typed.bottomDiaMm - typed.topDiaMm) * f) / 2;
  const mr0 = pts[0][1];
  const mr1 = pts[pts.length - 1][1];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [y, r] = pts[i];
    if (i && !(y > pts[i - 1][0])) return null;
    const f = (y - pts[0][0]) / mh;
    const want = tr(f);
    if (Math.abs(r - (mr0 + (mr1 - mr0) * f)) / want > PROFILE_FAR || Math.abs(r - want) / want > PROFILE_FAR) return null;
    const rr = r + (want - (mr0 + (mr1 - mr0) * f));
    if (!(rr > 0)) return null;
    out.push([r1(f * typed.heightMm), r2(rr)]);
  }
  out[0] = [0, r2(typed.topDiaMm / 2)];
  out[out.length - 1] = [typed.heightMm, r2(typed.bottomDiaMm / 2)];
  return out;
}

module.exports = { diffsOf, profileOnTyped, DIFF_WARN_PCT, MAX_PROFILE,
  buildSpec, applyTo, templateFor, fanFor, describe, sizeLabel, volumeMl, colorsFor, KINDS, MATERIALS, LIMITS };
