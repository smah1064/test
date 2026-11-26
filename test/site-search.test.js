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
  assert.deepStrictEqual([...S['search.none']], ['Nothing found with that name. Try another word.', 'مالقيناش حاجة بالاسم ده. جرّب كلمة تانية']);
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
