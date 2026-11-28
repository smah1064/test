'use strict';

/*
 * The little language ready designs and templates are written in (see
 * src/library.js and src/library-packs/). Positions and sizes are fractions of
 * the print area, so a layout fits any product:
 *   x, y   centre of the element (0..1 of the area's width / height)
 *   size   text height, as a fraction of the area's width
 *   w      width of a shape, sticker or icon (fraction of the area's width); h caps its height
 * Text without `fill` uses dark or light ink to suit the garment colour.
 */
const ACCENT = '#ff5a36';
const GOLD = '#e0a526';
const GREEN = '#2f9e44';
const PINK = '#e64980';
const BLUE = '#1c7ed6';
const PURPLE = '#7048e8';
const TEAL = '#0ca678';
const RED = '#e03131';

/** Text. extra: fill, weight ('bold'), outline, spacing, bg (+ bgShape 'box'|'banner'|'pill'), curve, glow, shadow, extrude, angle. */
const T = (text, font, size, x, y, extra = {}) => ({ kind: 'text', text, font, size, x, y, ...extra });
/** One of the editor's shapes (src: public/js/templates.js SHAPES). extra: fill, stroke, angle, opacity. */
const S = (shape, w, x, y, extra = {}) => ({ kind: 'shape', shape, w, x, y, ...extra });
/** One of the shop's own stickers (public/js/stickers.js). */
const K = (sticker, w, x, y, extra = {}) => ({ kind: 'sticker', sticker, w, x, y, ...extra });
/** A library icon or sticker by id ('fluent-emoji-flat:star', 'tabler:ball-football'). Icons take `fill` (or the ink). */
const A = (art, w, x, y, extra = {}) => ({ kind: 'art', art, w, x, y, ...extra });
/**
 * Artwork from the shop's own files (public/img/art/...: .svg vector art, .png illustrations).
 * w (and h) as for stickers.
 */
const I = (src, w, x, y, extra = {}) => ({ kind: 'image', src, w, x, y, ...extra });
/** A ready design: shown on a T-shirt of `color` in the shop; `aspect` is the print area's shape it was drawn for. */
const D = (id, category, en, ar, items, color = 'white', extra = {}) => ({ id, category, name: { en, ar }, kind: 'template', product: 'tshirt', color, items, aspect: 0.75, ...extra });

module.exports = { T, S, K, A, I, D, ACCENT, GOLD, GREEN, PINK, BLUE, PURPLE, TEAL, RED };
