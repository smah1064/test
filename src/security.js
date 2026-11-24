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
  deviceMark() {
    const exp = (Date.now() + 180 * 24 * 3600e3).toString(36);
    return `${exp}.${this.sign(`device.${exp}`)}`;
  }
  knownDevice(mark) {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(mark || '');
    if (!m || parseInt(m[1], 36) < Date.now()) return false;
    const good = Buffer.from(this.sign(`device.${m[1]}`));
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
 * other sites: scripts, event handlers, foreignObject/iframes, animations,
 * and links that are not embedded pictures or in-file references. The SVG is
 * read tag by tag (quoted attribute values, comments and CDATA understood),
 * and every kept tag is written out again from its parsed parts, so broken
 * or nested tricks ("<scr<set/>ipt>", a ">" inside quotes, xl:href,
 * entity-encoded "javascript:") can't survive. The editor's own SVG export
 * contains none of these, so real print files are unchanged.
 */
const SVG_DROP = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'handler', 'listener', 'animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor', 'discard', 'audio', 'video', 'base', 'meta', 'link', 'frame', 'frameset']);
const SAFE_LINK = /^(#|data:image\/(png|jpe?g|webp|gif);)/i;
function decodeEntities(v) {
  return String(v)
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#(\d+);?/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&(colon|tab|newline|lpar|rpar|sol|amp|quot|apos|lt|gt);?/gi, (m, e) => ({ colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[e.toLowerCase()]);
}
// "java\tscript:", "j&#x61;vascript:"… once decoded and without blanks.
const dangerousValue = (v) => /(javascript|vbscript|livescript):|data:(?!image\/(png|jpe?g|webp|gif);)/i.test(decodeEntities(v).replace(/[\s\u0000-\u001f]+/g, ''));
const attrOut = (v) => String(v).replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function sanitizeSvg(text) {
  const s = String(text);
  let out = '';
  let i = 0;
  const skip = []; // names of dropped elements we are inside
  const emit = (str) => { if (!skip.length) out += str; };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { emit(s.slice(i).replace(/>/g, '&gt;')); break; }
    emit(s.slice(i, lt).replace(/>/g, '&gt;'));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      const body = s.slice(i + 9, e < 0 ? s.length : e);
      emit(`<![CDATA[${body.replace(/\]\]>/g, '')}]]>`);
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
      if (/^<\?xml\s[^<>]*\?>$/i.test(pi) && !out.trim()) emit(pi);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    const closing = s[i + 1] === '/';
    const m = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i + (closing ? 2 : 1), i + (closing ? 2 : 1) + 200));
    if (!m) { emit('&lt;'); i += 1; continue; }
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
    if (broken) { emit('&lt;'); i += 1; continue; }
    i = j;
    if (closing) {
      if (skip.length) { if (skip[skip.length - 1] === local) skip.pop(); continue; }
      if (!SVG_DROP.has(local)) emit(`</${name}>`);
      continue;
    }
    if (SVG_DROP.has(local) || skip.length) {
      if (!selfClose && (SVG_DROP.has(local) ? true : skip.length)) skip.push(local);
      continue;
    }
    const kept = [];
    for (const [an, value] of attrs) {
      const lname = an.toLowerCase();
      const alocal = lname.replace(/^.*:/, '');
      if (/^on/.test(alocal) || lname === 'xml:base' || alocal === 'attributename') continue;
      if (value == null) { kept.push(` ${an}`); continue; }
      if (alocal === 'href' || alocal === 'src') {
        if (!SAFE_LINK.test(decodeEntities(value).trim())) continue;
      } else if (dangerousValue(value)) continue;
      kept.push(` ${an}="${attrOut(value)}"`);
    }
    emit(`<${name}${kept.join('')}${selfClose ? '/>' : '>'}`);
  }
  // CSS that could load from elsewhere (embedded fonts and images are data: URLs).
  out = stripCssLoads(out);
  out = out.replace(/(javascript|vbscript):/gi, '');
  return out;
}

/**
 * url(...) that isn't data: or #id becomes none, and @import ...; goes. A forward scan, so a crafted
 * file ("url(" thousands of times with no ")") takes linear time; an unfinished one drops the rest.
 */
function stripCssLoads(s) {
  const low = s.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const u = low.indexOf('url(', i);
    const m = low.indexOf('@import', i);
    if (u === -1 && m === -1) break;
    if (m !== -1 && (u === -1 || m < u)) {
      const semi = low.indexOf(';', m);
      out += s.slice(i, m);
      if (semi === -1) return out;
      i = semi + 1;
      continue;
    }
    const close = low.indexOf(')', u);
    if (close === -1) return out + s.slice(i, u) + 'none';
    const inner = low.slice(u + 4, close).replace(/^\s*['"]?\s*/, '');
    out += s.slice(i, u) + (inner.startsWith('data:') || inner.startsWith('#') ? s.slice(u, close + 1) : 'none');
    i = close + 1;
  }
  return out + s.slice(i);
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
