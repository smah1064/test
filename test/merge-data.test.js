'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const { MergeDataError, parseTable, splitPngs, pngSize, zipStore, readZip } = require('../src/merge-data');

const csv = (s, opts) => parseTable(Buffer.from(s, 'utf8'), opts);
const reason = (r) => (e) => e instanceof MergeDataError && e.reason === r;

/** A ZIP with every entry deflated (what Excel writes), built by hand. */
function zipDeflate(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(head, nameBuf, comp);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/* ---------- CSV ---------- */

test('csv: quotes, embedded comma/newline, doubled quotes, CRLF, BOM', () => {
  const t = csv('﻿Name,Note\r\n"Smith, John","line one\r\nline two"\r\n"say ""hi""",plain\r\n');
  assert.deepStrictEqual(t, {
    columns: ['Name', 'Note'],
    rows: [['Smith, John', 'line one line two'], ['say "hi"', 'plain']],
    total: 2,
    truncated: false,
    format: 'csv',
  });
});

test('csv: Arabic names, CR-only line ends, spaces collapsed', () => {
  const t = csv('الاسم,المدينة\rأحمد   محمد,القاهرة\r  سارة ,  الإسكندرية\r');
  assert.deepStrictEqual(t.columns, ['الاسم', 'المدينة']);
  assert.deepStrictEqual(t.rows, [['أحمد محمد', 'القاهرة'], ['سارة', 'الإسكندرية']]);
});

test('csv: semicolon and tab delimiters', () => {
  assert.deepStrictEqual(csv('a;b;c\n1;2,5;3\n').rows, [['1', '2,5', '3']]);
  assert.deepStrictEqual(csv('Name\tCity, Country\nAli\tCairo, EG\n').rows, [['Ali', 'Cairo, EG']]);
  assert.deepStrictEqual(csv('Name\tCity, Country\nAli\tCairo, EG\n').columns, ['Name', 'City, Country']);
  assert.deepStrictEqual(csv('sep=;\nx;y\n1;2\n').rows, [['1', '2']]);
});

test('csv: empty rows skipped, blank and duplicate headers', () => {
  const t = csv('\n\nName,,Name,name\n,,,\n\nA,B,C,D\n , , , \nE,F,G,H\n');
  assert.deepStrictEqual(t.columns, ['Name', 'Column B', 'Name 2', 'name 3']);
  assert.deepStrictEqual(t.rows, [['A', 'B', 'C', 'D'], ['E', 'F', 'G', 'H']]);
  assert.strictEqual(t.total, 2);
});

test('csv: trailing empty columns dropped, short rows padded, maxCols', () => {
  const t = csv('a,b,,\n1,,,\n2,3\n');
  assert.deepStrictEqual(t.columns, ['a', 'b']);
  assert.deepStrictEqual(t.rows, [['1', ''], ['2', '3']]);
  // A column with no header but some data is kept.
  assert.deepStrictEqual(csv('a,\n1,x\n').columns, ['a', 'Column B']);
  assert.deepStrictEqual(csv('a,b,c\n1,2,3\n', { maxCols: 2 }).rows, [['1', '2']]);
});

test('csv: maxRows truncation and maxCell cut', () => {
  const lines = ['n'];
  for (let i = 1; i <= 25; i++) lines.push(String(i), '');
  const t = csv(lines.join('\n'), { maxRows: 10 });
  assert.strictEqual(t.total, 25);
  assert.strictEqual(t.truncated, true);
  assert.strictEqual(t.rows.length, 10);
  assert.deepStrictEqual(t.rows[9], ['10']);
  assert.strictEqual(csv('n\n1\n', { maxRows: 1 }).truncated, false);

  const cut = csv('n\nabcdefgh\n😀😀😀😀\n', { maxCell: 3 });
  assert.deepStrictEqual(cut.rows, [['abc'], ['😀😀😀']]);
});

test('csv: windows-1256 and UTF-16 encodings', () => {
  // "أحمد" in windows-1256 (Arabic Excel's CSV)
  const cp1256 = Buffer.concat([Buffer.from('Name,City\n'), Buffer.from([0xc3, 0xcd, 0xe3, 0xcf]), Buffer.from(',Cairo\n')]);
  assert.deepStrictEqual(parseTable(cp1256).rows, [['أحمد', 'Cairo']]);
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\tCity\r\nسارة\tطنطا\r\n', 'utf16le')]);
  assert.deepStrictEqual(parseTable(le).rows, [['سارة', 'طنطا']]);
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Name\nZ\n', 'utf16le').swap16()]);
  assert.deepStrictEqual(parseTable(be).rows, [['Z']]);
});

/* ---------- Errors ---------- */

test('errors: xls, unreadable, empty', () => {
  assert.throws(() => parseTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0])), reason('xls'));
  // Deterministic "random" bytes.
  const junk = Buffer.alloc(4096);
  let x = 12345;
  for (let i = 0; i < junk.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    junk[i] = x >>> 24;
  }
  assert.throws(() => parseTable(junk), reason('unreadable'));
  assert.throws(() => parseTable(Buffer.from('PK\x03\x04 not really a zip')), reason('unreadable'));
  assert.throws(() => parseTable(zipStore([{ name: 'word/document.xml', data: Buffer.from('<w/>') }])), reason('unreadable'));
  assert.throws(() => csv('Name,City\r\n'), reason('empty'));
  assert.throws(() => csv('Name,City\n,\n\n'), reason('empty'));
  assert.throws(() => csv(''), reason('empty'));
  const err = new MergeDataError('xls');
  assert.ok(err instanceof Error);
  assert.strictEqual(err.reason, 'xls');
});

