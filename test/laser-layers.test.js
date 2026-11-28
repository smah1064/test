'use strict';
// Multi-layer production files: per-layer cut SVG, layer report and the assembly sheet.
// The fixture is self-contained (no dependency on src/products.js).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { layerCutSvg, layerReport, assemblyPdf, cutSvg } = require('../src/laser');
const L = require('../public/js/layers.js');

// Print PNG of 600 x 900 px for a 400 x 600 mm sheet (1.5 px/mm).
const PW = 600, PH = 900, WMM = 400, HMM = 600;

async function mask(body, w = PW, h = PH) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
}

const cutLayer = (extra = {}) => ({ id: 'l2', kind: 'cut', rimMm: 0, pieces: 'many', ...extra });
const count = (svg, re) => (svg.match(re) || []).length;
const redPaths = (svg) => count(svg, /<path [^>]*stroke="#ff0000"/g);
const bluePaths = (svg) => count(svg, /<path [^>]*stroke="#0000ff"/g);
const sizeOf = (svg) => {
  const m = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return { w: +m[1], h: +m[2], vw: +m[3], vh: +m[4] };
};
function bbox(svg) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [, d] of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const m of d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
      box.x0 = Math.min(box.x0, +m[1]); box.x1 = Math.max(box.x1, +m[1]);
      box.y0 = Math.min(box.y0, +m[2]); box.y1 = Math.max(box.y1, +m[2]);
    }
  }
  return box;
}

test('layerCutSvg: backing layer is one path of the board size, no mask needed', async () => {
  const svg = await layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing', cut: 'rect' } });
  assert.deepStrictEqual(sizeOf(svg), { w: 400, h: 600, vw: 400, vh: 600 });
  assert.strictEqual(redPaths(svg), 1);
  assert.match(svg, /d="M0 0H400V600H0Z"/);
  const rounded = await layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing', cut: 'rounded', radiusMm: 10 } });
  assert.match(rounded, /A10 10 0 0 1/);
  const arch = await layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing', cut: 'arch' } });
  assert.match(arch, /A200 200 0 0 1/);
  await assert.rejects(layerCutSvg(null, { layer: { kind: 'backing' } }), /widthMm/);
  await assert.rejects(layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'cut' } }), /mask/);
});

test("layerCutSvg: cut 'round' is a circle of the shorter side", async () => {
  const svg = await layerCutSvg(null, { widthMm: 600, heightMm: 600, layer: { kind: 'backing', cut: 'round' } });
  assert.match(svg, /d="M0 300A300 300 0 1 1 600 300A300 300 0 1 1 0 300Z"/);
  const wide = await layerCutSvg(null, { widthMm: 600, heightMm: 400, layer: { kind: 'backing', cut: 'round' } });
  assert.match(wide, /A200 200/);
  assert.match(wide, /M100 200/);
});

test('layerCutSvg: rimMm joins two blobs that touch the rim into one piece, without it they are two', async () => {
  // Two blobs inside the sheet, each reaching into the 15 mm rim zone (22 px) from the top and bottom.
  const body = '<rect x="150" y="10" width="150" height="150" fill="#000"/><rect x="150" y="740" width="150" height="150" fill="#000"/>';
  const m = await mask(body);
  const plain = await layerCutSvg(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.strictEqual(redPaths(plain), 2);
  const rim = await layerCutSvg(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer({ rimMm: 15 }) });
  assert.strictEqual(redPaths(rim), 1, 'rim and art are one outline');
  assert.match(rim, /fill-rule="evenodd"/);
  const box = bbox(rim);
  assert.ok(box.x0 < 0.5 && box.y0 < 0.5 && box.x1 > 399.5 && box.y1 > 599.5, 'the rim runs to the sheet edge');
  assert.deepStrictEqual(sizeOf(rim), { w: 400, h: 600, vw: 400, vh: 600 });
});

test('layerCutSvg: panel crops the mask and the file has the panel size', async () => {
  const body = '<rect x="10" y="100" width="150" height="300" fill="#000"/><rect x="440" y="100" width="150" height="300" fill="#000"/>';
  const m = await mask(body);
  const left = await layerCutSvg(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), panel: { x: 0, y: 0, w: 0.5, h: 1 } });
  assert.deepStrictEqual(sizeOf(left), { w: 200, h: 600, vw: 200, vh: 600 });
  assert.strictEqual(redPaths(left), 1);
  const b = bbox(left);
  assert.ok(Math.abs(b.x0 - 10 / 1.5) < 1 && Math.abs(b.x1 - 160 / 1.5) < 1, JSON.stringify(b));
  const right = await layerCutSvg(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), panel: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  const r = bbox(right);
  assert.ok(Math.abs(r.x0 - (440 - 300) / 1.5) < 1 && Math.abs(r.x1 - (590 - 300) / 1.5) < 1, JSON.stringify(r));
  const backing = await layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing', cut: 'rect' }, panel: { x: 0.1, y: 0, w: 0.3, h: 1 } });
  assert.deepStrictEqual(sizeOf(backing), { w: 120, h: 600, vw: 120, vh: 600 });
});

