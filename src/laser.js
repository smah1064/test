'use strict';

/**
 * Laser production files (CO2 engraving and cutting), made from the print PNG
 * the editor uploads for each side. In that PNG only alpha matters: it is where
 * and how strongly the laser fires; the ink colour is just the on-screen look.
 *
 *   engravePng  black-on-white bitmap at the laser's DPI (LightBurn image layer)
 *   cutSvg      red hairline cut paths in mm (the design's outline and/or the board)
 *   laserSvg    both in one file, ready to open in LightBurn
 *   cutReport   how many pieces a cut makes and how small the smallest is
 */
const sharp = require('sharp');
const { trace, pathData } = require('../public/js/trace.js');

sharp.cache(false); // big, one-off images

const MM_PER_IN = 25.4;
const EDITOR_DPI = 300; // print PNGs are made at ~300 DPI when they carry no density
const CUT_PX_PER_MM = 12; // trace resolution: 0.08 mm per pixel is finer than the kerf
const CUT_MAX_PX = 4000;
const CUT_MIN_AREA_MM2 = 0.25; // smaller bits are antialiasing dust, not pieces
const BOARD_RADIUS_MM = 4; // corners of the puzzle board
const LIMIT = { limitInputPixels: 80e6 };

/** Physical size of the print in mm: the caller's numbers win, then the PNG's density, then the editor's 300 DPI. */
async function sizeMm(buf, { widthMm, heightMm } = {}) {
  const m = await sharp(buf, LIMIT).metadata();
  const dpi = m.density && m.density > 1 ? m.density : EDITOR_DPI;
  const w = widthMm > 0 ? widthMm : (m.width / dpi) * MM_PER_IN;
  const h = heightMm > 0 ? heightMm : (w * m.height) / m.width;
  return { widthMm: w, heightMm: h, meta: m };
}

/**
 * Laser strength per pixel (0 = off, 255 = full) at w × h. Normally the alpha
 * channel; an image without alpha is taken as dark-on-light artwork instead.
 */
async function strength(buf, meta, w, h) {
  let img = sharp(buf, LIMIT);
  img = meta.hasAlpha ? img.ensureAlpha().extractChannel('alpha') : img.greyscale().negate({ alpha: false });
  const { data } = await img.resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  // Some inputs come back with more than one channel; keep the first.
  if (data.length === w * h) return data;
  const ch = data.length / (w * h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * ch];
  return out;
}

