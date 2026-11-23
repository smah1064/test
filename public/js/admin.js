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
  const filmSeen = new Set();
  let filmMsg = '';

  function renderFilm(items) {
    for (const id of [...filmPicked]) if (!items.some((i) => i.id === id)) filmPicked.delete(id);
    $('film-list').innerHTML = items.length
      ? items.map((it) => `
        <label class="card queue-row film-row">
          <input type="checkbox" data-film="${it.id}" ${filmPicked.has(it.id) || (!it.filmBatch && !filmSeen.has(it.id)) ? 'checked' : ''}>
          <img src="${esc(it.sides[0].previewUrl)}" alt="" ${zoomAttr(it)}>
          <div>
            <strong>${esc(tr(it.productName))}</strong> ${pill(it.status)}${piecesPill(it)} ${it.filmBatch ? `<span class="pill printed">${esc(t('admin.onFilm', { id: it.filmBatch.id }))}</span>` : ''}
            <div class="muted small">${esc([it.orderNumber, t('admin.spec.itemOf', { i: it.position, n: it.of }), ...colourSizeText(it), it.sides.map((sd) => `${tr(sd.name)} ${t('admin.cmSize', { w: POD.num(sd.widthIn * 2.54), h: POD.num(sd.heightIn * 2.54) })}`).join(' + ')].join(' · '))}</div>
            ${hasQty(it) ? qtySummary(it) : ''}
          </div>
        </label>`).join('')
      : `<p class="muted">${esc(t('admin.filmNone'))}</p>`;
    // New items start ticked; an item the admin unticked stays unticked across refreshes.
    items.forEach((it) => { if (!filmSeen.has(it.id)) { filmSeen.add(it.id); if (!it.filmBatch) filmPicked.add(it.id); } });
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
    const wasIn = Boolean(token);
    if (token) fetch('/api/admin/logout', { method: 'POST', headers: authHeader() }).catch(() => {});
    token = '';
    sessionStorage.removeItem(KEY);
    $('weak-pw').hidden = true;
    $('dash').hidden = true;
    $('logout').hidden = true;
    $('login').hidden = false;
    if (message && wasIn) toast(message, 'error'); // several requests fail at once: say it once
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
    $('tab-houses').hidden = tab !== 'houses';
    $('tab-accounts').hidden = tab !== 'accounts';
    $('tab-coupons').hidden = tab !== 'coupons';
    $('tab-customers').hidden = tab !== 'customers';
    refresh();
  }));

  const NEXT = {
    queued: { status: 'printing', label: 'admin.start' },
    printing: { status: 'printed', label: 'admin.markPrinted' },
    printed: { status: 'shipped', label: 'admin.markShipped' },
  };
  const pill = (status) => `<span class="pill ${status}">${esc(t('admin.status.' + status))}</span>`;
  // Production sizes in Western digits with a dot, like the inches, DPI and pixels next to them
  // (Arabic digits and the Arabic decimal mark are easy to misread on the print floor).
  const cm = (inches) => String(Math.round(inches * 2.54 * 10) / 10);

  // ---------- One artwork in several colours / sizes (item.quantities) ----------
  if (!document.querySelector('link[href="/css/quantities.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/quantities.css';
    document.head.appendChild(link);
  }
  const qtyLines = (item) => (Array.isArray(item.quantities) ? item.quantities.filter((l) => l && Number(l.qty) > 0) : []);
  const piecesOf = (item) => Math.max(1, Number(item.copies) || qtyLines(item).reduce((n, l) => n + Number(l.qty), 0) || 1);
  const piecesText = (n) => t('adminQty.n.' + (n === 1 ? 'one' : n === 2 ? 'two' : n % 100 >= 3 && n % 100 <= 10 ? 'few' : 'many'), { n: POD.num(n) });
  /** True when the shop prints more than one piece of this item in colours/sizes listed in quantities. */
  const hasQty = (item) => qtyLines(item).length > 1 || (qtyLines(item).length === 1 && piecesOf(item) > 1);
  /** The lines grouped by colour, in the order they come: [{ color, lines, qty }]. */
  function qtyGroups(item) {
    const groups = new Map();
    for (const l of qtyLines(item)) {
      const c = l.color || {};
      const key = c.id || tr(c.name) || '';
      if (!groups.has(key)) groups.set(key, { color: c, lines: [], qty: 0 });
      const g = groups.get(key);
      g.lines.push(l);
      g.qty += Number(l.qty);
    }
    return [...groups.values()];
  }
  const swatch = (c) => (c && c.hex ? `<span class="qty-dot" style="background:${esc(c.hex)}"></span>` : '');
  const sizeName = (l) => (l.size && tr(l.size.label)) || '';
  /** Production table: colour swatch + name, then size × pieces, then pieces per colour and the total. */
  function qtyTable(item) {
    const groups = qtyGroups(item);
    return `
      <div class="qty-prod">
        <table>
          <thead><tr><th>${esc(t('adminQty.colour'))}</th><th>${esc(t('adminQty.sizes'))}</th><th class="qty-n">${esc(t('adminQty.count'))}</th></tr></thead>
          <tbody>${groups.map((g) => `
            <tr>
              <td class="qty-color">${swatch(g.color)}${esc(tr(g.color.name) || '—')}</td>
              <td><div class="qty-sizes">${g.lines.map((l) => `<span class="qty-size">${sizeName(l) ? `<span>${esc(sizeName(l))}</span>` : ''}<b>×${esc(POD.num(Number(l.qty)))}</b></span>`).join('')}</div></td>
              <td class="qty-n">${esc(POD.num(g.qty))}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="2">${esc(t('adminQty.total'))}</td><td class="qty-n">${esc(POD.num(piecesOf(item)))}</td></tr></tfoot>
        </table>
      </div>
      ${item.merge ? '' : `<div class="qty-names-note">${esc(t('adminQty.sameArt'))}</div>`}`;
  }
  /** Short form for lists: ● Black: S×2 M×5 L×3 · ● White: M×2. */
  function qtySummary(item) {
    return `<div class="qty-sum">${qtyGroups(item).map((g) => `<span class="qty-grp">${swatch(g.color)}<b>${esc(tr(g.color.name))}${tr(g.color.name) ? ':' : ''}</b>${g.lines.map((l) => `<span class="qty-chip">${esc(sizeName(l))}×<b>${esc(POD.num(Number(l.qty)))}</b></span>`).join('')}</span>`).join('')}</div>`;
  }
  const piecesPill = (item) => (hasQty(item) ? ` <span class="qty-pieces">${esc(piecesText(piecesOf(item)))}</span>` : '');
  /** "Black · M" for one piece, or nothing when the summary below lists the colours and sizes. */
  const colourSizeText = (item) => (hasQty(item) ? [] : [tr(item.color.name), tr(item.size.label)]);
  const anyDark = (item) => (qtyLines(item).length ? qtyLines(item).some((l) => l.color && isDark(l.color.hex)) : isDark(item.color.hex));

  function address(c) {
    if (c.governorate || c.address) {
      return [c.name, c.address, [c.city, tr(c.governorateName)].filter(Boolean).join('، '), c.notes ? `(${c.notes})` : ''].filter(Boolean).map(esc).join('<br>');
    }
    // Orders placed before the Egypt checkout.
    return [c.name, c.address1, c.address2, [c.city, c.region, c.postalCode].filter(Boolean).join(' '), c.country].filter(Boolean).map(esc).join('<br>');
  }

  function redrawLine(item) {
    const r = item.redraw;
    if (!r) return esc(t('admin.redraw.off'));
    const line = esc(t('admin.redraw.' + r.status, { done: POD.num(r.done || 0), total: POD.num(r.total || 0) }));
    const kept = r.failed && r.failed.length ? ` · ${esc(t('admin.redraw.kept', { n: POD.num(r.failed.length) }))}` : '';
    const again = ['done', 'failed'].includes(r.status) ? ` <button class="btn btn-sm" data-redraw="${esc(item.id)}">${esc(t('admin.redraw.again'))}</button>` : '';
    return line + kept + again;
  }
  function placementText(o) {
    const parts = [];
    if (o.y) parts.push(t(o.y > 0 ? 'area.lower' : 'area.higher', { n: POD.num(Math.abs(o.y)) }));
    if (o.x) parts.push(t(o.x > 0 ? 'area.right' : 'area.left', { n: POD.num(Math.abs(o.x)) }));
    return parts.join(POD.lang === 'ar' ? ' و' : ', ');
  }
  function spec(item) {
    const c = item.customer;
    return `
      <dl class="spec">
        <dt>${esc(t('admin.spec.order'))}</dt><dd>${esc(item.orderNumber)} · ${esc(t('admin.spec.itemOf', { i: item.position, n: item.of }))}</dd>
        <dt>${esc(t('admin.spec.product'))}</dt><dd>${esc(tr(item.productName))}</dd>
        ${hasQty(item) ? `<dt>${esc(t('adminQty.title'))}</dt><dd class="qty-dd">${qtyTable(item)}</dd>` : `<dt>${esc(t('admin.spec.colourSize'))}</dt><dd>${esc(tr(item.color.name))} <span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(item.color.hex)}"></span> · ${esc(tr(item.size.label))}</dd>`}
        ${item.sides.map((s) => `<dt>${esc(t('admin.spec.print', { side: tr(s.name) }))}</dt><dd><bdi dir="ltr">${cm(s.widthIn)} × ${cm(s.heightIn)} cm (${s.widthIn} × ${s.heightIn} in)${s.bleedIn ? ' ' + esc(t('admin.bleed', { mm: Math.round(s.bleedIn * 25.4) })) : ''} · ${s.widthPx} × ${s.heightPx} px · ${s.dpi} DPI · sRGB</bdi>${s.offsetCm ? `<div class="placement-note">📍 ${esc(t('admin.placement', { v: placementText(s.offsetCm) }))}</div>` : ''}</dd>`).join('')}
        ${item.emb ? `<dt>${esc(t('admin.emb'))}</dt><dd>
          <div><strong>${esc(t('admin.embSummary', { n: POD.num(item.emb.stitches), c: item.emb.colors.length, w: item.emb.widthMm, h: item.emb.heightMm }))}</strong></div>
          <ol class="emb-threads">${item.emb.colors.map((c) => `<li><span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(c.hex)}"></span> ${esc(c.name)} <span class="muted">(${esc(c.hex)} · ${esc(POD.num(c.stitches))})</span></li>`).join('')}</ol>
          ${(item.emb.warnings || []).filter((w) => w !== 'empty').map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(t('admin.embWarn.' + w))}</div>`).join('')}
        </dd>` : ''}
        ${item.merge ? `<dt>${esc(t('admin.mergeCopies'))}</dt><dd><strong>${esc(t('admin.mergeSpec', { n: POD.num(item.merge.count), cols: item.merge.columns.join(', ') }))}</strong></dd>` : ''}
        ${item.pattern ? `<dt>${esc(t('admin.pattern'))}</dt><dd><strong>${esc(t('admin.patternSpec', { tile: item.pattern.tileCm, repeat: t('pat.' + item.pattern.repeat), w: item.pattern.fabricCm[0], h: item.pattern.fabricCm[1] }))}</strong></dd>` : ''}
        ${item.process ? `<dt>${esc(t('admin.method'))}</dt><dd>
          ${(item.methods || []).length > 1 ? `<div class="btn-group" style="max-width:180px;margin-bottom:6px">${item.methods.map((m) => `<button class="btn btn-sm ${m === item.process ? 'active' : ''}" data-item="${item.id}" data-method="${m}">${esc(t('method.' + m))}</button>`).join('')}</div>` : ''}
          ${esc(t('process.' + item.process))}
          ${item.process === 'dtg' && anyDark(item) ? `<div class="small" style="color:var(--warn);margin-top:4px">${esc(t('admin.darkHint'))}</div>` : ''}
          ${item.filmBatch ? `<div><span class="pill printed">${esc(t('admin.onFilm', { id: item.filmBatch.id }))}</span></div>` : ''}
        </dd>` : ''}
        ${item.kind === 'book' ? `<dt>${esc(t('admin.bookFiles'))}</dt><dd>${redrawLine(item)}</dd>` : ''}
        ${item.kind === 'gangsheet' && item.sides[0] ? `<dt>${esc(t('admin.spec.print', { side: tr(item.sides[0].name) }))}</dt><dd>${esc(t('admin.sheetInfo', { w: POD.num(item.sides[0].widthIn * 2.54), l: POD.num(Math.round(item.sides[0].heightIn * 2.54)), n: POD.num(item.pieces || 0), dpi: item.sides[0].dpi || '?' }))}</dd>` : ''}
        <dt>${esc(t('admin.spec.shipTo'))}</dt><dd>${address(c)}</dd>
        ${c.phone ? `<dt>${esc(t('admin.spec.phone'))}</dt><dd><a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a></dd>` : ''}
        ${c.email ? `<dt>${esc(t('admin.spec.email'))}</dt><dd>${esc(c.email)}</dd>` : ''}
        ${item.payment && item.payment.method === 'cod' ? `<dt>${esc(t('admin.spec.payment'))}</dt><dd>${esc(t('admin.collect', { amount: money(item.orderTotal) }))}</dd>` : ''}
        ${item.coupon ? `<dt>${esc(t('coupon.discount'))}</dt><dd><bdi dir="ltr">${esc(item.coupon.code)}</bdi> · -${esc(money(item.coupon.discount))}</dd>` : ''}
      </dl>`;
  }

  const RECOMMENDED = { dtg: 'png', dtf: 'dtf-film', sublimation: 'png-mirror', uv: 'pdf', paper: 'pdf-marks', canvas: 'pdf', textile: 'png', embroidery: 'dst' };
  const FORMATS_BY_METHOD = {
    dtg: ['png', 'dtg-white', 'pdf', 'tiff'],
    dtf: ['dtf-film', 'dtf-pdf', 'png', 'pdf'],
    sublimation: ['png-mirror', 'png', 'pdf', 'tiff'],
    uv: ['pdf', 'png', 'pdf-marks', 'tiff'],
    paper: ['pdf-marks', 'pdf', 'tiff', 'png'],
    canvas: ['pdf', 'tiff', 'png', 'pdf-marks'],
    textile: ['png', 'tiff', 'pdf'],
    embroidery: ['dst', 'stitches', 'png', 'pdf'],
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
    // Name list: every copy with its own name. Shown once (with the first side); the side files below show copy 1.
    const mergeBlock = item.merge && item.sides[0] === s ? `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.mergeFiles', { n: POD.num(item.merge.count) }))}</div>
        <div class="print-files">
          ${['merge-pdf-marks', 'merge-pdf', 'merge-zip', 'merge-csv'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div>
      </div>` : '';
    return mergeBlock + `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.files', { side: tr(s.name) }))}</div>
        <div class="print-files">
          ${formats.map((f) => `<button class="btn btn-sm ${f === rec ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${f === rec ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div>
      </div>`;
  }

  // ---------- Sending items to printing houses ----------
  let housesData = null;
  const sendOpen = new Set();
  const sendState = {};
  const findHouse = (id) => (housesData && housesData.houses.find((h) => h.id === id)) || null;
  const printPdfKey = (item) => (item.kind === 'book' ? 'book-pdf' : item.kind === 'gangsheet' ? 'sheet-pdf' : 'pdf');
  function sendFormats(item) {
    if (item.kind === 'book') return ['book-pdf', 'preview-pdf', 'proof'];
    if (item.kind === 'gangsheet') return ['sheet-pdf', 'sheet-pdf-plain', 'preview-pdf', 'proof'];
    const more = (FORMATS_BY_METHOD[item.process] || ['png', 'pdf-marks', 'png-mirror', 'tiff']).concat(item.sides.some((sd) => sd.hasSvg) ? ['svg'] : []);
    return [...new Set(['pdf', 'preview-pdf', ...more, ...(item.pattern ? ['repeat'] : [])])];
  }
  function sendDefaults(item) {
    const houseId = (housesData && (housesData.productHouses[item.productId] || (housesData.houses[0] && housesData.houses[0].id))) || '';
    const house = findHouse(houseId);
    return { houseId, channel: house ? house.prefer : 'email', formats: new Set([printPdfKey(item), 'preview-pdf']), note: '', msg: '', busy: false };
  }
  const when = (iso) => new Date(iso).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function sendHistory(item) {
    const list = (item.sends || []).slice(-3).reverse();
    if (!list.length) return '';
    return `<div class="send-history">${list.map((x) => `<div>📤 ${esc(t('houses.sentLine', { house: x.houseName, channel: t(x.channel === 'email' ? 'houses.byEmail' : 'houses.byWhatsApp'), date: when(x.at) }))}</div>`).join('')}</div>`;
  }
  function sendButton(item, big) {
    return `<button class="btn ${big ? 'btn-lg shrink' : 'btn-sm'}" data-send-toggle="${item.id}" type="button">📤 ${esc(t('houses.send'))}</button>`;
  }
  function sendPanel(item) {
    if (!sendOpen.has(item.id)) return '';
    if (!housesData || !housesData.houses.length) {
      return `<div class="send-panel"><p class="muted small" style="margin:0 0 8px">${esc(t('houses.none'))}</p><button class="btn btn-sm" type="button" data-go-tab="houses">${esc(t('houses.goSetup'))}</button></div>`;
    }
    const st = (sendState[item.id] ||= sendDefaults(item));
    if (!findHouse(st.houseId)) Object.assign(st, sendDefaults(item), { formats: st.formats });
    const house = findHouse(st.houseId);
    const def = housesData.productHouses[item.productId];
    const ch = (key, ok) => `<label class="chip-radio ${ok ? '' : 'is-off'}"><input type="radio" name="send-ch-${item.id}" value="${key}" data-send-channel="${item.id}" ${st.channel === key ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${esc(t(key === 'email' ? 'houses.byEmail' : 'houses.byWhatsApp'))}${ok ? '' : ` <span class="muted">${esc(t(key === 'email' ? 'houses.noEmail' : 'houses.noWhatsApp'))}</span>`}</label>`;
    const emailOff = st.channel === 'email' && !housesData.email;
    return `
      <div class="send-panel" data-send-panel="${item.id}">
        <div class="send-grid">
          <div class="field"><label>${esc(t('houses.sendTo'))}</label>
            <select data-send-house="${item.id}">${housesData.houses.map((h) => `<option value="${esc(h.id)}" ${h.id === st.houseId ? 'selected' : ''}>${esc(h.name)}${h.id === def ? ` · ${esc(t('houses.default'))}` : ''}</option>`).join('')}</select>
          </div>
          <div class="field"><label>${esc(t('houses.via'))}</label><div class="chip-row">${ch('email', Boolean(house && house.email))}${ch('whatsapp', Boolean(house && house.whatsapp))}</div></div>
        </div>
        ${emailOff ? `<p class="notice small" style="margin:0 0 10px">${esc(t('houses.emailOff'))}</p>` : ''}
        <div class="field"><label>${esc(t('houses.files'))}</label>
          <div class="send-files">${sendFormats(item).map((f) => `<label class="check-chip"><input type="checkbox" data-send-format="${item.id}" value="${f}" ${st.formats.has(f) ? 'checked' : ''}> ${esc(t('fmt.' + f))}</label>`).join('')}</div>
        </div>
        <div class="field"><label>${esc(t('houses.note'))}</label><textarea rows="2" maxlength="500" data-send-note="${item.id}">${esc(st.note)}</textarea></div>
        <div class="row" style="flex-wrap:wrap;gap:10px;align-items:center">
          <button class="btn btn-primary shrink" type="button" data-send-go="${item.id}" ${st.busy || emailOff || !st.formats.size ? 'disabled' : ''}>${esc(t(st.busy ? 'houses.sending' : 'houses.sendNow'))}</button>
          <span class="small send-msg">${st.msg || ''}</span>
        </div>
      </div>`;
  }
  const rerenderQueue = () => lastQueue && renderQueue(lastQueue);
  const itemById = (id) => lastQueue && [...lastQueue.printing, ...lastQueue.waiting, ...lastQueue.toShip].find((i) => i.id === id);
  document.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go-tab]');
    if (go) { document.querySelector(`[data-tab="${go.dataset.goTab}"]`).click(); return; }
    const tog = e.target.closest('[data-send-toggle]');
    if (tog) {
      const id = tog.dataset.sendToggle;
      if (sendOpen.has(id)) sendOpen.delete(id);
      else { sendOpen.add(id); if (!housesData) housesData = await adminApi('/api/admin/houses').catch(() => null); }
      rerenderQueue();
      return;
    }
    const btn = e.target.closest('[data-send-go]');
    if (!btn) return;
    const id = btn.dataset.sendGo;
    const st = sendState[id];
    const item = itemById(id);
    if (!st || !item) return;
    // Open the WhatsApp window now (browsers block it after waiting for the server).
    const win = st.channel === 'whatsapp' ? window.open('about:blank', '_blank') : null;
    st.busy = true;
    st.msg = '';
    rerenderQueue();
    try {
      const r = await adminApi(`/api/admin/items/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang },
        body: JSON.stringify({ houseId: st.houseId, channel: st.channel, formats: [...st.formats], note: st.note }),
      });
      item.sends = r.item.sends;
      const house = findHouse(st.houseId);
      if (r.whatsappUrl) {
        if (win) { win.opener = null; win.location.href = r.whatsappUrl; }
        st.msg = `<span style="color:var(--ok);font-weight:600">${esc(t('houses.sentWhatsApp', { house: house ? house.name : '' }))}</span> <a class="btn btn-sm" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">${esc(t('houses.openWhatsApp'))}</a>`;
      } else {
        st.msg = `<span style="color:var(--ok);font-weight:600">${esc(t('houses.sentEmail', { house: house ? house.name : '' }))}</span>`;
        toast(t('houses.sentEmail', { house: house ? house.name : '' }));
      }
    } catch (err) {
      if (win) win.close();
      st.msg = `<span style="color:var(--danger, #c0392b)">${esc(err.message)}</span>`;
    } finally {
      st.busy = false;
      rerenderQueue();
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    const id = el.dataset.sendHouse || el.dataset.sendChannel || el.dataset.sendFormat;
    if (!id || !sendState[id]) return;
    const st = sendState[id];
    if (el.dataset.sendHouse) {
      st.houseId = el.value;
      const h = findHouse(el.value);
      if (h) st.channel = h.prefer;
    } else if (el.dataset.sendChannel) st.channel = el.value;
    else if (el.checked) st.formats.add(el.value);
    else st.formats.delete(el.value);
    st.msg = '';
    rerenderQueue();
  });
  document.addEventListener('input', (e) => {
    const id = e.target.dataset && e.target.dataset.sendNote;
    if (id && sendState[id]) sendState[id].note = e.target.value;
  });

  // ---------- Printing houses tab ----------
  function renderHouses(d) {
    $('houses-email-off').hidden = d.email;
    const uses = (id) => Object.values(d.productHouses).filter((h) => h === id).length;
    $('house-list').innerHTML = d.houses.length
      ? d.houses.map((h) => `
        <div class="card house-row">
          <div>
            <strong>${esc(h.name)}</strong> <span class="pill queued">${esc(t(h.prefer === 'email' ? 'houses.byEmail' : 'houses.byWhatsApp'))}</span>
            <div class="muted small">${[h.email ? `✉️ <bdi dir="ltr">${esc(h.email)}</bdi>` : '', h.whatsapp ? `💬 <bdi dir="ltr">+${esc(h.whatsapp)}</bdi>` : '', esc(t(uses(h.id) === 1 ? 'houses.product1' : 'houses.products', { n: POD.num(uses(h.id)) }))].filter(Boolean).join(' · ')}</div>
            ${h.notes ? `<div class="muted small">${esc(h.notes)}</div>` : ''}
          </div>
          <div class="row" style="gap:8px;flex:0 0 auto">
            <button class="btn btn-sm" type="button" data-house-edit="${esc(h.id)}">${esc(t('houses.edit'))}</button>
            <button class="btn btn-sm" type="button" data-house-del="${esc(h.id)}">${esc(t('houses.delete'))}</button>
          </div>
        </div>`).join('')
      : `<p class="muted">${esc(t('houses.empty'))}</p>`;
    const opts = (pid) => `<option value="">${esc(t('houses.unset'))}</option>${d.houses.map((h) => `<option value="${esc(h.id)}" ${d.productHouses[pid] === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}`;
    $('house-map').innerHTML = d.categories.map((c) => {
      const prods = d.products.filter((p) => p.category === c.id);
      if (!prods.length) return '';
      return `<h3 class="house-map-cat">${esc(tr(c.name))}</h3><div class="house-map-grid">${prods.map((p) => `
        <label class="house-map-row"><span>${esc(tr(p.name))}</span><select data-map-product="${esc(p.id)}" ${d.houses.length ? '' : 'disabled'}>${opts(p.id)}</select></label>`).join('')}</div>`;
    }).join('');
  }
  function resetHouseForm() {
    $('house-form').reset();
    $('house-id').value = '';
    $('house-cancel').hidden = true;
    $('house-form-title').textContent = t('houses.addTitle');
  }
  $('house-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('house-id').value;
    const body = { name: $('house-name').value, email: $('house-email').value, whatsapp: $('house-wa').value, prefer: $('house-prefer').value, notes: $('house-notes').value };
    $('house-save').disabled = true;
    try {
      await adminApi(id ? `/api/admin/houses/${encodeURIComponent(id)}` : '/api/admin/houses', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify(body) });
      resetHouseForm();
      $('house-msg').textContent = t('houses.saved');
      setTimeout(() => { $('house-msg').textContent = ''; }, 2500);
      renderHouses((housesData = await adminApi('/api/admin/houses')));
    } catch (err) {
      $('house-msg').textContent = err.message;
    } finally {
      $('house-save').disabled = false;
    }
  });
  $('house-cancel').addEventListener('click', resetHouseForm);
  $('house-list').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-house-edit]');
    const del = e.target.closest('[data-house-del]');
    const h = findHouse((ed || del || {}).dataset ? (ed || del).dataset.houseEdit || (ed || del).dataset.houseDel : '');
    if (!h) return;
    if (ed) {
      $('house-id').value = h.id;
      $('house-name').value = h.name;
      $('house-email').value = h.email || '';
      $('house-wa').value = h.whatsapp ? '+' + h.whatsapp : '';
      $('house-prefer').value = h.prefer;
      $('house-notes').value = h.notes || '';
      $('house-cancel').hidden = false;
      $('house-form-title').textContent = t('houses.editTitle');
      $('house-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('house-name').focus();
    } else if (confirm(t('houses.confirmDelete', { name: h.name }))) {
      try {
        await adminApi(`/api/admin/houses/${encodeURIComponent(h.id)}`, { method: 'DELETE' });
        renderHouses((housesData = await adminApi('/api/admin/houses')));
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  $('house-map').addEventListener('change', async (e) => {
    const pid = e.target.dataset.mapProduct;
    if (!pid) return;
    try {
      const r = await adminApi('/api/admin/product-houses', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ productId: pid, houseId: e.target.value || null }) });
      housesData.productHouses = r.productHouses;
      renderHouses(housesData);
      toast(t('houses.saved'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  /** The customer's design (all sides / book pages) as one PDF, to check or send them. */
  function previewFile(item) {
    const s = item.sides[0];
    if (!s || !s.printUrl) return '';
    return `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.customerPreview'))}</div>
        <div class="print-files"><button class="btn btn-sm" data-download="${esc(s.printUrl)}?format=preview-pdf">⬇ ${esc(t('fmt.preview-pdf'))}</button>${item.pattern ? `<button class="btn btn-sm" data-download="${esc(s.printUrl)}?format=repeat">⬇ ${esc(t('fmt.repeat'))}</button>` : ''}</div>
      </div>`;
  }
  // Big picture when the mouse is over a thumbnail (all sides of the item).
  function zoomAttr(item) {
    return `data-zoom="${esc(JSON.stringify(item.sides.map((s) => s.previewUrl)))}"`;
  }

  // Items whose details are open in the waiting list (kept across refreshes).
  const open = new Set();
  function card(item) {
    const next = NEXT[item.status];
    return `
      <div class="card now-printing">
        <div class="previews">${item.sides.map((s) => `<img src="${esc(s.previewUrl)}" alt="${esc(tr(s.name))}" data-zoom="${esc(JSON.stringify([s.previewUrl]))}">`).join('')}</div>
        <div>
          ${pill(item.status)}${importBadge(item)}${piecesPill(item)}
          ${spec(item)}
          ${importInfo(item)}
          ${item.sides.map((s) => printFiles(item, s)).join('')}
          ${previewFile(item)}
          ${sendHistory(item)}
          ${sendPanel(item)}
          <div class="row" style="max-width:640px;flex-wrap:wrap">
            <button class="btn btn-primary btn-lg" data-item="${item.id}" data-status="${next.status}">${esc(t(next.label))}</button>
            ${sendButton(item, true)}
            ${item.status === 'printing' ? `<button class="btn btn-lg shrink" data-item="${item.id}" data-status="queued" title="${esc(t('admin.backToQueue.title'))}">${esc(t('admin.backToQueue'))}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  /** Imported design: a badge, and where it came from (the customer confirmed the rights). */
  const importBadge = (item) => (item.imports && item.imports.length ? ` <span class="pill import-pill" title="${esc(t('admin.imported.title'))}">${esc(t('admin.imported'))}</span>` : '');
  const importInfo = (item) => (item.imports && item.imports.length
    ? `<div class="import-info small"><strong>${esc(t('admin.imported.from'))}</strong> ${item.imports.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr">${esc(u.length > 70 ? u.slice(0, 67) + '…' : u)}</a>`).join('<br>')}<div class="muted">${esc(t('admin.imported.rights', { date: POD.date(item.rightsConfirmedAt || item.orderedAt) }))}</div></div>`
    : '');

  function row(item) {
    const next = NEXT[item.status];
    const isOpen = open.has(item.id);
    return `
      <div class="card queue-row ${isOpen ? 'is-open' : ''}">
        <img src="${esc(item.sides[0].previewUrl)}" alt="" ${zoomAttr(item)}>
        <div>
          <strong>${esc(tr(item.productName))}</strong> ${pill(item.status)}${importBadge(item)}${piecesPill(item)}
          <div class="muted small">${esc([item.orderNumber, t('admin.spec.itemOf', { i: item.position, n: item.of }), ...colourSizeText(item), item.sides.map((s) => tr(s.name)).join(' + ')].join(' · '))}</div>
          ${hasQty(item) ? qtySummary(item) : ''}
        </div>
        <div class="queue-actions">
          <button class="btn btn-sm" data-toggle-item="${item.id}">${esc(t(isOpen ? 'admin.hideDetails' : 'admin.details'))}</button>
          ${sendButton(item)}
          <button class="btn btn-sm ${item.status === 'queued' ? 'btn-primary' : ''}" data-item="${item.id}" data-status="${next.status}">${esc(t(next.label))}</button>
        </div>
        ${isOpen ? `<div class="queue-details">${spec(item)}${importInfo(item)}${item.sides.map((s) => printFiles(item, s)).join('')}${previewFile(item)}</div>` : ''}
        ${sendOpen.has(item.id) || (item.sends && item.sends.length) ? `<div class="queue-details">${sendHistory(item)}${sendPanel(item)}</div>` : ''}
      </div>`;
  }

  function renderQueue(q) {
    $('stats').innerHTML = ['queued', 'printing', 'printed', 'shipped']
      .map((k) => `<div class="card stat"><b>${POD.num(q.counts[k])}</b><span>${esc(t('admin.stat.' + k))}</span></div>`).join('');
    const nothing = !q.printing.length && !q.waiting.length;
    $('current').innerHTML = q.printing.length
      ? q.printing.map(card).join('')
      : `<div class="card empty"><h3>${esc(t(nothing ? 'admin.clearTitle' : 'admin.pressIdle'))}</h3><p class="muted">${esc(t(nothing ? 'admin.clearText' : 'admin.pressIdleText'))}</p></div>`;
    $('up-next').innerHTML = q.waiting.length ? q.waiting.map(row).join('') : `<p class="muted">${esc(t('admin.nothingWaiting'))}</p>`;
    $('to-ship').innerHTML = q.toShip.length ? q.toShip.map(row).join('') : `<p class="muted">${esc(t('admin.nothingToShip'))}</p>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle-item]');
    if (!b) return;
    const id = b.dataset.toggleItem;
    if (open.has(id)) open.delete(id);
    else open.add(id);
    if (lastQueue) renderQueue(lastQueue);
  });

  // ---------- Orders: shipping, delivery and payment ----------
  let notifySt = null; // which notification channels are set up
  const shipOpen = new Set(); // order ids whose shipping box is open
  const shipDraft = {}; // order id -> unsaved field values
  const shipMsg = {}; // order id -> { text, ok }
  const SHIP_FIELDS = ['courier', 'trackingNumber', 'trackingUrl', 'eta'];
  const COURIERS = () => ['Bosta', 'Aramex', t('ship.courier.egyptPost'), 'Mylerz', 'J&T Express', 'SMSA', 'DHL', t('ship.courier.own')];
  const isDelivered = (o) => o.status === 'delivered' || Boolean(o.shipment && o.shipment.deliveredAt);
  const isShipped = (o) => isDelivered(o) || o.status === 'shipped' || Boolean(o.shipment && o.shipment.shippedAt);
  const orderState = (o) => (isDelivered(o) ? 'delivered' : o.status);
  const statusPill = (s) => `<span class="pill ${s === 'delivered' ? 'delivered' : s === 'shipped' ? 'shipped' : s === 'received' ? 'queued' : 'printing'}">${esc(t('ship.status.' + s))}</span>`;
  const isPaid = (o) => Boolean(o.payment && o.payment.status === 'paid');
  const payPill = (o) => `<span class="pill ${isPaid(o) ? 'pay-paid' : 'pay-pending'}">${esc(t(isPaid(o) ? 'ship.paid' : 'ship.unpaid'))}</span>`;
  const day = (ymd) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ymd || '';
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const shipValue = (o, k) => (shipDraft[o.id] && shipDraft[o.id][k] !== undefined ? shipDraft[o.id][k] : (o.shipment && o.shipment[k]) || '');
  const TIMELINE_STEPS = ['placed', 'production', 'printed', 'shipped', 'delivered'];
  function timelineOf(o) {
    if (Array.isArray(o.timeline) && o.timeline.length) return o.timeline;
    // Older server answers without a timeline: what we know.
    const sh = o.shipment || {};
    return TIMELINE_STEPS.map((step) => ({ step, at: step === 'placed' ? o.createdAt : step === 'shipped' ? sh.shippedAt || null : step === 'delivered' ? sh.deliveredAt || null : null }));
  }
  function shipNote(o) {
    const sh = o.shipment || {};
    const bits = [];
    if (sh.courier || sh.trackingNumber) bits.push([sh.courier, sh.trackingNumber].filter(Boolean).join(' · '));
    if (isDelivered(o) && sh.deliveredAt) bits.push(t('ship.deliveredOn', { date: POD.date(sh.deliveredAt) }));
    else if (isShipped(o) && sh.eta) bits.push(t('ship.etaShort', { date: day(sh.eta) }));
    return bits.length ? `<span class="ship-note"><bdi>${esc(bits.join(' · '))}</bdi></span>` : '';
  }
  function shipBox(o) {
    const id = esc(o.id);
    const field = (k, type, extra = '') => `<div class="field"><label for="ship-${k}-${id}">${esc(t('ship.' + k))}</label><input type="${type}" id="ship-${k}-${id}" data-ship-field="${k}" data-order="${id}" value="${esc(shipValue(o, k))}" ${extra}></div>`;
    const steps = timelineOf(o).map((s) => `<li class="${s.at ? 'done' : ''}"><b>${esc(t('ship.step.' + s.step))}</b><span>${esc(s.at ? POD.date(s.at) : t('ship.notYet'))}</span></li>`).join('');
    const m = shipMsg[o.id];
    const email = o.customer && o.customer.email;
    const hint = isShipped(o) ? '' : `<p class="muted small" style="margin:0">${esc(!email ? t('ship.noEmailHint') : notifySt && !notifySt.customerEmail ? t('ship.emailOffHint', { email }) : t('ship.emailHint', { email }))}</p>`;
    return `<div class="ship-box" data-ship-box="${id}">
      <div class="ship-head">
        <h3>${esc(t('ship.title', { number: o.number }))}</h3>
        ${statusPill(orderState(o))}
        <div class="ship-links">
          <a class="btn btn-sm" href="/invoice?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${esc(t('ship.invoice'))}</a>
          <a class="btn btn-sm" href="/order?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${esc(t('ship.orderPage'))}</a>
        </div>
      </div>
      <div><div class="muted small" style="margin-bottom:6px">${esc(t('ship.timeline'))}</div><ol class="ship-steps">${steps}</ol></div>
      <div class="ship-fields">
        ${field('courier', 'text', `list="ship-couriers" maxlength="60" autocomplete="off" placeholder="${esc(t('ship.courierPh'))}"`)}
        ${field('trackingNumber', 'text', 'maxlength="80" dir="ltr" autocomplete="off"')}
        ${field('trackingUrl', 'url', 'maxlength="500" dir="ltr" placeholder="https://…"')}
        ${field('eta', 'date', 'dir="ltr"')}
      </div>
      ${hint}
      <div class="ship-actions">
        <button class="btn btn-sm" data-ship-save="${id}">${esc(t('ship.save'))}</button>
        ${isShipped(o) ? '' : `<button class="btn btn-sm btn-primary" data-ship-shipped="${id}">${esc(t('ship.markShipped'))}</button>`}
        ${isDelivered(o)
          ? `<button class="btn btn-sm" data-ship-delivered="${id}" data-value="">${esc(t('ship.undoDelivered'))}</button>`
          : `<button class="btn btn-sm ${isShipped(o) ? 'btn-primary' : ''}" data-ship-delivered="${id}" data-value="1">${esc(t('ship.markDelivered'))}</button>`}
        <span class="ship-msg ${m ? (m.ok ? 'ok' : 'bad') : ''}" aria-live="polite">${m ? esc(m.text) : ''}</span>
      </div>
      <div class="ship-pay">
        <strong>${esc(t('ship.payment'))}:</strong> <span>${esc(t('ship.cod'))}</span> ${payPill(o)}
        <button class="btn btn-sm" data-pay="${id}" data-value="${isPaid(o) ? 'pending' : 'paid'}">${esc(t(isPaid(o) ? 'ship.markUnpaid' : 'ship.markPaid'))}</button>
      </div>
    </div>`;
  }
  /** Orders table: for items in several colours/sizes, what to print (product · pieces, then colour: size×n). */
  function orderQty(o) {
    const mixed = o.items.map((it, k) => ({ it, k })).filter((x) => hasQty(x.it));
    if (!mixed.length) return '';
    return `<div class="qty-orders">${mixed.map(({ it, k }) => `<div class="qty-oi"><strong>${o.items.length > 1 ? esc(POD.num(k + 1)) + '. ' : ''}${esc(tr(it.productName))}</strong>${piecesPill(it)}${qtySummary(it)}</div>`).join('')}</div>`;
  }
  function renderOrders(orders) {
    $('ship-couriers').innerHTML = COURIERS().map((c) => `<option value="${esc(c)}"></option>`).join('');
    const col = (k) => esc(t('admin.col.' + k));
    $('orders').innerHTML = orders.length ? orders.map((o) => `
      <tr class="order-row ${shipOpen.has(o.id) ? 'open' : ''}">
        <td data-label="${col('order')}"><strong>${esc(o.number)}</strong><div class="muted small">${esc(POD.date(o.createdAt))}</div></td>
        <td data-label="${col('customer')}">${esc(o.customer.name)}<div class="muted small"><bdi dir="ltr">${esc(o.customer.phone || o.customer.email || '')}</bdi></div><div class="muted small">${esc(tr(o.customer.governorateName) || '')}</div></td>
        <td data-label="${col('items')}"><div class="mini-items">${o.items.map((i) => `<img src="${esc(i.sides[0].previewUrl)}" title="${esc(tr(i.productName))}: ${esc(t('admin.status.' + i.status))}" alt="" ${zoomAttr(i)}>`).join('')}</div>${orderQty(o)}</td>
        <td data-label="${col('total')}">${esc(money(o.total))}</td>
        <td data-label="${col('status')}"><div class="order-state">${statusPill(orderState(o))} ${payPill(o)}${shipNote(o)}</div>
          <button class="btn btn-sm ship-toggle" data-ship-toggle="${esc(o.id)}" aria-expanded="${shipOpen.has(o.id)}">${esc(t('ship.manage'))} ${shipOpen.has(o.id) ? '▴' : '▾'}</button></td>
        <td data-label="${esc(t('notify.col'))}">${notifyCell(o.notifications, o.createdAt)}</td>
      </tr>${shipOpen.has(o.id) ? `<tr class="ship-row"><td colspan="6">${shipBox(o)}</td></tr>` : ''}`).join('') : `<tr><td colspan="6" class="muted">${esc(t('admin.noOrders'))}</td></tr>`;
  }
  const orderById = (id) => lastOrders && lastOrders.find((o) => o.id === id);
  const rerenderOrders = () => lastOrders && renderOrders(lastOrders);
  $('orders').addEventListener('input', (e) => {
    const f = e.target.closest('[data-ship-field]');
    if (!f) return;
    (shipDraft[f.dataset.order] ||= {})[f.dataset.shipField] = f.value;
    const msg = f.closest('.ship-box').querySelector('.ship-msg');
    if (msg && shipMsg[f.dataset.order]) { delete shipMsg[f.dataset.order]; msg.textContent = ''; msg.className = 'ship-msg'; }
  });
  function shipFieldsOf(id) {
    const out = {};
    for (const k of SHIP_FIELDS) {
      const el = document.getElementById(`ship-${k}-${id}`);
      if (el) out[k] = el.value.trim() || null;
    }
    return out;
  }
  async function saveShipment(id, extra, doneKey, btn) {
    const o = orderById(id);
    if (!o) return;
    const body = { ...shipFieldsOf(id), ...extra };
    if (body.trackingUrl && !/^https?:\/\//i.test(body.trackingUrl)) {
      shipMsg[id] = { text: t('ship.badUrl'), ok: false };
      rerenderOrders();
      return;
    }
    if (btn) btn.disabled = true;
    const msgEl = document.querySelector(`[data-ship-box="${CSS.escape(id)}"] .ship-msg`);
    if (msgEl) { msgEl.className = 'ship-msg'; msgEl.textContent = t('ship.saving'); }
    try {
      const r = await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/shipment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.shipment !== undefined) o.shipment = r.shipment;
      if (r.status) o.status = r.status;
      if (r.timeline) o.timeline = r.timeline;
      if (body.shipped || body.delivered) o.items.forEach((i) => { i.status = 'shipped'; });
      delete shipDraft[id];
      shipMsg[id] = { text: t(doneKey), ok: true };
    } catch (err) {
      shipMsg[id] = { text: err.message, ok: false };
    }
    rerenderOrders();
  }
  $('orders').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-ship-toggle]');
    if (tog) {
      const id = tog.dataset.shipToggle;
      if (shipOpen.has(id)) shipOpen.delete(id);
      else { shipOpen.add(id); delete shipMsg[id]; }
      rerenderOrders();
      return;
    }
    const save = e.target.closest('[data-ship-save]');
    if (save) return saveShipment(save.dataset.shipSave, {}, 'ship.saved', save);
    const shipped = e.target.closest('[data-ship-shipped]');
    if (shipped) {
      const o = orderById(shipped.dataset.shipShipped);
      if (o && o.items.some((i) => i.status !== 'printed' && i.status !== 'shipped') && !confirm(t('ship.notPrinted'))) return;
      return saveShipment(shipped.dataset.shipShipped, { shipped: true }, 'ship.shippedDone', shipped);
    }
    const del = e.target.closest('[data-ship-delivered]');
    if (del) {
      const on = Boolean(del.dataset.value);
      return saveShipment(del.dataset.shipDelivered, { delivered: on }, on ? 'ship.deliveredDone' : 'ship.undeliveredDone', del);
    }
    const pay = e.target.closest('[data-pay]');
    if (pay) {
      const id = pay.dataset.pay;
      const o = orderById(id);
      pay.disabled = true;
      try {
        const r = await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/payment`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: pay.dataset.value }),
        });
        if (o) o.payment = r.payment || { ...(o.payment || {}), status: pay.dataset.value };
        shipMsg[id] = { text: t(pay.dataset.value === 'paid' ? 'ship.paidSaved' : 'ship.unpaidSaved'), ok: true };
      } catch (err) {
        shipMsg[id] = { text: err.message, ok: false };
      }
      rerenderOrders();
    }
  });
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
        <div class="lib-thumb">${d.preview ? `<img src="${esc(d.preview)}" alt="" data-zoom="${esc(JSON.stringify([d.preview]))}">` : '<span>Aa</span>'}</div>
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
      `<span class="nb ${n[k] === 'sent' ? 'ok' : 'bad'}" title="${esc(t('notify.' + k))}: ${esc(t('notify.' + n[k]))}">${icon}${n[k] === 'sent' ? '✓' : '✗'}</span>`).join('') || `<span class="muted small">${esc(t('notify.none'))}</span>`}${shippedMail(n.shipped)}</div>`;
  }
  // The "on its way" email to the customer (sent once, when the order is first marked shipped).
  const shippedMail = (r) => (r && (r.email === 'sent' || r.email === 'failed')
    ? `<span class="nb ${r.email === 'sent' ? 'ok' : 'bad'}" title="${esc(t('ship.mail'))}: ${esc(t('notify.' + r.email))}">📦${r.email === 'sent' ? '✓' : '✗'}</span>` : '');
  async function renderNotifyStatus() {
    try {
      const st = await adminApi('/api/admin/notifications');
      notifySt = st;
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
    if (tab === 'queue') {
      // Don't redraw while the admin is typing in a send form.
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.send-panel') && lastQueue) return;
      if (!housesData) housesData = await adminApi('/api/admin/houses').catch(() => null);
      renderQueue((lastQueue = await adminApi('/api/admin/queue')));
    } else if (tab === 'houses') renderHouses((housesData = await adminApi('/api/admin/houses')));
    else if (tab === 'accounts') await refreshAccounts({ auto: true });
    else if (tab === 'coupons') renderCoupons((couponData = await adminApi('/api/admin/coupons')));
    else if (tab === 'customers') await loadCustomers();
    else if (tab === 'film') renderFilm((lastFilm = (await adminApi('/api/admin/dtf-items')).items));
    else if (tab === 'library') renderLibrary((lastLibrary = await adminApi('/api/admin/library')));
    else {
      // Don't redraw while the admin is typing in a shipping box.
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.ship-box') && lastOrders) return;
      renderOrders((lastOrders = (await adminApi('/api/admin/orders')).orders));
      renderNotifyStatus();
    }
    $('login').hidden = true;
    $('dash').hidden = false;
    $('logout').hidden = false;
  }

  document.addEventListener('pod:langchange', () => {
    if (tab === 'queue' && lastQueue) renderQueue(lastQueue);
    if (tab === 'orders' && lastOrders) { renderOrders(lastOrders); renderNotifyStatus(); }
    if (tab === 'film' && lastFilm) renderFilm(lastFilm);
    if (tab === 'library' && lastLibrary) renderLibrary(lastLibrary);
    if (tab === 'houses' && housesData) renderHouses(housesData);
    if (tab === 'accounts') renderAccounts();
    if (tab === 'coupons' && couponData) renderCoupons(couponData);
    if (tab === 'customers' && customerData) renderCustomers(customerData);
  });

  // ---------- Customers: find one, help with a forgotten password ----------
  let customerData = null;
  const resetLinks = new Map(); // customer id -> { url, whatsapp }
  async function loadCustomers() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#cu-list') && customerData) return;
    renderCustomers((customerData = await adminApi('/api/admin/customers?q=' + encodeURIComponent($('cu-q').value.trim()))));
  }
  function renderCustomers(d) {
    $('cu-count').textContent = t('cu.count', { n: POD.num(d.customers.length), total: POD.num(d.total) });
    $('cu-list').innerHTML = d.customers.length ? d.customers.map((c) => {
      const link = resetLinks.get(c.id);
      const msg = link ? t('cu.waText', { name: c.name.split(' ')[0], url: link.url }) : '';
      return `
      <div class="card queue-row cu-row">
        <div>
          <strong>${esc(c.name)}</strong>
          ${c.linked.google ? '<span class="pill">Google</span>' : ''}${c.linked.facebook ? '<span class="pill">Facebook</span>' : ''}${c.hasPassword ? '' : `<span class="pill queued">${esc(t('cu.noPassword'))}</span>`}
          <div class="muted small"><bdi dir="ltr">${esc(c.phone || '—')}</bdi> · <bdi dir="ltr">${esc(c.email || '—')}</bdi> · ${esc(t('cu.since', { date: POD.date(c.createdAt) }))}</div>
          <div class="small">${esc(t('cu.orders', { n: POD.num(c.orders), total: money(c.spent) }))}${c.lastOrder ? ` · ${esc(t('cu.last', { date: POD.date(c.lastOrder) }))}` : ''}</div>
          ${link ? `<div class="cu-link small"><div class="muted">${esc(t('cu.linkReady'))}</div><input type="text" readonly dir="ltr" value="${esc(link.url)}" data-cu-copy="${esc(c.id)}">
            <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
              <button class="btn btn-sm" type="button" data-cu-copybtn="${esc(c.id)}">${esc(t('cu.copy'))}</button>
              ${link.whatsapp ? `<a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(link.whatsapp + '?text=' + encodeURIComponent(msg))}">${esc(t('cu.sendWa'))}</a>` : ''}
              ${c.email ? `<a class="btn btn-sm" href="${esc('mailto:' + c.email + '?subject=' + encodeURIComponent(t('cu.mailSubject')) + '&body=' + encodeURIComponent(msg))}">${esc(t('cu.sendMail'))}</a>` : ''}
            </div></div>` : ''}
        </div>
        <div class="queue-actions"><button class="btn btn-sm" type="button" data-cu-reset="${esc(c.id)}">${esc(t('cu.resetBtn'))}</button></div>
      </div>`;
    }).join('') : `<div class="card empty"><p>${esc(t('cu.none'))}</p></div>`;
  }
  let cuTimer = null;
  $('cu-q').addEventListener('input', () => {
    clearTimeout(cuTimer);
    cuTimer = setTimeout(() => loadCustomers().catch((e) => toast(e.message, 'error')), 250);
  });
  $('cu-list').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-cu-reset]');
    if (r) {
      r.disabled = true;
      try {
        const link = await adminApi(`/api/admin/customers/${encodeURIComponent(r.dataset.cuReset)}/reset-link`, { method: 'POST' });
        resetLinks.set(r.dataset.cuReset, link);
        renderCustomers(customerData);
      } catch (err) {
        toast(err.message, 'error');
        r.disabled = false;
      }
      return;
    }
    const cp = e.target.closest('[data-cu-copybtn]');
    if (cp) {
      const input = $('cu-list').querySelector(`[data-cu-copy="${CSS.escape(cp.dataset.cuCopybtn)}"]`);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (err) {
        input.select();
        document.execCommand('copy');
      }
      toast(t('cu.copied'));
    }
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

  // ---------- Accounts: profit, prices & costs, expenses ----------
  const acc = { view: 'overview', period: 'month', from: '', to: '', report: null, pricing: null, openOrders: new Set(), openSizes: new Set(), edits: {} };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function periodRange(p) {
    const now = new Date();
    if (p === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
    if (p === 'lastMonth') return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (p === 'year') return [ymd(new Date(now.getFullYear(), 0, 1)), ymd(now)];
    if (p === 'custom') return [acc.from, acc.to];
    return ['', ''];
  }
  const rangeQuery = () => { const [f, to] = periodRange(acc.period); return `from=${encodeURIComponent(f || '')}&to=${encodeURIComponent(to || '')}`; };
  const cls = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
  async function refreshAccounts({ auto = false } = {}) {
    // The 15-second refresh doesn't redraw while the admin is typing a price or a cost.
    const a = document.activeElement;
    if (auto && a && a.closest && a.closest('#tab-accounts') && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && (acc.report || acc.pricing)) return;
    if (acc.view === 'prices') acc.pricing = await adminApi('/api/admin/pricing');
    else {
      acc.report = await adminApi(`/api/admin/accounts?${rangeQuery()}`);
      if (!acc.pricing) acc.pricing = await adminApi('/api/admin/pricing');
    }
    renderAccounts();
  }
  function renderAccounts() {
    $('acc-overview').hidden = acc.view !== 'overview';
    $('acc-prices').hidden = acc.view !== 'prices';
    $('acc-expenses').hidden = acc.view !== 'expenses';
    document.querySelectorAll('[data-acc-view]').forEach((b) => b.classList.toggle('active', b.dataset.accView === acc.view));
    if (acc.view === 'prices') renderPrices();
    else if (acc.report) { renderOverview(); renderExpenses(); }
  }
  function renderOverview() {
    const r = acc.report;
    const tt = r.totals;
    $('acc-periods').innerHTML = ['month', 'lastMonth', 'year', 'all', 'custom']
      .map((p) => `<button class="chip ${acc.period === p ? 'active' : ''}" data-acc-period="${p}" type="button">${esc(t('acc.period.' + p))}</button>`).join('');
    $('acc-custom').hidden = acc.period !== 'custom';
    $('acc-missing').hidden = !tt.missingCosts;
    $('acc-missing').textContent = t('acc.missing', { n: POD.num(tt.missingCosts) });
    const tile = (label, value, extra, c = '') => `<div class="card stat acc-stat ${c}"><b>${esc(value)}</b><span>${esc(label)}</span>${extra ? `<small class="muted">${esc(extra)}</small>` : ''}</div>`;
    $('acc-stats').innerHTML = [
      tile(t('acc.revenue'), money(tt.revenue), t('acc.revenueSub', { orders: POD.num(tt.orders), items: POD.num(tt.items) })),
      tile(t('acc.itemCost'), money(tt.itemCost), t('acc.itemCostSub')),
      tile(t('acc.shippingCost'), money(tt.shippingCost), t('acc.shipCharged', { v: money(tt.shippingCharged) })),
      tile(t('acc.grossProfit'), money(tt.grossProfit), t('acc.margin', { v: POD.num(tt.margin) }), cls(tt.grossProfit)),
      tile(t('acc.expensesTotal'), money(tt.expenses), ''),
      tile(t('acc.netProfit'), money(tt.netProfit), '', cls(tt.netProfit)),
      tile(t('acc.collected'), money(tt.collected), t('acc.pending', { v: money(tt.pending) })),
    ].join('');
    if (acc.pricing && document.activeElement !== $('acc-ship-cost')) $('acc-ship-cost').value = acc.pricing.settings.shippingCost || 0;
    $('acc-products').innerHTML = r.products.length
      ? `<thead><tr><th>${esc(t('acc.col.product'))}</th><th>${esc(t('acc.col.units'))}</th><th>${esc(t('acc.col.sales'))}</th><th>${esc(t('acc.col.cost'))}</th><th>${esc(t('acc.col.profit'))}</th></tr></thead><tbody>${r.products.map((p) => `
        <tr><td>${esc(tr(p.productName))}</td><td>${POD.num(p.units)}</td><td>${money(p.sales)}</td><td>${money(p.cost)}</td><td class="${cls(p.profit)}">${money(p.profit)}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noOrders'))}</td></tr></tbody>`;
    $('acc-orders').innerHTML = r.orders.length
      ? `<thead><tr><th>${esc(t('admin.col.order'))}</th><th>${esc(t('acc.col.items'))}</th><th>${esc(t('acc.col.total'))}</th><th>${esc(t('acc.col.cost'))}</th><th>${esc(t('acc.col.ship'))}</th><th>${esc(t('acc.col.profit'))}</th><th></th></tr></thead><tbody>${r.orders.map(orderRow).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noOrders'))}</td></tr></tbody>`;
  }
  const SRC = { actual: 'acc.src.actual', order: 'acc.src.order', current: 'acc.src.current' };
  function orderRow(o) {
    const open = acc.openOrders.has(o.id);
    const main = `<tr class="${open ? 'is-open' : ''}">
      <td><strong>${esc(o.number)}</strong><div class="muted small">${esc(POD.date(o.createdAt))} · ${esc(t(o.status === 'shipped' ? 'acc.shipped' : 'acc.open'))}</div></td>
      <td>${o.items.map((i) => esc(tr(i.productName))).join('<br>')}</td>
      <td>${money(o.total)}<div class="muted small">${esc(t('acc.inclShip', { v: money(o.shipping) }))}</div></td>
      <td>${money(o.itemCost)}</td><td>${money(o.shippingCost)}</td>
      <td class="${cls(o.profit)}"><strong>${money(o.profit)}</strong></td>
      <td><button class="btn btn-sm" type="button" data-acc-order="${o.id}">${esc(t(open ? 'acc.close' : 'acc.editCosts'))}</button></td></tr>`;
    if (!open) return main;
    const items = o.items.map((i) => `
      <div class="acc-cost-line">
        <span>${esc(tr(i.productName))} · ${esc(tr(i.size && i.size.label))}${i.sides > 1 ? ` · ${esc(t('acc.sides', { n: POD.num(i.sides) }))}` : ''} · ${money(i.price)}</span>
        <span class="muted small">${i.costParts ? esc(t('acc.parts', { blank: money(i.costParts.blank), print: money(i.costParts.print), other: money(i.costParts.other) })) : ''} (${esc(t(SRC[i.costSource]))})</span>
        <label class="small">${esc(t('acc.realCost'))} <input type="number" min="0" step="0.01" dir="ltr" value="${i.costSource === 'actual' ? i.cost : ''}" placeholder="${i.cost}" data-acc-item-cost="${i.id}"></label>
      </div>`).join('');
    return main + `<tr class="acc-detail"><td colspan="7">
      ${items}
      <div class="acc-cost-line"><span>${esc(t('acc.col.ship'))}</span><span class="muted small">${esc(t(o.shippingCostSet ? 'acc.src.actual' : 'acc.src.default'))}</span>
        <label class="small">${esc(t('acc.realShip'))} <input type="number" min="0" step="0.01" dir="ltr" value="${o.shippingCostSet ? o.shippingCost : ''}" placeholder="${o.shippingCost}" data-acc-ship="${o.id}"></label></div>
      <p class="muted small" style="margin:6px 0 0">${esc(t('acc.realHelp'))}</p>
    </td></tr>`;
  }
  function renderExpenses() {
    const r = acc.report;
    const [f, to] = periodRange(acc.period);
    $('acc-exp-period').textContent = t('acc.expPeriod', { period: t('acc.period.' + acc.period) + (f || to ? ` (${f || '…'} → ${to || '…'})` : ''), total: money(r.totals.expenses) });
    if (!$('exp-cat').options.length) $('exp-cat').innerHTML = (r.categories || []).map((c) => `<option value="${c}">${esc(t('acc.cat.' + c))}</option>`).join('');
    else [...$('exp-cat').options].forEach((o) => { o.textContent = t('acc.cat.' + o.value); });
    if (!$('exp-date').value) $('exp-date').value = ymd(new Date());
    $('acc-exp-list').innerHTML = r.expenses.length
      ? `<thead><tr><th>${esc(t('acc.date'))}</th><th>${esc(t('acc.category'))}</th><th>${esc(t('acc.description'))}</th><th>${esc(t('acc.amount'))}</th><th></th></tr></thead><tbody>${r.expenses.map((e) => `
        <tr><td>${esc(e.date)}</td><td>${esc(t('acc.cat.' + e.category))}</td><td>${esc(e.description)}</td><td>${money(e.amount)}</td><td><button class="btn btn-sm" type="button" data-exp-del="${e.id}">${esc(t('houses.delete'))}</button></td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noExpenses'))}</td></tr></tbody>`;
  }
  function renderPrices() {
    const d = acc.pricing;
    if (!d) return;
    const field = (pid, key, value, extra = '') => `<input type="number" step="0.01" min="0" dir="ltr" value="${value}" data-price-field="${pid}" data-key="${key}" ${extra}>`;
    $('acc-price-list').innerHTML = d.categories.map((c) => {
      const prods = d.products.filter((p) => p.category === c.id);
      if (!prods.length) return '';
      return `<h3 class="house-map-cat">${esc(tr(c.name))}</h3><div class="card" style="overflow-x:auto"><table class="orders acc-table acc-prices">
        <thead><tr><th>${esc(t('acc.col.product'))}</th><th>${esc(t('acc.col.price'))}</th><th>${esc(t('acc.col.extraSide'))}</th><th>${esc(t('acc.col.blank'))}</th><th>${esc(t('acc.col.print1'))}</th><th>${esc(t('acc.col.printN'))}</th><th>${esc(t('acc.col.other'))}</th><th>${esc(t('acc.col.unitProfit'))}</th><th></th></tr></thead>
        <tbody>${prods.map((p) => priceRow(p, field)).join('')}</tbody></table></div>`;
    }).join('');
  }
  function priceRow(p, field) {
    const e = acc.edits[p.id];
    const v = (k, def) => (e && e[k] !== undefined ? e[k] : def);
    const price = Number(v('basePrice', p.basePrice)) + Number(v('size:' + p.sizes[0].id, p.sizes[0].surcharge));
    const cost = Number(v('blank', p.costs.blank)) + Number(v('sizecost:' + p.sizes[0].id, p.sizes[0].costExtra)) + Number(v('printFirst', p.costs.printFirst)) + Number(v('other', p.costs.other));
    const profit = price - cost;
    const margin = price ? Math.round((profit / price) * 1000) / 10 : 0;
    const multi = p.sideCount > 1;
    const sizesOpen = acc.openSizes.has(p.id);
    const changed = e && Object.keys(e).length;
    let html = `<tr class="${changed ? 'is-edited' : ''}">
      <td><strong>${esc(tr(p.name))}</strong>${p.costsSet ? '' : `<div class="small" style="color:var(--danger,#c0392b)">${esc(t('acc.noCosts'))}</div>`}
        ${p.sizes.length > 1 ? `<div><button class="link-btn small" type="button" data-acc-sizes="${p.id}">${esc(t(sizesOpen ? 'acc.hideSizes' : 'acc.sizes', { n: POD.num(p.sizes.length) }))}</button></div>` : ''}</td>
      <td>${field(p.id, 'basePrice', v('basePrice', p.basePrice), 'min="1"')}</td>
      <td>${multi ? field(p.id, 'extraSidePrice', v('extraSidePrice', p.extraSidePrice)) : '<span class="muted">—</span>'}</td>
      <td>${field(p.id, 'blank', v('blank', p.costs.blank))}</td>
      <td>${field(p.id, 'printFirst', v('printFirst', p.costs.printFirst))}</td>
      <td>${multi ? field(p.id, 'printExtra', v('printExtra', p.costs.printExtra)) : '<span class="muted">—</span>'}</td>
      <td>${field(p.id, 'other', v('other', p.costs.other))}</td>
      <td class="${p.costsSet || changed ? cls(profit) : ''}">${p.costsSet || changed ? `<strong>${money(profit)}</strong><div class="muted small">${esc(t('acc.marginShort', { v: POD.num(margin) }))}</div>` : '<span class="muted">—</span>'}</td>
      <td><button class="btn btn-sm ${changed ? 'btn-primary' : ''}" type="button" data-price-save="${p.id}" ${changed ? '' : 'disabled'}>${esc(t('houses.save'))}</button></td></tr>`;
    if (sizesOpen) {
      html += `<tr class="acc-detail"><td colspan="9"><div class="acc-sizes">${p.sizes.map((sz) => `
        <div class="acc-size"><strong>${esc(tr(sz.label))}</strong>
          <label class="small">${esc(t('acc.sizePrice'))} ${field(p.id, 'size:' + sz.id, v('size:' + sz.id, sz.surcharge), 'min="-100000"')}</label>
          <label class="small">${esc(t('acc.sizeCost'))} ${field(p.id, 'sizecost:' + sz.id, v('sizecost:' + sz.id, sz.costExtra))}</label>
        </div>`).join('')}</div><p class="muted small" style="margin:6px 0 0">${esc(t('acc.sizesHelp'))}</p></td></tr>`;
    }
    return html;
  }

  document.querySelectorAll('[data-acc-view]').forEach((b) => b.addEventListener('click', () => {
    acc.view = b.dataset.accView;
    renderAccounts();
    refreshAccounts().catch((e) => toast(e.message, 'error'));
  }));
  $('tab-accounts').addEventListener('click', async (e) => {
    const per = e.target.closest('[data-acc-period]');
    if (per) {
      acc.period = per.dataset.accPeriod;
      if (acc.period === 'custom' && !acc.from) { const [f, to] = periodRange('month'); acc.from = f; acc.to = to; $('acc-from').value = f; $('acc-to').value = to; }
      return refreshAccounts().catch((err) => toast(err.message, 'error'));
    }
    const ord = e.target.closest('[data-acc-order]');
    if (ord) {
      const id = ord.dataset.accOrder;
      if (acc.openOrders.has(id)) acc.openOrders.delete(id); else acc.openOrders.add(id);
      return renderOverview();
    }
    const sz = e.target.closest('[data-acc-sizes]');
    if (sz) {
      const id = sz.dataset.accSizes;
      if (acc.openSizes.has(id)) acc.openSizes.delete(id); else acc.openSizes.add(id);
      return renderPrices();
    }
    const save = e.target.closest('[data-price-save]');
    if (save) {
      const p = acc.pricing.products.find((x) => x.id === save.dataset.priceSave);
      const ed = acc.edits[p.id] || {};
      const v = (k, def) => (ed[k] !== undefined ? ed[k] : def);
      const body = {
        basePrice: v('basePrice', p.basePrice), extraSidePrice: v('extraSidePrice', p.extraSidePrice),
        sizes: Object.fromEntries(p.sizes.map((s) => [s.id, v('size:' + s.id, s.surcharge)])),
        costs: {
          blank: v('blank', p.costs.blank), printFirst: v('printFirst', p.costs.printFirst), printExtra: v('printExtra', p.costs.printExtra), other: v('other', p.costs.other),
          sizes: Object.fromEntries(p.sizes.map((s) => [s.id, v('sizecost:' + s.id, s.costExtra)])),
        },
      };
      save.disabled = true;
      try {
        const row = await adminApi(`/api/admin/pricing/${encodeURIComponent(p.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify(body) });
        Object.assign(p, row);
        delete acc.edits[p.id];
        toast(t('acc.savedPrice', { name: tr(p.name) }));
      } catch (err) {
        toast(err.message, 'error');
      }
      return renderPrices();
    }
    const del = e.target.closest('[data-exp-del]');
    if (del && confirm(t('acc.confirmDelete'))) {
      try {
        await adminApi(`/api/admin/expenses/${encodeURIComponent(del.dataset.expDel)}`, { method: 'DELETE' });
        await refreshAccounts();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  $('tab-accounts').addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.priceField) return;
    const pid = el.dataset.priceField;
    (acc.edits[pid] ||= {})[el.dataset.key] = el.value === '' ? 0 : Number(el.value);
    // Update just the profit cell and the save button, without losing the cursor.
    const p = acc.pricing.products.find((x) => x.id === pid);
    const tr0 = el.closest('tr').classList.contains('acc-detail') ? el.closest('tr').previousElementSibling : el.closest('tr');
    const tmp = document.createElement('tbody');
    tmp.innerHTML = priceRow(p, (a, b, c, d = '') => `<input value="${c}" ${d}>`);
    tr0.cells[7].innerHTML = tmp.rows[0].cells[7].innerHTML;
    tr0.cells[7].className = tmp.rows[0].cells[7].className;
    const btn = tr0.querySelector('[data-price-save]');
    btn.disabled = false;
    btn.classList.add('btn-primary');
    tr0.classList.add('is-edited');
  });
  $('tab-accounts').addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'acc-from' || el.id === 'acc-to') {
      acc.from = $('acc-from').value;
      acc.to = $('acc-to').value;
      return refreshAccounts().catch((err) => toast(err.message, 'error'));
    }
    const itemId = el.dataset.accItemCost;
    const orderId = el.dataset.accShip;
    if (!itemId && !orderId) return;
    try {
      if (itemId) await adminApi(`/api/admin/items/${encodeURIComponent(itemId)}/cost`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ actualCost: el.value === '' ? null : Number(el.value) }) });
      else await adminApi(`/api/admin/orders/${encodeURIComponent(orderId)}/shipping-cost`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ actualShipping: el.value === '' ? null : Number(el.value) }) });
      el.blur();
      toast(t('houses.saved'));
      await refreshAccounts();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('acc-ship-save').addEventListener('click', async () => {
    try {
      const st = await adminApi('/api/admin/accounts/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ shippingCost: Number($('acc-ship-cost').value || 0) }) });
      if (acc.pricing) acc.pricing.settings = st;
      toast(t('houses.saved'));
      await refreshAccounts();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('acc-csv').addEventListener('click', () => {
    const b = document.createElement('button');
    b.dataset.download = `/api/admin/accounts.csv?${rangeQuery()}`;
    b.hidden = true;
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  $('acc-exp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await adminApi('/api/admin/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ date: $('exp-date').value, category: $('exp-cat').value, description: $('exp-desc').value, amount: Number($('exp-amount').value) }) });
      $('exp-desc').value = '';
      $('exp-amount').value = '';
      $('exp-msg').textContent = t('houses.saved');
      setTimeout(() => { $('exp-msg').textContent = ''; }, 2500);
      await refreshAccounts();
    } catch (err) {
      $('exp-msg').textContent = err.message;
    }
  });

  // ---------- Coupons ----------
  let couponData = null;
  const cpPicked = new Set();
  function couponSummary(c) {
    const parts = [c.type === 'percent' ? t('cp.sumPercent', { v: POD.num(c.value) }) : c.type === 'fixed' ? t('cp.sumFixed', { v: money(c.value) }) : t('cp.freeship')];
    if (c.maxDiscount) parts.push(t('cp.sumMax', { v: money(c.maxDiscount) }));
    if (c.minOrder) parts.push(t('cp.sumMin', { v: money(c.minOrder) }));
    if (c.startsOn || c.endsOn) parts.push(`${c.startsOn || '…'} → ${c.endsOn || '…'}`);
    if (c.perCustomer) parts.push(t('cp.sumPer', { n: POD.num(c.perCustomer) }));
    if (c.categories.length) parts.push(c.categories.map((id) => tr((couponData.categories.find((x) => x.id === id) || {}).name || id)).join('، '));
    return parts.join(' · ');
  }
  function renderCoupons(d) {
    if (!$('cp-cats').dataset.ready || $('cp-cats').dataset.lang !== POD.lang) {
      $('cp-cats').innerHTML = d.categories.map((c) => `<label class="check-chip"><input type="checkbox" value="${esc(c.id)}" data-cp-cat ${cpPicked.has(c.id) ? 'checked' : ''}> ${esc(tr(c.name))}</label>`).join('');
      $('cp-cats').dataset.ready = '1';
      $('cp-cats').dataset.lang = POD.lang;
    }
    const today = ymd(new Date());
    $('cp-list').innerHTML = d.coupons.length ? d.coupons.slice().reverse().map((c) => {
      const expired = c.endsOn && c.endsOn < today;
      const usedUp = c.maxUses && c.uses >= c.maxUses;
      const state = !c.active ? 'paused' : expired ? 'expired' : usedUp ? 'usedUp' : 'live';
      return `<div class="card house-row">
        <div>
          <strong dir="ltr" style="font-size:16px">${esc(c.code)}</strong> <span class="pill ${state === 'live' ? 'printed' : 'queued'}">${esc(t('cp.state.' + state))}</span>
          <div class="muted small">${esc(couponSummary(c))}</div>
          <div class="small">${esc(t('cp.usage', { n: POD.num(c.uses), max: c.maxUses ? POD.num(c.maxUses) : '∞', v: money(c.discountGiven) }))}</div>
          ${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}
        </div>
        <div class="row" style="gap:8px;flex:0 0 auto">
          <button class="btn btn-sm" type="button" data-cp-toggle="${esc(c.id)}">${esc(t(c.active ? 'cp.pause' : 'cp.resume'))}</button>
          <button class="btn btn-sm" type="button" data-cp-edit="${esc(c.id)}">${esc(t('houses.edit'))}</button>
          <button class="btn btn-sm" type="button" data-cp-del="${esc(c.id)}">${esc(t('houses.delete'))}</button>
        </div>
      </div>`;
    }).join('') : `<p class="muted">${esc(t('cp.empty'))}</p>`;
    cpTypeChanged();
  }
  function cpTypeChanged() {
    const type = $('cp-type').value;
    $('cp-value-f').hidden = type === 'freeship';
    $('cp-max-f').hidden = type !== 'percent';
    const lab = $('cp-value-f').querySelector('label');
    lab.textContent = t(type === 'percent' ? 'cp.valuePercent' : 'cp.valueFixed');
  }
  $('cp-type').addEventListener('change', cpTypeChanged);
  function resetCouponForm() {
    $('cp-form').reset();
    $('cp-id').value = '';
    $('cp-active').checked = true;
    cpPicked.clear();
    $('cp-cats').querySelectorAll('input').forEach((i) => { i.checked = false; });
    $('cp-cancel').hidden = true;
    $('cp-form-title').textContent = t('cp.addTitle');
    cpTypeChanged();
  }
  $('cp-cancel').addEventListener('click', resetCouponForm);
  $('cp-cats').addEventListener('change', (e) => { if (e.target.dataset.cpCat !== undefined) { if (e.target.checked) cpPicked.add(e.target.value); else cpPicked.delete(e.target.value); } });
  $('cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('cp-id').value;
    const body = {
      code: $('cp-code').value, type: $('cp-type').value, value: $('cp-value').value, maxDiscount: $('cp-max').value, minOrder: $('cp-min').value,
      maxUses: $('cp-uses').value, perCustomer: $('cp-per').value, startsOn: $('cp-start').value, endsOn: $('cp-end').value,
      categories: [...cpPicked], active: $('cp-active').checked, note: $('cp-note').value,
    };
    try {
      await adminApi(id ? `/api/admin/coupons/${encodeURIComponent(id)}` : '/api/admin/coupons', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify(body) });
      resetCouponForm();
      $('cp-msg').textContent = t('houses.saved');
      setTimeout(() => { $('cp-msg').textContent = ''; }, 2500);
      renderCoupons((couponData = await adminApi('/api/admin/coupons')));
    } catch (err) {
      $('cp-msg').textContent = err.message;
    }
  });
  $('cp-list').addEventListener('click', async (e) => {
    const find = (id) => couponData.coupons.find((c) => c.id === id);
    const ed = e.target.closest('[data-cp-edit]');
    const del = e.target.closest('[data-cp-del]');
    const tog = e.target.closest('[data-cp-toggle]');
    try {
      if (ed) {
        const c = find(ed.dataset.cpEdit);
        $('cp-id').value = c.id;
        $('cp-code').value = c.code;
        $('cp-type').value = c.type;
        $('cp-value').value = c.type === 'freeship' ? '' : c.value;
        $('cp-max').value = c.maxDiscount || '';
        $('cp-min').value = c.minOrder || '';
        $('cp-uses').value = c.maxUses || '';
        $('cp-per').value = c.perCustomer || '';
        $('cp-start').value = c.startsOn || '';
        $('cp-end').value = c.endsOn || '';
        $('cp-note').value = c.note || '';
        $('cp-active').checked = c.active;
        cpPicked.clear();
        c.categories.forEach((x) => cpPicked.add(x));
        $('cp-cats').querySelectorAll('input').forEach((i) => { i.checked = cpPicked.has(i.value); });
        $('cp-cancel').hidden = false;
        $('cp-form-title').textContent = t('cp.editTitle');
        cpTypeChanged();
        $('cp-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (tog) {
        const c = find(tog.dataset.cpToggle);
        await adminApi(`/api/admin/coupons/${encodeURIComponent(c.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ ...c, active: !c.active }) });
        renderCoupons((couponData = await adminApi('/api/admin/coupons')));
      } else if (del && confirm(t('cp.confirmDelete', { code: find(del.dataset.cpDel).code }))) {
        await adminApi(`/api/admin/coupons/${encodeURIComponent(del.dataset.cpDel)}`, { method: 'DELETE' });
        renderCoupons((couponData = await adminApi('/api/admin/coupons')));
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ---------- Large preview on hover ----------
  const zoom = document.createElement('div');
  zoom.className = 'zoom-pop';
  zoom.hidden = true;
  document.body.appendChild(zoom);
  let zoomFor = null;
  function placeZoom(x, y) {
    const r = zoom.getBoundingClientRect();
    const pad = 16;
    let left = x + 24;
    if (left + r.width > innerWidth - pad) left = x - 24 - r.width;
    left = Math.max(pad, left);
    const top = Math.min(Math.max(pad, y - r.height / 2), innerHeight - r.height - pad);
    zoom.style.left = `${left}px`;
    zoom.style.top = `${Math.max(pad, top)}px`;
  }
  document.addEventListener('mouseover', (e) => {
    const img = e.target.closest && e.target.closest('[data-zoom]');
    if (img === zoomFor) return;
    zoomFor = img;
    if (!img || !matchMedia('(hover: hover)').matches) { zoom.hidden = true; return; }
    let urls = [];
    try { urls = JSON.parse(img.dataset.zoom); } catch (err) { urls = [img.src]; }
    zoom.classList.toggle('two', urls.length > 1);
    zoom.innerHTML = urls.map((u) => `<img src="${esc(u)}" alt="">`).join('');
    zoom.hidden = false;
    placeZoom(e.clientX, e.clientY);
    zoom.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => zoomFor === img && placeZoom(e.clientX, e.clientY), { once: true }));
  });
  document.addEventListener('mousemove', (e) => { if (!zoom.hidden && zoomFor) placeZoom(e.clientX, e.clientY); });
  document.addEventListener('scroll', () => { zoom.hidden = true; zoomFor = null; }, { passive: true, capture: true });

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
    const rbtn = e.target.closest('[data-redraw]');
    if (rbtn) {
      rbtn.disabled = true;
      try {
        await adminApi('/api/admin/items/' + encodeURIComponent(rbtn.dataset.redraw) + '/redraw', { method: 'POST' });
        toast(t('admin.redraw.started'));
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
        rbtn.disabled = false;
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
