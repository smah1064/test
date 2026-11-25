'use strict';

// QA (shop, 25 Nov): ready designs with {fields} are filled in in the editor, the home search knows more
// Egyptian words, the order page shows one delivery day, Arabic cart lines use the Arabic comma, and the
// "No connection" wording. No server, no browser: the pages' own lines are run as they are.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

function strings() {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  return window.POD_STRINGS;
}

test('the new words are in both languages, and the site is never called محل', () => {
  const S = strings();
  for (const k of ['net.title', 'net.text', 'net.retry', 'net.still', 'design.fillIn', 'design.fillNote', 'pp.fillIn', 'cart.removed', 'cart.undo', 'sizeAsk.title', 'sizeAsk.one', 'houses.cancel']) {
    assert.ok(Array.isArray(S[k]) && S[k].length === 2 && S[k][0] && S[k][1], `${k} in English and Arabic`);
    assert.doesNotMatch(S[k][1], /محل/, `${k}: the site is never called محل`);
  }
  assert.match(S['design.fillIn'][0], /Fill in your details in the editor/);
  assert.match(S['net.title'][0], /No connection/);
  assert.match(S['net.retry'][0], /Try again/);
});

test('/design and the product page find the {fields} of the team business cards, as the editor does', () => {
  const { SEED } = require('../src/library');
  // The same lines in both pages.
  const grab = (file) => {
    const src = read(file);
    const m = src.match(/const textsOf = \(list\) => [\s\S]*?: \[\]\)\);/);
    assert.ok(m, `${file}: textsOf`);
    assert.match(src, /\/\\\{\[\^\{\}\\n\]\{1,40\}\\\}\/\.test\(s\)/, `${file}: the editor's {field} test`);
    return vm.runInNewContext(`${m[0]}\n(d) => textsOf([...(d.items || []), ...(d.objects || [])]).some((s) => /\\{[^{}\\n]{1,40}\\}/.test(s))`);
  };
  for (const file of ['js/design.js', 'js/product.js']) {
    const hasFields = grab(file);
    const found = SEED.filter(hasFields).map((d) => d.id).sort();
    assert.deepStrictEqual(found, ['cd-bilingual', 'cd-company-ar', 'cd-modern-en', 'cd-team-ar', 'cd-team-en'], file);
    // A design the owner added (editor objects, a group inside): found too; plain words are not fields.
    assert.ok(hasFields({ objects: [{ type: 'group', objects: [{ type: 'i-text', text: 'Hi {Name}' }] }] }), `${file}: in a group`);
    assert.ok(!hasFields({ objects: [{ type: 'i-text', text: 'Hello' }, { type: 'image', src: 'data:image/svg+xml,<style>.a{fill:red}</style>' }] }), `${file}: a picture's {…} is not a field`);
  }
  // No "Add to cart" / "Order as is" for them.
  assert.match(read('js/design.js'), /\$\('dp-add'\)\.hidden = hasFields;/);
  assert.match(read('js/product.js'), /hasFields\(d\)\s*\?\s*`<a class="btn btn-sm btn-primary" href="\/editor\?library=/);
});

test('home search: the shop\'s Egyptian words find their products', () => {
  const src = read('index.html');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end'));
  const SEARCH = vm.runInNewContext(`${kit}\nSEARCH`);
  const aliases = vm.runInNewContext(`(${src.match(/const ALIASES = (\{[\s\S]*?\n\s*\});/)[1]})`);
  const { PRODUCTS, CATEGORIES } = require('../src/products');
  const cat = (id) => (CATEGORIES.find((c) => c.id === id) || { name: {} }).name;
  const idx = Object.fromEntries(PRODUCTS.map((p) => [p.id, SEARCH.index([p.id, p.name.en, p.name.ar, p.description && p.description.en, p.description && p.description.ar, cat(p.category).en, cat(p.category).ar, aliases[p.id] || ''].join(' '), true)]));
  const find = (q) => Object.keys(idx).filter((id) => SEARCH.match(idx[id], SEARCH.query(q)));
  const want = { 'بزنس كارد': 'bizcards', 'بزنس كارت': 'bizcards', 'بيزنس كارت': 'bizcards', 'نوت بوك': 'notebook', 'تابلوه': 'canvas', 'تابلوهات': 'canvaswide', 'كوشن': 'cushion', 'فوتو بوك': 'photobook', 'بادج': 'idcards' };
  for (const [q, id] of Object.entries(want)) assert.ok(find(q).includes(id), `"${q}" finds ${id} (got ${find(q).join(', ') || 'nothing'})`);
  // Not the canvas tote bag or pencil case for a wall canvas.
  for (const q of ['تابلوه', 'canvas print']) for (const id of ['tote', 'pencilcase']) assert.ok(!find(q).includes(id), `"${q}" is not the ${id}`);
});

test('order page: the courier\'s day, once set, is the one day shown everywhere', () => {
  const src = read('order.html');
  const line = src.match(/const dueDay = \(o\) => [^\n]+;/);
  assert.ok(line, 'dueDay');
  const dueDay = vm.runInNewContext(`${line[0]}\ndueDay`);
  assert.strictEqual(dueDay({ delivery: { by: '2026-11-26' }, shipment: { eta: '2026-11-27' } }), '2026-11-27');
  assert.strictEqual(dueDay({ delivery: { by: '2026-11-26' }, shipment: { eta: null } }), '2026-11-26');
  assert.strictEqual(dueDay({ delivery: { by: '2026-11-26' }, shipment: null }), '2026-11-26');
  assert.strictEqual(dueDay({ delivery: { by: '2026-11-26' }, shipment: { eta: 'soon' } }), '2026-11-26');
  // The top line, the tracker and the line under the total all go through it.
  assert.doesNotMatch(src, /POD\.day\(o\.delivery\.by\)/);
  assert.strictEqual((src.match(/POD\.day\(dueDay\(o\)\)/g) || []).length, 3);
});

test('cart: an Arabic line uses the Arabic comma next to Arabic digits', () => {
  const src = read('cart.html');
  const sep = vm.runInNewContext(`const POD = { lang: 'ar' };\n${src.match(/const SEP = \(\) => [^\n]+;/)[0]}\nSEP`);
  assert.strictEqual(sep(), '، ');
  const sepEn = vm.runInNewContext(`const POD = { lang: 'en' };\n${src.match(/const SEP = \(\) => [^\n]+;/)[0]}\nSEP`);
  assert.strictEqual(sepEn(), ' · ');
  assert.match(src, /\$\{esc\(tr\(color\)\)\}\$\{SEP\(\)\}\$\{esc\(tr\(size\)\)\}/);
});
