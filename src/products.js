'use strict';

/** Selling prices = list prices × this (PRICE_FACTOR in the environment, e.g. 0.5 for a half-price sale; default 1). */
function PRICE_FACTOR() {
  const f = Number(process.env.PRICE_FACTOR);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * Product catalog. All prices are in Egyptian pounds (EGP).
 *
 * Every mockup is drawn in a 500 x 600 coordinate space. SVG templates use
 * placeholders that the client fills in for the chosen product colour:
 *   {{C}} main colour, {{S}} shade (folds, inner parts), {{L}} outline.
 *
 * printArea is the printable rectangle in mockup coordinates and
 * printWidthIn is its physical width in inches; the physical height follows
 * from the rectangle's aspect ratio. An optional `overlay` SVG is drawn on
 * top of the customer's design (camera bumps, highlights, spiral rings...).
 *
 * Text that customers see is given as { en, ar }.
 */

const MOCKUP_WIDTH = 500;
const MOCKUP_HEIGHT = 600;
const CURRENCY = 'EGP';

const t = (en, ar) => ({ en, ar });

const CATEGORIES = [
  { id: 'apparel', name: t('Apparel', 'ملابس') },
  { id: 'home', name: t('Home & living', 'المنزل') },
  { id: 'accessories', name: t('Accessories', 'إكسسوارات') },
  { id: 'stationery', name: t('Stationery', 'أدوات مكتبية') },
  { id: 'occasions', name: t('Gifts & occasions', 'هدايا ومناسبات') },
  { id: 'school', name: t('Back to school', 'المدرسة') },
  { id: 'business', name: t('Business', 'للأعمال') },
  { id: 'kids', name: t('Kids books', 'كتب أطفال') },
  { id: 'textiles', name: t('Fabric & home textiles', 'أقمشة ومفروشات') },
  { id: 'photos', name: t('Photo prints', 'طباعة صور') },
  { id: 'laser', name: t('Laser engraving & cutting', 'حفر وقص ليزر') },
];

const C = {
  white: { id: 'white', name: t('White', 'أبيض'), hex: '#ffffff' },
  black: { id: 'black', name: t('Black', 'أسود'), hex: '#1f2023' },
  heather: { id: 'heather', name: t('Heather Grey', 'رمادي'), hex: '#b9bcc2' },
  lightgrey: { id: 'lightgrey', name: t('Light Grey', 'رمادي فاتح'), hex: '#dcdfe3' },
  navy: { id: 'navy', name: t('Navy', 'كحلي'), hex: '#1f2f54' },
  red: { id: 'red', name: t('Red', 'أحمر'), hex: '#c8322f' },
  forest: { id: 'forest', name: t('Forest Green', 'أخضر غامق'), hex: '#2f5d43' },
  sand: { id: 'sand', name: t('Sand', 'بيج'), hex: '#e6d5b8' },
  maroon: { id: 'maroon', name: t('Maroon', 'نبيتي'), hex: '#6b2232' },
  olive: { id: 'olive', name: t('Olive', 'زيتي'), hex: '#5c6440' },
  cream: { id: 'cream', name: t('Cream', 'كريمي'), hex: '#efe6d2' },
  sky: { id: 'sky', name: t('Sky Blue', 'لبني'), hex: '#9cc7e8' },
  blush: { id: 'blush', name: t('Blush Pink', 'وردي'), hex: '#f2c6c2' },
  yellow: { id: 'yellow', name: t('Sunny Yellow', 'أصفر'), hex: '#f6cf4b' },
  natural: { id: 'natural', name: t('Natural', 'طبيعي'), hex: '#efe4cc' },
  silver: { id: 'silver', name: t('Silver', 'فضي'), hex: '#c9ccd1' },
  kraft: { id: 'kraft', name: t('Kraft', 'كرافت'), hex: '#c8a77a' },
};

const APPAREL_SIZES = [
  { id: 'S', chestCm: 48, label: t('S', 'S'), surcharge: 0 },
  { id: 'M', chestCm: 52, label: t('M', 'M'), surcharge: 0 },
  { id: 'L', chestCm: 56, label: t('L', 'L'), surcharge: 0 },
  { id: 'XL', chestCm: 60, label: t('XL', 'XL'), surcharge: 0 },
  { id: '2XL', chestCm: 64, label: t('2XL', '2XL'), surcharge: 50 },
  { id: '3XL', chestCm: 68, label: t('3XL', '3XL'), surcharge: 75 },
];

const FRONT = t('Front', 'الأمام');
const BACK = t('Back', 'الخلف');

const sv = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCKUP_WIDTH}" height="${MOCKUP_HEIGHT}" viewBox="0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}">${inner}</svg>`;

// Mugs print all the way round, stopping 1 cm before each side of the handle (its base is
// about 2 cm wide): 25.9 cm round an 11 oz mug, less 2 cm and 2 × 1 cm = 21.9 cm, 8.9 cm high.
// The editor shows the print unrolled, with the handle at both ends; the previews wrap it round
// the mug, its middle (opposite the handle) facing you (`wrap.view`: the mug seen from there).
const MUG_WRAP_IN = Math.round((21.93 / 2.54) * 1000) / 1000; // 3.25 in × π = 25.93 cm round, less 4 cm
const MUG_WRAP_SVG = sv(
  '<rect x="19" y="219" width="474" height="176" rx="8" fill="#000" opacity=".08"/>' +
    '<rect x="13" y="212" width="474" height="176" rx="8" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' +
    // Where the handle is (both ends meet there): nothing printed in these strips.
    '<rect x="14.5" y="213.5" width="35.5" height="173" rx="7" fill="#000" opacity=".07"/><rect x="450" y="213.5" width="35.5" height="173" rx="7" fill="#000" opacity=".07"/>' +
    '<path d="M32 262 q-14 38 0 76 M468 262 q14 38 0 76" fill="none" stroke="{{L}}" stroke-width="6" stroke-linecap="round" opacity=".55"/>' +
    // The middle of the print: opposite the handle.
    '<path d="M250 216 v168" stroke="{{L}}" stroke-width="1.5" stroke-dasharray="3 7" opacity=".45"/>'
);
const MUG_VIEW_SVG = sv(
  '<ellipse cx="236" cy="482" rx="140" ry="18" fill="#000" opacity=".08"/>' +
    '<path d="M120 150 L340 150 L340 468 Q230 490 120 468 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
    '<ellipse cx="230" cy="150" rx="110" ry="18" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>'
);
const mugWrapSide = (id, name) => ({ id, name, svg: MUG_WRAP_SVG, printArea: { x: 50, y: 219, w: 400, h: 162 }, printWidthIn: MUG_WRAP_IN, wrap: { view: MUG_VIEW_SVG } });

// ---------- Shared garment drawings ----------
const TEE_BODY =
  '<path d="M150 88 L205 66 Q250 96 295 66 L350 88 L452 150 L412 246 L370 226 L372 548 Q250 562 128 548 L130 226 L88 246 L48 150 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M150 88 Q140 160 130 226 M350 88 Q360 160 370 226" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>' +
  '<path d="M60 160 L95 175 M440 160 L405 175" stroke="{{S}}" stroke-width="6" opacity=".6"/>' +
  '<path d="M140 520 Q250 534 362 520" fill="none" stroke="{{S}}" stroke-width="5" opacity=".5"/>';
const TEE_FRONT_NECK =
  '<path d="M205 66 Q250 120 295 66 Q250 86 205 66 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M199 70 Q250 132 301 70" fill="none" stroke="{{L}}" stroke-width="2" opacity=".5"/>';
const TEE_BACK_NECK =
  '<path d="M205 66 Q250 84 295 66" fill="none" stroke="{{L}}" stroke-width="3"/>' +
  '<path d="M201 72 Q250 92 299 72" fill="none" stroke="{{L}}" stroke-width="2" opacity=".5"/>';

const LONG_SLEEVE_TRIM =
  '<rect x="138" y="520" width="224" height="28" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<path d="M56 330 L98 348 L94 360 L52 342 Z M444 330 L402 348 L406 360 L448 342 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>';

const HOODIE_BODY =
  '<path d="M140 118 L198 96 Q250 150 302 96 L360 118 L444 330 L402 348 L362 250 L362 548 L138 548 L138 250 L98 348 L56 330 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  LONG_SLEEVE_TRIM +
  '<path d="M140 118 Q146 190 138 250 M360 118 Q354 190 362 250" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>';

const SWEAT_BODY =
  '<path d="M140 110 L198 88 Q250 120 302 88 L360 110 L444 330 L402 348 L362 250 L362 548 L138 548 L138 250 L98 348 L56 330 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  LONG_SLEEVE_TRIM +
  '<path d="M140 110 Q146 190 138 250 M360 110 Q354 190 362 250" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>';

const KIDS = (inner) => sv(`<g transform="translate(50 60) scale(0.8)">${inner}</g>`);

const SPIRAL = Array.from({ length: 15 }, (_, i) => {
  const y = 92 + i * 26;
  return `<rect x="108" y="${y}" width="34" height="9" rx="4.5" fill="#9ea3ab" stroke="#6b7079" stroke-width="1.5"/>`;
}).join('');

const PRODUCTS = [
  {
    id: 'tshirt',
    category: 'apparel',
    name: t('Classic T-Shirt', 'تيشيرت كلاسيك'),
    description: t('100% combed cotton, regular fit. Direct-to-garment printed.', 'قطن ممشط 100٪ بقصة عادية، وطباعة مباشرة على القماش.'),
    basePrice: 450,
    colors: [C.white, C.black, C.heather, C.navy, C.red, C.forest, C.sand],
    sizes: APPAREL_SIZES,
    sides: [
      { id: 'front', name: FRONT, svg: sv(TEE_BODY + TEE_FRONT_NECK), printArea: { x: 165, y: 140, w: 171, h: 228 }, printWidthIn: 12 },
      { id: 'back', name: BACK, svg: sv(TEE_BODY + TEE_BACK_NECK), printArea: { x: 165, y: 120, w: 171, h: 228 }, printWidthIn: 12 },
    ],
  },
  {
    id: 'kidstee',
    category: 'apparel',
    name: t('Kids T-Shirt', 'تيشيرت أطفال'),
    description: t('Soft, breathable cotton made for everyday play.', 'قطن ناعم ومريح يتحمل اللعب كل يوم.'),
    basePrice: 350,
    colors: [C.white, C.black, C.sky, C.blush, C.yellow, C.heather],
    sizes: [
      { id: '2-4', label: t('2–4 yrs', '2–4 سنوات'), surcharge: 0 },
      { id: '4-6', label: t('4–6 yrs', '4–6 سنوات'), surcharge: 0 },
      { id: '6-8', label: t('6–8 yrs', '6–8 سنوات'), surcharge: 0 },
      { id: '8-10', label: t('8–10 yrs', '8–10 سنوات'), surcharge: 0 },
      { id: '10-12', label: t('10–12 yrs', '10–12 سنة'), surcharge: 0 },
    ],
    sides: [
      { id: 'front', name: FRONT, svg: KIDS(TEE_BODY + TEE_FRONT_NECK), printArea: { x: 183, y: 172, w: 135, h: 180 }, printWidthIn: 9 },
      { id: 'back', name: BACK, svg: KIDS(TEE_BODY + TEE_BACK_NECK), printArea: { x: 183, y: 156, w: 135, h: 180 }, printWidthIn: 9 },
    ],
  },
  {
    id: 'hoodie',
    category: 'apparel',
    name: t('Pullover Hoodie', 'هودي'),
    description: t('Mid-weight fleece with kangaroo pocket and drawstring hood.', 'خامة ميلتون متوسطة الوزن بجيب أمامي وكابيشون برباط.'),
    basePrice: 950,
    colors: [C.black, { ...C.heather, hex: '#a9adb4' }, { ...C.navy, hex: '#22304f' }, C.maroon, C.olive, C.cream],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<path d="M175 112 Q170 30 250 28 Q330 30 325 112 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            HOODIE_BODY +
            '<path d="M198 96 Q250 152 302 96 Q290 58 250 54 Q210 58 198 96 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            '<path d="M210 96 Q250 136 290 96 Q282 70 250 67 Q218 70 210 96 Z" fill="{{L}}" opacity=".45"/>' +
            '<path d="M232 128 L228 205 M268 128 L272 205" stroke="{{L}}" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="M178 425 L322 425 L344 515 L156 515 Z" fill="none" stroke="{{L}}" stroke-width="2.5" stroke-linejoin="round"/>'
        ),
        printArea: { x: 175, y: 175, w: 150, h: 200 },
        printWidthIn: 10.5,
      },
      {
        id: 'back',
        name: BACK,
        svg: sv(HOODIE_BODY + '<path d="M178 104 Q250 182 322 104 Q250 54 178 104 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'),
        printArea: { x: 165, y: 195, w: 171, h: 228 },
        printWidthIn: 12,
      },
    ],
  },
  {
    id: 'sweatshirt',
    category: 'apparel',
    name: t('Crewneck Sweatshirt', 'سويتشيرت'),
    description: t('Cozy fleece crewneck with ribbed cuffs and hem.', 'سويتشيرت ميلتون دافئ برقبة دائرية وأساور مضلعة.'),
    basePrice: 800,
    colors: [C.black, C.heather, C.navy, C.cream, C.forest, C.blush],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          SWEAT_BODY +
            '<path d="M198 88 Q250 136 302 88 Q250 108 198 88 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M190 92 Q250 150 310 92" fill="none" stroke="{{L}}" stroke-width="2" opacity=".5"/>'
        ),
        printArea: { x: 169, y: 160, w: 162, h: 216 },
        printWidthIn: 12,
      },
      {
        id: 'back',
        name: BACK,
        svg: sv(SWEAT_BODY + '<path d="M198 88 Q250 106 302 88" fill="none" stroke="{{L}}" stroke-width="3"/>'),
        printArea: { x: 169, y: 140, w: 162, h: 216 },
        printWidthIn: 12,
      },
    ],
  },
  {
    id: 'cap',
    category: 'apparel',
    name: t('Baseball Cap', 'كاب'),
    description: t('Structured cotton twill with an adjustable strap.', 'كاب قطن متين بمقاس قابل للضبط.'),
    basePrice: 300,
    colors: [C.black, C.white, C.navy, C.red, C.sand],
    sizes: [{ id: 'one', label: t('One size', 'مقاس واحد'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<ellipse cx="250" cy="402" rx="175" ry="20" fill="#000" opacity=".08"/>' +
            '<path d="M110 330 Q110 150 250 140 Q390 150 390 330 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M182 152 Q158 240 168 330 M318 152 Q342 240 332 330" fill="none" stroke="{{L}}" stroke-width="2" opacity=".6"/>' +
            '<circle cx="250" cy="142" r="10" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
            '<path d="M86 330 Q250 300 414 330 Q434 382 250 398 Q66 382 86 330 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M112 342 Q250 318 388 342" fill="none" stroke="{{L}}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".6"/>'
        ),
        printArea: { x: 190, y: 212, w: 120, h: 84 },
        printWidthIn: 4.5,
      },
    ],
  },
  {
    id: 'mug',
    category: 'home',
    name: t('Ceramic Mug', 'مج سيراميك'),
    description: t('Glossy ceramic, printed all the way round. Dishwasher and microwave safe.', 'سيراميك لامع، مطبوع لفّة كاملة حوالين المج. آمن في غسالة الأطباق والميكروويف.'),
    basePrice: 250,
    colors: [{ ...C.white }, { ...C.black, hex: '#202124' }, C.sky, C.blush],
    sizes: [
      { id: '11oz', label: t('11 oz (325 ml)', '325 مل'), surcharge: 0 },
      { id: '15oz', label: t('15 oz (440 ml)', '440 مل'), surcharge: 60 },
    ],
    sides: [mugWrapSide('front', FRONT)],
  },
  {
    id: 'cushion',
    category: 'home',
    name: t('Throw Pillow', 'خدادية'),
    description: t('Soft polyester cover with a hidden zip, filling included.', 'كفر بوليستر ناعم بسوستة مخفية، مع الحشو.'),
    basePrice: 450,
    colors: [C.white, C.cream, C.lightgrey],
    sizes: [
      { id: '40', label: t('40 × 40 cm', '40 × 40 سم'), surcharge: 0 },
      { id: '50', label: t('50 × 50 cm', '50 × 50 سم'), surcharge: 100 },
    ],
    sides: [FRONT, BACK].map((name, i) => ({
      id: i ? 'back' : 'front',
      name,
      svg: sv(
        '<ellipse cx="250" cy="512" rx="190" ry="16" fill="#000" opacity=".08"/>' +
          '<path d="M70 110 Q250 88 430 110 Q452 300 430 490 Q250 512 70 490 Q48 300 70 110 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'
      ),
      overlay: sv(
        '<defs><radialGradient id="puff" cx="50%" cy="45%" r="62%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".16"/></radialGradient></defs>' +
          '<path d="M70 110 Q250 88 430 110 Q452 300 430 490 Q250 512 70 490 Q48 300 70 110 Z" fill="url(#puff)"/>' +
          '<path d="M96 128 Q250 112 404 128" fill="none" stroke="#fff" stroke-width="5" opacity=".35" stroke-linecap="round"/>'
      ),
      printArea: { x: 90, y: 140, w: 320, h: 320 },
      printWidthIn: 15.7,
    })),
  },
  {
    id: 'poster',
    category: 'home',
    name: t('Framed Poster', 'بوستر بإطار'),
    description: t('Archival matte paper in a ready-to-hang frame.', 'ورق مطفي عالي الجودة في إطار جاهز للتعليق.'),
    basePrice: 650,
    // The print goes on white paper, not on the frame colour.
    surface: '#ffffff',
    colors: [
      { id: 'black', name: t('Black frame', 'إطار أسود'), hex: '#1d1d1f' },
      { id: 'white', name: t('White frame', 'إطار أبيض'), hex: '#f6f6f4' },
      { id: 'oak', name: t('Oak frame', 'إطار خشب فاتح'), hex: '#b9895a' },
      { id: 'walnut', name: t('Walnut frame', 'إطار خشب غامق'), hex: '#5b3b26' },
    ],
    sizes: [
      { id: '30x40', label: t('30 × 40 cm', '30 × 40 سم'), surcharge: 0 },
      { id: '45x60', label: t('45 × 60 cm', '45 × 60 سم'), surcharge: 250 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<rect x="88" y="90" width="340" height="440" fill="#000" opacity=".12"/>' +
            '<rect x="80" y="80" width="340" height="440" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>' +
            '<rect x="100" y="100" width="300" height="400" fill="#ffffff" stroke="{{S}}" stroke-width="2"/>'
        ),
        printArea: { x: 100, y: 100, w: 300, h: 400 },
        printWidthIn: 17.7,
      },
    ],
  },
  {
    id: 'bottle',
    category: 'home',
    name: t('Water Bottle', 'زمزمية مياه'),
    description: t('Insulated stainless steel, keeps drinks cold for 24 hours.', 'ستانلس ستيل معزولة تحافظ على برودة المشروب 24 ساعة.'),
    basePrice: 450,
    colors: [C.white, C.black, C.silver, C.navy, C.blush],
    sizes: [{ id: '750', label: t('750 ml', '750 مل'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<ellipse cx="250" cy="556" rx="110" ry="12" fill="#000" opacity=".08"/>' +
            '<rect x="205" y="48" width="90" height="62" rx="12" fill="#2a2b30" stroke="#17181b" stroke-width="2"/>' +
            '<path d="M215 110 L285 110 L292 142 L208 142 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
            '<path d="M208 142 Q150 160 150 222 L150 518 Q150 552 184 552 L316 552 Q350 552 350 518 L350 222 Q350 160 292 142 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'
        ),
        overlay: sv(
          '<rect x="164" y="190" width="12" height="340" rx="6" fill="#fff" opacity=".35"/>' +
            '<rect x="326" y="190" width="12" height="340" rx="6" fill="#000" opacity=".08"/>'
        ),
        printArea: { x: 170, y: 250, w: 160, h: 200 },
        printWidthIn: 3.6,
      },
    ],
  },
  {
    id: 'tote',
    category: 'accessories',
    name: t('Canvas Tote Bag', 'شنطة قماش'),
    description: t('Heavy 12 oz cotton canvas with reinforced handles.', 'قماش كانفاس قطني سميك بيد مقوّاة.'),
    basePrice: 300,
    colors: [C.natural, { ...C.black, hex: '#222326' }, { ...C.navy, hex: '#24324f' }],
    sizes: [{ id: 'one', label: t('One size', 'مقاس واحد'), surcharge: 0 }],
    sides: [FRONT, BACK].map((name, i) => ({
      id: i ? 'back' : 'front',
      name,
      svg: sv(
        '<path d="M178 212 Q178 72 250 72 Q322 72 322 212" fill="none" stroke="{{L}}" stroke-width="18" stroke-linecap="round"/>' +
          '<path d="M178 212 Q178 72 250 72 Q322 72 322 212" fill="none" stroke="{{S}}" stroke-width="12" stroke-linecap="round"/>' +
          '<rect x="110" y="200" width="280" height="360" rx="4" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' +
          '<rect x="110" y="200" width="280" height="24" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>'
      ),
      printArea: { x: 150, y: 260, w: 200, h: 250 },
      printWidthIn: 11,
    })),
  },
  {
    id: 'phonecase',
    category: 'accessories',
    name: t('Slim Phone Case', 'جراب موبايل'),
    description: t('Impact-resistant polycarbonate shell with a glossy finish.', 'جراب بولي كربونات مقاوم للصدمات بلمسة لامعة.'),
    basePrice: 350,
    colors: [
      { id: 'clear', name: t('Frost', 'شفاف مطفي'), hex: '#e9edf1' },
      { id: 'black', name: t('Black', 'أسود'), hex: '#202124' },
      { id: 'lilac', name: t('Lilac', 'ليلكي'), hex: '#cdbfe6' },
    ],
    sizes: [
      { id: 'iphone16', label: t('iPhone 16', 'iPhone 16'), surcharge: 0 },
      { id: 'iphone16pro', label: t('iPhone 16 Pro', 'iPhone 16 Pro'), surcharge: 0 },
      { id: 'iphone16promax', label: t('iPhone 16 Pro Max', 'iPhone 16 Pro Max'), surcharge: 0 },
      { id: 'galaxys25', label: t('Galaxy S25', 'Galaxy S25'), surcharge: 0 },
      { id: 'galaxya55', label: t('Galaxy A55', 'Galaxy A55'), surcharge: 0 },
    ],
    sides: [
      {
        id: 'back',
        name: BACK,
        svg: sv(
          '<rect x="164" y="91" width="180" height="430" rx="38" fill="#000" opacity=".1"/>' +
            '<rect x="160" y="85" width="180" height="430" rx="38" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'
        ),
        overlay: sv(
          '<rect x="178" y="103" width="76" height="86" rx="20" fill="{{S}}" stroke="{{L}}" stroke-width="2.5"/>' +
            '<circle cx="199" cy="127" r="13" fill="#2a2b30" stroke="#55575e" stroke-width="3"/>' +
            '<circle cx="199" cy="166" r="13" fill="#2a2b30" stroke="#55575e" stroke-width="3"/>' +
            '<circle cx="234" cy="146" r="6" fill="#f3e6b5"/>' +
            '<path d="M332 140 Q336 300 332 460" fill="none" stroke="#fff" stroke-width="5" opacity=".25" stroke-linecap="round"/>'
        ),
        printArea: { x: 160, y: 85, w: 180, h: 430, rx: 38 },
        printWidthIn: 2.95,
      },
    ],
  },
  {
    id: 'mousepad',
    category: 'accessories',
    name: t('Mouse Pad', 'ماوس باد'),
    description: t('Smooth fabric top with a non-slip rubber base.', 'سطح قماش ناعم وقاعدة مطاط مانعة للانزلاق.'),
    basePrice: 220,
    colors: [{ id: 'white', name: t('Full print', 'طباعة كاملة'), hex: '#f4f5f7' }],
    sizes: [{ id: 'std', label: t('24 × 19 cm', '24 × 19 سم'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: t('Top', 'الوجه'),
        svg: sv(
          '<rect x="66" y="160" width="380" height="300" rx="22" fill="#000" opacity=".12"/>' +
            '<rect x="60" y="150" width="380" height="300" rx="22" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'
        ),
        printArea: { x: 60, y: 150, w: 380, h: 300, rx: 22 },
        printWidthIn: 9.45,
      },
    ],
  },
  {
    id: 'notebook',
    category: 'stationery',
    name: t('Spiral Notebook', 'كشكول سلك'),
    description: t('A5 hardcover with 120 pages and a custom cover.', 'مقاس A5 بغلاف مقوّى و120 صفحة.'),
    basePrice: 250,
    colors: [C.white, C.kraft, { ...C.black }],
    sizes: [
      { id: 'lined', label: t('Lined pages', 'صفحات مسطّرة'), surcharge: 0 },
      { id: 'dotted', label: t('Dotted pages', 'صفحات منقّطة'), surcharge: 0 },
      { id: 'blank', label: t('Blank pages', 'صفحات سادة'), surcharge: 0 },
    ],
    sides: [
      {
        id: 'front',
        name: t('Cover', 'الغلاف'),
        svg: sv(
          '<rect x="130" y="80" width="280" height="420" rx="6" fill="#000" opacity=".12"/>' +
            '<rect x="126" y="74" width="280" height="420" rx="6" fill="#ffffff" stroke="#c9ccd2" stroke-width="2"/>' +
            '<rect x="120" y="70" width="280" height="420" rx="6" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'
        ),
        overlay: sv(SPIRAL),
        printArea: { x: 140, y: 95, w: 255, h: 365 },
        printWidthIn: 5.8,
      },
    ],
  },
];

// ---------- Products added for DTF / DTG ----------
const POLO_COLLAR =
  '<path d="M205 66 L250 112 L232 122 L192 80 Z M295 66 L250 112 L268 122 L308 80 Z" fill="{{C}}" stroke="{{L}}" stroke-width="2.5" stroke-linejoin="round"/>' +
  '<rect x="241" y="108" width="18" height="70" rx="2" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<circle cx="250" cy="128" r="3.5" fill="{{L}}"/><circle cx="250" cy="152" r="3.5" fill="{{L}}"/>';
