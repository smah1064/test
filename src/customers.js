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

const COOKIE = 'pod_c';
const SESSION_DAYS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
function resetToken(key, customer) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign(key, ['reset', customer.id, exp.toString(36), String(customer.pv || 1)]);
}
function readReset(key, token, findCustomer) {
  const parts = verify(key, token, 4);
  if (!parts || parts[0] !== 'reset') return null;
  const [, id, exp, pv] = parts;
  if (parseInt(exp, 36) * 1000 < Date.now()) return null;
  const c = findCustomer(id);
  return c && String(c.pv || 1) === pv ? c : null;
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
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const phone = normalizeEgyptMobile(b.phone);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const password = String(b.password || '');
  if (name.length < 2) return { error: 'acctName' };
  if (!phone) return { error: 'badPhone' };
  if (email && !EMAIL_RE.test(email)) return { error: 'badEmail' };
  const weak = passwordProblem(password);
  if (weak) return { error: weak };
  return { fields: { name, phone, email, password } };
}
function passwordProblem(password) {
  if (password.length < 8) return 'acctPasswordShort';
  if (password.length > 200) return 'acctPasswordLong';
  return null;
}
/** Phone or email typed at sign-in, as stored. */
function loginKey(login) {
  const s = String(login || '').trim();
  if (s.includes('@')) return { email: s.toLowerCase() };
  const phone = normalizeEgyptMobile(s);
  return phone ? { phone } : null;
}

/** What the customer sees about themselves (never the password hash). */
function publicCustomer(c) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email || '', address: c.address || null, createdAt: c.createdAt };
}

module.exports = {
  COOKIE, hashPassword, checkPassword, sessionToken, readSession, resetToken, readReset, cookie, tokenFrom,
  cleanSignup, passwordProblem, loginKey, publicCustomer,
};
