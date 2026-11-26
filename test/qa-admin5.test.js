'use strict';

// Admin QA (25 Nov, wave 5): rights requests in the admin, number boxes that take Arabic digits without
// losing a saved cost, embroidery with a printed side named as both, counted thread colours and the
// address comma of the page's language.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const dispatch = require('../src/dispatch');
const { createApp } = require('../src/app');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
/** Every string of the pages (i18n.js and the i18n-*.js files), as the pages load them. */
function strings() {
  const window = {};
  window.window = window;
  const ctx = { window, document: { addEventListener() {} }, localStorage: { getItem: () => null } };
  const files = fs.readdirSync(path.join(__dirname, '../public/js')).filter((f) => /^i18n-.*\.js$/.test(f));
  for (const f of ['i18n.js', ...files]) vm.runInNewContext(read(`js/${f}`), ctx);
  return window.POD_STRINGS;
}
const S = strings();
const ADMIN = read('js/admin.js');
const RIGHTS = read('js/admin-rights.js');
/** A const or function taken from a page's source, run on its own. */
function grab(src, re, name, ctx = {}) {
  const m = src.match(re);
  assert.ok(m, name);
  return vm.runInNewContext(`${m[0]}\n${name}`, ctx);
}
/** t() as the pages run it (no Arabic-digit conversion: the words are what is checked). */
const tFor = (lang) => (k, p) => {
  const pair = S[k];
  assert.ok(pair, k);
  return pair[lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (_, x) => (p && p[x] != null ? p[x] : ''));
};
const pluralForm = grab(read('js/common.js'), /const pluralForm = \(n\) => [^\n]+;/, 'pluralForm');
const pluralFor = (lang) => (base, n) => tFor(lang)(`${base}.${pluralForm(n)}`, { n: String(n) });

// ---------- Embroidery with a printed side ----------
const n2 = (en, ar) => ({ en, ar });
const ARGS = { house: { name: 'X' }, design: { sides: [] }, files: [], expires: '2026-12-24T00:00:00Z', order: { number: 'POD-1', items: [{}] } };
const BASE = { position: 1, productName: n2('T-shirt', 'تيشيرت'), color: { name: n2('White', 'أبيض') }, size: { label: n2('M', 'M') } };
// As an order item keeps an embroidery design (src/app.js designItemFields): process 'embroidery', and each side its own.
const EMB_PRINT = { ...BASE, process: 'embroidery', method: 'embroidery', sides: [{ id: 'front', process: 'dtg' }, { id: 'emb', on: 'front', process: 'embroidery' }, { id: 'back', process: 'dtg' }] };

test('a printed front with embroidery is "Embroidery + DTG" for the printing house, in both languages', () => {
  assert.deepStrictEqual(dispatch.processesOf(EMB_PRINT), ['embroidery', 'dtg']);
  assert.strictEqual(dispatch.methodName(EMB_PRINT, 'en'), 'Embroidery + DTG (direct to garment)');
  assert.strictEqual(dispatch.methodName(EMB_PRINT, 'ar'), 'تطريز + DTG (طباعة مباشرة على القماش)');
  const wa = { en: dispatch.whatsappText({ ...ARGS, item: EMB_PRINT, lang: 'en' }), ar: dispatch.whatsappText({ ...ARGS, item: EMB_PRINT, lang: 'ar' }) };
  assert.match(wa.en, /\*Print method:\* Embroidery \+ DTG \(direct to garment\)\n/);
  assert.match(wa.ar, /\*طريقة الطباعة:\* تطريز \+ DTG \(طباعة مباشرة على القماش\)\n/);
  for (const lang of ['en', 'ar']) {
    const mail = dispatch.emailBody({ ...ARGS, item: EMB_PRINT, lang, attached: false });
    assert.match(mail.text, lang === 'en' ? /Print method: Embroidery \+ DTG/ : /طريقة الطباعة: تطريز \+ DTG/);
    assert.match(mail.html, lang === 'en' ? /Embroidery \+ DTG \(direct to garment\)/ : /تطريز \+ DTG/);
  }
  // Embroidery and a DTF back (the cap / polo kind of product).
  const dtf = { ...EMB_PRINT, sides: [{ id: 'emb', process: 'embroidery' }, { id: 'back', process: 'dtf' }] };
  assert.strictEqual(dispatch.methodName(dtf, 'en'), 'Embroidery + DTF transfer');
});

