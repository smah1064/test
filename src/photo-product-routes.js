'use strict';

/**
 * "New product from photo", slice 1: a straight or tapered cup / tumbler made from TYPED measurements.
 * Mounted by src/app.js after the catalogue routes:
 *
 *   const photoProducts = require('./photo-product-routes').mount(app, {
 *     store, guard: requireCatalog, HttpError, catalog, getProduct, PRODUCTS, syncCatalog, logCatalog,
 *     adminProduct, saveProductEdit, approvalsAll,
 *   });
 *   Object.assign(APPROVAL_CHECKS, photoProducts.approvalChecks);   // (APPROVAL_CHECKS is defined further down)
 *
 *   POST /api/admin/photo-products/from-measurements   (catalog.edit, an owner approves it first)
 *        { kind, handle:{ widthMm, y0Mm, y1Mm }|null, typed:{ heightMm, topDiaMm, bottomDiaMm, printTopMm, printHeightMm },
 *          material, gapMm?, safeMm?, id, name:{ en, ar }, price? } -> 201 { product } (the admin view)
 *        A hidden clone of `mug` (with a handle) or `tumbler` (without) carrying `drinkware` (src/drinkware.js).
 *        The price is the owner's: a team member's product starts at the template's prices.
 *   PUT  /api/admin/catalog/:id/drinkware               (catalog.edit, approved first) re-measure: the same fields
 *        without id / name / price (kind and material optional: kept). -> { product }. The dimensions need checking
 *        again (checkedAt cleared); a product in the shop is paused until they are (catalog.remeasure).
 *   POST /api/admin/catalog/:id/drinkware/check         (owners only) "Dimensions checked": sets checkedAt / checkedBy.
 *   GET  /api/admin/catalog/:id/template.svg | template.pdf | spec.pdf   (catalog.view) via src/fan-files.js.
 *
 * Every number is checked here (the browser is never trusted for geometry); src/drinkware.js buildSpec checks again.
 * Changes held for an owner are run again unchanged when approved (src/roles.js `replay`): the handlers read only
 * the request and the catalogue as it is then, so a replay does exactly what was approved, or fails cleanly (e.g. the
 * product code was taken meanwhile). `approvalChecks` gives the team member the same answers at once, and keeps the
 * body as it will be applied (rounded numbers, defaults filled in, no price from a team member).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const drinkwareMod = require('./drinkware');

const L = (en, ar) => ({ en, ar });
// Field names for the messages, in both languages (format() picks the page's language).
const LABELS = {
  heightMm: L('Height', 'الارتفاع'),
  topDiaMm: L('Top diameter', 'القطر من فوق'),
  bottomDiaMm: L('Bottom diameter', 'القطر من تحت'),
  printTopMm: L('Print band top', 'بداية منطقة الطباعة من فوق'),
  printHeightMm: L('Print band height', 'ارتفاع منطقة الطباعة'),
  gapMm: L('Seam gap', 'مسافة اللحام'),
  safeMm: L('Safe margin', 'هامش الأمان'),
  widthMm: L('Handle width', 'عرض اليد'),
  y0Mm: L('Handle top', 'بداية اليد من فوق'),
  y1Mm: L('Handle bottom', 'نهاية اليد من تحت'),
  kind: L('Kind', 'النوع'),
  material: L('Material', 'الخامة'),
  handle: L('Handle', 'اليد'),
  typed: L('Measurements', 'المقاسات'),
  name: L('Name', 'الاسم'),
};
// [min, max] in mm: the builder's own limits (src/drinkware.js LIMITS; spec F: height 30–400, diameters 20–200).
const LIM = drinkwareMod.LIMITS;
const RANGES = {
  heightMm: LIM.heightMm, topDiaMm: LIM.diaMm, bottomDiaMm: LIM.diaMm,
  printTopMm: [0, LIM.heightMm[1]], printHeightMm: [LIM.bandMinMm, LIM.heightMm[1]],
  gapMm: LIM.gapMm, safeMm: LIM.safeMm,
  widthMm: LIM.handleWidthMm, y0Mm: [0, LIM.heightMm[1]], y1Mm: [0, LIM.heightMm[1]],
};
const DEFAULTS = { gapMm: 5, safeMm: 3 };
const MIN_HANDLE_MM = 5; // handle top to bottom (as src/drinkware.js)
const MAX_PRICE = 1e6;
const NEW_FIELDS = new Set(['kind', 'handle', 'typed', 'material', 'gapMm', 'safeMm', 'id', 'name', 'price']);
const MEASURE_FIELDS = new Set(['kind', 'handle', 'typed', 'material', 'gapMm', 'safeMm']);
const TYPED_FIELDS = ['heightMm', 'topDiaMm', 'bottomDiaMm', 'printTopMm', 'printHeightMm'];
const HANDLE_FIELDS = ['widthMm', 'y0Mm', 'y1Mm'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round1 = (n) => Math.round(n * 10) / 10;
// The catalogue's own text cleaning (src/catalog.js `text`): no control characters or angle brackets, one line.
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const templateOf = (handle) => (handle ? 'mug' : 'tumbler');

/**
 * Check the measurements part of a request. Returns the clean input for drinkware.buildSpec:
 * { kind, material, typed:{...}, handle:{...}|null, gapMm, safeMm } (mm, 0.1 mm steps). `keep` (re-measure): the
 * product's current spec, whose kind and material stay when not sent. Throws HttpError (400).
 */
function cleanMeasurements(body, HttpError, keep = null) {
  const b = isObj(body) ? body : {};
  const bad = (field, key = 'drinkwareField', extra = {}) => new HttpError(400, key, { field, label: LABELS[field] || L(field, field), ...extra });
  const num = (v, field) => {
    // (Numbers, or digits as a form sends them; never true, arrays or objects.)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const [min, max] = RANGES[field];
    if (!Number.isFinite(n) || n < min || n > max) throw bad(field, 'drinkwareRange', { min, max });
    return round1(n);
  };
  const kind = b.kind === undefined && keep ? keep.kind : b.kind;
  if (!drinkwareMod.KINDS.includes(kind)) throw bad('kind');
  const material = b.material === undefined && keep ? keep.material : b.material;
  if (!drinkwareMod.MATERIALS.includes(material)) throw bad('material');
  if (!isObj(b.typed)) throw bad('typed');
  const unknownTyped = Object.keys(b.typed).find((k) => !TYPED_FIELDS.includes(k));
  if (unknownTyped) throw new HttpError(400, 'badProductField', { field: `typed.${unknownTyped}`.slice(0, 60) });
  const typed = {};
  for (const k of TYPED_FIELDS) typed[k] = num(b.typed[k], k);
  // A cone steeper than this is not a cup we can wrap (spec F: |D1−D2| / h ≤ 0.5).
  if (Math.abs(typed.topDiaMm - typed.bottomDiaMm) / typed.heightMm > LIM.taper) throw bad('bottomDiaMm', 'drinkwareTaper');
  if (typed.printTopMm + typed.printHeightMm > typed.heightMm) throw bad('printHeightMm', 'drinkwareBand');
  const gapMm = b.gapMm === undefined || b.gapMm === null ? DEFAULTS.gapMm : num(b.gapMm, 'gapMm');
  const safeMm = b.safeMm === undefined || b.safeMm === null ? DEFAULTS.safeMm : num(b.safeMm, 'safeMm');
  let handle = null;
  if (b.handle !== undefined && b.handle !== null && b.handle !== false) {
    if (!isObj(b.handle)) throw bad('handle');
    const unknownH = Object.keys(b.handle).find((k) => !HANDLE_FIELDS.includes(k));
    if (unknownH) throw new HttpError(400, 'badProductField', { field: `handle.${unknownH}`.slice(0, 60) });
    handle = {};
    for (const k of HANDLE_FIELDS) handle[k] = num(b.handle[k], k);
    if (handle.y1Mm - handle.y0Mm < MIN_HANDLE_MM || handle.y1Mm > typed.heightMm) throw bad('y1Mm', 'drinkwareHandle');
  }
  return { kind, material, typed, handle, gapMm, safeMm };
}

/** A price as the owner types it: a number from 1 (accounting.cleanPricing's floor) up; null when not sent. */
function cleanPrice(v, HttpError) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > MAX_PRICE) throw new HttpError(400, 'badPrice', { field: 'price' });
  return Math.round(n * 100) / 100;
}

