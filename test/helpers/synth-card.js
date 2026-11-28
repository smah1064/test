'use strict';
/*
 * Synthetic product photos for the calibration and measurement tests (and helper D's e2e fixtures): a pinhole camera
 * ray-traces the calibration card (drawn from public/js/calib-card-layout.js) standing upright, plus an optional
 * cup (a truncated cone, optionally leaning, optionally with a C-shaped handle) standing on the same table with its
 * axis IN THE CARD'S PLANE — the set-up the wizard asks for. Then optional Gaussian blur and noise.
 *
 * WORLD = CARD COORDINATES, real mm: the card is the plane z = 0, its page's top-left corner at the origin, x right,
 * y DOWN, z AWAY from the camera (the camera sits at z < 0). The visible face is x 0..210, y 0..200 (× cardScale); the
 * card stands on the table at y = 200 × cardScale (its fold line), so a cup standing on the same table has its base
 * at baseY = 200 × cardScale (the default).
 * IMAGE px are continuous (pixel (i, j) covers [i, i+1) × [j, j+1)), as in calib-detect.js.
 *
 *   renderScene(opts) -> { img: { data: Uint8ClampedArray RGBA, width, height }, H, Hinv, finders, project, camera }
 *     opts = {
 *       width = 1600, height = 1200,
 *       focalPx = 1.2 × diagonal,                    // pinhole focal length in px (principal point = image centre)
 *       camera = { pos: [x, y, z], target: [x, y, z], rollDeg = 0 },   // mm; default: 1 m in front of the scene's middle
 *       cardScale = 1,                               // the printed card's real size ÷ the layout
 *       paper = { white: 238, black: 26 },           // grey levels of paper and ink
 *       cast = [1, 0.97, 0.9],                       // colour cast of the light (per-channel multiplier)
 *       background = { top: [228,228,226], bottom: [214,214,212] },    // vertical gradient behind everything
 *       cup = null | {
 *         axisX,                                     // mm, where the axis meets the table (card plane)
 *         baseY = 200 × cardScale, axisZ = 0,
 *         heightMm, topDiaMm, bottomDiaMm,
 *         leanDeg = 0,                               // axis tilt in the card plane (+ = top leans right)
 *         colour = [52, 104, 168],
 *         handle = null | { y0Mm, y1Mm, reachMm, side = 1, barMm = 9, depthMm = 12 },
 *           // y0/y1 from the rim down; reachMm = how far its outside sticks out beyond the body at the band's middle
 *           // height; side 1 = right, -1 = left (seen from the camera)
 *       },
 *       samples = 2,                                 // supersampling per axis (anti-aliasing)
 *       blur = 0, noise = 0, seed = 1,               // Gaussian blur sigma (px) and noise sigma (grey levels)
 *     }
 *   H        card mm -> image px (3 × 3 row-major flat array of 9), the ground truth; Hinv its inverse.
 *   finders  the four finder centres TL, TR, BL, BR in image px (ground truth for calib-detect).
 *   project(x, y, z) -> [u, v] world mm -> image px.
 *   camera   { pos, R (rows: camera x, y, z axes in world), f, cx, cy }.
 *
 *   cupTruth(cup) -> { heightMm, topDiaMm, bottomDiaMm, handle: { y0Mm, y1Mm, widthMm } | null } what an exact
 *     measurement should report (widthMm here = the most the handle sticks out beyond the body inside its band).
 *   toPng(img), toJpeg(img, quality = 92) -> Promise<Buffer> (sharp), to write fixture files.
 */
const L = require('../../public/js/calib-card-layout');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };

function makeCamera({ pos, target, rollDeg = 0 }, f, width, height) {
  const zc = unit(sub(target, pos));
  let xc = unit(cross([0, 1, 0], zc)); // world y is down: (down × forward) = right
  let yc = cross(zc, xc);
  if (rollDeg) {
    const a = (rollDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const x2 = xc.map((v, i) => c * v + s * yc[i]);
    const y2 = yc.map((v, i) => -s * xc[i] + c * v);
    xc = x2; yc = y2;
  }
  return { pos, R: [xc, yc, zc], f, cx: width / 2, cy: height / 2 };
}

function slab(o, d, lo, hi) { // ray vs axis-aligned box in local coords: [tNear, tFar, axis of entry] or null
  let t0 = -Infinity, t1 = Infinity, ax = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; ax = i; }
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return t1 > 0 ? [t0, t1, ax] : null;
}

