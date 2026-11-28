'use strict';

// Two-layer wood pieces (owner's go, 28 Nov 2026): ready designs drawn for each product's own shape and
// offered only there (`products`, like the CNC and UV pack; the products are in OWN_DESIGNS_ONLY).
//
// Every piece comes out in ONE material: the design is cut as a second layer and glued on the board (the
// tall calligraphy panel, the round door hanger, the key holder, the wooden invitation), or it IS the cut
// piece standing in a slotted base (the Ramadan tea-light scene, the couple names stand). So the designs
// use no colours (everything takes the product's ink) and nothing that would break off when it is cut:
// bold weights only, no thin lines, no tiny dots. Our own ornaments (public/img/art/svg/twolayer-*.svg:
// corner scrolls, a flowering vine, a garland, a lantern) are solid one-colour shapes for the same reason.
//
// The two cut pieces (ramadanlight, couplestand: `laser.pieces: 'one'`) must come out as ONE piece: every
// element touches the rest. They use heavy fonts only (the shop draws a 2.5 mm outline round cut letters,
// `laser.bridgeMm`, which joins each word's letters and dots), each word stands on a bar or a frame, the
// bars are joined by posts, and lanterns hang from the frame on their own thick string. Text is never put
// ON a solid bar: cut from the same material it would disappear into it.
//
// The key holder keeps its bottom ~15% clear (the hooks go there); the door hanger keeps everything well
// inside the circle. Names, dates and places are samples the customer replaces (sampleName: the design
// page asks for them); every date's weekday is the real one (test/library-cnc-twolayer.test.js). Only
// short, well-known phrases; no Quran verses beyond them.
const { T, S, A, I, D } = require('../library-dsl');

const categories = [];

/** A designer for one product: (id, category, en, ar, items, colour?) -> design, drawn for `aspect` (width / height). */
const forProduct = (product, aspect, color) => (id, category, en, ar, items, c = color) => D(id, category, en, ar, items, c, { product, aspect, products: [product] });

// Print areas (src/products.js): width / height.
const panel = forProduct('calligraphypanel', 220 / 440, 'walnut');
const hanger = forProduct('doorhanger', 1, 'olive');
const keys = forProduct('keyholder', 400 / 160, 'walnut');
const light = forProduct('ramadanlight', 1, 'wood');
const couple = forProduct('couplestand', 1, 'wood');
const invite = forProduct('woodinvite', 210 / 297, 'maple');

// Our own solid ornaments.
const art = (id) => `/img/art/svg/twolayer-${id}.svg`;

// The four corner ornaments of the tall panel (the art is drawn for the top-left corner and turned).
const corners = (w = 0.26, x = 0.2, y = 0.115) => [
  I(art('corner'), w, x, y),
  I(art('corner'), w, 1 - x, y, { angle: 90 }),
  I(art('corner'), w, 1 - x, 1 - y, { angle: 180 }),
  I(art('corner'), w, x, 1 - y, { angle: 270 }),
];
// A short bold divider: three diamonds (no thin lines on a cut layer).
const dots = (y, x = 0.5, gap = 0.07, w = 0.04) => [S('diamond', w * 0.7, x - gap, y), S('diamond', w, x, y), S('diamond', w * 0.7, x + gap, y)];

// ---- Cut pieces ----
// The frames are our own solid art, drawn 0.84 wide in the middle of the area (0.08 to 0.92): a word stands on a
// shelf whose top edge is at `top` (a fraction of the height) with its baseline (0.3 x its size below its middle)
// just inside the shelf, so the cut letters' outline (laser.bridgeMm) joins it.
const onTop = (top, size) => Math.round((top + 0.002 - 0.3 * size) * 1000) / 1000;

