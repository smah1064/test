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

// ---------- DTG & DTF ----------
// Note: sharp's morphology is named for dark shapes on light backgrounds, so on
// an alpha mask (light shape) `dilate` shrinks the shape and `erode` grows it.

/** Edges soft enough to leave half-transparent pixels print badly on film: make the alpha crisp. */
async function hardAlpha(buf, cutoff = 128) {
  const { data, info } = await sharp(buf, { limitInputPixels: 80e6 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= cutoff ? 255 : 0;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * DTF film file: crisp alpha (the RIP builds the white layer from it) and
 * mirrored, because the film is pressed print-side down.
 */
async function dtfFilmPng(buf, dpi, { mirror = true } = {}) {
  let out = sharp(await hardAlpha(buf), { limitInputPixels: 80e6 });
  if (mirror) out = out.flop();
  return out.withIccProfile('srgb').withDensity(dpi).png().toBuffer();
}

/**
 * DTG white underbase for dark garments: white wherever the design has ink,
 * choked (pulled in) by a couple of pixels so no white peeks out at the edges.
 */
async function dtgUnderbase(buf, dpi, chokePx = 2) {
  const { data: mask, info } = await sharp(buf, { limitInputPixels: 80e6 }).ensureAlpha().extractChannel('alpha')
    .threshold(40).dilate(chokePx).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) out[i * 4 + 3] = mask[i * info.channels];
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).withDensity(dpi).png().toBuffer();
}

/**
 * Lay several pieces of artwork out on one roll of DTF film and return a PDF.
 * pieces: [{ png, widthIn, heightIn, label }]. Pieces are nested with the
 * shared packer, made crisp and mirrored; each gets a small label for sorting.
 */
async function filmPdf(pieces, { rollWidthIn = 22, gapIn = 0.25, mirror = true, title = 'DTF film', labels = true, margin = 0.25, placements = null, lengthIn: fixedLength = null } = {}) {
  const { pack } = require('../public/js/nesting');
  const labelH = labels ? 0.14 : 0;
  const usable = rollWidthIn - 2 * margin;
  // A ready-made layout (customer gang sheets) is used as is; otherwise nest the pieces.
  const layout = placements ? { placements, length: fixedLength - 2 * margin } : pack(pieces.map((p, i) => ({ id: i, w: p.widthIn, h: p.heightIn + labelH })), usable, gapIn);
  const lengthIn = fixedLength || layout.length + 2 * margin;
  const pt = 72;
  const maxPageIn = 196; // PDF readers cap pages at 200 in; longer films continue on the next page
  const pages = Math.max(1, Math.ceil(lengthIn / maxPageIn));
  const prepared = await Promise.all(layout.placements.map(async (pl) => {
    const piece = pieces[pl.id];
    let img = sharp(await hardAlpha(piece.png), { limitInputPixels: 80e6 });
    if (pl.rotated) img = img.rotate(90);
    if (mirror) img = img.flop();
    return { pl, piece, png: await img.png().toBuffer() };
  }));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Title: title, Creator: 'OneOff Print' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), lengthIn, pieces: layout.placements.length }));
    doc.on('error', reject);
    for (let pg = 0; pg < pages; pg++) {
      const top = pg * maxPageIn;
      const h = Math.min(maxPageIn, lengthIn - top);
      doc.addPage({ size: [rollWidthIn * pt, h * pt], margin: 0 });
      for (const { pl, piece, png } of prepared) {
        const y = margin + pl.y;
        if (y + pl.h <= top || y >= top + h) continue;
        const w = pl.rotated ? piece.heightIn : piece.widthIn;
        const ih = pl.rotated ? piece.widthIn : piece.heightIn;
        // On mirrored film, positions are mirrored too so the whole sheet reads correctly after pressing.
        const x = mirror ? rollWidthIn - margin - pl.x - w : margin + pl.x;
        doc.image(png, x * pt, (y - top) * pt, { width: w * pt, height: ih * pt });
        if (labels && piece.label) {
          doc.font('Helvetica').fontSize(6).fillColor('#9aa0a6').text(piece.label, x * pt, (y - top + ih + 0.02) * pt, { lineBreak: false });
        }
      }
    }
    doc.end();
  });
}

/**
 * Photo quality boost: enlarge with Lanczos resampling (up to `scale` times,
 * at most 4000 px on the long side), lightly clean JPEG noise, then sharpen.
 * Keeps transparency (PNG out) or returns a high-quality JPEG.
 */
async function enhancePhoto(buf, scale) {
  const meta = await sharp(buf, { limitInputPixels: 40e6 }).metadata();
  if (!meta.width || !meta.height) throw new Error('not an image');
  const long = Math.max(meta.width, meta.height);
  const k = Math.max(1, Math.min(scale, 4, 4000 / long));
  const w = Math.round(meta.width * k);
  const h = Math.round(meta.height * k);
  const alpha = Boolean(meta.hasAlpha);
  let img = sharp(buf, { limitInputPixels: 40e6 }).rotate();
  if (!alpha && meta.format === 'jpeg') img = img.median(3);
  img = img.resize(w, h, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6 + 0.25 * k, m1: 0.6, m2: 2.2 });
  const data = alpha ? await img.png({ compressionLevel: 8 }).toBuffer() : await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { data, format: alpha ? 'png' : 'jpeg', scale: +(w / meta.width).toFixed(3), width: w, height: h };
}


/**
 * A PDF of what the customer designed, to show or send them: one A4 page per
 * picture, with the order details at the top. `pages` = [{ img, label }].
 */
function previewPdf(pages, { title = '', lines = [] } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: false, info: { Title: title, Creator: 'OneOff Print' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    pages.forEach((pg, i) => {
      doc.addPage();
      const W = doc.page.width - 72;
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(15).text(title, 36, 36, { width: W });
      doc.font('Helvetica').fontSize(9.5).fillColor('#555555');
      for (const l of lines) doc.text(l, { width: W });
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(`${pg.label}${pages.length > 1 ? `   (${i + 1}/${pages.length})` : ''}`, { width: W });
      const top = doc.y + 10;
      const H = doc.page.height - 36 - top - 14;
      doc.image(pg.img, 36, top, { fit: [W, H], align: 'center', valign: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#999999').text('Preview only: colours on screen and paper may differ slightly from the printed product.', 36, doc.page.height - 36 - 9, { width: W, align: 'center', lineBreak: false });
    });
    doc.end();
  });
}

module.exports = { previewPdf, enhancePhoto, finalizePrintPng, pngInfo, mirroredPng, cmykTiff, cmykProof, printPdf, hardAlpha, dtfFilmPng, dtgUnderbase, filmPdf };
