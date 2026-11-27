'use strict';

// Ready designs with a sample name ("LAILA", "آدم", "The MAHMOUDS"): the texts are marked (sampleName, and
// samplePart when only part of the text is the name), the marks reach the shop through /api/library, and the
// design page puts the customer's own name in their place (POD_DESIGN.withNames, public/js/templates.js) for the
// picture, the cart and the print files alike. Designs with {fields} are another case and are not marked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { SEED } = require('../src/library');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
/** The browser's template code (public/js/templates.js): sampleNames, cleanName, withNames. */
function browserTemplates() {
  const window = {};
  vm.runInNewContext(read('js/templates.js'), { window, document: { fonts: {} }, fabric: {} });
  return window.POD_DESIGN;
}
const D = browserTemplates();
const byId = (id) => SEED.find((d) => d.id === id);

// Every design that shows a sample name, with its sample texts: [text, kind of name, the name part of the text].
const FLAGGED = {
  'ce-bday-ya-sara': [['يا سارة', 'name', 'سارة']],
  'ce-happy-bday-arch': [['Ahmed', 'name']],
  'ce-saheb-el-eid': [['Ahmed', 'name']],
  'ce-team-bday': [['سارة', 'name']],
  'ce-save-the-date': [['أحمد و سارة', 'names']],
  'ce-leilet-el-7enna': [['سارة', 'name']],
  'ce-grad-doctora': [['سارة', 'name']],
  'ce-grad-bashmohandes': [['أحمد', 'name']],
  'ce-grad-mo7ami': [['أحمد', 'name']],
  'ce-welcome-baby': [['آدم', 'baby']],
  'ce-sebou3': [['سارة', 'baby']],
  'ev-fam-dad': [['عيلة المصري', 'family', 'المصري']],
  'ev-fam-mum': [['عيلة المصري', 'family', 'المصري']],
  'ev-fam-son': [['عيلة المصري', 'family', 'المصري']],
  'ev-fam-daughter': [['عيلة المصري', 'family', 'المصري']],
  'ev-a9ghar-wa7ed': [['سليم 2026', 'baby', 'سليم']],
  'hb-kit-name-number': [['أحمد', 'name']],
  'hb-kit-en': [['AHMED', 'name']],
  'hb-player-one': [['AHMED', 'name']],
  'lz-plaque-wedding-ar': [['أحمد', 'his'], ['سارة', 'her']],
  'lz-plaque-mr-mrs-en': [['AHMED', 'his'], ['SARA', 'her']],
  'lz-plaque-graduation-ar': [['م. ليلى أحمد', 'name']],
  'lz-plaque-graduation-en': [['Laila Ahmed', 'name']],
  'lz-plaque-takreem-ar': [['أ. محمود حسن', 'honoree']],
  'lz-plaque-thank-you-en': [['Mrs. Laila', 'teacher']],
  'lz-coaster-couple-ar': [['أحمد', 'his'], ['سارة', 'her']],
  'lz-coaster-couple-en': [['Ahmed', 'his'], ['Sara', 'her']],
  'lz-coaster-monogram-en': [['M', 'initial'], ['THE MAHMOUDS', 'family', 'MAHMOUDS']],
  'lz-coaster-monogram-ar': [['م', 'initial'], ['عائلة محمود', 'family', 'محمود']],
  'lz-coaster-beit-el-3ela': [['عائلة محمود', 'family', 'محمود']],
  'lz-tray-names-ar': [['أحمد & سارة', 'names']],
  'lz-tray-names-en': [['Ahmed', 'his'], ['Sara', 'her']],
  'lz-tray-mawadda-ar': [['أحمد', 'his'], ['سارة', 'her']],
  'lz-tray-monogram': [['A & S', 'initials'], ['Ahmed & Sara', 'names']],
  'lz-tray-shabka-ar': [['أحمد & سارة', 'names']],
  'lz-frame-names-ar': [['أحمد & سارة', 'names']],
  'lz-frame-names-en': [['Ahmed & Sara', 'names']],
  'lz-card-monogram-en': [['AH', 'initials']],
  'lz-card-monogram-ar': [['أ.ح', 'initials']],
  'lz-card-name-title-en': [['Ahmed Hassan', 'name']],
  'lz-card-name-title-ar': [['م. أحمد حسن', 'name']],
  'lz-card-initial-name': [['A', 'initial'], ['AHMED HASSAN', 'name']],
  'lz-pen-name-en': [['Ahmed Hassan', 'name']],
  'lz-pen-name-ar': [['أحمد حسن', 'name']],
  'lz-pen-monogram': [['A · H', 'initials']],
  'lz-wallet-monogram': [['AH', 'initials']],
  'lz-wallet-name-ar': [['أحمد حسن', 'name']],
  'lz-wallet-love-en': [['Ahmed', 'his']],
  'lz-sign-welcome-en': [['Ahmed', 'his'], ['Sara', 'her']],
  'lz-sign-welcome-ar': [['أحمد', 'his'], ['سارة', 'her']],
  'lz-sign-katb-ketab-ar': [['أحمد & سارة', 'names']],
  'lz-sign-engagement-en': [['AHMED', 'his'], ['SARA', 'her']],
  'lz-sign-bilingual': [['أحمد & سارة', 'names'], ['Ahmed & Sara', 'names']],
  'lz-door-family-ar': [['عائلة محمود', 'family', 'محمود']],
  'lz-door-family-en': [['MAHMOUDS', 'family']],
  'lz-door-room-en': [["Laila's", 'kid', 'Laila']],
  'lz-door-room-ar': [['ليلى', 'kid']],
  'lz-topper-happy-bday-en': [['Ahmed', 'name']],
  'lz-topper-eid-milad-ar': [['ليلى', 'name']],
  'lz-ramadan-family-crescent': [['محمود', 'family']],
  'lz-ramadan-lantern-name': [['عائلة محمود', 'family', 'محمود']],
  'lz-puzzle-laila-en': [['LAILA', 'kid']],
  'lz-puzzle-omar-en': [['OMAR', 'kid']],
  'lz-puzzle-adam-star': [['ADAM', 'kid']],
  'lz-puzzle-laila-ar': [['ليلى', 'kid']],
  'lz-puzzle-omar-ar': [['عمر', 'kid']],
  'pp-kids-princess-name': [['سارة', 'kid']],
  'pp-kids-little-prince': [['Adam', 'kid']],
  'pp-sch-best-teacher-f': [['ميس منى', 'teacher', 'منى']],
  'pp-pet-cat-name': [['مشمش', 'cat']],
  'pp-pet-good-boy': [['MAX', 'dog']],
  'pp-biz-name-role': [['أحمد', 'name']],
  'st-pets-name': [['Max', 'dog']],
  'st-gaming-tag': [['AHMED', 'name']],
  'st-gaming-esports': [['AHMED', 'name']],
  'st-gaming-lvl-99': [['AHMED', 'name']],
  'st-gaming-ostoura': [['أحمد', 'name']],
  'st-luxury-monogram': [['S', 'initial'], ['SARA', 'name']],
  'st-luxury-mono-ar': [['م', 'initial'], ['محمد', 'name']],
  'wd-love-monogram': [['A', 'hisInitial'], ['S', 'herInitial']],
  // The licensed birthday collection (draft): the child's name and age.
  'lic-sm-invitation': [['عيد ميلاد يوسف', 'kid', 'يوسف'], ['الـ ٦ سنين', 'age', '٦']],
  'lic-sm-welcome-sign': [['يوسف', 'kid'], ['الـ ٦ سنين', 'age', '٦']],
  'lic-sm-stickers': [['عيد ميلاد يوسف', 'kid', 'يوسف'], ['الـ ٦ سنين', 'age', '٦']],
  'lic-sm-thankyou': [['عيد ميلاد يوسف', 'kid', 'يوسف'], ['الـ ٦ سنين', 'age', '٦']],
  'lic-sm-favor-bag': [['يوسف', 'kid'], ['الـ ٦ سنين', 'age', '٦']],
};

