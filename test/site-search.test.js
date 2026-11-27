'use strict';

// Search in the header (UX item A): a magnifier in the top row of all 15 shop headers (before the account icon) that
// opens a search bar under the header with up to five products as you type; Enter opens the home page's results.
// The same snippet in every shop page (not the editor's or the admin's), the words in English and Egyptian Arabic,
// and the products found exactly as the home page's own search finds them (its lines, run here as they are).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PRODUCTS, CATEGORIES } = require('../src/products');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const SHOP_PAGES = ['404', 'account', 'book', 'cart', 'design', 'designs', 'index', 'invoice', 'order', 'photos', 'privacy', 'product', 'proof', 'rights', 'share'];
const btnOf = (html) => (html.match(/ *<button type="button" class="site-search-btn"[^\n]*<\/button>\n/) || [])[0];
const panelOf = (html) => (html.match(/ *<div class="site-search" id="site-search" hidden>[\s\S]*?\n {4}<\/div>\n/) || [])[0];
const SRC = pub('js/site-search.js');

test('every shop header has the same magnifier (before Cart, so before the account icon) and the same search bar', () => {
  const btn = btnOf(pub('index.html'));
  const panel = panelOf(pub('index.html'));
  assert.ok(btn && panel, 'the home page has both');
  assert.match(btn, /aria-expanded="false"/);
  assert.match(btn, /aria-controls="site-search"/);
  assert.match(btn, /data-i18n-aria="search\.open"/);
  assert.match(panel, /<form [^>]*role="search"/);
  assert.match(panel, /<input type="search" name="q" [^>]*data-i18n-aria="search\.label"/, 'a labelled box');
  assert.match(panel, /data-site-search-close data-i18n-aria="search\.close"/, 'a ✕ with a name');
  assert.match(panel, /<ul class="site-search-list"/, 'the suggestions are a list');
  for (const p of SHOP_PAGES) {
    const html = pub(`${p}.html`);
    assert.strictEqual(btnOf(html), btn, `${p}.html: the same magnifier`);
    assert.strictEqual(panelOf(html), panel, `${p}.html: the same bar`);
    const header = html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
    const top = header.match(/<div class="container inner">[\s\S]*?<\/nav>/)[0];
    assert.ok(top.includes(btn + '        <a class="cart-link"'), `${p}.html: in the top row, right before Cart`);
    assert.ok(header.indexOf(panel) > header.indexOf('class="nav-chips"'), `${p}.html: the bar under the chips, in the header`);
    assert.match(html, /<script src="\/js\/common\.js"><\/script>\n {2}<script src="\/js\/site-search\.js"><\/script>/, `${p}.html loads the script`);
  }
  for (const p of ['editor', 'admin']) assert.doesNotMatch(pub(`${p}.html`), /site-search/, `${p}.html is left alone`);
});

test('the words: English and Arabic, kept together right after nav.sections', () => {
  const window = {};
  vm.runInNewContext(pub('js/i18n.js'), { window });
  const S = window.POD_STRINGS;
  const order = Object.keys(S);
  const at = order.indexOf('nav.sections');
  const keys = ['search.open', 'search.label', 'search.placeholder', 'search.close', 'search.suggestions', 'search.from', 'search.none'];
  assert.deepStrictEqual(order.slice(at + 1, at + 1 + keys.length), keys);
  for (const k of keys) {
    assert.ok(S[k][0] && S[k][1], k);
    assert.doesNotMatch(S[k][1], /محل/, `${k}: the site is never called محل`);
  }
  assert.deepStrictEqual([...S['search.open']], ['Search', 'دوّر']);
  // (Since UX item 4, 27 Nov, «جرّب دول:» and things to tap follow it: the line says only that nothing was found.)
  assert.deepStrictEqual([...S['search.none']], ['Nothing found with that name.', 'مالقيناش حاجة بالاسم ده.']);
  assert.deepStrictEqual([...S['search.from']], ['from {price}', 'من {price}']);
});

// The block of the home page's lines in site-search.js.
const block = SRC.slice(SRC.indexOf('// site-search:start'), SRC.indexOf('// site-search:end'));

test('the header finds products with the home page\'s own lines (and the shared search kit)', () => {
  const home = pub('index.html').split('\n').map((l) => l.trim());
  let from = 0;
  const own = [];
  for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line.endsWith('// header only') || line.startsWith('// site-search:start') || line.startsWith('/** The home page\'s search over')) {
      own.push(line);
      continue;
    }
    const at = home.indexOf(line, from);
    assert.ok(at >= 0, `a line of the home page's search, in its order: ${line.slice(0, 90)}`);
    from = at + 1;
  }
  assert.ok(own.length <= 12, 'only a few lines of its own');
  const kit = (src) => src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end')).split('\n').map((l) => l.trim()).join('\n');
  assert.strictEqual(kit(SRC), kit(pub('js/designs.js')), 'the same search kit as /designs and the home page');
});

