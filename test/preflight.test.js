'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { preflight, mergeClientChecks } = require('../src/preflight');
const { getProduct } = require('../src/products');

const tshirt = getProduct('tshirt');
const bizcards = getProduct('bizcards');

/** Transparent PNG of w x h with SVG drawn on top. */
async function png(w, h, svgBody = '', { background = { r: 0, g: 0, b: 0, alpha: 0 } } = {}) {
  const img = sharp({ create: { width: w, height: h, channels: 4, background } });
  if (!svgBody) return img.png().toBuffer();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgBody}</svg>`);
  return img.composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
}

function sideFor(product, { widthIn, heightIn, dpi = 300, id = 'front' }) {
  const ps = product.sides.find((s) => s.id === id);
  const bleedIn = ps.bleedIn || 0;
  return { id, widthIn, heightIn, bleedIn, widthPx: Math.round((widthIn + 2 * bleedIn) * dpi), heightPx: Math.round((heightIn + 2 * bleedIn) * dpi), dpi };
}

function designFor(product, side, extra = {}) {
  return { id: 'd1', productId: product.id, process: product.process, kind: 'product', sides: [side], ...extra };
}

const run = (design, product, files) => preflight(design, {
  product,
  readFile: async (name) => {
    if (!(name in files)) throw new Error('ENOENT');
    return files[name];
  },
});
const ids = (r, level) => r.checks.filter((c) => !level || c.level === level).map((c) => c.id);

// A crisp logo in the middle of a 10 x 12 in shirt print.
const logo = (w, h) => `<rect x="${w * 0.25}" y="${h * 0.2}" width="${w * 0.5}" height="${h * 0.3}" fill="#c00"/><circle cx="${w / 2}" cy="${h * 0.7}" r="${w * 0.15}" fill="#036"/>`;

test('a good 300 DPI shirt print passes', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12 });
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx, logo(side.widthPx, side.heightPx)) });
  assert.deepStrictEqual(r, { status: 'pass', checks: [] });
});

test('90 DPI fails resolution, 120 DPI warns', async () => {
  for (const [dpi, level, minDpi] of [[90, 'fail', 100], [120, 'warn', 150]]) {
    const side = sideFor(tshirt, { widthIn: 10, heightIn: 12, dpi });
    const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx, logo(side.widthPx, side.heightPx)) });
    const c = r.checks.find((x) => x.id === 'resolution');
    assert.ok(c, `resolution check at ${dpi}`);
    assert.strictEqual(c.level, level);
    assert.strictEqual(c.side, 'front');
    assert.deepStrictEqual(c.params, { dpi, minDpi });
    assert.strictEqual(r.status, level);
  }
});

test('a print file of the wrong pixel size fails exportSize', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12 });
  // Recorded 3000 x 3600, but the file is square.
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(3000, 3000, logo(3000, 3000)) });
  const c = r.checks.find((x) => x.id === 'exportSize');
  assert.strictEqual(c.level, 'fail');
  assert.deepStrictEqual(c.params, { widthPx: 3000, heightPx: 3000, expectedW: 3000, expectedH: 3600 });
  assert.strictEqual(r.status, 'fail');
  // Same pixels recorded, but the physical shape is wrong (not 10 x 12).
  const r2 = await run(designFor(tshirt, { ...side, heightPx: 3000 }), tshirt, { 'front-print.png': await png(3000, 3000, logo(3000, 3000)) });
  assert.ok(ids(r2, 'fail').includes('exportSize'));
});

test('a fully transparent print fails empty', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12 });
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx) });
  assert.deepStrictEqual(ids(r), ['empty']);
  assert.strictEqual(r.status, 'fail');
});

test('business card: text 1 mm from the trim warns, a full-bleed background does not', async () => {
  const side = sideFor(bizcards, { widthIn: 3.5, heightIn: 2 }); // 1098 x 648 px, bleed 24 px, safe line 60 px
  const W = side.widthPx;
  const H = side.heightPx;
  const mm = 300 / 25.4;
  const textX = Math.round(24 + 1 * mm);
  const text = `<rect x="${textX}" y="300" width="160" height="30" fill="#111"/><rect x="400" y="250" width="300" height="140" fill="#333"/>`;
  const r = await run(designFor(bizcards, side), bizcards, { 'front-print.png': await png(W, H, text) });
  const c = r.checks.find((x) => x.id === 'outsideSafe');
  assert.ok(c, 'outsideSafe reported');
  assert.strictEqual(c.level, 'warn');
  assert.ok(Math.abs(c.params.mm - 1) <= 0.2, `about 1 mm, got ${c.params.mm}`);
  assert.strictEqual(r.status, 'warn');

  // Full-bleed background with a stripe running off the edge and text safely inside.
  const bg = `<rect width="${W}" height="${H}" fill="#0a3"/><rect x="0" y="40" width="${W}" height="20" fill="#fff"/><rect x="300" y="300" width="300" height="40" fill="#fff"/>`;
  const r2 = await run(designFor(bizcards, side), bizcards, { 'front-print.png': await png(W, H, bg) });
  assert.deepStrictEqual(r2, { status: 'pass', checks: [] });

  // A logo (not a background) bleeding off the right edge is deliberate too.
  const off = `<circle cx="${W}" cy="${H / 2}" r="120" fill="#a00"/><rect x="300" y="300" width="300" height="40" fill="#111"/>`;
  const r3 = await run(designFor(bizcards, side), bizcards, { 'front-print.png': await png(W, H, off) });
  assert.deepStrictEqual(ids(r3), []);
});

test('shirt: artwork touching the edge of the print file warns outsideSafe', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12, dpi: 150 });
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx, `<rect x="0" y="300" width="400" height="200" fill="#000"/>`) });
  const c = r.checks.find((x) => x.id === 'outsideSafe');
  assert.deepStrictEqual(c, { id: 'outsideSafe', level: 'warn', side: 'front', params: { mm: 0 } });
});

test('a soft glow warns semiTransparent on a DTF/DTG shirt but not on paper', async () => {
  const glow = (w, h) => `<defs><radialGradient id="g"><stop offset="0" stop-color="#f80" stop-opacity="0.85"/><stop offset="1" stop-color="#f80" stop-opacity="0"/></radialGradient></defs>`
    + `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.35}" fill="url(#g)"/><rect x="${w * 0.4}" y="${h * 0.45}" width="${w * 0.2}" height="${h * 0.1}" fill="#000"/>`;
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12, dpi: 150 });
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx, glow(side.widthPx, side.heightPx)) });
  const c = r.checks.find((x) => x.id === 'semiTransparent');
  assert.ok(c && c.level === 'warn', 'semiTransparent warn');
  assert.ok(c.params.percent > 3);

  const poster = getProduct('poster');
  const ps = sideFor(poster, { widthIn: 8, heightIn: 10, dpi: 150 });
  const r2 = await run(designFor(poster, ps), poster, { 'front-print.png': await png(ps.widthPx, ps.heightPx, glow(ps.widthPx, ps.heightPx)) });
  assert.ok(!ids(r2).includes('semiTransparent'));
});

