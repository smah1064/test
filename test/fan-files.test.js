'use strict';
// Print files for tapered drinkware (src/fan-files.js): the rectangle warped to the fan lands on the right arcs,
// nothing prints outside the fan, the mirrored file flips it, the PDFs have the true size; straight bodies stay
// rectangles.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const geom = require('../public/js/drinkware-geom');
const files = require('../src/fan-files');
const drinkware = require('../src/drinkware');

const PRINT = { topMm: 0, heightMm: 120, d1Mm: 90, d2Mm: 65, gapMm: 5, safeMm: 3 };
const FAN = geom.fanOf(PRINT, null);
const IN_W = 1400;
const IN_H = Math.round((IN_W * FAN.Hrect) / FAN.Wrect);
const DOTS = [];
for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const v of [0.1, 0.5, 0.9]) DOTS.push([u, v]);

/** White, opaque, with red dots (r 5 px) at the DOTS (u, v). */
async function dotsPng(w = IN_W, h = IN_H) {
  const dots = DOTS.map(([u, v]) => `<circle cx="${u * w}" cy="${v * h}" r="5" fill="#ff0000"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${dots}</svg>`);
  return sharp(svg).png().toBuffer();
}
async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
/** The centre of the red pixels within r px of (x, y). */
function redCentre(img, x, y, r = 12) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(img.h - 1, Math.ceil(y + r)); j++) {
    for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(img.w - 1, Math.ceil(x + r)); i++) {
      const o = (j * img.w + i) * 4;
      if (img.data[o + 3] > 200 && img.data[o] > 180 && img.data[o + 1] < 90) {
        sx += i + 0.5;
        sy += j + 0.5;
        n++;
      }
    }
  }
  return n ? [sx / n, sy / n, n] : null;
}
const pageSize = (pdf) => {
  const m = pdf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const PT = 72 / 25.4;

test('fanPng: the rectangle lands on the fan (dots on the expected arcs, within 1.5 px)', async () => {
  const out = await files.fanPng(await dotsPng(), FAN, 300);
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.density, 300);
  const k = IN_W / FAN.Wrect; // px per mm, kept from the rectangle
  assert.ok(Math.abs(meta.width - FAN.W * k) <= 1 && Math.abs(meta.height - FAN.H * k) <= 1, `${meta.width} × ${meta.height}`);
  const img = await raw(out);
  const kx = img.w / FAN.W;
  const ky = img.h / FAN.H;
  for (const [u, v] of DOTS) {
    const [X, Y] = geom.fanXY(u, v, FAN);
    const c = redCentre(img, X * kx, Y * ky);
    assert.ok(c, `dot ${u},${v} found`);
    const d = Math.hypot(c[0] - X * kx, c[1] - Y * ky);
    assert.ok(d <= 1.5, `dot ${u},${v} off by ${d.toFixed(2)} px`);
    // On its arc: distance from the fan's centre = Ro − v·s.
    const rho = Math.hypot(c[0] / kx - FAN.W / 2, FAN.Ro - c[1] / ky);
    assert.ok(Math.abs(rho - (FAN.Ro - v * FAN.s)) * k <= 1.5, `dot ${u},${v} radius`);
  }
  // Nothing outside the fan; the inside is solid.
  for (let y = 1; y < img.h; y += 7) {
    for (let x = 1; x < img.w; x += 7) {
      const [u, v] = geom.fanUV((x + 0.5) / kx, (y + 0.5) / ky, FAN);
      const a = img.data[(y * img.w + x) * 4 + 3];
      const mu = 2 / IN_W;
      const mv = 2 / IN_H;
      if (u < -mu || u > 1 + mu || v < -mv || v > 1 + mv) assert.strictEqual(a, 0, `alpha outside at ${x},${y}`);
      else if (u > mu && u < 1 - mu && v > mv && v < 1 - mv) assert.strictEqual(a, 255, `alpha inside at ${x},${y}`);
    }
  }
});

