'use strict';

// The words of the sarcastic and wellbeing ready designs are live text (`words` on their picture, see
// public/js/templates.js wordsArt): every design has its words-free picture (and white copy), the same
// size and shape as the original, its lines placed inside the picture in fonts the editor has, and the
// words are the quote as drawn.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const sarcastic = require('../src/library-packs/sarcastic');
const wellbeing = require('../src/library-packs/wellbeing');

const pub = (src) => path.join(__dirname, '../public', src);
const tplSrc = fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8');
const ENGLISH = [...tplSrc.match(/english: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const fontsCss = fs.readFileSync(path.join(__dirname, '../public/fonts/fonts.css'), 'utf8');
const FACES = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
  family: /font-family:\s*'([^']+)'/.exec(m[1])[1],
  weight: Number(/font-weight:\s*(\d+)/.exec(m[1])[1]),
  url: /url\(([^)]+)\)/.exec(m[1])[1],
}));
const HEX = /^#[0-9a-f]{6}$/i;
const designs = [...sarcastic.designs, ...wellbeing.designs];
const svgHead = (src) => fs.readFileSync(pub(src), 'utf8').match(/^<svg[^>]*>/)[0];

test('all 26 designs carry their words as live text on a words-free copy of the picture', () => {
  assert.strictEqual(designs.length, 26);
  for (const d of designs) {
    const [art] = d.items;
    assert.strictEqual(d.items.length, 1, d.id);
    const w = art.words;
    assert.ok(w && Array.isArray(w.texts) && w.texts.length, `${d.id} has words`);
    const stem = art.src.replace(/\.(svg|png)$/, '');
    assert.strictEqual(w.src, `${stem}-nowords${path.extname(art.src)}`, d.id);
    if (art.dark) assert.strictEqual(w.dark, art.dark.replace(/-white\.svg$/, '-nowords-white.svg'), d.id);
    else assert.strictEqual(w.dark, undefined, d.id);
    for (const src of [w.src, w.dark].filter(Boolean)) assert.ok(fs.existsSync(pub(src)), `${d.id}: ${src} exists`);
  }
});

test('the words-free vector art is the same box as the original, one colour, nothing but paths', () => {
  for (const d of sarcastic.designs.filter((x) => x.items[0].src.endsWith('.svg'))) {
    const [art] = d.items;
    for (const [orig, nowords, fill] of [[art.src, art.words.src, '#16181d'], [art.dark, art.words.dark, '#ffffff']]) {
      // Same viewBox, width and height: the builder puts the words-free drawing exactly where the original was.
      assert.strictEqual(svgHead(nowords), svgHead(orig), nowords);
      const svg = fs.readFileSync(pub(nowords), 'utf8');
      assert.doesNotMatch(svg, /<(script|image|foreignObject|style|text)|on\w+=|href=/i, nowords);
      // (An invisible rectangle keeps the box when a single path would be left.)
      const fills = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== 'none'));
      assert.deepStrictEqual([...fills], [fill], nowords);
      assert.ok((svg.match(/<(path|rect)\b/g) || []).length >= 2, `${nowords}: at least two elements, so fabric keeps the SVG's own box`);
      // Fewer shapes than the original (the letters went), but a good part is still there (the drawing).
      const shapes = (file) => [...fs.readFileSync(pub(file), 'utf8').matchAll(/\sd="([^"]*)"/g)].reduce((n, m) => n + (m[1].match(/[Mm]/g) || []).length, 0);
      const a = shapes(orig);
      const b = shapes(nowords);
      assert.ok(b < a && b > a * 0.15, `${nowords}: ${b} of ${a} shapes`);
    }
    // The white copy is the black one in white.
    assert.strictEqual(fs.readFileSync(pub(art.words.dark), 'utf8'), fs.readFileSync(pub(art.words.src), 'utf8').replace(/#16181d/g, '#ffffff'), d.id);
  }
});

test('the words-free pictures are the same size, resolution and transparency as the originals', async () => {
  const pngs = designs.filter((d) => d.items[0].src.endsWith('.png'));
  assert.strictEqual(pngs.length, 10);
  for (const d of pngs) {
    const [art] = d.items;
    const [a, b] = await Promise.all([sharp(pub(art.src)).metadata(), sharp(pub(art.words.src)).metadata()]);
    assert.deepStrictEqual([b.width, b.height, b.hasAlpha, b.density], [a.width, a.height, a.hasAlpha, a.density], art.words.src);
  }
});

