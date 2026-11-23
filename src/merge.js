'use strict';

/**
 * Name lists (variable data printing): one design, one printed copy per row
 * of the customer's spreadsheet.
 *
 * For each side that has fields (`{Name}` in a text), the editor uploads:
 *   <side>-merge-base.png  the side without the variable text (and what lies over it)
 *   <side>-merge.bin       one small transparent PNG per row, back to back:
 *                          the variable text, cropped to the side's `box` (print pixels)
 * The browser draws them with the same fonts and effects as the editor, so
 * Arabic and every text effect print exactly as the customer saw them.
 *
 * Here they become:
 *   - one print PDF: the background is stored once and each page only adds
 *     its own name picture (how professional variable-data printing works,
 *     so even 1,000 copies make a small file);
 *   - a ZIP with one PDF per copy (for smaller lists);
 *   - the list itself as CSV.
 */
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const PDFDocument = require('pdfkit');
const { splitPngs } = require('./merge-data');

let sharpLib = null;
const sharp = () => (sharpLib = sharpLib || require('sharp'));

/** Largest ZIP of separate PDFs we build (each PDF carries the whole background). */
const MAX_ZIP_BYTES = 400 * 1024 * 1024;

/**
 * The background flattened onto white, without transparency. On paper,
 * transparent and white are the same (no ink), and a plain RGB PNG goes into
 * the PDF as it is, without being decoded (fast, even for A3 at 300 DPI).
 */
async function flatPng(buf) {
  return sharp()(buf, { limitInputPixels: 130e6 }).flatten({ background: '#ffffff' }).removeAlpha().png({ compressionLevel: 6, palette: false }).toBuffer();
}

/**
 * Everything a print needs, per side in order: the background, and for the
 * sides with fields the per-row pictures and where they go.
 * `read(name)` returns a design file as a Buffer.
 */
async function layers(design, read, { keepAlpha = false } = {}) {
  const out = [];
  for (const side of design.sides) {
    const m = design.merge && design.merge.sides && design.merge.sides[side.id];
    const raw = read(m ? `${side.id}-merge-base.png` : `${side.id}-print.png`);
    // Garments (DTF / DTG) keep their transparency: only the artwork is printed.
    const base = keepAlpha ? raw : await flatPng(raw);
    out.push({ side, base, box: m ? m.box : null, overlays: m ? splitPngs(read(`${side.id}-merge.bin`), { max: design.merge.count }) : null });
  }
  return out;
}

function cropMarks(doc, W, H, m, b, slug) {
  const pt = 72;
  const len = 0.25 * pt;
  const gap = Math.max(b, 0.0625 * pt) + 2;
  const [x0, y0, x1, y1] = [m + b, m + b, W - m - b, H - m - b];
  doc.lineWidth(0.25).strokeColor('#000000');
  for (const [x, sx] of [[x0, -1], [x1, 1]]) {
    for (const [y, sy] of [[y0, -1], [y1, 1]]) {
      doc.moveTo(x + sx * gap, y).lineTo(x + sx * (gap + len), y).stroke();
      doc.moveTo(x, y + sy * gap).lineTo(x, y + sy * (gap + len)).stroke();
    }
  }
  // The built-in PDF font has Latin letters only: other scripts (Arabic names) are left out of this small label.
  const label = String(slug || '').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').replace(/(\s*·\s*)+/g, ' · ').trim();
  if (label) doc.font('Helvetica').fontSize(6).fillColor('#000000').text(label, m + b, H - m / 2 - 3, { lineBreak: false });
}

/**
 * A PDF with the given copies (row numbers, 0-based): one page per side per
 * copy, at the real size with bleed (and crop marks if asked). Writes to
 * `stream` when given, else resolves with a Buffer.
 */
function pdf(lays, rows, { marks = false, title = '', label = null, stream = null } = {}) {
  const pt = 72;
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Title: title, Creator: 'OneOff Print' } });
  const done = new Promise((resolve, reject) => {
    if (stream) {
      stream.on('finish', () => resolve(null));
      stream.on('error', reject);
      doc.on('error', reject);
      doc.pipe(stream);
    } else {
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    }
  });
  // Each background is embedded once and shown on every page.
  const bases = lays.map((l) => doc.openImage(l.base));
  for (const r of rows) {
    lays.forEach((l, i) => {
      const s = l.side;
      const trimW = s.widthIn * pt;
      const trimH = s.heightIn * pt;
      const b = (s.bleedIn || 0) * pt;
      const m = marks ? 0.4 * pt : 0;
      const W = trimW + 2 * b + 2 * m;
      const H = trimH + 2 * b + 2 * m;
      doc.addPage({ size: [W, H], margin: 0 });
      doc.page.dictionary.data.BleedBox = [m, m, W - m, H - m];
      doc.page.dictionary.data.TrimBox = [m + b, m + b, W - m - b, H - m - b];
      doc.page.dictionary.data.ArtBox = [m + b, m + b, W - m - b, H - m - b];
      const fullW = trimW + 2 * b;
      doc.image(bases[i], m, m, { width: fullW, height: trimH + 2 * b });
      if (l.overlays && l.overlays[r]) {
        const k = fullW / bases[i].width; // points per print pixel
        const bx = l.box;
        doc.image(l.overlays[r], m + bx.x * k, m + bx.y * k, { width: bx.w * k, height: bx.h * k });
      }
      if (marks) cropMarks(doc, W, H, m, b, `${title} · copy ${r + 1}${label ? ` · ${label(r)}` : ''} · ${s.name && (s.name.en || s.name)}`);
    });
  }
  doc.end();
  return done;
}

