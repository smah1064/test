'use strict';
// Hoodie fronts (owner, 25 Nov: "why does the logo go up to the collar?"): the print area starts below
// the neckline and the drawstring eyelets and ends above the kangaroo pocket, on the drawing, on the
// product photo and on the model photos, for every size. The photo stays where it was in the editor,
// the embroidered chest logo stays where it was, and designs saved before the move say where their
// objects were placed (POD.placedArea), so they can be carried into the new area.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { getProduct, printAreaFor, placedAreaFor, printHeightFor, printWidthFor, embroideryFor } = require('../src/products');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const photos = (() => {
  const window = {};
  vm.runInNewContext(read('js/photo-mockups.js'), { window, document: {}, Image: function () {} });
  return window;
})();

// Measured on the photos (pixels of the 1000-px-wide photos): the bottom of the neckline's V where the
// hood crosses at the centre front, and the top of the kangaroo pocket.
const LANDMARKS = {
  'hoodie-front': { neck: 405, pocket: 785 },
  'hoodie-man-front': { neck: 384, pocket: 752 },
  'hoodie-woman-front': { neck: 400, pocket: 750 },
  'kidshoodie-boy-front': { neck: 420, pocket: 762 },
  'kidshoodie-girl-front': { neck: 422, pocket: 762 },
};
const photoName = (src) => path.basename(src, '.webp');
// Adults: the print starts about 3 in below the neckline; kids about 2 in. Both end at least 1 in above the pocket.
const BELOW_NECK_IN = { hoodie: 2.9, kidshoodie: 1.9 };
const ABOVE_POCKET_IN = 1;
const HOODIES = ['hoodie', 'kidshoodie'];

/** The drawing's landmarks (mockup units): where the drawn drawstrings end and the pocket starts. */
function drawn(side) {
  const svg = side.svg;
  const kids = /translate\(50 60\) scale\(0\.8\)/.test(svg);
  const y = (v) => (kids ? 60 + 0.8 * v : v);
  const cords = [...svg.matchAll(/M2\d\d 128 L2\d\d (\d+)/g)].map((m) => Number(m[1]));
  const pocket = Number(/M178 (\d+) L322 \1/.exec(svg)[1]);
  assert.ok(cords.length === 2, 'the drawing has its two drawstrings');
  return { cordsEnd: y(Math.max(...cords)), pocket: y(pocket) };
}

test('hoodie fronts: the print area is below the drawn drawstrings and above the drawn pocket, its size in inches follows it', () => {
  const want = { hoodie: [10.5, 10.5], kidshoodie: [8, 8] };
  for (const id of HOODIES) {
    const p = getProduct(id);
    const side = p.sides.find((s) => s.id === 'front');
    const d = drawn(side);
    for (const z of p.sizes) {
      const a = printAreaFor(p, 'front', z.id);
      assert.ok(a.y > d.cordsEnd, `${id} ${z.id}: starts below the drawstrings (${a.y} > ${d.cordsEnd})`);
      assert.ok(a.y + a.h < d.pocket, `${id} ${z.id}: ends above the pocket (${a.y + a.h} < ${d.pocket})`);
      // Same print in inches on every size; its height follows the area's shape.
      assert.deepStrictEqual([printWidthFor(p, side, z.id), printHeightFor(p, side, z.id)], want[id], `${id} ${z.id}`);
    }
    assert.ok(side.formerArea && side.formerArea.y < side.printArea.y, `${id}: the former area is kept for designs saved before the move`);
  }
});

