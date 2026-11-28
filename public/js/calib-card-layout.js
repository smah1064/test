/*
 * The ebda3 calibration card ("New product from photo", slice 2): ONE description of the printed A4 card, shared by
 * the PDF maker (src/calibration-card.js), the detector (public/js/calib-detect.js), the measurer
 * (public/js/drinkware-measure.js) and the test scenes (test/helpers/synth-card.js), so they can never disagree.
 *
 * Coordinates: LAYOUT MILLIMETRES on the A4 page, portrait, origin at the page's top-left corner, x to the right,
 * y DOWN. A home printer may scale the page; the owner measures the 100 mm ruler line and the wizard stores
 * cardScale = measured / 100. Real millimetres on the printed card = layout mm × cardScale (scaled about the page's
 * top-left corner: only lengths matter, so the origin of the scaling is irrelevant).
 *
 * The card stands upright beside the product, folded back along the dashed line at y = 200 (the lower 97 mm is the
 * easel foot), so only y 0..200 faces the camera.
 *
 *   PAGE      { w: 210, h: 297 }
 *   FINDERS   QR-style finder patterns, 28 mm (7 modules × 4 mm: black 7, white 5, black 3), centres in the order
 *             TL, TR, BL, BR: (25,25) (185,25) (25,175) (185,175).
 *   CHECKER   7 × 5 squares of 20 mm at x 35..175, y 50..150, top-left square black: 6 × 4 = 24 inner corners.
 *   GREYS     six 20 × 14 mm patches at y 156..170, x 45..165: K 0/20/40/60/80/100 % (light to dark, left to right).
 *   COLOURS   C, M, Y, R, G, B patches at y 30..44, same x.
 *   RULER     a 100 mm line at y 192, x 55..155 (0.4 mm thick, end ticks).
 *   FOLD      dashed line at y 200.
 *   LABEL     'EBDA3-CAL v1'.
 *
 *   finderCentres()  -> [[x,y] × 4] TL, TR, BL, BR (layout mm)
 *   innerCorners()   -> [[x,y] × 24] checker saddle points, row by row from the top-left (layout mm)
 *   greyPatches()    -> [{ x, y, w, h, k, rgb }] K 0 → 100
 *   colourPatches()  -> [{ x, y, w, h, name, rgb }]
 *   shapes()         -> drawing list for the PDF: { t:'rect', x, y, w, h, rgb } | { t:'line', x1, y1, x2, y2, w, rgb, dash? }
 *                       painted in order (later on top)
 *   colourAt(x, y)   -> [r, g, b] 0..255 of the ink at a layout-mm point (paper = white); the same picture as shapes()
 *                       (minus text), fast enough to render test photos pixel by pixel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.POD_CALIBLAYOUT = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const VERSION = 'EBDA3-CAL v1';
  const PAGE = { w: 210, h: 297 };
  const FOLD_Y = 200; // the face that looks at the camera is y 0..FOLD_Y
  const FINDER = { size: 28, module: 4, centres: [[25, 25], [185, 25], [25, 175], [185, 175]], names: ['TL', 'TR', 'BL', 'BR'] };
  const CHECKER = { x0: 35, y0: 50, cols: 7, rows: 5, sq: 20 };
  const PATCH = { x0: 45, w: 20, n: 6 };
  const GREYS = { y0: 156, h: 14, k: [0, 20, 40, 60, 80, 100] };
  const COLOURS = {
    y0: 30, h: 14,
    list: [
      ['C', [0, 174, 239]], ['M', [236, 0, 140]], ['Y', [255, 242, 0]],
      ['R', [237, 28, 36]], ['G', [0, 166, 81]], ['B', [46, 49, 146]],
    ],
  };
  const RULER = { y: 192, x0: 55, x1: 155, w: 0.4, tick: 3 };
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  const greyRgb = (k) => { const v = Math.round(255 * (1 - k / 100)); return [v, v, v]; };

  function finderCentres() { return FINDER.centres.map((c) => c.slice()); }

  function innerCorners() {
    const out = [];
    for (let j = 1; j < CHECKER.rows; j++) {
      for (let i = 1; i < CHECKER.cols; i++) out.push([CHECKER.x0 + i * CHECKER.sq, CHECKER.y0 + j * CHECKER.sq]);
    }
    return out;
  }

  function greyPatches() {
    return GREYS.k.map((k, i) => ({ x: PATCH.x0 + i * PATCH.w, y: GREYS.y0, w: PATCH.w, h: GREYS.h, k, rgb: greyRgb(k) }));
  }

  function colourPatches() {
    return COLOURS.list.map(([name, rgb], i) => ({ x: PATCH.x0 + i * PATCH.w, y: COLOURS.y0, w: PATCH.w, h: COLOURS.h, name, rgb }));
  }

  function shapes() {
    const out = [];
    const m = FINDER.module;
    for (const [cx, cy] of FINDER.centres) {
      out.push({ t: 'rect', x: cx - 3.5 * m, y: cy - 3.5 * m, w: 7 * m, h: 7 * m, rgb: BLACK });
      out.push({ t: 'rect', x: cx - 2.5 * m, y: cy - 2.5 * m, w: 5 * m, h: 5 * m, rgb: WHITE });
      out.push({ t: 'rect', x: cx - 1.5 * m, y: cy - 1.5 * m, w: 3 * m, h: 3 * m, rgb: BLACK });
    }
    for (let j = 0; j < CHECKER.rows; j++) {
      for (let i = 0; i < CHECKER.cols; i++) {
        if ((i + j) % 2 === 0) out.push({ t: 'rect', x: CHECKER.x0 + i * CHECKER.sq, y: CHECKER.y0 + j * CHECKER.sq, w: CHECKER.sq, h: CHECKER.sq, rgb: BLACK });
      }
    }
    for (const p of greyPatches()) if (p.k > 0) out.push({ t: 'rect', x: p.x, y: p.y, w: p.w, h: p.h, rgb: p.rgb });
    for (const p of colourPatches()) out.push({ t: 'rect', x: p.x, y: p.y, w: p.w, h: p.h, rgb: p.rgb });
    out.push({ t: 'rect', x: RULER.x0, y: RULER.y - RULER.w / 2, w: RULER.x1 - RULER.x0, h: RULER.w, rgb: BLACK });
    for (const x of [RULER.x0, RULER.x1]) out.push({ t: 'rect', x: x - RULER.w / 2, y: RULER.y - RULER.tick, w: RULER.w, h: 2 * RULER.tick, rgb: BLACK });
    out.push({ t: 'line', x1: 0, y1: FOLD_Y, x2: PAGE.w, y2: FOLD_Y, w: 0.3, rgb: [120, 120, 120], dash: [3, 2] });
    return out;
  }

  // Analytic version of shapes() (text and the fold line left out): constant time per point.
  function colourAt(x, y) {
    if (x < 0 || y < 0 || x > PAGE.w || y > PAGE.h) return WHITE;
    const m = FINDER.module;
    for (const [cx, cy] of FINDER.centres) {
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (d <= 3.5 * m) return d <= 1.5 * m || d > 2.5 * m ? BLACK : WHITE;
    }
    if (x >= CHECKER.x0 && x < CHECKER.x0 + CHECKER.cols * CHECKER.sq && y >= CHECKER.y0 && y < CHECKER.y0 + CHECKER.rows * CHECKER.sq) {
      const i = Math.floor((x - CHECKER.x0) / CHECKER.sq);
      const j = Math.floor((y - CHECKER.y0) / CHECKER.sq);
      return (i + j) % 2 === 0 ? BLACK : WHITE;
    }
    if (x >= PATCH.x0 && x < PATCH.x0 + PATCH.n * PATCH.w) {
      const i = Math.floor((x - PATCH.x0) / PATCH.w);
      if (y >= GREYS.y0 && y < GREYS.y0 + GREYS.h) return greyRgb(GREYS.k[i]);
      if (y >= COLOURS.y0 && y < COLOURS.y0 + COLOURS.h) return COLOURS.list[i][1];
    }
    if (x >= RULER.x0 && x <= RULER.x1 && Math.abs(y - RULER.y) <= RULER.w / 2) return BLACK;
    for (const tx of [RULER.x0, RULER.x1]) if (Math.abs(x - tx) <= RULER.w / 2 && Math.abs(y - RULER.y) <= RULER.tick) return BLACK;
    return WHITE;
  }

  return {
    VERSION, PAGE, FOLD_Y, FINDER, CHECKER, PATCH, GREYS, COLOURS, RULER,
    finderCentres, innerCorners, greyPatches, colourPatches, shapes, colourAt,
  };
}));
