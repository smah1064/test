'use strict';

// The 3D preview of the engraved pen (each of its four models) and the engraved leather wallet: it draws the
// product, and the customer's engraving is on it the right way round: along the pen's barrel, read left to right,
// on the side facing the camera; on the wallet's front, upright and not mirrored.
// Set PREVIEW3D_SHOTS to a folder to keep a picture of each 3D view.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

const SHOTS = process.env.PREVIEW3D_SHOTS || '';

/** A line of text on the product, in the side box. */
async function addText(page, text) {
  await page.evaluate(() => document.querySelector('#text-presets [data-i="0"]').click());
  await page.waitForFunction(() => window.__editor.canvas.getActiveObject());
  await page.fill('#p-text', text);
  await page.waitForFunction((tx) => window.__editor.canvas.getObjects().some((o) => o.text === tx), text);
}

/** Open the preview on its 3D tab (not turning, so the first view is measured) and wait until it is drawn. */
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
 * What the 3D view shows: how much of the canvas is drawn (and its width), and where the engraving's
 * corners land on the screen (its texture's left/right and top/bottom edges), and whether it faces the camera.
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
  let x0 = c.width;
  let x1 = -1;
  const tones = new Set();
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 200) continue;
      drawn++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      tones.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    }
  }
  // The engraving: drawn last (renderOrder 3), the design as its texture.
  let eng = null;
  scene.traverse((o) => { if (o.isMesh && o.renderOrder === 3 && o.material && o.material.map) eng = o; });
  let engraving = null;
  if (eng) {
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const pos = eng.geometry.attributes.position;
    const uv = eng.geometry.attributes.uv;
    const nrm = eng.geometry.attributes.normal;
    const at = (pick) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (!pick(uv.getX(i), uv.getY(i))) continue;
        const v = eng.localToWorld(new V(pos.getX(i), pos.getY(i), pos.getZ(i))).project(camera);
        sx += ((v.x + 1) / 2) * c.width;
        sy += ((1 - v.y) / 2) * c.height;
        n++;
      }
      return { x: sx / n, y: sy / n };
    };
    const left = at((u) => u < 0.01);
    const right = at((u) => u > 0.99);
    const top = at((u, v) => v > 0.99);
    const bottom = at((u, v) => v < 0.01);
    // Its middle faces the camera (the normal closest to the middle of the texture).
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < uv.count; i++) {
      const dd = Math.abs(uv.getX(i) - 0.5) + Math.abs(uv.getY(i) - 0.5);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    const p = eng.localToWorld(new V(pos.getX(best), pos.getY(best), pos.getZ(best)));
    const n = new V(nrm.getX(best), nrm.getY(best), nrm.getZ(best)).transformDirection(eng.matrixWorld);
    const toCam = camera.position.clone().sub(p).normalize();
    engraving = { left, right, top, bottom, facing: n.dot(toCam), size: [eng.material.map.image.width, eng.material.map.image.height] };
  }
  return { w: c.width, h: c.height, drawn: drawn / (c.width * c.height), x0, x1, tones: tones.size, engraving, failed: document.querySelector('#pv-body .muted') ? document.querySelector('#pv-body').textContent : '' };
}

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#pv-3d').screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test('3D preview: the engraved pen (all four models) lies along the view with the engraving along its barrel, read left to right', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'engrpen');
    await addText(page, 'NOUR 2026');
    for (const model of ['black', 'navy', 'gold', 'bamboo']) {
      await page.click(`#swatches [data-color="${model}"]`);
      await page.waitForFunction((id) => window.__editor.st.colorId === id, model);
      await open3d(page);
      const r = await page.evaluate(measure);
      await shoot(page, `engrpen-${model}`);
      assert.strictEqual(r.failed, '', `${model}: the 3D view opened`);
      assert.ok(r.drawn > 0.02, `${model}: the pen is drawn (${(r.drawn * 100).toFixed(1)}% of the view)`);
      assert.ok(r.tones > 15, `${model}: shaded, not a flat shape (${r.tones} tones)`);
      // Long and thin, it fills the view across.
      assert.ok((r.x1 - r.x0) / r.w > 0.75, `${model}: the pen fills the width (${r.x0}..${r.x1} of ${r.w})`);
      const e = r.engraving;
      assert.ok(e, `${model}: the engraving is on the pen`);
      assert.ok(e.right.x - e.left.x > 150, `${model}: the design reads left to right (${e.left.x.toFixed(0)} -> ${e.right.x.toFixed(0)})`);
      assert.ok(e.bottom.y - e.top.y > 5, `${model}: the design is upright (top ${e.top.y.toFixed(0)}, bottom ${e.bottom.y.toFixed(0)})`);
      assert.ok(Math.abs(e.right.x - e.left.x) > 4 * Math.abs(e.bottom.y - e.top.y), `${model}: it runs along the barrel, not round it`);
      assert.ok(Math.abs(e.right.y - e.left.y) < 0.1 * (e.right.x - e.left.x), `${model}: the barrel lies level`);
      assert.ok(e.facing > 0.9, `${model}: the engraving faces the camera (${e.facing.toFixed(2)})`);
      // Between the ring and the tip: to the right of the middle of the pen, not on the cap.
      assert.ok(e.left.x > r.x0 + (r.x1 - r.x0) * 0.25 && e.right.x < r.x1 - (r.x1 - r.x0) * 0.08, `${model}: on the barrel between the cap's ring and the tip`);
      await page.click('#pv-close');
    }
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('3D preview: the engraved leather wallet shows the engraving on its front, upright and not mirrored', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'engrwallet');
    await addText(page, 'AHMED');
    for (const leather of ['brown', 'black']) {
      await page.click(`#swatches [data-color="${leather}"]`);
      await page.waitForFunction((id) => window.__editor.st.colorId === id, leather);
      await open3d(page);
      const r = await page.evaluate(measure);
      await shoot(page, `engrwallet-${leather}`);
      assert.strictEqual(r.failed, '', `${leather}: the 3D view opened`);
      assert.ok(r.drawn > 0.05, `${leather}: the wallet is drawn (${(r.drawn * 100).toFixed(1)}% of the view)`);
      assert.ok(r.tones > 15, `${leather}: shaded, not a flat shape (${r.tones} tones)`);
      const e = r.engraving;
      assert.ok(e, `${leather}: the engraving is on the wallet`);
      assert.ok(e.right.x - e.left.x > 80, `${leather}: the design reads left to right (${e.left.x.toFixed(0)} -> ${e.right.x.toFixed(0)})`);
      assert.ok(e.bottom.y - e.top.y > 20, `${leather}: the design is upright (top ${e.top.y.toFixed(0)}, bottom ${e.bottom.y.toFixed(0)})`);
      assert.ok(e.facing > 0.5, `${leather}: the front faces the camera (${e.facing.toFixed(2)})`);
      await page.click('#pv-close');
    }
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
