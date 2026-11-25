'use strict';

/**
 * Turns Adobe Illustrator (.ai) and EPS files into a transparent PNG the
 * design editor can use like any other picture.
 *
 *  - .ai files saved with "PDF compatible" (Illustrator's default since CS)
 *    are PDFs inside; older ones are PostScript, like EPS.
 *  - .eps files are PostScript; "DOS EPS" files wrap the PostScript in a
 *    small binary header, which is unwrapped here.
 *
 * Ghostscript (WebAssembly) does the drawing in a separate small process that
 * is stopped after `timeoutMs` or if it uses too much memory; only `MAX_JOBS`
 * run at once.
 */
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const sharp = require('sharp');

const MAX_JOBS = 2; // two at once: one slow (or looping) PostScript file doesn't block everyone else
// Ghostscript's WebAssembly memory isn't capped by worker limits: watch the process and stop a job that grows too big.
const MAX_EXTRA_MB = Number(process.env.ARTWORK_MAX_MB) || 700;
let running = 0;

class ArtworkError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // 'type' | 'busy' | 'timeout' | 'empty' | 'failed'
  }
}

/** What kind of file this is, from its first bytes: 'pdf', 'ps' or null. */
function sniff(buf) {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (/^\s*%PDF-/.test(head) || head.includes('%PDF-')) return { kind: 'pdf', data: buf };
  if (/^\s*%!/.test(head)) return { kind: 'ps', data: buf };
  // DOS EPS binary header: C5 D0 D3 C6, then offset and length of the PostScript.
  if (buf.length > 30 && buf.readUInt32BE(0) === 0xc5d0d3c6) {
    const start = buf.readUInt32LE(4);
    const len = buf.readUInt32LE(8);
    if (start >= 30 && len > 0 && start + len <= buf.length) {
      const data = buf.subarray(start, start + len);
      if (/^\s*%!/.test(data.subarray(0, 64).toString('latin1'))) return { kind: 'ps', data };
    }
  }
  return null;
}

// Node flags for the converter process: no 10 GB WebAssembly memory reservation
// (shared hosting limits virtual memory), a small JavaScript heap.
let FLAGS = ['--disable-wasm-trap-handler', '--max-old-space-size=192'];
const memMb = (pid) => {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) / 1024 : 0;
  } catch (e) {
    return 0;
  }
};

// (opts: { probe } or { region } for convertArtwork's steps, see the worker.)
function runWorker(data, kind, px, timeoutMs, pages = null, job = null, opts = null) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'artwork-worker.mjs'), [], {
      execArgv: FLAGS,
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn(v);
    };
    const fail = (reason, detail) => Object.assign(new ArtworkError(reason), { detail });
    const timer = setTimeout(() => finish(reject, fail('timeout', `no answer after ${timeoutMs} ms`)), timeoutMs);
    const watch = setInterval(() => {
      const mb = memMb(child.pid);
      if (mb > MAX_EXTRA_MB) finish(reject, fail('failed', `used ${Math.round(mb)} MB`));
    }, 150);
    child.once('message', (m) => finish(resolve, m));
    child.once('error', (e) => finish(reject, fail('failed', e.message)));
    child.once('exit', (code, signal) => {
      // An older Node that doesn't know a flag: try again without it.
      if (!done && /bad option/i.test(stderr) && FLAGS.length) {
        FLAGS = FLAGS.filter((f) => !stderr.includes(f));
        done = true;
        clearTimeout(timer);
        clearInterval(watch);
        runWorker(data, kind, px, timeoutMs, pages, job, opts).then(resolve, reject);
        return;
      }
      finish(reject, fail('failed', `converter stopped (code ${code}, ${signal || 'no signal'}): ${stderr.trim().slice(-400)}`));
    });
    child.send(job ? { job } : { data, kind, px, pages, ...opts });
  });
}

