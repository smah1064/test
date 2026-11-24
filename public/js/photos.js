/* Photo printing: the customer picks many photos at once, each is cropped to
 * its print size (adjustable), chooses copies per photo, and the whole set is
 * uploaded one photo at a time and added to the cart as ONE cart item.
 *
 * Only a small JPEG preview of each photo is kept in memory; the original
 * File is read again only to crop the editor picture and to render its print
 * file. Crops are stored as fractions of the original picture (x, y, w, h). */
(async () => {
  'use strict';
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const PREVIEW_LONG = 480; // card preview, px on the long side
  const EDIT_LONG = 1600; // crop editor picture
  const THUMB_LONG = 400; // thumb-NNN.jpg
  const MAX_PRINT_BYTES = 15 * 1024 * 1024;
  const MAX_THUMB_BYTES = 300 * 1024;
  const MAX_ZOOM = 6;
  const RETRY_MS = [1000, 2500, 5000]; // waits before the 1st, 2nd and 3rd retry of a file

  // ---------- Product ----------
  let product = null;
  try {
    const catalog = await POD.loadCatalog();
    product = (catalog.products || []).find((p) => p.id === 'photoprints') || null;
  } catch (e) {
    product = null;
  }
  if (!product || !product.sizes || !product.sizes.length || !product.colors || !product.colors.length) {
    $('ph-missing').hidden = false;
    return;
  }
  $('ph').hidden = false;

  const cfg = { dpi: 300, borderMm: 4, maxPhotos: 100, maxCopies: 50, lowDpi: 150, ...(product.photo || {}) };
  const borderOpt = (product.options || []).find((o) => o.id === 'border') || null;
  const state = {
    color: product.colors[0].id,
    border: borderOpt && borderOpt.choices.length ? borderOpt.choices[0].id : 'none',
    sizeAll: product.sizes[0].id, // size for photos added from now on
    photos: [],
    decoding: false,
    uploading: false,
    job: null, // an upload in progress (kept after an error so "try again" resumes)
  };
  let uidSeq = 0;
  let leaving = false;

  // ---------- Small helpers ----------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toBlob = (cv, type, q) => new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, q));
  /** Arabic counting: 1, 2, 3–10, 11+ (English uses one / other). */
  function counted(base, n) {
    const r = n % 100;
    const k = n === 1 ? 'one' : n === 2 ? 'two' : r >= 3 && r <= 10 ? 'few' : 'many';
    return t(`${base}.${k}`, { n: POD.num(n) });
  }
  const sizeById = (id) => product.sizes.find((s) => s.id === id) || product.sizes[0];
  const borderPrice = () => {
    const c = borderOpt && borderOpt.choices.find((x) => x.id === state.border);
    return Number(c && c.price) || 0;
  };
  const unitPrice = (sizeId) => Number(product.basePrice) + (Number(sizeById(sizeId).surcharge) || 0) + borderPrice();
  const cheapest = () => {
    const opt = borderOpt ? Math.min(...borderOpt.choices.map((c) => Number(c.price) || 0)) : 0;
    return Number(product.basePrice) + Math.min(...product.sizes.map((s) => Number(s.surcharge) || 0)) + opt;
  };

  // ---------- Geometry (print pixels) ----------
  const px = (cm) => Math.round((cm / 2.54) * cfg.dpi);
  /** The printed page of a photo: W x H px, the white border m and the picture area iw x ih. */
  function page(p) {
    const s = sizeById(p.size);
    const cm = s.cm && s.cm.length === 2 ? s.cm : [10, 15];
    const a = px(Math.min(cm[0], cm[1]));
    const b = px(Math.max(cm[0], cm[1]));
    const land = p.orient === 'landscape';
    const W = land ? b : a;
    const H = land ? a : b;
    const m = state.border === 'white' ? Math.round((cfg.borderMm / 25.4) * cfg.dpi) : 0;
    return { W, H, m, iw: W - 2 * m, ih: H - 2 * m };
  }
  const areaAspect = (p) => {
    const g = page(p);
    return g.iw / g.ih;
  };
  /** The biggest crop (fractions of the picture) of aspect A (px w / px h): it covers the print area. */
  function cover(p, A) {
    const I = p.w / p.h;
    return I > A ? { w: A / I, h: 1 } : { w: 1, h: I / A };
  }
  function clampCrop(c) {
    c.w = Math.min(c.w, 1);
    c.h = Math.min(c.h, 1);
    c.x = clamp(c.x, 0, 1 - c.w);
    c.y = clamp(c.y, 0, 1 - c.h);
    return c;
  }
  /** How far a crop is zoomed in, compared with just covering its frame (1 = not zoomed). */
  function zoomOf(p, c) {
    const A = (c.w * p.w) / (c.h * p.h);
    return cover(p, A).w / c.w;
  }
  function cropAt(p, A, z, cx, cy) {
    const cv = cover(p, A);
    const k = clamp(z, 1, MAX_ZOOM);
    const w = cv.w / k;
    const h = cv.h / k;
    return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
  }
  /** After the size, orientation or border changed: same centre and zoom, new shape. */
  function refit(p) {
    const A = areaAspect(p);
    const c = p.crop;
    p.crop = c ? cropAt(p, A, zoomOf(p, c), c.x + c.w / 2, c.y + c.h / 2) : cropAt(p, A, 1, 0.5, 0.5);
  }
  /** Effective DPI: original pixels across the crop / print inches across the picture area. */
  function dpiOf(p, c = p.crop) {
    const g = page(p);
    return Math.round(Math.min((c.w * p.w) / (g.iw / cfg.dpi), (c.h * p.h) / (g.ih / cfg.dpi)));
  }

  // ---------- Decoding ----------
  /** Decode a picture file with its EXIF rotation applied: { source, width, height, close }. */
  async function decodeFile(file) {
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
      } catch (e) {
        /* fall back to an <img> (e.g. HEIC on Safari) */
      }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
  /** A scaled copy of a decoded picture on a canvas (long side at most `long`). */
  function scaled(src, long) {
    const k = Math.min(1, long / Math.max(src.width, src.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(src.width * k));
    cv.height = Math.max(1, Math.round(src.height * k));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.source, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function loadPhoto(file) {
    const src = await decodeFile(file);
    try {
      if (!(src.width > 1 && src.height > 1)) throw new Error('empty');
      const cv = scaled(src, PREVIEW_LONG);
      const blob = await toBlob(cv, 'image/jpeg', 0.85);
      cv.width = cv.height = 0;
      const p = {
        uid: ++uidSeq,
        file,
        w: src.width,
        h: src.height,
        url: URL.createObjectURL(blob),
        size: state.sizeAll,
        copies: 1,
        orient: src.width > src.height ? 'landscape' : 'portrait',
        crop: null,
      };
      refit(p);
      return p;
    } finally {
      src.close();
    }
  }

  // ---------- Hero and settings ----------
  function renderHero() {
    $('ph-from').textContent = t('photos.from', { price: money(cheapest()) });
  }
  const chipHtml = (attr, id, inner) => `<button type="button" class="chip" data-${attr}="${esc(id)}" aria-pressed="false">${inner}</button>`;
  function renderSettings() {
    $('ph-paper-label').textContent = product.colorLabel ? tr(product.colorLabel) : t('panel.colour');
    $('ph-paper').innerHTML = product.colors.map((c) => chipHtml('paper', c.id, esc(tr(c.name)))).join('');
    const bf = $('ph-border').closest('.field');
    bf.hidden = !borderOpt;
    if (borderOpt) {
      $('ph-border-label').textContent = tr(borderOpt.name);
      $('ph-border').innerHTML = borderOpt.choices.map((c) => chipHtml('border', c.id, esc(tr(c.name)))).join('');
    }
    $('ph-sizeall').innerHTML = product.sizes
      .map((s) => chipHtml('size', s.id, `<span>${esc(tr(s.label))}</span><span class="ph-chip-price" data-price-for="${esc(s.id)}"></span>`))
      .join('');
    syncSettings();
  }
  function syncSettings() {
    const mark = (box, attr, active) => box.querySelectorAll(`[data-${attr}]`).forEach((b) => {
      const on = b.dataset[attr] === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    mark($('ph-paper'), 'paper', state.color);
    mark($('ph-border'), 'border', state.border);
    const sizes = new Set(state.photos.map((p) => p.size));
    const mixed = sizes.size > 1;
    // All photos one size (also when set photo by photo): new photos get that size too.
    if (sizes.size === 1) state.sizeAll = [...sizes][0];
    mark($('ph-sizeall'), 'size', mixed ? null : sizes.size === 1 ? [...sizes][0] : state.sizeAll);
    $('ph-mixed').hidden = !mixed;
    $('ph-sizeall').querySelectorAll('[data-price-for]').forEach((el) => (el.textContent = money(unitPrice(el.dataset.priceFor))));
  }

  // ---------- Photo cards ----------
  const ICON = {
    rotate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    crop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    warn: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>',
  };
  const grid = $('ph-grid');
  const cardOf = (p) => grid.querySelector(`[data-uid="${p.uid}"]`);
  const photoOf = (el) => {
    const card = el.closest('[data-uid]');
    return card ? state.photos.find((p) => p.uid === Number(card.dataset.uid)) : null;
  };
  function cardHtml(p) {
    // Short labels ("10×15 · 15 EGP") so the price is never cut off on small phones.
    const opts = product.sizes.map((s) => `<option value="${esc(s.id)}">${esc(s.cm ? `${s.cm[0]}×${s.cm[1]}` : tr(s.label))} · ${esc(money(unitPrice(s.id)))}</option>`).join('');
    return `
      <div class="ph-thumb">
        <button type="button" class="ph-print" data-act="crop"><span class="ph-area"><img alt="" draggable="false" decoding="async" src="${esc(p.url)}"></span></button>
        <span class="ph-warn" hidden>${ICON.warn}<span>${esc(t('photos.blurry'))}</span></span>
        <button type="button" class="ph-x" data-act="remove">${ICON.x}</button>
      </div>
      <div class="ph-body">
        <select class="ph-size">${opts}</select>
        <div class="ph-step" role="group">
          <button type="button" class="ph-step-btn" data-act="less" aria-label="${esc(t('photos.less'))}">−</button>
          <input type="number" class="ph-copies" inputmode="numeric" min="1" max="${cfg.maxCopies}" step="1">
          <button type="button" class="ph-step-btn" data-act="more" aria-label="${esc(t('photos.more'))}">+</button>
        </div>
        <div class="ph-tools">
          <button type="button" class="btn btn-sm" data-act="rotate">${ICON.rotate}<span>${esc(t('photos.rotate'))}</span></button>
          <button type="button" class="btn btn-sm" data-act="crop">${ICON.crop}<span>${esc(t('photos.crop'))}</span></button>
        </div>
      </div>`;
  }
  function labelCard(p, i) {
    const card = cardOf(p);
    if (!card) return;
    const n = POD.num(i + 1);
    const name = t('photos.photoN', { n });
    card.setAttribute('aria-label', name);
    card.querySelector('.ph-print').setAttribute('aria-label', t('photos.cropN', { n }));
    card.querySelector('.ph-x').setAttribute('aria-label', t('photos.remove', { n }));
    card.querySelector('.ph-x').title = t('photos.remove', { n });
    card.querySelector('.ph-size').setAttribute('aria-label', `${t('photos.size')} · ${name}`);
    card.querySelector('.ph-step').setAttribute('aria-label', `${t('photos.copies')} · ${name}`);
    card.querySelector('.ph-copies').setAttribute('aria-label', `${t('photos.copies')} · ${name}`);
  }
  /** Show the card's picture exactly as it will print, and its current values. */
  function paintCard(p) {
    const card = cardOf(p);
    if (!card) return;
    const g = page(p);
    const long = 88;
    const print = card.querySelector('.ph-print');
    print.style.width = `${g.W >= g.H ? long : (long * g.W) / g.H}%`;
    print.style.height = `${g.H >= g.W ? long : (long * g.H) / g.W}%`;
    const area = card.querySelector('.ph-area');
    area.style.left = area.style.right = `${(g.m / g.W) * 100}%`;
    area.style.top = area.style.bottom = `${(g.m / g.H) * 100}%`;
    const c = p.crop;
    const img = card.querySelector('.ph-area img');
    img.style.width = `${100 / c.w}%`;
    img.style.height = `${100 / c.h}%`;
    img.style.left = `${(-c.x / c.w) * 100}%`;
    img.style.top = `${(-c.y / c.h) * 100}%`;
    card.querySelector('.ph-size').value = p.size;
    const input = card.querySelector('.ph-copies');
    if (document.activeElement !== input || Number(input.value) !== p.copies) input.value = p.copies;
    card.querySelector('[data-act="less"]').disabled = p.copies <= 1;
    card.querySelector('[data-act="more"]').disabled = p.copies >= cfg.maxCopies;
    const rot = card.querySelector('[data-act="rotate"]');
    rot.title = t(p.orient === 'landscape' ? 'photos.toPortrait' : 'photos.toLandscape');
    const dpi = dpiOf(p);
    const warn = card.querySelector('.ph-warn');
    warn.hidden = dpi >= cfg.lowDpi;
    warn.title = t('photos.blurryTip', { dpi: POD.num(dpi) });
    card.classList.toggle('is-low', dpi < cfg.lowDpi);
  }
  function appendCard(p) {
    const card = document.createElement('article');
    card.className = 'card ph-card';
    card.dataset.uid = p.uid;
    card.innerHTML = cardHtml(p);
    grid.appendChild(card);
    labelCard(p, state.photos.indexOf(p));
    paintCard(p);
  }
  function rebuildCards() {
    grid.innerHTML = '';
    state.photos.forEach(appendCard);
  }
  const repaintAll = () => state.photos.forEach((p) => paintCard(p));

  // ---------- Summary bar ----------
  function update() {
    const n = state.photos.length;
    const prints = state.photos.reduce((s, p) => s + p.copies, 0);
    const total = state.photos.reduce((s, p) => s + p.copies * unitPrice(p.size), 0);
    $('ph-sum-count').textContent = n ? `${counted('photos.n', n)} · ${counted('photos.prints', prints)}` : t('photos.none');
    $('ph-sum-total').textContent = t('photos.total', { price: money(total) });
    $('ph-add').disabled = !n || state.decoding || state.uploading;
    $('ph-photos-count').textContent = n ? `(${POD.num(n)})` : '';
    $('ph-empty').hidden = n > 0 || state.decoding;
    $('ph-pick-label').textContent = t(n ? 'photos.pickMore' : 'photos.pick');
    $('ph-drop').classList.toggle('has-photos', n > 0);
    syncSettings();
  }
  const status = (msg) => ($('ph-status').textContent = msg || '');

  // ---------- Adding photos ----------
  const queue = [];
  let prepared = 0;
  function addFiles(list) {
    if (state.uploading) return;
    const files = Array.from(list || []);
    if (!files.length) return;
    const room = cfg.maxPhotos - state.photos.length - queue.length;
    if (room <= 0) {
      POD.toast(t('photos.full', { max: POD.num(cfg.maxPhotos) }), 'error');
      return;
    }
    if (files.length > room) POD.toast(t('photos.tooMany', { max: POD.num(cfg.maxPhotos), n: POD.num(room) }), 'error');
    queue.push(...files.slice(0, room));
    if (!state.decoding) drain();
  }
  async function drain() {
    state.decoding = true;
    prepared = 0;
    update();
    while (queue.length) {
      status(t('photos.preparing', { i: POD.num(prepared + 1), n: POD.num(prepared + queue.length) }));
      const file = queue.shift();
      try {
        const p = await loadPhoto(file);
        state.photos.push(p);
        appendCard(p);
      } catch (e) {
        POD.toast(t('photos.badFile', { name: file.name || '?' }), 'error');
      }
      prepared++;
      update();
    }
    state.decoding = false;
    status('');
    update();
  }

  $('ph-pick-btn').addEventListener('click', () => !state.uploading && $('ph-file').click());
  $('ph-file').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  // Drop photos anywhere on the page.
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    $('ph-drop').classList.add('over');
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('ph-drop').classList.remove('over');
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = state.uploading ? 'none' : 'copy';
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('ph-drop').classList.remove('over');
    addFiles(e.dataTransfer.files);
  });

  // ---------- Settings ----------
  $('ph-paper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-paper]');
    if (!b || state.uploading) return;
    state.color = b.dataset.paper;
    syncSettings();
  });
  $('ph-border').addEventListener('click', (e) => {
    const b = e.target.closest('[data-border]');
    if (!b || state.uploading) return;
    state.border = b.dataset.border;
    state.photos.forEach(refit);
    // Option prices may differ: the size lists show prices.
    state.photos.forEach((p) => {
      const card = cardOf(p);
      if (card) card.querySelectorAll('.ph-size option').forEach((o) => (o.textContent = `${tr(sizeById(o.value).label)} · ${money(unitPrice(o.value))}`));
    });
    repaintAll();
    update();
  });
  $('ph-sizeall').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b || state.uploading) return;
    state.sizeAll = b.dataset.size;
    state.photos.forEach((p) => {
      p.size = state.sizeAll;
      refit(p);
    });
    repaintAll();
    update();
  });

  // ---------- Card actions ----------
  function setCopies(p, v) {
    p.copies = clamp(Math.round(Number(v)) || 1, 1, cfg.maxCopies);
    paintCard(p);
    update();
  }
  function removePhoto(p) {
    const i = state.photos.indexOf(p);
    if (i < 0) return;
    const card = cardOf(p);
    state.photos.splice(i, 1);
    URL.revokeObjectURL(p.url);
    if (card) card.remove();
    state.photos.forEach(labelCard);
    update();
    const next = state.photos[i] || state.photos[i - 1];
    const focus = next ? cardOf(next).querySelector('.ph-print') : $('ph-pick-btn');
    focus.focus();
  }
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || state.uploading) return;
    const p = photoOf(b);
    if (!p) return;
    const act = b.dataset.act;
    if (act === 'remove') removePhoto(p);
    else if (act === 'less') setCopies(p, p.copies - 1);
    else if (act === 'more') setCopies(p, p.copies + 1);
    else if (act === 'rotate') {
      p.orient = p.orient === 'landscape' ? 'portrait' : 'landscape';
      refit(p);
      paintCard(p);
      update();
    } else if (act === 'crop') openCrop(p, b);
  });
  grid.addEventListener('change', (e) => {
    const p = photoOf(e.target);
    if (!p || state.uploading) return;
    if (e.target.matches('.ph-size')) {
      p.size = e.target.value;
      refit(p);
      paintCard(p);
      update();
    } else if (e.target.matches('.ph-copies')) {
      setCopies(p, e.target.value);
      e.target.value = p.copies;
    }
  });
  grid.addEventListener('input', (e) => {
    if (!e.target.matches('.ph-copies')) return;
    const p = photoOf(e.target);
    const v = Number(e.target.value);
    if (!p || !Number.isFinite(v) || v < 1) return;
    p.copies = clamp(Math.round(v), 1, cfg.maxCopies);
    update();
  });

  // ---------- Crop editor ----------
  const modal = $('ph-crop');
  const stage = $('ph-stage');
  const scv = $('ph-stage-cv');
  const zoomInput = $('ph-zoom');
  zoomInput.max = String(MAX_ZOOM);
  const ed = { p: null, c: null, A: 1, pic: null, frame: null, pagebox: null, back: null, pointers: new Map(), token: 0 };

  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    scv.width = Math.max(1, Math.round(r.width * dpr));
    scv.height = Math.max(1, Math.round(r.height * dpr));
    scv.style.width = `${r.width}px`;
    scv.style.height = `${r.height}px`;
    const g = page(ed.p);
    const pad = Math.min(36, Math.max(16, r.width * 0.06));
    const k = Math.min((r.width - 2 * pad) / g.W, (r.height - 2 * pad) / g.H);
    const pl = (r.width - g.W * k) / 2;
    const pt = (r.height - g.H * k) / 2;
    ed.pagebox = { l: pl, t: pt, w: g.W * k, h: g.H * k };
    ed.frame = { l: pl + g.m * k, t: pt + g.m * k, w: g.iw * k, h: g.ih * k };
  }
  function draw() {
    if (!ed.p) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = scv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = scv.width / dpr;
    const H = scv.height / dpr;
    const f = ed.frame;
    const pg = ed.pagebox;
    const c = ed.c;
    ctx.fillStyle = '#1b1e25';
    ctx.fillRect(0, 0, W, H);
    if (ed.pic) {
      const sw = ed.pic.width;
      const sh = ed.pic.height;
      const kx = f.w / (c.w * sw);
      const ky = f.h / (c.h * sh);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(ed.pic, f.l - c.x * sw * kx, f.t - c.y * sh * ky, sw * kx, sh * ky);
    }
    // Dim what will be cut off; the white border as it will print.
    ctx.fillStyle = 'rgba(16, 18, 24, .62)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(pg.l, pg.t, pg.w, pg.h);
    ctx.fill('evenodd');
    if (f.w < pg.w) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.rect(pg.l, pg.t, pg.w, pg.h);
      ctx.rect(f.l, f.t, f.w, f.h);
      ctx.fill('evenodd');
    }
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(f.l + (f.w * i) / 3, f.t);
      ctx.lineTo(f.l + (f.w * i) / 3, f.t + f.h);
      ctx.moveTo(f.l, f.t + (f.h * i) / 3);
      ctx.lineTo(f.l + f.w, f.t + (f.h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(pg.l - 1, pg.t - 1, pg.w + 2, pg.h + 2);
    const z = zoomOf(ed.p, c);
    zoomInput.value = String(z);
    zoomInput.setAttribute('aria-valuetext', `${POD.num(Math.round(z * 100))}%`);
    const dpi = dpiOf(ed.p, c);
    const warn = $('ph-crop-warn');
    warn.hidden = dpi >= cfg.lowDpi;
    warn.textContent = `${t('photos.blurry')} · ${t('photos.blurryTip', { dpi: POD.num(dpi) })}`;
  }
  function pan(dx, dy) {
    const c = ed.c;
    c.x -= (dx / ed.frame.w) * c.w;
    c.y -= (dy / ed.frame.h) * c.h;
    clampCrop(c);
    draw();
  }
  /** Zoom to z keeping the picture point under (sx, sy) (stage px) in place. */
  function zoomTo(z, sx = ed.frame.l + ed.frame.w / 2, sy = ed.frame.t + ed.frame.h / 2) {
    const c = ed.c;
    const cv = cover(ed.p, ed.A);
    const k = clamp(z, 1, MAX_ZOOM);
    const fx = (sx - ed.frame.l) / ed.frame.w;
    const fy = (sy - ed.frame.t) / ed.frame.h;
    const u = c.x + fx * c.w;
    const v = c.y + fy * c.h;
    const w = cv.w / k;
    const h = cv.h / k;
    ed.c = clampCrop({ x: u - fx * w, y: v - fy * h, w, h });
    draw();
  }
  const trapKeys = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCrop(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const els = Array.from(modal.querySelectorAll('button, input, [tabindex="0"]')).filter((el) => !el.disabled && el.offsetParent !== null);
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  async function openCrop(p, from) {
    const token = ++ed.token;
    ed.p = p;
    ed.c = { ...p.crop };
    ed.A = areaAspect(p);
    ed.back = from;
    ed.pic = null;
    ed.sharp = false;
    ed.pointers.clear();
    modal.hidden = false;
    document.body.classList.add('ph-noscroll');
    modal.addEventListener('keydown', trapKeys);
    layout();
    draw();
    stage.focus();
    // The card preview at once, a sharper picture from the original file when it is decoded.
    const quick = new Image();
    quick.src = p.url;
    quick.decode().then(() => {
      if (ed.token === token && !ed.sharp) {
        ed.pic = quick;
        draw();
      }
    }).catch(() => {});
    try {
      const src = await decodeFile(p.file);
      const cv = scaled(src, EDIT_LONG);
      src.close();
      if (ed.token === token) {
        ed.pic = cv;
        ed.sharp = true;
        draw();
      }
    } catch (e) {
      /* the preview is good enough */
    }
  }
  function closeCrop(save) {
    if (!ed.p) return;
    const p = ed.p;
    if (save) {
      p.crop = clampCrop({ ...ed.c });
      paintCard(p);
      update();
    }
    ed.token++;
    ed.p = null;
    ed.pic = null;
    modal.hidden = true;
    document.body.classList.remove('ph-noscroll');
    modal.removeEventListener('keydown', trapKeys);
    const back = ed.back && ed.back.isConnected ? ed.back : cardOf(p) && cardOf(p).querySelector('.ph-print');
    if (back) back.focus();
  }
  $('ph-crop-done').addEventListener('click', () => closeCrop(true));
  $('ph-crop-cancel').addEventListener('click', () => closeCrop(false));
  $('ph-crop-close').addEventListener('click', () => closeCrop(false));
  modal.addEventListener('click', (e) => e.target === modal && closeCrop(false));
  $('ph-crop-reset').addEventListener('click', () => {
    ed.c = cropAt(ed.p, ed.A, 1, 0.5, 0.5);
    draw();
  });
  zoomInput.addEventListener('input', () => zoomTo(Number(zoomInput.value)));
  $('ph-zoom-in').addEventListener('click', () => zoomTo(zoomOf(ed.p, ed.c) * 1.25));
  $('ph-zoom-out').addEventListener('click', () => zoomTo(zoomOf(ed.p, ed.c) / 1.25));
  window.addEventListener('resize', () => {
    if (!ed.p) return;
    layout();
    draw();
  });
  const stagePoint = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  scv.addEventListener('pointerdown', (e) => {
    if (!ed.p) return;
    scv.setPointerCapture(e.pointerId);
    ed.pointers.set(e.pointerId, stagePoint(e));
  });
  scv.addEventListener('pointermove', (e) => {
    if (!ed.pointers.has(e.pointerId)) return;
    const now = stagePoint(e);
    if (ed.pointers.size === 1) {
      const was = ed.pointers.get(e.pointerId);
      ed.pointers.set(e.pointerId, now);
      pan(now.x - was.x, now.y - was.y);
      return;
    }
    const pts = () => Array.from(ed.pointers.values()).slice(0, 2);
    const [a0, b0] = pts();
    ed.pointers.set(e.pointerId, now);
    const [a1, b1] = pts();
    const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
    const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
    const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    zoomTo(zoomOf(ed.p, ed.c) * (d1 / d0), m0.x, m0.y);
    pan(m1.x - m0.x, m1.y - m0.y);
  });
  const endPointer = (e) => ed.pointers.delete(e.pointerId);
  scv.addEventListener('pointerup', endPointer);
  scv.addEventListener('pointercancel', endPointer);
  scv.addEventListener('wheel', (e) => {
    if (!ed.p) return;
    e.preventDefault();
    const pt = stagePoint(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomTo(zoomOf(ed.p, ed.c) * Math.exp(-dy * 0.0015), pt.x, pt.y);
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    if (!ed.p) return;
    const step = e.shiftKey ? 40 : 10;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      pan(...moves[e.key]);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomTo(zoomOf(ed.p, ed.c) * 1.1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomTo(zoomOf(ed.p, ed.c) / 1.1);
    }
  });

  // ---------- Print files ----------
  /** The print file (exact pixel size at the print DPI) and its small thumb, as JPEG blobs. */
  async function renderPrint(p) {
    const g = page(p);
    const c = p.crop;
    const src = await decodeFile(p.file);
    const cv = document.createElement('canvas');
    cv.width = g.W;
    cv.height = g.H;
    let tc = null;
    try {
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, g.W, g.H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src.source, c.x * src.width, c.y * src.height, c.w * src.width, c.h * src.height, g.m, g.m, g.iw, g.ih);
      src.close();
      let print = null;
      for (const q of [0.92, 0.85, 0.75, 0.6]) {
        print = await toBlob(cv, 'image/jpeg', q);
        if (print.size <= MAX_PRINT_BYTES) break;
      }
      const k = THUMB_LONG / Math.max(g.W, g.H);
      tc = document.createElement('canvas');
      tc.width = Math.round(g.W * k);
      tc.height = Math.round(g.H * k);
      const tctx = tc.getContext('2d');
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(cv, 0, 0, tc.width, tc.height);
      let thumb = null;
      for (const q of [0.8, 0.7, 0.55]) {
        thumb = await toBlob(tc, 'image/jpeg', q);
        if (thumb.size <= MAX_THUMB_BYTES) break;
      }
      return { print, thumb };
    } finally {
      try { src.close(); } catch (e) { /* already closed */ }
      cv.width = cv.height = 0; // let phones free the memory at once
      if (tc) tc.width = tc.height = 0;
    }
  }

  // ---------- Upload ----------
  const bar = { main: $('ph-bar-main'), up: $('ph-bar-up'), err: $('ph-bar-err') };
  function showBar(which) {
    bar.main.hidden = which !== 'main';
    bar.up.hidden = which !== 'up';
    bar.err.hidden = which !== 'err';
  }
  function progress(text, frac) {
    showBar('up');
    $('ph-up-text').textContent = text;
    const pct = Math.round(clamp(frac, 0, 1) * 100);
    $('ph-progress-fill').style.width = `${pct}%`;
    $('ph-progress').setAttribute('aria-valuenow', String(pct));
  }
  function lock(on) {
    state.uploading = on;
    ['ph-side', 'ph-grid'].forEach((id) => {
      $(id).inert = on;
      $(id).classList.toggle('ph-locked', on);
    });
    document.querySelector('.ph-layout').setAttribute('aria-busy', String(on));
    update();
  }
  /** Which files belong to which photo: ['photo-001.jpg', 'thumb-001.jpg', …] → [{ photo, thumb }, …]. */
  function filesByPhoto(files, n) {
    const out = Array.from({ length: n }, () => ({}));
    for (const name of files || []) {
      const m = /^(photo|thumb)-(\d+)\.jpe?g$/i.exec(name);
      const i = m ? Number(m[2]) - 1 : -1;
      if (i < 0 || i >= n) throw new Error(t('msg.requestFailed', { status: 'files' }));
      out[i][m[1].toLowerCase()] = name;
    }
    if (out.some((f) => !f.photo)) throw new Error(t('msg.requestFailed', { status: 'files' }));
    return out;
  }
  const retryable = (status) => status >= 500 || status === 408 || status === 429;
  async function putFile(job, name, blob) {
    const url = `/api/designs/${encodeURIComponent(job.created.id)}/files/${encodeURIComponent(name)}`;
    for (let attempt = 0; ; attempt++) {
      let res = null;
      try {
        res = await fetch(url, {
          method: 'PUT',
          headers: { 'x-upload-token': job.created.uploadToken, 'x-lang': POD.lang, 'Content-Type': 'image/jpeg' },
          body: blob,
        });
      } catch (e) {
        res = null; // network error
      }
      if (res && res.ok) return;
      if (attempt >= RETRY_MS.length || (res && !retryable(res.status))) {
        if (!res) throw new Error(t('msg.network'));
        const body = await res.json().catch(() => null);
        const err = new Error((body && body.error) || t('msg.requestFailed', { status: res.status }));
        err.status = res.status;
        err.code = body && body.code;
        throw err;
      }
      await sleep(RETRY_MS[attempt]);
    }
  }
  async function completeJob(job) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await POD.api(`/api/designs/${encodeURIComponent(job.created.id)}/complete`, { method: 'POST', headers: { 'x-upload-token': job.created.uploadToken } });
      } catch (e) {
        if (attempt >= RETRY_MS.length || !(e.network || retryable(e.status))) throw e;
        await sleep(RETRY_MS[attempt]);
      }
    }
  }
  async function runJob(job) {
    const n = state.photos.length;
    for (; job.next < n; job.next++) {
      const i = job.next;
      const names = job.files[i];
      const label = t('photos.uploading', { i: POD.num(i + 1), n: POD.num(n) });
      progress(label, i / n);
      let blobs = job.cache && job.cache.i === i ? job.cache.blobs : null;
      if (!blobs) {
        try {
          blobs = await renderPrint(state.photos[i]);
        } catch (e) {
          throw new Error(t('photos.renderFailed', { n: POD.num(i + 1) }));
        }
        job.cache = { i, blobs };
      }
      const todo = [[names.photo, blobs.print], [names.thumb, blobs.thumb]].filter(([name]) => name && !job.sent.has(name));
      for (const [name, blob] of todo) {
        await putFile(job, name, blob);
        job.sent.add(name);
        progress(label, (i + (job.sent.has(names.photo) ? 0.85 : 0.1)) / n);
      }
      job.cache = null;
    }
    progress(t('photos.finishing'), 1);
    const done = await completeJob(job);
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
    state.job = null;
    leaving = true;
    location.href = '/cart?added=1';
  }
  async function startUpload() {
    if (!state.photos.length || state.decoding || (state.uploading && bar.err.hidden)) return;
    if (ed.p) closeCrop(false);
    lock(true);
    progress(t('photos.creating'), 0);
    try {
      if (!state.job) {
        const body = {
          color: state.color,
          options: { border: state.border },
          photos: state.photos.map((p) => ({ size: p.size, copies: p.copies, orientation: p.orient, dpi: dpiOf(p) })),
        };
        const created = await POD.api('/api/photosets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        state.job = { created, files: filesByPhoto(created.files, state.photos.length), next: 0, sent: new Set(), cache: null };
      }
      await runJob(state.job);
    } catch (e) {
      showBar('err');
      $('ph-err-text').textContent = t('photos.failed', { msg: e.message || t('msg.network') });
      $('ph-retry').focus();
    }
  }
  $('ph-add').addEventListener('click', startUpload);
  $('ph-retry').addEventListener('click', startUpload);
  $('ph-cancel').addEventListener('click', () => {
    state.job = null; // the next "Add to cart" starts a new set
    showBar('main');
    lock(false);
    $('ph-add').focus();
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.uploading && !leaving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Start ----------
  function renderAll() {
    $('ph-drop-hint').textContent = t('photos.drop', { max: POD.num(cfg.maxPhotos) });
    renderHero();
    renderSettings();
    rebuildCards();
    update();
  }
  renderAll();
  showBar('main');
  document.addEventListener('pod:langchange', () => {
    renderAll();
    if (ed.p) draw();
  });
})();
