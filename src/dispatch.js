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
const { arabicDigits } = require('./i18n');
const { PRODUCTS } = require('./products');
const { threadName } = require('./embroidery');

const LINK_DAYS = 30;
// (The same pattern as src/app.js: an address that can receive mail.)
const EMAIL_RE = /^(?!.*\.\.)[^\s@,;<>()"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
/**
 * The shop's own bilingual words (product, colour, size, print area) in the message language. In
 * Arabic their numbers become ١٢٣ like the rest of the message ("٣٠ × ٤٠ سم ×٢", not "30 × 40 سم ×٢");
 * codes such as A4 or 2XL stay as they are.
 */
const pick = (v, lang) => {
  if (!(v && typeof v === 'object')) return v;
  const s = v[lang] || v.en;
  return lang === 'ar' && v.ar && s ? arabicDigits(s) : s;
};

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
/**
 * WhatsApp number in international digits for wa.me, '' when empty, or null when it can't be a
 * WhatsApp mobile. Egyptian mobiles (010/011/012/015, with or without the 0, +20 or 0020, Arabic
 * digits, spaces, dashes) become 201XXXXXXXXX. Egyptian landlines (02…, 03…, +20 2…) and local
 * numbers without a country code are refused; other countries need their code (+971…, 00966…).
 */
function whatsappDigits(input) {
  // Spaces, dashes, brackets and the invisible direction marks phones add when a number is copied.
  let d = normalizeDigits(String(input || '')).replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u061c\u00a0\u2010-\u2015\u2212]/g, '');
  if (!d) return '';
  const eg = normalizeEgyptMobile(d) || (/^1[0125]\d{8}$/.test(d) ? '0' + d : null); // 1001234567: the 0 left out
  if (eg) return '20' + eg.slice(1);
  let international = false;
  if (d.startsWith('+')) [d, international] = [d.slice(1), true];
  else if (d.startsWith('00')) [d, international] = [d.slice(2), true];
  if (!/^[1-9]\d{7,14}$/.test(d)) return null;
  if (d.startsWith('20')) return null; // Egypt, but not a mobile (a landline or a digit missing / extra)
  if (!international && d.length < 11) return null; // a local number without its country code
  return d;
}

