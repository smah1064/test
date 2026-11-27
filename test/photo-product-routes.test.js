'use strict';

// "New product from photo", slice 1 (src/photo-product-routes.js): a cup or tumbler from typed measurements.
// The routes are mounted on a bare express app with the real catalogue, store (a temporary data folder) and
// src/roles.js, and a small admin gate that works like app.js's: permissions, holding a team member's change for an
// owner (with the route's approval check) and running it again unchanged when the owner approves.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
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
let held = [];
const priceCalls = [];
const fanCalls = [];

function makeApp() {
  const app = express();
  const syncCatalog = () => catalog.apply(PRODUCTS, store.db.catalog);
  const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
  const edits = () => (store.db.catalog && store.db.catalog.products) || {};
  const logCatalog = (db, req, productId, what) => {
    db.catalogLog ||= [];
    const w = req.adminWho;
    db.catalogLog.push({ at: new Date().toISOString(), who: w.name, ...(w.approvalId ? { approvedBy: w.approvedBy } : {}), productId, what });
  };
  let checks = {};
  // Like app.js adminGate + holdForApproval (simplified): x-who names the person; x-replay runs a held change.
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
          res.status(202).json({ pending: true, approval: { id: a.id } });
        } catch (e) {
          next(e);
        }
      });
    }
    next();
  };
  const fanFiles = {
    templateSvg: (fan, opts) => { fanCalls.push(['svg', fan, opts]); return `<svg xmlns="http://www.w3.org/2000/svg" data-w="${fan.Wrect.toFixed(1)}"></svg>`; },
    templatePdf: async (fan, opts) => { fanCalls.push(['pdf', fan, opts]); return Buffer.from('%PDF-1.4 template'); },
    specSheetPdf: async (p, spec) => { fanCalls.push(['spec', p.id, spec]); return Buffer.from('%PDF-1.4 spec'); },
  };
  const saveProductEdit = (req, product, body) => {
    priceCalls.push({ id: product.id, body, who: req.adminWho.name });
    store.mutate((db) => { db.pricing ||= {}; db.pricing[product.id] = { basePrice: body.prices.basePrice }; });
  };
  const r = photoRoutes.mount(app, {
    store, guard, HttpError, catalog, getProduct, PRODUCTS, syncCatalog, logCatalog,
    adminProduct: (p) => catalog.forAdmin(p, edits()[p.id]), saveProductEdit,
    approvalsAll: () => held, fanFiles,
  });
  checks = r.approvalChecks;
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const key = err.key || (status === 404 ? 'notFound' : 'badRequest');
    const lang = req.get('accept-language') === 'ar' ? 'ar' : 'en';
    res.status(status).json({ error: format(key, err.params || {}, lang), code: key, ...(err.params && typeof err.params.field === 'string' && err.params.field ? { field: err.params.field } : {}) });
  });
  return { app, approvalChecks: r.approvalChecks };
}

const call = async (url, method = 'GET', body, who = 'owner', headers = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(who ? { 'x-who': who } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text: buf.toString('utf8'), buf, headers: r.headers };
};
/** An owner approves a held change: it runs again, unchanged, as the person who asked. */
const approve = (id) => {
  const a = held.find((x) => x.id === id);
  a.status = 'approved';
  return call(a.path, a.method, a.body, null, { 'x-replay': id });
};

const tumbler = (over = {}) => ({
  kind: 'tumbler', handle: null, material: 'metal',
  typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 120 },
  id: 'tall-tumbler', name: { en: 'Tall tumbler', ar: 'تمبلر طويل' }, price: 350,
  ...over,
});

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-photo-product-'));
  store = new Store(dataDir);
  const { app } = makeApp();
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('roles: the new routes need the catalogue permissions, approvals for changes, and the check is the owners\'', () => {
  const r = (m, p) => roles.routeOf(m, p);
  for (const [m, p] of [['POST', '/api/admin/photo-products/from-measurements'], ['PUT', '/api/admin/catalog/:id/drinkware']]) {
    assert.strictEqual(r(m, p).perm, 'catalog.edit', p);
    assert.strictEqual(r(m, p).approve, true, p);
    assert.ok(r(m, p).label && r(m, p).label.en && r(m, p).label.ar, p);
  }
  for (const f of ['template.svg', 'template.pdf', 'spec.pdf']) {
    assert.strictEqual(r('GET', `/api/admin/catalog/:id/${f}`).perm, 'catalog.view');
    assert.strictEqual(r('HEAD', `/api/admin/catalog/:id/${f}`).perm, 'catalog.view');
    assert.ok(!r('GET', `/api/admin/catalog/:id/${f}`).approve);
  }
  assert.strictEqual(r('POST', '/api/admin/catalog/:id/drinkware/check').perm, 'owner-only');
  // Who holds what: catalogue staff edit and view; finance and operations neither.
  assert.ok(roles.permsOf(['catalogue']).has('catalog.edit'));
  assert.ok(!roles.permsOf(['finance']).has('catalog.view') && !roles.permsOf(['operations']).has('catalog.view'));
});

