'use strict';

// Arabic words with "the" / "for (the)" in front (الأم, للأب, لأمي), Valentine's / Teacher's Day and a new baby
// (QA 25 Nov), the home page's sizes ("tshirt xl", "A5 flyers") and colours ("تيشيرت أبيض", "black hoodie"), its order
// (كوب: the mugs before كوبونات) and more of the shop's words (مصلية, فنجان, قميص). QA 26 Nov: colours in the feminine
// (شنطة سوداء), gray, رصاصي, beige; keyring, سلسلة مفاتيح, leaflets, a calendar with a year; "hat" not "that"; كتيب before
// كتب. The search block and the home page's lines are run as they are.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = read('public/js/designs.js');
const KIT = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end') + '// search-kit:end'.length);
const SEARCH = vm.runInNewContext(`${KIT}\nSEARCH`);

// Ready designs as /designs indexes them: name in both languages, category and the words printed on them.
const D = {
  mum: 'Best Mom Ever أحلى ماما عيد الأم mothers',
  mumAr: 'كل سنة وانتي طيبة يا أمي عيد الأم',
  dad: 'Super Dad بابا البطل fathers day عيد الأب',
  dimensions: 'Bent reality (3D checkerboard) واقع مايل (شطرنج ثلاثي الأبعاد)',
  heroes: 'Even superheroes take mental health days حتى الأبطال الخارقين بياخدوا يوم راحة نفسية',
  exams: 'Exams: God help us الامتحانات ربنا يستر funny',
  forever: 'Friends forever صحاب للأبد friends',
  forever2: 'Love you forever بحبك للأبد love',
  llama: 'First of all no, second of all still no (llama) أولًا لأ، ثانيًا برضه لأ (لاما)',
  valentine: 'Be my Valentine Be my Valentine love',
  valentineAr: 'Happy Valentine\'s (Arabic) عيد حب سعيد love',
  habibi: 'Habibi حبيبي love',
  teacher: 'Happy teachers day يوم المعلم شكرًا يا معلمي school',
  baby: 'Welcome baby أهلًا بالنونو',
};
const idx = Object.fromEntries(Object.entries(D).map(([id, t]) => [id, SEARCH.index(t)]));
const find = (q) => Object.keys(D).filter((id) => SEARCH.match(idx[id], SEARCH.query(q)));
function check(q, want, notWant) {
  const got = find(q);
  for (const id of want) assert.ok(got.includes(id), `"${q}" finds ${id} (got ${got.join(', ') || 'nothing'})`);
  for (const id of notWant) assert.ok(!got.includes(id), `"${q}" is not ${id} (got ${got.join(', ')})`);
}

test('للأم / الأم / لأمي find the mum designs, not the exams or the llama', () => {
  for (const q of ['للأم', 'للام', 'الأم', 'الام', 'لأمي', 'لامي', 'عيد الأم']) check(q, ['mum', 'mumAr'], ['exams', 'llama', 'dad', 'dimensions', 'heroes']);
});

test('للأب / الأب find the dad designs, not "forever", "dimensions" or "heroes"', () => {
  for (const q of ['للأب', 'للاب', 'الأب', 'الاب', 'عيد الأب']) check(q, ['dad'], ['forever', 'forever2', 'dimensions', 'heroes', 'mum']);
  // Still found by their own words.
  check('للأبد', ['forever', 'forever2'], ['dad']);
  check('الأبعاد', ['dimensions'], ['dad']);
  check('الأبطال', ['heroes'], ['dad']);
  check('الامتحانات', ['exams'], ['mum']);
});

test('Valentine\'s Day: عيد الحب, فالنتاين, valentine find both valentine designs', () => {
  for (const q of ['عيد الحب', 'فالنتاين', 'فلانتين', 'valentine', 'valentines', "Valentine's Day", 'عيد حب']) check(q, ['valentine', 'valentineAr'], ['exams', 'teacher', 'baby']);
});

test('Teacher\'s Day: عيد المعلم, المعلم, teacher\'s day find it', () => {
  for (const q of ['عيد المعلم', 'المعلم', 'معلم', 'مدرس', "teacher's day", 'teacher', 'يوم المعلم']) check(q, ['teacher'], ['valentine', 'baby', 'exams']);
});

