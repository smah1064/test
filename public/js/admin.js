/* Production dashboard: works through the print queue one item at a time. */
(function () {
  'use strict';

  const { esc, money, toast } = POD;
  const KEY = 'pod-admin-password';
  const $ = (id) => document.getElementById(id);
  let password = sessionStorage.getItem(KEY) || '';
  let tab = 'queue';

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
    queued: { status: 'printing', label: 'Start printing' },
    printing: { status: 'printed', label: 'Mark as printed' },
    printed: { status: 'shipped', label: 'Mark as shipped' },
  };

  function spec(item) {
    const c = item.customer;
    return `
      <dl class="spec">
        <dt>Order</dt><dd>${esc(item.orderNumber)} · item ${item.position} of ${item.of}</dd>
        <dt>Product</dt><dd>${esc(item.productName)}</dd>
        <dt>Colour / size</dt><dd>${esc(item.color.name)} <span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(item.color.hex)}"></span> · ${esc(item.size.label)}</dd>
        ${item.sides.map((s) => `<dt>${esc(s.name)} print</dt><dd>${s.widthIn} × ${s.heightIn} in · ${s.widthPx} × ${s.heightPx} px · ${s.dpi} DPI</dd>`).join('')}
        <dt>Ship to</dt><dd>${esc(c.name)}<br>${esc(c.address1)}${c.address2 ? ', ' + esc(c.address2) : ''}<br>${esc(c.city)}${c.region ? ', ' + esc(c.region) : ''} ${esc(c.postalCode)}<br>${esc(c.country)}</dd>
        <dt>Email</dt><dd>${esc(c.email)}</dd>
      </dl>`;
  }

  function renderCurrent(item) {
    if (!item) {
      $('current').innerHTML = '<div class="card empty"><h3>The queue is clear</h3><p class="muted">New orders will appear here automatically.</p></div>';
      return;
    }
    const next = NEXT[item.status];
    $('current').innerHTML = `
      <div class="card now-printing">
        <div class="previews">${item.sides.map((s) => `<img src="${esc(s.previewUrl)}" alt="${esc(s.name)} preview">`).join('')}</div>
        <div>
          <span class="pill ${item.status}">${item.status}</span>
          ${spec(item)}
          <div class="print-files">
            ${item.sides.map((s) => `<button class="btn" data-download="${esc(s.printUrl)}">⬇ ${esc(s.name)} print file (PNG)</button>`).join('')}
          </div>
          <div class="row" style="max-width:420px">
            <button class="btn btn-primary btn-lg" data-item="${item.id}" data-status="${next.status}">${next.label}</button>
            ${item.status === 'printing' ? `<button class="btn btn-lg shrink" data-item="${item.id}" data-status="queued" title="Put it back in the queue">Back to queue</button>` : ''}
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
          <strong>${esc(item.productName)}</strong> <span class="pill ${item.status}">${item.status}</span>
          <div class="muted small">${esc(item.orderNumber)} · item ${item.position}/${item.of} · ${esc(item.color.name)} · ${esc(item.size.label)} · ${esc(item.sides.map((s) => s.name).join(' + '))}</div>
        </div>
        ${item.status === 'printed' ? `<button class="btn btn-sm" data-item="${item.id}" data-status="${next.status}">${next.label}</button>` : ''}
      </div>`;
  }

  async function refresh() {
    if (!password) {
      $('login').hidden = false;
      return;
    }
    if (tab === 'queue') {
      const q = await adminApi('/api/admin/queue');
      $('stats').innerHTML = [['queued', 'In queue'], ['printing', 'Printing'], ['printed', 'To ship'], ['shipped', 'Shipped']]
        .map(([k, label]) => `<div class="card stat"><b>${q.counts[k]}</b><span>${label}</span></div>`).join('');
      renderCurrent(q.current);
      $('up-next').innerHTML = q.upNext.length ? q.upNext.map(row).join('') : '<p class="muted">Nothing else waiting.</p>';
      $('to-ship').innerHTML = q.toShip.length ? q.toShip.map(row).join('') : '<p class="muted">Nothing waiting to ship.</p>';
    } else {
      const { orders } = await adminApi('/api/admin/orders');
      $('orders').innerHTML = orders.length ? orders.map((o) => `
        <tr>
          <td><strong>${esc(o.number)}</strong><div class="muted small">${new Date(o.createdAt).toLocaleString()}</div></td>
          <td>${esc(o.customer.name)}<div class="muted small">${esc(o.customer.email)}</div></td>
          <td><div class="mini-items">${o.items.map((i) => `<img src="${esc(i.sides[0].previewUrl)}" title="${esc(i.productName)}: ${esc(i.status)}" alt="">`).join('')}</div></td>
          <td>${money(o.total)}</td>
          <td><span class="pill ${o.status === 'shipped' ? 'shipped' : o.status === 'received' ? 'queued' : 'printing'}">${esc(o.status.replace('_', ' '))}</span></td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">No orders yet.</td></tr>';
    }
    $('login').hidden = true;
    $('dash').hidden = false;
    $('logout').hidden = false;
  }

  document.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-download]');
    if (dl) {
      try {
        const res = await fetch(dl.dataset.download, { headers: { 'x-admin-password': password } });
        if (!res.ok) throw new Error('Download failed');
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
