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
const { getProduct } = require('./products');
const { arabicDigits } = require('./i18n');
const { PREPAY_ONLY } = require('./payment-wording');

const env = (k) => (process.env[k] || '').trim();
const config = () => ({
  brevoKey: env('BREVO_API_KEY'),
  brevoUrl: env('BREVO_API_URL') || 'https://api.brevo.com/v3/smtp/email',
  mailFrom: env('MAIL_FROM'),
  mailFromName: env('MAIL_FROM_NAME') || 'ebda3',
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
/** A number in the message language: Arabic-Indic digits in Arabic (like money()), Latin in English. */
function num(n, lang) {
  if (lang !== 'ar') return String(n);
  try {
    return new Intl.NumberFormat('ar-EG').format(n);
  } catch (e) {
    return String(n);
  }
}
/**
 * The order number as customers see it: without the shop's own "POD-" (it means nothing to them), in the
 * message's digits and never grouped ("١٠٠١", "1001"). The shop's own messages keep the full number.
 */
function custNo(number, lang) {
  const n = String(number == null ? '' : number).replace(/^POD-/i, '');
  return lang === 'ar' ? n.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d))) : n;
}
/** Arabic counting (as on the rest of the shop): 1 and 2 have their own words, 3–10 (103–110…) the plural, others the singular. */
const arCount = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${num(n, 'ar')} ${few}` : `${num(n, 'ar')} ${many}`);
const enCount = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const L = {
  ar: {
    newOrder: 'طلب جديد', items: (n) => arCount(n, 'منتج واحد', 'منتجين', 'منتجات', 'منتج'), brand: 'إبداع',
    total: 'الإجمالي', subtotal: 'المنتجات', discount: 'الخصم', shipping: 'الشحن', free: 'مجاني', cod: 'الدفع عند الاستلام',
    customer: 'العميل', phone: 'الموبايل', email: 'البريد', address: 'العنوان', notes: 'ملاحظات',
    openAdmin: 'افتح لوحة الإنتاج', track: 'تابع طلبك',
    thanksSubject: (n) => `تم استلام طلبك رقم ${n} · إبداع`,
    thanksHi: (name) => `أهلًا ${name}،`,
    thanksBody: 'شكرًا لطلبك! استلمنا طلبك وهنبدأ نطبع كل قطعة مخصوص ليك. هنتواصل معاك قبل الشحن.',
    adminSubject: (n, total) => `طلب جديد ${n} · ${total}`,
    sides: ' + ', dir: 'rtl', test: 'رسالة تجريبية من متجرك: الإشعارات شغالة ✅',
    shippedSubject: (n) => `طلبك رقم ${n} في الطريق ليك · إبداع`,
    shippedBody: 'طلبك اتشحن وفي الطريق ليك! جهّز المبلغ للمندوب عند الاستلام.',
    shippedBodyPaid: 'طلبك اتشحن وفي الطريق ليك!',
    // Paying in advance only (src/payment-wording.js, from launch): nothing for the courier.
    prepay: 'الدفع مقدّمًا', shippedBodyPrepay: 'طلبك اتشحن وفي الطريق ليك! ومفيش حاجة تدفعها للمندوب.',
    // The money-back guarantee (paying in advance only; owner's decision, 26 Nov): how to use it.
    guarTitle: '🛡️ ضمان استرجاع الفلوس',
    guarHow: (n, wa, mail) => `لو المطبوع مش زي التصميم، أو القطعة وصلت بايظة أو غلط: صوّرها وابعت الصورة مع رقم الطلب ${n} على واتساب${wa ? ` (${wa})` : ''} أو الإيميل${mail ? ` (${mail})` : ''} خلال ${num(7, 'ar')} أيام من ما الطلب يوصلك، واختار: نطبعهالك تاني ببلاش أو ترجعلك فلوسك. ومش محتاج ترجّع القطعة.`,
    guarMore: 'تفاصيل الضمان',
    courier: 'شركة الشحن', trackingNumber: 'رقم التتبع', trackingLink: 'تتبع الشحنة عند شركة الشحن', eta: 'الاستلام المتوقع',
    invoice: 'الفاتورة', copies: (n) => arCount(n, 'نسخة واحدة', 'نسختين', 'نسخ', 'نسخة'), order: 'الطلب', orderNo: 'طلب رقم',
    pieces: (n) => arCount(n, 'قطعة واحدة', 'قطعتين', 'قطع', 'قطعة'), photos: (n) => arCount(n, 'صورة واحدة', 'صورتين', 'صور', 'صورة'),
    names: (n) => `قائمة أسماء: ${arCount(n, 'اسم واحد', 'اسمين', 'أسماء', 'اسم')}`, listSep: '، ',
    delivery: 'التوصيل', express: '⚡ توصيل سريع', expressAdmin: '⚡ توصيل سريع: خلال يومين عمل',
    deliveryLine: (d, by) => `${d.speed === 'express' ? '⚡ توصيل سريع' : 'توصيل عادي'} خلال ${arCount(d.days, 'يوم', 'يومين', 'أيام', 'يوم')} عمل (حتى ${by})`,
  },
  en: {
    newOrder: 'New order', items: (n) => enCount(n, 'item'), brand: 'ebda3',
    total: 'Total', subtotal: 'Items', discount: 'Discount', shipping: 'Shipping', free: 'Free', cod: 'Cash on delivery',
    customer: 'Customer', phone: 'Mobile', email: 'Email', address: 'Address', notes: 'Notes',
    openAdmin: 'Open the production dashboard', track: 'Track your order',
    thanksSubject: (n) => `We received your order no. ${n} · ebda3`,
    thanksHi: (name) => `Hi ${name},`,
    thanksBody: 'Thank you for your order! We have received it and will print each item just for you. We will contact you before shipping.',
    adminSubject: (n, total) => `New order ${n} · ${total}`,
    sides: ' + ', dir: 'ltr', test: 'Test message from your shop: notifications are working ✅',
    shippedSubject: (n) => `Your order no. ${n} is on its way · ebda3`,
    shippedBody: 'Your order has shipped and is on its way to you! Please have the amount ready for the courier on delivery.',
    shippedBodyPaid: 'Your order has shipped and is on its way to you!',
    prepay: 'Payment in advance', shippedBodyPrepay: 'Your order has shipped and is on its way to you! There is nothing to pay the courier.',
    guarTitle: '🛡️ Money-back guarantee',
    guarHow: (n, wa, mail) => `If the print doesn't match your design, or the item arrives damaged or wrong: send a photo of it with your order number ${n} on WhatsApp${wa ? ` (${wa})` : ''} or by email${mail ? ` (${mail})` : ''} within 7 days of delivery, and choose a free reprint or your money back. No need to send the item back.`,
    guarMore: 'Guarantee details',
    courier: 'Courier', trackingNumber: 'Tracking number', trackingLink: 'Track the parcel with the courier', eta: 'Expected delivery',
    invoice: 'Invoice', copies: (n) => `${n} cop${n === 1 ? 'y' : 'ies'}`, order: 'Order', orderNo: 'Order no.',
    pieces: (n) => enCount(n, 'piece'), photos: (n) => enCount(n, 'photo'), names: (n) => `Name list: ${enCount(n, 'name')}`, listSep: ', ',
    delivery: 'Delivery', express: '⚡ Express delivery', expressAdmin: '⚡ EXPRESS: deliver within 2 business days',
    deliveryLine: (d, by) => `${d.speed === 'express' ? '⚡ Express' : 'Standard'} delivery within ${d.days} business day${d.days === 1 ? '' : 's'} (by ${by})`,
  },
};
/**
 * The shop's own bilingual words (product, colour, size, print area…) in the message language. In
 * Arabic their numbers become ١٢٣ like the counts and prices around them ("١٠ × ١٥ سم ×٥", not
 * "10 × 15 سم ×٥"); codes such as A4 or 2XL stay as they are. Plain strings (customer text) pass through.
 */
