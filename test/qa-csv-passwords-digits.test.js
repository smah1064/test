'use strict';

// QA (26 Nov, three low ones): the Accounts CSV from the Arabic dashboard was English with raw ids; customers could
// choose "12345678" or their own mobile number as a password; typed values in the Arabic activity log and approvals
// (a tracking number, a printing house's number, a coupon code) had their digits turned Arabic-Indic.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const accounting = require('../src/accounting');
const customers = require('../src/customers');
const passwords = require('../src/passwords');
const i18n = require('../src/i18n');
const { createApp } = require('../src/app');

const FSI = '\u2068';
const PDI = '\u2069';
const ARABIC_INDIC = /[٠-٩]/;

// ---------- 1. The Accounts CSV in the dashboard's language ----------
const REPORT = {
  orders: [
    { number: 1001, createdAt: '2026-11-20T10:00:00Z', customer: 'منى عادل', status: 'open', items: [{ productName: { en: 'Classic T-Shirt', ar: 'تيشيرت كلاسيك' } }, { productName: { en: 'Mug', ar: 'مج' } }], subtotal: 1250.5, discount: 50, coupon: 'EID20', shipping: 60, total: 1260.5, itemCost: 400, shippingCost: 45, profit: 815.5 },
    { number: 1002, createdAt: '2026-11-21T10:00:00Z', customer: '-Karim; "K"', status: 'shipped', items: [{ productName: { en: 'Cap', ar: 'كاب' } }], subtotal: 300, discount: 0, coupon: null, shipping: 60, total: 360, itemCost: 120, shippingCost: 45, profit: 195 },
  ],
  expenses: [
    { date: '2026-11-22', category: 'materials', description: 'خامات 50 تيشيرت', amount: 2500 },
    { date: '2026-11-23', category: 'marketing', description: 'Facebook ads', amount: 1000 },
  ],
  totals: { discounts: 50, revenue: 1620.5, itemCost: 520, shippingCost: 90, grossProfit: 1010.5, expenses: 3500, netProfit: -2489.5 },
};
const nameOf = (v) => (v && typeof v === 'object' ? v.en : v);
const rows = (csv) => csv.replace(/^\ufeff/, '').split('\r\n').map((l) => l.split(','));

test('Accounts CSV: from the Arabic dashboard, Arabic column titles, states, kinds of expense and product names', () => {
  const csv = accounting.reportCsv(REPORT, nameOf, { lang: 'ar' });
  // Excel-friendly as the other CSVs: a byte-order mark, commas, CRLF.
  assert.ok(csv.startsWith('\ufeff'), 'BOM so Excel reads the Arabic');
  assert.ok(!/[^\r]\n/.test(csv), 'CRLF line ends');
  const r = rows(csv);
  assert.deepStrictEqual(r[0], ['الطلب', 'التاريخ', 'العميل', 'الحالة', 'عدد المنتجات', 'المنتجات', 'المبيعات', 'الخصم', 'الكوبون', 'الشحن اللي دفعه العميل', 'الإجمالي', 'تكلفة المنتجات والطباعة', 'تكلفة الشحن', 'الربح']);
  // The order: its state and products in Arabic, the numbers as numbers (0-9, no currency).
  assert.deepStrictEqual(r[1], ['1001', '2026-11-20', 'منى عادل', 'لسه ماتشحنش', '2', 'تيشيرت كلاسيك + مج', '1250.5', '50', 'EID20', '60', '1260.5', '400', '45', '815.5']);
  assert.ok(csv.includes(',اتشحن,'), 'a shipped order');
  // Text that could start a formula, or holds a ; or quotes, is quoted and made harmless.
  assert.ok(csv.includes(`"'-Karim; ""K"""`), csv);
  assert.ok(!csv.includes(',open,') && !csv.includes(',shipped,'), 'no raw states');
  // Expenses: the kind as the dashboard says it, the description as typed.
  const exp = csv.split('\r\n');
  assert.ok(exp.includes('المصروفات,التاريخ,النوع,الوصف,المبلغ'));
  assert.ok(exp.includes(',2026-11-22,خامات ومنتجات,خامات 50 تيشيرت,2500'), csv);
  assert.ok(exp.includes(',2026-11-23,تسويق وإعلانات,Facebook ads,1000'));
  assert.ok(!/,materials,|,marketing,/.test(csv), 'no raw expense ids');
  // Totals, in Arabic, the amounts plain numbers.
  assert.ok(exp.includes('صافي الربح,-2489.5'), exp.slice(-8).join(' | '));
  assert.ok(exp.includes('إجمالي الربح,1010.5'));
  assert.ok(exp.includes('الخصومات,50'));
  // No Arabic-Indic digit anywhere: every number stays machine-readable.
  assert.ok(!ARABIC_INDIC.test(csv), 'Latin digits only');
  assert.ok(!/ج\.م|EGP/.test(csv), 'no currency in the cells');
});

