'use strict';

/*
 * Ready-made designs shop.
 *
 * Starter designs are written here as layouts of text, shapes and stickers in
 * fractions of the print area (the same format as the editor's templates),
 * so each one fits any product. Text without a colour uses dark or light ink
 * to suit the garment colour.
 *
 * The shop owner adds more from the admin dashboard, from a share link made
 * in the editor; those keep the editor's own objects and are scaled to each
 * product's print area. They live in DATA_DIR/library/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T, S, K, D, ACCENT, GOLD, GREEN, PINK } = require('./library-dsl');
const { PRODUCTS } = require('./products');

const CATEGORIES = [
  { id: 'funny', name: { en: 'Funny phrases', ar: 'جمل مضحكة' } },
  { id: 'ramadan', name: { en: 'Ramadan', ar: 'رمضان' } },
  { id: 'football', name: { en: 'Football', ar: 'كورة' } },
  { id: 'eid', name: { en: 'Eid', ar: 'العيد' } },
  { id: 'love', name: { en: 'Love', ar: 'حب' } },
  { id: 'birthday', name: { en: 'Birthday', ar: 'عيد ميلاد' } },
  { id: 'family', name: { en: 'Family', ar: 'العيلة' } },
  { id: 'egypt', name: { en: 'Egypt', ar: 'مصر' } },
  { id: 'motivation', name: { en: 'Motivation', ar: 'تحفيز' } },
];


const BASE = [
  // ---------- Funny Egyptian phrases ----------
  D('mesh-fady', 'funny', 'Busy right now', 'مش فاضي', [
    T('مش فاضي', 'Lalezar', 0.3, 0.5, 0.42),
    T('حاليًا', 'Marhey', 0.14, 0.5, 0.66, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('coffee-first', 'funny', 'No talking before coffee', 'مفيش كلام قبل القهوة', [
    K('coffee', 0.3, 0.5, 0.26),
    T('مفيش كلام', 'Lalezar', 0.2, 0.5, 0.6),
    T('قبل القهوة', 'Marhey', 0.14, 0.5, 0.8, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('sleep-best', 'funny', 'Sleep beats everything', 'النوم أحسن من أي حاجة', [
    T('النوم', 'Lalezar', 0.28, 0.5, 0.32),
    T('أحسن من', 'Changa', 0.12, 0.5, 0.54, { weight: 'bold' }),
    T('أي حاجة', 'Lalezar', 0.24, 0.5, 0.75, { fill: ACCENT }),
  ]),
  D('mazagy', 'funny', 'Mood: high', 'مزاجي عالي', [
    K('cool', 0.28, 0.5, 0.25),
    T('مزاجي', 'Lalezar', 0.26, 0.5, 0.58),
    T('عالي', 'Marhey', 0.17, 0.5, 0.8, { fill: ACCENT, weight: 'bold' }),
  ], 'black'),
  D('ana-geet', 'funny', 'I have arrived', 'أنا جيت', [
    T('أنا جيت', 'Lalezar', 0.28, 0.5, 0.4),
    T('نوّرت المكان', 'Lemonada', 0.1, 0.5, 0.65, { weight: 'bold', fill: '#ffffff', bg: ACCENT, bgShape: 'banner' }),
  ]),
  D('mat2la2sh', 'funny', 'Don\'t worry', 'متقلقش', [
    T('متقلقش', 'Lalezar', 0.28, 0.5, 0.42),
    T('كله هيبقى تمام', 'Changa', 0.11, 0.5, 0.66, { weight: 'bold', fill: ACCENT }),
  ]),
  D('ga3an', 'funny', 'Always hungry', 'جعان على طول', [
    T('جعان', 'Jomhuria', 0.62, 0.5, 0.44),
    T('على طول', 'Marhey', 0.14, 0.5, 0.78, { fill: ACCENT, weight: 'bold' }),
  ], 'black'),
  D('khaleha', 'funny', 'Leave it to God', 'خليها على الله', [
    T('خليها', 'Aref Ruqaa', 0.24, 0.5, 0.38, { weight: 'bold' }),
    T('على الله', 'Aref Ruqaa', 0.24, 0.5, 0.66, { weight: 'bold', fill: GOLD }),
  ]),
  // ---------- Ramadan ----------
  D('ramadan-fanous', 'ramadan', 'Ramadan Kareem lantern', 'فانوس رمضان كريم', [
    K('fanous', 0.3, 0.5, 0.25),
    T('رمضان كريم', 'Aref Ruqaa', 0.2, 0.5, 0.62, { weight: 'bold' }),
    T('RAMADAN KAREEM', 'Playfair Display', 0.06, 0.5, 0.82, { spacing: 200, fill: GOLD }),
  ], 'white', { alsoProducts: ['prayermat'] }),
  D('ramadan-yegma3na', 'ramadan', 'Ramadan brings us together', 'رمضان يجمعنا', [
    S('crescent', 0.24, 0.5, 0.2, { fill: GOLD }),
    S('star', 0.07, 0.66, 0.12, { fill: GOLD }),
    T('رمضان', 'Lalezar', 0.3, 0.5, 0.52),
    T('يجمعنا', 'Marhey', 0.17, 0.5, 0.76, { fill: GOLD, weight: 'bold' }),
  ], 'black'),
  D('ramadan-wanas', 'ramadan', 'Ramadan vibes', 'ونس رمضان', [
    K('mosque', 0.42, 0.5, 0.32),
    T('ونس رمضان', 'Lemonada', 0.15, 0.5, 0.74, { weight: 'bold' }),
  ], 'white', { alsoProducts: ['prayermat'] }),
  D('ahlan-ramadan', 'ramadan', 'Ahlan Ramadan', 'أهلًا رمضان', [
    K('stars', 0.2, 0.22, 0.2),
    K('crescent', 0.22, 0.78, 0.2),
    T('أهلًا رمضان', 'Reem Kufi', 0.2, 0.5, 0.55, { weight: 'bold', fill: GOLD }),
    T('Ahlan Ramadan', 'Dancing Script', 0.11, 0.5, 0.76, { weight: 'bold' }),
  ], 'black', { alsoProducts: ['prayermat'] }),
  // ---------- Football ----------
  D('kora-hayaty', 'football', 'Football is my life', 'الكورة حياتي', [
    K('ball', 0.3, 0.5, 0.24),
    T('الكورة', 'Lalezar', 0.26, 0.5, 0.56),
    T('حياتي', 'Lalezar', 0.26, 0.5, 0.8, { fill: ACCENT }),
  ]),
  D('captain', 'football', 'Captain', 'الكابتن', [
    S('shield', 0.5, 0.5, 0.38, { fill: ACCENT }),
    T('C', 'Anton', 0.24, 0.5, 0.36, { fill: '#ffffff' }),
    T('الكابتن', 'Kufam', 0.15, 0.5, 0.82, { weight: 'bold' }),
  ]),
  D('goooal', 'football', 'Goooal', 'جووون', [
    T('جووووون', 'Lalezar', 0.26, 0.5, 0.44, { fill: ACCENT, extrude: '#16181d' }),
    T('GOAL!', 'Bungee', 0.11, 0.5, 0.72),
  ]),
  D('number-10', 'football', 'King of the pitch No. 10', 'ملك الملعب ١٠', [
    T('ملك الملعب', 'Changa', 0.12, 0.5, 0.14, { weight: 'bold' }),
    T('10', 'Anton', 0.66, 0.5, 0.58, { fill: ACCENT }),
  ]),
  D('born-to-play', 'football', 'Born to play', 'Born to play', [
    T('BORN TO', 'Anton', 0.14, 0.5, 0.3),
    T('PLAY', 'Anton', 0.34, 0.5, 0.55, { fill: ACCENT }),
    K('ball', 0.15, 0.5, 0.84),
  ], 'black'),
  // ---------- Eid ----------
  D('eid-mubarak', 'eid', 'Eid Mubarak', 'عيد مبارك', [
    K('eid-lantern', 0.24, 0.5, 0.24),
    T('عيد مبارك', 'Marhey', 0.22, 0.5, 0.6, { weight: 'bold', fill: GREEN }),
    T('كل سنة وانتم طيبين', 'Changa', 0.075, 0.5, 0.8, { weight: 'bold' }),
  ], 'white', { alsoProducts: ['prayermat'] }),
  D('eid-sheep', 'eid', 'Eid joy', 'العيد فرحة', [
    K('eid-sheep', 0.42, 0.5, 0.32),
    T('العيد فرحة', 'Lalezar', 0.2, 0.5, 0.76),
  ]),
  // ---------- Love ----------
  D('ba7ebak', 'love', 'I love you', 'بحبك', [
    S('heart', 0.42, 0.5, 0.36, { fill: '#e03131' }),
    T('بحبك', 'Aref Ruqaa', 0.22, 0.5, 0.78, { weight: 'bold' }),
  ]),
  D('wanasy', 'love', 'You are my comfort', 'إنت ونسي', [
    T('إنتَ', 'Lalezar', 0.2, 0.5, 0.28),
    T('ونسي', 'Lalezar', 0.36, 0.5, 0.54, { fill: PINK }),
    K('hearts', 0.2, 0.5, 0.83),
  ]),
  // ---------- Birthday ----------
  D('3eed-milad', 'birthday', 'Happy birthday (Arabic)', 'عيد ميلاد سعيد', [
    K('cake', 0.3, 0.5, 0.24),
    T('عيد ميلاد', 'Lalezar', 0.2, 0.5, 0.56),
    T('سعيد', 'Lalezar', 0.26, 0.5, 0.79, { fill: ACCENT }),
  ]),
  D('birthday-squad', 'birthday', 'Birthday squad', 'Birthday squad', [
    K('party-hat', 0.22, 0.5, 0.2),
    T('BIRTHDAY', 'Bungee', 0.13, 0.5, 0.48),
    T('SQUAD', 'Bungee', 0.2, 0.5, 0.68, { fill: ACCENT }),
  ]),
  // ---------- Family ----------
  D('set-el-7abayeb', 'family', 'Best mom', 'ست الحبايب', [
    S('heart', 0.44, 0.5, 0.36, { fill: PINK }),
    T('ماما', 'Lalezar', 0.15, 0.5, 0.35, { fill: '#ffffff' }),
    T('ست الحبايب', 'Aref Ruqaa', 0.16, 0.5, 0.8, { weight: 'bold' }),
  ], 'white', { alsoProducts: ['prayermat'] }),
  D('a7san-ab', 'family', 'Best dad', 'أحسن بابا', [
    K('crown', 0.28, 0.5, 0.22),
    T('بابا', 'Jomhuria', 0.5, 0.5, 0.58),
    T('أحسن أب في الدنيا', 'Changa', 0.09, 0.5, 0.86, { weight: 'bold', fill: ACCENT }),
  ], 'white', { alsoProducts: ['prayermat'] }),
  // ---------- Egypt ----------
  D('masry', 'egypt', 'Proudly Egyptian', 'مصري وأفتخر', [
    K('pyramids', 0.44, 0.5, 0.28),
    T('مصري', 'Lalezar', 0.28, 0.5, 0.64),
    T('وأفتخر', 'Marhey', 0.15, 0.5, 0.85, { fill: GOLD, weight: 'bold' }),
  ]),
  D('cairo', 'egypt', 'Cairo', 'القاهرة', [
    T('CAIRO', 'Abril Fatface', 0.22, 0.5, 0.4),
    T('القاهرة', 'Reem Kufi', 0.14, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
    K('palm', 0.16, 0.5, 0.82),
  ], 'black'),
  // ---------- Motivation ----------
  D('kammel', 'motivation', 'Keep going', 'كمّل', [
    T('كمّل', 'Lalezar', 0.38, 0.5, 0.4, { fill: ACCENT }),
    T('ومتبصش وراك', 'Changa', 0.11, 0.5, 0.66, { weight: 'bold' }),
  ]),
  D('dream-big', 'motivation', 'Dream big', 'Dream big', [
    K('sparkle', 0.16, 0.2, 0.18),
    T('DREAM', 'Anton', 0.26, 0.5, 0.4),
    T('BIG', 'Anton', 0.32, 0.5, 0.66, { fill: ACCENT }),
  ], 'black'),
];

// Template packs (src/library-packs/*.js): each adds its categories and designs.
// A pack exports { categories: [{ id, name: { en, ar } }], designs: [D(...), ...] }.
const PACKS_DIR = path.join(__dirname, 'library-packs');
// A broken pack is skipped (with a warning), never stopping the shop; the tests catch it.
const packs = (fs.existsSync(PACKS_DIR) ? fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.js')).sort() : []).map((f) => {
  try {
    return require(path.join(PACKS_DIR, f));
  } catch (e) {
    console.error(`[library] template pack ${f} skipped: ${e.message}`);
    return {};
  }
});
for (const p of packs) {
  for (const c of p.categories || []) if (!CATEGORIES.some((x) => x.id === c.id)) CATEGORIES.push(c);
}
const seen = new Set(BASE.map((d) => d.id));
const SEED = [...BASE];
for (const p of packs) {
  for (const d of p.designs || []) {
    if (!d || !d.id || seen.has(d.id)) {
      console.error(`[library] template ${d && d.id} skipped: duplicate or missing id`);
      continue;
    }
    seen.add(d.id);
    SEED.push(d);
  }
}

// Designs that look best on one of the newer products open on it by default
// (customers can still switch to any product on the design page).
const DEFAULT_PRODUCT = {
  'number-10': ['jersey', 'white'],
  captain: ['jersey', 'white'],
  'eid-mubarak': ['eidenvelopes', 'gold'],
  'eid-sheep': ['eidenvelopes', 'white'],
  ba7ebak: ['couplemugs', 'white'],
  wanasy: ['couplemugs', 'white'],
  'ramadan-fanous': ['tablecloth', 'white'],
  '3eed-milad': ['greetingcard', 'white'],
  'set-el-7abayeb': ['prayermat', 'white'],
  kammel: ['tumbler', 'white'],
};
for (const d of SEED) {
  if (DEFAULT_PRODUCT[d.id]) [d.product, d.color] = DEFAULT_PRODUCT[d.id];
}

// ---------- Which ready designs are offered on which products ----------
// One table, by subject: what a customer would really buy with such a design on
// it. `products` lists product ids (src/products.js), `cats` adds every product
// of a product category, `not` takes products out again. A design can change its
// own list in its pack: `products` (exactly these, e.g. the laser pack),
// `alsoProducts` (add) and `notProducts` (take out). A design the owner added
// is always offered on the product it was made on. Ready designs are shown on a
// T-shirt unless they say otherwise; `shownOn` picks a better one for a subject
// (the first of those the design is offered on).
// On top of the table:
//  - products that get no general designs at all: fabric by the metre and other
//    printed textiles (`pattern`), books and photo prints (`kind`), laser products
//    (`laser`: they have their own pack);
//  - designs with {Name} fields (filled from a list) go only on name-list products;
//  - the print area's shape must suit the design's (see fitsShape).
const WEAR = ['tshirt', 'oversized', 'hoodie', 'sweatshirt', 'ziphoodie']; // everyday adult clothes
const KIDS_WEAR = ['kidstee', 'kidshoodie'];
const MUGS = ['mug', 'magicmug'];
const WALL = ['poster', 'canvas', 'canvaswide'];
/** Artwork-led designs: clothes, mugs and drinkware, home, wall art, accessories and stationery. */
const STYLE = [...WEAR, 'denim', 'cap', ...MUGS, 'tumbler', 'bottle', 'cushion', ...WALL, 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'coasters', 'notebook', 'postcards', 'magnets', 'stickersheet', 'notepads', 'lunchbag', 'pencilcase'];

