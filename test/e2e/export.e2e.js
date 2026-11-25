'use strict';

/**
 * Browser tests for the design editor's PRINT FILES (not just its warnings).
 *
 * Run:  node --test test/e2e/export.e2e.js
 * (needs Playwright + Chromium; the global install is found via `npm root -g`).
 *
 * The file starts its own server on a free port with a temporary DATA_DIR and
 * drives /editor in headless Chromium. It checks:
 *   1. print PNG size for every product and every size that changes the print
 *   2. image resolution warnings at the final print size
 *   3. bundled fonts really render (no fallback) and Arabic is shaped / right-to-left
 *   4. transparency (garments) and full opacity (full-bleed paper)
 *   5. accepted / refused upload types (PNG, JPG, WebP, SVG, PDF, AI / .txt, .exe)
 *   6. the print file stored on the server is the one the browser exported
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { PRODUCTS } = require('../../src/products');
const { loadPlaywright, startServer, newContext, openEditor, installPageHelpers, expectedPrint, decodePng } = require('./helpers');

let srv;
let browser;
const files = {};

/** A "photo": smooth gradient plus noise (so JPEG/WebP can't collapse it). */
async function photo(size, format = 'jpeg') {
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const n = ((x * 7919 + y * 104729) % 61) - 30;
      raw[i] = Math.max(0, Math.min(255, Math.round((255 * x) / size) + n));
      raw[i + 1] = Math.max(0, Math.min(255, Math.round((255 * y) / size) + n));
      raw[i + 2] = 140 + (n >> 1);
    }
  }
  const img = sharp(raw, { raw: { width: size, height: size, channels: 3 } });
  return format === 'png' ? img.png().toBuffer() : format === 'webp' ? img.webp({ quality: 85 }).toBuffer() : img.jpeg({ quality: 88 }).toBuffer();
}
function pdf() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: [200, 200], margin: 0 });
    const parts = [];
    doc.on('data', (c) => parts.push(c));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.circle(100, 100, 80).fill('#e03131');
    doc.rect(70, 70, 60, 60).fill('#1c7ed6');
    doc.end();
  });
}

test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  files.photo600 = await photo(600);
  files.photo3000 = await photo(3000);
  files.png = await photo(400, 'png');
  files.webp = await photo(400, 'webp');
  files.jpg = await photo(400, 'jpeg');
  files.svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><circle cx="200" cy="200" r="180" fill="#2f9e44"/><rect x="120" y="120" width="160" height="160" fill="#f08c00"/></svg>');
  files.pdf = await pdf();
  // A Windows executable: "MZ" header, a DOS stub and some padding.
  files.exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'latin1'), Buffer.alloc(64), Buffer.from('This program cannot be run in DOS mode.\r\r\n$'), Buffer.alloc(2048, 0x90)]);
});

test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

