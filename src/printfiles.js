'use strict';

/**
 * Print-file production: everything the print shop downloads is derived from
 * the transparent RGB PNG the editor uploads (artwork + bleed at ~300 DPI).
 */
const sharp = require('sharp');
const PDFDocument = require('pdfkit');

sharp.cache(false); // print files are big and used once; don't keep them in memory

/** Embed the sRGB profile and the DPI so print software reads the right size and colours. */
async function finalizePrintPng(buf, dpi) {
  return sharp(buf, { limitInputPixels: 80e6 })
    .withIccProfile('srgb')
    .withDensity(dpi)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

async function pngInfo(buf) {
  const m = await sharp(buf, { limitInputPixels: 80e6 }).metadata();
  return { width: m.width, height: m.height, hasAlpha: !!m.hasAlpha };
}

/** Mirror image, for sublimation transfer paper. */
async function mirroredPng(buf, dpi) {
  return sharp(buf, { limitInputPixels: 80e6 }).flop().withIccProfile('srgb').withDensity(dpi).png().toBuffer();
}

/**
 * CMYK TIFF for paper/offset printing. Transparent areas become white paper.
 * Converted with libvips' built-in CMYK profile, which is embedded in the file.
 */
async function cmykTiff(buf, dpi) {
  return sharp(buf, { limitInputPixels: 80e6 })
    .flatten({ background: '#ffffff' })
    .withIccProfile('cmyk')
    .withDensity(dpi)
    .tiff({ compression: 'lzw' })
    .toBuffer();
}

/** RGB -> CMYK -> RGB round trip so shoppers can see how bright colours will print. */
async function cmykProof(buf) {
  const img = sharp(buf, { limitInputPixels: 8e6 });
  const meta = await img.metadata();
  const alpha = meta.hasAlpha ? await sharp(buf).extractChannel('alpha').toBuffer() : null;
  const cmyk = await sharp(buf).flatten({ background: '#ffffff' }).withIccProfile('cmyk').tiff().toBuffer();
  let back = sharp(cmyk).toColourspace('srgb').withIccProfile('srgb');
  if (alpha) back = back.joinChannel(alpha);
  return back.png().toBuffer();
}

/**
 * Print-ready PDF at the exact physical size.
 * Page = trim + bleed (+ a margin with crop marks when `marks` is set).
 * TrimBox and BleedBox are set so prepress software knows where to cut.
 */
function printPdf(pngBuf, spec, { marks = false, title = '', slug = '' } = {}) {
  const pt = 72;
  const trimW = spec.widthIn * pt;
  const trimH = spec.heightIn * pt;
  const b = (spec.bleedIn || 0) * pt;
  const m = marks ? 0.4 * pt : 0;
  const W = trimW + 2 * b + 2 * m;
  const H = trimH + 2 * b + 2 * m;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: true, info: { Title: title, Creator: 'OneOff Print' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const box = (x0, y0, x1, y1) => [x0, y0, x1, y1]; // PDF boxes, origin bottom-left (margins are symmetric)
    doc.page.dictionary.data.BleedBox = box(m, m, W - m, H - m);
    doc.page.dictionary.data.TrimBox = box(m + b, m + b, W - m - b, H - m - b);
    doc.page.dictionary.data.ArtBox = box(m + b, m + b, W - m - b, H - m - b);

    doc.image(pngBuf, m, m, { width: trimW + 2 * b, height: trimH + 2 * b });

    if (marks) {
      const len = 0.25 * pt;
      const gap = Math.max(b, 0.0625 * pt) + 2;
      const x0 = m + b;
      const y0 = m + b;
      const x1 = W - m - b;
      const y1 = H - m - b;
      doc.lineWidth(0.25).strokeColor('#000000');
      for (const [x, sx] of [[x0, -1], [x1, 1]]) {
        for (const [y, sy] of [[y0, -1], [y1, 1]]) {
          doc.moveTo(x + sx * gap, y).lineTo(x + sx * (gap + len), y).stroke(); // horizontal mark
          doc.moveTo(x, y + sy * gap).lineTo(x, y + sy * (gap + len)).stroke(); // vertical mark
        }
      }
      if (slug) doc.font('Helvetica').fontSize(6).fillColor('#000000').text(slug, m + b, H - m / 2 - 3, { lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { finalizePrintPng, pngInfo, mirroredPng, cmykTiff, cmykProof, printPdf };
