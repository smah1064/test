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

/**
 * Fabric products: the product picture (bed, curtains, roll of fabric)
 * covered with a sample pattern, for the shop's product cards.
 */
const patternCache = new Map();
async function patternImage(product, hex, size = 640) {
  const key = [product.id, hex, size].join('|');
  if (patternCache.has(key)) return patternCache.get(key);
  const sc = product.pattern.scene;
  const inner = (svg) => String(svg || '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
  const line = mix(hex, '#000000', 0.32);
  const fill = (t) => t.replace(/\{\{C\}\}/g, hex).replace(/\{\{S\}\}/g, mix(hex, '#000000', 0.1)).replace(/\{\{L\}\}/g, line);
  const f = sc.fill;
  const T = Math.round(f.w / 4.5);
  // A friendly sample motif: leaves and dots in two colours, half-drop.
  const motif = `<pattern id="pt" width="${T}" height="${T * 2}" patternUnits="userSpaceOnUse" x="${f.x}" y="${f.y}">
    <g><ellipse cx="${T * 0.5}" cy="${T * 0.5}" rx="${T * 0.16}" ry="${T * 0.3}" fill="#2f9e44" transform="rotate(35 ${T * 0.5} ${T * 0.5})"/><circle cx="${T * 0.85}" cy="${T * 0.15}" r="${T * 0.07}" fill="#ff5a36"/>
    <ellipse cx="${T * 0.5}" cy="${T * 1.5}" rx="${T * 0.16}" ry="${T * 0.3}" fill="#1c7ed6" transform="rotate(-35 ${T * 0.5} ${T * 1.5})"/><circle cx="${T * 0.15}" cy="${T * 1.1}" r="${T * 0.07}" fill="#fab005"/></g></pattern>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600" viewBox="0 0 500 600"><defs>${motif}</defs><rect width="500" height="600" fill="#f3f4f6"/>${fill(inner(sc.svg))}<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="url(#pt)"/>${fill(inner(sc.overlay))}</svg>`;
  const job = sharp()(Buffer.from(svg)).resize({ width: size }).webp({ quality: 86 }).toBuffer();
  patternCache.set(key, job);
  return job;
}

module.exports = { patternImage, cardImage, configFor };
