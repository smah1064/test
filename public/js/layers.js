/* Layers: the rules of multi-layer wall art (laser / CNC cut sheets glued on top of each other).
 * Shared by the editor, the ready-design page, the 3D preview and the server, so all of them agree on
 * which layer an element is on, which material and colour a layer has, how high it sits and what
 * the extra layers cost. Pure functions: no DOM, no Fabric. Browser: `window.POD_LAYERS`; Node: require.
 *
 *   layersOf(product)                    normalised layers, or null for a product without layers
 *   defaultLayer(product)                where new elements go
 *   layerOf(product, obj)                the layer of a Fabric object (missing / unknown id = default)
 *   accepts(layer, obj)                  may this kind of element sit on this layer?
 *   materialOf(product, layer, sel)      { id, name, hex, look, thicknessMm } of one layer
 *   stack(product, sel)                  layers bottom to top with material, thickness and height (zMm)
 *   toneFor(product, obj, sel, upi)      { ink, light, bridge } for POD_FX.laserTone
 *   sortByLayer(objects, product)        stable sort by (level, index), in place
 *   usedLayerIds(product, objects)       backing layers + layers that have an element on them
 *   extraPrice(product, sizeId, ids)     price of cut layers beyond `laser.included`
 *   panelsOf(product)                    [{ x, y, w, h }] fractions of the print area
 *   validate(product)                    data mistakes for the product tests (empty = fine)
 *
 * `sel` = { colorId, sizeId, options }. Option values may be 'navy' or { id: 'navy' } (editor state or a
 * stored design). Thickness may be a number or { sizeId: mm } on a layer, a colour or an option choice
 * (a choice's own value wins), so the workshop's materials can change without code changes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POD_LAYERS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { maxLayers: 8, maxLevels: 5, maxPanels: 3 };
  const ID_RE = /^[a-z0-9]{1,12}$/;
  const KINDS = ['backing', 'cut', 'engrave'];
  const FROMS = ['color', 'option', 'fixed'];
  const CUTS = ['rect', 'rounded', 'round', 'arch'];
  const ACCEPTS = ['text', 'shape', 'art'];
  const DEFAULT_THICKNESS = 3;
  const TEXT_TYPES = ['i-text', 'text', 'textbox'];
  const SHAPE_TYPES = ['group', 'path', 'rect', 'circle', 'ellipse', 'triangle', 'polygon', 'polyline', 'line'];
  const ENGRAVE_ON_LIGHT = '#e6ecef';

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const rawLayers = (product) => {
    const l = product && product.laser && product.laser.layers;
    return Array.isArray(l) ? l : null;
  };

  /** A thickness that may differ per size: { '40x60': 3, '60x90': 5 }. */
  function thicknessFor(t, sizeId) {
    if (isNum(t)) return t;
    if (t && typeof t === 'object') {
      if (sizeId != null && isNum(t[sizeId])) return t[sizeId];
      const all = Object.values(t).filter(isNum);
      if (all.length) return Math.min(...all);
    }
    return null;
  }

  function normalise(raw, index) {
    const kind = KINDS.includes(raw.kind) ? raw.kind : 'cut';
    const from = FROMS.includes(raw.from) ? raw.from : (raw.option ? 'option' : raw.material ? 'fixed' : 'color');
    const th = thicknessFor(raw.thicknessMm, null);
    return {
      id: raw.id,
      index,
      n: index + 1,
      level: isNum(raw.level) ? raw.level : index,
      kind,
      name: raw.name || raw.id,
      from,
      option: raw.option || null,
      material: raw.material || null,
      on: raw.on || null,
      thicknessMm: kind === 'engrave' ? 0 : (th != null && th > 0 ? th : DEFAULT_THICKNESS),
      thicknessBySize: kind !== 'engrave' && raw.thicknessMm && typeof raw.thicknessMm === 'object' ? raw.thicknessMm : null,
      cut: kind === 'backing' ? (raw.cut || 'rect') : null,
      radiusMm: isNum(raw.radiusMm) ? raw.radiusMm : 0,
      rimMm: kind === 'cut' && isNum(raw.rimMm) ? raw.rimMm : 0,
      pieces: raw.pieces === 'one' ? 'one' : 'many',
      bridgeMm: kind === 'cut' && isNum(raw.bridgeMm) ? raw.bridgeMm : 0,
      accepts: Array.isArray(raw.accepts) ? raw.accepts.slice() : [],
      minTextMm: isNum(raw.minTextMm) ? raw.minTextMm : (kind === 'engrave' ? 3 : 10),
      isDefault: false,
    };
  }

  /** Normalised layers (list order = bottom to top), or null unless the product has a usable layer list. */
  function layersOf(product) {
    const raw = rawLayers(product);
    if (!raw || !raw.length || raw.length > LIMITS.maxLayers) return null;
    if (!raw.every((l) => l && typeof l === 'object' && typeof l.id === 'string' && ID_RE.test(l.id))) return null;
    if (new Set(raw.map((l) => l.id)).size !== raw.length) return null;
    const list = raw.map(normalise);
    // An engrave layer sits at its host's level, so it sorts straight after the host.
    for (const l of list) {
      if (l.kind !== 'engrave') continue;
      const host = list.find((h) => h.id === l.on);
      if (host) l.level = host.level;
    }
    const flagged = raw.findIndex((l) => l.default === true);
    let d = flagged;
    if (d < 0) d = list.findIndex((l) => l.accepts.includes('text'));
    if (d < 0) d = 0;
    list[d].isDefault = true;
    return list;
  }

  function defaultLayer(product) {
    const list = layersOf(product);
    return list ? list.find((l) => l.isDefault) : null;
  }

  function layerOf(product, obj) {
    const list = layersOf(product);
    if (!list) return null;
    const id = obj && obj.layer;
    return list.find((l) => l.id === id) || list.find((l) => l.isDefault);
  }

  /** May this element sit on this layer? Shop artwork (`lockLayer`) always belongs where the design put it. */
  function accepts(layer, obj) {
    if (!layer || !obj) return false;
    if (obj.lockLayer) return true;
    const t = String(obj.type || '').toLowerCase();
    if (TEXT_TYPES.includes(t)) return layer.accepts.includes('text');
    if (SHAPE_TYPES.includes(t)) return layer.accepts.includes('shape') || layer.accepts.includes('art');
    return false; // photos make no sense on cut layers
  }

  const unwrap = (v) => (v && typeof v === 'object' ? v.id : v);

  function darker(hex, f) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#3a2a1c';
    const c = [0, 2, 4].map((i) => Math.max(0, Math.round(parseInt(m[1].slice(i, i + 2), 16) * f)));
    return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  function resolveLayer(product, layer) {
    if (layer && typeof layer === 'object') return layer;
    const list = layersOf(product);
    return list ? list.find((l) => l.id === layer) || null : null;
  }

  function sizeThickness(layer, mat, sizeId) {
    const own = thicknessFor(mat && mat.thicknessMm, sizeId);
    if (own != null && own >= 0) return own;
    const t = thicknessFor(layer.thicknessBySize || layer.thicknessMm, sizeId);
    return t != null ? t : DEFAULT_THICKNESS;
  }

  function materialOf(product, layerArg, sel) {
    sel = sel || {};
    const layer = resolveLayer(product, layerArg);
    if (!layer) return null;
    if (layer.kind === 'engrave') {
      const host = resolveLayer(product, layer.on);
      const base = host ? materialOf(product, host, sel) : { id: '', name: layer.name, hex: '#b08e6a', look: 'wood' };
      const light = base.look === 'acrylic' || base.look === 'mirror';
      return { id: base.id, name: base.name, hex: light ? ENGRAVE_ON_LIGHT : darker(base.hex, 0.55), look: base.look, thicknessMm: 0 };
    }
    let src = null;
    if (layer.from === 'color') {
      const colors = (product && product.colors) || [];
      src = colors.find((c) => c.id === sel.colorId) || colors[0] || null;
    } else if (layer.from === 'option') {
      const opt = ((product && product.options) || []).find((o) => o.id === layer.option);
      const choices = (opt && opt.choices) || [];
      const want = unwrap(sel.options && sel.options[layer.option]);
      src = choices.find((c) => c.id === want) || choices[0] || null;
    } else {
      src = layer.material;
    }
    src = src || { id: '', name: layer.name, hex: '#999999', look: 'paint' };
    return {
      id: src.id,
      name: src.name,
      hex: src.hex || '#999999',
      look: src.look || 'paint',
      thicknessMm: sizeThickness(layer, src, sel.sizeId),
    };
  }

  /** The layers bottom to top: each with its material, thickness and zMm (height of its underside). */
  function stack(product, sel) {
    const list = layersOf(product);
    if (!list) return null;
    sel = sel || {};
    const items = list.map((l) => {
      const material = materialOf(product, l, sel);
      return { ...l, material, thicknessMm: material.thicknessMm, zMm: 0 };
    });
    items.sort((a, b) => a.level - b.level || a.index - b.index);
    const levels = [...new Set(items.filter((l) => l.kind !== 'engrave').map((l) => l.level))].sort((a, b) => a - b);
    const base = {};
    let z = 0;
    for (const lv of levels) {
      base[lv] = z;
      z += Math.max(0, ...items.filter((l) => l.kind !== 'engrave' && l.level === lv).map((l) => l.thicknessMm));
    }
    for (const l of items) {
      if (l.kind === 'engrave') {
        const host = items.find((h) => h.id === l.on);
        l.zMm = host ? host.zMm + host.thicknessMm : (base[l.level] || 0);
      } else {
        l.zMm = base[l.level];
      }
    }
    return items;
  }

  function toneFor(product, obj, sel, unitsPerInch) {
    const layer = layerOf(product, obj);
    if (!layer) return null;
    const m = materialOf(product, layer, sel);
    const bridge = layer.kind === 'cut' && layer.bridgeMm > 0 && unitsPerInch > 0 ? (layer.bridgeMm / 25.4) * unitsPerInch : 0;
    return { ink: m.hex, light: false, bridge };
  }

  function sortByLayer(objects, product) {
    const list = layersOf(product);
    if (!list || !Array.isArray(objects)) return objects;
    const rank = (o) => {
      const l = layerOf(product, o);
      return l.level * 100 + l.index;
    };
    const keyed = objects.map((o, i) => ({ o, i, r: rank(o) }));
    keyed.sort((a, b) => a.r - b.r || a.i - b.i);
    keyed.forEach((k, i) => { objects[i] = k.o; });
    return objects;
  }

  function usedLayerIds(product, objects) {
    const list = layersOf(product);
    if (!list) return [];
    const on = new Set();
    for (const o of objects || []) if (o) on.add(layerOf(product, o).id);
    return list
      .filter((l) => l.kind === 'backing' || on.has(l.id))
      .sort((a, b) => a.level - b.level || a.index - b.index)
      .map((l) => l.id);
  }

  function extraPrice(product, sizeId, usedIds) {
    const list = layersOf(product);
    const lp = product && product.laser && product.laser.layerPrice;
    if (!list || !lp || !isNum(lp[sizeId])) return 0;
    const included = isNum(product.laser.included) ? product.laser.included : 0;
    const ids = new Set(usedIds || []);
    const used = list.filter((l) => l.kind === 'cut' && ids.has(l.id)).length;
    return Math.max(0, used - included) * lp[sizeId];
  }

  function validPanels(product) {
    const p = product && product.laser && product.laser.panels;
    return Array.isArray(p) && p.length ? p : null;
  }

  function panelsOf(product) {
    const p = validPanels(product);
    if (!p) return [{ x: 0, y: 0, w: 1, h: 1 }];
    return p.slice(0, LIMITS.maxPanels).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  function validate(product) {
    const out = [];
    const raw = rawLayers(product);
    if (!raw) return ['laser.layers is missing'];
    if (raw.length < 2 || raw.length > LIMITS.maxLayers) out.push(`needs 2 to ${LIMITS.maxLayers} layers, has ${raw.length}`);
    const ids = new Set();
    raw.forEach((l, i) => {
      if (!l || typeof l.id !== 'string' || !ID_RE.test(l.id)) out.push(`layer #${i + 1}: id must be 1 to 12 lower-case letters or digits`);
      else if (ids.has(l.id)) out.push(`layer ${l.id}: duplicate id`);
      else ids.add(l.id);
    });
    const items = raw.filter((l) => l && typeof l === 'object');
    for (const l of items) {
      const w = `layer ${l.id}`;
      if (l.kind && !KINDS.includes(l.kind)) out.push(`${w}: unknown kind ${l.kind}`);
      if (l.from && !FROMS.includes(l.from)) out.push(`${w}: unknown from ${l.from}`);
      if (l.cut && !CUTS.includes(l.cut)) out.push(`${w}: unknown cut ${l.cut}`);
      for (const a of l.accepts || []) if (!ACCEPTS.includes(a)) out.push(`${w}: unknown accepts ${a}`);
      const th = l.thicknessMm;
      if (th != null && !(isNum(th) ? th > 0 : th && typeof th === 'object' && Object.values(th).every((v) => isNum(v) && v > 0))) out.push(`${w}: bad thicknessMm`);
    }
    const norm = layersOf(product);
    // Levels, from the normalised layers when the ids are usable.
    const levels = new Set((norm || items.map(normalise)).map((l) => l.level));
    if (levels.size > LIMITS.maxLevels) out.push(`at most ${LIMITS.maxLevels} levels, has ${levels.size}`);
    const flagged = items.filter((l) => l.default === true);
    if (flagged.length !== 1) out.push(`exactly one layer must be the default, ${flagged.length} are`);
    else if (!(flagged[0].accepts || []).includes('text')) out.push(`default layer ${flagged[0].id} must accept text`);
    const options = (product && product.options) || [];
    for (const l of items) {
      const kind = KINDS.includes(l.kind) ? l.kind : 'cut';
      if (kind === 'engrave') {
        const host = items.find((h) => h.id === l.on);
        if (!host || !['cut', 'backing'].includes(host.kind || 'cut')) out.push(`layer ${l.id}: "on" must point at a cut or backing layer`);
        continue;
      }
      const from = FROMS.includes(l.from) ? l.from : (l.option ? 'option' : l.material ? 'fixed' : 'color');
      if (from === 'option') {
        const opt = options.find((o) => o.id === l.option);
        if (!opt) out.push(`layer ${l.id}: option ${l.option} is not a product option`);
        else {
          if (opt.keepDefault !== true) out.push(`layer ${l.id}: option ${opt.id} needs keepDefault: true`);
          for (const c of opt.choices || []) if (!c.hex || !c.look) out.push(`option ${opt.id}, choice ${c.id}: needs hex and look`);
        }
      } else if (from === 'fixed' && !(l.material && l.material.hex)) out.push(`layer ${l.id}: from 'fixed' needs a material with hex`);
    }
    if (items.filter((l) => (FROMS.includes(l.from) ? l.from : (l.option ? 'option' : l.material ? 'fixed' : 'color')) === 'color' && l.kind !== 'engrave').length > 1) {
      out.push("at most one layer may follow the product colour (from: 'color')");
    }
    const panels = product && product.laser && product.laser.panels;
    if (panels != null) {
      if (!Array.isArray(panels) || panels.length < 1 || panels.length > LIMITS.maxPanels) out.push(`panels: 1 to ${LIMITS.maxPanels} entries`);
      else {
        const ok = panels.every((p) => p && [p.x, p.y, p.w, p.h].every(isNum) && p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0 && p.x + p.w <= 1 + 1e-9 && p.y + p.h <= 1 + 1e-9);
        if (!ok) out.push('panels: every panel must lie inside 0..1');
        else {
          for (let i = 0; i < panels.length; i++) {
            for (let j = i + 1; j < panels.length; j++) {
              const a = panels[i], b = panels[j];
              if (a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) out.push(`panels ${i + 1} and ${j + 1} overlap`);
            }
          }
        }
      }
    }
    const lp = product && product.laser && product.laser.layerPrice;
    if (lp) for (const s of (product.sizes || [])) if (!isNum(lp[s.id])) out.push(`layerPrice has no price for size ${s.id}`);
    const sorted = (norm || items.map(normalise)).filter((l) => l.kind !== 'engrave');
    if (sorted.length) {
      const low = Math.min(...sorted.map((l) => l.level));
      for (const l of sorted.filter((x) => x.level === low)) {
        if (!(l.kind === 'backing' || (l.kind === 'cut' && l.pieces === 'one'))) out.push(`layer ${l.id}: the lowest level must be a backing or a pieces: 'one' cut layer`);
      }
    }
    return out;
  }

  return { LIMITS, layersOf, defaultLayer, layerOf, accepts, materialOf, stack, toneFor, sortByLayer, usedLayerIds, extraPrice, panelsOf, validate };
});
