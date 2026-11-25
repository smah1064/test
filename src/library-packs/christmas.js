'use strict';
/*
 * Christmas cards pack: 4 watercolour Christmas cards (mailbox, stocking, tree,
 * hot chocolate) with "Merry Christmas" and a short wish in English, inside a
 * gold frame on white. Bought by the owner with a full licence. Each file is a
 * whole 5 × 7 in card at 300 DPI (public/img/art/christmas/), so the pack goes on
 * the card products only (FITS in src/library.js): printed as it is, filling the card.
 */
const { I, D } = require('../library-dsl');

const categories = [{ id: 'christmas', name: { en: 'Christmas', ar: 'الكريسماس' } }];

// The card's own shape (1500 × 2100 px), shown on the greeting card.
const CARD = { product: 'greetingcard', aspect: 1500 / 2100 };
const art = (id) => `/img/art/christmas/card-${id}.png`;

const designs = [
  ['mailbox', 'Merry Christmas card (red mailbox)', 'كارت كريسماس سعيد (صندوق بريد أحمر)'],
  ['stocking', 'Merry Christmas card (Christmas stocking)', 'كارت كريسماس سعيد (شراب الكريسماس)'],
  ['tree', 'Merry Christmas card (Christmas tree)', 'كارت كريسماس سعيد (شجرة الكريسماس)'],
  ['hot-chocolate', 'Merry Christmas card (hot chocolate)', 'كارت كريسماس سعيد (كوباية هوت شوكليت)'],
].map(([id, en, ar]) => D(`xm-card-${id}`, 'christmas', en, ar, [I(art(id), 1, 0.5, 0.5)], 'white', CARD));

module.exports = { categories, designs };