test('Accounts CSV: English (the default and from the English dashboard) uses the dashboard\'s words too', () => {
  for (const csv of [accounting.reportCsv(REPORT, nameOf), accounting.reportCsv(REPORT, nameOf, { lang: 'en' }), accounting.reportCsv(REPORT, nameOf, { lang: 'fr' })]) {
    const r = rows(csv);
    assert.strictEqual(r[0][0], 'Order');
    assert.strictEqual(r[1][3], 'not shipped yet');
    assert.strictEqual(r[1][5], 'Classic T-Shirt + Mug');
    assert.ok(csv.includes(',shipped,'));
    assert.ok(csv.includes(',2026-11-22,Materials & blanks,'));
    assert.ok(csv.includes('Net profit,'));
    assert.ok(!ARABIC_INDIC.test(csv.replace(/خامات 50 تيشيرت|منى عادل/g, '')));
  }
});

/** The Accounts CSV as the dashboard downloads it (x-lang: the dashboard's language), from a shop with one expense. */
async function accountsCsv(langs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-acc-csv-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner-pass' }) })).json()).token;
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.strictEqual((await fetch(`${base}/api/admin/expenses`, { method: 'POST', headers: h, body: JSON.stringify({ date: '2026-11-22', amount: 120, category: 'materials', description: 'ink' }) })).status, 201);
    const out = {};
    for (const lang of langs) {
      const r = await fetch(`${base}/api/admin/accounts.csv?from=2026-11-01&to=2026-11-30`, { headers: { Authorization: `Bearer ${token}`, 'x-lang': lang } });
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/csv/);
      out[lang] = Buffer.from(await r.arrayBuffer());
    }
    return out;
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('Accounts CSV: the route answers a CSV in either language (BOM, numbers in 0-9)', async () => {
  const got = await accountsCsv(['en', 'ar']);
  for (const bytes of Object.values(got)) {
    const text = bytes.toString('utf8');
    assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && text.includes(',2026-11-22,') && text.includes(',120'), text);
    assert.ok(!ARABIC_INDIC.test(text));
  }
});

// (Needs the route in src/app.js to pass the dashboard's language: accounting.reportCsv(r, nameOf, { lang: langOf(req) }).)
test('Accounts CSV: the route follows the dashboard\'s language', async () => {
  const got = await accountsCsv(['ar', 'en']);
  const ar = got.ar.toString('utf8');
  assert.ok(ar.includes(',2026-11-22,خامات ومنتجات,ink,120') && ar.includes('صافي الربح,-120'), ar);
  assert.ok(got.en.toString('utf8').includes(',2026-11-22,Materials & blanks,ink,120'));
});

// ---------- 2. Customers' passwords ----------
const ME = { name: 'Mostafa Ali', phone: '01155554441', email: 'mostafa.ali@gmail.com' };

