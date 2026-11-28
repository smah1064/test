/*
 * Calibration-card detection ("New product from photo", slice 2). Pure JS, no dependencies; the browser (the admin
 * wizard, on the phone) and node:test both run it. The card itself is described in calib-card-layout.js.
 *
 * COORDINATES
 *   Images are plain { data: Uint8ClampedArray RGBA, width, height } (the canvas ImageData shape).
 *   Image px are CONTINUOUS: (0,0) is the top-left corner of the top-left pixel, pixel (i, j) covers
 *   [i, i+1) × [j, j+1) and its centre is (i + 0.5, j + 0.5); y is down. Taps from a canvas (offsetX × scale) use the
 *   same convention.
 *   Card mm are REAL millimetres on the printed card: layout mm (calib-card-layout.js, origin at the page's top-left,
 *   y down) × cardScale (the owner's ruler check: what the 100 mm line really measures / 100).
 *   H (3 × 3, row-major flat array of 9) maps card mm -> image px; Hinv maps image px -> card mm.
 *
 * API (POD_CALIB)
 *   detectCard(img, { cardScale = 1, focalPx, maxTiltDeg = 8, maxRmsPx = 1, workMax = 1600 } = {})
 *     -> { ok, reason?, H, Hinv, pxPerMm, wb:[r,g,b], rmsPx, tiltDeg, corners:[[x,y] × 4], gates:{ sharp, tilt, exposure },
 *          // also: method:'auto', cardScale, points (checker corners used), edgePx (edge blur, 10–90 % width in px),
 *          //       exposure:{ white:[r,g,b], black:[r,g,b] }, cam:{ f, fEstimated, C:[x,y,z] } (camera centre in card mm,
 *          //       z < 0 = in front of the card), gates.fit (rms gate)
 *        }
 *     corners = the four finder centres TL, TR, BL, BR in image px (from the refined H).
 *     reason (when ok is false): 'notFound' | 'tooDark' | 'tooBright' | 'blurry' | 'tilted' (checked in that order; a
 *     card found but fitted worse than maxRmsPx — usually bent — is 'notFound' with gates.fit false).
 *     pxPerMm = image px per card mm at the card's centre (geometric mean of the two directions).
 *     wb = per-channel GAINS: pixel × wb makes the card's paper neutral at 240 (fitted on the K 0/20/40 patches).
 *     tiltDeg = angle between the card's normal and the camera's optical axis (needs a focal length: estimated from
 *     the card's perspective when it is tilted enough to tell, otherwise opts.focalPx, otherwise 1.2 × the image
 *     diagonal: a phone's main camera at 2× zoom).
 *   fromTaps(img, taps, opts) -> the same shape (method:'tap'). taps = the four finder centres tapped by the owner, image
 *     px, any order. Each tap snaps to the finder (or the dark centre square) within 3 % of the image size. When the
 *     checker refinement fails, the four snapped taps alone give H and `lowAccuracy: true` (not a failure). Blur never
 *     fails a tapped card; exposure and tilt still do.
 *   cardToImage(H, xMm, yMm) -> [x, y];  imageToCard(Hinv, x, y) -> [xMm, yMm]
 *   focalFromExif35(f35mm, width, height) -> focalPx for opts (the photo's EXIF FocalLengthIn35mmFilm, read in the
 *     browser before the photo is downsized; the image size is the one passed to detectCard). Worth passing: the
 *     measurer's width correction uses the camera position, which needs the focal length when the card faces the
 *     camera squarely (a 1× lens at 60 cm read as 2× leaves ≈ 1.5 % on a cup off to one side of the frame).
 *
 * METHOD (plan section C): grey + Bradley adaptive threshold on a ≤ workMax px copy; zxing-style finder search
 * (1:1:3:1:1 runs, cross-checked vertically and again horizontally, clustered); order by angle, pick the 90° turn where
 * the grey ramp runs light to dark; 4-point homography; then on the full-size photo: snap the 24 checker corners to
 * their saddle points (gradient-orthogonality, like OpenCV's cornerSubPix), finder centres to their dark-square
 * centroids, and refit H by least squares (Gauss–Newton on the reprojection error, normalised coordinates).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calib-card-layout'));
  else root.POD_CALIB = factory(root.POD_CALIBLAYOUT);
}(typeof self !== 'undefined' ? self : this, (L) => {
  'use strict';

  // ---------------------------------------------------------------------------------------------- small linear algebra
  function solve(A, b) { // Gaussian elimination with partial pivoting; A n×n (array of rows), b n. Returns null if singular.
    const n = b.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (!(Math.abs(M[p][c]) > 1e-12)) return null;
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  const mul3 = (A, B) => {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return C;
  };
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const norm9 = (H) => { const s = H[8] || 1; return H.map((v) => v / s); };
  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  // Similarity that moves the points' centroid to 0 and their mean distance to √2 (Hartley).
  function normT(pts) {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let d = 0;
    for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my);
    const s = Math.SQRT2 / (d / pts.length || 1);
    return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
  }

  /** Exact homography from 4 point pairs (src -> dst), or null. */
  function homography4(src, dst) {
    const Ts = normT(src), Td = normT(dst);
    const s = src.map((p) => applyH(Ts, p[0], p[1]));
    const d = dst.map((p) => applyH(Td, p[0], p[1]));
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [X, Y] = s[i], [u, v] = d[i];
      A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
      A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
    }
    const h = solve(A, b);
    if (!h) return null;
    const Td1 = inv3(Td);
    return norm9(mul3(mul3(Td1, h.concat([1])), Ts));
  }

  /** Least-squares homography (geometric error, Gauss–Newton) starting from H0; w = optional weights. */
  function fitH(src, dst, H0, w) {
    const n = src.length;
    const Ts = normT(src), Td = normT(dst);
    const s = src.map((p) => applyH(Ts, p[0], p[1]));
    const d = dst.map((p) => applyH(Td, p[0], p[1]));
    let h = norm9(mul3(mul3(Td, H0), inv3(Ts)));
    for (let it = 0; it < 10; it++) {
      const JtJ = Array.from({ length: 8 }, () => new Array(8).fill(0));
      const Jtr = new Array(8).fill(0);
      for (let i = 0; i < n; i++) {
        const [X, Y] = s[i];
        const wt = w ? w[i] : 1;
        const den = h[6] * X + h[7] * Y + 1;
        const u = (h[0] * X + h[1] * Y + h[2]) / den;
        const v = (h[3] * X + h[4] * Y + h[5]) / den;
        const ju = [X / den, Y / den, 1 / den, 0, 0, 0, -u * X / den, -u * Y / den];
        const jv = [0, 0, 0, X / den, Y / den, 1 / den, -v * X / den, -v * Y / den];
        const ru = d[i][0] - u, rv = d[i][1] - v;
        for (let a = 0; a < 8; a++) {
          Jtr[a] += wt * (ju[a] * ru + jv[a] * rv);
          for (let c = a; c < 8; c++) JtJ[a][c] += wt * (ju[a] * ju[c] + jv[a] * jv[c]);
        }
      }
      for (let a = 0; a < 8; a++) for (let c = 0; c < a; c++) JtJ[a][c] = JtJ[c][a];
      const step = solve(JtJ, Jtr);
      if (!step) break;
      let m = 0;
      for (let a = 0; a < 8; a++) { h[a] += step[a]; m = Math.max(m, Math.abs(step[a])); }
      if (m < 1e-10) break;
    }
    return norm9(mul3(mul3(inv3(Td), h), Ts));
  }

  // ------------------------------------------------------------------------------------------------------ image access
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  /** Grey copy at most `maxSide` px on its long side (area average). scale = work px per image px. */
  function workGrey(img, maxSide) {
    const { width: W, height: H, data } = img;
    const k = Math.min(1, maxSide / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const g = new Float32Array(w * h);
    if (k === 1) {
      for (let i = 0, p = 0; i < w * h; i++, p += 4) g[i] = lum(data[p], data[p + 1], data[p + 2]);
      return { g, w, h, sx: 1, sy: 1 };
    }
    const sx = w / W, sy = h / H;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y / sy), y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) / sy)));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x / sx), x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) / sx)));
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) {
          let p = (yy * W + x0) * 4;
          for (let xx = x0; xx < x1; xx++, p += 4) sum += lum(data[p], data[p + 1], data[p + 2]);
        }
        g[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
    return { g, w, h, sx, sy };
  }

  /** Bradley adaptive threshold: 1 = darker than (1 − t) × the local mean. */
  function bradley(G, t = 0.15) {
    const { g, w, h } = G;
    const W1 = w + 1;
    const I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; }
    }
    const r = Math.max(4, Math.round(Math.max(w, h) / 16));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        const sum = I[yb * W1 + xb] - I[ya * W1 + xb] - I[yb * W1 + xa] + I[ya * W1 + xa];
        if (g[y * w + x] * (xb - xa) * (yb - ya) < sum * (1 - t)) bin[y * w + x] = 1;
      }
    }
    return bin;
  }

  /** Bilinear luminance at continuous image px (x, y). */
  function lumAt(img, x, y) {
    const { width: W, height: H, data } = img;
    let fx = x - 0.5, fy = y - 0.5;
    fx = fx < 0 ? 0 : fx > W - 1 ? W - 1 : fx;
    fy = fy < 0 ? 0 : fy > H - 1 ? H - 1 : fy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const L0 = (xx, yy) => { const p = (yy * W + xx) * 4; return lum(data[p], data[p + 1], data[p + 2]); };
    return (L0(x0, y0) * (1 - ax) + L0(x1, y0) * ax) * (1 - ay) + (L0(x0, y1) * (1 - ax) + L0(x1, y1) * ax) * ay;
  }

  /** Mean RGB over a card-mm rectangle (its inner `inset` part), sampled on a grid through H. */
  function patchRgb(img, H, x, y, w, h, inset = 0.25) {
    const { width: W, height: Hh, data } = img;
    const out = [0, 0, 0];
    let n = 0;
    for (let j = 0; j < 7; j++) {
      for (let i = 0; i < 7; i++) {
        const [u, v] = applyH(H, x + w * (inset + (1 - 2 * inset) * i / 6), y + h * (inset + (1 - 2 * inset) * j / 6));
        const px = Math.floor(u), py = Math.floor(v);
        if (px < 0 || py < 0 || px >= W || py >= Hh) continue;
        const p = (py * W + px) * 4;
        out[0] += data[p]; out[1] += data[p + 1]; out[2] += data[p + 2]; n++;
      }
    }
    return n ? out.map((v) => v / n) : null;
  }

  // ---------------------------------------------------------------------------------------------- finder pattern search
  const ratioOk = (c, strict) => {
    const total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (total < 7) return 0;
    const m = total / 7, v = m * (strict ? 0.5 : 0.7);
    return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v ? m : 0;
  };

  // Runs through (x, y) along one axis: returns [c0..c4] and the centre run's span, or null.
  function crossRuns(bin, w, h, x, y, dx, dy, maxRun) {
    const at = (k) => { const xx = x + dx * k, yy = y + dy * k; return xx < 0 || yy < 0 || xx >= w || yy >= h ? -1 : bin[yy * w + xx]; };
    if (at(0) !== 1) return null;
    let a = 0; while (at(-a - 1) === 1) a++;
    let b = 0; while (at(b + 1) === 1) b++;
    const c = [0, 0, b + a + 1, 0, 0];
    let k = -a - 1;
    while (at(k) === 0 && c[1] <= maxRun) { c[1]++; k--; }
    while (at(k) === 1 && c[0] <= maxRun) { c[0]++; k--; }
    k = b + 1;
    while (at(k) === 0 && c[3] <= maxRun) { c[3]++; k++; }
    while (at(k) === 1 && c[4] <= maxRun) { c[4]++; k++; }
    if (!c[0] || !c[1] || !c[3] || !c[4]) return null;
    return { c, lo: -a, hi: b + 1 }; // centre run covers offsets [lo, hi)
  }

  function findFinders(bin, w, h, roi) {
    const x0 = roi ? Math.max(0, roi[0]) : 0, x1 = roi ? Math.min(w, roi[2]) : w;
    const y0 = roi ? Math.max(0, roi[1]) : 0, y1 = roi ? Math.min(h, roi[3]) : h;
    const cands = [];
    const runs = new Int32Array(x1 - x0 + 2);
    for (let y = y0; y < y1; y++) {
      // Run-length encode the row: runs alternate colour starting with the colour of x0.
      let n = 0, len = 1, prev = bin[y * w + x0];
      const startColour = prev;
      for (let x = x0 + 1; x < x1; x++) {
        const v = bin[y * w + x];
        if (v === prev) len++; else { runs[n++] = len; len = 1; prev = v; }
      }
      runs[n++] = len;
      let pos = x0;
      for (let i = 0; i + 4 < n; i++) {
        const dark = ((i % 2) === 0) === (startColour === 1);
        if (dark) {
          const c = [runs[i], runs[i + 1], runs[i + 2], runs[i + 3], runs[i + 4]];
          const m = ratioOk(c, true);
          if (m) {
            const cs = pos + runs[i] + runs[i + 1];
            let cx = cs + runs[i + 2] / 2;
            // Vertical cross-check through the centre run's middle column.
            const xi = Math.floor(cx);
            const V = crossRuns(bin, w, h, xi, y, 0, 1, Math.ceil(m * 4));
            const mv = V && ratioOk(V.c, false);
            if (mv && Math.abs(mv - m) < m * 0.6) {
              const cy = y + (V.lo + V.hi) / 2;
              const yi = Math.floor(cy);
              const Hc = crossRuns(bin, w, h, xi, yi, 1, 0, Math.ceil(m * 4));
              const mh = Hc && ratioOk(Hc.c, false);
              if (mh) {
                cx = xi + (Hc.lo + Hc.hi) / 2;
                cands.push([cx, cy, (mh + mv) / 2]);
              }
            }
          }
        }
        pos += runs[i];
      }
    }
    // Cluster.
    const clusters = [];
    for (const [x, y, m] of cands) {
      let best = null;
      for (const c of clusters) {
        if (Math.abs(c.x - x) < c.m * 2 && Math.abs(c.y - y) < c.m * 2 && Math.abs(c.m - m) < c.m * 0.6) { best = c; break; }
      }
      if (best) {
        best.sx += x; best.sy += y; best.sm += m; best.n++;
        best.x = best.sx / best.n; best.y = best.sy / best.n; best.m = best.sm / best.n;
      } else clusters.push({ x, y, m, sx: x, sy: y, sm: m, n: 1 });
    }
    return clusters.sort((a, b) => b.n - a.n);
  }

  // ------------------------------------------------------------------------------------------- ordering by the grey ramp
  const CLOCKWISE = [0, 1, 3, 2]; // TL, TR, BR, BL as indices into FINDER.centres (TL, TR, BL, BR)

  /** Given 4 image points, try the four turns; returns { H (layout mm -> px), pts (TL,TR,BL,BR), score } or null. */
  function orderByRamp(pts, img) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    const sorted = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    // Convex and not degenerate?
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = sorted[i], b = sorted[(i + 1) % 4], c = sorted[(i + 2) % 4];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-6) return null;
      const s = Math.sign(cr);
      if (sign && s !== sign) return null;
      sign = s;
    }
    if (sign < 0) return null; // clockwise on screen (y down) is a positive cross product; a mirror image fails here
    const centres = L.FINDER.centres;
    const greys = L.greyPatches();
    let best = null;
    for (let k = 0; k < 4; k++) {
      const src = [], dst = [];
      for (let i = 0; i < 4; i++) { src.push(centres[CLOCKWISE[(i + k) % 4]]); dst.push(sorted[i]); }
      const H = homography4(src, dst);
      if (!H) continue;
      const v = greys.map((p) => { const c = patchRgb(img, H, p.x, p.y, p.w, p.h, 0.3); return c ? lum(c[0], c[1], c[2]) : NaN; });
      if (v.some((x) => !Number.isFinite(x))) continue;
      const span = v[0] - v[5];
      let steps = 0;
      for (let i = 0; i < 5; i++) if (v[i] - v[i + 1] > span * 0.04) steps++;
      // The checker's top-left square is black, its neighbour white.
      const a = patchRgb(img, H, 35, 50, 20, 20, 0.3), b = patchRgb(img, H, 55, 50, 20, 20, 0.3);
      const chk = a && b && lum(b[0], b[1], b[2]) - lum(a[0], a[1], a[2]) > span * 0.3 ? 1 : 0;
      const score = (span > 25 ? steps : 0) + chk;
      if (!best || score > best.score) {
        const ord = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) ord[CLOCKWISE[(i + k) % 4]] = sorted[i];
        best = { H, pts: ord, score };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------- full-size refinement
  /** Saddle point near (x, y) by gradient orthogonality (OpenCV cornerSubPix). Returns [x, y] or null. */
  function saddle(img, x, y, half) {
    const { width: W, height: Hh, data } = img;
    const R = half + 2;
    const S = 2 * R + 1;
    const buf = new Float32Array(S * S);
    let px = x, py = y;
    const sigma = half * 0.7;
    for (let it = 0; it < 12; it++) {
      const ox = Math.floor(px) - R, oy = Math.floor(py) - R;
      if (ox < 0 || oy < 0 || ox + S > W || oy + S > Hh) return null;
      for (let j = 0; j < S; j++) {
        let p = ((oy + j) * W + ox) * 4;
        for (let i = 0; i < S; i++, p += 4) buf[j * S + i] = lum(data[p], data[p + 1], data[p + 2]);
      }
      let a = 0, b = 0, c = 0, bx = 0, by = 0;
      for (let j = 1; j < S - 1; j++) {
        const qy = oy + j + 0.5;
        const dy = qy - py;
        if (Math.abs(dy) > half) continue;
        for (let i = 1; i < S - 1; i++) {
          const qx = ox + i + 0.5;
          const dx = qx - px;
          if (Math.abs(dx) > half) continue;
          const k = j * S + i;
          const gx = (buf[k - S + 1] + 2 * buf[k + 1] + buf[k + S + 1]) - (buf[k - S - 1] + 2 * buf[k - 1] + buf[k + S - 1]);
          const gy = (buf[k + S - 1] + 2 * buf[k + S] + buf[k + S + 1]) - (buf[k - S - 1] + 2 * buf[k - S] + buf[k - S + 1]);
          const wt = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          const gxx = gx * gx * wt, gxy = gx * gy * wt, gyy = gy * gy * wt;
          a += gxx; b += gxy; c += gyy;
          bx += gxx * qx + gxy * qy;
          by += gxy * qx + gyy * qy;
        }
      }
      const det = a * c - b * b;
      if (!(det > 1e-9 * (a + c) * (a + c))) return null;
      const nx = (c * bx - b * by) / det, ny = (a * by - b * bx) / det;
      const moved = Math.hypot(nx - px, ny - py);
      px = nx; py = ny;
      if (moved < 0.005) break;
    }
    return [px, py];
  }

  /** Dark-centre centroid of a finder whose centre is roughly at layout mm `c` through H. */
  function finderCentroid(img, H, c) {
    const Hinv = inv3(H);
    const corners = [[-9.5, -9.5], [9.5, -9.5], [9.5, 9.5], [-9.5, 9.5]].map(([dx, dy]) => applyH(H, c[0] + dx, c[1] + dy));
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const { width: W, height: Hh, data } = img;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(Hh, Math.ceil(Math.max(...ys)));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    // Paper white from the white ring, black from the centre.
    const white = patchRgb(img, H, c[0] + 6.5, c[1] - 9, 2, 18, 0.2);
    const black = patchRgb(img, H, c[0] - 4, c[1] - 4, 8, 8, 0.2);
    if (!white || !black) return null;
    const Lw = lum(...white), Lb = lum(...black);
    if (!(Lw - Lb > 20)) return null;
    let sw = 0, sx = 0, sy = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [mx, my] = applyH(Hinv, x + 0.5, y + 0.5);
        if (Math.abs(mx - c[0]) > 9.5 || Math.abs(my - c[1]) > 9.5) continue;
        const p = (y * W + x) * 4;
        let wt = (Lw - lum(data[p], data[p + 1], data[p + 2])) / (Lw - Lb);
        wt = wt < 0 ? 0 : wt > 1 ? 1 : wt;
        sw += wt; sx += wt * (x + 0.5); sy += wt * (y + 0.5);
      }
    }
    return sw > 0 ? [sx / sw, sy / sw] : null;
  }

  /** Refine a coarse layout-mm -> px homography on the full photo. Returns { H, rms, points } or null. */
  function refine(img, H0, { withFinders = true } = {}) {
    const corners = L.innerCorners();
    const C = L.CHECKER;
    let H = H0;
    let found = [];
    for (let pass = 0; pass < 2; pass++) {
      const J = jac(H, 105, 100);
      const sqPx = C.sq * Math.sqrt(Math.abs(J));
      const half = Math.max(3, Math.min(18, Math.round(sqPx * 0.28)));
      found = [];
      for (const [X, Y] of corners) {
        const [px, py] = applyH(H, X, Y);
        const s = saddle(img, px, py, half);
        if (!s || Math.hypot(s[0] - px, s[1] - py) > half) continue;
        // A real saddle: diagonal quadrants match, the other diagonal differs.
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => {
          const [ax, ay] = applyH(H, X + dx * 5, Y + dy * 5);
          return lumAt(img, ax + s[0] - px, ay + s[1] - py);
        });
        const i = Math.round((X - C.x0) / C.sq), j = Math.round((Y - C.y0) / C.sq);
        const brBlack = (i + j) % 2 === 0; // the square below-right of this corner
        const dark = brBlack ? (q[0] + q[2]) / 2 : (q[1] + q[3]) / 2;
        const light = brBlack ? (q[1] + q[3]) / 2 : (q[0] + q[2]) / 2;
        if (!(light - dark > 25) || Math.abs(q[0] - q[2]) > (light - dark) * 0.5 || Math.abs(q[1] - q[3]) > (light - dark) * 0.5) continue;
        found.push({ src: [X, Y], dst: s, w: 1 });
      }
      if (found.length < 12) return null;
      H = fitH(found.map((f) => f.src), found.map((f) => f.dst), H, null);
    }
    const all = found.slice();
    if (withFinders) {
      for (const c of L.FINDER.centres) {
        const p = finderCentroid(img, H, c);
        if (p) all.push({ src: c, dst: p, w: 1, finder: true });
      }
    }
    // Fit, drop outliers once, fit again.
    let pts = all;
    H = fitH(pts.map((f) => f.src), pts.map((f) => f.dst), H, pts.map((f) => f.w));
    const res = (f) => { const [u, v] = applyH(H, f.src[0], f.src[1]); return Math.hypot(u - f.dst[0], v - f.dst[1]); };
    const r = pts.map(res).sort((a, b) => a - b);
    const med = r[Math.floor(r.length / 2)];
    const keep = pts.filter((f) => res(f) <= Math.max(1.5, 3 * med));
    if (keep.length !== pts.length && keep.filter((f) => !f.finder).length >= 12) {
      pts = keep;
      H = fitH(pts.map((f) => f.src), pts.map((f) => f.dst), H, pts.map((f) => f.w));
    }
    const saddles = pts.filter((f) => !f.finder);
    const rms = Math.sqrt(pts.reduce((s, f) => s + res(f) ** 2, 0) / pts.length);
    return { H, rms, points: saddles.length };
  }

  // Determinant of H's Jacobian at (x, y): px² per mm².
  function jac(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    const [u, v] = applyH(H, x, y);
    const a = (H[0] - H[6] * u) / w, b = (H[1] - H[7] * u) / w;
    const c = (H[3] - H[6] * v) / w, d = (H[4] - H[7] * v) / w;
    return a * d - b * c;
  }

  // ---------------------------------------------------------------------------------------------------------- quality
  /** Edge blur: median over checker edges of contrast ÷ steepest slope (≈ the 10–90 % rise width), image px. */
  function edgeWidth(img, H) {
    const C = L.CHECKER;
    const widths = [];
    const probe = (X, Y, nx, ny) => {
      const [x0, y0] = applyH(H, X, Y);
      const [x1, y1] = applyH(H, X + nx, Y + ny);
      let dx = x1 - x0, dy = y1 - y0;
      const pxPerMm = Math.hypot(dx, dy);
      dx /= pxPerMm; dy /= pxPerMm;
      const reach = Math.max(4, 3.5 * pxPerMm);
      const n = Math.ceil(reach / 0.5);
      const prof = [];
      for (let k = -n; k <= n; k++) prof.push(lumAt(img, x0 + dx * k * 0.5, y0 + dy * k * 0.5));
      const sm = prof.map((v, i) => (prof[Math.max(0, i - 1)] + 2 * v + prof[Math.min(prof.length - 1, i + 1)]) / 4);
      let g = 0;
      for (let i = 1; i < sm.length; i++) g = Math.max(g, Math.abs(sm[i] - sm[i - 1]) / 0.5);
      const m = Math.max(2, Math.floor(n / 4));
      const a = sm.slice(0, m).reduce((s, v) => s + v, 0) / m;
      const b = sm.slice(-m).reduce((s, v) => s + v, 0) / m;
      const contrast = Math.abs(b - a);
      if (contrast > 20 && g > 0) widths.push(contrast / g);
    };
    for (let j = 1; j < C.rows; j++) for (let i = 0; i < C.cols; i++) probe(C.x0 + (i + 0.5) * C.sq, C.y0 + j * C.sq, 0, 1);
    for (let i = 1; i < C.cols; i++) for (let j = 0; j < C.rows; j++) probe(C.x0 + i * C.sq, C.y0 + (j + 0.5) * C.sq, 1, 0);
    if (!widths.length) return Infinity;
    widths.sort((a, b) => a - b);
    return widths[Math.floor(widths.length / 2)];
  }

  /** Paper white, black and white-balance gains from the grey ramp (layout-mm H). */
  function exposure(img, H) {
    const vals = L.greyPatches().map((p) => patchRgb(img, H, p.x, p.y, p.w, p.h, 0.2));
    if (vals.some((v) => !v)) return null;
    const white = vals[0], black = vals[5];
    // Gains g_c that make the light patches neutral, scaled so the paper comes out at 240.
    const gains = [0, 1, 2].map((c) => {
      let num = 0, den = 0;
      for (let k = 0; k < 3; k++) { const n = lum(...vals[k]); num += vals[k][c] * n; den += vals[k][c] * vals[k][c]; }
      return den ? num / den : 1;
    });
    const Lw = lum(white[0] * gains[0], white[1] * gains[1], white[2] * gains[2]);
    const wb = gains.map((g) => (g * 240) / (Lw || 1));
    return { white, black, wb };
  }

  /** Focal length and camera pose from H (real mm -> px). */
  function camera(H, img, focalPx) {
    const cx = img.width / 2, cy = img.height / 2;
    const diag = Math.hypot(img.width, img.height);
    const Hc = mul3([1, 0, -cx, 0, 1, -cy, 0, 0, 1], H);
    const pose = (f) => {
      const Ki = [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1];
      const B = mul3(Ki, Hc);
      const b1 = [B[0], B[3], B[6]], b2 = [B[1], B[4], B[7]], b3 = [B[2], B[5], B[8]];
      const n1 = Math.hypot(...b1), n2 = Math.hypot(...b2);
      let lam = 2 / (n1 + n2);
      if (b3[2] * lam < 0) lam = -lam; // the card is in front of the camera
      let r1 = b1.map((v) => v * lam), r2 = b2.map((v) => v * lam);
      const t = b3.map((v) => v * lam);
      // Symmetric orthonormalisation of r1, r2.
      const nn = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
      r1 = nn(r1); r2 = nn(r2);
      const d = r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2];
      const a = r1.map((v, i) => v - (d / 2) * r2[i]), b = r2.map((v, i) => v - (d / 2) * r1[i]);
      r1 = nn(a); r2 = nn(b);
      const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
      // Camera centre in card coordinates: C = −Rᵀ t, R = [r1 r2 r3] (columns).
      const C = [
        -(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]),
        -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]),
        -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]),
      ];
      const tilt = (Math.acos(Math.min(1, Math.abs(r3[2]))) * 180) / Math.PI;
      return { f, C, tilt };
    };
    if (focalPx > 0) return { ...pose(focalPx), fEstimated: false };
    // ω = diag(t, t, 1), t = 1/f²: h1ᵀωh2 = 0 and h1ᵀωh1 = h2ᵀωh2, least squares in t.
    const a1 = Hc[0], b1 = Hc[3], c1 = Hc[6], a2 = Hc[1], b2 = Hc[4], c2 = Hc[7];
    const A1 = a1 * a2 + b1 * b2, B1 = c1 * c2;
    const A2 = a1 * a1 + b1 * b1 - a2 * a2 - b2 * b2, B2 = c1 * c1 - c2 * c2;
    const tt = -(A1 * B1 + A2 * B2) / (A1 * A1 + A2 * A2);
    const fDefault = 1.2 * diag;
    if (tt > 0) {
      const f = 1 / Math.sqrt(tt);
      if (f > 0.3 * diag && f < 6 * diag) {
        const p = pose(f);
        if (p.tilt >= 4) return { ...p, fEstimated: true };
      }
    }
    return { ...pose(fDefault), fEstimated: false };
  }

  // ---------------------------------------------------------------------------------------------------------- results
  function finish(img, Hlayout, info, opts) {
    const s = Number(opts.cardScale) > 0 ? Number(opts.cardScale) : 1;
    const H = norm9(mul3(Hlayout, [1 / s, 0, 0, 0, 1 / s, 0, 0, 0, 1])); // real mm -> px
    const Hinv = norm9(inv3(H));
    const pxPerMm = Math.sqrt(Math.abs(jac(H, 105 * s, 100 * s)));
    const corners = L.FINDER.centres.map(([x, y]) => applyH(Hlayout, x, y));
    const ex = exposure(img, Hlayout);
    const edgePx = edgeWidth(img, Hlayout);
    const cam = camera(H, img, opts.focalPx);
    const maxTilt = opts.maxTiltDeg == null ? 8 : opts.maxTiltDeg;
    const maxRms = opts.maxRmsPx == null ? 1 : opts.maxRmsPx;
    const tooBright = ex ? Math.max(...ex.white) >= 250 : false;
    const tooDark = ex ? lum(...ex.white) < 90 || lum(...ex.white) - lum(...ex.black) < 50 : true;
    const pxPerMmFull = pxPerMm * s; // per layout mm
    const sharp = edgePx <= Math.max(4.5, 1.2 * pxPerMmFull);
    const gates = {
      sharp,
      tilt: cam.tilt <= maxTilt,
      exposure: !tooDark && !tooBright,
      fit: info.rms != null && info.rms <= maxRms,
    };
    let reason = null;
    if (tooDark) reason = 'tooDark';
    else if (tooBright) reason = 'tooBright';
    else if (info.rms == null && !info.lowAccuracy && !Number.isFinite(edgePx)) reason = 'notFound'; // checker unreadable (covered?)
    else if (!gates.sharp && !info.lowAccuracy) reason = 'blurry';
    else if (info.rms == null && !info.lowAccuracy) reason = 'notFound';
    else if (!gates.tilt) reason = 'tilted';
    else if (!gates.fit && !info.lowAccuracy) reason = 'notFound';
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const out = {
      ok: !reason,
      H, Hinv,
      pxPerMm,
      wb: ex ? ex.wb.map(r3) : [1, 1, 1],
      rmsPx: info.rms == null ? null : r3(info.rms),
      tiltDeg: Math.round(cam.tilt * 10) / 10,
      corners,
      gates,
      method: info.method,
      cardScale: s,
      points: info.points || 0,
      edgePx: Number.isFinite(edgePx) ? r3(edgePx) : null,
      exposure: ex ? { white: ex.white.map(Math.round), black: ex.black.map(Math.round) } : null,
      cam: { f: Math.round(cam.f), fEstimated: cam.fEstimated, C: cam.C.map((v) => Math.round(v * 10) / 10) },
    };
    if (info.lowAccuracy) out.lowAccuracy = true;
    if (reason) out.reason = reason;
    return out;
  }

  /** No card: say so, unless the whole photo is too dark or burnt out (then that is the likely cause). */
  function notFound(img) {
    let reason = 'notFound';
    if (img && img.data && img.width > 0 && img.height > 0) {
      const { data, width, height } = img;
      const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)));
      const hist = new Uint32Array(256);
      let n = 0;
      for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
        const p = (y * width + x) * 4;
        hist[Math.min(255, Math.round(lum(data[p], data[p + 1], data[p + 2])))]++; n++;
      }
      let acc = 0, p95 = 255;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.95 * n) { p95 = v; break; } }
      let clipped = 0;
      for (let v = 250; v < 256; v++) clipped += hist[v];
      if (p95 < 90) reason = 'tooDark';
      else if (clipped > 0.3 * n) reason = 'tooBright';
    }
    return { ok: false, reason, gates: { sharp: false, tilt: false, exposure: reason === 'notFound' } };
  }

  function detectCard(img, opts = {}) {
    if (!img || !img.data || !(img.width > 0) || !(img.height > 0)) return notFound(null);
    const G = workGrey(img, opts.workMax || 1600);
    const bin = bradley(G);
    const clusters = findFinders(bin, G.w, G.h).filter((c) => c.n >= 2).slice(0, 8);
    if (clusters.length < 4) return notFound(img);
    const toImg = (c) => [c.x / G.sx, c.y / G.sy];
    let best = null;
    const n = clusters.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
      const set = [clusters[a], clusters[b], clusters[c], clusters[d]];
      const ms = set.map((k) => k.m);
      if (Math.max(...ms) > 2 * Math.min(...ms)) continue;
      const o = orderByRamp(set.map(toImg), img);
      if (!o || o.score < 5) continue;
      const score = o.score * 1000 + set.reduce((s, k) => s + k.n, 0);
      if (!best || score > best.score) best = { ...o, score };
    }
    if (!best) return notFound(img);
    const ref = refine(img, best.H);
    if (!ref) return finish(img, best.H, { rms: null, method: 'auto' }, opts);
    return finish(img, ref.H, { rms: ref.rms, points: ref.points, method: 'auto' }, opts);
  }

  /** Snap one tap to the nearest finder centre (or dark centre square) within 3 % of the image. */
  function snapTap(img, G, bin, tap) {
    const R = 0.03 * Math.max(img.width, img.height);
    const roi = [Math.floor((tap[0] - R) * G.sx), Math.floor((tap[1] - R) * G.sy), Math.ceil((tap[0] + R) * G.sx), Math.ceil((tap[1] + R) * G.sy)];
    const near = findFinders(bin, G.w, G.h, roi)
      .map((c) => ({ p: [c.x / G.sx, c.y / G.sy], n: c.n }))
      .filter((c) => Math.hypot(c.p[0] - tap[0], c.p[1] - tap[1]) <= R)
      .sort((a, b) => b.n - a.n || Math.hypot(a.p[0] - tap[0], a.p[1] - tap[1]) - Math.hypot(b.p[0] - tap[0], b.p[1] - tap[1]));
    if (near.length) return near[0].p;
    // Dark components inside the window that do not touch its edge: take the one nearest the tap.
    const [x0, y0] = [Math.max(0, roi[0]), Math.max(0, roi[1])];
    const [x1, y1] = [Math.min(G.w, roi[2]), Math.min(G.h, roi[3])];
    const seen = new Uint8Array((x1 - x0) * (y1 - y0));
    let best = null;
    const stack = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y - y0) * (x1 - x0) + (x - x0);
      if (seen[k] || !bin[y * G.w + x]) continue;
      seen[k] = 1; stack.push(x, y);
      let n = 0, sx = 0, sy = 0, edge = false;
      while (stack.length) {
        const yy = stack.pop(), xx = stack.pop();
        n++; sx += xx + 0.5; sy += yy + 0.5;
        if (xx === x0 || yy === y0 || xx === x1 - 1 || yy === y1 - 1) edge = true;
        for (const [ax, ay] of [[xx + 1, yy], [xx - 1, yy], [xx, yy + 1], [xx, yy - 1]]) {
          if (ax < x0 || ay < y0 || ax >= x1 || ay >= y1) continue;
          const kk = (ay - y0) * (x1 - x0) + (ax - x0);
          if (!seen[kk] && bin[ay * G.w + ax]) { seen[kk] = 1; stack.push(ax, ay); }
        }
      }
      if (edge || n < 4) continue;
      const p = [sx / n / G.sx, sy / n / G.sy];
      const d = Math.hypot(p[0] - tap[0], p[1] - tap[1]);
      if (!best || d < best.d) best = { p, d };
    }
    return best ? best.p : tap.slice();
  }

  function fromTaps(img, taps, opts = {}) {
    if (!img || !img.data || !Array.isArray(taps) || taps.length !== 4) return notFound(null);
    if (taps.some((t) => !Array.isArray(t) || !Number.isFinite(+t[0]) || !Number.isFinite(+t[1]))) return notFound(null);
    const G = workGrey(img, opts.workMax || 1600);
    const bin = bradley(G);
    const pts = taps.map((t) => snapTap(img, G, bin, [+t[0], +t[1]]));
    let o = orderByRamp(pts, img);
    if (!o) return notFound(null);
    if (o.score < 5) {
      // The ramp can't be read (covered, glare): assume the card is upright — TL is the top-left-most point.
      const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
      const q = (p) => (p[1] < cy ? 0 : 2) + (p[0] < cx ? 0 : 1); // 0 TL, 1 TR, 2 BL, 3 BR
      const ord = [];
      for (const p of pts) ord[q(p)] = p;
      if (ord.filter(Boolean).length !== 4) return notFound(null);
      const H = homography4(L.FINDER.centres, ord);
      if (!H) return notFound(null);
      o = { H, pts: ord };
    }
    // Snap the taps' finders to their dark-square centroids for the 4-point fallback.
    const fin = L.FINDER.centres.map((c, i) => finderCentroid(img, o.H, c) || o.pts[i]);
    const H4 = homography4(L.FINDER.centres, fin) || o.H;
    const ref = refine(img, H4);
    if (!ref || ref.rms > 2) return finish(img, H4, { rms: null, method: 'tap', lowAccuracy: true }, opts);
    return finish(img, ref.H, { rms: ref.rms, points: ref.points, method: 'tap' }, opts);
  }

  /** Focal length in px of an image from the EXIF 35 mm-equivalent focal length (FocalLengthIn35mmFilm). */
  const focalFromExif35 = (f35, width, height) => (Number(f35) > 0 ? (Number(f35) / 43.267) * Math.hypot(width, height) : undefined);

  const cardToImage = (H, xMm, yMm) => applyH(H, xMm, yMm);
  const imageToCard = (Hinv, x, y) => applyH(Hinv, x, y);

  return {
    detectCard, fromTaps, cardToImage, imageToCard, focalFromExif35,
    // Shared maths (drinkware-measure.js and tests use them).
    _internal: { applyH, homography4, fitH, inv3, mul3, solve, lumAt, workGrey, bradley, findFinders, camera, jac },
  };
}));
