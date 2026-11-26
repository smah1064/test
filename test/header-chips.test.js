'use strict';

// Phones: the header keeps the full logo, account, Cart and the language button on top, and the menu links move to
// a row of chips under it (Products, Ready designs, Photo prints, Kids' books, T-shirts, Mugs). The same snippet is
// in all 15 shop headers (not the editor's or the admin's), the labels are in English and Egyptian Arabic, and the
// old phone rules that hid Kids' books or swapped the English logo for the icon mark are gone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const SHOP_PAGES = ['404', 'account', 'book', 'cart', 'design', 'designs', 'index', 'invoice', 'order', 'photos', 'privacy', 'product', 'proof', 'rights', 'share'];
const chipsOf = (html) => (html.match(/<nav class="nav-chips"[\s\S]*?<\/nav>/) || [])[0];

test('every shop header has the same chips row, inside the header, with the six links in order', () => {
  const first = chipsOf(pub('index.html'));
  assert.ok(first, 'the home page has the chips row');
  const links = [...first.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-chip="([^"]+)"[^>]*data-i18n="([^"]+)"/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepStrictEqual(links, [
    ['/#products', 'products', 'nav.products'],
    ['/designs', 'designs', 'nav.designs'],
    ['/photos', 'photos', 'nav.photos'],
    ['/?cat=kids#products', 'books', 'nav.books'],
    ['/product?id=tshirt', 'tshirt', 'nav.tshirts'],
    ['/product?id=mug', 'mug', 'nav.mugs'],
  ]);
  for (const p of SHOP_PAGES) {
    const html = pub(`${p}.html`);
    assert.strictEqual(chipsOf(html), first, `${p}.html: the same snippet`);
    const header = html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
    assert.ok(header.includes(first), `${p}.html: inside the site header`);
  }
  for (const p of ['editor', 'admin']) assert.doesNotMatch(pub(`${p}.html`), /nav-chips/, `${p}.html is left alone`);
});

test('the chips\' labels: English and Arabic, kept together after nav.booksShort', () => {
  const window = {};
  vm.runInNewContext(pub('js/i18n.js'), { window });
  const S = window.POD_STRINGS;
  assert.deepStrictEqual([...S['nav.tshirts']], ['T-shirts', 'تيشيرتات']);
  assert.deepStrictEqual([...S['nav.mugs']], ['Mugs', 'مجات']);
  assert.ok(S['nav.sections'][0] && S['nav.sections'][1]);
  for (const k of ['nav.products', 'nav.designs', 'nav.photos', 'nav.books', 'nav.tshirts', 'nav.mugs', 'nav.sections']) {
    assert.doesNotMatch(S[k][1], /محل/, `${k}: the site is never called محل`);
  }
  const order = Object.keys(S);
  const at = order.indexOf('nav.booksShort');
  assert.deepStrictEqual([...order.slice(at + 1, at + 4)], ['nav.tshirts', 'nav.mugs', 'nav.sections']);
});

test('styles: chips only on phones, no icon-only English logo, Kids\' books no longer hidden on phones', () => {
  const css = pub('css/styles.css');
  assert.match(css, /\.site-header \.nav-chips \{ display: none; \}/, 'hidden on computers and tablets');
  assert.match(css, /@media \(max-width: 600px\) \{[^}]*\{[^}]*\}[\s\S]*?\.site-header \.nav-chips \{\s*display: flex;/, 'a flex row at 600px and less');
  assert.match(css, /\.site-header \.nav-chips a \{[^}]*min-height: 40px/, 'tap targets at least 40px tall');
  assert.match(css, /\.site-header \.nav-chips \{[^}]*overflow-x: auto;[^}]*scrollbar-width: none/, 'swiped, no scrollbar');
  assert.doesNotMatch(css, /\.brand-mark-logo \{ display: block; \}/, 'the English logo is not swapped for the icon mark');
  assert.doesNotMatch(css, /\.nav-books \{ display: none; \}/, 'no width hides Kids\' books');
});
