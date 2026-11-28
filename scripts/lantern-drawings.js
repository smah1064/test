#!/usr/bin/env node
'use strict';
// PROTOTYPE laser-cut drawings for the two wooden Ramadan lanterns (familyfanous, arabesquelantern).
//
// One parametric generator writes, into docs/lanterns/ (or --out):
//   <model>-body.svg / .dxf   every part of one lantern, 1:1 in mm, laid out flat (CUT / ENGRAVE / SCORE / NOTES)
//   <model>-assembly.svg      front elevation, LED + battery access (bayonet hatch), assembly steps (EN + AR)
//   slot-fit-test.svg / .dxf  a strip with slots 2.8 … 3.4 mm and a matching tab, to find --slot for the sheet
//   lanterns.json             the numbers (overall size, name area on the plaque, parameters)
//   README.md                 what each file is and how to regenerate
//
//   node scripts/lantern-drawings.js --thickness 3 --slot 3.1 --kerf 0.15
//
// Construction (both models): four lattice walls finger-jointed at the corners, tabs top and bottom; the walls are
// glued into a base (top plate on a low skirt box whose ends are the feet) and into a cap plate; a faceted pierced
// dome (four faces per tier) glued over two crossed spines that carry the hanging ring and are tabbed into the cap.
// The LED tea light sits in a pocket in the base and is reached from below through a twist-lock (bayonet) hatch,
// so the lantern can hang by its ring with the hatch locked. Proportions are measured from the approved mockups
// (scratchpad lanterns/tl.png and bl.png); overall height 300 mm from the feet to the top of the ring.
//
// Lattice and arabesque cut-outs are made on a fine grid (a distance field of the wood strokes, contoured with
// marching squares), so every web is at least --web mm wide before the kerf, no wood island can fall out, and
// slivers are dropped.
//
// No dependencies: plain Node. Everything here is a PROTOTYPE until the workshop has cut the fit test, measured
// the sheet and the LED, and confirmed the joints.

