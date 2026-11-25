'use strict';

// Laser products (CO2 laser): starter designs for each engraved or cut product.
//
// Engraved products (plaque, coasters, tray, frame band, card holder, wedding
// sign, door sign) come out in ONE tone, the burn on the material: these
// designs work with line weights and shapes, never colour, and keep away from
// big solid areas. Cut products (cake topper, Ramadan decoration) are cut
// around the outline, so every element touches the rest and the piece holds
// together; the name puzzle is the opposite: big separate chunky letters.
//
// Each design is drawn for its product's print area (`aspect` = width / height)
// and only offered on that product (`products`). Names and dates are
// placeholders the customer replaces.
const { T, S, A, D } = require('../library-dsl');

const categories = [];

/** A designer for one product: (id, category, en, ar, items, colour?) -> design. */
const forProduct = (product, aspect, color) => (id, category, en, ar, items, c = color) => D(id, category, en, ar, items, c, { product, aspect, products: [product] });

// Print areas (src/products.js, LASER_IDS): width / height.
const plaque = forProduct('engrplaque', 220 / 305, 'clear');
const coaster = forProduct('engrcoasters', 1, 'slate');
const tray = forProduct('engrtray', 330 / 198, 'natural');
const frame = forProduct('engrframe', 280 / 120, 'natural');
const card = forProduct('engrcardholder', 240 / 140, 'brown');
const topper = forProduct('caketopper', 360 / 288, 'gold');
const sign = forProduct('weddingsign', 240 / 360, 'clear');
const door = forProduct('doorsign', 360 / 180, 'natural');
const ramadan = forProduct('ramadandecor', 1, 'gold');
const puzzle = forProduct('namepuzzle', 390 / 130, 'natural');

// A thin divider: two short lines with a small diamond between them.
const divider = (y, half = 0.22, gap = 0.05, x = 0.5) => [
  S('line', half, x - gap - half / 2, y),
  S('diamond', 0.028, x, y),
  S('line', half, x + gap + half / 2, y),
];
// A cake-topper stake: three overlapping standing lines (one alone is too thin to push in), hanging
// from the bar at yTop down to yBottom (fractions of the area's height): about 4.5-6 mm wide on a
// 15 cm topper.
// The editor turns a shape first and then sizes it by its bounding box (public/js/templates.js:
// angle, then scaleToWidth(U * w)), so for a standing line `w` sets its THICKNESS. The line is a
// 140 x 6 rectangle (141 x 7 in Fabric's bounds, which count a stroke width of 1), so it comes
// out 141 / 7 = 20.1 x `w` long and 6 x 141 / 980 = 0.86 x `w` thick (fractions of the area's width).
// The library takes shapes from w = 0.02 up (test/library-packs.test.js), so a stake is at least
// 0.02 x 20.1 = 0.4 of the width long: a shorter one keeps its top in the bar and runs a little
// lower (the shop's edge fit then brings the whole piece inside the print area).
const STANDING_LINE_LONG = 141 / 7;
const STANDING_LINE_THICK = (6 * 141) / 980;
const STANDING_LINE_MIN_W = 0.0201;
const stake = (x, yTop, yBottom, aspect = 360 / 288) => {
  const w = Math.max(STANDING_LINE_MIN_W, (yBottom - yTop) / aspect / STANDING_LINE_LONG);
  const len = w * STANDING_LINE_LONG; // as a fraction of the area's width
  const t = w * STANDING_LINE_THICK; // one line's thickness: about 2.5 mm on a 15 cm topper
  const y = yTop + (len * aspect) / 2;
  return [-0.6, 0, 0.6].map((k) => S('line', w, x + k * t, y, { angle: 90 }));
};
// A bar from x0 to x1 at y. A line is 1/21 as thick as it is long, so a long bar is made
// of two halves to stay slim (about 3-5 mm on the cut pieces).
const bar = (x0, x1, y) => {
  const len = x1 - x0;
  if (len <= 0.3) return [S('line', len, (x0 + x1) / 2, y)];
  const half = len / 2 + 0.03; // a line draws about 5% shorter than its w: keep the halves overlapping
  return [S('line', half, x0 + half / 2, y), S('line', half, x1 - half / 2, y)];
};
// A standing line (a post or a string) from y0 to y1 at x, in an area of the given aspect.
const post = (x, y0, y1, aspect = 1) => S('line', (y1 - y0) / aspect / 9.47, x, (y0 + y1) / 2, { angle: 90 });

