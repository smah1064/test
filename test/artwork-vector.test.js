'use strict';

// Vector PDF / AI / EPS uploads in the design editor (POST /api/artwork): the drawing itself gets the
// pixels the editor asks for (x-max-px), not its page. A 7 cm logo alone on an A4 page came back
// 708 px wide (the whole page was drawn at 3000 px, then cut down to the logo): the editor showed
// "low resolution" for a vector file. Pictures (photos) inside a PDF are not enlarged beyond their own
// pixels, and booklet pages (/api/artwork/pages) stay whole pages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS } = require('../src/products');

let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-vector-'));
  const app = createApp({ dataDir, adminPassword: 'pw', cleanupEvery: 0, requireApproval: false, limits: { artwork: [{ max: 1e6, ms: 1000 }] } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

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
// A logo w cm wide with its top-left corner at (x, y) cm: a blue badge (200 x 113 units) with a yellow
// ring, a white star and fine stripes: 0.3-unit black bars 0.3 apart, a blur of grey when drawn coarsely.
function logo(d, x, y, w) {
  d.save().translate(x * cm, y * cm).scale((w * cm) / 200);
  d.roundedRect(0, 0, 200, 113, 18).fill('#1d4ed8');
  d.circle(56, 56, 38).lineWidth(8).stroke('#facc15');
  d.polygon([56, 26], [64, 48], [88, 48], [68, 62], [76, 86], [56, 72], [36, 86], [44, 62], [24, 48], [48, 48]).fill('#ffffff');
  d.rect(110, 20, 80, 40).fill('#ffffff');
  for (let i = 0; i < 60; i++) d.rect(115 + i * 0.6, 25, 0.3, 30).fill('#000000');
  d.restore();
}
async function convert(body, maxPx = 3000) {
  const t = Date.now();
  const r = await fetch(`${base}/api/artwork`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': String(maxPx) }, body });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const png = Buffer.from(await r.arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (fx, fy) => {
    const i = (Math.min(info.height - 1, Math.floor(info.height * fy)) * info.width + Math.min(info.width - 1, Math.floor(info.width * fx))) * 4;
    return [...data.subarray(i, i + 4)];
  };
  return { png, width: info.width, height: info.height, at, data, info, ms: Date.now() - t };
}
// The stripes, along a row through their middle: pure black and pure white bars (not a grey blur).
function crispStripes(out) {
  const y = Math.floor(out.height * (40 / 113));
  let dark = 0;
  let light = 0;
  for (let x = Math.floor(out.width * (118 / 200)); x < Math.floor(out.width * (148 / 200)); x++) {
    const v = out.data[(y * out.width + x) * 4];
    if (v < 40) dark++;
    if (v > 215) light++;
  }
  return dark > 20 && light > 20;
}
// The editor's resolution check (dpiLimits / imageDpi in public/js/editor.js) for a picture placed as it
// places a new upload: 80% of the print area.
function editorDpi(product, w, h) {
  const s = PRODUCTS.find((p) => p.id === product).sides[0];
  const a = s.printArea;
  const scale = Math.min((a.w * 0.8) / w, (a.h * 0.8) / h);
  const longIn = Math.max(s.printWidthIn, (s.printWidthIn * a.h) / a.w);
  const lim = longIn > 48 ? { fail: 40, warn: 60 } : longIn > 24 ? { fail: 72, warn: 110 } : { fail: 100, warn: 150 };
  return { dpi: Math.round(w / (((w * scale) / a.w) * s.printWidthIn)), ...lim };
}

test('a 7 cm vector logo on an empty A4 page gets the full size, crisp and transparent', async () => {
  const out = await convert(await pdf(A4, (d) => logo(d, 7, 10, 7)));
  assert.ok(out.width >= 2990 && out.width <= 3000, `the logo is 3000 px wide, not the page: ${out.width}x${out.height}`);
  assert.ok(Math.abs(out.width / out.height - 200 / 113) < 0.01, 'the logo\'s own shape');
  assert.strictEqual(out.at(0, 0)[3], 0, 'transparent outside the rounded corner');
  assert.deepStrictEqual(out.at(0.5, 0.95).slice(0, 3), [29, 78, 216], 'the blue badge');
  assert.ok(crispStripes(out), 'fine detail is drawn, not blurred');
  // In the editor (placed at 80% of a T-shirt's print area): no low-resolution warning.
  const t = editorDpi('tshirt', out.width, out.height);
  assert.ok(t.dpi >= t.warn, `T-shirt: ${t.dpi} DPI`);
  assert.ok(editorDpi('poster', out.width, out.height).dpi >= 150);
});

test('a 10 x 10 cm drawing gets the full size too, on its own page or on A4, landscape or a huge page', async () => {
  const square = (d, x, y) => { d.circle((x + 5) * cm, (y + 5) * cm, 5 * cm).fill('#e11d48'); d.rect((x + 3) * cm, (y + 4.5) * cm, 4 * cm, 1 * cm).fill('#ffffff'); };
  for (const [name, size, x, y] of [['own page', [10 * cm, 10 * cm], 0, 0], ['A4', A4, 3, 6], ['A4 landscape', [A4[1], A4[0]], 15, 5], ['A0', [2383.94, 3370.39], 30, 50]]) {
    const out = await convert(await pdf(size, (d) => square(d, x, y)));
    assert.ok(out.width >= 2990 && out.width <= 3000 && Math.abs(out.width - out.height) <= 3, `${name}: ${out.width}x${out.height}`);
    assert.strictEqual(out.at(0.02, 0.02)[3], 0, `${name}: transparent around the circle`);
    assert.deepStrictEqual(out.at(0.5, 0.5).slice(0, 4), [255, 255, 255, 255], `${name}: the white bar inside is kept`);
  }
  // What x-max-px asks for, also below 3000.
  const small = await convert(await pdf(A4, (d) => logo(d, 2, 2, 4)), 800);
  assert.ok(small.width >= 795 && small.width <= 800, `${small.width}x${small.height}`);
});

test('a logo on a white page (or a white Illustrator artboard) comes back alone, transparent around it', async () => {
  const onWhite = await convert(await pdf(A4, (d) => { d.rect(0, 0, A4[0], A4[1]).fill('#ffffff'); logo(d, 7, 10, 7); }));
  assert.ok(onWhite.width >= 2950 && onWhite.width <= 3000, `${onWhite.width}x${onWhite.height}`);
  assert.strictEqual(onWhite.at(0, 0)[3], 0, 'the white page is gone');
  assert.deepStrictEqual(onWhite.at(56 / 200, 56 / 113), [255, 255, 255, 255], 'the white star stays');
  assert.ok(crispStripes(onWhite));
  // A 1 cm logo on a white A0 page (it was 26 px wide): found on the page drawn at 3000 px, then drawn alone.
  const A0 = [2383.94, 3370.39];
  const tiny = await convert(await pdf(A0, (d) => { d.rect(0, 0, A0[0], A0[1]).fill('#ffffff'); logo(d, 40, 60, 1); }));
  assert.ok(tiny.width >= 2950 && tiny.width <= 3000 && Math.abs(tiny.width / tiny.height - 200 / 113) < 0.01, `${tiny.width}x${tiny.height}`);
  assert.strictEqual(tiny.at(0, 0)[3], 0);
  // EPS: an A4 artboard filled white, a 7 cm badge on it.
  const eps = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 595 842\n%%HiResBoundingBox: 0 0 595.28 841.89\n%%EndComments\n1 1 1 setrgbcolor 0 0 595.28 841.89 rectfill\n0.11 0.3 0.85 setrgbcolor 198 446 198 112 rectfill\n1 1 1 setrgbcolor newpath 254 502 30 0 360 arc fill\nshowpage\n%%EOF\n`);
  const art = await convert(eps);
  assert.ok(art.width >= 2950 && art.width <= 3000 && Math.abs(art.width / art.height - 198 / 112) < 0.02, `${art.width}x${art.height}`);
  assert.deepStrictEqual(art.at(56 / 198, 56 / 112), [255, 255, 255, 255], 'the white circle inside the badge stays');
  assert.strictEqual(art.at(0.5, 0.5)[3], 255);
});

// POD-1014: a club crest uploaded as EPS printed with its white stripe as the black of the hoodie. Ghostscript
// keeps the empty page around a logo as white with no opacity, and that was taken for a white artboard: the
// clearing ran from it into the crest's own white rim (open at the top of the shield) and on into the stripe.
test('an EPS logo on a transparent page keeps its white, also where the white touches the outline', async () => {
  // A crest (no white page behind it): gold stars above and below (the lower row wider than the shield, so the
  // drawing's edges are nearly all empty page), a shield with black bands, a white rim between the bands and the
  // red panel (open at the top, like the crest's), a white stripe across the panel from rim to rim, a black shape
  // on the panel and a white dot the red encloses.
  const crest = Buffer.from([
    '%!PS-Adobe-3.0 EPSF-3.0', '%%BoundingBox: 0 0 200 260', '%%HiResBoundingBox: 0 0 200 260', '%%EndComments',
    '0.85 0.65 0.15 setrgbcolor',
    ...[[60, 245], [100, 245], [140, 245], [10, 20], [55, 12], [100, 10], [145, 12], [190, 20]].map(([x, y]) => `newpath ${x} ${y} 10 0 360 arc fill`),
    '0 0 0 setrgbcolor 20 50 10 180 rectfill 170 50 10 180 rectfill 20 40 160 10 rectfill',
    '1 1 1 setrgbcolor 30 50 10 180 rectfill 160 50 10 180 rectfill',
    '0.9 0.1 0.15 setrgbcolor 40 50 120 180 rectfill',
    '1 1 1 setrgbcolor newpath 30 100 moveto 170 140 lineto 170 180 lineto 30 140 lineto closepath fill',
    '0 0 0 setrgbcolor 100 70 20 20 rectfill',
    '1 1 1 setrgbcolor newpath 100 210 8 0 360 arc fill',
    'showpage', '%%EOF', '',
  ].join('\n'));
  const out = await convert(crest);
  // The drawing is the box around what is painted: x 0 to 200, y 0 to 255 (the upper stars' tops).
  assert.ok(out.height >= 2990 && out.height <= 3000 && Math.abs(out.width / out.height - 200 / 255) < 0.01, `${out.width}x${out.height}`);
  const px = (x, y) => out.at(x / 200, (255 - y) / 255);
  const WHITE = [255, 255, 255, 255];
  assert.deepStrictEqual(px(70, 130), WHITE, 'the white stripe (left) stays white');
  assert.deepStrictEqual(px(130, 150), WHITE, 'the white stripe (right) stays white');
  assert.deepStrictEqual(px(35, 190), WHITE, 'the white rim, open at the top, stays white');
  assert.deepStrictEqual(px(165, 80), WHITE, 'the other white rim stays white');
  assert.deepStrictEqual(px(100, 210), WHITE, 'the white dot inside the red stays white');
  assert.ok(px(70, 80)[3] === 255 && px(70, 80)[0] > 200 && px(70, 80)[1] < 60, `the red panel: ${px(70, 80)}`);
  assert.deepStrictEqual(px(110, 80), [0, 0, 0, 255], 'the black shape');
  assert.strictEqual(px(25, 245)[3], 0, 'transparent beside the stars');
  assert.strictEqual(px(80, 245)[3], 0, 'transparent between the stars');
  assert.strictEqual(px(80, 236)[3], 0, 'transparent above the shield');
  assert.strictEqual(px(10, 150)[3], 0, 'transparent beside the shield');
  // A white round badge with a blue middle, alone on its page: the white is the logo's, not a page.
  const badge = await convert(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n%%EndComments\n1 1 1 setrgbcolor 50 50 50 0 360 arc fill 0 0 1 setrgbcolor 50 50 30 0 360 arc fill\nshowpage\n%%EOF\n'));
  assert.deepStrictEqual(badge.at(0.5, 0.1), WHITE, 'the white ring stays');
  assert.deepStrictEqual(badge.at(0.5, 0.5), [0, 0, 255, 255], 'the blue middle');
  assert.strictEqual(badge.at(0.02, 0.02)[3], 0, 'transparent outside the ring');
});

test('a photo saved as a PDF is not blown up: it keeps the size it always had', async () => {
  // A 600 x 340 JPEG placed 7 cm wide on A4 (as Word or a phone's "print to PDF" makes it), with and without a white page.
  const jpg = await sharp({ create: { width: 600, height: 340, channels: 3, background: '#1d4ed8' } }).jpeg().toBuffer();
  for (const white of [false, true]) {
    const out = await convert(await pdf(A4, (d) => { if (white) d.rect(0, 0, A4[0], A4[1]).fill('#ffffff'); d.image(jpg, 7 * cm, 10 * cm, { width: 7 * cm }); }));
    assert.ok(out.width >= 690 && out.width <= 720, `the page fitted into 3000 px, as before: ${out.width}x${out.height}`);
  }
  // A vector logo with a small picture beside it is still a vector logo.
  const mixed = await convert(await pdf(A4, (d) => { logo(d, 7, 10, 7); d.image(jpg, 14.2 * cm, 10 * cm, { width: 1 * cm }); }));
  assert.ok(mixed.width >= 2990, `${mixed.width}x${mixed.height}`);
});

test('pages that are turned, cropped or huge, and tiny logos, stay safe', async () => {
  // A hand-made PDF: a red 100 x 50 pt box with a blue square in its top-left corner.
  const raw = (attrs, content) => {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R ${attrs} /Contents 4 0 R /Resources << >> >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let s = '%PDF-1.6\n';
    const offs = objs.map((o, i) => { const at = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const x = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    return Buffer.from(s, 'latin1');
  };
  const mark = '1 0 0 rg 200 400 100 50 re f 0 0 1 rg 200 430 20 20 re f';
  // Turned a quarter (/Rotate 90): drawn as a viewer shows it, standing up, the blue square at the top right.
  const turned = await convert(raw('/MediaBox [0 0 595 842] /Rotate 90', mark));
  assert.ok(turned.height >= 2990 && turned.height <= 3000 && Math.abs(turned.width / turned.height - 0.5) < 0.01, `${turned.width}x${turned.height}`);
  assert.deepStrictEqual(turned.at(0.9, 0.05).slice(0, 3), [0, 0, 255]);
  assert.deepStrictEqual(turned.at(0.2, 0.5).slice(0, 3), [255, 0, 0]);
  // Only what the CropBox shows (not the black square outside it).
  const cropped = await convert(raw('/MediaBox [0 0 595 842] /CropBox [150 350 450 600]', `${mark} 0 g 20 20 30 30 re f`));
  assert.ok(cropped.width >= 2990 && cropped.width <= 3000 && Math.abs(cropped.height / cropped.width - 0.5) < 0.01, `${cropped.width}x${cropped.height}`);
  // A 2 x 2 pt dot in the corner of a 200 x 200 inch page with a white page behind it: drawn no finer than
  // the page allows (the whole page at most 500,000 pixels across: about 70 px), and without the page.
  const huge = await convert(raw('/MediaBox [0 0 14400 14400]', '1 g 0 0 14400 14400 re f 0 0 1 rg 14000 14000 2 2 re f'));
  assert.ok(huge.width >= 60 && huge.width <= 80 && huge.width === huge.height, `${huge.width}x${huge.height}`);
  assert.strictEqual(huge.at(0.5, 0.5)[2], 255, 'the blue dot');
  // A 2 mm dot alone on A4: no finer than 12000 DPI (about 1000 px), not 3000 px of nothing.
  const dot = await convert(await pdf(A4, (d) => d.circle(300, 400, 3).fill('#000000')));
  assert.ok(dot.width >= 990 && dot.width <= 1010, `${dot.width}x${dot.height}`);
  // Nothing drawn: still "empty".
  const empty = await fetch(`${base}/api/artwork`, { method: 'POST', headers: { 'x-max-px': '3000' }, body: await pdf(A4, () => {}) });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual((await empty.json()).code, 'artworkEmpty');
});

test('a 20-page PDF: the artwork is its first page; its booklet pages stay whole pages', async () => {
  const many = await pdf(A4, (d) => { for (let i = 0; i < 20; i++) { if (i) d.addPage(); logo(d, 2 + (i % 5), 3 + i, 7); } });
  const first = await convert(many);
  assert.ok(first.width >= 2990 && Math.abs(first.width / first.height - 200 / 113) < 0.01, `${first.width}x${first.height}`);
  const r = await fetch(`${base}/api/artwork/pages`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-max-pages': '32' }, body: many });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.strictEqual(body.pages.length, 20);
  const meta = await sharp(Buffer.from(body.pages[19].split(',')[1], 'base64')).metadata();
  assert.ok(Math.abs(meta.width / meta.height - A4[0] / A4[1]) < 0.01 && meta.width > 1000, `the whole page: ${meta.width}x${meta.height}`);
});

// QA 25 Nov (.ai / .eps sweep): a white-only logo that fills its box (a white panel with see-through letters, for
// dark garments) was taken for a white artboard: the panel was cleared and only the white insides of its letters
// were left. With nothing but white painted, the white is the design.
test('a white panel with see-through letters keeps its white (nothing else is painted, so it is no artboard)', async () => {
  const eps = Buffer.from([
    '%!PS-Adobe-3.0 EPSF-3.0', '%%BoundingBox: 0 0 300 100', '%%EndComments',
    '1 1 1 setrgbcolor newpath 0 0 moveto 300 0 lineto 300 100 lineto 0 100 lineto closepath',
    '50 50 moveto 50 80 lineto 120 80 lineto 120 50 lineto closepath', // a see-through window
    '180 50 moveto 180 80 lineto 250 80 lineto 250 50 lineto closepath 210 58 moveto 210 72 lineto 220 72 lineto 220 58 lineto closepath', // a window with a white island
    'eofill showpage', '%%EOF', '',
  ].join('\n'));
  const out = await convert(eps);
  assert.ok(out.width >= 2990 && Math.abs(out.width / out.height - 3) < 0.01, `the whole panel: ${out.width}x${out.height}`);
  const px = (x, y) => out.at(x / 300, (100 - y) / 100);
  assert.deepStrictEqual(px(20, 20), [255, 255, 255, 255], 'the white panel stays');
  assert.deepStrictEqual(px(280, 90), [255, 255, 255, 255], 'up to its edges');
  assert.strictEqual(px(85, 65)[3], 0, 'the window is see-through');
  assert.strictEqual(px(190, 65)[3], 0, 'the other window too');
  assert.deepStrictEqual(px(215, 65), [255, 255, 255, 255], 'the white island inside it stays');
  // A white page behind a coloured logo is still taken away.
  const art = await convert(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 300 100\n%%EndComments\n1 1 1 setrgbcolor 0 0 300 100 rectfill 0 0 1 setrgbcolor 100 30 100 40 rectfill\nshowpage\n%%EOF\n'));
  assert.ok(Math.abs(art.width / art.height - 2.5) < 0.02, `only the blue box: ${art.width}x${art.height}`);
});

// QA 25 Nov: an Illustrator file saved with "Create PDF Compatible File" off holds only Illustrator's notice page;
// the shop put that page of text on the product as the customer's design.
test('an .ai saved without PDF content is refused with the "save it as PDF compatible" message', async () => {
  const zlib = require('zlib');
  const aiPdf = (content, { illustrator = true } = {}) => {
    const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /T1_0 5 0 R >> >>${illustrator ? ' /PieceInfo << /Illustrator << /LastModified (D:20201012) /Private 6 0 R >> >>' : ''} >>`,
      null, // the page's content, packed
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /ContainerVersion 12 /CreatorVersion 24 /RoundtripVersion 24 >>',
    ];
    const chunks = [Buffer.from('%PDF-1.6\n', 'latin1')];
    const size = () => chunks.reduce((a, c) => a + c.length, 0);
    const offs = objs.map((o, i) => {
      const at = size();
      if (o) chunks.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
      else chunks.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1'));
      return at;
    });
    const x = size();
    chunks.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  };
  // As Illustrator writes it: kerned pieces (TJ), here part of a word as hex.
  const notice = 'BT /T1_0 12 Tf 72 720 Td [(This is an Adobe\\256 Illustr)18(ator\\256 File that w)4(as)]TJ 0 -15 Td [(sa)8(v)8(ed without PDF Con)<74656e74>50(.)]TJ 0 -15 Td (To Place or open this file in other) Tj ET';
  const r = await fetch(`${base}/api/artwork`, { method: 'POST', headers: { 'x-max-px': '3000', 'x-lang': 'en' }, body: aiPdf(notice) });
  assert.strictEqual(r.status, 400);
  const body = await r.json();
  assert.strictEqual(body.code, 'artworkBad');
  assert.match(body.error, /PDF compatible/);
  // Illustrator artwork with words on it is drawn as usual, and so is the notice's text in a file that isn't Illustrator's.
  const words = await convert(aiPdf('1 0 0 rg 100 600 200 100 re f BT /T1_0 24 Tf 110 640 Td (PDF Content) Tj ET'));
  assert.ok(words.width >= 2990, `${words.width}x${words.height}`);
  assert.ok((await convert(aiPdf(notice, { illustrator: false }))).width > 1000);
});

