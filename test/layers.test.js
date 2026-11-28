'use strict';
// Layer rules shared by the editor, the preview and the server (public/js/layers.js).
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/js/layers.js');

const t = (en, ar) => ({ en, ar });
const choices = (...ids) => ids.map((id) => ({ id, name: t(id, id), price: 0, hex: '#' + (id.charCodeAt(0) * 1000003 % 0xffffff).toString(16).padStart(6, '0'), look: 'paint' }));

function product(extra = {}) {
  return {
    id: 'mltest',
    colors: [
      { id: 'white', name: t('White', 'أبيض'), hex: '#f2eee7', look: 'paint' },
      { id: 'navy', name: t('Navy', 'كحلي'), hex: '#1b2a4a', look: 'paint' },
    ],
    sizes: [{ id: '40x60' }, { id: '60x90' }],
    options: [
      { id: 'l2', keepDefault: true, choices: choices('navy', 'sky') },
      { id: 'l3', keepDefault: true, choices: [...choices('sand'), { id: 'mirror', name: t('Mirror', 'مراية'), hex: '#d4af37', look: 'mirror', thicknessMm: 2 }] },
      { id: 'l4', keepDefault: true, choices: choices('gold', 'white') },
    ],
    laser: {
      kind: 'cut', bridgeMm: 2, pieces: 'many', board: true,
      layers: [
        { id: 'l1', kind: 'backing', name: t('Back', 'خلفية'), from: 'color', cut: 'rect', thicknessMm: { '40x60': 3, '60x90': 5 } },
        { id: 'l2', kind: 'cut', name: t('Far', 'بعيدة'), from: 'option', option: 'l2', rimMm: 15, pieces: 'one' },
        { id: 'l3', kind: 'cut', name: t('Mid', 'وسطى'), from: 'option', option: 'l3', rimMm: 15, pieces: 'one' },
        { id: 'l4', kind: 'cut', name: t('Front', 'أمامية'), from: 'option', option: 'l4', rimMm: 15, pieces: 'one', bridgeMm: 2, accepts: ['text'], default: true },
      ],
      included: 3,
      layerPrice: { '40x60': 200, '60x90': 350 },
      ...extra,
    },
  };
}

test('layersOf: null without layers, normalised defaults with them', () => {
  assert.strictEqual(L.layersOf({ id: 'mug' }), null);
  assert.strictEqual(L.layersOf({ laser: { kind: 'cut' } }), null);
  assert.strictEqual(L.layersOf({ laser: { layers: [] } }), null);
  assert.strictEqual(L.layersOf({ laser: { layers: [{ id: 'BAD ID' }] } }), null);
  const list = L.layersOf(product());
  assert.strictEqual(list.length, 4);
  const l2 = list[1];
  assert.strictEqual(l2.index, 1);
  assert.strictEqual(l2.n, 2);
  assert.strictEqual(l2.level, 1);
  assert.strictEqual(l2.thicknessMm, 3);
  assert.deepStrictEqual(l2.accepts, []);
  assert.strictEqual(l2.pieces, 'one');
  assert.strictEqual(l2.minTextMm, 10);
  assert.strictEqual(list[0].cut, 'rect');
  assert.strictEqual(list[0].thicknessMm, 3, 'a per-size thickness normalises to its smallest value');
  assert.strictEqual(list.filter((l) => l.isDefault).length, 1);
  assert.strictEqual(L.layersOf({ laser: { layers: [{ id: 'a', kind: 'backing' }, { id: 'b', pieces: 'x' }] } })[1].pieces, 'many');
  assert.strictEqual(L.layersOf({ laser: { layers: [{ id: 'a', kind: 'backing' }, { id: 'b', kind: 'engrave', on: 'a', accepts: ['text'] }] } })[1].minTextMm, 3);
});

test('defaultLayer and layerOf: missing and unknown ids fall to the default', () => {
  const p = product();
  assert.strictEqual(L.defaultLayer(p).id, 'l4');
  assert.strictEqual(L.layerOf(p, { type: 'i-text' }).id, 'l4');
  assert.strictEqual(L.layerOf(p, { type: 'i-text', layer: 'zz' }).id, 'l4');
  assert.strictEqual(L.layerOf(p, { type: 'group', layer: 'l2' }).id, 'l2');
  assert.strictEqual(L.layerOf({ id: 'mug' }, { layer: 'l2' }), null);
});

