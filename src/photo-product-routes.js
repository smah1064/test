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
  app.post('/api/admin/catalog/:id/drinkware/check', guard, (req, res) => {
    const { p } = drinkProduct(req.params.id);
    store.mutate((db) => {
      const prev = db.catalog && db.catalog.products && db.catalog.products[p.id];
      const next = catalog.markChecked(prev, req.adminWho.shown || req.adminWho.name);
      if (next.error) throw new HttpError(409, 'notDrinkware');
      db.catalog.products[p.id] = next;
      logCatalog(db, req, p.id, 'dimensions checked');
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
  return { approvalChecks };
}

module.exports = { mount, cleanMeasurements, cleanPrice, RANGES, DEFAULTS };
