'use strict';

// ---------- Admin roles, permissions, owner approvals, activity log ----------
// Four roles (owner, finance, operations, catalogue); a person can hold several. Each admin route needs
// one permission (ROUTES below; a route not listed is the owner's). Catalogue and money changes made by
// anyone but an owner wait for an owner's approval: the request is kept as it was sent and run again,
// unchanged, inside the app when an owner approves it (`replay`). Daily order work happens at once and
// is written to the activity log, like every other change.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Duplex } = require('stream');

const PERMS = [
  'orders.view', 'orders.amounts', 'orders.work', 'review.view', 'review.work', 'production', 'files',
  'houses.view', 'houses.edit', 'customers.view', 'customers.contact', 'rights',
  'catalog.view', 'catalog.edit', 'library.view', 'library.edit', 'uploads',
  'accounts.view', 'costs.edit', 'expenses.edit', 'coupons.view', 'coupons.edit', 'payments',
  'prices.edit', 'staff', 'preview', 'settings', 'approvals', 'activity.all',
];
const ROLES = ['owner', 'finance', 'operations', 'catalogue'];
const ROLE_PERMS = {
  owner: PERMS,
  finance: ['orders.view', 'orders.amounts', 'payments', 'accounts.view', 'costs.edit', 'expenses.edit', 'coupons.view', 'coupons.edit'],
  // (A customer's password-reset link is the owners' alone: whoever holds it can sign in as the customer.)
  operations: ['orders.view', 'orders.work', 'review.view', 'review.work', 'production', 'files', 'houses.view', 'houses.edit', 'customers.view', 'rights'],
  // (Each role only what its work needs: customers' files and proofs are operations' work.)
  catalogue: ['catalog.view', 'catalog.edit', 'library.view', 'library.edit', 'uploads'],
};
const ROLE_NAMES = {
  owner: { en: 'Owner', ar: 'صاحب الموقع' },
  finance: { en: 'Finance', ar: 'الحسابات' },
  operations: { en: 'Operations', ar: 'التشغيل' },
  catalogue: { en: 'Catalogue', ar: 'المنتجات والتصميمات' },
};

/** A staff record's roles (older records: role 'products' = catalogue). */
function rolesOf(u) {
  if (!u) return [];
  const list = Array.isArray(u.roles) ? u.roles : u.role === 'products' ? ['catalogue'] : [u.role];
  return ROLES.filter((r) => list.includes(r));
}
/** Roles as sent by the dashboard: a non-empty list of known roles (null if anything else). */
function cleanRoles(v) {
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v) || !v.length || v.length > ROLES.length) return null;
  const list = v.map((r) => (r === 'products' ? 'catalogue' : r));
  if (!list.every((r) => ROLES.includes(r))) return null;
  return ROLES.filter((r) => list.includes(r));
}
const permsOf = (roles) => new Set(roles.flatMap((r) => ROLE_PERMS[r] || []));
/** The one role older screens and checks look at: 'owner' when the person is one. */
const mainRole = (roles) => (roles.includes('owner') ? 'owner' : roles[0] || 'none');