const tr = (v, lang) => {
  if (!(v && typeof v === 'object')) return String(v == null ? '' : v);
  const s = v[lang] || v.en || '';
  return lang === 'ar' && v.ar ? arabicDigits(s) : s;
};
/**
 * An amount as the site and the invoice show it (common.js money()): whole pounds without
 * decimals ("٣٥٠ ج.م.", "EGP 350"), piastres with two ("EGP 106.50") only when there are some.
 */
function money(n, lang) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
  } catch (e) {
    return `${v} EGP`;
  }
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const govName = (id, lang) => tr((GOVERNORATES.find((g) => g.id === id) || {}).name, lang) || id;
/**
 * One order line: product, colour, size, print areas and how many. Several colours / sizes
 * (and photo sets) show the total and every line with its count, like the printing-house
 * message (src/dispatch.js); name lists show the number of names; other items their copies.
 */
/** Copies in an item's pack lines (100 cards × 2 = 200), from the lines' marks or the product as it is now; else null. */
function packCopies(it, lines) {
  const p = getProduct(it.productId);
  const sizeOf = (l) => {
    const z = p && l.size && p.sizes.find((x) => x.id === l.size.id);
    return { pack: Boolean((l.size && l.size.pack) || (z && z.pack)), copies: Number((l.size && l.size.copies) || (z && z.copies)) || 1 };
  };
  if (!lines.length || !lines.every((l) => sizeOf(l).pack)) return null;
  return lines.reduce((n, l) => n + Number(l.qty) * sizeOf(l).copies, 0);
}
function itemLine(it, lang) {
  const t = L[lang];
  const name = (v) => tr(v, lang);
  const photoset = it.kind === 'photoset';
  const sides = photoset ? '' : (it.sides || []).map((s) => name(s && s.name)).filter(Boolean).join(t.sides);
  const lines = Array.isArray(it.quantities) ? it.quantities.filter((l) => l && Number(l.qty) > 0) : [];
  const parts = [name(it.productName)];
  if (lines.length) {
    const colorOf = (l) => name(l.color && l.color.name);
    const oneColor = new Set(lines.map(colorOf)).size === 1;
    const total = lines.reduce((n, l) => n + Number(l.qty), 0);
    const breakdown = lines.map((l) => `${[oneColor ? '' : colorOf(l), name(l.size && l.size.label)].filter(Boolean).join(' · ')} ×${num(Number(l.qty), lang)}`).join(t.listSep);
    // Packs (100 cards × 2 + 1000 cards): the copies, never "2 pieces" (QA 25 Nov).
    const copies = packCopies(it, lines);
    const count = photoset
      ? [Array.isArray(it.photos) && it.photos.length ? t.photos(it.photos.length) : '', t.copies(total)].filter(Boolean).join(' · ')
      : copies != null ? t.copies(copies) : t.pieces(total);
    parts.push(oneColor ? colorOf(lines[0]) : '', `${count} (${breakdown})`);
    // A photo set's size label is its summary; its options (border…) are not on the lines.
    if (photoset && it.options && typeof it.options === 'object') parts.push(...Object.values(it.options).map((o) => name(o && o.name)));
    parts.push(sides);
  } else {
    parts.push(it.color && name(it.color.name), it.size && name(it.size.label), sides);
    if (!it.merge && Number(it.copies) > 1) parts.push(t.copies(Number(it.copies)));
  }
  if (it.merge && Number(it.merge.count) > 0) parts.push(t.names(Number(it.merge.count)));
  return parts.filter(Boolean).join(' · ');
}
const dayOf = (ymd, lang) => {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z'));
  } catch (e) {
    return ymd;
  }
};
const deliveryText = (order, lang) => (order.delivery ? L[lang].deliveryLine(order.delivery, dayOf(order.delivery.by, lang)) : '');
const addressOf = (c, lang) => [c.address, c.city, govName(c.governorate, lang)].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');

