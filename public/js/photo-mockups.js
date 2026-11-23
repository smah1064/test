/* Photo mockups: real product photos (generated with Creative Claw, white
 * products on a light background, with a cut-out mask) and where the print
 * goes on each one. Coordinates are pixels of the 1000-px-wide photos.
 *
 *   rect   {cx, top, w}: print area centred at cx; its height follows the
 *          product's print-area proportions.
 *   box    {x, y, w, h} with fit "cover": the design fills the box and is
 *          cropped to it (edge-to-edge products whose photo proportions
 *          differ slightly from the print area).
 *   warp   fabric (follows folds) | cylinder (wraps around cx/R) | pillow | flat
 *   keepDark  photo pixels darker than this (camera lenses) are never printed over
 *   paper  area that keeps its white colour when the product colour changes
 *   base   colour of the product in the photo (default white)
 */
(function () {
  'use strict';
  const P = (name) => ({ src: `/mockups/photos/${name}.webp`, mask: `/mockups/photos/${name}-mask.png` });

  window.POD_PHOTOS = {
    'tshirt:front': { ...P('tshirt-front'), rect: { cx: 499, top: 322, w: 315 }, warp: 'fabric' },
    'tshirt:back': { ...P('tshirt-back'), rect: { cx: 499, top: 300, w: 306 }, warp: 'fabric' },
    'kidstee:front': { ...P('tshirt-front'), rect: { cx: 499, top: 315, w: 236 }, warp: 'fabric' },
    'kidstee:back': { ...P('tshirt-back'), rect: { cx: 499, top: 295, w: 230 }, warp: 'fabric' },
    'hoodie:front': { ...P('hoodie-front'), rect: { cx: 500, top: 368, w: 255 }, warp: 'fabric' },
    'hoodie:back': { ...P('hoodie-back'), rect: { cx: 502, top: 405, w: 290 }, warp: 'fabric' },
    'sweatshirt:front': { ...P('sweatshirt-front'), rect: { cx: 500, top: 330, w: 290 }, warp: 'fabric' },
    'sweatshirt:back': { ...P('sweatshirt-back'), rect: { cx: 500, top: 300, w: 290 }, warp: 'fabric' },
    'cap:front': { ...P('cap-front'), rect: { cx: 497, top: 390, w: 300 }, warp: 'cylinder', cyl: { cx: 497, R: 340 } },
    'mug:front': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'bottle:front': { ...P('bottle-front'), rect: { cx: 499.5, top: 540, w: 351 }, warp: 'cylinder', cyl: { cx: 499.5, R: 141.5 } },
    'cushion:front': { ...P('cushion-front'), rect: { cx: 501, top: 278, w: 680 }, warp: 'pillow' },
    'cushion:back': { ...P('cushion-front'), rect: { cx: 501, top: 278, w: 680 }, warp: 'pillow' },
    'poster:front': { ...P('poster-front'), box: { x: 220, y: 224, w: 562, h: 788 }, fit: 'cover', warp: 'flat', paper: { x: 218, y: 222, w: 566, h: 792 } },
    'tote:front': { ...P('tote-front'), rect: { cx: 502, top: 540, w: 420 }, warp: 'fabric', base: '#efe4cc' },
    'tote:back': { ...P('tote-front'), rect: { cx: 502, top: 540, w: 420 }, warp: 'fabric', base: '#efe4cc' },
    'phonecase:back': { ...P('phonecase-back'), box: { x: 286, y: 199, w: 428, h: 851 }, fit: 'cover', warp: 'flat', keepDark: 0.4 },
    'mousepad:front': { ...P('mousepad-front'), box: { x: 102, y: 280, w: 796, h: 682 }, fit: 'cover', warp: 'flat' },
    'notebook:front': { ...P('notebook-front'), box: { x: 180, y: 154, w: 666, h: 939 }, fit: 'cover', warp: 'flat' },
    'polo:front': { ...P('polo-front'), rect: { cx: 658, top: 345, w: 122 }, warp: 'fabric' },
    'polo:back': { ...P('polo-back'), rect: { cx: 502, top: 272, w: 379 }, warp: 'fabric' },
    'oversized:front': { ...P('oversized-front'), rect: { cx: 500, top: 341, w: 405 }, warp: 'fabric' },
    'oversized:back': { ...P('oversized-back'), rect: { cx: 500, top: 311, w: 413 }, warp: 'fabric' },
    'ziphoodie:front': { ...P('ziphoodie-front'), rect: { cx: 631, top: 410, w: 124 }, warp: 'fabric' },
    'ziphoodie:back': { ...P('hoodie-back'), rect: { cx: 504, top: 402, w: 339 }, warp: 'fabric' },
    'kidshoodie:front': { ...P('hoodie-front'), rect: { cx: 502, top: 372, w: 250 }, warp: 'fabric' },
    'kidshoodie:back': { ...P('hoodie-back'), rect: { cx: 504, top: 401, w: 320 }, warp: 'fabric' },
    'denim:back': { ...P('denim-back'), rect: { cx: 502, top: 470, w: 340 }, warp: 'fabric', base: '#4a6fa5' },
    'apron:front': { ...P('apron-front'), rect: { cx: 493, top: 330, w: 320 }, warp: 'fabric' },
    'onesie:front': { ...P('onesie-front'), rect: { cx: 501, top: 378, w: 290 }, warp: 'fabric' },
    'shorts:front': { ...P('shorts-front'), rect: { cx: 703, top: 661, w: 174 }, warp: 'fabric' },
  };

  // ---------- Recoloured product photos (cards, editor, thumbnails) ----------
  const loadImg = (src) => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image failed to load: ' + src));
    im.src = src;
  });
  const hexRgb = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bases = new Map();
  /** Photo + mask pixels at a given width, with brightness stats and the product's bounding box. */
  function photoBase(cfg, width) {
    const key = cfg.src + '|' + width;
    if (!bases.has(key)) {
      bases.set(key, Promise.all([loadImg(cfg.src), loadImg(cfg.mask)]).then(([ph, mk]) => {
        // Coordinates are pixels of a 1000-px-wide photo; CDNs may serve it resized.
        const k = width / 1000;
        const W = Math.round(width);
        const H = Math.round((width * ph.naturalHeight) / ph.naturalWidth);
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(ph, 0, 0, W, H);
        const pd = ctx.getImageData(0, 0, W, H).data;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(mk, 0, 0, W, H);
        const md = ctx.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        const samples = [];
        let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
        for (let i = 0; i < W * H; i++) {
          lum[i] = (0.299 * pd[i * 4] + 0.587 * pd[i * 4 + 1] + 0.114 * pd[i * 4 + 2]) / 255;
          if (md[i * 4] > 200 && i % 5 === 0) samples.push(lum[i]);
          if (md[i * 4] > 20) {
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
        return { W, H, k, pd, md, lum, white, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
      }));
    }
    return bases.get(key);
  }

  const renders = new Map();
  /**
   * The product photo recoloured to `hex` (same shading model as the live
   * preview), as a canvas. Options: width (processing width, default 1000),
   * cutout (transparent background), crop (trim to the product + padding).
   * The canvas carries .scale (canvas px per original photo px) and .offset.
   */
  function render(cfg, hex, opts = {}) {
    const width = opts.width || 1000;
    const key = [cfg.src, cfg.base || '', hex, width, opts.cutout ? 1 : 0, opts.crop || 0].join('|');
    if (!renders.has(key)) {
      renders.set(key, photoBase(cfg, width).then((b) => {
        const { W, H, pd, md, lum, white } = b;
        const base = hexRgb(cfg.base || '#ffffff');
        const target = hexRgb(hex);
        const recolour = target.some((v, i) => Math.abs(v - base[i]) > 6);
        const dark = (0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2]) / 255 < 0.35;
        const pk = cfg.paper ? {
          x: cfg.paper.x * b.k, y: cfg.paper.y * b.k, w: cfg.paper.w * b.k, h: cfg.paper.h * b.k,
        } : null;
        const keepDark = cfg.keepDark || 0;
        const img = new ImageData(W, H);
        const od = img.data;
        for (let i = 0; i < W * H; i++) {
          const m = md[i * 4] / 255;
          const o = i * 4;
          od[o] = pd[o];
          od[o + 1] = pd[o + 1];
          od[o + 2] = pd[o + 2];
          od[o + 3] = opts.cutout ? md[o] : 255;
          if (!recolour || m === 0 || lum[i] < keepDark) continue;
          if (pk) {
            const x = i % W;
            const y = (i - x) / W;
            if (x >= pk.x && x < pk.x + pk.w && y >= pk.y && y < pk.y + pk.h) continue;
          }
          const sh = lum[i] / white;
          for (let c = 0; c < 3; c++) {
            const base0 = base[c] / 255;
            let v = target[c] * Math.min(sh, 1) / Math.max(0.2, base0) * base0;
            if (sh > 1) v += (255 - v) * (sh - 1) * 2;
            if (dark) v += (sh - 1) * 70;
            od[o + c] = pd[o + c] * (1 - m) + v * m;
          }
        }
        const full = document.createElement('canvas');
        full.width = W;
        full.height = H;
        full.getContext('2d').putImageData(img, 0, 0);
        full.scale = b.k;
        full.offset = { x: 0, y: 0 };
        if (!opts.crop) return full;
        const pad = Math.round(Math.max(b.bbox.w, b.bbox.h) * opts.crop);
        const side = Math.max(b.bbox.w, b.bbox.h) + pad * 2;
        const out = document.createElement('canvas');
        out.width = side;
        out.height = side;
        const ox = Math.round(b.bbox.x + b.bbox.w / 2 - side / 2);
        const oy = Math.round(b.bbox.y + b.bbox.h / 2 - side / 2);
        out.getContext('2d').drawImage(full, -ox, -oy);
        out.scale = b.k;
        out.offset = { x: ox, y: oy };
        return out;
      }));
    }
    return renders.get(key);
  }

  /** Dark parts of the photo that are never printed on (camera lenses), as an overlay. */
  function darkOverlay(cfg, width = 1000) {
    return photoBase(cfg, width).then((b) => {
      const { W, H, pd, md, lum } = b;
      const img = new ImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (md[i * 4] < 128 || lum[i] >= cfg.keepDark) continue;
        img.data.set([pd[i * 4], pd[i * 4 + 1], pd[i * 4 + 2], 255], i * 4);
      }
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.getContext('2d').putImageData(img, 0, 0);
      c.scale = b.k;
      return c;
    });
  }

  /**
   * Where the photo goes in the editor's 500 x 600 mockup space so that its
   * measured print area lands exactly on the side's printArea:
   * { kx, ky (mockup units per photo px), x, y } for the photo's top-left corner.
   */
  function placement(cfg, printArea) {
    const aspect = printArea.w / printArea.h;
    const r = window.POD_PHOTOS.rectFor(cfg, aspect);
    if (cfg.box) {
      // Flat products: the photographed surface fills the print area exactly
      // (its shape can differ a little from the print size).
      const kx = printArea.w / r.w;
      const ky = printArea.h / r.h;
      return { k: kx, kx, ky, x: printArea.x - r.x * kx, y: printArea.y - r.y * ky };
    }
    // Curved products: the flat print width shows as a narrower arc on the photo.
    const rw = cfg.cyl ? 2 * cfg.cyl.R * Math.sin(Math.min(Math.PI / 2, r.w / 2 / cfg.cyl.R)) : r.w;
    const k = cfg.cyl ? Math.sqrt((printArea.w / rw) * (printArea.h / r.h)) : printArea.w / r.w;
    const cx = printArea.x + printArea.w / 2;
    const cy = printArea.y + printArea.h / 2;
    return { k, kx: k, ky: k, x: cx - (r.x + r.w / 2) * k, y: cy - (r.y + r.h / 2) * k };
  }

  /** Photo config for a product side, or null if it only has a drawn mockup. */
  const forSide = (productId, sideId) => window.POD_PHOTOS[`${productId}:${sideId}`] || null;

  Object.assign(window.POD_PHOTOS, { render, darkOverlay, placement, forSide });

  /** Print rectangle in photo pixels for a product side. */
  window.POD_PHOTOS.rectFor = function (cfg, aspect) {
    if (cfg.box) return { ...cfg.box };
    const h = cfg.rect.w / aspect;
    return { x: cfg.rect.cx - cfg.rect.w / 2, y: cfg.rect.top, w: cfg.rect.w, h };
  };
})();
