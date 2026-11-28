'use strict';
// Laser production files: tracing cut outlines, the engraving bitmap and the LightBurn SVG.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { trace, pathData } = require('../public/js/trace');
const { engravePng, cutSvg, laserSvg, cutReport } = require('../src/laser');

/** Transparent print PNG of w × h px with an SVG drawn on it (like the editor's `<side>-print.png`). */
async function print(w, h, body, { density } = {}) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  let img = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg, left: 0, top: 0 }]);
  if (density) img = img.withDensity(density);
  return img.png().toBuffer();
}

/** Bounding box of every number pair in the path data of the cut lines. */
function bbox(svg) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [, d] of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const m of d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
      const x = +m[1], y = +m[2];
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
  }
  return box;
}

async function pixels(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

test('trace: outer outlines, holes linked to their parent, specks dropped', () => {
  const w = 40, h = 40;
  const a = new Uint8Array(w * h);
  const fill = (x0, y0, x1, y1, v = 255) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = v; };
  fill(5, 5, 25, 25); // a ring ...
  fill(10, 10, 20, 20, 0);
  fill(13, 13, 17, 17); // ... with an island in its hole
  fill(30, 30, 31, 31); // a 1 px speck
  const r = trace(a, w, h);
  assert.strictEqual(r.pieces, 2); // the ring and the island; the speck is gone
  assert.deepStrictEqual(r.contours.map((c) => [c.hole, c.parent, c.area]), [[false, -1, 400], [true, 0, 100], [false, 1, 16]]);
  assert.deepStrictEqual(r.contours[0].points.slice().sort(), [[5, 5], [5, 25], [25, 5], [25, 25]].sort());
  // The island (13..17 px) scaled by 2 and moved by 1: corners at 27 and 35.
  assert.match(pathData([r.contours[2]], 2, [1, 1]), /^M(?:(?:27|35) (?:27|35)L){3}(?:27|35) (?:27|35)Z$/);
  assert.match(pathData(r.contours), /^M[^M]+Z M[^M]+Z M[^M]+Z$/);
});

test('trace: pixels touching only at a corner are separate pieces', () => {
  const r = trace(new Uint8Array([255, 0, 0, 255]), 2, 2, { minArea: 0 });
  assert.strictEqual(r.pieces, 2);
});

test('trace: a 3000 × 3000 bitmap is quick', () => {
  const N = 3000;
  const a = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - 1500, y - 1500);
    if ((d > 600 && d < 1400) || ((x >> 5) % 3 === 0 && (y >> 5) % 3 === 0)) a[y * N + x] = 255;
  }
  const t = Date.now();
  const r = trace(a, N, N);
  assert.ok(r.pieces > 100);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
});

test('cut: one filled square is one piece with the right size in mm', async () => {
  // 600 px for 50 mm; the square is pixels 150..450, i.e. 12.5..37.5 mm.
  const png = await print(600, 600, '<rect x="150" y="150" width="300" height="300" fill="#a8784a"/>');
  const svg = await cutSvg(png, { widthMm: 50, heightMm: 50, laser: { kind: 'cut', pieces: 'one' } });
  assert.match(svg, /width="50mm" height="50mm" viewBox="0 0 50 50"/);
  assert.match(svg, /fill="none" stroke="#ff0000" stroke-width="0.1"/);
  assert.strictEqual(svg.match(/<path /g).length, 1);
  assert.match(svg, / d="M[^"]+Z"/); // closed
  const b = bbox(svg);
  for (const [got, want] of [[b.x0, 12.5], [b.y0, 12.5], [b.x1, 37.5], [b.y1, 37.5]]) assert.ok(Math.abs(got - want) < 1, `${got} vs ${want}`);
  const rep = await cutReport(png, { widthMm: 50, heightMm: 50 });
  assert.strictEqual(rep.pieces, 1);
  assert.ok(Math.abs(rep.smallestMm2 - 625) < 15, String(rep.smallestMm2));
});

test('cut: two separate squares are two pieces, the smaller one reported', async () => {
  const png = await print(600, 300, '<rect x="20" y="20" width="200" height="200"/><rect x="400" y="50" width="60" height="60"/>');
  const rep = await cutReport(png, { widthMm: 60, heightMm: 30 }); // 10 px per mm
  assert.strictEqual(rep.pieces, 2);
  assert.ok(Math.abs(rep.smallestMm2 - 36) < 2, String(rep.smallestMm2));
});