/** How the order is paid, after its total: cash on delivery (the preview) or in advance (from launch). */
const payWord = (t, prepayOnly) => (prepayOnly ? t.prepay : t.cod);

/**
 * The money-back guarantee, for the customer's emails while the shop takes payment in advance (owner's decision,
 * 26 Nov): how to use it (a photo and the order number on WhatsApp or by email, within 7 days of delivery) and a
 * link to its page. Empty otherwise: the emails are as they were.
 */
function guarantee(order, lang, base, prepayOnly) {
  if (!prepayOnly) return { html: '', text: '' };
  const t = L[lang];
  const cfg = config();
  const wa = cfg.shopWhatsApp ? `wa.me/${cfg.shopWhatsApp}` : '';
  const how = t.guarHow(custNo(order.number, lang), wa, cfg.mailFrom);
  const page = base ? `${String(base).replace(/\/+$/, '')}/guarantee` : '';
  return {
    html: `<div style="margin:16px 0 0;padding:12px 14px;border-radius:10px;background:#eef8f1;border:1px solid #bfe3cd">
        <p style="margin:0 0 6px;font-weight:700;color:#0f6b3a">${esc(t.guarTitle)}</p>
        <p style="margin:0;line-height:1.6">${esc(how)}</p>
        ${page ? `<p style="margin:8px 0 0"><a href="${esc(page)}" style="color:#0f6b3a;font-weight:700">${esc(t.guarMore)}</a></p>` : ''}
      </div>`,
    text: [t.guarTitle, how, page ? `${t.guarMore}: ${page}` : ''].filter(Boolean).join('\n'),
  };
}

