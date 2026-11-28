/*
 * Measuring round drinkware from photos ("New product from photo", slice 2). Pure JS, no dependencies; the admin
 * wizard (browser) and node:test both run it. The card comes from calib-detect.js (POD_CALIB.detectCard / fromTaps).
 *
 * COORDINATES
 *   Images: { data: Uint8ClampedArray RGBA, width, height }; masks: { data: Uint8Array (1 = product), width, height }.
 *   Pixel coordinates are continuous: pixel (i, j) covers [i, i+1) × [j, j+1), centre (i + 0.5, j + 0.5), y down.
 *   Card mm: real millimetres on the card's plane (calib-detect.js), origin at the page's top-left, y down.
 *   A RECTIFIED image shows the card plane head-on: its pixel (i, j) is card point
 *     (offsetMm[0] + (i + 0.5) / pxPerMm, offsetMm[1] + (j + 0.5) / pxPerMm)
 *   so 1 rectified px = 1 / pxPerMm mm in the plane of the product's centre line (where the card stands).
 *   Product heights `y…Mm` (profile, handle) are measured along the product's axis FROM THE RIM DOWN.
 *
 * API (POD_DWMEASURE)
 *   rectify(img, card, { pxPerMm = 5, roi, wb = true, maxPixels = 8e6 } = {}) -> { img, pxPerMm, offsetMm:[x, y] }
 *     The photo resampled into the card plane (bilinear) and white-balanced with card.wb. roi = { x, y, w, h } in card
 *     mm (default: everything the photo shows, limited to a 2 × 1.4 m window round the card). Outside the photo:
 *     transparent white. pxPerMm is lowered if the result would pass maxPixels.
 *   rectifyMask(mask, card, rect) -> mask resampled the same way (for the server's cut-out of the original photo).
 *   maskFromBackground(img, { card, rect, tol } = {}) -> mask (+ tol, bg: the colour tolerance and backdrop used)
 *     Flood fill from the borders over the plain backdrop; what the fill can't reach is the product; only the largest
 *     piece is kept. Two passes: an adaptive fill (its drift capped, so it can't creep along a soft edge) finds the
 *     backdrop, then a smooth backdrop model (cell medians, interpolated) is filled against, so slow shading and
 *     vignetting don't matter. With `card` (+ `rect` = rectify's result when img is rectified) the
 *     card's face (+4 mm) counts as backdrop, so it is never part of the product (keep a gap between card and cup).
 *   measureFront(rectImg, mask, { pxPerMm, offsetMm, card } = {})
 *     -> { heightMm, topDiaMm, bottomDiaMm, profile:[[yMm, rMm] … ≤ 64], axisXpx, rimYpx, baseYpx, leanDeg, outline:[[x,y] …],
 *          // also: widthCorr (the factor applied to widths, 1 without card.cam), handleSeen (a handle shows in the front),
 *          //       blurPx (the photo's blur in rectified px, Gaussian sigma)
 *        }   or null when the mask holds no usable silhouette.
 *     Call it as measureFront(rect.img, mask, { ...rect, card }) (rect = rectify's result, card = detectCard's).
 *     The axis is fitted (a slightly leaning cup is fine). Height is measured between the silhouette's SIDE CORNERS —
 *     where the outline leaves the straight sides into the rim's (and the base's) ellipse, found by fitting that
 *     ellipse — not at the ellipse's top, which overstates the height (plan section C). The ellipse is fitted on the
 *     width per row (unchanged by the shear of a cup seen from one side), with each row's coverage measured by area and
 *     the photo's blur (measured on the straight sides) in the model; a leaning cup is first turned upright about its
 *     fitted axis. axisXpx (at the rim), rimYpx, baseYpx and outline are rectified px. Passing `card` (calib-detect's
 *     result, with cam) and `offsetMm`:
 *       - corrects widths for the camera seeing the product from the side of the card's normal (× cos of that angle;
 *         ≈ 0.5 % at 6°, 2 % at 11°) and for the silhouette's own perspective (× sqrt(1 − (R/L)²));
 *       - gives the rim's ellipse depth from the camera's height and distance, needed when the camera is level with
 *         the rim and the ellipse is no deeper than the blur.
 *   measureSide(rectImg, mask, opts) -> { handle:{ y0Mm, y1Mm, widthMm, reachMm, side } | null, profile, heightMm, … }
 *     The handle is where one side sticks out more than 3 mm beyond the body. y0/y1 from the rim down. A side photo
 *     cannot show how wide the handle is where it meets the cup (that faces the camera): widthMm = reachMm = how far it
 *     sticks out from the body, an upper bound that keeps the print well clear of the handle. Typed values win.
 *   bandLinearityMm(profile, print) -> max distance (mm) of the profile from the straight cone (chord) between the print
 *     band's edges; print = { topMm, heightMm } (or { printTopMm, printHeightMm }). Above 0.5 mm the fan is approximate.
 *   compare(typed, measured) -> { heightPct, topPct, bottomPct, warn: ['heightPct' | 'topPct' | 'bottomPct' …] }
 *     (measured − typed) / typed in %, 0.1 steps; warn lists the ones over 2 % (null when a value is missing).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.POD_DWMEASURE = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const WARN_PCT = 2;
  const HANDLE_MM = 3;
  const INNER = 5; // px from the mask's edge beyond which a pixel counts as fully covered (at least; 3σ of the blur)

  const applyH = (H, x, y) => {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  // ----------------------------------------------------------------------------------------------------------- rectify
  function defaultRoi(img, card) {
    const s = card.cardScale || 1;
    const lim = { x0: -900 * s, x1: 1110 * s, y0: -500 * s, y1: 900 * s };
    const pts = [[0, 0], [img.width, 0], [0, img.height], [img.width, img.height]];
    const H = card.Hinv;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, bad = false;
    for (const [x, y] of pts) {
      const w = H[6] * x + H[7] * y + H[8];
      if (!(w > 0)) { bad = true; break; }
      const [u, v] = applyH(H, x, y);
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    if (bad) return { x: lim.x0, y: lim.y0, w: lim.x1 - lim.x0, h: lim.y1 - lim.y0 };
    x0 = Math.max(lim.x0, x0); x1 = Math.min(lim.x1, x1); y0 = Math.max(lim.y0, y0); y1 = Math.min(lim.y1, y1);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  function plan(img, card, opts) {
    const roi = opts.roi || defaultRoi(img, card);
    let ppm = Number(opts.pxPerMm) > 0 ? Number(opts.pxPerMm) : 5;
    const maxPixels = opts.maxPixels || 8e6;
    if (roi.w * roi.h * ppm * ppm > maxPixels) ppm = Math.sqrt(maxPixels / (roi.w * roi.h));
    const W = Math.max(1, Math.round(roi.w * ppm)), H = Math.max(1, Math.round(roi.h * ppm));
    return { roi, ppm, W, H };
  }

  // Calls fn(k, sx, sy) for every output pixel with its source position (continuous px).
  function eachSource(card, P, fn) {
    const Hm = card.H;
    for (let j = 0; j < P.H; j++) {
      const my = P.roi.y + (j + 0.5) / P.ppm;
      for (let i = 0; i < P.W; i++) {
        const mx = P.roi.x + (i + 0.5) / P.ppm;
        const w = Hm[6] * mx + Hm[7] * my + Hm[8];
        fn(j * P.W + i, (Hm[0] * mx + Hm[1] * my + Hm[2]) / w, (Hm[3] * mx + Hm[4] * my + Hm[5]) / w);
      }
    }
  }

  function rectify(img, card, opts = {}) {
    const P = plan(img, card, opts);
    const out = new Uint8ClampedArray(P.W * P.H * 4);
    const { width: SW, height: SH, data } = img;
    const g = opts.wb === false || !card.wb ? [1, 1, 1] : card.wb;
    eachSource(card, P, (k, sx, sy) => {
      const o = k * 4;
      const fx = sx - 0.5, fy = sy - 0.5;
      if (!(fx >= -0.5 && fy >= -0.5 && fx <= SW - 0.5 && fy <= SH - 0.5)) {
        out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; return;
      }
      const x0 = Math.max(0, Math.min(SW - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(SH - 1, Math.floor(fy)));
      const x1 = Math.min(SW - 1, x0 + 1), y1 = Math.min(SH - 1, y0 + 1);
      const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
      const p00 = (y0 * SW + x0) * 4, p10 = (y0 * SW + x1) * 4, p01 = (y1 * SW + x0) * 4, p11 = (y1 * SW + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (data[p00 + c] * (1 - ax) + data[p10 + c] * ax) * (1 - ay) + (data[p01 + c] * (1 - ax) + data[p11 + c] * ax) * ay;
        out[o + c] = v * g[c];
      }
      out[o + 3] = 255;
    });
    return { img: { data: out, width: P.W, height: P.H }, pxPerMm: P.ppm, offsetMm: [P.roi.x, P.roi.y] };
  }

  function rectifyMask(mask, card, rect) {
    const ppm = rect.pxPerMm;
    const P = { roi: { x: rect.offsetMm[0], y: rect.offsetMm[1] }, ppm, W: rect.img ? rect.img.width : rect.width, H: rect.img ? rect.img.height : rect.height };
    const out = new Uint8Array(P.W * P.H);
    const { width: SW, height: SH, data } = mask;
    eachSource(card, P, (k, sx, sy) => {
      const fx = sx - 0.5, fy = sy - 0.5;
      if (!(fx >= 0 && fy >= 0 && fx <= SW - 1 && fy <= SH - 1)) return;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(SW - 1, x0 + 1), y1 = Math.min(SH - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const v = (data[y0 * SW + x0] * (1 - ax) + data[y0 * SW + x1] * ax) * (1 - ay) + (data[y1 * SW + x0] * (1 - ax) + data[y1 * SW + x1] * ax) * ay;
      if (v >= 0.5) out[k] = 1;
    });
    return { data: out, width: P.W, height: P.H };
  }

  // --------------------------------------------------------------------------------------------------------- the mask
  function cardRegion(img, card, rect) {
    if (!card) return null;
    const s = card.cardScale || 1, m = 4;
    const x0 = -m, x1 = 210 * s + m, y0 = -m, y1 = 200 * s + m;
    const out = new Uint8Array(img.width * img.height);
    if (rect && rect.pxPerMm && rect.offsetMm) {
      const ppm = rect.pxPerMm, [ox, oy] = rect.offsetMm;
      const i0 = Math.max(0, Math.floor((x0 - ox) * ppm)), i1 = Math.min(img.width, Math.ceil((x1 - ox) * ppm));
      const j0 = Math.max(0, Math.floor((y0 - oy) * ppm)), j1 = Math.min(img.height, Math.ceil((y1 - oy) * ppm));
      for (let j = j0; j < j1; j++) out.fill(1, j * img.width + i0, j * img.width + Math.max(i0, i1));
      return out;
    }
    if (!card.H || !card.Hinv) return null;
    const q = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => applyH(card.H, x, y));
    const i0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[0])))), i1 = Math.min(img.width, Math.ceil(Math.max(...q.map((p) => p[0]))));
    const j0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1])))), j1 = Math.min(img.height, Math.ceil(Math.max(...q.map((p) => p[1]))));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const [u, v] = applyH(card.Hinv, i + 0.5, j + 0.5);
      if (u >= x0 && u <= x1 && v >= y0 && v <= y1) out[j * img.width + i] = 1;
    }
    return out;
  }

  function maskFromBackground(img, opts = {}) {
    const { width: W, height: H, data } = img;
    const N = W * H;
    const cardM = cardRegion(img, opts.card, opts.rect);
    // Backdrop colour and noise from the border.
    const border = [];
    const noise = [];
    const pushB = (x, y) => {
      const k = y * W + x;
      if (data[k * 4 + 3] === 0 || (cardM && cardM[k])) return;
      border.push(k);
      if (x + 1 < W && data[k * 4 + 7] !== 0) noise.push(Math.abs(data[k * 4] - data[k * 4 + 4]) + Math.abs(data[k * 4 + 1] - data[k * 4 + 5]));
    };
    for (let x = 0; x < W; x++) { pushB(x, 0); pushB(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { pushB(0, y); pushB(W - 1, y); }
    const bg = [0, 1, 2].map((c) => median(border.map((k) => data[k * 4 + c])));
    const sigma = (median(noise) || 0) / 1.6;
    const tol = opts.tol || Math.max(16, Math.min(60, 6 * sigma + 10));
    const tol2 = tol * tol;
    const free = (k) => data[k * 4 + 3] === 0 || Boolean(cardM && cardM[k]);
    const queue = new Int32Array(N);

    // The largest 4-connected piece of pixels NOT reached by a fill.
    const largestUnreached = (seen) => {
      const out = new Uint8Array(N);
      const lab = new Int32Array(N);
      let bestLab = 0, bestN = 0, next = 0;
      for (let k = 0; k < N; k++) {
        if (seen[k] || lab[k]) continue;
        next++;
        let n = 0, qh = 0, qt = 0;
        queue[qt++] = k; lab[k] = next;
        while (qh < qt) {
          const c = queue[qh++]; n++;
          const x = c % W, y = (c - x) / W;
          if (x + 1 < W && !seen[c + 1] && !lab[c + 1]) { lab[c + 1] = next; queue[qt++] = c + 1; }
          if (x > 0 && !seen[c - 1] && !lab[c - 1]) { lab[c - 1] = next; queue[qt++] = c - 1; }
          if (y + 1 < H && !seen[c + W] && !lab[c + W]) { lab[c + W] = next; queue[qt++] = c + W; }
          if (y > 0 && !seen[c - W] && !lab[c - W]) { lab[c - W] = next; queue[qt++] = c - W; }
        }
        if (n > bestN) { bestN = n; bestLab = next; }
      }
      if (bestLab) for (let k = 0; k < N; k++) if (lab[k] === bestLab) out[k] = 1;
      return out;
    };
    // Breadth-first fill from `seeds`; accept(n, from) decides each step.
    const fill = (seen, qt0, accept) => {
      let qh = 0, qt = qt0;
      while (qh < qt) {
        const k = queue[qh++];
        const x = k % W, y = (k - x) / W;
        for (let d = 0; d < 4; d++) {
          let n;
          if (d === 0) { if (x + 1 >= W) continue; n = k + 1; } else if (d === 1) { if (x < 1) continue; n = k - 1; } else if (d === 2) { if (y + 1 >= H) continue; n = k + W; } else { if (y < 1) continue; n = k - W; }
          if (seen[n]) continue;
          if (free(n) || accept(n, k)) { seen[n] = 1; queue[qt++] = n; }
        }
      }
    };

    // Pass 1: an adaptive fill (the reference colour follows slow shading), its drift from the seed's colour capped so
    // it can't creep into the product along a soft edge. Only used to learn where the backdrop is.
    const ref = new Float32Array(N * 3), seedC = new Float32Array(N * 3);
    const seen1 = new Uint8Array(N);
    let qt = 0;
    const seed1 = (k, col) => {
      seen1[k] = 1; queue[qt++] = k;
      for (let c = 0; c < 3; c++) { ref[k * 3 + c] = col[c]; seedC[k * 3 + c] = col[c]; }
    };
    for (let k = 0; k < N; k++) if (free(k)) seed1(k, bg);
    for (const k of border) {
      const col = [data[k * 4], data[k * 4 + 1], data[k * 4 + 2]];
      if (!seen1[k] && (col[0] - bg[0]) ** 2 + (col[1] - bg[1]) ** 2 + (col[2] - bg[2]) ** 2 < 4 * tol2) seed1(k, col);
    }
    const drift2 = (2.5 * tol) ** 2;
    fill(seen1, qt, (n, k) => {
      const p = n * 4, o = k * 3;
      let d = 0;
      for (let c = 0; c < 3; c++) d += (data[p + c] - ref[o + c]) ** 2;
      if (!(d < tol2)) return false;
      let e = 0;
      for (let c = 0; c < 3; c++) {
        const v = 0.9 * ref[o + c] + 0.1 * data[p + c];
        ref[n * 3 + c] = v; seedC[n * 3 + c] = seedC[o + c];
        e += (v - seedC[o + c]) ** 2;
      }
      if (e > drift2) for (let c = 0; c < 3; c++) ref[n * 3 + c] = ref[o + c];
      return true;
    });
    const mask1 = largestUnreached(seen1);

    // Backdrop model: per-cell medians of the backdrop (clear of the first mask's blur halo), holes filled from the
    // neighbours, interpolated between cell centres.
    const G = Math.max(12, Math.round(Math.max(W, H) / 40));
    const gw = Math.ceil(W / G), gh = Math.ceil(H / G);
    const hist = new Uint32Array(gw * gh * 768), cnt = new Uint32Array(gw * gh);
    const HALO = 4;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const k = y * W + x;
      if (free(k) || mask1[k]) continue;
      if ((x >= HALO && mask1[k - HALO]) || (x + HALO < W && mask1[k + HALO]) || (y >= HALO && mask1[k - HALO * W]) || (y + HALO < H && mask1[k + HALO * W])) continue;
      const cell = Math.floor(y / G) * gw + Math.floor(x / G);
      for (let c = 0; c < 3; c++) hist[cell * 768 + c * 256 + data[k * 4 + c]]++;
      cnt[cell]++;
    }
    const model = new Float32Array(gw * gh * 3);
    const have = new Uint8Array(gw * gh);
    for (let cell = 0; cell < gw * gh; cell++) {
      if (cnt[cell] < (G * G) / 20) continue;
      for (let c = 0; c < 3; c++) {
        let acc = 0, v = 0;
        for (; v < 256; v++) { acc += hist[cell * 768 + c * 256 + v]; if (acc * 2 >= cnt[cell]) break; }
        model[cell * 3 + c] = v;
      }
      have[cell] = 1;
    }
    if (!have.some(Boolean)) for (let cell = 0; cell < gw * gh; cell++) { model.set(bg, cell * 3); have[cell] = 1; }
    for (let guard = 0; guard < gw + gh && !have.every(Boolean); guard++) {
      const add = [];
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        if (have[j * gw + i]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= gw || jj >= gh || !have[jj * gw + ii]) continue;
          for (let c = 0; c < 3; c++) sum[c] += model[(jj * gw + ii) * 3 + c];
          n++;
        }
        if (n) add.push([j * gw + i, sum.map((v) => v / n)]);
      }
      for (const [cell, col] of add) { model.set(col, cell * 3); have[cell] = 1; }
    }
    const bgAt = (x, y, out) => {
      const fx = Math.max(0, Math.min(gw - 1, (x + 0.5) / G - 0.5)), fy = Math.max(0, Math.min(gh - 1, (y + 0.5) / G - 0.5));
      const i0 = Math.floor(fx), j0 = Math.floor(fy), i1 = Math.min(gw - 1, i0 + 1), j1 = Math.min(gh - 1, j0 + 1);
      const ax = fx - i0, ay = fy - j0;
      for (let c = 0; c < 3; c++) {
        out[c] = (model[(j0 * gw + i0) * 3 + c] * (1 - ax) + model[(j0 * gw + i1) * 3 + c] * ax) * (1 - ay)
          + (model[(j1 * gw + i0) * 3 + c] * (1 - ax) + model[(j1 * gw + i1) * 3 + c] * ax) * ay;
      }
    };

    // Pass 2: fill from the borders over everything close to the model.
    const B = [0, 0, 0];
    const near = (n) => {
      const x = n % W;
      bgAt(x, (n - x) / W, B);
      const p = n * 4;
      return (data[p] - B[0]) ** 2 + (data[p + 1] - B[1]) ** 2 + (data[p + 2] - B[2]) ** 2 < tol2;
    };
    const seen2 = new Uint8Array(N);
    qt = 0;
    for (let k = 0; k < N; k++) if (free(k)) { seen2[k] = 1; queue[qt++] = k; }
    for (const k of border) if (!seen2[k] && near(k)) { seen2[k] = 1; queue[qt++] = k; }
    fill(seen2, qt, (n) => near(n));
    return { data: largestUnreached(seen2), width: W, height: H, tol, bg };
  }

  // ---------------------------------------------------------------------------------------------- silhouette analysis
  /** Per row: left/right edges (continuous px, refined to sub-pixel with the image where the contrast allows). */
  function rowEdges(img, mask) {
    const { width: W, height: H } = mask;
    const L = new Float64Array(H).fill(NaN), R = new Float64Array(H).fill(NaN);
    const d = img && img.data;
    const col = (x, y) => { const p = (y * W + x) * 4; return [d[p], d[p + 1], d[p + 2], d[p + 3]]; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const K = 8; // px each side of the mask edge: wider than any blur the gates let through
    const IN = 14; // the product's own colour is read this far inside the edge
    for (let y = 0; y < H; y++) {
      let a = -1, b = -1;
      const row = y * W;
      for (let x = 0; x < W; x++) if (mask.data[row + x]) { a = x; break; }
      if (a < 0) continue;
      for (let x = W - 1; x >= a; x--) if (mask.data[row + x]) { b = x; break; }
      let l = a, r = b + 1;
      if (d && a - K - 1 >= 0 && a + IN < W && b - IN >= 0 && b + K + 1 < W && b - a > 2 * IN + 2) {
        // Coverage of each pixel in a window across the edge, from its colour distance to the backdrop just outside.
        const refine = (lo, hi, out, inside) => {
          const bgc = col(out, y), inc = col(inside, y);
          if (bgc[3] === 0 || inc[3] === 0) return null;
          const full = dist(inc, bgc);
          if (!(full > 30)) return null;
          let sum = 0;
          for (let x = lo; x <= hi; x++) sum += Math.max(0, Math.min(1, dist(col(x, y), bgc) / full));
          return sum;
        };
        const sl = refine(a - K, a + K, a - K - 1, a + IN);
        if (sl != null) l = a + K + 1 - sl;
        const sr = refine(b - K, b + K, b + K + 1, b - IN);
        if (sr != null) r = b - K + sr;
      }
      L[y] = l; R[y] = r;
    }
    return { L, R, H };
  }

  /** Weighted least-squares polynomial (degree 1 or 2) through (x, y) pairs; returns coefficients [c0, c1, c2?]. */
  function polyfit(xs, ys, deg) {
    const n = deg + 1;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const b = new Array(n).fill(0);
    const x0 = xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] - x0;
      const p = [1, x, x * x];
      for (let r = 0; r < n; r++) { b[r] += p[r] * ys[i]; for (let c = 0; c < n; c++) A[r][c] += p[r] * p[c]; }
    }
    // Solve the small system (Gaussian elimination).
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      if (!A[c][c]) return null;
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const co = new Array(n);
    for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * co[k]; co[r] = s / A[r][r]; }
    return (x) => { const t = x - x0; return co[0] + co[1] * t + (n > 2 ? co[2] * t * t : 0); };
  }

  /** Robust line fit (iterative trimming). keepBelow: asymmetric, for a lower envelope. */
  function robustLine(xs, ys, { keepBelow = false, tol = 1 } = {}) {
    let idx = xs.map((_, i) => i);
    let f = null;
    for (let it = 0; it < 8; it++) {
      if (idx.length < 2) break;
      f = polyfit(idx.map((i) => xs[i]), idx.map((i) => ys[i]), 1);
      if (!f) return null;
      const res = xs.map((x, i) => ys[i] - f(x));
      const mad = median(idx.map((i) => Math.abs(res[i]))) * 1.4826;
      const lim = keepBelow ? tol : Math.max(tol, 2.5 * mad);
      const next = xs.map((_, i) => i).filter((i) => (keepBelow ? res[i] < lim : Math.abs(res[i]) < lim));
      if (next.length === idx.length && next.every((v, i) => v === idx[i])) break;
      idx = next;
    }
    return f;
  }

  // ------------------------------------------------------------------------------------------- the corner (ellipse fit)
  // Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7) and ψ(x) = ∫ Φ = xΦ(x) + φ(x).
  function Phi(x) {
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
  }
  const psi = (x) => x * Phi(x) + Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

  /** Fraction of the side width covered in row k (row k = [k, k+1), s grows from outside the cap inwards) for a
   *  half-ellipse cap of depth b ending at the corner sc, seen through a Gaussian blur σ (all in rows). */
  function capModel(k, sc, b, sigma) {
    const lo = k, hi = k + 1;
    let r = sigma * (psi((hi - sc) / sigma) - psi((lo - sc) / sigma)); // the full-width part, s ≥ sc
    if (b > 1e-3) {
      const n = 24, h = b / n;
      for (let j = 0; j < n; j++) {
        const t = sc - b + (j + 0.5) * h;
        const u = (sc - t) / b;
        r += Math.sqrt(Math.max(0, 1 - u * u)) * (Phi((hi - t) / sigma) - Phi((lo - t) / sigma)) * h;
      }
    }
    return r;
  }

  function nelderMead(f, x0, step, iters = 160) {
    const n = x0.length;
    let pts = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; pts.push(p); }
    let val = pts.map(f);
    for (let it = 0; it < iters; it++) {
      const ord = val.map((v, i) => i).sort((a, b) => val[a] - val[b]);
      pts = ord.map((i) => pts[i]); val = ord.map((i) => val[i]);
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let d = 0; d < n; d++) c[d] += pts[i][d] / n;
      const at = (t) => c.map((v, d) => v + t * (pts[n][d] - v));
      const xr = at(-1), fr = f(xr);
      if (fr < val[0]) {
        const xe = at(-2), fe = f(xe);
        if (fe < fr) { pts[n] = xe; val[n] = fe; } else { pts[n] = xr; val[n] = fr; }
      } else if (fr < val[n - 1]) { pts[n] = xr; val[n] = fr; } else {
        const xc = at(0.5), fc = f(xc);
        if (fc < val[n]) { pts[n] = xc; val[n] = fc; } else {
          for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, d) => pts[0][d] + 0.5 * (v - pts[0][d])); val[i] = f(pts[i]); }
        }
      }
      if (Math.abs(val[n] - val[0]) < 1e-12) break;
    }
    return pts[0];
  }

  /** Width of row y by area: every pixel's coverage from its colour between the backdrop (just outside the row's mask
   *  extent) and the product's colour in a fully covered reference row at the same x; pixels well inside the mask
   *  count 1. Handles rows that are only partly covered from above or below (blur, resampling). */
  function areaWidth(img, mask, y, yRef, yOut, inner) {
    const { width: W, height: Hh } = mask;
    if (y < 0 || y >= Hh) return 0;
    const m = mask.data, d = img.data;
    let a = -1, b = -1;
    for (let x = 0; x < W; x++) if (m[y * W + x]) { if (a < 0) a = x; b = x; }
    if (a < 0) return 0;
    let ra = -1, rb = -1;
    for (let x = 0; x < W; x++) if (m[yRef * W + x]) { if (ra < 0) ra = x; rb = x; }
    const x0 = Math.max(0, Math.min(a, ra) - 4), x1 = Math.min(W - 1, Math.max(b, rb) + 4);
    const px = (x, yy) => (yy * W + x) * 4;
    const bgL = px(Math.max(0, x0 - 2), y), bgR = px(Math.min(W - 1, x1 + 2), y);
    if (d[bgL + 3] === 0 || d[bgR + 3] === 0) return b - a + 1;
    let sum = 0;
    for (let x = x0; x <= x1; x++) {
      const deep = m[y * W + x] && x - inner >= a && x + inner <= b && yOut >= 0 && yOut < Hh && m[yOut * W + x];
      if (deep) { sum += 1; continue; }
      const t = (x - x0) / Math.max(1, x1 - x0);
      const p = px(x, y), q = px(Math.max(ra + 4, Math.min(rb - 4, x)), yRef); // the product's colour, away from its edges
      let num = 0, den = 0;
      for (let c = 0; c < 3; c++) {
        const bg = d[bgL + c] * (1 - t) + d[bgR + c] * t;
        num += (d[p + c] - bg) ** 2; den += (d[q + c] - bg) ** 2;
      }
      if (!(den > 900)) { sum += m[y * W + x]; continue; } // too little contrast to tell: the mask decides
      sum += Math.max(0, Math.min(1, Math.sqrt(num / den)));
    }
    return sum;
  }

  /** Blur of the rectified photo (Gaussian sigma, px), from the coverage profile across the straight side edges. */
  function edgeSigma(img, mask, rows, L, R) {
    const { width: W } = mask;
    const d = img.data;
    const col = (x, y) => (y * W + x) * 4;
    const dist = (p, q) => Math.hypot(d[p] - d[q], d[p + 1] - d[q + 1], d[p + 2] - d[q + 2]);
    const vars = [];
    const step = Math.max(1, Math.floor(rows.length / 40));
    for (let i = 0; i < rows.length; i += step) {
      const y = rows[i];
      for (const [e, dir] of [[L[y], 1], [R[y], -1]]) {
        if (!Number.isFinite(e)) continue;
        const c = Math.round(e);
        const out = c - dir * 14, inn = c + dir * 14;
        if (out < 0 || inn < 0 || out >= W || inn >= W) continue;
        const bg = col(out, y), fg = col(inn, y);
        const full = dist(fg, bg);
        if (!(full > 40)) continue;
        // Coverage α along the edge (u grows inwards); fit α = Φ((u − e)/s) with e from the coverage sum (blur-free) and
        // s by search; s² = σ² + 1/12 (the pixel's own width). Least squares keeps noise from inflating it.
        const us = [], as = [];
        let sum = 0;
        for (let k = -12; k <= 12; k++) {
          const x = c + dir * k;
          const a = Math.max(0, Math.min(1, dist(col(x, y), bg) / full));
          us.push(dir * (x + 0.5 - e)); as.push(a); sum += a;
        }
        // e (relative to the mask edge estimate) from the sum: the window spans 25 px.
        const e0 = us[us.length - 1] + 0.5 - sum;
        let best = null;
        for (let sg = 0.3; sg <= 6; sg += 0.05) {
          let err = 0;
          for (let k = 0; k < us.length; k++) err += (as[k] - Phi((us[k] - e0) / sg)) ** 2;
          if (!best || err < best[0]) best = [err, sg];
        }
        vars.push(best[1] * best[1] - 1 / 12);
      }
    }
    const v = median(vars);
    return Number.isFinite(v) ? Math.max(0.3, Math.min(5, Math.sqrt(Math.max(0, v)))) : 1;
  }

  /** Corner where the straight sides meet the rim's (dir +1, from the apex down) or the base's (dir −1, from the
   *  foot up) ellipse. w[row] = silhouette width per row; returns { y (continuous px), side(y) (the straight sides'
   *  width), capEnd (rows from the apex to the last row inside the cap), b, sigma }. */
  function corner(img, mask, w, apex, dir, Hpx, sigma, geoB) {
    const rowsIn = (a, b) => { const out = []; for (let t = a; t <= b; t++) { const y = apex + dir * t; if (Number.isFinite(w[y])) out.push(y); } return out; };
    const yc = (y) => y + 0.5;
    const fitSide = (a, b) => { const ys = rowsIn(a, b); return ys.length >= 3 ? robustLine(ys.map(yc), ys.map((y) => w[y]), { tol: 0.6 }) : null; };
    let side = fitSide(Math.round(0.15 * Hpx), Math.round(0.4 * Hpx));
    if (!side) return null;
    let capEnd = 0;
    for (let it = 0; it < 2; it++) {
      capEnd = 0;
      for (let t = 0; t < Math.round(0.4 * Hpx); t++) {
        const y = apex + dir * t;
        if (Number.isFinite(w[y]) && w[y] / side(yc(y)) < 0.985) capEnd = t;
      }
      const s2 = fitSide(capEnd + Math.max(2, Math.round(0.02 * Hpx)), capEnd + Math.max(8, Math.round(0.25 * Hpx)));
      if (s2) side = s2;
    }
    // Coverage per row through the cap, from 3 rows outside the apex to a few rows past the cap.
    const inner = Math.max(INNER, Math.ceil(3 * sigma) + 1); // clear of the blur halo
    const pre = Math.max(3, Math.ceil(2.5 * sigma)), K = pre + capEnd + inner + 4;
    const yRef = apex + dir * (capEnd + inner + 2);
    const q = [];
    for (let k = 0; k < K; k++) {
      const y = apex + dir * (k - pre);
      q.push(areaWidth(img, mask, y, yRef, y - inner * dir, inner) / side(yc(y)));
    }
    // Blur-free start: the deficit's integral is sc − πb/4 for any blur.
    const deficit = q.reduce((s, v) => s + (1 - v), 0);
    // The cap's depth b (rows): from the camera's position when known (b ≈ R·Δh/L, the rim seen from Δh above or
    // below the eye at distance L). A cap no deeper than the blur can't tell b from blur, so then b is fixed to that.
    const bG = geoB ? geoB(apex, side(yc(apex))) : null;
    const thin = bG != null && bG < 2 * sigma + 2;
    const b0 = bG != null ? bG : Math.max(0.5, capEnd * 0.6);
    const err = ([sc, b]) => {
      const bb = thin ? bG : Math.abs(b);
      let e = 0;
      for (let k = 0; k < K; k++) e += (q[k] - capModel(k, sc, bb, sigma)) ** 2;
      return e;
    };
    const [sc, bF] = nelderMead(err, [deficit + (Math.PI / 4) * b0, b0], [0.7, Math.max(0.5, b0 / 2)]);
    // s = 0 is the outer edge of row (apex − pre·dir).
    const y = dir > 0 ? apex - pre + sc : apex + 1 + pre - sc;
    return { y, side, capEnd, b: thin ? bG : Math.abs(bF), sigma };
  }

  /** Shared silhouette analysis: edges, axis, handle band, corners. */
  function analyse(img, mask, ppm, geoB) {
    const { L, R, H } = rowEdges(img, mask);
    let apex = -1, foot = -1;
    for (let y = 0; y < H; y++) if (Number.isFinite(L[y])) { if (apex < 0) apex = y; foot = y; }
    if (apex < 0 || foot - apex < 10) return null;
    const Hpx = foot - apex + 1;
    const body = [];
    for (let y = apex + Math.round(0.1 * Hpx); y <= foot - Math.round(0.1 * Hpx); y++) if (Number.isFinite(L[y])) body.push(y);
    // Body width: lower envelope of the width (a handle only adds).
    const wline = robustLine(body.map((y) => y + 0.5), body.map((y) => R[y] - L[y]), { keepBelow: true, tol: 0.3 * ppm });
    const excess = new Float64Array(H).fill(0);
    for (let y = apex; y <= foot; y++) if (Number.isFinite(L[y])) excess[y] = R[y] - L[y] - wline(y + 0.5);
    // The handle band: the longest run of rows sticking out > 3 mm (gaps ≤ 2 mm bridged).
    let band = null;
    {
      const lim = HANDLE_MM * ppm, gap = 2 * ppm;
      let start = -1, last = -1;
      const runs = [];
      for (let y = apex; y <= foot; y++) {
        if (excess[y] > lim) {
          if (start < 0) start = y;
          else if (y - last > gap) { runs.push([start, last]); start = y; }
          last = y;
        }
      }
      if (start >= 0) runs.push([start, last]);
      for (const r of runs) if (r[1] - r[0] + 1 >= 3 * ppm && (!band || r[1] - r[0] > band[1] - band[0])) band = r;
    }
    const inBand = band ? (y) => y >= band[0] - ppm && y <= band[1] + ppm : () => false;
    // Which side the handle is on: the edge that moved out.
    let handleSide = 0;
    if (band) {
      const out = [], ins = [];
      for (const y of body) (inBand(y) ? ins : out).push(y);
      const fl = robustLine(out.map((y) => y + 0.5), out.map((y) => L[y]));
      const fr = robustLine(out.map((y) => y + 0.5), out.map((y) => R[y]));
      const dl = fl ? median(ins.map((y) => fl(y + 0.5) - L[y])) : 0;
      const dr = fr ? median(ins.map((y) => R[y] - fr(y + 0.5))) : 0;
      handleSide = dr >= dl ? 1 : -1;
    }
    // Axis: centre line over the body rows outside the band.
    const axRows = body.filter((y) => !inBand(y));
    const axis = robustLine(axRows.map((y) => y + 0.5), axRows.map((y) => (L[y] + R[y]) / 2), { tol: 0.3 });
    if (!axis) return null;
    const slope = axis(1) - axis(0);
    const lean = Math.atan(slope);
    const hl = new Float64Array(H).fill(NaN), hr = new Float64Array(H).fill(NaN);
    for (let y = apex; y <= foot; y++) {
      if (!Number.isFinite(L[y])) continue;
      const c = axis(y + 0.5);
      hl[y] = c - L[y]; hr[y] = R[y] - c;
      if (inBand(y)) { if (handleSide > 0) hr[y] = hl[y]; else hl[y] = hr[y]; }
    }
    // Corners on the WIDTH per row: seen from one side of the product the rim's ellipse is sheared (its top shifts
    // towards the near side), and a leaning axis shears it too; the width per row does not change under a shear.
    const wf = new Float64Array(H).fill(NaN);
    for (let y = apex; y <= foot; y++) wf[y] = hl[y] + hr[y];
    const sigma = edgeSigma(img, mask, body.filter((y) => !inBand(y)), L, R);
    const tc = corner(img, mask, wf, apex, 1, Hpx, sigma, geoB), bc = corner(img, mask, wf, foot, -1, Hpx, sigma, geoB);
    if (!tc || !bc) return null;
    const top = tc.y, bot = bc.y;
    return { L, R, apex, foot, Hpx, axis, lean, wf, tc, bc, top, bot, band, handleSide, excess, wline, sigma };
  }

  /** Width correction for the camera looking at the product from the side of the card's normal. */
  function widthCorr(opts, axisXpx, rMm, ppm) {
    const card = opts.card;
    if (!card || !card.cam || !Array.isArray(card.cam.C) || !opts.offsetMm) return 1;
    const [cx, , cz] = card.cam.C;
    const ax = opts.offsetMm[0] + axisXpx / ppm;
    const Lh = Math.hypot(cx - ax, cz);
    if (!(Lh > 0)) return 1;
    const cosA = Math.abs(cz) / Lh;
    const k = Math.min(0.5, rMm / Lh);
    return cosA * Math.sqrt(1 - k * k);
  }

  function profileOf(A, ppm, corr, n) {
    const { wf, tc, bc, top, bot, lean } = A;
    const cosL = Math.cos(lean);
    const widthAt = (y) => {
      // Inside the caps the silhouette is the ellipse: use the straight sides instead.
      if (y - A.apex <= tc.capEnd + 1) return tc.side(y);
      if (A.foot + 1 - y <= bc.capEnd + 1) return bc.side(y);
      const row = Math.max(A.apex, Math.min(A.foot, Math.floor(y)));
      const vals = [];
      for (let k = -2; k <= 2; k++) {
        const v = wf[Math.max(A.apex, Math.min(A.foot, row + k))];
        if (Number.isFinite(v)) vals.push(v);
      }
      return median(vals);
    };
    const hPx = bot - top;
    const out = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const y = top + f * hPx;
      const w = i === 0 ? tc.side(top) : i === n - 1 ? bc.side(bot) : widthAt(y);
      out.push([r1((f * hPx) / cosL / ppm), r1((w / 2) * cosL * corr / ppm)]);
    }
    return out;
  }

  function outlineOf(A, ppm, map) {
    const step = Math.max(1, Math.round(ppm));
    const P = (x, y) => { const [u, v] = map(x, y); return [r1(u), r1(v)]; };
    const left = [], right = [];
    for (let y = A.apex; y <= A.foot; y += step) {
      if (!Number.isFinite(A.L[y])) continue;
      left.push(P(A.L[y], y + 0.5));
      right.push(P(A.R[y], y + 0.5));
    }
    const a = A.apex, f = A.foot;
    const pts = [P((A.L[a] + A.R[a]) / 2, a), ...left, P((A.L[f] + A.R[f]) / 2, f + 1), ...right.reverse()];
    // At most ~400 points.
    const k = Math.ceil(pts.length / 400);
    return k > 1 ? pts.filter((_, i) => i % k === 0) : pts;
  }

  /** The cap depth (rows) the camera's position predicts at rectified row y for a silhouette widthPx wide, or null. */
  function geoFor(opts, ppm, axisXpx) {
    const card = opts.card;
    if (!card || !card.cam || !Array.isArray(card.cam.C) || !opts.offsetMm) return null;
    const [cx, cy, cz] = card.cam.C;
    const L = Math.hypot(cx - (opts.offsetMm[0] + axisXpx / ppm), cz);
    return (yRect, widthPx) => {
      const R = widthPx / 2 / ppm;
      const dh = Math.abs(opts.offsetMm[1] + yRect / ppm - cy);
      return L > R ? ((R * dh * L) / (L * L - R * R)) * ppm : null;
    };
  }

  /** The image and mask turned by phi about P (rectified px) so a leaning axis stands upright, cropped to the product. */
  function deskew(img, mask, P, phi, box) {
    const c = Math.cos(phi), s = Math.sin(phi);
    const toR = (x, y) => [P[0] + c * (x - P[0]) - s * (y - P[1]), P[1] + s * (x - P[0]) + c * (y - P[1])];
    const toS = (u, v) => [P[0] + c * (u - P[0]) + s * (v - P[1]), P[1] - s * (u - P[0]) + c * (v - P[1])];
    const cs = [toR(box[0], box[1]), toR(box[2], box[1]), toR(box[0], box[3]), toR(box[2], box[3])];
    const ox = Math.floor(Math.min(...cs.map((p) => p[0]))) - 12, oy = Math.floor(Math.min(...cs.map((p) => p[1]))) - 12;
    const W = Math.ceil(Math.max(...cs.map((p) => p[0]))) + 12 - ox, H = Math.ceil(Math.max(...cs.map((p) => p[1]))) + 12 - oy;
    const out = new Uint8ClampedArray(W * H * 4), om = new Uint8Array(W * H);
    const SW = img.width, SH = img.height, d = img.data, m = mask.data;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const [sx, sy] = toS(ox + i + 0.5, oy + j + 0.5);
      const fx = sx - 0.5, fy = sy - 0.5;
      const k = j * W + i;
      if (!(fx >= 0 && fy >= 0 && fx <= SW - 1 && fy <= SH - 1)) { out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = 255; continue; }
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(SW - 1, x0 + 1), y1 = Math.min(SH - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      const p00 = (y0 * SW + x0) * 4, p10 = (y0 * SW + x1) * 4, p01 = (y1 * SW + x0) * 4, p11 = (y1 * SW + x1) * 4;
      for (let ch = 0; ch < 4; ch++) out[k * 4 + ch] = d[p00 + ch] * w00 + d[p10 + ch] * w10 + d[p01 + ch] * w01 + d[p11 + ch] * w11;
      const mv = m[y0 * SW + x0] * w00 + m[y0 * SW + x1] * w10 + m[y1 * SW + x0] * w01 + m[y1 * SW + x1] * w11;
      if (mv >= 0.5) om[k] = 1;
    }
    return { img: { data: out, width: W, height: H }, mask: { data: om, width: W, height: H }, toRect: (u, v) => toS(ox + u, oy + v) };
  }

  function core(rectImg, mask, opts) {
    const ppm = Number(opts.pxPerMm) > 0 ? Number(opts.pxPerMm) : 5;
    // Bounding box of the product (for the camera geometry and the deskew crop).
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
    if (!(bx1 > bx0)) return null;
    const geo = geoFor(opts, ppm, (bx0 + bx1 + 1) / 2);
    let A = analyse(rectImg, mask, ppm, geo);
    if (!A) return null;
    let lean = A.lean, map = (x, y) => [x, y];
    if (Math.abs(A.lean) > (0.2 * Math.PI) / 180) {
      // Stand the product upright (about its axis at mid-height) and measure again.
      const my = (A.apex + A.foot + 1) / 2;
      const D = deskew(rectImg, mask, [A.axis(my), my], A.lean, [bx0, by0, bx1 + 1, by1 + 1]);
      const g2 = geo && ((row, w) => geo(D.toRect(0, row)[1], w));
      const A2 = analyse(D.img, D.mask, ppm, g2);
      if (A2) { A = A2; lean += A2.lean; map = D.toRect; }
    }
    const cosL = Math.cos(A.lean);
    const rim = map(A.axis(A.top), A.top), base = map(A.axis(A.bot), A.bot);
    const rTopPx = A.tc.side(A.top) / 2;
    const rBotPx = A.bc.side(A.bot) / 2;
    const corr = widthCorr(opts, rim[0], (Math.max(rTopPx, rBotPx) * cosL) / ppm, ppm);
    const heightMm = (A.bot - A.top) / cosL / ppm;
    const n = Math.max(8, Math.min(64, Math.round(heightMm / 2) + 1));
    return {
      A, ppm, corr,
      res: {
        heightMm: r1(heightMm),
        topDiaMm: r1((2 * rTopPx * cosL * corr) / ppm),
        bottomDiaMm: r1((2 * rBotPx * cosL * corr) / ppm),
        profile: profileOf(A, ppm, corr, n),
        axisXpx: r1(rim[0]),
        rimYpx: r1(rim[1]),
        baseYpx: r1(base[1]),
        leanDeg: r2((-lean * 180) / Math.PI), // + = the top leans to the right
        outline: outlineOf(A, ppm, map),
        widthCorr: Math.round(corr * 10000) / 10000,
        blurPx: r2(A.sigma),
      },
    };
  }

  function measureFront(rectImg, mask, opts = {}) {
    const c = core(rectImg, mask, opts);
    if (!c) return null;
    return { ...c.res, handleSeen: Boolean(c.A.band) };
  }

  function measureSide(rectImg, mask, opts = {}) {
    const c = core(rectImg, mask, opts);
    if (!c) return null;
    const { A, ppm } = c;
    let handle = null;
    if (A.band) {
      const cosL = Math.cos(A.lean);
      const yMm = (y) => (y - A.top) / cosL / ppm;
      const ex = [];
      for (let y = A.band[0]; y <= A.band[1]; y++) ex.push(A.excess[y]);
      ex.sort((a, b) => a - b);
      const reach = ex[Math.min(ex.length - 1, Math.floor(ex.length * 0.95))] * cosL * c.corr / ppm;
      handle = {
        y0Mm: r1(Math.max(0, yMm(A.band[0]))),
        y1Mm: r1(yMm(A.band[1] + 1)),
        widthMm: r1(reach),
        reachMm: r1(reach),
        side: A.handleSide > 0 ? 'right' : 'left',
      };
    }
    return { handle, ...c.res };
  }

  // ---------------------------------------------------------------------------------------------------- checks / maths
  function radiusAt(profile, y) {
    if (!profile.length) return NaN;
    if (y <= profile[0][0]) return profile[0][1];
    for (let i = 1; i < profile.length; i++) {
      if (y <= profile[i][0]) {
        const [y0, a] = profile[i - 1], [y1, b] = profile[i];
        return y1 > y0 ? a + ((b - a) * (y - y0)) / (y1 - y0) : b;
      }
    }
    return profile[profile.length - 1][1];
  }

  function bandLinearityMm(profile, print) {
    if (!Array.isArray(profile) || profile.length < 2 || !print) return 0;
    const top = Number(print.topMm != null ? print.topMm : print.printTopMm);
    const h = Number(print.heightMm != null ? print.heightMm : print.printHeightMm);
    if (!(h > 0) || !Number.isFinite(top)) return 0;
    const a = radiusAt(profile, top), b = radiusAt(profile, top + h);
    let worst = 0;
    const ys = profile.map((p) => p[0]).filter((y) => y > top && y < top + h);
    for (let i = 1; i < 20; i++) ys.push(top + (h * i) / 20);
    for (const y of ys) {
      const chord = a + ((b - a) * (y - top)) / h;
      worst = Math.max(worst, Math.abs(radiusAt(profile, y) - chord));
    }
    return r2(worst);
  }

  function compare(typed, measured) {
    const pct = (t, m) => {
      const a = Number(t), b = Number(m);
      return a > 0 && b > 0 ? r1(((b - a) / a) * 100) : null;
    };
    const out = {
      heightPct: pct(typed && typed.heightMm, measured && measured.heightMm),
      topPct: pct(typed && typed.topDiaMm, measured && measured.topDiaMm),
      bottomPct: pct(typed && typed.bottomDiaMm, measured && measured.bottomDiaMm),
    };
    out.warn = ['heightPct', 'topPct', 'bottomPct'].filter((k) => out[k] != null && Math.abs(out[k]) > WARN_PCT);
    return out;
  }

  return { rectify, rectifyMask, maskFromBackground, measureFront, measureSide, bandLinearityMm, compare, radiusAt, WARN_PCT };
}));
