/*
 * Round drinkware geometry ("New product from photo", slice 1), shared by the browser and the server.
 *
 * A tapered cup's print band is part of a cone. Unrolled flat, a cone band is an annular sector (a "fan"); printing
 * a plain rectangle on it comes out crooked. Customers design on the UNROLLED RECTANGLE (Wrect × Hrect: the band's
 * long arc × its slant height), so horizontal lines become level rings on the cup; the shop warps that rectangle to
 * the fan only for the print file and the previews.
 *
 * All lengths in mm, angles in radians.
 *   print  = { topMm, heightMm, d1Mm, d2Mm, gapMm, safeMm }  d1: diameter at the band's top edge, d2: at its bottom
 *   handle = { y0Mm, y1Mm, widthMm } | null
 *
 * fanOf(print, handle) -> { template, r1, r2, h, s, Ro, Ri, theta, phi, W, H, Wrect, Hrect, wideTop, gapMm, safeMm }
 *   r1 = larger radius, r2 = smaller, h = vertical band height, s = slant height.
 *   phi = the angle round the cup that is printed: 2π less the seam gap (and the handle with a safe margin each side),
 *         measured at the narrow radius so the gap is never smaller than asked anywhere on the band.
 *   Fan: Ro = s·r1/(r1−r2), Ri = Ro − s, theta = phi·(r1−r2)/s; its bounding box W × H.
 *   Straight (|d1−d2| < 0.5 mm): template 'rect', Ro/Ri/theta null, W = Wrect, H = Hrect.
 * fanXY(u, v, fan) -> [X, Y]  u, v in 0..1 over the design rectangle (v = 0 at the band's top) -> point on the fan, mm
 *                             from the fan box's top-left corner.
 * fanUV(X, Y, fan) -> [u, v]  the inverse (u or v outside 0..1 = outside the fan).
 * fitArea(w, h)    -> { x, y, w, h } the print area in the 500 × 600 mockup space: ≤ 400 wide, ≤ 420 high, centred.
 * squeezePct(fan)  -> how much narrower the print comes out at the narrow edge, in %.
 * unrolledSvg(spec)            -> the editor's drawing of the unrolled band (seam / handle strips at both ends).
 * silhouetteSvg(profile, opts) -> the product seen from the front (the previews' wrap.view); opts { print, handle }.
 * radiusAt(profile, y)         -> the profile's radius at height y (linear).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.POD_DRINKGEOM = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const TAU = Math.PI * 2;
  const STRAIGHT_MM = 0.5;

  function fanOf(print, handle) {
    const d1 = Number(print.d1Mm);
    const d2 = Number(print.d2Mm);
    const h = Number(print.heightMm);
    const gapMm = print.gapMm == null ? 5 : Number(print.gapMm);
    const safeMm = print.safeMm == null ? 3 : Number(print.safeMm);
    if (!(d1 > 0 && d2 > 0 && h > 0)) throw new Error('drinkware: diameters and height must be positive');
    const wideTop = d1 >= d2;
    const r1 = Math.max(d1, d2) / 2;
    const r2 = Math.min(d1, d2) / 2;
    const gapArc = gapMm + (handle && handle.widthMm > 0 ? Number(handle.widthMm) + 2 * safeMm : 0);
    const phi = TAU - gapArc / r2;
    if (!(phi > 0)) throw new Error('drinkware: the seam gap and handle leave nothing to print');
    const base = { r1, r2, h, phi, wideTop, gapMm, safeMm };
    if (Math.abs(d1 - d2) < STRAIGHT_MM) {
      const Wrect = phi * r1;
      return { template: 'rect', ...base, s: h, Ro: null, Ri: null, theta: null, W: Wrect, H: h, Wrect, Hrect: h };
    }
    const s = Math.sqrt(h * h + (r1 - r2) * (r1 - r2));
    const Ro = (s * r1) / (r1 - r2);
    const Ri = Ro - s;
    const theta = (phi * (r1 - r2)) / s;
    // The fan's bounding box (the arcs bow round a centre below the wide edge).
    const W = theta <= Math.PI ? 2 * Ro * Math.sin(theta / 2) : 2 * Ro;
    const H = theta <= Math.PI ? Ro - Ri * Math.cos(theta / 2) : Ro + Ro * Math.min(1, -Math.cos(theta / 2));
    return { template: 'fan', ...base, s, Ro, Ri, theta, W, H, Wrect: phi * r1, Hrect: s };
  }

  /** Design rectangle (u, v in 0..1, v = 0 at the band's top) -> fan point, mm from the fan box's top-left. */
  function fanXY(u, v, fan) {
    if (fan.template !== 'fan') return [u * fan.W, v * fan.H];
    const vw = fan.wideTop ? v : 1 - v; // 0 at the wide edge
    const a = (u - 0.5) * fan.theta;
    const rho = fan.Ro - vw * fan.s;
    const x = fan.W / 2 + rho * Math.sin(a);
    const y = fan.Ro - rho * Math.cos(a); // wide edge on top
    return [x, fan.wideTop ? y : fan.H - y];
  }

  /** The inverse of fanXY: fan point (mm) -> [u, v] on the design rectangle. */
  function fanUV(X, Y, fan) {
    if (fan.template !== 'fan') return [X / fan.W, Y / fan.H];
    const y = fan.wideTop ? Y : fan.H - Y;
    const dx = X - fan.W / 2;
    const dy = fan.Ro - y;
    const rho = Math.hypot(dx, dy);
    const a = Math.atan2(dx, dy);
    const u = a / fan.theta + 0.5;
    const vw = (fan.Ro - rho) / fan.s;
    return [u, fan.wideTop ? vw : 1 - vw];
  }

  function fitArea(w, h) {
    const k = Math.min(400 / w, 420 / h);
    const aw = Math.round(w * k * 10) / 10;
    const ah = Math.round(h * k * 10) / 10;
    return { x: Math.round((500 - aw) / 2 * 10) / 10, y: Math.round((600 - ah) / 2 * 10) / 10, w: aw, h: ah };
  }

  /** How much narrower the design is printed at the band's narrow edge than at its wide edge, in %. */
  function squeezePct(fan) {
    return Math.round((1 - fan.r2 / fan.r1) * 1000) / 10;
  }

  // ---------- Drawings in the 500 × 600 mockup space ({{C}} body colour, {{L}} line, {{S}} shade, like products.js) ----------
  const n1 = (v) => Math.round(v * 10) / 10;
  const svgWrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600" viewBox="0 0 500 600">${inner}</svg>`;

  /**
   * The editor's drawing of a drinkware product's print side: the band unrolled to a rectangle (its print area is
   * fitArea(Wrect, Hrect)), with the unprinted seam gap (and the handle, when there is one) as shaded strips at
   * both ends, like the mug's MUG_WRAP_SVG. spec = the `drinkware` spec ({ print, handle }).
   */
  function unrolledSvg(spec) {
    const fan = fanOf(spec.print, spec.handle);
    const a = fitArea(fan.Wrect, fan.Hrect);
    const k = a.w / fan.Wrect;
    // The gap round the cup at the wide radius, half at each end (at most 45 units each, so it stays in the drawing).
    const gap = Math.min(45, Math.max(8, ((TAU - fan.phi) * fan.r1 * k) / 2));
    const x0 = a.x - gap;
    const w = a.w + 2 * gap;
    const y0 = a.y - 6;
    const h = a.h + 12;
    let inner = `<rect x="${n1(x0 + 6)}" y="${n1(y0 + 7)}" width="${n1(w)}" height="${n1(h)}" rx="8" fill="#000" opacity=".08"/>`
      + `<rect x="${n1(x0)}" y="${n1(y0)}" width="${n1(w)}" height="${n1(h)}" rx="8" fill="{{C}}" stroke="{{L}}" stroke-width="3"/>`
      + `<rect x="${n1(x0 + 1.5)}" y="${n1(y0 + 1.5)}" width="${n1(gap - 1.5)}" height="${n1(h - 3)}" rx="7" fill="#000" opacity=".07"/>`
      + `<rect x="${n1(a.x + a.w)}" y="${n1(y0 + 1.5)}" width="${n1(gap - 1.5)}" height="${n1(h - 3)}" rx="7" fill="#000" opacity=".07"/>`;
    if (spec.handle) {
      const cy = a.y + a.h / 2;
      const hh = Math.min(38, a.h * 0.3);
      inner += `<path d="M${n1(x0 + gap / 2)} ${n1(cy - hh)} q-${n1(gap * 0.4)} ${n1(hh)} 0 ${n1(2 * hh)} M${n1(a.x + a.w + gap / 2)} ${n1(cy - hh)} q${n1(gap * 0.4)} ${n1(hh)} 0 ${n1(2 * hh)}" fill="none" stroke="{{L}}" stroke-width="6" stroke-linecap="round" opacity=".55"/>`;
    }
    // The middle of the print (opposite the seam or the handle).
    inner += `<path d="M250 ${n1(y0 + 4)} v${n1(h - 8)}" stroke="{{L}}" stroke-width="1.5" stroke-dasharray="3 7" opacity=".45"/>`;
    return svgWrap(inner);
  }

  /**
   * The product seen from the front (the previews' `wrap.view`), from its profile [[yMm, rMm], ...] (rim at y = 0).
   * Drawn like the mug's front view: centred on x = 230, the widest radius 110 units (smaller for a very tall body),
   * the print band (opts.print: { topMm, heightMm }) centred near y = 310 where the previews lay the design.
   * opts.handle ({ y0Mm, y1Mm }) draws a handle on the right.
   */
  function silhouetteSvg(profile, opts) {
    const o = opts || {};
    const pts = (profile || []).map((p) => [Number(p[0]), Number(p[1])]).filter((p) => p[0] >= 0 && p[1] > 0).sort((p, q) => p[0] - q[0]);
    if (pts.length < 2) throw new Error('drinkware: a profile needs two points');
    const hMm = pts[pts.length - 1][0] - pts[0][0];
    const rMax = Math.max(...pts.map((p) => p[1]));
    const k = Math.min(110 / rMax, 440 / hMm);
    const bandMid = o.print ? Number(o.print.topMm) + Number(o.print.heightMm) / 2 : hMm / 2;
    let top = 310 - (bandMid - pts[0][0]) * k;
    top = Math.max(60, Math.min(top, 560 - hMm * k));
    const X = (r) => r * k;
    const Y = (y) => top + (y - pts[0][0]) * k;
    const rTop = X(pts[0][1]);
    const rBot = X(pts[pts.length - 1][1]);
    const yTop = Y(pts[0][0]);
    const yBot = Y(pts[pts.length - 1][0]);
    const right = pts.map((p) => `L${n1(230 + X(p[1]))} ${n1(Y(p[0]))}`).join(' ');
    const left = pts.slice().reverse().map((p) => `L${n1(230 - X(p[1]))} ${n1(Y(p[0]))}`).join(' ');
    const sagT = Math.max(4, rTop * 0.16);
    const sagB = Math.max(4, rBot * 0.16);
    let inner = `<ellipse cx="236" cy="${n1(yBot + 8)}" rx="${n1(rBot + 30)}" ry="${n1(sagB + 4)}" fill="#000" opacity=".08"/>`;
    if (o.handle) {
      const hy0 = Y(Number(o.handle.y0Mm));
      const hy1 = Y(Number(o.handle.y1Mm));
      const rAt = (y) => X(radiusAt(pts, y));
      const xa = 230 + rAt(Number(o.handle.y0Mm)) - 4;
      const xb = 230 + rAt(Number(o.handle.y1Mm)) - 4;
      const reach = Math.max(30, (hy1 - hy0) * 0.45);
      inner += `<path d="M${n1(xa)} ${n1(hy0 + 6)} C${n1(xa + reach)} ${n1(hy0)} ${n1(xb + reach)} ${n1(hy1)} ${n1(xb)} ${n1(hy1 - 6)}" fill="none" stroke="{{L}}" stroke-width="20" stroke-linecap="round"/>`
        + `<path d="M${n1(xa)} ${n1(hy0 + 6)} C${n1(xa + reach)} ${n1(hy0)} ${n1(xb + reach)} ${n1(hy1)} ${n1(xb)} ${n1(hy1 - 6)}" fill="none" stroke="{{C}}" stroke-width="14" stroke-linecap="round"/>`;
    }
    inner += `<path d="M${n1(230 - rTop)} ${n1(yTop)} ${right} Q230 ${n1(yBot + 2 * sagB)} ${n1(230 - rBot)} ${n1(yBot)} ${left} Z" fill="{{C}}" stroke="{{L}}" stroke-width="3" stroke-linejoin="round"/>`
      + `<ellipse cx="230" cy="${n1(yTop)}" rx="${n1(rTop)}" ry="${n1(sagT)}" fill="{{S}}" stroke="{{L}}" stroke-width="3"/>`;
    return svgWrap(inner);
  }

  /** The radius of a profile [[yMm, rMm], ...] at height y (linear between points, clamped at the ends). */
  function radiusAt(profile, y) {
    const pts = profile;
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (y <= pts[i][0]) {
        const [y0, r0] = pts[i - 1];
        const [y1, r1] = pts[i];
        return y1 === y0 ? r1 : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  }

  return { fanOf, fanXY, fanUV, fitArea, squeezePct, unrolledSvg, silhouetteSvg, radiusAt, STRAIGHT_MM };
}));
