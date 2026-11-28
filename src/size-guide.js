'use strict';

/**
 * Size guides for the clothing (owner, 28 Nov 2026: the site is prepaid only and every piece is printed to order, so
 * a customer must be able to choose the right size before paying).
 *
 * The owner chose to publish typical Egyptian-market measurements now, marked approximate (± 2 cm), until the
 * supplier's own chart replaces them. Every number is the garment laid flat, in centimetres:
 *   chest  - straight across, armpit to armpit (the body is twice this)
 *   length - from the highest point of the shoulder to the hem
 *   sleeve - from the shoulder seam to the cuff (long sleeves) or to the sleeve's end (short sleeves)
 *   waist  - straight across the waistband, relaxed (shorts)
 *   height - the child's height the size is for (kids and baby)
 *
 * finder: how the size finder suggests a size.
 *   'adult' - height (cm) and weight (kg) against each size's bands; between two, the bigger one.
 *   'kids'  - the child's height (cm) against each size's band.
 * shift: sizes to move the finder's answer for a cut (an oversized tee is cut big: the usual size is suggested,
 * and the fit note says to size down for a regular fit).
 */

const t = (en, ar) => ({ en, ar });

// Adult bands (unisex regular fit): the body each size is cut for.
const ADULT_BANDS = {
  S: { height: [155, 168], weight: [45, 60] },
  M: { height: [165, 175], weight: [58, 70] },
  L: { height: [172, 180], weight: [68, 80] },
  XL: { height: [177, 186], weight: [78, 92] },
  '2XL': { height: [182, 192], weight: [90, 105] },
  '3XL': { height: [185, 200], weight: [103, 125] },
};
const KIDS_HEIGHT = {
  '2-4': [92, 104], '4-6': [104, 116], '6-8': [116, 128], '8-10': [128, 140], '10-12': [140, 152],
  kids: [128, 152],
};
const BABY_HEIGHT = { '0-3': [50, 62], '3-6': [62, 68], '6-12': [68, 80], '12-18': [80, 86] };

// What the finder takes as a real person: adults' height (cm) and weight (kg), a child's and a baby's height (cm).
const RANGE = { height: [120, 220], weight: [30, 200], kids: [80, 170], baby: [40, 100] };
const ADULT = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const rows = (ids, cols) => Object.fromEntries(ids.map((id, i) => [id, Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v[i]]))]));

const FIT = {
  regular: t('Regular fit: true to size. Between two sizes, take the bigger one.', 'قصة عادية: اختار مقاسك المعتاد. لو بين مقاسين، خد الأكبر.'),
  oversized: t('Oversized fit: cut wide and dropped at the shoulder. Take your usual size for the loose look, or one size smaller for a regular fit.', 'قصة أوفر سايز: واسعة وكتفها نازل. خد مقاسك المعتاد للشكل الواسع، أو مقاس أصغر لو عايزها عادية.'),
  hoodie: t('Relaxed fit with room for a layer underneath. Between two sizes, take the bigger one.', 'قصة مريحة فيها مكان للبس تحتها. لو بين مقاسين، خد الأكبر.'),
  polo: t('Regular fit with a slightly fitted body. Between two sizes, take the bigger one.', 'قصة عادية والجسم مظبوط شوية. لو بين مقاسين، خد الأكبر.'),
  denim: t('Classic jacket fit, made to wear over a T-shirt. Denim doesn’t stretch: between two sizes, take the bigger one.', 'قصة جاكيت كلاسيك تتلبس فوق تيشيرت. الجينز مابيمطّش: لو بين مقاسين، خد الأكبر.'),
  shorts: t('Elastic waist with a drawstring: the waist stretches about 8 cm more.', 'وسط أستك برباط: الوسط بيوسع حوالي 8 سم زيادة.'),
  jersey: t('Athletic fit, light and breathable. Between two sizes, take the bigger one.', 'قصة رياضية خفيفة وبتهوّي. لو بين مقاسين، خد الأكبر.'),
  kids: t('Sizes go by the child’s height, not age: children grow fast, so between two sizes take the bigger one.', 'المقاسات حسب طول الطفل مش سنّه: الأطفال بيكبروا بسرعة، فلو بين مقاسين خد الأكبر.'),
  baby: t('Sizes go by the baby’s height. Snap buttons at the bottom for easy changing.', 'المقاسات حسب طول البيبي. كباسين من تحت عشان التغيير يبقى سهل.'),
};

