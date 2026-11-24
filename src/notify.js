'use strict';

/*
 * Order notifications.
 *   - Admin: a WhatsApp message (CallMeBot, free, to the admin's own number)
 *     and an email (Brevo).
 *   - Customer: a confirmation email (Brevo) when they gave an email address.
 *     (Their WhatsApp confirmation is a button on the order page that opens a
 *     chat with the shop's number; see SHOP_WHATSAPP.)
 * Every channel is optional and switched on by its environment variables.
 * Sending never blocks or fails an order: results are recorded on it.
 */
const { GOVERNORATES } = require('./egypt');

const env = (k) => (process.env[k] || '').trim();
const config = () => ({
  brevoKey: env('BREVO_API_KEY'),
  brevoUrl: env('BREVO_API_URL') || 'https://api.brevo.com/v3/smtp/email',
  mailFrom: env('MAIL_FROM'),
  mailFromName: env('MAIL_FROM_NAME') || 'OneOff Print',
  adminEmail: env('ADMIN_EMAIL'),
  adminLang: env('ADMIN_LANG') === 'en' ? 'en' : 'ar',
  callmebotPhone: env('CALLMEBOT_PHONE'),
  callmebotKey: env('CALLMEBOT_APIKEY'),
  callmebotUrl: env('CALLMEBOT_URL') || 'https://api.callmebot.com/whatsapp.php',
  shopWhatsApp: env('SHOP_WHATSAPP').replace(/[^\d]/g, ''),
  siteUrl: env('SITE_URL').replace(/\/+$/, ''),
});

/** Which channels are set up (for the admin dashboard). */
function status() {
  const c = config();
  const email = Boolean(c.brevoKey && c.mailFrom);
  return {
    adminWhatsApp: Boolean(c.callmebotPhone && c.callmebotKey),
    adminEmail: email && Boolean(c.adminEmail),
    customerEmail: email,
    customerWhatsAppButton: Boolean(c.shopWhatsApp),
  };
}

// ---------- Text helpers ----------
const L = {
  ar: {
    newOrder: 'طلب جديد', items: (n) => `${n} ${n === 1 ? 'منتج' : n === 2 ? 'منتجان' : n <= 10 ? 'منتجات' : 'منتج'}`,
    total: 'الإجمالي', subtotal: 'المنتجات', discount: 'الخصم', shipping: 'الشحن', free: 'مجاني', cod: 'الدفع عند الاستلام',
    customer: 'العميل', phone: 'الموبايل', email: 'البريد', address: 'العنوان', notes: 'ملاحظات',
    openAdmin: 'افتح لوحة الإنتاج', track: 'تابع طلبك',
    thanksSubject: (n) => `تم استلام طلبك ${n} · OneOff Print`,
    thanksHi: (name) => `أهلًا ${name}،`,
    thanksBody: 'شكرًا لطلبك! استلمنا طلبك وهنبدأ نطبع كل قطعة مخصوص ليك. هنتواصل معاك قبل الشحن.',
    adminSubject: (n, total) => `طلب جديد ${n} · ${total}`,
    sides: ' + ', dir: 'rtl', test: 'رسالة تجريبية من متجرك: الإشعارات شغالة ✅',
    shippedSubject: (n) => `طلبك ${n} في الطريق ليك · OneOff Print`,
    shippedBody: 'طلبك اتشحن وفي الطريق ليك! جهّز المبلغ للمندوب عند الاستلام.',
    shippedBodyPaid: 'طلبك اتشحن وفي الطريق ليك!',
    courier: 'شركة الشحن', trackingNumber: 'رقم التتبع', trackingLink: 'تتبع الشحنة عند شركة الشحن', eta: 'الاستلام المتوقع',
    invoice: 'الفاتورة', copies: (n) => `${n} نسخ`, order: 'الطلب',
  },
  en: {
    newOrder: 'New order', items: (n) => `${n} item${n === 1 ? '' : 's'}`,
    total: 'Total', subtotal: 'Items', discount: 'Discount', shipping: 'Shipping', free: 'Free', cod: 'Cash on delivery',
    customer: 'Customer', phone: 'Mobile', email: 'Email', address: 'Address', notes: 'Notes',
    openAdmin: 'Open the production dashboard', track: 'Track your order',
    thanksSubject: (n) => `We received your order ${n} · OneOff Print`,
    thanksHi: (name) => `Hi ${name},`,
    thanksBody: 'Thank you for your order! We have received it and will print each item just for you. We will contact you before shipping.',
    adminSubject: (n, total) => `New order ${n} · ${total}`,
    sides: ' + ', dir: 'ltr', test: 'Test message from your shop: notifications are working ✅',
    shippedSubject: (n) => `Your order ${n} is on its way · OneOff Print`,
    shippedBody: 'Your order has shipped and is on its way to you! Please have the amount ready for the courier on delivery.',
    shippedBodyPaid: 'Your order has shipped and is on its way to you!',
    courier: 'Courier', trackingNumber: 'Tracking number', trackingLink: 'Track the parcel with the courier', eta: 'Expected delivery',
    invoice: 'Invoice', copies: (n) => `${n} copies`, order: 'Order',
  },
};
const tr = (v, lang) => (v && typeof v === 'object' ? v[lang] || v.en || '' : String(v == null ? '' : v));
function money(n, lang) {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n);
  } catch (e) {
    return `${n} EGP`;
  }
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const govName = (id, lang) => tr((GOVERNORATES.find((g) => g.id === id) || {}).name, lang) || id;
const itemLine = (it, lang) => `${tr(it.productName, lang)} · ${tr(it.color.name, lang)} · ${tr(it.size.label, lang)} · ${it.sides.map((s) => tr(s.name, lang)).join(L[lang].sides)}`;
const addressOf = (c, lang) => [c.address, c.city, govName(c.governorate, lang)].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');

