'use strict';

/**
 * Sending print jobs to outside printing houses.
 *
 *  - Printing houses: name, email and/or WhatsApp number, preferred channel.
 *  - Each product can have a default printing house.
 *  - A job is sent by email (Brevo, files attached when small enough, plus
 *    links) or by WhatsApp (a wa.me link the admin opens; the message holds
 *    the download links, since WhatsApp links cannot carry attachments).
 *  - Download links are signed and expire, so only the printing house that
 *    got the message can download the files, and only for a while.
 */
const crypto = require('crypto');
const { normalizeEgyptMobile, normalizeDigits } = require('./egypt');

const LINK_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pick = (v, lang) => (v && typeof v === 'object' ? v[lang] || v.en : v);

// ---------- Signed download links ----------
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function signLink(key, { designId, side, format, days = LINK_DAYS }) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = b64(JSON.stringify({ d: designId, s: side, f: format, e: exp }));
  const sig = b64(crypto.createHmac('sha256', key).update(body).digest()).slice(0, 32);
  return { token: `${body}.${sig}`, expires: new Date(exp * 1000).toISOString() };
}
/** Returns { designId, side, format } or null when the link is bad or expired. */
function readLink(key, token) {
  const m = /^([A-Za-z0-9_-]{10,400})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!m) return null;
  const want = b64(crypto.createHmac('sha256', key).update(m[1]).digest()).slice(0, 32);
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!p || typeof p.e !== 'number' || p.e * 1000 < Date.now()) return null;
  return { designId: String(p.d), side: String(p.s), format: String(p.f) };
}

// ---------- Printing houses ----------
/** WhatsApp number in international digits (Egyptian 01… becomes 201…), or null. */
function whatsappDigits(input) {
  const raw = normalizeDigits(String(input || '')).trim();
  if (!raw) return '';
  const eg = normalizeEgyptMobile(raw);
  if (eg) return '20' + eg.slice(1);
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  return /^\d{8,15}$/.test(d) ? d : null;
}

/** Checks and cleans a printing house from the admin form; returns { house } or { error }. */
function cleanHouse(input) {
  const name = String((input && input.name) || '').trim().slice(0, 80);
  const email = String((input && input.email) || '').trim().slice(0, 120);
  const whatsapp = whatsappDigits(input && input.whatsapp);
  const notes = String((input && input.notes) || '').trim().slice(0, 300);
  if (!name) return { error: 'houseName' };
  if (email && !EMAIL_RE.test(email)) return { error: 'houseEmail' };
  if (whatsapp === null) return { error: 'houseWhatsApp' };
  if (!email && !whatsapp) return { error: 'houseContact' };
  let prefer = input && input.prefer === 'whatsapp' ? 'whatsapp' : 'email';
  if (prefer === 'email' && !email) prefer = 'whatsapp';
  if (prefer === 'whatsapp' && !whatsapp) prefer = 'email';
  return { house: { name, email, whatsapp, prefer, notes } };
}

// ---------- The message ----------
const T = {
  en: {
    dir: 'ltr', hello: (n) => `Hello ${n},`, intro: 'Please print the following job for OneOff Print:',
    order: 'Order', product: 'Product', colour: 'Colour / size', method: 'Print method', sides: 'Print areas', qty: 'Quantity',
    note: 'Note', files: 'Files', attached: 'attached to this email', expires: (d) => `Download links work until ${d}.`,
    thanks: 'Thank you!', subject: (o, p) => `Print job ${o} · ${p}`,
  },
  ar: {
    dir: 'rtl', hello: (n) => `أهلًا ${n}،`, intro: 'من فضلك اطبعوا الشغل ده لـ OneOff Print:',
    order: 'الطلب', product: 'المنتج', colour: 'اللون / المقاس', method: 'طريقة الطباعة', sides: 'أماكن الطباعة', qty: 'الكمية',
    note: 'ملاحظة', files: 'الملفات', attached: 'مرفقة في الإيميل ده', expires: (d) => `روابط التحميل شغالة لحد ${d}.`,
    thanks: 'شكرًا!', subject: (o, p) => `شغل طباعة ${o} · ${p}`,
  },
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cm = (inches) => Math.round(inches * 2.54 * 10) / 10;

/** The job's facts, in the admin's language. */
function jobLines(order, item, design, lang) {
  const t = T[lang];
  const sides = (design.sides || [])
    .filter((s) => s.widthIn)
    .map((s) => `${pick(s.name, lang)} ${cm(s.widthIn)} × ${cm(s.heightIn)} cm`)
    .join(' + ');
  return [
    [t.order, `${order.number} (${item.position}/${order.items.length})`],
    [t.product, pick(item.productName, lang)],
    [t.colour, [pick(item.color && item.color.name, lang), pick(item.size && item.size.label, lang)].filter(Boolean).join(' · ')],
    [t.method, String(item.process || '').toUpperCase()],
    ...(sides ? [[t.sides, sides]] : []),
    [t.qty, '1'],
  ].filter(([, v]) => v);
}

function whatsappText({ house, order, item, design, files, note, lang, expires }) {
  const t = T[lang];
  return [
    t.hello(house.name),
    t.intro,
    '',
    ...jobLines(order, item, design, lang).map(([k, v]) => `*${k}:* ${v}`),
    ...(note ? ['', `*${t.note}:* ${note}`] : []),
    '',
    `*${t.files}:*`,
    ...files.map((f) => `• ${f.label}: ${f.url}`),
    '',
    t.expires(expires.slice(0, 10)),
    t.thanks,
  ].join('\n');
}

function emailBody({ house, order, item, design, files, note, lang, expires, attached }) {
  const t = T[lang];
  const rows = jobLines(order, item, design, lang).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  const list = files.map((f) => `<li style="margin:4px 0"><a href="${esc(f.url)}">${esc(f.label)}</a> <span style="color:#888">(${esc(f.name)})</span></li>`).join('');
  const html = `<div dir="${t.dir}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${esc(t.hello(house.name))}</p><p>${esc(t.intro)}</p>
<table style="border-collapse:collapse;margin:8px 0 14px">${rows}</table>
${note ? `<p><strong>${esc(t.note)}:</strong> ${esc(note)}</p>` : ''}
<p style="margin-bottom:4px"><strong>${esc(t.files)}</strong>${attached ? ` (${esc(t.attached)})` : ''}:</p><ul style="margin-top:0">${list}</ul>
<p style="color:#666;font-size:13px">${esc(t.expires(expires.slice(0, 10)))}</p><p>${esc(t.thanks)}</p></div>`;
  const text = [
    t.hello(house.name), t.intro, '',
    ...jobLines(order, item, design, lang).map(([k, v]) => `${k}: ${v}`),
    ...(note ? ['', `${t.note}: ${note}`] : []),
    '', `${t.files}${attached ? ` (${t.attached})` : ''}:`,
    ...files.map((f) => `- ${f.label}: ${f.url}`),
    '', t.expires(expires.slice(0, 10)), t.thanks,
  ].join('\n');
  return { subject: t.subject(order.number, pick(item.productName, lang)), html, text };
}

module.exports = { LINK_DAYS, signLink, readLink, whatsappDigits, cleanHouse, whatsappText, emailBody };