test('a new baby: بيبي, نونو, مولود, baby, newborn find Welcome baby / أهلًا بالنونو', () => {
  for (const q of ['بيبي', 'نونو', 'مولود', 'baby', 'newborn', 'النونو']) check(q, ['baby'], ['teacher', 'valentine', 'mum']);
});

test('a short word after its article is still found while typing and at the start of a word', () => {
  // الكو (typing الكوباية): not one of the shop's words, so the start of a word as before.
  assert.ok(SEARCH.match(SEARCH.index('الكوباية الكبيرة'), SEARCH.query('الكو')));
  // ألوان / ألعاب start with ال but are not "the": still found after the article (الألوان, الألعاب).
  assert.ok(SEARCH.match(SEARCH.index('كل الألوان'), SEARCH.query('ألوان')));
  assert.ok(SEARCH.match(SEARCH.index('وقت الألعاب'), SEARCH.query('ألعاب')));
  assert.ok(SEARCH.match(SEARCH.index('البوم صور'), SEARCH.query('البوم')));
  // A three-letter word after its article: at the start of a word, as without it.
  assert.ok(SEARCH.match(SEARCH.index('شنطة قماش'), SEARCH.query('الكيس')));
  assert.ok(!SEARCH.match(SEARCH.index('إكسسوارات', true), SEARCH.query('الكيس')));
});