test('accepts: text, shape/art, photos', () => {
  const p = product();
  const [l1, l2, , l4] = L.layersOf(p);
  assert.strictEqual(L.accepts(l4, { type: 'i-text' }), true);
  assert.strictEqual(L.accepts(l4, { type: 'textbox' }), true);
  assert.strictEqual(L.accepts(l4, { type: 'path' }), false);
  assert.strictEqual(L.accepts(l4, { type: 'image' }), false);
  assert.strictEqual(L.accepts(l2, { type: 'i-text' }), false);
  assert.strictEqual(L.accepts(l2, { type: 'group', lockLayer: true }), true, 'shop art always sits where the design put it');
  assert.strictEqual(L.accepts(l1, { type: 'image' }), false);
  assert.strictEqual(L.accepts({ accepts: ['art'] }, { type: 'group' }), true);
  assert.strictEqual(L.accepts({ accepts: ['shape'] }, { type: 'circle' }), true);
});

test('materialOf: colour, option (both value shapes), fixed, engrave, thickness overrides', () => {
  const p = product();
  const [l1, l2, l3] = L.layersOf(p);
  const back = L.materialOf(p, l1, { colorId: 'navy', sizeId: '40x60' });
  assert.strictEqual(back.id, 'navy');
  assert.strictEqual(back.hex, '#1b2a4a');
  assert.strictEqual(back.look, 'paint');
  assert.strictEqual(back.thicknessMm, 3);
  assert.strictEqual(L.materialOf(p, 'l1', { colorId: 'navy', sizeId: '60x90' }).thicknessMm, 5, 'back board is 5 mm on the big size');
  assert.strictEqual(L.materialOf(p, l1, {}).id, 'white', 'no colour selected = first colour');
  assert.strictEqual(L.materialOf(p, l2, { options: { l2: 'sky' } }).id, 'sky');
  assert.strictEqual(L.materialOf(p, l2, { options: { l2: { id: 'sky', name: 'x' } } }).id, 'sky');
  assert.strictEqual(L.materialOf(p, l2, { options: { l2: 'nope' } }).id, 'navy', 'unknown choice = first choice');
  assert.strictEqual(L.materialOf(p, l2, {}).id, 'navy');
  const mirror = L.materialOf(p, l3, { options: { l3: 'mirror' } });
  assert.strictEqual(mirror.look, 'mirror');
  assert.strictEqual(mirror.thicknessMm, 2, 'a material may override the layer thickness');

  const q = product();
  q.laser.layers.push({ id: 'fx', kind: 'cut', from: 'fixed', material: { id: 'mdf', name: t('MDF', 'MDF'), hex: '#b08e6a', look: 'wood' } });
  assert.strictEqual(L.materialOf(q, 'fx', {}).hex, '#b08e6a');

  const e = product();
  e.laser.layers.push({ id: 'nm', kind: 'engrave', on: 'l2', accepts: ['text'] });
  const eng = L.materialOf(e, 'nm', { options: { l2: 'sky' } });
  assert.strictEqual(eng.thicknessMm, 0);
  const host = L.materialOf(e, 'l2', { options: { l2: 'sky' } });
  assert.notStrictEqual(eng.hex, host.hex);
  assert.ok(parseInt(eng.hex.slice(1, 3), 16) <= parseInt(host.hex.slice(1, 3), 16), 'darker than the host');
  e.options[0].choices.push({ id: 'clear', name: t('Clear', 'شفاف'), hex: '#cfe8ff', look: 'acrylic' });
  assert.strictEqual(L.materialOf(e, 'nm', { options: { l2: 'clear' } }).hex, '#e6ecef');
});

test('stack: heights over 4 levels', () => {
  const p = product();
  const s = L.stack(p, { colorId: 'white', sizeId: '40x60', options: { l3: 'mirror' } });
  assert.deepStrictEqual(s.map((l) => l.id), ['l1', 'l2', 'l3', 'l4']);
  assert.deepStrictEqual(s.map((l) => l.zMm), [0, 3, 6, 8], 'back 3, far 3, mirror 2');
  assert.deepStrictEqual(s.map((l) => l.thicknessMm), [3, 3, 2, 3]);
  assert.strictEqual(L.stack(p, { sizeId: '60x90' })[1].zMm, 5);
  assert.strictEqual(L.stack({ id: 'mug' }, {}), null);
});

