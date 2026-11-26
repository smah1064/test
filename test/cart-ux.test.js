'use strict';

// The cart's UX changes (owner, 26 Nov): the words, and the rules the page keeps. (Driven in a browser: test/e2e/cart-ux.e2e.js.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function strings() {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/i18n.js'), ctx);
  return ctx.window.POD_STRINGS;
}

const NEW_KEYS = {
  'cart.proofDetails': ['See proof details ›', 'شوف تفاصيل البروفة ‹'],
  'cart.tickFirst': ['Tick this first ✓', 'علّم هنا الأول ✓'],
  'cart.tickFirstText': ['Check the proof and tick the box, then press Place order.', 'راجع البروفة وعلّم على المربع، وبعدين اضغط «تأكيد الطلب».'],
  'cart.freeLeft': ['{amount} more for free shipping 🚚', 'فاضل {amount} وياخد طلبك شحن مجاني 🚚'],
  'cart.freeDone': ['✓ Your order ships free', '✓ طلبك شحنه مجاني'],
  'cart.freeMore': ['Add another item ›', 'ضيف منتج تاني ‹'],
  'cart.more': ['More options', 'خيارات تانية'],
  'saved.show': ['Show them', 'اعرضها'],
};

test('cart UX words: in both languages, placed together after checkout.freeOver, never «محل»', () => {
  const all = strings();
  for (const [k, v] of Object.entries(NEW_KEYS)) assert.deepStrictEqual([...all[k]], v, k);
  const src = read('js/i18n.js');
  const at = src.indexOf("'checkout.freeOver'");
  for (const k of ['cart.proofDetails', 'cart.proofDetailsHide', 'cart.tickFirst', 'cart.freeLeft', 'cart.freeBar', 'cart.more', 'saved.show', 'saved.hide', 'saved.sumMore', 'saved.sumReady', 'saved.sumDraft']) {
    const i = src.indexOf(`'${k}'`);
    assert.ok(i > at && i - at < 3000, `${k} right after checkout.freeOver`);
    assert.doesNotMatch(all[k][1], /محل/, k);
  }
});

test('cart: "Place order" is never disabled for proofs (only while placing); pressed early it points to the box', () => {
  const src = read('cart.html');
  assert.doesNotMatch(src.match(/<button[^>]*id="place-order"[^>]*>/)[0], /\bdisabled\b/);
  assert.match(src, /if \(!placing\) btn\.disabled = false;/);
  assert.match(src, /placing = true;\n\s*btn\.disabled = true;/);
  const submit = src.slice(src.indexOf("form.addEventListener('submit'"), src.indexOf('const btn = document.getElementById(\'place-order\');\n        placing = true;'));
  // Items that can't be ordered, then proofs, then the fields (as the phones' bar).
  assert.ok(submit.indexOf('goToBlocked()') < submit.indexOf('nudgeProof()'));
  assert.ok(submit.indexOf('nudgeProof()') < submit.indexOf('checkFields()'));
});

test('cart: a warning or a problem from the checks is never folded away in the short proof', () => {
  const src = read('cart.html');
  const fn = src.slice(src.indexOf('function shortProofHtml('), src.indexOf('function proofSlot('));
  assert.match(fn, /const plain = status === 'pass' && !\(proof\.review && proof\.review\.needed\);/);
  assert.match(fn, /\$\{plain \? '' : PODProof\.checksHtml\(proof\)\}/);
  // "The proof changed" still shows above the short card.
  assert.match(src, /\$\{changedNote\}\n\s*\$\{shortProofHtml\(proof, item, i\)\}/);
});

test('cart: no cash-on-delivery wording in the new parts', () => {
  const all = strings();
  for (const k of Object.keys(NEW_KEYS)) assert.doesNotMatch(all[k].join(' '), /cash|كاش|عند الاستلام/i, k);
});

test('saved designs: a compact line in the cart, the full list elsewhere (account)', () => {
  const src = read('js/saved-designs.js');
  assert.match(src, /if \(opts\.compact\) \{/);
  assert.match(src, /data-saved-open aria-expanded="\$\{open\}"/);
  assert.match(read('cart.html'), /compact: full,/);
  assert.doesNotMatch(read('account.html') + read('js/account.js'), /compact:/);
});
