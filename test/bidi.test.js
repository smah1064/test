'use strict';

/**
 * The editor's own layout of a line that mixes Arabic and English and has a
 * word in another colour (public/js/fabric-ext.js: bidiRuns / bidiOrder).
 * The line must read in the same order as the browser shows it in one colour
 * (the Unicode bidi algorithm), so colouring one word never moves another.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load fabric-ext.js with a stand-in for Fabric (anything it touches at load time just works). */
function loadFx() {
  const stub = () => {
    const props = new Map();
    return new Proxy(function () {}, {
      get: (target, key) => {
        if (key === Symbol.toPrimitive) return () => 0;
        if (!props.has(key)) props.set(key, stub());
        return props.get(key);
      },
      set: (target, key, v) => (props.set(key, v), true),
      apply: () => stub(),
      construct: () => stub(),
    });
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/fabric-ext.js'), 'utf8'), { window, fabric: stub(), console });
  return window.POD_FX;
}
const { bidiRuns, bidiOrder } = loadFx();

/** The line as it is shown, left to right: each stretch's text, in display order (right-to-left stretches reversed by word). */
function shown(text, baseRtl = true) {
  const line = Array.from(text);
  return bidiOrder(bidiRuns(line, baseRtl)).map((r) => {
    const s = line.slice(r.start, r.end).join('').trim();
    return r.rtl ? s.split(/\s+/).reverse().join(' ') : s;
  }).filter(Boolean).join(' | ');
}

test('a number and English letters next to it stay one left-to-right stretch', () => {
  assert.strictEqual(shown('عرض 3D جديد'), 'جديد | 3D | عرض');
  assert.strictEqual(shown('اشتري 2x1 النهارده'), 'النهارده | 2x1 | اشتري');
  const runs = bidiRuns(Array.from('عرض 3D جديد'), true);
  assert.deepStrictEqual(Array.from(runs, (r) => [r.rtl, r.start, r.end]), [[true, 0, 4], [false, 4, 6], [true, 6, 11]]);
});

test('plain numbers in Arabic text keep their place', () => {
  assert.strictEqual(shown('السعر 250 جنيه'), 'جنيه | 250 | السعر');
  assert.strictEqual(shown('عيد ميلاد سعيد Ahmed 2026'), 'Ahmed 2026 | سعيد ميلاد عيد');
  assert.strictEqual(shown('خصم ٥٠٪ النهارده'), 'النهارده ٪ | ٥٠ | خصم');
  // A decimal number and a time stay whole.
  assert.strictEqual(shown('الساعة 10:30 مساء'), 'مساء | 10:30 | الساعة');
  assert.strictEqual(shown('الوزن 2.5 كيلو'), 'كيلو | 2.5 | الوزن');
});

test('English text with an Arabic word (left-to-right text)', () => {
  // A number after Arabic belongs to the Arabic, as in the browser.
  assert.strictEqual(shown('Happy عيد سعيد 2026', false), 'Happy | 2026 | سعيد عيد');
  assert.strictEqual(shown('Order عرض 3 جديد now', false), 'Order | جديد | 3 | عرض | now');
  assert.strictEqual(shown('Size 2x1 cm', false), 'Size 2x1 cm');
});

test('levels follow the bidi rules: digits after Arabic sit inside the Arabic, at a higher level', () => {
  const runs = bidiRuns(Array.from('Order عرض 3 جديد now'), false);
  assert.deepStrictEqual(Array.from(runs, (r) => r.level), [0, 1, 2, 1, 0]);
  // Spaces at the end of a line are at the text's own level.
  const tail = bidiRuns(Array.from('عرض 3D  '), true);
  assert.strictEqual(tail[tail.length - 1].level, 1);
});
