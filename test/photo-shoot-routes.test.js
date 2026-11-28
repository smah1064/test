'use strict';

// "New product from photo", slice 2 (src/photo-product-routes.js): the photo session. Mounted on a bare express app
// with the real catalogue, store (a temporary data folder), sharp and src/roles.js, a small admin gate that works like
// app.js's (permissions, holding a team member's change for an owner with the route's approval check, running it again
// unchanged when approved), a stub background remover and a stub calibration card.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const roles = require('../src/roles');
const catalog = require('../src/catalog');
const { PRODUCTS } = require('../src/products');
const { Store } = require('../src/store');
const { format } = require('../src/i18n');
const photoRoutes = require('../src/photo-product-routes');

class HttpError extends Error {
  constructor(status, key, params = {}) {
    super(key);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

catalog.init(PRODUCTS);
const PEOPLE = {
  owner: { id: 'u-owner', name: 'mona', shown: 'Mona', roles: ['owner'] },
  cat: { id: 'u-cat', name: 'karim', shown: 'Karim', roles: ['catalogue'] },
  fin: { id: 'u-fin', name: 'salma', shown: 'Salma', roles: ['finance'] },
};
const whoOf = (k) => ({ ...PEOPLE[k], role: roles.mainRole(PEOPLE[k].roles), perms: roles.permsOf(PEOPLE[k].roles) });

let server;
let base;
let dataDir;
let store;
let mounted;
const held = [];
const bg = { mode: 'ok', calls: 0 };
const card = { calls: 0 };

/** An RGBA picture: a dark rectangle (the product) on light grey; `alpha`: the background transparent instead. */
async function picture(w, h, { box = [0.3, 0.2, 0.4, 0.6], alpha = false } = {}) {
  const buf = Buffer.alloc(w * h * 4);
  const [bx, by, bw, bh] = box;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= bx * w && x < (bx + bw) * w && y >= by * h && y < (by + bh) * h;
      buf[i] = buf[i + 1] = buf[i + 2] = inside ? 60 : 225;
      buf[i + 3] = alpha && !inside ? 0 : 255;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } });
}
const jpegWithExif = async (w, h) => (await picture(w, h)).jpeg()
  .withMetadata({ orientation: 6 }).withExif({ IFD0: { Copyright: 'secret-gps-owner', Artist: 'phone' } }).toBuffer();

// The shop's stable key (src/security.js Auth.picsKey); the same in every copy of the app.
const PICS_KEY = Buffer.alloc(32, 7);
function makeApp() {
  const app = express();
  const syncCatalog = () => catalog.apply(PRODUCTS, store.db.catalog);
  const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
  const edits = () => (store.db.catalog && store.db.catalog.products) || {};
  const logCatalog = (db, req, productId, what) => {
    db.catalogLog ||= [];
    db.catalogLog.push({ at: new Date().toISOString(), who: req.adminWho.name, productId, what });
  };
  let checks = {};
  const guard = (req, res, next) => {
    const key = `${req.method === 'HEAD' ? 'GET' : req.method} ${req.route.path}`;
    const route = roles.routeOf(req.method, req.route.path);
    const replay = req.get('x-replay');
    let who;
    if (replay) {
      const a = held.find((x) => x.id === replay);
      who = { ...whoOf(a.by), approvalId: a.id, approvedBy: 'Mona' };
    } else {
      if (!PEOPLE[req.get('x-who')]) throw new HttpError(401, 'signInAgain');
      who = whoOf(req.get('x-who'));
      const allowed = route.perm === 'owner-only' ? who.role === 'owner' : !route.perm || who.perms.has(route.perm);
      if (!allowed) throw new HttpError(403, 'noPermission');
    }
    req.adminWho = who;
    if (route.approve && who.role !== 'owner' && !who.approvalId) {
      return express.json({ limit: route.limit || '100kb' })(req, res, async (err) => {
        try {
          if (err) throw err;
          if (checks[key]) await checks[key](req);
          const a = { id: `a${held.length + 1}`, status: 'pending', action: key, method: req.method, path: req.originalUrl, by: req.get('x-who'), body: req.body };
          held.push(a);
          res.status(202).json({ pending: true, approval: { id: a.id }, body: a.body });
        } catch (e) {
          next(e);
        }
      });
    }
    next();
  };
  const bgremove = {
    async removeBackground(image) {
      bg.calls++;
      if (bg.mode !== 'ok') { const e = new Error(bg.mode); e.reason = bg.mode; throw e; }
      const m = await sharp(image).metadata();
      return (await picture(m.width, m.height, { alpha: true })).png().toBuffer();
    },
  };
  const calibrationCard = { cardPdf: async () => { card.calls++; return Buffer.from('%PDF-1.4 card'); } };
  const r = photoRoutes.mount(app, {
    picsKey: PICS_KEY,
    store, guard, HttpError, catalog, getProduct, PRODUCTS, syncCatalog, logCatalog,
    adminProduct: (p) => catalog.forAdmin(p, edits()[p.id]),
    saveProductEdit: (req, product, body) => store.mutate((db) => { db.pricing ||= {}; db.pricing[product.id] = body.prices; }),
    approvalsAll: () => held, dataDir, sharp: () => sharp, bgremove, calibrationCard,
  });
  checks = r.approvalChecks;
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && status !== 503) console.error(err);
    const key = err.key || (status === 404 ? 'notFound' : status === 413 ? 'uploadTooLarge' : 'badRequest');
    res.status(status).json({ error: format(key, err.params || {}, 'en'), code: key, ...(err.params && typeof err.params.field === 'string' && err.params.field ? { field: err.params.field } : {}) });
  });
  return { app, r };
}

