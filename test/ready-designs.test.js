'use strict';

// Ready designs on the right products and in the right place:
// - a design drawn for a dark colour (white or neon ink) is only offered where it can be
//   printed on a dark colour, or where nothing in it would disappear on a light one;
// - products with a part that is not seen (the wall calendar's month pad) or a front
//   (folders, the brochure's cover panel) place ready designs in that zone;
// - the catalogue pictures (public/img/designed/) only show designs the product offers,
//   and products with none show the plain product;
// - A6 notepads print at the A6 trim height.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SEED, productsFor, fitsColour, productShape } = require('../src/library');
const { PRODUCTS, printWidthFor, printHeightFor } = require('../src/products');

const byId = (id) => SEED.find((d) => d.id === id);
const product = (id) => PRODUCTS.find((p) => p.id === id);
const on = (id, pid) => productsFor(byId(id)).includes(pid);
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const dark = (hex) => luminance(hex) < 0.45;

/** The browser's template code (public/js/templates.js), for readyArea. */
function browserTemplates() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8'), { window, document: { fonts: {} }, fabric: {} });
  return window.POD_DESIGN;
}

test('designs drawn for a dark colour are not offered on products that only come light', () => {
  // The ones QA found: white line art, neon and cream text on white postcards, cushions, calendars.
  const darkOnly = ['fa-eid-neon', 'fa-isl-alhamdulillah', 'st-luxury-aneek', 'st-luxury-nour', 'st-trends-mood', 'st-gaming-tag', 'st-fitness-mkammleen', 'st-gaming-game-on', 'st-gaming-lvl-99'];
  for (const id of darkOnly) {
    assert.ok(byId(id), id);
    for (const pid of ['postcards', 'cushion', 'calendar', 'magnets', 'notepads', 'poster', 'canvas', 'prayermat']) assert.ok(!on(id, pid), `${id} not on ${pid}`);
  }
  // Still on the products that come in black.
  for (const id of ['st-fitness-mkammleen', 'st-gaming-game-on', 'fa-eid-neon']) assert.ok(on(id, 'mug') && on(id, 'tshirt'), `${id} on the black mug and T-shirt`);
  // A dark design with nothing in a fixed light colour (ink that adapts, white text on an orange badge) reads on white.
  assert.ok(on('pp-biz-staff', 'idcards') && on('pp-biz-finisher', 'certificates'));
  // Posters print on white paper whatever the frame colour.
  assert.ok(!on('st-gaming-game-on', 'poster'));
});

test('every design offered on a product suits one of its colours', () => {
  const bad = [];
  for (const d of SEED) {
    if (Array.isArray(d.products)) continue; // laser designs: chosen by hand
    for (const pid of productsFor(d)) if (!fitsColour(d, product(pid))) bad.push(`${d.id} on ${pid}`);
  }
  assert.deepStrictEqual(bad, []);
  // And the check itself: a white-ink design on a white-only product is refused, on a black one allowed.
  const neon = byId('fa-eid-neon');
  assert.strictEqual(fitsColour(neon, product('postcards')), false);
  assert.strictEqual(fitsColour(neon, product('mug')), true);
  assert.ok(product('mug').colors.some((c) => dark(c.hex)));
});