// ---------- small page drivers ----------
async function switchProduct(page, id) {
  await page.evaluate((pid) => {
    const sel = document.getElementById('product-select');
    if (window.__editor.st.product.id === pid) return;
    sel.value = pid;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.waitForFunction((pid) => window.__editor.st.product.id === pid, id, { timeout: 15000 });
}
async function switchSize(page, id) {
  await page.evaluate((sid) => {
    if (window.__editor.st.sizeId === sid) return;
    document.querySelector(`#sizes [data-size="${CSS.escape(sid)}"]`).click();
  }, id);
  await page.waitForFunction((sid) => window.__editor.st.sizeId === sid, id, { timeout: 15000 });
}
/** Upload a file through the editor's own file input; resolves to { added, error } once it is placed or refused. */
async function upload(page, name, mimeType, buffer) {
  const before = await page.evaluate(() => {
    document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove());
    return window.__editor.canvas.getObjects().length;
  });
  await page.setInputFiles('#file-input', { name, mimeType, buffer });
  // A placed picture can come with an error-styled toast too (the low-resolution warning), so the object wins.
  const handle = await page.waitForFunction((n) => {
    const objs = window.__editor.canvas.getObjects();
    if (objs.length > n) {
      const o = objs[objs.length - 1];
      return { added: true, type: o.type, w: o.width, h: o.height };
    }
    const err = document.querySelector('#toast-root .toast.error');
    if (err && document.getElementById('busy').hidden) return { added: false, error: err.textContent };
    return false;
  }, before, { timeout: 40000, polling: 100 });
  return handle.jsonValue();
}
const clearCanvas = (page) => page.evaluate(() => {
  const c = window.__editor.canvas;
  c.discardActiveObject();
  c.remove(...c.getObjects());
  c.requestRenderAll();
});

// =====================================================================
// 1. Print file pixel size, aspect ratio and DPI for every product / size
// =====================================================================
test('1. print PNG size matches the physical print size (every product, every print-changing size)', { timeout: 120000 }, async (t) => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt');
  const results = [];
  try {
    for (const product of PRODUCTS.filter((p) => !p.kind)) {
      // One size per distinct printScale; garments (print box resized per size) also their biggest size.
      const seen = new Set();
      const sizes = product.sizes.filter((z) => {
        const k = z.printScale || 1;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (product.photoChestCm && !sizes.includes(product.sizes[product.sizes.length - 1])) sizes.push(product.sizes[product.sizes.length - 1]);
      if (product.pattern) {
        // Fresh page so the tile size is the product's default (switching products keeps the previous tile size).
        await page.goto(`${srv.base}/editor?product=${product.id}`);
        await page.waitForFunction((pid) => window.__editor && window.__editor.st.product.id === pid, product.id);
        await page.evaluate(installPageHelpers);
      } else {
        await switchProduct(page, product.id);
      }
      for (const size of sizes) {
        await switchSize(page, size.id);
        for (const side of product.sides) {
          const got = await page.evaluate(async (sid) => ({ ...(await window.__t.pngSize(await window.__editor.exportPrint({ id: sid }))), tileCm: window.__editor.st.pattern && window.__editor.st.pattern.tileCm }), side.id);
          results.push({ product: product.id, garment: ['dtg', 'dtf'].includes(product.process), size: size.id, side: side.id, got, exp: expectedPrint(product, side, size.id, got.tileCm) });
        }
      }
    }
  } finally {
    await ctx.close();
  }
  assert.ok(results.length > 60, `exported ${results.length} print files`);

  await t.test('every export is a PNG', () => {
    const bad = results.filter((r) => !r.got.png || r.got.type !== 'image/png');
    assert.deepStrictEqual(bad.map((r) => `${r.product}/${r.size}/${r.side}`), []);
  });

  const fmt = (r) => `${r.product}/${r.size}/${r.side}${r.got.tileCm ? ` (tile ${r.got.tileCm} cm)` : ''}: got ${r.got.width}x${r.got.height}, expected ${r.exp.width}x${r.exp.height} (${r.exp.wb.toFixed(3)}x${r.exp.hb.toFixed(3)} in @ ${r.exp.dpi.toFixed(2)} DPI)`;
  await t.test('pixel width/height within max(1 px, 0.1%) of the physical print size x DPI', () => {
    const off = (got, exp) => Math.abs(got - exp) > Math.max(1, exp * 0.001);
    const bad = results.filter((r) => off(r.got.width, r.exp.width) || off(r.got.height, r.exp.height)).map(fmt);
    assert.deepStrictEqual(bad, [], `print PNG is not the physical size of the print (fabric patterns: the server records the tile as tileCm wide, the editor sizes it as if printWidthIn (30 cm) were pattern.tile cm):\n${bad.join('\n')}`);
  });

  // Garment sizes scale the print box, rounded to 0.1 mockup units: a few pixels (under 0.1%) either way.
  await t.test('pixel width/height == round((printWidthIn x printScale + 2 x bleed) x DPI) exactly (garments within 3 px)', () => {
    const off = (r, got, exp) => (r.garment ? Math.abs(got - exp) > 3 : got !== exp);
    const bad = results
      .filter((r) => off(r, r.got.width, r.exp.width) || off(r, r.got.height, r.exp.height))
      .map(fmt);
    assert.deepStrictEqual(bad, [], `print PNG is not the exact size of the print (editor.js exportPrint: Fabric's toCanvasElement truncates width*multiplier instead of rounding; garments: areaFor rounds the print box w/h separately):\n${bad.join('\n')}`);
  });

  await t.test('aspect ratio matches the physical print within 0.5%', () => {
    const bad = results
      .filter((r) => Math.abs(r.got.width / r.got.height / (r.exp.wb / r.exp.hb) - 1) > 0.005)
      .map((r) => `${r.product}/${r.size}/${r.side}: ${r.got.width}x${r.got.height} vs ${r.exp.wb.toFixed(3)}x${r.exp.hb.toFixed(3)} in`);
    assert.deepStrictEqual(bad, []);
  });

  // Big prints are seen from further away: the same size-based tiers as the server's checks
  // (150 DPI up to 24 in, 110 up to 48 in, 60 beyond), so no print file the editor makes is flagged.
  const { dpiLimits } = require('../../src/preflight');
  await t.test('effective DPI of every print file meets the resolution needed at its size', () => {
    const bad = results
      .map((r) => ({ ...r, dpi: Math.min(r.got.width / r.exp.wb, r.got.height / r.exp.hb), need: dpiLimits(Math.max(r.exp.wb, r.exp.hb)).warn }))
      .filter((r) => r.dpi < r.need - 0.5)
      .map((r) => `${r.product}/${r.size}/${r.side}: ${r.dpi.toFixed(1)} DPI (${r.got.width}x${r.got.height} px for ${r.exp.wb.toFixed(2)}x${r.exp.hb.toFixed(2)} in)`);
    assert.deepStrictEqual(bad, [], `print files below the resolution their size needs (capped by MAX_PRINT_PIXELS=16e6 / MAX_PRINT_SIDE=8000 in editor.js):\n${bad.join('\n')}`);
  });
});

// =====================================================================
// 2. Image resolution judged at the final print size
// =====================================================================
test('2. photo resolution is judged at the final print size (A4 / A3 certificate)', { timeout: 60000 }, async (t) => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'certificates');
  const product = PRODUCTS.find((p) => p.id === 'certificates');
  const side = product.sides[0];
  /** Scale the photo to cover the whole trim area, like a customer dragging its corners, and read the check list. */
  const fillAndCheck = () => page.evaluate(async () => {
    const ed = window.__editor;
    const o = ed.canvas.getObjects().find((x) => x.type === 'image');
    const a = ed.rects('front').trim;
    o.scale(Math.max(a.w / o.width, a.h / o.height));
    o.set({ left: a.x + a.w / 2, top: a.y + a.h / 2 });
    o.setCoords();
    ed.canvas.fire('object:scaling', { target: o });
    ed.canvas.fire('object:modified', { target: o });
    await new Promise((r) => setTimeout(r, 300));
    return {
      list: [...document.querySelectorAll('#check-list li')].map((li) => ({ cls: li.className, text: li.textContent })),
      widthUnits: o.width * o.scaleX,
      trimUnits: a.w,
      px: o.width,
    };
  });
  const dpiIn = (items) => {
    const it = items.find((i) => /DPI/.test(i.text));
    const m = it && /([\d.,]+)\s*DPI/.exec(it.text);
    return m ? { level: it.cls, dpi: Number(m[1].replace(/,/g, '')) } : null;
  };
  try {
    await t.test('600 x 600 photo filling an A4 certificate is reported as low resolution, with the right DPI', async () => {
      const up = await upload(page, 'small-photo.jpg', 'image/jpeg', files.photo600);
      assert.ok(up.added, `upload refused: ${up.error}`);
      const r = await fillAndCheck();
      const trueDpi = 600 / ((r.widthUnits / r.trimUnits) * expectedPrint(product, side, 'A4').widthIn);
      const found = dpiIn(r.list);
      assert.ok(found, `no resolution warning in the check list: ${JSON.stringify(r.list)}`);
      assert.match(found.level, /error/, `expected an error-level low resolution item: ${JSON.stringify(r.list)}`);
      assert.ok(Math.abs(found.dpi / trueDpi - 1) <= 0.05, `editor says ${found.dpi} DPI, true effective DPI is ${trueDpi.toFixed(1)}`);
    });
    await t.test('same photo on the A3 size: DPI drops with the bigger print', async () => {
      await switchSize(page, 'A3');
      const r = await fillAndCheck();
      const trueDpi = 600 / ((r.widthUnits / r.trimUnits) * expectedPrint(product, side, 'A3').widthIn);
      const found = dpiIn(r.list);
      assert.ok(found, `no resolution warning: ${JSON.stringify(r.list)}`);
      assert.ok(Math.abs(found.dpi / trueDpi - 1) <= 0.05, `editor says ${found.dpi} DPI on A3, true effective DPI is ${trueDpi.toFixed(1)}`);
      await switchSize(page, 'A4');
    });
    await t.test('3000 x 3000 photo at the same size passes the resolution check', async () => {
      await clearCanvas(page);
      const up = await upload(page, 'big-photo.jpg', 'image/jpeg', files.photo3000);
      assert.ok(up.added, `upload refused: ${up.error}`);
      assert.strictEqual(up.w, 3000, 'a 3000 px photo must not be downscaled on upload');
      const r = await fillAndCheck();
      const trueDpi = 3000 / ((r.widthUnits / r.trimUnits) * expectedPrint(product, side, 'A4').widthIn);
      assert.ok(trueDpi > 150, `sanity: true DPI ${trueDpi}`);
      assert.strictEqual(dpiIn(r.list), null, `unexpected resolution warning: ${JSON.stringify(r.list)}`);
    });
  } finally {
    await ctx.close();
  }
});