test('stack: layers sharing a level stand at the same height, the thickest sets the next level', () => {
  const p = {
    options: [{ id: 'b1', keepDefault: true, choices: choices('sky') }, { id: 'b2', keepDefault: true, choices: [{ id: 'm', name: t('m', 'm'), hex: '#d4af37', look: 'mirror', thicknessMm: 2 }] }],
    colors: [{ id: 'c', hex: '#fff' }],
    laser: {
      layers: [
        { id: 'base', kind: 'cut', level: 0, from: 'fixed', pieces: 'one', material: { id: 'mdf', hex: '#b08e6a', look: 'wood' } },
        { id: 'b1', kind: 'cut', level: 1, from: 'option', option: 'b1' },
        { id: 'b2', kind: 'cut', level: 1, from: 'option', option: 'b2' },
        { id: 'name', kind: 'cut', level: 2, from: 'color', accepts: ['text'], default: true, pieces: 'one' },
        { id: 'eng', kind: 'engrave', on: 'b1', accepts: ['text'] },
      ],
    },
  };
  const s = L.stack(p, {});
  const z = Object.fromEntries(s.map((l) => [l.id, l.zMm]));
  assert.deepStrictEqual([z.base, z.b1, z.b2, z.name], [0, 3, 3, 6]);
  assert.strictEqual(z.eng, 6, 'engraving sits on its host top face');
  assert.ok(s.findIndex((l) => l.id === 'eng') > s.findIndex((l) => l.id === 'b1'));
  assert.strictEqual(L.validate(p).filter((m) => /levels/.test(m)).length, 0);
});

test('toneFor: the layer material colour and the bridge in editor units', () => {
  const p = product();
  const sel = { colorId: 'white', options: { l4: 'gold' } };
  const tone = L.toneFor(p, { type: 'i-text' }, sel, 100);
  assert.strictEqual(tone.ink, L.materialOf(p, 'l4', sel).hex);
  assert.strictEqual(tone.light, false);
  assert.ok(Math.abs(tone.bridge - (2 / 25.4) * 100) < 1e-9);
  assert.strictEqual(L.toneFor(p, { type: 'group', layer: 'l2' }, sel, 100).bridge, 0);
  assert.strictEqual(L.toneFor({ id: 'mug' }, {}, sel, 100), null);
});

test('sortByLayer: by level then index, stable, same array', () => {
  const p = product();
  const objs = [
    { n: 'a', layer: 'l4' }, { n: 'b', layer: 'l2' }, { n: 'c', layer: 'l4' },
    { n: 'd' }, { n: 'e', layer: 'l2' }, { n: 'f', layer: 'zz' }, { n: 'g', layer: 'l1' },
  ];
  const out = L.sortByLayer(objs, p);
  assert.strictEqual(out, objs);
  assert.deepStrictEqual(objs.map((o) => o.n), ['g', 'b', 'e', 'a', 'c', 'd', 'f']);
  const plain = [{ n: 1 }, { n: 0 }];
  assert.deepStrictEqual(L.sortByLayer(plain, { id: 'mug' }), [{ n: 1 }, { n: 0 }]);
});

test('usedLayerIds: backing always, others only with an element', () => {
  const p = product();
  assert.deepStrictEqual(L.usedLayerIds(p, []), ['l1'], 'the backing is always made');
  const q = product();
  q.laser.layers[0].kind = 'backing';
  assert.deepStrictEqual(L.usedLayerIds(q, [{ type: 'i-text' }, { type: 'group', layer: 'l2' }]), ['l1', 'l2', 'l4']);
  assert.deepStrictEqual(L.usedLayerIds(q, [{ type: 'group', layer: 'unknown' }]), ['l1', 'l4']);
  assert.deepStrictEqual(L.usedLayerIds({ id: 'mug' }, [{}]), []);
});

test('extraPrice: below, at and above included; no layerPrice = 0', () => {
  const p = product();
  assert.strictEqual(L.extraPrice(p, '40x60', ['l1', 'l2', 'l3']), 0);
  assert.strictEqual(L.extraPrice(p, '40x60', ['l2', 'l3', 'l4']), 0);
  p.laser.layers.push({ id: 'l5', kind: 'cut', from: 'option', option: 'l4' });
  assert.strictEqual(L.extraPrice(p, '40x60', ['l1', 'l2', 'l3', 'l4', 'l5']), 200, 'the backing does not count');
  assert.strictEqual(L.extraPrice(p, '60x90', ['l2', 'l3', 'l4', 'l5']), 350);
  p.laser.layers.push({ id: 'l6', kind: 'cut', from: 'option', option: 'l4' });
  assert.strictEqual(L.extraPrice(p, '60x90', ['l2', 'l3', 'l4', 'l5', 'l6']), 700);
  assert.strictEqual(L.extraPrice(p, 'nosuchsize', ['l2', 'l3', 'l4', 'l5']), 0);
  delete p.laser.layerPrice;
  assert.strictEqual(L.extraPrice(p, '40x60', ['l2', 'l3', 'l4', 'l5']), 0);
  assert.strictEqual(L.extraPrice({ id: 'mug' }, '40x60', ['a']), 0);
});

