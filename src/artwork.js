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

function runWorker(data, kind, px, timeoutMs, pages = null) {
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
        runWorker(data, kind, px, timeoutMs, pages).then(resolve, reject);
        return;
      }
      finish(reject, fail('failed', `converter stopped (code ${code}, ${signal || 'no signal'}): ${stderr.trim().slice(-400)}`));
    });
    child.send({ data, kind, px, pages });
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

/**
 * Every page of a PDF as a JPEG page for a booklet: each fitted into a w x h px page on white
 * (up to `max` pages; `more` says the PDF has more). Returns { pages: [Buffer], more }.
 */
async function pdfPages(buf, { w, h, max = 32, timeoutMs = 90000 } = {}) {
  const found = sniff(buf);
  if (!found || found.kind !== 'pdf') throw new ArtworkError('type');
  if (running >= MAX_JOBS) throw new ArtworkError('busy');
  running++;
  let out;
  try {
    out = await runWorker(found.data, 'pdf', 0, timeoutMs, { w, h, max: max + 1 });
  } finally {
    running--;
  }
  const list = (out.pngs || []).map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength));
  if (!list.length) {
    const err = new ArtworkError('failed');
    err.detail = out.log;
    throw err;
  }
  const pages = [];
  for (const png of list.slice(0, max)) pages.push(await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
  return { pages, more: list.length > max };
}

module.exports = { convertArtwork, pdfPages, sniff, ArtworkError };
