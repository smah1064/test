'use strict';

// The ready designs of the two-layer wood pieces (src/library-packs/cnc-twolayer.js, 28 Nov 2026): each product
// has its own, drawn for its print area's shape and offered only there; everything is in the product's one ink
// (the design is cut as a raised layer, or is the cut piece itself), in fonts and icons the shop has, with bold or
// heavy letters only; the sample dates fall on the weekday they name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { designs } = require('../src/library-packs/cnc-twolayer');
const { SEED, productsFor, OWN_DESIGNS_ONLY } = require('../src/library');
const { PRODUCTS } = require('../src/products');
const assets = require('../src/assets');

const IDS = ['calligraphypanel', 'doorhanger', 'keyholder', 'ramadanlight', 'couplestand', 'woodinvite'];
// One piece cut out with the shop's letter outline (laser.bridgeMm): heavy fonts only.
const CUT = ['ramadanlight', 'couplestand'];
const HEAVY = ['Lalezar', 'Lilita One', 'Pacifico'];
// The raised layer: the shop's fonts, bold where the font has a bold.
const FONTS = ['Aref Ruqaa', 'Amiri', 'El Messiri', 'Reem Kufi', 'Tajawal', 'Lalezar', 'Playfair Display', 'Montserrat', 'Pacifico', 'Lilita One'];
const NO_BOLD = ['Lalezar', 'Pacifico', 'Lilita One'];
const ARABIC = /[؀-ۿ]/;
const product = (id) => PRODUCTS.find((p) => p.id === id);
const texts = (d) => d.items.filter((i) => i.kind === 'text').map((i) => i.text);
const toLatin = (s) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));

test('the six two-layer products exist and take only their own designs', () => {
  assert.deepStrictEqual(IDS.filter((id) => !product(id)), [], 'products missing from src/products.js');
  for (const id of IDS) {
    assert.ok(OWN_DESIGNS_ONLY.has(id), `${id}: not in OWN_DESIGNS_ONLY`);
    const on = SEED.filter((d) => productsFor(d).includes(id));
    assert.deepStrictEqual(on.filter((d) => !designs.includes(d) || d.product !== id).map((d) => d.id), [], `${id}: designs from elsewhere`);
  }
});