const fs = require('fs');
const path = require('path');

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------------------------- parameters
const DEFAULTS = {
  thickness: 3, // nominal sheet thickness (mm): finger depth, tab length, layer stack
  slot: 3.1, // drawn slot width (mm) for every tab-and-slot joint
  kerf: 0.15, // laser kerf (mm): finger joints are compensated, webs are drawn web + kerf
  web: 3, // the narrowest wood web in the lattice after cutting (mm), never below 2.5
  ledDia: 40, // LED tea light diameter (mm)
  ledHeight: 20, // LED tea light height (mm), for the clearance check and the diagram
  ledClear: 1, // added to ledDia for the pocket
  sheetWidth: 600, // the layout's width (mm)
  res: 6, // lattice grid, cells per mm
  out: path.join(__dirname, '..', 'docs', 'lanterns'),
};
const ARG_KEYS = {
  thickness: 'thickness', slot: 'slot', kerf: 'kerf', web: 'web', 'led-dia': 'ledDia', 'led-height': 'ledHeight',
  'led-clearance': 'ledClear', 'sheet-width': 'sheetWidth', res: 'res', out: 'out',
};

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const m = String(argv[i]).match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument ${argv[i]}`);
    if (m[1] === 'help') { o.help = true; continue; }
    const key = ARG_KEYS[m[1]];
    if (!key) throw new Error(`Unknown option --${m[1]}`);
    const v = m[2] !== undefined ? m[2] : argv[++i];
    o[key] = key === 'out' ? v : Number(v);
    if (key !== 'out' && !Number.isFinite(o[key])) throw new Error(`--${m[1]} needs a number`);
  }
  return o;
}

function checkParams(p) {
  if (!(p.thickness >= 2.5 && p.thickness <= 3.6)) throw new Error('--thickness must be 2.5 … 3.6 mm (the design is for 3 mm sheet)');
  if (!(p.slot >= p.thickness - 0.4 && p.slot <= p.thickness + 0.8)) throw new Error('--slot must be within thickness −0.4 … +0.8 mm');
  if (!(p.kerf >= 0 && p.kerf <= 0.5)) throw new Error('--kerf must be 0 … 0.5 mm');
  if (!(p.web >= 2.5)) throw new Error('--web must be at least 2.5 mm (3 mm ply)');
  if (!(p.ledDia >= 20 && p.ledDia <= 60)) throw new Error('--led-dia must be 20 … 60 mm');
  if (!(p.res >= 3 && p.res <= 12)) throw new Error('--res must be 3 … 12');
}

// ---------------------------------------------------------------------------------------------- the two models
// All lengths in mm. Heights measured on the mockups (front view, perspective allowed for), scaled to 300 mm:
//   Family Fanous  ring 9.4 %, roof 18.1 %, body 64.6 %, base 7.9 %; body W/H 0.60; plaque 0.83 W × 0.69 body H
//   Arabesque Arch ring 8 %, roof 21 %, body 62.5 %, base 8.6 %; body W/H 0.65; nameplate 85 × 70 at 53 % of the body
const MODELS = {
  familyfanous: {
    id: 'familyfanous',
    title: 'Family Fanous',
    titleAr: 'فانوس العيلة',
    H: 300,
    W: 116, // body, outside of the walls (square plan)
    bodyH: 194,
    base: { skirtH: 21, footH: 8, footL: 18, skirtInset: 3, plateOv: 9, steps: [], pocketRings: 1 },
    cap: [{ ov: 3, walls: true, spines: true }],
    roof: { r: [43.5, 42, 36, 25, 13], z: [0, 15, 29, 40, 46] },
    ring: { od: 26, id: 16, stemW: 10 },
    walls: { style: 'stars', frame: 10, period: 24 },
    plaque: { kind: 'scallop', w: 96, h: 133, top: 19 },
  },
  arabesquelantern: {
    id: 'arabesquelantern',
    title: 'Arabesque Arch Lantern',
    titleAr: 'فانوس الأرابيسك',
    H: 300,
    W: 122,
    bodyH: 188,
    base: { skirtH: 17, footH: 6, footL: 18, skirtInset: 3, plateOv: 10, steps: [{ ov: 4 }, { ov: 4 }], pocketRings: 0 },
    cap: [{ ov: 3, walls: true, spines: false }, { ov: 6, walls: false, spines: true }],
    roof: { r: [54, 52.5, 45.5, 32, 13.5], z: [0, 15, 31, 44, 52] },
    ring: { od: 22, id: 13, stemW: 10 },
    walls: { style: 'arabesque', frame: 8, archFrame: 12, sideFrame: 11 },
    plaque: { kind: 'cartouche', w: 85, h: 70, centerY: 99 },
  },
};

// ---------------------------------------------------------------------------------------------- geometry helpers
const fx = (v) => (Math.round(v * 1000) / 1000).toString();
function arc(cx, cy, r, a0, a1, step = 0.35) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
function circle(cx, cy, r, step = 0.3) { const p = arc(cx, cy, r, 0, TAU, step); p.pop(); return p; }
function rect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return [
    ...arc(x + w - r, y + r, r, -Math.PI / 2, 0), ...arc(x + w - r, y + h - r, r, 0, Math.PI / 2),
    ...arc(x + r, y + h - r, r, Math.PI / 2, Math.PI), ...arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI),
  ];
}
function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i]; const b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function bboxOf(polys) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
const tr = (p, dx, dy) => p.map(([x, y]) => [x + dx, y + dy]);
const scalePts = (p, sx, sy, cx = 0, cy = 0) => p.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
const rot = (p, a, cx = 0, cy = 0) => { const c = Math.cos(a); const s = Math.sin(a); return p.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
function dedupe(p, eps = 1e-6) {
  const out = [];
  for (const q of p) { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - q[0]) > eps || Math.abs(l[1] - q[1]) > eps) out.push(q); }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < eps && Math.abs(out[0][1] - out[out.length - 1][1]) < eps) out.pop();
  return out;
}
function pip(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px; const ey = ay + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}
/** Offset a convex polygon inward by d. */
function insetConvex(poly, d) {
  const s = area(poly) > 0 ? 1 : -1;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]; const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dx, dy);
    const nx = (s * -dy) / l; const ny = (s * dx) / l;
    return { p: [a[0] + nx * d, a[1] + ny * d], v: [dx, dy] };
  });
  return lines.map((L, i) => {
    const M = lines[(i + lines.length - 1) % lines.length];
    const den = M.v[0] * L.v[1] - M.v[1] * L.v[0];
    const t = ((L.p[0] - M.p[0]) * L.v[1] - (L.p[1] - M.p[1]) * L.v[0]) / den;
    return [M.p[0] + M.v[0] * t, M.p[1] + M.v[1] * t];
  });
}
function quad(p0, p1, p2, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
  return out;
}
function cubic(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; const u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
/** Closed outline through the cusps, each pair joined by an arc bulging outward (sagitta k × chord). */
function lobedOutline(cusps, k) {
  const s = area(cusps) > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < cusps.length; i++) {
    const a = cusps[i]; const b = cusps[(i + 1) % cusps.length];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const c = Math.hypot(dx, dy);
    const nin = [(s * -dy) / c, (s * dx) / c]; // inward normal
    const sag = k * c; const R = (c * c / 4 + sag * sag) / (2 * sag);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const C = [m[0] + nin[0] * (R - sag), m[1] + nin[1] * (R - sag)];
    let a0 = Math.atan2(a[1] - C[1], a[0] - C[0]); let a1 = Math.atan2(b[1] - C[1], b[0] - C[0]);
    // take the sweep whose middle lies on the outward side
    let d = a1 - a0; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    const mid = [C[0] + R * Math.cos(a0 + d / 2), C[1] + R * Math.sin(a0 + d / 2)];
    if ((mid[0] - m[0]) * nin[0] + (mid[1] - m[1]) * nin[1] > 0) d = d > 0 ? d - TAU : d + TAU;
    a1 = a0 + d;
    const pts = arc(C[0], C[1], R, a0, a1, 0.3); pts.pop();
    out.push(...pts);
  }
  return out;
}
/** Points of a mirrored shape: right half (top to bottom, x ≥ 0) + its mirror (bottom to top). */
function mirrorHalf(right) {
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return [...right, ...left];
}
function fitTo(poly, w, h) {
  const b = bboxOf([poly]);
  return poly.map(([x, y]) => [((x - (b.x0 + b.x1) / 2) * w) / b.w, ((y - b.y0) * h) / b.h]);
}
/** Half-width of a polygon (symmetric about x = 0) at height y: the smallest |x| where y crosses an edge. */
function halfWidthAt(poly, y) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (Math.abs(x) < best) best = Math.abs(x);
    }
  }
  return best;
}
/** Douglas-Peucker for an open polyline. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop(); let md = 0; let mi = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = segDist(pts[i][0], pts[i][1], pts[i0][0], pts[i0][1], pts[i1][0], pts[i1][1]); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyClosed(loop, tol) {
  if (loop.length < 8) return loop;
  let far = 0; let fd = 0;
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(loop.slice(0, far + 1), tol); const b = simplify([...loop.slice(far), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// ---------------------------------------------------------------------------------------------- lattice engine
/**
 * Holes of a lattice inside `win` (a polygon): wood = outside the window ∪ strokes (polylines, width strokeW) ∪
 * solids (polygons). Returns hole polygons. Wood islands not joined to the frame become holes; holes thinner than
 * 2·minR or smaller than minArea become wood.
 */
function latticeHoles({ win, strokes = [], strokeW, solids = [], res = 6, minArea = 10, minR = 1.0, neck = 0.75, tol = 0.04 }) {
  const b = bboxOf([win]);
  const pad = 2;
  const x0 = b.x0 - pad; const y0 = b.y0 - pad;
  const W = Math.ceil((b.w + 2 * pad) * res) + 1; const H = Math.ceil((b.h + 2 * pad) * res) + 1;
  const f = new Float32Array(W * H);
  const n = win.length; const BAND = 6; // exact distance within BAND mm of the window edge, ±BAND beyond
  const ins = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const py = y0 + j / res;
    const xs = []; // crossings of this row with the window: fast inside test
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const [xi, yi] = win[i]; const [xk, yk] = win[k];
      if ((yi > py) !== (yk > py)) xs.push(xi + ((py - yi) * (xk - xi)) / (yk - yi));
    }
    xs.sort((a, c) => a - c);
    let inside = false; let xi = 0;
    for (let i = 0; i < W; i++) {
      const px = x0 + i / res;
      while (xi < xs.length && xs[xi] < px) { inside = !inside; xi++; }
      ins[j * W + i] = inside ? 1 : 0; f[j * W + i] = inside ? -BAND : BAND;
    }
  }
  for (let e = 0, k = n - 1; e < n; k = e++) {
    const [ax, ay] = win[k]; const [bx, by] = win[e];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - BAND - x0) * res)); const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + BAND - x0) * res));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - BAND - y0) * res)); const j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + BAND - y0) * res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * W + i; const d = segDist(x0 + i / res, y0 + j / res, ax, ay, bx, by);
      if (ins[idx]) { if (-d > f[idx]) f[idx] = -d; } else if (d < f[idx]) f[idx] = d;
    }
  }
  const hw = strokeW / 2;
  for (const line of strokes) {
    for (let s = 0; s + 1 < line.length; s++) {
      const [ax, ay] = line[s]; const [bx, by] = line[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - 1 - x0) * res)); const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + hw + 1 - x0) * res));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - hw - 1 - y0) * res)); const j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + hw + 1 - y0) * res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = hw - segDist(x0 + i / res, y0 + j / res, ax, ay, bx, by);
        if (v > f[j * W + i]) f[j * W + i] = v;
      }
    }
  }
  for (const poly of solids) { // wood inside: +distance inside (exact within 3 mm of its edge), −distance outside
    const SB = 3; const sb = bboxOf([poly]);
    const i0 = Math.max(0, Math.floor((sb.x0 - SB - x0) * res)); const i1 = Math.min(W - 1, Math.ceil((sb.x1 + SB - x0) * res));
    const j0 = Math.max(0, Math.floor((sb.y0 - SB - y0) * res)); const j1 = Math.min(H - 1, Math.ceil((sb.y1 + SB - y0) * res));
    const sw = i1 - i0 + 1; const sv = new Float32Array(sw * (j1 - j0 + 1)); const sin = new Uint8Array(sv.length);
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j / res; const xs = [];
      for (let e = 0, k = poly.length - 1; e < poly.length; k = e++) {
        const [xa, ya] = poly[e]; const [xb, yb] = poly[k];
        if ((ya > py) !== (yb > py)) xs.push(xa + ((py - ya) * (xb - xa)) / (yb - ya));
      }
      xs.sort((a, c) => a - c); let inside = false; let xi = 0;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i / res; while (xi < xs.length && xs[xi] < px) { inside = !inside; xi++; }
        const q = (j - j0) * sw + (i - i0); sin[q] = inside ? 1 : 0; sv[q] = inside ? SB : -SB;
      }
    }
    for (let e = 0, k = poly.length - 1; e < poly.length; k = e++) {
      const [ax, ay] = poly[k]; const [bx, by] = poly[e];
      const a0 = Math.max(i0, Math.floor((Math.min(ax, bx) - SB - x0) * res)); const a1 = Math.min(i1, Math.ceil((Math.max(ax, bx) + SB - x0) * res));
      const b0 = Math.max(j0, Math.floor((Math.min(ay, by) - SB - y0) * res)); const b1 = Math.min(j1, Math.ceil((Math.max(ay, by) + SB - y0) * res));
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const q = (j - j0) * sw + (i - i0); const d = segDist(x0 + i / res, y0 + j / res, ax, ay, bx, by);
        if (sin[q]) { if (d < sv[q]) sv[q] = d; } else if (-d > sv[q]) sv[q] = -d;
      }
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = sv[(j - j0) * sw + (i - i0)]; if (v > f[j * W + i]) f[j * W + i] = v; }
  }
  // wood islands → holes (4-connected flood from the border, which is frame)
  const seen = new Uint8Array(W * H); const q = new Int32Array(W * H); let qh = 0; let qt = 0;
  const pushIf = (idx) => { if (!seen[idx] && f[idx] >= 0) { seen[idx] = 1; q[qt++] = idx; } };
  for (let i = 0; i < W; i++) { pushIf(i); pushIf((H - 1) * W + i); }
  for (let j = 0; j < H; j++) { pushIf(j * W); pushIf(j * W + W - 1); }
  while (qh < qt) {
    const idx = q[qh++]; const i = idx % W; const j = (idx - i) / W;
    if (i > 0) pushIf(idx - 1); if (i < W - 1) pushIf(idx + 1); if (j > 0) pushIf(idx - W); if (j < H - 1) pushIf(idx + W);
  }
  for (let idx = 0; idx < W * H; idx++) if (f[idx] >= 0 && !seen[idx]) f[idx] = -0.01;
  // opening of the holes by neck: drop hole necks narrower than 2·neck (they would burn or leave hairlines)
  if (neck > 0) {
    const g = new Float32Array(W * H).fill(-1e9); const rp = Math.ceil((neck + 0.5) * res);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const idx = j * W + i; if (-f[idx] < neck) continue; g[idx] = Math.max(g[idx], -f[idx]);
      if (-f[idx - 1] >= neck && -f[idx + 1] >= neck && -f[idx - W] >= neck && -f[idx + W] >= neck) continue; // interior of the eroded set
      const dep = -f[idx];
      for (let dj = -rp; dj <= rp; dj++) for (let di = -rp; di <= rp; di++) {
        const jj = j + dj; const ii = i + di; if (jj < 0 || ii < 0 || jj >= H || ii >= W) continue;
        const v = dep - Math.hypot(di, dj) / res; const k = jj * W + ii; if (v > g[k]) g[k] = v;
      }
    }
    for (let idx = 0; idx < W * H; idx++) { if (f[idx] < 0) f[idx] = g[idx] > -1e8 ? Math.max(f[idx], -g[idx]) : 0.01; }
  }
  // small or thin holes → wood
  const lab = new Int32Array(W * H).fill(-1);
  for (let start = 0; start < W * H; start++) {
    if (f[start] >= 0 || lab[start] >= 0) continue;
    qh = 0; qt = 0; q[qt++] = start; lab[start] = start; let count = 0; let depth = 0;
    while (qh < qt) {
      const idx = q[qh++]; count++; if (-f[idx] > depth) depth = -f[idx];
      const i = idx % W; const j = (idx - i) / W;
      for (const nb of [i > 0 ? idx - 1 : -1, i < W - 1 ? idx + 1 : -1, j > 0 ? idx - W : -1, j < H - 1 ? idx + W : -1]) {
        if (nb >= 0 && f[nb] < 0 && lab[nb] < 0) { lab[nb] = start; q[qt++] = nb; }
      }
    }
    if (count / (res * res) < minArea || depth < minR) for (let k = 0; k < qt; k++) f[q[k]] = 0.01;
  }
  return marchingSquares(f, W, H, x0, y0, res).map((l) => simplifyClosed(l, tol)).filter((l) => l.length >= 3 && Math.abs(area(l)) >= minArea * 0.5);
}

function marchingSquares(f, W, H, x0, y0, res) {
  const pts = new Map(); // edge key → point
  const adj = new Map(); // edge key → [other keys]
  const P = (key, ia, ja, ib, jb) => {
    if (!pts.has(key)) {
      const va = f[ja * W + ia]; const vb = f[jb * W + ib]; const t = va / (va - vb);
      pts.set(key, [x0 + (ia + (ib - ia) * t) / res, y0 + (ja + (jb - ja) * t) / res]);
    }
    return key;
  };
  const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const tl = f[j * W + i] < 0; const trr = f[j * W + i + 1] < 0; const br = f[(j + 1) * W + i + 1] < 0; const bl = f[(j + 1) * W + i] < 0;
    const c = (tl ? 8 : 0) | (trr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = () => P(`h${i},${j}`, i, j, i + 1, j); const B = () => P(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1);
    const L = () => P(`v${i},${j}`, i, j, i, j + 1); const R = () => P(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1);
    const centre = (f[j * W + i] + f[j * W + i + 1] + f[(j + 1) * W + i + 1] + f[(j + 1) * W + i]) / 4 < 0;
    switch (c) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: if (centre) { link(L(), T()); link(B(), R()); } else { link(T(), R()); link(L(), B()); } break;
      case 10: if (centre) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
      default: break;
    }
  }
  const used = new Set(); const loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = []; let prev = null; let cur = start;
    while (cur && !used.has(cur)) {
      used.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur); const next = nb.find((k) => k !== prev && !used.has(k)) || null;
      prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------------------------------------------------------------------------------------------- pattern strokes
/** The outline of an eight-point star {8/2} (two squares), tips at radius R. */
function starOutline(cx, cy, R, rot0 = 0) {
  const ri = R * Math.cos(Math.PI / 4) / Math.cos(Math.PI / 8);
  const pts = [];
  for (let k = 0; k < 16; k++) { const a = rot0 + (k * Math.PI) / 8; const r = k % 2 ? ri : R; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  pts.push(pts[0]);
  return pts;
}
/** Eight-point-star strapwork over a box: stars on a square grid (period P) whose tips touch, so the holes are stars and four-armed crosses. */
function starStrokes(b, cx, cy, P) {
  const out = [];
  const i0 = Math.floor((b.x0 - cx) / P) - 1; const i1 = Math.ceil((b.x1 - cx) / P) + 1;
  const j0 = Math.floor((b.y0 - cy) / P) - 1; const j1 = Math.ceil((b.y1 - cy) / P) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const sx = cx + i * P; const sy = cy + j * P;
    out.push(starOutline(sx, sy, P / 2));
  }
  return out;
}
/**
 * Eight-point star holes in rows inside a convex window (already inset by a web), webs ≥ web between them. Always an
 * even number per row, so the facet's centre line (where it is glued to the spine) stays solid.
 */
function starRow(win, web) {
  const b = bboxOf([win]); const rows = Math.max(1, Math.floor(b.h / 22)); const out = [];
  const rh = b.h / rows;
  for (let r = 0; r < rows; r++) {
    const cy = b.y0 + rh * (r + 0.5);
    for (let R = Math.min(rh / 2 - 0.2, 9); R >= 2.5; R *= 0.9) {
      const pitch = 2 * R + web; let done = false;
      for (let n = 2 * Math.floor((b.w / pitch + 1) / 2); n >= 2 && !done; n -= 2) {
        const stars = []; for (let k = 0; k < n; k++) stars.push(starOutline((k - (n - 1) / 2) * pitch + (b.x0 + b.x1) / 2, cy, R, 0).slice(0, -1));
        if (stars.every((st) => st.every(([x, y]) => pip(x, y, win)))) { out.push(...stars); done = true; }
      }
      if (done) break;
    }
  }
  return out;
}
/** The narrowest gap (mm) between any two of the polygons (vertex to edge), ignoring pairs whose boxes are > limit apart. */
function minGap(polys, limit = 6) {
  const bb = polys.map((q) => bboxOf([q])); let best = Infinity;
  const vd = (A, B) => { let m = Infinity; for (const [x, y] of A) for (let i = 0, k = B.length - 1; i < B.length; k = i++) { const d = segDist(x, y, B[k][0], B[k][1], B[i][0], B[i][1]); if (d < m) m = d; } return m; };
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = bb[i]; const c = bb[j];
    if (a.x0 - limit > c.x1 || c.x0 - limit > a.x1 || a.y0 - limit > c.y1 || c.y0 - limit > a.y1) continue;
    best = Math.min(best, vd(polys[i], polys[j]), vd(polys[j], polys[i]));
  }
  return best;
}
/** A spiral from radius r0 to r1 around c, starting at angle a0 (radians, y down), turning `turns` (negative = anticlockwise on screen). */
function spiral(c, r0, r1, a0, turns) {
  const n = Math.max(12, Math.ceil(Math.abs(turns) * 80));
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const a = a0 + turns * TAU * t; const r = r0 + (r1 - r0) * Math.pow(t, 0.85); out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}
const mirrorLine = (line, cx) => line.map(([x, y]) => [2 * cx - x, y]);
/** One heart of two curled scrolls (unit size: about 0.96 wide, from y −0.46 to the stem end at +0.95). */
const HEART_RIGHT = (() => {
  const a = cubic([0, 0.55], [0.1, 0.42], [0.48, 0.3], [0.48, -0.02], 16);
  const b = cubic([0.48, -0.02], [0.48, -0.33], [0.36, -0.47], [0.24, -0.47], 12).slice(1);
  const c = cubic([0.24, -0.47], [0.1, -0.47], [0.04, -0.37], [0.06, -0.27], 10).slice(1);
  const C = [0.2, -0.2]; const v = [0.06 - C[0], -0.27 - C[1]];
  const d = spiral(C, Math.hypot(v[0], v[1]), 0.06, Math.atan2(v[1], v[0]), -0.68).slice(1);
  return [...a, ...b, ...c, ...d];
})();
/** Rows of hearts (3 across, then 2 + two halves, staggered), joined by short stems, over a window. */
function heartStrokes(cx, top, bottom, hw, across = 3) {
  const s = (2 * hw) / across; const dy = 0.95 * s; const out = [];
  const rows = Math.ceil((bottom - top) / dy) + 2;
  for (let r = -1; r < rows; r++) {
    const y = top + 0.47 * s + r * dy; const odd = ((r % 2) + 2) % 2 === 1;
    for (let k = -3; k <= 3; k++) {
      const x = cx + (odd ? (k + 0.5) * s : k * s);
      if (Math.abs(x - cx) > hw + s) continue;
      const R = HEART_RIGHT.map(([u, v]) => [x + u * s, y + v * s]);
      out.push(R, mirrorLine(R, x), [[x, y + 0.5 * s], [x, y + 0.97 * s]]);
    }
  }
  return out;
}
// ---------------------------------------------------------------------------------------------- parts
function part(id, label, outline, extra = {}) {
  return { id, label, outline: dedupe(outline), holes: [], slots: [], engrave: [], score: [], notes: [], qty: 1, ...extra };
}
/**
 * A wall: outer width w, body height h (y 0 … h), finger joints t deep on both vertical edges (n segments; full
 * segments where (k even) === startFull), tabs t long on the top and bottom edges centred at tabXs.
 */
function wallOutline({ w, h, t, kerf, n, startFull, tabXs, tabW, topTabs = true, bottomTabs = true, feet = null }) {
  const full = (k) => (k % 2 === 0) === startFull;
  const bounds = (k) => { // y of boundary k (between segment k-1 and k), moved into the notch by kerf/2
    const y = (k * h) / n; if (k <= 0 || k >= n) return y;
    return full(k - 1) && !full(k) ? y + kerf / 2 : !full(k - 1) && full(k) ? y - kerf / 2 : y;
  };
  const xR = (k) => (full(k) ? w : w - t); const xL = (k) => (full(k) ? 0 : t);
  const pts = [[xL(0), 0]];
  if (topTabs) for (const c of tabXs) pts.push([c - tabW / 2, 0], [c - tabW / 2, -t], [c + tabW / 2, -t], [c + tabW / 2, 0]);
  pts.push([xR(0), 0]);
  for (let k = 1; k < n; k++) { const y = bounds(k); pts.push([xR(k - 1), y], [xR(k), y]); }
  pts.push([xR(n - 1), h]);
  if (feet) {
    const { footL, footH } = feet;
    pts.push([w - footL, h], [w - footL - 1.5, h - footH], [footL + 1.5, h - footH], [footL, h]);
  } else if (bottomTabs) for (const c of [...tabXs].reverse()) pts.push([c + tabW / 2, h], [c + tabW / 2, h + t], [c - tabW / 2, h + t], [c - tabW / 2, h]);
  pts.push([xL(n - 1), h]);
  for (let k = n - 1; k >= 1; k--) { const y = bounds(k); pts.push([xL(k), y], [xL(k - 1), y]); }
  return dedupe(pts);
}
/** Slots in a plate (centre cx, cy) for four walls of a W × W box: tabs at ±W/4 along each wall, wall thickness t. */
function boxSlots(cx, cy, W, t, slot, tabW) {
  const len = tabW + (slot - t); const d = W / 2 - t / 2; const out = [];
  for (const o of [-W / 4, W / 4]) {
    out.push(rect(cx + o - len / 2, cy - d - slot / 2, len, slot), rect(cx + o - len / 2, cy + d - slot / 2, len, slot));
    out.push(rect(cx - d - slot / 2, cy + o - len / 2, slot, len), rect(cx + d - slot / 2, cy + o - len / 2, slot, len));
  }
  return out;
}

const ARCH_K = 1.25; // two-centred pointed arch: radius = 1.25 × half-width (measured on the mockup: rise ≈ 1.2 × half-width)
/** Pointed arch (y down): spring line ys, half-width A around cx; returns the curve left spring → apex → right spring. */
function archCurve(cx, ys, A) { return archCurveOffset(cx, ys, A, 0); }

/** Crescent: disc (c, R) minus disc (c + d, r); outline. */
function crescent(cx, cy, R, dx, dy, r) {
  const ox = cx + dx; const oy = cy + dy; const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d); const h = Math.sqrt(R * R - a * a);
  const ux = dx / d; const uy = dy / d;
  const mx = cx + a * ux; const my = cy + a * uy;
  const I1 = [mx - h * uy, my + h * ux]; const I2 = [mx + h * uy, my - h * ux];
  const angO = (p) => Math.atan2(p[1] - cy, p[0] - cx); const angI = (p) => Math.atan2(p[1] - oy, p[0] - ox);
  // outer arc from I1 to I2 the long way (away from the inner disc)
  let a1 = angO(I1); let a2 = angO(I2); const away = Math.atan2(-dy, -dx);
  let sweep = a2 - a1; while (sweep < 0) sweep += TAU;
  const midA = a1 + sweep / 2; const contains = Math.cos(midA - away) > 0;
  if (!contains) sweep -= TAU;
  const outer = arc(cx, cy, R, a1, a1 + sweep, 0.25);
  // inner arc back from I2 to I1, the part inside the outer disc
  let b1 = angI(I2); const b2 = angI(I1); let sw = b2 - b1; while (sw < 0) sw += TAU;
  const mb = b1 + sw / 2; if (Math.hypot(ox + r * Math.cos(mb) - cx, oy + r * Math.sin(mb) - cy) > R) sw -= TAU;
  const inner = arc(ox, oy, r, b1, b1 + sw, 0.25);
  return dedupe([...outer, ...inner.slice(1, -1)]);
}
function star5(cx, cy, R, r, a0 = -Math.PI / 2) {
  const pts = []; for (let k = 0; k < 10; k++) { const a = a0 + (k * Math.PI) / 5; const rr = k % 2 ? r : R; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return pts;
}
/** A leaf from base to tip, width w (two quadratic sides). */
function leaf(b, t, w) {
  const mx = (b[0] + t[0]) / 2; const my = (b[1] + t[1]) / 2; const dx = t[0] - b[0]; const dy = t[1] - b[1]; const l = Math.hypot(dx, dy);
  const nx = -dy / l; const ny = dx / l; const c1 = [mx + nx * w, my + ny * w]; const c2 = [mx - nx * w, my - ny * w];
  return dedupe([...quad(b, c1, t, 14), ...quad(t, c2, b, 14).slice(1)]);
}
/** The small floret above/below the arch nameplate (about 23 × 12 mm), pointing up (flip = pointing down). */
function floret(cx, cy, flip = false) {
  const s = flip ? -1 : 1; const P = (x, y) => [cx + x, cy + s * y];
  return [
    leaf(P(0, -1.7), P(0, -8), 2.6), // top petal
    leaf(P(1.7, -0.9), P(9, -4.6), 2.1), leaf(P(-1.7, -0.9), P(-9, -4.6), 2.1), // upper side petals
    leaf(P(1.8, 0.5), P(11.5, 0.6), 1.6), leaf(P(-1.8, 0.5), P(-11.5, 0.6), 1.6), // side petals
    leaf(P(0, 1.8), P(0, 4.6), 1.1), // drop
    circle(cx, cy, 1.1, 0.2), // centre
  ].map((p) => (flip ? p.slice().reverse() : p));
}

// ---------------------------------------------------------------------------------------------- stroke font (score)
const SEG = { a: [[0, 0], [1, 0]], b: [[1, 0], [1, 0.5]], c: [[1, 0.5], [1, 1]], d: [[0, 1], [1, 1]], e: [[0, 0.5], [0, 1]], f: [[0, 0], [0, 0.5]], g: [[0, 0.5], [1, 0.5]] };
const DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function strokeText(str, x, y, h) {
  const w = h * 0.55; const out = []; let cx = x;
  for (const ch of str) {
    if (ch === '.') { out.push([[cx, y + h], [cx + h * 0.12, y + h]]); cx += h * 0.35; continue; }
    const segs = DIGITS[ch]; if (!segs) { cx += w * 0.8; continue; }
    for (const s of segs) out.push(SEG[s].map(([u, v]) => [cx + u * w, y + v * h]));
    cx += w + h * 0.3;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- one lantern
function build(model, p) {
  const t = p.thickness; const W = model.W; const Hb = model.bodyH;
  const webDrawn = p.web + p.kerf; // webs grow back to p.web after the laser takes kerf/2 from each side
  const parts = [];
  const lat = (o) => latticeHoles({ res: p.res, strokeW: webDrawn, ...o });
  const tabW = 16; const tabXs = [W / 4, (3 * W) / 4];
  const nF = Math.max(5, 2 * Math.round(Hb / 22 / 2) + 1);

  // --- stack heights (z up from the floor)
  const B = model.base; const steps = B.steps.length;
  const plateW = W + 2 * B.plateOv; const skirtW = plateW - 2 * B.skirtInset;
  const zPlateBottom = B.skirtH; const zBaseTop = B.skirtH + t * (1 + steps);
  const capT = t * model.cap.length;
  const R = model.roof; const zn = R.z[R.z.length - 1];
  const ring = model.ring;
  let stem = model.H - (zBaseTop + Hb + capT + zn + t + ring.od);
  if (stem < 1) { // a thick sheet: the ring gets a little smaller so the total stays 300
    ring.od = Math.round((ring.od + stem - 1) * 10) / 10; ring.id = Math.min(ring.id, ring.od - 9); stem = 1;
    if (ring.od < 18) throw new Error(`${model.id}: no room for the ring with thickness ${t}`);
  }
  const Z = { zPlateBottom, zBaseTop, zBodyTop: zBaseTop + Hb, zCapTop: zBaseTop + Hb + capT, zRoofTop: zBaseTop + Hb + capT + zn, stem };

  // --- walls
  const plaque = makePlaque(model);
  const wallFrame = model.walls.frame;
  const walls = [
    { id: 'front', label: 'Wall FRONT', startFull: true },
    { id: 'back', label: 'Wall BACK', startFull: true },
    { id: 'left', label: 'Wall LEFT', startFull: false },
    { id: 'right', label: 'Wall RIGHT', startFull: false },
  ];
  for (const wl of walls) {
    const outline = wallOutline({ w: W, h: Hb, t, kerf: p.kerf, n: nF, startFull: wl.startFull, tabXs, tabW });
    const pt = part(`${model.id}-wall-${wl.id}`, wl.label, outline);
    if (model.walls.style === 'stars') {
      const win = rect(wallFrame, wallFrame, W - 2 * wallFrame, Hb - 2 * wallFrame);
      const solids = [];
      if (wl.id === 'front') {
        const pl = tr(plaque.outline, W / 2, model.plaque.top);
        solids.push(scalePts(pl, (model.plaque.w - 4) / model.plaque.w, (model.plaque.h - 4) / model.plaque.h, W / 2, model.plaque.top + model.plaque.h / 2));
        pt.score.push({ pts: scalePts(pl, (model.plaque.w - 3) / model.plaque.w, (model.plaque.h - 3) / model.plaque.h, W / 2, model.plaque.top + model.plaque.h / 2), closed: true });
      }
      const P = model.walls.period;
      pt.holes = lat({ win, strokes: starStrokes(bboxOf([win]), W / 2, Hb / 2, P), solids });
    } else {
      const front = wl.id === 'front';
      const A = W / 2 - t - 1; const fw = model.walls.archFrame;
      let win; let strokes;
      if (front) {
        const ys = 1 + archRise(A); // outer apex 1 mm below the top
        const winCurve = archCurveOffset(W / 2, ys, A, fw - 1.5);
        win = [...winCurve, [W / 2 + (A - fw + 1.5), Hb - wallFrame], [W / 2 - (A - fw + 1.5), Hb - wallFrame]];
        const top = bboxOf([winCurve]).y0;
        strokes = heartStrokes(W / 2, top + 2, Hb - wallFrame, A - fw + 1.5, 3);
        const np = tr(plaque.outline, W / 2, model.plaque.centerY - model.plaque.h / 2);
        const solids = [scalePts(np, (model.plaque.w - 4) / model.plaque.w, (model.plaque.h - 4) / model.plaque.h, W / 2, model.plaque.centerY)];
        pt.holes = lat({ win, strokes, solids });
        pt.score.push({ pts: scalePts(np, (model.plaque.w - 3) / model.plaque.w, (model.plaque.h - 3) / model.plaque.h, W / 2, model.plaque.centerY), closed: true });
        // where the arch overlay goes (1 mm inside its outer edge; hidden once glued)
        const ov = archCurveOffset(W / 2, ys, A, 1);
        pt.score.push({ pts: [[ov[0][0], Hb - 1], ...ov, [ov[ov.length - 1][0], Hb - 1]], closed: false });
        model._arch = { ys, A, fw };
      } else {
        const a = W / 2 - model.walls.sideFrame; const apex = 12; const ys = apex + archRise(a);
        const c = archCurve(W / 2, ys, a);
        win = [...c, [W / 2 + a, Hb - 12], [W / 2 - a, Hb - 12]];
        strokes = heartStrokes(W / 2, apex + 2, Hb - 12, a, 3);
        pt.holes = lat({ win, strokes });
      }
    }
    parts.push(pt);
  }

  // --- plaque / nameplate
  {
    const pl = part(`${model.id}-plaque`, model.plaque.kind === 'scallop' ? 'Family plaque (front, glued on)' : 'Nameplate (in the arch, glued on)', plaque.outline);
    pl.engrave = plaque.engrave;
    pl.notes.push({ dashed: rect(plaque.nameArea.x, plaque.nameArea.y, plaque.nameArea.w, plaque.nameArea.h), text: `name area ${plaque.nameArea.w} × ${plaque.nameArea.h}` });
    parts.push(pl);
  }
  // --- arch overlay (Arabesque)
  if (model._arch) {
    const { ys, A, fw } = model._arch; const cx = 0;
    const outer = archCurve(cx, ys, A); const inner = archCurveOffset(cx, ys, A, fw);
    const bot = Hb;
    const outline = [[-A, bot], ...outer, [A, bot], [A - fw, bot], ...inner.slice().reverse(), [-(A - fw), bot]];
    parts.push(part(`${model.id}-arch`, 'Arch overlay (front, light wood, glued on)', outline));
  }

  // --- cap plates
  const r0 = R.r[0];
  const alphas = []; for (let i = 0; i + 1 < R.r.length; i++) alphas.push(Math.atan2(R.z[i + 1] - R.z[i], R.r[i] - R.r[i + 1]));
  const spineOff = (i) => { // inner surface of the facets at the mid-plane, level i
    const as = [alphas[i - 1], alphas[i]].filter((a) => a !== undefined);
    return R.r[i] - Math.max(...as.map((a) => t / Math.sin(a))) - 0.3;
  };
  const hw0 = spineOff(0);
  const spineTabW = 10; const spineTabX = hw0 * 0.55;
  model.cap.forEach((layer, li) => {
    const S = W + 2 * layer.ov; const c = S / 2;
    const pt = part(`${model.id}-cap-${li + 1}`, model.cap.length > 1 ? `Cap layer ${li + 1} (${li ? 'top' : 'bottom'})` : 'Cap plate', roundRect(0, 0, S, S, 1.5));
    if (layer.walls) pt.slots.push(...boxSlots(c, c, W, t, p.slot, tabW));
    if (layer.spines) {
      const len = spineTabW + (p.slot - t);
      for (const s of [-1, 1]) {
        pt.slots.push(rect(c + s * spineTabX - len / 2, c - p.slot / 2, len, p.slot)); // spine A (left–right)
        pt.slots.push(rect(c - p.slot / 2, c + s * spineTabX - len / 2, p.slot, len)); // spine B (front–back)
      }
      const bar = 6; const rw = r0 - t - 4;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx > 0 ? c + bar : c - rw; const y = sy > 0 ? c + bar : c - rw;
        pt.holes.push(roundRect(x, y, rw - bar, rw - bar, 3));
      }
    } else {
      const o = W / 2 - t - 5; pt.holes.push(roundRect(c - o, c - o, 2 * o, 2 * o, 4));
    }
    parts.push(pt);
  });

  // --- roof facets (4 per tier), cut to the inner hip so the corners meet inside; tier ends shortened by t·tan(β/2)
  const facets = [];
  for (let i = 0; i < alphas.length; i++) {
    const a = alphas[i]; const ri = R.r[i]; const rj = R.r[i + 1]; const L = Math.hypot(R.z[i + 1] - R.z[i], ri - rj);
    const db = i > 0 ? t * Math.tan((alphas[i - 1] - a) / 2) : 0;
    const dt = i + 1 < alphas.length ? t * Math.tan((a - alphas[i + 1]) / 2) : 0;
    const hwAt = (s) => ri - (ri - rj) * (s / L) - t * Math.sin(a);
    const sB = db; const sT = L - dt;
    const trap = [[-hwAt(sT), L - sT], [hwAt(sT), L - sT], [hwAt(sB), L - sB], [-hwAt(sB), L - sB]];
    const margin = 3.2;
    const win = insetConvex(trap, margin);
    const ok = area(win) * Math.sign(area(trap)) > 40;
    const wb = bboxOf([win]);
    const holes = ok ? starRow(win, p.web + p.kerf) : [];
    facets.push({ i, a, L, sB, sT, trap, holes, hwAt });
    for (let k = 0; k < 4; k++) {
      const pt = part(`${model.id}-roof-${i + 1}-${k + 1}`, `Roof tier ${i + 1} (${k + 1}/4)`, trap);
      pt.holes = holes.map((h) => h.slice());
      parts.push(pt);
    }
  }

  // --- spines (A carries the ring, left–right; B front–back), half-lapped at the centre
  const prof = R.r.map((_, i) => [spineOff(i), -R.z[i]]); // [half-width, y]
  const halfY = -zn / 2;
  // the ring stem passes the collar; on a thicker sheet the dome's top gets narrower inside, so the stem follows
  const sw = Math.min(ring.stemW, Math.floor((2 * prof[prof.length - 1][0] - 1) * 10) / 10);
  if (sw < 6) throw new Error(`${model.id}: roof top too narrow for the ring stem at thickness ${t}`);
  const spineBottom = (withNotch) => {
    const pts = [[hw0, 0]];
    for (const s of [1, -1]) { // right to left
      const x = s * spineTabX;
      pts.push([x + spineTabW / 2, 0], [x + spineTabW / 2, t], [x - spineTabW / 2, t], [x - spineTabW / 2, 0]);
      if (s === 1 && withNotch) pts.push([p.slot / 2, 0], [p.slot / 2, halfY], [-p.slot / 2, halfY], [-p.slot / 2, 0]);
    }
    pts.push([-hw0, 0]);
    return pts;
  };
  const leftSide = prof.map(([x, y]) => [-x, y]); // bottom → top
  const rightSide = prof.map(([x, y]) => [x, y]).reverse(); // top → bottom
  {
    // A: left profile up, stem, ring, stem, right profile down, bottom with tabs and the notch from below
    const yTopRoof = -zn; const yCollarTop = yTopRoof - t; const ringCy = yCollarTop - stem - ring.od / 2; const ro = ring.od / 2;
    const ay = Math.asin(Math.min(1, sw / 2 / ro));
    const yJoin = ringCy + ro * Math.cos(ay);
    const ringArc = arc(0, ringCy, ro, Math.PI / 2 + ay, Math.PI / 2 - ay + TAU, 0.3);
    const outline = [...leftSide, [-sw / 2, yTopRoof], [-sw / 2, yJoin], ...ringArc, [sw / 2, yJoin], [sw / 2, yTopRoof], ...rightSide, ...spineBottom(true)];
    const pt = part(`${model.id}-spine-a`, 'Spine A + hanging ring (left–right)', outline);
    pt.holes.push(circle(0, ringCy, ring.id / 2));
    const win = [...leftSide, ...rightSide].map(([x, y]) => [x, y]);
    const winIn = insetConvex(win.filter((q, k) => k === 0 || q[0] !== win[k - 1][0] || q[1] !== win[k - 1][1]), 5.5);
    pt.holes.push(...lat({ win: winIn, solids: [rect(-(p.slot / 2 + 5), -zn - 5, p.slot + 10, zn + 10)] }));
    parts.push(pt);
    // B: notch from the top
    const outlineB = [...leftSide, [-p.slot / 2, yTopRoof], [-p.slot / 2, halfY], [p.slot / 2, halfY], [p.slot / 2, yTopRoof], ...rightSide, ...spineBottom(false)];
    const pb = part(`${model.id}-spine-b`, 'Spine B (front–back)', outlineB);
    pb.holes.push(...lat({ win: winIn, solids: [rect(-(p.slot / 2 + 5), -zn - 5, p.slot + 10, zn + 10)] }));
    parts.push(pb);
  }
  // --- collar on top of the dome, the ring stem through it
  {
    const cw = R.r[R.r.length - 1] + 1.5; const len = sw + (p.slot - t);
    const pt = part(`${model.id}-collar`, 'Collar (top of the dome)', roundRect(0, 0, 2 * cw, 2 * cw, 1.5));
    pt.slots.push(rect(cw - len / 2, cw - p.slot / 2, len, p.slot));
    parts.push(pt);
  }

  // --- base: step plates (Arabesque), top plate, skirt boards with feet, LED pocket and bayonet hatch
  const led = { hole: p.ledDia + p.ledClear };
  const bay = { d0: p.ledDia + 10 };
  bay.rl = bay.d0 / 2 + 4; // lug radius
  B.steps.forEach((st, si) => {
    const S = W + 2 * st.ov; const c = S / 2;
    const pt = part(`${model.id}-step-${si + 1}`, `Base step ${si + 1} (${si === 0 ? 'top, walls slot in' : 'under step 1'})`, roundRect(0, 0, S, S, 1.5));
    if (si === 0) pt.slots.push(...boxSlots(c, c, W, t, p.slot, tabW));
    pt.holes.push(circle(c, c, led.hole / 2));
    parts.push(pt);
  });
  {
    const c = plateW / 2;
    const pt = part(`${model.id}-base-plate`, 'Base top plate', roundRect(0, 0, plateW, plateW, 2));
    if (!steps) pt.slots.push(...boxSlots(c, c, W, t, p.slot, tabW));
    pt.slots.push(...boxSlots(c, c, skirtW, t, p.slot, 14));
    pt.holes.push(circle(c, c, led.hole / 2));
    parts.push(pt);
  }
  for (let k = 0; k < B.pocketRings; k++) {
    const od = led.hole + 12;
    const pt = part(`${model.id}-pocket-${k + 1}`, 'LED pocket ring (on the base plate)', circle(od / 2, od / 2, od / 2));
    pt.holes.push(circle(od / 2, od / 2, led.hole / 2));
    parts.push(pt);
  }
  const skH = B.skirtH; const nS = 3;
  for (const [k, sf] of [['front', true], ['back', true], ['left', false], ['right', false]]) {
    const outline = wallOutline({ w: skirtW, h: skH, t, kerf: p.kerf, n: nS, startFull: sf, tabXs: [skirtW / 4, (3 * skirtW) / 4], tabW: 14, feet: { footL: B.footL, footH: B.footH } });
    parts.push(part(`${model.id}-skirt-${k}`, `Base skirt ${k.toUpperCase()} (feet at the ends)`, outline));
  }
  // bayonet: lug-space layer and lock layer glued under the base plate; the hatch (3 discs) twists in from below
  {
    const sq = 2 * bay.rl + 16; const c = sq / 2; const lugA = 30 * D2R; const notchA = 34 * D2R; const turn = 60 * D2R;
    const notchStarts = [0, 1, 2].map((k) => -Math.PI / 2 + (k * TAU) / 3 - notchA / 2);
    const withLobes = (r, rl, spans) => { // circle r with outward lobes to rl over the angular spans
      const pts = []; const step = 0.25;
      const sorted = spans.map(([a, b]) => [((a % TAU) + TAU) % TAU, ((a % TAU) + TAU) % TAU + (b - a)]).sort((x, y) => x[0] - y[0]);
      let a = sorted[sorted.length - 1][1] - TAU;
      for (const [s, e] of sorted) {
        pts.push(...arc(c, c, r, a, s, step));
        pts.push(...arc(c, c, rl, s, e, step));
        a = e;
      }
      return dedupe(pts);
    };
    const lugLayer = part(`${model.id}-bay-space`, 'Bayonet lug-space layer (under the base plate, laser side UP)', roundRect(0, 0, sq, sq, 3));
    lugLayer.holes.push(withLobes(bay.d0 / 2, bay.rl + 0.5, notchStarts.map((s) => [s - turn, s + notchA])));
    const lock = part(`${model.id}-bay-lock`, 'Bayonet lock layer (under the lug-space layer)', roundRect(0, 0, sq, sq, 3));
    lock.holes.push(withLobes(bay.d0 / 2, bay.rl + 0.3, notchStarts.map((s) => [s, s + notchA])));
    const lugDisc = part(`${model.id}-hatch-lugs`, 'Hatch 1: lug disc (top, the LED sits on it)', withLobes(bay.d0 / 2 - 0.2, bay.rl - 0.3, notchStarts.map((s) => [s + (notchA - lugA) / 2, s + (notchA + lugA) / 2])));
    const core = part(`${model.id}-hatch-core`, 'Hatch 2: core disc', circle(c, c, bay.d0 / 2 - 0.2));
    const gr = bay.d0 / 2 + 8; const grip = [];
    for (let k = 0; k < 360; k += 2) { const a = k * D2R; const rr = gr - (Math.cos(a * 16) > 0.6 ? 1.4 * (Math.cos(a * 16) - 0.6) / 0.4 : 0); grip.push([gr + rr * Math.cos(a), gr + rr * Math.sin(a)]); }
    const gp = part(`${model.id}-hatch-grip`, 'Hatch 3: grip disc (engraving faces DOWN; arrow = lock)', grip);
    // engraved twist arrow (clockwise seen from below = lock) and a padlock
    const ar = []; const ra = gr * 0.62; const a0 = -150 * D2R; const a1 = -40 * D2R;
    const outer = arc(gr, gr, ra + 1.4, a0, a1, 0.3); const innerA = arc(gr, gr, ra - 1.4, a1, a0, 0.3);
    const tip = [gr + ra * Math.cos(a1 + 0.32), gr + ra * Math.sin(a1 + 0.32)];
    const h1 = [gr + (ra + 3.6) * Math.cos(a1), gr + (ra + 3.6) * Math.sin(a1)]; const h2 = [gr + (ra - 3.6) * Math.cos(a1), gr + (ra - 3.6) * Math.sin(a1)];
    ar.push(dedupe([...outer, h1, tip, h2, ...innerA]));
    const lx = gr - 4; const ly = gr + 4;
    ar.push(rect(lx, ly + 4, 8, 6.5));
    const sh = [...arc(lx + 4, ly + 3.6, 3.4, Math.PI, TAU, 0.25), ...arc(lx + 4, ly + 3.6, 2.2, TAU, Math.PI, 0.25)];
    ar.push(dedupe(sh));
    gp.engrave = ar;
    parts.push(lugLayer, lock, lugDisc, core, gp);
    Object.assign(bay, { sq, notchA, lugA, turn });
  }

  const dims = {
    W: Math.max(plateW, W + 2 * Math.max(...model.cap.map((l) => l.ov))), D: 0, H: model.H,
    body: { W, D: W, H: Hb }, baseH: zBaseTop, capT, roofH: zn, collarT: t, ringOD: ring.od, stem: Math.round(stem * 10) / 10,
    plate: plateW, skirt: skirtW,
  };
  dims.D = dims.W;
  return { model, parts, Z, dims, plaque, facets, led, bay, p, stemW: sw };
}
const archRise = (A) => { const c = archCurve(0, 0, A); return -bboxOf([c]).y0; };
function archCurveOffset(cx, ys, A, inset) {
  // the curve `inset` mm inside the arch of half-width A (concentric arcs)
  const R = ARCH_K * A; const Cx = cx - A + R; const r = R - inset;
  const aApex = TAU - Math.acos((cx - Cx) / r);
  const left = arc(Cx, ys, r, Math.PI, aApex, 0.3);
  const right = left.slice(0, -1).reverse().map(([x, y]) => [2 * cx - x, y]);
  return [...left, ...right];
}

/** The plaque outline (x centred, y from 0 at the top), its engraving and the blank name area. */
function makePlaque(model) {
  const pq = model.plaque;
  if (pq.kind === 'scallop') {
    const right = [[0, 0], [17, 12], [34, 20], [45, 38], [48, 64], [45, 92], [36, 110], [20, 122], [0, 133]];
    let outline = lobedOutline(mirrorHalf(right), 0.16);
    outline = fitTo(outline, pq.w, pq.h);
    const k = pq.h / 133;
    const engrave = [crescent(-2 * k, 40 * k, 15.5, 6.5, -5.5, 12.8), star5(7.5 * k, 34 * k, 5.2, 2.2)];
    const eb = bboxOf(engrave);
    const ya = Math.ceil(eb.y1 + 6); const margin = 5;
    let best = null;
    for (let yb = ya + 20; yb < pq.h - 6; yb += 0.5) {
      let hw = Infinity; for (let y = ya; y <= yb; y += 0.5) hw = Math.min(hw, halfWidthAt(outline, y));
      const w = Math.floor(2 * (hw - margin)); const h = Math.floor(yb - ya);
      if (!best || w * h > best.w * best.h) best = { x: -w / 2, y: ya, w, h };
    }
    return { outline, engrave, nameArea: best };
  }
  // cartouche as in the mockup: ogee point top and bottom, a lobe on each shoulder, rounded corners, bulging sides
  const arcThrough = (a, b, k) => { // arc from a to b bulging to the right of a→b (outward for this clockwise half)
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const c = Math.hypot(dx, dy); const nout = [-dy / c, dx / c];
    const sag = k * c; const R = (c * c / 4 + sag * sag) / (2 * sag); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const C = [m[0] - nout[0] * (R - sag), m[1] - nout[1] * (R - sag)];
    const a0 = Math.atan2(a[1] - C[1], a[0] - C[0]); let a1 = Math.atan2(b[1] - C[1], b[0] - C[0]);
    let d = a1 - a0; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    return arc(C[0], C[1], R, a0, a0 + d, 0.3);
  };
  const half = [
    ...cubic([0, 0], [4.5, 0.4], [9, 6.2], [15, 6.6], 16),
    ...arcThrough([15, 6.6], [32, 8.2], 0.16).slice(1),
    ...arcThrough([32, 8.2], [40.5, 19], 0.3).slice(1),
    ...arcThrough([40.5, 19], [40.5, 51], 0.07).slice(1),
    ...arcThrough([40.5, 51], [32, 61.8], 0.3).slice(1),
    ...arcThrough([32, 61.8], [15, 63.4], 0.16).slice(1),
    ...cubic([15, 63.4], [9, 63.8], [4.5, 69.6], [0, 70], 16).slice(1),
  ];
  const outline = fitTo(mirrorHalf(dedupe(half)), pq.w, pq.h);
  const engrave = [...floret(0, 17.5 * pq.h / 70), ...floret(0, 52.5 * pq.h / 70, true)];
  const top = floret(0, 17.5 * pq.h / 70); const bot = floret(0, 52.5 * pq.h / 70, true);
  const ya = Math.ceil(bboxOf(top).y1 + 2.5); const yb = Math.floor(bboxOf(bot).y0 - 2.5);
  let hw = Infinity; for (let y = ya; y <= yb; y += 0.5) hw = Math.min(hw, halfWidthAt(outline, y));
  const w = Math.floor(2 * (hw - 6));
  return { outline, engrave, nameArea: { x: -w / 2, y: ya, w, h: yb - ya } };
}

// ---------------------------------------------------------------------------------------------- layout
function layout(parts, sheetW, gap = 7, labelH = 6, top = 0) {
  const items = parts.map((pt) => ({ pt, b: bboxOf([pt.outline]) })).sort((a, b) => b.b.h - a.b.h || b.b.w - a.b.w);
  let x = gap; let y = top + gap; let rowH = 0;
  for (const it of items) {
    if (x + it.b.w + gap > sheetW && x > gap) { x = gap; y += rowH + gap; rowH = 0; }
    const dx = x - it.b.x0; const dy = y + labelH - it.b.y0;
    const T = (poly) => tr(poly, dx, dy);
    const pt = it.pt;
    pt.outline = T(pt.outline); pt.holes = pt.holes.map(T); pt.slots = pt.slots.map(T); pt.engrave = pt.engrave.map(T);
    pt.score = pt.score.map((s) => ({ ...s, pts: T(s.pts) })); pt.notes = pt.notes.map((n) => ({ ...n, dashed: T(n.dashed) }));
    pt.off = [dx, dy]; pt.bbox = bboxOf([pt.outline]); pt.labelAt = [x, y + labelH - 1.6];
    x += Math.max(it.b.w, pt.label.length * 1.95 + 22) + gap; rowH = Math.max(rowH, it.b.h + labelH);
  }
  return { w: sheetW, h: y + rowH + gap };
}
function overlaps(parts) {
  const bad = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i].bbox; const b = parts[j].bbox;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad.push([parts[i].id, parts[j].id]);
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------- writers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dPoly = (p, close = true) => `M${p.map(([x, y]) => `${fx(x)} ${fx(y)}`).join('L')}${close ? 'Z' : ''}`;
const WARN_EN = 'PROTOTYPE – not for production until the workshop confirms material thickness, joint fit and LED dimensions';
const WARN_AR = 'نموذج أولي – ليس للإنتاج قبل تأكيد الورشة لسُمك الخامة وتركيب الوصلات ومقاس الـ LED';

function titleLines(title, p, extra) {
  return [
    { t: title, size: 7, bold: true },
    { t: WARN_EN, size: 4.2, bold: true, fill: '#c00000' },
    { t: WARN_AR, size: 4.6, bold: true, fill: '#c00000', rtl: true },
    ...extra.map((t) => ({ t, size: 3.6 })),
    { t: `Parameters: thickness ${p.thickness} mm · slot ${p.slot} mm · kerf ${p.kerf} mm · min web ${p.web} mm · LED ${p.ledDia} × ${p.ledHeight} mm (pocket Ø${p.ledDia + p.ledClear})`, size: 3.6 },
    { t: 'Scale 1:1, units mm. Layers: CUT red #ff0000 0.1 mm · ENGRAVE black fill · SCORE blue · NOTES grey (do not output). Regenerate: node scripts/lantern-drawings.js --thickness 3 --slot 3.1 --kerf 0.15', size: 3.2 },
  ];
}

function svgDoc({ w, h, lines, parts, extraNotes = '' }) {
  const title = []; let ty = 10;
  for (const l of lines) {
    title.push(`<text x="${l.rtl ? w - 10 : 8}" y="${fx(ty)}" font-size="${l.size}" ${l.bold ? 'font-weight="bold"' : ''} fill="${l.fill || '#555555'}"${l.rtl ? ' direction="rtl" text-anchor="start" unicode-bidi="embed"' : ''}>${esc(l.t)}</text>`);
    ty += l.size * 1.45;
  }
  const cut = []; const eng = []; const score = []; const notes = [];
  for (const pt of parts) {
    const b = pt.bbox;
    cut.push(`<g class="part" id="part-${pt.id}" data-bbox="${fx(b.x0)} ${fx(b.y0)} ${fx(b.w)} ${fx(b.h)}"><path d="${dPoly(pt.outline)}"/>`
      + pt.holes.map((hh) => `<path d="${dPoly(hh)}"/>`).join('')
      + pt.slots.map((s) => `<path class="slot" d="${dPoly(s)}"/>`).join('') + '</g>');
    if (pt.engrave.length) eng.push(`<path id="eng-${pt.id}" d="${pt.engrave.map((e) => dPoly(e)).join('')}"/>`);
    for (const s of pt.score) score.push(`<path d="${dPoly(s.pts, s.closed)}"/>`);
    notes.push(`<text x="${fx(pt.labelAt[0])}" y="${fx(pt.labelAt[1])}" font-size="3.4">${esc(pt.label)} · ${fx(Math.round(b.w * 10) / 10)} × ${fx(Math.round(b.h * 10) / 10)}</text>`);
    for (const n of pt.notes) {
      notes.push(`<path d="${dPoly(n.dashed)}" fill="none" stroke="#9a9a9a" stroke-width="0.25" stroke-dasharray="1.5 1"/>`);
      const nb = bboxOf([n.dashed]);
      notes.push(`<text x="${fx(nb.x0 + nb.w / 2)}" y="${fx(nb.y0 + nb.h / 2)}" font-size="3" text-anchor="middle">${esc(n.text)}</text>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fx(w)}mm" height="${fx(h)}mm" viewBox="0 0 ${fx(w)} ${fx(h)}">