const call = async (url, method = 'GET', body, who = 'owner', headers = {}) => {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}), ...(who ? { 'x-who': who } : {}), ...headers },
    body: body === undefined ? undefined : raw || typeof body === 'string' ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text: buf.toString('utf8').slice(0, 400), buf, headers: r.headers };
};
const approve = (id) => {
  const a = held.find((x) => x.id === id);
  a.status = 'approved';
  return call(a.path, a.method, a.body, null, { 'x-replay': id });
};
const api = (sid, rest = '') => `/api/admin/photo-products/${sid}${rest}`;
const TYPED = { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 5, printHeightMm: 100 };
// Measured from the photos: within 1 % of the typed numbers, a slightly bellied body.
const MEASURED = {
  heightMm: 121, topDiaMm: 90.5, bottomDiaMm: 65.3,
  profile: [[0, 45.2], [30, 42.3], [60, 39.4], [90, 36], [121, 32.6]],
  handle: null, bandLinearityMm: 0.3, front: { pxPerMm: 4, axisXpx: 300, rimYpx: 100, baseYpx: 584 },
};
const CARD = { corners: [[100, 80], [700, 80], [100, 560], [700, 560]], method: 'auto', rmsPx: 0.4, pxPerMm: 3.75, wb: [1.02, 1, 0.97], tiltDeg: 2, ok: true, gates: { sharp: true } };

/** A session with the front and 3/4 photos, the card, typed + measured numbers, the straightened front and mask. */
async function readyShoot(over = {}) {
  const r = await call('/api/admin/photo-products', 'POST', { kind: 'tumbler', handle: false });
  assert.strictEqual(r.status, 201, r.text);
  const sid = r.json.shoot.id;
  const front = await (await picture(800, 1000)).jpeg().toBuffer();
  assert.strictEqual((await call(api(sid, '/shots/front'), 'POST', front)).status, 201);
  assert.strictEqual((await call(api(sid, '/shots/threeq'), 'POST', front)).status, 201);
  assert.strictEqual((await call(api(sid, '/assets/front.webp'), 'POST', await (await picture(600, 700)).webp().toBuffer())).status, 201);
  const mask = await (await picture(600, 700, { box: [0.25, 0.14, 0.5, 0.7] })).negate({ alpha: false }).greyscale().png().toBuffer();
  const m = await call(api(sid, '/assets/front-mask.png'), 'POST', mask);
  assert.strictEqual(m.status, 201, m.text);
  const put = await call(api(sid), 'PUT', { typed: TYPED, measured: MEASURED, material: 'metal', cardScale: 1.01, shots: { front: { card: CARD } }, ...over });
  assert.strictEqual(put.status, 200, put.text);
  return sid;
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-photo-shoot-'));
  store = new Store(dataDir);
  const { app, r } = makeApp();
  mounted = r;
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('roles: the session is the catalogue team\'s own workspace; only making the product waits for an owner', () => {
  const r = (m, p) => roles.routeOf(m, p);
  for (const p of ['/api/admin/photo-products/card.pdf', '/api/admin/photo-products', '/api/admin/photo-products/:sid', '/api/admin/photo-products/:sid/files/:name']) {
    assert.strictEqual(r('GET', p).perm, 'catalog.view', p);
    assert.ok(!r('GET', p).approve, p);
  }
  for (const [m, p] of [['POST', '/api/admin/photo-products'], ['PUT', '/api/admin/photo-products/:sid'], ['POST', '/api/admin/photo-products/:sid/shots/:view'],
    ['POST', '/api/admin/photo-products/:sid/cutout/:view'], ['POST', '/api/admin/photo-products/:sid/assets/:name'], ['POST', '/api/admin/photo-products/:sid/build']]) {
    assert.strictEqual(r(m, p).perm, 'catalog.edit', p);
    assert.ok(!r(m, p).approve, p);
  }
  const prod = r('POST', '/api/admin/photo-products/:sid/product');
  assert.strictEqual(prod.perm, 'catalog.edit');
  assert.strictEqual(prod.approve, true);
  assert.ok(prod.label.en && prod.label.ar);
  assert.strictEqual(r('PUT', '/api/admin/photo-products/:sid').limit, '64kb');
  assert.strictEqual(r('POST', '/api/admin/photo-products/:sid/shots/:view').raw, '12mb');
  assert.strictEqual(r('POST', '/api/admin/catalog/:id/drinkware/check').perm, 'owner-only');
});

test('the calibration card PDF (helper B\'s cardPdf, made once)', async () => {
  const a = await call('/api/admin/photo-products/card.pdf', 'GET', undefined, 'cat');
  assert.strictEqual(a.status, 200);
  assert.match(a.headers.get('content-type'), /application\/pdf/);
  assert.ok(a.buf.toString().startsWith('%PDF'));
  await call('/api/admin/photo-products/card.pdf');
  assert.strictEqual(card.calls, 1);
  assert.strictEqual((await call('/api/admin/photo-products/card.pdf', 'GET', undefined, 'fin')).status, 403);
  assert.strictEqual((await call('/api/admin/photo-products/card.pdf', 'GET', undefined, null)).status, 401);
});

test('the real calibration card, when src/calibration-card.js is there', { skip: !fs.existsSync(path.join(__dirname, '..', 'src', 'calibration-card.js')) }, async () => {
  const pdf = await require('../src/calibration-card').cardPdf();
  assert.ok(Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === '%PDF');
});

test('start a session: checked, listed newest first, and limited', async () => {
  for (const [b, field] of [[{ kind: 'vase', handle: false }, 'kind'], [{ kind: 'cup', handle: 'yes' }, 'handle'], [{ kind: 'cup', handle: false, x: 1 }, 'x']]) {
    const r = await call('/api/admin/photo-products', 'POST', b);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.field, field);
  }
  assert.strictEqual((await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false }, 'fin')).status, 403);
  const a = await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false }, 'cat');
  assert.strictEqual(a.status, 201, 'no approval: a private workspace');
  const s = a.json.shoot;
  assert.match(s.id, /^[a-f0-9]{12}$/);
  assert.strictEqual(s.status, 'shooting');
  assert.strictEqual(s.template, 'tumbler');
  assert.strictEqual(s.material, 'gloss');
  assert.strictEqual(s.createdBy, 'Karim');
  await new Promise((r) => setTimeout(r, 5));
  const b = await call('/api/admin/photo-products', 'POST', { kind: 'mug', handle: true });
  assert.strictEqual(b.json.shoot.template, 'mug');
  const list = await call('/api/admin/photo-products', 'GET', undefined, 'cat');
  assert.deepStrictEqual(list.json.shoots.slice(0, 2).map((x) => x.id), [b.json.shoot.id, s.id]);
  assert.strictEqual((await call(api(s.id))).json.shoot.id, s.id);
  assert.strictEqual((await call(api('0123456789ab'))).status, 404);
  assert.strictEqual((await call(api('..%2F..%2Fx'))).status, 404);
});

