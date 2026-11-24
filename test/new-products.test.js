'use strict';

// The cards, business print, packaging, calendar and event products: they are in
// the catalogue in both languages, every size has a price and the right physical
// print size, the print areas sit on their drawings, and a design can be made and
// completed on each of them through the API (as the editor does).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, priceFor, printWidthFor, MOCKUP_WIDTH, MOCKUP_HEIGHT } = require('../src/products');

// Physical trim size (cm, width × height of the print area) of every new product, per size where sizes differ.
const TRIM = {
  postcards: [10, 15],
  foldedcards: [10.5, 14.8],
  giftvouchers: [21, 10],
  bookmarks: [5, 15],
  brochures: [29.7, 21],
  menus: { 'A4-10': [21, 29.7], 'A4-25': [21, 29.7], 'A4-50': [21, 29.7], 'A3-10': [29.7, 42], 'A3-25': [29.7, 42] },
  notepads: { 'A6-1': [10.5, 14.8], 'A6-5': [10.5, 14.8], 'A6-10': [10.5, 14.8], 'A5-1': [14.8, 21], 'A5-5': [14.8, 21], 'A5-10': [14.8, 21] },
  folders: [44, 31],
  booklets: [14.8, 21],
  labels: { '50x30-100': [5, 3], '50x30-250': [5, 3], '50x30-500': [5, 3], '50x30-1000': [5, 3], '75x45-100': [7.5, 4.5], '75x45-250': [7.5, 4.5], '75x45-500': [7.5, 4.5], '100x60-100': [10, 6], '100x60-250': [10, 6], '100x60-500': [10, 6] },
  wrappingpaper: null, // a repeating tile (its size is chosen in the editor); each sheet is size.cm
  windowstickers: { 20: [20, 20], 30: [30, 30], 50: [50, 50], 70: [70, 70] },
  calendar: [29.7, 42],
  deskcalendar: [10.5, 14.8],
  photobook: { 100: [20, 25], 200: [24, 30] },
  magnets: { '60x90-1': [6, 9], '60x90-100': [6, 9], '80x120-1': [8, 12], '80x120-100': [8, 12], '100x150-1': [10, 15], '100x150-100': [10, 15] },
  banners: { '100x50': [100, 50], '150x75': [150, 75], '200x100': [200, 100] },
  tablenumbers: [15, 10],
  placecards: [9, 5],
};
const IDS = Object.keys(TRIM);
const byId = (id) => PRODUCTS.find((p) => p.id === id);

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-newprod-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the new products are in the catalogue, in English and Arabic, in a known category', async () => {
  const body = await (await fetch(base + '/api/products')).json();
  for (const id of IDS) {
    const p = body.products.find((x) => x.id === id);
    assert.ok(p, `${id} is listed`);
    assert.ok(p.name.en && p.name.ar && /[؀-ۿ]/.test(p.name.ar), `${id} name`);
    assert.ok(p.description.en && p.description.ar && /[؀-ۿ]/.test(p.description.ar), `${id} description`);
    assert.ok(body.categories.some((c) => c.id === p.category), `${id} category`);
    for (const c of p.colors) assert.ok(c.name.en && c.name.ar && /^#[0-9a-f]{6}$/i.test(c.hex), `${id}/${c.id} colour`);
    for (const s of p.sides) assert.ok(s.printHeightIn > 0 && s.svg.startsWith('<svg'), `${id}/${s.id} side`);
  }
  assert.strictEqual(new Set(body.products.map((p) => p.id)).size, body.products.length, 'product ids are unique');
});

test('every size has a price, and bigger packs cost more', () => {
  for (const id of IDS) {
    const p = byId(id);
    assert.ok(p.basePrice > 0, `${id} base price`);
    for (const z of p.sizes) {
      assert.ok(z.label.en && z.label.ar, `${id}/${z.id} label`);
      const one = priceFor(p, z.id, 1);
      assert.ok(Number.isFinite(one) && one > 0, `${id}/${z.id} priced`);
      assert.ok(priceFor(p, z.id, p.sides.length) >= one, `${id}/${z.id} more sides never cost less`);
    }
    for (const o of p.options || []) {
      for (const c of o.choices.slice(1)) {
        for (const z of p.sizes) assert.ok((typeof c.price === 'number' ? c.price : c.price[z.id]) > 0, `${id} ${o.id}/${c.id} priced for ${z.id}`);
      }
    }
  }
});