// ---------- Messages ----------
function adminWhatsAppText(order, links, lang, prepayOnly) {
  const t = L[lang];
  const c = order.customer;
  const lines = [
    `🛒 ${t.newOrder} ${order.number}`,
    order.delivery && order.delivery.speed === 'express' ? t.expressAdmin : '',
    `${t.items(order.items.length)} · ${t.total} ${money(order.total, lang)} (${payWord(t, prepayOnly)})`,
    deliveryText(order, lang),
    `${c.name} · ${c.phone}`,
    addressOf(c, lang),
    ...order.items.slice(0, 10).map((it) => `- ${itemLine(it, lang)}`),
    order.items.length > 10 ? '…' : '',
    c.notes ? `${t.notes}: ${c.notes}` : '',
    links.admin,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 1500);
}

function emailHtml(order, links, lang, forAdmin, prepayOnly) {
  const t = L[lang];
  const guar = forAdmin ? '' : guarantee(order, lang, links.base, prepayOnly).html;
  const c = order.customer;
  const rows = order.items.map((it, i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${num(i + 1, lang)}. ${esc(itemLine(it, lang))}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap;text-align:${lang === 'ar' ? 'left' : 'right'}">${esc(money(it.price, lang))}</td>
    </tr>`).join('');
  const sum = (label, value, bold) => `<tr><td style="padding:4px 0;${bold ? 'font-weight:700' : ''}">${esc(label)}</td><td style="padding:4px 0;text-align:${lang === 'ar' ? 'left' : 'right'};${bold ? 'font-weight:700' : ''}">${esc(value)}</td></tr>`;
  const intro = forAdmin
    ? `<h2 style="margin:0 0 12px">🛒 ${esc(t.newOrder)} ${esc(order.number)}</h2>`
    : `<h2 style="margin:0 0 12px">${esc(t.thanksHi(c.name))}</h2><p style="margin:0 0 16px">${esc(t.thanksBody)}</p><p style="margin:0 0 12px;font-weight:700">${esc(t.orderNo)} ${esc(custNo(order.number, lang))}</p>`;
  const details = forAdmin
    ? `<table style="width:100%;margin-top:16px;border-collapse:collapse">
        ${sum(t.customer, c.name)}${sum(t.phone, c.phone)}${c.email ? sum(t.email, c.email) : ''}${sum(t.address, addressOf(c, lang))}${c.notes ? sum(t.notes, c.notes) : ''}
      </table>`
    : `<p style="margin:16px 0 0;color:#555">${esc(t.address)}: ${esc(addressOf(c, lang))}</p>`;
  const link = forAdmin ? links.admin : links.track;
  const button = link ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="background:#ca3d1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:700">${esc(forAdmin ? t.openAdmin : t.track)}</a></p>` : '';
  return `<!doctype html><html lang="${lang}" dir="${t.dir}"><body style="margin:0;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;color:#16181d">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="font-weight:800;font-size:18px;margin-bottom:16px">${esc(t.brand)}</div>
    <div style="background:#fff;border-radius:14px;padding:20px;direction:${t.dir};text-align:${lang === 'ar' ? 'right' : 'left'}">
      ${intro}
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <table style="width:100%;margin-top:12px;border-collapse:collapse">
        ${sum(t.subtotal, money(order.subtotal, lang))}
        ${order.discount ? sum(`${t.discount} (${order.coupon ? order.coupon.code : ''})`, `-${money(order.discount, lang)}`) : ''}
        ${sum(order.delivery && order.delivery.speed === 'express' ? `${t.shipping} (${t.express})` : t.shipping, order.shipping ? money(order.shipping, lang) : t.free)}
        ${sum(`${t.total} (${payWord(t, prepayOnly)})`, money(order.total, lang), true)}
      </table>
      ${order.delivery ? `<p style="margin:12px 0 0;font-weight:700">🚚 ${esc(deliveryText(order, lang))}</p>` : ''}
      ${details}${guar}
      ${button}
    </div>
  </div></body></html>`;
}
const emailText = (order, links, lang, forAdmin, prepayOnly) => {
  const t = L[lang];
  const c = order.customer;
  return [
    forAdmin ? `${t.newOrder} ${order.number}` : `${t.thanksHi(c.name)}\n${t.thanksBody}\n${t.orderNo} ${custNo(order.number, lang)}`,
    '',
    ...order.items.map((it, i) => `${num(i + 1, lang)}. ${itemLine(it, lang)} · ${money(it.price, lang)}`),
    '',
    // (The same sums as the HTML part, so the lines add up to the total: QA 25 Nov.)
    `${t.subtotal}: ${money(order.subtotal, lang)}`,
    ...(order.discount ? [`${t.discount}${order.coupon ? ` (${order.coupon.code})` : ''}: -${money(order.discount, lang)}`] : []),
    `${order.delivery && order.delivery.speed === 'express' ? `${t.shipping} (${t.express})` : t.shipping}: ${order.shipping ? money(order.shipping, lang) : t.free}`,
    `${t.total} (${payWord(t, prepayOnly)}): ${money(order.total, lang)}`,
    deliveryText(order, lang),
    forAdmin ? `${t.customer}: ${c.name} · ${c.phone}${c.email ? ' · ' + c.email : ''}\n${t.address}: ${addressOf(c, lang)}${c.notes ? `\n${t.notes}: ${c.notes}` : ''}` : `${t.address}: ${addressOf(c, lang)}`,
    ...(!forAdmin && prepayOnly ? ['', guarantee(order, lang, links.base, prepayOnly).text] : []),
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

/**
 * The customer's link to their order page (or invoice): with the order's secret key, which the team never
 * sees (an order placed before the keys came in opens with its number, as its earlier emails do).
 */
function orderLink(base, order, page = 'order') {
  if (!base || !order || !order.id) return '';
  const b = String(base).replace(/\/+$/, '');
  return `${b}/${page}?id=${encodeURIComponent(order.id)}${order.linkKey ? `&k=${encodeURIComponent(order.linkKey)}` : ''}`;
}

/** Send every configured notification for a new order. Returns a result per channel. */
async function orderPlaced(order, { origin, lang, admin = true, customer = true, prepayOnly = PREPAY_ONLY }) {
  const cfg = config();
  const base = cfg.siteUrl || origin || '';
  const links = { admin: base ? `${base}/admin` : '', track: orderLink(base, order), base };
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
    run('adminWhatsApp', admin && st.adminWhatsApp, () => sendWhatsApp(cfg, adminWhatsAppText(order, links, adminLang, prepayOnly))),
    run('adminEmail', admin && st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, L[adminLang].adminSubject(order.number, money(order.total, adminLang)), emailHtml(order, links, adminLang, true, prepayOnly), emailText(order, links, adminLang, true, prepayOnly))),
    run('customerEmail', customer && st.customerEmail && Boolean(order.customer.email), () => sendEmail(cfg, order.customer.email, L[custLang].thanksSubject(custNo(order.number, custLang)), emailHtml(order, links, custLang, false, prepayOnly), emailText(order, links, custLang, false, prepayOnly))),
  ]);
  return result;
}

/** The shop's message when a customer sends a new version of an item after a change request. */
function revisionText(order, item, links, lang) {
  const pos = order.items.findIndex((it) => it.id === item.id) + 1;
  const name = tr(item.productName, lang) || '';
  return lang === 'en'
    ? `✏️ ${order.number}: the customer sent a new version of item ${pos} (${name}) after your change request. Check it in Review, then approve to send them its proof.${links.admin ? `\n${links.admin}` : ''}`
    : `✏️ ${order.number}: العميل بعت نسخة جديدة من القطعة ${num(pos, lang)} (${name}) بعد طلب التعديل. راجعها في تبويب المراجعة، ووافق عشان تتبعتله البروفة.${links.admin ? `\n${links.admin}` : ''}`;
}
/** Tell the shop (WhatsApp and email, as for new orders) that a revised design is waiting in Review. */
async function revisionSent(order, item, { origin } = {}) {
  const cfg = config();
  const base = cfg.siteUrl || origin || '';
  const links = { admin: base ? `${base}/admin` : '' };
  const lang = cfg.adminLang;
  const text = revisionText(order, item, links, lang);
  const st = status();
  const subject = lang === 'en' ? `New version for ${order.number}` : `نسخة جديدة للطلب ${order.number}`;
  const result = {};
  const run = async (key, enabled, fn) => {
    if (!enabled) { result[key] = 'off'; return; }
    try { await fn(); result[key] = 'sent'; } catch (e) { result[key] = 'failed'; console.warn(`[notify] ${key} (revision ${order.number}) failed: ${e.message}`); }
  };
  await Promise.all([
    run('adminWhatsApp', st.adminWhatsApp, () => sendWhatsApp(cfg, text)),
    run('adminEmail', st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, subject, `<p dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${esc(text).replace(/\n/g, '<br>')}</p>`, text)),
  ]);
  return result;
}