test('layerCutSvg: engrave adds the image group under the cut lines', async () => {
  const art = await mask('<rect x="100" y="100" width="200" height="100" fill="#000"/>');
  const eng = await mask('<rect x="150" y="400" width="100" height="40" fill="#000"/>');
  const svg = await layerCutSvg(art, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), engrave: eng });
  assert.match(svg, /<g id="engrave"><image x="0" y="0" width="400" height="600"[^>]*xlink:href="data:image\/png;base64,/);
  assert.ok(svg.indexOf('id="engrave"') < svg.indexOf('id="cut"'));
  const none = await layerCutSvg(art, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.ok(!none.includes('id="engrave"'));
  // On a backing layer too.
  const onBoard = await layerCutSvg(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing', cut: 'rect' }, engrave: eng });
  assert.match(onBoard, /<g id="engrave">/);
  assert.strictEqual(redPaths(onBoard), 1);
});

test('layerCutSvg: guide adds blue paths and no extra red ones', async () => {
  const art = await mask('<rect x="50" y="50" width="500" height="800" fill="#000"/>');
  const above = await mask('<rect x="200" y="300" width="100" height="100" fill="#000"/><circle cx="400" cy="600" r="50" fill="#000"/>');
  const svg = await layerCutSvg(art, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), guide: above });
  assert.strictEqual(redPaths(svg), 1);
  assert.strictEqual(bluePaths(svg), 2);
  assert.match(svg, /<g id="guide">/);
  const without = await layerCutSvg(art, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.strictEqual(bluePaths(without), 0);
  assert.ok(!without.includes('id="guide"'));
});

test('layerCutSvg: label becomes a title and a comment, nothing is cut for it', async () => {
  const svg = await layerCutSvg(null, { widthMm: 100, heightMm: 100, layer: { kind: 'backing', cut: 'rect' }, label: 'Layer 1 of 4 -- Back & "board"' });
  assert.match(svg, /<title>Layer 1 of 4 -- Back &amp; &quot;board&quot;<\/title>/);
  assert.match(svg, /<!-- Layer 1 of 4 - Back &amp; &quot;board&quot; -->/);
  assert.strictEqual(redPaths(svg), 1);
});

test('layerReport: pieces, smallest piece, bounding box, rim', async () => {
  const m = await mask('<rect x="100" y="100" width="150" height="150" fill="#000"/><rect x="350" y="500" width="30" height="30" fill="#000"/>');
  const r = await layerReport(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.strictEqual(r.pieces, 2);
  assert.ok(Math.abs(r.smallestMm2 - 400) < 8, `smallest ${r.smallestMm2}`);
  assert.ok(Math.abs(r.bboxMm.w - (380 - 100) / 1.5) < 1 && Math.abs(r.bboxMm.h - (530 - 100) / 1.5) < 1, JSON.stringify(r.bboxMm));
  const rim = await layerReport(m, { widthMm: WMM, heightMm: HMM, layer: cutLayer({ rimMm: 15 }) });
  assert.strictEqual(rim.pieces, 3, 'the rim is a piece of its own when nothing touches it');
  const board = await layerReport(null, { widthMm: WMM, heightMm: HMM, layer: { kind: 'backing' } });
  assert.deepStrictEqual(board, { pieces: 1, smallestMm2: 240000, thinMm2: 0, floating: 0, bboxMm: { w: 400, h: 600 } });
});

test('layerReport: thinMm2 is > 0 for a 1 mm bar and 0 for a 10 mm bar', async () => {
  const thin = await mask('<rect x="100" y="400" width="300" height="1.5" fill="#000"/>'); // 1 mm tall
  const thick = await mask('<rect x="100" y="400" width="300" height="15" fill="#000"/>'); // 10 mm tall
  const a = await layerReport(thin, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  const b = await layerReport(thick, { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.ok(a.thinMm2 > 100, `thin bar: ${a.thinMm2}`);
  assert.strictEqual(b.thinMm2, 0);
  const disk = await layerReport(await mask('<circle cx="300" cy="450" r="150" fill="#000"/>'), { widthMm: WMM, heightMm: HMM, layer: cutLayer() });
  assert.ok(disk.thinMm2 <= 4, `a round shape is not thin: ${disk.thinMm2}`);
  const strict = await layerReport(thick, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), minFeatureMm: 12 });
  assert.ok(strict.thinMm2 > 100, 'a 10 mm bar is thin when 12 mm is the limit');
});

test('layerReport: floating counts a piece with nothing below it', async () => {
  const above = await mask('<rect x="50" y="50" width="150" height="150" fill="#000"/><rect x="350" y="600" width="150" height="150" fill="#000"/>');
  const below = await mask('<rect x="0" y="0" width="300" height="300" fill="#000"/>');
  const r = await layerReport(above, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), below });
  assert.strictEqual(r.pieces, 2);
  assert.strictEqual(r.floating, 1);
  const partly = await mask('<rect x="0" y="0" width="100" height="900" fill="#000"/>'); // under 30% of the second piece? it only touches the first
  const r2 = await layerReport(above, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), below: partly });
  assert.strictEqual(r2.floating, 1, 'overlap below 30% of the piece area is floating');
  const full = await mask('<rect x="0" y="0" width="600" height="900" fill="#000"/>');
  assert.strictEqual((await layerReport(above, { widthMm: WMM, heightMm: HMM, layer: cutLayer(), below: full })).floating, 0);
  assert.strictEqual((await layerReport(above, { widthMm: WMM, heightMm: HMM, layer: cutLayer() })).floating, 0, 'no below mask: not checked');
});

