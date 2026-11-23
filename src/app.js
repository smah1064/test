'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
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
  shippingFor,
  round2,
  printAreaFor,
  printWidthFor,
  REPEATS,
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

// Prices the owner changed in the admin are laid over the built-in ones.
accounting.initPricing(PRODUCTS, EXTRA_SIDE_PRICE);
const { Library, CATEGORIES: DESIGN_CATEGORIES } = require('./library');
const security = require('./security');
const books = require('./books');
const cartoon = require('./cartoon');
let sharpModule = null;
const sharp = () => (sharpModule ||= require('sharp'));
let printfilesModule = null;
const printfiles = new Proxy({}, { get: (_, key) => (printfilesModule ||= require('./printfiles'))[key] });
const artwork = require('./artwork');

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

const MAX_EDITOR_JSON_BYTES = 40 * 1024 * 1024;
const UPLOAD_LIMITS = { print: 60 * 1024 * 1024, preview: 8 * 1024 * 1024, svg: 40 * 1024 * 1024, source: 60 * 1024 * 1024 };
const FILE_RE = /^(front|back)-(print|preview)\.png$|^(front|back)-design\.svg$|^src-\d{1,2}\.(png|jpg|webp)$/;
const SIGNATURES = {
  png: (b) => b.subarray(0, 8).equals(PNG_SIGNATURE),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};
const MAX_ITEMS_PER_ORDER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const kind = name.startsWith('src-') ? 'source' : name.endsWith('.svg') ? 'svg' : name.includes('-print') ? 'print' : 'preview';
  if (buf.length > UPLOAD_LIMITS[kind]) throw new HttpError(413, 'uploadTooLarge');
  if (kind === 'source') {
    const ext = name.split('.').pop();
    if (buf.length < 16 || !SIGNATURES[ext](buf)) throw new HttpError(400, 'badPng', { label: name });
  } else if (kind === 'svg') {
    const head = buf.subarray(0, 512).toString('utf8');
    if (!/<svg[\s>]/.test(head) && !/^\s*<\?xml/.test(head)) throw new HttpError(400, 'badPng', { label: name });
  } else if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new HttpError(400, 'badPng', { label: name });
  }
  return kind;
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function cleanString(value, field, { max = 200, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
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
    sides: item.sides.map((s) => ({ id: s.id, name: s.name, previewUrl: `/files/designs/${item.designId}/${s.id}-preview.png` })),
    price: item.price,
    status: item.status,
    history: item.history,
    process: item.process || getProduct(item.productId)?.process,
    methods: getProduct(item.productId)?.methods || [item.process || 'dtf'],
    kind: item.kind || 'product',
    pieces: item.pieces,
    filmBatch: item.filmBatch || null,
    pattern: item.pattern || null,
  };
}

function publicOrder(order) {
  const c = order.customer;
  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt,
    status: orderStatus(order),
    currency: order.currency || CURRENCY,
    customer: { name: c.name, city: c.city, governorate: governorate(c.governorate)?.name || c.country || null },
    items: order.items.map(publicItem),
    subtotal: order.subtotal,
    discount: order.discount || 0,
    coupon: order.coupon ? order.coupon.code : null,
    shipping: order.shipping,
    total: order.total,
    payment: order.payment,
  };
}

function adminCustomer(c) {
  return { ...c, governorateName: governorate(c.governorate)?.name || null };
}