function cupModel(cup, cardScale) {
  const lean = ((cup.leanDeg || 0) * Math.PI) / 180;
  const B = [cup.axisX, cup.baseY == null ? L.FOLD_Y * cardScale : cup.baseY, cup.axisZ || 0];
  const u = [Math.sin(lean), -Math.cos(lean), 0]; // up the axis
  const e1 = [Math.cos(lean), Math.sin(lean), 0]; // across, to the right
  const e3 = [0, 0, 1];
  const Hc = cup.heightMm, rT = cup.topDiaMm / 2, rB = cup.bottomDiaMm / 2;
  const k = (rT - rB) / Hc;
  const rAt = (h) => rB + k * h;
  const boxes = [];
  if (cup.handle) {
    const hd = cup.handle, side = hd.side || 1, bar = hd.barMm || 9, dep = (hd.depthMm || 12) / 2;
    const hTop = Hc - hd.y0Mm, hBot = Hc - hd.y1Mm;
    const xOut = rAt((hTop + hBot) / 2) + hd.reachMm;
    const xIn = Math.min(rAt(hTop), rAt(hBot)) - 3;
    const box = (x0, x1, h0, h1) => {
      const a = side * x0, b = side * x1;
      boxes.push({ lo: [Math.min(a, b), h0, -dep], hi: [Math.max(a, b), h1, dep] });
    };
    box(xIn, xOut, hTop - bar, hTop);
    box(xIn, xOut, hBot, hBot + bar);
    box(xOut - bar, xOut, hBot, hTop);
  }
  const reach = Math.max(rT, rB) + (cup.handle ? cup.handle.reachMm + 5 : 0);
  return { B, u, e1, e3, Hc, rT, rB, k, rAt, boxes, bound: Math.hypot(reach, Hc) + 1, colour: cup.colour || [52, 104, 168] };
}

// Nearest hit of a world ray with the cup: { t, n (world normal) } or null.
function hitCup(M, O, D) {
  const d0 = sub(O, M.B);
  // Quick reject: bounding sphere around the base.
  const mid = [d0[0] - M.u[0] * M.Hc / 2, d0[1] - M.u[1] * M.Hc / 2, d0[2]];
  const b0 = dot(mid, D), c0 = dot(mid, mid) - M.bound * M.bound;
  if (b0 * b0 - c0 < 0) return null;
  const o = [dot(d0, M.e1), dot(d0, M.u), dot(d0, M.e3)];
  const d = [dot(D, M.e1), dot(D, M.u), dot(D, M.e3)];
  let best = null;
  const take = (t, nl) => { if (t > 1e-6 && (!best || t < best.t)) best = { t, nl }; };
  const q0 = M.rB + M.k * o[1], q1 = M.k * d[1];
  const A = d[0] * d[0] + d[2] * d[2] - q1 * q1;
  const Bq = 2 * (o[0] * d[0] + o[2] * d[2] - q0 * q1);
  const C = o[0] * o[0] + o[2] * o[2] - q0 * q0;
  const disc = Bq * Bq - 4 * A * C;
  if (disc >= 0 && Math.abs(A) > 1e-12) {
    const s = Math.sqrt(disc);
    for (const t of [(-Bq - s) / (2 * A), (-Bq + s) / (2 * A)]) {
      const h = o[1] + t * d[1];
      if (h < 0 || h > M.Hc) continue;
      const x = o[0] + t * d[0], z = o[2] + t * d[2];
      take(t, [x, -(M.rB + M.k * h) * M.k, z]);
    }
  }
  if (Math.abs(d[1]) > 1e-12) {
    for (const [h, r, ny] of [[M.Hc, M.rT, 1], [0, M.rB, -1]]) {
      const t = (h - o[1]) / d[1];
      const x = o[0] + t * d[0], z = o[2] + t * d[2];
      if (x * x + z * z <= r * r) take(t, [0, ny, 0]);
    }
  }
  for (const b of M.boxes) {
    const r = slab(o, d, b.lo, b.hi);
    if (r && r[0] > 1e-6) { const nl = [0, 0, 0]; nl[r[2]] = -Math.sign(d[r[2]]) || 1; take(r[0], nl); }
  }
  if (!best) return null;
  const nl = unit(best.nl);
  const n = [0, 1, 2].map((i) => nl[0] * M.e1[i] + nl[1] * M.u[i] + nl[2] * M.e3[i]);
  return { t: best.t, n };
}

function gaussBlur(ch, w, h, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += ch[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    ch[y * w + x] = a;
  }
}

