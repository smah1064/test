'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Store } = require('./store');
const {
  PRODUCTS,
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

/** Production steps every single item moves through, in order. */
const ITEM_STATUSES = ['queued', 'printing', 'printed', 'shipped'];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDITOR_JSON_BYTES = 30 * 1024 * 1024;
const MAX_ITEMS_PER_ORDER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function decodePng(dataUrl, label) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new HttpError(400, `${label} must be a PNG data URL`);
  }
  const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new HttpError(400, `${label} is not a valid PNG`);
  }
  if (buf.length > MAX_FILE_BYTES) throw new HttpError(413, `${label} is too large`);
  return buf;
}

/** Physical print size and pixel size of a stored print file. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function cleanString(value, field, { max = 200, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

function publicProduct(p) {
  return {
    ...p,
    sides: p.sides.map((s) => ({
      ...s,
      printHeightIn: round2((s.printWidthIn * s.printArea.h) / s.printArea.w),
    })),
  };
}

function orderStatus(order) {
  const statuses = order.items.map((i) => i.status);
  if (statuses.every((s) => s === 'shipped')) return 'shipped';
  if (statuses.every((s) => s === 'queued')) return 'received';
  return 'in_production';
}

function publicItem(item) {
  return {
    id: item.id,
    designId: item.designId,
    productId: item.productId,
    productName: item.productName,
    color: item.color,
    size: item.size,
    sides: item.sides.map((s) => ({
      id: s.id,
      name: s.name,
      previewUrl: `/files/designs/${item.designId}/${s.id}-preview.png`,
    })),
    price: item.price,
    status: item.status,
    history: item.history,
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt,
    status: orderStatus(order),
    customer: { name: order.customer.name, city: order.customer.city, country: order.customer.country },
    items: order.items.map(publicItem),
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
  };
}

function adminItem(order, item, index) {
  const design = { ...publicItem(item) };
  design.sides = item.sides.map((s) => ({
    ...s,
    previewUrl: `/files/designs/${item.designId}/${s.id}-preview.png`,
    printUrl: `/api/admin/files/${item.designId}/${s.id}`,
  }));
  return {
    ...design,
    orderId: order.id,
    orderNumber: order.number,
    position: index + 1,
    of: order.items.length,
    orderedAt: order.createdAt,
    customer: order.customer,
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
      mockup: { width: MOCKUP_WIDTH, height: MOCKUP_HEIGHT },
      pricing: { extraSide: EXTRA_SIDE_PRICE, shipping: SHIPPING_FLAT, freeShippingOver: FREE_SHIPPING_OVER },
      products: PRODUCTS.map(publicProduct),
    });
  });

  // ---------- Designs ----------
  // A design is one customised product, saved when the shopper adds it to
  // the cart. It holds the editable layout plus a print-ready PNG per side.
  app.post('/api/designs', express.json({ limit: '80mb' }), (req, res) => {
    const { productId, color, size, sides } = req.body || {};
    const product = getProduct(productId);
    if (!product) throw new HttpError(400, 'Unknown product');
    const colorDef = product.colors.find((c) => c.id === color);
    if (!colorDef) throw new HttpError(400, 'Unknown colour for this product');
    const sizeDef = product.sizes.find((s) => s.id === size);
    if (!sizeDef) throw new HttpError(400, 'Unknown size for this product');
    if (!sides || typeof sides !== 'object' || Array.isArray(sides)) throw new HttpError(400, 'sides is required');

    const sideIds = Object.keys(sides);
    if (sideIds.length === 0) throw new HttpError(400, 'Design at least one side before adding to cart');

    const files = {};
    const editor = {};
    const storedSides = [];
    for (const side of product.sides) {
      if (!sideIds.includes(side.id)) continue;
      const s = sides[side.id] || {};
      if (!s.editor || typeof s.editor !== 'object' || !Array.isArray(s.editor.objects) || s.editor.objects.length === 0) {
        throw new HttpError(400, `The ${side.name.toLowerCase()} side has no design`);
      }
      const print = decodePng(s.print, `${side.name} print file`);
      const preview = decodePng(s.preview, `${side.name} preview`);
      files[`${side.id}-print.png`] = print;
      files[`${side.id}-preview.png`] = preview;
      editor[side.id] = s.editor;
      const px = pngSize(print);
      const heightIn = round2((side.printWidthIn * side.printArea.h) / side.printArea.w);
      storedSides.push({
        id: side.id,
        name: side.name,
        widthIn: side.printWidthIn,
        heightIn,
        widthPx: px.width,
        heightPx: px.height,
        dpi: Math.round(px.width / side.printWidthIn),
      });
    }
    const unknown = sideIds.filter((id) => !product.sides.some((s) => s.id === id));
    if (unknown.length) throw new HttpError(400, `Unknown side: ${unknown.join(', ')}`);

    const editorJson = JSON.stringify(editor);
    if (Buffer.byteLength(editorJson) > MAX_EDITOR_JSON_BYTES) throw new HttpError(413, 'Design is too large');
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
      orderId: null,
    };
    store.createDesign(design, files);
    res.status(201).json({
      ...design,
      previewUrl: `/files/designs/${design.id}/${storedSides[0].id}-preview.png`,
    });
  });

  // Re-open a saved design in the editor.
  app.get('/api/designs/:id', (req, res) => {
    const design = UUID_RE.test(req.params.id) && store.getDesign(req.params.id);
    if (!design) throw new HttpError(404, 'Design not found');
    const editor = JSON.parse(fs.readFileSync(store.designFile(design.id, 'editor.json'), 'utf8'));
    res.json({ ...design, editor });
  });

  // Mockup previews are public (design ids are unguessable); print files are admin-only.
  app.get('/files/designs/:id/:side-preview.png', (req, res) => {
    const { id, side } = req.params;
    const design = UUID_RE.test(id) && store.getDesign(id);
    if (!design || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'Not found');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(store.designFile(id, `${side}-preview.png`));
  });

  // ---------- Orders ----------
  app.post('/api/orders', express.json({ limit: '100kb' }), (req, res) => {
    const { customer = {}, designIds } = req.body || {};
    const c = {
      name: cleanString(customer.name, 'Name', { max: 120 }),
      email: cleanString(customer.email, 'Email', { max: 200 }),
      address1: cleanString(customer.address1, 'Address', { max: 200 }),
      address2: cleanString(customer.address2, 'Address line 2', { max: 200, required: false }),
      city: cleanString(customer.city, 'City', { max: 100 }),
      region: cleanString(customer.region, 'State / region', { max: 100, required: false }),
      postalCode: cleanString(customer.postalCode, 'Postal code', { max: 20 }),
      country: cleanString(customer.country, 'Country', { max: 100 }),
    };
    if (!EMAIL_RE.test(c.email)) throw new HttpError(400, 'Email address looks invalid');
    if (!Array.isArray(designIds) || designIds.length === 0) throw new HttpError(400, 'Your cart is empty');
    if (designIds.length > MAX_ITEMS_PER_ORDER) throw new HttpError(400, `At most ${MAX_ITEMS_PER_ORDER} items per order`);
    if (new Set(designIds).size !== designIds.length) throw new HttpError(400, 'Each design can only be ordered once');

    const designs = designIds.map((id) => {
      const d = typeof id === 'string' && UUID_RE.test(id) && store.getDesign(id);
      if (!d) throw new HttpError(400, 'A design in your cart no longer exists');
      if (d.orderId) throw new HttpError(409, 'A design in your cart was already ordered');
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
        productName: d.productName,
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
      customer: c,
      items,
      subtotal,
      shipping,
      total: round2(subtotal + shipping),
      payment: { method: 'demo', status: 'paid' },
    });
    res.status(201).json(publicOrder(order));
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = UUID_RE.test(req.params.id) && store.getOrder(req.params.id);
    if (!order) throw new HttpError(404, 'Order not found');
    res.json(publicOrder(order));
  });

  // ---------- Production (admin) ----------
  const requireAdmin = (req, res, next) => {
    const given = crypto.createHash('sha256').update(String(req.get('x-admin-password') || '')).digest();
    if (!crypto.timingSafeEqual(given, adminHash)) throw new HttpError(401, 'Wrong admin password');
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
      customer: o.customer,
      items: o.items.map((item, i) => adminItem(o, item, i)),
    }));
    res.json({ orders });
  });

  app.patch('/api/admin/items/:itemId', requireAdmin, express.json(), (req, res) => {
    const { status } = req.body || {};
    if (!ITEM_STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${ITEM_STATUSES.join(', ')}`);
    const found = store.findItem(req.params.itemId);
    if (!found) throw new HttpError(404, 'Item not found');
    const { order, item } = found;
    if (status === 'printing') {
      // One at a time: the press holds a single job.
      for (const o of store.listOrders()) {
        const busy = o.items.find((i) => i.status === 'printing' && i.id !== item.id);
        if (busy) throw new HttpError(409, `${o.number} item ${o.items.indexOf(busy) + 1} is already printing. Finish it first.`);
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
    if (!design || !design.sides.some((s) => s.id === side)) throw new HttpError(404, 'Not found');
    const order = design.orderId && store.getOrder(design.orderId);
    const name = `${order ? order.number : 'design'}-${design.productId}-${side}.png`;
    res.download(store.designFile(designId, `${side}-print.png`), name);
  });

  // ---------- Static site ----------
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Something went wrong' : err.type === 'entity.too.large' ? 'Upload is too large' : err.message;
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp, ITEM_STATUSES };
