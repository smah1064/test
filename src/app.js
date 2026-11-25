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
  printWidthFor,
  printHeightFor,
  REPEATS,
  matchSize,
  matchColor,
  variantColumns,
  pageSides,
} = require('./products');
const { GOVERNORATES, normalizeEgyptMobile } = require('./egypt');
const { FIELDS, langOf, format } = require('./i18n');
// Loaded on first use: the shop keeps working even if the image library cannot load on a server.
const thumbs = require('./thumbs');
const ai = require('./ai');
const notify = require('./notify');
const dispatch = require('./dispatch');
const accounting = require('./accounting');
const bgremove = require('./bgremove');
const coupons = require('./coupons');
const customers = require('./customers');
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
const { Library, CATEGORIES: DESIGN_CATEGORIES, catalogChanged: libraryCatalogChanged, hasArtwork } = require('./library');
const preview = require('./preview');
// Zip uploads of designs (admin): loaded when first used.
let designUploadMod = null;
const designUpload = new Proxy({}, { get: (t, k) => (designUploadMod ||= require('./design-upload'))[k] });
const security = require('./security');
const books = require('./books');
const cartoon = require('./cartoon');
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

function cleanString(value, field, { max = 200, required = true } = {}) {
  // Invisible characters (zero-width, direction marks pasted from phones) don't count as text.
  const s = typeof value === 'string' ? value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim() : '';
  if (required && !s) throw new HttpError(400, 'fieldRequired', { field: FIELDS[field] });
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
    quantities: item.quantities || null,
    approval: item.approval || null,
    approvals: item.approvals || [],
    review: item.review ? { needed: item.review.needed, reasons: item.review.reasons, status: item.review.status, note: item.review.note || null } : null,
    preflight: item.preflight ? { status: item.preflight.status, checks: item.preflight.checks } : null,
    // The order id is the customer's key: a waiting proof can be opened from the order page.
    proofUrl: item.status === 'awaiting_approval' && item.proofToken ? `/proof?t=${item.proofToken}` : null,
    merge: item.merge ? { count: item.merge.count, columns: item.merge.columns } : null,
  };
}

