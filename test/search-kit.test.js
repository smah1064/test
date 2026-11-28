'use strict';

// The shop's forgiving search (home page and /designs): plurals, one word or two, both spellings,
// the same thing said in the other language. No server, no browser: the block is run as it is in the pages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const START = '// search-kit:start';
const END = '// search-kit:end';
function block(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  assert.ok(a >= 0 && b > a, `${file} has the search block`);
  // Compared without the indentation (the home page's copy sits deeper).
  return src.slice(a, b + END.length).split('\n').map((l) => l.trim()).join('\n');
}
const KIT = block('public/js/designs.js');
const SEARCH = vm.runInNewContext(`${KIT}\nSEARCH`);

// Product names, descriptions and words as the home page indexes them (from the catalogue).
const P = {
  tshirt: 'tshirt Classic T-Shirt تيشيرت كلاسيك 100% combed cotton Apparel ملابس tee t-shirt tshirt shirt تي شيرت تيشرت تشيرت',
  kidstee: 'kidstee Kids T-Shirt تيشيرت أطفال Apparel ملابس tee t-shirt kids اطفال تيشرت',
  polo: 'polo Polo Shirt تيشيرت بولو Piqué cotton polo Apparel ملابس tee shirt تيشرت',
  oversized: 'oversized Oversized T-Shirt تيشيرت أوفر سايز Apparel ملابس',
  jersey: 'jersey Football Jersey تيشيرت كورة Apparel ملابس football soccer shirt تيشرت فانلة',
  sweatshirt: 'sweatshirt Crewneck Sweatshirt سويتشيرت Apparel ملابس sweater سويت شيرت بلوفر',
  hoodie: 'hoodie Pullover Hoodie هودي Apparel ملابس hoody sweater هودى',
  cap: 'cap Baseball Cap كاب Apparel ملابس hat قبعة طاقية',
  mug: 'mug Ceramic Mug مج سيراميك مطبوع لفّة كاملة حوالين المج Home & living المنزل cup coffee tea كوب كوباية مق',
  couplemugs: 'couplemugs Couple Mugs (pair) مجين للكابلز Gifts & occasions cup كوب مق',
  tote: 'tote Canvas Tote Bag شنطة قماش Accessories bag شنطة',
  paperbags: 'paperbags Paper Shopping Bags شنط ورق بلوجو Business',
  poster: 'poster Framed Poster بوستر بإطار Home frame picture صورة برواز',
  notebook: 'notebook Spiral Notebook كشكول سلك Stationery كراسة دفتر',
  calendar: 'calendar Wall Calendar (A3) نتيجة حائط (A3) Home calendar نتيجه نتيجة تقويم',
  bizcards: 'bizcards Business Cards كروت شخصية Thick 350 gsm cards Business للأعمال business cards visit كارت فيزيت',
  invitations: 'invitations Invitation Cards كروت دعوة For weddings, engagements, birthdays and events. للأفراح والخطوبة وأعياد الميلاد',
  tablenumbers: 'tablenumbers Table Numbers (tent cards) أرقام ترابيزات (كارت ستاند) for weddings ارقام ترابيزات فرح',
  bottle: 'bottle Water Bottle زمزمية مياه Insulated stainless steel',
};
// (true: as the home page, a word without its ي is looked for anywhere, as its search always did.)
const idx = Object.fromEntries(Object.entries(P).map(([id, text]) => [id, SEARCH.index(text, true)]));
const find = (q) => Object.keys(P).filter((id) => SEARCH.match(idx[id], SEARCH.query(q)));
const finds = (q, ids) => { const got = find(q); for (const id of ids) assert.ok(got.includes(id), `"${q}" finds ${id} (got ${got.join(', ') || 'nothing'})`); return got; };
// What the search found before: every word as typed, anywhere in the text (or without the long ي).
const before = (q) => Object.keys(P).filter((id) => {
  const full = ` ${SEARCH.norm(P[id])} `;
  return SEARCH.norm(q).split(' ').filter(Boolean).every((w) => full.includes(w) || SEARCH.loose(full).includes(SEARCH.loose(w)));
});

