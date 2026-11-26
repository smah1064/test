'use strict';
/**
 * Automatic preflight of a design's production files (the print PNGs).
 *
 * preflight(design, { readFile, product }) -> { status, checks }
 *   checks: [ { id, level: 'info'|'warn'|'fail', side?, params } ]
 * Check ids and params follow the shared proof contract (resolution, exportSize,
 * empty, outsideSafe, semiTransparent, blankPages, fontNoArabic; fontFallback,
 * lowResImage, tinyText and fileType come from the editor through mergeClientChecks).
 */
const sharp = require('sharp');
const { pageSides } = require('./products');

const DPI_FAIL = 100;
const DPI_WARN = 150;
/**
 * Resolution needed at final size. Big prints are seen from further away, so they need fewer
 * dots per inch (and browsers can't draw them at 300 DPI anyway). Same tiers as the editor.
 */
function dpiLimits(longSideIn) {
  if (longSideIn > 48) return { fail: 40, warn: 60 }; // roll-ups, tablecloths, banners
  if (longSideIn > 24) return { fail: 72, warn: 110 }; // A1 signs, big canvases, prayer mats
  return { fail: DPI_FAIL, warn: DPI_WARN };
}
const ASPECT_TOLERANCE = 0.015;
const ALPHA_EMPTY = 8; // alpha <= this everywhere: nothing prints
const ALPHA_VISIBLE = 24; // alpha > this: visible artwork
const ALPHA_SOLID = 230; // alpha >= this: prints as solid
const SEMI_WARN_PERCENT = 3;
const ANALYSIS_MAX = 1500; // long side of the sampled alpha grid
const MIN_STRAY_PX = 3; // ignore fewer near-cut pixels than this (stray antialiasing)
const MAX_PIXELS = 130e6; // app.js refuses > 120 MP at upload
const MM_PER_IN = 25.4;
const GARMENT = ['dtf', 'dtg'];

const round1 = (n) => Math.round(n * 10) / 10;

function statusOf(checks) {
  if (checks.some((c) => c.level === 'fail')) return 'fail';
  if (checks.some((c) => c.level === 'warn')) return 'warn';
  return 'pass';
}

/** Width/height from the PNG header, or null when it is not a PNG. */
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

/** Full-resolution alpha channel (1 byte per pixel). */
async function readAlpha(buf) {
  const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error('unexpected channel count');
  return { data, width: info.width, height: info.height };
}

/**
 * Nearest-neighbour sample of the alpha channel on a grid of at most
 * ANALYSIS_MAX px on the long side. Nearest (not averaging) keeps the real
 * alpha values, so antialiased edges do not turn into fake soft areas.
 */
function sampleAlpha({ data, width, height }) {
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(width, height));
  if (scale === 1) return { a: data, w: width, h: height };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const a = new Uint8Array(w * h);
  const xs = new Uint32Array(w);
  for (let x = 0; x < w; x++) xs[x] = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
  for (let y = 0; y < h; y++) {
    const row = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h)) * width;
    const o = y * w;
    for (let x = 0; x < w; x++) a[o + x] = data[row + xs[x]];
  }
  return { a, w, h };
}

function maxAlpha(data) {
  let m = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > m) {
      m = data[i];
      if (m === 255) break;
    }
  }
  return m;
}

/**
 * Share of visible pixels that are half transparent (24 < alpha < 230) inside
 * a soft area: the pixel and its 4 neighbours on the sampled grid are all
 * half transparent. One-pixel antialiased edges of crisp shapes do not count.
 */
function semiPercent({ a, w, h }) {
  let visible = 0;
  let soft = 0;
  const semi = (v) => v > ALPHA_VISIBLE && v < ALPHA_SOLID;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = a[i];
      if (v <= ALPHA_VISIBLE) continue;
      visible++;
      if (v >= ALPHA_SOLID) continue;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && semi(a[i - 1]) && semi(a[i + 1]) && semi(a[i - w]) && semi(a[i + w])) soft++;
    }
  }
  return visible ? (soft / visible) * 100 : 0;
}