function publicOrder(order) {
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
    shop: shopInfo(),
    invoice: { number: `INV-${order.number}`, issuedAt: order.createdAt },
  };
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
/** The shop's own details, for invoices and the tracking page. */
function shopInfo() {
  return {
    name: { en: 'ebda3', ar: 'إبداع' },
    url: notify.siteUrl() || null,
    whatsapp: notify.shopWhatsApp() || null,
    email: process.env.MAIL_FROM || null,
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

/** Per-visitor limits; tests and special setups can override them. */
const DEFAULT_LIMITS = {
  designs: [{ max: 30, ms: 10 * 60e3 }, { max: 200, ms: 24 * 3600e3 }],
  designsAll: [{ max: 3000, ms: 24 * 3600e3 }],
  orders: [{ max: 5, ms: 10 * 60e3 }, { max: 20, ms: 24 * 3600e3 }],
  shares: [{ max: 10, ms: 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  // AI cartoon faces for book previews (one image each): per visitor and for the whole shop.
  cartoon: [{ max: Number(process.env.CARTOON_DAILY_LIMIT) || 4, ms: 24 * 3600e3 }],
  cartoonAll: [{ max: Number(process.env.CARTOON_GLOBAL_DAILY_LIMIT) || 150, ms: 24 * 3600e3 }],
  // AI page redraws after orders (about 12-15 per book), for the whole shop.
  redrawAll: [{ max: Number(process.env.REDRAW_DAILY_PAGES) || 450, ms: 24 * 3600e3 }],
  // WhatsApp/email alerts for the whole shop, so fake orders cannot flood the owner's phone.
  notify: [{ max: 30, ms: 3600e3 }, { max: 200, ms: 24 * 3600e3 }],
  couponTry: [{ max: 15, ms: 10 * 60e3 }, { max: 60, ms: 24 * 3600e3 }], // coupon codes that didn't work, per visitor
  previewCode: [{ max: 10, ms: 15 * 60e3 }, { max: 40, ms: 24 * 3600e3 }], // private-preview codes that didn't work, per visitor
  designZip: [{ max: 20, ms: 3600e3 }, { max: 100, ms: 24 * 3600e3 }], // design zips uploaded in the admin
  notifyCustomer: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }], // order confirmations to one email address
  notifyCustomerAll: [{ max: 500, ms: 24 * 3600e3 }],
  // Illustrator / EPS files turned into pictures for the editor.
  artwork: [{ max: 15, ms: 10 * 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  mergeParse: [{ max: 30, ms: 10 * 60e3 }, { max: 150, ms: 24 * 3600e3 }],
  reorder: [{ max: 20, ms: 10 * 60e3 }, { max: 100, ms: 24 * 3600e3 }],
  reorderOrder: [{ max: 3, ms: 3600e3 }, { max: 6, ms: 24 * 3600e3 }], // per order
  reorderMB: 8000, // megabytes of files copied by "Order again", the whole shop, per day
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

function createApp({ dataDir, adminPassword, limits = {}, cleanupEvery = 6 * 3600e3, oauthConfig = {}, oauthFetch, importGet, requireApproval = true, captcha = captchaMod.fromEnv(), captchaFetch, libraryOnce = [], previewStart = false }) {
  if (!adminPassword) throw new Error('adminPassword is required');
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
      categories: CATEGORIES,
      governorates: GOVERNORATES,
      contact: { whatsapp: notify.shopWhatsApp() || null },
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
  async function proofFor(d) {
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
        artworkUrl: d.kind === 'gangsheet' ? `/files/designs/${d.id}/front-preview.png` : `/files/designs/${d.id}/${sd.id}-proof.png?v=${d.version || 1}`,
        previewUrl: d.kind === 'book' ? `/files/designs/${d.id}/book-preview.png?v=${d.version || 0}`
          : d.replaced && d.replaced[sd.id] ? null : `/files/designs/${d.id}/${sd.id}-preview.png`,
      };
    };
    return {
      designId: d.id,
      version: d.version || 1,
      proofHash: proofHashOf(d),
      product: product ? { id: product.id, name: product.name, ...(product.colorLabel ? { colorLabel: product.colorLabel } : {}) } : { id: d.productId, name: d.productName },
      color: d.color, size: d.size, quantities: d.quantities || null, copies: copiesOf(d),
      method: d.method || 'print', process: d.process || (product && product.process) || null,
      ...(embSideOf(d) ? { embSide: embSideOf(d) } : {}),
      sides: d.kind === 'book' ? [] : d.sides.map(side),
      ...(d.kind === 'book' ? { pages: bookFor(d.bookId).pages.map((_, i) => `/api/books/designs/${d.id}/pages/${i}.jpg?v=${d.version || 0}`) } : {}),
      ...(list ? { merge: { count: d.merge.count, columns: list.columns, sample: list.rows.slice(0, 3) } } : {}),
      ...(d.kind === 'photoset' ? { photos: d.photos.map((p) => ({ n: p.n, size: p.size, copies: p.copies, orientation: p.orientation, dpi: p.dpi, url: `/files/designs/${d.id}/photos/${p.n}.jpg` })), options: d.options || null } : {}),
      preflight: d.preflight ? { status: d.preflight.status, checks: d.preflight.checks } : { status: 'pass', checks: [] },
      review: { needed: reviewReasons(d).length > 0, reasons: reviewReasons(d) },
    };
  }
  app.get('/api/designs/:id/proof', async (req, res, next) => {
    try {
      const d = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
      if (!d || (d.status && d.status !== 'ready')) throw new HttpError(404, 'designNotFound');
      res.set('Cache-Control', 'no-store');
      res.json(await proofFor(d));
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
    const link = item.proofToken ? `${siteOf(req)}/proof?t=${item.proofToken}` : `${siteOf(req)}/order?id=${order.id}`;
    Promise.resolve().then(() => notify.proofMessage(order, item, { kind, note, link, siteUrl: siteOf(req) }))
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
      proof: d ? await proofFor(d) : null,
      proofLink: item.proofToken ? `/proof?t=${item.proofToken}` : null,
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
      res.json({ order: { id: order.id, number: order.number }, item: { id: item.id, position: order.items.indexOf(item) + 1, productName: item.productName }, proof: await proofFor(d), note: (item.review && item.review.note) || null, status: item.status });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/proofs/:token', express.json({ limit: '8kb' }), (req, res) => {
    const found = findByProofToken(req.params.token);
    if (!found) throw new HttpError(404, 'proofNotFound');
    const { order, item } = found;
    if (item.status !== 'awaiting_approval') throw new HttpError(409, 'proofDone');
    const d = store.getDesign(item.designId);
    const b = req.body || {};
    const comment = String(b.comment || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 1000);
    const now = new Date().toISOString();
    if (b.decision === 'approve') {
      if (b.proofHash && b.proofHash !== proofHashOf(d)) throw new HttpError(409, 'proofChanged', { designId: d.id });
      // A sample asked for at checkout stays asked for with the new approval.
      recordApproval(item, d, { via: 'proof-link', note: comment || null, sample: Boolean(item.sampleWanted || (item.approval && item.approval.sample)) });
      item.status = 'queued';
      item.review = { ...(item.review || { needed: false, reasons: [] }), status: 'done' };
    } else if (b.decision === 'reject') {
      item.status = 'changes_requested';
      item.approvals = [...(item.approvals || []), { action: 'rejected', by: 'customer', at: now, proofHash: proofHashOf(d), version: d.version || 1, note: comment || null }];
    } else {
      throw new HttpError(400, 'badDecision');
    }
    item.history.push({ status: item.status, at: now });
    delete item.proofToken;
    store.save();
    res.json({ status: item.status, orderId: order.id });
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
      // Only a job that is waiting for review (a Review tab left open must not send a shipped job back).
      if (!REVIEW_STATUSES.includes(item.status)) throw new HttpError(409, 'notInReview');
      const d = store.getDesign(item.designId);
      const b = req.body || {};
      const note = String(b.note || '').trim().slice(0, 2000);
      const now = new Date().toISOString();
      if (b.action === 'approve') {
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
        if (!note) throw new HttpError(400, 'noteRequired');
        item.status = 'changes_requested';
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
  app.put('/api/admin/items/:itemId/replacement/:side', adminOnly, express.raw({ type: () => true, limit: '60mb' }), async (req, res, next) => {
    try {
      const found = store.findItem(req.params.itemId);
      if (!found) throw new HttpError(404, 'itemNotFound');
      const { order, item } = found;
      const d = store.getDesign(item.designId);
      const sd = d && d.kind !== 'book' && d.kind !== 'gangsheet' && d.kind !== 'photoset' && d.sides.find((x) => x.id === req.params.side);
      if (!sd) throw new HttpError(404, 'notFound');
      if (['printing', 'printed', 'shipped'].includes(item.status)) throw new HttpError(409, 'alreadyPrinting');
      // A side with the customer's name list: its files are made per name, so one picture can't replace it.
      if (d.merge && d.merge.sides && d.merge.sides[sd.id]) throw new HttpError(409, 'replaceNames');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badImage');
      if (buf.readUInt32BE(16) !== sd.widthPx || buf.readUInt32BE(20) !== sd.heightPx) throw new HttpError(400, 'replacementSize', { w: sd.widthPx, h: sd.heightPx });
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
      item.approvals = [...(item.approvals || []), { action: 'changes', by: 'shop', at: now, replaced: true, proofHash: proofHashOf(d), version: d.version, side: sd.id }];
      item.preflight = d.preflight;
      item.history.push({ status: item.status, at: now });
      newProofLink(item);
      store.save();
      tellCustomer(order, item, 'proof', (item.review && item.review.note) || '', req);
      res.json(await reviewItem(order, item));
    } catch (e) {
      next(e);
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
      if (sz.id !== sizeDef.id && !(product.mix && product.mix.sizes)) throw new HttpError(400, product.paged ? 'qtyOnePageCount' : 'qtyNoSizes');
      const key = `${co.id}|${sz.id}`;
      merged.set(key, { co, sz, qty: (merged.get(key) || { qty: 0 }).qty + qty });
      total += qty;
    }
    if (total > MAX_PIECES) throw new HttpError(400, 'qtyTooMany', { max: MAX_PIECES });
    if (total === 1 && merged.size === 1) {
      const only = [...merged.values()][0];
      if (only.co.id === colorDef.id && only.sz.id === sizeDef.id) return null; // just one, as chosen
    }
    return [...merged.values()].map(({ co, sz, qty }) => ({ color: { id: co.id, name: co.name, hex: co.hex }, size: { id: sz.id, label: sz.label }, qty }));
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
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0) {
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
    // One artwork, many pieces: several of the same, or the same artwork in other sizes / colours.
    const lines = mergeList ? mergeList.lines : cleanQuantities(product, (req.body || {}).quantities, colorDef, sizeDef);
    // Pictures imported from other sites: the customer must confirm they may print them.
    const imported = [...new Set(Object.values(editor).flatMap((e) => e.objects.map((o) => (o && typeof o.importSource === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(o.importSource.trim()) ? o.importSource.trim().slice(0, 500) : null)).filter(Boolean)))].slice(0, 10);
    if (imported.length && (req.body || {}).rightsConfirmed !== true) throw new HttpError(400, 'rightsRequired');

    const token = crypto.randomBytes(24).toString('hex');
    const design = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'uploading',
      uploadTokenHash: sha(token),
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
      ...(Array.isArray((req.body || {}).clientChecks) && JSON.stringify(req.body.clientChecks).length < 20000 ? { clientChecks: req.body.clientChecks.slice(0, 50) } : {}),
      version: 1,
      currency: CURRENCY,
      orderId: null,
      ...(imported.length ? { imports: imported, rightsConfirmedAt: new Date().toISOString() } : {}),
      ...(pattern ? { pattern } : {}),
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
    const files = storedSides.flatMap((sd) => [`${sd.id}-print.png`, `${sd.id}-preview.png`, `${sd.id}-design.svg`, ...(sd.vector && sd.vector.overlay ? [`${sd.id}-overlay.png`] : [])]);
    if (mergeList) for (const sd of Object.keys(mergeList.sides)) files.push(`${sd}-merge-base.png`, `${sd}-merge.bin`);
    design.expectedFiles = files;
    store.createDesign(design, { 'editor.json': editorJson, ...pdfCopies, ...(mergeList ? { 'merge.json': JSON.stringify({ columns: mergeList.columns, rows: mergeList.rows }) } : {}) });
    res.status(201).json({ id: design.id, uploadToken: token, files });
  });

  const uploadingDesign = (req) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'designNotFound');
    if (design.status !== 'uploading' || design.uploadTokenHash !== sha(req.get('x-upload-token') || '')) throw new HttpError(403, 'notFound');
    return design;
  };

  app.put('/api/designs/:id/files/:name', express.raw({ type: () => true, limit: '150mb' }), (req, res) => {
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
        const { uploadTokenHash, doneTokenHash, ...pub } = prior; // eslint-disable-line no-unused-vars
        return res.json({ ...pub, previewUrl: `/files/designs/${prior.id}/front-preview.png` });
      }
      const design = uploadingDesign(req);
      if (design.kind === 'photoset') {
        await completePhotoset(design);
        await runPreflight(design);
        design.status = 'ready';
        design.doneTokenHash = design.uploadTokenHash;
        delete design.uploadTokenHash;
        store.save();
        const { uploadTokenHash, doneTokenHash, ...pub } = design; // eslint-disable-line no-unused-vars
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
        const { uploadTokenHash, ...pub } = design; // eslint-disable-line no-unused-vars
        return res.json({ ...pub, previewUrl: `/files/designs/${design.id}/front-preview.png` });
      }
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
      }
      if (design.merge) checkMergeFiles(design);
      if (design.method === 'embroidery') await makeEmbroidery(design);
      await heavy(async () => {
        await makeProofImages(design);
        await runPreflight(design);
      });
      design.status = 'ready';
      delete design.uploadTokenHash;
      store.save();
      const { uploadTokenHash, ...pub } = design; // eslint-disable-line no-unused-vars
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
  app.post('/api/enhance', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '15mb' }), async (req, res, next) => {
    try {
      const now = Date.now();
      const hits = (enhanceHits.get(req.ip) || []).filter((tm) => now - tm < 60000);
      if (hits.length >= 20 || limiter.hit(`enhanceDay:${req.ip}`, [{ max: 200, ms: 24 * 3600e3 }])) throw new HttpError(429, 'aiLimit');
      enhanceHits.set(req.ip, [...hits, now]);
      if (enhanceHits.size > 5000) enhanceHits.clear();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 32) throw new HttpError(400, 'enhanceBad');
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
      if (buf.length < 32) throw new HttpError(400, 'enhanceBad');
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
    res.set('Cache-Control', 'public, max-age=86400');
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
      res.set('Cache-Control', 'private, max-age=900');
      res.set('X-Image-Size', `${img.width}x${img.height}`);
      res.type(img.type).send(img.body);
    } catch (e) {
      next(importError(e));
    }
  });
  // Rights holders ask for a design to be taken down: kept for the admin and emailed to the shop.
  app.post('/api/takedown', express.json({ limit: '20kb' }), (req, res) => {
    const b = req.body || {};
    const clean = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
    const reqst = { name: clean(b.name, 120), contact: clean(b.contact, 200), owner: clean(b.owner, 200), link: clean(b.link, 500), details: String(b.details || '').trim().slice(0, 3000) };
    if (reqst.name.length < 2 || reqst.contact.length < 5 || reqst.details.length < 10) throw new HttpError(400, 'takedownMissing');
    rateLimit(req, 'takedown');
    const saved = store.mutate((db) => {
      db.takedowns ||= [];
      const t = { id: crypto.randomUUID(), at: new Date().toISOString(), ...reqst, status: 'new' };
      db.takedowns.push(t);
      return t;
    });
    const text = `Rights / takedown request\nFrom: ${saved.name} (${saved.contact})\nRights holder: ${saved.owner}\nLink: ${saved.link}\n\n${saved.details}`;
    if (notify.emailReady() && process.env.ADMIN_EMAIL) notify.emailTo(process.env.ADMIN_EMAIL, 'ebda3 · Rights request', `<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`, text).catch((e) => console.warn('[takedown] email failed:', e.message));
    res.status(201).json({ ok: true });
  });

  app.post('/api/artwork', express.raw({ type: () => true, limit: '40mb' }), async (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!artwork.sniff(buf)) throw new HttpError(400, 'artworkType');
      rateLimit(req, 'artwork');
      const px = Math.min(4000, Math.max(500, Number(req.get('x-max-px')) || 3000));
      let out;
      try {
        out = await artwork.convertArtwork(buf, { px });
      } catch (e) {
        if (!(e instanceof artwork.ArtworkError)) throw e;
        if (e.reason === 'busy') throw new HttpError(429, 'tooFast');
        console.warn('[artwork] could not convert a', artwork.sniff(buf).kind, 'file of', buf.length, 'bytes:', e.reason, String(e.detail || '').slice(0, 400));
        throw new HttpError(400, e.reason === 'empty' ? 'artworkEmpty' : 'artworkBad');
      }
      res.type('image/png').send(out.png);
    } catch (e) {
      next(e);
    }
  });

  // Booklets: a whole PDF, one picture per page, to put on the booklet's pages in order.
  // The PDF is kept for 45 days (designs copy it): the booklet print files are made from its pages.
  const pdfUploadsDir = path.join(dataDir, 'pdf-uploads');
  const PDF_ID_RE = /^[a-f0-9]{24}$/;
  app.post('/api/artwork/pages', express.raw({ type: () => true, limit: '60mb' }), async (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const kind = artwork.sniff(buf);
      if (!kind || kind.kind !== 'pdf') throw new HttpError(400, 'pdfOnly');
      rateLimit(req, 'artwork');
      const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || d));
      const max = clamp(req.get('x-max-pages'), 1, 40, 32);
      // The shop's daily room for kept PDFs, checked before the work and taken only for a PDF that is kept.
      const mb = buf.length / 1048576;
      if (!shopBudgetLeft('pdfPagesMB', LIMITS.pdfPagesMB, mb)) throw new HttpError(429, 'pdfBudget');
      let out;
      try {
        out = await artwork.pdfPages(buf, { max });
      } catch (e) {
        if (!(e instanceof artwork.ArtworkError)) throw e;
        if (e.reason === 'busy') throw new HttpError(429, 'tooFast');
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
      size: sh.size,
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
  }, express.json({ limit: '15mb' }), (req, res) => {
    const b = req.body || {};
    const product = getProduct(b.productId);
    if (!product) throw new HttpError(400, 'unknownProduct', { id: String(b.productId || '').slice(0, 40) });
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
    for (const sd of sides) {
      const offset = sd.emb ? cleanEmbOffset(host, product.embroidery, b.sides[sd.id].offset) : cleanOffset(product, sd, size.id, b.sides[sd.id].offset);
      editor[sd.id] = { objects: b.sides[sd.id].objects, ...(offset ? { offset } : {}) };
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
      color: { id: color.id, name: color.name, hex: color.hex }, size: { id: size.id, label: size.label },
      ...(picked.options ? { options: picked.options } : {}),
      sides: sides.map((sd) => ({ id: sd.id, name: sd.name })), feedback: [],
    };
    writeShare(share);
    res.status(201).json(publicShare(share));
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
    const comment = String(b.comment || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(BIDI, '').trim().slice(0, 500);
    const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(BIDI, '').trim().slice(0, 40);
    if (vote === 'change' && !comment) throw new HttpError(400, 'feedbackEmpty');
    sh.feedback = (sh.feedback || []).slice(-99);
    sh.feedback.push({ vote, comment, name, at: new Date().toISOString() });
    writeShare(sh);
    res.status(201).json(publicShare(sh));
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
    const { uploadTokenHash, orderId, revisionOf, ...pub } = design; // eslint-disable-line no-unused-vars
    const list = design.merge ? readMergeList(design) : null;
    res.json({ ...pub, editor, ...(list ? { mergeList: list } : {}) });
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
    res.set('Cache-Control', 'public, max-age=300');
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
    res.set('Cache-Control', 'private, max-age=3600');
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
  app.get('/api/books/companion/:id.png', (req, res) => {
    const file = books.companionPath(req.params.id);
    if (!file) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400');
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
      res.set('Cache-Control', 'public, max-age=86400');
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
      return await sharp()(buf, { limitInputPixels: 40e6 }).rotate().resize(720, 900, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
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
  async function saveBook(design, body, ip) {
    const prev = bookSaves.get(design.id) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => saveBookAtomic(design, body, ip));
    bookSaves.set(design.id, run);
    try {
      return await run;
    } finally {
      if (bookSaves.get(design.id) === run) bookSaves.delete(design.id);
    }
  }
  async function saveBookAtomic(design, body, ip) {
    // All or nothing: if anything fails (a page that can't be drawn, a bad photo),
    // the book stays exactly as it was, so a half-saved book can't be ordered.
    const before = JSON.parse(JSON.stringify(design));
    const faceFile = store.designFile(design.id, 'face.jpg');
    const oldFace = fs.existsSync(faceFile) ? fs.readFileSync(faceFile) : null;
    try {
      await saveBookNow(design, body, ip);
    } catch (e) {
      // Ordered while this save was running: the book stays ordered (never put back to "not ordered").
      const fresh = store.getDesign(design.id);
      const orderId = design.orderId || (fresh && fresh.orderId) || null;
      for (const k of Object.keys(design)) delete design[k];
      Object.assign(design, before);
      if (orderId) design.orderId = orderId;
      if (oldFace) store.writeDesignFile(design.id, 'face.jpg', oldFace);
      store.save();
      throw e;
    }
  }
  async function saveBookNow(design, body, ip) {
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
    const sizeDef = product.sizes.find((z) => z.id === size) || product.sizes[0];
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
    // Ordered while this save was running: the customer approved the book as it was, which is what prints.
    const fresh = store.getDesign(design.id);
    if (design.orderId || (fresh && fresh.orderId)) throw new HttpError(409, 'designOrdered');
    design.version = (design.version || 0) + 1;
    fs.rmSync(store.designFile(design.id, 'book-print.pdf'), { force: true });
    fs.rmSync(store.designFile(design.id, 'book-preview.pdf'), { force: true });
    store.writeDesignFile(design.id, 'book-preview.png', await (await books.renderPage(bookData(design), 0, 600)).png().toBuffer());
    store.save();
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
        await saveBook(design, req.body || {}, req.ip);
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
  app.put('/api/books/designs/:id', express.json({ limit: '10mb' }), async (req, res, next) => {
    try {
      const design = editableBook(req);
      await saveBook(design, req.body || {}, req.ip);
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
      res.set('Cache-Control', 'private, max-age=600');
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
      item.redraw = { status: 'off' };
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
    if (d.kind === 'book') return catalog.unavailable(product);
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
    return `${name} (${[col && (col.name[lang] || col.name.en), size && (size.label[lang] || size.label.en)].filter(Boolean).join(' · ')})`;
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
        name: (prof.name || fallback).replace(/\s+/g, ' ').slice(0, 120).padEnd(2, '.'),
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
  app.put('/api/account', express.json({ limit: '10kb' }), (req, res) => {
    const me = signedIn(req);
    const b = req.body || {};
    // Text fields must be text (an object or a list is refused, not saved as "[object Object]").
    const text = (v) => (v == null ? '' : typeof v === 'string' ? v : (() => { throw new HttpError(400, 'badRequest'); })());
    // (Invisible characters don't count, as at sign-up.)
    const name = text(b.name).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const email = cleanEmail(text(b.email)).toLowerCase().slice(0, 200);
    if (name.length < 2) throw new HttpError(400, 'acctName');
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
    const weak = customers.passwordProblem(String(password || ''));
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
    res.json({ orders: store.listOrders().filter((o) => o.customerId === me.id).slice().reverse().map(publicOrder) });
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
    const weak = customers.passwordProblem(String(password || ''));
    if (weak) throw new HttpError(400, weak);
    const { salt, hash } = customers.hashPassword(password);
    // An emailed link was opened: the account's email is proven to be theirs.
    const updated = store.mutate((db) => Object.assign(db.customers.find((x) => x.id === cust.id), { salt, passHash: hash, pv: (cust.pv || 1) + 1 }, link.viaEmail && cust.email ? { emailVerified: true } : {}));
    setSession(req, res, updated);
    res.json({ customer: customers.publicCustomer(updated) });
  });

  // ---------- Coupons ----------
  const findCoupon = (code) => (store.db.coupons || []).find((c) => c.code === coupons.normCode(code)) || null;
  const couponLine = (design, price) => {
    const product = design && getProduct(design.productId);
    return { productId: design ? design.productId : '', category: product ? product.category : '', price: price || 0 };
  };

  // The cart asks for today's prices before the customer orders.
  app.post('/api/cart/quote', express.json({ limit: '20kb' }), (req, res) => {
    // Coupon codes that don't work count per visitor (codes can't be guessed by trying thousands);
    // a working code re-checked on every cart visit doesn't.
    const tryingCode = typeof (req.body || {}).couponCode === 'string' && req.body.couponCode.trim() !== '';
    if (tryingCode) limitCheck(req, 'couponTry');
    const ids = Array.isArray((req.body || {}).designIds) ? req.body.designIds.slice(0, MAX_ITEMS_PER_ORDER) : [];
    const items = ids.map((id) => {
      const d = typeof id === 'string' && UUID_RE.test(id) ? store.getDesign(id) : null;
      const price = designPrice(d);
      // Already ordered (e.g. the answer to the order got lost): the cart can take the customer to it.
      const why = price === null ? null : designUnavailable(d);
      const p = why && getProduct(d.productId);
      return { designId: String(id).slice(0, 40), price, gone: price === null, ...(d && d.orderId ? { ordered: true } : {}), ...(why ? { unavailable: why, unavailableText: format(why, { name: p ? p.name[langOf(req)] || p.name.en : '' }, langOf(req)) } : {}) };
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
        i.unavailableText = format('notEnoughStock', { name: stockName(short.pid, short.combo, langOf(req)), left: free }, langOf(req));
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
      const phone = typeof (req.body || {}).phone === 'string' ? normalizeEgyptMobile(req.body.phone) : null;
      const r = coupons.apply(findCoupon(code), { lines, orders: store.listOrders(), ...(phone ? { phone } : {}) });
      if (r.ok) coupon = { code, discount: r.discount, freeShipping: r.freeShipping };
      else couponError = format(r.reason, r.params || {}, langOf(req));
    }
    const discount = coupon ? coupon.discount : 0;
    // "Print one sample first" adds about 2 business days to the promised day.
    const delivery = withSampleDays(deliveryFor((req.body || {}).delivery), (req.body || {}).sample === true);
    // Free shipping is judged on the items before any coupon: a coupon never makes the order cost more.
    const baseShipping = !lines.length || (coupon && coupon.freeShipping) ? 0 : shippingFor(subtotal);
    // `shipping` includes the express fee; `delivery` says how fast and by which day.
    const shipping = round2(baseShipping + (lines.length ? delivery.fee : 0));
    const deliveryOptions = ['standard', 'express'].map((s) => withSampleDays(deliveryFor(s), (req.body || {}).sample === true));
    if (tryingCode && couponError) limitHit('couponTry', req.ip);
    res.json({ items, subtotal, discount, coupon, couponError, shipping, baseShipping, delivery, deliveryOptions, total: round2(subtotal - discount + shipping), freeShippingOver: FREE_SHIPPING_OVER, shippingFlat: SHIPPING_FLAT });
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
    res.json(publicOrder(order));
  });
  app.post('/api/orders', express.json({ limit: '100kb' }), asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { designIds, expectedTotal } = body;
    const orderKey = typeof body.orderKey === 'string' && ORDER_KEY_RE.test(body.orderKey) ? body.orderKey : null;
    const already = orderKey && orderByKey(orderKey);
    if (already) return res.status(200).json(publicOrder(already));
    const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const c = {
      name: cleanString(customer.name, 'name', { max: 120 }),
      phone: cleanString(customer.phone, 'phone', { max: 30 }),
      email: cleanEmail(cleanString(customer.email, 'email', { max: 200, required: false })),
      governorate: typeof customer.governorate === 'string' ? customer.governorate : '',
      city: cleanString(customer.city, 'city', { max: 100 }),
      address: cleanString(customer.address, 'address', { max: 300 }),
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
    const approvals = body.approvals && typeof body.approvals === 'object' ? body.approvals : {};
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
      const r = coupons.apply(findCoupon(code), { lines, orders: store.listOrders(), phone: c.phone });
      if (!r.ok) throw new HttpError(409, r.reason, r.params || {});
      // The items it came off (a coupon for one product): the accounts charge the discount to those.
      applied = { id: findCoupon(code).id, code, type: findCoupon(code).type, discount: r.discount, freeShipping: r.freeShipping, items: r.lines.map((i) => items[i].id) };
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
      lang: langOf(req),
    }, (db) => {
      // Checked again under the lock with the latest data: another copy may have just ordered one of these.
      for (const d of designs) {
        const cur = db.designs[d.id];
        if (!cur || (cur.status && cur.status !== 'ready')) throw new HttpError(400, 'designGone');
        if (cur.orderId) throw new HttpError(409, 'designOrdered');
      }
      // The coupon's limits, with every order saved so far (by any copy of the app).
      if (applied) {
        const r = coupons.apply((db.coupons || []).find((x) => x.id === applied.id), { lines, orders: db.orders, phone: c.phone });
        if (!r.ok) throw new HttpError(409, r.reason, r.params || {});
      }
      // Counted stock goes down by the pieces ordered (checked again with the latest count, every
      // product first, so a refused order takes nothing off).
      const counted = [...wanted.values()].map((x) => ({ ...x, e: db.catalog && db.catalog.products && db.catalog.products[x.pid] })).filter((x) => x.e && typeof leftOf(x.e, x.combo) === 'number');
      for (const x of counted) if (leftOf(x.e, x.combo) < x.n) throw new HttpError(409, 'notEnoughStock', { name: stockName(x.pid, x.combo, langOf(req)), left: leftOf(x.e, x.combo) });
      for (const x of counted) {
        if (x.combo) x.e.variantStock[x.combo] -= x.n;
        else x.e.stock -= x.n;
      }
    });
    // A signed-in customer without a saved address keeps this one for next time.
    if (me && !me.address) {
      store.mutate((db) => {
        const cust = (db.customers || []).find((x) => x.id === me.id);
        if (cust && !cust.address) cust.address = { governorate: c.governorate, city: c.city, address: c.address, notes: c.notes || '' };
      });
    }
    res.status(201).json(publicOrder(order));
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
    notify.orderPlaced(order, { origin: linkBase(req), lang: order.lang, admin: toShop, customer: toCustomer })
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
      ...(d.quantities ? { quantities: JSON.parse(JSON.stringify(d.quantities)).map((l) => ({ ...l, unitPrice: round2(priceFor(product, l.size.id, decoratedSides(d)) + embExtra(product, d, l.size.id)) })) } : {}),
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
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const item = order.items.find((it) => it.id === req.params.itemId);
    if (!item) throw new HttpError(404, 'itemNotFound');
    if (item.status !== 'changes_requested') throw new HttpError(409, 'reviseNotNeeded');
    if (item.kind) throw new HttpError(409, 'reviseNotEditable'); // books, photo sets, film sheets
    const id = (req.body || {}).designId;
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
    // Checked again and changed under the store's lock, on the latest data (another copy of the app
    // may have answered the same item or ordered the same design a moment ago).
    store.mutate((db) => {
      const o = db.orders.find((x) => x.id === order.id);
      const it = o && o.items.find((x) => x.id === item.id);
      const nd = db.designs[d.id];
      if (!it || it.status !== 'changes_requested') throw new HttpError(409, 'reviseNotNeeded');
      if (!nd || nd.orderId) throw new HttpError(409, 'designOrdered');
      const counted = [...delta.values()].filter((x) => x.n).map((x) => ({ ...x, e: db.catalog && db.catalog.products && db.catalog.products[x.pid] })).filter((x) => x.e && typeof leftOf(x.e, x.combo) === 'number');
      for (const x of counted) if (x.n > 0 && leftOf(x.e, x.combo) < x.n) throw new HttpError(409, 'notEnoughStock', { name: stockName(x.pid, x.combo, langOf(req)), left: leftOf(x.e, x.combo) });
      for (const x of counted) {
        if (x.combo) x.e.variantStock[x.combo] -= x.n;
        else x.e.stock -= x.n;
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
      if (Array.isArray(it.quantities)) for (const l of it.quantities) { const p = agreed.lines.get(`${l.color && l.color.id}|${l.size && l.size.id}`); if (p !== undefined) l.unitPrice = p; }
      if (sample) it.sampleWanted = true;
      // What it costs to make follows the new version (another size or extra sides cost differently).
      const costs = db.costs || {};
      if (costs[it.productId]) it.costAtOrder = accounting.itemCostFrom(costs, it);
      // The approval was for the old version: the new one gets its own proof to approve.
      delete it.approval;
      delete it.replaced;
      it.preflight = nd.preflight ? { status: nd.preflight.status, checks: nd.preflight.checks } : null;
      it.status = 'review';
      it.review = { needed: true, reasons: [...new Set(['revised', ...reviewReasons(nd, { sample })])], status: 'pending' };
      it.approvals = [...(it.approvals || []), { action: 'revised', by: 'customer', at: now, proofHash: proofHashOf(nd), version: nd.version }];
      it.history.push({ status: 'review', at: now });
      delete it.proofToken;
    });
    const saved = store.getOrder(order.id);
    res.json(publicOrder(saved));
    // Tell the shop a new version is waiting in Review (after answering; it never holds up the customer).
    if (!limiter.hit('notify:*', LIMITS.notify)) {
      const it = saved.items.find((x) => x.id === item.id);
      notify.revisionSent(saved, it, { origin: linkBase(req) }).catch((e) => console.warn('[notify]', e.message));
    }
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    res.json(publicOrder(order));
  });

  // ---------- After the order: order again, drafts on the account, shipping ----------
  // Derived files that carry the old order's number or are cheap to make again.
  const STALE_COPY = /^(book-print\.pdf|book-preview\.pdf|preview-v\d+\.pdf|merge-print(-marks)?\.pdf|merge-copies\.zip|photos-v\d+\.zip)$/;
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
  /** An exact copy of a saved design (files included), not ordered yet. Returns { design, token }. */
  function copyDesign(src) {
    const token = crypto.randomBytes(24).toString('hex');
    const copy = JSON.parse(JSON.stringify(src));
    Object.assign(copy, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'ready', orderId: null, reorderOf: src.id });
    delete copy.uploadTokenHash;
    delete copy.orderedAt;
    if (copy.kind === 'book') copy.uploadTokenHash = sha(token); // the book page edits with this token
    fs.cpSync(store.designDir(src.id), store.designDir(copy.id), { recursive: true, filter: (from) => !STALE_COPY.test(path.basename(from)) });
    store.createDesign(copy, {});
    return { design: copy, token };
  }
  /** What the cart keeps for a design (the same as the editor and book page put there). */
  const cartEntry = (d, token) => ({
    designId: d.id,
    ...(d.kind === 'book' ? { bookId: d.bookId, editToken: token } : {}),
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
  app.post('/api/orders/:id/reorder', (req, res) => {
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    rateLimit(req, 'reorder');
    // Each order again copies every file: a few times per order a day, and a shop-wide daily budget of
    // copied megabytes, so repeated requests can't fill the disk.
    rateLimit(req, 'reorderOrder', order.id);
    const mb = Math.ceil(order.items.reduce((n, it) => n + dirBytes(store.designDir(it.designId)), 0) / 1e6);
    if (!takeShopBudget('reorderMB', LIMITS.reorderMB, Math.max(1, mb))) throw new HttpError(429, 'tooManyWait', { min: 60 });
    const items = [];
    const skipped = [];
    order.items.forEach((it, i) => {
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
      const { design, token } = copyDesign(d);
      const price = d.kind === 'gangsheet' ? d.price : designPrice({ ...design, orderId: null, status: 'ready' });
      if (price == null) {
        skipped.push({ position: i + 1, productName: it.productName, reason: 'productGone' });
        return;
      }
      design.price = price;
      if (product && d.kind !== 'photoset') Object.assign(design, pieceInfo(product, design));
      store.save();
      items.push(cartEntry(design, token));
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
      items.push({ ...cartEntry(d, rec.editToken), addedAt: rec.addedAt || c.updatedAt || new Date().toISOString(), ...(rec.later ? { later: true } : {}), ...(rec.movedAt ? { movedAt: rec.movedAt } : {}) });
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
      items.push({ designId: it.designId, addedAt: at, ...(it.later === true ? { later: true } : {}), ...(moved ? { movedAt: moved } : {}), ...(d.kind === 'book' && BOOK_TOKEN_RE.test(it.editToken || '') ? { editToken: it.editToken } : {}) });
    }
    // With `base` (the ids this device last agreed with the account): merged with what the account has
    // now, so a device with an old page open can't drop items added elsewhere or bring back removed ones.
    // Kept: in both, or added on this device since; added elsewhere since: kept too.
    const baseIds = Array.isArray((req.body || {}).base) ? new Set(req.body.base.filter((x) => typeof x === 'string').slice(0, 200)) : null;
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
    res.set('Cache-Control', 'private, max-age=60');
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
    res.json({ savedAt });
  });
  app.delete('/api/account/drafts/:productId', (req, res) => {
    const me = signedIn(req);
    const product = draftProduct(req);
    const dir = draftDir(me);
    const idx = draftIndex(me);
    if (idx[product.id]) {
      delete idx[product.id];
      fs.mkdirSync(dir, { recursive: true });
      writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify(idx));
    }
    for (const ext of ['json', 'png']) fs.rmSync(path.join(dir, `${product.id}.${ext}`), { force: true });
    res.status(204).end();
  });

  /** Tell the customer their order is on its way (once), without holding up the request. */
  function sendShipped(order, req) {
    if (typeof notify.orderShipped !== 'function') return;
    const siteUrl = linkBase(req);
    Promise.resolve()
      .then(() => notify.orderShipped(order, { siteUrl }))
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
    const order = UUID_RE.test(req.params.orderId) && store.getOrder(req.params.orderId);
    if (!order) throw new HttpError(404, 'orderNotFound');
    const b = req.body || {};
    const text = (v, max) => (v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null);
    const s = { ...(order.shipment || {}) };
    if ('courier' in b) s.courier = text(b.courier, 60);
    if ('trackingNumber' in b) s.trackingNumber = text(b.trackingNumber, 80);
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
    order.shipment = s;
    let first = false;
    if (b.shipped === true || b.delivered === true) first = markShipped(order, req);
    if (b.delivered === true) order.shipment.deliveredAt = order.shipment.deliveredAt || new Date().toISOString();
    if (b.delivered === false) order.shipment.deliveredAt = null;
    store.save();
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
    const result = username
      ? auth.staffLogin(req.ip, username, (req.body || {}).password, staffList())
      : auth.login(req.ip, (req.body || {}).password, { knownDevice: auth.knownDevice(mark) });
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
    // The private preview lets this browser in too (the owner and staff see the shop as customers will).
    previewCookie(req, res, result.user ? staffWho(result.user) : ownerWho());
    if (result.user) return res.json({ token: result.token, expiresAt: new Date(result.expiresAt).toISOString(), role: result.user.role, name: result.user.name });
    res.json({ token: result.token, expiresAt: new Date(result.expiresAt).toISOString(), weakPassword: auth.weak, role: 'owner' });
  });
  app.post('/api/admin/logout', (req, res) => {
    auth.logout(security.bearer(req), staffList());
    // Signed out: the private preview's way in for this browser goes too (an invited person's stays).
    const v = preview.verify(auth.previewKey, preview.cookieFrom(req));
    if (v && !v.who.startsWith('p-')) res.append('Set-Cookie', preview.cookie('', { secure: isHttps(req) }));
    res.status(204).end();
  });
  const staffList = () => store.db.staff || [];
  const requireAdmin = (req, res, next) => {
    if (!auth.verify(security.bearer(req))) throw new HttpError(401, 'signInAgain');
    res.set('Cache-Control', 'no-store');
    next();
  };
  /** The owner, or a product manager: the Products screen only. */
  const requireCatalog = (req, res, next) => {
    const token = security.bearer(req);
    if (auth.verify(token)) req.adminWho = { role: 'owner', name: 'owner' };
    else {
      const u = auth.verifyStaff(token, staffList());
      if (!u || u.role !== 'products') throw new HttpError(401, 'signInAgain');
      req.adminWho = { role: u.role, name: u.username, shown: u.name || u.username }; // (shown: the person's name, for "uploaded by")
    }
    res.set('Cache-Control', 'no-store');
    next();
  };
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
  app.get('/api/admin/session', requireCatalog, (req, res) => res.json({ ok: true, role: req.adminWho.role, ...(req.adminWho.role === 'owner' ? { weakPassword: auth.weak } : { name: req.adminWho.name }) }));

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
    db.catalogLog.push({ at: new Date().toISOString(), who: req.adminWho.name, productId, what: String(what).slice(0, 200) });
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
      if (Array.isArray(b.order)) {
        const ids = e.photos.map((ph) => ph.id);
        if (b.order.length !== ids.length || !ids.every((id) => b.order.includes(id))) throw new HttpError(400, 'badProductField', { field: 'order' });
        e.photos = b.order.map((id) => e.photos.find((ph) => ph.id === id));
      }
      if (b.main !== undefined) {
        if (b.main === null) delete e.mainPhoto;
        else if (e.photos.some((ph) => ph.id === b.main)) e.mainPhoto = b.main;
        else throw new HttpError(400, 'badProductField', { field: 'main' });
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
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/webp').send(fs.readFileSync(file));
  });

  // ---------- Staff accounts (owner only): product managers sign in with their own password ----------
  const staffRow = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, createdAt: u.createdAt });
  app.get('/api/admin/staff', requireAdmin, (req, res) => res.json({ staff: staffList().map(staffRow) }));
  app.post('/api/admin/staff', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const b = req.body || {};
    const name = typeof b.name === 'string' ? b.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) : '';
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!name || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 200) throw new HttpError(400, 'badStaff');
    const user = { id: crypto.randomBytes(8).toString('hex'), name, username, role: 'products', gen: 0, createdAt: new Date().toISOString(), ...security.AdminAuth.hashStaffPassword(b.password) };
    store.mutate((db) => {
      db.staff ||= [];
      if (db.staff.some((u) => u.username === username)) throw new HttpError(400, 'staffTaken');
      db.staff.push(user);
    });
    res.status(201).json(staffRow(user));
  });
  app.put('/api/admin/staff/:id/password', requireAdmin, express.json({ limit: '4kb' }), (req, res) => {
    const pw = (req.body || {}).password;
    if (typeof pw !== 'string' || pw.length < 10 || pw.length > 200) throw new HttpError(400, 'badStaff');
    store.mutate((db) => {
      const u = (db.staff || []).find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'notFound');
      Object.assign(u, security.AdminAuth.hashStaffPassword(pw));
      u.gen = (u.gen || 0) + 1; // signs out everywhere
    });
    res.status(204).end();
  });
  app.delete('/api/admin/staff/:id', requireAdmin, (req, res) => {
    store.mutate((db) => {
      const before = (db.staff || []).length;
      db.staff = (db.staff || []).filter((x) => x.id !== req.params.id);
      if (db.staff.length === before) throw new HttpError(404, 'notFound');
    });
    res.status(204).end();
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
    const category = DESIGN_CATEGORIES.some((c) => c.id === b.category) ? b.category : DESIGN_CATEGORIES[0].id;
    const product = getProduct(sh.productId);
    // A printed side first; a design that is only embroidery keeps the embroidery's own spot.
    const side = sh.sides.find((sd) => sd.id !== EMB) || sh.sides[0];
    const editor = JSON.parse(fs.readFileSync(shareFile(sh.id, 'editor.json'), 'utf8'));
    const meta = library.addCustom({
      name: { ar: nameAr || nameEn, en: nameEn || nameAr },
      category,
      product: product.id,
      color: sh.color.id,
      objects: editor[side.id].objects,
      // A moved print area: the ready design is re-centred on the standard spot.
      area: (() => {
        const a = side.id === EMB && product.embroidery ? product.embroidery.area : printAreaFor(product, side.id, sh.size.id);
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
        if (!a.ok) b.skipped.push({ path: String(ent.path).slice(0, 200), reason: SKIP_REASONS.has(a.reason) ? a.reason : 'badPicture' });
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
    res.set('Cache-Control', 'private, max-age=3600');
    res.type('png').send(fs.readFileSync(path.join(batchDir(b.id), `${it.id}.png`)));
  });
  // Published ones: the screen copy and the full-size original (print files use it).
  app.get('/library-art/:id/:file', (req, res) => {
    const id = String(req.params.id);
    const file = String(req.params.file);
    if (!/^u-[0-9a-f]{12}$/.test(id) || !['web.png', 'print.png', 'print.jpg'].includes(file)) throw new HttpError(404, 'notFound');
    const d = library.get(id);
    const f = path.join(library.artDir(id), file);
    if (!d || !fs.existsSync(f)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=86400, no-transform');
    res.type(file.endsWith('.jpg') ? 'jpeg' : 'png').send(fs.readFileSync(f));
  });
  app.post('/api/admin/library/uploads/:batch/publish', requireCatalog, express.json({ limit: '256kb' }), (req, res) => {
    const b = readBatch(req.params.batch);
    if (!b) throw new HttpError(404, 'uploadGone');
    if (b.status && b.status !== 'ready') throw new HttpError(409, 'uploadNotReady');
    const asked = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 300) : [];
    const live = new Map(liveProducts().map((p) => [p.id, p]));
    const published = [];
    const skipped = [];
    const done = new Set();
    for (const a of asked) {
      const it = a && b.items.find((x) => x.id === a.id);
      if (!it || done.has(it.id)) continue;
      const products = [...new Set((Array.isArray(a.products) ? a.products : []).map(String))].filter((id) => live.has(id)).slice(0, 60);
      if (!products.length) { skipped.push({ itemId: it.id, code: 'pickProducts' }); continue; }
      const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) : '');
      const en = clean(a.name && a.name.en) || clean(a.name && a.name.ar) || it.name.en;
      const ar = clean(a.name && a.name.ar) || en;
      const category = DESIGN_CATEGORIES.some((c) => c.id === a.category) ? a.category : it.category;
      const first = live.get(products[0]);
      const wantColor = a.color && typeof a.color === 'object' ? a.color[first.id] : typeof a.color === 'string' ? a.color : it.color[first.id];
      const color = (first.colors.find((c) => c.id === wantColor) || first.colors.find((c) => c.id === it.color[first.id]) || first.colors[0]).id;
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
      ...publicOrder(o),
      customer: adminCustomer(o.customer),
      items: o.items.map((item, i) => adminItem(o, item, i)),
      notifications: o.notifications || null,
    }));
    res.json({ orders });
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
      item.process = method;
      store.save();
      if (status === undefined) return res.json(adminItem(order, item, order.items.indexOf(item)));
    }
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, 'badStatus', { list: ITEM_STATUSES.join(', ') });
    // A job waiting for review or for the customer's approval is cleared from the Review tab, not here.
    if (REVIEW_STATUSES.includes(item.status) && status !== item.status) throw new HttpError(409, 'notApproved');
    if (item.status !== status) {
      item.status = status;
      item.history.push({ status, at: new Date().toISOString() });
      // Sent back from "shipped" (a mistake, or a reprint): the order isn't on its way any more.
      if (status !== 'shipped' && order.shipment && order.shipment.shippedAt && !order.shipment.deliveredAt) order.shipment = { ...order.shipment, shippedAt: null };
      // The last item shipped: the order is on its way (the customer is told once).
      const first = order.items.every((it) => it.status === 'shipped') && markShipped(order, req);
      store.save();
      if (first) sendShipped(order, req);
    }
    res.json(adminItem(order, item, order.items.indexOf(item)));
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
  const SUFFIX = { 'png-mirror': '-mirrored', 'pdf-marks': '-cropmarks', tiff: '-cmyk', 'dtf-film': '-dtf-film', 'dtf-pdf': '-dtf-film', 'dtg-white': '-dtg-white-underbase', 'sheet-pdf': '-film-mirrored', 'sheet-pdf-plain': '', proof: '-proof' };

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
        const lines = [
          [design.color && pickEn(design.color.name), design.size && pickEn(design.size.label)].filter(Boolean).join(' · '),
          order ? `Ordered ${order.createdAt.slice(0, 10)}` : '',
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
        const label = `${order ? order.number + ' · ' : ''}${pickEn(design.productName)} · ${pickEn(design.size.label)} · ${pickEn(design.color.name)} · ${pickEn(side.name)} · trim ${side.widthIn} x ${side.heightIn} in${side.bleedIn ? ` + ${side.bleedIn} in bleed` : ''}${side.offsetCm ? ` · PLACEMENT moved ${placementEn(side.offsetCm)} from standard` : ''} · ${side.dpi} DPI · ${String(side.process || design.process || (product && product.process) || '').toUpperCase()}`;
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
  const couponRow = (c) => ({ ...c, uses: coupons.usesOf(store.listOrders(), c), discountGiven: accounting.round2(store.listOrders().filter((o) => coupons.usedOn(o, c)).reduce((n, o) => n + (o.discount || 0), 0)) });
  /**
   * Products for the admin's pick lists (coupons, printing houses): archived products ("stop selling")
   * are left out, except ones still in use there (`keep`), marked `archived` so the screen can say so.
   */
  const adminProductList = (keep = new Set()) => PRODUCTS.filter((p) => p.status !== 'removed' || keep.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, category: p.category, ...(p.status === 'removed' ? { archived: true } : {}) }));
  app.get('/api/admin/coupons', requireAdmin, (req, res) => {
    const list = store.db.coupons || [];
    res.json({ coupons: list.map(couponRow), products: adminProductList(new Set(list.flatMap((c) => c.products || []))), categories: CATEGORIES });
  });
  const saveCoupon = (req, id) => {
    const { coupon, error } = coupons.cleanCoupon(req.body, { products: PRODUCTS, categories: CATEGORIES });
    if (error) throw new HttpError(400, error);
    return store.mutate((db) => {
      db.coupons ||= [];
      if (db.coupons.some((c) => c.code === coupon.code && c.id !== id)) throw new HttpError(409, 'couponExists');
      if (id) {
        const cur = db.coupons.find((c) => c.id === id);
        if (!cur) throw new HttpError(404, 'couponNotFound');
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
    store.mutate((db) => { db.coupons = (db.coupons || []).filter((c) => c.id !== req.params.id); });
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
      sizes: p.sizes.map((sz) => ({ id: sz.id, label: sz.label, surcharge: sz.surcharge || 0, costExtra: (c.sizes && c.sizes[sz.id]) || 0, ...(sz.smallPack ? { smallPack: true } : {}) })),
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
    const pr = accounting.cleanPricing(product, req.body || {});
    if (pr.error) throw new HttpError(400, pr.error);
    const co = accounting.cleanCosts(product, (req.body || {}).costs || {});
    if (co.error) throw new HttpError(400, co.error);
    store.mutate((db) => {
      db.pricing ||= {};
      db.costs ||= {};
      if (Object.keys(pr.pricing).length) db.pricing[product.id] = pr.pricing;
      else delete db.pricing[product.id];
      if (Object.keys(co.costs).length) db.costs[product.id] = co.costs;
      else delete db.costs[product.id];
    });
    accounting.applyPricing(PRODUCTS, store.db.pricing);
    res.json(pricingRow(product));
  });
  app.put('/api/admin/accounts/settings', requireAdmin, express.json(), (req, res) => {
    const ship = accounting.money((req.body || {}).shippingCost);
    if (ship === undefined) throw new HttpError(400, 'badCost');
    const settings = store.mutate((db) => (db.accountSettings = { ...(db.accountSettings || {}), shippingCost: ship || 0 }));
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
    res.type('text/csv; charset=utf-8').send(accounting.reportCsv(r, nameOf));
  });
  app.patch('/api/admin/items/:itemId/cost', requireAdmin, express.json(), (req, res) => {
    const v = accounting.money((req.body || {}).actualCost);
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
    const v = accounting.money((req.body || {}).actualShipping);
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
          const sideLabel = !ONCE.has(format) && design.sides.length > 1 ? ` · ${(design.sides.find((sd) => sd.id === sideId).name || {})[lang] || pickEn(design.sides.find((sd) => sd.id === sideId).name)}` : '';
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
    try {
      const ids = Array.isArray(req.body && req.body.itemIds) ? req.body.itemIds : [];
      const chosen = dtfOpen().filter((i) => ids.includes(i.id));
      if (!chosen.length) throw new HttpError(400, 'itemNotFound');
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
        const id = `F${(db.nextFilmNumber = (db.nextFilmNumber || 0) + 1)}`;
        for (const it of chosen) {
          const found = store.findItem(it.id);
          if (found) found.item.filmBatch = { id, at };
        }
        return id;
      });
      res.set('X-Film-Length-In', film.lengthIn.toFixed(2));
      res.set('X-Film-Batch', batchId);
      res.set('Access-Control-Expose-Headers', 'X-Film-Length-In, X-Film-Batch');
      res.type('pdf').attachment(`dtf-film-${batchId}.pdf`).send(film.pdf);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Static site ----------
  app.use('/fonts', express.static(path.join(__dirname, '..', 'public', 'fonts'), { maxAge: '30d', immutable: true }));
  // Pages are served with every script and stylesheet URL stamped with a
  // version (a hash of the site's files), so after a deploy no browser or CDN
  // cache can mix old and new code. Pages themselves are never cached.
  const publicDir = path.join(__dirname, '..', 'public');
  const assetVersion = siteVersion(publicDir);
  const pages = new Map();
  const pageFor = (name) => {
    if (!pages.has(name)) {
      const file = path.join(publicDir, name + '.html');
      const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
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
  // Short share links: the share page with a link preview (WhatsApp, Facebook).
  app.get('/s/:id', (req, res, next) => {
    const sh = readShare(req.params.id);
    const html = pageFor('share');
    if (!html) return next();
    // An old or wrong link: the share page itself says the design wasn't found.
    if (!sh) return sendPage(res.status(404), 'share', html);
    const product = getProduct(sh.productId);
    // The shop's own address (never whatever Host header the request came with).
    const origin = linkBase(req);
    const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const title = `${product ? product.name.ar : 'تصميم'} · ${product ? product.name.en : 'Design'} · ebda3`;
    const tags = [
      `<meta property="og:title" content="${escAttr(title)}">`,
      `<meta property="og:description" content="${escAttr('شوف تصميمي وقولي رأيك · What do you think of my design?')}">`,
      `<meta property="og:image" content="${escAttr(`${origin}/api/shares/${sh.id}/preview/${sh.sides[0].id}.png`)}">`,
      `<meta property="og:url" content="${escAttr(`${origin}/s/${sh.id}`)}">`,
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n  ');
    sendPage(res, 'share', html.replace('</head>', `  ${tags}\n</head>`));
  });
  app.get(/^\/(?:([a-z0-9-]+)(?:\.html)?)?$/, (req, res, next) => {
    const name = req.params[0] || 'index';
    const html = pageFor(name);
    if (!html) return next();
    sendPage(res, name, html);
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
      }
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: format('notFound', {}, langOf(req)) }));
  // Any other unknown address: the shop's own "page not found" page.
  app.use((req, res, next) => {
    // (While private, a stranger asking for a missing file gets "Opening soon", not the shop's own 404.)
    if (previewOn() && !previewWho(req)) return previewClosed(req, res);
    const html = (req.method === 'GET' || req.method === 'HEAD') && req.accepts('html') && pageFor('404');
    if (!html) return next();
    sendPage(res.status(404), '404', html);
  });

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
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    let key = err.key;
    // Errors without a message of ours (bad JSON, a missing file...): a translated general message,
    // never the raw text (it can hold server paths).
    if (!key) key = err.type === 'entity.too.large' ? 'uploadTooLarge' : status >= 500 ? 'serverError' : status === 404 ? 'notFound' : status === 429 ? 'tooFast' : 'badRequest';
    const message = format(key, err.params || {}, lang);
    // The field the admin's product screen should point at (admin → Products).
    const field = err.params && typeof err.params.field === 'string' && err.params.field ? { field: err.params.field } : {};
    res.status(status).json({ error: message, code: key || undefined, ...field });
  });

  return app;
}

module.exports = { createApp, ITEM_STATUSES };
