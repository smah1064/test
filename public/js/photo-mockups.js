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
    'jersey:front': { ...P('jersey-front'), rect: { cx: 505, top: 330, w: 300 }, warp: 'fabric' },
    'jersey:back': { ...P('jersey-back'), rect: { cx: 505, top: 262, w: 330 }, warp: 'fabric' },
    'magicmug:front': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'couplemugs:mug1': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'couplemugs:mug2': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'tumbler:front': { ...P('tumbler-front'), rect: { cx: 499.5, top: 372, w: 405 }, warp: 'cylinder', cyl: { cx: 499.5, R: 163.5 } },
    'coasters:front': { ...P('coaster-front'), box: { x: 197, y: 314, w: 606, h: 600 }, fit: 'cover', warp: 'flat' },
    'tablecloth:front': { ...P('tablecloth-front'), box: { x: 122, y: 145, w: 754, h: 966 }, fit: 'cover', warp: 'fabric' },
    'prayermat:front': { ...P('prayermat-front'), box: { x: 234, y: 152, w: 532, h: 935 }, fit: 'cover', warp: 'fabric' },
    'eidenvelopes:front': { ...P('envelope-front'), box: { x: 314, y: 279, w: 371, h: 679 }, fit: 'cover', warp: 'flat' },
    'greetingcard:front': { ...P('card-front'), rect: { cx: 470, top: 306, w: 428 }, warp: 'flat' },
    'plaque:front': { ...P('plaque-front'), box: { x: 240, y: 240, w: 524, h: 760 }, fit: 'cover', warp: 'flat' },
    'sign:front': { ...P('sign-front'), box: { x: 280, y: 193, w: 441, h: 602 }, fit: 'cover', warp: 'flat' },
    'deskmat:front': { ...P('deskmat-front'), box: { x: 58, y: 430, w: 884, h: 376 }, fit: 'cover', warp: 'flat' },
    'keychain:front': { ...P('keychain-front'), rect: { cx: 500, top: 528, w: 340 }, warp: 'flat' },
    'stickersheet:front': { ...P('stickers-front'), box: { x: 210, y: 212, w: 580, h: 816 }, fit: 'cover', warp: 'flat' },
    'namelabels:front': { ...P('labels-front'), box: { x: 178, y: 385, w: 643, h: 468 }, fit: 'cover', warp: 'flat' },
    'lunchbag:front': { ...P('lunchbag-front'), rect: { cx: 502, top: 500, w: 470 }, warp: 'fabric' },
    'pencilcase:front': { ...P('pencilcase-front'), rect: { cx: 500, top: 450, w: 640 }, warp: 'fabric', base: '#efe4cc' },
    'bizcards:front': { ...P('bizcard-front'), box: { x: 185, y: 422, w: 630, h: 392 }, fit: 'cover', warp: 'flat' },
    'bizcards:back': { ...P('bizcard-front'), box: { x: 185, y: 422, w: 630, h: 392 }, fit: 'cover', warp: 'flat' },
    'flyers:front': { ...P('flyer-front'), box: { x: 222, y: 245, w: 545, h: 760 }, fit: 'cover', warp: 'flat' },
    'flyers:back': { ...P('flyer-front'), box: { x: 222, y: 245, w: 545, h: 760 }, fit: 'cover', warp: 'flat' },
    'letterhead:front': { ...P('letterhead-front'), box: { x: 187, y: 168, w: 627, h: 906 }, fit: 'cover', warp: 'flat' },
    'dlenvelopes:front': { ...P('dlenvelope-front'), rect: { cx: 500, top: 433, w: 748 }, warp: 'flat' },
    'logostickers:front': { ...P('roundsticker-front'), box: { x: 202, y: 324, w: 592, h: 592 }, fit: 'cover', warp: 'flat' },
    'rollup:front': { ...P('rollup-front'), box: { x: 306, y: 158, w: 388, h: 912 }, fit: 'cover', warp: 'flat' },
    'paperbags:front': { ...P('paperbag-front'), rect: { cx: 499, top: 520, w: 380 }, warp: 'flat' },
    'invoicebook:front': { ...P('invoicebook-front'), rect: { cx: 498, top: 252, w: 523 }, warp: 'flat' },
    'idcards:front': { ...P('idcard-front'), box: { x: 335, y: 482, w: 330, h: 520 }, fit: 'cover', warp: 'flat' },
    'idcards:back': { ...P('idcard-front'), box: { x: 335, y: 482, w: 330, h: 520 }, fit: 'cover', warp: 'flat' },
  };

  /*
   * Model photos (the "On a model" view): people wearing the blank white
   * garment, with a mask of the garment only (skin, hair and backdrop are
   * never recoloured or printed on). Same coordinates as above: pixels of the
   * 1000-px-wide photo. `who` names the model for the chips (pv.who.*).
   */
  const M = (name, who, rect) => ({ src: `/mockups/models/${name}.webp`, mask: `/mockups/models/${name}-mask.png`, who, rect, warp: 'fabric' });
  window.POD_MODELS = {
    'tshirt:front': [M('tshirt-man-front', 'man', { cx: 507, top: 433, w: 218 }), M('tshirt-woman-front', 'woman', { cx: 501, top: 459, w: 216 })],
    'tshirt:back': [M('tshirt-man-back', 'man', { cx: 504, top: 363, w: 196 }), M('tshirt-woman-back', 'woman', { cx: 505, top: 396, w: 198 })],
    'oversized:front': [M('oversized-man-front', 'man', { cx: 510, top: 422, w: 214 }), M('oversized-woman-front', 'woman', { cx: 504, top: 448, w: 246 })],
    'oversized:back': [M('oversized-man-back', 'man', { cx: 503, top: 354, w: 223 })],
    'kidstee:front': [M('kidstee-boy-front', 'boy', { cx: 505, top: 467, w: 190 }), M('kidstee-girl-front', 'girl', { cx: 507, top: 471, w: 199 })],
    'kidstee:back': [M('kidstee-boy-back', 'boy', { cx: 506, top: 411, w: 170 })],
    'hoodie:front': [M('hoodie-man-front', 'man', { cx: 503, top: 412, w: 191 }), M('hoodie-woman-front', 'woman', { cx: 502, top: 435, w: 189 })],
    'hoodie:back': [M('hoodie-man-back', 'man', { cx: 504, top: 495, w: 196 })],
    'kidshoodie:front': [M('kidshoodie-boy-front', 'boy', { cx: 504, top: 459, w: 168 }), M('kidshoodie-girl-front', 'girl', { cx: 507, top: 461, w: 176 })],
    'ziphoodie:front': [M('ziphoodie-man-front', 'man', { cx: 580, top: 443, w: 73 })],
    'sweatshirt:front': [M('sweatshirt-man-front', 'man', { cx: 503, top: 439, w: 218 }), M('sweatshirt-woman-front', 'woman', { cx: 501, top: 457, w: 216 })],
    'sweatshirt:back': [M('sweatshirt-man-back', 'man', { cx: 504, top: 355, w: 196 })],
    'polo:front': [M('polo-man-front', 'man', { cx: 584, top: 452, w: 63 })],
    'polo:back': [M('polo-man-back', 'man', { cx: 509, top: 326, w: 193 })],
    'jersey:front': [M('jersey-man-front', 'man', { cx: 509, top: 420, w: 178 })],
    'jersey:back': [M('jersey-man-back', 'man', { cx: 508, top: 342, w: 185 })],
    'ziphoodie:back': [M('hoodie-man-back', 'man', { cx: 504, top: 495, w: 196 })],
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