test('customer passwords: the common ones are refused, in any digits (the team\'s list, src/passwords.js)', () => {
  for (const pw of ['12345678', '123456789', '1234567890', '87654321', '١٢٣٤٥٦٧٨', '۱۲۳۴۵۶۷۸', 'password', 'Password1', 'password2024', 'qwerty123', 'iloveyou', '11111111', 'aaaaaaaa', 'abababab', 'abcdefgh', '1q2w3e4r', '1qaz2wsx', 'admin123', 'ebda3123', 'football']) {
    assert.strictEqual(customers.passwordProblem(pw, ME), 'acctPasswordCommon', pw);
  }
  // Ordinary ones still do.
  for (const pw of ['ahmed2024', 'mona1234', 'nile-river-9', 'longenough1', 'a-long-password-1', '73915284', 'شمس القاهرة']) {
    assert.strictEqual(customers.passwordProblem(pw, ME), null, pw);
  }
  assert.strictEqual(customers.passwordProblem('1234567', ME), 'acctPasswordShort');
  assert.strictEqual(customers.passwordProblem('x'.repeat(201), ME), 'acctPasswordLong');
  // One list for both: what the team may not use, customers may not either.
  for (const pw of passwords.COMMON_PASSWORDS) assert.notStrictEqual(customers.passwordProblem(pw, null), null, pw);
  assert.strictEqual(passwords.staffPassword('qwerty12345', { username: 'sara', name: 'Sara' }), false);
  assert.strictEqual(passwords.staffPassword('mostafa.ali', { username: 'mostafa.ali', name: 'Mostafa' }), false);
  assert.strictEqual(passwords.staffPassword('Garden-of-Maadi-26', { username: 'sara', name: 'Sara' }), true);
});

test('customer passwords: not their own mobile number (any spelling), email or name', () => {
  for (const pw of ['01155554441', '011 5555 4441', '+201155554441', '+20 115 555 4441', '00201155554441', '٠١١٥٥٥٥٤٤٤١', '1155554441', '011-5555-4441']) {
    assert.strictEqual(customers.passwordProblem(pw, ME), 'acctPasswordPersonal', pw);
  }
  for (const pw of ['mostafa.ali@gmail.com', 'Mostafa.Ali@Gmail.com', 'mostafa.ali', 'Mostafa Ali', 'mostafaali', 'MOSTAFA_ALI']) {
    assert.strictEqual(customers.passwordProblem(pw, ME), 'acctPasswordPersonal', pw);
  }
  // Someone else's number is not theirs; an Arabic name too.
  assert.strictEqual(customers.passwordProblem('01299998887', ME), null);
  assert.strictEqual(customers.passwordProblem('محمود عبد الله', { name: 'محمود عبد الله', phone: '01012345678' }), 'acctPasswordPersonal');
  // At sign-up the fields typed are the account.
  assert.deepStrictEqual(customers.cleanSignup({ name: 'Mostafa Ali', phone: '01155554441', password: '01155554441' }), { error: 'acctPasswordPersonal' });
  assert.deepStrictEqual(customers.cleanSignup({ name: 'Mostafa Ali', phone: '+20 115 555 4441', email: 'm@x.co', password: 'm@x.co   ' }), { error: 'acctPasswordPersonal' });
  assert.deepStrictEqual(customers.cleanSignup({ name: 'Mostafa Ali', phone: '01155554441', password: '12345678' }), { error: 'acctPasswordCommon' });
  assert.ok(customers.cleanSignup({ name: 'Mostafa Ali', phone: '01155554441', password: 'nile-river-9' }).fields);
});

