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
const TURNSTILE = 'https://challenges.cloudflare.com';
function pageCsp(html, { captcha = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(' ')}${captcha ? ' ' + TURNSTILE : ''}`.trim(),
    ...(captcha ? [`frame-src ${TURNSTILE}`] : []),
    // Inline style attributes are used for colours and positions; they cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' data: blob:${captcha ? ' ' + TURNSTILE : ''}`,
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
  clear(key) {
    this.hits.delete(key);
  }
  prune(ms) {
    const now = Date.now();
    for (const [k, list] of this.hits) if (!list.some((tm) => now - tm < ms)) this.hits.delete(k);
    if (this.hits.size > 20000) this.hits.clear();
  }
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

/**
 * The same counts as RateLimiter, kept in a small file in the data folder so every
 * copy of the app (and a restarted one) sees the same sign-in attempts. Keys are
 * stored hashed (no IP addresses or account ids in the file). If the file can't be
 * used (disk full, permissions) it falls back to counting in memory.
 */
class SharedLimiter {
  constructor(file) {
    this.file = file;
    this.lockPath = file + '.lock';
    this.memory = new RateLimiter();
  }
  key(k) {
    return sha256(k).toString('base64url').slice(0, 22);
  }
  read() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch (e) {
      return {};
    }
  }
  lock() {
    const start = Date.now();
    for (;;) {
      try {
        fs.closeSync(fs.openSync(this.lockPath, 'wx'));
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          if (Date.now() - fs.statSync(this.lockPath).mtimeMs > 5000) {
            fs.rmSync(this.lockPath, { force: true }); // left behind by a copy that crashed
            continue;
          }
        } catch (e2) {
          continue;
        }
        if (Date.now() - start > 2000) return false; // count anyway rather than block sign-in
        Atomics.wait(SLEEP, 0, 0, 10);
      }
    }
  }
  /** Runs fn(data) on the latest file and saves it; nothing else saves in between. */
  update(fn) {
    const locked = this.lock();
    try {
      const data = this.read();
      const result = fn(data);
      // Forget attempts older than a day (the longest window), and keep the file small.
      const now = Date.now();
      for (const [k, list] of Object.entries(data)) {
        const keep = Array.isArray(list) ? list.filter((tm) => typeof tm === 'number' && now - tm < 24 * 3600e3) : [];
        if (keep.length) data[k] = keep;
        else delete data[k];
      }
      const keys = Object.keys(data);
      if (keys.length > 20000) {
        keys.sort((a, b) => data[a][data[a].length - 1] - data[b][data[b].length - 1]);
        for (const k of keys.slice(0, keys.length - 20000)) delete data[k];
      }
      const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
      return result;
    } finally {
      if (locked) fs.rmSync(this.lockPath, { force: true });
    }
  }
  static judge(list, rules, now) {
    for (const r of rules) {
      const inWindow = list.filter((tm) => now - tm < r.ms);
      if (inWindow.length >= r.max) return Math.ceil((inWindow[0] + r.ms - now) / 1000);
    }
    return 0;
  }
  /**
   * Seconds to wait if `key` is over a limit, else { list, now } (like RateLimiter). Attempts that
   * couldn't be written to the file (disk full, a broken file) were counted in memory: both count.
   */
  check(key, rules) {
    const now = Date.now();
    let list = [];
    try {
      list = (this.read()[this.key(key)] || []).filter((tm) => typeof tm === 'number');
    } catch (e) { /* only the memory counts */ }
    const mem = (this.memory.hits.get(key) || []).filter((tm) => typeof tm === 'number');
    const all = [...list, ...mem].sort((a, b) => a - b);
    const wait = SharedLimiter.judge(all, rules, now);
    return wait || { list: all, now };
  }
  /** Records one action; returns seconds to wait if it is over a limit (and does not record it). */
  hit(key, rules) {
    try {
      const k = this.key(key);
      return this.update((data) => {
        const now = Date.now();
        const list = (Array.isArray(data[k]) ? data[k] : []).filter((tm) => typeof tm === 'number');
        const wait = SharedLimiter.judge(list, rules, now);
        if (wait) return wait;
        list.push(now);
        data[k] = list;
        return 0;
      });
    } catch (e) {
      if (!this.warned) console.warn(`[limits] can't use ${this.file} (${e.code || e.message}): counting sign-in attempts in memory`);
      this.warned = true;
      // Counted in memory, on top of what the file still says.
      const seen = this.check(key, rules);
      if (typeof seen === 'number') return seen;
      return this.memory.hit(key, rules);
    }
  }
  clear(key) {
    try {
      const k = this.key(key);
      if (this.read()[k]) this.update((data) => { delete data[k]; });
    } catch (e) {
      /* nothing to clear */
    }
    this.memory.hits.delete(key);
  }
}