// =====================================================================
// 3. Fonts: real font (no fallback) and Arabic shaping in the print file
// =====================================================================
/*
 * Method:
 *  - Each text is added the way a customer does it (text preset button, then
 *    the font picker in the properties panel) and exported with exportPrint.
 *  - Reference: after document.fonts.load() + document.fonts.check() confirm the
 *    font is loaded, Fabric's measure cache is cleared and the text exported
 *    again. The two ink masks (alpha >= 128) must match (IoU >= 0.97, same box
 *    +-2 px). A third export in a missing font (forced fallback) must differ,
 *    which proves the comparison can see a fallback.
 *  - The same comparison runs after reopening the design (draft restored in a
 *    fresh page with nothing preloaded) to catch exports made before fonts load.
 *  - Arabic shaping: the export of "محمد" (four dual-joining letters, no dots)
 *    must be ONE connected glyph run (largest 8-connected component >= 90% of
 *    the ink) and must match the browser's own shaped rendering of the same
 *    string, font and pixel size (native canvas fillText, direction rtl) far
 *    better than the unjoined rendering (letters separated by ZWNJ, which the
 *    browser draws as isolated forms - also checked to fall apart into >= 3
 *    components). Right-to-left order: "محمد 2026" must match the native rtl
 *    rendering (number on the left) better than the ltr one.
 */
