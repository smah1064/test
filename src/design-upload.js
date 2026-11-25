'use strict';

/**
 * "Upload designs (zip)" (Admin → Ready designs): the owner or a product manager
 * uploads a zip of design pictures. This reads the zip, looks at each picture
 * (size, transparency, colours) and suggests the products it suits; the routes
 * in src/app.js keep the batch and publish the designs.
 *
 * The zip and its pictures are untrusted, so:
 *  - nothing is written anywhere here: buffers in, buffers out. Names from the
 *    zip are only labels (cleaned of "..", drive letters, control characters)
 *    and are never joined to a file path;
 *  - the zip is limited in entries, per-file and total size, both by the sizes
 *    it declares and by what really comes out (inflating stops at the declared
 *    size, so a lying entry can't grow), entries may not share bytes (the
 *    "overlapping files" bomb), and encrypted entries, split archives and ZIP64
 *    are refused;
 *  - pictures are decoded by sharp with a pixel limit and a time limit and
 *    re-encoded (metadata stripped, sRGB), so only plain pixels come out. SVG
 *    is drawn into pixels from the file alone (no outside links): its text is
 *    never kept or served.
 * Anything malformed ends as an UploadError code (zip) or { ok: false, reason }
 * (one picture), never a crash.
 */
const fs = require('fs');
const zlib = require('zlib');

let sharpModule = null;
// Loaded on first use (as in src/app.js), so the server starts fast.
const sharp = () => (sharpModule ||= require('sharp'));

const MB = 2 ** 20;

/** A refused upload. `code` is an i18n key (zipBad, zipTooBig, zipTooMany…); `params` say more. */
class UploadError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'UploadError';
    this.code = code;
    this.params = params || {};
    this.status = code === 'zipTooBig' ? 413 : 400;
  }
}

// ---------- Reading the zip ----------

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const STORED = 0;
const DEFLATED = 8;
const AES = 99; // WinZip AES encryption
// Deflate can't squeeze more than ~1032:1. Pictures barely compress at all (they are
// compressed already), so a big entry near that ratio is a bomb, not a design.
const MAX_RATIO = 400;
const RATIO_FROM = 8 * MB;

const PICTURE_EXT = /\.(png|jpe?g|webp|svg)$/i;
const isPictureName = (path) => PICTURE_EXT.test(String(path || ''));

// Control characters and the bidi overrides that could disguise a name in the admin.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
// What macOS and Windows add to a zip, and hidden files: dropped without a word.
const JUNK_FILES = new Set(['thumbs.db', 'ehthumbs.db', 'desktop.ini']);

/**
 * A zip entry name as a clean relative label: "\" counts as a folder sign, "." and
 * "..", empty parts and a leading drive letter go, so "../../etc/x.png" is "etc/x.png".
 * `junk`: macOS / Windows leftovers and hidden files.
 */
function cleanPath(name) {
  const segments = [];
  let junk = false;
  for (const part of String(name).normalize('NFC').split(/[\\/]+/)) {
    if (/[\r\n]/.test(part)) junk = true; // macOS "Icon\r" files
    const s = part.replace(CONTROL, '').trim().slice(0, 120);
    if (!s || s === '.' || s === '..' || (!segments.length && /^[a-z]:$/i.test(s))) continue;
    if (s.startsWith('.') || s.toLowerCase() === '__macosx') junk = true;
    segments.push(s);
  }
  const file = (segments[segments.length - 1] || '').toLowerCase();
  if (JUNK_FILES.has(file) || file.startsWith('~$')) junk = true;
  return { path: segments.slice(-8).join('/'), junk };
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
/** The entry's name: UTF-8 when the zip says so or when it is valid UTF-8 (macOS doesn't say). */
function entryName(raw, flags, extra) {
  if (flags & FLAG_UTF8) return raw.toString('utf8');
  // Info-ZIP's Unicode path field (old Windows zippers): the UTF-8 name, if made for this raw name.
  for (let i = 0; i + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    if (i + 4 + size > extra.length) break;
    if (id === 0x7075 && size > 5 && extra[i + 4] === 1 && extra.readUInt32LE(i + 5) === zlib.crc32(raw)) {
      return extra.toString('utf8', i + 9, i + 4 + size);
    }
    i += 4 + size;
  }
  try {
    return strictUtf8.decode(raw);
  } catch {
    return raw.toString('latin1'); // an old DOS code page: shown as best we can
  }
}

/** The "end of central directory" record in `tail` (the file's last bytes): the last one whose comment fits. */
function findEnd(tail) {
  const stop = Math.max(0, tail.length - 22 - 0xffff);
  for (let i = tail.length - 22; i >= stop; i--) {
    if (tail[i] === 0x50 && tail.readUInt32LE(i) === SIG_END && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) return i;
  }
  return -1;
}

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Where a zip's bytes come from: an upload held in memory (a Buffer) or a file on disk (a path), read a
 * piece at a time, so a big zip never has to fit in memory.
 */
function zipSource(src) {
  if (Buffer.isBuffer(src)) {
    return {
      size: src.length,
      read: (at, len) => {
        if (at < 0 || at + len > src.length) throw new UploadError('zipBad');
        return src.subarray(at, at + len);
      },
      close() {},
    };
  }
  let fd;
  try {
    fd = fs.openSync(String(src), 'r');
  } catch {
    throw new UploadError('zipBad');
  }
  const size = fs.fstatSync(fd).size;
  return {
    size,
    read: (at, len) => {
      if (at < 0 || at + len > size) throw new UploadError('zipBad');
      const out = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const n = fs.readSync(fd, out, got, len - got, at + got);
        if (!n) throw new UploadError('zipBad');
        got += n;
      }
      return out;
    },
    close() {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    },
  };
}

/**
 * The files listed in a zip, checked but not unpacked: { entries: [{ path, method, crc, csize, usize,
 * start }] sorted by name, skipped: [{ path, reason }] }. Throws UploadError like readZip.
 */