const FITS = {
  funny: { products: [...WEAR, 'denim', 'shorts', 'cap', ...MUGS, 'tumbler', 'bottle', 'apron', 'cushion', 'coasters', 'poster', 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'notebook', 'lunchbag', 'pencilcase', 'stickersheet', 'magnets', 'notepads'] },
  // The prayer mat only takes the respectful greetings (alsoProducts in the packs), not the food jokes.
  ramadan: { products: [...WEAR, ...KIDS_WEAR, ...MUGS, 'tumbler', 'cushion', ...WALL, 'tablecloth', 'apron', 'coasters', 'tote', 'notebook', 'sign', 'greetingcard', 'logostickers', 'paperbags', 'flyers', 'postcards', 'foldedcards', 'magnets'] },
  football: { products: [...WEAR, 'jersey', 'shorts', 'polo', 'cap', ...KIDS_WEAR, ...MUGS, 'tumbler', 'bottle', 'cushion', 'poster', 'canvas', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'coasters', 'notebook', 'lunchbag', 'pencilcase', 'stickersheet', 'tote'] },
  eid: { products: [...WEAR, ...KIDS_WEAR, ...MUGS, 'cushion', 'poster', 'tablecloth', 'apron', 'coasters', 'tote', 'eidenvelopes', 'greetingcard', 'sign', 'logostickers', 'paperbags', 'flyers', 'postcards', 'foldedcards', 'magnets'] },
  love: { products: [...WEAR, 'denim', ...MUGS, 'couplemugs', 'tumbler', 'cushion', ...WALL, 'plaque', 'keychain', 'phonecase', 'tote', 'coasters', 'greetingcard', 'postcards', 'foldedcards', 'photobook', 'magnets'] },
  birthday: { products: [...WEAR, ...KIDS_WEAR, ...MUGS, 'tumbler', 'cushion', 'poster', 'plaque', 'sign', 'greetingcard', 'invitations', 'logostickers', 'paperbags', 'tote', 'postcards', 'foldedcards', 'tablenumbers', 'banners'] },
  // Kids' clothes only for the son / daughter / siblings designs, the prayer mat only
  // for the gifts to mum, dad and the grandparents (alsoProducts in the packs).
  family: { products: [...WEAR, ...MUGS, 'couplemugs', 'tumbler', 'cushion', ...WALL, 'plaque', 'sign', 'apron', 'greetingcard', 'keychain', 'coasters', 'tote', 'postcards', 'foldedcards', 'photobook', 'magnets', 'calendar', 'deskcalendar'] },
  egypt: { products: [...WEAR, 'denim', 'cap', ...KIDS_WEAR, ...MUGS, 'tumbler', 'cushion', ...WALL, 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'coasters', 'notebook', 'postcards', 'magnets', 'calendar', 'bookmarks'] },
  motivation: { products: [...WEAR, 'denim', 'cap', ...MUGS, 'tumbler', 'bottle', 'cushion', ...WALL, 'plaque', 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'notebook', 'greetingcard', 'stickersheet', 'postcards', 'notepads', 'bookmarks', 'deskcalendar', 'magnets'] },
  wedding: { products: [...WEAR, 'denim', ...MUGS, 'couplemugs', 'cushion', ...WALL, 'plaque', 'sign', 'coasters', 'keychain', 'tote', 'greetingcard', 'invitations', 'logostickers', 'paperbags', 'postcards', 'foldedcards', 'photobook', 'tablenumbers', 'placecards', 'banners'] },
  graduation: { products: [...WEAR, 'cap', ...MUGS, 'tumbler', 'cushion', 'poster', 'canvas', 'plaque', 'sign', 'keychain', 'tote', 'greetingcard', 'invitations', 'certificates', 'logostickers', 'postcards', 'foldedcards', 'photobook', 'banners'] },
  // Mum / dad to be on adult T-shirts; the onesie and kids' clothes are added per design in the pack.
  baby: { shownOn: ['onesie', 'kidstee'], products: ['tshirt', 'oversized', ...MUGS, 'cushion', ...WALL, 'plaque', 'sign', 'tote', 'greetingcard', 'invitations', 'logostickers', 'paperbags', 'postcards', 'foldedcards', 'photobook', 'magnets', 'banners'] },
  friends: { products: [...WEAR, 'cap', ...MUGS, 'couplemugs', 'tumbler', 'cushion', 'poster', 'plaque', 'keychain', 'phonecase', 'tote', 'greetingcard', 'postcards', 'photobook', 'magnets'] },
  islamic: { products: [...WEAR, ...MUGS, 'tumbler', 'cushion', ...WALL, 'plaque', 'sign', 'prayermat', 'tablecloth', 'keychain', 'coasters', 'tote', 'phonecase', 'notebook', 'greetingcard', 'postcards', 'foldedcards', 'bookmarks', 'calendar', 'deskcalendar', 'magnets'] },
  fitness: { products: [...WEAR, 'polo', 'shorts', 'jersey', 'cap', ...KIDS_WEAR, 'bottle', 'tumbler', 'mug', 'tote', 'poster', 'notebook'] },
  gaming: { products: [...WEAR, 'cap', ...KIDS_WEAR, ...MUGS, 'cushion', 'poster', 'canvas', 'mousepad', 'deskmat', 'phonecase', 'keychain', 'coasters', 'notebook', 'pencilcase', 'lunchbag', 'stickersheet'] },
  music: { products: [...WEAR, 'denim', 'cap', ...MUGS, 'tumbler', 'cushion', ...WALL, 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'coasters', 'notebook'] },
  travel: { products: [...WEAR, 'shorts', 'cap', ...KIDS_WEAR, ...MUGS, 'tumbler', 'bottle', ...WALL, 'tote', 'phonecase', 'keychain', 'notebook', 'flyers', 'postcards', 'photobook', 'magnets', 'calendar'] },
  kids: { shownOn: ['kidstee'], products: [...KIDS_WEAR, 'onesie', 'cap', 'magicmug', 'bottle', 'cushion', 'poster', 'canvas', 'lunchbag', 'pencilcase', 'notebook', 'stickersheet', 'namelabels', 'tote', 'bookmarks', 'magnets', 'photobook'] },
  school: { products: [...WEAR, ...KIDS_WEAR, 'polo', 'jersey', 'cap', 'mug', 'tumbler', 'bottle', 'notebook', 'pencilcase', 'lunchbag', 'stickersheet', 'namelabels', 'greetingcard', 'certificates', 'idcards', 'poster', 'sign', 'tote', 'bookmarks', 'notepads'] },
  pets: { products: [...WEAR, ...KIDS_WEAR, ...MUGS, 'cushion', 'poster', 'canvas', 'plaque', 'tote', 'phonecase', 'mousepad', 'keychain', 'coasters', 'notebook', 'stickersheet', 'postcards', 'photobook', 'magnets', 'calendar'] },
  // Shop and company logos: all the business print, work wear and give-aways. Staff
  // shirts and events take some of it out again in their pack (src/library-packs/people.js).
  business: { cats: ['business'], products: ['tshirt', 'polo', 'hoodie', 'sweatshirt', 'ziphoodie', 'cap', 'apron', 'mug', 'tumbler', 'bottle', 'tote', 'notebook', 'mousepad', 'deskmat', 'keychain', 'coasters', 'sign', 'notepads', 'calendar', 'deskcalendar', 'magnets'], not: ['certificates'] },
  quotes: { products: [...WEAR, 'denim', ...MUGS, 'tumbler', 'cushion', ...WALL, 'plaque', 'coasters', 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'notebook', 'postcards', 'bookmarks', 'notepads', 'magnets', 'deskcalendar'] },
  minimal: { products: [...WEAR, 'polo', 'denim', 'shorts', 'cap', ...MUGS, 'tumbler', 'bottle', 'cushion', ...WALL, 'coasters', 'tote', 'phonecase', 'mousepad', 'deskmat', 'keychain', 'notebook', 'pencilcase', 'notepads', 'postcards'] },
  // The design-trend styles (src/library-packs/styles.js): artwork-led, for everything that shows a picture well.
  vintage: { products: [...STYLE, 'calendar', 'deskcalendar', 'bookmarks'] },
  surreal: { products: [...STYLE] },
  optical: { products: [...STYLE] },
  comic: { products: [...STYLE, ...KIDS_WEAR] },
  maximal: { products: [...STYLE] },
  artsy: { products: [...STYLE, 'calendar', 'deskcalendar', 'bookmarks'] },
  luxury: { products: [...WEAR, 'polo', 'cap', ...MUGS, 'tumbler', 'cushion', ...WALL, 'plaque', 'tote', 'phonecase', 'notebook', 'coasters', 'keychain', 'deskmat', 'notepads', 'deskcalendar'] },
  trends: { products: [...STYLE] },
};
// A subject missing from the table (a new pack) still goes on the everyday products.
const FITS_OTHER = { products: [...WEAR, ...MUGS, 'tumbler', 'cushion', 'poster', 'tote'] };