/* ---------- XLSX ---------- */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xlsxFiles = {
  '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  'xl/workbook.xml': `${XML}<workbook ${NS}><sheets><sheet name="Names" sheetId="2" r:id="rId5"/><sheet r:id="rId1" name="Other" sheetId="1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Target="/xl/worksheets/names.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Id="rId5"/>'
    + '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    + '</Relationships>',
  'xl/sharedStrings.xml': `${XML}<sst ${NS} count="5" uniqueCount="5">`
    + '<si><t>Name</t><rPh sb="0" eb="1"><t>ignored</t></rPh></si>'
    + '<si><r><rPr><b/></rPr><t>City</t></r><r><t xml:space="preserve"> &amp; Town</t></r></si>'
    + '<si><t>أحمد</t></si>'
    + '<si><t>القاهرة</t></si>'
    + '<si><t>x&lt;y &#x41;&#66;</t></si>'
    + '</sst>',
  'xl/worksheets/sheet1.xml': `${XML}<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>`,
  'xl/worksheets/names.xml': `${XML}<worksheet ${NS}><dimension ref="A1:F7"/><cols><col min="1" max="4" width="12"/></cols><sheetData>`
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c t="inlineStr" r="D1"><is><t>Amount</t></is></c></row>'
    + '<row r="3" spans="1:6"><c r="A3" t="s"><v>2</v></c><c s="1" r="C3" t="s"><v>3</v></c><c r="D3"><v>42</v></c><c r="F3"/></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><r><t>محمد</t></r><r><t xml:space="preserve"> علي</t></r></is></c><c r="B4"/><c r="C4" t="b"><v>1</v></c><c r="D4" s="2"><v>3.5</v></c></row>'
    + '<row r="5"><c r="A5"/><c r="B5" t="s"><v>4</v></c></row>'
    + '<row r="6"><c r="D6"><f>0.1+0.2</f><v>0.30000000000000004</v></c></row>'
    + '<row r="7"><c r="A7"/></row>'
    + '</sheetData></worksheet>',
};
const xlsxEntries = Object.entries(xlsxFiles).map(([name, s]) => ({ name, data: Buffer.from(s) }));
const xlsxExpected = {
  columns: ['Name', 'Column B', 'City & Town', 'Amount'],
  rows: [
    ['أحمد', '', 'القاهرة', '42'],
    ['محمد علي', '', 'TRUE', '3.5'],
    ['', 'x<y AB', '', ''],
    ['', '', '', '0.3'],
  ],
  total: 4,
  truncated: false,
  format: 'xlsx',
};

test('xlsx: stored zip', () => {
  assert.deepStrictEqual(parseTable(zipStore(xlsxEntries)), xlsxExpected);
});

