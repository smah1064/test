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
 *
 * The words of the cards and quotes are live text (`words`, see wordsArt in
 * public/js/templates.js): the same picture without its words (`…-nowords.svg` and its
 * white copy, `card-…-nowords.png`), with the words set on it as ordinary text where they
 * were drawn, in the same font where the lettering was a free font (Great Vibes, Cookie,
 * Dancing Script, Irish Grover, Julee) and the closest one otherwise (the cards' title and
 * wish: Great Vibes and Playfair Display). The original pictures stay for
 * buildTemplate(…, { words: false }).
 */
const { I, D } = require('../library-dsl');

const categories = [{ id: 'christmas', name: { en: 'Christmas', ar: 'الكريسماس' } }];

// The card's own shape (1500 × 2100 px), shown on the greeting card.
const CARD = { product: 'greetingcard', aspect: 1500 / 2100, products: ['greetingcard', 'foldedcards', 'postcards'] };
const art = (id) => `/img/art/christmas/card-${id}.png`;
// The cards' words (the same on all four), in their gold.
const CARD_GOLD = '#a78a43';
const CARD_WORDS = [
  { text: 'MERRY', font: 'Playfair Display', size: 0.058, x: 0.5008, y: 0.0828, w: 0.1728, spacing: -85, fill: CARD_GOLD },
  { text: 'Christmas', font: 'Great Vibes', size: 0.1615, x: 0.4959, y: 0.141, w: 0.5108, fill: CARD_GOLD },
  { text: 'MAY YOUR HEART BE FILLED WITH LOVE,\nYOUR HOME WITH JOY\nAND YOUR DAYS WITH PEACE.', font: 'Playfair Display', size: 0.0305, x: 0.4998, y: 0.8832, w: 0.7364, spacing: 137, lineHeight: 1.522, fill: CARD_GOLD },
];

const cards = [
  ['mailbox', 'Merry Christmas card (red mailbox)', 'كارت كريسماس سعيد (صندوق بريد أحمر)'],
  ['stocking', 'Merry Christmas card (Christmas stocking)', 'كارت كريسماس سعيد (شراب الكريسماس)'],
  ['tree', 'Merry Christmas card (Christmas tree)', 'كارت كريسماس سعيد (شجرة الكريسماس)'],
  ['hot-chocolate', 'Merry Christmas card (hot chocolate)', 'كارت كريسماس سعيد (كوباية هوت شوكليت)'],
].map(([id, en, ar]) => D(`xm-card-${id}`, 'christmas', en, ar, [
  I(art(id), 1, 0.5, 0.5, { words: { src: `/img/art/christmas/card-${id}-nowords.png`, texts: CARD_WORDS } }),
], 'white', CARD));

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