function adminItem(order, item, index) {
  return {
    ...publicItem(item),
    sides: item.sides.map((s) => ({
      ...s,
      previewUrl: `/files/designs/${item.designId}/${s.id}-preview.png`,
      printUrl: `/api/admin/files/${item.designId}/${s.id}`,
    })),
    orderId: order.id,
    orderNumber: order.number,
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
  // Illustrator / EPS files turned into pictures for the editor.
  artwork: [{ max: 15, ms: 10 * 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  // AI background removal (about 2 s of server time each).
  removeBg: [{ max: 20, ms: 10 * 60e3 }, { max: 80, ms: 24 * 3600e3 }],
  importLink: [{ max: 20, ms: 10 * 60e3 }, { max: 100, ms: 24 * 3600e3 }],
  importImage: [{ max: 120, ms: 10 * 60e3 }, { max: 600, ms: 24 * 3600e3 }],
  takedown: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }],
  removeBgAll: [{ max: 1500, ms: 24 * 3600e3 }],
  // Customer accounts: sign-in attempts, new accounts, password-reset emails.
  accountLogin: [{ max: 10, ms: 15 * 60e3 }, { max: 60, ms: 24 * 3600e3 }],
  accountLoginId: [{ max: 10, ms: 3600e3 }],
  accountSignup: [{ max: 5, ms: 3600e3 }, { max: 20, ms: 24 * 3600e3 }],
  accountForgot: [{ max: 5, ms: 3600e3 }],
  // Printing houses downloading their files.
  downloads: [{ max: 200, ms: 3600e3 }],
};

function createApp({ dataDir, adminPassword, limits = {}, cleanupEvery = 6 * 3600e3, oauthConfig = {}, oauthFetch, importGet }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  const store = new Store(dataDir);
  const app = express();
  const auth = new security.AdminAuth(adminPassword, { dataDir, store });
  const LIMITS = { ...DEFAULT_LIMITS, ...limits };
  const limiter = new security.RateLimiter();
  /** Throws 429 when this visitor (or everyone, for `*` keys) did `what` too often. */
  const rateLimit = (req, what, key = req.ip) => {
    const wait = limiter.hit(`${what}:${key}`, LIMITS[what]);
    if (wait) throw new HttpError(429, wait > 90 ? 'tooManyWait' : 'tooFast', { min: Math.ceil(wait / 60) });
  };

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
    accounting.applyPricing(PRODUCTS, store.db.pricing);
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

  // ---------- Product card pictures ----------
  // The real photo recoloured to a product colour, made once on the server.
  app.get('/api/thumbs/:productId/:colorId.webp', async (req, res, next) => {
    try {
      const product = getProduct(req.params.productId);
      const color = product && product.colors.find((c) => c.id === req.params.colorId);
      if (!color) throw new HttpError(404, 'notFound');
      if (product.kind === 'book') return res.redirect(302, `/api/books/${product.book}/sample/0.jpg`);
      const img = product.pattern ? await thumbs.patternImage(product, color.hex) : await thumbs.cardImage(product.id, product.sides[0].id, color.hex);
      if (!img) throw new HttpError(404, 'notFound');
      res.set('Cache-Control', 'public, max-age=86400, no-transform');
      res.type('image/webp').send(img);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Catalog ----------
  app.get('/api/products', (req, res) => {
    res.json({
      currency: CURRENCY,
      mockup: { width: MOCKUP_WIDTH, height: MOCKUP_HEIGHT },
      pricing: { extraSide: EXTRA_SIDE_PRICE, shipping: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER },
      categories: CATEGORIES,
      governorates: GOVERNORATES,
      contact: { whatsapp: notify.shopWhatsApp() || null },
      products: PRODUCTS.map(publicProduct),
    });
  });

  // ---------- Designs ----------
  // A design is one customised product, saved when the shopper adds it to
  // the cart. It is created in three steps so large print files travel as
  // plain binary uploads:
  //   1. POST   /api/designs                      layout + options -> id and upload token
  //   2. PUT    /api/designs/:id/files/:name      each PNG/SVG file
  //   3. POST   /api/designs/:id/complete         checks files, embeds colour profile + DPI
  app.post('/api/designs', (req, res, next) => {
    // Checked before reading the (large) body.
    rateLimit(req, 'designs');
    rateLimit(req, 'designsAll', '*');
    next();
  }, express.json({ limit: '60mb' }), (req, res) => {
    const { productId, color, size, sides } = req.body || {};
    const product = getProduct(productId);
    if (!product) throw new HttpError(400, 'unknownProduct');
    const colorDef = product.colors.find((c) => c.id === color);
    if (!colorDef) throw new HttpError(400, 'unknownColor');
    const sizeDef = product.sizes.find((s) => s.id === size);
    if (!sizeDef) throw new HttpError(400, 'unknownSize');
    if (!sides || typeof sides !== 'object' || Array.isArray(sides)) throw new HttpError(400, 'sidesRequired');

    const sideIds = Object.keys(sides);
    if (sideIds.length === 0) throw new HttpError(400, 'designAtLeastOne');
    const unknown = sideIds.filter((id) => !product.sides.some((s) => s.id === id));
    if (unknown.length) throw new HttpError(400, 'unknownSide', { side: unknown.join(', ') });

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
    for (const side of product.sides) {
      if (!sideIds.includes(side.id)) continue;
      const s = sides[side.id] || {};
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0) {
        throw new HttpError(400, 'sideEmpty', { side: side.name });
      }
      const offset = cleanOffset(product, side, sizeDef.id, s.editor.offset);
      editor[side.id] = { ...s.editor, offset: offset || undefined, ...(pattern ? { pattern: { repeat: pattern.repeat, tileCm: pattern.tileCm } } : {}) };
      if (pattern) {
        const tileIn = round2(pattern.tileCm / 2.54);
        storedSides.push({ id: side.id, name: side.name, widthIn: tileIn, heightIn: tileIn, bleedIn: 0 });
        continue;
      }
      storedSides.push({
        // The physical size for the chosen size (a 30 x 40 poster prints smaller than a 45 x 60 one).
        id: side.id, name: side.name, widthIn: printWidthFor(product, side, sizeDef.id), heightIn: round2((heightIn(side) * printWidthFor(product, side, sizeDef.id)) / side.printWidthIn), bleedIn: side.bleedIn || 0,
        ...(offset ? { offsetCm: offsetCm(product, side, sizeDef.id, offset) } : {}),
      });
    }
    const editorJson = JSON.stringify(editor);
    if (Buffer.byteLength(editorJson) > MAX_EDITOR_JSON_BYTES) throw new HttpError(413, 'designTooLarge');
    // Pictures imported from other sites: the customer must confirm they may print them.
    const imported = [...new Set(Object.values(editor).flatMap((e) => e.objects.map((o) => (o && typeof o.importSource === 'string' ? o.importSource.slice(0, 500) : null)).filter(Boolean)))].slice(0, 10);
    if (imported.length && (req.body || {}).rightsConfirmed !== true) throw new HttpError(400, 'rightsRequired');

    const token = crypto.randomBytes(24).toString('hex');
    const design = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'uploading',
      uploadTokenHash: sha(token),
      productId: product.id,
      productName: product.name,
      process: product.process,
      color: { id: colorDef.id, name: colorDef.name, hex: colorDef.hex },
      size: { id: sizeDef.id, label: sizeDef.label },
      sides: storedSides,
      price: priceFor(product, sizeDef.id, storedSides.length),
      currency: CURRENCY,
      orderId: null,
      ...(imported.length ? { imports: imported, rightsConfirmedAt: new Date().toISOString() } : {}),
      ...(pattern ? { pattern } : {}),
    };
    const files = storedSides.flatMap((sd) => [`${sd.id}-print.png`, `${sd.id}-preview.png`, `${sd.id}-design.svg`]);
    design.expectedFiles = files;
    store.createDesign(design, { 'editor.json': editorJson });
    res.status(201).json({ id: design.id, uploadToken: token, files });
  });

  const uploadingDesign = (req) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'designNotFound');
    if (design.status !== 'uploading' || design.uploadTokenHash !== sha(req.get('x-upload-token') || '')) throw new HttpError(403, 'notFound');
    return design;
  };

  app.put('/api/designs/:id/files/:name', express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
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
      const design = uploadingDesign(req);
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
        try {
          store.writeDesignFile(design.id, `${side.id}-print.png`, await printfiles.finalizePrintPng(raw, dpi));
        } catch (err) {
          // Never block an order over the colour-profile step; the PNG is still print-ready.
          console.error('Could not embed colour profile/DPI:', err.message);
        }
        Object.assign(side, { widthPx: info.width, heightPx: info.height, dpi, hasSvg: fs.existsSync(store.designFile(design.id, `${side.id}-design.svg`)) });
      }
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
  const libraryCard = (d) => ({
    id: d.id, name: d.name, category: d.category, kind: d.kind, product: d.product, color: d.color,
    ...(d.kind === 'template' ? { items: d.items, aspect: d.aspect } : { preview: `/api/library/${d.id}/preview.png` }),
  });
  app.get('/api/library', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ categories: DESIGN_CATEGORIES, designs: library.visible().map(libraryCard) });
  });
  app.get('/api/library/:id', (req, res) => {
    const d = library.get(req.params.id);
    if (!d || d.hidden) throw new HttpError(404, 'notFound');
    const { hidden, ...pub } = d; // eslint-disable-line no-unused-vars
    res.json(pub);
  });
  app.get('/api/library/:id/preview.png', (req, res) => {
    const d = library.get(req.params.id);
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
      if (hits.length >= 20) throw new HttpError(429, 'aiLimit');
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
    if (notify.emailReady() && process.env.ADMIN_EMAIL) notify.emailTo(process.env.ADMIN_EMAIL, 'OneOff Print · Rights request', `<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`, text).catch((e) => console.warn('[takedown] email failed:', e.message));
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
  }, express.json({ limit: '40mb' }), (req, res) => {
    const b = req.body || {};
    const product = getProduct(b.productId);
    if (!product) throw new HttpError(400, 'unknownProduct', { id: String(b.productId || '').slice(0, 40) });
    const color = product.colors.find((c) => c.id === b.color) || product.colors[0];
    const size = product.sizes.find((z) => z.id === b.size) || product.sizes[0];
    const sides = product.sides.filter((sd) => b.sides && b.sides[sd.id] && Array.isArray(b.sides[sd.id].objects) && b.sides[sd.id].objects.length);
    if (!sides.length) throw new HttpError(400, 'shareEmpty');
    const id = crypto.randomBytes(9).toString('base64url');
    fs.mkdirSync(path.join(sharesDir, id), { recursive: true });
    const editor = {};
    for (const sd of sides) {
      const offset = cleanOffset(product, sd, size.id, b.sides[sd.id].offset);
      editor[sd.id] = { objects: b.sides[sd.id].objects, ...(offset ? { offset } : {}) };
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String((b.previews || {})[sd.id] || ''));
      const png = m ? Buffer.from(m[1], 'base64') : null;
      if (!png || png.length > 4e6 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badPng', { label: 'preview' });
      fs.writeFileSync(shareFile(id, `${sd.id}.png`), png);
    }
    fs.writeFileSync(shareFile(id, 'editor.json'), JSON.stringify(editor));
    const share = {
      id, createdAt: new Date().toISOString(), productId: product.id,
      color: { id: color.id, name: color.name, hex: color.hex }, size: { id: size.id, label: size.label },
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
    res.json({ productId: sh.productId, color: sh.color.id, size: sh.size.id, editor });
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
    const comment = String(b.comment || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500);
    const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
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
      if (hits.length >= 30) throw new HttpError(429, 'serverError');
      proofHits.set(req.ip, [...hits, now]);
      if (proofHits.size > 5000) proofHits.clear();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badPng', { label: 'preview' });
      res.type('png').send(await printfiles.cmykProof(buf));
    } catch (e) {
      next(e);
    }
  });

  // Re-open a saved design in the editor.
  app.get('/api/designs/:id', (req, res) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'designNotFound');
    const editor = JSON.parse(fs.readFileSync(store.designFile(design.id, 'editor.json'), 'utf8'));
    const { uploadTokenHash, ...pub } = design; // eslint-disable-line no-unused-vars
    res.json({ ...pub, editor });
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
  async function saveBook(design, body, ip) {
    // All or nothing: if anything fails (a page that can't be drawn, a bad photo),
    // the book stays exactly as it was, so a half-saved book can't be ordered.
    const before = JSON.parse(JSON.stringify(design));
    const faceFile = store.designFile(design.id, 'face.jpg');
    const oldFace = fs.existsSync(faceFile) ? fs.readFileSync(faceFile) : null;
    try {
      await saveBookNow(design, body, ip);
    } catch (e) {
      for (const k of Object.keys(design)) delete design[k];
      Object.assign(design, before);
      if (oldFace) store.writeDesignFile(design.id, 'face.jpg', oldFace);
      throw e;
    }
  }
  async function saveBookNow(design, body, ip) {
    const { answers, face, size, aiConsent } = body && typeof body === 'object' ? body : {};
    const book = bookFor(design.bookId);
    const product = bookProduct(book);
    try {
      design.answers = books.cleanAnswers(book, answers);
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
    // New photo, or the AI choice changed: make (or drop) the cartoon face.
    if (face || consentChanged || (consent && cartoon.enabled() && !(design.cartoon && design.cartoon.status === 'ready'))) await makeCartoon(design, ip);
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
        delete store.db.designs[design.id];
        store.save();
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
          const wait = limiter.hit('redrawAll:*', LIMITS.redrawAll);
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
  /** What a design costs right now (prices the owner changed apply), or null if it can't be ordered. */
  const designPrice = (d) => {
    if (!d || (d.status && d.status !== 'ready') || d.orderId) return null;
    if (d.kind === 'gangsheet') return d.price;
    const product = getProduct(d.productId);
    return product ? priceFor(product, d.size.id, d.sides.length) : null;
  };
  // ---------- Customer accounts ----------
  const customerList = () => store.db.customers || [];
  const findCustomer = (id) => customerList().find((x) => x.id === id) || null;
  const currentCustomer = (req) => customers.readSession(auth.customerKey, customers.tokenFrom(req), findCustomer);
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
    rateLimit(req, 'accountLogin');
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
      // The same provider account, else an account with the same (verified) email, else a new one.
      let c = db.customers.find((x) => x[key] === prof.id);
      if (!c && prof.email) c = db.customers.find((x) => x.email === prof.email);
      if (c) {
        c[key] = prof.id;
        return c;
      }
      const fallback = prof.email ? prof.email.split('@')[0] : 'Customer';
      c = {
        id: crypto.randomUUID(),
        name: (prof.name || fallback).replace(/\s+/g, ' ').slice(0, 120).padEnd(2, '.'),
        phone: '',
        email: prof.email,
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
  app.post('/api/account/signup', express.json({ limit: '10kb' }), (req, res) => {
    const { fields, error } = customers.cleanSignup(req.body);
    if (error) throw new HttpError(400, error);
    rateLimit(req, 'accountSignup');
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
  });
  app.post('/api/account/login', express.json({ limit: '10kb' }), (req, res) => {
    const { login, password } = req.body || {};
    rateLimit(req, 'accountLogin');
    const key = customers.loginKey(login);
    const cust = key && customerList().find((x) => (key.phone ? x.phone === key.phone : x.email === key.email));
    if (cust) rateLimit(req, 'accountLoginId', cust.id);
    // Same answer whether the account exists or not.
    if (!cust || !customers.checkPassword(cust, password)) throw new HttpError(401, 'acctWrong');
    setSession(req, res, cust);
    res.json({ customer: customers.publicCustomer(cust) });
  });
  app.post('/api/account/logout', (req, res) => {
    setSession(req, res, null);
    res.json({ ok: true });
  });
  app.put('/api/account', express.json({ limit: '10kb' }), (req, res) => {
    const me = signedIn(req);
    const b = req.body || {};
    const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    if (name.length < 2) throw new HttpError(400, 'acctName');
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'badEmail');
    // Mobile number: accounts made with Google/Facebook add it here.
    const phone = b.phone === undefined || b.phone === null || b.phone === '' ? null : normalizeEgyptMobile(b.phone);
    if (b.phone && !phone) throw new HttpError(400, 'badPhone');
    let address = null;
    if (b.address && typeof b.address === 'object' && (b.address.address || b.address.city)) {
      const a = b.address;
      address = {
        governorate: governorate(a.governorate) ? a.governorate : '',
        city: String(a.city || '').trim().slice(0, 100),
        address: String(a.address || '').trim().slice(0, 300),
        notes: String(a.notes || '').trim().slice(0, 500),
      };
    }
    const updated = store.mutate((db) => {
      const cust = (db.customers || []).find((x) => x.id === me.id);
      if (!cust) throw new HttpError(401, 'acctSignIn');
      if (email && db.customers.some((x) => x.email === email && x.id !== cust.id)) throw new HttpError(409, 'acctEmailTaken');
      if (phone && db.customers.some((x) => x.phone === phone && x.id !== cust.id)) throw new HttpError(409, 'acctPhoneTaken');
      Object.assign(cust, { name, email });
      if (phone) cust.phone = phone;
      if (address) cust.address = address;
      return cust;
    });
    res.json({ customer: customers.publicCustomer(updated) });
  });
  app.post('/api/account/password', express.json({ limit: '10kb' }), (req, res) => {
    const me = signedIn(req);
    const { current, password } = req.body || {};
    rateLimit(req, 'accountLoginId', me.id);
    if (me.passHash && !customers.checkPassword(me, current)) throw new HttpError(401, 'acctWrongCurrent');
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
      const key = customers.loginKey((req.body || {}).login);
      const cust = key && customerList().find((x) => (key.phone ? x.phone === key.phone : x.email === key.email));
      const lang = langOf(req);
      // Only by email (a link valid for 1 hour); otherwise the shop helps on WhatsApp.
      if (cust && cust.email && notify.emailReady()) {
        const link = `${notify.siteUrl() || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`}/account?reset=${encodeURIComponent(customers.resetToken(auth.customerKey, cust))}`;
        const ar = lang === 'ar';
        const subject = ar ? 'إعادة تعيين كلمة المرور · ون أوف برنت' : 'Reset your password · OneOff Print';
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
    const cust = customers.readReset(auth.customerKey, token, findCustomer);
    if (!cust) throw new HttpError(400, 'acctResetExpired');
    const weak = customers.passwordProblem(String(password || ''));
    if (weak) throw new HttpError(400, weak);
    const { salt, hash } = customers.hashPassword(password);
    const updated = store.mutate((db) => Object.assign(db.customers.find((x) => x.id === cust.id), { salt, passHash: hash, pv: (cust.pv || 1) + 1 }));
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
    const ids = Array.isArray((req.body || {}).designIds) ? req.body.designIds.slice(0, MAX_ITEMS_PER_ORDER) : [];
    const items = ids.map((id) => {
      const d = typeof id === 'string' && UUID_RE.test(id) ? store.getDesign(id) : null;
      const price = designPrice(d);
      return { designId: String(id).slice(0, 40), price, gone: price === null };
    });
    const subtotal = round2(items.reduce((n, i) => n + (i.price || 0), 0));
    const lines = items.filter((i) => !i.gone).map((i) => couponLine(store.getDesign(i.designId), i.price));
    const code = coupons.normCode((req.body || {}).couponCode);
    let coupon = null;
    let couponError = null;
    if (code) {
      const r = coupons.apply(findCoupon(code), { lines, orders: store.listOrders() });
      if (r.ok) coupon = { code, discount: r.discount, freeShipping: r.freeShipping };
      else couponError = format(r.reason, r.params || {}, langOf(req));
    }
    const discount = coupon ? coupon.discount : 0;
    const shipping = !lines.length || (coupon && coupon.freeShipping) ? 0 : shippingFor(round2(subtotal - discount));
    res.json({ items, subtotal, discount, coupon, couponError, shipping, total: round2(subtotal - discount + shipping), freeShippingOver: FREE_SHIPPING_OVER, shippingFlat: SHIPPING_FLAT });
  });

  app.post('/api/orders', express.json({ limit: '100kb' }), (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { designIds, expectedTotal } = body;
    const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const c = {
      name: cleanString(customer.name, 'name', { max: 120 }),
      phone: cleanString(customer.phone, 'phone', { max: 30 }),
      email: cleanString(customer.email, 'email', { max: 200, required: false }),
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
      return d;
    });

    const now = new Date().toISOString();
    // One order line per design, always quantity 1: every item is its own print job.
    const items = designs.map((d) => {
      if (d.kind === 'gangsheet') {
        return {
          id: crypto.randomUUID(), designId: d.id, kind: 'gangsheet', productId: d.productId, productName: d.productName,
          color: d.color, size: d.size, sides: d.sides, process: 'dtf', price: d.price, pieces: d.sheet.placements.length,
          status: 'queued', history: [{ status: 'queued', at: now }],
        };
      }
      const product = getProduct(d.productId);
      return {
        id: crypto.randomUUID(),
        designId: d.id,
        ...(d.kind === 'book' ? { kind: 'book', bookId: d.bookId } : {}),
        productId: d.productId,
        productName: product.name,
        color: d.color,
        size: d.size,
        sides: d.sides,
        process: d.process || product.process,
        price: priceFor(product, d.size.id, d.sides.length),
        ...(d.imports ? { imports: d.imports, rightsConfirmedAt: d.rightsConfirmedAt } : {}),
        ...(d.pattern ? { pattern: d.pattern } : {}),
        status: 'queued',
        history: [{ status: 'queued', at: now }],
      };
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
      applied = { id: findCoupon(code).id, code, type: findCoupon(code).type, discount: r.discount, freeShipping: r.freeShipping };
    }
    const discount = applied ? applied.discount : 0;
    const shipping = applied && applied.freeShipping ? 0 : shippingFor(round2(subtotal - discount));
    const total = round2(subtotal - discount + shipping);
    // The customer must have seen this total: if a price changed since, show them the new one first.
    if (expectedTotal !== undefined && !(Math.abs(Number(expectedTotal) - total) <= 0.009)) {
      throw new HttpError(409, 'priceChanged', { total });
    }
    // Only orders that passed every check (coupon, prices) count towards the limit,
    // so a typo or a changed price doesn't lock a customer out.
    rateLimit(req, 'orders');
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
      total,
      // Cash on delivery: collected by the courier.
      payment: { method: 'cod', status: 'pending' },
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
    if (limiter.hit('notify:*', LIMITS.notify)) {
      console.warn(`[notify] skipped alerts for ${order.number}: too many orders this hour`);
      order.notifications = { skipped: 'too many orders this hour', at: new Date().toISOString() };
      store.save();
      return;
    }
    const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
    notify.orderPlaced(order, { origin: `${proto}://${req.get('host')}`, lang: order.lang })
      .then((result) => {
        order.notifications = { ...result, at: new Date().toISOString() };
        store.save();
      })
      .catch((e) => console.warn('[notify]', e.message));
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    res.json(publicOrder(order));
  });

  // ---------- Production (admin) ----------
  // Sign in once with the password; every other admin request carries the
  // session token (Authorization: Bearer). 5 wrong passwords lock that
  // visitor out for 15 minutes.
  app.post('/api/admin/login', express.json({ limit: '2kb' }), (req, res) => {
    const result = auth.login(req.ip, (req.body || {}).password);
    if (!result) throw new HttpError(401, 'wrongPassword');
    if (result.wait) throw new HttpError(429, 'tooManyLogins', { min: Math.ceil(result.wait / 60) });
    res.set('Cache-Control', 'no-store');
    res.json({ token: result.token, expiresAt: new Date(result.expiresAt).toISOString(), weakPassword: auth.weak });
  });
  app.post('/api/admin/logout', (req, res) => {
    auth.logout(security.bearer(req));
    res.status(204).end();
  });
  const requireAdmin = (req, res, next) => {
    if (!auth.verify(security.bearer(req))) throw new HttpError(401, 'signInAgain');
    res.set('Cache-Control', 'no-store');
    next();
  };
  app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ ok: true, weakPassword: auth.weak }));

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
  app.get('/api/admin/library', requireAdmin, (req, res) => {
    res.json({ categories: DESIGN_CATEGORIES, designs: library.all().map((d) => ({ ...libraryCard(d), hidden: d.hidden, custom: d.kind === 'objects', createdAt: d.createdAt || null })) });
  });
  // Publish a design made in the editor: the owner shares it, then pastes the link here.
  app.post('/api/admin/library', requireAdmin, express.json({ limit: '8kb' }), (req, res) => {
    const b = req.body || {};
    const id = (String(b.share || '').match(/([A-Za-z0-9_-]{12})\/?(?:[?#].*)?$/) || [])[1];
    const sh = readShare(id);
    if (!sh) throw new HttpError(400, 'shareNotFound');
    const nameAr = String(b.nameAr || '').trim().slice(0, 60);
    const nameEn = String(b.nameEn || '').trim().slice(0, 60);
    if (!nameAr && !nameEn) throw new HttpError(400, 'fieldRequired', { field: { en: 'Name', ar: 'الاسم' } });
    const category = DESIGN_CATEGORIES.some((c) => c.id === b.category) ? b.category : DESIGN_CATEGORIES[0].id;
    const product = getProduct(sh.productId);
    const side = sh.sides[0];
    const editor = JSON.parse(fs.readFileSync(shareFile(sh.id, 'editor.json'), 'utf8'));
    const meta = library.addCustom({
      name: { ar: nameAr || nameEn, en: nameEn || nameAr },
      category,
      product: product.id,
      color: sh.color.id,
      objects: editor[side.id].objects,
      // A moved print area: the ready design is re-centred on the standard spot.
      area: (() => {
        const a = printAreaFor(product, side.id, sh.size.id);
        const o = editor[side.id].offset;
        return o ? { ...a, x: a.x + o.dx, y: a.y + o.dy } : a;
      })(),
      preview: fs.readFileSync(shareFile(sh.id, `${side.id}.png`)),
    });
    res.status(201).json(libraryCard(meta));
  });
  app.patch('/api/admin/library/:id', requireAdmin, express.json({ limit: '1kb' }), (req, res) => {
    if (!library.setHidden(req.params.id, Boolean((req.body || {}).hidden))) throw new HttpError(404, 'notFound');
    res.json({ ok: true });
  });
  app.delete('/api/admin/library/:id', requireAdmin, (req, res) => {
    if (!library.removeCustom(req.params.id)) throw new HttpError(404, 'notFound');
    res.json({ ok: true });
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
      if (!allowed.includes(method)) throw new HttpError(400, 'badProcess', { list: allowed.join(', ') });
      item.process = method;
      store.save();
      if (status === undefined) return res.json(adminItem(order, item, order.items.indexOf(item)));
    }
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, 'badStatus', { list: ITEM_STATUSES.join(', ') });
    if (item.status !== status) {
      item.status = status;
      item.history.push({ status, at: new Date().toISOString() });
      store.save();
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
  };
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
  async function makeFile(design, sideId, format, { now = false } = {}) {
    // Only finished designs (their files were checked when they were completed).
    if (design.status && design.status !== 'ready') throw new HttpError(404, 'notFound');
    const designId = design.id;
    const side = design.sides.find((s) => s.id === sideId);
    const order = design.orderId && store.getOrder(design.orderId);
    const base = `${order ? order.number : 'design'}-${design.productId}-${sideId}`;
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
            .map((sd) => ({ file: store.designFile(designId, `${sd.id}-preview.png`), label: pickEn(sd.name) || sd.id }))
            .filter((pg) => fs.existsSync(pg.file))
            .map((pg) => ({ img: fs.readFileSync(pg.file), label: pg.label }));
        }
        if (!pages.length) throw new HttpError(404, 'notFound');
        store.writeDesignFile(designId, path.basename(target), await printfiles.previewPdf(pages, { title, lines }));
      }
      return { path: target, name: `${order ? order.number : 'design'}-${design.productId}-preview.pdf` };
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
    const target = store.designFile(designId, fmt.file(sideId));
    if (!fs.existsSync(target)) {
      const png = fs.readFileSync(store.designFile(designId, `${sideId}-print.png`));
      let out;
      if (fmt.make) out = await fmt.make(png, side);
      else if (fmt.ext === 'pdf') {
        const product = getProduct(design.productId);
        const label = `${order ? order.number + ' · ' : ''}${pickEn(design.productName)} · ${pickEn(design.size.label)} · ${pickEn(design.color.name)} · ${pickEn(side.name)} · trim ${side.widthIn} x ${side.heightIn} in${side.bleedIn ? ` + ${side.bleedIn} in bleed` : ''}${side.offsetCm ? ` · PLACEMENT moved ${placementEn(side.offsetCm)} from standard` : ''} · ${side.dpi} DPI · ${product ? product.process.toUpperCase() : ''}`;
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
      const f = await makeFile(design, sideId, req.query.format, { now: req.query.now === '1' });
      res.download(f.path, f.name);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Customers (admin): find a customer, help with a forgotten password ----------
  app.get('/api/admin/customers', requireAdmin, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
    const digits = q.replace(/\D/g, '');
    const orders = store.listOrders();
    const list = customerList()
      .filter((c) => !q || String(c.name || '').toLowerCase().includes(q) || (c.email || '').includes(q) || (digits.length >= 3 && String(c.phone || '').includes(digits)))
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
    const url = `${notify.siteUrl() || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`}/account?reset=${encodeURIComponent(customers.resetToken(auth.customerKey, c, 24))}`;
    const phone = String(c.phone || '').replace(/^0/, '20');
    res.json({ url, hours: 24, whatsapp: phone ? `https://wa.me/${phone}` : null });
  });

  // ---------- Coupons (admin) ----------
  const couponRow = (c) => ({ ...c, uses: coupons.usesOf(store.listOrders(), c), discountGiven: accounting.round2(store.listOrders().filter((o) => coupons.usedOn(o, c)).reduce((n, o) => n + (o.discount || 0), 0)) });
  app.get('/api/admin/coupons', requireAdmin, (req, res) => {
    res.json({ coupons: (store.db.coupons || []).map(couponRow), products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, category: p.category })), categories: CATEGORIES });
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
    const unit = accounting.itemCostFrom(store.db.costs, { productId: p.id, size: p.sizes[0], sides: [p.sides[0]] });
    return {
      id: p.id, name: p.name, category: p.category, kind: p.kind || 'product', sideCount: p.sides.length,
      basePrice: p.basePrice, extraSidePrice: extra,
      sizes: p.sizes.map((sz) => ({ id: sz.id, label: sz.label, surcharge: sz.surcharge || 0, costExtra: (c.sizes && c.sizes[sz.id]) || 0 })),
      defaults: d, costs: { blank: c.blank || 0, printFirst: c.printFirst || 0, printExtra: c.printExtra || 0, other: c.other || 0 },
      costsSet: Boolean(store.db.costs && store.db.costs[p.id]),
      unitCost: unit.total, unitProfit: accounting.round2(p.basePrice + (p.sizes[0].surcharge || 0) - unit.total),
    };
  }
  app.get('/api/admin/pricing', requireAdmin, (req, res) => {
    res.json({ categories: CATEGORIES, products: PRODUCTS.map(pricingRow), settings: store.db.accountSettings || { shippingCost: 0 }, shippingCharged: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER });
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
  const ONCE = new Set(['preview-pdf', 'book-pdf', 'proof', 'sheet-pdf', 'sheet-pdf-plain', 'repeat']);
  const SEND_FORMATS = new Set([...Object.keys(FORMATS), ...ONCE]);
  const FILE_LABELS = {
    pdf: 'Print PDF', 'pdf-marks': 'Print PDF with crop marks', png: 'Print PNG (transparent)', 'png-mirror': 'Print PNG (mirrored)',
    tiff: 'Print TIFF (CMYK)', svg: 'Vector SVG', 'dtf-film': 'DTF film PNG', 'dtf-pdf': 'DTF film PDF', 'dtg-white': 'DTG white underbase',
    'preview-pdf': 'Preview PDF (customer design)', repeat: 'Repeat preview (whole fabric piece)', 'book-pdf': 'Book print PDF', proof: 'Preview image', 'sheet-pdf': 'Gang sheet PDF (mirrored)', 'sheet-pdf-plain': 'Gang sheet PDF',
  };

  app.get('/api/admin/houses', requireAdmin, (req, res) => {
    res.json({
      houses: houses(),
      productHouses: productHouses(),
      products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, category: p.category })),
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
      if (channel === 'whatsapp' && !house.whatsapp) throw new HttpError(400, 'houseNoWhatsApp');
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
        const sideIds = ONCE.has(format) ? [design.sides[0].id] : design.sides.map((sd) => sd.id);
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
          const sideName = !ONCE.has(format) && design.sides.length > 1 ? ` · ${pickEn(design.sides.find((sd) => sd.id === sideId).name)}` : '';
          files.push({ format, side: sideId, name: f.name, path: f.path, size: fs.statSync(f.path).size, label: `${FILE_LABELS[format] || format}${sideName}`, url: `${siteUrl}/dl/${link.token}` });
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
        result = { status: 'opened', whatsappUrl: `https://wa.me/${house.whatsapp}?text=${encodeURIComponent(text)}` };
      }
      const record = {
        id: crypto.randomUUID(), houseId: house.id, houseName: house.name, channel,
        to: channel === 'email' ? house.email : `+${house.whatsapp}`, files: files.map((f) => f.label), at: new Date().toISOString(), status: result.status,
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
        if (item.kind !== 'gangsheet' && method === 'dtf' && (item.status === 'queued' || item.status === 'printing')) list.push(adminItem(order, item, i));
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
        for (const sd of it.sides) {
          pieces.push({
            png: fs.readFileSync(store.designFile(it.designId, `${sd.id}-print.png`)),
            widthIn: sd.widthIn + 2 * (sd.bleedIn || 0),
            heightIn: sd.heightIn + 2 * (sd.bleedIn || 0),
            label: `${it.orderNumber} #${it.position} · ${pickEn(it.productName)} · ${pickEn(sd.name)} · ${pickEn(it.size.label)}`,
          });
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
      if (html) pageCsp.set(name, security.pageCsp(html));
    }
    return pages.get(name);
  };
  const pageCsp = new Map();
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
    const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
    const origin = `${proto}://${req.get('host')}`;
    const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const title = `${product ? product.name.ar : 'تصميم'} · ${product ? product.name.en : 'Design'} · OneOff Print`;
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
    const html = (req.method === 'GET' || req.method === 'HEAD') && req.accepts('html') && pageFor('404');
    if (!html) return next();
    sendPage(res.status(404), '404', html);
  });

  // ---------- Housekeeping ----------
  // Unordered designs (abandoned carts) and old share links are removed so
  // the disk cannot fill up. Ordered designs are kept.
  const runCleanup = () => {
    try {
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
    if (!key) key = err.type === 'entity.too.large' ? 'uploadTooLarge' : status >= 500 ? 'serverError' : null;
    const message = key ? format(key, err.params || {}, lang) : err.message;
    res.status(status).json({ error: message, code: key || undefined });
  });

  return app;
}

module.exports = { createApp, ITEM_STATUSES };