function scanZip(z, { maxEntries = 300, maxTotal = 600 * MB, maxFile = 60 * MB } = {}) {
  if (z.size < 22) throw new UploadError('zipBad');
  const tailAt = Math.max(0, z.size - 22 - 0xffff);
  const tail = z.read(tailAt, z.size - tailAt);
  const endRel = findEnd(tail);
  if (endRel < 0) throw new UploadError('zipBad');
  const end = tailAt + endRel;
  const disk = tail.readUInt16LE(endRel + 4);
  const cdDisk = tail.readUInt16LE(endRel + 6);
  const onDisk = tail.readUInt16LE(endRel + 8);
  const count = tail.readUInt16LE(endRel + 10);
  const cdSize = tail.readUInt32LE(endRel + 12);
  const cdStart = tail.readUInt32LE(endRel + 16);
  // ZIP64 is for archives over 4 GB or 65,535 entries: far more than an upload may hold.
  const locator = end >= 20 ? (endRel >= 20 ? tail.readUInt32LE(endRel - 20) : z.read(end - 20, 4).readUInt32LE(0)) : 0;
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff || locator === SIG_ZIP64_LOCATOR) {
    throw new UploadError('zipBad', { reason: 'zip64' });
  }
  if (disk || cdDisk || onDisk !== count) throw new UploadError('zipBad', { reason: 'split' });
  if (cdStart + cdSize > end) throw new UploadError('zipBad');
  // macOS adds a "__MACOSX/._name" entry for every file and folders are entries too:
  // leave room for those, but never walk an endless directory.
  if (count > maxEntries * 5 + 100) throw new UploadError('zipTooMany', { max: maxEntries });

  const cd = z.read(cdStart, cdSize);
  const entries = [];
  const skipped = [];
  let declared = 0;
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdSize || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new UploadError('zipBad');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const next = p + 46 + nameLen + extraLen + cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    if (next > cdSize) throw new UploadError('zipBad');
    const name = entryName(cd.subarray(p + 46, p + 46 + nameLen), flags, cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
    p = next;
    if (/[\\/]$/.test(name)) continue; // a folder
    const { path, junk } = cleanPath(name);
    if (junk || !path) continue;
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw new UploadError('zipBad', { reason: 'zip64' });
    // A password-protected zip can't be read: the owner zips the pictures again without one.
    if (flags & FLAG_ENCRYPTED || method === AES) throw new UploadError('zipBad', { reason: 'encrypted' });
    if (entries.length + skipped.length >= maxEntries) throw new UploadError('zipTooMany', { max: maxEntries });
    if (method !== STORED && method !== DEFLATED) {
      skipped.push({ path, reason: isPictureName(path) ? 'badPicture' : 'notPicture' });
      continue;
    }
    if (usize > RATIO_FROM && usize / Math.max(csize, 1) > MAX_RATIO) throw new UploadError('zipTooBig', { reason: 'ratio' });
    if (usize > maxFile) {
      skipped.push({ path, reason: 'tooBig' });
      continue;
    }
    if (method === STORED && csize !== usize) throw new UploadError('zipBad');
    declared += usize;
    if (declared > maxTotal) throw new UploadError('zipTooBig', { max: maxTotal });
    entries.push({ path, method, crc, csize, usize, offset });
  }

  // Where each file's bytes are (after its local header), and no two files share bytes:
  // overlapping entries are how the worst zip bombs reuse one compressed block.
  let used = 0;
  for (const e of [...entries].sort((a, b) => a.offset - b.offset)) {
    if (e.offset < used || e.offset + 30 > cdStart) throw new UploadError('zipBad');
    const local = z.read(e.offset, 30);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new UploadError('zipBad');
    if (local.readUInt16LE(6) & FLAG_ENCRYPTED) throw new UploadError('zipBad', { reason: 'encrypted' });
    e.start = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    used = e.start + e.csize;
    if (used > cdStart) throw new UploadError('zipBad');
  }
  entries.sort((a, b) => byName.compare(a.path, b.path));
  return { entries, skipped };
}

/** One file's bytes, unpacked and checked (never more than the zip declared: a lying entry stops there). */
function unpack(z, e) {
  const packed = z.read(e.start, e.csize);
  let data;
  if (!e.usize) data = Buffer.alloc(0);
  else if (e.method === STORED) data = Buffer.from(packed); // a copy: never tied to the upload's buffer
  else {
    try {
      data = zlib.inflateRawSync(packed, { maxOutputLength: e.usize });
    } catch (err) {
      if (err && err.code === 'ERR_BUFFER_TOO_LARGE') throw new UploadError('zipTooBig', { reason: 'bomb', path: e.path });
      throw new UploadError('zipBad', { path: e.path });
    }
  }
  if (data.length !== e.usize || zlib.crc32(data) !== e.crc) throw new UploadError('zipBad', { path: e.path });
  return data;
}

/**
 * The files in a zip held in memory (folders and junk left out), sorted by name:
 * [{ path: 'mugs/cat.png', data: Buffer }]. The array also has `skipped`:
 * [{ path, reason }] for files that were not read ('tooBig' over maxFile,
 * 'badPicture' / 'notPicture' in a compression we don't read).
 * Throws UploadError: zipBad (not a zip, damaged, encrypted, split, ZIP64),
 * zipTooMany (more than maxEntries files), zipTooBig (more than maxTotal bytes
 * once unpacked, or a zip bomb).
 */
function readZip(buf, opts = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new UploadError('zipBad');
  const z = zipSource(buf);
  const { entries, skipped } = scanZip(z, opts);
  const files = entries.map((e) => ({ path: e.path, data: unpack(z, e) }));
  // (Not enumerable: the list still compares and serialises as a plain array of files.)
  Object.defineProperty(files, 'skipped', { value: skipped });
  return files;
}

/**
 * A zip saved on disk (a big upload), checked but not unpacked: { entries: [{ path, size, load() }],
 * skipped, close() }. load() unpacks one file when it's needed (and may throw UploadError zipBad for a
 * damaged one), so memory holds one picture at a time whatever the zip's size. Throws like readZip.
 */
function openZip(file, opts = {}) {
  const z = zipSource(file);
  try {
    const { entries, skipped } = scanZip(z, opts);
    return {
      entries: entries.map((e) => ({ path: e.path, size: e.usize, load: () => unpack(z, e) })),
      skipped,
      close: () => z.close(),
    };
  } catch (err) {
    z.close();
    throw err;
  }
}

// ---------- Looking at a picture ----------

const MAX_PIXELS = 100e6; // 10,000 × 10,000 px: an 85 cm square print at 300 DPI
const MIN_SIDE = 600; // a picture smaller than this (long side) prints nowhere well
const WEB_PX = 1200; // the light copy for the admin's previews and the shop's display
const SVG_PX = 4000; // SVG is drawn this big (long side) for printing
const MAX_SVG = 10 * MB;
const MAX_SVG_TAGS = 200000; // a detailed illustration has a few thousand; traced photos tens of thousands
const SAMPLE_PX = 256; // colours and transparency are read on a copy this small
const TIMEOUT = { seconds: 30 }; // no picture may keep sharp busy longer (a heavy SVG…)
const DECODE = { limitInputPixels: MAX_PIXELS, failOn: 'truncated' };
const FORMAT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const BAD = { ok: false, reason: 'badPicture' };

/** The end of a DOCTYPE starting at `start` (with an internal [ … ] part), or -1. */
function doctypeEnd(s, start) {
  const gt = s.indexOf('>', start);
  const br = s.indexOf('[', start);
  if (br >= 0 && (gt < 0 || br < gt)) {
    const close = /\]\s*>/g;
    close.lastIndex = br;
    const m = close.exec(s);
    return m ? m.index + m[0].length : -1;
  }
  return gt < 0 ? -1 : gt + 1;
}

/** An SVG file: text whose first element (after the XML declaration, comments, a DOCTYPE) is <svg>. */
function svgRoot(data) {
  let s = data.subarray(0, 64 * 1024).toString('utf8').replace(/^\uFEFF/, '');
  for (let k = 0; k < 50; k++) {
    s = s.trimStart();
    let e = -1;
    if (s.startsWith('<?')) e = s.indexOf('?>') + 2;
    else if (s.startsWith('<!--')) e = s.indexOf('-->') + 3;
    else if (/^<!DOCTYPE/i.test(s)) e = doctypeEnd(s, 0);
    else return /^<(svg:)?svg[\s>/]/.test(s);
    if (e < 3) return false;
    s = s.slice(e);
  }
  return false;
}

/** What the bytes are (by their first bytes, not the name): 'png', 'jpg', 'webp', 'svg' or null. */
function sniff(data) {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 16 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (svgRoot(data)) return 'svg';
  return null;
}

// Links an SVG may keep: in-file references and embedded raster pictures.
const SAFE_LINK = '(?:#|data:image\\/(?:png|jpe?g|webp|gif)[;,])';
const OUTSIDE_HREF = new RegExp(`(\\s(?:[\\w.-]+:)?href\\s*=\\s*["'])(?!\\s*${SAFE_LINK})`, 'gi');
const OUTSIDE_URL = new RegExp(`(url\\(\\s*["']?)(?!\\s*${SAFE_LINK})`, 'gi');

/**
 * The SVG's text made to draw from the file alone, or null when it can't be.
 * The simple entities a DOCTYPE declares (Illustrator names its namespaces so)
 * are written out, with a cap on the growth, and the DOCTYPE dropped; any other
 * declaration or XInclude is refused; links to anything but the file itself or
 * an embedded picture get a "#" in front (a reference to nothing), and CSS
 * imports are disabled. Every step is one linear pass (no quadratic regexes).
 */
