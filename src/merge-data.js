'use strict';

/**
 * Mail merge data: customers upload a spreadsheet of names and the editor
 * puts each row's values into a card design. This module only reads and
 * packs data, it has no routes.
 *
 *  - parseTable: an .xlsx or CSV/TSV upload -> header + rows of plain text
 *  - splitPngs / pngSize: the editor sends one PNG per card, back to back
 *  - zipStore / readZip: a tiny ZIP writer and reader (no dependency)
 *
 * Uploads come from visitors, so the ZIP reader has hard limits (zip bombs)
 * and every cell is cleaned and cut before it reaches the editor.
 */
const zlib = require('zlib');

const ZIP_MAX_ENTRIES = 2000;
const ZIP_MAX_ENTRY = 20 * 1024 * 1024; // bytes inflated, one entry
const ZIP_MAX_TOTAL = 30 * 1024 * 1024; // bytes inflated, whole archive
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01, fixed so archives are reproducible

class MergeDataError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'MergeDataError';
    this.reason = reason;
  }
}

const fail = (reason) => {
  throw new MergeDataError(reason);
};

/* ---------- ZIP ---------- */

/**
 * Reads a ZIP archive into a Map of name -> Buffer. Only stored and deflated
 * entries; no ZIP64 or encryption. `filter(name)` skips entries we don't need
 * (they are never inflated). Anything odd throws MergeDataError('unreadable').
 */
function readZip(buf, { filter } = {}) {
  const len = buf.length;
  let eocd = -1;
  // The end record is in the last 22 bytes + up to 64 KB of comment.
  for (let p = len - 22; p >= Math.max(0, len - 22 - 0xffff); p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) fail('unreadable');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdStart = buf.readUInt32LE(eocd + 16);
  if (count > ZIP_MAX_ENTRIES || cdStart + cdSize > eocd) fail('unreadable');

  const out = new Map();
  let inflated = 0;
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) fail('unreadable');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > eocd) fail('unreadable');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || (filter && !filter(name))) continue;
    if (flags & 1) fail('unreadable'); // encrypted

    if (local + 30 > len || buf.readUInt32LE(local) !== 0x04034b50) fail('unreadable');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compSize > len) fail('unreadable');
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) {
      if (compSize > ZIP_MAX_ENTRY) fail('unreadable');
      data = raw;
    } else if (method === 8) {
      const room = Math.min(ZIP_MAX_ENTRY, ZIP_MAX_TOTAL - inflated);
      if (room <= 0) fail('unreadable');
      try {
        // maxOutputLength stops a bomb before it fills memory.
        data = zlib.inflateRawSync(raw, { maxOutputLength: room });
      } catch {
        fail('unreadable');
      }
      inflated += data.length;
    } else {
      fail('unreadable');
    }
    if (zlib.crc32(data) !== crc) fail('unreadable');
    out.set(name, data);
  }
  return out;
}

/**
 * Writes a ZIP archive with every entry stored (the PNGs inside are already
 * compressed). Names are UTF-8 (flag bit 11) so Arabic file names survive.
 */