test('cut: a ring is one piece with one hole; the puzzle adds its board', async () => {
  const png = await print(500, 500, '<circle cx="250" cy="250" r="150" fill="none" stroke="#000" stroke-width="60"/>');
  const rep = await cutReport(png, { widthMm: 50, heightMm: 50 });
  assert.strictEqual(rep.pieces, 1);
  const { data, info } = await sharp(png).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const r = trace(data, info.width, info.height);
  assert.deepStrictEqual(r.contours.map((c) => [c.hole, c.parent]), [[false, -1], [true, 0]]);
  // Ring area: π(180² − 120²) px² at 10 px per mm.
  assert.ok(Math.abs(rep.smallestMm2 - (Math.PI * (180 ** 2 - 120 ** 2)) / 100) < 10, String(rep.smallestMm2));

  const svg = await cutSvg(png, { widthMm: 50, heightMm: 50, laser: { kind: 'cut', pieces: 'many', board: true } });
  const paths = svg.match(/<path [^>]+>/g);
  assert.strictEqual(paths.length, 2); // the ring (outer + hole in one path) and the board
  assert.strictEqual(paths[0].match(/M/g).length, 2);
  assert.match(paths[1], /d="M4 0H46A4 4 0 0 1 50 4V46/);
});

test('cut: board outlines for engraved boards have the right size', async () => {
  const png = await print(400, 600, '<text x="50" y="300" font-size="60">Ahlan</text>');
  const arch = await cutSvg(png, { widthMm: 400, heightMm: 600, laser: { kind: 'engrave', cut: 'arch' } });
  assert.match(arch, /width="400mm" height="600mm" viewBox="0 0 400 600"/);
  assert.match(arch, /d="M0 600V200A200 200 0 0 1 400 200V600Z"/);
  const rounded = await cutSvg(png, { widthMm: 200, heightMm: 300, laser: { kind: 'engrave', cut: 'rounded', radiusMm: 8 } });
  assert.match(rounded, /width="200mm" height="300mm" viewBox="0 0 200 300"/);
  assert.match(rounded, /d="M8 0H192A8 8 0 0 1 200 8V292A8 8 0 0 1 192 300H8A8 8 0 0 1 0 292V8A8 8 0 0 1 8 0Z"/);
  const rect = await cutSvg(png, { widthMm: 100, heightMm: 100, laser: { kind: 'engrave', cut: 'rect' } });
  assert.match(rect, /d="M0 0H100V100H0Z"/);
  const blank = await cutSvg(png, { widthMm: 100, heightMm: 100, laser: { kind: 'engrave', cut: null } });
  assert.doesNotMatch(blank, /<path/);
});

test('engrave: solid stays solid, 50% alpha is dithered to about half, density is written', async () => {
  // Left half 50% alpha, right half solid; 1200 px = 100 mm.
  const png = await print(1200, 600, '<rect x="0" y="0" width="600" height="600" fill="#5a3416" fill-opacity="0.5"/><rect x="600" y="0" width="600" height="600" fill="#5a3416"/>');
  const out = await engravePng(png, { widthMm: 100, dpi: 254 });
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.density, 254);
  assert.strictEqual(meta.width, 1000);
  assert.strictEqual(meta.height, 500);
  const { data, w, h } = await pixels(out);
  assert.ok(data.every((v) => v === 0 || v === 255), 'only black and white');
  let half = 0, halfN = 0, solid = 0, solidN = 0;
  for (let y = 5; y < h - 5; y++) {
    for (let x = 5; x < w / 2 - 5; x++) { halfN++; if (!data[y * w + x]) half++; }
    for (let x = w / 2 + 5; x < w - 5; x++) { solidN++; if (!data[y * w + x]) solid++; }
  }
  assert.ok(Math.abs(half / halfN - 0.5) < 0.05, String(half / halfN));
  assert.strictEqual(solid, solidN);
  // Another DPI: same physical size.
  const m300 = await sharp(await engravePng(png, { widthMm: 100, dpi: 300 })).metadata();
  assert.deepStrictEqual([m300.width, m300.density], [1181, 300]);
});

test('engrave: without widthMm the size comes from the PNG density', async () => {
  const png = await print(1181, 591, '<rect x="100" y="100" width="300" height="300"/>', { density: 300 });
  const meta = await sharp(await engravePng(png, { dpi: 254 })).metadata();
  assert.strictEqual(meta.width, 1000); // 100 mm at 254 DPI
  assert.ok(Math.abs(meta.height - 500) <= 1);
});

test('laserSvg: engraving image for engrave products, none for cut ones', async () => {
  const png = await print(600, 600, '<rect x="100" y="100" width="400" height="400" rx="40"/>');
  const eng = await laserSvg(png, { widthMm: 100, heightMm: 100, laser: { kind: 'engrave', cut: 'rounded', radiusMm: 2 } });
  assert.match(eng, /<image x="0" y="0" width="100" height="100" [^>]*xlink:href="data:image\/png;base64,/);
  assert.match(eng, /<g id="cut">/);
  const blank = await laserSvg(png, { widthMm: 100, heightMm: 100, laser: { kind: 'engrave', cut: null } });
  assert.match(blank, /<image /);
  assert.doesNotMatch(blank, /<g id="cut">/);
  const cut = await laserSvg(png, { widthMm: 100, heightMm: 100, laser: { kind: 'cut', pieces: 'one' } });
  assert.doesNotMatch(cut, /<image/);
  assert.match(cut, /stroke="#ff0000"/);
});

test('cut: Arabic text traces into pieces without trouble', async () => {
  const png = await print(1200, 400, '<text x="600" y="260" font-size="200" text-anchor="middle" font-weight="bold" fill="#e64980" direction="rtl">عائلة محمد</text>');
  const rep = await cutReport(png, { widthMm: 150, heightMm: 50 });
  assert.ok(rep.pieces >= 2, `pieces ${rep.pieces}`); // separate words and the dots at least
  assert.ok(rep.smallestMm2 > 0);
  const svg = await cutSvg(png, { widthMm: 150, heightMm: 50, laser: { kind: 'cut', pieces: 'one' } });
  assert.strictEqual(svg.match(/<path /g).length, rep.pieces);
  const b = bbox(svg);
  assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 150 && b.y1 <= 50);
});
