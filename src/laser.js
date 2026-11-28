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
 *
 * Multi-layer wall art (docs/multilayer-plan.md): layerCutSvg (one LightBurn file per layer),
 * layerReport (pieces, thin parts, floating pieces of one layer) and assemblyPdf (the A4 sheet
 * for the workshop, Arabic and English).
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
async function strength(buf, meta, w, h, region = null) {
  let img = sharp(buf, LIMIT);
  if (region) img = img.extract(region); // a panel of a set: crop first, then scale
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
  return traceAlpha(a, w, h, ppm, size.widthMm, size.heightMm);
}

/** Trace a strength array of w × h px that covers widthMm × heightMm. */
function traceAlpha(a, w, h, ppm, widthMm, heightMm) {
  const minArea = CUT_MIN_AREA_MM2 * ppm * ppm;
  const result = trace(a, w, h, { threshold: 128, simplify: 0.75, minArea });
  const sx = widthMm / w;
  const sy = heightMm / h;
  return { ...result, scale: [sx, sy], mm2: sx * sy, widthMm, heightMm };
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
const GUIDE_STYLE = 'fill="none" stroke="#0000ff" stroke-width="0.1"';

/** One `<path>` per traced piece, with its holes. */
function piecePaths(t, style) {
  const out = [];
  t.contours.forEach((c, i) => {
    if (c.hole) return;
    const group = [c, ...t.contours.filter((k) => k.parent === i)];
    out.push(`<path ${style} fill-rule="evenodd" d="${pathData(group, t.scale)}"/>`);
  });
  return out;
}

/** `<path>` elements for every cut line (no wrapper); one path per piece with its holes. */
async function cutPaths(buf, { widthMm, heightMm, laser }) {
  const paths = [];
  let w = widthMm;
  let h = heightMm;
  if (laser && laser.kind === 'cut') {
    const t = await traceCut(buf, { widthMm, heightMm });
    w = t.widthMm;
    h = t.heightMm;
    paths.push(...piecePaths(t, CUT_STYLE));
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


// ---------------------------------------------------------------------------
// Multi-layer wall art
// ---------------------------------------------------------------------------

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const REPORT_PX_PER_MM = 4; // thin parts and floating pieces are judged on a coarser grid
const REPORT_MAX_PX = 3000;
const FLOATING_SHARE = 0.3;

/**
 * One layer's mask as a strength array at `maxPpm` px/mm (at most `maxPx` on the long side), cropped to the
 * panel and, for cut layers, with the rim painted in so the rim and the art trace as one outline.
 */
async function layerMask(buf, { widthMm, heightMm, layer, panel, maxPpm, maxPx, rim = true }) {
  const size = await sizeMm(buf, { widthMm, heightMm });
  const p = panel || FULL;
  const pw = size.widthMm * p.w;
  const ph = size.heightMm * p.h;
  const ppm = Math.min(maxPpm, maxPx / Math.max(pw, ph));
  const w = Math.max(1, Math.round(pw * ppm));
  const h = Math.max(1, Math.round(ph * ppm));
  let region = null;
  if (panel) {
    const left = Math.min(size.meta.width - 1, Math.max(0, Math.round(p.x * size.meta.width)));
    const top = Math.min(size.meta.height - 1, Math.max(0, Math.round(p.y * size.meta.height)));
    region = {
      left, top,
      width: Math.max(1, Math.min(size.meta.width - left, Math.round(p.w * size.meta.width))),
      height: Math.max(1, Math.min(size.meta.height - top, Math.round(p.h * size.meta.height))),
    };
  }
  const a = Uint8Array.from(await strength(buf, size.meta, w, h, region));
  const rimMm = rim && layer && layer.kind === 'cut' ? layer.rimMm || 0 : 0;
  if (rimMm > 0) {
    const r = Math.max(1, Math.round(rimMm * ppm));
    for (let y = 0; y < h; y++) {
      const edgeRow = y < r || y >= h - r;
      for (let x = 0; x < w; x++) if (edgeRow || x < r || x >= w - r) a[y * w + x] = 255;
    }
  }
  return { a, w, h, ppm, widthMm: pw, heightMm: ph };
}

/** Outline of a flat board: the layer's own geometry, no tracing. */
function backingPath(layer, w, h) {
  switch (layer.cut) {
    case 'rounded': return roundedRect(w, h, layer.radiusMm > 0 ? layer.radiusMm : BOARD_RADIUS_MM);
    case 'arch': return archPath(w, h);
    case 'round': {
      const r = Math.min(w, h) / 2;
      const cx = w / 2;
      const cy = h / 2;
      return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}Z`;
    }
    default: return roundedRect(w, h, 0);
  }
}

const xml = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/**
 * One layer's LightBurn file (SVG, mm, origin top-left). Red hairlines cut; blue hairlines (`guide`) mark
 * where the next layer is glued; an embedded bitmap (`engrave`) is engraved on this layer.
 * `layer` is a snapshot entry (kind, cut, radiusMm, rimMm). A backing layer is drawn from its geometry
 * (give `widthMm` and `heightMm`); a cut layer is traced from `buf`.
 */
async function layerCutSvg(buf, { widthMm, heightMm, layer, panel = null, engrave = null, guide = null, label = '' } = {}) {
  if (!layer) throw new Error('layerCutSvg: layer is required');
  const p = panel || FULL;
  let w;
  let h;
  const paths = [];
  if (layer.kind === 'backing') {
    if (!(widthMm > 0 && heightMm > 0)) throw new Error('layerCutSvg: a backing layer needs widthMm and heightMm');
    w = widthMm * p.w;
    h = heightMm * p.h;
    paths.push(`<path ${CUT_STYLE} d="${backingPath(layer, w, h)}"/>`);
  } else {
    if (!buf) throw new Error('layerCutSvg: a cut layer needs its mask');
    const m = await layerMask(buf, { widthMm, heightMm, layer, panel, maxPpm: CUT_PX_PER_MM, maxPx: CUT_MAX_PX });
    w = m.widthMm;
    h = m.heightMm;
    paths.push(...piecePaths(traceAlpha(m.a, m.w, m.h, m.ppm, w, h), CUT_STYLE));
  }
  let body = '';
  if (label) body += `<title>${xml(label)}</title>\n<!-- ${xml(label).replace(/--+/g, '-')} -->\n`;
  if (engrave) {
    const size = await sizeMm(engrave, { widthMm, heightMm });
    let crop = engrave;
    if (panel) {
      const left = Math.min(size.meta.width - 1, Math.max(0, Math.round(p.x * size.meta.width)));
      const top = Math.min(size.meta.height - 1, Math.max(0, Math.round(p.y * size.meta.height)));
      crop = await sharp(engrave, LIMIT)
        .extract({ left, top, width: Math.max(1, Math.min(size.meta.width - left, Math.round(p.w * size.meta.width))), height: Math.max(1, Math.min(size.meta.height - top, Math.round(p.h * size.meta.height))) })
        .png().toBuffer();
    }
    const png = await engravePng(crop, { widthMm: w, heightMm: h });
    body += `<g id="engrave"><image x="0" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${png.toString('base64')}"/></g>\n`;
  }
  body += `<g id="cut">\n${paths.join('\n')}\n</g>\n`;
  if (guide) {
    const g = await layerMask(guide, { widthMm, heightMm, layer: null, panel, maxPpm: CUT_PX_PER_MM, maxPx: CUT_MAX_PX });
    const gp = piecePaths(traceAlpha(g.a, g.w, g.h, g.ppm, w, h), GUIDE_STYLE);
    if (gp.length) body += `<g id="guide">\n${gp.join('\n')}\n</g>\n`;
  }
  return svgOpen(w, h) + body + '</svg>\n';
}

/** 4-connected pieces of a mask: [{ area, overlap }] in pixels, `overlap` = pixels also set in `other`. */
function pieceStats(a, w, h, other) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (a[s] < 128 || seen[s]) continue;
    let area = 0;
    let overlap = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      area++;
      if (other && other[i] >= 128) overlap++;
      const x = i % w;
      if (x > 0 && a[i - 1] >= 128 && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && a[i + 1] >= 128 && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (i >= w && a[i - w] >= 128 && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (i < w * (h - 1) && a[i + w] >= 128 && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    out.push({ area, overlap });
  }
  return out;
}

/**
 * What cutting a layer gives, for warnings: pieces and the smallest one (as `cutReport`), the area of the parts
 * thinner than `minFeatureMm` (what disappears when the shape is eroded and grown back by half of it), the
 * pieces with less than 30% of their area on top of `below` (nothing to glue them to) and the bounding box.
 * `below` is the union mask of all lower layers (a backing counts as full); null skips the check.
 */
async function layerReport(buf, { widthMm, heightMm, layer, panel = null, below = null, minFeatureMm = 2 } = {}) {
  const p = panel || FULL;
  if (!layer || layer.kind === 'backing' || !buf) {
    const w = (widthMm || 0) * p.w;
    const h = (heightMm || 0) * p.h;
    return { pieces: 1, smallestMm2: Math.round(w * h * 100) / 100, thinMm2: 0, floating: 0, bboxMm: { w, h } };
  }
  const hi = await layerMask(buf, { widthMm, heightMm, layer, panel, maxPpm: CUT_PX_PER_MM, maxPx: CUT_MAX_PX });
  const t = traceAlpha(hi.a, hi.w, hi.h, hi.ppm, hi.widthMm, hi.heightMm);
  let smallest = null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  t.contours.forEach((c, i) => {
    if (c.hole) return;
    let area = c.area;
    for (const k of t.contours) if (k.parent === i) area -= k.area;
    area *= t.mm2;
    if (smallest === null || area < smallest) smallest = area;
    for (const [x, y] of c.points) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  });
  const bboxMm = smallest === null ? { w: 0, h: 0 } : { w: Math.round((x1 - x0) * t.scale[0] * 100) / 100, h: Math.round((y1 - y0) * t.scale[1] * 100) / 100 };

  const lo = await layerMask(buf, { widthMm, heightMm, layer, panel, maxPpm: REPORT_PX_PER_MM, maxPx: REPORT_MAX_PX });
  const { a, w, h, ppm } = lo;
  // Opening: erode, then grow back. Whatever does not come back is thinner than `minFeatureMm`.
  const r = Math.max(1, Math.round((minFeatureMm / 2) * ppm));
  const eroded = near(a, w, h, r, (v) => v < 128); // 1 where a clear pixel is within r
  const core = new Uint8Array(w * h);
  for (let i = 0; i < core.length; i++) core[i] = a[i] >= 128 && !eroded[i] ? 255 : 0;
  const opened = near(core, w, h, r, (v) => v >= 128);
  let thin = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= 128 && !opened[i]) thin++;
  const mm2PerPx = (lo.widthMm / w) * (lo.heightMm / h);

  let floating = 0;
  if (below) {
    const under = await layerMask(below, { widthMm, heightMm, layer: null, panel, maxPpm: REPORT_PX_PER_MM, maxPx: REPORT_MAX_PX });
    const minPx = CUT_MIN_AREA_MM2 / mm2PerPx;
    // `under` has the same grid as `a` (same size and panel), so pixels line up.
    for (const piece of pieceStats(a, w, h, under.w === w && under.h === h ? under.a : null)) {
      if (piece.area >= minPx && piece.overlap < piece.area * FLOATING_SHARE) floating++;
    }
  }
  return {
    pieces: t.pieces,
    smallestMm2: smallest === null ? 0 : Math.round(smallest * 100) / 100,
    thinMm2: Math.round(thin * mm2PerPx * 100) / 100,
    floating,
    bboxMm,
  };
}

// --- assembly sheet --------------------------------------------------------

const ARABIC_FONTS = { 400: 'cairo-arabic-400-normal.woff2', 700: 'cairo-arabic-700-normal.woff2' };
const arabicFonts = {};
const AR = '؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿';
const AR_RUN = new RegExp(`([${AR}][${AR}\\s،؟]*)`);
const AR_TEST = new RegExp(`[${AR}]`);

/** Cairo Arabic (the site's own font) through fontkit, which pdfkit already depends on; null if unavailable. */
function arabicFont(weight) {
  if (arabicFonts[weight] !== undefined) return arabicFonts[weight];
  try {
    const path = require('path').join(__dirname, '..', 'public', 'fonts', 'files', ARABIC_FONTS[weight]);
    arabicFonts[weight] = require('fontkit').openSync(path);
  } catch (e) {
    arabicFonts[weight] = null;
  }
  return arabicFonts[weight];
}

/**
 * Right-to-left line drawn as vector outlines (pdfkit cannot subset the site's woff2 fonts, and outlines
 * need no embedded font). Arabic runs are shaped by fontkit; digits and Latin words inside the line use
 * Helvetica. `anchor` = the right edge ('right') or the left edge ('left') of the line; the font shrinks
 * to fit `maxWidth`.
 */
function arabicText(doc, text, anchor, y, { size = 9, bold = false, color = '#111111', align = 'right', maxWidth = 1e9 } = {}) {
  text = String(text || '');
  if (!text) return 0;
  const font = arabicFont(bold ? 700 : 400);
  if (!font || !AR_TEST.test(text)) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    const wd = doc.widthOfString(text);
    doc.text(text, align === 'right' ? anchor - wd : anchor, y, { lineBreak: false });
    return wd;
  }
  // Logical runs: Arabic words, and everything else (digits, Latin) as a left-to-right block whose leading and
  // trailing punctuation is split off so a colon after an Arabic label stays next to the label.
  const logical = [];
  for (const r of text.split(AR_RUN).filter((x) => x !== '')) {
    if (AR_TEST.test(r)) { logical.push({ ar: true, text: r }); continue; }
    const m = /^([\s:.,;|\u2013-]*)([\s\S]*?)([\s:.,;|\u2013-]*)$/.exec(r);
    for (const part of [m[1], m[2], m[3]]) if (part) logical.push({ ar: false, text: part });
  }
  const runs = logical.reverse(); // visual order, left to right
  const measure = (sz) => {
    const k = sz / font.unitsPerEm;
    return runs.map((r) => {
      if (!r.ar) { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz); return { ...r, width: doc.widthOfString(r.text) }; }
      const lay = font.layout(r.text.trim(), [], 'arab', 'ar', 'rtl');
      const gap = sz * 0.25; // a space at either end of an Arabic run
      const lead = /^\s/.test(r.text) ? gap : 0;
      const trail = /\s$/.test(r.text) ? gap : 0;
      return { ...r, lay, k, lead, width: lead + trail + lay.positions.reduce((q, g) => q + g.xAdvance * k, 0) };
    });
  };
  let sz = size;
  let parts = measure(sz);
  let total = parts.reduce((s, r) => s + r.width, 0);
  if (total > maxWidth) { sz = Math.max(4, (size * maxWidth) / total); parts = measure(sz); total = parts.reduce((s, r) => s + r.width, 0); }
  let x = align === 'right' ? anchor - total : anchor;
  const base = y + sz * 0.82; // baseline
  for (const r of parts) {
    if (!r.ar) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz).fillColor(color).text(r.text, x, y, { lineBreak: false });
    } else {
      let cx = x + r.lead;
      r.lay.glyphs.forEach((g, i) => {
        const q = r.lay.positions[i];
        const d = g.path.toSVG();
        if (d) doc.save().translate(cx + q.xOffset * r.k, base - q.yOffset * r.k).scale(r.k, -r.k).path(d).fill(color).restore();
        cx += q.xAdvance * r.k;
      });
    }
    x += r.width;
  }
  return total;
}