test('crisp text and shapes do not count as semi-transparent (antialiased edges)', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12, dpi: 150 });
  // Text-like strokes (no fonts needed): thin diagonal lines, small dots and outlines, all antialiased.
  let body = '';
  for (let i = 0; i < 14; i++) {
    const y = 200 + i * 110;
    body += `<path d="M150 ${y} l40 -60 l40 60 m20 0 l30 -60 m30 0 l-25 60" stroke="#000" stroke-width="7" fill="none"/>`;
    for (let k = 0; k < 20; k++) body += `<circle cx="${320 + k * 50}" cy="${y - 25}" r="${6 + (k % 4)}" fill="#000"/>`;
    body += `<ellipse cx="1350" cy="${y - 30}" rx="40" ry="28" stroke="#000" stroke-width="5" fill="none" transform="rotate(${i * 13} 1350 ${y - 30})"/>`;
  }
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': await png(side.widthPx, side.heightPx, body) });
  assert.deepStrictEqual(r, { status: 'pass', checks: [] });
});

test('missing, corrupt or truncated files fail exportSize without throwing', async () => {
  const side = sideFor(tshirt, { widthIn: 10, heightIn: 12 });
  const good = await png(side.widthPx, side.heightPx, logo(side.widthPx, side.heightPx));
  const cases = {
    missing: {},
    garbage: { 'front-print.png': Buffer.from('definitely not a png file, just some text here') },
    truncated: { 'front-print.png': good.subarray(0, 200) },
  };
  for (const [name, files] of Object.entries(cases)) {
    const r = await run(designFor(tshirt, side), tshirt, files);
    const c = r.checks.find((x) => x.id === 'exportSize');
    assert.ok(c && c.level === 'fail' && typeof c.params.error === 'string', name);
    assert.strictEqual(r.status, 'fail', name);
  }
  // readFile returning nonsense
  const r = await preflight(designFor(tshirt, side), { product: tshirt, readFile: () => null });
  assert.strictEqual(r.status, 'fail');
});