// Print-area shape (width / height). The ready designs are drawn for a T-shirt
// (0.75); on a wider area they keep their size by the height and sit in the
// middle, on a narrower one they spread down. Up to about 2× either way still
// looks right; beyond that (desk mat, DL envelope) a tall design looks lost.
// A mug's print area wraps round it, but the customer sees one side at a time.
const SHAPE_MIN = 0.5;
const SHAPE_MAX = 2.25;
const SEEN_SHAPE = { mug: 1.15, magicmug: 1.15, couplemugs: 1.15 };
const areaShape = (a) => (a && a.w > 0 && a.h > 0 ? a.w / a.h : 0);
/** The part of a print area ready designs are placed in (printArea.readyZone: the wall calendar's top half, a folder's front). */
const readyPart = (a) => (a && a.readyZone ? { w: a.w * a.readyZone.w, h: a.h * a.readyZone.h } : a);
const productShape = (p) => SEEN_SHAPE[p.id] || areaShape(readyPart(p.sides && p.sides[0] && p.sides[0].printArea)) || 0.75;
const MERGE_FIELD = /\{[^{}]+\}/;
const hasNameFields = (d) => (d.items || []).some((i) => i.kind === 'text' && MERGE_FIELD.test(i.text || ''));
/** Products that take no general ready designs. */
const noGeneralDesigns = (p) => Boolean(p.laser || p.pattern || p.kind);

