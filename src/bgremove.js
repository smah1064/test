'use strict';

/**
 * AI background removal for customers' photos (people, pets, products on
 * busy backgrounds). Uses ISNet ("general use", Apache-2.0, the model the
 * free rembg tool uses) with the ONNX runtime, on the shop's server.
 *
 *  - The model (178 MB) is too big for the repository: it is downloaded once
 *    into DATA_DIR/models on first need, checked against its SHA-256, and
 *    kept. Only one copy of the app downloads it (lock file).
 *  - Each photo is done in a separate short-lived process (bgremove-worker.js):
 *    ~1.5-3 s and ~650 MB, then that memory is given back. One at a time; a
 *    few more wait their turn. A process that takes too long is stopped.
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const MODEL_URL = process.env.BG_MODEL_URL || 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MODEL_SHA256 = process.env.BG_MODEL_SHA256 || '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a';
const MAX_WAITING = 3;
const TIMEOUT_MS = 90e3;

class BgError extends Error {
  constructor(reason, detail) {
    super(reason);
    this.reason = reason; // 'off' | 'busy' | 'loading' | 'failed' | 'bad'
    this.detail = detail;
  }
}

function available() {
  try {
    require.resolve('onnxruntime-node');
    return process.env.BG_REMOVAL !== 'off';
  } catch (e) {
    return false;
  }
}

// ---------- The model file ----------
let downloading = null;
function modelPath(dataDir) {
  return process.env.BG_MODEL_PATH || path.join(dataDir, 'models', 'isnet-general-use.onnx');
}
async function sha256File(file) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject));
  return h.digest('hex');
}
/** Resolves with the model's path once it is on disk (downloading it if needed). */
function ensureModel(dataDir) {
  const file = modelPath(dataDir);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (process.env.BG_MODEL_PATH) return Promise.reject(new BgError('off', `BG_MODEL_PATH ${file} not found`));
  downloading ||= (async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lock = `${file}.lock`;
    let mine = false;
    try {
      // A lock left by a copy that died while downloading is taken over after 15 minutes.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 15 * 60e3) fs.rmSync(lock, { force: true }); } catch (e) { /* no lock */ }
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      mine = true;
    } catch (e) {
      mine = false;
    }
    if (!mine) {
      // Another copy of the app is downloading it: wait for the file.
      for (let i = 0; i < 300 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 2000));
      if (!fs.existsSync(file)) throw new BgError('loading', 'waited for another copy to download the model');
      return file;
    }
    const tmp = `${file}.${process.pid}.part`;
    try {
      console.log('[bg] downloading the background-removal model (178 MB) …');
      const res = await fetch(MODEL_URL, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60e3) });
      if (!res.ok || !res.body) throw new BgError('failed', `model download: HTTP ${res.status}`);
      const out = fs.createWriteStream(tmp);
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      await pipeline(Readable.fromWeb(res.body), out);
      const sum = await sha256File(tmp);
      if (sum !== MODEL_SHA256) throw new BgError('failed', `model checksum ${sum} does not match`);
      fs.renameSync(tmp, file);
      console.log('[bg] model ready');
      return file;
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(lock, { force: true });
    }
  })().finally(() => { downloading = null; });
  return downloading;
}

// ---------- One photo at a time ----------
let running = 0;
let waiting = 0;
const queue = [];
function slot() {
  if (running === 0) {
    running = 1;
    return Promise.resolve();
  }
  if (waiting >= MAX_WAITING) return Promise.reject(new BgError('busy'));
  waiting++;
  return new Promise((resolve) => queue.push(() => { waiting--; resolve(); }));
}
function release() {
  const next = queue.shift();
  if (next) next();
  else running = 0;
}

function runWorker(model, image) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'bgremove-worker.js'), [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new BgError('failed', 'took too long')), TIMEOUT_MS);
    child.once('message', (m) => (m && m.png ? finish(resolve, Buffer.from(m.png.buffer, m.png.byteOffset, m.png.byteLength)) : finish(reject, new BgError(m && m.bad ? 'bad' : 'failed', m && m.error))));
    child.once('error', (e) => finish(reject, new BgError('failed', e.message)));
    child.once('exit', (code, signal) => finish(reject, new BgError('failed', `worker stopped (${code}, ${signal || '-'}): ${stderr.trim().slice(-300)}`)));
    child.send({ model, image });
  });
}

/** The photo with its background made transparent, as a PNG (longest side at most `maxPx`). */
async function removeBackground(image, { dataDir, maxPx = 3000 } = {}) {
  if (!available()) throw new BgError('off');
  let model;
  try {
    model = await ensureModel(dataDir);
  } catch (e) {
    throw e instanceof BgError ? e : new BgError('loading', e.message);
  }
  await slot();
  try {
    return await runWorker(model, { data: image, maxPx });
  } finally {
    release();
  }
}

/** Start downloading the model in the background so the first customer doesn't wait. */
function prepare(dataDir) {
  if (!available()) return;
  ensureModel(dataDir).catch((e) => console.warn('[bg] model not ready:', e.detail || e.message));
}

module.exports = { removeBackground, prepare, available, BgError };