// ---------- Home page: the products as index.html indexes and orders them ----------
const page = read('public/index.html');
function home() {
  const S = vm.runInNewContext(`${page.slice(page.indexOf('// search-kit:start'), page.indexOf('// search-kit:end'))}\nSEARCH`);
  const ALIASES = vm.runInNewContext(`(${page.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  // index.html's lines from the product text (names, descriptions, category, aliases, sizes, colours) to `found`
  // (what a search lists), run as they are.
  const from = page.indexOf('const catName = ');
  const to = page.indexOf('// Real product photos');
  assert.ok(from > 0 && to > from, 'index.html has the product text');
  const block = page.slice(from, to);
  const names = ['sizeWords', 'colorWords', 'hay', 'isColor', 'forYear', 'inText', 'found'];
  for (const name of names) assert.match(block, new RegExp(`const ${name} = `));
  const { PRODUCTS, CATEGORIES } = require('../src/products');
  const ctx = { products: PRODUCTS, categories: CATEGORIES, ALIASES, SEARCH: S, norm: S.norm, loose: S.loose, POD: { assetId: (p) => p.base || p.id } };
  const lines = vm.runInNewContext(`${block}\n({ ${names.join(', ')} })`, ctx);
  const { hay, found } = lines;
  // The page's own ordering line, run as it is: names first, whole words before words that only start with it.
  const rankLine = page.match(/const rank = \(p\) => [^\n]+;/);
  assert.ok(rankLine, 'index.html has rank');
  // (With the gift and occasion order before it, and the page's own sorting line: UX item 4, 27 Nov.)
  const occasionLine = page.match(/const byOccasion = \(h, tq\) => [^\n]+;/);
  const sortLine = page.match(/if \(ts\.length\) list = list\.map\(\(p, i\) => \[rank\(p\), i, p\]\)[^\n]+;/);
  assert.ok(occasionLine && sortLine, 'index.html has the occasion order and the sorting');
  /** What the home page lists for a search, in its order. */
  const find = (q) => {
    const ts = S.norm(q).split(' ').filter(Boolean);
    const qs = S.query(q);
    const list = vm.runInNewContext(`${occasionLine[0]}\n${rankLine[0]}\nlet list = products.filter((p) => found(p, qs));\n${sortLine[0]}\nlist`, { ...lines, ts, qs, SEARCH: S, loose: S.loose, products: PRODUCTS });
    return list.map((p) => p.id);
  };
  return { S, PRODUCTS, find, hay };
}

test('home search: a product with a size or a quantity ("tshirt xl", "A5 flyers") finds it', () => {
  const { PRODUCTS, find: findP } = home();
  const want = { 'A5 flyers': 'flyers', 'flyers A5': 'flyers', 'فلاير A5': 'flyers', 'tshirt xl': 'tshirt', 'tshirt XL': 'tshirt', 'تيشيرت xl': 'tshirt', 'كروت شخصية 100': 'bizcards', 'business cards 500': 'bizcards', 'مج 11oz': 'mug', 'mug 11oz': 'mug', 'mug 325 ml': 'mug', 'مج 325 مل': 'mug' };
  for (const [q, id] of Object.entries(want)) assert.ok(findP(q).includes(id), `"${q}" finds ${id} (got ${findP(q).join(', ') || 'nothing'})`);
  // A size with the wrong product finds nothing of it.
  assert.ok(!findP('tshirt 11oz').includes('tshirt'));
  assert.ok(!findP('mug xl').includes('mug'));
  assert.ok(!findP('A5 flyers').includes('tshirt'));
  // The size is not looked for in the names: "tshirt xl" lists the T-shirts first, the Sweatshirt after them.
  const txl = findP('tshirt xl');
  assert.strictEqual(txl[0], 'tshirt');
  for (const id of ['polo', 'oversized', 'jersey']) assert.ok(txl.indexOf(id) >= 0 && txl.indexOf(id) < txl.indexOf('sweatshirt'), `tshirt xl: ${txl.join(', ')}`);
  assert.strictEqual(findP('mug 11oz')[0], 'mug');
  // A size alone: every product with that size (or named with it), nothing else.
  const xl = findP('xl');
  assert.ok(xl.includes('tshirt') && xl.includes('hoodie'), `xl: ${xl.join(', ')}`);
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const named = (id) => /xl/i.test(`${byId[id].name.en} ${byId[id].name.ar}`);
  for (const id of xl) assert.ok(named(id) || byId[id].sizes.some((z) => /xl/i.test(`${z.id} ${z.label.en} ${z.label.ar}`)), `xl: ${id} has an XL size (or is named XL)`);
  assert.ok(!xl.includes('mug') && !xl.includes('flyers') && !xl.includes('bizcards'));
  // "One size" is not a size to search for: "size" / "مقاس" alone don't list every bag and cap.
  for (const q of ['size', 'مقاس', 'one']) for (const id of ['tote', 'apron', 'lunchbag', 'pencilcase']) assert.ok(!findP(q).includes(id), `${q} is not the ${id}: ${findP(q).join(', ')}`);
});

test('home search: كوب lists the mugs before the gift vouchers (كوبونات), كاب the cap before the couple mugs (للكابلز)', () => {
  const { S, find } = home();
  const mugs = find('كوب');
  assert.ok(mugs.includes('giftvouchers'), 'كوبونات still found (as typed, the start of a word)');
  for (const id of ['mug', 'magicmug', 'couplemugs']) assert.ok(mugs.indexOf(id) >= 0 && mugs.indexOf(id) < mugs.indexOf('giftvouchers'), `كوب: ${id} before giftvouchers (${mugs.join(', ')})`);
  assert.strictEqual(mugs[0], 'mug');
  const caps = find('كاب');
  assert.strictEqual(caps[0], 'cap', `كاب: ${caps.join(', ')}`);
  if (caps.includes('couplemugs')) assert.ok(caps.indexOf('couplemugs') > caps.indexOf('cap'));
  // In the kit: as a whole word (to rank names), كوب is not كوبونات and كاب not للكابلز; the mug and the cap are.
  const q = (w) => S.query(w);
  assert.ok(!S.match(S.index('Gift Vouchers كوبونات هدايا (جيفت فاوتشر)', true), q('كوب'), 'word'));
  assert.ok(S.match(S.index('Ceramic Mug مج سيراميك', true), q('كوب'), 'word'));
  assert.ok(!S.match(S.index('Couple Mugs (pair) مجين للكابلز', true), q('كاب'), 'word'));
  assert.ok(S.match(S.index('Baseball Cap كاب', true), q('كاب'), 'word'));
  assert.ok(S.match(S.index('Baseball Cap كاب', true), q('caps'), 'word'));
  assert.ok(!S.match(S.index('Crewneck Sweatshirt سويتشيرت', true), q('tshirt'), 'word'));
  // "tshirt" still puts the T-shirts before the Sweatshirt.
  const tees = find('tshirt');
  assert.ok(tees.indexOf('tshirt') < tees.indexOf('sweatshirt') || !tees.includes('sweatshirt'));
});

test('home search: المج / للمج / والمج / بالمج find what مج finds (the mugs), in the same order', () => {
  const { S, find } = home();
  const mugs = find('مج');
  for (const id of ['mug', 'magicmug', 'couplemugs']) assert.ok(mugs.includes(id), `مج finds ${id} (got ${mugs.join(', ')})`);
  for (const q of ['المج', 'للمج', 'والمج', 'بالمج', 'المَج', 'المجات', 'المج الأبيض']) {
    const want = q === 'المج الأبيض' ? find('مج ابيض') : mugs;
    assert.deepStrictEqual(find(q), want, q);
  }
  // A design or product that says "المج" / "بالمج" is found by مج, mug and كوب.
  for (const text of ['اشرب قهوتك بالمج', 'حوالين المج']) for (const q of ['مج', 'mug', 'كوب']) assert.ok(S.match(S.index(text), S.query(q)), `${q} finds "${text}"`);
  // The earlier rules hold: أب alone is not after an article, and "with the" / "and the" + 2 letters is not an
  // article unless the 2 are one of the shop's words (بالون, والده: as typed, not ون / ده).
  assert.deepStrictEqual([...S.query('بالون')[0].forms], []);
  assert.deepStrictEqual([...S.query('بالون')[0].concepts], []);
  assert.ok(!S.match(S.index('ونش'), S.query('بالون')));
  assert.ok(!S.match(S.index('ده هدية'), S.query('والده')));
  assert.ok(S.match(S.index('بالونات عيد ميلاد'), S.query('بالون')));
});

test('ready designs: والمج / بالمج are the mug, والأب / بالأم the dad and the mum, not "forever" or the exams', () => {
  const T = { ...D, mugAr: 'قهوة الصبح في المج القهوة', mug: 'Coffee first Coffee first coffee mug' };
  const ix = Object.fromEntries(Object.entries(T).map(([id, t]) => [id, SEARCH.index(t)]));
  const findT = (q) => Object.keys(T).filter((id) => SEARCH.match(ix[id], SEARCH.query(q)));
  for (const q of ['مج', 'المج', 'للمج', 'والمج', 'بالمج']) {
    const got = findT(q);
    for (const id of ['mug', 'mugAr']) assert.ok(got.includes(id), `"${q}" finds ${id} (got ${got.join(', ') || 'nothing'})`);
    for (const id of ['mum', 'dad', 'forever', 'exams']) assert.ok(!got.includes(id), `"${q}" is not ${id} (got ${got.join(', ')})`);
  }
  for (const [q, want, notWant] of [['والأب', ['dad'], ['forever', 'forever2', 'dimensions', 'heroes', 'mum']], ['بالأم', ['mum', 'mumAr'], ['exams', 'llama', 'dad']]]) {
    const got = findT(q);
    for (const id of want) assert.ok(got.includes(id), `"${q}" finds ${id} (got ${got.join(', ') || 'nothing'})`);
    for (const id of notWant) assert.ok(!got.includes(id), `"${q}" is not ${id} (got ${got.join(', ')})`);
  }
});

test('home search: مصلية / مصلاية find the prayer mat, فنجان the mugs, قميص the T-shirts', () => {
  const { find } = home();
  for (const w of ['مصلية', 'مصلاية', 'مصليه', 'المصلية', 'prayer mat', 'سجادة صلاة']) assert.strictEqual(find(w)[0], 'prayermat', `${w}: ${find(w).join(', ')}`);
  for (const w of ['فنجان', 'فناجين']) {
    const got = find(w);
    for (const id of ['mug', 'magicmug', 'couplemugs']) assert.ok(got.includes(id), `${w} finds ${id} (got ${got.join(', ') || 'nothing'})`);
    assert.ok(!got.includes('tshirt'));
  }
  for (const w of ['قميص', 'قمصان']) {
    const got = find(w);
    for (const id of ['tshirt', 'polo', 'oversized', 'jersey']) assert.ok(got.includes(id), `${w} finds ${id} (got ${got.join(', ') || 'nothing'})`);
    assert.ok(!got.includes('mug'));
  }
});

test('home search: a product with a colour ("تيشيرت أبيض", "هودي اسود", "مج ابيض", "white t-shirt", "black hoodie") lists that product in that colour', () => {
  const { PRODUCTS, find } = home();
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  // The colours' names, without the note after them (the magic mug is "Black (turns white when hot)").
  const comesIn = (id, en) => byId[id].colors.some((c) => c.name.en.split(/[(:,]/)[0].toLowerCase().split(' ').includes(en));
  const tees = ['tshirt', 'kidstee', 'polo', 'oversized', 'jersey'];
  // "تيشيرت" alone lists what it did before the colours came in, in the same order.
  assert.deepStrictEqual(find('تيشيرت'), [...tees, 'sweatshirt']);
  // The T-shirts that come in white (the Sweatshirt doesn't), with and without hamza and ال, in both languages.
  for (const q of ['تيشيرت أبيض', 'تيشيرت ابيض', 'التيشيرت الأبيض', 'white t-shirt', 'white tshirts', 't-shirt White']) {
    assert.deepStrictEqual(find(q), tees.filter((id) => comesIn(id, 'white')), q);
  }
  for (const q of ['هودي اسود', 'هودي أسود', 'الهودي الأسود', 'black hoodie', 'hoodies black']) {
    assert.deepStrictEqual(find(q), ['hoodie', 'ziphoodie', 'kidshoodie'], q);
  }
  for (const q of ['مج ابيض', 'مج أبيض', 'white mug']) {
    const got = find(q);
    assert.strictEqual(got[0], 'mug', `${q}: ${got.join(', ')}`);
    assert.ok(got.includes('couplemugs'), `${q}: ${got.join(', ')}`);
    // The magic mug is black: "(turns white when hot)" is a note, not a colour.
    assert.ok(!got.includes('magicmug'), `${q}: ${got.join(', ')}`);
    for (const id of got) assert.ok(comesIn(id, 'white'), `${q}: ${id} comes in white`);
  }
  // A colour the product doesn't come in: none of it (the hoodies have no white).
  for (const q of ['هودي ابيض', 'white hoodie']) for (const id of ['hoodie', 'ziphoodie', 'kidshoodie']) assert.ok(!find(q).includes(id), `${q}: ${find(q).join(', ')}`);
  // The colour is not looked for in the names, as a size isn't: "navy t-shirt" lists the T-shirts in navy before the
  // Sweatshirt (navy too), in the order "t-shirt" lists them.
  for (const q of ['navy t-shirt', 'تيشيرت كحلي', 'tshirt xl navy']) {
    const got = find(q);
    const named = got.filter((id) => id !== 'sweatshirt');
    assert.deepStrictEqual(got.slice(0, named.length), named, `${q}: the T-shirts first (${got.join(', ')})`);
    assert.ok(named.length >= 3 && named.every((id) => tees.includes(id) && comesIn(id, 'navy')), `${q}: ${got.join(', ')}`);
  }
  assert.ok(find('navy t-shirt').includes('sweatshirt'), 'the navy Sweatshirt is still listed, after the T-shirts');
});

test('home search: colours alone list the products in them, and make no other word find more', () => {
  const { PRODUCTS, find } = home();
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  // "white" alone may list everything that comes in white; not the hoodies (none is white).
  const white = find('white');
  for (const id of ['tshirt', 'mug', 'cap']) assert.ok(white.includes(id), `white: ${white.join(', ')}`);
  for (const id of ['hoodie', 'ziphoodie', 'magicmug']) assert.ok(!white.includes(id), `white: ${white.join(', ')}`);
  // A colour is a whole word, spelt as it is: "mat" is not the matte cards, "black" not the blackout curtains,
  // ورد (roses) not the pink (وردي) products, and "art" / "design" not the notes after a colour's name.
  for (const id of ['bizcards', 'postcards', 'menus']) assert.ok(!find('mat').includes(id), `mat: ${find('mat').join(', ')}`);
  assert.ok(find('mat').includes('prayermat') && find('mat').includes('deskmat'));
  assert.ok(!find('black').includes('curtains') && !find('black curtains').includes('curtains'));
  for (const id of ['mug', 'onesie', 'kidstee']) assert.ok(!find('ورد').includes(id), `ورد: ${find('ورد').join(', ')}`);
  assert.ok(!find('art').includes('coloringbook') && !find('design').includes('canvas'));
  // The calendar ("Matte card", 100 calendars) is not a card by name: in "card" and "card 100" it stays with the
  // products found by their other words (after the gift vouchers and folders, which come before it in the catalogue),
  // not with the business cards and postcards.
  for (const q of ['card', 'card 100', 'كارت', 'كارت 100']) {
    const got = find(q);
    const at = got.indexOf('calendar');
    assert.ok(at > got.indexOf('bizcards') && at > got.indexOf('giftvouchers') && at > got.indexOf('folders') && got.indexOf('folders') >= 0, `${q}: ${got.join(', ')}`);
  }
  assert.ok(byId.calendar.colors.some((c) => /card/i.test(c.name.en)), 'the calendar is still on card (else this check says nothing)');
});

// ---------- QA 26 Nov: colours said other ways, more of the shop's words, years, words inside words, spelling ----------
test('home search: a colour in the feminine (سوداء / سودا, بيضا, حمرا…), gray, رصاصي and beige find what the colour finds', () => {
  const { PRODUCTS, find } = home();
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  // Every way of saying the colour lists the same products, in the same order, as the shop's own name for it.
  const same = (q, as) => {
    const want = find(as);
    assert.ok(want.length, `"${as}" finds something (else this check says nothing)`);
    assert.deepStrictEqual(find(q), want, `"${q}" lists what "${as}" lists`);
  };
  const colours = { 'اسود': ['سوداء', 'سودا', 'السوداء', 'السودا'], 'ابيض': ['بيضاء', 'بيضا', 'البيضا'], 'احمر': ['حمراء', 'حمرا'], 'اخضر': ['خضراء', 'خضرا'], 'ازرق': ['زرقاء', 'زرقا'], 'اصفر': ['صفراء', 'صفرا'] };
  const norm = (s) => s.replace(/[أإآ]/g, 'ا');
  for (const [masc, fem] of Object.entries(colours)) {
    // Alone: every product that comes in the colour (a description that says أبيض is still found by أبيض only).
    const comesIn = PRODUCTS.filter((p) => p.colors.some((c) => norm(c.name.ar.split(/[(:,،]/)[0]).split(' ').includes(masc))).map((p) => p.id);
    assert.ok(comesIn.length, masc);
    for (const f of fem) {
      const got = find(f);
      for (const id of comesIn) assert.ok(got.includes(id), `"${f}" finds ${id}, which comes in ${masc} (got ${got.join(', ') || 'nothing'})`);
      for (const id of got) assert.ok(find(masc).includes(id), `"${f}": ${id} is found by ${masc} too`);
    }
    // With a product that comes in it, as the QA typed them: the same list as the shop's name for the colour.
    for (const product of ['تيشيرت', 'تيشرت', 'شنطة', 'مج', 'كاب']) if (find(`${product} ${masc}`).length) for (const f of fem) same(`${product} ${f}`, `${product} ${masc}`);
  }
  same('شنطة سوداء', 'شنطة اسود');
  same('شنطة سودا', 'شنطة اسود');
  assert.strictEqual(find('شنطة سوداء')[0], 'tote');
  assert.deepStrictEqual(find('تيشرت بيضا').slice(0, 4), ['tshirt', 'kidstee', 'polo', 'oversized']);
  assert.strictEqual(find('تيشيرت سودا')[0], 'tshirt');
  // Grey: gray in English, رصاصي in Arabic.
  same('gray hoodie', 'grey hoodie');
  same('gray t-shirt', 'grey t-shirt');
  same('gray', 'grey');
  same('هودي رصاصي', 'هودي رمادي');
  same('رصاصي', 'رمادي');
  assert.deepStrictEqual(find('gray hoodie'), ['hoodie', 'ziphoodie', 'kidshoodie']);
  assert.strictEqual(find('gray t-shirt')[0], 'tshirt');
  // Beige: the shop's Sand (بيج).
  assert.ok(byId.cap.colors.some((c) => c.id === 'sand' && /بيج/.test(c.name.ar)), 'the cap comes in Sand (بيج)');
  for (const q of ['beige cap', 'sand cap', 'كاب بيج', 'cap beige']) assert.deepStrictEqual(find(q), ['cap'], q);
  same('beige', 'sand');
  // Words that are not colours stay as they were: "mat" is not the matte cards, ورد not the pink products.
  assert.ok(!find('mat').includes('bizcards'));
  assert.ok(!find('ورد').includes('mug'));
  // A colour the product doesn't come in still finds none of it (no hoodie is white).
  for (const q of ['هودي بيضا', 'هودي بيضاء']) for (const id of ['hoodie', 'ziphoodie', 'kidshoodie']) assert.ok(!find(q).includes(id), `${q}: ${find(q).join(', ')}`);
});

test('home search: سلسلة مفاتيح / keyring find the keychain, leaflets the flyers, a calendar with a year the calendars', () => {
  const { find } = home();
  for (const q of ['سلسلة مفاتيح', 'سلسله مفاتيح', 'ميدالية مفاتيح', 'keyring', 'keyrings', 'key ring', 'key chain', 'keychain']) assert.strictEqual(find(q)[0], 'keychain', `${q}: ${find(q).join(', ') || 'nothing'}`);
  for (const q of ['leaflet', 'leaflets', 'Leaflets']) assert.strictEqual(find(q)[0], 'flyers', `${q}: ${find(q).join(', ') || 'nothing'}`);
  // A year doesn't stop a calendar match (any year, typed before or after, in Arabic digits too).
  const calendars = find('calendar');
  assert.deepStrictEqual(calendars, ['calendar', 'deskcalendar']);
  for (const q of ['calendar 2026', 'calendar 2027', '2027 calendar', 'calendars 2027', 'نتيجة 2027', 'نتيجه ٢٠٢٧', 'نتيجة مكتب 2027']) {
    const got = find(q);
    assert.ok(got.length && got.every((id) => calendars.includes(id)), `${q}: ${got.join(', ') || 'nothing'}`);
  }
  assert.deepStrictEqual(find('calendar 2027'), calendars);
  assert.deepStrictEqual(find('نتيجة 2027'), calendars);
  assert.strictEqual(find('نتيجة مكتب 2027')[0], 'deskcalendar');
  // A year is for the calendars only: not a mug "2027"; and a number that isn't a year doesn't count as one.
  assert.deepStrictEqual(find('mug 2027'), []);
  assert.deepStrictEqual(find('calendar 1234'), []);
});

test('home search: "hat" is the cap, not the "that" of a description; English words in descriptions count from the start of a word', () => {
  const { find } = home();
  assert.deepStrictEqual(find('hat'), ['cap']);
  assert.deepStrictEqual(find('hats'), ['cap']);
  // Inside a word of a description: "sign" is not "design", "pen" not "opens", "tee" not "steel", "bed" not "combed".
  // (The villa sign and the desk nameplates, 27 Nov, and the round door hanger, 28 Nov, are signs too.)
  assert.deepStrictEqual(find('sign'), ['sign', 'weddingsign', 'doorsign', 'villasign', 'acrylicnameplate', 'woodnameplate', 'doorhanger']);
  assert.deepStrictEqual(find('pen'), ['engrpen', 'pencilcase']);
  assert.ok(!find('tee').includes('bottle') && find('tee').includes('tshirt'));
  assert.deepStrictEqual(find('bed'), ['bedsheet']);
  // From the start of a word it still counts ("print": printed, "cotton"), and names keep words inside words
  // (postcards for "card", the notebook for "book", the keychain for "chain").
  assert.ok(find('printed').includes('tshirt') && find('cotton').includes('tshirt'));
  assert.ok(find('card').includes('postcards') && find('book').includes('notebook') && find('chain').includes('keychain'));
  // Two words that may name one thing still count across the name and the description, as before.
  for (const id of ['bizcards', 'certificates', 'menus']) assert.ok(find('business cards').includes(id), `business cards: ${find('business cards').join(', ')}`);
  // Arabic in descriptions as before: a word after و / ب (وطباعة) is found.
  assert.ok(find('طباعة').includes('tshirt'));
});

test('home search: كتيب lists the booklets (كتيبات) before the bookmarks (فواصل كتب), كتب the other way round', () => {
  const { find } = home();
  for (const q of ['كتيب', 'كتيبات', 'الكتيب']) {
    const got = find(q);
    assert.strictEqual(got[0], 'booklets', `${q}: ${got.join(', ')}`);
    assert.ok(got.indexOf('bookmarks') > got.indexOf('booklets'), `${q}: ${got.join(', ')}`);
  }
  const books = find('كتب');
  assert.ok(books.indexOf('bookmarks') >= 0 && books.indexOf('bookmarks') < books.indexOf('booklets'), `كتب: ${books.join(', ')}`);
  // A name spelt another way still comes before the rest: تيشرت (without the ي) lists the T-shirts first.
  assert.deepStrictEqual(find('تيشرت'), ['tshirt', 'kidstee', 'polo', 'oversized', 'jersey', 'sweatshirt']);
});