test('customer passwords: the API refuses them at sign-up, change and reset, in both languages; old ones still sign in', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cust-pw-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    // The QA case: the mobile number as the password, and "12345678".
    let r = await post('/api/account/signup', { name: 'Test', phone: '01155554441', password: '01155554441' }, { 'x-lang': 'ar' });
    assert.strictEqual(r.status, 400);
    let body = await r.json();
    assert.strictEqual(body.code, 'acctPasswordPersonal');
    assert.strictEqual(body.error, i18n.MESSAGES.acctPasswordPersonal.ar);
    assert.ok(!body.error.includes('محل'));
    r = await post('/api/account/signup', { name: 'Test', phone: '01155554441', password: '12345678' }, { 'x-lang': 'en' });
    body = await r.json();
    assert.deepStrictEqual([r.status, body.code, body.error], [400, 'acctPasswordCommon', i18n.MESSAGES.acctPasswordCommon.en]);
    r = await post('/api/account/signup', { name: 'Test', phone: '01155554441', password: '12345678' }, { 'x-lang': 'ar' });
    body = await r.json();
    assert.ok(/سهلة التخمين/.test(body.error) && body.error.includes('password1'), body.error);
    // A good one: in.
    r = await post('/api/account/signup', { name: 'Test', phone: '01155554441', email: 'test.person@example.com', password: 'nile-river-9' });
    assert.strictEqual(r.status, 201, await r.clone().text());
    const cookie = r.headers.get('set-cookie').split(';')[0];
    // Change: a common one is refused.
    r = await post('/api/account/password', { current: 'nile-river-9', password: '12345678' }, { cookie });
    assert.deepStrictEqual([r.status, (await r.json()).code], [400, 'acctPasswordCommon']);
    r = await post('/api/account/password', { current: 'nile-river-9', password: 'qwerty123' }, { cookie });
    assert.strictEqual(r.status, 400);
    for (const pw of ['01155554441', '+20 115 555 4441', 'test.person@example.com', 'test.person']) {
      r = await post('/api/account/password', { current: 'nile-river-9', password: pw }, { cookie, 'x-lang': 'ar' });
      assert.deepStrictEqual([r.status, (await r.json()).code], [400, 'acctPasswordPersonal'], pw);
    }
    // Reset (the shop's link): a common one is refused, a good one works.
    const store = app.locals.store;
    const cust = store.db.customers.find((c) => c.phone === '01155554441');
    const link = customers.resetToken(app.locals.auth.customerKey, cust, 24, 'a');
    r = await post('/api/account/reset', { token: link, password: '٠١١٥٥٥٥٤٤٤١' });
    assert.deepStrictEqual([r.status, (await r.json()).code], [400, 'acctPasswordPersonal']);
    r = await post('/api/account/reset', { token: link, password: 'password1' });
    assert.deepStrictEqual([r.status, (await r.json()).code], [400, 'acctPasswordCommon']);
    // An account made before this with such a password still signs in (and can change it).
    const old = customers.hashPassword('01099998888');
    store.mutate((db) => { db.customers.push({ id: 'old-weak', name: 'Old', phone: '01099998888', email: '', salt: old.salt, passHash: old.hash, pv: 1, createdAt: '2026-01-01T00:00:00Z' }); });
    r = await post('/api/account/login', { login: '01099998888', password: '01099998888' });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const oldCookie = r.headers.get('set-cookie').split(';')[0];
    r = await post('/api/account/password', { current: '01099998888', password: 'a-better-one-7' }, { cookie: oldCookie });
    assert.strictEqual(r.status, 200, await r.clone().text());
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---------- 3. Typed values keep their own digits on the Arabic pages ----------
const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
/** i18n.js (+ the admin roles' words) + common.js + admin-roles.js with just enough of a browser for them to load (as test/qa-misc3.test.js). */
function loadPOD(lang) {
  const store = { 'pod-lang': lang };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const document = { readyState: 'complete', documentElement: {}, body: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {}, getElementById: () => null };
  const window = { addEventListener() {} };
  const context = { window, document, localStorage, sessionStorage: localStorage, setTimeout() {}, clearTimeout() {}, CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } }, console };
  vm.runInNewContext(read('js/i18n.js'), context);
  vm.runInNewContext(read('js/i18n-admin-roles.js'), context);
  vm.runInNewContext(read('js/common.js'), context);
  vm.runInNewContext(read('js/admin-roles.js'), context);
  return window;
}

