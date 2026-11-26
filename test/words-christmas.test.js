'use strict';

// The Christmas pack's words as live text (src/library-packs/christmas.js, `words` on the picture; see wordsArt in
// public/js/templates.js): every quote and card has its picture without the words next to the original, built into
// the same box, and its words as text lines placed on it, in fonts the editor has.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pack = require('../src/library-packs/christmas');

const pub = (src) => path.join(__dirname, '../public', src);
const tplSrc = fs.readFileSync(pub('/js/templates.js'), 'utf8');
const FONTS = new Set([...tplSrc.match(/arabic: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g), ...tplSrc.match(/english: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const css = fs.readFileSync(pub('/fonts/fonts.css'), 'utf8');
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
  family: (/font-family:\s*'([^']+)'/.exec(m[1]) || [])[1],
  weight: Number((/font-weight:\s*(\d+)/.exec(m[1]) || [])[1]),
  url: (/url\(([^)]+)\)/.exec(m[1]) || [])[1],
}));
const cards = pack.designs.filter((d) => d.id.startsWith('xm-card-'));
const trees = pack.designs.filter((d) => d.id.startsWith('xm-trees-'));
const quotes = pack.designs.filter((d) => !cards.includes(d) && !trees.includes(d));
const HEX = /^#[0-9a-f]{6}$/i;

test('every Christmas quote and card has its words as live text; the tree pictures have no words', () => {
  assert.strictEqual(quotes.length, 28);
  for (const d of [...quotes, ...cards]) {
    assert.strictEqual(d.items.length, 1, d.id);
    const { words } = d.items[0];
    assert.ok(words && Array.isArray(words.texts) && words.texts.length >= 1, `${d.id} has words`);
  }
  for (const d of trees) assert.strictEqual(d.items[0].words, undefined, d.id);
});

test('the words are placed inside the picture, at sensible sizes, in fonts the editor has (and serves)', () => {
  for (const d of [...quotes, ...cards]) {
    for (const t of d.items[0].words.texts) {
      const at = `${d.id} "${t.text}"`;
      assert.ok(typeof t.text === 'string' && t.text.trim() && t.text.length <= 120 && t.text === t.text.trim(), at);
      assert.ok(t.x > 0 && t.x < 1 && t.y > 0 && t.y < 1, `${at}: centre inside the picture`);
      assert.ok(t.size >= 0.02 && t.size <= 0.6, `${at}: size ${t.size}`);
      assert.ok(t.w > 0 && t.w <= 1, `${at}: width ${t.w}`);
      assert.ok(FONTS.has(t.font), `${at}: ${t.font} is in the editor's font list`);
      const weight = t.weight === 'bold' ? 700 : 400;
      const face = faces.find((f) => f.family === t.font && f.weight === weight);
      assert.ok(face && fs.existsSync(pub(face.url)), `${at}: ${t.font} ${weight} in fonts.css with its file`);
      if (t.weight !== undefined) assert.ok(['bold', 'normal'].includes(t.weight), at);
      if (t.fill !== undefined) assert.match(t.fill, HEX, at);
      for (const k of ['angle', 'curve', 'spacing', 'lineHeight']) if (t[k] !== undefined) assert.ok(Number.isFinite(t[k]), `${at}: ${k}`);
      if (t.curve !== undefined) assert.ok(Math.abs(t.curve) <= 100, at);
      if (t.lineHeight !== undefined) assert.ok(t.lineHeight > 0.3 && t.lineHeight < 3, at);
      if (t.lineHeight !== undefined) assert.match(t.text, /\n/, `${at}: a line height only for several lines`);
    }
  }
  // The quotes' words take the ink (black on light colours, white on dark), like the drawing; the cards keep their gold.
  for (const d of quotes) for (const t of d.items[0].words.texts) assert.strictEqual(t.fill, undefined, d.id);
  for (const d of cards) for (const t of d.items[0].words.texts) assert.match(t.fill, HEX, d.id);
});

test('the fonts added for these words have their licence and are listed for the editor', () => {
  for (const [family, file] of [['Great Vibes', 'great-vibes'], ['Cookie', 'cookie'], ['Irish Grover', 'irish-grover'], ['Julee', 'julee']]) {
    assert.ok(FONTS.has(family), family);
    assert.ok(fs.existsSync(pub(`/fonts/files/${file}-latin-400-normal.woff2`)), file);
    assert.match(fs.readFileSync(pub(`/fonts/licenses/${file}.txt`), 'utf8'), /SIL Open Font License|Apache License/, file);
  }
});

test('each quote without its words is the same drawing, minus the letters, in the same box (and its white copy too)', () => {
  for (const d of quotes) {
    const art = d.items[0];
    const { words } = art;
    for (const [orig, bare, fill] of [[art.src, words.src, '#16181d'], [art.dark, words.dark, '#ffffff']]) {
      assert.match(bare, /^\/img\/art\/christmas\/[a-z0-9-]+-nowords(-white)?\.svg$/, d.id);
      const a = fs.readFileSync(pub(orig), 'utf8');
      const b = fs.readFileSync(pub(bare), 'utf8');
      // The same <svg> header (viewBox, width, height): fabric builds both into the same box ...
      assert.strictEqual(b.match(/^<svg[^>]*>/)[0], a.match(/^<svg[^>]*>/)[0], bare);
      const pa = a.match(/<path[^>]*\/>/g);
      const pb = b.match(/<path[^>]*\/>/g) || [];
      // ... as long as at least two shapes are left (one alone is boxed by its own bounds).
      assert.ok(pb.length >= 2, `${bare}: ${pb.length} shapes`);
      assert.ok(pb.length < pa.length, `${bare}: the letters are gone`);
      for (const p of pb) assert.ok(pa.includes(p), `${bare}: kept shapes are the original's, unchanged`);
      assert.deepStrictEqual([...new Set([...b.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]))], [fill], bare);
      assert.doesNotMatch(b, /<(script|image|foreignObject|style)|on\w+=|href=/i, bare);
    }
  }
});

test('each card without its words: the same picture, the same size, changed only where the words were', async () => {
  // The words: the title band at the top and the wish at the bottom (card pixels, 1500 × 2100).
  const bands = [[130, 445], [1745, 1960]];
  for (const d of cards) {
    const art = d.items[0];
    assert.match(art.words.src, /^\/img\/art\/christmas\/card-[a-z-]+-nowords\.png$/);
    assert.strictEqual(art.words.dark, undefined);
    const [a, b] = await Promise.all([art.src, art.words.src].map((s) => sharp(pub(s)).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
    assert.deepStrictEqual([b.info.width, b.info.height], [a.info.width, a.info.height], d.id);
    let changed = 0;
    let outside = 0;
    for (let y = 0; y < a.info.height; y++) {
      const inBand = bands.some(([y0, y1]) => y >= y0 && y < y1);
      for (let x = 0; x < a.info.width; x++) {
        const i = (y * a.info.width + x) * a.info.channels;
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
          changed++;
          if (!inBand) outside++;
        }
      }
    }
    assert.strictEqual(outside, 0, `${d.id}: nothing changed outside the words`);
    assert.ok(changed > 50000, `${d.id}: the words were taken out (${changed} pixels)`);
  }
});