// ---------- Messages ----------
function adminWhatsAppText(order, links, lang) {
  const t = L[lang];
  const c = order.customer;
  const lines = [
    `🛒 ${t.newOrder} ${order.number}`,
    `${t.items(order.items.length)} · ${t.total} ${money(order.total, lang)} (${t.cod})`,
    `${c.name} · ${c.phone}`,
    addressOf(c, lang),
    ...order.items.slice(0, 10).map((it) => `- ${itemLine(it, lang)}`),
    order.items.length > 10 ? '…' : '',
    c.notes ? `${t.notes}: ${c.notes}` : '',
    links.admin,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 1500);
}

function emailHtml(order, links, lang, forAdmin) {
  const t = L[lang];
  const c = order.customer;
  const rows = order.items.map((it, i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${i + 1}. ${esc(itemLine(it, lang))}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap;text-align:${lang === 'ar' ? 'left' : 'right'}">${esc(money(it.price, lang))}</td>
    </tr>`).join('');
  const sum = (label, value, bold) => `<tr><td style="padding:4px 0;${bold ? 'font-weight:700' : ''}">${esc(label)}</td><td style="padding:4px 0;text-align:${lang === 'ar' ? 'left' : 'right'};${bold ? 'font-weight:700' : ''}">${esc(value)}</td></tr>`;
  const intro = forAdmin
    ? `<h2 style="margin:0 0 12px">🛒 ${esc(t.newOrder)} ${esc(order.number)}</h2>`
    : `<h2 style="margin:0 0 12px">${esc(t.thanksHi(c.name))}</h2><p style="margin:0 0 16px">${esc(t.thanksBody)}</p><p style="margin:0 0 12px;font-weight:700">${esc(order.number)}</p>`;
  const details = forAdmin
    ? `<table style="width:100%;margin-top:16px;border-collapse:collapse">
        ${sum(t.customer, c.name)}${sum(t.phone, c.phone)}${c.email ? sum(t.email, c.email) : ''}${sum(t.address, addressOf(c, lang))}${c.notes ? sum(t.notes, c.notes) : ''}
      </table>`
    : `<p style="margin:16px 0 0;color:#555">${esc(t.address)}: ${esc(addressOf(c, lang))}</p>`;
  const link = forAdmin ? links.admin : links.track;
  const button = link ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="background:#ff5a36;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:700">${esc(forAdmin ? t.openAdmin : t.track)}</a></p>` : '';
  return `<!doctype html><html lang="${lang}" dir="${t.dir}"><body style="margin:0;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;color:#16181d">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="font-weight:800;font-size:18px;margin-bottom:16px">OneOff Print</div>
    <div style="background:#fff;border-radius:14px;padding:20px;direction:${t.dir};text-align:${lang === 'ar' ? 'right' : 'left'}">
      ${intro}
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <table style="width:100%;margin-top:12px;border-collapse:collapse">
        ${sum(t.subtotal, money(order.subtotal, lang))}
        ${order.discount ? sum(`${t.discount} (${order.coupon ? order.coupon.code : ''})`, `-${money(order.discount, lang)}`) : ''}
        ${sum(t.shipping, order.shipping ? money(order.shipping, lang) : t.free)}
        ${sum(`${t.total} (${t.cod})`, money(order.total, lang), true)}
      </table>
      ${details}
      ${button}
    </div>
  </div></body></html>`;
}
const emailText = (order, links, lang, forAdmin) => {
  const t = L[lang];
  const c = order.customer;
  return [
    forAdmin ? `${t.newOrder} ${order.number}` : `${t.thanksHi(c.name)}\n${t.thanksBody}\n${order.number}`,
    '',
    ...order.items.map((it, i) => `${i + 1}. ${itemLine(it, lang)} · ${money(it.price, lang)}`),
    '',
    `${t.total} (${t.cod}): ${money(order.total, lang)}`,
    forAdmin ? `${t.customer}: ${c.name} · ${c.phone}${c.email ? ' · ' + c.email : ''}\n${t.address}: ${addressOf(c, lang)}${c.notes ? `\n${t.notes}: ${c.notes}` : ''}` : `${t.address}: ${addressOf(c, lang)}`,
    '',
    forAdmin ? links.admin : links.track,
  ].filter((x) => x !== undefined).join('\n');
};

// ---------- Senders ----------
async function sendEmail(cfg, to, subject, html, text, attachments) {
  const res = await fetch(cfg.brevoUrl, {
    method: 'POST',
    headers: { 'api-key': cfg.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: cfg.mailFrom, name: cfg.mailFromName }, to: [{ email: to }], subject, htmlContent: html, textContent: text,
      ...(attachments && attachments.length ? { attachment: attachments.map((a) => ({ name: a.name, content: a.data.toString('base64') })) } : {}),
    }),
    signal: AbortSignal.timeout(attachments && attachments.length ? 60000 : 15000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
async function sendWhatsApp(cfg, text) {
  const url = `${cfg.callmebotUrl}?phone=${encodeURIComponent(cfg.callmebotPhone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(cfg.callmebotKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  // CallMeBot answers 200 with an HTML page; failures mention an error in it.
  if (!res.ok || /error|invalid|not\s+allowed/i.test(body.replace(/<[^>]+>/g, ' ').slice(0, 2000))) throw new Error(`CallMeBot ${res.status}: ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
}

/** Send every configured notification for a new order. Returns a result per channel. */
async function orderPlaced(order, { origin, lang }) {
  const cfg = config();
  const base = cfg.siteUrl || origin || '';
  const links = { admin: base ? `${base}/admin` : '', track: base ? `${base}/order?id=${order.id}` : '' };
  const adminLang = cfg.adminLang;
  const custLang = lang === 'en' ? 'en' : 'ar';
  const result = {};
  const run = async (key, enabled, fn) => {
    if (!enabled) { result[key] = 'off'; return; }
    try {
      await fn();
      result[key] = 'sent';
    } catch (e) {
      result[key] = 'failed';
      console.warn(`[notify] ${key} for ${order.number} failed: ${e.message}`);
    }
  };
  const st = status();
  await Promise.all([
    run('adminWhatsApp', st.adminWhatsApp, () => sendWhatsApp(cfg, adminWhatsAppText(order, links, adminLang))),
    run('adminEmail', st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, L[adminLang].adminSubject(order.number, money(order.total, adminLang)), emailHtml(order, links, adminLang, true), emailText(order, links, adminLang, true))),
    run('customerEmail', st.customerEmail && Boolean(order.customer.email), () => sendEmail(cfg, order.customer.email, L[custLang].thanksSubject(order.number), emailHtml(order, links, custLang, false), emailText(order, links, custLang, false))),
  ]);
  return result;
}

/** A test message to the admin on every configured admin channel. */
async function adminTest() {
  const cfg = config();
  const st = status();
  const t = L[cfg.adminLang];
  const result = {};
  const run = async (key, enabled, fn) => {
    if (!enabled) { result[key] = 'off'; return; }
    try { await fn(); result[key] = 'sent'; } catch (e) { result[key] = 'failed'; result[key + 'Error'] = e.message.slice(0, 200); }
  };
  await Promise.all([
    run('adminWhatsApp', st.adminWhatsApp, () => sendWhatsApp(cfg, t.test)),
    run('adminEmail', st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, 'OneOff Print · ✅', `<p dir="${t.dir}">${esc(t.test)}</p>`, t.test)),
  ]);
  return result;
}

/** Email to anyone (printing houses), with optional attachments [{ name, data }]. */
function emailReady() {
  const c = config();
  return Boolean(c.brevoKey && c.mailFrom);
}
async function emailTo(to, subject, html, text, attachments) {
  await sendEmail(config(), to, subject, html, text, attachments);
}

// ---------- "Your order has shipped" (to the customer) ----------
const safeLine = (it, lang) => {
  try {
    const parts = [tr(it.productName, lang), it.color && tr(it.color.name, lang), it.size && tr(it.size.label, lang),
      (it.sides || []).map((s) => tr(s.name, lang)).filter(Boolean).join(L[lang].sides)].filter(Boolean);
    const copies = Number(it.copies) > 1 ? ` · ${L[lang].copies(Number(it.copies))}` : '';
    return parts.join(' · ') + copies;
  } catch (e) {
    return tr(it && it.productName, lang);
  }
};
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');
function etaText(eta, lang) {
  if (!eta || !/^\d{4}-\d{2}-\d{2}$/.test(eta)) return eta ? String(eta) : '';
  try {
    return new Date(`${eta}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (e) {
    return eta;
  }
}

function shippedContent(order, links, lang) {
  const t = L[lang];
  const c = order.customer || {};
  const sh = order.shipment || {};
  const paid = order.payment && order.payment.status === 'paid';
  const body = paid ? t.shippedBodyPaid : t.shippedBody;
  const trackingUrl = httpUrl(sh.trackingUrl);
  const facts = [
    sh.courier ? [t.courier, sh.courier] : null,
    sh.trackingNumber ? [t.trackingNumber, sh.trackingNumber] : null,
    sh.eta ? [t.eta, etaText(sh.eta, lang)] : null,
  ].filter(Boolean);
  const items = (order.items || []).map((it, i) => `${i + 1}. ${safeLine(it, lang)}`);
  const end = lang === 'ar' ? 'left' : 'right';
  const button = (href, label, primary) => `<a href="${esc(href)}" style="${primary ? 'background:#ff5a36;color:#fff;' : 'background:#fff;color:#16181d;border:1px solid #d5d8de;'}text-decoration:none;padding:11px 18px;border-radius:10px;display:inline-block;font-weight:700;margin:0 0 8px">${esc(label)}</a>`;
  const html = `<!doctype html><html lang="${lang}" dir="${t.dir}"><body style="margin:0;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;color:#16181d">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="font-weight:800;font-size:18px;margin-bottom:16px">OneOff Print</div>
    <div style="background:#fff;border-radius:14px;padding:20px;direction:${t.dir};text-align:${lang === 'ar' ? 'right' : 'left'}">
      <h2 style="margin:0 0 12px">📦 ${esc(t.thanksHi(c.name || ''))}</h2>
      <p style="margin:0 0 16px;line-height:1.6">${esc(body)}</p>
      <p style="margin:0 0 12px;font-weight:700">${esc(t.order)} ${esc(order.number)}</p>
      ${facts.length ? `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;background:#f8f9fb;border-radius:10px">${facts.map(([k, v]) => `<tr><td style="padding:8px 12px;color:#555">${esc(k)}</td><td style="padding:8px 12px;text-align:${end};font-weight:700"><bdi>${esc(v)}</bdi></td></tr>`).join('')}</table>` : ''}
      <table style="width:100%;border-collapse:collapse">${items.map((line) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(line)}</td></tr>`).join('')}</table>
      <p style="margin:12px 0 0;font-weight:700">${esc(t.total)}${paid ? '' : ` (${esc(t.cod)})`}: ${esc(money(order.total, lang))}</p>
      <p style="margin:20px 0 0">${[
        trackingUrl ? button(trackingUrl, t.trackingLink, true) : '',
        links.track ? button(links.track, t.track, !trackingUrl) : '',
        links.invoice ? button(links.invoice, t.invoice, false) : '',
      ].filter(Boolean).join(' ')}</p>
    </div>
  </div></body></html>`;
  const text = [
    t.thanksHi(c.name || ''),
    body,
    `${t.order} ${order.number}`,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    trackingUrl ? `${t.trackingLink}: ${trackingUrl}` : '',
    '',
    ...items,
    '',
    `${t.total}${paid ? '' : ` (${t.cod})`}: ${money(order.total, lang)}`,
    links.track ? `${t.track}: ${links.track}` : '',
    links.invoice ? `${t.invoice}: ${links.invoice}` : '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject: t.shippedSubject(order.number), html, text };
}

/**
 * Email the customer that their order has shipped (courier, tracking and links to the
 * order page and the invoice), in the language they ordered in. Never throws.
 * Returns { email: 'sent' | 'skipped' | 'failed', reason? }.
 */
async function orderShipped(order, { siteUrl } = {}) {
  try {
    const cfg = config();
    const to = order && order.customer && String(order.customer.email || '').trim();
    if (!to) return { email: 'skipped', reason: 'noEmail' };
    if (!emailReady()) return { email: 'skipped', reason: 'emailOff' };
    const base = (cfg.siteUrl || String(siteUrl || '')).replace(/\/+$/, '');
    const id = encodeURIComponent(order.id);
    const links = { track: base ? `${base}/order?id=${id}` : '', invoice: base ? `${base}/invoice?id=${id}` : '' };
    const lang = order.lang === 'en' ? 'en' : 'ar';
    const { subject, html, text } = shippedContent(order, links, lang);
    await sendEmail(cfg, to, subject, html, text);
    return { email: 'sent' };
  } catch (e) {
    console.warn(`[notify] shipped email for ${order && order.number} failed: ${e.message}`);
    return { email: 'failed', error: String(e.message || e).slice(0, 200) };
  }
}

/**
 * Email the customer about a proof: a new proof to approve (kind 'proof') or
 * the shop asking for changes (kind 'changes'), with the shop's note and the
 * link. In the customer's language. Never throws. Returns like orderShipped.
 */
async function proofMessage(order, item, { kind = 'proof', note = '', link = '' } = {}) {
  try {
    const cfg = config();
    const to = order && order.customer && String(order.customer.email || '').trim();
    if (!to) return { email: 'skipped', reason: 'noEmail' };
    if (!emailReady()) return { email: 'skipped', reason: 'emailOff' };
    const ar = order.lang !== 'en';
    const h = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const product = item && item.productName ? (ar ? item.productName.ar : item.productName.en) || '' : '';
    const T = ar
      ? {
        subject: kind === 'proof' ? `طلبك ${order.number}: نحتاج موافقتك على البروفة` : `طلبك ${order.number}: مطلوب تعديل قبل الطباعة`,
        lead: kind === 'proof' ? `جهّزنا بروفة جديدة لـ ${product}. راجعها ووافق عليها لنبدأ الطباعة.` : `راجعنا ${product} ونحتاج إلى تعديل قبل الطباعة.`,
        button: kind === 'proof' ? 'راجع البروفة' : 'افتح الطلب',
        noteLabel: 'رسالة من المطبعة:',
        screen: 'هذه بروفة على الشاشة؛ قد تختلف الألوان المطبوعة قليلًا عمّا تراه على شاشتك.',
      }
      : {
        subject: kind === 'proof' ? `Order ${order.number}: please approve your proof` : `Order ${order.number}: a change is needed before printing`,
        lead: kind === 'proof' ? `We have a new proof for your ${product}. Please check and approve it so we can print.` : `We checked your ${product} and something needs changing before we print.`,
        button: kind === 'proof' ? 'Check the proof' : 'Open your order',
        noteLabel: 'Message from the print shop:',
        screen: 'This is a screen proof; printed colours can look a little different from your screen.',
      };
    const dir = ar ? 'rtl' : 'ltr';
    const html = `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1f27">
      <p>${h(T.lead)}</p>
      ${note ? `<p><strong>${h(T.noteLabel)}</strong><br>${h(note).replace(/\n/g, '<br>')}</p>` : ''}
      ${/^https?:\/\//.test(link) ? `<p><a href="${h(link)}" style="display:inline-block;background:#ff5a36;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${h(T.button)}</a></p>` : ''}
      <p style="color:#666;font-size:13px">${h(T.screen)}</p></div>`;
    const text = [T.lead, note ? `${T.noteLabel} ${note}` : '', link, T.screen].filter(Boolean).join('\n\n');
    await sendEmail(cfg, to, T.subject, html, text);
    return { email: 'sent' };
  } catch (e) {
    console.warn(`[notify] proof email for ${order && order.number} failed: ${e.message}`);
    return { email: 'failed', error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { status, orderPlaced, orderShipped, proofMessage, adminTest, emailReady, emailTo, shopWhatsApp: () => config().shopWhatsApp, siteUrl: () => config().siteUrl };
