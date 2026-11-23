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

/** Production steps every single item moves through, in order. */
const ITEM_STATUSES = ['queued', 'printing', 'printed', 'shipped'];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDITOR_JSON_BYTES = 30 * 1024 * 1024;
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

function decodePng(dataUrl, side, kind) {
  const label = { en: `${side.name.en} ${FILE_LABELS[kind].en}`, ar: `${FILE_LABELS[kind].ar} (${side.name.ar})` };
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new HttpError(400, 'notPng', { label });
  const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'badPng', { label });
  if (buf.length > MAX_FILE_BYTES) throw new HttpError(413, 'tooLarge', { label });
  return buf;
}

/** Pixel size of a PNG. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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
  };
}

function createApp({ dataDir, adminPassword }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  const store = new Store(dataDir);
  const app = express();
  const adminHash = crypto.createHash('sha256').update(adminPassword).digest();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // ---------- Catalog ----------
  app.get('/api/products', (req, res) => {
    res.json({
      currency: CURRENCY,
      mockup: { width: MOCKUP_WIDTH, height: MOCKUP_HEIGHT },
      pricing: { extraSide: EXTRA_SIDE_PRICE, shipping: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER },
      categories: CATEGORIES,
      governorates: GOVERNORATES,
      products: PRODUCTS.map(publicProduct),
    });
  });

  // ---------- Designs ----------
  // A design is one customised product, saved when the shopper adds it to
  // the cart. It holds the editable layout plus a print-ready PNG per side.
  app.post('/api/designs', express.json({ limit: '80mb' }), (req, res) => {
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

    const files = {};
    const editor = {};
    const storedSides = [];
    for (const side of product.sides) {
      if (!sideIds.includes(side.id)) continue;
      const s = sides[side.id] || {};
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0) {
        throw new HttpError(400, 'sideEmpty', { side: side.name });
      }
      const print = decodePng(s.print, side, 'print');
      const preview = decodePng(s.preview, side, 'preview');
      files[`${side.id}-print.png`] = print;
      files[`${side.id}-preview.png`] = preview;
      editor[side.id] = s.editor;
      const px = pngSize(print);
      storedSides.push({
        id: side.id,
        name: side.name,
        widthIn: side.printWidthIn,
        heightIn: heightIn(side),
        widthPx: px.width,
        heightPx: px.height,
        dpi: Math.round(px.width / side.printWidthIn),
      });
    }

    const editorJson = JSON.stringify(editor);
    if (Buffer.byteLength(editorJson) > MAX_EDITOR_JSON_BYTES) throw new HttpError(413, 'designTooLarge');
    files['editor.json'] = editorJson;

    const design = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      color: { id: colorDef.id, name: colorDef.name, hex: colorDef.hex },
      size: { id: sizeDef.id, label: sizeDef.label },
      sides: storedSides,
      price: priceFor(product, sizeDef.id, storedSides.length),
      currency: CURRENCY,
      orderId: null,
    };
    store.createDesign(design, files);
    res.status(201).json({ ...design, previewUrl: `/files/designs/${design.id}/${storedSides[0].id}-preview.png` });
  });

  // Re-open a saved design in the editor.
  app.get('/api/designs/:id', (req, res) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'designNotFound');
    const editor = JSON.parse(fs.readFileSync(store.designFile(design.id, 'editor.json'), 'utf8'));
    res.json({ ...design, editor });
  });

  // Mockup previews are public (design ids are unguessable); print files are admin-only.
  app.get('/files/designs/:id/:side-preview.png', (req, res) => {
    const { id, side } = req.params;
    const design = UUID_RE.test(id) && store.getDesign(id);
    if (!design || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'notFound');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(store.designFile(id, `${side}-preview.png`));
  });

  // ---------- Orders ----------
  app.post('/api/orders', express.json({ limit: '100kb' }), (req, res) => {
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
      if (!d) throw new HttpError(400, 'designGone');
      if (d.orderId) throw new HttpError(409, 'designOrdered');
      return d;
    });

    const now = new Date().toISOString();
    // One order line per design, always quantity 1: every item is its own print job.
    const items = designs.map((d) => {
      const product = getProduct(d.productId);
      return {
        id: crypto.randomUUID(),
        designId: d.id,
        productId: d.productId,
        productName: product.name,
        color: d.color,
        size: d.size,
        sides: d.sides,
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
    });
    res.status(201).json(publicOrder(order));
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'orderNotFound');
    res.json(publicOrder(order));
  });

  // ---------- Production (admin) ----------
  const requireAdmin = (req, res, next) => {
    const given = crypto.createHash('sha256').update(String(req.get('x-admin-password') || '')).digest();
    if (!crypto.timingSafeEqual(given, adminHash)) throw new HttpError(401, 'wrongPassword');
    next();
  };

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
    }));
    res.json({ orders });
  });

  app.patch('/api/admin/items/:itemId', requireAdmin, express.json(), (req, res) => {
    const { status } = req.body || {};
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, 'badStatus', { list: ITEM_STATUSES.join(', ') });
    const found = store.findItem(req.params.itemId);
    if (!found) throw new HttpError(404, 'itemNotFound');
    const { order, item } = found;
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

  app.get('/api/admin/files/:designId/:side', requireAdmin, (req, res) => {
    const { designId, side } = req.params;
    const design = UUID_RE.test(designId) && store.getDesign(designId);
    if (!design || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'notFound');
    const order = design.orderId && store.getOrder(design.orderId);
    const name = `${order ? order.number : 'design'}-${design.productId}-${side}.png`;
    res.download(store.designFile(designId, `${side}-print.png`), name);
  });

  // ---------- Static site ----------
  app.use('/fonts', express.static(path.join(__dirname, '..', 'public', 'fonts'), { maxAge: '30d', immutable: true }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: format('notFound', {}, langOf(req)) }));

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