const L = (en, ar) => ({ en, ar });
// METHOD + route path -> what it needs. perm null: anyone signed in. approve: an owner approves it first
// (for everyone else). label: how it reads in the approvals list and the activity log.
const ROUTES = {
  'GET /api/admin/session': { perm: null },
  'GET /api/admin/approvals': { perm: null },
  'POST /api/admin/approvals/:id/approve': { perm: 'approvals', label: L('Approved a change', 'وافق على تعديل') },
  'POST /api/admin/approvals/:id/reject': { perm: 'approvals', label: L('Refused a change', 'رفض تعديل') },
  'DELETE /api/admin/approvals/:id': { perm: null, label: L('Withdrew a change', 'سحب تعديل') },
  'GET /api/admin/activity': { perm: null },
  'PUT /api/admin/me/password': { perm: null, noBody: true, label: L('Changed own password', 'غيّر كلمة السر بتاعته') },

  // Review (proofs a person checks) and orders
  'GET /api/admin/review': { perm: 'review.view' },
  'POST /api/admin/items/:itemId/review': { perm: 'review.work', label: L('Review decision', 'قرار مراجعة') },
  'PUT /api/admin/items/:itemId/replacement/:side': { perm: 'review.work', label: L('Replaced a print file', 'استبدل ملف طباعة') },
  'POST /api/admin/items/:itemId/resend-proof': { perm: 'review.work', label: L('Sent the proof again', 'بعت البروفة تاني') },
  'GET /api/admin/queue': { perm: 'orders.view' },
  'GET /api/admin/orders': { perm: 'orders.view' },
  'PATCH /api/admin/orders/:orderId/shipment': { perm: 'orders.work', label: L('Shipping details', 'بيانات الشحن') },
  'PATCH /api/admin/orders/:orderId/payment': { perm: 'payments', label: L('Payment status', 'حالة الدفع') },
  'POST /api/admin/items/:itemId/redraw': { perm: 'production', label: L('Redrew a book', 'أعاد رسم كتاب') },
  'PATCH /api/admin/items/:itemId': { perm: 'production', label: L('Job status', 'حالة الشغل') },
  'GET /api/admin/files/:designId/:side': { perm: 'files' },
  'POST /api/admin/items/:itemId/send': { perm: 'production', label: L('Sent a job to a printing house', 'بعت شغل لمطبعة') },
  'GET /api/admin/dtf-items': { perm: 'production' },
  'POST /api/admin/dtf-film': { perm: 'production', label: L('Made a DTF film sheet', 'عمل شيت DTF') },
  'GET /api/admin/houses': { perm: 'houses.view' },
  'POST /api/admin/houses': { perm: 'houses.edit', label: L('Added a printing house', 'أضاف مطبعة') },
  'PUT /api/admin/houses/:id': { perm: 'houses.edit', label: L('Changed a printing house', 'عدّل مطبعة') },
  'DELETE /api/admin/houses/:id': { perm: 'houses.edit', label: L('Removed a printing house', 'شال مطبعة') },
  'PUT /api/admin/product-houses': { perm: 'houses.edit', label: L('Printing house for a product', 'مطبعة لمنتج') },
  'GET /api/admin/customers': { perm: 'customers.view' },
  'POST /api/admin/customers/:id/reset-link': { perm: 'customers.contact', label: L('Password link for a customer', 'لينك كلمة سر لعميل') },
  'GET /api/admin/takedowns': { perm: 'rights' },
  'PATCH /api/admin/takedowns/:id': { perm: 'rights', label: L('Rights request', 'طلب حقوق') },

  // Products and ready designs
  'GET /api/admin/catalog': { perm: 'catalog.view' },
  'GET /api/admin/catalog/:id': { perm: 'catalog.view' },
  'PUT /api/admin/catalog/:id': { perm: 'catalog.edit', approve: true, limit: '200kb', label: L('Edit a product', 'تعديل منتج') },
  'POST /api/admin/catalog': { perm: 'catalog.edit', approve: true, limit: '200kb', label: L('New product', 'منتج جديد') },
  'DELETE /api/admin/catalog/:id': { perm: 'catalog.edit', approve: true, label: L('Product back to the original', 'رجوع المنتج للأصل') },
  'POST /api/admin/catalog/:id/photos': { perm: 'catalog.edit', approve: true, raw: '15mb', label: L('Add a product photo', 'إضافة صورة منتج') },
  'PUT /api/admin/catalog/:id/photos': { perm: 'catalog.edit', approve: true, limit: '8kb', label: L('Product photos order', 'ترتيب صور المنتج') },
  'DELETE /api/admin/catalog/:id/photos/:photoId': { perm: 'catalog.edit', approve: true, label: L('Delete a product photo', 'مسح صورة منتج') },
  'GET /api/admin/library': { perm: 'library.view' },
  'POST /api/admin/library': { perm: 'library.edit', approve: true, limit: '8kb', label: L('Publish a ready design', 'نشر تصميم جاهز') },
  'PATCH /api/admin/library': { perm: 'library.edit', approve: true, limit: '64kb', label: L('Ready designs', 'تصميمات جاهزة') },
  'PATCH /api/admin/library/:id': { perm: 'library.edit', approve: true, limit: '1kb', label: L('Ready design', 'تصميم جاهز') },
  'DELETE /api/admin/library/:id': { perm: 'library.edit', approve: true, label: L('Delete a ready design', 'مسح تصميم جاهز') },
  'POST /api/admin/library/uploads': { perm: 'uploads', label: L('Uploaded designs (zip)', 'رفع تصميمات (zip)') },
  'POST /api/admin/library/uploads/start': { perm: 'uploads', label: L('Started a zip upload', 'بدأ رفع zip') },
  'PUT /api/admin/library/uploads/:batch/piece': { perm: 'uploads', quiet: true },
  'POST /api/admin/library/uploads/:batch/finish': { perm: 'uploads', label: L('Finished a zip upload', 'خلّص رفع zip') },
  'GET /api/admin/library/uploads': { perm: 'uploads' },
  'GET /api/admin/library/uploads/:batch': { perm: 'uploads' },
  'DELETE /api/admin/library/uploads/:batch': { perm: 'uploads', label: L('Removed an upload', 'شال رفع') },
  'POST /api/admin/library/uploads/:batch/publish': { perm: 'uploads', approve: true, limit: '256kb', label: L('Publish uploaded designs', 'نشر التصميمات المرفوعة') },

  // Money
  'GET /api/admin/coupons': { perm: 'coupons.view' },
  'POST /api/admin/coupons': { perm: 'coupons.edit', approve: true, label: L('New coupon', 'كوبون جديد') },
  'PUT /api/admin/coupons/:id': { perm: 'coupons.edit', approve: true, label: L('Change a coupon', 'تعديل كوبون') },
  'DELETE /api/admin/coupons/:id': { perm: 'coupons.edit', approve: true, label: L('Delete a coupon', 'مسح كوبون') },
  'GET /api/admin/pricing': { perm: 'accounts.view' },
  'PUT /api/admin/pricing/:productId': { perm: 'costs.edit', approve: true, label: L('Prices and costs of a product', 'أسعار وتكاليف منتج') },
  'GET /api/admin/accounts': { perm: 'accounts.view' },
  'GET /api/admin/accounts.csv': { perm: 'accounts.view' },
  'PUT /api/admin/accounts/settings': { perm: 'costs.edit', approve: true, label: L('Shipping cost (accounts)', 'تكلفة الشحن (الحسابات)') },
  'PATCH /api/admin/items/:itemId/cost': { perm: 'costs.edit', approve: true, label: L('Actual cost of a job', 'التكلفة الفعلية لشغلانة') },
  'PATCH /api/admin/orders/:orderId/shipping-cost': { perm: 'costs.edit', approve: true, label: L('Actual shipping cost', 'تكلفة الشحن الفعلية') },
  'POST /api/admin/expenses': { perm: 'expenses.edit', approve: true, label: L('New expense', 'مصروف جديد') },
  'DELETE /api/admin/expenses/:id': { perm: 'expenses.edit', approve: true, label: L('Delete an expense', 'مسح مصروف') },

  // The owner's own
  'GET /api/admin/staff': { perm: 'staff' },
  'POST /api/admin/staff': { perm: 'staff', label: L('Added a team member', 'أضاف حد للفريق') },
  'PATCH /api/admin/staff/:id': { perm: 'staff', label: L('Changed a team member', 'عدّل حد في الفريق') },
  'POST /api/admin/staff/:id/setup-link': { perm: 'staff', label: L('New set-up link', 'لينك تجهيز جديد') },
  'PUT /api/admin/staff/:id/password': { perm: 'staff', noBody: true, label: L('Set a team member\'s password', 'غيّر كلمة سر حد في الفريق') },
  'DELETE /api/admin/staff/:id': { perm: 'staff', label: L('Removed a team member', 'شال حد من الفريق') },
  'GET /api/admin/preview': { perm: 'preview' },
  'PUT /api/admin/preview': { perm: 'preview', label: L('Private preview on/off', 'المعاينة الخاصة تشغيل/إيقاف') },
  'POST /api/admin/preview/people': { perm: 'preview', label: L('Invited someone', 'دعا حد') },
  'PATCH /api/admin/preview/people/:id': { perm: 'preview', label: L('Changed an invitation', 'عدّل دعوة') },
  'DELETE /api/admin/preview/people/:id': { perm: 'preview', label: L('Removed an invitation', 'شال دعوة') },
  'GET /api/admin/notifications': { perm: 'settings' },
  'POST /api/admin/notifications/test': { perm: 'settings', label: L('Test message', 'رسالة تجربة') },
  'PUT /api/admin/library/settings': { perm: 'settings', label: L('Text-only designs setting', 'إعداد تصميمات الكلام بس') },
};
const routeOf = (method, routePath) => ROUTES[`${method === 'HEAD' ? 'GET' : method} ${routePath}`] || { perm: 'owner-only' };