test('the home page and /designs run the same search block', () => {
  assert.strictEqual(block('public/index.html'), KIT);
});

test('English plurals and one word or two find the products', () => {
  const tees = ['tshirt', 'kidstee', 'polo', 'oversized', 'jersey'];
  for (const q of ['tshirt', 'tshirts', 't-shirts', 'T Shirts', 'tees', 'tee shirts', 'shirts']) finds(q, tees);
  finds('hoodies', ['hoodie']);
  finds('caps', ['cap']);
  finds('tote bags', ['tote']);
  finds('posters', ['poster']);
  finds('notebooks', ['notebook']);
  finds('calendars', ['calendar']);
  finds('sweatshirts', ['sweatshirt']);
  finds('mugs', ['mug', 'couplemugs']);
  finds('cups', ['mug', 'couplemugs']);
  assert.deepStrictEqual(find('tote bags'), ['tote']);
  assert.ok(!find('hoodies').includes('tshirt'));
  // Another form of a word is a whole word: "tees" is not the "tee" in "steel", "cars" not the "car" in "card".
  assert.ok(find('tee').includes('bottle'), 'as typed, a word is still found inside another');
  assert.ok(!find('tees').includes('bottle'));
  assert.ok(!find('tshirts').includes('sweatshirt'));
  assert.strictEqual(find('cars').length, 0);
});

test('Arabic plurals, spellings and the same thing in other words', () => {
  const tees = ['tshirt', 'kidstee', 'polo', 'oversized', 'jersey'];
  for (const q of ['تيشيرتات', 'تيشرتات', 'تيشرت', 'التيشيرتات']) finds(q, tees);
  finds('هوديات', ['hoodie']);
  finds('مجات', ['mug', 'couplemugs']);
  finds('كوبايات', ['mug']);
  finds('شنط', ['tote', 'paperbags']);
  finds('شنطة', ['tote', 'paperbags']);
  assert.deepStrictEqual(find('بيزنس كارد'), ['bizcards']);
  finds('business card', ['bizcards']);
  finds('دعوة فرح', ['invitations']);
  // A wedding card: the invitations, not only the table numbers that say "كارت".
  finds('كارت فرح', ['invitations', 'tablenumbers']);
  finds('hoodie هودي', ['hoodie']);
});

test('what the plain words found is still found', () => {
  for (const q of ['tee', 'cap', 'card', 'cards', 'كروت', 'فرح', 'مج', 'تيشيرت', 'business card', 'steel', 'ستيكرز', 'A3', 'a 3', '350', '٣٥٠', 'كو']) {
    const got = find(q);
    for (const id of before(q)) assert.ok(got.includes(id), `"${q}" still finds ${id}`);
  }
});

