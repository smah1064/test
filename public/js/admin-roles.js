/*
 * Admin → roles and approvals: who may see and do what, and what happens to a change that waits for an owner.
 *
 * The server's session (POST /api/admin/login, GET /api/admin/session) says { roles, perms, name, shown,
 * emergency, pendingApprovals, myPending }. Older answers have no perms: the owner's ({ role: 'owner' } or no
 * role) can do everything, a product manager's ({ role: 'products' }) is the catalogue as before.
 * A change a non-owner makes to products or money answers HTTP 202 { pending: true, approval: { id, summary } }:
 * settle() turns that answer into an error marked `pending` (so no caller takes it for the saved thing), says
 * "Sent to an owner for approval" once, in a neutral toast, and tells the page (onPending) to count it.
 *
 * Pure helpers, loaded after common.js and before the admin screens (tested in test/admin-roles.test.js).
 */
window.AdminRoles = (() => {
  'use strict';

  const ROLES = ['owner', 'finance', 'operations', 'catalogue'];
  const PERMS = [
    'orders.view', 'orders.amounts', 'orders.work', 'review.view', 'review.work', 'production', 'files',
    'houses.view', 'houses.edit', 'customers.view', 'customers.contact', 'rights', 'catalog.view', 'catalog.edit',
    'library.view', 'library.edit', 'uploads', 'accounts.view', 'costs.edit', 'expenses.edit', 'coupons.view',
    'coupons.edit', 'payments', 'prices.edit', 'staff', 'preview', 'settings', 'approvals', 'activity.all',
  ];
  /** What each role is for (the server's list decides; this is for the words on the Staff tab and old sessions). */
  const ROLE_PERMS = {
    owner: PERMS.slice(),
    finance: ['accounts.view', 'costs.edit', 'expenses.edit', 'coupons.view', 'coupons.edit', 'orders.view', 'orders.amounts', 'payments'],
    operations: ['production', 'files', 'houses.view', 'houses.edit', 'review.view', 'review.work', 'orders.view', 'orders.work', 'customers.view', 'rights'],
    catalogue: ['catalog.view', 'catalog.edit', 'library.view', 'library.edit', 'uploads'],
  };
  /** A product manager's sign-in from before roles (the old server lets them use the catalogue routes only). */
  const LEGACY_PRODUCTS = ['catalog.view', 'catalog.edit', 'library.view', 'library.edit', 'uploads'];
  /** The tabs, in their order on the page, and the permission each needs. */
  const TAB_PERM = {
    queue: 'production', review: 'review.view', orders: 'orders.view', film: 'production', library: 'library.view',
    houses: 'houses.view', accounts: 'accounts.view', coupons: 'coupons.view', customers: 'customers.view',
    products: 'catalog.view', preview: 'preview', rights: 'rights', staff: 'staff', approvals: null, activity: null,
  };
  const TABS = Object.keys(TAB_PERM);

  const count = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  /**
   * Who is signed in, from the server's session or sign-in answer: { system, roles, perms (a Set), owner,
   * emergency, id, name, shown, pendingApprovals, myPending, weakPassword }. `system` is false for an answer
   * from before roles (no perms list): then the owner has every permission and a product manager the catalogue.
   */
  function access(s, fallbackName = '') {
    const a = s && typeof s === 'object' ? s : {};
    const system = Array.isArray(a.perms);
    let roles = Array.isArray(a.roles) ? a.roles.filter((r) => ROLES.includes(r)) : [];
    let perms;
    if (system) perms = new Set(a.perms.filter((p) => typeof p === 'string'));
    else if (a.role === 'products') {
      perms = new Set(LEGACY_PRODUCTS);
      roles = ['catalogue'];
    } else if (!a.role || a.role === 'owner') {
      perms = new Set(PERMS);
      roles = ['owner'];
    } else perms = new Set();
    // Owners can do everything (and only they approve).
    const owner = roles.includes('owner') || perms.has('approvals');
    if (owner) {
      PERMS.forEach((p) => perms.add(p));
      if (!roles.includes('owner')) roles.unshift('owner');
    }
    const name = typeof a.name === 'string' ? a.name : '';
    return {
      system,
      roles,
      perms,
      owner,
      emergency: a.emergency === true,
      id: typeof a.id === 'string' ? a.id : '',
      name: name || fallbackName,
      shown: (typeof a.shown === 'string' && a.shown) || name || fallbackName,
      pendingApprovals: count(a.pendingApprovals),
      myPending: count(a.myPending),
      weakPassword: a.weakPassword === true,
    };
  }
  const can = (acc, perm) => Boolean(acc && acc.perms && acc.perms.has(perm));
  /** May this person see the tab? Staff, Approvals and Activity log need the server with roles. */
  function tabAllowed(acc, tab) {
    if (!acc || !(tab in TAB_PERM)) return false;
    if (tab === 'approvals' || tab === 'activity') return acc.system;
    if (tab === 'staff') return acc.system && can(acc, 'staff');
    return can(acc, TAB_PERM[tab]);
  }
  const tabsFor = (acc) => TABS.filter((tab) => tabAllowed(acc, tab));
  /** Where each role starts: the print queue (owners, Operations), Accounts (Finance), Products (Catalogue). */
  const LANDING = ['queue', 'accounts', 'products', ...TABS];
  /** The tab to show: the one wanted when allowed, else where this person starts. */
  const pickTab = (acc, wanted) => (tabAllowed(acc, wanted) ? wanted : LANDING.find((tab) => tabAllowed(acc, tab)) || null);
  /** The number on the Approvals tab: everyone's waiting changes for an owner, their own for the others. */
  const badgeCount = (acc) => (!acc || !acc.system ? 0 : acc.owner ? acc.pendingApprovals : acc.myPending);

  // ---------- Amounts the server may leave out (Operations never gets prices, totals, costs or profit) ----------
  /** A money value that is really there (a number, or a number as text): never shown as "EGP NaN". */
  const isAmount = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  /** Does any row of the list carry this amount? (Its column is shown only then.) */
  const anyAmount = (list, field) => Array.isArray(list) && list.some((x) => x && isAmount(x[field]));

  // ---------- A change waiting for an owner's approval ----------
  const isPending = (body) => Boolean(body && typeof body === 'object' && body.pending === true && body.approval && typeof body.approval === 'object');
  const isPendingError = (e) => Boolean(e && e.pending === true);
  /** A { en, ar } text in the page's language (Arabic digits on the Arabic page, as the shop's own texts). */
  function inLang(v, lang) {
    if (v == null) return '';
    if (typeof v !== 'object') return String(v);
    if (window.POD && window.POD.tr && !lang) return window.POD.tr(v);
    const L = lang || (window.POD && window.POD.lang) || 'ar';
    return String(v[L] || v.en || v.ar || '');
  }
  const t = (k, p) => (window.POD && window.POD.t ? window.POD.t(k, p) : k);
  /** "Sent to an owner for approval: {summary}" for this approval. */
  const pendingText = (approval) => t('ap.sent', { summary: inLang(approval && approval.summary) || t('ap.aChange') });
  const said = new Map(); // message -> when it was said (a caller's red toast with the same words is left out)
  let hook = null;
  /** Neutral toast (not red), shown a little longer than the usual one: the summary can be long. */
  function neutralToast(message) {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-pending';
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
  /** The error a waiting change becomes: { pending: true, status: 202, approval }, its message the toast's words. */
  function pendingError(approval) {
    const err = new Error(pendingText(approval));
    err.pending = true;
    err.status = 202;
    err.code = 'pendingApproval';
    err.approval = approval;
    return err;
  }
  /** Say it once (toast, then the page's hook: the "My requests" badge). */
  function announce(err) {
    if (!err || err.announced) return err;
    err.announced = true;
    said.set(err.message, Date.now());
    if (typeof document !== 'undefined') neutralToast(err.message);
    if (hook) {
      try { hook(err.approval); } catch (e) { /* the badge waits for the next refresh */ }
    }
    return err;
  }
  /**
   * Every admin request's answer goes through here: the answer itself, or (HTTP 202 pending) an error
   * marked `pending` after saying it was sent for approval. The form stays as typed: the change isn't live.
   */
  function settle(body) {
    if (!isPending(body)) return body;
    throw announce(pendingError(body.approval));
  }
  const onPending = (fn) => { hook = typeof fn === 'function' ? fn : null; };
  /** A red toast with words just said as "sent for approval" (a caller that didn't look for `pending`): left out. */
  const wasSaid = (message) => {
    const at = said.get(message);
    return Boolean(at && Date.now() - at < 10000);
  };
  if (window.POD && typeof window.POD.toast === 'function' && !window.POD.toast.rolesAware) {
    const base = window.POD.toast;
    const toast = (message, type) => (type === 'error' && wasSaid(message) ? undefined : base(message, type));
    toast.rolesAware = true;
    window.POD.toast = toast;
  }

  // ---------- Times and the activity log ----------
  /** A moment in Cairo's time, in the page's language and digits: "25 Nov 2026, 14:05" / «٢٥ نوفمبر ٢٠٢٦، ٢:٠٥ م». */
  function cairoTime(iso, lang = (window.POD && window.POD.lang) || 'ar') {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return d.toISOString();
    }
  }
  /** The day (YYYY-MM-DD) a moment falls on in Cairo. */
  function cairoDay(when = new Date()) {
    const d = when instanceof Date ? when : new Date(when);
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }
  /** What a logged request's HTTP status means: done, sent for approval, refused (4xx) or failed. */
  function resultOf(status) {
    const n = Number(status);
    if (n === 202) return 'pending';
    if (n >= 200 && n < 300) return 'ok';
    if (n >= 400 && n < 500) return 'refused';
    return 'failed';
  }
  /** One CSV cell: quoted when needed; a leading = + - @ can't start a spreadsheet formula. */
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  /** Rows (arrays) as CSV text, with a byte-order mark so a spreadsheet reads the Arabic right. */
  const toCsv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  /**
   * The activity log as CSV rows, newest first as shown: a header (labels in the page's language), then one row
   * per entry. `words` gives the labels and the words for a result and a role.
   */
  function activityRows(entries, { lang = 'en', labels, result, role } = {}) {
    const L = labels || ['When (Cairo)', 'Time (UTC)', 'Who', 'Roles', 'What', 'Result', 'HTTP', 'Method', 'Path', 'Approval', 'Emergency login'];
    const rows = [L];
    for (const e of entries || []) {
      rows.push([
        cairoTime(e.at, lang),
        e.at || '',
        (e.who && e.who.name) || '',
        (e.roles || []).map((r) => (role ? role(r) : r)).join(lang === 'ar' ? '، ' : ', '),
        inLang(e.summary, lang) || e.action || '',
        result ? result(e.outcome === 'failed' ? 'failed' : resultOf(e.status)) : e.outcome === 'failed' ? 'failed' : resultOf(e.status),
        e.status == null ? '' : String(e.status),
        e.method || '',
        e.path || '',
        e.approvalId || '',
        e.emergency ? (lang === 'ar' ? 'نعم' : 'yes') : '',
      ]);
    }
    return rows;
  }

  return {
    ROLES, PERMS, ROLE_PERMS, LEGACY_PRODUCTS, TAB_PERM, TABS,
    access, can, tabAllowed, tabsFor, pickTab, badgeCount,
    isAmount, anyAmount,
    isPending, isPendingError, pendingText, pendingError, settle, announce, onPending, wasSaid, inLang,
    cairoTime, cairoDay, resultOf, csvCell, toCsv, activityRows,
  };
})();