// ---------- Amounts (hidden from people without orders.amounts) ----------
const MONEY_KEYS = new Set([
  'subtotal', 'discount', 'total', 'orderTotal', 'price', 'unitPrice', 'lineTotal', 'linePrice', 'costAtOrder',
  'actualCost', 'actualShipping', 'cost', 'costs', 'fee', 'expressFee', 'amount', 'prices', 'basePrice',
  'extraSidePrice', 'surcharge', 'packPrice', 'spent', 'profit', 'revenue', 'margin',
  'coupon', // (its code often names the amount: SAVE10)
]);
/**
 * A copy without amounts: money keys dropped at any depth ('shipping' only when it is a number).
 * A list's own `total` (the answer's top level: how many there are) is a count and stays.
 */
function withoutAmounts(v, depth = 0) {
  if (depth > 12 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => withoutAmounts(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (MONEY_KEYS.has(k) && !(depth === 0 && k === 'total' && Object.values(v).some(Array.isArray))) continue;
    if (k === 'shipping' && typeof x === 'number') continue;
    out[k] = withoutAmounts(x, depth + 1);
  }
  return out;
}

// ---------- Running a kept request again, inside the app (no network) ----------
function socketPair() {
  let a = null;
  let b = null;
  const make = (other) => new Duplex({
    read() {},
    write(chunk, enc, cb) { other().push(chunk); cb(); },
    final(cb) { other().push(null); cb(); },
  });
  a = make(() => b);
  b = make(() => a);
  // (What http asks of a real socket; nothing to do on an in-memory one.)
  for (const x of [a, b]) {
    x.setTimeout = () => x;
    x.setNoDelay = () => x;
    x.setKeepAlive = () => x;
    x.ref = () => x;
    x.unref = () => x;
  }
  return [a, b];
}
/** Sends one request to the app as if it came in, and gives back { status, body (Buffer), type }. */
function replay(server, { method, url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const [inner, outer] = socketPair();
    inner.remoteAddress = '127.0.0.1';
    server.emit('connection', inner);
    const data = body ? Buffer.from(body) : Buffer.alloc(0);
    const req = http.request({ method, path: url, headers: { ...headers, 'content-length': data.length, connection: 'close' }, createConnection: () => outer }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 120e3);
    timer.unref();
    req.on('close', () => clearTimeout(timer));
    req.end(data);
  });
}

