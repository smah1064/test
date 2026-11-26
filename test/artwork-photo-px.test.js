'use strict';

// QA 26 Nov: a low-resolution photo saved as PDF or EPS passed the editor's print check. Uploaded as a 300 x 200
// PNG the editor says "31 DPI, blurry"; the same picture as PDF or EPS came back from the converter as a
// 2998 x 1999 PNG (the whole page fitted into px, the photo enlarged with stepped edges), and the editor, which
// only sees the PNG's size, said "Ready to print". The converter now also says how many real pixels such a
// photo has (photoPx); the PNG itself is drawn exactly as before.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const artwork = require('../src/artwork');

let gsMissing = false;
try {
  require.resolve('@okathira/ghostpdl-wasm');
} catch (e) {
  gsMissing = 'Ghostscript (@okathira/ghostpdl-wasm) is not installed';
}
let convertMissing = gsMissing;
if (!convertMissing) {
  try {
    execFileSync('convert', ['-version'], { stdio: 'ignore' });
  } catch (e) {
    convertMissing = 'ImageMagick (convert) is not installed';
  }
}

const cm = 72 / 2.54;
const A4 = [595.28, 841.89];
function pdf(size, draw) {
  return new Promise((resolve) => {
    const d = new PDFDocument({ size, margin: 0 });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    draw(d);
    d.end();
  });
}
// A w x h picture that looks like a photo to the converter (busy, never white), the same every run.
function photo(w, h, alpha = false) {
  const ch = alpha ? 4 : 3;
  const px = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      px[i] = (x * 7 + y * 3) % 200;
      px[i + 1] = ((x * y) % 180) + 20;
      px[i + 2] = (x + y * 5) % 220;
      if (alpha) px[i + 3] = 230;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: ch } });
}
function hexRows(w, h, comps) {
  let s = '';
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w * comps; x++) row += ((x * 7 + y * 13 + ((x * y) % 31) * 5) % 200).toString(16).padStart(2, '0');
    s += `${row}\n`;
  }
  return s;
}
// A w x h photo drawn ptW x ptH points as EPS, in the ways PostScript draws pictures.
function eps(mode, { w = 300, h = 200, ptW = w, ptH = h, bands = 4 } = {}) {
  const head = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(ptW)} ${Math.ceil(ptH)}\n%%EndComments\n`;
  const read = '{ currentfile line readhexstring pop }';
  let body = '';
  if (mode === 'image') body = `/line ${w} string def gsave ${ptW} ${ptH} scale ${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}] ${read} image\n${hexRows(w, h, 1)}grestore\n`;
  if (mode === 'colorimage') body = `/line ${w * 3} string def gsave ${ptW} ${ptH} scale ${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}] ${read} false 3 colorimage\n${hexRows(w, h, 3)}grestore\n`;
  // (Level 2: a dictionary; inside save / restore, as most EPS files draw.)
  if (mode === 'dict') body = `save /DeviceRGB setcolorspace ${ptW} ${ptH} scale << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [${w} 0 0 -${h} 0 ${h}] /DataSource currentfile /ASCIIHexDecode filter >> image\n${hexRows(w, h, 3)}>\nrestore\n`;
  // Cut into strips, as some printer drivers send a picture.
  if (mode === 'bands') {
    const bh = h / bands;
    body = `/line ${w} string def\n`;
    for (let i = 0; i < bands; i++) body += `gsave 0 ${ptH - ((i + 1) * ptH) / bands} translate ${ptW} ${ptH / bands} scale ${w} ${bh} 8 [${w} 0 0 -${bh} 0 ${bh}] ${read} image\n${hexRows(w, bh, 1)}grestore\n`;
  }
  // Drawn with the operator itself, fetched from systemdict: not noticed, so nothing is said.
  if (mode === 'systemdict') body = `/line ${w} string def gsave ${ptW} ${ptH} scale ${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}] ${read} systemdict /image get exec\n${hexRows(w, h, 1)}grestore\n`;
  // Pixels made by a procedure (a big photo in a small file).
  if (mode === 'procedure') body = `/line ${w * 3} string def 0 1 ${w * 3 - 1} { line exch dup 7 mul 200 mod put } for gsave ${ptW} ${ptH} scale ${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}] { line } false 3 colorimage grestore\n`;
  if (mode === 'vector') body = '0.1 0.3 0.8 setrgbcolor 20 20 260 160 rectfill 1 0.8 0.1 setrgbcolor newpath 150 100 50 0 360 arc fill\n';
  return Buffer.from(`${head}${body}showpage\n%%EOF\n`, 'latin1');
}
// What Ghostscript's own EPS writer makes of a PDF (its pictures drawn by its own procedures).
async function eps2write(pdfBuf) {
  const loadGs = (await import('@okathira/ghostpdl-wasm')).default;
  const gs = await loadGs({ print: () => {}, printErr: () => {} });
  gs.FS.writeFile('in.pdf', pdfBuf);
  try {
    gs.callMain(['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=eps2write', '-sOutputFile=out.eps', 'in.pdf']);
  } catch (e) {
    // (the exit status)
  }
  return Buffer.from(gs.FS.readFile('out.eps'));
}

// `size`: the PNG the converter made of this file before photoPx was added (it must stay exactly that).
async function check(name, buf, { size, photoPx = null, px = 3000 }) {
  const out = await artwork.convertArtwork(buf, { px });
  const meta = await sharp(out.png).metadata();
  assert.deepStrictEqual([out.width, out.height, meta.width, meta.height], [...size, ...size], `${name}: the PNG as before (${out.width}x${out.height})`);
  if (!photoPx) {
    assert.strictEqual(out.photoPx, undefined, `${name}: no photoPx (${JSON.stringify(out.photoPx)})`);
    assert.ok(!('photoPx' in out), `${name}: not even as a key`);
    return out;
  }
  assert.ok(out.photoPx && Number.isInteger(out.photoPx.w) && Number.isInteger(out.photoPx.h), `${name}: photoPx is { w, h } (${JSON.stringify(out.photoPx)})`);
  assert.deepStrictEqual(Object.keys(out.photoPx).sort(), ['h', 'w']);
  assert.ok(Math.abs(out.photoPx.w - photoPx[0]) <= 3 && Math.abs(out.photoPx.h - photoPx[1]) <= 3, `${name}: photoPx ${out.photoPx.w}x${out.photoPx.h}, about ${photoPx.join('x')}`);
  return out;
}

test('a small photo saved as PDF says how many real pixels it has; the PNG is drawn as before', { skip: gsMissing }, async () => {
  const jpg = await photo(300, 200).jpeg().toBuffer();
  // The photo is the page (as "convert small.png small.pdf" makes it): drawn 2998 px wide, 300 of them real.
  await check('300 x 200 photo as PDF', await pdf([300, 200], (d) => d.image(jpg, 0, 0, { width: 300, height: 200 })), { size: [2998, 1999], photoPx: [300, 200] });
  // A transparent PNG in a PDF: its soft mask (as many pixels again) is not counted as more photo.
  const png = await photo(300, 200, true).png().toBuffer();
  await check('300 x 200 transparent photo as PDF', await pdf([300, 200], (d) => d.image(png, 0, 0, { width: 300, height: 200 })), { size: [2999, 1999], photoPx: [300, 200] });
  // 7 cm wide on A4 (Word, a phone's "print to PDF"): the page fitted into 3000 px gives it 707 px, of which 300 are real.
  const onA4 = await pdf(A4, (d) => d.image(jpg, 7 * cm, 10 * cm, { width: 7 * cm }));
  await check('300 x 200 photo on A4', onA4, { size: [707, 471], photoPx: [300, 200] });
  // Asked for fewer pixels, the same file is drawn at the photo's own 300: nothing to add.
  await check('300 x 200 photo on A4, 1200 px asked', onA4, { size: [300, 200], px: 1200 });
});

test('a photo that is sharp enough, vector artwork, and a vector logo with a small photo: no photoPx', { skip: gsMissing }, async () => {
  const big = await photo(3000, 2000).jpeg().toBuffer();
  await check('3000 x 2000 photo as PDF', await pdf([3000, 2000], (d) => d.image(big, 0, 0, { width: 3000, height: 2000 })), { size: [2998, 1999] });
  await check('vector PDF (shapes and text)', await pdf(A4, (d) => {
    d.rect(100, 300, 300, 200).fill('#1d4ed8');
    d.circle(250, 400, 60).fill('#facc15');
    d.fillColor('#000').fontSize(40).text('Hello', 120, 520);
  }), { size: [2998, 2496] });
  const small = await photo(300, 200).jpeg().toBuffer();
  await check('vector logo with a small photo beside it', await pdf(A4, (d) => {
    d.rect(7 * cm, 10 * cm, 7 * cm, 4 * cm).fill('#1d4ed8');
    d.image(small, 14.2 * cm, 10 * cm, { width: 1 * cm });
  }), { size: [2998, 1463] });
});

test('a small photo saved as EPS says how many real pixels it has, however the EPS draws it', { skip: gsMissing }, async () => {
  for (const mode of ['image', 'colorimage', 'dict', 'bands']) await check(`EPS (${mode})`, eps(mode), { size: [2998, 1999], photoPx: [300, 200] });
  // Ghostscript's own EPS writer (its pictures drawn by procedures of its own).
  const jpg = await photo(300, 200).jpeg().toBuffer();
  await check('EPS made by eps2write', await eps2write(await pdf([300, 200], (d) => d.image(jpg, 0, 0, { width: 300, height: 200 }))), { size: [2998, 1999], photoPx: [300, 200] });
  // Drawn 2 x 2 inches: 300 real pixels across all the same.
  await check('EPS (image), 144 pt', eps('image', { ptW: 144, ptH: 96 }), { size: [2998, 1999], photoPx: [300, 200] });
  // A file that fetches the drawing operator from systemdict isn't noticed: nothing is said (as before).
  await check('EPS (systemdict /image)', eps('systemdict'), { size: [2998, 1999] });
});

test('a sharp photo or vector artwork as EPS: no photoPx', { skip: gsMissing }, async () => {
  await check('3000 x 2000 photo as EPS', eps('procedure', { w: 3000, h: 2000 }), { size: [2998, 1999] });
  await check('vector EPS', eps('vector'), { size: [2998, 1845] });
});

test('the QA tester\'s files: a 300 x 200 PNG converted to PDF and EPS with ImageMagick', { skip: convertMissing }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-photopx-'));
  try {
    await photo(300, 200).png().toFile(path.join(dir, 'small.png'));
    for (const ext of ['pdf', 'eps']) {
      execFileSync('convert', [path.join(dir, 'small.png'), path.join(dir, `small.${ext}`)], { stdio: 'ignore' });
      await check(`convert small.png small.${ext}`, fs.readFileSync(path.join(dir, `small.${ext}`)), { size: [2998, 1999], photoPx: [300, 200] });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
