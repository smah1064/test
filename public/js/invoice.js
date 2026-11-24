/* Printable invoice for one order: /invoice?id=<orderId> (the order id is the secret). */
(function () {
  'use strict';

  const { money, esc, t, tr } = POD;
  const params = new URLSearchParams(location.search);
  const orderId = params.get('id') || '';
  const content = document.getElementById('content');
  const actions = document.getElementById('inv-actions');
  const FALLBACK_SHOP = { name: { en: 'ebda3', ar: 'إبداع' }, url: null, whatsapp: null, email: null };
  let order = null;
  let error = null;

  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  /** A calendar date (no time) in the page's language. */
  const day = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'long' }) : '';
  };
  /** Latin identifiers (order numbers, links, phone numbers) keep their direction inside Arabic text. */
  const ltr = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;

  function shopOf(o) {
    const s = o.shop || {};
    return {
      name: s.name && tr(s.name) ? s.name : FALLBACK_SHOP.name,
      url: s.url || null,
      whatsapp: s.whatsapp || null,
      email: s.email || null,
    };
  }
  function invoiceNumber(o) {
    return (o.invoice && o.invoice.number) || 'INV-' + o.number;
  }

  // Styles for the colour/size sub-rows (this page's own styles live in invoice.html).
  if (!document.querySelector('link[href="/css/quantities.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/quantities.css';
    document.head.appendChild(link);
  }
  /** Arabic counts: 1, 2, 3–10 (plural), 11+ (singular), as elsewhere in the shop. */
  const countKey = (n) => (n === 1 ? 'one' : n === 2 ? 'two' : n % 100 >= 3 && n % 100 <= 10 ? 'few' : 'many');
  const copiesText = (n, price) => t(n === 2 || countKey(n) === 'few' ? `invoice.copies.${countKey(n)}` : 'invoice.copies', { n: POD.num(n), price });
  const namesText = (n) => t(n === 2 || countKey(n) === 'few' ? `invoice.qty.names.${countKey(n)}` : 'invoice.qty.names', { n: POD.num(n) });
  const piecesText = (n) => t('invoice.qty.' + (n === 1 ? 'one' : n === 2 ? 'two' : n % 100 >= 3 && n % 100 <= 10 ? 'few' : 'many'), { n: POD.num(n) });
  /** The colour/size lines of an item ordered in several colours or sizes (sorted by colour). */
  function qtyLines(item) {
    const lines = Array.isArray(item.quantities) ? item.quantities.filter((l) => l && Number(l.qty) > 0) : [];
    const order = [];
    for (const l of lines) {
      const key = (l.color && (l.color.id || tr(l.color.name))) || '';
      if (!order.includes(key)) order.push(key);
    }
    const keyOf = (l) => order.indexOf((l.color && (l.color.id || tr(l.color.name))) || '');
    return lines.map((l, k) => ({ l, k })).sort((a, b) => keyOf(a.l) - keyOf(b.l) || a.k - b.k).map((x) => x.l);
  }

  function itemRow(item, i) {
    const lines = qtyLines(item);
    const copies = Math.max(1, Number(item.copies) || lines.reduce((n, l) => n + Number(l.qty), 0) || 1);
    const sides = (item.sides || []).map((s) => tr(s.name)).filter(Boolean).join(' + ');
    if (lines.length > 1) return mixedRows(item, i, lines, copies, sides);
    const unit = item.unitPrice != null ? Number(item.unitPrice) : round2(Number(item.price) / copies);
    const one = lines[0];
    const color = one && one.color ? one.color : item.color;
    const size = one && one.size ? one.size : item.size;
    const desc = [color && tr(color.name), size && tr(size.label), sides].filter(Boolean).join(' · ');
    return `
      <tr>
        <td class="n">${esc(POD.num(i + 1))}</td>
        <td>
          <div class="prod">${esc(tr(item.productName))}</div>
          ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}
          ${copies > 1 ? `<div class="copies">${esc(one && !item.merge ? t('invoice.qty.same', { pieces: piecesText(copies), price: money(unit) }) : copiesText(copies, money(unit)))}</div>` : ''}
        </td>
        <td class="num opt">${esc(POD.num(copies))}</td>
        <td class="num opt">${esc(money(unit))}</td>
        <td class="num">${esc(money(item.price))}</td>
      </tr>`;
  }

  /** One artwork in several colours/sizes: the item with its total, then one sub-row per colour · size. */
  function mixedRows(item, i, lines, copies, sides) {
    const units = new Set(lines.map((l) => (l.unitPrice != null ? Number(l.unitPrice) : null)));
    const same = units.size === 1 && !units.has(null);
    // One price for every piece: show it on the item; otherwise each line carries its own (bigger sizes cost more).
    // (item.unitPrice may be an average of the lines, so it is not used here.)
    const unit = same ? [...units][0] : null;
    const lineUnit = (l) => (l.unitPrice != null ? Number(l.unitPrice) : round2(Number(item.price) / copies));
    const names = item.merge && item.merge.count > 1 ? namesText(item.merge.count) : '';
    const desc = [sides, names].filter(Boolean).join(' · ');
    const head = `
      <tr class="qty-has-sub">
        <td class="n">${esc(POD.num(i + 1))}</td>
        <td>
          <div class="prod">${esc(tr(item.productName))}</div>
          ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}
          <div class="copies">${esc(t('invoice.qty.mixed', { pieces: piecesText(copies) }))}</div>
        </td>
        <td class="num opt">${esc(POD.num(copies))}</td>
        <td class="num opt">${unit != null ? esc(money(unit)) : ''}</td>
        <td class="num"><strong>${esc(money(item.price))}</strong></td>
      </tr>`;
    return head + lines.map((l, k) => {
      const u = lineUnit(l);
      const label = [l.color && tr(l.color.name), l.size && tr(l.size.label)].filter(Boolean).join(' · ');
      return `
      <tr class="inv-sub ${k === lines.length - 1 ? 'last' : ''}">
        <td class="n"></td>
        <td><div class="qty-sub-item">${l.color && l.color.hex ? `<span class="qty-dot" style="background:${esc(l.color.hex)}"></span>` : ''}<span>${esc(label)}</span><span class="qty-sub-ph">${esc(t('invoice.qty.line', { n: POD.num(Number(l.qty)), price: money(u) }))}</span></div></td>
        <td class="num opt">${esc(POD.num(Number(l.qty)))}</td>
        <td class="num opt">${esc(money(u))}</td>
        <td class="num">${esc(money(round2(u * Number(l.qty))))}</td>
      </tr>`;
    }).join('');
  }

  function render() {
    if (error) {
      actions.hidden = true;
      document.title = t('invoice.pageTitle');
      content.innerHTML = `<div class="card empty" style="margin-top:32px"><h2>${esc(t('order.notFound'))}</h2>${error !== t('order.notFound') ? `<p class="muted">${esc(error)}</p>` : ''}<a class="btn" href="/">${esc(t('order.back'))}</a></div>`;
      return;
    }
    const o = order;
    const shop = shopOf(o);
    const inv = invoiceNumber(o);
    const comma = POD.lang === 'ar' ? '، ' : ', ';
    const c = o.customer || {};
    const place = [c.city, tr(c.governorate)].filter(Boolean).join(comma);
    // Cash on delivery: once delivered, the courier has collected it.
    const delivered = o.status === 'delivered' || Boolean(o.shipment && o.shipment.deliveredAt);
    const cod = !o.payment || o.payment.method === 'cod';
    const paidOnDelivery = cod && delivered && !(o.payment && o.payment.status === 'paid');
    const paid = (o.payment && o.payment.status === 'paid') || paidOnDelivery;
    const method = !o.payment || o.payment.method === 'cod' ? t('checkout.cod') : String(o.payment.method);
    const site = shop.url ? shop.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
    const contacts = [
      site && `<li><span>${esc(t('invoice.website'))}:</span> ${ltr(site)}</li>`,
      shop.whatsapp && `<li><span>${esc(t('invoice.whatsapp'))}:</span> ${ltr('+' + String(shop.whatsapp).replace(/^\+/, ''))}</li>`,
      shop.email && `<li><span>${esc(t('invoice.email'))}:</span> ${ltr(shop.email)}</li>`,
    ].filter(Boolean).join('');

    document.title = t('invoice.docTitle', { n: inv });
    document.getElementById('inv-back').href = '/order?id=' + encodeURIComponent(o.id || orderId);
    actions.hidden = false;

    content.innerHTML = `
      <article class="card invoice" id="invoice">
        <header class="inv-head">
          <div class="inv-shop">
            <div class="inv-brand"><img class="inv-logo" src="/img/logo-${POD.lang === 'ar' ? 'ar' : 'en'}-header.svg" alt="${esc(tr(shop.name))}"></div>
            ${contacts ? `<ul class="inv-contact">${contacts}</ul>` : ''}
          </div>
          <div class="inv-title">
            <h1>${esc(t('invoice.title'))}</h1>
            <dl class="inv-meta">
              <dt>${esc(t('invoice.number'))}</dt><dd>${ltr(inv)}</dd>
              <dt>${esc(t('invoice.issued'))}</dt><dd>${esc(day((o.invoice && o.invoice.issuedAt) || o.createdAt))}</dd>
              <dt>${esc(t('invoice.order'))}</dt><dd>${ltr(o.number)}</dd>
              <dt>${esc(t('invoice.orderDate'))}</dt><dd>${esc(day(o.createdAt))}</dd>
            </dl>
          </div>
        </header>

        <section class="inv-parties">
          <div>
            <h2>${esc(t('invoice.billTo'))}</h2>
            <p class="who">${esc(c.name || '')}</p>
            ${place ? `<p>${esc(place)}</p>` : ''}
          </div>
          <div>
            <h2>${esc(t('invoice.payment'))}</h2>
            <p>${esc(method)}</p>
            <span class="inv-pay-status ${paid ? 'paid' : 'pending'}">${esc(t(paidOnDelivery ? 'invoice.paidOnDelivery' : paid ? 'invoice.paid' : 'invoice.unpaid'))}</span>
          </div>
        </section>

        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th class="n">#</th>
                <th>${esc(t('invoice.colItem'))}</th>
                <th class="num opt">${esc(t('invoice.colQty'))}</th>
                <th class="num opt">${esc(t('invoice.colUnit'))}</th>
                <th class="num">${esc(t('invoice.colAmount'))}</th>
              </tr>
            </thead>
            <tbody>${(o.items || []).map(itemRow).join('')}</tbody>
          </table>
        </div>

        <div class="inv-bottom">
          <p class="inv-note">${esc(t('invoice.currency'))}</p>
          <div class="inv-totals">
            <div class="line"><span>${esc(t('checkout.subtotal'))}</span><span>${esc(money(o.subtotal))}</span></div>
            ${o.discount || o.coupon ? `<div class="line"><span>${esc(t('coupon.discount'))}${o.coupon ? ` (${ltr(o.coupon)})` : ''}</span><span>${o.discount ? esc(money(-o.discount)) : esc(t('coupon.freeShipping'))}</span></div>` : ''}
            ${(() => {
              // Express: the shipping and the express fee on their own lines (as in the cart and the order page).
              const fee = o.delivery && o.delivery.speed === 'express' ? Number(o.delivery.fee) || 0 : 0;
              const ship = Math.max(0, (Number(o.shipping) || 0) - fee);
              return `<div class="line"><span>${esc(t('checkout.shipping'))}</span><span>${ship ? esc(money(ship)) : esc(t('free'))}</span></div>`
                + (fee ? `<div class="line"><span>${esc(t('delivery.expressFee'))}</span><span>${esc(money(fee))}</span></div>` : '');
            })()}
            <div class="line total"><span>${esc(t('checkout.total'))}</span><span>${esc(money(o.total))}</span></div>
            ${!paid ? `<div class="line due"><span>${esc(t('invoice.amountDue'))}</span><span>${esc(money(o.total))}</span></div>` : ''}
          </div>
        </div>

        <p class="inv-thanks">${esc(t('invoice.thanks'))}</p>
        <p class="inv-foot">${esc(tr(shop.name))}${site ? ` · ${ltr(site)}` : ''}</p>
      </article>`;
  }

  async function load() {
    try {
      order = await POD.api('/api/orders/' + encodeURIComponent(orderId));
      error = null;
    } catch (e) {
      error = e.message;
    }
    render();
  }

  document.getElementById('inv-print').addEventListener('click', () => window.print());
  document.addEventListener('pod:langchange', () => (order || error) && render());
  load();
})();