const OVERSIZED_BODY =
  '<path d="M140 92 L205 70 Q250 98 295 70 L360 92 L462 178 L420 266 L380 240 L384 560 Q250 574 116 560 L120 240 L80 266 L38 178 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M140 92 Q128 170 120 240 M360 92 Q372 170 380 240" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>' +
  '<path d="M130 532 Q250 546 370 532" fill="none" stroke="{{S}}" stroke-width="5" opacity=".5"/>';
const DENIM_BODY =
  '<path d="M150 95 L205 75 L250 120 L295 75 L350 95 L440 335 L400 350 L360 255 L360 520 L140 520 L140 255 L100 350 L60 335 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<rect x="140" y="494" width="220" height="26" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<path d="M56 323 L104 342 L98 358 L50 339 Z M444 323 L396 342 L402 358 L450 339 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<path d="M150 95 Q146 180 140 255 M350 95 Q354 180 360 255" fill="none" stroke="#e8b04b" stroke-width="1.6" stroke-dasharray="4 3" opacity=".8"/>';

PRODUCTS.push(
  {
    id: 'polo',
    category: 'apparel',
    name: t('Polo Shirt', 'تيشيرت بولو'),
    description: t('Piqué cotton polo with a button placket. Logo on the chest, big print on the back.', 'بولو قطن بيكيه بأزرار. شعار على الصدر وطباعة كبيرة على الظهر.'),
    basePrice: 550,
    colors: [C.white, C.black, C.navy, C.red, C.forest, C.heather],
    sizes: APPAREL_SIZES,
    sides: [
      { id: 'front', name: FRONT, svg: sv(TEE_BODY + POLO_COLLAR), printArea: { x: 296, y: 150, w: 57, h: 57 }, printWidthIn: 4 },
      { id: 'back', name: BACK, svg: sv(TEE_BODY + '<path d="M205 66 Q250 78 295 66 L295 76 Q250 90 205 76 Z" fill="{{C}}" stroke="{{L}}" stroke-width="2.5"/>'), printArea: { x: 165, y: 125, w: 171, h: 200 }, printWidthIn: 12 },
    ],
  },
  {
    id: 'oversized',
    category: 'apparel',
    name: t('Oversized T-Shirt', 'تيشيرت أوفر سايز'),
    description: t('Heavyweight cotton with dropped shoulders and a relaxed fit. Extra-large print area.', 'قطن ثقيل بأكتاف منسدلة وقصة واسعة، ومساحة طباعة أكبر.'),
    basePrice: 550,
    colors: [C.black, C.white, C.sand, C.heather, C.olive, C.navy],
    sizes: APPAREL_SIZES,
    sides: [
      { id: 'front', name: FRONT, svg: sv(OVERSIZED_BODY + '<path d="M205 70 Q250 124 295 70 Q250 90 205 70 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'), printArea: { x: 152, y: 140, w: 196, h: 252 }, printWidthIn: 14 },
      { id: 'back', name: BACK, svg: sv(OVERSIZED_BODY + '<path d="M205 70 Q250 88 295 70" fill="none" stroke="{{L}}" stroke-width="3"/>'), printArea: { x: 152, y: 120, w: 196, h: 252 }, printWidthIn: 14 },
    ],
  },
  {
    id: 'ziphoodie',
    category: 'apparel',
    name: t('Zip Hoodie', 'هودي بسوستة'),
    description: t('Full-zip fleece hoodie. Small logo on the chest, large print on the back.', 'هودي ميلتون بسوستة كاملة. شعار صغير على الصدر وطباعة كبيرة على الظهر.'),
    basePrice: 1100,
    colors: [C.black, { ...C.heather, hex: '#a9adb4' }, { ...C.navy, hex: '#22304f' }, C.maroon, C.cream],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<path d="M175 112 Q170 30 250 28 Q330 30 325 112 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            HOODIE_BODY +
            '<path d="M198 96 Q250 152 302 96 Q290 58 250 54 Q210 58 198 96 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            '<path d="M250 140 L250 548" stroke="{{L}}" stroke-width="4"/><path d="M250 140 L250 548" stroke="#c9ccd2" stroke-width="2" stroke-dasharray="2 3"/>' +
            '<path d="M232 128 L226 200 M268 128 L274 200" stroke="{{L}}" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="M170 420 L212 470 M330 420 L288 470" stroke="{{L}}" stroke-width="2.5" stroke-linecap="round"/>'
        ),
        printArea: { x: 282, y: 175, w: 60, h: 60 },
        printWidthIn: 4,
      },
      {
        id: 'back',
        name: BACK,
        svg: sv(HOODIE_BODY + '<path d="M178 104 Q250 182 322 104 Q250 54 178 104 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'),
        printArea: { x: 165, y: 195, w: 171, h: 228 },
        printWidthIn: 12,
      },
    ],
  },
  {
    id: 'denim',
    category: 'apparel',
    name: t('Denim Jacket', 'جاكيت جينز'),
    description: t('Classic trucker jacket in sturdy denim, with a custom print across the back.', 'جاكيت جينز كلاسيك متين بطباعة مخصصة على الظهر.'),
    basePrice: 1600,
    colors: [
      { id: 'mid', name: t('Mid blue', 'أزرق متوسط'), hex: '#4a6fa5' },
      { id: 'light', name: t('Light wash', 'أزرق فاتح'), hex: '#8fb0d6' },
      { id: 'dark', name: t('Dark indigo', 'أزرق غامق'), hex: '#26385c' },
      { id: 'black', name: t('Black', 'أسود'), hex: '#2b2d31' },
    ],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'back',
        name: BACK,
        svg: sv(
          DENIM_BODY +
            '<path d="M205 75 Q250 92 295 75 L295 88 Q250 104 205 88 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
            '<path d="M140 205 Q250 232 360 205" fill="none" stroke="{{L}}" stroke-width="2"/>' +
            '<path d="M140 211 Q250 238 360 211" fill="none" stroke="#e8b04b" stroke-width="1.4" stroke-dasharray="4 3" opacity=".8"/>' +
            '<path d="M200 230 L200 494 M300 230 L300 494" stroke="#e8b04b" stroke-width="1.4" stroke-dasharray="4 3" opacity=".7"/>'
        ),
        printArea: { x: 168, y: 250, w: 165, h: 165 },
        printWidthIn: 11,
      },
    ],
  },
  {
    id: 'apron',
    category: 'home',
    name: t('Kitchen Apron', 'مريلة مطبخ'),
    description: t('Durable cotton-poly apron with a front pocket and long waist ties.', 'مريلة قطن وبوليستر متينة بجيب أمامي ورباط طويل.'),
    basePrice: 350,
    colors: [C.black, C.white, C.navy, C.red, { id: 'khaki', name: t('Khaki', 'كاكي'), hex: '#b9a37e' }],
    sizes: [{ id: 'one', label: t('One size', 'مقاس واحد'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<path d="M200 62 Q250 14 300 62" fill="none" stroke="{{L}}" stroke-width="11" stroke-linecap="round"/>' +
            '<path d="M200 62 Q250 14 300 62" fill="none" stroke="{{S}}" stroke-width="7" stroke-linecap="round"/>' +
            '<path d="M120 236 Q80 252 58 304 M380 236 Q420 252 442 304" fill="none" stroke="{{S}}" stroke-width="9" stroke-linecap="round"/>' +
            '<path d="M195 60 L305 60 L310 200 Q362 210 380 232 L390 542 Q250 554 110 542 L120 232 Q138 210 190 200 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M175 384 L325 384 L325 470 L175 470 Z M250 384 L250 470" fill="none" stroke="{{L}}" stroke-width="2.5"/>'
        ),
        printArea: { x: 175, y: 140, w: 150, h: 180 },
        printWidthIn: 10,
      },
    ],
  },
  {
    id: 'onesie',
    category: 'apparel',
    name: t('Baby Onesie', 'بادي بيبي'),
    description: t('Soft cotton bodysuit with envelope neckline and snap closure.', 'بادي قطن ناعم بفتحة رقبة واسعة وكبسون.'),
    basePrice: 300,
    colors: [C.white, C.blush, C.sky, C.yellow, C.lightgrey],
    sizes: [
      { id: '0-3', label: t('0–3 months', '0–3 شهور'), surcharge: 0 },
      { id: '3-6', label: t('3–6 months', '3–6 شهور'), surcharge: 0 },
      { id: '6-12', label: t('6–12 months', '6–12 شهر'), surcharge: 0 },
      { id: '12-18', label: t('12–18 months', '12–18 شهر'), surcharge: 0 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<path d="M185 120 L215 105 Q250 126 285 105 L315 120 L372 162 L346 214 L320 200 L322 400 Q322 472 286 502 L276 542 L224 542 L214 502 Q178 472 178 400 L180 200 L154 214 L128 162 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M215 105 Q250 142 285 105 Q250 120 215 105 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2.5"/>' +
            '<circle cx="235" cy="530" r="4" fill="{{L}}"/><circle cx="250" cy="530" r="4" fill="{{L}}"/><circle cx="265" cy="530" r="4" fill="{{L}}"/>'
        ),
        printArea: { x: 199, y: 200, w: 102, h: 102 },
        printWidthIn: 6,
      },
    ],
  },
  {
    id: 'kidshoodie',
    category: 'apparel',
    name: t('Kids Hoodie', 'هودي أطفال'),
    description: t('Warm fleece hoodie in kids sizes, printed front and back.', 'هودي ميلتون دافئ بمقاسات أطفال، طباعة أمام وخلف.'),
    basePrice: 700,
    colors: [C.black, C.heather, C.sky, C.blush, C.yellow],
    sizes: [
      { id: '4-6', label: t('4–6 yrs', '4–6 سنوات'), surcharge: 0 },
      { id: '6-8', label: t('6–8 yrs', '6–8 سنوات'), surcharge: 0 },
      { id: '8-10', label: t('8–10 yrs', '8–10 سنوات'), surcharge: 0 },
      { id: '10-12', label: t('10–12 yrs', '10–12 سنة'), surcharge: 0 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: KIDS(
          '<path d="M175 112 Q170 30 250 28 Q330 30 325 112 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            HOODIE_BODY +
            '<path d="M198 96 Q250 152 302 96 Q290 58 250 54 Q210 58 198 96 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>' +
            '<path d="M232 128 L228 205 M268 128 L272 205" stroke="{{L}}" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="M178 425 L322 425 L344 515 L156 515 Z" fill="none" stroke="{{L}}" stroke-width="2.5" stroke-linejoin="round"/>'
        ),
        printArea: { x: 190, y: 200, w: 120, h: 160 },
        printWidthIn: 8,
      },
      {
        id: 'back',
        name: BACK,
        svg: KIDS(HOODIE_BODY + '<path d="M178 104 Q250 182 322 104 Q250 54 178 104 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'),
        printArea: { x: 182, y: 216, w: 137, h: 182 },
        printWidthIn: 9,
      },
    ],
  },
  {
    id: 'shorts',
    category: 'apparel',
    name: t('Jogger Shorts', 'شورت'),
    description: t('Fleece shorts with a drawstring waist. Small print on the leg.', 'شورت ميلتون برباط على الوسط. طباعة صغيرة على الرِّجل.'),
    basePrice: 450,
    colors: [C.black, C.heather, C.navy, C.olive],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<path d="M130 182 L370 182 L388 440 L262 452 L250 262 L238 452 L112 440 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<rect x="128" y="150" width="244" height="34" rx="4" fill="{{S}}" stroke="{{L}}" stroke-width="2.5"/>' +
            '<path d="M240 184 Q236 214 228 230 M260 184 Q264 214 272 230" fill="none" stroke="{{L}}" stroke-width="2.5" stroke-linecap="round"/>' +
            '<path d="M140 200 Q160 240 190 250 M360 200 Q340 240 310 250" fill="none" stroke="{{L}}" stroke-width="2" opacity=".6"/>' +
            '<path d="M114 420 L238 432 M262 432 L386 420" stroke="{{S}}" stroke-width="6" opacity=".7"/>'
        ),
        printArea: { x: 290, y: 320, w: 60, h: 60 },
        printWidthIn: 4,
      },
    ],
  },
);