const FONT_CASES = [
  { font: 'Cairo', text: 'محمد', arabic: true },
  { font: 'Tajawal', text: 'محمد', arabic: true },
  { font: 'Amiri', text: 'محمد', arabic: true },
  { font: 'Lalezar', text: 'محمد', arabic: true },
  { font: 'El Messiri', text: 'محمد', arabic: true },
  { font: 'Cairo', text: 'محمد ABC', arabic: true, mixed: true },
  { font: 'Amiri', text: 'محمد ABC', arabic: true, mixed: true },
  { font: 'Cairo', text: 'Hello', arabic: false },
  { font: 'Montserrat', text: 'Hello', arabic: false },
  { font: 'Anton', text: 'Hello', arabic: false },
  { font: 'Pacifico', text: 'Hello', arabic: false },
];

/** In page: export the print with only `idx`-th text visible; returns ink box, mask and stats. */
function exportTextInPage(idx) {
  return (async () => {
    const ed = window.__editor;
    const T = window.__t;
    const texts = ed.canvas.getObjects().filter((o) => o.type === 'i-text' || o.type === 'text' || o.type === 'textbox');
    texts.forEach((o, i) => { o.visible = i === idx; });
    const blob = await ed.exportPrint({ id: ed.st.side });
    texts.forEach((o) => { o.visible = true; });
    const img = await T.decode(blob);
    const box = T.ink(img);
    return { img, box, mask: box.empty ? null : T.mask(img, box) };
  })();
}