test('gang sheets and books pass with an info check only', async () => {
  for (const kind of ['gangsheet', 'book']) {
    const r = await preflight({ id: 'x', kind, sides: [{ id: 'front' }] }, { readFile: () => { throw new Error('should not read'); }, product: null });
    assert.strictEqual(r.status, 'pass');
    assert.ok(r.checks.length === 1 && r.checks[0].level === 'info');
  }
});

test('mergeClientChecks keeps valid editor checks, drops unknown ids and oversized params', () => {
  const server = { status: 'pass', checks: [] };
  const merged = mergeClientChecks(server, [
    { id: 'fontFallback', level: 'warn', side: 'front', params: { fonts: ['Cairo', 'Amiri'] } },
    { id: 'tinyText', level: 'warn', side: 'front', params: { name: 'Small print', pt: 4.5 } },
    { id: 'lowResImage', level: 'fail', side: 'back', params: { name: 'photo.jpg', dpi: 72 } },
    { id: 'fileType', level: 'warn', params: { type: 'eps' } },
    { id: 'hackTheShop', level: 'warn', params: {} },
    { id: 'tinyText', level: 'warn', params: { name: 'x'.repeat(101), pt: 3 } },
    { id: 'tinyText', level: 'warn', params: { nested: { a: 1 } } },
    { id: 'tinyText', level: 'critical', params: {} },
    { id: 'outsideSafe', level: 'warn', side: '<script>', params: { mm: 1 } },
    null,
    'nope',
  ]);
  assert.deepStrictEqual(merged.checks.map((c) => c.id), ['fontFallback', 'tinyText', 'lowResImage', 'fileType']);
  assert.strictEqual(merged.checks.find((c) => c.id === 'fileType').level, 'info');
  assert.strictEqual(merged.status, 'fail');
  assert.deepStrictEqual(server, { status: 'pass', checks: [] }, 'input not changed');

  const many = Array.from({ length: 80 }, (_, i) => ({ id: 'tinyText', level: 'warn', params: { name: `t${i}`, pt: 4 } }));
  const capped = mergeClientChecks({ status: 'pass', checks: [] }, many);
  assert.strictEqual(capped.checks.length, 50);
  assert.strictEqual(capped.status, 'warn');
  assert.strictEqual(mergeClientChecks({ status: 'warn', checks: [{ id: 'resolution', level: 'warn', side: 'front', params: { dpi: 120, minDpi: 150 } }] }, 'bad').status, 'warn');
});

test('a 3600 x 4800 print is analysed in under 1.5 s', async () => {
  const side = sideFor(tshirt, { widthIn: 12, heightIn: 16 });
  assert.strictEqual(side.widthPx, 3600);
  const file = await png(3600, 4800, logo(3600, 4800) + '<rect x="200" y="200" width="800" height="300" fill="#08f" fill-opacity="0.5"/>');
  const t0 = process.hrtime.bigint();
  const r = await run(designFor(tshirt, side), tshirt, { 'front-print.png': file });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  assert.notStrictEqual(r.status, 'fail');
});
