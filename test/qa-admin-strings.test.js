'use strict';

// QA (admin, 25 Nov): Arabic-Indic digits in the searches, the fixed text-design rule's wording,
// and counted review notices in both languages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** A search normaliser taken from a page's source (`const <name> = (s) => String(s || '')... .trim();` or `function <name>(s)`). */
function normFrom(file, name) {
  const m = read(file).match(new RegExp(`(?:const ${name} = \\(s\\) =>|function ${name}\\(s\\) \\{\\s*return)\\s*(String\\(s \\|\\| ''\\)[\\s\\S]*?\\.trim\\(\\));`));
  assert.ok(m, `${name} in ${file}`);
  return vm.runInNewContext(`(s) => ${m[1]}`);
}

test('the home and Ready-designs searches turn Arabic-Indic and Persian digits into 0-9 (as /designs)', () => {
  for (const [file, name] of [['index.html', 'norm'], ['js/admin.js', 'libNorm'], ['js/designs.js', 'norm']]) {
    const norm = normFrom(file, name);
    assert.strictEqual(norm('١٠٠ كارت'), '100 كارت', `${file}: Arabic-Indic digits kept as 0-9`);
    assert.strictEqual(norm('۱۰۰ كارت'), '100 كارت', `${file}: Persian digits kept as 0-9`);
    assert.strictEqual(norm('١٠٠ كارت'), norm('100 كارت'), file);
    // Short vowels, the superscript alef and tatweel still go.
    assert.strictEqual(norm('تِيشَـيرت هٰذا'), 'تيشيرت هذا', `${file}: vowels and tatweel`);
  }
});

function strings() {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  for (const f of ['js/i18n-review.js', 'js/i18n-admin-library.js']) vm.runInNewContext(read(f), { window });
  return window.POD_STRINGS;
}

test('Ready designs no longer describe the old automatic rule, in either language', () => {
  const S = strings();
  const OLD = [/without artwork designs/i, /has designs with artwork/i, /مفيهاش تصميمات برسومات/, /فيها تصميمات برسومات/];
  for (const [k, pair] of Object.entries(S)) {
    if (!k.startsWith('rd.')) continue;
    for (const s of pair) for (const re of OLD) assert.doesNotMatch(s, re, k);
    assert.doesNotMatch(pair[1], /محل/, `${k}: the site is never called محل`);
  }
  // The switch's "on" toast says what rd.ruleHelp says: the list is fixed, new picture designs never hide text designs.
  assert.match(S['rd.ruleOn'][0], /fixed/);
  assert.match(S['rd.ruleOn'][1], /ثابتة/);
});

test('the review count and the print-queue notice come in all four forms, without "job(s)"', () => {
  const S = strings();
  for (const base of ['rv.count', 'rv.queueNotice']) {
    for (const form of ['one', 'two', 'few', 'many']) {
      const pair = S[`${base}.${form}`];
      assert.ok(Array.isArray(pair) && pair[0] && pair[1], `${base}.${form}`);
      assert.doesNotMatch(pair[0], /\(s\)/, `${base}.${form}`);
      if (form === 'few' || form === 'many') for (const s of pair) assert.match(s, /\{n\}/, `${base}.${form}`);
    }
  }
  const src = read('js/admin.js');
  assert.match(src, /POD\.plural\('rv\.count', reviewCount\)/);
  assert.match(src, /POD\.plural\('rv\.queueNotice', reviewCount\)/);
});

test('expense dates are shown as days, not YYYY-MM-DD', () => {
  const S = strings();
  assert.ok(S['acc.periodDays'] && /\{from\}/.test(S['acc.periodDays'][1]) && /\{to\}/.test(S['acc.periodDays'][1]));
  const src = read('js/admin.js');
  assert.doesNotMatch(src, /<td>\$\{esc\(e\.date\)\}<\/td>/, 'the expense list formats its dates');
  assert.match(src, /<td>\$\{esc\(day\(e\.date, true\)\)\}<\/td>/);
});

test('review history: every step the server records has its own words in both languages (no raw "revised")', () => {
  const S = strings();
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  // Each entry added to an item's approvals: `approvals = [...(x.approvals || []), { action: '…'` or `approvals.push({ action: '…'`.
  const actions = new Set([...app.matchAll(/approvals(?: = \[\.\.\.\([\w.]+ \|\| \[\]\), |\.push\()\{ action: '([a-z-]+)'/g)].map((m) => m[1]));
  for (const a of ['approved', 'rejected', 'reopened', 'reviewed', 'changes', 'edited', 'revised']) assert.ok(actions.has(a), `found ${a} in src/app.js`);
  for (const a of actions) {
    const pair = S[`rv.action.${a}`];
    assert.ok(Array.isArray(pair) && pair[0] && pair[1], `rv.action.${a}`);
    assert.notStrictEqual(pair[0], a, `rv.action.${a} in English`);
    assert.match(pair[1], /[؀-ۿ]/, `rv.action.${a} in Arabic`);
  }
  // After the customer sends a new version, the history says so.
  assert.deepStrictEqual([...S['rv.action.revised']], ['Customer sent a new version', 'العميل بعت نسخة جديدة']);
});