// ---------- Gifts, occasions, school and more ----------
const ONE = [{ id: 'one', label: t('One size', 'مقاس واحد'), surcharge: 0 }];
const FULL = { id: 'white', name: t('Full print', 'طباعة كاملة'), hex: '#ffffff' };
const shadowRect = (x, y, w, h, rx = 0) => `<rect x="${x + 6}" y="${y + 8}" width="${w}" height="${h}" rx="${rx}" fill="#000" opacity=".12"/>`;
const flat = (x, y, w, h, rx = 0) => sv(shadowRect(x, y, w, h, rx) + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>`);
const JERSEY_BODY =
  '<path d="M150 92 L205 70 L250 84 L295 70 L350 92 L440 160 L404 236 L362 214 L364 540 Q250 552 136 540 L138 214 L96 236 L60 160 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M150 92 L118 200 M350 92 L382 200" fill="none" stroke="{{L}}" stroke-width="2" opacity=".45"/>';

PRODUCTS.push(
  {
    id: 'jersey',
    category: 'apparel',
    name: t('Football Jersey', 'تيشيرت كورة'),
    description: t('Breathable sports jersey. Your team logo on the front, name and number on the back.', 'تيشيرت رياضي خفيف. شعار الفريق على الصدر، والاسم والرقم على الظهر.'),
    basePrice: 400,
    colors: [C.white, C.black, C.red, { ...C.navy, hex: '#1d2c5e' }, { id: 'royal', name: t('Royal Blue', 'أزرق ملكي'), hex: '#2353b8' }, C.yellow, { ...C.forest, hex: '#1f7a45', name: t('Green', 'أخضر') }],
    sizes: [
      { id: 'kids', label: t('Kids 8–12', 'أطفال 8–12'), surcharge: 0 },
      ...APPAREL_SIZES.map((z) => ({ ...z, surcharge: z.surcharge + 50 })),
    ],
    sides: [
      { id: 'front', name: FRONT, svg: sv(JERSEY_BODY + '<path d="M215 74 L250 120 L285 74" fill="none" stroke="{{S}}" stroke-width="10" stroke-linejoin="round"/>'), printArea: { x: 172, y: 150, w: 156, h: 190 }, printWidthIn: 11 },
      { id: 'back', name: BACK, svg: sv(JERSEY_BODY + '<path d="M205 70 Q250 92 295 70" fill="none" stroke="{{S}}" stroke-width="8"/>'), printArea: { x: 158, y: 120, w: 184, h: 260 }, printWidthIn: 12 },
    ],
  },
  {
    id: 'magicmug',
    category: 'home',
    name: t('Magic Mug', 'مج سحري'),
    description: t('Black when cold; your design appears when you pour in a hot drink.', 'أسود وهو بارد، وتظهر الطباعة لما تصب مشروب سخن.'),
    basePrice: 350,
    colors: [{ ...C.black, hex: '#1c1d20', name: t('Black (turns white when hot)', 'أسود (يتحول أبيض مع السخونة)') }],
    sizes: [{ id: '11oz', label: t('11 oz (325 ml)', '325 مل'), surcharge: 0 }],
    sides: [mugWrapSide('front', FRONT)],
  },
  {
    id: 'couplemugs',
    category: 'occasions',
    name: t('Couple Mugs (pair)', 'مجين للكابلز'),
    description: t('Two matching mugs, a different design on each. Perfect for engagements and weddings.', 'مجين متطابقين بتصميم مختلف لكل واحد. مثالي للخطوبة والفرح.'),
    basePrice: 450,
    extraSidePrice: 0,
    colors: [{ ...C.white }, { ...C.black, hex: '#202124' }, C.blush],
    sizes: [{ id: '11oz', label: t('2 × 11 oz (325 ml)', '2 × 325 مل'), surcharge: 0 }],
    sides: [
      mugWrapSide('mug1', t('Mug 1', 'المج الأول')),
      mugWrapSide('mug2', t('Mug 2', 'المج الثاني')),
    ],
  },
  {
    id: 'tumbler',
    category: 'home',
    name: t('Travel Tumbler', 'تمبلر للسفر'),
    description: t('Double-wall stainless steel with a sip lid. Keeps coffee hot for hours.', 'ستانلس ستيل بجدارين وغطاء للشرب. يحافظ على القهوة سخنة لساعات.'),
    basePrice: 500,
    colors: [C.white, { ...C.black, hex: '#222326' }, C.blush, C.sky, { ...C.forest, hex: '#5e7a64', name: t('Sage', 'أخضر هادي') }],
    sizes: [{ id: '20oz', label: t('20 oz (590 ml)', '590 مل'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<ellipse cx="250" cy="560" rx="96" ry="12" fill="#000" opacity=".08"/>' +
            '<rect x="168" y="56" width="164" height="40" rx="10" fill="#e8eaed" stroke="{{L}}" stroke-width="2"/>' +
            '<path d="M170 96 L330 96 L330 540 Q250 556 170 540 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'
        ),
        overlay: sv('<rect x="180" y="110" width="10" height="420" rx="5" fill="#fff" opacity=".3"/>'),
        printArea: { x: 182, y: 150, w: 136, h: 212 },
        printWidthIn: 3.6,
      },
    ],
  },
  {
    id: 'coasters',
    category: 'home',
    name: t('Coaster Set (4)', 'طقم كوستر (4)'),
    description: t('Four glossy ceramic coasters with cork backs, all with your design.', '4 كوستر سيراميك لامع بقاعدة فلين، كلها بتصميمك.'),
    basePrice: 300,
    colors: [FULL],
    sizes: [
      { id: 'set4', label: t('Set of 4', 'طقم 4 قطع'), surcharge: 0 },
      { id: 'set6', label: t('Set of 6', 'طقم 6 قطع'), surcharge: 120 },
    ],
    sides: [{ id: 'front', name: t('Top', 'الوجه'), svg: flat(100, 150, 300, 300, 26), printArea: { x: 100, y: 150, w: 300, h: 300, rx: 26 }, printWidthIn: 3.94 }],
  },
  {
    id: 'tablecloth',
    category: 'home',
    name: t('Ramadan Tablecloth', 'مفرش سفرة رمضان'),
    description: t('Washable printed tablecloth for iftar gatherings, 140 × 180 cm.', 'مفرش سفرة مطبوع قابل للغسيل لعزومات الفطار، 140 × 180 سم.'),
    basePrice: 650,
    colors: [FULL],
    sizes: [{ id: '140x180', label: t('140 × 180 cm', '140 × 180 سم'), surcharge: 0 }],
    sides: [{ id: 'front', name: t('Top', 'الوجه'), svg: flat(110, 60, 280, 360), printArea: { x: 110, y: 60, w: 280, h: 360 }, printWidthIn: 55.1 }],
  },
  {
    id: 'prayermat',
    category: 'occasions',
    name: t('Personalised Prayer Mat', 'سجادة صلاة باسمك'),
    description: t('Soft velvet prayer mat, 65 × 115 cm, printed with a name or design. A lovely gift.', 'سجادة صلاة قطيفة ناعمة 65 × 115 سم مطبوعة بالاسم أو تصميمك. هدية جميلة.'),
    basePrice: 550,
    colors: [FULL],
    sizes: [{ id: '65x115', label: t('65 × 115 cm', '65 × 115 سم'), surcharge: 0 }],
    sides: [
      {
        id: 'front',
        name: t('Top', 'الوجه'),
        svg: sv(shadowRect(160, 50, 180, 318) + '<rect x="160" y="50" width="180" height="318" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' +
          Array.from({ length: 18 }, (_, i) => `<path d="M${165 + i * 10} 50 l0 -16 M${165 + i * 10} 368 l0 16" stroke="#e6dccb" stroke-width="2"/>`).join('')),
        printArea: { x: 160, y: 50, w: 180, h: 318 },
        printWidthIn: 25.6,
      },
    ],
  },
  {
    id: 'eidenvelopes',
    category: 'occasions',
    name: t('Eid Money Envelopes', 'ظروف عيدية'),
    description: t('Pack of printed envelopes for Eidiya, 9 × 16.5 cm.', 'باكت ظروف عيدية مطبوعة، 9 × 16.5 سم.'),
    basePrice: 150,
    colors: [C.white, C.kraft, { id: 'gold', name: t('Gold', 'دهبي'), hex: '#d9b866' }, { id: 'green', name: t('Green', 'أخضر'), hex: '#2f6b4f' }, { ...C.red, hex: '#b8292f' }],
    sizes: [
      { id: '10', label: t('10 envelopes', '10 ظروف'), surcharge: 0 },
      { id: '25', label: t('25 envelopes', '25 ظرف'), surcharge: 175 },
      { id: '50', label: t('50 envelopes', '50 ظرف'), surcharge: 400 },
    ],
    sides: [{ id: 'front', name: FRONT, svg: flat(170, 90, 160, 293), printArea: { x: 170, y: 90, w: 160, h: 293 }, printWidthIn: 3.54 }],
  },
  {
    id: 'greetingcard',
    category: 'occasions',
    name: t('Greeting Card', 'كارت تهنئة'),
    description: t('Folded card on thick matte card stock, blank inside, with a white envelope.', 'كارت مطوي على ورق مقوّى مطفي، من الداخل فاضي، ومعاه ظرف أبيض.'),
    basePrice: 60,
    colors: [C.white, C.cream, C.kraft],
    sizes: [
      { id: 'A6', label: t('A6 (10.5 × 14.8 cm)', 'A6 (10.5 × 14.8 سم)'), surcharge: 0 },
      { id: 'A5', label: t('A5 (14.8 × 21 cm)', 'A5 (14.8 × 21 سم)'), surcharge: 30 },
    ],
    sides: [{ id: 'front', name: t('Cover', 'الغلاف'), svg: flat(140, 80, 220, 311), printArea: { x: 140, y: 80, w: 220, h: 311 }, printWidthIn: 4.13 }],
  },
  {
    id: 'invitations',
    category: 'occasions',
    name: t('Invitation Cards', 'كروت دعوة'),
    description: t('Flat 350 gsm invitation cards (13 × 18 cm) with white envelopes. For weddings, engagements, birthdays and events. Upload a list to print every guest\'s name.', 'كروت دعوة 350 جرام (13 × 18 سم) مع ظروف بيضاء. للأفراح والخطوبة وأعياد الميلاد والمناسبات. ارفع قائمة الأسماء ونطبع اسم كل ضيف على كارته.'),
    basePrice: 35,
    colors: [
      { id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' },
      { id: 'pearl', name: t('Pearl shimmer', 'لؤلؤي لامع'), hex: '#f7f4ee' },
      C.cream,
      C.kraft,
    ],
    sizes: [{ id: '13x18', label: t('13 × 18 cm + envelope', '13 × 18 سم + ظرف'), surcharge: 0 }],
    sides: [
      { id: 'front', name: FRONT, svg: flat(150, 75, 200, 280, 3), printArea: { x: 150, y: 75, w: 200, h: 280, rx: 3 }, printWidthIn: 5.12 },
      { id: 'back', name: BACK, svg: flat(150, 75, 200, 280, 3), printArea: { x: 150, y: 75, w: 200, h: 280, rx: 3 }, printWidthIn: 5.12 },
    ],
    extraSidePrice: 10,
  },
  {
    id: 'plaque',
    category: 'occasions',
    name: t('Acrylic Photo Plaque', 'بلاك أكريليك للصور'),
    description: t('Thin crystal-clear acrylic plaque. For weddings, graduation and memories.', 'بلاك أكريليك شفاف ورفيع. للأفراح والتخرج والذكريات.'),
    basePrice: 450,
    colors: [{ id: 'clear', name: t('Crystal clear', 'شفاف كريستال'), hex: '#ffffff' }],
    sizes: [
      { id: '13x18', label: t('13 × 18 cm', '13 × 18 سم'), surcharge: 0 },
      { id: '18x25', label: t('18 × 25 cm', '18 × 25 سم'), surcharge: 250 },
    ],
    sides: [{ id: 'front', name: FRONT, svg: flat(140, 90, 220, 305, 4), printArea: { x: 140, y: 90, w: 220, h: 305 }, printWidthIn: 5.12 }],
  },
  {
    id: 'sign',
    category: 'occasions',
    name: t('Welcome Sign', 'لوحة ترحيب'),
    description: t('Rigid foam board sign for weddings, engagements, birthdays and Ramadan, with an easel.', 'لوحة فوم بورد مقوّاة للأفراح والخطوبة وأعياد الميلاد ورمضان، ومعاها حامل.'),
    basePrice: 550,
    colors: [C.white],
    sizes: [
      { id: 'A2', label: t('A2 (42 × 59.4 cm)', 'A2 (42 × 59.4 سم)'), surcharge: 0 },
      { id: 'A1', label: t('A1 (59.4 × 84 cm)', 'A1 (59.4 × 84 سم)'), surcharge: 300 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv('<path d="M210 420 L170 580 M290 420 L330 580 M250 420 L250 560" stroke="#c9a77a" stroke-width="10" stroke-linecap="round"/>' + shadowRect(150, 50, 200, 283) + '<rect x="150" y="50" width="200" height="283" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'),
        printArea: { x: 150, y: 50, w: 200, h: 283 },
        printWidthIn: 16.54,
      },
    ],
  },
  {
    id: 'deskmat',
    category: 'accessories',
    name: t('Desk Mat XL', 'ماوس باد كبير (ديسك مات)'),
    description: t('80 × 35 cm stitched-edge desk mat for keyboard and mouse.', 'ديسك مات 80 × 35 سم بحواف مخيطة للكيبورد والماوس.'),
    basePrice: 450,
    colors: [FULL],
    sizes: [{ id: '80x35', label: t('80 × 35 cm', '80 × 35 سم'), surcharge: 0 }],
    sides: [{ id: 'front', name: t('Top', 'الوجه'), svg: flat(30, 230, 440, 193, 14), printArea: { x: 30, y: 230, w: 440, h: 193, rx: 14 }, printWidthIn: 31.5 }],
  },
  {
    id: 'keychain',
    category: 'accessories',
    name: t('Acrylic Keychain', 'ميدالية أكريليك'),
    description: t('Glossy acrylic tag with a metal ring, printed on both sides with the same design.', 'ميدالية أكريليك لامعة بحلقة معدن، مطبوعة بنفس التصميم.'),
    basePrice: 90,
    colors: [C.white],
    sizes: [
      { id: '1', label: t('1 keychain', 'ميدالية واحدة'), surcharge: 0 },
      { id: '5', label: t('5 keychains', '5 ميداليات'), surcharge: 260 },
      { id: '10', label: t('10 keychains', '10 ميداليات'), surcharge: 560 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv('<circle cx="250" cy="105" r="42" fill="none" stroke="#a7abb2" stroke-width="9"/>' + shadowRect(170, 150, 160, 240, 22) + '<rect x="170" y="150" width="160" height="240" rx="22" fill="{{C}}" stroke="{{L}}" stroke-width="3"/><circle cx="250" cy="172" r="9" fill="#e6e8eb" stroke="{{L}}" stroke-width="2"/>'),
        printArea: { x: 178, y: 192, w: 144, h: 190, rx: 14 },
        printWidthIn: 1.42,
      },
    ],
  },
  {
    id: 'stickersheet',
    category: 'school',
    name: t('Sticker Sheet', 'شيت ستيكرز'),
    description: t('Glossy waterproof vinyl sticker sheet, kiss-cut around your shapes.', 'شيت ستيكرز فينيل لامع ضد المياه، مقصوص حوالين الأشكال.'),
    basePrice: 90,
    colors: [C.white],
    sizes: [
      { id: 'A5', label: t('A5 sheet', 'شيت A5'), surcharge: 0 },
      { id: 'A4', label: t('A4 sheet', 'شيت A4'), surcharge: 60 },
    ],
    sides: [{ id: 'front', name: t('Sheet', 'الشيت'), svg: flat(140, 80, 220, 311), printArea: { x: 140, y: 80, w: 220, h: 311 }, printWidthIn: 5.83 }],
  },
  {
    id: 'namelabels',
    category: 'school',
    name: t('School Name Labels', 'ستيكرات أسماء للمدرسة'),
    description: t('Waterproof name stickers for books, bottles and lunch boxes. One design, many labels.', 'ستيكرات أسماء ضد المياه للكتب والزمزمية واللانش بوكس. تصميم واحد على كل الستيكرات.'),
    basePrice: 120,
    colors: [C.white],
    sizes: [
      { id: '40', label: t('40 labels (5.5 × 4 cm)', '40 ستيكر (5.5 × 4 سم)'), surcharge: 0 },
      { id: '80', label: t('80 labels (5.5 × 4 cm)', '80 ستيكر (5.5 × 4 سم)'), surcharge: 90 },
    ],
    sides: [{ id: 'front', name: t('Label', 'الستيكر'), svg: flat(70, 170, 360, 262, 26), printArea: { x: 70, y: 170, w: 360, h: 262, rx: 26 }, printWidthIn: 2.17 }],
  },
  {
    id: 'lunchbag',
    category: 'school',
    name: t('Kids Lunch Bag', 'شنطة لانش بوكس'),
    description: t('Insulated zip-top lunch bag with a carry handle. Printed with a name or design.', 'شنطة لانش بوكس معزولة بسوستة ومقبض، مطبوعة بالاسم أو تصميمك.'),
    basePrice: 350,
    colors: [C.white, { ...C.navy, hex: '#263a66' }, C.blush, C.sky],
    sizes: ONE,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv('<path d="M200 150 Q200 92 250 92 Q300 92 300 150" fill="none" stroke="{{L}}" stroke-width="10"/>' + shadowRect(110, 150, 280, 380, 18) + '<rect x="110" y="150" width="280" height="380" rx="18" fill="{{C}}" stroke="{{L}}" stroke-width="3"/><path d="M110 210 L390 210" stroke="{{S}}" stroke-width="6"/>'),
        printArea: { x: 140, y: 240, w: 220, h: 226 },
        printWidthIn: 8,
      },
    ],
  },
  {
    id: 'pencilcase',
    category: 'school',
    name: t('Pencil Case', 'مقلمة'),
    description: t('Canvas zip pouch for pens and pencils, 22 × 14 cm.', 'مقلمة قماش كانفاس بسوستة، 22 × 14 سم.'),
    basePrice: 180,
    colors: [C.natural, C.black, { ...C.navy, hex: '#263a66' }],
    sizes: ONE,
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(shadowRect(60, 170, 380, 250, 10) + '<rect x="60" y="170" width="380" height="250" rx="10" fill="{{C}}" stroke="{{L}}" stroke-width="3"/><path d="M60 190 L440 190" stroke="{{L}}" stroke-width="4" stroke-dasharray="3 3"/>'),
        printArea: { x: 85, y: 210, w: 330, h: 199 },
        printWidthIn: 7.87,
      },
    ],
  },
);

// ---------- Business ----------
/*
 * Packs: [id, English, Arabic, surcharge, SMALL]. SMALL marks a small pack below the product's usual
 * smallest one (1, 10, 25 copies…), priced per copy at 1 copy = 5×, 10 = 2×, 25 = 1.25× that pack's
 * rate. Its surcharge is written against the product's listed price, but the pack keeps its share of the
 * product's price when the owner changes that price in Accounts (`smallPack`, see src/accounting.js), so
 * a lower price never makes it free or negative.
 */
const SMALL = true;
const qty = (rows) => rows.map(([id, en, ar, surcharge, small]) => ({ id, label: t(en, ar), surcharge, ...(small ? { smallPack: true } : {}) }));
const PAPER_FINISH = [
  { id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' },
  { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' },
  { id: 'kraft', name: t('Kraft', 'كرافت'), hex: '#c8a77a' },
];

PRODUCTS.push(
  {
    id: 'bizcards',
    category: 'business',
    name: t('Business Cards', 'كروت شخصية'),
    description: t('Thick 350 gsm cards, 9 × 5.5 cm, printed on one or both sides.', 'كروت 350 جرام سميكة، 9 × 5.5 سم، طباعة وجه أو وجهين.'),
    basePrice: 150,
    extraSidePrice: 50,
    colorLabel: t('Paper', 'الورق'),
    colors: PAPER_FINISH,
    // Cellophane lamination (سلوفان) on both sides: priced per pack, so it grows with the number of cards.
    options: [{
      id: 'lamination',
      name: t('Lamination', 'سلوفان'),
      help: t('A thin film over the print that protects the cards and makes them feel stronger.', 'طبقة رقيقة فوق الطباعة بتحمي الكروت وبتخليها أتقل في الإيد.'),
      choices: [
        { id: 'none', name: t('No lamination', 'بدون سلوفان'), price: 0 },
        { id: 'matte', name: t('Matte lamination', 'سلوفان مط'), price: { 100: 60, 200: 100, 300: 140, 500: 200, 1000: 350 } },
        { id: 'gloss', name: t('Glossy lamination', 'سلوفان لامع'), price: { 100: 60, 200: 100, 300: 140, 500: 200, 1000: 350 } },
      ],
    }],
    // Packs of hundreds.
    sizes: qty([['100', '100 cards', '100 كارت', 0], ['200', '200 cards', '200 كارت', 100], ['300', '300 cards', '300 كارت', 170], ['500', '500 cards', '500 كارت', 250], ['1000', '1000 cards', '1000 كارت', 450]]),
    sides: [
      { id: 'front', name: FRONT, svg: flat(70, 220, 360, 220, 4), printArea: { x: 70, y: 220, w: 360, h: 220 }, printWidthIn: 3.54 },
      { id: 'back', name: BACK, svg: flat(70, 220, 360, 220, 4), printArea: { x: 70, y: 220, w: 360, h: 220 }, printWidthIn: 3.54 },
    ],
  },
  {
    id: 'flyers',
    category: 'business',
    name: t('Flyers', 'فلايرز'),
    description: t('Full-colour flyers on 150 gsm satin paper, one or both sides.', 'فلايرز ألوان كاملة على ورق 150 جرام ساتان، وجه أو وجهين.'),
    basePrice: 250,
    colors: [{ id: 'satin', name: t('Satin white', 'أبيض ساتان'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' }],
    sizes: qty([['A5-100', 'A5 × 100', 'A5 × 100', 0], ['A5-500', 'A5 × 500', 'A5 × 500', 450], ['A5-1000', 'A5 × 1000', 'A5 × 1000', 750], ['A4-100', 'A4 × 100', 'A4 × 100', 150], ['A4-500', 'A4 × 500', 'A4 × 500', 900]]),
    sides: [
      { id: 'front', name: FRONT, svg: flat(130, 70, 240, 339), printArea: { x: 130, y: 70, w: 240, h: 339 }, printWidthIn: 8.27 },
      { id: 'back', name: BACK, svg: flat(130, 70, 240, 339), printArea: { x: 130, y: 70, w: 240, h: 339 }, printWidthIn: 8.27 },
    ],
  },
  {
    id: 'letterhead',
    category: 'business',
    name: t('Letterhead Paper', 'ورق مراسلات (ليترهيد)'),
    description: t('A4 100 gsm paper with your logo and details; works in any office printer.', 'ورق A4 وزن 100 جرام بشعارك وبياناتك، يشتغل في أي طابعة مكتب.'),
    basePrice: 300,
    colors: [C.white, C.cream],
    sizes: qty([['100', '100 sheets', '100 ورقة', 0], ['250', '250 sheets', '250 ورقة', 300], ['500', '500 sheets', '500 ورقة', 550]]),
    sides: [{ id: 'front', name: FRONT, svg: flat(130, 70, 240, 339), printArea: { x: 130, y: 70, w: 240, h: 339 }, printWidthIn: 8.27 }],
  },
  {
    id: 'dlenvelopes',
    category: 'business',
    name: t('Company Envelopes (DL)', 'ظروف شركات DL'),
    description: t('11 × 22 cm envelopes that fit an A4 letter folded in three, printed with your logo.', 'ظروف 11 × 22 سم تناسب ورقة A4 مطوية 3 مرات، مطبوعة بشعارك.'),
    basePrice: 350,
    colors: [C.white, C.kraft],
    sizes: qty([['100', '100 envelopes', '100 ظرف', 0], ['250', '250 envelopes', '250 ظرف', 400], ['500', '500 envelopes', '500 ظرف', 700]]),
    sides: [{ id: 'front', name: FRONT, svg: flat(30, 200, 440, 220), printArea: { x: 30, y: 200, w: 440, h: 220 }, printWidthIn: 8.66 }],
  },
  {
    id: 'logostickers',
    category: 'business',
    name: t('Round Logo Stickers', 'ستيكرات لوجو دائرية'),
    description: t('Glossy waterproof 5 cm stickers for packaging, bags and boxes.', 'ستيكرات لامعة ضد المياه مقاس 5 سم للتغليف والأكياس والعلب.'),
    basePrice: 200,
    colors: [C.white, { id: 'clear', name: t('Clear', 'شفاف'), hex: '#f3f5f7' }, C.kraft],
    sizes: qty([['100', '100 stickers', '100 ستيكر', 0], ['250', '250 stickers', '250 ستيكر', 180], ['500', '500 stickers', '500 ستيكر', 380], ['1000', '1000 stickers', '1000 ستيكر', 650]]),
    sides: [{ id: 'front', name: t('Sticker', 'الستيكر'), svg: sv('<circle cx="256" cy="308" r="160" fill="#000" opacity=".1"/><circle cx="250" cy="300" r="160" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'), printArea: { x: 90, y: 140, w: 320, h: 320, rx: 160 }, printWidthIn: 1.97 }],
  },
  {
    id: 'rollup',
    category: 'business',
    name: t('Roll-up Banner', 'رول أب بانر'),
    description: t('85 × 200 cm banner on an aluminium stand with a carry bag. For shops, events and exhibitions.', 'بانر 85 × 200 سم على ستاند ألومنيوم مع شنطة. للمحلات والمعارض والإيفنتات.'),
    basePrice: 1200,
    colors: [C.white],
    sizes: qty([['85x200', '85 × 200 cm + stand', '85 × 200 سم + ستاند', 0]]),
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv('<rect x="150" y="430" width="200" height="14" rx="4" fill="#b9bdc4"/><rect x="160" y="22" width="180" height="8" rx="3" fill="#b9bdc4"/>' + shadowRect(165, 30, 170, 400) + '<rect x="165" y="30" width="170" height="400" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'),
        printArea: { x: 165, y: 30, w: 170, h: 400 },
        printWidthIn: 33.46,
      },
    ],
  },
  {
    id: 'paperbags',
    category: 'business',
    name: t('Paper Shopping Bags', 'شنط ورق بلوجو'),
    description: t('Sturdy paper bags with twisted handles, 25 × 32 cm, printed with your logo.', 'شنط ورق متينة بيد مبرومة، 25 × 32 سم، مطبوعة بشعارك.'),
    basePrice: 500,
    colors: [C.white, C.kraft, { ...C.black, hex: '#26272a' }],
    sizes: qty([['50', '50 bags', '50 شنطة', 0], ['100', '100 bags', '100 شنطة', 400], ['250', '250 bags', '250 شنطة', 1100]]),
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv('<path d="M205 170 Q205 90 250 90 Q295 90 295 170" fill="none" stroke="{{L}}" stroke-width="6"/>' + shadowRect(120, 160, 260, 380) + '<rect x="120" y="160" width="260" height="380" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'),
        printArea: { x: 150, y: 230, w: 200, h: 222 },
        printWidthIn: 7.5,
      },
    ],
  },
  {
    id: 'invoicebook',
    category: 'business',
    name: t('Invoice / Receipt Book', 'دفتر فواتير'),
    description: t('A5 carbonless books, 50 numbered sets each, with your logo and details printed on every page.', 'دفاتر A5 كربونية، كل دفتر 50 نسخة مرقّمة، بشعارك وبياناتك على كل ورقة.'),
    basePrice: 180,
    colors: [
      { id: 'two', name: t('2 copies (white + pink)', 'نسختين (أبيض + بمبي)'), hex: '#ffffff' },
      { id: 'three', name: t('3 copies (white + pink + yellow)', '3 نسخ (أبيض + بمبي + أصفر)'), hex: '#ffffff' },
    ],
    sizes: qty([['1', '1 book', 'دفتر واحد', 0], ['5', '5 books', '5 دفاتر', 600], ['10', '10 books', '10 دفاتر', 1250]]),
    sides: [{ id: 'front', name: t('Page', 'الصفحة'), svg: flat(140, 80, 220, 311), printArea: { x: 140, y: 80, w: 220, h: 311 }, printWidthIn: 5.83 }],
  },
  {
    id: 'idcards',
    category: 'business',
    name: t('Employee ID Cards', 'كارنيهات موظفين'),
    description: t('Glossy PVC cards (8.5 × 5.4 cm) with a lanyard, printed on one or both sides.', 'كارنيهات PVC لامعة (8.5 × 5.4 سم) مع شريط تعليق، طباعة وجه أو وجهين.'),
    basePrice: 60,
    extraSidePrice: 20,
    colors: [C.white],
    sizes: qty([['1', '1 card', 'كارنيه واحد', 0], ['10', '10 cards', '10 كارنيهات', 390], ['25', '25 cards', '25 كارنيه', 990]]),
    sides: [
      { id: 'front', name: FRONT, svg: flat(160, 130, 180, 285, 10), printArea: { x: 160, y: 130, w: 180, h: 285, rx: 10 }, printWidthIn: 2.13 },
      { id: 'back', name: BACK, svg: flat(160, 130, 180, 285, 10), printArea: { x: 160, y: 130, w: 180, h: 285, rx: 10 }, printWidthIn: 2.13 },
    ],
  },
  {
    id: 'certificates',
    category: 'business',
    name: t('Certificates', 'شهادات تقدير'),
    description: t('Certificates on thick 300 gsm card, landscape. For schools, courses, awards and staff. Upload a list to print every name.', 'شهادات على كارت 300 جرام سميك، بالعرض. للمدارس والكورسات والتكريم والموظفين. ارفع قائمة الأسماء ونطبع كل اسم على شهادته.'),
    basePrice: 45,
    colors: [C.white, C.cream],
    sizes: [
      { id: 'A4', label: t('A4 (29.7 × 21 cm)', 'A4 (29.7 × 21 سم)'), surcharge: 0 },
      { id: 'A3', label: t('A3 (42 × 29.7 cm)', 'A3 (42 × 29.7 سم)'), surcharge: 40 },
    ],
    sides: [{ id: 'front', name: FRONT, svg: flat(40, 155, 420, 297), printArea: { x: 40, y: 155, w: 420, h: 297 }, printWidthIn: 11.69 }],
  },
);

// ---------- Personalised children's books (see src/books.js) ----------
const BOOK_SVG = (cover) => sv(
  '<rect x="118" y="88" width="270" height="400" rx="8" fill="#000" opacity=".12"/>' +
    '<rect x="110" y="80" width="270" height="400" rx="8" fill="#ffffff" stroke="#c9ccd2" stroke-width="2"/>' +
    `<rect x="104" y="76" width="270" height="400" rx="8" fill="${cover}" stroke="{{L}}" stroke-width="3"/>` +
    '<rect x="104" y="76" width="18" height="400" fill="#000" opacity=".12"/>'
);
const BOOK_SIDE = (cover) => ({ id: 'book', name: t('Book', 'الكتاب'), svg: BOOK_SVG(cover), printArea: { x: 104, y: 76, w: 270, h: 270 }, printWidthIn: 8 });
PRODUCTS.push(
  {
    id: 'storybook',
    kind: 'book',
    book: 'space-hero',
    category: 'kids',
    name: t('Story Book: My Space Adventure', 'قصة باسم طفلك: مغامرة في الفضاء'),
    description: t('Your child is the hero: their face in every picture, their name, family and favourites in the story. 14 pages in English, 20 × 20 cm.', 'طفلك بطل الحكاية: وشه في كل صورة، واسمه وعيلته وحاجاته المفضلة في القصة. 14 صفحة باللغة الإنجليزية، 20 × 20 سم.'),
    basePrice: 650,
    colors: [{ id: 'std', name: t('Full colour', 'ألوان كاملة'), hex: '#1c2a55' }],
    sizes: [
      { id: 'soft', label: t('Softcover', 'غلاف عادي'), surcharge: 0 },
      { id: 'hard', label: t('Hardcover', 'غلاف مقوّى'), surcharge: 200 },
    ],
    sides: [BOOK_SIDE('#1c2a55')],
  },
  {
    id: 'coloringbook',
    kind: 'book',
    book: 'dream-jobs',
    category: 'kids',
    name: t('Colouring Book with My Photo', 'كتاب تلوين بصورة طفلك'),
    description: t("Your child's photo turned into drawings: 13 dream jobs to colour, from astronaut to chef. 17 pages in English, 20 × 20 cm.", 'صورة طفلك بتتحول لرسومات: 13 مهنة يحلم بيها يلوّنها، من رائد الفضاء للشيف. 17 صفحة باللغة الإنجليزية، 20 × 20 سم.'),
    basePrice: 300,
    colors: [{ id: 'std', name: t('Colour cover, line-art pages', 'غلاف ملون وصفحات للتلوين'), hex: '#ff8a3d' }],
    sizes: [
      { id: 'soft', label: t('Softcover', 'غلاف عادي'), surcharge: 0 },
      { id: 'hard', label: t('Hardcover', 'غلاف مقوّى'), surcharge: 150 },
    ],
    sides: [BOOK_SIDE('#ff8a3d')],
  },
);

// ---------- Photo prints: many photos in one order, ordered on the photos page ----------
// The customer picks photos, each is cropped to its size in the browser and sent as a
// print-ready JPEG at 300 DPI (border drawn in), with the copies of each. One cart item.
const PHOTO_SIZES = [
  { id: '10x15', cm: [10, 15], surcharge: 0 },
  { id: '13x18', cm: [13, 18], surcharge: 10 },
  { id: '15x20', cm: [15, 20], surcharge: 20 },
  { id: '20x30', cm: [20, 30], surcharge: 55 },
];
PRODUCTS.push({
  id: 'photoprints',
  kind: 'photoset',
  category: 'photos',
  name: t('Photo Prints', 'طباعة الصور'),
  description: t('Your photos printed on glossy or matte photo paper, from 10 × 15 to 20 × 30 cm. Pick many at once from your phone.', 'صورك مطبوعة على ورق فوتوغرافي لامع أو مطفي، من 10 × 15 لحد 20 × 30 سم. اختار صور كتير مرة واحدة من موبايلك.'),
  basePrice: 15,
  colorLabel: t('Paper', 'الورق'),
  colors: [
    { id: 'gloss', name: t('Glossy', 'لامع'), hex: '#ffffff' },
    { id: 'matte', name: t('Matte', 'مطفي'), hex: '#f4f4f2' },
  ],
  sizes: PHOTO_SIZES.map((z) => ({ id: z.id, label: t(`${z.cm[0]} × ${z.cm[1]} cm`, `${z.cm[0]} × ${z.cm[1]} سم`), surcharge: z.surcharge, cm: z.cm })),
  options: [{
    id: 'border',
    name: t('Border', 'الإطار'),
    choices: [
      { id: 'none', name: t('Borderless', 'بدون إطار'), price: 0 },
      { id: 'white', name: t('White border', 'إطار أبيض'), price: 0 },
    ],
  }],
  photo: { dpi: 300, borderMm: 4, maxPhotos: 100, maxCopies: 50, lowDpi: 150 },
  sides: [{
    id: 'front',
    name: t('Photos', 'الصور'),
    svg: sv(
      '<rect x="150" y="120" width="260" height="360" rx="4" fill="#000" opacity=".10" transform="rotate(8 280 300)"/>' +
        '<rect x="140" y="110" width="260" height="360" rx="4" fill="#ffffff" stroke="{{L}}" stroke-width="2" transform="rotate(8 270 290)"/>' +
        '<rect x="110" y="130" width="260" height="360" rx="4" fill="#ffffff" stroke="{{L}}" stroke-width="2"/>' +
        '<rect x="122" y="142" width="236" height="300" fill="#9fd3f4"/><path d="M122 442 L200 340 L260 400 L310 350 L358 410 L358 442 Z" fill="#5aa35a"/><circle cx="310" cy="200" r="26" fill="#ffd54a"/>'
    ),
    printArea: { x: 122, y: 142, w: 236, h: 300 },
    printWidthIn: 3.94,
  }],
});

// ---------- Canvas prints (gallery-wrapped on a 1.5 in wooden frame) ----------
// The print file includes a 1.75 in band round the front (the frame's depth
// plus the fold at the back). The edge style decides what goes on that band:
// the design itself (wrap), the design mirrored, or plain white / black. The
// editor and the shop make the band when they make the print file.
const CANVAS_EDGES = [
  { id: 'wrap', name: t('Image wrap: the design continues round the edges', 'لفّ الصورة: التصميم يكمّل على الجوانب'), hex: '#c4cad3' },
  { id: 'mirror', name: t('Mirror wrap: edges mirror the design (keeps the whole front)', 'جوانب معكوسة: الجوانب انعكاس للتصميم (الواجهة كاملة)'), hex: '#aeb6c2' },
  { id: 'white', name: t('White edges', 'جوانب بيضاء'), hex: '#f7f7f5' },
  { id: 'black', name: t('Black edges', 'جوانب سوداء'), hex: '#1d1d1f' },
];
const canvasSvg = (x, y, w, h) => {
  const d = 14;
  return sv(
    `<rect x="${x + 12}" y="${y + 18}" width="${w + d}" height="${h + d}" fill="#000" opacity=".13"/>` +
      `<polygon points="${x + w},${y} ${x + w + d},${y + d * 0.7} ${x + w + d},${y + h + d * 0.7} ${x + w},${y + h}" fill="{{C}}" stroke="{{L}}" stroke-width="1.5"/>` +
      `<polygon points="${x + w},${y} ${x + w + d},${y + d * 0.7} ${x + w + d},${y + h + d * 0.7} ${x + w},${y + h}" fill="#000" opacity=".16"/>` +
      `<polygon points="${x},${y + h} ${x + w},${y + h} ${x + w + d},${y + h + d * 0.7} ${x + d},${y + h + d * 0.7}" fill="{{C}}" stroke="{{L}}" stroke-width="1.5"/>` +
      `<polygon points="${x},${y + h} ${x + w},${y + h} ${x + w + d},${y + h + d * 0.7} ${x + d},${y + h + d * 0.7}" fill="#000" opacity=".26"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="{{S}}" stroke-width="1.5"/>`
  );
};
PRODUCTS.push(
  {
    id: 'canvas',
    category: 'home',
    name: t('Canvas Print (portrait)', 'لوحة كانفاس (طولية)'),
    description: t('Gallery-wrapped artist canvas on a 4 cm wooden frame, ready to hang.', 'قماش كانفاس مشدود على إطار خشب 4 سم، جاهز للتعليق.'),
    basePrice: 850,
    surface: '#ffffff',
    colors: CANVAS_EDGES,
    sizes: [
      { id: '30x45', label: t('30 × 45 cm', '30 × 45 سم'), surcharge: 0 },
      { id: '40x60', label: t('40 × 60 cm', '40 × 60 سم'), surcharge: 300 },
      { id: '60x90', label: t('60 × 90 cm', '60 × 90 سم'), surcharge: 900 },
    ],
    sides: [{ id: 'front', name: FRONT, svg: canvasSvg(118, 100, 264, 396), printArea: { x: 118, y: 100, w: 264, h: 396 }, printWidthIn: 11.81 }],
  },
  {
    id: 'canvaswide',
    category: 'home',
    name: t('Canvas Print (landscape)', 'لوحة كانفاس (عرضية)'),
    description: t('Gallery-wrapped artist canvas on a 4 cm wooden frame, ready to hang.', 'قماش كانفاس مشدود على إطار خشب 4 سم، جاهز للتعليق.'),
    basePrice: 850,
    surface: '#ffffff',
    colors: CANVAS_EDGES,
    sizes: [
      { id: '30x45', label: t('45 × 30 cm', '45 × 30 سم'), surcharge: 0 },
      { id: '40x60', label: t('60 × 40 cm', '60 × 40 سم'), surcharge: 300 },
      { id: '60x90', label: t('90 × 60 cm', '90 × 60 سم'), surcharge: 900 },
    ],
    sides: [{ id: 'front', name: FRONT, svg: canvasSvg(52, 160, 396, 264), printArea: { x: 52, y: 160, w: 396, h: 264 }, printWidthIn: 17.72 }],
  },
);

// ---------- Roll-to-roll fabric: patterns that repeat ----------
// The customer designs one tile (square). It repeats across the fabric in the
// chosen way (straight, half-drop, half-brick, mirror) at the chosen tile size
// (cm). The print house gets the seamless tile at 300 DPI plus the repeat, the
// fabric width and length (what step-and-repeat RIP software needs), and a
// picture of the repeated pattern to check it.
// pattern.scene: the product picture for the live preview; `fill` is where the
// pattern shows, `cm(size)` its real size, so tiles appear at true scale.
const REPEATS = ['straight', 'halfdrop', 'halfbrick', 'mirror'];
const TILE_SIDE = { id: 'front', name: t('Pattern tile', 'وحدة النقشة'), svg: '', printArea: { x: 90, y: 130, w: 320, h: 320 }, printWidthIn: 30 / 2.54 };
const tileSvg = () =>
  sv(
    '<rect x="98" y="140" width="320" height="320" fill="#000" opacity=".1"/>' +
      '<rect x="90" y="130" width="320" height="320" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>' +
      '<g fill="none" stroke="{{L}}" stroke-width="1.5" stroke-dasharray="4 5" opacity=".7"><rect x="30" y="70" width="440" height="440"/></g>'
  );
const rollScene = {
  svg: sv(
    '<rect x="66" y="112" width="380" height="462" fill="#000" opacity=".1"/>' +
      '<rect x="60" y="100" width="380" height="460" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>'
  ),
  overlay: sv(
    '<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs>' +
      '<rect x="44" y="66" width="412" height="40" rx="20" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>' +
      '<rect x="44" y="66" width="412" height="40" rx="20" fill="url(#r)"/>' +
      '<rect x="30" y="76" width="16" height="20" rx="4" fill="#8a8f98"/><rect x="454" y="76" width="16" height="20" rx="4" fill="#8a8f98"/>'
  ),
  fill: { x: 60, y: 100, w: 380, h: 460 },
};
const bedScene = (duvet) => ({
  svg: sv(
    '<rect x="50" y="48" width="400" height="130" rx="18" fill="#8b6a4f"/><rect x="50" y="48" width="400" height="130" rx="18" fill="#000" opacity=".08"/>' +
      '<rect x="62" y="150" width="376" height="420" rx="16" fill="#f3f1ec" stroke="#d6d2c8" stroke-width="2"/>' +
      (duvet ? '' : '<rect x="62" y="150" width="376" height="420" rx="16" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>') +
      (duvet ? '<rect x="56" y="300" width="388" height="276" rx="14" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>' : '')
  ),
  overlay: sv(
    '<g fill="#fbfaf7" stroke="#d9d5cc" stroke-width="2"><rect x="92" y="170" width="146" height="82" rx="26"/><rect x="262" y="170" width="146" height="82" rx="26"/></g>' +
      '<g fill="#000" opacity=".06"><rect x="92" y="226" width="146" height="26" rx="13"/><rect x="262" y="226" width="146" height="26" rx="13"/></g>' +
      (duvet ? '<rect x="56" y="300" width="388" height="26" rx="12" fill="#fff" opacity=".28"/><rect x="56" y="300" width="388" height="10" rx="5" fill="#000" opacity=".06"/>' : '<rect x="62" y="150" width="376" height="420" rx="16" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="10"/>')
  ),
  fill: duvet ? { x: 56, y: 300, w: 388, h: 276 } : { x: 62, y: 150, w: 376, h: 420 },
});
const curtainScene = {
  svg: sv(
    '<rect x="150" y="96" width="200" height="430" fill="#cfe3f5"/><rect x="150" y="96" width="200" height="430" fill="none" stroke="#9aa7b4" stroke-width="10"/>' +
      '<line x1="250" y1="96" x2="250" y2="526" stroke="#9aa7b4" stroke-width="6"/>' +
      '<rect x="40" y="80" width="420" height="490" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>'
  ),
  overlay: sv(
    // The window shows between the two panels; folds; the rod and rings.
    '<rect x="222" y="80" width="56" height="490" fill="#cfe3f5"/><line x1="250" y1="80" x2="250" y2="570" stroke="#9aa7b4" stroke-width="6"/>' +
      '<g fill="#000" opacity=".07"><rect x="70" y="80" width="18" height="490"/><rect x="128" y="80" width="18" height="490"/><rect x="186" y="80" width="18" height="490"/><rect x="300" y="80" width="18" height="490"/><rect x="358" y="80" width="18" height="490"/><rect x="416" y="80" width="18" height="490"/></g>' +
      '<g fill="#fff" opacity=".1"><rect x="96" y="80" width="14" height="490"/><rect x="154" y="80" width="14" height="490"/><rect x="326" y="80" width="14" height="490"/><rect x="384" y="80" width="14" height="490"/></g>' +
      '<rect x="20" y="64" width="460" height="12" rx="6" fill="#6b7078"/><g fill="#6b7078"><circle cx="60" cy="82" r="6"/><circle cx="120" cy="82" r="6"/><circle cx="180" cy="82" r="6"/><circle cx="320" cy="82" r="6"/><circle cx="380" cy="82" r="6"/><circle cx="440" cy="82" r="6"/></g>'
  ),
  fill: { x: 40, y: 80, w: 420, h: 490 },
};
const fabricSide = () => ({ ...TILE_SIDE, svg: tileSvg() });
const metres = (perMetre) => [1, 2, 3, 5, 10].map((m) => ({ id: `${m}m`, label: t(`${m} m`, `${m} متر`), surcharge: Math.round(perMetre * (m - 1)), cm: [145, m * 100] }));
PRODUCTS.push(
  {
    id: 'fabric',
    category: 'textiles',
    name: t('Printed Fabric by the Metre', 'قماش مطبوع بالمتر'),
    description: t('Your own pattern printed on fabric 145 cm wide, by the metre: for sewing, crafts, cushions and clothes.', 'نقشتك مطبوعة على قماش عرضه 145 سم، بالمتر: للخياطة والأشغال والمخدات والملابس.'),
    basePrice: 260,
    colors: [
      { id: 'poplin', name: t('Cotton poplin', 'قطن بوبلين'), hex: '#ffffff' },
      { id: 'canvas', name: t('Cotton canvas', 'قطن كانفاس'), hex: '#f6f2e9' },
      { id: 'satin', name: t('Polyester satin', 'ساتان بوليستر'), hex: '#fbfbfb' },
      { id: 'linen', name: t('Linen look', 'شبه الكتان'), hex: '#eee7da' },
    ],
    sizes: metres(260),
    sides: [fabricSide()],
    pattern: { tiles: [10, 20, 30, 45, 60], tile: 30, scene: rollScene },
  },
  {
    id: 'upholstery',
    category: 'textiles',
    name: t('Upholstery Fabric by the Metre', 'قماش تنجيد بالمتر'),
    description: t('Heavy, hard-wearing fabric 140 cm wide with your pattern: for sofas, chairs, headboards and cushions.', 'قماش تقيل ويستحمل، عرضه 140 سم، بنقشتك: للكنب والكراسي والأسرّة والمخدات.'),
    basePrice: 380,
    colors: [
      { id: 'canvas', name: t('Heavy canvas', 'كانفاس تقيل'), hex: '#f2ede3' },
      { id: 'velvet', name: t('Velvet', 'قطيفة'), hex: '#efebe6' },
      { id: 'linen', name: t('Linen look', 'شبه الكتان'), hex: '#ece5d8' },
    ],
    sizes: metres(380).map((z) => ({ ...z, cm: [140, z.cm[1]] })),
    sides: [fabricSide()],
    pattern: { tiles: [10, 20, 30, 45, 60], tile: 30, scene: rollScene },
  },
  {
    id: 'bedsheet',
    category: 'textiles',
    name: t('Printed Bed Sheet', 'ملاية سرير مطبوعة'),
    description: t('A soft flat sheet printed edge to edge with your pattern.', 'ملاية ناعمة مطبوعة بنقشتك من الطرف للطرف.'),
    basePrice: 650,
    colors: [
      { id: 'sateen', name: t('Cotton sateen', 'قطن ساتان'), hex: '#ffffff' },
      { id: 'micro', name: t('Microfibre', 'مايكروفايبر'), hex: '#fbfbfa' },
    ],
    sizes: [
      { id: 'single', label: t('Single · 160 × 260 cm', 'فردي · 160 × 260 سم'), surcharge: 0, cm: [160, 260] },
      { id: 'double', label: t('Double · 240 × 260 cm', 'مزدوج · 240 × 260 سم'), surcharge: 250, cm: [240, 260] },
      { id: 'king', label: t('King · 270 × 280 cm', 'كينج · 270 × 280 سم'), surcharge: 400, cm: [270, 280] },
    ],
    sides: [fabricSide()],
    pattern: { tiles: [20, 30, 45, 60], tile: 45, scene: bedScene(false) },
  },
  {
    id: 'duvetcover',
    category: 'textiles',
    name: t('Printed Duvet Cover', 'غطا لحاف مطبوع'),
    description: t('Duvet cover with your pattern on the front and plain white on the back, with a zip.', 'غطا لحاف بنقشتك على الوش وأبيض سادة من ورا، بسوستة.'),
    basePrice: 900,
    colors: [
      { id: 'sateen', name: t('Cotton sateen', 'قطن ساتان'), hex: '#ffffff' },
      { id: 'micro', name: t('Microfibre', 'مايكروفايبر'), hex: '#fbfbfa' },
    ],
    sizes: [
      { id: 'single', label: t('Single · 140 × 200 cm', 'فردي · 140 × 200 سم'), surcharge: 0, cm: [140, 200] },
      { id: 'double', label: t('Double · 200 × 200 cm', 'مزدوج · 200 × 200 سم'), surcharge: 350, cm: [200, 200] },
      { id: 'king', label: t('King · 220 × 240 cm', 'كينج · 220 × 240 سم'), surcharge: 550, cm: [220, 240] },
    ],
    sides: [fabricSide()],
    pattern: { tiles: [20, 30, 45, 60], tile: 45, scene: bedScene(true) },
  },
  {
    id: 'curtains',
    category: 'textiles',
    name: t('Printed Curtains (pair)', 'ستاير مطبوعة (جوز)'),
    description: t('Two curtain panels printed with your pattern, with a rod pocket and hooks tape.', 'ضلفتين ستارة مطبوعين بنقشتك، بجراب للماسورة وشريط خطاطيف.'),
    basePrice: 1400,
    colors: [
      { id: 'blackout', name: t('Blackout', 'بلاك أوت (معتم)'), hex: '#f4f1ea' },
      { id: 'filter', name: t('Light-filtering', 'نصف شفاف'), hex: '#fbfbf9' },
      { id: 'voile', name: t('Sheer voile', 'فوال شفاف'), hex: '#ffffff' },
    ],
    sizes: [
      { id: '140x250', label: t('2 panels · 140 × 250 cm each', 'ضلفتين · 140 × 250 سم للواحدة'), surcharge: 0, cm: [280, 250] },
      { id: '140x270', label: t('2 panels · 140 × 270 cm each', 'ضلفتين · 140 × 270 سم للواحدة'), surcharge: 150, cm: [280, 270] },
      { id: '200x270', label: t('2 panels · 200 × 270 cm each', 'ضلفتين · 200 × 270 سم للواحدة'), surcharge: 700, cm: [400, 270] },
    ],
    sides: [fabricSide()],
    pattern: { tiles: [20, 30, 45, 60], tile: 45, scene: curtainScene },
  },
);

// ---------- Laser engraving and cutting (CO2 laser) ----------
// The "colours" are materials. `ink` is how the design looks on that material:
// the engraved tone (dark burn on wood, frosted white on acrylic, light grey on
// slate) or, for cut pieces, the material itself. The editor draws every
// element in that one tone; the shop gets an engraving bitmap and cut lines.
//   laser.kind   'engrave' (on a blank or a board cut to `cut` shape) or 'cut' (the design's outline is cut)
//   laser.cut    board outline cut around an engraving: 'rounded' | 'arch' | null (ready-made blank)
//   laser.bridgeMm  cut pieces: text is thickened by this much so letters join into one piece
//   laser.pieces 'one' (warn when the cut falls apart) | 'many' (puzzle letters are meant to come out)
const WOOD = (id, en, ar, hex, ink) => ({ id, name: t(en, ar), hex, ink });
const GRAIN = (x, y, w, h) => `<g opacity=".09" stroke="#3b2412" stroke-width="2" fill="none">${[0.18, 0.37, 0.55, 0.74, 0.9].map((f, i) => `<path d="M${x} ${y + h * f} q${w * 0.25} ${i % 2 ? -9 : 9} ${w * 0.5} 0 t${w * 0.5} 0"/>`).join('')}</g>`;
const LASER_WOODS = [
  WOOD('natural', 'Natural wood', 'خشب طبيعي', '#d8b183', '#5a3416'),
  WOOD('walnut', 'Walnut', 'خشب جوزي', '#7a5232', '#2b170a'),
  WOOD('white', 'White painted wood', 'خشب أبيض', '#f2eee7', '#8a6544'),
];
PRODUCTS.push(
  {
    id: 'engrplaque',
    category: 'laser',
    name: t('Engraved Acrylic Plaque', 'بلاك أكريليك محفور'),
    description: t('Thin crystal-clear acrylic, laser engraved in frosted white, on a wooden stand. For weddings, graduation and thank-you gifts.', 'أكريليك شفاف ورفيع، محفور بالليزر بلون أبيض مطفي، على قاعدة خشب. للأفراح والتخرج والتكريم.'),
    basePrice: 400,
    colorLabel: t('Material', 'الخامة'),
    colors: [{ id: 'clear', name: t('Clear acrylic', 'أكريليك شفاف'), hex: '#b5c9cf', ink: '#f7fbfc' }],
    sizes: [
      { id: '13x18', label: t('13 × 18 cm', '13 × 18 سم'), surcharge: 0 },
      { id: '18x25', label: t('18 × 25 cm', '18 × 25 سم'), surcharge: 200 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv(shadowRect(140, 70, 220, 305, 6) + '<rect x="140" y="70" width="220" height="305" rx="6" fill="{{C}}" stroke="#93a9b0" stroke-width="3"/><path d="M150 80 L200 80 L150 170 Z" fill="#fff" opacity=".25"/><rect x="118" y="368" width="264" height="34" rx="4" fill="#b98d5e" stroke="#8a6440" stroke-width="2"/>'),
      printArea: { x: 140, y: 70, w: 220, h: 305, rx: 6 },
      printWidthIn: 13 / 2.54,
    }],
    cardArt: '<path d="M250 180 c-30 -40 -90 -10 -60 40 l60 55 l60 -55 c30 -50 -30 -80 -60 -40z" fill="none" stroke="{{I}}" stroke-width="6"/><rect x="180" y="290" width="140" height="7" rx="3.5" fill="{{I}}"/><rect x="205" y="312" width="90" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: 'rounded', radiusMm: 2 },
  },
  {
    id: 'engrcoasters',
    category: 'laser',
    name: t('Engraved Coasters', 'كوسترز محفورة'),
    description: t('Slate or wooden coasters, 10 × 10 cm, laser engraved with your names, logo or drawing. Sold in sets.', 'كوسترز إردواز أو خشب 10 × 10 سم، محفورة بالليزر بالأسماء أو اللوجو أو الرسمة. بتتباع طقم.'),
    basePrice: 380,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'slate', name: t('Slate stone', 'حجر إردواز'), hex: '#3a3e44', ink: '#c9cdd2' },
      WOOD('wood', 'Wood', 'خشب', '#d8b183', '#5a3416'),
    ],
    sizes: [
      { id: 'set4', label: t('Set of 4', 'طقم 4 قطع'), surcharge: 0 },
      { id: 'set6', label: t('Set of 6', 'طقم 6 قطع'), surcharge: 170 },
    ],
    sides: [{
      id: 'front',
      name: t('Top', 'الوجه'),
      svg: sv('<rect x="214" y="96" width="270" height="270" rx="16" fill="{{C}}" stroke="{{L}}" stroke-width="3" opacity=".55" transform="rotate(8 349 231)"/>' + shadowRect(100, 150, 300, 300, 18) + '<rect x="100" y="150" width="300" height="300" rx="18" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'),
      printArea: { x: 100, y: 150, w: 300, h: 300, rx: 18 },
      printWidthIn: 10 / 2.54,
    }],
    cardArt: '<circle cx="250" cy="280" r="70" fill="none" stroke="{{I}}" stroke-width="6"/><circle cx="250" cy="280" r="56" fill="none" stroke="{{I}}" stroke-width="2"/><path d="M250 272 c-16 -22 -50 -6 -33 22 l33 30 l33 -30 c16 -28 -16 -44 -33 -22z" fill="{{I}}"/><rect x="190" y="375" width="120" height="7" rx="3.5" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: null },
  },
  {
    id: 'engrtray',
    category: 'laser',
    name: t('Engraved Engagement Tray', 'صينية شبكة محفورة'),
    description: t('Wooden tray with handles for the shabka, engraved with the couple’s names and date.', 'صينية خشب بإيدين للشبكة، محفور عليها أسماء العروسين والتاريخ.'),
    basePrice: 850,
    colorLabel: t('Wood', 'الخشب'),
    colors: LASER_WOODS,
    sizes: [
      { id: '35x25', label: t('35 × 25 cm', '35 × 25 سم'), surcharge: 0 },
      { id: '45x32', label: t('45 × 32 cm', '45 × 32 سم'), surcharge: 350 },
    ],
    sides: [{
      id: 'front',
      name: t('Tray floor', 'أرضية الصينية'),
      svg: sv('<rect x="36" y="160" width="440" height="320" rx="20" fill="#000" opacity=".12"/><rect x="30" y="150" width="440" height="320" rx="20" fill="{{C}}" stroke="{{L}}" stroke-width="3"/><rect x="5" y="270" width="40" height="80" rx="18" fill="{{S}}" stroke="{{L}}" stroke-width="3"/><rect x="455" y="270" width="40" height="80" rx="18" fill="{{S}}" stroke="{{L}}" stroke-width="3"/><rect x="18" y="292" width="20" height="36" rx="9" fill="#fff" opacity=".8"/><rect x="462" y="292" width="20" height="36" rx="9" fill="#fff" opacity=".8"/><rect x="58" y="178" width="384" height="264" rx="10" fill="{{C}}" stroke="{{L}}" stroke-width="2" opacity=".96"/>' + GRAIN(58, 178, 384, 264)),
      printArea: { x: 85, y: 211, w: 330, h: 198 },
      printWidthIn: 25 / 2.54,
    }],
    cardArt: '<g fill="none" stroke="{{I}}" stroke-width="6"><circle cx="233.5" cy="275" r="30"/><circle cx="266.5" cy="275" r="30"/></g><rect x="165" y="330" width="170" height="7" rx="3.5" fill="{{I}}"/><rect x="195" y="352" width="110" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: null },
  },
  {
    id: 'engrframe',
    category: 'laser',
    name: t('Engraved Wooden Photo Frame', 'برواز خشب محفور'),
    description: t('Wooden frame with a wide bottom engraved with names, a date or a message. You put your photo in.', 'برواز خشب بحافة تحت عريضة محفور عليها أسماء أو تاريخ أو جملة. وانت بتحط صورتك.'),
    basePrice: 350,
    colorLabel: t('Wood', 'الخشب'),
    colors: LASER_WOODS,
    sizes: [
      { id: '13x18', label: t('For a 13 × 18 cm photo', 'لصورة 13 × 18 سم'), surcharge: 0 },
      { id: '20x25', label: t('For a 20 × 25 cm photo', 'لصورة 20 × 25 سم'), surcharge: 150 },
    ],
    sides: [{
      id: 'front',
      name: t('Bottom of the frame', 'حافة البرواز'),
      svg: sv(shadowRect(95, 40, 310, 500, 4) + '<rect x="95" y="40" width="310" height="500" rx="4" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' + GRAIN(95, 40, 310, 500) + '<rect x="135" y="80" width="230" height="300" fill="#e9ecef" stroke="{{L}}" stroke-width="2"/><path d="M150 360 L215 270 L260 325 L292 290 L350 360 Z" fill="#cfd4da"/><circle cx="305" cy="140" r="20" fill="#cfd4da"/>'),
      printArea: { x: 110, y: 400, w: 280, h: 120 },
      printWidthIn: 19 / 2.54,
    }],
    cardArt: '<path d="M250 428 c-14 -18 -40 -4 -27 18 l27 25 l27 -25 c14 -22 -14 -36 -27 -18z" fill="{{I}}"/><rect x="170" y="478" width="160" height="7" rx="3.5" fill="{{I}}"/><rect x="200" y="498" width="100" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: null },
  },
  {
    id: 'engrcardholder',
    category: 'laser',
    name: t('Engraved Leather Card Holder', 'حافظة كروت جلد محفورة'),
    description: t('Real leather card holder engraved with a name, initials or a logo. A neat gift for colleagues and clients.', 'حافظة كروت جلد طبيعي محفور عليها اسم أو حروف أو لوجو. هدية شيك للزملاء والعملاء.'),
    basePrice: 250,
    colorLabel: t('Leather', 'الجلد'),
    colors: [
      { id: 'black', name: t('Black', 'أسود'), hex: '#232124', ink: '#5b544f' },
      { id: 'brown', name: t('Brown', 'بني'), hex: '#7b4a2b', ink: '#3a1f10' },
      { id: 'tan', name: t('Tan', 'عسلي'), hex: '#b8834f', ink: '#5c3818' },
    ],
    sizes: [{ id: 'one', label: t('10 × 7 cm', '10 × 7 سم'), surcharge: 0 }],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv(shadowRect(60, 165, 380, 266, 22) + '<rect x="60" y="165" width="380" height="266" rx="22" fill="{{C}}" stroke="{{L}}" stroke-width="3"/><rect x="74" y="179" width="352" height="238" rx="14" fill="none" stroke="{{S}}" stroke-width="2.5" stroke-dasharray="7 6"/><path d="M60 225 Q250 255 440 225" fill="none" stroke="{{L}}" stroke-width="2" opacity=".6"/>'),
      printArea: { x: 130, y: 262, w: 240, h: 140 },
      printWidthIn: 6 / 2.54,
    }],
    cardArt: '<circle cx="250" cy="318" r="34" fill="none" stroke="{{I}}" stroke-width="5"/><path d="M250 314 c-9 -12 -27 -3 -18 12 l18 16 l18 -16 c9 -15 -9 -24 -18 -12z" fill="{{I}}"/><rect x="190" y="370" width="120" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: null },
  },
  {
    id: 'caketopper',
    category: 'laser',
    name: t('Cake Topper with a Name', 'توبر تورتة بالاسم'),
    description: t('A name or a wish laser cut from mirror acrylic or wood, with a stick to push into the cake.', 'اسم أو جملة مقصوصة بالليزر من أكريليك مراية أو خشب، بعصاية تتغرس في التورتة.'),
    basePrice: 180,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'gold', name: t('Gold mirror acrylic', 'أكريليك مراية دهبي'), hex: '#d4af37', ink: '#d4af37' },
      { id: 'silver', name: t('Silver mirror acrylic', 'أكريليك مراية فضي'), hex: '#bfc4ca', ink: '#aeb4bb' },
      { id: 'rosegold', name: t('Rose gold mirror acrylic', 'أكريليك مراية روز جولد'), hex: '#d8a08c', ink: '#cf8f7a' },
      { id: 'black', name: t('Black acrylic', 'أكريليك أسود'), hex: '#1f1f22', ink: '#1f1f22' },
      { id: 'white', name: t('White acrylic', 'أكريليك أبيض'), hex: '#f7f7f5', ink: '#ffffff' },
      WOOD('wood', 'Wood', 'خشب', '#d8b183', '#c99a66'),
    ],
    sizes: [
      { id: '15', label: t('15 cm wide', 'عرض 15 سم'), surcharge: 0 },
      { id: '20', label: t('20 cm wide', 'عرض 20 سم'), surcharge: 60 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv('<ellipse cx="250" cy="560" rx="200" ry="22" fill="#000" opacity=".1"/><path d="M70 440 L70 545 Q250 580 430 545 L430 440 Z" fill="#f4d9e1" stroke="#d9a7b6" stroke-width="3"/><ellipse cx="250" cy="440" rx="180" ry="34" fill="#fbeaf0" stroke="#d9a7b6" stroke-width="3"/><path d="M70 470 q30 22 60 0 t60 0 t60 0 t60 0 t60 0 t60 0" fill="none" stroke="#e8b9c7" stroke-width="8" stroke-linecap="round"/>'),
      printArea: { x: 70, y: 150, w: 360, h: 288 },
      printWidthIn: 15 / 2.54,
    }],
    cardArt: '<rect x="214" y="300" width="9" height="150" rx="4" fill="{{I}}"/><rect x="277" y="300" width="9" height="150" rx="4" fill="{{I}}"/><path d="M250 215 c-40 -54 -122 -14 -81 54 l81 74 l81 -74 c40 -68 -40 -108 -81 -54z" fill="{{I}}"/><rect x="150" y="300" width="200" height="14" rx="7.0" fill="{{I}}"/>',
    laser: { kind: 'cut', bridgeMm: 2.5, pieces: 'one' },
  },
  {
    id: 'weddingsign',
    category: 'laser',
    name: t('Engraved Wedding Welcome Sign', 'لوحة ترحيب للفرح محفورة'),
    description: t('An arch-shaped welcome sign cut and engraved in acrylic or wood, with an easel. For weddings, engagements and katb kitab.', 'لوحة ترحيب على شكل قوس مقصوصة ومحفورة في أكريليك أو خشب، ومعاها حامل. للفرح والخطوبة وكتب الكتاب.'),
    basePrice: 900,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'clear', name: t('Clear acrylic', 'أكريليك شفاف'), hex: '#b5c9cf', ink: '#f7fbfc' },
      { id: 'black', name: t('Black acrylic', 'أكريليك أسود'), hex: '#232326', ink: '#e4e4e4' },
      WOOD('wood', 'Wood', 'خشب', '#d8b183', '#4a2a12'),
    ],
    sizes: [
      { id: '40x60', label: t('40 × 60 cm', '40 × 60 سم'), surcharge: 0 },
      { id: '50x75', label: t('50 × 75 cm', '50 × 75 سم'), surcharge: 300 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv('<path d="M200 410 L165 580 M300 410 L335 580 M250 410 L250 565" stroke="#b08a5c" stroke-width="10" stroke-linecap="round"/><path d="M130 410 L130 170 A120 120 0 0 1 370 170 L370 410 Z" fill="#000" opacity=".12" transform="translate(6 8)"/><path d="M130 410 L130 170 A120 120 0 0 1 370 170 L370 410 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'),
      printArea: { x: 130, y: 50, w: 240, h: 360, shape: 'arch' },
      printWidthIn: 40 / 2.54,
    }],
    cardArt: '<g fill="none" stroke="{{I}}" stroke-width="6"><circle cx="233.5" cy="175" r="30"/><circle cx="266.5" cy="175" r="30"/></g><rect x="170" y="240" width="160" height="7" rx="3.5" fill="{{I}}"/><rect x="190" y="262" width="120" height="6" rx="3.0" fill="{{I}}"/><rect x="160" y="300" width="180" height="10" rx="5.0" fill="{{I}}"/><rect x="200" y="330" width="100" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: 'arch' },
  },
  {
    id: 'doorsign',
    category: 'laser',
    name: t('Door Name Sign', 'يافطة اسم للباب'),
    description: t('A family or room name engraved on wood or acrylic, cut with rounded corners and ready to hang.', 'اسم العيلة أو الأوضة محفور على خشب أو أكريليك، مقصوص بحواف مدورة وجاهز للتعليق.'),
    basePrice: 350,
    colorLabel: t('Material', 'الخامة'),
    colors: [...LASER_WOODS, { id: 'black', name: t('Black acrylic', 'أكريليك أسود'), hex: '#232326', ink: '#e4e4e4' }],
    sizes: [
      { id: '30x15', label: t('30 × 15 cm', '30 × 15 سم'), surcharge: 0 },
      { id: '40x20', label: t('40 × 20 cm', '40 × 20 سم'), surcharge: 150 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv('<rect x="0" y="0" width="500" height="600" fill="#e7e2da"/><rect x="40" y="0" width="420" height="600" fill="#cdbfae"/><circle cx="420" cy="380" r="12" fill="#9c8f80"/>' + shadowRect(70, 200, 360, 180, 18) + '<rect x="70" y="200" width="360" height="180" rx="18" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' + GRAIN(70, 200, 360, 180)),
      printArea: { x: 70, y: 200, w: 360, h: 180, rx: 18 },
      printWidthIn: 30 / 2.54,
    }],
    cardArt: '<path d="M250 232 l34 28 v34 h-68 v-34z" fill="none" stroke="{{I}}" stroke-width="6" stroke-linejoin="round"/><rect x="150" y="310" width="200" height="10" rx="5.0" fill="{{I}}"/><rect x="190" y="334" width="120" height="6" rx="3.0" fill="{{I}}"/>',
    laser: { kind: 'engrave', cut: 'rounded', radiusMm: 8 },
  },
  {
    id: 'ramadandecor',
    category: 'laser',
    name: t('Ramadan Decoration with a Name', 'زينة رمضان بالاسم'),
    description: t('A crescent, lantern or star with your family name, laser cut from wood or mirror acrylic, ready to hang.', 'هلال أو فانوس أو نجمة باسم العيلة، مقصوصة بالليزر من خشب أو أكريليك مراية، وجاهزة للتعليق.'),
    basePrice: 220,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'gold', name: t('Gold mirror acrylic', 'أكريليك مراية دهبي'), hex: '#d4af37', ink: '#d4af37' },
      WOOD('wood', 'Wood', 'خشب', '#d8b183', '#c99a66'),
      { id: 'white', name: t('White acrylic', 'أكريليك أبيض'), hex: '#f7f7f5', ink: '#ffffff' },
    ],
    sizes: [
      { id: '25', label: t('25 cm', '25 سم'), surcharge: 0 },
      { id: '35', label: t('35 cm', '35 سم'), surcharge: 120 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv('<path d="M250 0 L250 110" stroke="#8d8d8d" stroke-width="2"/><circle cx="250" cy="112" r="5" fill="none" stroke="#8d8d8d" stroke-width="2"/>'),
      printArea: { x: 90, y: 120, w: 320, h: 320 },
      printWidthIn: 25 / 2.54,
    }],
    cardArt: '<path d="M268 150 A110 110 0 1 0 268 410 A135 135 0 0 1 268 150 Z" fill="{{I}}"/><polygon points="322,338 330,361 354,361 335,376 342,400 322,386 302,400 309,376 290,361 314,361" fill="{{I}}"/><rect x="318" y="372" width="8" height="34" fill="{{I}}"/><rect x="200" y="400" width="150" height="16" rx="8" fill="{{I}}"/>',
    laser: { kind: 'cut', bridgeMm: 2.5, pieces: 'one' },
  },
  {
    id: 'namepuzzle',
    category: 'laser',
    name: t('Kids’ Wooden Name Puzzle', 'بازل خشب باسم الطفل'),
    description: t('Your child’s name cut as chunky wooden letters that lift out of a board. Fun for learning letters.', 'اسم طفلك مقصوص حروف خشب تخينة بتطلع من لوحة. بيلعب وبيتعلم الحروف.'),
    basePrice: 300,
    colorLabel: t('Letters', 'الحروف'),
    colors: [
      { id: 'natural', name: t('Natural wood', 'خشب طبيعي'), hex: '#dcb98c', ink: '#a8784a' },
      { id: 'pink', name: t('Pink letters', 'حروف بينك'), hex: '#dcb98c', ink: '#e64980' },
      { id: 'blue', name: t('Blue letters', 'حروف زرقا'), hex: '#dcb98c', ink: '#1c7ed6' },
      { id: 'rainbow', name: t('Colourful letters', 'حروف ملونة'), hex: '#dcb98c', ink: '#f08c00' },
    ],
    sizes: [
      { id: '30x10', label: t('30 × 10 cm (up to 6 letters)', '30 × 10 سم (لحد 6 حروف)'), surcharge: 0 },
      { id: '45x15', label: t('45 × 15 cm (up to 10 letters)', '45 × 15 سم (لحد 10 حروف)'), surcharge: 150 },
    ],
    sides: [{
      id: 'front',
      name: FRONT,
      svg: sv(shadowRect(45, 225, 410, 150, 12) + '<rect x="45" y="225" width="410" height="150" rx="12" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>' + GRAIN(45, 225, 410, 150)),
      printArea: { x: 55, y: 235, w: 390, h: 130 },
      printWidthIn: 30 / 2.54,
    }],
    cardArt: '<g fill="{{I}}" stroke="#000" stroke-opacity=".18" stroke-width="2"><rect x="90" y="262" width="62" height="76" rx="14"/><circle cx="208" cy="300" r="38"/><path d="M262 338 L297 262 L332 338 Z" stroke-linejoin="round"/><rect x="352" y="262" width="58" height="76" rx="29"/></g>',
    laser: { kind: 'cut', bridgeMm: 0, pieces: 'many', board: true },
  },
);
const LASER_IDS = ['engrplaque', 'engrcoasters', 'engrtray', 'engrframe', 'engrcardholder', 'caketopper', 'weddingsign', 'doorsign', 'ramadandecor', 'namepuzzle'];

// ---------- Cards, business print, packaging, calendars and events ----------
// Each printArea has exactly the proportions of the real printed piece (its trim
// size); printWidthIn is that width. Sizes that are bigger prints get a printScale
// (SIZE_PRINT_SCALE below). `cardArt` is a sample design drawn on the shop's card
// picture (these products have no studio photo yet), with the top layer included.
const cmIn = (v) => Math.round((v / 2.54) * 10000) / 10000;
const r1 = (v) => Math.round(v * 10) / 10;
const svgInner = (s) => String(s || '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const paperRect = (a, stroke = 3) => `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.rx || 0}" fill="{{C}}" stroke="{{L}}" stroke-width="${stroke}"/>`;
/** A card of a pack with another one turned a little behind it. */
const cardPack = (a, deg) => {
  const turn = `transform="rotate(${deg} ${a.x + a.w / 2} ${a.y + a.h / 2})"`;
  return sv(
    `<g ${turn}><rect x="${a.x + 6}" y="${a.y + 8}" width="${a.w}" height="${a.h}" rx="${a.rx || 0}" fill="#000" opacity=".07"/>` +
      `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.rx || 0}" fill="{{S}}" stroke="{{L}}" stroke-width="2"/></g>` +
      shadowRect(a.x, a.y, a.w, a.h, a.rx || 0) + paperRect(a)
  );
};
/** Sample artwork for card pictures: a tinted background, a motif and two lines of "text". */
const sampleArt = (a, { bg = '#fde7dc', accent = '#ff5a36', ink = '#2b2d42', motif = 'circle' } = {}) => {
  const u = Math.min(a.w, a.h);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h * 0.4;
  const s = u * 0.17;
  const shape = motif === 'heart'
    ? `<path d="M${r1(cx)} ${r1(cy + s)} C${r1(cx - s * 1.6)} ${r1(cy - s * 0.2)} ${r1(cx - s * 0.9)} ${r1(cy - s * 1.4)} ${r1(cx)} ${r1(cy - s * 0.5)} C${r1(cx + s * 0.9)} ${r1(cy - s * 1.4)} ${r1(cx + s * 1.6)} ${r1(cy - s * 0.2)} ${r1(cx)} ${r1(cy + s)} Z" fill="${accent}"/>`
    : `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(s)}" fill="${accent}"/>`;
  return `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.rx || 0}" fill="${bg}"/>` + shape +
    `<rect x="${r1(cx - a.w * 0.3)}" y="${r1(a.y + a.h * 0.66)}" width="${r1(a.w * 0.6)}" height="${r1(u * 0.07)}" rx="${r1(u * 0.035)}" fill="${ink}"/>` +
    `<rect x="${r1(cx - a.w * 0.2)}" y="${r1(a.y + a.h * 0.66 + u * 0.12)}" width="${r1(a.w * 0.4)}" height="${r1(u * 0.045)}" rx="${r1(u * 0.022)}" fill="${ink}" opacity=".55"/>`;
};
/** A sample photo (sky, sun and hills) filling a box. */
const photoArt = (a) =>
  `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.rx || 0}" fill="#9fd3f4"/>` +
  `<circle cx="${r1(a.x + a.w * 0.72)}" cy="${r1(a.y + a.h * 0.28)}" r="${r1(Math.min(a.w, a.h) * 0.12)}" fill="#ffd54a"/>` +
  `<path d="M${a.x} ${a.y + a.h} L${a.x} ${r1(a.y + a.h * 0.72)} L${r1(a.x + a.w * 0.32)} ${r1(a.y + a.h * 0.46)} L${r1(a.x + a.w * 0.55)} ${r1(a.y + a.h * 0.66)} L${r1(a.x + a.w * 0.75)} ${r1(a.y + a.h * 0.52)} L${a.x + a.w} ${r1(a.y + a.h * 0.7)} L${a.x + a.w} ${a.y + a.h} Z" fill="#5aa35a"/>`;
