'use strict';

/**
 * Customer accounts: sign up / sign in with a mobile number (or email) and a
 * password, then see previous orders and their status, keep a delivery
 * address, change the password.
 *
 *  - Passwords: scrypt with a random salt per customer; compared in constant time.
 *  - Sessions: a signed token in an httpOnly, SameSite=Lax cookie (60 days):
 *    "<id>.<expiry>.<password version>.<hmac>". The key comes from the shop's
 *    secret file, so every copy of the app accepts it; changing the password
 *    bumps the version, which signs out every other device.
 *  - Password reset: a signed link valid for 1 hour, sent by email.
 */
const crypto = require('crypto');
const { normalizeEgyptMobile } = require('./egypt');
const { customerPasswordProblem } = require('./passwords');

const COOKIE = 'pod_c';
const SESSION_DAYS = 60;
/**
 * An address that can receive mail: no spaces, commas, semicolons or brackets, no "..", a domain
 * of letters, digits and inner hyphens ending in a 2+ letter top-level name ("a@b.com", not
 * "a@b.com," "a@b..com" or "a@b"). The same pattern as src/app.js and src/dispatch.js.
 */
const EMAIL_RE = /^(?!.*\.\.)[^\s@,;<>()"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
/**
 * An email as typed, as it is kept: lower case, without spaces around it or the dots, commas and
 * semicolons a phone or a copied list leaves at the end (a double space types ". ", so
 * "dot.test@gmail.com." is "dot.test@gmail.com"). Not checked here: see EMAIL_RE.
 */
function cleanEmail(v) {
  const s = String(v == null ? '' : v).trim();
  let end = s.length;
  while (end > 0 && /[\s.,;]/.test(s[end - 1])) end--;
  return s.slice(0, end).toLowerCase();
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function checkPassword(customer, password) {
  if (!customer || !customer.passHash) return false;
  const { hash } = hashPassword(password, customer.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(customer.passHash, 'hex'));
}

function sign(key, parts) {
  const body = parts.join('.');
  return `${body}.${b64(crypto.createHmac('sha256', key).update(body).digest()).slice(0, 32)}`;
}
function verify(key, token, count) {
  const parts = String(token || '').split('.');
  if (parts.length !== count + 1) return null;
  const sig = parts.pop();
  const want = sign(key, parts).split('.').pop();
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return parts;
}
function sessionToken(key, customer) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return sign(key, [customer.id, exp.toString(36), String(customer.pv || 1)]);
}
/** The customer id from a session token, if it is genuine, not expired and the password hasn't changed since. */
function readSession(key, token, findCustomer) {
  const parts = verify(key, token, 3);
  if (!parts) return null;
  const [id, exp, pv] = parts;
  if (parseInt(exp, 36) * 1000 < Date.now()) return null;
  const c = findCustomer(id);
  if (!c || String(c.pv || 1) !== pv) return null;
  return c;
}
/**
 * A password-reset link. `via`: 'e' when it was emailed to the account's
 * email (opening it proves the email is theirs), 'a' when the shop made it.
 */
/** Short fingerprint of the account's email when a link was made (a link only works for that email). */
const emailTag = (email) => crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex').slice(0, 12);
function resetToken(key, customer, hours = 1, via = 'e') {
  const exp = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  return sign(key, ['reset', customer.id, exp.toString(36), String(customer.pv || 1), via === 'a' ? 'a' : 'e', emailTag(customer.email)]);
}
/**
 * { customer, viaEmail } for a genuine, unexpired, unused reset link, else null.
 * A link stops working when the account's email changes: an emailed link
 * proves only the address it was sent to, never one typed in afterwards.
 */
function readReset(key, token, findCustomer) {
  const parts = verify(key, token, 6);
  if (!parts || parts[0] !== 'reset') return null;
  const [, id, exp, pv, via, tag] = parts;
  if (parseInt(exp, 36) * 1000 < Date.now()) return null;
  const c = findCustomer(id);
  if (!c || String(c.pv || 1) !== pv || emailTag(c.email) !== tag) return null;
  return { customer: c, viaEmail: via === 'e' };
}

/** The cookie header value for a session (or for signing out, with an empty token). */
function cookie(token, { secure }) {
  const age = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ''}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
function tokenFrom(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.get('cookie') || '');
  return m ? m[1] : '';
}

/** Checks sign-up details; returns { fields } or { error, params }. */
function cleanSignup(body) {
  const b = body && typeof body === 'object' ? body : {};
  // Only text counts (an object or a list is not a name).
  const str = (v) => (typeof v === 'string' ? v : '');
  const name = str(b.name).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const phone = typeof b.phone === 'string' ? normalizeEgyptMobile(b.phone) : null;
  const email = cleanEmail(str(b.email));
  const password = str(b.password);
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name.replace(/\u0640/g, ''))) return { error: 'acctName' };
  if (!phone) return { error: 'badPhone' };
  if (email && (email.length > 200 || !EMAIL_RE.test(email))) return { error: 'badEmail' };
  const weak = passwordProblem(password, { name, phone, email });
  if (weak) return { error: weak };
  return { fields: { name, phone, email, password } };
}
/**
 * Why a new password won't do (a message key), or null: 8 to 200 characters, not a common one ("12345678",
 * "password1"; the team's list, src/passwords.js), and not the customer's own mobile number (any spelling),
 * email or name. `who`: the account, or the sign-up's { name, phone, email }. Only when a password is chosen
 * (sign-up, change, reset): signing in with an older one still works.
 */
function passwordProblem(password, who) {
  return customerPasswordProblem(password, who);
}
/** Phone or email typed at sign-in, as stored. */
function loginKey(login) {
  const s = String(login || '').trim();
  if (s.includes('@')) return { email: cleanEmail(s) };
  const phone = normalizeEgyptMobile(s);
  return phone ? { phone } : null;
}

/** What the customer sees about themselves (never the password hash). */
function publicCustomer(c) {
  return {
    id: c.id, name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || null, createdAt: c.createdAt,
    hasPassword: Boolean(c.passHash),
    linked: { google: Boolean(c.googleId), facebook: Boolean(c.facebookId) },
  };
}

module.exports = {
  COOKIE, hashPassword, checkPassword, sessionToken, readSession, resetToken, readReset, cookie, tokenFrom,
  cleanSignup, passwordProblem, loginKey, publicCustomer, cleanEmail, EMAIL_RE,
};