test('Arabic digits: a typed value inside FSI … PDI keeps its digits; the shop\'s numbers around it are Arabic-Indic', () => {
  const { POD, AdminRoles } = loadPOD('ar');
  const ar = (s) => POD.tr({ en: 'x', ar: s });
  // The QA cases, as the server will send them (each typed value wrapped).
  assert.strictEqual(ar(`الطلب 12 اتشحن، رقم التتبع ${FSI}7834512690${PDI}`), `الطلب ١٢ اتشحن، رقم التتبع ${FSI}7834512690${PDI}`);
  assert.strictEqual(ar(`مطبعة جديدة: ${FSI}مطبعة 01012345678${PDI}`), `مطبعة جديدة: ${FSI}مطبعة 01012345678${PDI}`);
  assert.strictEqual(ar(`كوبون جديد: ${FSI}2026${PDI} لـ 20 عميل`), `كوبون جديد: ${FSI}2026${PDI} لـ ٢٠ عميل`);
  assert.strictEqual(ar(`${FSI}BST-1234${PDI} و 5 قطع`), `${FSI}BST-1234${PDI} و ٥ قطع`);
  // Nested isolates (an LRI or another FSI inside): all of it stays; after the last PDI, Arabic again.
  assert.strictEqual(ar(`ملاحظة ${FSI}رقم \u2066${FSI}55${PDI} 66${PDI} 77${PDI} 88`), `ملاحظة ${FSI}رقم \u2066${FSI}55${PDI} 66${PDI} 77${PDI} ٨٨`);
  assert.strictEqual(ar(`${FSI}1 ${FSI}2${PDI} 3${PDI} 4 ${FSI}5${PDI} 6`), `${FSI}1 ${FSI}2${PDI} 3${PDI} ٤ ${FSI}5${PDI} ٦`);
  // An LRI alone is not a typed value: the shop's own "(+٩٧١…)"-style words keep their Arabic digits.
  assert.strictEqual(ar('\u2066300 جنيه\u2069'), '\u2066٣٠٠ جنيه\u2069');
  // One never closed ends with its line.
  assert.strictEqual(ar(`${FSI}12\n34`), `${FSI}12\n٣٤`);
  // Without isolates, as before.
  assert.strictEqual(POD.arabicDigits('السعر 250 ← 270'), 'السعر ٢٥٠ ← ٢٧٠');
  // English pages: nothing changes.
  const en = loadPOD('en').POD;
  assert.strictEqual(en.tr({ en: `Coupon ${FSI}2026${PDI}: 20%`, ar: 'x' }), `Coupon ${FSI}2026${PDI}: 20%`);
  // The admin screens read summaries through AdminRoles.inLang (activity log, approvals): the same.
  assert.strictEqual(AdminRoles.inLang({ en: 'x', ar: `كوبون جديد: ${FSI}2026${PDI}` }), `كوبون جديد: ${FSI}2026${PDI}`);
  // A template's {param} filled with a typed value: the value as typed, the template's digits Arabic.
  assert.ok(POD.t('ap.ownerNote', { note: `${FSI}رقم 7788${PDI}` }).includes(`${FSI}رقم 7788${PDI}`));
});

test('a line\'s direction skips its typed values (what the admin lists use instead of dir="auto")', () => {
  const { POD } = loadPOD('ar');
  assert.strictEqual(POD.textDir(`${FSI}BST-1234${PDI} اتشحن`), 'rtl');
  assert.strictEqual(POD.textDir(`${FSI}مطبعة 0101${PDI} added`), 'ltr');
  assert.strictEqual(POD.textDir(`${FSI}a ⁦b${PDI} c${PDI} نعم`), 'rtl');
  assert.strictEqual(POD.textDir('Classic T-Shirt: price 250'), 'ltr');
  assert.strictEqual(POD.textDir('٢٥٠ ← 270 السعر'), 'rtl');
  // Nothing to go by (only a typed value, or numbers): the page's direction.
  assert.strictEqual(POD.textDir(`${FSI}BST-1234${PDI}`), 'rtl');
  assert.strictEqual(loadPOD('en').POD.textDir(`${FSI}مطبعة${PDI} 15`), 'ltr');
});

test('Arabic digits on the server too (messages, notices): the same rule for FSI … PDI', () => {
  assert.strictEqual(i18n.arabicDigits(`كوبون ${FSI}2026${PDI} بخصم 20`), `كوبون ${FSI}2026${PDI} بخصم ٢٠`);
  assert.strictEqual(i18n.arabicDigits('الطلب 1001'), 'الطلب ١٠٠١');
  // A bilingual param holding a typed value.
  assert.ok(i18n.format('approvalDecidedBy', { name: { en: 'x', ar: `${FSI}مطبعة 0101${PDI}` } }, 'ar').includes(`${FSI}مطبعة 0101${PDI}`));
});