test('panelsOf: one full panel unless the product has panels', () => {
  assert.deepStrictEqual(L.panelsOf(product()), [{ x: 0, y: 0, w: 1, h: 1 }]);
  assert.deepStrictEqual(L.panelsOf({ id: 'mug' }), [{ x: 0, y: 0, w: 1, h: 1 }]);
  const set = [{ x: 0, y: 0, w: 0.3, h: 1 }, { x: 0.35, y: 0, w: 0.3, h: 1 }, { x: 0.7, y: 0, w: 0.3, h: 1 }];
  assert.deepStrictEqual(L.panelsOf(product({ panels: set })), set);
});

test('validate: a good product is clean, every listed mistake is caught', () => {
  assert.deepStrictEqual(L.validate(product()), []);
  assert.deepStrictEqual(L.validate(product({ panels: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] })), []);
  const has = (p, re) => assert.ok(L.validate(p).some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(L.validate(p))}`);
  has({ id: 'mug' }, /missing/);

  let p = product(); p.laser.layers = p.laser.layers.slice(0, 1); has(p, /2 to 8/);
  p = product(); for (let i = 0; i < 6; i++) p.laser.layers.push({ id: 'x' + i, kind: 'cut', from: 'option', option: 'l2' }); has(p, /2 to 8/);
  p = product(); p.laser.layers[1].id = 'l1'; has(p, /duplicate/);
  p = product(); p.laser.layers[1].id = 'Bad-Id'; has(p, /id must be/);
  p = product(); p.laser.layers[1].id = 'waytoolongid123'; has(p, /id must be/);

  p = product();
  p.laser.layers = Array.from({ length: 6 }, (_, i) => ({ id: 'a' + i, kind: i === 0 ? 'backing' : 'cut', from: 'option', option: 'l2', pieces: 'one', level: i, accepts: i === 5 ? ['text'] : [], default: i === 5 }));
  has(p, /at most 5 levels/);

  p = product(); p.laser.layers[3].default = false; has(p, /exactly one layer/);
  p = product(); p.laser.layers[1].default = true; has(p, /exactly one layer/);
  p = product(); p.laser.layers[3].accepts = ['shape']; has(p, /must accept text/);

  p = product(); p.laser.layers[1].option = 'nope'; has(p, /not a product option/);
  p = product(); delete p.options[0].keepDefault; has(p, /keepDefault/);
  p = product(); delete p.options[0].choices[0].hex; has(p, /hex and look/);
  p = product(); delete p.options[0].choices[1].look; has(p, /hex and look/);

  p = product(); p.laser.layers[1].from = 'color'; has(p, /at most one layer may follow/);

  p = product(); p.laser.layers.push({ id: 'e1', kind: 'engrave', on: 'zz' }); has(p, /"on" must point/);
  p = product(); p.laser.layers.push({ id: 'e1', kind: 'engrave', on: 'e2' }, { id: 'e2', kind: 'engrave', on: 'l2' }); has(p, /"on" must point/);

  has(product({ panels: [{ x: 0, y: 0, w: 1.2, h: 1 }] }), /inside 0\.\.1/);
  has(product({ panels: [{ x: 0, y: 0, w: 0.6, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] }), /overlap/);
  has(product({ panels: [{ x: 0, y: 0, w: 0.2, h: 1 }, { x: 0.2, y: 0, w: 0.2, h: 1 }, { x: 0.4, y: 0, w: 0.2, h: 1 }, { x: 0.6, y: 0, w: 0.2, h: 1 }] }), /1 to 3/);

  p = product(); p.laser.layerPrice = { '40x60': 200 }; has(p, /no price for size 60x90/);

  p = product(); p.laser.layers[0] = { id: 'l1', kind: 'cut', from: 'color', pieces: 'many' }; has(p, /lowest level/);
  p = product(); p.laser.layers[0] = { id: 'l1', kind: 'cut', from: 'color', pieces: 'one' }; assert.deepStrictEqual(L.validate(p), []);
});

test('layers.js loads in a browser-like scope as window.POD_LAYERS', () => {
  const src = require('node:fs').readFileSync(require.resolve('../public/js/layers.js'), 'utf8');
  const fakeWindow = {};
  new Function('self', 'module', src).call(fakeWindow, fakeWindow, undefined);
  assert.strictEqual(typeof fakeWindow.POD_LAYERS.layersOf, 'function');
  assert.strictEqual(fakeWindow.POD_LAYERS.LIMITS.maxLayers, 8);
});
