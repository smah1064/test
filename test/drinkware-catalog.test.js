'use strict';
// Drinkware made from measurements: src/drinkware.js (buildSpec, applyTo) and how src/catalog.js lays it over a
// catalogue clone, refuses geometry changes and keeps it out of the shop until the owner checked the dimensions.
const test = require('node:test');
const assert = require('node:assert');
const { PRODUCTS } = require('../src/products');
const catalog = require('../src/catalog');
const drinkware = require('../src/drinkware');
const geom = require('../public/js/drinkware-geom');

catalog.init(PRODUCTS);

const INPUT = {
  kind: 'cup', handle: null, material: 'gloss',
  typed: { heightMm: 130, topDiaMm: 90, bottomDiaMm: 64, printTopMm: 5, printHeightMm: 120 },
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const keyOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.key;
  }
  return null;
};
const product = (id) => PRODUCTS.find((p) => p.id === id);
/** Lay these edits over the catalogue (a fresh state each time). */
function withEdits(products) {
  catalog.apply(PRODUCTS, { products });
}

test('buildSpec: the profile from the typed numbers, the band diameters along it, defaults', () => {
  const s = drinkware.buildSpec(INPUT);
  assert.strictEqual(s.v, 1);
  assert.strictEqual(s.kind, 'cup');
  assert.deepStrictEqual(s.dims, { heightMm: 130, topDiaMm: 90, bottomDiaMm: 64 });
  assert.deepStrictEqual(s.profile, [[0, 45], [130, 32]]);
  near(s.print.d1Mm, 90 - (26 * 5) / 130, 0.01, 'd1');
  near(s.print.d2Mm, 90 - (26 * 125) / 130, 0.01, 'd2');
  assert.strictEqual(s.print.gapMm, 5);
  assert.strictEqual(s.print.safeMm, 3);
  assert.strictEqual(s.handle, null);
  assert.strictEqual(s.checkedAt, null);
  assert.strictEqual(drinkware.templateFor(s), 'tumbler');
  const m = drinkware.buildSpec({ ...INPUT, kind: 'mug', handle: { widthMm: 15, y0Mm: 20, y1Mm: 100 }, gapMm: 2, safeMm: '4' });
  assert.deepStrictEqual(m.handle, { y0Mm: 20, y1Mm: 100, widthMm: 15 });
  assert.strictEqual(m.print.gapMm, 2);
  assert.strictEqual(m.print.safeMm, 4);
  assert.strictEqual(drinkware.templateFor(m), 'mug');
});

test('buildSpec refuses measurements out of range with a message key', () => {
  const t = (typed) => ({ ...INPUT, typed: { ...INPUT.typed, ...typed } });
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ heightMm: 29 }))), 'photoProductBadHeight');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ heightMm: 401 }))), 'photoProductBadHeight');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ topDiaMm: 19 }))), 'photoProductBadDiameter');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ bottomDiaMm: 201 }))), 'photoProductBadDiameter');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ bottomDiaMm: true }))), 'photoProductBadDiameter');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ heightMm: 40, topDiaMm: 90, bottomDiaMm: 60, printHeightMm: 30 }))), 'photoProductTooTapered');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ printTopMm: 20, printHeightMm: 120 }))), 'photoProductBadBand');
  assert.strictEqual(keyOf(() => drinkware.buildSpec(t({ printTopMm: -1 }))), 'photoProductBadBand');
  assert.strictEqual(keyOf(() => drinkware.buildSpec({ ...INPUT, kind: 'vase' })), 'photoProductBadKind');
  assert.strictEqual(keyOf(() => drinkware.buildSpec({ ...INPUT, material: 'wood' })), 'photoProductBadMaterial');
  assert.strictEqual(keyOf(() => drinkware.buildSpec({ ...INPUT, handle: { widthMm: 15, y0Mm: 20, y1Mm: 140 } })), 'photoProductBadHandle');
  assert.strictEqual(keyOf(() => drinkware.buildSpec({ ...INPUT, handle: { widthMm: 15, y0Mm: 80, y1Mm: 40 } })), 'photoProductBadHandle');
  assert.strictEqual(keyOf(() => drinkware.buildSpec({ ...INPUT, gapMm: 51 })), 'photoProductBadGap');
  let err;
  try {
    drinkware.buildSpec(t({ heightMm: 'tall' }));
  } catch (e) {
    err = e;
  }
  assert.strictEqual(err.field, 'typed.heightMm');
  assert.deepStrictEqual(err.params, { min: 30, max: 400 });
});