test('the owner makes a hidden tumbler from measurements: fan side, 3D model, price, log', async () => {
  const r = await call('/api/admin/photo-products/from-measurements', 'POST', tumbler());
  assert.strictEqual(r.status, 201, r.text);
  const p = r.json.product;
  assert.strictEqual(p.id, 'tall-tumbler');
  assert.strictEqual(p.template, 'tumbler');
  assert.strictEqual(p.status, 'hidden');
  assert.strictEqual(p.visible, false);
  assert.deepStrictEqual(p.name, { en: 'Tall tumbler', ar: 'تمبلر طويل' });
  assert.ok(p.fromPhotos);
  assert.strictEqual(p.drinkware.checkedAt, null);
  assert.deepStrictEqual(p.drinkware.dims, { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65 });
  assert.deepStrictEqual(p.drinkware.profile, [[0, 45], [120, 32.5]]);
  assert.strictEqual(p.drinkware.print.gapMm, 5, 'seam gap default');
  assert.strictEqual(p.drinkware.print.safeMm, 3, 'safe margin default');
  // One side, the unrolled band, with the fan for the print files (worked example: s 120.65, Ro 434.3, Ri 313.7).
  assert.strictEqual(p.sides.length, 1);
  const fan = p.sides[0].fan;
  assert.ok(fan, 'tapered: a fan');
  assert.ok(Math.abs(fan.s - 120.65) < 0.05 && Math.abs(fan.Ro - 434.3) < 0.1 && Math.abs(fan.Ri - 313.7) < 0.1, JSON.stringify(fan));
  assert.ok(Math.abs(p.sides[0].printWidthIn * 25.4 - fan.phi * fan.r1) < 0.1, 'design width = the long arc');
  assert.strictEqual(p.model.type, 'mug');
  assert.strictEqual(p.model.handle, false);
  // The owner's price went to the price list; the change is logged.
  assert.deepStrictEqual(priceCalls.pop(), { id: 'tall-tumbler', body: { prices: { basePrice: 350 } }, who: 'mona' });
  const log = store.db.catalogLog.filter((x) => x.productId === 'tall-tumbler');
  assert.ok(/new product from measurements \(tumbler, from tumbler\)/.test(log[0].what), JSON.stringify(log));
  // The same code again: refused.
  const again = await call('/api/admin/photo-products/from-measurements', 'POST', tumbler());
  assert.strictEqual(again.status, 400);
  assert.strictEqual(again.json.code, 'productIdTaken');
});

test('with a handle it is made from the mug; a straight cup has no fan', async () => {
  const r = await call('/api/admin/photo-products/from-measurements', 'POST', tumbler({
    kind: 'mug', material: 'gloss', id: 'big-mug', name: { en: 'Big mug', ar: 'مج كبير' },
    typed: { heightMm: 95, topDiaMm: 82, bottomDiaMm: 82, printTopMm: 10, printHeightMm: 75 },
    handle: { widthMm: 30, y0Mm: 15, y1Mm: 80 }, gapMm: '4', safeMm: 2, price: undefined,
  }));
  assert.strictEqual(r.status, 201, r.text);
  const p = r.json.product;
  assert.strictEqual(p.template, 'mug');
  assert.strictEqual(p.model.handle, true);
  assert.strictEqual(p.sides[0].fan, undefined, 'straight: no fan');
  assert.deepStrictEqual(p.drinkware.handle, { y0Mm: 15, y1Mm: 80, widthMm: 30 });
  assert.strictEqual(p.drinkware.print.gapMm, 4, 'digits as a form sends them');
  // No price sent: the template's (nothing written to the price list).
  assert.ok(!priceCalls.some((c) => c.id === 'big-mug'));
});