const designs = [
  // ---------- Tall calligraphy wall panel (1:2, the words raised on the board, four corner ornaments) ----------
  panel('cnc2-panel-alhamdulillah', 'islamic', 'Tall panel: Alhamdulillah with family name', 'لوحة طولية: الحمد لله باسم العيلة', [
    ...corners(),
    A('ph:star-four-fill', 0.1, 0.5, 0.2),
    T('الحمد', 'Aref Ruqaa', 0.34, 0.5, 0.37, { weight: 'bold' }),
    T('لله', 'Aref Ruqaa', 0.42, 0.5, 0.56, { weight: 'bold' }),
    ...dots(0.7),
    T('عائلة محمود', 'El Messiri', 0.1, 0.5, 0.79, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
  ]),
  panel('cnc2-panel-mashallah', 'islamic', 'Tall panel: Masha\'Allah', 'لوحة طولية: ما شاء الله', [
    ...corners(),
    S('crescent', 0.12, 0.5, 0.21),
    T('ما شاء', 'Aref Ruqaa', 0.3, 0.5, 0.39, { weight: 'bold' }),
    T('الله', 'Aref Ruqaa', 0.42, 0.5, 0.59, { weight: 'bold' }),
    ...dots(0.76),
  ], 'black'),
  panel('cnc2-panel-bismillah', 'islamic', 'Tall panel: Bismillah ar-Rahman ar-Rahim', 'لوحة طولية: بسم الله الرحمن الرحيم', [
    ...corners(),
    T('بسم', 'Aref Ruqaa', 0.26, 0.5, 0.23, { weight: 'bold' }),
    T('الله', 'Aref Ruqaa', 0.3, 0.5, 0.38, { weight: 'bold' }),
    T('الرحمن', 'Aref Ruqaa', 0.24, 0.5, 0.54, { weight: 'bold' }),
    T('الرحيم', 'Aref Ruqaa', 0.24, 0.5, 0.69, { weight: 'bold' }),
    ...dots(0.8),
  ], 'natural'),
  panel('cnc2-panel-fadl-rabbi', 'islamic', 'Tall panel: This is from my Lord\'s grace, with family name', 'لوحة طولية: هذا من فضل ربي باسم العيلة', [
    ...corners(),
    A('ph:star-four-fill', 0.1, 0.5, 0.2),
    T('هذا من', 'Aref Ruqaa', 0.24, 0.5, 0.33, { weight: 'bold' }),
    T('فضل ربي', 'Aref Ruqaa', 0.24, 0.5, 0.5, { weight: 'bold' }),
    ...dots(0.64),
    T('بيت عائلة', 'El Messiri', 0.08, 0.5, 0.72, { weight: 'bold' }),
    T('الشريف', 'Aref Ruqaa', 0.16, 0.5, 0.8, { weight: 'bold', sampleName: 'family' }),
  ]),
  panel('cnc2-panel-allahu-akbar', 'islamic', 'Tall panel: Allahu Akbar', 'لوحة طولية: الله أكبر', [
    ...corners(),
    A('ph:star-and-crescent-fill', 0.17, 0.5, 0.22),
    T('الله', 'Aref Ruqaa', 0.44, 0.5, 0.42, { weight: 'bold' }),
    T('أكبر', 'Aref Ruqaa', 0.44, 0.5, 0.62, { weight: 'bold' }),
    ...dots(0.78),
  ], 'white'),
  panel('cnc2-panel-family-en', 'family', 'Tall panel: family name with a house (English)', 'لوحة طولية: اسم العيلة وبيت إنجليزي', [
    ...corners(),
    A('ph:house-fill', 0.22, 0.5, 0.25),
    T('THE', 'Montserrat', 0.09, 0.5, 0.38, { weight: 'bold', spacing: 300 }),
    T('HASSANS', 'Playfair Display', 0.17, 0.5, 0.48, { weight: 'bold', sampleName: 'family' }),
    ...dots(0.58),
    T('Home', 'Pacifico', 0.2, 0.5, 0.68),
    T('EST. 2027', 'Montserrat', 0.08, 0.5, 0.79, { weight: 'bold', spacing: 200 }),
  ]),

  // ---------- Round door hanger (30 cm: everything well inside the circle, clear of the rope at the top) ----------
  hanger('cnc2-hanger-ahlan', 'family', 'Door hanger: Ahlan wa sahlan with family name', 'علّاقة باب: أهلاً وسهلاً باسم العيلة', [
    I(art('garland'), 0.42, 0.5, 0.26),
    T('أهلاً وسهلاً', 'Aref Ruqaa', 0.19, 0.5, 0.46, { weight: 'bold' }),
    T('عائلة محمود', 'El Messiri', 0.1, 0.5, 0.65, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
    ...dots(0.78, 0.5, 0.06, 0.04),
  ]),
  hanger('cnc2-hanger-ramadan', 'ramadan', 'Door hanger: Ramadan Kareem with family name', 'علّاقة باب: رمضان كريم باسم العيلة', [
    A('ph:moon-stars-fill', 0.17, 0.5, 0.25),
    T('رمضان كريم', 'Aref Ruqaa', 0.19, 0.5, 0.46, { weight: 'bold' }),
    T('عائلة أحمد', 'El Messiri', 0.1, 0.5, 0.65, { weight: 'bold', sampleName: 'family', samplePart: 'أحمد' }),
    I(art('lantern'), 0.07, 0.5, 0.8),
  ], 'black'),
  hanger('cnc2-hanger-mashallah', 'islamic', 'Door hanger: Masha\'Allah with family name', 'علّاقة باب: ما شاء الله باسم العيلة', [
    A('ph:star-four-fill', 0.1, 0.5, 0.25),
    T('ما شاء الله', 'Aref Ruqaa', 0.21, 0.5, 0.45, { weight: 'bold' }),
    ...dots(0.6, 0.5, 0.06, 0.04),
    T('بيت عائلة الشريف', 'El Messiri', 0.085, 0.5, 0.71, { weight: 'bold', sampleName: 'family', samplePart: 'الشريف' }),
  ], 'walnut'),
  hanger('cnc2-hanger-welcome-en', 'family', 'Door hanger: Welcome, The Hassans (English)', 'علّاقة باب إنجليزي Welcome', [
    A('ph:house-fill', 0.14, 0.5, 0.25),
    T('Welcome', 'Pacifico', 0.19, 0.5, 0.46),
    T('THE HASSANS', 'Montserrat', 0.075, 0.5, 0.64, { weight: 'bold', spacing: 150, sampleName: 'family', samplePart: 'HASSANS' }),
    A('ph:heart-fill', 0.07, 0.5, 0.77),
  ], 'white'),
  hanger('cnc2-hanger-salam', 'islamic', 'Door hanger: As-salamu alaykum with flowers', 'علّاقة باب: السلام عليكم بالورد', [
    A('ph:flower-fill', 0.1, 0.5, 0.22),
    T('السلام', 'Aref Ruqaa', 0.19, 0.5, 0.38, { weight: 'bold' }),
    T('عليكم', 'Aref Ruqaa', 0.19, 0.5, 0.62, { weight: 'bold' }),
    I(art('garland'), 0.4, 0.5, 0.79),
  ]),

  // ---------- Key holder (5:2, the bottom ~15% left clear for the hooks) ----------
  keys('cnc2-keys-house-ar', 'family', 'Key holder: family home with a house', 'علّاقة مفاتيح: بيت عائلة محمود', [
    A('mdi:home-heart', 0.17, 0.86, 0.42),
    T('بيت عائلة محمود', 'Aref Ruqaa', 0.11, 0.42, 0.42, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
  ]),
  keys('cnc2-keys-keys-ar', 'family', 'Key holder: the house keys', 'علّاقة مفاتيح: مفاتيح البيت', [
    A('ph:key-fill', 0.11, 0.14, 0.42, { angle: -30 }),
    T('مفاتيح البيت', 'Aref Ruqaa', 0.13, 0.56, 0.38, { weight: 'bold' }),
    A('ph:heart-fill', 0.05, 0.56, 0.76),
  ], 'natural'),
  keys('cnc2-keys-home-en', 'family', 'Key holder: Home, The Hassans (English)', 'علّاقة مفاتيح إنجليزي Home', [
    T('Home', 'Pacifico', 0.13, 0.5, 0.33),
    A('ph:heart-fill', 0.045, 0.73, 0.22),
    T('THE HASSANS', 'Montserrat', 0.045, 0.5, 0.7, { weight: 'bold', spacing: 250, sampleName: 'family', samplePart: 'HASSANS' }),
  ], 'black'),
  keys('cnc2-keys-crescent-ar', 'islamic', 'Key holder: Masha\'Allah, a crescent and family name', 'علّاقة مفاتيح: ما شاء الله وهلال باسم العيلة', [
    A('ph:moon-stars-fill', 0.13, 0.14, 0.42),
    T('ما شاء الله', 'Aref Ruqaa', 0.11, 0.56, 0.3, { weight: 'bold' }),
    T('عائلة الشريف', 'El Messiri', 0.06, 0.56, 0.68, { weight: 'bold', sampleName: 'family', samplePart: 'الشريف' }),
  ], 'white'),

  // ---------- Ramadan tea-light scene (cut in ONE piece, standing in a base, lit from behind) ----------
  // A solid frame (our art: top bar, side posts, a shelf, a thick base band) holds it together: the lanterns
  // hang from the top bar on their own thick string, the mosque stands on the shelf, the words on the base band.
  // Frame heights (fractions of the area): the shelf's top at 0.584, the base band's at 0.819.
  light('cnc2-light-mosque-frame', 'ramadan', 'Ramadan light: mosque and lanterns in a frame, family name', 'زينة رمضان مضيئة: جامع وفوانيس في إطار باسم العيلة', [
    I(art('frame-scene'), 0.84, 0.5, 0.5),
    I(art('lantern-hanging'), 0.1, 0.24, 0.23),
    I(art('lantern-hanging'), 0.1, 0.76, 0.23),
    A('ph:mosque-fill', 0.42, 0.5, 0.42),
    T('عائلة أحمد', 'Lalezar', 0.15, 0.5, onTop(0.819, 0.15), { sampleName: 'family', samplePart: 'أحمد' }),
  ]),
  light('cnc2-light-crescent-mosque', 'ramadan', 'Ramadan light: crescent, star and mosque, Ramadan Kareem', 'زينة رمضان مضيئة: هلال ونجمة وجامع رمضان كريم', [
    I(art('frame-base'), 0.84, 0.5, 0.71),
    S('crescent', 0.26, 0.25, 0.34),
    S('star', 0.06, 0.36, 0.11),
    A('ph:mosque-fill', 0.4, 0.62, 0.44),
    T('رمضان كريم', 'Lalezar', 0.15, 0.5, onTop(0.819, 0.15)),
    S('diamond', 0.026, 0.51, onTop(0.819, 0.15) + 0.008), // (joins the dot of ن to its letter)
  ]),
  light('cnc2-light-lanterns-family', 'ramadan', 'Ramadan light: three lanterns, Ramadan Kareem and family name', 'زينة رمضان مضيئة: تلات فوانيس رمضان كريم باسم العيلة', [
    I(art('frame-scene'), 0.84, 0.5, 0.5),
    I(art('lantern-hanging'), 0.1, 0.28, 0.23),
    I(art('lantern-hanging'), 0.13, 0.5, 0.272),
    I(art('lantern-hanging'), 0.1, 0.72, 0.23),
    T('رمضان كريم', 'Lalezar', 0.12, 0.5, onTop(0.584, 0.12)),
    S('diamond', 0.022, 0.505, onTop(0.584, 0.12) + 0.007), // (joins the dot of ن to its letter)
    T('عائلة أحمد', 'Lalezar', 0.13, 0.5, onTop(0.819, 0.13), { sampleName: 'family', samplePart: 'أحمد' }),
  ]),
  light('cnc2-light-kareem-en', 'ramadan', 'Ramadan light: crescent and lanterns, Ramadan Kareem, The Ahmeds (English)', 'زينة رمضان مضيئة إنجليزي Ramadan Kareem', [
    I(art('frame-scene'), 0.84, 0.5, 0.5),
    S('crescent', 0.3, 0.5, 0.17, { angle: 90 }),
    I(art('lantern-hanging'), 0.1, 0.24, 0.23),
    I(art('lantern-hanging'), 0.1, 0.76, 0.23),
    T('Ramadan Kareem', 'Pacifico', 0.1, 0.5, onTop(0.584, 0.1)),
    T('THE AHMEDS', 'Lilita One', 0.1, 0.5, onTop(0.819, 0.1), { sampleName: 'family', samplePart: 'AHMEDS' }),
  ]),

  // ---------- Couple names stand (cut in ONE piece, standing in a base; no figures) ----------
  // Our frames carry thick shelves inside the crescent, the heart and the rings' box: the names and the date stand
  // on them, centred in the opening. The Arabic names are two words with a solid heart between them on the shelf: the
// letters' cut outline would fill a plain space («أحمد و سارة» read as one word), and a Latin & inside Arabic reads badly.
  couple('cnc2-couple-crescent', 'wedding', 'Couple stand: names and date in a crescent', 'ستاند العروسين: الاسمين والتاريخ في هلال', [
    I(art('crescent-frame'), 0.84, 0.5, 0.5),
    T('أحمد', 'Lalezar', 0.11, 0.72, onTop(0.55, 0.11), { sampleName: 'his' }),
    S('heart', 0.065, 0.565, 0.527),
    T('سارة', 'Lalezar', 0.11, 0.41, onTop(0.55, 0.11), { sampleName: 'her' }),
    T('14.02.2027', 'Lilita One', 0.075, 0.6, onTop(0.718, 0.075)),
  ]),
  couple('cnc2-couple-heart', 'wedding', 'Couple stand: names and date in a heart', 'ستاند العروسين: الاسمين والتاريخ في قلب', [
    I(art('heart-frame'), 0.84, 0.5, 0.5),
    T('أحمد', 'Lalezar', 0.12, 0.68, onTop(0.475, 0.12), { sampleName: 'his' }),
    S('heart', 0.065, 0.5, 0.451),
    T('سارة', 'Lalezar', 0.12, 0.32, onTop(0.475, 0.12), { sampleName: 'her' }),
    T('14.02.2027', 'Lilita One', 0.065, 0.5, onTop(0.634, 0.065)),
  ]),
  couple('cnc2-couple-rings', 'wedding', 'Couple stand: wedding rings, names and date', 'ستاند العروسين: دبل والاسمين والتاريخ', [
    I(art('rings-frame'), 0.84, 0.5, 0.5),
    T('Ahmed & Sara', 'Pacifico', 0.11, 0.5, onTop(0.626, 0.11), { sampleName: 'names' }),
    T('14.02.2027', 'Lilita One', 0.09, 0.5, onTop(0.828, 0.09)),
  ], 'gold'),
  couple('cnc2-couple-rings-ar', 'wedding', 'Couple stand: rings, names and engagement date (Arabic)', 'ستاند العروسين: دبل والاسمين وتاريخ الخطوبة', [
    I(art('rings-frame'), 0.84, 0.5, 0.5),
    T('محمد', 'Lalezar', 0.14, 0.71, onTop(0.626, 0.14), { sampleName: 'his' }),
    S('heart', 0.08, 0.5, 0.596),
    T('ليلى', 'Lalezar', 0.14, 0.29, onTop(0.626, 0.14), { sampleName: 'her' }),
    T('15.04.2027', 'Lilita One', 0.09, 0.5, onTop(0.828, 0.09)),
  ], 'rosegold'),

  // ---------- Wooden wedding invitation (A5 portrait, the words and the flowers raised) ----------
  // Ramadan 2027 is about 8 Feb - 9 Mar, so the sample weddings are on Thursdays outside it.
  invite('cnc2-invite-vine-ar', 'wedding', 'Wooden invitation: names, day and hall with a flowering vine', 'دعوة فرح خشب: الأسامي واليوم والقاعة بفرع ورد', [
    I(art('vine'), 0.28, 0.22, 0.5),
    T('دعوة زفاف', 'El Messiri', 0.07, 0.62, 0.13, { weight: 'bold' }),
    T('أحمد', 'Aref Ruqaa', 0.17, 0.62, 0.27, { weight: 'bold', sampleName: 'his' }),
    T('و', 'Aref Ruqaa', 0.1, 0.62, 0.38, { weight: 'bold' }),
    T('سارة', 'Aref Ruqaa', 0.17, 0.62, 0.48, { weight: 'bold', sampleName: 'her' }),
    ...dots(0.6, 0.62, 0.06, 0.035),
    T('الخميس ١٥ أبريل ٢٠٢٧', 'Tajawal', 0.065, 0.62, 0.69, { weight: 'bold' }),
    T('الساعة ٨ مساءً', 'Tajawal', 0.065, 0.62, 0.77, { weight: 'bold' }),
    T('قاعة الماسة – القاهرة', 'El Messiri', 0.065, 0.62, 0.86, { weight: 'bold' }),
  ]),
  invite('cnc2-invite-garland-ar', 'wedding', 'Wooden invitation: a flower garland over the names', 'دعوة فرح خشب: إكليل ورد فوق الأسامي', [
    I(art('garland'), 0.7, 0.5, 0.1),
    T('بكل الحب ندعوكم لحضور زفاف', 'Tajawal', 0.065, 0.5, 0.205, { weight: 'bold' }),
    T('محمد', 'Aref Ruqaa', 0.16, 0.5, 0.37, { weight: 'bold', sampleName: 'his' }),
    T('و', 'Aref Ruqaa', 0.1, 0.5, 0.465, { weight: 'bold' }),
    T('ليلى', 'Aref Ruqaa', 0.16, 0.5, 0.55, { weight: 'bold', sampleName: 'her' }),
    ...dots(0.65, 0.5, 0.06, 0.035),
    T('الخميس ١٧ يونيو ٢٠٢٧', 'Tajawal', 0.065, 0.5, 0.735, { weight: 'bold' }),
    T('قاعة الماسة – القاهرة', 'El Messiri', 0.065, 0.5, 0.82, { weight: 'bold' }),
    I(art('garland'), 0.42, 0.5, 0.9, { angle: 180 }),
  ], 'walnut'),
  invite('cnc2-invite-corners-ar', 'wedding', 'Wooden invitation: corner scrolls, names and date', 'دعوة فرح خشب: زخارف الأركان والأسامي والتاريخ', [
    I(art('corner'), 0.26, 0.21, 0.15),
    I(art('corner'), 0.26, 0.79, 0.85, { angle: 180 }),
    T('دعوة زفاف', 'El Messiri', 0.08, 0.55, 0.17, { weight: 'bold' }),
    T('يوسف و مريم', 'Aref Ruqaa', 0.14, 0.5, 0.33, { weight: 'bold', sampleName: 'names' }),
    ...dots(0.45, 0.5, 0.06, 0.035),
    T('يوم الخميس', 'Tajawal', 0.065, 0.5, 0.54, { weight: 'bold' }),
    T('٢١ يناير ٢٠٢٧', 'Reem Kufi', 0.09, 0.5, 0.63, { weight: 'bold' }),
    T('فندق النيل – الجيزة', 'El Messiri', 0.065, 0.45, 0.75, { weight: 'bold' }),
  ], 'white'),
  invite('cnc2-invite-vine-en', 'wedding', 'Wooden invitation: names, day and hall with a vine (English)', 'دعوة فرح خشب إنجليزي بفرع ورد', [
    I(art('vine'), 0.28, 0.78, 0.5),
    T('PLEASE JOIN US', 'Montserrat', 0.05, 0.37, 0.13, { weight: 'bold', spacing: 50 }),
    T('Ahmed', 'Pacifico', 0.15, 0.38, 0.26, { sampleName: 'his' }),
    T('&', 'Playfair Display', 0.08, 0.38, 0.36, { weight: 'bold' }),
    T('Sara', 'Pacifico', 0.15, 0.38, 0.46, { sampleName: 'her' }),
    T('FOR OUR WEDDING', 'Montserrat', 0.05, 0.37, 0.57, { weight: 'bold' }),
    T('Thursday', 'Playfair Display', 0.07, 0.38, 0.66, { weight: 'bold' }),
    T('17 June 2027', 'Playfair Display', 0.07, 0.38, 0.73, { weight: 'bold' }),
    T('8 PM, AL MASA HALL', 'Montserrat', 0.05, 0.38, 0.82, { weight: 'bold' }),
    T('CAIRO', 'Montserrat', 0.05, 0.38, 0.88, { weight: 'bold', spacing: 200 }),
  ]),
];

module.exports = { categories, designs };