<title>${esc(lines[0].t)} – PROTOTYPE</title>
<rect x="0" y="0" width="${fx(w)}" height="${fx(h)}" fill="#ffffff"/>
<g id="NOTES" fill="#666666" font-family="Arial, 'Noto Sans Arabic', sans-serif">
<rect x="3" y="3" width="${fx(w - 6)}" height="${fx(ty - 4)}" fill="#fff6f6" stroke="#c00000" stroke-width="0.4"/>
${title.join('\n')}
${notes.join('\n')}
${extraNotes}
</g>
<g id="ENGRAVE" fill="#000000" stroke="none" fill-rule="nonzero">
${eng.join('\n')}
</g>
<g id="SCORE" fill="none" stroke="#0000ff" stroke-width="0.1">
${score.join('\n')}
</g>
<g id="CUT" fill="none" stroke="#ff0000" stroke-width="0.1">
${cut.join('\n')}
</g>
</svg>
`;
}
function titleHeight(lines) { return 10 + lines.reduce((s, l) => s + l.size * 1.45, 0) + 2; }

// DXF R12 (AC1009) ASCII, mm, y up
function dxfDoc({ w, h, parts, lines, extra = [] }) {
  const out = [];
  const g = (code, v) => out.push(String(code), String(v));
  const Y = (y) => h - y;
  const enc = (s) => Array.from(String(s)).map((ch) => (ch.charCodeAt(0) < 128 ? ch : `\\U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)).join('');
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$MEASUREMENT'); g(70, 1);
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0);
  g(9, '$EXTMAX'); g(10, fx(w)); g(20, fx(h)); g(30, 0);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, 4);
  for (const [name, col] of [['CUT', 1], ['ENGRAVE', 7], ['SCORE', 5], ['NOTES', 8]]) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, col); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const poly = (layer, pts, closed = true) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, layer); g(10, fx(x)); g(20, fx(Y(y))); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const text = (layer, x, y, size, s) => { g(0, 'TEXT'); g(8, layer); g(10, fx(x)); g(20, fx(Y(y))); g(30, 0); g(40, fx(size)); g(1, enc(s)); };
  let ty = 10;
  for (const l of lines) { text('NOTES', 8, ty, l.size * 0.8, l.t); ty += l.size * 1.45; }
  for (const pt of parts) {
    poly('CUT', pt.outline); for (const hh of pt.holes) poly('CUT', hh); for (const s of pt.slots) poly('CUT', s);
    for (const e of pt.engrave) poly('ENGRAVE', e);
    for (const s of pt.score) poly('SCORE', s.pts, s.closed);
    text('NOTES', pt.labelAt[0], pt.labelAt[1], 3, `${pt.label}`);
    for (const n of pt.notes) poly('NOTES', n.dashed);
  }
  for (const e of extra) if (e.kind === 'poly') poly(e.layer, e.pts, e.closed !== false); else text(e.layer, e.x, e.y, e.size, e.t);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\n') + '\n';
}