/**
 * A rights / takedown request (someone says a design uses their work): to the owner on every admin channel,
 * like a new order, so it is seen the same day. `t` = { name, contact, owner, link, details }.
 */
async function rightsRequest(t, { origin } = {}) {
  const cfg = config();
  const st = status();
  const lang = cfg.adminLang;
  const base = cfg.siteUrl || origin || '';
  const head = lang === 'en' ? '⚠️ Rights / takedown request' : '⚠️ طلب حقوق ملكية / إزالة تصميم';
  const lines = [
    head,
    `${lang === 'en' ? 'From' : 'من'}: ${t.name} (${t.contact})`,
    t.owner ? `${lang === 'en' ? 'Rights holder' : 'صاحب الحق'}: ${t.owner}` : '',
    t.link ? `${lang === 'en' ? 'Link' : 'الرابط'}: ${t.link}` : '',
    '',
    String(t.details || '').slice(0, 700),
    base ? `\n${lang === 'en' ? 'Admin → Rights requests' : 'لوحة التحكم ← طلبات الحقوق'}: ${base}/admin#rights` : '',
  ].filter((l, i) => l || i === 4);
  const text = lines.join('\n');
  const subject = lang === 'en' ? 'ebda3 · Rights request' : 'إبداع · طلب حقوق ملكية';
  const result = {};
  const run = async (key, enabled, fn) => {
    if (!enabled) { result[key] = 'off'; return; }
    try { await fn(); result[key] = 'sent'; } catch (e) { result[key] = 'failed'; console.warn(`[notify] ${key} (rights request) failed: ${e.message}`); }
  };
  await Promise.all([
    run('adminWhatsApp', st.adminWhatsApp, () => sendWhatsApp(cfg, text)),
    run('adminEmail', st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, subject, `<pre dir="auto" style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`, text)),
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
    run('adminEmail', st.adminEmail, () => sendEmail(cfg, cfg.adminEmail, `${t.brand} · ✅`, `<p dir="${t.dir}">${esc(t.test)}</p>`, t.test)),
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
    return itemLine(it, lang);
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

function shippedContent(order, links, lang, prepayOnly) {
  const t = L[lang];
  const c = order.customer || {};
  const sh = order.shipment || {};
  const paid = order.payment && order.payment.status === 'paid';
  const body = paid ? t.shippedBodyPaid : prepayOnly ? t.shippedBodyPrepay : t.shippedBody;
  const trackingUrl = httpUrl(sh.trackingUrl);
  const facts = [
    sh.courier ? [t.courier, sh.courier] : null,
    sh.trackingNumber ? [t.trackingNumber, sh.trackingNumber] : null,
    sh.eta ? [t.eta, etaText(sh.eta, lang)] : null,
  ].filter(Boolean);
  const items = (order.items || []).map((it, i) => `${num(i + 1, lang)}. ${safeLine(it, lang)}`);
  const end = lang === 'ar' ? 'left' : 'right';
  const guar = guarantee(order, lang, links.base, prepayOnly);
  const button = (href, label, primary) => `<a href="${esc(href)}" style="${primary ? 'background:#ca3d1a;color:#fff;' : 'background:#fff;color:#16181d;border:1px solid #d5d8de;'}text-decoration:none;padding:11px 18px;border-radius:10px;display:inline-block;font-weight:700;margin:0 0 8px">${esc(label)}</a>`;
  const html = `<!doctype html><html lang="${lang}" dir="${t.dir}"><body style="margin:0;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;color:#16181d">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="font-weight:800;font-size:18px;margin-bottom:16px">${esc(t.brand)}</div>
    <div style="background:#fff;border-radius:14px;padding:20px;direction:${t.dir};text-align:${lang === 'ar' ? 'right' : 'left'}">
      <h2 style="margin:0 0 12px">📦 ${esc(t.thanksHi(c.name || ''))}</h2>
      <p style="margin:0 0 16px;line-height:1.6">${esc(body)}</p>
      <p style="margin:0 0 12px;font-weight:700">${esc(t.orderNo)} ${esc(custNo(order.number, lang))}</p>
      ${facts.length ? `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;background:#f8f9fb;border-radius:10px">${facts.map(([k, v]) => `<tr><td style="padding:8px 12px;color:#555">${esc(k)}</td><td style="padding:8px 12px;text-align:${end};font-weight:700"><bdi>${esc(v)}</bdi></td></tr>`).join('')}</table>` : ''}
      <table style="width:100%;border-collapse:collapse">${items.map((line) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(line)}</td></tr>`).join('')}</table>
      <p style="margin:12px 0 0;font-weight:700">${esc(t.total)}${paid ? '' : ` (${esc(payWord(t, prepayOnly))})`}: ${esc(money(order.total, lang))}</p>${guar.html}
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
    `${t.orderNo} ${custNo(order.number, lang)}`,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    trackingUrl ? `${t.trackingLink}: ${trackingUrl}` : '',
    '',
    ...items,
    '',
    `${t.total}${paid ? '' : ` (${payWord(t, prepayOnly)})`}: ${money(order.total, lang)}`,
    ...(guar.text ? ['', guar.text, ''] : []),
    links.track ? `${t.track}: ${links.track}` : '',
    links.invoice ? `${t.invoice}: ${links.invoice}` : '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject: t.shippedSubject(custNo(order.number, lang)), html, text };
}

/**
 * Email the customer that their order has shipped (courier, tracking and links to the
 * order page and the invoice), in the language they ordered in. Never throws.
 * Returns { email: 'sent' | 'skipped' | 'failed', reason? }.
 */
async function orderShipped(order, { siteUrl, prepayOnly = PREPAY_ONLY } = {}) {
  try {
    const cfg = config();
    const to = order && order.customer && String(order.customer.email || '').trim();
    if (!to) return { email: 'skipped', reason: 'noEmail' };
    if (!emailReady()) return { email: 'skipped', reason: 'emailOff' };
    const base = (cfg.siteUrl || String(siteUrl || '')).replace(/\/+$/, '');
    const links = { track: orderLink(base, order), invoice: orderLink(base, order, 'invoice'), base };
    const lang = order.lang === 'en' ? 'en' : 'ar';
    const { subject, html, text } = shippedContent(order, links, lang, prepayOnly);
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
async function proofMessage(order, item, { kind = 'proof', note = '', link = '', orderLink: toOrder = '' } = {}) {
  try {
    const cfg = config();
    const to = order && order.customer && String(order.customer.email || '').trim();
    if (!to) return { email: 'skipped', reason: 'noEmail' };
    if (!emailReady()) return { email: 'skipped', reason: 'emailOff' };
    const ar = order.lang !== 'en';
    // (The order page too, when the button opens the proof: its link carries the order's key.)
    const orderTo = /^https?:\/\//.test(toOrder) && toOrder !== link ? toOrder : '';
    const h = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const product = item && item.productName ? tr(item.productName, ar ? 'ar' : 'en') : '';
    const T = ar
      ? {
        subject: kind === 'proof' ? `طلبك رقم ${custNo(order.number, 'ar')}: محتاجين موافقتك على البروفة` : `طلبك رقم ${custNo(order.number, 'ar')}: محتاج تعديل قبل الطباعة`,
        lead: kind === 'proof' ? `جهّزنالك بروفة جديدة لـ ${product}. راجعها ووافق عليها عشان نبدأ الطباعة.` : `راجعنا ${product} ومحتاج تعديل قبل ما نطبعه.`,
        button: kind === 'proof' ? 'راجع البروفة' : 'افتح الطلب',
        noteLabel: 'رسالة من إبداع:',
        order: 'صفحة طلبك:',
        screen: 'دي بروفة على الشاشة؛ ألوان الطباعة ممكن تفرق شوية عن اللي شايفه على شاشتك.',
      }
      : {
        subject: kind === 'proof' ? `Order no. ${custNo(order.number, 'en')}: please approve your proof` : `Order no. ${custNo(order.number, 'en')}: a change is needed before printing`,
        lead: kind === 'proof' ? `We have a new proof for your ${product}. Please check and approve it so we can print.` : `We checked your ${product} and something needs changing before we print.`,
        button: kind === 'proof' ? 'Check the proof' : 'Open your order',
        noteLabel: 'Message from the print shop:',
        order: 'Your order page:',
        screen: 'This is a screen proof; printed colours can look a little different from your screen.',
      };
    const dir = ar ? 'rtl' : 'ltr';
    const html = `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1f27">
      <p>${h(T.lead)}</p>
      ${note ? `<p><strong>${h(T.noteLabel)}</strong><br><span dir="auto">${h(note).replace(/\n/g, '<br>')}</span></p>` : ''}
      ${/^https?:\/\//.test(link) ? `<p><a href="${h(link)}" style="display:inline-block;background:#ca3d1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${h(T.button)}</a></p>` : ''}
      ${orderTo ? `<p style="font-size:14px">${h(T.order)} <a href="${h(orderTo)}">${h(orderTo)}</a></p>` : ''}
      <p style="color:#666;font-size:13px">${h(T.screen)}</p></div>`;
    const text = [T.lead, note ? `${T.noteLabel} ${note}` : '', link, orderTo ? `${T.order} ${orderTo}` : '', T.screen].filter(Boolean).join('\n\n');
    await sendEmail(cfg, to, T.subject, html, text);
    return { email: 'sent' };
  } catch (e) {
    console.warn(`[notify] proof email for ${order && order.number} failed: ${e.message}`);
    return { email: 'failed', error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { orderLink, status, orderPlaced, orderShipped, proofMessage, adminTest, revisionSent, rightsRequest, revisionText, emailReady, emailTo, shopWhatsApp: () => config().shopWhatsApp, siteUrl: () => config().siteUrl };