test('a shot: any phone photo, turned upright, re-encoded as JPEG without EXIF, ≤ 3000 px, with a small copy', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  const raw = await jpegWithExif(1200, 900);
  assert.ok((await sharp(raw).metadata()).exif, 'the test photo has EXIF');
  const r = await call(api(sid, '/shots/front'), 'POST', raw, 'cat');
  assert.strictEqual(r.status, 201, r.text);
  assert.deepStrictEqual([r.json.shot.w, r.json.shot.h], [900, 1200], 'orientation 6: turned upright');
  assert.strictEqual(r.json.shot.card, null);
  const f = await call(api(sid, '/files/front.jpg'));
  assert.strictEqual(f.status, 200);
  assert.match(f.headers.get('content-type'), /image\/jpeg/);
  const meta = await sharp(f.buf).metadata();
  assert.strictEqual(meta.exif, undefined, 'EXIF (GPS, owner) gone');
  assert.ok(!f.buf.includes(Buffer.from('secret-gps-owner')));
  assert.strictEqual(meta.orientation, undefined);
  const t = await call(api(sid, '/files/front-thumb.webp'));
  assert.ok(Math.max((await sharp(t.buf).metadata()).width, (await sharp(t.buf).metadata()).height) <= 800);
  // Big photos come down to 3000 px; PNG and WebP are taken too.
  const big = await call(api(sid, '/shots/side'), 'POST', await (await picture(4000, 3000)).png({ compressionLevel: 1 }).toBuffer());
  assert.strictEqual(big.status, 201, big.text);
  assert.deepStrictEqual([big.json.shot.w, big.json.shot.h], [3000, 2250]);
  assert.strictEqual((await call(api(sid, '/shots/back'), 'POST', await (await picture(600, 600)).webp().toBuffer())).status, 201);
  // Refused: not a photo, a GIF, a tiny one, too many pixels, too big, an unknown view.
  assert.strictEqual((await call(api(sid, '/shots/top'), 'POST', Buffer.from('x'.repeat(500)))).json.code, 'photoShotBad');
  assert.strictEqual((await call(api(sid, '/shots/top'), 'POST', await (await picture(400, 400)).gif().toBuffer())).json.code, 'photoShotBad');
  assert.strictEqual((await call(api(sid, '/shots/top'), 'POST', await (await picture(200, 120)).jpeg().toBuffer())).json.code, 'photoShotBad');
  const huge = await sharp({ create: { width: 8000, height: 5100, channels: 3, background: '#ddd' } }).jpeg({ quality: 30 }).toBuffer();
  assert.strictEqual((await call(api(sid, '/shots/top'), 'POST', huge)).json.code, 'photoShotBad', 'over 40 megapixels');
  assert.strictEqual((await call(api(sid, '/shots/top'), 'POST', Buffer.alloc(12 * 1024 * 1024 + 10))).status, 413);
  assert.strictEqual((await call(api(sid, '/shots/inside'), 'POST', raw)).status, 404);
  assert.strictEqual((await call(api(sid, '/shots/front'), 'POST', raw, 'fin')).status, 403);
  const s = (await call(api(sid))).json.shoot;
  assert.deepStrictEqual(Object.keys(s.shots).sort(), ['back', 'front', 'side']);
  assert.ok(s.bytes > 0 && s.bytes < s.maxBytes);
  assert.ok(s.files.some((x) => x.name === 'side.jpg' && x.url === api(sid, '/files/side.jpg')));
});

