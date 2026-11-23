'use strict';

/**
 * Site-wide protections: security headers and Content-Security-Policy,
 * per-visitor rate limits, admin sign-in sessions with lockout, SVG
 * clean-up for customer uploads, and removal of stale data.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();

// ---------- Headers ----------

/** CSP hashes for every inline <script> of a page (the language switch, import maps). */
function inlineScriptHashes(html) {
  const out = [];
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return [...new Set(out)];
}

/** Content-Security-Policy for an HTML page: only this site's own scripts run. */
function pageCsp(html) {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(' ')}`.trim(),
    // Inline style attributes are used for colours and positions; they cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** For everything that isn't a page (JSON, images, SVGs): nothing may run. */
const RESOURCE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Content-Security-Policy': RESOURCE_CSP,
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

// ---------- Rate limits ----------

/**
 * Counts actions per visitor in sliding windows, e.g.
 * limiter.hit(ip, [{ max: 20, ms: 10 * 60e3 }, { max: 100, ms: 24 * 3600e3 }]).
 * Returns the seconds to wait when a limit is reached, else 0.
 */
class RateLimiter {
  constructor() {
    this.hits = new Map();
  }
  check(key, rules) {
    const now = Date.now();
    const longest = Math.max(...rules.map((r) => r.ms));
    const list = (this.hits.get(key) || []).filter((tm) => now - tm < longest);
    for (const r of rules) {
      const inWindow = list.filter((tm) => now - tm < r.ms);
      if (inWindow.length >= r.max) return Math.ceil((inWindow[0] + r.ms - now) / 1000);
    }
    return { list, now };
  }
  /** Records one action; returns seconds to wait if it is over a limit (and does not record it). */
  hit(key, rules) {
    const r = this.check(key, rules);
    if (typeof r === 'number') return r;
    r.list.push(r.now);
    this.hits.set(key, r.list);
    if (this.hits.size > 20000) this.prune(Math.max(...rules.map((x) => x.ms)));
    return 0;
  }
  prune(ms) {
    const now = Date.now();
    for (const [k, list] of this.hits) if (!list.some((tm) => now - tm < ms)) this.hits.delete(k);
    if (this.hits.size > 20000) this.hits.clear();
  }
}

// ---------- Admin sessions ----------

const SESSION_MS = 12 * 3600e3;
const LOCK_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const GLOBAL_FAILS = 50; // wrong passwords per hour from everyone together

/** True when the admin password is easy to guess. */
function weakPassword(pw) {
  const s = String(pw || '');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  return s.length < 12 || (s.length < 16 && classes < 3) || /^(admin|password|123456|secret|qwerty)/i.test(s);
}

/**
 * Admin sign-in. Sessions are signed tokens (expiry + random part + HMAC with
 * a secret kept in the data folder), so every copy of the app accepts them;
 * sign-out is recorded in the shared store. The secret also depends on the
 * password, so changing ADMIN_PASSWORD signs everyone out.
 */
class AdminAuth {
  constructor(password, { dataDir, store } = {}) {
    this.hash = sha256(password);
    this.weak = weakPassword(password);
    this.store = store || null;
    let secret = crypto.randomBytes(32);
    if (dataDir) {
      const file = path.join(dataDir, '.session-secret');
      try {
        fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      } catch (e) { /* already there (another copy made it) */ }
      try { secret = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); } catch (e) { /* keep the random one */ }
    }
    this.key = crypto.createHmac('sha256', secret).update(this.hash).digest();
    // Signs download links sent to printing houses (independent of the password).
    this.linkKey = crypto.createHmac('sha256', secret).update('print-house-links').digest();
    // Signs customers' sign-in cookies and password-reset links (independent of the admin password).
    this.customerKey = crypto.createHmac('sha256', secret).update('customer-sessions').digest();
    this.sessions = new Map(); // revoked tokens when there is no store
    this.fails = new Map(); // ip -> [times]
    this.globalFails = [];
  }
  /** Seconds until this visitor may try again (0 = allowed). */
  lockedFor(ip) {
    const now = Date.now();
    this.globalFails = this.globalFails.filter((tm) => now - tm < 3600e3);
    if (this.globalFails.length >= GLOBAL_FAILS) return Math.ceil((this.globalFails[0] + 3600e3 - now) / 1000);
    const list = (this.fails.get(ip) || []).filter((tm) => now - tm < LOCK_MS);
    this.fails.set(ip, list);
    return list.length >= LOCK_FAILS ? Math.ceil((list[0] + LOCK_MS - now) / 1000) : 0;
  }
  /** Returns { token, expiresAt } or { wait } / null for a wrong password. */
  login(ip, password) {
    const wait = this.lockedFor(ip);
    if (wait) return { wait };
    const ok = crypto.timingSafeEqual(sha256(typeof password === 'string' ? password : ''), this.hash);
    if (!ok) {
      const now = Date.now();
      this.fails.get(ip).push(now);
      this.globalFails.push(now);
      if (this.fails.size > 20000) this.fails.clear();
      const left = LOCK_FAILS - this.fails.get(ip).length;
      console.warn(`[admin] wrong password from ${ip} (${left > 0 ? left + ' tries left' : 'locked for 15 min'})`);
      return null;
    }
    this.fails.delete(ip);
    const expiresAt = Date.now() + SESSION_MS;
    const body = `${expiresAt.toString(36)}.${crypto.randomBytes(18).toString('base64url')}`;
    const token = `${body}.${this.sign(body)}`;
    console.log(`[admin] signed in from ${ip}`);
    return { token, expiresAt };
  }
  sign(body) {
    return crypto.createHmac('sha256', this.key).update(body).digest('base64url');
  }
  revoked() {
    return this.store ? this.store.db.revokedSessions || {} : Object.fromEntries(this.sessions);
  }
  verify(token) {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token || '');
    if (!m) return false;
    const good = Buffer.from(this.sign(`${m[1]}.${m[2]}`));
    const given = Buffer.from(m[3]);
    if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return false;
    if (parseInt(m[1], 36) < Date.now()) return false;
    return !this.revoked()[sha256(token).toString('hex')];
  }
  logout(token) {
    if (!this.verify(token)) return;
    const id = sha256(token).toString('hex');
    const exp = parseInt(token.split('.')[0], 36);
    if (!this.store) return this.sessions.set(id, exp);
    this.store.mutate((db) => {
      const now = Date.now();
      const list = db.revokedSessions || {};
      for (const [k, e] of Object.entries(list)) if (e < now) delete list[k];
      list[id] = exp;
      db.revokedSessions = list;
    });
  }
}

const bearer = (req) => (/^Bearer\s+([A-Za-z0-9_.-]{20,})$/.exec(req.get('authorization') || '') || [])[1] || '';

// ---------- SVG uploads ----------

/**
 * Removes anything in an uploaded SVG that could run code or load from
 * other sites: scripts, event handlers, foreignObject/iframes, and links
 * that are not embedded data or in-file references. The editor's own SVG
 * export contains none of these, so real print files are unchanged.
 */
function sanitizeSvg(text) {
  let s = String(text);
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  s = s.replace(/<!ENTITY[\s\S]*?>/gi, '');
  for (const tag of ['script', 'foreignObject', 'iframe', 'object', 'embed', 'handler', 'listener']) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '');
  }
  // Inside tags only: drop on* handlers and unsafe links.
  s = s.replace(/<[a-zA-Z][^<>]*>/g, (tag) => tag
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+((?:xlink:)?href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, attr, q, d1, d2) => {
      const v = (d1 != null ? d1 : d2 || '').trim();
      return /^(#|data:image\/(png|jpe?g|webp|gif);)/i.test(v) ? all : '';
    }));
  // CSS that could load from elsewhere (embedded fonts and images are data: URLs).
  s = s.replace(/url\(\s*(?!['"]?\s*(?:data:|#))[^)]*\)/gi, 'none');
  s = s.replace(/@import[^;]*;/gi, '');
  s = s.replace(/javascript:/gi, '');
  return s;
}

// ---------- Clean-up ----------

const DAY = 24 * 3600e3;

/**
 * Deletes designs that were never ordered (abandoned carts and uploads)
 * and old share links. Ordered designs and their files are never touched.
 */
function cleanup({ store, sharesDir, designDays = 30, uploadingHours = 24, shareDays = 120 }) {
  const now = Date.now();
  let shares = 0;
  // Decided under the lock with the latest data (another copy may have just
  // ordered a design); files are removed only after the record is gone.
  const gone = store.mutate((db) => {
    const ids = [];
    for (const [id, d] of Object.entries(db.designs)) {
      if (d.orderId) continue;
      const age = now - Date.parse(d.createdAt || 0);
      // Books hold a child's photo: unordered ones are kept for a week only.
      const keepDays = d.kind === 'book' ? Math.min(7, designDays) : designDays;
      if ((d.status === 'uploading' && age > uploadingHours * 3600e3) || age > keepDays * DAY) {
        delete db.designs[id];
        ids.push(id);
      }
    }
    return ids;
  });
  for (const id of gone) fs.rmSync(store.designDir(id), { recursive: true, force: true });
  const designs = gone.length;
  if (sharesDir && fs.existsSync(sharesDir)) {
    for (const id of fs.readdirSync(sharesDir)) {
      const file = path.join(sharesDir, id, 'share.json');
      let created;
      try {
        created = Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).createdAt);
      } catch (e) {
        // A share that never finished saving: use the folder's age.
        try { created = fs.statSync(path.join(sharesDir, id)).mtimeMs; } catch (e2) { continue; }
        if (now - created < DAY) continue;
        created = 0;
      }
      if (now - created > shareDays * DAY) {
        fs.rmSync(path.join(sharesDir, id), { recursive: true, force: true });
        shares++;
      }
    }
  }
  if (designs || shares) console.log(`[cleanup] removed ${designs} unordered design(s) and ${shares} old share link(s)`);
  return { designs, shares };
}

module.exports = { pageCsp, inlineScriptHashes, securityHeaders, RateLimiter, AdminAuth, weakPassword, bearer, sanitizeSvg, cleanup };