const bi = (v) => (v && typeof v === 'object' ? { en: String(v.en || v.ar || ''), ar: String(v.ar || '') } : { en: String(v == null ? '' : v), ar: '' });

const SHEET_NOTES = [
  { en: 'Glue from the back board up. Layer 1 is the back; stack the layers in number order.', ar: 'الصق من لوح الخلفية لفوق. الطبقة الأولى هي الخلفية، ورصّ الطبقات بترتيب الأرقام.' },
  { en: 'The rims line the layers up with each other.', ar: 'الحواف بتظبّط الطبقات فوق بعض.' },
  { en: 'Blue lines in the cut files are placement guides, not cuts.', ar: 'الخطوط الزرقاء في ملفات القص للتوجيه بس، مش للقص.' },
  { en: 'Files carry no kerf compensation: set it in LightBurn.', ar: 'الملفات من غير تعويض عرض القص: اظبطه في LightBurn.' },
];

/**
 * The A4 assembly sheet (PDF) for the workshop, in English and Arabic: stacking order, material, colour,
 * thickness, pieces and file of each layer with a picture of it, the finished piece, the frame and the
 * fixed notes. `layers` = [{ n, id, name, materialName, hex, thicknessMm, pieces, file, thumb: Buffer, zMm? }],
 * bottom to top. Names may be strings or { en, ar }. `preview` (optional PNG) is the finished piece;
 * `depthMm` (optional) overrides the total depth worked out from the layers.
 */
