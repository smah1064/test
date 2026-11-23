/* Fabric.js extensions used by the editor:
 *   - curved text (`curve` -100..100) that keeps Arabic letters joined
 *   - a padded, rounded background box for text (`backgroundColor`)
 *   - photo shapes (`mask`) with an optional inner border
 *   - smart background removal for photos with a plain background
 */
(function () {
  'use strict';

  // ---------- Curved text ----------
  // The text is drawn straight into an offscreen canvas at the current
  // device resolution, then bent along an arc in thin vertical slices. This
  // works for any script, because the browser shapes the whole line first.
  const TP = fabric.Text.prototype;
  TP.curve = 0;
  TP._dimensionAffectingProps = TP._dimensionAffectingProps.concat('curve');
  TP.cacheProperties = TP.cacheProperties.concat('curve');

  function geometry(o) {
    const w = o._straightW;
    const h = o._straightH;
    // Keep the radius at least as large as the text height.
    const maxTheta = Math.min(Math.PI, w / (h * 0.75));
    const theta = Math.max(0.01, (Math.min(Math.abs(o.curve), 100) / 100) * maxTheta);
    const R = w / theta;
    const half = theta / 2;
    const outer = R + h / 2;
    const inner = R - h / 2;
    return { w, h, theta, R, boxW: 2 * outer * Math.sin(Math.min(half, Math.PI / 2)), boxH: outer - inner * Math.cos(half) };
  }

  const origInit = TP.initDimensions;
  TP.initDimensions = function () {
    origInit.call(this);
    if (this.__skipDimension) return;
    this._straightW = this.width;
    this._straightH = this.height;
    if (this.curve && !this.isEditing) {
      const g = geometry(this);
      this.width = g.boxW;
      this.height = g.boxH;
    }
  };

  function fillKey(f) {
    return f && typeof f === 'object' ? JSON.stringify(f.colorStops || f) : String(f);
  }

  const origRender = TP._render;
  TP._render = function (ctx) {
    if (!this.curve || this.isEditing || !this._straightW) return origRender.call(this, ctx);
    const g = geometry(this);
    const m = ctx.getTransform();
    const dev = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 0.1);
    const pad = Math.ceil((this.strokeWidth || 0) + this.fontSize * 0.15);
    let res = Math.min(12, Math.max(1, Math.ceil(dev * 1.25 * 4) / 4));
    while ((g.w + pad * 2) * (g.h + pad * 2) * res * res > 30e6 && res > 1) res -= 0.5;
    const key = [this.text, this.fontFamily, this.fontSize, this.fontWeight, this.fontStyle, fillKey(this.fill), this.stroke, this.strokeWidth,
      this.charSpacing, this.lineHeight, this.textAlign, this.underline, this.linethrough, this.direction, this.paintFirst, g.w, g.h, res].join('|');
    if (!this._curveCache || this._curveCache.key !== key) {
      const c = fabric.util.createCanvasElement();
      c.width = Math.ceil((g.w + pad * 2) * res);
      c.height = Math.ceil((g.h + pad * 2) * res);
      const cx = c.getContext('2d');
      cx.scale(res, res);
      cx.translate(pad + g.w / 2, pad + g.h / 2);
      const saveW = this.width;
      const saveH = this.height;
      this.width = g.w;
      this.height = g.h;
      try {
        origRender.call(this, cx);
      } finally {
        this.width = saveW;
        this.height = saveH;
      }
      this._curveCache = { key, canvas: c };
    }
    const src = this._curveCache.canvas;
    const up = this.curve > 0; // rainbow; otherwise a smile
    const y0 = up ? -g.boxH / 2 + g.h / 2 + g.R : g.boxH / 2 - g.h / 2 - g.R;
    const slice = Math.min(g.w / 20, Math.max(0.2, 2 / dev));
    const overlap = 1 / dev;
    for (let x = -g.w / 2 - pad; x < g.w / 2 + pad; x += slice) {
      const phi = (x + slice / 2) / g.R;
      ctx.save();
      ctx.translate(g.R * Math.sin(phi), up ? y0 - g.R * Math.cos(phi) : y0 + g.R * Math.cos(phi));
      ctx.rotate(up ? phi : -phi);
      const sx = (x + g.w / 2 + pad) * res;
      const sw = Math.min(slice * res + 1, src.width - sx);
      if (sw > 0) ctx.drawImage(src, sx, 0, sw, src.height, -slice / 2, -(g.h / 2 + pad), sw / res + overlap, g.h + pad * 2);
      ctx.restore();
    }
  };

  // ---------- Text background box ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  TP._renderBackground = function (ctx) {
    if (!this.backgroundColor) return;
    const dim = this._getNonTransformedDimensions();
    const px = this.fontSize * 0.3;
    const py = this.fontSize * 0.15;
    ctx.fillStyle = this.backgroundColor;
    roundRectPath(ctx, -dim.x / 2 - px, -dim.y / 2 - py, dim.x + px * 2, dim.y + py * 2, this.fontSize * 0.25);
    ctx.fill();
    this._removeShadow(ctx);
  };

  // ---------- Photo shapes ----------
  const IP = fabric.Image.prototype;
  IP.mask = null;
  IP.maskBorder = 0;
  IP.maskBorderColor = '#ffffff';
  IP.cacheProperties = IP.cacheProperties.concat('mask', 'maskBorder', 'maskBorderColor');
  IP.stateProperties = IP.stateProperties.concat('mask', 'maskBorder', 'maskBorderColor');

  const HEART = [[50, 88], ['C', 20, 66, 0, 48, 0, 28], ['C', 0, 12, 12, 0, 27, 0], ['C', 37, 0, 45, 5, 50, 14], ['C', 55, 5, 63, 0, 73, 0], ['C', 88, 0, 100, 12, 100, 28], ['C', 100, 48, 80, 66, 50, 88]];
  function polygon(ctx, n, w, h, innerRatio, rot) {
    const steps = innerRatio ? n * 2 : n;
    for (let i = 0; i < steps; i++) {
      const r = innerRatio && i % 2 ? innerRatio : 1;
      const a = rot + (i * Math.PI * 2) / steps;
      const x = (Math.cos(a) * r * w) / 2;
      const y = (Math.sin(a) * r * h) / 2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function maskPath(ctx, kind, w, h) {
    const x = -w / 2;
    const y = -h / 2;
    ctx.beginPath();
    switch (kind) {
      case 'circle':
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'rounded':
        roundRectPath(ctx, x, y, w, h, Math.min(w, h) * 0.14);
        break;
      case 'heart': {
        const sx = w / 100;
        const sy = h / 88;
        const P = (px, py) => [x + px * sx, y + py * sy];
        ctx.moveTo(...P(HEART[0][0], HEART[0][1]));
        for (const c of HEART.slice(1)) ctx.bezierCurveTo(...P(c[1], c[2]), ...P(c[3], c[4]), ...P(c[5], c[6]));
        ctx.closePath();
        break;
      }
      case 'star':
        polygon(ctx, 5, w, h, 0.45, -Math.PI / 2);
        break;
      case 'hexagon':
        polygon(ctx, 6, w, h, 0, 0);
        break;
      case 'arch': {
        const rr = Math.min(w / 2, h / 2);
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + rr);
        ctx.ellipse(0, y + rr, w / 2, rr, 0, Math.PI, 0);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        break;
      }
      default:
        ctx.rect(x, y, w, h);
    }
  }
  const origImgRender = IP._render;
  IP._render = function (ctx) {
    if (!this.mask) return origImgRender.call(this, ctx);
    ctx.save();
    maskPath(ctx, this.mask, this.width, this.height);
    ctx.clip();
    origImgRender.call(this, ctx);
    if (this.maskBorder > 0) {
      // Drawn inside the shape so it never spills past the photo.
      ctx.lineWidth = (this.maskBorder / 100) * Math.min(this.width, this.height) * 2;
      ctx.strokeStyle = this.maskBorderColor;
      maskPath(ctx, this.mask, this.width, this.height);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---------- Smart background removal ----------
  /**
   * Make the plain background around a picture transparent: starting from the
   * edges, flood-fill every connected pixel that is close to the edge colour.
   * Interior areas of the same colour (e.g. white eyes in a logo) are kept.
   * Resolves to a PNG Blob, or null when the edges are not a plain colour.
   */
  async function removeBackground(source, tolerance = 42) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const c = fabric.util.createCanvasElement();
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Edge colour: average of opaque border pixels; bail out if they vary a lot.
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    for (const p of border) {
      if (d[p * 4 + 3] < 16) continue;
      r += d[p * 4];
      g += d[p * 4 + 1];
      b += d[p * 4 + 2];
      n++;
    }
    if (!n) return null;
    r /= n;
    g /= n;
    b /= n;
    const dist = (p) => Math.abs(d[p * 4] - r) + Math.abs(d[p * 4 + 1] - g) + Math.abs(d[p * 4 + 2] - b);
    const near = border.filter((p) => d[p * 4 + 3] >= 16 && dist(p) < tolerance * 1.5).length;
    if (near < n * 0.5) return null;

    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    for (const p of border) {
      if (!seen[p] && (d[p * 4 + 3] < 16 || dist(p) < tolerance)) {
        seen[p] = 1;
        stack[top++] = p;
      }
    }
    while (top) {
      const p = stack[--top];
      d[p * 4 + 3] = 0;
      const x = p % w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbours) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if (d[q * 4 + 3] < 16 || dist(q) < tolerance) {
          seen[q] = 1;
          stack[top++] = q;
        } else {
          seen[q] = 2; // edge pixel: soften below
        }
      }
    }
    // Soften the outline: edge pixels that are still fairly close to the background become semi-transparent.
    for (let p = 0; p < w * h; p++) {
      if (seen[p] !== 2) continue;
      const k = dist(p) / (tolerance * 2.5);
      if (k < 1) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.max(0.15, k));
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  window.POD_FX = { maskPath, roundRectPath, removeBackground };
})();