test('PostScript with a byte-order mark, a Ctrl-D, a PJL header or a comment line before %!PS is read (as viewers read it)', async () => {
  const eps = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n%%EndComments\n0 0.5 0 setrgbcolor 0 0 200 100 rectfill\nshowpage\n%%EOF\n';
  for (const [name, junk] of [['byte-order mark', '\xef\xbb\xbf'], ['Ctrl-D', '\x04'], ['comment line (ps2ai)', '%%Note: Load Postscript file to be converted now\n'], ['PJL header', '\x1b%-12345X@PJL JOB\r\n@PJL ENTER LANGUAGE = POSTSCRIPT\r\n']]) {
    const out = await convert(Buffer.from(junk + eps, 'latin1'));
    assert.ok(out.width >= 2990 && Math.abs(out.width / out.height - 2) < 0.01, `${name}: ${out.width}x${out.height}`);
    const [r, g, b, a] = out.at(0.5, 0.5);
    assert.ok(r === 0 && Math.abs(g - 128) <= 1 && b === 0 && a === 255, `${name}: the green box (${[r, g, b, a]})`);
  }
  // Anything else before it is still not a file the shop reads.
  const r = await fetch(`${base}/api/artwork`, { method: 'POST', body: Buffer.from(`<html>\n${eps}`) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).code, 'artworkType');
});

