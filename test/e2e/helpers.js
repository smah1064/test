'use strict';

/**
 * Shared plumbing for the browser (end-to-end) tests: a real server on a free
 * port with a throwaway DATA_DIR, a Chromium browser, and small in-page
 * helpers that drive the design editor and read back the print files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { createApp } = require('../../src/app');

/** Playwright is installed globally in CI images; fall back to `npm root -g` when NODE_PATH isn't set. */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  }
}

const OPEN_LIMITS = Object.fromEntries(
  ['designs', 'designsAll', 'orders', 'shares', 'artwork', 'draftSave'].map((k) => [k, [{ max: 1e6, ms: 1000 }]]),
);

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-e2e-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0 });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dataDir,
    async close() {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A fresh browser context (own localStorage / IndexedDB, so no drafts leak between tests), English UI. */
async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('pod-lang', 'en');
    } catch (e) { /* ignore */ }
  });
  return ctx;
}

/** Open the editor for a product and wait until it has booted (window.__editor is set last). */
async function openEditor(ctx, base, productId, extra = '') {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(`${base}/editor?product=${encodeURIComponent(productId)}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product, null, { timeout: 30000 });
  await page.evaluate(installPageHelpers);
  return page;
}

/**
 * In-page helpers (window.__t): decode a PNG blob into RGBA pixels, read the
 * PNG header, and measure "ink" (non-transparent pixels) in a region.
 */
function installPageHelpers() {
  if (window.__t) return;
  const pngSize = async (blob) => {
    const v = new DataView(await blob.slice(0, 32).arrayBuffer());
    const sig = v.getUint32(0) === 0x89504e47 && v.getUint32(12) === 0x49484452; // \x89PNG ... IHDR
    return { png: sig, width: v.getUint32(16), height: v.getUint32(20), type: blob.type, bytes: blob.size };
  };
  /** Decode without colour management or premultiplication so the bytes are what the PNG holds. */
  const decode = async (blob) => {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  };
  /** Bounding box, ink count (alpha-weighted) and binary mask of non-transparent pixels. */
  const ink = (img, threshold = 128) => {
    const { width: W, height: H, data } = img;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, sum = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = data[(y * W + x) * 4 + 3];
        sum += a / 255;
        if (a >= threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? { empty: true, ink: sum } : { empty: false, ink: sum, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  /** Binary mask (alpha >= threshold) of the ink's bounding box. */
  const mask = (img, box, threshold = 128) => {
    const m = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) m[y * box.w + x] = img.data[((box.y + y) * img.width + box.x + x) * 4 + 3] >= threshold ? 1 : 0;
    return { w: box.w, h: box.h, m };
  };
  /** Sizes of the 8-connected components of a mask, biggest first. */
  const components = (mk) => {
    const { w, h, m } = mk;
    const seen = new Uint8Array(w * h);
    const sizes = [];
    const stack = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || seen[i]) continue;
      let top = 0;
      let n = 0;
      stack[top++] = i;
      seen[i] = 1;
      while (top) {
        const j = stack[--top];
        n++;
        const x = j % w;
        const y = (j - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx;
            if (m[k] && !seen[k]) { seen[k] = 1; stack[top++] = k; }
          }
        }
      }
      sizes.push(n);
    }
    return sizes.sort((a, b) => b - a);
  };
  /** Intersection over union of two masks laid over each other at their top-left corners (after resampling b to a's box). */
  const iou = (a, b) => {
    let inter = 0;
    let uni = 0;
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < a.w; x++) {
        const av = a.m[y * a.w + x];
        const bx = Math.min(b.w - 1, Math.floor((x * b.w) / a.w));
        const by = Math.min(b.h - 1, Math.floor((y * b.h) / a.h));
        const bv = b.m[by * b.w + bx];
        if (av && bv) inter++;
        if (av || bv) uni++;
      }
    }
    return uni ? inter / uni : 1;
  };
  const blobToBase64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__t = { pngSize, decode, ink, mask, components, iou, blobToBase64 };
}

/** Physical print size and the DPI the editor should export at (300, unless the canvas caps in editor.js apply). */
const TARGET_DPI = 300;
const MAX_PRINT_PIXELS = 16e6;
const MAX_PRINT_SIDE = 8000;
function expectedPrint(product, side, sizeId, tileCm = null) {
  const size = product.sizes.find((z) => z.id === sizeId);
  const k = (size && size.printScale) || 1;
  const a = side.printArea;
  // Fabric patterns: the print file is one tile, printed tileCm wide (what the server records as the side's size).
  const widthIn = product.pattern ? (tileCm || product.pattern.tile) / 2.54 : side.printWidthIn * k;
  const heightIn = (widthIn * a.h) / a.w;
  const bleed = product.pattern ? 0 : side.bleedIn || 0;
  const wb = widthIn + 2 * bleed;
  const hb = heightIn + 2 * bleed;
  const dpi = Math.min(TARGET_DPI, Math.sqrt(MAX_PRINT_PIXELS / (wb * hb)), MAX_PRINT_SIDE / Math.max(wb, hb));
  return { widthIn, heightIn, bleed, wb, hb, dpi, width: Math.round(wb * dpi), height: Math.round(hb * dpi) };
}

module.exports = { loadPlaywright, startServer, newContext, openEditor, installPageHelpers, expectedPrint, TARGET_DPI };

/**
 * Minimal PNG decoder (8-bit greyscale/RGB/RGBA, non-interlaced), with no colour
 * management, so two files can be compared on exactly the pixel values they store.
 * Returns { width, height, data: RGBA Buffer, density (pixels per inch from pHYs, or null) }.
 */
function decodePng(buf) {
  const zlib = require('zlib');
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let ihdr = null;
  let density = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'pHYs' && body[8] === 1) density = body.readUInt32BE(0) * 0.0254;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.color];
  if (ihdr.depth !== 8 || !channels || ihdr.interlace) throw new Error(`unsupported PNG (depth ${ihdr.depth}, colour type ${ihdr.color}, interlace ${ihdr.interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr;
  const stride = W * channels;
  const px = Buffer.alloc(H * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  if (channels === 4) return { width: W, height: H, data: px, density };
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const g = channels <= 2;
    data[i * 4] = px[i * channels];
    data[i * 4 + 1] = g ? px[i * channels] : px[i * channels + 1];
    data[i * 4 + 2] = g ? px[i * channels] : px[i * channels + 2];
    data[i * 4 + 3] = channels === 2 ? px[i * 2 + 1] : channels === 4 ? px[i * 4 + 3] : 255;
  }
  return { width: W, height: H, data, density };
}

module.exports.decodePng = decodePng;