const finder = (() => {
  const POD = { assetId: (p) => p.base || p.id };
  const make = vm.runInNewContext(`${block}\nmakeFinder`, { POD });
  return make(PRODUCTS, CATEGORIES);
})();
const ids = (q) => finder(q).map((p) => p.id);

test('what the header suggests: Arabic and English, forgiving, best first', () => {
  assert.deepStrictEqual(ids('مج').slice(0, 3), ['mug', 'magicmug', 'couplemugs'], 'مج: the mugs first');
  assert.deepStrictEqual(ids('mug').slice(0, 3), ['mug', 'magicmug', 'couplemugs']);
  assert.strictEqual(ids('تيشيرت أبيض')[0], 'tshirt', 'a colour with the product: the T-shirt first');
  assert.strictEqual(ids('تيشرت')[0], 'tshirt', 'spelt without the ي');
  assert.ok(ids('cards').includes('bizcards'), 'cards: the business cards');
  assert.ok(ids('كروت شخصية').includes('bizcards'));
  assert.deepStrictEqual(ids('xyzq'), [], 'nothing');
  assert.deepStrictEqual(ids('$&'), [], 'only symbols: nothing, not everything');
});

// QA 26 Nov: كرة / جرسيه find the jersey, فاتورة the invoice book, ليتر هيد the letterhead.
test('the header finds the jersey by كرة and جرسيه, the invoice book by فاتورة, the letterhead by ليتر هيد', () => {
  for (const [q, id] of [['كرة', 'jersey'], ['جرسيه', 'jersey'], ['فاتورة', 'invoicebook'], ['فاتوره', 'invoicebook'], ['ليتر هيد', 'letterhead']]) {
    assert.ok(ids(q).includes(id), `${q} → ${id} (${ids(q).slice(0, 5)})`);
  }
});

// ---------- UX item 4 (owner's OK, 27 Nov): nothing found offers things to tap; gift and occasion words ----------

test('nothing found: the home page\'s best sellers (the same list), the words in both languages', () => {
  const line = (src) => (src.match(/^ *const BEST = \[[^\n]*\];$/m) || [])[0];
  assert.ok(line(SRC), 'site-search.js has the best sellers');
  assert.strictEqual(line(SRC).trim(), line(pub('index.html')).trim(), 'the same best sellers as the home page');
  assert.match(SRC, /const TRY_BEST = 4;/, 'the top 4');
  const window = {};
  vm.runInNewContext(pub('js/i18n.js'), { window });
  const S = window.POD_STRINGS;
  assert.deepStrictEqual([...S['search.try']], ['Try these:', 'جرّب دول:']);
  assert.deepStrictEqual([...S['search.allDesigns']], ['See all ready designs', 'شوف كل التصميمات الجاهزة']);
  for (const k of ['search.try', 'search.tryDesigns', 'search.allDesigns', 'home.noMatchTry']) {
    assert.ok(S[k][0] && S[k][1], k);
    assert.doesNotMatch(S[k][1], /محل/, `${k}: never محل`);
    assert.doesNotMatch(S[k].join(' '), /عند الاستلام|on delivery|cash/i, `${k}: no cash on delivery`);
  }
  // The ready designs are the shop's own pictures (no drawing in the dropdown), and each one offered has one.
  const designed = JSON.parse(pub('img/designed/index.json'));
  const picks = SRC.match(/const TRY_DESIGNS = \[([^\]]*)\]/)[1].match(/'([a-z0-9]+)'/g).map((x) => x.slice(1, -1));
  assert.ok(picks.length >= 4);
  for (const id of picks.slice(0, 4)) assert.ok(designed[id] && designed[id].file && designed[id].design, `${id} has a picture with a ready design`);
});