/** Re-read a DXF and check its structure. Throws on a problem, returns counts. */
function validateDxf(src) {
  const lines = src.replace(/\r/g, '').split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2) throw new Error('DXF: odd number of lines');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim()); if (!Number.isInteger(code)) throw new Error(`DXF: bad group code at line ${i + 1}`);
    pairs.push([code, lines[i + 1]]);
  }
  const res = { layers: new Set(), used: {}, polylines: 0, vertices: 0, texts: 0, insunits: null, version: null };
  let section = null; let inPoly = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 9 && v === '$INSUNITS') res.insunits = Number(pairs[i + 1][1]);
    if (c === 9 && v === '$ACADVER') res.version = pairs[i + 1][1];
    if (c !== 0) { if ([10, 20, 30, 40].includes(c) && !Number.isFinite(Number(v))) throw new Error(`DXF: non-numeric value for code ${c}`); continue; }
    if (v === 'SECTION') { section = pairs[i + 1][1]; continue; }
    if (v === 'ENDSEC') { section = null; continue; }
    if (section === 'TABLES' && v === 'LAYER' && pairs[i + 1][0] === 2) res.layers.add(pairs[i + 1][1]);
    if (section !== 'ENTITIES') continue;
    const layer = (() => { for (let k = i + 1; k < pairs.length && pairs[k][0] !== 0; k++) if (pairs[k][0] === 8) return pairs[k][1]; return null; })();
    if (v === 'POLYLINE') { if (inPoly) throw new Error('DXF: POLYLINE inside POLYLINE'); inPoly = { n: 0, layer }; res.polylines++; res.used[layer] = (res.used[layer] || 0) + 1; }
    else if (v === 'VERTEX') { if (!inPoly) throw new Error('DXF: VERTEX outside POLYLINE'); inPoly.n++; res.vertices++; }
    else if (v === 'SEQEND') { if (!inPoly || inPoly.n < 2) throw new Error('DXF: POLYLINE with fewer than 2 vertices'); inPoly = null; }
    else if (v === 'TEXT') { res.texts++; }
    else if (v !== 'EOF') throw new Error(`DXF: unexpected entity ${v}`);
    if (layer && !res.layers.has(layer)) throw new Error(`DXF: entity on undeclared layer ${layer}`);
  }
  if (inPoly) throw new Error('DXF: unterminated POLYLINE');
  if (pairs[pairs.length - 1][1] !== 'EOF') throw new Error('DXF: missing EOF');
  return res;
}

