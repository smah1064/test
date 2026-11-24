/* Live preview: realistic mockups, 3D view and print-colour (CMYK) proof.
 *
 * Realistic mode bends the design over the product: fabric folds for
 * clothing, a cylinder wrap for mugs and bottles, a puffed surface for
 * cushions, and lighting/texture for flat items. Each output pixel looks up
 * where it comes from in the flat design (displacement) and is then lit
 * (shading), so the artwork follows the product's surface.
 */
(function () {
  'use strict';

  const { t, tr, esc, toast } = POD;
  const S = 2; // render at 2x the 500 x 600 mockup space
  const W = 500;
  const H = 600;

  const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // ---------- Procedural noise ----------
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Height map of soft fabric folds over the 500 x 600 garment space. */
  function foldField(amount) {
    const h = new Float32Array(W * H);
    const g = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Long vertical drape folds that bend gently and grow towards the hem.
        const drape = Math.sin((x - 250) * 0.034 + 1.6 * Math.sin(y * 0.007) + 3 * vnoise(x * 0.004, y * 0.003)) * (0.3 + 0.7 * Math.min(1, Math.max(0, (y - 150) / 360)));
        // Diagonal pull lines from the armpits.
        const armL = Math.sin((x * 0.55 + y * 0.83) * 0.06) * g(x, y, 170, 245, 45);
        const armR = Math.sin((-x * 0.55 + y * 0.83) * 0.06 + 1) * g(x, y, 330, 245, 45);
        const hem = Math.sin(x * 0.07 + 1.3) * g(x, y, 250, 525, 55) * 0.5;
        h[y * W + x] = (drape + armL * 0.8 + armR * 0.8 + hem) * amount;
      }
    }
    return h;
  }
  const fieldCache = new Map();
  function folds(amount) {
    if (!fieldCache.has(amount)) fieldCache.set(amount, foldField(amount));
    return fieldCache.get(amount);
  }

  // ---------- Surface models ----------
  // Each returns, for a point in mockup units: where to sample the flat design
  // (sx, sy), a lighting multiplier and a specular highlight.
  const LIGHT = (() => {
    const l = [-0.45, -0.65, 1];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
  })();

  function surfaceFor(product, rects) {
    const type = product.model.type;
    const a = rects.trim;
    const cxPrint = a.x + a.w / 2;

    if (type === 'mug' || type === 'bottle') {
      const mug = type === 'mug';
      const cx = mug ? 230 : 250;
      const R = mug ? 110 : 100;
      const top = mug ? 150 : 142;
      const bottom = mug ? 470 : 552;
      const e = R * 0.12;
      return {
        // Below the rim: outside the mug's top opening (an ellipse) and above the base.
        body: (x, y) => Math.abs(x - cx) < R && y > top && y < bottom && (!mug || ((x - cx) / (R + 2)) ** 2 + ((y - 150) / 20) ** 2 > 1),
        at(x, y) {
          const tt = (x - cx) / R;
          if (Math.abs(tt) >= 1) return null;
          const phi = Math.asin(tt);
          const shade = Math.min(1.06, Math.max(0.45, 0.66 + 0.42 * Math.cos(phi + 0.35)));
          const spec = (mug ? 0.42 : 0.55) * Math.exp(-(((phi + 0.6) / (mug ? 0.08 : 0.12)) ** 2)) + (mug ? 0 : 0.15 * Math.exp(-(((phi - 0.9) / 0.1) ** 2)));
          return { sx: cxPrint + phi * R, sy: y + e * (1 - Math.cos(phi)), shade, spec };
        },
      };
    }

    if (type === 'pillow') {
      const cx = 250;
      const cy = 300;
      const hx = 185;
      const hy = 200;
      return {
        body: () => true,
        at(x, y) {
          const rx = (x - cx) / hx;
          const ry = (y - cy) / hy;
          const puff = Math.max(0, (1 - rx * rx) * (1 - ry * ry));
          const k = 1 - 0.07 * puff;
          return { sx: cx + (x - cx) * k, sy: cy + (y - cy) * k, shade: 0.8 + 0.24 * puff - 0.07 * rx - 0.09 * ry, spec: 0.06 * puff * Math.max(0, -rx - ry) };
        },
      };
    }

    if (type === 'card' || type === 'cloth') {
      if (product.id === 'cap') {
        const cx = 250;
        const R = 150;
        return {
          body: () => true,
          at(x, y) {
            const tt = (x - cx) / R;
            if (Math.abs(tt) >= 1) return null;
            const phi = Math.asin(tt);
            return { sx: cx + phi * R, sy: y - 10 * (1 - Math.cos(phi)) + 4 * Math.sin(((y - 210) / 90) * Math.PI), shade: 0.72 + 0.32 * Math.cos(phi + 0.3), spec: 0 };
          },
        };
      }
      const amount = product.id === 'tote' ? 0.9 : 1.6;
      const field = folds(amount);
      const D = 22; // how far the artwork is pushed by the folds
      const K = 7; // how strongly folds catch the light
      return {
        body: () => true,
        at(x, y) {
          const xi = Math.min(W - 2, Math.max(1, Math.round(x)));
          const yi = Math.min(H - 2, Math.max(1, Math.round(y)));
          const hgt = field[yi * W + xi];
          const gx = (field[yi * W + xi + 1] - field[yi * W + xi - 1]) / 2;
          const gy = (field[(yi + 1) * W + xi] - field[(yi - 1) * W + xi]) / 2;
          const nl = Math.hypot(gx * K, gy * K, 1);
          const dot = (-gx * K * LIGHT[0] - gy * K * LIGHT[1] + LIGHT[2]) / nl;
          // Valleys of the folds are a little darker (ambient occlusion).
          const torso = 0.95 + 0.05 * Math.cos(Math.min(Math.PI, Math.abs(x - 250) / 110)); // the body is rounder than a flat sheet
          // Ridges facing the light get a soft sheen, which is what makes folds visible on dark fabric.
          const sheen = Math.max(0, dot - LIGHT[2]) * 0.22;
          return { sx: x - gx * D, sy: y - gy * D, shade: (0.68 + 0.38 * dot + 0.03 * (hgt / amount)) * torso, spec: sheen };
        },
      };
    }

    // Flat products: soft light falloff, plus a gloss stripe on hard plastic.
    const glossy = type === 'case';
    return {
      body: () => true,
      at(x, y) {
        const shade = 1.02 - 0.06 * ((x - 250) / 250) - 0.08 * ((y - 300) / 300);
        const spec = glossy ? 0.16 * Math.exp(-((((x - 160) - (y - 85) * 0.35 - 120) / 22) ** 2)) : 0;
        return { sx: x, sy: y, shade, spec };
      },
    };
  }

  /** Render the design on the product with folds/curvature, lighting and texture. */
  /**
   * A mug printed all the way round: the editor's print is the unrolled wrap. The flat
   * previews show the mug from the side opposite the handle, so the half of the wrap
   * facing you is cut out and laid on the mug's front view, at the same scale.
   */
  function wrapFront(product, entry) {
    const a = entry.rects.trim;
    const halfIn = (Math.PI * ((product.model && product.model.diameterIn) || 3.25)) / 2;
    const half = halfIn * entry.rects.u; // half the way round, in the editor's units
    const R = 110; // the front view's mug (see surfaceFor): 230 ± 110
    const wView = Math.PI * R; // what surfaceFor spreads over the visible half
    const k = wView / half;
    const trim = { x: 230 - wView / 2, y: 310 - (a.h * k) / 2, w: wView, h: a.h * k };
    const ds = entry.designScale || 3;
    const c = document.createElement('canvas');
    c.width = entry.design.width;
    c.height = entry.design.height;
    c.getContext('2d').drawImage(entry.design, (a.x + a.w / 2 - half / 2) * ds, a.y * ds, half * ds, a.h * ds, trim.x * ds, trim.y * ds, trim.w * ds, trim.h * ds);
    const view = { ...entry.side, svg: entry.side.wrap.view, overlay: null };
    return { ...entry, side: view, base: POD.mockupUrl(view, entry.hex || '#ffffff'), overlay: null, design: c, designScale: ds, rects: { ...entry.rects, trim, bleed: trim, u: entry.rects.u * k } };
  }
  async function renderRealistic(product, entry) {
    if (entry.side && entry.side.wrap) entry = wrapFront(product, entry);
    const [baseImg, overImg] = await Promise.all([loadImg(entry.base), entry.overlay ? loadImg(entry.overlay) : null]);
    const Wd = W * S;
    const Hd = H * S;
    const out = document.createElement('canvas');
    out.width = Wd;
    out.height = Hd;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(baseImg, 0, 0, Wd, Hd);
    const base = ctx.getImageData(0, 0, Wd, Hd);
    const bd = base.data;
    let designCv = entry.design;
    if (designCv.width !== Wd) {
      designCv = document.createElement('canvas');
      designCv.width = Wd;
      designCv.height = Hd;
      designCv.getContext('2d').drawImage(entry.design, 0, 0, Wd, Hd);
    }
    const dd = designCv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, Wd, Hd).data;

    const surf = surfaceFor(product, entry.rects);
    const fabric = product.model.material === 'fabric';
    const paper = product.model.material === 'paper';
    const r = entry.rects.bleed;
    const m = 20; // design can be displaced a little beyond the print edge
    const x0 = Math.max(0, Math.floor((r.x - m) * S));
    const x1 = Math.min(Wd, Math.ceil((r.x + r.w + m) * S));
    const y0 = Math.max(0, Math.floor((r.y - m) * S));
    const y1 = Math.min(Hd, Math.ceil((r.y + r.h + m) * S));

    const sample = (fx, fy, outArr) => {
      const xa = Math.floor(fx);
      const ya = Math.floor(fy);
      if (xa < 0 || ya < 0 || xa >= Wd - 1 || ya >= Hd - 1) return false;
      const ax = fx - xa;
      const ay = fy - ya;
      const i00 = (ya * Wd + xa) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + Wd * 4;
      const i11 = i01 + 4;
      // Interpolate premultiplied colour so soft edges don't pick up dark fringes.
      const a00 = dd[i00 + 3];
      const a10 = dd[i10 + 3];
      const a01 = dd[i01 + 3];
      const a11 = dd[i11 + 3];
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      for (let c = 0; c < 3; c++) {
        outArr[c] = (dd[i00 + c] * a00 * w00 + dd[i10 + c] * a10 * w10 + dd[i01 + c] * a01 * w01 + dd[i11 + c] * a11 * w11) / 255;
      }
      outArr[3] = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
      return true;
    };
    const px = [0, 0, 0, 0];

    for (let y = 0; y < Hd; y++) {
      const my = y / S;
      for (let x = 0; x < Wd; x++) {
        const i = (y * Wd + x) * 4;
        if (bd[i + 3] === 0) continue;
        const mx = x / S;
        const g = surf.body(mx, my) ? surf.at(mx, my) : null;
        if (!g) continue;
        const grain = fabric ? (hash(x, y) - 0.5) * 0.07 + 0.025 * Math.sin(x * 1.7) * Math.sin(y * 1.7) : paper ? (hash(x, y) - 0.5) * 0.03 : 0;
        const k = g.shade + grain;
        const sp = g.spec * 255;
        const br = bd[i];
        const bg = bd[i + 1];
        const bb = bd[i + 2];
        const baseLum = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
        let r0 = br * k + sp;
        let g0 = bg * k + sp;
        let b0 = bb * k + sp;
        if (x >= x0 && x < x1 && y >= y0 && y < y1 && sample(g.sx * S, g.sy * S, px) && px[3] > 0) {
          const al = px[3] / 255;
          // A little of the fabric shows through the ink on light garments.
          const absorb = fabric ? 0.1 : 0;
          const ink = (c) => (c * (1 - absorb) + (c * baseLum) * absorb) * k + sp * 0.8;
          r0 = r0 * (1 - al) + ink(px[0] / al) * al;
          g0 = g0 * (1 - al) + ink(px[1] / al) * al;
          b0 = b0 * (1 - al) + ink(px[2] / al) * al;
        }
        bd[i] = r0;
        bd[i + 1] = g0;
        bd[i + 2] = b0;
      }
    }
    ctx.putImageData(base, 0, 0);
    // Laser-cut pieces (cake toppers, hanging decorations) are the product themselves, not printed on it:
    // shown whole, also where the drawing has nothing behind them.
    if (product.laser && product.laser.kind === 'cut') ctx.drawImage(designCv, 0, 0, Wd, Hd);
    if (overImg) ctx.drawImage(overImg, 0, 0, Wd, Hd);
    out.pxPerIn = (entry.rects.u || 1) * S;
    const fa = entry.rects.trim; // where the print is (for "Zoom to the design")
    out.focus = { x: (fa.x + fa.w / 2) / W, y: (fa.y + fa.h / 2) / H, w: fa.w / W };
    return out;
  }

  // ---------- Photo mockups ----------
  const photoCache = new Map();
  const PHOTO_W = 1000; // photo-mockups.js coordinates are pixels of a 1000-px-wide photo
  /** Pixels of an image drawn at an exact size (CDNs may serve photos and masks resized). */
  function pixels(img, w = img.naturalWidth, h = img.naturalHeight) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc / (2 * r + 1);
        acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    return out;
  }
  /** Decode a photo + mask once: pixels, brightness, smoothed brightness (for folds) and the white point. */
  function loadPhoto(cfg) {
    if (!photoCache.has(cfg.src)) {
      photoCache.set(cfg.src, Promise.all([loadImg(cfg.src), loadImg(cfg.mask)]).then(([ph, mk]) => {
        // Work in the photo coordinate space (1000 px wide) whatever size was served.
        const W = PHOTO_W;
        const H = Math.round((PHOTO_W * ph.naturalHeight) / ph.naturalWidth);
        const pd = pixels(ph, W, H);
        const md = pixels(mk, W, H);
        const lum = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) lum[i] = (0.299 * pd[i * 4] + 0.587 * pd[i * 4 + 1] + 0.114 * pd[i * 4 + 2]) / 255;
        const blur = boxBlur(boxBlur(lum, W, H, 5), W, H, 5);
        const samples = [];
        for (let i = 0; i < W * H; i += 7) if (md[i * 4] > 200) samples.push(lum[i]);
        samples.sort((a, b) => a - b);
        const white = samples.length ? samples[Math.floor(samples.length * 0.95)] : 1;
        // Bounding box of the product, so the 3D cut-out has no empty margins.
        let bx0 = W;
        let by0 = H;
        let bx1 = 0;
        let by1 = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (md[(y * W + x) * 4] > 20) {
              if (x < bx0) bx0 = x;
              if (x > bx1) bx1 = x;
              if (y < by0) by0 = y;
              if (y > by1) by1 = y;
            }
          }
        }
        const bbox = { x: bx0, y: by0, w: Math.max(1, bx1 - bx0 + 1), h: Math.max(1, by1 - by0 + 1) };
        return { W, H, pd, md, lum, blur, white, bbox };
      }));
    }
    return photoCache.get(cfg.src);
  }
  const hexRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /**
   * Put the design on a real product photo. The product is recoloured from
   * the photo's own brightness (so folds, stitching and shadows stay), the
   * design is warped into the measured print area and lit by the photo.
   */
  async function renderPhoto(product, entry, cfg, colorHex, withDesign = true) {
    const ph = await loadPhoto(cfg);
    const { W, H, pd, md, lum, blur, white, bbox } = ph;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    const od = img.data;
    od.set(pd);

    // 1. Recolour the product (unless it is the colour that was photographed).
    const base = hexRgb(cfg.base || '#ffffff');
    const target = hexRgb(colorHex);
    const recolour = target.some((v, i) => Math.abs(v - base[i]) > 6);
    const dark = (0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2]) / 255 < 0.35;
    const paper = cfg.paper;
    if (recolour) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const m = md[i * 4] / 255;
          if (m === 0) continue;
          if (paper && x >= paper.x && x < paper.x + paper.w && y >= paper.y && y < paper.y + paper.h) continue;
          const sh = lum[i] / white;
          for (let c = 0; c < 3; c++) {
            const base0 = base[c] / 255;
            let v = target[c] * Math.min(sh, 1) / Math.max(0.2, base0) * base0;
            if (sh > 1) v += (255 - v) * (sh - 1) * 2;
            if (dark) v += (sh - 1) * 70; // keep folds visible on dark colours
            od[i * 4 + c] = pd[i * 4 + c] * (1 - m) + v * m;
          }
        }
      }
    }

    // 2. Warp the design into the print area.
    if (withDesign && entry.hasDesign) {
      const side = entry.side;
      const trim = entry.rects.trim;
      const aspect = trim.w / trim.h;
      const r = window.POD_PHOTOS.rectFor(cfg, aspect);
      // The photo's print rect matches the side's standard print area; a garment
      // size or a moved print area puts the print somewhere else on the photo.
      const std = side.printArea;
      if (std && (trim.x !== std.x || trim.y !== std.y || trim.w !== std.w || trim.h !== std.h)) {
        const kx = r.w / std.w;
        const ky = r.h / std.h;
        const nr = { x: r.x + (trim.x - std.x) * kx, y: r.y + (trim.y - std.y) * ky, w: trim.w * kx, h: trim.h * ky };
        Object.assign(r, nr);
      }
      const ds = entry.designScale || S;
      const DW = entry.design.width;
      const dd = entry.design.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, DW, entry.design.height).data;
      const tx = trim.x * ds;
      const ty = trim.y * ds;
      const tw = trim.w * ds;
      const th = trim.h * ds;
      // Map a point in the print box to 0..1 of the design (cover-fit crops the overflow).
      let mapU;
      let mapV;
      if (cfg.fit === 'cover' && r.w / r.h > aspect) {
        const sh = r.w / aspect;
        mapU = (x) => (x - r.x) / r.w;
        mapV = (y) => (y - r.y + (sh - r.h) / 2) / sh;
      } else if (cfg.fit === 'cover') {
        const sw = r.h * aspect;
        mapU = (x) => (x - r.x + (sw - r.w) / 2) / sw;
        mapV = (y) => (y - r.y) / r.h;
      } else {
        mapU = (x) => (x - r.x) / r.w;
        mapV = (y) => (y - r.y) / r.h;
      }
      const cyl = cfg.warp === 'cylinder' ? cfg.cyl : null;
      out.focus = { x: (r.x + r.w / 2) / W, y: (r.y + r.h / 2) / H, w: Math.min(r.w, cyl ? 2 * cyl.R : r.w) / W };
      // A turned model: the print wraps round the torso (an upright elliptical cylinder).
      // Screen x = cx + R·sin(t + φ), where t is the angle round the body that the
      // straight-on photo shows at ref.cx + ref.a·sin(t). Scaled to this photo by
      // its collar-to-hem height, and to its measured torso width.
      let turn = null;
      if (cfg.turn) {
        const T = cfg.turn;
        const sy = (T.bot - T.top) / (T.ref.bot - T.ref.top);
        const th = (T.theta * Math.PI) / 180;
        let A = T.ref.a * sy;
        let B = T.depth * sy;
        const k = T.half / Math.hypot(A * Math.cos(th), B * Math.sin(th));
        A *= k;
        B *= k;
        const R = Math.hypot(A * Math.cos(th), B * Math.sin(th));
        turn = { T, sy, R, phi: Math.atan2(B * Math.sin(th), A * Math.cos(th)) };
      }
      const fabric = cfg.warp === 'fabric';
      const pillow = cfg.warp === 'pillow';
      const keepDark = cfg.keepDark || 0;
      const pad = 12;
      const kk = W / 1000; // photo coordinates are for a 1000-px-wide photo
      const x0 = Math.max(1, Math.floor((turn ? (turn.T.cx - turn.R) * kk : cyl ? cyl.cx - cyl.R : r.x) - pad));
      const x1 = Math.min(W - 2, Math.ceil((turn ? (turn.T.cx + turn.R) * kk : cyl ? cyl.cx + cyl.R : r.x + r.w) + pad));
      const y0 = Math.max(1, Math.floor((turn ? (turn.T.top + (r.y / kk - turn.T.ref.top) * turn.sy) * kk : r.y) - pad));
      const y1 = Math.min(H - 2, Math.ceil((turn ? (turn.T.top + (r.y / kk + r.h / kk - turn.T.ref.top) * turn.sy) * kk : r.y + r.h) + pad));
      const px = [0, 0, 0, 0];
      const sample = (fx, fy) => {
        const xa = Math.floor(fx);
        const ya = Math.floor(fy);
        if (xa < 0 || ya < 0 || xa >= DW - 1 || ya >= entry.design.height - 1) return false;
        const ax = fx - xa;
        const ay = fy - ya;
        const i00 = (ya * DW + xa) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + DW * 4;
        const i11 = i01 + 4;
        const w00 = (1 - ax) * (1 - ay);
        const w10 = ax * (1 - ay);
        const w01 = (1 - ax) * ay;
        const w11 = ax * ay;
        const a00 = dd[i00 + 3];
        const a10 = dd[i10 + 3];
        const a01 = dd[i01 + 3];
        const a11 = dd[i11 + 3];
        for (let c = 0; c < 3; c++) px[c] = (dd[i00 + c] * a00 * w00 + dd[i10 + c] * a10 * w10 + dd[i01 + c] * a01 * w01 + dd[i11 + c] * a11 * w11) / 255;
        px[3] = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
        return true;
      };
      const D = 260; // fold displacement strength (pixels per unit of brightness slope)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          const m = md[i * 4] / 255;
          if (m === 0 || lum[i] < keepDark) continue;
          let fx = x;
          let fy = y;
          if (turn) {
            const q = (x / kk - turn.T.cx) / turn.R;
            if (Math.abs(q) >= 0.995) continue;
            const t = Math.asin(q) - turn.phi;
            if (Math.abs(t) >= Math.PI / 2) continue; // round the side: hidden
            fx = (turn.T.ref.cx + turn.T.ref.a * Math.sin(t)) * kk;
            fy = (turn.T.ref.top + (y / kk - turn.T.top) / turn.sy) * kk;
            const gx = (blur[i + 2] - blur[i - 2]) / 4;
            const gy = (blur[i + 2 * W] - blur[i - 2 * W]) / 4;
            fx += Math.max(-5, Math.min(5, gx * D));
            fy += Math.max(-5, Math.min(5, gy * D));
          } else if (cyl) {
            const t = (x - cyl.cx) / cyl.R;
            if (Math.abs(t) >= 0.999) continue;
            fx = cyl.cx + Math.asin(t) * cyl.R;
          } else if (fabric) {
            const gx = (blur[i + 2] - blur[i - 2]) / 4;
            const gy = (blur[i + 2 * W] - blur[i - 2 * W]) / 4;
            fx = x + Math.max(-7, Math.min(7, gx * D));
            fy = y + Math.max(-7, Math.min(7, gy * D));
          } else if (pillow) {
            const nx = (x - (r.x + r.w / 2)) / (r.w / 2);
            const ny = (y - (r.y + r.h / 2)) / (r.h / 2);
            const puff = Math.max(0, (1 - nx * nx) * (1 - ny * ny));
            const k = 1 - 0.05 * puff;
            fx = r.x + r.w / 2 + (x - (r.x + r.w / 2)) * k;
            fy = r.y + r.h / 2 + (y - (r.y + r.h / 2)) * k;
          }
          const u = mapU(fx);
          const v = mapV(fy);
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          if (!sample(tx + u * tw, ty + v * th) || px[3] < 1) continue;
          const al = (px[3] / 255) * m;
          // Light the ink with the photo; let the fabric texture show through.
          const shade = Math.max(0.35, Math.min(1.06, lum[i] / white));
          const tex = fabric ? 1 + (lum[i] - blur[i]) * 1.6 : 1;
          for (let c = 0; c < 3; c++) {
            const ink = (px[c] / (px[3] / 255)) * shade * tex;
            od[i * 4 + c] = od[i * 4 + c] * (1 - al) + ink * al;
          }
        }
      }
      out.pxPerIn = r.w / entry.side.printWidthIn;
    }
    ctx.putImageData(img, 0, 0);

    // A cut-out copy (transparent background, cropped to the product) for the 3D view.
    const cut = document.createElement('canvas');
    cut.width = bbox.w;
    cut.height = bbox.h;
    const cctx = cut.getContext('2d');
    const cimg = cctx.createImageData(bbox.w, bbox.h);
    for (let y = 0; y < bbox.h; y++) {
      for (let x = 0; x < bbox.w; x++) {
        const si = ((y + bbox.y) * W + (x + bbox.x)) * 4;
        const di = (y * bbox.w + x) * 4;
        cimg.data[di] = od[si];
        cimg.data[di + 1] = od[si + 1];
        cimg.data[di + 2] = od[si + 2];
        cimg.data[di + 3] = md[si];
      }
    }
    cctx.putImageData(cimg, 0, 0);
    out.cutout = cut;
    out.productMask = md; // for sizedPicture (garment sizes)
    if (!out.pxPerIn) {
      const aspect = entry.rects.trim.w / entry.rects.trim.h;
      out.pxPerIn = window.POD_PHOTOS.rectFor(cfg, aspect).w / entry.side.printWidthIn;
    }
    return out;
  }
  // A print all the way round has its own photo (the mug seen from opposite the handle).
  const photoFor = (product, sideId) => {
    if (!window.POD_PHOTOS) return null;
    const wrap = (product.sides.find((s) => s.id === sideId) || {}).wrap;
    return window.POD_PHOTOS[`${product.id}:${sideId}${wrap ? ':wrap' : ''}`] || null;
  };
  /** Model photos for a product side ("On a model" view); [] if none. */
  const modelsFor = (product, sideId) => (window.POD_MODELS && window.POD_MODELS[`${product.id}:${sideId}`]) || [];

  // ---------- Modal ----------
  const $ = (id) => document.getElementById(id);
  let state = null;
  let three = null;

  function close() {
    $('pv').hidden = true;
    if (three) {
      three.dispose();
      three = null;
    }
    state = null;
  }

  async function realisticFor(sideId) {
    if (!state.real[sideId]) {
      const entry = state.sides.find((s) => s.side.id === sideId);
      const cfg = photoFor(state.product, sideId);
      // Real photo when there is one; the drawn mockup otherwise (or if the photo fails to load).
      state.real[sideId] = cfg
        ? renderPhoto(state.product, entry, cfg, state.color.hex).catch(() => renderRealistic(state.product, entry))
        : renderRealistic(state.product, entry);
    }
    return state.real[sideId];
  }
  async function plainFor(sideId) {
    const entry = state.sides.find((s) => s.side.id === sideId);
    const cfg = photoFor(state.product, sideId);
    return cfg ? renderPhoto(state.product, entry, cfg, state.color.hex, false) : null;
  }

  /** The 360° turn photos of a model (POD_TURNS), or null when this model doesn't turn. */
  const turnsFor = (product, m) => {
    const make = m && window.POD_TURNS && window.POD_TURNS[`${product.id}:${m.who}`];
    if (!make) return null;
    try {
      return make();
    } catch (e) {
      return null;
    }
  };
  /** One turn photo with the design: the front design on front angles, the back design on back angles. */
  function turnPicture(i) {
    const f = state.turnFrames[i];
    const key = `turn:${state.turnKey}:${i}`;
    if (!state.models[key]) {
      const own = f.side && state.sides.find((s) => s.side.id === f.side);
      state.models[key] = renderPhoto(state.product, own || state.sides[0], f, state.color.hex, Boolean(own));
    }
    return state.models[key];
  }
  /** Draw the current angle into the preview, and get the other angles ready in the background. */
  async function drawTurn() {
    const n = state.turnFrames.length;
    const i = ((state.turnIdx % n) + n) % n;
    state.turnIdx = i;
    const bar = $('pv-turn');
    bar.querySelector('input').value = String(i);
    bar.querySelector('.pv-turn-deg').textContent = `${POD.num(state.turnFrames[i].deg)}°`;
    const token = (state.turnToken = (state.turnToken || 0) + 1);
    const cv = await turnPicture(i);
    if (!state || token !== state.turnToken || state.tab !== 'model') return;
    let img = $('pv-body').querySelector('canvas.pv-canvas');
    if (!img) {
      setBody('');
      img = document.createElement('canvas');
      img.className = 'pv-canvas pv-turning';
      $('pv-body').appendChild(img);
    }
    img.width = cv.width;
    img.height = cv.height;
    img.getContext('2d').drawImage(cv, 0, 0);
    if (!state.turnWarm) {
      state.turnWarm = true;
      for (let k = 1; k < n; k++) {
        await new Promise((res) => setTimeout(res, 30));
        if (!state || !state.turnFrames) return;
        await turnPicture((i + k) % n).catch(() => null);
      }
    }
  }
  /** The turn controls (◀ slider ▶), made once under the picture. */
  function turnBar() {
    let bar = $('pv-turn');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'pv-turn';
    bar.className = 'pv-turn';
    bar.hidden = true;
    bar.innerHTML = `<button type="button" class="btn btn-sm" data-turn="-1" aria-label="${esc(t('pv.turnLeft'))}">◀</button>
      <input type="range" min="0" max="7" step="1" value="0" aria-label="${esc(t('pv.turn'))}">
      <button type="button" class="btn btn-sm" data-turn="1" aria-label="${esc(t('pv.turnRight'))}">▶</button>
      <span class="pv-turn-deg muted small"></span>`;
    $('pv-body').after(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-turn]');
      if (!b || !state || !state.turnFrames) return;
      state.turnIdx += +b.dataset.turn;
      drawTurn();
    });
    bar.querySelector('input').addEventListener('input', (e) => {
      if (!state || !state.turnFrames) return;
      state.turnIdx = +e.target.value;
      drawTurn();
    });
    // Drag the picture sideways to turn the model (one angle every 40 px).
    let drag = null;
    $('pv-body').addEventListener('pointerdown', (e) => {
      if (!state || state.tab !== 'model' || !state.turnFrames) return;
      drag = { x: e.clientX, idx: state.turnIdx };
      $('pv-body').setPointerCapture(e.pointerId);
    });
    $('pv-body').addEventListener('pointermove', (e) => {
      if (!drag || !state || !state.turnFrames) return;
      const step = Math.round((e.clientX - drag.x) / 40);
      const next = drag.idx + step;
      if (next !== state.turnIdx) {
        state.turnIdx = next;
        drawTurn();
      }
    });
    const end = () => { drag = null; };
    $('pv-body').addEventListener('pointerup', end);
    $('pv-body').addEventListener('pointercancel', end);
    return bar;
  }

  /** The design on model photo number `n` of a side (cached per side and model). */
  function modelPicture(sideId, n) {
    const key = `${sideId}:${n}`;
    if (!state.models[key]) {
      const entry = state.sides.find((s) => s.side.id === sideId);
      state.models[key] = renderPhoto(state.product, entry, modelsFor(state.product, sideId)[n], state.color.hex);
    }
    return state.models[key];
  }

  function setBody(html) {
    $('pv-body').innerHTML = html;
  }

  async function show() {
    const { tab } = state;
    document.querySelectorAll('[data-pv-tab]').forEach((b) => b.classList.toggle('active', b.dataset.pvTab === tab));
    // On a model: only the sides that have model photos.
    const sides = tab === 'model' ? state.sides.filter((s) => modelsFor(state.product, s.side.id).length) : state.sides;
    if (!sides.find((s) => s.side.id === state.sideId)) state.sideId = (sides.find((s) => s.hasDesign) || sides[0]).side.id;
    const { sideId } = state;
    const multi = sides.length > 1 && tab !== '3d';
    $('pv-sides').hidden = !multi;
    $('pv-sides').innerHTML = sides.map((s) => `<button class="side-tab ${s.side.id === sideId ? 'active' : ''}" data-pv-side="${s.side.id}">${esc(tr(s.side.name))}</button>`).join('');
    const models = tab === 'model' ? modelsFor(state.product, sideId) : [];
    if (state.model >= models.length) state.model = 0;
    if ($('pv-models')) {
      $('pv-models').hidden = models.length < 2;
      $('pv-models').innerHTML = models.map((m, i) => `<button class="side-tab ${i === state.model ? 'active' : ''}" data-pv-model="${i}">${esc(t('pv.who.' + m.who))}</button>`).join('');
    }
    $('pv-spin-wrap').hidden = tab !== '3d';
    // A model that turns: the turn controls replace the front/back tabs.
    const turning = tab === 'model' ? turnsFor(state.product, models[state.model]) : null;
    turnBar().hidden = !turning;
    if (turning) {
      const key = `${state.product.id}:${models[state.model].who}`;
      if (state.turnKey !== key) {
        state.turnKey = key;
        state.turnIdx = sideId === 'back' ? turning.findIndex((f) => f.deg === 180) : 0;
        state.turnWarm = false;
      }
      state.turnFrames = turning;
      $('pv-sides').hidden = true;
    } else {
      state.turnFrames = null;
    }
    const zoomHint = t(window.matchMedia('(hover: hover)').matches ? 'pv.zoomHover' : 'pv.zoomTap');
    $('pv-hint').textContent = tab === '3d' ? t('pv.drag') : tab === 'proof' ? t('pv.proofNote') : tab === 'model' ? (turning ? t('pv.turnNote') : `${t('pv.modelNote')} · ${zoomHint}`) : zoomHint;
    if (three && tab !== '3d') {
      three.dispose();
      three = null;
    }
    setBody(`<div class="pv-loading"><div class="spinner"></div>${esc(t('pv.loading'))}</div>`);
    const token = (state.token = (state.token || 0) + 1);
    try {
      if (tab === 'real') {
        const cv = await realisticFor(sideId);
        if (token !== state.token) return;
        setBody('');
        // Garment sizes: smaller sizes are shown smaller, like in the editor.
        const shown = sizedPicture(cv, state.viewScale, { whole: !state.product.photoChestCm });
        shown.className = 'pv-canvas';
        $('pv-body').appendChild(shown);
        zoomable(shown);
      } else if (tab === 'model' && turning) {
        setBody('');
        await drawTurn();
      } else if (tab === 'model') {
        const cv = await modelPicture(sideId, state.model);
        if (token !== state.token) return;
        setBody('');
        cv.className = 'pv-canvas';
        $('pv-body').appendChild(cv);
        zoomable(cv);
      } else if (tab === 'proof') {
        const cv = await realisticFor(sideId);
        const small = document.createElement('canvas');
        const sc = Math.min(1, 700 / cv.width);
        small.width = Math.round(cv.width * sc);
        small.height = Math.round(cv.height * sc);
        small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
        const blob = await new Promise((r) => small.toBlob(r, 'image/png'));
        const res = await fetch('/api/proof', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
        if (!res.ok) throw new Error(t('pv.proofFailed'));
        const url = URL.createObjectURL(await res.blob());
        if (token !== state.token) return;
        setBody(`<div class="pv-proof">
          <figure><img src="${small.toDataURL('image/png')}" alt=""><figcaption>${esc(t('pv.screen'))}</figcaption></figure>
          <figure><img src="${url}" alt=""><figcaption>${esc(t('pv.print'))}</figcaption></figure>
        </div>`);
      } else {
        const textures = {};
        for (const s of state.sides) {
          textures[s.side.id] = {
            design: s.design, wrap: s.wrap || null, pattern: s.pattern || null, designScale: s.designScale, rects: s.rects, hasDesign: s.hasDesign,
            real: await realisticFor(s.side.id), plain: await plainFor(s.side.id), baseImg: await loadImg(s.base),
          };
        }
        if (token !== state.token) return;
        let mod;
        try {
          mod = await import('/js/preview3d.js');
        } catch (e) {
          throw new Error(t('pv.no3d'));
        }
        setBody('<div class="pv-3d" id="pv-3d"></div>');
        three = mod.mount($('pv-3d'), { product: state.product, color: state.color, textures, spin: $('pv-spin').checked, viewScale: state.viewScale });
        if (!three) throw new Error(t('pv.no3d'));
      }
    } catch (e) {
      if (token === state.token) setBody(`<p class="muted" style="padding:40px;text-align:center">${esc(e.message)}</p>`);
    }
  }

  function download() {
    const name = `${state.product.id}-${state.tab}.png`;
    const save = (blob) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (state.tab === '3d' && three) three.snapshot().then(save);
    else if (state.tab === 'model' && state.turnFrames) turnPicture(state.turnIdx).then((cv) => cv.toBlob(save, 'image/png'));
    else if (state.tab === 'model') modelPicture(state.sideId, state.model).then((cv) => cv.toBlob(save, 'image/png'));
    else realisticFor(state.sideId).then((cv) => cv.toBlob(save, 'image/png'));
  }

  /**
   * Garment sizes: the product picture with the garment drawn smaller (k < 1)
   * in a frame of the same size, so a smaller size shows a smaller garment
   * rather than a smaller photo. The garment is cut out with the photo's mask,
   * the hole (and its old shadow) is filled from the backdrop around it, and
   * the garment goes back at its size with a soft shadow.
   */
  /**
   * Zoom on a preview picture. Mouse: the picture is magnified where the pointer is
   * (click holds the zoom, click again lets go). Touch: tap zooms in there, drag moves
   * round, tap again zooms out. "Zoom to the design" jumps to the print (pic.focus).
   */
  function zoomable(pic) {
    const body = pic.parentNode;
    const HOVER = 2.5;
    let scale = 1;
    let held = false;
    let ox = 0.5;
    let oy = 0.5;
    const apply = () => {
      pic.style.transformOrigin = `${(ox * 100).toFixed(2)}% ${(oy * 100).toFixed(2)}%`;
      pic.style.transform = scale > 1 ? `scale(${scale})` : '';
      pic.classList.toggle('pv-zoomed', scale > 1);
      btn.textContent = t(scale > 1 ? 'pv.zoomOut' : 'pv.zoomDesign');
    };
    const at = (e) => {
      const b = body.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))];
    };
    pic.classList.add('pv-zoomable');
    pic.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || held) return;
      [ox, oy] = at(e);
      scale = HOVER;
      apply();
    });
    pic.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || held) return;
      scale = 1;
      apply();
    });
    // Touch: a tap zooms in or out; a drag while zoomed moves the zoom round.
    let down = null;
    pic.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, ox, oy, moved: false, type: e.pointerType };
      if (e.pointerType !== 'mouse' && scale > 1) pic.setPointerCapture(e.pointerId);
    });
    pic.addEventListener('pointermove', (e) => {
      if (!down || down.type === 'mouse' || scale <= 1) return;
      const b = body.getBoundingClientRect();
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true;
      ox = Math.min(1, Math.max(0, down.ox - dx / (b.width * (scale - 1))));
      oy = Math.min(1, Math.max(0, down.oy - dy / (b.height * (scale - 1))));
      apply();
    });
    pic.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.moved) return;
      if (e.pointerType === 'mouse') {
        held = !held;
        if (!held) { [ox, oy] = at(e); scale = HOVER; }
      } else if (scale > 1) {
        scale = 1;
      } else {
        [ox, oy] = at(e);
        scale = HOVER;
      }
      apply();
    });
    // The picture fits its box (object-fit: contain): the print's place in the box.
    const focusPoint = () => {
      // (A canvas carries .focus; a picture element its .zoomFocus, as .focus is its own method.)
      const f = pic.zoomFocus || (typeof pic.focus === 'object' && pic.focus) || { x: 0.5, y: 0.5, w: 0.4 };
      const pw = pic.naturalWidth || pic.width;
      const ph = pic.naturalHeight || pic.height;
      const b = body.getBoundingClientRect();
      const k = Math.min(b.width / pw, b.height / ph);
      const fx = ((b.width - pw * k) / 2 + f.x * pw * k) / b.width;
      const fy = ((b.height - ph * k) / 2 + f.y * ph * k) / b.height;
      const fw = (f.w * pw * k) / b.width;
      return { fx, fy, s: Math.min(5, Math.max(2, 0.6 / Math.max(0.01, fw))) };
    };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm pv-zoom-btn';
    btn.addEventListener('click', () => {
      if (scale > 1) {
        scale = 1;
        held = false;
      } else {
        const p = focusPoint();
        [ox, oy, scale, held] = [p.fx, p.fy, p.s, true];
      }
      apply();
    });
    body.appendChild(btn);
    apply();
  }
  function sizedPicture(cv, k, opts) {
    const out = sizedPictureOf(cv, k, opts);
    if (out !== cv && cv.focus) out.focus = { x: 0.5 + (cv.focus.x - 0.5) * k, y: 0.5 + (cv.focus.y - 0.5) * k, w: cv.focus.w * k };
    return out;
  }
  function sizedPictureOf(cv, k, { whole = false } = {}) {
    if (!k || k >= 1) return cv;
    const W0 = cv.width;
    const H0 = cv.height;
    const N = W0 * H0;
    const src = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W0, H0);
    const sd = src.data;
    // whole: the photo shrinks as it is, its edges fading into the backdrop (products that stand on
    // something, like a sign on its easel, where filling the gap round a garment would leave smudges).
    const md = !whole && cv.productMask && cv.productMask.length === N * 4 ? cv.productMask : null;
    const canvasOf = (data) => {
      const c = document.createElement('canvas');
      c.width = W0;
      c.height = H0;
      if (data) c.getContext('2d').putImageData(data, 0, 0);
      return c;
    };
    // Backdrop colour: the average along the picture's edges (transparent pixels don't count:
    // drawn mockups usually have no backdrop at all, and theirs stays transparent).
    const sum = [0, 0, 0];
    let n = 0;
    const edge = (i) => { if (sd[i + 3] < 128) return; sum[0] += sd[i]; sum[1] += sd[i + 1]; sum[2] += sd[i + 2]; n++; };
    for (let x = 0; x < W0; x += 3) for (const y of [0, H0 - 1]) edge((y * W0 + x) * 4);
    for (let y = 0; y < H0; y += 3) for (const x of [0, W0 - 1]) edge((y * W0 + x) * 4);
    const fill = sum.map((v) => (n ? Math.round(v / n) : 255));
    const out = canvasOf(null);
    const ctx = out.getContext('2d');
    if (!md) {
      // No mask (drawn mockups): the picture smaller, on its backdrop colour.
      const x = (W0 - W0 * k) / 2;
      const y = (H0 - H0 * k) / 2;
      if (!n) {
        ctx.drawImage(cv, x, y, W0 * k, H0 * k);
        return out;
      }
      ctx.fillStyle = `rgb(${fill.join(',')})`;
      ctx.fillRect(0, 0, W0, H0);
      ctx.drawImage(cv, x, y, W0 * k, H0 * k);
      const f = Math.round(Math.min(W0, H0) * k * 0.22);
      const col = (a) => `rgba(${fill.join(',')},${a})`;
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[x, 0, x + f, 0, x, y, f, H0 * k], [x + W0 * k, 0, x + W0 * k - f, 0, x + W0 * k - f, y, f, H0 * k], [0, y, 0, y + f, x, y, W0 * k, f], [0, y + H0 * k, 0, y + H0 * k - f, x, y + H0 * k - f, W0 * k, f]]) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, col(1));
        g.addColorStop(1, col(0));
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
      }
      return out;
    }
    // 1. The hole: the garment plus a margin for its shadow.
    const holeImg = new ImageData(W0, H0);
    for (let i = 0; i < N; i++) holeImg.data[i * 4 + 3] = md[i * 4];
    const grow = canvasOf(null);
    const gctx = grow.getContext('2d', { willReadFrequently: true });
    gctx.filter = `blur(${Math.round(W0 * 0.035)}px)`;
    gctx.drawImage(canvasOf(holeImg), 0, 0);
    const ga = gctx.getImageData(0, 0, W0, H0).data;
    const hole = new Float32Array(N);
    for (let i = 0; i < N; i++) hole[i] = Math.max(md[i * 4] / 255, Math.min(1, (ga[i * 4 + 3] / 255) * 6));
    // 2. The backdrop with the hole filled, from what is left around it: a
    //    normalised blur on a coarse grid (in floating point, so no banding),
    //    stretched back up smoothly.
    const G = 8;
    const gw = Math.ceil(W0 / G);
    const gh = Math.ceil(H0 / G);
    const acc = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
    let wsum = new Float32Array(gw * gh);
    for (let y = 0; y < H0; y++) {
      for (let x = 0; x < W0; x++) {
        const i = y * W0 + x;
        const g = ((y / G) | 0) * gw + ((x / G) | 0);
        const wgt = 1 - hole[i];
        wsum[g] += wgt;
        for (let c = 0; c < 3; c++) acc[c][g] += sd[i * 4 + c] * wgt;
      }
    }
    let ch = acc;
    for (let pass = 0; pass < 3; pass++) {
      const r = Math.max(2, Math.round(gw * 0.08));
      ch = ch.map((a) => boxBlur(a, gw, gh, r));
      wsum = boxBlur(wsum, gw, gh, r);
    }
    const cell = (c, gx, gy) => {
      const g = Math.min(gh - 1, Math.max(0, gy)) * gw + Math.min(gw - 1, Math.max(0, gx));
      return wsum[g] > 1e-3 ? ch[c][g] / wsum[g] : fill[c];
    };
    const plate = new ImageData(W0, H0);
    const pd2 = plate.data;
    for (let y = 0; y < H0; y++) {
      const fy = y / G - 0.5;
      const gy = Math.floor(fy);
      const ty = fy - gy;
      for (let x = 0; x < W0; x++) {
        const i = y * W0 + x;
        const t = hole[i];
        if (t > 0) {
          const fx = x / G - 0.5;
          const gx = Math.floor(fx);
          const tx = fx - gx;
          for (let c = 0; c < 3; c++) {
            const v = (cell(c, gx, gy) * (1 - tx) + cell(c, gx + 1, gy) * tx) * (1 - ty) + (cell(c, gx, gy + 1) * (1 - tx) + cell(c, gx + 1, gy + 1) * tx) * ty;
            pd2[i * 4 + c] = sd[i * 4 + c] * (1 - t) + v * t;
          }
        } else {
          pd2[i * 4] = sd[i * 4];
          pd2[i * 4 + 1] = sd[i * 4 + 1];
          pd2[i * 4 + 2] = sd[i * 4 + 2];
        }
        pd2[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(plate, 0, 0);
    // 3. The garment, smaller, around the middle, with a soft shadow.
    const cutImg = new ImageData(W0, H0);
    for (let i = 0; i < N; i++) {
      cutImg.data[i * 4] = sd[i * 4];
      cutImg.data[i * 4 + 1] = sd[i * 4 + 1];
      cutImg.data[i * 4 + 2] = sd[i * 4 + 2];
      cutImg.data[i * 4 + 3] = md[i * 4];
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .22)';
    ctx.shadowBlur = W0 * 0.025 * k;
    ctx.shadowOffsetY = W0 * 0.01 * k;
    ctx.drawImage(canvasOf(cutImg), (W0 - W0 * k) / 2, (H0 - H0 * k) / 2, W0 * k, H0 * k);
    ctx.restore();
    return out;
  }

  function open(data) {
    state = { ...data, tab: 'real', sideId: data.startSide, real: {}, models: {}, model: 0 };
    // The "On a model" tab only for clothing that has model photos.
    const withModels = data.sides.some((s) => modelsFor(data.product, s.side.id).length);
    document.querySelectorAll('[data-pv-tab="model"]').forEach((b) => { b.hidden = !withModels; });
    if (!data.sides.find((s) => s.side.id === state.sideId && s.hasDesign)) {
      const withDesign = data.sides.find((s) => s.hasDesign);
      if (withDesign) state.sideId = withDesign.side.id;
    }
    $('pv').hidden = false;
    show();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('pv')) return; // pages without the preview window only use the renderers
    $('pv-close').addEventListener('click', close);
    $('pv').addEventListener('click', (e) => { if (e.target.id === 'pv') close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state) close(); });
    document.querySelectorAll('[data-pv-tab]').forEach((b) => b.addEventListener('click', () => {
      if (!state || state.tab === b.dataset.pvTab) return;
      state.tab = b.dataset.pvTab;
      show();
    }));
    $('pv-sides').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pv-side]');
      if (!b || !state) return;
      state.sideId = b.dataset.pvSide;
      show();
    });
    if ($('pv-models')) {
      $('pv-models').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pv-model]');
        if (!b || !state) return;
        state.model = +b.dataset.pvModel;
        show();
      });
    }
    $('pv-spin').addEventListener('change', (e) => three && three.setSpin(e.target.checked));
    $('pv-download').addEventListener('click', () => {
      try {
        if (state) download();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  window.POD_PREVIEW = { open, renderRealistic, renderPhoto, photoFor, modelsFor, sizedPicture, zoomable };
})();
