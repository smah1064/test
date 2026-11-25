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

// Every expected line below was checked against Chromium's own layout of the same text.
test('percent and currency signs and separators stay with their numbers (rules W4, W5, W6)', () => {
  // W5: a % right after a European number joins it, and W7 puts "Sale 50%" in one left-to-right stretch.
  const sale = 'عرض خاص Sale 50% على كل المنتجات';
  assert.strictEqual(shown(sale), 'المنتجات كل على | Sale 50% | خاص عرض');
  const runs = bidiRuns(Array.from(sale), true);
  const pct = Array.from(sale).indexOf('%');
  const run = runs.find((r) => r.start <= pct && pct < r.end);
  assert.deepStrictEqual([run.rtl, run.start, run.end], [false, 8, 16], 'the % is in the stretch of "Sale 50"');
  assert.strictEqual(shown('Sale 50% على كل حاجة'), 'حاجة كل على | Sale 50%');
  assert.strictEqual(shown('Sale 50% off', false), 'Sale 50% off');
  // $ before a number, and thousands / decimal separators between digits (W4).
  assert.strictEqual(shown('Price $20 عرض', false), 'Price $20 | عرض');
  assert.strictEqual(shown('Price $1,250.50 now عرض', false), 'Price $1,250.50 now | عرض');
  assert.strictEqual(shown('السعر 1,250 جنيه'), 'جنيه | 1,250 | السعر');
  assert.strictEqual(shown('السعر 1,250.50 جنيه'), 'جنيه | 1,250.50 | السعر');
  // Right after Arabic words a number is an Arabic number (W2), so W5 does not join the sign:
  // it sits on the number's Arabic side, as the browser shows it ("20$", "%50" read from the right).
  assert.strictEqual(shown('السعر $20 بس'), 'بس | 20 | $ السعر');
  assert.strictEqual(shown('السعر $1,250 بس'), 'بس | 1,250 | $ السعر');
  assert.strictEqual(shown('خصم 50% النهارده'), 'النهارده % | 50 | خصم');
  // The Arabic percent sign, with European and with Arabic digits.
  assert.strictEqual(shown('خصم ٪50 النهارده'), 'النهارده | 50 | ٪ خصم');
  assert.strictEqual(shown('خصم ٪٥٠ النهارده'), 'النهارده | ٥٠ | ٪ خصم');
  // Egyptian pounds written "ج.م.": the dots are separators between letters, not numbers (W6), so they stay with the letters.
  assert.strictEqual(shown('السعر 20 ج.م. بس'), 'بس ج.م. | 20 | السعر');
  assert.strictEqual(shown('السعر ٢٠ ج.م. بس'), 'بس ج.م. | ٢٠ | السعر');
});

test('levels follow the bidi rules: digits after Arabic sit inside the Arabic, at a higher level', () => {
  const runs = bidiRuns(Array.from('Order عرض 3 جديد now'), false);
  assert.deepStrictEqual(Array.from(runs, (r) => r.level), [0, 1, 2, 1, 0]);
  // Spaces at the end of a line are at the text's own level.
  const tail = bidiRuns(Array.from('عرض 3D  '), true);
  assert.strictEqual(tail[tail.length - 1].level, 1);
});

// Checked against Chromium's own layout (the canvas draws one-colour lines with it, and the
// editor's caret follows this order): brackets read with the words inside them (rule N0).
test('brackets keep both ends around the words inside them (rule N0)', () => {
  /** The line as shown, left to right, letter by letter (a right-to-left stretch reversed). */
  const order = (text, baseRtl = true) => {
    const line = Array.from(text);
    return bidiOrder(bidiRuns(line, baseRtl)).map((r) => {
      const s = line.slice(r.start, r.end);
      return (r.rtl ? s.reverse() : s).join('');
    }).join('');
  };
  // English in brackets inside Arabic: the brackets stay on the Arabic side (drawn mirrored).
  assert.strictEqual(order('السعر (USD) 250 جنيه'), 'هينج 250 )USD( رعسلا');
  // English with brackets in a right-to-left box: one left-to-right stretch, ")" stays at the end.
  assert.strictEqual(order('abc (def)'), 'abc (def)');
  assert.strictEqual(order('Price (USD) 5'), 'Price (USD) 5');
  // Arabic in brackets inside English.
  assert.strictEqual(order('Pro (مرحبا) 5', false), 'Pro (ابحرم) 5');
  assert.strictEqual(order('3D ؟ (مرحبا)', false), '3D )ابحرم( ؟');
  // A bracket without its pair is an ordinary sign: at the end of the line it goes to the box's side.
  assert.strictEqual(order('abc def)'), ')abc def');
});