// ---------------------------------------------------------------------------------------------- elevation (assembled front view)
/** Front elevation, mm, y down from the top of the ring (0) to the floor (H). Returns SVG markup. */
function elevationSvg(L, opts = {}) {
  const { model, Z, dims, parts, facets, plaque } = L; const H = model.H; const W = model.W; const t = L.p.thickness;
  const wood = opts.wood || '#b5793f'; const dark = '#7a4a22'; const glow = '#f6c35b'; const light = '#ecca92';
  const Y = (z) => H - z; const o = [];
  const B = model.base;
  // skirt (front board) with feet
  const sk = dims.skirt; const fl = B.footL; const fh = B.footH;
  o.push(`<path d="${dPoly([[-sk / 2, Y(B.skirtH)], [sk / 2, Y(B.skirtH)], [sk / 2, Y(0)], [sk / 2 - fl, Y(0)], [sk / 2 - fl - 1.5, Y(fh)], [-sk / 2 + fl + 1.5, Y(fh)], [-sk / 2 + fl, Y(0)], [-sk / 2, Y(0)]])}" fill="${dark}"/>`);
  o.push(`<rect x="${fx(-dims.plate / 2)}" y="${fx(Y(B.skirtH + t))}" width="${fx(dims.plate)}" height="${fx(t)}" fill="${wood}" stroke="${dark}" stroke-width="0.3"/>`);
  B.steps.forEach((st, si) => { const s = W + 2 * st.ov; o.push(`<rect x="${fx(-s / 2)}" y="${fx(Y(B.skirtH + t * (si + 2)))}" width="${fx(s)}" height="${fx(t)}" fill="${wood}" stroke="${dark}" stroke-width="0.3"/>`); });
  // front wall with its holes
  const fw = parts.find((q) => q.id.endsWith('wall-front'));
  const tw = (poly) => poly.map(([x, y]) => [x - fw.off[0] - W / 2, Y(Z.zBodyTop) + y - fw.off[1]]);
  o.push(`<rect x="${fx(-W / 2)}" y="${fx(Y(Z.zBodyTop))}" width="${fx(W)}" height="${fx(model.bodyH)}" fill="${wood}" stroke="${dark}" stroke-width="0.4"/>`);
  o.push(`<path d="${fw.holes.map((hh) => dPoly(tw(hh))).join('')}" fill="${glow}"/>`);
  if (model._arch) {
    const ar = parts.find((q) => q.id.endsWith('-arch'));
    o.push(`<path d="${dPoly(ar.outline.map(([x, y]) => [x - ar.off[0], Y(Z.zBodyTop) + y - ar.off[1]]))}" fill="${light}" stroke="${dark}" stroke-width="0.3"/>`);
  }
  const pTop = model.plaque.kind === 'scallop' ? model.plaque.top : model.plaque.centerY - model.plaque.h / 2;
  const tp = (poly) => poly.map(([x, y]) => [x, Y(Z.zBodyTop) + pTop + y]);
  o.push(`<path d="${dPoly(tp(plaque.outline))}" fill="${light}" stroke="${dark}" stroke-width="0.3"/>`);
  o.push(`<path d="${plaque.engrave.map((e) => dPoly(tp(e))).join('')}" fill="#4a2a12"/>`);
  if (opts.nameArea !== false) { const na = plaque.nameArea; o.push(`<path d="${dPoly(tp(rect(na.x, na.y, na.w, na.h)))}" fill="none" stroke="#4a2a12" stroke-width="0.3" stroke-dasharray="1.5 1"/>`); }
  // cap
  let zc = Z.zBodyTop;
  for (const l of model.cap) { const s = W + 2 * l.ov; o.push(`<rect x="${fx(-s / 2)}" y="${fx(Y(zc + t))}" width="${fx(s)}" height="${fx(t)}" fill="${wood}" stroke="${dark}" stroke-width="0.3"/>`); zc += t; }
  // roof: front facets projected (x = u, z = z_i + s·sin α)
  const R = model.roof;
  for (const f of facets) {
    const z0 = Z.zCapTop + R.z[f.i];
    const pr = (poly) => poly.map(([u, y]) => [u * 1, Y(z0 + (f.L - y) * Math.sin(f.a))]);
    const outer = [[-R.r[f.i], Y(z0)], [R.r[f.i], Y(z0)], [R.r[f.i + 1], Y(Z.zCapTop + R.z[f.i + 1])], [-R.r[f.i + 1], Y(Z.zCapTop + R.z[f.i + 1])]];
    o.push(`<path d="${dPoly(outer)}" fill="${wood}" stroke="${dark}" stroke-width="0.4"/>`);
    o.push(`<path d="${f.holes.map((hh) => dPoly(pr(hh))).join('')}" fill="${glow}" opacity="0.85"/>`);
  }
  const cw = R.r[R.r.length - 1] + 1.5;
  o.push(`<rect x="${fx(-cw)}" y="${fx(Y(Z.zRoofTop + t))}" width="${fx(2 * cw)}" height="${fx(t)}" fill="${wood}" stroke="${dark}" stroke-width="0.3"/>`);
  const sp = parts.find((q) => q.id.endsWith('spine-a'));
  // ring + stem: the spine A part above the collar
  const ro = model.ring.od / 2; const ringCy = Y(Z.zRoofTop + t + Z.stem + ro);
  o.push(`<rect x="${fx(-L.stemW / 2)}" y="${fx(Y(Z.zRoofTop + t + Z.stem) - 0.5)}" width="${fx(L.stemW)}" height="${fx(Z.stem + 1)}" fill="${wood}"/>`);
  o.push(`<path d="${dPoly(circle(0, ringCy, ro))}${dPoly(circle(0, ringCy, model.ring.id / 2).reverse())}" fill="${wood}" fill-rule="evenodd" stroke="${dark}" stroke-width="0.3"/>`);
  void sp;
  return o.join('\n');
}