/** Checks and cleans a printing house from the admin form; returns { house } or { error }. */
function cleanHouse(input) {
  const name = String((input && input.name) || '').trim().slice(0, 80);
  const email = String((input && input.email) || '').trim().replace(/[.,;\s]+$/, '').slice(0, 120);
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
    dir: 'ltr', hello: (n) => `Hello ${n},`, intro: 'Please print the following job for ebda3:',
    cm: 'cm', order: 'Order', product: 'Product', colour: 'Colour / size', method: 'Print method', sides: 'Print areas', qty: 'Quantity',
    threads: 'Thread colours, in sewing order', next: ' → ',
    placement: (v) => `moved ${v} from the standard position, see the preview PDF`,
    note: 'Note', files: 'Files', attached: 'attached to this email', expires: (d) => `Download links work until ${d}.`,
    thanks: 'Thank you!', subject: (o, p) => `Print job ${o} · ${p}`,
    express: (d) => `⚡ Express order: the customer expects it by ${d}`,
    sample: '🧪 Sample first: print ONE piece first and send us a photo of it. Print the rest only after we confirm.',
  },
  ar: {
    dir: 'rtl', hello: (n) => `أهلًا ${n}،`, intro: 'من فضلك اطبعوا الشغل ده لـ إبداع:',
    cm: 'سم', order: 'الطلب', product: 'المنتج', colour: 'اللون / المقاس', method: 'طريقة الطباعة', sides: 'أماكن الطباعة', qty: 'الكمية',
    threads: 'ألوان الخيط بترتيب التطريز', next: ' ← ',
    placement: (v) => `متحرك ${v} عن المكان القياسي، شوف ملف المعاينة`,
    note: 'ملاحظة', files: 'الملفات', attached: 'مرفقة في الإيميل ده', expires: (d) => `روابط التحميل شغالة لحد ${d}.`,
    thanks: 'شكرًا!', subject: (o, p) => `شغل طباعة ${o} · ${p}`,
    express: (d) => `⚡ طلب سريع: لازم يوصل للعميل لحد ${d}`,
    sample: '🧪 عينة الأول: اطبعوا قطعة واحدة بس الأول وابعتولنا صورتها، والباقي يتطبع بعد ما نأكد عليكم.',
  },
};
/** Print methods by their names (the process ids of src/products.js PRODUCTION / METHODS). */
const METHOD_NAMES = {
  dtg: { en: 'DTG (direct to garment)', ar: 'DTG (طباعة مباشرة على القماش)' },
  dtf: { en: 'DTF transfer', ar: 'DTF (نقل حراري)' },
  sublimation: { en: 'Sublimation', ar: 'تسامي (سبليميشن)' },
  paper: { en: 'Paper printing', ar: 'طباعة على الورق' },
  uv: { en: 'UV printing', ar: 'طباعة UV' },
  canvas: { en: 'Canvas printing', ar: 'طباعة كانفاس' },
  textile: { en: 'Textile roll printing', ar: 'طباعة أقمشة (رول)' },
  embroidery: { en: 'Embroidery', ar: 'تطريز' },
  engrave: { en: 'Laser engraving', ar: 'حفر بالليزر' },
  lasercut: { en: 'Laser cutting', ar: 'قص بالليزر' },
  cnc: { en: 'CNC routing', ar: 'حفر وقص CNC' },
  photo: { en: 'Photo prints (photo paper)', ar: 'طباعة صور (ورق فوتوغرافي)' },
  book: { en: 'Printed book', ar: 'كتاب مطبوع' },
};
/**
 * How the item is made, as process ids: an embroidered item whose other sides (or the same side, next to
 * the stitches) are printed is ['embroidery', 'dtg'], so the print is never skipped (QA 25 Nov: a printed
 * front with embroidery said only "Embroidery"). Each stored side of an embroidery design records how it is
 * made (the stitched layer 'embroidery', the printed sides the product's process); items saved before sides
 * carried their process were embroidery only.
 */
function processesOf(item) {
  if (item.kind === 'photoset') return ['photo'];
  if (item.kind === 'book') return ['book'];
  if (item.method !== 'embroidery') return item.process ? [String(item.process).toLowerCase()] : [];
  const printed = (item.sides || []).map((s) => s && s.process && String(s.process).toLowerCase()).filter((p) => p && p !== 'embroidery');
  return ['embroidery', ...new Set(printed)];
}
function methodName(item, lang) {
  const name = (id) => (METHOD_NAMES[id] ? METHOD_NAMES[id][lang] || METHOD_NAMES[id].en : id.toUpperCase());
  return processesOf(item).map(name).join(' + ');
}
/**
 * A calendar day (YYYY-MM-DD) in the message language: "Thursday 26 November" / "الخميس ٢٦ نوفمبر". The
 * express date and the download links' last day are both written this way.
 */
