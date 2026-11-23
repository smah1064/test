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
    total: 'الإجمالي', subtotal: 'المنتجات', shipping: 'الشحن', free: 'مجاني', cod: 'الدفع عند الاستلام',
    customer: 'العميل', phone: 'الموبايل', email: 'البريد', address: 'العنوان', notes: 'ملاحظات',
    openAdmin: 'افتح لوحة الإنتاج', track: 'تابع طلبك',
    thanksSubject: (n) => `تم استلام طلبك ${n} · OneOff Print`,
    thanksHi: (name) => `أهلًا ${name}،`,
    thanksBody: 'شكرًا لطلبك! استلمنا طلبك وهنبدأ نطبع كل قطعة مخصوص ليك. هنتواصل معاك قبل الشحن.',
    adminSubject: (n, total) => `طلب جديد ${n} · ${total}`,
    sides: ' + ', dir: 'rtl', test: 'رسالة تجريبية من متجرك: الإشعارات شغالة ✅',
  },
  en: {
    newOrder: 'New order', items: (n) => `${n} item${n === 1 ? '' : 's'}`,
    total: 'Total', subtotal: 'Items', shipping: 'Shipping', free: 'Free', cod: 'Cash on delivery',
    customer: 'Customer', phone: 'Mobile', email: 'Email', address: 'Address', notes: 'Notes',
    openAdmin: 'Open the production dashboard', track: 'Track your order',
    thanksSubject: (n) => `We received your order ${n} · OneOff Print`,
    thanksHi: (name) => `Hi ${name},`,
    thanksBody: 'Thank you for your order! We have received it and will print each item just for you. We will contact you before shipping.',
    adminSubject: (n, total) => `New order ${n} · ${total}`,
    sides: ' + ', dir: 'ltr', test: 'Test message from your shop: notifications are working ✅',
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

module.exports = { status, orderPlaced, adminTest, emailReady, emailTo, shopWhatsApp: () => config().shopWhatsApp, siteUrl: () => config().siteUrl };
