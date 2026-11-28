'use strict';

// "New product from photo", slice 1: the 3D view of measured drinkware is turned on a lathe from its profile
// (public/js/preview3d-lathe.js). A tapered tumbler shows narrower at the base than at the rim, the customer's
// design is on the front and narrows with the body (like the fan print file), a mug-shaped profile gets its handle,
// and products without a profile (the plain mug and tumbler) still render as before.
// The server side (src/drinkware.js) is built separately: this test injects the model fields applyTo() produces
// (p.model.profile / band / finish) into the editor's product before the 3D view opens.
// Set PREVIEW3D_SHOTS to a folder to keep a picture of each 3D view.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

const SHOTS = process.env.PREVIEW3D_SHOTS || '';
const IN = (mm) => mm / 25.4;
const RED = '#e3122b';

/** A red background over the whole print area (the design), and optionally the drinkware model fields. */
async function prepare(page, model) {
  await page.evaluate(({ model, RED }) => {
    const ed = window.__editor;
    document.getElementById('fill-area').click(); // the editor's "fill the print area" background
    const o = ed.canvas.getObjects().find((x) => x.name === 'Background');
    o.set({ fill: RED });
    ed.canvas.requestRenderAll();
    ed.canvas.fire('object:modified', { target: o });
    if (model) Object.assign(ed.st.product.model, model);
  }, { model, RED });
}

/** Open the preview on its 3D tab (not turning) and wait until it is drawn. */
async function open3d(page) {
  await page.click('#preview-open');
  await page.waitForSelector('#pv:not([hidden])');
  await page.evaluate(() => { document.getElementById('pv-spin').checked = false; });
  await page.click('[data-pv-tab="3d"]');
  await page.waitForFunction(() => {
    const el = document.getElementById('pv-3d');
    return el && el.__pod3d && el.querySelector('canvas');
  }, null, { timeout: 30000 });
  await page.evaluate(() => document.getElementById('pv-3d').__pod3d.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
}

/**
 * What the 3D view shows: the share of the canvas drawn; the red (design) pixels, their centre and their width in
 * the upper and lower part of the red area; and, for a lathe body, the on-screen width of its rim and base rings.
 */
function measure() {
  const el = document.getElementById('pv-3d');
  const { camera, scene } = el.__pod3d;
  const cv = el.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = cv.width;
  c.height = cv.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(cv, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let drawn = 0;
  let red = 0;
  let rx = 0;
  let ry0 = c.height;
  let ry1 = -1;
  const rows = new Map(); // y -> [x0, x1] of red
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 200) continue;
      drawn++;
      if (d[i] > 120 && d[i + 1] < 70 && d[i + 2] < 80 && d[i] > 2.2 * d[i + 1]) {
        red++;
        rx += x;
        if (y < ry0) ry0 = y;
        if (y > ry1) ry1 = y;
        const r = rows.get(y);
        if (!r) rows.set(y, [x, x]);
        else { r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); }
      }
    }
  }
  const widthAt = (f) => {
    const y = Math.round(ry0 + (ry1 - ry0) * f);
    let best = 0;
    for (let k = -3; k <= 3; k++) { const r = rows.get(y + k); if (r) best = Math.max(best, r[1] - r[0]); }
    return best;
  };
  let lathe = null;
  let handle = false;
  scene.traverse((o) => {
    if (o.isMesh && o.userData.lathe) lathe = o;
    if (o.userData.handle) handle = true;
  });
  let rings = null;
  if (lathe) {
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const pos = lathe.geometry.attributes.position;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) { yMin = Math.min(yMin, pos.getY(i)); yMax = Math.max(yMax, pos.getY(i)); }
    const span = (yy) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let rMax = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - yy) > 1e-4) continue;
        rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)));
        const v = lathe.localToWorld(new V(pos.getX(i), pos.getY(i), pos.getZ(i))).project(camera);
        const sx = ((v.x + 1) / 2) * c.width;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
      }
      return { px: x1 - x0, r: rMax };
    };
    rings = { top: span(yMax), bottom: span(yMin), uvs: lathe.geometry.attributes.uv.count };
  }
  return {
    w: c.width, h: c.height, drawn: drawn / (c.width * c.height), red: red / (c.width * c.height),
    redX: red ? rx / red / c.width : null, redTop: widthAt(0.12), redBottom: widthAt(0.88), rings, handle,
    failed: document.querySelector('#pv-body .muted') ? document.querySelector('#pv-body').textContent : '',
  };
}

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#pv-3d').screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// 120 mm high, 90 mm across the rim and 65 mm across the base; print band 10–110 mm with a 5 mm seam gap.
const TAPERED = {
  type: 'mug', diameterIn: IN(90), heightIn: IN(120), material: 'ceramic', handle: false, lid: false,
  profile: [[0, IN(45)], [IN(120), IN(32.5)]],
  band: { y0In: IN(10), y1In: IN(110), phi: 2 * Math.PI - 5 / 32.5 },
  finish: 'matte',
};

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