function dayText(ymd, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return digits(ymd || '', lang);
  try {
    return digits(new Date(ymd + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), lang);
  } catch (e) {
    return digits(ymd, lang);
  }
}
const isExpress = (order) => Boolean(order && order.delivery && order.delivery.speed === 'express');
/** The customer asked for one sample to be printed (and checked) before the rest. */
const wantsSample = (item) => Boolean(item && (item.sample === true || (item.approval && item.approval.sample === true)));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cm = (inches) => Math.round(inches * 2.54 * 10) / 10;
/** Digits in the message language: Arabic-Indic in Arabic, Latin in English. */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const digits = (v, lang) => (lang === 'ar' ? String(v).replace(/\d/g, (d) => ARABIC_DIGITS[d]).replace(/(\S)\.(\S)/g, '$1٫$2') : String(v));
/** "3 cm lower, 2 cm left" in the message language. */
function placement(o, lang) {
  const ar = lang === 'ar';
  const parts = [];
  if (o.y) parts.push(ar ? `${digits(Math.abs(o.y), lang)} سم ${o.y > 0 ? 'لتحت' : 'لفوق'}` : `${Math.abs(o.y)} cm ${o.y > 0 ? 'lower' : 'higher'}`);
  if (o.x) parts.push(ar ? `${digits(Math.abs(o.x), lang)} سم ${o.x > 0 ? 'يمين' : 'شمال'}` : `${Math.abs(o.x)} cm ${o.x > 0 ? 'right' : 'left'}`);
  return parts.join(ar ? ' و' : ', ');
}

/**
 * How many to print. Pieces add up (S ×2 + XL ×1 = 3), but packs don't: 2 × "1 voucher" and 1 × "10 vouchers"
 * are 12 vouchers, not 3, so a mix of pack sizes is written out pack by pack (QA 25 Nov).
 */
function quantityText(item, lang) {
  const lines = Array.isArray(item.quantities) && item.quantities.length ? item.quantities : null;
  if (!lines) return digits(item.copies || 1, lang);
  const product = PRODUCTS.find((p) => p.id === item.productId);
  const isPack = (l) => Boolean(product && l.size && (product.sizes.find((z) => z.id === l.size.id) || {}).pack);
  if (new Set(lines.map((l) => l.size && l.size.id)).size > 1 && lines.some(isPack)) {
    return lines.map((l) => `${pick(l.size && l.size.label, lang)} ×${digits(l.qty, lang)}`).join(' + ');
  }
  return digits(lines.reduce((n, l) => n + (l.qty || 0), 0), lang);
}

/**
 * Colour and size together: "White · 325 ml" / "أبيض، ٣٢٥ مل". In Arabic a "·" next to ١٢٣ reads badly
 * (QA 25 Nov), so the Arabic comma joins them there.
 */
const colourSize = (color, size, lang) => [pick(color && color.name, lang), pick(size && size.label, lang)].filter(Boolean).join(lang === 'ar' ? '، ' : ' · ');

/**
 * Embroidery: the thread colours in the order they are sewn, named in the message language with their hex
 * ("1. Red #d01c1f → 2. Gold #c9a227" / «١. أحمر #d01c1f ← ٢. دهبي #c9a227»). A DST file only marks where the
 * thread changes, so without this the printing house doesn't know which colours to load (QA 25 Nov). The colours
 * are the design's (digitised with the DST that is sent), else the item's. In Arabic a left-to-right mark keeps
 * the "#" in front of its code.
 */
function threadsText(item, design, lang) {
  if (!processesOf(item).includes('embroidery')) return '';
  const emb = [design && design.emb, item.emb].find((e) => e && Array.isArray(e.colors) && e.colors.length);
  if (!emb) return '';
  const t = T[lang];
  return emb.colors.map((c, k) => `${digits(k + 1, lang)}. ${threadName(c, lang)} ${lang === 'ar' ? '\u200e' : ''}${String(c.hex || '').toLowerCase()}`).join(t.next);
}