/** A month page: a coloured title bar and a 7 × 5 grid of day numbers (Fridays in red). */
const monthGrid = (x, y, w, h, bar) => {
  const cw = w / 7;
  const top = y + h * 0.2;
  const rh = (h * 0.78) / 5;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${r1(h * 0.14)}" fill="${bar}"/><rect x="${r1(x + w * 0.35)}" y="${r1(y + h * 0.045)}" width="${r1(w * 0.3)}" height="${r1(h * 0.05)}" rx="2" fill="#ffffff" opacity=".9"/>`;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      if (r === 4 && c > 2) continue;
      s += `<rect x="${r1(x + c * cw + cw * 0.3)}" y="${r1(top + r * rh + rh * 0.3)}" width="${r1(cw * 0.4)}" height="${r1(Math.max(3, rh * 0.25))}" rx="1" fill="${c === 6 ? bar : '#868e96'}"/>`;
    }
  }
  for (let r = 1; r < 5; r++) s += `<path d="M${x + 4} ${r1(top + r * rh)} H${x + w - 4}" stroke="#e1e4e8" stroke-width="1"/>`;
  return s;
};

// Postcards: 10 × 15 cm.
const POSTCARD = { x: 140, y: 90, w: 220, h: 330, rx: 3 };
// Folded cards: A5 folded to A6 (10.5 × 14.8 cm), printed on the cover and the inside right-hand page
// (the server's side ids are front / back). The cover stands up; the inside is shown open.
const FOLD_A6 = { x: 140, y: 100, w: 220, h: 310 };
const FOLD_IN = { x: 250, y: 150, w: 210, h: 296 };
const ENVELOPE_BEHIND = '<g transform="rotate(-8 200 390)"><rect x="76" y="308" width="260" height="180" rx="3" fill="#000" opacity=".07"/><rect x="70" y="300" width="260" height="180" rx="3" fill="#ffffff" stroke="#c9ccd2" stroke-width="2"/><path d="M70 300 L200 392 L330 300" fill="none" stroke="#c9ccd2" stroke-width="2"/></g>';
const FOLDED_COVER = sv(
  ENVELOPE_BEHIND +
    // The back half, opened a little behind the cover; the fold is the cover's left edge.
    '<path d="M360 100 L396 118 L396 428 L360 410 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>' +
    shadowRect(FOLD_A6.x, FOLD_A6.y, FOLD_A6.w, FOLD_A6.h) + paperRect(FOLD_A6) +
    '<path d="M141.5 101 V409" stroke="{{S}}" stroke-width="3"/>'
);
// Gift vouchers: 21 × 10 cm.
const VOUCHER = { x: 40, y: 200, w: 420, h: 200, rx: 4 };
// Bookmarks: 5 × 15 cm, with a punched hole and a tassel.
const BOOKMARK = { x: 180, y: 100, w: 140, h: 420, rx: 4 };
const BOOKMARK_TASSEL = sv(
  '<circle cx="250" cy="122" r="7" fill="#ffffff" stroke="{{L}}" stroke-width="2"/>' +
    '<path d="M250 116 C250 62 168 64 160 132" fill="none" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="160" cy="136" r="7" fill="#b8901c"/>' +
    '<path d="M154 142 L146 204 M158 142 L154 208 M162 142 L162 210 M166 142 L170 208 M170 141 L178 203" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="150" y="146" width="20" height="7" rx="3" fill="#a8820f"/>'
);
// Tri-fold brochures: A4 landscape (29.7 × 21 cm) folded in three, outside and inside.
const TRIFOLD = { x: 40, y: 150, w: 420, h: 297 };
const TRIFOLD_SVG = sv(
  shadowRect(TRIFOLD.x, TRIFOLD.y, TRIFOLD.w, TRIFOLD.h) + paperRect(TRIFOLD) +
    // The brochure folded up, below the open sheet.
    '<path d="M180 494 L230 504 L230 584 L180 574 Z" fill="{{C}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M230 504 L280 494 L280 574 L230 584 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M280 494 L330 504 L330 584 L280 574 Z" fill="{{C}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>'
);
// Outside: ready designs on the front cover, the right-hand third (the left-hand one for Arabic brochures).
const TRIFOLD_COVER = { readyZone: { x: 2 / 3, y: 0, w: 1 / 3, h: 1 }, readyZoneRtl: { x: 0, y: 0, w: 1 / 3, h: 1 } };
const TRIFOLD_FOLDS = sv(
  '<path d="M180 150 V447 M320 150 V447" stroke="#7d838c" stroke-width="1.5" stroke-dasharray="7 6" opacity=".8"/>' +
    '<path d="M180 138 V146 M320 138 V146 M180 451 V459 M320 451 V459" stroke="#7d838c" stroke-width="2"/>'
);
// Menus: A4 (21 × 29.7 cm); A3 prints at 1.414×.
const MENU = { x: 110, y: 80, w: 280, h: 396, rx: 6 };
const CUTLERY =
  '<rect x="60" y="290" width="12" height="190" rx="6" fill="#c3c7cd"/><path d="M50 160 V230 Q50 262 66 266 Q82 262 82 230 V160" fill="none" stroke="#c3c7cd" stroke-width="6" stroke-linecap="round"/><path d="M61 160 V226 M71 160 V226" stroke="#c3c7cd" stroke-width="5" stroke-linecap="round"/>' +
  '<rect x="430" y="300" width="12" height="180" rx="6" fill="#c3c7cd"/><path d="M430 304 V170 Q456 196 454 300 Z" fill="#d5d8dd" stroke="#c3c7cd" stroke-width="3" stroke-linejoin="round"/>';
