'use strict';

// Booklet print PDFs made from the customer's own PDF (QA): every sheet's CropBox / ArtBox is the
// sheet's own (a source page's CropBox doesn't carry over), what lies outside the source page's
// CropBox isn't printed, and a page turned with /Rotate is noticed (it prints from its picture).
const test = require('node:test');
const assert = require('node:assert');
const PDFDocument = require('pdfkit');
const artwork = require('../src/artwork');

const pdf = (n, { crop, rotate } = {}) => new Promise((resolve) => {
  const d = new PDFDocument({ autoFirstPage: false, compress: false });
  const chunks = [];
  d.on('data', (c) => chunks.push(c));
  d.on('end', () => {
    let s = Buffer.concat(chunks).toString('latin1');
    // An A5 CropBox on A4 pages, and /Rotate on the first page (pdfkit has no option for either;
    // Ghostscript repairs the offsets).
    if (crop) s = s.replace(/\/MediaBox \[0 0 595\.28 841\.89\]/g, '/MediaBox [0 0 595.28 841.89] /CropBox [87 123 507 718]');
    if (rotate) s = s.replace('/Type /Page\n', '/Type /Page\n/Rotate 90\n');
    resolve(Buffer.from(s, 'latin1'));
  });
  for (let i = 0; i < n; i++) {
    d.addPage({ size: 'A4', margin: 0 });
    d.rect(0, 0, 595.28, 841.89).fill('#2f9e44'); // the whole A4 page green…
    d.rect(87, 123, 420, 595).fill('#ffffff'); // …the A5 crop white
  }
  d.end();
});

test('a source page\'s CropBox is respected and doesn\'t carry over to the sheets', async () => {
  const src = await pdf(4, { crop: true });
  const info = await artwork.pdfInfo(src);
  assert.deepStrictEqual([info.boxes[0].w, info.boxes[0].h], [420, 595]);
  const spec = { widthIn: 5.83, heightIn: 8.27, bleedIn: 0.08 };
  const W = spec.widthIn * 72 + 2 * spec.bleedIn * 72;
  const H = spec.heightIn * 72 + 2 * spec.bleedIn * 72;
  const pages = [0, 1, 2, 3].map((page) => ({ pdf: 'a', page, src: info.boxes[page], box: { x: 0, y: 0, w: W, h: H } }));
  for (const imposed of [false, true]) {
    const out = await artwork.bookletFromPdf({ sources: { a: src }, parts: null, pages, spec, imposed });
    const text = out.toString('latin1');
    const crops = [...text.matchAll(/\/CropBox\s*\[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
    const media = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
    assert.ok(crops.length >= 1, 'sheets carry a CropBox');
    for (const c of crops) assert.ok(Math.abs(c[0]) < 0.5 && Math.abs(c[1]) < 0.5 && Math.abs(c[2] - media[0][2]) < 0.6 && Math.abs(c[3] - media[0][3]) < 0.6, `CropBox ${c} is the sheet ${media[0]}`);
    // Nothing of the green outside the CropBox is printed: rendered, the page is white.
    const shown = await artwork.pdfPages(out, { max: 1, maxPx: 300 });
    const sharp = require('sharp');
    const { data, info: im } = await sharp(shown.pages[0]).raw().toBuffer({ resolveWithObject: true });
    let green = 0;
    for (let i = 0; i < data.length; i += im.channels) if (data[i + 1] > 120 && data[i] < 100) green++;
    assert.ok(green < (im.width * im.height) * 0.01, `no green outside the crop (${green} px, imposed: ${imposed})`);
  }
});

test('a page turned with /Rotate is noticed', async () => {
  const info = await artwork.pdfInfo(await pdf(2, { rotate: true }));
  assert.strictEqual(info.boxes[0].rotate, 90);
  assert.ok(!info.boxes[1].rotate);
});