const GUIDES = {
  tshirt: { fit: FIT.regular, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [48, 52, 56, 60, 64, 68], length: [70, 72, 74, 76, 78, 80], sleeve: [20, 21, 22, 23, 24, 25] }) },
  oversized: { fit: FIT.oversized, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [54, 58, 62, 66, 70, 74], length: [70, 72, 74, 76, 78, 80], sleeve: [22, 23, 24, 25, 26, 27] }) },
  polo: { fit: FIT.polo, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [49, 52, 55, 58, 61, 64], length: [69, 71, 73, 75, 77, 79], sleeve: [20, 21, 22, 23, 24, 25] }) },
  hoodie: { fit: FIT.hoodie, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [52, 56, 60, 64, 68, 72], length: [68, 70, 72, 74, 76, 78], sleeve: [62, 63, 64, 65, 66, 67] }) },
  ziphoodie: { fit: FIT.hoodie, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [52, 56, 60, 64, 68, 72], length: [68, 70, 72, 74, 76, 78], sleeve: [62, 63, 64, 65, 66, 67] }) },
  sweatshirt: { fit: FIT.hoodie, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [50, 54, 58, 62, 66, 70], length: [66, 68, 70, 72, 74, 76], sleeve: [61, 62, 63, 64, 65, 66] }) },
  denim: { fit: FIT.denim, finder: 'adult', cols: ['chest', 'length', 'sleeve'], rows: rows(ADULT, { chest: [52, 55, 58, 61, 64, 67], length: [64, 66, 68, 70, 72, 74], sleeve: [62, 63, 64, 65, 66, 67] }) },
  shorts: { fit: FIT.shorts, finder: 'adult', cols: ['waist', 'length'], rows: rows(ADULT, { waist: [35, 38, 41, 44, 47, 50], length: [45, 46, 47, 48, 49, 50] }) },
  jersey: {
    fit: FIT.jersey, finder: 'adult', cols: ['chest', 'length'],
    rows: { kids: { chest: 42, length: 56, height: '128–152' }, ...rows(ADULT, { chest: [50, 53, 56, 59, 62, 65], length: [70, 72, 74, 76, 78, 80] }) },
    kidsSize: 'kids',
  },
  kidstee: { fit: FIT.kids, finder: 'kids', cols: ['height', 'chest', 'length'], rows: rows(['2-4', '4-6', '6-8', '8-10', '10-12'], { height: ['92–104', '104–116', '116–128', '128–140', '140–152'], chest: [32, 35, 38, 41, 44], length: [42, 46, 50, 54, 58] }) },
  kidshoodie: { fit: FIT.kids, finder: 'kids', cols: ['height', 'chest', 'length', 'sleeve'], rows: rows(['4-6', '6-8', '8-10', '10-12'], { height: ['104–116', '116–128', '128–140', '140–152'], chest: [37, 40, 43, 46], length: [46, 50, 54, 58], sleeve: [40, 44, 48, 52] }) },
  onesie: { fit: FIT.baby, finder: 'kids', cols: ['height', 'chest', 'length'], rows: rows(['0-3', '3-6', '6-12', '12-18'], { height: ['50–62', '62–68', '68–80', '80–86'], chest: [21, 23, 25, 27], length: [34, 38, 42, 46] }) },
};

/** The size the finder suggests, or null. by: { height, weight } (adult) or { height } (kids), in cm and kg. */
function suggest(productId, sizeIds, by) {
  const g = GUIDES[productId];
  if (!g || !by) return null;
  const h = Number(by.height);
  if (!Number.isFinite(h) || h <= 0) return null;
  if (g.finder === 'kids') {
    // (A height no child or baby of these sizes has: no answer. QA 28 Nov.)
    const [lo, hi] = productId === 'onesie' ? RANGE.baby : RANGE.kids;
    if (h < lo || h > hi) return null;
    const bands = productId === 'onesie' ? BABY_HEIGHT : KIDS_HEIGHT;
    const ids = sizeIds.filter((id) => bands[id]);
    // The first size whose band reaches this height; taller than every band: the biggest.
    return ids.find((id) => h <= bands[id][1]) || (ids.length ? ids[ids.length - 1] : null);
  }
  const w = Number(by.weight);
  if (!Number.isFinite(w) || w <= 0) return null;
  // (Impossible numbers get no size: 50 cm / 20 kg answered S, 250 cm / 300 kg answered 3XL. QA 28 Nov.)
  const kidsToo = Boolean(g.kidsSize && sizeIds.includes(g.kidsSize));
  if (h < (kidsToo ? RANGE.kids[0] : RANGE.height[0]) || h > RANGE.height[1] || w < (kidsToo ? 15 : RANGE.weight[0]) || w > RANGE.weight[1]) return null;
  // A child's height asked on a jersey that has a kids size: the kids size.
  if (g.kidsSize && sizeIds.includes(g.kidsSize) && h < 150 && w < 45) return g.kidsSize;
  const ids = sizeIds.filter((id) => ADULT_BANDS[id]);
  if (!ids.length) return null;
  // The size for the weight and the size for the height; the bigger of the two (a tall slim person needs the
  // length, a short heavy one the chest).
  const pick = (key, v) => {
    const i = ids.findIndex((id) => v <= ADULT_BANDS[id][key][1]);
    return i === -1 ? ids.length - 1 : i;
  };
  return ids[Math.max(pick('weight', w), pick('height', h))];
}

/** The guide as the browser gets it (on the product), or null for a product without one. */
function guideFor(product) {
  const g = GUIDES[product.id];
  if (!g || !product.sizes || product.sizes.length < 2) return null;
  const ids = product.sizes.map((s) => s.id);
  return {
    approx: true,
    range: g.finder === 'kids' ? { height: product.id === 'onesie' ? RANGE.baby : RANGE.kids }
      : { height: [g.kidsSize ? RANGE.kids[0] : RANGE.height[0], RANGE.height[1]], weight: [g.kidsSize ? 15 : RANGE.weight[0], RANGE.weight[1]] },
    fit: g.fit,
    finder: g.finder,
    cols: g.cols,
    rows: ids.filter((id) => g.rows[id]).map((id) => ({ id, ...g.rows[id] })),
    ...(g.finder === 'adult' ? { bands: Object.fromEntries(ids.filter((id) => ADULT_BANDS[id]).map((id) => [id, ADULT_BANDS[id]])) } : {}),
    ...(g.finder === 'kids' ? { heights: Object.fromEntries(ids.map((id) => [id, (product.id === 'onesie' ? BABY_HEIGHT : KIDS_HEIGHT)[id]]).filter(([, v]) => v)) } : {}),
    ...(g.kidsSize ? { kidsSize: g.kidsSize } : {}),
  };
}

module.exports = { GUIDES, RANGE, suggest, guideFor, ADULT_BANDS, KIDS_HEIGHT, BABY_HEIGHT };