function renderScene(opts = {}) {
  const width = opts.width || 1600, height = opts.height || 1200;
  const s = opts.cardScale || 1;
  const f = opts.focalPx || 1.2 * Math.hypot(width, height);
  const camOpt = opts.camera || { pos: [190 * s, 120 * s, -1000], target: [190 * s, 120 * s, 0] };
  const cam = makeCamera(camOpt, f, width, height);
  const [xc, yc, zc] = cam.R;
  const C = cam.pos;
  const paper = { white: 238, black: 26, ...(opts.paper || {}) };
  const cast = opts.cast || [1, 0.97, 0.9];
  const bg = { top: [228, 228, 226], bottom: [214, 214, 212], ...(opts.background || {}) };
  const cup = opts.cup ? cupModel(opts.cup, s) : null;
  const light = unit([-0.45, -0.55, -0.7]);
  const S = opts.samples || 2;
  const W = L.PAGE.w * s, Hv = L.FOLD_Y * s;

  const R = new Float32Array(width * height), G = new Float32Array(width * height), Bc = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const ty = j / Math.max(1, height - 1);
    const bgc = [0, 1, 2].map((i) => bg.top[i] * (1 - ty) + bg.bottom[i] * ty);
    for (let i = 0; i < width; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
        const u = (i + (si + 0.5) / S - cam.cx) / f, v = (j + (sj + 0.5) / S - cam.cy) / f;
        const D = [xc[0] * u + yc[0] * v + zc[0], xc[1] * u + yc[1] * v + zc[1], xc[2] * u + yc[2] * v + zc[2]];
        let col = bgc, tBest = Infinity;
        if (Math.abs(D[2]) > 1e-12) {
          const t = -C[2] / D[2];
          if (t > 0) {
            const X = C[0] + t * D[0], Y = C[1] + t * D[1];
            if (X >= 0 && X <= W && Y >= 0 && Y <= Hv) {
              const ink = L.colourAt(X / s, Y / s);
              col = [0, 1, 2].map((c) => (paper.black + (paper.white - paper.black) * (ink[c] / 255)) * cast[c]);
              tBest = t;
            }
          }
        }
        if (cup) {
          const hit = hitCup(cup, C, D);
          if (hit && hit.t < tBest) {
            const sh = 0.35 + 0.65 * Math.max(0, dot(hit.n, light));
            col = [0, 1, 2].map((c) => cup.colour[c] * sh * cast[c]);
          }
        }
        r += col[0]; g += col[1]; b += col[2];
      }
      const k = j * width + i, n = S * S;
      R[k] = r / n; G[k] = g / n; Bc[k] = b / n;
    }
  }
  if (opts.blur > 0) for (const ch of [R, G, Bc]) gaussBlur(ch, width, height, opts.blur);
  const data = new Uint8ClampedArray(width * height * 4);
  const rnd = mulberry32(opts.seed || 1);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const nz = opts.noise || 0;
  for (let k = 0, p = 0; k < width * height; k++, p += 4) {
    data[p] = R[k] + (nz ? nz * gauss() : 0);
    data[p + 1] = G[k] + (nz ? nz * gauss() : 0);
    data[p + 2] = Bc[k] + (nz ? nz * gauss() : 0);
    data[p + 3] = 255;
  }

  // Ground truth homography: card mm -> px = K [r1 r2 t].
  const t = [-dot(xc, C), -dot(yc, C), -dot(zc, C)];
  const Hm = [
    f * xc[0] + cam.cx * zc[0], f * xc[1] + cam.cx * zc[1], f * t[0] + cam.cx * t[2],
    f * yc[0] + cam.cy * zc[0], f * yc[1] + cam.cy * zc[1], f * t[1] + cam.cy * t[2],
    zc[0], zc[1], t[2],
  ];
  const H = Hm.map((v) => v / Hm[8]);
  const project = (x, y, z) => {
    const d = sub([x, y, z], C);
    const a = dot(xc, d), b = dot(yc, d), c = dot(zc, d);
    return [cam.cx + (f * a) / c, cam.cy + (f * b) / c];
  };
  const finders = L.FINDER.centres.map(([x, y]) => project(x * s, y * s, 0));
  const { _internal } = require('../../public/js/calib-detect');
  return { img: { data, width, height }, H, Hinv: _internal.inv3(H), finders, project, camera: cam };
}

function cupTruth(cup) {
  const M = cupModel(cup, 1);
  let handle = null;
  if (cup.handle) {
    const hd = cup.handle;
    const hTop = M.Hc - hd.y0Mm, hBot = M.Hc - hd.y1Mm;
    const xOut = M.rAt((hTop + hBot) / 2) + hd.reachMm;
    handle = { y0Mm: hd.y0Mm, y1Mm: hd.y1Mm, widthMm: xOut - Math.min(M.rAt(hTop), M.rAt(hBot)) };
  }
  return { heightMm: cup.heightMm, topDiaMm: cup.topDiaMm, bottomDiaMm: cup.bottomDiaMm, handle };
}

async function toPng(img) {
  const sharp = require('sharp');
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
}
async function toJpeg(img, quality = 92) {
  const sharp = require('sharp');
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } }).jpeg({ quality }).toBuffer();
}

module.exports = { renderScene, cupTruth, toPng, toJpeg, makeCamera };