test('3. fonts render in the print file without fallback, Arabic is joined and right-to-left', { timeout: 120000 }, async (t) => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'certificates');
  try {
    const results = [];
    for (const [idx, fc] of FONT_CASES.entries()) {
      // Add a heading with the preset button, type the text, pick the font in the font picker.
      const n = await page.evaluate(() => window.__editor.canvas.getObjects().length);
      await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
      await page.waitForFunction((k) => window.__editor.canvas.getObjects().length > k, n);
      await page.evaluate(({ text }) => {
        const ed = window.__editor;
        const o = ed.canvas.getObjects()[ed.canvas.getObjects().length - 1];
        ed.canvas.setActiveObject(o);
        o.set({ text, fontSize: 60, scaleX: 1, scaleY: 1 });
        ed.canvas.fire('text:changed', { target: o });
        ed.canvas.fire('selection:created', { target: o });
      }, fc);
      await page.waitForSelector(`[data-font="${fc.font}"]`, { state: 'attached', timeout: 10000 });
      await page.evaluate((font) => document.querySelector(`[data-font="${font}"]`).click(), fc.font);
      await page.waitForFunction((font) => window.__editor.canvas.getActiveObject() && window.__editor.canvas.getActiveObject().fontFamily === font, fc.font);
      const r = await page.evaluate(async ({ idx: i, fc: c, fnSrc }) => {
        const exportText = new Function(`return (${fnSrc})`)();
        const ed = window.__editor;
        const T = window.__t;
        const o = ed.canvas.getObjects().filter((x) => x.type === 'i-text')[i];
        const out = { direction: o.direction, family: o.fontFamily };
        // a) the export as the customer gets it
        const first = await exportText(i);
        out.firstBox = first.box;
        // b) after the font is confirmed loaded
        const spec = `${o.fontStyle || 'normal'} ${o.fontWeight || 'normal'} 40px "${c.font}"`;
        await document.fonts.load(spec, c.text);
        out.fontLoaded = document.fonts.check(spec, c.text);
        fabric.util.clearFabricFontCache(c.font);
        o.initDimensions();
        o.setCoords();
        const ref = await exportText(i);
        out.refBox = ref.box;
        out.iouRef = first.mask && ref.mask ? T.iou(first.mask, ref.mask) : 0;
        // c) forced fallback: proves the comparison would notice a missing font
        o.set('fontFamily', 'NoSuchFontAtAll');
        fabric.util.clearFabricFontCache('NoSuchFontAtAll');
        o.initDimensions();
        const fb = await exportText(i);
        out.iouFallback = ref.mask && fb.mask ? T.iou(ref.mask, fb.mask) : 0;
        out.fbBox = fb.box;
        o.set('fontFamily', c.font);
        o.initDimensions();
        o.setCoords();
        // d) the browser's own shaped rendering at the same pixel size
        const mult = first.img.width / ed.rects(ed.st.side).bleed.w;
        const px = o.fontSize * o.scaleY * mult;
        const native = (str, dir) => {
          const cv = document.createElement('canvas');
          cv.width = Math.ceil(px * (str.length + 4));
          cv.height = Math.ceil(px * 3);
          const g = cv.getContext('2d');
          g.font = `${o.fontStyle || 'normal'} ${o.fontWeight || 'normal'} ${px}px "${c.font}"`;
          g.direction = dir;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = '#000';
          g.fillText(str, cv.width / 2, cv.height / 2);
          const img = { width: cv.width, height: cv.height, data: g.getImageData(0, 0, cv.width, cv.height).data };
          const box = T.ink(img);
          return { box, mask: T.mask(img, box) };
        };
        const joined = native(c.text, c.arabic ? 'rtl' : 'ltr');
        out.nativeBox = joined.box;
        out.iouNative = T.iou(ref.mask, joined.mask);
        if (c.arabic) {
          const unjoined = native([...c.text].join('‌'), 'rtl');
          out.iouUnjoined = T.iou(ref.mask, unjoined.mask);
          const total = (m) => m.m.reduce((s, v) => s + v, 0);
          const comps = T.components(first.mask);
          out.mainShare = comps[0] / total(first.mask);
          const uComps = T.components(unjoined.mask);
          out.unjoinedBig = uComps.filter((s) => s / total(unjoined.mask) > 0.05).length;
          if (c.mixed) out.iouLtr = T.iou(ref.mask, native(c.text, 'ltr').mask);
        }
        return out;
      }, { idx, fc, fnSrc: exportTextInPage.toString() });
      results.push({ ...fc, ...r });
    }
    const label = (r) => `${r.font} "${r.text}"`;

    await t.test('text area in the print file is not empty', () => {
      const bad = results.filter((r) => r.firstBox.empty || r.firstBox.w < 40 || r.firstBox.h < 20).map((r) => `${label(r)}: ${JSON.stringify(r.firstBox)}`);
      assert.deepStrictEqual(bad, []);
    });
    await t.test('the font is the bundled one (document.fonts.check) and the export equals the export after the font is confirmed loaded', () => {
      const bad = results
        .filter((r) => !r.fontLoaded || r.iouRef < 0.97 || Math.abs(r.firstBox.w - r.refBox.w) > 2 || Math.abs(r.firstBox.h - r.refBox.h) > 2)
        .map((r) => `${label(r)}: loaded=${r.fontLoaded} IoU=${r.iouRef.toFixed(3)} box ${r.firstBox.w}x${r.firstBox.h} vs ${r.refBox.w}x${r.refBox.h}`);
      assert.deepStrictEqual(bad, []);
    });
    await t.test('(method check) a fallback font would have been detected', () => {
      const weak = results.filter((r) => r.iouFallback > 0.9).map((r) => `${label(r)}: fallback IoU ${r.iouFallback.toFixed(3)}`);
      assert.deepStrictEqual(weak, []);
    });
    await t.test('export matches the browser\'s own rendering of the same text (same glyphs)', () => {
      const bad = results.filter((r) => r.iouNative < 0.9).map((r) => `${label(r)}: IoU vs native ${r.iouNative.toFixed(3)} (export box ${r.refBox.w}x${r.refBox.h}, native ${r.nativeBox.w}x${r.nativeBox.h})`);
      assert.deepStrictEqual(bad, []);
    });
    await t.test('Arabic is shaped: one connected word, matches joined (not isolated) letter forms', () => {
      const ar = results.filter((r) => r.arabic && !r.mixed);
      assert.ok(ar.every((r) => r.direction === 'rtl'), `Arabic text not set to rtl: ${ar.map((r) => r.direction)}`);
      assert.ok(ar.every((r) => r.unjoinedBig >= 3), `(method check) isolated forms should fall apart: ${ar.map((r) => `${r.font}:${r.unjoinedBig}`)}`);
      const bad = ar
        .filter((r) => r.mainShare < 0.9 || r.iouNative < r.iouUnjoined + 0.1)
        .map((r) => `${label(r)}: main component ${(r.mainShare * 100).toFixed(1)}% of ink, IoU joined ${r.iouNative.toFixed(3)} vs isolated ${r.iouUnjoined.toFixed(3)}`);
      assert.deepStrictEqual(bad, []);
    });
    await t.test('mixed Arabic + Latin is laid out right-to-left', () => {
      const bad = results.filter((r) => r.mixed && !(r.iouNative > r.iouLtr + 0.05)).map((r) => `${label(r)}: IoU rtl ${r.iouNative.toFixed(3)} vs ltr ${r.iouLtr.toFixed(3)}`);
      assert.deepStrictEqual(bad, []);
    });

    // Reopen the design in a fresh page: the draft is restored with no fonts loaded yet.
    await page.evaluate(() => {
      const ed = window.__editor;
      ed.canvas.discardActiveObject();
      ed.canvas.fire('object:modified', { target: ed.canvas.getObjects()[0] });
    });
    let saved = 0;
    for (let i = 0; i < 50 && saved !== FONT_CASES.length; i++) {
      await page.waitForTimeout(300);
      saved = await page.evaluate(async () => {
        const d = await window.POD.drafts.get('certificates');
        return d && d.designs && d.designs.front ? d.designs.front.length : 0;
      });
    }
    assert.strictEqual(saved, FONT_CASES.length, 'the design was not saved as a draft');
    const page2 = await openEditor(ctx, srv.base, 'certificates');
    const cold = await page2.evaluate(async ({ n, fnSrc, cases }) => {
      const exportText = new Function(`return (${fnSrc})`)();
      const T = window.__t;
      const ed = window.__editor;
      const count = ed.canvas.getObjects().filter((x) => x.type === 'i-text').length;
      if (count !== n) return { count, types: ed.canvas.getObjects().map((o) => o.type), side: ed.st.side, product: ed.st.product.id, out: [] };
      const firsts = [];
      for (let i = 0; i < n; i++) firsts.push(await exportText(i));
      const loaded = [];
      for (const c of cases) {
        const spec = `normal bold 40px "${c.font}"`;
        await document.fonts.load(spec, c.text);
        loaded.push(document.fonts.check(spec, c.text));
        fabric.util.clearFabricFontCache(c.font);
      }
      ed.canvas.getObjects().forEach((o) => { if (o.initDimensions) { o.initDimensions(); o.setCoords(); } });
      const out = [];
      for (let i = 0; i < n; i++) {
        const ref = await exportText(i);
        const f = firsts[i];
        out.push({ loaded: loaded[i], family: ed.canvas.getObjects()[i].fontFamily, box: f.box, refBox: ref.box, iou: f.mask && ref.mask ? T.iou(f.mask, ref.mask) : 0 });
      }
      return { count, out };
    }, { n: FONT_CASES.length, fnSrc: exportTextInPage.toString(), cases: FONT_CASES });
    await t.test('reopened design (fonts not preloaded) exports in the right fonts', () => {
      assert.strictEqual(cold.count, FONT_CASES.length, `draft was not restored with all texts: ${JSON.stringify(cold)}`);
      const bad = cold.out
        .map((r, i) => ({ ...r, c: FONT_CASES[i] }))
        .filter((r) => !r.loaded || r.iou < 0.97 || Math.abs(r.box.w - r.refBox.w) > 2)
        .map((r) => `${r.c.font} "${r.c.text}" (object font ${r.family}): IoU ${r.iou.toFixed(3)}, box ${r.box.w}x${r.box.h} vs ${r.refBox.w}x${r.refBox.h}`);
      assert.deepStrictEqual(bad, []);
    });
  } finally {
    await ctx.close();
  }
});