test('files: whitelisted names of this session only; nothing built from the request as it is', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  await call(api(sid, '/shots/front'), 'POST', await (await picture(600, 800)).jpeg().toBuffer());
  for (const name of ['..%2F..%2Fdb.json', 'front.png', 'front.jpg.bak', 'x.jpg', '.front.jpg', 'side.jpg', 'front-mask.png', 'front.webp']) {
    assert.strictEqual((await call(api(sid, `/files/${name}`))).status, 404, name);
  }
  assert.strictEqual((await call(api(sid, '/files/front.jpg'), 'GET', undefined, null)).status, 401);
  assert.strictEqual((await call(api(sid, '/files/front.jpg'), 'GET', undefined, 'fin')).status, 403);
  assert.strictEqual((await call(api(sid, '/files/front.jpg'), 'GET', undefined, 'cat')).status, 200);
});

test('a session is limited to 40 MB of files', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  const keep = photoRoutes.SHOOT.maxBytes;
  photoRoutes.SHOOT.maxBytes = 60 * 1024;
  try {
    const noisy = async (seed) => {
      const w = 700;
      const buf = Buffer.alloc(w * w * 3);
      let x = seed;
      for (let i = 0; i < buf.length; i++) { x = (x * 1103515245 + 12345) >>> 0; buf[i] = x >>> 24; }
      return sharp(buf, { raw: { width: w, height: w, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    };
    const first = await call(api(sid, '/shots/front'), 'POST', await noisy(1));
    assert.strictEqual(first.status, 413, first.text);
    assert.strictEqual(first.json.code, 'photoShootFull');
    photoRoutes.SHOOT.maxBytes = 2 * 1024 * 1024;
    let r;
    for (const v of ['front', 'side', 'back', 'top', 'bottom', 'threeq', 'print', 'surface']) {
      r = await call(api(sid, `/shots/${v}`), 'POST', await noisy(v.length * 7));
      if (r.status !== 201) break;
    }
    assert.strictEqual(r.json.code, 'photoShootFull');
    // Taking one again counts the new one instead of the old one.
    assert.strictEqual((await call(api(sid, '/shots/front'), 'POST', await noisy(99))).status, 201);
  } finally {
    photoRoutes.SHOOT.maxBytes = keep;
  }
});

test('saving a step: typed numbers, the card, measurements, material: every value checked', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  // A card on a photo not taken yet.
  assert.strictEqual((await call(api(sid), 'PUT', { shots: { front: { card: CARD } } })).json.code, 'photoShotMissing');
  await call(api(sid, '/shots/front'), 'POST', await (await picture(800, 600)).jpeg().toBuffer());
  const bad = [
    [{ shots: { front: { card: { ...CARD, corners: [[100, 80], [900, 80], [100, 560], [700, 560]] } } } }, 'photoCardOutside'],
    [{ shots: { front: { card: { ...CARD, corners: [[1, 2], [3, 4], [5, 6]] } } } }, 'drinkwareField'],
    [{ shots: { front: { card: { ...CARD, corners: [[1, 2], [3, 4], [5, 6], [7, 'x']] } } } }, 'drinkwareField'],
    [{ shots: { front: { card: { ...CARD, pxPerMm: -1 } } } }, 'drinkwareRange'],
    [{ shots: { front: { card: { ...CARD, method: 'magic' } } } }, 'drinkwareField'],
    [{ shots: { front: { card: { ...CARD, H: [1, 2, 3] } } } }, 'drinkwareField'],
    [{ shots: { front: { other: 1 } } }, 'badProductField'],
    [{ shots: { garden: { card: null } } }, 'badProductField'],
    [{ typed: { heightMm: 500 } }, 'drinkwareRange'],
    [{ typed: { heightMm: 100, printTopMm: 20, printHeightMm: 90 } }, 'drinkwareBand'],
    [{ typed: { heightMm: 60, topDiaMm: 120, bottomDiaMm: 40 } }, 'drinkwareTaper'],
    [{ typed: { ...TYPED, handle: { widthMm: 20, y0Mm: 10, y1Mm: 80 } } }, 'badProductField'],
    [{ typed: { heightMm: 100, colour: 'red' } }, 'badProductField'],
    [{ measured: { ...MEASURED, profile: [[0, 45], [50, 40], [40, 39]] } }, 'photoProfileBad'],
    [{ measured: { ...MEASURED, profile: Array.from({ length: 65 }, (x, i) => [i, 40]) } }, 'photoProfileBad'],
    [{ measured: { ...MEASURED, profile: [[0, 45], [60, -1]] } }, 'photoProfileBad'],
    [{ measured: { ...MEASURED, heightMm: 'tall' } }, 'drinkwareRange'],
    [{ measured: { ...MEASURED, front: { pxPerMm: 4, axisXpx: 300 } } }, 'drinkwareField'],
    [{ measured: { ...MEASURED, front: { ...MEASURED.front, baseYpx: 50 } } }, 'drinkwareField'],
    [{ measured: { ...MEASURED, extra: 1 } }, 'badProductField'],
    [{ material: 'glass' }, 'drinkwareField'],
    [{ cardScale: 2 }, 'drinkwareRange'],
    [{ status: 'built' }, 'badProductField'],
  ];
  for (const [b, code] of bad) {
    const r = await call(api(sid), 'PUT', b);
    assert.strictEqual(r.json && r.json.code, code, `${JSON.stringify(b).slice(0, 120)} -> ${r.text}`);
  }
  assert.strictEqual((await call(api(sid), 'PUT', 'x'.repeat(70 * 1024))).status, 413);
  // Partly filled in: saved, still shooting.
  let r = await call(api(sid), 'PUT', { typed: { heightMm: '120', topDiaMm: 90 }, shots: { front: { card: CARD } } }, 'cat');
  assert.strictEqual(r.status, 200, r.text);
  const s = r.json.shoot;
  assert.deepStrictEqual(s.typed, { heightMm: 120, topDiaMm: 90 });
  assert.strictEqual(s.status, 'shooting');
  assert.deepStrictEqual(Object.keys(s.shots.front.card).sort(), ['corners', 'method', 'pxPerMm', 'rmsPx', 'tiltDeg', 'wb'], 'only what is needed is kept');
  r = await call(api(sid), 'PUT', { typed: TYPED, measured: { ...MEASURED, front: undefined } });
  assert.strictEqual(r.json.shoot.status, 'measured');
  assert.ok(r.json.shoot.rev > s.rev);
  // A new front photo: its card and measurements go with the old one.
  await call(api(sid, '/shots/front'), 'POST', await (await picture(800, 600)).jpeg().toBuffer());
  const after = (await call(api(sid))).json.shoot;
  assert.strictEqual(after.shots.front.card, null);
  assert.strictEqual(after.measured, null);
  assert.strictEqual(after.status, 'shooting');
});

test('cut-out on the server: a mask of the shot; busy or off -> 503 for the browser\'s own', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  assert.strictEqual((await call(api(sid, '/cutout/front'), 'POST')).json.code, 'photoShotMissing');
  await call(api(sid, '/shots/front'), 'POST', await (await picture(500, 700)).jpeg().toBuffer());
  const r = await call(api(sid, '/cutout/front'), 'POST', undefined, 'cat');
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.headers.get('content-type'), /image\/png/);
  const m = await sharp(r.buf).metadata();
  assert.deepStrictEqual([m.width, m.height, m.channels], [500, 700, 1]);
  const cov = Number(r.headers.get('x-mask-coverage'));
  assert.ok(Math.abs(cov - 0.24) < 0.02, String(cov));
  const s = (await call(api(sid))).json.shoot;
  assert.strictEqual(s.cutouts.front.coverage, cov);
  assert.strictEqual((await call(api(sid, '/files/front-cutout.png'))).status, 200);
  for (const [mode, status, code] of [['off', 503, 'bgOff'], ['busy', 503, 'bgBusy'], ['loading', 503, 'bgLoading'], ['failed', 503, 'bgFailed'], ['bad', 400, 'photoShotBad']]) {
    bg.mode = mode;
    const x = await call(api(sid, '/cutout/front'), 'POST');
    assert.strictEqual(x.status, status, mode);
    assert.strictEqual(x.json.code, code, mode);
  }
  bg.mode = 'ok';
  assert.strictEqual((await call(api(sid, '/cutout/nope'), 'POST')).status, 404);
});