test('hoodie fronts: on the product and model photos the print starts below the neckline and ends above the pocket, every size', () => {
  for (const id of HOODIES) {
    const p = getProduct(id);
    const side = p.sides.find((s) => s.id === 'front');
    const std = side.printArea;
    const cfgs = [photos.POD_PHOTOS[`${id}:front`], ...photos.POD_MODELS[`${id}:front`]];
    assert.strictEqual(cfgs.length, 3, `${id}: the product photo and two models`);
    for (const cfg of cfgs) {
      const L = LANDMARKS[photoName(cfg.src)];
      assert.ok(L, `landmarks for ${cfg.src}`);
      const r = photos.POD_PHOTOS.rectFor(cfg, std.w / std.h);
      const pxPerIn = r.w / side.printWidthIn;
      for (const z of p.sizes) {
        // Where a size's print box lands on the photo (as the previews map it: relative to the standard area).
        const a = printAreaFor(p, 'front', z.id);
        const k = r.w / std.w;
        const top = r.y + (a.y - std.y) * k;
        const bottom = top + a.h * k;
        const label = `${id} ${z.id} on ${photoName(cfg.src)}`;
        assert.ok((top - L.neck) / pxPerIn >= BELOW_NECK_IN[id], `${label}: ${((top - L.neck) / pxPerIn).toFixed(2)} in below the neckline`);
        assert.ok((L.pocket - bottom) / pxPerIn >= ABOVE_POCKET_IN, `${label}: ${((L.pocket - bottom) / pxPerIn).toFixed(2)} in above the pocket`);
      }
    }
    // The zone the customer can move it in: at least 2.5 cm under the neckline, clear of the pocket.
    const cfg = photos.POD_PHOTOS[`${id}:front`];
    const L = LANDMARKS[photoName(cfg.src)];
    const at = photos.POD_PHOTOS.placement(cfg, std);
    const toPhoto = (y) => (y - at.y) / at.ky;
    const pxPerIn = cfg.rect.w / side.printWidthIn;
    const z = side.moveZone;
    assert.ok((toPhoto(z.y) - L.neck) / pxPerIn >= 0.98, `${id}: the move zone starts 2.5 cm under the neckline`);
    assert.ok((L.pocket - toPhoto(z.y + z.h)) / pxPerIn >= 0.5, `${id}: the move zone ends above the pocket`);
    for (const sz of p.sizes) {
      const a = printAreaFor(p, 'front', sz.id);
      assert.ok(a.y >= z.y && a.y + a.h <= z.y + z.h + 0.01 && a.x >= z.x && a.x + a.w <= z.x + z.w, `${id} ${sz.id}: the standard spot is inside the zone`);
    }
  }
});

test('hoodie fronts: the photo stays where it was in the editor (only the print area moved on it)', () => {
  // The editor places the photo so its print rect lands on the print area: both moved together.
  const before = { hoodie: { k: 150 / 255, x: -44.118, y: -41.471 }, kidshoodie: { k: 0.48, x: 9.04, y: 21.44 } };
  for (const id of HOODIES) {
    const side = getProduct(id).sides.find((s) => s.id === 'front');
    const at = photos.POD_PHOTOS.placement(photos.POD_PHOTOS[`${id}:front`], side.printArea);
    assert.ok(Math.abs(at.k - before[id].k) < 1e-6, `${id}: same scale`);
    assert.ok(Math.abs(at.x - before[id].x) < 0.01 && Math.abs(at.y - before[id].y) < 0.01, `${id}: same place (${at.x}, ${at.y})`);
  }
  // The zip hoodie's chest logo was already clear of the hood, the zip and the drawstring: unchanged.
  const zip = getProduct('ziphoodie').sides.find((s) => s.id === 'front');
  assert.deepStrictEqual(zip.printArea, { x: 282, y: 175, w: 60, h: 60 });
  assert.deepStrictEqual({ ...photos.POD_PHOTOS['ziphoodie:front'].rect }, { cx: 631, top: 410, w: 124 });
});

test('hoodie fronts: the embroidered chest logo stays where it was, also after the owner edits the embroidery', () => {
  const was = { hoodie: { x: 266.7, y: 200.3, w: 50.6, h: 50.6 }, kidshoodie: { x: 262.9, y: 214.8, w: 41.3, h: 41.3 } };
  for (const id of HOODIES) {
    const p = getProduct(id);
    assert.deepStrictEqual(p.embroidery.area, was[id], id);
    // A spec saved from the dashboard (catalog.js passes it as it is): same spot.
    assert.deepStrictEqual(embroideryFor(p, { cm: p.embroidery.widthIn > 3 ? [9, 9] : [7, 7], at: 'chest', surcharge: 999 }).area, was[id], `${id} after an edit`);
  }
  // Other garments keep the rule: 4.5 cm under the print area's top (adults).
  const tee = getProduct('tshirt');
  const a = tee.sides[0].printArea;
  const upc = a.w / (tee.sides[0].printWidthIn * 2.54);
  assert.strictEqual(tee.embroidery.area.y, Math.round((a.y + 4.5 * upc) * 10) / 10);
});