/** Does visible artwork touch the outer edge of the file (within tol px)? Needs a few pixels, not one stray dot. */
function touchesEdge({ a, w, h }, tol = 1) {
  let n = 0;
  for (let y = 0; y < h; y++) {
    const edgeRow = y < tol || y >= h - tol;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= tol && x < w - tol) {
        x = w - tol - 1; // skip the inside of the row
        continue;
      }
      if (a[y * w + x] > ALPHA_VISIBLE && ++n >= MIN_STRAY_PX) return true;
    }
  }
  return false;
}

/**
 * Paper-type rule: visible artwork outside the safe area that is NOT part of a
 * shape reaching the outer (bleed) edge, e.g. text or a logo too close to the
 * cut. Shapes connected to the outer edge (full backgrounds, edge-to-edge
 * stripes) are deliberate bleed and are fine. Returns the smallest distance
 * from the trim in mm, or null.
 */
function nearCutMm({ a, w, h }, { physW, physH, bleedIn, safeIn }) {
  const pxPerInX = w / physW;
  const pxPerInY = h / physH;
  const bleedX = bleedIn * pxPerInX;
  const bleedY = bleedIn * pxPerInY;
  const safeX = (bleedIn + safeIn) * pxPerInX;
  const safeY = (bleedIn + safeIn) * pxPerInY;
  // Artwork that reaches at least half way into the bleed counts as "reaching the edge".
  const tolX = Math.max(1, Math.floor(bleedX * 0.5));
  const tolY = Math.max(1, Math.floor(bleedY * 0.5));
  // Flood fill from visible pixels at the outer edge.
  const reached = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i) => {
    if (!reached[i] && a[i] > ALPHA_VISIBLE) {
      reached[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let y = 0; y < h; y++) {
    const edgeRow = y < tolY || y >= h - tolY;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < tolX || x >= w - tolX) seed(y * w + x);
      else x = w - tolX - 1;
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  let count = 0;
  let minPxIn = Infinity; // distance to the trim, in inches
  for (let y = 0; y < h; y++) {
    const inSafeY = y >= safeY && y < h - safeY;
    for (let x = 0; x < w; x++) {
      if (inSafeY && x >= safeX && x < w - safeX) {
        x = Math.ceil(w - safeX) - 1; // skip the safe area
        continue;
      }
      const i = y * w + x;
      if (a[i] <= ALPHA_VISIBLE || reached[i]) continue;
      count++;
      const dx = Math.min(x - bleedX, w - 1 - x - bleedX) / pxPerInX;
      const dy = Math.min(y - bleedY, h - 1 - y - bleedY) / pxPerInY;
      const d = Math.max(0, Math.min(dx, dy));
      if (d < minPxIn) minPxIn = d;
    }
  }
  if (count < MIN_STRAY_PX) return null;
  return round1(minPxIn * MM_PER_IN);
}

async function checkSide(design, side, { readFile, product }) {
  const checks = [];
  const add = (id, level, params = {}) => checks.push({ id, level, side: side.id, params });
  const bleed = Number(side.bleedIn) || 0;
  const physW = Number(side.widthIn) + 2 * bleed;
  const physH = Number(side.heightIn) + 2 * bleed;

  let buf;
  try {
    buf = await readFile(`${side.id}-print.png`);
  } catch (e) {
    add('exportSize', 'fail', { error: 'missing' });
    return checks;
  }
  const size = pngSize(buf);
  if (!size) {
    add('exportSize', 'fail', { error: 'notPng' });
    return checks;
  }
  if (!(physW > 0) || !(physH > 0)) {
    add('exportSize', 'fail', { error: 'noPhysicalSize' });
    return checks;
  }

  // 2. Pixel size vs the recorded size and the physical shape.
  const expectedW = Number(side.widthPx) || size.width;
  const expectedH = Number(side.heightPx) || Math.round((expectedW * physH) / physW);
  const aspectOff = Math.abs(size.width / size.height / (physW / physH) - 1);
  if (size.width !== expectedW || size.height !== expectedH || aspectOff > ASPECT_TOLERANCE) {
    add('exportSize', 'fail', {
      widthPx: size.width,
      heightPx: size.height,
      expectedW,
      // The height the physical shape needs (the recorded height comes from the uploaded file itself).
      expectedH: aspectOff > ASPECT_TOLERANCE ? Math.round((expectedW * physH) / physW) : expectedH,
    });
  }

  // 1. Effective resolution at the physical size (bleed included).
  const dpi = Math.round(Math.min(size.width / physW, size.height / physH));
  const lim = dpiLimits(Math.max(physW, physH));
  if (dpi < lim.fail) add('resolution', 'fail', { dpi, minDpi: lim.fail });
  else if (dpi < lim.warn) add('resolution', 'warn', { dpi, minDpi: lim.warn });

  let alpha;
  try {
    alpha = await readAlpha(buf);
  } catch (e) {
    add('exportSize', 'fail', { error: 'unreadable' });
    return checks;
  }

  // 3. Nothing to print.
  if (maxAlpha(alpha.data) <= ALPHA_EMPTY) {
    add('empty', 'fail', {});
    return checks;
  }

  const grid = sampleAlpha(alpha);
  alpha = null; // let the full-size buffer go
  // Embroidered chest with a printed back: only the stitched side skips the print checks.
  const embSide = design.embSide || (design.sides && design.sides[0] && design.sides[0].id);
  const embroidery = side.process ? side.process === 'embroidery' : (design.method === 'embroidery' || design.process === 'embroidery') && side.id === embSide;
  const methods = (product && Array.isArray(product.methods) ? product.methods : [product && product.process]).filter(Boolean);
  const garment = !embroidery && methods.some((m) => GARMENT.includes(m));
  const productSide = product && Array.isArray(product.sides) ? product.sides.find((s) => s.id === side.id) : null;
  const safeIn = Number(productSide && productSide.safeIn) || 0;

  // 4. Artwork too close to the cut / cut off at the edge.
  if (!embroidery && !design.pattern) {
    if (garment) {
      if (touchesEdge(grid)) add('outsideSafe', 'warn', { mm: 0 });
    } else if (safeIn > 0) {
      const mm = nearCutMm(grid, { physW, physH, bleedIn: bleed, safeIn });
      if (mm != null) add('outsideSafe', 'warn', { mm });
    }
  }

  // 5. Soft shadows, glows, half-transparent pictures on film/garment prints.
  if (garment) {
    const percent = semiPercent(grid);
    if (percent > SEMI_WARN_PERCENT) add('semiTransparent', 'warn', { percent: round1(percent) });
  }
  return checks;
}

// ---------- Booklets: pages with nothing on them ----------
/** "2–4, 6, 8–9" from sorted page numbers. */
function pageRanges(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}\u2013${nums[j]}` : String(nums[i]));
    i = j;
  }
  return parts.join(', ');
}

/**
 * 7. A booklet prints every page its size has (front cover = page 1, back cover = the last page). The editor sends
 * only the pages with something on them, and the others print as blank paper: a warning, not a problem (a blank
 * page can be on purpose). QA tester 1, 26 Nov: an 8-page booklet with only its cover said "Ready to print".
 * Params: pages ("2–8", in reading order), count (how many), total (pages printed).
 */
function blankPages(design, product) {
  if (!product || !product.paged || !Array.isArray(product.sides) || !product.sides.length || !Array.isArray(product.sizes)) return null;
  const order = pageSides(product, design.size && design.size.id);
  const designed = new Set((design.sides || []).map((sd) => sd && sd.id));
  const blank = [];
  order.forEach((sd, i) => {
    if (!designed.has(sd.id)) blank.push(i + 1);
  });
  if (!blank.length || blank.length === order.length) return null; // (no pages at all is the `empty` failure)
  return { id: 'blankPages', level: 'warn', params: { pages: pageRanges(blank), count: blank.length, total: order.length } };
}

// ---------- Arabic text in a font without Arabic letters ----------
/*
 * The editor's English fonts (public/js/templates.js FONTS.english) have no Arabic letters: public/fonts/fonts.css
 * has only their Latin files. Arabic typed in one is drawn by the browser in some other font, so the print is not
 * the font the customer picked, and the SVG print file names a font that can't draw it. Each one with the Arabic
 * font of the same feel the editor uses for it (templates.js ARABIC_FOR; test/qa-tester1-2603.test.js keeps the
 * two lists the same).
 */
const ARABIC_FOR = {
  'Dancing Script': 'Aref Ruqaa', Pacifico: 'Aref Ruqaa', Lobster: 'Aref Ruqaa', Caveat: 'Aref Ruqaa',
  'Playfair Display': 'El Messiri', 'Abril Fatface': 'El Messiri', 'Roboto Slab': 'El Messiri',
  Anton: 'Lalezar', Bungee: 'Lalezar', 'Bebas Neue': 'Lalezar', Oswald: 'Lalezar', Righteous: 'Lalezar', 'Permanent Marker': 'Lalezar',
  Montserrat: 'Cairo',
  'Great Vibes': 'Aref Ruqaa', Cookie: 'Aref Ruqaa', Yesteryear: 'Aref Ruqaa', Kalam: 'Marhey',
  'Irish Grover': 'Lemonada', Julee: 'Marhey', Chewy: 'Lemonada', 'Lilita One': 'Lalezar', Caprasimo: 'Lalezar',
  'League Gothic': 'Lalezar', 'Six Caps': 'Lalezar', Ultra: 'Lalezar', Smokum: 'Rakkas',
};
// Arabic letters and digits (not the Arabic comma, question mark or direction marks alone, nor U+FEFF).
const ARABIC_LETTER_RE = /[\u0620-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;
const MAX_FONT_CHECKS = 10;
const familyOf = (f) => (typeof f === 'string' ? f.split(',')[0].replace(/["']/g, '').trim() : '');
/** A text as the layers list names it: spaces joined, cut by whole characters with "…". */
function textName(s) {
  const all = Array.from(String(s).replace(/\s+/g, ' ').trim());
  return all.length > 28 ? `${all.slice(0, 27).join('')}\u2026` : all.join('');
}

/**
 * 8. Texts with Arabic letters in a font that has none, from the editor's layout (editor.json), per printed side.
 * Sides the shop replaced with its own file are not drawn from these texts any more. Params: name (the text),
 * font, suggest (an Arabic font of the same feel).
 */
async function arabicFontChecks(design, readFile) {
  if (typeof readFile !== 'function') return [];
  let editor;
  try {
    editor = JSON.parse(String(await readFile('editor.json')));
  } catch (e) {
    return []; // no layout kept (uploaded files, older designs): nothing to check
  }
  if (!editor || typeof editor !== 'object') return [];
  const out = [];
  const replaced = design.replaced || {};
  const walk = (objs, sideId, depth) => {
    if (!Array.isArray(objs) || depth > 20) return;
    for (const o of objs) {
      if (out.length >= MAX_FONT_CHECKS) return;
      if (!o || typeof o !== 'object' || o.visible === false) continue;
      if (Array.isArray(o.objects)) walk(o.objects, sideId, depth + 1);
      if (typeof o.text !== 'string' || !/text/i.test(String(o.type || ''))) continue;
      const font = familyOf(o.fontFamily);
      if (!Object.prototype.hasOwnProperty.call(ARABIC_FOR, font) || !ARABIC_LETTER_RE.test(o.text)) continue;
      const params = { name: textName(o.text), font, suggest: ARABIC_FOR[font] };
      if (!out.some((c) => c.side === sideId && c.params.name === params.name && c.params.font === font)) out.push({ id: 'fontNoArabic', level: 'warn', side: sideId, params });
    }
  };
  for (const side of Array.isArray(design.sides) ? design.sides : []) {
    if (!side || replaced[side.id] || !Object.prototype.hasOwnProperty.call(editor, side.id)) continue;
    const ed = editor[side.id];
    walk(ed && ed.objects, side.id, 0);
  }
  return out;
}

/**
 * Checks every printed side of a saved design. Never throws for bad or
 * missing files: those come back as a failed `exportSize` check.
 */
async function preflight(design, { readFile, product } = {}) {
  if (!design || typeof design !== 'object') {
    const checks = [{ id: 'exportSize', level: 'fail', params: { error: 'noDesign' } }];
    return { status: 'fail', checks };
  }
  // Gang sheets and books have their own checks (per item / per page).
  if (design.kind === 'gangsheet' || design.kind === 'book') {
    return { status: 'pass', checks: [{ id: 'skipped', level: 'info', params: { kind: design.kind } }] };
  }
  const checks = [];
  const sides = Array.isArray(design.sides) ? design.sides : [];
  if (!sides.length) checks.push({ id: 'empty', level: 'fail', params: {} });
  for (const side of sides) {
    try {
      checks.push(...(await checkSide(design, side, { readFile, product })));
    } catch (e) {
      checks.push({ id: 'exportSize', level: 'fail', side: side && side.id, params: { error: 'unreadable' } });
    }
  }
  // 6. fileType: the design does not record converted PDF/AI/EPS artwork (the
  // editor converts it through /api/artwork without marking the object), so
  // it can only arrive from the editor via mergeClientChecks.
  // 7. Booklet pages left blank, 8. Arabic in a font without Arabic letters (warnings: neither stops the order).
  try {
    const blank = blankPages(design, product);
    if (blank) checks.push(blank);
    checks.push(...(await arabicFontChecks(design, readFile)));
  } catch (e) {
    // (Only warnings: a layout that can't be read never fails the print files' own checks.)
  }
  return { status: statusOf(checks), checks };
}

// ---------- Checks reported by the editor ----------
const CLIENT_IDS = new Set(['fontFallback', 'lowResImage', 'tinyText', 'outsideSafe', 'fileType', 'hiddenText', 'inkOnColour', 'fieldText', 'sampleText', 'cutPieces', 'cutPhoto', 'cutEdge', 'embSmallText', 'embColors', 'embPhoto', 'embGradient']);
const LEVELS = new Set(['info', 'warn', 'fail']);
const MAX_CLIENT_CHECKS = 50;
const MAX_STR = 100;
const MAX_PARAMS = 8;
const MAX_LIST = 10;
const SIDE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

function cleanValue(v) {
  if (typeof v === 'string') return v.length <= MAX_STR ? v : undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  return undefined;
}

function cleanParams(params) {
  if (params == null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) return null;
  const keys = Object.keys(params);
  if (keys.length > MAX_PARAMS) return null;
  const out = {};
  for (const k of keys) {
    if (!KEY_RE.test(k)) return null;
    const v = params[k];
    if (Array.isArray(v)) {
      // e.g. fontFallback { fonts: ['Cairo', ...] }
      if (v.length > MAX_LIST) return null;
      const list = v.map(cleanValue);
      if (list.some((x) => x === undefined)) return null;
      out[k] = list;
    } else {
      const c = cleanValue(v);
      if (c === undefined) return null;
      out[k] = c;
    }
  }
  return out;
}

/**
 * Adds the editor's own checks to a server result. Unknown ids, bad levels and
 * checks with oversized or non-primitive params are dropped; at most 50 are
 * kept. `fileType` is always info. Returns a new result with the status recomputed.
 */
function mergeClientChecks(serverResult, clientChecks) {
  const base = serverResult && Array.isArray(serverResult.checks) ? serverResult.checks.slice() : [];
  const seen = new Set(base.map((c) => JSON.stringify([c.id, c.side || null, c.params || {}])));
  const added = [];
  for (const c of Array.isArray(clientChecks) ? clientChecks : []) {
    if (added.length >= MAX_CLIENT_CHECKS) break;
    if (!c || typeof c !== 'object' || !CLIENT_IDS.has(c.id)) continue;
    let level = c.level == null ? 'warn' : c.level;
    if (!LEVELS.has(level)) continue;
    if (c.id === 'fileType') level = 'info';
    if (c.side != null && (typeof c.side !== 'string' || !SIDE_RE.test(c.side))) continue;
    const params = cleanParams(c.params);
    if (!params) continue;
    const check = { id: c.id, level, ...(c.side != null ? { side: c.side } : {}), params };
    const key = JSON.stringify([check.id, check.side || null, params]);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(check);
  }
  const checks = [...base, ...added];
  return { ...(serverResult || {}), status: statusOf(checks), checks };
}

module.exports = {
  preflight,
  dpiLimits,
  mergeClientChecks,
  statusOf,
  ARABIC_FOR,
  THRESHOLDS: { DPI_FAIL, DPI_WARN, ASPECT_TOLERANCE, ALPHA_EMPTY, ALPHA_VISIBLE, ALPHA_SOLID, SEMI_WARN_PERCENT },
};