test('the straightened front and its mask: re-encoded, sizes and coverage checked', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  const mask = async (w, h, box) => (await picture(w, h, { box })).negate({ alpha: false }).greyscale().png().toBuffer();
  assert.strictEqual((await call(api(sid, '/assets/front-mask.png'), 'POST', await mask(600, 700))).json.code, 'photoShootNoAssets');
  assert.strictEqual((await call(api(sid, '/assets/front.webp'), 'POST', await (await picture(1200, 900)).webp().toBuffer())).json.code, 'photoAssetBad', 'wider than 1000 px');
  assert.strictEqual((await call(api(sid, '/assets/front-shade.webp'), 'POST', await (await picture(600, 700)).webp().toBuffer())).status, 404, 'slice 3');
  assert.strictEqual((await call(api(sid, '/assets/..%2Fx.webp'), 'POST', Buffer.alloc(200))).status, 404);
  const f = await call(api(sid, '/assets/front.webp'), 'POST', await (await picture(600, 700)).png().toBuffer(), 'cat');
  assert.strictEqual(f.status, 201, f.text);
  assert.deepStrictEqual([f.json.asset.w, f.json.asset.h], [600, 700]);
  assert.strictEqual((await sharp((await call(api(sid, '/files/front.webp'))).buf).metadata()).format, 'webp');
  assert.strictEqual((await call(api(sid, '/assets/front-mask.png'), 'POST', await mask(601, 700))).json.code, 'photoMaskBad', 'not the same size');
  assert.strictEqual((await call(api(sid, '/assets/front-mask.png'), 'POST', await mask(600, 700, [0.4, 0.4, 0.05, 0.05]))).json.code, 'photoMaskBad', 'too little');
  assert.strictEqual((await call(api(sid, '/assets/front-mask.png'), 'POST', await mask(600, 700, [0, 0, 1, 0.9]))).json.code, 'photoMaskBad', 'too much');
  const ok = await call(api(sid, '/assets/front-mask.png'), 'POST', await mask(600, 700, [0.25, 0.14, 0.5, 0.7]));
  assert.strictEqual(ok.status, 201, ok.text);
  assert.ok(Math.abs(ok.json.asset.coverage - 0.35) < 0.02);
  // A transparent PNG works too (its alpha is the mask).
  const alpha = await (await picture(600, 700, { alpha: true })).png().toBuffer();
  assert.strictEqual((await call(api(sid, '/assets/front-mask.png'), 'POST', alpha)).status, 201);
  // A new straightened front: the old mask goes.
  await call(api(sid, '/assets/front.webp'), 'POST', await (await picture(500, 700)).webp().toBuffer());
  assert.strictEqual((await call(api(sid))).json.shoot.assets['front-mask.png'], undefined);
});