test('every line is placed inside its picture, in a font the editor offers (and fonts.css serves)', () => {
  for (const d of designs) {
    for (const t of d.items[0].words.texts) {
      const at = `${d.id} "${t.text}"`;
      assert.ok(typeof t.text === 'string' && t.text.trim() && t.text.length <= 120, at);
      assert.ok(ENGLISH.includes(t.font), `${at}: font ${t.font} is in the editor's list`);
      const weight = t.weight === 'bold' ? 700 : 400;
      assert.ok(t.weight === undefined || t.weight === 'bold', at);
      const face = FACES.find((f) => f.family === t.font && f.weight === weight);
      assert.ok(face, `${at}: fonts.css has ${t.font} ${weight}`);
      assert.ok(fs.existsSync(pub(face.url)), `${at}: ${face.url}`);
      for (const k of ['x', 'y']) assert.ok(t[k] > 0 && t[k] < 1, `${at}: ${k} ${t[k]}`);
      assert.ok(t.size > 0.02 && t.size < 1, `${at}: size ${t.size}`);
      if (t.w !== undefined) assert.ok(t.w > 0.05 && t.w <= 1, `${at}: w ${t.w}`);
      if (t.curve !== undefined) assert.ok(Number.isInteger(t.curve) && t.curve >= -100 && t.curve <= 100 && t.curve !== 0, `${at}: curve`);
      if (t.angle !== undefined) assert.ok(Math.abs(t.angle) <= 45, `${at}: angle`);
      if (t.spacing !== undefined) assert.ok(Math.abs(t.spacing) <= 300, `${at}: spacing`);
      if (t.lineHeight !== undefined) assert.ok(t.lineHeight >= 0.6 && t.lineHeight <= 1.6, `${at}: lineHeight`);
      if (t.fill !== undefined) assert.match(t.fill, HEX, at);
    }
  }
  // The one-colour line art takes the ink (black, white on dark colours); the colour pictures their own colours.
  for (const d of designs) {
    const lineArt = d.items[0].src.endsWith('.svg');
    for (const t of d.items[0].words.texts) assert.strictEqual(t.fill === undefined, lineArt, `${d.id} "${t.text}"`);
  }
});

test('the live words are the quote as drawn', () => {
  const words = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  for (const d of designs) {
    const said = new Set(words(d.name.en));
    // (The drawing says "but sometimes my mouth"; the name leaves "sometimes" out.)
    if (d.id === 'sq-nice-person-mouth') said.add('sometimes');
    const live = d.items[0].words.texts.flatMap((t) => words(t.text));
    for (const w of live) assert.ok(said.has(w), `${d.id}: "${w}" is in "${d.name.en}"`);
    assert.ok(live.length >= Math.min(4, said.size - 2), d.id);
  }
  // Spot checks: the case and punctuation as drawn.
  const texts = (id) => designs.find((d) => d.id === id).items[0].words.texts.map((t) => t.text);
  assert.deepStrictEqual(texts('sq-first-of-all-no'), ['First', 'of all', 'NO', 'Second', 'of all', 'Still No']);
  assert.deepStrictEqual(texts('sq-error-404-sloth-nope-sign'), ['ERROR 404:', 'MOTIVATION', 'not\nfound']);
  assert.ok(texts('wb-phone-restart-hills')[0].startsWith('Even your\nphone needs\n'));
});

test('the fonts added for these words are served and licensed', () => {
  const added = ['Lilita One', 'Chewy', 'Caprasimo', 'Kalam', 'Yesteryear', 'League Gothic', 'Smokum', 'Ultra', 'Six Caps'];
  const tail = fontsCss.slice(fontsCss.indexOf('/* Words in ready designs: sarcastic + wellbeing */'));
  for (const fam of added) {
    assert.ok(ENGLISH.includes(fam), fam);
    assert.match(tail, new RegExp(`font-family: '${fam}'`), fam);
    const file = fam.toLowerCase().replace(/ /g, '-');
    const lic = fs.readFileSync(path.join(__dirname, '../public/fonts/licenses', `${file}.txt`), 'utf8');
    assert.match(lic, /SIL Open Font License|Apache License/, fam);
  }
  // Each one is used by at least one line.
  const used = new Set(designs.flatMap((d) => d.items[0].words.texts.map((t) => t.font)));
  for (const fam of added) assert.ok(used.has(fam), `${fam} is used`);
});