// ---------------------------------------------------------------------------------------------- assembly / LED sheet
function assemblySvg(L) {
  const { model, Z, dims, p, bay, led } = L; const t = p.thickness; const H = model.H;
  const SW = 420; const SH = 297 + 60;
  const o = [];
  const txt = (x, y, s, size = 3.6, extra = '') => o.push(`<text x="${fx(x)}" y="${fx(y)}" font-size="${size}" ${extra}>${esc(s)}</text>`);
  const ar = (x, y, s, size = 3.8, extra = '') => o.push(`<text x="${fx(x)}" y="${fx(y)}" font-size="${size}" direction="rtl" text-anchor="start" unicode-bidi="embed" ${extra}>${esc(s)}</text>`);
  // title
  o.push(`<rect x="4" y="4" width="${SW - 8}" height="27" fill="#fff6f6" stroke="#c00000" stroke-width="0.4"/>`);
  txt(8, 11, `${model.title} (${model.titleAr}) – assembly and LED access`, 6, 'font-weight="bold" fill="#222"');
  txt(8, 18, WARN_EN, 3.8, 'font-weight="bold" fill="#c00000"');
  ar(SW - 8, 25, WARN_AR, 4.2, 'font-weight="bold" fill="#c00000"');
  txt(8, 29.5, `Overall ${dims.W} × ${dims.D} × ${H} mm (W × D × H, feet to ring) · body ${dims.body.W} × ${dims.body.D} × ${dims.body.H} · ${p.thickness} mm ply · slot ${p.slot} · kerf ${p.kerf} · LED ${p.ledDia} × ${p.ledHeight}`, 3.1, 'fill="#333"');
  // (1) front elevation at 1:2
  const ex = 12; const ey = 40; const sc = 0.5;
  o.push(`<g transform="translate(${ex + (dims.W / 2) * sc + 8} ${ey}) scale(${sc})">${elevationSvg(L)}</g>`);
  const exL = ex + 8; const exR = ex + 8 + dims.W * sc;
  o.push(`<g stroke="#333" stroke-width="0.2" fill="none"><path d="M${exR + 6} ${ey}H${exR + 12}M${exR + 6} ${ey + H * sc}H${exR + 12}M${exR + 9} ${ey}V${ey + H * sc}"/><path d="M${exL} ${ey + H * sc + 5}V${ey + H * sc + 9}M${exR} ${ey + H * sc + 5}V${ey + H * sc + 9}M${exL} ${ey + H * sc + 7}H${exR}"/></g>`);
  txt(exR + 10.5, ey + (H * sc) / 2, `H ${H}`, 3.4, `transform="rotate(-90 ${exR + 10.5} ${ey + (H * sc) / 2})" text-anchor="middle"`);
  txt((exL + exR) / 2, ey + H * sc + 13, `${dims.W} (base) · body ${dims.body.W}`, 3.2, 'text-anchor="middle"');
  txt(exL, ey - 3, 'Front view, scale 1:2  ·  منظر أمامي، مقياس ١:٢', 3.4, 'font-weight="bold"');
  // (2) section through the base at 1:1
  const sx0 = 106; const sy0 = 50; const bw = dims.plate; const cx = sx0 + bw / 2; const floor = sy0 + 70;
  txt(sx0, sy0 - 6, 'Section through the base, 1:1  ·  قطاع في القاعدة، مقياس ١:١', 3.4, 'font-weight="bold"');
  const zY = (z) => floor - z;
  const B = model.base; const sk = dims.skirt;
  const box = (x0, z0, w, hh, fill, stroke = '#5a3418') => o.push(`<rect x="${fx(x0)}" y="${fx(zY(z0 + hh))}" width="${fx(w)}" height="${fx(hh)}" fill="${fill}" stroke="${stroke}" stroke-width="0.25"/>`);
  box(cx - sk / 2, 0, t, B.skirtH, '#c9925a'); box(cx + sk / 2 - t, 0, t, B.skirtH, '#c9925a');
  const plateZ = B.skirtH;
  const hole = led.hole;
  box(cx - bw / 2, plateZ, (bw - hole) / 2, t, '#d9a56b'); box(cx + hole / 2, plateZ, (bw - hole) / 2, t, '#d9a56b');
  B.steps.forEach((st, si) => { const s = model.W + 2 * st.ov; box(cx - s / 2, plateZ + t * (si + 1), (s - hole) / 2, t, '#d9a56b'); box(cx + hole / 2, plateZ + t * (si + 1), (s - hole) / 2, t, '#d9a56b'); });
  for (let k = 0; k < B.pocketRings; k++) { const od = hole + 12; box(cx - od / 2, Z.zBaseTop + k * t, 6, t, '#e7bd85'); box(cx + hole / 2, Z.zBaseTop + k * t, 6, t, '#e7bd85'); }
  // walls (stubs)
  box(cx - model.W / 2, Z.zBaseTop, t, 34, '#b5793f'); box(cx + model.W / 2 - t, Z.zBaseTop, t, 34, '#b5793f');
  o.push(`<path d="M${fx(cx - model.W / 2)} ${fx(zY(Z.zBaseTop + 36))}h${t}M${fx(cx + model.W / 2 - t)} ${fx(zY(Z.zBaseTop + 36))}h${t}" stroke="#5a3418" stroke-width="0.25" stroke-dasharray="1 1"/>`);
  // bayonet layers under the plate
  const sq = bay.sq;
  box(cx - sq / 2, plateZ - t, (sq - 2 * (bay.rl + 0.5)) / 2, t, '#e0b27a'); box(cx + bay.rl + 0.5, plateZ - t, (sq - 2 * (bay.rl + 0.5)) / 2, t, '#e0b27a');
  box(cx - sq / 2, plateZ - 2 * t, (sq - bay.d0) / 2, t, '#e8c18c'); box(cx + bay.d0 / 2, plateZ - 2 * t, (sq - bay.d0) / 2, t, '#e8c18c');
  // hatch
  box(cx - bay.rl + 0.3, plateZ - t, 2 * bay.rl - 0.6, t, '#9fd0a0', '#2f6b31');
  box(cx - bay.d0 / 2 + 0.2, plateZ - 2 * t, bay.d0 - 0.4, t, '#9fd0a0', '#2f6b31');
  box(cx - bay.d0 / 2 - 8, plateZ - 3 * t, bay.d0 + 16, t, '#9fd0a0', '#2f6b31');
  // LED
  const ledZ = plateZ; // sits on the lug disc
  o.push(`<rect x="${fx(cx - p.ledDia / 2)}" y="${fx(zY(ledZ + p.ledHeight))}" width="${fx(p.ledDia)}" height="${fx(p.ledHeight)}" rx="2" fill="#fff3c4" stroke="#b08a00" stroke-width="0.35"/>`);
  o.push(`<path d="M${fx(cx)} ${fx(zY(ledZ + p.ledHeight + 9))}q3 4 0 8q-3 -4 0 -8z" fill="#ffb000"/>`);
  txt(cx, zY(ledZ + p.ledHeight / 2) + 1, `LED ${p.ledDia} × ${p.ledHeight}`, 3, 'text-anchor="middle"');
  // labels
  const lab = (x, y, xx, yy, s, sAr) => { o.push(`<path d="M${fx(x)} ${fx(y)}L${fx(xx)} ${fx(yy)}" stroke="#333" stroke-width="0.2"/>`); txt(xx + 1, yy + 1, s, 2.8); if (sAr) ar(xx + 62, yy + 5, sAr, 3); };
  const rx = cx + bw / 2 + 4;
  lab(cx + hole / 2 + 3, zY(Z.zBaseTop - 1), rx, zY(Z.zBaseTop + 8), `pocket Ø${hole} × ${fx(Z.zBaseTop - plateZ + B.pocketRings * t)} deep`, 'جيب الشمعة');
  lab(cx + bay.rl + 3, zY(plateZ - t / 2), rx, zY(plateZ - 2), 'lug-space layer (lugs turn here)', 'طبقة دوران السنون');
  lab(cx + bay.d0 / 2 + 6, zY(plateZ - 1.5 * t), rx, zY(plateZ - 11), 'lock layer (3 notches)', 'طبقة القفل (٣ فتحات)');
  lab(cx + bay.d0 / 2 + 4, zY(plateZ - 2.5 * t), rx, zY(plateZ - 20), 'hatch: lug disc + core + grip (green)', 'الغطا: ٣ طبقات (أخضر)');
  lab(cx - sk / 2 + 1.5, zY(B.footH + 3), cx - sk / 2 + 8, zY(-7), 'skirt; its ends are the feet', null);
  // (3) bottom view of the bayonet, 1:1
  const bx = 368; const by = 96; const r0 = bay.d0 / 2;
  txt(bx - 40, 52, 'Seen from below, 1:1  ·  الغطا من تحت', 3.4, 'font-weight="bold"');
  o.push(`<rect x="${fx(bx - bay.sq / 2)}" y="${fx(by - bay.sq / 2)}" width="${fx(bay.sq)}" height="${fx(bay.sq)}" fill="#e8c18c" stroke="#5a3418" stroke-width="0.25"/>`);
  const lockPath = L.parts.find((q) => q.id.endsWith('bay-lock')); const lugPath = L.parts.find((q) => q.id.endsWith('hatch-lugs'));
  const centreOf = (pt) => { const b = bboxOf([pt.outline]); return [b.x0 + b.w / 2, b.y0 + b.h / 2]; };
  const [lcx, lcy] = centreOf(lockPath); const [hcx, hcy] = centreOf(lugPath);
  const below = (poly, cx0, cy0) => poly.map(([x, y]) => [bx - (x - cx0), by + (y - cy0)]); // seen from below = mirrored
  o.push(`<path d="${dPoly(below(lockPath.holes[0], lcx, lcy))}" fill="#fff" stroke="#5a3418" stroke-width="0.25"/>`);
  o.push(`<path d="${dPoly(below(rot(lugPath.outline, -bay.turn, hcx, hcy), hcx, hcy))}" fill="#9fd0a0" stroke="#2f6b31" stroke-width="0.3" stroke-dasharray="1 0.6"/>`);
  o.push(`<circle cx="${bx}" cy="${by}" r="${fx(r0 - 0.2)}" fill="#bfe3bf" stroke="#2f6b31" stroke-width="0.3"/>`);
  o.push(`<path d="${dPoly(arc(bx, by, r0 * 0.62, -150 * D2R, -40 * D2R), false)}" fill="none" stroke="#1d4f20" stroke-width="1.2"/><path d="M${fx(bx + r0 * 0.62 * Math.cos(-40 * D2R) + 3)} ${fx(by + r0 * 0.62 * Math.sin(-40 * D2R) - 1)}l-4 -2.5l0.5 5z" fill="#1d4f20"/>`);
  txt(bx, by + 4, 'LOCK: turn clockwise 60°', 2.8, 'text-anchor="middle" fill="#1d4f20"');
  ar(bx + 20, by + 9, 'للقفل: لف مع عقارب الساعة ٦٠°', 3, 'fill="#1d4f20"');
  txt(bx - bay.sq / 2 - 2, by + bay.sq / 2 + 6, 'white: notches in the lock layer', 2.6); txt(bx - bay.sq / 2 - 2, by + bay.sq / 2 + 10, 'dashed green: lugs, locked position', 2.6);
  // (4) steps
  const stepsEn = [
    'LED / battery: hold the lantern upside down or lift it; turn the hatch under the base ANTICLOCKWISE (against the arrow) until it stops, about 60°.',
    'Pull the hatch down: the tea light comes out with it. Switch it on, or open it and change its coin battery (CR2032 in most tea lights).',
    'Put the tea light back on the hatch, line the 3 lugs up with the 3 notches, push in and turn CLOCKWISE (with the arrow) until it stops. Now it can hang.',
  ];
  const stepsAr = [
    'الشمعة / البطارية: اقلب الفانوس أو ارفعه، ولف الغطا اللي تحت القاعدة عكس عقارب الساعة (عكس السهم) لحد ما يقف، حوالي ٦٠°.',
    'اسحب الغطا لتحت، الشمعة هتنزل معاه. شغّلها، أو افتحها وغيّر البطارية (CR2032 في أغلب الشموع).',
    'رجّع الشمعة على الغطا، وطابق السنون الـ٣ على الفتحات الـ٣، ودخّله ولفه مع عقارب الساعة (مع السهم) لحد ما يقف. كده الفانوس ينفع يتعلق.',
  ];
  const asmEn = [
    'Workshop assembly: 1) cut the slot-fit strip first and set --slot; 2) glue the 4 walls at the finger joints (front/back have the full corner fingers);',
    '3) glue the plaque/arch on the front wall inside the blue score line; 4) glue the walls into the base plate (or base step 1) and the skirt under it;',
    '5) glue the lug-space and lock layers centred under the base plate (notches as drawn); glue the 3 hatch discs (lugs on top, grip at the bottom);',
    '6) half-lap spine A and B, tab them into the cap, glue the roof facets tier by tier onto the spines (hips meet inside), then the collar; 7) glue the cap onto the walls.',
  ];
  let yy = 214;
  txt(12, yy, 'LED and battery access – 3 steps', 4.2, 'font-weight="bold"'); ar(SW - 12, yy, 'تغيير الشمعة والبطارية – ٣ خطوات', 4.4, 'font-weight="bold"'); yy += 7;
  stepsEn.forEach((s, i) => { txt(12, yy, `${i + 1}. ${s}`, 3.2); yy += 5; ar(SW - 12, yy, `${'١٢٣'[i]}. ${stepsAr[i]}`, 3.5); yy += 7; });
  yy += 3;
  txt(12, yy, 'Assembly order (workshop)', 4, 'font-weight="bold"'); ar(SW - 12, yy, 'ترتيب التجميع (للورشة)', 4.2, 'font-weight="bold"'); yy += 6;
  for (const s of asmEn) { txt(12, yy, s, 3); yy += 4.6; }
  ar(SW - 12, yy + 1, 'الحيطان الأربعة بتتلزق في بعض بالأسنان، والقاعدة والسقف بالألسنة في الشقوق. الغطا اللي تحت بيتقفل بلفة، فالفانوس يتعلق بأمان.', 3.4); yy += 8;
  txt(12, yy, `Inside height from the pocket floor to the cap: ${fx(Z.zBodyTop - Z.zPlateBottom)} mm (LED + flame need ~${p.ledHeight + 15} mm). Hatch, notches and pocket follow --led-dia; the lantern stands on the skirt ends (feet), the grip is ${fx(B.skirtH - 3 * t)} mm above the table.`, 2.9);
  const h2 = Math.max(250, yy + 10); void SH;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SW}mm" height="${fx(h2)}mm" viewBox="0 0 ${SW} ${fx(h2)}">
