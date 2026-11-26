'use strict';

/*
 * Private preview: until the shop opens to everyone, only people the owner invites get in.
 *
 * The owner turns it on and off in the dashboard (Private preview) and adds people there. Each
 * person gets a personal code and link (https://<shop>/?invite=CODE). Opening the link, or typing
 * the code on the "Opening soon" page, gives that browser a signed cookie for 60 days. The owner
 * and staff get the same cookie when they sign in to the dashboard. Everyone else sees the
 * "Opening soon" page; data and pictures answer 403.
 *
 * Saved in the shop's store as db.preview = { on, people: [{ id, name, code, createdAt, lastSeen,
 * visits, off }] }. Turning a person off (or removing them) shuts their browsers out at once: the
 * cookie names the person, and is only accepted while they are on the list and not off.
 */
const crypto = require('crypto');

const COOKIE = 'ebda3_preview';
const DAYS = 60;
// No 0/O or 1/I: codes are read out and typed on phones.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

/** A new personal code, e.g. "K7QX4MPA". */
function newCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}
/** A typed code as stored: capitals, no spaces or dashes ("k7qx-4mpa" -> "K7QX4MPA"). */
// (Arabic-Indic digits, as an Arabic phone keyboard types them, count as the same digits.)
const westernDigits = (s) => String(s == null ? '' : s).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
const normCode = (s) => westernDigits(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
/** A code the owner typed uses only English letters and digits (and "@", spaces, dashes, dots to ignore). */
const codeTyped = (s) => /^[A-Za-z0-9@\s._-]+$/.test(westernDigits(s));

const mac = (key, body) => crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 32);
/** The cookie value for `who` ('owner', 's-<staff id>' or 'p-<person id>'): who.expiry.signature. */
function sign(key, who, now = Date.now()) {
  const body = `${who}.${Math.floor(now / 1000) + DAYS * 86400}`;
  return `${body}.${mac(key, body)}`;
}
/** { who } for a cookie value this shop signed and that hasn't expired, else null. */
function verify(key, value, now = Date.now()) {
  const m = /^([a-z]+(?:-[A-Za-z0-9_-]{1,64})?)\.(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(String(value || ''));
  if (!m) return null;
  const want = Buffer.from(mac(key, `${m[1]}.${m[2]}`));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (Number(m[2]) * 1000 < now) return null;
  return { who: m[1] };
}
/** The Set-Cookie value (an empty value clears it). */
function cookie(value, { secure }) {
  return `${COOKIE}=${value || ''}; Path=/; Max-Age=${value ? DAYS * 86400 : 0}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
function cookieFrom(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.get('cookie') || '');
  return m ? m[1] : '';
}

/**
 * What anyone may reach while the shop is private: the files the "Opening soon" page and the
 * dashboard's sign-in need (code, styles, fonts, the logo and icons; no product pictures or data),
 * the dashboard itself (its data needs the owner's or staff's sign-in), the code form, and the
 * signed download links sent to printing houses.
 */
function isOpen(p) {
  return /^\/(?:js|css|vendor|fonts)\/[^]*$/.test(p)
    || /^\/(?:favicon\.(?:ico|svg)|apple-touch-icon\.png|icon-(?:192|512|maskable-512)\.png|site\.webmanifest|robots\.txt)$/.test(p)
    || p === '/sw.js' || /^\/offline(?:\.html)?$/.test(p) // the installed app's worker and its "no connection" page
    // The phone apps: Google's and Apple's checks that the shop's links may open in the app (fetched without cookies),
    // and the apps' own settings, read before a person may be invited. (Owner's OK, 26 Nov.)
    || p === '/.well-known/assetlinks.json' || p === '/.well-known/apple-app-site-association' || p === '/app/config.json'
    || /^\/img\/logo-[a-z-]+\.svg$/.test(p) || p === '/img/og-ebda3.png' // (the link preview on WhatsApp)
    || /^\/admin(?:\.html)?\/?$/i.test(p) // the dashboard: its own password, however the address is written
    || p.startsWith('/api/admin/')
    || p === '/api/preview/enter'
    || p.startsWith('/dl/');
}

/** A person as the dashboard shows them (with their link on this shop). */
const personRow = (p, base) => ({
  id: p.id, name: p.name, code: p.code, link: base ? `${base}/?invite=${p.code}` : `/?invite=${p.code}`,
  createdAt: p.createdAt, lastSeen: p.lastSeen || null, visits: p.visits || 0, off: Boolean(p.off),
});
/** A name for a person: plain text, one line, up to 60 characters. */
const cleanName = (v) => {
  // (No invisible direction marks or blank-looking letters: a name has to show something. QA 25 Nov.)
  // (The zero-width joiner stays: it holds emoji like 👩‍💻 together. QA 25 Nov.)
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\u2800\u3164\ufeff\uffa0]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  return /[\p{L}\p{N}\p{S}]/u.test(s) ? s : '';
};

module.exports = { COOKIE, DAYS, newCode, normCode, codeTyped, sign, verify, cookie, cookieFrom, isOpen, personRow, cleanName };