const menuSvg = (deg) => sv(CUTLERY + svgInner(cardPack(MENU, deg)));
// Notepads: A5 (14.8 × 21 cm) pads; A6 prints at 0.709×. Glued at the top, a card back under the sheets.
const NOTEPAD = { x: 139, y: 120, w: 222, h: 315 };
const NOTEPAD_SVG = sv(
  '<rect x="149" y="130" width="222" height="315" fill="#000" opacity=".12"/>' +
    '<rect x="146" y="127" width="222" height="315" fill="#b9a27f" stroke="#8f7a59" stroke-width="2"/>' +
    '<rect x="143" y="124" width="222" height="315" fill="#ffffff" stroke="#c9ccd2" stroke-width="1.5"/>' +
    '<rect x="141" y="122" width="222" height="315" fill="#ffffff" stroke="#c9ccd2" stroke-width="1.5"/>' +
    paperRect(NOTEPAD, 2.5) +
    '<rect x="136" y="107" width="235" height="14" rx="3" fill="#3a3d44"/>' +
    '<g transform="rotate(16 425 300)"><rect x="418" y="160" width="14" height="250" rx="4" fill="#2f5d9e"/><rect x="418" y="160" width="14" height="34" rx="4" fill="#20407a"/><path d="M418 410 L425 438 L432 410 Z" fill="#e9d3a8"/><path d="M423 430 L425 438 L427 430 Z" fill="#333"/></g>'
);
// Presentation folders: the outside printed flat, 44 × 31 cm (back | front, each 22 × 31 cm, holds A4).
const FOLDER = { x: 30, y: 140, w: 440, h: 310 };
const FOLDER_SVG = sv(
  // The pocket flap (inside, unprinted) below the front half, with a business-card slot.
  '<path d="M258 446 L466 446 L466 496 Q466 512 450 512 L300 512 Q262 512 258 482 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M370 480 L384 470 L428 470 L442 480" fill="none" stroke="{{L}}" stroke-width="1.5"/>' +
    shadowRect(FOLDER.x, FOLDER.y, FOLDER.w, FOLDER.h) + paperRect(FOLDER)
);
// Ready designs on the front: the right half (the left half for Arabic folders, which open the other way).
const FOLDER_ZONES = { readyZone: { x: 0.5, y: 0, w: 0.5, h: 1 }, readyZoneRtl: { x: 0, y: 0, w: 0.5, h: 1 } };
const FOLDER_SPINE = sv('<path d="M246 140 V450 M254 140 V450" stroke="#7d838c" stroke-width="1.5" stroke-dasharray="7 6" opacity=".8"/>');
// Booklets: A5 (14.8 × 21 cm), stapled on the spine.
const BOOKLET = { x: 139, y: 100, w: 222, h: 315 };
const bookletSvg = (front) => sv(
  `<rect x="${front ? 146 : 132}" y="109" width="222" height="315" fill="#000" opacity=".12"/>` +
    `<rect x="${front ? 143 : 135}" y="104" width="222" height="315" fill="#f3efe6" stroke="#cfc8b8" stroke-width="1.5"/>` +
    paperRect(BOOKLET)
);
const bookletSpine = (front) => {
  const x = front ? 139 : 355;
  return sv(
    `<rect x="${x}" y="100" width="6" height="315" fill="#000" opacity=".08"/>` +
      `<rect x="${x - 1}" y="172" width="8" height="30" rx="2" fill="#b4b8bf" stroke="#6b7079" stroke-width="1"/>` +
      `<rect x="${x - 1}" y="313" width="8" height="30" rx="2" fill="#b4b8bf" stroke="#6b7079" stroke-width="1"/>`
  );
};
// Product labels: 5 × 3 cm (7.5 × 4.5 and 10 × 6 cm print at 1.5× and 2×), on their backing sheet.
const LABEL = { x: 50, y: 180, w: 400, h: 240, rx: 12 };
const LABEL_SVG = sv(
  '<rect x="36" y="168" width="440" height="280" rx="8" fill="#000" opacity=".1"/>' +
    '<rect x="30" y="160" width="440" height="280" rx="8" fill="#eef0f2" stroke="#c9ccd2" stroke-width="2"/>' +
    paperRect(LABEL, 2.5) +
    // A jar wearing one.
    '<rect x="198" y="470" width="104" height="18" rx="5" fill="#8a6a46"/><rect x="205" y="486" width="90" height="100" rx="14" fill="#efe1c4" stroke="#bfae8c" stroke-width="2"/>' +
    '<rect x="215" y="512" width="70" height="42" rx="4" fill="{{C}}" stroke="{{L}}" stroke-width="1.5"/>'
);
// Window stickers: square, 20 × 20 cm (30, 50, 70 cm print bigger), on a shop window.
const WINDOW_STICKER = { x: 100, y: 150, w: 300, h: 300, rx: 6 };
const WINDOW_SVG = sv(
  '<rect x="20" y="20" width="460" height="560" rx="6" fill="#9aa3ad"/><rect x="36" y="36" width="428" height="528" fill="#cfe1ec"/>' +
    '<rect x="36" y="470" width="428" height="94" fill="#b3c8d6" opacity=".7"/>' +
    `<rect x="${WINDOW_STICKER.x}" y="${WINDOW_STICKER.y}" width="300" height="300" rx="6" fill="{{C}}" stroke="{{L}}" stroke-width="2" stroke-dasharray="8 5"/>`
);
const WINDOW_SHINE = sv('<path d="M64 36 L156 36 L36 268 L36 92 Z" fill="#ffffff" opacity=".24"/><path d="M318 36 L352 36 L118 564 L84 564 Z" fill="#ffffff" opacity=".12"/>');
// Wall calendar: the whole A3 card (29.7 × 42 cm) is printed; a pad of 12 month sheets is stapled on its lower half.
const WALL_CAL = { x: 105, y: 40, w: 290, h: 410.1 };
// printArea.readyZone: where ready designs and templates are placed, in fractions of the print area
// (readyZoneRtl for Arabic-led designs, when that differs). The customer still prints on the whole area.
// Wall calendar: the top half, above the month pad (its staples are at 51% of the height).
const WALL_CAL_ZONE = { x: 0, y: 0, w: 1, h: 0.49 };
const WALL_CAL_SVG = sv(
  '<path d="M150 36 L250 9 L350 36" fill="none" stroke="#7b8088" stroke-width="2.5"/><circle cx="250" cy="9" r="5" fill="#5f656d"/>' +
    shadowRect(WALL_CAL.x, WALL_CAL.y, WALL_CAL.w, WALL_CAL.h) + paperRect(WALL_CAL, 2.5)
);
const WALL_CAL_PAD = sv(
  '<rect x="101" y="33" width="298" height="11" rx="3" fill="#b4b9c0" stroke="#7b8088" stroke-width="1.5"/>' +
    '<rect x="131" y="256" width="244" height="184" fill="#000" opacity=".12"/>' +
    '<rect x="128" y="253" width="244" height="184" fill="#e9eaec" stroke="#c9ccd2" stroke-width="1"/>' +
    '<rect x="128" y="250" width="244" height="184" fill="#ffffff" stroke="#c9ccd2" stroke-width="1.5"/>' +
    monthGrid(128, 250, 244, 184, '#d9480f') +
    '<rect x="166" y="245" width="16" height="5" rx="1.5" fill="#8d939b"/><rect x="318" y="245" width="16" height="5" rx="1.5" fill="#8d939b"/>'
);
// Desk calendar (tent): A5 landscape sheets (21 × 14.8 cm), your design on the left half (A6) of every sheet,
// the month on the right half; wire-bound on a card stand.
const DESK_CAL = { x: 40, y: 140, w: 210, h: 296 };
const DESK_CAL_SVG = sv(
  '<path d="M26 470 L474 470 L494 488 L6 488 Z" fill="#000" opacity=".08"/>' +
    '<polygon points="460,140 494,470 460,470" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>' +
    '<rect x="34" y="436" width="432" height="34" rx="3" fill="#2f3237"/>' +
    '<rect x="40" y="144" width="420" height="296" fill="#e9eaec" stroke="#c9ccd2" stroke-width="1"/>' +
    '<rect x="40" y="140" width="420" height="296" fill="{{C}}" stroke="{{L}}" stroke-width="2.5"/>' +
    '<rect x="252" y="140" width="208" height="296" fill="#ffffff"/>' +
    monthGrid(262, 156, 188, 266, '#1c7ed6') +
    '<rect x="40" y="140" width="420" height="296" fill="none" stroke="{{L}}" stroke-width="2.5"/>'
);
const DESK_CAL_RINGS = sv(Array.from({ length: 25 }, (_, i) => `<path d="M${54 + i * 16} 150 V133 a4 4 0 0 1 8 0 V150" fill="none" stroke="#50555c" stroke-width="2.5"/>`).join(''));
// Photo album: hardcover with slip-in pockets, cover 20 × 25 cm (24 × 30 cm prints at 1.2×).
const ALBUM = { x: 120, y: 70, w: 280, h: 350 };
const ALBUM_SVG = sv(
  '<rect x="128" y="80" width="290" height="350" rx="6" fill="#000" opacity=".12"/>' +
    '<rect x="122" y="75" width="284" height="350" rx="5" fill="#f3efe6" stroke="#cfc8b8" stroke-width="1.5"/>' +
    '<rect x="108" y="70" width="20" height="350" rx="4" fill="#3b3f46"/>' +
    '<rect x="120" y="70" width="280" height="350" rx="4" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>'
);
const ALBUM_HINGE = sv('<path d="M135 72 V418" stroke="#000" stroke-width="2.5" opacity=".13"/>');
// Fridge magnets: 6 × 9 cm (8 × 12 and 10 × 15 cm print bigger), on a fridge door.
const MAGNET = { x: 130, y: 120, w: 240, h: 360, rx: 14 };
const MAGNET_SVG = sv(
  '<rect x="0" y="0" width="500" height="600" fill="#eef1f4"/><rect x="474" y="0" width="26" height="600" fill="#dfe3e8"/>' +
    '<rect x="450" y="170" width="14" height="260" rx="7" fill="#c3c8cf" stroke="#a7adb5" stroke-width="1.5"/>' +
    '<rect x="139" y="132" width="240" height="360" rx="14" fill="#000" opacity=".06"/><rect x="135" y="127" width="240" height="360" rx="14" fill="#000" opacity=".1"/>' +
    paperRect(MAGNET, 2)
);
// Vinyl banners: 100 × 50 cm (150 × 75 and 200 × 100 cm print bigger), hemmed, with eyelets and ropes.
const BANNER = { x: 30, y: 190, w: 440, h: 220 };
const BANNER_EYELETS = [[41, 201], [145.5, 201], [250, 201], [354.5, 201], [459, 201], [41, 399], [145.5, 399], [250, 399], [354.5, 399], [459, 399], [41, 300], [459, 300]];
const BANNER_SVG = sv(
  '<path d="M41 201 L6 150 M459 201 L494 150 M41 399 L6 450 M459 399 L494 450" stroke="#a3876a" stroke-width="3" stroke-linecap="round"/>' +
    shadowRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h) + paperRect(BANNER, 2.5)
);
const BANNER_RINGS = sv(
  '<rect x="31.5" y="191.5" width="437" height="217" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="3"/>' +
    BANNER_EYELETS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="#9aa0a8" stroke-width="3"/><circle cx="${x}" cy="${y}" r="2.6" fill="#4b5058"/>`).join('')
);
// Tent cards standing on a table: table numbers 15 × 10 cm, place cards 9 × 5 cm (each face).
const TABLE_NO = { x: 55, y: 190, w: 390, h: 260 };
const PLACE_CARD = { x: 52, y: 200, w: 396, h: 220 };
const tentSvg = (a, backFace) => {
  const b = a.y + a.h;
  const edge = backFace
    ? `<polygon points="${a.x},${a.y} ${a.x - 34},${b} ${a.x},${b}" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>`
    : `<polygon points="${a.x + a.w},${a.y} ${a.x + a.w + 34},${b} ${a.x + a.w},${b}" fill="{{S}}" stroke="{{L}}" stroke-width="2" stroke-linejoin="round"/>`;
  return sv(`<ellipse cx="250" cy="${b + 12}" rx="236" ry="14" fill="#000" opacity=".1"/>` + edge + paperRect(a) + `<path d="M${a.x} ${a.y} H${a.x + a.w}" stroke="{{L}}" stroke-width="4"/>`);
};

const CARD_STOCK = [
  { id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' },
  { id: 'pearl', name: t('Pearl shimmer', 'لؤلؤي لامع'), hex: '#f7f4ee' },
  C.cream,
  C.kraft,
];
const laminationOption = (help, price) => ({
  id: 'lamination',
  name: t('Lamination', 'سلوفان'),
  help,
  choices: [
    { id: 'none', name: t('No lamination', 'بدون سلوفان'), price: 0 },
    { id: 'matte', name: t('Matte lamination', 'سلوفان مط'), price },
    { id: 'gloss', name: t('Glossy lamination', 'سلوفان لامع'), price },
  ],
});
const withArt = (art, overlay) => art + svgInner(overlay);

PRODUCTS.push(
  {
    id: 'postcards',
    category: 'occasions',
    name: t('Postcards & Thank-you Cards', 'كروت بوستال وكروت شكر'),
    description: t('Thick 350 gsm cards, 10 × 15 cm, printed on one or both sides. Perfect as thank-you cards in your online orders, and for greetings, offers and small invitations.', 'كروت 350 جرام سميكة، 10 × 15 سم، طباعة وش أو وشين. مثالية ككروت شكر جوه أوردرات الأونلاين، وللتهاني والعروض والدعوات الصغيرة.'),
    basePrice: 220,
    extraSidePrice: 60,
    colorLabel: t('Paper', 'الورق'),
    colors: PAPER_FINISH,
    sizes: qty([['1', '1 card', 'كارت واحد', -200, SMALL], ['10', '10 cards', '10 كروت', -130, SMALL], ['25', '25 cards', '25 كارت', -80, SMALL], ['50', '50 cards', '50 كارت', 0], ['100', '100 cards', '100 كارت', 120], ['250', '250 cards', '250 كارت', 380], ['500', '500 cards', '500 كارت', 700]]),
    sides: [
      { id: 'front', name: FRONT, svg: cardPack(POSTCARD, -6), printArea: { ...POSTCARD }, printWidthIn: cmIn(10) },
      { id: 'back', name: BACK, svg: cardPack(POSTCARD, 6), printArea: { ...POSTCARD }, printWidthIn: cmIn(10) },
    ],
    cardArt: sampleArt(POSTCARD, { bg: '#fde2d6', accent: '#e8590c', motif: 'heart' }),
  },
  {
    id: 'foldedcards',
    category: 'occasions',
    name: t('Folded Cards Printed Inside (packs)', 'كروت مطوية مطبوعة من جوه (باكتات)'),
    description: t('A5 cards folded to A6 (10.5 × 14.8 cm) on 300 gsm card, printed on the cover and on the inside page for your message, with white envelopes. For thank-you notes, Eid and wedding cards and company greetings. Printing inside costs nothing extra.', 'كروت A5 بتتطوي A6 (10.5 × 14.8 سم) على كارت 300 جرام، مطبوعة على الغلاف وعلى الصفحة اللي جوه لرسالتك، ومعاها ظروف بيضاء. لكروت الشكر وتهاني العيد والأفراح وتهاني الشركات. طباعة الجوه من غير أي زيادة.'),
    basePrice: 280,
    extraSidePrice: 0,
    colorLabel: t('Paper', 'الورق'),
    colors: CARD_STOCK,
    sizes: qty([['1', '1 card + envelope', 'كارت واحد + ظرف', -140, SMALL], ['10', '10 cards + envelopes', '10 كروت + ظروف', 0], ['25', '25 cards + envelopes', '25 كارت + ظروف', 200], ['50', '50 cards + envelopes', '50 كارت + ظروف', 500], ['100', '100 cards + envelopes', '100 كارت + ظروف', 1000]]),
    sides: [
      { id: 'front', name: t('Cover', 'الغلاف'), svg: FOLDED_COVER, printArea: { ...FOLD_A6 }, printWidthIn: cmIn(10.5) },
      {
        id: 'back',
        name: t('Inside', 'من جوه'),
        svg: sv(
          '<rect x="46" y="158" width="420" height="296" fill="#000" opacity=".1"/>' +
            '<rect x="40" y="150" width="210" height="296" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
            paperRect(FOLD_IN, 2) + '<path d="M250 150 V446" stroke="{{L}}" stroke-width="2"/>'
        ),
        overlay: sv('<defs><linearGradient id="fold" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect x="250" y="150" width="16" height="296" fill="url(#fold)"/>'),
        printArea: { ...FOLD_IN },
        printWidthIn: cmIn(10.5),
      },
    ],
    cardArt: sampleArt(FOLD_A6, { bg: '#e7f5ff', accent: '#1c7ed6', motif: 'heart' }),
  },
  {
    id: 'giftvouchers',
    category: 'business',
    name: t('Gift Vouchers', 'كوبونات هدايا (جيفت فاوتشر)'),
    description: t('Gift vouchers for your shop, salon, café or clinic on thick 350 gsm card, 21 × 10 cm, printed on one or both sides. Leave a space to write the value and the expiry date by hand.', 'كوبونات هدايا لمحلك أو الصالون أو الكافيه أو العيادة، على كارت 350 جرام سميك، 21 × 10 سم، طباعة وش أو وشين. سيب مكان تكتب فيه القيمة وتاريخ الصلاحية بخط إيدك.'),
    basePrice: 250,
    extraSidePrice: 60,
    colorLabel: t('Paper', 'الورق'),
    colors: CARD_STOCK,
    options: [laminationOption(
      t('A thin film over the print that protects the vouchers and makes them feel stronger.', 'طبقة رقيقة فوق الطباعة بتحمي الكوبونات وبتخليها أتقل في الإيد.'),
      { 1: 10, 10: 30, 25: 40, 50: 70, 100: 120, 250: 250 },
    )],
    sizes: qty([['1', '1 voucher', 'كوبون واحد', -200, SMALL], ['10', '10 vouchers', '10 كوبونات', -50, SMALL], ['25', '25 vouchers', '25 كوبون', 0], ['50', '50 vouchers', '50 كوبون', 120], ['100', '100 vouchers', '100 كوبون', 300], ['250', '250 vouchers', '250 كوبون', 700]]),
    sides: [
      { id: 'front', name: FRONT, svg: cardPack(VOUCHER, -5), printArea: { ...VOUCHER }, printWidthIn: cmIn(21) },
      { id: 'back', name: BACK, svg: cardPack(VOUCHER, 5), printArea: { ...VOUCHER }, printWidthIn: cmIn(21) },
    ],
    cardArt: `<rect x="40" y="200" width="420" height="200" rx="4" fill="#fff4e6"/><rect x="330" y="200" width="26" height="200" fill="#d6336c"/><circle cx="343" cy="250" r="20" fill="#e64980"/>` +
      '<rect x="70" y="250" width="200" height="22" rx="11" fill="#2b2d42"/><rect x="70" y="290" width="150" height="12" rx="6" fill="#2b2d42" opacity=".55"/><rect x="70" y="340" width="110" height="26" rx="6" fill="none" stroke="#d6336c" stroke-width="3"/>',
  },
  {
    id: 'bookmarks',
    category: 'stationery',
    name: t('Bookmarks', 'فواصل كتب'),
    description: t('Bookmarks on thick 350 gsm card, 5 × 15 cm, printed on one or both sides, with a punched hole and a gold tassel. For bookshops, schools, Quran gifts and giveaways.', 'فواصل كتب على كارت 350 جرام سميك، 5 × 15 سم، طباعة وش أو وشين، بخرم وشرّابة دهبي. للمكتبات والمدارس وهدايا المصاحف والتوزيعات.'),
    basePrice: 180,
    extraSidePrice: 40,
    colorLabel: t('Paper', 'الورق'),
    colors: PAPER_FINISH,
    sizes: qty([['1', '1 bookmark', 'فاصل واحد', -145, SMALL], ['10', '10 bookmarks', '10 فواصل', -40, SMALL], ['25', '25 bookmarks', '25 فاصل', 0], ['50', '50 bookmarks', '50 فاصل', 80], ['100', '100 bookmarks', '100 فاصل', 200], ['250', '250 bookmarks', '250 فاصل', 450]]),
    sides: [
      { id: 'front', name: FRONT, svg: cardPack(BOOKMARK, 9), overlay: BOOKMARK_TASSEL, printArea: { ...BOOKMARK }, printWidthIn: cmIn(5) },
      { id: 'back', name: BACK, svg: cardPack(BOOKMARK, 9), overlay: BOOKMARK_TASSEL, printArea: { ...BOOKMARK }, printWidthIn: cmIn(5) },
    ],
    cardArt: withArt(
      '<rect x="180" y="100" width="140" height="420" rx="4" fill="#e6fcf5"/><path d="M180 380 Q250 330 320 380 L320 520 L180 520 Z" fill="#20c997"/><circle cx="250" cy="250" r="34" fill="#0ca678"/><rect x="205" y="310" width="90" height="10" rx="5" fill="#2b2d42"/>',
      BOOKMARK_TASSEL,
    ),
  },
  {
    id: 'brochures',
    category: 'business',
    name: t('Tri-fold Brochures', 'بروشورات 3 طيّات'),
    description: t('A4 brochures folded in three (to 10 × 21 cm) on 170 gsm satin paper, printed on both sides. Outside: the middle third is the back, and the front cover is the right-hand third (the left-hand one for Arabic brochures). Inside: the three panels seen when it opens.', 'بروشور A4 بيتطوي 3 طيّات (يبقى 10 × 21 سم) على ورق 170 جرام ساتان، مطبوع وشين. من بره: التلت اللي في النص هو الضهر، والغلاف هو التلت اليمين (أو الشمال لو البروشور عربي). من جوه: التلات أجزاء اللي بتبان لما يتفتح.'),
    basePrice: 500,
    extraSidePrice: 0,
    colors: [{ id: 'satin', name: t('Satin white', 'أبيض ساتان'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' }],
    sizes: qty([['1', '1 brochure', 'بروشور واحد', -475, SMALL], ['10', '10 brochures', '10 بروشورات', -400, SMALL], ['25', '25 brochures', '25 بروشور', -340, SMALL], ['100', '100 brochures', '100 بروشور', 0], ['250', '250 brochures', '250 بروشور', 350], ['500', '500 brochures', '500 بروشور', 750], ['1000', '1000 brochures', '1000 بروشور', 1400]]),
    sides: [
      { id: 'front', name: t('Outside', 'من بره'), svg: TRIFOLD_SVG, overlay: TRIFOLD_FOLDS, printArea: { ...TRIFOLD, ...TRIFOLD_COVER }, printWidthIn: cmIn(29.7) },
      { id: 'back', name: t('Inside', 'من جوه'), svg: TRIFOLD_SVG, overlay: TRIFOLD_FOLDS, printArea: { ...TRIFOLD }, printWidthIn: cmIn(29.7) },
    ],
    cardArt: withArt(
      '<rect x="40" y="150" width="140" height="297" fill="#e7f5ff"/><rect x="180" y="150" width="140" height="297" fill="#ffffff"/><rect x="320" y="150" width="140" height="297" fill="#1c7ed6"/>' +
        '<circle cx="390" cy="250" r="34" fill="#ffffff"/><rect x="345" y="310" width="90" height="12" rx="6" fill="#ffffff"/><rect x="62" y="190" width="96" height="10" rx="5" fill="#2b2d42"/><rect x="62" y="212" width="80" height="8" rx="4" fill="#868e96"/><rect x="202" y="190" width="96" height="70" rx="4" fill="#a5d8ff"/>',
      TRIFOLD_FOLDS,
    ),
  },
  {
    id: 'menus',
    category: 'business',
    name: t('Restaurant & Café Menus', 'منيو مطاعم وكافيهات'),
    description: t('Menus on thick 300 gsm card, A4 or A3, printed on both sides at no extra cost. Add lamination so they wipe clean and last.', 'منيو على كارت 300 جرام سميك، A4 أو A3، مطبوع وشين من غير زيادة. ضيف سلوفان عشان يتمسح بسهولة ويعيش.'),
    basePrice: 250,
    extraSidePrice: 0,
    colorLabel: t('Paper', 'الورق'),
    colors: [{ id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' }, C.kraft],
    options: [laminationOption(
      t('A thick film on both sides: the menu wipes clean and lasts much longer.', 'طبقة سلوفان على الوشين: المنيو يتمسح بسهولة ويعيش أطول بكتير.'),
      { 'A4-1': 50, 'A3-1': 90, 'A4-10': 100, 'A4-25': 200, 'A4-50': 350, 'A3-10': 180, 'A3-25': 400 },
    )],
    sizes: qty([['A4-1', 'A4 × 1', 'A4 × 1', -120, SMALL], ['A3-1', 'A3 × 1', 'A3 × 1', -20, SMALL], ['A4-10', 'A4 × 10', 'A4 × 10', 0], ['A4-25', 'A4 × 25', 'A4 × 25', 250], ['A4-50', 'A4 × 50', 'A4 × 50', 550], ['A3-10', 'A3 × 10', 'A3 × 10', 200], ['A3-25', 'A3 × 25', 'A3 × 25', 600]]),
    sides: [
      { id: 'front', name: FRONT, svg: menuSvg(-5), printArea: { ...MENU }, printWidthIn: cmIn(21) },
      { id: 'back', name: BACK, svg: menuSvg(5), printArea: { ...MENU }, printWidthIn: cmIn(21) },
    ],
    cardArt: '<rect x="110" y="80" width="280" height="396" rx="6" fill="#fff9db"/><rect x="110" y="80" width="280" height="80" rx="6" fill="#e8590c"/><rect x="180" y="110" width="140" height="20" rx="10" fill="#ffffff"/>' +
      [0, 1, 2, 3, 4, 5].map((i) => `<rect x="140" y="${190 + i * 44}" width="${150 - (i % 3) * 20}" height="10" rx="5" fill="#2b2d42"/><rect x="330" y="${190 + i * 44}" width="30" height="10" rx="5" fill="#e8590c"/><rect x="140" y="${206 + i * 44}" width="110" height="6" rx="3" fill="#adb5bd"/>`).join(''),
  },
  {
    id: 'notepads',
    category: 'stationery',
    name: t('Notepads (50 sheets)', 'بلوك نوت (50 ورقة)'),
    description: t('Glued pads of 50 sheets, A5 or A6, on 80 gsm paper with a card back. Every sheet is printed with your design: a logo at the top, lines or a to-do list. For offices, clinics, hotels and gifts.', 'بلوكات نوت متقفلة بالغِرا، 50 ورقة، A5 أو A6، على ورق 80 جرام بضهر كرتون. كل ورقة مطبوعة بتصميمك: لوجو فوق، سطور أو قائمة مهام. للمكاتب والعيادات والفنادق والهدايا.'),
    basePrice: 90,
    colorLabel: t('Paper', 'الورق'),
    colors: [C.white, C.cream],
    sizes: qty([['A6-1', 'A6 · 1 pad', 'A6 · بلوك واحد', 0], ['A6-5', 'A6 · 5 pads', 'A6 · 5 بلوكات', 280], ['A6-10', 'A6 · 10 pads', 'A6 · 10 بلوكات', 530], ['A5-1', 'A5 · 1 pad', 'A5 · بلوك واحد', 40], ['A5-5', 'A5 · 5 pads', 'A5 · 5 بلوكات', 400], ['A5-10', 'A5 · 10 pads', 'A5 · 10 بلوكات', 780]]),
    sides: [{ id: 'front', name: t('Sheet', 'الورقة'), svg: NOTEPAD_SVG, printArea: { ...NOTEPAD }, printWidthIn: cmIn(14.8) }],
    cardArt: '<rect x="139" y="120" width="222" height="315" fill="#ffffff"/><circle cx="178" cy="160" r="18" fill="#7048e8"/><rect x="206" y="152" width="110" height="10" rx="5" fill="#2b2d42"/>' +
      Array.from({ length: 9 }, (_, i) => `<path d="M160 ${210 + i * 24} H340" stroke="#d0bfff" stroke-width="2"/>`).join(''),
  },
  {
    id: 'folders',
    category: 'business',
    name: t('Presentation Folders', 'فولدرات شركات'),
    description: t('A4 folders (22 × 31 cm) with a pocket inside and a business-card slot, on thick 350 gsm card. You design the outside as one piece: the right half is the front and the left half the back (the other way round for Arabic folders).', 'فولدرات A4 (22 × 31 سم) بجيب من جوه ومكان لكارت شخصي، على كارت 350 جرام سميك. بتصمم البرّه كله حتة واحدة: النص اليمين هو الوش والنص الشمال هو الضهر (والعكس لو الفولدر عربي).'),
    basePrice: 750,
    colorLabel: t('Paper', 'الورق'),
    colors: [{ id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' }, C.kraft],
    options: [laminationOption(
      t('A thin film over the print that keeps the folders clean and stops the folds cracking.', 'طبقة رقيقة فوق الطباعة بتحافظ على الفولدر نضيف وبتمنع الطباعة تتشرخ عند الطيّة.'),
      { 1: 30, 10: 120, 25: 150, 50: 250, 100: 450, 250: 950 },
    )],
    sizes: qty([['1', '1 folder', 'فولدر واحد', -600, SMALL], ['10', '10 folders', '10 فولدرات', -150, SMALL], ['25', '25 folders', '25 فولدر', 0], ['50', '50 folders', '50 فولدر', 450], ['100', '100 folders', '100 فولدر', 1200], ['250', '250 folders', '250 فولدر', 3200]]),
    sides: [{ id: 'front', name: t('Outside', 'من بره'), svg: FOLDER_SVG, overlay: FOLDER_SPINE, printArea: { ...FOLDER, ...FOLDER_ZONES }, printWidthIn: cmIn(44) }],
    cardArt: withArt(
      '<rect x="30" y="140" width="220" height="310" fill="#f1f3f5"/><rect x="250" y="140" width="220" height="310" fill="#343a40"/><circle cx="360" cy="260" r="40" fill="#fab005"/><rect x="305" y="330" width="110" height="14" rx="7" fill="#ffffff"/><rect x="100" y="380" width="80" height="10" rx="5" fill="#495057"/>',
      FOLDER_SPINE,
    ),
  },
  {
    id: 'booklets',
    category: 'business',
    name: t('Booklets & Catalogues (A5, stapled)', 'كتيبات وكتالوجات (A5 دبوس)'),
    description: t('A5 booklets stapled on the spine, 8 to 32 pages on 115 gsm paper with a 250 gsm cover; the page count is part of the size. Design every page here: the covers and each inside page, bound on the right (Arabic) or the left (English).', 'كتيبات A5 متدبّسة من الجنب، من 8 لـ 32 صفحة على ورق 115 جرام بغلاف 250 جرام؛ عدد الصفحات جوه المقاس. صمم كل صفحة هنا: الغلافين وكل صفحة جوه، والتدبيس يمين (عربي) أو شمال (إنجليزي).'),
    basePrice: 900,
    extraSidePrice: 0,
    colors: [{ id: 'matte', name: t('Matte cover', 'غلاف مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy cover', 'غلاف لامع'), hex: '#ffffff' }],
    sizes: qty([
      // From one copy (price per copy falls with the pack: 1 copy = 5×, 10 = 2×, 25 = 1.25× the 50-copy rate).
      ['8-1', '8 pages × 1 copy', '8 صفحات × نسخة واحدة', -810, SMALL], ['16-1', '16 pages × 1 copy', '16 صفحة × نسخة واحدة', -760, SMALL], ['24-1', '24 pages × 1 copy', '24 صفحة × نسخة واحدة', -710, SMALL], ['32-1', '32 pages × 1 copy', '32 صفحة × نسخة واحدة', -660, SMALL],
      ['8-10', '8 pages × 10 copies', '8 صفحات × 10 نسخ', -540, SMALL], ['16-10', '16 pages × 10 copies', '16 صفحة × 10 نسخ', -340, SMALL], ['24-10', '24 pages × 10 copies', '24 صفحة × 10 نسخ', -140, SMALL], ['32-10', '32 pages × 10 copies', '32 صفحة × 10 نسخ', 60, SMALL],
      ['8-25', '8 pages × 25 copies', '8 صفحات × 25 نسخة', -340, SMALL], ['16-25', '16 pages × 25 copies', '16 صفحة × 25 نسخة', -20, SMALL], ['24-25', '24 pages × 25 copies', '24 صفحة × 25 نسخة', 290, SMALL], ['32-25', '32 pages × 25 copies', '32 صفحة × 25 نسخة', 600, SMALL],
      ['8-50', '8 pages × 50 copies', '8 صفحات × 50 نسخة', 0], ['16-50', '16 pages × 50 copies', '16 صفحة × 50 نسخة', 500], ['24-50', '24 pages × 50 copies', '24 صفحة × 50 نسخة', 1000], ['32-50', '32 pages × 50 copies', '32 صفحة × 50 نسخة', 1500],
      ['8-100', '8 pages × 100 copies', '8 صفحات × 100 نسخة', 600], ['16-100', '16 pages × 100 copies', '16 صفحة × 100 نسخة', 1500], ['32-100', '32 pages × 100 copies', '32 صفحة × 100 نسخة', 3100],
    ]),
    // Many pages: the front cover, the inside pages (p2...p31) and the back cover; the size
    // says how many are printed (sizes[].pages), the binding which way the pages turn.
    paged: true,
    options: [{
      id: 'binding',
      keepDefault: true, // always shown (cart, proof, order, admin): either side matters for the print
      name: t('Binding', 'التدبيس'),
      help: t('Arabic booklets open on the right, English ones on the left: it sets the order of the pages.', 'الكتيبات العربي بتتفتح من اليمين والإنجليزي من الشمال: ده بيحدد ترتيب الصفحات.'),
      choices: [
        { id: 'right', name: t('On the right (Arabic)', 'من اليمين (عربي)'), price: 0 },
        { id: 'left', name: t('On the left (English)', 'من الشمال (إنجليزي)'), price: 0 },
      ],
    }],
    sides: [
      // rtlArt: the drawing for a booklet bound on the right (Arabic): the staples on the cover's right edge.
      { id: 'front', name: t('Front cover', 'الغلاف الأمامي'), short: t('Cover', 'الغلاف'), svg: bookletSvg(true), overlay: bookletSpine(true), rtlArt: { svg: bookletSvg(false), overlay: bookletSpine(false) }, printArea: { ...BOOKLET }, printWidthIn: cmIn(14.8) },
      ...Array.from({ length: 30 }, (_, k) => ({ id: `p${k + 2}`, name: t(`Page ${k + 2}`, `صفحة ${k + 2}`), short: t(String(k + 2), String(k + 2)), svg: flat(BOOKLET.x, BOOKLET.y, BOOKLET.w, BOOKLET.h), printArea: { ...BOOKLET }, printWidthIn: cmIn(14.8) })),
      { id: 'back', name: t('Back cover', 'الغلاف الخلفي'), short: t('Back', 'الخلفي'), svg: bookletSvg(false), overlay: bookletSpine(false), rtlArt: { svg: bookletSvg(true), overlay: bookletSpine(true) }, printArea: { ...BOOKLET }, printWidthIn: cmIn(14.8) },
    ],
    cardArt: withArt(sampleArt(BOOKLET, { bg: '#fff0f6', accent: '#c2255c' }), bookletSpine(true)),
  },
  {
    id: 'labels',
    category: 'business',
    name: t('Product Labels', 'ليبلز للمنتجات'),
    description: t('Rectangle labels with rounded corners for jars, bottles, boxes and packaging: 5 × 3, 7.5 × 4.5 or 10 × 6 cm. On paper, waterproof vinyl, clear or kraft, on sheets or on a roll.', 'ليبلز مستطيلة بحواف مدورة للبرطمانات والأزايز والعلب والتغليف: 5 × 3 أو 7.5 × 4.5 أو 10 × 6 سم. على ورق أو فينيل ضد المياه أو شفاف أو كرافت، على شيتات أو رول.'),
    basePrice: 180,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'paper', name: t('White glossy paper', 'ورق أبيض لامع'), hex: '#ffffff' },
      { id: 'vinyl', name: t('White waterproof vinyl', 'فينيل أبيض ضد المياه'), hex: '#ffffff' },
      { id: 'clear', name: t('Clear vinyl', 'فينيل شفاف'), hex: '#f3f5f7' },
      C.kraft,
    ],
    options: [{
      id: 'delivery',
      name: t('Supplied', 'طريقة التسليم'),
      help: t('Sheets are easy to peel by hand; a roll is quicker when you label many products.', 'الشيتات سهل تقشّرها بإيدك؛ والرول أسرع لو بتلزق على منتجات كتير.'),
      choices: [
        { id: 'sheets', name: t('On sheets', 'على شيتات'), price: 0 },
        { id: 'roll', name: t('On a roll', 'على رول'), price: { '50x30-100': 40, '50x30-250': 60, '50x30-500': 90, '50x30-1000': 140, '75x45-100': 40, '75x45-250': 70, '75x45-500': 110, '100x60-100': 50, '100x60-250': 90, '100x60-500': 140 } },
      ],
    }],
    sizes: qty([
      ['50x30-100', '5 × 3 cm × 100', '5 × 3 سم × 100', 0], ['50x30-250', '5 × 3 cm × 250', '5 × 3 سم × 250', 150], ['50x30-500', '5 × 3 cm × 500', '5 × 3 سم × 500', 340], ['50x30-1000', '5 × 3 cm × 1000', '5 × 3 سم × 1000', 620],
      ['75x45-100', '7.5 × 4.5 cm × 100', '7.5 × 4.5 سم × 100', 100], ['75x45-250', '7.5 × 4.5 cm × 250', '7.5 × 4.5 سم × 250', 340], ['75x45-500', '7.5 × 4.5 cm × 500', '7.5 × 4.5 سم × 500', 670],
      ['100x60-100', '10 × 6 cm × 100', '10 × 6 سم × 100', 200], ['100x60-250', '10 × 6 cm × 250', '10 × 6 سم × 250', 570], ['100x60-500', '10 × 6 cm × 500', '10 × 6 سم × 500', 1070],
    ]),
    sides: [{ id: 'front', name: t('Label', 'الليبل'), svg: LABEL_SVG, printArea: { ...LABEL }, printWidthIn: cmIn(5) }],
    cardArt: sampleArt(LABEL, { bg: '#fff3bf', accent: '#f08c00' }),
  },
  {
    id: 'wrappingpaper',
    category: 'occasions',
    name: t('Custom Wrapping Paper', 'ورق تغليف هدايا بتصميمك'),
    description: t('Gift-wrap sheets of 50 × 70 cm printed with your own repeating pattern: your logo for shop packaging, or names and photos for birthdays, weddings and Eid.', 'فرخ ورق تغليف 50 × 70 سم مطبوع بنقشتك المتكررة: لوجو محلك لتغليف الأوردرات، أو أسامي وصور لأعياد الميلاد والأفراح والعيد.'),
    basePrice: 250,
    colorLabel: t('Paper', 'الورق'),
    colors: [
      { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' },
      { id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#fbfbfa' },
      C.kraft,
    ],
    sizes: [5, 10, 25, 50].map((n, i) => ({ id: String(n), label: t(`${n} sheets · 50 × 70 cm`, `${n} فرخ · 50 × 70 سم`), surcharge: [0, 150, 450, 950][i], cm: [50, 70] })),
    sides: [fabricSide()],
    pattern: {
      tiles: [5, 8, 10, 15, 20],
      tile: 10,
      scene: {
        svg: sv('<rect x="68" y="50" width="380" height="532" fill="#000" opacity=".1"/><rect x="60" y="40" width="380" height="532" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>'),
        overlay: sv(
          // The corner curling up (the plain back of the paper) and a ribbon bow.
          '<path d="M440 482 L440 572 L350 572 Q392 548 440 482 Z" fill="#eef0f2"/><path d="M440 482 Q392 548 350 572 Q408 556 440 482 Z" fill="#ffffff" stroke="#c9ccd2" stroke-width="1.5"/><path d="M350 572 Q392 548 440 482" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="5"/>' +
            '<g transform="translate(108 92)"><path d="M0 0 C-40 -36 -52 18 -6 10 Z M0 0 C40 -36 52 18 6 10 Z" fill="#e03131" stroke="#a51111" stroke-width="2"/><path d="M-4 8 L-22 52 M4 8 L22 52" stroke="#e03131" stroke-width="7" stroke-linecap="round"/><circle cx="0" cy="4" r="8" fill="#c92a2a"/></g>'
        ),
        fill: { x: 60, y: 40, w: 380, h: 532 },
      },
    },
  },
  {
    id: 'windowstickers',
    category: 'business',
    name: t('Window & Glass Stickers', 'ستيكرات فاترينة وإزاز'),
    description: t('Waterproof vinyl stickers for shop windows, glass doors and cars: opening hours, logos, offers and "Welcome". White or clear vinyl, square, from 20 to 70 cm.', 'ستيكرات فينيل ضد المياه لفاترينة المحل والأبواب الإزاز والعربيات: مواعيد العمل واللوجو والعروض و"أهلاً بيكم". فينيل أبيض أو شفاف، مربعة من 20 لـ 70 سم.'),
    basePrice: 120,
    colorLabel: t('Vinyl', 'الفينيل'),
    colors: [
      { id: 'white', name: t('White vinyl', 'فينيل أبيض'), hex: '#ffffff' },
      { id: 'clear', name: t('Clear vinyl, stuck on the outside', 'فينيل شفاف، يتلزق من بره'), hex: '#e4eef3' },
      { id: 'clearin', name: t('Clear vinyl, stuck inside the glass (printed mirrored, read from outside)', 'فينيل شفاف، يتلزق من جوه الإزاز (يتطبع معكوس ويتقري من بره)'), hex: '#e4eef3' },
    ],
    sizes: qty([['20', '20 × 20 cm', '20 × 20 سم', 0], ['30', '30 × 30 cm', '30 × 30 سم', 80], ['50', '50 × 50 cm', '50 × 50 سم', 280], ['70', '70 × 70 cm', '70 × 70 سم', 580]]),
    sides: [{ id: 'front', name: t('Sticker', 'الستيكر'), svg: WINDOW_SVG, overlay: WINDOW_SHINE, printArea: { ...WINDOW_STICKER }, printWidthIn: cmIn(20) }],
    cardArt: withArt(
      '<rect x="100" y="150" width="300" height="300" rx="6" fill="#ffffff"/><circle cx="250" cy="250" r="54" fill="#2f9e44"/><rect x="160" y="330" width="180" height="18" rx="9" fill="#2b2d42"/><rect x="190" y="362" width="120" height="10" rx="5" fill="#2b2d42" opacity=".55"/>',
      WINDOW_SHINE,
    ),
  },
  {
    id: 'calendar',
    category: 'home',
    name: t('Wall Calendar (A3)', 'نتيجة حائط (A3)'),
    description: t('A sturdy A3 card printed with your design all over, with a pad of 12 month sheets (Arabic and English) stapled on its lower half, a metal strip and a hanger. Put your photo or logo on the top and your contact details round the pad. A classic New Year gift for clients.', 'كارت A3 مقوّى مطبوع بتصميمك كله، ومتدبّس على نصه اللي تحت بلوك 12 شهر (عربي وإنجليزي)، بشريط معدن وعلّاقة. حط صورتك أو اللوجو فوق، وبيانات التواصل حوالين البلوك. هدية رأس السنة الكلاسيك للعملاء.'),
    basePrice: 200,
    colorLabel: t('Card', 'الكارت'),
    colors: [{ id: 'matte', name: t('Matte card', 'كارت مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy card', 'كارت لامع'), hex: '#ffffff' }],
    sizes: qty([['1', '1 calendar', 'نتيجة واحدة', 0], ['10', '10 calendars', '10 نتايج', 1000], ['25', '25 calendars', '25 نتيجة', 2300], ['50', '50 calendars', '50 نتيجة', 4100], ['100', '100 calendars', '100 نتيجة', 7300]]),
    sides: [{ id: 'front', name: FRONT, svg: WALL_CAL_SVG, overlay: WALL_CAL_PAD, printArea: { ...WALL_CAL, readyZone: WALL_CAL_ZONE }, printWidthIn: cmIn(29.7) }],
    cardArt: withArt(photoArt({ x: 105, y: 40, w: 290, h: 205 }) + '<rect x="105" y="245" width="290" height="205" fill="#f8f9fa"/><rect x="190" y="440" width="120" height="6" rx="3" fill="#495057"/>', WALL_CAL_PAD),
  },
  {
    id: 'deskcalendar',
    category: 'home',
    name: t('Desk Calendar (tent)', 'نتيجة مكتب (ستاند)'),
    description: t('A tent-style desk calendar: 13 A5 sheets (a cover and 12 months) wire-bound on a sturdy stand. Your design is printed on the left half of every sheet, and we print the month (Arabic and English) on the right half.', 'نتيجة مكتب ستاند: 13 ورقة A5 (غلاف و12 شهر) بسلك على قاعدة مقوّاة. تصميمك بيتطبع على النص الشمال من كل ورقة، واحنا بنطبع الشهر (عربي وإنجليزي) على النص اليمين.'),
    basePrice: 180,
    colorLabel: t('Paper', 'الورق'),
    colors: [{ id: 'matte', name: t('Matte white', 'أبيض مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy white', 'أبيض لامع'), hex: '#ffffff' }],
    sizes: qty([['1', '1 calendar', 'نتيجة واحدة', 0], ['10', '10 calendars', '10 نتايج', 920], ['25', '25 calendars', '25 نتيجة', 2120], ['50', '50 calendars', '50 نتيجة', 3820], ['100', '100 calendars', '100 نتيجة', 6820]]),
    sides: [{ id: 'front', name: t('Each sheet', 'كل ورقة'), svg: DESK_CAL_SVG, overlay: DESK_CAL_RINGS, printArea: { ...DESK_CAL }, printWidthIn: cmIn(10.5) }],
    cardArt: withArt(photoArt(DESK_CAL), DESK_CAL_RINGS),
  },
  {
    id: 'photobook',
    category: 'photos',
    name: t('Photo Album with Your Cover', 'ألبوم صور بغلاف بتصميمك'),
    description: t('A hardcover photo album with slip-in pockets for 10 × 15 cm photos (100 or 200), with your photo or design printed on the cover. Order the photo prints to go in it from the Photo Prints page. (The pages are photo pockets, not printed pages.)', 'ألبوم صور بغلاف مقوّى وجيوب للصور مقاس 10 × 15 سم (100 أو 200 صورة)، والغلاف مطبوع بصورتك أو تصميمك. اطلب طباعة الصور اللي هتحطها فيه من صفحة طباعة الصور. (الصفحات جيوب للصور، مش صفحات مطبوعة.)'),
    basePrice: 450,
    colorLabel: t('Cover', 'الغلاف'),
    colors: [{ id: 'matte', name: t('Matte cover', 'غلاف مطفي'), hex: '#ffffff' }, { id: 'gloss', name: t('Glossy cover', 'غلاف لامع'), hex: '#ffffff' }],
    sizes: qty([['100', '100 photos · cover 20 × 25 cm', '100 صورة · غلاف 20 × 25 سم', 0], ['200', '200 photos · cover 24 × 30 cm', '200 صورة · غلاف 24 × 30 سم', 200]]),
    sides: [{ id: 'front', name: t('Cover', 'الغلاف'), svg: ALBUM_SVG, overlay: ALBUM_HINGE, printArea: { ...ALBUM }, printWidthIn: cmIn(20) }],
    cardArt: withArt(photoArt(ALBUM), ALBUM_HINGE),
  },
  {
    id: 'magnets',
    category: 'home',
    name: t('Fridge Magnets', 'مغناطيس تلاجة'),
    description: t('Glossy printed magnets with a strong magnetic back and rounded corners: 6 × 9, 8 × 12 or 10 × 15 cm. For photos and gifts, or your restaurant\'s menu and delivery number on every fridge.', 'مغناطيس تلاجة مطبوع بضهر مغناطيس قوي وحواف مدورة: 6 × 9 أو 8 × 12 أو 10 × 15 سم. للصور والهدايا، أو منيو مطعمك ورقم الدليفري على كل تلاجة.'),
    basePrice: 50,
    colors: [{ id: 'gloss', name: t('Glossy', 'لامع'), hex: '#ffffff' }, { id: 'matte', name: t('Matte', 'مطفي'), hex: '#ffffff' }],
    sizes: qty([
      ['60x90-1', '6 × 9 cm', '6 × 9 سم', 0], ['60x90-100', '6 × 9 cm × 100', '6 × 9 سم × 100', 1450],
      ['80x120-1', '8 × 12 cm', '8 × 12 سم', 25], ['80x120-100', '8 × 12 cm × 100', '8 × 12 سم × 100', 2150],
      ['100x150-1', '10 × 15 cm', '10 × 15 سم', 50], ['100x150-100', '10 × 15 cm × 100', '10 × 15 سم × 100', 2950],
    ]),
    sides: [{ id: 'front', name: FRONT, svg: MAGNET_SVG, printArea: { ...MAGNET }, printWidthIn: cmIn(6) }],
    cardArt: photoArt(MAGNET),
  },
  {
    id: 'banners',
    category: 'business',
    name: t('Vinyl Banners with Eyelets', 'بانر فليكس بحلقات'),
    description: t('Strong, weatherproof vinyl banners with hemmed edges and metal eyelets for hanging: for shop fronts, events, weddings and sales. Keep text 3 cm in from the edge, clear of the eyelets.', 'بانر فليكس متين ضد الشمس والمطر، بحواف مخيطة وحلقات معدن للتعليق: لواجهات المحلات والإيفنتات والأفراح والأوكازيونات. خلّي الكلام بعيد عن الحرف 3 سم عشان الحلقات.'),
    basePrice: 250,
    colorLabel: t('Material', 'الخامة'),
    colors: [
      { id: 'flex', name: t('Glossy flex', 'فليكس لامع'), hex: '#ffffff' },
      { id: 'matte', name: t('Matte flex', 'فليكس مطفي'), hex: '#fbfbfb' },
      { id: 'mesh', name: t('Mesh (for windy places)', 'ميش (للأماكن اللي فيها هوا)'), hex: '#f1f2f3' },
    ],
    sizes: qty([['100x50', '100 × 50 cm', '100 × 50 سم', 0], ['150x75', '150 × 75 cm', '150 × 75 سم', 200], ['200x100', '200 × 100 cm', '200 × 100 سم', 500]]),
    sides: [{ id: 'front', name: FRONT, svg: BANNER_SVG, overlay: BANNER_RINGS, printArea: { ...BANNER }, printWidthIn: cmIn(100) }],
    cardArt: withArt('<rect x="30" y="190" width="440" height="220" fill="#e03131"/><rect x="80" y="250" width="240" height="34" rx="17" fill="#ffffff"/><rect x="80" y="304" width="170" height="16" rx="8" fill="#ffffff" opacity=".75"/><circle cx="390" cy="300" r="54" fill="#ffd43b"/>', BANNER_RINGS),
  },
  {
    id: 'tablenumbers',
    category: 'occasions',
    name: t('Table Numbers (tent cards)', 'أرقام ترابيزات (كارت ستاند)'),
    description: t('Standing tent cards for weddings, engagements and events, 15 × 10 cm on thick 350 gsm card, printed on one or both faces. Upload a list (1, 2, 3… or table names) and every card gets its own number.', 'كروت ستاند للأفراح والخطوبة والإيفنتات، 15 × 10 سم على كارت 350 جرام سميك، طباعة وش أو وشين. ارفع قائمة (1، 2، 3… أو أسامي الترابيزات) وكل كارت ياخد رقمه.'),
    basePrice: 30,
    extraSidePrice: 10,
    colorLabel: t('Paper', 'الورق'),
    colors: CARD_STOCK,
    sizes: qty([['15x10', '15 × 10 cm tent card', 'كارت ستاند 15 × 10 سم', 0]]),
    sides: [
      { id: 'front', name: FRONT, svg: tentSvg(TABLE_NO, false), printArea: { ...TABLE_NO }, printWidthIn: cmIn(15) },
      { id: 'back', name: BACK, svg: tentSvg(TABLE_NO, true), printArea: { ...TABLE_NO }, printWidthIn: cmIn(15) },
    ],
    cardArt: '<rect x="55" y="190" width="390" height="260" fill="#fff9f0"/><circle cx="250" cy="300" r="62" fill="none" stroke="#c9a227" stroke-width="6"/><rect x="236" y="262" width="28" height="76" rx="6" fill="#2b2d42"/><rect x="170" y="398" width="160" height="10" rx="5" fill="#c9a227"/>',
  },
  {
    id: 'placecards',
    category: 'occasions',
    name: t('Place Cards (tent)', 'كروت أسامي المعازيم (ستاند)'),
    description: t('Small standing name cards for wedding and event tables, 9 × 5 cm on 350 gsm card. Upload your guest list and every card is printed with one guest\'s name.', 'كروت ستاند صغيرة بأسامي المعازيم لترابيزات الفرح والإيفنتات، 9 × 5 سم على كارت 350 جرام. ارفع قائمة المعازيم ونطبع اسم كل ضيف على كارته.'),
    basePrice: 12,
    extraSidePrice: 5,
    colorLabel: t('Paper', 'الورق'),
    colors: CARD_STOCK,
    sizes: qty([['9x5', '9 × 5 cm tent card', 'كارت ستاند 9 × 5 سم', 0]]),
    sides: [
      { id: 'front', name: FRONT, svg: tentSvg(PLACE_CARD, false), printArea: { ...PLACE_CARD }, printWidthIn: cmIn(9) },
      { id: 'back', name: BACK, svg: tentSvg(PLACE_CARD, true), printArea: { ...PLACE_CARD }, printWidthIn: cmIn(9) },
    ],
    cardArt: '<rect x="52" y="200" width="396" height="220" fill="#fff9f0"/><path d="M200 250 Q250 220 300 250" fill="none" stroke="#c9a227" stroke-width="4"/><rect x="130" y="290" width="240" height="26" rx="13" fill="#2b2d42"/><rect x="190" y="340" width="120" height="10" rx="5" fill="#c9a227"/>',
  },
);

/**
 * Print production details per product:
 *   process  how it is printed; decides which file the shop should use
 *   safeIn   keep important text/graphics at least this far inside the edge
 *   bleedIn  extra artwork beyond the edge that is trimmed off (edge-to-edge products)
 *   model    shape used by the 3D preview, with real-world size in inches
 */
const PRODUCTION = {
  // Laser: thickness of the sheet or blank (inches); `laser` material names the look in 3D.
  engrplaque: { process: 'engrave', safeIn: 0.15, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.08, material: 'plastic', clear: true, base: 'wood' } },
  engrcoasters: { process: 'engrave', safeIn: 0.12, bleedIn: 0, model: { type: 'pad', depthIn: 0.2, radiusIn: 0.25, material: 'laser' } },
  engrtray: { process: 'engrave', safeIn: 0.3, bleedIn: 0, model: { type: 'tray', outerIn: [13.8, 9.84], rimIn: 1.4, wallIn: 0.4, handles: true, material: 'laser' } },
  engrframe: { process: 'engrave', safeIn: 0.15, bleedIn: 0, model: { type: 'frame', outerIn: [8.66, 11.4], windowIn: [5.12, 7.09], windowTopIn: 0.9, depthIn: 0.6, material: 'laser' } },
  engrcardholder: { process: 'engrave', safeIn: 0.1, bleedIn: 0, model: { type: 'cardholder', outerIn: [3.94, 2.76], depthIn: 0.18, material: 'laser' } },
  caketopper: { process: 'lasercut', safeIn: 0, bleedIn: 0, model: { type: 'cutout', depthIn: 0.12, scene: 'cake', material: 'laser' } },
  weddingsign: { process: 'engrave', safeIn: 0.6, bleedIn: 0, model: { type: 'block', shape: 'arch', depthIn: 0.2, radiusIn: 0.05, material: 'laser', easel: true } },
  doorsign: { process: 'engrave', safeIn: 0.3, bleedIn: 0, model: { type: 'block', depthIn: 0.24, radiusIn: 0.31, material: 'laser' } },
  ramadandecor: { process: 'lasercut', safeIn: 0, bleedIn: 0, model: { type: 'cutout', depthIn: 0.12, hang: true, material: 'laser' } },
  namepuzzle: { process: 'lasercut', safeIn: 0.25, bleedIn: 0, model: { type: 'puzzle', depthIn: 0.35, material: 'laser' } },
  tshirt: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  kidstee: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  hoodie: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  sweatshirt: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  cap: { process: 'dtf', safeIn: 0.12, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  mug: { process: 'sublimation', safeIn: 0.15, bleedIn: 0, model: { type: 'mug', diameterIn: 3.25, heightIn: 3.8, material: 'ceramic' } },
  cushion: { process: 'sublimation', safeIn: 0.4, bleedIn: 0, model: { type: 'pillow', widthIn: 16, heightIn: 16, material: 'fabric' } },
  poster: { process: 'paper', safeIn: 0.25, bleedIn: 0.125, model: { type: 'frame', material: 'paper' } },
  fabric: { process: 'textile', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'fabric' } },
  upholstery: { process: 'textile', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'fabric' } },
  bedsheet: { process: 'textile', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'fabric' } },
  duvetcover: { process: 'textile', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'fabric' } },
  curtains: { process: 'textile', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'fabric' } },
  canvas: { process: 'canvas', safeIn: 0.3, bleedIn: 1.75, model: { type: 'canvas', material: 'fabric', depthIn: 1.5 } },
  canvaswide: { process: 'canvas', safeIn: 0.3, bleedIn: 1.75, model: { type: 'canvas', material: 'fabric', depthIn: 1.5 } },
  bottle: { process: 'uv', safeIn: 0.15, bleedIn: 0, model: { type: 'bottle', diameterIn: 2.9, heightIn: 10.2, material: 'metal' } },
  tote: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  phonecase: { process: 'uv', safeIn: 0.12, bleedIn: 0.08, model: { type: 'case', material: 'plastic' } },
  mousepad: { process: 'sublimation', safeIn: 0.2, bleedIn: 0.125, model: { type: 'pad', material: 'fabric' } },
  notebook: { process: 'paper', safeIn: 0.25, bleedIn: 0.125, model: { type: 'notebook', material: 'paper' } },
  polo: { process: 'dtf', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  oversized: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  ziphoodie: { process: 'dtf', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  denim: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  apron: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  onesie: { process: 'dtg', safeIn: 0.15, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  kidshoodie: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  shorts: { process: 'dtf', safeIn: 0.15, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  jersey: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  magicmug: { process: 'sublimation', safeIn: 0.15, bleedIn: 0, model: { type: 'mug', diameterIn: 3.25, heightIn: 3.8, material: 'ceramic' } },
  couplemugs: { process: 'sublimation', safeIn: 0.15, bleedIn: 0, model: { type: 'mug', diameterIn: 3.25, heightIn: 3.8, material: 'ceramic' } },
  tumbler: { process: 'uv', safeIn: 0.15, bleedIn: 0, model: { type: 'mug', diameterIn: 2.9, heightIn: 7.6, material: 'metal', handle: false, lid: true } },
  coasters: { process: 'sublimation', safeIn: 0.15, bleedIn: 0.08, model: { type: 'pad', depthIn: 0.25, radiusIn: 0.3, edge: '#b98d5e', material: 'ceramic' } },
  tablecloth: { process: 'sublimation', safeIn: 1, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  prayermat: { process: 'sublimation', safeIn: 0.5, bleedIn: 0, model: { type: 'pad', depthIn: 0.3, radiusIn: 0.2, edge: '#efe9df', material: 'fabric' } },
  eidenvelopes: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper', plainBack: '#f6f6f4' } },
  greetingcard: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'foldcard', material: 'paper' } },
  invitations: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  certificates: { process: 'paper', safeIn: 0.3, bleedIn: 0.08, model: { type: 'block', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  plaque: { process: 'uv', safeIn: 0.15, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.05, material: 'plastic', clear: true } },
  sign: { process: 'uv', safeIn: 0.5, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.02, edge: '#f4f4f2', material: 'paper' } },
  deskmat: { process: 'sublimation', safeIn: 0.4, bleedIn: 0.125, model: { type: 'pad', depthIn: 0.12, radiusIn: 0.5, material: 'fabric' } },
  keychain: { process: 'uv', safeIn: 0.08, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.2, material: 'plastic', clear: true } },
  stickersheet: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'pad', depthIn: 0.03, radiusIn: 0.05, edge: '#f2f3f5', material: 'paper' } },
  namelabels: { process: 'paper', safeIn: 0.08, bleedIn: 0.04, model: { type: 'pad', depthIn: 0.03, radiusIn: 0.3, edge: '#f2f3f5', material: 'paper' } },
  // Real depth (gusset) so bags don't look paper-thin in 3D: lunch bag ~15 cm, pencil case ~6 cm, paper bags ~10 cm.
  // Lunch bag: an insulated soft box (piped edges, zip across the top). Pencil case: a zip pouch, puffed in the
  // middle and flat at the side seams (depthIn is its thickness at the fullest point).
  lunchbag: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric', depthIn: 5.9, closedTop: true, shape: 'softbox' } },
  pencilcase: { process: 'dtf', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'fabric', depthIn: 2.2, shape: 'pouch' } },
  bizcards: { process: 'paper', safeIn: 0.12, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  flyers: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  letterhead: { process: 'paper', safeIn: 0.25, bleedIn: 0, model: { type: 'pad', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  dlenvelopes: { process: 'paper', safeIn: 0.2, bleedIn: 0, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper', plainBack: '#f6f6f4' } },
  logostickers: { process: 'paper', safeIn: 0.08, bleedIn: 0.04, model: { type: 'pad', depthIn: 0.02, radiusIn: 99, edge: '#f2f3f5', material: 'paper' } },
  rollup: { process: 'uv', safeIn: 1, bleedIn: 0, model: { type: 'block', depthIn: 0.04, radiusIn: 0.01, edge: '#f2f2f2', material: 'paper', plainBack: '#e9eaec', stand: true } },
  paperbags: { process: 'uv', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'paper', depthIn: 3.9 } },
  invoicebook: { process: 'paper', safeIn: 0.2, bleedIn: 0, model: { type: 'block', depthIn: 0.6, radiusIn: 0.02, edge: '#eef0f2', material: 'paper' } },
  idcards: { process: 'uv', safeIn: 0.08, bleedIn: 0, model: { type: 'block', depthIn: 0.03, radiusIn: 0.12, edge: '#f4f5f7', material: 'plastic' } },
  photoprints: { process: 'paper', safeIn: 0, bleedIn: 0, model: { type: 'block', depthIn: 0.01, radiusIn: 0, edge: '#ffffff', material: 'paper' } },
  storybook: { process: 'paper', safeIn: 0.375, bleedIn: 0.125, model: { type: 'block', depthIn: 0.22, radiusIn: 0.04, edge: '#f3efe6', material: 'paper', plainBack: 'color' } },
  coloringbook: { process: 'paper', safeIn: 0.375, bleedIn: 0.125, model: { type: 'block', depthIn: 0.18, radiusIn: 0.04, edge: '#f3efe6', material: 'paper', plainBack: 'color' } },
  // Cards, business print, packaging, calendars and events (2 mm bleed on cut paper).
  postcards: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  foldedcards: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'foldcard', material: 'paper' } },
  giftvouchers: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.04, edge: '#f6f6f4', material: 'paper' } },
  bookmarks: { process: 'paper', safeIn: 0.12, bleedIn: 0.08, model: { type: 'bookmark', depthIn: 0.03, radiusIn: 0.04, edge: '#f6f6f4', material: 'paper' } },
  brochures: { process: 'paper', safeIn: 0.2, bleedIn: 0.08, model: { type: 'block', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  menus: { process: 'paper', safeIn: 0.2, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.06, edge: '#f6f6f4', material: 'paper' } },
  notepads: { process: 'paper', safeIn: 0.2, bleedIn: 0.08, model: { type: 'pad', depthIn: 0.25, radiusIn: 0.02, edge: '#f2f2ee', material: 'paper' } },
  folders: { process: 'paper', safeIn: 0.25, bleedIn: 0.12, model: { type: 'block', depthIn: 0.04, radiusIn: 0.04, edge: '#f6f6f4', material: 'paper', plainBack: '#f6f6f4' } },
  booklets: { process: 'paper', safeIn: 0.2, bleedIn: 0.08, model: { type: 'block', depthIn: 0.12, radiusIn: 0.02, edge: '#f3efe6', material: 'paper' } },
  labels: { process: 'paper', safeIn: 0.08, bleedIn: 0.04, model: { type: 'pad', depthIn: 0.02, radiusIn: 0.08, edge: '#f2f3f5', material: 'paper' } },
  wrappingpaper: { process: 'paper', safeIn: 0, bleedIn: 0, model: { type: 'cloth', material: 'paper' } },
  windowstickers: { process: 'uv', safeIn: 0.3, bleedIn: 0.08, model: { type: 'pad', depthIn: 0.02, radiusIn: 0.1, edge: '#eef1f4', material: 'plastic' } },
  calendar: { process: 'paper', safeIn: 0.25, bleedIn: 0.08, model: { type: 'wallcal', depthIn: 0.06, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper', plainBack: '#f6f6f4' } },
  deskcalendar: { process: 'paper', safeIn: 0.3, bleedIn: 0.08, model: { type: 'deskcal', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper', plainBack: '#f6f6f4' } },
  photobook: { process: 'paper', safeIn: 0.3, bleedIn: 0.125, model: { type: 'block', depthIn: 1.2, radiusIn: 0.06, edge: '#f3efe6', material: 'paper', plainBack: 'color' } },
  magnets: { process: 'paper', safeIn: 0.12, bleedIn: 0.08, model: { type: 'block', depthIn: 0.04, radiusIn: 0.2, edge: '#2b2c30', material: 'paper', plainBack: '#2b2c30' } },
  banners: { process: 'uv', safeIn: 1.2, bleedIn: 0, model: { type: 'banner', depthIn: 0.03, radiusIn: 0.01, edge: '#f2f2f2', material: 'paper', plainBack: '#e9eaec' } },
  tablenumbers: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'tent', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  placecards: { process: 'paper', safeIn: 0.1, bleedIn: 0.06, model: { type: 'tent', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
};
/** Garments can be printed either way; the shop picks per order item. */
const GARMENT_METHODS = ['dtg', 'dtf'];
const METHODS = {
  tshirt: GARMENT_METHODS, kidstee: GARMENT_METHODS, hoodie: GARMENT_METHODS, sweatshirt: GARMENT_METHODS, tote: GARMENT_METHODS,
  polo: GARMENT_METHODS, oversized: GARMENT_METHODS, ziphoodie: GARMENT_METHODS, denim: GARMENT_METHODS, apron: GARMENT_METHODS,
  onesie: GARMENT_METHODS, kidshoodie: GARMENT_METHODS, shorts: GARMENT_METHODS, cap: ['dtf'],
  jersey: ['dtf'], lunchbag: ['dtf'], pencilcase: ['dtf'],
};
for (const p of PRODUCTS) {
  const spec = PRODUCTION[p.id];
  p.process = spec.process;
  p.methods = METHODS[p.id] || [spec.process];
  p.model = spec.model;
  for (const side of p.sides) {
    side.safeIn = spec.safeIn;
    side.bleedIn = spec.bleedIn;
  }
}

// ---------- Embroidery ----------
// Garments, caps, totes and aprons can be embroidered instead of printed: a
// smaller area (left chest, cap front...), up to 6 thread colours, made into
// a DST stitch file on the server. at: 'chest' (wearer's left chest),
// 'center', 'same' (the print box is already the right size).
const EMBROIDERY = {
  tshirt: { cm: [9, 9], at: 'chest', surcharge: 150 },
  oversized: { cm: [9, 9], at: 'chest', surcharge: 150 },
  polo: { at: 'same', surcharge: 150 },
  hoodie: { cm: [9, 9], at: 'chest', surcharge: 150 },
  sweatshirt: { cm: [9, 9], at: 'chest', surcharge: 150 },
  ziphoodie: { at: 'same', surcharge: 150 },
  kidstee: { cm: [7, 7], at: 'chest', surcharge: 120 },
  kidshoodie: { cm: [7, 7], at: 'chest', surcharge: 120 },
  cap: { cm: [10, 5.5], at: 'center', surcharge: 100 },
  tote: { cm: [15, 15], at: 'center', surcharge: 180 },
  apron: { cm: [10, 10], at: 'top', surcharge: 150 },
};
/** The embroidery area on a product's first side for a spec { cm: [w, h], at, surcharge }. */
function embroideryFor(p, e) {
  const side = p.sides[0];
  const a = side.printArea;
  const upc = a.w / (side.printWidthIn * 2.54); // mockup units per cm
  let w = e.at === 'same' ? a.w : (e.cm[0] * upc);
  let h = e.at === 'same' ? a.h : (e.cm[1] * upc);
  w = Math.min(w, a.w);
  h = Math.min(h, a.h);
  let x = a.x + (a.w - w) / 2;
  let y = a.y + (a.h - h) * 0.4;
  if (e.at === 'same') [x, y] = [a.x, a.y];
  // Left chest: the print area's top is about 2.5 cm below the collar; a chest logo starts
  // about 7 cm below it (adults; 5 cm on kids' sizes), as embroidered shirts are made.
  if (e.at === 'chest') [x, y] = [a.x + a.w * 0.78 - w / 2, Math.min(a.y + (e.cm[0] >= 9 ? 4.5 : 2.5) * upc, a.y + a.h - h)];
  if (e.at === 'top') y = a.y + a.h * 0.05;
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    side: side.id,
    area: { x: r1(x), y: r1(y), w: r1(w), h: r1(h) },
    widthIn: Math.round((w / upc / 2.54) * 100) / 100,
    heightIn: Math.round((h / upc / 2.54) * 100) / 100,
    surcharge: e.surcharge,
    maxColors: e.maxColors || 6,
  };
}
for (const [pid, e] of Object.entries(EMBROIDERY)) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (p) p.embroidery = embroideryFor(p, e);
}

/** Extra charge for every printed side beyond the first. */
const EXTRA_SIDE_PRICE = scalePrice(100);
const SHIPPING_FLAT = 75;
const FREE_SHIPPING_OVER = 1500;

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Price of one printed item. `sideCount` is the number of sides that carry
 * a design. Returns null when the size is unknown.
 */
// Garment sizes in the preview: the print is the same physical size on every
// size, so it covers more of a small garment than of a big one. chestCm is
// the half-chest width of each size; photoChestCm the size the product photo
// shows. The editor scales the print box by photoChestCm / chestCm.
const CHILD_CHEST = {
  kidstee: { '2-4': 30, '4-6': 33, '6-8': 36, '8-10': 39, '10-12': 42 },
  kidshoodie: { '4-6': 34, '6-8': 37, '8-10': 40, '10-12': 43 },
  onesie: { '0-3': 21, '3-6': 23, '6-12': 25, '12-18': 27 },
  jersey: { kids: 42 },
};
const PHOTO_CHEST = { kidstee: 36, kidshoodie: 38, onesie: 24 };
for (const p of PRODUCTS) {
  if (p.category !== 'apparel' || p.sizes.length < 2) continue;
  const kids = CHILD_CHEST[p.id] || {};
  p.sizes = p.sizes.map((sz) => (kids[sz.id] ? { ...sz, chestCm: kids[sz.id] } : sz));
  if (p.sizes.every((sz) => sz.chestCm)) p.photoChestCm = PHOTO_CHEST[p.id] || 52;
}

// Name lists (variable data): one design, a spreadsheet of names, one printed copy per row.
// Garments too: team kits with each player's name and number (a Size column gives each row its size).
// Business cards: one pack (100, 250… cards) per row, each with its person's name, position, phone, email…
// Name lists (Excel / CSV): paper and label products only, as the owner chose (not clothing).
// Table numbers and place cards: one card per row (table number / guest name).
const MERGE_PRODUCTS = ['invitations', 'certificates', 'greetingcard', 'idcards', 'bizcards', 'namelabels', 'stickersheet', 'flyers', 'tablenumbers', 'placecards'];
for (const p of PRODUCTS) if (MERGE_PRODUCTS.includes(p.id)) p.merge = { maxRows: 1000 };

// Sizes that change the physical print (the drawing area keeps its shape):
// printScale multiplies the side's printWidthIn (and height) for that size.
const SIZE_PRINT_SCALE = {
  poster: { '30x40': 30 / 45 },
  canvas: { '40x60': 4 / 3, '60x90': 2 },
  canvaswide: { '40x60': 4 / 3, '60x90': 2 },
  cushion: { 50: 50 / 40 },
  greetingcard: { A5: 14.8 / 10.5 },
  certificates: { A3: 42 / 29.7 },
  plaque: { '18x25': 18 / 13 },
  engrplaque: { '18x25': 18 / 13 },
  engrtray: { '45x32': 45 / 35 },
  engrframe: { '20x25': 20 / 13 },
  caketopper: { 20: 20 / 15 },
  weddingsign: { '50x75': 50 / 40 },
  doorsign: { '40x20': 40 / 30 },
  ramadandecor: { 35: 35 / 25 },
  namepuzzle: { '45x15': 45 / 30 },
  sign: { A1: 59.4 / 42 },
  stickersheet: { A4: 21 / 14.8 },
  flyers: { 'A5-100': 14.8 / 21, 'A5-500': 14.8 / 21, 'A5-1000': 14.8 / 21 },
  mug: { '15oz': 1.12 },
  menus: { 'A3-1': 29.7 / 21, 'A3-10': 29.7 / 21, 'A3-25': 29.7 / 21 },
  notepads: { 'A6-1': 10.5 / 14.8, 'A6-5': 10.5 / 14.8, 'A6-10': 10.5 / 14.8 },
  labels: { '75x45-100': 1.5, '75x45-250': 1.5, '75x45-500': 1.5, '100x60-100': 2, '100x60-250': 2, '100x60-500': 2 },
  windowstickers: { 30: 30 / 20, 50: 50 / 20, 70: 70 / 20 },
  photobook: { 200: 24 / 20 },
  magnets: { '80x120-1': 8 / 6, '80x120-100': 8 / 6, '100x150-1': 10 / 6, '100x150-100': 10 / 6 },
  banners: { '150x75': 1.5, '200x100': 2 },
  // Phone models are different sizes (back of the phone, w × h mm): iPhone 16 71.6 × 147.6 is the reference.
  phonecase: { iphone16pro: 1.006, iphone16promax: 1.094, galaxys25: 0.99, galaxya55: 1.086 },
};
for (const [pid, sizes] of Object.entries(SIZE_PRINT_SCALE)) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (p) p.sizes = p.sizes.map((sz) => (sizes[sz.id] ? { ...sz, printScale: Math.round(sizes[sz.id] * 10000) / 10000 } : sz));
}
// Paper sizes that are not exactly the drawing area's shape scaled (A6 is 10.5 × 14.8 cm,
// A5 scaled down to 10.5 cm wide would be 14.9 cm high): the real trim height, in cm.
// printHeightFor() gives it; the artwork is fitted to it (well within the bleed).
const SIZE_PRINT_HEIGHT_CM = {
  notepads: { 'A6-1': 14.8, 'A6-5': 14.8, 'A6-10': 14.8 },
};
for (const [pid, sizes] of Object.entries(SIZE_PRINT_HEIGHT_CM)) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (p) p.sizes = p.sizes.map((sz) => (sizes[sz.id] ? { ...sz, printHeightCm: sizes[sz.id] } : sz));
}
// One artwork, many pieces: can one design be ordered in several colours / sizes?
// Only when every colour and size uses the same print file: not where a bigger
// size is a bigger print (posters, mugs...), not canvas prints (the "colour" is
// the edge, which is part of the print), not fabric by the metre, not books.
for (const p of PRODUCTS) {
  const plain = !p.pattern && !p.kind;
  p.mix = {
    colors: plain && p.colors.length > 1 && !(p.model && p.model.type === 'canvas'),
    sizes: plain && p.sizes.length > 1 && !p.sizes.some((sz) => sz.printScale),
  };
  // Laser: the design is drawn in each material's own tone, so one design is one material.
  if (p.laser) p.mix.colors = false;
  // Booklets: the size is the page count ("8-50" = 8 pages × 50 copies) and the design has
  // exactly those pages, so one design is one size (an 8-page design can't print as 32 pages).
  if (p.paged) p.mix.sizes = false;
}

/** Text compared loosely: case, spaces, dashes and Arabic letter forms don't matter. */
const loose = (v) => String(v == null ? '' : v)
  .toLowerCase()
  .replace(/[\u064b-\u0652\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[\s\-–—_.()]+/g, '');
/** The product size a customer typed in a list ("XL", "xl", "8-10", "8–10 yrs"...), or null. */
function matchSize(product, value) {
  const v = loose(value);
  if (!v) return null;
  return product.sizes.find((sz) => [sz.id, sz.label.en, sz.label.ar].some((x) => loose(x) === v))
    || product.sizes.find((sz) => [sz.label.en, sz.label.ar].some((x) => loose(x).startsWith(v) && v.length >= 2))
    || null;
}
/** The product colour a customer typed ("Black", "اسود", "navy"...), or null. */
function matchColor(product, value) {
  const v = loose(value);
  if (!v) return null;
  return product.colors.find((c) => [c.id, c.name.en, c.name.ar].some((x) => loose(x) === v)) || null;
}
/** Which list columns give each row's size and colour (by their title). */
const SIZE_TITLES = ['size', 'sizes', 'مقاس', 'المقاس', 'المقاسات', 'مقاسات'];
const COLOR_TITLES = ['color', 'colour', 'لون', 'اللون'];
function variantColumns(columns) {
  const find = (titles) => columns.findIndex((c) => titles.includes(loose(c)));
  return { size: find(SIZE_TITLES), color: find(COLOR_TITLES) };
}

/** A side's physical print width in inches for a size. */
function printWidthFor(product, side, sizeId) {
  const size = product.sizes.find((z) => z.id === sizeId);
  return Math.round(side.printWidthIn * ((size && size.printScale) || 1) * 1000) / 1000;
}

/** A side's physical print height in inches for a size (the size's own trim height where it has one). */
function printHeightFor(product, side, sizeId) {
  const size = product.sizes.find((z) => z.id === sizeId);
  if (size && size.printHeightCm) return Math.round((size.printHeightCm / 2.54) * 1000) / 1000;
  const a = side.printArea;
  return Math.round(((side.printWidthIn * a.h) / a.w) * ((size && size.printScale) || 1) * 1000) / 1000;
}

/** The print area for a size (same physical print, so smaller on the screen for bigger garments), top edge kept below the collar. */
function printAreaFor(product, sideId, sizeId) {
  const side = product.sides.find((s) => s.id === sideId);
  const a = side.printArea;
  const size = product.sizes.find((s) => s.id === sizeId);
  const f = product.photoChestCm && size && size.chestCm ? product.photoChestCm / size.chestCm : 1;
  if (f === 1) return a;
  const w = Math.round(a.w * f * 10) / 10;
  const h = Math.round(a.h * f * 10) / 10;
  return { ...a, x: Math.round((a.x + a.w / 2 - w / 2) * 10) / 10, y: a.y, w, h, ...(a.rx ? { rx: a.rx * f } : {}) };
}

// Garments and bags: the customer can move the print area within this zone
// (mockup units, checked against the product photos). Rules: the top stays at
// least 2.5 cm below the collar / neck / hood seam (and the tote's top hem),
// the bottom at least 2.5 cm above the hem, waistband or leg binding, and the
// sides about 1 cm clear of armhole / side / raglan / panel seams, plackets,
// zips and pockets. Where a standard printArea itself sits closer than that
// (e.g. tshirt front, oversized front, hoodie fronts, jersey front, tote) the
// zone starts at the standard area so it stays allowed.
const MOVE_ZONES = {
  'tshirt:front': { x: 126, y: 140, w: 248, h: 357 },
  'tshirt:back': { x: 124, y: 111, w: 252, h: 379 },
  'kidstee:front': { x: 123, y: 137, w: 256, h: 417 },
  'kidstee:back': { x: 119, y: 150, w: 261, h: 399 },
  'hoodie:front': { x: 156, y: 175, w: 191, h: 230 },
  'hoodie:back': { x: 107, y: 180, w: 286, h: 346 },
  'sweatshirt:front': { x: 115, y: 126, w: 270, h: 370 },
  'sweatshirt:back': { x: 119, y: 131, w: 264, h: 355 },
  'polo:front': { x: 268, y: 150, w: 88, h: 237 },
  'polo:back': { x: 147, y: 115, w: 206, h: 338 },
  'oversized:front': { x: 141, y: 140, w: 218, h: 281 },
  'ziphoodie:front': { x: 272, y: 165, w: 88, h: 150 },
  'ziphoodie:back': { x: 124, y: 180, w: 250, h: 299 },
  'denim:back': { x: 160, y: 226, w: 181, h: 217 },
  'onesie:front': { x: 190, y: 188, w: 120, h: 167 },
  'kidshoodie:front': { x: 173, y: 200, w: 155, h: 190 },
  'kidshoodie:back': { x: 147, y: 200, w: 206, h: 255 },
  'shorts:front': { x: 264, y: 273, w: 89, h: 116 },
  'jersey:front': { x: 153, y: 150, w: 194, h: 337 },
  'jersey:back': { x: 132, y: 101, w: 234, h: 416 },
  'tote:front': { x: 135, y: 260, w: 230, h: 260 },
  'tote:back': { x: 135, y: 260, w: 230, h: 260 },
};
for (const [key, zone] of Object.entries(MOVE_ZONES)) {
  const [pid, sid] = key.split(':');
  const side = PRODUCTS.find((p) => p.id === pid)?.sides.find((s) => s.id === sid);
  if (side) side.moveZone = zone;
}

/**
 * Product options (e.g. business-card lamination): { optionId: choiceId } -> the choices
 * kept on a design ({ lamination: { id, name } }), or null for "none / the first choice".
 * Unknown options or choices are refused (null + error).
 */
function cleanOptions(product, raw) {
  if (!product.options || !raw || typeof raw !== 'object') return { options: null };
  const out = {};
  for (const opt of product.options) {
    const want = raw[opt.id];
    if (want == null || want === '') continue;
    const choice = opt.choices.find((c) => c.id === String(want));
    if (!choice) return { error: true };
    if (choice === opt.choices[0] && !opt.keepDefault) continue; // the default (no lamination) isn't kept
    out[opt.id] = { id: choice.id, name: choice.name, optionName: opt.name };
  }
  return { options: Object.keys(out).length ? out : null };
}
/** What the chosen options add to one piece (one pack) of a size. */
function optionsPrice(product, options, sizeId) {
  if (!product.options || !options) return 0;
  let sum = 0;
  for (const opt of product.options) {
    const chosen = options[opt.id];
    const choice = chosen && opt.choices.find((c) => c.id === chosen.id);
    if (!choice) continue;
    sum += typeof choice.price === 'number' ? choice.price : (choice.price && choice.price[sizeId]) || 0;
  }
  return sum;
}

// ---------- Selling prices ----------
// The prices written above are the selling prices. PRICE_FACTOR (environment) scales them all,
// each rounded to the nearest 10 EGP, e.g. 0.5 for a half-price sale. Prices the owner changes
// in the admin (Accounts -> Prices) are laid over these and are not scaled.
function scalePrice(v) {
  const f = PRICE_FACTOR();
  if (!v || f === 1) return v;
  return Math.max(10, Math.round((v * f) / 10) * 10);
}
for (const p of PRODUCTS) {
  const listBase = p.basePrice;
  p.basePrice = scalePrice(p.basePrice);
  if (p.extraSidePrice != null) p.extraSidePrice = scalePrice(p.extraSidePrice);
  // Packs below the base (1, 10, 25 copies…): their own price is scaled, so they stay cheaper than the
  // base pack and never free (scaling the amount off would make it +10 EGP: QA 25 Nov).
  p.sizes = p.sizes.map((s) => (s.surcharge < 0 ? { ...s, surcharge: scalePrice(listBase + s.surcharge) - p.basePrice } : s.surcharge ? { ...s, surcharge: scalePrice(s.surcharge) } : s));
  if (p.embroidery) p.embroidery.surcharge = scalePrice(p.embroidery.surcharge);
  for (const o of p.options || []) {
    for (const c of o.choices) {
      c.price = typeof c.price === 'number' ? scalePrice(c.price) : Object.fromEntries(Object.entries(c.price || {}).map(([k, v]) => [k, scalePrice(v)]));
    }
  }
}

function priceFor(product, sizeId, sideCount) {
  const size = product.sizes.find((s) => s.id === sizeId);
  if (!size) return null;
  const extraSides = Math.max(0, sideCount - 1);
  const perSide = product.extraSidePrice != null ? product.extraSidePrice : EXTRA_SIDE_PRICE;
  return round2(product.basePrice + size.surcharge + extraSides * perSide);
}

function shippingFor(subtotal) {
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FLAT;
}

/*
 * Delivery speed, chosen at checkout. Standard: within 5 business days. Express: within 2,
 * for a flat fee on top of shipping (charged even when shipping is free). Business days are
 * Sunday to Thursday in Egypt (Friday and Saturday off), counted from the day after the order.
 * EXPRESS_FEE in the environment changes the fee (EGP, not scaled by PRICE_FACTOR).
 */
const DELIVERY_DAYS = { standard: 5, express: 2 };
function expressFee() {
  const f = Number(process.env.EXPRESS_FEE);
  return Number.isFinite(f) && f >= 0 ? round2(f) : 100;
}
/** The Cairo calendar day `n` business days after `from` (YYYY-MM-DD). */
function businessDaysAfter(from, n) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(from));
  const d = new Date(parts + 'T12:00:00Z');
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 5 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
/** { speed, days, fee, by } for 'standard' (default) or 'express', for an order placed at `at`. */
function deliveryFor(speed, at = new Date()) {
  const s = speed === 'express' ? 'express' : 'standard';
  const days = DELIVERY_DAYS[s];
  return { speed: s, days, fee: s === 'express' ? expressFee() : 0, by: businessDaysAfter(at, days) };
}

// Booklets: each size says how many pages are printed ("16-50" = 16 pages × 50 copies).
for (const p of PRODUCTS) if (p.paged) for (const z of p.sizes) z.pages = Math.max(4, Math.min(p.sides.length, Number(String(z.id).split('-')[0]) || 4));
/**
 * The pages a booklet of this size prints, in reading order: the front cover, the
 * inside pages, the back cover (other products: all their sides).
 */
function pageSides(product, sizeId) {
  if (!product.paged) return product.sides;
  const size = product.sizes.find((z) => z.id === sizeId) || product.sizes[0];
  const n = size.pages || product.sides.length;
  return [product.sides[0], ...product.sides.slice(1, n - 1), product.sides[product.sides.length - 1]];
}

module.exports = {
  PRODUCTS,
  EMBROIDERY,
  embroideryFor,
  scalePrice,
  pageSides,
  matchSize,
  matchColor,
  variantColumns,
  REPEATS,
  printAreaFor,
  printHeightFor,
  printWidthFor,
  CATEGORIES,
  CURRENCY,
  MOCKUP_WIDTH,
  MOCKUP_HEIGHT,
  EXTRA_SIDE_PRICE,
  SHIPPING_FLAT,
  FREE_SHIPPING_OVER,
  getProduct,
  priceFor,
  cleanOptions,
  optionsPrice,
  shippingFor,
  DELIVERY_DAYS,
  expressFee,
  deliveryFor,
  businessDaysAfter,
  round2,
};
