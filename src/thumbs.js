'use strict';

/*
 * Product card pictures: the real product photo recoloured to a product
 * colour, cut out and cropped, made once on the server so phones only
 * download a small finished image. Same shading model as the browser
 * (public/js/photo-mockups.js).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
let sharpModule = null;
const sharp = () => (sharpModule ||= require('sharp'));

/** The photo configs, read from the browser file so both sides share one source. */
function loadConfigs() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, 'js', 'photo-mockups.js'), 'utf8'), { window, document: {}, Image: function () {} });
  return window.POD_PHOTOS || {};
}
let configs = null;
const configFor = (productId, sideId) => {
  configs ||= loadConfigs();
  return configs[`${productId}:${sideId}`] || null;
};

const hexRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const bases = new Map();
async function photoBase(cfg, width) {
  const key = cfg.src + '|' + width;
  if (!bases.has(key)) {
    bases.set(key, (async () => {
      const file = (url) => path.join(PUBLIC, url.replace(/^\//, ''));
      const meta = await sharp()(file(cfg.src)).metadata();
      const W = width;
      const H = Math.round((width * meta.height) / meta.width);
      const pd = await sharp()(file(cfg.src)).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      const md = await sharp()(file(cfg.mask)).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
      const lum = new Float32Array(W * H);
      const samples = [];
      let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
      for (let i = 0; i < W * H; i++) {
        lum[i] = (0.299 * pd[i * 3] + 0.587 * pd[i * 3 + 1] + 0.114 * pd[i * 3 + 2]) / 255;
        if (md[i] > 200 && i % 5 === 0) samples.push(lum[i]);
        if (md[i] > 20) {
          const x = i % W;
          const y = (i - x) / W;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      samples.sort((a, b) => a - b);
      const white = samples.length ? samples[Math.floor(samples.length * 0.95)] : 1;
      return { W, H, k: width / 1000, pd, md, lum, white, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
    })());
  }
  return bases.get(key);
}

const cache = new Map();
/** WebP card picture of a product side in a colour, or null if it has no photo. */
async function cardImage(productId, sideId, hex, size = 640) {
  const cfg = configFor(productId, sideId);
  if (!cfg) return null;
  const key = [productId, sideId, hex, size].join('|');
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const b = await photoBase(cfg, 1000);
    const { W, H, pd, md, lum, white } = b;
    const base = hexRgb(cfg.base || '#ffffff');
    const target = hexRgb(hex);
    const recolour = target.some((v, i) => Math.abs(v - base[i]) > 6);
    const dark = (0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2]) / 255 < 0.35;
    const paper = cfg.paper ? { x: cfg.paper.x * b.k, y: cfg.paper.y * b.k, w: cfg.paper.w * b.k, h: cfg.paper.h * b.k } : null;
    const keepDark = cfg.keepDark || 0;
    const out = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const m = md[i] / 255;
      out[o] = pd[i * 3];
      out[o + 1] = pd[i * 3 + 1];
      out[o + 2] = pd[i * 3 + 2];
      out[o + 3] = md[i];
      if (!recolour || m === 0 || lum[i] < keepDark) continue;
      if (paper) {
        const x = i % W;
        const y = (i - x) / W;
        if (x >= paper.x && x < paper.x + paper.w && y >= paper.y && y < paper.y + paper.h) continue;
      }
      const sh = lum[i] / white;
      for (let c = 0; c < 3; c++) {
        const base0 = base[c] / 255;
        let v = (target[c] * Math.min(sh, 1)) / Math.max(0.2, base0) * base0;
        if (sh > 1) v += (255 - v) * (sh - 1) * 2;
        if (dark) v += (sh - 1) * 70;
        out[o + c] = Math.max(0, Math.min(255, Math.round(pd[i * 3 + c] * (1 - m) + v * m)));
      }
    }
    // Square crop around the product with a small margin.
    const pad = Math.round(Math.max(b.bbox.w, b.bbox.h) * 0.04);
    const sideLen = Math.max(b.bbox.w, b.bbox.h) + pad * 2;
    const left = Math.round(b.bbox.x + b.bbox.w / 2 - sideLen / 2);
    const top = Math.round(b.bbox.y + b.bbox.h / 2 - sideLen / 2);
    const extend = { top: Math.max(0, -top), left: Math.max(0, -left), bottom: Math.max(0, top + sideLen - H), right: Math.max(0, left + sideLen - W), background: { r: 0, g: 0, b: 0, alpha: 0 } };
    // Two steps: sharp would otherwise crop before extending.
    const padded = await sharp()(out, { raw: { width: W, height: H, channels: 4 } }).extend(extend).raw().toBuffer({ resolveWithObject: true });
    return sharp()(padded.data, { raw: padded.info })
      .extract({ left: Math.max(0, left), top: Math.max(0, top), width: sideLen, height: sideLen })
      .resize(size, size)
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
  })();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return job;
}

module.exports = { cardImage, configFor };
