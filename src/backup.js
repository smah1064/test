'use strict';

/**
 * Backups of the shop's data folder: orders, customers, coupons, the team and approvals (db.json), customers'
 * designs and print files, product photos and uploaded designs, shares, the activity log. One compressed archive
 * (.tar.gz: any size, opens with 7-Zip, macOS, Windows 11 and every Linux) is made in the background, so a big
 * folder never meets the host's time limit for a request, and kept in DATA_DIR/backups/ until downloaded.
 *
 * Left out on purpose:
 * - backups/ itself (a backup never holds older backups);
 * - .session-secret: the key that signs sign-ins and download links. A backup that went astray can't be used to
 *   sign in as anyone; restoring one only signs everyone out once (and links sent to printing houses are sent again);
 * - .signin-limits.json and half-written files (*.lock, *.tmp, *.part): they mean nothing in another copy;
 * - models/: the background-removal model (178 MB, src/bgremove.js), downloaded again on first need when missing.
 * - img-sized/: smaller copies of the shop's photos (src/app.js, /img-w/), made again when asked for.
 * The site's code is on GitHub, and its passwords and keys are in the host's settings, not in this folder.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const NAME_RE = /^ebda3-backup-\d{8}-\d{4}(?:-\d{1,3})?\.tar\.gz$/;
const SKIP_TOP = new Set(['backups', '.session-secret', '.signin-limits.json', 'models', 'img-sized']);
const SKIP_NAME = /(?:\.lock|\.tmp|\.part)$|^\.session-secret\./;
const KEEP_DAYS = 3; // a finished backup waits this long on the server to be downloaded
const KEEP_COUNT = 2; // and only the newest two are kept (each is as big as the shop's files)
// The backup being made is written here, then renamed to its own name. One name for every start, created only when
// it isn't there ('wx'): two copies of the app on one folder pressing at the same moment (even across a minute,
// when their backups' names differ) can't both write it; the second one is told a backup is being made.
const PART = 'ebda3-backup-making.tar.gz.part';

/** Every file to back up, with its size: [{ abs, rel, size, mtime }] (relative paths with "/"). */
function listFiles(dataDir) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (!rel && SKIP_TOP.has(e.name)) continue;
      if (SKIP_NAME.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(abs);
          out.push({ abs, rel: r, size: st.size, mtime: st.mtime });
        } catch (err) { /* gone meanwhile */ }
      }
      // (Links and anything else are left out: the folder holds plain files only.)
    }
  };
  walk(dataDir, '');
  return out;
}

