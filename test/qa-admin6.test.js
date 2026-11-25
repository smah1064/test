'use strict';

// Admin QA (tester 2, 25 Nov, wave 6): forms sent once on a double-click, "Mark delivered" asking about items not
// printed yet, tracking numbers in 0-9, thread colours named (in both languages) for the printing house and in the
// admin, expense descriptions and other typed text in their own direction, the expense card's space, Review's
// digits and the custom dates of Accounts the wrong way round.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const dispatch = require('../src/dispatch');
const embroidery = require('../src/embroidery');
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
const PREVIEW = read('js/admin-preview.js');
const HTML = read('admin.html');
const COMMON = read('js/common.js');
/** A const or function taken from a page's source, run on its own. */
function grab(src, re, name, ctx = {}) {
  const m = src.match(re);
  assert.ok(m, name);
  return vm.runInNewContext(`${m[0]}\n${name}`, ctx);
}
const arabicDigits = grab(COMMON, /const AR_DIGITS = [\s\S]*?function arabicDigits\(s\) \{[\s\S]*?\n {2}\}/, 'arabicDigits');
const latinDigits = grab(COMMON, /const latinDigits = \(s\) => [\s\S]*?\.replace\(\/\\u066B\/g, '\.'\);/, 'latinDigits');
/** t() as common.js runs it: the Arabic string and numbers passed as numbers in ١٢٣. */
const tFor = (lang) => (k, p) => {
  const pair = S[k];
  assert.ok(pair, k);
  const s = lang === 'ar' ? arabicDigits(pair[1]) : pair[0];
  return s.replace(/\{(\w+)\}/g, (_, x) => {
    const v = p && p[x];
    return typeof v === 'number' && lang === 'ar' ? arabicDigits(String(v)) : v ?? '';
  });
};
const num = (lang) => (n) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 1 }).format(n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LATIN = /[0-9]/;

// ---------- 1. A second submit while the first is out is ignored ----------
test('admin forms that add something are sent once: a second submit while busy is ignored, the button is off meanwhile', async () => {
  const sendOnce = grab(ADMIN, /const sending = new WeakSet\(\);\n\s*async function sendOnce\(form, work\) \{[\s\S]*?\n {2}\}/, 'sendOnce');
  const button = { disabled: false };
  const form = { querySelectorAll: (sel) => (sel === 'button[type="submit"]' ? [button] : []) };
  let release;
  let calls = 0;
  const work = () => { calls++; return new Promise((r) => { release = r; }); };
  const first = sendOnce(form, work);
  assert.strictEqual(button.disabled, true, 'the button is off while the request is out');
  assert.strictEqual(await sendOnce(form, work), false, 'a double-click: ignored');
  assert.strictEqual(await sendOnce(form, work), false, 'Enter again: ignored');
  assert.strictEqual(calls, 1);
  release();
  assert.strictEqual(await first, true);
  assert.strictEqual(button.disabled, false, 'on again once answered');
  // A failed request frees the form too.
  await assert.rejects(sendOnce(form, async () => { throw new Error('boom'); }));
  assert.strictEqual(button.disabled, false);
  const again = sendOnce(form, () => { calls++; return Promise.resolve(); });
  assert.strictEqual(await again, true);
  assert.strictEqual(calls, 2);

  // Ready designs' "Add your own design", Accounts → Expenses "Add" and the coupon form go through it, after
  // preventDefault (a real submit would leave the page).
  for (const id of ['lib-add', 'acc-exp-form', 'cp-form']) {
    const re = new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('submit', \\(e\\) => \\{\\s*e\\.preventDefault\\(\\);\\s*sendOnce\\(\\$\\('${id}'\\), async \\(\\) => \\{`);
    assert.match(ADMIN, re, id);
  }
  // The printing house form turns its button off itself; sending to a printing house checks its own busy flag.
  assert.match(ADMIN, /\$\('house-save'\)\.disabled = true;/);
  assert.match(ADMIN, /if \(!st \|\| !item \|\| st\.busy\) return;/);
});

test('Private preview: a double-click on "Create invitation link" makes one invitation', async () => {
  const els = {};
  const button = { disabled: false };
  const handlers = {};
  els['tab-preview'] = { innerHTML: '', addEventListener: (type, fn) => { handlers[type] = fn; } };
  els['pv-name'] = { value: 'Mona' };
  els['pv-own'] = { value: '' };
  els['pv-msg'] = { textContent: '', classList: { toggle() {} } };
  els['pv-add'] = { querySelector: () => button };
  const ctx = {
    document: { getElementById: (id) => els[id] || null, activeElement: null },
    navigator: { clipboard: { writeText: async () => {} } },
    POD: { t: (k) => k, esc: String, lang: 'en', num: String, sep: () => ' · ', plural: (b, n) => String(n), toast() {} },
    confirm: () => true,
  };
  ctx.window = ctx;
  vm.runInNewContext(PREVIEW, ctx);
  const posts = [];
  let release;
  ctx.AdminPreview.init({
    api: async (url, o = {}) => {
      if (o.method === 'POST') {
        posts.push(JSON.parse(o.body));
        await new Promise((r) => { release = r; });
        return { id: 'p1', link: 'https://x/?invite=ABC' };
      }
      return { on: true, people: posts.map((p, i) => ({ id: 'p' + (i + 1), name: p.name, code: 'ABC', link: 'x' })) };
    },
  });
  await ctx.AdminPreview.show();
  let prevented = 0;
  const submit = () => handlers.submit({ target: { id: 'pv-add' }, preventDefault: () => { prevented++; } });
  const first = submit();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(button.disabled, true, 'the button is off while the invitation is made');
  await submit();
  await submit();
  assert.strictEqual(prevented, 3, 'every submit stays on the page');
  assert.strictEqual(posts.length, 1, 'one invitation, one code');
  // The 15-second refresh while it is out draws the button off too.
  assert.match(PREVIEW, /type="submit" \$\{adding \? 'disabled' : ''\}>/);
  release();
  await first;
  assert.strictEqual(button.disabled, false);
  // The next invitation goes through.
  const second = submit();
  await new Promise((r) => setImmediate(r));
  release();
  await second;
  assert.strictEqual(posts.length, 2);
});

// ---------- 2. "Mark delivered" asks about items not printed yet; tracking numbers in 0-9 ----------
function shipCtx(lang, notifySt) {
  const ctx = {
    POD: { num: num(lang), lang, latinDigits },
    t: tFor(lang),
    tr: (v) => (v && typeof v === 'object' ? v[lang] : v),
    IN_REVIEW: new Set(['review', 'awaiting_approval', 'changes_requested']),
    notifySt,
    asked: [],
    answer: true,
  };
  ctx.confirm = (m) => { ctx.asked.push(m); return ctx.answer; };
  ctx.isDelivered = grab(ADMIN, /const isDelivered = \(o\) => [^\n]+;/, 'isDelivered');
  ctx.isShipped = grab(ADMIN, /const isShipped = \(o\) => [^\n]+;/, 'isShipped', ctx);
  ctx.unprintedList = grab(ADMIN, /function unprintedList\(o\) \{[\s\S]*?\n {2}\}/, 'unprintedList', ctx);
  ctx.confirmUnprinted = grab(ADMIN, /function confirmUnprinted\(o, deliver\) \{[\s\S]*?\n {2}\}/, 'confirmUnprinted', ctx);
  return ctx;
}
const n2 = (en, ar) => ({ en, ar });
const ORDER = {
  status: 'in_production',
  customer: { email: 'sara@example.com' },
  items: [{ productName: n2('T-shirt', 'تيشيرت'), status: 'queued' }, { productName: n2('Mug', 'مج'), status: 'printing' }],
};

test('"Mark delivered" asks first, like "Mark shipped", naming the items not printed yet (both languages)', () => {
  const en = shipCtx('en', { customerEmail: true });
  assert.strictEqual(en.confirmUnprinted(ORDER, true), true);
  assert.deepStrictEqual(en.asked, ['Not printed yet: 1. T-shirt (Queued), 2. Mug (Printing).\n\nMark the whole order shipped and delivered anyway? These items will be marked shipped too.\n\nsara@example.com will get the "on its way" email.']);
  en.answer = false;
  assert.strictEqual(en.confirmUnprinted(ORDER, false), false, 'cancelled: nothing is saved');
  assert.match(en.asked[1], /^Not printed yet: 1\. T-shirt \(Queued\), 2\. Mug \(Printing\)\.\n\nMark the whole order shipped anyway\?/);
  const ar = shipCtx('ar', { customerEmail: true });
  ar.confirmUnprinted(ORDER, true);
  assert.strictEqual(ar.asked[0], 'لسه ما اتطبعش: ١. تيشيرت (في الانتظار)، ٢. مج (قيد الطباعة).\n\nتسجّل الطلب كله إنه اتشحن واتسلّم برضه؟ المنتجات دي هتتسجّل إنها اتشحنت هي كمان.\n\nوهيوصل لـ sara@example.com إيميل "طلبك في الطريق".');
  // Email off (or no email): no word about it. One item: no number before it.
  const off = shipCtx('en', { customerEmail: false });
  off.confirmUnprinted({ ...ORDER, items: [ORDER.items[0]] }, true);
  assert.strictEqual(off.asked[0], 'Not printed yet: T-shirt (Queued).\n\nMark the whole order shipped and delivered anyway? These items will be marked shipped too.');
  // Everything printed, already shipped, or still in review (the server refuses that by itself): not asked.
  const quiet = shipCtx('en', { customerEmail: true });
  assert.strictEqual(quiet.confirmUnprinted({ ...ORDER, items: ORDER.items.map((i) => ({ ...i, status: 'printed' })) }, true), true);
  assert.strictEqual(quiet.confirmUnprinted({ ...ORDER, status: 'shipped', items: ORDER.items.map((i) => ({ ...i, status: 'shipped' })) }, true), true);
  assert.strictEqual(quiet.confirmUnprinted({ ...ORDER, items: [ORDER.items[0], { ...ORDER.items[1], status: 'review' }] }, true), true);
  assert.deepStrictEqual(quiet.asked, []);
  // The buttons: both ask before saving; "Not delivered yet" doesn't.
  const click = ADMIN.slice(ADMIN.indexOf("const shipped = e.target.closest('[data-ship-shipped]');"), ADMIN.indexOf("const pay = e.target.closest('[data-pay]');"));
  assert.match(click, /if \(!confirmUnprinted\(orderById\(shipped\.dataset\.shipShipped\), false\)\) return;\s*return saveShipment/);
  assert.match(click, /if \(on && !confirmUnprinted\(orderById\(del\.dataset\.shipDelivered\), true\)\) return;\s*return saveShipment/);
  for (const k of ['ship.notPrintedList', 'ship.notPrintedShip', 'ship.notPrintedDeliver', 'ship.mailToo']) {
    assert.ok(S[k][0] && S[k][1], k);
    assert.doesNotMatch(S[k][1], /محل|سيتم|يمكنك|الآن/, k);
  }
});

test('a tracking number typed with Arabic or Persian digits is sent and shown in 0-9', () => {
  const trackingText = grab(ADMIN, /const trackingText = \(v\) => [^\n]+;/, 'trackingText', { POD: { latinDigits } });
  assert.strictEqual(trackingText('٧٧٨٨-AB'), '7788-AB');
  assert.strictEqual(trackingText('۱۲۳۴ ab'), '1234 ab');
  assert.strictEqual(trackingText('BOS-55'), 'BOS-55');
  // What is sent, what the box shows (also while typing) and the orders table's note.
  assert.match(ADMIN, /if \(el\) out\[k\] = \(k === 'trackingNumber' \? trackingText\(el\.value\) : el\.value\)\.trim\(\) \|\| null;/);
  assert.match(ADMIN, /return k === 'trackingNumber' \? trackingText\(v\) : v;/);
  assert.match(ADMIN, /if \(f\.dataset\.shipField === 'trackingNumber' && trackingText\(f\.value\) !== f\.value\) \{/);
});

// ---------- 6. Typed text in its own direction ----------
test("the orders table's shipping note isolates the courier, the tracking number and the date, each on its own", () => {
  for (const lang of ['en', 'ar']) {
    const ctx = { esc, t: tFor(lang), POD: { lang, latinDigits, date: () => '25 Nov 2026, 11:15' }, day: (d) => d };
    ctx.SEP = grab(ADMIN, /const SEP = \(\) => [^\n]+;/, 'SEP', ctx);
    ctx.isDelivered = grab(ADMIN, /const isDelivered = \(o\) => [^\n]+;/, 'isDelivered');
    ctx.isShipped = grab(ADMIN, /const isShipped = \(o\) => [^\n]+;/, 'isShipped', ctx);
    ctx.trackingText = grab(ADMIN, /const trackingText = \(v\) => [^\n]+;/, 'trackingText', ctx);
    const shipNote = grab(ADMIN, /function shipNote\(o\) \{[\s\S]*?\n {2}\}/, 'shipNote', ctx);
    const html = shipNote({ status: 'delivered', shipment: { courier: 'Bosta بوسطة', trackingNumber: '٧٧٨٨-AB', deliveredAt: '2026-11-25T09:15:00Z' } });
    const sep = lang === 'ar' ? '، ' : ' · ';
    const when = lang === 'ar' ? 'اتسلّم 25 Nov 2026, 11:15' : 'Delivered 25 Nov 2026, 11:15';
    assert.strictEqual(html, `<span class="ship-note"><bdi dir="auto">Bosta بوسطة</bdi>${sep}<bdi dir="ltr">7788-AB</bdi>${sep}<bdi>${when}</bdi></span>`, lang);
  }
});

test('names the owner or a customer typed keep their direction: "Print Co.", "عيد Eid", house notes, expense descriptions', () => {
  const ctx = { esc, t: tFor('ar'), POD: { lang: 'ar' } };
  ctx.listed = grab(ADMIN, /const listed = \(s\) => [^\n]+;/, 'listed', ctx);
  const tIsolated = grab(ADMIN, /function tIsolated\(key, params, own\) \{[\s\S]*?\n {2}\}/, 'tIsolated', ctx);
  assert.strictEqual(tIsolated('houses.sentLine', { channel: 'واتساب', date: '٢٥ نوفمبر' }, { house: 'Print Co.' }), 'اتبعت لـ <bdi dir="auto">Print Co.</bdi> عبر واتساب، ٢٥ نوفمبر');
  assert.strictEqual(tIsolated('houses.sentLine', { channel: 'x', date: 'y' }, { house: '<b>&' }), 'اتبعت لـ <bdi dir="auto">&lt;b&gt;&amp;</bdi> عبر x، y', 'escaped');
  assert.match(ADMIN, /📤 \$\{tIsolated\('houses\.sentLine', \{ channel: [^}]+\}, \{ house: x\.houseName \}\)\}/);
  // (Options of a <select> can't hold a <bdi>: isolating marks.)
  assert.strictEqual(grab(ADMIN, /const isolate = \(v\) => [^\n]+;/, 'isolate')('Print Co.'), '⁨Print Co.⁩');
  assert.match(ADMIN, /\$\{esc\(isolate\(h\.name\)\)\}\$\{h\.id === def/);
  const line = grab(ADMIN, /const line = \(v\) => [^\n]+;/, 'line', { esc });
  assert.strictEqual(line('=SUM(A1)'), '<bdi dir="auto">=SUM(A1)</bdi>');
  assert.match(ADMIN, /<td class="acc-exp-desc">\$\{line\(e\.description\)\}<\/td>/);
  assert.match(ADMIN, /\$\{c\.note \? `<div class="muted small">\$\{line\(c\.note\)\}<\/div>` : ''\}/);
  assert.match(ADMIN, /<strong>\$\{line\(h\.name\)\}<\/strong>/);
  assert.match(ADMIN, /\$\{h\.notes \? `<div class="muted small">\$\{line\(h\.notes\)\}<\/div>` : ''\}/);
  assert.match(ADMIN, /<dd><bdi dir="ltr">\$\{esc\(c\.email\)\}<\/bdi><\/dd>/);
  assert.match(ADMIN, /<textarea rows="2" maxlength="500" dir="auto" data-send-note=/);
  // Nothing is left as plain esc() of those.
  assert.doesNotMatch(ADMIN, /<td>\$\{esc\(e\.description\)\}<\/td>|\$\{esc\(c\.note\)\}|\$\{esc\(h\.notes\)\}/);
});

// ---------- 4. The expense card ----------
test('"Add an expense" is a form card with inner space like the others; descriptions wrap', () => {
  const css = read('css/styles.css');
  assert.match(css, /\.acc-exp-form \{ padding: 18px; margin-bottom: 14px; \}/);
  assert.match(css, /\.house-form \{ padding: 18px; margin-bottom: 14px; \}/, 'the same as the printing houses\' and coupons\' form');
  assert.match(css, /\.acc-table td\.acc-exp-desc \{ white-space: normal;/);
  assert.match(HTML, /<form class="card acc-exp-form" id="acc-exp-form">/);
  // An empty amount box isn't red before the admin tries to send it (nor right after an expense is added).
  assert.match(HTML, /#dash input\[data-num\]:not\(\[required\]\):invalid, #dash input\[data-num\]\[required\]:user-invalid \{ border-color: var\(--bad\); \}/);
  assert.match(ADMIN, /\$\('acc-exp-form'\)\.reset\(\);\s*\[\$\('exp-date'\)\.value, \$\('exp-cat'\)\.value\] = keep;/);
});

// ---------- 7. Custom dates the wrong way round ----------
test('Accounts: a custom start after its end says so (and offers to swap), in both languages', () => {
  const acc = { period: 'custom', from: '2026-11-20', to: '2026-11-01' };
  const rangeBackwards = grab(ADMIN, /const rangeBackwards = \(\) => [^\n]+;/, 'rangeBackwards', { acc });
  assert.strictEqual(rangeBackwards(), true);
  Object.assign(acc, { from: '2026-11-01', to: '2026-11-20' });
  assert.strictEqual(rangeBackwards(), false);
  Object.assign(acc, { from: '2026-11-20', to: '2026-11-20' });
  assert.strictEqual(rangeBackwards(), false, 'one day');
  Object.assign(acc, { period: 'month', from: '2026-11-20', to: '2026-11-01' });
  assert.strictEqual(rangeBackwards(), false, 'only the custom period');
  assert.match(HTML, /<p class="notice small acc-range-msg" id="acc-range-msg" role="alert" hidden><span data-i18n="acc\.rangeBackwards"><\/span> <button class="btn btn-sm" type="button" id="acc-range-swap" data-i18n="acc\.swapDates"><\/button><\/p>/);
  assert.match(ADMIN, /\$\('acc-range-msg'\)\.hidden = !rangeBackwards\(\);/);
  assert.match(ADMIN, /if \(e\.target\.closest\('#acc-range-swap'\)\) \{\s*\[acc\.from, acc\.to\] = \[acc\.to, acc\.from\];/);
  assert.deepStrictEqual([...S['acc.rangeBackwards']], ['The start date is after the end date.', 'تاريخ البداية بعد تاريخ النهاية.']);
  assert.ok(S['acc.swapDates'][0] && S['acc.swapDates'][1]);
});

// ---------- 5. Review in the page's digits ----------
test("Review's print checks, sizes and approval versions are in ١٢٣ on the Arabic page, 0-9 in English", () => {
  for (const lang of ['ar', 'en']) {
    const ctx = { t: tFor(lang), hasStr: (k) => Boolean(S[k]), POD: { num: num(lang), lang } };
    const checkText = grab(ADMIN, /function checkText\(c\) \{[\s\S]*?\n {2}\}/, 'checkText', ctx);
    const size = checkText({ id: 'exportSize', params: { widthPx: 1200, heightPx: 1600, expectedW: 1200, expectedH: 486 } });
    const dpi = checkText({ id: 'resolution', params: { dpi: 139.04, minDpi: 150 } });
    if (lang === 'ar') {
      assert.strictEqual(size, 'ملف الطباعة ١٢٠٠ × ١٦٠٠ px، والمقاس ده محتاج ١٢٠٠ × ٤٨٦ px.');
      assert.strictEqual(dpi, 'دقة الطباعة ١٣٩ DPI بالمقاس النهائي (المطلوب ١٥٠ على الأقل).');
      assert.doesNotMatch(size + dpi, LATIN);
      assert.strictEqual(ctx.t('rv.sizeLine', { w: 30.5, h: 40.6, wi: 12, hi: 16 }), '٣٠٫٥ × ٤٠٫٦ سم (١٢ × ١٦ بوصة)');
    } else {
      assert.strictEqual(size, 'The print file is 1200 × 1600 px; this size needs 1200 × 486 px.');
      assert.strictEqual(dpi, 'Print resolution is 139 DPI at the final size (needs at least 150).');
      assert.strictEqual(ctx.t('rv.sizeLine', { w: 30.5, h: 40.6, wi: 12, hi: 16 }), '30.5 × 40.6 cm (12 × 16 in)');
    }
  }
  // The approval history's version and the side's size; the DPI line in the page's direction (١٢٠٠ × ١٦٠٠ forced
  // left to right reads 1600 × 1200).
  assert.match(ADMIN, /\$\{a\.version != null \? esc\(\/\^\\d\+\$\/\.test\(String\(a\.version\)\) \? POD\.num\(Number\(a\.version\)\) : String\(a\.version\)\) : '—'\}/);
  assert.match(ADMIN, /<dt>\$\{esc\(t\('rv\.size'\)\)\}<\/dt><dd>\$\{esc\(t\('rv\.sizeLine', /);
  assert.match(ADMIN, /<dd>\$\{esc\(t\('rv\.resolution', \{ dpi: s\.dpi \|\| '\?', w: s\.widthPx \|\| '\?', h: s\.heightPx \|\| '\?' \}\)\)\}<\/dd>/);
  // The print floor's job card keeps its production sizes in 0-9 on purpose.
  assert.match(ADMIN, /<bdi dir="ltr">\$\{cm\(s\.widthIn\)\} × \$\{cm\(s\.heightIn\)\} cm \(\$\{s\.widthIn\} × \$\{s\.heightIn\} in\)<\/bdi>/);
});

// ---------- 8. Thread colours named in both languages ----------
test('thread colours have Arabic names: the same list in src/embroidery.js and the admin strings', () => {
  assert.strictEqual(embroidery.threadName({ name: 'Red', hex: '#d01c1f' }, 'ar'), 'أحمر');
  assert.strictEqual(embroidery.threadName({ name: 'Gold', hex: '#c9a227' }, 'ar'), 'دهبي');
  assert.strictEqual(embroidery.threadName({ name: 'Lime', hex: '#9ccc3a' }, 'ar'), 'أخضر فاتح');
  assert.strictEqual(embroidery.threadName({ name: 'Lime', hex: '#9ccc3a' }, 'en'), 'Lime');
  assert.strictEqual(embroidery.threadName({ name: 'Old name', hex: '#9CCC3A' }, 'ar'), 'أخضر فاتح', 'found by its hex');
  assert.strictEqual(embroidery.threadName({ name: 'Custom', hex: '#123456' }, 'ar'), 'Custom', 'not in the list: as saved');
  // Digitising still keeps the English name (orders already saved, the DST label).
  assert.deepStrictEqual(embroidery.nearestThread([208, 28, 31]), { name: 'Red', hex: '#d01c1f' });
  const names = new Set();
  for (const [en, hex, ar] of embroidery.THREADS) {
    assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.ok(ar && /^[؀-ۿ ()]+$/.test(ar), `${en}: Arabic name "${ar}"`);
    assert.ok(!names.has(ar), `${ar} named twice`);
    names.add(ar);
    assert.deepStrictEqual([...S['thread.' + en]], [en, ar], `thread.${en} in js/i18n-admin-threads.js`);
  }
  assert.strictEqual(Object.keys(S).filter((k) => k.startsWith('thread.')).length, embroidery.THREADS.length);
  // The admin names them in the page's language.
  for (const lang of ['ar', 'en']) {
    const threadName = grab(ADMIN, /const threadName = \(c\) => [^\n]+;/, 'threadName', { t: tFor(lang), hasStr: (k) => Boolean(S[k]) });
    assert.deepStrictEqual(['Red', 'Gold', 'Lime', 'Mystery'].map((name) => threadName({ name })), lang === 'ar' ? ['أحمر', 'دهبي', 'أخضر فاتح', 'Mystery'] : ['Red', 'Gold', 'Lime', 'Mystery']);
  }
  assert.match(ADMIN, /\$\{esc\(threadName\(c\)\)\} <span class="muted">\(<bdi dir="ltr">\$\{esc\(c\.hex\)\}<\/bdi>/);
  const at = (f) => HTML.indexOf(`<script src="/js/${f}"></script>`);
  for (const f of ['i18n-admin-threads.js', 'i18n-admin-more.js']) assert.ok(at(f) > 0 && at(f) < at('common.js'), f);
});

// ---------- 3. The printing house gets the thread colours ----------
const ARGS = { house: { name: 'X' }, design: { sides: [] }, files: [], expires: '2026-12-24T00:00:00Z', order: { number: 'POD-1', items: [{}] } };
const EMB = {
  position: 1, productName: n2('T-shirt', 'تيشيرت'), color: { name: n2('White', 'أبيض') }, size: { label: n2('M', 'M') },
  process: 'embroidery', method: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }],
  emb: { colors: [{ name: 'Red', hex: '#d01c1f', stitches: 900 }, { name: 'Gold', hex: '#c9a227', stitches: 500 }, { name: 'Lime', hex: '#9ccc3a', stitches: 300 }] },
};

test('the printing house message lists the thread colours in sewing order, named in the message language', () => {
  const en = dispatch.whatsappText({ ...ARGS, item: EMB, lang: 'en' });
  assert.match(en, /\n\*Print method:\* Embroidery\n\*Thread colours, in sewing order:\* 1\. Red #d01c1f → 2\. Gold #c9a227 → 3\. Lime #9ccc3a\n/);
  const ar = dispatch.whatsappText({ ...ARGS, item: EMB, lang: 'ar' });
  assert.ok(ar.includes('\n*ألوان الخيط بترتيب التطريز:* ١. أحمر ‎#d01c1f ← ٢. دهبي ‎#c9a227 ← ٣. أخضر فاتح ‎#9ccc3a\n'), ar);
  for (const lang of ['en', 'ar']) {
    const mail = dispatch.emailBody({ ...ARGS, item: EMB, lang, attached: false });
    assert.match(mail.text, lang === 'en' ? /Thread colours, in sewing order: 1\. Red #d01c1f → 2\. Gold #c9a227 → 3\. Lime #9ccc3a/ : /ألوان الخيط بترتيب التطريز: ١\. أحمر ‎#d01c1f ← ٢\. دهبي/);
    assert.match(mail.html, lang === 'en' ? />1\. Red #d01c1f → 2\. Gold #c9a227 → 3\. Lime #9ccc3a</ : />١\. أحمر ‎#d01c1f ← ٢\. دهبي ‎#c9a227 ← ٣\. أخضر فاتح ‎#9ccc3a</);
  }
  // The design's colours (digitised with the DST that is sent) come first.
  const fresh = dispatch.whatsappText({ ...ARGS, design: { sides: [], emb: { colors: [{ name: 'Navy', hex: '#1b2550' }] } }, item: EMB, lang: 'en' });
  assert.match(fresh, /\*Thread colours, in sewing order:\* 1\. Navy #1b2550\n/);
  // Nothing to say: no line (a printed item, embroidery that couldn't be digitised).
  assert.doesNotMatch(dispatch.whatsappText({ ...ARGS, item: { ...EMB, process: 'dtg', method: null, emb: null }, lang: 'en' }), /Thread/);
  assert.doesNotMatch(dispatch.whatsappText({ ...ARGS, item: { ...EMB, emb: { colors: [], warnings: ['failed'] } }, lang: 'en' }), /Thread/);
});

test('sending an embroidery job ticks the stitch file and the picture of the stitches (the colours) by default', () => {
  const ctx = { housesData: { houses: [{ id: 'h1', prefer: 'whatsapp' }], productHouses: {} } };
  ctx.findHouse = (id) => ctx.housesData.houses.find((h) => h.id === id) || null;
  ctx.FORMATS_BY_METHOD = grab(ADMIN, /const FORMATS_BY_METHOD = \{[\s\S]*?\n {2}\};/, 'FORMATS_BY_METHOD');
  ctx.mergeFormats = grab(ADMIN, /function mergeFormats\(item\) \{[\s\S]*?\n {2}\}/, 'mergeFormats');
  ctx.printPdfKey = grab(ADMIN, /const printPdfKey = \(item\) => [^\n]+;/, 'printPdfKey');
  ctx.sendFormats = grab(ADMIN, /function sendFormats\(item\) \{[\s\S]*?\n {2}\}/, 'sendFormats', ctx);
  const sendDefaults = grab(ADMIN, /function sendDefaults\(item\) \{[\s\S]*?\n {2}\}/, 'sendDefaults', ctx);
  const ticked = (item) => [...sendDefaults(item).formats].sort();
  assert.deepStrictEqual(ticked({ productId: 'tshirt', process: 'embroidery', method: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }] }), ['dst', 'preview-pdf', 'stitches']);
  // With a printed back: its print PDF too.
  assert.deepStrictEqual(ticked({ productId: 'tshirt', process: 'embroidery', method: 'embroidery', sides: [{ id: 'emb', process: 'embroidery' }, { id: 'back', process: 'dtg' }] }), ['dst', 'pdf', 'preview-pdf', 'stitches']);
  assert.deepStrictEqual(ticked({ productId: 'tshirt', process: 'dtg', sides: [{ id: 'front' }] }), ['pdf', 'preview-pdf']);
});

test('a real embroidery order: the WhatsApp message to the printing house names its thread colours (both languages)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-admin6-'));
  const open = [{ max: 1e6, ms: 1000 }];
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, limits: { designs: open, orders: open } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const SIDE = { editor: { objects: [{ type: 'i-text', text: 'hi' }] } };
    const r = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', method: 'embroidery', sides: { emb: SIDE } });
    assert.strictEqual(r.status, 201, await r.clone().text());
    const { id, uploadToken, files } = await r.json();
    const stripes = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
      { input: { create: { width: 1000, height: 400, channels: 4, background: '#d01c1f' } }, left: 0, top: 0 },
      { input: { create: { width: 1000, height: 300, channels: 4, background: '#c9a227' } }, left: 0, top: 400 },
      { input: { create: { width: 1000, height: 300, channels: 4, background: '#9ccc3a' } }, left: 0, top: 700 },
    ]).png().toBuffer();
    const preview = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#cc3333' } }).png().toBuffer();
    for (const name of files) {
      const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>') : name.includes('print') ? stripes : preview;
      const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body });
      assert.strictEqual(up.status, 204, name);
    }
    assert.strictEqual((await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).status, 200);
    const customer = { name: 'سارة أحمد', phone: '01012345678', governorate: 'giza', city: 'الدقي', address: '12 شارع التحرير' };
    assert.strictEqual((await post('/api/orders', { customer, designIds: [id] })).status, 201);
    const token = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
    const H = { Authorization: `Bearer ${token}` };
    const house = await (await post('/api/admin/houses', { name: 'Print Co.', whatsapp: '01001234567', prefer: 'whatsapp' }, H)).json();
    const q = await (await fetch(`${base}/api/admin/queue`, { headers: H })).json();
    const item = [...q.waiting, ...q.printing].find((i) => i.designId === id);
    assert.deepStrictEqual(item.emb.colors.map((c) => c.name), ['Red', 'Lime', 'Gold'], 'what the admin lists');
    const want = { en: '*Thread colours, in sewing order:* 1. Red #d01c1f → 2. Lime #9ccc3a → 3. Gold #c9a227', ar: '*ألوان الخيط بترتيب التطريز:* ١. أحمر ‎#d01c1f ← ٢. أخضر فاتح ‎#9ccc3a ← ٣. دهبي ‎#c9a227' };
    for (const lang of ['en', 'ar']) {
      const sent = await post(`/api/admin/items/${item.id}/send`, { houseId: house.id, channel: 'whatsapp', formats: ['dst', 'stitches'] }, { ...H, 'x-lang': lang });
      assert.strictEqual(sent.status, 200, await sent.clone().text());
      const text = new URL((await sent.json()).whatsappUrl).searchParams.get('text');
      assert.ok(text.includes(want[lang]), text);
    }
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---------- The new words ----------
test('the new admin words: both languages, the same placeholders, Egyptian Arabic, never "محل"', () => {
  const keys = ['ship.notPrintedList', 'ship.notPrintedShip', 'ship.notPrintedDeliver', 'ship.mailToo', 'acc.rangeBackwards', 'acc.swapDates', 'rv.sizeLine', ...Object.keys(S).filter((k) => k.startsWith('thread.'))];
  for (const k of keys) {
    const [en, ar] = S[k];
    assert.ok(en && ar, k);
    assert.deepStrictEqual((en.match(/\{\w+\}/g) || []).sort(), (ar.match(/\{\w+\}/g) || []).sort(), k);
    assert.doesNotMatch(ar, /محل|سيتم|يمكنك|لا يوجد|الآن|·/, k);
  }
  // The old one-size-fits-all question is gone.
  assert.strictEqual(S['ship.notPrinted'], undefined);
  assert.doesNotMatch(ADMIN, /t\('ship\.notPrinted'\)/);
});