// --- assembly sheet --------------------------------------------------------

async function thumb(hex) {
  return sharp({ create: { width: 80, height: 120, channels: 4, background: hex } }).png().toBuffer();
}

function fixtureProduct() {
  const choice = (id, en, ar, hex, look = 'paint') => ({ id, name: { en, ar }, hex, look, price: 0 });
  return {
    id: 'mltest',
    colors: [{ id: 'white', name: { en: 'White', ar: 'أبيض' }, hex: '#f2eee7', look: 'paint' }],
    sizes: [{ id: '40x60' }],
    options: [
      { id: 'l2', keepDefault: true, choices: [choice('navy', 'Navy', 'كحلي', '#1b2a4a')] },
      { id: 'l3', keepDefault: true, choices: [choice('sand', 'Sand', 'رملي', '#d9c39a')] },
      { id: 'l4', keepDefault: true, choices: [choice('gold', 'Gold', 'دهبي', '#d4af37', 'mirror')] },
    ],
    laser: {
      layers: [
        { id: 'l1', kind: 'backing', name: { en: 'Back board', ar: 'لوح الخلفية' }, from: 'color', cut: 'rect' },
        { id: 'l2', kind: 'cut', name: { en: 'Far layer', ar: 'الطبقة البعيدة' }, from: 'option', option: 'l2', rimMm: 15, pieces: 'one' },
        { id: 'l3', kind: 'cut', name: { en: 'Middle layer', ar: 'الطبقة الوسطى' }, from: 'option', option: 'l3', rimMm: 15, pieces: 'one' },
        { id: 'l4', kind: 'cut', name: { en: 'Front layer', ar: 'الطبقة الأمامية' }, from: 'option', option: 'l4', rimMm: 15, pieces: 'one', accepts: ['text'], default: true },
      ],
    },
  };
}

const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

test('assemblyPdf: one A4 page for 4 layers, Arabic and English', async () => {
  const p = fixtureProduct();
  const stack = L.stack(p, { colorId: 'white', options: { l2: 'navy', l3: 'sand', l4: 'gold' } });
  const layers = [];
  for (const s of stack) {
    layers.push({
      n: s.n, id: s.id, name: s.name, materialName: s.material.name, hex: s.material.hex,
      thicknessMm: s.thicknessMm, zMm: s.zMm, pieces: s.kind === 'backing' ? 1 : 2,
      file: `1042-mltest-L${s.n}of4-${s.name.en.toLowerCase().replace(/ /g, '-')}-${s.material.id}-${s.thicknessMm}mm.svg`,
      thumb: await thumb(s.material.hex),
    });
  }
  const pdf = await assemblyPdf({
    title: 'Order 1042', product: { en: 'Layered Wood Wall Art', ar: 'لوحة خشب طبقات' },
    sizeLabel: { en: '40 x 60 cm', ar: '40 × 60 سم' }, widthMm: 400, heightMm: 600, layers, panels: 1,
    frame: { en: 'Natural wood', ar: 'خشب طبيعي' }, preview: await thumb('#cccccc'),
    notes: [{ en: 'Gift: wrap separately.', ar: 'هدية: تتغلف لوحدها.' }],
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual(pageCount(pdf), 1);
  assert.ok(pdf.length > 5000);
  const text = pdf.toString('latin1');
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  // Arabic is drawn as vector outlines (more drawing than the same sheet without Arabic names).
  const plain = await assemblyPdf({
    title: 'Order 1042', product: 'Layered Wood Wall Art', sizeLabel: '40 x 60 cm', widthMm: 400, heightMm: 600,
    layers: layers.map((l) => ({ ...l, name: l.name.en, materialName: l.materialName.en })),
  });
  assert.ok(pdf.length > plain.length, 'the Arabic outlines and texts are in the file');
});

test('assemblyPdf: 8 layers still fit on one page, bare minimum input works', async () => {
  const layers = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, name: `Layer ${i + 1}`, materialName: 'MDF', hex: '#b08e6a', thicknessMm: 3, pieces: 1, file: `f${i + 1}.svg` }));
  const pdf = await assemblyPdf({ title: 'T', product: 'P', layers });
  assert.strictEqual(pdf.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual(pageCount(pdf), 1);
  const empty = await assemblyPdf({});
  assert.strictEqual(empty.subarray(0, 4).toString(), '%PDF');
});

test('existing cutSvg is untouched by the layer code', async () => {
  const m = await mask('<rect x="100" y="100" width="200" height="200" fill="#000"/>');
  const svg = await cutSvg(m, { widthMm: WMM, heightMm: HMM, laser: { kind: 'cut', board: false } });
  assert.strictEqual(redPaths(svg), 1);
  assert.ok(!svg.includes('guide'));
});
