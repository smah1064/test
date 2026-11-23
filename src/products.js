'use strict';

/**
 * Product catalog.
 *
 * Every mockup is drawn in a 500 x 600 coordinate space. SVG templates use
 * placeholders that the client fills in for the chosen product colour:
 *   {{C}} main colour, {{S}} shade (folds, inner parts), {{L}} outline.
 *
 * printArea is the printable rectangle in mockup coordinates and
 * printWidthIn is its physical width in inches; the physical height follows
 * from the rectangle's aspect ratio.
 */

const MOCKUP_WIDTH = 500;
const MOCKUP_HEIGHT = 600;

const APPAREL_SIZES = [
  { id: 'S', label: 'S', surcharge: 0 },
  { id: 'M', label: 'M', surcharge: 0 },
  { id: 'L', label: 'L', surcharge: 0 },
  { id: 'XL', label: 'XL', surcharge: 0 },
  { id: '2XL', label: '2XL', surcharge: 2 },
  { id: '3XL', label: '3XL', surcharge: 3 },
];

const TEE_BODY =
  '<path d="M150 88 L205 66 Q250 96 295 66 L350 88 L452 150 L412 246 L370 226 L372 548 Q250 562 128 548 L130 226 L88 246 L48 150 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M150 88 Q140 160 130 226 M350 88 Q360 160 370 226" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>' +
  '<path d="M60 160 L95 175 M440 160 L405 175" stroke="{{S}}" stroke-width="6" opacity=".6"/>' +
  '<path d="M140 520 Q250 534 362 520" fill="none" stroke="{{S}}" stroke-width="5" opacity=".5"/>';

const HOODIE_BODY =
  '<path d="M140 118 L198 96 Q250 150 302 96 L360 118 L444 330 L402 348 L362 250 L362 548 L138 548 L138 250 L98 348 L56 330 Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
  '<rect x="138" y="520" width="224" height="28" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<path d="M56 330 L98 348 L94 360 L52 342 Z M444 330 L402 348 L406 360 L448 342 Z" fill="{{S}}" stroke="{{L}}" stroke-width="2"/>' +
  '<path d="M140 118 Q146 190 138 250 M360 118 Q354 190 362 250" fill="none" stroke="{{L}}" stroke-width="2" opacity=".55"/>';

const sv = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCKUP_WIDTH}" height="${MOCKUP_HEIGHT}" viewBox="0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}">${inner}</svg>`;