<title>${esc(model.title)} – assembly and LED access (PROTOTYPE)</title>
<rect width="${SW}" height="${fx(h2)}" fill="#ffffff"/>
<g font-family="Arial, 'Noto Sans Arabic', sans-serif" fill="#222">
${o.join('\n')}
</g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------- slot fit test
function slotTest(p) {
  const t = p.thickness; const widths = []; for (let s = 2.8; s <= 3.4001; s += 0.1) widths.push(Math.round(s * 10) / 10);
  const pitch = 14; const sw = 10 + 0.5; const W = widths.length * pitch + 12; const H = 30;
  const strip = part('slot-strip', `Slot strip: slot widths ${widths[0]} … ${widths[widths.length - 1]} mm (length ${sw})`, roundRect(0, 0, W, H, 2));
  widths.forEach((s, i) => {
    const cx = 6 + pitch / 2 + i * pitch;
    strip.slots.push(rect(cx - s / 2, 6, s, sw));
    strip.score.push(...strokeText(s.toFixed(1), cx - 4.2, 20, 5).map((pts) => ({ pts, closed: false })));
  });
  const tab = part('slot-tab', 'Matching tab (10 mm): try it in each slot', [[0, 0], [30, 0], [30, 14], [20, 14], [20, 22], [10, 22], [10, 14], [0, 14]]);
  tab.holes.push(circle(15, 6, 2.5));
  // finger-joint pair, with this --kerf
  const fa = part('finger-a', 'Finger pair A (kerf-compensated)', wallOutline({ w: 40, h: 30, t, kerf: p.kerf, n: 3, startFull: true, tabXs: [], tabW: 0, topTabs: false, bottomTabs: false }));
  const fb = part('finger-b', 'Finger pair B', wallOutline({ w: 40, h: 30, t, kerf: p.kerf, n: 3, startFull: false, tabXs: [], tabW: 0, topTabs: false, bottomTabs: false }));
  return [strip, tab, fa, fb];
}