/** drinkware.buildSpec, its errors as HttpErrors (it throws an Error with an i18n `key` and `field`). */
function build(drinkware, input, HttpError) {
  try {
    return drinkware.buildSpec(input);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const field = String((e && e.field) || '');
    const short = field.split('.').pop();
    throw new HttpError(400, (e && e.key) || 'drinkwareInvalid', { ...((e && e.params) || {}), field, ...(LABELS[short] ? { label: LABELS[short] } : {}) });
  }
}

/** A catalogue answer { error, field } as an HttpError (names: the bilingual label). */
function catalogError(r, HttpError) {
  if (r.error === 'badProductField' && r.field === 'name') return new HttpError(400, 'drinkwareField', { field: 'name', label: LABELS.name });
  return new HttpError(r.error === 'photoProductGeometry' ? 409 : 400, r.error, { field: r.field || (r.error === 'badProductId' || r.error === 'productIdTaken' ? 'id' : '') });
}

// ---------- Slice 2: the photo session (db.productShoots[sid], files in DATA_DIR/product-shoots/<sid>/) ----------
const VIEWS = ['front', 'side', 'back', 'top', 'bottom', 'threeq', 'print', 'surface'];
const VIEW_LABELS = {
  front: L('front', 'الأمام'), side: L('side', 'الجنب'), back: L('back', 'الضهر'), top: L('top', 'من فوق'),
  bottom: L('bottom', 'من تحت'), threeq: L('three-quarter', 'الزاوية'), print: L('print area', 'منطقة الطباعة'),
  surface: L('surface close-up', 'السطح من قريب'),
};
Object.assign(LABELS, {
  cardScale: L('Ruler check', 'مقاس المسطرة'), measured: L('Photo measurements', 'المقاسات من الصورة'),
  profile: L('Measured outline', 'الشكل المتقاس'), card: L('Card', 'الكارت'), front: L('Front photo scale', 'مقياس صورة الأمام'),
  pxPerMm: L('Scale', 'المقياس'), axisXpx: L('Centre line', 'خط النص'), rimYpx: L('Rim', 'الحافة'), baseYpx: L('Base', 'القاعدة'),
  bandLinearityMm: L('Body straightness', 'استقامة الجسم'), leanDeg: L('Lean', 'الميل'), rev: L('Session version', 'نسخة الجلسة'),
});
const SHOOT = {
  maxBytes: 40 * 1024 * 1024, // per session, all its files
  maxOpen: 30, // sessions without a product
  staleDays: 60, // a session without a product, untouched this long, is removed when the list is read
  shotBytes: 12 * 1024 * 1024,
  inputPixels: 40e6,
  shotPx: 3000, // the stored photo's longest side (JPEG, EXIF / GPS stripped)
  minPx: 300,
  thumbPx: 800,
  assetBytes: 4 * 1024 * 1024,
  frontMaxW: 1000,
  frontMaxH: 2000,
  maskCoverage: [0.03, 0.7],
  catalogPhotoPx: 1600, // as POST /api/admin/catalog/:id/photos
};
const SID_RE = /^[a-f0-9]{12}$/;
const PID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/; // (catalog.js ID_RE)
const ASSETS = ['front.webp', 'front-mask.png'];
// Every file a session can hold: <view>.jpg, <view>-thumb.webp, <view>-cutout.png, and the browser's straightened front.
const FILE_RE = new RegExp(`^(?:(?:${VIEWS.join('|')})(?:\\.jpg|-thumb\\.webp|-cutout\\.png)|front\\.webp|front-mask\\.png)$`);
// The public copies of a photo product's front (DATA_DIR/catalog-shots/<productId>/): what the shop's previews read.
const PUBLIC_SHOT_RE = /^(?:front\.webp|front-mask\.png|front-shade\.webp)$/;
const TYPE_OF = { '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };
const SHOOT_FIELDS = new Set(['cardScale', 'typed', 'shots', 'measured', 'material', 'kind', 'handle']);
const SHOOT_TYPED = new Set([...TYPED_FIELDS, 'gapMm', 'safeMm', 'handle']);
const CARD_METHODS = ['auto', 'tap'];
const PRODUCT_FIELDS = new Set(['id', 'name', 'price', 'rev']);

/** A finite number in [min, max] (digits as a form sends them allowed), or undefined. */
const numOr = (v, min, max) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const r2n = (n) => Math.round(n * 100) / 100;
const r4n = (n) => Math.round(n * 10000) / 10000;

/**
 * The owner's nudges from the overlay check ({ photo: { axisXpx, rimYpx, pxPerMm } }, each optional) for a product made
 * from photos: the scale within ±10 % of the measured one, the lines inside the front photo. null when none were sent.
 */
function cleanNudges(body, spec, HttpError) {
  const b = isObj(body) ? body : {};
  const unknown = Object.keys(b).find((k) => k !== 'photo');
  if (unknown) throw new HttpError(400, 'badProductField', { field: unknown.slice(0, 60) });
  if (b.photo === undefined || b.photo === null) return null;
  const ph = spec && isObj(spec.photo) && isObj(spec.photo.front) ? spec.photo : null;
  if (!ph) throw new HttpError(409, 'photoProductNoPhoto', { field: 'photo' });
  if (!isObj(b.photo)) throw new HttpError(400, 'photoNudgeBad', { field: 'photo' });
  const k = Object.keys(b.photo).find((x) => !['axisXpx', 'rimYpx', 'pxPerMm'].includes(x));
  if (k) throw new HttpError(400, 'badProductField', { field: `photo.${k}`.slice(0, 60) });
  const orig = isObj(ph.original) ? ph.original : ph.front;
  const { w, h } = ph.front;
  const out = {};
  const take = (key, min, max, round) => {
    if (b.photo[key] === undefined || b.photo[key] === null) return;
    const n = numOr(b.photo[key], min, max);
    if (n === undefined) throw new HttpError(400, 'photoNudgeBad', { field: `photo.${key}` });
    out[key] = round(n);
  };
  take('pxPerMm', orig.pxPerMm * 0.9, orig.pxPerMm * 1.1, r4n);
  take('axisXpx', 0, w, r2n);
  take('rimYpx', 0, h, r2n);
  return Object.keys(out).length ? out : null;
}

/**
 * deps: { store, guard (the admin gate: requireCatalog), HttpError, catalog (src/catalog.js), getProduct, PRODUCTS,
 * syncCatalog, logCatalog(db, req, productId, what), adminProduct(p), saveProductEdit(req, product, body) (the owner's
 * price), approvalsAll? () -> approvals (a code already waiting is refused at once), drinkware?, fanFiles?
 * (src/drinkware.js, src/fan-files.js; the real ones when not given) }.
 * Gives { approvalChecks } for app.js APPROVAL_CHECKS.
 */
function mount(app, deps) {
  const { store, guard, HttpError, catalog, getProduct, PRODUCTS, syncCatalog, logCatalog, adminProduct, saveProductEdit } = deps;
  const approvalsAll = deps.approvalsAll || (() => []);
  const drinkware = deps.drinkware || drinkwareMod;
  let fanFilesMod = deps.fanFiles || null;
  const fanFiles = () => (fanFilesMod ||= require('./fan-files')); // (loaded on the first download)
  const edits = () => (store.db.catalog && store.db.catalog.products) || {};
  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const bodyOf = (req) => (isObj(req.body) ? req.body : {});
  const refuseUnknown = (b, allowed) => {
    const k = Object.keys(b).find((x) => !allowed.has(x));
    if (k) throw new HttpError(400, 'badProductField', { field: k.slice(0, 60) });
  };

  /** A product made from measurements (404 / 409 otherwise). */
  const drinkProduct = (id) => {
    const p = getProduct(String(id));
    if (!p) throw new HttpError(404, 'unknownProduct');
    const e = edits()[p.id];
    if (!e || !isObj(e.drinkware)) throw new HttpError(409, 'notDrinkware');
    return { p, e, spec: e.drinkware };
  };

  // Everything a new product from measurements is checked for, before it waits or is made.
  const checkNew = (req) => {
    const b = bodyOf(req);
    refuseUnknown(b, NEW_FIELDS);
    const input = cleanMeasurements(b, HttpError);
    // (Names are required here: a plain clone may start as "<template> (new)", this one may not.)
    const name = isObj(b.name) ? { en: text(b.name.en, 80), ar: text(b.name.ar, 80) } : null;
    const n = catalog.cleanNew({ id: b.id, template: templateOf(input.handle), name: b.name }, PRODUCTS);
    if (n.error) throw catalogError(n, HttpError);
    if (!name || !name.en || !name.ar) throw new HttpError(400, 'drinkwareField', { field: 'name', label: LABELS.name });
    const price = cleanPrice(b.price, HttpError);
    const spec = build(drinkware, input, HttpError);
    return { input, id: n.id, name, price, spec };
  };
  const checkRemeasure = (req) => {
    const { p, e } = drinkProduct(req.params.id);
    const b = bodyOf(req);
    refuseUnknown(b, MEASURE_FIELDS);
    const input = cleanMeasurements(b, HttpError, e.drinkware);
    // Made from `mug` or `tumbler`: a handle can't come or go (a new product instead).
    if (templateOf(input.handle) !== (e.template || p.base)) throw new HttpError(409, 'drinkwareTemplate', { field: 'handle' });
    const spec = build(drinkware, input, HttpError);
    return { p, input, spec };
  };
  const asApplied = (input) => ({ kind: input.kind, material: input.material, typed: input.typed, handle: input.handle, gapMm: input.gapMm, safeMm: input.safeMm });

  app.post('/api/admin/photo-products/from-measurements', guard, express.json({ limit: '16kb' }), (req, res) => {
    const c = checkNew(req);
    const w = req.adminWho;
    let id = null;
    store.mutate((db) => {
      db.catalog ||= {};
      db.catalog.products ||= {};
      const r = catalog.newFromDrinkware({ id: c.id, name: c.name, spec: c.spec, createdBy: w.name }, PRODUCTS);
      if (r.error) throw catalogError(r, HttpError);
      if (db.catalog.products[r.id]) throw new HttpError(400, 'productIdTaken', { field: 'id' });
      db.catalog.products[r.id] = r.edit;
      id = r.id;
      logCatalog(db, req, r.id, `new product from measurements (${c.input.kind}, from ${r.template})`);
    });
    syncCatalog();
    // The selling price is the owner's: a team member's product starts at the template's prices (as POST /api/admin/catalog).
    let warning = null;
    if (w.role === 'owner' && c.price !== null) {
      try {
        saveProductEdit(req, getProduct(id), { prices: { basePrice: c.price } });
      } catch (e) {
        warning = (e && e.key) || 'badPrice'; // the product stays (hidden); the price is set on its page
      }
    }
    res.status(201).json({ product: adminProduct(getProduct(id)), ...(warning ? { warning } : {}) });
  });

  app.put('/api/admin/catalog/:id/drinkware', guard, express.json({ limit: '16kb' }), (req, res) => {
    const c = checkRemeasure(req);
    let paused = false;
    store.mutate((db) => {
      const prev = db.catalog && db.catalog.products && db.catalog.products[c.p.id];
      if (!prev || !isObj(prev.drinkware)) throw new HttpError(409, 'notDrinkware');
      const next = catalog.remeasure(prev, c.spec);
      if (next.error) throw catalogError(next, HttpError);
      paused = (prev.status || 'live') !== next.status && next.status === 'hidden';
      next.updatedAt = new Date().toISOString();
      next.updatedBy = req.adminWho.name;
      db.catalog.products[c.p.id] = next;
      logCatalog(db, req, c.p.id, `measurements changed${paused ? ', paused until checked' : ''}`);
    });
    syncCatalog();
    res.json({ product: adminProduct(getProduct(c.p.id)), ...(paused ? { paused: true } : {}) });
  });

  // Owners only (src/roles.js: a route not listed there is the owners').
  // A product made from photos: the owner's overlay-check nudges { photo: { axisXpx, rimYpx, pxPerMm } } come with it.
  app.post('/api/admin/catalog/:id/drinkware/check', guard, express.json({ limit: '2kb' }), (req, res) => {
    const { p, spec } = drinkProduct(req.params.id);
    const front = cleanNudges(req.body, spec, HttpError);
    store.mutate((db) => {
      const prev = db.catalog && db.catalog.products && db.catalog.products[p.id];
      const next = catalog.markChecked(prev, req.adminWho.shown || req.adminWho.name, front);
      if (next.error) throw new HttpError(409, 'notDrinkware');
      db.catalog.products[p.id] = next;
      logCatalog(db, req, p.id, `dimensions checked${front ? ' (drawing lined up on the photo)' : ''}`);
    });
    syncCatalog();
    res.json({ product: adminProduct(getProduct(p.id)) });
  });

  // The blank true-size template and the workshop's spec sheet, made from the numbers only.
  const sendFile = (res, buf, type, name) => {
    res.set('Content-Type', type);
    res.set('Content-Disposition', `attachment; filename="${name.replace(/[^a-z0-9.-]/g, '-')}"`);
    res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8'));
  };
  const optsOf = (p, spec) => ({ title: (p.name && p.name.en) || p.id, slug: p.id, spec });
  app.get('/api/admin/catalog/:id/template.svg', guard, asyncRoute(async (req, res) => {
    const { p, spec } = drinkProduct(req.params.id);
    sendFile(res, await fanFiles().templateSvg(drinkware.fanFor(spec), optsOf(p, spec)), 'image/svg+xml; charset=utf-8', `${p.id}-template.svg`);
  }));
  app.get('/api/admin/catalog/:id/template.pdf', guard, asyncRoute(async (req, res) => {
    const { p, spec } = drinkProduct(req.params.id);
    sendFile(res, await fanFiles().templatePdf(drinkware.fanFor(spec), optsOf(p, spec)), 'application/pdf', `${p.id}-template.pdf`);
  }));
  app.get('/api/admin/catalog/:id/spec.pdf', guard, asyncRoute(async (req, res) => {
    const { p, spec } = drinkProduct(req.params.id);
    sendFile(res, await fanFiles().specSheetPdf(p, spec), 'application/pdf', `${p.id}-spec.pdf`);
  }));

  // ======================= Slice 2: a new product from photos (the photo session) =======================
  const dataDir = deps.dataDir;
  const sharp = () => (deps.sharp ? deps.sharp() : require('sharp')); // (app.js's lazy loader: sharp is big)
  const bgremove = () => deps.bgremove || require('./bgremove');
  const photoDir = deps.photoDir || ((pid) => path.join(dataDir, 'catalog-photos', pid));
  const shootsRoot = () => path.join(dataDir, 'product-shoots');
  // (Only ever called with a checked sid / product id.)
  const shootDir = (sid) => path.join(shootsRoot(), sid);
  const shotsDir = (pid) => path.join(dataDir, 'catalog-shots', pid);
  const shoots = () => store.db.productShoots || {};
  const pending = (a) => a && (a.status === 'pending' || a.status === 'failed' || a.status === 'applying');
  const PRODUCT_ACTION = 'POST /api/admin/photo-products/:sid/product';
  const shootOfApproval = (a) => (/^\/api\/admin\/photo-products\/([a-f0-9]{12})\/product(?:[?#]|$)/.exec(String((a && a.path) || '')) || [])[1] || null;
  const now = () => new Date().toISOString();
  const rand = (n) => crypto.randomBytes(n).toString('hex');
  const rawBody = (limit) => express.raw({ type: () => true, limit });

  const sidOf = (req) => {
    if (!SID_RE.test(String(req.params.sid || ''))) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
    return req.params.sid;
  };
  const viewOf = (req) => {
    if (!VIEWS.includes(req.params.view)) throw new HttpError(404, 'notFound');
    return req.params.view;
  };
  const shootOf = (sid) => {
    const s = shoots()[sid];
    if (!isObj(s)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
    return s;
  };
  /** A session that can still change (no product made from it yet). */
  const openShoot = (sid) => {
    const s = shootOf(sid);
    if (s.status === 'product') throw new HttpError(409, 'photoShootDone');
    return s;
  };
  const typedComplete = (t) => isObj(t) && TYPED_FIELDS.every((k) => typeof t[k] === 'number');
  const statusOf = (s) => (s.status === 'product' ? 'product' : typedComplete(s.typed) && isObj(s.measured) ? 'measured' : 'shooting');
  /** Every file a session record names, with its size: { name: bytes }. */
  const filesOf = (s) => {
    const out = {};
    for (const [v, x] of Object.entries(s.shots || {})) if (isObj(x)) { out[`${v}.jpg`] = x.bytes || 0; out[`${v}-thumb.webp`] = x.thumbBytes || 0; }
    for (const [v, x] of Object.entries(s.cutouts || {})) if (isObj(x)) out[`${v}-cutout.png`] = x.bytes || 0;
    for (const [n, x] of Object.entries(s.assets || {})) if (isObj(x)) out[n] = x.bytes || 0;
    return out;
  };
  const bytesOf = (s, without = []) => Object.entries(filesOf(s)).reduce((t, [n, b]) => (without.includes(n) ? t : t + b), 0);
  const fitsOrThrow = (s, without, extra) => {
    if (bytesOf(s, without) + extra > SHOOT.maxBytes) throw new HttpError(413, 'photoShootFull', { max: Math.round(SHOOT.maxBytes / 1048576) });
  };
  /** The session as the dashboard sees it: the record, its files' addresses (admins only) and its size. */
  const shootView = (s) => ({
    ...s,
    bytes: bytesOf(s),
    maxBytes: SHOOT.maxBytes,
    files: Object.keys(filesOf(s)).map((name) => ({ name, url: `/api/admin/photo-products/${s.id}/files/${name}` })),
  });
  const shootRow = (s) => ({
    id: s.id, kind: s.kind, handle: s.handle, status: s.status, productId: s.productId || null,
    createdAt: s.createdAt, createdBy: s.createdBy, updatedAt: s.updatedAt, rev: s.rev,
    shots: VIEWS.filter((v) => s.shots && isObj(s.shots[v])),
    thumb: s.shots && isObj(s.shots.front) ? `/api/admin/photo-products/${s.id}/files/front-thumb.webp` : null,
  });
  const touch = (s, req) => {
    s.rev = (s.rev || 0) + 1;
    s.updatedAt = now();
    s.updatedBy = req.adminWho.shown || req.adminWho.name;
    s.status = statusOf(s);
  };
  /** Write next to the final name, renamed into place later (inside store.mutate). */
  const writeTmp = (dir, name, buf) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${name}.${rand(4)}.tmp`);
    fs.writeFileSync(tmp, buf);
    return tmp;
  };
  const rmQuiet = (f) => { try { fs.rmSync(f, { force: true, recursive: true }); } catch (e) { /* gone */ } };

  /** Sessions without a product, untouched for 60 days (and not waiting for an owner), are removed. */
  const prune = () => {
    const cut = Date.now() - SHOOT.staleDays * 864e5;
    const waiting = new Set(approvalsAll().filter((a) => pending(a) && a.action === PRODUCT_ACTION).map(shootOfApproval).filter(Boolean));
    const stale = Object.values(shoots()).filter((s) => isObj(s) && s.status !== 'product' && !waiting.has(s.id) && Date.parse(s.updatedAt || s.createdAt || 0) < cut).map((s) => s.id);
    if (!stale.length) return;
    store.mutate((db) => { for (const id of stale) if (db.productShoots && db.productShoots[id] && db.productShoots[id].status !== 'product') delete db.productShoots[id]; });
    for (const id of stale) if (SID_RE.test(id)) rmQuiet(shootDir(id));
  };

  // ---- The calibration card (src/calibration-card.js, loaded on the first download and kept) ----
  let cardPdfBuf = null;
  app.get('/api/admin/photo-products/card.pdf', guard, asyncRoute(async (req, res) => {
    if (!cardPdfBuf) {
      let mod = deps.calibrationCard || null;
      if (!mod) {
        try {
          mod = require('./calibration-card');
        } catch (e) {
          if (e && e.code === 'MODULE_NOT_FOUND' && /calibration-card/.test(String(e.message))) throw new HttpError(503, 'photoCardMissing');
          throw e;
        }
      }
      if (!mod || typeof mod.cardPdf !== 'function') throw new HttpError(503, 'photoCardMissing');
      const buf = await mod.cardPdf();
      if (!Buffer.isBuffer(buf) || buf.length < 8) throw new HttpError(503, 'photoCardMissing');
      cardPdfBuf = buf;
    }
    sendFile(res, cardPdfBuf, 'application/pdf', 'ebda3-calibration-card.pdf');
  }));

  // ---- List, one session, start ----
  app.get('/api/admin/photo-products', guard, (req, res) => {
    prune();
    const list = Object.values(shoots()).filter(isObj).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ shoots: list.map(shootRow), maxOpen: SHOOT.maxOpen });
  });
  app.get('/api/admin/photo-products/:sid', guard, (req, res) => {
    res.json({ shoot: shootView(shootOf(sidOf(req))) });
  });
  app.post('/api/admin/photo-products', guard, express.json({ limit: '1kb' }), (req, res) => {
    const b = bodyOf(req);
    refuseUnknown(b, new Set(['kind', 'handle']));
    if (!drinkware.KINDS.includes(b.kind)) throw new HttpError(400, 'drinkwareField', { field: 'kind', label: LABELS.kind });
    if (typeof b.handle !== 'boolean') throw new HttpError(400, 'drinkwareField', { field: 'handle', label: LABELS.handle });
    prune();
    const w = req.adminWho;
    const s = {
      id: rand(6), createdAt: now(), createdBy: w.shown || w.name, updatedAt: now(), rev: 1,
      kind: b.kind, handle: b.handle, template: templateOf(b.handle), status: 'shooting', productId: null,
      cardScale: 1, typed: {}, shots: {}, cutouts: {}, assets: {}, measured: null, diffs: null, warnings: [],
      material: b.kind === 'tumbler' ? 'metal' : 'gloss',
    };
    store.mutate((db) => {
      db.productShoots ||= {};
      const open = Object.values(db.productShoots).filter((x) => isObj(x) && x.status !== 'product').length;
      if (open >= SHOOT.maxOpen) throw new HttpError(429, 'photoShootsTooMany', { max: SHOOT.maxOpen });
      while (db.productShoots[s.id]) s.id = rand(6);
      db.productShoots[s.id] = s;
    });
    res.status(201).json({ shoot: shootView(s) });
  });

  // ---- Save a step: typed numbers, card data, photo measurements, material (all checked here) ----
  const fieldErr = (field, key = 'drinkwareField', extra = {}) => {
    const short = String(field).split('.').pop();
    return new HttpError(400, key, { field, label: LABELS[short] || VIEW_LABELS[short] || L(short, short), ...extra });
  };
  /** A number in range, rounded to 0.1 mm (null / '' = not filled in: undefined). */
  const optNum = (v, field, [min, max], round = round1) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = numOr(v, min, max);
    if (n === undefined) throw fieldErr(field, 'drinkwareRange', { min, max });
    return round(n);
  };
  const cleanHandle = (v, field, heightMm) => {
    if (v === undefined || v === null || v === false) return null;
    if (!isObj(v)) throw fieldErr(field);
    const unknown = Object.keys(v).find((k) => !HANDLE_FIELDS.includes(k));
    if (unknown) throw new HttpError(400, 'badProductField', { field: `${field}.${unknown}`.slice(0, 60) });
    const h = {};
    for (const k of HANDLE_FIELDS) {
      h[k] = optNum(v[k], `${field}.${k}`, RANGES[k]);
      if (h[k] === undefined) throw fieldErr(`${field}.${k}`, 'drinkwareRange', { min: RANGES[k][0], max: RANGES[k][1] });
    }
    if (h.y1Mm - h.y0Mm < MIN_HANDLE_MM || (heightMm !== undefined && h.y1Mm > heightMm)) throw fieldErr(`${field}.y1Mm`, 'drinkwareHandle');
    return h;
  };
  /** Typed numbers as the owner fills them in: any of them may still be empty; what's there is checked. */
  const cleanTyped = (v, withHandle) => {
    if (!isObj(v)) throw fieldErr('typed');
    const unknown = Object.keys(v).find((k) => !SHOOT_TYPED.has(k));
    if (unknown) throw new HttpError(400, 'badProductField', { field: `typed.${unknown}`.slice(0, 60) });
    const t = {};
    for (const k of [...TYPED_FIELDS, 'gapMm', 'safeMm']) {
      const n = optNum(v[k], `typed.${k}`, RANGES[k]);
      if (n !== undefined) t[k] = n;
    }
    if (t.heightMm !== undefined && t.topDiaMm !== undefined && t.bottomDiaMm !== undefined
      && Math.abs(t.topDiaMm - t.bottomDiaMm) / t.heightMm > LIM.taper) throw fieldErr('typed.bottomDiaMm', 'drinkwareTaper');
    if (t.heightMm !== undefined && (t.printTopMm || 0) + (t.printHeightMm || 0) > t.heightMm) throw fieldErr('typed.printHeightMm', 'drinkwareBand');
    const h = cleanHandle(v.handle, 'typed.handle', t.heightMm);
    if (h && !withHandle) throw new HttpError(400, 'badProductField', { field: 'typed.handle' });
    if (h) t.handle = h;
    return t;
  };
  const finiteList = (v, n, lim) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim);
  /** The card found on one photo (calib-detect's answer): only what is needed is kept; corners inside the photo. */
  const cleanCard = (v, view, shot) => {
    if (v === null) return null;
    if (!isObj(v)) throw fieldErr(`shots.${view}.card`);
    const f = (k) => `shots.${view}.card.${k}`;
    const c = Array.isArray(v.corners) && v.corners.length === 4 && v.corners.every((p) => finiteList(p, 2, 1e6)) ? v.corners : null;
    if (!c) throw fieldErr(f('corners'));
    if (!c.every(([x, y]) => x >= 0 && y >= 0 && x <= shot.w && y <= shot.h)) throw new HttpError(400, 'photoCardOutside', { field: f('corners'), label: VIEW_LABELS[view] });
    const out = { corners: c.map(([x, y]) => [r2n(x), r2n(y)]) };
    out.method = v.method === undefined ? 'auto' : v.method;
    if (!CARD_METHODS.includes(out.method)) throw fieldErr(f('method'));
    const need = { pxPerMm: [0.2, 100], rmsPx: [0, 100], tiltDeg: [0, 90] };
    for (const [k, [min, max]] of Object.entries(need)) {
      if (v[k] === undefined || v[k] === null) { if (k === 'pxPerMm') throw fieldErr(f(k)); continue; }
      const n = numOr(v[k], min, max);
      if (n === undefined) throw fieldErr(f(k), 'drinkwareRange', { min, max });
      out[k] = r4n(n);
    }
    if (v.wb !== undefined && v.wb !== null) {
      if (!finiteList(v.wb, 3, 1000) || v.wb.some((x) => x <= 0)) throw fieldErr(f('wb'));
      out.wb = v.wb.map(r4n);
    }
    for (const k of ['H', 'Hinv']) {
      if (v[k] === undefined || v[k] === null) continue;
      if (!finiteList(v[k], 9, 1e9)) throw fieldErr(f(k));
      out[k] = v[k].slice();
    }
    if (v.lowAccuracy === true) out.lowAccuracy = true;
    // (Anything else the detector answered — ok, reason, gates — is not kept.)
    return out;
  };
  const cleanProfile = (v, heightMm) => {
    if (v === undefined || v === null) return undefined;
    const ok = Array.isArray(v) && v.length >= 2 && v.length <= drinkware.MAX_PROFILE && v.every((p) => finiteList(p, 2, 1e4));
    if (!ok) throw new HttpError(400, 'photoProfileBad', { field: 'measured.profile' });
    for (let i = 0; i < v.length; i++) {
      const [y, r] = v[i];
      if (y < 0 || y > heightMm * 1.05 + 1 || !(r > 0) || r > LIM.diaMm[1] / 2 || (i && !(y > v[i - 1][0]))) throw new HttpError(400, 'photoProfileBad', { field: 'measured.profile' });
    }
    return v.map(([y, r]) => [round1(y), r2n(r)]);
  };
  /** Where the straightened front photo (front.webp) has the axis, rim and base, and its scale; inside the picture. */
  const cleanFront = (v, s) => {
    if (v === undefined || v === null) return undefined;
    if (!isObj(v)) throw fieldErr('measured.front');
    const unknown = Object.keys(v).find((k) => !['pxPerMm', 'axisXpx', 'rimYpx', 'baseYpx'].includes(k));
    if (unknown) throw new HttpError(400, 'badProductField', { field: `measured.front.${unknown}`.slice(0, 60) });
    const out = {};
    for (const [k, min, max, req] of [['pxPerMm', 0.2, 50, true], ['axisXpx', 0, SHOOT.frontMaxW, true], ['rimYpx', 0, SHOOT.frontMaxH, true], ['baseYpx', 0, SHOOT.frontMaxH, false]]) {
      if (v[k] === undefined || v[k] === null) { if (req) throw fieldErr(`measured.front.${k}`); continue; }
      const n = numOr(v[k], min, max);
      if (n === undefined) throw fieldErr(`measured.front.${k}`, 'drinkwareRange', { min, max });
      out[k] = k === 'pxPerMm' ? r4n(n) : r2n(n);
    }
    if (out.baseYpx !== undefined && !(out.baseYpx > out.rimYpx)) throw fieldErr('measured.front.baseYpx');
    const a = s.assets && s.assets['front.webp'];
    if (a && (out.axisXpx > a.w || out.rimYpx > a.h || (out.baseYpx || 0) > a.h)) throw fieldErr('measured.front.axisXpx', 'photoNudgeBad');
    return out;
  };
  const cleanMeasured = (v, s) => {
    if (v === null) return null;
    if (!isObj(v)) throw fieldErr('measured');
    const allowed = new Set(['heightMm', 'topDiaMm', 'bottomDiaMm', 'profile', 'handle', 'bandLinearityMm', 'leanDeg', 'front']);
    const unknown = Object.keys(v).find((k) => !allowed.has(k));
    if (unknown) throw new HttpError(400, 'badProductField', { field: `measured.${unknown}`.slice(0, 60) });
    const m = {};
    for (const k of ['heightMm', 'topDiaMm', 'bottomDiaMm']) {
      m[k] = optNum(v[k], `measured.${k}`, RANGES[k]);
      if (m[k] === undefined) throw fieldErr(`measured.${k}`, 'drinkwareRange', { min: RANGES[k][0], max: RANGES[k][1] });
    }
    const profile = cleanProfile(v.profile, m.heightMm);
    if (profile) m.profile = profile;
    m.handle = cleanHandle(v.handle, 'measured.handle', m.heightMm * 1.05 + 1);
    const lin = optNum(v.bandLinearityMm, 'measured.bandLinearityMm', [0, 50], r2n);
    if (lin !== undefined) m.bandLinearityMm = lin;
    const lean = optNum(v.leanDeg, 'measured.leanDeg', [-45, 45], r2n);
    if (lean !== undefined) m.leanDeg = lean;
    const front = cleanFront(v.front, s);
    if (front) m.front = front;
    return m;
  };
  /** A PUT body checked against the session as it is: { field: clean value } (nothing changed yet). */
  const cleanShootPut = (b, s) => {
    refuseUnknown(b, SHOOT_FIELDS);
    const out = {};
    if (b.kind !== undefined) {
      if (!drinkware.KINDS.includes(b.kind)) throw fieldErr('kind');
      out.kind = b.kind;
    }
    if (b.handle !== undefined) {
      if (typeof b.handle !== 'boolean') throw fieldErr('handle');
      out.handle = b.handle;
    }
    const withHandle = out.handle !== undefined ? out.handle : s.handle;
    if (b.material !== undefined) {
      if (!drinkware.MATERIALS.includes(b.material)) throw fieldErr('material');
      out.material = b.material;
    }
    if (b.cardScale !== undefined) {
      const n = numOr(b.cardScale, 0.85, 1.15);
      if (n === undefined) throw fieldErr('cardScale', 'drinkwareRange', { min: 0.85, max: 1.15 });
      out.cardScale = r4n(n);
    }
    if (b.typed !== undefined) out.typed = cleanTyped(b.typed, withHandle);
    else if (out.handle === false && s.typed && s.typed.handle) out.typed = { ...s.typed, handle: undefined };
    if (b.shots !== undefined) {
      if (!isObj(b.shots)) throw fieldErr('shots');
      out.shots = {};
      for (const [view, x] of Object.entries(b.shots)) {
        if (!VIEWS.includes(view)) throw new HttpError(400, 'badProductField', { field: `shots.${view}`.slice(0, 60) });
        if (!isObj(x) || Object.keys(x).some((k) => k !== 'card')) throw new HttpError(400, 'badProductField', { field: `shots.${view}` });
        const shot = s.shots && s.shots[view];
        if (!isObj(shot)) throw new HttpError(409, 'photoShotMissing', { field: `shots.${view}`, label: VIEW_LABELS[view] });
        if (x.card !== undefined) out.shots[view] = cleanCard(x.card, view, shot);
      }
    }
    if (b.measured !== undefined) out.measured = cleanMeasured(b.measured, s);
    return out;
  };
  app.put('/api/admin/photo-products/:sid', guard, express.json({ limit: '64kb' }), (req, res) => {
    const sid = sidOf(req);
    const b = bodyOf(req);
    const c = cleanShootPut(b, openShoot(sid));
    const s = store.mutate((db) => {
      const x = db.productShoots && db.productShoots[sid];
      if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
      if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
      // (Checked again on the latest data: a photo taken again meanwhile has another size.)
      const again = cleanShootPut(b, x);
      for (const k of ['kind', 'handle', 'material', 'cardScale', 'measured']) if (again[k] !== undefined) x[k] = again[k];
      if (again.typed !== undefined) x.typed = JSON.parse(JSON.stringify(again.typed));
      if (again.handle !== undefined) x.template = templateOf(again.handle);
      for (const [view, card] of Object.entries(again.shots || {})) x.shots[view].card = card;
      x.diffs = null;
      x.warnings = [];
      touch(x, req);
      return x;
    });
    void c;
    res.json({ shoot: shootView(s) });
  });

  // ---- One photo of the shot list: decoded, turned upright, re-encoded (no EXIF / GPS), ≤ 3000 px ----
  const decodeCheck = async (buf, key, formats = ['jpeg', 'png', 'webp']) => {
    if (!Buffer.isBuffer(buf) || buf.length < 100) throw new HttpError(400, key);
    try {
      const meta = await sharp()(buf, { limitInputPixels: SHOOT.inputPixels }).metadata();
      if (!formats.includes(meta.format)) throw new Error('type');
      return meta;
    } catch (e) {
      throw new HttpError(400, key);
    }
  };
  app.post('/api/admin/photo-products/:sid/shots/:view', guard, rawBody(SHOOT.shotBytes), asyncRoute(async (req, res) => {
    const sid = sidOf(req);
    const view = viewOf(req);
    openShoot(sid);
    await decodeCheck(req.body, 'photoShotBad');
    let jpg;
    let info;
    let thumb;
    try {
      ({ data: jpg, info } = await sharp()(req.body, { limitInputPixels: SHOOT.inputPixels }).rotate()
        .resize(SHOOT.shotPx, SHOOT.shotPx, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true }));
      thumb = await sharp()(jpg).resize(SHOOT.thumbPx, SHOOT.thumbPx, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    } catch (e) {
      throw new HttpError(400, 'photoShotBad');
    }
    if (Math.min(info.width, info.height) < SHOOT.minPx) throw new HttpError(400, 'photoShotBad');
    const replaced = [`${view}.jpg`, `${view}-thumb.webp`, `${view}-cutout.png`, ...(view === 'front' ? ASSETS : [])];
    fitsOrThrow(openShoot(sid), replaced, jpg.length + thumb.length);
    const dir = shootDir(sid);
    const tmps = [[writeTmp(dir, `${view}.jpg`, jpg), `${view}.jpg`], [writeTmp(dir, `${view}-thumb.webp`, thumb), `${view}-thumb.webp`]];
    let s;
    try {
      s = store.mutate((db) => {
        const x = db.productShoots && db.productShoots[sid];
        if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
        if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
        fitsOrThrow(x, replaced, jpg.length + thumb.length);
        for (const [tmp, name] of tmps) fs.renameSync(tmp, path.join(dir, name));
        rmQuiet(path.join(dir, `${view}-cutout.png`));
        x.shots ||= {};
        x.cutouts ||= {};
        x.assets ||= {};
        x.shots[view] = { file: `${view}.jpg`, w: info.width, h: info.height, bytes: jpg.length, thumbBytes: thumb.length, at: now(), card: null };
        delete x.cutouts[view];
        // A new front photo: what was measured and straightened from the old one goes.
        if (view === 'front') {
          for (const n of ASSETS) rmQuiet(path.join(dir, n));
          x.assets = {};
          x.measured = null;
        }
        x.diffs = null;
        x.warnings = [];
        touch(x, req);
        return x;
      });
    } catch (e) {
      for (const [tmp] of tmps) rmQuiet(tmp);
      throw e;
    }
    res.status(201).json({ shoot: shootView(s), shot: s.shots[view] });
  }));

  // ---- A session's files (admins only; names from the list above, never from the request as they are) ----
  app.get('/api/admin/photo-products/:sid/files/:name', guard, (req, res) => {
    const sid = sidOf(req);
    const name = String(req.params.name || '');
    if (!FILE_RE.test(name)) throw new HttpError(404, 'notFound');
    const s = shootOf(sid);
    if (!(name in filesOf(s))) throw new HttpError(404, 'notFound');
    const file = path.join(shootDir(sid), name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'private, no-store');
    res.type(TYPE_OF[path.extname(name)]).send(fs.readFileSync(file));
  });

  // ---- The cut-out on the server (src/bgremove.js); 503 bgBusy / bgOff: the browser cuts it out itself ----
  /** A one-channel mask PNG (white = product) and how much of the picture it covers. */
  const maskOf = async (png, w, h) => {
    const S = sharp();
    const st = await S(png).stats();
    const alpha = st.channels.length === 4 || st.channels.length === 2 ? st.channels[st.channels.length - 1] : null;
    let img = S(png);
    img = alpha && alpha.min < 255 ? img.ensureAlpha().extractChannel(st.channels.length - 1) : img.flatten({ background: '#000000' }).greyscale();
    const { data, info } = await img.resize(w, h, { fit: 'fill' }).threshold(128).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    let on = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 127) on++;
    const out = await S(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer();
    return { png: out, coverage: Math.round((on / (info.width * info.height)) * 1000) / 1000 };
  };
  app.post('/api/admin/photo-products/:sid/cutout/:view', guard, asyncRoute(async (req, res) => {
    const sid = sidOf(req);
    const view = viewOf(req);
    const s0 = openShoot(sid);
    const shot = s0.shots && s0.shots[view];
    if (!isObj(shot)) throw new HttpError(409, 'photoShotMissing', { label: VIEW_LABELS[view] });
    const bg = bgremove();
    let cut;
    try {
      cut = await bg.removeBackground(fs.readFileSync(path.join(shootDir(sid), `${view}.jpg`)), { dataDir, maxPx: SHOOT.shotPx });
    } catch (e) {
      const reason = e && e.reason;
      if (!reason) throw e;
      if (reason === 'bad') throw new HttpError(400, 'photoShotBad');
      throw new HttpError(503, { off: 'bgOff', busy: 'bgBusy', loading: 'bgLoading' }[reason] || 'bgFailed');
    }
    let mask;
    try {
      mask = await maskOf(cut, shot.w, shot.h);
    } catch (e) {
      throw new HttpError(503, 'bgFailed');
    }
    const name = `${view}-cutout.png`;
    fitsOrThrow(openShoot(sid), [name], mask.png.length);
    const dir = shootDir(sid);
    const tmp = writeTmp(dir, name, mask.png);
    try {
      store.mutate((db) => {
        const x = db.productShoots && db.productShoots[sid];
        if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
        if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
        // (The photo was taken again while the cut-out ran: this one is of the old photo.)
        if (!x.shots[view] || x.shots[view].at !== shot.at) throw new HttpError(409, 'photoShootChanged');
        fitsOrThrow(x, [name], mask.png.length);
        fs.renameSync(tmp, path.join(dir, name));
        x.cutouts ||= {};
        x.cutouts[view] = { file: name, w: shot.w, h: shot.h, bytes: mask.png.length, coverage: mask.coverage, at: now() };
        touch(x, req);
      });
    } catch (e) {
      rmQuiet(tmp);
      throw e;
    }
    res.set('X-Mask-Coverage', String(mask.coverage));
    res.set('Cache-Control', 'no-store');
    res.type('image/png').send(mask.png);
  }));

  // ---- The straightened front (made in the browser) and its mask, re-encoded here ----
  app.post('/api/admin/photo-products/:sid/assets/:name', guard, rawBody(SHOOT.assetBytes), asyncRoute(async (req, res) => {
    const sid = sidOf(req);
    const name = String(req.params.name || '');
    if (!ASSETS.includes(name)) throw new HttpError(404, 'notFound');
    const s0 = openShoot(sid);
    const isMask = name === 'front-mask.png';
    const meta = await decodeCheck(req.body, isMask ? 'photoMaskBad' : 'photoAssetBad');
    let out;
    let info = {};
    if (!isMask) {
      if (!(meta.width >= 100 && meta.height >= 100 && meta.width <= SHOOT.frontMaxW && meta.height <= SHOOT.frontMaxH)) throw new HttpError(400, 'photoAssetBad');
      try {
        ({ data: out, info } = await sharp()(req.body, { limitInputPixels: SHOOT.inputPixels }).flatten({ background: '#ffffff' }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true }));
      } catch (e) {
        throw new HttpError(400, 'photoAssetBad');
      }
      info = { w: info.width, h: info.height };
    } else {
      const front = s0.assets && s0.assets['front.webp'];
      if (!front) throw new HttpError(409, 'photoShootNoAssets');
      if (meta.width !== front.w || meta.height !== front.h) throw new HttpError(400, 'photoMaskBad');
      let m;
      try {
        m = await maskOf(req.body, front.w, front.h);
      } catch (e) {
        throw new HttpError(400, 'photoMaskBad');
      }
      if (m.coverage < SHOOT.maskCoverage[0] || m.coverage > SHOOT.maskCoverage[1]) throw new HttpError(400, 'photoMaskBad');
      out = m.png;
      info = { w: front.w, h: front.h, coverage: m.coverage };
    }
    const replaced = isMask ? [name] : ASSETS;
    fitsOrThrow(openShoot(sid), replaced, out.length);
    const dir = shootDir(sid);
    const tmp = writeTmp(dir, name, out);
    let s;
    try {
      s = store.mutate((db) => {
        const x = db.productShoots && db.productShoots[sid];
        if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
        if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
        x.assets ||= {};
        if (isMask) {
          const f = x.assets['front.webp'];
          if (!f || f.w !== info.w || f.h !== info.h) throw new HttpError(409, 'photoShootChanged');
        }
        fitsOrThrow(x, replaced, out.length);
        fs.renameSync(tmp, path.join(dir, name));
        // A new straightened front: its old mask (of the old picture) goes.
        if (!isMask && x.assets['front-mask.png']) {
          rmQuiet(path.join(dir, 'front-mask.png'));
          delete x.assets['front-mask.png'];
        }
        x.assets[name] = { ...info, bytes: out.length, at: now() };
        // (Where the axis and rim were marked must still be inside the new picture.)
        if (!isMask && x.measured && x.measured.front && (x.measured.front.axisXpx > info.w || x.measured.front.rimYpx > info.h || (x.measured.front.baseYpx || 0) > info.h)) delete x.measured.front;
        x.diffs = null;
        x.warnings = [];
        touch(x, req);
        return x;
      });
    } catch (e) {
      rmQuiet(tmp);
      throw e;
    }
    res.status(201).json({ shoot: shootView(s), asset: s.assets[name] });
  }));

  // ---- Build: everything worked out again here from the stored numbers ----
  /**
   * The product a session makes, from what is stored only: the clean measurements (typed wins), the spec (with the
   * measured profile when it agrees within 2 %), the differences and the warnings. Throws HttpError when it can't.
   */
  const compose = (s) => {
    if (!typedComplete(s.typed) || !isObj(s.measured)) throw new HttpError(409, 'photoShootNotMeasured');
    const m = s.measured;
    const t = s.typed;
    let handle = null;
    if (s.handle) {
      if (isObj(t.handle)) handle = t.handle;
      else if (isObj(m.handle)) {
        // (Measured on the side photo: its heights scaled to the typed height.)
        const k = t.heightMm / m.heightMm;
        handle = { widthMm: m.handle.widthMm, y0Mm: round1(Math.min(m.handle.y0Mm * k, t.heightMm)), y1Mm: round1(Math.min(m.handle.y1Mm * k, t.heightMm)) };
      } else throw new HttpError(409, 'photoShootNoHandle');
    }
    const typed = {};
    for (const k of TYPED_FIELDS) typed[k] = t[k];
    const input = cleanMeasurements({ kind: s.kind, material: s.material, typed, handle, gapMm: t.gapMm, safeMm: t.safeMm }, HttpError);
    const spec = build(drinkware, input, HttpError);
    const diffs = drinkware.diffsOf(input.typed, m);
    const profile = !diffs.warn.length ? drinkware.profileOnTyped(input.typed, m) : null;
    if (profile) spec.profile = profile;
    const warnings = diffs.warn.map((k) => k.replace('Pct', 'Diff'));
    if (m.profile && !diffs.warn.length && !profile) warnings.push('profileFar');
    if (typeof m.bandLinearityMm === 'number' && m.bandLinearityMm > 0.5) warnings.push('curvedBody');
    const card = s.shots && s.shots.front && s.shots.front.card;
    if (!card) warnings.push('noFrontCard');
    else if (card.method === 'tap' || card.lowAccuracy) warnings.push('lowAccuracy');
    const a = s.assets || {};
    const photoOk = a['front.webp'] && a['front-mask.png'] && isObj(m.front)
      && m.front.axisXpx <= a['front.webp'].w && m.front.rimYpx <= a['front.webp'].h;
    if (!photoOk) warnings.push('noFrontPhoto');
    if (photoOk) {
      const f = a['front.webp'];
      spec.photo = { front: { w: f.w, h: f.h, pxPerMm: m.front.pxPerMm, axisXpx: m.front.axisXpx, rimYpx: m.front.rimYpx, ...(m.front.baseYpx !== undefined ? { baseYpx: m.front.baseYpx } : {}) }, files: ASSETS.slice() };
    }
    spec.shootId = s.id;
    spec.assetsVer = 1;
    const fan = drinkware.fanFor(spec);
    return {
      input, spec, diffs, warnings, photoOk, profileFrom: profile ? 'measured' : 'typed',
      fan: { template: fan.template, widthMm: r2n(fan.Wrect), heightMm: r2n(fan.Hrect), ...(fan.template === 'fan' ? { Ro: r2n(fan.Ro), Ri: r2n(fan.Ri), thetaDeg: r2n((fan.theta * 180) / Math.PI) } : {}) },
    };
  };
  app.post('/api/admin/photo-products/:sid/build', guard, (req, res) => {
    const sid = sidOf(req);
    compose(openShoot(sid)); // (refused before anything changes)
    let c;
    const s = store.mutate((db) => {
      const x = db.productShoots && db.productShoots[sid];
      if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
      if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
      c = compose(x);
      x.diffs = { heightPct: c.diffs.heightPct, topPct: c.diffs.topPct, bottomPct: c.diffs.bottomPct, warn: c.diffs.warn };
      x.warnings = c.warnings;
      touch(x, req);
      x.status = 'built';
      x.built = { at: x.updatedAt, rev: x.rev, profileFrom: c.profileFrom, fan: c.fan };
      return x;
    });
    res.json({ shoot: shootView(s), spec: c.spec, fan: c.fan, diffs: s.diffs, warnings: s.warnings });
  });

  // ---- The product (an owner approves it first): made from what the session holds when it runs ----
  const checkProduct = (req) => {
    const sid = sidOf(req);
    const b = bodyOf(req);
    refuseUnknown(b, PRODUCT_FIELDS);
    const s = openShoot(sid);
    if (s.status !== 'built') throw new HttpError(409, 'photoShootNotBuilt');
    let rev = null;
    if (b.rev !== undefined && b.rev !== null) {
      if (!Number.isInteger(b.rev) || b.rev < 1) throw fieldErr('rev');
      if (b.rev !== s.rev) throw new HttpError(409, 'photoShootChanged');
      rev = b.rev;
    }
    const c = compose(s);
    if (!c.photoOk) throw new HttpError(409, 'photoShootNoAssets');
    for (const n of ASSETS) if (!fs.existsSync(path.join(shootDir(sid), n))) throw new HttpError(409, 'photoShootNoAssets');
    const n = catalog.cleanNew({ id: b.id, template: templateOf(c.input.handle), name: b.name }, PRODUCTS);
    if (n.error) throw catalogError(n, HttpError);
    const name = isObj(b.name) ? { en: text(b.name.en, 80), ar: text(b.name.ar, 80) } : null;
    if (!name || !name.en || !name.ar) throw new HttpError(400, 'drinkwareField', { field: 'name', label: LABELS.name });
    const price = cleanPrice(b.price, HttpError);
    return { sid, s, c, id: n.id, name, price, rev: rev || s.rev };
  };
  /** The front and 3/4 photos as catalogue photos (as POST /api/admin/catalog/:id/photos stores them). */
  const catalogPhotos = async (sid, s) => {
    const out = [];
    for (const view of ['front', 'threeq']) {
      if (!isObj(s.shots && s.shots[view])) continue;
      const webp = await sharp()(fs.readFileSync(path.join(shootDir(sid), `${view}.jpg`)), { limitInputPixels: 80e6 }).rotate()
        .resize(SHOOT.catalogPhotoPx, SHOOT.catalogPhotoPx, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
      out.push({ id: rand(8), webp });
    }
    return out.slice(0, catalog.MAX_PHOTOS);
  };
  app.post('/api/admin/photo-products/:sid/product', guard, express.json({ limit: '4kb' }), asyncRoute(async (req, res) => {
    const k = checkProduct(req);
    const w = req.adminWho;
    // Files first (outside the lock), moved into place only once the product is sure to be made.
    const photos = await catalogPhotos(k.sid, k.s);
    const tmpShots = path.join(dataDir, 'catalog-shots', `.tmp-${rand(6)}`);
    fs.mkdirSync(tmpShots, { recursive: true });
    const written = [tmpShots];
    let made = null;
    try {
      for (const n of ASSETS) fs.copyFileSync(path.join(shootDir(k.sid), n), path.join(tmpShots, n));
      for (const ph of photos) {
        const f = path.join(photoDir(k.id), `${ph.id}.webp`);
        fs.mkdirSync(photoDir(k.id), { recursive: true });
        fs.writeFileSync(f, ph.webp);
        written.push(f);
      }
      store.mutate((db) => {
        const x = db.productShoots && db.productShoots[k.sid];
        if (!isObj(x)) throw new HttpError(404, 'photoShootGone', { days: SHOOT.staleDays });
        if (x.status === 'product') throw new HttpError(409, 'photoShootDone');
        if (x.status !== 'built') throw new HttpError(409, 'photoShootNotBuilt');
        if (x.rev !== k.rev) throw new HttpError(409, 'photoShootChanged');
        db.catalog ||= {};
        db.catalog.products ||= {};
        const r = catalog.newFromDrinkware({ id: k.id, name: k.name, spec: k.c.spec, createdBy: w.name }, PRODUCTS);
        if (r.error) throw catalogError(r, HttpError);
        if (db.catalog.products[r.id]) throw new HttpError(400, 'productIdTaken', { field: 'id' });
        // (An old folder under this code belongs to no product: replaced.)
        rmQuiet(shotsDir(r.id));
        fs.renameSync(tmpShots, shotsDir(r.id));
        written[0] = null;
        if (photos.length) r.edit.photos = photos.map((ph) => ({ id: ph.id }));
        db.catalog.products[r.id] = r.edit;
        x.status = 'product';
        x.productId = r.id;
        x.rev += 1;
        x.updatedAt = now();
        x.updatedBy = w.shown || w.name;
        made = r;
        logCatalog(db, req, r.id, `new product from photos (${k.c.input.kind}, from ${r.template}, session ${k.sid})`);
      });
    } catch (e) {
      for (const f of written) if (f) rmQuiet(f);
      throw e;
    }
    syncCatalog();
    let warning = null;
    if (w.role === 'owner' && k.price !== null) {
      try {
        saveProductEdit(req, getProduct(made.id), { prices: { basePrice: k.price } });
      } catch (e) {
        warning = (e && e.key) || 'badPrice';
      }
    }
    res.status(201).json({ product: adminProduct(getProduct(made.id)), shoot: shootView(shootOf(k.sid)), ...(warning ? { warning } : {}) });
  }));

  // ---- Public: a photo product's straightened front for the shop's previews (cached one day) ----
  app.get('/catalog-shots/:pid/:file', (req, res) => {
    const { pid, file } = req.params;
    if (!PID_RE.test(String(pid)) || !PUBLIC_SHOT_RE.test(String(file))) throw new HttpError(404, 'notFound');
    const f = path.join(shotsDir(pid), file);
    if (!fs.existsSync(f)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type(TYPE_OF[path.extname(file)]).send(fs.readFileSync(f));
  });

  // ---- The owner's approvals list: the photos of a product waiting, behind a key only this server makes ----
  const picKeySecret = crypto.randomBytes(32);
  const picKey = (sid) => crypto.createHmac('sha256', picKeySecret).update(`shoot-pics:${sid}`).digest('hex').slice(0, 32);
  app.get('/photo-shoot-pics/:sid/:key/:file', (req, res) => {
    const { sid, key, file } = req.params;
    const want = SID_RE.test(String(sid)) ? picKey(sid) : '';
    const ok = want && typeof key === 'string' && key.length === want.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want));
    if (!ok || !/^(?:front|threeq)-thumb\.webp$/.test(String(file))) throw new HttpError(404, 'notFound');
    const s = shoots()[sid];
    if (!isObj(s) || !(file in filesOf(s))) throw new HttpError(404, 'notFound');
    const f = path.join(shootDir(sid), file);
    if (!fs.existsSync(f)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'private, max-age=3600');
    res.type('image/webp').send(fs.readFileSync(f));
  });
  /** For app.js picsOf: the front (and 3/4) photo of a product from photos still to decide. */
  const approvalPics = (a) => {
    if (!a || a.action !== PRODUCT_ACTION || !(a.status === 'pending' || a.status === 'failed')) return [];
    const sid = shootOfApproval(a);
    const s = sid && shoots()[sid];
    if (!isObj(s)) return [];
    return ['front', 'threeq'].filter((v) => isObj(s.shots && s.shots[v])).map((v) => ({
      url: `/photo-shoot-pics/${sid}/${picKey(sid)}/${v}-thumb.webp`,
      name: v === 'front' ? L('Front photo', 'صورة الأمام') : L('Three-quarter photo', 'صورة من الزاوية'),
    }));
  };

  const approvalChecks = {
    'POST /api/admin/photo-products/from-measurements': (req) => {
      const c = checkNew(req);
      if (edits()[c.id]) throw new HttpError(400, 'productIdTaken', { field: 'id' });
      const waiting = approvalsAll().some((a) => (a.status === 'pending' || a.status === 'failed') && a.body && a.body.id === c.id
        && (a.action === 'POST /api/admin/catalog' || a.action === 'POST /api/admin/photo-products/from-measurements'));
      if (waiting) throw new HttpError(409, 'productIdWaiting', { field: 'id' });
      // (Kept as it will be applied: the owner never approves a price that won't happen (a team member's product
      // starts at the template's prices), nor numbers that will be rounded.)
      req.body = { ...asApplied(c.input), id: c.id, name: c.name };
    },
    'PUT /api/admin/catalog/:id/drinkware': (req) => {
      const c = checkRemeasure(req);
      req.body = asApplied(c.input);
    },
  };
  approvalChecks[PRODUCT_ACTION] = (req) => {
    const k = checkProduct(req);
    if (edits()[k.id]) throw new HttpError(400, 'productIdTaken', { field: 'id' });
    const open = approvalsAll().filter((a) => a.status === 'pending' || a.status === 'failed');
    if (open.some((a) => a.body && a.body.id === k.id && ['POST /api/admin/catalog', 'POST /api/admin/photo-products/from-measurements', PRODUCT_ACTION].includes(a.action))) throw new HttpError(409, 'productIdWaiting', { field: 'id' });
    if (open.some((a) => a.action === PRODUCT_ACTION && shootOfApproval(a) === k.sid)) throw new HttpError(409, 'photoShootWaiting');
    // (Kept as it will be applied: the session's version pinned, so the owner approves exactly what was built;
    // no price from a team member.)
    req.body = { id: k.id, name: k.name, rev: k.rev };
  };
  return { approvalChecks, approvalPics };
}

module.exports = { mount, cleanMeasurements, cleanPrice, cleanNudges, RANGES, DEFAULTS, VIEWS, SHOOT };