test('the wall calendar, folders and brochures place ready designs in their design zone', () => {
  const cal = product('calendar').sides[0].printArea;
  assert.ok(cal.readyZone, 'calendar has a design zone');
  // The month pad (and its staples) starts at 51% of the sheet: the zone ends above it.
  assert.ok(cal.readyZone.y === 0 && cal.readyZone.y + cal.readyZone.h <= 0.5 && cal.readyZone.w === 1, 'top half, above the pad');
  const folder = product('folders').sides[0].printArea;
  assert.deepStrictEqual([folder.readyZone.x, folder.readyZone.w], [0.5, 0.5], 'folder front: the right half');
  assert.deepStrictEqual([folder.readyZoneRtl.x, folder.readyZoneRtl.w], [0, 0.5], 'Arabic folder front: the left half');
  const outside = product('brochures').sides[0].printArea;
  assert.ok(Math.abs(outside.readyZone.x - 2 / 3) < 1e-9 && Math.abs(outside.readyZone.w - 1 / 3) < 1e-9, 'brochure cover: the right-hand third');
  assert.ok(outside.readyZoneRtl.x === 0 && Math.abs(outside.readyZoneRtl.w - 1 / 3) < 1e-9, 'Arabic brochure cover: the left-hand third');
  assert.ok(!product('brochures').sides[1].printArea.readyZone, 'inside: the whole spread');
  // The desk calendar's design half is its whole print area (no zone needed).
  assert.ok(!product('deskcalendar').sides[0].printArea.readyZone);
  // The shape check uses the zone (the calendar's top half is wide).
  assert.ok(Math.abs(productShape(product('calendar')) - (cal.w / (cal.h * cal.readyZone.h))) < 1e-9);

  // The browser places templates in the zone: English-led on the right, Arabic-led on the left.
  const { readyArea } = browserTemplates();
  const en = { items: [{ kind: 'text', text: 'SALON', size: 0.2 }, { kind: 'text', text: 'صالون', size: 0.06 }] };
  const ar = { items: [{ kind: 'text', text: 'صالون', size: 0.2 }, { kind: 'text', text: '2026', size: 0.3 }, { kind: 'text', text: 'SALON', size: 0.06 }] };
  const f = readyArea(folder, en);
  assert.deepStrictEqual([f.x, f.w, f.y, f.h], [folder.x + folder.w / 2, folder.w / 2, folder.y, folder.h]);
  assert.strictEqual(readyArea(folder, ar).x, folder.x);
  const c = readyArea(cal, en);
  const padTop = 250; // WALL_CAL_PAD: the month sheets start at y 250 (staples at 245)
  assert.ok(c.y === cal.y && c.y + c.h < 245 && c.y + c.h < padTop && c.w === cal.w, `calendar zone ${JSON.stringify(c)}`);
  const plain = { x: 1, y: 2, w: 3, h: 4 };
  assert.strictEqual(readyArea(plain, en), plain, 'no zone: the whole area');
});

test('the catalogue pictures only show designs the product offers; products with none show the plain product', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/img/designed/index.json'), 'utf8'));
  const general = PRODUCTS.filter((p) => !(p.laser || p.pattern || p.kind));
  const none = general.filter((p) => !SEED.some((d) => productsFor(d).includes(p.id))).map((p) => p.id);
  for (const id of ['bookmarks', 'giftvouchers', 'banners', 'placecards', 'deskmat', 'dlenvelopes']) assert.ok(none.includes(id), `${id} has no ready designs`);
  const bad = [];
  for (const [pid, e] of Object.entries(index)) {
    const p = product(pid);
    if (!p || p.pattern || p.kind) continue;
    if (none.includes(pid)) {
      if (e.design !== 'plain') bad.push(`${pid}: shows ${e.design}, but has no ready designs`);
      continue;
    }
    const d = byId(e.design);
    if (!d || !productsFor(d).includes(pid)) bad.push(`${pid}: shows ${e.design}, which it does not offer`);
  }
  assert.deepStrictEqual(bad, []);
  // The product page hides "pick a ready design" when there are none.
  const page = fs.readFileSync(path.join(__dirname, '../public/js/product.js'), 'utf8');
  assert.ok(/\$\('pp-ready'\)\.hidden = none/.test(page));
});

test('A6 notepads print at 10.5 × 14.8 cm, A5 at 14.8 × 21 cm', () => {
  const p = product('notepads');
  const side = p.sides[0];
  for (const z of p.sizes) {
    const [w, h] = z.id.startsWith('A6') ? [10.5, 14.8] : [14.8, 21];
    assert.ok(Math.abs(printWidthFor(p, side, z.id) * 2.54 - w) < 0.02, `${z.id} width`);
    assert.ok(Math.abs(printHeightFor(p, side, z.id) * 2.54 - h) < 0.02, `${z.id} height ${(printHeightFor(p, side, z.id) * 2.54).toFixed(2)}`);
  }
  // Every other product: the drawing area's shape at the size's scale.
  const poster = product('poster');
  const ps = poster.sides[0];
  assert.ok(Math.abs(printHeightFor(poster, ps, '30x40') - (printWidthFor(poster, ps, '30x40') * ps.printArea.h) / ps.printArea.w) < 0.01);
});