test('3D: a tapered tumbler is turned from its profile, narrower at the base, the design on the front narrowing with it', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'tumbler');
    await prepare(page, TAPERED);
    await open3d(page);
    const m = await page.evaluate(measure);
    await shoot(page, 'drinkware-tapered');
    assert.strictEqual(m.failed, '', 'the 3D view opened');
    assert.ok(m.drawn > 0.04, `the 3D canvas is drawn (${m.drawn})`);
    assert.ok(m.rings, 'the body is the lathe model');
    assert.ok(Math.abs(m.rings.top.r - IN(45)) < 1e-3 && Math.abs(m.rings.bottom.r - IN(32.5)) < 1e-3, `rim/base radii from the profile: ${JSON.stringify(m.rings)}`);
    assert.ok(m.rings.bottom.px < m.rings.top.px * 0.85, `narrower at the base on screen: ${JSON.stringify(m.rings)}`);
    assert.strictEqual(m.rings.uvs, 97 * 2, '96 segments round, one ring per profile point');
    assert.ok(m.red > 0.02, `the design's colour is on the cup (${m.red})`);
    assert.ok(Math.abs(m.redX - 0.5) < 0.12, `the design is on the front, in the middle of the view (${m.redX})`);
    assert.ok(m.redBottom < m.redTop * 0.92, `the design narrows towards the base (${m.redTop} → ${m.redBottom})`);
    assert.strictEqual(m.handle, false, 'no handle on a tumbler');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('3D: a mug-shaped profile with a handle (gloss) and a metal tumbler profile render', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    await prepare(page, {
      handle: true, handleBand: { y0In: IN(18), y1In: IN(80) }, lid: false, finish: 'gloss',
      profile: [[0, IN(41)], [IN(4), IN(41)], [IN(92), IN(39)], [IN(96), IN(37)]],
      band: { y0In: IN(10), y1In: IN(88), phi: 2 * Math.PI - (5 + 12 + 6) / 39 },
    });
    await open3d(page);
    let m = await page.evaluate(measure);
    await shoot(page, 'drinkware-mug');
    assert.strictEqual(m.failed, '');
    assert.ok(m.drawn > 0.04, `drawn (${m.drawn})`);
    assert.ok(m.rings && m.rings.uvs === 97 * 4, 'the lathe body, one ring per profile point');
    assert.strictEqual(m.handle, true, 'the handle is there');
    assert.ok(m.red > 0.02, `the design is on the mug (${m.red})`);
    assert.deepStrictEqual(page.errors, []);
    await page.click('#pv-close');

    const page2 = await openEditor(ctx, srv.base, 'tumbler');
    await prepare(page2, { ...TAPERED, finish: 'metal', material: 'metal' });
    await open3d(page2);
    m = await page2.evaluate(measure);
    assert.strictEqual(m.failed, '');
    assert.ok(m.drawn > 0.04 && m.rings, `the metal lathe body is drawn (${m.drawn})`);
    assert.deepStrictEqual(page2.errors, []);
  } finally {
    await ctx.close();
  }
});

test('3D: the plain mug and tumbler (no profile) still render as before', { timeout: 120000 }, async () => {
  const ctx = await newContext(browser);
  try {
    for (const id of ['mug', 'tumbler']) {
      const page = await openEditor(ctx, srv.base, id);
      await prepare(page, null);
      await open3d(page);
      const m = await page.evaluate(measure);
      await shoot(page, `drinkware-plain-${id}`);
      assert.strictEqual(m.failed, '', `${id}: the 3D view opened`);
      assert.ok(m.drawn > 0.04, `${id}: drawn (${m.drawn})`);
      assert.strictEqual(m.rings, null, `${id}: the old cylinder body, not the lathe`);
      assert.ok(m.red > 0.01, `${id}: the design is on it (${m.red})`);
      assert.deepStrictEqual(page.errors, [], `${id}: no page errors`);
      await page.close();
    }
  } finally {
    await ctx.close();
  }
});
