'use strict';

// CNC and UV products (owner's go, 27 Nov 2026): ready designs drawn for each new product's own
// shape and material, and offered only there (`products`, like the laser pack).
//
// CNC pieces come out in ONE tone (`laser` on the product: engraved or cut): the calligraphy
// panel, villa sign, wooden nameplate, name art, Quran stand panel and event letters. Their
// designs use no colours (everything takes the product's ink), thin lines and shapes, and the
// cut pieces (name art, event letters) use heavy fonts only: the letters are cut out, so no
// hairlines. UV pieces print in full colour on clear acrylic, glass, wood or film.
//
// Names, dates and companies are samples the customer replaces (sampleName: the design page
// asks for them). Years say 2026 or 2027. The Quran stand and the Quran box carry no Quran text;
// the calligraphy panels only short, well-known phrases.
const { T, S, A, D, GOLD, PINK, BLUE, GREEN, PURPLE, TEAL } = require('../library-dsl');

const NAVY = '#1b2a4a';
const CREAM = '#f8f1e3';
const DEEP_GREEN = '#1f5f4a';
const BROWN = '#6b3e1d';
const WINE = '#a61e4d';
const PALE = '#e9ecef';
const GREY = '#868e96';
const WHITE = '#ffffff';

const categories = [];

/** A designer for one product: (id, category, en, ar, items, colour?) -> design, drawn for `aspect` (width / height). */
const forProduct = (product, aspect, color) => (id, category, en, ar, items, c = color) => D(id, category, en, ar, items, c, { product, aspect, products: [product] });

// Print areas (src/products.js): width / height.
const calligraphy = forProduct('calligraphy', 1, 'natural');
const villa = forProduct('villasign', 360 / 270, 'teak');
const acrylicPlate = forProduct('acrylicnameplate', 400 / 140, 'clear');
const woodPlate = forProduct('woodnameplate', 400 / 120, 'walnut');
const shield = forProduct('shield', 240 / 300, 'clear');
const quranBox = forProduct('quranbox', 280 / 392, 'natural');
const nameArt = forProduct('nameart', 440 / 220, 'pink');
const rehal = forProduct('rehal', 240 / 120, 'beech');
const glass = forProduct('glassaward', 200 / 300, 'clear');
const qr = forProduct('qrstand', 210 / 296, 'clear');
const tag = forProduct('favourtags', 1, 'clear');
const dtf = forProduct('uvdtf', 222 / 315, 'clear');
const letters = forProduct('eventletters', 450 / 180, 'white');

// A thin divider: two short lines with a small diamond between them (in the ink, or `fill`).
const divider = (y, half = 0.2, gap = 0.045, x = 0.5, fill) => {
  const f = fill ? { fill } : {};
  return [S('line', half, x - gap - half / 2, y, f), S('diamond', 0.028, x, y, f), S('line', half, x + gap + half / 2, y, f)];
};
// A place for the customer's logo: a pale square with LOGO on it (UV, full colour).
const logoBox = (w, x, y, size = 0.03) => [S('rounded', w, x, y, { fill: PALE }), T('LOGO', 'Montserrat', size, x, y, { fill: GREY, weight: 'bold', spacing: 200 })];
// The same for one-tone engraving: a ring with LOGO in it.
const logoRing = (w, x, y, size = 0.03) => [S('ring', w, x, y), T('LOGO', 'Montserrat', size, x, y, { weight: 'bold', spacing: 150 })];
// Where the customer's own QR code goes: a white square in a grey frame with a grey note (no code is drawn:
// theirs is put on it).
const qrPlace = (y, w, note, font = 'Tajawal') => [
  S('rounded', w + 0.03, 0.5, y, { fill: '#ced4da' }),
  S('rounded', w, 0.5, y, { fill: WHITE }),
  T(note, font, 0.05, 0.5, y - 0.02, { fill: GREY, weight: 'bold' }),
  T('QR', 'Montserrat', 0.06, 0.5, y + 0.045, { fill: GREY, weight: 'bold', spacing: 200 }),
];
// A pill-shaped sticker with a word on it (UV DTF sheet).
const pill = (text, font, size, x, y, bg, extra = {}) => T(text, font, size, x, y, { fill: WHITE, bg, bgShape: 'pill', ...extra });