test('applyTo: one unrolled side with the fan, the lathe model and the public subset', () => {
  const spec = drinkware.buildSpec(INPUT);
  const fan = geom.fanOf(spec.print, null);
  const p = drinkware.applyTo(structuredClone(product('tumbler')), spec);
  assert.strictEqual(p.sides.length, 1);
  const sd = p.sides[0];
  assert.strictEqual(sd.id, 'front');
  assert.deepStrictEqual(sd.printArea, geom.fitArea(fan.Wrect, fan.Hrect));
  near(sd.printWidthIn, fan.Wrect / 25.4, 0.001);
  near(sd.safeIn, 3 / 25.4, 0.001);
  assert.match(sd.svg, /<svg/);
  assert.match(sd.wrap.view, /<svg/);
  assert.strictEqual(sd.overlay, undefined, 'the template overlay belongs to its own drawing');
  for (const k of ['r1', 'r2', 's', 'Ro', 'Ri', 'theta', 'phi']) near(sd.fan[k], fan[k], 1e-3, k);
  assert.strictEqual(sd.fan.wideTop, true);
  assert.strictEqual(sd.fan.gapMm, 5);
  assert.strictEqual(p.sizes.length, 1);
  assert.strictEqual(p.sizes[0].printScale, undefined);
  assert.deepStrictEqual(Object.keys(p.model).sort(), ['band', 'diameterIn', 'finish', 'handle', 'handleBand', 'heightIn', 'lid', 'material', 'profile', 'type'].sort());
  assert.strictEqual(p.model.type, 'mug');
  near(p.model.diameterIn, 90 / 25.4, 0.001);
  near(p.model.heightIn, 130 / 25.4, 0.001);
  assert.strictEqual(p.model.material, 'ceramic');
  assert.strictEqual(p.model.lid, false);
  assert.strictEqual(p.model.handle, false);
  assert.strictEqual(p.model.finish, 'gloss');
  assert.strictEqual(p.model.handleBand, null);
  near(p.model.band.y0In, 5 / 25.4, 0.001);
  near(p.model.band.y1In, 125 / 25.4, 0.001);
  near(p.model.profile[1][1], 32 / 25.4, 0.001);
  assert.deepStrictEqual(p.drink, { kind: 'cup', material: 'gloss', dims: spec.dims, template: 'fan', mockup: null });

  // A straight body: no fan on the side, a 'rect' template; metal stays metal.
  const straight = drinkware.buildSpec({ ...INPUT, material: 'metal', typed: { ...INPUT.typed, bottomDiaMm: 90 } });
  const q = drinkware.applyTo(structuredClone(product('tumbler')), straight);
  assert.strictEqual(q.sides[0].fan, undefined);
  assert.strictEqual(q.drink.template, 'rect');
  assert.strictEqual(q.model.material, 'metal');
});

test('catalogue: a hidden clone from measurements, laid over, shown to the admin and the shop', () => {
  const spec = drinkware.buildSpec({ ...INPUT, kind: 'mug', handle: { widthMm: 15, y0Mm: 20, y1Mm: 100 } });
  const n = catalog.newFromDrinkware({ id: 'Cup-One', name: { en: 'Measured mug', ar: 'مج مقاس' }, spec, createdBy: 'Owner' }, PRODUCTS);
  assert.strictEqual(n.id, 'cup-one');
  assert.strictEqual(n.template, 'mug');
  assert.strictEqual(n.edit.status, 'hidden');
  assert.strictEqual(n.edit.template, 'mug');
  assert.deepStrictEqual(n.edit.name, { en: 'Measured mug', ar: 'مج مقاس' });
  assert.strictEqual(n.edit.drinkware.checkedAt, null);
  assert.deepStrictEqual(catalog.newFromDrinkware({ id: 'mug', spec }, PRODUCTS), { error: 'productIdTaken' });
  assert.strictEqual(catalog.newFromDrinkware({ id: 'x1', spec: { v: 2 } }, PRODUCTS).error, 'badProductField');
  assert.strictEqual(catalog.newFromDrinkware({ id: '-bad', spec }, PRODUCTS).error, 'badProductId');

  withEdits({ [n.id]: n.edit });
  const p = product('cup-one');
  assert.ok(p, 'the clone is in the catalogue');
  assert.strictEqual(p.base, 'mug');
  assert.strictEqual(p.status, 'hidden');
  assert.strictEqual(catalog.visible(p), false);
  assert.ok(p.sides[0].fan);
  assert.strictEqual(p.model.handle, true);
  assert.deepStrictEqual(p.model.handleBand, { y0In: Math.round((20 / 25.4) * 1000) / 1000, y1In: Math.round((100 / 25.4) * 1000) / 1000 });
  assert.strictEqual(p.sizes.length, 1, 'one physical size (the 15 oz print scale is gone)');
  // The mug it was made from is unchanged.
  assert.strictEqual(product('mug').sides[0].fan, undefined);
  assert.strictEqual(product('mug').model.profile, undefined);

  const shop = catalog.forShop(p);
  assert.deepStrictEqual(shop.drink, p.drink);
  assert.ok(shop.sides[0].fan);
  assert.strictEqual(shop.drinkware, undefined, 'the spec itself stays in the admin');
  const admin = catalog.forAdmin(p, n.edit);
  assert.strictEqual(admin.fromPhotos, true);
  assert.deepStrictEqual(admin.drinkware, n.edit.drinkware);
  assert.strictEqual(catalog.forAdmin(product('mug'), null).drinkware, null);
  assert.strictEqual(catalog.forAdmin(product('mug'), null).fromPhotos, undefined);
  assert.deepStrictEqual(catalog.keepFixed(n.edit, { name: { en: 'x', ar: 'y' } }).drinkware, n.edit.drinkware);
});

