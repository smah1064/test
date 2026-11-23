/* Product design editor built on Fabric.js.
 *
 * The canvas works in the 500 x 600 mockup coordinate space and is zoomed to
 * fit the screen. Each product side keeps its own list of objects and its own
 * undo history. On "Add to cart" every designed side is exported twice:
 *   - a transparent, print-ready PNG of just the print area at ~150 DPI
 *   - a mockup preview PNG for the cart, order page and production queue
 */
(async function () {
  'use strict';

  const W = 500;
  const H = 600;
  const TARGET_DPI = 150;
  const MAX_PRINT_PX = 4000;
  const MAX_UPLOAD_PX = 3000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const HISTORY_LIMIT = 60;
  const SNAP_PX = 7;
  const EXTRA_PROPS = ['name', 'selectable', 'evented'];
  const $ = (id) => document.getElementById(id);
  const { esc, money, toast, t, tr } = POD;
  const D = window.POD_DESIGN;
  const isText = (o) => o && (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox');

  // ---------- Fabric defaults ----------
  fabric.Object.prototype.objectCaching = false;
  fabric.enableGLFiltering = false; // canvas filters work on images of any size
  Object.assign(fabric.Object.prototype, {
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#ff5a36',
    borderColor: '#ff5a36',
    cornerSize: 12,
    touchCornerSize: 28,
    cornerStyle: 'circle',
    borderScaleFactor: 1.5,
    padding: 4,
    originX: 'center',
    originY: 'center',
  });

  // ---------- Load catalog and (optionally) a saved design ----------
  let catalog;
  try {
    catalog = await POD.loadCatalog();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const products = catalog.products;
  const params = new URLSearchParams(location.search);

  const st = {
    product: products.find((p) => p.id === params.get('product')) || products[0],
    colorId: null,
    sizeId: null,
    side: null,
    designs: {}, // sideId -> serialized objects
    history: {}, // sideId -> { stack: [json], i }
    editingCartIndex: null,
    preview: false,
    exporting: false,
    silent: false,
    dirty: false,
    zoom: 1, // relative to "fit to screen"
    guides: null,
  };

  if (params.get('design')) {
    try {
      const saved = await POD.api('/api/designs/' + encodeURIComponent(params.get('design')));
      st.product = products.find((p) => p.id === saved.productId) || st.product;
      st.colorId = saved.color.id;
      st.sizeId = saved.size.id;
      for (const [sideId, data] of Object.entries(saved.editor)) {
        st.designs[sideId] = await blobifyImages(data.objects || []);
      }
      const idx = Number(params.get('cart'));
      const cart = POD.getCart();
      if (params.get('cart') !== null && Number.isInteger(idx) && cart[idx] && cart[idx].designId === saved.id) st.editingCartIndex = idx;
    } catch (e) {
      toast(t('msg.openFailed', { msg: e.message }), 'error');
    }
  }
  st.colorId = st.product.colors.some((c) => c.id === st.colorId) ? st.colorId : st.product.colors[0].id;
  st.sizeId = st.product.sizes.some((s) => s.id === st.sizeId) ? st.sizeId : st.product.sizes[0].id;
  st.side = st.product.sides.find((s) => (st.designs[s.id] || []).length)?.id || st.product.sides[0].id;

  const sideDef = (id = st.side) => st.product.sides.find((s) => s.id === id);
  const area = (id) => sideDef(id).printArea;
  const color = () => st.product.colors.find((c) => c.id === st.colorId);
  const surfaceHex = () => st.product.surface || color().hex;
  const inkFor = (hex) => (POD.luminance(hex) < 0.45 ? '#ffffff' : '#16181d');

  // ---------- Canvas ----------
  const canvas = new fabric.Canvas('design-canvas', {
    width: W,
    height: H,
    preserveObjectStacking: true,
    controlsAboveOverlay: true,
    stopContextMenu: true,
    fireRightClick: false,
  });

  function fit() {
    const stage = $('stage');
    const base = Math.max(0.3, Math.min((stage.clientWidth - 32) / W, (stage.clientHeight - 32) / H, 1.6));
    const z = base * st.zoom;
    canvas.setDimensions({ width: Math.round(W * z), height: Math.round(H * z) });
    canvas.setZoom(z);
    $('zoom-label').textContent = Math.round(st.zoom * 100) + '%';
    canvas.requestRenderAll();
  }
  new ResizeObserver(() => fit()).observe($('stage'));
  const setZoom = (z) => {
    st.zoom = Math.min(4, Math.max(0.5, z));
    fit();
  };
  $('zoom-in').addEventListener('click', () => setZoom(st.zoom * 1.25));
  $('zoom-out').addEventListener('click', () => setZoom(st.zoom / 1.25));
  $('zoom-fit').addEventListener('click', () => setZoom(1));

  function clipRect(a) {
    return new fabric.Rect({
      left: a.x, top: a.y, width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0,
      originX: 'left', originY: 'top', strokeWidth: 0, absolutePositioned: true,
    });
  }

  // Print-area guide and snap lines, drawn on top while editing.
  canvas.on('after:render', (opt) => {
    if (st.preview || st.exporting) return;
    const ctx = (opt && opt.ctx) || canvas.contextContainer;
    const a = area();
    const vt = canvas.viewportTransform;
    const px = 1 / vt[0];
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(255, 90, 54, .9)';
    ctx.beginPath();
    if (ctx.roundRect && a.rx) ctx.roundRect(a.x, a.y, a.w, a.h, a.rx);
    else ctx.rect(a.x, a.y, a.w, a.h);
    ctx.stroke();
    const s = sideDef();
    ctx.font = `600 ${11 * px}px Cairo, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 90, 54, .95)';
    ctx.fillText(t('printArea', { w: POD.num(s.printWidthIn * 2.54), h: POD.num(s.printHeightIn * 2.54) }), a.x, a.y - 6 * px);
    if (st.guides) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#d946ef';
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (const x of st.guides.v) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (const y of st.guides.h) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    ctx.restore();
  });

  // Snap to the centre and edges of the print area while dragging.
  canvas.on('object:moving', (e) => {
    const o = e.target;
    const a = area();
    const th = SNAP_PX / canvas.getZoom();
    const guides = { v: [], h: [] };
    const c = o.getCenterPoint();
    const r = o.getBoundingRect(true, true);
    let dx = 0;
    let dy = 0;
    const tryX = (value, target) => { if (!dx && Math.abs(value - target) < th) { dx = target - value; guides.v.push(target); } };
    const tryY = (value, target) => { if (!dy && Math.abs(value - target) < th) { dy = target - value; guides.h.push(target); } };
    tryX(c.x, a.x + a.w / 2);
    tryX(r.left, a.x);
    tryX(r.left + r.width, a.x + a.w);
    tryY(c.y, a.y + a.h / 2);
    tryY(r.top, a.y);
    tryY(r.top + r.height, a.y + a.h);
    if (dx || dy) o.setPositionByOrigin(new fabric.Point(c.x + dx, c.y + dy), 'center', 'center');
    st.guides = guides.v.length || guides.h.length ? guides : null;
  });
  canvas.on('mouse:up', () => {
    if (st.guides) {
      st.guides = null;
      canvas.requestRenderAll();
    }
  });

  // ---------- Mockup background / overlay ----------
  const imageCache = new Map();
  function fabricImage(url) {
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve, reject) => {
        fabric.Image.fromURL(url, (img, failed) => {
          if (failed || !img) return reject(new Error('Image failed to load'));
          img.set({ originX: 'left', originY: 'top', left: 0, top: 0 });
          resolve(img);
        });
      }));
    }
    return imageCache.get(url);
  }

  let mockupToken = 0;
  async function applyMockup(sideId = st.side) {
    const token = ++mockupToken;
    const side = sideDef(sideId);
    const hex = color().hex;
    const [bg, ov] = await Promise.all([
      fabricImage(POD.mockupUrl(side, hex)),
      side.overlay ? fabricImage(POD.mockupUrl(side, hex, 'overlay')) : null,
    ]);
    if (token !== mockupToken) return;
    canvas.backgroundImage = bg;
    canvas.overlayImage = ov;
    canvas.requestRenderAll();
  }

  // ---------- Serialisation ----------
  function serialize() {
    // canvas.toObject resolves positions of objects inside a multi-selection.
    return canvas.toObject(EXTRA_PROPS).objects.map((o) => {
      delete o.clipPath;
      return o;
    });
  }

  async function loadObjects(objects) {
    await D.ensureFontsFor(objects || []);
    return new Promise((resolve) => {
      fabric.util.enlivenObjects(objects || [], (enlivened) => {
        st.silent = true;
        canvas.discardActiveObject();
        canvas.remove(...canvas.getObjects());
        enlivened.forEach((o) => canvas.add(o));
        st.silent = false;
        canvas.requestRenderAll();
        resolve();
      });
    });
  }

  canvas.on('object:added', (e) => {
    e.target.clipPath = clipRect(area());
    if (!st.silent) commit();
  });
  canvas.on('object:removed', () => !st.silent && commit());
  canvas.on('object:modified', () => commit());
  canvas.on('text:changed', (e) => {
    fixArabic(e.target);
    renderLayers();
    syncTextField();
    scheduleCommit();
  });
  canvas.on('text:editing:exited', () => commit());
  ['selection:created', 'selection:updated', 'selection:cleared'].forEach((ev) => canvas.on(ev, () => { renderProps(); renderLayers(); }));
  canvas.on('object:scaling', updateQuality);
  canvas.on('object:rotating', (e) => { const r = $('p-angle'); if (r) r.value = Math.round(e.target.angle); });

  // ---------- History (per side) ----------
  function hist() {
    return (st.history[st.side] ||= { stack: [], i: -1 });
  }
  function seedHistory() {
    const h = hist();
    if (!h.stack.length) {
      h.stack.push(JSON.stringify(serialize()));
      h.i = 0;
    }
  }
  let commitTimer = null;
  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 350);
  }
  function commit() {
    clearTimeout(commitTimer);
    if (st.silent) return;
    const snap = JSON.stringify(serialize());
    const h = hist();
    if (h.stack[h.i] !== snap) {
      h.stack = h.stack.slice(0, h.i + 1);
      h.stack.push(snap);
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
      h.i = h.stack.length - 1;
      st.dirty = true;
    }
    st.designs[st.side] = JSON.parse(snap);
    refreshChrome();
  }
  async function stepHistory(delta) {
    commit();
    const h = hist();
    const next = h.i + delta;
    if (next < 0 || next >= h.stack.length) return;
    h.i = next;
    await loadObjects(JSON.parse(h.stack[h.i]));
    st.designs[st.side] = JSON.parse(h.stack[h.i]);
    refreshChrome();
    renderProps();
  }

  // Serialise async UI actions so loads never interleave.
  let chain = Promise.resolve();
  const serial = (fn) => (...args) => (chain = chain.then(() => fn(...args)).catch((e) => toast(e.message, 'error')));

  // ---------- Arabic text ----------
  /** Arabic needs right-to-left direction, joined letters (no letter spacing) and an Arabic font. */
  function fixArabic(o) {
    if (!isText(o)) return;
    const arabic = D.ARABIC_RE.test(o.text);
    const props = { direction: arabic ? 'rtl' : 'ltr' };
    if (arabic && o.charSpacing) props.charSpacing = 0;
    if (arabic && D.FONTS.english.includes(o.fontFamily)) {
      props.fontFamily = 'Cairo';
      D.ensureFont('Cairo', o.fontWeight).then(() => { o.initDimensions(); o.setCoords(); canvas.requestRenderAll(); });
    }
    o.set(props);
  }

  // ---------- Adding things ----------
  function addObject(obj, { select = true, shrinkToFit = true } = {}) {
    const a = area();
    obj.set({ originX: 'center', originY: 'center', left: a.x + a.w / 2, top: a.y + a.h / 2 });
    const maxW = a.w * 0.85;
    const maxH = a.h * 0.85;
    if (shrinkToFit && (obj.getScaledWidth() > maxW || obj.getScaledHeight() > maxH)) {
      const s = Math.min(maxW / obj.getScaledWidth(), maxH / obj.getScaledHeight());
      obj.scale((obj.scaleX || 1) * s);
    }
    canvas.add(obj);
    if (select) canvas.setActiveObject(obj);
    obj.setCoords();
    canvas.requestRenderAll();
    closeFlyouts();
    if (st.preview) togglePreview();
  }

  function renderPresets() {
    const groups = { basic: [], arabic: [], english: [] };
    D.TEXT_PRESETS.forEach((p, i) => groups[p.group].push([p, i]));
    const btn = ([p, i]) => {
      const font = typeof p.font === 'object' ? p.font[POD.lang] : p.font;
      const label = p.label ? t(p.label) : p.sample;
      const size = p.group === 'basic' ? [22, 17, 14][i] : 22;
      return `<button class="text-preset" data-i="${i}" style="font-family:'${font}';font-size:${size}px;font-weight:${p.weight === 'bold' ? 700 : 400};${p.italic ? 'font-style:italic' : ''}">${esc(label)}</button>`;
    };
    $('text-presets').innerHTML =
      groups.basic.map(btn).join('') +
      `<div class="preset-group">${esc(t('fly.text.arabic'))}</div>` + groups.arabic.map(btn).join('') +
      `<div class="preset-group">${esc(t('fly.text.english'))}</div>` + groups.english.map(btn).join('');
  }
  $('text-presets').addEventListener('click', serial(async (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const p = D.TEXT_PRESETS[Number(btn.dataset.i)];
    const font = typeof p.font === 'object' ? p.font[POD.lang] : p.font;
    const text = p.text ? t(p.text) : p.sample;
    const arabic = D.ARABIC_RE.test(text);
    await D.ensureFont(font, p.weight || 'normal', p.italic ? 'italic' : 'normal');
    const ink = inkFor(surfaceHex());
    const tx = new fabric.IText(text, {
      name: 'Text',
      fontFamily: font,
      fontSize: Math.round(area().w * p.size),
      fontWeight: p.weight || 'normal',
      fontStyle: p.italic ? 'italic' : 'normal',
      charSpacing: arabic ? 0 : p.spacing || 0,
      direction: arabic ? 'rtl' : 'ltr',
      fill: p.outline ? D.ACCENT : ink,
      stroke: p.outline ? ink : null,
      strokeWidth: p.outline ? 2 : 0,
      paintFirst: 'stroke',
      textAlign: 'center',
    });
    addObject(tx);
  }));

  function renderShapes() {
    $('shape-grid').innerHTML = Object.entries(D.SHAPES)
      .map(([k, s]) => `<button class="shape-btn" data-shape="${k}" title="${esc(tr(s.name))}" aria-label="${esc(tr(s.name))}"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">${s.icon}</svg></button>`)
      .join('');
  }
  $('shape-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    const def = D.SHAPES[btn.dataset.shape];
    const obj = def.make(inkFor(surfaceHex()) === '#ffffff' ? '#ffffff' : D.ACCENT);
    obj.set({ name: def.name.en });
    addObject(obj);
  });
  $('fill-area').addEventListener('click', () => {
    const a = area();
    const r = new fabric.Rect({ name: 'Background', width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0, fill: '#ffd84d' });
    st.silent = true;
    addObject(r, { shrinkToFit: false });
    canvas.sendToBack(r);
    st.silent = false;
    commit();
  });

  // ---------- Templates ----------
  async function renderTemplates() {
    const grid = $('template-grid');
    grid.innerHTML = D.TEMPLATES.map((tpl, i) => `<button class="template-btn" data-tpl="${i}"><img alt="" data-thumb="${i}"><span>${esc(tr(tpl.name))}</span></button>`).join('');
    for (const [i, tpl] of D.TEMPLATES.entries()) {
      const url = await D.templateThumb(tpl);
      const img = grid.querySelector(`[data-thumb="${i}"]`);
      if (img) img.src = url;
    }
  }
  $('template-grid').addEventListener('click', serial(async (e) => {
    const btn = e.target.closest('[data-tpl]');
    if (!btn) return;
    const objs = await D.buildTemplate(D.TEMPLATES[Number(btn.dataset.tpl)], area(), inkFor(surfaceHex()));
    st.silent = true;
    canvas.discardActiveObject();
    objs.forEach((o) => canvas.add(o));
    st.silent = false;
    canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
    canvas.requestRenderAll();
    commit();
    closeFlyouts();
    if (st.preview) togglePreview();
  }));

  // ---------- Images ----------
  // Huge files are downscaled; while editing they are kept as blob: URLs.
  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('msg.badImage')));
      img.src = url;
    });
  }
  async function addImageFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast(t('msg.badType'), 'error');
    if (file.size > MAX_UPLOAD_BYTES) return toast(t('msg.tooBig'), 'error');
    const srcUrl = URL.createObjectURL(file);
    try {
      const img = await loadHtmlImage(srcUrl);
      const scale = Math.min(1, MAX_UPLOAD_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const jpeg = file.type === 'image/jpeg';
      const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      const fimg = await new Promise((resolve) => fabric.Image.fromURL(URL.createObjectURL(blob), resolve));
      fimg.set({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image' });
      const a = area();
      fimg.scale(Math.min((a.w * 0.8) / fimg.width, (a.h * 0.8) / fimg.height));
      addObject(fimg);
      const dpi = imageDpi(fimg);
      if (dpi < 100) toast(t('msg.lowResToast', { dpi }), 'error');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }
  $('file-input').addEventListener('change', (e) => {
    addImageFile(e.target.files[0]);
    e.target.value = '';
  });
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addImageFile(e.dataTransfer.files[0]); });
  $('stage').addEventListener('dragover', (e) => e.preventDefault());
  $('stage').addEventListener('drop', (e) => { e.preventDefault(); addImageFile(e.dataTransfer.files[0]); });

  function imageDpi(o, sideId = st.side) {
    const s = sideDef(sideId);
    const widthIn = ((o.width * Math.abs(o.scaleX || 1)) / s.printArea.w) * s.printWidthIn;
    return Math.round(o.width / widthIn);
  }

  async function toDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error(t('msg.badImage')));
      r.readAsDataURL(blob);
    });
  }
  async function blobifyImages(objects) {
    return Promise.all(objects.map(async (o) => {
      if (o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('data:')) {
        const blob = await (await fetch(o.src)).blob();
        return { ...o, src: URL.createObjectURL(blob) };
      }
      return o;
    }));
  }
  const inlined = new Map();
  async function inlineImages(objects) {
    return Promise.all(objects.map(async (o) => {
      if (o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('blob:')) {
        if (!inlined.has(o.src)) inlined.set(o.src, toDataUrl(o.src));
        return { ...o, src: await inlined.get(o.src) };
      }
      return o;
    }));
  }

  const FILTERS = {
    white: () => new fabric.Image.filters.RemoveColor({ color: '#ffffff', distance: 0.12 }),
    gray: () => new fabric.Image.filters.Grayscale(),
    sepia: () => new fabric.Image.filters.Sepia(),
  };
  const FILTER_TYPES = { white: 'RemoveColor', gray: 'Grayscale', sepia: 'Sepia' };
  const hasFilter = (o, k) => (o.filters || []).some((f) => f && f.type === FILTER_TYPES[k]);
  function setFilter(o, key, on) {
    let keep = Object.keys(FILTERS).filter((k) => (k === key ? on : hasFilter(o, k)));
    // Black & white and vintage are alternatives.
    if (on && key === 'gray') keep = keep.filter((k) => k !== 'sepia');
    if (on && key === 'sepia') keep = keep.filter((k) => k !== 'gray');
    o.filters = keep.map((k) => FILTERS[k]());
    o.applyFilters();
    canvas.requestRenderAll();
    commit();
    renderProps();
  }

  // ---------- Flyouts ----------
  function closeFlyouts() {
    document.querySelectorAll('.flyout').forEach((f) => (f.hidden = true));
    document.querySelectorAll('.tool').forEach((x) => x.classList.remove('open'));
  }
  let templatesRendered = false;
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fly = $('flyout-' + btn.dataset.flyout);
      const open = fly.hidden;
      closeFlyouts();
      fly.hidden = !open;
      btn.classList.toggle('open', open);
      if (open && btn.dataset.flyout === 'templates' && !templatesRendered) {
        templatesRendered = true;
        renderTemplates();
      }
    });
  });
  canvas.on('mouse:down', closeFlyouts);

  // ---------- Object actions ----------
  const active = () => canvas.getActiveObject();
  function removeSelected() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    st.silent = true;
    canvas.discardActiveObject();
    objs.forEach((o) => canvas.remove(o));
    st.silent = false;
    commit();
    renderProps();
  }
  function duplicateSelected() {
    const o = active();
    if (!o || o.type === 'activeSelection') return;
    o.clone((cl) => {
      cl.set({ left: o.left + 14, top: o.top + 14 });
      canvas.add(cl);
      canvas.setActiveObject(cl);
      canvas.requestRenderAll();
    }, EXTRA_PROPS);
  }
  function centerSelected(axis) {
    const o = active();
    if (!o) return;
    const a = area();
    const c = o.getCenterPoint();
    const target = new fabric.Point(axis === 'v' ? c.x : a.x + a.w / 2, axis === 'h' ? c.y : a.y + a.h / 2);
    o.setPositionByOrigin(target, 'center', 'center');
    o.setCoords();
    canvas.requestRenderAll();
    commit();
  }
  function fitToArea(o) {
    const a = area();
    o.set({ angle: 0 });
    o.scale(Math.min(a.w / o.width, a.h / o.height));
    o.setPositionByOrigin(new fabric.Point(a.x + a.w / 2, a.y + a.h / 2), 'center', 'center');
    o.setCoords();
    canvas.requestRenderAll();
    commit();
    updateQuality();
  }
  function layer(dir) {
    const o = active();
    if (!o) return;
    ({ up: () => canvas.bringForward(o), down: () => canvas.sendBackwards(o), top: () => canvas.bringToFront(o), bottom: () => canvas.sendToBack(o) })[dir]();
    canvas.requestRenderAll();
    commit();
  }
  function setLocked(o, locked) {
    o.set({ selectable: !locked, evented: !locked });
    if (locked && canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
    canvas.requestRenderAll();
    commit();
    renderLayers();
  }

  // ---------- Properties panel ----------
  function fontPicker(o) {
    const opt = (f, sample) => `<button type="button" class="font-option ${f === o.fontFamily ? 'active' : ''}" data-font="${esc(f)}" style="font-family:'${esc(f)}'">${sample}<small>${esc(f)}</small></button>`;
    return `
      <details class="font-picker" id="p-font-picker">
        <summary style="font-family:'${esc(o.fontFamily)}'" aria-label="${esc(t('props.font'))}">${esc(o.fontFamily)}</summary>
        <div class="font-list">
          <div class="group">${esc(t('props.fontsArabic'))}</div>
          ${D.FONTS.arabic.map((f) => opt(f, 'أبجد هوز')).join('')}
          <div class="group">${esc(t('props.fontsEnglish'))}</div>
          ${D.FONTS.english.map((f) => opt(f, 'Aa Bb Cc')).join('')}
        </div>
      </details>`;
  }

  function renderProps() {
    const o = active();
    const box = $('props');
    $('props-title').textContent = t('panel.selected');
    if (!o) {
      box.innerHTML = `<p class="empty-props">${esc(t('panel.empty'))}<br><br><span class="small">${esc(t('panel.tip'))}</span></p>`;
      return;
    }
    if (o.type === 'activeSelection') {
      $('props-title').textContent = t('panel.nSelected', { n: o.size() });
      box.innerHTML = `
        <div class="grid-2">
          <button class="btn btn-sm" data-act="center-h">${esc(t('props.centerH'))}</button>
          <button class="btn btn-sm" data-act="center-v">${esc(t('props.centerV'))}</button>
        </div>
        <button class="btn btn-sm btn-block btn-danger" data-act="delete" style="margin-top:8px">${esc(t('props.deleteSelected'))}</button>`;
      return;
    }
    const text = isText(o);
    const image = o.type === 'image';
    const shape = !text && !image;
    $('props-title').textContent = text ? t('panel.text') : image ? t('panel.image') : shapeName(o);
    let html = '';

    if (text) {
      const arabic = D.ARABIC_RE.test(o.text);
      html += `
        <div class="field"><textarea id="p-text" rows="2" dir="auto">${esc(o.text)}</textarea></div>
        <div class="field">${fontPicker(o)}</div>
        <div class="field row">
          <input type="number" id="p-size" min="4" max="400" value="${Math.round(o.fontSize)}" aria-label="${esc(t('props.size'))}" title="${esc(t('props.size'))}">
          <input class="shrink" type="color" id="p-fill" value="${toHex(o.fill)}" aria-label="${esc(t('props.textColour'))}" title="${esc(t('props.textColour'))}">
        </div>
        <div class="field row">
          <div class="btn-group">
            <button class="btn btn-sm ${o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'active' : ''}" data-toggle="bold" title="${esc(t('props.bold'))}"><b>B</b></button>
            <button class="btn btn-sm ${o.fontStyle === 'italic' ? 'active' : ''}" data-toggle="italic" title="${esc(t('props.italic'))}"><i>I</i></button>
            <button class="btn btn-sm ${o.underline ? 'active' : ''}" data-toggle="underline" title="${esc(t('props.underline'))}"><u>U</u></button>
          </div>
          <div class="btn-group" dir="ltr">
            ${['left', 'center', 'right'].map((al) => `<button class="btn btn-sm ${o.textAlign === al ? 'active' : ''}" data-align="${al}" title="${esc(t('props.align' + al[0].toUpperCase() + al.slice(1)))}">${{ left: '⇤', center: '↔', right: '⇥' }[al]}</button>`).join('')}
          </div>
        </div>
        <div class="field grid-2">
          <div><label for="p-spacing">${esc(t('props.spacing'))}</label>${arabic ? `<div class="muted small">${esc(t('props.spacingArabic'))}</div>` : `<input type="range" id="p-spacing" min="-100" max="800" step="10" value="${o.charSpacing || 0}">`}</div>
          <div><label for="p-lh">${esc(t('props.lineHeight'))}</label><input type="range" id="p-lh" min="0.7" max="2.5" step="0.05" value="${o.lineHeight}"></div>
        </div>
        <div class="field">
          <label>${esc(t('props.outline'))}</label>
          <div class="row"><input class="shrink" type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}" aria-label="${esc(t('props.outline'))}"><input type="range" id="p-stroke-w" min="0" max="12" step="0.5" value="${o.strokeWidth || 0}" aria-label="${esc(t('props.outlineWidth'))}"></div>
        </div>`;
    }
    if (shape) {
      const hollow = !o.fill || o.fill === 'transparent';
      html += `
        <div class="field grid-2">
          <div><label for="p-fill">${esc(t('props.fill'))}</label><div class="row"><input class="shrink" type="color" id="p-fill" value="${toHex(hollow ? '#ffffff' : o.fill)}"><label class="check small shrink"><input type="checkbox" id="p-nofill" ${hollow ? 'checked' : ''}> ${esc(t('props.none'))}</label></div></div>
          <div><label for="p-stroke">${esc(t('props.outline'))}</label><input type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}"></div>
        </div>
        <div class="field"><label for="p-stroke-w">${esc(t('props.outlineWidth'))}</label><input type="range" id="p-stroke-w" min="0" max="30" step="1" value="${o.strokeWidth || 0}"></div>
        ${o.type === 'rect' ? `<div class="field"><label for="p-rx">${esc(t('props.radius'))}</label><input type="range" id="p-rx" min="0" max="${Math.round(Math.min(o.width, o.height) / 2)}" value="${o.rx || 0}"></div>` : ''}`;
    }
    if (image) {
      html += `<div class="field" id="quality-box"></div>
        <div class="field"><button class="btn btn-sm btn-block" data-act="fit">${esc(t('props.fit'))}</button></div>
        <div class="field">
          <label>${esc(t('props.filters'))}</label>
          <div class="toggles">
            <label class="check"><input type="checkbox" data-filter="white" ${hasFilter(o, 'white') ? 'checked' : ''}> ${esc(t('props.removeWhite'))}</label>
            <label class="check"><input type="checkbox" data-filter="gray" ${hasFilter(o, 'gray') ? 'checked' : ''}> ${esc(t('props.grayscale'))}</label>
            <label class="check"><input type="checkbox" data-filter="sepia" ${hasFilter(o, 'sepia') ? 'checked' : ''}> ${esc(t('props.sepia'))}</label>
          </div>
        </div>`;
    }
    html += `
      <div class="field grid-2">
        <div><label for="p-opacity">${esc(t('props.opacity'))}</label><input type="range" id="p-opacity" min="0.05" max="1" step="0.05" value="${o.opacity}"></div>
        <div><label for="p-angle">${esc(t('props.rotation'))}</label><input type="number" id="p-angle" min="-360" max="360" value="${Math.round(o.angle)}"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="p-shadow" ${o.shadow ? 'checked' : ''}> ${esc(t('props.shadow'))}</label></div>
      <div class="field">
        <label>${esc(t('props.position'))}</label>
        <div class="grid-4" dir="ltr">
          <button class="btn btn-sm" data-act="center-h" title="${esc(t('props.centerH'))}">↔</button>
          <button class="btn btn-sm" data-act="center-v" title="${esc(t('props.centerV'))}">↕</button>
          <button class="btn btn-sm" data-act="flip-x" title="${esc(t('props.flipH'))}">⇋</button>
          <button class="btn btn-sm" data-act="flip-y" title="${esc(t('props.flipV'))}">⇵</button>
          <button class="btn btn-sm" data-act="up" title="${esc(t('props.forward'))}">▲</button>
          <button class="btn btn-sm" data-act="down" title="${esc(t('props.backward'))}">▼</button>
          <button class="btn btn-sm" data-act="top" title="${esc(t('props.front'))}">⤒</button>
          <button class="btn btn-sm" data-act="bottom" title="${esc(t('props.back'))}">⤓</button>
        </div>
      </div>
      <div class="grid-2">
        <button class="btn btn-sm" data-act="duplicate">${esc(t('props.duplicate'))}</button>
        <button class="btn btn-sm btn-danger" data-act="delete">${esc(t('props.delete'))}</button>
      </div>`;
    box.innerHTML = html;
    if (image) updateQuality();
  }

  function toHex(c) {
    if (typeof c !== 'string') return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    try {
      return '#' + new fabric.Color(c).toHex();
    } catch (e) {
      return '#000000';
    }
  }

  function updateQuality() {
    const o = active();
    const box = $('quality-box');
    if (!o || o.type !== 'image' || !box) return;
    const dpi = imageDpi(o);
    const [cls, word] = dpi >= 150 ? ['good', t('props.qualityGreat')] : dpi >= 100 ? ['ok', t('props.qualityOk')] : ['low', t('props.qualityLow')];
    box.innerHTML = `<div class="quality ${cls}">${esc(t('props.quality', { word, dpi }))}</div>`;
  }

  function syncTextField() {
    const o = active();
    const f = $('p-text');
    if (o && f && document.activeElement !== f) f.value = o.text;
  }

  function setProp(props, { commitNow = false } = {}) {
    const o = active();
    if (!o) return;
    o.set(props);
    if ('text' in props) fixArabic(o);
    if (o.initDimensions) o.initDimensions();
    o.setCoords();
    canvas.requestRenderAll();
    commitNow ? commit() : scheduleCommit();
  }

  function shadowFor(o) {
    const s = Math.max(2, Math.min(o.getScaledWidth(), o.getScaledHeight()) * 0.04);
    return new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: s * 2, offsetX: s, offsetY: s });
  }

  const props = $('props');
  props.addEventListener('input', (e) => {
    const o = active();
    if (!o) return;
    const v = e.target.value;
    switch (e.target.id) {
      case 'p-text': {
        const wasArabic = D.ARABIC_RE.test(o.text);
        setProp({ text: v });
        renderLayers();
        if (wasArabic !== D.ARABIC_RE.test(v)) renderPropsKeepFocus();
        break;
      }
      case 'p-size': if (Number(v) >= 4) setProp({ fontSize: Number(v) }); break;
      case 'p-fill': if (!$('p-nofill') || !$('p-nofill').checked) setProp({ fill: v }); break;
      case 'p-stroke': setProp({ stroke: v, strokeUniform: true }); break;
      case 'p-stroke-w': setProp({ strokeWidth: Number(v), stroke: o.stroke || $('p-stroke').value, strokeUniform: true, paintFirst: 'stroke' }); break;
      case 'p-spacing': setProp({ charSpacing: Number(v) }); break;
      case 'p-lh': setProp({ lineHeight: Number(v) }); break;
      case 'p-rx': setProp({ rx: Number(v), ry: Number(v) }); break;
      case 'p-opacity': setProp({ opacity: Number(v) }); break;
      case 'p-angle': o.rotate(Number(v) || 0); setProp({}); break;
      default:
    }
  });
  function renderPropsKeepFocus() {
    const f = $('p-text');
    const pos = f ? f.selectionStart : null;
    renderProps();
    const nf = $('p-text');
    if (nf && pos !== null) { nf.focus(); nf.setSelectionRange(pos, pos); }
  }
  props.addEventListener('change', (e) => {
    const o = active();
    if (!o) return;
    if (e.target.id === 'p-nofill') setProp({ fill: e.target.checked ? 'transparent' : $('p-fill').value }, { commitNow: true });
    if (e.target.id === 'p-shadow') setProp({ shadow: e.target.checked ? shadowFor(o) : null }, { commitNow: true });
    if (e.target.dataset.filter) setFilter(o, e.target.dataset.filter, e.target.checked);
  });
  props.addEventListener('click', serial(async (e) => {
    const o = active();
    const fontBtn = e.target.closest('[data-font]');
    if (o && fontBtn) {
      const family = fontBtn.dataset.font;
      await D.ensureFont(family, o.fontWeight, o.fontStyle);
      setProp({ fontFamily: family }, { commitNow: true });
      renderProps();
      return;
    }
    const btn = e.target.closest('button');
    if (!o || !btn) return;
    if (btn.dataset.toggle) {
      const tg = btn.dataset.toggle;
      if (tg === 'bold') {
        const weight = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'normal' : 'bold';
        await D.ensureFont(o.fontFamily, weight, o.fontStyle);
        setProp({ fontWeight: weight }, { commitNow: true });
      }
      if (tg === 'italic') setProp({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }, { commitNow: true });
      if (tg === 'underline') setProp({ underline: !o.underline }, { commitNow: true });
      renderProps();
      return;
    }
    if (btn.dataset.align) {
      setProp({ textAlign: btn.dataset.align }, { commitNow: true });
      renderProps();
      return;
    }
    const act = btn.dataset.act;
    if (act === 'center-h') centerSelected('h');
    if (act === 'center-v') centerSelected('v');
    if (act === 'flip-x') setProp({ flipX: !o.flipX }, { commitNow: true });
    if (act === 'flip-y') setProp({ flipY: !o.flipY }, { commitNow: true });
    if (['up', 'down', 'top', 'bottom'].includes(act)) layer(act);
    if (act === 'duplicate') duplicateSelected();
    if (act === 'delete') removeSelected();
    if (act === 'fit') fitToArea(o);
  }));

  // ---------- Layers ----------
  function shapeName(o) {
    if (o.name === 'Background') return t('layers.background');
    const def = Object.values(D.SHAPES).find((s) => s.name.en === o.name);
    return def ? tr(def.name) : o.name || t('panel.shape');
  }
  function layerName(o) {
    if (isText(o)) return `“${o.text.replace(/\s+/g, ' ').slice(0, 28)}”`;
    if (o.type === 'image') return o.name || t('panel.image');
    return shapeName(o);
  }
  const LOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const UNLOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
  function renderLayers() {
    const objs = canvas.getObjects().slice().reverse();
    const sel = canvas.getActiveObjects();
    $('layers').innerHTML = objs.length
      ? objs.map((o, i) => {
          const locked = o.selectable === false;
          return `<li data-i="${objs.length - 1 - i}" class="${sel.includes(o) ? 'active' : ''} ${locked ? 'locked' : ''}">
            <span dir="auto">${esc(layerName(o))}</span>
            <button data-lock class="${locked ? 'on' : ''}" title="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}" aria-label="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}">${locked ? LOCK_ICON : UNLOCK_ICON}</button>
            <button data-del title="${esc(t('layers.delete'))}" aria-label="${esc(t('layers.delete'))}">✕</button>
          </li>`;
        }).join('')
      : `<li style="cursor:default" class="muted"><span>${esc(t('layers.empty'))}</span></li>`;
  }
  $('layers').addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    const o = canvas.getObjects()[Number(li.dataset.i)];
    if (!o) return;
    const locked = o.selectable === false;
    if (e.target.closest('[data-lock]')) return setLocked(o, !locked);
    if (e.target.closest('[data-del]')) {
      st.silent = true;
      if (canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
      canvas.remove(o);
      st.silent = false;
      commit();
      renderProps();
      return;
    }
    if (locked) return;
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
    renderProps();
    renderLayers();
  });

  // ---------- Product options ----------
  function renderOptions() {
    const p = st.product;
    $('product-select').innerHTML = products.map((x) => `<option value="${x.id}" ${x === p ? 'selected' : ''}>${esc(tr(x.name))}</option>`).join('');
    $('swatches').innerHTML = p.colors.map((c) => `<button class="swatch ${c.id === st.colorId ? 'active' : ''}" data-color="${c.id}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" style="background:${c.hex}"></button>`).join('');
    $('color-name').textContent = tr(color().name);
    $('sizes').innerHTML = p.sizes.map((s) => `<button class="chip ${s.id === st.sizeId ? 'active' : ''}" data-size="${s.id}">${esc(tr(s.label))}${s.surcharge ? ` <span style="opacity:.7">+${esc(money(s.surcharge))}</span>` : ''}</button>`).join('');
  }
  $('swatches').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === st.colorId) return;
    st.colorId = b.dataset.color;
    renderOptions();
    await applyMockup();
  }));
  $('sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    st.sizeId = b.dataset.size;
    renderOptions();
    refreshChrome();
  });
  $('product-select').addEventListener('change', serial(async (e) => changeProduct(e.target.value)));

  /** Switch product, carrying the design across by scaling it into the new print areas. */
  async function changeProduct(id) {
    const next = products.find((p) => p.id === id);
    if (!next || next === st.product) return;
    commit();
    const prev = st.product;
    const pending = prev.sides.filter((s) => (st.designs[s.id] || []).length).map((s) => s.id);
    const mapped = {};
    const from = (sid) => prev.sides.find((x) => x.id === sid).printArea;
    for (const s of next.sides) {
      if (pending.includes(s.id)) {
        mapped[s.id] = remap(st.designs[s.id], from(s.id), s.printArea);
        pending.splice(pending.indexOf(s.id), 1);
      }
    }
    for (const s of next.sides) {
      if (!mapped[s.id] && pending.length) {
        const sid = pending.shift();
        mapped[s.id] = remap(st.designs[sid], from(sid), s.printArea);
      }
    }
    if (pending.length) {
      const names = pending.map((sid) => tr(prev.sides.find((s) => s.id === sid).name)).join(' + ');
      toast(t('msg.noRoom', { product: tr(next.name), sides: names }));
    }
    st.product = next;
    st.designs = mapped;
    st.history = {};
    if (!next.colors.some((c) => c.id === st.colorId)) st.colorId = next.colors[0].id;
    if (!next.sizes.some((s) => s.id === st.sizeId)) st.sizeId = next.sizes[0].id;
    st.side = next.sides.find((s) => s.id === st.side)?.id || next.sides[0].id;
    const url = new URL(location.href);
    url.searchParams.set('product', next.id);
    history.replaceState(null, '', url);
    renderOptions();
    await Promise.all([applyMockup(), loadObjects(st.designs[st.side])]);
    seedHistory();
    refreshChrome();
    renderProps();
  }

  function remap(objects, from, to) {
    const s = Math.min(to.w / from.w, to.h / from.h);
    const fcx = from.x + from.w / 2;
    const fcy = from.y + from.h / 2;
    const tcx = to.x + to.w / 2;
    const tcy = to.y + to.h / 2;
    return objects.map((o) => (o.name === 'Background' && o.type === 'rect'
      // A full-area background fill should keep filling the new print area.
      ? { ...o, left: tcx, top: tcy, width: to.w, height: to.h, scaleX: 1, scaleY: 1, angle: 0, rx: to.rx || 0, ry: to.rx || 0 }
      : { ...o, left: tcx + (o.left - fcx) * s, top: tcy + (o.top - fcy) * s, scaleX: (o.scaleX || 1) * s, scaleY: (o.scaleY || 1) * s }));
  }

  // ---------- Sides ----------
  function renderSideTabs() {
    $('side-tabs').innerHTML = st.product.sides.map((s) => {
      const count = s.id === st.side ? canvas.getObjects().length : (st.designs[s.id] || []).length;
      return `<button class="side-tab ${s.id === st.side ? 'active' : ''}" data-side="${s.id}" role="tab" aria-selected="${s.id === st.side}">${esc(tr(s.name))}${count ? '<span class="has"></span>' : ''}</button>`;
    }).join('');
  }
  async function showSide(id) {
    st.side = id;
    await Promise.all([applyMockup(id), loadObjects(st.designs[id])]);
  }
  $('side-tabs').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-side]');
    if (!b || b.dataset.side === st.side) return;
    commit();
    await showSide(b.dataset.side);
    seedHistory();
    refreshChrome();
    renderProps();
  }));

  // ---------- Toolbar ----------
  function togglePreview() {
    st.preview = !st.preview;
    $('preview-toggle').classList.toggle('active', st.preview);
    if (st.preview) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
  $('preview-toggle').addEventListener('click', togglePreview);
  $('undo').addEventListener('click', serial(() => stepHistory(-1)));
  $('redo').addEventListener('click', serial(() => stepHistory(1)));
  $('clear-side').addEventListener('click', () => {
    if (!canvas.getObjects().length) return;
    if (!confirm(t('msg.clearConfirm', { side: tr(sideDef().name) }))) return;
    st.silent = true;
    canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects());
    st.silent = false;
    commit();
    renderProps();
  });

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const o = active();
    if (o && o.isEditing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); serial(() => stepHistory(e.shiftKey ? 1 : -1))(); return; }
    if (mod && key === 'y') { e.preventDefault(); serial(() => stepHistory(1))(); return; }
    if (!o) return;
    if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); removeSelected(); return; }
    const step = e.shiftKey ? 10 : 1;
    const moves = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (moves[key]) {
      e.preventDefault();
      o.set({ left: o.left + moves[key][0], top: o.top + moves[key][1] });
      o.setCoords();
      canvas.requestRenderAll();
      scheduleCommit();
    }
  });

  // ---------- Price & chrome ----------
  function designedSides() {
    return st.product.sides.filter((s) => (s.id === st.side ? canvas.getObjects().length : (st.designs[s.id] || []).length) > 0);
  }
  function refreshChrome() {
    const p = st.product;
    const size = p.sizes.find((s) => s.id === st.sizeId);
    const n = designedSides().length;
    $('price').textContent = money(p.basePrice + size.surcharge + Math.max(0, n - 1) * catalog.pricing.extraSide);
    const notes = [];
    if (p.sides.length > 1) notes.push(n > 1 ? t('price.bothSides') : t('price.addSide', { price: money(catalog.pricing.extraSide) }));
    if (size.surcharge) notes.push(`${tr(size.label)} +${money(size.surcharge)}`);
    $('price-note').textContent = notes.join(' · ');
    const h = hist();
    $('undo').disabled = h.i <= 0;
    $('redo').disabled = h.i >= h.stack.length - 1;
    $('add-to-cart').textContent = t(st.editingCartIndex !== null ? 'cart.update' : 'cart.add');
    renderSideTabs();
    renderLayers();
  }

  // ---------- Export & add to cart ----------
  function exportPrint(side) {
    const a = side.printArea;
    const z = canvas.getZoom();
    const mult = Math.min((TARGET_DPI * side.printWidthIn) / a.w, MAX_PRINT_PX / Math.max(a.w, a.h));
    const objs = canvas.getObjects();
    const clips = objs.map((o) => o.clipPath);
    const bg = canvas.backgroundImage;
    const ov = canvas.overlayImage;
    const vt = canvas.viewportTransform.slice();
    st.exporting = true;
    canvas.backgroundImage = null;
    canvas.overlayImage = null;
    canvas.setViewportTransform([z, 0, 0, z, 0, 0]); // ignore scroll offsets
    objs.forEach((o) => (o.clipPath = null)); // the crop below does the clipping at full resolution
    try {
      return canvas.toDataURL({ format: 'png', left: a.x * z, top: a.y * z, width: a.w * z, height: a.h * z, multiplier: mult / z });
    } finally {
      objs.forEach((o, i) => (o.clipPath = clips[i]));
      canvas.backgroundImage = bg;
      canvas.overlayImage = ov;
      canvas.setViewportTransform(vt);
      st.exporting = false;
    }
  }
  function exportPreview() {
    const z = canvas.getZoom();
    st.exporting = true;
    try {
      return canvas.toDataURL({ format: 'png', multiplier: 1.2 / z });
    } finally {
      st.exporting = false;
    }
  }
  function busy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  }

  $('add-to-cart').addEventListener('click', serial(async () => {
    commit();
    canvas.discardActiveObject();
    const sides = designedSides();
    if (!sides.length) {
      toast(t('msg.addFirst'), 'error');
      return;
    }
    const lowRes = [];
    for (const s of sides) {
      for (const o of st.designs[s.id]) {
        if (o.type === 'image' && imageDpi(o, s.id) < 100) lowRes.push(`${o.name || t('panel.image')} (${tr(s.name)}, ${imageDpi(o, s.id)} DPI)`);
      }
    }
    if (lowRes.length && !confirm(t('msg.lowResConfirm', { list: lowRes.join('\n') }))) return;

    const prevZoom = st.zoom;
    if (st.zoom !== 1) setZoom(1);
    busy(true, t('busy.preparing'));
    const original = st.side;
    try {
      const payload = { productId: st.product.id, color: st.colorId, size: st.sizeId, sides: {} };
      for (const s of sides) {
        await showSide(s.id);
        payload.sides[s.id] = {
          editor: { version: fabric.version, objects: await inlineImages(st.designs[s.id]) },
          print: exportPrint(s),
          preview: exportPreview(),
        };
      }
      await showSide(original);
      busy(true, t('busy.saving'));
      const design = await POD.api('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const entry = {
        designId: design.id,
        productId: design.productId,
        productName: design.productName,
        colorName: design.color.name,
        sizeLabel: design.size.label,
        sides: design.sides.map((s) => s.name),
        price: design.price,
        previewUrl: design.previewUrl,
        addedAt: new Date().toISOString(),
      };
      const cart = POD.getCart();
      if (st.editingCartIndex !== null && cart[st.editingCartIndex]) cart[st.editingCartIndex] = entry;
      else cart.push(entry);
      POD.setCart(cart);
      st.dirty = false;
      location.href = '/cart?added=1';
    } catch (e) {
      await showSide(original).catch(() => {});
      setZoom(prevZoom);
      toast(e.message, 'error');
    } finally {
      busy(false);
      canvas.requestRenderAll();
    }
  }));

  window.addEventListener('beforeunload', (e) => {
    if (st.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Re-render everything the shopper reads when the language changes.
  document.addEventListener('pod:langchange', () => {
    renderOptions();
    renderPresets();
    renderShapes();
    if (templatesRendered) renderTemplates();
    refreshChrome();
    renderProps();
    canvas.requestRenderAll();
  });

  // ---------- Boot ----------
  renderOptions();
  renderPresets();
  renderShapes();
  fit();
  await D.ensureFont('Cairo', 600); // print-area label
  await showSide(st.side);
  seedHistory();
  refreshChrome();
  renderProps();
  window.__editor = { canvas, st }; // handy for debugging in the console
})();
