'use strict';

/**
 * The editor's own layout of a line that mixes Arabic and English and has a
 * word in another colour (public/js/fabric-ext.js: bidiRuns / bidiOrder).
 * The line must read in the same order as the browser shows it in one colour
 * (the Unicode bidi algorithm), so colouring one word never moves another; that
 * goes for a line written in the other script than the box's direction too
 * (English under Arabic, Arabic under English), and for its underline.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load fabric-ext.js with a stand-in for Fabric (anything it touches at load time just works). */
function loadFx(setup = () => {}) {
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
  const fabric = stub();
  setup(fabric);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/fabric-ext.js'), 'utf8'), { window, fabric, console });
  return window.POD_FX;
}
let fabricStub;
const { bidiRuns, bidiOrder, styledBidiLine, bidiLineLayout } = loadFx((fabric) => {
  fabricStub = fabric;
  // Fabric's own test for "this letter is drawn in another style than the next one".
  fabric.util.hasStyleChanged = (a, b) => a.fill !== b.fill || a.fontWeight !== b.fontWeight;
  // Fabric's own underline drawing: records which lines it was given.
  fabric.Text.prototype._renderTextDecoration = function () {
    this.fabricDrew = this._textLines.map((l) => l.join(''));
  };
});

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

/**
 * A stand-in for a Fabric text box: `styles` as Fabric keeps them ({ line: { letter: style } }),
 * and a measuring context where every letter is 10 wide (so places can be checked exactly).
 */
function textBox(text, direction, styles = {}) {
  return {
    direction,
    textAlign: 'center',
    charSpacing: 0,
    _textLines: text.split('\n').map((l) => Array.from(l)),
    isEmptyStyles: (li) => !styles[li] || !Object.keys(styles[li]).length,
    getCompleteStyleDeclaration: (li, i) => ({ fill: '#111', fontWeight: 'normal', ...((styles[li] || {})[i] || {}) }),
    _getFontDeclaration: (d) => `${d.fontWeight} 40px Cairo`,
  };
}
const measure = { save() {}, restore() {}, measureText: (t) => ({ width: Array.from(t).length * 10 }) };
/** Letters a..b-1 of line li in red. */
const red = (li, a, b) => ({ [li]: Object.fromEntries(Array.from({ length: b - a }, (_, k) => [a + k, { fill: '#e03131' }])) });
/** Line li laid out from Fabric's line start `left`: its pieces left to right, as [text, x, width]. */
function drawn(o, li, left) {
  const out = [];
  for (const run of bidiLineLayout(o, measure, o._textLines[li], left, li)) for (const p of run.pieces) out.push([p.text, p.x, p.w]);
  return out;
}

// QA 25 Nov: one coloured word reversed a line written in the other script than the box's direction
// (Fabric drew the coloured pieces one after the other in the box's direction).
test('a coloured word in an English line of an Arabic (right-to-left) box keeps the line in reading order', () => {
  const o = textBox('مرحبا بكم\nSecond line here', 'rtl', red(1, 7, 11)); // "line" in red
  assert.strictEqual(styledBidiLine(o, o._textLines[1], 1), true, 'laid out by fabric-ext, not piece by piece by Fabric');
  assert.strictEqual(styledBidiLine(o, o._textLines[0], 0), false, 'a line in one colour stays the browser\'s');
  // Fabric gives a right-to-left line's start as its right edge (here 100): the browser draws the
  // one-colour line from there, 16 letters to the left, reading left to right.
  assert.deepStrictEqual(drawn(o, 1, 100), [['Second ', -60, 70], ['line', 10, 40], [' here', 50, 50]]);
  assert.strictEqual(shown('Second line here', true), 'Second line here');
});

test('a coloured word in an Arabic line of an English (left-to-right) box keeps the line in reading order', () => {
  const o = textBox('Hello\nأحب مصر جدا', 'ltr', red(1, 4, 7)); // "مصر" in red
  assert.strictEqual(styledBidiLine(o, o._textLines[1], 1), true);
  // Read from the right: "أحب" first (rightmost), then "مصر", then "جدا"; the line starts at the left edge (-50) as in one colour.
  assert.deepStrictEqual(drawn(o, 1, -50), [[' جدا', -50, 40], ['مصر', -10, 30], ['أحب ', 20, 40]]);
  assert.strictEqual(shown('أحب مصر جدا', false), 'أحب مصر جدا'.split(' ').reverse().join(' '));
});