test('fanPng: the mirrored file is the fan flipped left to right', async () => {
  // Only on the left: a mirror that did nothing would fail.
  const w = 700;
  const h = Math.round((w * FAN.Hrect) / FAN.Wrect);
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="40" y="30" width="120" height="90" fill="#00aa00"/></svg>`)).png().toBuffer();
  const a = await raw(await files.fanPng(png, FAN, 150));
  const b = await raw(await files.fanPng(png, FAN, 150, { mirror: true }));
  assert.ok(!a.data.equals(b.data));
  assert.strictEqual(a.w, b.w);
  assert.strictEqual(a.h, b.h);
  let diff = 0;
  for (let y = 0; y < a.h; y += 3) {
    for (let x = 0; x < a.w; x += 3) {
      const i = (y * a.w + x) * 4;
      const j = (y * a.w + (a.w - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(a.data[i + c] - b.data[j + c]));
    }
  }
  assert.ok(diff <= 2, `largest difference ${diff}`);
});

test('fanPng: a stored side.fan (no box) works the same, and the wide edge at the bottom flips', async () => {
  const sideFan = { r1: FAN.r1, r2: FAN.r2, s: FAN.s, Ro: FAN.Ro, Ri: FAN.Ri, theta: FAN.theta, phi: FAN.phi, wideTop: true, gapMm: 5, safeMm: 3 };
  const png = await dotsPng(700, Math.round((700 * FAN.Hrect) / FAN.Wrect));
  const a = await files.fanPng(png, FAN, 150);
  const b = await files.fanPng(png, sideFan, 150);
  assert.ok(a.equals(b));
  const flipped = geom.fanOf({ ...PRINT, d1Mm: 65, d2Mm: 90 }, null);
  const img = await raw(await files.fanPng(png, flipped, 150));
  const kx = img.w / flipped.W;
  const [X, Y] = geom.fanXY(0.5, 0.1, flipped);
  const c = redCentre(img, X * kx, Y * kx);
  assert.ok(c && Math.hypot(c[0] - X * kx, c[1] - Y * kx) <= 1.5, 'the band top is the narrow edge, at the top');
});

test('fanPng: a 3000 × 1500 print is warped in a few seconds', async () => {
  const png = await sharp({ create: { width: 3000, height: 1280, channels: 4, background: '#3366cc' } }).png().toBuffer();
  const t = Date.now();
  const out = await files.fanPng(png, FAN, 300);
  const ms = Date.now() - t;
  assert.ok(ms < 8000, `${ms} ms`);
  assert.ok((await sharp(out).metadata()).width > 2900);
});

test('fanPdf and templatePdf: true size, with the fan box and a 10 mm margin', async () => {
  const png = await files.fanPng(await dotsPng(700, Math.round((700 * FAN.Hrect) / FAN.Wrect)), FAN, 150);
  const pdf = await files.fanPdf(png, FAN, { title: 'Order 1001 · cup', slug: 'trim fan' });
  assert.strictEqual(pdf.toString('latin1', 0, 5), '%PDF-');
  const [w, h] = pageSize(pdf);
  assert.ok(Math.abs(w - (FAN.W + 20) * PT) < 0.5, `width ${w}`);
  assert.ok(Math.abs(h - (FAN.H + 20) * PT) < 0.5, `height ${h}`);
  assert.match(pdf.toString('latin1'), /\/TrimBox/);
  const tpl = await files.templatePdf(FAN, { title: 'Cup' });
  const [tw] = pageSize(tpl);
  assert.ok(Math.abs(tw - (FAN.W + 20) * PT) < 0.5);
});

test('templateSvg: the true-size outline in mm with its dimensions', () => {
  const svg = files.templateSvg(FAN, { title: 'Cup <one>' });
  assert.match(svg, new RegExp(`width="${(FAN.W + 20).toFixed(2)}mm"`));
  assert.match(svg, / A434\.\d\d 434\.\d\d 0 0 1 /, 'the outer arc');
  assert.match(svg, / A313\.\d\d 313\.\d\d 0 0 0 /, 'the inner arc');
  assert.match(svg, /TOP/);
  assert.match(svg, /Cup &lt;one&gt;/);
  assert.match(svg, /outer radius 434\.3 mm/);
  assert.ok(!/NaN|undefined/.test(svg));
});

test('straight bodies: the plain rectangle', async () => {
  const fan = geom.fanOf({ ...PRINT, d2Mm: 90 }, null);
  assert.strictEqual(fan.template, 'rect');
  const png = await sharp({ create: { width: 600, height: 254, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const out = await files.fanPng(png, fan, 200);
  const meta = await sharp(out).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.density], [600, 254, 200]);
  const m = await raw(await files.fanPng(png, fan, 200, { mirror: true }));
  assert.strictEqual(m.data[3], 255);
  const svg = files.templateSvg(fan);
  assert.match(svg, /Straight wrap/);
  assert.ok(!/ A\d/.test(svg));
  const pdf = await files.fanPdf(out, fan, { title: 'x' });
  const [w] = pageSize(pdf);
  assert.ok(Math.abs(w - (fan.Wrect + 20) * PT) < 0.5);
});

test('specSheetPdf: an A4 sheet', async () => {
  const spec = drinkware.buildSpec({ kind: 'mug', handle: { widthMm: 15, y0Mm: 20, y1Mm: 90 }, material: 'gloss', typed: { heightMm: 110, topDiaMm: 85, bottomDiaMm: 75, printTopMm: 8, printHeightMm: 90 } });
  const pdf = await files.specSheetPdf({ id: 'cup-x', name: { en: 'Measured mug', ar: 'مج' } }, spec);
  const [w, h] = pageSize(pdf);
  assert.ok(Math.abs(w - 595.28) < 0.5 && Math.abs(h - 841.89) < 0.5, `${w} × ${h}`);
  const straight = drinkware.buildSpec({ kind: 'cup', typed: { heightMm: 110, topDiaMm: 80, bottomDiaMm: 80, printTopMm: 8, printHeightMm: 90 } });
  assert.strictEqual((await files.specSheetPdf({ id: 'c' }, straight)).toString('latin1', 0, 5), '%PDF-');
});
