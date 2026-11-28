'use strict';

/**
 * The product manager's changes to the catalogue (admin → Products).
 *
 * The products themselves are written in src/products.js (their drawings, print
 * areas, 3D models...). The manager's changes are kept in the data file
 * (db.catalog.products: { [productId]: edit }) and laid over those products,
 * like the owner's prices (src/accounting.js), so every page, price and order
 * uses them right away and every copy of the app sees the same catalogue.
 *
 * An edit can:
 *  - change the name, description and category;
 *  - pause the product (status 'hidden': out of stock, season, other, with a note and
 *    an optional day it comes back by itself, `showAgainOn`) or stop selling it (status
 *    'removed', "archived": kept for old orders; can be sold again);
 *  - count stock, for the whole product or per colour and size ("black|XL": 4): a colour,
 *    size or combination at 0 shows as sold out, the product hides itself when nothing is
 *    left, and every order takes its pieces off;
 *  - turn colours and sizes off or mark them sold out, rename sizes, add colours and sizes;
 *  - per side: turn it off, the physical print size, the print area on the
 *    product drawing, the safe margin and the bleed;
 *  - the printing technology (within what the product can be made with), and embroidery;
 *  - its own product photos (uploaded; the first or the chosen one leads).
 *
 * New products are made from an existing one (its drawing, 3D model and print setup)
 * and then changed: { template: 'tshirt', ... }.
 *
 * Round drinkware made from measurements ("New product from photo") is such a clone of `tumbler` or `mug` that
 * carries a `drinkware` spec (src/drinkware.js): its print side, 3D model and print geometry come from the measured
 * numbers, so the manager can't move its print area or change its print size here (`photoProductGeometry`), and
 * it can't be shown in the shop before the owner has checked the dimensions (`photoProductNotChecked`).
 *
 * Products are never deleted from the list (old orders and designs still need them):
 * "removed" (archived) ones are left out of the shop and of new orders.
 */

const STATUSES = ['live', 'hidden', 'removed'];
const HIDE_REASONS = ['stock', 'season', 'quality', 'supplier', 'other'];
/** What each kind of product can be made with (the first family that holds its own process). */
const PROCESS_FAMILIES = [
  ['dtg', 'dtf'],
  ['engrave', 'lasercut', 'cnc'],
  ['sublimation', 'uv'],
  ['paper'],
  ['canvas'],
  ['textile'],
];
const EMB_AT = ['chest', 'center', 'top', 'same'];
// "Show it again on" is a day in the shop's time zone (like coupons and the accounts).
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Today in the shop's time zone ('YYYY-MM-DD'). */
const today = () => DAY_FMT.format(new Date());
const isDay = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; // no 30 February
};
const drinkware = require('./drinkware');

const MAX_PHOTOS = 12;
const MAX_ADDED = 200;

let base = null; // productId -> the product as written in src/products.js (deep copy)
let baseOrder = [];
let appliedKey = null;
let embSpecs = {};
let embroideryFor = null;
let scalePrice = (v) => v;