const designs = [
  // ---------- Layered calligraphy wall art (round board, engraved in one tone) ----------
  calligraphy('cnc-cal-bismillah', 'islamic', 'Calligraphy: Bismillah with family name', 'كاليجرافي بسم الله الرحمن الرحيم باسم العيلة', [
    S('ring', 0.9, 0.5, 0.5),
    T('بسم الله', 'Aref Ruqaa', 0.19, 0.5, 0.36, { weight: 'bold' }),
    T('الرحمن الرحيم', 'Aref Ruqaa', 0.115, 0.5, 0.55, { weight: 'bold' }),
    ...divider(0.68, 0.1, 0.035),
    T('بيت عائلة محمود', 'El Messiri', 0.055, 0.5, 0.78, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
  ], 'walnut'),
  calligraphy('cnc-cal-mashallah', 'islamic', 'Calligraphy: Masha\'Allah with family name', 'كاليجرافي ما شاء الله باسم العيلة', [
    S('ring', 0.9, 0.5, 0.5),
    S('crescent', 0.08, 0.5, 0.19),
    T('ما شاء الله', 'Aref Ruqaa', 0.18, 0.5, 0.45, { weight: 'bold' }),
    ...divider(0.63, 0.1, 0.035),
    T('عائلة المصري', 'Reem Kufi', 0.065, 0.5, 0.75, { weight: 'bold', sampleName: 'family', samplePart: 'المصري' }),
  ], 'black'),
  calligraphy('cnc-cal-alhamdulillah', 'islamic', 'Calligraphy: Alhamdulillah, The Hassans', 'كاليجرافي الحمد لله باسم العيلة إنجليزي', [
    S('ring', 0.92, 0.5, 0.5),
    S('ring', 0.84, 0.5, 0.5),
    T('الحمد لله', 'Amiri', 0.19, 0.5, 0.44, { weight: 'bold' }),
    S('star', 0.035, 0.24, 0.68),
    T('THE HASSANS', 'Playfair Display', 0.055, 0.5, 0.68, { spacing: 150, sampleName: 'family', samplePart: 'HASSANS' }),
    S('star', 0.035, 0.76, 0.68),
  ], 'white'),
  calligraphy('cnc-cal-fadl-rabbi', 'islamic', 'Calligraphy: This is from my Lord\'s grace', 'كاليجرافي هذا من فضل ربي', [
    S('ring', 0.9, 0.5, 0.5),
    S('crescent', 0.07, 0.5, 0.2),
    T('هذا من فضل ربي', 'Aref Ruqaa', 0.1, 0.5, 0.43, { weight: 'bold' }),
    ...divider(0.58, 0.1, 0.035),
    T('فيلا عائلة الشريف', 'El Messiri', 0.06, 0.5, 0.7, { weight: 'bold', sampleName: 'family', samplePart: 'الشريف' }),
  ], 'walnut'),

  // ---------- Villa & house sign (landscape, engraved in one tone, outdoors) ----------
  villa('cnc-villa-family-ar', 'family', 'Villa sign: number, family and street', 'يافطة فيلا: الرقم والعيلة والشارع', [
    T('فيلا ١٢', 'Reem Kufi', 0.07, 0.5, 0.17, { weight: 'bold' }),
    T('عائلة الشريف', 'Aref Ruqaa', 0.15, 0.5, 0.45, { weight: 'bold', sampleName: 'family', samplePart: 'الشريف' }),
    ...divider(0.66, 0.16, 0.04),
    T('شارع النخيل · التجمع الخامس', 'Tajawal', 0.045, 0.5, 0.83, { weight: 'bold' }),
  ]),
  villa('cnc-villa-big-number', 'family', 'House sign: big number and family name', 'يافطة بيت: رقم كبير واسم العيلة', [
    T('24', 'Anton', 0.3, 0.24, 0.5),
    S('line', 0.0224, 0.47, 0.5, { angle: 90 }),
    T('عائلة', 'Tajawal', 0.05, 0.73, 0.27, { weight: 'bold' }),
    T('الشريف', 'Aref Ruqaa', 0.13, 0.73, 0.5, { weight: 'bold', sampleName: 'family' }),
    T('شارع ٩ · المعادي', 'Tajawal', 0.045, 0.73, 0.76, { weight: 'bold' }),
  ], 'black'),
  villa('cnc-villa-family-en', 'family', 'Villa sign: The Sherifs (English)', 'يافطة فيلا إنجليزي The Sherifs', [
    T('VILLA 24', 'Montserrat', 0.045, 0.5, 0.16, { weight: 'bold', spacing: 500 }),
    T('THE SHERIFS', 'Playfair Display', 0.1, 0.5, 0.43, { spacing: 100, sampleName: 'family', samplePart: 'SHERIFS' }),
    ...divider(0.64, 0.16, 0.04),
    T('PALM STREET · NEW CAIRO', 'Montserrat', 0.035, 0.5, 0.82, { weight: 'bold', spacing: 300 }),
  ], 'white'),
  villa('cnc-villa-bismillah', 'islamic', 'House sign: Bismillah Masha\'Allah with family', 'يافطة بيت: بسم الله ما شاء الله والعيلة', [
    T('بسم الله ما شاء الله', 'Amiri', 0.05, 0.5, 0.14, { weight: 'bold' }),
    A('tabler:home', 0.1, 0.5, 0.33),
    T('بيت عائلة محمود', 'Aref Ruqaa', 0.1, 0.5, 0.58, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
    T('١٨ شارع الياسمين', 'Tajawal', 0.045, 0.5, 0.84, { weight: 'bold' }),
  ]),

  // ---------- Acrylic desk nameplate (very wide, full colour on clear acrylic) ----------
  acrylicPlate('cnc-acr-name-ar', 'business', 'Acrylic desk nameplate: name and title (Arabic)', 'اسم مكتب أكريليك: الاسم والوظيفة', [
    ...logoBox(0.2, 0.86, 0.5),
    T('م. أحمد حسن', 'El Messiri', 0.085, 0.4, 0.36, { weight: 'bold', fill: NAVY, sampleName: 'name' }),
    S('line', 0.3, 0.4, 0.6, { fill: GOLD }),
    T('مدير المبيعات', 'Tajawal', 0.045, 0.4, 0.78, { weight: 'bold', fill: GOLD }),
  ]),
  acrylicPlate('cnc-acr-name-en', 'business', 'Acrylic desk nameplate: name and title (English)', 'اسم مكتب أكريليك إنجليزي', [
    ...logoBox(0.2, 0.14, 0.5),
    T('Ahmed Hassan', 'Montserrat', 0.07, 0.6, 0.36, { weight: 'bold', fill: NAVY, sampleName: 'name' }),
    S('line', 0.3, 0.6, 0.6, { fill: GOLD }),
    T('SALES MANAGER', 'Montserrat', 0.035, 0.6, 0.78, { weight: 'bold', fill: GOLD, spacing: 300 }),
  ]),
  acrylicPlate('cnc-acr-name-bilingual', 'business', 'Acrylic desk nameplate: Arabic and English', 'اسم مكتب أكريليك عربي وإنجليزي', [
    ...logoBox(0.14, 0.1, 0.5, 0.03),
    T('د. سارة محمود', 'El Messiri', 0.07, 0.55, 0.25, { weight: 'bold', fill: NAVY, sampleName: 'name' }),
    T('Dr. Sara Mahmoud', 'Playfair Display', 0.055, 0.55, 0.55, { fill: NAVY, sampleName: 'name' }),
    S('line', 0.25, 0.55, 0.72, { fill: GOLD }),
    T('طبيبة أسنان · Dentist', 'Tajawal', 0.035, 0.55, 0.86, { weight: 'bold', fill: GOLD }),
  ]),

  // ---------- Wooden desk nameplate (very wide, engraved in one tone) ----------
  woodPlate('cnc-wood-name-ar', 'business', 'Wooden desk nameplate: name and title (Arabic)', 'اسم مكتب خشب: الاسم والوظيفة', [
    ...logoRing(0.17, 0.88, 0.5, 0.03),
    T('م. أحمد حسن', 'Aref Ruqaa', 0.08, 0.42, 0.36, { weight: 'bold', sampleName: 'name' }),
    ...divider(0.62, 0.1, 0.025, 0.42),
    T('مهندس مدني', 'Tajawal', 0.04, 0.42, 0.82, { weight: 'bold' }),
  ]),
  woodPlate('cnc-wood-name-en', 'business', 'Wooden desk nameplate: name and title (English)', 'اسم مكتب خشب إنجليزي', [
    ...logoRing(0.17, 0.12, 0.5, 0.03),
    T('AHMED HASSAN', 'Playfair Display', 0.06, 0.58, 0.37, { spacing: 150, sampleName: 'name' }),
    ...divider(0.62, 0.1, 0.025, 0.58),
    T('CIVIL ENGINEER', 'Montserrat', 0.03, 0.58, 0.83, { weight: 'bold', spacing: 400 }),
  ], 'beech'),
  woodPlate('cnc-wood-name-bilingual', 'business', 'Wooden desk nameplate: Arabic and English', 'اسم مكتب خشب عربي وإنجليزي', [
    ...logoRing(0.15, 0.1, 0.5, 0.03),
    T('أ. منى السيد', 'El Messiri', 0.07, 0.55, 0.3, { weight: 'bold', sampleName: 'name' }),
    T('Mona El Sayed', 'Playfair Display', 0.05, 0.55, 0.62, { sampleName: 'name' }),
    T('مديرة الموارد البشرية · HR Manager', 'Tajawal', 0.03, 0.55, 0.86, { weight: 'bold' }),
  ]),

  // ---------- Acrylic honour shield (portrait, full colour on clear acrylic) ----------
  shield('cnc-shield-school-ar', 'school', 'Honour shield for a teacher (school)', 'درع تكريم للمدرسة', [
    A('tabler:laurel-wreath', 0.28, 0.5, 0.1, { fill: GOLD }),
    T('درع تكريم', 'Aref Ruqaa', 0.15, 0.5, 0.24, { weight: 'bold', fill: GOLD }),
    T('تُهدى إلى', 'Tajawal', 0.05, 0.5, 0.35, { weight: 'bold', fill: NAVY }),
    T('أ. منى السيد', 'El Messiri', 0.11, 0.5, 0.45, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    T('تقديرًا لجهودها المخلصة في تعليم أبنائنا', 'Tajawal', 0.04, 0.5, 0.57, { fill: NAVY }),
    ...divider(0.66, 0.16, 0.045, 0.5, GOLD),
    T('مدرسة النور للغات', 'Reem Kufi', 0.07, 0.5, 0.77, { weight: 'bold', fill: NAVY }),
    T('يونيو ٢٠٢٧', 'Tajawal', 0.045, 0.5, 0.88, { weight: 'bold', fill: GOLD }),
  ]),
  shield('cnc-shield-company-ar', 'business', 'Certificate of appreciation shield (company)', 'درع شهادة تقدير للشركات', [
    ...logoBox(0.18, 0.5, 0.11, 0.035),
    T('شهادة تقدير', 'Aref Ruqaa', 0.14, 0.5, 0.27, { weight: 'bold', fill: GOLD }),
    T('تقدم شركة النور للمقاولات', 'Tajawal', 0.045, 0.5, 0.37, { weight: 'bold', fill: NAVY }),
    T('م. أحمد حسن', 'El Messiri', 0.11, 0.5, 0.48, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    T('تقديرًا لعطائه المتميز خلال عام ٢٠٢٦', 'Tajawal', 0.045, 0.5, 0.6, { fill: NAVY }),
    ...divider(0.7, 0.16, 0.045, 0.5, GOLD),
    T('مع خالص الشكر والتقدير', 'Aref Ruqaa', 0.07, 0.5, 0.8, { weight: 'bold', fill: GOLD }),
    T('ديسمبر ٢٠٢٦', 'Tajawal', 0.04, 0.5, 0.9, { weight: 'bold', fill: NAVY }),
  ]),
  shield('cnc-shield-recognition-en', 'business', 'In recognition shield (English)', 'درع تكريم إنجليزي', [
    A('tabler:award', 0.2, 0.5, 0.11, { fill: GOLD }),
    T('IN RECOGNITION', 'Playfair Display', 0.085, 0.5, 0.26, { spacing: 100, fill: GOLD }),
    T('PRESENTED TO', 'Montserrat', 0.035, 0.5, 0.36, { weight: 'bold', spacing: 400, fill: NAVY }),
    T('Eng. Ahmed Hassan', 'Dancing Script', 0.1, 0.5, 0.47, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    T('For outstanding dedication', 'Montserrat', 0.04, 0.5, 0.58, { fill: NAVY }),
    ...divider(0.68, 0.16, 0.045, 0.5, GOLD),
    T('NOUR GROUP', 'Montserrat', 0.055, 0.5, 0.79, { weight: 'bold', spacing: 300, fill: NAVY }),
    T('DECEMBER 2026', 'Montserrat', 0.035, 0.5, 0.89, { weight: 'bold', spacing: 300, fill: GOLD }),
  ]),
  shield('cnc-shield-student-ar', 'school', 'Top student shield (school)', 'درع الطالب المثالي', [
    A('tabler:school', 0.2, 0.5, 0.1, { fill: NAVY }),
    T('الطالب المثالي', 'Aref Ruqaa', 0.14, 0.5, 0.25, { weight: 'bold', fill: GOLD }),
    T('يُمنح هذا الدرع إلى', 'Tajawal', 0.045, 0.5, 0.36, { weight: 'bold', fill: NAVY }),
    T('عمر خالد', 'El Messiri', 0.13, 0.5, 0.47, { weight: 'bold', fill: NAVY, sampleName: 'name' }),
    T('للتفوق والأخلاق الحميدة', 'Tajawal', 0.05, 0.5, 0.59, { fill: NAVY }),
    ...divider(0.68, 0.16, 0.045, 0.5, GOLD),
    T('مدرسة النور للغات', 'Reem Kufi', 0.065, 0.5, 0.78, { weight: 'bold', fill: NAVY }),
    T('العام الدراسي ٢٠٢٦ / ٢٠٢٧', 'Tajawal', 0.045, 0.5, 0.88, { weight: 'bold', fill: GOLD }),
  ]),

  // ---------- Quran gift box, printed lid (portrait, full colour; no Quran text) ----------
  quranBox('cnc-qbox-ramadan', 'ramadan', 'Quran box lid: Ramadan Kareem with a name', 'غطا صندوق مصحف: رمضان كريم بالاسم', [
    S('crescent', 0.3, 0.5, 0.2, { fill: GOLD }),
    S('star', 0.06, 0.64, 0.12, { fill: GOLD }),
    S('star', 0.04, 0.35, 0.1, { fill: GOLD }),
    T('رمضان كريم', 'Aref Ruqaa', 0.16, 0.5, 0.48, { weight: 'bold', fill: CREAM }),
    ...divider(0.6, 0.15, 0.04, 0.5, GOLD),
    T('هدية إلى سارة', 'El Messiri', 0.08, 0.5, 0.72, { weight: 'bold', fill: CREAM, sampleName: 'name', samplePart: 'سارة' }),
    T('رمضان ٢٠٢٧', 'Tajawal', 0.05, 0.5, 0.84, { weight: 'bold', fill: GOLD }),
  ], 'walnut'),
  quranBox('cnc-qbox-star-pattern', 'islamic', 'Quran box lid: Islamic star with a name', 'غطا صندوق مصحف: نجمة إسلامية بالاسم', [
    S('square', 0.31, 0.5, 0.42, { fill: DEEP_GREEN }),
    S('square', 0.44, 0.5, 0.42, { fill: DEEP_GREEN, angle: 45 }),
    S('circle', 0.27, 0.5, 0.42, { fill: CREAM }),
    T('ليلى', 'Aref Ruqaa', 0.1, 0.5, 0.42, { weight: 'bold', fill: DEEP_GREEN, sampleName: 'name' }),
    S('diamond', 0.06, 0.14, 0.1, { fill: DEEP_GREEN }),
    S('diamond', 0.06, 0.86, 0.1, { fill: DEEP_GREEN }),
    S('diamond', 0.06, 0.14, 0.9, { fill: DEEP_GREEN }),
    S('diamond', 0.06, 0.86, 0.9, { fill: DEEP_GREEN }),
    T('هدية من بابا وماما', 'Aref Ruqaa', 0.08, 0.5, 0.75, { weight: 'bold', fill: BROWN }),
  ]),
  quranBox('cnc-qbox-ramadan-en', 'ramadan', 'Quran box lid: Ramadan Mubarak for a name', 'غطا صندوق مصحف Ramadan Mubarak', [
    S('crescent', 0.22, 0.5, 0.17, { fill: GOLD }),
    T('Ramadan Mubarak', 'Dancing Script', 0.1, 0.5, 0.4, { weight: 'bold', fill: NAVY }),
    T('رمضان مبارك', 'Aref Ruqaa', 0.1, 0.5, 0.55, { weight: 'bold', fill: GOLD }),
    ...divider(0.66, 0.15, 0.04, 0.5, GOLD),
    T('For Omar', 'Playfair Display', 0.07, 0.5, 0.77, { fill: NAVY, sampleName: 'name', samplePart: 'Omar' }),
    T('2027', 'Montserrat', 0.045, 0.5, 0.88, { weight: 'bold', spacing: 300, fill: GOLD }),
  ], 'white'),
  quranBox('cnc-qbox-khatma', 'islamic', 'Quran box lid: congratulations on finishing', 'غطا صندوق مصحف: مبروك الختمة', [
    A('tabler:book', 0.2, 0.5, 0.15, { fill: DEEP_GREEN }),
    T('مبروك الختمة', 'Aref Ruqaa', 0.15, 0.5, 0.38, { weight: 'bold', fill: DEEP_GREEN }),
    T('يا يوسف', 'El Messiri', 0.11, 0.5, 0.54, { weight: 'bold', fill: BROWN, sampleName: 'kid', samplePart: 'يوسف' }),
    ...divider(0.66, 0.15, 0.04, 0.5, DEEP_GREEN),
    T('ربنا يجعله في ميزان حسناتك', 'Tajawal', 0.05, 0.5, 0.77, { weight: 'bold', fill: DEEP_GREEN }),
    T('٢٠٢٧', 'Tajawal', 0.05, 0.5, 0.87, { weight: 'bold', fill: BROWN }),
  ]),

  // ---------- Arabic name art on a plate (cut-out letters: heavy fonts only) ----------
  nameArt('cnc-name-nour-ar', 'kids', 'Name art: نور', 'اسم كاليجرافي: نور', [
    T('نور', 'Lalezar', 0.36, 0.48, 0.5, { sampleName: 'name' }),
    S('heart', 0.08, 0.8, 0.3),
  ]),
  nameArt('cnc-name-yassin-ar', 'kids', 'Name art: ياسين', 'اسم كاليجرافي: ياسين', [
    T('ياسين', 'Lemonada', 0.24, 0.5, 0.5, { weight: 'bold', sampleName: 'name' }),
    S('star', 0.07, 0.86, 0.24),
  ], 'gold'),
  nameArt('cnc-name-nour-en', 'kids', 'Name art: Nour (English)', 'اسم كاليجرافي إنجليزي Nour', [
    T('Nour', 'Lilita One', 0.3, 0.5, 0.5, { sampleName: 'name' }),
    S('heart', 0.07, 0.86, 0.26),
  ], 'black'),
  nameArt('cnc-name-mariam-ar', 'family', 'Name art: مريم', 'اسم كاليجرافي: مريم', [
    S('star', 0.06, 0.16, 0.3),
    T('مريم', 'Lalezar', 0.34, 0.5, 0.5, { sampleName: 'name' }),
    S('star', 0.045, 0.85, 0.72),
  ], 'wood'),

  // ---------- Personalised Quran stand (rehal): a small name panel, engraved; no Quran text ----------
  rehal('cnc-rehal-name-ar', 'islamic', 'Quran stand: a name', 'رحل مصحف بالاسم', [
    S('crescent', 0.07, 0.17, 0.42),
    T('ليلى', 'Aref Ruqaa', 0.22, 0.5, 0.42, { weight: 'bold', sampleName: 'name' }),
    S('star', 0.05, 0.83, 0.42),
    ...divider(0.8, 0.12, 0.03),
  ]),
  rehal('cnc-rehal-family-ar', 'ramadan', 'Quran stand: family name and Ramadan 2027', 'رحل مصحف باسم العيلة رمضان ٢٠٢٧', [
    T('عائلة محمود', 'Aref Ruqaa', 0.14, 0.5, 0.4, { weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
    T('رمضان ٢٠٢٧', 'Tajawal', 0.06, 0.5, 0.78, { weight: 'bold' }),
  ], 'walnut'),
  rehal('cnc-rehal-name-en', 'ramadan', 'Quran stand: a name in English', 'رحل مصحف بالاسم إنجليزي', [
    T('Omar', 'Dancing Script', 0.22, 0.5, 0.4, { weight: 'bold', sampleName: 'name' }),
    T('RAMADAN 2027', 'Montserrat', 0.05, 0.5, 0.8, { weight: 'bold', spacing: 300 }),
  ]),

  // ---------- Crystal glass award (full colour on clear glass) ----------
  glass('cnc-glass-employee-ar', 'business', 'Crystal award: best employee 2026', 'درع كريستال: أفضل موظف ٢٠٢٦', [
    A('tabler:trophy', 0.2, 0.5, 0.12, { fill: GOLD }),
    T('أفضل موظف ٢٠٢٦', 'Aref Ruqaa', 0.1, 0.5, 0.29, { weight: 'bold', fill: GOLD }),
    T('أ. محمد علي', 'El Messiri', 0.11, 0.5, 0.45, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    T('تقديرًا لتميزه وإخلاصه في العمل', 'Tajawal', 0.045, 0.5, 0.57, { fill: NAVY }),
    ...divider(0.67, 0.16, 0.045, 0.5, GOLD),
    T('شركة النور للبرمجيات', 'Reem Kufi', 0.065, 0.5, 0.79, { weight: 'bold', fill: NAVY }),
    T('ديسمبر ٢٠٢٦', 'Tajawal', 0.04, 0.5, 0.89, { weight: 'bold', fill: GOLD }),
  ]),
  glass('cnc-glass-employee-en', 'business', 'Crystal award: employee of the year 2026', 'درع كريستال Employee of the Year', [
    A('tabler:award', 0.18, 0.5, 0.11, { fill: GOLD }),
    T('EMPLOYEE OF THE YEAR', 'Montserrat', 0.05, 0.5, 0.27, { weight: 'bold', spacing: 200, fill: GOLD }),
    T('2026', 'Abril Fatface', 0.18, 0.5, 0.4, { fill: NAVY }),
    T('Mohamed Ali', 'Dancing Script', 0.11, 0.5, 0.57, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    ...divider(0.69, 0.16, 0.045, 0.5, GOLD),
    T('NOUR SOFTWARE', 'Montserrat', 0.055, 0.5, 0.81, { weight: 'bold', spacing: 300, fill: NAVY }),
  ]),
  glass('cnc-glass-top-sales-ar', 'business', 'Crystal award: top sales 2027', 'درع كريستال: الأعلى مبيعًا ٢٠٢٧', [
    A('tabler:medal', 0.18, 0.5, 0.11, { fill: GOLD }),
    T('الأعلى مبيعًا', 'Aref Ruqaa', 0.14, 0.5, 0.27, { weight: 'bold', fill: GOLD }),
    T('٢٠٢٧', 'Reem Kufi', 0.1, 0.5, 0.39, { weight: 'bold', fill: NAVY }),
    T('أ. سارة محمود', 'El Messiri', 0.1, 0.5, 0.53, { weight: 'bold', fill: NAVY, sampleName: 'honoree' }),
    ...divider(0.65, 0.16, 0.045, 0.5, GOLD),
    T('شركة النور للتجارة', 'Reem Kufi', 0.065, 0.5, 0.77, { weight: 'bold', fill: NAVY }),
    T('فرع مدينة نصر', 'Tajawal', 0.045, 0.5, 0.87, { weight: 'bold', fill: GOLD }),
  ]),

  // ---------- Acrylic menu & QR table stand (A6 portrait): a white square for the customer's own QR ----------
  qr('cnc-qr-menu-ar', 'business', 'QR table stand: scan for the menu (café)', 'ستاند QR: امسح الكود للمنيو (كافيه)', [
    A('tabler:coffee', 0.12, 0.5, 0.08, { fill: BROWN }),
    T('كافيه الياسمين', 'Aref Ruqaa', 0.12, 0.5, 0.18, { weight: 'bold', fill: BROWN }),
    ...qrPlace(0.5, 0.56, 'ضع الكود هنا'),
    T('امسح الكود للمنيو', 'Lalezar', 0.09, 0.5, 0.8, { fill: BROWN }),
    T('Scan for menu', 'Montserrat', 0.045, 0.5, 0.9, { weight: 'bold', fill: BROWN }),
  ]),
  qr('cnc-qr-menu-en', 'business', 'QR table stand: scan for menu (English)', 'ستاند QR إنجليزي Scan for menu', [
    T('SCAN FOR MENU', 'Bebas Neue', 0.14, 0.5, 0.12, { fill: NAVY }),
    ...qrPlace(0.47, 0.56, 'YOUR CODE HERE', 'Montserrat'),
    T('Jasmine Café', 'Dancing Script', 0.11, 0.5, 0.78, { weight: 'bold', fill: BROWN }),
    T('THANK YOU FOR VISITING', 'Montserrat', 0.035, 0.5, 0.89, { weight: 'bold', spacing: 200, fill: NAVY }),
  ]),
  qr('cnc-qr-restaurant', 'business', 'QR table stand: restaurant, Arabic and English', 'ستاند QR مطعم عربي وإنجليزي', [
    A('tabler:tools-kitchen-2', 0.1, 0.5, 0.08, { fill: WINE }),
    T('مطعم بيت الكرم', 'Reem Kufi', 0.1, 0.5, 0.18, { weight: 'bold', fill: WINE }),
    ...qrPlace(0.48, 0.52, 'ضع الكود هنا'),
    T('امسح الكود للمنيو', 'Lalezar', 0.085, 0.5, 0.77, { fill: NAVY }),
    T('Scan for menu', 'Montserrat', 0.05, 0.5, 0.88, { weight: 'bold', fill: WINE }),
  ]),

  // ---------- Acrylic favour tags (round, 5 cm, full colour) ----------
  tag('cnc-tag-wedding-initials', 'wedding', 'Favour tag: couple initials and date', 'تاج توزيعات: حروف العروسين والتاريخ', [
    S('ring', 0.8, 0.5, 0.53, { fill: GOLD }),
    T('A & S', 'Great Vibes', 0.26, 0.5, 0.48, { fill: NAVY, sampleName: 'initials' }),
    T('15.02.2027', 'Montserrat', 0.07, 0.5, 0.74, { weight: 'bold', spacing: 100, fill: GOLD }),
  ]),
  tag('cnc-tag-wedding-ar', 'wedding', 'Favour tag: couple names in Arabic', 'تاج توزيعات فرح: أحمد وسارة', [
    S('heart', 0.08, 0.5, 0.27, { fill: PINK }),
    T('أحمد & سارة', 'Aref Ruqaa', 0.13, 0.5, 0.47, { weight: 'bold', fill: NAVY, sampleName: 'names' }),
    T('١٥ . ٢ . ٢٠٢٧', 'Tajawal', 0.08, 0.5, 0.71, { weight: 'bold', fill: PINK }),
  ], 'white'),
  tag('cnc-tag-sebou', 'baby', 'Favour tag: sebou\' with the baby\'s name', 'تاج توزيعات سبوع باسم البيبي', [
    S('ring', 0.8, 0.5, 0.53, { fill: BLUE }),
    T('سبوع', 'Marhey', 0.11, 0.5, 0.31, { weight: 'bold', fill: BLUE }),
    T('آدم', 'Aref Ruqaa', 0.26, 0.5, 0.5, { weight: 'bold', fill: NAVY, sampleName: 'baby' }),
    T('١٠ . ٣ . ٢٠٢٧', 'Tajawal', 0.08, 0.5, 0.75, { weight: 'bold', fill: BLUE }),
  ], 'white'),
  tag('cnc-tag-eid', 'eid', 'Favour tag: Eid Mubarak from the family', 'تاج توزيعات عيد مبارك من العيلة', [
    S('crescent', 0.12, 0.5, 0.28, { fill: GOLD }),
    T('عيد مبارك', 'Aref Ruqaa', 0.16, 0.5, 0.52, { weight: 'bold', fill: GOLD }),
    T('عائلة محمود', 'Tajawal', 0.09, 0.5, 0.74, { weight: 'bold', fill: NAVY, sampleName: 'family', samplePart: 'محمود' }),
  ]),

  // ---------- UV DTF sticker sheet (A5 portrait): a name sticker and icons ----------
  dtf('cnc-dtf-school-ar', 'school', 'Sticker sheet: name and school subjects', 'شيت ستيكرز: الاسم والمواد', [
    pill('ليلى', 'Lalezar', 0.14, 0.5, 0.1, PINK, { sampleName: 'kid' }),
    pill('عربي', 'Lalezar', 0.07, 0.27, 0.3, TEAL),
    pill('رياضيات', 'Lalezar', 0.07, 0.73, 0.3, BLUE),
    pill('علوم', 'Lalezar', 0.07, 0.27, 0.45, GREEN),
    pill('English', 'Lilita One', 0.07, 0.73, 0.45, PURPLE),
    A('fluent-emoji-flat:pencil', 0.16, 0.2, 0.65),
    A('fluent-emoji-flat:books', 0.16, 0.5, 0.65),
    A('fluent-emoji-flat:balloon', 0.16, 0.8, 0.65),
    A('fluent-emoji-flat:strawberry', 0.16, 0.2, 0.86),
    A('fluent-emoji-flat:rainbow', 0.16, 0.5, 0.86),
    A('fluent-emoji-flat:butterfly', 0.16, 0.8, 0.86),
  ]),
  dtf('cnc-dtf-boy-en', 'kids', 'Sticker sheet: ADAM with dinosaurs and rockets', 'شيت ستيكرز ADAM ديناصور وصواريخ', [
    pill('ADAM', 'Lilita One', 0.16, 0.5, 0.11, BLUE, { sampleName: 'kid' }),
    A('fluent-emoji-flat:t-rex', 0.2, 0.22, 0.36),
    A('fluent-emoji-flat:bear', 0.2, 0.5, 0.36),
    A('fluent-emoji-flat:soccer-ball', 0.2, 0.78, 0.36),
    A('fluent-emoji-flat:racing-car', 0.2, 0.22, 0.6),
    A('fluent-emoji-flat:lion', 0.2, 0.5, 0.6),
    A('fluent-emoji-flat:airplane', 0.2, 0.78, 0.6),
    A('fluent-emoji-flat:dog-face', 0.2, 0.22, 0.84),
    A('fluent-emoji-flat:ringed-planet', 0.2, 0.5, 0.84),
    A('fluent-emoji-flat:dolphin', 0.2, 0.78, 0.84),
  ]),
  dtf('cnc-dtf-girl-ar', 'kids', 'Sticker sheet: سارة with unicorns and hearts', 'شيت ستيكرز سارة يونيكورن وقلوب', [
    pill('سارة', 'Lalezar', 0.16, 0.5, 0.11, PINK, { sampleName: 'kid' }),
    A('fluent-emoji-flat:unicorn', 0.2, 0.22, 0.36),
    A('fluent-emoji-flat:butterfly', 0.2, 0.5, 0.36),
    A('fluent-emoji-flat:rainbow', 0.2, 0.78, 0.36),
    A('fluent-emoji-flat:pink-heart', 0.2, 0.22, 0.6),
    A('fluent-emoji-flat:cherry-blossom', 0.2, 0.5, 0.6),
    A('fluent-emoji-flat:strawberry', 0.2, 0.78, 0.6),
    A('fluent-emoji-flat:ice-cream', 0.2, 0.22, 0.84),
    A('fluent-emoji-flat:crown', 0.2, 0.5, 0.84),
    A('fluent-emoji-flat:sparkles', 0.2, 0.78, 0.84),
  ]),

  // ---------- Giant event letters (each letter a freestanding cut piece: heavy fonts only) ----------
  letters('cnc-letters-sm-en', 'wedding', 'Event letters: S&M', 'حروف كبيرة للمناسبات S&M', [
    T('S&M', 'Lilita One', 0.3, 0.5, 0.5, { sampleName: 'initials' }),
  ], 'gold'),
  letters('cnc-letters-ms-ar', 'wedding', 'Event letters: م & س', 'حروف كبيرة للمناسبات م & س', [
    T('م & س', 'Lalezar', 0.32, 0.5, 0.5, { sampleName: 'initials' }),
  ], 'rosegold'),
  letters('cnc-letters-30', 'birthday', 'Event letters: a birthday number', 'حروف كبيرة: رقم عيد الميلاد', [
    T('30', 'Bungee', 0.36, 0.5, 0.5, { sampleName: 'age' }),
  ], 'wood'),
  letters('cnc-letters-eid-ar', 'eid', 'Event letters: عيد', 'حروف كبيرة للعيد: عيد', [
    T('عيد', 'Lalezar', 0.36, 0.5, 0.5),
  ], 'gold'),
];

module.exports = { categories, designs };