function zipStore(entries) {
  if (entries.length > 0xffff) throw new MergeDataError('tooBig');
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (typeof name !== 'string' || !name) throw new TypeError('zip entry needs a name');
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new TypeError('zip entry name too long');
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(0, 10); // time
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk, attributes stay 0
    if (offset > 0xffffffff) throw new MergeDataError('tooBig');
    cd.writeUInt32LE(offset, 42);

    parts.push(head, nameBuf, data);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  // No ZIP64: every offset and size must fit in 32 bits.
  if (offset + cdSize + 22 > 0xffffffff) throw new MergeDataError('tooBig');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/* ---------- PNG ---------- */

/** Cuts several PNG files sent back to back into one buffer each (no copies). */
function splitPngs(buf, { max = 5000 } = {}) {
  const out = [];
  const len = buf.length;
  if (!len) fail('badPng');
  let pos = 0;
  while (pos < len) {
    if (out.length >= max) fail('badPng');
    if (pos + 8 > len || !PNG_SIG.equals(buf.subarray(pos, pos + 8))) fail('badPng');
    let p = pos + 8;
    let first = true;
    for (;;) {
      if (p + 12 > len) fail('badPng');
      const size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      if (size > 0x7fffffff || !/^[A-Za-z]{4}$/.test(type)) fail('badPng');
      if (first && (type !== 'IHDR' || size !== 13)) fail('badPng');
      const end = p + 12 + size;
      if (end > len) fail('badPng');
      if (zlib.crc32(buf.subarray(p + 4, p + 8 + size)) !== buf.readUInt32BE(p + 8 + size)) fail('badPng');
      p = end;
      first = false;
      if (type === 'IEND') break;
    }
    out.push(buf.subarray(pos, p));
    pos = p;
  }
  return out;
}

/** Width and height from the IHDR chunk. */
function pngSize(buf) {
  if (!buf || buf.length < 24 || !PNG_SIG.equals(buf.subarray(0, 8)) || buf.toString('latin1', 12, 16) !== 'IHDR') fail('badPng');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ---------- Table cleanup (shared by CSV and XLSX) ---------- */

/** 0 -> A, 25 -> Z, 26 -> AA (spreadsheet column letters). */
function colLetters(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** One line of plain text, at most maxCell characters (whole code points). */
function cleanCell(v, maxCell) {
  let s = String(v ?? '')
    .replace(/[\r\n\t\v\f\u0085\u2028\u2029]/g, ' ') // line breaks in a cell: the card has one line
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (s.length > maxCell) {
    const cps = Array.from(s);
    if (cps.length > maxCell) s = cps.slice(0, maxCell).join('').trimEnd();
  }
  return s;
}

/** Collects raw rows: the first non-empty one is the header, empty ones are skipped. */
function tableBuilder({ maxRows, maxCols, maxCell }) {
  let header = null;
  const rows = [];
  let total = 0;
  return {
    add(raw) {
      const cells = [];
      let filled = false;
      for (let i = 0; i < Math.min(raw.length, maxCols); i++) {
        cells[i] = cleanCell(raw[i], maxCell);
        if (cells[i]) filled = true;
      }
      if (!filled) return;
      if (!header) header = cells;
      else {
        total++;
        if (rows.length < maxRows) rows.push(cells);
      }
    },
    finish(format) {
      if (!header || !total) fail('empty');
      // Width = last column with something in the header or any kept row.
      const lastFilled = (r) => {
        for (let i = r.length - 1; i >= 0; i--) if (r[i]) return i + 1;
        return 0;
      };
      const width = Math.max(lastFilled(header), ...rows.map(lastFilled));
      const seen = new Set();
      const columns = [];
      for (let i = 0; i < width; i++) {
        const base = header[i] || `Column ${colLetters(i)}`;
        let name = base;
        // Case-insensitive, so {Name} and {name} never both appear in the editor.
        for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} ${n}`;
        seen.add(name.toLowerCase());
        columns.push(name);
      }
      const padded = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] || ''));
      return { columns, rows: padded, total, truncated: total > maxRows, format };
    },
  };
}

/* ---------- CSV / TSV ---------- */

/** Bytes -> text: UTF-8 or UTF-16 with BOM; Arabic Excel saves CSV as windows-1256. */
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return le.swap16().toString('utf16le');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(buf);
    } catch {
      return buf.toString('utf8'); // Node built without full ICU
    }
  }
}

/** Picks , ; or tab by counting them (outside quotes) in the first line with content. */
function guessDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let content = false;
  for (let i = 0; i < text.length && i < 65536; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (content) break;
    } else if (!quoted && ch in counts) {
      counts[ch]++;
      content = true;
    } else if (ch !== ' ') content = true;
  }
  // Ties go to tab, then semicolon: commas turn up inside names and addresses.
  let best = '\t';
  for (const d of [';', ',']) if (counts[d] > counts[best]) best = d;
  return counts[best] ? best : ',';
}

/** RFC 4180 parser (lenient about stray quotes). Calls add(fields) per record. */
function parseDelimited(text, add) {
  let i = 0;
  let delim;
  // Excel writes "sep=;" as the first line when it wants to say the delimiter.
  const sep = /^sep=([,;\t|])[ ]*(\r\n|\n|\r|$)/i.exec(text);
  if (sep) {
    delim = sep[1];
    i = sep[0].length;
  } else {
    delim = guessDelimiter(text);
  }
  let row = [];
  let field = '';
  let quoted = false;
  let atStart = true; // nothing but spaces in this field yet
  const n = text.length;
  for (; i < n; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
      field = ''; // spaces before an opening quote don't count
    } else if (ch === delim) {
      row.push(field);
      field = '';
      atStart = true;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      add(row);
      row = [];
      field = '';
      atStart = true;
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += ch;
      if (ch !== ' ') atStart = false;
    }
  }
  if (field || row.length || quoted) {
    row.push(field);
    add(row);
  }
}

/* ---------- XLSX ---------- */

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML entities, then Excel's own _xHHHH_ escapes (used for control characters). */
function xmlText(s) {
  return s
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => {
      if (e[0] !== '#') return XML_ENTITIES[e];
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Attributes of a tag as an object (any order, either quote style). */
function attrs(s) {
  const out = {};
  // Real attribute lists are short; a huge one is an attack on the regex below.
  for (const m of s.slice(0, 4096).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = xmlText(m[2] ?? m[3]);
  return out;
}

/**
 * Elements named `tag` (any namespace prefix): [attribute text, inner XML]; self-closing gives ''.
 * Scans forward only (linear time): an uploaded file full of tags that never close
 * must not make a backtracking regex rescan the rest of the file for every tag.
 */
function* elements(xml, tag) {
  const open = new RegExp(`<(?:[\\w.-]+:)?${tag}(?=[\\s/>])`, 'g');
  const close = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, 'g');
  let noClose = false; // no closing tag after some point: only self-closing ones can still match
  let m;
  while ((m = open.exec(xml))) {
    const nameEnd = m.index + m[0].length;
    const gt = xml.indexOf('>', nameEnd);
    if (gt < 0) return;
    const head = xml.slice(nameEnd, gt);
    if (head.endsWith('/')) {
      yield [head.slice(0, -1), ''];
      open.lastIndex = gt + 1;
      continue;
    }
    open.lastIndex = gt + 1;
    if (noClose) continue;
    close.lastIndex = gt + 1;
    const c = close.exec(xml);
    if (!c) {
      noClose = true;
      continue;
    }
    yield [head, xml.slice(gt + 1, c.index)];
    open.lastIndex = c.index + c[0].length;
  }
}

/** The XML with every `tag` element taken out (linear time, see elements). */
function withoutElements(xml, tag) {
  const open = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b`, 'g');
  const close = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, 'g');
  let out = '';
  let from = 0;
  let m;
  while ((m = open.exec(xml))) {
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(xml);
    if (!c) break; // nothing after this closes it
    out += xml.slice(from, m.index);
    from = c.index + c[0].length;
    open.lastIndex = from;
  }
  return out + xml.slice(from);
}

/** All <t> texts joined (rich text runs), leaving out phonetic guides. */
function richText(xml) {
  let s = '';
  for (const [, inner] of elements(withoutElements(xml, 'rPh'), 't')) s += xmlText(inner);
  return s;
}

/** Spreadsheet numbers as people typed them: 42 not 42.0, 0.3 not 0.30000000000000004. */
function formatNumber(v) {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) return v;
  if (Number.isInteger(n)) return String(n);
  // 10 significant digits, more only when the whole part needs them.
  const whole = Math.floor(Math.log10(Math.abs(n))) + 1;
  return String(Number(n.toPrecision(Math.min(15, Math.max(10, whole)))));
}

/** "BC12" -> 54 (zero-based column), or -1. */
function refColumn(ref) {
  const m = /^\$?([A-Za-z]{1,3})/.exec(ref || '');
  if (!m) return -1;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}

/** Resolves a relationship Target against the folder of the part that points to it. */
function resolvePart(base, target) {
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function parseXlsx(buf, table, maxCols) {
  const WB = 'xl/workbook.xml';
  const RELS = 'xl/_rels/workbook.xml.rels';
  const meta = readZip(buf, { filter: (n) => n === WB || n === RELS });
  let sheetPath = 'xl/worksheets/sheet1.xml';
  let stringsPath = 'xl/sharedStrings.xml';
  if (meta.has(WB) && meta.has(RELS)) {
    const rels = {};
    for (const [a] of elements(meta.get(RELS).toString('utf8'), 'Relationship')) {
      const r = attrs(a);
      if (r.Id && r.Target && r.TargetMode !== 'External') rels[r.Id] = r;
    }
    for (const r of Object.values(rels)) if (/\/sharedStrings$/.test(r.Type || '')) stringsPath = resolvePart(WB, r.Target);
    const first = elements(meta.get(WB).toString('utf8'), 'sheet').next().value;
    if (first) {
      const a = attrs(first[0]);
      // The relationship id is r:id, but the prefix is whatever the file declared.
      const key = Object.keys(a).find((k) => /:id$/.test(k));
      if (key && rels[a[key]]) sheetPath = resolvePart(WB, rels[a[key]].Target);
    }
  }
  const files = readZip(buf, { filter: (n) => n === sheetPath || n === stringsPath });
  if (!files.has(sheetPath)) fail('unreadable');

  const strings = [];
  if (files.has(stringsPath)) for (const [, inner] of elements(files.get(stringsPath).toString('utf8'), 'si')) strings.push(richText(inner));

  const sheet = files.get(sheetPath).toString('utf8');
  for (const [, rowXml] of elements(sheet, 'row')) {
    const cells = [];
    let col = -1;
    for (const [cAttrs, inner] of elements(rowXml, 'c')) {
      const a = attrs(cAttrs);
      const ref = refColumn(a.r);
      col = ref >= 0 ? ref : col + 1;
      if (col >= maxCols) continue;
      const v = elements(inner, 'v').next().value;
      const raw = v ? xmlText(v[1]) : '';
      let text;
      if (a.t === 's') text = strings[parseInt(raw, 10)] ?? '';
      else if (a.t === 'inlineStr') {
        const is = elements(inner, 'is').next().value;
        text = is ? richText(is[1]) : raw;
      } else if (a.t === 'b') text = raw === '' ? '' : raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
      else if (!a.t || a.t === 'n') text = formatNumber(raw.trim());
      else text = raw; // str (formula text), e (error such as #N/A), d (ISO date)
      cells[col] = text;
    }
    table.add(cells);
  }
}

/* ---------- Entry point ---------- */

/**
 * Reads an uploaded spreadsheet (xlsx, or CSV/TSV/semicolon text) into
 * { columns, rows, total, truncated, format }. Throws MergeDataError with
 * reason 'xls' (old Excel format), 'unreadable' or 'empty'.
 */
function parseTable(buf, { maxRows = 1000, maxCols = 20, maxCell = 200 } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const table = tableBuilder({ maxRows, maxCols, maxCell });
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x504b0304) {
    parseXlsx(buf, table, maxCols);
    return table.finish('xlsx');
  }
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) fail('xls');
  const text = decodeText(buf);
  // Binary files (images, PDFs...) have NULs or lots of control characters.
  const controls = (text.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
  if (text.includes('\u0000') || controls > text.length / 100) fail('unreadable');
  parseDelimited(text, (r) => table.add(r));
  return table.finish('csv');
}

module.exports = { MergeDataError, parseTable, splitPngs, pngSize, zipStore, readZip };
