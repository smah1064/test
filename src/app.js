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
} = require('./products');
const { GOVERNORATES, normalizeEgyptMobile } = require('./egypt');
const { FIELDS, langOf, format } = require('./i18n');
// Loaded on first use: the shop keeps working even if the image library cannot load on a server.
const thumbs = require('./thumbs');
const ai = require('./ai');
const notify = require('./notify');
const { Library, CATEGORIES: DESIGN_CATEGORIES } = require('./library');
const security = require('./security');
const books = require('./books');
const cartoon = require('./cartoon');
let sharpModule = null;
const sharp = () => (sharpModule ||= require('sharp'));
let printfilesModule = null;
const printfiles = new Proxy({}, { get: (_, key) => (printfilesModule ||= require('./printfiles'))[key] });

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
    redraw: item.redraw || null,
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
};

function createApp({ dataDir, adminPassword, limits = {}, cleanupEvery = 6 * 3600e3 }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  const store = new Store(dataDir);
  const app = express();
  const auth = new security.AdminAuth(adminPassword);
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
      const img = await thumbs.cardImage(product.id, product.sides[0].id, color.hex);
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
    for (const side of product.sides) {
      if (!sideIds.includes(side.id)) continue;
      const s = sides[side.id] || {};
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0) {
        throw new HttpError(400, 'sideEmpty', { side: side.name });
      }
      editor[side.id] = s.editor;
      storedSides.push({ id: side.id, name: side.name, widthIn: side.printWidthIn, heightIn: heightIn(side), bleedIn: side.bleedIn || 0 });
    }
    const editorJson = JSON.stringify(editor);
    if (Buffer.byteLength(editorJson) > MAX_EDITOR_JSON_BYTES) throw new HttpError(413, 'designTooLarge');

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
    ...(d.kind === 'template' ? { items: d.items } : { preview: `/api/library/${d.id}/preview.png` }),
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
      editor[sd.id] = { objects: b.sides[sd.id].objects };
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
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
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
  async function saveBook(design, { answers, face, size, aiConsent }, ip) {
    const book = bookFor(design.bookId);
    const product = bookProduct(book);
    try {
      design.answers = books.cleanAnswers(book, answers);
    } catch (e) {
      if (e.message === 'bookMissing') throw new HttpError(400, 'fieldRequired', { field: e.field });
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
        const found = store.findItem(redrawQueue[0]);
        if (!found) { redrawQueue.shift(); continue; }
        const { item } = found;
        const design = store.getDesign(item.designId);
        const book = design && bookFor(design.bookId);
        if (!book || design.photoRemoved) { redrawQueue.shift(); continue; }
        item.redraw.status = 'running';
        store.save();
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
          item.redraw.done = pages.filter((p) => fs.existsSync(store.designFile(design.id, `redraw-${p}.jpg`))).length;
          fs.rmSync(store.designFile(design.id, 'book-print.pdf'), { force: true });
          store.save();
        }
        if (waited) continue;
        item.redraw.status = item.redraw.done ? 'done' : 'failed';
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
  // Pick up books that were waiting or half-done when the server restarted.
  setTimeout(() => {
    for (const order of store.listOrders()) {
      for (const item of order.items) {
        if (item.kind === 'book' && item.redraw && ['queued', 'running', 'waiting'].includes(item.redraw.status) && !redrawQueue.includes(item.id)) redrawQueue.push(item.id);
      }
    }
    runRedraws();
  }, 3000).unref();

  // ---------- Orders ----------
  app.post('/api/orders', express.json({ limit: '100kb' }), (req, res) => {
    rateLimit(req, 'orders');
    const { customer = {}, designIds } = req.body || {};
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
        status: 'queued',
        history: [{ status: 'queued', at: now }],
      };
    });
    const subtotal = round2(items.reduce((sum, i) => sum + i.price, 0));
    const shipping = shippingFor(subtotal);
    const order = store.createOrder({
      id: crypto.randomUUID(),
      createdAt: now,
      currency: CURRENCY,
      customer: c,
      items,
      subtotal,
      shipping,
      total: round2(subtotal + shipping),
      // Cash on delivery: collected by the courier.
      payment: { method: 'cod', status: 'pending' },
      lang: langOf(req),
    });
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
    const sideDef = product.sides.find((x) => x.id === side.id);
    const editor = JSON.parse(fs.readFileSync(shareFile(sh.id, 'editor.json'), 'utf8'));
    const meta = library.addCustom({
      name: { ar: nameAr || nameEn, en: nameEn || nameAr },
      category,
      product: product.id,
      color: sh.color.id,
      objects: editor[side.id].objects,
      area: sideDef.printArea,
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
    // Oldest first; an item already on the press always comes first.
    const open = all.filter((i) => i.status !== 'shipped');
    const rank = { printing: 0, queued: 1, printed: 2 };
    const queue = open
      .filter((i) => i.status !== 'printed')
      .sort((a, b) => rank[a.status] - rank[b.status] || a.orderedAt.localeCompare(b.orderedAt) || a.position - b.position);
    const toShip = open.filter((i) => i.status === 'printed').sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
    const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, all.filter((i) => i.status === s).length]));
    res.json({ current: queue[0] || null, upNext: queue.slice(1), toShip, counts });
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
      if (!allowed.includes(method)) throw new HttpError(400, 'badStatus', { list: allowed.join(', ') });
      item.process = method;
      store.save();
      if (status === undefined) return res.json(adminItem(order, item, order.items.indexOf(item)));
    }
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, 'badStatus', { list: ITEM_STATUSES.join(', ') });
    if (status === 'printing') {
      // One at a time: the press holds a single job.
      for (const o of store.listOrders()) {
        const busy = o.items.find((i) => i.status === 'printing' && i.id !== item.id);
        if (busy) throw new HttpError(409, 'pressBusy', { order: o.number, n: o.items.indexOf(busy) + 1 });
      }
    }
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
  app.get('/api/admin/files/:designId/:side', requireAdmin, async (req, res, next) => {
    try {
      const { designId, side: sideId } = req.params;
      const design = UUID_RE.test(designId) && store.getDesign(designId);
      const side = design && design.sides.find((s) => s.id === sideId);
      const order = design && design.orderId && store.getOrder(design.orderId);
      const base = design ? `${order ? order.number : 'design'}-${design.productId}-${sideId}` : '';
      if (design && design.kind === 'book') {
        const f = req.query.format || 'book-pdf';
        const title = `${base}-${design.bookId}`;
        if (f === 'proof') return res.download(store.designFile(designId, 'book-preview.png'), `${title}-cover.png`);
        if (f !== 'book-pdf' || design.photoRemoved) throw new HttpError(404, 'notFound');
        const item = order && order.items.find((it) => it.designId === design.id);
        if (item && item.redraw && ['queued', 'running', 'waiting'].includes(item.redraw.status) && req.query.now !== '1') {
          throw new HttpError(409, 'bookDrawing', { done: item.redraw.done || 0, total: item.redraw.total || 0 });
        }
        const target = store.designFile(designId, 'book-print.pdf');
        if (!fs.existsSync(target)) store.writeDesignFile(designId, 'book-print.pdf', await books.bookPdf(bookData(design), { title }));
        return res.download(target, `${title}.pdf`);
      }
      if (design && design.kind === 'gangsheet') {
        const f = req.query.format || 'sheet-pdf';
        if (f === 'proof') return res.download(store.designFile(designId, 'front-preview.png'), `${base}-proof.png`);
        if (f !== 'sheet-pdf' && f !== 'sheet-pdf-plain') throw new HttpError(404, 'notFound');
        const name = f === 'sheet-pdf' ? 'sheet-film-mirrored.pdf' : 'sheet-film.pdf';
        const target = store.designFile(designId, name);
        if (!fs.existsSync(target)) store.writeDesignFile(designId, name, (await gangSheetPdf(design, f === 'sheet-pdf')).pdf);
        return res.download(target, `${base}${SUFFIX[f]}.pdf`);
      }
      const fmt = FORMATS[req.query.format || 'png'];
      if (!side || !fmt) throw new HttpError(404, 'notFound');
      const target = store.designFile(designId, fmt.file(sideId));
      if (!fs.existsSync(target)) {
        const png = fs.readFileSync(store.designFile(designId, `${sideId}-print.png`));
        let out;
        if (fmt.make) out = await fmt.make(png, side);
        else if (fmt.ext === 'pdf') {
          const product = getProduct(design.productId);
          const label = `${order ? order.number + ' · ' : ''}${pickEn(design.productName)} · ${pickEn(design.size.label)} · ${pickEn(design.color.name)} · ${pickEn(side.name)} · trim ${side.widthIn} x ${side.heightIn} in${side.bleedIn ? ` + ${side.bleedIn} in bleed` : ''} · ${side.dpi} DPI · ${product ? product.process.toUpperCase() : ''}`;
          out = await printfiles.printPdf(png, side, { marks: req.query.format === 'pdf-marks', title: base, slug: label });
        } else throw new HttpError(404, 'notFound');
        store.writeDesignFile(designId, fmt.file(sideId), out);
      }
      res.download(target, `${base}${SUFFIX[req.query.format] || ''}.${fmt.ext}`);
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
      const batchId = `F${(store.db.nextFilmNumber = (store.db.nextFilmNumber || 0) + 1)}`;
      const at = new Date().toISOString();
      for (const it of chosen) {
        const found = store.findItem(it.id);
        if (found) found.item.filmBatch = { id: batchId, at };
      }
      store.save();
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
    if (!sh || !html) return next();
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

  // ---------- Housekeeping ----------
  // Unordered designs (abandoned carts) and old share links are removed so
  // the disk cannot fill up. Ordered designs are kept.
  const runCleanup = () => {
    try {
      // Children's photos in books: removed 30 days after the book was shipped.
      const monthAgo = Date.now() - 30 * 864e5;
      let removed = 0;
      for (const order of store.listOrders()) {
        for (const item of order.items) {
          if (item.kind !== 'book' || item.status !== 'shipped') continue;
          const shipped = (item.history || []).find((h) => h.status === 'shipped');
          const design = store.getDesign(item.designId);
          if (!design || design.photoRemoved || !shipped || Date.parse(shipped.at) > monthAgo) continue;
          for (const f of ['face.jpg', 'face-line.png', 'book-print.pdf']) fs.rmSync(store.designFile(design.id, f), { force: true });
          design.photoRemoved = true;
          removed++;
        }
      }
      if (removed) {
        store.save();
        console.log(`[cleanup] removed the child's photo from ${removed} shipped book(s)`);
      }
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