/** Writes the whole print PDF (every copy) to `file`. */
async function writePdf(lays, count, file, opts = {}) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await pdf(lays, Array.from({ length: count }, (_, i) => i), { ...opts, stream: fs.createWriteStream(tmp) });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** A file name from a value: keeps letters (Arabic too) and digits, drops what file systems refuse. */
function fileSlug(v, max = 40) {
  const s = String(v || '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, max).join('').trim().replace(/\s/g, '-');
}

/**
 * A ZIP (stored, no compression: PDFs are compressed already) written to
 * `file` entry by entry, so only one PDF is in memory at a time.
 * `entries` is an async iterable of { name, data }.
 */
async function writeZip(file, entries, { maxBytes = MAX_ZIP_BYTES } = {}) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  try {
    for await (const { name, data } of entries) {
      const nameBuf = Buffer.from(name, 'utf8');
      const crc = zlib.crc32(data) >>> 0;
      if (offset + data.length + nameBuf.length + 30 > maxBytes) {
        const e = new Error('zip too big');
        e.code = 'ZIP_TOO_BIG';
        throw e;
      }
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(0x0800, 6); // UTF-8 names
      h.writeUInt16LE(0, 8);
      h.writeUInt16LE(DOS_TIME, 10);
      h.writeUInt16LE(DOS_DATE, 12);
      h.writeUInt32LE(crc, 14);
      h.writeUInt32LE(data.length, 18);
      h.writeUInt32LE(data.length, 22);
      h.writeUInt16LE(nameBuf.length, 26);
      h.writeUInt16LE(0, 28);
      fs.writeSync(fd, h);
      fs.writeSync(fd, nameBuf);
      fs.writeSync(fd, data);
      central.push({ nameBuf, crc, size: data.length, offset });
      offset += h.length + nameBuf.length + data.length;
    }
    const start = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(DOS_TIME, 12);
      h.writeUInt16LE(DOS_DATE, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.size, 20);
      h.writeUInt32LE(c.size, 24);
      h.writeUInt16LE(c.nameBuf.length, 28);
      h.writeUInt32LE(c.offset, 42);
      fs.writeSync(fd, h);
      fs.writeSync(fd, c.nameBuf);
      offset += h.length + c.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - start, 12);
    end.writeUInt32LE(start, 16);
    fs.writeSync(fd, end);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) { /* already closed */ }
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** One PDF per copy, in a ZIP, named "0001-Ahmed-Ali.pdf". */
async function writeZipOfPdfs(lays, count, rows, file, { title = '', nameColumn = 0 } = {}) {
  async function* entries() {
    for (let r = 0; r < count; r++) {
      const who = fileSlug(rows[r] && (rows[r][nameColumn] || rows[r].find(Boolean)));
      yield { name: `${String(r + 1).padStart(4, '0')}${who ? `-${who}` : ''}.pdf`, data: await pdf(lays, [r], { title: `${title} · copy ${r + 1}` }) };
    }
  }
  return writeZip(file, entries());
}

/**
 * Garments: just the name / number pictures, one PNG per piece at print size,
 * named "0007-Ahmed-10-L.png", with where they go (for printing names and
 * numbers as separate transfers). `extra(r)` adds the size / colour to the name.
 */
async function writeZipOfNames(design, read, rows, file, { extra = () => '' } = {}) {
  const entries = [];
  for (const [id, m] of Object.entries(design.merge.sides)) {
    const pics = splitPngs(read(`${id}-merge.bin`), { max: design.merge.count });
    const side = design.sides.find((s) => s.id === id);
    const dpi = side && side.dpi ? side.dpi : 300;
    for (let r = 0; r < pics.length; r++) {
      const who = fileSlug((rows[r] || []).filter(Boolean).slice(0, 2).join(' '));
      const data = await sharp()(pics[r]).withDensity(dpi).png().toBuffer();
      entries.push({ name: `${Object.keys(design.merge.sides).length > 1 ? `${id}/` : ''}${String(r + 1).padStart(4, '0')}${who ? `-${who}` : ''}${extra(r) ? `-${fileSlug(extra(r), 20)}` : ''}.png`, data });
    }
    const b = m.box;
    entries.push({ name: `${id}-placement.txt`, data: Buffer.from(`Each picture goes ${(b.x / dpi * 2.54).toFixed(1)} cm from the left and ${(b.y / dpi * 2.54).toFixed(1)} cm from the top of the ${side ? side.widthIn : ''} x ${side ? side.heightIn : ''} in print area (with bleed), at ${dpi} DPI.\r\n`) });
  }
  async function* gen() { for (const e of entries) yield e; }
  return writeZip(file, gen());
}

/** The list as CSV (UTF-8 with BOM so Excel shows Arabic correctly). */
function csv(columns, rows) {
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['#', ...columns], ...rows.map((r, i) => [i + 1, ...r])].map((r) => r.map(cell).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

/** Values for `{Column}` fields: the row as { column: value }. */
const rowObject = (columns, row) => Object.fromEntries(columns.map((c, i) => [c, row[i] || '']));

module.exports = { layers, pdf, writePdf, writeZip, writeZipOfPdfs, writeZipOfNames, csv, fileSlug, flatPng, rowObject, MAX_ZIP_BYTES };