test('xlsx: deflated zip', () => {
  assert.deepStrictEqual(parseTable(zipDeflate(xlsxEntries)), xlsxExpected);
});

test('xlsx: no workbook falls back to sheet1, prefixed tags, numbers', () => {
  const sheet = '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>'
    + '<x:row><x:c t="inlineStr"><x:is><x:t>n</x:t></x:is></x:c><x:c t="str"><x:v>s</x:v></x:c></x:row>'
    + '<x:row><x:c><x:v>1.0</x:v></x:c><x:c t="b"><x:v>0</x:v></x:c></x:row>'
    + '<x:row><x:c><x:v>201001234567</x:v></x:c><x:c><x:v>2.5000000000000001E-2</x:v></x:c></x:row>'
    + '</x:sheetData></x:worksheet>';
  const t = parseTable(zipDeflate([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) }]));
  assert.deepStrictEqual(t.columns, ['n', 's']);
  assert.deepStrictEqual(t.rows, [['1', 'FALSE'], ['201001234567', '0.025']]);
});

test('xlsx: zip bomb is refused', () => {
  const bomb = zipDeflate([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(25 * 1024 * 1024, 0x20) }]);
  assert.ok(bomb.length < 100000);
  assert.throws(() => parseTable(bomb), reason('unreadable'));
});

/* ---------- PNG ---------- */

const makePng = (width, height, r) => sharp({ create: { width, height, channels: 4, background: { r, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();

test('splitPngs / pngSize', async () => {
  const pngs = [await makePng(3, 2, 10), await makePng(20, 7, 200), await makePng(1, 1, 0)];
  const all = Buffer.concat(pngs);
  const parts = splitPngs(all);
  assert.strictEqual(parts.length, 3);
  parts.forEach((p, i) => assert.ok(p.equals(pngs[i])));
  assert.deepStrictEqual(pngSize(parts[1]), { width: 20, height: 7 });

  assert.throws(() => splitPngs(all.subarray(0, all.length - 5)), reason('badPng'));
  assert.throws(() => splitPngs(Buffer.concat([all, Buffer.from('xx')])), reason('badPng'));
  assert.throws(() => splitPngs(Buffer.from('definitely not a png file')), reason('badPng'));
  assert.throws(() => splitPngs(Buffer.alloc(0)), reason('badPng'));
  assert.throws(() => splitPngs(all, { max: 2 }), reason('badPng'));
  const flipped = Buffer.from(all);
  flipped[pngs[0].length + 40] ^= 0xff; // corrupt a byte inside the second image
  assert.throws(() => splitPngs(flipped), reason('badPng'));
  assert.throws(() => pngSize(Buffer.from('GIF89a................')), reason('badPng'));
});

/* ---------- ZIP ---------- */

test('zipStore round-trip (readZip and system unzip)', () => {
  const entries = [
    { name: 'cards/001.png', data: Buffer.from('first') },
    { name: 'cards/بطاقة محمد.png', data: Buffer.from('second, ثاني') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const zip = zipStore(entries);
  const back = readZip(zip);
  assert.deepStrictEqual([...back.keys()], entries.map((e) => e.name));
  for (const e of entries) assert.ok(back.get(e.name).equals(e.data));
  assert.deepStrictEqual(zipStore(entries), zip); // fixed date: same bytes every time

  let hasUnzip = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    hasUnzip = false;
  }
  if (!hasUnzip) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-zip-'));
  try {
    const file = path.join(dir, 'cards.zip');
    fs.writeFileSync(file, zip);
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.match(execFileSync('unzip', ['-l', file], { encoding: 'utf8' }), /cards\/001\.png[\s\S]*3 files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZip rejects broken archives', () => {
  const zip = zipStore([{ name: 'a.txt', data: Buffer.from('hello') }]);
  const bad = Buffer.from(zip);
  bad[30 + 5] ^= 1; // change the data, CRC no longer matches
  assert.throws(() => readZip(bad), reason('unreadable'));
  assert.throws(() => readZip(zip.subarray(0, zip.length - 3)), reason('unreadable'));
  assert.throws(() => readZip(Buffer.from('short')), reason('unreadable'));
});