/** A PNG's RGBA pixels: { data, width, height }. */
async function pixelsOf(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
/** A part ({ left, top, width, height }) of RGBA pixels, as a copy. */
function cropPixels(pic, b) {
  const data = Buffer.allocUnsafe(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++) {
    const from = ((b.top + y) * pic.width + b.left) * 4;
    pic.data.copy(data, y * b.width * 4, from, from + b.width * 4);
  }
  return { data, width: b.width, height: b.height };
}

/**
 * EPS has no transparency, so Illustrator often saves the artboard as a white
 * rectangle behind the design. When the picture's edges are (almost) all
 * painted white, the white connected to the edges becomes transparent; white
 * shapes inside the design (white letters on a dark badge) stay. Soft edges
 * keep a little transparency so the outline stays smooth. Changes the RGBA
 * pixels in place; returns false when there is no white background. `force`:
 * the white background was already found on another drawing of the same
 * artwork (a closer one, whose edges may be the design's own): clear it
 * without looking at the edges again.
 *
 * Only painted pixels count as white. Ghostscript keeps the pixels where nothing
 * was drawn as white with no opacity (255, 255, 255, 0): counted as white, every
 * logo on a transparent page looked like one on a white page, and the clearing
 * ran from that empty margin into the logo's own white wherever it touches the
 * outline (POD-1014: the white stripe of a club crest, reached through the white
 * rim that is open at the top of the shield, came out transparent and printed as
 * the black of the hoodie).
 */
function clearWhiteBackground({ data, width: W, height: H }, { force = false } = {}) {
  // Painted white, at any opacity above none (the page's edge rows are drawn half-transparent).
  const isWhite = (i) => data[i * 4 + 3] > 0 && data[i * 4] > 245 && data[i * 4 + 1] > 245 && data[i * 4 + 2] > 245;
  // Only when the frame of the picture is white (not when the design itself touches the edge).
  let edge = 0;
  let white = 0;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { edge++; if (isWhite(y * W + x)) white++; }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { edge++; if (isWhite(y * W + x)) white++; }
  if (!force && white / edge < 0.9) return false;
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  const push = (i) => { if (!seen[i] && isWhite(i)) { seen[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const i = stack[--top];
    data[i * 4 + 3] = 0;
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < W * (H - 1)) push(i + W);
  }
  // Anti-aliased rim next to the removed white: fade it by how white it is.
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || data[i * 4 + 3] === 0) continue;
    const x = i % W;
    const nearCleared = (x > 0 && seen[i - 1]) || (x < W - 1 && seen[i + 1]) || (i >= W && seen[i - W]) || (i < W * (H - 1) && seen[i + W]);
    if (!nearCleared) continue;
    const lightness = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (lightness > 180) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * (255 - lightness) / 75);
  }
  return true;
}