// =====================================================================
// 4. Transparency
// =====================================================================
test('4. transparency: garment print keeps alpha, full-bleed paper is fully opaque', { timeout: 60000 }, async (t) => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tshirt');
    await t.test('t-shirt: 50% opacity object exports at alpha ~128, background alpha 0', async () => {
      const n = await page.evaluate(() => window.__editor.canvas.getObjects().length);
      await page.evaluate(() => document.querySelector('#shape-grid [data-shape]').click());
      await page.waitForFunction((k) => window.__editor.canvas.getObjects().length > k, n);
      const r = await page.evaluate(async () => {
        const ed = window.__editor;
        const o = ed.canvas.getActiveObject() || ed.canvas.getObjects()[0];
        const a = ed.rects('front').trim;
        o.set({ opacity: 0.5, fill: '#000000', stroke: null, strokeWidth: 0, angle: 0, left: a.x + a.w / 2, top: a.y + a.h / 2 });
        o.scaleToWidth(a.w * 0.4);
        o.setCoords();
        ed.canvas.fire('object:modified', { target: o });
        const blob = await ed.exportPrint({ id: 'front' });
        const img = await window.__t.decode(blob);
        const { width: W, height: H, data } = img;
        const box = window.__t.ink(img, 1);
        const at = (x, y) => data[(y * W + x) * 4 + 3];
        const cx = Math.round(box.x + box.w / 2);
        const cy = Math.round(box.y + box.h / 2);
        let outsideMax = 0;
        let outsideCount = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (x >= box.x - 2 && x < box.x + box.w + 2 && y >= box.y - 2 && y < box.y + box.h + 2) continue;
            const v = at(x, y);
            if (v) { outsideCount++; outsideMax = Math.max(outsideMax, v); }
          }
        }
        return { W, H, box, centre: at(cx, cy), corners: [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)], outsideMax, outsideCount, type: o.type };
      });
      assert.ok(Math.abs(r.centre - 128) <= 10, `centre alpha ${r.centre}, expected 128 +- 10 (${r.type})`);
      assert.deepStrictEqual(r.corners, [0, 0, 0, 0], 'print corners must be transparent');
      assert.strictEqual(r.outsideCount, 0, `${r.outsideCount} non-transparent pixels outside the artwork (max alpha ${r.outsideMax})`);
      assert.ok(r.box.w < r.W * 0.6, `artwork box ${JSON.stringify(r.box)} too large: background is not transparent`);
    });

    const page2 = await openEditor(ctx, srv.base, 'certificates');
    await t.test('certificate with full-bleed white background: alpha 255 everywhere, white edges', async () => {
      await page2.evaluate(() => document.getElementById('fill-area').click());
      await page2.waitForFunction(() => window.__editor.canvas.getObjects().length > 0);
      const r = await page2.evaluate(async () => {
        const ed = window.__editor;
        const o = ed.canvas.getObjects()[0];
        o.set('fill', '#ffffff');
        ed.canvas.fire('object:modified', { target: o });
        const blob = await ed.exportPrint({ id: 'front' });
        const { width: W, height: H, data } = await window.__t.decode(blob);
        let minA = 255;
        let below = 0;
        let notWhite = 0;
        for (let i = 0; i < W * H; i++) {
          const a = data[i * 4 + 3];
          if (a < minA) minA = a;
          if (a < 255) below++;
          if (data[i * 4] < 250 || data[i * 4 + 1] < 250 || data[i * 4 + 2] < 250) notWhite++;
        }
        const rowsCols = [];
        for (const y of [0, H - 1]) { let m = 255; for (let x = 0; x < W; x++) m = Math.min(m, data[(y * W + x) * 4 + 3]); rowsCols.push(`row ${y}: min alpha ${m}`); }
        for (const x of [0, W - 1]) { let m = 255; for (let y = 0; y < H; y++) m = Math.min(m, data[(y * W + x) * 4 + 3]); rowsCols.push(`col ${x}: min alpha ${m}`); }
        return { W, H, minA, below, notWhite, rowsCols };
      });
      assert.strictEqual(r.minA, 255, `${r.below} of ${r.W * r.H} pixels are not fully opaque (min alpha ${r.minA}); edges: ${r.rowsCols.join(', ')}`);
      assert.strictEqual(r.notWhite, 0, `${r.notWhite} pixels are not white`);
    });
  } finally {
    await ctx.close();
  }
});

