'use strict';

// Admin → roles and approvals (public/js/admin-roles.js and the screens that use it): which tabs each person sees,
// a staff member's change that waits for an owner (HTTP 202 pending) never taken for the saved thing, amounts
// the server leaves out for Operations, the activity log's CSV, and the words in both languages.
// No server, no browser: the page's own files run in a sandbox.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

/** A tiny document: enough for the toasts (#toast-root and its children). */
function fakeDocument() {
  const byId = {};
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, className: '', textContent: '', id: '', dataset: {}, style: {},
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); c.parent = this; if (c.id) byId[c.id] = c; return c; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    };
    return el;
  };
  const body = make('body');
  return {
    body,
    readyState: 'complete',
    title: '',
    documentElement: { style: {}, dataset: {} },
    createElement: make,
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
  };
}

/** The admin page's strings and helpers, as the page loads them: i18n, common.js, then admin-roles.js. */
function page(lang = 'en') {
  const document = fakeDocument();
  const window = { addEventListener() {}, scrollTo() {}, scrollY: 0 };
  window.window = window;
  const ctx = {
    window, document, console, Intl, Date, URL,
    localStorage: { getItem: (k) => (k === 'pod-lang' ? lang : null), setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://ebda3.example', pathname: '/admin', search: '', href: '' },
    navigator: {},
    URLSearchParams,
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 0,
    clearTimeout() {},
    CustomEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
  };
  vm.createContext(ctx);
  for (const f of ['js/i18n.js', 'js/i18n-admin-shipping.js', 'js/i18n-admin-roles.js', 'js/common.js', 'js/admin-roles.js']) vm.runInContext(read(f), ctx, { filename: f });
  return { R: window.AdminRoles, POD: window.POD, S: window.POD_STRINGS, document, ctx };
}

const { R } = page('en');
/** A value from the page's sandbox as a plain one of this realm (for deepStrictEqual). */
const plain = (x) => JSON.parse(JSON.stringify(x));
const ROLE_PERMS = R.ROLE_PERMS;
const sess = (roles, extra = {}) => ({ ok: true, roles, perms: [...new Set(roles.flatMap((r) => ROLE_PERMS[r]))], ...extra });

// ---------- Who sees which tab ----------
test('tabs follow the permissions: each role sees its own, everyone the Approvals and Activity tabs', () => {
  const tabs = (s) => plain(R.tabsFor(R.access(s)));
  assert.deepStrictEqual(tabs(sess(['owner'])), ['queue', 'review', 'orders', 'film', 'library', 'houses', 'accounts', 'coupons', 'customers', 'products', 'preview', 'rights', 'staff', 'approvals', 'activity']);
  assert.deepStrictEqual(tabs(sess(['finance'])), ['orders', 'accounts', 'coupons', 'approvals', 'activity']);
  assert.deepStrictEqual(tabs(sess(['operations'])), ['queue', 'review', 'orders', 'film', 'houses', 'customers', 'rights', 'approvals', 'activity']);
  // (Catalogue has no Review: customers' proofs are Operations' work, as on the server.)
  assert.deepStrictEqual(tabs(sess(['catalogue'])), ['library', 'products', 'approvals', 'activity']);
  // Several roles: everything each of them has.
  assert.deepStrictEqual(tabs(sess(['finance', 'catalogue'])), ['orders', 'library', 'accounts', 'coupons', 'products', 'approvals', 'activity']);
  // The tab each starts on.
  assert.strictEqual(R.pickTab(R.access(sess(['finance'])), 'queue'), 'accounts');
  assert.strictEqual(R.pickTab(R.access(sess(['catalogue'])), 'queue'), 'products');
  assert.strictEqual(R.pickTab(R.access(sess(['operations'])), 'accounts'), 'queue');
  assert.strictEqual(R.pickTab(R.access(sess(['catalogue'])), 'library'), 'library', 'the tab asked for, when theirs');
  assert.strictEqual(R.tabAllowed(null, 'queue'), false, 'nobody signed in: no tab');
});

test('an answer from before roles (no perms): the owner can do everything, a product manager the catalogue', () => {
  const owner = R.access({ ok: true, role: 'owner', weakPassword: true });
  assert.deepStrictEqual(plain([owner.system, owner.owner, owner.roles, owner.perms.size, owner.weakPassword]), [false, true, ['owner'], R.PERMS.length, true]);
  // The old owner's sign-in answer names no role at all.
  assert.strictEqual(R.access({ token: 'x' }).owner, true);
  // Without the new server there is no Staff, Approvals or Activity tab (its routes don't exist yet).
  assert.deepStrictEqual(plain(R.tabsFor(owner)), ['queue', 'review', 'orders', 'film', 'library', 'houses', 'accounts', 'coupons', 'customers', 'products', 'preview', 'rights']);
  const pm = R.access({ ok: true, role: 'products', name: 'mostafa', shown: 'Mostafa مصطفى' }, 'mostafa');
  assert.deepStrictEqual(plain([pm.owner, pm.roles, R.tabsFor(pm)]), [false, ['catalogue'], ['library', 'products']]);
  assert.ok(!R.tabsFor(pm).includes('rights') && !R.tabsFor(pm).includes('review'), 'the old server answers 401 there (it would sign them out)');
  // The person's own name, not the username (as the header showed it before).
  assert.strictEqual(pm.shown, 'Mostafa مصطفى');
  assert.strictEqual(R.access({ role: 'products', name: 'mostafa' }).shown, 'mostafa');
  assert.strictEqual(R.access({ role: 'products' }, 'mostafa').shown, 'mostafa', 'the username typed, when the answer has no name');
  // A role the page doesn't know: nothing.
  assert.deepStrictEqual(plain(R.tabsFor(R.access({ role: 'stranger' }))), []);
});

test('owners get every permission; the emergency login is marked; the badge counts the right thing', () => {
  const o = R.access({ roles: ['owner'], perms: ['orders.view'], emergency: true, pendingApprovals: 3, myPending: 1, name: 'owner' });
  assert.deepStrictEqual([o.system, o.owner, o.emergency, o.perms.size], [true, true, true, R.PERMS.length]);
  assert.strictEqual(R.badgeCount(o), 3, 'owners: everyone\'s changes waiting');
  // "approvals" is the owner's (a session naming no role but able to approve is an owner's).
  assert.strictEqual(R.access({ perms: ['approvals'] }).owner, true);
  const f = R.access(sess(['finance'], { pendingApprovals: 9, myPending: 2 }));
  assert.deepStrictEqual([f.owner, f.emergency, R.badgeCount(f)], [false, false, 2], 'the others: their own requests');
  assert.ok(R.can(f, 'orders.amounts') && R.can(f, 'payments') && !R.can(f, 'orders.work'));
  const ops = R.access(sess(['operations']));
  assert.ok(!R.can(ops, 'orders.amounts') && !R.can(ops, 'accounts.view') && !R.can(ops, 'prices.edit'), 'Operations never sees money');
  const cat = R.access(sess(['catalogue']));
  assert.ok(!R.can(cat, 'review.view') && !R.can(cat, 'review.work') && !R.can(cat, 'prices.edit'), 'Catalogue: no Review, prices read-only');
  // The page's list is the server's (src/roles.js), role by role.
  const server = require('../src/roles').ROLE_PERMS;
  for (const r of R.ROLES) assert.deepStrictEqual([...R.ROLE_PERMS[r]].sort(), [...server[r]].sort(), r);
  assert.strictEqual(R.badgeCount(R.access({ role: 'owner' })), 0, 'no badge without the new server');
  assert.strictEqual(R.access({ perms: [], pendingApprovals: -1, myPending: 'x' }).myPending, 0);
});

// ---------- Amounts left out ----------
test('amounts: only real numbers are shown; a column only when some row has the amount', () => {
  for (const v of [0, 12.5, -3, '450', ' 7 ']) assert.strictEqual(R.isAmount(v), true, String(v));
  for (const v of [undefined, null, '', 'abc', NaN, Infinity, {}, []]) assert.strictEqual(R.isAmount(v), false, String(v));
  assert.strictEqual(R.anyAmount([{ id: 1 }, { id: 2, total: 300 }], 'total'), true);
  assert.strictEqual(R.anyAmount([{ id: 1 }, { id: 2 }], 'total'), false);
  assert.strictEqual(R.anyAmount(null, 'total'), false);
});

/** A function from admin.js, run on its own with the page's helpers. */
function grab(src, re, name, ctx) {
  const m = src.match(re);
  assert.ok(m, name);
  return vm.runInNewContext(`${m[0]}\n${name}`, ctx);
}
test('the print queue\'s payment lines: amounts when the answer has them, never "EGP NaN" without', () => {
  const { POD } = page('en');
  const ADMIN = read('js/admin.js');
  const payLines = grab(ADMIN, / {2}function payLines\(item\) \{[\s\S]*?\n {2}\}\n/, 'payLines', { POD, esc: POD.esc, t: POD.t, money: POD.money, SEP: () => ' · ', AdminRoles: R });
  const cod = { payment: { method: 'cod', status: 'pending' }, coupon: { code: 'EID20', discount: 50 }, orderTotal: 450 };
  assert.match(payLines(cod), /collect EGP\s?450/);
  assert.match(payLines(cod), /EID20<\/bdi> · -EGP\s?50/);
  // Operations: the server leaves the amounts out.
  const none = payLines({ payment: { method: 'cod', status: 'pending' }, coupon: { code: 'EID20' } });
  assert.doesNotMatch(none, /NaN|EGP|undefined/);
  assert.match(none, /Cash on delivery/);
  assert.match(none, /EID20<\/bdi><\/dd>/);
  const paid = payLines({ payment: { method: 'cod', status: 'paid' } });
  assert.match(paid, /pay-paid/);
  assert.doesNotMatch(paid, /NaN|EGP|nothing to collect/);
  assert.strictEqual(payLines({}), '');
  // The orders table and the customers list look for the amounts the same way.
  assert.match(ADMIN, /const totals = orders\.length \? AdminRoles\.anyAmount\(orders, 'total'\) : can\('orders\.amounts'\);/);
  assert.match(ADMIN, /\$\('orders-total-col'\)\.hidden = !totals;/);
  assert.match(ADMIN, /AdminRoles\.isAmount\(c\.spent\) \? t\('cu\.orders'/);
  assert.match(ADMIN, /can\('orders\.amounts'\) \? `<a class="btn btn-sm" href="\/invoice/, 'the invoice (amounts) only for those who see amounts');
});

// ---------- A change waiting for an owner ----------
test('HTTP 202 pending: an error marked pending, said once in a neutral toast, the badge told; other answers pass', () => {
  const { R: R2, POD, document } = page('en');
  const seen = [];
  R2.onPending((a) => seen.push(a.id));
  const saved = { id: 'mug', name: { en: 'Mug' } };
  assert.strictEqual(R2.settle(saved), saved, 'the usual answer is the saved thing');
  assert.strictEqual(R2.settle(null), null);
  assert.deepStrictEqual(plain(R2.settle({ pending: 'yes', approval: {} })), { pending: 'yes', approval: {} }, 'only pending: true with an approval');
  let err = null;
  try {
    R2.settle({ pending: true, approval: { id: 'ap1', summary: { en: 'Mug: price 250 → 270', ar: 'المج: السعر ٢٥٠ ← ٢٧٠' } } });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'never returned as the saved thing');
  assert.deepStrictEqual([err.pending, err.status, err.code, err.approval.id], [true, 202, 'pendingApproval', 'ap1']);
  assert.strictEqual(err.message, 'Sent to an owner for approval: Mug: price 250 → 270');
  assert.strictEqual(R2.isPendingError(err), true);
  assert.strictEqual(R2.isPendingError(new Error('x')), false);
  assert.deepStrictEqual(seen, ['ap1'], 'the badge hook, once');
  const root = document.getElementById('toast-root');
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(root.children[0].className, 'toast toast-pending', 'neutral, not red');
  assert.strictEqual(root.children[0].textContent, err.message);
  // A caller that didn't look for `pending` and shows its message as an error: left out (said already).
  POD.toast(err.message, 'error');
  assert.strictEqual(root.children.length, 1);
  POD.toast('Something else went wrong', 'error');
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(root.children[1].className, 'toast error');
  // Announced twice (an error passed along): said once.
  R2.announce(err);
  assert.strictEqual(root.children.length, 2);
  assert.deepStrictEqual(seen, ['ap1']);
});

test('the pending words in Arabic, with the summary in Arabic (no summary: "your change")', () => {
  const { R: R2 } = page('ar');
  assert.strictEqual(R2.pendingText({ summary: { en: 'Coupon EID20', ar: 'كوبون EID20' } }), 'اتبعت لصاحب الموقع للموافقة: كوبون EID20');
  assert.strictEqual(R2.pendingText({}), 'اتبعت لصاحب الموقع للموافقة: التعديل بتاعك');
  // Arabic digits in the shop's own Arabic texts, as everywhere.
  assert.strictEqual(R2.inLang({ en: 'Price 250', ar: 'السعر 250' }), 'السعر ٢٥٠');
});

test('every admin request goes through settle(): no screen takes a 202 answer for the saved thing', () => {
  const ADMIN = read('js/admin.js');
  assert.match(ADMIN, /return AdminRoles\.settle\(body\);/);
  // The other screens use admin.js's adminApi (ctx.api / cfg.api / api).
  assert.match(ADMIN, /AdminProducts\.init\(\{ api: adminApi,/);
  assert.match(ADMIN, /AdminPreview\.init\(\{ api: adminApi \}\)/);
  assert.match(ADMIN, /AdminUploads\.init\(\{\s*api: adminApi,/);
  // The zip upload's own requests (XHR) look for it too.
  const UP = read('js/admin-uploads.js');
  assert.match(UP, /if \(window\.AdminRoles && AdminRoles\.isPending\(body\)\) \{/);
  assert.match(UP, /if \(err\.pending\) return say\(\(\) => AdminRoles\.pendingText\(err\.approval\), false\);/);
  // Products: a section sent for approval keeps what was typed (it stays unsaved), and a dialog closes.
  const PM = read('js/admin-products.js');
  // (A section sent for approval is no longer "unsaved": Save isn't offered again for the same request, QA admin tester 4.)
  assert.match(PM, /if \(sentForApproval\(e\)\) \{\s*setDirty\(name, false\);\s*if \(btn\) btn\.disabled = true;\s*return;\s*\}\s*secError\(name, e\.message\);/);
  assert.match(PM, /if \(sentForApproval\(ex\)\) return void d\.close\(\);/);
  // The page loads the helpers after common.js and before the screens.
  const html = read('admin.html');
  const at = (f) => html.indexOf(`<script src="/js/${f}"></script>`);
  assert.ok(at('i18n-admin-roles.js') > 0 && at('i18n-admin-roles.js') < at('common.js'));
  assert.ok(at('admin-roles.js') > at('common.js') && at('admin-roles.js') < at('admin-products.js'));
  for (const f of ['admin-staff.js', 'admin-approvals.js', 'admin-activity.js']) assert.ok(at(f) > at('admin-roles.js') && at(f) < at('admin.js'), f);
  assert.match(html, /<link rel="stylesheet" href="\/css\/admin-roles\.css">/);
});

// ---------- Sign-in, header, tabs ----------
test('the sign-in form always has the username box, and says to leave it empty for the emergency owner login', () => {
  const html = read('admin.html');
  assert.match(html, /<div class="field" id="username-field"><label for="username" data-i18n="login\.username"><\/label><input type="text" id="username" autocomplete="username"/);
  assert.match(html, /id="login-hint" data-i18n="login\.hint"/);
  assert.doesNotMatch(html, /staff-toggle/);
  assert.match(html, /<p class="notice me-emergency" id="emergency-bar" role="note" hidden data-i18n="me\.emergency"><\/p>/);
  assert.match(html, /<button class="btn btn-sm btn-block" type="button" id="me-pw" hidden data-i18n="me\.changePw"><\/button>/);
  for (const tab of ['staff', 'approvals', 'activity']) {
    assert.match(html, new RegExp(`data-tab="${tab}" hidden`), tab);
    assert.match(html, new RegExp(`<section id="tab-${tab}" hidden></section>`), tab);
  }
  assert.match(html, /<form class="card login" id="setup" hidden novalidate>/);
  const ADMIN = read('js/admin.js');
  // No username: the shared owner password alone.
  assert.match(ADMIN, /body: JSON\.stringify\(username \? \{ username, password: \$\('password'\)\.value \} : \{ password: \$\('password'\)\.value \}\),/);
  assert.match(ADMIN, /\$\('me-pw'\)\.hidden = !\(access && access\.system && !access\.emergency\);/, 'not for the emergency login');
  assert.match(ADMIN, /\$\('emergency-bar'\)\.hidden = !\(access && access\.emergency\);/);
});

// ---------- Activity log ----------
test('activity: results from the HTTP status, Cairo time in the page\'s digits, CSV safe for spreadsheets', () => {
  assert.deepStrictEqual([200, 201, 204, 202, 400, 403, 409, 500, undefined].map(R.resultOf), ['ok', 'ok', 'ok', 'pending', 'refused', 'refused', 'refused', 'failed', 'failed']);
  // 25 Nov 2026 at 12:00 UTC is 14:00 in Cairo.
  assert.match(R.cairoTime('2026-11-25T12:00:00Z', 'en'), /25 Nov 2026.*14:00|25 Nov 2026.*2:00\s?pm/i);
  assert.match(R.cairoTime('2026-11-25T12:00:00Z', 'ar'), /٢٥/);
  assert.doesNotMatch(R.cairoTime('2026-11-25T12:00:00Z', 'ar'), /[0-9]/, 'Arabic digits on the Arabic page');
  assert.strictEqual(R.cairoTime('nonsense'), '');
  assert.strictEqual(R.cairoDay(new Date('2026-11-25T23:30:00Z')), '2026-11-26', 'the shop\'s day');
  assert.strictEqual(R.csvCell('plain'), 'plain');
  assert.strictEqual(R.csvCell('a,b'), '"a,b"');
  assert.strictEqual(R.csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(R.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'never a formula');
  assert.strictEqual(R.csvCell('-5'), "'-5");
  assert.strictEqual(R.csvCell(null), '');
  const entries = [
    { id: 'a1', at: '2026-11-25T10:00:00Z', who: { id: 'u1', name: 'Hala هالة' }, roles: ['finance'], action: 'coupon.update', summary: { en: 'Coupon EID20: 20% → 25%', ar: 'كوبون EID20: ٢٠٪ ← ٢٥٪' }, method: 'PUT', path: '/api/admin/coupons/c1', status: 202, approvalId: 'ap1' },
    { id: 'a2', at: '2026-11-25T09:00:00Z', who: { id: 'owner', name: 'Owner' }, roles: ['owner'], action: 'login', summary: { en: 'Signed in', ar: 'دخل' }, method: 'POST', path: '/api/admin/login', status: 200, emergency: true },
  ];
  const rows = plain(R.activityRows(entries, { lang: 'en', result: (r) => `R:${r}`, role: (r) => `role:${r}` }));
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[1].slice(1), ['2026-11-25T10:00:00Z', 'Hala هالة', 'role:finance', 'Coupon EID20: 20% → 25%', 'R:pending', '202', 'PUT', '/api/admin/coupons/c1', 'ap1', '']);
  assert.deepStrictEqual(rows[2].slice(5), ['R:ok', '200', 'POST', '/api/admin/login', '', 'yes']);
  const csv = R.toCsv(rows);
  assert.ok(csv.startsWith('﻿'), 'a byte-order mark: spreadsheets read the Arabic right');
  assert.strictEqual(csv.trim().split('\r\n').length, 3);
  const ar = R.activityRows(entries, { lang: 'ar' });
  assert.strictEqual(ar[1][4], 'كوبون EID20: ٢٠٪ ← ٢٥٪');
  assert.strictEqual(ar[2][10], 'نعم');
});

// ---------- Words ----------
test('the new words: both languages, the same placeholders, Egyptian Arabic, never "محل", no "·" by a number', () => {
  const { S } = page('ar');
  const src = read('js/i18n-admin-roles.js');
  const keys = [...src.matchAll(/^ {2}'([a-zA-Z.]+)':/gm)].map((m) => m[1]);
  assert.ok(keys.length > 120, String(keys.length));
  for (const k of keys) {
    const [en, ar] = plain(S[k]);
    assert.ok(en && ar, k);
    assert.deepStrictEqual((en.match(/\{\w+\}/g) || []).sort(), (ar.match(/\{\w+\}/g) || []).sort(), `${k}: same placeholders`);
    assert.doesNotMatch(ar, /محل|سيتم|يمكنك|لا يوجد|لا توجد|الآن|حاليًا|تعذر|جاري /, k);
    assert.doesNotMatch(ar, /[0-9٠-٩]\s*·|·\s*[0-9٠-٩]/, k);
    assert.doesNotMatch(en, /\w\(s\)/, k);
  }
  // The words the owner asked for.
  assert.deepStrictEqual(plain(S['ap.sent']), ['Sent to an owner for approval: {summary}', 'اتبعت لصاحب الموقع للموافقة: {summary}']);
  assert.deepStrictEqual(plain(S['staff.tab']), ['Staff & roles', 'الفريق والصلاحيات']);
  assert.deepStrictEqual(plain(S['ap.tab']), ['Approvals', 'الموافقات']);
  assert.deepStrictEqual(plain(S['ap.mine']), ['My requests', 'طلباتي']);
  assert.deepStrictEqual(plain(S['act.tab']), ['Activity log', 'سجل النشاط']);
  assert.deepStrictEqual(plain(S['login.username']), ['Username', 'اسم المستخدم']);
  assert.strictEqual(S['me.emergency'][0], 'Emergency owner login — every action is logged');
  assert.strictEqual(S['setup.done'][0], 'Done — sign in with your username {username}');
  for (const r of R.ROLES) assert.ok(S[`role.${r}`] && S[`role.${r}.help`], r);
  // Every role's description says what it can do (and Operations: no money).
  assert.match(S['role.operations.help'][0], /never sees prices, amounts, costs or profit/);
  assert.doesNotMatch(S['role.catalogue.help'][0], /Review/);
  // Only what really waits for an owner is said to (not printing houses or settings).
  for (const k of ['role.rule', 'ap.help']) assert.doesNotMatch(S[k][0], /printing houses or settings|houses and settings/, k);
});