test('every product has 3 to 7 designs, with Arabic and English, opening on it at its shape', () => {
  const problems = [];
  const ids = new Set();
  for (const d of designs) {
    if (!/^cnc2-[a-z0-9-]+$/.test(d.id) || ids.has(d.id)) problems.push(`${d.id}: id must be new and start with cnc2-`);
    ids.add(d.id);
    if (!IDS.includes(d.product)) problems.push(`${d.id}: on ${d.product}`);
    if (!ARABIC.test(d.name.ar) || /مجسم/.test(d.name.ar)) problems.push(`${d.id}: Arabic name ${d.name.ar}`);
  }
  for (const id of IDS) {
    const p = product(id);
    const mine = designs.filter((d) => d.product === id);
    if (mine.length < 3 || mine.length > 7) problems.push(`${id}: ${mine.length} designs`);
    const all = mine.flatMap(texts);
    if (!all.some((t) => ARABIC.test(t)) || !all.some((t) => /[A-Za-z]/.test(t))) problems.push(`${id}: needs Arabic and English`);
    for (const d of mine) {
      if (!SEED.includes(d)) problems.push(`${d.id}: not in the library`);
      if (!(Array.isArray(d.products) && d.products.length === 1 && d.products[0] === id)) problems.push(`${d.id}: products should be [${id}]`);
      if (productsFor(d).join() !== id) problems.push(`${d.id}: offered on ${productsFor(d).join()}`);
      if (!p) continue;
      if (!p.colors.some((c) => c.id === d.color)) problems.push(`${d.id}: no ${id} colour ${d.color}`);
      const a = p.sides[0].printArea;
      if (Math.abs(d.aspect - a.w / a.h) > 0.01) problems.push(`${d.id}: drawn for ${d.aspect.toFixed(3)}, print area ${(a.w / a.h).toFixed(3)}`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('one tone: no colours, only the shop\'s fonts and icons and our own solid ornaments; bold letters', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/img/art/svg/index.json'), 'utf8')).map((x) => x.id);
  const problems = [];
  for (const d of designs) {
    for (const i of d.items) {
      const at = `${d.id}: ${i.text || i.shape || i.art || i.src}`;
      for (const k of ['fill', 'bg', 'glow', 'extrude', 'shadow', 'outline', 'stroke']) if (i[k]) problems.push(`${at}: ${k}`);
      if (i.kind === 'sticker') problems.push(`${at}: a full-colour sticker`);
      if (i.kind === 'art' && !(assets.get(i.art) && /^(ph|mdi|tabler|lucide):/.test(i.art))) problems.push(`${at}: not a one-colour library icon`);
      if (i.kind === 'image') {
        const m = /^\/img\/art\/svg\/(twolayer-[a-z-]+)\.svg$/.exec(i.src || '');
        if (!m) problems.push(`${at}: only our two-layer ornaments`);
        else if (!fs.existsSync(path.join(__dirname, '../public', i.src)) || !index.includes(m[1])) problems.push(`${at}: missing or not in index.json`);
      }
      if (i.kind === 'text') {
        if (!FONTS.includes(i.font)) problems.push(`${at}: font ${i.font}`);
        if (!NO_BOLD.includes(i.font) && i.weight !== 'bold') problems.push(`${at}: not bold (no hairlines on a cut layer)`);
        if (CUT.includes(d.product) && !HEAVY.includes(i.font)) problems.push(`${at}: ${i.font} is too thin for a one-piece cut`);
        if (ARABIC.test(i.text) && /&/.test(i.text)) problems.push(`${at}: a Latin & inside Arabic reads badly`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('the shapes of the pieces: the door hanger inside its circle, the key holder clear of its hooks', () => {
  const problems = [];
  for (const d of designs.filter((x) => x.product === 'doorhanger')) {
    for (const i of d.items) if (Math.hypot(i.x - 0.5, i.y - 0.5) > 0.34) problems.push(`${d.id}: ${i.text || i.art || i.src} near the edge`);
  }
  for (const d of designs.filter((x) => x.product === 'keyholder')) {
    for (const i of d.items) if (i.y > 0.8) problems.push(`${d.id}: ${i.text || i.art} over the hooks`);
  }
  // The cut pieces are held together by a frame (our art, drawn across the area) or by shapes that touch.
  for (const d of designs.filter((x) => CUT.includes(x.product))) {
    if (!d.items.some((i) => i.kind === 'image' && /frame/.test(i.src) && i.w >= 0.8)) problems.push(`${d.id}: no frame holding the piece together`);
  }
  assert.deepStrictEqual(problems, []);
});

test('names are samples the customer replaces; years 2026 or 2027; each weekday matches its date', () => {
  const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const problems = [];
  let checked = 0;
  for (const d of designs) {
    const all = toLatin(texts(d).join(' | '));
    for (const y of all.match(/\b20\d\d\b/g) || []) if (y !== '2026' && y !== '2027') problems.push(`${d.id}: year ${y}`);
    if (d.items.some((i) => i.kind === 'text' && /أحمد|سارة|محمود|محمد|ليلى|يوسف|مريم|Ahmed|Sara|HASSANS|AHMEDS/.test(i.text)) && !d.items.some((i) => i.sampleName)) problems.push(`${d.id}: a sample name not marked`);
    const day = DAYS_AR.findIndex((w) => all.includes(w)) >= 0 ? DAYS_AR.findIndex((w) => all.includes(w)) : DAYS_EN.findIndex((w) => all.includes(w));
    const m = /(\d{1,2}) (\S+) (20\d\d)/.exec(all);
    if (day < 0 && !m) continue;
    const month = m ? Math.max(MONTHS_AR.indexOf(m[2]), MONTHS_EN.indexOf(m[2])) : -1;
    if (day < 0 || !m || month < 0) { problems.push(`${d.id}: a date without its weekday (or the other way): ${all}`); continue; }
    const real = new Date(Date.UTC(+m[3], month, +m[1])).getUTCDay();
    if (real !== day) problems.push(`${d.id}: ${m[0]} is a ${DAYS_EN[real]}, not a ${DAYS_EN[day]}`);
    checked++;
  }
  assert.ok(checked >= 3, `${checked} dated invitations checked`);
  assert.deepStrictEqual(problems, []);
});
