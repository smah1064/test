'use strict';

// "New product from photo", slice 1, end to end: the owner makes a tapered tumbler from typed measurements, checks
// the dimensions and shows it in the shop; a customer designs on it; the team downloads the fan print files.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const geom = require('../../public/js/drinkware-geom.js');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('a tapered tumbler from measurements: checked, in the shop, designed on, fan print files for the team', { timeout: 180000 }, async () => {
  const api = async (method, url, body, token) => {
    const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const login = await api('POST', '/api/admin/login', { password: 'secret' });
  assert.strictEqual(login.status, 200, JSON.stringify(login.body));
  const token = login.body.token;
  const made = await api('POST', '/api/admin/photo-products/from-measurements', {
    kind: 'tumbler', handle: null, material: 'metal', id: 'taper-tumbler', name: { en: 'Tapered Tumbler', ar: 'تمبلر بيضيق' }, price: 420,
    typed: { heightMm: 150, topDiaMm: 90, bottomDiaMm: 65, printTopMm: 15, printHeightMm: 120 },
  }, token);
  assert.strictEqual(made.status, 201, JSON.stringify(made.body));
  // Not in the shop before the owner checks the dimensions.
  const early = await api('PUT', '/api/admin/catalog/taper-tumbler', { status: 'live' }, token);
  assert.ok(early.status >= 400, `shown before the check: ${early.status}`);
  assert.strictEqual((await api('POST', '/api/admin/catalog/taper-tumbler/drinkware/check', {}, token)).status, 200);
  const live = await api('PUT', '/api/admin/catalog/taper-tumbler', { status: 'live' }, token);
  assert.strictEqual(live.status, 200, JSON.stringify(live.body));
  // The workshop's papers.
  for (const [f, type] of [['template.svg', 'svg'], ['template.pdf', 'pdf'], ['spec.pdf', 'pdf']]) {
    const r = await api('GET', `/api/admin/catalog/taper-tumbler/${f}`, undefined, token);
    assert.strictEqual(r.status, 200, f);
    assert.match(r.type, new RegExp(type), f);
  }
  // The shop's product: one side, the unrolled band, with its fan.
  const { products } = (await api('GET', '/api/products')).body;
  const p = products.find((x) => x.id === 'taper-tumbler');
  assert.ok(p, 'in the shop');
  const side = p.sides[0];
  assert.ok(side.fan && side.fan.r1 > side.fan.r2, 'the side has its fan');
  assert.ok(p.model && Array.isArray(p.model.profile), '3D profile');

  // A customer designs on it and adds it to the cart.
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'taper-tumbler');
    await page.evaluate(() => {
      const { canvas } = window.__editor;
      const r = new fabric.Rect({ left: 250, top: 300, width: 120, height: 80, fill: '#d0342c', originX: 'center', originY: 'center' });
      canvas.add(r);
      canvas.fire('object:modified', { target: r });
    });
    await page.waitForTimeout(400);
    await page.click('#add-to-cart');
    await page.waitForURL(/\/cart/, { timeout: 60000 });
    const designId = await page.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2'))[0].designId);
    assert.deepStrictEqual(page.errors, []);

    // The team: the fan files, bent to the cup; the flat PNG is still there.
    const fan = geom.fanOf({ d1Mm: side.fan.r1 * 2, d2Mm: side.fan.r2 * 2, heightMm: Math.sqrt(side.fan.s ** 2 - (side.fan.r1 - side.fan.r2) ** 2), gapMm: side.fan.gapMm, safeMm: side.fan.safeMm }, null);
    const png = await api('GET', `/api/admin/files/${designId}/${side.id}?format=fan-png`, undefined, token);
    assert.strictEqual(png.status, 200, String(png.body).slice(0, 200));
    const meta = await sharp(png.body).metadata();
    assert.ok(Math.abs(meta.width / meta.height - fan.W / fan.H) < 0.02, `fan box ${meta.width}×${meta.height} vs ${fan.W.toFixed(1)}×${fan.H.toFixed(1)} mm`);
    for (const f of ['fan-mirror', 'fan-pdf', 'png']) {
      const r = await api('GET', `/api/admin/files/${designId}/${side.id}?format=${f}`, undefined, token);
      assert.strictEqual(r.status, 200, f);
    }
    // A plain mug design has no fan file.
    const mugPage = await openEditor(ctx, srv.base, 'mug');
    await mugPage.evaluate(() => {
      const { canvas } = window.__editor;
      const r = new fabric.Rect({ left: 250, top: 300, width: 60, height: 60, fill: '#2c5cd0', originX: 'center', originY: 'center' });
      canvas.add(r);
      canvas.fire('object:modified', { target: r });
    });
    await mugPage.waitForTimeout(400);
    await mugPage.click('#add-to-cart');
    await mugPage.waitForURL(/\/cart/, { timeout: 60000 });
    const mugId = await mugPage.evaluate(() => JSON.parse(localStorage.getItem('pod-cart-v2'))[0].designId);
    const none = await api('GET', `/api/admin/files/${mugId}/front?format=fan-pdf`, undefined, token);
    assert.strictEqual(none.status, 404);
  } finally {
    await ctx.close();
  }
});
