/* Nesting: pack rectangles onto a roll of fixed width (DTF film) using as
 * little length as possible. MaxRects with a bottom-left rule; items may be
 * rotated 90° when that packs tighter. Shared by the browser (gang sheet
 * builder) and the server (pricing and production files), so both always
 * agree on the layout.
 *
 *   pack(items, rollWidth, gap) -> { placements: [{ id, x, y, w, h, rotated }], length }
 *   items: [{ id, w, h, rotate? }]  (any unit; rotate defaults to true)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POD_NEST = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pack(items, rollWidth, gap = 0) {
    const W = rollWidth + gap; // every item carries a gap on its right/bottom
    let free = [{ x: 0, y: 0, w: W, h: 1e9 }];
    const placements = [];
    const order = items
      .map((it, i) => ({ ...it, i }))
      .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

    for (const it of order) {
      const options = [[it.w, it.h, false]];
      if (it.rotate !== false && it.w !== it.h) options.push([it.h, it.w, true]);
      let best = null;
      for (const [w0, h0, rotated] of options) {
        const w = w0 + gap;
        const h = h0 + gap;
        if (w > W + 1e-9) continue;
        for (const f of free) {
          if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
            const score = [f.y + h, f.x];
            if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1])) {
              best = { x: f.x, y: f.y, w, h, w0, h0, rotated, score };
            }
          }
        }
      }
      if (!best) throw new Error(`Item ${it.id} is wider than the roll`);
      placements.push({ id: it.id, x: best.x, y: best.y, w: best.w0, h: best.h0, rotated: best.rotated, i: it.i });

      // Split every free rectangle that overlaps the placed one.
      const used = { x: best.x, y: best.y, w: best.w, h: best.h };
      const next = [];
      for (const f of free) {
        if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) {
          next.push(f);
          continue;
        }
        if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
        if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
        if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
        if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
      }
      // Drop free rectangles contained in another one.
      free = next.filter((a, ia) => a.w > 1e-9 && a.h > 1e-9 && !next.some((b, ib) => ib !== ia && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && (ib < ia || b.w * b.h > a.w * a.h)));
    }
    placements.sort((a, b) => a.i - b.i);
    const length = placements.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    return { placements: placements.map(({ i, ...p }) => p), length }; // eslint-disable-line no-unused-vars
  }

  return { pack };
});
