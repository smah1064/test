/* Printable invoice for one order: /invoice?id=<orderId> (the order id is the secret). */
(function () {
  'use strict';

  const { money, esc, t, tr } = POD;
  const params = new URLSearchParams(location.search);
  const orderId = params.get('id') || '';
  const content = document.getElementById('content');
  const actions = document.getElementById('inv-actions');
  const FALLBACK_SHOP = { name: { en: 'OneOff Print', ar: 'ون أوف برنت' }, url: null, whatsapp: null, email: null };
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

  function itemRow(item, i) {
    const copies = Math.max(1, Number(item.copies) || 1);
    const unit = item.unitPrice != null ? Number(item.unitPrice) : round2(Number(item.price) / copies);
    const sides = (item.sides || []).map((s) => tr(s.name)).filter(Boolean).join(' + ');
    const desc = [item.color && tr(item.color.name), item.size && tr(item.size.label), sides].filter(Boolean).join(' · ');
    return `
      <tr>
        <td class="n">${esc(POD.num(i + 1))}</td>
        <td>
          <div class="prod">${esc(tr(item.productName))}</div>
          ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}
          ${copies > 1 ? `<div class="copies">${esc(t('invoice.copies', { n: POD.num(copies), price: money(unit) }))}</div>` : ''}
        </td>
        <td class="num opt">${esc(POD.num(copies))}</td>
        <td class="num opt">${esc(money(unit))}</td>
        <td class="num">${esc(money(item.price))}</td>
      </tr>`;
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
    const paid = o.payment && o.payment.status === 'paid';
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
            <div class="inv-brand"><span class="brand-mark">1</span>${esc(tr(shop.name))}</div>
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
            <span class="inv-pay-status ${paid ? 'paid' : 'pending'}">${esc(t(paid ? 'invoice.paid' : 'invoice.unpaid'))}</span>
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
            ${o.discount ? `<div class="line"><span>${esc(t('coupon.discount'))}${o.coupon ? ` (${ltr(o.coupon)})` : ''}</span><span>${esc(money(-o.discount))}</span></div>` : ''}
            <div class="line"><span>${esc(t('checkout.shipping'))}</span><span>${o.shipping ? esc(money(o.shipping)) : esc(t('free'))}</span></div>
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