// ---------- tar (POSIX ustar, with GNU long names) ----------
const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}\0`;
function header(name, size, mtime, type = '0') {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  if (size < 0o77777777777) h.write(octal(size, 12), 124, 'ascii');
  else { // over 8 GB: the size in binary (GNU / POSIX base-256)
    h[124] = 0x80;
    let v = BigInt(size);
    for (let i = 135; i > 124; i--) { h[i] = Number(v & 0xffn); v >>= 8n; }
  }
  h.write(octal(Math.max(0, Math.floor(mtime / 1000)), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii'); // the checksum counts as spaces while it is summed
  h.write(type, 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  h.write('ebda3', 265, 'ascii');
  h.write('ebda3', 297, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512, 0);
/** The headers of one file: a GNU long-name entry first when its path is over 100 bytes. */
function headersFor(rel, size, mtime) {
  const bytes = Buffer.byteLength(rel, 'utf8');
  if (bytes < 100) return [header(rel, size, mtime)];
  const long = Buffer.from(`${rel}\0`, 'utf8');
  const short = Buffer.from(rel, 'utf8').subarray(0, 99).toString('utf8').replace(/�+$/, '');
  return [header('././@LongLink', long.length, 0, 'L'), long, pad(long.length), header(short, size, mtime)];
}

/** The archive as a stream of bytes; `onBytes(n)` as each file's bytes go by. */
function tarStream(files, onBytes) {
  async function* gen() {
    for (const f of files) {
      // (The size in the header is the one read when listing: a file that grew since is cut there, one that
      // shrank is filled with zeros, so the archive stays whole; the shop's own data file is saved in one
      // step, so it is never caught half-written.)
      for (const b of headersFor(f.rel, f.size, f.mtime.getTime())) yield b;
      let sent = 0;
      if (f.size > 0) {
        try {
          for await (const chunk of fs.createReadStream(f.abs, { start: 0, end: f.size - 1, highWaterMark: 1 << 20 })) {
            sent += chunk.length;
            onBytes(chunk.length);
            yield chunk;
          }
        } catch (e) { /* removed meanwhile: zeros below */ }
      }
      if (sent < f.size) {
        onBytes(f.size - sent);
        let left = f.size - sent;
        while (left > 0) { const n = Math.min(left, 1 << 20); left -= n; yield Buffer.alloc(n, 0); }
      }
      yield pad(f.size);
    }
    yield Buffer.alloc(1024, 0); // the end of the archive
  }
  return Readable.from(gen(), { objectMode: false });
}

/** Free space where the backups are kept, in bytes (null when the system can't say). */
function freeSpace(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch (e) {
    return null;
  }
}

const cairoStamp = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
};

class Backups {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dir = path.join(dataDir, 'backups');
    this.job = null; // the backup being made here: { name, startedAt, done, total, files }
    this.lastError = null; // { code, at } of the last one that failed
  }

  /** Finished backups, newest first, and the one being made. Old ones (and half-made leftovers) go first. */
  list() {
    this.tidy();
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (e) { /* none yet */ }
    const backups = names.filter((n) => NAME_RE.test(n)).map((name) => {
      const st = fs.statSync(path.join(this.dir, name));
      return { name, at: st.mtime.toISOString(), bytes: st.size };
    }).sort((a, b) => b.at.localeCompare(a.at));
    const making = this.job ? { name: this.job.name, startedAt: this.job.startedAt, done: this.job.done, total: this.job.total, files: this.job.files }
      : names.some((n) => n.endsWith('.part') && this.recent(n)) ? { elsewhere: true } : null;
    return { backups, making, error: this.lastError };
  }

  recent(name) {
    try { return Date.now() - fs.statSync(path.join(this.dir, name)).mtimeMs < 2 * 60e3; } catch (e) { return false; }
  }

  /** Removes backups past KEEP_DAYS (or beyond the newest KEEP_COUNT) and half-made files nobody is writing. */
  tidy() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (e) { return; }
    const done = names.filter((n) => NAME_RE.test(n)).map((n) => ({ n, t: fs.statSync(path.join(this.dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    done.forEach((x, i) => {
      if (i >= KEEP_COUNT || Date.now() - x.t > KEEP_DAYS * 864e5) fs.rmSync(path.join(this.dir, x.n), { force: true });
    });
    for (const n of names.filter((x) => x.endsWith('.part'))) {
      if (this.job && n === PART) continue;
      if (!this.recent(n)) fs.rmSync(path.join(this.dir, n), { force: true });
    }
  }

  /** The path of a finished backup, or null. */
  fileOf(name) {
    if (!NAME_RE.test(String(name || ''))) return null;
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? file : null;
  }

  remove(name) {
    const file = this.fileOf(name);
    if (!file) return false;
    fs.rmSync(file, { force: true });
    return true;
  }

  /**
   * Starts making a backup; resolves when it is finished (the caller needn't wait). Throws { code } at once:
   * 'backupBusy' while one is being made, 'backupNoSpace' when the server hasn't room for it.
   */
  start() {
    if (this.job || this.list().making) throw Object.assign(new Error('backupBusy'), { code: 'backupBusy' });
    fs.mkdirSync(this.dir, { recursive: true });
    const files = listFiles(this.dataDir);
    const total = files.reduce((n, f) => n + f.size, 0);
    // (Pictures hardly shrink: room for the whole folder again, and 200 MB to spare for the shop's own work.)
    const free = freeSpace(this.dir);
    if (free !== null && free < total + 200 * 1024 * 1024) throw Object.assign(new Error('backupNoSpace'), { code: 'backupNoSpace', need: total, free });
    let name = `ebda3-backup-${cairoStamp(new Date())}.tar.gz`;
    for (let i = 2; fs.existsSync(path.join(this.dir, name)); i++) name = name.replace(/(?:-\d{1,3})?\.tar\.gz$/, `-${i}.tar.gz`);
    const part = path.join(this.dir, PART);
    let fd;
    try {
      fd = fs.openSync(part, 'wx', 0o600);
    } catch (e) {
      // Another copy of the app started one a moment ago (after our look above): it carries on, nothing failed here.
      if (e.code === 'EEXIST') throw Object.assign(new Error('backupBusy'), { code: 'backupBusy' });
      throw e;
    }
    const job = { name, startedAt: new Date().toISOString(), done: 0, total, files: files.length };
    this.job = job;
    this.lastError = null;
    const touch = setInterval(() => { try { const now = new Date(); fs.utimesSync(part, now, now); } catch (e) { /* not yet */ } }, 30e3);
    if (touch.unref) touch.unref();
    const finished = pipeline(tarStream(files, (n) => { job.done += n; }), zlib.createGzip({ level: 4 }), fs.createWriteStream(part, { fd }))
      .then(() => {
        fs.renameSync(part, path.join(this.dir, name));
        this.tidy();
        return { name, bytes: fs.statSync(path.join(this.dir, name)).size, files: files.length };
      })
      .catch((e) => {
        fs.rmSync(part, { force: true });
        this.lastError = { code: e && e.code === 'ENOSPC' ? 'backupNoSpace' : 'backupFailed', at: new Date().toISOString() };
        console.warn('[backup] failed:', e && e.message);
        throw e;
      })
      .finally(() => {
        clearInterval(touch);
        if (this.job === job) this.job = null;
      });
    finished.catch(() => { /* said in list() */ });
    return { job, finished };
  }

  // ---------- Download links (the browser saves the file itself: no size limit in the page) ----------
  static linkFor(key, name, ttlMs = 6 * 3600e3) {
    const exp = Date.now() + ttlMs;
    const sig = crypto.createHmac('sha256', key).update(`backup:${name}:${exp}`).digest('base64url');
    return `/dl/backup/${encodeURIComponent(name)}?e=${exp}&s=${sig}`;
  }

  static linkOk(key, name, exp, sig) {
    const e = Number(exp);
    if (!Number.isFinite(e) || e < Date.now() || typeof sig !== 'string') return false;
    const want = crypto.createHmac('sha256', key).update(`backup:${name}:${e}`).digest();
    let got;
    try { got = Buffer.from(sig, 'base64url'); } catch (err) { return false; }
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
}

module.exports = { Backups, listFiles, tarStream, NAME_RE };