test('a bold word, numbers and a mixed line: every piece in its place, the line starting where Fabric starts it', () => {
  // A bold word in an English line of an Arabic box.
  const bold = textBox('Sale 50% off', 'rtl', { 0: { 5: { fontWeight: 'bold' }, 6: { fontWeight: 'bold' }, 7: { fontWeight: 'bold' } } });
  assert.strictEqual(styledBidiLine(bold, bold._textLines[0], 0), true);
  assert.deepStrictEqual(drawn(bold, 0, 0), [['Sale ', -120, 50], ['50%', -70, 30], [' off', -40, 40]]);
  // Only numbers in an Arabic box: each number reads left to right, the numbers from the right (as the browser shows them).
  const nums = textBox('2026 2027', 'rtl', red(0, 5, 9));
  assert.strictEqual(styledBidiLine(nums, nums._textLines[0], 0), true);
  assert.deepStrictEqual(drawn(nums, 0, 0), [['2027', -90, 40], [' ', -50, 10], ['2026', -40, 40]]);
  // Mixed Arabic and English (the case fixed before): unchanged order, now also starting where Fabric starts the line.
  const mixed = textBox('عرض 3D جديد', 'rtl', red(0, 7, 11));
  assert.deepStrictEqual(drawn(mixed, 0, 0), [['جديد', -110, 40], [' ', -70, 10], ['3D', -60, 20], ['عرض ', -40, 40]]);
});

test('lines Fabric draws right are left to it', () => {
  // English with a coloured word in an English box, a line in one colour, signs only.
  const en = textBox('Hello big world', 'ltr', red(0, 6, 9));
  assert.strictEqual(styledBidiLine(en, en._textLines[0], 0), false);
  const plain = textBox('Second line here', 'rtl');
  assert.strictEqual(styledBidiLine(plain, plain._textLines[0], 0), false);
  const signs = textBox('!! ??', 'rtl', red(0, 0, 2));
  assert.strictEqual(styledBidiLine(signs, signs._textLines[0], 0), false);
  // Arabic in an Arabic box with a coloured word: in order already, but Fabric places the pieces by its
  // letter-by-letter (unjoined) widths, so the words beside it moved: laid out here too.
  const ar = textBox('أحب مصر جدا', 'rtl', red(0, 4, 7));
  assert.strictEqual(styledBidiLine(ar, ar._textLines[0], 0), true);
  assert.deepStrictEqual(drawn(ar, 0, 0), [[' جدا', -110, 40], ['مصر', -70, 30], ['أحب ', -40, 40]]);
  // Letter spacing, text on a path and justified text keep Fabric's letter-by-letter drawing.
  for (const extra of [{ charSpacing: 100 }, { path: {} }, { textAlign: 'justify' }]) {
    const o = Object.assign(textBox('Second line here', 'rtl', red(0, 7, 11)), extra);
    assert.strictEqual(styledBidiLine(o, o._textLines[0], 0), false, JSON.stringify(extra));
  }
});

test('the underline of such a line is drawn under each piece where it is drawn, in its colour', () => {
  const o = Object.assign(textBox('مرحبا بكم\nSecond line here', 'rtl', red(1, 7, 11)), {
    underline: true,
    fontSize: 40,
    lineHeight: 1,
    _fontSizeFraction: 0.2,
    offsets: { underline: 0.1 },
    styleHas: () => false,
    getHeightOfLine: () => 40,
    getHeightOfChar: () => 40,
    _getTopOffset: () => -40,
    _getLeftOffset: () => 100,
    _getLineLeftOffset: () => 0,
    getValueOfPropertyAt(li, i, prop) {
      const v = this.getCompleteStyleDeclaration(li, i)[prop];
      return v === undefined ? this[prop] : v;
    },
  });
  const rects = [];
  const ctx = { ...measure, fillRect(x, y, w, h) { rects.push([this.fillStyle, x, y, w, h]); } };
  fabricStub.Text.prototype._renderTextDecoration.call(o, ctx, 'underline');
  // Fabric draws the first line (one colour); the coloured line is left out of its drawing and done here.
  assert.deepStrictEqual(Array.from(o.fabricDrew), ['مرحبا بكم', '']);
  assert.strictEqual(o._textLines[1].join(''), 'Second line here', 'the text is given back');
  // Baseline of line 2: top 0 + 40 * 0.8 = 32; underline 0.1 * 40 below it, 40/15 thick.
  const h = 40 / 15;
  assert.deepStrictEqual(rects, [['#111', -60, 36, 70, h], ['#e03131', 10, 36, 40, h], ['#111', 50, 36, 50, h]]);
});