/** The job's facts, in the admin's language. */
function jobLines(order, item, design, lang) {
  const t = T[lang];
  const sides = (design.sides || [])
    .filter((s) => s.widthIn)
    .map((s) => `${pick(s.name, lang)} ${digits(cm(s.widthIn), lang)} × ${digits(cm(s.heightIn), lang)} ${t.cm}${s.offsetCm ? ` (${t.placement(placement(s.offsetCm, lang))})` : ''}`)
    .join(' + ');
  return [
    [t.order, `${order.number} (${digits(item.position, lang)}/${digits(order.items.length, lang)})`],
    [t.product, pick(item.productName, lang)],
    // Several colours / sizes: every line with its count (S×2, 2XL×1), not the design's first size. In
    // Arabic the comma is already inside each line (أبيض، M ×٣٠), so the lines are kept apart with "؛".
    [t.colour, Array.isArray(item.quantities) && item.quantities.length
      ? item.quantities.map((l) => `${colourSize(l.color, l.size, lang)} ×${digits(l.qty, lang)}`).join(lang === 'ar' ? '؛ ' : ', ')
      : colourSize(item.color, item.size, lang)],
    [t.method, methodName(item, lang)],
    [t.threads, threadsText(item, design, lang)],
    ...(sides ? [[t.sides, sides]] : []),
    [t.qty, quantityText(item, lang)],
  ].filter(([, v]) => v);
}

function whatsappText({ house, order, item, design, files, note, lang, expires }) {
  const t = T[lang];
  return [
    t.hello(house.name),
    t.intro,
    '',
    ...(isExpress(order) ? [`*${t.express(dayText(order.delivery.by, lang))}*`, ''] : []),
    ...(wantsSample(item) ? [`*${t.sample}*`, ''] : []),
    ...jobLines(order, item, design, lang).map(([k, v]) => `*${k}:* ${v}`),
    ...(note ? ['', `*${t.note}:* ${note}`] : []),
    '',
    `*${t.files}:*`,
    ...files.map((f) => `• ${f.label}: ${f.url}`),
    '',
    t.expires(dayText(expires.slice(0, 10), lang)),
    t.thanks,
  ].join('\n');
}

function emailBody({ house, order, item, design, files, note, lang, expires, attached }) {
  const t = T[lang];
  const rows = jobLines(order, item, design, lang).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  const list = files.map((f) => `<li style="margin:4px 0"><a href="${esc(f.url)}">${esc(f.label)}</a> <span style="color:#888">(${esc(f.name)})</span></li>`).join('');
  const html = `<div dir="${t.dir}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${esc(t.hello(house.name))}</p><p>${esc(t.intro)}</p>
${isExpress(order) ? `<p style="background:#fff3bf;color:#7a5800;padding:6px 10px;border-radius:6px;font-weight:700">${esc(t.express(dayText(order.delivery.by, lang)))}</p>` : ''}
${wantsSample(item) ? `<p style="background:#e7f5ff;color:#0b4f71;padding:6px 10px;border-radius:6px;font-weight:700">${esc(t.sample)}</p>` : ''}
<table style="border-collapse:collapse;margin:8px 0 14px">${rows}</table>
${note ? `<p><strong>${esc(t.note)}:</strong> ${esc(note)}</p>` : ''}
<p style="margin-bottom:4px"><strong>${esc(t.files)}</strong>${attached ? ` (${esc(t.attached)})` : ''}:</p><ul style="margin-top:0">${list}</ul>
<p style="color:#666;font-size:13px">${esc(t.expires(dayText(expires.slice(0, 10), lang)))}</p><p>${esc(t.thanks)}</p></div>`;
  const text = [
    t.hello(house.name), t.intro, '',
    ...(isExpress(order) ? [t.express(dayText(order.delivery.by, lang)), ''] : []),
    ...(wantsSample(item) ? [t.sample, ''] : []),
    ...jobLines(order, item, design, lang).map(([k, v]) => `${k}: ${v}`),
    ...(note ? ['', `${t.note}: ${note}`] : []),
    '', `${t.files}${attached ? ` (${t.attached})` : ''}:`,
    ...files.map((f) => `- ${f.label}: ${f.url}`),
    '', t.expires(dayText(expires.slice(0, 10), lang)), t.thanks,
  ].join('\n');
  return { subject: t.subject(order.number, pick(item.productName, lang)), html, text };
}

module.exports = { LINK_DAYS, signLink, readLink, whatsappDigits, cleanHouse, processesOf, methodName, whatsappText, emailBody };