// ---------- Activity log: one line per change, in a file next to the data ----------
// (current: the old password when someone changes theirs.)
const REDACT = /pass|token|secret|hash|salt|^current$|^key$/i;
/** A short, safe copy of a request body for the log (passwords and tokens removed, long text cut). */
function shortBody(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (Buffer.isBuffer(v)) return { bytes: v.length };
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v !== 'object') return v;
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => shortBody(x, depth + 1)).concat(v.length > 30 ? [`… ${v.length - 30} more`] : []);
  const out = {};
  for (const [k, x] of Object.entries(v).slice(0, 40)) out[k] = REDACT.test(k) ? '•••' : shortBody(x, depth + 1);
  return out;
}
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const shopDay = (iso) => {
  try { return dayFormat.format(new Date(iso)); } catch (e) { return String(iso).slice(0, 10); }
};
// A line is at most this long: a big body is cut to its field names (nobody can push the history out with a few big requests).
const MAX_LINE = 2048;
class ActivityLog {
  constructor(file, { maxBytes = 4 * 1024 * 1024, keep = 6 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep; // files kept: the current one and keep - 1 before it (activity.jsonl.1, .2 …)
  }
  add(entry) {
    let e = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), ...entry };
    let line = JSON.stringify(e);
    if (line.length > MAX_LINE && e.body !== undefined) {
      e = { ...e, body: { fields: e.body && typeof e.body === 'object' ? Object.keys(e.body).slice(0, 20) : [], cut: true } };
      line = JSON.stringify(e);
    }
    if (line.length > MAX_LINE) {
      const cut = (v) => (v && typeof v === 'object' ? { en: String(v.en || '').slice(0, 200), ar: String(v.ar || '').slice(0, 200) } : v);
      e = { ...e, body: undefined, summary: cut(e.summary), label: cut(e.label), path: String(e.path || '').slice(0, 200) };
      line = JSON.stringify(e).slice(0, MAX_LINE * 2);
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      let size = 0;
      try { size = fs.statSync(this.file).size; } catch (e) { /* new */ }
      // Older files move along (.1 → .2 …), the oldest beyond `keep` goes.
      if (size > this.maxBytes) {
        for (let i = this.keep - 1; i >= 1; i--) {
          const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
          try { fs.renameSync(from, `${this.file}.${i}`); } catch (err) { /* not there yet */ }
        }
      }
      fs.appendFileSync(this.file, `${line}\n`);
    } catch (e) {
      console.warn('[activity] could not write:', e.message);
    }
  }
  /** Newest first. `who`: a person's id; from/to: YYYY-MM-DD days in the shop's time zone (Cairo), as the screen shows times. */
  list({ who = null, from = null, to = null, limit = 200 } = {}) {
    const out = [];
    for (const f of [this.file, ...Array.from({ length: this.keep - 1 }, (x, i) => `${this.file}.${i + 1}`)]) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        let e;
        try { e = JSON.parse(lines[i]); } catch (err) { continue; }
        if (who && e.whoId !== who) continue;
        const day = shopDay(e.at);
        if (from && day < from) continue;
        if (to && day > to) continue;
        out.push(e);
      }
      if (out.length >= limit) break;
    }
    return out;
  }
}

module.exports = { PERMS, ROLES, ROLE_PERMS, ROLE_NAMES, ROUTES, rolesOf, cleanRoles, permsOf, mainRole, routeOf, withoutAmounts, replay, shortBody, ActivityLog };