test('clean: no geometry changes on drinkware; the same values sent back are fine', () => {
  const spec = drinkware.buildSpec(INPUT);
  const { id, edit } = catalog.newFromDrinkware({ id: 'cup-two', name: { en: 'Cup', ar: 'كوباية' }, spec }, PRODUCTS);
  withEdits({ [id]: edit });
  const p = product(id);
  const sd = p.sides[0];
  const same = { front: { printWidthCm: Math.round(sd.printWidthIn * 254) / 100, area: { ...sd.printArea }, safeMm: 3, bleedMm: 0 } };
  const ok = catalog.clean(p, { sides: same }, { prev: edit });
  assert.ok(!ok.error, JSON.stringify(ok));
  assert.strictEqual(ok.edit.sides && ok.edit.sides.front && ok.edit.sides.front.area, undefined);
  assert.strictEqual(ok.edit.sides && ok.edit.sides.front && ok.edit.sides.front.printWidthCm, undefined);
  assert.deepStrictEqual(catalog.clean(p, { sides: { front: { ...same.front, printWidthCm: 30 } } }, { prev: edit }), { error: 'photoProductGeometry', field: 'sides.front.printWidthCm' });
  assert.deepStrictEqual(catalog.clean(p, { sides: { front: { area: { ...sd.printArea, w: sd.printArea.w - 20 } } } }, { prev: edit }), { error: 'photoProductGeometry', field: 'sides.front.area' });
  const scaled = { addSizes: [{ id: 'big', label: { en: 'Big', ar: 'كبير' }, surcharge: 50, printScale: 1.2 }] };
  assert.deepStrictEqual(catalog.clean(p, scaled, { prev: edit }), { error: 'photoProductGeometry', field: 'addSizes' });
  // Other products keep their usual rules.
  const tumbler = product('tumbler');
  assert.ok(catalog.clean(tumbler, { sides: { front: { printWidthCm: 10 } } }, { prev: null }).edit.sides.front.printWidthCm === 10);
});

test('clean: not in the shop before the owner checked the dimensions', () => {
  const spec = drinkware.buildSpec(INPUT);
  const { id, edit } = catalog.newFromDrinkware({ id: 'cup-three', spec }, PRODUCTS);
  withEdits({ [id]: edit });
  const p = product(id);
  assert.deepStrictEqual(catalog.clean(p, { status: 'live' }, { prev: edit }), { error: 'photoProductNotChecked', field: 'status' });
  const future = '2999-01-01';
  assert.deepStrictEqual(catalog.clean(p, { status: 'hidden', showAgainOn: future }, { prev: edit }), { error: 'photoProductNotChecked', field: 'showAgainOn' });
  assert.ok(!catalog.clean(p, { status: 'hidden', hiddenReason: 'other' }, { prev: edit }).error);

  const checked = catalog.markChecked(edit, 'Owner');
  assert.ok(checked.drinkware.checkedAt);
  assert.strictEqual(checked.drinkware.checkedBy, 'Owner');
  assert.strictEqual(edit.drinkware.checkedAt, null, 'the old edit is not changed');
  assert.deepStrictEqual(catalog.clean(p, { status: 'live' }, { prev: checked }), { edit: {} });

  // New measurements clear the check and pause a product that was in the shop.
  const live = { ...checked, status: undefined };
  delete live.hiddenReason;
  delete live.hiddenNote;
  const again = catalog.remeasure(live, drinkware.buildSpec({ ...INPUT, typed: { ...INPUT.typed, heightMm: 131 } }));
  assert.strictEqual(again.drinkware.checkedAt, null);
  assert.strictEqual(again.drinkware.dims.heightMm, 131);
  assert.strictEqual(again.status, 'hidden');
  assert.strictEqual(again.template, 'tumbler');
  // Adding a handle would need the mug: refused.
  assert.deepStrictEqual(catalog.remeasure(live, drinkware.buildSpec({ ...INPUT, handle: { widthMm: 15, y0Mm: 20, y1Mm: 100 } })), { error: 'photoProductGeometry', field: 'handle' });
  assert.strictEqual(catalog.remeasure({ template: 'mug' }, spec).error, 'badProductField');
  assert.strictEqual(catalog.markChecked({}, 'x').error, 'badProductField');
});

test('a broken spec leaves the template as it is (the shop keeps working)', () => {
  withEdits({ 'cup-four': { template: 'tumbler', createdAt: '2026-11-27T00:00:00Z', status: 'hidden', drinkware: { v: 1, print: { d1Mm: 0 } } } });
  const p = product('cup-four');
  assert.ok(p);
  assert.strictEqual(p.sides[0].fan, undefined);
  assert.strictEqual(p.drink, undefined);
});
