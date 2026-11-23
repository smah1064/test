/* Production dashboard: works through the print queue one item at a time. */
(function () {
  'use strict';

  const { esc, money, toast, t, tr } = POD;
  const KEY = 'pod-admin-password';
  const $ = (id) => document.getElementById(id);
  let password = sessionStorage.getItem(KEY) || '';
  let tab = 'queue';
  let lastQueue = null;
  let lastOrders = null;

  async function adminApi(url, options = {}) {
    try {
      return await POD.api(url, { ...options, headers: { ...(options.headers || {}), 'x-admin-password': password } });
    } catch (e) {
      if (e.status === 401) signOut(e.message);
      throw e;
    }
  }

  function signOut(message) {
    password = '';
    sessionStorage.removeItem(KEY);
    $('dash').hidden = true;
    $('logout').hidden = true;
    $('login').hidden = false;
    if (message) toast(message, 'error');
  }

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    password = $('password').value;
    try {
      await refresh();
      sessionStorage.setItem(KEY, password);
    } catch (err) {
      /* handled in adminApi */
    }
  });
  $('logout').addEventListener('click', () => signOut());

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('tab-queue').hidden = tab !== 'queue';
    $('tab-orders').hidden = tab !== 'orders';
    refresh();
  }));

  const NEXT = {
    queued: { status: 'printing', label: 'admin.start' },
    printing: { status: 'printed', label: 'admin.markPrinted' },
    printed: { status: 'shipped', label: 'admin.markShipped' },
  };
  const pill = (status) => `<span class="pill ${status}">${esc(t('admin.status.' + status))}</span>`;
  const cm = (inches) => POD.num(inches * 2.54);

  function address(c) {
    if (c.governorate || c.address) {
      return [c.name, c.address, [c.city, tr(c.governorateName)].filter(Boolean).join('، '), c.notes ? `(${c.notes})` : ''].filter(Boolean).map(esc).join('<br>');
    }
    // Orders placed before the Egypt checkout.
    return [c.name, c.address1, c.address2, [c.city, c.region, c.postalCode].filter(Boolean).join(' '), c.country].filter(Boolean).map(esc).join('<br>');
  }

  function spec(item) {
    const c = item.customer;
    return `
      <dl class="spec">
        <dt>${esc(t('admin.spec.order'))}</dt><dd>${esc(item.orderNumber)} · ${esc(t('admin.spec.itemOf', { i: item.position, n: item.of }))}</dd>
        <dt>${esc(t('admin.spec.product'))}</dt><dd>${esc(tr(item.productName))}</dd>
        <dt>${esc(t('admin.spec.colourSize'))}</dt><dd>${esc(tr(item.color.name))} <span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(item.color.hex)}"></span> · ${esc(tr(item.size.label))}</dd>
        ${item.sides.map((s) => `<dt>${esc(t('admin.spec.print', { side: tr(s.name) }))}</dt><dd><bdi dir="ltr">${cm(s.widthIn)} × ${cm(s.heightIn)} cm (${s.widthIn} × ${s.heightIn} in)${s.bleedIn ? ' ' + esc(t('admin.bleed', { mm: Math.round(s.bleedIn * 25.4) })) : ''} · ${s.widthPx} × ${s.heightPx} px · ${s.dpi} DPI · sRGB</bdi></dd>`).join('')}
        ${item.process ? `<dt>${esc(t('admin.method'))}</dt><dd>${esc(t('process.' + item.process))}</dd>` : ''}
        <dt>${esc(t('admin.spec.shipTo'))}</dt><dd>${address(c)}</dd>
        ${c.phone ? `<dt>${esc(t('admin.spec.phone'))}</dt><dd><a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a></dd>` : ''}
        ${c.email ? `<dt>${esc(t('admin.spec.email'))}</dt><dd>${esc(c.email)}</dd>` : ''}
        ${item.payment && item.payment.method === 'cod' ? `<dt>${esc(t('admin.spec.payment'))}</dt><dd>${esc(t('admin.collect', { amount: money(item.orderTotal) }))}</dd>` : ''}
      </dl>`;
  }

  const RECOMMENDED = { dtg: 'png', dtf: 'png', sublimation: 'png-mirror', uv: 'pdf', paper: 'pdf-marks' };
  function printFiles(item, s) {
    const rec = RECOMMENDED[item.process] || 'png';
    const formats = ['png', 'pdf', 'pdf-marks', 'png-mirror', 'tiff'].concat(s.hasSvg ? ['svg'] : []);
    return `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.files', { side: tr(s.name) }))}</div>
        <div class="print-files">
          ${formats.map((f) => `<button class="btn btn-sm ${f === rec ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${f === rec ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div>
      </div>`;
  }

  function renderCurrent(item) {
    if (!item) {
      $('current').innerHTML = `<div class="card empty"><h3>${esc(t('admin.clearTitle'))}</h3><p class="muted">${esc(t('admin.clearText'))}</p></div>`;
      return;
    }
    const next = NEXT[item.status];
    $('current').innerHTML = `
      <div class="card now-printing">
        <div class="previews">${item.sides.map((s) => `<img src="${esc(s.previewUrl)}" alt="${esc(tr(s.name))}">`).join('')}</div>
        <div>
          ${pill(item.status)}
          ${spec(item)}
          ${item.sides.map((s) => printFiles(item, s)).join('')}
          <div class="row" style="max-width:440px">
            <button class="btn btn-primary btn-lg" data-item="${item.id}" data-status="${next.status}">${esc(t(next.label))}</button>
            ${item.status === 'printing' ? `<button class="btn btn-lg shrink" data-item="${item.id}" data-status="queued" title="${esc(t('admin.backToQueue.title'))}">${esc(t('admin.backToQueue'))}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function row(item) {
    const next = NEXT[item.status];
    return `
      <div class="card queue-row">
        <img src="${esc(item.sides[0].previewUrl)}" alt="">
        <div>
          <strong>${esc(tr(item.productName))}</strong> ${pill(item.status)}
          <div class="muted small">${esc(item.orderNumber)} · ${esc(t('admin.spec.itemOf', { i: item.position, n: item.of }))} · ${esc(tr(item.color.name))} · ${esc(tr(item.size.label))} · ${esc(item.sides.map((s) => tr(s.name)).join(' + '))}</div>
        </div>
        ${item.status === 'printed' ? `<button class="btn btn-sm" data-item="${item.id}" data-status="${next.status}">${esc(t(next.label))}</button>` : ''}
      </div>`;
  }

  function renderQueue(q) {
    $('stats').innerHTML = ['queued', 'printing', 'printed', 'shipped']
      .map((k) => `<div class="card stat"><b>${POD.num(q.counts[k])}</b><span>${esc(t('admin.stat.' + k))}</span></div>`).join('');
    renderCurrent(q.current);
    $('up-next').innerHTML = q.upNext.length ? q.upNext.map(row).join('') : `<p class="muted">${esc(t('admin.nothingWaiting'))}</p>`;
    $('to-ship').innerHTML = q.toShip.length ? q.toShip.map(row).join('') : `<p class="muted">${esc(t('admin.nothingToShip'))}</p>`;
  }

  function renderOrders(orders) {
    const statusPill = (s) => `<span class="pill ${s === 'shipped' ? 'shipped' : s === 'received' ? 'queued' : 'printing'}">${esc(t('order.' + s))}</span>`;
    $('orders').innerHTML = orders.length ? orders.map((o) => `
      <tr>
        <td><strong>${esc(o.number)}</strong><div class="muted small">${esc(POD.date(o.createdAt))}</div></td>
        <td>${esc(o.customer.name)}<div class="muted small"><bdi dir="ltr">${esc(o.customer.phone || o.customer.email || '')}</bdi></div><div class="muted small">${esc(tr(o.customer.governorateName) || '')}</div></td>
        <td><div class="mini-items">${o.items.map((i) => `<img src="${esc(i.sides[0].previewUrl)}" title="${esc(tr(i.productName))}: ${esc(t('admin.status.' + i.status))}" alt="">`).join('')}</div></td>
        <td>${esc(money(o.total))}</td>
        <td>${statusPill(o.status)}</td>
      </tr>`).join('') : `<tr><td colspan="5" class="muted">${esc(t('admin.noOrders'))}</td></tr>`;
  }

  async function refresh() {
    if (!password) {
      $('login').hidden = false;
      return;
    }
    if (tab === 'queue') renderQueue((lastQueue = await adminApi('/api/admin/queue')));
    else renderOrders((lastOrders = (await adminApi('/api/admin/orders')).orders));
    $('login').hidden = true;
    $('dash').hidden = false;
    $('logout').hidden = false;
  }

  document.addEventListener('pod:langchange', () => {
    if (tab === 'queue' && lastQueue) renderQueue(lastQueue);
    if (tab === 'orders' && lastOrders) renderOrders(lastOrders);
  });

  document.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-download]');
    if (dl) {
      try {
        const res = await fetch(dl.dataset.download, { headers: { 'x-admin-password': password } });
        if (!res.ok) throw new Error(t('admin.downloadFailed'));
        const name = /filename="?([^"]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || 'print.png';
        const url = URL.createObjectURL(await res.blob());
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const btn = e.target.closest('[data-item][data-status]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await adminApi('/api/admin/items/' + encodeURIComponent(btn.dataset.item), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  refresh().catch(() => {});
  setInterval(() => !document.hidden && password && refresh().catch(() => {}), 15000);
})();