/** The box around the RGBA pixels that aren't fully transparent ({ left, top, width, height }), or null. */
function opaqueBox({ data, width: w, height: h }) {
  let top = h;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > 0) {
        if (y < top) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return bottom < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The artwork cut out of a drawing (a PNG): the empty margin around it first, then its white artboard
 * (see clearWhiteBackground; `clear`: null = look at the edges, true / false = as found on another
 * drawing of the same artwork), then only the transparent margin that leaves (a trim by colour
 * would take the artwork's own solid background, e.g. a red logo panel, for margin and cut it away).
 * Returns { pic: its RGBA pixels, box: where it is in the drawing, cleared }.
 */
async function cutOut(png, clear = null) {
  const drawn = await pixelsOf(png);
  const page = opaqueBox(drawn);
  if (!page) throw new ArtworkError('empty'); // nothing visible was drawn
  const pic = cropPixels(drawn, page);
  const cleared = clear !== false && clearWhiteBackground(pic, { force: clear === true });
  const art = opaqueBox(pic);
  if (!art) throw new ArtworkError('empty');
  return { pic: cropPixels(pic, art), box: { left: page.left + art.left, top: page.top + art.top, width: art.width, height: art.height }, cleared };
}

// The finest a drawing is made (a 6 mm logo still gets 3000 pixels), and the most pixels a whole page may span
// at that density: Ghostscript slows down with it (a big shape drawn at a huge size, even if only a corner is kept;
// an A0 page still gets about 10000 DPI).
const MAX_DPI = 12000;
const MAX_PAGE_PX = 5e5;

/** A probe's box ("%%HiResBoundingBox: x0 y0 x1 y1", page points): the biggest one printed, or null when nothing was drawn. */
function probeBox(log) {
  let best = null;
  for (const m of String(log || '').matchAll(/%%HiResBoundingBox:\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    const [x0, y0, x1, y1] = m.slice(1, 5).map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0 && y1 > y0)) continue;
    if (!best || (x1 - x0) * (y1 - y0) > (best.x1 - best.x0) * (best.y1 - best.y0)) best = { x0, y0, x1, y1 };
  }
  return best;
}
const boxArea = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const boxSide = (b) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
const overlap = (a, b) => boxArea({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/**
 * The most pixels per point a picture (photo) of a PDF has when it fills `box`: its own width x height over
 * the box (0 when unknown, as for pictures inside PostScript). A picture's dictionary is never compressed.
 */
function pictureDensity(text, box) {
  let most = 0;
  for (const m of text.matchAll(/\/Subtype\s*\/Image\b/g)) {
    const from = text.lastIndexOf('obj', m.index);
    const to = text.indexOf('stream', m.index);
    if (from < 0 || to < 0 || m.index - from > 4000 || to - m.index > 4000) continue;
    const dict = text.slice(from, to);
    const w = /\/Width\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    const h = /\/Height\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    if (w && h) most = Math.max(most, Number(w[1]) * Number(h[1]));
  }
  return most && boxArea(box) > 0 ? Math.sqrt(most / boxArea(box)) : 0;
}

/**
 * Converts an AI/EPS/PDF file to a trimmed, transparent PNG whose longest side is
 * at most `px` pixels. Returns { png, width, height }.
 *
 * The artwork itself gets the `px` pixels, not its page: a 7 cm logo on an empty A4 page is drawn as
 * finely as a page-sized one. Steps (each a Ghostscript run in the separate process, stopped after `timeoutMs`
 * like the single drawing before; all of them within twice that):
 *  1. the box around everything drawn on the page, and the page's size (no picture: quick); when the file
 *     has photos in it, the box around those too;
 *  2. that box drawn with its longer side at `px` and cut out as always (margin, white artboard);
 *  3. when what's left is smaller (a logo on a white page or artboard), only that part drawn again,
 *     finer (the box it is drawn in, with a margin, stays within about px), until its longer side is `px`.
 * A drawing that is mostly a photo is not enlarged beyond the photo's own pixels (nor made smaller than the
 * whole page fitted into `px`, as before): enlarged it gains no detail, only a resolution the editor would trust.
 * If the first step gets no answer, the whole page is fitted into px x px as before; if a finer drawing
 * fails or time runs short, the coarser one is kept.
 */
async function convertArtwork(buf, { px = 4000, timeoutMs = 25000 } = {}) {
  const found = sniff(buf);
  if (!found) throw new ArtworkError('type');
  if (running >= MAX_JOBS) throw new ArtworkError('busy');
  running++;
  try {
    return await drawArtwork(found, px, timeoutMs);
  } finally {
    running--;
  }
}

/** RGBA pixels as a PNG, made smaller by `scale` when it is below 1. Returns { png, width, height }. */
async function encode({ data, width, height }, scale = 1) {
  let img = sharp(data, { raw: { width, height, channels: 4 } });
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (scale < 1 && (w < width || h < height)) img = img.resize(w, h, { fit: 'fill' });
  const out = await img.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
  return { png: out.data, width: out.info.width, height: out.info.height };
}

async function drawArtwork({ data, kind }, px, timeoutMs) {
  const deadline = Date.now() + 2 * timeoutMs;
  const run = (opts) => {
    const ms = Math.min(timeoutMs, deadline - Date.now());
    if (ms < 250) return Promise.reject(Object.assign(new ArtworkError('timeout'), { detail: 'no time left' }));
    return runWorker(data, kind, px, ms, null, null, opts);
  };
  const failed = (out) => Object.assign(new ArtworkError('failed'), { detail: out.log });
  const pngOf = (out) => Buffer.from(out.png.buffer, out.png.byteOffset, out.png.byteLength);
  // The scale that keeps a picture within px and to `scale` (a few pixels off that aim: not worth a softer picture).
  const fit = (pic, scale = 1) => {
    const side = Math.max(pic.width, pic.height);
    const s = Math.min(1, scale, px / side);
    return side <= px && side * (1 - s) < 4 ? 1 : s;
  };
  const probe = await run({ probe: 'all' });
  const size = /PAGESIZE \[(\S+) (\S+)\]/.exec(probe.log || '');
  const page = size && [Number(size[1]), Number(size[2])];
  if (!page || !(page[0] > 0 && page[1] > 0)) {
    // No answer from the probe: the whole page fitted into px x px, as before.
    const out = await run(null);
    if (!out.png || !out.png.length) throw failed(out);
    const { pic } = await cutOut(pngOf(out));
    return encode(pic, fit(pic));
  }
  const marks = probeBox(probe.log);
  if (!marks) throw new ArtworkError('empty');
  const far = Math.max(page[0], page[1], ...[marks.x0, marks.y0, marks.x1, marks.y1].map(Math.abs));
  const finest = Math.min(MAX_DPI / 72, MAX_PAGE_PX / far);
  /** `box` (page points, with a margin) drawn at about d pixels per point and cut out; `at`: the artwork's box in page points. */
  const shot = async (box, d, clear, margin) => {
    const res = Math.round(72 * d * 1000) / 1000;
    const k = res / 72;
    const m = margin == null ? 4 / k : margin;
    const x = Math.round((box.x0 - m) * 1000) / 1000;
    const y = Math.round((box.y0 - m) * 1000) / 1000;
    const W = Math.max(1, Math.ceil((box.x1 + m - x) * k));
    const H = Math.max(1, Math.ceil((box.y1 + m - y) * k));
    if (W * H > (px + 100) ** 2) throw Object.assign(new ArtworkError('failed'), { detail: `region ${W}x${H}` }); // (never: a safety net)
    const out = await run({ region: { x, y, W, H, res } });
    if (!out.png || !out.png.length) throw failed(out);
    const cut = await cutOut(pngOf(out), clear);
    const b = cut.box;
    return { ...cut, d: k, at: { x0: x + b.left / k, x1: x + (b.left + b.width) / k, y0: y + (H - b.top - b.height) / k, y1: y + (H - b.top) / k } };
  };
  // Photos in it (a PDF names them; PostScript draws them with these operators): where they are drawn.
  const text = data.toString('latin1');
  let photos = null;
  if (kind === 'pdf' ? /\/Subtype\s*\/Image\b/.test(text) : /\b(?:image|colorimage|imagemask)\b/.test(text)) {
    try {
      photos = probeBox((await run({ probe: 'images' })).log);
    } catch (e) {
      photos = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity }; // not known: as if all photo (the size it had before)
    }
  }
  // A drawing that is mostly photo: no finer than the photo's own pixels, nor coarser than the whole page fitted into px.
  const own = photos && kind === 'pdf' ? pictureDensity(text, photos) : 0;
  const most = (box) => (photos && overlap(photos, box) >= 0.5 * boxArea(box) ? Math.max(px / Math.max(page[0], page[1]), own) : Infinity);
  // The density that gives a box's longer side px pixels (px - 2: the soft edge adds up to a pixel each side,
  // and a picture made smaller to fit would lose a little sharpness).
  const aim = (box) => Math.min(finest, (px - 2) / boxSide(box), most(box));
  let best = await shot(marks, aim(marks), null);
  const clear = best.cleared;
  let want = aim(best.at);
  try {
    for (let i = 0; i < 4 && want > best.d * 1.02; i++) {
      // The margin covers where the last, coarser drawing could have been wrong by a pixel or two; the whole
      // box drawn (artwork and margin) stays within about px.
      const d = Math.min(want, (px + 50) / (boxSide(best.at) + 4 / best.d));
      if (d <= best.d * 1.02) break;
      const next = await shot(best.at, d, clear, Math.max(4 / d, 2 / best.d));
      // The same artwork, give or take a pixel or two of the coarser drawing (else keep the one we have).
      const was = boxSide(best.at);
      const slack = 3 / best.d;
      const now = boxSide(next.at);
      if (!(now > 0.8 * was - slack && now < 1.25 * was + slack)) break;
      best = next;
      want = aim(best.at); // (measured more closely now)
    }
  } catch (e) {
    // Out of time or a finer drawing failed: the one we have is still good.
  }
  return encode(best.pic, fit(best.pic, want / best.d));
}

/** A Ghostscript job in the separate process, one at a time with the others (see runJob in the worker). */
async function gsJob(job, timeoutMs) {
  if (running >= MAX_JOBS) throw new ArtworkError('busy');
  running++;
  try {
    return await runWorker(null, null, 0, timeoutMs, null, job);
  } finally {
    running--;
  }
}

/** The size of each page of a PDF in points (its crop box, else its media box): [{ w, h, x, y }]. */
async function pdfInfo(buf, { max = 40, timeoutMs = 30000 } = {}) {
  // The first `max` pages, and the last one when the PDF is longer (a booklet's back cover).
  const ps = `(in.pdf) (r) file runpdfbegin
/pbox { dup (PAGE ) print =only ( ) print pdfgetpage dup /Rotate pget { (ROT ) print =only ( ) print } if dup /CropBox pget { exch pop } { /MediaBox pget pop } ifelse (BOX ) print == } def
(COUNT ) print pdfpagecount ==
1 1 pdfpagecount ${max} .min { pbox } for
pdfpagecount ${max} gt { pdfpagecount pbox } if
`;
  const out = await gsJob({ inputs: { 'in.pdf': buf }, ps, device: 'nullpage' }, timeoutMs);
  const count = Number((/COUNT (\d+)/.exec(out.log) || [])[1]);
  // boxes[i]: page i + 1 (null for the pages in between that weren't asked for).
  // (A page turned by /Rotate says so: its print falls back to the picture, which is drawn turned.)
  const found = [...out.log.matchAll(/PAGE (\d+) (?:ROT (-?\d+) )?BOX \[([-\d.\s]+)\]/g)].map((m) => {
    const [x0, y0, x1, y1] = m[3].trim().split(/\s+/).map(Number);
    const rotate = ((Number(m[2]) || 0) % 360 + 360) % 360;
    return { page: Number(m[1]) - 1, box: { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), ...(rotate ? { rotate } : {}) } };
  });
  if (!count || !found.length || found.some((f) => !(f.box.w > 0 && f.box.h > 0) || !(f.page >= 0 && f.page < count))) {
    const err = new ArtworkError('failed');
    err.detail = out.log.slice(-600);
    throw err;
  }
  const boxes = Array.from({ length: Math.max(...found.map((f) => f.page)) + 1 }, () => null);
  for (const f of found) boxes[f.page] = f.box;
  return { count, boxes };
}

/**
 * Every page of a PDF as a JPEG for the editor (each page its own shape, about 200 DPI),
 * up to `max` pages (a longer PDF: the first max - 1 and the last one). The pictures are only for
 * the screen: the print files use the PDF itself.
 * Returns { pages: [Buffer], pageNums: [PDF page index of each], boxes: [{ w, h, x, y } | null by
 * PDF page index], count, more }.
 */
async function pdfPages(buf, { max = 32, maxPx = 2400, timeoutMs = 90000 } = {}) {
  const found = sniff(buf);
  if (!found || found.kind !== 'pdf') throw new ArtworkError('type');
  const info = await pdfInfo(found.data, { max });
  // A PDF longer than `max`: its first max - 1 pages and its last one (a booklet's back cover).
  const long = info.count > max && max >= 2;
  const nums = long ? [...Array(max - 1).keys(), info.count - 1] : [...Array(Math.min(max, info.count)).keys()];
  const shown = info.boxes.filter(Boolean);
  const biggest = Math.max(...shown.map((b) => Math.max(b.w, b.h))) / 72;
  const dpi = Math.max(36, Math.min(200, Math.floor(maxPx / biggest)));
  const out = await gsJob({
    inputs: { 'in.pdf': found.data },
    device: 'png16m',
    dpi,
    args: ['-dUseCropBox', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-dMaxBitmap=200000000',
      ...(long ? [`-sPageList=1-${max - 1},${info.count}`] : ['-dFirstPage=1', `-dLastPage=${nums.length}`]), 'in.pdf'],
  }, timeoutMs);
  const list = (out.pngs || []).map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength));
  if (!list.length) {
    const err = new ArtworkError('failed');
    err.detail = out.log.slice(-600);
    throw err;
  }
  const pages = [];
  for (const png of list) pages.push(await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
  // pageNums[i]: which page of the PDF pages[i] is (0 = the first).
  return { pages, pageNums: nums.slice(0, pages.length), boxes: info.boxes, count: info.count, more: info.count > max };
}