function designShape(d) {
  if (d.aspect) return d.aspect;
  if (areaShape(d.area)) return areaShape(d.area); // designs the owner added keep the area they were made on
  const own = PRODUCTS.find((p) => p.id === d.product);
  return own ? productShape(own) : 0.75;
}
function fitsShape(d, p) {
  const r = productShape(p) / designShape(d);
  return r >= SHAPE_MIN && r <= SHAPE_MAX;
}

// Light or dark: a design drawn for a dark garment (white or neon ink, white line art)
// disappears on white, so it is only offered on products that come in a dark colour;
// one drawn for a light colour only where there is a light one. Products whose print
// goes on white paper whatever the colour (posters, canvases: the colour is the frame
// or edge) count as white. Same threshold as the editor's dark / light ink (inkFor).
const luminance = (hex) => {
  const n = parseInt(String(hex).slice(1, 7), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const isDark = (hex) => luminance(hex) < 0.45;
/** The colour (hex) a design was drawn on, or null when not known. */
function designHex(d) {
  const own = PRODUCTS.find((p) => p.id === d.product);
  if (own && own.surface) return own.surface;
  const c = own && own.colors.find((x) => x.id === d.color);
  return c ? c.hex : null;
}
// The magic mug is black when cold, but the print shows on white once it is hot.
const PRINTS_ON = { magicmug: '#ffffff' };
/** The colours the design is printed on, for each of the product's colours. */
const surfaces = (p) => (PRINTS_ON[p.id] ? [PRINTS_ON[p.id]] : p.surface ? [p.surface] : p.colors.map((c) => c.hex));
// A design drawn for a dark colour still reads on a light one when nothing in it is a fixed
// light colour: text and icons without a colour take dark or light ink to suit, and the
// colours it does use are dark enough (gold and the accent are, pale yellow and cyan are not).
// Pictures (white line art, neon) and glowing text are taken to need their own colour.
// The same the other way round for a light design on a dark-only product.
// (Light text on a dark shape under it, a white "RUN" on an orange badge, reads anywhere.)
function readsOn(d, dark) {
  if (d.kind !== 'template' || !Array.isArray(d.items)) return false;
  const hexOk = (hex) => !hex || !/^#[0-9a-f]{6}$/i.test(hex);
  const ok = (hex) => hexOk(hex) || (dark ? luminance(hex) > 0.3 : luminance(hex) < 0.68);
  const aspect = d.aspect || 0.75;
  const onShape = (t, k) => d.items.slice(0, k).some((sh) => sh.kind === 'shape' && !sh.stroke && !hexOk(sh.fill)
    && Math.abs(luminance(sh.fill) - luminance(t.fill)) > 0.3
    && Math.abs(t.x - sh.x) < sh.w / 2 && Math.abs(t.y - sh.y) < (sh.w / 2) * aspect);
  return d.items.every((i, k) => {
    if (i.kind === 'image') return false;
    if (i.kind === 'text') return !i.glow && (ok(i.bg || i.fill) || (!i.bg && onShape(i, k)));
    if (i.kind === 'shape') return Boolean(i.stroke) || ok(i.fill);
    if (i.kind === 'art') return ok(i.fill);
    return true; // the shop's stickers are drawn in full colour, with their own outlines
  });
}
function fitsColour(d, p) {
  if (d.product === p.id) return true;
  const hex = designHex(d);
  if (!hex) return true;
  const dark = isDark(hex);
  const on = surfaces(p);
  return on.some((h) => isDark(h) === dark) || readsOn(d, !dark);
}

let fitCache = new WeakMap();
/** The catalogue changed (product manager): work out again which products each design goes on. */
function catalogChanged() {
  fitCache = new WeakMap();
}
/** The ids of the products a design is offered on, in catalogue order. */
function productsFor(d) {
  if (Array.isArray(d.products)) return d.products; // chosen by hand (laser designs)
  if (fitCache.has(d)) return fitCache.get(d);
  const rule = FITS[d.category] || FITS_OTHER;
  const want = new Set(rule.products || []);
  for (const p of PRODUCTS) if ((rule.cats || []).includes(p.category)) want.add(p.id);
  for (const id of rule.not || []) want.delete(id);
  for (const id of d.alsoProducts || []) want.add(id);
  for (const id of d.notProducts || []) want.delete(id);
  // Products the manager made from another one take that product's designs too.
  for (const p of PRODUCTS) if (p.base && want.has(p.base)) want.add(p.id);
  const fields = hasNameFields(d);
  const list = PRODUCTS.filter((p) => !noGeneralDesigns(p) && ((d.kind === 'objects' && p.id === d.product)
    || (want.has(p.id) && (!fields || p.merge) && fitsShape(d, p) && fitsColour(d, p)))).map((p) => p.id);
  fitCache.set(d, list);
  return list;
}
// (The colour closest to the T-shirt colour the design was drawn on.)
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const distance = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);
for (const d of SEED) {
  const list = productsFor(d);
  if (d.product !== 'tshirt' || !list.length) continue; // (the DSL's default product)
  const shownOn = ((FITS[d.category] || {}).shownOn || []).find((id) => list.includes(id)) || (list.includes('tshirt') ? 'tshirt' : list[0]);
  if (shownOn !== 'tshirt') {
    const from = PRODUCTS.find((p) => p.id === 'tshirt').colors.find((c) => c.id === d.color);
    const to = PRODUCTS.find((p) => p.id === shownOn);
    d.product = to.id;
    if (from && !to.colors.some((c) => c.id === d.color)) d.color = to.colors.reduce((best, c) => (distance(c.hex, from.hex) < distance(best.hex, from.hex) ? c : best)).id;
  }
}

// ---------- Custom designs (added by the shop owner) ----------
class Library {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'library');
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexPath = path.join(this.dir, 'index.json');
    this.index = { hidden: [], deleted: [], custom: [], done: [] };
    this.stamp = null;
    this.reload();
  }
  /**
   * One-time changes to the shop's own list (each runs once per shop, then is remembered in the
   * index): 'pause-no-artwork' pauses the starter designs made only of text, shapes and icons, so the
   * shop shows only the ones drawn with real artwork (the owner shows any of them again from the admin).
   * Run by server.js for the real shop, not by the tests.
   */
  runOnce(names) {
    const want = (names || []).filter((n) => ONCE[n]);
    if (!want.length) return;
    this.reload();
    if (want.every((n) => (this.index.done || []).includes(n))) return;
    this.withLock(() => {
      let changed = false;
      for (const n of want) {
        if ((this.index.done || []).includes(n)) continue;
        ONCE[n](this.index);
        this.index.done = [...(this.index.done || []), n];
        changed = true;
      }
      if (changed) this.save();
    });
  }
  /** Re-read the index if another copy of the app changed it. */
  reload() {
    let stamp = null;
    try {
      const st = fs.statSync(this.indexPath);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return;
    }
    if (stamp === this.stamp) return;
    try {
      this.index = { hidden: [], deleted: [], custom: [], done: [], ...JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) };
      this.stamp = stamp;
    } catch (e) { /* half-written; try next time */ }
  }
  save() {
    const tmp = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.index, null, 2));
    fs.renameSync(tmp, this.indexPath);
    try {
      const st = fs.statSync(this.indexPath);
      this.stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) { /* ignore */ }
  }
  /**
   * Run a change with the index locked and freshly read, so two copies of the
   * app changing the library at the same time don't undo each other.
   */
  withLock(fn) {
    const lock = `${this.indexPath}.lock`;
    let got = false;
    for (let i = 0; i < 300 && !got; i++) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
        got = true;
      } catch (e) {
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 10e3) fs.rmSync(lock, { force: true }); // left by a copy that stopped
        } catch (err) { /* gone already */ }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      this.stamp = null;
      this.reload();
      return fn();
    } finally {
      if (got) fs.rmSync(lock, { force: true });
    }
  }
  /**
   * Every design, newest custom ones first, with the products it is offered on and `hidden` (paused:
   * out of the shop for now) / `deleted` (out of the shop and of the admin's main list; can be brought
   * back) set. Nothing is really removed: a deleted design of the owner's keeps its files.
   */
  all() {
    this.reload();
    const hidden = new Set(this.index.hidden);
    const deleted = new Set(this.index.deleted || []);
    const list = [...this.index.custom.slice().reverse(), ...SEED].map((d) => ({ ...d, products: productsFor(d), hidden: hidden.has(d.id), deleted: deleted.has(d.id) }));
    return this.index.textOnlyLimited ? limitTextOnly(list) : list;
  }
  /** What the shop shows: neither paused nor deleted (nor a text-only design left with no product). */
  visible() {
    return this.all().filter((d) => !d.hidden && !d.deleted && !(d.limited && !d.products.length));
  }
  /** The shop's settings for its designs: { textOnlyLimited } (see limitTextOnly). */
  settings() {
    this.reload();
    return { textOnlyLimited: Boolean(this.index.textOnlyLimited) };
  }
  setSettings(next) {
    return this.withLock(() => {
      if (typeof next.textOnlyLimited === 'boolean') this.index.textOnlyLimited = next.textOnlyLimited;
      this.save();
      return this.settings();
    });
  }
  get(id) {
    const d = this.all().find((x) => x.id === id);
    if (!d) return null;
    if (d.kind === 'objects') {
      try {
        return { ...d, objects: JSON.parse(fs.readFileSync(path.join(this.dir, `${d.id}.json`), 'utf8')) };
      } catch (e) {
        return null;
      }
    }
    return d;
  }
  previewPath(id) {
    return path.join(this.dir, `${id}.png`);
  }
  addCustom(d) {
    return this.withLock(() => this.addCustomNow(d));
  }
  addCustomNow({ name, category, product, color, objects, area, preview }) {
    const id = 'c-' + crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(objects));
    if (preview) fs.writeFileSync(this.previewPath(id), preview);
    const meta = { id, category, name, kind: 'objects', product, color, area, createdAt: new Date().toISOString() };
    this.index.custom.push(meta);
    this.save();
    return meta;
  }
  setHidden(id, hidden) {
    return this.withLock(() => this.setHiddenNow(id, hidden));
  }
  setHiddenNow(id, hidden) {
    return this.setFlagsNow([id], { hidden }) === 1;
  }
  /**
   * Pause / show (`hidden`) and delete / bring back (`deleted`) several designs at once. Unknown ids
   * are skipped; gives how many designs were found.
   */
  setFlags(ids, flags) {
    return this.withLock(() => this.setFlagsNow(ids, flags));
  }
  setFlagsNow(ids, { hidden, deleted } = {}) {
    const known = new Set(this.all().map((d) => d.id));
    const list = [...new Set((ids || []).map(String))].filter((id) => known.has(id));
    if (!list.length) return 0;
    const set = (key, on) => {
      const rest = (this.index[key] || []).filter((x) => !list.includes(x));
      this.index[key] = on ? [...rest, ...list] : rest;
    };
    if (typeof hidden === 'boolean') set('hidden', hidden);
    if (typeof deleted === 'boolean') set('deleted', deleted);
    this.save();
    return list.length;
  }
  removeCustom(id) {
    return this.withLock(() => this.removeCustomNow(id));
  }
  removeCustomNow(id) {
    const before = this.index.custom.length;
    this.index.custom = this.index.custom.filter((d) => d.id !== id);
    if (this.index.custom.length === before) return false;
    this.index.hidden = this.index.hidden.filter((x) => x !== id);
    for (const f of [`${id}.json`, `${id}.png`]) fs.rmSync(path.join(this.dir, f), { force: true });
    this.save();
    return true;
  }
}

