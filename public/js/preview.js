/* Live preview: realistic mockups, 3D view and print-colour (CMYK) proof.
 *
 * Realistic mode bends the design over the product: fabric folds for
 * clothing, a cylinder wrap for mugs and bottles, a puffed surface for
 * cushions, and lighting/texture for flat items. Each output pixel looks up
 * where it comes from in the flat design (displacement) and is then lit
 * (shading), so the artwork follows the product's surface.
 */
(function () {
  'use strict';

  const { t, tr, esc, toast } = POD;
  const S = 2; // render at 2x the 500 x 600 mockup space
  const W = 500;
  const H = 600;

  const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // ---------- Procedural noise ----------
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Height map of soft fabric folds over the 500 x 600 garment space. */
  function foldField(amount) {
    const h = new Float32Array(W * H);
    const g = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Long vertical drape folds that bend gently and grow towards the hem.
        const drape = Math.sin((x - 250) * 0.034 + 1.6 * Math.sin(y * 0.007) + 3 * vnoise(x * 0.004, y * 0.003)) * (0.3 + 0.7 * Math.min(1, Math.max(0, (y - 150) / 360)));
        // Diagonal pull lines from the armpits.
        const armL = Math.sin((x * 0.55 + y * 0.83) * 0.06) * g(x, y, 170, 245, 45);
        const armR = Math.sin((-x * 0.55 + y * 0.83) * 0.06 + 1) * g(x, y, 330, 245, 45);
        const hem = Math.sin(x * 0.07 + 1.3) * g(x, y, 250, 525, 55) * 0.5;
        h[y * W + x] = (drape + armL * 0.8 + armR * 0.8 + hem) * amount;
      }
    }
    return h;
  }
  const fieldCache = new Map();
  function folds(amount) {
    if (!fieldCache.has(amount)) fieldCache.set(amount, foldField(amount));
    return fieldCache.get(amount);
  }

  // ---------- Surface models ----------
  // Each returns, for a point in mockup units: where to sample the flat design
  // (sx, sy), a lighting multiplier and a specular highlight.
  const LIGHT = (() => {
    const l = [-0.45, -0.65, 1];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
  })();

  function surfaceFor(product, rects) {
    const type = product.model.type;
    const a = rects.trim;
    const cxPrint = a.x + a.w / 2;

    if (type === 'mug' || type === 'bottle') {
      const mug = type === 'mug';
      const cx = mug ? 230 : 250;
      const R = mug ? 110 : 100;
      const top = mug ? 150 : 142;
      const bottom = mug ? 470 : 552;
      const e = R * 0.12;
      return {
        // Below the rim: outside the mug's top opening (an ellipse) and above the base.
        body: (x, y) => Math.abs(x - cx) < R && y > top && y < bottom && (!mug || ((x - cx) / (R + 2)) ** 2 + ((y - 150) / 20) ** 2 > 1),
        at(x, y) {
          const tt = (x - cx) / R;
          if (Math.abs(tt) >= 1) return null;
          const phi = Math.asin(tt);
          const shade = Math.min(1.06, Math.max(0.45, 0.66 + 0.42 * Math.cos(phi + 0.35)));
          const spec = (mug ? 0.42 : 0.55) * Math.exp(-(((phi + 0.6) / (mug ? 0.08 : 0.12)) ** 2)) + (mug ? 0 : 0.15 * Math.exp(-(((phi - 0.9) / 0.1) ** 2)));
          return { sx: cxPrint + phi * R, sy: y + e * (1 - Math.cos(phi)), shade, spec };
        },
      };
    }

    if (type === 'pillow') {
      const cx = 250;
      const cy = 300;
      const hx = 185;
      const hy = 200;
      return {
        body: () => true,
        at(x, y) {
          const rx = (x - cx) / hx;
          const ry = (y - cy) / hy;
          const puff = Math.max(0, (1 - rx * rx) * (1 - ry * ry));
          const k = 1 - 0.07 * puff;
          return { sx: cx + (x - cx) * k, sy: cy + (y - cy) * k, shade: 0.8 + 0.24 * puff - 0.07 * rx - 0.09 * ry, spec: 0.06 * puff * Math.max(0, -rx - ry) };
        },
      };
    }

    if (type === 'card') {
      if (product.id === 'cap') {
        const cx = 250;
        const R = 150;
        return {
          body: () => true,
          at(x, y) {
            const tt = (x - cx) / R;
            if (Math.abs(tt) >= 1) return null;
            const phi = Math.asin(tt);
            return { sx: cx + phi * R, sy: y - 10 * (1 - Math.cos(phi)) + 4 * Math.sin(((y - 210) / 90) * Math.PI), shade: 0.72 + 0.32 * Math.cos(phi + 0.3), spec: 0 };
          },
        };
      }
      const amount = product.id === 'tote' ? 0.9 : 1.6;
      const field = folds(amount);
      const D = 22; // how far the artwork is pushed by the folds
      const K = 7; // how strongly folds catch the light
      return {
        body: () => true,
        at(x, y) {
          const xi = Math.min(W - 2, Math.max(1, Math.round(x)));
          const yi = Math.min(H - 2, Math.max(1, Math.round(y)));
          const hgt = field[yi * W + xi];
          const gx = (field[yi * W + xi + 1] - field[yi * W + xi - 1]) / 2;
          const gy = (field[(yi + 1) * W + xi] - field[(yi - 1) * W + xi]) / 2;
          const nl = Math.hypot(gx * K, gy * K, 1);
          const dot = (-gx * K * LIGHT[0] - gy * K * LIGHT[1] + LIGHT[2]) / nl;
          // Valleys of the folds are a little darker (ambient occlusion).
          const torso = 0.95 + 0.05 * Math.cos(Math.min(Math.PI, Math.abs(x - 250) / 110)); // the body is rounder than a flat sheet
          // Ridges facing the light get a soft sheen, which is what makes folds visible on dark fabric.
          const sheen = Math.max(0, dot - LIGHT[2]) * 0.22;
          return { sx: x - gx * D, sy: y - gy * D, shade: (0.68 + 0.38 * dot + 0.03 * (hgt / amount)) * torso, spec: sheen };
        },
      };
    }

    // Flat products: soft light falloff, plus a gloss stripe on hard plastic.
    const glossy = type === 'case';
    return {
      body: () => true,
      at(x, y) {
        const shade = 1.02 - 0.06 * ((x - 250) / 250) - 0.08 * ((y - 300) / 300);
        const spec = glossy ? 0.16 * Math.exp(-((((x - 160) - (y - 85) * 0.35 - 120) / 22) ** 2)) : 0;
        return { sx: x, sy: y, shade, spec };
      },
    };
  }

  /** Render the design on the product with folds/curvature, lighting and texture. */
  async function renderRealistic(product, entry) {
    const [baseImg, overImg] = await Promise.all([loadImg(entry.base), entry.overlay ? loadImg(entry.overlay) : null]);
    const Wd = W * S;
    const Hd = H * S;
    const out = document.createElement('canvas');
    out.width = Wd;
    out.height = Hd;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(baseImg, 0, 0, Wd, Hd);
    const base = ctx.getImageData(0, 0, Wd, Hd);
    const bd = base.data;
    const dctx = entry.design.getContext('2d', { willReadFrequently: true });
    const dd = dctx.getImageData(0, 0, Wd, Hd).data;

    const surf = surfaceFor(product, entry.rects);
    const fabric = product.model.material === 'fabric';
    const paper = product.model.material === 'paper';
    const r = entry.rects.bleed;
    const m = 20; // design can be displaced a little beyond the print edge
    const x0 = Math.max(0, Math.floor((r.x - m) * S));
    const x1 = Math.min(Wd, Math.ceil((r.x + r.w + m) * S));
    const y0 = Math.max(0, Math.floor((r.y - m) * S));
    const y1 = Math.min(Hd, Math.ceil((r.y + r.h + m) * S));

    const sample = (fx, fy, outArr) => {
      const xa = Math.floor(fx);
      const ya = Math.floor(fy);
      if (xa < 0 || ya < 0 || xa >= Wd - 1 || ya >= Hd - 1) return false;
      const ax = fx - xa;
      const ay = fy - ya;
      const i00 = (ya * Wd + xa) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + Wd * 4;
      const i11 = i01 + 4;
      // Interpolate premultiplied colour so soft edges don't pick up dark fringes.
      const a00 = dd[i00 + 3];
      const a10 = dd[i10 + 3];
      const a01 = dd[i01 + 3];
      const a11 = dd[i11 + 3];
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      for (let c = 0; c < 3; c++) {
        outArr[c] = (dd[i00 + c] * a00 * w00 + dd[i10 + c] * a10 * w10 + dd[i01 + c] * a01 * w01 + dd[i11 + c] * a11 * w11) / 255;
      }
      outArr[3] = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
      return true;
    };
    const px = [0, 0, 0, 0];

    for (let y = 0; y < Hd; y++) {
      const my = y / S;
      for (let x = 0; x < Wd; x++) {
        const i = (y * Wd + x) * 4;
        if (bd[i + 3] === 0) continue;
        const mx = x / S;
        const g = surf.body(mx, my) ? surf.at(mx, my) : null;
        if (!g) continue;
        const grain = fabric ? (hash(x, y) - 0.5) * 0.07 + 0.025 * Math.sin(x * 1.7) * Math.sin(y * 1.7) : paper ? (hash(x, y) - 0.5) * 0.03 : 0;
        const k = g.shade + grain;
        const sp = g.spec * 255;
        const br = bd[i];
        const bg = bd[i + 1];
        const bb = bd[i + 2];
        const baseLum = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
        let r0 = br * k + sp;
        let g0 = bg * k + sp;
        let b0 = bb * k + sp;
        if (x >= x0 && x < x1 && y >= y0 && y < y1 && sample(g.sx * S, g.sy * S, px) && px[3] > 0) {
          const al = px[3] / 255;
          // A little of the fabric shows through the ink on light garments.
          const absorb = fabric ? 0.1 : 0;
          const ink = (c) => (c * (1 - absorb) + (c * baseLum) * absorb) * k + sp * 0.8;
          r0 = r0 * (1 - al) + ink(px[0] / al) * al;
          g0 = g0 * (1 - al) + ink(px[1] / al) * al;
          b0 = b0 * (1 - al) + ink(px[2] / al) * al;
        }
        bd[i] = r0;
        bd[i + 1] = g0;
        bd[i + 2] = b0;
      }
    }
    ctx.putImageData(base, 0, 0);
    if (overImg) ctx.drawImage(overImg, 0, 0, Wd, Hd);
    return out;
  }

  // ---------- Modal ----------
  const $ = (id) => document.getElementById(id);
  let state = null;
  let three = null;

  function close() {
    $('pv').hidden = true;
    if (three) {
      three.dispose();
      three = null;
    }
    state = null;
  }

  async function realisticFor(sideId) {
    if (!state.real[sideId]) {
      const entry = state.sides.find((s) => s.side.id === sideId);
      state.real[sideId] = renderRealistic(state.product, entry);
    }
    return state.real[sideId];
  }

  function setBody(html) {
    $('pv-body').innerHTML = html;
  }

  async function show() {
    const { tab, sideId } = state;
    document.querySelectorAll('[data-pv-tab]').forEach((b) => b.classList.toggle('active', b.dataset.pvTab === tab));
    const multi = state.sides.length > 1 && tab !== '3d';
    $('pv-sides').hidden = !multi;
    $('pv-sides').innerHTML = state.sides.map((s) => `<button class="side-tab ${s.side.id === sideId ? 'active' : ''}" data-pv-side="${s.side.id}">${esc(tr(s.side.name))}</button>`).join('');
    $('pv-spin-wrap').hidden = tab !== '3d';
    $('pv-hint').textContent = tab === '3d' ? t('pv.drag') : tab === 'proof' ? t('pv.proofNote') : '';
    if (three && tab !== '3d') {
      three.dispose();
      three = null;
    }
    setBody(`<div class="pv-loading"><div class="spinner"></div>${esc(t('pv.loading'))}</div>`);
    const token = (state.token = (state.token || 0) + 1);
    try {
      if (tab === 'real') {
        const cv = await realisticFor(sideId);
        if (token !== state.token) return;
        setBody('');
        cv.className = 'pv-canvas';
        $('pv-body').appendChild(cv);
      } else if (tab === 'proof') {
        const cv = await realisticFor(sideId);
        const small = document.createElement('canvas');
        const sc = Math.min(1, 700 / cv.width);
        small.width = Math.round(cv.width * sc);
        small.height = Math.round(cv.height * sc);
        small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
        const blob = await new Promise((r) => small.toBlob(r, 'image/png'));
        const res = await fetch('/api/proof', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
        if (!res.ok) throw new Error(t('pv.proofFailed'));
        const url = URL.createObjectURL(await res.blob());
        if (token !== state.token) return;
        setBody(`<div class="pv-proof">
          <figure><img src="${small.toDataURL('image/png')}" alt=""><figcaption>${esc(t('pv.screen'))}</figcaption></figure>
          <figure><img src="${url}" alt=""><figcaption>${esc(t('pv.print'))}</figcaption></figure>
        </div>`);
      } else {
        const textures = {};
        for (const s of state.sides) textures[s.side.id] = { design: s.design, real: await realisticFor(s.side.id), rects: s.rects, hasDesign: s.hasDesign, baseImg: await loadImg(s.base) };
        if (token !== state.token) return;
        let mod;
        try {
          mod = await import('/js/preview3d.js');
        } catch (e) {
          throw new Error(t('pv.no3d'));
        }
        setBody('<div class="pv-3d" id="pv-3d"></div>');
        three = mod.mount($('pv-3d'), { product: state.product, color: state.color, textures, spin: $('pv-spin').checked });
        if (!three) throw new Error(t('pv.no3d'));
      }
    } catch (e) {
      if (token === state.token) setBody(`<p class="muted" style="padding:40px;text-align:center">${esc(e.message)}</p>`);
    }
  }

  function download() {
    const name = `${state.product.id}-${state.tab}.png`;
    const save = (blob) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (state.tab === '3d' && three) three.snapshot().then(save);
    else realisticFor(state.sideId).then((cv) => cv.toBlob(save, 'image/png'));
  }

  function open(data) {
    state = { ...data, tab: 'real', sideId: data.startSide, real: {} };
    if (!data.sides.find((s) => s.side.id === state.sideId && s.hasDesign)) {
      const withDesign = data.sides.find((s) => s.hasDesign);
      if (withDesign) state.sideId = withDesign.side.id;
    }
    $('pv').hidden = false;
    show();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('pv-close').addEventListener('click', close);
    $('pv').addEventListener('click', (e) => { if (e.target.id === 'pv') close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state) close(); });
    document.querySelectorAll('[data-pv-tab]').forEach((b) => b.addEventListener('click', () => {
      if (!state || state.tab === b.dataset.pvTab) return;
      state.tab = b.dataset.pvTab;
      show();
    }));
    $('pv-sides').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pv-side]');
      if (!b || !state) return;
      state.sideId = b.dataset.pvSide;
      show();
    });
    $('pv-spin').addEventListener('change', (e) => three && three.setSpin(e.target.checked));
    $('pv-download').addEventListener('click', () => {
      try {
        if (state) download();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  window.POD_PREVIEW = { open, renderRealistic };
})();
