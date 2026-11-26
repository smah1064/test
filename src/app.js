'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { pipeline: streamPipeline } = require('stream/promises');
const { Transform } = require('stream');
const { Store } = require('./store');
const {
  PRODUCTS,
  CATEGORIES,
  CURRENCY,
  MOCKUP_WIDTH,
  MOCKUP_HEIGHT,
  EXTRA_SIDE_PRICE,
  SHIPPING_FLAT,
  FREE_SHIPPING_OVER,
  getProduct,
  priceFor,
  cleanOptions,
  optionsPrice,
  shippingFor,
  DELIVERY_DAYS,
  expressFee,
  deliveryFor,
  businessDaysAfter,
  round2,
  printAreaFor,
  placedAreaFor,
  printWidthFor,
  printHeightFor,
  REPEATS,
  matchSize,
  matchColor,
  variantColumns,
  pageSides,
} = require('./products');
const { GOVERNORATES, normalizeEgyptMobile } = require('./egypt');
const i18n = require('./i18n');
const { FIELDS, langOf, format } = i18n;
const roles = require('./roles');
// Loaded on first use: the shop keeps working even if the image library cannot load on a server.
const thumbs = require('./thumbs');
const ai = require('./ai');
const notify = require('./notify');
const { PREPAY_ONLY } = require('./payment-wording');
const dispatch = require('./dispatch');
const accounting = require('./accounting');
const bgremove = require('./bgremove');
const coupons = require('./coupons');
const customers = require('./customers');
const { staffPassword } = require('./passwords');
const oauth = require('./oauth');
const importer = require('./importer');
const assets = require('./assets');
const embroidery = require('./embroidery');
let laserModule = null;
const laserFiles = new Proxy({}, { get: (_, key) => (laserModule ||= require('./laser'))[key] });

// The product manager's changes (admin → Products) are laid over the products as written,
// then the prices the owner changed over the built-in ones.
const catalog = require('./catalog');
const productsMod = require('./products');
catalog.init(PRODUCTS, { embroidery: productsMod.EMBROIDERY, embroideryFor: productsMod.embroideryFor, scalePrice: productsMod.scalePrice });
accounting.initPricing(PRODUCTS, EXTRA_SIDE_PRICE);
const { Library, CATEGORIES: DESIGN_CATEGORIES, catalogChanged: libraryCatalogChanged, hasArtwork, SEED: LIBRARY_SEED } = require('./library');
const { Views, ViewError } = require('./views');
const preview = require('./preview');
const { Backups } = require('./backup');
// Zip uploads of designs (admin): loaded when first used.
let designUploadMod = null;
const designUpload = new Proxy({}, { get: (t, k) => (designUploadMod ||= require('./design-upload'))[k] });
const security = require('./security');
const books = require('./books');
const cartoon = require('./cartoon');
const wordsRoutes = require('./words-routes');
const captchaMod = require('./captcha');
let sharpModule = null;
const sharp = () => (sharpModule ||= require('sharp'));
let printfilesModule = null;
const printfiles = new Proxy({}, { get: (_, key) => (printfilesModule ||= require('./printfiles'))[key] });
const artwork = require('./artwork');
// Name lists (variable data): loaded on first use.
let mergeModule = null;
const merge = new Proxy({}, { get: (_, key) => (mergeModule ||= require('./merge'))[key] });
let mergeDataModule = null;
const mergeData = new Proxy({}, { get: (_, key) => (mergeDataModule ||= require('./merge-data'))[key] });

/** Short hash of every file under dir: changes whenever the site's code or assets change. */
function siteVersion(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const f = path.join(d, name);
      const st = fs.statSync(f);
      if (st.isDirectory()) walk(f);
      else if (/\.(js|css|html|json)$/.test(name)) h.update(name).update(fs.readFileSync(f));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 10);
}

/** Production steps every single item moves through, in order. */
const ITEM_STATUSES = ['queued', 'printing', 'printed', 'shipped'];
/** Before production: the shop checks it, the customer approves a new proof, or changes are needed. */
const REVIEW_STATUSES = ['review', 'awaiting_approval', 'changes_requested'];

const MAX_EDITOR_JSON_BYTES = 40 * 1024 * 1024;
// merge: a name list's pictures, one per copy (up to 1,000 of them).
const UPLOAD_LIMITS = { print: 60 * 1024 * 1024, preview: 8 * 1024 * 1024, svg: 40 * 1024 * 1024, source: 60 * 1024 * 1024, merge: 150 * 1024 * 1024, photo: 15 * 1024 * 1024, thumb: 300 * 1024 };
// Sides: front/back, and the two mugs of the couple mugs set.
const FILE_RE = /^(front|back|mug1|mug2|emb|p\d{1,2})-(print|preview)\.png$|^(front|back|p\d{1,2})-overlay\.png$|^(front|back|mug1|mug2)-merge-base\.png$|^(front|back|mug1|mug2|emb|p\d{1,2})-design\.svg$|^(front|back|mug1|mug2)-merge\.bin$|^src-\d{1,2}\.(png|jpg|webp)$|^(photo|thumb)-\d{3}\.jpg$/;
const SIGNATURES = {
  png: (b) => b.subarray(0, 8).equals(PNG_SIGNATURE),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};
const MAX_ITEMS_PER_ORDER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// An address that can receive mail (no "a@b..com", "a@b.com," or a final dot); the same pattern in
// src/customers.js and src/dispatch.js. cleanEmail drops what a phone adds at the end (".", ",").
const EMAIL_RE = /^(?!.*\.\.)[^\s@,;<>()"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const cleanEmail = (v) => String(v == null ? '' : v).trim().replace(/[.,;\s]+$/, '');

/** An error whose message is a translatable key from src/i18n.js. */
class HttpError extends Error {
  constructor(status, key, params = {}) {
    super(key);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

const t = (en, ar) => ({ en, ar });
const FILE_LABELS = { print: t('print file', 'ملف الطباعة'), preview: t('preview', 'صورة المعاينة') };

/** Check an uploaded file's type and size; returns its kind. */
function checkUpload(name, buf) {
  // Name lists: the background and the names (many PNGs back to back) are print files too.
  // Photo prints: the print-ready JPEG of each photo and its small picture.
  if (/^(photo|thumb)-\d{3}\.jpg$/.test(name)) {
    const k = name.startsWith('photo-') ? 'photo' : 'thumb';
    if (buf.length > UPLOAD_LIMITS[k]) throw new HttpError(413, 'uploadTooLarge');
    if (buf.length < 16 || !SIGNATURES.jpg(buf)) throw new HttpError(400, 'badImage');
    return k;
  }
  const kind = name.startsWith('src-') ? 'source' : name.endsWith('.svg') ? 'svg' : name.endsWith('-merge.bin') ? 'merge' : name.includes('-print') || name.includes('-merge') || name.includes('-overlay') ? 'print' : 'preview';
  if (buf.length > UPLOAD_LIMITS[kind]) throw new HttpError(413, 'uploadTooLarge');
  if (kind === 'source') {
    const ext = name.split('.').pop();
    if (buf.length < 16 || !SIGNATURES[ext](buf)) throw new HttpError(400, 'badImage');
  } else if (kind === 'svg') {
    const head = buf.subarray(0, 512).toString('utf8');
    if (!/<svg[\s>]/.test(head) && !/^\s*<\?xml/.test(head)) throw new HttpError(400, 'badImage');
  } else if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new HttpError(400, 'badImage');
  }
  return kind;
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** A JPEG whose header says `dpi` (JFIF density); a JFIF header is added when there is none. */
function jpegWithDpi(buf, dpi) {
  const out = Buffer.from(buf);
  if (out.length > 20 && out[2] === 0xff && out[3] === 0xe0 && out.subarray(6, 11).toString('latin1') === 'JFIF\0') {
    out[13] = 1; // dots per inch
    out.writeUInt16BE(dpi, 14);
    out.writeUInt16BE(dpi, 16);
    return out;
  }
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0x00, 0x00]);
  return Buffer.concat([out.subarray(0, 2), app0, out.subarray(2)]);
}

/** Nested deeper than `depth`, or more than `most` values (walked without recursion: no stack overflow on a hostile body). */
function nestedTooDeep(root, depth = 20, most = 50000) {
  const stack = [[root, 0]];
  let seen = 0;
  while (stack.length) {
    const [v, d] = stack.pop();
    if (++seen > most || d > depth) return true;
    if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push([x, d + 1]);
  }
  return false;
}

function cleanString(value, field, { max = 200, required = true, lines = ' ' } = {}) {
  // Invisible characters (zero-width, direction marks pasted from phones) don't count as text.
  // One line: line breaks, tabs and other control characters become a space (an address's lines: `lines`),
  // so a pasted name can't add lines of its own to the shop's WhatsApp alert or emails (QA tester 2, 25 Nov).
  const s = typeof value === 'string'
    ? value.replace(/[\u115f\u1160\u200b-\u200f\u202a-\u202e\u2060-\u2069\u2800\u3164\ufeff\uffa0]/g, '')
      .replace(/\s*(?:\r\n|[\r\n\u0085\u2028\u2029])+\s*/g, lines).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
    : '';
  if (required && !s) throw new HttpError(400, 'fieldRequired', { field: FIELDS[field] });
  // (A name says something: "ـــ", vowel marks or dots alone aren't one. QA 25 Nov.)
  if (field === 'name' && s && !/[\p{L}\p{N}]/u.test(s.replace(/\u0640/g, ''))) throw new HttpError(400, 'fieldRequired', { field: FIELDS[field] });
  // At least two letters, as an account asks for (QA 26 Nov: "م" ordered fine, then "Save your orders" refused it with
  // no box to fix it in).
  if (field === 'name' && s && s.replace(/[^\p{L}\p{N}]/gu, '').length < 2) throw new HttpError(400, 'nameShort');
  if (s.length > max) throw new HttpError(400, 'fieldTooLong', { field: FIELDS[field] });
  return s;
}

const heightIn = (side) => round2((side.printWidthIn * side.printArea.h) / side.printArea.w);
/**
 * Where the customer moved the print area (garments and bags with a moveZone),
 * kept inside the zone; { dx, dy } in mockup units, or null for the standard spot.
 */
function cleanOffset(product, side, sizeId, offset) {
  const z = side.moveZone;
  if (!z || !offset || typeof offset !== 'object') return null;
  const a = printAreaFor(product, side.id, sizeId);
  const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(Number(v) || 0, Math.min(lo, 0)), Math.max(hi, 0)));
  const dx = clamp(offset.dx, z.x - a.x, z.x + z.w - a.w - a.x);
  const dy = clamp(offset.dy, z.y - a.y, z.y + z.h - a.h - a.y);
  return dx || dy ? { dx, dy } : null;
}
/** Embroidery: the stitch box moved from its standard spot, kept on the side's printable zone. */
/**
 * Embroidery is a layer of its own ('emb') on the side it is stitched on (the front):
 * that side can be printed too, and the other sides print as usual.
 */
const EMB = 'emb';
/** Its name: "Front embroidery" / "تطريز الأمام". */
const embSideName = (host) => ({ en: `${pickEnName(host.name)} embroidery`, ar: `تطريز ${(host.name && host.name.ar) || ''}`.trim() });
function pickEnName(n) { return n && typeof n === 'object' ? n.en || '' : String(n || ''); }
/** How many sides of the product carry something (the embroidery counts as the side it is on). */
function decoratedSides(d) {
  return Math.max(1, new Set((d.sides || []).map((sd) => sd.on || sd.id)).size);
}
/** The side that is embroidered (the others print as usual); null for printed designs. Older designs had only that side. */
function embSideOf(d) {
  return d && d.method === 'embroidery' ? d.embSide || (d.sides && d.sides[0] && d.sides[0].id) || null : null;
}
function cleanEmbOffset(side, emb, offset) {
  const z = side.moveZone || side.printArea;
  if (!offset || typeof offset !== 'object') return null;
  const a = emb.area;
  const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(Number(v) || 0, Math.min(lo, 0)), Math.max(hi, 0)));
  const dx = clamp(offset.dx, z.x - a.x, z.x + z.w - a.w - a.x);
  const dy = clamp(offset.dy, z.y - a.y, z.y + z.h - a.h - a.y);
  return dx || dy ? { dx, dy } : null;
}
/** "3 cm lower, 2 cm left" */
function placementEn(o) {
  const parts = [];
  if (o.y) parts.push(`${Math.abs(o.y)} cm ${o.y > 0 ? 'lower' : 'higher'}`);
  if (o.x) parts.push(`${Math.abs(o.x)} cm ${o.x > 0 ? 'right' : 'left'}`);
  return parts.join(', ');
}
/** The same offset in centimetres on the product (positive = right / lower), for the printer. */
function offsetCm(product, side, sizeId, o) {
  if (!o) return null;
  const perCm = printAreaFor(product, side.id, sizeId).w / (side.printWidthIn * 2.54);
  const r = (v) => Math.round((v / perCm) * 2) / 2;
  return { x: r(o.dx), y: r(o.dy) };
}

// ---------- Places for a customer's details ----------
// "{Name}", "{الاسم}"… in the shop's ready designs (a team's business cards): a name list fills them, or the
// customer types the real words. Only these count as unfilled places, never any text in braces.
/** Arabic letters (any of the Arabic blocks and presentation forms). */
const ARABIC_LETTERS = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const FIELD_RE = /\{\s*[\p{L}\p{N}_][^{}\n]{0,39}\}/gu;
const fieldKey = (tok) => String(tok).slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase();
let fieldsCache = { from: null, list: [] };
function fieldsOf(designs) {
  const out = new Map();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.text === 'string') for (const m of o.text.matchAll(FIELD_RE)) if (!out.has(fieldKey(m[0]))) out.set(fieldKey(m[0]), m[0]);
    for (const k of ['items', 'objects']) if (Array.isArray(o[k])) walk(o[k]);
  };
  walk(designs);
  return [...out.values()];
}

/** A pack size's marks for the cart, order and invoice: "100 cards" × 2 is 200 copies, not 2 pieces. */
const packOf = (z) => (z && z.pack ? { pack: true, ...(z.copies ? { copies: z.copies } : {}), ...(z.unit ? { unit: z.unit } : {}) } : {});
/** Quantity lines with their packs marked, from the product as it is now (designs saved before the marks too). */
function withPacks(productId, lines) {
  if (!Array.isArray(lines)) return lines || null;
  const p = getProduct(productId);
  if (!p) return lines;
  return lines.map((l) => {
    const z = l && l.size && p.sizes.find((x) => x.id === l.size.id);
    return z && z.pack ? { ...l, size: { ...l.size, ...packOf(z) } } : l;
  });
}

/** Quantity lines without what they cost: proofs and saved designs are seen by the team (design ids, proof
 *  links), who may not see amounts. The customer's cart and order pages work out their prices elsewhere. */
// eslint-disable-next-line no-unused-vars
const withoutLinePrices = (lines) => (Array.isArray(lines) ? lines.map(({ unitPrice, packPrice, lineTotal, price, ...l }) => l) : lines);

function publicProduct(p) {
  return { ...p, sides: p.sides.map((s) => ({ ...s, printHeightIn: heightIn(s) })) };
}

function orderStatus(order) {
  const statuses = order.items.map((i) => i.status);
  if (order.shipment && order.shipment.deliveredAt) return 'delivered';
  if (order.items.some((i) => REVIEW_STATUSES.includes(i.status))) return 'in_review';
  if (statuses.every((s) => s === 'shipped')) return 'shipped';
  if (statuses.every((s) => s === 'queued')) return 'received';
  return 'in_production';
}

const pickEn = (v) => (v && typeof v === 'object' ? v.en : v);

function governorate(id) {
  return GOVERNORATES.find((g) => g.id === id) || null;
}

function publicItem(item) {
  return {
    id: item.id,
    designId: item.designId,
    productId: item.productId,
    productName: item.productName,
    color: item.color,
    size: item.size,
    sides: item.sides.map((s) => ({ id: s.id, name: s.name, previewUrl: sidePreview(item, s) })),
    price: item.price,
    status: item.status,
    history: item.history,
    process: item.process || getProduct(item.productId)?.process,
    // Booklets: the whole booklet's files (all pages in order, imposed for stapling).
    paged: Boolean(getProduct(item.productId)?.paged),
    // Booklet pages printed from the customer's own PDF (its original can be downloaded).
    pdfSource: (item.sides || []).some((s) => s.vector),
    methods: item.method === 'embroidery' ? ['embroidery'] : getProduct(item.productId)?.methods || [item.process || 'dtf'],
    kind: item.kind || 'product',
    ...(item.photos ? { photos: item.photos } : {}),
    pieces: item.pieces,
    filmBatch: item.filmBatch || null,
    pattern: item.pattern || null,
    method: item.method || null,
    emb: item.emb || null,
    copies: item.copies || 1,
    // One price per piece when every piece costs the same; null when sizes are priced differently (see quantities).
    unitPrice: item.unitPrice != null ? item.unitPrice : item.quantities && new Set(item.quantities.map((l) => l.unitPrice)).size > 1 ? null : round2(item.price / (item.copies || 1)),
    quantities: withPacks(item.productId, item.quantities),
    approval: item.approval ? (({ decidedBy, ...x }) => x)(item.approval) : null,
    // (The team's reason for sending an approved item back stays with the team: see adminItem.)
    // (The team's own words stay the team's: why a job was sent back, why the shop's edit prints without asking, and
    // who on the team did it.)
    approvals: (item.approvals || []).map((a) => (a && a.action === 'reopened' ? { action: a.action, by: a.by, at: a.at, version: a.version }
      : a && (a.action === 'edited' || a.via === 'shop-edit') ? { action: a.action, by: a.by, at: a.at, version: a.version, ...(a.via ? { via: a.via } : {}), ...(a.note && !a.print ? { note: a.note } : {}) } : a)),
    review: item.review ? { needed: item.review.needed, reasons: (item.review.reasons || []).filter((r) => r !== 'reopened'), status: item.review.status, note: item.review.note || null } : null,
    preflight: item.preflight ? { status: item.preflight.status, checks: item.preflight.checks } : null,
    // The order id is the customer's key: a waiting proof can be opened from the order page.
    proofUrl: item.status === 'awaiting_approval' && item.proofToken ? `/proof?t=${item.proofToken}` : null,
    merge: item.merge ? { count: item.merge.count, columns: item.merge.columns } : null,
  };
}

/** `payment`: how the shop takes payment ({ prepayOnly }, src/payment-wording.js), for the order page's and invoice's wording. */
function publicOrder(order, payment) {
  const c = order.customer;
  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt,
    // Placed by a signed-in customer (it's on their account); otherwise a guest's order.
    account: Boolean(order.customerId),
    status: orderStatus(order),
    currency: order.currency || CURRENCY,
    customer: { name: c.name, city: c.city, governorate: governorate(c.governorate)?.name || c.country || null },
    items: order.items.map(publicItem),
    subtotal: order.subtotal,
    discount: order.discount || 0,
    coupon: order.coupon ? order.coupon.code : null,
    shipping: order.shipping,
    delivery: order.delivery || null,
    total: order.total,
    payment: order.payment,
    shipment: publicShipment(order),
    timeline: orderTimeline(order),
    shop: shopInfo(payment),
    invoice: { number: `INV-${order.number}`, issuedAt: order.createdAt },
  };
}

/**
 * The customer's own answer about their order: what publicOrder gives, plus the order's secret link key
 * (orders placed since the keys came in). Only for the customer's ways in (the link, the cart, the
 * account), never for the dashboard: the team works with the order number, which alone no longer opens it.
 */
function customerOrder(order, payment) {
  return { ...publicOrder(order, payment), ...(order.linkKey ? { key: order.linkKey } : {}) };
}

const SHIPMENT_FIELDS = ['courier', 'trackingNumber', 'trackingUrl', 'eta', 'shippedAt', 'deliveredAt'];
function publicShipment(order) {
  const s = order.shipment;
  if (!s) return null;
  return Object.fromEntries(SHIPMENT_FIELDS.map((k) => [k, s[k] || null]));
}
/**
 * The order's steps for the tracking page: placed, in production (the first
 * item started), printed (every item printed), shipped, delivered; `at` is
 * null for steps not reached yet.
 */
function orderTimeline(order) {
  const firstAt = (item, statuses) => ((item.history || []).find((h) => statuses.includes(h.status)) || {}).at || null;
  const allAt = (statuses) => {
    const times = order.items.map((it) => (statuses.includes(it.status) ? firstAt(it, statuses) || order.createdAt : null));
    return times.every(Boolean) ? times.sort().pop() : null;
  };
  const started = order.items.map((it) => firstAt(it, ['printing', 'printed', 'shipped'])).filter(Boolean).sort()[0] || null;
  const s = order.shipment || {};
  const shipped = s.shippedAt || allAt(['shipped']);
  const delivered = s.deliveredAt || null;
  const printed = allAt(['printed', 'shipped']) || (shipped ? shipped : null);
  return [
    { step: 'placed', at: order.createdAt },
    { step: 'production', at: started || printed || shipped || delivered },
    { step: 'printed', at: printed || delivered },
    { step: 'shipped', at: shipped || delivered },
    { step: 'delivered', at: delivered },
  ];
}
/** The shop's own details, for invoices and the tracking page (and how it takes payment: see publicOrder). */
function shopInfo(payment = { prepayOnly: PREPAY_ONLY }) {
  return {
    name: { en: 'ebda3', ar: 'إبداع' },
    url: notify.siteUrl() || null,
    whatsapp: notify.shopWhatsApp() || null,
    email: process.env.MAIL_FROM || null,
    payment: { prepayOnly: Boolean(payment && payment.prepayOnly) },
  };
}

/** A name for searching: Arabic spelling variants (أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ ئ), short vowels and tatweel ignored. */
function looseName(v) {
  return String(v || '').toLowerCase().normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

function adminCustomer(c) {
  return { ...c, governorateName: governorate(c.governorate)?.name || null };
}

/** A side's picture: the product mockup, or the corrected print file once the shop replaced it. */
function sidePreview(item, s) {
  const v = item.replaced && item.replaced[s.id];
  return v ? `/files/designs/${item.designId}/${s.id}-proof.png?v=${v}` : `/files/designs/${item.designId}/${s.id}-preview.png`;
}

function adminItem(order, item, index) {
  return {
    ...publicItem(item),
    sides: item.sides.map((s) => ({
      ...s,
      previewUrl: sidePreview(item, s),
      printUrl: `/api/admin/files/${item.designId}/${s.id}`,
    })),
    orderId: order.id,
    orderNumber: order.number,
    // The customer asked for one printed sample first (at checkout).
    sample: Boolean(item.sampleWanted || (item.approval && item.approval.sample)),
    position: index + 1,
    of: order.items.length,
    orderedAt: order.createdAt,
    customer: adminCustomer(order.customer),
    payment: order.payment,
    orderTotal: order.total,
    coupon: order.coupon ? { code: order.coupon.code, discount: order.discount || 0 } : null,
    redraw: item.redraw || null,
    sends: item.sends || [],
    imports: item.imports || null,
    rightsConfirmedAt: item.rightsConfirmedAt || null,
    // Sent back to Review after the customer approved it: why, by the team (not shown to the customer).
    ...(item.review && item.review.reopenReason ? { review: { ...publicItem(item).review, reasons: item.review.reasons || [], reopenReason: item.review.reopenReason, ...(item.review.reopenWarnings ? { reopenWarnings: item.review.reopenWarnings } : {}) } } : {}),
    approvals: item.approvals || [],
    // (The team sees who decided a shop's edit prints without asking.)
    approval: item.approval || null,
  };
}

/** A product drawing (its mockup SVG) in a colour, as a 640 px WebP picture (for products without a photo). */
const drawnCache = new Map();
async function drawnThumb(svgTpl, hex) {
  const key = svgTpl.length + '|' + hex + '|' + svgTpl.slice(0, 200);
  if (!drawnCache.has(key)) {
    const lum = (h) => {
      const n = parseInt(String(h).slice(1), 16);
      return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    };
    const line = lum(hex) < 0.25 ? '#8a8f98' : '#b9bdc4';
    const svg = svgTpl.replace(/\{\{C\}\}/g, hex).replace(/\{\{S\}\}/g, hex).replace(/\{\{L\}\}/g, line);
    drawnCache.set(key, (async () => {
      const png = await sharp()(Buffer.from(svg), { density: 192 }).png().toBuffer();
      const trimmed = await sharp()(png).trim({ threshold: 2 }).toBuffer();
      return sharp()(trimmed).resize(560, 560, { fit: 'contain', background: '#ffffff' }).extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#ffffff' }).flatten({ background: '#ffffff' }).webp({ quality: 86 }).toBuffer();
    })().catch(() => null));
  }
  return drawnCache.get(key);
}

/** Rows in one name list (copies of one design). */
const MERGE_MAX_ROWS = 1000;
/** Pieces of one design (one artwork in several sizes / colours). */
const MAX_PIECES = 1000;
/** Products sold in packs (cards, flyers, booklets): the most copies of one design online; more on WhatsApp (owner, 26 Nov). */
const MAX_PACK_COPIES = 10000;

/** Per-visitor limits; tests and special setups can override them. */
const DEFAULT_LIMITS = {
  designs: [{ max: 30, ms: 10 * 60e3 }, { max: 200, ms: 24 * 3600e3 }],
  designsAll: [{ max: 3000, ms: 24 * 3600e3 }],
  bookSaves: [{ max: 40, ms: 10 * 60e3 }, { max: 300, ms: 24 * 3600e3 }], // kids-book changes (each redraws pages)
  orders: [{ max: 5, ms: 10 * 60e3 }, { max: 20, ms: 24 * 3600e3 }],
  shares: [{ max: 10, ms: 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  views: [{ max: 30, ms: 60e3 }, { max: 300, ms: 24 * 3600e3 }], // view-only links, made and updated (every save)
  // AI cartoon faces for book previews (one image each): per visitor and for the whole shop.
  cartoon: [{ max: Number(process.env.CARTOON_DAILY_LIMIT) || 4, ms: 24 * 3600e3 }],
  cartoonAll: [{ max: Number(process.env.CARTOON_GLOBAL_DAILY_LIMIT) || 150, ms: 24 * 3600e3 }],
  // AI page redraws after orders (about 12-15 per book), for the whole shop.
  redrawAll: [{ max: Number(process.env.REDRAW_DAILY_PAGES) || 450, ms: 24 * 3600e3 }],
  // WhatsApp/email alerts for the whole shop, so fake orders cannot flood the owner's phone.
  notify: [{ max: 30, ms: 3600e3 }, { max: 200, ms: 24 * 3600e3 }],
  couponTry: [{ max: 15, ms: 10 * 60e3 }, { max: 60, ms: 24 * 3600e3 }], // coupon codes that didn't work, per visitor
  // "Prices changed" answers from placing an order, per visitor: they say whether a phone has had a once-per-customer
  // offer, so they can't be asked for without end (tester 1, 26 Nov).
  priceCheck: [{ max: 10, ms: 3600e3 }, { max: 30, ms: 24 * 3600e3 }],
  previewCode: [{ max: 10, ms: 15 * 60e3 }, { max: 40, ms: 24 * 3600e3 }], // private-preview codes that didn't work, per visitor
  staffSetup: [{ max: 10, ms: 15 * 60e3 }, { max: 40, ms: 24 * 3600e3 }], // team set-up links that didn't work, per visitor
  myPassword: [{ max: 5, ms: 15 * 60e3 }, { max: 20, ms: 24 * 3600e3 }], // wrong current passwords on "Change my password", per person
  designZip: [{ max: 20, ms: 3600e3 }, { max: 100, ms: 24 * 3600e3 }], // design zips uploaded in the admin
  notifyCustomer: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }], // order confirmations to one email address
  notifyCustomerAll: [{ max: 500, ms: 24 * 3600e3 }],
  // Illustrator / EPS files turned into pictures for the editor.
  artwork: [{ max: 15, ms: 10 * 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  mergeParse: [{ max: 30, ms: 10 * 60e3 }, { max: 150, ms: 24 * 3600e3 }],
  reorder: [{ max: 20, ms: 10 * 60e3 }, { max: 100, ms: 24 * 3600e3 }],
  reorderOrder: [{ max: 6, ms: 3600e3 }, { max: 12, ms: 24 * 3600e3 }], // per order (items can be ordered again one by one)
  reorderMB: 8000, // megabytes of files copied by "Order again" (and the cart's − / + copies), the whole shop, per day
  // Megabytes of view-only link pictures, the whole shop, per day (one visitor could add ~9 GB a day: QA 26 Nov).
  viewsMB: Number(process.env.VIEWS_DAILY_MB) || 3000,
  // Megabytes of booklet PDFs kept (45 days each) for the whole shop per day, so a few visitors can't
  // fill the disk (per visitor: the 'artwork' limit).
  pdfPagesMB: Number(process.env.PDF_PAGES_DAILY_MB) || 6000,
  draftSave: [{ max: 200, ms: 10 * 60e3 }],
  // AI background removal (about 2 s of server time each).
  removeBg: [{ max: 20, ms: 10 * 60e3 }, { max: 80, ms: 24 * 3600e3 }],
  importLink: [{ max: 20, ms: 10 * 60e3 }, { max: 100, ms: 24 * 3600e3 }],
  importImage: [{ max: 120, ms: 10 * 60e3 }, { max: 600, ms: 24 * 3600e3 }],
  takedown: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }],
  removeBgAll: [{ max: 1500, ms: 24 * 3600e3 }],
  // Customer accounts: sign-in attempts, new accounts, password-reset emails.
  accountLogin: [{ max: 10, ms: 15 * 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  oauthStart: [{ max: 40, ms: 15 * 60e3 }, { max: 400, ms: 24 * 3600e3 }], // Google/Facebook sign-in started (per IP)
  accountLoginId: [{ max: 10, ms: 3600e3 }],
  accountSignup: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }],
  accountForgot: [{ max: 5, ms: 3600e3 }],
  accountForgotId: [{ max: 3, ms: 3600e3 }, { max: 6, ms: 24 * 3600e3 }],
  // Printing houses downloading their files.
  downloads: [{ max: 200, ms: 3600e3 }],
};

function createApp({ dataDir, adminPassword, limits = {}, cleanupEvery = 6 * 3600e3, oauthConfig = {}, oauthFetch, importGet, requireApproval = true, captcha = captchaMod.fromEnv(), captchaFetch, libraryOnce = [], previewStart = false, prepayOnly = PREPAY_ONLY }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  // How the shop takes payment, for the pages' and messages' wording (src/payment-wording.js; tests set it here).
  const PAYMENT = Object.freeze({ prepayOnly: Boolean(prepayOnly) });
  const store = new Store(dataDir);
  const app = express();
  // Sign-in attempts (customers and admin) are counted in a file shared by every copy of the app,
  // so guessing passwords gets no extra tries from another copy or a restart.
  const signinLimiter = new security.SharedLimiter(path.join(dataDir, '.signin-limits.json'));
  const auth = new security.AdminAuth(adminPassword, { dataDir, store, limiter: signinLimiter });
  const LIMITS = { ...DEFAULT_LIMITS, ...limits };
  const memoryLimiter = new security.RateLimiter();
  const SHARED_LIMITS = new Set(['accountLogin', 'accountLoginId']);
  const limiterFor = (key) => (SHARED_LIMITS.has(String(key).split(':')[0]) ? signinLimiter : memoryLimiter);
  const limiter = { check: (k, r) => limiterFor(k).check(k, r), hit: (k, r) => limiterFor(k).hit(k, r) };
  /** Throws 429 when this visitor (or everyone, for `*` keys) did `what` too often. */
  /**
   * Shop-wide daily budgets for paid AI (shared by every copy of the app,
   * counted in the store under its lock): true if `n` more fit today.
   */
  const SHOP_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'Africa/Cairo' });
  /** Room left today in a shop-wide budget for n more (nothing taken). */
  const shopBudgetLeft = (name, max, n = 1) => {
    const u = (store.db.usage || {})[name];
    return !(u && u.day === SHOP_DAY.format(new Date()) && u.n + n > max);
  };
  const takeShopBudget = (name, max, n = 1) => store.mutate((db) => {
    db.usage ||= {};
    const day = SHOP_DAY.format(new Date());
    const u = db.usage[name] && db.usage[name].day === day ? db.usage[name] : { day, n: 0 };
    if (u.n + n > max) return false;
    db.usage[name] = { day, n: u.n + n };
    return true;
  });
  // Express 4 doesn't catch errors of async handlers: pass them on.
  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  /** The CAPTCHA token sent with a form (when the CAPTCHA is on). */
  const checkCaptcha = async (req) => {
    if (!captcha) return;
    const r = await captchaMod.verify(captcha, (req.body || {}).captchaToken, req.ip, captchaFetch ? { fetchImpl: captchaFetch } : {});
    if (!r.ok) throw new HttpError(400, 'captchaFailed');
  };
  /** Over the limit already? (nothing recorded) — for limits that count failures only. */
  const limitCheck = (req, what, key = req.ip) => {
    const wait = limiter.check(`${what}:${key}`, LIMITS[what]);
    if (typeof wait === 'number') throw new HttpError(429, wait > 90 ? 'tooManyWait' : 'tooFast', { min: Math.ceil(wait / 60) });
  };
  const limitHit = (what, key) => limiter.hit(`${what}:${key}`, LIMITS[what]);
  const rateLimit = (req, what, key = req.ip) => {
    const wait = limiter.hit(`${what}:${key}`, LIMITS[what]);
    if (wait) throw new HttpError(429, wait > 90 ? 'tooManyWait' : 'tooFast', { min: Math.ceil(wait / 60) });
  };

  /** The latest catalogue (product manager) and prices, laid over the products. */
  const syncCatalog = () => {
    if (catalog.apply(PRODUCTS, store.db.catalog)) {
      accounting.catalogChanged(PRODUCTS, EXTRA_SIDE_PRICE);
      libraryCatalogChanged();
    }
    accounting.applyPricing(PRODUCTS, store.db.pricing);
  };
  syncCatalog();
  app.disable('x-powered-by');
  // Hostinger runs the app behind its proxy and CDN: use the visitor's own IP
  // (from X-Forwarded-For) for the per-visitor limits.
  const tp = process.env.TRUST_PROXY || '';
  // Hostinger's proxy appends the real visitor address as the last
  // X-Forwarded-For entry, so trust exactly one hop: anything a visitor puts
  // in the header themselves is ignored.
  app.set('trust proxy', tp === 'false' ? false : tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : 1);
  app.use(security.securityHeaders);
  // The host may run several copies of the app: start every request from the latest saved data.
  app.use((req, res, next) => {
    store.sync();
    syncCatalog();
    next();
  });

  // How the hosting proxy passes the visitor's address, logged for the first
  // few page visits after a restart (to set TRUST_PROXY to the right hop count).
  let proxyLogs = 0;
  app.use((req, res, next) => {
    if (proxyLogs < 8 && req.method === 'GET' && !req.path.includes('.') && !req.path.startsWith('/api')) {
      proxyLogs++;
      console.log(`[proxy] xff="${String(req.get('x-forwarded-for') || '').slice(0, 200)}" real="${String(req.get('x-real-ip') || '').slice(0, 60)}" socket=${req.socket.remoteAddress} ip=${req.ip}`);
    }
    next();
  });

  // The dashboard's address however it is typed (/admin/, /Admin, /admin.html): the dashboard itself.
  app.get(/^\/admin(?:\.html)?\/?$/i, (req, res, next) => (req.path === '/admin' ? next() : res.redirect(301, '/admin')));

  // ---------- Private preview (src/preview.js) ----------
  // Until the shop opens to everyone, only invited people, the owner and staff get in.
  // The real shop starts private the first time it runs with this (server.js: previewStart).
  if (previewStart && !store.db.preview) store.mutate((db) => { db.preview ||= { on: true, people: [] }; });
  const previewOn = () => Boolean(store.db.preview && store.db.preview.on);
  const previewPeople = () => (store.db.preview && store.db.preview.people) || [];
  // The owner's cookie names the admin password (a new password shuts old cookies out); a staff
  // member's names their sign-in generation (a password reset by the owner does the same).
  const ownerWho = () => `owner-${crypto.createHmac('sha256', auth.key).update('preview-owner').digest('hex').slice(0, 12)}`;
  const staffWho = (u) => `s-${u.id}-${u.gen || 0}`;
  /** Who this request is let in as ('owner-…', 's-<staff>-<gen>', 'p-<person>'), or null. */
  function previewWho(req) {
    const token = security.bearer(req);
    if (token && auth.verify(token)) return ownerWho();
    const staff = token && auth.verifyStaff(token, staffList());
    if (staff) return staffWho(staff);
    const v = preview.verify(auth.previewKey, preview.cookieFrom(req));
    if (!v) return null;
    if (v.who.startsWith('owner-')) return v.who === ownerWho() ? v.who : null;
    if (v.who.startsWith('s-')) return staffList().some((u) => staffWho(u) === v.who) ? v.who : null;
    if (v.who.startsWith('p-')) return previewPeople().some((x) => x.id === v.who.slice(2) && !x.off) ? v.who : null;
    return null;
  }
  /**
   * A team member's (or the owner's) browser deciding for the customer from the customer's own link (the proof link or
   * the edit link shown in Review): refused, unless this browser has the order's key or the customer's account. The
   * shop decides for a customer in Review, with a note of how they confirmed (owner's decision, 25 Nov).
   */
  function teamActingAsCustomer(req, order) {
    const pw = previewWho(req);
    if (!pw || !(pw.startsWith('owner-') || pw.startsWith('s-'))) return false;
    return !(order.linkKey ? orderOpenFor(req, order) : false);
  }
  /**
   * Where to send someone back to on this site: a path starting with exactly one "/" (never
   * "//other.site" or "/\\other.site"), else the home page; `code` adds ?code=wrong / wait.
   */
  function previewBack(raw, code) {
    let u;
    try { u = new URL(String(raw || '/'), 'http://shop.invalid'); } catch (e) { u = null; }
    if (!u || u.origin !== 'http://shop.invalid' || !/^\/(?![\/\\])/.test(String(raw || '/'))) u = new URL('/', 'http://shop.invalid');
    u.searchParams.delete('invite');
    u.searchParams.delete('code');
    if (code) u.searchParams.set('code', code);
    return `${u.pathname}${u.search}`;
  }
  const previewCookie = (req, res, who) => res.append('Set-Cookie', preview.cookie(preview.sign(auth.previewKey, who), { secure: isHttps(req) }));
  /** A person's last visit (saved at most every 10 minutes; a gap of 30 minutes starts a new visit). */
  function previewSeen(who) {
    if (!who.startsWith('p-')) return;
    const p = previewPeople().find((x) => x.id === who.slice(2));
    const last = p && p.lastSeen ? Date.parse(p.lastSeen) : 0;
    if (!p || Date.now() - last < 10 * 60e3) return;
    store.mutate((db) => {
      const x = ((db.preview && db.preview.people) || []).find((y) => y.id === p.id);
      if (!x) return;
      if (Date.now() - (x.lastSeen ? Date.parse(x.lastSeen) : 0) > 30 * 60e3) x.visits = (x.visits || 0) + 1;
      x.lastSeen = new Date().toISOString();
    });
  }
  /**
   * An answer for someone let in while the shop is private is never kept for others by a shared cache: the hosting's
   * CDN (hcdn) ignores cookies, so a product picture an invited tester opened was handed to strangers without an
   * invitation (security review, 26 Nov). "public" becomes "private" (the browser still keeps it), and answers that
   * say nothing are "private, no-cache" (e.g. /api/products).
   */
  function privateWhilePreview(res) {
    const set = res.setHeader;
    res.setHeader = function setHeader(name, value) {
      if (String(name).toLowerCase() === 'cache-control') value = String(value).replace(/\bpublic\b/gi, 'private');
      return set.call(this, name, value);
    };
    res.setHeader('Cache-Control', 'private, no-cache');
  }
  /** Too many wrong codes from this visitor for now. */
  const previewWait = (req) => typeof limiter.check(`previewCode:${req.ip}`, LIMITS.previewCode) === 'number';
  /** The person with this code who may come in, or null. */
  const previewByCode = (code) => {
    const c = preview.normCode(code);
    return c ? previewPeople().find((x) => !x.off && x.code === c) || null : null;
  };
  /** The "Opening soon" page (or 403 for anything that isn't a page). */
  function previewClosed(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: format('previewOnly', {}, langOf(req)) });
    // (Only addresses of pages: a picture or file answers 403, whatever the browser accepts.)
    const pageLike = !/\.[a-z0-9]{1,5}$/i.test(req.path) || /\.html$/i.test(req.path);
    const html = (req.method === 'GET' || req.method === 'HEAD') && pageLike && req.accepts('html') && pageFor('coming-soon');
    if (!html) return res.status(403).type('text').send('');
    sendPage(res, 'coming-soon', html);
  }
  app.use((req, res, next) => {
    if (!previewOn()) return next();
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/robots.txt') return res.type('text').send('User-agent: *\nDisallow: /\n');
    // A personal link: https://<shop>/<any page>?invite=CODE
    if (req.method === 'GET' && typeof req.query.invite === 'string') {
      // (Never kept by the hosting's CDN: the answer carries this browser's own cookie.)
      res.set('Cache-Control', 'no-store');
      // (The address as sent, its other parameters kept as they were.)
      const back = previewBack(req.originalUrl);
      if (!previewWho(req)) {
        if (previewWait(req)) return res.redirect(303, previewBack(back, 'wait'));
        const person = previewByCode(req.query.invite);
        if (!person) {
          limitHit('previewCode', req.ip);
          return res.redirect(303, previewBack(back, 'wrong'));
        }
        previewCookie(req, res, `p-${person.id}`);
        previewSeen(`p-${person.id}`);
      }
      return res.redirect(303, back);
    }
    const who = previewWho(req);
    if (who) {
      // The owner or staff, signed in to the dashboard: their browser gets in too.
      // (Also when theirs is out of date: an older form, or a password changed since.)
      if (!who.startsWith('p-') && (preview.verify(auth.previewKey, preview.cookieFrom(req)) || {}).who !== who) previewCookie(req, res, who);
      previewSeen(who);
      privateWhilePreview(res);
      return next();
    }
    // (A path written with ".." or encoded slashes is never one of the open ones.)
    if (!/(?:^|\/)\.\.?(?:\/|$)|%2e|%2f|%5c|\\/i.test(req.path) && preview.isOpen(req.path)) return next();
    previewClosed(req, res);
  });
  // The code typed on the "Opening soon" page (a plain form: works without JavaScript).
  // `next`: the page the code was typed on, opened once they're in.
  app.post('/api/preview/enter', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const back = previewBack((req.body || {}).next);
    if (previewWait(req)) return res.redirect(303, previewBack(back, 'wait'));
    const person = previewOn() ? previewByCode((req.body || {}).code) : null;
    if (previewOn() && !person) {
      limitHit('previewCode', req.ip);
      return res.redirect(303, previewBack(back, 'wrong'));
    }
    if (person) {
      previewCookie(req, res, `p-${person.id}`);
      previewSeen(`p-${person.id}`);
    }
    res.redirect(303, back);
  });

  // ---------- Product card pictures ----------
  // The real photo recoloured to a product colour, made once on the server.
  app.get('/api/thumbs/:productId/:colorId.webp', async (req, res, next) => {
    try {
      const product = getProduct(req.params.productId);
      const color = product && product.colors.find((c) => c.id === req.params.colorId);
      if (!color) throw new HttpError(404, 'notFound');
      if (product.kind === 'book') return res.redirect(302, `/api/books/${product.book}/sample/0.jpg`);
      if (product.kind === 'photoset') return res.redirect(302, '/mockups/photoprints-card.webp');
      let img = product.pattern ? await thumbs.patternImage(product, color.hex) : await thumbs.cardImage(product.base || product.id, product.sides[0].id, color.hex);
      // No product photo yet: the drawn product in its colour, trimmed, on white.
      // Laser products: with a sample engraving (or cut piece) in the material's tone.
      const drawn = product.cardArt ? product.sides[0].svg.replace('</svg>', `${product.cardArt.replace(/\{\{I\}\}/g, color.ink || '#000000')}</svg>`) : product.sides[0].svg;
      if (!img && drawn) img = await drawnThumb(drawn, color.hex);
      if (!img) throw new HttpError(404, 'notFound');
      res.set('Cache-Control', 'public, max-age=86400, no-transform');
      res.type('image/webp').send(img);
    } catch (e) {
      next(e);
    }
  });

  // ---------- The shop's photos at the size they are shown (owner's OK, UX item D, 26 Nov) ----------
  // /img-w/480/lifestyle/mug.webp: public/img/lifestyle/mug.webp at most 480 px wide. The photos are 960–1600 px and
  // the home page shows them at 150–350 px, so phones downloaded ~14 MB of photos. Each copy is made once (kept in
  // the data folder, left out of backups) and made again when the photo itself changes.
  const SIZED_WIDTHS = new Set([320, 480, 800, 1200]);
  const SIZED_DIRS = new Set(['lifestyle', 'designed']);
  const sizedDir = path.join(dataDir, 'img-sized');
  const sizing = new Map();
  // (Also the shop's artwork, /img-w/320/art/christmas/trees.png: the Templates list drew its small pictures from
  // the print files, 2–3 MB each, owner 26 Nov: "artwork loading very slow". Transparent parts stay transparent.)
  const sizedPhoto = async (req, res, next, dir) => {
    try {
      const w = Number(req.params.w);
      const { file } = req.params;
      if (!SIZED_WIDTHS.has(w) || !dir || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,100}\.(webp|jpe?g|png)$/i.test(file) || file.includes('..')) throw new HttpError(404, 'notFound');
      const src = path.join(__dirname, '..', 'public', 'img', dir, file);
      let st;
      try { st = fs.statSync(src); } catch (e) { throw new HttpError(404, 'notFound'); }
      if (!st.isFile()) throw new HttpError(404, 'notFound');
      const out = path.join(sizedDir, String(w), dir, `${file.replace(/\.[^.]+$/, '')}-${Math.round(st.mtimeMs)}-${st.size}.webp`);
      if (!fs.existsSync(out)) {
        if (!sizing.has(out)) {
          sizing.set(out, (async () => {
            const buf = await sharp()(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
            fs.mkdirSync(path.dirname(out), { recursive: true });
            const tmp = `${out}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, out);
          })().finally(() => sizing.delete(out)));
        }
        await sizing.get(out);
      }
      res.set('Cache-Control', 'public, max-age=86400, no-transform');
      res.type('image/webp').sendFile(out);
    } catch (e) {
      next(e);
    }
  };
  app.get('/img-w/:w/art/:sub/:file', (req, res, next) => sizedPhoto(req, res, next, /^[a-z0-9-]{1,40}$/.test(req.params.sub) ? `art/${req.params.sub}` : null));
  // The size of each big piece of the shop's artwork (public/img/art/<folder>/<file>, wider than 1400 px): the editor
  // shows a 1200 px copy (/img-w/1200/art/...) and makes print files from the original, and its print check needs the
  // original's real size (owner, 26 Nov: artwork slow to appear on the product). Read once, from the files' headers.
  let artSizes = null;
  app.get('/api/art-sizes', async (req, res, next) => {
    try {
      if (!artSizes) {
        artSizes = (async () => {
          const root = path.join(__dirname, '..', 'public', 'img', 'art');
          const out = {};
          for (const sub of fs.readdirSync(root)) {
            if (!/^[a-z0-9-]{1,40}$/.test(sub) || !fs.statSync(path.join(root, sub)).isDirectory()) continue;
            for (const file of fs.readdirSync(path.join(root, sub))) {
              if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,100}\.(png|webp|jpe?g)$/i.test(file)) continue;
              try {
                const m = await sharp()(path.join(root, sub, file)).metadata();
                if (m.width > 1400) out[`${sub}/${file}`] = [m.width, m.height];
              } catch (e) { /* not a picture: left out */ }
            }
          }
          return out;
        })().catch((e) => { artSizes = null; throw e; });
      }
      res.set('Cache-Control', 'public, max-age=3600');
      res.json(await artSizes);
    } catch (e) {
      next(e);
    }
  });
  app.get('/img-w/:w/:dir/:file', (req, res, next) => sizedPhoto(req, res, next, SIZED_DIRS.has(req.params.dir) ? req.params.dir : null));

  // ---------- Catalog ----------
  // CAPTCHA (Cloudflare Turnstile, see src/captcha.js): the site key for the forms, null when off.
  app.get('/api/captcha', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ siteKey: captcha ? captcha.siteKey : null });
  });
  app.get('/api/products', (req, res) => {
    res.json({
      currency: CURRENCY,
      mockup: { width: MOCKUP_WIDTH, height: MOCKUP_HEIGHT },
      pricing: { extraSide: EXTRA_SIDE_PRICE, shipping: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER },
      delivery: { standardDays: DELIVERY_DAYS.standard, expressDays: DELIVERY_DAYS.express, expressFee: expressFee() },
      // Paying in advance only (from launch) or cash on delivery (the preview): the pages' wording.
      payment: { ...PAYMENT },
      categories: CATEGORIES,
      governorates: GOVERNORATES,
      contact: { whatsapp: notify.shopWhatsApp() || null },
      // The places for a customer's own details the shop's designs use ({Name}, {الاسم}…): the editor
      // says one is left unfilled, as the server does.
      fields: templateFields(),
      // Hidden, removed and sold-out products aren't in the shop (admin → Products).
      products: PRODUCTS.filter(catalog.visible).map((p) => publicProduct(catalog.forShop(p))),
    });
  });

  // The name of any product, also one not in the shop (saved drafts and carts name it), and where
  // it stands: 'live', 'paused' (back soon; `backOn` when it comes back on a set day), 'retired'
  // (no longer sold: the page offers similar products from the same category) or 'soldOut'.
  app.get('/api/products/:id/name', (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    const s = catalog.shopState(p);
    res.json({ id: p.id, name: p.name, category: p.category, available: s.state === 'live', state: s.state, ...(s.backOn ? { backOn: s.backOn } : {}) });
  });

  // ---------- Designs ----------
  // A design is one customised product, saved when the shopper adds it to
  // the cart. It is created in three steps so large print files travel as
  // plain binary uploads:
  //   1. POST   /api/designs                      layout + options -> id and upload token
  //   2. PUT    /api/designs/:id/files/:name      each PNG/SVG file
  //   3. POST   /api/designs/:id/complete         checks files, embeds colour profile + DPI
  // ---------- Proofs, approval and review ----------
  // A proof is what the customer approves: product, colour, size, pieces,
  // every printed side at its physical size and the production file itself.
  // The approval is recorded against a fingerprint (proofHash) of all of it;
  // production files are refused if they no longer match, and any change
  // after approval needs a new approval.
  let preflightModule = null;
  const pf = () => {
    try {
      return (preflightModule ||= require('./preflight'));
    } catch (e) {
      return null;
    }
  };
  /**
   * What the customer approves: a version of the design. Every material change after the
   * order (a corrected file from the shop, a redrawn book page) makes a new version.
   * Sent and checked as `proofHash` ("v3").
   */
  const proofHashOf = (d) => `v${d.version || 1}`;
  const LARGE_ORDER = 50;
  /** Why a design needs the shop to look at it before printing (empty: approval at checkout is enough). */
  function reviewReasons(d, { sample = false } = {}) {
    const r = [];
    if (d.preflight && d.preflight.status === 'fail') r.push('preflight');
    if (d.merge) r.push('nameList');
    if (d.method === 'embroidery') r.push('embroidery');
    if (d.imports && d.imports.length) r.push('imported');
    // Photo sets are many prints by nature: no check by hand just for the number.
    if (copiesOf(d) >= LARGE_ORDER && d.kind !== 'photoset') r.push('bulk');
    if (sample) r.push('sample');
    return r;
  }
  /** The automatic checks of a design's print files (and the editor's own report), kept on the design. */
  async function runPreflight(d) {
    const mod = pf();
    if (d.kind === 'photoset') {
      // Photos too small for their print size (worked out by the photos page from the original).
      const product = getProduct(d.productId);
      const min = (product && product.photo && product.photo.lowDpi) || 150;
      const low = d.photos.filter((p) => p.dpi && p.dpi < min);
      d.preflight = { status: low.length ? 'warn' : 'pass', checks: low.length ? [{ id: 'photoLowRes', level: 'warn', params: { count: low.length, photos: low.map((p) => p.n).join(', ') } }] : [], at: new Date().toISOString() };
      return d.preflight;
    }
    if (!mod || d.kind === 'book' || d.kind === 'gangsheet') {
      d.preflight = { status: 'pass', checks: [], at: new Date().toISOString() };
      return d.preflight;
    }
    try {
      let result = await mod.preflight(d, { readFile: (name) => fs.readFileSync(store.designFile(d.id, name)), product: getProduct(d.productId) });
      if (d.clientChecks && mod.mergeClientChecks) result = mod.mergeClientChecks(result, d.clientChecks);
      d.preflight = { ...result, at: new Date().toISOString() };
    } catch (e) {
      console.warn('[preflight]', d.id, e.message);
      d.preflight = { status: 'warn', checks: [{ id: 'checkFailed', level: 'warn', params: {} }], at: new Date().toISOString() };
    }
    return d.preflight;
  }
  // Big pictures take a lot of memory while they are read: at most two such jobs at a time.
  let heavyRunning = 0;
  const heavyWaiting = [];
  async function heavy(fn) {
    while (heavyRunning >= 2) await new Promise((resolve) => heavyWaiting.push(resolve));
    heavyRunning++;
    try {
      return await fn();
    } finally {
      heavyRunning--;
      const next = heavyWaiting.shift();
      if (next) next();
    }
  }
  /** A small picture of each side's production file (the artwork exactly as printed) for proofs. */
  async function makeProofImages(d) {
    if (d.kind === 'book' || d.kind === 'gangsheet' || d.kind === 'photoset') return;
    for (const sd of d.sides) {
      try {
        const out = await sharp()(fs.readFileSync(store.designFile(d.id, `${sd.id}-print.png`)), { limitInputPixels: 130e6 })
          .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 8 }).toBuffer();
        store.writeDesignFile(d.id, `${sd.id}-proof.png`, out);
      } catch (e) {
        console.warn('[proof image]', d.id, sd.id, e.message);
      }
    }
  }
  /** The proof as the customer and the shop see it (see the shared contract). */
  async function proofFor(d, item = null) {
    const product = getProduct(d.productId);
    if (!d.preflight && d.kind !== 'book') {
      await runPreflight(d);
      store.save();
    }
    if (d.kind !== 'book' && d.kind !== 'gangsheet' && !fs.existsSync(store.designFile(d.id, `${d.sides[0].id}-proof.png`))) await makeProofImages(d);
    const list = d.merge ? readMergeList(d) : null;
    const side = (sd) => {
      const def = product && product.sides.find((x) => x.id === sd.id);
      return {
        id: sd.id, name: sd.name, widthIn: sd.widthIn, heightIn: sd.heightIn, bleedIn: sd.bleedIn || 0, safeIn: def ? def.safeIn || 0 : 0,
        ...(sd.process ? { process: sd.process } : {}),
        dpi: sd.dpi || null, widthPx: sd.widthPx || null, heightPx: sd.heightPx || null,
        artworkUrl: d.kind === 'gangsheet' ? `/files/designs/${d.id}/front-preview.png?v=${d.version || 1}` : `/files/designs/${d.id}/${sd.id}-proof.png?v=${d.version || 1}`,
        previewUrl: d.kind === 'book' ? `/files/designs/${d.id}/book-preview.png?v=${d.version || 0}`
          : d.replaced && d.replaced[sd.id] ? null : `/files/designs/${d.id}/${sd.id}-preview.png`,
      };
    };
    return {
      designId: d.id,
      version: d.version || 1,
      proofHash: proofHashOf(d),
      product: product ? { id: product.id, name: product.name, ...(product.colorLabel ? { colorLabel: product.colorLabel } : {}) } : { id: d.productId, name: d.productName },
      color: d.color, size: d.size, quantities: withoutLinePrices(withPacks(d.productId, d.quantities)), copies: copiesOf(d),
      // (An ordered item's method: the shop may have switched it between DTG and DTF. QA 26 Nov.)
      method: d.method || 'print', process: (item && item.process && item.process !== 'embroidery' && d.method !== 'embroidery' ? item.process : null) || d.process || (product && product.process) || null,
      ...(embSideOf(d) ? { embSide: embSideOf(d) } : {}),
      sides: d.kind === 'book' ? [] : d.sides.map(side),
      ...(d.kind === 'book' ? { pages: bookFor(d.bookId).pages.map((_, i) => `/api/books/designs/${d.id}/pages/${i}.jpg?v=${d.version || 0}`) } : {}),
      ...(list ? { merge: { count: d.merge.count, columns: list.columns, sample: list.rows.slice(0, 3) } } : {}),
      ...(d.kind === 'photoset' ? { photos: d.photos.map((p) => ({ n: p.n, size: p.size, copies: p.copies, orientation: p.orientation, dpi: p.dpi, url: `/files/designs/${d.id}/photos/${p.n}.jpg?v=${d.version || 1}` })), options: d.options || null } : {}),
      preflight: d.preflight ? { status: d.preflight.status, checks: d.preflight.checks } : { status: 'pass', checks: [] },
      review: { needed: reviewReasons(d).length > 0, reasons: reviewReasons(d) },
      // A ready design added as it is: taken as approved at checkout, no tick (see readyDesign).
      ...(readyDesign(d) ? { ready: true } : {}),
    };
  }
  /** A ready design from the shop's library, unchanged (POST /api/designs marks it `readyFrom`) and not changed since. */
  const readyDesign = (d) => Boolean(d && d.readyFrom && (d.version || 1) === 1 && !d.kind && !d.merge);
  app.get('/api/designs/:id/proof', async (req, res, next) => {
    try {
      const d = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
      if (!d || (d.status && d.status !== 'ready')) throw new HttpError(404, 'designNotFound');
      res.set('Cache-Control', 'no-store');
      const proof = await proofFor(d);
      // (The first names of a name list only for who may read the list.)
      if (proof.merge && proof.merge.sample && !listOpenFor(req, d)) proof.merge = { ...proof.merge, sample: [] };
      res.json(proof);
    } catch (e) {
      next(e);
    }
  });
  /** The approval as recorded on an order item, and its history entry. */
  function recordApproval(item, d, { via, sample = false, note = null }) {
    const now = new Date().toISOString();
    const proofHash = proofHashOf(d);
    item.approval = { proofHash, version: d.version || 1, at: now, by: 'customer', via, sample: Boolean(sample) };
    item.approvals = [...(item.approvals || []), { action: 'approved', by: 'customer', via, at: now, proofHash, version: d.version || 1, ...(note ? { note } : {}) }];
  }
  /** Is the design still the version the customer approved? */
  function approvedFilesMatch(item, d) {
    if (!item.approval) return true; // orders from before approvals existed
    return item.approval.proofHash === proofHashOf(d);
  }
  /** A link the customer can open to approve a new proof (kept on the item until used). */
  function newProofLink(item) {
    item.proofToken = crypto.randomBytes(18).toString('base64url');
    item.proofTokenAt = new Date().toISOString();
    return `/proof?t=${item.proofToken}`;
  }
  /**
   * "Edit it and send it again" for an item waiting for the customer's changes, without the order's key: a link
   * for that item only (the editor, then the new version). The shop can pass it on by WhatsApp (a customer with
   * no email), and the proof page gives it after "Ask for changes". It opens no amounts and no other item.
   */
  function newReviseLink(item) {
    item.reviseToken = crypto.randomBytes(18).toString('base64url');
    return reviseLinkOf(null, item);
  }
  function reviseLinkOf(order, item) {
    if (!item.reviseToken || item.status !== 'changes_requested' || item.kind || !UUID_RE.test(item.designId || '')) return null;
    const o = order || store.findItem(item.id)?.order;
    return o ? `/editor?design=${item.designId}&revise=${o.id}.${item.id}&rt=${item.reviseToken}` : null;
  }
  const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const LIST_KEY_RE = /^[A-Za-z0-9_-]{20,40}$/;
  /**
   * Who may read a design's name list (customers' names): the key kept with its cart item (x-list-key), the team
   * (signed in), the order's own link or account, or the item's "edit and send again" link. Not the design's id alone,
   * which is in public picture links (owner's OK, 26 Nov, from the security review).
   */
  function listOpenFor(req, design) {
    if (!design || !design.merge) return false;
    const k = String(req.get('x-list-key') || '');
    if (design.listKeyHash && LIST_KEY_RE.test(k) && sameSecret(sha(k), design.listKeyHash)) return true;
    const tok = security.bearer(req);
    if (tok && (auth.verify(tok) || auth.verifyStaff(tok, staffList()))) return true;
    const order = design.orderId && store.getOrder(design.orderId);
    if (order && order.linkKey && orderOpenFor(req, order)) return true;
    const rt = String(req.get('x-revise-token') || '');
    if (order && rt && order.items.some((it) => it.designId === design.id && it.reviseToken && sameSecret(rt, it.reviseToken))) return true;
    return false;
  }
  function findByProofToken(token) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ''))) return null;
    for (const order of store.listOrders()) {
      for (const item of order.items) {
        if (item.proofToken && item.proofToken.length === token.length && crypto.timingSafeEqual(Buffer.from(item.proofToken), Buffer.from(token))) return { order, item };
      }
    }
    return null;
  }
  /**
   * The shop's address for links in emails: SITE_URL, else this request's host only when it is
   * one of the shop's own (ALLOWED_HOSTS, default ebda3.me and www, plus localhost). Anyone can
   * send any Host header, and a reset link pointing at their site would hand them the account.
   */
  const SHOP_HOSTS = String(process.env.ALLOWED_HOSTS || 'ebda3.me,www.ebda3.me').toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
  const linkBase = (req) => {
    if (notify.siteUrl()) return notify.siteUrl();
    const host = String(req.get('host') || '').toLowerCase();
    const ok = SHOP_HOSTS.includes(host) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    return ok ? `${isHttps(req) ? 'https' : 'http'}://${host}` : '';
  };
  const siteOf = (req) => linkBase(req);
  /** Email the customer a proof to approve, or the shop's request for changes (never blocks the request). */
  function tellCustomer(order, item, kind, note, req) {
    if (typeof notify.proofMessage !== 'function') return;
    const orderLink = notify.orderLink(siteOf(req), order);
    // (The customer's proof link carries the order's key: "back to my order" works from any phone. The shop's
    // own copy of the proof link, in Review, has no key.)
    const link = item.proofToken ? `${siteOf(req)}/proof?t=${item.proofToken}${order.linkKey ? `&k=${order.linkKey}` : ''}` : orderLink;
    Promise.resolve().then(() => notify.proofMessage(order, item, { kind, note, link, orderLink, siteUrl: siteOf(req) }))
      .then((r) => {
        item.proofEmails = [...(item.proofEmails || []), { kind, at: new Date().toISOString(), ...(r || {}) }].slice(-10);
        store.save();
      })
      .catch((e) => console.warn('[notify] proof email failed:', e.message));
  }
  /** Admin view of an item with its proof. */
  async function reviewItem(order, item) {
    const d = store.getDesign(item.designId);
    return {
      ...adminItem(order, item, order.items.indexOf(item)),
      proof: d ? await proofFor(d, item) : null,
      proofLink: item.proofToken ? `/proof?t=${item.proofToken}` : null,
      // The shop's edit waiting for an owner to say it prints without asking (so nobody edits it twice meanwhile).
      ...(() => {
        const a = (store.db.approvals || []).find((x) => x.status === 'pending' && x.action === 'POST /api/admin/items/:itemId/shop-edit/print' && String(x.path || '').includes(`/items/${item.id}/`));
        return a ? { shopEditWaiting: { id: a.id, at: a.at, by: a.by && a.by.name } } : {};
      })(),
      reviseLink: reviseLinkOf(order, item),
      filesMatchApproval: d ? approvedFilesMatch(item, d) : false,
    };
  }

  // Customer: open a proof link, approve it or ask for changes.
  app.get('/api/proofs/:token', async (req, res, next) => {
    try {
      const found = findByProofToken(req.params.token);
      if (!found) throw new HttpError(404, 'proofNotFound');
      const { order, item } = found;
      const d = store.getDesign(item.designId);
      if (!d) throw new HttpError(404, 'proofNotFound');
      res.set('Cache-Control', 'no-store');
      const reviseLink = item.status === 'changes_requested' ? reviseLinkOf(order, item) : null;
      const team = teamActingAsCustomer(req, order);
      res.json({ ...(team ? { team: true } : {}), order: { id: order.id, number: order.number }, item: { id: item.id, position: order.items.indexOf(item) + 1, productName: item.productName }, proof: await proofFor(d, item), note: (item.review && item.review.note) || null, status: item.status, ...(reviseLink ? { reviseLink } : {}) });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/proofs/:token', express.json({ limit: '8kb' }), (req, res) => {
    const found = findByProofToken(req.params.token);
    if (!found) throw new HttpError(404, 'proofNotFound');
    const { order, item } = found;
    if (item.status !== 'awaiting_approval') throw new HttpError(409, 'proofDone');
    if (teamActingAsCustomer(req, order)) throw new HttpError(403, 'proofTeam');
    const d = store.getDesign(item.designId);
    const b = req.body || {};
    const comment = String(b.comment || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 1000);
    const now = new Date().toISOString();
    if (b.decision === 'approve') {
      if (b.proofHash && b.proofHash !== proofHashOf(d)) throw new HttpError(409, 'proofChanged', { designId: d.id });
      // A sample asked for at checkout stays asked for with the new approval.
      recordApproval(item, d, { via: 'proof-link', note: comment || null, sample: Boolean(item.sampleWanted || (item.approval && item.approval.sample)) });
      if (d.preflight && d.preflight.status === 'fail') {
        // A version whose automatic check failed ("nothing to print here") waits for the team, as the proof page says
        // ("our team will check this before printing"): it went straight to the print queue. QA 25 Nov.
        item.status = 'review';
        item.review = { ...(item.review || {}), needed: true, reasons: [...new Set([...((item.review && item.review.reasons) || []), 'preflight'])], status: 'pending' };
      } else {
        item.status = 'queued';
        item.review = { ...(item.review || { needed: false, reasons: [] }), status: 'done' };
      }
    } else if (b.decision === 'reject') {
      // (What to change, in words: an empty or invisible-only comment gives the shop nothing to act on. QA 25 Nov.)
      if (!noteText(comment, 1000)) throw new HttpError(400, 'noteRequired');
      item.status = 'changes_requested';
      newReviseLink(item);
      item.approvals = [...(item.approvals || []), { action: 'rejected', by: 'customer', at: now, proofHash: proofHashOf(d), version: d.version || 1, note: comment || null }];
    } else {
      throw new HttpError(400, 'badDecision');
    }
    item.history.push({ status: item.status, at: now });
    // (The link stays: opened again it shows the decision, and after "Ask for changes" the edit link again — it said
    // "no longer works" on a reload. QA 25 Nov. A new proof gets a new link.)
    store.save();
    // Changes asked for: can the customer make them in the editor from their order page? (Same rule as there;
    // the proof page has no key to ask the order itself.)
    const editable = item.status === 'changes_requested' && !item.kind && UUID_RE.test(item.designId || '');
    res.json({ status: item.status, orderId: order.id, editable, ...(editable ? { reviseLink: reviseLinkOf(order, item) } : {}) });
  });

  // Shop: the jobs that need a person, and what they can do with them.
  const adminOnly = (req, res, next) => requireAdmin(req, res, next);
  app.get('/api/admin/review', adminOnly, async (req, res, next) => {
    try {
      const items = [];
      for (const order of store.listOrders()) {
        for (const item of order.items) if (REVIEW_STATUSES.includes(item.status)) items.push(await reviewItem(order, item));
      }
      items.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.position - b.position);
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/admin/items/:itemId/review', adminOnly, express.json({ limit: '8kb' }), async (req, res, next) => {
    try {
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      const { order, item } = found;
      // (No decision while a corrected file for it is being saved: it would be about the file before. QA 25 Nov.)
      if (replacingItems.has(item.id)) throw new HttpError(409, 'fileBeingReplaced');
      const d = store.getDesign(item.designId);
      const b = req.body || {};
      // (Invisible marks only isn't a note: a required note has to say something. QA 25 Nov.)
      const rawNote = String(b.note || '').trim().slice(0, 2000);
      const note = noteText(rawNote, 2000);
      const now = new Date().toISOString();
      if (b.action === 'reopen') {
        // An item the customer approved, that can't be printed as it is (owner's request, 25 Nov): back to Review,
        // where the shop fixes the file (the customer approves the new proof) or asks the customer for a change.
        // Waiting to print or on the press only; printed or shipped jobs are not sent back. The reason is the team's:
        // the customer hears nothing until the shop sends the new proof or the change request.
        if (!['queued', 'printing'].includes(item.status)) throw new HttpError(409, 'reopenNotNow');
        if (filmMaking.has(item.id)) throw new HttpError(409, 'filmBeingMade');
        if (!note) throw new HttpError(400, 'noteRequired');
        const warnings = [];
        // One warning per printing house (its latest send): the same house sent the job twice was told twice (QA 26 Nov).
        const byHouse = new Map();
        for (const sd of (item.sends || []).filter((x) => x.status === 'sent' || x.status === 'opened')) byHouse.set(sd.houseId || sd.houseName, sd);
        for (const sd of [...byHouse.values()].slice(-3)) warnings.push({ kind: 'house', house: sd.houseName, at: sd.at });
        if (item.filmBatch) warnings.push({ kind: 'film', film: item.filmBatch.id, at: item.filmBatch.at });
        item.status = 'review';
        // (The printing house or film to stop stays with the job, on its Review card: it was only a 5-second toast.)
        item.review = { needed: true, reasons: [...new Set(['reopened', ...((item.review && item.review.reasons) || [])])], status: 'pending', reopenReason: note, ...(warnings.length ? { reopenWarnings: warnings } : {}) };
        item.approvals = [...(item.approvals || []), { action: 'reopened', by: 'shop', at: now, note, proofHash: d ? proofHashOf(d) : null, version: d ? d.version || 1 : null, ...(warnings.length ? { warnings } : {}) }];
        // A film made with the old artwork can't be used for it: it goes on a new film once approved again.
        delete item.filmBatch;
        item.history.push({ status: item.status, at: now });
        store.save();
        return res.json({ ...(await reviewItem(order, item)), warnings });
      }
      // Only a job that is waiting for review (a Review tab left open must not send a shipped job back).
      if (!REVIEW_STATUSES.includes(item.status)) throw new HttpError(409, 'notInReview');
      if (b.action === 'approve' && item.status === 'awaiting_approval' && d) {
        // The proof is with the customer and they confirmed another way (WhatsApp, a call), as the Review card says:
        // approved by the shop for them, with the note of how. Their proof link isn't replaced and they aren't sent
        // a second proof (it made a new link and killed the first: QA 25 Nov).
        if (!note) throw new HttpError(400, 'confirmNoteRequired');
        recordApproval(item, d, { via: 'shop', note, sample: Boolean(item.sampleWanted || (item.approval && item.approval.sample)) });
        item.approval.by = 'shop';
        item.approvals[item.approvals.length - 1].by = 'shop';
        item.status = 'queued';
        item.review = { ...(item.review || { reasons: [] }), needed: true, status: 'done' };
      } else if (b.action === 'approve') {
        // The customer was asked for changes (they have an edit link): printing it as it is needs a note saying why,
        // like a version the customer confirmed another way. (It went to print with no word. QA 26 Nov.)
        if (item.status === 'changes_requested' && !note) throw new HttpError(400, 'changesApproveNote');
        // Printed only from what the customer approved; otherwise they get the proof first.
        if (item.approval && d && approvedFilesMatch(item, d)) item.status = 'queued';
        else {
          item.status = 'awaiting_approval';
          newProofLink(item);
          tellCustomer(order, item, 'proof', note, req);
        }
        item.review = { ...(item.review || { reasons: [] }), needed: true, status: 'done', ...(note ? { note } : {}) };
        item.approvals = [...(item.approvals || []), { action: 'reviewed', by: 'shop', at: now, proofHash: d ? proofHashOf(d) : null, version: d ? d.version || 1 : null, ...(note ? { note } : {}) }];
      } else if (b.action === 'changes') {
        // (Kids' books and photo prints aren't made in the editor: the customer has nothing to change them with. The
        // shop replaces the photo in Review instead. QA 25 Nov.)
        if (item.kind) throw new HttpError(409, 'changesNotForKind');
        if (!note) throw new HttpError(400, 'noteRequired');
        item.status = 'changes_requested';
        newReviseLink(item);
        item.review = { ...(item.review || { reasons: [] }), needed: true, status: 'pending', note };
        item.approvals = [...(item.approvals || []), { action: 'changes', by: 'shop', at: now, note, proofHash: d ? proofHashOf(d) : null, version: d ? d.version || 1 : null }];
        tellCustomer(order, item, 'changes', note, req);
      } else {
        throw new HttpError(400, 'badDecision');
      }
      item.history.push({ status: item.status, at: now });
      store.save();
      res.json(await reviewItem(order, item));
    } catch (e) {
      next(e);
    }
  });
  // The shop fixes the artwork: a corrected print file (same size), kept as a new version; the customer approves it.
  // While one is processed (a second or two), the job can't start printing or get another file (QA 25 Nov).
  // Kept in a lock file per job in the data folder too, so every copy of the app sharing it sees it (QA 26 Nov: on a
  // second copy, "start printing" went through while the file was being swapped, then was silently undone; a job sent
  // back to Review there during a film stayed on the film). A copy that stopped mid-way leaves one: older than 10
  // minutes, it no longer counts.
  const locksDir = path.join(dataDir, 'locks');
  fs.mkdirSync(locksDir, { recursive: true });
  const itemLocks = (kind) => {
    const mine = new Set();
    const file = (id) => path.join(locksDir, `${kind}-${String(id).replace(/[^\w-]/g, '')}`);
    return {
      has: (id) => {
        if (mine.has(id)) return true;
        try {
          return Date.now() - fs.statSync(file(id)).mtimeMs < 10 * 60e3;
        } catch (e) {
          return false;
        }
      },
      add: (id) => {
        mine.add(id);
        try { fs.writeFileSync(file(id), String(process.pid)); } catch (e) { /* this copy still knows */ }
      },
      delete: (id) => {
        mine.delete(id);
        fs.rmSync(file(id), { force: true });
      },
    };
  };
  const replacingItems = itemLocks('replacing');
  // Jobs being put on a DTF film right now (the film route): not sent back to Review until it's made.
  const filmMaking = itemLocks('film');
  app.put('/api/admin/items/:itemId/replacement/:side', adminOnly, express.raw({ type: () => true, limit: '60mb' }), async (req, res, next) => {
    let marked = null;
    // (Held until the new file is fully saved, not until the connection closes: a dropped connection let the job
    // start printing while the file was still being swapped. QA 25 Nov.)
    try {
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      const { order, item } = found;
      const d = store.getDesign(item.designId);
      const sd = d && d.kind !== 'book' && d.kind !== 'gangsheet' && d.kind !== 'photoset' && d.sides.find((x) => x.id === req.params.side);
      if (!sd) throw new HttpError(404, 'notFound');
      if (['printing', 'printed', 'shipped'].includes(item.status)) throw new HttpError(409, 'alreadyPrinting');
      if (replacingItems.has(item.id)) throw new HttpError(409, 'fileBeingReplaced');
      // A side with the customer's name list: its files are made per name, so one picture can't replace it.
      if (d.merge && d.merge.sides && d.merge.sides[sd.id]) throw new HttpError(409, 'replaceNames');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badImage');
      if (buf.readUInt32BE(16) !== sd.widthPx || buf.readUInt32BE(20) !== sd.heightPx) throw new HttpError(400, 'replacementSize', { w: sd.widthPx, h: sd.heightPx });
      replacingItems.add(item.id);
      marked = item.id;
      // A second side corrected before the customer answered (front, then back): the same proof link, which shows
      // the latest files, and no second message within 10 minutes; the notes of what changed go together. QA 25 Nov.
      const proofOpen = item.status === 'awaiting_approval' && Boolean(item.proofToken);
      const toldRecently = proofOpen && item.shopProofAt && Date.now() - Date.parse(item.shopProofAt) < 10 * 60 * 1000;
      const noteBefore = proofOpen && item.review && item.review.note ? String(item.review.note) : '';
      // What the shop changed, for the customer (with the new proof, in the email and on the proof page).
      let changeNote = '';
      try { changeNote = decodeURIComponent(String(req.get('x-review-note') || '')).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000); } catch (e) { changeNote = ''; }
      if (!noteText(changeNote, 1000)) changeNote = '';
      // The old file stays, so every version that was ever approved can be found again.
      const v = d.version || 1;
      const cur = store.designFile(d.id, `${sd.id}-print.png`);
      if (fs.existsSync(cur)) fs.copyFileSync(cur, store.designFile(d.id, `${sd.id}-print.v${v}.png`));
      let png = buf;
      try {
        png = await printfiles.finalizePrintPng(buf, sd.dpi);
      } catch (e) { /* keep as sent */ }
      store.writeDesignFile(d.id, `${sd.id}-print.png`, png);
      // Files made from the old version are out of date.
      for (const name of fs.readdirSync(store.designDir(d.id))) {
        if (name.startsWith(`${sd.id}-print`) && name !== `${sd.id}-print.png` && !/\.v\d+\.png$/.test(name)) fs.rmSync(store.designFile(d.id, name), { force: true });
        // DTF film, DTG underbase and laser files are made from the print file too.
        if (name.startsWith(`${sd.id}-dtf-`) || name.startsWith(`${sd.id}-dtg-`) || [`${sd.id}-laser.svg`, `${sd.id}-engrave.png`, `${sd.id}-cut.svg`].includes(name)) fs.rmSync(store.designFile(d.id, name), { force: true });
        if (/^preview-v\d+\.pdf$/.test(name)) fs.rmSync(store.designFile(d.id, name), { force: true });
        // …and the embroidery stitch file and the name-list print files.
        if (name.startsWith(`${sd.id}-stitches.`) || /^merge-(print(-marks)?\.pdf|copies\.zip|names\.zip)$/.test(name)) fs.rmSync(store.designFile(d.id, name), { force: true });
      }
      d.version = v + 1;
      // Embroidery: stitched again from the new artwork (thread colours and stitch count with it).
      if (sd.id === embSideOf(d)) item.emb = await makeEmbroidery(d);
      // The customer's vector file shows the old artwork: it stays on disk but is no longer offered.
      sd.hasSvg = false;
      // The product mockup still shows the old artwork: proofs show only the print file for this side.
      d.replaced = { ...(d.replaced || {}), [sd.id]: d.version };
      await makeProofImages(d);
      await runPreflight(d);
      const now = new Date().toISOString();
      // A printed sample first, if asked for at checkout, stays asked for.
      if (item.approval && item.approval.sample) item.sampleWanted = true;
      item.replaced = { ...(item.replaced || {}), [sd.id]: d.version };
      item.approval = null;
      item.status = 'awaiting_approval';
      if (changeNote) {
        const together = toldRecently && noteBefore && !noteBefore.split('\n').includes(changeNote) ? `${noteBefore}\n${changeNote}`.slice(0, 2000) : changeNote;
        item.review = { ...(item.review || { needed: true, reasons: [] }), note: together };
      }
      item.approvals = [...(item.approvals || []), { action: 'changes', by: 'shop', at: now, replaced: true, proofHash: proofHashOf(d), version: d.version, side: sd.id, ...(changeNote ? { note: changeNote } : {}) }];
      item.preflight = d.preflight;
      item.history.push({ status: item.status, at: now });
      if (!proofOpen) newProofLink(item);
      if (!toldRecently) item.shopProofAt = now;
      store.save();
      if (!toldRecently) tellCustomer(order, item, 'proof', (item.review && item.review.note) || '', req);
      if (marked) { replacingItems.delete(marked); marked = null; }
      res.json(await reviewItem(order, item));
    } catch (e) {
      next(e);
    } finally {
      if (marked) replacingItems.delete(marked);
    }
  });
  // ---------- A photo the shop replaces: photo prints and kids' books (owner's decision, 25 Nov) ----------
  // These aren't made in the editor, so "Problem with this file?" had no way out: no print file to correct, and
  // nothing for the customer to change. The team gets a better photo (usually by WhatsApp) and puts it in here with
  // a note of what changed; the customer approves the new proof, as for a corrected print file.
  //   Photo prints: one photo (n = 1, 2…), cut to its print size as the shop's photo page does.
  //   Kids' books: the child's photo (n = face); the AI drawings are made again from it, within the shop's budget.
  app.put('/api/admin/items/:itemId/photo/:n', adminOnly, express.raw({ type: () => true, limit: '25mb' }), async (req, res, next) => {
    let marked = null;
    try {
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      const { order, item } = found;
      const d = store.getDesign(item.designId);
      if (!d || !['photoset', 'book'].includes(d.kind)) throw new HttpError(404, 'notFound');
      if (['printing', 'printed', 'shipped'].includes(item.status)) throw new HttpError(409, 'alreadyPrinting');
      if (replacingItems.has(item.id) || filmMaking.has(item.id)) throw new HttpError(409, 'fileBeingReplaced');
      const photo = d.kind === 'photoset' ? (d.photos || []).find((p) => String(p.n) === req.params.n) : req.params.n === 'face' ? {} : null;
      if (!photo) throw new HttpError(404, 'notFound');
      let changeNote = '';
      try { changeNote = decodeURIComponent(String(req.get('x-review-note') || '')).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000); } catch (e) { changeNote = ''; }
      if (!noteText(changeNote, 1000)) throw new HttpError(400, 'photoNoteNeeded');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let meta;
      try {
        meta = await sharp()(buf, { limitInputPixels: 80e6 }).metadata();
      } catch (e) { meta = null; }
      if (!meta || !meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif', 'gif', 'tiff'].includes(meta.format)) throw new HttpError(400, 'badImage');
      replacingItems.add(item.id);
      marked = item.id;
      // (A second photo before the customer answered: the same proof link and, within 10 minutes, one message.)
      const proofOpen = item.status === 'awaiting_approval' && Boolean(item.proofToken);
      const toldRecently = proofOpen && item.shopProofAt && Date.now() - Date.parse(item.shopProofAt) < 10 * 60 * 1000;
      const noteBefore = proofOpen && item.review && item.review.note ? String(item.review.note) : '';
      const v = d.version || 1;
      const keepOld = (name) => {
        const cur = store.designFile(d.id, name);
        if (fs.existsSync(cur)) fs.copyFileSync(cur, store.designFile(d.id, name.replace(/\.(\w+)$/, `.v${v}.$1`)));
      };
      let what;
      if (d.kind === 'photoset') {
        // Its print size, filled (as the photo page crops), at 300 DPI; its small picture; the contact sheet again.
        keepOld(photo.file);
        const jpg = await sharp()(buf, { limitInputPixels: 80e6 }).rotate().resize(photo.px[0], photo.px[1], { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
        store.writeDesignFile(d.id, photo.file, jpegWithDpi(jpg, 300));
        store.writeDesignFile(d.id, photo.thumb, await sharp()(jpg).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer());
        // (How sharp it prints: the photo's own pixels over its print size.)
        const long = Math.max(meta.width, meta.height) / Math.max(photo.px[0], photo.px[1]);
        photo.dpi = Math.max(1, Math.min(10000, Math.round(300 * Math.min(1, long))));
        const sheet = await photoContactSheet(d);
        store.writeDesignFile(d.id, 'front-preview.png', sheet);
        store.writeDesignFile(d.id, 'front-proof.png', sheet);
        const dpis = d.photos.map((p) => p.dpi).filter(Boolean);
        d.sides[0].dpi = dpis.length ? Math.min(...dpis) : 300;
        what = `photo-${photo.n}`;
      } else {
        // The child's photo as the book page takes it; its drawings are made again (the cover now, the rest queued).
        const book = bookFor(d.bookId);
        keepOld('face.jpg');
        const jpg = await sharp()(buf, { limitInputPixels: 80e6 }).rotate().resize(720, 900, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
        store.writeDesignFile(d.id, 'face.jpg', jpg);
        if (book.kind === 'coloring') store.writeDesignFile(d.id, 'face-line.png', await books.lineArt(jpg));
        for (const f of fs.readdirSync(store.designDir(d.id))) if (/^redraw-\d+\.jpg$/.test(f) || f === 'face-cartoon.jpg') fs.rmSync(store.designFile(d.id, f), { force: true });
        delete d.photoRemoved;
        await makeCartoon(d, req.ip);
        fs.rmSync(store.designFile(d.id, 'book-print.pdf'), { force: true });
        fs.rmSync(store.designFile(d.id, 'book-preview.pdf'), { force: true });
        what = 'face';
      }
      d.version = v + 1;
      if (d.kind === 'book') store.writeDesignFile(d.id, 'book-preview.png', await (await books.renderPage(bookData(d), 0, 600)).png().toBuffer());
      // The file checks again, for the new photo (a sharp one clears "low resolution"), as a replaced file does.
      await runPreflight(d);
      item.preflight = d.preflight;
      const now = new Date().toISOString();
      if (item.approval && item.approval.sample) item.sampleWanted = true;
      item.approval = null;
      item.status = 'awaiting_approval';
      const together = toldRecently && noteBefore && !noteBefore.split('\n').includes(changeNote) ? `${noteBefore}\n${changeNote}`.slice(0, 2000) : changeNote;
      item.review = { ...(item.review || { needed: true, reasons: [] }), note: together };
      item.approvals = [...(item.approvals || []), { action: 'changes', by: 'shop', at: now, replaced: true, proofHash: proofHashOf(d), version: d.version, side: what, note: changeNote }];
      item.history.push({ status: item.status, at: now });
      if (!proofOpen) newProofLink(item);
      if (!toldRecently) item.shopProofAt = now;
      store.save();
      // (The book's other pages are drawn again in the background, from the new photo.)
      if (d.kind === 'book') queueRedraw(order, item, { force: true });
      if (!toldRecently) tellCustomer(order, item, 'proof', (item.review && item.review.note) || '', req);
      if (marked) { replacingItems.delete(marked); marked = null; }
      res.json(await reviewItem(order, item));
    } catch (e) {
      next(e);
    } finally {
      if (marked) replacingItems.delete(marked);
    }
  });
  app.post('/api/admin/items/:itemId/resend-proof', adminOnly, (req, res) => {
    const found = store.findItem(req.params.itemId);
    if (!found) throw new HttpError(404, 'itemNotFound');
    const { order, item } = found;
    if (item.status !== 'awaiting_approval') throw new HttpError(409, 'proofDone');
    if (!item.proofToken) newProofLink(item);
    store.save();
    tellCustomer(order, item, 'proof', (item.review && item.review.note) || '', req);
    res.json({ proofLink: `/proof?t=${item.proofToken}` });
  });

  // ---------- The shop edits the customer's design itself (owner's request, 25 Nov) ----------
  // From Review, "Edit in the editor" opens the job's design in the shop's editor. The new version is saved as a design
  // like the customer's own (same product, same pieces, at the price agreed at checkout), then either goes to the
  // customer for approval with a note of what changed, or is printed without asking, with a note of why: that is an
  // owner's decision (held in Approvals for anyone else; an owner's own goes at once, logged).
  const INVISIBLE_MARKS = /[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u2800\u3164\ufeff\uffa0]/g;
  // (A note says something in words or numbers: a Braille blank or symbols alone aren't one. QA 25 Nov.)
  const noteText = (v, max) => {
    const t = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
    return /[\p{L}\p{N}]/u.test(t.replace(INVISIBLE_MARKS, '').replace(/\u0640/g, '')) ? t : '';
  };
  function shopEditCheck(req) {
    const found = store.findItem(req.params.itemId);
    if (!found) throw new HttpError(404, 'itemNotFound');
    const { order, item } = found;
    if (item.kind || !UUID_RE.test(item.designId || '')) throw new HttpError(409, 'reviseNotEditable');
    if (!REVIEW_STATUSES.includes(item.status)) throw new HttpError(409, 'notInReview');
    if (replacingItems.has(item.id)) throw new HttpError(409, 'fileBeingReplaced');
    const b = req.body || {};
    // (Made from the version the job has now: one sent meanwhile, by the customer or a colleague, isn't overwritten.)
    if (b.baseDesignId !== item.designId) throw new HttpError(409, 'shopEditStale');
    const note = noteText(b.note, 1000);
    if (!note) throw new HttpError(400, 'shopEditNoteNeeded');
    const { d, delta, fields } = checkNewVersion(req, item, b.designId);
    return { order, item, d, delta, fields, note };
  }
  function applyShopEdit(req, { order, item, d, delta, fields, note }, print) {
    const w = req.adminWho || {};
    let told = false;
    const by = w.shown || w.name || null;
    store.mutate((db) => {
      const o = db.orders.find((x) => x.id === order.id);
      const it = o && o.items.find((x) => x.id === item.id);
      const nd = db.designs[d.id];
      if (!it || !REVIEW_STATUSES.includes(it.status) || it.designId !== item.designId) throw new HttpError(409, 'shopEditStale');
      if (!nd || nd.orderId) throw new HttpError(409, 'designOrdered');
      const { now, sample } = putNewVersion(db, o, it, nd, { delta, fields, req });
      const proofHash = proofHashOf(nd);
      const reasons = [...new Set(['edited', ...((it.review && it.review.reasons) || [])])];
      it.approvals = [...(it.approvals || []), { action: 'edited', by: 'shop', at: now, note, proofHash, version: nd.version, ...(by ? { name: by } : {}), ...(print ? { print: true } : {}) }];
      if (print) {
        // Printed without asking: approved by the shop for the customer, with who decided it (the note is the team's).
        const decidedBy = w.approvedBy || by;
        it.approval = { proofHash, version: nd.version, at: now, by: 'shop', via: 'shop-edit', sample: Boolean(sample), ...(decidedBy ? { decidedBy } : {}) };
        it.approvals.push({ action: 'approved', by: 'shop', via: 'shop-edit', at: now, proofHash, version: nd.version, ...(decidedBy ? { name: decidedBy } : {}) });
        it.status = 'queued';
        it.review = { needed: true, reasons, status: 'done', shopNote: note };
      } else {
        // A second edit before the customer answered: the same proof link (it shows the latest version), and within
        // 10 minutes no second message; the notes go together (as for corrected files. QA 25 Nov).
        const proofOpen = it.status === 'awaiting_approval' && Boolean(it.proofToken);
        told = proofOpen && it.shopProofAt && Date.now() - Date.parse(it.shopProofAt) < 10 * 60 * 1000;
        const before = proofOpen && it.review && it.review.note ? String(it.review.note) : '';
        const together = told && before && !before.split('\n').includes(note) ? `${before}\n${note}`.slice(0, 2000) : note;
        it.status = 'awaiting_approval';
        it.review = { needed: true, reasons, status: 'pending', note: together };
        if (!proofOpen) newProofLink(it);
        if (!told) it.shopProofAt = now;
      }
      delete it.reviseToken;
      it.history.push({ status: it.status, at: now });
    });
    const saved = store.getOrder(order.id);
    const it = saved.items.find((x) => x.id === item.id);
    if (!print && !told) tellCustomer(saved, it, 'proof', (it.review && it.review.note) || note, req);
    return { saved, it };
  }
  app.post('/api/admin/items/:itemId/shop-edit', adminOnly, express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      const { saved, it } = applyShopEdit(req, shopEditCheck(req), false);
      res.json(await reviewItem(saved, it));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/admin/items/:itemId/shop-edit/print', adminOnly, express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      const { saved, it } = applyShopEdit(req, shopEditCheck(req), true);
      res.json(await reviewItem(saved, it));
    } catch (e) {
      next(e);
    }
  });

  // ---------- Name lists (variable data) ----------
  // The customer's spreadsheet (Excel or CSV) read into columns and rows; the
  // editor fills {Column} fields with each row (see src/merge.js).
  app.post('/api/merge/parse', (req, res, next) => {
    rateLimit(req, 'mergeParse');
    next();
  }, express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) throw new HttpError(400, 'mergeEmpty');
    let table;
    try {
      table = mergeData.parseTable(buf, { maxRows: MERGE_MAX_ROWS });
    } catch (e) {
      if (e && e.name === 'MergeDataError') throw new HttpError(400, { xls: 'mergeXls', empty: 'mergeEmpty' }[e.reason] || 'mergeUnreadable');
      throw e;
    }
    res.json({ columns: table.columns, rows: table.rows, total: table.total, truncated: table.truncated, maxRows: MERGE_MAX_ROWS });
  });

  /** The list sent with a design, checked: { count, columns, rows, sides: { front: { box } } }. */
  function cleanMerge(product, m, storedSides, { emb, pattern, colorDef, sizeDef }) {
    if (!product.merge || emb || pattern) throw new HttpError(400, 'mergeNotAllowed');
    if (!m || typeof m !== 'object' || !Array.isArray(m.columns) || !Array.isArray(m.rows) || !m.sides || typeof m.sides !== 'object') throw new HttpError(400, 'mergeBad');
    const text = (v, max) => [...String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
    if (m.columns.length < 1 || m.columns.length > 20) throw new HttpError(400, 'mergeBad');
    const columns = [];
    m.columns.forEach((c, i) => {
      let name = text(c, 60) || `Column ${i + 1}`;
      while (columns.includes(name)) name += ' 2';
      columns.push(name);
    });
    const max = Math.min(MERGE_MAX_ROWS, product.merge.maxRows || MERGE_MAX_ROWS);
    if (m.rows.length < 1) throw new HttpError(400, 'mergeEmpty');
    if (m.rows.length > max) throw new HttpError(400, 'mergeTooMany', { max });
    const rows = m.rows.map((r) => columns.map((_, i) => text(Array.isArray(r) ? r[i] : '', 200)));
    const sides = {};
    for (const [id, v] of Object.entries(m.sides)) {
      if (!storedSides.some((sd) => sd.id === id)) throw new HttpError(400, 'mergeBad');
      const b = v && v.box;
      const ok = b && ['x', 'y', 'w', 'h'].every((k) => Number.isInteger(b[k]) && b[k] >= 0 && b[k] <= 20000) && b.w >= 1 && b.h >= 1;
      if (!ok) throw new HttpError(400, 'mergeBad');
      sides[id] = { box: { x: b.x, y: b.y, w: b.w, h: b.h } };
    }
    if (!Object.keys(sides).length) throw new HttpError(400, 'mergeNoFields');
    // A Size / Colour column gives each row its own size and colour (team kits); else the design's.
    const vc = variantColumns(columns);
    const useSize = vc.size >= 0 && product.mix && product.mix.sizes;
    const useColor = vc.color >= 0 && product.mix && product.mix.colors;
    const counts = new Map();
    rows.forEach((r, i) => {
      // A blank size / colour cell: the size / colour chosen for the design.
      const sz = useSize && String(r[vc.size] || '').trim() ? matchSize(product, r[vc.size]) : sizeDef;
      const co = useColor && String(r[vc.color] || '').trim() ? matchColor(product, r[vc.color]) : colorDef;
      if (!sz) throw new HttpError(400, 'mergeBadSize', { row: i + 1, value: r[vc.size] || '—', list: product.sizes.map((x) => x.id).join(', ') });
      if (!co) throw new HttpError(400, 'mergeBadColor', { row: i + 1, value: r[vc.color] || '—', list: product.colors.map((x) => pickEn(x.name)).join(', ') });
      const key = `${co.id}|${sz.id}`;
      counts.set(key, { co, sz, qty: (counts.get(key) || { qty: 0 }).qty + 1 });
    });
    const lines = [...counts.values()].map(({ co, sz, qty }) => ({ color: { id: co.id, name: co.name, hex: co.hex }, size: { id: sz.id, label: sz.label }, qty }));
    return { count: rows.length, columns, rows, sides, lines: lines.length > 1 || (lines[0] && (lines[0].color.id !== colorDef.id || lines[0].size.id !== sizeDef.id)) || rows.length > 1 ? lines : null, ...(useSize || useColor ? { variantCols: { size: useSize ? vc.size : -1, color: useColor ? vc.color : -1 } } : {}) };
  }

  /**
   * The pieces asked for: [{ color, size, qty }] (ids), checked against the
   * product. Only colours / sizes that share the print file can be mixed.
   * Returns lines with names, or null for a single piece.
   */
  function cleanQuantities(product, q, colorDef, sizeDef) {
    if (q == null) return null;
    if (!Array.isArray(q) || q.length < 1 || q.length > 80) throw new HttpError(400, 'qtyBad');
    const merged = new Map();
    let total = 0;
    for (const line of q) {
      const co = product.colors.find((c) => c.id === (line && line.color));
      const sz = product.sizes.find((z) => z.id === (line && line.size));
      const qty = Number(line && line.qty);
      if (!co || !sz || !Number.isInteger(qty) || qty < 1 || qty > MAX_PIECES) throw new HttpError(400, 'qtyBad');
      if (co.id !== colorDef.id && !(product.mix && product.mix.colors)) throw new HttpError(400, 'qtyNoColors');
      // (Packs of one family (the same paper size or page count: one print file) mix on every product: 11 menus are a
      // 10-pack and a single, not 11 singles. Owner, 26 Nov.)
      const samePrint = sz.pack && sizeDef.pack && sz.copies > 0 && sizeDef.copies > 0 && sz.family === sizeDef.family;
      if (sz.id !== sizeDef.id && !(product.mix && product.mix.sizes) && !samePrint) throw new HttpError(400, product.paged ? 'qtyOnePageCount' : 'qtyNoSizes');
      const key = `${co.id}|${sz.id}`;
      merged.set(key, { co, sz, qty: (merged.get(key) || { qty: 0 }).qty + qty });
      total += qty;
    }
    if (total > MAX_PIECES) throw new HttpError(400, 'qtyTooMany', { max: MAX_PIECES });
    // Packs: the copies count (1,000 packs of 100 booklets was 100,000 copies on cash on delivery. QA 26 Nov).
    const copies = [...merged.values()].reduce((n, l) => n + l.qty * (l.sz.pack && l.sz.copies > 0 ? l.sz.copies : 1), 0);
    if ([...merged.values()].some((l) => l.sz.pack) && copies > MAX_PACK_COPIES) throw new HttpError(400, 'qtyTooManyCopies', { max: MAX_PACK_COPIES.toLocaleString('en-US') });
    if (total === 1 && merged.size === 1) {
      const only = [...merged.values()][0];
      if (only.co.id === colorDef.id && only.sz.id === sizeDef.id) return null; // just one, as chosen
    }
    return [...merged.values()].map(({ co, sz, qty }) => ({ color: { id: co.id, name: co.name, hex: co.hex }, size: { id: sz.id, label: sz.label, ...packOf(sz) }, qty }));
  }
  /** Total pieces and per-line prices of a design (for the cart, order and invoice). */
  function pieceInfo(product, d) {
    const unit = (sizeId) => priceFor(product, sizeId, decoratedSides(d)) + embExtra(product, d, sizeId);
    if (d.quantities) {
      for (const l of d.quantities) l.unitPrice = round2(unit(l.size.id));
      const prices = new Set(d.quantities.map((l) => l.unitPrice));
      return { copies: copiesOf(d), ...(prices.size === 1 ? { unitPrice: [...prices][0] } : { unitPrice: undefined }) };
    }
    return { copies: copiesOf(d), unitPrice: round2(unit(d.size.id)) };
  }

  /** On /complete: the background and one name picture per row, all the right size. */
  function checkMergeFiles(design) {
    for (const [id, m] of Object.entries(design.merge.sides)) {
      const side = design.sides.find((s) => s.id === id);
      const read = (n) => {
        const f = store.designFile(design.id, n);
        if (!fs.existsSync(f)) throw new HttpError(400, 'mergeFiles');
        return fs.readFileSync(f);
      };
      let base;
      let pics;
      try {
        base = mergeData.pngSize(read(`${id}-merge-base.png`));
        pics = mergeData.splitPngs(read(`${id}-merge.bin`), { max: design.merge.count });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'mergeFiles');
      }
      const b = m.box;
      if (!side || base.width !== side.widthPx || base.height !== side.heightPx) throw new HttpError(400, 'mergeFiles');
      if (b.x + b.w > base.width || b.y + b.h > base.height) throw new HttpError(400, 'mergeFiles');
      if (pics.length !== design.merge.count) throw new HttpError(400, 'mergeFiles');
      for (const pic of pics) {
        const sz = mergeData.pngSize(pic);
        if (sz.width !== b.w || sz.height !== b.h) throw new HttpError(400, 'mergeFiles');
      }
    }
  }
  const readMergeList = (design) => {
    try {
      return JSON.parse(fs.readFileSync(store.designFile(design.id, 'merge.json'), 'utf8'));
    } catch (e) {
      return null;
    }
  };

  /** The name-list downloads: every copy in one PDF (with or without crop marks), one PDF per copy, the list. */
  async function makeMergeFile(design, format, base) {
    const files = { 'merge-pdf': 'merge-print.pdf', 'merge-pdf-marks': 'merge-print-marks.pdf', 'merge-zip': 'merge-copies.zip', 'merge-csv': 'merge-list.csv', 'merge-names-zip': 'merge-names.zip' };
    const list = design.merge && readMergeList(design);
    if (!list || !Object.hasOwn(files, format)) throw new HttpError(404, 'notFound');
    const n = design.merge.count;
    const target = store.designFile(design.id, files[format]);
    if (!fs.existsSync(target)) {
      if (format === 'merge-csv') {
        store.writeDesignFile(design.id, files[format], merge.csv(list.columns, list.rows));
      } else {
        const read = (name) => fs.readFileSync(store.designFile(design.id, name));
        const product = getProduct(design.productId);
        const garment = Boolean(product && product.methods.some((m) => m === 'dtf' || m === 'dtg'));
        // Each piece's size / colour from the list (team kits), else the design's.
        const vc = design.merge.variantCols || { size: -1, color: -1 };
        const variant = (r) => [vc.size >= 0 ? (list.rows[r] || [])[vc.size] : '', vc.color >= 0 ? (list.rows[r] || [])[vc.color] : ''].filter(Boolean).join(' ');
        const label = (r) => [(list.rows[r] || []).filter((v, k) => v && k !== vc.size && k !== vc.color).slice(0, 2).join(' / '), variant(r)].filter(Boolean).join(' · ');
        if (format === 'merge-names-zip') {
          await merge.writeZipOfNames(design, read, list.rows, target, { extra: variant });
          return { path: target, name: `${base}-${n}-names-only.zip` };
        }
        const lays = await merge.layers(design, read, { keepAlpha: garment });
        if (format === 'merge-zip') {
          try {
            await merge.writeZipOfPdfs(lays, n, list.rows, target, { title: base });
          } catch (e) {
            if (e.code === 'ZIP_TOO_BIG') throw new HttpError(413, 'mergeZipTooBig');
            throw e;
          }
        } else {
          await merge.writePdf(lays, n, target, { marks: format === 'merge-pdf-marks', title: base, label });
        }
      }
    }
    const ext = { 'merge-pdf': 'pdf', 'merge-pdf-marks': 'pdf', 'merge-zip': 'zip', 'merge-csv': 'csv', 'merge-names-zip': 'zip' }[format];
    const suffix = { 'merge-pdf': '', 'merge-pdf-marks': '-cropmarks', 'merge-zip': '-separate', 'merge-csv': '-list', 'merge-names-zip': '-only' }[format];
    return { path: target, name: `${base}-${n}-names${suffix}.${ext}` };
  }

  /**
   * A booklet page whose bottom layer is a page of the customer's uploaded PDF, placed straight
   * (not turned, flipped, cropped or faded): where it sits in points from the page's bottom-left
   * corner (bleed included), and whether anything is drawn on top of it. Otherwise null.
   */
  function vectorPage(product, storedSide, ed) {
    const objs = (ed && Array.isArray(ed.objects)) ? ed.objects : [];
    const o = objs[0];
    const src = o && o.pdfSrc;
    if (!src || !PDF_ID_RE.test(String(src.id)) || !Number.isInteger(src.page) || src.page < 0 || src.page > 999) return null;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(pdfUploadsDir, `${src.id}.json`), 'utf8'));
    } catch (e) {
      return null; // the PDF is gone (older than 45 days): printed from the picture
    }
    const box = meta.boxes && meta.boxes[src.page];
    // (A page turned by /Rotate prints from its picture, which shows it turned.)
    if (!box || box.rotate || !fs.existsSync(path.join(pdfUploadsDir, `${src.id}.pdf`))) return null;
    const turned = Math.abs(((Number(o.angle) || 0) % 360 + 360) % 360) > 0.01;
    if (turned || o.flipX || o.flipY || Number(o.skewX) || Number(o.skewY) || Number(o.cropX) || Number(o.cropY) || (o.filters && o.filters.length) || o.clipPath || (o.opacity != null && o.opacity < 0.999) || o.visible === false || (o.globalCompositeOperation && o.globalCompositeOperation !== 'source-over')) return null;
    const side = product.sides.find((s) => s.id === storedSide.id);
    const a = side.printArea;
    const u = a.w / side.printWidthIn; // drawing units per inch
    const bU = (side.bleedIn || 0) * u;
    const w = (Number(o.width) || 0) * (Number(o.scaleX) || 1);
    const h = (Number(o.height) || 0) * (Number(o.scaleY) || 1);
    if (!(w > 0 && h > 0)) return null;
    const left = (Number(o.left) || 0) - (o.originX === 'center' ? w / 2 : o.originX === 'right' ? w : 0);
    const top = (Number(o.top) || 0) - (o.originY === 'center' ? h / 2 : o.originY === 'bottom' ? h : 0);
    const k = 72 / u;
    const pageH = (side.printWidthIn * a.h / a.w + 2 * (side.bleedIn || 0)) * 72;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      pdfId: src.id,
      page: src.page,
      src: box,
      box: { x: r3((left - (a.x - bU)) * k), y: r3(pageH - (top - (a.y - bU)) * k - h * k), w: r3(w * k), h: r3(h * k) },
      overlay: objs.length > 1,
    };
  }
  app.post('/api/designs', (req, res, next) => {
    // Checked before reading the (large) body.
    rateLimit(req, 'designs');
    rateLimit(req, 'designsAll', '*');
    next();
  }, express.json({ limit: '60mb' }), (req, res) => {
    const { productId, color, size, sides } = req.body || {};
    const product = getProduct(productId);
    // Photo prints are ordered on the photos page (POST /api/photosets).
    if (!product || product.kind === 'photoset') throw new HttpError(400, 'unknownProduct');
    const colorDef = product.colors.find((c) => c.id === color);
    if (!colorDef) throw new HttpError(400, 'unknownColor');
    const sizeDef = product.sizes.find((s) => s.id === size);
    if (!sizeDef) throw new HttpError(400, 'unknownSize');
    if (!sides || typeof sides !== 'object' || Array.isArray(sides)) throw new HttpError(400, 'sidesRequired');
    // Hidden by the product manager, or this colour / size / side not offered now.
    const why = catalog.unavailable(product, { colorId: colorDef.id, sizeId: sizeDef.id, sideIds: Object.keys(sides).filter((id) => id !== EMB) });
    if (why) throw new HttpError(409, why, { name: product.name[langOf(req)] || product.name.en });

    // Pages from before embroidery was a layer sent the stitched design as the front itself.
    if ((req.body || {}).method === 'embroidery' && product.embroidery && !sides[EMB] && sides[product.embroidery.side]) {
      sides[EMB] = sides[product.embroidery.side];
      delete sides[product.embroidery.side];
    }
    const sideIds = Object.keys(sides);
    if (sideIds.length === 0) throw new HttpError(400, 'designAtLeastOne');
    const unknown = sideIds.filter((id) => !product.sides.some((s) => s.id === id) && !(id === EMB && product.embroidery && (req.body || {}).method === 'embroidery'));
    if (unknown.length) throw new HttpError(400, 'unknownSide', { side: unknown.join(', ') });

    // Embroidery instead of print on one area (left chest, cap front...), stitched from the print file;
    // the product's other sides (a printed back) print as usual.
    const emb = (req.body || {}).method === 'embroidery' && product.embroidery ? product.embroidery : null;
    // Product options (business-card lamination…).
    const picked = cleanOptions(product, (req.body || {}).options);
    if (picked.error) throw new HttpError(400, 'badOption');
    if (emb && !sideIds.includes(EMB)) throw new HttpError(400, 'embEmpty');
    // Booklets: only the pages this size prints (an 8-page booklet has no page 12).
    if (product.paged) {
      const pages = new Set(pageSides(product, sizeDef.id).map((sd) => sd.id));
      const extra = sideIds.filter((id) => !pages.has(id));
      if (extra.length) throw new HttpError(400, 'unknownSide', { side: extra.join(', ') });
    }
    const editor = {};
    const storedSides = [];
    // Fabric: how the tile repeats and how big it prints (the tile is the print file).
    let pattern = null;
    if (product.pattern) {
      const asked = (Object.values(sides).find((x) => x && x.editor && x.editor.pattern) || {}).editor;
      const p = (asked && asked.pattern) || {};
      const tileCm = Number(p.tileCm);
      pattern = {
        repeat: REPEATS.includes(p.repeat) ? p.repeat : 'straight',
        tileCm: product.pattern.tiles.includes(tileCm) ? tileCm : product.pattern.tile,
        fabricCm: sizeDef.cm || [145, 100],
      };
    }
    const editorOf = (id, name) => {
      const s = sides[id] || {};
      // (A side whose only texts were emptied prints nothing: it isn't a printed side, nor priced as one. QA 26 Nov.)
      const blank = (o) => o && typeof o === 'object' && /text/i.test(String(o.type || '')) && !String(o.text == null ? '' : o.text).replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0 || s.editor.objects.every(blank)) {
        throw new HttpError(400, 'sideEmpty', { side: name });
      }
      return s.editor;
    };
    for (const side of product.sides) {
      // The embroidery on this side (after its print, if it has one): its own area, stitched from its own print file.
      const embHere = () => {
        if (!emb || side.id !== emb.side || !sideIds.includes(EMB)) return;
        const name = embSideName(side);
        const ed = editorOf(EMB, name);
        const eo = cleanEmbOffset(side, emb, ed.offset);
        editor[EMB] = { ...ed, offset: eo || undefined };
        const perCm = emb.area.w / (emb.widthIn * 2.54);
        const cm = (v) => Math.round((v / perCm) * 2) / 2;
        storedSides.push({ id: EMB, name, on: side.id, widthIn: emb.widthIn, heightIn: emb.heightIn, bleedIn: 0, process: 'embroidery', ...(eo ? { offsetCm: { x: cm(eo.dx), y: cm(eo.dy) } } : {}) });
      };
      if (!sideIds.includes(side.id)) {
        embHere();
        continue;
      }
      const ed = editorOf(side.id, side.name);
      const offset = cleanOffset(product, side, sizeDef.id, ed.offset);
      editor[side.id] = { ...ed, offset: offset || undefined, ...(pattern ? { pattern: { repeat: pattern.repeat, tileCm: pattern.tileCm } } : {}) };
      if (pattern) {
        const tileIn = round2(pattern.tileCm / 2.54);
        storedSides.push({ id: side.id, name: side.name, widthIn: tileIn, heightIn: tileIn, bleedIn: 0 });
        continue;
      }
      storedSides.push({
        // The physical size for the chosen size (a 30 x 40 poster prints smaller than a 45 x 60 one).
        id: side.id, name: side.name, widthIn: printWidthFor(product, side, sizeDef.id), heightIn: round2(printHeightFor(product, side, sizeDef.id)), bleedIn: side.bleedIn || 0,
        // With embroidery: this side is printed (DTF / DTG files, not stitches).
        ...(emb ? { process: product.process } : {}),
        ...(offset ? { offsetCm: offsetCm(product, side, sizeDef.id, offset) } : {}),
      });
      embHere();
    }
    const editorJson = JSON.stringify(editor);
    if (Buffer.byteLength(editorJson) > MAX_EDITOR_JSON_BYTES) throw new HttpError(413, 'designTooLarge');
    // Name list: one printed copy per row, the {Column} fields filled in per copy.
    const mergeIn = (req.body || {}).merge;
    const mergeList = mergeIn ? cleanMerge(product, mergeIn, storedSides, { emb, pattern, colorDef, sizeDef }) : null;
    const listKey = mergeList ? crypto.randomBytes(18).toString('base64url') : null;
    // One artwork, many pieces: several of the same, or the same artwork in other sizes / colours.
    const lines = mergeList ? mergeList.lines : cleanQuantities(product, (req.body || {}).quantities, colorDef, sizeDef);
    // Pictures imported from other sites: the customer must confirm they may print them.
    const imported = [...new Set(Object.values(editor).flatMap((e) => e.objects.map((o) => (o && typeof o.importSource === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(o.importSource.trim()) ? o.importSource.trim().slice(0, 500) : null)).filter(Boolean)))].slice(0, 10);
    if (imported.length && (req.body || {}).rightsConfirmed !== true) throw new HttpError(400, 'rightsRequired');
    // A ready design from the shop's library added as it is (the ready-design page, no name typed in: every side says
    // which design and none says `named`): nothing of the customer's own to check, so its proof needs no tick at
    // checkout and the order takes it as approved (owner, 26 Nov). The editor never marks a design so.
    const libIds = [...new Set(sideIds.map((id) => sides[id] && sides[id].editor && sides[id].editor.library))];
    const readyFrom = libIds.length === 1 && typeof libIds[0] === 'string' && !mergeList && !emb && !imported.length
      && !sideIds.some((id) => sides[id].editor.named) && library.shown(libIds[0]) ? libIds[0] : null;

    const token = crypto.randomBytes(24).toString('hex');
    const design = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'uploading',
      uploadTokenHash: sha(token),
      // A name list's names are customers' data: read back only with this key (kept with the cart item), the team's
      // sign-in, or the order's own link (owner's OK, 26 Nov, from the security review).
      ...(listKey ? { listKeyHash: sha(listKey) } : {}),
      productId: product.id,
      productName: product.name,
      process: emb ? 'embroidery' : product.process,
      ...(emb ? { method: 'embroidery', embSide: EMB } : {}),
      ...(picked.options ? { options: picked.options } : {}),
      color: { id: colorDef.id, name: colorDef.name, hex: colorDef.hex },
      // Options are shown with the size everywhere ("100 cards · Matte lamination"): cart, order, invoice, admin, labels.
      size: { id: sizeDef.id, label: withOptions(sizeDef.label, picked.options) },
      sides: storedSides,
      price: 0, // set below from the pieces
      ...(mergeList ? { merge: { count: mergeList.count, columns: mergeList.columns, sides: mergeList.sides, ...(mergeList.variantCols ? { variantCols: mergeList.variantCols } : {}) } } : {}),
      ...(lines ? { quantities: lines.map((l) => (picked.options ? { ...l, size: { ...l.size, label: withOptions(l.size.label, picked.options) } } : l)) } : {}),
      // The editor's own findings (fonts that didn't load, low-resolution photos, tiny text), checked again at /complete.
      // (Checked for depth first: a hostile body nested thousands deep made JSON.stringify overflow, QA 25 Nov.)
      ...(Array.isArray((req.body || {}).clientChecks) && !nestedTooDeep(req.body.clientChecks, 6, 2000) && JSON.stringify(req.body.clientChecks).length < 20000 ? { clientChecks: req.body.clientChecks.slice(0, 50) } : {}),
      version: 1,
      currency: CURRENCY,
      orderId: null,
      ...(imported.length ? { imports: imported, rightsConfirmedAt: new Date().toISOString() } : {}),
      ...(pattern ? { pattern } : {}),
      ...(readyFrom ? { readyFrom } : {}),
    };
    design.price = designPrice({ ...design, status: 'ready' });
    if (design.price == null) throw new HttpError(400, 'unknownSize');
    Object.assign(design, pieceInfo(product, design));
    // Booklet pages from the customer's PDF: printed from the PDF page itself (with what was added on top).
    const pdfCopies = {};
    if (product.paged) {
      for (const sd of storedSides) {
        const v = vectorPage(product, sd, editor[sd.id]);
        if (!v) continue;
        sd.vector = v;
        pdfCopies[`source-${v.pdfId}.pdf`] ||= fs.readFileSync(path.join(pdfUploadsDir, `${v.pdfId}.pdf`));
      }
    }
    // A {field} left in the text (a business card's {Name}) can't be printed as it is: a name list fills it,
    // or the customer types the real words. The editor says so; a ready design added as it is must not slip by.
    // Only the shop's own places count: a customer's "{ return love; }" or "I ❤ {JS}" is just text (QA 25 Nov).
    if (!mergeList) {
      const known = new Set(templateFields().map(fieldKey));
      const texts = (objs) => (Array.isArray(objs) ? objs : []).flatMap((o) => (o && Array.isArray(o.objects) ? texts(o.objects) : [o && typeof o.text === 'string' ? o.text : '']));
      const unfilled = (tx) => [...tx.matchAll(FIELD_RE)].some((m) => known.has(fieldKey(m[0])));
      if (known.size && Object.values(editor).some((ed) => texts(ed && ed.objects).some(unfilled))) throw new HttpError(400, 'fieldsUnfilled');
    }
    const files = storedSides.flatMap((sd) => [`${sd.id}-print.png`, `${sd.id}-preview.png`, `${sd.id}-design.svg`, ...(sd.vector && sd.vector.overlay ? [`${sd.id}-overlay.png`] : [])]);
    if (mergeList) for (const sd of Object.keys(mergeList.sides)) files.push(`${sd}-merge-base.png`, `${sd}-merge.bin`);
    design.expectedFiles = files;
    store.createDesign(design, { 'editor.json': editorJson, ...pdfCopies, ...(mergeList ? { 'merge.json': JSON.stringify({ columns: mergeList.columns, rows: mergeList.rows }) } : {}) });
    res.status(201).json({ id: design.id, uploadToken: token, files, ...(listKey ? { listKey } : {}) });
  });

  // Designs whose files are being checked (/complete): no more uploads until it is done (a file swapped in the
  // middle would be marked ready without being checked: QA tester 2, 25 Nov).
  const completing = new Set();
  const fileHash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const uploadingDesign = (req) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'designNotFound');
    if (design.status !== 'uploading' || design.uploadTokenHash !== sha(req.get('x-upload-token') || '')) throw new HttpError(403, 'notFound');
    if (completing.has(design.id)) throw new HttpError(409, 'designCompleting');
    return design;
  };

  app.put('/api/designs/:id/files/:name', (req, res, next) => {
    // Checked before the body is read: a made-up design, a wrong token or a file that isn't expected
    // costs the server nothing (QA 25 Nov: four 140 MB uploads to a made-up id held 750 MB).
    const design = uploadingDesign(req);
    if (!FILE_RE.test(req.params.name) || !(design.expectedFiles || []).includes(req.params.name)) throw new HttpError(400, 'notFound');
    next();
  }, express.raw({ type: () => true, limit: '150mb' }), (req, res) => {
    const design = uploadingDesign(req);
    const { name } = req.params;
    if (!FILE_RE.test(name) || !(design.expectedFiles || []).includes(name)) throw new HttpError(400, 'notFound');
    let buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (checkUpload(name, buf) === 'svg') buf = Buffer.from(security.sanitizeSvg(buf.toString('utf8')));
    store.writeDesignFile(design.id, name, buf);
    res.status(204).end();
  });

  app.post('/api/designs/:id/complete', async (req, res, next) => {
    try {
      // A photo set completed already (the answer got lost on the way, e.g. the phone changed networks):
      // the same token gets the finished set again instead of an error.
      const prior = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
      if (prior && prior.kind === 'photoset' && prior.status === 'ready' && prior.doneTokenHash && prior.doneTokenHash === sha(req.get('x-upload-token') || '')) {
        const { uploadTokenHash, doneTokenHash, listKeyHash, ...pub } = prior; // eslint-disable-line no-unused-vars
        return res.json({ ...pub, previewUrl: `/files/designs/${prior.id}/front-preview.png` });
      }
      const design = uploadingDesign(req);
      completing.add(design.id);
      res.on('close', () => completing.delete(design.id));
      if (design.kind === 'photoset') {
        await completePhotoset(design);
        await runPreflight(design);
        design.status = 'ready';
        design.doneTokenHash = design.uploadTokenHash;
        delete design.uploadTokenHash;
        store.save();
        const { uploadTokenHash, doneTokenHash, listKeyHash, ...pub } = design; // eslint-disable-line no-unused-vars
        return res.json({ ...pub, previewUrl: `/files/designs/${design.id}/front-preview.png` });
      }
      if (design.kind === 'gangsheet') {
        for (const name of design.expectedFiles) {
          if (!fs.existsSync(store.designFile(design.id, name))) throw new HttpError(400, 'gangMissingFile');
        }
        let minDpi = Infinity;
        for (const it of design.sheet.items) {
          const info = await printfiles.pngInfo(fs.readFileSync(store.designFile(design.id, it.file)));
          it.px = [info.width, info.height];
          it.dpi = Math.round(Math.min(info.width / (it.wCm / 2.54), info.height / (it.hCm / 2.54)));
          minDpi = Math.min(minDpi, it.dpi);
        }
        design.sides[0].dpi = minDpi;
        design.status = 'ready';
        delete design.uploadTokenHash;
        store.save();
        const { uploadTokenHash, listKeyHash, ...pub } = design; // eslint-disable-line no-unused-vars
        return res.json({ ...pub, previewUrl: `/files/designs/${design.id}/front-preview.png` });
      }
      const checked = new Map(); // side -> the print file as checked
      for (const side of design.sides) {
        for (const name of [`${side.id}-print.png`, `${side.id}-preview.png`]) {
          if (!fs.existsSync(store.designFile(design.id, name))) throw new HttpError(400, 'sideEmpty', { side: side.name });
        }
        const file = store.designFile(design.id, `${side.id}-print.png`);
        const raw = fs.readFileSync(file);
        // Size straight from the PNG header, so this works even without the image library.
        const info = { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
        // A small file that claims a huge picture would use gigabytes when made into a PDF.
        const pv = fs.readFileSync(store.designFile(design.id, `${side.id}-preview.png`));
        const pvW = pv.readUInt32BE(16);
        const pvH = pv.readUInt32BE(20);
        if (!info.width || !info.height || info.width > 20000 || info.height > 20000 || info.width * info.height > 120e6 || pvW > 4000 || pvH > 4000) {
          throw new HttpError(400, 'imageTooLarge');
        }
        const dpi = Math.round(info.width / (side.widthIn + 2 * side.bleedIn));
        // A print file far too small for the print (a broken upload) can't be printed or converted.
        if (dpi < 20 || info.width < 16 || info.height < 16) throw new HttpError(400, 'printTooSmall');
        try {
          store.writeDesignFile(design.id, `${side.id}-print.png`, await printfiles.finalizePrintPng(raw, dpi));
        } catch (err) {
          // Never block an order over the colour-profile step; the PNG is still print-ready.
          console.error('Could not embed colour profile/DPI:', err.message);
        }
        Object.assign(side, { widthPx: info.width, heightPx: info.height, dpi, hasSvg: fs.existsSync(store.designFile(design.id, `${side.id}-design.svg`)) });
        checked.set(side.id, fileHash(file));
      }
      if (design.merge) checkMergeFiles(design);
      if (design.method === 'embroidery') await makeEmbroidery(design);
      await heavy(async () => {
        await makeProofImages(design);
        await runPreflight(design);
      });
      // (Another copy of the app may have taken an upload meanwhile: the files must be the ones checked.)
      for (const side of design.sides) {
        if (checked.get(side.id) !== fileHash(store.designFile(design.id, `${side.id}-print.png`))) throw new HttpError(409, 'designChanged');
      }
      design.status = 'ready';
      // The upload key stays the cart's key for this design: with it the cart changes how many (owner, 26 Nov).
      if (!design.merge && !design.kind) design.cartKeyHash = design.uploadTokenHash;
      delete design.uploadTokenHash;
      store.save();
      const { uploadTokenHash, listKeyHash, cartKeyHash, ...pub } = design; // eslint-disable-line no-unused-vars
      res.json({ ...pub, previewUrl: `/files/designs/${design.id}/${design.sides[0].id}-preview.png` });
    } catch (e) {
      next(e);
    }
  });

  // "How will my colours print?" RGB -> CMYK -> RGB round trip of a small preview.
  // Script errors from shoppers' browsers, written to the server log (no personal data).
  const errorHits = new Map();
  // Screen measurements from phones (no personal data), to fit the editor layout.
  app.post('/api/client-layout', express.text({ type: '*/*', limit: '2kb' }), (req, res) => {
    const now = Date.now();
    const hits = (errorHits.get(req.ip) || []).filter((tm) => now - tm < 60000);
    if (hits.length < 10) {
      errorHits.set(req.ip, [...hits, now]);
      console.log(`[client-layout] ${String(req.body || '').replace(/[\r\n]+/g, ' ').slice(0, 900)} | ${String(req.get('user-agent') || '').slice(0, 160)}`);
    }
    res.status(204).end();
  });
  app.post('/api/client-error', express.text({ type: '*/*', limit: '4kb' }), (req, res) => {
    const now = Date.now();
    const hits = (errorHits.get(req.ip) || []).filter((tm) => now - tm < 60000);
    if (errorHits.size > 5000) errorHits.clear();
    if (hits.length < 10) {
      errorHits.set(req.ip, [...hits, now]);
      let e = {};
      try {
        e = JSON.parse(req.body || '{}');
        if (!e || typeof e !== 'object') e = { msg: String(req.body).slice(0, 300) };
      } catch (err) {
        e = { msg: String(req.body).slice(0, 300) };
      }
      const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n);
      console.warn(`[client-error] ${clip(e.page, 80)} | ${clip(e.msg, 300)} | ${clip(e.src, 120)}:${clip(e.line, 8)} | ${clip(e.stack, 600)} | ${clip(req.get('user-agent'), 160)}`);
    }
    res.status(204).end();
  });

  // ---------- Ready-made designs shop ----------
  const library = new Library(dataDir);
  library.runOnce(libraryOnce); // one-time changes to the shop's list (server.js: the real shop only)
  /** The shop's places for a customer's details ({Name}, {الاسم}…) in every ready design, the owner's too. */
  function templateFields() {
    library.reload();
    const idx = library.index;
    const n = (idx.custom || []).length;
    if (fieldsCache.from !== idx || fieldsCache.n !== n) fieldsCache = { from: idx, n, list: fieldsOf([...(idx.custom || []), ...LIBRARY_SEED]) };
    return fieldsCache.list;
  }
  const libraryCard = (d) => ({
    id: d.id, name: d.name, category: d.category, kind: d.kind, product: d.product, color: d.color,
    // Made for certain products only (laser designs: one tone, cut pieces joined up).
    ...(Array.isArray(d.products) ? { products: d.products.filter((id) => catalog.visible(getProduct(id))) } : {}),
    ...(d.kind === 'template' ? { items: d.items, aspect: d.aspect } : { preview: `/api/library/${d.id}/preview.png` }),
  });
  app.get('/api/library', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ categories: DESIGN_CATEGORIES, designs: library.visible().map(libraryCard) });
  });
  app.get('/api/library/:id', (req, res) => {
    const d = library.shown(req.params.id);
    if (!d) throw new HttpError(404, 'notFound');
    const { hidden, deleted, ...pub } = d; // eslint-disable-line no-unused-vars
    res.json(pub);
  });
  app.get('/api/library/:id/preview.png', (req, res) => {
    const d = library.shown(req.params.id);
    if (!d || d.kind !== 'objects' || !fs.existsSync(library.previewPath(d.id))) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type('png').send(fs.readFileSync(library.previewPath(d.id)));
  });

  // ---------- AI help (slogans, logos) ----------
  // Per-visitor and whole-shop daily limits keep the AI bill predictable.
  const AI_PER_VISITOR = Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 15);
  const AI_PER_DAY = Math.max(1, Number(process.env.AI_GLOBAL_DAILY_LIMIT) || 300);
  const aiUse = { day: '', total: 0, byIp: new Map() };
  function takeAiCredit(ip) {
    const day = new Date().toISOString().slice(0, 10);
    if (aiUse.day !== day) Object.assign(aiUse, { day, total: 0, byIp: new Map() });
    const used = aiUse.byIp.get(ip) || 0;
    if (used >= AI_PER_VISITOR || aiUse.total >= AI_PER_DAY) throw new HttpError(429, 'aiLimit');
    // The whole shop's budget is shared by every copy of the app.
    if (!takeShopBudget('ai', AI_PER_DAY)) throw new HttpError(429, 'aiLimit');
    aiUse.byIp.set(ip, used + 1);
    aiUse.total += 1;
    return AI_PER_VISITOR - used - 1;
  }
  app.get('/api/ai/status', (req, res) => {
    res.json({ enabled: ai.enabled(), perDay: AI_PER_VISITOR });
  });
  const aiRoute = (fn) => async (req, res, next) => {
    try {
      if (!ai.enabled()) throw new HttpError(503, 'aiOff');
      const left = takeAiCredit(req.ip);
      const result = await fn(req.body || {});
      res.json({ ...result, left });
    } catch (e) {
      if (e instanceof ai.AiError) {
        if (e.status >= 500) console.warn('[ai]', e.key);
        return next(new HttpError(e.status, e.key));
      }
      next(e);
    }
  };
  app.post('/api/ai/slogans', express.json({ limit: '8kb' }), aiRoute(async (body) => ({ slogans: await ai.slogans(body) })));
  app.post('/api/ai/logos', express.json({ limit: '8kb' }), aiRoute(async (body) => ({ logos: await ai.logos(body) })));

  // ---------- Photo quality boost ----------
  // Enlarge a low-resolution photo (Lanczos) and sharpen it, so it prints crisper.
  const enhanceHits = new Map();
  /**
   * A real photo file by its own first bytes (PNG, JPEG or WebP), whatever type the request says: the AI photo tools
   * never get an SVG, PDF or anything else to decode (owner's OK, 26 Nov, from the security review).
   */
  const isPhotoFile = (b) => b.length >= 12 && (
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'));
  app.post('/api/enhance', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '15mb' }), async (req, res, next) => {
    try {
      const now = Date.now();
      const hits = (enhanceHits.get(req.ip) || []).filter((tm) => now - tm < 60000);
      if (hits.length >= 20 || limiter.hit(`enhanceDay:${req.ip}`, [{ max: 200, ms: 24 * 3600e3 }])) throw new HttpError(429, 'aiLimit');
      enhanceHits.set(req.ip, [...hits, now]);
      if (enhanceHits.size > 5000) enhanceHits.clear();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 32 || !isPhotoFile(buf)) throw new HttpError(400, 'enhanceBad');
      const want = Math.min(4, Math.max(1, Number(req.get('x-scale')) || 2));
      const out = await printfiles.enhancePhoto(buf, want).catch(() => { throw new HttpError(400, 'enhanceBad'); });
      res.set('X-Scale', String(out.scale));
      res.set('Access-Control-Expose-Headers', 'X-Scale');
      res.type(out.format).send(out.data);
    } catch (e) {
      next(e);
    }
  });

  // ---------- AI background removal for customers' photos ----------
  app.get('/api/remove-bg', (req, res) => res.json({ ai: bgremove.available() }));
  app.post('/api/remove-bg', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '15mb' }), async (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 32 || !isPhotoFile(buf)) throw new HttpError(400, 'enhanceBad');
      rateLimit(req, 'removeBg');
      rateLimit(req, 'removeBgAll', '*');
      const t0 = Date.now();
      let png;
      try {
        png = await bgremove.removeBackground(buf, { dataDir, maxPx: Math.min(4000, Math.max(300, Number(req.get('x-max-px')) || 3000)) });
      } catch (e) {
        if (!(e instanceof bgremove.BgError)) throw e;
        if (e.reason !== 'busy' && e.reason !== 'off') console.warn('[bg] could not remove a background:', e.reason, String(e.detail || '').slice(0, 300));
        if (e.reason === 'bad') throw new HttpError(400, 'enhanceBad');
        throw new HttpError(503, e.reason === 'busy' ? 'bgBusy' : e.reason === 'loading' ? 'bgLoading' : 'bgFailed');
      }
      res.set('X-Took-Ms', String(Date.now() - t0));
      res.type('image/png').send(png);
    } catch (e) {
      next(e);
    }
  });
  // Get the model ready in the background, so the first customer doesn't wait for the download.
  if (cleanupEvery) setTimeout(() => bgremove.prepare(dataDir), 20e3).unref();

  // ---------- Illustrator (.ai) and EPS uploads ----------
  // Browsers cannot show these, so the server draws them to a transparent PNG.
  // ---------- Editor library: icons and stickers, searchable in Arabic and English ----------
  app.get('/api/assets/search', (req, res) => {
    const type = ['all', 'sticker', 'icon'].includes(req.query.type) ? req.query.type : 'all';
    const page = Math.min(200, Math.max(0, parseInt(req.query.page, 10) || 0));
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(assets.search(String(req.query.q || '').slice(0, 80), { type, page }));
  });
  app.get('/api/assets/credits', (req, res) => res.json({ sets: assets.credits() }));
  // One icon or sticker (templates name them by id and fetch them when drawn).
  app.get('/api/assets/icon/:id', (req, res) => {
    const id = String(req.params.id || '');
    const it = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,80}$/.test(id) ? assets.get(id) : null;
    if (!it) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.json(it);
  });

  // ---------- Import a design from a link (another shop's product page or an image link) ----------
  const importError = (e) => (e instanceof importer.ImportError ? new HttpError(['importBadUrl', 'importBlocked'].includes(e.code) ? 400 : 422, e.code) : e);
  app.post('/api/import/link', express.json({ limit: '8kb' }), async (req, res, next) => {
    try {
      rateLimit(req, 'importLink');
      const out = await importer.readLink((req.body || {}).url, importGet);
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) {
      if (e instanceof importer.ImportError && !['importBadUrl', 'importBlocked'].includes(e.code)) console.warn('[import] link:', e.code, e.message);
      next(importError(e));
    }
  });
  app.get('/api/import/image', async (req, res, next) => {
    try {
      rateLimit(req, 'importImage');
      const maxPx = Math.min(6000, Math.max(500, parseInt(req.get('x-max-px'), 10) || 4000));
      const img = await importer.fetchImage(String(req.query.url || ''), { maxPx, thumb: req.query.thumb ? 320 : 0 }, importGet);
      res.set('Cache-Control', 'private, max-age=900, no-transform');
      res.set('X-Image-Size', `${img.width}x${img.height}`);
      res.type(img.type).send(img.body);
    } catch (e) {
      next(importError(e));
    }
  });
  // Rights holders ask for a design to be taken down: kept for the admin and emailed to the shop.
  app.post('/api/takedown', express.json({ limit: '20kb' }), (req, res) => {
    const b = req.body || {};
    // (Text only, without invisible direction marks: "\u202Eدمحم" would show as another name to the team. QA 25 Nov.)
    const clean = (v, n) => (typeof v === 'string' ? v : '').replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);
    const reqst = { name: clean(b.name, 120), contact: clean(b.contact, 200), owner: clean(b.owner, 200), link: clean(b.link, 500), details: (typeof b.details === 'string' ? b.details : '').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 3000) };
    if (reqst.name.length < 2 || reqst.contact.length < 5 || reqst.details.length < 10) throw new HttpError(400, 'takedownMissing');
    rateLimit(req, 'takedown');
    const saved = store.mutate((db) => {
      db.takedowns ||= [];
      const t = { id: crypto.randomUUID(), at: new Date().toISOString(), ...reqst, status: 'new' };
      db.takedowns.push(t);
      return t;
    });
    // To the owner like a new order (WhatsApp and email, within the shop's alert limit), and listed in
    // Admin → Rights requests (QA 25 Nov: they were kept but nobody was told).
    if (!limiter.hit('notify:*', LIMITS.notify)) notify.rightsRequest(saved, { origin: linkBase(req) }).catch((e) => console.warn('[takedown] alert failed:', e.message));
    else console.warn('[takedown] alert skipped: too many alerts this hour (the request is in the admin)');
    res.status(201).json({ ok: true });
  });

  // One file at a time per visitor: two looping files from one visitor took both converter turns and kept every other
  // customer waiting (QA 26 Nov). A visitor's next file waits for their own one before.
  const artQueues = new Map();
  function oneAtATime(key, fn) {
    const prev = artQueues.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => {}, () => {});
    artQueues.set(key, tail);
    tail.then(() => { if (artQueues.get(key) === tail) artQueues.delete(key); });
    return run;
  }
  app.post('/api/artwork', (req, res, next) => {
    // Counted before the file is read, so repeated big uploads can't hold the server's memory (QA 25 Nov).
    rateLimit(req, 'artwork');
    next();
  }, express.raw({ type: () => true, limit: '40mb' }), async (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!artwork.sniff(buf)) throw new HttpError(400, 'artworkType');
      const px = Math.min(4000, Math.max(500, Number(req.get('x-max-px')) || 3000));
      let out;
      try {
        out = await oneAtATime(req.ip, () => artwork.convertArtwork(buf, { px }));
      } catch (e) {
        if (!(e instanceof artwork.ArtworkError)) throw e;
        if (e.reason === 'busy') throw new HttpError(429, 'artworkBusy');
        console.warn('[artwork] could not convert a', artwork.sniff(buf).kind, 'file of', buf.length, 'bytes:', e.reason, String(e.detail || '').slice(0, 400));
        throw new HttpError(400, e.reason === 'empty' ? 'artworkEmpty' : e.reason === 'locked' ? 'artworkLocked' : 'artworkBad');
      }
      // Several artboards (a logo "master" .ai): the first is drawn, and the editor says so.
      if (out.pages > 1) res.set('X-Artwork-Pages', String(Math.min(out.pages, 999)));
      // A photo saved as PDF / EPS, drawn bigger than its own pixels: how many real pixels it has, for the print
      // check (QA 26 Nov: a 300 x 200 photo passed as "ready to print").
      if (out.photoPx && out.photoPx.w > 0 && out.photoPx.h > 0) res.set('X-Artwork-Photo-Px', `${Math.round(out.photoPx.w)}x${Math.round(out.photoPx.h)}`);
      res.type('image/png').send(out.png);
    } catch (e) {
      next(e);
    }
  });

  // Booklets: a whole PDF, one picture per page, to put on the booklet's pages in order.
  // The PDF is kept for 45 days (designs copy it): the booklet print files are made from its pages.
  const pdfUploadsDir = path.join(dataDir, 'pdf-uploads');
  const PDF_ID_RE = /^[a-f0-9]{24}$/;
  app.post('/api/artwork/pages', (req, res, next) => {
    // Counted before the file is read, so repeated big uploads can't hold the server's memory (QA 25 Nov).
    rateLimit(req, 'artwork');
    next();
  }, express.raw({ type: () => true, limit: '60mb' }), async (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const kind = artwork.sniff(buf);
      if (!kind || kind.kind !== 'pdf') throw new HttpError(400, 'pdfOnly');
      const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || d));
      const max = clamp(req.get('x-max-pages'), 1, 40, 32);
      // The shop's daily room for kept PDFs, checked before the work and taken only for a PDF that is kept.
      const mb = buf.length / 1048576;
      if (!shopBudgetLeft('pdfPagesMB', LIMITS.pdfPagesMB, mb)) throw new HttpError(429, 'pdfBudget');
      let out;
      try {
        out = await oneAtATime(req.ip, () => artwork.pdfPages(buf, { max }));
      } catch (e) {
        if (!(e instanceof artwork.ArtworkError)) throw e;
        if (e.reason === 'busy') throw new HttpError(429, 'artworkBusy');
        console.warn('[artwork] could not read the pages of a PDF of', buf.length, 'bytes:', e.reason, String(e.detail || '').slice(0, 400));
        // A PDF locked with a password says so (it can't be read until it's saved without one).
        throw new HttpError(400, /\/Encrypt\b/.test(buf.subarray(0, Math.min(buf.length, 4e6)).toString('latin1')) || /\/Encrypt\b/.test(buf.subarray(Math.max(0, buf.length - 2e5)).toString('latin1')) ? 'pdfLocked' : 'pdfBad');
      }
      if (!takeShopBudget('pdfPagesMB', LIMITS.pdfPagesMB, mb)) throw new HttpError(429, 'pdfBudget');
      // The PDF itself is kept (its pages are what gets printed; the pictures are only for the screen).
      const pdfId = crypto.randomBytes(12).toString('hex');
      fs.mkdirSync(pdfUploadsDir, { recursive: true });
      fs.writeFileSync(path.join(pdfUploadsDir, `${pdfId}.pdf`), artwork.sniff(buf).data);
      fs.writeFileSync(path.join(pdfUploadsDir, `${pdfId}.json`), JSON.stringify({ boxes: out.boxes, count: out.count }));
      res.set('Cache-Control', 'no-store');
      res.json({ pdfId, pages: out.pages.map((b) => `data:image/jpeg;base64,${b.toString('base64')}`), pageNums: out.pageNums, boxes: out.boxes, count: out.count, more: out.more });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Shared designs (approval links) ----------
  const sharesDir = path.join(dataDir, 'shares');
  fs.mkdirSync(sharesDir, { recursive: true });
  const SHARE_RE = /^[A-Za-z0-9_-]{12}$/;
  const shareFile = (id, name) => path.join(sharesDir, id, name);
  function readShare(id) {
    if (!SHARE_RE.test(id || '')) return null;
    try {
      return JSON.parse(fs.readFileSync(shareFile(id, 'share.json'), 'utf8'));
    } catch (e) {
      return null;
    }
  }
  const writeShare = (share) => {
    const tmp = shareFile(share.id, `share.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(share));
    fs.renameSync(tmp, shareFile(share.id, 'share.json'));
  };
  const publicShare = (sh) => {
    const product = getProduct(sh.productId);
    return {
      id: sh.id,
      createdAt: sh.createdAt,
      productId: sh.productId,
      productName: product ? product.name : sh.productId,
      color: sh.color,
      size: sh.size && sh.size.open ? null : sh.size,
      sides: sh.sides.map((sd) => ({ id: sd.id, name: sd.name, preview: `/api/shares/${sh.id}/preview/${sd.id}.png` })),
      feedback: sh.feedback || [],
    };
  };
  const limitHits = (map, ip, max) => {
    const now = Date.now();
    const hits = (map.get(ip) || []).filter((tm) => now - tm < 60000);
    if (hits.length >= max) throw new HttpError(429, 'tooFast');
    map.set(ip, [...hits, now]);
    if (map.size > 5000) map.clear();
  };
  app.post('/api/shares', (req, res, next) => {
    rateLimit(req, 'shares');
    next();
  }, express.json({ limit: '15mb' }), asyncRoute(async (req, res) => {
    const b = req.body || {};
    const product = getProduct(b.productId);
    if (!product) throw new HttpError(400, 'unknownProduct', { id: String(b.productId || '').slice(0, 40) });
    // A new link: the robot check (invisible to people), as at checkout; signed-in customers passed it at sign-up
    // (owner, 26 Nov).
    if (!currentCustomer(req)) await checkCaptcha(req);
    const color = product.colors.find((c) => c.id === b.color) || product.colors[0];
    const size = product.sizes.find((z) => z.id === b.size) || product.sizes[0];
    const has = (id) => b.sides && b.sides[id] && Array.isArray(b.sides[id].objects) && b.sides[id].objects.length;
    const sides = product.sides.filter((sd) => has(sd.id));
    // The embroidery layer (on the front), shared with the rest.
    const host = product.embroidery && product.sides.find((sd) => sd.id === product.embroidery.side);
    if (host && has(EMB)) sides.push({ ...host, id: EMB, name: embSideName(host), emb: true });
    if (!sides.length) throw new HttpError(400, 'shareEmpty');
    const id = crypto.randomBytes(9).toString('base64url');
    fs.mkdirSync(path.join(sharesDir, id), { recursive: true });
    const editor = {};
    // Fabrics: the repeat style and tile size, checked as for a design (the shared copy opens with them).
    const asked = product.pattern && (Object.values(b.sides || {}).find((x) => x && x.pattern) || {}).pattern;
    const pattern = asked ? { repeat: REPEATS.includes(asked.repeat) ? asked.repeat : 'straight', tileCm: product.pattern.tiles.includes(Number(asked.tileCm)) ? Number(asked.tileCm) : product.pattern.tile } : null;
    for (const sd of sides) {
      const offset = sd.emb ? cleanEmbOffset(host, product.embroidery, b.sides[sd.id].offset) : cleanOffset(product, sd, size.id, b.sides[sd.id].offset);
      // The print area the objects were placed in (see placedAreaFor: hoodie fronts moved on 25 Nov 2026).
      const pa = b.sides[sd.id].area;
      const area = pa && typeof pa === 'object' && ['x', 'y', 'w', 'h'].every((k) => typeof pa[k] === 'number' && Number.isFinite(pa[k])) && pa.w > 0 && pa.h > 0 ? { x: pa.x, y: pa.y, w: pa.w, h: pa.h } : null;
      editor[sd.id] = { objects: b.sides[sd.id].objects, ...(offset ? { offset } : {}), ...(pattern ? { pattern } : {}), ...(area ? { area } : {}) };
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String((b.previews || {})[sd.id] || ''));
      const png = m ? Buffer.from(m[1], 'base64') : null;
      if (!png || png.length > 4e6 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badImage');
      fs.writeFileSync(shareFile(id, `${sd.id}.png`), png);
    }
    fs.writeFileSync(shareFile(id, 'editor.json'), JSON.stringify(editor));
    // Its options (a booklet's binding...), so "Open a copy" starts from the same ones. Unknown ones are
    // left out: a share is not an order.
    const picked = cleanOptions(product, b.options);
    const share = {
      id, createdAt: new Date().toISOString(), productId: product.id,
      // (No size chosen yet: the shared copy opens on the first one, but the share page doesn't name it, QA 25 Nov.)
      color: { id: color.id, name: color.name, hex: color.hex }, size: { id: size.id, label: size.label, ...(b.sizePicked === false && product.sizes.length > 1 ? { open: true } : {}) },
      ...(picked.options ? { options: picked.options } : {}),
      sides: sides.map((sd) => ({ id: sd.id, name: sd.name })), feedback: [],
    };
    writeShare(share);
    res.status(201).json(publicShare(share));
  }));
  // ---------- View-only links: flip through a booklet, or see both sides (owner's decision, 26 Nov) ----------
  // Whoever has the link only looks (no approval, comments, prices or customer details); it shows the latest version
  // the customer saved (the editor sends the pictures again with the link's own key) and stops 60 days after that.
  const views = new Views(dataDir);
  const viewable = (p) => Boolean(p) && p.kind !== 'book' && (Boolean(p.paged) || p.sides.length >= 2);
  const viewErr = (e) => (e instanceof ViewError ? new HttpError(e.status, e.code) : e);
  /** The pictures and how a booklet turns (an Arabic one, bound on the right, unless the left binding was chosen). */
  function viewPictures(product, b) {
    try {
      return { pics: views.clean(b.pages, product.sides.map((sd) => ({ id: sd.id, name: sd.name }))), kind: product.paged ? 'pages' : 'sides', rtl: Boolean(product.paged) && !(b.options && b.options.binding === 'left') };
    } catch (e) {
      throw viewErr(e);
    }
  }
  app.post('/api/views', (req, res, next) => { rateLimit(req, 'views'); next(); }, express.json({ limit: '40mb' }), asyncRoute(async (req, res) => {
    const b = req.body || {};
    const product = getProduct(b.productId);
    if (!viewable(product)) throw new HttpError(400, 'viewProduct');
    const { pics, kind, rtl } = viewPictures(product, b);
    // A new link: the robot check (invisible to people); signed-in customers passed it at sign-up (owner, 26 Nov).
    if (!currentCustomer(req)) await checkCaptcha(req);
    if (!takeShopBudget('viewsMB', LIMITS.viewsMB, Math.max(1, Math.ceil(pics.reduce((n, p) => n + p.data.length, 0) / 1e6)))) throw new HttpError(429, 'tooManyWait', { min: 60 });
    const { view, key } = views.create({ productId: product.id, kind, rtl, pics });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ id: view.id, key, url: `/view?id=${view.id}` });
  }));
  // The customer's newer version (with the link's key): the same link shows it.
  app.put('/api/views/:id', (req, res, next) => { rateLimit(req, 'views'); next(); }, express.json({ limit: '40mb' }), (req, res) => {
    let v;
    try { v = views.owned(req.params.id, req.get('x-view-key')); } catch (e) { throw viewErr(e); }
    const b = req.body || {};
    const product = getProduct(b.productId);
    if (!viewable(product)) throw new HttpError(400, 'viewProduct');
    const { pics, kind, rtl } = viewPictures(product, b);
    // (Its older pictures go: an update doesn't add to the disk. Read again and written while no other copy of the app
    // writes it: 16 updates on two copies ended at version 13. Tester 1, 26 Nov.)
    v = store.exclusive(() => {
      const now = views.read(v.id) || v;
      Object.assign(now, { productId: product.id, kind, rtl });
      return views.put(now, pics);
    });
    res.set('Cache-Control', 'no-store');
    res.json({ id: v.id, url: `/view?id=${v.id}`, updatedAt: v.updatedAt });
  });
  app.delete('/api/views/:id', (req, res) => {
    try { views.owned(req.params.id, req.get('x-view-key')); } catch (e) { throw viewErr(e); }
    views.remove(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/views/:id', (req, res) => {
    const v = views.read(req.params.id);
    if (!v) throw new HttpError(404, 'viewNotFound');
    if (!views.live(v)) throw new HttpError(410, 'viewExpired');
    const product = getProduct(v.productId);
    res.set('Cache-Control', 'no-store');
    res.json({
      id: v.id,
      productId: v.productId,
      productName: product ? product.name : { en: v.productId, ar: v.productId },
      kind: v.kind,
      rtl: Boolean(v.rtl),
      pages: v.pages.map((p, n) => ({ name: p.name, url: `/api/views/${v.id}/page/${n}.${p.file.split('.').pop()}?v=${v.version}`, w: p.w, h: p.h })),
      updatedAt: v.updatedAt,
      makeOwn: `/product?id=${encodeURIComponent(v.productId)}`,
    });
  });
  app.get('/api/views/:id/page/:n.:ext', (req, res) => {
    const v = views.read(req.params.id);
    const p = v && views.live(v) && /^\d{1,2}$/.test(req.params.n) && v.pages[Number(req.params.n)];
    if (!p || p.file.split('.').pop() !== req.params.ext) throw new HttpError(404, 'viewNotFound');
    let data;
    try {
      data = fs.readFileSync(views.file(v.id, p.file));
    } catch (e) {
      throw new HttpError(404, 'viewNotFound'); // (a newer version replaced it just now, from another copy of the app)
    }
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type(req.params.ext === 'png' ? 'png' : 'jpeg').send(data);
  });

  app.get('/api/shares/:id', (req, res) => {
    const sh = readShare(req.params.id);
    if (!sh) throw new HttpError(404, 'shareNotFound');
    res.set('Cache-Control', 'no-store');
    res.json(publicShare(sh));
  });
  app.get('/api/shares/:id/design', (req, res) => {
    const sh = readShare(req.params.id);
    if (!sh) throw new HttpError(404, 'shareNotFound');
    const editor = JSON.parse(fs.readFileSync(shareFile(sh.id, 'editor.json'), 'utf8'));
    res.json({ productId: sh.productId, color: sh.color.id, size: sh.size.id, options: sh.options || null, editor });
  });
  app.get('/api/shares/:id/preview/:side.png', (req, res) => {
    const sh = readShare(req.params.id);
    const sd = sh && sh.sides.find((x) => x.id === req.params.side);
    if (!sd) throw new HttpError(404, 'shareNotFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type('png').send(fs.readFileSync(shareFile(sh.id, `${sd.id}.png`)));
  });
  const feedbackHits = new Map();
  app.post('/api/shares/:id/feedback', express.json({ limit: '4kb' }), (req, res) => {
    limitHits(feedbackHits, req.ip, 6);
    const sh = readShare(req.params.id);
    if (!sh) throw new HttpError(404, 'shareNotFound');
    const b = req.body || {};
    const vote = b.vote === 'up' ? 'up' : 'change';
    // (Direction controls go too: "\u202Eabc" would show reversed or spoof another reply.)
    const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
    // (Text only: {"a":1} isn't a name. Cut by whole characters, so an emoji at the end isn't halved.)
    const cut = (v, n) => Array.from(v).slice(0, n).join('');
    const comment = cut((typeof b.comment === 'string' ? b.comment : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(BIDI, '').trim(), 500);
    const name = cut((typeof b.name === 'string' ? b.name : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(BIDI, '').trim(), 40);
    if (vote === 'change' && !comment) throw new HttpError(400, 'feedbackEmpty');
    // (Read again, changed and written while no other copy of the app writes it: two copies taking replies at once
    // lost some. Tester 1, 26 Nov.)
    const saved = store.exclusive(() => {
      const now = readShare(req.params.id) || sh;
      now.feedback = (now.feedback || []).slice(-99);
      now.feedback.push({ vote, comment, name, at: new Date().toISOString() });
      writeShare(now);
      return now;
    });
    res.status(201).json(publicShare(saved));
  });

  const proofHits = new Map();
  app.post('/api/proof', express.raw({ type: 'image/png', limit: '6mb' }), async (req, res, next) => {
    try {
      const now = Date.now();
      const hits = (proofHits.get(req.ip) || []).filter((tm) => now - tm < 60000);
      if (hits.length >= 30) throw new HttpError(429, 'tooFast');
      proofHits.set(req.ip, [...hits, now]);
      if (proofHits.size > 5000) proofHits.clear();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badImage');
      let out;
      try {
        out = await printfiles.cmykProof(buf);
      } catch (e) {
        throw new HttpError(400, 'badImage'); // a broken or impossibly large PNG
      }
      res.type('png').send(out);
    } catch (e) {
      next(e);
    }
  });

  // Re-open a saved design in the editor.
  app.get('/api/designs/:id', (req, res) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    // Books and photo sets are not opened in the editor (a book's answers stay private to its edit token).
    if (!design || design.kind === 'book' || design.kind === 'photoset' || design.kind === 'gangsheet') throw new HttpError(404, 'designNotFound');
    let editor;
    try {
      editor = JSON.parse(fs.readFileSync(store.designFile(design.id, 'editor.json'), 'utf8'));
    } catch (e) {
      throw new HttpError(404, 'designNotFound');
    }
    // A design id is in public picture links: it must not lead to the order (and the customer) it is in.
    // Nor to what was paid: the editor works prices out itself (the team sees design ids, and the
    // amounts are only for people allowed to see them).
    const { uploadTokenHash, listKeyHash, cartKeyHash, orderId, revisionOf, price, unitPrice, ...pub } = design; // eslint-disable-line no-unused-vars
    if (Array.isArray(pub.quantities)) pub.quantities = withoutLinePrices(pub.quantities);
    // The names only for who may read them (else the editor asks for the list again).
    const list = design.merge && listOpenFor(req, design) ? readMergeList(design) : null;
    res.set('Cache-Control', 'no-store');
    res.json({ ...pub, editor, ...(list ? { mergeList: list } : design.merge ? { mergeLocked: true } : {}) });
  });

  // Mockup previews are public (design ids are unguessable); print files are admin-only.
  app.get('/files/designs/:id/:side-preview.png', (req, res) => {
    const { id, side } = req.params;
    const design = UUID_RE.test(id) && store.getDesign(id);
    if (!design || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'notFound');
    if (design.kind === 'book') {
      // A child's photo: never kept in shared caches, and gone once the photo is deleted.
      if (design.photoRemoved) return res.redirect(302, `/api/books/${encodeURIComponent(design.bookId)}/sample/0.jpg`);
      res.set('Cache-Control', 'private, no-store');
    } else {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.sendFile(store.designFile(id, `${side}-preview.png`));
  });

  // The production file as the customer approves it (a smaller copy, transparent background).
  app.get('/files/designs/:id/:side-proof.png', (req, res) => {
    const { id, side } = req.params;
    const design = UUID_RE.test(id) && store.getDesign(id);
    if (!design || design.kind === 'book' || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'notFound');
    const f = store.designFile(id, `${side}-proof.png`);
    if (!fs.existsSync(f)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=300, no-transform');
    res.sendFile(f);
  });

  // ---------- Photo prints: many photos, one cart item ----------
  // The photos page crops each photo in the browser and uploads a print-ready JPEG at 300 DPI
  // (border drawn in) plus a small picture; the set is a design of kind "photoset".
  const photoProduct = () => PRODUCTS.find((p) => p.kind === 'photoset') || null;
  const photoPx = (cm, dpi) => Math.round((cm / 2.54) * dpi);
  const pad3 = (n) => String(n).padStart(3, '0');
  /** "12 photos · 18 prints" in both languages. */
  const photoSetLabel = (photos, prints) => {
    // Arabic counting: 3–10 (and 103–110, 203–210…) take the plural, other numbers the singular.
    const arN = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
    const ar = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${arN(n)} ${few}` : `${arN(n)} ${many}`);
    return {
      en: `${photos} photo${photos === 1 ? '' : 's'} · ${prints} print${prints === 1 ? '' : 's'}`,
      ar: `${ar(photos, 'صورة واحدة', 'صورتين', 'صور', 'صورة')} · ${ar(prints, 'نسخة واحدة', 'نسختين', 'نسخ', 'نسخة')}`,
    };
  };
  app.post('/api/photosets', (req, res, next) => {
    rateLimit(req, 'designs');
    rateLimit(req, 'designsAll', '*');
    next();
  }, express.json({ limit: '200kb' }), (req, res) => {
    const product = photoProduct();
    if (!product) throw new HttpError(404, 'unknownProduct');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const colorDef = product.colors.find((c) => c.id === body.color);
    if (!colorDef) throw new HttpError(400, 'unknownColor');
    // Photo prints paused, or this border / size switched off or sold out: not orderable.
    const name = product.name[langOf(req)] || product.name.en;
    const off = catalog.unavailable(product, { colorId: colorDef.id });
    if (off) throw new HttpError(409, off, { name });
    const picked = cleanOptions(product, body.options);
    if (picked.error) throw new HttpError(400, 'badOption');
    const cfg = product.photo;
    const asked = Array.isArray(body.photos) ? body.photos : [];
    if (!asked.length || asked.length > cfg.maxPhotos) throw new HttpError(400, 'photosCount', { max: cfg.maxPhotos });
    const photos = asked.map((ph, i) => {
      const p = ph && typeof ph === 'object' ? ph : {};
      const sizeDef = product.sizes.find((z) => z.id === p.size);
      if (!sizeDef) throw new HttpError(400, 'unknownSize');
      const sizeOff = catalog.unavailable(product, { colorId: colorDef.id, sizeId: sizeDef.id });
      if (sizeOff) throw new HttpError(409, sizeOff, { name });
      const copies = Number(p.copies);
      if (!Number.isInteger(copies) || copies < 1 || copies > cfg.maxCopies) throw new HttpError(400, 'photoCopies', { max: cfg.maxCopies });
      const orientation = p.orientation === 'landscape' ? 'landscape' : 'portrait';
      const [a, b] = [photoPx(sizeDef.cm[0], cfg.dpi), photoPx(sizeDef.cm[1], cfg.dpi)];
      const dpi = Number.isFinite(Number(p.dpi)) && Number(p.dpi) > 0 ? Math.min(10000, Math.round(Number(p.dpi))) : null;
      const n = i + 1;
      return { n, file: `photo-${pad3(n)}.jpg`, thumb: `thumb-${pad3(n)}.jpg`, size: { id: sizeDef.id, label: sizeDef.label }, copies, orientation, px: orientation === 'landscape' ? [b, a] : [a, b], dpi };
    });
    const prints = photos.reduce((n, p) => n + p.copies, 0);
    const token = crypto.randomBytes(24).toString('hex');
    const design = {
      id: crypto.randomUUID(),
      kind: 'photoset',
      createdAt: new Date().toISOString(),
      status: 'uploading',
      uploadTokenHash: sha(token),
      productId: product.id,
      productName: product.name,
      process: product.process,
      ...(picked.options ? { options: picked.options } : {}),
      color: { id: colorDef.id, name: colorDef.name, hex: colorDef.hex },
      size: { id: 'set', label: withOptions(photoSetLabel(photos.length, prints), picked.options) },
      sides: [{ id: 'front', name: product.sides[0].name }],
      photos,
      copies: prints,
      price: 0,
      version: 1,
      currency: CURRENCY,
      orderId: null,
    };
    design.price = designPrice({ ...design, status: 'ready' });
    if (design.price == null) throw new HttpError(400, 'unknownSize');
    const files = photos.flatMap((p) => [p.file, p.thumb]);
    design.expectedFiles = files;
    store.createDesign(design, { 'editor.json': '{}' });
    res.status(201).json({ id: design.id, uploadToken: token, files, price: design.price });
  });
  /** On /complete: every photo the exact size, then the contact sheet shown in the cart, proof and admin. */
  async function completePhotoset(design) {
    for (const p of design.photos) {
      for (const name of [p.file, p.thumb]) if (!fs.existsSync(store.designFile(design.id, name))) throw new HttpError(400, 'photoMissing', { n: p.n });
      let meta;
      try {
        meta = await sharp()(store.designFile(design.id, p.file)).metadata();
      } catch (e) {
        throw new HttpError(400, 'photoSize', { n: p.n });
      }
      if (meta.format !== 'jpeg' || meta.width !== p.px[0] || meta.height !== p.px[1]) throw new HttpError(400, 'photoSize', { n: p.n });
      // Browsers save canvas JPEGs at "72 DPI": mark them 300 DPI so a print shop's software prints them
      // at their real size (only the header changes, the picture is not re-compressed).
      const file = store.designFile(design.id, p.file);
      store.writeDesignFile(design.id, p.file, jpegWithDpi(fs.readFileSync(file), 300));
    }
    const sheet = await photoContactSheet(design);
    store.writeDesignFile(design.id, 'front-preview.png', sheet);
    store.writeDesignFile(design.id, 'front-proof.png', sheet);
    const dpis = design.photos.map((p) => p.dpi).filter(Boolean);
    design.sides[0].dpi = dpis.length ? Math.min(...dpis) : 300;
  }
  /** The photos side by side (at most 36; "+N" for the rest), each with its size and copies. */
  async function photoContactSheet(design) {
    const CELL = 240;
    const shown = design.photos.slice(0, design.photos.length > 36 ? 35 : 36);
    const more = design.photos.length - shown.length;
    const count = shown.length + (more ? 1 : 0);
    const cols = Math.min(6, count);
    const rows = Math.ceil(count / cols);
    const tiles = [];
    for (const [k, p] of shown.entries()) {
      const x = (k % cols) * CELL;
      const y = Math.floor(k / cols) * CELL;
      const pic = await sharp()(store.designFile(design.id, p.thumb)).resize(196, 186, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
      tiles.push({ input: pic.data, left: x + Math.round((CELL - pic.info.width) / 2), top: y + 8 + Math.round((186 - pic.info.height) / 2) });
      const label = `${p.n}. ${p.size.id.replace('x', '×')}${p.copies > 1 ? ` ×${p.copies}` : ''}`;
      tiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="36"><text x="${CELL / 2}" y="24" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#333">${label}</text></svg>`), left: x, top: y + 198 });
    }
    if (more) {
      const k = shown.length;
      tiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><rect x="22" y="8" width="196" height="186" rx="8" fill="#e9ecef"/><text x="${CELL / 2}" y="112" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="700" fill="#555">+${more}</text></svg>`), left: (k % cols) * CELL, top: Math.floor(k / cols) * CELL });
    }
    return sharp()({ create: { width: cols * CELL, height: rows * CELL, channels: 3, background: '#f7f7f8' } }).composite(tiles).png({ compressionLevel: 8 }).toBuffer();
  }
  // One photo's small picture (for the proof and the admin): private, like the previews.
  app.get('/files/designs/:id/photos/:n.jpg', (req, res) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    const p = design && design.kind === 'photoset' && design.photos.find((x) => String(x.n) === req.params.n);
    if (!p || design.status !== 'ready') throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'private, max-age=3600, no-transform');
    res.sendFile(store.designFile(design.id, p.thumb));
  });
  /** The print shop's download: every photo, named by size and copies, sorted by size, with a list. */
  async function photosZip(design, base) {
    const target = store.designFile(design.id, `photos-v${design.version || 1}.zip`);
    if (!fs.existsSync(target)) {
      const product = getProduct(design.productId);
      const order = (product && product.sizes.map((z) => z.id)) || [];
      const sorted = [...design.photos].sort((a, b) => order.indexOf(a.size.id) - order.indexOf(b.size.id) || a.n - b.n);
      const paper = pickEn(design.color.name);
      const border = design.options && design.options.border ? pickEn(design.options.border.name) : 'Borderless';
      const list = ['Photo,Size (cm),Copies,Orientation,File', ...sorted.map((p) => [p.n, p.size.id, p.copies, p.orientation, `${p.size.id}/${pad3(p.n)}_${p.size.id}_x${p.copies}.jpg`].join(','))];
      const totals = order.map((id) => [id, sorted.filter((p) => p.size.id === id).reduce((n, p) => n + p.copies, 0)]).filter(([, n]) => n);
      const readme = `${base}\r\nPaper: ${paper} · ${border} · 300 DPI, print at 100%\r\n${totals.map(([id, n]) => `${id} cm: ${n} print${n === 1 ? '' : 's'}`).join('\r\n')}\r\n`;
      async function* gen() {
        yield { name: 'README.txt', data: Buffer.from(readme) };
        yield { name: 'list.csv', data: Buffer.from(list.join('\r\n') + '\r\n') };
        for (const p of sorted) yield { name: `${p.size.id}/${pad3(p.n)}_${p.size.id}_x${p.copies}.jpg`, data: fs.readFileSync(store.designFile(design.id, p.file)) };
      }
      // Up to 100 photos of up to 15 MB each (ZIP files stay under 4 GB).
      await merge.writeZip(target, gen(), { maxBytes: 3.5e9 });
    }
    return { path: target, name: `${base}-photos.zip` };
  }

  // ---------- Personalised children's books ----------
  // A book is a design of kind "book": the answers and the child's photo are
  // kept with it, and every page (previews and the print PDF) is drawn on the
  // server from them. Until it is ordered the shopper can change it with the
  // edit token. Photos are deleted 30 days after the book is shipped.
  const bookFor = (id) => (Object.prototype.hasOwnProperty.call(books.BOOKS, id) ? books.BOOKS[id] : null);
  const bookProduct = (book) => PRODUCTS.find((p) => p.kind === 'book' && p.book === book.id);
  app.get('/api/books', (req, res) => res.json({ ai: cartoon.enabled(), books: Object.values(books.BOOKS).map(books.publicBook) }));
  // (Pictures here and in the routes like it carry no-transform: the hosting's CDN re-made them as WebP for phones,
  // as it shrank the design pictures. QA 26 Nov.)
  app.get('/api/books/companion/:id.png', (req, res) => {
    const file = books.companionPath(req.params.id);
    if (!file) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type('png').sendFile(file);
  });
  app.get('/api/books/:id', (req, res) => {
    const book = bookFor(req.params.id);
    if (!book) throw new HttpError(404, 'notFound');
    res.json({ ...books.publicBook(book), ai: cartoon.enabled() });
  });
  // A sample cover (no photo) for product cards and the book page before a photo is added.
  const samples = new Map();
  app.get('/api/books/:id/sample/:n.jpg', async (req, res, next) => {
    try {
      const book = bookFor(req.params.id);
      const n = Number(req.params.n);
      const lang = 'en';
      if (!book || !Number.isInteger(n) || n < 0 || n >= book.pages.length) throw new HttpError(404, 'notFound');
      const key = `${book.id}|${n}|${lang}`;
      if (!samples.has(key)) {
        if (samples.size > 100) samples.clear();
        const answers = { name: 'Your child', gender: 'boy', birthday: '2020-01-01', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar', dedication: '' };
        samples.set(key, books.pageJpeg({ book, answers, lang }, n, 720).catch((e) => { samples.delete(key); throw e; }));
      }
      res.set('Cache-Control', 'public, max-age=86400, no-transform');
      res.type('jpeg').send(await samples.get(key));
    } catch (e) {
      next(e);
    }
  });

  const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
  async function readFace(dataUrl) {
    const m = DATA_URL_RE.exec(String(dataUrl || ''));
    if (!m) throw new HttpError(400, 'bookPhoto');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 100 || buf.length > 8e6) throw new HttpError(400, 'bookPhoto');
    try {
      return await sharp()(buf, { limitInputPixels: 40e6 }).rotate().resize(720, 900, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    } catch (e) {
      throw new HttpError(400, 'bookPhoto');
    }
  }
  const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
  /** Everything the renderer needs: answers, the face (AI cartoon if there is one), redrawn pages. */
  const bookData = (design, { withRedraws = true } = {}) => {
    const f = (name) => store.designFile(design.id, name);
    const book = bookFor(design.bookId);
    const redrawn = {};
    if (withRedraws) book.pages.forEach((_, i) => { const r = readIf(f(`redraw-${i}.jpg`)); if (r) redrawn[i] = r; });
    return {
      book,
      answers: design.answers,
      lang: design.lang,
      face: readIf(f('face-cartoon.jpg')) || readIf(f('face.jpg')),
      faceLine: readIf(f('face-line.png')),
      redrawn,
    };
  };
  /** The AI cartoon face for previews: once per photo, within the daily limits. */
  async function makeCartoon(design, ip) {
    const book = bookFor(design.bookId);
    const photo = readIf(store.designFile(design.id, 'face.jpg'));
    const drop = async (status, reason) => {
      fs.rmSync(store.designFile(design.id, 'face-cartoon.jpg'), { force: true });
      design.cartoon = { status, reason, at: new Date().toISOString() };
      if (book.kind === 'coloring' && photo) store.writeDesignFile(design.id, 'face-line.png', await books.lineArt(photo));
    };
    if (!design.aiConsent || !cartoon.enabled()) return drop('off');
    if (limiter.hit(`cartoon:${ip}`, LIMITS.cartoon) || limiter.hit('cartoonAll:*', LIMITS.cartoonAll)) return drop('limit');
    if (!takeShopBudget('cartoon', LIMITS.cartoonAll[0].max)) return drop('limit'); // shared by every copy of the app
    try {
      const face = await cartoon.cartoonFace(photo, fs.readFileSync(cartoon.STYLE_REFS[book.kind === 'coloring' ? 'coloring' : 'story']), book.kind);
      store.writeDesignFile(design.id, 'face-cartoon.jpg', face);
      if (book.kind === 'coloring') store.writeDesignFile(design.id, 'face-line.png', await books.lineArt(face));
      design.cartoon = { status: 'ready', at: new Date().toISOString() };
    } catch (e) {
      console.warn('[cartoon] face failed:', e.reason || '', e.message);
      await drop('failed', e.reason || 'failed');
    }
  }
  /**
   * The cover painted by the AI with the child in it, for the preview (the same as after an
   * order, which then skips it): a pasted face is what customers judge the book by first.
   * The real photo is the likeness; within the shop's daily drawing budget.
   */
  async function redrawCover(design) {
    const book = bookFor(design.bookId);
    const i = book.pages.findIndex((p) => p.type === 'cover' && p.face);
    if (i < 0 || !design.aiConsent || !cartoon.enabled()) return;
    const file = store.designFile(design.id, `redraw-${i}.jpg`);
    const photo = readIf(store.designFile(design.id, 'face.jpg'));
    if (fs.existsSync(file) || !photo) return;
    if (limiter.hit('redrawAll:*', LIMITS.redrawAll) || !takeShopBudget('redraw', LIMITS.redrawAll[0].max)) return;
    try {
      const data = { ...bookData(design, { withRedraws: false }), face: photo };
      const input = await (await books.renderPage(data, i, 1024, { noText: true })).jpeg({ quality: 90 }).toBuffer();
      const img = await cartoon.redrawPage(input, photo, book.kind);
      store.writeDesignFile(design.id, `redraw-${i}.jpg`, await sharp()(img).resize(2048, 2048, { fit: 'cover' }).jpeg({ quality: 93 }).toBuffer());
    } catch (e) {
      console.warn('[redraw] preview cover failed:', e.reason || '', e.message);
    }
  }
  // Saves of one book run one after the other: a failed save restores the book as it was before
  // *it* started, which must not undo a save that finished in between (two tabs, a retry).
  const bookSaves = new Map();
  // Across copies of the app sharing the data folder, saves of one book also take turns: a lock file in the book's
  // folder while one runs (QA 26 Nov: two copies saving at once left one tab's name with the other tab's photo).
  // A copy that crashed mid-save leaves it behind: older than BOOK_LOCK_STALE, it no longer counts.
  const BOOK_LOCK = '.saving.lock';
  const BOOK_LOCK_STALE = 5 * 60e3;
  const bookLocked = (id) => {
    try {
      return Date.now() - fs.statSync(store.designFile(id, BOOK_LOCK)).mtimeMs < BOOK_LOCK_STALE;
    } catch (e) {
      return false;
    }
  };
  async function takeBookLock(id, waitMs = 90e3) {
    const start = Date.now();
    for (;;) {
      try {
        fs.writeFileSync(store.designFile(id, BOOK_LOCK), String(process.pid), { flag: 'wx' });
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (!bookLocked(id)) {
          fs.rmSync(store.designFile(id, BOOK_LOCK), { force: true });
          continue;
        }
        if (Date.now() - start > waitMs) throw new HttpError(409, 'bookSaving');
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  async function saveBook(design, body, ip, uiLang = 'en') {
    const prev = bookSaves.get(design.id) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      await takeBookLock(design.id);
      try {
        // What another copy saved (or ordered) while this one waited: this save starts from it.
        store.sync();
        if (design.orderId) throw new HttpError(409, 'designOrdered');
        return await saveBookAtomic(design, body, ip, uiLang);
      } finally {
        fs.rmSync(store.designFile(design.id, BOOK_LOCK), { force: true });
      }
    });
    bookSaves.set(design.id, run);
    try {
      return await run;
    } finally {
      if (bookSaves.get(design.id) === run) bookSaves.delete(design.id);
    }
  }
  async function saveBookAtomic(design, body, ip, uiLang) {
    // All or nothing: if anything fails (a page that can't be drawn, a bad photo),
    // the book stays exactly as it was, so a half-saved book can't be ordered.
    const before = JSON.parse(JSON.stringify(design));
    // The photo, its line drawing (colouring books), the AI-redrawn pages and the preview as they are:
    // a save that fails half way puts all of them back, so the book never prints a face the customer
    // didn't approve (QA 25 Nov: only the photo came back, the line drawing stayed the new one).
    const KEPT = (f) => f === 'face.jpg' || f === 'face-line.png' || f === 'face-cartoon.jpg' || f === 'book-preview.png' || /^redraw-\d+\.jpg$/.test(f);
    let names = [];
    try { names = fs.readdirSync(store.designDir(design.id)).filter(KEPT); } catch (e) { names = []; }
    const saved = new Map(names.map((f) => [f, fs.readFileSync(store.designFile(design.id, f))]));
    try {
      await saveBookNow(design, body, ip, uiLang);
    } catch (e) {
      // Ordered while this save was running: the book stays ordered (never put back to "not ordered").
      const fresh = store.getDesign(design.id);
      const orderId = design.orderId || (fresh && fresh.orderId) || null;
      for (const k of Object.keys(design)) delete design[k];
      Object.assign(design, before);
      if (orderId) design.orderId = orderId;
      try {
        for (const f of fs.readdirSync(store.designDir(design.id))) if (KEPT(f) && !saved.has(f)) fs.rmSync(store.designFile(design.id, f), { force: true });
      } catch (err) { /* no folder */ }
      for (const [f, buf] of saved) store.writeDesignFile(design.id, f, buf);
      store.save();
      throw e;
    }
  }
  async function saveBookNow(design, body, ip, uiLang = 'en') {
    const { answers, face, size, aiConsent } = body && typeof body === 'object' ? body : {};
    const book = bookFor(design.bookId);
    const product = bookProduct(book);
    // AI-redrawn pages show this child: a new photo or boy/girl makes them out of date (names and
    // other words are drawn on top of the picture afterwards, so they don't).
    const genderBefore = design.answers ? design.answers.gender : undefined;
    let answersChanged = false;
    try {
      design.answers = books.cleanAnswers(book, answers);
      answersChanged = (design.answers ? design.answers.gender : undefined) !== genderBefore;
    } catch (e) {
      if (e.message === 'bookMissing') throw new HttpError(400, 'fieldRequired', { field: e.field });
      if (e.message === 'bookLatin') throw new HttpError(400, 'bookLatin', { field: e.field });
      if (e.message === 'bookBadDate') throw new HttpError(400, 'bookBadDate', { field: e.field });
      throw e;
    }
    design.lang = 'en'; // books are printed in English
    // A cover (size) that is sold out or off (admin → Products) can't be chosen; with none asked for, the first one
    // that can (QA 26 Nov: a sold-out hardcover was still saved and ordered).
    const asked = product.sizes.find((z) => z.id === size);
    if (asked && catalog.unavailable(product, { sizeId: asked.id }) === 'sizeUnavailable') {
      // (The book's name in the page's language: the body's `lang` is the book's print language, always English.)
      throw new HttpError(409, 'bookCoverUnavailable', { name: product.name[uiLang] || product.name.en });
    }
    const sizeDef = asked || product.sizes.find((z) => !catalog.unavailable(product, { sizeId: z.id })) || product.sizes[0];
    design.size = { id: sizeDef.id, label: sizeDef.label };
    design.price = priceFor(product, sizeDef.id, 1);
    const consent = aiConsent === true;
    const consentChanged = consent !== Boolean(design.aiConsent);
    design.aiConsent = consent;
    if (face) {
      const jpg = await readFace(face);
      store.writeDesignFile(design.id, 'face.jpg', jpg);
      if (book.kind === 'coloring') store.writeDesignFile(design.id, 'face-line.png', await books.lineArt(jpg));
    }
    if (!fs.existsSync(store.designFile(design.id, 'face.jpg'))) throw new HttpError(400, 'bookPhoto');
    if (face || answersChanged || (consentChanged && !consent)) {
      for (const f of fs.readdirSync(store.designDir(design.id))) if (/^redraw-\d+\.jpg$/.test(f)) fs.rmSync(store.designFile(design.id, f), { force: true });
    }
    // New photo, or the AI choice changed: make (or drop) the cartoon face.
    // With the AI, the cover is painted right away (the other pages after the order), at the same time as the cartoon face.
    await Promise.all([
      face || consentChanged || (consent && cartoon.enabled() && !(design.cartoon && design.cartoon.status === 'ready')) ? makeCartoon(design, ip) : null,
      redrawCover(design),
    ]);
    if (design.orderId) throw new HttpError(409, 'designOrdered');
    fs.rmSync(store.designFile(design.id, 'book-print.pdf'), { force: true });
    fs.rmSync(store.designFile(design.id, 'book-preview.pdf'), { force: true });
    store.writeDesignFile(design.id, 'book-preview.png', await (await books.renderPage(bookData(design), 0, 600)).png().toBuffer());
    // Ordered while this save was running (here or on another copy of the app): the customer approved the book as it
    // was, which is what prints. Checked under the data lock with the latest data, and the new version saved in the
    // same step, so an order taken in between is never missed (QA 26 Nov); the save is then undone.
    store.mutate((db) => {
      const cur = db.designs[design.id];
      if (design.orderId || (cur && cur.orderId)) throw new HttpError(409, 'designOrdered');
      design.version = (design.version || 0) + 1;
    });
  }
  const bookResponse = (design, token) => {
    const { uploadTokenHash, answers, ...pub } = design; // eslint-disable-line no-unused-vars
    return { ...pub, ...(token ? { editToken: token } : {}), cartoon: design.cartoon ? design.cartoon.status : 'off', pages: bookFor(design.bookId).pages.length, previewUrl: `/files/designs/${design.id}/book-preview.png?v=${design.version}` };
  };

  app.post('/api/books/:id/designs', (req, res, next) => {
    rateLimit(req, 'designs');
    rateLimit(req, 'designsAll', '*');
    next();
  }, express.json({ limit: '10mb' }), async (req, res, next) => {
    try {
      const book = bookFor(req.params.id);
      if (!book) throw new HttpError(404, 'notFound');
      const product = bookProduct(book);
      // Paused or no longer sold (admin → Products).
      const why = catalog.unavailable(product);
      if (why) throw new HttpError(409, why, { name: product.name[langOf(req)] || product.name.en });
      const token = crypto.randomBytes(24).toString('hex');
      const side = product.sides[0];
      const px = books.PRINT_PX;
      const design = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: 'book',
        bookId: book.id,
        status: 'uploading',
        uploadTokenHash: sha(token),
        productId: product.id,
        productName: product.name,
        process: 'paper',
        color: { id: product.colors[0].id, name: product.colors[0].name, hex: product.colors[0].hex },
        size: { id: product.sizes[0].id, label: product.sizes[0].label },
        sides: [{ id: side.id, name: side.name, widthIn: books.TRIM_IN, heightIn: books.TRIM_IN, bleedIn: books.BLEED_IN, widthPx: px, heightPx: px, dpi: 300 }],
        price: product.basePrice,
        currency: CURRENCY,
        orderId: null,
      };
      store.createDesign(design, {});
      try {
        await saveBook(design, req.body || {}, req.ip, langOf(req));
      } catch (e) {
        fs.rmSync(store.designDir(design.id), { recursive: true, force: true });
        store.mutate((db) => { delete db.designs[design.id]; });
        throw e;
      }
      design.status = 'ready';
      store.save();
      res.status(201).json(bookResponse(design, token));
    } catch (e) {
      next(e);
    }
  });
  const editableBook = (req) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design || design.kind !== 'book') throw new HttpError(404, 'designNotFound');
    if (design.orderId || design.uploadTokenHash !== sha(req.get('x-edit-token') || '')) throw new HttpError(403, 'notFound');
    return design;
  };
  app.put('/api/books/designs/:id', (req, res, next) => {
    // (Each save redraws pages: limited like making a book.)
    rateLimit(req, 'bookSaves');
    next();
  }, express.json({ limit: '10mb' }), async (req, res, next) => {
    try {
      const design = editableBook(req);
      await saveBook(design, req.body || {}, req.ip, langOf(req));
      res.json(bookResponse(design));
    } catch (e) {
      next(e);
    }
  });
  // Re-open a book from the cart (answers come back; the photo stays on the server).
  app.get('/api/books/designs/:id', (req, res) => {
    const design = editableBook(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ...bookResponse(design), answers: design.answers, lang: design.lang });
  });
  // Page previews (the child's photo is in them, so they are never cached by shared caches).
  const pageCache = new Map();
  app.get('/api/books/designs/:id/pages/:n.jpg', async (req, res, next) => {
    try {
      const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
      if (!design || design.kind !== 'book' || design.photoRemoved) throw new HttpError(404, 'notFound');
      const book = bookFor(design.bookId);
      const n = Number(req.params.n);
      if (!Number.isInteger(n) || n < 0 || n >= book.pages.length) throw new HttpError(404, 'notFound');
      const key = `${design.id}|${design.version}|${n}`;
      if (!pageCache.has(key)) {
        if (pageCache.size > 120) pageCache.delete(pageCache.keys().next().value);
        pageCache.set(key, books.pageJpeg(bookData(design), n, 720).catch((e) => { pageCache.delete(key); throw e; }));
      }
      res.set('Cache-Control', 'private, max-age=600, no-transform');
      res.type('jpeg').send(await pageCache.get(key));
    } catch (e) {
      next(e);
    }
  });

  // ---------- AI page redraws for ordered books ----------
  // Runs one page at a time in the background; progress is kept on the order
  // item (admin sees it) and survives restarts. A page that fails twice keeps
  // the preview version, so a book can always be printed.
  const redrawQueue = [];
  let redrawBusy = false;
  const REDRAW_STALE = 5 * 60e3; // a claim not renewed for this long: that copy stopped
  function queueRedraw(order, item, { force = false } = {}) {
    const design = store.getDesign(item.designId);
    if (!design || design.kind !== 'book' || design.photoRemoved) return false;
    if (!design.aiConsent || !cartoon.enabled()) {
      // Why: the customer didn't agree, or they did but the site's AI drawing is off (no key) — the dashboard says which (QA 26 Nov).
      item.redraw = { status: 'off', reason: design.aiConsent ? 'aiOff' : 'noConsent' };
      store.save();
      return false;
    }
    if (!force && item.redraw && ['done', 'queued', 'running'].includes(item.redraw.status)) return false;
    const book = bookFor(design.bookId);
    const pages = book.pages.map((p, i) => (p.face ? i : -1)).filter((i) => i >= 0);
    if (force) for (const i of pages) fs.rmSync(store.designFile(design.id, `redraw-${i}.jpg`), { force: true });
    item.redraw = { status: 'queued', total: pages.length, done: 0, failed: [], at: new Date().toISOString() };
    store.save();
    if (!redrawQueue.includes(item.id)) redrawQueue.push(item.id);
    setImmediate(runRedraws);
    return true;
  }
  async function runRedraws() {
    if (redrawBusy) return;
    redrawBusy = true;
    try {
      while (redrawQueue.length) {
        store.sync();
        const found = store.findItem(redrawQueue[0]);
        if (!found) { redrawQueue.shift(); continue; }
        const { item } = found;
        const design = store.getDesign(item.designId);
        const book = design && bookFor(design.bookId);
        if (!book || design.photoRemoved) { redrawQueue.shift(); continue; }
        // Claim the book under the lock: another copy may be drawing it (it renews its claim every
        // page; a claim not renewed for a few minutes belongs to a copy that stopped).
        const mine = store.mutate(() => {
          const r = item.redraw;
          if (!r || r.status === 'done' || r.status === 'off' || r.status === 'failed') return false;
          if (r.claim && r.claim.pid !== process.pid && Date.now() - r.claim.at < REDRAW_STALE) return false;
          r.status = 'running';
          r.claim = { pid: process.pid, at: Date.now() };
          return true;
        });
        if (!mine) { redrawQueue.shift(); continue; }
        const pages = book.pages.map((p, i) => (p.face ? i : -1)).filter((i) => i >= 0);
        let waited = false;
        for (const i of pages) {
          const file = store.designFile(design.id, `redraw-${i}.jpg`);
          if (fs.existsSync(file) || item.redraw.failed.includes(i)) continue;
          // Shop-wide daily budget: wait for it to free up instead of failing.
          // Also the budget shared by every copy of the app: if it is used up, wait an hour.
          const wait = limiter.hit('redrawAll:*', LIMITS.redrawAll) || (takeShopBudget('redraw', LIMITS.redrawAll[0].max) ? 0 : 3600);
          if (wait) {
            item.redraw.status = 'waiting';
            store.save();
            await new Promise((r) => setTimeout(r, Math.min(wait, 3600) * 1000).unref());
            waited = true;
            break;
          }
          const data = bookData(design, { withRedraws: false });
          const input = await (await books.renderPage(data, i, 1024, { noText: true })).jpeg({ quality: 90 }).toBuffer();
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try {
              const img = await cartoon.redrawPage(input, data.face, book.kind);
              store.writeDesignFile(design.id, `redraw-${i}.jpg`, await sharp()(img).resize(2048, 2048, { fit: 'cover' }).jpeg({ quality: 93 }).toBuffer());
              ok = true;
            } catch (e) {
              console.warn(`[redraw] ${design.id} page ${i} attempt ${attempt + 1}:`, e.reason || '', e.message);
              if (e.reason === 'off' || e.reason === 'key') break;
            }
          }
          if (!ok) item.redraw.failed.push(i);
          item.redraw.claim = { pid: process.pid, at: Date.now() };
          item.redraw.done = pages.filter((p) => fs.existsSync(store.designFile(design.id, `redraw-${p}.jpg`))).length;
          fs.rmSync(store.designFile(design.id, 'book-print.pdf'), { force: true });
          fs.rmSync(store.designFile(design.id, 'book-preview.pdf'), { force: true });
          store.save();
        }
        if (waited) continue;
        item.redraw.status = item.redraw.done ? 'done' : 'failed';
        delete item.redraw.claim;
        item.redraw.finishedAt = new Date().toISOString();
        store.writeDesignFile(design.id, 'book-preview.png', await (await books.renderPage(bookData(design), 0, 600)).png().toBuffer());
        design.version = (design.version || 0) + 1;
        // The pages changed after the customer approved them: they approve the redrawn book before it is printed.
        if (item.approval && item.redraw.done && !['printing', 'printed', 'shipped'].includes(item.status)) {
          item.status = 'awaiting_approval';
          item.history.push({ status: item.status, at: new Date().toISOString() });
          newProofLink(item);
          const ord = store.getOrder(design.orderId);
          if (ord) tellCustomer(ord, item, 'proof', '', { get: () => '', protocol: 'https' });
        }
        store.save();
        console.log(`[redraw] ${design.id}: ${item.redraw.done}/${item.redraw.total} pages redrawn${item.redraw.failed.length ? `, ${item.redraw.failed.length} kept as preview` : ''}`);
        redrawQueue.shift();
      }
    } catch (e) {
      console.error('[redraw]', e);
    } finally {
      redrawBusy = false;
    }
  }
  // Pick up books that are waiting or half-done (after a restart, or left by a copy that stopped), now and every 2 minutes.
  const scanRedraws = () => {
    store.sync();
    for (const order of store.listOrders()) {
      for (const item of order.items) {
        const r = item.redraw;
        if (item.kind !== 'book' || !r || !['queued', 'running', 'waiting'].includes(r.status) || redrawQueue.includes(item.id)) continue;
        if (r.claim && r.claim.pid !== process.pid && Date.now() - r.claim.at < REDRAW_STALE) continue;
        redrawQueue.push(item.id);
      }
    }
    runRedraws();
  };
  if (cleanupEvery) setInterval(scanRedraws, 2 * 60e3).unref();
  setTimeout(() => {
    scanRedraws();
  }, 3000).unref();

  // ---------- Orders ----------
  /** Why a design can't be ordered now (product paused, no longer sold or sold out: admin → Products), or null. */
  const designUnavailable = (d) => {
    if (!d || d.kind === 'gangsheet') return null;
    const product = getProduct(d.productId);
    if (!product) return null;
    if (d.kind === 'book') {
      // Its cover (QA 26 Nov): said as a cover, not a size (books have covers. QA 26 Nov, 3 pm).
      const why = catalog.unavailable(product, { sizeId: d.size && d.size.id });
      return why === 'sizeUnavailable' ? 'bookCoverUnavailable' : why;
    }
    if (d.kind === 'photoset') return catalog.unavailable(product, { colorId: d.color && d.color.id });
    const lines = d.quantities && d.quantities.length ? d.quantities : [{ color: d.color, size: d.size }];
    for (const l of lines) {
      const why = catalog.unavailable(product, { colorId: l.color && l.color.id, sizeId: l.size && l.size.id, sideIds: (d.sides || []).map((sd) => sd.id).filter((id) => id !== EMB) });
      if (why) return why;
    }
    return null;
  };
  /** Pieces of a design that come out of the product's counted stock. */
  /**
   * What a design takes from counted stock: [{ pid, combo, n }] (combo "colorId|sizeId" when the
   * product counts per colour and size, null for one count for the whole product).
   */
  const stockNeeds = (d) => {
    if (!d || d.kind === 'photoset' || d.kind === 'gangsheet') return [];
    const p = getProduct(d.productId);
    if (!p) return [];
    const lines = d.quantities && d.quantities.length
      ? d.quantities.map((l) => ({ c: l.color && l.color.id, s: l.size && l.size.id, n: l.qty }))
      : [{ c: d.color && d.color.id, s: d.size && d.size.id, n: copiesOf(d) }];
    if (p.variantStock) return lines.filter((l) => catalog.comboLeft(p, l.c, l.s) != null).map((l) => ({ pid: p.id, combo: `${l.c}|${l.s}`, n: l.n }));
    if (typeof p.stock === 'number') return [{ pid: p.id, combo: null, n: lines.reduce((a, l) => a + l.n, 0) }];
    return [];
  };
  /** Several designs' needs added up per product (and colour / size): Map key -> { pid, combo, n }. */
  const addNeeds = (designs) => {
    const m = new Map();
    for (const d of designs) {
      for (const x of stockNeeds(d)) {
        const k = `${x.pid}#${x.combo || ''}`;
        if (m.has(k)) m.get(k).n += x.n;
        else m.set(k, { ...x });
      }
    }
    return m;
  };
  /** How many are left now (from the product as laid over, or a saved edit). */
  const leftOf = (holder, combo) => (combo ? (holder.variantStock || {})[combo] : holder.stock);
  /** "Classic T-Shirt (Black · XL)" for a stock message. */
  const stockName = (pid, combo, lang) => {
    const p = getProduct(pid);
    const name = p ? p.name[lang] || p.name.en : pid;
    if (!combo || !p) return name;
    const [c, s] = combo.split('|');
    const col = p.colors.find((x) => x.id === c);
    const size = p.sizes.find((x) => x.id === s);
    // (In Arabic: the shop's digits and comma, "مج سيراميك (أبيض، ٣٢٥ مل)", as the pages show it. QA 26 Nov.)
    const ar = lang === 'ar';
    const parts = [col && (col.name[lang] || col.name.en), size && (size.label[lang] || size.label.en)].filter(Boolean).map((x) => (ar ? i18n.arabicDigits(x) : x));
    return `${name} (${parts.join(ar ? '، ' : ' · ')})`;
  };
  /** What a design costs right now (prices the owner changed apply), or null if it can't be ordered. */
  const designPrice = (d) => {
    if (!d || (d.status && d.status !== 'ready') || d.orderId) return null;
    if (d.kind === 'gangsheet') return d.price;
    const product = getProduct(d.productId);
    if (!product) return null;
    if (d.kind === 'photoset') {
      // Each photo: its size's price (prices the owner changed apply) times its copies.
      let sum = 0;
      for (const p of d.photos) {
        const u = priceFor(product, p.size.id, 1);
        if (u == null) return null;
        sum += (u + optionsPrice(product, d.options, p.size.id)) * p.copies;
      }
      return round2(sum);
    }
    const unit = (sizeId) => {
      const p = priceFor(product, sizeId, decoratedSides(d));
      return p == null ? null : p + embExtra(product, d, sizeId);
    };
    // Several colours / sizes: each line at its size's price.
    if (d.quantities && d.quantities.length) {
      let sum = 0;
      for (const l of d.quantities) {
        const u = unit(l.size.id);
        if (u == null || !product.colors.some((c) => c.id === l.color.id)) return null;
        sum += u * l.qty;
      }
      return round2(sum);
    }
    const u = unit(d.size.id);
    // A price of nothing (or less) can't be ordered (a mistake in the shop's prices).
    return u == null || u < 1 ? null : round2(u * copiesOf(d));
  };
  /** Pieces in a design: one per row of its name list, else the quantities asked for, else one. */
  const copiesOf = (d) => (!d ? 1 : d.kind === 'photoset' ? d.photos.reduce((n, p) => n + p.copies, 0) : d.merge ? d.merge.count : d.quantities ? d.quantities.reduce((n, l) => n + l.qty, 0) : 1);
  /** A size label followed by the chosen options ({ en, ar }). */
  const withOptions = (label, options) => {
    if (!options) return label;
    const names = Object.values(options).map((o) => o.name);
    return { en: [label.en, ...names.map((n) => n.en)].join(' · '), ar: [label.ar, ...names.map((n) => n.ar)].join(' · ') };
  };
  /** What comes on top of the product price: embroidery, and options such as lamination (per piece of that size). */
  const embExtra = (product, d, sizeId = d.size && d.size.id) => (d.method === 'embroidery' && product.embroidery ? product.embroidery.surcharge : 0) + optionsPrice(product, d.options, sizeId);
  // ---------- Customer accounts ----------
  const customerList = () => store.db.customers || [];
  const findCustomer = (id) => customerList().find((x) => x.id === id) || null;
  // Sessions signed out: a fingerprint of the token until it would have expired anyway (a copied
  // cookie stops working at sign-out; the customer's other devices stay signed in).
  const sessionPrint = (tok) => crypto.createHash('sha256').update(String(tok)).digest('base64url').slice(0, 32);
  const currentCustomer = (req) => {
    const tok = customers.tokenFrom(req);
    if (!tok) return null;
    const out = store.db.signedOut;
    if (out && Object.prototype.hasOwnProperty.call(out, sessionPrint(tok))) return null;
    return customers.readSession(auth.customerKey, tok, findCustomer);
  };
  const isHttps = (req) => String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim() === 'https';
  const setSession = (req, res, cust) => res.set('Set-Cookie', customers.cookie(cust ? customers.sessionToken(auth.customerKey, cust) : '', { secure: isHttps(req) }));
  const signedIn = (req) => {
    const me = currentCustomer(req);
    if (!me) throw new HttpError(401, 'acctSignIn');
    return me;
  };
  const providers = () => {
    const cfg = oauth.config(oauthConfig);
    return Object.fromEntries(oauth.NAMES.map((n) => [n, Boolean(cfg[n])]));
  };
  app.get('/api/account', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const me = currentCustomer(req);
    res.json({ customer: me ? customers.publicCustomer(me) : null, emailReset: notify.emailReady(), providers: providers() });
  });

  // Sign in (or sign up) with Google / Facebook: /auth/google?next=cart -> provider -> /auth/google/callback.
  const origin = (req) => `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`;
  const callbackUrl = (req, name) => `${origin(req)}/auth/${name}/callback`;
  const backTo = (next, extra = '') => (next === 'cart' && !extra ? '/cart' : `/account${extra ? `?oauth=${extra}${next === 'cart' ? '&next=cart' : ''}` : ''}`);
  app.get('/auth/:provider', (req, res) => {
    const name = req.params.provider;
    if (!oauth.NAMES.includes(name)) throw new HttpError(404, 'notFound');
    const cfg = oauth.config(oauthConfig)[name];
    const next = req.query.next === 'cart' ? 'cart' : '';
    if (!cfg) return res.redirect(302, backTo(next, 'unavailable'));
    try {
      rateLimit(req, 'oauthStart');
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) return res.redirect(302, backTo(next, 'wait'));
      throw e;
    }
    const state = oauth.newState();
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', oauth.stateCookie(`${state}.${next}`, { secure: isHttps(req) }));
    res.redirect(302, oauth.authUrl(name, cfg, callbackUrl(req, name), state));
  });
  app.get('/auth/:provider/callback', async (req, res, next) => {
    try {
      await oauthCallback(req, res);
    } catch (e) {
      next(e);
    }
  });
  async function oauthCallback(req, res) {
    const name = req.params.provider;
    if (!oauth.NAMES.includes(name)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'no-store');
    const saved = oauth.readStateCookie(req);
    const next = saved ? saved.next : '';
    const fail = (why) => {
      res.append('Set-Cookie', oauth.stateCookie('', { secure: isHttps(req) }));
      res.redirect(302, backTo(next, why));
    };
    const cfg = oauth.config(oauthConfig)[name];
    if (!cfg) return fail('unavailable');
    if (req.query.error) return fail('cancelled'); // the customer pressed Cancel
    if (!saved || !oauth.sameState(saved.state, req.query.state) || !req.query.code) return fail('failed');
    let prof;
    try {
      prof = await oauth.profile(name, cfg, req.query.code, callbackUrl(req, name), oauthFetch);
    } catch (e) {
      console.warn(`[account] ${name} sign-in failed:`, e.message);
      return fail('failed');
    }
    const key = `${name}Id`;
    const cust = store.mutate((db) => {
      db.customers ||= [];
      // The same provider account; else an account whose email is proven to be
      // the same person's (made with Google/Facebook, or its emailed reset link
      // was used); else a new account. An account that only typed this email
      // (never proven) is not joined, and loses the email: Google/Facebook just
      // proved who owns it.
      let c = db.customers.find((x) => x[key] === prof.id);
      if (!c && prof.email) {
        const same = db.customers.find((x) => x.email === prof.email);
        if (same && same.emailVerified) c = same;
        else if (same) {
          same.email = '';
          same.emailRemovedAt = new Date().toISOString();
        }
      }
      if (c) {
        c[key] = prof.id;
        if (prof.email && c.email === prof.email) c.emailVerified = true;
        return c;
      }
      const fallback = prof.email ? prof.email.split('@')[0] : 'Customer';
      c = {
        id: crypto.randomUUID(),
        // (Without hidden direction marks, as a typed name: "\u202Eevil\u202C" read backwards in the greeting and the
        // dashboard. Tester 2, 26 Nov.)
        name: ((n) => (/[\p{L}\p{N}]/u.test(n.replace(/\u0640/g, '')) ? n : fallback))(String(prof.name || '').replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim()).replace(/\s+/g, ' ').slice(0, 120).padEnd(2, '.'),
        phone: '',
        email: prof.email,
        ...(prof.email ? { emailVerified: true } : {}),
        [key]: prof.id,
        pv: 1,
        createdAt: new Date().toISOString(),
      };
      db.customers.push(c);
      return c;
    });
    res.set('Set-Cookie', customers.cookie(customers.sessionToken(auth.customerKey, cust), { secure: isHttps(req) }));
    res.append('Set-Cookie', oauth.stateCookie('', { secure: isHttps(req) }));
    // New accounts (no mobile yet) land on the account page to add it; checkout needs it anyway.
    res.redirect(302, next === 'cart' ? '/cart' : `/account${cust.phone ? '' : '?welcome=1'}`);
  }
  app.post('/api/account/signup', express.json({ limit: '10kb' }), asyncRoute(async (req, res) => {
    const { fields, error } = customers.cleanSignup(req.body);
    if (error) throw new HttpError(400, error);
    rateLimit(req, 'accountSignup');
    await checkCaptcha(req);
    const { salt, hash } = customers.hashPassword(fields.password);
    const created = store.mutate((db) => {
      db.customers ||= [];
      if (db.customers.some((x) => x.phone === fields.phone)) throw new HttpError(409, 'acctPhoneTaken');
      if (fields.email && db.customers.some((x) => x.email === fields.email)) throw new HttpError(409, 'acctEmailTaken');
      const cust = { id: crypto.randomUUID(), name: fields.name, phone: fields.phone, email: fields.email, salt, passHash: hash, pv: 1, createdAt: new Date().toISOString() };
      db.customers.push(cust);
      return cust;
    });
    setSession(req, res, created);
    res.status(201).json({ customer: customers.publicCustomer(created) });
  }));
  app.post('/api/account/login', express.json({ limit: '10kb' }), asyncRoute(async (req, res) => {
    const { login, password } = req.body || {};
    // Wrong passwords count toward the limits (per visitor and per account); signing in correctly doesn't.
    limitCheck(req, 'accountLogin');
    await checkCaptcha(req);
    const key = customers.loginKey(login);
    const cust = key && customerList().find((x) => (key.phone ? x.phone === key.phone : x.email === key.email));
    // The per-login lock counts wrong passwords only (signing in correctly never locks the owner out).
    // It is kept for the typed phone / email whether or not there is an account, so a lock doesn't
    // tell anyone that an account exists.
    const who = key ? `l:${key.phone || key.email}` : null;
    if (who) {
      const wait = limiter.check(`accountLoginId:${who}`, LIMITS.accountLoginId);
      if (typeof wait === 'number') throw new HttpError(429, wait > 90 ? 'tooManyWait' : 'tooFast', { min: Math.ceil(wait / 60) });
    }
    // Same answer whether the account exists or not.
    if (!cust) customers.hashPassword(String(password || '')); // same time as a real check
    if (!cust || !customers.checkPassword(cust, password)) {
      limitHit('accountLogin', req.ip);
      if (who) limitHit('accountLoginId', who);
      throw new HttpError(401, 'acctWrong');
    }
    setSession(req, res, cust);
    res.json({ customer: customers.publicCustomer(cust) });
  }));
  app.post('/api/account/logout', (req, res) => {
    // Another site can't sign a customer out (a form posted from elsewhere).
    if (req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'notFound');
    const origin = req.get('origin');
    if (origin && origin !== 'null' && linkBase(req) && origin !== linkBase(req) && !SHOP_HOSTS.some((h) => origin.endsWith('//' + h))) throw new HttpError(403, 'notFound');
    // This session ends on the server too (a copy of the cookie made before stops working).
    const tok = customers.tokenFrom(req);
    if (tok && customers.readSession(auth.customerKey, tok, findCustomer)) {
      const exp = parseInt(String(tok).split('.')[1], 36) * 1000 || Date.now() + 61 * 86400e3;
      store.mutate((db) => {
        const now = Date.now();
        const out = db.signedOut && typeof db.signedOut === 'object' ? db.signedOut : {};
        for (const [k, until] of Object.entries(out)) if (!(until > now)) delete out[k];
        out[sessionPrint(tok)] = exp;
        db.signedOut = out;
      });
    }
    setSession(req, res, null);
    res.json({ ok: true });
  });
  // ---------- Delete my account (owner's decision, 25 Nov; the privacy page and the app stores ask for it) ----------
  // The account and everything kept for it go at once: name, mobile, email, password, address, Google / Facebook
  // links, the cart and the designs saved on the account. Orders already placed stay (delivery and the shop's
  // accounts need them): they become guest orders, still opened from their links. With the password, or (an account
  // with none, made with Google) ticking that they're sure.
  app.post('/api/account/delete', express.json({ limit: '10kb' }), (req, res) => {
    if (req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'notFound');
    const origin = req.get('origin');
    if (origin && origin !== 'null' && linkBase(req) && origin !== linkBase(req) && !SHOP_HOSTS.some((h) => origin.endsWith('//' + h))) throw new HttpError(403, 'notFound');
    const me = signedIn(req);
    limitCheck(req, 'accountLoginId', me.id);
    const b = req.body || {};
    if (me.passHash) {
      if (typeof b.password !== 'string' || !customers.checkPassword(me, b.password)) {
        limitHit('accountLoginId', me.id);
        throw new HttpError(401, 'acctWrongCurrent');
      }
    } else if (b.confirm !== true) throw new HttpError(400, 'acctDeleteConfirm');
    store.mutate((db) => {
      db.customers = (db.customers || []).filter((x) => x.id !== me.id);
      for (const o of db.orders || []) if (o.customerId === me.id) delete o.customerId;
    });
    // (Its own folder only: never the folder of all accounts.)
    const own = String(me.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (own) fs.rmSync(path.join(store.dataDir, 'accounts', own), { recursive: true, force: true });
    setSession(req, res, null);
    console.log('[account] a customer deleted their account');
    res.json({ ok: true });
  });
  app.put('/api/account', express.json({ limit: '10kb' }), (req, res) => {
    const me = signedIn(req);
    const b = req.body || {};
    // Text fields must be text (an object or a list is refused, not saved as "[object Object]").
    const text = (v) => (v == null ? '' : typeof v === 'string' ? v : (() => { throw new HttpError(400, 'badRequest'); })());
    // (Invisible characters don't count, as at sign-up.)
    const name = text(b.name).replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const email = cleanEmail(text(b.email)).toLowerCase().slice(0, 200);
    // (A letter or a digit, as at sign-up and checkout: "..", "!!!" or Arabic letter marks alone left the greeting
    // blank. Tester 1, 26 Nov.)
    if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name.replace(/\u0640/g, ''))) throw new HttpError(400, 'acctName');
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'badEmail');
    // Mobile number: accounts made with Google/Facebook add it here.
    const phone = b.phone === undefined || b.phone === null || b.phone === '' ? null : normalizeEgyptMobile(b.phone);
    if (b.phone && !phone) throw new HttpError(400, 'badPhone');
    let address = null;
    // An address with every field emptied: the saved one is removed.
    const clearAddress = Boolean(b.address && typeof b.address === 'object' && !text(b.address.address).trim() && !text(b.address.city).trim());
    if (b.address && typeof b.address === 'object' && !clearAddress) {
      const a = b.address;
      address = {
        governorate: typeof a.governorate === 'string' && governorate(a.governorate) ? a.governorate : '',
        city: text(a.city).trim().slice(0, 100),
        address: text(a.address).trim().slice(0, 300),
        notes: text(a.notes).trim().slice(0, 500),
      };
    }
    const updated = store.mutate((db) => {
      const cust = (db.customers || []).find((x) => x.id === me.id);
      if (!cust) throw new HttpError(401, 'acctSignIn');
      if (email && db.customers.some((x) => x.email === email && x.id !== cust.id)) throw new HttpError(409, 'acctEmailTaken');
      if (phone && db.customers.some((x) => x.phone === phone && x.id !== cust.id)) throw new HttpError(409, 'acctPhoneTaken');
      // A changed email is no longer proven.
      if (email !== cust.email) cust.emailVerified = false;
      Object.assign(cust, { name, email });
      if (phone) cust.phone = phone;
      if (address) cust.address = address;
      else if (clearAddress) delete cust.address;
      return cust;
    });
    res.json({ customer: customers.publicCustomer(updated) });
  });
  app.post('/api/account/password', express.json({ limit: '10kb' }), (req, res) => {
    const me = signedIn(req);
    const { current, password } = req.body || {};
    limitCheck(req, 'accountLoginId', me.id);
    if (me.passHash && !customers.checkPassword(me, current)) {
      limitHit('accountLoginId', me.id);
      throw new HttpError(401, 'acctWrongCurrent');
    }
    // (Text only: {"a":1} was saved as "[object Object]". QA 25 Nov.)
    const weak = typeof password !== 'string' ? 'acctPasswordShort' : customers.passwordProblem(password, me);
    if (weak) throw new HttpError(400, weak);
    const { salt, hash } = customers.hashPassword(password);
    const updated = store.mutate((db) => {
      const cust = db.customers.find((x) => x.id === me.id);
      Object.assign(cust, { salt, passHash: hash, pv: (cust.pv || 1) + 1 }); // other devices are signed out
      return cust;
    });
    setSession(req, res, updated);
    res.json({ ok: true });
  });
  app.get('/api/account/orders', (req, res) => {
    const me = signedIn(req);
    res.set('Cache-Control', 'private, no-store');
    res.json({ orders: store.listOrders().filter((o) => o.customerId === me.id).slice().reverse().map(customerOrder) });
  });
  app.post('/api/account/forgot', express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      rateLimit(req, 'accountForgot');
      // A signed-in customer asking for a link from their account page is already checked.
      if (!currentCustomer(req)) await checkCaptcha(req);
      const key = customers.loginKey((req.body || {}).login);
      const cust = key && customerList().find((x) => (key.phone ? x.phone === key.phone : x.email === key.email));
      const lang = langOf(req);
      // Only by email (a link valid for 1 hour); otherwise the shop helps on WhatsApp.
      const site = linkBase(req);
      if (cust && cust.email && notify.emailReady() && !site) console.warn('[account] reset email not sent: set SITE_URL (request for an unknown host)');
      if (cust && cust.email && notify.emailReady() && site && !limiter.hit(`accountForgotId:${cust.id}`, LIMITS.accountForgotId)) {
        const link = `${site}/account?reset=${encodeURIComponent(customers.resetToken(auth.customerKey, cust))}`;
        const ar = lang === 'ar';
        const subject = ar ? 'إعادة تعيين كلمة المرور · إبداع' : 'Reset your password · ebda3';
        const text = ar ? `اضغط الرابط ده خلال ساعة عشان تختار كلمة مرور جديدة:\n${link}\nلو مش انت اللي طلبت ده، تجاهل الرسالة.` : `Open this link within 1 hour to choose a new password:\n${link}\nIf you didn't ask for this, ignore this email.`;
        notify.emailTo(cust.email, subject, `<p dir="${ar ? 'rtl' : 'ltr'}">${text.replace(/\n/g, '<br>').replace(link, `<a href="${link}">${link}</a>`)}</p>`, text).catch((e) => console.warn('[account] reset email failed:', e.message));
      }
      // The same answer either way, so nobody can find out who has an account.
      res.json({ ok: true, byEmail: notify.emailReady(), whatsapp: notify.shopWhatsApp() || null });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/account/reset', express.json({ limit: '10kb' }), (req, res) => {
    const { token, password } = req.body || {};
    rateLimit(req, 'accountLogin');
    const link = customers.readReset(auth.customerKey, token, findCustomer);
    if (!link) throw new HttpError(400, 'acctResetExpired');
    const cust = link.customer;
    const weak = typeof password !== 'string' ? 'acctPasswordShort' : customers.passwordProblem(password, cust);
    if (weak) throw new HttpError(400, weak);
    const { salt, hash } = customers.hashPassword(password);
    // An emailed link was opened: the account's email is proven to be theirs.
    const updated = store.mutate((db) => Object.assign(db.customers.find((x) => x.id === cust.id), { salt, passHash: hash, pv: (cust.pv || 1) + 1 }, link.viaEmail && cust.email ? { emailVerified: true } : {}));
    setSession(req, res, updated);
    res.json({ customer: customers.publicCustomer(updated) });
  });

  // ---------- Coupons ----------
  // (The code as saved first; else without its dashes and underscores: "SALE50", "SALE 50" or "SALE–50" typed for
  // SALE-50 was "not valid". Tester 1, 26 Nov.)
  const looseCode = (c) => String(c || '').replace(/[-_\u2010-\u2015\u2212]/g, '');
  const findCoupon = (code) => {
    const n = coupons.normCode(code);
    const all = store.db.coupons || [];
    return all.find((c) => c.code === n) || (looseCode(n).length >= 3 && all.find((c) => looseCode(c.code) === looseCode(n))) || null;
  };
  /**
   * A code already saved, or one that differs from a saved one only by its dashes or underscores, is refused: the cart
   * takes "EID2026" for EID-2026, so EID2026 saved beside it gave a different discount (Tester 2, 26 Nov). A code kept
   * as it was (`was`, two made before this check) can still be edited.
   */
  const couponClash = (list, code, { id = null, was = null } = {}) => {
    if (list.some((c) => c.id !== id && c.code === code)) throw new HttpError(409, 'couponExists');
    if (code === was) return;
    const alike = list.find((c) => c.id !== id && looseCode(c.code) === looseCode(code));
    if (alike) throw new HttpError(409, 'couponAlike', { code: alike.code });
  };
  const couponLine = (design, price) => {
    const product = design && getProduct(design.productId);
    return { productId: design ? design.productId : '', category: product ? product.category : '', price: price || 0 };
  };

  // The cart asks for today's prices before the customer orders.
  // Phones whose coupon use the price check looked at, per visitor and day (a handful: a customer types one).
  const phoneChecks = new Map();
  function phoneCheckAllowed(ip, phone) {
    const day = new Date().toISOString().slice(0, 10);
    let e = phoneChecks.get(ip);
    if (!e || e.day !== day) {
      if (phoneChecks.size > 20000) phoneChecks.clear();
      e = { day, phones: new Set() };
      phoneChecks.set(ip, e);
    }
    if (e.phones.has(phone)) return true;
    if (e.phones.size >= 3) return false;
    e.phones.add(phone);
    return true;
  }
  /** A phone this visitor ordered with (all their details, the order's own checks): its prices may be asked for. A
   *  few a day past the usual three (tester 1, 26 Nov: no end to them, and the list of phones grew without a cap). */
  function allowPhoneCheck(ip, phone) {
    phoneCheckAllowed(ip, phone);
    const e = phoneChecks.get(ip);
    if (e && e.phones.size < 8) e.phones.add(phone);
  }
  app.post('/api/cart/quote', express.json({ limit: '20kb' }), (req, res) => {
    // Coupon codes that don't work count per visitor (codes can't be guessed by trying thousands);
    // a working code re-checked on every cart visit doesn't.
    // (Any code the coupon check reads counts as a try: a number too, which it takes since this morning. QA 26 Nov.)
    const tryingCode = coupons.normCode((req.body || {}).couponCode) !== '';
    if (tryingCode) limitCheck(req, 'couponTry');
    const ids = Array.isArray((req.body || {}).designIds) ? req.body.designIds.slice(0, MAX_ITEMS_PER_ORDER) : [];
    const items = ids.map((id) => {
      const d = typeof id === 'string' && UUID_RE.test(id) ? store.getDesign(id) : null;
      const price = designPrice(d);
      // Already ordered (e.g. the answer to the order got lost): the cart can take the customer to it.
      const why = price === null ? null : designUnavailable(d);
      const p = why && getProduct(d.productId);
      // The cart's − / + (one artwork in one colour and size): how many now, and in what steps.
      const count = price === null || why ? null : cartCount(d);
      return { designId: String(id).slice(0, 40), price, gone: price === null, ...(count ? { count } : {}), ...(d && d.orderId ? { ordered: true } : {}), ...(why ? { unavailable: why, unavailableText: format(why, { name: p ? p.name[langOf(req)] || p.name.en : '' }, langOf(req)) } : {}) };
    });
    // Counted stock: the cart says so before checkout when it asks for more pieces than are left.
    // In cart order: the pieces that still fit what's left go through; only the items past it are flagged
    // (three shirts with two left: the third one, not all three).
    const taken = new Map();
    for (const i of items) {
      const d = !i.gone && !i.unavailable && store.getDesign(i.designId);
      if (!d) continue;
      const needs = stockNeeds(d);
      const short = needs.find((x) => {
        const left = leftOf(getProduct(x.pid), x.combo);
        return typeof left === 'number' && (taken.get(`${x.pid}#${x.combo || ''}`) || 0) + x.n > left;
      });
      if (short) {
        const left = leftOf(getProduct(short.pid), short.combo);
        const free = Math.max(0, left - (taken.get(`${short.pid}#${short.combo || ''}`) || 0));
        i.unavailable = 'notEnoughStock';
        // Nothing left for this item: the items above it in the cart take the last ones (never "Only 0 left").
        i.unavailableText = free > 0
          ? format('notEnoughStock', { name: stockName(short.pid, short.combo, langOf(req)), left: free }, langOf(req))
          : format('stockInCart', { name: stockName(short.pid, short.combo, langOf(req)) }, langOf(req));
        continue;
      }
      for (const x of needs) taken.set(`${x.pid}#${x.combo || ''}`, (taken.get(`${x.pid}#${x.combo || ''}`) || 0) + x.n);
    }
    // Only what can be ordered counts towards the subtotal, free shipping and coupons: an item the shop
    // can't take right now (paused, stopped, sold out, more than is left) blocks the order until it is
    // removed or saved for later, and is left out of the sums meanwhile.
    const orderable = items.filter((i) => !i.gone && !i.unavailable);
    const subtotal = round2(orderable.reduce((n, i) => n + (i.price || 0), 0));
    const lines = orderable.map((i) => couponLine(store.getDesign(i.designId), i.price));
    const code = coupons.normCode((req.body || {}).couponCode);
    let coupon = null;
    let couponError = null;
    if (code) {
      // The phone typed at checkout (when there is one), so a coupon already used by this customer says so here too.
      // A visitor can have a few numbers checked a day, not any number (QA 25 Nov: anyone could learn which phones used
      // a coupon); the signed-in customer's own number always. Ordering checks every phone anyway.
      const typed = typeof (req.body || {}).phone === 'string' ? normalizeEgyptMobile(req.body.phone) : null;
      const me = typed && currentCustomer(req);
      const phone = typed && ((me && normalizeEgyptMobile(me.phone || '') === typed) || phoneCheckAllowed(req.ip, typed)) ? typed : null;
      const found = findCoupon(code);
      const r = coupons.apply(found, { lines, orders: store.listOrders(), ...(phone ? { phone } : {}), shipping: lines.length ? shippingFor(subtotal) : 0 });
      // (The code as the shop keeps it: "SALE50" typed is the coupon SALE-50.)
      if (r.ok) coupon = { code: (found && found.code) || code, discount: r.discount, freeShipping: r.freeShipping };
      else couponError = format(r.reason, r.params || {}, langOf(req));
    }
    // Best value wins (owner, 26 Nov): an automatic coupon that saves more than the typed code (or any, with none
    // typed) is the one applied; a typed code that saves less is told so (not a refusal: it doesn't count as a wrong
    // try, and ordering goes on with the better offer).
    const refused = Boolean(couponError);
    let couponBeaten = false;
    if (lines.length) {
      const typedPhone = typeof (req.body || {}).phone === 'string' ? normalizeEgyptMobile(req.body.phone) : null;
      const me = typedPhone && currentCustomer(req);
      const autoPhone = typedPhone && ((me && normalizeEgyptMobile(me.phone || '') === typedPhone) || phoneCheckAllowed(req.ip, typedPhone)) ? typedPhone : null;
      const ctx = { lines, orders: store.listOrders(), ...(autoPhone ? { phone: autoPhone } : {}), shipping: shippingFor(subtotal) };
      const pick = coupons.best(store.db.coupons, coupon ? findCoupon(code) : null, coupon ? code : '', ctx);
      if (pick.best && pick.best.auto) {
        if (coupon) {
          couponError = format('couponAutoBetter', { code, offer: pick.best.coupon.code }, langOf(req));
          couponBeaten = true;
        }
        coupon = { code: pick.best.coupon.code, discount: pick.best.result.discount, freeShipping: pick.best.result.freeShipping, auto: true };
      }
    }
    const discount = coupon ? coupon.discount : 0;
    // "Print one sample first" adds about 2 business days to the promised day.
    const delivery = withSampleDays(deliveryFor((req.body || {}).delivery), (req.body || {}).sample === true);
    // Free shipping is judged on the items before any coupon: a coupon never makes the order cost more.
    const baseShipping = !lines.length || (coupon && coupon.freeShipping) ? 0 : shippingFor(subtotal);
    // `shipping` includes the express fee; `delivery` says how fast and by which day.
    const shipping = round2(baseShipping + (lines.length ? delivery.fee : 0));
    const deliveryOptions = ['standard', 'express'].map((s) => withSampleDays(deliveryFor(s), (req.body || {}).sample === true));
    if (tryingCode && refused) limitHit('couponTry', req.ip);
    res.json({ items, subtotal, discount, coupon, couponError, ...(couponBeaten ? { couponBeaten } : {}), shipping, baseShipping, delivery, deliveryOptions, total: round2(subtotal - discount + shipping), freeShippingOver: FREE_SHIPPING_OVER, shippingFlat: SHIPPING_FLAT });
  });

  /** A sample printed and checked first: the expected day moves 2 business days later. */
  const withSampleDays = (d, sample, at = new Date()) => (sample ? { ...d, sampleDays: 2, by: businessDaysAfter(at, d.days + 2) } : d);
  // The order's one-time key from the cart: when the answer to an order got lost on the way (the phone
  // lost its connection), sending it again (or asking with the key) gives the same order, not an error.
  const ORDER_KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
  const orderByKey = (key) => (ORDER_KEY_RE.test(String(key || '')) ? store.listOrders().find((o) => o.orderKey === key) || null : null);
  app.get('/api/orders/by-key/:key', (req, res) => {
    const order = orderByKey(req.params.key);
    res.set('Cache-Control', 'no-store');
    // Not placed: an empty answer (the cart asks this on every visit while it has a key).
    if (!order) return res.status(204).end();
    rememberOrderHere(req, res, order);
    res.json(customerOrder(order, PAYMENT));
  });
  // ---------- Who may open a customer's order page ----------
  // Its secret key (the x-order-key header, or ?k= from the customer's link), the account it was placed
  // from, or, for an order placed before the keys came in, its number alone (as the links already sent have).
  // The team sees order numbers, so a number alone must not open an order's amounts or act for the customer.
  const LINK_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
  function orderOpenFor(req, order) {
    if (!order.linkKey) return true;
    const k = String(req.get('x-order-key') || (typeof req.query.k === 'string' ? req.query.k : '') || '');
    if (LINK_KEY_RE.test(k) && sameSecret(k, order.linkKey)) return true;
    // The browser a guest ordered from (its cookie, see rememberOrderHere): their own orders open there.
    if (ordersHere(req).some(([id, key]) => id === order.id && sameSecret(key, order.linkKey))) return true;
    const me = order.customerId ? currentCustomer(req) : null;
    return Boolean(me && me.id === order.customerId);
  }
  // ---------- A guest's orders on the browser they ordered from ----------
  // An HttpOnly cookie (only sent to /api/orders) with the last few guest orders and their keys: that browser
  // opens them even without the key in the link (a cart page opened before an update, storage switched off,
  // a proof link the shop sent by WhatsApp). Orders from an account are on the account instead.
  const ORDERS_COOKIE = 'pod_orders';
  const cookieOf = (req, name) => {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.get('cookie') || '');
    return m ? m[1] : '';
  };
  // Each entry is "<order id>~<link key>~<mark>". The id and key are in the order's link (shared on WhatsApp), so they
  // only open the order, as the link does; the mark is signed by the shop and only ever sent in this cookie, so it
  // proves this is the browser the order was placed from ("Save your orders"; security review, 26 Nov).
  const placedMark = (id, key) => crypto.createHmac('sha256', auth.linkKey).update(`guest-owner.${id}.${key}`).digest('base64url').slice(0, 22);
  /** [id, key, placedHere] for each order this browser keeps. */
  const ordersHere = (req) => cookieOf(req, ORDERS_COOKIE).split('|').slice(0, 8)
    .map((x) => x.split('~')).filter(([id, key]) => UUID_RE.test(id || '') && LINK_KEY_RE.test(key || ''))
    .map(([id, key, mark]) => [id, key, sameSecret(mark || '', placedMark(id, key))]);
  function rememberOrderHere(req, res, order) {
    if (!order || !order.linkKey || order.customerId) return;
    const list = [[order.id, order.linkKey, true], ...ordersHere(req).filter(([id]) => id !== order.id)].slice(0, 8);
    const value = list.map(([id, key, placed]) => (placed ? `${id}~${key}~${placedMark(id, key)}` : `${id}~${key}`)).join('|');
    res.append('Set-Cookie', `${ORDERS_COOKIE}=${value}; Path=/api/orders; Max-Age=${180 * 86400}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
  }
  /**
   * The item a "send a new version" request is about: with the order's key (or the account it was placed from),
   * or with that item's own edit link (x-revise-token, see newReviseLink). 404 / 403 otherwise.
   */
  function reviseItemFor(req) {
    const order = UUID_RE.test(String(req.params.id || '')) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const item = order.items.find((it) => it.id === req.params.itemId);
    const rt = String(req.get('x-revise-token') || '');
    if (item && rt && sameSecret(rt, item.reviseToken || '')) return { order, item, byLink: true };
    if (!orderOpenFor(req, order)) throw new HttpError(403, 'orderLinkNeeded');
    if (!item) throw new HttpError(404, 'itemNotFound');
    return { order, item, byLink: false };
  }
  /**
   * A new version of an ordered item's design (the customer's "send it again", or the shop's own edit in the
   * editor), checked before the store's lock: a finished design of the same product, not ordered, with the same
   * pieces at today's prices (the customer keeps the price agreed at checkout).
   */
  function checkNewVersion(req, item, id) {
    const d = typeof id === 'string' && UUID_RE.test(id) && store.getDesign(id);
    if (!d || d.kind || (d.status && d.status !== 'ready')) throw new HttpError(400, 'designGone');
    if (d.orderId) throw new HttpError(409, 'designOrdered');
    if (d.productId !== item.productId) throw new HttpError(409, 'reviseOtherProduct');
    // A colour / size / side the shop stopped selling or that sold out since can't come in this way (the
    // product itself paused after the order doesn't stop the change the shop asked for).
    const why = designUnavailable(d);
    if (why && !['productUnavailable', 'productRetired'].includes(why)) {
      const p = getProduct(d.productId);
      throw new HttpError(409, why, { name: p ? p.name[langOf(req)] || p.name.en : '' });
    }
    // Counted stock: the old version's pieces go back, the new one's are taken (what changed only).
    const oldDesign = store.getDesign(item.designId);
    const delta = new Map([...addNeeds([d]).entries()].map(([k, x]) => [k, { ...x }]));
    for (const [k, x] of addNeeds(oldDesign ? [oldDesign] : [])) {
      if (delta.has(k)) delta.get(k).n -= x.n;
      else delta.set(k, { ...x, n: -x.n });
    }
    const fields = designItemFields(d);
    // Same pieces and options as before: the old and new designs at today's prices (the shop may have
    // changed its prices since the order); the customer keeps the price agreed at checkout.
    const old = store.getDesign(item.designId);
    const oldToday = old ? designPrice({ ...old, status: 'ready', orderId: null }) : item.price;
    if (oldToday === null || Math.abs(fields.price - oldToday) > 0.009) throw new HttpError(409, 'revisePrice', { was: oldToday ?? item.price, now: fields.price });
    return { d, delta, fields };
  }
  /** …put in under the store's lock: the stock, the item's line at the agreed prices, the next version. */
  function putNewVersion(db, o, it, nd, { delta, fields, req }) {
    const counted = [...delta.values()].filter((x) => x.n).map((x) => ({ ...x, e: db.catalog && db.catalog.products && db.catalog.products[x.pid] })).filter((x) => x.e && typeof leftOf(x.e, x.combo) === 'number');
    for (const x of counted) if (x.n > 0 && leftOf(x.e, x.combo) < x.n) throw new HttpError(409, 'notEnoughStock', { name: stockName(x.pid, x.combo, langOf(req)), left: leftOf(x.e, x.combo) });
    for (const x of counted) {
      if (x.combo) x.e.variantStock[x.combo] -= x.n;
      else x.e.stock -= x.n;
      x.e.stockAt = new Date().toISOString(); // (a stock count waiting for approval is told: "changed since")
    }
    const prev = db.designs[it.designId];
    const now = new Date().toISOString();
    // The new design belongs to this order now (it can't be ordered again), as the next version.
    nd.orderId = o.id;
    nd.version = ((prev && prev.version) || 1) + 1;
    nd.revisionOf = it.designId;
    // A printed sample first, if the customer asked for one at checkout, stays asked for.
    const sample = Boolean(it.sampleWanted || (it.approval && it.approval.sample));
    const agreed = { price: it.price, unitPrice: it.unitPrice, lines: new Map((it.quantities || []).map((l) => [`${l.color && l.color.id}|${l.size && l.size.id}`, l.unitPrice])) };
    // The line now describes the new design (what the old one had and this one hasn't goes).
    for (const k of ['quantities', 'merge', 'method', 'emb', 'options', 'imports', 'rightsConfirmedAt', 'pattern', 'copies', 'unitPrice']) delete it[k];
    Object.assign(it, fields);
    // …at the prices agreed at checkout.
    it.price = agreed.price;
    if (agreed.unitPrice !== undefined) it.unitPrice = agreed.unitPrice;
    if (Array.isArray(it.quantities)) {
      // A colour / size the old version didn't have has no agreed price: then every line follows the agreed total
      // (today's prices scaled to it), so the invoice's lines add up to the item. QA 25 Nov.
      const allAgreed = it.quantities.every((l) => agreed.lines.has(`${l.color && l.color.id}|${l.size && l.size.id}`));
      if (allAgreed) for (const l of it.quantities) l.unitPrice = agreed.lines.get(`${l.color && l.color.id}|${l.size && l.size.id}`);
      else if (fields.price > 0) {
        const f = agreed.price / fields.price;
        for (const l of it.quantities) if (typeof l.unitPrice === 'number') l.unitPrice = round2(l.unitPrice * f);
      }
    }
    if (sample) it.sampleWanted = true;
    // What it costs to make follows the new version (another size or extra sides cost differently).
    const costs = db.costs || {};
    if (costs[it.productId]) it.costAtOrder = accounting.itemCostFrom(costs, it);
    // The approval was for the old version: the new one gets its own proof to approve.
    delete it.approval;
    delete it.replaced;
    it.preflight = nd.preflight ? { status: nd.preflight.status, checks: nd.preflight.checks } : null;
    return { now, sample };
  }
  // The editor's "edit it and send it again": is the item still waiting for changes, and the shop's note.
  app.get('/api/orders/:id/items/:itemId/revise', (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store' });
    const { order, item, byLink } = reviseItemFor(req);
    const hist = Array.isArray(item.approvals) ? item.approvals : [];
    const last = [...hist].reverse().find((h) => h && (h.action === 'changes' || h.action === 'rejected'));
    const note = (last && last.note) || (item.review && item.review.note) || null;
    res.json({ status: item.status, note, by: last ? last.by : null, ...(byLink && teamActingAsCustomer(req, order) ? { team: true } : {}) });
  });
  /** The order the customer asks about, or 404 / 403 (the link without its key: "open it from your email"). */
  function customerOrderFor(req, id) {
    const order = UUID_RE.test(String(id || '')) && store.getOrder(id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    if (!orderOpenFor(req, order)) throw new HttpError(403, 'orderLinkNeeded');
    return order;
  }
  app.post('/api/orders', express.json({ limit: '100kb' }), asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { designIds, expectedTotal } = body;
    const orderKey = typeof body.orderKey === 'string' && ORDER_KEY_RE.test(body.orderKey) ? body.orderKey : null;
    const already = orderKey && orderByKey(orderKey);
    if (already) {
      rememberOrderHere(req, res, already);
      return res.status(200).json(customerOrder(already, PAYMENT));
    }
    const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const c = {
      name: cleanString(customer.name, 'name', { max: 120 }),
      phone: cleanString(customer.phone, 'phone', { max: 30 }),
      email: cleanEmail(cleanString(customer.email, 'email', { max: 200, required: false })),
      governorate: typeof customer.governorate === 'string' ? customer.governorate : '',
      city: cleanString(customer.city, 'city', { max: 100 }),
      // (An address typed on several lines: one line, its parts joined with the comma of its own language. QA 25 Nov.)
      address: cleanString(customer.address, 'address', { max: 300, lines: /[\u0600-\u06ff]/.test(String(customer.address || '')) ? '، ' : ', ' }),
      notes: cleanString(customer.notes, 'notes', { max: 500, required: false }),
    };
    c.phone = normalizeEgyptMobile(c.phone);
    if (!c.phone) throw new HttpError(400, 'badPhone');
    if (c.email && !EMAIL_RE.test(c.email)) throw new HttpError(400, 'badEmail');
    if (!governorate(c.governorate)) throw new HttpError(400, 'badGovernorate');
    if (!Array.isArray(designIds) || designIds.length === 0) throw new HttpError(400, 'cartEmpty');
    if (designIds.length > MAX_ITEMS_PER_ORDER) throw new HttpError(400, 'tooManyItems', { max: MAX_ITEMS_PER_ORDER });
    if (new Set(designIds).size !== designIds.length) throw new HttpError(400, 'duplicateDesign');

    const designs = designIds.map((id) => {
      const d = typeof id === 'string' && UUID_RE.test(id) && store.getDesign(id);
      if (!d || (d.status && d.status !== 'ready')) throw new HttpError(400, 'designGone');
      if (d.orderId) throw new HttpError(409, 'designOrdered');
      // A kids book being saved (another tab, or another copy of the app): ordered once the save is done, never
      // half saved (QA 25 and 26 Nov).
      if (bookSaves.has(d.id) || (d.kind === 'book' && bookLocked(d.id))) throw new HttpError(409, 'bookSaving');
      const why = designUnavailable(d);
      if (why) {
        const p = getProduct(d.productId);
        throw new HttpError(409, why, { name: p.name[langOf(req)] || p.name.en, designId: d.id });
      }
      return d;
    });
    // Counted stock (admin → Products): enough left for every piece.
    const wanted = addNeeds(designs);
    for (const x of wanted.values()) {
      const left = leftOf(getProduct(x.pid), x.combo);
      if (typeof left === 'number' && left < x.n) throw new HttpError(409, 'notEnoughStock', { name: stockName(x.pid, x.combo, langOf(req)), left });
    }

    // Every item approved by the customer against its current proof (see /api/designs/:id/proof).
    const approvals = body.approvals && typeof body.approvals === 'object' && !Array.isArray(body.approvals) ? { ...body.approvals } : {};
    // A ready design added as it is is taken as approved, and recorded the same way as a ticked one (its sample wish
    // kept); the customer's own designs still need theirs (owner, 26 Nov).
    for (const d of designs) {
      if (!readyDesign(d)) continue;
      const a = approvals[d.id];
      approvals[d.id] = { proofHash: proofHashOf(d), ...(a && typeof a === 'object' && a.sample === true ? { sample: true } : {}) };
    }
    for (const d of designs) {
      const a = approvals[d.id];
      if (!a) {
        if (requireApproval) throw new HttpError(400, 'approvalRequired');
        continue;
      }
      if (a.proofHash !== proofHashOf(d)) throw new HttpError(409, 'proofChanged', { designId: d.id });
    }

    const now = new Date().toISOString();
    // One order line per design, always quantity 1: every item is its own print job.
    const items = designs.map((d) => {
      if (d.kind === 'photoset') {
        const product = getProduct(d.productId);
        return {
          id: crypto.randomUUID(), designId: d.id, kind: 'photoset', productId: d.productId, productName: d.productName,
          color: d.color, size: d.size, sides: d.sides, process: d.process, price: designPrice({ ...d, status: 'ready', orderId: null }),
          copies: copiesOf(d), photos: d.photos.map((p) => ({ n: p.n, size: p.size, copies: p.copies, orientation: p.orientation })),
          // Prints per size (invoice, order page, admin and printing-house messages show them like any multi-size item).
          quantities: product.sizes.map((z) => ({
            // The border (white / none) goes with each size, as it does with the set's own label.
            color: { id: d.color.id, name: d.color.name, hex: d.color.hex }, size: { id: z.id, label: withOptions(z.label, d.options) },
            qty: d.photos.filter((p) => p.size.id === z.id).reduce((n, p) => n + p.copies, 0),
            unitPrice: round2(priceFor(product, z.id, 1) + optionsPrice(product, d.options, z.id)),
          })).filter((l) => l.qty),
          ...(d.options ? { options: JSON.parse(JSON.stringify(d.options)) } : {}),
          status: 'queued', history: [{ status: 'queued', at: now }],
        };
      }
      if (d.kind === 'gangsheet') {
        return {
          id: crypto.randomUUID(), designId: d.id, kind: 'gangsheet', productId: d.productId, productName: d.productName,
          color: d.color, size: d.size, sides: d.sides, process: 'dtf', price: d.price, pieces: d.sheet.placements.length,
          status: 'queued', history: [{ status: 'queued', at: now }],
        };
      }
      return { id: crypto.randomUUID(), ...designItemFields(d), status: 'queued', history: [{ status: 'queued', at: now }] };
    });
    // The customer's approval of each proof, and whether the shop checks the job before printing.
    items.forEach((it, i) => {
      const d = designs[i];
      const a = approvals[d.id];
      if (a) recordApproval(it, d, { via: 'checkout', sample: a.sample === true && copiesOf(d) > 1 });
      it.preflight = d.preflight ? { status: d.preflight.status, checks: d.preflight.checks } : null;
      // Without approvals (switched off for older setups) the job goes straight to the queue.
      const reasons = requireApproval || a ? reviewReasons(d, { sample: Boolean(a && a.sample === true && copiesOf(d) > 1) }) : [];
      it.review = { needed: reasons.length > 0, reasons, status: reasons.length ? 'pending' : 'done' };
      if (reasons.length) {
        it.status = 'review';
        it.history = [{ status: 'review', at: now }];
      }
    });
    // Keep what each item cost to make today (when the costs are filled in), for the accounts.
    const costs = store.db.costs || {};
    for (const it of items) if (costs[it.productId]) it.costAtOrder = accounting.itemCostFrom(costs, it);
    const subtotal = round2(items.reduce((sum, i) => sum + i.price, 0));
    // A coupon code typed at checkout (checked again under the lock below, where uses are counted).
    const code = coupons.normCode(body.couponCode);
    const lines = designs.map((d, i) => couponLine(d, items[i].price));
    let applied = null;
    if (code) {
      const r = coupons.apply(findCoupon(code), { lines, orders: store.listOrders(), phone: c.phone, shipping: shippingFor(subtotal) });
      if (!r.ok) throw new HttpError(409, r.reason, r.params || {});
    }
    // Best value wins (owner, 26 Nov): the typed code, or an automatic coupon that saves more (one per order).
    const pick = coupons.best(store.db.coupons, code ? findCoupon(code) : null, code, { lines, orders: store.listOrders(), phone: c.phone, shipping: shippingFor(subtotal) });
    if (pick.best) {
      const { coupon: cp, result: r } = pick.best;
      // The items it came off (a coupon for one product): the accounts charge the discount to those.
      applied = { id: cp.id, code: cp.code, type: cp.type, discount: r.discount, freeShipping: r.freeShipping, ...(pick.best.auto ? { auto: true } : {}), ...(r.freeShipping ? { shippingWaived: shippingFor(subtotal) } : {}), items: r.lines.map((i) => items[i].id) };
    }
    const discount = applied ? applied.discount : 0;
    // Standard (5 business days) or express (2, for a fee added to the shipping).
    if (body.delivery !== undefined && body.delivery !== 'standard' && body.delivery !== 'express') throw new HttpError(400, 'badDelivery');
    const anySample = designs.some((d) => approvals[d.id] && approvals[d.id].sample === true && copiesOf(d) > 1);
    const delivery = withSampleDays(deliveryFor(body.delivery, new Date(now)), anySample, new Date(now));
    const shipping = round2((applied && applied.freeShipping ? 0 : shippingFor(subtotal)) + delivery.fee);
    const total = round2(subtotal - discount + shipping);
    // The customer must have seen this total: if a price changed since, show them the new one first.
    if (expectedTotal !== undefined && !(Math.abs(Number(expectedTotal) - total) <= 0.009)) {
      // (An offer this phone has had already: the cart's next price check may use this phone, past the few a visitor
      // can have checked a day, or it kept showing the offer and every order ended here. Tester 2, 26 Nov: customers
      // on one mobile-network address share that limit. This answer already says the price differs for the phone.)
      rateLimit(req, 'priceCheck');
      if (c.phone) allowPhoneCheck(req.ip, c.phone);
      throw new HttpError(409, 'priceChanged', { total });
    }
    // Only orders that passed every check (coupon, prices) count towards the limit,
    // so a typo or a changed price doesn't lock a customer out.
    rateLimit(req, 'orders');
    // The CAPTCHA last: a token works once, so earlier mistakes (a changed price) don't use it up.
    await checkCaptcha(req);
    const me = currentCustomer(req);
    const order = store.createOrder({
      id: crypto.randomUUID(),
      createdAt: now,
      currency: CURRENCY,
      customer: c,
      ...(me ? { customerId: me.id } : {}),
      items,
      subtotal,
      ...(applied ? { discount, coupon: applied } : {}),
      shipping,
      delivery,
      total,
      // Cash on delivery: collected by the courier.
      payment: { method: 'cod', status: 'pending' },
      ...(orderKey ? { orderKey } : {}),
      // The order page's secret key: only the customer's links (email, cart, account) carry it.
      linkKey: crypto.randomBytes(16).toString('base64url'),
      lang: langOf(req),
    }, (db) => {
      // Checked again under the lock with the latest data: another copy may have just ordered one of these.
      for (const d of designs) {
        const cur = db.designs[d.id];
        if (!cur || (cur.status && cur.status !== 'ready')) throw new HttpError(400, 'designGone');
        if (cur.orderId) throw new HttpError(409, 'designOrdered');
        if (cur.kind === 'book' && bookLocked(d.id)) throw new HttpError(409, 'bookSaving');
        // Still the version the customer approved (a save that finished meanwhile, on any copy: QA 26 Nov).
        if (approvals[d.id] && approvals[d.id].proofHash !== proofHashOf(cur)) throw new HttpError(409, 'proofChanged', { designId: d.id });
      }
      // The coupon's limits, with every order saved so far (by any copy of the app).
      if (applied) {
        const r = coupons.apply((db.coupons || []).find((x) => x.id === applied.id), { lines, orders: db.orders, phone: c.phone, shipping: shippingFor(subtotal) });
        // (An automatic offer used up meanwhile: the customer typed no code; the total changes, said as that. QA 26 Nov.)
        if (!r.ok) throw applied.auto ? new HttpError(409, 'priceChanged', { total: round2(subtotal + shippingFor(subtotal) + delivery.fee) }) : new HttpError(409, r.reason, r.params || {});
      }
      // Counted stock goes down by the pieces ordered (checked again with the latest count, every
      // product first, so a refused order takes nothing off).
      const counted = [...wanted.values()].map((x) => ({ ...x, e: db.catalog && db.catalog.products && db.catalog.products[x.pid] })).filter((x) => x.e && typeof leftOf(x.e, x.combo) === 'number');
      for (const x of counted) if (leftOf(x.e, x.combo) < x.n) throw new HttpError(409, 'notEnoughStock', { name: stockName(x.pid, x.combo, langOf(req)), left: leftOf(x.e, x.combo) });
      for (const x of counted) {
        if (x.combo) x.e.variantStock[x.combo] -= x.n;
        else x.e.stock -= x.n;
        x.e.stockAt = new Date().toISOString(); // (a stock count waiting for approval is told: "changed since")
      }
    });
    // A signed-in customer without a saved address keeps this one for next time.
    if (me && !me.address) {
      store.mutate((db) => {
        const cust = (db.customers || []).find((x) => x.id === me.id);
        if (cust && !cust.address) cust.address = { governorate: c.governorate, city: c.city, address: c.address, notes: c.notes || '' };
      });
    }
    rememberOrderHere(req, res, order);
    res.status(201).json(customerOrder(order, PAYMENT));
    // Books: the AI redraws every page with the child, in the background.
    for (const item of order.items) if (item.kind === 'book') queueRedraw(order, item);
    // Tell the shop and the customer, after answering: sending never holds up or fails an order.
    // The shop's alerts have an hourly budget for the whole shop; the customer's confirmation is always
    // sent, with a limit per email address (nobody can use the shop to flood someone's inbox).
    const toShop = !limiter.hit('notify:*', LIMITS.notify);
    const email = String(order.customer.email || '').toLowerCase();
    const toCustomer = !email || (!limiter.hit(`notifyCustomer:${email}`, LIMITS.notifyCustomer) && !limiter.hit('notifyCustomerAll:*', LIMITS.notifyCustomerAll));
    if (!toShop) console.warn(`[notify] skipped the shop's alerts for ${order.number}: too many orders this hour (the order is in the admin)`);
    if (!toShop && !toCustomer) {
      order.notifications = { skipped: 'too many orders this hour', at: new Date().toISOString() };
      store.save();
      return;
    }
    notify.orderPlaced(order, { origin: linkBase(req), lang: order.lang, admin: toShop, customer: toCustomer, prepayOnly: PAYMENT.prepayOnly })
      .then((result) => {
        order.notifications = { ...result, at: new Date().toISOString() };
        store.save();
      })
      .catch((e) => console.warn('[notify]', e.message));
  }));

  /** What an order line keeps from its (editor-made or book) design: product, sides, pieces, price… */
  function designItemFields(d) {
    const product = getProduct(d.productId);
    return {
      designId: d.id,
      ...(d.kind === 'book' ? { kind: 'book', bookId: d.bookId } : {}),
      productId: d.productId,
      productName: product.name,
      color: d.color,
      size: d.size,
      sides: d.sides,
      process: d.process || product.process,
      price: designPrice({ ...d, status: 'ready', orderId: null }),
      ...(copiesOf(d) > 1 || d.quantities ? pieceInfo(product, JSON.parse(JSON.stringify(d))) : {}),
      ...(d.quantities ? { quantities: withPacks(d.productId, JSON.parse(JSON.stringify(d.quantities))).map((l) => ({ ...l, unitPrice: round2(priceFor(product, l.size.id, decoratedSides(d)) + embExtra(product, d, l.size.id)) })) } : {}),
      ...(d.merge ? { merge: { count: d.merge.count, columns: d.merge.columns } } : {}),
      ...(d.method === 'embroidery' ? { method: 'embroidery', emb: d.emb || null } : {}),
      ...(d.options ? { options: JSON.parse(JSON.stringify(d.options)) } : {}),
      ...(d.imports ? { imports: d.imports, rightsConfirmedAt: d.rightsConfirmedAt } : {}),
      ...(d.pattern ? { pattern: d.pattern } : {}),
    };
  }

  // ---------- Changes asked for: the customer edits the design and sends it again ----------
  // An item the shop (or the customer, on the proof page) sent back for changes: the customer opens
  // it in the editor, saves a new version (a new design), and it replaces the item's design. The
  // shop checks it again (Review tab); the customer then approves its proof as usual.
  // Same price only: a version that costs more or less is refused (the order total stays as agreed).
  app.post('/api/orders/:id/items/:itemId/revise', (req, res, next) => {
    rateLimit(req, 'reorder');
    next();
  }, express.json({ limit: '2kb' }), (req, res) => {
    const { order, item, byLink } = reviseItemFor(req);
    if (item.status !== 'changes_requested') throw new HttpError(409, 'reviseNotNeeded');
    if (item.kind) throw new HttpError(409, 'reviseNotEditable'); // books, photo sets, film sheets
    if (byLink && teamActingAsCustomer(req, order)) throw new HttpError(403, 'reviseTeam');
    const { d, delta, fields } = checkNewVersion(req, item, (req.body || {}).designId);
    // Checked again and changed under the store's lock, on the latest data (another copy of the app
    // may have answered the same item or ordered the same design a moment ago).
    store.mutate((db) => {
      const o = db.orders.find((x) => x.id === order.id);
      const it = o && o.items.find((x) => x.id === item.id);
      const nd = db.designs[d.id];
      if (!it || it.status !== 'changes_requested') throw new HttpError(409, 'reviseNotNeeded');
      if (!nd || nd.orderId) throw new HttpError(409, 'designOrdered');
      const { now, sample } = putNewVersion(db, o, it, nd, { delta, fields, req });
      it.status = 'review';
      it.review = { needed: true, reasons: [...new Set(['revised', ...reviewReasons(nd, { sample })])], status: 'pending' };
      it.approvals = [...(it.approvals || []), { action: 'revised', by: 'customer', at: now, proofHash: proofHashOf(nd), version: nd.version }];
      it.history.push({ status: 'review', at: now });
      delete it.proofToken;
      delete it.reviseToken;
    });
    const saved = store.getOrder(order.id);
    // (With the item's own edit link only: no amounts and no key, just that it was sent.)
    res.json(byLink ? { ok: true, status: 'review' } : customerOrder(saved, PAYMENT));
    // Tell the shop a new version is waiting in Review (after answering; it never holds up the customer).
    if (!limiter.hit('notify:*', LIMITS.notify)) {
      const it = saved.items.find((x) => x.id === item.id);
      notify.revisionSent(saved, it, { origin: linkBase(req) }).catch((e) => console.warn('[notify]', e.message));
    }
  });

  app.get('/api/orders/:id', (req, res) => {
    // (Before the check: a refusal is never kept by a cache either, for the customer whose link has the key.)
    res.set({ 'Cache-Control': 'private, no-store', Vary: 'x-order-key, Cookie' });
    const order = customerOrderFor(req, req.params.id);
    const offer = accountOfferFor(req, order);
    res.json({ ...customerOrder(order, PAYMENT), ...(offer ? { accountOffer: offer } : {}) });
  });

  // ---------- After a guest order: keep it on a new account (owner's OK, UX item 8, 26 Nov) ----------
  // The order page offers "Save your orders": the order's own name, mobile and email, and a password typed there.
  /**
   * The guest who placed this order: on the browser it was ordered from only. The order's link alone isn't enough: the
   * order page invites sharing it ("send me the order link on WhatsApp"), and whoever had it could make the
   * customer's account with their mobile and lock them out of it. (QA 26 Nov.)
   */
  function guestOwnerOf(req, order) {
    if (!order || order.customerId || !order.linkKey || !order.customer || !order.customer.phone) return false;
    // (The signed mark, never the link's own id and key: those are in the link.)
    return ordersHere(req).some(([id, key, placed]) => placed && id === order.id && sameSecret(key, order.linkKey));
  }
  /** The offer, when it applies: a guest's order, nobody signed in here, and no account with that mobile yet. */
  function accountOfferFor(req, order) {
    if (!guestOwnerOf(req, order) || currentCustomer(req)) return null;
    if ((store.db.customers || []).some((c) => c.phone === order.customer.phone)) return null;
    return { phone: order.customer.phone };
  }
  app.post('/api/orders/:id/account', express.json({ limit: '10kb' }), asyncRoute(async (req, res) => {
    const order = UUID_RE.test(String(req.params.id || '')) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    if (!guestOwnerOf(req, order)) throw new HttpError(403, 'orderLinkNeeded');
    const c = order.customer;
    const { fields, error } = customers.cleanSignup({ name: c.name, phone: c.phone, email: c.email || '', password: (req.body || {}).password });
    if (error) throw new HttpError(400, error);
    rateLimit(req, 'accountSignup');
    const { salt, hash } = customers.hashPassword(fields.password);
    // This browser's other guest orders from the same mobile go on the account too.
    const here = new Map(ordersHere(req).filter(([, , placed]) => placed).map(([id, key]) => [id, key]));
    const created = store.mutate((db) => {
      db.customers ||= [];
      if (db.customers.some((x) => x.phone === fields.phone)) throw new HttpError(409, 'acctPhoneTaken');
      const o = (db.orders || []).find((x) => x.id === order.id);
      if (!o || o.customerId) throw new HttpError(403, 'orderLinkNeeded');
      // (An email another account already has: the new account starts without one; it can be added on the account page.)
      const email = fields.email && !db.customers.some((x) => x.email === fields.email) ? fields.email : '';
      const cust = { id: crypto.randomUUID(), name: fields.name, phone: fields.phone, email, salt, passHash: hash, pv: 1, createdAt: new Date().toISOString() };
      // The order's delivery address is kept for next time, as for a signed-in customer's first order (QA 26 Nov).
      const oc = o.customer || {};
      if (oc.governorate && oc.address) cust.address = { governorate: oc.governorate, city: oc.city || '', address: oc.address, notes: oc.notes || '' };
      db.customers.push(cust);
      for (const x of db.orders || []) {
        const mine = x.id === o.id || (here.has(x.id) && x.linkKey && sameSecret(here.get(x.id), x.linkKey) && x.customer && x.customer.phone === fields.phone);
        if (mine && !x.customerId) x.customerId = cust.id;
      }
      return cust;
    });
    setSession(req, res, created);
    res.status(201).json({ customer: customers.publicCustomer(created) });
  }));

  // ---------- After the order: order again, drafts on the account, shipping ----------
  // Derived files that carry the old order's number or are cheap to make again.
  // (Every PDF made for printing carries the order's number on its label and title: made again for the new order, not
  // copied. QA 26 Nov: "Order again" printed POD-1011 on POD-1012's sheet.)
  const STALE_COPY = /^(\.saving\.lock|book-print\.pdf|book-preview\.pdf|preview-v\d+\.pdf|merge-print(-marks)?\.pdf|merge-copies\.zip|photos-v\d+\.zip|.+-print(-marks)?\.pdf|.+-dtf-film\.pdf|booklet-(pdf|imposed)-v\d+\.pdf)$/;
  /** How many bytes a folder holds (its files, one level of sub-folders deep is plenty here). */
  function dirBytes(dir, depth = 0) {
    let n = 0;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isFile()) n += fs.statSync(f).size;
        else if (e.isDirectory() && depth < 2) n += dirBytes(f, depth + 1);
      }
    } catch (err) { /* gone */ }
    return n;
  }
  // The cart's key for one design (its upload token): changes how many from the cart.
  const DESIGN_KEY_RE = /^[a-f0-9]{48}$/;
  /** An exact copy of a saved design (files included), not ordered yet. Returns { design, token }. */
  function copyDesign(src) {
    const token = crypto.randomBytes(24).toString('hex');
    const copy = JSON.parse(JSON.stringify(src));
    Object.assign(copy, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'ready', orderId: null, reorderOf: src.id });
    delete copy.uploadTokenHash;
    delete copy.cartKeyHash;
    delete copy.orderedAt;
    if (copy.kind === 'book') copy.uploadTokenHash = sha(token); // the book page edits with this token
    // One artwork (not a name list, book or set): the token is the cart's key to change how many.
    if (!copy.kind && !copy.merge) copy.cartKeyHash = sha(token);
    // A name list: the copy's own key, kept with its new cart item.
    const listKey = copy.merge ? crypto.randomBytes(18).toString('base64url') : null;
    if (listKey) copy.listKeyHash = sha(listKey);
    else delete copy.listKeyHash;
    fs.cpSync(store.designDir(src.id), store.designDir(copy.id), { recursive: true, filter: (from) => !STALE_COPY.test(path.basename(from)) });
    store.createDesign(copy, {});
    return { design: copy, token, listKey };
  }
  /** What the cart keeps for a design (the same as the editor and book page put there). */
  const cartEntry = (d, token, listKey = null) => ({
    designId: d.id,
    ...(d.kind === 'book' ? { bookId: d.bookId, editToken: token } : {}),
    ...(d.merge && listKey ? { listKey } : {}),
    ...(!d.kind && !d.merge && DESIGN_KEY_RE.test(token || '') ? { designKey: token } : {}),
    productId: d.productId,
    productName: d.productName,
    colorName: d.color.name,
    sizeLabel: d.size.label,
    sides: d.sides.map((sd) => sd.name),
    price: d.price,
    // (A photo set's prints are of different sizes and prices: no "price each" in the cart.)
    ...(copiesOf(d) > 1 && d.kind !== 'photoset' ? { copies: copiesOf(d) } : {}),
    ...(d.quantities ? { quantities: d.quantities } : {}),
    ...(d.merge ? { merge: { count: d.merge.count } } : {}),
    // A side whose print file the shop replaced: its old mockup is out of date, the print file's picture is shown.
    previewUrl: d.kind === 'book' ? `/files/designs/${d.id}/book-preview.png?v=${d.version || 0}` : d.replaced && d.replaced[d.sides[0].id] ? `/files/designs/${d.id}/${d.sides[0].id}-proof.png?v=${d.version || 1}` : `/files/designs/${d.id}/${d.sides[0].id}-preview.png`,
    addedAt: new Date().toISOString(),
  });

  // Order again: an exact copy of every item, at today's prices, ready for the cart.
  // ---------- How many, changed from the cart (owner, 26 Nov) ----------
  // One artwork in one colour and size (or one pack): the cart's − / + changes the number without the editor. With the
  // cart's key (kept with the item) the design itself changes; without it (an item added before the key, or the
  // design was ordered) a copy is made at the new number, with its own key. Several sizes / colours, name lists, books
  // and photo sets still go through the editor.
  /** Copies in one pack of a size (1 for a size that isn't a pack). */
  const packSize = (z) => (z && z.pack && z.copies > 0 ? z.copies : 1);
  // A pack that counts copies (100 cards, 10 menus). Sizes marked as packs without a number of copies are physical
  // sizes or page counts (banners 100 × 50 or 200 × 100, a 100-page photo book): counted as pieces, never switched
  // for one another (as the editor counts them).
  const counted = (z) => Boolean(z && z.pack && typeof z.copies === 'number' && z.copies > 0);
  /**
   * The design's pieces as the cart counts them, or null when they change in the editor: one colour, and one size —
   * or, on a product that mixes sizes, packs of one family (500 + 4 × 100 envelopes).
   */
  function cartLines(d, product) {
    if (!d || d.kind || d.merge || !product) return null;
    const lines = d.quantities && d.quantities.length ? d.quantities : [{ color: d.color, size: d.size, qty: 1 }];
    const colourId = lines[0].color && lines[0].color.id;
    if (!lines.every((l) => l.color && l.color.id === colourId)) return null;
    const colour = product.colors.find((c) => c.id === colourId);
    const sizes = lines.map((l) => product.sizes.find((z) => z.id === (l.size && l.size.id)));
    if (!colour || sizes.some((z) => !z)) return null;
    // (Packs of one family mix on every product: owner, 26 Nov.)
    if (lines.length > 1 && !sizes.every((z) => counted(z) && z.family === sizes[0].family)) return null;
    const copies = lines.reduce((n, l, i) => n + (Number(l.qty) || 1) * packSize(sizes[i]), 0);
    return { lines, sizes, colour, size: sizes[0], copies };
  }
  /** A pack's family that can be printed in this colour now (the size itself first). */
  const packFamily = (product, d, size, colour) => [size, ...product.sizes.filter((z) => z !== size && counted(z) && z.family === size.family
    && !catalog.unavailable(product, { colorId: colour.id, sizeId: z.id, sideIds: (d.sides || []).map((sd) => sd.id).filter((id) => id !== EMB) }))];
  /** One pack of each size of the family for this design (its sides, options, embroidery), or null when it can't be had. */
  const packPrices = (d, colour, family) => new Map(family.map((z) => [z.id, designPrice({ ...d, orderId: null, status: 'ready', quantities: [{ color: { id: colour.id }, size: { id: z.id }, qty: 1 }] })]));
  /**
   * The cheapest packs that make exactly `copies`: [{ size, qty }] and their price, or null: any mix of the family's
   * packs (one print file), on every product (owner, 26 Nov: 11 menus were 11 singles at 1,430 instead of a 10-pack and
   * a single at about 380; until then only products that mix sizes did).
   */
  function bestPacks(product, family, prices, copies) {
    const usable = family.filter((z) => prices.get(z.id) != null);
    if (!usable.length || copies < 1) return null;
    // Any mix: the cheapest way to exactly `copies` (in steps of the packs' common size).
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = usable.reduce((a, z) => gcd(a, packSize(z)), 0);
    if (copies % g) return null;
    const N = copies / g;
    const cost = new Float64Array(N + 1).fill(Infinity);
    const pick = new Int16Array(N + 1).fill(-1);
    cost[0] = 0;
    for (let n = 1; n <= N; n++) {
      usable.forEach((z, i) => {
        const k = packSize(z) / g;
        if (k <= n && cost[n - k] + prices.get(z.id) < cost[n] - 1e-9) {
          cost[n] = cost[n - k] + prices.get(z.id);
          pick[n] = i;
        }
      });
    }
    if (!Number.isFinite(cost[N])) return null;
    const count = new Map();
    for (let n = N; n > 0; n -= packSize(usable[pick[n]]) / g) count.set(usable[pick[n]], (count.get(usable[pick[n]]) || 0) + 1);
    const picks = usable.filter((z) => count.has(z)).map((z) => ({ size: z, qty: count.get(z) }));
    if (picks.some((p) => p.qty > MAX_PIECES)) return null;
    return { picks, price: round2(cost[N]) };
  }
  /** A bigger number of copies (a few steps up) that costs less than `price`: { copies, price } or null. */
  function cheaperMore(product, family, prices, copies, step, price) {
    for (let k = 1, c = copies + step; k <= 40 && c <= MAX_PACK_COPIES && c <= copies * 2 + Math.max(...family.map(packSize)); k++, c += step) {
      const b = bestPacks(product, family, prices, c);
      if (b && b.price < price - 0.5) return { copies: c, price: b.price };
    }
    return null;
  }
  /**
   * The cart's − / + for a design (owner, 26 Nov): { n, step, max, unit, cheaper? } where n counts pieces, or copies for
   * packs (in steps of the family's smallest pack), and `cheaper` a few more copies that cost less. null: changed in
   * the editor.
   */
  function cartCount(d) {
    const product = d && getProduct(d.productId);
    const cl = cartLines(d, product);
    if (!cl || d.orderId) return null;
    if (!counted(cl.size)) return cl.lines.length === 1 ? { n: Number(cl.lines[0].qty) || 1, step: 1, max: MAX_PIECES, unit: 'piece' } : null;
    const family = packFamily(product, d, cl.size, cl.colour);
    const step = Math.min(...family.map(packSize));
    const now = designPrice({ ...d, orderId: null, status: 'ready' });
    const cheaper = now == null ? null : cheaperMore(product, family, packPrices(d, cl.colour, family), cl.copies, step, now);
    return { n: cl.copies, step, max: MAX_PACK_COPIES, unit: cl.size.unit === 'piece' ? 'packPiece' : 'copy', ...(cheaper ? { cheaper } : {}) };
  }
  /** The design with these packs (or pieces) instead: price and pieces as the shop counts them. */
  function withPicks(x, product, colour, picks) {
    const line = (z, qty) => ({ color: { id: colour.id, name: colour.name, hex: colour.hex }, size: { id: z.id, label: withOptions(z.label, x.options), ...packOf(z) }, qty });
    // One size: the design's size follows (the editor's switch to a bigger pack does the same).
    if (picks.length === 1 && picks[0].size.id !== x.size.id) x.size = { ...x.size, id: picks[0].size.id, label: withOptions(picks[0].size.label, x.options) };
    if (picks.length === 1 && picks[0].qty === 1 && colour.id === x.color.id && picks[0].size.id === x.size.id) delete x.quantities;
    else x.quantities = picks.map((p) => line(p.size, p.qty));
    x.price = designPrice({ ...x, orderId: null, status: 'ready' });
    return x;
  }
  app.post('/api/designs/:id/quantity', express.json({ limit: '2kb' }), (req, res) => {
    const d = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!d || d.status !== 'ready') throw new HttpError(404, 'designNotFound');
    const product = getProduct(d.productId);
    if (!product) throw new HttpError(404, 'designNotFound');
    const cl = cartLines(d, product);
    if (!cl || (!counted(cl.size) && cl.lines.length > 1)) throw new HttpError(409, 'qtyInEditor');
    const b = req.body || {};
    // Pieces, or for packs the copies: the cheapest packs of the family that make exactly that many.
    let picks;
    let cheaper = null;
    let switched = null;
    if (!counted(cl.size)) {
      const qty = Number(b.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PIECES) throw new HttpError(400, 'qtyBad');
      picks = [{ size: cl.size, qty }];
    } else {
      const copies = Number(b.copies);
      if (!Number.isInteger(copies) || copies < 1) throw new HttpError(400, 'qtyBad');
      if (copies > MAX_PACK_COPIES) throw new HttpError(400, 'qtyTooManyCopies', { max: MAX_PACK_COPIES.toLocaleString('en-US') });
      const family = packFamily(product, d, cl.size, cl.colour);
      const prices = packPrices(d, cl.colour, family);
      const best = bestPacks(product, family, prices, copies);
      if (!best) throw new HttpError(400, 'qtyBad');
      picks = best.picks;
      // Said only when bigger packs were taken for less than the smallest ones that make that many.
      const small = family.filter((z) => prices.get(z.id) != null).sort((a, c) => packSize(a) - packSize(c))[0];
      if (picks.some((p) => p.size !== small)) switched = picks.map((p) => ({ label: p.size.label, qty: p.qty }));
      // A few more copies that cost less ("1,000 for 2,100 against 900 for 2,450"): said, nothing changed.
      cheaper = cheaperMore(product, family, prices, copies, Math.min(...family.map(packSize)), best.price);
      if (cheaper) cheaper.now = best.price;
    }
    // (Stock is checked when the order is placed, as for any cart.)
    const key = String(req.get('x-design-key') || '');
    const own = !d.orderId && d.cartKeyHash && DESIGN_KEY_RE.test(key) && sameSecret(sha(key), d.cartKeyHash);
    const apply = (x) => {
      withPicks(x, product, cl.colour, picks);
      if (x.price == null) throw new HttpError(409, 'productUnavailable', { name: product.name[langOf(req)] || product.name.en });
      Object.assign(x, pieceInfo(product, x));
    };
    let design;
    let designKey = null;
    if (own) {
      store.mutate((db) => {
        const cur = db.designs[d.id];
        if (!cur || cur.orderId) throw new HttpError(409, 'designOrdered');
        apply(cur);
        design = cur;
      });
    } else {
      // Without the cart's key (added before it existed, or another device): a copy at the new number, with its own key.
      // Copies count against the shop's daily copy room, as "Order again" does (QA 26 Nov: 20 calls copied ~900 MB).
      rateLimit(req, 'designs');
      rateLimit(req, 'designsAll', '*');
      const mb = Math.max(1, Math.ceil(dirBytes(store.designDir(d.id)) / 1e6));
      if (!takeShopBudget('reorderMB', LIMITS.reorderMB, mb)) throw new HttpError(429, 'tooManyWait', { min: 60 });
      const copy = copyDesign(d);
      designKey = copy.token;
      store.mutate((db) => {
        apply(db.designs[copy.design.id]);
        design = db.designs[copy.design.id];
      });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ entry: cartEntry(design, designKey), count: cartCount(design), copied: Boolean(designKey), ...(cheaper ? { cheaper } : {}), ...(switched ? { switched } : {}) });
  });

  app.post('/api/orders/:id/reorder', express.json({ limit: '8kb' }), (req, res) => {
    const order = customerOrderFor(req, req.params.id);
    // Only some of the items ({ items: [item ids] }), or the whole order.
    const asked = Array.isArray((req.body || {}).items) ? new Set(req.body.items.filter((x) => typeof x === 'string').slice(0, 100)) : null;
    const chosen = order.items.map((it, i) => ({ it, i })).filter(({ it }) => !asked || asked.has(it.id));
    if (!chosen.length) throw new HttpError(400, 'badRequest');
    rateLimit(req, 'reorder');
    // Each order again copies the files it takes: a few times per order a day, and a shop-wide daily budget of
    // copied megabytes, so repeated requests can't fill the disk.
    rateLimit(req, 'reorderOrder', order.id);
    const mb = Math.ceil(chosen.reduce((n, { it }) => n + dirBytes(store.designDir(it.designId)), 0) / 1e6);
    if (!takeShopBudget('reorderMB', LIMITS.reorderMB, Math.max(1, mb))) throw new HttpError(429, 'tooManyWait', { min: 60 });
    const items = [];
    const skipped = [];
    chosen.forEach(({ it, i }) => {
      const d = store.getDesign(it.designId);
      const product = getProduct(it.productId);
      let reason = null;
      if (!d || !fs.existsSync(store.designDir(d.id))) reason = 'filesGone';
      else if (d.kind !== 'gangsheet' && (!product || !product.colors.some((c) => c.id === d.color.id) || (d.kind === 'photoset' ? !d.photos.every((p) => product.sizes.some((z) => z.id === p.size.id)) : !product.sizes.some((z) => z.id === d.size.id)))) reason = 'productGone';
      else if (d.photoRemoved) reason = 'photoGone';
      if (reason) {
        skipped.push({ position: i + 1, productName: it.productName, reason });
        return;
      }
      const { design, token, listKey } = copyDesign(d);
      const price = d.kind === 'gangsheet' ? d.price : designPrice({ ...design, orderId: null, status: 'ready' });
      if (price == null) {
        skipped.push({ position: i + 1, productName: it.productName, reason: 'productGone' });
        return;
      }
      design.price = price;
      if (product && d.kind !== 'photoset') Object.assign(design, pieceInfo(product, design));
      store.save();
      items.push(cartEntry(design, token, listKey));
    });
    res.json({ items, skipped });
  });

  // ---------- The cart on the account ----------
  // Signed-in customers: the cart follows them to their other devices. Only design ids are kept
  // (with when they were added, and a book's edit token so it can still be edited); the entries
  // are rebuilt from the designs, so prices are today's and nothing the browser sent is shown back.
  const cartFile = (cust) => path.join(store.dataDir, 'accounts', cust.id, 'cart.json');
  const MAX_CART = 60;
  const BOOK_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
  function readAccountCart(cust) {
    try {
      const c = JSON.parse(fs.readFileSync(cartFile(cust), 'utf8'));
      return c && Array.isArray(c.items) ? c : { items: [], updatedAt: null };
    } catch (e) {
      return { items: [], updatedAt: null };
    }
  }
  /** Cart entries for the account's saved items that can still be ordered. */
  function accountCartEntries(cust) {
    const c = readAccountCart(cust);
    const items = [];
    for (const rec of c.items) {
      const d = rec && UUID_RE.test(rec.designId || '') && store.getDesign(rec.designId);
      if (!d || d.orderId || (d.status && d.status !== 'ready')) continue;
      if (d.kind === 'book' && !rec.editToken) continue;
      items.push({ ...cartEntry(d, d.kind === 'book' ? rec.editToken : rec.designKey, rec.listKey), ...(rec.view ? { view: rec.view } : {}), addedAt: rec.addedAt || c.updatedAt || new Date().toISOString(), ...(rec.later ? { later: true } : {}), ...(rec.movedAt ? { movedAt: rec.movedAt } : {}) });
    }
    return { items, updatedAt: c.updatedAt };
  }
  app.get('/api/account/cart', (req, res) => {
    const me = signedIn(req);
    res.set('Cache-Control', 'no-store');
    res.set('X-Account', me.id);
    res.json(accountCartEntries(me));
  });
  app.put('/api/account/cart', (req, res, next) => {
    rateLimit(req, 'draftSave');
    next();
  }, express.json({ limit: '64kb' }), (req, res) => {
    const me = signedIn(req);
    // Sent for another account than the one signed in now (signed out / switched in between): refused.
    if (req.get('x-account') && req.get('x-account') !== me.id) throw new HttpError(409, 'acctSignIn');
    const list = (req.body || {}).items;
    if (!Array.isArray(list)) throw new HttpError(400, 'badRequest');
    const seen = new Set();
    const items = [];
    for (const it of list.slice(0, MAX_CART)) {
      if (!it || typeof it !== 'object' || !UUID_RE.test(it.designId || '') || seen.has(it.designId)) continue;
      const d = store.getDesign(it.designId);
      if (!d || d.orderId) continue;
      seen.add(it.designId);
      const when = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
      const at = when(it.addedAt) || new Date().toISOString();
      // "Saved for later" (kept out of the order), and when it last moved between cart and saved.
      const moved = when(it.movedAt);
      items.push({ designId: it.designId, addedAt: at, ...(it.later === true ? { later: true } : {}), ...(moved ? { movedAt: moved } : {}), ...(d.kind === 'book' && BOOK_TOKEN_RE.test(it.editToken || '') ? { editToken: it.editToken } : {}), ...(!d.kind && !d.merge && DESIGN_KEY_RE.test(it.designKey || '') ? { designKey: it.designKey } : {}), ...(d.merge && LIST_KEY_RE.test(it.listKey || '') ? { listKey: it.listKey } : {}), ...(it.view && typeof it.view === 'object' && /^[A-Za-z0-9_-]{12}$/.test(it.view.id || '') && /^[A-Za-z0-9_-]{32}$/.test(it.view.key || '') ? { view: { id: it.view.id, key: it.view.key } } : {}) });
    }
    // With `base` (the ids this device last agreed with the account): merged with what the account has
    // now, so a device with an old page open can't drop items added elsewhere or bring back removed ones.
    // Kept: in both, or added on this device since; added elsewhere since: kept too.
    const baseIds = Array.isArray((req.body || {}).base) ? new Set(req.body.base.filter((x) => typeof x === 'string').slice(0, 200)) : null;
    // (Read, merged and written while no other copy of the app writes it: two devices saving at the same moment on
    // two copies lost an item. Tester 2, 26 Nov.)
    store.exclusive(() => {
      let result = items;
      if (baseIds) {
        const stored = readAccountCart(me).items.filter((r) => r && UUID_RE.test(r.designId || ''));
        const mine = new Set(items.map((r) => r.designId));
        const theirs = new Map(stored.map((r) => [r.designId, r]));
        // In both: saved-for-later or not as moved last (on whichever device).
        const latest = (r) => {
          const o = theirs.get(r.designId);
          if (!o || String(o.movedAt || '') <= String(r.movedAt || '')) return r;
          const { later, movedAt, ...rest } = r;
          return { ...rest, ...(o.later ? { later: true } : {}), movedAt: o.movedAt };
        };
        result = [
          ...items.filter((r) => theirs.has(r.designId) || !baseIds.has(r.designId)).map(latest),
          ...stored.filter((r) => !mine.has(r.designId) && !baseIds.has(r.designId)),
        ].slice(0, MAX_CART);
      }
      fs.mkdirSync(path.dirname(cartFile(me)), { recursive: true });
      const updatedAt = new Date().toISOString();
      writeFileAtomic(cartFile(me), JSON.stringify({ items: result, updatedAt }));
    });
    res.set('X-Account', me.id);
    res.json(accountCartEntries(me));
  });

  // Drafts saved to the customer's account, so a design started on the phone opens on the laptop.
  const draftDir = (cust) => path.join(store.dataDir, 'accounts', cust.id, 'drafts');
  const MAX_DRAFTS = 20;
  const DRAFT_DAYS = 120; // drafts not touched for this long are forgotten
  const writeFileAtomic = (file, data) => {
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  };
  function draftIndex(cust) {
    try {
      return JSON.parse(fs.readFileSync(path.join(draftDir(cust), 'index.json'), 'utf8'));
    } catch (e) {
      return {};
    }
  }
  const draftProduct = (req) => {
    const product = getProduct(req.params.productId);
    if (!product || product.kind === 'book') throw new HttpError(404, 'notFound');
    return product;
  };
  app.get('/api/account/drafts', (req, res) => {
    const me = signedIn(req);
    const idx = draftIndex(me);
    res.set('Cache-Control', 'private, no-store');
    const drafts = Object.entries(idx)
      .filter(([pid]) => getProduct(pid))
      .sort((a, b) => String(b[1].savedAt).localeCompare(String(a[1].savedAt)))
      .map(([pid, m]) => ({ productId: pid, productName: getProduct(pid).name, colorId: m.colorId, sizeId: m.sizeId, savedAt: m.savedAt, previewUrl: m.preview ? `/api/account/drafts/${pid}/preview.png?v=${encodeURIComponent(m.savedAt)}` : null }));
    res.json({ drafts });
  });
  app.get('/api/account/drafts/:productId', (req, res) => {
    // Guests: nothing to load (204, not an error the browser logs on every product page).
    if (!currentCustomer(req)) return res.status(204).set('Cache-Control', 'private, no-store').end();
    const me = signedIn(req);
    // Which customer this is (the browser keeps drafts per customer on shared computers).
    res.set('X-Account', me.id);
    const product = draftProduct(req);
    const file = path.join(draftDir(me), `${product.id}.json`);
    res.set('Cache-Control', 'private, no-store');
    // No draft: an empty answer (not an error the browser logs on every page).
    if (!fs.existsSync(file)) return res.status(204).end();
    res.type('application/json').send(fs.readFileSync(file));
  });
  app.get('/api/account/drafts/:productId/preview.png', (req, res) => {
    const me = signedIn(req);
    const product = draftProduct(req);
    const file = path.join(draftDir(me), `${product.id}.png`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'private, max-age=60, no-transform');
    res.type('png').send(fs.readFileSync(file));
  });
  app.put('/api/account/drafts/:productId', (req, res, next) => {
    rateLimit(req, 'draftSave');
    next();
  }, express.json({ limit: '15mb' }), (req, res) => {
    const me = signedIn(req);
    // Saved for another account than the one signed in now (signed out / switched in between): refused.
    if (req.get('x-account') && req.get('x-account') !== me.id) throw new HttpError(409, 'acctSignIn');
    const product = draftProduct(req);
    const b = req.body;
    if (!b || typeof b !== 'object' || !b.designs || typeof b.designs !== 'object' || Array.isArray(b.designs)) throw new HttpError(400, 'notFound');
    const savedAt = new Date().toISOString();
    const dir = draftDir(me);
    fs.mkdirSync(dir, { recursive: true });
    // The small picture is kept as its own file; the rest as sent (the editor checks it when loading).
    let preview = null;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.previewDataUrl === 'string' ? b.previewDataUrl : '');
    if (m) {
      const png = Buffer.from(m[1], 'base64');
      if (png.length < 3 * 1024 * 1024 && png.subarray(0, 8).equals(PNG_SIGNATURE)) preview = png;
    }
    const draft = { ...b, productId: product.id, savedAt };
    delete draft.previewDataUrl;
    writeFileAtomic(path.join(dir, `${product.id}.json`), JSON.stringify(draft));
    if (preview) writeFileAtomic(path.join(dir, `${product.id}.png`), preview);
    else fs.rmSync(path.join(dir, `${product.id}.png`), { force: true });
    // (The list of saved designs is read, changed and written while no other copy of the app writes it: 20 saved
    // as 10 pairs at once showed 17. Tester 2, 26 Nov.)
    store.exclusive(() => {
      const idx = draftIndex(me);
      const id40 = (v) => (typeof v === 'string' ? v.slice(0, 40) : '');
      idx[product.id] = { savedAt, colorId: id40(b.colorId), sizeId: id40(b.sizeId), preview: Boolean(preview) };
      // Keep the newest drafts only, and none older than DRAFT_DAYS.
      const cutoff = new Date(Date.now() - DRAFT_DAYS * 86400e3).toISOString();
      const sorted = Object.entries(idx).sort((x, y) => String(y[1].savedAt).localeCompare(String(x[1].savedAt)));
      const old = [...sorted.slice(MAX_DRAFTS), ...sorted.slice(0, MAX_DRAFTS).filter(([, m]) => String(m.savedAt) < cutoff)];
      for (const [pid] of old) {
        delete idx[pid];
        for (const ext of ['json', 'png']) fs.rmSync(path.join(dir, `${pid}.${ext}`), { force: true });
      }
      writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify(idx));
    });
    res.json({ savedAt });
  });
  app.delete('/api/account/drafts/:productId', (req, res) => {
    const me = signedIn(req);
    const product = draftProduct(req);
    const dir = draftDir(me);
    store.exclusive(() => {
      const idx = draftIndex(me);
      if (idx[product.id]) {
        delete idx[product.id];
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify(idx));
      }
    });
    for (const ext of ['json', 'png']) fs.rmSync(path.join(dir, `${product.id}.${ext}`), { force: true });
    res.status(204).end();
  });

  /** Tell the customer their order is on its way (once), without holding up the request. */
  function sendShipped(order, req) {
    if (typeof notify.orderShipped !== 'function') return;
    const siteUrl = linkBase(req);
    Promise.resolve()
      .then(() => notify.orderShipped(order, { siteUrl, prepayOnly: PAYMENT.prepayOnly }))
      .then((result) => {
        order.notifications = { ...(order.notifications || {}), shipped: { ...(result || {}), at: new Date().toISOString() } };
        store.save();
      })
      .catch((e) => console.warn('[notify] shipped email failed:', e.message));
  }
  /** Every item shipped: the shipment date is set and the customer told (the first time only). */
  function markShipped(order, req) {
    const now = new Date().toISOString();
    for (const it of order.items) {
      if (it.status !== 'shipped') {
        it.status = 'shipped';
        it.history.push({ status: 'shipped', at: now });
      }
    }
    const first = !(order.shipment && order.shipment.shippedAt);
    order.shipment = { ...(order.shipment || {}), shippedAt: (order.shipment && order.shipment.shippedAt) || now };
    return first;
  }

  // Shipping details and delivery, set by the shop.
  app.patch('/api/admin/orders/:orderId/shipment', (req, res, next) => requireAdmin(req, res, next), express.json({ limit: '4kb' }), (req, res) => {
    let order = UUID_RE.test(req.params.orderId) && store.getOrder(req.params.orderId);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const b = req.body || {};
    // (Text or a number only: a list or an object showed as "[object Object]" on the customer's page. QA 25 Nov.)
    for (const k of ['courier', 'trackingNumber', 'trackingUrl', 'eta']) if (b[k] != null && typeof b[k] !== 'string' && typeof b[k] !== 'number') throw new HttpError(400, 'badProductField', { field: k });
    const text = (v, max) => (v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null);
    const s = {}; // (only the fields sent: the rest is taken from the latest order under the lock)
    if ('courier' in b) s.courier = text(b.courier, 60);
    // (Typed with Arabic or Persian digits: kept in Latin digits, as couriers and the English email show them.)
    if ('trackingNumber' in b) s.trackingNumber = text(typeof b.trackingNumber === 'string' ? b.trackingNumber.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : b.trackingNumber, 80);
    if ('trackingUrl' in b) {
      const u = text(b.trackingUrl, 500);
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'badTrackingUrl');
      s.trackingUrl = u;
    }
    if ('eta' in b) {
      const d = text(b.eta, 10);
      if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z')) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d)) throw new HttpError(400, 'badDate');
      s.eta = d;
    }
    // A job still waiting for review or the customer's approval can't be shipped.
    if ((b.shipped === true || b.delivered === true) && order.items.some((it) => REVIEW_STATUSES.includes(it.status))) throw new HttpError(409, 'notApproved');
    // …nor one whose corrected print file is being saved right now (it goes back to the customer for approval). QA 25 Nov.
    if ((b.shipped === true || b.delivered === true) && order.items.some((it) => replacingItems.has(it.id))) throw new HttpError(409, 'fileBeingReplaced');
    // Saved under the lock with the latest order (an item marked shipped on another copy meanwhile: told once).
    let first = false;
    store.mutate(() => {
      const o = store.getOrder(order.id);
      if (!o) throw new HttpError(404, 'orderNotFound');
      if ((b.shipped === true || b.delivered === true) && o.items.some((it) => REVIEW_STATUSES.includes(it.status) || replacingItems.has(it.id))) {
        throw new HttpError(409, o.items.some((it) => REVIEW_STATUSES.includes(it.status)) ? 'notApproved' : 'fileBeingReplaced');
      }
      o.shipment = { ...(o.shipment || {}), ...s };
      if (b.shipped === true || b.delivered === true) first = markShipped(o, req);
      if (b.delivered === true) o.shipment.deliveredAt = o.shipment.deliveredAt || new Date().toISOString();
      if (b.delivered === false) o.shipment.deliveredAt = null;
      order = o;
    });
    if (first) sendShipped(order, req);
    res.json({ shipment: publicShipment(order), status: orderStatus(order), timeline: orderTimeline(order) });
  });
  app.patch('/api/admin/orders/:orderId/payment', (req, res, next) => requireAdmin(req, res, next), express.json({ limit: '1kb' }), (req, res) => {
    const order = UUID_RE.test(req.params.orderId) && store.getOrder(req.params.orderId);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const status = (req.body || {}).status;
    if (!['paid', 'pending'].includes(status)) throw new HttpError(400, 'badStatus', { list: 'paid, pending' });
    order.payment = { ...(order.payment || { method: 'cod' }), status, ...(status === 'paid' ? { paidAt: new Date().toISOString() } : { paidAt: null }) };
    store.save();
    res.json({ payment: order.payment });
  });

  // ---------- Production (admin) ----------
  // Sign in once with the password; every other admin request carries the
  // session token (Authorization: Bearer). 5 wrong passwords lock that
  // visitor out for 15 minutes.
  app.post('/api/admin/login', express.json({ limit: '2kb' }), (req, res) => {
    const mark = (/(?:^|;\s*)pod-admin-device=([^;]+)/.exec(req.get('cookie') || '') || [])[1];
    // Staff (product managers) sign in with their username; the owner with the shop password only.
    const username = typeof (req.body || {}).username === 'string' ? req.body.username.trim() : '';
    // A team member's browser that signed in as them before: other people's wrong guesses don't lock them out.
    const staffMark = (/(?:^|;\s*)pod-staff-device=([^;]+)/.exec(req.get('cookie') || '') || [])[1];
    const result = username
      ? auth.staffLogin(req.ip, username, (req.body || {}).password, staffList(), { knownDevice: (u) => Boolean(u && auth.knownDevice(staffMark, `staff-${u.id}`)), deviceKey: staffMark ? crypto.createHash('sha256').update(staffMark).digest('hex').slice(0, 32) : null })
      : auth.login(req.ip, (req.body || {}).password, { knownDevice: auth.knownDevice(mark) });
    if (!result || result.wait) failedSignIn(req, username, Boolean(result && result.wait));
    if (!result) throw new HttpError(401, username ? 'wrongStaffLogin' : 'wrongPassword');
    if (result.wait) {
      // (Arabic counts: "دقيقة" for 1 and 11+, "دقيقتين" for 2, "دقائق" for 3 to 10.)
      const min = Math.ceil(result.wait / 60);
      throw new HttpError(429, min === 2 ? 'tooManyLoginsTwo' : min % 100 >= 3 && min % 100 <= 10 ? 'tooManyLoginsFew' : 'tooManyLogins', { min });
    }
    res.set('Cache-Control', 'no-store');
    // This browser is now known: a flood of wrong passwords from elsewhere won't lock the owner out of it.
    // (The owner's sign-in only: a staff member's browser gets no pass round the owner's lock.)
    if (!result.user) res.append('Set-Cookie', `pod-admin-device=${auth.deviceMark()}; Path=/api/admin/login; Max-Age=${180 * 24 * 3600}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`);
    else res.append('Set-Cookie', `pod-staff-device=${auth.deviceMark(`staff-${result.user.id}`)}; Path=/api/admin/login; Max-Age=${180 * 24 * 3600}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`);
    // The private preview lets this browser in too (the owner and staff see the shop as customers will).
    previewCookie(req, res, result.user ? staffWho(result.user) : ownerWho());
    const expiresAt = new Date(result.expiresAt).toISOString();
    if (result.user) {
      const w = whoOf(result.user);
      store.mutate((db) => {
        const u = (db.staff || []).find((x) => x.id === result.user.id);
        if (u) u.lastSignIn = new Date().toISOString();
      });
      activity.add({ whoId: w.id, who: w.shown, roles: w.roles, action: 'signIn', label: { en: 'Signed in', ar: 'دخل' }, summary: { en: 'Signed in', ar: 'دخل' }, method: 'POST', path: '/api/admin/login', status: 200, ip: req.ip });
      // (name: the username; shown: the person's name, for the header.)
      return res.json({ token: result.token, expiresAt, id: w.id, role: w.role, roles: w.roles, perms: [...w.perms], name: w.name, shown: w.shown, emailReady: notify.emailReady(), ...approvalCounts(w) });
    }
    // The shared password: the emergency way in, always written to the log.
    activity.add({ whoId: 'owner', who: 'owner', roles: ['owner'], emergency: true, action: 'signIn', label: { en: 'Signed in with the shared password', ar: 'دخل بكلمة السر المشتركة' }, summary: { en: 'Signed in with the shared password', ar: 'دخل بكلمة السر المشتركة' }, method: 'POST', path: '/api/admin/login', status: 200, ip: req.ip });
    const w = emergencyWho();
    res.json({ token: result.token, expiresAt, weakPassword: auth.weak, id: w.id, role: 'owner', roles: w.roles, perms: [...w.perms], name: 'owner', emergency: true, emailReady: notify.emailReady(), ...approvalCounts(w) });
  });
  app.post('/api/admin/logout', (req, res) => {
    auth.logout(security.bearer(req), staffList());
    // Signed out: the private preview's way in for this browser goes too (an invited person's stays).
    const v = preview.verify(auth.previewKey, preview.cookieFrom(req));
    if (v && !v.who.startsWith('p-')) res.append('Set-Cookie', preview.cookie('', { secure: isHttps(req) }));
    res.status(204).end();
  });
  // Wrong sign-ins and lock-outs, for the owner to see someone guessing (a short line each; at most 20 per address
  // per 10 minutes, then one line saying more came).
  const failSeen = new Map();
  function failedSignIn(req, username, locked) {
    const now = Date.now();
    const r = failSeen.get(req.ip) || { from: now, n: 0, told: false };
    if (now - r.from > 10 * 60e3) Object.assign(r, { from: now, n: 0, told: false });
    r.n += 1;
    failSeen.set(req.ip, r);
    if (failSeen.size > 2000) failSeen.clear();
    if (r.n > 20) {
      if (r.told) return;
      r.told = true;
    }
    // (Only a username that exists is written: a password typed into the username box by mistake never is.)
    const typed = String(username || '').trim().toLowerCase();
    const name = typed && staffAll().some((u) => u.username === typed) ? typed : typed ? '?' : '';
    const many = r.n > 20;
    activity.add({
      ...(() => {
        const u = name && name !== '?' ? staffAll().find((x) => x.username === name) : null;
        return u ? { whoId: u.id, who: u.name || u.username, roles: roles.rolesOf(u) } : name === '?' ? { whoId: 'unknown', who: '—', roles: [] } : { whoId: 'owner', who: 'owner', roles: ['owner'] };
      })(),
      action: locked ? 'signInLocked' : 'signInFailed', status: locked ? 429 : 401, ip: req.ip,
      ...(name ? {} : { emergency: true }),
      summary: many ? { en: 'Many wrong sign-ins from one address: the next ones in these 10 minutes are not listed', ar: 'محاولات دخول غلط كتير من نفس العنوان: اللي بعدها في العشر دقايق دي مش متسجلة' }
        : name === '?' ? { en: 'Wrong sign-in: a username that doesn\'t exist', ar: 'دخول غلط: اسم مستخدم مش موجود' }
          : locked ? { en: `Sign-in waiting (too many wrong passwords)${name ? `: ${name}` : ' (shared password)'}`, ar: `الدخول مستني (كلمات سر غلط كتير)${name ? `: ${name}` : ' (كلمة السر المشتركة)'}` }
            : { en: `Wrong password${name ? `: ${name}` : ' (shared password)'}`, ar: `كلمة سر غلط${name ? `: ${name}` : ' (كلمة السر المشتركة)'}` },
    });
  }
  // ---------- Who is signed in, and what they may do (src/roles.js) ----------
  // Team members sign in with their own username and password; the shared password is the owner's
  // emergency way in (it always works, and every use is in the activity log).
  const staffAll = () => store.db.staff || [];
  /** The people who can sign in: not switched off, and with a password set (a set-up link not used yet can't). */
  const staffList = () => staffAll().filter((u) => u.active !== false && u.hash);
  const whoOf = (u) => {
    const rs = roles.rolesOf(u);
    return { id: u.id, name: u.username, shown: u.name || u.username, roles: rs, role: roles.mainRole(rs), perms: roles.permsOf(rs) };
  };
  const emergencyWho = () => ({ id: 'owner', name: 'owner', roles: ['owner'], role: 'owner', perms: roles.permsOf(['owner']), emergency: true });
  /** Changes still to decide (waiting, or failed when approved): the owner's count, and the person's own. */
  const approvalCounts = (w) => {
    const open = (store.db.approvals || []).filter((a) => a.status === 'pending' || a.status === 'failed' || a.status === 'applying');
    return { pendingApprovals: w.perms.has('approvals') ? open.length : 0, myPending: open.filter((a) => a.by && a.by.id === w.id).length };
  };
  const activity = new roles.ActivityLog(path.join(dataDir, 'activity.jsonl'));
  // Changes an owner approved, while they run again (see the approvals below): id -> who made them.
  const approvalRuns = new Map();
  const replayKey = crypto.randomBytes(24).toString('hex');
  const sameText = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  // Routes where people without orders.amounts get the answer with the amounts taken out.
  const NO_AMOUNTS = new Set(['orders.view', 'orders.work', 'review.view', 'review.work', 'production', 'customers.view', 'customers.contact', 'houses.view', 'houses.edit', 'rights', 'payments']);
  /**
   * Every admin route: who is asking (401 if no one), may they (403), and for catalogue and money
   * changes by anyone but an owner: kept for an owner's approval (202) instead of done.
   */
  const adminGate = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const key = `${req.method === 'HEAD' ? 'GET' : req.method} ${req.route.path}`;
    const route = roles.routeOf(req.method, req.route.path);
    let who = null;
    const run = req.get('x-approval-replay');
    if (run) {
      const [k, id] = String(run).split('.');
      const r = sameText(k, replayKey) && approvalRuns.get(id);
      if (!r) throw new HttpError(401, 'signInAgain');
      who = { ...r.who, perms: roles.permsOf(r.who.roles), approvalId: id, approvedBy: r.by, approvedByEmergency: r.byEmergency };
    } else {
      const token = security.bearer(req);
      if (auth.verify(token)) who = emergencyWho();
      else {
        const u = auth.verifyStaff(token, staffList());
        if (u) who = whoOf(u);
      }
    }
    if (!who) throw new HttpError(401, 'signInAgain');
    req.adminWho = who;
    if (!who.approvalId) {
      const allowed = route.perm === 'owner-only' ? who.role === 'owner' : !route.perm || who.perms.has(route.perm);
      if (!allowed) {
        if (!refusedTooMany(who, 403)) {
          activity.add({ whoId: who.id, who: who.shown || who.name, roles: who.roles, action: key, label: route.label || null, method: req.method, path: req.originalUrl.split('?')[0].slice(0, 300), status: 403,
            summary: { en: `Not allowed for their role: ${(route.label && route.label.en) || key}`, ar: `مش مسموح للدور بتاعه: ${(route.label && route.label.ar) || key}` } });
        }
        throw new HttpError(403, 'noPermission');
      }
    }
    {
      // An order's secret keys never reach the dashboard (whoever asks), and amounts only people allowed them.
      const hideAmounts = !who.perms.has('orders.amounts') && NO_AMOUNTS.has(route.perm);
      const send = res.json.bind(res);
      res.json = (body) => send(roles.withoutSecrets(hideAmounts ? roles.withoutAmounts(body) : body));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !route.quiet) {
      res.on('finish', () => !refusedTooMany(who, res.statusCode) && activity.add({
        whoId: who.id, who: who.shown || who.name, roles: who.roles, ...(who.emergency ? { emergency: true } : {}),
        action: key, label: route.label || null, method: req.method, path: req.originalUrl.split('?')[0].slice(0, 300),
        // (outcome 'failed': an approval whose change couldn't be applied, and that change's own line.)
        status: res.statusCode, ...(res.locals.outcome || (who.approvalId && res.statusCode >= 400) ? { outcome: res.locals.outcome || 'failed' } : {}),
        ...(res.locals.approvalId || who.approvalId ? { approvalId: res.locals.approvalId || who.approvalId } : {}),
        ...(who.approvedBy ? { approvedBy: who.approvedBy } : {}), ...(who.approvedByEmergency ? { approvedByEmergency: true } : {}),
        ...(() => {
          const sum = res.locals.summary || (who.approvalId && (findApproval(who.approvalId) || {}).summary) || workAbout(route, req) || doneAbout(key, route, req) || route.label;
          return sum ? { summary: sum } : {};
        })(),
        // (Never a password: those routes log no body at all. A refused request: its field names only.)
        body: route.noBody ? undefined : res.statusCode >= 400 && res.statusCode !== 409 && req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object'
          ? { fields: Object.keys(req.body).slice(0, 20) }
          : roles.shortBody(req.body && (Buffer.isBuffer(req.body) || Object.keys(req.body).length) ? req.body : undefined),
      }));
    }
    // (A printing house about to go: its name kept for the activity line.)
    if (key === 'DELETE /api/admin/houses/:id') req.locals_houseName = ((store.db.printHouses || []).find((x) => x.id === req.params.id) || {}).name;
    if (route.approve && who.role !== 'owner' && !who.approvalId) return holdForApproval(req, res, key, route).catch(next);
    next();
  };
  const requireAdmin = adminGate;
  const requireCatalog = adminGate;
  // Refused requests are logged, but at most 30 per person per 10 minutes (one more line says the rest were left out).
  const refusedSeen = new Map();
  function refusedTooMany(who, status) {
    if (status < 400) return false;
    const now = Date.now();
    const r = refusedSeen.get(who.id) || { from: now, n: 0, told: false };
    if (now - r.from > 10 * 60e3) Object.assign(r, { from: now, n: 0, told: false });
    r.n += 1;
    refusedSeen.set(who.id, r);
    if (refusedSeen.size > 500) refusedSeen.clear();
    if (r.n <= 30) return false;
    if (!r.told) {
      r.told = true;
      activity.add({ whoId: who.id, who: who.shown || who.name, roles: who.roles, action: 'manyRefused', status: 429, summary: { en: 'Many refused requests: the next ones in these 10 minutes are not listed one by one', ar: 'طلبات كتير اترفضت: اللي بعدها في العشر دقايق دي مش متسجلة واحدة واحدة' } });
    }
    return true;
  }
  // What daily work was about, for the activity log: the order and item, and what was set.
  const WORK_WORDS = {
    queued: ['queued', 'في الانتظار'], printing: ['printing', 'بيتطبع'], printed: ['printed', 'اتطبع'], shipped: ['shipped', 'اتشحن'], delivered: ['delivered', 'اتسلم'],
    paid: ['paid', 'اتدفع'], pending: ['not paid yet', 'لسه متدفعش'], approve: ['approved', 'اتوافق عليه'], changes: ['changes asked', 'اتطلب تعديلات'], reopen: ['sent back to Review after approval', 'رجع للمراجعة بعد الموافقة'],
    dtf: ['print method: DTF', 'طريقة الطباعة: DTF'], dtg: ['print method: DTG', 'طريقة الطباعة: DTG'], embroidery: ['embroidery', 'تطريز'],
    done: ['handled', 'اتعمل'], new: ['open again', 'اتفتح تاني'], whatsapp: ['WhatsApp', 'واتساب'], email: ['email', 'إيميل'],
  };
  /**
   * A change that needs the owner's approval when the team asks, made by someone allowed to make it directly (the
   * owner): said in the same words as the request would be ("Ready design: 1 design: pause", the product and its
   * prices), not only the bare label. QA 26 Nov.
   */
  function doneAbout(key, route, req) {
    if (!route.approve || !route.label) return null;
    try {
      const about = approvalAbout(key, req);
      if (!about || !(about.en || about.ar)) return null;
      return { en: [route.label.en, about.en].filter(Boolean).join(': '), ar: [route.label.ar, about.ar].filter(Boolean).join(': ') };
    } catch (e) {
      return null;
    }
  }
  function workAbout(route, req) {
    if (!route.label || route.approve) return null;
    const b = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
    const p = req.params || {};
    // (A team member: by name and username, and what changed in words; the person as they were before, so a removed
    // one is still named. QA 25 Nov.)
    if (p.id && /^\/api\/admin\/staff\/[^/?]+/.test(req.originalUrl)) {
      const u = req.staffBefore || staffAll().find((x) => x.id === p.id);
      if (!u) return null;
      const who = `\u2068${u.name} (${u.username})\u2069`;
      const sep = (l) => (l === 'ar' ? '، ' : ', ');
      const what = (l) => {
        const out = [];
        if (Array.isArray(b.roles)) out.push(`${l === 'ar' ? 'الأدوار' : 'roles'} ${b.roles.map((r) => (roles.ROLE_NAMES[r] || {})[l] || String(r).slice(0, 20)).join(sep(l))}`);
        if (typeof b.active === 'boolean') out.push(b.active ? (l === 'ar' ? 'اتشغّل' : 'switched on') : (l === 'ar' ? 'اتقفل' : 'switched off'));
        if (typeof b.name === 'string' && cleanStaffName(b.name) && cleanStaffName(b.name) !== u.name) out.push(`${l === 'ar' ? 'الاسم' : 'name'} \u2068${cleanStaffName(b.name)}\u2069`);
        return out.join(sep(l));
      };
      return { en: [route.label.en, who, what('en')].filter(Boolean).join(': '), ar: [route.label.ar, who, what('ar')].filter(Boolean).join(': ') };
    }
    const found = p.itemId ? store.findItem(p.itemId) : null;
    const order = found ? found.order : p.orderId ? store.getOrder(p.orderId) : null;
    if (!order && !Object.keys(b).length) return null;
    // (The product: of the job, or the one a printing house is set for.)
    const prod = (found && getProduct(found.item.productId)) || (typeof b.productId === 'string' && getProduct(b.productId)) || null;
    // (A value someone typed is kept apart, in isolates (U+2068 … U+2069): its digits and direction stay as typed in the Arabic log,
    // "مطبعة 01012345678", not "٠١٠١٢٣٤٥٦٧٨". QA 26 Nov.)
    const typed = (v, n = 60) => { const x = String(v).trim().slice(0, n); return { en: x, ar: `\u2068${x}\u2069` }; };
    const word = (v) => (WORK_WORDS[v] ? { en: WORK_WORDS[v][0], ar: WORK_WORDS[v][1] } : v == null ? null : typed(v));
    const bits = [];
    for (const k of ['status', 'decision', 'action', 'process', 'via', 'channel']) if (typeof b[k] === 'string') bits.push(word(b[k]));
    if (typeof b.houseId === 'string') {
      const h = (store.db.printHouses || []).find((x) => x.id === b.houseId);
      if (h) bits.push(typed(h.name));
    }
    // (The tracking number as it is saved: Arabic-Indic digits typed become 0-9.)
    const latin = (x) => x.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    for (const k of ['courier', 'trackingNumber']) if (typeof b[k] === 'string' && b[k].trim()) bits.push(typed(k === 'trackingNumber' ? latin(b[k]) : b[k], 40));
    // (A printing house: its name, as sent or as it was before it went.)
    if (/\/houses\b/.test(req.originalUrl)) {
      const h = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : (req.locals_houseName || ((store.db.printHouses || []).find((x) => x.id === p.id) || {}).name);
      if (h) bits.unshift(typed(h));
    }
    // (A rights request: whose, about which link.)
    const td = /\/takedowns\//.test(req.originalUrl) && (store.db.takedowns || []).find((x) => x.id === p.id);
    if (td) { const w = [td.name, td.link].filter(Boolean).join(' · ').slice(0, 80); if (w) bits.unshift(typed(w, 80)); }
    // (In Arabic the number is kept left to right: "#POD-1001", not "POD-1001#". QA 25 Nov.)
    const head = order ? `#${order.number}` : '';
    const en = [route.label.en, [head, prod ? prod.name.en : ''].filter(Boolean).join(' · '), bits.map((x) => x.en).join(', ')].filter(Boolean);
    const ar = [route.label.ar, [head ? `\u2066${head}\u2069` : '', prod ? prod.name.ar : ''].filter(Boolean).join(' · '), bits.map((x) => x.ar).join('، ')].filter(Boolean);
    return en.length > 1 ? { en: en.join(': '), ar: ar.join(': ') } : null;
  }
  // ---------- Private preview: on/off and the people invited (owner only) ----------
  const previewView = (req) => ({ on: previewOn(), people: previewPeople().map((x) => preview.personRow(x, linkBase(req))) });
  app.get('/api/admin/preview', requireAdmin, (req, res) => res.json(previewView(req)));
  app.put('/api/admin/preview', requireAdmin, express.json({ limit: '1kb' }), (req, res) => {
    if (typeof (req.body || {}).on !== 'boolean') throw new HttpError(400, 'badProductField', { field: 'on' });
    store.mutate((db) => {
      db.preview ||= { on: false, people: [] };
      db.preview.on = req.body.on;
    });
    res.json(previewView(req));
  });
  app.post('/api/admin/preview/people', requireAdmin, express.json({ limit: '2kb' }), (req, res) => {
    const name = preview.cleanName((req.body || {}).name);
    if (!name) throw new HttpError(400, 'fieldRequired', { field: { en: 'Name', ar: 'الاسم' } });
    // The owner's own code ("@ezzatinvite" -> "EZZATINVITE": letters and digits, 6 to 24), or a made-up one.
    const rawCode = typeof (req.body || {}).code === 'string' ? req.body.code.trim() : '';
    const own = rawCode ? preview.normCode(rawCode) : '';
    // (English letters and digits, Arabic digits read as digits; anything else is refused rather than dropped.)
    if (rawCode && (!preview.codeTyped(rawCode) || own.length < 6 || own.length > 24)) throw new HttpError(400, 'previewCodeBad');
    const person = store.mutate((db) => {
      db.preview ||= { on: false, people: [] };
      if (db.preview.people.length >= 500) throw new HttpError(400, 'badProductField', { field: 'people' });
      if (own && db.preview.people.some((x) => x.code === own)) throw new HttpError(409, 'previewCodeTaken');
      let code = own;
      while (!code || (!own && db.preview.people.some((x) => x.code === code))) code = preview.newCode();
      const p = { id: crypto.randomBytes(6).toString('hex'), name, code, createdAt: new Date().toISOString(), visits: 0 };
      db.preview.people.push(p);
      return p;
    });
    res.status(201).json(preview.personRow(person, linkBase(req)));
  });
  // { name } renames, { off: true|false } shuts them out / lets them in again.
  app.patch('/api/admin/preview/people/:id', requireAdmin, express.json({ limit: '2kb' }), (req, res) => {
    const b = req.body || {};
    const name = b.name === undefined ? null : preview.cleanName(b.name);
    if (b.name !== undefined && !name) throw new HttpError(400, 'fieldRequired', { field: { en: 'Name', ar: 'الاسم' } });
    if (b.off !== undefined && typeof b.off !== 'boolean') throw new HttpError(400, 'badProductField', { field: 'off' });
    const person = store.mutate((db) => {
      const p = ((db.preview && db.preview.people) || []).find((x) => x.id === req.params.id);
      if (!p) throw new HttpError(404, 'notFound');
      if (name) p.name = name;
      if (typeof b.off === 'boolean') p.off = b.off;
      return p;
    });
    res.json(preview.personRow(person, linkBase(req)));
  });
  app.delete('/api/admin/preview/people/:id', requireAdmin, (req, res) => {
    store.mutate((db) => {
      const list = (db.preview && db.preview.people) || [];
      if (!list.some((x) => x.id === req.params.id)) throw new HttpError(404, 'notFound');
      db.preview.people = list.filter((x) => x.id !== req.params.id);
    });
    res.json(previewView(req));
  });
  app.get('/api/admin/session', adminGate, (req, res) => {
    const w = req.adminWho;
    const list = store.db.approvals || [];
    res.json({
      ok: true, id: w.id, role: w.role, roles: w.roles, perms: [...w.perms], emailReady: notify.emailReady(),
      // (The dashboard's payment lines: nothing to collect on delivery once the shop takes payment in advance.)
      payment: { ...PAYMENT },
      ...(w.emergency ? { emergency: true, weakPassword: auth.weak } : { name: w.name, shown: w.shown || w.name }),
      ...approvalCounts(w),
    });
  });

  // ---------- Products (product manager) ----------
  // Changes are laid over the products as written (src/catalog.js); see the notes there.
  const catalogEdits = () => (store.db.catalog && store.db.catalog.products) || {};
  const adminProduct = (p) => {
    const row = catalog.forAdmin(p, catalogEdits()[p.id]);
    const pr = (store.db.pricing || {})[p.id] || {};
    // The built-in prices, so the screen can show what "back to the original" gives.
    const d = accounting.defaultsFor(p.id);
    return { ...row, pricesChanged: Boolean(Object.keys(pr).length), original: { ...row.original, ...(d ? { prices: { basePrice: d.basePrice, extraSidePrice: d.extraSidePrice, sizes: d.sizes } } : {}) } };
  };
  // Top-level fields of an edit and the keys each one holds (a field sent with its default value clears it).
  // The status carries its pause details (reason, note, return day): sending a status clears the
  // others it doesn't send. The return day can also be changed on its own.
  const EDIT_FIELDS = {
    name: ['name'], description: ['description'], category: ['category'], status: ['status', 'hiddenReason', 'hiddenNote', 'showAgainOn'], showAgainOn: ['showAgainOn'],
    stock: ['stock'], variantStock: ['variantStock'], lowStockAt: ['lowStockAt'], colors: ['colors'], addColors: ['addColors'], sizes: ['sizes'], addSizes: ['addSizes'],
    sides: ['sides'], process: ['process'], methods: ['methods'], embroidery: ['embroidery'],
  };
  const STATUS_LOG = { live: 'in the shop', hidden: 'paused', removed: 'stopped selling' };
  const logCatalog = (db, req, productId, what) => {
    db.catalogLog ||= [];
    // (A team member's change applied on an owner's approval: who approved it too.)
    const w = req.adminWho;
    db.catalogLog.push({ at: new Date().toISOString(), who: w.name, ...(w.approvalId ? { approvedBy: w.approvedByEmergency ? 'owner' : w.approvedBy } : {}), productId, what: String(what).slice(0, 200) });
    if (db.catalogLog.length > 500) db.catalogLog.splice(0, db.catalogLog.length - 500);
  };
  /** A product manager's edit with the money fields as they stand now (they can't change prices). */
  function staffPrices(product, body) {
    const prev = catalogEdits()[product.id] || {};
    const out = { ...body };
    if (Array.isArray(body.addSizes)) {
      const before = new Map((prev.addSizes || []).map((z) => [z && z.id, (z && z.surcharge) || 0]));
      out.addSizes = body.addSizes.map((z) => (z && typeof z === 'object' ? { ...z, surcharge: before.get(z.id) || 0 } : z));
    }
    if (body.embroidery && typeof body.embroidery === 'object') {
      const now = product.embroidery ? product.embroidery.surcharge
        : prev.embroidery && typeof prev.embroidery === 'object' ? prev.embroidery.surcharge
          : (productsMod.EMBROIDERY[product.base || product.id] || { surcharge: 150 }).surcharge;
      out.embroidery = { ...body.embroidery, surcharge: now };
    }
    return out;
  }
  /** Save the fields sent for a product (others stay as they were); prices go to the owner's price list. */
  const saveProductEdit = (req, product, body) => {
    // Every selling price is the owner's: a product manager's add-on for a new size and embroidery price
    // are kept as they are (a new size adds nothing; embroidery costs what the owner or the shop set).
    if (req.adminWho.role !== 'owner') body = staffPrices(product, body);
    const c = catalog.clean(product, body, { categories: CATEGORIES.map((x) => x.id), prev: catalogEdits()[product.id] || null });
    if (c.error) throw new HttpError(400, c.error, { field: c.field || '' });
    let pricing = null;
    // Selling prices are the owner's: a product manager sees them but can't change them.
    if (body.prices !== undefined && req.adminWho.role !== 'owner') throw new HttpError(403, 'ownerOnly');
    if (body.prices !== undefined) {
      const pr = accounting.cleanPricing(product, body.prices || {});
      if (pr.error) throw new HttpError(400, pr.error);
      pricing = pr.pricing;
    }
    const sent = Object.keys(EDIT_FIELDS).filter((k) => body[k] !== undefined);
    store.mutate((db) => {
      db.catalog ||= {};
      db.catalog.products ||= {};
      const prev = db.catalog.products[product.id] || {};
      const next = { ...prev };
      for (const k of sent) for (const key of EDIT_FIELDS[k]) delete next[key];
      for (const k of sent) for (const key of EDIT_FIELDS[k]) if (c.edit[key] !== undefined) next[key] = c.edit[key];
      // A pause whose return day has gone by: it is in the shop already, so it's saved as live.
      if (next.status === 'hidden' && next.showAgainOn && next.showAgainOn < catalog.today()) {
        for (const key of EDIT_FIELDS.status) delete next[key];
      }
      if (pricing) {
        db.pricing ||= {};
        if (Object.keys(pricing).length) db.pricing[product.id] = pricing;
        else delete db.pricing[product.id];
      }
      const changed = JSON.stringify(next) !== JSON.stringify(prev);
      if (changed) {
        next.updatedAt = new Date().toISOString();
        next.updatedBy = req.adminWho.name;
      }
      const keep = Object.keys(next).filter((k) => !['updatedAt', 'updatedBy'].includes(k));
      if (keep.length) db.catalog.products[product.id] = next;
      else delete db.catalog.products[product.id];
      // A new status is logged as what happened (paused, stopped selling, back in the shop).
      const was = prev.status || 'live';
      const now = next.status || 'live';
      const words = sent.filter((k) => k !== 'status' && !(k === 'showAgainOn' && sent.includes('status')));
      if (was !== now) words.unshift(STATUS_LOG[now]);
      else if (sent.includes('status')) words.unshift('status');
      if (changed || pricing) logCatalog(db, req, product.id, [...words, ...(pricing ? ['prices'] : [])].join(', '));
    });
    syncCatalog();
  };
  app.get('/api/admin/catalog', requireCatalog, (req, res) => {
    res.json({
      role: req.adminWho.role,
      categories: CATEGORIES,
      hideReasons: catalog.HIDE_REASONS,
      maxPhotos: catalog.MAX_PHOTOS,
      today: catalog.today(), // the shop's day: the earliest a pause can end
      mockup: { width: MOCKUP_WIDTH, height: MOCKUP_HEIGHT },
      products: PRODUCTS.map(adminProduct),
      log: (store.db.catalogLog || []).slice(-50).reverse(),
    });
  });
  app.get('/api/admin/catalog/:id', requireCatalog, (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    res.json(adminProduct(p));
  });
  app.put('/api/admin/catalog/:id', requireCatalog, express.json({ limit: '200kb' }), (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    saveProductEdit(req, p, req.body && typeof req.body === 'object' ? req.body : {});
    res.json(adminProduct(getProduct(p.id)));
  });
  // A new product, made from an existing one (its drawing, 3D model and print setup). It starts hidden.
  app.post('/api/admin/catalog', requireCatalog, express.json({ limit: '200kb' }), (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const n = catalog.cleanNew(body, PRODUCTS);
    if (n.error) throw new HttpError(400, n.error, { field: n.field || '' });
    const from = getProduct(n.template);
    store.mutate((db) => {
      db.catalog ||= {};
      db.catalog.products ||= {};
      if (db.catalog.products[n.id]) throw new HttpError(400, 'productIdTaken');
      db.catalog.products[n.id] = {
        template: n.template, createdAt: new Date().toISOString(), createdBy: req.adminWho.name,
        name: { en: `${from.name.en} (new)`, ar: `${from.name.ar} (جديد)` },
        status: 'hidden', hiddenReason: 'other', hiddenNote: 'New product: check it, then show it in the shop',
      };
      logCatalog(db, req, n.id, `new product from ${n.template}`);
    });
    syncCatalog();
    const fields = { ...body };
    delete fields.id;
    delete fields.template;
    // A product manager's new product starts at the template's prices (the owner sets its own).
    if (req.adminWho.role !== 'owner') delete fields.prices;
    if (Object.keys(fields).length) {
      try {
        saveProductEdit(req, getProduct(n.id), fields);
      } catch (e) {
        // A bad field: the product stays (hidden), and the manager fixes the field on its page.
        return res.status(201).json({ ...adminProduct(getProduct(n.id)), warning: e.code || 'badProductField' });
      }
    }
    res.status(201).json(adminProduct(getProduct(n.id)));
  });
  // Back to the product as written (built-in products). Products are never deleted, so old orders,
  // accounts and the change log keep naming them: they are archived instead ("stop selling", status 'removed')
  // and can be sold again any time.
  app.delete('/api/admin/catalog/:id', requireCatalog, (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    if (!catalog.isBuiltIn(p.id)) throw new HttpError(409, 'productsKept');
    store.mutate((db) => {
      if (db.catalog && db.catalog.products) delete db.catalog.products[p.id];
      logCatalog(db, req, p.id, 'reset to the original');
    });
    // Its uploaded photos went with the changes.
    fs.rmSync(photoDir(p.id), { recursive: true, force: true });
    syncCatalog();
    res.json(adminProduct(getProduct(p.id)));
  });

  // Product photos: stored in the data folder as WebP (up to 1600 px), the first (or chosen) one leads.
  const PHOTO_ID_RE = /^[a-f0-9]{16}$/;
  const photoDir = (pid) => path.join(dataDir, 'catalog-photos', pid);
  app.post('/api/admin/catalog/:id/photos', requireCatalog, express.raw({ type: () => true, limit: '15mb' }), asyncRoute(async (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    const prev = (catalogEdits()[p.id] || {}).photos || [];
    if (prev.length >= catalog.MAX_PHOTOS) throw new HttpError(400, 'tooManyPhotos', { max: catalog.MAX_PHOTOS });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new HttpError(400, 'badPhoto');
    let webp;
    try {
      const meta = await sharp()(req.body, { limitInputPixels: 80e6 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('type');
      webp = await sharp()(req.body, { limitInputPixels: 80e6 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
    } catch (e) {
      throw new HttpError(400, 'badPhoto');
    }
    const id = crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(photoDir(p.id), { recursive: true });
    fs.writeFileSync(path.join(photoDir(p.id), `${id}.webp`), webp);
    try {
      store.mutate((db) => {
        db.catalog ||= {};
        db.catalog.products ||= {};
        const e = (db.catalog.products[p.id] ||= {});
        // Checked again under the lock: several photos sent at once can't go past the limit.
        if ((e.photos || []).length >= catalog.MAX_PHOTOS) throw new HttpError(400, 'tooManyPhotos', { max: catalog.MAX_PHOTOS });
        e.photos = [...(e.photos || []), { id }];
        e.updatedAt = new Date().toISOString();
        e.updatedBy = req.adminWho.name;
        logCatalog(db, req, p.id, 'photo added');
      });
    } catch (e) {
      fs.rmSync(path.join(photoDir(p.id), `${id}.webp`), { force: true });
      throw e;
    }
    syncCatalog();
    res.status(201).json(adminProduct(getProduct(p.id)));
  }));
  // Order of the photos and which one leads: { order: [ids], main: id }.
  app.put('/api/admin/catalog/:id/photos', requireCatalog, express.json({ limit: '8kb' }), (req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw new HttpError(404, 'unknownProduct');
    const b = req.body || {};
    store.mutate((db) => {
      const e = db.catalog && db.catalog.products && db.catalog.products[p.id];
      if (!e || !e.photos) throw new HttpError(404, 'notFound');
      // Both checked before anything changes: a refused request keeps nothing (QA 25 Nov).
      const ids = e.photos.map((ph) => ph.id);
      if (Array.isArray(b.order) && (b.order.length !== ids.length || !ids.every((id) => b.order.includes(id)))) throw new HttpError(400, 'badProductField', { field: 'order' });
      if (b.main !== undefined && b.main !== null && !ids.includes(b.main)) throw new HttpError(400, 'badProductField', { field: 'main' });
      if (Array.isArray(b.order)) e.photos = b.order.map((id) => e.photos.find((ph) => ph.id === id));
      if (b.main !== undefined) {
        if (b.main === null) delete e.mainPhoto;
        else e.mainPhoto = b.main;
      }
      e.updatedAt = new Date().toISOString();
      e.updatedBy = req.adminWho.name;
      logCatalog(db, req, p.id, 'photos arranged');
    });
    syncCatalog();
    res.json(adminProduct(getProduct(p.id)));
  });
  app.delete('/api/admin/catalog/:id/photos/:photoId', requireCatalog, (req, res) => {
    const p = getProduct(req.params.id);
    if (!p || !PHOTO_ID_RE.test(req.params.photoId)) throw new HttpError(404, 'notFound');
    store.mutate((db) => {
      const e = db.catalog && db.catalog.products && db.catalog.products[p.id];
      if (!e || !(e.photos || []).some((ph) => ph.id === req.params.photoId)) throw new HttpError(404, 'notFound');
      e.photos = e.photos.filter((ph) => ph.id !== req.params.photoId);
      if (!e.photos.length) delete e.photos;
      if (e.mainPhoto === req.params.photoId) delete e.mainPhoto;
      e.updatedAt = new Date().toISOString();
      e.updatedBy = req.adminWho.name;
      logCatalog(db, req, p.id, 'photo removed');
    });
    fs.rmSync(path.join(photoDir(p.id), `${req.params.photoId}.webp`), { force: true });
    syncCatalog();
    res.json(adminProduct(getProduct(p.id)));
  });
  app.get('/catalog-photos/:pid/:file', (req, res) => {
    const m = /^([a-f0-9]{16})\.webp$/.exec(req.params.file);
    if (!m || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(req.params.pid)) throw new HttpError(404, 'notFound');
    const file = path.join(photoDir(req.params.pid), `${m[1]}.webp`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type('image/webp').send(fs.readFileSync(file));
  });

  // ---------- The team (owners only): personal sign-ins, roles, set-up links ----------
  /** Cancels a person's changes still to decide (inside store.mutate), with why; their pictures go too. */
  const cancelOpenOf = (db, personId, who, which, why) => {
    const at = new Date().toISOString();
    for (const a of db.approvals || []) {
      if (!a.by || a.by.id !== personId || !(a.status === 'pending' || a.status === 'failed') || !which(a)) continue;
      a.status = 'cancelled';
      a.decidedBy = { id: who.id, name: who.shown || who.name };
      a.decidedAt = at;
      a.note = {
        'switched off': { en: 'Cancelled: the person was switched off.', ar: 'اتلغى: الشخص اتوقف.' },
        'role changed': { en: 'Cancelled: the person no longer has the role for it.', ar: 'اتلغى: الشخص مبقاش عنده الدور ده.' },
        removed: { en: 'Cancelled: the person was removed.', ar: 'اتلغى: الشخص اتشال من الفريق.' },
      }[why] || why;
      for (const f of [a.file, a.thumb, a.bodyFile]) if (f) fs.rmSync(path.join(dataDir, 'approvals', f), { force: true });
    }
  };
  const staffRow = (u) => {
    const rs = roles.rolesOf(u);
    return {
      id: u.id, name: u.name, username: u.username, roles: rs, role: roles.mainRole(rs), active: u.active !== false,
      createdAt: u.createdAt, lastSignIn: u.lastSignIn || null, setupPending: !u.hash,
    };
  };
  const SETUP_MS = 48 * 3600e3;
  /** A new set-up link for a team member (48 hours; they choose their own password with it). */
  const newSetup = (req) => {
    const token = crypto.randomBytes(24).toString('base64url');
    return { token, setup: { hash: crypto.createHash('sha256').update(token).digest('hex'), exp: Date.now() + SETUP_MS }, link: `${linkBase(req)}/admin?setup=${token}` };
  };
  const cleanStaffName = (v) => {
    // (No invisible direction marks either: "\u202Enimda" would show as "admin" in the team list. QA 25 Nov.)
    // (Blank-looking letters too, the Hangul fillers and the Mongolian vowel separator, and the Arabic letter mark. QA 25 Nov.)
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u3164\ufeff\uffa0]/g, '').trim().slice(0, 60) : '';
    return /[\p{L}\p{N}]/u.test(s) ? s : '';
  };
  // (The team's password check: src/passwords.js, with the list customers' passwords use too.)
  app.get('/api/admin/staff', requireAdmin, (req, res) => res.json({
    staff: staffAll().map(staffRow),
    roles: roles.ROLES.map((id) => ({ id, name: roles.ROLE_NAMES[id], perms: roles.ROLE_PERMS[id] })),
  }));
  // { name, username, roles } -> a set-up link to send them; ({ password } sets it straight away instead).
  // (The team member as they were before the change, for the activity line.)
  app.use('/api/admin/staff/:id', (req, res, next) => {
    if (req.method !== 'GET') req.staffBefore = staffAll().find((x) => x.id === req.params.id) || null;
    next();
  });
  app.post('/api/admin/staff', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const b = req.body || {};
    const name = cleanStaffName(b.name);
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    const rs = roles.cleanRoles(b.roles !== undefined ? b.roles : b.role !== undefined ? b.role : ['catalogue']);
    if (!name || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || !rs) throw new HttpError(400, 'badStaff');
    if (b.password !== undefined && !staffPassword(b.password, { username, name })) throw new HttpError(400, 'passwordTooShort');
    if (b.password !== undefined && rs.includes('owner')) throw new HttpError(403, 'ownerPasswordLink');
    const s = b.password === undefined ? newSetup(req) : null;
    const user = {
      id: crypto.randomBytes(8).toString('hex'), name, username, roles: rs, active: true, gen: 0, ...(rs.includes('owner') ? { everOwner: true } : {}),
      createdAt: new Date().toISOString(), createdBy: req.adminWho.shown || req.adminWho.name,
      ...(s ? { setup: s.setup } : { ...security.AdminAuth.hashStaffPassword(b.password), passwordByOther: true }),
    };
    store.mutate((db) => {
      db.staff ||= [];
      if (db.staff.some((u) => u.username === username)) throw new HttpError(400, 'staffTaken');
      if (db.staff.length >= 100) throw new HttpError(400, 'badStaff');
      db.staff.push(user);
    });
    res.status(201).json({ ...staffRow(user), user: staffRow(user), ...(s ? { setupLink: s.link, setupExpiresAt: new Date(user.setup.exp).toISOString() } : {}) });
  });
  // { name?, roles?, active? }: new roles or switching someone off signs them out everywhere.
  app.patch('/api/admin/staff/:id', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const b = req.body || {};
    const name = b.name === undefined ? null : cleanStaffName(b.name);
    const rs = b.roles === undefined ? null : roles.cleanRoles(b.roles);
    if ((b.name !== undefined && !name) || (b.roles !== undefined && !rs) || (b.active !== undefined && typeof b.active !== 'boolean')) throw new HttpError(400, 'badStaff');
    // (No one takes away their own owner role or switches themselves off: another owner does.)
    if (req.params.id === req.adminWho.id && ((rs && !rs.includes('owner')) || b.active === false)) throw new HttpError(400, 'staffSelf');
    const user = store.mutate((db) => {
      const u = (db.staff || []).find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'notFound');
      const before = JSON.stringify([roles.rolesOf(u), u.active !== false]);
      // (Made an owner while on a password someone else typed: they choose their own first, with a set-up link.)
      // Checked before anything changes: a refused change keeps nothing, not even the new name (QA 25 Nov).
      if (rs && rs.includes('owner') && !roles.rolesOf(u).includes('owner') && u.passwordByOther) throw new HttpError(409, 'ownerOwnPassword');
      if (name) u.name = name;
      if (roles.rolesOf(u).includes('owner') || (rs && rs.includes('owner'))) u.everOwner = true;
      if (rs) {
        u.roles = rs;
        delete u.role;
      }
      if (typeof b.active === 'boolean') u.active = b.active;
      if (JSON.stringify([roles.rolesOf(u), u.active !== false]) !== before) {
        // (Not you: an owner adding a role to their own row stays signed in; they keep the owner role anyway.)
        if (u.id !== req.adminWho.id) u.gen = (u.gen || 0) + 1;
        // Their changes still waiting are cancelled (switched off), or the ones their new roles can't make.
        const perms = roles.permsOf(roles.rolesOf(u));
        cancelOpenOf(db, u.id, req.adminWho, (a) => u.active === false || !perms.has((roles.ROUTES[a.action] || {}).perm),
          u.active === false ? 'switched off' : 'role changed');
      }
      return u;
    });
    res.json(staffRow(user));
  });
  // A new set-up link (a forgotten password, or the first link ran out). Their old password works until they use it.
  app.post('/api/admin/staff/:id/setup-link', requireAdmin, (req, res) => {
    const s = newSetup(req);
    const user = store.mutate((db) => {
      const u = (db.staff || []).find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'notFound');
      // (A link for someone switched off wouldn't work: turn them on first.)
      if (u.active === false) throw new HttpError(409, 'staffOffLink');
      u.setup = s.setup;
      return u;
    });
    res.json({ user: staffRow(user), setupLink: s.link, setupExpiresAt: new Date(s.setup.exp).toISOString() });
  });
  app.put('/api/admin/staff/:id/password', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const pw = (req.body || {}).password;
    // (Not an owner's, and not your own: an owner gets a set-up link, and your own needs your current one.)
    const target = staffAll().find((x) => x.id === req.params.id);
    // (Ever an owner counts: demoting someone, typing their password, then making them owner again is refused too.)
    if (target && (target.id === req.adminWho.id || roles.rolesOf(target).includes('owner') || target.everOwner)) throw new HttpError(403, 'ownerPasswordLink');
    if (!staffPassword(pw, target)) throw new HttpError(400, 'passwordTooShort');
    store.mutate((db) => {
      const u = (db.staff || []).find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'notFound');
      Object.assign(u, security.AdminAuth.hashStaffPassword(pw));
      u.passwordByOther = true;
      delete u.setup;
      u.gen = (u.gen || 0) + 1; // signs out everywhere
    });
    res.status(204).end();
  });
  app.delete('/api/admin/staff/:id', requireAdmin, (req, res) => {
    if (req.params.id === req.adminWho.id) throw new HttpError(400, 'staffSelf');
    store.mutate((db) => {
      const before = (db.staff || []).length;
      db.staff = (db.staff || []).filter((x) => x.id !== req.params.id);
      if (db.staff.length === before) throw new HttpError(404, 'notFound');
      cancelOpenOf(db, req.params.id, req.adminWho, () => true, 'removed');
    });
    res.status(204).end();
  });
  // The set-up link (/admin?setup=…): the team member chooses their password. No sign-in needed.
  app.post('/api/admin/setup', express.json({ limit: '2kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    limitCheck(req, 'staffSetup');
    const b = req.body || {};
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const found = token && staffAll().find((u) => u.setup && u.active !== false && sameText(u.setup.hash, hash) && u.setup.exp > Date.now());
    if (!found) {
      limitHit('staffSetup', req.ip);
      throw new HttpError(400, 'setupLinkBad');
    }
    if (!staffPassword(b.password, found)) throw new HttpError(400, 'passwordTooShort');
    const user = store.mutate((db) => {
      const u = (db.staff || []).find((x) => x.id === found.id);
      if (!u || !u.setup || u.setup.hash !== hash) throw new HttpError(400, 'setupLinkBad');
      Object.assign(u, security.AdminAuth.hashStaffPassword(b.password));
      delete u.setup;
      delete u.passwordByOther; // (their own now)
      u.gen = (u.gen || 0) + 1;
      return u;
    });
    activity.add({ whoId: user.id, who: user.name || user.username, roles: roles.rolesOf(user), action: 'setup', label: { en: 'Chose their password (set-up link)', ar: 'اختار كلمة السر (لينك التفعيل)' }, summary: { en: 'Chose their password (set-up link)', ar: 'اختار كلمة السر (لينك التفعيل)' }, method: 'POST', path: '/api/admin/setup', status: 200, ip: req.ip });
    res.json({ ok: true, username: user.username });
  });
  // A team member changes their own password ({ current, password }); they get a new sign-in back.
  app.put('/api/admin/me/password', adminGate, express.json({ limit: '2kb' }), (req, res) => {
    const w = req.adminWho;
    if (w.emergency) throw new HttpError(400, 'emergencyPassword');
    const b = req.body || {};
    const u = staffAll().find((x) => x.id === w.id);
    limitCheck(req, 'myPassword', w.id);
    const given = crypto.scryptSync(typeof b.current === 'string' ? b.current : '', u.salt, 32);
    if (!crypto.timingSafeEqual(given, Buffer.from(u.hash, 'hex'))) {
      limitHit('myPassword', w.id);
      throw new HttpError(400, 'wrongCurrentPassword');
    }
    if (!staffPassword(b.password, u)) throw new HttpError(400, 'passwordTooShort');
    const user = store.mutate((db) => {
      const x = (db.staff || []).find((y) => y.id === w.id);
      Object.assign(x, security.AdminAuth.hashStaffPassword(b.password));
      delete x.passwordByOther; // (their own now)
      delete x.setup; // (a set-up link still open would replace it: QA 25 Nov)
      x.gen = (x.gen || 0) + 1; // other browsers are signed out
      return x;
    });
    const t = auth.staffToken(user);
    res.json({ ok: true, token: t.token, expiresAt: new Date(t.expiresAt).toISOString() });
  });

  // ---------- Owner approvals: catalogue and money changes by the team wait here ----------
  const approvalDir = path.join(dataDir, 'approvals');
  const approvalsAll = () => store.db.approvals || [];
  /** A kept change's body (from its own file when big). */
  const bodyOf = (a) => {
    if (!a.bodyFile) return a.body;
    try { return JSON.parse(fs.readFileSync(path.join(approvalDir, a.bodyFile), 'utf8')); } catch (e) { return null; }
  };
  const approvalRow = (a) => ({
    id: a.id, at: a.at, by: a.by, roles: a.roles, action: a.action, label: a.label || null, summary: a.summary,
    details: a.file ? { bytes: a.bytes, type: a.contentType || null } : roles.shortBody(bodyOf(a)),
    // A picture waiting: a small copy to look at (the full one is applied as sent).
    ...(a.thumb && a.status !== 'approved' ? (() => {
      try { return { thumb: `data:image/webp;base64,${fs.readFileSync(path.join(approvalDir, a.thumb)).toString('base64')}` }; } catch (e) { return {}; }
    })() : {}),
    changes: changesOf(a),
    ...(picsOf(a).length ? { pics: picsOf(a) } : {}),
    ...(changedSince(a) ? { changedSince: true } : {}),
    method: a.method, path: a.path, status: a.status === 'withdrawn' ? 'cancelled' : a.status,
    ...(a.decidedBy ? { decidedBy: a.decidedBy, decidedAt: a.decidedAt } : {}),
    ...(a.note ? { note: a.note } : {}), ...(a.error ? { error: a.error } : {}), ...(a.detail ? { detail: a.detail } : {}),
  });
  const nameOfProduct = (id) => {
    const p = getProduct(id);
    return p ? p.name : { en: String(id || ''), ar: String(id || '') };
  };
  const enAr = (en, ar) => ({ en, ar });
  // The product fields a change touches, as the owner reads them.
  const CATALOG_FIELD_NAMES = {
    name: enAr('name', 'الاسم'), description: enAr('description', 'الوصف'), category: enAr('category', 'القسم'),
    status: enAr('in the shop / paused', 'في الموقع / متوقف'), showAgainOn: enAr('back on', 'يرجع يوم'), hiddenReason: enAr('pause reason', 'سبب الإيقاف'), hiddenNote: enAr('pause note', 'ملاحظة الإيقاف'),
    stock: enAr('stock', 'المخزون'), variantStock: enAr('stock per colour and size', 'المخزون لكل لون ومقاس'), lowStockAt: enAr('low-stock alert', 'تنبيه المخزون القليل'),
    colors: enAr('colours', 'الألوان'), addColors: enAr('new colours', 'ألوان جديدة'), sizes: enAr('sizes', 'المقاسات'), addSizes: enAr('new sizes', 'مقاسات جديدة'),
    sides: enAr('print areas', 'أماكن الطباعة'), process: enAr('printing method', 'طريقة الطباعة'), methods: enAr('printing methods', 'طرق الطباعة'), embroidery: enAr('embroidery', 'التطريز'),
    prices: enAr('prices', 'الأسعار'), photos: enAr('photos', 'الصور'), order: enAr('photo order', 'ترتيب الصور'), main: enAr('main photo', 'الصورة الأساسية'),
  };
  // Every field a kept change can carry, as the owner reads it (the values asked for are shown under it).
  const OWNER_FIELD_NAMES = {
    ...CATALOG_FIELD_NAMES,
    code: enAr('code', 'الكود'), type: enAr('type', 'النوع'), value: enAr('value', 'القيمة'), minOrder: enAr('minimum order', 'أقل طلب'),
    maxDiscount: enAr('maximum discount', 'أقصى خصم'), maxUses: enAr('uses in all', 'عدد مرات الاستخدام'), perCustomer: enAr('uses per customer', 'مرات لكل عميل'),
    startsOn: enAr('starts on', 'يبدأ يوم'), endsOn: enAr('ends on', 'ينتهي يوم'), active: enAr('on', 'شغال'), auto: enAr('applies automatically', 'بيتطبق لوحده'), products: enAr('products', 'المنتجات'), categories: enAr('categories', 'الأقسام'),
    note: enAr('note', 'ملاحظة'), amount: enAr('amount', 'المبلغ'), date: enAr('date', 'التاريخ'),
    costs: enAr('costs', 'التكاليف'), blank: enAr('blank item', 'القطعة السادة'), printFirst: enAr('printing (first side)', 'الطباعة (أول وش)'), printExtra: enAr('printing (each extra side)', 'الطباعة (كل وش زيادة)'), other: enAr('other', 'أخرى'),
    actualCost: enAr('actual cost', 'التكلفة الفعلية'), actualShipping: enAr('actual shipping cost', 'تكلفة الشحن الفعلية'), shippingCost: enAr('shipping cost', 'تكلفة الشحن'),
    basePrice: enAr('base price', 'السعر الأساسي'), extraSidePrice: enAr('extra side', 'الوش الزيادة'),
    ids: enAr('designs', 'التصميمات'), hidden: enAr('paused', 'متوقف'), deleted: enAr('deleted', 'ممسوح'), share: enAr('share link', 'لينك المشاركة'),
    nameEn: enAr('English name', 'الاسم بالإنجليزي'), nameAr: enAr('Arabic name', 'الاسم بالعربي'), items: enAr('designs', 'التصميمات'),
  };
  /** One value as the owner reads it (both languages of a name, yes / no, short lists). */
  const VALUE_WORDS = {
    type: { percent: enAr('percent off', 'نسبة خصم'), fixed: enAr('amount off', 'مبلغ خصم'), freeship: enAr('free shipping', 'شحن مجاني'), freeShipping: enAr('free shipping', 'شحن مجاني') },
    status: { live: enAr('in the shop', 'في الموقع'), hidden: enAr('paused', 'متوقف مؤقتًا'), removed: enAr('stopped selling', 'وقف البيع') },
    // (A pause's reason, as the Products tab says it. QA 25 Nov: the owner's card showed "stock".)
    // (A printing method by its name, as the Products tab says it.)
    process: {
      dtg: enAr('DTG (direct to garment)', 'DTG (طباعة مباشرة على القماش)'), dtf: enAr('DTF transfer', 'DTF (طباعة بالنقل الحراري)'),
      sublimation: enAr('Sublimation', 'سبلميشن (طباعة حرارية)'), uv: enAr('UV printing', 'طباعة UV'), paper: enAr('Paper (offset / digital)', 'ورق (أوفست / ديجيتال)'),
      canvas: enAr('Canvas', 'كانفاس'), textile: enAr('Textile roll', 'طباعة قماش بالمتر'), engrave: enAr('Laser engraving', 'حفر ليزر'), lasercut: enAr('Laser cutting', 'قص ليزر'),
    },
    hiddenReason: {
      stock: enAr('out of stock', 'المخزون خلص'), season: enAr('out of season', 'مش موسمه'), quality: enAr('quality problem', 'مشكلة في الجودة'),
      supplier: enAr('supplier problem', 'مشكلة مع المورّد'), other: enAr('other', 'سبب تاني'),
    },
  };
  const ownerValue = (v, field) => {
    if (v === null || v === undefined || v === '') return enAr('(empty)', '(فاضي)');
    if (typeof v === 'boolean') return v ? enAr('yes', 'أيوه') : enAr('no', 'لأ');
    // (Expense categories by name: looked up when used, the list being defined further down. A product's category
    // by the shop's own name for it.)
    const words = field === 'category' ? EXPENSE_NAMES : VALUE_WORDS[field];
    if (typeof v === 'string' && words && words[v]) return words[v];
    const cat = field === 'category' && typeof v === 'string' && CATEGORIES.find((c) => c.id === v);
    if (cat) return enAr(cat.name.en, cat.name.ar);
    // (A coupon code as it will be made: "EID٢٠" is saved as EID20. QA 25 Nov.)
    if (field === 'code' && typeof v === 'string') { const c = coupons.normCode(v).slice(0, 40); return enAr(c, c); }
    // (A coupon's categories and products, and a product's colours and sizes, by the shop's names for them.)
    const listOf = (ids, nameOf) => {
      const one = (l) => ids.slice(0, 20).map((id) => { const n = nameOf(String(id)); return n ? `\u2068${n[l] || n.en}\u2069` : String(id).slice(0, 40); }).join(l === 'ar' ? '، ' : ', ')
        + (ids.length > 20 ? (l === 'ar' ? ` … (${arNum(ids.length)})` : ` … (${ids.length})`) : '');
      return enAr(one('en') || '—', one('ar') || '—');
    };
    if (field === 'categories' && Array.isArray(v)) return listOf(v, (id) => { const c = CATEGORIES.find((x) => x.id === id); return c && c.name; });
    if (field === 'methods' && Array.isArray(v)) return listOf(v, (id) => VALUE_WORDS.process[id] || null);
    if (field === 'products' && Array.isArray(v)) return listOf(v, (id) => { const p = PRODUCTS.find((x) => x.id === id); return p && p.name; });
    if ((field === 'colors' || field === 'sizes') && v && typeof v === 'object' && !Array.isArray(v)) {
      const nameOf = (id) => {
        for (const p of PRODUCTS) {
          const x = (field === 'colors' ? p.colors : p.sizes).find((y) => y.id === id);
          if (x) return field === 'colors' ? x.name : x.label;
        }
        return null;
      };
      const state = (x) => (x && x.off ? enAr('off', 'مقفول') : x && x.soldOut ? enAr('sold out', 'خلصان') : enAr('on', 'شغال'));
      // (A size's new name too: "M: on, renamed Medium / وسط". QA 25 Nov: a rename was hidden from the owner.)
      const renamed = (x, l) => (x && x.label && typeof x.label === 'object' && (x.label.en || x.label.ar)
        ? `${l === 'ar' ? '، اسمه يبقى' : ', renamed'} \u2068${[x.label.en, x.label.ar].filter(Boolean).map((t) => String(t).slice(0, 40)).join(' / ')}\u2069` : '');
      const one = (l) => Object.entries(v).slice(0, 30).map(([id, x]) => { const n = nameOf(id); return `\u2068${n ? n[l] || n.en : String(id).slice(0, 40)}\u2069: ${state(x)[l]}${renamed(x, l)}`; }).join(l === 'ar' ? '، ' : ', ');
      return enAr(one('en') || '—', one('ar') || '—');
    }
    // New colours and sizes: by their names (and a colour's code), not as data.
    if ((field === 'addColors' || field === 'addSizes') && Array.isArray(v)) {
      const one = (l) => v.slice(0, 20).map((x) => {
        if (!x || typeof x !== 'object') return '';
        const nm = field === 'addColors' ? x.name : x.label;
        const name = nm && typeof nm === 'object' ? [nm[l] || nm.en || nm.ar, nm[l === 'ar' ? 'en' : 'ar']].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).join(' / ') : String(x.id || '');
        const extra = field === 'addColors' && typeof x.hex === 'string' ? ` (${x.hex.slice(0, 9)})` : field === 'addSizes' && Number(x.surcharge) ? ` (+${moneyIn(Number(x.surcharge), l)})` : '';
        return `\u2068${String(name).slice(0, 60)}\u2069${extra}`;
      }).filter(Boolean).join(l === 'ar' ? '، ' : ', ');
      return enAr(one('en') || '—', one('ar') || '—');
    }
    // Embroidery: off, or where, how big, the extra price and the thread colours.
    if (field === 'embroidery') {
      if (v === false || v === null) return enAr('off', 'مقفول');
      if (typeof v === 'object' && !Array.isArray(v)) {
        const AT = { chest: enAr('left chest', 'على الصدر (شمال)'), center: enAr('centre', 'في النص'), top: enAr('top', 'فوق'), same: enAr('same as the print area', 'نفس مكان الطباعة') };
        const one = (l) => [
          AT[v.at] ? AT[v.at][l] : '',
          Array.isArray(v.cm) && v.at !== 'same' && v.cm[0] ? (l === 'ar' ? `${arNum(v.cm[0])}×${arNum(v.cm[1])} سم` : `${v.cm[0]}×${v.cm[1]} cm`) : '',
          Number.isFinite(Number(v.surcharge)) ? `+${moneyIn(Number(v.surcharge), l)}` : '',
          v.maxColors ? (l === 'ar' ? `${arNum(v.maxColors)} ألوان خيط` : `${v.maxColors} thread colours`) : '',
        ].filter(Boolean).join(l === 'ar' ? '، ' : ', ');
        return enAr(one('en') || '—', one('ar') || '—');
      }
    }
    // Print areas, side by side: on/off, print width, safe margin, bleed, a moved area.
    if (field === 'sides' && v && typeof v === 'object' && !Array.isArray(v)) {
      const sideName = (id) => { for (const p of PRODUCTS) { const x = (p.sides || []).find((y) => y.id === id); if (x && x.name) return x.name; } return null; };
      const one = (l) => Object.entries(v).slice(0, 12).map(([id, o]) => {
        if (!o || typeof o !== 'object') return '';
        const n = sideName(id);
        const bits = [
          o.off === true ? (l === 'ar' ? 'مقفول' : 'off') : o.off === false ? (l === 'ar' ? 'شغال' : 'on') : '',
          typeof o.printWidthCm === 'number' ? (l === 'ar' ? `عرض الطباعة ${arNum(o.printWidthCm)} سم` : `print width ${o.printWidthCm} cm`) : '',
          typeof o.safeMm === 'number' ? (l === 'ar' ? `هامش ${arNum(o.safeMm)} مم` : `safe margin ${o.safeMm} mm`) : '',
          typeof o.bleedMm === 'number' ? (l === 'ar' ? `زيادة القص ${arNum(o.bleedMm)} مم` : `bleed ${o.bleedMm} mm`) : '',
          o.area && typeof o.area === 'object' ? (l === 'ar' ? 'مكان الطباعة اتنقل' : 'print area moved') : '',
        ].filter(Boolean).join(l === 'ar' ? '، ' : ', ');
        return bits ? `\u2068${n ? n[l] || n.en : String(id).slice(0, 30)}\u2069: ${bits}` : '';
      }).filter(Boolean).join(l === 'ar' ? '؛ ' : '; ');
      return enAr(one('en') || '—', one('ar') || '—');
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const day = (l) => { try { return new Date(`${v}T12:00:00Z`).toLocaleDateString(l === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return v; } };
      return enAr(day('en'), day('ar'));
    }
    if (typeof v === 'number' || (typeof v === 'string' && ['amount', 'value', 'minOrder', 'maxDiscount', 'actualCost', 'actualShipping', 'shippingCost'].includes(field) && accounting.money(v) != null)) {
      const n = typeof v === 'number' ? v : accounting.money(v);
      return ['amount', 'minOrder', 'maxDiscount', 'actualCost', 'actualShipping', 'shippingCost'].includes(field) ? enAr(moneyIn(n, 'en'), moneyIn(n, 'ar')) : enAr(String(n), arNum(n));
    }
    if (typeof v === 'string') {
      const t = v.length > 600 ? `${v.slice(0, 600)}…` : v;
      return enAr(t, t);
    }
    if (field === 'items' && Array.isArray(v)) {
      const names = (l) => v.slice(0, 20).map((x) => (x && x.name && typeof x.name === 'object' ? `\u2068${String(x.name[l] || x.name.en || x.name.ar || '').slice(0, 60)}\u2069` : '')).filter(Boolean).join(l === 'ar' ? '، ' : ', ') || '—';
      return enAr(names('en'), names('ar'));
    }
    if (field === 'ids' && Array.isArray(v)) {
      const lib = new Map(library.all().map((d) => [d.id, d.name]));
      const names = (l) => v.slice(0, 20).map((id) => { const n = lib.get(String(id)); return n ? `\u2068${n[l] || n.en}\u2069` : String(id); }).join(l === 'ar' ? '، ' : ', ') + (v.length > 20 ? (l === 'ar' ? ` … (${arNum(v.length)})` : ` … (${v.length})`) : '');
      return enAr(names('en'), names('ar'));
    }
    if (field === 'costs' && typeof v === 'object' && !Array.isArray(v)) {
      // (A size's extra cost too, by size and amount: a change to one size read "costs: —". QA 25 Nov.)
      const sizes = (l) => (v.sizes && typeof v.sizes === 'object' && !Array.isArray(v.sizes) ? Object.entries(v.sizes).slice(0, 12).map(([id, x]) => {
        const m = accounting.money(x, { min: -1e6 });
        return `${l === 'ar' ? 'مقاس' : 'size'} \u2068${String(id).slice(0, 20)}\u2069 ${m != null ? moneyIn(m, l) : String(x).slice(0, 20)}`;
      }) : []);
      const parts = (l) => [...Object.entries(v).slice(0, 12).filter(([, x]) => typeof x !== 'object').map(([k, x]) => `${(OWNER_FIELD_NAMES[k] || enAr(k, k))[l]} ${accounting.money(x) != null ? moneyIn(accounting.money(x), l) : String(x).slice(0, 20)}`), ...sizes(l)].join(l === 'ar' ? '، ' : ', ');
      return enAr(parts('en') || '—', parts('ar') || '—');
    }
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length && Object.keys(v).every((k) => k === 'en' || k === 'ar')) {
      // (Each language's own text in its own direction, so a mixed pair never reads jumbled.)
      const part = (x) => `\u2068${String(x).length > 600 ? `${String(x).slice(0, 600)}…` : String(x)}\u2069`;
      return enAr([v.en, v.ar].filter((x) => x !== undefined && x !== '').map(part).join(' / '), [v.ar, v.en].filter((x) => x !== undefined && x !== '').map(part).join(' / '));
    }
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      const t = v.slice(0, 30).join(', ') + (v.length > 30 ? ` … (${v.length})` : '');
      return enAr(t, t.replace(/, /g, '، '));
    }
    const t = JSON.stringify(roles.shortBody(v)).slice(0, 400);
    return enAr(t, t);
  };
  /**
   * The product or coupon was changed after this request was made (by anyone): approving it replaces what's there
   * now, so the owner is told.
   */
  /** What a money change would replace, as it was when asked (compared when the owner looks). */
  const moneyNow = (action, path) => {
    const id = decodeURIComponent((/\/(?:items|orders|pricing)\/([^/?]+)/.exec(path) || [])[1] || '');
    if (action === 'PATCH /api/admin/items/:itemId/cost') { const f = store.findItem(id); return f ? f.item.actualCost ?? null : null; }
    if (action === 'PATCH /api/admin/orders/:orderId/shipping-cost') { const o = store.getOrder(id); return o ? o.actualShipping ?? null : null; }
    if (action === 'PUT /api/admin/accounts/settings') return (store.db.accountSettings || {}).shippingCost ?? null;
    if (action === 'PUT /api/admin/pricing/:productId') return JSON.stringify((store.db.costs || {})[id] || {});
    return undefined;
  };
  const changedSince = (a) => {
    if (!(a.status === 'pending' || a.status === 'failed')) return false;
    if (a.before !== undefined) return JSON.stringify(moneyNow(a.action, a.path)) !== JSON.stringify(a.before);
    const id = (/^\/api\/admin\/(?:catalog|coupons|pricing)\/([^/?]+)/.exec(a.path) || [])[1];
    if (!id) return false;
    // (A stock count: pieces sold since it was asked count as a change too. QA 25 Nov.)
    const e = a.action.includes('/catalog') ? catalogEdits()[decodeURIComponent(id)] || {} : null;
    const kept = e ? bodyOf(a) || {} : {};
    const when = a.action.includes('/coupons') ? ((store.db.coupons || []).find((c) => c.id === id) || {}).updatedAt
      : e ? [e.updatedAt, ('stock' in kept || 'variantStock' in kept) ? e.stockAt : null].filter(Boolean).sort().pop() : null;
    return Boolean(when && when > a.at);
  };
  /** Pictures of the designs a change publishes (zip uploads, a share link), for the owner to look at. */
  const picsOf = (a) => {
    if (!(a.status === 'pending' || a.status === 'failed')) return [];
    const b = bodyOf(a) || {};
    // The shop's edit to print without asking: the new version next to the one the customer approved.
    if (a.action === 'POST /api/admin/items/:itemId/shop-edit/print') {
      const nd = UUID_RE.test(String(b.designId || '')) && store.getDesign(b.designId);
      const od = UUID_RE.test(String(b.baseDesignId || '')) && store.getDesign(b.baseDesignId);
      const out = [];
      for (const [d, en, ar] of [[od, 'Approved by the customer', 'اللي العميل وافق عليه'], [nd, 'The shop\'s edit (to print)', 'تعديل إبداع (للطباعة)']]) {
        if (!d || !Array.isArray(d.sides)) continue;
        for (const sd of d.sides.slice(0, 4)) out.push({ url: `/files/designs/${d.id}/${sd.id}-proof.png?v=${d.version || 1}`, name: enAr(`${en} · ${(sd.name || {}).en || sd.id}`, `${ar} · ${(sd.name || {}).ar || (sd.name || {}).en || sd.id}`) });
      }
      return out;
    }
    // A product photo to delete, or a new photo order / main photo: the photos themselves, as the owner will see
    // them in the shop (they showed as hex ids. QA 25 Nov).
    const ph = /^\/api\/admin\/catalog\/([^/?]+)\/photos(?:\/([^/?]+))?$/.exec(a.path || '');
    if (ph) {
      const pid = decodeURIComponent(ph[1]);
      const have = new Set((((catalogEdits()[pid] || {}).photos) || []).map((x) => x.id));
      const url = (id) => `/catalog-photos/${encodeURIComponent(pid)}/${encodeURIComponent(id)}.webp`;
      if (a.method === 'DELETE' && ph[2] && have.has(decodeURIComponent(ph[2]))) return [{ url: url(decodeURIComponent(ph[2])), name: enAr('Photo to delete', 'الصورة اللي هتتمسح') }];
      if (a.method === 'PUT' && !ph[2]) {
        const out = [];
        if (typeof b.main === 'string' && have.has(b.main)) out.push({ url: url(b.main), name: enAr('New main photo', 'الصورة الأساسية الجديدة') });
        if (Array.isArray(b.order)) b.order.filter((id) => have.has(id)).slice(0, 12).forEach((id, i) => out.push({ url: url(id), name: enAr(`Photo ${i + 1}`, `صورة ${arNum(i + 1)}`) }));
        return out;
      }
    }
    const m = /\/library\/uploads\/([^/?]+)\/publish/.exec(a.path || '');
    if (m && Array.isArray(b.items)) {
      const batch = readBatch(decodeURIComponent(m[1]));
      if (!batch) return [];
      return b.items.slice(0, 24).filter((x) => x && batch.items.some((it) => it.id === x.id))
        .map((x) => ({ url: `/library-upload/${batch.id}/${x.id}.png`, name: x.name && typeof x.name === 'object' ? { en: String(x.name.en || ''), ar: String(x.name.ar || x.name.en || '') } : null }));
    }
    if (a.action === 'POST /api/admin/library') {
      const id = (String(b.share || '').match(/([A-Za-z0-9_-]{12})\/?(?:[?#].*)?$/) || [])[1];
      const sh = id && readShare(id);
      return sh ? [{ url: `/api/shares/${sh.id}/preview/${(sh.sides[0] || {}).id}.png`, name: null }] : [];
    }
    return [];
  };
  /** The values a kept change asks for, field by field. */
  const changesOf = (a) => {
    if (a.file) return [{ field: enAr('photo', 'صورة'), value: enAr(`${Math.max(1, Math.round((a.bytes || 0) / 1024))} KB`, `${Math.max(1, Math.round((a.bytes || 0) / 1024))} KB`) }];
    const kept = bodyOf(a);
    // (An expense as it will be saved: the amount read as a number, the category one of the list.)
    const body = a.action === 'POST /api/admin/expenses' && kept && typeof kept === 'object' ? accounting.cleanExpense(kept).expense || kept : kept;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
    // (The shop's edit: its two versions are the pictures on the card, not their ids. QA 25 Nov.)
    const all = Object.entries(body).filter(([k]) => !(/\/shop-edit/.test(a.action || '') && (k === 'designId' || k === 'baseDesignId')));
    // (A photo order or main photo: in words, the photos themselves are shown with the card, not their ids.)
    const photoOrder = a.method === 'PUT' && /^\/api\/admin\/catalog\/[^/?]+\/photos$/.test(a.path || '');
    const valueOf = (k, v) => {
      if (photoOrder && k === 'main') return v ? enAr('the photo shown as "New main photo"', 'الصورة اللي مكتوب عليها "الصورة الأساسية الجديدة"') : enAr('(empty)', '(فاضي)');
      if (photoOrder && k === 'order' && Array.isArray(v)) return enAr(`${v.length} photos, in the order shown`, `${arNum(v.length)} صور، بالترتيب اللي ظاهر`);
      return ownerValue(v, k);
    };
    const list = all.slice(0, 30).map(([k, v]) => ({ field: OWNER_FIELD_NAMES[k] || enAr(k, k), value: valueOf(k, v) }));
    // (More than fits here: said, so the owner knows the change holds more than shown.)
    if (all.length > 30) list.push({ field: enAr('more', 'كمان'), value: enAr(`${all.length - 30} more fields`, `${all.length - 30} خانات كمان`) });
    return list;
  };
  const EXPENSE_NAMES = {
    materials: enAr('Materials & blanks', 'خامات ومنتجات'), printing: enAr('Printing', 'طباعة'), shipping: enAr('Shipping', 'شحن'),
    marketing: enAr('Marketing & ads', 'تسويق وإعلانات'), rent: enAr('Rent & bills', 'إيجار وفواتير'), salaries: enAr('Salaries', 'مرتبات'),
    equipment: enAr('Equipment', 'معدات'), other: enAr('Other', 'أخرى'),
  };
  /** An amount as the site shows it ("٣٥٠ ج.م." / "EGP 350"). */
  const moneyIn = (n, lang) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    try {
      return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
    } catch (e) {
      return `${v} EGP`;
    }
  };
  // "1 design" / "3 designs"; Arabic: تصميم واحد، تصميمين، ٣ تصميمات، ١١ تصميم.
  const designsEn = (n) => (n === 1 ? '1 design' : `${n} designs`);
  const arNum = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]).replace('.', '٫');
  const designsAr = (n) => (n === 1 ? 'تصميم واحد' : n === 2 ? 'تصميمين' : n >= 3 && n <= 10 ? `${arNum(n)} تصميمات` : `${arNum(n)} تصميم`);
  /** What the change is about, in a few words (the product, coupon, order…), for the owner's list. */
  function approvalAbout(key, req) {
    const b = req.body && !Buffer.isBuffer(req.body) ? req.body : {};
    const p = req.params;
    // (In Arabic the number is kept left to right: "#POD-1001", not "POD-1001#". QA 25 Nov.)
    const orderNo = (id, ar = false) => {
      const o = store.getOrder(id) || (store.findItem(id) || {}).order;
      return o ? (ar ? `\u2066#${o.number}\u2069` : `#${o.number}`) : '';
    };
    if (key.includes('/catalog')) {
      const n = key === 'POST /api/admin/catalog' ? { en: String(b.id || ''), ar: String(b.id || '') } : nameOfProduct(p.id);
      // (A status names what it does: pause, stop selling, back in the shop.)
      const STATUS_WORDS = { live: enAr('back in the shop', 'يرجع الموقع'), hidden: enAr('pause', 'إيقاف مؤقت'), removed: enAr('stop selling', 'وقف البيع') };
      const fields = Buffer.isBuffer(req.body) ? [] : Object.keys(b).filter((k) => !['id', 'template'].includes(k)).map((k) => (k === 'status' && STATUS_WORDS[b.status]) || CATALOG_FIELD_NAMES[k] || enAr(k, k));
      const list = (lang, comma) => (fields.length ? `(${[...new Set(fields.map((f) => f[lang]))].join(comma)})` : '');
      return enAr([n.en, list('en', ', ')].filter(Boolean).join(' '), [n.ar, list('ar', '، ')].filter(Boolean).join(' '));
    }
    if (key === 'PATCH /api/admin/library') {
      const n = Array.isArray(b.ids) ? b.ids.length : 0;
      const what = b.deleted === true ? enAr('delete', 'مسح') : b.deleted === false ? enAr('bring back', 'رجوع') : b.hidden === true ? enAr('pause', 'إيقاف') : enAr('show', 'إظهار');
      return enAr(`${designsEn(n)}: ${what.en}`, `${designsAr(n)}: ${what.ar}`);
    }
    if (key.includes('/library/uploads')) {
      const batch = readBatch(p.batch);
      const n = batch ? publishPlan(batch, b.items).plan.length : Array.isArray(b.items) ? b.items.length : 0;
      return enAr(designsEn(n), designsAr(n));
    }
    if (key.includes('/library')) {
      const d = p.id && library.all().find((x) => x.id === p.id);
      const nm = d ? d.name : { en: String(b.nameEn || p.id || ''), ar: String(b.nameAr || b.nameEn || p.id || '') };
      const what = key.startsWith('DELETE') ? enAr('', '') : b.deleted === true ? enAr('delete', 'مسح') : b.deleted === false ? enAr('bring back', 'رجوع') : b.hidden === true ? enAr('pause', 'إيقاف') : b.hidden === false ? enAr('show', 'إظهار') : enAr('', '');
      return enAr([nm.en, what.en].filter(Boolean).join(': '), [nm.ar, what.ar].filter(Boolean).join(': '));
    }
    if (key.includes('/coupons')) {
      const c = p.id && (store.db.coupons || []).find((x) => x.id === p.id);
      // (The code as it will be made: capitals, no spaces.)
      const code = b.code ? coupons.normCode(b.code) : String((c && c.code) || '');
      // (Switching a coupon off or on says so.)
      const onOff = key.startsWith('PUT') && c && typeof b.active === 'boolean' && b.active !== (c.active !== false) ? (b.active ? enAr(' (switch on)', ' (تشغيل)') : enAr(' (pause)', ' (إيقاف)')) : enAr('', '');
      // (In Arabic the code keeps its own digits: "2026", not "٢٠٢٦", as the Coupons tab shows it.)
      return enAr(code + onOff.en, (code ? `\u2068${code}\u2069` : '') + onOff.ar);
    }
    // (Each language on its own: its digits, its currency and its words.)
    const expense = (e) => {
      const cat = EXPENSE_NAMES[e.category] || EXPENSE_NAMES.other;
      const desc = String(e.description || e.note || '').trim().slice(0, 80);
      return enAr([moneyIn(e.amount, 'en'), cat.en, desc].filter(Boolean).join(' — '), [moneyIn(e.amount, 'ar'), cat.ar, desc ? `\u2068${desc}\u2069` : ''].filter(Boolean).join(' — '));
    };
    // (From the cleaned values, as they will be saved: "0x2710" is 10,000.)
    if (key === 'POST /api/admin/expenses') return expense(accounting.cleanExpense(b).expense || b);
    if (key === 'DELETE /api/admin/expenses/:id') {
      const e = (store.db.expenses || []).find((x) => x.id === p.id);
      return e ? expense(e) : enAr('', '');
    }
    const costText = (v, lang) => {
      const n = accounting.money(v);
      return n === null || v === '' ? (lang === 'ar' ? 'اتمسحت' : 'cleared') : n === undefined ? String(v).slice(0, 20) : moneyIn(n, lang);
    };
    if (key === 'POST /api/admin/items/:itemId/shop-edit/print') {
      const f = store.findItem(p.itemId);
      const name = (l) => (f ? `${l === 'ar' ? `\u2066#${f.order.number}\u2069` : `#${f.order.number}`} · ${(f.item.productName || {})[l] || (f.item.productName || {}).en || ''}` : '');
      const why = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
      return enAr([name('en'), why].filter(Boolean).join(': '), [name('ar'), why].filter(Boolean).join(': '));
    }
    if (key === 'PATCH /api/admin/items/:itemId/cost') {
      // (Which item: an order can have several.)
      const f = store.findItem(p.itemId);
      const prod = f && getProduct(f.item.productId);
      const what = (l) => [orderNo(p.itemId, l === 'ar'), prod ? prod.name[l] : '', f && f.order.items.length > 1 ? `${f.order.items.indexOf(f.item) + 1}/${f.order.items.length}` : ''].filter(Boolean).join(' · ');
      return enAr(`${what('en')} → ${costText(b.actualCost, 'en')}`, `${what('ar')} ← ${costText(b.actualCost, 'ar')}`);
    }
    if (key === 'PATCH /api/admin/orders/:orderId/shipping-cost') return enAr(`${orderNo(p.orderId)} → ${costText(b.actualShipping, 'en')}`, `${orderNo(p.orderId, true)} ← ${costText(b.actualShipping, 'ar')}`);
    if (key === 'PUT /api/admin/accounts/settings') return enAr(`shipping cost ${costText(b.shippingCost, 'en')}`, `تكلفة الشحن ${costText(b.shippingCost, 'ar')}`);
    if (key === 'PUT /api/admin/pricing/:productId') {
      const n = nameOfProduct(p.productId);
      return enAr(`${n.en} (costs)`, `${n.ar} (التكاليف)`);
    }
    return enAr('', '');
  }
  /** The checks a change can fail before it reaches the owner (so the team member hears now, not later). */
  const APPROVAL_CHECKS = {
    // (The shop's edit: checked now, so a stale or empty one is refused at once; the design is kept as it is.)
    'POST /api/admin/items/:itemId/shop-edit/print': (req) => {
      shopEditCheck(req);
      const b = req.body || {};
      req.body = { designId: b.designId, baseDesignId: b.baseDesignId, note: noteText(b.note, 1000) };
    },
    'PUT /api/admin/catalog/:id': (req) => {
      const p = getProduct(req.params.id);
      if (!p) throw new HttpError(404, 'unknownProduct');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.prices !== undefined) throw new HttpError(403, 'ownerOnly');
      // (A field products don't have is refused now: it would wait, be approved and change nothing, QA 25 Nov.)
      // (Every field a product edit can carry: the top-level ones and those that go with them, e.g. a pause's reason.)
      const known = new Set([...Object.keys(EDIT_FIELDS), ...Object.values(EDIT_FIELDS).flat()]);
      const unknown = Object.keys(body).find((k) => !known.has(k));
      if (unknown) throw new HttpError(400, 'badProductField', { field: unknown });
      const c = catalog.clean(p, staffPrices(p, body), { categories: CATEGORIES.map((x) => x.id), prev: catalogEdits()[p.id] || null });
      if (c.error) throw new HttpError(400, c.error, { field: c.field || '' });
      // (Kept as it will be applied: the owner never approves a number that won't happen.)
      req.body = staffPrices(p, body);
    },
    'POST /api/admin/catalog': (req) => {
      const n = catalog.cleanNew(req.body && typeof req.body === 'object' ? req.body : {}, PRODUCTS);
      if (n.error) throw new HttpError(400, n.error, { field: n.field || '' });
      if (catalogEdits()[n.id]) throw new HttpError(400, 'productIdTaken');
      if (approvalsAll().some((a) => (a.status === 'pending' || a.status === 'failed') && a.action === 'POST /api/admin/catalog' && a.body && a.body.id === n.id)) throw new HttpError(409, 'productIdWaiting');
    },
    'DELETE /api/admin/catalog/:id': (req) => {
      const p = getProduct(req.params.id);
      if (!p) throw new HttpError(404, 'unknownProduct');
      if (!catalog.isBuiltIn(p.id)) throw new HttpError(409, 'productsKept');
    },
    'POST /api/admin/catalog/:id/photos': async (req) => {
      const p = getProduct(req.params.id);
      if (!p) throw new HttpError(404, 'unknownProduct');
      if (((catalogEdits()[p.id] || {}).photos || []).length >= catalog.MAX_PHOTOS) throw new HttpError(400, 'tooManyPhotos', { max: catalog.MAX_PHOTOS });
      // The same picture checks as the upload itself, now; and a small copy the owner sees before approving.
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new HttpError(400, 'badPhoto');
      try {
        const meta = await sharp()(req.body, { limitInputPixels: 80e6 }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('type');
        return { thumb: await sharp()(req.body, { limitInputPixels: 80e6 }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer() };
      } catch (e) {
        throw new HttpError(400, 'badPhoto');
      }
    },
    'PUT /api/admin/catalog/:id/photos': (req) => { if (!getProduct(req.params.id)) throw new HttpError(404, 'unknownProduct'); },
    'DELETE /api/admin/catalog/:id/photos/:photoId': (req) => {
      if (!getProduct(req.params.id)) throw new HttpError(404, 'unknownProduct');
      if (!((catalogEdits()[req.params.id] || {}).photos || []).some((x) => x.id === req.params.photoId)) throw new HttpError(404, 'notFound');
    },
    'POST /api/admin/library': (req) => {
      const b = req.body || {};
      const id = (String(b.share || '').match(/([A-Za-z0-9_-]{12})\/?(?:[?#].*)?$/) || [])[1];
      if (!readShare(id)) throw new HttpError(400, 'shareNotFound');
      const nameEn = String(b.nameEn || '').trim();
      if (!String(b.nameAr || '').trim() && !nameEn) throw new HttpError(400, 'fieldRequired', { field: { en: 'Name', ar: 'الاسم' } });
      if (!nameEn) throw new HttpError(400, 'libNameEnMissing');
      if (ARABIC_LETTERS.test(nameEn)) throw new HttpError(400, 'libNameEnArabic');
    },
    'PATCH /api/admin/library': (req) => {
      const b = req.body || {};
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 2000) throw new HttpError(400, 'badProductField', { field: 'ids' });
      libraryFlags(b);
      // (Only designs that exist, each once: "2000 designs" for one design, or nothing at all, never waits.)
      const known = new Set(library.all().map((d) => d.id));
      const ids = [...new Set(b.ids.map(String))].filter((id) => known.has(id));
      if (!ids.length) throw new HttpError(404, 'notFound');
      req.body = { ...b, ids };
    },
    'PATCH /api/admin/library/:id': (req) => {
      if (!library.all().some((d) => d.id === req.params.id)) throw new HttpError(404, 'notFound');
      const b = req.body || {};
      if (!(b.deleted === undefined && b.hidden !== undefined && typeof b.hidden !== 'boolean')) libraryFlags(b);
    },
    'DELETE /api/admin/library/:id': (req) => { if (!library.all().some((d) => d.id === req.params.id)) throw new HttpError(404, 'notFound'); },
    'POST /api/admin/library/uploads/:batch/publish': (req) => {
      const b = readBatch(req.params.batch);
      if (!b) throw new HttpError(404, 'uploadGone');
      if (b.status && b.status !== 'ready') throw new HttpError(409, 'uploadNotReady');
      // The items that can't be published are named now; with none left, there's nothing to approve.
      const { plan, skipped } = publishPlan(b, (req.body || {}).items);
      if (!plan.length) return { answer: { published: [], skipped } };
      return { extra: { skipped } };
    },
    'POST /api/admin/coupons': (req) => {
      const { coupon, error } = coupons.cleanCoupon(req.body, { products: PRODUCTS, categories: CATEGORIES });
      if (error) throw new HttpError(400, error);
      couponClash(store.db.coupons || [], coupon.code);
      // (A second request for a code already waiting would only fail when approved.)
      if (approvalsAll().some((a) => (a.status === 'pending' || a.status === 'failed') && a.action === 'POST /api/admin/coupons' && a.body && looseCode(coupons.normCode(a.body.code)) === looseCode(coupon.code))) throw new HttpError(409, 'couponWaiting');
    },
    'PUT /api/admin/coupons/:id': (req) => {
      const cur = (store.db.coupons || []).find((c) => c.id === req.params.id);
      if (!cur) throw new HttpError(404, 'couponGone');
      // (Only the changed fields come: checked as they'd be merged onto the coupon. See saveCoupon.)
      const { coupon, error } = coupons.cleanCoupon({ ...cur, ...(req.body && typeof req.body === 'object' ? req.body : {}) }, { products: PRODUCTS, categories: CATEGORIES, saved: cur });
      if (error) throw new HttpError(400, error);
      couponClash(store.db.coupons || [], coupon.code, { id: req.params.id, was: cur.code });
      // (Only the fields a coupon is made of: its id, dates and counts are the shop's own.)
      const own = ['code', 'type', 'value', 'minOrder', 'maxDiscount', 'maxUses', 'perCustomer', 'startsOn', 'endsOn', 'active', 'auto', 'products', 'categories', 'note'];
      req.body = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => own.includes(k)));
      // (A code already waiting in another request: one at a time.)
      if (approvalsAll().some((a) => (a.status === 'pending' || a.status === 'failed') && /^(POST|PUT) \/api\/admin\/coupons/.test(a.action) && a.body && coupons.normCode(a.body.code) === coupon.code && !a.path.endsWith(`/${req.params.id}`))) throw new HttpError(409, 'couponWaiting');
    },
    'DELETE /api/admin/coupons/:id': (req) => { if (!(store.db.coupons || []).some((c) => c.id === req.params.id)) throw new HttpError(404, 'couponGone'); },
    'PUT /api/admin/pricing/:productId': (req) => {
      const product = getProduct(req.params.productId);
      if (!product) throw new HttpError(404, 'unknownProduct');
      const b = req.body || {};
      // Costs only: without them there is nothing to approve, and a selling price is the owners' (refused now).
      if (!b.costs || typeof b.costs !== 'object' || Array.isArray(b.costs)) throw new HttpError(400, 'nothingToApprove');
      // (The screen sends the prices as they are shown: only a different one is a change of price.)
      const same = (v, cur) => v === undefined || v === null || v === '' || accounting.money(v) === cur;
      const extraNow = product.extraSidePrice != null ? product.extraSidePrice : EXTRA_SIDE_PRICE;
      const sizesSame = !b.sizes || typeof b.sizes !== 'object' || product.sizes.every((sz) => same(b.sizes[sz.id], sz.surcharge || 0));
      if (!same(b.basePrice, product.basePrice) || !same(b.extraSidePrice, extraNow) || !sizesSame) throw new HttpError(403, 'ownerOnly');
      const co = accounting.cleanCosts(product, b.costs);
      if (co.error) throw new HttpError(400, co.error);
      // What waits for the owner is the costs alone (the prices shown on the screen are never part of it), and only
      // the boxes changed: two requests for one product approved in turn don't undo each other. QA 25 Nov.
      const raw = (store.db.costs || {})[product.id] || {};
      const num = (v, min) => accounting.money(v, min === undefined ? undefined : { min }) || 0;
      const changed = {};
      for (const k of ['blank', 'printFirst', 'printExtra', 'embroidery', 'other']) if (b.costs[k] !== undefined && num(b.costs[k]) !== num(raw[k])) changed[k] = b.costs[k];
      const sz = {};
      for (const z of product.sizes) {
        const v = b.costs.sizes && typeof b.costs.sizes === 'object' ? b.costs.sizes[z.id] : undefined;
        if (v !== undefined && num(v, -1e6) !== num((raw.sizes || {})[z.id], -1e6)) sz[z.id] = v;
      }
      if (Object.keys(sz).length) changed.sizes = sz;
      if (!Object.keys(changed).length) throw new HttpError(400, 'nothingToApprove');
      req.body = { costs: changed };
    },
    'PUT /api/admin/accounts/settings': (req) => {
      const ship = accounting.money((req.body || {}).shippingCost);
      if (ship === undefined || ship === null) throw new HttpError(400, 'badCost');
    },
    'PATCH /api/admin/items/:itemId/cost': (req) => {
      if (!hasKey(req.body, 'actualCost') || accounting.money(req.body.actualCost) === undefined) throw new HttpError(400, 'badCost');
      if (!store.findItem(req.params.itemId)) throw new HttpError(404, 'itemNotFound');
    },
    'PATCH /api/admin/orders/:orderId/shipping-cost': (req) => {
      if (!hasKey(req.body, 'actualShipping') || accounting.money(req.body.actualShipping) === undefined) throw new HttpError(400, 'badCost');
      if (!store.getOrder(req.params.orderId)) throw new HttpError(404, 'notFound');
    },
    'POST /api/admin/expenses': (req) => {
      const { error } = accounting.cleanExpense(req.body || {});
      if (error) throw new HttpError(400, error);
    },
    'DELETE /api/admin/expenses/:id': (req) => { if (!(store.db.expenses || []).some((e) => e.id === req.params.id)) throw new HttpError(404, 'notFound'); },
  };
  const readBody = (req, res, route) => new Promise((resolve, reject) => {
    // (The route's own size limit: a request kept for approval is never one it would refuse.)
    const parse = route.raw ? express.raw({ type: () => true, limit: route.raw }) : express.json({ limit: route.limit || '100kb' });
    parse(req, res, (err) => (err ? reject(err) : resolve()));
  });
  /** A change kept for an owner: 202 { pending: true, approval } (nothing changes until it's approved). */
  async function holdForApproval(req, res, key, route) {
    await readBody(req, res, route);
    // (Nothing nested deeper than any real change: such a body can't be kept or saved safely.)
    // (Walked without recursion: every value, at most 50,000 of them, none deeper than 20.)
    const tooDeep = (root) => {
      const stack = [[root, 0]];
      let seen = 0;
      while (stack.length) {
        const [v, d] = stack.pop();
        if (++seen > 50000 || d > 20) return true;
        if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push([x, d + 1]);
      }
      return false;
    };
    if (!Buffer.isBuffer(req.body) && tooDeep(req.body)) throw new HttpError(400, 'badRequest');
    // (A change with nothing in it is refused: an empty edit would only fill the owner's list.)
    if (req.method !== 'DELETE' && !Buffer.isBuffer(req.body) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length)) throw new HttpError(400, 'nothingToApprove');
    // (Keys that only trick JavaScript objects are never kept: what's approved is what the owner was shown.)
    const clean = (v, d = 0) => (d > 24 || !v || typeof v !== 'object' || Buffer.isBuffer(v) ? v : Array.isArray(v) ? v.map((x) => clean(x, d + 1))
      : Object.fromEntries(Object.entries(v).filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k)).map(([k, x]) => [k, clean(x, d + 1)])));
    if (!Buffer.isBuffer(req.body)) req.body = clean(req.body);
    const checked = (APPROVAL_CHECKS[key] && await APPROVAL_CHECKS[key](req)) || {};
    if (checked.answer) return res.json(checked.answer);
    // One person's waiting changes are limited (50, of which 20 pictures), so nobody can fill the list for everyone.
    const mineOpen = approvalsAll().filter((x) => (x.status === 'pending' || x.status === 'failed') && x.by && x.by.id === req.adminWho.id);
    if (mineOpen.length >= 50 || (Buffer.isBuffer(req.body) && mineOpen.filter((x) => x.file).length >= 20)) throw new HttpError(429, 'tooManyMine');
    const w = req.adminWho;
    const raw = Buffer.isBuffer(req.body);
    // (The same change pressed again while it waits isn't a second request: the waiting one is answered.)
    const sameHash = crypto.createHash('sha256').update(raw ? req.body : JSON.stringify(req.body === undefined ? null : req.body)).digest('hex');
    const waitingSame = mineOpen.find((x) => x.status === 'pending' && x.action === key && x.path === req.originalUrl.slice(0, 500)
      && (x.sameHash ? x.sameHash === sameHash : (!raw && !x.file && !x.bodyFile && JSON.stringify(x.body === undefined ? null : x.body) === JSON.stringify(req.body === undefined ? null : req.body))));
    if (waitingSame) {
      res.locals.approvalId = waitingSame.id;
      res.locals.summary = waitingSame.summary;
      return res.status(202).json({ pending: true, already: true, approval: { ...approvalRow(waitingSame), already: true }, ...(checked.extra || {}) });
    }
    const id = crypto.randomBytes(8).toString('hex');
    const about = approvalAbout(key, req);
    const label = route.label || enAr(key, key);
    const a = {
      id, at: new Date().toISOString(), status: 'pending',
      by: { id: w.id, name: w.shown || w.name, username: w.name }, roles: w.roles,
      action: key, label, summary: { en: [label.en, about.en].filter(Boolean).join(': '), ar: [label.ar, about.ar].filter(Boolean).join(': ') },
      method: req.method, path: req.originalUrl.slice(0, 500), contentType: String(req.get('content-type') || '').slice(0, 100),
      lang: langOf(req), sameHash,
      ...(moneyNow(key, req.originalUrl) !== undefined ? { before: moneyNow(key, req.originalUrl) } : {}),
      ...(raw ? { file: `${id}.bin`, bytes: req.body.length } : { body: req.body === undefined ? null : req.body }),
    };
    // (A big change waits in its own file: the shop's data file stays small, so every save stays quick.)
    const text = raw ? '' : JSON.stringify(a.body);
    if (!raw && text.length > 16 * 1024) {
      fs.mkdirSync(approvalDir, { recursive: true });
      fs.writeFileSync(path.join(approvalDir, `${id}.json`), text);
      a.bodyFile = `${id}.json`;
      a.bytes = text.length;
      delete a.body;
    }
    if (raw) {
      fs.mkdirSync(approvalDir, { recursive: true });
      fs.writeFileSync(path.join(approvalDir, a.file), req.body);
      if (checked.thumb) {
        fs.writeFileSync(path.join(approvalDir, `${id}.thumb.webp`), checked.thumb);
        a.thumb = `${id}.thumb.webp`;
      }
    }
    store.mutate((db) => {
      db.approvals ||= [];
      if (db.approvals.filter((x) => x.status === 'pending').length >= 500) throw new HttpError(429, 'tooManyApprovals');
      db.approvals.push(a);
      // Decided ones: the latest 300 are kept.
      const done = db.approvals.filter((x) => !['pending', 'applying', 'failed'].includes(x.status));
      if (done.length > 300) {
        const old = done.slice(0, done.length - 300);
        const drop = new Set(old.map((x) => x.id));
        db.approvals = db.approvals.filter((x) => !drop.has(x.id));
        for (const x of old) for (const f of [x.file, x.thumb, x.bodyFile]) if (f) fs.rmSync(path.join(approvalDir, f), { force: true });
      }
    });
    res.locals.approvalId = id;
    res.locals.summary = a.summary;
    res.status(202).json({ pending: true, approval: approvalRow(a), ...(checked.extra || {}) });
  }
  let replayServer = null;
  const findApproval = (id) => approvalsAll().find((x) => x.id === id);
  // A change that was being applied when the app stopped (5 minutes on) can be approved again.
  // (A change being applied waits at most 2 minutes, the run's own time limit.)
  const openForDecision = (a) => a.status === 'pending' || a.status === 'failed' || (a.status === 'applying' && Date.now() - Date.parse(a.applyingAt || 0) > 2 * 60e3);
  /** Who decided a request (or is applying it right now: two copies of the dashboard approving at the same moment
   *  named "—". Tester 1, 26 Nov). */
  const deciderName = (x, req) => {
    const by = x.decidedBy || (x.status === 'applying' ? x.applyingBy : null);
    if (by && by.id === 'owner') return langOf(req) === 'ar' ? 'صاحب الموقع (دخول الطوارئ)' : 'the owner (emergency login)';
    return (by && by.name) || '—';
  };
  app.get('/api/admin/approvals', adminGate, (req, res) => {
    const w = req.adminWho;
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const isOpen = (a) => a.status === 'pending' || a.status === 'failed' || a.status === 'applying';
    const mine = approvalsAll().filter((a) => w.perms.has('approvals') || (a.by && a.by.id === w.id));
    // (Those still to decide always; of the decided ones the latest 300.)
    const keep = new Set([...mine.filter(isOpen), ...mine.filter((a) => !isOpen(a)).slice(-300)]);
    const list = mine.filter((a) => keep.has(a))
      // ("pending": everything still to decide, including changes that failed when approved.)
      .filter((a) => status === 'all' || a.status === status || (status === 'pending' && (a.status === 'failed' || a.status === 'applying')))
      .reverse();
    res.json({ approvals: list.map(approvalRow) });
  });
  app.post('/api/admin/approvals/:id/approve', adminGate, express.json({ limit: '4kb' }), asyncRoute(async (req, res) => {
    const w = req.adminWho;
    const note = typeof (req.body || {}).note === 'string' ? req.body.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500) : '';
    const a = store.mutate((db) => {
      const x = (db.approvals || []).find((y) => y.id === req.params.id);
      if (!x) throw new HttpError(404, 'notFound');
      // (Named on the activity line even when someone decided it first.)
      res.locals.approvalId = x.id;
      res.locals.summary = x.summary;
      // (Withdrawn by the person who asked, or cancelled when they were switched off: said so, not "decided by them".)
      if (x.status === 'cancelled') throw new HttpError(409, 'approvalWithdrawn');
      if (!openForDecision(x)) throw new HttpError(409, 'approvalDecidedBy', { name: deciderName(x, req) });
      x.status = 'applying';
      x.applyingAt = new Date().toISOString();
      x.applyingBy = { id: w.id, name: w.shown || w.name };
      return { ...x };
    });
    res.locals.approvalId = a.id;
    res.locals.summary = a.summary;
    // The person as they are now: still on, and still with the role the change needs (their current roles run it).
    const person = staffAll().find((u) => u.id === a.by.id);
    const nowRoles = person ? roles.rolesOf(person) : [];
    const need = (roles.ROUTES[a.action] || {}).perm;
    if (!person || person.active === false || (need && !roles.permsOf(nowRoles).has(need))) {
      const done = store.mutate((db) => {
        const x = (db.approvals || []).find((y) => y.id === a.id);
        x.status = 'failed';
        x.error = { en: format('approvalPersonGone', {}, 'en'), ar: format('approvalPersonGone', {}, 'ar') };
        delete x.applyingAt;
        delete x.applyingBy;
        return x;
      });
      res.locals.outcome = 'failed';
      return res.json({ approval: approvalRow(done), result: null });
    }
    let out;
    approvalRuns.set(a.id, { who: { id: a.by.id, name: a.by.username, shown: a.by.name, roles: nowRoles, role: roles.mainRole(nowRoles) }, by: w.emergency ? '' : w.shown || w.name, byEmergency: Boolean(w.emergency) });
    try {
      let body = null;
      if (a.file) body = fs.readFileSync(path.join(approvalDir, a.file));
      else if (a.bodyFile) body = fs.readFileSync(path.join(approvalDir, a.bodyFile));
      else if (a.body !== null && a.body !== undefined) body = Buffer.from(JSON.stringify(a.body));
      replayServer ||= require('http').createServer(app);
      out = await roles.replay(replayServer, {
        method: a.method, url: a.path,
        headers: {
          ...(body ? { 'content-type': a.contentType || 'application/json' } : {}),
          'accept-language': a.lang === 'ar' ? 'ar' : 'en',
          'x-approval-replay': `${replayKey}.${a.id}`,
        },
        body,
      });
    } catch (e) {
      out = { status: 500, body: Buffer.from(JSON.stringify({ error: e.message })) };
    } finally {
      approvalRuns.delete(a.id);
    }
    let result = null;
    try { result = JSON.parse(out.body.toString('utf8')); } catch (e) { result = null; }
    let ok = out.status >= 200 && out.status < 300;
    // A zip publish that published nothing (already published, gone from the upload) didn't happen; part of it says so.
    let detail = null;
    if (ok && a.action === 'POST /api/admin/library/uploads/:batch/publish' && result && Array.isArray(result.published)) {
      const done = result.published.length;
      const left = Array.isArray(result.skipped) ? result.skipped.length : 0;
      if (!done) {
        ok = false;
        const why = Array.isArray(result.skipped) && result.skipped.length ? result.skipped[0].code : '';
        result.errorText = why === 'pickProducts'
          ? { en: 'Nothing was published: the products picked for these designs are no longer in the shop.', ar: 'متنشرش حاجة: المنتجات اللي اتختارت للتصميمات دي مبقتش في الموقع.' }
          : why ? { en: 'Nothing was published: check the designs\' names and products in the upload.', ar: 'متنشرش حاجة: راجع أسامي التصميمات ومنتجاتها في الرفع.' }
            : { en: 'Nothing was published: these designs were already published or are no longer in the upload.', ar: 'متنشرش حاجة: التصميمات دي اتنشرت قبل كده أو مبقتش في الرفع.' };
      } else if (left) {
        detail = { en: `${done} published, ${left} not (check their names and products in the upload).`, ar: `اتنشر ${done}، و${left} لأ (راجع أساميهم ومنتجاتهم في الرفع).` };
      }
    }
    const done = store.mutate((db) => {
      const x = (db.approvals || []).find((y) => y.id === a.id);
      x.status = ok ? 'approved' : 'failed';
      x.decidedBy = { id: w.id, name: w.shown || w.name };
      x.decidedAt = new Date().toISOString();
      delete x.applyingAt;
      delete x.applyingBy;
      if (note) x.note = note;
      if (ok) delete x.error;
      else x.error = result && result.errorText ? { en: String(result.errorText.en).slice(0, 300), ar: String(result.errorText.ar).slice(0, 300) } : String((result && result.error) || `HTTP ${out.status}`).slice(0, 300);
      if (detail) x.detail = detail;
      return x;
    });
    if (ok) for (const f of [a.file, a.thumb, a.bodyFile]) if (f) fs.rmSync(path.join(approvalDir, f), { force: true });
    if (!ok) res.locals.outcome = 'failed';
    res.json({ approval: approvalRow(done), result });
  }));
  const closeApproval = (req, status) => {
    const w = req.adminWho;
    const note = typeof (req.body || {}).note === 'string' ? req.body.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500) : '';
    const a = store.mutate((db) => {
      const x = (db.approvals || []).find((y) => y.id === req.params.id);
      if (!x) throw new HttpError(404, 'notFound');
      // (The activity line says which change was refused or withdrawn, as an approval's does. QA 25 Nov.)
      req.res.locals.approvalId = x.id;
      if (x.summary && typeof x.summary === 'object') {
        const verb = status === 'rejected' ? enAr('Refused a change', 'رفض تعديل') : enAr('Withdrew a change', 'سحب تعديل');
        req.res.locals.summary = enAr(`${verb.en}: ${x.summary.en || x.summary.ar || ''}`, `${verb.ar}: ${x.summary.ar || x.summary.en || ''}`);
      }
      // (A team member withdraws only their own; an owner any.)
      if (status === 'cancelled' && !(x.by && x.by.id === w.id) && !w.perms.has('approvals')) throw new HttpError(403, 'noPermission');
      // (Withdrawn by the person who asked, or cancelled when they were switched off: said so, not "decided by them".)
      if (x.status === 'cancelled') throw new HttpError(409, 'approvalWithdrawn');
      if (!openForDecision(x)) throw new HttpError(409, 'approvalDecidedBy', { name: deciderName(x, req) });
      x.status = status;
      x.decidedBy = { id: w.id, name: w.shown || w.name };
      x.decidedAt = new Date().toISOString();
      delete x.applyingAt;
      delete x.applyingBy;
      if (note) x.note = note;
      return x;
    });
    for (const f of [a.file, a.thumb, a.bodyFile]) if (f) fs.rmSync(path.join(approvalDir, f), { force: true });
    return a;
  };
  app.post('/api/admin/approvals/:id/reject', adminGate, express.json({ limit: '4kb' }), (req, res) => {
    res.json({ approval: approvalRow(closeApproval(req, 'rejected')) });
  });
  app.delete('/api/admin/approvals/:id', adminGate, (req, res) => {
    // (Withdrawn by the person who asked: "cancelled", as the screens show it.)
    res.json({ approval: approvalRow(closeApproval(req, 'cancelled')) });
  });
  // ---------- Activity log: who changed what (owners see everyone; the team their own) ----------
  app.get('/api/admin/activity', adminGate, (req, res) => {
    const w = req.adminWho;
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    const who = w.perms.has('activity.all') ? (typeof req.query.who === 'string' && req.query.who ? req.query.who.slice(0, 40) : null) : w.id;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    // before=<at>|<id>: the page after the last line shown ("Show older"); more: older lines are there.
    const cursor = /^([0-9T:.Z-]{10,30})\|([0-9a-f]{1,24})$/.exec(String(req.query.before || ''));
    const found = activity.list({ who, from: day(req.query.from), to: day(req.query.to), limit: limit + 1, before: cursor ? { at: cursor[1], id: cursor[2] } : null });
    const more = found.length > limit;
    // (who: { id, name } for the screen; older lines without a summary read as what they did.)
    const entries = found.slice(0, limit)
      .map((e) => {
        // (The username too: two people can share a name.)
        const u = staffAll().find((x) => x.id === e.whoId);
        return { ...e, who: { id: e.whoId, name: e.who, ...(u ? { username: u.username } : {}) }, summary: e.summary || e.label || null };
      });
    const last = entries[entries.length - 1];
    res.json({ entries, more, ...(more && last ? { next: `${last.at}|${last.id}` } : {}) });
  });

  // ---------- Backups (owners): the whole data folder as one file, made in the background ----------
  const backups = new Backups(dataDir);
  app.get('/api/admin/backups', adminGate, (req, res) => {
    const d = backups.list();
    res.json({ ...d, error: d.error ? { ...d.error, message: format(d.error.code, {}, langOf(req)) } : null });
  });
  app.post('/api/admin/backups', adminGate, (req, res) => {
    try {
      const { job } = backups.start();
      res.locals.summary = enAr(`Started a backup (${job.files} files)`, `بدأ نسخة احتياطية (${job.files} ملف)`);
      res.status(202).json({ making: { name: job.name, startedAt: job.startedAt, done: job.done, total: job.total, files: job.files } });
    } catch (e) {
      if (e.code === 'backupBusy') throw new HttpError(409, 'backupBusy');
      if (e.code === 'backupNoSpace') throw new HttpError(507, 'backupNoSpace');
      throw e;
    }
  });
  app.post('/api/admin/backups/:name/link', adminGate, (req, res) => {
    const name = req.params.name;
    if (!backups.fileOf(name)) throw new HttpError(404, 'backupGone');
    res.locals.summary = enAr(`Downloaded the backup ${name}`, `نزّل النسخة الاحتياطية ${name}`);
    res.json({ url: Backups.linkFor(auth.linkKey, name), name });
  });
  app.delete('/api/admin/backups/:name', adminGate, (req, res) => {
    if (!backups.remove(req.params.name)) throw new HttpError(404, 'backupGone');
    res.locals.summary = enAr(`Deleted the backup ${req.params.name}`, `مسح النسخة الاحتياطية ${req.params.name}`);
    res.json({ ok: true });
  });
  // The download itself: a signed link (6 hours) the browser saves on its own, so a big file never sits in the
  // page's memory; it can be resumed if the connection drops (the file is served with ranges).
  app.get('/dl/backup/:name', (req, res, next) => {
    try {
      rateLimit(req, 'downloads');
      const name = req.params.name;
      const file = backups.fileOf(name);
      if (!file || !Backups.linkOk(auth.linkKey, name, req.query.e, req.query.s)) throw new HttpError(404, 'linkExpired');
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Robots-Tag', 'noindex');
      res.download(file, name, { headers: { 'Content-Type': 'application/gzip' } });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/admin/notifications', requireAdmin, (req, res) => {
    res.json(notify.status());
  });
  const testHits = new Map();
  app.post('/api/admin/notifications/test', requireAdmin, async (req, res, next) => {
    try {
      limitHits(testHits, req.ip, 5);
      res.json(await notify.adminTest());
    } catch (e) {
      next(e);
    }
  });
  // Every design, deleted ones too (the admin filters): hidden = paused (out of the shop for now),
  // deleted = out of the shop and the main list (can be brought back), artwork = drawn with the shop's
  // own artwork files (not only text, shapes and icons).
  app.get('/api/admin/library', requireCatalog, (req, res) => {
    // settings.textOnlyLimited: text-only designs only on products with no artwork design in the shop;
    // limited = this design is offered on fewer products because of it (`products` are the ones left).
    res.json({ categories: DESIGN_CATEGORIES, settings: library.settings(), designs: library.all().map((d) => ({ ...libraryCard(d), hidden: d.hidden, deleted: d.deleted, custom: d.kind === 'objects' || Boolean(d.uploaded), uploaded: Boolean(d.uploaded), artwork: hasArtwork(d), limited: Boolean(d.limited), createdAt: d.createdAt || null, addedOn: library.addedOn(d), by: d.by || null })) });
  });
  app.put('/api/admin/library/settings', requireAdmin, express.json({ limit: '1kb' }), (req, res) => {
    const b = req.body || {};
    if (typeof b.textOnlyLimited !== 'boolean') throw new HttpError(400, 'badProductField', { field: 'textOnlyLimited' });
    res.json(library.setSettings({ textOnlyLimited: b.textOnlyLimited }));
  });
  // Publish a design made in the editor: the owner shares it, then pastes the link here.
  app.post('/api/admin/library', requireCatalog, express.json({ limit: '8kb' }), (req, res) => {
    const b = req.body || {};
    const id = (String(b.share || '').match(/([A-Za-z0-9_-]{12})\/?(?:[?#].*)?$/) || [])[1];
    const sh = readShare(id);
    if (!sh) throw new HttpError(400, 'shareNotFound');
    const nameAr = String(b.nameAr || '').trim().slice(0, 60);
    const nameEn = String(b.nameEn || '').trim().slice(0, 60);
    if (!nameAr && !nameEn) throw new HttpError(400, 'fieldRequired', { field: { en: 'Name', ar: 'الاسم' } });
    // The English shop shows the English name: never the Arabic one copied over (QA 25 Nov, as for zip uploads).
    if (!nameEn) throw new HttpError(400, 'libNameEnMissing');
    if (ARABIC_LETTERS.test(nameEn)) throw new HttpError(400, 'libNameEnArabic');
    const category = DESIGN_CATEGORIES.some((c) => c.id === b.category) ? b.category : DESIGN_CATEGORIES[0].id;
    const product = getProduct(sh.productId);
    // A printed side first; a design that is only embroidery keeps the embroidery's own spot.
    const side = sh.sides.find((sd) => sd.id !== EMB) || sh.sides[0];
    const editor = JSON.parse(fs.readFileSync(shareFile(sh.id, 'editor.json'), 'utf8'));
    const meta = library.addCustom({
      name: { ar: nameAr || nameEn, en: nameEn },
      category,
      product: product.id,
      color: sh.color.id,
      objects: editor[side.id].objects,
      // A moved print area: the ready design is re-centred on the standard spot.
      area: (() => {
        // (Print sides: the area the share's objects were placed in, which may be an earlier one.)
        if (!(side.id === EMB && product.embroidery)) return placedAreaFor(product, side.id, sh.size.id, editor[side.id]);
        const a = product.embroidery.area;
        const o = editor[side.id].offset;
        return o ? { ...a, x: a.x + o.dx, y: a.y + o.dy } : a;
      })(),
      preview: fs.readFileSync(shareFile(sh.id, `${side.id}.png`)),
    });
    res.status(201).json(libraryCard(meta));
  });
  /** { hidden: true|false } pauses / shows, { deleted: true|false } deletes / brings back (both may be given). */
  const libraryFlags = (b) => {
    const flags = {};
    for (const key of ['hidden', 'deleted']) {
      if (b[key] === undefined) continue;
      if (typeof b[key] !== 'boolean') throw new HttpError(400, 'badProductField', { field: key });
      flags[key] = b[key];
    }
    if (!Object.keys(flags).length) throw new HttpError(400, 'badProductField', { field: 'hidden' });
    return flags;
  };
  // Several at once: { ids: [...], hidden?, deleted? }.
  app.patch('/api/admin/library', requireCatalog, express.json({ limit: '64kb' }), (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 2000) throw new HttpError(400, 'badProductField', { field: 'ids' });
    const flags = libraryFlags(b);
    res.json({ ok: true, changed: library.setFlags(b.ids.map(String), flags) });
  });
  app.patch('/api/admin/library/:id', requireCatalog, express.json({ limit: '1kb' }), (req, res) => {
    const b = req.body || {};
    // (Older dashboards send { hidden } only, possibly not as a boolean.)
    const flags = b.deleted === undefined && b.hidden !== undefined && typeof b.hidden !== 'boolean' ? { hidden: Boolean(b.hidden) } : libraryFlags(b);
    if (!library.setFlags([req.params.id], flags)) throw new HttpError(404, 'notFound');
    res.json({ ok: true });
  });
  // Delete: out of the shop and of the admin's main list, kept so it can be brought back (any design,
  // the starter ones too). Its files stay; orders made from it never depended on them.
  app.delete('/api/admin/library/:id', requireCatalog, (req, res) => {
    if (!library.setFlags([req.params.id], { deleted: true })) throw new HttpError(404, 'notFound');
    res.json({ ok: true });
  });

  // ---------- Rights requests (Admin → Rights requests): someone says a design uses their work ----------
  // Newest first; the owner marks each one handled (and can open it again). Owner only.
  app.get('/api/admin/takedowns', requireAdmin, (req, res) => {
    const list = (store.db.takedowns || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    res.json({ takedowns: list, open: list.filter((t) => t.status !== 'done').length });
  });
  app.patch('/api/admin/takedowns/:id', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const b = req.body || {};
    if (b.status !== undefined && b.status !== 'new' && b.status !== 'done') throw new HttpError(400, 'badRequest');
    const out = store.mutate((db) => {
      const t = (db.takedowns || []).find((x) => x.id === req.params.id);
      if (!t) return null;
      if (b.status) {
        t.status = b.status;
        if (b.status === 'done') t.doneAt = new Date().toISOString();
        else delete t.doneAt;
      }
      if (typeof b.note === 'string') t.note = b.note.trim().slice(0, 1000);
      return t;
    });
    if (!out) throw new HttpError(404, 'notFound');
    res.json({ takedown: out });
  });

  // ---------- Upload designs (zip): Admin → Ready designs (src/design-upload.js) ----------
  // The owner or a product manager uploads a zip of design pictures; each picture is checked, given
  // product suggestions and kept in a batch to review; published ones become ready designs (artwork) on
  // the products picked. Batches live in DATA_DIR/library/uploads/<batch>/ until published or discarded.
  const uploadsDir = path.join(dataDir, 'library', 'uploads');
  const BATCH_RE = /^[0-9a-f]{20}$/;
  const ITEM_RE = /^[0-9a-f]{12}$/;
  const batchDir = (id) => path.join(uploadsDir, id);
  const readBatch = (id) => {
    if (!BATCH_RE.test(String(id || ''))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(batchDir(id), 'batch.json'), 'utf8')); } catch (e) { return null; }
  };
  const writeBatch = (b) => {
    const tmp = path.join(batchDir(b.id), `batch.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(b));
    fs.renameSync(tmp, path.join(batchDir(b.id), 'batch.json'));
  };
  /** A batch as the admin sees it (the pictures' web addresses filled in). */
  const batchView = (b) => ({ ...b, items: b.items.map((it) => ({ ...it, web: `/library-upload/${b.id}/${it.id}.png` })) });
  const liveProducts = () => PRODUCTS.filter((p) => catalog.visible(p));
  // Zips up to 600 MB (the owner's choice, 25 Nov). The zip goes straight to disk as it arrives and its
  // pictures are read one at a time in the background, so memory stays low whatever the size. A small zip
  // answers once read (201); a big one answers "reading" (202) and the admin's page follows its progress.
  const ZIP_MAX_MB = LIMITS.zipMaxMB || 600;
  const ZIP_MAX = ZIP_MAX_MB * 2 ** 20;
  const WAIT_READING = LIMITS.zipWaitMs ?? 20000;
  const SKIP_REASONS = new Set(['notPicture', 'tooSmall', 'tooBig', 'badPicture', 'blankPicture']);
  // (From a folder or file name like "ramadan/…"; otherwise "Painted art": these are pictures, not phrases.)
  const uploadCategory = (p) => {
    const c = designUpload.guessCategory(p);
    if (DESIGN_CATEGORIES.some((x) => x.id === c)) return c;
    return DESIGN_CATEGORIES.some((x) => x.id === 'artsy') ? 'artsy' : DESIGN_CATEGORIES[0].id;
  };
  let zipQueue = Promise.resolve(); // one zip read at a time (pictures are big)
  const zipJobs = new Map(); // batch id -> its reading, in this process
  const readUploadedZip = (id) => {
    if (!zipJobs.has(id)) {
      const job = zipQueue.then(() => readZipPictures(id)).catch((e) => console.error('[uploads]', id, e && e.message)).finally(() => zipJobs.delete(id));
      zipQueue = job;
      zipJobs.set(id, job);
    }
    return zipJobs.get(id);
  };
  async function readZipPictures(id) {
    const b = readBatch(id);
    if (!b || b.status !== 'reading') return;
    const here = () => fs.existsSync(batchDir(id)); // (discarded meanwhile: stop)
    const save = () => { if (here()) writeBatch(b); };
    const zipFile = path.join(batchDir(id), 'upload.zip');
    let zip;
    try {
      zip = designUpload.openZip(zipFile, { maxTotal: 3 * ZIP_MAX });
    } catch (e) {
      Object.assign(b, { status: 'failed', code: e instanceof designUpload.UploadError ? e.code : 'zipBad' });
      return save();
    }
    const products = liveProducts();
    let saved = Date.now();
    try {
      for (let i = b.done || 0; i < zip.entries.length && b.items.length < 300; i++) {
        if (!here()) return;
        const ent = zip.entries[i];
        let a;
        try {
          a = await designUpload.analyze(ent.load(), ent.path);
        } catch (e) {
          a = { ok: false, reason: e instanceof designUpload.UploadError && SKIP_REASONS.has(e.code) ? e.code : 'badPicture' };
        }
        if (!a.ok) b.skipped.push({ path: String(ent.path).slice(0, 200), reason: SKIP_REASONS.has(a.reason) ? a.reason : 'badPicture', ...(designUpload.skipSizes ? designUpload.skipSizes(a) : {}) });
        else if (here()) {
          const itemId = crypto.randomBytes(6).toString('hex');
          const printExt = a.printExt === 'jpg' ? 'jpg' : 'png';
          fs.writeFileSync(path.join(batchDir(id), `${itemId}.png`), a.web);
          fs.writeFileSync(path.join(batchDir(id), `${itemId}.print.${printExt}`), a.print);
          const suggestions = designUpload.suggest(a, products, { path: ent.path });
          const color = {};
          for (const x of suggestions) {
            const p = products.find((q) => q.id === x.productId);
            if (p) color[p.id] = designUpload.analysisColor(a, p);
          }
          b.items.push({
            id: itemId, path: String(ent.path).slice(0, 200), name: designUpload.nameFrom(ent.path),
            w: a.w, h: a.h, transparent: Boolean(a.transparent), ink: a.ink, colors: a.colors || [], printPx: a.printPx, printExt,
            textLike: Boolean(a.textLike), background: a.background || null, suggestions, picked: designUpload.pickProducts(suggestions, 8), color,
            dpiFor: Object.fromEntries(suggestions.map((x) => [x.productId, x.dpi])),
            category: uploadCategory(ent.path),
          });
        }
        b.done = i + 1;
        if (Date.now() - saved > 1500) { save(); saved = Date.now(); }
      }
    } finally {
      zip.close();
    }
    if (!here()) return;
    Object.assign(b, { done: b.total, status: b.items.length ? 'ready' : 'failed', ...(b.items.length ? {} : { code: 'zipEmpty' }) });
    save();
    fs.rmSync(zipFile, { force: true });
  }
  // Zips still being read when the shop stopped (a restart, a deploy) carry on where they were.
  setImmediate(() => {
    let ids = [];
    try { ids = fs.readdirSync(uploadsDir).filter((x) => BATCH_RE.test(x)); } catch (e) { ids = []; }
    for (const id of ids) {
      const b = readBatch(id);
      if (b && b.status === 'reading') readUploadedZip(id);
    }
  });
  /** The zip's name as the admin's list shows it (sent URL-encoded when it isn't plain ASCII, e.g. Arabic). */
  const zipName = (raw) => {
    let name = String(raw || '');
    try { name = decodeURIComponent(name); } catch (e) { /* as sent */ }
    return name.replace(/[^\w .()؀-ۿ-]/g, '').slice(0, 120);
  };
  /** The batch's zip is on disk: check it, then read its pictures (201 once read, or 202 while reading). */
  async function beginReading(req, res, id, file) {
    const zipFile = path.join(batchDir(id), 'upload.zip');
    let zip;
    try {
      zip = designUpload.openZip(zipFile, { maxTotal: 3 * ZIP_MAX });
    } catch (e) {
      if (e instanceof designUpload.UploadError) throw new HttpError(400, e.code, e.params || {});
      throw e;
    }
    // (Files the zip reader left out: too big, an unusual compression…)
    const skipped = zip.skipped.map((x) => ({ path: String(x.path).slice(0, 200), reason: SKIP_REASONS.has(x.reason) ? x.reason : 'badPicture' }));
    const total = zip.entries.length;
    zip.close();
    if (!total) throw new HttpError(400, 'zipEmpty', { n: skipped.length });
    const before = readBatch(id) || {};
    writeBatch({
      id, createdAt: before.createdAt || new Date().toISOString(), by: before.by || req.adminWho.shown || req.adminWho.name,
      file, status: 'reading', total, done: 0, items: [], skipped,
    });
    await Promise.race([readUploadedZip(id), new Promise((resolve) => setTimeout(resolve, WAIT_READING).unref())]);
    const b = readBatch(id);
    if (!b) throw new HttpError(404, 'uploadGone');
    if (b.status === 'failed') throw new HttpError(400, b.code || 'zipEmpty', { n: b.skipped.length });
    res.status(b.status === 'reading' ? 202 : 201).json({ batch: batchView(b) });
  }
  // A small zip in one request.
  app.post('/api/admin/library/uploads', requireCatalog, async (req, res, next) => {
    let id = null;
    try {
      rateLimit(req, 'designZip');
      if (Number(req.get('content-length')) > ZIP_MAX) throw new HttpError(413, 'zipOver', { max: ZIP_MAX_MB });
      id = crypto.randomBytes(10).toString('hex');
      fs.mkdirSync(batchDir(id), { recursive: true });
      let got = 0;
      await streamPipeline(req, new Transform({
        transform(chunk, enc, cb) {
          got += chunk.length;
          cb(got > ZIP_MAX ? new HttpError(413, 'zipOver', { max: ZIP_MAX_MB }) : null, chunk);
        },
      }), fs.createWriteStream(path.join(batchDir(id), 'upload.zip')));
      await beginReading(req, res, id, zipName(req.get('x-file-name')));
    } catch (e) {
      // (Not a usable zip, or nothing in it: nothing is kept.)
      const st = id && (readBatch(id) || {}).status;
      if (id && (!st || st === 'failed')) fs.rmSync(batchDir(id), { recursive: true, force: true });
      next(e);
    }
  });
  // A big zip in pieces: each piece is its own short request (the hosting stops any request after
  // 2 minutes, and a dropped piece is just sent again). Start → pieces in order → finish.
  const ZIP_PIECE = 8 * 2 ** 20;
  app.post('/api/admin/library/uploads/start', requireCatalog, express.json({ limit: '4kb' }), (req, res) => {
    rateLimit(req, 'designZip');
    const size = Number((req.body || {}).size);
    if (!Number.isInteger(size) || size < 22) throw new HttpError(400, 'zipBad');
    if (size > ZIP_MAX) throw new HttpError(413, 'zipOver', { max: ZIP_MAX_MB });
    const id = crypto.randomBytes(10).toString('hex');
    fs.mkdirSync(batchDir(id), { recursive: true });
    fs.writeFileSync(path.join(batchDir(id), 'upload.zip'), Buffer.alloc(0));
    writeBatch({ id, createdAt: new Date().toISOString(), by: req.adminWho.shown || req.adminWho.name, file: zipName(req.body.name), status: 'uploading', size, total: 0, done: 0, items: [], skipped: [] });
    res.status(201).json({ id, piece: ZIP_PIECE });
  });
  app.put('/api/admin/library/uploads/:batch/piece', requireCatalog, express.raw({ type: () => true, limit: ZIP_PIECE + 64 * 1024 }), (req, res) => {
    const b = readBatch(req.params.batch);
    if (!b) throw new HttpError(404, 'uploadGone');
    if (b.status !== 'uploading') throw new HttpError(409, 'uploadNotReady');
    const file = path.join(batchDir(b.id), 'upload.zip');
    const received = fs.statSync(file).size;
    const at = Number(req.query.at);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    // (A piece sent again after a dropped connection, or out of order: where to go on from.)
    if (!Number.isInteger(at) || at !== received) return res.status(409).json({ received });
    if (received + body.length > b.size) throw new HttpError(400, 'zipBad');
    fs.appendFileSync(file, body);
    res.json({ received: received + body.length });
  });
  app.post('/api/admin/library/uploads/:batch/finish', requireCatalog, async (req, res, next) => {
    const id = String(req.params.batch);
    try {
      const b = readBatch(id);
      if (!b) throw new HttpError(404, 'uploadGone');
      // (Asked again after a dropped answer: as it is now.)
      if (b.status === 'reading' || b.status === 'ready') return res.status(b.status === 'reading' ? 202 : 201).json({ batch: batchView(b) });
      if (b.status !== 'uploading') throw new HttpError(409, 'uploadNotReady');
      const received = fs.statSync(path.join(batchDir(id), 'upload.zip')).size;
      if (received !== b.size) return res.status(409).json({ received });
      await beginReading(req, res, id, b.file);
    } catch (e) {
      // (A zip that can't be used goes: the admin uploads it again.)
      if (e instanceof HttpError && e.status === 400) fs.rmSync(batchDir(id), { recursive: true, force: true });
      next(e);
    }
  });
  app.get('/api/admin/library/uploads', requireCatalog, (req, res) => {
    let ids = [];
    try { ids = fs.readdirSync(uploadsDir).filter((x) => BATCH_RE.test(x)); } catch (e) { ids = []; }
    const batches = ids.map(readBatch).filter((b) => b && b.status !== 'uploading').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => ({ id: b.id, createdAt: b.createdAt, by: b.by, file: b.file, count: b.items.length, status: b.status || 'ready', done: b.done || 0, total: b.total || b.items.length, ...(b.code ? { code: b.code } : {}) }));
    res.json({ batches });
  });
  app.get('/api/admin/library/uploads/:batch', requireCatalog, (req, res) => {
    const b = readBatch(req.params.batch);
    if (!b) throw new HttpError(404, 'uploadGone');
    res.json({ batch: batchView(b) });
  });
  app.delete('/api/admin/library/uploads/:batch', requireCatalog, (req, res) => {
    if (!readBatch(req.params.batch)) throw new HttpError(404, 'uploadGone');
    fs.rmSync(batchDir(req.params.batch), { recursive: true, force: true });
    res.json({ ok: true });
  });
  // The light pictures of a batch, for the review screen (unguessable addresses; the admin's browser).
  app.get('/library-upload/:batch/:item.png', (req, res) => {
    const b = readBatch(req.params.batch);
    const it = b && ITEM_RE.test(req.params.item) && b.items.find((x) => x.id === req.params.item);
    if (!it) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'private, max-age=3600, no-transform');
    res.type('png').send(fs.readFileSync(path.join(batchDir(b.id), `${it.id}.png`)));
  });
  // Published ones: the screen copy and the full-size original (print files use it).
  app.get('/library-art/:id/:file', (req, res) => {
    const id = String(req.params.id);
    const file = String(req.params.file);
    if (!/^u-[0-9a-f]{12}$/.test(id) || !['web.png', 'print.png', 'print.jpg', 'nowords-web.png', 'nowords-print.png', 'nowords-print.jpg'].includes(file)) throw new HttpError(404, 'notFound');
    const d = library.get(id);
    const f = path.join(library.artDir(id), file);
    // A deleted design (taken down, e.g. after a rights complaint) is no longer public, its full-size original
    // least of all. (A paused one stays: customers' drafts made from it still print at full size.)
    if (!d || d.deleted || !fs.existsSync(f)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', d.hidden ? 'private, max-age=300, no-transform' : 'public, max-age=3600, no-transform'); // (an hour: a takedown is gone from caches soon)
    res.type(file.endsWith('.jpg') ? 'jpeg' : 'png').send(fs.readFileSync(f));
  });
  /** Which items of a batch can be published as asked (names, products), and why the others can't. */
  function publishPlan(b, items) {
    const asked = Array.isArray(items) ? items.slice(0, 300) : [];
    const live = new Map(liveProducts().map((p) => [p.id, p]));
    const plan = [];
    const skipped = [];
    const seen = new Set();
    for (const a of asked) {
      const it = a && b.items.find((x) => x.id === a.id);
      if (!it || seen.has(it.id)) continue;
      const products = [...new Set((Array.isArray(a.products) ? a.products : []).map(String))].filter((id) => live.has(id)).slice(0, 60);
      if (!products.length) { skipped.push({ itemId: it.id, code: 'pickProducts' }); continue; }
      const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) : '');
      // The English name in English letters (an Arabic file name goes in the Arabic name only: the English shop
      // would show Arabic, QA 25 Nov); the Arabic name falls back to the English one.
      const askedEn = clean(a.name && a.name.en);
      const askedAr = clean(a.name && a.name.ar);
      const en = askedEn || (askedAr || ARABIC_LETTERS.test(it.name.en) ? '' : it.name.en);
      if (!en) { skipped.push({ itemId: it.id, code: 'nameEnMissing' }); continue; }
      if (ARABIC_LETTERS.test(en)) { skipped.push({ itemId: it.id, code: 'nameEnArabic' }); continue; }
      const ar = askedAr || (ARABIC_LETTERS.test(it.name.ar) ? it.name.ar : '') || en;
      const category = DESIGN_CATEGORIES.some((c) => c.id === a.category) ? a.category : it.category;
      const first = live.get(products[0]);
      const wantColor = a.color && typeof a.color === 'object' ? a.color[first.id] : typeof a.color === 'string' ? a.color : it.color[first.id];
      const color = (first.colors.find((c) => c.id === wantColor) || first.colors.find((c) => c.id === it.color[first.id]) || first.colors[0]).id;
      seen.add(it.id);
      plan.push({ it, products, first, en, ar, category, color });
    }
    return { plan, skipped };
  }
  // Editable words in the designs published from a zip (src/words.js): made in the background after publishing.
  const wordsJobs = wordsRoutes.mount(app, { library, guard: requireCatalog, HttpError });
  app.post('/api/admin/library/uploads/:batch/publish', requireCatalog, express.json({ limit: '256kb' }), (req, res) => {
    const b = readBatch(req.params.batch);
    if (!b) throw new HttpError(404, 'uploadGone');
    if (b.status && b.status !== 'ready') throw new HttpError(409, 'uploadNotReady');
    const { plan, skipped } = publishPlan(b, (req.body || {}).items);
    const published = [];
    const done = new Set();
    for (const { it, products, first, en, ar, category, color } of plan) {
      const designId = `u-${crypto.randomBytes(6).toString('hex')}`;
      const dir = library.artDir(designId);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(batchDir(b.id), `${it.id}.png`), path.join(dir, 'web.png'));
      fs.copyFileSync(path.join(batchDir(b.id), `${it.id}.print.${it.printExt}`), path.join(dir, `print.${it.printExt}`));
      library.addUploaded({
        id: designId, kind: 'template', uploaded: true, category, name: { en, ar }, product: first.id, color, products, aspect: 0.75,
        items: [{ kind: 'image', src: `/library-art/${designId}/web.png`, printSrc: `/library-art/${designId}/print.${it.printExt}`, printPx: it.printPx, fit: 0.92, x: 0.5, y: 0.5, w: 0.92 }],
        createdAt: new Date().toISOString(), by: req.adminWho.shown || req.adminWho.name,
      });
      wordsJobs.enqueue(designId);
      published.push({ itemId: it.id, designId });
      done.add(it.id);
    }
    // What's published leaves the batch; an empty batch goes.
    const left = b.items.filter((x) => !done.has(x.id));
    for (const x of b.items.filter((y) => done.has(y.id))) {
      for (const f of [`${x.id}.png`, `${x.id}.print.${x.printExt}`]) fs.rmSync(path.join(batchDir(b.id), f), { force: true });
    }
    if (!left.length) fs.rmSync(batchDir(b.id), { recursive: true, force: true });
    else writeBatch({ ...b, items: left });
    res.json({ published, skipped });
  });
  app.get('/api/admin/queue', requireAdmin, (req, res) => {
    const all = [];
    for (const order of store.listOrders()) {
      order.items.forEach((item, i) => all.push(adminItem(order, item, i)));
    }
    // Oldest first. Several items can be on the presses at once, in any order.
    const byAge = (a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.position - b.position;
    const printing = all.filter((i) => i.status === 'printing').sort(byAge);
    const waiting = all.filter((i) => i.status === 'queued').sort(byAge);
    const toShip = all.filter((i) => i.status === 'printed').sort(byAge);
    const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, all.filter((i) => i.status === s).length]));
    res.json({ printing, waiting, toShip, counts });
  });

  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    const orders = [...store.listOrders()].reverse().map((o) => ({
      ...publicOrder(o, PAYMENT),
      customer: adminCustomer(o.customer),
      items: o.items.map((item, i) => adminItem(o, item, i)),
      notifications: o.notifications || null,
    }));
    res.json({ orders });
  });

  // ---------- The order page as the team sees it (a link that works for 30 minutes) ----------
  // The dashboard asks for a link; the order page shows the order as the customer sees it, without the
  // amounts for people not allowed them, and without the customer's buttons. The link holds no secret of
  // the customer's (an order's key never reaches the dashboard). It is signed (any copy of the app can check
  // it, also after a restart), works only in the browser that asked for it (an HttpOnly cookie), and every use
  // checks the sign-in that made it again: signed out, switched off or a changed role ends it at once.
  const TEAM_VIEW_MS = 30 * 60e3;
  const TEAM_COOKIE = 'pod_tv';
  const TEAM_TICKET_RE = /^([A-Za-z0-9_-]{20,600})\.([A-Za-z0-9_-]{43})$/;
  app.post('/api/admin/orders/:orderId/team-view', requireAdmin, (req, res) => {
    const order = UUID_RE.test(req.params.orderId) && store.getOrder(req.params.orderId);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const who = req.adminWho;
    const token = security.bearer(req);
    if (!token || who.approvalId) throw new HttpError(401, 'signInAgain');
    // This browser's mark (made once per browser session), so the link works only here.
    let mark = cookieOf(req, TEAM_COOKIE);
    if (!/^[A-Za-z0-9_-]{32}$/.test(mark)) {
      mark = crypto.randomBytes(24).toString('base64url');
      res.append('Set-Cookie', `${TEAM_COOKIE}=${mark}; Path=/api/orders; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`);
    }
    const exp = Date.now() + TEAM_VIEW_MS;
    const body = Buffer.from(JSON.stringify({
      o: order.id, e: exp, k: who.emergency ? 'o' : 's', i: who.id, g: who.emergency ? 0 : ((staffAll().find((u) => u.id === who.id) || {}).gen || 0),
      x: parseInt(token.split('.')[0], 36) || 0, h: sha(token), b: sha(mark).slice(0, 32),
    })).toString('base64url');
    const ticket = `${body}.${auth.sign(`team-view.${body}`)}`;
    const q = `id=${encodeURIComponent(order.id)}&team=${ticket}`;
    res.json({ link: `/order?${q}`, invoice: who.perms.has('orders.amounts') ? `/invoice?${q}` : null, expiresAt: new Date(exp).toISOString() });
  });
  /** The person a team link was made for, as they are now (null: the link is over, or not this browser's). */
  function teamViewer(req, orderId) {
    const m = TEAM_TICKET_RE.exec(String(req.get('x-team-view') || ''));
    if (!m || !sameSecret(m[2], auth.sign(`team-view.${m[1]}`))) return null;
    let t;
    try { t = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch (e) { return null; }
    const now = Date.now();
    if (!t || t.o !== orderId || !(t.e > now) || !(t.x > now)) return null;
    const mark = cookieOf(req, TEAM_COOKIE);
    if (!/^[A-Za-z0-9_-]{32}$/.test(mark) || !sameSecret(sha(mark).slice(0, 32), String(t.b || ''))) return null;
    // The sign-in that made it: not signed out since (any copy of the app sees that), not expired.
    if (typeof t.h !== 'string' || auth.revoked()[t.h]) return null;
    let who = null;
    if (t.k === 'o') who = emergencyWho();
    else if (t.k === 's') {
      const u = staffList().find((x) => x.id === t.i);
      if (u && (u.gen || 0) === t.g) who = whoOf(u);
    }
    if (!who || !who.perms.has('orders.view')) return null;
    return { who, exp: t.e };
  }
  app.get('/api/orders/:id/team', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    const t = order && teamViewer(req, order.id);
    if (!t) throw new HttpError(401, 'teamViewOver');
    const amounts = t.who.perms.has('orders.amounts');
    const view = {
      ...publicOrder(order, PAYMENT),
      team: { amounts, owner: t.who.role === 'owner', expiresAt: new Date(t.exp).toISOString() },
      // An owner can pass the customer their own link again (a guest who lost the email).
      ...(t.who.role === 'owner' && order.linkKey ? { customerLink: notify.orderLink(linkBase(req), order) || `/order?id=${encodeURIComponent(order.id)}&k=${encodeURIComponent(order.linkKey)}` } : {}),
    };
    res.json(amounts ? view : roles.withoutAmounts(view));
  });

  // Redraw a book's pages again (after fixing the AI key, or if the shop wants a fresh try).
  app.post('/api/admin/items/:itemId/redraw', requireAdmin, (req, res) => {
    const found = store.findItem(req.params.itemId);
    if (!found || found.item.kind !== 'book') throw new HttpError(404, 'itemNotFound');
    if (!cartoon.enabled()) throw new HttpError(400, 'aiOff');
    queueRedraw(found.order, found.item, { force: true });
    res.json({ ok: true, redraw: found.item.redraw });
  });
  app.patch('/api/admin/items/:itemId', requireAdmin, express.json(), (req, res) => {
    const { status, process: method } = req.body || {};
    const found = store.findItem(req.params.itemId);
    if (!found) throw new HttpError(404, 'itemNotFound');
    const { order, item } = found;
    if (method !== undefined) {
      // Switch an item between DTG and DTF (for products that allow both).
      const allowed = getProduct(item.productId)?.methods || [];
      // Embroidered items stay embroidered: the stitch file can't be printed instead.
      if (item.process === 'embroidery' && method !== 'embroidery') throw new HttpError(400, 'badProcess', { list: 'embroidery' });
      if (!allowed.includes(method)) throw new HttpError(400, 'badProcess', { list: allowed.join(', ') });
      if (item.process !== method) {
        // The print PDFs made before name the old method on their label: made again on the next download.
        const d = store.getDesign(item.designId);
        for (const sd of (d && d.sides) || []) {
          for (const f of Object.values(FORMATS)) if (f.ext === 'pdf' && !f.make) fs.rmSync(store.designFile(d.id, f.file(sd.id)), { force: true });
        }
      }
      item.process = method;
      store.save();
      if (status === undefined) return res.json(adminItem(order, item, order.items.indexOf(item)));
    }
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, 'badStatus', { list: ITEM_STATUSES.join(', ') });
    // (A button on a list that's out of date: someone else moved the job meanwhile. QA admin round.)
    const from = (req.body || {}).from;
    // Checked and changed under the lock with the latest data: the last two jobs marked shipped at the same moment on
    // two copies of the app both see the order complete there (it stayed "not shipped" before. QA 26 Nov).
    let first = false;
    const cur = store.mutate(() => {
      const now = store.findItem(req.params.itemId);
      if (!now) throw new HttpError(404, 'itemNotFound');
      const { order: o, item: it } = now;
      if (typeof from === 'string' && from !== it.status) throw new HttpError(409, 'jobMoved');
      // A job waiting for review or for the customer's approval is cleared from the Review tab, not here.
      if (REVIEW_STATUSES.includes(it.status) && status !== it.status) throw new HttpError(409, 'notApproved');
      // A corrected file for it is being processed (it then waits for the customer's approval): not now (QA 25 Nov).
      if (replacingItems.has(it.id) && status !== it.status) throw new HttpError(409, 'fileBeingReplaced');
      if (it.status !== status) {
        it.status = status;
        it.history.push({ status, at: new Date().toISOString() });
        // Sent back from "shipped" (a mistake, or a reprint): the order isn't on its way any more.
        if (status !== 'shipped' && o.shipment && o.shipment.shippedAt && !o.shipment.deliveredAt) o.shipment = { ...o.shipment, shippedAt: null };
        // The last item shipped: the order is on its way (the customer is told once).
        first = o.items.every((x) => x.status === 'shipped') && markShipped(o, req);
      }
      return now;
    });
    if (first) sendShipped(cur.order, req);
    res.json(adminItem(cur.order, cur.item, cur.order.items.indexOf(cur.item)));
  });

  // Print files in every format the shop may need. Derived files are made on
  // first request and cached next to the original.
  const FORMATS = {
    png: { file: (sd) => `${sd}-print.png`, ext: 'png', type: 'image/png' },
    'png-mirror': { file: (sd) => `${sd}-print-mirrored.png`, ext: 'png', type: 'image/png', make: (buf, side) => printfiles.mirroredPng(buf, side.dpi) },
    svg: { file: (sd) => `${sd}-design.svg`, ext: 'svg', type: 'image/svg+xml' },
    pdf: { file: (sd) => `${sd}-print.pdf`, ext: 'pdf', type: 'application/pdf' },
    'pdf-marks': { file: (sd) => `${sd}-print-marks.pdf`, ext: 'pdf', type: 'application/pdf' },
    tiff: { file: (sd) => `${sd}-print-cmyk.tif`, ext: 'tif', type: 'image/tiff', make: (buf, side) => printfiles.cmykTiff(buf, side.dpi) },
    'dtf-film': { file: (sd) => `${sd}-dtf-film.png`, ext: 'png', type: 'image/png', make: (buf, side) => printfiles.dtfFilmPng(buf, side.dpi) },
    'dtf-pdf': { file: (sd) => `${sd}-dtf-film.pdf`, ext: 'pdf', type: 'application/pdf', make: async (buf, side) => printfiles.printPdf(await printfiles.dtfFilmPng(buf, side.dpi), side, { title: 'DTF film' }) },
    'dtg-white': { file: (sd) => `${sd}-dtg-white.png`, ext: 'png', type: 'image/png', make: (buf, side) => printfiles.dtgUnderbase(buf, side.dpi, Math.max(1, Math.round(side.dpi / 150))) },
    // CO2 laser: one LightBurn file (engraving image + red cut lines), or the two parts on their own.
    'laser-svg': { file: (sd) => `${sd}-laser.svg`, ext: 'svg', type: 'image/svg+xml', laser: true, make: (buf, side, design) => laserFiles.laserSvg(buf, laserSpec(side, design)) },
    'engrave-png': { file: (sd) => `${sd}-engrave.png`, ext: 'png', type: 'image/png', laser: true, make: (buf, side, design) => laserFiles.engravePng(buf, laserSpec(side, design)) },
    'cut-svg': { file: (sd) => `${sd}-cut.svg`, ext: 'svg', type: 'image/svg+xml', laser: true, make: (buf, side, design) => laserFiles.cutSvg(buf, laserSpec(side, design)) },
  };
  /** A laser side's physical size and the product's laser settings. */
  function laserSpec(side, design) {
    const product = getProduct(design.productId);
    return { widthMm: Math.round(side.widthIn * 25.4 * 100) / 100, heightMm: Math.round(side.heightIn * 25.4 * 100) / 100, laser: (product && product.laser) || { kind: 'engrave' }, dpi: 254 };
  }
  // (Laser files each their own name: the LightBurn file, the cut lines and the plain SVG were all "…-front.svg". QA 25 Nov.)
  const SUFFIX = { 'png-mirror': '-mirrored', 'pdf-marks': '-cropmarks', tiff: '-cmyk', 'dtf-film': '-dtf-film', 'dtf-pdf': '-dtf-film', 'dtg-white': '-dtg-white-underbase', 'sheet-pdf': '-film-mirrored', 'sheet-pdf-plain': '', proof: '-proof', 'laser-svg': '-laser-lightburn', 'engrave-png': '-engrave', 'cut-svg': '-cut-lines' };

  /** Pieces of a customer's gang sheet, laid out exactly as they saw it. */
  async function gangSheetPdf(design, mirror) {
    const sheet = design.sheet;
    const sources = await Promise.all(sheet.items.map((it) => printfiles.hardAlpha(fs.readFileSync(store.designFile(design.id, it.file)))));
    const pieces = sheet.placements.map((pl) => ({ png: sources[pl.item], widthIn: sheet.items[pl.item].wCm / 2.54, heightIn: sheet.items[pl.item].hCm / 2.54 }));
    const placements = sheet.placements.map((pl, i) => ({ id: i, x: pl.x / 2.54, y: pl.y / 2.54, w: pl.w / 2.54, h: pl.h / 2.54, rotated: pl.rotated }));
    return printfiles.filmPdf(pieces, { rollWidthIn: sheet.widthCm / 2.54, mirror, labels: false, margin: 0, placements, lengthIn: sheet.lengthCm / 2.54, title: `DTF gang sheet ${sheet.widthCm}x${sheet.lengthCm}cm` });
  }
  /**
   * Makes (or reuses) one downloadable file for a design: a print file of one
   * side, the book or gang-sheet PDF, or the customer-design preview PDF.
   * Returns { path, name } or throws an HttpError.
   */
  /** Embroidery: the stitches (DST), a picture of them and the thread list, from the print file. */
  async function makeEmbroidery(design) {
    const sd = design.sides.find((x) => x.id === embSideOf(design)) || design.sides[0];
    try {
      const d = await embroidery.digitize(fs.readFileSync(store.designFile(design.id, `${sd.id}-print.png`)), sd.widthIn * 25.4, sd.heightIn * 25.4);
      const dst = embroidery.toDst(d, `EBDA3 ${design.id.slice(0, 6)}`);
      store.writeDesignFile(design.id, `${sd.id}-stitches.dst`, dst.buffer);
      store.writeDesignFile(design.id, `${sd.id}-stitches.png`, await embroidery.stitchPreview(d, { pxPerMm: 8, background: (design.color && design.color.hex) || '#ffffff' }));
      design.emb = { colors: d.colors.map((c) => ({ name: c.name, hex: c.hex, stitches: c.stitches })), stitches: dst.stitches, trims: d.trims, warnings: d.warnings, widthMm: Math.round(d.widthMm), heightMm: Math.round(d.heightMm) };
    } catch (e) {
      console.warn('[embroidery] digitising failed:', e.message);
      design.emb = { colors: [], stitches: 0, trims: 0, warnings: ['failed'] };
    }
    return design.emb;
  }
  /**
   * How a side is made: an embroidered side stays embroidery; otherwise the ordered item's method (the shop may switch
   * it between DTG and DTF after the order: QA 26 Nov, the label and the proof still said DTG), else the design's.
   */
  function sideProcess(side, design, item, product = getProduct(design.productId)) {
    if (side && side.process === 'embroidery') return 'embroidery';
    if (item && item.process && item.process !== 'embroidery') return item.process;
    return (side && side.process) || design.process || (product && product.process) || null;
  }
  async function makeFile(design, sideId, format, { now = false } = {}) {
    // Only finished designs (their files were checked when they were completed).
    if (design.status && design.status !== 'ready') throw new HttpError(404, 'notFound');
    const designId = design.id;
    const side = design.sides.find((s) => s.id === sideId);
    const order = design.orderId && store.getOrder(design.orderId);
    const base = `${order ? order.number : 'design'}-${design.productId}-${sideId}`;
    // Production files only from what the customer approved, and only once the job is cleared to print.
    const ordered = order && order.items.find((it) => it.designId === design.id);
    if (ordered && !['preview-pdf', 'merge-csv', 'proof'].includes(format || 'png')) {
      if (REVIEW_STATUSES.includes(ordered.status) || !approvedFilesMatch(ordered, design)) throw new HttpError(409, 'notApproved');
    }
    if (format === 'preview-pdf') {
      // What the customer designed (all sides, or every book page), as one PDF.
      const target = store.designFile(designId, design.kind === 'book' ? 'book-preview.pdf' : `preview-v${design.version || 0}.pdf`);
      if (!fs.existsSync(target)) {
        const title = `${order ? order.number + ' · ' : ''}${pickEn(design.productName) || ''}`;
        // Several colours / sizes: each with its count ("White · 200 cards ×1, White · 1000 cards ×1"), not only the
        // first one (QA 25 Nov).
        const qtyLines = Array.isArray(design.quantities) ? design.quantities.filter((l) => l && Number(l.qty) > 0) : [];
        const lines = [
          qtyLines.length > 1 || (qtyLines.length === 1 && Number(qtyLines[0].qty) > 1)
            ? qtyLines.map((l) => `${[l.color && pickEn(l.color.name), l.size && pickEn(l.size.label)].filter(Boolean).join(' · ')} ×${l.qty}`).join(', ')
            : [design.color && pickEn(design.color.name), design.size && pickEn(design.size.label)].filter(Boolean).join(' · '),
          order ? `Ordered ${SHOP_DAY.format(new Date(order.createdAt))}` : '', // (the Cairo day, as the invoice and accounts)
        ].filter(Boolean);
        let pages;
        if (design.kind === 'book') {
          if (design.photoRemoved) throw new HttpError(404, 'notFound');
          const book = bookFor(design.bookId);
          const data = bookData(design);
          pages = [];
          for (let i = 0; i < book.pages.length; i++) pages.push({ img: await books.pageJpeg(data, i, 900, 85), label: `Page ${i + 1}` });
        } else {
          pages = design.sides
            // A side the shop replaced: its corrected print file (the mockup shows the old artwork).
            .map((sd) => ({ file: store.designFile(designId, design.replaced && design.replaced[sd.id] ? `${sd.id}-proof.png` : `${sd.id}-preview.png`), label: pickEn(sd.name) || sd.id }))
            .filter((pg) => fs.existsSync(pg.file))
            .map((pg) => ({ img: fs.readFileSync(pg.file), label: pg.label }));
        }
        if (!pages.length) throw new HttpError(404, 'notFound');
        store.writeDesignFile(designId, path.basename(target), await printfiles.previewPdf(pages, { title, lines }));
      }
      return { path: target, name: `${order ? order.number : 'design'}-${design.productId}-preview.pdf` };
    }
    if (format && format.startsWith('merge-')) return makeMergeFile(design, format, base.replace(`-${sideId}`, ''));
    if (format === 'dst' || format === 'stitches') {
      // Only the embroidered side has stitches (a printed back has print files).
      if (design.method !== 'embroidery' || sideId !== embSideOf(design)) throw new HttpError(404, 'notFound');
      const sd = side;
      const file = store.designFile(designId, `${sd.id}-stitches.${format === 'dst' ? 'dst' : 'png'}`);
      if (!fs.existsSync(file)) await makeEmbroidery(design);
      if (!fs.existsSync(file)) throw new HttpError(404, 'notFound');
      return { path: file, name: `${base}-embroidery${format === 'dst' ? '.dst' : '-stitches.png'}` };
    }
    if (format === 'source-pdf') {
      // The PDF the customer uploaded, exactly as it came.
      const sd = (design.sides || []).find((x) => x.vector);
      const file = sd && store.designFile(designId, `source-${sd.vector.pdfId}.pdf`);
      if (!file || !fs.existsSync(file)) throw new HttpError(404, 'notFound');
      return { path: file, name: `${base.replace(`-${sideId}`, '')}-customer-original.pdf` };
    }
    if (format === 'booklet-pdf' || format === 'booklet-imposed') {
      // Booklets: every page in reading order (blank pages left white), or arranged on sheets
      // for folding and stapling (saddle stitch), turning the way the binding says.
      const product = getProduct(design.productId);
      if (!product || !product.paged) throw new HttpError(404, 'notFound');
      const order = pageSides(product, design.size.id);
      const spec = design.sides[0];
      const pages = order.map((ps) => {
        const sd = design.sides.find((x) => x.id === ps.id);
        const file = sd && store.designFile(designId, `${sd.id}-print.png`);
        return file && fs.existsSync(file) ? fs.readFileSync(file) : null;
      });
      const rtl = !(design.options && design.options.binding && design.options.binding.id === 'left');
      const target = store.designFile(designId, `${format}-v${design.version || 1}.pdf`);
      const size = { widthIn: spec.widthIn, heightIn: spec.heightIn, bleedIn: spec.bleedIn || 0 };
      if (!fs.existsSync(target)) {
        let made = null;
        // Pages from the customer's PDF: printed from the PDF pages themselves (sharp text and drawings,
        // their images untouched), with anything added on top; the other pages from their print files.
        const vec = order.map((ps) => design.sides.find((x) => x.id === ps.id)).map((sd) => (sd && sd.vector && fs.existsSync(store.designFile(designId, `source-${sd.vector.pdfId}.pdf`)) ? sd : null));
        if (vec.some(Boolean)) {
          try {
            const PW = (size.widthIn + 2 * size.bleedIn) * 72;
            const PH = (size.heightIn + 2 * size.bleedIn) * 72;
            const partPngs = [];
            const entries = order.map((ps, i) => {
              const sd = vec[i];
              if (sd) {
                const ov = store.designFile(designId, `${sd.id}-overlay.png`);
                let overlay = null;
                if (sd.vector.overlay && fs.existsSync(ov)) overlay = partPngs.push(fs.readFileSync(ov)) - 1;
                return { pdf: sd.vector.pdfId, page: sd.vector.page, src: sd.vector.src, box: sd.vector.box, overlay };
              }
              return pages[i] ? { part: partPngs.push(pages[i]) - 1 } : null;
            });
            const parts = partPngs.length ? await printfiles.imagesPdf(partPngs, PW, PH) : null;
            const sources = {};
            for (const sd of vec.filter(Boolean)) sources[sd.vector.pdfId] ||= fs.readFileSync(store.designFile(designId, `source-${sd.vector.pdfId}.pdf`));
            made = await artwork.bookletFromPdf({ sources, parts, pages: entries, spec: size, imposed: format === 'booklet-imposed', rtl, title: `${base} booklet` });
          } catch (e) {
            console.warn('[booklet] could not print from the customer\'s PDF, using the print files:', e.reason || e.message, String(e.detail || '').slice(-300));
          }
        }
        store.writeDesignFile(designId, path.basename(target), made || await printfiles.bookletPdf(pages, size, { imposed: format === 'booklet-imposed', rtl, title: `${base} booklet` }));
      }
      return { path: target, name: `${base.replace(`-${sideId}`, '')}-booklet-${order.length}p${format === 'booklet-imposed' ? '-imposed' : ''}.pdf` };
    }
    if (format === 'repeat') {
      // Fabric: the whole piece with the tile repeated, to check before printing.
      if (!design.pattern) throw new HttpError(404, 'notFound');
      const target = store.designFile(designId, `repeat-v${design.version || 0}.jpg`);
      if (!fs.existsSync(target)) store.writeDesignFile(designId, path.basename(target), await printfiles.repeatPreview(fs.readFileSync(store.designFile(designId, `${design.sides[0].id}-print.png`)), design.pattern));
      const p = design.pattern;
      return { path: target, name: `${base}-repeat-${p.repeat}-${p.tileCm}cm-${p.fabricCm[0]}x${p.fabricCm[1]}cm.jpg` };
    }
    if (design.kind === 'book') {
      const f = format || 'book-pdf';
      const title = `${base}-${design.bookId}`;
      if (f === 'proof') return { path: store.designFile(designId, 'book-preview.png'), name: `${title}-cover.png` };
      if (f !== 'book-pdf' || design.photoRemoved) throw new HttpError(404, 'notFound');
      const item = order && order.items.find((it) => it.designId === design.id);
      if (item && item.redraw && ['queued', 'running', 'waiting'].includes(item.redraw.status) && !now) {
        throw new HttpError(409, 'bookDrawing', { done: item.redraw.done || 0, total: item.redraw.total || 0 });
      }
      const target = store.designFile(designId, 'book-print.pdf');
      if (!fs.existsSync(target)) store.writeDesignFile(designId, 'book-print.pdf', await books.bookPdf(bookData(design), { title }));
      return { path: target, name: `${title}.pdf` };
    }
    if (design.kind === 'photoset') {
      const f = format || 'photos-zip';
      if (f === 'proof') return { path: store.designFile(designId, 'front-proof.png'), name: `${base}-proof.png` };
      if (f !== 'photos-zip') throw new HttpError(404, 'notFound');
      return photosZip(design, base);
    }
    if (design.kind === 'gangsheet') {
      const f = format || 'sheet-pdf';
      if (f === 'proof') return { path: store.designFile(designId, 'front-preview.png'), name: `${base}-proof.png` };
      if (f !== 'sheet-pdf' && f !== 'sheet-pdf-plain') throw new HttpError(404, 'notFound');
      const name = f === 'sheet-pdf' ? 'sheet-film-mirrored.pdf' : 'sheet-film.pdf';
      const target = store.designFile(designId, name);
      if (!fs.existsSync(target)) store.writeDesignFile(designId, name, (await gangSheetPdf(design, f === 'sheet-pdf')).pdf);
      return { path: target, name: `${base}${SUFFIX[f]}.pdf` };
    }
    const fmt = Object.hasOwn(FORMATS, format || 'png') ? FORMATS[format || 'png'] : null;
    if (!side || !fmt) throw new HttpError(404, 'notFound');
    if (format === 'svg' && design.replaced && design.replaced[sideId]) throw new HttpError(404, 'notFound');
    if (fmt.laser && !(getProduct(design.productId) || {}).laser) throw new HttpError(404, 'notFound');
    const target = store.designFile(designId, fmt.file(sideId));
    if (!fs.existsSync(target)) {
      const png = fs.readFileSync(store.designFile(designId, `${sideId}-print.png`));
      let out;
      if (fmt.make) out = await fmt.make(png, side, design);
      else if (fmt.ext === 'pdf') {
        const product = getProduct(design.productId);
        const label = `${order ? order.number + ' · ' : ''}${pickEn(design.productName)} · ${pickEn(design.size.label)} · ${pickEn(design.color.name)} · ${pickEn(side.name)} · trim ${side.widthIn} x ${side.heightIn} in${side.bleedIn ? ` + ${side.bleedIn} in bleed` : ''}${side.offsetCm ? ` · PLACEMENT moved ${placementEn(side.offsetCm)} from standard` : ''} · ${side.dpi} DPI · ${String(sideProcess(side, design, ordered, product) || '').toUpperCase()}`;
        out = await printfiles.printPdf(png, side, { marks: format === 'pdf-marks', title: base, slug: label });
      } else throw new HttpError(404, 'notFound');
      store.writeDesignFile(designId, fmt.file(sideId), out);
    }
    return { path: target, name: `${base}${SUFFIX[format] || ''}.${fmt.ext}` };
  }

  app.get('/api/admin/files/:designId/:side', requireAdmin, async (req, res, next) => {
    try {
      const { designId, side: sideId } = req.params;
      const design = UUID_RE.test(designId) && store.getDesign(designId);
      if (!design) throw new HttpError(404, 'notFound');
      if (req.query.format !== undefined && typeof req.query.format !== 'string') throw new HttpError(404, 'notFound');
      const f = await makeFile(design, sideId, req.query.format, { now: req.query.now === '1' });
      res.download(f.path, f.name);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Customers (admin): find a customer, help with a forgotten password ----------
  app.get('/api/admin/customers', requireAdmin, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
    let digits = q.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\D/g, '');
    // +20 100 … / 0020 100 … / 20100…: the Egyptian number as stored (0100…).
    digits = digits.replace(/^(00)?20(?=1)/, '0');
    const orders = store.listOrders();
    const list = customerList()
      .filter((c) => !q || looseName(c.name).includes(looseName(q)) || (c.email || '').includes(q) || (digits.length >= 3 && String(c.phone || '').includes(digits)))
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 200)
      .map((c) => {
        const mine = orders.filter((o) => o.customerId === c.id || (c.phone && o.customer && o.customer.phone === c.phone));
        return {
          ...customers.publicCustomer(c),
          orders: mine.length,
          spent: round2(mine.reduce((n, o) => n + (o.total || 0), 0)),
          lastOrder: mine.length ? mine[mine.length - 1].createdAt : null,
        };
      });
    res.set('Cache-Control', 'no-store');
    res.json({ customers: list, total: customerList().length });
  });
  // A password-reset link the shop sends the customer (WhatsApp or anything), valid 24 hours.
  app.post('/api/admin/customers/:id/reset-link', requireAdmin, (req, res) => {
    const c = findCustomer(req.params.id);
    if (!c) throw new HttpError(404, 'notFound');
    const url = `${notify.siteUrl() || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`}/account?reset=${encodeURIComponent(customers.resetToken(auth.customerKey, c, 24, 'a'))}`;
    const phone = String(c.phone || '').replace(/^0/, '20');
    res.json({ url, hours: 24, whatsapp: phone ? `https://wa.me/${phone}` : null });
  });

  // ---------- Coupons (admin) ----------
  // What a coupon gave: the discounts, and the shipping a free-shipping coupon waived (QA 25 Nov: it showed 0).
  const waivedOf = (o) => (o.coupon && o.coupon.freeShipping ? Number(o.coupon.shippingWaived != null ? o.coupon.shippingWaived : shippingFor(o.subtotal)) || 0 : 0);
  const couponRow = (c) => ({ ...c, uses: coupons.usesOf(store.listOrders(), c), discountGiven: accounting.round2(store.listOrders().filter((o) => coupons.usedOn(o, c)).reduce((n, o) => n + (o.discount || 0) + waivedOf(o), 0)) });
  /**
   * Products for the admin's pick lists (coupons, printing houses): archived products ("stop selling")
   * are left out, except ones still in use there (`keep`), marked `archived` so the screen can say so.
   */
  const adminProductList = (keep = new Set()) => PRODUCTS.filter((p) => p.status !== 'removed' || keep.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, category: p.category, ...(p.status === 'removed' ? { archived: true } : {}) }));
  app.get('/api/admin/coupons', requireAdmin, (req, res) => {
    const list = store.db.coupons || [];
    // A change to a coupon waiting for an owner: the row says so, so nobody presses it again (QA 25 Nov).
    const waiting = {};
    for (const a of approvalsAll()) {
      const m = a.status === 'pending' && /^\/api\/admin\/coupons\/([^/?#]+)/.exec(a.path || '');
      if (!m) continue;
      let cid;
      try { cid = decodeURIComponent(m[1]); } catch (e) { continue; }
      (waiting[cid] ||= []).push({ id: a.id, summary: a.summary, by: a.by ? a.by.name : null, at: a.at });
    }
    res.json({ coupons: list.map((c) => ({ ...couponRow(c), ...(waiting[c.id] ? { waiting: waiting[c.id] } : {}) })), products: adminProductList(new Set(list.flatMap((c) => c.products || []))), categories: CATEGORIES });
  });
  const saveCoupon = (req, id) => {
    // An edit sends only what changed (the form, or the list's pause switch): merged onto the coupon as it is now,
    // so a colleague's change made meanwhile stays (QA 25 Nov). A whole coupon, as before, works the same.
    const cur = id && (store.db.coupons || []).find((c) => c.id === id);
    if (id && !cur) throw new HttpError(404, 'couponGone');
    const input = cur && req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (({ id: x, createdAt, updatedAt, ...rest }) => rest)({ ...cur, ...req.body }) // eslint-disable-line no-unused-vars
      : req.body;
    const { coupon, error } = coupons.cleanCoupon(input, { products: PRODUCTS, categories: CATEGORIES, saved: cur || null });
    if (error) throw new HttpError(400, error);
    return store.mutate((db) => {
      db.coupons ||= [];
      couponClash(db.coupons, coupon.code, { id, was: cur ? cur.code : null });
      if (id) {
        const cur = db.coupons.find((c) => c.id === id);
        if (!cur) throw new HttpError(404, 'couponGone');
        for (const k of Object.keys(cur)) if (!['id', 'createdAt'].includes(k)) delete cur[k];
        return Object.assign(cur, coupon, { updatedAt: new Date().toISOString() });
      }
      if (db.coupons.length >= 500) throw new HttpError(400, 'couponValueBad');
      const c = { id: crypto.randomUUID(), ...coupon, createdAt: new Date().toISOString() };
      db.coupons.push(c);
      return c;
    });
  };
  app.post('/api/admin/coupons', requireAdmin, express.json(), (req, res) => res.status(201).json(couponRow(saveCoupon(req))));
  app.put('/api/admin/coupons/:id', requireAdmin, express.json(), (req, res) => res.json(couponRow(saveCoupon(req, req.params.id))));
  app.delete('/api/admin/coupons/:id', requireAdmin, (req, res) => {
    // (One already gone, deleted by someone else meanwhile: said, not "done". QA 26 Nov.)
    store.mutate((db) => {
      if (!(db.coupons || []).some((c) => c.id === req.params.id)) throw new HttpError(404, 'couponGone');
      db.coupons = db.coupons.filter((c) => c.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // ---------- Accounts: prices, costs, profit, expenses ----------
  const nameOf = (v) => pickEn(v);
  function pricingRow(p) {
    const d = accounting.defaultsFor(p.id);
    const c = (store.db.costs || {})[p.id] || {};
    const extra = p.extraSidePrice != null ? p.extraSidePrice : EXTRA_SIDE_PRICE;
    // (Unit cost and profit for the first regular pack, not a 1-copy one: those cost more per copy.)
    const ref = p.sizes.find((sz) => !sz.smallPack) || p.sizes[0];
    const unit = accounting.itemCostFrom(store.db.costs, { productId: p.id, size: ref, sides: [p.sides[0]] });
    return {
      id: p.id, name: p.name, category: p.category, kind: p.kind || 'product', sideCount: p.sides.length,
      basePrice: p.basePrice, extraSidePrice: extra,
      sizes: p.sizes.map((sz) => ({ id: sz.id, label: sz.label, surcharge: sz.surcharge || 0, costExtra: (c.sizes && c.sizes[sz.id]) || 0, ...(sz.smallPack ? { smallPack: true, ownPrice: Boolean(sz.ownPrice) } : {}), ...(sz.off ? { off: true } : {}) })),
      refSize: ref.id,
      defaults: d, costs: { blank: c.blank || 0, printFirst: c.printFirst || 0, printExtra: c.printExtra || 0, embroidery: c.embroidery || 0, other: c.other || 0 },
      // Embroidered products: a stitching cost per piece.
      embroidered: Boolean(p.embroidery),
      costsSet: Boolean(store.db.costs && store.db.costs[p.id]),
      unitCost: unit.total, unitProfit: accounting.round2(p.basePrice + (ref.surcharge || 0) - unit.total),
    };
  }
  // Archived products ("stop selling") are left out; their saved prices and costs stay in the data.
  app.get('/api/admin/pricing', requireAdmin, (req, res) => {
    res.json({ categories: CATEGORIES, products: PRODUCTS.filter((p) => p.status !== 'removed').map(pricingRow), settings: store.db.accountSettings || { shippingCost: 0 }, shippingCharged: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER });
  });
  app.put('/api/admin/pricing/:productId', requireAdmin, express.json(), (req, res) => {
    const product = getProduct(req.params.productId);
    if (!product) throw new HttpError(404, 'unknownProduct');
    // Selling prices are the owners': a cost change by finance keeps the prices as they are.
    // (A request with costs only, such as a finance person's cost change approved after they were made an owner,
    // changes the costs only: no price sent isn't "every price emptied". QA 25 Nov.)
    // (A held request being approved, kept with its costs only: it was a cost change by someone without the prices,
    // even when they've been made an owner since. Sent by an owner directly, costs alone still means "back to the
    // built-in prices" too.)
    const sentKeys = Object.keys(req.body || {});
    const costsOnly = sentKeys.length > 0 && sentKeys.every((k) => k === 'costs');
    const ownPrices = req.adminWho.perms.has('prices.edit') && !(req.adminWho.approvalId && costsOnly);
    const pr = ownPrices ? accounting.cleanPricing(product, req.body || {}) : { pricing: null };
    if (pr.error) throw new HttpError(400, pr.error);
    // (A held cost change carries only the boxes it changed: on top of the costs saved now.)
    let costsBody = (req.body || {}).costs || {};
    if (req.adminWho.approvalId && costsOnly && costsBody && typeof costsBody === 'object') {
      const raw = (store.db.costs || {})[product.id] || {};
      costsBody = { ...raw, ...costsBody, sizes: { ...(raw.sizes || {}), ...((costsBody.sizes && typeof costsBody.sizes === 'object') ? costsBody.sizes : {}) } };
    }
    const co = accounting.cleanCosts(product, costsBody);
    if (co.error) throw new HttpError(400, co.error);
    // (No costs sent: the saved ones stay; they're never wiped by a request about prices only.)
    const costsSent = (req.body || {}).costs !== undefined;
    // The activity log says what changed: the selling price old → new, the sizes' prices, the costs (QA 26 Nov: a
    // price change read "(costs)").
    const baseBefore = product.basePrice;
    const sizesBefore = JSON.stringify(product.sizes.map((z) => z.surcharge || 0));
    store.mutate((db) => {
      db.pricing ||= {};
      db.costs ||= {};
      if (!pr.pricing) { /* prices unchanged */ } else if (Object.keys(pr.pricing).length) db.pricing[product.id] = pr.pricing;
      else delete db.pricing[product.id];
      if (!costsSent) return;
      if (Object.keys(co.costs).length) db.costs[product.id] = co.costs;
      else delete db.costs[product.id];
    });
    accounting.applyPricing(PRODUCTS, store.db.pricing);
    const nm = nameOfProduct(product.id);
    const changed = (l) => [
      product.basePrice !== baseBefore ? (l === 'ar' ? `السعر ${moneyIn(baseBefore, l)} ← ${moneyIn(product.basePrice, l)}` : `price ${moneyIn(baseBefore, l)} → ${moneyIn(product.basePrice, l)}`) : '',
      JSON.stringify(product.sizes.map((z) => z.surcharge || 0)) !== sizesBefore ? (l === 'ar' ? 'أسعار المقاسات' : 'size prices') : '',
      costsSent ? (l === 'ar' ? 'التكاليف' : 'costs') : '',
    ].filter(Boolean).join(l === 'ar' ? '، ' : ', ');
    if (changed('en')) res.locals.summary = enAr(`${nm.en} (${changed('en')})`, `${nm.ar} (${changed('ar')})`);
    res.json(pricingRow(product));
  });
  app.put('/api/admin/accounts/settings', requireAdmin, express.json(), (req, res) => {
    const ship = accounting.money((req.body || {}).shippingCost);
    // (An empty box is not 0: the owner types 0 for free shipping.)
    if (ship === undefined || ship === null) throw new HttpError(400, 'badCost');
    const settings = store.mutate((db) => (db.accountSettings = { ...(db.accountSettings || {}), shippingCost: ship }));
    res.json(settings);
  });
  const reportFor = (req) => {
    const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    return accounting.report({ orders: store.listOrders(), costs: store.db.costs, expenses: store.db.expenses, settings: store.db.accountSettings, from: d(req.query.from), to: d(req.query.to) });
  };
  app.get('/api/admin/accounts', requireAdmin, (req, res) => res.json({ ...reportFor(req), categories: accounting.EXPENSE_CATEGORIES }));
  app.get('/api/admin/accounts.csv', requireAdmin, (req, res) => {
    const r = reportFor(req);
    res.set('Content-Disposition', `attachment; filename="accounts-${r.from || 'start'}-to-${r.to || 'today'}.csv"`);
    res.type('text/csv; charset=utf-8').send(accounting.reportCsv(r, nameOf, { lang: langOf(req) }));
  });
  // (Only a cost sent clears or sets it: a request without the field changed nothing but cleared the saved cost. An
  // explicit null or empty clears it, as the dashboard's emptied box does. QA 26 Nov.)
  const hasKey = (b, k) => Boolean(b) && typeof b === 'object' && !Array.isArray(b) && Object.prototype.hasOwnProperty.call(b, k);
  app.patch('/api/admin/items/:itemId/cost', requireAdmin, express.json(), (req, res) => {
    if (!hasKey(req.body, 'actualCost')) throw new HttpError(400, 'badCost');
    const v = accounting.money(req.body.actualCost);
    if (v === undefined) throw new HttpError(400, 'badCost');
    store.mutate(() => {
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      if (v === null) delete found.item.actualCost;
      else found.item.actualCost = v;
    });
    res.json({ ok: true });
  });
  app.patch('/api/admin/orders/:orderId/shipping-cost', requireAdmin, express.json(), (req, res) => {
    if (!hasKey(req.body, 'actualShipping')) throw new HttpError(400, 'badCost');
    const v = accounting.money(req.body.actualShipping);
    if (v === undefined) throw new HttpError(400, 'badCost');
    store.mutate(() => {
      const order = store.getOrder(req.params.orderId);
      if (!order) throw new HttpError(404, 'notFound');
      if (v === null) delete order.actualShipping;
      else order.actualShipping = v;
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/expenses', requireAdmin, express.json(), (req, res) => {
    const { expense, error } = accounting.cleanExpense(req.body || {});
    if (error) throw new HttpError(400, error);
    const created = store.mutate((db) => {
      db.expenses ||= [];
      if (db.expenses.length >= 5000) throw new HttpError(400, 'badCost');
      const e = { id: crypto.randomUUID(), ...expense, createdAt: new Date().toISOString() };
      db.expenses.push(e);
      return e;
    });
    res.status(201).json(created);
  });
  app.delete('/api/admin/expenses/:id', requireAdmin, (req, res) => {
    store.mutate((db) => {
      // (Already deleted: said so, e.g. a second approved request to delete it.)
      if (!(db.expenses || []).some((e) => e.id === req.params.id)) throw new HttpError(404, 'expenseGone');
      db.expenses = (db.expenses || []).filter((e) => e.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // ---------- Printing houses: who prints what, and sending them the job ----------
  // Read-only views; changes go through store.mutate (writing to store.db outside it loses data between copies).
  const houses = () => store.db.printHouses || [];
  const productHouses = () => store.db.productHouses || {};
  const findHouse = (id) => houses().find((h) => h.id === id) || null;
  // Formats made once per item (not once per side).
  const ONCE = new Set(['preview-pdf', 'book-pdf', 'booklet-pdf', 'booklet-imposed', 'source-pdf', 'proof', 'sheet-pdf', 'sheet-pdf-plain', 'repeat', 'dst', 'stitches', 'photos-zip', 'merge-pdf', 'merge-pdf-marks', 'merge-zip', 'merge-csv', 'merge-names-zip']);
  const SEND_FORMATS = new Set([...Object.keys(FORMATS), ...ONCE]);
  const FILE_LABELS = {
    pdf: t('Print PDF', 'ملف الطباعة PDF'), 'pdf-marks': t('Print PDF with crop marks', 'ملف الطباعة PDF بعلامات القص'), png: t('Print PNG (transparent)', 'ملف الطباعة PNG (خلفية شفافة)'), 'png-mirror': t('Print PNG (mirrored)', 'ملف الطباعة PNG (معكوس)'),
    tiff: t('Print TIFF (CMYK)', 'ملف الطباعة TIFF (CMYK)'), svg: t('Vector SVG', 'ملف فيكتور SVG'), 'dtf-film': t('DTF film PNG', 'فيلم DTF بصيغة PNG'), 'dtf-pdf': t('DTF film PDF', 'فيلم DTF بصيغة PDF'), 'dtg-white': t('DTG white underbase', 'طبقة الأبيض لطباعة DTG'),
    'laser-svg': t('Laser file for LightBurn (SVG)', 'ملف الليزر لـ LightBurn (SVG)'), 'engrave-png': t('Engraving bitmap (PNG)', 'صورة الحفر (PNG)'), 'cut-svg': t('Cut lines (SVG)', 'خطوط القص (SVG)'),
    'preview-pdf': t('Preview PDF (customer design)', 'معاينة PDF (تصميم العميل)'), repeat: t('Repeat preview (whole fabric piece)', 'معاينة التكرار (قطعة القماش كاملة)'), dst: t('Embroidery file (DST)', 'ملف التطريز (DST)'), stitches: t('Stitch preview', 'معاينة الغرز'), 'book-pdf': t('Book print PDF', 'ملف طباعة الكتاب PDF'), 'booklet-pdf': t('Booklet PDF (all pages in order)', 'الكتيب PDF (كل الصفحات بالترتيب)'), 'booklet-imposed': t('Booklet imposed for saddle stitching', 'الكتيب مترتب للطباعة والتدبيس'), 'source-pdf': t('Customer\'s original PDF', 'ملف الـ PDF الأصلي من العميل'), proof: t('Preview image', 'صورة المعاينة'), 'sheet-pdf': t('Gang sheet PDF (mirrored)', 'شيت DTF بصيغة PDF (معكوس)'), 'sheet-pdf-plain': t('Gang sheet PDF', 'شيت DTF بصيغة PDF'),
    'photos-zip': t('All photos (ZIP, a folder per size)', 'كل الصور (ZIP، فولدر لكل مقاس)'),
    'merge-pdf': t('All names (PDF, one page per copy)', 'كل الأسماء (PDF، صفحة لكل نسخة)'), 'merge-pdf-marks': t('All names (PDF with crop marks)', 'كل الأسماء (PDF بعلامات القص)'), 'merge-zip': t('One PDF per name (ZIP)', 'ملف PDF لكل اسم (ZIP)'), 'merge-csv': t('Names list (CSV)', 'قائمة الأسماء (CSV)'), 'merge-names-zip': t('Names only (ZIP of PNGs)', 'الأسماء بس (ZIP صور PNG)'),
  };

  app.get('/api/admin/houses', requireAdmin, (req, res) => {
    res.json({
      houses: houses(),
      productHouses: productHouses(),
      // Archived products only while a house is still set for them.
      products: adminProductList(new Set(Object.keys(productHouses()))),
      categories: CATEGORIES,
      email: notify.emailReady(),
    });
  });
  app.post('/api/admin/houses', requireAdmin, express.json(), (req, res) => {
    const { house, error } = dispatch.cleanHouse(req.body);
    if (error) throw new HttpError(400, error);
    const created = store.mutate(() => {
      if (houses().length >= 50) throw new HttpError(400, 'houseMany');
      const h = { id: crypto.randomUUID(), ...house, createdAt: new Date().toISOString() };
      (store.db.printHouses ||= []).push(h);
      return h;
    });
    res.status(201).json(created);
  });
  app.put('/api/admin/houses/:id', requireAdmin, express.json(), (req, res) => {
    const { house, error } = dispatch.cleanHouse(req.body);
    if (error) throw new HttpError(400, error);
    const updated = store.mutate(() => {
      const h = findHouse(req.params.id);
      if (!h) throw new HttpError(404, 'houseNotFound');
      return Object.assign(h, house);
    });
    res.json(updated);
  });
  app.delete('/api/admin/houses/:id', requireAdmin, (req, res) => {
    store.mutate((db) => {
      if (!houses().some((h) => h.id === req.params.id)) throw new HttpError(404, 'houseNotFound');
      db.printHouses = houses().filter((h) => h.id !== req.params.id);
      for (const [pid, hid] of Object.entries(productHouses())) if (hid === req.params.id) delete db.productHouses[pid];
    });
    res.json({ ok: true });
  });
  app.put('/api/admin/product-houses', requireAdmin, express.json(), (req, res) => {
    const { productId, houseId } = req.body || {};
    if (!getProduct(productId)) throw new HttpError(400, 'unknownProduct');
    if (houseId && !findHouse(houseId)) throw new HttpError(404, 'houseNotFound');
    store.mutate((db) => {
      db.productHouses ||= {};
      if (houseId) db.productHouses[productId] = houseId;
      else delete db.productHouses[productId];
    });
    res.json({ productHouses: productHouses() });
  });

  /** Send one item's files to a printing house by email or WhatsApp. */
  app.post('/api/admin/items/:itemId/send', requireAdmin, express.json(), async (req, res, next) => {
    try {
      const { houseId, channel, formats, note } = req.body || {};
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      const { order, item } = found;
      const house = findHouse(houseId);
      if (!house) throw new HttpError(404, 'houseNotFound');
      if (channel !== 'email' && channel !== 'whatsapp') throw new HttpError(400, 'houseChannel');
      if (channel === 'email' && !house.email) throw new HttpError(400, 'houseNoEmail');
      // Numbers saved before they were checked (e.g. a mobile without its 0): put right when sending.
      const wa = house.whatsapp ? dispatch.whatsappDigits(house.whatsapp) : null;
      if (channel === 'whatsapp' && !wa) throw new HttpError(400, house.whatsapp ? 'houseWhatsApp' : 'houseNoWhatsApp');
      if (channel === 'email' && !notify.emailReady()) throw new HttpError(400, 'emailOff');
      const wanted = [...new Set(Array.isArray(formats) ? formats.map(String) : [])].filter((f) => SEND_FORMATS.has(f));
      if (!wanted.length) throw new HttpError(400, 'houseNoFiles');
      const design = store.getDesign(item.designId);
      if (!design) throw new HttpError(404, 'notFound');
      // Only what the customer approved goes to a printing house (not while a corrected file is being saved, nor
      // a job waiting for review or the customer's approval). QA 25 Nov.
      if (replacingItems.has(item.id)) throw new HttpError(409, 'fileBeingReplaced');
      if (REVIEW_STATUSES.includes(item.status) || !approvedFilesMatch(item, design)) throw new HttpError(409, 'notApproved');
      const lang = req.get('x-lang') === 'en' ? 'en' : 'ar';
      const siteUrl = notify.siteUrl() || `${req.protocol}://${req.get('host')}`;

      // Make every file now, so problems show up here and not at the printing house.
      const files = [];
      let expires = '';
      for (const format of wanted) {
        // Embroidered chest with a printed back: stitches for the stitched side, film for the printed ones.
        const embSide = embSideOf(design);
        // Print files skip the stitched layer when there's something printed too; it goes as DST.
        const printed = design.sides.map((sd) => sd.id).filter((id) => id !== embSide);
        const sideIds = ['dst', 'stitches'].includes(format) ? [embSide].filter(Boolean)
          : ONCE.has(format) ? [design.sides[0].id]
            : embSide && printed.length ? printed
              : design.sides.map((sd) => sd.id);
        for (const sideId of sideIds) {
          let f;
          try {
            f = await makeFile(design, sideId, format);
          } catch (e) {
            // A side without a vector file (e.g. a photo-only side): send the others.
            if (format === 'svg' && e.status === 404) continue;
            throw e;
          }
          const link = dispatch.signLink(auth.linkKey, { designId: design.id, side: sideId, format });
          expires = link.expires;
          // (A booklet's "صفحة 2" in the Arabic message: Arabic digits, as in its print-areas line. QA 26 Nov.)
          const sideName = (design.sides.find((sd) => sd.id === sideId).name || {})[lang] || pickEn(design.sides.find((sd) => sd.id === sideId).name);
          const sideLabel = !ONCE.has(format) && design.sides.length > 1 ? ` · ${lang === 'ar' ? i18n.arabicDigits(sideName) : sideName}` : '';
          files.push({ format, side: sideId, name: f.name, path: f.path, size: fs.statSync(f.path).size, label: `${FILE_LABELS[format] ? FILE_LABELS[format][lang] : format}${sideLabel}`, url: `${siteUrl}/dl/${link.token}` });
        }
      }
      if (!files.length) throw new HttpError(400, 'houseNoFiles');
      const view = adminItem(order, item, order.items.indexOf(item));
      const msg = { house, order, item: view, design, files, note: String(note || '').trim().slice(0, 500), lang, expires };
      let result;
      if (channel === 'email') {
        // Attach the files when they fit comfortably in an email; the links are always there too.
        const total = files.reduce((n, f) => n + f.size, 0);
        const attach = total <= 10 * 1024 * 1024;
        const body = dispatch.emailBody({ ...msg, attached: attach });
        try {
          await notify.emailTo(house.email, body.subject, body.html, body.text, attach ? files.map((f) => ({ name: f.name, data: fs.readFileSync(f.path) })) : []);
        } catch (e) {
          console.warn(`[houses] email to ${house.name} failed: ${e.message}`);
          throw new HttpError(502, 'houseEmailFailed');
        }
        result = { status: 'sent', attached: attach };
      } else {
        const text = dispatch.whatsappText(msg);
        result = { status: 'opened', whatsappUrl: `https://wa.me/${wa}?text=${encodeURIComponent(text)}` };
      }
      const record = {
        id: crypto.randomUUID(), houseId: house.id, houseName: house.name, channel,
        to: channel === 'email' ? house.email : `+${wa}`, files: files.map((f) => f.label), at: new Date().toISOString(), status: result.status,
      };
      store.mutate(() => {
        item.sends = [...(item.sends || []), record].slice(-20);
      });
      res.json({ ...result, send: record, item: adminItem(order, item, order.items.indexOf(item)) });
    } catch (e) {
      next(e);
    }
  });

  // Download links in the messages to printing houses (signed, expire after 30 days).
  app.get('/dl/:token', async (req, res, next) => {
    try {
      rateLimit(req, 'downloads');
      const link = dispatch.readLink(auth.linkKey, req.params.token);
      if (!link) throw new HttpError(404, 'linkExpired');
      const design = UUID_RE.test(link.designId) && store.getDesign(link.designId);
      if (!design || !design.orderId) throw new HttpError(404, 'linkExpired');
      const f = await makeFile(design, link.side, link.format);
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Robots-Tag', 'noindex');
      res.download(f.path, f.name);
    } catch (e) {
      next(e);
    }
  });

  // ---------- DTF film: nest several orders onto one roll ----------
  const dtfOpen = () => {
    const list = [];
    for (const order of store.listOrders()) {
      order.items.forEach((item, i) => {
        const method = item.process || getProduct(item.productId)?.process;
        if (item.kind === 'gangsheet' || !(item.status === 'queued' || item.status === 'printing')) return;
        if (method === 'dtf') return list.push(adminItem(order, item, i));
        // Embroidered chest with a DTF-printed back: on the film with its printed sides only.
        const a = adminItem(order, item, i);
        const film = (a.sides || []).filter((sd) => sd.process === 'dtf');
        if (film.length) list.push({ ...a, sides: film });
      });
    }
    return list.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
  };
  app.get('/api/admin/dtf-items', requireAdmin, (req, res) => res.json({ items: dtfOpen(), rollWidthIn: 22 }));
  app.post('/api/admin/dtf-film', requireAdmin, express.json(), async (req, res, next) => {
    let filmHeld = [];
    try {
      const ids = Array.isArray(req.body && req.body.itemIds) ? req.body.itemIds : [];
      const chosen = dtfOpen().filter((i) => ids.includes(i.id));
      if (!chosen.length) throw new HttpError(400, 'itemNotFound');
      // Only what the customer approved goes on a film: not a job whose corrected file is being saved, nor one whose
      // files are no longer the approved ones. QA 25 Nov.
      for (const it of chosen) {
        if (replacingItems.has(it.id) || filmMaking.has(it.id)) throw new HttpError(409, replacingItems.has(it.id) ? 'fileBeingReplaced' : 'filmBeingMade');
        const f = store.findItem(it.id);
        const dz = f && store.getDesign(f.item.designId);
        if (!f || !dz || !approvedFilesMatch(f.item, dz)) throw new HttpError(409, 'notApproved');
      }
      // (While the film is made, its jobs can't be sent back to Review: one sent back meanwhile stayed on it. QA 25 Nov.)
      for (const it of chosen) filmMaking.add(it.id);
      filmHeld = chosen.map((it) => it.id);
      const pieces = [];
      for (const it of chosen) {
        // Name lists: one transfer per row, each with that row's name (background + the row's picture).
        const design = it.merge && store.getDesign(it.designId);
        if (design && design.merge) {
          const lays = await merge.layers(design, (n) => fs.readFileSync(store.designFile(design.id, n)), { keepAlpha: true });
          const list = readMergeList(design);
          for (const lay of lays) {
            const sd = lay.side;
            for (let r = 0; r < design.merge.count; r++) {
              let png = lay.base;
              if (lay.overlays && lay.overlays[r]) {
                // The row's picture goes in its box (print pixels), as in the name-list PDF.
                const bx = lay.box;
                const name = await sharp()(lay.overlays[r]).resize(Math.max(1, Math.round(bx.w)), Math.max(1, Math.round(bx.h)), { fit: 'fill' }).png().toBuffer();
                png = await sharp()(lay.base, { limitInputPixels: 130e6 }).composite([{ input: name, left: Math.round(bx.x), top: Math.round(bx.y) }]).png().toBuffer();
              }
              // Film labels use a Latin font: Latin text only, plus the row's size so each name goes on the right garment.
              const row = (list && list.rows[r]) || [];
              const vc = design.merge.variantCols || {};
              const size = vc.size >= 0 ? row[vc.size] : pickEn(it.size.label);
              const who = [row.filter((v, k) => v && k !== vc.size && k !== vc.color).slice(0, 2).join(' / ').replace(/[^\x20-\x7e]+/g, '').trim(), size && `size ${String(size).replace(/[^\x20-\x7e]+/g, '')}`].filter(Boolean).join(' · ');
              pieces.push({
                png,
                widthIn: sd.widthIn + 2 * (sd.bleedIn || 0),
                heightIn: sd.heightIn + 2 * (sd.bleedIn || 0),
                label: `${it.orderNumber} #${it.position} · ${pickEn(it.productName)} · ${pickEn(sd.name)} · ${r + 1}/${design.merge.count}${who ? ` ${who}` : ''}`.slice(0, 120),
              });
            }
          }
          continue;
        }
        // One transfer per piece: an item of several sizes / colours gets one per piece, labelled with its size.
        const lines = Array.isArray(it.quantities) && it.quantities.length ? it.quantities.map((l) => ({ label: [pickEn(l.color && l.color.name), pickEn(l.size.label)].filter(Boolean).join(' '), qty: l.qty })) : [{ label: pickEn(it.size.label), qty: 1 }];
        for (const sd of it.sides) {
          if (sd.process === 'embroidery') continue; // stitched, not printed
          const png = fs.readFileSync(store.designFile(it.designId, `${sd.id}-print.png`));
          for (const line of lines) {
            for (let k = 0; k < line.qty; k++) {
              pieces.push({
                png,
                widthIn: sd.widthIn + 2 * (sd.bleedIn || 0),
                heightIn: sd.heightIn + 2 * (sd.bleedIn || 0),
                label: `${it.orderNumber} #${it.position} · ${pickEn(it.productName)} · ${pickEn(sd.name)} · ${line.label}`,
              });
            }
          }
        }
      }
      const film = await printfiles.filmPdf(pieces, { title: 'DTF film' });
      const at = new Date().toISOString();
      // Number the film under the lock, so two copies never hand out the same number.
      const batchId = store.mutate((db) => {
        // A job that left the queue meanwhile (sent back, printed elsewhere, on this copy or another: checked with the
        // latest data, QA 26 Nov): the film isn't given out.
        for (const it of chosen) {
          const f = store.findItem(it.id);
          if (!f || !['queued', 'printing'].includes(f.item.status)) throw new HttpError(409, 'filmItemChanged');
        }
        const id = `F${(db.nextFilmNumber = (db.nextFilmNumber || 0) + 1)}`;
        for (const it of chosen) {
          const found = store.findItem(it.id);
          // (Still waiting to print or on the press: one sent back to Review meanwhile isn't marked as on this film.)
          if (found && ['queued', 'printing'].includes(found.item.status)) found.item.filmBatch = { id, at };
        }
        return id;
      });
      res.set('X-Film-Length-In', film.lengthIn.toFixed(2));
      res.set('X-Film-Batch', batchId);
      res.set('Access-Control-Expose-Headers', 'X-Film-Length-In, X-Film-Batch');
      res.type('pdf').attachment(`dtf-film-${batchId}.pdf`).send(film.pdf);
    } catch (e) {
      next(e);
    } finally {
      for (const id of filmHeld) filmMaking.delete(id);
    }
  });

  // ---------- Static site ----------
  app.use('/fonts', express.static(path.join(__dirname, '..', 'public', 'fonts'), { maxAge: '30d', immutable: true }));
  // The installed app's worker (public/sw.js): always checked for a newer copy, and with a policy a worker can run
  // under (the files' own one is sandboxed, which a service worker can't be). It only fetches from this shop.
  const swFile = path.join(__dirname, '..', 'public', 'sw.js');
  app.get('/sw.js', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
    res.type('application/javascript').send(fs.readFileSync(swFile));
  });
  // ---------- The phone apps (branch mobile-apps, folder mobile/): what Google, Apple and the apps read here ----------
  // (Open while the shop is private, see src/preview.js. Owner's OK, 26 Nov.)
  const APP_ID = 'me.ebda3.app';
  // Android: order, proof and share links tapped in WhatsApp open in the app. The signing keys' fingerprints come from
  // APP_ANDROID_SHA256 (comma-separated, "AA:BB:…"); until it is set, not found.
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const prints = String(process.env.APP_ANDROID_SHA256 || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
    if (!prints.length) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: [...new Set(prints)] } }]);
  });
  // iPhone: the same (universal links), for the Apple team in APP_APPLE_TEAM_ID; the dashboard, the API, sign-in and
  // files stay in the browser. Until it is set, not found.
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const team = String(process.env.APP_APPLE_TEAM_ID || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(team)) throw new HttpError(404, 'notFound');
    const components = [...['/admin*', '/api/*', '/auth/*', '/files/*', '/dl/*'].map((x) => ({ '/': x, exclude: true })), { '/': '/*' }];
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').send(JSON.stringify({ applinks: { details: [{ appIDs: [`${team}.${APP_ID}`], components }] } }));
  });
  // The apps' settings, so the shop can ask for an update or switch an app feature on without a new app version:
  // the defaults here, with what DATA_DIR/app-config.json says on top (every field optional; anything else ignored).
  const APP_CONFIG_FILE = path.join(dataDir, 'app-config.json');
  const appBuild = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 99999999 ? v : fallback);
  const appUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s"<>]{4,300}$/.test(v) ? v : null);
  function appConfig() {
    let own = {};
    try { own = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, 'utf8')) || {}; } catch (e) { /* none yet, or unreadable: the defaults */ }
    const side = (k, store) => {
      const o = own[k] && typeof own[k] === 'object' ? own[k] : {};
      const url = appUrl(o.storeUrl) || store;
      // (The latest build is never below the oldest one allowed: the apps would be sent to update to a build the store
      // doesn't have. QA 26 Nov.)
      const minBuild = appBuild(o.minBuild, 10000);
      return { minBuild, latestBuild: Math.max(minBuild, appBuild(o.latestBuild, 10000)), ...(url ? { storeUrl: url } : {}) };
    };
    const msg = own.message && typeof own.message === 'object' ? own.message : null;
    const text = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '');
    const f = own.features && typeof own.features === 'object' ? own.features : {};
    const social = f.socialLogin && typeof f.socialLogin === 'object' ? f.socialLogin : {};
    const hosts = Array.isArray(own.inAppHosts) ? own.inAppHosts.map((h) => String(h).toLowerCase().trim()).filter((h) => /^(?=.{3,100}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h)).slice(0, 10) : [];
    return {
      android: side('android', `https://play.google.com/store/apps/details?id=${APP_ID}`),
      ios: side('ios', appUrl(process.env.APP_IOS_STORE_URL)),
      ...(msg && (text(msg.ar) || text(msg.en)) ? { message: { ar: text(msg.ar) || text(msg.en), en: text(msg.en) || text(msg.ar) } } : {}),
      features: { push: f.push === true, socialLogin: { android: social.android === true, ios: social.ios === true } },
      inAppHosts: hosts,
    };
  }
  app.get('/app/config.json', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(appConfig());
  });
  // The manifest: checked again too (a changed name or icon reaches installed apps), read as a web manifest.
  app.get('/site.webmanifest', (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json');
    next();
  });
  // Pages are served with every script and stylesheet URL stamped with a
  // version (a hash of the site's files), so after a deploy no browser or CDN
  // cache can mix old and new code. Pages themselves are never cached.
  const publicDir = path.join(__dirname, '..', 'public');
  const assetVersion = siteVersion(publicDir);
  const pages = new Map();
  // The shop's pages, listed once: an address that isn't one of them is never looked up or kept (any made-up
  // address used to be remembered, so endless made-up addresses could fill the server's memory; QA 25 Nov).
  const pageNames = new Set(fs.readdirSync(publicDir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)));
  const pageFor = (name) => {
    if (!pageNames.has(name)) return null;
    if (!pages.has(name)) {
      const file = path.join(publicDir, name + '.html');
      const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (!html) return null;
      pages.set(name, html && html.replace(/((?:src|href)=")(\/(?:js|css|vendor|fonts)\/[^"?#]+\.(?:js|css))"/g, `$1$2?v=${assetVersion}"`));
      if (html) pageCsp.set(name, security.pageCsp(html, { captcha: Boolean(captcha) && CAPTCHA_PAGES.has(name) }));
    }
    return pages.get(name);
  };
  const pageCsp = new Map();
  // Pages with a CAPTCHA widget may load Cloudflare's script and frame.
  const CAPTCHA_PAGES = new Set(['cart', 'account']);
  const sendPage = (res, name, html) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Content-Security-Policy', pageCsp.get(name));
    res.type('html').send(html);
  };
  // ---------- Link previews (WhatsApp, Facebook) ----------
  // A shared design, a product, a ready design or a kids book previews as itself (its name and picture), not as
  // the shop's general card: the page's own og:/twitter: tags are replaced (QA 25 Nov).
  const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function withPreview(html, { title, description, image, url }) {
    const tags = [
      `<meta property="og:title" content="${escAttr(title)}">`,
      `<meta property="og:description" content="${escAttr(description)}">`,
      `<meta property="og:image" content="${escAttr(image)}">`,
      `<meta property="og:url" content="${escAttr(url)}">`,
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n  ');
    // (Functions, not strings, as replacements: a name with "$'" or "$&" stays as typed, QA 25 Nov.)
    return html
      .replace(/[ \t]*<meta (?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/g, '')
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escAttr(title)}</title>`)
      .replace('</head>', () => `  ${tags}\n</head>`);
  }
  const both = (t) => (t && typeof t === 'object' ? [t.ar, t.en].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') : String(t || ''));
  /** The preview of /product, /design or /book for its id, or null (the general card). */
  function previewFor(name, req) {
    const origin = linkBase(req);
    const thumb = (productId, colorId) => {
      const p = getProduct(productId);
      const c = p && (p.colors.find((x) => x.id === colorId) || p.colors[0]);
      return c ? `${origin}/api/thumbs/${p.id}/${c.id}.webp` : `${origin}/img/og-ebda3.png`;
    };
    if (name === 'product') {
      const p = getProduct(String(req.query.id || ''));
      if (!p || !catalog.visible(p)) return null;
      return { title: `${both(p.name)} · إبداع`, description: both(p.description), image: thumb(p.id), url: `${origin}/product?id=${encodeURIComponent(p.id)}` };
    }
    if (name === 'design') {
      const d = library.shown(String(req.query.id || ''));
      if (!d) return null;
      // A picture of the design itself when the shop has one; else the shop's card (never a blank product, which
      // would look like the design is missing, QA 25 Nov).
      // (The shop's own picture designs: their artwork, a PNG or JPG in the shop's files. Shown only as the logo
      // before. Tester 1, 26 Nov.)
      const art = d.kind === 'template' && (d.items || []).find((i) => i && i.kind === 'image' && /^\/img\/art\/[\w/-]+\.(png|jpe?g|webp)$/i.test(i.src || '')
        && fs.existsSync(path.join(publicDir, i.src)));
      const image = d.uploaded ? `${origin}/library-art/${d.id}/web.png` : d.kind === 'objects' && fs.existsSync(library.previewPath(d.id)) ? `${origin}/api/library/${d.id}/preview.png`
        // (Its 1200 px copy, as the product pages' pictures: the original artwork is up to 2.4 MB, and WhatsApp drops
        // preview pictures much over 300 KB. Tester 1, 26 Nov.)
        : art ? `${origin}${art.src.replace(/^\/img\/art\//, '/img-w/1200/art/')}` : `${origin}/img/og-ebda3.png`;
      return { title: `${both(d.name)} · إبداع`, description: 'تصميم جاهز تطبعه على منتجك، أو تعدّله على ذوقك · A ready design to print as it is, or make it yours', image, url: `${origin}/design?id=${encodeURIComponent(d.id)}` };
    }
    if (name === 'book') {
      const b = bookFor(String(req.query.b || ''));
      if (!b) return null;
      // The title's {name} is the child's: "Your child" until it's theirs.
      const named = (t) => (t && typeof t === 'object' ? { ar: String(t.ar || '').replace(/\{name\}/g, 'طفلك'), en: String(t.en || '').replace(/\{name\}('s)?/g, (m, s) => (s ? 'Your child\'s' : 'Your child')) } : t);
      return { title: `${both(named(b.title))} · إبداع`, description: both(named(b.blurb)), image: `${origin}/api/books/${b.id}/sample/0.jpg`, url: `${origin}/book?b=${encodeURIComponent(b.id)}` };
    }
    return null;
  }
  // Short share links: the share page with the shared design as its preview.
  app.get('/s/:id', (req, res, next) => {
    const sh = readShare(req.params.id);
    const html = pageFor('share');
    if (!html) return next();
    // An old or wrong link: the share page itself says the design wasn't found.
    if (!sh) return sendPage(res.status(404), 'share', html);
    const product = getProduct(sh.productId);
    // The shop's own address (never whatever Host header the request came with).
    const origin = linkBase(req);
    sendPage(res, 'share', withPreview(html, {
      title: `${product ? both(product.name) : 'تصميم · Design'} · إبداع`,
      description: 'شوف تصميمي وقولي رأيك · What do you think of my design?',
      image: `${origin}/api/shares/${sh.id}/preview/${sh.sides[0].id}.png`,
      url: `${origin}/s/${sh.id}`,
    }));
  });
  app.get(/^\/(?:([a-z0-9-]+)(?:\.html)?)?$/, (req, res, next) => {
    const name = req.params[0] || 'index';
    // The money-back guarantee's page is there only while the shop takes payment in advance (src/payment-wording.js;
    // owner's decision, 26 Nov): otherwise it is not found, like any unknown address (and never served as a file).
    if (name === 'guarantee' && !PAYMENT.prepayOnly) return notFound(req, res, () => res.status(404).end());
    const html = pageFor(name);
    if (!html) return next();
    const preview = (name === 'product' || name === 'design' || name === 'book') && previewFor(name, req);
    sendPage(res, name, preview ? withPreview(html, preview) : html);
  });
  app.use(express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, file) {
      if (/\.(js|css)$/.test(file)) {
        // Versioned URLs never change; unversioned ones (ES module imports) revalidate.
        res.set('Cache-Control', res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
      } else if (/[\\/]mockups[\\/]/.test(file)) {
        // The photo and its mask must arrive exactly as stored (no CDN resizing or recompression).
        res.set('Cache-Control', 'public, max-age=3600, no-transform');
      } else if (/[\\/]img[\\/]art[\\/]/.test(file) || /[\\/]img[\\/]og-ebda3\.png$/.test(file)) {
        // The ready designs' artwork goes into print files exactly as stored: the hosting's CDN shrank pictures
        // for phones (a 3598 px design arrived 800 px wide, 68 DPI on a T-shirt, and printed blurred: owner, 26 Nov).
        // (The link-preview picture too: public, so the live site can be checked from outside.)
        res.set('Cache-Control', 'public, max-age=3600, no-transform');
      }
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: format('notFound', {}, langOf(req)) }));
  // Any other unknown address: the shop's own "page not found" page.
  function notFound(req, res, next) {
    // (While private, a stranger asking for a missing file gets "Opening soon", not the shop's own 404.)
    if (previewOn() && !previewWho(req)) return previewClosed(req, res);
    const html = (req.method === 'GET' || req.method === 'HEAD') && req.accepts('html') && pageFor('404');
    if (!html) return next();
    sendPage(res.status(404), '404', html);
  }
  app.use(notFound);

  // ---------- Housekeeping ----------
  // Unordered designs (abandoned carts) and old share links are removed so
  // the disk cannot fill up. Ordered designs are kept.
  const runCleanup = () => {
    try {
      // Design uploads (admin) left unpublished for 14 days.
      try {
        const oldBatch = Date.now() - 14 * 864e5;
        for (const f of fs.readdirSync(path.join(dataDir, 'library', 'uploads'))) {
          const dir = path.join(dataDir, 'library', 'uploads', f);
          if (!/^[0-9a-f]{20}$/.test(f)) continue;
          if (fs.statSync(dir).mtimeMs < oldBatch) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
          // An upload stopped half way (nothing sent for a day) goes too.
          let open = false;
          try { open = JSON.parse(fs.readFileSync(path.join(dir, 'batch.json'), 'utf8')).status === 'uploading'; } catch (e) { open = false; }
          if (open && fs.statSync(path.join(dir, 'upload.zip')).mtimeMs < Date.now() - 864e5) fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (e) { /* none yet */ }
      // Uploaded booklet PDFs not used within 45 days (designs keep their own copy).
      try {
        const old = Date.now() - 45 * 864e5;
        for (const f of fs.readdirSync(pdfUploadsDir)) {
          const file = path.join(pdfUploadsDir, f);
          if (fs.statSync(file).mtimeMs < old) fs.rmSync(file, { force: true });
        }
      } catch (e) { /* no uploads yet */ }
      // Children's photos in books: removed 30 days after the book was shipped.
      const monthAgo = Date.now() - 30 * 864e5;
      const due = store.mutate((db) => {
        const ids = [];
        for (const order of db.orders) {
          for (const item of order.items) {
            if (item.kind !== 'book' || item.status !== 'shipped') continue;
            const shipped = (item.history || []).find((h) => h.status === 'shipped');
            const design = db.designs[item.designId];
            if (!design || design.photoRemoved || !shipped || Date.parse(shipped.at) > monthAgo) continue;
            design.photoRemoved = true;
            ids.push(design.id);
          }
        }
        return ids;
      });
      // Everything made from the photo goes: the photo, the drawn face, the redrawn pages, the cover and the PDFs.
      for (const id of due) {
        let files = [];
        try { files = fs.readdirSync(store.designDir(id)); } catch (e) { files = []; }
        for (const f of files) {
          if (/^(face.*|redraw-\d+\.jpg|book-.*\.(pdf|png))$/.test(f)) fs.rmSync(store.designFile(id, f), { force: true });
        }
      }
      if (due.length) console.log(`[cleanup] removed the child's photo from ${due.length} shipped book(s)`);
      const goneViews = views.cleanup();
      if (goneViews) console.log(`[cleanup] removed ${goneViews} view-only link(s) not updated for 60 days`);
      return security.cleanup({ store, sharesDir });
    } catch (e) {
      console.error('[cleanup]', e.message);
      return null;
    }
  };
  app.locals.cleanup = runCleanup;
  app.locals.auth = auth;
  app.locals.store = store;
  if (cleanupEvery) {
    setTimeout(runCleanup, 60e3).unref();
    setInterval(runCleanup, cleanupEvery).unref();
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const lang = langOf(req);
    // A field sent as an object where text belongs ({"login": {"toString": 1}}) can't be turned into text: the request
    // is wrong, not the server (QA 26 Nov: a 500 from sign-in, password reset, the cart quote, shares, name lists...).
    if (err instanceof TypeError && /Cannot convert object to primitive value/.test(err.message || '')) err = Object.assign(new HttpError(400, 'badRequest'), { cause: err });
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    let key = err.key;
    // Errors without a message of ours (bad JSON, a missing file...): a translated general message,
    // never the raw text (it can hold server paths).
    if (!key) key = err.type === 'entity.too.large' ? 'uploadTooLarge' : status >= 500 ? 'serverError' : status === 404 ? 'notFound' : status === 429 ? 'tooFast' : 'badRequest';
    const message = format(key, err.params || {}, lang);
    // The field the admin's product screen should point at (admin → Products).
    const field = err.params && typeof err.params.field === 'string' && err.params.field ? { field: err.params.field } : {};
    // (An approved change run again: both languages of the reason, so the owner and the person each read their own.)
    // (A product field by its name in each language, not its code.)
    const named = (l) => {
      const f = err.params && typeof err.params.field === 'string' && OWNER_FIELD_NAMES[err.params.field];
      return f ? { ...err.params, field: f[l] } : err.params || {};
    };
    const both = req.adminWho && req.adminWho.approvalId ? { errorText: { en: format(key, named('en'), 'en'), ar: format(key, named('ar'), 'ar') } } : {};
    res.status(status).json({ error: message, code: key || undefined, ...field, ...both });
  });

  return app;
}

module.exports = { createApp, ITEM_STATUSES };