test('build: diffs and warnings worked out on the server from the stored numbers', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  assert.strictEqual((await call(api(sid, '/build'), 'POST')).json.code, 'photoShootNotMeasured');
  await call(api(sid), 'PUT', { typed: TYPED, measured: { ...MEASURED, heightMm: 124, bandLinearityMm: 0.8, front: undefined } });
  const r = await call(api(sid, '/build'), 'POST', undefined, 'cat');
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(r.json.diffs, { heightPct: 3.3, topPct: 0.6, bottomPct: 0.5, warn: ['heightPct'] });
  assert.deepStrictEqual(r.json.warnings.sort(), ['curvedBody', 'heightDiff', 'noFrontCard', 'noFrontPhoto']);
  assert.strictEqual(r.json.shoot.status, 'built');
  assert.strictEqual(r.json.shoot.built.profileFrom, 'typed', 'over 2 %: the straight typed cone');
  assert.deepStrictEqual(r.json.spec.profile, [[0, 45], [120, 32.5]]);
  assert.strictEqual(r.json.fan.template, 'fan');
  // Any change afterwards: built again before a product.
  const put = await call(api(sid), 'PUT', { material: 'matte' });
  assert.strictEqual(put.json.shoot.status, 'measured');
  // A handle session needs the handle's size.
  const h = (await call('/api/admin/photo-products', 'POST', { kind: 'mug', handle: true })).json.shoot.id;
  await call(api(h), 'PUT', { typed: TYPED, measured: { ...MEASURED, front: undefined } });
  assert.strictEqual((await call(api(h, '/build'), 'POST')).json.code, 'photoShootNoHandle');
  await call(api(h), 'PUT', { measured: { ...MEASURED, front: undefined, handle: { y0Mm: 20, y1Mm: 100, widthMm: 15 } } });
  const hb = await call(api(h, '/build'), 'POST');
  assert.strictEqual(hb.status, 200, hb.text);
  assert.deepStrictEqual(hb.json.spec.handle, { y0Mm: 19.8, y1Mm: 99.2, widthMm: 15 }, 'measured on the side photo, scaled to the typed height');
});

