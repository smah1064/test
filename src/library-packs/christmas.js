'use strict';
/*
 * Christmas pack, bought by the owner with a full licence (public/img/art/christmas/):
 *  - 4 watercolour Christmas cards (mailbox, stocking, tree, hot chocolate) with
 *    "Merry Christmas" and a short wish inside a gold frame. Each file is a whole
 *    5 × 7 in card at 300 DPI, so they go on the card products only, filling the card.
 *  - 28 one-colour Christmas quotes in English ("Let it snow", "Ho! Ho! Ho!"...), vectors
 *    with a white copy (`dark`) for dark colours, for clothes, mugs, home and postcards
 *    (FITS in src/library.js). Two quotes in the bundle are misspelt in the artwork
 *    ("Belives", "Belive") and were left out.
 *  - 4 colour pictures of two decorated Christmas trees with bows, full-size transparent
 *    PNGs (300 DPI) with no words. They read on light and dark colours alike, so the
 *    picture is its own `dark` copy.
 */
const { I, D } = require('../library-dsl');

const categories = [{ id: 'christmas', name: { en: 'Christmas', ar: 'الكريسماس' } }];

// The card's own shape (1500 × 2100 px), shown on the greeting card.
const CARD = { product: 'greetingcard', aspect: 1500 / 2100, products: ['greetingcard', 'foldedcards', 'postcards'] };
const art = (id) => `/img/art/christmas/card-${id}.png`;

const cards = [
  ['mailbox', 'Merry Christmas card (red mailbox)', 'كارت كريسماس سعيد (صندوق بريد أحمر)'],
  ['stocking', 'Merry Christmas card (Christmas stocking)', 'كارت كريسماس سعيد (شراب الكريسماس)'],
  ['tree', 'Merry Christmas card (Christmas tree)', 'كارت كريسماس سعيد (شجرة الكريسماس)'],
  ['hot-chocolate', 'Merry Christmas card (hot chocolate)', 'كارت كريسماس سعيد (كوباية هوت شوكليت)'],
].map(([id, en, ar]) => D(`xm-card-${id}`, 'christmas', en, ar, [I(art(id), 1, 0.5, 0.5)], 'white', CARD));

// [file, English name, Arabic name, shop colour]
const QUOTES = [
  ['cold-outside', 'It\'s cold outside', 'الدنيا برد برا', 'white'],
  ['noel', 'Noel', 'نويل', 'black'],
  ['tis-the-season', 'Tis the season (reindeer)', 'ده موسمه (رنة)', 'white'],
  ['merry-christmas-santa', 'Merry Christmas (Santa)', 'كريسماس سعيد (بابا نويل)', 'black'],
  ['season-greetings', 'Season\'s greetings (snowman)', 'تهاني الموسم (رجل التلج)', 'white'],
  ['winter-blessings', 'Winter blessings (Christmas tree)', 'بركات الشتا (شجرة الكريسماس)', 'black'],
  ['merry-and-bright', 'Merry and bright (gifts)', 'فرحة ونور (هدايا)', 'white'],
  ['joy', 'Joy', 'فرحة', 'black'],
  ['happy-new-year', 'Happy New Year (reindeer)', 'سنة سعيدة (رنة)', 'white'],
  ['let-it-snow', 'Let it snow (snowman)', 'خليها تتلج (رجل التلج)', 'black'],
  ['oh-deer', 'Oh deer', 'أوه دير (يا غزالي)', 'white'],
  ['peace-on-earth-deer', 'Peace on earth (reindeer)', 'سلام على الأرض (رنة)', 'black'],
  ['tis-the-season-to-sparkle', 'Tis the season to sparkle (sleigh)', 'ده موسم اللمعة (زحافة)', 'white'],
  ['peace', 'Peace', 'سلام', 'black'],
  ['santa-we-believe', 'Santa we believe', 'بابا نويل إحنا مصدقينك', 'white'],
  ['homemade-by-elves', 'Homemade by elves (bells)', 'معمول في البيت بإيد الأقزام (أجراس)', 'black'],
  ['ho-ho-ho', 'Ho! Ho! Ho! (Santa)', 'هو هو هو! (بابا نويل)', 'white'],
  ['christmas-vibes', 'Christmas vibes (reindeer)', 'جو الكريسماس (رنة)', 'black'],
  ['oh-holy-night', 'Oh holy night (gifts)', 'يا ليلة مقدسة (هدايا)', 'white'],
  ['jingle-bells', 'Jingle bells', 'جينجل بيلز (أجراس)', 'black'],
  ['peace-on-earth', 'Peace on earth', 'سلام على الأرض', 'white'],
  ['nice-list-approved', 'Nice list approved (snowman)', 'في قايمة الشطار (رجل التلج)', 'black'],
  ['santa-please-stop-here', 'Santa please stop here', 'بابا نويل، اقف هنا لو سمحت', 'white'],
  ['love', 'Love', 'حب', 'black'],
  ['happy-holiday', 'Happy holiday (reindeer)', 'إجازة سعيدة (رنة)', 'white'],
  ['joy-to-the-world', 'Joy to the world (holly)', 'فرحة للعالم كله', 'black'],
  ['holiday-baking-team', 'Holiday baking team (gingerbread man)', 'فريق خبيز العيد (كوكيز جينجر بريد)', 'white'],
  ['peace-joy', 'Peace, joy (holly)', 'سلام وفرحة', 'black'],
];
const vec = (id) => `/img/art/christmas/${id}.svg`;
const white = (id) => `/img/art/christmas/${id}-white.svg`;

// [file, English name, Arabic name, shop colour]
const TREES = [
  ['trees-plaid-bows', 'Two Christmas trees with plaid bows', 'شجرتين كريسماس بفيونكات كاروهات', 'white'],
  ['trees-holly-plaid', 'Holly and plaid Christmas trees', 'شجرتين كريسماس بالهولي والكاروهات', 'black'],
  ['trees-big-bows', 'Christmas trees with big bows', 'شجرتين كريسماس بفيونكات كبيرة', 'white'],
  ['trees-gingham', 'Green and gingham Christmas trees', 'شجرتين كريسماس خضرا ومربعات', 'black'],
];
const png = (id) => `/img/art/christmas/${id}.png`;

const designs = [
  ...cards,
  ...TREES.map(([id, en, ar, color]) => D(`xm-${id}`, 'christmas', en, ar, [
    I(png(id), 0.9, 0.5, 0.44, { h: 1.1, dark: png(id) }),
  ], color)),
  // The quote sits a little above the middle (chest height on a T-shirt).
  ...QUOTES.map(([id, en, ar, color]) => D(`xm-${id}`, 'christmas', en, ar, [
    I(vec(id), 0.86, 0.5, 0.42, { h: 1.1, dark: white(id) }),
  ], color)),
];

module.exports = { categories, designs };
