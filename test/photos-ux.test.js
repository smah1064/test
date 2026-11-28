'use strict';

// Photos page helpers and texts (no server, no browser).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PhotoUtil = require('../public/js/photos.js');

function photoStrings() {
  const ctx = { window: { POD_STRINGS: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n-photos.js'), 'utf8'), ctx);
  return ctx.window.POD_STRINGS;
}

test('copies box: Arabic-Indic and Persian digits, empty, over the maximum', () => {
  assert.strictEqual(PhotoUtil.latinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.strictEqual(PhotoUtil.latinDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.deepStrictEqual(PhotoUtil.parseCopies('٣', 50), { value: 3, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('۱۲', 50), { value: 12, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('3', 50), { value: 3, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies(' ٢ ', 50), { value: 2, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('120', 50), { value: 50, over: true });
  assert.deepStrictEqual(PhotoUtil.parseCopies('١٢٠', 50), { value: 50, over: true });
  assert.deepStrictEqual(PhotoUtil.parseCopies('50', 50), { value: 50, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('0', 50), { value: 1, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('', 50), { value: null, over: false });
  assert.deepStrictEqual(PhotoUtil.parseCopies('abc', 50), { value: null, over: false });
});

test('low-resolution advice fits the case', () => {
  const low = 150;
  // Already the smallest size: no smaller size to suggest, a sharper original instead.
  assert.deepStrictEqual(PhotoUtil.lowAdvice({ lowDpi: low, zoom: 1, dpiUnzoomed: 108, smaller: [] }), { kind: 'source' });
  // A smaller size that is still too small does not help either.
  assert.deepStrictEqual(PhotoUtil.lowAdvice({ lowDpi: low, zoom: 1, dpiUnzoomed: 60, smaller: [{ id: '15x20', dpi: 90 }, { id: '10x15', dpi: 120 }] }), { kind: 'source' });
  // The biggest smaller size that prints sharp.
  assert.deepStrictEqual(PhotoUtil.lowAdvice({ lowDpi: low, zoom: 1, dpiUnzoomed: 135, smaller: [{ id: '15x20', dpi: 203 }, { id: '13x18', dpi: 230 }] }), { kind: 'smaller', size: '15x20' });
  // Zoomed in, fine without the zoom.
  assert.deepStrictEqual(PhotoUtil.lowAdvice({ lowDpi: low, zoom: 3, dpiUnzoomed: 400, smaller: [] }), { kind: 'zoom' });
});

test('time left: unknown, under a minute, minutes', () => {
  assert.strictEqual(PhotoUtil.minutesLeft([], 10), null);
  assert.strictEqual(PhotoUtil.minutesLeft([2000, 2000], 10), 0);
  assert.strictEqual(PhotoUtil.minutesLeft([4500, 4500, 4500], 28), 2);
  assert.strictEqual(PhotoUtil.minutesLeft([1000, 1000, 1000, 1000, 1000, 9000], 60), 3); // the last five photos count (all six would give 2)
});

test('skipped files are explained by kind', () => {
  assert.strictEqual(PhotoUtil.skipKind('IMG_1.HEIC', ''), 'heic');
  assert.strictEqual(PhotoUtil.skipKind('photo', 'image/heif'), 'heic');
  assert.strictEqual(PhotoUtil.skipKind('voice-note.txt', 'text/plain'), 'notImage');
  assert.strictEqual(PhotoUtil.skipKind('doc.pdf', ''), 'notImage');
  assert.strictEqual(PhotoUtil.skipKind('broken.jpg', 'image/jpeg'), 'broken');
});

test('photos page texts: English and Arabic for every key, no jargon, delivery rule', () => {
  const s = photoStrings();
  const keys = Object.keys(s).filter((k) => k.startsWith('photos.'));
  assert.ok(keys.length > 80);
  for (const k of keys) {
    assert.ok(Array.isArray(s[k]) && s[k].length === 2 && s[k].every((v) => typeof v === 'string' && v.trim()), k);
    // The same placeholders in both languages.
    const ph = (v) => (v.match(/\{\w+\}/g) || []).sort().join();
    assert.strictEqual(ph(s[k][0]), ph(s[k][1]), k);
  }
  for (const k of keys) {
    for (const v of s[k]) {
      assert.ok(!/\bDPI\b|نقطة لكل بوصة/.test(v), `no DPI jargon: ${k}`);
      assert.ok(!/\b5 (business )?days\b|٥ أيام/.test(v), `no 5-day promise outside checkout: ${k}`);
    }
  }
  // Arabic numbers come from POD.num at run time: no Western digits hard-coded in Arabic counts.
  for (const k of keys.filter((x) => /^photos\.(n|prints|days|left|skipped)\./.test(x))) assert.ok(!/[0-9]/.test(s[k][1]), k);
});
