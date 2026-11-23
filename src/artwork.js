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
 * Ghostscript (WebAssembly) does the drawing in a worker thread that is
 * stopped after `timeoutMs`; only `MAX_JOBS` run at once.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const sharp = require('sharp');

const MAX_JOBS = 2;
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

function runWorker(data, kind, px, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'artwork-worker.mjs'), {
      workerData: { data, kind, px },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new ArtworkError('timeout')), timeoutMs);
    worker.once('message', (m) => finish(resolve, m));
    worker.once('error', (e) => finish(reject, Object.assign(new ArtworkError('failed'), { detail: e.message })));
    worker.once('exit', () => finish(reject, new ArtworkError('failed')));
  });
}

/**
 * Converts an AI/EPS file to a trimmed, transparent PNG whose longest side is
 * at most `px` pixels. Returns { png, width, height }.
 */
async function convertArtwork(buf, { px = 4000, timeoutMs = 45000 } = {}) {
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
  // Cut away the empty margin around the artwork.
  const png = Buffer.from(out.png.buffer, out.png.byteOffset, out.png.byteLength);
  let trimmed;
  try {
    trimmed = await sharp(png).trim({ threshold: 1 }).png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
  } catch (e) {
    throw new ArtworkError('empty'); // nothing visible was drawn
  }
  const stats = await sharp(trimmed.data).stats();
  if (stats.channels[3] && stats.channels[3].max === 0) throw new ArtworkError('empty');
  return { png: trimmed.data, width: trimmed.info.width, height: trimmed.info.height };
}

module.exports = { convertArtwork, sniff, ArtworkError };