// The words of each quote: its font, then [text, size, x, y, w, extra?] per line, measured on the
// drawn words (x, y their centre, as fractions of the picture's box; size and w as fractions of its width).
// Without a fill they take the ink, like the drawing.
const GV = { font: 'Great Vibes' };
const CK = { font: 'Cookie' };
const DS = { font: 'Dancing Script', weight: 'bold' };
const IG = { font: 'Irish Grover' };
const JU = { font: 'Julee' };
const WORDS = {
  'cold-outside': [CK, ['It’s', 0.434, 0.2116, 0.1648, 0.4247], ['Cold', 0.434, 0.3029, 0.4941, 0.584], ['Outside', 0.434, 0.4843, 0.8234, 0.9645]],
  noel: [JU, ['Noel', 0.36, 0.4984, 0.5096, 0.6245]],
  'tis-the-season': [GV, ['Tis', 0.234, 0.3602, 0.4098, 0.3216], ['The Season', 0.23, 0.4828, 0.8064, 0.954]],
  'merry-christmas-santa': [CK, ['Merry', 0.315, 0.3504, 0.4018, 0.5682], ['Christmas', 0.315, 0.4427, 0.8002, 0.8681]],
  'season-greetings': [GV, ['Season', 0.23, 0.4856, 0.3942, 0.5714], ['Greetings', 0.229, 0.345, 0.6712, 0.6499]],
  'winter-blessings': [DS, ['Winter', 0.209, 0.4708, 0.4178, 0.5513], ['Blessings', 0.21, 0.3577, 0.6829, 0.7154]],
  'merry-and-bright': [GV, ['Merry', 0.313, 0.5689, 0.2632, 0.7807], ['And', 0.314, 0.2289, 0.5019, 0.4473], ['Bright', 0.313, 0.5004, 0.7862, 0.7554]],
  joy: [IG, ['Joy', 0.357, 0.5226, 0.4736, 0.5606]],
  'happy-new-year': [DS, ['Happy', 0.314, 0.5658, 0.252, 0.7256], ['New', 0.314, 0.2492, 0.5237, 0.5106], ['Year', 0.314, 0.3431, 0.8184, 0.5766]],
  'let-it-snow': [DS, ['Let', 0.312, 0.3423, 0.4867, 0.3831], ['It Snow', 0.312, 0.4963, 0.8253, 0.9594]],
  'oh-deer': [IG, ['oh', 0.357, 0.5006, 0.4295, 0.389], ['Deer', 0.357, 0.5096, 0.6027, 0.7887]],
  'peace-on-earth-deer': [DS, ['Peace', 0.285, 0.6962, 0.4029, 0.5601], ['on', 0.287, 0.5549, 0.5852, 0.2426], ['Earth', 0.287, 0.5627, 0.8125, 0.5982]],
  'tis-the-season-to-sparkle': [DS, ['Tis', 0.24, 0.3057, 0.237, 0.2461], ['The Season', 0.24, 0.4859, 0.4875, 0.9907], ['To Sparkle', 0.24, 0.4572, 0.7864, 0.9338]],
  peace: [JU, ['Peace', 0.357, 0.4945, 0.5056, 0.7806]],
  'santa-we-believe': [DS, ['Santa', 0.372, 0.4225, 0.2335, 0.8237], ['We', 0.372, 0.3083, 0.5412, 0.4724], ['Believe', 0.372, 0.4882, 0.8477, 0.9557]],
  'homemade-by-elves': [GV, ['Homemade', 0.203, 0.4945, 0.333, 0.8192], ['By', 0.208, 0.1537, 0.7431, 0.2973], ['elves', 0.196, 0.4896, 0.7423, 0.2551]],
  'ho-ho-ho': [JU, ['Ho !', 0.363, 0.4486, 0.1789, 0.5901], ['Ho !', 0.364, 0.6865, 0.5104, 0.5908], ['Ho !', 0.363, 0.6938, 0.8403, 0.5904]],
  'christmas-vibes': [GV, ['Christmas', 0.313, 0.4702, 0.2282, 0.9895], ['Vibes', 0.316, 0.3341, 0.6426, 0.6411]],
  'oh-holy-night': [GV, ['Oh', 0.351, 0.7583, 0.2818, 0.3831], ['Holy', 0.353, 0.4425, 0.5152, 0.8213], ['Night', 0.351, 0.564, 0.7902, 0.7606]],
  'jingle-bells': [DS, ['Jingle\nBells', 0.291, 0.51, 0.5487, 0.6163, { lineHeight: 0.769 }]],
  'peace-on-earth': [DS, ['Peace', 0.357, 0.5923, 0.3674, 0.7015], ['on', 0.358, 0.4102, 0.4947, 0.3022], ['Earth', 0.357, 0.4293, 0.6355, 0.7451]],
  'nice-list-approved': [GV, ['Nice', 0.212, 0.1952, 0.3764, 0.3715], ['List', 0.199, 0.5172, 0.5002, 0.2819], ['Approved', 0.21, 0.3424, 0.7548, 0.6104]],
  'santa-please-stop-here': [GV, ['Santa', 0.261, 0.6141, 0.4135, 0.5685], ['Please', 0.248, 0.299, 0.5615, 0.5812], ['Stop', 0.261, 0.7499, 0.6944, 0.4714], ['Here', 0.254, 0.3631, 0.8439, 0.5494]],
  love: [IG, ['Love', 0.362, 0.5001, 0.5149, 0.7288]],
  'happy-holiday': [GV, ['Happy', 0.249, 0.3566, 0.3989, 0.6932], ['Holiday', 0.246, 0.4228, 0.7435, 0.7967]],
  'joy-to-the-world': [DS, ['Joy', 0.363, 0.2349, 0.1668, 0.43], ['To The', 0.363, 0.4193, 0.5046, 0.8668], ['World', 0.363, 0.4378, 0.8344, 0.8742]],
  'holiday-baking-team': [GV, ['Holiday', 0.224, 0.6083, 0.2695, 0.724], ['Baking', 0.224, 0.3066, 0.5448, 0.6009], ['Team', 0.226, 0.3679, 0.8362, 0.459]],
  'peace-joy': [IG, ['Peace', 0.346, 0.5232, 0.3693, 0.9519, { spacing: 7 }], ['Joy', 0.345, 0.3785, 0.5918, 0.5408]],
};
const words = (id) => {
  const [font, ...lines] = WORDS[id];
  return {
    src: `/img/art/christmas/${id}-nowords.svg`,
    dark: `/img/art/christmas/${id}-nowords-white.svg`,
    texts: lines.map(([text, size, x, y, w, extra]) => ({ text, ...font, size, x, y, w, ...extra })),
  };
};

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
    I(vec(id), 0.86, 0.5, 0.42, { h: 1.1, dark: white(id), words: words(id) }),
  ], color)),
];

module.exports = { categories, designs };
