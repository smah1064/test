'use strict';

// Arabic words with "the" / "for (the)" in front (الأم, للأب, لأمي), Valentine's / Teacher's Day and a new baby
// (QA 25 Nov), the home page's sizes ("tshirt xl", "A5 flyers"), its order (كوب: the mugs before كوبونات) and more
// of the shop's words (مصلية, فنجان, قميص). The search block and the home page's lines are run as they are.
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
  const aliases = vm.runInNewContext(`(${page.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  // The line of index.html that gives a product's size words, run as it is.
  const line = page.match(/const sizeWords = [^\n]+;/);
  assert.ok(line, 'index.html has sizeWords');
  const sizeWords = vm.runInNewContext(`${line[0]}\nsizeWords`);
  // The product text as index.html builds it (names, descriptions, category, aliases, sizes).
  assert.match(page, /ALIASES\[p\.id\] \|\| ALIASES\[POD\.assetId\(p\)\] \|\| '', sizeWords\(p\)\]\.join\(' '\)/);
  assert.match(page, /return \[p\.id, \{ all: SEARCH\.index\(text, true\), name: ` \$\{norm\(name\)\} `, named: SEARCH\.index\(name, true\), sized: SEARCH\.index\(sizeWords\(p\), true\) \}\];/);
  const { PRODUCTS, CATEGORIES } = require('../src/products');
  const cat = (id) => (CATEGORIES.find((c) => c.id === id) || { name: {} }).name;
  const hay = new Map(PRODUCTS.map((p) => {
    const name = `${p.name.en} ${p.name.ar}`;
    const text = [p.id, name, p.description && p.description.en, p.description && p.description.ar, cat(p.category).en, cat(p.category).ar, aliases[p.id] || aliases[p.base] || '', sizeWords(p)].join(' ');
    return [p.id, { all: S.index(text, true), name: ` ${S.norm(name)} `, named: S.index(name, true), sized: S.index(sizeWords(p), true) }];
  }));
  // The page's own ordering line, run as it is: names first, whole words before words that only start with it.
  const rankLine = page.match(/const rank = \(p\) => [^\n]+;/);
  assert.ok(rankLine, 'index.html has rank');
  /** What the home page lists for a search, in its order. */
  const find = (q) => {
    const ts = S.norm(q).split(' ').filter(Boolean);
    const qs = S.query(q);
    const rank = vm.runInNewContext(`${rankLine[0]}\nrank`, { hay, ts, qs, SEARCH: S, loose: S.loose });
    return PRODUCTS.filter((p) => S.match(hay.get(p.id).all, qs)).map((p, i) => [rank(p), i, p.id]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
  };
  return { S, PRODUCTS, find };
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