test('embroidery only, older embroidery items, printed items, photos and books keep their one name', () => {
  const embOnly = { ...BASE, process: 'embroidery', method: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }] };
  // (Saved before sides carried their process: the one side is the stitched one.)
  const old = { ...BASE, process: 'embroidery', method: 'embroidery', sides: [{ id: 'front' }] };
  for (const item of [embOnly, old]) {
    assert.deepStrictEqual(dispatch.processesOf(item), ['embroidery']);
    assert.strictEqual(dispatch.methodName(item, 'en'), 'Embroidery');
    assert.strictEqual(dispatch.methodName(item, 'ar'), 'تطريز');
  }
  assert.strictEqual(dispatch.methodName({ ...BASE, process: 'dtg', sides: [{ id: 'front' }, { id: 'back' }] }, 'en'), 'DTG (direct to garment)');
  assert.strictEqual(dispatch.methodName({ ...BASE, kind: 'photoset', process: 'paper' }, 'en'), 'Photo prints (photo paper)');
  assert.strictEqual(dispatch.methodName({ ...BASE, kind: 'book', process: 'paper' }, 'ar'), 'كتاب مطبوع');
  assert.strictEqual(dispatch.methodName({ ...BASE }, 'en'), '');
  assert.doesNotMatch(dispatch.whatsappText({ ...ARGS, item: { ...BASE }, lang: 'en' }), /Print method/);
});