const PRODUCTS = [
  {
    id: 'tshirt',
    name: 'Classic T-Shirt',
    description: '100% combed cotton, regular fit. Direct-to-garment printed.',
    basePrice: 19.99,
    colors: [
      { id: 'white', name: 'White', hex: '#ffffff' },
      { id: 'black', name: 'Black', hex: '#1f2023' },
      { id: 'heather', name: 'Heather Grey', hex: '#b9bcc2' },
      { id: 'navy', name: 'Navy', hex: '#1f2f54' },
      { id: 'red', name: 'Red', hex: '#c8322f' },
      { id: 'forest', name: 'Forest', hex: '#2f5d43' },
      { id: 'sand', name: 'Sand', hex: '#e6d5b8' },
    ],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: 'Front',
        svg: sv(
          TEE_BODY +
            '<path d="M205 66 Q250 120 295 66 Q250 86 205 66 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M199 70 Q250 132 301 70" fill="none" stroke="{{L}}" stroke-width="2" opacity=".5"/>'
        ),
        printArea: { x: 165, y: 140, w: 171, h: 228 },
        printWidthIn: 12,
      },
      {
        id: 'back',
        name: 'Back',
        svg: sv(
          TEE_BODY +
            '<path d="M205 66 Q250 84 295 66" fill="none" stroke="{{L}}" stroke-width="3"/>' +
            '<path d="M201 72 Q250 92 299 72" fill="none" stroke="{{L}}" stroke-width="2" opacity=".5"/>'
        ),
        printArea: { x: 165, y: 120, w: 171, h: 228 },
        printWidthIn: 12,
      },
    ],
  },
  {
    id: 'hoodie',
    name: 'Pullover Hoodie',
    description: 'Mid-weight fleece with kangaroo pocket and drawstring hood.',
    basePrice: 39.99,
    colors: [
      { id: 'black', name: 'Black', hex: '#1f2023' },
      { id: 'heather', name: 'Heather Grey', hex: '#a9adb4' },
      { id: 'navy', name: 'Navy', hex: '#22304f' },
      { id: 'maroon', name: 'Maroon', hex: '#6b2232' },
      { id: 'olive', name: 'Olive', hex: '#5c6440' },
      { id: 'cream', name: 'Cream', hex: '#efe6d2' },
    ],
    sizes: APPAREL_SIZES,
    sides: [
      {
        id: 'front',
        name: 'Front',
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
        name: 'Back',
        svg: sv(
          HOODIE_BODY +
            '<path d="M178 104 Q250 182 322 104 Q250 54 178 104 Z" fill="{{S}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>'
        ),
        printArea: { x: 165, y: 195, w: 171, h: 228 },
        printWidthIn: 12,
      },
    ],
  },
  {
    id: 'mug',
    name: 'Ceramic Mug',
    description: 'Glossy ceramic, dishwasher and microwave safe.',
    basePrice: 14.99,
    colors: [
      { id: 'white', name: 'White', hex: '#ffffff' },
      { id: 'black', name: 'Black', hex: '#202124' },
      { id: 'sky', name: 'Sky Blue', hex: '#9cc7e8' },
      { id: 'blush', name: 'Blush', hex: '#f2c6c2' },
    ],
    sizes: [
      { id: '11oz', label: '11 oz', surcharge: 0 },
      { id: '15oz', label: '15 oz', surcharge: 3 },
    ],
    sides: [
      {
        id: 'front',
        name: 'Front',
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
    id: 'tote',
    name: 'Canvas Tote Bag',
    description: 'Heavy 12 oz cotton canvas with reinforced handles.',
    basePrice: 17.99,
    colors: [
      { id: 'natural', name: 'Natural', hex: '#efe4cc' },
      { id: 'black', name: 'Black', hex: '#222326' },
      { id: 'navy', name: 'Navy', hex: '#24324f' },
    ],
    sizes: [{ id: 'one', label: 'One size', surcharge: 0 }],
    sides: ['front', 'back'].map((id) => ({
      id,
      name: id === 'front' ? 'Front' : 'Back',
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
    id: 'poster',
    name: 'Framed Poster',
    description: 'Archival matte paper, ready-to-hang frame.',
    basePrice: 24.99,
    // The print goes on white paper, not on the frame colour.
    surface: '#ffffff',
    colors: [
      { id: 'black', name: 'Black frame', hex: '#1d1d1f' },
      { id: 'white', name: 'White frame', hex: '#f6f6f4' },
      { id: 'oak', name: 'Oak frame', hex: '#b9895a' },
      { id: 'walnut', name: 'Walnut frame', hex: '#5b3b26' },
    ],
    sizes: [
      { id: '12x16', label: '12 × 16 in', surcharge: 0 },
      { id: '18x24', label: '18 × 24 in', surcharge: 10 },
    ],
    sides: [
      {
        id: 'front',
        name: 'Front',
        svg: sv(
          '<rect x="88" y="90" width="340" height="440" fill="#000" opacity=".12"/>' +
            '<rect x="80" y="80" width="340" height="440" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>' +
            '<rect x="100" y="100" width="300" height="400" fill="#ffffff" stroke="{{S}}" stroke-width="2"/>'
        ),
        printArea: { x: 100, y: 100, w: 300, h: 400 },
        printWidthIn: 18,
      },
    ],
  },
  {
    id: 'phonecase',
    name: 'Slim Phone Case',
    description: 'Impact-resistant polycarbonate shell with a glossy finish.',
    basePrice: 22.99,
    colors: [
      { id: 'clear', name: 'Frost', hex: '#e9edf1' },
      { id: 'black', name: 'Black', hex: '#202124' },
      { id: 'lilac', name: 'Lilac', hex: '#cdbfe6' },
    ],
    sizes: [
      { id: 'iphone16', label: 'iPhone 16', surcharge: 0 },
      { id: 'iphone16pro', label: 'iPhone 16 Pro', surcharge: 0 },
      { id: 'galaxys25', label: 'Galaxy S25', surcharge: 0 },
    ],
    sides: [
      {
        id: 'back',
        name: 'Back',
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
];

/** Extra charge for every printed side beyond the first. */
const EXTRA_SIDE_PRICE = 6;
const SHIPPING_FLAT = 4.99;
const FREE_SHIPPING_OVER = 75;

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