test('the product: held for an owner, made from the session as approved, photos and public shots', async () => {
  const sid = await readyShoot();
  const before = await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'Photo tumbler', ar: 'تمبلر من الصور' } }, 'cat');
  assert.strictEqual(before.json.code, 'photoShootNotBuilt');
  const b = await call(api(sid, '/build'), 'POST', undefined, 'cat');
  assert.deepStrictEqual(b.json.warnings, []);
  assert.strictEqual(b.json.shoot.built.profileFrom, 'measured');
  // Refused at once: a taken code, a missing name, a bad price.
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'mug', name: { en: 'x', ar: 'y' } }, 'cat')).json.code, 'productIdTaken');
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'x' } }, 'cat')).json.field, 'name');
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'x', ar: 'y' }, price: -3 }, 'cat')).json.code, 'badPrice');
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'x', ar: 'y' }, rev: 1 }, 'cat')).json.code, 'photoShootChanged');
  // A team member asks: held, with the session's version pinned and no price.
  const ask = await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'Photo tumbler', ar: 'تمبلر من الصور' }, price: 400 }, 'cat');
  assert.strictEqual(ask.status, 202, ask.text);
  const rev = b.json.shoot.rev;
  assert.deepStrictEqual(ask.json.body, { id: 'photo-tumbler', name: { en: 'Photo tumbler', ar: 'تمبلر من الصور' }, rev });
  // The same session or the same code again while it waits: refused.
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'other-code', name: { en: 'x', ar: 'y' } }, 'cat')).json.code, 'photoShootWaiting');
  // The owner sees its photos (a key only this server makes).
  const pics = mounted.approvalPics(held[held.length - 1]);
  assert.strictEqual(pics.length, 2);
  assert.match(pics[0].url, new RegExp(`^/photo-shoot-pics/${sid}/[a-f0-9]{32}/front-thumb\\.webp$`));
  const pic = await call(pics[0].url, 'GET', undefined, null);
  assert.strictEqual(pic.status, 200);
  assert.match(pic.headers.get('content-type'), /image\/webp/);
  // QA 28 Nov: another copy of the app (or the same one after a restart) opens the same link.
  {
    const other = makeApp();
    const s2 = await new Promise((resolve) => { const s = other.app.listen(0, () => resolve(s)); });
    try {
      const r2 = await fetch(`http://127.0.0.1:${s2.address().port}${pics[0].url}`);
      assert.strictEqual(r2.status, 200, 'the link works after a restart');
    } finally {
      s2.close();
    }
  }
  assert.strictEqual((await call(pics[0].url.replace(/\/[a-f0-9]{32}\//, `/${'0'.repeat(32)}/`), 'GET', undefined, null)).status, 404);
  assert.strictEqual((await call(pics[0].url.replace('front-thumb.webp', 'front.jpg'), 'GET', undefined, null)).status, 404);
  assert.deepStrictEqual(mounted.approvalPics({ action: 'PUT /api/admin/catalog/:id', status: 'pending', path: '/api/admin/catalog/x' }), []);

  // The session changes meanwhile: the approved request fails cleanly (the owner approved what was built).
  await call(api(sid), 'PUT', { material: 'metal' }, 'cat');
  const notBuilt = await call(ask.json.approval && held.find((a) => a.id === ask.json.approval.id).path, 'POST', held.find((a) => a.id === ask.json.approval.id).body, null, { 'x-replay': ask.json.approval.id });
  assert.strictEqual(notBuilt.json.code, 'photoShootNotBuilt');
  // Built again (same numbers, a newer version): still not what the owner was asked about.
  await call(api(sid, '/build'), 'POST', undefined, 'cat');
  const stale = await approve(ask.json.approval.id);
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.json.code, 'photoShootChanged');
  assert.ok(!fs.existsSync(path.join(dataDir, 'catalog-shots', 'photo-tumbler')));
  held[held.length - 1].status = 'failed-and-done';
  const ask2 = await call(api(sid, '/product'), 'POST', { id: 'photo-tumbler', name: { en: 'Photo tumbler', ar: 'تمبلر من الصور' } }, 'cat');
  assert.strictEqual(ask2.status, 202, ask2.text);
  const done = await approve(ask2.json.approval.id);
  assert.strictEqual(done.status, 201, done.text);
  const p = done.json.product;
  assert.strictEqual(p.id, 'photo-tumbler');
  assert.strictEqual(p.status, 'hidden');
  assert.strictEqual(p.template, 'tumbler');
  assert.strictEqual(p.drinkware.shootId, sid);
  assert.strictEqual(p.drinkware.checkedAt, null);
  assert.deepStrictEqual(p.drinkware.dims, { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 }, 'typed wins');
  assert.strictEqual(p.drinkware.profile.length, 5, 'the measured profile (within 2 %)');
  assert.deepStrictEqual(p.drinkware.profile[0], [0, 45]);
  assert.deepStrictEqual(p.drinkware.profile[4], [120, 32.5]);
  assert.deepStrictEqual(p.drinkware.photo, { front: { w: 600, h: 700, pxPerMm: 4, axisXpx: 300, rimYpx: 100, baseYpx: 584 }, files: ['front.webp', 'front-mask.png'] });
  assert.strictEqual(p.photos.length, 2, 'front and 3/4 as catalogue photos');
  for (const ph of p.photos) {
    const file = path.join(dataDir, 'catalog-photos', 'photo-tumbler', `${ph.id}.webp`);
    assert.ok(/^[a-f0-9]{16}$/.test(ph.id) && fs.existsSync(file));
    const m = await sharp(file).metadata();
    assert.strictEqual(m.format, 'webp');
  }
  for (const f of ['front.webp', 'front-mask.png']) assert.ok(fs.existsSync(path.join(dataDir, 'catalog-shots', 'photo-tumbler', f)));
  assert.ok(!fs.readdirSync(path.join(dataDir, 'catalog-shots')).some((x) => x.startsWith('.tmp')));
  const s = (await call(api(sid))).json.shoot;
  assert.strictEqual(s.status, 'product');
  assert.strictEqual(s.productId, 'photo-tumbler');
  assert.ok(store.db.catalogLog.some((x) => x.productId === 'photo-tumbler' && /new product from photos/.test(x.what)));
  assert.ok(!(store.db.pricing || {})['photo-tumbler'], 'no price from a team member');
  // Done: the session can't change or make a second product.
  assert.strictEqual((await call(api(sid), 'PUT', { material: 'gloss' })).json.code, 'photoShootDone');
  assert.strictEqual((await call(api(sid, '/shots/front'), 'POST', await (await picture(600, 800)).jpeg().toBuffer())).json.code, 'photoShootDone');
  assert.strictEqual((await call(api(sid, '/product'), 'POST', { id: 'photo-two', name: { en: 'x', ar: 'y' } })).json.code, 'photoShootDone');
  assert.deepStrictEqual(mounted.approvalPics(held[held.length - 1]), [], 'approved: no pictures to decide on');

  // Public: the straightened front for the shop's previews; nothing else.
  const pub = await call('/catalog-shots/photo-tumbler/front.webp', 'GET', undefined, null);
  assert.strictEqual(pub.status, 200);
  assert.match(pub.headers.get('cache-control'), /max-age=86400/);
  assert.match(pub.headers.get('content-type'), /image\/webp/);
  assert.strictEqual((await call('/catalog-shots/photo-tumbler/front-mask.png', 'GET', undefined, null)).status, 200);
  for (const u of ['/catalog-shots/photo-tumbler/front.jpg', '/catalog-shots/photo-tumbler/..%2F..%2Fdb.json', '/catalog-shots/..%2Fproduct-shoots/front.webp', '/catalog-shots/Photo-Tumbler/front.webp', '/catalog-shots/mug/front.webp']) {
    assert.strictEqual((await call(u, 'GET', undefined, null)).status, 404, u);
  }
});

test('the owner makes it directly (with a price); the code is checked again when it runs', async () => {
  const sid = await readyShoot();
  await call(api(sid, '/build'), 'POST');
  const r = await call(api(sid, '/product'), 'POST', { id: 'owner-cup', name: { en: 'Owner cup', ar: 'كوباية' }, price: 320 });
  assert.strictEqual(r.status, 201, r.text);
  assert.deepStrictEqual(store.db.pricing['owner-cup'], { basePrice: 320 });
  // Another session asking for a code taken meanwhile fails when approved, and leaves no files behind.
  const sid2 = await readyShoot();
  await call(api(sid2, '/build'), 'POST', undefined, 'cat');
  const ask = await call(api(sid2, '/product'), 'POST', { id: 'late-cup', name: { en: 'Late', ar: 'متأخر' } }, 'cat');
  assert.strictEqual(ask.status, 202);
  store.mutate((db) => { db.catalog.products['late-cup'] = { template: 'tumbler', status: 'hidden' }; });
  const late = await approve(ask.json.approval.id);
  assert.strictEqual(late.json.code, 'productIdTaken');
  assert.ok(!fs.existsSync(path.join(dataDir, 'catalog-shots', 'late-cup')));
  assert.ok(!fs.existsSync(path.join(dataDir, 'catalog-photos', 'late-cup')) || !fs.readdirSync(path.join(dataDir, 'catalog-photos', 'late-cup')).length);
  assert.ok(!fs.readdirSync(path.join(dataDir, 'catalog-shots')).some((x) => x.startsWith('.tmp')));
  assert.strictEqual((await call(api(sid2))).json.shoot.status, 'built');
});

test('the owner\'s overlay check: nudges within 10 % and inside the photo', async () => {
  const sid = await readyShoot();
  await call(api(sid, '/build'), 'POST');
  await call(api(sid, '/product'), 'POST', { id: 'nudge-cup', name: { en: 'Nudge', ar: 'نظبط' } });
  const url = '/api/admin/catalog/nudge-cup/drinkware/check';
  for (const [photo, code] of [[{ pxPerMm: 4.5 }, 'photoNudgeBad'], [{ axisXpx: 601 }, 'photoNudgeBad'], [{ rimYpx: -1 }, 'photoNudgeBad'], [{ zoom: 1 }, 'badProductField'], ['x', 'photoNudgeBad']]) {
    const r = await call(url, 'POST', { photo });
    assert.strictEqual(r.json.code, code, JSON.stringify(photo));
  }
  assert.strictEqual((await call(url, 'POST', { photo: { pxPerMm: 4.2 } }, 'cat')).status, 403);
  const ok = await call(url, 'POST', { photo: { pxPerMm: 4.3, axisXpx: 305.5, rimYpx: 98 } });
  assert.strictEqual(ok.status, 200, ok.text);
  const ph = ok.json.product.drinkware.photo;
  assert.deepStrictEqual(ph.front, { w: 600, h: 700, pxPerMm: 4.3, axisXpx: 305.5, rimYpx: 98, baseYpx: 584 });
  assert.strictEqual(ph.original.pxPerMm, 4);
  assert.ok(ok.json.product.drinkware.checkedAt);
  // Bounded by the measured scale, not by the last nudge.
  assert.strictEqual((await call(url, 'POST', { photo: { pxPerMm: 4.5 } })).json.code, 'photoNudgeBad');
  assert.strictEqual((await call(url, 'POST', {})).status, 200, 'no nudges: as slice 1');
  // A product from measurements only has no photo to line up.
  const m = await call('/api/admin/photo-products/from-measurements', 'POST', { kind: 'cup', handle: null, material: 'gloss', typed: TYPED, id: 'typed-cup', name: { en: 'T', ar: 'ت' } });
  assert.strictEqual(m.status, 201, m.text);
  assert.strictEqual((await call('/api/admin/catalog/typed-cup/drinkware/check', 'POST', { photo: { pxPerMm: 4 } })).json.code, 'photoProductNoPhoto');
});

test('old sessions without a product are cleared when the list is read; at most 30 open', async () => {
  const sid = (await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).json.shoot.id;
  await call(api(sid, '/shots/front'), 'POST', await (await picture(600, 800)).jpeg().toBuffer());
  const old = new Date(Date.now() - 61 * 864e5).toISOString();
  store.mutate((db) => { db.productShoots[sid].updatedAt = old; });
  // One waiting for an owner is kept, however old.
  const w = await readyShoot();
  await call(api(w, '/build'), 'POST', undefined, 'cat');
  assert.strictEqual((await call(api(w, '/product'), 'POST', { id: 'waiting-cup', name: { en: 'W', ar: 'و' } }, 'cat')).status, 202);
  store.mutate((db) => { db.productShoots[w].updatedAt = old; });
  const list = await call('/api/admin/photo-products');
  assert.ok(!list.json.shoots.some((x) => x.id === sid));
  assert.ok(list.json.shoots.some((x) => x.id === w));
  assert.ok(!fs.existsSync(path.join(dataDir, 'product-shoots', sid)));
  assert.strictEqual((await call(api(sid))).json.code, 'photoShootGone');
  // Products made from a session keep it.
  assert.ok(list.json.shoots.some((x) => x.status === 'product'));
  // The limit.
  const open = Object.values(store.db.productShoots).filter((x) => x.status !== 'product').length;
  for (let i = open; i < 30; i++) assert.strictEqual((await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false })).status, 201);
  const r = await call('/api/admin/photo-products', 'POST', { kind: 'cup', handle: false });
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.json.code, 'photoShootsTooMany');
});