const psString = (s) => `(${String(s).replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, (c) => `\\${c}`)})`;
const n2 = (v) => (Math.round(v * 1000) / 1000).toString();
/**
 * A booklet print PDF made from the customer's own PDF pages (kept as they are: text and
 * drawings stay sharp), with anything added on top of a page and the other pages from `parts`
 * (one page each, trim + bleed). pages[i]: null (blank), { part } or { pdf, page, box, src, overlay }
 * with box in points from the page's bottom-left corner (bleed included) and src the PDF page's box.
 * `sources`: { pdfId: Buffer }. Imposed: two pages per sheet side for saddle stitching.
 */
async function bookletFromPdf({ sources, parts, pages, spec, imposed = false, rtl = false, title = '' }, timeoutMs = 180000) {
  const pt = 72;
  const trimW = spec.widthIn * pt;
  const trimH = spec.heightIn * pt;
  const b = (spec.bleedIn || 0) * pt;
  const PW = trimW + 2 * b;
  const H = trimH + 2 * b;
  const list = pages.slice();
  while (list.length % 4) list.splice(list.length - 1, 0, null);
  const N = list.length;
  const ids = Object.keys(sources);
  const inputs = {};
  let ps = '';
  ids.forEach((id, k) => {
    inputs[`src${k}.pdf`] = sources[id];
    ps += `(src${k}.pdf) (r) file runpdfbegin /SRC${k} PDFFile def\n`;
  });
  if (parts) {
    inputs['parts.pdf'] = parts;
    ps += '(parts.pdf) (r) file runpdfbegin /PARTS PDFFile def\n';
  }
  ps += `[ /Title ${psString(title)} /Creator (ebda3) /DOCINFO pdfmark\n`;
  const W = imposed ? 2 * trimW + 2 * b : PW;
  ps += `<< /PageSize [${n2(W)} ${n2(H)}] >> setpagedevice\n`;
  // One page with its bleed, its bottom-left corner at (ox, 0), clipped to [cx, cw].
  const draw = (entry, ox, cx, cw) => {
    if (!entry) return '';
    let s = `gsave ${n2(cx)} 0 ${n2(cw)} ${n2(H)} rectclip ${n2(ox)} 0 translate\n`;
    if (entry.pdf != null) {
      const k = ids.indexOf(entry.pdf);
      const sx = entry.box.w / entry.src.w;
      const sy = entry.box.h / entry.src.h;
      // (Only what the customer saw: clipped to the page's own box, its CropBox.)
      s += `gsave ${n2(entry.box.x)} ${n2(entry.box.y)} translate ${n2(sx)} ${n2(sy)} scale ${n2(-entry.src.x)} ${n2(-entry.src.y)} translate ${n2(entry.src.x)} ${n2(entry.src.y)} ${n2(entry.src.w)} ${n2(entry.src.h)} rectclip SRC${k} ${entry.page} .PDFDrawPage grestore\n`;
      if (entry.overlay != null) s += `gsave PARTS ${entry.overlay} .PDFDrawPage grestore\n`;
    } else if (entry.part != null) {
      s += `gsave PARTS ${entry.part} .PDFDrawPage grestore\n`;
    }
    return `${s}grestore\n`;
  };
  // Every box of the sheet set here (a source page's own CropBox / ArtBox must not carry over).
  const boxes = `[ {ThisPage} << /TrimBox [${n2(b)} ${n2(b)} ${n2(W - b)} ${n2(H - b)}] /BleedBox [0 0 ${n2(W)} ${n2(H)}] /CropBox [0 0 ${n2(W)} ${n2(H)}] /ArtBox [${n2(b)} ${n2(b)} ${n2(W - b)} ${n2(H - b)}] >> /PUT pdfmark\n`;
  if (!imposed) {
    for (const entry of list) ps += draw(entry, 0, 0, PW) + boxes + 'showpage\n';
  } else {
    for (let k = 0; k < N / 4; k++) {
      for (const [l, r] of [[N - 2 * k, 1 + 2 * k], [2 + 2 * k, N - 1 - 2 * k]]) {
        const [left, right] = rtl ? [r, l] : [l, r];
        // Each page keeps its bleed on the three outer edges; the fold edge is cut at the trim.
        ps += draw(list[left - 1], 0, 0, b + trimW);
        ps += draw(list[right - 1], trimW, b + trimW, b + trimW);
        if (b > 2) ps += `0.25 setlinewidth 0 setgray newpath ${n2(b + trimW)} 0 moveto 0 ${n2(b * 0.7)} rlineto stroke newpath ${n2(b + trimW)} ${n2(H)} moveto 0 ${n2(-b * 0.7)} rlineto stroke\n`;
        ps += boxes + 'showpage\n';
      }
    }
  }
  const out = await gsJob({
    inputs,
    ps,
    device: 'pdfwrite',
    // Nothing made smaller or re-compressed: the pages print as the customer sent them.
    args: ['-dCompatibilityLevel=1.6', '-dAutoRotatePages=/None', '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
      '-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dColorImageFilter=/FlateEncode', '-dGrayImageFilter=/FlateEncode', '-dPassThroughJPEGImages=true', '-dPassThroughJPXImages=true'],
  }, timeoutMs);
  if (!out.out || !out.out.length || out.code !== 0) {
    const err = new ArtworkError('failed');
    err.detail = out.log.slice(-800);
    throw err;
  }
  return Buffer.from(out.out.buffer, out.out.byteOffset, out.out.byteLength);
}

module.exports = { convertArtwork, pdfPages, pdfInfo, bookletFromPdf, sniff, ArtworkError };