/** True where any pixel within `r` (square window) passes `test`: a cheap separable dilation. */
function near(src, w, h, r, test) {
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    const o = y * w;
    for (let x = 0; x < w; x++) { if (test(src[o + x])) last = x; if (x - last <= r) rows[o + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (test(src[o + x])) last = x; if (last - x <= r) rows[o + x] = 1; }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (rows[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (rows[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}

const SOLID = 245;
const CLEAR = 10;

/**
 * 1-bit engraving: solid stays solid, antialiased edges are cut cleanly at 50%,
 * and real in-between tones (photos, soft shadows) are Floyd–Steinberg dithered.
 * An edge pixel is a partial one that sits between solid and clear within 2 px;
 * dithering those would fray the outline of every letter.
 */
function dither(a, w, h) {
  const nearSolid = near(a, w, h, 2, (v) => v >= SOLID);
  const nearClear = near(a, w, h, 2, (v) => v <= CLEAR);
  const out = new Uint8Array(w * h).fill(255);
  let err = new Float32Array(w + 2);
  let next = new Float32Array(w + 2);
  for (let y = 0; y < h; y++) {
    // Serpentine order avoids the diagonal "worms" of one-way scanning.
    const ltr = (y & 1) === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      const v = a[i];
      if (v >= SOLID || v <= CLEAR || (nearSolid[i] && nearClear[i])) {
        if (v >= 128) out[i] = 0;
        continue; // fixed pixels neither take nor pass on error
      }
      const want = v + err[x + 1];
      const fire = want >= 128;
      if (fire) out[i] = 0;
      const e = want - (fire ? 255 : 0);
      const s = ltr ? 1 : -1;
      err[x + 1 + s] += (e * 7) / 16;
      next[x + 1 - s] += (e * 3) / 16;
      next[x + 1] += (e * 5) / 16;
      next[x + 1 + s] += e / 16;
    }
    [err, next] = [next, err];
    next.fill(0);
  }
  return out;
}

/** Engraving bitmap for LightBurn: black = fire, white = off, at `dpi`, same physical size as the print. */
async function engravePng(buf, { widthMm, heightMm, dpi = 254 } = {}) {
  const size = await sizeMm(buf, { widthMm, heightMm });
  const w = Math.max(1, Math.round((size.widthMm / MM_PER_IN) * dpi));
  const h = Math.max(1, Math.round((size.heightMm / MM_PER_IN) * dpi));
  const bw = dither(await strength(buf, size.meta, w, h), w, h);
  return sharp(Buffer.from(bw.buffer), { raw: { width: w, height: h, channels: 1 } })
    .withDensity(dpi)
    .png({ palette: true, colours: 2, bitdepth: 1, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

/** The design traced at cut resolution; `scale` turns pixels into mm. */
async function traceCut(buf, opts) {
  const size = await sizeMm(buf, opts);
  const ppm = Math.min(CUT_PX_PER_MM, CUT_MAX_PX / Math.max(size.widthMm, size.heightMm));
  const w = Math.max(1, Math.round(size.widthMm * ppm));
  const h = Math.max(1, Math.round(size.heightMm * ppm));
  const a = await strength(buf, size.meta, w, h);
  const minArea = CUT_MIN_AREA_MM2 * ppm * ppm;
  const result = trace(a, w, h, { threshold: 128, simplify: 0.75, minArea });
  const sx = size.widthMm / w;
  const sy = size.heightMm / h;
  return { ...result, scale: [sx, sy], mm2: sx * sy, widthMm: size.widthMm, heightMm: size.heightMm };
}

const n = (v) => String(Math.round(v * 1000) / 1000);

/** Rounded rectangle path covering 0,0 .. w,h. */
function roundedRect(w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return `M0 0H${n(w)}V${n(h)}H0Z`;
  const a = `A${n(r)} ${n(r)} 0 0 1`;
  return `M${n(r)} 0H${n(w - r)}${a} ${n(w)} ${n(r)}V${n(h - r)}${a} ${n(w - r)} ${n(h)}H${n(r)}${a} 0 ${n(h - r)}V${n(r)}${a} ${n(r)} 0Z`;
}

/** Church-window board: straight sides and bottom, a half circle across the full width on top (flattened if the board is shorter than that). */
function archPath(w, h) {
  const rx = w / 2;
  const ry = Math.min(rx, h);
  return `M0 ${n(h)}V${n(ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}V${n(h)}Z`;
}

/** Board outline cut around an engraving (or around puzzle letters); '' when there is none. */
function boardPath(laser, w, h) {
  if (!laser) return '';
  if (laser.kind === 'cut') return laser.board ? roundedRect(w, h, BOARD_RADIUS_MM) : '';
  if (laser.cut === 'rounded') return roundedRect(w, h, laser.radiusMm ?? 3);
  if (laser.cut === 'arch') return archPath(w, h);
  if (laser.cut === 'rect') return roundedRect(w, h, 0);
  return '';
}

const CUT_STYLE = 'fill="none" stroke="#ff0000" stroke-width="0.1"';

/** `<path>` elements for every cut line (no wrapper); one path per piece with its holes. */
async function cutPaths(buf, { widthMm, heightMm, laser }) {
  const paths = [];
  let w = widthMm;
  let h = heightMm;
  if (laser && laser.kind === 'cut') {
    const t = await traceCut(buf, { widthMm, heightMm });
    w = t.widthMm;
    h = t.heightMm;
    t.contours.forEach((c, i) => {
      if (c.hole) return;
      const group = [c, ...t.contours.filter((k) => k.parent === i)];
      paths.push(`<path ${CUT_STYLE} fill-rule="evenodd" d="${pathData(group, t.scale)}"/>`);
    });
  } else if (!(w > 0 && h > 0)) {
    ({ widthMm: w, heightMm: h } = await sizeMm(buf, { widthMm, heightMm }));
  }
  const board = boardPath(laser, w, h);
  if (board) paths.push(`<path ${CUT_STYLE} d="${board}"/>`);
  return { paths, widthMm: w, heightMm: h };
}

function svgOpen(w, h) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}">\n`;
}

/** Cut lines only, in mm: red hairlines, which LightBurn and most laser software treat as "cut". */
async function cutSvg(buf, { widthMm, heightMm, laser } = {}) {
  const { paths, widthMm: w, heightMm: h } = await cutPaths(buf, { widthMm, heightMm, laser });
  return svgOpen(w, h) + `<g id="cut">\n${paths.join('\n')}\n</g>\n</svg>\n`;
}

/** One LightBurn file: the engraving bitmap (not for cut-only products) under the red cut lines. */
async function laserSvg(buf, { widthMm, heightMm, laser, dpi = 254 } = {}) {
  const size = await sizeMm(buf, { widthMm, heightMm });
  const { paths } = await cutPaths(buf, { widthMm: size.widthMm, heightMm: size.heightMm, laser });
  let body = '';
  if (!laser || laser.kind !== 'cut') {
    const png = await engravePng(buf, { widthMm: size.widthMm, heightMm: size.heightMm, dpi });
    body += `<g id="engrave"><image x="0" y="0" width="${n(size.widthMm)}" height="${n(size.heightMm)}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${png.toString('base64')}"/></g>\n`;
  }
  if (paths.length) body += `<g id="cut">\n${paths.join('\n')}\n</g>\n`;
  return svgOpen(size.widthMm, size.heightMm) + body + '</svg>\n';
}

/**
 * What a cut along the design's outline would produce: the number of separate
 * pieces and the area of the smallest one (its own holes taken out), so the
 * shop can warn before a topper falls apart or a dot is lost in the machine.
 */
async function cutReport(buf, { widthMm, heightMm } = {}) {
  const t = await traceCut(buf, { widthMm, heightMm });
  let smallest = null;
  t.contours.forEach((c, i) => {
    if (c.hole) return;
    let area = c.area;
    for (const k of t.contours) if (k.parent === i) area -= k.area;
    area *= t.mm2;
    if (smallest === null || area < smallest) smallest = area;
  });
  return { pieces: t.pieces, smallestMm2: smallest === null ? 0 : Math.round(smallest * 100) / 100 };
}

module.exports = { engravePng, cutSvg, laserSvg, cutReport };