// ---------- Admin sessions ----------

const SESSION_MS = 12 * 3600e3;
const LOCK_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const GLOBAL_FAILS = 50; // wrong passwords per hour from everyone together
const ADMIN_IP_RULES = [{ max: LOCK_FAILS, ms: LOCK_MS }];
const ADMIN_ALL_RULES = [{ max: GLOBAL_FAILS, ms: 3600e3 }];

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
  constructor(password, { dataDir, store, limiter } = {}) {
    this.hash = sha256(password);
    this.weak = weakPassword(password);
    this.store = store || null;
    let secret = crypto.randomBytes(32);
    if (dataDir) {
      const file = path.join(dataDir, '.session-secret');
      // Made whole in a temporary file, then linked into place in one step, so another
      // copy of the app starting at the same moment never reads a half-written secret.
      if (!fs.existsSync(file)) {
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.writeFileSync(tmp, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
          fs.linkSync(tmp, file);
        } catch (e) { /* already there (another copy made it) */ }
        try { fs.unlinkSync(tmp); } catch (e) { /* gone */ }
      }
      for (let tries = 0; tries < 50; tries++) {
        try {
          const hex = fs.readFileSync(file, 'utf8').trim();
          if (/^[0-9a-f]{64}$/.test(hex)) {
            secret = Buffer.from(hex, 'hex');
            break;
          }
        } catch (e) { /* not there yet */ }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); // an older copy may still be writing it
      }
    }
    this.key = crypto.createHmac('sha256', secret).update(this.hash).digest();
    // Signs download links sent to printing houses (independent of the password).
    this.linkKey = crypto.createHmac('sha256', secret).update('print-house-links').digest();
    // Signs customers' sign-in cookies and password-reset links (independent of the admin password).
    this.customerKey = crypto.createHmac('sha256', secret).update('customer-sessions').digest();
    // Signs the private-preview cookies (src/preview.js), independent of the admin password.
    this.previewKey = crypto.createHmac('sha256', secret).update('private-preview').digest();
    this.sessions = new Map(); // revoked tokens when there is no store
    // Wrong passwords, counted for every copy of the app together (a file in the data folder).
    this.fails = limiter || (dataDir ? new SharedLimiter(path.join(dataDir, '.signin-limits.json')) : new RateLimiter());
  }
  /** Seconds until this visitor may try again (0 = allowed). */
  lockedFor(ip, { knownDevice = false } = {}) {
    // The shop-wide lock (many wrong passwords from everywhere) doesn't stop the owner on a browser
    // they signed in from before: otherwise anyone could lock them out for an hour.
    const all = knownDevice ? 0 : this.fails.check('admin:*', ADMIN_ALL_RULES);
    if (typeof all === 'number') return all;
    const one = this.fails.check(`admin:${ip}`, ADMIN_IP_RULES);
    return typeof one === 'number' ? one : 0;
  }
  /** Returns { token, expiresAt } or { wait } / null for a wrong password. */
  /** A signed "signed in from this browser before" mark (a cookie, 180 days). */
  // kind 'device': the owner's shared-password sign-in; 'staff-<id>': one team member's own (a separate mark,
  // so a team member's browser never gets past the owner's lock, nor someone else's).
  deviceMark(kind = 'device') {
    const exp = (Date.now() + 180 * 24 * 3600e3).toString(36);
    return `${exp}.${this.sign(`${kind}.${exp}`)}`;
  }
  knownDevice(mark, kind = 'device') {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(mark || '');
    if (!m || parseInt(m[1], 36) < Date.now()) return false;
    const good = Buffer.from(this.sign(`${kind}.${m[1]}`));
    const given = Buffer.from(m[2]);
    return good.length === given.length && crypto.timingSafeEqual(good, given);
  }
  login(ip, password, { knownDevice = false } = {}) {
    const wait = this.lockedFor(ip, { knownDevice });
    if (wait) return { wait };
    const ok = crypto.timingSafeEqual(sha256(typeof password === 'string' ? password : ''), this.hash);
    if (!ok) {
      this.fails.hit('admin:*', ADMIN_ALL_RULES);
      this.fails.hit(`admin:${ip}`, ADMIN_IP_RULES);
      const seen = this.fails.check(`admin:${ip}`, ADMIN_IP_RULES);
      const left = typeof seen === 'number' ? 0 : LOCK_FAILS - seen.list.filter((tm) => seen.now - tm < LOCK_MS).length;
      console.warn(`[admin] wrong password from ${ip} (${left > 0 ? left + ' tries left' : 'locked for 15 min'})`);
      return null;
    }
    this.fails.clear(`admin:${ip}`);
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
  // ---------- Staff (product managers) ----------
  // Staff sign in with a username and their own password (kept as a scrypt hash in db.staff).
  // Their token has 4 parts (expiry.random.staffId.signature), so the owner's checks (3 parts) never accept it.
  static hashStaffPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
  }
  /** Staff sign-ins have their own count: wrong staff passwords never lock the owner out. */
  /**
   * On a browser this person signed in from before (knownDevice), other people's wrong guesses (all staff
   * sign-ins, or this username from anywhere) don't lock them out; this address's own wrong tries still do.
   */
  staffLockedFor(ip, username, { knownDevice = false } = {}) {
    const keys = knownDevice ? [[`staff-ipuser:${ip}:${username}`, ADMIN_IP_RULES]] : [['staff:*', ADMIN_ALL_RULES], [`staff:${ip}`, ADMIN_IP_RULES], [`staff-user:${username}`, ADMIN_IP_RULES]];
    for (const [key, rules] of keys) {
      const v = this.fails.check(key, rules);
      if (typeof v === 'number') return v;
    }
    return 0;
  }
  staffLogin(ip, username, password, staffList, { knownDevice = null } = {}) {
    const name = String(username || '').trim().toLowerCase().slice(0, 40);
    const known = typeof knownDevice === 'function' ? knownDevice((staffList || []).find((u) => u.username === name)) : false;
    const wait = this.staffLockedFor(ip, name, { knownDevice: known });
    if (wait) return { wait };
    const user = (staffList || []).find((u) => u.username === name);
    // Always hash once, so a wrong username takes as long as a wrong password.
    const given = crypto.scryptSync(typeof password === 'string' ? password : '', user ? user.salt : 'no-such-user', 32);
    const ok = user && crypto.timingSafeEqual(given, Buffer.from(user.hash, 'hex'));
    if (!ok) {
      this.fails.hit('staff:*', ADMIN_ALL_RULES);
      this.fails.hit(`staff:${ip}`, ADMIN_IP_RULES);
      this.fails.hit(`staff-user:${name}`, ADMIN_IP_RULES);
      this.fails.hit(`staff-ipuser:${ip}:${name}`, ADMIN_IP_RULES);
      console.warn(`[admin] wrong staff sign-in from ${ip}`);
      return null;
    }
    this.fails.clear(`staff:${ip}`);
    this.fails.clear(`staff-user:${name}`);
    this.fails.clear(`staff-ipuser:${ip}:${name}`);
    const expiresAt = Date.now() + SESSION_MS;
    const body = `${expiresAt.toString(36)}.${crypto.randomBytes(18).toString('base64url')}.${user.id}`;
    console.log(`[admin] staff ${user.username} signed in from ${ip}`);
    return { token: `${body}.${this.sign(`staff.${body}.${user.gen || 0}`)}`, expiresAt, user };
  }
  /** A new sign-in for a team member (after they changed their own password). */
  staffToken(user) {
    const expiresAt = Date.now() + SESSION_MS;
    const body = `${expiresAt.toString(36)}.${crypto.randomBytes(18).toString('base64url')}.${user.id}`;
    return { token: `${body}.${this.sign(`staff.${body}.${user.gen || 0}`)}`, expiresAt };
  }
  /** The staff member a token belongs to (null if it isn't a valid staff token). */
  verifyStaff(token, staffList) {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)\.([a-f0-9]{8,32})\.([A-Za-z0-9_-]+)$/.exec(token || '');
    if (!m) return null;
    const user = (staffList || []).find((u) => u.id === m[3]);
    if (!user) return null;
    const good = Buffer.from(this.sign(`staff.${m[1]}.${m[2]}.${m[3]}.${user.gen || 0}`));
    const given = Buffer.from(m[4]);
    if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
    if (parseInt(m[1], 36) < Date.now()) return null;
    if (this.revoked()[sha256(token).toString('hex')]) return null;
    return user;
  }
  logout(token, staffList) {
    if (!this.verify(token) && !this.verifyStaff(token, staffList)) return;
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
 * other sites: scripts, event handlers, foreignObject/iframes, animations,
 * and links that are not embedded pictures or in-file references. The SVG is
 * read tag by tag (quoted attribute values, comments and CDATA understood),
 * and every kept tag is written out again from its parsed parts, so broken
 * or nested tricks ("<scr<set/>ipt>", a ">" inside quotes, xl:href,
 * entity-encoded "javascript:") can't survive. The editor's own SVG export
 * contains none of these, so real print files are unchanged.
 *
 * Only what a browser reads as CSS or as a link is cleaned: the content of
 * <style> elements, style="…" and other attributes (fill="url(…)"), and link
 * attributes (href, src…). The customer's own words between the tags are
 * never touched: "@import coffee", "Visit url(ebda3.me)" or "javascript: the
 * good parts" on a T-shirt stay exactly as they were typed.
 */
const SVG_DROP = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'handler', 'listener', 'animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor', 'discard', 'audio', 'video', 'base', 'meta', 'link', 'frame', 'frameset']);
const SAFE_LINK = /^(#|data:image\/(png|jpe?g|webp|gif);)/i;
// Attributes that hold one address a browser follows or loads (SVG's own, and those of XHTML elements a
// file may carry): kept only when SAFE_LINK. Lists of addresses (srcset…) are never needed in a print file.
const LINK_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'codebase', 'classid', 'poster', 'background', 'lowsrc', 'dynsrc', 'longdesc', 'cite', 'manifest', 'datasrc']);
const LINK_LISTS = new Set(['srcset', 'imagesrcset', 'ping', 'archive']);
function decodeEntities(v) {
  return String(v)
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#(\d+);?/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&(colon|tab|newline|lpar|rpar|sol|amp|quot|apos|lt|gt);?/gi, (m, e) => ({ colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[e.toLowerCase()]);
}
/**
 * Text as an XML parser reads it: character references and the five XML entities, once. `odd` says
 * the text has an "&" that is none of these ("&colon;", "&#106" without ";", a lone "&"): XML can't
 * read it, and an HTML page would read it differently, so such CSS is written out again from what
 * was checked (with only &amp; &lt; &gt; &quot;), never as it came.
 */
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlChar = (n) => n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
function xmlText(raw) {
  let odd = false;
  const text = String(raw).replace(/&(?:#x([0-9a-fA-F]{1,8})|#([0-9]{1,8})|(amp|lt|gt|quot|apos));|&/g, (m, hex, dec, name) => {
    if (name) return XML_ENT[name];
    const n = hex ? parseInt(hex, 16) : dec ? Number(dec) : -1;
    if (!xmlChar(n)) { odd = true; return m; }
    return String.fromCodePoint(n);
  });
  return { text, odd };
}
const escText = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (v) => escText(v).replace(/"/g, '&quot;');
const attrOut = (v) => String(v).replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// A value that is a javascript: (vbscript:, data: other than a picture) address, as a browser reads one:
// entities decoded, blanks and control characters left out ("&#106;ava\tscript:", " JaVaScRiPt:").
const BAD_URL = /^((javascript|vbscript|livescript):|data:(?!image\/(png|jpe?g|webp|gif);))/i;
const bareUrl = (v) => v.replace(/[\s\u0000-\u001f]+/g, '');
const isBadUrl = (raw) => /[:&]/.test(raw) && (BAD_URL.test(bareUrl(decodeEntities(raw))) || BAD_URL.test(bareUrl(xmlText(raw).text)));
const safeLink = (raw) => SAFE_LINK.test(decodeEntities(raw).trim()) && SAFE_LINK.test(xmlText(raw).text.trim());

/**
 * CSS that could load from elsewhere or run code. url() keeps in-file references (#id) and embedded
 * pictures and fonts (data:); any other url() becomes none. @import (to its ";"), image-set(), image(),
 * src() and expression() go. CSS escapes are read first and comments left out (as a space, never joining
 * what was around them), so no backslash is left and what is checked is what a browser reads; what comes out is
 * checked once more and dropped whole if anything is left. Forward scans and single regular-expression
 * passes, so a crafted file ("url(" thousands of times with no ")") takes linear time.
 */
const SAFE_CSS_URL = /^(#|data:(image\/(png|jpe?g|gif|webp|avif|bmp)|font\/[\w.+-]+|application\/(font-[\w.+-]+|x-font-[\w.+-]+|vnd\.ms-fontobject|octet-stream))[;,])/i;
const CSS_FUNCS = /(?:image-set|image|src|expression)[\s\u000c]*\(/gi;
const CSS_RISK = /\\|\/\*|url\(|@import|(?:image-set|image|src|expression)[\s\u000c]*\(/i;
const CSS_WS = /[ \t\n\r\u000c]/;
/** The url( whose "(" is just before `k`: where it ends and the address in it; null when it never ends well. */
function cssUrlAt(s, k) {
  while (k < s.length && CSS_WS.test(s[k])) k++;
  const q = s[k];
  if (q === '"' || q === "'") {
    const e = s.indexOf(q, k + 1);
    if (e < 0) return null;
    let m = e + 1;
    while (m < s.length && CSS_WS.test(s[m])) m++;
    return s[m] === ')' ? { end: m + 1, url: s.slice(k + 1, e) } : null;
  }
  const e = s.indexOf(')', k);
  if (e < 0) return null;
  const url = s.slice(k, e).replace(/[ \t\n\r\u000c]+$/, '');
  // Quotes, brackets or blanks inside an unquoted url(): a browser loads nothing; it becomes none here.
  return { end: e + 1, url: /["'(\s\u0000-\u001f\u007f]/.test(url) ? '' : url };
}
function cssUrls(s) {
  const low = s.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const u = low.indexOf('url(', i);
    if (u < 0) break;
    const r = cssUrlAt(s, u + 4);
    if (!r) {
      // Unfinished: it becomes none as far as the next ")", or with the rest of this CSS.
      const e = s.indexOf(')', u + 4);
      out += s.slice(i, u) + 'none';
      if (e < 0) return out;
      i = e + 1;
      continue;
    }
    out += s.slice(i, u) + (SAFE_CSS_URL.test(r.url) ? s.slice(u, r.end) : 'none');
    i = r.end;
  }
  return out + s.slice(i);
}
const cssUnescape = (m, hex, ch) => {
  // (Only characters XML allows: "\1 " would make the file unreadable.)
  if (hex) { const n = parseInt(hex, 16); return xmlChar(n) ? String.fromCodePoint(n) : String.fromCharCode(0xfffd); }
  return ch === undefined || /[\n\r\f]/.test(ch) ? ' ' : ch;
};
function cleanCss(css) {
  let s = String(css);
  if (!CSS_RISK.test(s)) return s;
  // Escapes read once ("\75 rl(" is "url("); a backslash still left ("\5c 75") becomes a space.
  s = s.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S])|$)/g, cssUnescape).replace(/\\/g, ' ');
  s = s.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  s = s.replace(/@import[^;]*;?/gi, ' ').replace(CSS_FUNCS, 'none(');
  s = cssUrls(s);
  // Nothing that loads may be left (the steps above only write spaces and "none"; this is the safety net).
  return /\\|@import|(?:image-set|image|src|expression)[\s\u000c]*\(/i.test(s) || cssUrls(s) !== s ? '' : s;
}
/**
 * An attribute value or <style> text, read as XML: null when it stays exactly as written, else the
 * cleaned CSS to write instead. `always`: it is CSS (style="…", <style>); any other attribute is only
 * looked at when it has something CSS could load with (presentation attributes: fill="url(…)").
 */
function cleanedCss({ text, odd }, always) {
  if (!always && !odd && !CSS_RISK.test(text)) return null;
  const clean = cleanCss(text);
  return odd || clean !== text ? clean : null;
}

function sanitizeSvg(text) {
  const s = String(text);
  let out = '';
  let i = 0;
  const skip = []; // names of dropped elements we are inside
  // The <style> element being read: its name, its content as it will be written (`out`) and as a
  // browser reads it (`css`), checked as a whole when the element ends.
  let style = null;
  const emit = (str) => { if (!skip.length) out += str; };
  // Text between tags: written as it is (the customer's words), or collected as CSS inside a <style>.
  const emitText = (raw, written = raw.replace(/>/g, '&gt;')) => {
    if (skip.length) return;
    if (!style) { out += written; return; }
    const x = xmlText(raw);
    style.out += written;
    style.css += x.text;
    style.odd = style.odd || x.odd;
  };
  const endStyle = () => {
    const clean = cleanedCss({ text: style.css, odd: style.odd }, true);
    out += `${clean === null ? style.out : escText(clean)}</${style.name}>`;
    style = null;
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { emitText(s.slice(i)); break; }
    emitText(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      const body = s.slice(i + 9, e < 0 ? s.length : e).replace(/\]\]>/g, '');
      if (style && !skip.length) {
        style.out += `<![CDATA[${body}]]>`;
        style.css += body;
      } else emit(`<![CDATA[${body}]]>`);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith('<!', i)) {
      // DOCTYPE / ENTITY declarations (with an internal [ ... ] part) are dropped.
      const br = s.indexOf('[', i);
      const gt = s.indexOf('>', i);
      if (br >= 0 && (gt < 0 || br < gt)) { const e = s.indexOf(']', br); const g = s.indexOf('>', e < 0 ? br : e); i = g < 0 ? s.length : g + 1; } else i = gt < 0 ? s.length : gt + 1;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const e = s.indexOf('?>', i + 2);
      const pi = s.slice(i, e < 0 ? s.length : e + 2);
      // Only the plain XML declaration at the very start is kept.
      if (/^<\?xml\s[^<>]*\?>$/i.test(pi) && !out.trim() && !style) emit(pi);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    const closing = s[i + 1] === '/';
    const m = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i + (closing ? 2 : 1), i + (closing ? 2 : 1) + 200));
    if (!m) { emitText('<', '&lt;'); i += 1; continue; }
    const name = m[0];
    const local = name.toLowerCase().replace(/^.*:/, '');
    let j = i + (closing ? 2 : 1) + name.length;
    // Attributes, with quoted values understood (a ">" or "<" inside quotes is part of the value).
    const attrs = [];
    let selfClose = false;
    let broken = false;
    for (;;) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length) { broken = true; break; }
      if (s[j] === '>') { j++; break; }
      if (s[j] === '/' && s[j + 1] === '>') { selfClose = true; j += 2; break; }
      if (s[j] === '<') { broken = true; break; }
      const an = /^[^\s=>/<"']+/.exec(s.slice(j, j + 200));
      if (!an) { j++; continue; }
      j += an[0].length;
      while (j < s.length && /\s/.test(s[j])) j++;
      let value = null;
      if (s[j] === '=') {
        j++;
        while (j < s.length && /\s/.test(s[j])) j++;
        const q = s[j];
        if (q === '"' || q === "'") {
          const e = s.indexOf(q, j + 1);
          if (e < 0) { broken = true; break; }
          value = s.slice(j + 1, e);
          j = e + 1;
        } else {
          const v = /^[^\s>]+/.exec(s.slice(j)) || [''];
          value = v[0];
          j += value.length;
        }
      }
      attrs.push([an[0], value]);
    }
    if (broken) { emitText('<', '&lt;'); i += 1; continue; }
    i = j;
    if (closing) {
      if (skip.length) { if (skip[skip.length - 1] === local) skip.pop(); continue; }
      // The end of the <style> (or, in a broken file, of what holds it: the <style> ends there too).
      if (style) { endStyle(); if (local === 'style') continue; }
      if (!SVG_DROP.has(local)) emit(`</${name}>`);
      continue;
    }
    // Dropped elements and everything in them; and any element inside a <style> (its text is the CSS).
    if (SVG_DROP.has(local) || skip.length || style) {
      if (!selfClose) skip.push(local);
      continue;
    }
    const kept = [];
    for (const [an, value] of attrs) {
      const lname = an.toLowerCase();
      const alocal = lname.replace(/^.*:/, '');
      if (/^on/.test(alocal) || lname === 'xml:base' || alocal === 'attributename') continue;
      if (value == null) { kept.push(` ${an}`); continue; }
      if (LINK_LISTS.has(alocal)) continue;
      if (LINK_ATTRS.has(alocal)) {
        if (safeLink(value)) kept.push(` ${an}="${attrOut(value)}"`);
        continue;
      }
      // Any other attribute: never a javascript: address; CSS in it (style="…", fill="url(…)") is cleaned.
      if (isBadUrl(value)) continue;
      const clean = cleanedCss(xmlText(value), alocal === 'style');
      kept.push(` ${an}="${clean === null ? attrOut(value) : escAttr(clean)}"`);
    }
    emit(`<${name}${kept.join('')}${selfClose ? '/>' : '>'}`);
    if (local === 'style' && !selfClose) style = { name, out: '', css: '', odd: false };
  }
  if (style) endStyle();
  return out;
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

module.exports = { pageCsp, inlineScriptHashes, securityHeaders, RateLimiter, SharedLimiter, AdminAuth, weakPassword, bearer, sanitizeSvg, cleanup };