/** common.js in a sandbox (as the pages load it). */
function pagePOD() {
  const el = () => ({ style: {}, dataset: {}, children: [], appendChild(c) { return c; }, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const document = { readyState: 'complete', title: '', body: el(), documentElement: el(), createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} };
  const window = { addEventListener() {}, scrollTo() {}, scrollY: 0 };
  window.window = window;
  const ctx = {
    window, document, console, Intl, Date, URL, URLSearchParams, navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://ebda3.example', pathname: '/editor', search: '', href: '' },
    matchMedia: () => ({ matches: false }),
    setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  for (const f of ['js/i18n.js', 'js/common.js']) vm.runInContext(read(f), ctx, { filename: f });
  return window.POD;
}

test('designs saved before the move: POD.placedArea says where their objects are (the former area), for the size and the customer\'s move', () => {
  const POD = pagePOD();
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const hoodie = getProduct('hoodie');
  const front = hoodie.sides.find((s) => s.id === 'front');
  // Saved before 25 Nov 2026 (no area recorded): the former area, at the design's size.
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'M', { objects: [] })), front.formerArea);
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'L', {})), { x: 180.4, y: 175, w: 139.3, h: 185.7 });
  // ... where the customer had moved it.
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'M', { offset: { dx: -10, dy: 20 } })), { x: 165, y: 195, w: 150, h: 200 });
  // Saved since: the area the save recorded (here today's, so nothing needs carrying across).
  const now = printAreaFor(hoodie, 'front', 'XL');
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'XL', { area: now })), now);
  assert.deepStrictEqual(plain(POD.sizedArea(hoodie, front, 'XL')), now, 'the browser and the server agree on the size\'s area');
  // A recorded area that isn't one (text, zero size) is ignored.
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'M', { area: { x: '1', y: 2, w: 3, h: 4 } })), front.formerArea);
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, front, 'M', { area: { x: 1, y: 2, w: 0, h: 4 } })), front.formerArea);
  // A side whose area never moved: the area as it is.
  const tee = getProduct('tshirt');
  assert.deepStrictEqual(plain(POD.placedArea(tee, tee.sides[0], 'M', {})), tee.sides[0].printArea);
  // The back of the hoodie didn't move either.
  const back = hoodie.sides.find((s) => s.id === 'back');
  assert.deepStrictEqual(plain(POD.placedArea(hoodie, back, 'M', {})), back.printArea);
  // The server's twin (products.js placedAreaFor, for ready designs made from a share) agrees everywhere.
  for (const id of [...HOODIES, 'ziphoodie', 'tshirt']) {
    const p = getProduct(id);
    for (const side of p.sides) {
      for (const z of p.sizes) {
        for (const saved of [{}, { offset: { dx: 5, dy: -12 } }, { area: printAreaFor(p, side.id, z.id) }, { area: { x: 1, y: 2, w: 3, h: 4 }, offset: { dx: 1, dy: 1 } }]) {
          assert.deepStrictEqual(placedAreaFor(p, side.id, z.id, saved), plain(POD.placedArea(p, side, z.id, saved)), `${id} ${side.id} ${z.id} ${JSON.stringify(saved)}`);
        }
      }
    }
  }
});

test('a saved design keeps the area its objects were placed in (sent by the shop\'s renderer and the editor)', async () => {
  const { createApp } = require('../src/app');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-hoodie-area-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [{ max: 1e6, ms: 1000 }], designsAll: [{ max: 1e6, ms: 1000 }] }, cleanupEvery: 0 });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const area = printAreaFor(getProduct('hoodie'), 'front', 'L');
    const res = await fetch(base + '/api/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'hoodie', color: 'black', size: 'L', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi', left: 250, top: 250 }], area } } } }),
    });
    assert.strictEqual(res.status, 201);
    const saved = await (await fetch(`${base}/api/designs/${(await res.json()).id}`)).json();
    assert.deepStrictEqual(saved.editor.front.area, area);
    assert.deepStrictEqual(saved.sides.find((s) => s.id === 'front').heightIn, 10.5, 'the new print is 10.5 in high');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the shop\'s renderer records the area it placed a ready design in', () => {
  const src = read('js/design-render.js');
  assert.match(src, /sidesBody\[side\.id\] = \{ editor: \{ version: fabric\.version, objects: serialize\(st\), library: design\.id, area: \{ x: a\.x, y: a\.y, w: a\.w, h: a\.h \} \} \};/);
  assert.match(src, /const a = st\.side\.printArea;/);
});