function safeSvg(text) {
  let s = text.replace(/^\uFEFF/, '');
  const dt = /<!DOCTYPE\b/i.exec(s.slice(0, 64 * 1024));
  if (dt) {
    const end = doctypeEnd(s, dt.index);
    if (end < 0) return null;
    const entities = new Map();
    for (const m of s.slice(dt.index, end).matchAll(/<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"&%<]{0,2000})"|'([^'&%<]{0,2000})')\s*>/g)) {
      entities.set(m[1], (m[2] ?? m[3]).replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/>/g, '&gt;'));
    }
    s = s.slice(0, dt.index) + s.slice(end);
    if (entities.size) {
      let grown = 0;
      s = s.replace(/&([A-Za-z_][\w.-]*);/g, (m, n) => {
        const v = entities.get(n);
        if (v === undefined) return m;
        if ((grown += v.length) > 4 * MB) throw new UploadError('badPicture');
        return v;
      });
    }
  }
  if (/<!(DOCTYPE|ENTITY)/i.test(s) || /<([\w.-]+:)?include[\s/>]/.test(s)) return null;
  return s.replace(OUTSIDE_HREF, '$1#').replace(OUTSIDE_URL, '$1#').replace(/@import\b/gi, '@x-import');
}

/** A PNG / JPG / WEBP opened for reading: its size the right way up (EXIF orientation applied). */
async function openRaster(data, kind) {
  const meta = await sharp()(data, DECODE).metadata();
  if (FORMAT[meta.format] !== kind || !(meta.width > 0) || !(meta.height > 0)) return BAD;
  if (meta.width * meta.height > MAX_PIXELS) return { ok: false, reason: 'tooBig' };
  const turned = (meta.orientation || 1) >= 5;
  return { ok: true, w: turned ? meta.height : meta.width, h: turned ? meta.width : meta.height, open: () => sharp()(data, DECODE).autoOrient() };
}

/** An SVG drawn into pixels, SVG_PX on the long side (whatever size the file claims). */
async function rasterSvg(data) {
  if (data.length > MAX_SVG) return { ok: false, reason: 'tooBig' };
  const text = safeSvg(data.toString('utf8'));
  if (!text) return BAD;
  // Drawing time grows with the number of elements (~35 µs each): a file of
  // hundreds of thousands of tiny ones would keep a thread busy for half a minute.
  let tags = 0;
  for (let i = text.indexOf('<'); i >= 0 && tags <= MAX_SVG_TAGS; i = text.indexOf('<', i + 1)) tags++;
  if (tags > MAX_SVG_TAGS) return BAD;
  const svg = Buffer.from(text);
  // The size it declares (only read here, nothing drawn yet, so no pixel limit).
  const meta = await sharp()(svg, { limitInputPixels: false }).metadata();
  if (meta.format !== 'svg' || !(meta.width > 0) || !(meta.height > 0)) return BAD;
  const density = Math.min(100000, (72 * SVG_PX) / Math.max(meta.width, meta.height));
  // sharp draws at 1 DPI at the least: a file claiming to be kilometres wide is not a design.
  if (density < 1) return BAD;
  const { data: px, info } = await sharp()(svg, { limitInputPixels: MAX_PIXELS, density }).timeout(TIMEOUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  return { ok: true, w: info.width, h: info.height, open: () => sharp()(px, { raw }) };
}

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hexOf = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** The colour all round the edge, when (nearly) every edge pixel has it: artwork on a plain background. */
function plainBorder(px, sw, sh) {
  const t = Math.max(1, Math.round(Math.min(sw, sh) / 100));
  const ring = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) if (x < t || y < t || x >= sw - t || y >= sh - t) ring.push((y * sw + x) * 4);
  }
  const mean = [0, 1, 2].map((c) => ring.reduce((s, i) => s + px[i + c], 0) / ring.length);
  const same = ring.filter((i) => dist2([px[i], px[i + 1], px[i + 2]], mean) < 30 * 30).length;
  return same / ring.length >= 0.96 ? mean.map(Math.round) : null;
}

/**
 * Reads the small copy (RGBA): where the artwork is, whether it is a cut-out
 * (see-through around it), on a plain background, or a full picture; its main
 * colours and whether the ink is dark or light. All in one pass or two over ≤ 65k pixels.
 */
function inspect(px, sw, sh) {
  const n = sw * sh;
  let clear = 0;
  let minAlpha = 255;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 13) clear++;
    if (px[i] < minAlpha) minAlpha = px[i];
  }
  const alphaArt = clear / n >= 0.02; // see-through areas (round a cut-out, or just a margin)
  let bg = alphaArt ? null : plainBorder(px, sw, sh);
  const artTest = (mode) => (mode === 'alpha' ? (i) => px[i + 3] >= 16 : mode === 'bg' ? (i) => px[i + 3] >= 16 && dist2([px[i], px[i + 1], px[i + 2]], bg) > 40 * 40 : () => true);

  // The artwork's box, then everything measured inside it.
  const measure = (mode) => {
    const isArt = artTest(mode);
    let x0 = sw;
    let y0 = sh;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (!isArt((y * sw + x) * 4)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const bins = new Float64Array(4096 * 4); // weight, r, g, b per 4-bit colour cell
    let boxN = 0;
    let clearIn = 0;
    let solid = 0;
    let weight = 0;
    let lum = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * sw + x) * 4;
        const a = px[i + 3];
        boxN++;
        if (a < 13) clearIn++;
        if (!isArt(i)) continue;
        if (a >= 128) solid++;
        const wt = a / 255;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        const k = ((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)) * 4;
        bins[k] += wt;
        bins[k + 1] += r * wt;
        bins[k + 2] += g * wt;
        bins[k + 3] += b * wt;
        weight += wt;
        lum += luma(r, g, b) * wt;
      }
    }
    if (!weight) return null;
    return { box: { x0, y0, x1, y1 }, boxN, clearIn, solid, weight, lum: lum / weight, bins };
  };

  let mode = alphaArt ? 'alpha' : bg ? 'bg' : 'full';
  let m = measure(mode);
  // A plain frame round a full picture (a photo with a white margin) is part of the picture.
  if (m && mode === 'bg' && m.solid / m.boxN >= 0.85) {
    mode = 'full';
    bg = null;
    m = measure(mode);
  }
  if (!m) return null; // nothing to print (all see-through, or one plain colour)

  // Main colours: the 4-bit cells by weight, near ones merged.
  const cells = [];
  for (let k = 0; k < m.bins.length; k += 4) if (m.bins[k]) cells.push([m.bins[k], m.bins[k + 1] / m.bins[k], m.bins[k + 2] / m.bins[k], m.bins[k + 3] / m.bins[k]]);
  cells.sort((a, b) => b[0] - a[0]);
  const merged = [];
  for (const [wt, ...rgb] of cells) {
    const near = merged.find((c) => dist2(c.rgb, rgb) < 48 * 48);
    if (near) near.wt += wt;
    else if (merged.length < 24) merged.push({ wt, rgb });
  }
  merged.sort((a, b) => b.wt - a.wt);
  const share = (k) => merged.slice(0, k).reduce((s, c) => s + c.wt, 0) / m.weight;
  // A picture inside see-through margins is a full picture once trimmed.
  const transparent = mode === 'alpha' && m.clearIn / m.boxN >= 0.04;
  const artwork = transparent || mode === 'bg';
  const coverage = m.solid / m.boxN;
  return {
    // See-through margins are trimmed (they're invisible; the shop places the design itself).
    // A plain background stays: a coloured one is part of the design, a white one does no harm.
    box: mode === 'alpha' ? m.box : null,
    transparent,
    background: mode === 'bg' ? hexOf(bg) : null,
    coverage: Math.round(coverage * 1000) / 1000,
    colors: merged.filter((c) => c.wt / m.weight >= 0.03).slice(0, 5).map((c) => hexOf(c.rgb)),
    ink: m.lum >= 0.6 ? 'light' : 'dark',
    // One flat colour (a silhouette, line art): the only kind laser engraving takes.
    flat: artwork && share(1) >= 0.9,
    // Mostly one or two flat colours in thin shapes: lettering, line art.
    textLike: artwork && share(2) >= 0.9 && coverage < 0.45,
    // Anything see-through anywhere (the trimmed margin's edge included) keeps the alpha channel.
    seeThrough: minAlpha < 255,
  };
}

