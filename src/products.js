'use strict';

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
  { id: 'S', label: t('S', 'S'), surcharge: 0 },
  { id: 'M', label: t('M', 'M'), surcharge: 0 },
  { id: 'L', label: t('L', 'L'), surcharge: 0 },
  { id: 'XL', label: t('XL', 'XL'), surcharge: 0 },
  { id: '2XL', label: t('2XL', '2XL'), surcharge: 50 },
  { id: '3XL', label: t('3XL', '3XL'), surcharge: 75 },
];

const FRONT = t('Front', 'الأمام');
const BACK = t('Back', 'الخلف');

const sv = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCKUP_WIDTH}" height="${MOCKUP_HEIGHT}" viewBox="0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}">${inner}</svg>`;

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
    description: t('Glossy ceramic, dishwasher and microwave safe.', 'سيراميك لامع، آمن في غسالة الأطباق والميكروويف.'),
    basePrice: 250,
    colors: [{ ...C.white }, { ...C.black, hex: '#202124' }, C.sky, C.blush],
    sizes: [
      { id: '11oz', label: t('11 oz (325 ml)', '325 مل'), surcharge: 0 },
      { id: '15oz', label: t('15 oz (440 ml)', '440 مل'), surcharge: 60 },
    ],
    sides: [
      {
        id: 'front',
        name: FRONT,
        svg: sv(
          '<ellipse cx="236" cy="482" rx="140" ry="18" fill="#000" opacity=".08"/>' +
            '<path d="M340 205 Q428 205 428 300 Q428 395 340 395 L340 360 Q394 360 394 300 Q394 240 340 240 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M120 150 L340 150 L340 468 Q230 490 120 468 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<ellipse cx="230" cy="150" rx="110" ry="18" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>'
        ),
        overlay: sv(
          '<path d="M134 172 L150 174 L150 462 L134 458 Z" fill="#fff" opacity=".28"/>' +
            '<path d="M312 174 L326 172 L326 458 L312 462 Z" fill="#000" opacity=".06"/>'
        ),
        printArea: { x: 146, y: 225, w: 168, h: 147 },
        printWidthIn: 4,
      },
    ],
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
const MUG_SVG = sv(
  '<ellipse cx="236" cy="482" rx="140" ry="18" fill="#000" opacity=".08"/>' +
    '<path d="M340 205 Q428 205 428 300 Q428 395 340 395 L340 360 Q394 360 394 300 Q394 240 340 240 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M120 150 L340 150 L340 468 Q230 490 120 468 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
    '<ellipse cx="230" cy="150" rx="110" ry="18" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>'
);
const MUG_AREA = { x: 146, y: 225, w: 168, h: 147 };

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
    sides: [{ id: 'front', name: FRONT, svg: MUG_SVG, printArea: { ...MUG_AREA }, printWidthIn: 4 }],
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
      { id: 'mug1', name: t('Mug 1', 'المج الأول'), svg: MUG_SVG, printArea: { ...MUG_AREA }, printWidthIn: 4 },
      { id: 'mug2', name: t('Mug 2', 'المج الثاني'), svg: MUG_SVG, printArea: { ...MUG_AREA }, printWidthIn: 4 },
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
    id: 'plaque',
    category: 'occasions',
    name: t('Acrylic Photo Plaque', 'بلاك أكريليك للصور'),
    description: t('Thick crystal-clear acrylic block that stands on its own. For weddings, graduation and memories.', 'بلوك أكريليك شفاف وسميك بيقف لوحده. للأفراح والتخرج والذكريات.'),
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
const qty = (rows) => rows.map(([id, en, ar, surcharge]) => ({ id, label: t(en, ar), surcharge }));
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
    colors: PAPER_FINISH,
    sizes: qty([['100', '100 cards', '100 كارت', 0], ['250', '250 cards', '250 كارت', 120], ['500', '500 cards', '500 كارت', 250], ['1000', '1000 cards', '1000 كارت', 450]]),
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
    description: t('Your child is the hero: their face in every picture, their name, family and favourites in the story. 12 pages in English, 20 × 20 cm.', 'طفلك بطل الحكاية: وشه في كل صورة، واسمه وعيلته وحاجاته المفضلة في القصة. 12 صفحة باللغة الإنجليزية، 20 × 20 سم.'),
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
    description: t("Your child's photo turned into drawings: 13 dream jobs to colour, from astronaut to chef. 16 pages in English, 20 × 20 cm.", 'صورة طفلك بتتحول لرسومات: 13 مهنة يحلم بيها يلوّنها، من رائد الفضاء للشيف. 16 صفحة باللغة الإنجليزية، 20 × 20 سم.'),
    basePrice: 300,
    colors: [{ id: 'std', name: t('Colour cover, line-art pages', 'غلاف ملون وصفحات للتلوين'), hex: '#ff8a3d' }],
    sizes: [
      { id: 'soft', label: t('Softcover', 'غلاف عادي'), surcharge: 0 },
      { id: 'hard', label: t('Hardcover', 'غلاف مقوّى'), surcharge: 150 },
    ],
    sides: [BOOK_SIDE('#ff8a3d')],
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
  tshirt: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  kidstee: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  hoodie: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  sweatshirt: { process: 'dtg', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  cap: { process: 'dtf', safeIn: 0.12, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  mug: { process: 'sublimation', safeIn: 0.15, bleedIn: 0, model: { type: 'mug', diameterIn: 3.25, heightIn: 3.8, material: 'ceramic' } },
  cushion: { process: 'sublimation', safeIn: 0.4, bleedIn: 0, model: { type: 'pillow', widthIn: 16, heightIn: 16, material: 'fabric' } },
  poster: { process: 'paper', safeIn: 0.25, bleedIn: 0.125, model: { type: 'frame', material: 'paper' } },
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
  eidenvelopes: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'card', material: 'paper' } },
  greetingcard: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'card', material: 'paper' } },
  plaque: { process: 'uv', safeIn: 0.15, bleedIn: 0, model: { type: 'block', depthIn: 0.8, radiusIn: 0.05, material: 'plastic', clear: true } },
  sign: { process: 'uv', safeIn: 0.5, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.02, edge: '#f4f4f2', material: 'paper' } },
  deskmat: { process: 'sublimation', safeIn: 0.4, bleedIn: 0.125, model: { type: 'pad', depthIn: 0.12, radiusIn: 0.5, material: 'fabric' } },
  keychain: { process: 'uv', safeIn: 0.08, bleedIn: 0, model: { type: 'block', depthIn: 0.2, radiusIn: 0.2, material: 'plastic', clear: true } },
  stickersheet: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'pad', depthIn: 0.03, radiusIn: 0.05, edge: '#f2f3f5', material: 'paper' } },
  namelabels: { process: 'paper', safeIn: 0.08, bleedIn: 0.04, model: { type: 'pad', depthIn: 0.03, radiusIn: 0.3, edge: '#f2f3f5', material: 'paper' } },
  lunchbag: { process: 'dtf', safeIn: 0.25, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  pencilcase: { process: 'dtf', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'fabric' } },
  bizcards: { process: 'paper', safeIn: 0.12, bleedIn: 0.08, model: { type: 'block', depthIn: 0.03, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  flyers: { process: 'paper', safeIn: 0.15, bleedIn: 0.08, model: { type: 'block', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  letterhead: { process: 'paper', safeIn: 0.25, bleedIn: 0, model: { type: 'pad', depthIn: 0.02, radiusIn: 0.02, edge: '#f6f6f4', material: 'paper' } },
  dlenvelopes: { process: 'paper', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'paper' } },
  logostickers: { process: 'paper', safeIn: 0.08, bleedIn: 0.04, model: { type: 'pad', depthIn: 0.02, radiusIn: 99, edge: '#f2f3f5', material: 'paper' } },
  rollup: { process: 'uv', safeIn: 1, bleedIn: 0, model: { type: 'card', material: 'paper' } },
  paperbags: { process: 'uv', safeIn: 0.2, bleedIn: 0, model: { type: 'card', material: 'paper' } },
  invoicebook: { process: 'paper', safeIn: 0.2, bleedIn: 0, model: { type: 'block', depthIn: 0.6, radiusIn: 0.02, edge: '#eef0f2', material: 'paper' } },
  idcards: { process: 'uv', safeIn: 0.08, bleedIn: 0, model: { type: 'block', depthIn: 0.03, radiusIn: 0.12, edge: '#f4f5f7', material: 'plastic' } },
  storybook: { process: 'paper', safeIn: 0.375, bleedIn: 0.125, model: { type: 'card', material: 'paper' } },
  coloringbook: { process: 'paper', safeIn: 0.375, bleedIn: 0.125, model: { type: 'card', material: 'paper' } },
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

/** Extra charge for every printed side beyond the first. */
const EXTRA_SIDE_PRICE = 100;
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
// Garments and bags: the customer can move the print area within this zone
// (mockup units; measured from the product photos, kept clear of collars,
// hems, zips, plackets and pockets).
const MOVE_ZONES = {
  'tshirt:front': { x: 114, y: 100, w: 271, h: 397 },
  'tshirt:back': { x: 118, y: 93, w: 264, h: 397 },
  'kidstee:front': { x: 107, y: 114, w: 286, h: 440 },
  'kidstee:back': { x: 110, y: 126, w: 279, h: 423 },
  'hoodie:front': { x: 156, y: 166, w: 191, h: 239 },
  'hoodie:back': { x: 105, y: 165, w: 291, h: 361 },
  'sweatshirt:front': { x: 94, y: 112, w: 313, h: 392 },
  'sweatshirt:back': { x: 119, y: 116, w: 264, h: 376 },
  'polo:front': { x: 266, y: 120, w: 123, h: 267 },
  'polo:back': { x: 139, y: 115, w: 220, h: 338 },
  'oversized:front': { x: 133, y: 125, w: 235, h: 296 },
  'ziphoodie:front': { x: 272, y: 132, w: 120, h: 183 },
  'ziphoodie:back': { x: 108, y: 175, w: 282, h: 312 },
  'denim:back': { x: 103, y: 170, w: 294, h: 280 },
  'onesie:front': { x: 178, y: 151, w: 142, h: 211 },
  'kidshoodie:front': { x: 173, y: 192, w: 155, h: 198 },
  'kidshoodie:back': { x: 132, y: 196, w: 235, h: 262 },
  'shorts:front': { x: 264, y: 249, w: 100, h: 144 },
  'jersey:front': { x: 115, y: 98, w: 265, h: 389 },
  'jersey:back': { x: 112, y: 101, w: 272, h: 416 },
  'tote:front': { x: 135, y: 252, w: 230, h: 268 },
  'tote:back': { x: 135, y: 252, w: 230, h: 268 },
};
for (const [key, zone] of Object.entries(MOVE_ZONES)) {
  const [pid, sid] = key.split(':');
  const side = PRODUCTS.find((p) => p.id === pid)?.sides.find((s) => s.id === sid);
  if (side) side.moveZone = zone;
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

module.exports = {
  PRODUCTS,
  CATEGORIES,
  CURRENCY,
  MOCKUP_WIDTH,
  MOCKUP_HEIGHT,
  EXTRA_SIDE_PRICE,
  SHIPPING_FLAT,
  FREE_SHIPPING_OVER,
  getProduct,
  priceFor,
  shippingFor,
  round2,
};