// =====================================================================
// 5. Accepted and refused upload types
// =====================================================================
test('5. upload types: PNG/JPG/WebP/SVG/PDF/AI are placed, .txt and .exe are refused', { timeout: 90000 }, async (t) => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'tshirt');
  const accept = await page.getAttribute('#file-input', 'accept');
  /** Upload, then check the image really reaches the print file. */
  const placed = async (name, mime, buf) => {
    await clearCanvas(page);
    const up = await upload(page, name, mime, buf);
    assert.ok(up.added, `${name} was refused: ${up.error}`);
    assert.strictEqual(up.type, 'image');
    assert.ok(up.w > 16 && up.h > 16, `${name}: placed image is ${up.w}x${up.h}`);
    const inkPx = await page.evaluate(async () => window.__t.ink(await window.__t.decode(await window.__editor.exportPrint({ id: 'front' }))).ink);
    assert.ok(inkPx > 1000, `${name}: print file is empty after upload`);
  };
  const refused = async (name, mime, buf, re) => {
    await clearCanvas(page);
    const up = await upload(page, name, mime, buf);
    assert.strictEqual(up.added, false, `${name} was accepted`);
    assert.match(up.error, re);
    assert.strictEqual(await page.evaluate(() => window.__editor.canvas.getObjects().length), 0);
  };
  try {
    await t.test('PNG', () => placed('art.png', 'image/png', files.png));
    await t.test('JPG', () => placed('photo.jpg', 'image/jpeg', files.jpg));
    await t.test('WebP', () => placed('photo.webp', 'image/webp', files.webp));
    await t.test('AI (PDF-compatible) is converted on the server and placed', () => placed('logo.ai', 'application/illustrator', files.pdf));
    await t.test('server /api/artwork converts a real PDF to a transparent PNG', async () => {
      const res = await fetch(`${srv.base}/api/artwork`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-max-px': '1000' }, body: files.pdf });
      assert.strictEqual(res.status, 200, await res.clone().text());
      const png = decodePng(Buffer.from(await res.arrayBuffer()));
      assert.ok(png.width >= 500 && png.height >= 500, `${png.width}x${png.height}`);
      assert.strictEqual(png.data[3], 0, 'corner outside the circle should be transparent');
      const mid = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
      assert.strictEqual(png.data[mid + 3], 255, 'centre should be opaque');
    });
    /** Both halves matter: the picker must offer the type, and the editor must place it. */
    const offeredAndPlaced = async (name, mime, buf, re) => {
      let placedErr = null;
      try {
        await placed(name, mime, buf);
      } catch (e) {
        placedErr = e.message;
      }
      const offered = re.test(accept);
      assert.ok(offered && !placedErr, [
        offered ? null : `the file picker does not offer this type (accept="${accept}")`,
        placedErr ? `uploading it anyway (drag and drop): ${placedErr}` : null,
      ].filter(Boolean).join('; '));
    };
    await t.test('SVG upload is placed', () => offeredAndPlaced('vector.svg', 'image/svg+xml', files.svg, /svg/));
    await t.test('PDF upload is converted and placed', () => offeredAndPlaced('logo.pdf', 'application/pdf', files.pdf, /pdf/));
    await t.test('.txt is refused with a message', () => refused('notes.txt', 'text/plain', Buffer.from('hello world\n'), /JPG|PNG|file/i));
    await t.test('.exe is refused with a message', () => refused('setup.exe', 'application/x-msdownload', files.exe, /JPG|PNG|file/i));
    await t.test('.exe renamed to .png is refused with a message', () => refused('holiday.png', 'image/png', files.exe, /image|file/i));
    await t.test('.exe renamed to .ai is refused with a message', () => refused('logo.ai', 'application/illustrator', files.exe, /./));
  } finally {
    await ctx.close();
  }
});