/**
 * Looks at one file from the zip. For a picture (PNG, JPG, WEBP, SVG):
 * { ok: true, kind, w, h, transparent, ink, coverage, colors, textLike, flat,
 *   background, web, print, printExt, printPx } where web is a PNG (≤ 1200 px,
 * transparency kept) and print the full-resolution file (PNG when anything is
 * see-through or for SVG, else PNG for PNG and JPG for JPG / WEBP). See-through
 * margins round a cut-out are trimmed (w, h, printPx are the trimmed size).
 * `background`: the plain colour round artwork on a plain background, else null.
 * Otherwise { ok: false, reason: 'notPicture' | 'badPicture' | 'tooSmall' | 'tooBig' }.
 */
async function analyze(data, path = '') {
  const named = isPictureName(path);
  if (!Buffer.isBuffer(data) || !data.length) return { ok: false, reason: named ? 'badPicture' : 'notPicture' };
  const kind = sniff(data);
  if (!kind) return { ok: false, reason: named ? 'badPicture' : 'notPicture' };
  try {
    const src = kind === 'svg' ? await rasterSvg(data) : await openRaster(data, kind);
    if (!src.ok) return src;
    if (Math.max(src.w, src.h) < MIN_SIDE) return { ok: false, reason: 'tooSmall', w: src.w, h: src.h };
    return await look(src, kind);
  } catch (e) {
    return { ok: false, reason: e instanceof UploadError ? e.code : 'badPicture' };
  }
}

async function look(src, kind) {
  const { data: px, info } = await src.open().resize(SAMPLE_PX, SAMPLE_PX, { fit: 'inside' }).toColourspace('srgb').ensureAlpha()
    .raw({ depth: 'uchar' }).timeout(TIMEOUT).toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return BAD;
  const s = inspect(px, info.width, info.height);
  if (!s) return { ok: false, reason: 'blankPicture' }; // one plain colour or see-through: no artwork in it
  // The trimmed box in the picture's own pixels (one sample pixel of room each side).
  let box = null;
  if (s.box) {
    const fx = src.w / info.width;
    const fy = src.h / info.height;
    const left = Math.max(0, Math.floor((s.box.x0 - 1) * fx));
    const top = Math.max(0, Math.floor((s.box.y0 - 1) * fy));
    const right = Math.min(src.w, Math.ceil((s.box.x1 + 2) * fx));
    const bottom = Math.min(src.h, Math.ceil((s.box.y1 + 2) * fy));
    if (right - left < src.w - 2 || bottom - top < src.h - 2) box = { left, top, width: right - left, height: bottom - top };
  }
  const w = box ? box.width : src.w;
  const h = box ? box.height : src.h;
  if (Math.max(w, h) < MIN_SIDE) return { ok: false, reason: 'tooSmall', w, h };

  const { seeThrough } = s;
  const printExt = seeThrough || kind === 'svg' || kind === 'png' ? 'png' : 'jpg';
  const start = () => {
    const img = src.open();
    return (box ? img.extract(box) : img).toColourspace('srgb');
  };
  const alpha = (img) => (seeThrough ? img.ensureAlpha() : img.removeAlpha());
  const [web, print] = await Promise.all([
    alpha(start().resize(WEB_PX, WEB_PX, { fit: 'inside', withoutEnlargement: true })).png({ compressionLevel: 9, adaptiveFiltering: true }).timeout(TIMEOUT).toBuffer(),
    (printExt === 'png' ? alpha(start()).png({ compressionLevel: 6 }) : start().removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }))
      .timeout(TIMEOUT).toBuffer({ resolveWithObject: true }),
  ]);
  const printPx = [print.info.width, print.info.height];
  return {
    ok: true,
    kind,
    w: printPx[0],
    h: printPx[1],
    transparent: s.transparent,
    ink: s.ink,
    coverage: s.coverage,
    colors: s.colors,
    textLike: s.textLike,
    flat: s.flat,
    background: s.background,
    web,
    print: print.data,
    printExt,
    printPx,
  };
}

// ---------- Words in folder and file names ----------

/** Folds Arabic and Latin spellings together: no tashkeel, one alef, ة → ه, ى → ي, lower case. */
function fold(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/([a-z]{2,})([A-Z][a-z])/g, '$1 $2') // happyCat → happy Cat
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[ئیی]/g, 'ي') // (Persian keyboards type ی and ک)
    .replace(/ک/g, 'ك')
    .replace(/[^a-z0-9ء-ي]+/g, ' ')
    .trim();
}
/** A word and its likely singular: "mugs" → mug, "hoodies" → hoodie, "المجات" → مجات, مج. */
function forms(word) {
  const out = new Set([word]);
  if (/^[a-z]+$/.test(word)) {
    if (word.length > 3 && word.endsWith('s')) out.add(word.slice(0, -1));
    if (word.length > 4 && word.endsWith('es')) out.add(word.slice(0, -2));
    if (word.length > 4 && word.endsWith('ies')) out.add(word.slice(0, -3) + 'y');
  } else {
    let w = word;
    if (w.length > 3 && w.startsWith('ال')) out.add((w = w.slice(2)));
    for (const end of ['هات', 'ات', 'ين']) if (w.length > end.length + 1 && w.endsWith(end)) out.add(w.slice(0, -end.length));
  }
  return out;
}

