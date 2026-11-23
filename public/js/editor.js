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
  const EXTRA_PROPS = ['name'];
  const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Courier New', 'Impact', 'Comic Sans MS', 'Brush Script MT'];
  const $ = (id) => document.getElementById(id);
  const { esc, money, toast } = POD;

  // ---------- Fabric defaults ----------
  fabric.Object.prototype.objectCaching = false;
  Object.assign(fabric.Object.prototype, {
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#ff5a36',
    borderColor: '#ff5a36',
    cornerSize: 11,
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
      if (Number.isInteger(idx) && cart[idx] && cart[idx].designId === saved.id) st.editingCartIndex = idx;
    } catch (e) {
      toast('Could not open that design: ' + e.message, 'error');
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
    const z = Math.max(0.3, Math.min((stage.clientWidth - 32) / W, (stage.clientHeight - 32) / H, 1.6));
    canvas.setDimensions({ width: Math.round(W * z), height: Math.round(H * z) });
    canvas.setZoom(z);
    canvas.requestRenderAll();
  }
  new ResizeObserver(fit).observe($('stage'));

  function clipRect(a) {
    return new fabric.Rect({
      left: a.x, top: a.y, width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0,
      originX: 'left', originY: 'top', strokeWidth: 0, absolutePositioned: true,
    });
  }

  // Print-area guide, drawn on top of everything while editing.
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
    ctx.font = `600 ${11 * px}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 90, 54, .95)';
    ctx.fillText(`Print area · ${s.printWidthIn} × ${s.printHeightIn} in`, a.x, a.y - 6 * px);
    ctx.restore();
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

  function loadObjects(objects) {
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
  canvas.on('text:changed', () => { renderLayers(); syncTextField(); scheduleCommit(); });
  canvas.on('text:editing:exited', () => commit());
  canvas.on('selection:created', renderProps);
  canvas.on('selection:updated', renderProps);
  canvas.on('selection:cleared', renderProps);
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

  const TEXT_PRESETS = [
    { label: 'Add a heading', text: 'Your Text', size: 0.17, weight: 'bold', font: 'Arial', style: 'font-size:22px;font-weight:800' },
    { label: 'Add a subheading', text: 'Subheading', size: 0.11, weight: '600', font: 'Arial', style: 'font-size:17px;font-weight:600' },
    { label: 'Add a line of body text', text: 'A little bit of body text', size: 0.065, weight: 'normal', font: 'Arial', style: 'font-size:14px' },
    { label: 'BOLD STATEMENT', text: 'BOLD', size: 0.24, weight: 'normal', font: 'Impact', outline: true, style: 'font-family:Impact,sans-serif;font-size:24px;letter-spacing:.04em' },
    { label: 'Classic serif', text: 'Est. 2026', size: 0.12, weight: 'normal', font: 'Georgia', italic: true, spacing: 80, style: 'font-family:Georgia,serif;font-style:italic;font-size:19px' },
    { label: 'Handwritten script', text: 'with love', size: 0.15, weight: 'normal', font: 'Brush Script MT', style: 'font-family:"Brush Script MT",cursive;font-size:24px' },
    { label: 'Typewriter', text: 'hello world', size: 0.09, weight: 'normal', font: 'Courier New', style: 'font-family:"Courier New",monospace;font-size:16px' },
  ];
  $('text-presets').innerHTML = TEXT_PRESETS.map((p, i) => `<button class="text-preset" data-i="${i}" style='${p.style}'>${esc(p.label)}</button>`).join('');
  $('text-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const p = TEXT_PRESETS[Number(btn.dataset.i)];
    const ink = inkFor(surfaceHex());
    const t = new fabric.IText(p.text, {
      name: 'Text',
      fontFamily: p.font,
      fontSize: Math.round(area().w * p.size),
      fontWeight: p.weight,
      fontStyle: p.italic ? 'italic' : 'normal',
      charSpacing: p.spacing || 0,
      fill: p.outline ? '#ff5a36' : ink,
      stroke: p.outline ? ink : null,
      strokeWidth: p.outline ? 2 : 0,
      paintFirst: 'stroke',
      textAlign: 'center',
    });
    addObject(t);
  });

  const SHAPES = {
    square: { label: 'Square', icon: '<rect x="4" y="4" width="16" height="16"/>', make: (f) => new fabric.Rect({ width: 100, height: 100, fill: f }) },
    rounded: { label: 'Rounded', icon: '<rect x="4" y="4" width="16" height="16" rx="4"/>', make: (f) => new fabric.Rect({ width: 100, height: 100, rx: 18, ry: 18, fill: f }) },
    circle: { label: 'Circle', icon: '<circle cx="12" cy="12" r="8"/>', make: (f) => new fabric.Circle({ radius: 50, fill: f }) },
    ring: { label: 'Ring', icon: '<circle cx="12" cy="12" r="7" fill="none" stroke-width="3"/>', make: (f) => new fabric.Circle({ radius: 50, fill: 'transparent', stroke: f, strokeWidth: 10, strokeUniform: true }) },
    triangle: { label: 'Triangle', icon: '<path d="M12 4 21 20H3z"/>', make: (f) => new fabric.Triangle({ width: 100, height: 88, fill: f }) },
    star: { label: 'Star', icon: '<path d="m12 3 2.6 5.8 6.4.6-4.8 4.2 1.4 6.3L12 16.6 6.4 19.9l1.4-6.3L3 9.4l6.4-.6z"/>', make: (f) => new fabric.Polygon(starPoints(5, 50, 21), { fill: f }) },
    heart: { label: 'Heart', icon: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>', make: (f) => new fabric.Path('M50 88 C20 66 0 48 0 28 C0 12 12 0 27 0 C37 0 45 5 50 14 C55 5 63 0 73 0 C88 0 100 12 100 28 C100 48 80 66 50 88 Z', { fill: f }) },
    hexagon: { label: 'Hexagon', icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>', make: (f) => new fabric.Polygon(starPoints(6, 50, 50, 0), { fill: f }) },
    line: { label: 'Line', icon: '<rect x="3" y="11" width="18" height="2.5"/>', make: (f) => new fabric.Rect({ width: 140, height: 6, fill: f }) },
  };
  function starPoints(n, outer, inner, rot = -Math.PI / 2) {
    const pts = [];
    const steps = inner === outer ? n : n * 2;
    for (let i = 0; i < steps; i++) {
      const r = inner === outer || i % 2 === 0 ? outer : inner;
      const a = rot + (i * Math.PI * 2) / steps;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }
  $('shape-grid').innerHTML = Object.entries(SHAPES)
    .map(([k, s]) => `<button class="shape-btn" data-shape="${k}" title="${s.label}" aria-label="${s.label}"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">${s.icon}</svg></button>`)
    .join('');
  $('shape-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    const def = SHAPES[btn.dataset.shape];
    const obj = def.make(inkFor(surfaceHex()) === '#ffffff' ? '#ffffff' : '#ff5a36');
    obj.set({ name: def.label });
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

  // Images: downscale huge files, keep them as blob: URLs while editing.
  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image'));
      img.src = url;
    });
  }
  async function addImageFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Please choose a PNG, JPG, WebP or GIF image', 'error');
    if (file.size > MAX_UPLOAD_BYTES) return toast('That image is larger than 25 MB', 'error');
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
      if (dpi < 100) toast(`Heads up: this image is low resolution (${dpi} DPI at this size) and may print blurry.`, 'error');
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
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('over')));
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
      r.onerror = () => reject(new Error('Could not read image'));
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

  // ---------- Flyouts ----------
  function closeFlyouts() {
    document.querySelectorAll('.flyout').forEach((f) => (f.hidden = true));
    document.querySelectorAll('.tool').forEach((t) => t.classList.remove('open'));
  }
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fly = $('flyout-' + btn.dataset.flyout);
      const open = fly.hidden;
      closeFlyouts();
      fly.hidden = !open;
      btn.classList.toggle('open', open);
    });
  });
  canvas.on('mouse:down', closeFlyouts);

  // ---------- Object actions ----------
  function active() {
    return canvas.getActiveObject();
  }
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

  // ---------- Properties panel ----------
  function renderProps() {
    const o = active();
    const box = $('props');
    $('props-title').textContent = 'Selected element';
    if (!o) {
      box.innerHTML = '<p class="empty-props">Add text, an image or a shape from the toolbar, then select it on the product to change how it looks.<br><br><span class="small">Tip: double-click text to type directly on the product.</span></p>';
      return;
    }
    if (o.type === 'activeSelection') {
      $('props-title').textContent = `${o.size()} elements selected`;
      box.innerHTML = `
        <div class="grid-2">
          <button class="btn btn-sm" data-act="center-h">Center horizontally</button>
          <button class="btn btn-sm" data-act="center-v">Center vertically</button>
        </div>
        <button class="btn btn-sm btn-block btn-danger" data-act="delete" style="margin-top:8px">Delete selected</button>`;
      return;
    }
    const isText = o.type === 'i-text' || o.type === 'text' || o.type === 'textbox';
    const isImage = o.type === 'image';
    const isShape = !isText && !isImage;
    $('props-title').textContent = isText ? 'Text' : isImage ? 'Image' : o.name || 'Shape';
    let html = '';

    if (isText) {
      html += `
        <div class="field"><textarea id="p-text" rows="2">${esc(o.text)}</textarea></div>
        <div class="field row">
          <select id="p-font" aria-label="Font">${FONTS.map((f) => `<option ${f === o.fontFamily ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select>
          <input class="shrink" style="width:76px" type="number" id="p-size" min="4" max="400" value="${Math.round(o.fontSize)}" aria-label="Font size">
          <input class="shrink" type="color" id="p-fill" value="${toHex(o.fill)}" aria-label="Text colour">
        </div>
        <div class="field row">
          <div class="btn-group">
            <button class="btn btn-sm ${o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'active' : ''}" data-toggle="bold" title="Bold"><b>B</b></button>
            <button class="btn btn-sm ${o.fontStyle === 'italic' ? 'active' : ''}" data-toggle="italic" title="Italic"><i>I</i></button>
            <button class="btn btn-sm ${o.underline ? 'active' : ''}" data-toggle="underline" title="Underline"><u>U</u></button>
          </div>
          <div class="btn-group">
            ${['left', 'center', 'right'].map((al) => `<button class="btn btn-sm ${o.textAlign === al ? 'active' : ''}" data-align="${al}" title="Align ${al}">${{ left: '⇤', center: '↔', right: '⇥' }[al]}</button>`).join('')}
          </div>
        </div>
        <div class="field grid-2">
          <div><label for="p-spacing">Letter spacing</label><input type="range" id="p-spacing" min="-100" max="800" step="10" value="${o.charSpacing || 0}"></div>
          <div><label for="p-lh">Line height</label><input type="range" id="p-lh" min="0.7" max="2.5" step="0.05" value="${o.lineHeight}"></div>
        </div>
        <div class="field">
          <label>Outline</label>
          <div class="row"><input class="shrink" type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}" aria-label="Outline colour"><input type="range" id="p-stroke-w" min="0" max="12" step="0.5" value="${o.strokeWidth || 0}" aria-label="Outline width"></div>
        </div>`;
    }
    if (isShape) {
      const hollow = !o.fill || o.fill === 'transparent';
      html += `
        <div class="field grid-2">
          <div><label for="p-fill">Fill</label><div class="row"><input class="shrink" type="color" id="p-fill" value="${toHex(hollow ? '#ffffff' : o.fill)}"><label class="small muted shrink" style="margin:0"><input type="checkbox" id="p-nofill" ${hollow ? 'checked' : ''}> None</label></div></div>
          <div><label for="p-stroke">Outline</label><input type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}"></div>
        </div>
        <div class="field"><label for="p-stroke-w">Outline width</label><input type="range" id="p-stroke-w" min="0" max="30" step="1" value="${o.strokeWidth || 0}"></div>
        ${o.type === 'rect' ? `<div class="field"><label for="p-rx">Corner radius</label><input type="range" id="p-rx" min="0" max="${Math.round(Math.min(o.width, o.height) / 2)}" value="${o.rx || 0}"></div>` : ''}`;
    }
    if (isImage) {
      html += `<div class="field" id="quality-box"></div>
        <div class="field"><button class="btn btn-sm btn-block" data-act="fit">Fit to print area</button></div>`;
    }
    html += `
      <div class="field grid-2">
        <div><label for="p-opacity">Opacity</label><input type="range" id="p-opacity" min="0.05" max="1" step="0.05" value="${o.opacity}"></div>
        <div><label for="p-angle">Rotation</label><input type="number" id="p-angle" min="-360" max="360" value="${Math.round(o.angle)}"></div>
      </div>
      <div class="field">
        <label>Position &amp; layer</label>
        <div class="grid-4">
          <button class="btn btn-sm" data-act="center-h" title="Center horizontally in print area">↔</button>
          <button class="btn btn-sm" data-act="center-v" title="Center vertically in print area">↕</button>
          <button class="btn btn-sm" data-act="flip-x" title="Flip horizontally">⇋</button>
          <button class="btn btn-sm" data-act="flip-y" title="Flip vertically">⇵</button>
          <button class="btn btn-sm" data-act="up" title="Bring forward">▲</button>
          <button class="btn btn-sm" data-act="down" title="Send backward">▼</button>
          <button class="btn btn-sm" data-act="top" title="Bring to front">⤒</button>
          <button class="btn btn-sm" data-act="bottom" title="Send to back">⤓</button>
        </div>
      </div>
      <div class="grid-2">
        <button class="btn btn-sm" data-act="duplicate">Duplicate</button>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>
      </div>`;
    box.innerHTML = html;
    if (isImage) updateQuality();
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
    const [cls, word] = dpi >= 150 ? ['good', 'Great'] : dpi >= 100 ? ['ok', 'OK'] : ['low', 'Low, may look blurry'];
    box.innerHTML = `<div class="quality ${cls}">Print quality: ${word} (${dpi} DPI)</div>`;
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
    if (o.initDimensions) o.initDimensions();
    o.setCoords();
    canvas.requestRenderAll();
    commitNow ? commit() : scheduleCommit();
  }

  const props = $('props');
  props.addEventListener('input', (e) => {
    const o = active();
    if (!o) return;
    const v = e.target.value;
    switch (e.target.id) {
      case 'p-text': setProp({ text: v }); renderLayers(); break;
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
  props.addEventListener('change', (e) => {
    const o = active();
    if (!o) return;
    if (e.target.id === 'p-font') setProp({ fontFamily: e.target.value }, { commitNow: true });
    if (e.target.id === 'p-nofill') setProp({ fill: e.target.checked ? 'transparent' : $('p-fill').value }, { commitNow: true });
  });
  props.addEventListener('click', (e) => {
    const o = active();
    const btn = e.target.closest('button');
    if (!o || !btn) return;
    if (btn.dataset.toggle) {
      const t = btn.dataset.toggle;
      if (t === 'bold') setProp({ fontWeight: o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'normal' : 'bold' }, { commitNow: true });
      if (t === 'italic') setProp({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }, { commitNow: true });
      if (t === 'underline') setProp({ underline: !o.underline }, { commitNow: true });
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
  });

  // ---------- Layers ----------
  function layerName(o) {
    if (o.type === 'i-text' || o.type === 'text') return `“${o.text.replace(/\s+/g, ' ').slice(0, 28)}”`;
    return o.name || o.type;
  }
  function renderLayers() {
    const objs = canvas.getObjects().slice().reverse();
    const sel = canvas.getActiveObjects();
    $('layers').innerHTML = objs.length
      ? objs.map((o, i) => `<li data-i="${objs.length - 1 - i}" class="${sel.includes(o) ? 'active' : ''}"><span>${esc(layerName(o))}</span><button data-del title="Delete" aria-label="Delete layer">✕</button></li>`).join('')
      : '<li style="cursor:default" class="muted"><span>Nothing here yet</span></li>';
  }
  $('layers').addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    const o = canvas.getObjects()[Number(li.dataset.i)];
    if (!o) return;
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
    if (e.target.closest('[data-del]')) removeSelected();
    renderProps();
    renderLayers();
  });
  canvas.on('selection:created', renderLayers);
  canvas.on('selection:updated', renderLayers);
  canvas.on('selection:cleared', renderLayers);

  // ---------- Product options ----------
  $('product-select').innerHTML = products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  function renderOptions() {
    const p = st.product;
    $('product-select').value = p.id;
    $('swatches').innerHTML = p.colors.map((c) => `<button class="swatch ${c.id === st.colorId ? 'active' : ''}" data-color="${c.id}" title="${esc(c.name)}" aria-label="${esc(c.name)}" style="background:${c.hex}"></button>`).join('');
    $('color-name').textContent = color().name;
    $('sizes').innerHTML = p.sizes.map((s) => `<button class="chip ${s.id === st.sizeId ? 'active' : ''}" data-size="${s.id}">${esc(s.label)}${s.surcharge ? ` <span style="opacity:.7">+${money(s.surcharge)}</span>` : ''}</button>`).join('');
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
    for (const s of next.sides) {
      const from = pending.includes(s.id) ? s.id : null;
      if (from) {
        mapped[s.id] = remap(st.designs[from], prev.sides.find((x) => x.id === from).printArea, s.printArea);
        pending.splice(pending.indexOf(from), 1);
      }
    }
    for (const s of next.sides) {
      if (!mapped[s.id] && pending.length) {
        const from = pending.shift();
        mapped[s.id] = remap(st.designs[from], prev.sides.find((x) => x.id === from).printArea, s.printArea);
      }
    }
    if (pending.length) {
      const names = pending.map((id) => prev.sides.find((s) => s.id === id).name.toLowerCase()).join(' and ');
      toast(`${next.name} has no room for your ${names} design, so it was left out.`);
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
    return objects.map((o) => o.name === 'Background' && o.type === 'rect' ? {
      // A full-area background fill should keep filling the new print area.
      ...o, left: tcx, top: tcy, width: to.w, height: to.h, scaleX: 1, scaleY: 1, angle: 0, rx: to.rx || 0, ry: to.rx || 0,
    } : {
      ...o,
      left: tcx + (o.left - fcx) * s,
      top: tcy + (o.top - fcy) * s,
      scaleX: (o.scaleX || 1) * s,
      scaleY: (o.scaleY || 1) * s,
    });
  }

  // ---------- Sides ----------
  function renderSideTabs() {
    const sides = st.product.sides;
    $('side-tabs').hidden = false;
    $('side-tabs').innerHTML = sides.map((s) => {
      const count = s.id === st.side ? canvas.getObjects().length : (st.designs[s.id] || []).length;
      return `<button class="side-tab ${s.id === st.side ? 'active' : ''}" data-side="${s.id}" role="tab" aria-selected="${s.id === st.side}">${esc(s.name)}${count ? '<span class="has" title="Has a design"></span>' : ''}</button>`;
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
    if (!confirm(`Remove everything from the ${sideDef().name.toLowerCase()} side?`)) return;
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
    const price = p.basePrice + size.surcharge + Math.max(0, n - 1) * catalog.pricing.extraSide;
    $('price').textContent = money(price);
    const notes = [];
    if (p.sides.length > 1) notes.push(n > 1 ? `${n} sides printed` : `Add a second side for +${money(catalog.pricing.extraSide)}`);
    if (size.surcharge) notes.push(`${size.label} +${money(size.surcharge)}`);
    $('price-note').textContent = notes.join(' · ');
    const h = hist();
    $('undo').disabled = h.i <= 0;
    $('redo').disabled = h.i >= h.stack.length - 1;
    $('add-to-cart').textContent = st.editingCartIndex !== null ? 'Update cart item' : 'Add to cart';
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
    st.exporting = true;
    canvas.backgroundImage = null;
    canvas.overlayImage = null;
    objs.forEach((o) => (o.clipPath = null)); // the crop below does the clipping at full resolution
    try {
      return canvas.toDataURL({ format: 'png', left: a.x * z, top: a.y * z, width: a.w * z, height: a.h * z, multiplier: mult / z });
    } finally {
      objs.forEach((o, i) => (o.clipPath = clips[i]));
      canvas.backgroundImage = bg;
      canvas.overlayImage = ov;
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
      toast('Add some text, an image or a shape first.', 'error');
      return;
    }
    const lowRes = [];
    for (const s of sides) {
      for (const o of st.designs[s.id]) {
        if (o.type === 'image' && imageDpi(o, s.id) < 100) lowRes.push(`${o.name || 'Image'} (${s.name.toLowerCase()}, ${imageDpi(o, s.id)} DPI)`);
      }
    }
    if (lowRes.length && !confirm(`These images are low resolution and may print blurry:\n\n${lowRes.join('\n')}\n\nAdd to cart anyway?`)) return;

    busy(true, 'Preparing your print-ready files…');
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
      busy(true, 'Saving your design…');
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

  // ---------- Boot ----------
  renderOptions();
  fit();
  await showSide(st.side);
  seedHistory();
  refreshChrome();
  renderProps();
  window.__editor = { canvas, st }; // handy for debugging in the console
})();