async function assemblyPdf({ title = '', product = '', sizeLabel = '', widthMm = 0, heightMm = 0, layers = [], panels = null, frame = null, notes = [], preview = null, depthMm = null } = {}) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Assembly sheet ${title}`.trim(), Creator: 'ebda3.me' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const M = 36;
  const W = doc.page.width - 2 * M;
  const L = M;
  const R = M + W;
  const pr = bi(product);
  const sz = bi(sizeLabel);
  const text = (t, x, y, o = {}) => {
    doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 9).fillColor(o.color || '#111111');
    doc.text(String(t), x, y, { lineBreak: false, ...(o.width ? { width: o.width, ellipsis: true, height: (o.size || 9) * 1.3 } : {}), ...(o.align ? { align: o.align } : {}) });
  };
  const ar = (t, x, y, o = {}) => arabicText(doc, t, x, y, o);

  // Header
  text('Assembly sheet', L, M, { size: 17, bold: true });
  ar('ورقة التجميع', R, M, { size: 17, bold: true });
  text([title, pr.en].filter(Boolean).join('  |  '), L, M + 24, { size: 10.5, bold: true, width: W * 0.62 });
  if (pr.ar) ar(pr.ar, R, M + 24, { size: 10.5, bold: true, maxWidth: W * 0.36 });
  const dim = widthMm && heightMm ? `${Math.round(widthMm / 10 * 10) / 10} x ${Math.round(heightMm / 10 * 10) / 10} cm` : '';
  text(['Size', sz.en || dim].join(': '), L, M + 41, { size: 9, color: '#444444' });
  ar(`المقاس: ${sz.ar || sz.en || dim}`, R, M + 41, { size: 9, color: '#444444' });
  const panelCount = Array.isArray(panels) ? panels.length : Number(panels) || 0;
  if (panelCount > 1) {
    text(`Panels: ${panelCount}`, L + 230, M + 41, { size: 9, color: '#444444' });
    ar(`عدد اللوحات: ${panelCount}`, R - 150, M + 41, { size: 9, color: '#444444' });
  }
  doc.moveTo(L, M + 58).lineTo(R, M + 58).lineWidth(0.8).strokeColor('#222222').stroke();

  // Table
  const list = layers.slice(0, 8);
  const cols = [
    { x: L, w: 26, en: 'Layer', ar: 'الطبقة' },
    { x: L + 26, w: 58, en: 'Picture', ar: 'الشكل' },
    { x: L + 86, w: 128, en: 'Name', ar: 'الاسم' },
    { x: L + 216, w: 118, en: 'Material', ar: 'الخامة' },
    { x: L + 336, w: 40, en: 'Colour', ar: 'اللون' },
    { x: L + 378, w: 38, en: 'mm', ar: 'السُمك' },
    { x: L + 418, w: 34, en: 'Pieces', ar: 'القطع' },
    { x: L + 454, w: W - 454, en: 'File', ar: 'الملف' },
  ];
  const ty = M + 66;
  doc.rect(L, ty, W, 22).fill('#eeeeee');
  for (const c of cols) {
    text(c.en, c.x + 2, ty + 3, { size: 7.5, bold: true, width: c.w - 3 });
    ar(c.ar, c.x + c.w - 2, ty + 12, { size: 7, color: '#333333', maxWidth: c.w - 4 });
  }
  const rowH = Math.min(58, Math.floor(400 / Math.max(1, list.length)));
  let y = ty + 24;
  list.forEach((l, i) => {
    const nm = bi(l.name);
    const mt = bi(l.materialName);
    if (i % 2 === 1) doc.rect(L, y - 1, W, rowH).fill('#f8f8f8');
    text(String(l.n != null ? l.n : i + 1), cols[0].x + 4, y + rowH / 2 - 9, { size: 14, bold: true });
    doc.rect(cols[1].x + 2, y + 1, cols[1].w - 4, rowH - 4).fill('#e4e4e4');
    if (l.thumb) { try { doc.image(l.thumb, cols[1].x + 3, y + 2, { fit: [cols[1].w - 6, rowH - 6], align: 'center', valign: 'center' }); } catch (e) { /* unreadable thumbnail: leave the grey box */ } }
    text(nm.en, cols[2].x + 2, y + 6, { size: 9, bold: true, width: cols[2].w - 4 });
    if (nm.ar) ar(nm.ar, cols[2].x + cols[2].w - 3, y + 20, { size: 9, maxWidth: cols[2].w - 6 });
    if (i === 0) { text('Back', cols[2].x + 2, y + 36, { size: 7.5, color: '#666666' }); ar('الخلفية', cols[2].x + cols[2].w - 3, y + 36, { size: 7.5, color: '#666666' }); }
    text(mt.en, cols[3].x + 2, y + 6, { size: 9, width: cols[3].w - 4 });
    if (mt.ar) ar(mt.ar, cols[3].x + cols[3].w - 3, y + 20, { size: 9, maxWidth: cols[3].w - 6 });
    doc.roundedRect(cols[4].x + 4, y + 6, 30, 22, 3).lineWidth(0.5).fillAndStroke(/^#[0-9a-f]{6}$/i.test(l.hex || '') ? l.hex : '#cccccc', '#555555');
    text(String(l.hex || ''), cols[4].x + 1, y + 32, { size: 6.5, color: '#555555', width: cols[4].w });
    text(`${l.thicknessMm != null ? l.thicknessMm : ''}`, cols[5].x + 2, y + 8, { size: 10, bold: true });
    text(String(l.pieces != null ? l.pieces : ''), cols[6].x + 2, y + 8, { size: 10 });
    doc.font('Helvetica').fontSize(6.5).fillColor('#333333').text(String(l.file || ''), cols[7].x + 2, y + 4, { width: cols[7].w - 3, height: rowH - 8, ellipsis: true });
    y += rowH;
  });
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#999999').stroke();

  // Totals and frame
  const depth = depthMm != null ? depthMm : Math.round(Math.max(0, ...list.map((l) => (l.zMm != null ? l.zMm : 0) + (Number(l.thicknessMm) || 0))) * 100) / 100
    || list.reduce((s, l) => s + (Number(l.thicknessMm) || 0), 0);
  y += 8;
  const fr = bi(frame);
  text(`Total depth of the stack: ${depth} mm`, L, y, { size: 9, bold: true });
  ar(`عمق الطبقات كلها: ${depth} مم`, R, y, { size: 9, bold: true });
  y += 14;
  text(`Frame: ${fr.en || 'none'}`, L, y, { size: 9 });
  ar(`الإطار: ${fr.ar || (fr.en ? fr.en : 'من غير')}`, R, y, { size: 9 });
  y += 18;

  // Finished piece and notes
  const bottom = doc.page.height - M - 12;
  const picH = Math.min(150, bottom - y);
  let notesX = L;
  let notesW = W;
  if (preview && picH > 60) {
    doc.rect(L, y, 110, picH).fill('#eeeeee');
    try { doc.image(preview, L + 2, y + 2, { fit: [106, picH - 16], align: 'center', valign: 'center' }); } catch (e) { /* unreadable picture */ }
    text('Finished piece', L + 2, y + picH - 12, { size: 7, color: '#555555' });
    ar('الشكل النهائي', L + 108, y + picH - 12, { size: 7, color: '#555555' });
    notesX = L + 122;
    notesW = W - 122;
  }
  const all = [...SHEET_NOTES, ...(notes || []).map(bi)];
  const noteH = Math.min(36, Math.floor((bottom - y) / Math.max(1, all.length)));
  all.forEach((t, i) => {
    const ny = y + i * noteH;
    text(`${i + 1}. ${t.en}`, notesX, ny, { size: 8, width: notesW });
    if (t.ar) ar(t.ar, notesX + notesW, ny + 11, { size: 8, maxWidth: notesW });
  });
  text('Cut files: red = cut, blue = placement guide, image = engrave. Real size in mm.', L, doc.page.height - M - 2, { size: 6.5, color: '#888888', width: W });

  doc.end();
  return done;
}

module.exports = { engravePng, cutSvg, laserSvg, cutReport, layerCutSvg, layerReport, assemblyPdf };