test('gift words: «هدية عيد ميلاد» / "birthday gift" list the mug, the T-shirt and the cushion first', () => {
  for (const q of ['هدية عيد ميلاد', 'birthday gift', 'هدايا عيد ميلاد', 'birthday present', 'هديه عيد ميلاد']) {
    assert.deepStrictEqual(ids(q).slice(0, 5), ['mug', 'tshirt', 'cushion', 'magicmug', 'couplemugs'], q);
    // The invitation cards and the wrapping paper are still found, after the gifts.
    for (const id of ['invitations', 'wrappingpaper']) assert.ok(ids(q).indexOf(id) > ids(q).indexOf('couplemugs'), `${q}: ${id} after the gifts`);
  }
  // A gift alone: the gift vouchers and the wrapping paper (هدايا in their names) first, then the gifts.
  // ("present" alone also starts the name of the Presentation Folders, as before.)
  for (const q of ['هدية', 'هدايا', 'gift', 'gifts']) {
    // (The Quran Gift Box, 27 Nov, has "Gift" in its English name: found by its name, before the gifts.)
    const got = ids(q).filter((id) => id !== 'quranbox');
    assert.deepStrictEqual(got.slice(0, 2), ['giftvouchers', 'wrappingpaper'], q);
    assert.deepStrictEqual(got.slice(2, 5), ['mug', 'tshirt', 'cushion'], q);
  }
});

test('occasion words find the gifts in either language (they found nothing before)', () => {
  const firstThree = (q, want) => assert.deepStrictEqual(ids(q).slice(0, want.length), want, `${q}: ${ids(q).slice(0, 6)}`);
  for (const q of ['عيد الأم', 'عيد الام', "mother's day", 'هدية عيد الأم', 'هدية لأمي']) firstThree(q, ['mug', 'tshirt', 'cushion']);
  for (const q of ['عيد الحب', 'فالنتاين', 'valentine', "valentine's day", 'هدية عيد الحب']) firstThree(q, ['mug', 'tshirt', 'cushion']);
  for (const q of ['تخرج', 'هدية تخرج', 'graduation gift']) assert.ok(['mug', 'tshirt', 'keychain'].every((id) => ids(q).includes(id)), q);
  firstThree('هدية تخرج', ['mug', 'tshirt', 'magicmug']);
  // A new baby: the baby onesie (a baby in its name) first, then the cushion and the photo album.
  for (const q of ['هدية مولود', 'baby gift', 'هدية سبوع']) firstThree(q, ['onesie', 'cushion', 'photobook']);
  // A wedding (فرح / جواز): its own things first (the welcome sign, the couple mugs, the invitations), then the gifts.
  for (const q of ['فرح', 'جواز', 'wedding']) {
    const got = ids(q);
    assert.strictEqual(got[0], 'weddingsign', q);
    assert.ok(got.indexOf('invitations') < got.indexOf('mug') && got.includes('cushion'), `${q}: ${got}`);
  }
  firstThree('هدية جواز', ['mug', 'cushion', 'couplemugs']);
  // A birthday without "gift": the invitations first (they say it themselves), the gifts after.
  for (const q of ['عيد ميلاد', 'birthday']) {
    const got = ids(q);
    assert.strictEqual(got[0], 'invitations', q);
    assert.ok(got.includes('mug') && got.includes('caketopper'), `${q}: ${got}`);
  }
});

test('occasion words are whole words: "tea" is not "teacher", "men" not "engagement", and the old searches stay', () => {
  assert.ok(!ids('tea').includes('keychain') && !ids('tea').includes('tote'), `tea: ${ids('tea')}`);
  assert.ok(!ids('men').includes('mug') && !ids('men').includes('cushion'), `men: ${ids('men')}`);
  assert.deepStrictEqual(ids('day'), [], 'day alone: nothing');
  assert.deepStrictEqual(ids('مج').slice(0, 3), ['mug', 'magicmug', 'couplemugs']);
  assert.strictEqual(ids('تيشيرت')[0], 'tshirt');
  assert.deepStrictEqual(ids('xyzq'), []);
});

test('the occasions are data on the products (src/products.js), in their order', () => {
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  for (const id of ['mug', 'tshirt', 'cushion', 'magicmug', 'couplemugs', 'keychain', 'photobook', 'engrframe', 'canvas', 'namepuzzle']) {
    assert.ok(byId[id].occasions.includes('gift'), `${id} is a gift`);
  }
  assert.deepStrictEqual(['mug', 'tshirt', 'cushion'].map((id) => byId[id].occasionRank), [1, 2, 3]);
  // The words are the search's own names for each occasion (the shared kit's SAME), so both languages find them.
  const kit = SRC.slice(SRC.indexOf('// search-kit:start'), SRC.indexOf('// search-kit:end'));
  const S = vm.runInNewContext(`${kit}\nSEARCH`);
  for (const p of PRODUCTS.filter((x) => x.occasions)) {
    for (const w of p.occasions) assert.ok(S.match(S.index(w), S.query(w)) && S.query(w)[0].concepts.includes(w), `${p.id}: ${w} is one of the search's occasions`);
  }
  // Nothing about the invitations or the wrapping paper is a "gift" of their own: they come after the gifts.
  assert.ok(!byId.invitations.occasions.includes('gift'));
  assert.ok(!byId.wrappingpaper.occasions);
});