/** Whether a design is drawn with the shop's own artwork files (I(...) in the packs), not only text, shapes and icons. */
const usesArtwork = (d) => (d.items || []).some((it) => it.kind === 'image');
/** Designs with real artwork: the starter ones drawn with the shop's artwork files, and the owner's own. */
const hasArtwork = (d) => d.kind === 'objects' || usesArtwork(d);
/**
 * The shop's rule "text-only designs only where there's no artwork" (index.textOnlyLimited): a starter
 * design made only of text, shapes and icons is offered only on the products that have no design with
 * real artwork in the shop (business cards, invitations, laser pieces...), and shown on one of those.
 * `list`: designs with products / hidden / deleted set. Changed ones get `limited: true`.
 */
function limitTextOnly(list) {
  const covered = new Set();
  for (const d of list) if (!d.hidden && !d.deleted && hasArtwork(d)) for (const id of d.products) covered.add(id);
  return list.map((d) => {
    if (hasArtwork(d)) return d;
    const left = d.products.filter((id) => !covered.has(id));
    if (left.length === d.products.length) return d;
    return { ...d, ...showOn(d, left), products: left, limited: true };
  });
}
/** The product (and its colour closest to the design's) a design is shown on, out of `list`. */
function showOn(d, list) {
  if (!list.length || list.includes(d.product)) return {};
  const id = ((FITS[d.category] || {}).shownOn || []).find((x) => list.includes(x)) || list[0];
  const to = PRODUCTS.find((p) => p.id === id);
  if (!to || !to.colors.length) return { product: id };
  if (to.colors.some((c) => c.id === d.color)) return { product: id };
  const fromP = PRODUCTS.find((p) => p.id === d.product);
  const from = fromP && fromP.colors.find((c) => c.id === d.color);
  return { product: id, color: from ? to.colors.reduce((best, c) => (distance(c.hex, from.hex) < distance(best.hex, from.hex) ? c : best)).id : to.colors[0].id };
}
const ONCE = {
  // Only the designs with real artwork where there are some: the rule above on, and the text-only
  // starter designs that would be left with no product paused (the owner can show them again).
  'pause-no-artwork': (index) => {
    index.textOnlyLimited = true;
    const off = new Set([...(index.hidden || []), ...(index.deleted || [])]);
    const covered = new Set();
    for (const d of SEED) if (usesArtwork(d) && !off.has(d.id)) for (const id of productsFor(d)) covered.add(id);
    const paused = new Set(index.hidden || []);
    for (const d of SEED) if (!usesArtwork(d) && productsFor(d).every((id) => covered.has(id))) paused.add(d.id);
    index.hidden = [...paused];
  },
};

module.exports = { Library, catalogChanged, CATEGORIES, SEED, FITS, productsFor, fitsColour, productShape, usesArtwork };
