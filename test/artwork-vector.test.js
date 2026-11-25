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