const designs = [
  // ---------- Engraved acrylic plaque (portrait) ----------
  plaque('lz-plaque-wedding-ar', 'wedding', 'Wedding plaque: names and verse', 'بلاك فرح بالأسماء والآية', [
    T('وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً', 'Amiri', 0.075, 0.5, 0.12, { weight: 'bold' }),
    ...divider(0.22, 0.2),
    T('أحمد', 'Aref Ruqaa', 0.21, 0.5, 0.36, { weight: 'bold', sampleName: 'his' }),
    T('&', 'Playfair Display', 0.1, 0.5, 0.5),
    T('سارة', 'Aref Ruqaa', 0.21, 0.5, 0.63, { weight: 'bold', sampleName: 'her' }),
    ...divider(0.79, 0.2),
    T('15.02.2027', 'Montserrat', 0.065, 0.5, 0.88, { spacing: 150 }),
  ]),
  plaque('lz-plaque-mr-mrs-en', 'wedding', 'Mr & Mrs wedding plaque', 'بلاك فرح Mr & Mrs', [
    S('ring', 0.5, 0.5, 0.22),
    T('Mr & Mrs', 'Dancing Script', 0.1, 0.5, 0.22, { weight: 'bold' }),
    T('AHMED', 'Playfair Display', 0.12, 0.5, 0.47, { spacing: 200, sampleName: 'his' }),
    T('&', 'Dancing Script', 0.1, 0.5, 0.57, { weight: 'bold' }),
    T('SARA', 'Playfair Display', 0.12, 0.5, 0.67, { spacing: 200, sampleName: 'her' }),
    ...divider(0.79, 0.18),
    T('15 . 02 . 2027', 'Montserrat', 0.06, 0.5, 0.88, { spacing: 100 }),
  ]),
  plaque('lz-plaque-graduation-ar', 'graduation', 'Graduation plaque with name', 'بلاك تخرج بالاسم', [
    A('tabler:school', 0.26, 0.5, 0.13),
    T('مبروك التخرج', 'Aref Ruqaa', 0.15, 0.5, 0.3, { weight: 'bold' }),
    ...divider(0.42, 0.18),
    T('م. ليلى أحمد', 'El Messiri', 0.12, 0.5, 0.54, { weight: 'bold', sampleName: 'name' }),
    T('كلية الهندسة - جامعة القاهرة', 'Tajawal', 0.06, 0.5, 0.67, { weight: 'bold' }),
    T('دفعة 2027', 'Reem Kufi', 0.085, 0.5, 0.79, { weight: 'bold' }),
    T('وَقُل رَّبِّ زِدْنِي عِلْمًا', 'Amiri', 0.065, 0.5, 0.91),
  ]),
  plaque('lz-plaque-graduation-en', 'graduation', 'Class of 2027 plaque', 'بلاك تخرج إنجليزي', [
    A('tabler:school', 0.24, 0.5, 0.13),
    T('CLASS OF', 'Montserrat', 0.07, 0.5, 0.28, { weight: 'bold', spacing: 300 }),
    T('2027', 'Abril Fatface', 0.24, 0.5, 0.41),
    ...divider(0.55, 0.18),
    T('Laila Ahmed', 'Dancing Script', 0.14, 0.5, 0.67, { weight: 'bold', sampleName: 'name' }),
    T('FACULTY OF ENGINEERING', 'Montserrat', 0.045, 0.5, 0.8, { spacing: 150 }),
    T('Dream big. Work hard.', 'Playfair Display', 0.055, 0.5, 0.9),
  ]),
  plaque('lz-plaque-takreem-ar', 'business', 'Thank-you plaque (honour)', 'درع تكريم وشكر', [
    A('tabler:laurel-wreath', 0.3, 0.5, 0.12),
    T('شهادة تقدير', 'Aref Ruqaa', 0.15, 0.5, 0.27, { weight: 'bold' }),
    T('تُهدى إلى', 'Tajawal', 0.065, 0.5, 0.38, { weight: 'bold' }),
    T('أ. محمود حسن', 'El Messiri', 0.13, 0.5, 0.49, { weight: 'bold', sampleName: 'honoree' }),
    T('تقديرًا لعطائه وجهوده المخلصة', 'Tajawal', 0.06, 0.5, 0.61),
    ...divider(0.71, 0.18),
    T('شركة النور', 'Reem Kufi', 0.08, 0.5, 0.81, { weight: 'bold' }),
    T('2027', 'Montserrat', 0.055, 0.5, 0.9, { spacing: 200 }),
  ]),
  plaque('lz-plaque-thank-you-en', 'business', 'Thank you teacher plaque', 'بلاك شكر للمدرسة', [
    T('THANK YOU', 'Playfair Display', 0.13, 0.5, 0.14, { spacing: 150 }),
    T('for being an amazing teacher', 'Dancing Script', 0.07, 0.5, 0.25, { weight: 'bold' }),
    ...divider(0.35, 0.18),
    T('Mrs. Laila', 'Abril Fatface', 0.14, 0.5, 0.48, { sampleName: 'teacher' }),
    A('tabler:hearts', 0.16, 0.5, 0.62),
    T('From your students', 'Montserrat', 0.055, 0.5, 0.75, { spacing: 100 }),
    T('CLASS 5A · 2027', 'Montserrat', 0.05, 0.5, 0.85, { weight: 'bold', spacing: 200 }),
  ]),
  plaque('lz-plaque-doaa-ar', 'islamic', 'Dua plaque: ease my task', 'بلاك دعاء رب اشرح لي صدري', [
    S('crescent', 0.09, 0.5, 0.09),
    T('بسم الله الرحمن الرحيم', 'Amiri', 0.075, 0.5, 0.22, { weight: 'bold' }),
    ...divider(0.31, 0.18),
    T('رَبِّ اشْرَحْ لِي صَدْرِي', 'Aref Ruqaa', 0.12, 0.5, 0.45, { weight: 'bold' }),
    T('وَيَسِّرْ لِي أَمْرِي', 'Aref Ruqaa', 0.12, 0.5, 0.62, { weight: 'bold' }),
    ...divider(0.75, 0.18),
    T('سورة طه', 'Tajawal', 0.055, 0.5, 0.85, { weight: 'bold' }),
  ]),

  // ---------- Engraved coasters (square) ----------
  coaster('lz-coaster-couple-ar', 'love', 'Coaster: couple names', 'كوستر أسماء العروسين', [
    S('ring', 0.9, 0.5, 0.5),
    T('أحمد', 'Aref Ruqaa', 0.2, 0.5, 0.3, { weight: 'bold', sampleName: 'his' }),
    S('heart', 0.08, 0.5, 0.5),
    T('سارة', 'Aref Ruqaa', 0.2, 0.5, 0.66, { weight: 'bold', sampleName: 'her' }),
    T('15.02.2027', 'Montserrat', 0.045, 0.5, 0.83, { spacing: 150 }),
  ]),
  coaster('lz-coaster-couple-en', 'love', 'Coaster: couple names (English)', 'كوستر أسماء إنجليزي', [
    S('ring', 0.9, 0.5, 0.5),
    S('ring', 0.82, 0.5, 0.5),
    T('Ahmed', 'Dancing Script', 0.16, 0.5, 0.34, { weight: 'bold', sampleName: 'his' }),
    T('&', 'Playfair Display', 0.08, 0.5, 0.47),
    T('Sara', 'Dancing Script', 0.16, 0.5, 0.6, { weight: 'bold', sampleName: 'her' }),
    T('EST. 2027', 'Montserrat', 0.042, 0.5, 0.76, { spacing: 300, weight: 'bold' }),
  ]),
  coaster('lz-coaster-monogram-en', 'family', 'Coaster: family monogram', 'كوستر حرف العيلة', [
    S('ring', 0.9, 0.5, 0.5),
    S('ring', 0.54, 0.5, 0.42),
    T('M', 'Playfair Display', 0.3, 0.5, 0.42, { sampleName: 'initial' }),
    T('THE MAHMOUDS', 'Montserrat', 0.05, 0.5, 0.78, { spacing: 150, weight: 'bold', sampleName: 'family', samplePart: 'MAHMOUDS' }),
  ]),
  coaster('lz-coaster-monogram-ar', 'family', 'Coaster: family initial (Arabic)', 'كوستر حرف العيلة عربي', [
    S('ring', 0.9, 0.5, 0.5),
    S('ring', 0.5, 0.5, 0.4),
    T('م', 'Aref Ruqaa', 0.3, 0.5, 0.37, { weight: 'bold', sampleName: 'initial' }),
    T('عائلة محمود', 'El Messiri', 0.085, 0.5, 0.78, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
  ]),
  coaster('lz-coaster-beit-el-3ela', 'family', 'Coaster: the family home', 'كوستر بيت العيلة', [
    S('ring', 0.9, 0.5, 0.5),
    A('tabler:home-heart', 0.22, 0.5, 0.23),
    T('بيت العيلة', 'Aref Ruqaa', 0.19, 0.5, 0.48, { weight: 'bold' }),
    ...divider(0.64, 0.14, 0.045),
    T('عائلة محمود', 'Tajawal', 0.08, 0.5, 0.76, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
  ]),
  coaster('lz-coaster-coffee-ar', 'funny', 'Coaster: no talking before coffee', 'كوستر مفيش كلام قبل القهوة', [
    S('ring', 0.9, 0.5, 0.5),
    A('tabler:coffee', 0.24, 0.5, 0.24),
    T('مفيش كلام', 'Lalezar', 0.15, 0.5, 0.5),
    T('قبل القهوة', 'Aref Ruqaa', 0.13, 0.5, 0.7, { weight: 'bold' }),
  ]),
  coaster('lz-coaster-coffee-en', 'funny', 'Coaster: but first, coffee', 'كوستر But first coffee', [
    S('ring', 0.9, 0.5, 0.5),
    T('but first,', 'Dancing Script', 0.12, 0.5, 0.3, { weight: 'bold' }),
    T('COFFEE', 'Abril Fatface', 0.19, 0.5, 0.5),
    A('tabler:coffee', 0.2, 0.5, 0.72),
  ]),

  // ---------- Engagement tray floor (wide) ----------
  tray('lz-tray-names-ar', 'wedding', 'Engagement tray: names and date', 'صينية شبكة بالأسماء والتاريخ', [
    T('على بركة الله', 'Aref Ruqaa', 0.075, 0.5, 0.14, { weight: 'bold' }),
    ...divider(0.28, 0.2, 0.04),
    T('أحمد & سارة', 'Aref Ruqaa', 0.15, 0.5, 0.52, { weight: 'bold', sampleName: 'names' }),
    ...divider(0.75, 0.2, 0.04),
    T('15.02.2027', 'Montserrat', 0.045, 0.5, 0.88, { spacing: 200 }),
  ]),
  tray('lz-tray-names-en', 'wedding', 'Engagement tray: names (English)', 'صينية شبكة أسماء إنجليزي', [
    T('Ahmed', 'Dancing Script', 0.12, 0.29, 0.42, { weight: 'bold', sampleName: 'his' }),
    S('heart', 0.05, 0.5, 0.44),
    T('Sara', 'Dancing Script', 0.12, 0.71, 0.42, { weight: 'bold', sampleName: 'her' }),
    ...divider(0.7, 0.24, 0.04),
    T('ENGAGED · 15.02.2027', 'Montserrat', 0.04, 0.5, 0.84, { spacing: 250, weight: 'bold' }),
  ]),
  tray('lz-tray-mawadda-ar', 'wedding', 'Engagement tray: verse and names', 'صينية شبكة مودة ورحمة', [
    T('وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً', 'Amiri', 0.06, 0.5, 0.14, { weight: 'bold' }),
    T('أحمد', 'Aref Ruqaa', 0.14, 0.24, 0.5, { weight: 'bold', sampleName: 'his' }),
    S('ring', 0.17, 0.5, 0.5),
    S('heart', 0.06, 0.5, 0.5),
    T('سارة', 'Aref Ruqaa', 0.14, 0.76, 0.5, { weight: 'bold', sampleName: 'her' }),
    ...divider(0.78, 0.2, 0.04),
    T('15.02.2027', 'Montserrat', 0.042, 0.5, 0.9, { spacing: 200 }),
  ]),
  tray('lz-tray-monogram', 'wedding', 'Engagement tray: initials monogram', 'صينية شبكة بالحروف', [
    S('ring', 0.4, 0.5, 0.42),
    T('A & S', 'Playfair Display', 0.09, 0.5, 0.42, { sampleName: 'initials' }),
    T('Ahmed & Sara', 'Dancing Script', 0.075, 0.5, 0.84, { weight: 'bold', sampleName: 'names' }),
    S('line', 0.14, 0.2, 0.84),
    S('line', 0.14, 0.8, 0.84),
  ]),
  tray('lz-tray-shabka-ar', 'wedding', 'Engagement tray: our engagement', 'صينية شبكة خطوبتنا', [
    T('خطوبة', 'Aref Ruqaa', 0.085, 0.5, 0.15, { weight: 'bold' }),
    S('heart', 0.04, 0.5, 0.31),
    S('line', 0.3, 0.3, 0.31),
    S('line', 0.3, 0.7, 0.31),
    T('أحمد & سارة', 'Aref Ruqaa', 0.14, 0.5, 0.58, { weight: 'bold', sampleName: 'names' }),
    T('الجمعة 15 فبراير 2027', 'Tajawal', 0.05, 0.5, 0.86, { weight: 'bold' }),
  ]),

  // ---------- Photo frame bottom band (very wide) ----------
  frame('lz-frame-names-ar', 'love', 'Frame band: names and date', 'برواز بالأسماء والتاريخ', [
    T('أحمد & سارة', 'Aref Ruqaa', 0.13, 0.5, 0.4, { weight: 'bold', sampleName: 'names' }),
    ...divider(0.72, 0.12, 0.035),
    T('15.02.2027', 'Montserrat', 0.042, 0.5, 0.87, { spacing: 200 }),
  ]),
  frame('lz-frame-names-en', 'love', 'Frame band: names (English)', 'برواز أسماء إنجليزي', [
    T('Ahmed & Sara', 'Dancing Script', 0.13, 0.5, 0.4, { weight: 'bold', sampleName: 'names' }),
    S('line', 0.12, 0.27, 0.82),
    T('15.02.2027', 'Montserrat', 0.042, 0.5, 0.82, { spacing: 200 }),
    S('line', 0.12, 0.73, 0.82),
  ]),
  frame('lz-frame-a7la-zekra', 'family', 'Frame band: the sweetest memory', 'برواز أحلى ذكرى', [
    S('line', 0.16, 0.13, 0.42),
    T('أحلى ذكرى', 'Aref Ruqaa', 0.14, 0.5, 0.4, { weight: 'bold' }),
    S('line', 0.16, 0.87, 0.42),
    T('صيف 2027', 'Tajawal', 0.055, 0.5, 0.84, { weight: 'bold' }),
  ]),
  frame('lz-frame-best-mom', 'family', 'Frame band: best mom', 'برواز Best Mom', [
    T('Best Mom', 'Dancing Script', 0.15, 0.44, 0.42, { weight: 'bold' }),
    S('heart', 0.05, 0.76, 0.33),
    T('EVER', 'Montserrat', 0.045, 0.5, 0.86, { spacing: 600, weight: 'bold' }),
  ]),
  frame('lz-frame-set-el-7abayeb', 'family', 'Frame band: mom, the dearest', 'برواز ست الحبايب', [
    T('ست الحبايب', 'Aref Ruqaa', 0.13, 0.5, 0.4, { weight: 'bold' }),
    S('heart', 0.04, 0.5, 0.8),
    S('line', 0.14, 0.38, 0.8),
    S('line', 0.14, 0.62, 0.8),
  ]),

  // ---------- Leather card holder (small) ----------
  card('lz-card-monogram-en', 'business', 'Card holder: initials monogram', 'حافظة كروت بالحروف', [
    S('ring', 0.5, 0.5, 0.5),
    T('AH', 'Playfair Display', 0.2, 0.5, 0.5, { spacing: 50, sampleName: 'initials' }),
  ]),
  card('lz-card-monogram-ar', 'business', 'Card holder: Arabic initial', 'حافظة كروت بالحرف العربي', [
    S('ring', 0.5, 0.5, 0.5),
    T('أ.ح', 'Aref Ruqaa', 0.2, 0.5, 0.48, { weight: 'bold', sampleName: 'initials' }),
  ]),
  card('lz-card-name-title-en', 'business', 'Card holder: name and job title', 'حافظة كروت بالاسم والوظيفة', [
    T('Ahmed Hassan', 'Playfair Display', 0.12, 0.5, 0.36, { sampleName: 'name' }),
    S('line', 0.3, 0.5, 0.56),
    T('SOFTWARE ENGINEER', 'Montserrat', 0.055, 0.5, 0.7, { spacing: 200, weight: 'bold' }),
  ]),
  card('lz-card-name-title-ar', 'business', 'Card holder: name and job (Arabic)', 'حافظة كروت بالاسم والوظيفة عربي', [
    T('م. أحمد حسن', 'El Messiri', 0.13, 0.5, 0.35, { weight: 'bold', sampleName: 'name' }),
    S('line', 0.3, 0.5, 0.57),
    T('مهندس برمجيات', 'Tajawal', 0.085, 0.5, 0.72, { weight: 'bold' }),
  ]),
  card('lz-card-initial-name', 'business', 'Card holder: initial and name', 'حافظة كروت حرف واسم', [
    T('A', 'Abril Fatface', 0.36, 0.5, 0.42, { sampleName: 'initial' }),
    T('AHMED HASSAN', 'Montserrat', 0.06, 0.5, 0.84, { spacing: 300, weight: 'bold', sampleName: 'name' }),
  ]),

  // ---------- Wedding welcome sign (arch: the top third is a semicircle) ----------
  sign('lz-sign-welcome-en', 'wedding', 'Wedding welcome sign', 'لوحة ترحيب للفرح إنجليزي', [
    T('Welcome', 'Dancing Script', 0.2, 0.5, 0.2, { weight: 'bold' }),
    T('TO THE WEDDING OF', 'Montserrat', 0.045, 0.5, 0.3, { spacing: 250, weight: 'bold' }),
    T('Ahmed', 'Dancing Script', 0.19, 0.5, 0.44, { weight: 'bold', sampleName: 'his' }),
    T('&', 'Playfair Display', 0.09, 0.5, 0.54),
    T('Sara', 'Dancing Script', 0.19, 0.5, 0.64, { weight: 'bold', sampleName: 'her' }),
    ...divider(0.77, 0.2),
    T('15 . 02 . 2027', 'Montserrat', 0.055, 0.5, 0.86, { spacing: 150 }),
  ]),
  sign('lz-sign-welcome-ar', 'wedding', 'Wedding welcome sign (Arabic)', 'لوحة أهلاً بكم في فرح', [
    S('crescent', 0.11, 0.5, 0.1, { angle: -30 }),
    T('أهلاً بكم في فرح', 'Aref Ruqaa', 0.11, 0.5, 0.24, { weight: 'bold' }),
    ...divider(0.33, 0.16),
    T('أحمد', 'Aref Ruqaa', 0.22, 0.5, 0.45, { weight: 'bold', sampleName: 'his' }),
    T('&', 'Playfair Display', 0.09, 0.5, 0.56),
    T('سارة', 'Aref Ruqaa', 0.22, 0.5, 0.67, { weight: 'bold', sampleName: 'her' }),
    ...divider(0.79, 0.16),
    T('الجمعة 15 فبراير 2027', 'Tajawal', 0.06, 0.5, 0.88, { weight: 'bold' }),
  ]),
  sign('lz-sign-katb-ketab-ar', 'wedding', 'Katb kitab welcome sign', 'لوحة كتب كتاب', [
    T('كتب كتاب', 'Aref Ruqaa', 0.15, 0.5, 0.2, { weight: 'bold' }),
    T('أحمد & سارة', 'Aref Ruqaa', 0.15, 0.5, 0.4, { weight: 'bold', sampleName: 'names' }),
    ...divider(0.52, 0.16),
    T('بارك الله لكما', 'Amiri', 0.085, 0.5, 0.61, { weight: 'bold' }),
    T('وبارك عليكما', 'Amiri', 0.085, 0.5, 0.69, { weight: 'bold' }),
    T('وجمع بينكما في خير', 'Amiri', 0.085, 0.5, 0.77, { weight: 'bold' }),
    T('15.02.2027', 'Montserrat', 0.055, 0.5, 0.89, { spacing: 200 }),
  ]),
  sign('lz-sign-engagement-en', 'wedding', 'Engagement welcome sign', 'لوحة ترحيب للخطوبة', [
    A('tabler:hearts', 0.16, 0.5, 0.13),
    T('WELCOME TO OUR', 'Montserrat', 0.05, 0.5, 0.25, { spacing: 250, weight: 'bold' }),
    T('Engagement', 'Dancing Script', 0.17, 0.5, 0.34, { weight: 'bold' }),
    ...divider(0.45, 0.16),
    T('AHMED', 'Playfair Display', 0.13, 0.5, 0.56, { spacing: 200, sampleName: 'his' }),
    T('&', 'Dancing Script', 0.1, 0.5, 0.65, { weight: 'bold' }),
    T('SARA', 'Playfair Display', 0.13, 0.5, 0.74, { spacing: 200, sampleName: 'her' }),
    T('15.02.2027', 'Montserrat', 0.055, 0.5, 0.87, { spacing: 200 }),
  ]),
  sign('lz-sign-bilingual', 'wedding', 'Welcome sign in Arabic and English', 'لوحة ترحيب عربي وإنجليزي', [
    T('Welcome', 'Dancing Script', 0.2, 0.5, 0.19, { weight: 'bold' }),
    T('أهلاً وسهلاً', 'Aref Ruqaa', 0.1, 0.5, 0.315, { weight: 'bold' }),
    ...divider(0.4, 0.16),
    T('أحمد & سارة', 'Aref Ruqaa', 0.13, 0.5, 0.51, { weight: 'bold', sampleName: 'names' }),
    T('Ahmed & Sara', 'Dancing Script', 0.12, 0.5, 0.63, { weight: 'bold', sampleName: 'names' }),
    ...divider(0.74, 0.16),
    T('15.02.2027', 'Montserrat', 0.06, 0.5, 0.84, { spacing: 200 }),
  ]),

  // ---------- Door name sign (2 : 1) ----------
  door('lz-door-family-ar', 'family', 'Door sign: family name', 'يافطة باب عائلة محمود', [
    T('بسم الله ما شاء الله', 'Amiri', 0.05, 0.5, 0.16, { weight: 'bold' }),
    T('عائلة محمود', 'Aref Ruqaa', 0.15, 0.5, 0.5, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
    ...divider(0.8, 0.15, 0.035),
  ]),
  door('lz-door-mashallah', 'islamic', 'Door sign: In the name of God, mashallah', 'يافطة بسم الله ما شاء الله', [
    S('crescent', 0.07, 0.5, 0.16),
    T('بسم الله', 'Aref Ruqaa', 0.11, 0.5, 0.42, { weight: 'bold' }),
    T('ما شاء الله', 'Aref Ruqaa', 0.11, 0.5, 0.7, { weight: 'bold' }),
    S('line', 0.16, 0.16, 0.56),
    S('line', 0.16, 0.84, 0.56),
  ]),
  door('lz-door-family-en', 'family', 'Door sign: The Mahmouds', 'يافطة باب The Mahmouds', [
    T('The', 'Dancing Script', 0.07, 0.5, 0.18, { weight: 'bold' }),
    T('MAHMOUDS', 'Playfair Display', 0.11, 0.5, 0.46, { spacing: 150, sampleName: 'family' }),
    ...divider(0.7, 0.13, 0.035),
    T('EST. 2027', 'Montserrat', 0.035, 0.5, 0.86, { spacing: 300, weight: 'bold' }),
  ]),
  door('lz-door-room-en', 'kids', 'Door sign: Laila\'s room', 'يافطة أوضة Laila', [
    S('star', 0.07, 0.17, 0.34),
    S('crescent', 0.06, 0.83, 0.34, { angle: 20 }),
    T('Laila\'s', 'Dancing Script', 0.12, 0.5, 0.34, { weight: 'bold', sampleName: 'kid', samplePart: 'Laila' }),
    T('ROOM', 'Montserrat', 0.06, 0.5, 0.72, { spacing: 600, weight: 'bold' }),
  ]),
  door('lz-door-room-ar', 'kids', 'Door sign: Laila\'s room (Arabic)', 'يافطة أوضة ليلى', [
    S('star', 0.06, 0.2, 0.36),
    S('star', 0.035, 0.27, 0.66),
    T('أوضة', 'Marhey', 0.07, 0.5, 0.2, { weight: 'bold' }),
    T('ليلى', 'Aref Ruqaa', 0.17, 0.5, 0.56, { weight: 'bold', sampleName: 'kid' }),
    S('crescent', 0.06, 0.8, 0.44, { angle: 20 }),
  ]),
  door('lz-door-welcome', 'family', 'Door sign: welcome home', 'يافطة أهلاً وسهلاً', [
    A('tabler:home-heart', 0.1, 0.5, 0.18),
    T('أهلاً وسهلاً', 'Aref Ruqaa', 0.12, 0.5, 0.5, { weight: 'bold' }),
    S('line', 0.1, 0.27, 0.82),
    T('WELCOME', 'Montserrat', 0.035, 0.5, 0.82, { spacing: 400, weight: 'bold' }),
    S('line', 0.1, 0.73, 0.82),
  ]),

  // ---------- Cake topper (cut out: one piece, on stakes) ----------
  // Words overlap each other, sit on a bar, and the stakes hang from the bar.
  topper('lz-topper-happy-bday-en', 'birthday', 'Cake topper: name + Happy Birthday', 'توبر اسم + Happy Birthday', [
    T('Ahmed', 'Pacifico', 0.26, 0.5, 0.3, { sampleName: 'name' }),
    T('HAPPY BIRTHDAY', 'Montserrat', 0.075, 0.5, 0.435, { weight: 'bold', spacing: 60 }),
    ...bar(0.1, 0.9, 0.472),
    ...stake(0.38, 0.48, 0.97),
    ...stake(0.62, 0.48, 0.97),
  ]),
  topper('lz-topper-happy-bday-script', 'birthday', 'Cake topper: Happy Birthday', 'توبر Happy Birthday', [
    T('Happy', 'Pacifico', 0.2, 0.42, 0.2),
    T('Birthday', 'Pacifico', 0.22, 0.52, 0.42),
    ...bar(0.15, 0.85, 0.51),
    ...stake(0.38, 0.51, 0.97),
    ...stake(0.62, 0.51, 0.97),
  ]),
  topper('lz-topper-eid-milad-ar', 'birthday', 'Cake topper: happy birthday (Arabic)', 'توبر عيد ميلاد سعيد', [
    T('عيد ميلاد سعيد', 'Lalezar', 0.15, 0.5, 0.2),
    ...bar(0.07, 0.93, 0.264),
    T('ليلى', 'Lalezar', 0.26, 0.5, 0.345, { sampleName: 'name' }),
    ...bar(0.25, 0.75, 0.535),
    ...stake(0.4, 0.535, 0.97),
    ...stake(0.6, 0.535, 0.97),
  ]),
  topper('lz-topper-mr-mrs', 'wedding', 'Cake topper: Mr & Mrs', 'توبر Mr & Mrs', [
    T('Mr & Mrs', 'Pacifico', 0.2, 0.5, 0.33),
    ...bar(0.06, 0.94, 0.414),
    ...stake(0.35, 0.42, 0.97),
    ...stake(0.65, 0.42, 0.97),
  ]),
  topper('lz-topper-first-bday', 'birthday', 'Cake topper: 1st birthday', 'توبر أول عيد ميلاد', [
    T('1st', 'Pacifico', 0.32, 0.5, 0.27),
    T('BIRTHDAY', 'Montserrat', 0.09, 0.5, 0.443, { weight: 'bold', spacing: 80 }),
    ...bar(0.2, 0.8, 0.481),
    ...stake(0.5, 0.478, 0.97),
  ]),
  topper('lz-topper-najah-ar', 'graduation', 'Cake topper: congrats on graduating (Arabic)', 'توبر مبروك النجاح', [
    T('مبروك النجاح', 'Lalezar', 0.19, 0.5, 0.4),
    S('diamond', 0.024, 0.353, 0.398),
    ...bar(0.07, 0.93, 0.482),
    ...stake(0.35, 0.48, 0.97),
    ...stake(0.65, 0.48, 0.97),
  ]),

  // ---------- Ramadan decoration (cut out: one piece, hung from the top) ----------
  // Each word sits on a bar that runs into the crescent; small diamonds bridge the
  // dots above ض and ن to their letters so nothing falls out.
  ramadan('lz-ramadan-kareem-crescent', 'ramadan', 'Ramadan Kareem crescent', 'هلال رمضان كريم', [
    S('crescent', 0.5, 0.27, 0.5),
    T('رمضان', 'Lalezar', 0.21, 0.527, 0.36),
    ...bar(0.25, 0.77, 0.427),
    T('كريم', 'Lalezar', 0.21, 0.49, 0.6),
    ...bar(0.26, 0.64, 0.663),
    S('star', 0.1, 0.46, 0.86),
    S('diamond', 0.022, 0.57, 0.334),
    S('circle', 0.048, 0.358, 0.346),
  ]),
  ramadan('lz-ramadan-family-crescent', 'ramadan', 'Crescent with family name', 'هلال باسم العيلة', [
    S('crescent', 0.5, 0.27, 0.5),
    T('عائلة', 'Lalezar', 0.17, 0.455, 0.36),
    ...bar(0.26, 0.59, 0.408),
    T('محمود', 'Lalezar', 0.21, 0.545, 0.56, { sampleName: 'family' }),
    ...bar(0.26, 0.79, 0.624),
    S('star', 0.1, 0.46, 0.86),
  ]),
  ramadan('lz-ramadan-lantern-name', 'ramadan', 'Lantern with family name', 'فانوس باسم العيلة', [
    S('ring', 0.09, 0.5, 0.055),
    S('triangle', 0.26, 0.5, 0.16),
    S('ring', 0.3, 0.5, 0.37),
    S('star', 0.3, 0.5, 0.38),
    S('triangle', 0.26, 0.5, 0.57, { angle: 180 }),
    ...bar(0.1, 0.9, 0.68),
    ...bar(0.1, 0.9, 0.878),
    post(0.11, 0.68, 0.878),
    post(0.89, 0.68, 0.878),
    T('عائلة محمود', 'Lalezar', 0.15, 0.5, 0.83, { sampleName: 'family', samplePart: 'محمود' }),
  ]),
  ramadan('lz-ramadan-kareem-en', 'ramadan', 'Ramadan Kareem crescent (English)', 'هلال Ramadan Kareem', [
    S('crescent', 0.5, 0.27, 0.5),
    T('Ramadan', 'Pacifico', 0.15, 0.595, 0.38),
    T('Kareem', 'Pacifico', 0.15, 0.54, 0.6),
    S('star', 0.1, 0.46, 0.86),
  ]),
  ramadan('lz-ramadan-ahlan', 'ramadan', 'Ahlan Ramadan with hanging stars', 'أهلاً رمضان بنجوم', [
    S('crescent', 0.36, 0.5, 0.34, { angle: -90 }),
    ...bar(0.1, 0.9, 0.43),
    ...bar(0.1, 0.9, 0.576),
    post(0.11, 0.43, 0.8),
    post(0.89, 0.43, 0.8),
    T('أهلاً رمضان', 'Lalezar', 0.17, 0.5, 0.52),
    S('star', 0.12, 0.11, 0.83),
    S('star', 0.12, 0.89, 0.83),
    S('diamond', 0.021, 0.405, 0.504),
    S('circle', 0.036, 0.232, 0.508),
  ]),

  // ---------- Kids' name puzzle (big separate chunky letters) ----------
  puzzle('lz-puzzle-laila-en', 'kids', 'Name puzzle: LAILA', 'بازل اسم LAILA', [
    T('LAILA', 'Bungee', 0.26, 0.5, 0.5, { spacing: 60, sampleName: 'kid' }),
  ], 'pink'),
  puzzle('lz-puzzle-omar-en', 'kids', 'Name puzzle: OMAR', 'بازل اسم OMAR', [
    T('OMAR', 'Bungee', 0.24, 0.5, 0.5, { spacing: 60, sampleName: 'kid' }),
  ], 'blue'),
  puzzle('lz-puzzle-adam-star', 'kids', 'Name puzzle: ADAM with a star', 'بازل اسم ADAM ونجمة', [
    T('ADAM', 'Bungee', 0.22, 0.41, 0.5, { spacing: 60, sampleName: 'kid' }),
    S('star', 0.15, 0.86, 0.5),
  ]),
  puzzle('lz-puzzle-laila-ar', 'kids', 'Name puzzle: ليلى', 'بازل اسم ليلى', [
    T('ليلى', 'Lalezar', 0.24, 0.5, 0.5, { sampleName: 'kid' }),
  ], 'pink'),
  puzzle('lz-puzzle-omar-ar', 'kids', 'Name puzzle: عمر', 'بازل اسم عمر', [
    T('عمر', 'Lalezar', 0.24, 0.44, 0.5, { sampleName: 'kid' }),
    S('star', 0.15, 0.78, 0.5),
  ], 'blue'),
];

module.exports = { categories, designs };
