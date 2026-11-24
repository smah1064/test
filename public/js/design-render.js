/* Places a ready-made design on any product without the editor, and makes the
 * same files the editor makes for the cart: the 300 DPI print PNG (with
 * bleed), the mockup preview, the SVG and the design layer for the live
 * previews. Works in the 500 x 600 mockup space like the editor.
 */
(function () {
  'use strict';
  fabric.Object.NUM_FRACTION_DIGITS = 8; // exact sizes, like the editor

  const W = 500;
  const H = 600;
  const TARGET_DPI = 300;
  const MAX_PRINT_PIXELS = 16e6;
  const MAX_PRINT_SIDE = 8000;
  const EXTRA_PROPS = ['name', 'selectable', 'evented', 'curve', 'mask', 'maskBorder', 'maskBorderColor', 'lockRatio', 'bgShape', 'textFx', 'fxBase', 'boosted'];
  const inkFor = (hex) => (POD.luminance(hex) < 0.45 ? '#ffffff' : '#16181d');

  /** Trim, bleed and safe zone in mockup units (same as the editor). */
  function rects(side) {
    const a = side.printArea;
    const u = a.w / side.printWidthIn;
    const b = (side.bleedIn || 0) * u;
    return {
      u, b,
      trim: a,
      bleed: { x: a.x - b, y: a.y - b, w: a.w + 2 * b, h: a.h + 2 * b, rx: a.rx ? a.rx + b : 0 },
    };
  }
  const clipRect = (a) => new fabric.Rect({
    left: a.x, top: a.y, width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0,
    originX: 'left', originY: 'top', strokeWidth: 0, absolutePositioned: true,
  });
  /** Fit objects designed for one print area into another (keeps proportions, centred). */
  function remap(objects, from, to) {
    const s = Math.min(to.w / from.w, to.h / from.h);
    const fcx = from.x + from.w / 2;
    const fcy = from.y + from.h / 2;
    const tcx = to.x + to.w / 2;
    const tcy = to.y + to.h / 2;
    return objects.map((o) => (o.name === 'Background' && o.type === 'rect'
      ? { ...o, left: tcx, top: tcy, width: to.w, height: to.h, scaleX: 1, scaleY: 1, angle: 0, rx: to.rx || 0, ry: to.rx || 0 }
      : { ...o, left: tcx + (o.left - fcx) * s, top: tcy + (o.top - fcy) * s, scaleX: (o.scaleX || 1) * s, scaleY: (o.scaleY || 1) * s }));
  }

  /** The design's fabric objects, placed in a product side's print area. */
  async function placeDesign(design, product, side, colorHex) {
    const surface = product.surface || colorHex;
    if (design.kind === 'template') {
      return window.POD_DESIGN.buildTemplate({ id: design.id, items: design.items, aspect: design.aspect }, side.printArea, inkFor(surface), { inset: (side.safeIn || 0) * (side.printArea.w / side.printWidthIn) });
    }
    // Made on another product: in this one's ready-design zone (the calendar's top half, a folder's front), as templates are.
    const to = design.product && design.product !== product.id ? window.POD_DESIGN.readyArea(side.printArea, null) : side.printArea;
    const objs = remap(design.objects || [], design.area || side.printArea, to);
    await window.POD_DESIGN.ensureFontsFor(objs);
    return new Promise((resolve) => fabric.util.enlivenObjects(objs, resolve));
  }

  const imgCache = new Map();
  function fabricImage(url) {
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((resolve, reject) => fabric.Image.fromURL(url, (img, failed) => (failed || !img ? reject(new Error('image')) : resolve(img)))));
    }
    return imgCache.get(url);
  }
  /** The product picture behind the design: the recoloured photo, or the drawn mockup. */
  async function background(product, side, hex) {
    const P = window.POD_PHOTOS;
    const cfg = !side.wrap && P && P.forSide ? P.forSide(product.id, side.id) : null; // all-round prints: unrolled
    if (cfg) {
      try {
        const at = P.placement(cfg, side.printArea);
        const [cv, dark] = await Promise.all([P.render(cfg, hex, { width: 1000, cutout: true }), cfg.keepDark ? P.darkOverlay(cfg, 1000) : null]);
        const image = (el) => new fabric.Image(el, { originX: 'left', originY: 'top', left: at.x, top: at.y, scaleX: at.kx / el.scale, scaleY: at.ky / el.scale });
        return { bg: image(cv), overlay: dark ? image(dark) : null };
      } catch (e) { /* drawn mockup below */ }
    }
    const [bg, overlay] = await Promise.all([
      fabricImage(POD.mockupUrl(side, hex)),
      side.overlay ? fabricImage(POD.mockupUrl(side, hex, 'overlay')) : null,
    ]);
    const clone = (img) => img && new fabric.Image(img.getElement(), { originX: 'left', originY: 'top', left: 0, top: 0 });
    return { bg: clone(bg), overlay: clone(overlay) };
  }

  /**
   * A canvas holding the design on one side of a product, ready to export.
   * With a garment size, the design goes in that size's print box (the same
   * print in cm, so smaller on the photo of a bigger size), as in the editor.
   */
  async function stage(design, product, side, color, sizeId) {
    // The size's print box (garments) and physical inches (posters, canvases: same shape, bigger print).
    const size = sizeId ? product.sizes.find((z) => z.id === sizeId) : null;
    const k = (size && size.printScale) || 1;
    const sized = sizeId ? { ...side, printArea: POD.sizedArea(product, side, sizeId), printWidthIn: side.printWidthIn * k, ...(side.printHeightIn ? { printHeightIn: side.printHeightIn * k } : {}) } : side;
    const canvas = new fabric.StaticCanvas(null, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false });
    const objects = await placeDesign(design, product, sized, color.hex);
    // Laser products: in the material's tone, cut text joined up (as the editor shows it).
    if (product.laser) {
      const ink = color.ink || '#000000';
      const bridge = product.laser.kind === 'cut' ? ((product.laser.bridgeMm || 0) / 25.4) * rects(sized).u : 0;
      objects.forEach((o) => window.POD_FX.laserTone(o, { ink, light: POD.luminance(ink) > POD.luminance(color.hex), bridge }));
    }
    objects.forEach((o) => canvas.add(o));
    const pics = await background(product, side, color.hex); // the photo sits on the standard print area
    return { canvas, product, side: sized, color, objects, pics, R: rects(sized) };
  }
  /** Draw with or without the product picture, each object clipped to `clip`. */
  function withMode(st, { pictures, clip }, fn) {
    const c = st.canvas;
    c.backgroundImage = pictures ? st.pics.bg : null;
    c.overlayImage = pictures ? st.pics.overlay : null;
    c.getObjects().forEach((o) => { o.clipPath = clip ? clipRect(clip) : null; o.dirty = true; });
    try {
      return fn(c);
    } finally {
      c.backgroundImage = null;
      c.overlayImage = null;
    }
  }
  const toBlob = (el, type = 'image/png', q) => new Promise((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error('export'))), type, q));

  /** Transparent print file: artwork + bleed at up to 300 DPI. */
  function printBlob(st) {
    const { bleed, u } = st.R;
    const mult = Math.min(TARGET_DPI / u, Math.sqrt(MAX_PRINT_PIXELS / (bleed.w * bleed.h)), MAX_PRINT_SIDE / Math.max(bleed.w, bleed.h));
    const el = withMode(st, { pictures: false, clip: bleed }, (c) => c.toCanvasElement(mult, { left: bleed.x, top: bleed.y, width: bleed.w, height: bleed.h }));
    // Canvas prints: the band round the front becomes the chosen edge (mirror, white, black).
    if (st.product.model && st.product.model.type === 'canvas') POD.canvasEdges(el, st.R.b * mult, st.color.id);
    return toBlob(el);
  }
  /** The product with the design, as the cart and production queue show it. */
  function previewBlob(st, mult = 1.2) {
    return toBlob(withMode(st, { pictures: true, clip: st.R.trim }, (c) => c.toCanvasElement(mult)));
  }
  /** A picture for product cards and the design page; `zoom` crops a square around the print area. */
  function picture(st, mult = 1, zoom = 0) {
    const region = (() => {
      if (!zoom) return undefined;
      const a = st.R.trim;
      const size = Math.min(W, H, Math.max(a.w, a.h) * zoom);
      const left = Math.max(0, Math.min(W - size, a.x + a.w / 2 - size / 2));
      const top = Math.max(0, Math.min(H - size, a.y + a.h / 2 - size / 2));
      return { left, top, width: size, height: size };
    })();
    return withMode(st, { pictures: true, clip: st.R.trim }, (c) => c.toCanvasElement(mult, region));
  }
  /**
   * A print all the way round a mug, on the photo of the mug seen from opposite the handle
   * (photo-mockups.js "…:wrap"): each column of the visible face shows the part of the
   * unrolled print that faces the camera there (as the preview window does). Null without a photo.
   */
  async function wrapPicture(st) {
    const P = window.POD_PHOTOS;
    const cfg = P && P[`${st.product.id}:${st.side.id}:wrap`];
    if (!cfg || !cfg.cyl) return null;
    let photo;
    try {
      photo = await P.render(cfg, st.color.hex, { width: 1000, cutout: true });
    } catch (e) {
      return null;
    }
    const k = photo.scale || photo.width / 1000;
    const out = document.createElement('canvas');
    out.width = photo.width;
    out.height = photo.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(photo, 0, 0);
    const a = st.R.trim;
    const ds = 3;
    const layer = designLayer(st, ds);
    const { cx, R } = cfg.cyl;
    const rw = cfg.rect.w;
    const rx = cfg.rect.cx - rw / 2;
    const rh = (rw * a.h) / a.w;
    for (let px = Math.ceil((cx - R) * k); px < (cx + R) * k; px++) {
      const t = (px / k - cx) / R;
      if (Math.abs(t) >= 0.999) continue;
      const arc = cx + Math.asin(t) * R; // where this column sits on the unrolled print (photo units)
      const bx = a.x + ((arc - rx) / rw) * a.w;
      if (bx < a.x || bx >= a.x + a.w) continue;
      const step = (a.w / rw) / (k * Math.sqrt(1 - t * t)); // print units per screen pixel here
      ctx.drawImage(layer, bx * ds, a.y * ds, Math.max(1, step * ds), a.h * ds, px, cfg.rect.top * k, 1, rh * k);
    }
    return out;
  }
  /**
   * The whole product with the design, as a square around the product itself (found from what
   * is drawn: everything round it is see-through), with a small margin: small products fill the
   * card, big ones (bags, posters, notebooks) show whole instead of just the printed part.
   */
  async function productPicture(st, mult = 1.2) {
    const full = (st.side.wrap && (await wrapPicture(st))) || withMode(st, { pictures: true, clip: st.R.trim }, (c) => c.toCanvasElement(mult));
    const w = full.width;
    const h = full.height;
    const d = full.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (d[(y * w + x) * 4 + 3] < 40) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return full;
    const size = Math.ceil(Math.max(x1 - x0, y1 - y0) * 1.08);
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    out.getContext('2d').drawImage(full, Math.round(size / 2 - (x0 + x1) / 2), Math.round(size / 2 - (y0 + y1) / 2));
    return out;
  }
  /** A see-through layer for a side with nothing printed (the live previews need every side). */
  function emptyEntry(product, side, color, scale = 3) {
    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = H * scale;
    return { side, rects: rects(side), design: cv, designScale: scale, hasDesign: false, base: POD.mockupUrl(side, color.hex), overlay: side.overlay ? POD.mockupUrl(side, color.hex, 'overlay') : null };
  }
  /** Vector SVG at the print's physical size, fonts embedded. */
  async function svgText(st) {
    const { bleed, b, u } = st.R;
    const s = st.side;
    fabric.Text.prototype.svgUnitsPerInch = u;
    const svg = withMode(st, { pictures: false, clip: null }, (c) => c.toSVG({ viewBox: { x: bleed.x, y: bleed.y, width: bleed.w, height: bleed.h }, width: `${+(bleed.w / u).toFixed(4)}in`, height: `${+(bleed.h / u).toFixed(4)}in` }));
    const fonts = await window.POD_FX.fontFaceCss(st.canvas.getObjects());
    const note = `<!-- ebda3 artwork: ${s.printWidthIn} x ${s.printHeightIn} in${b ? ` + ${s.bleedIn} in bleed each side` : ''}. sRGB. -->`;
    return svg.replace(/<defs>/, `${note}<defs><style>${fonts}</style>`);
  }
  /** Design layer only, in mockup coordinates, for the realistic and 3D previews. */
  function designLayer(st, scale = 3, clip = st.R.trim) {
    return withMode(st, { pictures: false, clip }, (c) => c.toCanvasElement(scale, { left: 0, top: 0, width: W, height: H }));
  }
  /** The objects as the editor saves them. */
  function serialize(st) {
    return st.canvas.toObject(EXTRA_PROPS).objects.map((o) => { delete o.clipPath; return o; });
  }

  /** Add a ready-made design on a product to the cart: same upload steps as the editor. */
  async function addToCart({ design, product, color, size, onProgress = () => {} }) {
    // A pair whose second piece costs nothing extra (couple mugs): the design goes on both pieces.
    const printSides = product.extraSidePrice === 0 && product.sides.length > 1 ? product.sides : [product.sides[0]];
    const files = {};
    const sidesBody = {};
    for (const side of printSides) {
      const st = await stage(design, product, side, color, size.id);
      onProgress('render');
      files[`${side.id}-print.png`] = await printBlob(st);
      files[`${side.id}-preview.png`] = await previewBlob(st);
      files[`${side.id}-design.svg`] = new Blob([await svgText(st)], { type: 'image/svg+xml' });
      sidesBody[side.id] = { editor: { version: fabric.version, objects: serialize(st), library: design.id } };
    }
    onProgress('upload');
    const created = await POD.api('/api/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, color: color.id, size: size.id, sides: sidesBody }),
    });
    await Promise.all(created.files.map(async (name) => {
      const res = await POD.putFile(`/api/designs/${created.id}/files/${encodeURIComponent(name)}`, created.uploadToken, files[name]);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || POD.t('msg.requestFailed', { status: res.status }));
    }));
    onProgress('finish');
    const done = await POD.api(`/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
    const cart = POD.getCart();
    cart.push({
      designId: done.id,
      productId: done.productId,
      productName: done.productName,
      colorName: done.color.name,
      sizeLabel: done.size.label,
      sides: done.sides.map((s) => s.name),
      price: done.price,
      previewUrl: done.previewUrl,
      addedAt: new Date().toISOString(),
    });
    POD.setCart(cart);
    return done;
  }

  window.POD_RENDER = { W, H, rects, remap, placeDesign, stage, printBlob, previewBlob, picture, productPicture, emptyEntry, svgText, designLayer, serialize, addToCart, inkFor };
})();
