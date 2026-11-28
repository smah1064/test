'use strict';
// The A4 calibration card: its layout (public/js/calib-card-layout.js) and the PDF made from it (src/calibration-card.js).
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const L = require('../public/js/calib-card-layout');
const { cardPdf, PT_PER_MM } = require('../src/calibration-card');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

function pageStreams(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    try { out.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { /* fonts, images */ }
  }
  return out.join('\n');
}

test('the card PDF is one A4 portrait page, made once', () => {
  const pdf = cardPdf();
  assert.ok(Buffer.isBuffer(pdf));
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-'));
  const boxes = s.match(/MediaBox \[([^\]]+)\]/g);
  assert.strictEqual(boxes.length, 1, 'one page');
  const [, , w, h] = boxes[0].replace(/MediaBox \[|\]/g, '').trim().split(/\s+/).map(Number);
  near(w, 595.28, 0.01, 'width pt');
  near(h, 841.89, 0.01, 'height pt');
  near(w / PT_PER_MM, 210, 0.01); near(h / PT_PER_MM, 297, 0.01);
  assert.strictEqual(cardPdf(), pdf, 'cached');
});

test('the finder patterns, checker and ruler are drawn at their layout positions (mm, top-left origin)', () => {
  const ops = pageStreams(cardPdf());
  assert.ok(ops.includes('1 0 0 -1 0 841.89 cm'), 'pdfkit page space: y down from the top-left');
  const rects = [...ops.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].map((m) => m.slice(1, 5).map((v) => Number(v) / PT_PER_MM));
  const has = (x, y, w, h) => rects.some((r) => Math.abs(r[0] - x) < 0.01 && Math.abs(r[1] - y) < 0.01 && Math.abs(r[2] - w) < 0.01 && Math.abs(r[3] - h) < 0.01);
  for (const [cx, cy] of [[25, 25], [185, 25], [25, 175], [185, 175]]) {
    assert.ok(has(cx - 14, cy - 14, 28, 28), `finder ${cx},${cy} outer 28 mm`);
    assert.ok(has(cx - 10, cy - 10, 20, 20), `finder ${cx},${cy} white ring`);
    assert.ok(has(cx - 6, cy - 6, 12, 12), `finder ${cx},${cy} centre`);
  }
  assert.ok(has(35, 50, 20, 20), 'checker top-left square is black');
  assert.ok(has(175 - 20, 150 - 20, 20, 20), 'checker bottom-right square');
  assert.ok(has(55, 192 - 0.2, 100, 0.4), 'the 100 mm ruler line');
  // Arabic is drawn as paths: only the built-in Helvetica fonts are embedded.
  const s = cardPdf().toString('latin1');
  const fonts = [...s.matchAll(/\/BaseFont \/([A-Za-z+-]+)/g)].map((m) => m[1]);
  assert.ok(fonts.length >= 1 && fonts.every((f) => /^Helvetica/.test(f)), fonts.join(','));
});

test('layout: the numbers of plan section C', () => {
  assert.deepStrictEqual(L.finderCentres(), [[25, 25], [185, 25], [25, 175], [185, 175]]);
  const ic = L.innerCorners();
  assert.strictEqual(ic.length, 24);
  assert.deepStrictEqual(ic[0], [55, 70]);
  assert.deepStrictEqual(ic[23], [155, 130]);
  assert.deepStrictEqual(L.greyPatches().map((p) => p.k), [0, 20, 40, 60, 80, 100]);
  assert.deepStrictEqual(L.greyPatches().map((p) => p.x), [45, 65, 85, 105, 125, 145]);
  assert.deepStrictEqual(L.colourPatches().map((p) => p.name), ['C', 'M', 'Y', 'R', 'G', 'B']);
  assert.strictEqual(L.RULER.x1 - L.RULER.x0, 100);
  assert.strictEqual(L.FOLD_Y, 200);
  assert.strictEqual(L.VERSION, 'EBDA3-CAL v1');
});

test('layout: colourAt paints the same picture as shapes()', () => {
  const shapes = L.shapes().filter((s) => s.t === 'rect');
  const paint = (x, y) => {
    let c = [255, 255, 255];
    for (const s of shapes) if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) c = s.rgb;
    return c;
  };
  let n = 0;
  for (let y = 0.37; y < 200; y += 1.13) {
    for (let x = 0.29; x < 210; x += 1.07) {
      // Skip points within 0.05 mm of an edge (the analytic test uses <= on some edges).
      const edge = shapes.some((s) => [s.x, s.x + s.w].some((e) => Math.abs(x - e) < 0.05) || [s.y, s.y + s.h].some((e) => Math.abs(y - e) < 0.05));
      if (edge) continue;
      assert.deepStrictEqual(L.colourAt(x, y), paint(x, y), `at ${x.toFixed(2)},${y.toFixed(2)}`);
      n++;
    }
  }
  assert.ok(n > 25000);
});