/** Remember the products as written, before any change. Call once, after src/products.js is loaded. */
function init(products, opts = {}) {
  if (base) return;
  base = new Map(products.map((p) => [p.id, structuredClone(p)]));
  baseOrder = products.map((p) => p.id);
  embSpecs = opts.embroidery || {};
  embroideryFor = opts.embroideryFor || null;
  if (opts.scalePrice) scalePrice = opts.scalePrice;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** The process family a product belongs to (from its own process as written). */
function processChoices(p) {
  const own = base.get(p.base || p.id) || p;
  const fam = PROCESS_FAMILIES.find((f) => f.includes(own.process));
  return fam ? fam.slice() : [own.process];
}
/** Fabric products that can also be embroidered (garments, caps, bags, aprons). */
function canEmbroider(p) {
  const own = base.get(p.base || p.id) || p;
  if (own.embroidery || embSpecs[own.id]) return true;
  return !own.laser && !own.kind && !own.pattern && (own.methods || []).some((m) => m === 'dtg' || m === 'dtf');
}

/** Lay one edit over a fresh copy of its product. */
function applyEdit(p, e) {
  if (!e) return p;
  if (e.template) p.base = e.template;
  // Drinkware made from measurements: its own print side, 3D model and geometry (a bad spec leaves the template's).
  if (isObj(e.drinkware)) {
    try {
      drinkware.applyTo(p, e.drinkware);
    } catch (err) {
      console.error(`catalog: drinkware spec of ${p.id} not applied: ${err.message}`);
    }
  }
  if (e.name) p.name = { ...p.name, ...e.name };
  if (e.description) p.description = { ...p.description, ...e.description };
  if (e.category) p.category = e.category;
  p.status = STATUSES.includes(e.status) ? e.status : 'live';
  if (p.status !== 'live') {
    p.hiddenReason = e.hiddenReason || null;
    p.hiddenNote = e.hiddenNote || '';
  }
  if (p.status === 'hidden' && isDay(e.showAgainOn)) p.showAgainOn = e.showAgainOn;
  if (typeof e.stock === 'number') p.stock = e.stock;
  if (isObj(e.variantStock) && Object.keys(e.variantStock).length) {
    p.variantStock = { ...e.variantStock };
    delete p.stock; // counted per colour and size instead
  }
  if (typeof e.lowStockAt === 'number') p.lowStockAt = e.lowStockAt;

  // Colours and sizes: off (not offered), sold out (shown as sold out), renamed sizes, added ones.
  const cEd = e.colors || {};
  p.colors = p.colors.map((c) => ({ ...c, ...(cEd[c.id] && cEd[c.id].off ? { off: true } : {}), ...(cEd[c.id] && cEd[c.id].soldOut ? { soldOut: true } : {}) }));
  for (const c of e.addColors || []) {
    if (p.colors.some((x) => x.id === c.id)) continue;
    p.colors.push({ id: c.id, name: c.name, hex: c.hex, added: true, ...(cEd[c.id] && cEd[c.id].off ? { off: true } : {}), ...(cEd[c.id] && cEd[c.id].soldOut ? { soldOut: true } : {}) });
  }
  const sEd = e.sizes || {};
  p.sizes = p.sizes.map((z) => {
    const o = sEd[z.id] || {};
    return { ...z, ...(o.label ? { label: { ...z.label, ...o.label } } : {}), ...(o.off ? { off: true } : {}), ...(o.soldOut ? { soldOut: true } : {}) };
  });
  for (const z of e.addSizes || []) {
    if (p.sizes.some((x) => x.id === z.id)) continue;
    const o = sEd[z.id] || {};
    p.sizes.push({ id: z.id, label: z.label, surcharge: z.surcharge || 0, ...(z.printScale ? { printScale: z.printScale } : {}), added: true, ...(o.off ? { off: true } : {}), ...(o.soldOut ? { soldOut: true } : {}) });
  }

  // Sides: off, print size, print area, margins.
  let sidesChanged = false;
  const dEd = e.sides || {};
  p.sides = p.sides.map((sd) => {
    const o = dEd[sd.id];
    if (!o) return sd;
    sidesChanged = true;
    const out = { ...sd };
    if (o.off) out.off = true;
    if (o.area) out.printArea = { ...sd.printArea, ...o.area };
    if (o.printWidthCm) out.printWidthIn = r3(o.printWidthCm / 2.54);
    if (typeof o.safeMm === 'number') out.safeIn = r3(o.safeMm / 25.4);
    if (typeof o.bleedMm === 'number') out.bleedIn = r3(o.bleedMm / 25.4);
    // A moved print area keeps the customer's move zone around it.
    if (o.area && out.moveZone) {
      const a = out.printArea;
      const z = out.moveZone;
      const x = Math.min(z.x, a.x);
      const y = Math.min(z.y, a.y);
      out.moveZone = { x, y, w: Math.max(z.x + z.w, a.x + a.w) - x, h: Math.max(z.y + z.h, a.y + a.h) - y };
    }
    return out;
  });

  // Printing technology.
  if (e.process) p.process = e.process;
  if (Array.isArray(e.methods) && e.methods.length) p.methods = e.methods.slice();
  else if (e.process) p.methods = (p.methods || []).length > 1 && p.methods.includes(e.process) ? p.methods : [e.process];

  // Embroidery: off, or its area / price; redrawn when the print area moved.
  if (e.embroidery === false) delete p.embroidery;
  else if (embroideryFor && (isObj(e.embroidery) || (sidesChanged && p.embroidery))) {
    const spec = isObj(e.embroidery) ? e.embroidery : embSpecs[p.base || p.id];
    if (spec) {
      const surcharge = isObj(e.embroidery) ? spec.surcharge : p.embroidery ? p.embroidery.surcharge : scalePrice(spec.surcharge);
      p.embroidery = embroideryFor(p, { ...spec, surcharge });
    }
  }

  // Photos the manager uploaded (served from the data folder).
  if (Array.isArray(e.photos) && e.photos.length) {
    p.photos = e.photos.map((ph) => ({ id: ph.id, url: `/catalog-photos/${encodeURIComponent(p.id)}/${ph.id}.webp`, ...(ph.alt ? { alt: ph.alt } : {}) }));
    const main = p.photos.find((ph) => ph.id === e.mainPhoto) || p.photos[0];
    p.mainPhoto = main.url;
  }
  // Stock per colour and size: a colour (or size) with nothing left in any size (colour) shows as sold out.
  if (p.variantStock) {
    const left = (c, z) => comboLeft(p, c.id, z.id);
    const onColors = p.colors.filter((c) => !c.off);
    const onSizes = p.sizes.filter((z) => !z.off);
    for (const c of p.colors) if (onSizes.length && onSizes.every((z) => left(c, z) === 0)) c.stockOut = true;
    for (const z of p.sizes) if (onColors.length && onColors.every((c) => left(c, z) === 0)) z.stockOut = true;
  }
  if (e.updatedAt) p.updatedAt = e.updatedAt;
  if (e.updatedBy) p.updatedBy = e.updatedBy;
  return p;
}

/**
 * Lay the saved edits over the products (cheap when nothing changed). The same
 * array and the same product objects are kept, so every module sees the changes.
 * Returns true when the catalogue changed.
 */
function apply(products, catalog) {
  if (!base) init(products);
  const edits = (catalog && catalog.products) || {};
  const key = JSON.stringify(edits);
  if (key === appliedKey) return false;
  appliedKey = key;
  const byId = new Map(products.map((p) => [p.id, p]));
  const reset = (id, fresh) => {
    const obj = byId.get(id) || {};
    for (const k of Object.keys(obj)) delete obj[k];
    return Object.assign(obj, fresh);
  };
  const out = [];
  const added = Object.entries(edits).filter(([id, e]) => e && e.template && !base.has(id) && base.has(e.template))
    .sort((a, b) => String(a[1].createdAt || '').localeCompare(String(b[1].createdAt || '')));
  for (const id of baseOrder) {
    out.push(applyEdit(reset(id, structuredClone(base.get(id))), edits[id]));
    // New products come right after the product they were made from.
    for (const [nid, e] of added) {
      if (e.template !== id) continue;
      out.push(applyEdit(reset(nid, { ...structuredClone(base.get(id)), id: nid }), e));
    }
  }
  // An added product no longer in the edits was deleted (only allowed while no design or order used it).

  products.length = 0;
  products.push(...out);
  return true;
}

/** Pieces left of a colour in a size (null when that combination isn't counted). */
function comboLeft(p, colorId, sizeId) {
  const v = p.variantStock && p.variantStock[`${colorId}|${sizeId}`];
  return typeof v === 'number' ? v : null;
}
const out = (x) => x.off || x.soldOut || x.stockOut;
/**
 * A paused product whose "show it again on" day has come (today or earlier, in the shop's
 * time zone): it counts as live again. Worked out when asked, so every copy of the app agrees
 * and no job has to run at midnight.
 */
const pauseOver = (p) => Boolean(p && p.status === 'hidden' && p.showAgainOn && p.showAgainOn <= today());
/** Shown and orderable in the shop: live (or back from a pause), and in stock when stock is counted. */
function visible(p) {
  if (!p) return false;
  if (p.status && p.status !== 'live' && !pauseOver(p)) return false;
  // A draft whose price isn't set yet (basePrice 0: the Ramadan lanterns, 28 Nov) is never sold, even if shown by mistake.
  if (!(p.basePrice > 0)) return false;
  if (typeof p.stock === 'number' && p.stock <= 0) return false;
  const colors = p.colors.filter((c) => !out(c));
  const sizes = p.sizes.filter((z) => !out(z));
  if (!colors.length || !sizes.length) return false;
  // Per colour and size: at least one combination left.
  if (p.variantStock && !colors.some((c) => sizes.some((z) => comboLeft(p, c.id, z.id) !== 0))) return false;
  return true;
}
/** Why a product can't be ordered right now (null when it can). */
function unavailable(p, { colorId, sizeId, sideIds } = {}) {
  if (!p) return 'unknownProduct';
  // Archived ("stop selling"): the shop says it's no longer sold and offers similar products.
  if (p.status === 'removed') return 'productRetired';
  if (!visible(p)) return 'productUnavailable';
  if (colorId) {
    const c = p.colors.find((x) => x.id === colorId);
    if (!c || out(c)) return 'colorUnavailable';
  }
  if (sizeId) {
    const z = p.sizes.find((x) => x.id === sizeId);
    if (!z || out(z)) return 'sizeUnavailable';
  }
  if (colorId && sizeId && comboLeft(p, colorId, sizeId) === 0) return 'variantUnavailable';
  if (sideIds && sideIds.some((id) => (p.sides.find((s) => s.id === id) || {}).off)) return 'sideUnavailable';
  return null;
}
/**
 * Where a product stands for shoppers (GET /api/products/:id/name): 'live', 'paused' (back soon,
 * with `backOn` when it has a return day), 'retired' (no longer sold) or 'soldOut' (out of stock,
 * or every colour or size sold out).
 */
function shopState(p) {
  if (p.status === 'removed') return { state: 'retired' };
  if (p.status === 'hidden' && !pauseOver(p)) return { state: 'paused', ...(p.showAgainOn ? { backOn: p.showAgainOn } : {}) };
  return { state: visible(p) ? 'live' : 'soldOut' };
}
/** The product as the shop shows it: colours and sizes that are off are left out, sold-out ones are marked. */
function forShop(p) {
  const { status, hiddenReason, hiddenNote, showAgainOn, stock, lowStockAt, updatedAt, updatedBy, variantStock, ...rest } = p;
  const low = typeof lowStockAt === 'number' ? lowStockAt : 5;
  // Per colour and size: which combinations are sold out, and the few left of those nearly gone
  // (the counts themselves stay in the admin).
  const outCombos = [];
  const fewLeftBy = {};
  for (const [k, n] of Object.entries(variantStock || {})) {
    if (n <= 0) outCombos.push(k);
    else if (n <= low) fewLeftBy[k] = n;
  }
  return {
    ...rest,
    colors: p.colors.filter((c) => !c.off).map(({ added, stockOut, ...c }) => (stockOut ? { ...c, soldOut: true } : c)),
    sizes: p.sizes.filter((z) => !z.off).map(({ added, stockOut, ...z }) => (stockOut ? { ...z, soldOut: true } : z)),
    sides: p.sides.filter((s) => !s.off),
    ...(typeof stock === 'number' && stock > 0 && stock <= low ? { fewLeft: stock } : {}),
    ...(outCombos.length ? { outCombos } : {}),
    ...(Object.keys(fewLeftBy).length ? { fewLeftBy } : {}),
  };
}

// ---------- Checking the manager's changes ----------
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const longText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, ' ').trim().slice(0, max) : '');
function bilingual(v, max, { long = false } = {}) {
  if (v === null) return undefined; // back to the original
  if (!isObj(v)) return null; // a list or plain text is not a name in two languages
  const f = long ? longText : text;
  const out = {};
  for (const k of ['en', 'ar']) if (typeof v[k] === 'string') out[k] = f(v[k], max);
  if (Object.values(out).some((x) => !x)) return null; // empty names are not allowed
  return Object.keys(out).length ? out : undefined;
}
const num = (v, min, max) => {
  if (v === '' || v === null || v === undefined) return undefined;
  if (typeof v !== 'number' && typeof v !== 'string') return null; // true is not 1
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Check a change from the admin. `body` is the whole new edit for the product
 * (what the edit screen shows); returns { edit } or { error, field }.
 */
function clean(p, body, { categories = [], prev = null } = {}) {
  const b = isObj(body) ? body : {};
  const own = base.get(p.base || p.id);
  const out = {};
  const bad = (field, error = 'badProductField') => ({ error, field });
  const drink = prev && isObj(prev.drinkware) ? prev.drinkware : null;

  if (b.name !== undefined) {
    const v = bilingual(b.name, 80);
    if (v === null) return bad('name');
    if (v) out.name = v;
  }
  if (b.description !== undefined) {
    const v = bilingual(b.description, 1500, { long: true });
    if (v === null) return bad('description');
    if (v) out.description = v;
  }
  if (b.category !== undefined && b.category !== null && b.category !== '') {
    if (!categories.includes(b.category)) return bad('category');
    out.category = b.category;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return bad('status');
    // Measured drinkware is shown in the shop only once the owner has checked its dimensions.
    if (b.status === 'live' && drink && !drink.checkedAt) return bad('status', 'photoProductNotChecked');
    // (A product written as a draft, `status: 'hidden'` in src/products.js, keeps 'live' in its edit once shown.)
    if (b.status === 'live' && own && own.status && own.status !== 'live') out.status = 'live';
    if (b.status !== 'live') {
      out.status = b.status;
      if (b.hiddenReason != null && b.hiddenReason !== '') {
        if (!HIDE_REASONS.includes(b.hiddenReason)) return bad('hiddenReason');
        out.hiddenReason = b.hiddenReason;
      }
      const note = text(b.hiddenNote, 200);
      if (note) out.hiddenNote = note;
    }
  }
  // The day a paused product comes back by itself (null or '' = none). Kept only while paused:
  // cleared when the product goes live or is archived. A day already gone is refused.
  if (b.showAgainOn !== undefined && b.showAgainOn !== null && b.showAgainOn !== '') {
    if (!isDay(b.showAgainOn)) return bad('showAgainOn');
    const status = b.status !== undefined ? b.status : (prev && prev.status) || 'live';
    if (status === 'hidden') {
      if (b.showAgainOn < today()) return bad('showAgainOn');
      // (A return day would put unchecked drinkware in the shop by itself.)
      if (drink && !drink.checkedAt) return bad('showAgainOn', 'photoProductNotChecked');
      out.showAgainOn = b.showAgainOn;
    }
  }
  if (b.stock !== undefined && b.stock !== null && b.stock !== '') {
    const v = num(b.stock, 0, 1e6);
    if (v === null || !Number.isInteger(v)) return bad('stock');
    out.stock = v;
  }
  // Stock per colour and size: { "colorId|sizeId": pieces } (null or {} = not counted this way).
  if (b.variantStock !== undefined && b.variantStock !== null) {
    if (!isObj(b.variantStock)) return bad('variantStock');
    const m = {};
    const colorIds = new Set([...ownColorsOf(own, drink).map((c) => c.id), ...((b.addColors !== undefined ? b.addColors : prev && prev.addColors) || []).map((c) => c && c.id)]);
    const sizeIds = new Set([...own.sizes.map((z) => z.id), ...((b.addSizes !== undefined ? b.addSizes : prev && prev.addSizes) || []).map((z) => z && z.id)]);
    for (const [k, n] of Object.entries(b.variantStock)) {
      const [c, z, extra] = k.split('|');
      if (extra !== undefined || !colorIds.has(c) || !sizeIds.has(z)) return bad('variantStock');
      if (n === '' || n === null) continue; // that combination not counted
      const v = num(n, 0, 1e6);
      if (v === null || v === undefined || !Number.isInteger(v)) return bad('variantStock');
      m[k] = v;
    }
    if (Object.keys(m).length) {
      if (Object.keys(m).length > 2000) return bad('variantStock');
      out.variantStock = m;
    }
  }
  if (b.lowStockAt !== undefined && b.lowStockAt !== null && b.lowStockAt !== '') {
    const v = num(b.lowStockAt, 0, 1e5);
    if (v === null || !Number.isInteger(v)) return bad('lowStockAt');
    out.lowStockAt = v;
  }

  // Colours.
  const ownColors = new Set(ownColorsOf(own, drink).map((c) => c.id));
  if (b.addColors !== undefined) {
    if (!Array.isArray(b.addColors) || b.addColors.length > 30) return bad('addColors');
    const list = [];
    for (const c of b.addColors) {
      if (!isObj(c) || !ID_RE.test(String(c.id || '')) || ownColors.has(c.id) || list.some((x) => x.id === c.id)) return bad('addColors');
      const name = bilingual(c.name, 40);
      if (!name || !name.en || !name.ar || !HEX_RE.test(String(c.hex || ''))) return bad('addColors');
      list.push({ id: c.id, name, hex: c.hex.toLowerCase() });
    }
    if (list.length) out.addColors = list;
  }
  // Colours added before stay when this change doesn't send the list again.
  const addedColors = b.addColors !== undefined ? (out.addColors || []) : ((prev && prev.addColors) || []);
  const allColors = new Set([...ownColors, ...addedColors.map((c) => c.id)]);
  if (b.colors !== undefined) {
    if (!isObj(b.colors)) return bad('colors');
    const m = {};
    for (const [id, o] of Object.entries(b.colors)) {
      if (!allColors.has(id) || !isObj(o)) return bad('colors');
      const f = { ...(o.off ? { off: true } : {}), ...(o.soldOut ? { soldOut: true } : {}) };
      if (Object.keys(f).length) m[id] = f;
    }
    if ([...allColors].every((id) => m[id] && m[id].off)) return bad('colors', 'needOneColor');
    if (Object.keys(m).length) out.colors = m;
  }

  // Sizes.
  const ownSizes = new Set(own.sizes.map((z) => z.id));
  if (b.addSizes !== undefined) {
    if (!Array.isArray(b.addSizes) || b.addSizes.length > 30) return bad('addSizes');
    const list = [];
    for (const z of b.addSizes) {
      if (!isObj(z) || !/^[A-Za-z0-9][A-Za-z0-9x.-]{0,19}$/.test(String(z.id || '')) || ownSizes.has(z.id) || list.some((x) => x.id === z.id)) return bad('addSizes');
      const label = bilingual(z.label, 40);
      if (!label || !label.en || !label.ar) return bad('addSizes');
      const sur = num(z.surcharge, -1e5, 1e6);
      const scale = num(z.printScale, 0.1, 10);
      // Measured drinkware has one physical size: a bigger print would not fit the measured band.
      if (drink && scale != null && scale !== 1) return bad('addSizes', 'photoProductGeometry');
      // A size never makes the product cost nothing (or less).
      if (sur === null || scale === null || (Number(p.basePrice) || 0) + (sur || 0) < 1) return bad('addSizes');
      list.push({ id: z.id, label, surcharge: sur || 0, ...(scale && scale !== 1 ? { printScale: scale } : {}) });
    }
    if (list.length) out.addSizes = list;
  }
  const addedSizes = b.addSizes !== undefined ? (out.addSizes || []) : ((prev && prev.addSizes) || []);
  const allSizes = new Set([...ownSizes, ...addedSizes.map((z) => z.id)]);
  if (b.sizes !== undefined) {
    if (!isObj(b.sizes)) return bad('sizes');
    const m = {};
    for (const [id, o] of Object.entries(b.sizes)) {
      if (!allSizes.has(id) || !isObj(o)) return bad('sizes');
      const f = { ...(o.off ? { off: true } : {}), ...(o.soldOut ? { soldOut: true } : {}) };
      if (o.label !== undefined && ownSizes.has(id)) {
        const label = bilingual(o.label, 40);
        if (label === null) return bad('sizes');
        const was = own.sizes.find((z) => z.id === id).label;
        if (label && (label.en !== was.en || label.ar !== was.ar)) f.label = label;
      }
      if (Object.keys(f).length) m[id] = f;
    }
    if ([...allSizes].every((id) => m[id] && m[id].off)) return bad('sizes', 'needOneSize');
    if (Object.keys(m).length) out.sizes = m;
  }

  // Sides: on/off, physical print width, print area (mockup units, inside the 500 × 600 drawing), margins.
  if (b.sides !== undefined) {
    if (!isObj(b.sides)) return bad('sides');
    const m = {};
    for (let [id, o] of Object.entries(b.sides)) { // eslint-disable-line prefer-const
      const sd = own.sides.find((s) => s.id === id);
      if (!sd || !isObj(o)) return bad('sides');
      const f = {};
      if (o.off) f.off = true;
      if (drink) {
        // The print size and area come from the measurements: the same values (as the edit screen sends them back)
        // are fine, a change is refused (re-measure instead).
        const cur = p.sides.find((s) => s.id === id) || sd;
        const w = num(o.printWidthCm, 0.5, 1000);
        if (w === null || (w !== undefined && Math.abs(w - cur.printWidthIn * 2.54) > 0.05)) return bad(`sides.${id}.printWidthCm`, 'photoProductGeometry');
        if (o.area !== undefined) {
          const a = isObj(o.area) ? o.area : {};
          if (['x', 'y', 'w', 'h'].some((k) => num(a[k], -1e4, 1e4) == null || Math.abs(Number(a[k]) - cur.printArea[k]) > 0.15)) return bad(`sides.${id}.area`, 'photoProductGeometry');
        }
        o = { ...o, printWidthCm: undefined, area: undefined };
      }
      const w = num(o.printWidthCm, 0.5, 1000);
      if (w === null) return bad(`sides.${id}.printWidthCm`);
      if (w !== undefined && Math.abs(w - sd.printWidthIn * 2.54) > 0.005) f.printWidthCm = r2(w);
      const safe = num(o.safeMm, 0, 200);
      if (safe === null) return bad(`sides.${id}.safeMm`);
      if (safe !== undefined && Math.abs(safe - (sd.safeIn || 0) * 25.4) > 0.05) f.safeMm = r2(safe);
      const bleed = num(o.bleedMm, 0, 50);
      if (bleed === null) return bad(`sides.${id}.bleedMm`);
      if (bleed !== undefined && Math.abs(bleed - (sd.bleedIn || 0) * 25.4) > 0.05) f.bleedMm = r2(bleed);
      if (o.area !== undefined) {
        const a = o.area;
        if (!isObj(a)) return bad(`sides.${id}.area`);
        const x = num(a.x, 0, 500);
        const y = num(a.y, 0, 600);
        const aw = num(a.w, 10, 500);
        const ah = num(a.h, 10, 600);
        if ([x, y, aw, ah].some((v) => v === null || v === undefined) || x + aw > 500.5 || y + ah > 600.5) return bad(`sides.${id}.area`);
        const pa = sd.printArea;
        const area = { x: r2(x), y: r2(y), w: r2(aw), h: r2(ah) };
        if (['x', 'y', 'w', 'h'].some((k) => Math.abs(area[k] - pa[k]) > 0.05)) f.area = area;
      }
      if (Object.keys(f).length) m[id] = f;
    }
    if (own.sides.every((s) => m[s.id] && m[s.id].off)) return bad('sides', 'needOneSide');
    if (Object.keys(m).length) out.sides = m;
  }

  // Printing technology.
  const choices = processChoices(p);
  if (b.process !== undefined && b.process !== null && b.process !== '') {
    if (!choices.includes(b.process)) return bad('process');
    if (b.process !== own.process) out.process = b.process;
  }
  if (b.methods !== undefined && b.methods !== null) {
    if (!Array.isArray(b.methods) || !b.methods.length || b.methods.some((x) => !choices.includes(x))) return bad('methods');
    const list = [...new Set(b.methods)];
    const proc = out.process || own.process;
    if (!list.includes(proc)) return bad('methods');
    if (list.join() !== (own.methods || []).join()) out.methods = list;
  }

  // Embroidery: false = not offered; { cm: [w, h], at, surcharge } = offered there.
  if (b.embroidery !== undefined) {
    if (b.embroidery === false || b.embroidery === null) {
      if (own.embroidery) out.embroidery = false;
    } else {
      const e = b.embroidery;
      if (!isObj(e) || !canEmbroider(p)) return bad('embroidery');
      const at = EMB_AT.includes(e.at) ? e.at : null;
      const cw = num(e.cm && e.cm[0], 1, 40);
      const ch = num(e.cm && e.cm[1], 1, 40);
      const sur = num(e.surcharge, 0, 1e5);
      const colors = num(e.maxColors, 1, 15);
      if (colors != null && !Number.isInteger(colors)) return bad('embroidery');
      if (!at || (at !== 'same' && (!cw || !ch)) || sur === null || sur === undefined || colors === null) return bad('embroidery');
      const spec = { at, cm: at === 'same' ? [0, 0] : [r2(cw), r2(ch)], surcharge: Math.round(sur), maxColors: colors || 6 };
      const was = embSpecs[own.id];
      const same = was && own.embroidery && was.at === spec.at && (at === 'same' || (was.cm[0] === spec.cm[0] && was.cm[1] === spec.cm[1])) && own.embroidery.surcharge === spec.surcharge && (own.embroidery.maxColors || 6) === spec.maxColors;
      if (!same) out.embroidery = spec;
    }
  }
  return { edit: out };
}

/** A product's own colours: a measured drinkware product has one, named after its material (src/drinkware.js). */
function ownColorsOf(own, drink) {
  if (drink) {
    try { return drinkware.colorsFor(drink); } catch (e) { /* the template's */ }
  }
  return own.colors;
}

/** Fields the manager may not change through clean() and that are kept as they were. */
function keepFixed(prev, next) {
  const out = { ...next };
  for (const k of ['template', 'createdAt', 'createdBy', 'photos', 'mainPhoto', 'drinkware']) if (prev && prev[k] !== undefined) out[k] = prev[k];
  return out;
}

/** Check a new product's id and template. */
function cleanNew(body, products) {
  const b = isObj(body) ? body : {};
  const id = String(b.id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) return { error: 'badProductId' };
  if (products.some((p) => p.id === id) || base.has(id)) return { error: 'productIdTaken' };
  const tpl = String(b.template || '');
  const from = base.get(tpl);
  if (!from) return { error: 'unknownProduct' };
  if (from.kind) return { error: 'badTemplate' }; // books and gang sheets have their own pages
  if (products.filter((p) => p.base).length >= MAX_ADDED) return { error: 'tooManyProducts' };
  // A new product's name in both languages (or none yet: it starts as "<template> (new)").
  if (b.name !== undefined && b.name !== null) {
    const n = isObj(b.name) ? b.name : {};
    if (!text(n.en, 80) || !text(n.ar, 80)) return { error: 'badProductField', field: 'name' };
  }
  return { id, template: tpl };
}

/** The admin's view of a product: what the shop shows plus what the manager can change. */
function forAdmin(p, edit) {
  const own = base.get(p.base || p.id) || p;
  return {
    ...p,
    builtIn: base.has(p.id),
    template: p.base || null,
    status: p.status || 'live',
    visible: visible(p),
    // Paused until a day: the day, and whether it has come (the product is in the shop again).
    showAgainOn: p.status === 'hidden' && p.showAgainOn ? p.showAgainOn : null,
    ...(pauseOver(p) ? { pausedUntilPassed: true } : {}),
    stock: typeof p.stock === 'number' ? p.stock : null,
    variantStock: p.variantStock || null,
    lowStockAt: typeof p.lowStockAt === 'number' ? p.lowStockAt : 5,
    sides: p.sides.map((s) => ({ ...s, printWidthCm: r2(s.printWidthIn * 2.54), printHeightCm: r2((s.printWidthIn * s.printArea.h * 2.54) / s.printArea.w), safeMm: r2((s.safeIn || 0) * 25.4), bleedMm: r2((s.bleedIn || 0) * 25.4) })),
    processChoices: processChoices(p),
    canEmbroider: canEmbroider(p),
    embroiderySpec: edit && isObj(edit.embroidery) ? edit.embroidery : p.embroidery ? { ...(embSpecs[own.id] || { at: 'center', cm: [r2(p.embroidery.widthIn * 2.54), r2(p.embroidery.heightIn * 2.54)] }), surcharge: p.embroidery.surcharge, maxColors: p.embroidery.maxColors || 6 } : null,
    original: {
      name: own.name,
      description: own.description,
      category: own.category,
      sizes: own.sizes.map((z) => ({ id: z.id, label: z.label })),
      colors: ownColorsOf(own, edit && isObj(edit.drinkware) ? edit.drinkware : null).map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      embroiderySpec: own.embroidery ? { ...(embSpecs[own.id] || { at: 'center', cm: [r2(own.embroidery.widthIn * 2.54), r2(own.embroidery.heightIn * 2.54)] }), surcharge: own.embroidery.surcharge, maxColors: own.embroidery.maxColors || 6 } : null,
      process: own.process,
      methods: own.methods,
      sides: own.sides.map((s) => ({ id: s.id, printArea: s.printArea, printWidthCm: r2(s.printWidthIn * 2.54), safeMm: r2((s.safeIn || 0) * 25.4), bleedMm: r2((s.bleedIn || 0) * 25.4) })),
    },
    edit: edit || null,
    // Drinkware made from measurements: its spec (the measurements screen) and a badge.
    drinkware: edit && isObj(edit.drinkware) ? edit.drinkware : null,
    ...(edit && isObj(edit.drinkware) ? { fromPhotos: true } : {}),
  };
}

// ---------- Drinkware made from measurements (src/photo-product-routes.js) ----------
/**
 * A new hidden product made from a drinkware spec (from drinkware.buildSpec). body = { id, name: { en, ar }, spec,
 * createdBy }. Returns { id, template, edit } (store it as db.catalog.products[id] = edit, then sync the catalogue)
 * or { error, field } like cleanNew. Prices are not part of the edit (they go to the owner's price list).
 */
function newFromDrinkware(body, products) {
  const b = isObj(body) ? body : {};
  if (!isObj(b.spec) || b.spec.v !== 1 || !isObj(b.spec.print) || !Array.isArray(b.spec.profile)) return { error: 'badProductField', field: 'drinkware' };
  const template = drinkware.templateFor(b.spec);
  const n = cleanNew({ id: b.id, template, name: b.name }, products);
  if (n.error) return n;
  const from = base.get(template);
  const name = isObj(b.name) && text(b.name.en, 80) && text(b.name.ar, 80)
    ? { en: text(b.name.en, 80), ar: text(b.name.ar, 80) }
    : { en: `${from.name.en} (new)`, ar: `${from.name.ar} (جديد)` };
  const edit = {
    template, createdAt: new Date().toISOString(), createdBy: text(String(b.createdBy || ''), 80) || undefined,
    name,
    status: 'hidden', hiddenReason: 'other', hiddenNote: 'New product from measurements: check the dimensions, then show it in the shop',
    drinkware: { ...b.spec, checkedAt: null, checkedBy: null },
  };
  if (!edit.createdBy) delete edit.createdBy;
  return { id: n.id, template, edit };
}

/**
 * New measurements for a drinkware product: the edit with the new spec, its check cleared. A product that was in
 * the shop is paused until the owner checks the new dimensions. Returns the new edit (or { error } when `prev`
 * is not a drinkware product, or the new spec would need the other template: handle added or removed).
 */
function remeasure(prev, spec) {
  if (!isObj(prev) || !isObj(prev.drinkware)) return { error: 'badProductField', field: 'drinkware' };
  if (!isObj(spec) || spec.v !== 1) return { error: 'badProductField', field: 'drinkware' };
  if (drinkware.templateFor(spec) !== (prev.template || drinkware.templateFor(prev.drinkware))) return { error: 'photoProductGeometry', field: 'handle' };
  const next = { ...prev, drinkware: { ...spec, assetsVer: prev.drinkware.assetsVer || 0, mockup: prev.drinkware.mockup || spec.mockup || null, shootId: prev.drinkware.shootId || spec.shootId || null, ...(prev.drinkware.photo || spec.photo ? { photo: prev.drinkware.photo || spec.photo } : {}), checkedAt: null, checkedBy: null } };
  if (!next.status || next.status === 'live' || next.showAgainOn) {
    next.status = 'hidden';
    next.hiddenReason = 'other';
    next.hiddenNote = 'New measurements: check the dimensions, then show it in the shop';
    delete next.showAgainOn;
  }
  return next;
}

/**
 * The owner checked a drinkware product's dimensions: the edit with checkedAt / checkedBy set. `front` (a product made
 * from photos, the overlay check): the owner's nudges { axisXpx, rimYpx, pxPerMm } for spec.photo.front, already
 * checked by the route (src/photo-product-routes.js); they replace those three numbers.
 */
function markChecked(prev, who, front = null) {
  if (!isObj(prev) || !isObj(prev.drinkware)) return { error: 'badProductField', field: 'drinkware' };
  const d = { ...prev.drinkware, checkedAt: new Date().toISOString(), checkedBy: text(String(who || ''), 80) || 'owner' };
  if (isObj(front)) {
    if (!isObj(d.photo) || !isObj(d.photo.front)) return { error: 'badProductField', field: 'photo' };
    // (The measured numbers stay as `original`: every later nudge is bounded by them, not by the last nudge.)
    d.photo = { ...d.photo, original: d.photo.original || d.photo.front, front: { ...d.photo.front, ...front }, nudgedAt: d.checkedAt };
  }
  return { ...prev, drinkware: d };
}

module.exports = {
  comboLeft,
  init, apply, visible, unavailable, shopState, today, forShop, forAdmin, clean, cleanNew, keepFixed, processChoices, canEmbroider,
  newFromDrinkware, remeasure, markChecked,
  STATUSES, HIDE_REASONS, MAX_PHOTOS,
  isBuiltIn: (id) => Boolean(base && base.has(id)),
};
