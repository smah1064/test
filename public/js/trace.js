/* Trace: turn a bitmap (one alpha byte per pixel) into closed vector outlines,
 * for laser cut lines. Shared by the browser (live "this falls apart" hints in
 * the editor) and the server (the cut SVG the shop downloads), so both count
 * the same pieces.
 *
 *   trace(alpha, w, h, { threshold, simplify, minArea })
 *     -> { contours: [{ points: [[x, y], ...], hole, parent, area }], pieces }
 *   pathData(contours, scale, offset) -> SVG path `d`
 *
 * The outline runs along pixel edges (like potrace), so it is exact before it
 * is simplified: a filled 10 × 10 px square is the square 0..10, not 0.5..9.5.
 * Pixels that touch only at a corner are separate pieces: a laser cut through
 * that corner leaves nothing holding them together.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POD_TRACE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Directions: 0 right, 1 down, 2 left, 3 up (y grows downwards).
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  function trace(alpha, w, h, { threshold = 128, simplify = 0.75, minArea = 4 } = {}) {
    // Padded bitmap: a 1 px empty border means no bounds checks while walking.
    const W = w + 2;
    const bit = new Uint8Array(W * (h + 2));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const out = (y + 1) * W + 1;
      for (let x = 0; x < w; x++) if (alpha[row + x] >= threshold) bit[out + x] = 1;
    }

    // Every vertical pixel edge on a boundary belongs to exactly one loop; this
    // remembers which (loop index + 1), so each loop is traced once and the row
    // scan below can tell which loops it is inside.
    const VW = w + 1;
    const owner = new Int32Array(VW * h);
    const loops = [];

    // Follow one boundary from a vertical edge, keeping the filled side on the
    // same hand, recording only the corners (straight runs need no points).
    function follow(sx, sy, sd, id) {
      const pts = [];
      let x = sx, y = sy, d = sd;
      let area2 = 0;
      for (;;) {
        if (d === 1) owner[y * VW + x] = id;
        else if (d === 3) owner[(y - 1) * VW + x] = id;
        x += DX[d];
        y += DY[d];
        // The two pixels ahead: `a` on the filled side, `b` on the other.
        const base = y * W + x;
        let a, b;
        if (d === 0) { a = bit[base + 1]; b = bit[base + W + 1]; }
        else if (d === 1) { a = bit[base + W + 1]; b = bit[base + W]; }
        else if (d === 2) { a = bit[base + W]; b = bit[base]; }
        else { a = bit[base]; b = bit[base + 1]; }
        // Filled ahead: go on, or turn away if the far side is filled too.
        // Empty ahead (diagonal touch included): turn round our own pixel.
        const nd = a ? (b ? (d + 1) & 3 : d) : (d + 3) & 3;
        if (nd !== d) {
          if (pts.length) { const p = pts[pts.length - 1]; area2 += p[0] * y - x * p[1]; }
          pts.push([x, y]);
        }
        d = nd;
        if (x === sx && y === sy && d === sd) break;
      }
      const p = pts[pts.length - 1];
      area2 += p[0] * pts[0][1] - pts[0][0] * p[1];
      return { pts, area2 };
    }

    // Scan each pixel row left to right. Crossing a loop's edge enters it the
    // first time and leaves it the second; loops never cross, so a stack of the
    // loops we are inside gives each new loop its parent.
    const stack = [];
    for (let y = 0; y < h; y++) {
      stack.length = 0;
      const rowBits = (y + 1) * W;
      let prev = 0;
      for (let x = 0; x <= w; x++) {
        const cur = x < w ? bit[rowBits + x + 1] : 0;
        if (cur === prev) continue;
        const e = y * VW + x;
        let id = owner[e];
        if (!id) {
          id = loops.length + 1;
          // Filled on the right: walk down; filled on the left: walk up.
          const { pts, area2 } = cur ? follow(x, y, 1, id) : follow(x, y + 1, 3, id);
          // Outer outlines come out with negative signed area, holes positive.
          loops.push({ pts, area: Math.abs(area2) / 2, hole: area2 > 0, parent: stack.length ? stack[stack.length - 1] - 1 : -1 });
        }
        if (stack.length && stack[stack.length - 1] === id) stack.pop();
        else stack.push(id);
        prev = cur;
      }
    }

    // Drop specks and pinholes. A child is always smaller than its parent, so
    // a dropped loop takes its children with it.
    const keep = new Int32Array(loops.length).fill(-1);
    const contours = [];
    let pieces = 0;
    loops.forEach((l, i) => {
      if (l.area < minArea || (l.parent >= 0 && keep[l.parent] < 0)) return;
      keep[i] = contours.length;
      contours.push({ points: simplifyLoop(l.pts, simplify), hole: l.hole, parent: l.parent >= 0 ? keep[l.parent] : -1, area: l.area });
      if (!l.hole) pieces++;
    });
    return { contours, pieces };
  }

  /** Douglas–Peucker for a closed loop: split at the point farthest from the start, simplify both halves. */
  function simplifyLoop(pts, tol) {
    const n = pts.length;
    if (n <= 4 || !(tol > 0)) return pts;
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
      const dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1];
      const d = dx * dx + dy * dy;
      if (d > best) { best = d; far = i; }
    }
    const mark = new Uint8Array(n + 1);
    mark[0] = mark[far] = mark[n] = 1;
    const tol2 = tol * tol;
    const at = (i) => pts[i === n ? 0 : i];
    const spans = [[0, far], [far, n]];
    while (spans.length) {
      const [s, e] = spans.pop();
      if (e - s < 2) continue;
      const [ax, ay] = at(s), [bx, by] = at(e);
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      let worst = -1, wi = -1;
      for (let i = s + 1; i < e; i++) {
        const [px, py] = pts[i];
        let d;
        if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
        else { const c = vx * (py - ay) - vy * (px - ax); d = (c * c) / len2; }
        if (d > worst) { worst = d; wi = i; }
      }
      if (worst > tol2) { mark[wi] = 1; spans.push([s, wi], [wi, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (mark[i]) out.push(pts[i]);
    return out.length >= 3 ? out : pts;
  }

  const num = (v) => String(Math.round(v * 1000) / 1000);

  /** Closed subpaths for `contours`; `scale` is a number or [sx, sy]. Holes run the other way, so nonzero and even-odd fills agree. */
  function pathData(contours, scale = 1, offset = [0, 0]) {
    const sx = Array.isArray(scale) ? scale[0] : scale;
    const sy = Array.isArray(scale) ? scale[1] : scale;
    const [ox, oy] = offset;
    let d = '';
    for (const c of contours) {
      const p = c.points;
      if (!p || p.length < 2) continue;
      d += (d ? ' ' : '') + 'M' + num(p[0][0] * sx + ox) + ' ' + num(p[0][1] * sy + oy);
      for (let i = 1; i < p.length; i++) d += 'L' + num(p[i][0] * sx + ox) + ' ' + num(p[i][1] * sy + oy);
      d += 'Z';
    }
    return d;
  }

  return { trace, pathData };
});
