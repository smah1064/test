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

function runWorker(data, kind, px, timeoutMs, pages = null, job = null) {
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
        runWorker(data, kind, px, timeoutMs, pages, job).then(resolve, reject);
        return;
      }
      finish(reject, fail('failed', `converter stopped (code ${code}, ${signal || 'no signal'}): ${stderr.trim().slice(-400)}`));
    });
    child.send(job ? { job } : { data, kind, px, pages });
  });
}

/**
 * EPS has no transparency, so Illustrator often saves the artboard as a white
 * rectangle behind the design. When the picture's edges are (almost) all
 * opaque white, the white connected to the edges becomes transparent; white
 * shapes inside the design (white letters on a dark badge) stay. Soft edges
 * keep a little transparency so the outline stays smooth. Returns a new PNG,
 * or null when there is no white background.
 */
async function clearWhiteBackground(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // White, at any opacity (the page's edge rows are drawn half-transparent).
  const isWhite = (i) => data[i * 4] > 245 && data[i * 4 + 1] > 245 && data[i * 4 + 2] > 245;
  // Only when the frame of the picture is white (not when the design itself touches the edge).
  let edge = 0;
  let white = 0;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { edge++; if (isWhite(y * W + x)) white++; }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { edge++; if (isWhite(y * W + x)) white++; }
  if (white / edge < 0.9) return null;
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
  return sharp(data, { raw: info }).png().toBuffer();
}

/**
 * Converts an AI/EPS file to a trimmed, transparent PNG whose longest side is
 * at most `px` pixels. Returns { png, width, height }.
 */
async function convertArtwork(buf, { px = 4000, timeoutMs = 25000 } = {}) {
  const found = sniff(buf);
  if (!found) throw new ArtworkError('type');
  if (running >= MAX_JOBS) throw new ArtworkError('busy');
  running++;
  let out;
  try {
    out = await runWorker(found.data, found.kind, px, timeoutMs);
  } finally {
    running--;
  }
  if (!out.png || !out.png.length) {
    const err = new ArtworkError('failed');
    err.detail = out.log;
    throw err;
  }
  /** The picture cut to the box around its non-transparent pixels. */
  async function cropToOpaque(buf) {
    const { data, info } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    let top = h;
    let bottom = -1;
    let left = w;
    let right = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (data[row + x] > 0) {
          if (y < top) top = y;
          bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (bottom < 0) throw new Error('empty');
    const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const out = await sharp(buf).ensureAlpha().extract(box).png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
    return out;
  }
  // Cut away the empty margin around the artwork.
  let png = Buffer.from(out.png.buffer, out.png.byteOffset, out.png.byteLength);
  // The page area first (Ghostscript leaves an empty margin around it), then its white artboard.
  try {
    const page = await sharp(png).trim({ threshold: 1 }).png().toBuffer();
    png = (await clearWhiteBackground(page)) || page;
  } catch (e) {
    throw new ArtworkError('empty'); // nothing visible was drawn
  }
  // Then only the transparent margin left by clearing the artboard: a trim by colour would take the
  // artwork's own solid background (e.g. a red logo panel) for margin and cut it away.
  let trimmed;
  try {
    trimmed = await cropToOpaque(png);
  } catch (e) {
    throw new ArtworkError('empty'); // nothing visible was drawn
  }
  const stats = await sharp(trimmed.data).stats();
  if (stats.channels[3] && stats.channels[3].max === 0) throw new ArtworkError('empty');
  return { png: trimmed.data, width: trimmed.info.width, height: trimmed.info.height };
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
/pbox { dup (PAGE ) print =only ( ) print pdfgetpage dup /CropBox pget { exch pop } { /MediaBox pget pop } ifelse (BOX ) print == } def
(COUNT ) print pdfpagecount ==
1 1 pdfpagecount ${max} .min { pbox } for
pdfpagecount ${max} gt { pdfpagecount pbox } if
`;
  const out = await gsJob({ inputs: { 'in.pdf': buf }, ps, device: 'nullpage' }, timeoutMs);
  const count = Number((/COUNT (\d+)/.exec(out.log) || [])[1]);
  // boxes[i]: page i + 1 (null for the pages in between that weren't asked for).
  const found = [...out.log.matchAll(/PAGE (\d+) BOX \[([-\d.\s]+)\]/g)].map((m) => {
    const [x0, y0, x1, y1] = m[2].trim().split(/\s+/).map(Number);
    return { page: Number(m[1]) - 1, box: { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } };
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
      s += `gsave ${n2(entry.box.x)} ${n2(entry.box.y)} translate ${n2(sx)} ${n2(sy)} scale ${n2(-entry.src.x)} ${n2(-entry.src.y)} translate SRC${k} ${entry.page} .PDFDrawPage grestore\n`;
      if (entry.overlay != null) s += `gsave PARTS ${entry.overlay} .PDFDrawPage grestore\n`;
    } else if (entry.part != null) {
      s += `gsave PARTS ${entry.part} .PDFDrawPage grestore\n`;
    }
    return `${s}grestore\n`;
  };
  const boxes = `[ {ThisPage} << /TrimBox [${n2(b)} ${n2(b)} ${n2(W - b)} ${n2(H - b)}] /BleedBox [0 0 ${n2(W)} ${n2(H)}] >> /PUT pdfmark\n`;
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
