'use strict';

/**
 * DTF gang sheets: customers upload their own artwork, choose sizes and
 * quantities, and everything is nested onto a 56 cm (22 in) roll of film.
 * The sheet is priced by the length it uses. The same packer runs in the
 * browser, so the customer sees exactly what the server will price.
 */
const { pack } = require('../public/js/nesting');

const GANG = {
  rollWidthCm: 56,
  gapCm: 0.6,
  minLengthCm: 50,
  maxLengthCm: 500,
  stepCm: 10, // length is billed in 10 cm steps
  pricePerMeter: 400, // EGP
  maxImages: 30,
  maxCopies: 300,
  minSideCm: 1,
  recommendedDpi: 300,
  minDpi: 150,
};

/** Expand quantities, nest everything and price the sheet. Throws a message key on bad input. */
function layoutSheet(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('gangEmpty');
  if (items.length > GANG.maxImages) throw new Error('gangTooMany');
  const pieces = [];
  items.forEach((it, i) => {
    const w = Number(it.wCm);
    const h = Number(it.hCm);
    const qty = Math.floor(Number(it.qty));
    if (!(w >= GANG.minSideCm && h >= GANG.minSideCm) || !(qty >= 1 && qty <= GANG.maxCopies)) throw new Error('gangBadItem');
    if (Math.min(w, h) > GANG.rollWidthCm) throw new Error('gangTooWide');
    for (let c = 0; c < qty; c++) pieces.push({ id: `${i}:${c}`, w, h, item: i });
  });
  if (pieces.length > 2000) throw new Error('gangTooMany');
  const { placements, length } = pack(pieces, GANG.rollWidthCm, GANG.gapCm);
  const used = Math.max(GANG.minLengthCm, Math.ceil((length + GANG.gapCm) / GANG.stepCm) * GANG.stepCm);
  if (used > GANG.maxLengthCm) throw new Error('gangTooLong');
  return {
    placements: placements.map((p) => ({ item: Number(String(p.id).split(':')[0]), x: p.x, y: p.y, w: p.w, h: p.h, rotated: p.rotated })),
    lengthCm: used,
    price: Math.round((used / 100) * GANG.pricePerMeter),
  };
}

module.exports = { GANG, layoutSheet };