// ---------------------------------------------------------------------------------------------- main
function generate(opts = {}) {
  const p = { ...DEFAULTS, ...opts }; checkParams(p);
  fs.mkdirSync(p.out, { recursive: true });
  const summary = { generator: 'scripts/lantern-drawings.js', prototype: true, warning: { en: WARN_EN, ar: WARN_AR }, params: { thicknessMm: p.thickness, slotMm: p.slot, kerfMm: p.kerf, minWebMm: p.web, ledDiaMm: p.ledDia, ledHeightMm: p.ledHeight, ledPocketMm: p.ledDia + p.ledClear }, models: {}, files: [] };
  const written = [];
  const write = (name, data) => { fs.writeFileSync(path.join(p.out, name), data); written.push(name); };
  for (const key of Object.keys(MODELS)) {
    const model = JSON.parse(JSON.stringify(MODELS[key]));
    const L = build(model, p);
    const na = L.plaque.nameArea;
    const extra = [
      `Overall ${L.dims.W} × ${L.dims.D} × ${model.H} mm (W × D × H, feet to top of ring) · body ${model.W} × ${model.W} × ${model.bodyH} · base ${fx(L.Z.zBaseTop)} · cap ${fx(L.dims.capT)} · dome ${L.dims.roofH} · ring Ø${model.ring.od}`,
      `${model.plaque.kind === 'scallop' ? 'Plaque' : 'Nameplate'} ${model.plaque.w} × ${model.plaque.h} mm · blank NAME AREA ${na.w} × ${na.h} mm (dashed, NOTES) · ${L.parts.length} parts · 3 mm plywood (MDF also works)`,
    ];
    const lines = titleLines(`${model.title} – body, all parts (${model.titleAr})`, p, extra);
    const top = titleHeight(lines);
    const lay = layout(L.parts, p.sheetWidth, 7, 6, top);
    const bad = overlaps(L.parts); if (bad.length) throw new Error(`overlapping parts: ${JSON.stringify(bad.slice(0, 3))}`);
    write(`${key}-body.svg`, svgDoc({ w: lay.w, h: lay.h, lines, parts: L.parts }));
    const dxf = dxfDoc({ w: lay.w, h: lay.h, parts: L.parts, lines });
    validateDxf(dxf);
    write(`${key}-body.dxf`, dxf);
    write(`${key}-assembly.svg`, assemblySvg(L));
    summary.models[key] = {
      title: model.title,
      overallMm: { W: L.dims.W, D: L.dims.D, H: model.H },
      bodyMm: { W: model.W, D: model.W, H: model.bodyH },
      stackMm: { base: Math.round(L.Z.zBaseTop * 100) / 100, body: model.bodyH, cap: L.dims.capT, dome: L.dims.roofH, collar: p.thickness, ringStem: L.dims.stem, ringOD: model.ring.od },
      heightCheckMm: Math.round((L.Z.zRoofTop + p.thickness + L.Z.stem + model.ring.od) * 1000) / 1000,
      plaqueMm: { w: model.plaque.w, h: model.plaque.h, kind: model.plaque.kind },
      nameAreaMm: { w: na.w, h: na.h, fromPlaqueTopMm: na.y },
      led: { pocketDiaMm: L.led.hole, access: 'bayonet hatch under the base (turn 60°)', bayonetDiaMm: L.bay.d0 },
      sheetMm: { w: Math.round(lay.w), h: Math.round(lay.h) },
      parts: L.parts.length,
      roofTiers: L.facets.length,
    };
    generate.last = generate.last || {}; generate.last[key] = L;
  }
  // slot fit test
  {
    const parts = slotTest(p);
    const lines = titleLines('Slot-fit test (cut this first)', p, [
      'Cut in the sheet you will use. Push the tab into each slot: pick the narrowest slot the tab enters by hand with light friction, and use that number as --slot.',
      'The finger pair checks the kerf: the fingers should press together by hand. Too loose → raise --kerf by 0.05; too tight → lower it.',
    ]);
    const top = titleHeight(lines);
    const lay = layout(parts, 420, 7, 6, top);
    write('slot-fit-test.svg', svgDoc({ w: lay.w, h: lay.h, lines, parts }));
    const dxf = dxfDoc({ w: lay.w, h: lay.h, parts, lines }); validateDxf(dxf); write('slot-fit-test.dxf', dxf);
  }
  summary.files = [...written, 'lanterns.json', 'README.md'];
  write('lanterns.json', JSON.stringify(summary, null, 2) + '\n');
  write('README.md', readme(summary, p));
  return { summary, written, out: p.out };
}

function readme(s, p) {
  const m = s.models; const ff = m.familyfanous; const bl = m.arabesquelantern;
  return `# Ramadan lanterns – laser-cut drawings (PROTOTYPE)

> **${WARN_EN}**
>
> **${WARN_AR}**

Generated by \`scripts/lantern-drawings.js\` (plain Node, no dependencies). Do not edit the files by hand: change
the parameters or the script and regenerate.

\`\`\`
node scripts/lantern-drawings.js --thickness 3 --slot 3.1 --kerf 0.15
\`\`\`

| Option | Default | What it changes |
|---|---|---|
| \`--thickness\` | 3 | sheet thickness: finger depth, tab length, the layer stack (the ring stem absorbs the difference, so the height stays 300) |
| \`--slot\` | 3.1 | drawn width of every slot (tab-and-slot joints, half-laps, slot lengths = tab + (slot − thickness)) |
| \`--kerf\` | 0.15 | finger joints are drawn kerf-compensated; lattice webs are drawn web + kerf |
| \`--web\` | 3 | narrowest lattice web after cutting (never below 2.5) |
| \`--led-dia\` / \`--led-height\` | 40 / 20 | the LED tea light: pocket Ø = dia + 1, bayonet hatch Ø = dia + 10 |
| \`--out\` | docs/lanterns | where the files go |

Material: 3 mm plywood (birch/poplar) preferred, 3 mm MDF also works. The arch overlay and the plaques read best in a
lighter ply than the walls.

## Files

| File | What it is |
|---|---|
| \`familyfanous-body.svg\` / \`.dxf\` | every part of one Family Fanous, 1:1 mm, laid out flat (sheet ${ff.sheetMm.w} × ${ff.sheetMm.h} mm) |
| \`arabesquelantern-body.svg\` / \`.dxf\` | every part of one Arabesque Arch Lantern (sheet ${bl.sheetMm.w} × ${bl.sheetMm.h} mm) |
| \`familyfanous-assembly.svg\`, \`arabesquelantern-assembly.svg\` | front view with the overall size, section of the base with the LED, the bayonet hatch from below, LED/battery steps and assembly order (EN + AR) |
| \`slot-fit-test.svg\` / \`.dxf\` | cut this first: a strip with slots 2.8 … 3.4 mm (labels scored), a matching 10 mm tab and a finger-joint pair |
| \`lanterns.json\` | the numbers below, for the shop's product data |

Layers: **CUT** red #ff0000 0.1 mm, no fill (outlines, holes, slots) · **ENGRAVE** black fill (crescent and star,
florets, the hatch arrow and padlock; in the DXF closed outlines to fill) · **SCORE** blue (where the plaque/arch
are glued, slot-test numbers) · **NOTES** grey (title block, part labels, name area: do not output). The DXF is
R12 ASCII (AC1009), mm (\`$INSUNITS\` 4), closed POLYLINEs. Each body is laid out on one sheet 600 mm wide
(taller than most beds): split it into beds in the laser software; parts never overlap and keep 7 mm apart.

## Sizes

| | Family Fanous | Arabesque Arch |
|---|---|---|
| Overall W × D × H (feet to top of ring) | **${ff.overallMm.W} × ${ff.overallMm.D} × ${ff.overallMm.H} mm** | **${bl.overallMm.W} × ${bl.overallMm.D} × ${bl.overallMm.H} mm** |
| Body (walls) | ${ff.bodyMm.W} × ${ff.bodyMm.D} × ${ff.bodyMm.H} | ${bl.bodyMm.W} × ${bl.bodyMm.D} × ${bl.bodyMm.H} |
| Base / cap / dome / collar / ring | ${ff.stackMm.base} / ${ff.stackMm.cap} / ${ff.stackMm.dome} / ${ff.stackMm.collar} / Ø${ff.stackMm.ringOD} | ${bl.stackMm.base} / ${bl.stackMm.cap} / ${bl.stackMm.dome} / ${bl.stackMm.collar} / Ø${bl.stackMm.ringOD} |
| Plaque | scalloped, ${ff.plaqueMm.w} × ${ff.plaqueMm.h}, crescent and star engraved | cusped, ${bl.plaqueMm.w} × ${bl.plaqueMm.h}, two florets engraved |
| **Blank name area** | **${ff.nameAreaMm.w} × ${ff.nameAreaMm.h} mm** (under the crescent, ${ff.nameAreaMm.fromPlaqueTopMm} mm from the plaque top; 1–2 lines) | **${bl.nameAreaMm.w} × ${bl.nameAreaMm.h} mm** (between the florets, ${bl.nameAreaMm.fromPlaqueTopMm} mm from the plate top; 1 line) |
| Parts | ${ff.parts} | ${bl.parts} |

Proportions are measured on the approved mockups (front face, perspective allowed for) and scaled to 300 mm.

## How it goes together

- **Walls**: four lattice walls, finger joints on the corners (front/back carry the corner fingers), two tabs on the
  top and two on the bottom of each wall.
- **Base**: walls glue into the base top plate (Arabesque: into base step 1, with step 2 under it); a low skirt box
  under the plate, its ends cut away so the corners are the feet.
- **Roof**: cap plate on the walls; two crossed spines (half-lap) tab into the cap, spine A carries the hanging ring
  through the collar. The dome is faceted, four faces per tier (Family Fanous ${ff.roofTiers} tiers, ${ff.stackMm.dome} mm;
  Arabesque ${bl.roofTiers} tiers, ${bl.stackMm.dome} mm), glued to the spines and to each other; faces are cut to meet
  on the inside, leaving a small V at the hips like the ribs in the mockup. Flat facets stand in for the mockups'
  curved dome (3 mm ply does not bend that tightly).
- **LED**: the tea light sits in a pocket in the base (Ø${ff.led.pocketDiaMm}). Under the base plate there is a
  twist-lock (bayonet) hatch: a lug-space layer and a lock layer with three notches are glued under the plate; the
  hatch is three discs (lugs, core, grip with an engraved arrow and padlock). Turn the hatch 60° anticlockwise and
  pull: the tea light comes out with it (switch / CR2032 battery). Put it back, push and turn clockwise until it
  stops. Locked, the lantern can hang by its ring.

## To confirm in the workshop before production

1. **Sheet thickness**: measure the real sheet (3 mm ply is often 2.7–3.2). Regenerate with \`--thickness\`.
2. **Joint fit**: cut \`slot-fit-test\`; choose \`--slot\` (snug by hand) and check \`--kerf\` with the finger pair.
3. **LED**: measure the tea light you will buy (diameter, height, where its switch is) and set \`--led-dia\` /
   \`--led-height\`; check that the bayonet turns smoothly and holds when the lantern hangs (it carries only the LED).
4. **Roof**: the faceted dome is glued; check the facet angles and the hip gaps on the first piece.
5. **Lattice**: webs are ${p.web} mm after the kerf (never below 2.5); check that nothing burns through and the plaque glue area is enough.
   The hatch's lug disc turns in a layer of the same thickness: if it binds, sand it lightly; if it rattles, add a paper shim.
6. **Hanging**: the ring is part of spine A (3 mm ply, Ø${ff.stackMm.ringOD}); test it with the finished lantern before
   selling it as hangable.
`;
}

if (require.main === module) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) { console.log('node scripts/lantern-drawings.js [--thickness 3] [--slot 3.1] [--kerf 0.15] [--web 3] [--led-dia 40] [--led-height 20] [--out docs/lanterns]'); process.exit(0); }
    const t0 = Date.now();
    const { summary, written, out } = generate(o);
    for (const [k, m] of Object.entries(summary.models)) console.log(`${k}: overall ${m.overallMm.W} × ${m.overallMm.D} × ${m.overallMm.H} mm, name area ${m.nameAreaMm.w} × ${m.nameAreaMm.h} mm, ${m.parts} parts, sheet ${m.sheetMm.w} × ${m.sheetMm.h}`);
    console.log(`wrote ${written.length} files to ${path.relative(process.cwd(), out) || out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { generate, parseArgs, validateDxf, minGap, DEFAULTS, MODELS, elevationSvg, latticeHoles };