test('every input is checked on the server, with a message in both languages naming the field', async () => {
  const cases = [
    [{ typed: { heightMm: 20, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 15 } }, 'drinkwareRange', 'heightMm'],
    [{ typed: { heightMm: 120, topDiaMm: 250, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 100 } }, 'drinkwareRange', 'topDiaMm'],
    [{ typed: { heightMm: 120, topDiaMm: '9O', bottomDiaMm: 65, printTopMm: 0, printHeightMm: 100 } }, 'drinkwareRange', 'topDiaMm'],
    [{ typed: { heightMm: 120, topDiaMm: true, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 100 } }, 'drinkwareRange', 'topDiaMm'],
    [{ typed: { heightMm: 120, topDiaMm: [90], bottomDiaMm: 65, printTopMm: 0, printHeightMm: 100 } }, 'drinkwareRange', 'topDiaMm'],
    [{ typed: { heightMm: 60, topDiaMm: 120, bottomDiaMm: 40, printTopMm: 0, printHeightMm: 50 } }, 'drinkwareTaper', 'bottomDiaMm'],
    [{ typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 30, printHeightMm: 100 } }, 'drinkwareBand', 'printHeightMm'],
    [{ typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 5 } }, 'drinkwareRange', 'printHeightMm'],
    [{ typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0 } }, 'drinkwareRange', 'printHeightMm'],
    [{ typed: { heightMm: 120, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 100, extra: 1 } }, 'badProductField', 'typed.extra'],
    [{ typed: null }, 'drinkwareField', 'typed'],
    [{ kind: 'vase' }, 'drinkwareField', 'kind'],
    [{ material: 'glass' }, 'drinkwareField', 'material'],
    [{ gapMm: -1 }, 'drinkwareRange', 'gapMm'],
    [{ safeMm: 500 }, 'drinkwareRange', 'safeMm'],
    [{ handle: { widthMm: 30, y0Mm: 60, y1Mm: 40 } }, 'drinkwareHandle', 'y1Mm'],
    [{ handle: { widthMm: 30, y0Mm: 10, y1Mm: 130 } }, 'drinkwareHandle', 'y1Mm'],
    [{ handle: { widthMm: 30, y0Mm: 10, y1Mm: 500 } }, 'drinkwareRange', 'y1Mm'],
    [{ handle: { widthMm: 2, y0Mm: 10, y1Mm: 80 } }, 'drinkwareRange', 'widthMm'],
    [{ handle: 'yes' }, 'drinkwareField', 'handle'],
    // The handle and seam leave nothing to print round a thin cup: the builder refuses.
    [{ typed: { heightMm: 120, topDiaMm: 40, bottomDiaMm: 40, printTopMm: 0, printHeightMm: 100 }, handle: { widthMm: 115, y0Mm: 10, y1Mm: 80 }, gapMm: 20, safeMm: 10 }, 'photoProductBadHandle', 'handle.widthMm'],
    [{ id: 'Bad Id!' }, 'badProductId', 'id'],
    [{ id: 'mug' }, 'productIdTaken', 'id'],
    [{ name: { en: 'Only English' } }, 'drinkwareField', 'name'],
    [{ name: undefined }, 'drinkwareField', 'name'],
    [{ name: { en: '<>', ar: 'اسم' } }, 'drinkwareField', 'name'],
    [{ price: 0 }, 'badPrice', 'price'],
    [{ price: -5 }, 'badPrice', 'price'],
    [{ price: 'free' }, 'badPrice', 'price'],
    [{ surprise: 1 }, 'badProductField', 'surprise'],
  ];
  for (const [over, code, field] of cases) {
    const r = await call('/api/admin/photo-products/from-measurements', 'POST', tumbler({ id: 'checked-cup', ...over }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(over)}: ${r.text}`);
    assert.strictEqual(r.json.code, code, JSON.stringify(over));
    assert.strictEqual(r.json.field, field, JSON.stringify(over));
    assert.ok(!/\{\w+\}/.test(r.json.error), `no placeholder left: ${r.json.error}`);
  }
  // In Arabic: the field's own name and Arabic digits.
  const ar = await call('/api/admin/photo-products/from-measurements', 'POST', tumbler({ id: 'checked-cup', typed: { heightMm: 20, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 0, printHeightMm: 15 } }), 'owner', { 'accept-language': 'ar' });
  assert.strictEqual(ar.json.error, 'الارتفاع لازم يكون رقم من ٣٠ لحد ٤٠٠ مم.');
  // Bad JSON: 400, nothing made.
  assert.strictEqual((await call('/api/admin/photo-products/from-measurements', 'POST', '{"kind":')).status, 400);
  assert.ok(!(store.db.catalog.products || {})['checked-cup'], 'nothing was made');
});

test('a team member\'s new product waits for an owner, without a price, and is made when approved', async () => {
  const body = tumbler({ id: 'team-cup', name: { en: 'Team cup', ar: 'كوباية الفريق' }, price: 999, typed: { heightMm: '110.04', topDiaMm: 80, bottomDiaMm: 70, printTopMm: 5, printHeightMm: 100 } });
  // Checked at once: a bad one never waits.
  const bad = await call('/api/admin/photo-products/from-measurements', 'POST', { ...body, typed: { ...body.typed, heightMm: 5 } }, 'cat');
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(held.length, 0);
  const r = await call('/api/admin/photo-products/from-measurements', 'POST', body, 'cat');
  assert.strictEqual(r.status, 202, r.text);
  assert.ok(!(store.db.catalog.products || {})['team-cup'], 'nothing made yet');
  const a = held.find((x) => x.id === r.json.approval.id);
  // Kept as it will be applied: rounded, defaults filled in, no price (a team member's product has the template's).
  assert.deepStrictEqual(a.body, {
    kind: 'tumbler', material: 'metal', typed: { heightMm: 110, topDiaMm: 80, bottomDiaMm: 70, printTopMm: 5, printHeightMm: 100 },
    handle: null, gapMm: 5, safeMm: 3, id: 'team-cup', name: { en: 'Team cup', ar: 'كوباية الفريق' },
  });
  // The same code from someone else meanwhile: refused at once.
  const dup = await call('/api/admin/photo-products/from-measurements', 'POST', body, 'cat');
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.json.code, 'productIdWaiting');
  // Finance can't ask at all.
  assert.strictEqual((await call('/api/admin/photo-products/from-measurements', 'POST', body, 'fin')).status, 403);
  const done = await approve(a.id);
  assert.strictEqual(done.status, 201, done.text);
  assert.strictEqual(done.json.product.id, 'team-cup');
  assert.strictEqual(done.json.product.drinkware.dims.heightMm, 110);
  assert.ok(!priceCalls.some((c) => c.id === 'team-cup'), 'no price from a team member');
  const line = store.db.catalogLog.find((x) => x.productId === 'team-cup');
  assert.strictEqual(line.who, 'karim');
  assert.strictEqual(line.approvedBy, 'Mona');
  // Run again (a second approval click on a stale screen): fails cleanly, nothing doubled.
  const twice = await call(a.path, a.method, a.body, null, { 'x-replay': a.id });
  assert.strictEqual(twice.status, 400);
  assert.strictEqual(twice.json.code, 'productIdTaken');
});

test('re-measure: new spec, check cleared, product in the shop paused; template can\'t change', async () => {
  // Checked, then in the shop.
  const chk = await call('/api/admin/catalog/tall-tumbler/drinkware/check', 'POST', {});
  assert.strictEqual(chk.status, 200, chk.text);
  assert.ok(chk.json.product.drinkware.checkedAt);
  assert.strictEqual(chk.json.product.drinkware.checkedBy, 'Mona');
  store.mutate((db) => { delete db.catalog.products['tall-tumbler'].status; delete db.catalog.products['tall-tumbler'].hiddenReason; delete db.catalog.products['tall-tumbler'].hiddenNote; });
  const body = { typed: { heightMm: 125, topDiaMm: 92, bottomDiaMm: 66, printTopMm: 5, printHeightMm: 110 } };
  const r = await call('/api/admin/catalog/tall-tumbler/drinkware', 'PUT', body);
  assert.strictEqual(r.status, 200, r.text);
  const p = r.json.product;
  assert.strictEqual(r.json.paused, true);
  assert.strictEqual(p.status, 'hidden');
  assert.strictEqual(p.drinkware.checkedAt, null);
  assert.strictEqual(p.drinkware.kind, 'tumbler', 'kind kept');
  assert.strictEqual(p.drinkware.material, 'metal', 'material kept');
  assert.strictEqual(p.drinkware.dims.heightMm, 125);
  assert.ok(/measurements changed, paused until checked/.test(store.db.catalogLog.at(-1).what));
  assert.deepStrictEqual(p.name, { en: 'Tall tumbler', ar: 'تمبلر طويل' }, 'name kept');
  // A handle on a product made without one: a new product instead.
  const h = await call('/api/admin/catalog/tall-tumbler/drinkware', 'PUT', { ...body, handle: { widthMm: 25, y0Mm: 10, y1Mm: 90 } });
  assert.strictEqual(h.status, 409);
  assert.strictEqual(h.json.code, 'drinkwareTemplate');
  // Not a measured product / unknown / bad numbers / extra fields.
  assert.strictEqual((await call('/api/admin/catalog/mug/drinkware', 'PUT', body)).json.code, 'notDrinkware');
  assert.strictEqual((await call('/api/admin/catalog/nope/drinkware', 'PUT', body)).status, 404);
  assert.strictEqual((await call('/api/admin/catalog/tall-tumbler/drinkware', 'PUT', { typed: { ...body.typed, topDiaMm: 900 } })).json.code, 'drinkwareRange');
  assert.strictEqual((await call('/api/admin/catalog/tall-tumbler/drinkware', 'PUT', { ...body, id: 'x' })).json.field, 'id');
});

test('a team member\'s re-measure waits, then runs as approved', async () => {
  const body = { typed: { heightMm: 118, topDiaMm: 88, bottomDiaMm: 64, printTopMm: 0, printHeightMm: 110 }, material: 'matte' };
  const r = await call('/api/admin/catalog/tall-tumbler/drinkware', 'PUT', body, 'cat');
  assert.strictEqual(r.status, 202, r.text);
  assert.strictEqual(store.db.catalog.products['tall-tumbler'].drinkware.dims.heightMm, 125, 'unchanged while it waits');
  const a = held.find((x) => x.id === r.json.approval.id);
  assert.deepStrictEqual(a.body, { kind: 'tumbler', material: 'matte', typed: body.typed, handle: null, gapMm: 5, safeMm: 3 });
  const done = await approve(a.id);
  assert.strictEqual(done.status, 200, done.text);
  assert.strictEqual(done.json.product.drinkware.dims.heightMm, 118);
  assert.strictEqual(done.json.product.drinkware.material, 'matte');
  // Checked again by an owner only (catalogue staff: 403).
  assert.strictEqual((await call('/api/admin/catalog/tall-tumbler/drinkware/check', 'POST', {}, 'cat')).status, 403);
  assert.strictEqual((await call('/api/admin/catalog/mug/drinkware/check', 'POST', {})).json.code, 'notDrinkware');
  assert.strictEqual((await call('/api/admin/catalog/tall-tumbler/drinkware/check', 'POST')).status, 200, 'no body needed');
});

test('template and spec sheet downloads: catalogue staff may, others not; from the numbers only', async () => {
  fanCalls.length = 0;
  const svg = await call('/api/admin/catalog/tall-tumbler/template.svg', 'GET', undefined, 'cat');
  assert.strictEqual(svg.status, 200, svg.text);
  assert.ok(/^image\/svg\+xml/.test(svg.headers.get('content-type')));
  assert.strictEqual(svg.headers.get('content-disposition'), 'attachment; filename="tall-tumbler-template.svg"');
  const [kind, fan, opts] = fanCalls[0];
  assert.strictEqual(kind, 'svg');
  assert.strictEqual(fan.template, 'fan');
  assert.ok(fan.Ro > 0 && fan.theta > 0);
  assert.strictEqual(opts.slug, 'tall-tumbler');
  const pdf = await call('/api/admin/catalog/tall-tumbler/template.pdf', 'GET', undefined, 'cat');
  assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(pdf.buf.subarray(0, 5).toString() === '%PDF-');
  const spec = await call('/api/admin/catalog/tall-tumbler/spec.pdf', 'GET', undefined, 'owner');
  assert.strictEqual(spec.status, 200);
  assert.strictEqual(spec.headers.get('content-disposition'), 'attachment; filename="tall-tumbler-spec.pdf"');
  assert.strictEqual(fanCalls[2][0], 'spec');
  assert.strictEqual(fanCalls[2][2].dims.heightMm, 118);
  assert.strictEqual((await call('/api/admin/catalog/tall-tumbler/spec.pdf', 'GET', undefined, 'fin')).status, 403);
  assert.strictEqual((await call('/api/admin/catalog/mug/template.svg')).status, 409);
  assert.strictEqual((await call('/api/admin/catalog/nope/template.pdf')).status, 404);
});

test('the real print-file module makes the template and the spec sheet (when it is there)', async (t) => {
  let fanFiles;
  try { fanFiles = require('../src/fan-files'); } catch (e) { return t.skip('src/fan-files.js not written yet'); }
  const p = PRODUCTS.find((x) => x.id === 'tall-tumbler');
  const spec = store.db.catalog.products['tall-tumbler'].drinkware;
  const fan = require('../src/drinkware').fanFor(spec);
  const svg = String(await fanFiles.templateSvg(fan, { title: 'Tall tumbler', slug: p.id, spec }));
  assert.ok(/<svg[\s>]/.test(svg));
  const pdf = Buffer.from(await fanFiles.templatePdf(fan, { title: 'Tall tumbler', slug: p.id, spec }));
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  const sheet = Buffer.from(await fanFiles.specSheetPdf(p, spec));
  assert.strictEqual(sheet.subarray(0, 5).toString(), '%PDF-');
});