// =====================================================================
// 6. The stored print file is the one the browser exported
// =====================================================================
test('6. add to cart: stored <side>-print.png is pixel-identical to the browser export', { timeout: 90000 }, async (t) => {
  const ctx = await newContext(browser);
  const page = await openEditor(ctx, srv.base, 'certificates');
  try {
    // Photo background, a heading in Arabic and a shape: a realistic certificate.
    const up = await upload(page, 'bg.jpg', 'image/jpeg', files.photo3000);
    assert.ok(up.added, up.error);
    await page.evaluate(() => {
      const ed = window.__editor;
      const o = ed.canvas.getObjects()[0];
      const a = ed.rects('front').bleed;
      o.scale(Math.max(a.w / o.width, a.h / o.height));
      o.set({ left: a.x + a.w / 2, top: a.y + a.h / 2, opacity: 0.85 });
      o.setCoords();
      ed.canvas.fire('object:modified', { target: o });
      document.querySelector('#text-presets [data-i="0"]').click();
    });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 2);
    await page.evaluate(() => {
      const ed = window.__editor;
      const tx = ed.canvas.getObjects()[1];
      tx.set({ text: 'شهادة تقدير', angle: -4 });
      ed.canvas.fire('text:changed', { target: tx });
      ed.canvas.fire('object:modified', { target: tx });
      document.querySelector('#shape-grid [data-shape]').click();
    });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().length === 3);
    await page.evaluate(() => {
      const ed = window.__editor;
      const s = ed.canvas.getObjects()[2];
      const a = ed.rects('front').trim;
      s.set({ left: a.x + a.w * 0.8, top: a.y + a.h * 0.75, opacity: 0.6, angle: 12 });
      s.setCoords();
      ed.canvas.discardActiveObject();
      ed.canvas.fire('object:modified', { target: s });
    });
    await page.waitForTimeout(300);

    // What the customer approved: the print file exported from the editor now.
    const approvedB64 = await page.evaluate(async () => window.__t.blobToBase64(await window.__editor.exportPrint({ id: 'front' })));
    const approved = Buffer.from(approvedB64, 'base64');

    // Keep a copy of every file body the editor uploads (request bodies made from Blobs aren't visible to Playwright).
    const uploads = {};
    await page.exposeFunction('__saveUpload', (name, b64) => { uploads[name] = Buffer.from(b64, 'base64'); });
    await page.evaluate(() => {
      const orig = window.fetch;
      window.fetch = async function (url, opts) {
        const m = /\/api\/designs\/[^/]+\/files\/([^/?]+)/.exec(String(url));
        if (m && opts && opts.method === 'PUT' && opts.body instanceof Blob) await window.__saveUpload(decodeURIComponent(m[1]), await window.__t.blobToBase64(opts.body));
        return orig.apply(this, arguments);
      };
    });
    // The editor goes on to the cart as soon as the answer comes, and the browser then drops its body:
    // kept here on the way in (reading it afterwards raced the page, and failed on a busy machine).
    let completeBody = '';
    await page.route(/\/api\/designs\/[^/]+\/complete$/, async (route) => {
      const res = await route.fetch();
      completeBody = await res.text();
      await route.fulfill({ response: res, body: completeBody });
    });
    const completeP = page.waitForResponse((r) => /\/api\/designs\/[^/]+\/complete$/.test(r.url()), { timeout: 60000 });
    await page.click('#add-to-cart');
    const complete = await completeP;
    assert.strictEqual(complete.status(), 200, completeBody);
    const design = JSON.parse(completeBody);
    await page.waitForURL(/\/cart/, { timeout: 30000 });

    const sent = uploads['front-print.png'];
    assert.ok(sent && sent.length > 1000, 'front-print.png was not uploaded');
    const stored = fs.readFileSync(path.join(srv.dataDir, 'files', design.id, 'front-print.png'));

    const A = decodePng(approved);
    const S = decodePng(sent);
    const D = decodePng(stored);
    const diff = (x, y) => {
      if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}x${x.height} vs ${y.width}x${y.height}` };
      let n = 0;
      let max = 0;
      for (let i = 0; i < x.data.length; i++) {
        const d = Math.abs(x.data[i] - y.data[i]);
        if (d) { n++; max = Math.max(max, d); }
      }
      return { n, max };
    };
    t.diagnostic(`approved export ${approved.length} B, uploaded ${sent.length} B, byte-identical: ${approved.equals(sent)}; stored (sRGB + pHYs added) ${stored.length} B`);
    const ab = diff(A, S);
    assert.deepStrictEqual(ab, { n: 0, max: 0 }, `uploaded print differs from the approved export: ${JSON.stringify(ab)} (byte-identical: ${approved.equals(sent)})`);
    const sd = diff(S, D);
    assert.deepStrictEqual(sd, { n: 0, max: 0 }, `stored print differs from the uploaded one: ${JSON.stringify(sd)}`);

    // What the server recorded about it.
    const side = design.sides.find((s) => s.id === 'front');
    const product = PRODUCTS.find((p) => p.id === 'certificates');
    const exp = expectedPrint(product, product.sides[0], 'A4');
    assert.strictEqual(side.widthPx, D.width);
    assert.strictEqual(side.heightPx, D.height);
    assert.strictEqual(side.dpi, Math.round(D.width / (side.widthIn + 2 * side.bleedIn)));
    assert.ok(Math.abs(side.dpi - exp.dpi) <= 1, `recorded ${side.dpi} DPI, expected ${exp.dpi}`);
    assert.ok(D.density && Math.abs(D.density - side.dpi) < 1, `stored PNG pHYs says ${D.density} DPI, design says ${side.dpi}`);
  } finally {
    await ctx.close();
  }
});