test('several customers uploading at the same moment all get their artwork (the extra ones wait their turn)', async () => {
  const eps = (c) => Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n%%EndComments\n${c} setrgbcolor newpath 50 50 40 0 360 arc fill\nshowpage\n%%EOF\n`);
  const colours = ['1 0 0', '0 1 0', '0 0 1', '1 1 0', '0 1 1'];
  const answers = await Promise.all(colours.map((c) => fetch(`${base}/api/artwork`, { method: 'POST', headers: { 'x-max-px': '800' }, body: eps(c) })));
  assert.deepStrictEqual(answers.map((r) => r.status), colours.map(() => 200), 'five at once: none told "too many tries"');
  for (let i = 0; i < colours.length; i++) {
    const { data, info } = await sharp(Buffer.from(await answers[i].arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
    assert.deepStrictEqual([...data.subarray(mid, mid + 3)], colours[i].split(' ').map((v) => Number(v) * 255), `upload ${i + 1} got its own picture`);
  }
});

test('the converter says how many artboards a PDF-based file has, and when a PDF needs its password', async () => {
  const artwork = require('../src/artwork');
  const three = await pdf([300, 300], (d) => { d.circle(150, 150, 100).fill('#d62828'); d.addPage({ size: [300, 300], margin: 0 }); d.rect(50, 50, 200, 200).fill('#1d4ed8'); d.addPage({ size: [300, 300], margin: 0 }); d.rect(50, 50, 20, 20).fill('#000'); });
  assert.strictEqual((await artwork.convertArtwork(three, { px: 600 })).pages, 3);
  assert.strictEqual((await artwork.convertArtwork(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n%%EndComments\n0 0 10 10 rectfill showpage\n'), { px: 600 })).pages, null);
  const locked = await new Promise((resolve) => {
    const d = new PDFDocument({ size: [200, 100], margin: 0, userPassword: 'open-me', ownerPassword: 'owner', pdfVersion: '1.7' });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.rect(10, 10, 100, 50).fill('#cc0000');
    d.end();
  });
  await assert.rejects(artwork.convertArtwork(locked, { px: 600 }), (e) => e.reason === 'locked');
  const r = await fetch(`${base}/api/artwork`, { method: 'POST', body: locked });
  assert.strictEqual(r.status, 400, 'still refused by the shop (with its general message until the route says "locked")');
});