/** Builds a matcher from [[phrases…], target] rows: the longest phrases win their words. */
function wordTable(rows) {
  const phrases = new Map(); // folded phrase → Set of targets
  const add = (phrase, target) => {
    const f = fold(phrase);
    if (!f) return;
    if (!phrases.has(f)) phrases.set(f, new Set());
    phrases.get(f).add(target);
  };
  for (const [words, ...targets] of rows) {
    for (const w of words) {
      for (const t of targets.flat()) {
        add(w, t);
        if (fold(w).includes(' ')) add(fold(w).replace(/ /g, ''), t); // "t shirt" → tshirt too
      }
    }
  }
  return [...phrases].map(([f, targets]) => ({ words: f.split(' '), targets })).sort((a, b) => b.words.length - a.words.length);
}
/** The targets a name names, longest phrases first (so "kids hoodie" isn't also "hoodie"). */
function matchWords(text, table, extra = []) {
  const words = fold(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const wordForms = words.map(forms);
  const used = new Array(words.length).fill(false);
  const found = [];
  const rows = extra.length ? [...extra, ...table].sort((a, b) => b.words.length - a.words.length) : table;
  for (const row of rows) {
    const len = row.words.length;
    for (let i = 0; i + len <= words.length; i++) {
      let hit = true;
      for (let j = 0; j < len && hit; j++) hit = !used[i + j] && wordForms[i + j].has(row.words[j]);
      if (!hit) continue;
      for (let j = 0; j < len; j++) used[i + j] = true;
      found.push(...row.targets);
    }
  }
  return found;
}

// Product names as owners write them on folders, English and Egyptian Arabic.
const PRODUCT_WORDS = wordTable([
  [['tshirt', 't shirt', 'tee', 'tee shirt', 'shirt', 'تيشيرت', 'تيشرت', 'تي شيرت', 'تي شرت', 'تيشيرتات', 'تشيرت'], 'tshirt'],
  [['oversized', 'oversize', 'اوفر سايز', 'اوفرسايز'], 'oversized'],
  [['hoodie', 'hoody', 'هودي', 'هوديز', 'هوديهات'], 'hoodie'],
  [['zip hoodie', 'zipper hoodie', 'هودي سوستة', 'هودي بسوستة'], 'ziphoodie'],
  [['sweatshirt', 'sweat shirt', 'sweater', 'سويتشيرت', 'سويت شيرت', 'سويتر', 'بلوفر'], 'sweatshirt'],
  [['kids tee', 'kids tshirt', 'kids t shirt', 'تيشيرت اطفال', 'تيشيرتات اطفال'], 'kidstee'],
  [['kids hoodie', 'هودي اطفال'], 'kidshoodie'],
  [['onesie', 'bodysuit', 'romper', 'بادي بيبي', 'سالوبيت'], 'onesie'],
  [['polo', 'بولو'], 'polo'],
  [['jersey', 'football shirt', 'جيرسي', 'تيشيرت كورة'], 'jersey'],
  [['denim', 'jacket', 'جينز', 'جاكت', 'جاكيت'], 'denim'],
  [['shorts', 'شورت'], 'shorts'],
  [['cap', 'hat', 'كاب', 'كابات', 'طاقية', 'برنيطة'], 'cap'],
  [['apron', 'مريلة', 'مريلة مطبخ'], 'apron'],
  [['mug', 'cup', 'coffee mug', 'مج', 'مجات', 'ماج', 'ماجات', 'مق', 'كوب', 'اكواب', 'كوباية', 'كوبايات'], 'mug'],
  [['magic mug', 'مج سحري'], 'magicmug'],
  [['couple mugs', 'couple mug', 'مجات كابلز', 'كابلز'], 'couplemugs'],
  [['tumbler', 'travel mug', 'ترمس', 'تمبلر'], 'tumbler'],
  [['bottle', 'water bottle', 'زمزمية', 'ازازة', 'قزازة', 'زجاجة', 'بوتل'], 'bottle'],
  [['cushion', 'pillow', 'خدادية', 'مخدة', 'مخدات', 'كوشن', 'وسادة'], 'cushion'],
  [['poster', 'wall art', 'بوستر', 'برواز', 'براويز'], 'poster'],
  [['canvas', 'painting', 'كانفاس', 'تابلوه', 'تابلوهات', 'لوحة', 'لوحات'], 'canvas'],
  [['wide canvas', 'كانفاس عريض'], 'canvaswide'],
  [['phone case', 'iphone', 'mobile case', 'جراب', 'جرابات', 'جراب موبايل', 'كفر موبايل'], 'phonecase'],
  [['mousepad', 'mouse pad', 'ماوس باد'], 'mousepad'],
  [['desk mat', 'desk pad', 'ديسك مات'], 'deskmat'],
  [['notebook', 'journal', 'نوت', 'نوتة', 'نوت بوك', 'كشكول', 'كشاكيل', 'اجندة', 'كراسة'], 'notebook'],
  [['tote', 'tote bag', 'bag', 'شنطة', 'شنط', 'توت باج', 'شنطة قماش'], 'tote'],
  [['keychain', 'key chain', 'keyring', 'ميدالية', 'ميداليات', 'سلسلة مفاتيح'], 'keychain'],
  [['coaster', 'كوستر', 'قاعدة كوب', 'قواعد اكواب'], 'coasters'],
  [['tablecloth', 'table cloth', 'مفرش', 'مفارش', 'مفرش سفرة'], 'tablecloth'],
  [['prayer mat', 'prayer rug', 'سجادة صلاة', 'مصلية'], 'prayermat'],
  [['eid envelope', 'eidiya', 'ظرف عيدية', 'ظروف عيدية', 'عيدية'], 'eidenvelopes'],
  [['card', 'greeting card', 'كارت', 'كروت', 'بطاقة', 'بطاقات', 'كارت معايدة', 'كروت معايدة'], 'greetingcard', 'foldedcards', 'postcards'],
  [['folded card'], 'foldedcards'],
  [['postcard', 'بوستكارد', 'كارت بوستال', 'كروت بوستال'], 'postcards'],
  [['invitation', 'invite', 'دعوة', 'دعوات', 'كارت دعوة', 'كروت فرح'], 'invitations'],
  [['plaque', 'acrylic', 'درع', 'دروع', 'اكريليك'], 'plaque'],
  [['sign', 'يافطة', 'يافطات', 'لافتة', 'لافتات'], 'sign'],
  [['sticker', 'استيكر', 'ستيكر', 'استيكرات', 'ستيكرات'], 'stickersheet', 'logostickers'],
  [['sticker sheet', 'شيت استيكرات'], 'stickersheet'],
  [['logo sticker', 'round sticker'], 'logostickers'],
  [['window sticker', 'ستيكر زجاج'], 'windowstickers'],
  [['name label', 'name sticker'], 'namelabels'],
  [['lunch bag', 'lunch box', 'شنطة اكل', 'لانش بوكس'], 'lunchbag'],
  [['pencil case', 'مقلمة', 'مقالم'], 'pencilcase'],
  [['business card', 'visit card', 'كارت شخصي', 'كروت شخصية', 'بيزنس كارد'], 'bizcards'],
  [['flyer', 'leaflet', 'فلاير', 'فلايرات', 'منشور', 'منشورات'], 'flyers'],
  [['letterhead', 'ليتر هيد'], 'letterhead'],
  [['envelope', 'ظرف', 'ظروف'], 'dlenvelopes'],
  [['rollup', 'roll up', 'رول اب'], 'rollup'],
  [['paper bag', 'شنط ورق', 'شنطة ورق', 'اكياس ورق'], 'paperbags'],
  [['id card', 'badge', 'كارنيه', 'كارنيهات'], 'idcards'],
  [['certificate', 'شهادة', 'شهادات'], 'certificates'],
  [['bookmark', 'فاصل كتاب', 'فواصل'], 'bookmarks'],
  [['brochure', 'بروشور', 'بروشورات'], 'brochures'],
  [['menu', 'منيو', 'منيوهات'], 'menus'],
  [['notepad', 'نوت باد', 'بلوك نوت'], 'notepads'],
  [['label', 'ليبل', 'ليبلات'], 'labels'],
  [['wrapping paper', 'gift wrap', 'ورق هدايا', 'ورق تغليف'], 'wrappingpaper'],
  [['calendar', 'wall calendar', 'نتيجة', 'نتايج', 'تقويم'], 'calendar'],
  [['desk calendar', 'نتيجة مكتب'], 'deskcalendar'],
  [['photo album', 'album', 'البوم', 'البوم صور'], 'photobook'],
  [['magnet', 'fridge magnet', 'مغناطيس', 'ماجنت', 'مغناطيسات'], 'magnets'],
  [['banner', 'بانر', 'بانرات', 'بنر'], 'banners'],
  [['table number', 'ارقام ترابيزات'], 'tablenumbers'],
  [['place card'], 'placecards'],
  [['gift voucher', 'voucher', 'gift card', 'فاوتشر', 'قسيمة'], 'giftvouchers'],
  [['fabric', 'pattern', 'قماش', 'اقمشة', 'باترن'], 'fabric'],
  [['upholstery', 'تنجيد'], 'upholstery'],
  [['bedsheet', 'bed sheet', 'ملاية', 'ملايات'], 'bedsheet'],
  [['duvet', 'duvet cover', 'كفر لحاف'], 'duvetcover'],
  [['curtain', 'ستارة', 'ستاير', 'ستائر'], 'curtains'],
]);
// Whole product categories (src/products.js CATEGORIES, "c:") and groups of products ("g:"):
// weaker than a product named outright.
const GROUP_WORDS = wordTable([
  [['apparel', 'clothes', 'clothing', 'wear', 'ملابس', 'لبس', 'هدوم'], 'c:apparel'],
  [['home', 'living', 'بيت', 'منزل'], 'c:home'],
  [['accessories', 'اكسسوارات', 'اكسسوار'], 'c:accessories'],
  [['stationery', 'ادوات مكتبية'], 'c:stationery'],
  [['gifts', 'occasions', 'هدايا', 'مناسبات'], 'c:occasions'],
  [['school', 'back to school', 'مدرسة', 'مدارس'], 'c:school'],
  [['business', 'company', 'corporate', 'شركات', 'شركة'], 'c:business'],
  [['textiles', 'textile', 'مفروشات'], 'c:textiles'],
  [['laser', 'engraving', 'engraved', 'ليزر', 'حفر'], 'c:laser'],
  [['kids', 'children', 'baby', 'اطفال', 'عيال', 'بيبي'], ['g:kidstee', 'g:kidshoodie', 'g:onesie']],
  [['wall', 'wall art', 'حائط'], ['g:poster', 'g:canvas', 'g:canvaswide']],
  [['drinkware', 'cups'], ['g:mug', 'g:magicmug', 'g:tumbler', 'g:bottle']],
]);

/** The products and product categories a design's folders and file name name. */
function namedIn(path, products) {
  const parts = String(path || '').split('/').filter(Boolean);
  const file = (parts.pop() || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  // The shop's own product names count too ("Ceramic Mug", "مج سيراميك"), as whole names.
  const own = [];
  for (const p of products || []) {
    for (const n of [p && p.name && p.name.en, p && p.name && p.name.ar]) {
      const f = typeof n === 'string' ? fold(n) : '';
      if (f.includes(' ')) own.push({ words: f.split(' '), targets: new Set([p.id]) });
    }
  }
  const read = (texts) => {
    const ids = new Set();
    const cats = new Set();
    const groups = new Set();
    for (const t of texts) {
      for (const x of matchWords(t, PRODUCT_WORDS, own)) ids.add(x);
      for (const x of matchWords(t, GROUP_WORDS)) (x.startsWith('c:') ? cats : groups).add(x.slice(2));
    }
    return { ids, cats, groups };
  };
  return { folder: read(parts), file: read([file]) };
}

// ---------- Suggesting products ----------

// How well a product suits each kind of picture, 0..1: [cut-out artwork (see-through
// round it, or on a plain background the product comes in), full picture printed edge
// to edge]. Garments, mugs and bags are for artwork; wall art, cushions, phone cases,
// mouse pads and cards for full pictures; shop print (letterheads, invoice books, ID
// cards…) rarely takes a random picture, so it waits for a folder name.
const AFFINITY = {
  tshirt: [0.95, 0.45], oversized: [0.88, 0.42], hoodie: [0.9, 0.4], sweatshirt: [0.88, 0.4], ziphoodie: [0.62, 0.3],
  kidstee: [0.72, 0.38], kidshoodie: [0.66, 0.34], onesie: [0.55, 0.3], polo: [0.5, 0.2], jersey: [0.45, 0.2],
  denim: [0.55, 0.3], shorts: [0.35, 0.12], cap: [0.62, 0.2], apron: [0.6, 0.3],
  mug: [0.92, 0.7], magicmug: [0.8, 0.62], couplemugs: [0.55, 0.45], tumbler: [0.8, 0.55], bottle: [0.75, 0.45],
  tote: [0.86, 0.55], cushion: [0.65, 0.8], poster: [0.45, 0.95], canvas: [0.35, 0.92], canvaswide: [0.35, 0.92],
  phonecase: [0.6, 0.85], mousepad: [0.45, 0.78], deskmat: [0.35, 0.72], notebook: [0.55, 0.68], keychain: [0.6, 0.55],
  coasters: [0.5, 0.62], magnets: [0.45, 0.62], postcards: [0.4, 0.66], greetingcard: [0.42, 0.62], foldedcards: [0.38, 0.58],
  stickersheet: [0.62, 0.3], logostickers: [0.72, 0.3], windowstickers: [0.5, 0.35], labels: [0.35, 0.25],
  lunchbag: [0.55, 0.45], pencilcase: [0.5, 0.45], plaque: [0.4, 0.75], sign: [0.3, 0.55], calendar: [0.3, 0.6],
  deskcalendar: [0.3, 0.55], photobook: [0.3, 0.6], tablecloth: [0.25, 0.3], bookmarks: [0.3, 0.4], notepads: [0.35, 0.4],
  invitations: [0.3, 0.4], eidenvelopes: [0.35, 0.3], paperbags: [0.4, 0.35], banners: [0.2, 0.35], rollup: [0.15, 0.3],
  flyers: [0.2, 0.35], menus: [0.15, 0.25], brochures: [0.12, 0.2], giftvouchers: [0.2, 0.3], bizcards: [0.2, 0.25],
  letterhead: [0.12, 0.12], dlenvelopes: [0.12, 0.12], invoicebook: [0.05, 0.05], idcards: [0.1, 0.1], certificates: [0.12, 0.15],
  folders: [0.15, 0.2], tablenumbers: [0.15, 0.2], placecards: [0.15, 0.2], namelabels: [0.12, 0.1],
  // Not for any picture: only when the folder or file name asks for it.
  prayermat: [0, 0],
};
// Products the manager adds later: by their category.
const BY_CATEGORY = { apparel: [0.6, 0.3], home: [0.5, 0.55], accessories: [0.5, 0.5], stationery: [0.4, 0.5], occasions: [0.35, 0.45], school: [0.45, 0.4], business: [0.15, 0.25] };
// A picture shaped like the mug's whole wrap (panoramic, about 2.5:1) goes all the way round.
const WRAP_AFFINITY = { mug: 0.97, magicmug: 0.86, couplemugs: 0.6 };
const WRAP_FITS = 0.85;
// On a mug the customer sees one side at a time (as src/library.js SEEN_SHAPE).
const SEEN_SHAPE = 1.15;
const FIT = 0.92; // uploaded designs fill 92% of the print area (the design's `fit`)
const GOOD_DPI = 150;
const LOW_DPI = 100;
// Name boosts: a folder is the owner sorting designs on purpose, so it counts most.
const BOOST = { folder: 0.5, file: 0.4, folderCat: 0.25, fileCat: 0.2 };

const HEX = /^#[0-9a-f]{6}$/i;
const lumHex = (hex) => luma(...rgbOf(hex));
// The magic mug is black when cold, but the print shows on white once it is hot.
const PRINTS_ON = { magicmug: '#ffffff' };
/** The colours the design is printed on: the paper for posters and canvas, else the product's colours. */
function surfaces(p) {
  if (PRINTS_ON[p.id]) return [PRINTS_ON[p.id]];
  if (HEX.test(p.surface || '')) return [p.surface];
  return (p.colors || []).map((c) => c && c.hex).filter((h) => HEX.test(h || ''));
}
const affinityOf = (p) => AFFINITY[p.id] || AFFINITY[p.base] || BY_CATEGORY[p.category] || [0.3, 0.3];

/** The physical print area (inches) a design goes in, at the product's first (default) size. */
function areaOf(p) {
  const side = p.sides && p.sides[0];
  const a = side && side.printArea;
  if (!a || !(a.w > 0) || !(a.h > 0) || !(side.printWidthIn > 0)) return null;
  const size = (p.sizes || [])[0] || {};
  const scale = size.printScale || 1;
  let wIn = side.printWidthIn * scale;
  let hIn = size.printHeightCm ? size.printHeightCm / 2.54 : (side.printHeightIn || (side.printWidthIn * a.h) / a.w) * scale;
  // Ready designs go in part of some print areas (a wall calendar's picture half, a folder's front).
  if (a.readyZone) {
    wIn *= a.readyZone.w || 1;
    hIn *= a.readyZone.h || 1;
  }
  return { wIn, hIn, wrap: Boolean(side.wrap) };
}

const fillOf = (r, shape) => Math.min(r / shape, shape / r);
const orientation = (r) => (r > 1.2 ? 1 : r < 1 / 1.2 ? -1 : 0);

/**
 * Products a picture could go on, best first: [{ productId, score (0..1), ok
 * (prints well: at least 100 DPI), dpi (at the product's default size, filling
 * 92% of the print area), reasons }]. Score = how well the product suits this
 * kind of picture (cut-out artwork or a full picture) × how well the shapes
 * agree × resolution × whether the ink shows on the product's colours, plus a
 * boost when the folder or file name names the product (or its category): named
 * products always come first.
 * Books and photo sets, booklets and fabric by the metre are never suggested
 * (fabric only when named); laser products only for one flat colour.
 */
function suggest(analysis, products, { path = '' } = {}) {
  if (!analysis || !analysis.ok || !(analysis.w > 0) || !(analysis.h > 0)) return [];
  const { w, h } = analysis;
  const r = w / h;
  const names = namedIn(path, products);
  const out = [];
  for (const p of products || []) {
    if (!p || !p.id || p.kind || p.paged) continue;
    const reasons = [];
    // [boost, reason, rank]: a product named outright comes before one whose category is named.
    const inGroup = (n) => n.cats.has(p.category) || n.groups.has(p.id);
    const named = names.folder.ids.has(p.id) ? ['folder', 'folderName', 2] : names.file.ids.has(p.id) ? ['file', 'fileName', 2]
      : inGroup(names.folder) ? ['folderCat', 'folderName', 1] : inGroup(names.file) ? ['fileCat', 'fileName', 1] : null;
    const boost = named ? BOOST[named[0]] : 0;
    if (named) reasons.push(named[1]);
    if (p.pattern && !boost) continue; // fabric by the metre repeats a pattern: only when named
    if (p.laser && !analysis.flat) continue; // engraving shows one colour only
    const area = areaOf(p);
    if (!area) continue;
    let [cutAff, fullAff] = p.laser ? [0.5, 0] : affinityOf(p);
    if (!cutAff && !fullAff && !boost) continue;

    // The shape: the print area's, and for a mug also the side the customer sees, or its whole wrap.
    const shape = area.wIn / area.hIn;
    const wrapFits = area.wrap && fillOf(r, shape) >= WRAP_FITS;
    if (wrapFits) [cutAff, fullAff] = [Math.max(cutAff, WRAP_AFFINITY[p.id] || 0.9), Math.max(fullAff, WRAP_AFFINITY[p.id] || 0.9)];
    const shapes = area.wrap && !wrapFits ? [shape, SEEN_SHAPE] : [shape];
    const fill = Math.max(...shapes.map((s) => fillOf(r, s)));
    // Cut-out artwork sits on the product whatever its outline; a full picture leaves
    // empty bands when the shapes differ, worst when one is upright and the other wide.
    const shapeScore = (cut) => Math.max(...shapes.map((s) => fillOf(r, s) ** (cut ? 0.4 : orientation(r) * orientation(s) < 0 ? 1.2 : 0.6)));

    // Cut-out or full picture? Artwork on a plain background is a cut-out on a product of that colour.
    const on = surfaces(p);
    const bgMatch = analysis.background && on.some((hex) => dist2(rgbOf(hex), rgbOf(analysis.background)) < 36 * 36);
    let base;
    let kind;
    // (Engraving takes the shape's outline only: no background, no ink colour.)
    if (analysis.transparent || p.laser) [base, kind] = [cutAff * shapeScore(true), 'transparentArtwork'];
    else if (bgMatch) {
      const cut = cutAff * shapeScore(true);
      const full = fullAff * shapeScore(false);
      [base, kind] = cut >= full ? [cut, 'plainBackground'] : [full, 'fullPicture'];
    } else [base, kind] = [fullAff * shapeScore(false), 'fullPicture'];
    if (p.laser) reasons.push('flatColour');
    else if (kind !== 'fullPicture' || fullAff >= 0.6) reasons.push(kind);
    if (wrapFits) reasons.push('wrapFits');
    else if (fill >= 0.9) reasons.push('shapeFits');

    // Dark artwork needs a light colour to show on, light artwork a dark one.
    let ink = 1;
    if (analysis.transparent && !p.laser) {
      const dark = analysis.ink === 'dark';
      const shows = on.some((hex) => (dark ? lumHex(hex) >= 0.6 : lumHex(hex) < 0.45));
      ink = shows ? 1 : 0.4;
      reasons.push(shows ? (dark ? 'darkInk' : 'lightInk') : 'inkClash');
    }

    // Resolution: the picture filling 92% of the print area (as it is placed), at the default size.
    const dpi = Math.round(Math.max(w / (FIT * area.wIn), h / (FIT * area.hIn)));
    const ok = dpi >= LOW_DPI;
    const res = dpi >= GOOD_DPI ? 1 : ok ? 0.9 : 0.55;
    if (dpi >= GOOD_DPI) reasons.push('highRes');
    else if (!ok) reasons.push('lowRes');

    const raw = base * ink * res + boost;
    out.push({ productId: p.id, score: Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100, ok, dpi, reasons, raw, rank: named ? named[2] : 0 });
  }
  // The products the names ask for first (the owner sorted the designs on purpose), then
  // best first by the score before it is capped at 1.
  out.sort((a, b) => b.rank - a.rank || b.raw - a.raw);
  return out.map(({ raw, rank, ...s }) => s);
}

/** The products to tick at first: the suggestions that print well and score 0.5 or more, at most `max`. */
function pickProducts(suggestions, max = 8) {
  return (suggestions || []).filter((s) => s.ok && s.score >= 0.5).slice(0, max).map((s) => s.productId);
}

/**
 * The product colour (id) to show the design on: for a cut-out, white for dark artwork
 * and black for light artwork (or the lightest / darkest colour there is); for
 * artwork on a plain background, the colour nearest that background; for a full
 * picture, white. Posters and canvases print on white whatever the colour (the
 * frame or edge), so they keep their first colour. Null for a product without colours.
 */
function analysisColor(analysis, product) {
  const colors = ((product && product.colors) || []).filter((c) => c && c.id);
  if (!colors.length) return null;
  const white = colors.find((c) => c.id === 'white');
  if (product.surface || PRINTS_ON[product.id] || !analysis) return colors[0].id;
  const known = colors.filter((c) => HEX.test(c.hex || ''));
  if (!known.length) return (white || colors[0]).id;
  if (analysis.background && !analysis.transparent && HEX.test(analysis.background)) {
    // The background box disappears best into the nearest colour (cream rather than black for white).
    const bg = rgbOf(analysis.background);
    return known.reduce((best, c) => (dist2(rgbOf(c.hex), bg) < dist2(rgbOf(best.hex), bg) ? c : best)).id;
  }
  if (analysis.transparent) {
    const byLum = [...known].sort((a, b) => lumHex(a.hex) - lumHex(b.hex));
    if (analysis.ink === 'light') return (colors.find((c) => c.id === 'black') || byLum[0]).id;
    return (white || byLum[byLum.length - 1]).id;
  }
  return (white || colors[0]).id;
}

// ---------- Names and subjects from the file name ----------

// Leftovers round a name: numbering and camera prefixes in front ("01 cat", "IMG_1234"),
// numbering and export words behind ("cat copy 2", "cat final v3").
const NAME_HEAD = /^([\d٠-٩]+|img|dsc|dscn|pxl|screenshot)$/i;
const NAME_TAIL = /^([\d٠-٩]+|copy|final|v\d+|نسخة|نسخه|نهائي)$/i;

/**
 * A readable design name from the file name: "happy-cat_01.png" → "Happy cat",
 * "HappyCat (2).PNG" → "Happy cat", "قطة_سعيدة.png" → "قطة سعيدة". The same text for
 * both languages (a Latin name stays Latin in Arabic and the other way round).
 */
function nameFrom(path) {
  const file = String(path || '').split(/[\\/]/).pop() || '';
  const stem = file.replace(/\.[a-z0-9]{1,5}$/i, '').normalize('NFC').replace(CONTROL, '');
  const words = stem
    .replace(/([a-z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/[([{]\s*[\d٠-٩]*\s*[)\]}]/g, ' ')
    .replace(/@\dx\b/gi, ' ')
    .split(/[\s_\-.+~=,;]+/)
    .filter(Boolean);
  while (words.length && NAME_HEAD.test(words[0])) words.shift();
  while (words.length && NAME_TAIL.test(words[words.length - 1])) words.pop();
  if (!words.length) {
    const num = (stem.match(/[\d٠-٩]+/g) || []).pop();
    return num ? { en: `Design ${num}`, ar: `تصميم ${num}` } : { en: 'Design', ar: 'تصميم' };
  }
  // Sentence case for Latin words: "HAPPY CAT" and "Happy Cat" → "Happy cat"; "NASA logo", "iPhone" kept.
  const allCaps = words.every((w) => !/[a-z]/.test(w));
  const cased = words.map((w) => (allCaps || /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w));
  if (cased[0] === cased[0].toLowerCase()) cased[0] = cased[0].charAt(0).toUpperCase() + cased[0].slice(1);
  let text = cased.join(' ');
  if (text.length > 80) text = text.slice(0, 80).replace(/\s+\S*$/, '') || text.slice(0, 80);
  return { en: text, ar: text };
}

// Words that name a ready-design subject (src/library.js CATEGORIES ids), English and Arabic.
const SUBJECT_WORDS = wordTable([
  [['funny', 'comedy', 'meme', 'memes', 'مضحك', 'هزار', 'ضحك', 'ميمز', 'افيهات مضحكة'], 'funny'],
  [['ramadan', 'ramadhan', 'fanous', 'رمضان', 'فانوس', 'فوانيس', 'رمضان كريم'], 'ramadan'],
  [['football', 'soccer', 'كورة', 'كوره', 'ahly', 'zamalek', 'الاهلي', 'الزمالك', 'اهلي', 'زمالك'], 'football'],
  [['eid', 'adha', 'fitr', 'عيد', 'العيد', 'اضحي', 'فطر', 'عيد الاضحي', 'عيد الفطر'], 'eid'],
  [['love', 'valentine', 'valentines', 'حب', 'فالنتين', 'عيد الحب'], 'love'],
  [['birthday', 'bday', 'عيد ميلاد', 'ميلاد', 'هابي بيرث داي'], 'birthday'],
  [['family', 'mom', 'mum', 'mother', 'dad', 'father', 'عيلة', 'عائلة', 'ماما', 'بابا', 'عيد الام', 'الام', 'الاب'], 'family'],
  [['egypt', 'masr', 'cairo', 'pyramids', 'pharaoh', 'pharaonic', 'مصر', 'القاهرة', 'هرم', 'اهرامات', 'فرعون', 'فرعوني'], 'egypt'],
  [['motivation', 'motivational', 'success', 'تحفيز', 'تحفيزي', 'نجاح'], 'motivation'],
  [['wedding', 'engagement', 'bride', 'groom', 'فرح', 'افراح', 'خطوبة', 'زفاف', 'عروسة', 'كتب كتاب'], 'wedding'],
  [['graduation', 'grad', 'تخرج'], 'graduation'],
  [['baby', 'newborn', 'baby shower', 'مولود', 'بيبي', 'سبوع'], 'baby'],
  [['christmas', 'xmas', 'كريسماس', 'الكريسماس', 'راس السنة'], 'christmas'],
  [['friends', 'friend', 'bff', 'اصحاب', 'صحاب', 'صديق', 'صحبة'], 'friends'],
  [['islamic', 'islam', 'quran', 'dua', 'اسلامي', 'اسلامية', 'قران', 'دعاء', 'ادعية', 'اذكار'], 'islamic'],
  [['gym', 'fitness', 'workout', 'جيم', 'رياضة'], 'fitness'],
  [['gaming', 'gamer', 'games', 'playstation', 'جيمنج', 'العاب', 'بلايستيشن'], 'gaming'],
  [['music', 'موسيقي', 'مزيكا', 'اغاني'], 'music'],
  [['travel', 'outdoors', 'beach', 'camping', 'سفر', 'رحلة', 'رحلات', 'بحر', 'مصيف'], 'travel'],
  [['kids', 'children', 'اطفال', 'عيال'], 'kids'],
  [['school', 'teacher', 'teachers', 'مدرسة', 'مدرس', 'مدرسين', 'معلم'], 'school'],
  [['pets', 'pet', 'cat', 'dog', 'kitten', 'puppy', 'قطة', 'قطط', 'كلب', 'كلاب'], 'pets'],
  [['business', 'company', 'logo', 'شركة', 'شركات', 'لوجو'], 'business'],
  [['vintage', 'retro', 'فينتدج', 'ريترو'], 'vintage'],
  [['surreal', 'dreamy', 'ai art', 'خيالي'], 'surreal'],
  [['optical', 'optical illusion', 'illusion', 'خداع بصري'], 'optical'],
  [['comic', 'comics', 'pop art', 'كوميكس'], 'comic'],
  [['maximal', 'maximalism', 'maximalist'], 'maximal'],
  [['painted', 'painting', 'watercolor', 'watercolour', 'رسم', 'الوان مائية'], 'artsy'],
  [['luxury', 'فخم', 'فخامة'], 'luxury'],
  [['trends', 'trend', 'slang', 'تريند', 'تريندات', 'افيهات'], 'trends'],
  [['quotes', 'quote', 'wisdom', 'حكم', 'اقوال', 'اقتباسات'], 'quotes'],
  [['minimal', 'minimalist', 'aesthetic', 'بسيط', 'مينيمال'], 'minimal'],
]);

/**
 * The ready-design subject (a src/library.js CATEGORIES id) the folders or the file name
 * name, or 'other'. The innermost folder counts first, then the outer ones, then the file.
 * Subjects added by template packs are matched by their id and names.
 */
function guessCategory(path) {
  let categories = null;
  try {
    // Loaded here, not at the top: src/library.js may load this module one day.
    categories = require('./library').CATEGORIES;
  } catch {
    categories = null;
  }
  const known = categories ? new Set(categories.map((c) => c.id)) : null;
  const extra = (categories || []).flatMap((c) => [c.id, c.name && c.name.en, c.name && c.name.ar]
    .map((n) => fold(n || '')).filter(Boolean).map((f) => ({ words: f.split(' '), targets: new Set([c.id]) })));
  const parts = String(path || '').split('/').filter(Boolean);
  const file = (parts.pop() || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  for (const text of [...parts.reverse(), file]) {
    const hit = matchWords(text, SUBJECT_WORDS, extra).find((id) => !known || known.has(id));
    if (hit) return hit;
  }
  return 'other';
}

module.exports = {
  UploadError,
  readZip,
  openZip,
  analyze,
  suggest,
  pickProducts,
  analysisColor,
  nameFrom,
  guessCategory,
  isPictureName,
  LIMITS: { MAX_PIXELS, MIN_SIDE, WEB_PX, SVG_PX, MAX_SVG, LOW_DPI, GOOD_DPI, FIT },
};
