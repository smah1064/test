/* Production dashboard: works through the print queue one item at a time. */
(function () {
  'use strict';

  const { esc, money, toast, t, tr } = POD;
  // The password is sent once to sign in; after that a session token is used.
  const KEY = 'pod-admin-token';
  const $ = (id) => document.getElementById(id);
  try { sessionStorage.removeItem('pod-admin-password'); } catch (e) { /* old versions kept the password */ }
  let token = sessionStorage.getItem(KEY) || '';
  const authHeader = () => ({ Authorization: 'Bearer ' + token });
  let tab = 'queue';
  let lastQueue = null;
  let lastOrders = null;
  let lastFilm = null;
  const filmPicked = new Set();
  let filmMsg = '';

  function renderFilm(items) {
    for (const id of [...filmPicked]) if (!items.some((i) => i.id === id)) filmPicked.delete(id);
    $('film-list').innerHTML = items.length
      ? items.map((it) => `
        <label class="card queue-row film-row">
          <input type="checkbox" data-film="${it.id}" ${filmPicked.has(it.id) || !it.filmBatch ? 'checked' : ''}>
          <img src="${esc(it.sides[0].previewUrl)}" alt="">
          <div>
            <strong>${esc(tr(it.productName))}</strong> ${pill(it.status)} ${it.filmBatch ? `<span class="pill printed">${esc(t('admin.onFilm', { id: it.filmBatch.id }))}</span>` : ''}
            <div class="muted small">${esc(it.orderNumber)} · ${esc(t('admin.spec.itemOf', { i: it.position, n: it.of }))} · ${esc(tr(it.color.name))} · ${esc(tr(it.size.label))} · ${esc(it.sides.map((sd) => `${tr(sd.name)} ${POD.num(sd.widthIn * 2.54)}×${POD.num(sd.heightIn * 2.54)} cm`).join(' + '))}</div>
          </div>
        </label>`).join('')
      : `<p class="muted">${esc(t('admin.filmNone'))}</p>`;
    items.forEach((it) => { if (!it.filmBatch) filmPicked.add(it.id); });
    $('film-build').disabled = !items.length;
    $('film-msg').textContent = filmMsg;
  }

  async function adminApi(url, options = {}) {
    try {
      return await POD.api(url, { ...options, headers: { ...(options.headers || {}), ...authHeader() } });
    } catch (e) {
      if (e.status === 401) signOut(e.message);
      throw e;
    }
  }

  function signOut(message) {
    if (token) fetch('/api/admin/logout', { method: 'POST', headers: authHeader() }).catch(() => {});
    token = '';
    sessionStorage.removeItem(KEY);
    $('weak-pw').hidden = true;
    $('dash').hidden = true;
    $('logout').hidden = true;
    $('login').hidden = false;
    if (message) toast(message, 'error');
  }

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login').querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await POD.api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('password').value }),
      });
      token = res.token;
      sessionStorage.setItem(KEY, token);
      $('password').value = '';
      $('weak-pw').hidden = !res.weakPassword;
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('logout').addEventListener('click', () => signOut());

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('tab-queue').hidden = tab !== 'queue';
    $('tab-orders').hidden = tab !== 'orders';
    $('tab-film').hidden = tab !== 'film';
    $('tab-library').hidden = tab !== 'library';
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
        ${item.process ? `<dt>${esc(t('admin.method'))}</dt><dd>
          ${(item.methods || []).length > 1 ? `<div class="btn-group" style="max-width:180px;margin-bottom:6px">${item.methods.map((m) => `<button class="btn btn-sm ${m === item.process ? 'active' : ''}" data-item="${item.id}" data-method="${m}">${esc(t('method.' + m))}</button>`).join('')}</div>` : ''}
          ${esc(t('process.' + item.process))}
          ${item.process === 'dtg' && isDark(item.color.hex) ? `<div class="small" style="color:var(--warn);margin-top:4px">${esc(t('admin.darkHint'))}</div>` : ''}
          ${item.filmBatch ? `<div><span class="pill printed">${esc(t('admin.onFilm', { id: item.filmBatch.id }))}</span></div>` : ''}
        </dd>` : ''}
        ${item.kind === 'gangsheet' && item.sides[0] ? `<dt>${esc(t('admin.spec.print', { side: tr(item.sides[0].name) }))}</dt><dd>${esc(t('admin.sheetInfo', { w: POD.num(item.sides[0].widthIn * 2.54), l: POD.num(Math.round(item.sides[0].heightIn * 2.54)), n: POD.num(item.pieces || 0), dpi: item.sides[0].dpi || '?' }))}</dd>` : ''}
        <dt>${esc(t('admin.spec.shipTo'))}</dt><dd>${address(c)}</dd>
        ${c.phone ? `<dt>${esc(t('admin.spec.phone'))}</dt><dd><a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a></dd>` : ''}
        ${c.email ? `<dt>${esc(t('admin.spec.email'))}</dt><dd>${esc(c.email)}</dd>` : ''}
        ${item.payment && item.payment.method === 'cod' ? `<dt>${esc(t('admin.spec.payment'))}</dt><dd>${esc(t('admin.collect', { amount: money(item.orderTotal) }))}</dd>` : ''}
      </dl>`;
  }

  const RECOMMENDED = { dtg: 'png', dtf: 'dtf-film', sublimation: 'png-mirror', uv: 'pdf', paper: 'pdf-marks' };
  const FORMATS_BY_METHOD = {
    dtg: ['png', 'dtg-white', 'pdf', 'tiff'],
    dtf: ['dtf-film', 'dtf-pdf', 'png', 'pdf'],
    sublimation: ['png-mirror', 'png', 'pdf', 'tiff'],
    uv: ['pdf', 'png', 'pdf-marks', 'tiff'],
    paper: ['pdf-marks', 'pdf', 'tiff', 'png'],
  };
  const isDark = (hex) => {
    const n = parseInt(String(hex || '#ffffff').slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.5;
  };
  function printFiles(item, s) {
    if (item.kind === 'book') {
      return `
        <div class="print-files-block"><div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.bookFiles'))}</div><div class="print-files">
          ${['book-pdf', 'proof'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div></div>`;
    }
    if (item.kind === 'gangsheet') {
      return `
        <div class="print-files-block"><div class="print-files">
          ${['sheet-pdf', 'sheet-pdf-plain', 'proof'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div></div>`;
    }
    const rec = RECOMMENDED[item.process] || 'png';
    const formats = (FORMATS_BY_METHOD[item.process] || ['png', 'pdf', 'pdf-marks', 'png-mirror', 'tiff']).concat(s.hasSvg ? ['svg'] : []);
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
        <td>${notifyCell(o.notifications, o.createdAt)}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="muted">${esc(t('admin.noOrders'))}</td></tr>`;
  }
  // ---------- Ready-made designs ----------
  let lastLibrary = null;
  function renderLibrary(lib) {
    const sel = $('lib-cat');
    const keep = sel.value;
    sel.innerHTML = lib.categories.map((c) => `<option value="${esc(c.id)}">${esc(tr(c.name))}</option>`).join('');
    if (keep) sel.value = keep;
    const catName = (id) => tr((lib.categories.find((c) => c.id === id) || {}).name || id);
    $('lib-list').innerHTML = lib.designs.map((d) => `
      <div class="queue-row lib-row ${d.hidden ? 'is-hidden' : ''}">
        <div class="lib-thumb">${d.preview ? `<img src="${esc(d.preview)}" alt="">` : '<span>Aa</span>'}</div>
        <div class="lib-info">
          <strong dir="auto">${esc(tr(d.name))}</strong>
          <div class="muted small">${esc(catName(d.category))} · ${esc(t(d.custom ? 'lib.yours' : 'lib.starter'))}${d.hidden ? ' · ' + esc(t('lib.hiddenNote')) : ''}</div>
        </div>
        <div class="lib-actions">
          <a class="btn btn-sm" href="/design?id=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(t('lib.open'))}</a>
          <button class="btn btn-sm" data-lib-toggle="${esc(d.id)}" data-hidden="${d.hidden ? '1' : ''}">${esc(t(d.hidden ? 'lib.show' : 'lib.hide'))}</button>
          ${d.custom ? `<button class="btn btn-sm btn-danger" data-lib-del="${esc(d.id)}">${esc(t('lib.delete'))}</button>` : ''}
        </div>
      </div>`).join('');
  }
  $('lib-list').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-lib-toggle]');
    const del = e.target.closest('[data-lib-del]');
    try {
      if (tog) {
        await adminApi('/api/admin/library/' + encodeURIComponent(tog.dataset.libToggle), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !tog.dataset.hidden }) });
      } else if (del) {
        if (!confirm(t('lib.confirmDelete'))) return;
        await adminApi('/api/admin/library/' + encodeURIComponent(del.dataset.libDel), { method: 'DELETE' });
      } else return;
      renderLibrary((lastLibrary = await adminApi('/api/admin/library')));
    } catch (err) {
      POD.toast(err.message, 'error');
    }
  });
  $('lib-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('lib-msg');
    msg.style.color = '';
    msg.textContent = t('notify.sending');
    try {
      const d = await adminApi('/api/admin/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share: $('lib-share').value, nameAr: $('lib-name-ar').value, nameEn: $('lib-name-en').value, category: $('lib-cat').value }),
      });
      msg.style.color = 'var(--ok)';
      msg.textContent = t('lib.added', { name: tr(d.name) });
      $('lib-share').value = '';
      $('lib-name-ar').value = '';
      $('lib-name-en').value = '';
      renderLibrary((lastLibrary = await adminApi('/api/admin/library')));
    } catch (err) {
      msg.style.color = '#c92a2a';
      msg.textContent = err.message;
    }
  });

  // ---------- Order notifications ----------
  const NOTIFY_CHANNELS = [['adminWhatsApp', '📱'], ['adminEmail', '✉️'], ['customerEmail', '👤']];
  function notifyCell(n, createdAt) {
    // Sending finishes within seconds of the order; older orders without a record predate notifications.
    if (!n) return `<span class="muted small">${Date.now() - Date.parse(createdAt) < 120000 ? '…' : '—'}</span>`;
    return `<div class="notify-cell">${NOTIFY_CHANNELS.filter(([k]) => n[k] && n[k] !== 'off').map(([k, icon]) =>
      `<span class="nb ${n[k] === 'sent' ? 'ok' : 'bad'}" title="${esc(t('notify.' + k))}: ${esc(t('notify.' + n[k]))}">${icon}${n[k] === 'sent' ? '✓' : '✗'}</span>`).join('') || `<span class="muted small">${esc(t('notify.none'))}</span>`}</div>`;
  }
  async function renderNotifyStatus() {
    try {
      const st = await adminApi('/api/admin/notifications');
      $('notify-status').innerHTML = ['adminWhatsApp', 'adminEmail', 'customerEmail', 'customerWhatsAppButton'].map((k) =>
        `<div class="notify-row"><span class="dot ${st[k] ? 'on' : 'off'}"></span>${esc(t('notify.' + k))}<span class="muted small">${esc(t(st[k] ? 'notify.on' : 'notify.offSetup'))}</span></div>`).join('');
      $('notify-test').disabled = !st.adminWhatsApp && !st.adminEmail;
    } catch (e) { /* signed out */ }
  }
  $('notify-test').addEventListener('click', async () => {
    const btn = $('notify-test');
    btn.disabled = true;
    $('notify-msg').textContent = t('notify.sending');
    try {
      const r = await adminApi('/api/admin/notifications/test', { method: 'POST' });
      $('notify-msg').textContent = ['adminWhatsApp', 'adminEmail'].filter((k) => r[k] !== 'off')
        .map((k) => `${t('notify.' + k)}: ${t('notify.' + r[k])}${r[k + 'Error'] ? ` (${r[k + 'Error']})` : ''}`).join(' · ');
    } catch (e) {
      $('notify-msg').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  async function refresh() {
    if (!token) {
      $('login').hidden = false;
      return;
    }
    if (tab === 'queue') renderQueue((lastQueue = await adminApi('/api/admin/queue')));
    else if (tab === 'film') renderFilm((lastFilm = (await adminApi('/api/admin/dtf-items')).items));
    else if (tab === 'library') renderLibrary((lastLibrary = await adminApi('/api/admin/library')));
    else { renderOrders((lastOrders = (await adminApi('/api/admin/orders')).orders)); renderNotifyStatus(); }
    $('login').hidden = true;
    $('dash').hidden = false;
    $('logout').hidden = false;
  }

  document.addEventListener('pod:langchange', () => {
    if (tab === 'queue' && lastQueue) renderQueue(lastQueue);
    if (tab === 'orders' && lastOrders) renderOrders(lastOrders);
    if (tab === 'film' && lastFilm) renderFilm(lastFilm);
    if (tab === 'library' && lastLibrary) renderLibrary(lastLibrary);
  });

  $('film-list').addEventListener('change', (e) => {
    const id = e.target.dataset.film;
    if (!id) return;
    if (e.target.checked) filmPicked.add(id);
    else filmPicked.delete(id);
  });
  $('film-build').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('[data-film]:checked')].map((c) => c.dataset.film);
    if (!ids.length) return;
    const btn = $('film-build');
    btn.disabled = true;
    btn.textContent = t('admin.filmBuilding');
    try {
      const res = await fetch('/api/admin/dtf-film', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(), 'x-lang': POD.lang },
        body: JSON.stringify({ itemIds: ids }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Film failed');
      const batch = res.headers.get('x-film-batch');
      const len = Number(res.headers.get('x-film-length-in')) * 2.54;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `dtf-film-${batch}.pdf` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      filmMsg = t('admin.filmDone', { id: batch, len: POD.num(Math.round(len)) });
      filmPicked.clear();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('admin.filmBuild');
    }
  });

  document.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-download]');
    if (dl) {
      try {
        const res = await fetch(dl.dataset.download, { headers: authHeader() });
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
    const mbtn = e.target.closest('[data-item][data-method]');
    if (mbtn) {
      try {
        await adminApi('/api/admin/items/' + encodeURIComponent(mbtn.dataset.item), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ process: mbtn.dataset.method }),
        });
        await refresh();
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
  if (token) adminApi('/api/admin/session').then((r) => { $('weak-pw').hidden = !r.weakPassword; }).catch(() => {});
  setInterval(() => !document.hidden && token && refresh().catch(() => {}), 15000);
})();
