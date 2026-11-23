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
  const TARGET_DPI = 300;
  const MAX_PRINT_PIXELS = 16e6; // iPhone Safari's canvas limit is 16.7 million pixels
  const MAX_PRINT_SIDE = 8000;
  const MAX_UPLOAD_PX = 3000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const MAX_VECTOR_BYTES = 40 * 1024 * 1024;
  const HISTORY_LIMIT = 60;
  const SNAP_PX = 7;
  const EXTRA_PROPS = ['name', 'selectable', 'evented', 'curve', 'mask', 'maskBorder', 'maskBorderColor', 'lockRatio', 'bgShape', 'textFx', 'boosted', 'importSource'];
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
  // Bigger handles for fingers.
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  if (COARSE) Object.assign(fabric.Object.prototype, { cornerSize: 18, touchCornerSize: 48, padding: 8 });
  if (COARSE && fabric.Object.prototype.controls && fabric.Object.prototype.controls.mtr) fabric.Object.prototype.controls.mtr.offsetY = -46;
  const MOBILE = window.matchMedia('(max-width: 820px)');

  // ---------- Load catalog and (optionally) a saved design ----------
  let catalog;
  try {
    catalog = await POD.loadCatalog();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  // Books are personalised on their own page, not in the editor.
  const products = catalog.products.filter((x) => x.kind !== 'book');
  {
    const asked = catalog.products.find((x) => x.id === new URLSearchParams(location.search).get('product'));
    if (asked && asked.kind === 'book') location.replace('/book?b=' + encodeURIComponent(asked.book));
  }
  const params = new URLSearchParams(location.search);

  const st = {
    product: products.find((p) => p.id === params.get('product')) || products[0],
    colorId: null,
    sizeId: null,
    side: null,
    designs: {}, // sideId -> serialized objects
    history: {}, // sideId -> { stack: [json], i }
    offsets: {}, // sideId -> { dx, dy }: where the customer moved the print area
    pattern: null, // fabric products: { repeat, tileCm } (how the tile repeats, and its size)
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
        if (data.offset) st.offsets[sideId] = data.offset;
        if (data.pattern) st.pattern = data.pattern;
      }
      const idx = Number(params.get('cart'));
      const cart = POD.getCart();
      if (params.get('cart') !== null && Number.isInteger(idx) && cart[idx] && cart[idx].designId === saved.id) st.editingCartIndex = idx;
    } catch (e) {
      toast(t('msg.openFailed', { msg: e.message }), 'error');
    }
  }
  // Drafts: designs started from the products page are kept in this browser
  // until they go into the cart (editing a cart item never touches them).
  // Opened from the ready-made designs shop: load that design (and colour) as a new draft.
  let libraryDesign = null;
  if (!params.get('design') && params.get('library')) {
    try {
      libraryDesign = await POD.api('/api/library/' + encodeURIComponent(params.get('library')));
      if (params.get('color')) st.colorId = params.get('color');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  let fromShare = false;
  if (!params.get('design') && /^[A-Za-z0-9_-]{12}$/.test(params.get('share') || '')) {
    try {
      const shared = await POD.api('/api/shares/' + encodeURIComponent(params.get('share')) + '/design');
      st.product = products.find((p) => p.id === shared.productId) || st.product;
      st.colorId = shared.color;
      st.sizeId = shared.size;
      for (const [sideId, data] of Object.entries(shared.editor || {})) {
        if (st.product.sides.some((sd) => sd.id === sideId)) {
          st.designs[sideId] = await blobifyImages(data.objects || []);
          if (data.offset) st.offsets[sideId] = data.offset;
          if (data.pattern) st.pattern = data.pattern;
        }
      }
      fromShare = true;
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const draftMode = !params.get('design') && !!(POD.drafts && window.indexedDB);
  let restoredDraft = false;
  let bootDone = false; // autosave starts once the editor has loaded
  if (draftMode && !fromShare && !libraryDesign) {
    const draft = await POD.drafts.get(st.product.id);
    if (draft && draft.designs && Object.values(draft.designs).some((o) => o && o.length)) {
      st.colorId = draft.colorId;
      st.sizeId = draft.sizeId;
      for (const [sideId, objs] of Object.entries(draft.designs)) {
        if (st.product.sides.some((s) => s.id === sideId)) st.designs[sideId] = await blobifyImages(objs || []);
      }
      for (const [sideId, o] of Object.entries(draft.offsets || {})) if (st.product.sides.some((s) => s.id === sideId)) st.offsets[sideId] = o;
      if (draft.pattern) st.pattern = draft.pattern;
      restoredDraft = true;
    }
  }
  st.colorId = st.product.colors.some((c) => c.id === st.colorId) ? st.colorId : st.product.colors[0].id;
  st.sizeId = st.product.sizes.some((s) => s.id === st.sizeId) ? st.sizeId : st.product.sizes[0].id;
  st.side = st.product.sides.find((s) => (st.designs[s.id] || []).length)?.id || st.product.sides[0].id;
  /** Fabric products: a valid { repeat, tileCm } for this product (or null for other products). */
  const REPEATS = ['straight', 'halfdrop', 'halfbrick', 'mirror'];
  function normPattern(product, p) {
    if (!product.pattern) return null;
    const tileCm = Number(p && p.tileCm);
    return { repeat: REPEATS.includes(p && p.repeat) ? p.repeat : 'straight', tileCm: product.pattern.tiles.includes(tileCm) ? tileCm : product.pattern.tile };
  }
  st.pattern = normPattern(st.product, st.pattern);

  // On garments and bags the print area can be moved (st.offsets, in mockup units);
  // sideDef() gives the side with its print area where the customer put it.
  // Garment sizes: the print is the same size in cm on every size, so on a
  // bigger garment the print box is smaller (scaled from just below the collar).
  const baseSide = (id = st.side) => st.product.sides.find((s) => s.id === id);
  function areaFor(product, sideId, sizeId, offset) {
    const a = product.sides.find((s) => s.id === sideId).printArea;
    const size = product.sizes.find((z) => z.id === sizeId);
    const f = product.photoChestCm && size && size.chestCm ? product.photoChestCm / size.chestCm : 1;
    const w = f === 1 ? a.w : Math.round(a.w * f * 10) / 10;
    const h = f === 1 ? a.h : Math.round(a.h * f * 10) / 10;
    const x = f === 1 ? a.x : Math.round((a.x + a.w / 2 - w / 2) * 10) / 10;
    return { ...a, x: x + ((offset && offset.dx) || 0), y: a.y + ((offset && offset.dy) || 0), w, h, ...(a.rx && f !== 1 ? { rx: a.rx * f } : {}) };
  }
  const sizedSides = new Map();
  const sideDef = (id = st.side) => {
    const s = baseSide(id);
    if (!s) return s;
    const o = st.offsets[s.id];
    const key = `${st.product.id}:${s.id}:${st.sizeId}:${o ? o.dx : 0}:${o ? o.dy : 0}:${st.pattern ? st.pattern.tileCm : ''}`;
    if (!sizedSides.has(key)) {
      const a = areaFor(st.product, s.id, st.sizeId, o);
      const same = a.x === s.printArea.x && a.y === s.printArea.y && a.w === s.printArea.w && a.h === s.printArea.h;
      // Sizes that print bigger or smaller (posters, cards, signs): same drawing area, different inches.
      const size = st.product.sizes.find((z) => z.id === st.sizeId);
      // Fabric patterns: the tile prints at the chosen size (cm).
      const k = ((size && size.printScale) || 1) * (st.pattern ? st.pattern.tileCm / st.product.pattern.tile : 1);
      const physical = k === 1 ? {} : { printWidthIn: s.printWidthIn * k, printHeightIn: (s.printHeightIn || 0) * k };
      sizedSides.set(key, same && k === 1 ? s : { ...s, ...physical, printArea: same ? s.printArea : a });
    }
    return sizedSides.get(key);
  };
  const area = (id) => sideDef(id).printArea;
  const color = () => st.product.colors.find((c) => c.id === st.colorId);
  const surfaceHex = () => st.product.surface || color().hex;
  const inkFor = (hex) => (POD.luminance(hex) < 0.45 ? '#ffffff' : '#16181d');

  // ---------- Canvas ----------
  // Keep exact sizes when the design is saved (Fabric rounds to 2 decimals by default, which
  // shrinks or grows small-scaled photos by up to 15-30% between screen and print).
  fabric.Object.NUM_FRACTION_DIGITS = 8;
  const canvas = new fabric.Canvas('design-canvas', {
    width: W,
    height: H,
    preserveObjectStacking: true,
    controlsAboveOverlay: true,
    stopContextMenu: true,
    fireRightClick: false,
  });
  if (COARSE) canvas.selection = false; // one finger drags objects, two fingers zoom

  function fit() {
    const stage = $('stage');
    // With the phone panel open there is little room: zoom in on the print area instead of the whole product.
    const focus = MOBILE.matches && st.sheet;
    const a = area();
    // Garment sizes: the biggest size fills the picture and smaller ones are
    // drawn smaller around the middle (k), so the garment grows or shrinks
    // with the size while the print keeps its size on screen.
    const k = POD.sizeView(st.product, st.sizeId);
    const base = focus
      ? Math.min((stage.clientWidth - 16) / (a.w + 48), (stage.clientHeight - 16) / (a.h + 48 + (zoneOf() ? 40 : 0))) / k
      : Math.min((stage.clientWidth - 32) / W, (stage.clientHeight - 32) / H, 1.6);
    const z = Math.max(0.15, base) * st.zoom;
    canvas.setDimensions({ width: Math.round(W * z), height: Math.round(H * z) });
    canvas.setViewportTransform([z * k, 0, 0, z * k, (W * z * (1 - k)) / 2, (H * z * (1 - k)) / 2]);
    requestAnimationFrame(() => typeof positionFloatBar === 'function' && positionFloatBar());
    if (focus) {
      const vt = canvas.viewportTransform;
      stage.scrollLeft = (a.x + a.w / 2) * vt[0] + vt[4] - stage.clientWidth / 2;
      stage.scrollTop = (a.y + a.h / 2 + (zoneOf() ? 20 : 0)) * vt[3] + vt[5] - stage.clientHeight / 2;
    }
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

  /** Trim (the print edge), bleed (artwork that gets trimmed off) and safe zone, in mockup units. */
  function rects(sideId) {
    const sd = sideDef(sideId);
    const a = sd.printArea;
    const u = a.w / sd.printWidthIn; // units per inch
    const b = (sd.bleedIn || 0) * u;
    const sf = (sd.safeIn || 0) * u;
    return {
      u, b, sf,
      trim: a,
      bleed: { x: a.x - b, y: a.y - b, w: a.w + 2 * b, h: a.h + 2 * b, rx: a.rx ? a.rx + b : 0 },
      safe: { x: a.x + sf, y: a.y + sf, w: a.w - 2 * sf, h: a.h - 2 * sf, rx: a.rx ? Math.max(0, a.rx - sf) : 0 },
    };
  }
  // While editing, artwork shows into the bleed; the preview shows the trimmed result.
  const currentClip = () => (st.preview ? rects().trim : rects().bleed);
  function applyClips(r = currentClip()) {
    canvas.getObjects().forEach((o) => {
      if (o.name === '__cropper') return;
      o.clipPath = clipRect(r);
      o.dirty = true;
      if (o.type === 'group') o.getObjects().forEach((c) => { c.clipPath = null; c.dirty = true; });
    });
    canvas.requestRenderAll();
  }
  function pathRect(ctx, r) {
    ctx.beginPath();
    if (ctx.roundRect && r.rx) ctx.roundRect(r.x, r.y, r.w, r.h, r.rx);
    else ctx.rect(r.x, r.y, r.w, r.h);
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
    if (crop) {
      const f = crop.full;
      const r = cropRect();
      ctx.fillStyle = 'rgba(15, 17, 22, .55)';
      ctx.beginPath();
      ctx.rect(f.L, f.T, f.W, f.H);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill('evenodd');
    }
    const R = rects();
    // Bleed: solid blue line outside the print edge.
    if (R.b) {
      ctx.setLineDash([]);
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = 'rgba(28, 126, 214, .85)';
      pathRect(ctx, R.bleed);
      ctx.stroke();
    }
    // Safe zone: green dashed line inside the print edge.
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.lineWidth = 1 * px;
    ctx.strokeStyle = 'rgba(47, 158, 68, .9)';
    pathRect(ctx, R.safe);
    ctx.stroke();
    // Print edge.
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(255, 90, 54, .9)';
    pathRect(ctx, a);
    ctx.stroke();
    // Elements with print problems get a red outline.
    if (st.issueObjs && st.issueObjs.size) {
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(224, 49, 49, .95)';
      for (const o of st.issueObjs) {
        if (!canvas.contains(o)) continue;
        const r = absRect(o);
        ctx.strokeRect(r.left - 3 * px, r.top - 3 * px, r.width + 6 * px, r.height + 6 * px);
      }
    }
    // DPI badge on the selected photo.
    const sel = canvas.getActiveObject();
    if (sel && sel.type === 'image' && !crop) {
      const dpi = imageDpi(sel);
      const r = sel.getBoundingRect(true, true);
      const txt = `${dpi} DPI`;
      ctx.setLineDash([]);
      ctx.font = `700 ${10 * px}px system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width + 10 * px;
      const bx = r.left;
      const by = Math.max(r.top - 22 * px, 2 * px);
      ctx.fillStyle = dpi >= 150 ? '#2f9e44' : dpi >= 100 ? '#e67700' : '#e03131';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 16 * px, 8 * px); else ctx.rect(bx, by, tw, 16 * px);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText(txt, bx + 5 * px, by + 11.5 * px);
    }
    // Movable print area: a handle under the box (and the allowed zone while dragging).
    st.handleRect = null;
    const zone = zoneOf();
    if (zone && !crop) {
      if (st.movingArea) {
        ctx.setLineDash([2 * px, 4 * px]);
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = 'rgba(255, 90, 54, .55)';
        ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
        // Centre guides: the middle of the garment (up and down) and of the
        // zone (across); solid pink when the print box is snapped to them.
        const g = areaGuides();
        const snap = st.areaSnap || {};
        const guide = (on, x1, y1, x2, y2) => {
          ctx.setLineDash(on ? [] : [5 * px, 4 * px]);
          ctx.lineWidth = (on ? 1.5 : 1) * px;
          ctx.strokeStyle = on ? '#e64980' : 'rgba(230, 73, 128, .45)';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        };
        guide(snap.x, g.x, zone.y, g.x, zone.y + zone.h);
        guide(snap.y, zone.x, g.y, zone.x + zone.w, g.y);
      }
      const label = '✥ ' + t('area.drag');
      ctx.setLineDash([]);
      ctx.font = `700 ${11 * px}px Cairo, system-ui, sans-serif`;
      const hw = ctx.measureText(label).width + 22 * px;
      const hh = 24 * px;
      const hx = a.x + a.w / 2 - hw / 2;
      const hy = Math.min(a.y + a.h + 8 * px, H - hh - 2 * px);
      st.handleRect = { x: hx, y: hy, w: hw, h: hh };
      ctx.fillStyle = st.movingArea ? '#d9480f' : 'rgba(255, 90, 54, .95)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(hx, hy, hw, hh, hh / 2); else ctx.rect(hx, hy, hw, hh);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.direction = POD.lang === 'ar' ? 'rtl' : 'ltr';
      ctx.fillText(label, hx + hw / 2, hy + 16 * px);
    }
    const s = sideDef();
    ctx.font = `600 ${11 * px}px Cairo, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 90, 54, .95)';
    const dims = { w: POD.num(s.printWidthIn * 2.54), h: POD.num(s.printHeightIn * 2.54) };
    let label = t('printArea', dims);
    if (ctx.measureText(label).width > a.w + 30 * px) label = t('printAreaShort', dims);
    const rtl = POD.lang === 'ar';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.fillText(label, rtl ? a.x + a.w : a.x, a.y - 6 * px);
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

  // ---------- Moving the print area (garments and bags) ----------
  function zoneOf(id = st.side) {
    return (baseSide(id) && baseSide(id).moveZone) || null;
  }
  const areaUnitsPerCm = (id = st.side) => areaFor(st.product, id, st.sizeId, null).w / (sideDef(id).printWidthIn * 2.54);
  /** Keep the print area inside the side's allowed zone. */
  function clampOffset(dx, dy, id = st.side) {
    const z = zoneOf(id);
    if (!z) return { dx: 0, dy: 0 };
    const a = areaFor(st.product, id, st.sizeId, null);
    const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, Math.min(lo, 0)), Math.max(hi, 0)));
    return { dx: clamp(dx, z.x - a.x, z.x + z.w - a.w - a.x), dy: clamp(dy, z.y - a.y, z.y + z.h - a.h - a.y) };
  }
  /** Where the centre guides are while dragging the print area. */
  function areaGuides(id = st.side) {
    const z = zoneOf(id);
    return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  }
  /** Snap a dragged offset so the print box's centre sits on a guide when it is close. */
  function snapOffset(dx, dy) {
    const a = areaFor(st.product, st.side, st.sizeId, null);
    const g = areaGuides();
    const th = SNAP_PX / canvas.getZoom();
    const cx = a.x + a.w / 2 + dx;
    const cy = a.y + a.h / 2 + dy;
    const snap = { x: Math.abs(cx - g.x) < th, y: Math.abs(cy - g.y) < th };
    st.areaSnap = snap;
    return { dx: snap.x ? g.x - a.x - a.w / 2 : dx, dy: snap.y ? g.y - a.y - a.h / 2 : dy };
  }
  /** Put the print area at this offset; the design moves with it. */
  function moveArea(dx, dy) {
    const cur = st.offsets[st.side] || { dx: 0, dy: 0 };
    const next = clampOffset(dx, dy);
    const ddx = next.dx - cur.dx;
    const ddy = next.dy - cur.dy;
    if (!ddx && !ddy) return false;
    if (next.dx || next.dy) st.offsets[st.side] = next;
    else delete st.offsets[st.side];
    canvas.discardActiveObject();
    canvas.getObjects().forEach((o) => {
      if (o.name === '__cropper') return;
      o.set({ left: o.left + ddx, top: o.top + ddy });
      o.setCoords();
    });
    applyClips();
    renderPlacement();
    if (typeof hideFloatBar === 'function') hideFloatBar();
    return true;
  }
  function renderPlacement() {
    const box = $('place-field');
    if (!box) return;
    const z = zoneOf();
    box.hidden = !z;
    if (!z) return;
    const o = st.offsets[st.side] || { dx: 0, dy: 0 };
    const u = areaUnitsPerCm();
    const x = Math.round((o.dx / u) * 2) / 2;
    const y = Math.round((o.dy / u) * 2) / 2;
    const parts = [];
    if (y) parts.push(t(y > 0 ? 'area.lower' : 'area.higher', { n: POD.num(Math.abs(y)) }));
    if (x) parts.push(t(x > 0 ? 'area.right' : 'area.left', { n: POD.num(Math.abs(x)) }));
    $('place-info').textContent = parts.length ? t('area.moved', { v: parts.join(POD.lang === 'ar' ? ' و' : ', ') }) : t('area.standard');
    $('place-reset').disabled = !parts.length;
  }
  {
    // Drag the handle under the print area (mouse and touch). Caught before Fabric sees it.
    let drag = null;
    const onHandle = (e) => {
      const r = st.handleRect;
      if (!r || st.preview || crop || !zoneOf()) return false;
      const p = canvas.getPointer(e);
      const pad = 6 / canvas.getZoom();
      return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
    };
    const start = (e) => {
      if (drag || !e.isPrimary || !onHandle(e)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      const p = canvas.getPointer(e);
      const o = st.offsets[st.side] || { dx: 0, dy: 0 };
      drag = { x: p.x, y: p.y, dx: o.dx, dy: o.dy };
      st.movingArea = true;
      canvas.requestRenderAll();
    };
    const move = (e) => {
      if (!drag) return;
      if (e.cancelable) e.preventDefault();
      const p = canvas.getPointer(e);
      const to = snapOffset(drag.dx + p.x - drag.x, drag.dy + p.y - drag.y);
      if (!moveArea(to.dx, to.dy)) canvas.requestRenderAll();
    };
    const end = () => {
      if (!drag) return;
      drag = null;
      st.movingArea = false;
      st.areaSnap = null;
      commit();
      canvas.requestRenderAll();
    };
    // Pointer events drive the drag; the mouse/touch events Fabric listens to are stopped while it runs.
    canvas.wrapperEl.addEventListener('pointerdown', start, { capture: true });
    for (const ev of ['mousedown', 'touchstart']) {
      canvas.wrapperEl.addEventListener(ev, (e) => { if (drag) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    canvas.on('mouse:move', (opt) => { if (!drag && onHandle(opt.e)) canvas.setCursor('grab'); });
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nudge]');
    if (n || e.target.closest('#place-reset')) cancelCrop();
    if (n) {
      const [sx, sy] = n.dataset.nudge.split(',').map(Number);
      const o = st.offsets[st.side] || { dx: 0, dy: 0 };
      const u = areaUnitsPerCm();
      if (moveArea(o.dx + sx * u, o.dy + sy * u)) commit();
      return;
    }
    if (e.target.closest('#place-reset') && moveArea(0, 0)) commit();
  });

  // Snap to the centre and edges of the print area while dragging.
  canvas.on('object:moving', (e) => {
    const o = e.target;
    if (crop && o === crop.cropper) return clampCropper();
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
    // ...and to the centres and edges of the other elements.
    const moving = new Set(o.type === 'activeSelection' ? o.getObjects() : [o]);
    for (const other of canvas.getObjects()) {
      if (moving.has(other) || other.name === '__cropper' || other.visible === false) continue;
      const q = other.getBoundingRect(true, true);
      const qc = { x: q.left + q.width / 2, y: q.top + q.height / 2 };
      tryX(c.x, qc.x);
      tryX(r.left, q.left);
      tryX(r.left + r.width, q.left + q.width);
      tryX(r.left, q.left + q.width);
      tryX(r.left + r.width, q.left);
      tryY(c.y, qc.y);
      tryY(r.top, q.top);
      tryY(r.top + r.height, q.top + q.height);
      tryY(r.top, q.top + q.height);
      tryY(r.top + r.height, q.top);
      if (dx && dy) break;
    }
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

  /**
   * The real product photo, recoloured, placed so its measured print area
   * sits exactly on the side's print area. Dark parts that are never printed
   * on (camera lenses) go on top as the overlay.
   */
  async function photoMockup(cfg, side, hex) {
    const P = window.POD_PHOTOS;
    const at = P.placement(cfg, baseSide(side.id).printArea);
    const [cv, dark] = await Promise.all([
      P.render(cfg, hex, { width: 1000, cutout: true }),
      cfg.keepDark ? P.darkOverlay(cfg, 1000) : null,
    ]);
    const image = (el) => new fabric.Image(el, {
      originX: 'left', originY: 'top', left: at.x, top: at.y, scaleX: at.kx / el.scale, scaleY: at.ky / el.scale,
    });
    return [image(cv), dark ? image(dark) : null];
  }

  let mockupToken = 0;
  async function applyMockup(sideId = st.side) {
    const token = ++mockupToken;
    const side = sideDef(sideId);
    const hex = color().hex;
    let bg;
    let ov;
    const photo = window.POD_PHOTOS && window.POD_PHOTOS.forSide ? window.POD_PHOTOS.forSide(st.product.id, side.id) : null;
    if (photo) {
      try {
        [bg, ov] = await photoMockup(photo, side, hex);
      } catch (e) {
        bg = null;
      }
    }
    if (!bg) {
      [bg, ov] = await Promise.all([
        fabricImage(POD.mockupUrl(side, hex)),
        side.overlay ? fabricImage(POD.mockupUrl(side, hex, 'overlay')) : null,
      ]);
    }
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
    e.target.clipPath = clipRect(currentClip());
    if (!st.silent) commit();
  });
  canvas.on('object:removed', () => !st.silent && commit());
  canvas.on('object:modified', (e) => {
    if (crop && e.target === crop.cropper) {
      clampCropper();
      canvas.requestRenderAll();
      return;
    }
    commit();
  });
  canvas.on('text:changed', (e) => {
    fixArabic(e.target);
    renderLayers();
    syncTextField();
    scheduleCommit();
  });
  // Curved text is edited straight, then bends back when editing ends.
  canvas.on('text:editing:entered', (e) => { e.target.initDimensions(); e.target.setCoords(); canvas.requestRenderAll(); });
  canvas.on('text:editing:exited', (e) => { e.target.initDimensions(); e.target.setCoords(); canvas.requestRenderAll(); commit(); });
  ['selection:created', 'selection:updated'].forEach((ev) => canvas.on(ev, () => {
    canvas.getActiveObjects().forEach(applyRatioLock);
    st.wordSel = null;
    renderProps();
    renderLayers();
    scheduleCheck();
    // Phones: a newly added element opens its settings; tapping an existing
    // one shows the floating bar, which has a button for the settings.
    if (MOBILE.matches && st.openSheetOnSelect) setSheet('props');
    st.openSheetOnSelect = false;
    renderFloatBar();
  }));
  let lastCleared = null;
  canvas.on('selection:cleared', (e) => {
    if (st.reselecting) return;
    lastCleared = { objs: e.deselected || [], at: Date.now(), sheet: st.sheet };
    if (crop) {
      canvas.setActiveObject(crop.cropper);
      return;
    }
    renderProps();
    renderLayers();
    scheduleCheck();
    if (st.sheet === 'props') setSheet(null);
    renderFloatBar();
  });
  // Hide the floating bar while dragging, bring it back afterwards.
  ['object:moving', 'object:scaling', 'object:rotating'].forEach((ev) => canvas.on(ev, () => { st.dragging = true; hideFloatBar(); }));
  canvas.on('mouse:up', () => { if (st.dragging) { st.dragging = false; renderFloatBar(); } });
  canvas.on('text:editing:entered', hideFloatBar);
  canvas.on('text:editing:exited', () => renderFloatBar());
  canvas.on('object:scaling', updateQuality);
  ['object:moving', 'object:scaling', 'object:rotating'].forEach((ev) => canvas.on(ev, () => scheduleCheck()));
  canvas.on('object:rotating', (e) => { const r = $('p-angle'); if (r) r.value = Math.round(e.target.angle); });

  // ---------- History (per side) ----------
  function hist() {
    return (st.history[st.side] ||= { stack: [], i: -1 });
  }
  function seedHistory() {
    const h = hist();
    if (!h.stack.length) {
      h.stack.push(snapshot());
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
    if (st.silent || crop) return;
    const snap = snapshot();
    const h = hist();
    if (h.stack[h.i] !== snap) {
      h.stack = h.stack.slice(0, h.i + 1);
      h.stack.push(snap);
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
      h.i = h.stack.length - 1;
      st.dirty = true;
    }
    st.designs[st.side] = JSON.parse(snap).o;
    refreshChrome();
    schedulePatternPreview();
  }
  function snapshot() {
    return JSON.stringify({ o: serialize(), a: st.offsets[st.side] || null });
  }
  async function stepHistory(delta) {
    cancelCrop();
    hideFloatBar();
    commit();
    const h = hist();
    const next = h.i + delta;
    if (next < 0 || next >= h.stack.length) return;
    h.i = next;
    const snap = JSON.parse(h.stack[h.i]);
    if (snap.a) st.offsets[st.side] = snap.a;
    else delete st.offsets[st.side];
    await loadObjects(snap.o);
    st.designs[st.side] = snap.o;
    renderPlacement();
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
    if (select) st.openSheetOnSelect = true;
    cancelCrop();
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
    const a = rects().bleed; // fill into the bleed so no white edge is left after trimming
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
    await addTemplate(D.TEMPLATES[Number(btn.dataset.tpl)]);
  }));
  /** Put a template's (or an AI logo's) elements on the product, selected together. */
  async function addTemplate(tpl) {
    cancelCrop();
    const objs = await D.buildTemplate(tpl, area(), inkFor(surfaceHex()));
    if (!objs.length) return;
    st.silent = true;
    canvas.discardActiveObject();
    objs.forEach((o) => canvas.add(o));
    st.silent = false;
    canvas.setActiveObject(objs.length > 1 ? new fabric.ActiveSelection(objs, { canvas }) : objs[0]);
    canvas.requestRenderAll();
    commit();
    closeFlyouts();
    if (st.preview) togglePreview();
  }

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
  // Illustrator and EPS files: the server draws them to a transparent PNG first.
  const isVectorFile = (file) => /\.(ai|eps|epsf|ps)$/i.test(file.name || '') || /postscript|illustrator/.test(file.type || '');
  async function convertVectorFile(file) {
    if (file.size > MAX_VECTOR_BYTES) throw new Error(t('msg.tooBigVector'));
    busy(true, t('busy.artwork'));
    try {
      const res = await fetch('/api/artwork', {
        method: 'POST',
        headers: { 'x-lang': POD.lang, 'x-max-px': String(MAX_UPLOAD_PX), 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) {
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
        throw new Error((body && body.error) || t('msg.badImage'));
      }
      const blob = await res.blob();
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
    } finally {
      busy(false);
    }
  }
  async function addImageFile(file, { source } = {}) {
    if (!file) return;
    if (isVectorFile(file)) {
      try {
        file = await convertVectorFile(file);
      } catch (e) {
        return toast(e.message, 'error');
      }
    }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) && !/\.(jpe?g)$/i.test(file.name || '')) return toast(t('msg.badType'), 'error');
    if (file.size > MAX_UPLOAD_BYTES) return toast(t('msg.tooBig'), 'error');
    const srcUrl = URL.createObjectURL(file);
    try {
      const img = await loadHtmlImage(srcUrl);
      const scale = Math.min(1, MAX_UPLOAD_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const jpeg = file.type === 'image/jpeg' || (!file.type && /\.jpe?g$/i.test(file.name || ''));
      const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      const fimg = await new Promise((resolve) => fabric.Image.fromURL(URL.createObjectURL(blob), resolve));
      fimg.set({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image', ...(source ? { importSource: source } : {}) });
      const a = area();
      fimg.scale(Math.min((a.w * 0.8) / fimg.width, (a.h * 0.8) / fimg.height));
      addObject(fimg);
      const dpi = imageDpi(fimg);
      if (dpi < 100) toast(t('msg.lowResToast', { dpi }), 'error');
      // "Remove the background of my photos" is ticked in the upload panel.
      if ($('auto-bg') && $('auto-bg').checked && !/\.png$/i.test(file.name || '')) await removeImageBackground(fimg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }
  // ---------- Import a picture from a link (another site's product page or an image link) ----------
  $('imp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('imp-url').value.trim();
    if (!url) return;
    const box = $('imp-results');
    box.innerHTML = `<div class="muted small"><span class="spinner spinner-sm"></span> ${esc(t('imp.loading'))}</div>`;
    try {
      const r = await POD.api('/api/import/link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ url }) });
      box.innerHTML = `<div class="muted small" style="margin-bottom:6px">${esc(t('imp.pick'))}</div><div class="imp-grid">${r.images.map((u) => `<button type="button" class="imp-pick" data-src="${esc(u)}"><img alt="" loading="lazy" src="/api/import/image?thumb=1&url=${encodeURIComponent(u)}"></button>`).join('')}</div>`;
      box.dataset.page = url;
      // Pictures that fail to load (blocked, not a picture) are hidden.
      box.querySelectorAll('.imp-pick img').forEach((img) => img.addEventListener('error', () => img.parentElement.remove()));
    } catch (err) {
      box.innerHTML = `<div class="small" style="color:var(--danger,#e03131);line-height:1.6">${esc(err.message)}</div>`;
    }
  });
  $('imp-results').addEventListener('click', async (e) => {
    const b = e.target.closest('.imp-pick');
    if (!b) return;
    busy(true, t('imp.adding'));
    try {
      const res = await fetch(`/api/import/image?url=${encodeURIComponent(b.dataset.src)}`, { headers: { 'x-lang': POD.lang, 'x-max-px': String(MAX_UPLOAD_PX) } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('msg.badImage'));
      const blob = await res.blob();
      const file = new File([blob], 'Imported.' + (blob.type === 'image/png' ? 'png' : 'jpg'), { type: blob.type });
      busy(false);
      await addImageFile(file, { source: $('imp-results').dataset.page || b.dataset.src });
      toast(t('imp.cleanTip'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(false);
    }
  });
  /** True when any side uses a picture imported from another site. */
  const hasImports = () => st.product.sides.some((sd) => (sd.id === st.side ? serialize() : st.designs[sd.id] || []).some((o) => o && o.importSource));
  /** Ask the customer to confirm the rights to imported pictures (resolves true/false). */
  function confirmRights() {
    return new Promise((resolve) => {
      const m = $('rights');
      $('rights-check').checked = false;
      $('rights-ok').disabled = true;
      m.hidden = false;
      const done = (ok) => {
        m.hidden = true;
        $('rights-ok').onclick = null;
        $('rights-cancel').onclick = null;
        resolve(ok);
      };
      $('rights-check').onchange = () => { $('rights-ok').disabled = !$('rights-check').checked; };
      $('rights-ok').onclick = () => done(true);
      $('rights-cancel').onclick = () => done(false);
    });
  }

  // Remembered in this browser.
  try { $('auto-bg').checked = localStorage.getItem('pod-auto-bg') === '1'; } catch (e) { /* private mode */ }
  $('auto-bg').addEventListener('change', (e) => { try { localStorage.setItem('pod-auto-bg', e.target.checked ? '1' : '0'); } catch (err) { /* private mode */ } });
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

  // ---------- Flyouts ----------
  function closeFlyouts() {
    document.querySelectorAll('.flyout').forEach((f) => (f.hidden = true));
    document.querySelectorAll('.tool').forEach((x) => x.classList.remove('open'));
  }
  let templatesRendered = false;
  document.querySelectorAll('.tool[data-flyout]').forEach((btn) => {
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
  document.querySelectorAll('.flyout .fly-close').forEach((b) => b.addEventListener('click', closeFlyouts));

  // ---------- Stickers ----------
  const SK = window.POD_STICKERS;
  let stickerCat = 'all';
  function renderStickers() {
    $('sticker-cats').innerHTML = [{ id: 'all', name: null }, ...SK.CATEGORIES]
      .map((c) => `<button class="chip ${c.id === stickerCat ? 'active' : ''}" data-scat="${c.id}">${esc(c.name ? tr(c.name) : t('cat.all'))}</button>`).join('');
    $('sticker-grid').innerHTML = SK.STICKERS.filter((s) => stickerCat === 'all' || s.cat === stickerCat)
      .map((s) => `<button class="sticker-btn" data-sticker="${s.id}" title="${esc(tr(s.name))}" aria-label="${esc(tr(s.name))}"><img alt="" loading="lazy" src="${SK.thumbUrl(s)}"></button>`).join('');
  }
  $('sticker-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scat]');
    if (!b) return;
    stickerCat = b.dataset.scat;
    renderStickers();
  });
  $('sticker-grid').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-sticker]');
    if (!b) return;
    const obj = await SK.makeSticker(SK.STICKERS.find((x) => x.id === b.dataset.sticker));
    const a = area();
    obj.scale(Math.min((a.w * 0.42) / obj.width, (a.h * 0.42) / obj.height));
    addObject(obj);
  }));

  // ---------- Library: search icons, stickers and templates (Arabic or English) ----------
  const lib = { type: 'all', q: '', page: 0, items: [], token: 0, designs: null };
  const libSvg = (it, color) => {
    const body = color ? it.body.replace(/currentColor/g, color) : it.body;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${it.w} ${it.h}" width="${it.w * 8}" height="${it.h * 8}">${body}</svg>`;
  };
  const libThumb = (it) => `<button type="button" class="sticker-btn lib-item" data-lib="${esc(it.id)}" title="${esc(it.id.split(':')[1].replace(/-/g, ' '))}"><img alt="" loading="lazy" src="${POD.svgDataUrl(libSvg(it, it.kind === 'icon' ? '#16181d' : null))}"></button>`;
  const LIB_RECENT = 'pod-lib-recent';
  const libRecent = () => { try { return JSON.parse(localStorage.getItem(LIB_RECENT) || '[]'); } catch (e) { return []; } };
  function rememberLib(it) {
    try { localStorage.setItem(LIB_RECENT, JSON.stringify([it, ...libRecent().filter((x) => x.id !== it.id)].slice(0, 12))); } catch (e) { /* private mode */ }
  }
  /** Templates and ready designs whose names match (searched here, they are few). */
  async function libTemplates(q) {
    if (!lib.designs) lib.designs = await POD.api('/api/library').then((r) => r.designs).catch(() => []);
    const norm = (x) => String(x || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (names) => !words.length || words.every((w) => names.some((n) => norm(n).includes(w)));
    const tpls = D.TEMPLATES.filter((x) => hit([x.name.en, x.name.ar])).map((x) => ({ kind: 'tpl', id: 'tpl:' + x.id, tpl: x, name: x.name }));
    const ready = lib.designs.filter((d) => hit([d.name.en, d.name.ar, d.category])).map((d) => ({ kind: 'ready', id: 'lib:' + d.id, design: d, name: d.name }));
    return [...ready, ...tpls];
  }
  async function libSearch(more) {
    const my = ++lib.token;
    if (!more) {
      lib.page = 0;
      lib.items = [];
      $('lib-grid').innerHTML = '<div class="pv-loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
    }
    const recent = libRecent();
    $('lib-recent-box').hidden = Boolean(lib.q) || lib.type === 'template' || !recent.length;
    if (!$('lib-recent-box').hidden) $('lib-recent').innerHTML = recent.map(libThumb).join('');
    try {
      if (lib.type === 'template') {
        const list = await libTemplates(lib.q);
        if (my !== lib.token) return;
        $('lib-status').textContent = list.length ? '' : t('lib.none');
        $('lib-grid').innerHTML = list.map((x) => `<button type="button" class="sticker-btn lib-tpl" data-libtpl="${esc(x.id)}" title="${esc(tr(x.name))}"><img alt="" data-tplthumb="${esc(x.id)}"><span>${esc(tr(x.name))}</span></button>`).join('');
        lib.tplList = list;
        for (const x of list) {
          const img = $('lib-grid').querySelector(`[data-tplthumb="${CSS.escape(x.id)}"]`);
          if (!img) continue;
          if (x.kind === 'ready' && x.design.kind !== 'template') img.src = x.design.preview;
          else D.templateThumb(x.kind === 'tpl' ? x.tpl : { id: x.design.id, items: x.design.items, aspect: x.design.aspect }).then((u) => { img.src = u; }).catch(() => {});
        }
        $('lib-more').hidden = true;
        return;
      }
      const r = await POD.api(`/api/assets/search?q=${encodeURIComponent(lib.q)}&type=${lib.type}&page=${lib.page}`);
      if (my !== lib.token) return;
      lib.items.push(...r.items);
      $('lib-status').textContent = !lib.items.length ? t('lib.none') : lib.q ? t('lib.count', { n: POD.num(r.total) }) : t('lib.popular');
      $('lib-grid').innerHTML = lib.items.map(libThumb).join('');
      $('lib-more').hidden = !r.more;
    } catch (e) {
      if (my === lib.token) $('lib-grid').innerHTML = `<p class="small muted" style="grid-column:1/-1">${esc(e.message)}</p>`;
    }
  }
  let libTimer = null;
  $('lib-q').addEventListener('input', () => {
    clearTimeout(libTimer);
    libTimer = setTimeout(() => {
      lib.q = $('lib-q').value.trim();
      libSearch(false);
    }, 250);
  });
  $('lib-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ltype]');
    if (!b || b.dataset.ltype === lib.type) return;
    lib.type = b.dataset.ltype;
    document.querySelectorAll('#lib-types [data-ltype]').forEach((x) => x.classList.toggle('active', x === b));
    libSearch(false);
  });
  $('lib-more').addEventListener('click', () => {
    lib.page++;
    libSearch(true);
  });
  /** Put an icon (in the product's ink colour) or a colourful sticker on the design. */
  async function addLibItem(it) {
    const svg = libSvg(it, it.kind === 'icon' ? inkFor(surfaceHex()) : null);
    const obj = await new Promise((resolve) => fabric.loadSVGFromString(svg, (objects, options) => resolve(fabric.util.groupSVGElements(objects, options))));
    obj.set({ name: (it.kind === 'icon' ? 'icon:' : 'sticker:') + it.id.split(':')[1] });
    const a = area();
    obj.scale(Math.min((a.w * 0.4) / obj.width, (a.h * 0.4) / obj.height));
    addObject(obj);
    rememberLib(it);
  }
  const libClick = serial(async (e) => {
    const b = e.target.closest('[data-lib]');
    if (b) {
      const it = lib.items.find((x) => x.id === b.dataset.lib) || libRecent().find((x) => x.id === b.dataset.lib);
      if (it) await addLibItem(it);
      return;
    }
    const tb = e.target.closest('[data-libtpl]');
    if (!tb || !lib.tplList) return;
    const x = lib.tplList.find((y) => y.id === tb.dataset.libtpl);
    if (!x) return;
    if (x.kind === 'tpl') return addTemplate(x.tpl);
    const full = await POD.api('/api/library/' + encodeURIComponent(x.design.id));
    if (full.kind === 'template') return addTemplate({ id: full.id, items: full.items, aspect: full.aspect });
    await loadObjects([...serialize(), ...remap(full.objects || [], full.area || area(), area())]);
    commit();
  });
  $('lib-grid').addEventListener('click', libClick);
  $('lib-recent').addEventListener('click', libClick);
  let libStarted = false;
  document.querySelector('.tool[data-flyout="library"]').addEventListener('click', () => {
    if (!libStarted) {
      libStarted = true;
      libSearch(false);
    }
    setTimeout(() => $('lib-q').focus(), 50);
  });

  // ---------- Phone layout: slide-up panel ----------
  function syncSheetTitle() {
    if (st.sheet) $('sheet-title').textContent = st.sheet === 'product' ? t('sheet.product') : $('props-title').textContent;
  }
  function setSheet(mode) {
    st.sheet = mode;
    document.body.classList.toggle('sheet-props', mode === 'props');
    document.body.classList.toggle('sheet-product', mode === 'product');
    document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('open', b.dataset.sheet === mode));
    syncSheetTitle();
    requestAnimationFrame(() => { fit(); renderFloatBar(); });
  }
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => {
    closeFlyouts();
    if (st.sheet === b.dataset.sheet) return setSheet(null);
    cancelCrop();
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSheet(b.dataset.sheet);
  }));
  // Closing the settings keeps the element selected, with its floating bar.
  $('sheet-close').addEventListener('click', () => {
    if (st.sheet === 'props') cancelCrop();
    setSheet(null);
  });
  MOBILE.addEventListener('change', () => setSheet(null));

  // Two-finger pinch zooms and pans the view.
  const stageEl = $('stage');
  let pinch = null;
  const tDist = (tt) => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);
  const tMid = (tt) => ({ x: (tt[0].clientX + tt[1].clientX) / 2, y: (tt[0].clientY + tt[1].clientY) / 2 });
  stageEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinch = { d: tDist(e.touches), z: st.zoom, m: tMid(e.touches), sl: stageEl.scrollLeft, stp: stageEl.scrollTop };
    e.preventDefault();
    e.stopPropagation();
    // The first finger reached the canvas a moment earlier: undo whatever it started.
    canvas._currentTransform = null;
    const recent = lastCleared && Date.now() - lastCleared.at < 400 ? lastCleared.objs.filter((o) => canvas.contains(o)) : [];
    if (recent.length && !canvas.getActiveObject()) {
      if (lastCleared.sheet === 'props') st.openSheetOnSelect = true;
      canvas.setActiveObject(recent.length === 1 ? recent[0] : new fabric.ActiveSelection(recent, { canvas }));
    }
    canvas.requestRenderAll();
  }, { passive: false, capture: true });
  stageEl.addEventListener('touchmove', (e) => {
    if (!pinch) return;
    // Keep the canvas out of it until every finger has lifted, so the selection survives.
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length !== 2) return;
    setZoom(pinch.z * (tDist(e.touches) / pinch.d));
    const m = tMid(e.touches);
    stageEl.scrollLeft = pinch.sl - (m.x - pinch.m.x);
    stageEl.scrollTop = pinch.stp - (m.y - pinch.m.y);
  }, { passive: false, capture: true });
  const endPinch = (e) => {
    if (!pinch) return;
    e.stopPropagation();
    if (e.touches.length === 0) pinch = null;
  };
  stageEl.addEventListener('touchend', endPinch, { capture: true });
  stageEl.addEventListener('touchcancel', endPinch, { capture: true });

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

  // ---------- Layout: exact size in cm, alignment, distribution, groups ----------
  const unitsPerCm = () => rects().u / 2.54;
  function boxOf(o) {
    o.setCoords();
    return o.getBoundingRect(true, true);
  }
  /** Keep proportions: by default for text, photos, stickers and groups; shapes can stretch. */
  const ratioLocked = (o) => (typeof o.lockRatio === 'boolean' ? o.lockRatio : isText(o) || o.type === 'image' || o.type === 'group' || isSticker(o));
  function applyRatioLock(o) {
    if (!o || o.type === 'activeSelection' || !o.setControlsVisibility) return;
    const free = !ratioLocked(o);
    o.setControlsVisibility({ ml: free, mr: free, mt: free, mb: free });
  }
  function sizeCm(o) {
    const u = unitsPerCm();
    const r = boxOf(o);
    const a = area();
    return { w: o.getScaledWidth() / u, h: o.getScaledHeight() / u, x: (r.left - a.x) / u, y: (r.top - a.y) / u };
  }
  function setSizeCm(o, dim, cm) {
    const u = unitsPerCm();
    const c = o.getCenterPoint();
    const target = Math.max(0.2, cm) * u;
    // The measured size includes outlines, so correct the scale until it matches.
    for (let i = 0; i < 3; i++) {
      const now = dim === 'w' ? o.getScaledWidth() : o.getScaledHeight();
      if (!now || Math.abs(now - target) < 0.01) break;
      const k = target / now;
      if (dim === 'w') o.set(ratioLocked(o) ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleX: o.scaleX * k });
      else o.set(ratioLocked(o) ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleY: o.scaleY * k });
    }
    o.setPositionByOrigin(c, 'center', 'center');
    o.setCoords();
  }
  function setPosCm(o, axis, cm) {
    const u = unitsPerCm();
    const r = boxOf(o);
    const a = area();
    if (axis === 'x') o.set({ left: o.left + (a.x + cm * u - r.left) });
    else o.set({ top: o.top + (a.y + cm * u - r.top) });
    o.setCoords();
  }
  /** Run fn on the loose objects of the selection, then select them again. */
  function onSelectedObjects(fn) {
    const sel = active();
    if (!sel) return;
    const objs = canvas.getActiveObjects();
    const multi = sel.type === 'activeSelection';
    st.reselecting = true;
    if (multi) canvas.discardActiveObject();
    fn(objs);
    objs.forEach((o) => o.setCoords());
    if (multi) canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
    st.reselecting = false;
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderFloatBar();
  }
  function unionBox(objs) {
    const rs = objs.map(boxOf);
    const left = Math.min(...rs.map((r) => r.left));
    const top = Math.min(...rs.map((r) => r.top));
    return { left, top, width: Math.max(...rs.map((r) => r.left + r.width)) - left, height: Math.max(...rs.map((r) => r.top + r.height)) - top };
  }
  /** Align to the selection's own box (several elements) or to the print area (one element). */
  function alignSelected(how) {
    onSelectedObjects((objs) => {
      const a = area();
      const box = objs.length > 1 ? unionBox(objs) : { left: a.x, top: a.y, width: a.w, height: a.h };
      for (const o of objs) {
        const r = boxOf(o);
        let dx = 0;
        let dy = 0;
        if (how === 'left') dx = box.left - r.left;
        if (how === 'right') dx = box.left + box.width - (r.left + r.width);
        if (how === 'hcenter') dx = box.left + box.width / 2 - (r.left + r.width / 2);
        if (how === 'top') dy = box.top - r.top;
        if (how === 'bottom') dy = box.top + box.height - (r.top + r.height);
        if (how === 'vcenter') dy = box.top + box.height / 2 - (r.top + r.height / 2);
        o.set({ left: o.left + dx, top: o.top + dy });
      }
    });
  }
  /** Equal gaps between three or more elements. */
  function distributeSelected(axis) {
    onSelectedObjects((objs) => {
      if (objs.length < 3) return;
      const k = axis === 'h' ? ['left', 'width'] : ['top', 'height'];
      const items = objs.map((o) => ({ o, r: boxOf(o) })).sort((p, q) => p.r[k[0]] - q.r[k[0]]);
      const first = items[0].r;
      const last = items[items.length - 1].r;
      const total = items.reduce((sum, it) => sum + it.r[k[1]], 0);
      const gap = (last[k[0]] + last[k[1]] - first[k[0]] - total) / (items.length - 1);
      let pos = first[k[0]] + first[k[1]] + gap;
      for (const it of items.slice(1, -1)) {
        const d = pos - it.r[k[0]];
        it.o.set(axis === 'h' ? { left: it.o.left + d } : { top: it.o.top + d });
        pos += it.r[k[1]] + gap;
      }
    });
  }
  function groupSelected() {
    const sel = active();
    if (!sel || sel.type !== 'activeSelection') return;
    st.reselecting = true;
    const g = sel.toGroup();
    st.reselecting = false;
    g.set({ lockRatio: true });
    applyClips();
    applyRatioLock(g);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderLayers();
    renderFloatBar();
  }
  function ungroupSelected() {
    const g = active();
    if (!g || g.type !== 'group' || isSticker(g)) return;
    st.reselecting = true;
    const sel = g.toActiveSelection();
    st.reselecting = false;
    sel.getObjects().forEach(applyRatioLock);
    applyClips();
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderLayers();
    renderFloatBar();
  }
  const ALIGN_ICONS = {
    left: '<path d="M4 3v18M8 7h12M8 15h7" />',
    hcenter: '<path d="M12 3v18M6 7h12M8.5 15h7" />',
    right: '<path d="M20 3v18M4 7h12M9 15h7" />',
    top: '<path d="M3 4h18M7 8v12M15 8v7" />',
    vcenter: '<path d="M3 12h18M7 6v12M15 8.5v7" />',
    bottom: '<path d="M3 20h18M7 4v12M15 9v7" />',
    dh: '<path d="M4 4v16M20 4v16M10 8h4v8h-4z" />',
    dv: '<path d="M4 4h16M4 20h16M8 10h8v4H8z" />',
  };
  const alignIcon = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ALIGN_ICONS[k]}</svg>`;
  function alignButtons(multi) {
    const b = (k, title) => `<button class="btn btn-sm btn-icon" data-align-to="${k}" title="${esc(t(title))}" aria-label="${esc(t(title))}">${alignIcon(k)}</button>`;
    return `<div class="align-row" dir="ltr">
      ${b('left', 'align.left')}${b('hcenter', 'align.hcenter')}${b('right', 'align.right')}
      ${b('top', 'align.top')}${b('vcenter', 'align.vcenter')}${b('bottom', 'align.bottom')}
    </div>
    <p class="muted small" style="margin:4px 0 0">${esc(t(multi ? 'align.toSelection' : 'align.toArea'))}</p>`;
  }
  function sizeGroup(o) {
    const z = sizeCm(o);
    const f = (v) => (Math.round(v * 10) / 10).toString();
    return group('size', t('grp.size'), `
      <div class="field grid-2">
        <div><label for="p-wcm">${esc(t('size.width'))}</label><input type="number" id="p-wcm" step="0.1" min="0.2" value="${f(z.w)}" inputmode="decimal"></div>
        <div><label for="p-hcm">${esc(t('size.height'))}</label><input type="number" id="p-hcm" step="0.1" min="0.2" value="${f(z.h)}" inputmode="decimal"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="p-ratio" ${ratioLocked(o) ? 'checked' : ''}> ${esc(t('size.lockRatio'))}</label></div>
      <div class="field grid-2">
        <div><label for="p-xcm">${esc(t('size.x'))}</label><input type="number" id="p-xcm" step="0.1" value="${f(z.x)}" inputmode="decimal"></div>
        <div><label for="p-ycm">${esc(t('size.y'))}</label><input type="number" id="p-ycm" step="0.1" value="${f(z.y)}" inputmode="decimal"></div>
      </div>
      <div class="field">${alignButtons(false)}</div>`);
  }

  // ---------- Floating bar next to the selection ----------
  const FB = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    style: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/><path d="M12 21a3 3 0 0 1 0-6h2"/>',
    dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h6v6M7 11v6h6"/>',
    ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  };
  const fbIcon = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${FB[k]}</svg>`;
  function hideFloatBar() {
    const bar = $('float-bar');
    if (bar) bar.hidden = true;
  }
  function renderFloatBar() {
    const bar = $('float-bar');
    if (!bar) return;
    const o = active();
    // Phones: the settings sheet has the same actions and the design area is small.
    if (!o || crop || st.preview || st.exporting || st.dragging || o.isEditing || (MOBILE.matches && st.sheet)) return hideFloatBar();
    const multi = o.type === 'activeSelection';
    const items = [];
    if (isText(o)) items.push(['edit-text', 'edit', 'fb.editText', true]);
    if (MOBILE.matches) items.push(['open-props', 'style', multi ? 'fb.arrange' : 'fb.style', true]);
    if (multi) items.push(['group', 'group', 'group.make', false]);
    if (o.type === 'group' && !isSticker(o)) items.push(['ungroup', 'ungroup', 'group.ungroup', false]);
    if (!multi) items.push(['duplicate', 'dup', 'props.duplicate', false], ['up', 'up', 'props.forward', false], ['down', 'down', 'props.backward', false]);
    items.push(['delete', 'del', multi ? 'props.deleteSelected' : 'props.delete', false]);
    bar.innerHTML = items.map(([act, icon, key, label]) =>
      `<button type="button" data-fb="${act}" class="${act === 'delete' ? 'danger' : ''}" title="${esc(t(key))}" aria-label="${esc(t(key))}">${fbIcon(icon)}${label ? `<span>${esc(t(key))}</span>` : ''}</button>`).join('');
    bar.hidden = false;
    positionFloatBar();
  }
  /** Below the element (the rotate handle is above it), or above when there is no room. */
  function positionFloatBar() {
    const bar = $('float-bar');
    const o = active();
    if (!bar || bar.hidden || !o) return;
    o.setCoords();
    const r = o.getBoundingRect();
    const cv = canvas.upperCanvasEl.getBoundingClientRect();
    const wrap = bar.parentElement.getBoundingClientRect();
    const stage = $('stage').getBoundingClientRect();
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const gap = COARSE ? 30 : 18;
    let x = cv.left + r.left + r.width / 2 - bw / 2;
    let y = cv.top + r.top + r.height + gap;
    if (y + bh > stage.bottom - 6) y = cv.top + r.top - bh - (COARSE ? 64 : 48);
    x = Math.max(stage.left + 6, Math.min(x, stage.right - bw - 6));
    y = Math.max(stage.top + 6, Math.min(y, stage.bottom - bh - 6));
    bar.style.transform = `translate(${Math.round(x - wrap.left)}px, ${Math.round(y - wrap.top)}px)`;
  }
  $('stage').addEventListener('scroll', positionFloatBar, { passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(positionFloatBar));
  $('float-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fb]');
    const o = active();
    if (!btn || !o) return;
    const act = btn.dataset.fb;
    if (act === 'edit-text' && isText(o)) {
      hideFloatBar();
      o.enterEditing();
      o.selectAll();
      if (o.hiddenTextarea) o.hiddenTextarea.focus();
      canvas.requestRenderAll();
      return;
    }
    if (act === 'open-props') return setSheet('props');
    if (act === 'group') return groupSelected();
    if (act === 'ungroup') return ungroupSelected();
    if (act === 'duplicate') duplicateSelected();
    if (act === 'up' || act === 'down') layer(act);
    if (act === 'delete') return removeSelected();
    requestAnimationFrame(renderFloatBar);
  });

  // ---------- Properties panel ----------
  const props = $('props');
  const PALETTE = ['#16181d', '#ffffff', '#ff5a36', '#e03131', '#f783ac', '#fcc419', '#e0a526', '#2f9e44', '#1c7ed6', '#22304f', '#7048e8', '#8d6e63'];
  const MASKS = ['none', 'circle', 'rounded', 'heart', 'star', 'hexagon', 'arch'];
  const openGroups = new Set(['text', 'fx', 'colours', 'photo']);
  const group = (id, title, body) =>
    `<details class="pgroup" data-group="${id}" ${openGroups.has(id) ? 'open' : ''}><summary>${esc(title)}</summary><div class="pgroup-body">${body}</div></details>`;
  const palette = (target) =>
    `<div class="palette">${PALETTE.map((c) => `<button type="button" class="pal" data-pal="${target}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const isSticker = (o) => typeof o.name === 'string' && o.name.startsWith('sticker:');
  const isGradient = (f) => f && typeof f === 'object' && Array.isArray(f.colorStops);
  const makeGradient = (c1, c2) => new fabric.Gradient({
    type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 0, y2: 1 },
    colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }],
  });
  props.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.group) d.open ? openGroups.add(d.dataset.group) : openGroups.delete(d.dataset.group);
  }, true);

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

  function fillControls(o) {
    const grad = isGradient(o.fill);
    const hollow = !grad && (!o.fill || o.fill === 'transparent');
    const c1 = grad ? o.fill.colorStops[0].color : hollow ? '#ffffff' : o.fill;
    const c2 = grad ? o.fill.colorStops[o.fill.colorStops.length - 1].color : D.ACCENT;
    return `
      <div class="field">
        <label>${esc(t('props.fillStyle'))}</label>
        <div class="btn-group">
          <button class="btn btn-sm ${grad ? '' : 'active'}" data-fillmode="solid">${esc(t('props.solid'))}</button>
          <button class="btn btn-sm ${grad ? 'active' : ''}" data-fillmode="gradient">${esc(t('props.gradient'))}</button>
        </div>
      </div>
      ${grad
        ? `<div class="field row"><input class="shrink" type="color" id="p-grad1" value="${toHex(c1)}"><span class="grad-preview" style="background:linear-gradient(90deg, ${toHex(c1)}, ${toHex(c2)})"></span><input class="shrink" type="color" id="p-grad2" value="${toHex(c2)}"></div>`
        : `<div class="field color-row"><input type="color" id="p-fill" value="${toHex(c1)}" aria-label="${esc(t('props.colour'))}">${palette('fill')}</div>`}
      <div class="field"><label class="check"><input type="checkbox" id="p-nofill" ${hollow ? 'checked' : ''}> ${esc(t(isText(o) ? 'props.hollow' : 'props.none'))}</label></div>`;
  }

  function outlineControls(o, max) {
    return `
      <div class="field">
        <label>${esc(t('props.outline'))}</label>
        <div class="color-row"><input type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}" aria-label="${esc(t('props.outline'))}">${palette('stroke')}</div>
        <input type="range" id="p-stroke-w" min="0" max="${max}" step="0.5" value="${o.strokeWidth || 0}" aria-label="${esc(t('props.outlineWidth'))}">
      </div>`;
  }

  function arrangeGroup(o) {
    return group('arrange', t('grp.arrange'), `
      <div class="field grid-2">
        <div><label for="p-opacity">${esc(t('props.opacity'))}</label><input type="range" id="p-opacity" min="0.05" max="1" step="0.05" value="${o.opacity}"></div>
        <div><label for="p-angle">${esc(t('props.rotation'))}</label><input type="number" id="p-angle" min="-360" max="360" value="${Math.round(o.angle)}"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="p-shadow" ${o.shadow ? 'checked' : ''}> ${esc(t('props.shadow'))}</label></div>
      <div class="grid-4" dir="ltr">
        <button class="btn btn-sm" data-act="flip-x" title="${esc(t('props.flipH'))}">⇋</button>
        <button class="btn btn-sm" data-act="flip-y" title="${esc(t('props.flipV'))}">⇵</button>
        <button class="btn btn-sm" data-act="top" title="${esc(t('props.front'))}">⤒</button>
        <button class="btn btn-sm" data-act="bottom" title="${esc(t('props.back'))}">⤓</button>
      </div>`);
  }

  const ICON = {
    dup: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    del: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };
  function quickActions() {
    return `<div class="quick-actions" dir="ltr">
      <button class="btn btn-sm" data-act="duplicate" title="${esc(t('props.duplicate'))}" aria-label="${esc(t('props.duplicate'))}">${ICON.dup}</button>
      <button class="btn btn-sm" data-act="center-h" title="${esc(t('props.centerH'))}">↔</button>
      <button class="btn btn-sm" data-act="center-v" title="${esc(t('props.centerV'))}">↕</button>
      <button class="btn btn-sm" data-act="up" title="${esc(t('props.forward'))}">▲</button>
      <button class="btn btn-sm" data-act="down" title="${esc(t('props.backward'))}">▼</button>
      <button class="btn btn-sm btn-danger" data-act="delete" title="${esc(t('props.delete'))}" aria-label="${esc(t('props.delete'))}">${ICON.del}</button>
    </div>`;
  }

  function renderProps() {
    const o = active();
    const box = $('props');
    $('props-title').textContent = t('panel.selected');
    if (crop) {
      $('props-title').textContent = t('props.crop');
      box.innerHTML = `
        <p class="muted small" style="margin-top:0">${esc(t('props.cropHint'))}</p>
        <div class="field"><div class="btn-group">
          <button class="btn btn-sm ${crop.square ? '' : 'active'}" data-act="crop-free">${esc(t('props.cropFree'))}</button>
          <button class="btn btn-sm ${crop.square ? 'active' : ''}" data-act="crop-square">${esc(t('props.cropSquare'))}</button>
        </div></div>
        <div class="grid-2">
          <button class="btn btn-primary btn-sm" data-act="crop-apply">${esc(t('props.cropApply'))}</button>
          <button class="btn btn-sm" data-act="crop-cancel">${esc(t('props.cropCancel'))}</button>
        </div>`;
      syncSheetTitle();
      return;
    }
    if (!o) {
      box.innerHTML = `<p class="empty-props">${esc(t('panel.empty'))}<br><br><span class="small">${esc(t('panel.tip'))}</span></p>`;
      syncSheetTitle();
      return;
    }
    if (o.type === 'activeSelection') {
      $('props-title').textContent = t('panel.nSelected', { n: o.size() });
      const n = o.size();
      box.innerHTML = `
        <div class="field"><label>${esc(t('align.title'))}</label>${alignButtons(true)}</div>
        <div class="field"><label>${esc(t('align.distribute'))}</label>
          <div class="grid-2">
            <button class="btn btn-sm" data-distribute="h" ${n < 3 ? 'disabled' : ''}>${alignIcon('dh')} ${esc(t('align.distH'))}</button>
            <button class="btn btn-sm" data-distribute="v" ${n < 3 ? 'disabled' : ''}>${alignIcon('dv')} ${esc(t('align.distV'))}</button>
          </div>
          ${n < 3 ? `<p class="muted small" style="margin:4px 0 0">${esc(t('align.distHint'))}</p>` : ''}
        </div>
        <div class="grid-2">
          <button class="btn btn-sm" data-act="center-h">${esc(t('props.centerH'))}</button>
          <button class="btn btn-sm" data-act="center-v">${esc(t('props.centerV'))}</button>
        </div>
        <button class="btn btn-sm btn-block" data-act="group" style="margin-top:8px">${esc(t('group.make'))}</button>
        <button class="btn btn-sm btn-block btn-danger" data-act="delete" style="margin-top:8px">${esc(t('props.deleteSelected'))}</button>`;
      syncSheetTitle();
      return;
    }
    const text = isText(o);
    const image = o.type === 'image';
    const sticker = isSticker(o);
    $('props-title').textContent = text ? t('panel.text') : image ? t('panel.image') : layerName(o);
    let html = quickActions();

    if (text) {
      const arabic = D.ARABIC_RE.test(o.text);
      html += group('text', t('grp.text'), `
        <div class="field"><textarea id="p-text" rows="2" dir="auto">${esc(o.text)}</textarea></div>
        <div class="field">${fontPicker(o)}</div>
        <div class="field row">
          <input type="number" id="p-size" min="4" max="400" value="${Math.round(o.fontSize)}" aria-label="${esc(t('props.size'))}" title="${esc(t('props.size'))}" style="max-width:84px">
          <div class="btn-group">
            <button class="btn btn-sm ${o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'active' : ''}" data-toggle="bold" title="${esc(t('props.bold'))}"><b>B</b></button>
            <button class="btn btn-sm ${o.fontStyle === 'italic' ? 'active' : ''}" data-toggle="italic" title="${esc(t('props.italic'))}"><i>I</i></button>
            <button class="btn btn-sm ${o.underline ? 'active' : ''}" data-toggle="underline" title="${esc(t('props.underline'))}"><u>U</u></button>
          </div>
        </div>
        <div class="field btn-group" dir="ltr">
          ${['left', 'center', 'right'].map((al) => `<button class="btn btn-sm ${o.textAlign === al ? 'active' : ''}" data-align="${al}" title="${esc(t('props.align' + al[0].toUpperCase() + al.slice(1)))}">${{ left: '⇤', center: '↔', right: '⇥' }[al]}</button>`).join('')}
        </div>`);
      html += textFxGroup(o);
      html += group('colours', t('grp.colours'), fillControls(o) + wordControls(o) + outlineControls(o, 12));
      html += group('effects', t('grp.effects'), `
        <div class="field">
          <label for="p-curve">${esc(t('props.curve'))}</label>
          <div class="row"><input type="range" id="p-curve" min="-100" max="100" step="5" value="${o.curve || 0}"><button class="btn btn-sm shrink" data-act="straighten">${esc(t('props.straighten'))}</button></div>
        </div>
        <div class="field">
          <label class="check"><input type="checkbox" id="p-textbg" ${o.backgroundColor ? 'checked' : ''}> ${esc(t('props.textBg'))}</label>
          ${o.backgroundColor ? `<div class="color-row" style="margin-top:6px"><input type="color" id="p-bgcolor" value="${toHex(o.backgroundColor)}">${palette('bg')}</div>
          <div class="btn-group bg-shapes" style="margin-top:6px">${['box', 'pill', 'banner', 'ticket'].map((k) => `<button type="button" class="btn btn-sm ${(o.bgShape || 'box') === k ? 'active' : ''}" data-bgshape="${k}" title="${esc(t('bgshape.' + k))}"><span class="bgs bgs-${k}"></span>${esc(t('bgshape.' + k))}</button>`).join('')}</div>` : ''}
        </div>
        <div class="field grid-2">
          <div><label for="p-spacing">${esc(t('props.spacing'))}</label>${arabic ? `<div class="muted small">${esc(t('props.spacingArabic'))}</div>` : `<input type="range" id="p-spacing" min="-100" max="800" step="10" value="${o.charSpacing || 0}">`}</div>
          <div><label for="p-lh">${esc(t('props.lineHeight'))}</label><input type="range" id="p-lh" min="0.7" max="2.5" step="0.05" value="${o.lineHeight}"></div>
        </div>`);
    } else if (image) {
      const fs = filterState(o);
      html += `<div class="field" id="quality-box"></div>`;
      html += group('photo', t('grp.photo'), `
        <div class="field grid-2">
          <button class="btn btn-sm" data-act="crop">✂ ${esc(t('props.crop'))}</button>
          <button class="btn btn-sm" data-act="fit">${esc(t('props.fit'))}</button>
        </div>
        <div class="field">
          <label>${esc(t('props.photoShape'))}</label>
          <div class="mask-grid">${MASKS.map((m) => `<button class="mask-btn ${(o.mask || 'none') === m ? 'active' : ''}" data-mask="${m}" title="${esc(t('mask.' + m))}"><span class="mask-icon mask-${m}"></span><small>${esc(t('mask.' + m))}</small></button>`).join('')}</div>
        </div>
        ${o.mask ? `<div class="field"><label>${esc(t('props.border'))}</label><div class="color-row"><input type="color" id="p-bordercolor" value="${toHex(o.maskBorderColor)}">${palette('border')}</div><input type="range" id="p-border" min="0" max="12" step="0.5" value="${o.maskBorder || 0}" aria-label="${esc(t('props.border'))}"></div>` : ''}
        ${boostBox(o)}
        <div class="field">
          <button class="btn btn-sm btn-block" data-act="removebg">✦ ${esc(t('props.removeBg'))}</button>
          <p class="muted small" style="margin:6px 0 0">${esc(t('props.removeBgHint'))}</p>
        </div>`);
      html += group('adjust', t('grp.adjust'), `
        ${['brightness', 'contrast', 'saturation'].map((k) => `<div class="field"><label for="p-${k}">${esc(t('props.' + k))}</label><input type="range" id="p-${k}" data-adjust="${k}" min="-100" max="100" step="5" value="${Math.round(fs[k] * 100)}"></div>`).join('')}
        <div class="field toggles">
          <label class="check"><input type="checkbox" data-filter="gray" ${fs.gray ? 'checked' : ''}> ${esc(t('props.grayscale'))}</label>
          <label class="check"><input type="checkbox" data-filter="sepia" ${fs.sepia ? 'checked' : ''}> ${esc(t('props.sepia'))}</label>
        </div>
        <button class="btn btn-sm" data-act="reset-adjust">${esc(t('props.reset'))}</button>`);
    } else if (!sticker && o.type !== 'group') {
      html += group('colours', t('grp.colours'), fillControls(o) + outlineControls(o, 30) +
        (o.type === 'rect' ? `<div class="field"><label for="p-rx">${esc(t('props.radius'))}</label><input type="range" id="p-rx" min="0" max="${Math.round(Math.min(o.width, o.height) / 2)}" value="${o.rx || 0}"></div>` : ''));
    }
    if (o.type === 'group' && !isSticker(o)) html += `<button class="btn btn-sm btn-block" data-act="ungroup" style="margin-bottom:10px">${esc(t('group.ungroup'))}</button>`;
    html += sizeGroup(o);
    html += arrangeGroup(o);
    box.innerHTML = html;
    if (image) updateQuality();
    syncSheetTitle();
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

  function setProp(propsToSet, { commitNow = false } = {}) {
    const o = active();
    if (!o) return;
    o.set(propsToSet);
    if ('text' in propsToSet) fixArabic(o);
    if (o.initDimensions) o.initDimensions();
    o.setCoords();
    o.dirty = true;
    canvas.requestRenderAll();
    commitNow ? commit() : scheduleCommit();
  }

  // ---------- Text styles (one tap) ----------
  const TEXT_FX = ['none', 'shadow', 'neon', 'extrude', 'retro', 'outline', 'sticker', 'sunset', 'gold', 'ocean'];
  const hexToRgb = (h) => { const n = parseInt(toHex(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixHex = (a, b, k) => '#' + hexToRgb(a).map((v, i) => Math.round(v + (hexToRgb(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');
  /** The text's main colour, whatever its current fill is. */
  function baseColour(o) {
    if (isGradient(o.fill)) return toHex(o.fill.colorStops[0].color);
    if (o.fill && o.fill !== 'transparent') return toHex(o.fill);
    if (o.stroke) return toHex(o.stroke);
    return inkFor(surfaceHex());
  }
  function textFxProps(o, id) {
    const fs = o.fontSize;
    const sc = Math.abs(o.scaleX || 1);
    const base = baseColour(o);
    const lum = POD.luminance(base);
    const plain = { shadow: null, stroke: null, strokeWidth: 0, fill: base, textFx: id === 'none' ? null : id };
    const shadow = (color, blur, off) => new fabric.Shadow({ color, blur: fs * blur, offsetX: fs * off, offsetY: fs * off });
    switch (id) {
      case 'shadow': return { ...plain, shadow: shadow('rgba(0,0,0,0.38)', 0.14, 0.06) };
      case 'neon': {
        const glow = lum < 0.12 || lum > 0.92 ? '#ff2d95' : base;
        return { ...plain, fill: mixHex(glow, '#ffffff', 0.6), shadow: new fabric.Shadow({ color: glow, blur: fs * 0.42, offsetX: 0, offsetY: 0 }) };
      }
      case 'extrude': return { ...plain, shadow: shadow(mixHex(base, lum < 0.2 ? '#ffffff' : '#000000', 0.45), 0, 0.07) };
      case 'retro': return { ...plain, stroke: '#16181d', strokeWidth: fs * sc * 0.045, strokeUniform: true, paintFirst: 'stroke', shadow: shadow(lum > 0.6 ? D.ACCENT : '#fcc419', 0, 0.09) };
      case 'outline': return { ...plain, fill: 'transparent', stroke: base, strokeWidth: Math.max(1.5, fs * sc * 0.04), strokeUniform: true, paintFirst: 'stroke' };
      case 'sticker': return { ...plain, stroke: '#ffffff', strokeWidth: fs * sc * 0.14, strokeUniform: true, paintFirst: 'stroke', strokeLineJoin: 'round', shadow: shadow('rgba(0,0,0,0.28)', 0.12, 0.03) };
      case 'sunset': return { ...plain, fill: makeGradient('#ff5a36', '#fcc419') };
      case 'gold': return { ...plain, fill: makeGradient('#f7d774', '#b8860b'), stroke: '#7a5a10', strokeWidth: Math.max(1, fs * sc * 0.015), strokeUniform: true, paintFirst: 'stroke' };
      case 'ocean': return { ...plain, fill: makeGradient('#22d3ee', '#1c3faa') };
      default: return plain;
    }
  }
  function textFxGroup(o) {
    const sample = D.ARABIC_RE.test(o.text) ? 'أبج' : 'Abc';
    return group('fx', t('grp.textFx'), `
      <div class="fx-grid">${TEXT_FX.map((id) => `<button type="button" class="fx-chip ${(o.textFx || 'none') === id ? 'active' : ''}" data-fx="${id}" title="${esc(t('fx.' + id))}">
        <span class="fx-sample fx-${id}" style="font-family:'${esc(o.fontFamily)}'">${sample}</span><small>${esc(t('fx.' + id))}</small></button>`).join('')}</div>`);
  }
  // ---------- Colour single words ----------
  function wordsOf(o) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(o.text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
  function wordColour(o, w) {
    const st0 = o.getSelectionStyles ? o.getSelectionStyles(w.start, w.start + 1)[0] : null;
    return toHex((st0 && st0.fill) || (isGradient(o.fill) || o.fill === 'transparent' ? baseColour(o) : o.fill));
  }
  function wordControls(o) {
    if (o.type !== 'i-text' || !o.setSelectionStyles) return '';
    const words = wordsOf(o);
    if (words.length < 2) return '';
    if (st.wordSel != null && !words[st.wordSel]) st.wordSel = null;
    const styled = o.styles && Object.values(o.styles).some((l) => l && Object.keys(l).length);
    return `<div class="field">
      <label>${esc(t('words.title'))}</label>
      <div class="word-chips" dir="auto">${words.map((w, i) => `<button type="button" class="word-chip ${st.wordSel === i ? 'active' : ''}" data-word="${i}" style="color:${wordColour(o, w)}">${esc(w.text)}</button>`).join('')}</div>
      ${st.wordSel != null
        ? `<div class="color-row" style="margin-top:6px"><input type="color" id="p-wordcolor" value="${wordColour(o, words[st.wordSel])}" aria-label="${esc(t('words.colour'))}">${palette('word')}</div>`
        : `<p class="muted small" style="margin:4px 0 0">${esc(t('words.hint'))}</p>`}
      ${styled ? `<button type="button" class="btn btn-sm" data-act="reset-words" style="margin-top:6px">${esc(t('words.reset'))}</button>` : ''}
    </div>`;
  }
  function setWordColour(o, colour) {
    const w = wordsOf(o)[st.wordSel];
    if (!w) return;
    o.setSelectionStyles({ fill: colour }, w.start, w.end);
    o.dirty = true;
    canvas.requestRenderAll();
  }

  function shadowFor(o) {
    const s = Math.max(1.5, Math.min(o.width, o.height) * 0.035);
    return new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: s * 2, offsetX: s, offsetY: s });
  }

  // ----- Photo filters -----
  const ADJUST = { brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation' };
  function filterState(o) {
    const get = (type) => (o.filters || []).find((f) => f && f.type === type);
    return {
      white: !!get('RemoveColor'),
      gray: !!get('Grayscale'),
      sepia: !!get('Sepia'),
      brightness: get('Brightness')?.brightness || 0,
      contrast: get('Contrast')?.contrast || 0,
      saturation: get('Saturation')?.saturation || 0,
    };
  }
  let filterTimer = null;
  function applyFilterState(o, s, { now = false } = {}) {
    const F = fabric.Image.filters;
    const list = [];
    if (s.white) list.push(new F.RemoveColor({ color: '#ffffff', distance: 0.12 }));
    if (s.brightness) list.push(new F.Brightness({ brightness: s.brightness }));
    if (s.contrast) list.push(new F.Contrast({ contrast: s.contrast }));
    if (s.saturation) list.push(new F.Saturation({ saturation: s.saturation }));
    if (s.gray) list.push(new F.Grayscale());
    if (s.sepia) list.push(new F.Sepia());
    o.filters = list;
    clearTimeout(filterTimer);
    const run = () => {
      o.applyFilters();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
    };
    now ? run() : (filterTimer = setTimeout(run, 120));
  }

  /** The AI on the server cuts out the subject (people, pets, products) from any background. */
  async function aiRemoveBackground(el) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(el, 0, 0, w, h);
    const jpg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93));
    const res = await fetch('/api/remove-bg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-lang': POD.lang, 'x-max-px': String(Math.max(w, h)) }, body: jpg });
    if (!res.ok) {
      const body = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
      const err = new Error((body && body.error) || t('msg.removeBgNone'));
      err.status = res.status;
      throw err;
    }
    return res.blob();
  }
  async function removeImageBackground(o) {
    busy(true, t('busy.removingBgAi'));
    try {
      await new Promise((r) => setTimeout(r, 40)); // let the overlay paint first
      const el = o._originalElement || o.getElement();
      let blob = null;
      try {
        blob = await aiRemoveBackground(el);
      } catch (e) {
        // AI not available (or the server is busy): the quick plain-background method still helps logos on white.
        if (e.status && e.status !== 503) throw e;
        blob = await window.POD_FX.removeBackground(el);
        if (!blob) {
          toast(e.message || t('msg.removeBgNone'), 'error');
          return;
        }
      }
      if (!blob) {
        toast(t('msg.removeBgNone'), 'error');
        return;
      }
      const img = await loadHtmlImage(URL.createObjectURL(blob));
      o.setElement(img, { width: o.width, height: o.height, cropX: o.cropX, cropY: o.cropY });
      if (o.filters && o.filters.length) o.applyFilters();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
      renderProps();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy(false);
    }
  }

  // ----- Crop -----
  let crop = null;
  function startCrop(img) {
    if (crop) return;
    const el = img.getElement();
    const fullW = el.naturalWidth || el.width;
    const fullH = el.naturalHeight || el.height;
    const sx = img.scaleX;
    const sy = img.scaleY;
    const prev = { cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height, angle: img.angle, center: img.getCenterPoint() };
    img.rotate(0);
    const c = img.getCenterPoint();
    const visL = c.x - (img.width * sx) / 2;
    const visT = c.y - (img.height * sy) / 2;
    const dispX = img.flipX ? fullW - img.cropX - img.width : img.cropX;
    const dispY = img.flipY ? fullH - img.cropY - img.height : img.cropY;
    const full = { L: visL - dispX * sx, T: visT - dispY * sy, W: fullW * sx, H: fullH * sy };
    img.set({ cropX: 0, cropY: 0, width: fullW, height: fullH });
    img.setPositionByOrigin(new fabric.Point(full.L + full.W / 2, full.T + full.H / 2), 'center', 'center');
    img.setCoords();
    const cropper = new fabric.Rect({
      name: '__cropper', left: c.x, top: c.y, width: prev.width * sx, height: prev.height * sy,
      fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.5, strokeDashArray: [6, 4], strokeUniform: true,
      cornerColor: '#ffffff', cornerStrokeColor: '#16181d', borderColor: '#ffffff', lockRotation: true,
      excludeFromExport: true, noScaleCache: false, padding: 0,
    });
    cropper.setControlsVisibility({ mtr: false });
    const others = canvas.getObjects().map((o) => [o, o.selectable, o.evented]);
    others.forEach(([o]) => o.set({ selectable: false, evented: false }));
    crop = { img, cropper, prev, full, sx, sy, fullW, fullH, others, square: false };
    st.silent = true;
    canvas.add(cropper);
    st.silent = false;
    cropper.clipPath = null;
    canvas.setActiveObject(cropper);
    canvas.requestRenderAll();
    renderProps();
  }
  function cropRect() {
    const c = crop.cropper;
    const p = c.getCenterPoint();
    const w = c.width * c.scaleX;
    const h = c.height * c.scaleY;
    return { x: p.x - w / 2, y: p.y - h / 2, w, h };
  }
  function clampCropper() {
    const f = crop.full;
    const c = crop.cropper;
    let { x, y, w, h } = cropRect();
    w = Math.min(w, f.W);
    h = Math.min(h, f.H);
    x = Math.min(Math.max(x, f.L), f.L + f.W - w);
    y = Math.min(Math.max(y, f.T), f.T + f.H - h);
    c.set({ scaleX: w / c.width, scaleY: h / c.height });
    c.setPositionByOrigin(new fabric.Point(x + w / 2, y + h / 2), 'center', 'center');
    c.setCoords();
  }
  function setCropSquare(on) {
    crop.square = on;
    const c = crop.cropper;
    c.setControlsVisibility({ ml: !on, mr: !on, mt: !on, mb: !on });
    if (on) {
      const { x, y, w, h } = cropRect();
      const s = Math.min(w, h);
      c.set({ scaleX: s / c.width, scaleY: s / c.height });
      c.setPositionByOrigin(new fabric.Point(x + w / 2, y + h / 2), 'center', 'center');
      clampCropper();
    }
    canvas.requestRenderAll();
    renderProps();
  }
  function finishCrop() {
    st.silent = true;
    canvas.remove(crop.cropper);
    st.silent = false;
    crop.others.forEach(([o, sel, ev]) => o.set({ selectable: sel, evented: ev }));
    const img = crop.img;
    crop = null;
    canvas.setActiveObject(img);
    canvas.requestRenderAll();
    renderProps();
  }
  function applyCrop() {
    const { img, full, sx, sy, fullW, fullH, prev } = crop;
    const r = cropRect();
    let x = Math.max(0, Math.round((r.x - full.L) / sx));
    let y = Math.max(0, Math.round((r.y - full.T) / sy));
    const w = Math.max(4, Math.min(fullW - x, Math.round(r.w / sx)));
    const h = Math.max(4, Math.min(fullH - y, Math.round(r.h / sy)));
    if (img.flipX) x = fullW - x - w;
    if (img.flipY) y = fullH - y - h;
    img.set({ cropX: x, cropY: y, width: w, height: h });
    img.setPositionByOrigin(new fabric.Point(r.x + r.w / 2, r.y + r.h / 2), 'center', 'center');
    img.rotate(prev.angle);
    img.setCoords();
    finishCrop();
    commit();
  }
  function cancelCrop() {
    if (!crop) return;
    const { img, prev } = crop;
    img.set({ cropX: prev.cropX, cropY: prev.cropY, width: prev.width, height: prev.height });
    img.rotate(prev.angle);
    img.setPositionByOrigin(prev.center, 'center', 'center');
    img.setCoords();
    finishCrop();
  }

  props.addEventListener('input', (e) => {
    const o = active();
    if (!o || crop) return;
    const v = e.target.value;
    if (e.target.dataset.adjust) {
      const s = filterState(o);
      s[e.target.dataset.adjust] = Number(v) / 100;
      applyFilterState(o, s);
      return;
    }
    switch (e.target.id) {
      case 'p-text': {
        const wasArabic = D.ARABIC_RE.test(o.text);
        setProp({ text: v });
        renderLayers();
        if (wasArabic !== D.ARABIC_RE.test(v)) renderPropsKeepFocus();
        break;
      }
      case 'p-size': if (Number(v) >= 4) setProp({ fontSize: Number(v) }); break;
      case 'p-fill': if (!$('p-nofill').checked) setProp({ fill: v }); break;
      case 'p-grad1': case 'p-grad2': {
        setProp({ fill: makeGradient($('p-grad1').value, $('p-grad2').value) });
        const prev = props.querySelector('.grad-preview');
        if (prev) prev.style.background = `linear-gradient(90deg, ${$('p-grad1').value}, ${$('p-grad2').value})`;
        break;
      }
      case 'p-stroke': setProp({ stroke: v, strokeUniform: true, strokeWidth: o.strokeWidth || 2, paintFirst: 'stroke' }); break;
      case 'p-stroke-w': setProp({ strokeWidth: Number(v), stroke: o.stroke || $('p-stroke').value, strokeUniform: true, paintFirst: 'stroke' }); break;
      case 'p-spacing': setProp({ charSpacing: Number(v) }); break;
      case 'p-lh': setProp({ lineHeight: Number(v) }); break;
      case 'p-rx': setProp({ rx: Number(v), ry: Number(v) }); break;
      case 'p-opacity': setProp({ opacity: Number(v) }); break;
      case 'p-angle': o.rotate(Number(v) || 0); setProp({}); break;
      case 'p-curve': setProp({ curve: Number(v) }); break;
      case 'p-wcm': case 'p-hcm': {
        const cm = parseFloat(String(v).replace(',', '.'));
        if (cm > 0) {
          setSizeCm(o, e.target.id === 'p-wcm' ? 'w' : 'h', cm);
          canvas.requestRenderAll();
          const z = sizeCm(o);
          const other = $(e.target.id === 'p-wcm' ? 'p-hcm' : 'p-wcm');
          if (other) other.value = (Math.round((e.target.id === 'p-wcm' ? z.h : z.w) * 10) / 10).toString();
          updateQuality();
          scheduleCheck();
          renderFloatBar();
        }
        break;
      }
      case 'p-xcm': case 'p-ycm': {
        const cm = parseFloat(String(v).replace(',', '.'));
        if (!Number.isNaN(cm)) { setPosCm(o, e.target.id === 'p-xcm' ? 'x' : 'y', cm); canvas.requestRenderAll(); scheduleCheck(); renderFloatBar(); }
        break;
      }
      case 'p-bgcolor': setProp({ backgroundColor: v }); break;
      case 'p-wordcolor': setWordColour(o, v); scheduleCommit(); break;
      case 'p-border': setProp({ maskBorder: Number(v) }); break;
      case 'p-bordercolor': setProp({ maskBorderColor: v, maskBorder: o.maskBorder || 4 }); break;
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
    if (!o || crop) return;
    const id = e.target.id;
    if (id === 'p-nofill') {
      const solid = $('p-fill') ? $('p-fill').value : inkFor(surfaceHex());
      const off = e.target.checked;
      setProp(off ? { fill: 'transparent', stroke: o.stroke || inkFor(surfaceHex()), strokeWidth: o.strokeWidth || 2, paintFirst: 'stroke' } : { fill: solid }, { commitNow: true });
      renderProps();
    }
    if (id === 'p-shadow') setProp({ shadow: e.target.checked ? shadowFor(o) : null }, { commitNow: true });
    if (id === 'p-ratio') { o.set({ lockRatio: e.target.checked }); applyRatioLock(o); canvas.requestRenderAll(); commit(); }
    if (id === 'p-textbg') {
      setProp({ backgroundColor: e.target.checked ? (inkFor(surfaceHex()) === '#ffffff' ? '#ff5a36' : '#fcc419') : '' }, { commitNow: true });
      renderProps();
    }
    if (e.target.dataset.filter) {
      const s = filterState(o);
      s[e.target.dataset.filter] = e.target.checked;
      if (e.target.checked) s[e.target.dataset.filter === 'gray' ? 'sepia' : 'gray'] = false;
      applyFilterState(o, s, { now: true });
      renderProps();
    }
    if (id === 'p-wordcolor') renderProps();
    if (['p-text', 'p-size', 'p-curve', 'p-spacing', 'p-lh', 'p-opacity', 'p-border', 'p-stroke-w', 'p-wcm', 'p-hcm', 'p-xcm', 'p-ycm'].includes(id) || e.target.dataset.adjust) commit();
    if (['p-wcm', 'p-hcm', 'p-xcm', 'p-ycm'].includes(id)) renderProps();
  });
  props.addEventListener('click', serial(async (e) => {
    if (crop) {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'crop-apply') applyCrop();
      if (act === 'crop-cancel') cancelCrop();
      if (act === 'crop-free') setCropSquare(false);
      if (act === 'crop-square') setCropSquare(true);
      return;
    }
    const o = active();
    if (!o) return;
    const fontBtn = e.target.closest('[data-font]');
    if (fontBtn) {
      const family = fontBtn.dataset.font;
      await D.ensureFont(family, o.fontWeight, o.fontStyle);
      setProp({ fontFamily: family }, { commitNow: true });
      renderProps();
      return;
    }
    const pal = e.target.closest('[data-pal]');
    if (pal) {
      const c = pal.dataset.c;
      ({
        fill: () => setProp({ fill: c }, { commitNow: true }),
        stroke: () => setProp({ stroke: c, strokeWidth: o.strokeWidth || 2, strokeUniform: true, paintFirst: 'stroke' }, { commitNow: true }),
        bg: () => setProp({ backgroundColor: c }, { commitNow: true }),
        border: () => setProp({ maskBorderColor: c, maskBorder: o.maskBorder || 4 }, { commitNow: true }),
        word: () => { setWordColour(o, c); commit(); },
      })[pal.dataset.pal]();
      renderProps();
      return;
    }
    const fxBtn = e.target.closest('[data-fx]');
    if (fxBtn && isText(o)) {
      const fx = textFxProps(o, fxBtn.dataset.fx);
      o.set({ shadow: null, stroke: null, strokeWidth: 0 });
      setProp(fx, { commitNow: true });
      renderProps();
      return;
    }
    const wordBtn = e.target.closest('[data-word]');
    if (wordBtn) {
      const i = Number(wordBtn.dataset.word);
      st.wordSel = st.wordSel === i ? null : i;
      renderProps();
      return;
    }
    const bgShapeBtn = e.target.closest('[data-bgshape]');
    if (bgShapeBtn) {
      setProp({ bgShape: bgShapeBtn.dataset.bgshape }, { commitNow: true });
      renderProps();
      return;
    }
    const maskBtn = e.target.closest('[data-mask]');
    if (maskBtn) {
      const m = maskBtn.dataset.mask;
      setProp({ mask: m === 'none' ? null : m }, { commitNow: true });
      renderProps();
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.fillmode) {
      const grad = isGradient(o.fill);
      if (btn.dataset.fillmode === 'gradient' && !grad) {
        const base = typeof o.fill === 'string' && o.fill !== 'transparent' ? toHex(o.fill) : D.ACCENT;
        setProp({ fill: makeGradient(base, base === D.ACCENT ? '#fcc419' : D.ACCENT) }, { commitNow: true });
      }
      if (btn.dataset.fillmode === 'solid' && grad) setProp({ fill: o.fill.colorStops[0].color }, { commitNow: true });
      renderProps();
      return;
    }
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
    if (btn.dataset.alignTo) { alignSelected(btn.dataset.alignTo); return; }
    if (btn.dataset.distribute) { distributeSelected(btn.dataset.distribute); return; }
    const act = btn.dataset.act;
    if (act === 'group') { groupSelected(); return; }
    if (act === 'ungroup') { ungroupSelected(); return; }
    if (act === 'center-h') centerSelected('h');
    if (act === 'center-v') centerSelected('v');
    if (act === 'flip-x') setProp({ flipX: !o.flipX }, { commitNow: true });
    if (act === 'flip-y') setProp({ flipY: !o.flipY }, { commitNow: true });
    if (['up', 'down', 'top', 'bottom'].includes(act)) layer(act);
    if (act === 'duplicate') duplicateSelected();
    if (act === 'delete') removeSelected();
    if (act === 'fit') fitToArea(o);
    if (act === 'straighten') { setProp({ curve: 0 }, { commitNow: true }); renderProps(); }
    if (act === 'reset-words') { st.wordSel = null; o.set({ styles: {} }); o.dirty = true; canvas.requestRenderAll(); commit(); renderProps(); }
    if (act === 'crop') startCrop(o);
    if (act === 'removebg') await removeImageBackground(o);
    if (act === 'boost') await boostImage(o);
    if (act === 'reset-adjust') { applyFilterState(o, { ...filterState(o), brightness: 0, contrast: 0, saturation: 0, gray: false, sepia: false }, { now: true }); renderProps(); }
  }));

  // ---------- Layers ----------
  function shapeName(o) {
    if (o.name === 'Background') return t('layers.background');
    if (o.type === 'group' && !isSticker(o)) return t('layers.group', { n: o.size() });
    if (isSticker(o)) {
      const sk = SK.STICKERS.find((x) => 'sticker:' + x.id === o.name);
      return sk ? tr(sk.name) : t('tool.stickers');
    }
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
            <span class="grip" data-grip title="${esc(t('layers.drag'))}" aria-label="${esc(t('layers.drag'))}">⋮⋮</span>
            <span dir="auto" class="lname">${esc(layerName(o))}</span>
            <button data-lock class="${locked ? 'on' : ''}" title="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}" aria-label="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}">${locked ? LOCK_ICON : UNLOCK_ICON}</button>
            <button data-del title="${esc(t('layers.delete'))}" aria-label="${esc(t('layers.delete'))}">✕</button>
          </li>`;
        }).join('')
      : `<li style="cursor:default" class="muted"><span>${esc(t('layers.empty'))}</span></li>`;
  }
  // Drag a layer by its handle to change the stacking order (mouse and touch).
  $('layers').addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const li = grip.closest('li');
    const list = $('layers');
    const items = [...list.querySelectorAll('li[data-i]')];
    if (items.length < 2) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const from = items.indexOf(li);
    let to = from;
    li.classList.add('dragging');
    const move = (ev) => {
      const y = ev.clientY;
      to = items.length - 1;
      for (let k = 0; k < items.length; k++) {
        const r = items[k].getBoundingClientRect();
        if (y < r.top + r.height / 2) { to = k; break; }
      }
      items.forEach((it, k) => it.classList.toggle('drop-before', k === to && to !== from && to < from));
      items.forEach((it, k) => it.classList.toggle('drop-after', k === to && to !== from && to > from));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      items.forEach((it) => it.classList.remove('dragging', 'drop-before', 'drop-after'));
      if (to === from) return;
      // The list shows the top layer first; canvas order is the reverse.
      const o = canvas.getObjects()[Number(li.dataset.i)];
      const n = canvas.getObjects().length;
      canvas.moveTo(o, n - 1 - to);
      canvas.requestRenderAll();
      commit();
      renderLayers();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  $('layers').addEventListener('click', (e) => {
    if (e.target.closest('[data-grip]')) return;
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
    // Fabric: how the tile repeats and how big it prints.
    $('pattern-field').hidden = !st.pattern;
    if (st.pattern) {
      $('pat-repeats').innerHTML = REPEATS.map((r) => `<button class="chip ${r === st.pattern.repeat ? 'active' : ''}" data-repeat="${r}">${esc(t('pat.' + r))}</button>`).join('');
      $('pat-tiles').innerHTML = p.pattern.tiles.map((cm) => `<button class="chip ${cm === st.pattern.tileCm ? 'active' : ''}" data-tile="${cm}">${esc(POD.num(cm))} ${esc(t('pat.cm'))}</button>`).join('');
    }
  }
  $('pat-repeats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-repeat]');
    if (!b || !st.pattern || b.dataset.repeat === st.pattern.repeat) return;
    st.pattern.repeat = b.dataset.repeat;
    renderOptions();
    schedulePatternPreview(0);
    scheduleDraft();
  });
  $('pat-tiles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tile]');
    if (!b || !st.pattern || Number(b.dataset.tile) === st.pattern.tileCm) return;
    st.pattern.tileCm = Number(b.dataset.tile);
    renderOptions();
    renderCheck();
    canvas.requestRenderAll();
    schedulePatternPreview(0);
    scheduleDraft();
  });
  $('swatches').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === st.colorId) return;
    const oldInk = inkFor(surfaceHex());
    st.colorId = b.dataset.color;
    const newInk = inkFor(surfaceHex());
    renderOptions();
    await applyMockup();
    if (oldInk !== newInk) swapInk(oldInk, newInk);
    schedulePatternPreview(0);
  }));
  /** Text and shapes in the default ink colour follow the product: dark on light, white on dark. */
  function swapInk(from, to) {
    const same = (c) => typeof c === 'string' && c.toLowerCase() === from;
    const fix = (o) => {
      const p = {};
      if (same(o.fill)) p.fill = to;
      if (same(o.stroke)) p.stroke = to;
      return p;
    };
    let changed = false;
    canvas.getObjects().forEach((o) => {
      const p = fix(o);
      if (Object.keys(p).length) { o.set(p); o.dirty = true; changed = true; }
    });
    for (const s of st.product.sides) {
      if (s.id === st.side || !st.designs[s.id]) continue;
      st.designs[s.id] = st.designs[s.id].map((o) => ({ ...o, ...fix(o) }));
    }
    canvas.requestRenderAll();
    if (changed) commit();
  }
  $('sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    if (b.dataset.size !== st.sizeId) changeSize(b.dataset.size);
    renderOptions();
    refreshChrome();
  });
  /** A different garment size: the print box changes size on the garment, and the design with it. */
  function changeSize(sizeId) {
    const prev = st.sizeId;
    const before = (sid) => areaFor(st.product, sid, prev, st.offsets[sid]);
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    st.sizeId = sizeId;
    for (const sd of st.product.sides) {
      const from = before(sd.id);
      const o = st.offsets[sd.id];
      if (o) {
        const c = clampOffset(o.dx, o.dy, sd.id);
        if (c.dx || c.dy) st.offsets[sd.id] = c;
        else delete st.offsets[sd.id];
      }
      const to = areaFor(st.product, sd.id, sizeId, st.offsets[sd.id]);
      if (from.w === to.w && from.x === to.x && from.y === to.y) continue;
      if (sd.id === st.side) {
        const objs = remap(serialize(), from, to);
        st.designs[sd.id] = objs;
        loadObjects(objs).then(() => { applyClips(); seedHistory(); commit(); renderCheck(); });
      } else if ((st.designs[sd.id] || []).length) {
        st.designs[sd.id] = remap(st.designs[sd.id], from, to);
      }
    }
    // Undo works within one size: the history starts again at the new size.
    st.history = {};
    applyClips();
    fit(); // the garment is drawn at this size's scale
    schedulePatternPreview(0);
  }
  $('product-select').addEventListener('change', serial(async (e) => changeProduct(e.target.value)));

  /** Switch product, carrying the design across by scaling it into the new print areas. */
  async function changeProduct(id) {
    const next = products.find((p) => p.id === id);
    if (!next || next === st.product) return;
    cancelCrop();
    commit();
    const prev = st.product;
    const pending = prev.sides.filter((s) => (st.designs[s.id] || []).length).map((s) => s.id);
    const mapped = {};
    const from = (sid) => sideDef(sid).printArea; // where the customer had moved it
    const nextSize = next.sizes.some((z) => z.id === st.sizeId) ? st.sizeId : next.sizes[0].id;
    const to = (s) => areaFor(next, s.id, nextSize, null);
    for (const s of next.sides) {
      if (pending.includes(s.id)) {
        mapped[s.id] = remap(st.designs[s.id], from(s.id), to(s));
        pending.splice(pending.indexOf(s.id), 1);
      }
    }
    for (const s of next.sides) {
      if (!mapped[s.id] && pending.length) {
        const sid = pending.shift();
        mapped[s.id] = remap(st.designs[sid], from(sid), to(s));
      }
    }
    if (pending.length) {
      const names = pending.map((sid) => tr(prev.sides.find((s) => s.id === sid).name)).join(' + ');
      toast(t('msg.noRoom', { product: tr(next.name), sides: names }));
    }
    st.product = next;
    st.designs = mapped;
    st.offsets = {}; // the new product starts at its standard print position
    st.history = {};
    if (!next.colors.some((c) => c.id === st.colorId)) st.colorId = next.colors[0].id;
    st.sizeId = nextSize;
    st.pattern = normPattern(next, st.pattern);
    st.side = next.sides.find((s) => s.id === st.side)?.id || next.sides[0].id;
    const url = new URL(location.href);
    url.searchParams.set('product', next.id);
    history.replaceState(null, '', url);
    renderOptions();
    await Promise.all([applyMockup(), loadObjects(st.designs[st.side])]);
    fit();
    schedulePatternPreview();
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
    if (MOBILE.matches && st.sheet) fit();
    renderCheck();
  }
  $('side-tabs').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-side]');
    if (!b || b.dataset.side === st.side) return;
    cancelCrop();
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
    applyClips();
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
    if (crop) {
      if (e.key === 'Escape') cancelCrop();
      if (e.key === 'Enter') applyCrop();
      return;
    }
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

  // ---------- Print check ----------
  /** Bounding box on the canvas, also correct for objects inside a multi-selection. */
  function absRect(o) {
    const m = o.calcTransformMatrix();
    const d = o._getNonTransformedDimensions();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => fabric.util.transformPoint({ x: (sx * d.x) / 2, y: (sy * d.y) / 2 }, m));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  /** Problems that would make the print blurry, cut off or hard to read. */
  function checkIssues() {
    const R = rects();
    const sd = sideDef();
    const edge = R.b ? R.bleed : R.trim;
    const issues = [];
    for (const o of canvas.getObjects()) {
      if (o.name === '__cropper' || o.visible === false) continue;
      const r = absRect(o);
      const name = layerName(o);
      const covers = r.left <= R.trim.x + 1 && r.top <= R.trim.y + 1 && r.left + r.width >= R.trim.x + R.trim.w - 1 && r.top + r.height >= R.trim.y + R.trim.h - 1;
      const outside = r.left > edge.x + edge.w || r.left + r.width < edge.x || r.top > edge.y + edge.h || r.top + r.height < edge.y;
      if (outside) {
        issues.push({ level: 'error', key: 'check.outside', obj: o, params: { name } });
        continue;
      }
      const cut = r.left < edge.x - 0.5 || r.top < edge.y - 0.5 || r.left + r.width > edge.x + edge.w + 0.5 || r.top + r.height > edge.y + edge.h + 0.5;
      // Fabric patterns: crossing the tile edge is how a pattern joins up (it continues on the other side).
      if (cut && !covers && !st.pattern) issues.push({ level: 'warn', key: 'check.cut', obj: o, params: { name } });
      const important = isText(o) || isSticker(o);
      const unsafe = r.left < R.safe.x || r.top < R.safe.y || r.left + r.width > R.safe.x + R.safe.w || r.top + r.height > R.safe.y + R.safe.h;
      if (!cut && important && unsafe) issues.push({ level: 'warn', key: 'check.safe', obj: o, params: { name } });
      if (o.type === 'image') {
        const dpi = imageDpi(o);
        if (dpi < 100) issues.push({ level: 'error', key: 'check.lowres', obj: o, params: { name, dpi } });
        else if (dpi < 150) issues.push({ level: 'warn', key: 'check.okres', obj: o, params: { name, dpi } });
      }
      if (isText(o)) {
        const pt = Math.round(((o.fontSize * Math.abs(o.scaleY)) / R.u) * 72 * 0.7); // cap height ≈ 70% of font size
        if (pt < 6) issues.push({ level: 'warn', key: 'check.tiny', obj: o, params: { name, pt } });
      }
    }
    issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'error' ? -1 : 1));
    return issues.map((i) => ({ ...i, side: sd }));
  }
  let checkFrame = 0;
  function scheduleCheck() {
    if (checkFrame) return;
    checkFrame = requestAnimationFrame(() => { checkFrame = 0; renderCheck(); });
  }
  function renderCheck() {
    if (crop) return;
    const issues = checkIssues();
    st.issues = issues;
    st.issueObjs = new Set(issues.map((i) => i.obj));
    const chip = $('check-chip');
    chip.className = 'check-chip ' + (issues.length ? (issues.some((i) => i.level === 'error') ? 'bad' : 'warn') : 'ok');
    chip.innerHTML = issues.length ? `⚠ <span>${esc(t('check.issues', { n: POD.num(issues.length) }))}</span>` : `✓ <span>${esc(t('check.ok'))}</span>`;
    const R = rects();
    $('check-legend').innerHTML = `
      <li><i class="lg lg-trim"></i>${esc(t('check.legendTrim'))}</li>
      <li><i class="lg lg-safe"></i>${esc(t('check.legendSafe'))}</li>
      ${R.b ? `<li><i class="lg lg-bleed"></i>${esc(t('check.legendBleed'))}</li>` : ''}`;
    $('check-list').innerHTML = issues.length
      ? issues.map((i, k) => `<li class="${i.level}" data-issue="${k}"><span>${i.level === 'error' ? '⛔' : '⚠'}</span><span>${esc(t(i.key, { ...i.params, dpi: POD.num(i.params.dpi ?? 0), pt: POD.num(i.params.pt ?? 0) }))}</span></li>`).join('')
      : `<li class="ok"><span>✓</span><span>${esc(t('check.allGood'))}</span></li>`;
    canvas.requestRenderAll();
  }
  $('check-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-issue]');
    const issue = li && st.issues[Number(li.dataset.issue)];
    if (!issue || !canvas.contains(issue.obj) || issue.obj.selectable === false) return;
    canvas.setActiveObject(issue.obj);
    canvas.requestRenderAll();
  });
  $('check-chip').addEventListener('click', () => {
    if (MOBILE.matches) {
      canvas.discardActiveObject();
      setSheet('product');
      requestAnimationFrame(() => $('sec-check').scrollIntoView({ block: 'start' }));
    } else {
      $('sec-check').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ---------- Price & chrome ----------
  function designedSides() {
    return st.product.sides.filter((s) => (s.id === st.side ? canvas.getObjects().length : (st.designs[s.id] || []).length) > 0);
  }
  function refreshChrome() {
    if (bootDone) scheduleDraft();
    renderPlacement();
    const hint = $('stage-hint');
    if (hint) hint.hidden = st.preview || canvas.getObjects().length > 0;
    const p = st.product;
    const size = p.sizes.find((s) => s.id === st.sizeId);
    const n = designedSides().length;
    const perSide = p.extraSidePrice != null ? p.extraSidePrice : catalog.pricing.extraSide;
    $('price').textContent = money(p.basePrice + size.surcharge + Math.max(0, n - 1) * perSide);
    const notes = [];
    if (p.sides.length > 1 && perSide > 0) notes.push(n > 1 ? t('price.bothSides') : t('price.addSide', { price: money(perSide) }));
    if (size.surcharge) notes.push(`${tr(size.label)} +${money(size.surcharge)}`);
    $('price-note').textContent = notes.join(' · ');
    const h = hist();
    $('undo').disabled = h.i <= 0;
    $('redo').disabled = h.i >= h.stack.length - 1;
    $('add-to-cart').textContent = t(st.editingCartIndex !== null ? 'cart.update' : 'cart.add');
    renderSideTabs();
    renderLayers();
    renderCheck();
  }

  // ---------- Export & add to cart ----------
  /** Run fn with the canvas showing only the artwork (no product, guides or on-screen clipping). */
  function withArtworkOnly(fn, clip = null) {
    const objs = canvas.getObjects();
    const clips = objs.map((o) => o.clipPath);
    const bg = canvas.backgroundImage;
    const ov = canvas.overlayImage;
    const vt = canvas.viewportTransform.slice();
    const limits = [fabric.perfLimitSizeTotal, fabric.maxCacheSideLimit];
    fabric.perfLimitSizeTotal = 64e6; // full resolution for any object that still caches
    fabric.maxCacheSideLimit = 8192;
    st.exporting = true;
    canvas.backgroundImage = null;
    canvas.overlayImage = null;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    objs.forEach((o) => { o.clipPath = clip ? clipRect(clip) : null; o.dirty = true; });
    try {
      return fn();
    } finally {
      objs.forEach((o, i) => { o.clipPath = clips[i]; o.dirty = true; });
      canvas.backgroundImage = bg;
      canvas.overlayImage = ov;
      canvas.setViewportTransform(vt);
      [fabric.perfLimitSizeTotal, fabric.maxCacheSideLimit] = limits;
      st.exporting = false;
    }
  }
  const canvasBlob = (el, type = 'image/png') => new Promise((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type));

  /** Transparent print file: artwork + bleed at up to 300 DPI. */
  function exportPrint(side) {
    const { bleed, u, b } = rects(side.id);
    const mult = Math.min(TARGET_DPI / u, Math.sqrt(MAX_PRINT_PIXELS / (bleed.w * bleed.h)), MAX_PRINT_SIDE / Math.max(bleed.w, bleed.h));
    const el = st.pattern ? exportTile(mult) : withArtworkOnly(() => canvas.toCanvasElement(mult, { left: bleed.x, top: bleed.y, width: bleed.w, height: bleed.h }));
    // Canvas prints: the band round the front becomes the chosen edge (mirror, white, black).
    if (st.product.model && st.product.model.type === 'canvas') POD.canvasEdges(el, b * mult, st.colorId);
    return canvasBlob(el);
  }
  // ---------- Fabric patterns ----------
  /**
   * The seamless tile: the artwork in the tile, plus what crosses its edges
   * drawn again where the neighbouring tiles put it (for this repeat).
   */
  function exportTile(mult) {
    const r = rects().trim;
    const offs = POD.wrapOffsets(st.pattern ? st.pattern.repeat : 'mirror', r.w, r.h);
    return withArtworkOnly(() => {
      const base = canvas.toCanvasElement(mult, { left: r.x, top: r.y, width: r.w, height: r.h });
      const boxes = canvas.getObjects().map((o) => o.getBoundingRect(true, true));
      const ctx = base.getContext('2d');
      for (const [ox, oy] of offs) {
        const g = { x: r.x - ox, y: r.y - oy };
        if (!boxes.some((b) => b.left < g.x + r.w && b.left + b.width > g.x && b.top < g.y + r.h && b.top + b.height > g.y)) continue;
        ctx.drawImage(canvas.toCanvasElement(mult, { left: g.x, top: g.y, width: r.w, height: r.h }), 0, 0, base.width, base.height);
      }
      return base;
    }, null);
  }
  /** The product picture (bed, curtains, fabric roll) covered with the repeated tile, `width` pixels wide. */
  async function patternScene(tile, width) {
    const sc = st.product.pattern.scene;
    const k = width / W;
    const out = document.createElement('canvas');
    out.width = Math.round(W * k);
    out.height = Math.round(H * k);
    const ctx = out.getContext('2d');
    const [bg, ov] = await Promise.all([loadHtmlImage(POD.mockupUrl(sc, color().hex)), sc.overlay ? loadHtmlImage(POD.mockupUrl(sc, color().hex, 'overlay')) : null]);
    ctx.drawImage(bg, 0, 0, out.width, out.height);
    const f = sc.fill;
    const cm = POD.fabricCm(st.product, st.sizeId);
    const tw = (f.w * k * st.pattern.tileCm) / cm[0];
    POD.drawPattern(ctx, tile, { repeat: st.pattern.repeat, tw, th: tw, x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k });
    if (ov) ctx.drawImage(ov, 0, 0, out.width, out.height);
    return out;
  }
  const patternTile = (px) => exportTile(px / rects().trim.w);
  /** The small "how it repeats" picture in the options panel. */
  let patTimer = null;
  let patToken = 0;
  function schedulePatternPreview(delay = 400) {
    if (!st.pattern) return;
    clearTimeout(patTimer);
    patTimer = setTimeout(async () => {
      const my = ++patToken;
      try {
        const scene = await patternScene(patternTile(240), 600);
        if (my !== patToken || !st.pattern) return;
        const cv = $('pat-preview');
        cv.width = scene.width;
        cv.height = scene.height;
        cv.getContext('2d').drawImage(scene, 0, 0);
      } catch (e) { /* the picture is only a help */ }
    }, delay);
  }

  /** Product mockup with the trimmed design, for the cart, order page and print queue. */
  function exportPreview() {
    // Fabric: the product covered with the pattern (not the single tile).
    if (st.pattern) return patternScene(patternTile(360), 600).then((cv) => canvasBlob(cv));
    // The whole mockup at 1.2x, without the on-screen garment-size view.
    const z = canvas.width / W;
    const vt = canvas.viewportTransform.slice();
    st.exporting = true;
    const r = rects().trim;
    const objs = canvas.getObjects();
    const clips = objs.map((o) => o.clipPath);
    objs.forEach((o) => { o.clipPath = clipRect(r); o.dirty = true; });
    canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
    try {
      return canvasBlob(canvas.toCanvasElement(1.2 / z));
    } finally {
      canvas.setViewportTransform(vt);
      objs.forEach((o, i) => { o.clipPath = clips[i]; o.dirty = true; });
      st.exporting = false;
    }
  }
  /** Vector SVG of the artwork at its physical size, with the fonts embedded. */
  async function exportSvg(baseSideDef) {
    const side = sideDef(baseSideDef.id); // this size's physical inches
    const { bleed, b, u } = rects(side.id);
    const wIn = +(bleed.w / u).toFixed(4);
    const hIn = +(bleed.h / u).toFixed(4);
    fabric.Text.prototype.svgUnitsPerInch = u;
    let svg = withArtworkOnly(() => canvas.toSVG({ viewBox: { x: bleed.x, y: bleed.y, width: bleed.w, height: bleed.h }, width: `${wIn}in`, height: `${hIn}in` }));
    // Photos are blob: URLs while editing; embed them so the file works anywhere.
    const blobs = [...new Set(svg.match(/blob:[^"']+/g) || [])];
    for (const url of blobs) {
      if (!inlined.has(url)) inlined.set(url, toDataUrl(url));
      svg = svg.split(url).join(await inlined.get(url).catch(() => ''));
    }
    const fonts = await window.POD_FX.fontFaceCss(canvas.getObjects());
    const note = `<!-- OneOff Print artwork: ${side.printWidthIn} x ${side.printHeightIn} in${b ? ` + ${side.bleedIn} in bleed each side` : ''}. sRGB. -->`;
    return svg.replace(/<defs>/, `${note}<defs><style>${fonts}</style>`);
  }
  /** Design layer only, in mockup coordinates, for the live previews. */
  function exportDesignLayer(scale, clip = rects().trim) {
    return withArtworkOnly(() => canvas.toCanvasElement(scale, { left: 0, top: 0, width: W, height: H }), clip);
  }

  // ---------- Photo quality boost ----------
  function boostScale(o) {
    const el = o._originalElement || o.getElement();
    const long = Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height) || 1;
    const dpi = imageDpi(o);
    return Math.max(1, Math.min(4, 4000 / long, Math.max(1.5, 300 / Math.max(1, dpi))));
  }
  function boostBox(o) {
    const dpi = imageDpi(o);
    const k = boostScale(o);
    const text = o.boosted ? t('boost.already') : dpi < 300 && k > 1.05 ? t('boost.textLow', { dpi, to: Math.round(dpi * k) }) : t('boost.textOk');
    return `<div class="field boost-box"><p>${esc(text)}</p>
      <button class="btn btn-sm btn-block ${o.boosted ? '' : 'btn-primary'}" data-act="boost" ${o.boosted ? 'disabled' : ''}>${esc(t('boost.button'))}</button></div>`;
  }
  /** Enlarge and sharpen the photo on the server, keeping its size, crop, shape and filters. */
  async function boostImage(o) {
    if (!o || o.type !== 'image' || o.boosted) return;
    const k0 = boostScale(o);
    busy(true, t('boost.working'));
    try {
      const blob = await (await fetch(o.getSrc())).blob();
      const type = /^image\/(png|jpeg|webp)$/.test(blob.type) ? blob.type : 'image/png';
      const res = await fetch('/api/enhance', { method: 'POST', headers: { 'Content-Type': type, 'x-scale': k0.toFixed(3), 'x-lang': POD.lang }, body: blob });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || t('msg.badImage'));
      const k = Number(res.headers.get('X-Scale')) || k0;
      const url = URL.createObjectURL(await res.blob());
      const keep = { cropX: (o.cropX || 0) * k, cropY: (o.cropY || 0) * k, width: o.width * k, height: o.height * k, scaleX: o.scaleX / k, scaleY: o.scaleY / k };
      await new Promise((resolve) => o.setSrc(url, resolve));
      o.set({ ...keep, boosted: true });
      if (o.filters && o.filters.length) o.applyFilters();
      o.setCoords();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
      renderProps();
      scheduleCheck();
      toast(t('boost.done', { dpi: imageDpi(o) }));
    } finally {
      busy(false);
    }
  }

  // ---------- AI help ----------
  const aiState = { tab: 'slogan', tone: 'funny', lang: POD.lang === 'en' ? 'en' : 'ar', style: 'modern', slogans: [], logos: [], busy: false };
  document.querySelectorAll('[data-ai-pick="lang"] .chip').forEach((c) => c.classList.toggle('active', c.dataset.v === aiState.lang));
  // The AI tool only shows once the shop has switched AI help on.
  const aiTool = document.querySelector('.tool[data-flyout="ai"]');
  aiTool.hidden = true;
  POD.api('/api/ai/status').then((r) => {
    aiTool.hidden = !r.enabled;
    $('ai-off').hidden = r.enabled;
    $('ai-on').hidden = !r.enabled;
  }).catch(() => { $('ai-off').hidden = false; $('ai-on').hidden = true; });
  $('flyout-ai').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ai-tab]');
    if (tab) {
      aiState.tab = tab.dataset.aiTab;
      document.querySelectorAll('[data-ai-tab]').forEach((b) => b.classList.toggle('active', b === tab));
      $('ai-slogan-form').hidden = aiState.tab !== 'slogan';
      $('ai-logo-form').hidden = aiState.tab !== 'logo';
      renderAiResults();
      return;
    }
    const chip = e.target.closest('[data-ai-pick] .chip');
    if (chip) {
      const box = chip.parentElement;
      aiState[box.dataset.aiPick] = chip.dataset.v;
      box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    }
  });
  function aiSpinner() {
    $('ai-results').innerHTML = `<div class="ai-spinner"><div class="spinner"></div>${esc(t('ai.working'))}</div>`;
  }
  async function renderAiResults() {
    const box = $('ai-results');
    if (aiState.tab === 'slogan') {
      box.innerHTML = aiState.slogans.length
        ? `<p class="ai-note">${esc(t('ai.tapToAdd'))}</p><div class="ai-results">${aiState.slogans.map((sl, i) => `<button type="button" class="ai-slogan" data-slogan="${i}" dir="auto" style="font-family:'${esc(sl.font)}'">${esc(sl.text)}</button>`).join('')}</div><p class="ai-note">${esc(t('ai.notice'))}</p>`
        : '';
      aiState.slogans.forEach((sl) => D.ensureFont(sl.font));
      return;
    }
    if (!aiState.logos.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<p class="ai-note">${esc(t('ai.tapLogo'))}</p><div class="ai-logos">${aiState.logos.map((l, i) => `<button type="button" class="ai-logo" data-logo="${i}"><img alt="" data-logo-thumb="${i}"><small dir="auto">${esc(l.name.ar)}</small></button>`).join('')}</div><p class="ai-note">${esc(t('ai.notice'))}</p>`;
    const bg = surfaceHex();
    for (let i = 0; i < aiState.logos.length; i++) {
      const img = box.querySelector(`[data-logo-thumb="${i}"]`);
      if (img) img.src = await D.templateThumb(aiState.logos[i], bg);
    }
  }
  function showAiLeft(n) {
    $('ai-left').textContent = Number.isFinite(n) ? t('ai.left', { n: POD.num ? POD.num(n) : n }) : '';
  }
  async function aiRequest(url, body) {
    if (aiState.busy) return null;
    aiState.busy = true;
    aiSpinner();
    try {
      const r = await POD.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showAiLeft(r.left);
      return r;
    } catch (err) {
      $('ai-results').innerHTML = '';
      toast(err.message, 'error');
      return null;
    } finally {
      aiState.busy = false;
    }
  }
  $('ai-slogan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await aiRequest('/api/ai/slogans', { about: $('ai-about').value, tone: aiState.tone, lang: aiState.lang });
    if (!r) return;
    aiState.slogans = r.slogans || [];
    $('ai-slogan-go').textContent = t('ai.again');
    renderAiResults();
  });
  $('ai-logo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('ai-name').value.trim();
    if (!name) { $('ai-name').focus(); return toast(t('ai.namePh'), 'error'); }
    const r = await aiRequest('/api/ai/logos', { name, tagline: $('ai-tagline').value, style: aiState.style, garment: surfaceHex() });
    if (!r) return;
    const stamp = Date.now();
    aiState.logos = (r.logos || []).map((l, i) => ({ id: `ai-${stamp}-${i}`, name: { en: l.title, ar: l.title }, items: l.items }));
    $('ai-logo-go').textContent = t('ai.again');
    renderAiResults();
  });
  $('ai-results').addEventListener('click', serial(async (e) => {
    const sb = e.target.closest('[data-slogan]');
    if (sb) {
      const sl = aiState.slogans[Number(sb.dataset.slogan)];
      if (!sl) return;
      await D.ensureFont(sl.font, 'normal');
      const arabic = D.ARABIC_RE.test(sl.text);
      addObject(new fabric.IText(sl.text, {
        name: 'Text', fontFamily: sl.font, fontSize: Math.round(area().w * 0.12), fill: inkFor(surfaceHex()),
        direction: arabic ? 'rtl' : 'ltr', textAlign: 'center', paintFirst: 'stroke',
      }));
      closeFlyouts();
      return;
    }
    const lb = e.target.closest('[data-logo]');
    if (lb) {
      const tpl = aiState.logos[Number(lb.dataset.logo)];
      if (tpl) await addTemplate(tpl);
    }
  }));

  // ---------- Share a design (friends approve or suggest changes) ----------
  const hashStr = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  const shareKey = () => 'pod-share:' + st.product.id;
  function designSignature() {
    const designs = {};
    for (const sd of st.product.sides) designs[sd.id] = sd.id === st.side ? serialize() : (st.designs[sd.id] || []);
    return hashStr(JSON.stringify([designs, st.colorId, st.sizeId, st.offsets]));
  }
  function readLastShare() {
    try { return JSON.parse(localStorage.getItem(shareKey()) || 'null'); } catch (e) { return null; }
  }
  const shareUrl = (id) => `${location.origin}/s/${id}`;
  function renderShareReplies(share) {
    const fb = (share && share.feedback) || [];
    $('share-dialog-replies').innerHTML = fb.length
      ? fb.slice().reverse().map((f) => `<li class="${f.vote === 'up' ? 'up' : 'change'}"><strong>${f.vote === 'up' ? '👍 ' + esc(t('share.approved')) : '✏️ ' + esc(t('share.wantsChange'))}</strong>${f.comment ? `<p dir="auto">${esc(f.comment)}</p>` : ''}<span class="muted small">${f.name ? esc(f.name) : ''}</span></li>`).join('')
      : `<li class="muted small">${esc(t('share.noReplies'))}</li>`;
  }
  function openShareDialog(share) {
    st.share = share;
    const url = shareUrl(share.id);
    $('share-url').value = url;
    $('share-wa').href = 'https://wa.me/?text=' + encodeURIComponent(t('share.message', { url }));
    $('share-native').hidden = !navigator.share;
    renderShareReplies(share);
    $('share-dialog').hidden = false;
  }
  $('share-open').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    const sides = designedSides();
    if (!sides.length) return toast(t('msg.addFirst'), 'error');
    const sig = designSignature();
    const last = readLastShare();
    if (last && last.sig === sig) {
      try {
        return openShareDialog(await POD.api('/api/shares/' + encodeURIComponent(last.id)));
      } catch (e) { /* expired or removed: make a new link */ }
    }
    canvas.discardActiveObject();
    const prevZoom = st.zoom;
    if (st.zoom !== 1) setZoom(1);
    const wasPreview = st.preview;
    if (wasPreview) togglePreview();
    const original = st.side;
    busy(true, t('share.creating'));
    try {
      const sidesPayload = {};
      const previews = {};
      for (const sd of sides) {
        await showSide(sd.id);
        sidesPayload[sd.id] = { objects: await inlineImages(st.designs[sd.id]), ...(st.offsets[sd.id] ? { offset: st.offsets[sd.id] } : {}) };
        previews[sd.id] = await toDataUrl(URL.createObjectURL(await exportPreview()));
      }
      await showSide(original);
      const share = await POD.api('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: st.product.id, color: st.colorId, size: st.sizeId, sides: sidesPayload, previews }),
      });
      try { localStorage.setItem(shareKey(), JSON.stringify({ id: share.id, sig })); } catch (e) { /* private mode */ }
      openShareDialog(share);
    } catch (err) {
      await showSide(original).catch(() => {});
      toast(err.message, 'error');
    } finally {
      busy(false);
      if (st.zoom !== prevZoom) setZoom(prevZoom);
      canvas.requestRenderAll();
    }
  }));
  $('share-close').addEventListener('click', () => { $('share-dialog').hidden = true; });
  $('share-dialog').addEventListener('click', (e) => { if (e.target === $('share-dialog')) $('share-dialog').hidden = true; });
  $('share-copy').addEventListener('click', async () => {
    const input = $('share-url');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.select();
      document.execCommand('copy');
    }
    toast(t('share.copied'));
  });
  $('share-native').addEventListener('click', () => {
    const url = $('share-url').value;
    navigator.share({ title: 'OneOff Print', text: t('share.message', { url: '' }).trim(), url }).catch(() => {});
  });
  $('share-refresh').addEventListener('click', async () => {
    if (!st.share) return;
    try { renderShareReplies(st.share = await POD.api('/api/shares/' + encodeURIComponent(st.share.id))); } catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Saved design (draft) ----------
  let draftTimer = null;
  let draftSaving = Promise.resolve(true);
  /** Save the current design for this product in the browser (or forget it when empty). */
  function saveDraft() {
    clearTimeout(draftTimer);
    if (!draftMode || st.exporting) return draftSaving;
    const designs = {};
    for (const s of st.product.sides) designs[s.id] = s.id === st.side ? serialize() : (st.designs[s.id] || []);
    const empty = !Object.values(designs).some((o) => o.length);
    const productId = st.product.id;
    const meta = { productId, colorId: st.colorId, sizeId: st.sizeId, side: st.side, offsets: { ...st.offsets }, ...(st.pattern ? { pattern: { ...st.pattern } } : {}) };
    let preview = null;
    if (!empty) {
      try {
        preview = exportPreview(); // a Blob promise for the products page thumbnail
      } catch (e) {
        preview = null;
      }
    }
    draftSaving = draftSaving.then(async () => {
      if (empty) {
        await POD.drafts.remove(productId);
        return true;
      }
      const inl = {};
      for (const [id, objs] of Object.entries(designs)) inl[id] = await inlineImages(objs);
      const blob = preview ? await preview.catch(() => null) : null;
      return POD.drafts.set(productId, { ...meta, designs: inl, preview: blob, savedAt: new Date().toISOString() });
    });
    return draftSaving;
  }
  function scheduleDraft() {
    if (!draftMode) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 1200);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && draftTimer) saveDraft();
  });

  function busy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  }

  $('add-to-cart').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    const sides = designedSides();
    if (!sides.length) {
      toast(t('msg.addFirst'), 'error');
      return;
    }
    // Pictures imported from other sites: the customer confirms the rights first.
    const imported = hasImports();
    if (imported && !(await confirmRights())) return;

    const prevZoom = st.zoom;
    if (st.zoom !== 1) setZoom(1);
    const wasPreview = st.preview;
    if (wasPreview) togglePreview();
    busy(true, t('busy.preparing'));
    const original = st.side;
    try {
      // 1. Render every designed side and collect print problems.
      const sidesPayload = {};
      const files = {};
      const problems = [];
      for (const s of sides) {
        await showSide(s.id);
        checkIssues().forEach((i) => problems.push(`• ${tr(s.name)}: ${t(i.key, { ...i.params, dpi: i.params.dpi, pt: i.params.pt })}`));
        sidesPayload[s.id] = { editor: { version: fabric.version, objects: await inlineImages(st.designs[s.id]), ...(st.offsets[s.id] ? { offset: st.offsets[s.id] } : {}), ...(st.pattern ? { pattern: { ...st.pattern } } : {}) } };
        files[`${s.id}-print.png`] = await exportPrint(s);
        files[`${s.id}-preview.png`] = await exportPreview();
        files[`${s.id}-design.svg`] = new Blob([await exportSvg(s)], { type: 'image/svg+xml' });
      }
      await showSide(original);
      if (problems.length) {
        busy(false);
        if (!confirm(t('check.confirm', { list: problems.join('\n') }))) return;
        busy(true, t('busy.saving'));
      }

      // 2. Save the layout, 3. upload the files, 4. let the server check and finish them.
      busy(true, t('busy.saving'));
      const created = await POD.api('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: st.product.id, color: st.colorId, size: st.sizeId, sides: sidesPayload, ...(imported ? { rightsConfirmed: true } : {}) }),
      });
      let done = 0;
      busy(true, t('busy.uploading', { n: 0, total: created.files.length }));
      await Promise.all(created.files.map(async (name) => {
        const res = await fetch(`/api/designs/${created.id}/files/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'x-upload-token': created.uploadToken, 'x-lang': POD.lang, 'Content-Type': 'application/octet-stream' },
          body: files[name],
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
        busy(true, t('busy.uploading', { n: ++done, total: created.files.length }));
      }));
      busy(true, t('busy.finishing'));
      const design = await POD.api(`/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });

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
      if (draftMode) {
        clearTimeout(draftTimer);
        await draftSaving;
        await POD.drafts.remove(st.product.id);
      }
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

  // ---------- Live preview (realistic, 3D, print colours) ----------
  $('preview-open').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    const original = st.side;
    const sides = [];
    for (const sd of st.product.sides) {
      if (sd.id !== st.side) await showSide(sd.id);
      if (st.pattern) {
        // Fabric: the product picture with the pattern repeated at its real size.
        const sc = st.product.pattern.scene;
        const f = sc.fill;
        const cm = POD.fabricCm(st.product, st.sizeId);
        const tile = patternTile(600);
        const layer = document.createElement('canvas');
        layer.width = W * 3;
        layer.height = H * 3;
        const tw = (f.w * 3 * st.pattern.tileCm) / cm[0];
        POD.drawPattern(layer.getContext('2d'), tile, { repeat: st.pattern.repeat, tw, th: tw, x: f.x * 3, y: f.y * 3, w: f.w * 3, h: f.h * 3 });
        sides.push({
          side: sd,
          rects: { trim: f, bleed: f, safe: f, u: f.w / (cm[0] / 2.54), b: 0, sf: 0 },
          design: layer,
          designScale: 3,
          hasDesign: canvas.getObjects().length > 0,
          base: POD.mockupUrl(sc, color().hex),
          overlay: sc.overlay ? POD.mockupUrl(sc, color().hex, 'overlay') : null,
          pattern: { tile, repeat: st.pattern.repeat, tileCm: st.pattern.tileCm, cm },
        });
        continue;
      }
      sides.push({
        side: sd,
        rects: rects(sd.id),
        design: exportDesignLayer(3),
        // Canvas prints: the artwork that wraps round the frame, for the 3D sides.
        wrap: st.product.model && st.product.model.type === 'canvas' ? exportDesignLayer(3, rects(sd.id).bleed) : null,
        designScale: 3,
        hasDesign: canvas.getObjects().length > 0,
        base: POD.mockupUrl(sd, color().hex),
        overlay: sd.overlay ? POD.mockupUrl(sd, color().hex, 'overlay') : null,
      });
    }
    if (st.side !== original) await showSide(original);
    canvas.requestRenderAll();
    window.POD_PREVIEW.open({ product: st.product, color: color(), sides, startSide: original, viewScale: POD.sizeView(st.product, st.sizeId) });
  }));

  $('preview-open-m').addEventListener('click', () => $('preview-open').click());

  // Phones scroll the page to show the on-screen keyboard while typing on the
  // product and leave it scrolled afterwards, hiding the top toolbar. The
  // editor page never scrolls, so put it back whenever nothing is being typed.
  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable);
  };
  const phoneLayout = window.matchMedia('(max-width: 820px)');
  const unscroll = () => {
    if (!phoneLayout.matches || typing()) return;
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    for (const el of [document.querySelector('main'), document.querySelector('.editor'), document.querySelector('.stage-wrap')]) {
      if (el && el.scrollTop) el.scrollTop = 0;
    }
  };
  window.addEventListener('scroll', () => setTimeout(unscroll, 150), { passive: true });
  document.addEventListener('focusout', () => setTimeout(unscroll, 300));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(unscroll, 300));

  $('save-draft').addEventListener('click', serial(async () => {
    commit();
    busy(true, t('busy.saving'));
    const ok = await saveDraft();
    busy(false);
    if (!ok) return toast(t('draft.saveFailed'), 'error');
    st.dirty = false;
    location.href = '/?saved=' + encodeURIComponent(st.product.id) + '#products';
  }));

  window.addEventListener('beforeunload', (e) => {
    if (draftMode && draftTimer) saveDraft();
    if (st.dirty && !draftMode) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Re-render everything the shopper reads when the language changes.
  document.addEventListener('pod:langchange', () => {
    renderOptions();
    renderPresets();
    renderShapes();
    renderStickers();
    if (templatesRendered) renderTemplates();
    refreshChrome();
    renderProps();
    canvas.requestRenderAll();
  });

  // ---------- Boot ----------
  renderOptions();
  renderPresets();
  renderShapes();
  renderStickers();
  fit();
  await D.ensureFont('Cairo', 600); // print-area label
  await showSide(st.side);
  seedHistory();
  refreshChrome();
  renderProps();
  renderCheck();
  bootDone = true;
  // Report the phone's real screen measurements once (sizes only) so the
  // layout can be fitted to phones that draw pages behind system bars.
  if (MOBILE.matches) {
    setTimeout(() => {
      try {
        const probe = (css) => {
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;' + css;
          document.body.appendChild(el);
          const v = Math.round(el.getBoundingClientRect().height);
          el.remove();
          return v;
        };
        const bottom = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().bottom) : null; };
        const vv = window.visualViewport;
        const m = {
          ih: innerHeight, iw: innerWidth, oh: outerHeight, sh: screen.height, sah: screen.availHeight, dpr: devicePixelRatio,
          vvh: vv ? Math.round(vv.height) : null, vvt: vv ? Math.round(vv.offsetTop) : null,
          dvh: probe('height:100dvh'), svh: probe('height:100svh'), lvh: probe('height:100lvh'), vh: probe('height:100vh'),
          envB: probe('height:env(safe-area-inset-bottom)'), appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h'),
          body: Math.round(document.body.getBoundingClientRect().height), tools: bottom('.tools'), foot: bottom('.panel-foot'),
          docH: document.documentElement.clientHeight,
        };
        const body = JSON.stringify(m);
        if (!navigator.sendBeacon || !navigator.sendBeacon('/api/client-layout', body)) fetch('/api/client-layout', { method: 'POST', body }).catch(() => {});
      } catch (e) { /* diagnostics only */ }
    }, 1500);
  }
  if (restoredDraft) toast(t('draft.restored'));
  if (fromShare) { toast(t('share.loaded')); scheduleDraft(); }
  if (libraryDesign) {
    if (libraryDesign.kind === 'template') {
      await addTemplate({ id: libraryDesign.id, items: libraryDesign.items, aspect: libraryDesign.aspect });
      canvas.discardActiveObject();
    } else {
      await loadObjects(remap(libraryDesign.objects || [], libraryDesign.area || area(), area()));
      commit();
    }
    canvas.requestRenderAll();
    toast(t('design.loaded'));
    scheduleDraft();
  }
  schedulePatternPreview(0);
  window.__editor = { canvas, st, rects, checkIssues, exportSvg, exportPrint, exportTile, exportPreview }; // handy for debugging in the console
})();
