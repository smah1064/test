'use strict';

// Every ready design / template (src/library.js and src/library-packs/) is well formed:
// known category, fonts, shapes, stickers and icons; positions inside the print area.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SEED, CATEGORIES } = require('../src/library');
const assets = require('../src/assets');

const tplSrc = fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8');
const FONTS = new Set([...tplSrc.match(/arabic: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g), ...tplSrc.match(/english: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const SHAPES = new Set([...tplSrc.slice(tplSrc.indexOf('const SHAPES = {'), tplSrc.indexOf('// ---------- Text presets')).matchAll(/^ {4}([a-z]+): \{ name/gm)].map((m) => m[1]));
const STICKERS = new Set([...fs.readFileSync(path.join(__dirname, '../public/js/stickers.js'), 'utf8').matchAll(/S\('([a-z0-9-]+)'/g)].map((m) => m[1]));
const { PRODUCTS } = require('../src/products');
const HEX = /^#[0-9a-f]{6}$/i;
const ARABIC = /[؀-ۿ]/;

test('the template building blocks were found', () => {
  assert.ok(FONTS.size > 20 && SHAPES.size > 10 && STICKERS.size > 40, `${FONTS.size} ${SHAPES.size} ${STICKERS.size}`);
});

test('every ready design is well formed', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  const problems = [];
  const ids = new Set();
  for (const d of SEED) {
    const bad = (msg) => problems.push(`${d.id}: ${msg}`);
    if (!/^[a-z0-9-]{2,60}$/.test(d.id)) bad('id must be lowercase letters, digits and dashes');
    if (ids.has(d.id)) bad('duplicate id');
    ids.add(d.id);
    if (!cats.has(d.category)) bad(`unknown category ${d.category}`);
    if (!d.name || !d.name.en || !d.name.ar) bad('needs an English and an Arabic name');
    const hasArabicText = (d.items || []).some((i) => i.kind === 'text' && ARABIC.test(i.text));
    if (hasArabicText && !ARABIC.test(d.name.ar)) bad('Arabic designs need an Arabic name');
    const product = PRODUCTS.find((p) => p.id === d.product);
    if (!product) bad(`unknown product ${d.product}`);
    else if (!product.colors.some((c) => c.id === d.color)) bad(`unknown ${d.product} colour ${d.color}`);
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > 12) bad('needs 1 to 12 items');
    for (const [k, i] of (d.items || []).entries()) {
      const at = `item ${k}`;
      if (!(i.x >= 0.03 && i.x <= 0.97 && i.y >= 0.03 && i.y <= 0.97)) bad(`${at}: x/y must be inside the area (0.03..0.97)`);
      for (const c of ['fill', 'glow', 'extrude', 'bg']) if (i[c] != null && !HEX.test(i[c])) bad(`${at}: ${c} must be a #rrggbb colour`);
      if (i.kind === 'text') {
        if (!FONTS.has(i.font)) bad(`${at}: unknown font ${i.font}`);
        if (!String(i.text || '').trim() || String(i.text).length > 60) bad(`${at}: text must be 1-60 characters`);
        if (!(i.size >= 0.03 && i.size <= 0.8)) bad(`${at}: text size ${i.size} out of range (0.03..0.8)`);
      } else if (i.kind === 'shape') {
        if (!SHAPES.has(i.shape)) bad(`${at}: unknown shape ${i.shape}`);
        if (!(i.w > 0.02 && i.w <= 1)) bad(`${at}: w out of range`);
      } else if (i.kind === 'sticker') {
        if (!STICKERS.has(i.sticker)) bad(`${at}: unknown sticker ${i.sticker}`);
        if (!(i.w > 0.02 && i.w <= 1)) bad(`${at}: w out of range`);
      } else if (i.kind === 'art') {
        if (!assets.get(i.art)) bad(`${at}: unknown library icon ${i.art}`);
        if (!(i.w > 0.02 && i.w <= 1)) bad(`${at}: w out of range`);
      } else if (i.kind === 'image') {
        // Artwork files of the shop's own (public/img/art): the file must be there.
        if (!/^\/img\/art\/(ai|svg)\/[\w-]+\.(png|svg)$/.test(i.src || '')) bad(`${at}: image src must be /img/art/ai/*.png or /img/art/svg/*.svg`);
        else if (!require('fs').existsSync(require('path').join(__dirname, '..', 'public', i.src))) bad(`${at}: missing artwork ${i.src}`);
        if (!(i.w > 0.02 && i.w <= 1)) bad(`${at}: w out of range`);
      } else {
        bad(`${at}: unknown kind ${i.kind}`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('every template pack loads and no design id is used twice', () => {
  const dir = path.join(__dirname, '../src/library-packs');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')) : [];
  let total = 0;
  for (const f of files) {
    const pack = require(path.join(dir, f)); // throws (and fails) when a pack is broken
    assert.ok(Array.isArray(pack.designs), `${f} exports designs`);
    total += pack.designs.length;
  }
  // The library keeps every pack design (a duplicate id would have been skipped).
  const fromPacks = SEED.length - require('../src/library').SEED.filter((d) => !files.some((f) => require(path.join(dir, f)).designs.includes(d))).length;
  assert.strictEqual(fromPacks, total, 'a pack design was skipped (duplicate id?)');
});