test('the admin queue and Review name both: "Embroidery + DTG print" / «تطريز + طباعة DTG», each with its instructions', () => {
  for (const lang of ['en', 'ar']) {
    const t = tFor(lang);
    const ctx = { t, hasStr: (k) => Boolean(S[k]) };
    const processesOf = grab(ADMIN, /function processesOf\(item, sides = item\.sides\) \{[\s\S]*?\n  \}/, 'processesOf', ctx);
    ctx.processesOf = processesOf;
    const methodBoth = grab(ADMIN, /const methodBoth = \(procs\) => [^\n]+;/, 'methodBoth', ctx);
    assert.deepStrictEqual([...processesOf(EMB_PRINT)], ['embroidery', 'dtg']);
    assert.deepStrictEqual([...processesOf({ method: 'embroidery', process: 'embroidery', sides: [{ id: 'front' }] })], ['embroidery']);
    assert.deepStrictEqual([...processesOf({ process: 'dtf', sides: [{ id: 'front' }] })], ['dtf']);
    assert.strictEqual(methodBoth(['embroidery', 'dtg']), lang === 'en' ? 'Embroidery + DTG print' : 'تطريز + طباعة DTG');
    assert.strictEqual(methodBoth(['embroidery', 'dtf']), lang === 'en' ? 'Embroidery + DTF print' : 'تطريز + طباعة DTF');
  }
  // The job card shows both instructions; the dark-garment hint follows a DTG side too.
  const spec = ADMIN.slice(ADMIN.indexOf('  function spec(item) {'), ADMIN.indexOf('const RECOMMENDED'));
  assert.match(spec, /processesOf\(item\)\.length > 1[\s\S]*?methodBoth\(processesOf\(item\)\)[\s\S]*?processesOf\(item\)\.map\(\(p\) => `<div class="method-step">\$\{esc\(t\('process\.' \+ p\)\)\}/);
  assert.match(spec, /processesOf\(item\)\.includes\('dtg'\) && anyDark\(item\)/);
  // Review: the proof's sides (each with its process).
  assert.match(ADMIN, /const procs = processesOf\(\{ method: proof\.method === 'embroidery' \? 'embroidery' : item\.method, process \}, sides\);/);
  for (const k of ['process.embroidery', 'process.dtg', 'process.dtf', 'method.dtg', 'method.dtf']) assert.ok(S[k][0] && S[k][1], k);
});

test('a printing house gets "Embroidery + DTG" for a real order with a printed front and back and an embroidered chest', async () => {
  const png = (width, height) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE(crc(body));
      return Buffer.concat([len, body, sum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-admin5-'));
  const open = [{ max: 1e6, ms: 1000 }];
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, limits: { designs: open, orders: open } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const SIDE = { editor: { objects: [{ type: 'i-text', text: 'hi' }] } };
    const r = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', method: 'embroidery', sides: { front: SIDE, emb: SIDE, back: SIDE } });
    assert.strictEqual(r.status, 201, await r.clone().text());
    const { id, uploadToken, files } = await r.json();
    const PRINT = png(3600, 4800);
    const PREVIEW = png(60, 72);
    const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    for (const name of files) {
      const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW });
      assert.strictEqual(up.status, 204, name);
    }
    assert.strictEqual((await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).status, 200);
    const customer = { name: 'سارة أحمد', phone: '01012345678', governorate: 'giza', city: 'الدقي', address: '12 شارع التحرير' };
    assert.strictEqual((await post('/api/orders', { customer, designIds: [id] })).status, 201);
    const token = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
    const H = { Authorization: `Bearer ${token}` };
    const house = await (await post('/api/admin/houses', { name: 'Cairo Tees', whatsapp: '01001234567', prefer: 'whatsapp' }, H)).json();
    const q = await (await fetch(`${base}/api/admin/queue`, { headers: H })).json();
    const item = [...q.waiting, ...q.printing].find((i) => i.designId === id);
    assert.ok(item, 'in the queue');
    // What the admin's queue reads: the embroidery and each side's own process.
    assert.strictEqual(item.method, 'embroidery');
    assert.deepStrictEqual(item.sides.map((s) => [s.id, s.process]), [['front', 'dtg'], ['emb', 'embroidery'], ['back', 'dtg']]);
    for (const [lang, re] of [['en', /\*Print method:\* Embroidery \+ DTG \(direct to garment\)/], ['ar', /\*طريقة الطباعة:\* تطريز \+ DTG \(طباعة مباشرة على القماش\)/]]) {
      const sent = await post(`/api/admin/items/${item.id}/send`, { houseId: house.id, channel: 'whatsapp', formats: ['png'] }, { ...H, 'x-lang': lang });
      assert.strictEqual(sent.status, 200, await sent.clone().text());
      const text = new URL((await sent.json()).whatsappUrl).searchParams.get('text');
      assert.match(text, re, lang);
    }
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---------- Counted thread colours ----------
test('thread colours are counted: لون خيط واحد، لونين خيط، ٣ ألوان خيط، ١١ لون خيط', () => {
  const ar = pluralFor('ar');
  const en = pluralFor('en');
  assert.deepStrictEqual([1, 2, 3, 10, 11, 15, 103].map((n) => ar('emb.threads', n)), ['لون خيط واحد', 'لونين خيط', '3 ألوان خيط', '10 ألوان خيط', '11 لون خيط', '15 لون خيط', '103 ألوان خيط']);
  assert.deepStrictEqual([1, 2, 3, 11].map((n) => en('emb.threads', n)), ['1 thread colour', '2 thread colours', '3 thread colours', '11 thread colours']);
  // The summary takes the counted words, not a bare number before "ألوان".
  assert.doesNotMatch(S['admin.embSummary'][1], /ألوان/);
  assert.match(S['admin.embSummary'][1], /\{c\}/);
  assert.match(ADMIN, /t\('admin\.embSummary', \{ n: POD\.num\(item\.emb\.stitches\), c: POD\.plural\('emb\.threads', item\.emb\.colors\.length\)/);
  for (const k of ['one', 'two', 'few', 'many']) assert.ok(S[`emb.threads.${k}`][0] && S[`emb.threads.${k}`][1], k);
  // Ready for the editor's colour check and note ("١٢ ألوان" there): counted words passed in whole.
  assert.deepStrictEqual([2, 7, 12].map((n) => ar('emb.colours', n)), ['لونين', '7 ألوان', '12 لون']);
  const t = tFor('ar');
  assert.strictEqual(t('check.embColorsN', { n: ar('emb.colours', 12), max: ar('emb.threads', 6) }), '12 لون: التطريز لحد 6 ألوان خيط؛ الألوان القريبة هتتجمع.');
  assert.match(t('emb.noteN', { w: 9, h: 9, colours: ar('emb.colours', 12) }), /لحد 12 لون\./);
  assert.strictEqual(tFor('en')('check.embColorsN', { n: pluralFor('en')('emb.colours', 12), max: pluralFor('en')('emb.threads', 6) }), '12 colours: embroidery uses up to 6 thread colours; similar colours will be joined.');
});

// ---------- The address comma ----------
test("the admin's address joins city and governorate with the page's comma", () => {
  const src = ADMIN.match(/function address\(c\) \{[\s\S]*?\n  \}/)[0];
  const run = (lang) => vm.runInNewContext(`${src}\naddress`, { POD: { lang }, tr: (v) => (v && typeof v === 'object' ? v[lang] : v), line: (v) => v, esc: (v) => v });
  const c = { name: 'Ali', address: '5 Road 9', city: 'Dokki', governorate: 'giza', governorateName: { en: 'Giza', ar: 'الجيزة' } };
  assert.strictEqual(run('en')(c), 'Ali<br>5 Road 9<br>Dokki, Giza');
  assert.strictEqual(run('ar')({ ...c, city: 'الدقي' }), 'Ali<br>5 Road 9<br>الدقي، الجيزة');
  assert.doesNotMatch(src, /join\('، '\)/);
});

// ---------- Number boxes: Arabic digits, empty is never 0, a wrong number is never saved ----------
test('admin number boxes: none left as type="number", Accounts reads any digits and never takes an empty box as 0', () => {
  assert.doesNotMatch(ADMIN, /type="number"/);
  assert.doesNotMatch(read('admin.html'), /type="number"/);
  const latinDigits = grab(read('js/common.js'), /const latinDigits = \(s\) => [\s\S]*?\.replace\(\/\\u066B\/g, '\.'\);/, 'latinDigits');
  const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
  const ctx = { POD: { latinDigits, num: String }, t };
  const numProblem = grab(ADMIN, /const numText = [^\n]+;\n[\s\S]*?function numProblem\(el\) \{[\s\S]*?\n  \}/, 'numProblem', ctx);
  const box = (value, min, attrs = []) => ({ value, dataset: min == null ? {} : { min }, hasAttribute: (a) => attrs.includes(a) });
  assert.strictEqual(numProblem(box('', '0')), '', 'empty is fine where empty means something (a real cost: the estimate)');
  assert.strictEqual(numProblem(box('', '0', ['data-need'])), 'num.empty', 'a price or the shipping cost: empty is not 0');
  assert.strictEqual(numProblem(box('١٥٠', '0')), '');
  assert.strictEqual(numProblem(box('٤٥٫٥', '0')), '');
  assert.strictEqual(numProblem(box('-٢٠', '-100000')), '', 'sizes may take an amount off');
  assert.strictEqual(numProblem(box('−٢٠', '-100000')), '');
  assert.strictEqual(numProblem(box('-5', '0')), 'num.min {"min":"0"}');
  assert.strictEqual(numProblem(box('١٥ج', '0')), 'num.bad');
  assert.ok(S['num.empty'][0] && S['num.empty'][1] && !/محل/.test(S['num.empty'][1]));

  // The real cost and real shipping boxes of an order, and every price & cost box: number boxes.
  for (const attr of ['data-acc-item-cost', 'data-acc-ship']) {
    const tag = ADMIN.match(new RegExp(`<input [^>]*${attr}=[^>]*>`))[0];
    assert.match(tag, /type="text" inputmode="decimal" autocomplete="off" data-num data-min="0"/, attr);
    assert.doesNotMatch(tag, /data-need/, `${attr}: empty means "use the estimate"`);
  }
  const field = ADMIN.match(/const field = \(pid, key, value, extra = ''\) => `[^\n]+`;/)[0];
  assert.match(field, /type="text" inputmode="decimal" autocomplete="off" data-num data-need data-min="\$\{priceMin\(key\)\}"/);
  assert.match(field, /value="\$\{esc\(String\(value\)\)\}"/);
  // A real cost: checked before saving (a wrong one is not sent, so the saved cost stays), read with numValue.
  const change = ADMIN.slice(ADMIN.indexOf('const itemId = el.dataset.accItemCost;'), ADMIN.indexOf("$('acc-ship-save')"));
  assert.ok(change.indexOf('if (!checkNum(el)) {') > 0 && change.indexOf('if (!checkNum(el)) {') < change.indexOf('await adminApi'));
  assert.doesNotMatch(change, /el\.value === '' \? null : Number\(el\.value\)/);
  // The shop's shipping cost: an empty box is a message, not 0 and "Saved".
  assert.match(read('admin.html'), /id="acc-ship-cost" data-num data-need data-min="0"/);
  assert.doesNotMatch(ADMIN, /numValue\(\$\('acc-ship-cost'\)\) \|\| 0/);
  // The prices table keeps what is typed; an empty box is not 0.
  assert.doesNotMatch(ADMIN, /el\.value === '' \? 0 : Number\(el\.value\)/);
  assert.match(ADMIN, /\(acc\.edits\[pid\] \|\|= \{\}\)\[el\.dataset\.key\] = el\.value;/);
  const priceNum = grab(ADMIN, /const priceNum = \(raw\) => \{[\s\S]*?\n  \};/, 'priceNum', ctx);
  assert.strictEqual(priceNum('١٢٠٫٥'), 120.5);
  assert.strictEqual(priceNum(' ١٬٢٠٠ '), 1200);
  assert.strictEqual(priceNum('-٢٠'), -20);
  assert.strictEqual(priceNum(''), '');
  assert.ok(Number.isNaN(priceNum('abc')));
  assert.strictEqual(priceNum(75), 75);
  // Saving a row checks every typed box first; no profit is shown while one is empty.
  assert.match(ADMIN, /const bad = Object\.keys\(ed\)\.find\(\(k\) => priceProblem\(k, ed\[k\]\)\);\s*if \(bad\) return void showPriceProblem\(p\.id, bad, priceProblem\(bad, ed\[bad\]\)\);/);
  assert.match(ADMIN, /const known = parts\.every\(Number\.isFinite\);/);
});

// ---------- Rights requests ----------
test('Rights requests: an owner-only tab with a badge, opened by /admin#rights, both languages', () => {
  const html = read('admin.html');
  assert.match(html, /<button class="btn btn-sm rv-tab" data-tab="rights"><span data-i18n="tk\.tab"><\/span><span class="rv-count" id="tk-count" hidden><\/span><\/button>/);
  assert.match(html, /<section id="tab-rights" hidden><\/section>/);
  assert.match(html, /<link rel="stylesheet" href="\/css\/admin-rights\.css">/);
  const at = (f) => html.indexOf(`<script src="/js/${f}"></script>`);
  assert.ok(at('i18n-admin-rights.js') > 0 && at('i18n-admin-rights.js') < at('common.js'));
  assert.ok(at('admin-rights.js') > at('common.js') && at('admin-rights.js') < at('admin.js'));
  // Product managers (an old sign-in, no perms): the tab is hidden and its routes are never called from their page.
  // With roles, the tab is for those with the "rights" permission (public/js/admin-roles.js, test/admin-roles.test.js).
  assert.match(read('js/admin-roles.js'), /rights: 'rights',/);
  assert.match(read('js/admin-roles.js'), /const LEGACY_PRODUCTS = \['catalog\.view', 'catalog\.edit', 'library\.view', 'library\.edit', 'uploads'\];/);
  const staffRoute = grab(ADMIN, /const staffRoute = \(url\) => [^\n]+;/, 'staffRoute');
  assert.strictEqual(staffRoute('/api/admin/takedowns'), false);
  assert.strictEqual(staffRoute('/api/admin/takedowns/abc'), false);
  assert.match(ADMIN, /if \(tab !== 'rights' && can\('rights'\)\) AdminRights\.count\(\)/);
  // The alert's link.
  // (#rights first; otherwise the tab this browser tab had open before a reload.)
  assert.match(ADMIN, /const tabFromHash = \(\) => \(location\.hash === '#rights' \? 'rights' : ''\);[\s\S]{0,200}if \(tabFromHash\(\)\) showTab\(tabFromHash\(\)\);/);
  assert.match(ADMIN, /addEventListener\('hashchange'/);
  assert.match(ADMIN, /\$\('tab-rights'\)\.hidden = tab !== 'rights';/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/notify.js'), 'utf8'), /\/admin#rights/);
  // Strings: both languages, the same placeholders, Egyptian Arabic, never "محل".
  const keys = Object.keys(S).filter((k) => k.startsWith('tk.'));
  assert.ok(keys.length >= 30, keys.length);
  for (const k of keys) {
    const [en, ar] = S[k];
    assert.ok(en && ar, k);
    assert.deepStrictEqual((en.match(/\{\w+\}/g) || []).sort(), (ar.match(/\{\w+\}/g) || []).sort(), k);
    assert.doesNotMatch(ar, /محل|سيتم|يمكنك|لا يوجد|الآن/, k);
  }
  const ar = pluralFor('ar');
  assert.deepStrictEqual([1, 2, 3, 11].map((n) => ar('tk.open', n)), ['طلب واحد مفتوح', 'طلبين مفتوحين', '3 طلبات مفتوحة', '11 طلب مفتوح']);
  assert.match(RIGHTS, /POD\.plural\('tk\.open', n\)/);
  assert.match(RIGHTS, /POD\.date\(r\.at\)/);
});

test("Rights requests: the visitor's contact becomes email / call / WhatsApp links, a link opens in a new tab, the rest is text", () => {
  const latinDigits = grab(read('js/common.js'), /const latinDigits = \(s\) => [\s\S]*?\.replace\(\/\\u066B\/g, '\.'\);/, 'latinDigits');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const part = (re) => RIGHTS.match(re)[0];
  const src = [
    part(/const digitsOf = [^\n]+;/),
    part(/function phoneOf\(text\) \{[\s\S]*?\n  \}/),
    part(/const EMAIL_RE = [^\n]+;/),
    part(/function contactsOf\(text\) \{[\s\S]*?\n  \}/),
    part(/function urlOf\(text\) \{[\s\S]*?\n  \}/),
    part(/function ltrText\(s\) \{[\s\S]*?\n  \}/),
  ].join('\n');
  const f = vm.runInNewContext(`${src}\n({ phoneOf, contactsOf, urlOf, ltrText })`, { POD: { latinDigits }, esc, URL });
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(f.phoneOf('٠١٠ ١٢٣٤ ٥٦٧٨')), { tel: '+201012345678', wa: '201012345678', shown: '01012345678' });
  assert.deepStrictEqual(plain(f.phoneOf('+20 100 123 4567')), { tel: '+201001234567', wa: '201001234567', shown: '01001234567' });
  assert.deepStrictEqual(plain(f.phoneOf('+971 50 123 4567')), { tel: '+971501234567', wa: '971501234567', shown: '+971501234567' });
  assert.deepStrictEqual(plain(f.phoneOf('02 2555 1234')), { tel: '+20225551234', wa: '', shown: '0225551234' }, 'a landline: a call, no WhatsApp');
  for (const v of ['12345', 'mona', '2125551234']) assert.strictEqual(f.phoneOf(v), null, v);
  assert.deepStrictEqual(plain(f.contactsOf('legal@brand.example / +971 50 123 4567')), { emails: ['legal@brand.example'], phones: [{ tel: '+971501234567', wa: '971501234567', shown: '+971501234567' }] });
  assert.deepStrictEqual(plain(f.contactsOf('@mona_draws on Instagram')), { emails: [], phones: [] });
  // Links: http(s) only (a bare domain gets https); an order number or a script stays text.
  assert.strictEqual(f.urlOf('https://ebda3.me/design?id=x').href, 'https://ebda3.me/design?id=x');
  assert.strictEqual(f.urlOf('ebda3.me/design?id=x').href, 'https://ebda3.me/design?id=x');
  for (const v of ['javascript:alert(1)', 'POD-1043', 'data:text/html,<b>x</b>', 'see my page', 'ftp://x.com/a']) assert.strictEqual(f.urlOf(v), null, v);
  // The contact as typed, escaped, and left to right with each word on its own (Arabic digit groups keep their order).
  assert.strictEqual(f.ltrText('٠١٠ ١٢٣٤'), '<bdi dir="ltr" class="tk-text"><bdi>٠١٠</bdi> <bdi>١٢٣٤</bdi></bdi>');
  assert.strictEqual(f.ltrText('<b>x</b>'), '<bdi dir="ltr" class="tk-text"><bdi>&lt;b&gt;x&lt;/b&gt;</bdi></bdi>');
  assert.strictEqual(f.ltrText('واتساب 0100'), '<bdi dir="auto" class="tk-text">واتساب 0100</bdi>');
  // Everything the visitor typed goes through esc(); details keep their lines (pre-wrap), each in its own direction.
  const row = part(/function row\(r\) \{[\s\S]*?\n  \}/);
  for (const k of ['r.name', 'r.owner', 'r.details']) assert.match(row, new RegExp(`esc\\(${k.replace('.', '\\.')}\\)`), k);
  assert.match(row, /<div class="tk-details" dir="auto">\$\{esc\(r\.details\)\}<\/div>/);
  assert.match(read('css/admin-rights.css'), /\.tk-details \{[^}]*white-space: pre-wrap/);
  assert.match(RIGHTS, /target="_blank" rel="noopener noreferrer nofollow"/);
});