test('print areas sit inside the drawing, and every size prints at its real size', () => {
  for (const id of IDS) {
    const p = byId(id);
    for (const s of p.sides) {
      const a = s.printArea;
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= MOCKUP_WIDTH && a.y + a.h <= MOCKUP_HEIGHT, `${id}/${s.id} print area inside the mockup`);
      assert.ok(s.printWidthIn > 0 && s.bleedIn >= 0 && s.safeIn >= 0 && s.safeIn * 2 < s.printWidthIn, `${id}/${s.id} sizes`);
      assert.ok(p.process && p.model && p.model.type, `${id} production`);
      for (const layer of [s.svg, s.overlay].filter(Boolean)) {
        assert.ok(/^<svg[^>]*viewBox="0 0 500 600"/.test(layer) && layer.endsWith('</svg>'), `${id}/${s.id} drawing`);
      }
      if (!TRIM[id]) continue;
      for (const z of p.sizes) {
        const [wCm, hCm] = Array.isArray(TRIM[id]) ? TRIM[id] : TRIM[id][z.id];
        const wIn = printWidthFor(p, s, z.id);
        const hIn = (wIn * a.h) / a.w;
        assert.ok(Math.abs(wIn * 2.54 - wCm) < 0.12, `${id}/${s.id}/${z.id}: ${(wIn * 2.54).toFixed(2)} cm wide, want ${wCm}`);
        assert.ok(Math.abs(hIn * 2.54 - hCm) < 0.12, `${id}/${s.id}/${z.id}: ${(hIn * 2.54).toFixed(2)} cm high, want ${hCm}`);
      }
    }
  }
  // Wrapping paper: a pattern on 50 × 70 cm sheets.
  const wrap = byId('wrappingpaper');
  assert.ok(wrap.pattern && wrap.pattern.tiles.includes(wrap.pattern.tile));
  assert.ok(wrap.sizes.every((z) => z.cm[0] === 50 && z.cm[1] === 70));
  // Name lists: one table number / guest name per card.
  assert.ok(byId('tablenumbers').merge && byId('placecards').merge);
});

/** Create a design on every side of a product the way the editor does, upload its files and complete it. */
async function makeDesign(p, size, extra = {}) {
  const sides = Object.fromEntries(p.sides.map((s) => [s.id, { editor: { objects: [{ type: 'i-text', text: 'Hi' }], ...(p.pattern ? { pattern: { repeat: 'halfdrop', tileCm: p.pattern.tile } } : {}) } }]));
  const res = await post('/api/designs', { productId: p.id, color: p.colors[0].id, size: size.id, sides, ...extra });
  assert.strictEqual(res.status, 201, `${p.id}: ${await res.clone().text()}`);
  const created = await res.json();
  for (const name of created.files) {
    const side = p.sides.find((s) => name.startsWith(`${s.id}-`));
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      // About 100 DPI at the side's real size (with its bleed), as a print file is.
      const wIn = p.pattern ? p.pattern.tile / 2.54 : printWidthFor(p, side, size.id) + 2 * side.bleedIn;
      const hIn = p.pattern ? wIn : (printWidthFor(p, side, size.id) * side.printArea.h) / side.printArea.w + 2 * side.bleedIn;
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, `${p.id} ${name}`);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, `${p.id}: ${await done.clone().text()}`);
  return done.json();
}

test('a design can be made and completed on every new product, at its biggest size', async () => {
  for (const id of IDS) {
    const p = byId(id);
    const size = p.sizes[p.sizes.length - 1];
    const d = await makeDesign(p, size);
    assert.strictEqual(d.status, 'ready', id);
    assert.strictEqual(d.sides.length, p.sides.length, id);
    assert.strictEqual(d.price, priceFor(p, size.id, p.sides.length), `${id} priced on the server`);
    for (const s of d.sides) assert.ok(s.dpi >= 95 && s.dpi <= 105, `${id}/${s.id}: ${s.dpi} DPI`);
  }
});

test('options are charged per pack (menu lamination)', async () => {
  const p = byId('menus');
  const d = await makeDesign(p, p.sizes.find((z) => z.id === 'A3-25'), { options: { lamination: 'matte' } });
  assert.strictEqual(d.price, priceFor(p, 'A3-25', 2) + 400);
});