test('every flagged design really has its sample text, marked, and nothing else is marked', () => {
  const problems = [];
  for (const [id, list] of Object.entries(FLAGGED)) {
    const d = byId(id);
    if (!d) { problems.push(`${id}: not in the shop's designs`); continue; }
    for (const [text, role, part] of list) {
      const items = d.items.filter((i) => i.kind === 'text' && i.text === text);
      if (items.length !== 1) { problems.push(`${id}: "${text}" found ${items.length} times`); continue; }
      const [it] = items;
      if (it.sampleName !== role) problems.push(`${id}: "${text}" sampleName ${it.sampleName}, expected ${role}`);
      if ((it.samplePart || null) !== (part || null)) problems.push(`${id}: "${text}" samplePart ${it.samplePart}, expected ${part}`);
    }
  }
  // Nothing marked that isn't in the list (a new design with a sample name is added to it).
  for (const d of SEED) {
    for (const it of d.items || []) {
      if (!it.sampleName) continue;
      if (!(FLAGGED[d.id] || []).some(([text]) => text === it.text)) problems.push(`${d.id}: "${it.text}" is marked but not listed here`);
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(Object.keys(FLAGGED).length, 85); // (+ 6 pen and wallet designs with a name, 25 Nov; + 5 licensed birthday designs, 27 Nov)
});

test('the marks are well formed: a known kind, the name part inside the text once, never on {field} designs', () => {
  const problems = [];
  for (const d of SEED) {
    const marked = (d.items || []).filter((i) => i.sampleName);
    if (!marked.length) continue;
    if (d.kind !== 'template') problems.push(`${d.id}: only the shop's own (template) designs are marked`);
    if ((d.items || []).some((i) => i.kind === 'text' && /\{[^{}]+\}/.test(i.text || ''))) problems.push(`${d.id}: has {fields}: filled in in the editor, not marked`);
    for (const it of marked) {
      if (it.kind !== 'text' || typeof it.text !== 'string' || !it.text.trim()) problems.push(`${d.id}: a mark on something that is not a text`);
      if (!D.NAME_ROLES.includes(it.sampleName)) problems.push(`${d.id}: unknown kind of name ${it.sampleName}`);
      if (it.samplePart !== undefined && (typeof it.samplePart !== 'string' || !it.samplePart.trim() || it.text.split(it.samplePart).length !== 2)) problems.push(`${d.id}: samplePart "${it.samplePart}" must be in "${it.text}" exactly once`);
      // (An age is a number, not letters.)
      if (it.sampleName !== 'age' && !/[\p{L}]/u.test(it.samplePart || it.text)) problems.push(`${d.id}: "${it.text}" has no letters`);
    }
    // The page finds them all, in the design's order.
    const found = D.sampleNames(d);
    if (found.length !== marked.length) problems.push(`${d.id}: sampleNames found ${found.length} of ${marked.length}`);
  }
  assert.deepStrictEqual(problems, []);
});

test('the marks reach the shop: /api/library and /api/library/:id keep them', async () => {
  const { createApp } = require('../src/app');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-ownname-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0 });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const one = await (await fetch(`${base}/api/library/lz-puzzle-laila-en`)).json();
    assert.deepStrictEqual(one.items.filter((i) => i.sampleName).map((i) => [i.text, i.sampleName]), [['LAILA', 'kid']]);
    const fam = await (await fetch(`${base}/api/library/ev-fam-dad`)).json();
    assert.deepStrictEqual(fam.items.filter((i) => i.sampleName).map((i) => [i.text, i.sampleName, i.samplePart]), [['عيلة المصري', 'family', 'المصري']]);
    const all = (await (await fetch(`${base}/api/library`)).json()).designs;
    const shown = all.filter((d) => FLAGGED[d.id]);
    assert.ok(shown.length > 20, `${shown.length} marked designs in the shop's list`);
    for (const d of shown) assert.strictEqual(d.items.filter((i) => i.sampleName).length, FLAGGED[d.id].length, d.id);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('withNames: the typed name replaces the sample (all of it, or its name part), empty keeps it', () => {
  const textOf = (d, k) => d.items.filter((i) => i.sampleName)[k].text;
  const laila = byId('lz-puzzle-laila-en');
  assert.strictEqual(D.withNames(laila, ['']), laila, 'nothing typed: the design as it is');
  assert.strictEqual(D.withNames(laila, ['   ']), laila);
  // A sample in capitals takes the name in capitals; the font fits the new text in the sample's place.
  const omar = D.withNames(laila, ['omar']);
  assert.strictEqual(textOf(omar, 0), 'OMAR');
  assert.deepStrictEqual({ ...omar.items[0].fitTo }, { text: 'LAILA', font: 'Bungee', weight: 'normal' }); // (made in the page's realm)
  assert.strictEqual(omar.items[0].direction, 'ltr');
  assert.strictEqual(textOf(laila, 0), 'LAILA', 'the shop\'s design is not changed');
  // Only the name part: "عيلة المصري" -> "عيلة الشريف", "Laila's" -> "Nour's", "سليم 2026" -> "يوسف 2026".
  assert.strictEqual(textOf(D.withNames(byId('ev-fam-dad'), ['الشريف']), 0), 'عيلة الشريف');
  assert.strictEqual(textOf(D.withNames(byId('lz-door-room-en'), ['Nour']), 0), "Nour's");
  assert.strictEqual(textOf(D.withNames(byId('ev-a9ghar-wa7ed'), ['يوسف']), 0), 'يوسف 2026');
  assert.strictEqual(textOf(D.withNames(byId('lz-coaster-monogram-en'), ['h', 'Hassans']), 1), 'THE HASSANS');
  // Several: in order, an empty one keeps its sample.
  const plaque = D.withNames(byId('lz-plaque-mr-mrs-en'), ['Youssef', '']);
  assert.deepStrictEqual([textOf(plaque, 0), textOf(plaque, 1)], ['YOUSSEF', 'SARA']);
  // "$&" and the like are the customer's letters, not replacement patterns.
  assert.strictEqual(textOf(D.withNames(byId('ev-fam-dad'), ['$& $1']), 0), 'عيلة $& $1');
});

test('withNames: Arabic in an English-only font gets an Arabic font; direction from the first letter; digits kept', () => {
  const tag = D.withNames(byId('st-gaming-tag'), ['أحمد ١٠']).items.find((i) => i.sampleName);
  assert.deepStrictEqual([tag.text, tag.font, tag.weight, tag.direction], ['أحمد ١٠', 'Lalezar', 'normal', 'rtl']);
  assert.strictEqual(tag.fitTo.font, 'Bungee', 'fitted to the sample as it was drawn');
  const script = D.withNames(byId('lz-coaster-couple-en'), ['محمد', 'Mona']).items.filter((i) => i.sampleName);
  assert.deepStrictEqual(script.map((i) => [i.text, i.font, i.direction]), [['محمد', 'Aref Ruqaa', 'rtl'], ['Mona', 'Dancing Script', 'ltr']]);
  // Mixed: left to right when it starts with an English letter; Arabic fonts keep their own font for English names.
  const mixed = D.withNames(byId('hb-kit-en'), ['Omar عمر']).items.find((i) => i.sampleName);
  assert.deepStrictEqual([mixed.text, mixed.font, mixed.direction], ['OMAR عمر', 'Lalezar', 'ltr']);
  const ar = D.withNames(byId('ce-welcome-baby'), ['Adam']).items.find((i) => i.sampleName);
  assert.deepStrictEqual([ar.text, ar.font, ar.direction], ['Adam', 'Aref Ruqaa', 'ltr']);
  for (const id of D.FONTS.english) assert.ok(D.FONTS.arabic.includes(D.withNames({ kind: 'template', items: [{ kind: 'text', text: 'X', font: id, sampleName: 'name' }] }, ['ع']).items[0].font), `${id}: an Arabic font for Arabic names`);
});

test('cleanName: one printable line of a sensible length', () => {
  assert.strictEqual(D.cleanName('  Omar \n Khaled  '), 'Omar Khaled');
  assert.strictEqual(D.cleanName('{Name}'), 'Name', 'no {field} (the server refuses to print one)');
  assert.strictEqual(D.cleanName('Laila 🌸✨'), 'Laila', 'no emoji (the fonts have none)');
  assert.strictEqual(D.cleanName('‮ليلى‬'), 'ليلى', 'no direction overrides');
  assert.strictEqual(D.cleanName('عبد الرحمن ٢٠٢٧'), 'عبد الرحمن ٢٠٢٧', 'Arabic digits kept');
  assert.strictEqual(D.cleanName('x'.repeat(80)).length, 45, 'one long word: cut at the limit (45 letters for a name)');
  assert.strictEqual(D.cleanName('ABCDEFG', 3), 'ABC');
  const [initial] = D.sampleNames(byId('lz-card-initial-name'));
  assert.deepStrictEqual([initial.role, initial.sample, initial.caps, initial.max], ['initial', 'A', true, 3]);
  const [names] = D.sampleNames(byId('lz-tray-names-ar'));
  assert.deepStrictEqual([names.role, names.caps, names.max], ['names', false, 60]);
  // Long names (QA, 25 Nov): a four-part Egyptian name fits whole; too long, whole words only, never a word cut short.
  const four = 'عبد الرحمن محمد عبد الفتاح الشربيني';
  assert.strictEqual(D.cleanName(four), four);
  // 46 letters: the last word is left out whole ("الشربي" would be another name).
  assert.strictEqual(D.cleanName('محمد أحمد عبد الرحمن مصطفى عبد العزيز الشربيني'), 'محمد أحمد عبد الرحمن مصطفى عبد العزيز');
  const cut = D.cleanName(`${four} ${four}`);
  assert.ok(Array.from(cut).length <= 45 && `${four} ${four}`.startsWith(cut) && `${four} ${four}`[cut.length] === ' ', `whole words: ${cut}`);
  assert.strictEqual(D.cleanName('Abdel Rahman Mohamed Abdel Fattah El Sherbiny Mostafa'), 'Abdel Rahman Mohamed Abdel Fattah El Sherbiny');
  assert.strictEqual(D.cleanName('Omar Khaled', 8), 'Omar', 'the last word dropped, not cut');
  assert.strictEqual(D.cleanName('Omar Khaled', 11), 'Omar Khaled');
  assert.strictEqual(D.cleanName('Omar Khaled', 4), 'Omar', 'cut at a space: the words before it');
});

test('the words: every kind of name has a label, in English and Egyptian Arabic, kept together after design.fillNote', () => {
  const window = {};
  vm.runInNewContext(read('js/i18n.js'), { window });
  const S = window.POD_STRINGS;
  const keys = [...D.NAME_ROLES.map((r) => `design.name.${r}`), 'design.name.inArabic', 'design.name.inEnglish', 'design.name.nth', 'design.name.long', 'design.name.hint', 'design.nameAsk.title', 'design.nameAsk.text', 'design.nameAsk.write', 'design.nameAsk.keep'];
  for (const k of keys) {
    assert.ok(Array.isArray(S[k]) && S[k][0] && S[k][1], `${k} in English and Arabic`);
    assert.doesNotMatch(S[k][1], /محل/, `${k}: the site is never called محل`);
  }
  assert.strictEqual(S['design.nameAsk.title'][0], 'Put your own name?');
  assert.strictEqual(S['design.nameAsk.title'][1], 'تحب تكتب اسمك؟');
  assert.match(S['design.nameAsk.text'][0], /^This design says \{name\}\./);
  assert.strictEqual(S['design.nameAsk.write'][0], 'Write my name');
  assert.strictEqual(S['design.nameAsk.keep'][0], 'Order it with {name}');
  const order = Object.keys(S);
  const at = order.indexOf('design.fillNote');
  assert.deepStrictEqual(order.slice(at + 1, at + 1 + keys.length).sort(), keys.slice().sort());
});

test('/design: the picture, the cart and the editor link all use the names typed; size first, then the name', () => {
  const src = read('js/design.js');
  assert.match(src, /POD_RENDER\.stage\(personal\(\), product, side, color, size\.id\)/, 'the picture');
  assert.match(src, /POD_RENDER\.addToCart\(\{\s*design: personal\(\),/, 'the cart and the print files');
  assert.match(src, /\$\('dp-edit'\)\.href = editHref\(\);/);
  assert.match(src, /\$\{sizeParam\(\)\}\$\{nameParams\(\)\}`/, 'the editor link');
  // "Which size?" goes on to the name question, never straight to the cart.
  const sizeAsk = src.slice(src.indexOf("$('size-ask').addEventListener('click'"), src.indexOf('// ---------- A sample name left as it is'));
  assert.match(sizeAsk, /addOrAsk\(\);/);
  assert.doesNotMatch(sizeAsk, /addToCart\(\);/);
  const html = read('design.html');
  assert.ok(html.indexOf('id="dp-names"') > 0 && html.indexOf('id="dp-names"') < html.indexOf('id="dp-add"'), 'the box is above Add to cart');
  assert.match(html, /id="name-ask"[\s\S]*role="dialog" aria-modal="true" aria-labelledby="name-ask-title"/);
});