test('word forms: plurals become singular, short words stay as they are', () => {
  const has = (w, f) => assert.ok(SEARCH.forms(SEARCH.norm(w)).includes(SEARCH.norm(f)), `${w} → ${f}`);
  const hasnt = (w, f) => assert.ok(!SEARCH.forms(SEARCH.norm(w)).includes(SEARCH.norm(f)), `${w} ↛ ${f}`);
  has('hoodies', 'hoodie'); has('puppies', 'puppy'); has('boxes', 'box'); has('dogs', 'dog'); has('wolves', 'wolf');
  has('تيشيرتات', 'تيشيرت'); has('مدرسين', 'مدرس'); has('ستيكرز', 'ستيكر'); has('كوبايات', 'كوباية');
  hasnt('glass', 'glas'); hasnt('bus', 'bu'); hasnt('tees', 'te'); hasnt('shoes', 'sho');
  hasnt('بنات', 'بن'); hasnt('زيتون', 'زيت'); hasnt('مجات', 'مج');
  // An index of a design keeps its plain words, so a word inside another still matches as before.
  assert.ok(SEARCH.match(SEARCH.index('Merry Christmas card'), SEARCH.query('christmas cards')));
  assert.ok(SEARCH.match(SEARCH.index('Two dogs playing'), SEARCH.query('dog')));
  assert.ok(SEARCH.match(SEARCH.index('My dog'), SEARCH.query('dogs')));
  assert.ok(SEARCH.match(SEARCH.index('عيد ميلاد سعيد'), SEARCH.query('birthday')));
  assert.ok(SEARCH.match(SEARCH.index('Happy birthday'), SEARCH.query('عيد ميلاد')));
  assert.ok(!SEARCH.match(SEARCH.index('Happy birthday'), SEARCH.query('dogs')));
  // (هدية is not هدي without its ي: it doesn't find هدير. It finds هدايا since 25 Nov, the same gift words.)
  assert.ok(!SEARCH.match(SEARCH.index('ورق مراسلات (ليترهيد) هدير'), SEARCH.query('هدية')), 'هدية: not هدي without its ي');
  assert.ok(SEARCH.match(SEARCH.index('ورق مراسلات (ليترهيد) هدايا'), SEARCH.query('هدية')), 'هدية finds هدايا');
  assert.ok(SEARCH.match(SEARCH.index('شنط ورق بلوجو'), SEARCH.query('شنطة')));
  // Ranking names: with start, words count only at the start of a word.
  assert.ok(SEARCH.match(SEARCH.index('Crewneck Sweatshirt سويتشيرت'), SEARCH.query('tshirt')));
  assert.ok(!SEARCH.match(SEARCH.index('Crewneck Sweatshirt سويتشيرت'), SEARCH.query('tshirt'), true));
  assert.ok(SEARCH.match(SEARCH.index('Polo Shirt تيشيرت بولو'), SEARCH.query('tshirt'), true));
  // /designs: both spellings of تيشيرت, but a word without its ي only at the start of a word, 3 letters or more.
  const design = SEARCH.index('تيشيرت كريسماس Christmas في البيت');
  assert.ok(SEARCH.match(design, SEARCH.query('تيشرت')));
  assert.ok(!SEARCH.match(design, SEARCH.query('رسم')), 'رسم is not in كريسماس');
  assert.ok(!SEARCH.match(SEARCH.index('فرح'), SEARCH.query('في')), 'في does not find every ف');
  assert.ok(SEARCH.match(SEARCH.index('فرح', true), SEARCH.query('في')), 'the home page as before');
  // Nothing to look for: no words.
  assert.strictEqual(SEARCH.query('<> $&').length, 0);
});

// UX item 4 (owner's OK, 27 Nov): gift and occasion words, the same in either language (the products' occasions).
test('gift and occasion words: each language finds the other', () => {
  const finds = (text, q) => assert.ok(SEARCH.match(SEARCH.index(text), SEARCH.query(q)), `"${q}" finds "${text}"`);
  for (const q of ['هدية', 'هدايا', 'هديه', 'gift', 'gifts', 'present', 'presents']) finds('gift', q);
  for (const q of ['عيد ميلاد', 'birthday', 'bday', 'اعياد ميلاد']) finds('birthday', q);
  for (const q of ['عيد الأم', 'عيد الام', "mother's day", 'ماما']) finds('mom', q);
  for (const q of ['عيد الحب', 'فالنتاين', "valentine's day"]) finds('valentine', q);
  for (const q of ['فرح', 'جواز', 'زواج', 'wedding']) finds('wedding', q);
  for (const q of ['خطوبة', 'خطوبه', 'engagement']) finds('engagement', q);
  for (const q of ['تخرج', 'التخرج', 'حفلة تخرج', 'graduation', 'graduate']) finds('graduation', q);
  for (const q of ['مولود', 'سبوع', 'new baby', 'newborn', 'بيبي']) finds('baby', q);
  // And the other way round: an Arabic design or product text is found by the English word.
  finds('هدية تخرج', 'graduation gift');
  finds('هدية للمولود', 'baby');
  // Not inside other words: «خرج» is not the graduation.
  assert.ok(!SEARCH.match(SEARCH.index('graduation'), SEARCH.query('خرج')));
});
