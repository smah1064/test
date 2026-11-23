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
function priceFor(product, sizeId, sideCount) {
  const size = product.sizes.find((s) => s.id === sizeId);
  if (!size) return null;
  const extraSides = Math.max(0, sideCount - 1);
  return round2(product.basePrice + size.surcharge + extraSides * EXTRA_SIDE_PRICE);
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
