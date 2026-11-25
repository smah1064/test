/*
 * Admin → Products: the product manager's screen (the owner sees it too).
 * List with search and filters, quick pause / stop selling / show again, the edit page (basics, availability,
 * colours, sizes, prices, print setup with a visual print-area editor, technology and
 * embroidery, photos), new products made from an existing one, the change log, and the
 * owner's staff accounts. Server contract: /api/admin/catalog* and /api/admin/staff*.
 *
 * admin.js calls AdminProducts.init({ api, role, can, legacyOwner }) once, then show() when the tab opens.
 * can(perm): catalog.edit changes products (without it the screen is for looking), prices.edit the selling prices.
 * A staff member's change answers "sent for an owner's approval" (adminApi throws an error marked `pending`):
 * the form stays as typed, nothing is taken for the saved product.
 */
(function () {
  'use strict';

  const { esc, t, tr, toast } = POD;
  const enc = encodeURIComponent;
  const W = 500; // the product drawing (mockup units)
  const H = 600;
  const MIN = 10;
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const SECTIONS = ['basics', 'avail', 'colors', 'sizes', 'prices', 'print', 'tech', 'photos', 'danger'];

  let ctx = null;
  let root = null;
  const S = {
    data: null, // GET /api/admin/catalog
    loadedAt: 0,
    loading: null,
    view: 'list',
    P: null, // the product open in the edit page
    q: '',
    filter: 'all',
    cat: '',
    staffOpen: false,
    staff: null,
    newStaff: null, // { username, password } just made: shown once
    dirty: new Set(),
    colors: null, // colours being edited [{ id, name, hex, added, state }]
    sizes: null, // sizes being edited [{ id, label, labelEn, labelAr, added, state, surcharge, printScale }]
    sides: null, // print setup being edited { [sideId]: { x, y, w, h, widthCm, safeMm, bleedMm, off } }
    resets: new Set(), // fields to send back to the original on save ('description', 'category')
    lock: {},
    previewHex: null,
    busy: false,
  };
  const pics = { designed: {}, lifestyle: {} };
  let picsLoaded = null;

  // ---------- Small helpers ----------
  const api = (url, o) => ctx.api(url, o);
  const send = (method, url, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const owner = () => ctx && ctx.role() === 'owner';
  /** A permission of the person signed in (public/js/admin-roles.js); without can(): the owner's prices, as before. */
  const can = (perm) => Boolean(ctx && (ctx.can ? ctx.can(perm) : perm !== 'prices.edit' || owner()));
  /** Products can be changed (catalog.edit); without it the screen is for looking only. */
  const editing = () => can('catalog.edit');
  /** The old staff accounts here: only for an owner signed in before roles (the Staff & roles tab does it now). */
  const legacyStaff = () => Boolean(ctx && ctx.legacyOwner && ctx.legacyOwner());
  /** A change sent for an owner's approval (not saved yet, not a failure: the toast said so). */
  const sentForApproval = (e) => Boolean(window.AdminRoles && AdminRoles.isPendingError(e));
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** Numbers in inputs and production sizes: Western digits with a dot, like the rest of production. */
  const fx = (v) => String(r2(Number(v) || 0));
  const isRtl = () => document.documentElement.dir === 'rtl';
  const back = () => (isRtl() ? '→' : '←');
  const fwd = () => (isRtl() ? '←' : '→');
  const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  // A deleted added product stays in the server's list until it restarts (old orders), with no edit: leave it out.
  const products = () => (S.data ? S.data.products.filter((p) => p.builtIn || p.edit) : []);
  const catName = (id) => tr(((S.data && S.data.categories.find((c) => c.id === id)) || {}).name || id);
  const firstHex = (p) => (p.colors.find((c) => !c.off) || p.colors[0] || { hex: '#ffffff' }).hex;
  const pill = (cls, text, title) => `<span class="pm-pill ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  const when = (iso) => (iso ? new Date(iso).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const canEdit = (p) => p.kind !== 'book';

  function loadPics() {
    if (!picsLoaded) {
      const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      picsLoaded = Promise.all([get('/img/designed/index.json'), get('/img/lifestyle/index.json')]).then(([d, l]) => {
        pics.designed = d || {};
        pics.lifestyle = l || {};
      });
    }
    return picsLoaded;
  }
  /** The product's picture: its main photo, else the shop's photo of it, else its drawing. */
  function picOf(p) {
    if (p.mainPhoto) return p.mainPhoto;
    const k = p.base || p.id;
    const d = pics.designed[k] || pics.lifestyle[k];
    if (d && d.file) return d.file;
    const sd = p.sides.find((s) => !s.off) || p.sides[0];
    return sd && sd.svg ? POD.mockupUrl(sd, firstHex(p), 'full') : '';
  }

  // ---------- Status ----------
  // status 'hidden' = Paused (for a while, maybe until a day), 'removed' = Stopped selling (Archived).
  const NEW_NOTE = 'New product: check it, then show it in the shop';
  const isNew = (p) => p.status === 'hidden' && !p.builtIn && p.hiddenNote === NEW_NOTE;
  /** Paused now: its "show it again on" day (if any) hasn't come yet. */
  const isPaused = (p) => p.status === 'hidden' && !p.pausedUntilPassed;
  const isArchived = (p) => p.status === 'removed';
  /** Set to be in the shop: live, or back from a pause on its day. */
  const isOn = (p) => !isPaused(p) && !isArchived(p);
  /** Stock is counted (the product leaves the shop by itself at 0). */
  const countsStock = (p) => (p.stock !== null && p.stock !== undefined) || Boolean(p.variantStock);
  const cairoToday = () => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
  };
  /** Today in the shop's time zone (the server says which day it is there). */
  const shopToday = () => (S.data && S.data.today) || cairoToday();
  /** A day ('2027-03-01') in words in the page's language and digits ("1 March", "١ مارس"). */
  function dayText(d, { weekday = false } = {}) {
    if (!d) return '';
    try {
      return new Date(`${d}T12:00:00Z`).toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', {
        ...(weekday ? { weekday: 'long' } : {}), day: 'numeric', month: 'long', ...(d.slice(0, 4) === shopToday().slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC',
      });
    } catch (e) {
      return d;
    }
  }
  // Arabic: "·" next to Arabic digits reads as the zero "٠": the Arabic comma there (POD.sep).
  const SEP = () => (POD.sep ? POD.sep() : ' · ');
  const pausedText = (p) => [t('pm.st.paused'), p.hiddenReason ? t('pm.reason.' + p.hiddenReason) : ''].filter(Boolean).join(' · ');
  function whyHidden(p) {
    if (isArchived(p)) return t('pm.st.retired');
    if (isNew(p)) return t('pm.st.new');
    if (isPaused(p)) return pausedText(p) + (p.showAgainOn ? `${SEP()}${t('pm.st.backOn', { date: dayText(p.showAgainOn) })}` : '');
    if (p.stock !== null && p.stock <= 0) return t('pm.st.noStock');
    const vs = stockInfo(p);
    if (vs && vs.kind === 'variant' && vs.counted && vs.left === 0) return t('pm.st.noStock');
    if (!p.colors.some((c) => !c.off && !c.soldOut)) return t('pm.st.noColor');
    if (!p.sizes.some((z) => !z.off && !z.soldOut)) return t('pm.st.noSize');
    return t('pm.st.notShown');
  }
  function statusPill(p) {
    if (!canEdit(p)) return pill('pm-pill-muted', t('pm.st.ownPage'));
    // Back from a pause on its day: in the shop, with a small "back since".
    if (p.visible) return pill('pm-pill-live', t('pm.st.live')) + (p.pausedUntilPassed ? pill('pm-pill-muted', t('pm.st.backSince', { date: dayText(p.showAgainOn) })) : '');
    if (isArchived(p)) return pill('pm-pill-removed', t('pm.st.retired'), p.hiddenNote || '');
    if (isPaused(p) && !isNew(p)) return pill('pm-pill-hidden', pausedText(p), p.hiddenNote || '') + (p.showAgainOn ? pill('pm-pill-back', t('pm.st.backOn', { date: dayText(p.showAgainOn) })) : '');
    return pill('pm-pill-hidden', whyHidden(p), p.hiddenNote || '');
  }
  /** The quick status buttons: Pause / Show in the shop, Stop selling, or Sell again. */
  function statusActs(p, cls = 'btn btn-sm') {
    const id = esc(p.id);
    if (isArchived(p)) return `<button class="${cls} pm-btn-ok" type="button" data-pm-act="sell-again" data-id="${id}">${esc(t('pm.sellAgain'))}</button>`;
    return (isPaused(p)
      ? `<button class="${cls} pm-btn-ok" type="button" data-pm-act="show" data-id="${id}">${esc(t('pm.show'))}</button>`
      : `<button class="${cls}" type="button" data-pm-act="pause" data-id="${id}">${esc(t('pm.pause'))}</button>`)
      + `<button class="${cls} pm-btn-stop" type="button" data-pm-act="stop" data-id="${id}">${esc(t('pm.stopSelling'))}</button>`;
  }
  /**
   * What the product's stock says: null when not counted; { kind: 'whole', total } for one count;
   * { kind: 'variant', total, counted, left, out: [combos at 0], low: [combos running low] } per colour and size
   * (only colours and sizes that are on; a combination left empty isn't counted).
   */
  function stockInfo(p) {
    if (p.variantStock && typeof p.variantStock === 'object') {
      const r = { kind: 'variant', total: 0, counted: 0, left: 0, out: [], low: [] };
      for (const c of p.colors.filter((x) => !x.off)) {
        for (const z of p.sizes.filter((x) => !x.off)) {
          const v = p.variantStock[`${c.id}|${z.id}`];
          if (typeof v !== 'number') continue;
          r.counted += 1;
          r.total += Math.max(0, v);
          const name = `${tr(c.name)}${SEP()}${tr(z.label)}`;
          if (v <= 0) r.out.push(name);
          else {
            r.left += 1;
            if (v <= p.lowStockAt) r.low.push(name);
          }
        }
      }
      return r;
    }
    if (p.stock !== null && p.stock !== undefined) return { kind: 'whole', total: p.stock };
    return null;
  }
  function stockPill(p) {
    const s = stockInfo(p);
    if (!s) return '';
    if (s.kind === 'variant') {
      if (!s.counted) return '';
      const sep = POD.lang === 'ar' ? '، ' : ', ';
      if (!s.left) return pill('pm-pill-bad', t('pm.stock.out'), s.out.join(sep));
      return pill('pm-pill-muted', t('pm.stock.vn', { n: POD.num(s.total) }))
        + (s.out.length ? pill('pm-pill-bad', t('pm.stock.someOut', { n: POD.num(s.out.length) }), s.out.join(sep)) : '')
        + (s.low.length ? pill('pm-pill-warn', t('pm.stock.someLow', { n: POD.num(s.low.length) }), s.low.join(sep)) : '');
    }
    if (p.stock <= 0) return pill('pm-pill-bad', t('pm.stock.out'));
    if (p.stock <= p.lowStockAt) return pill('pm-pill-warn', t('pm.stock.low', { n: POD.num(p.stock) }));
    return pill('pm-pill-muted', t('pm.stock.n', { n: POD.num(p.stock) }));
  }
  const noteOf = (p) => (p.hiddenNote && (isPaused(p) || isArchived(p)) ? (p.hiddenNote === NEW_NOTE ? t('pm.newNote') : p.hiddenNote) : '');
  /** Who made a change: "owner" in the shop's own words, a staff member's name as given. */
  const whoName = (w) => (w === 'owner' ? t('pm.who.owner') : w || '—');
  const lastChange = (p) => (p.updatedAt ? t('pm.lastChange', { who: '\u2068' + whoName(p.updatedBy || (p.edit && p.edit.updatedBy)) + '\u2069', when: when(p.updatedAt) }) : '');
  const priceFrom = (p) => {
    const on = p.sizes.filter((z) => !z.off);
    const min = Math.min(...(on.length ? on : p.sizes).map((z) => Number(z.surcharge) || 0));
    return POD.money((Number(p.basePrice) || 0) + (Number.isFinite(min) ? min : 0));
  };

  // ---------- Loading ----------
  async function load(force) {
    if (S.loading) return S.loading;
    if (S.data && !force) return S.data;
    S.loading = (async () => {
      try {
        await loadPics();
        S.data = await api('/api/admin/catalog');
        S.loadedAt = Date.now();
        return S.data;
      } finally {
        S.loading = null;
      }
    })();
    return S.loading;
  }
  function putProduct(P) {
    if (!S.data) return;
    const i = S.data.products.findIndex((p) => p.id === P.id);
    if (i >= 0) S.data.products[i] = P;
    else S.data.products.push(P);
  }
  /** The log changed on the server: read it again quietly (the list and the edit page show it). */
  function reloadLater() {
    clearTimeout(reloadLater.timer);
    reloadLater.timer = setTimeout(async () => {
      try {
        const d = await api('/api/admin/catalog');
        S.data = d;
        S.loadedAt = Date.now();
        if (S.view === 'list') renderRows(), renderLog();
        else if (S.P) { const l = document.getElementById('pm-plog'); if (l) l.innerHTML = logHtml(S.P.id); }
      } catch (e) { /* keep what we have */ }
    }, 400);
  }

  // =====================================================================
  // List
  // =====================================================================
  // Archived products (stopped selling) show under their own filter only.
  const FILTERS = {
    all: (p) => !isArchived(p),
    live: (p) => p.visible,
    paused: isPaused,
    stock: (p) => {
      const s = !isArchived(p) && stockInfo(p);
      if (!s) return false;
      return s.kind === 'variant' ? Boolean(s.out.length || s.low.length) : s.total <= p.lowStockAt;
    },
    added: (p) => !p.builtIn && !isArchived(p),
    archived: isArchived,
  };
  function matches(p) {
    if (S.cat && p.category !== S.cat) return false;
    const q = norm(S.q.trim());
    if (q && ![p.id, p.name.en, p.name.ar, p.base].some((v) => norm(v).includes(q))) return false;
    return true;
  }

  function renderList() {
    S.view = 'list';
    if (!S.data) {
      root.innerHTML = `<div class="card pm-loading">${esc(t('pm.loading'))}</div>`;
      return;
    }
    root.innerHTML = `
      <div class="card pm-top">
        <div class="pm-top-row">
          <div class="pm-top-text">
            <p class="muted small">${esc(t('pm.help'))}</p>
          </div>
          <div class="pm-top-btns">
            ${legacyStaff() ? `<button class="btn" type="button" data-pm-act="staff" aria-expanded="${S.staffOpen}">${esc(t('pm.staff.btn'))}</button>` : ''}
            ${editing() ? `<button class="btn btn-primary" type="button" data-pm-act="new">+ ${esc(t('pm.new'))}</button>` : ''}
          </div>
        </div>
        <div class="pm-tools">
          <input type="search" id="pm-q" autocomplete="off" maxlength="60" placeholder="${esc(t('pm.search'))}" aria-label="${esc(t('pm.search'))}" value="${esc(S.q)}">
          <select id="pm-cat" aria-label="${esc(t('pm.category'))}">
            <option value="">${esc(t('pm.allCats'))}</option>
            ${S.data.categories.map((c) => `<option value="${esc(c.id)}" ${S.cat === c.id ? 'selected' : ''}>${esc(tr(c.name))}</option>`).join('')}
          </select>
        </div>
        <div class="chips pm-chips" id="pm-chips" role="group" aria-label="${esc(t('pm.filter'))}"></div>
      </div>
      <div id="pm-staff" ${S.staffOpen && legacyStaff() ? '' : 'hidden'}></div>
      <p class="muted small pm-count" id="pm-count" aria-live="polite"></p>
      <div class="pm-list" id="pm-rows"></div>
      <details class="card pm-log" id="pm-log-box">
        <summary>${esc(t('pm.log.title'))}</summary>
        <div id="pm-log"></div>
      </details>`;
    renderRows();
    renderLog();
    if (S.staffOpen && legacyStaff()) renderStaff();
  }

  function renderRows() {
    const box = document.getElementById('pm-rows');
    if (!box) return;
    const inScope = products().filter(matches);
    document.getElementById('pm-chips').innerHTML = Object.keys(FILTERS).map((f) => {
      const n = inScope.filter(FILTERS[f]).length;
      return `<button type="button" class="chip ${S.filter === f ? 'active' : ''}" data-pm-filter="${f}" aria-pressed="${S.filter === f}">${esc(t('pm.f.' + f))} <span class="pm-chip-n">${esc(POD.num(n))}</span></button>`;
    }).join('');
    if (!FILTERS[S.filter]) S.filter = 'all';
    const list = inScope.filter(FILTERS[S.filter]);
    const arch = S.filter === 'archived';
    document.getElementById('pm-count').textContent = arch ? t('pm.countArchived', { n: POD.num(list.length) }) : t('pm.count', { n: POD.num(list.length), total: POD.num(products().filter(FILTERS.all).length) });
    box.innerHTML = list.length ? list.map(rowHtml).join('') : `<div class="card pm-empty">${esc(t(arch && !S.q.trim() && !S.cat ? 'pm.noneArchived' : 'pm.none'))}</div>`;
  }

  function rowHtml(p) {
    const note = noteOf(p);
    const edit = canEdit(p);
    return `
      <article class="card pm-row ${p.visible ? '' : 'is-off'}" data-id="${esc(p.id)}">
        <button type="button" class="pm-thumb" ${edit ? `data-pm-act="edit" data-id="${esc(p.id)}"` : 'disabled'} aria-label="${esc(t('pm.edit'))}: ${esc(tr(p.name))}">
          <img src="${esc(picOf(p))}" alt="" loading="lazy">
        </button>
        <div class="pm-row-main">
          <div class="pm-row-title"><strong>${esc(tr(p.name))}</strong> <bdi class="pm-id" dir="ltr">${esc(p.id)}</bdi></div>
          <div class="muted small">${esc(catName(p.category))}${esc(SEP())}${esc(t('pm.priceFrom', { price: priceFrom(p) }))}${p.builtIn ? '' : `${esc(SEP())}${esc(t('pm.addedFrom', { name: tr((products().find((x) => x.id === p.base) || {}).name) || p.base }))}`}</div>
          <div class="pm-pills">${statusPill(p)}${stockPill(p)}${p.builtIn ? '' : pill('pm-pill-added', t('pm.added'))}${p.edit && p.builtIn ? pill('pm-pill-muted', t('pm.edited')) : ''}</div>
          ${note ? `<div class="small pm-note">${esc(note)}</div>` : ''}
          ${p.updatedAt ? `<div class="muted small">${esc(lastChange(p))}</div>` : ''}
        </div>
        <div class="pm-row-acts">
          ${!edit ? `<span class="muted small">${esc(t('pm.bookNote'))}</span>` : !editing() ? `
          <button class="btn btn-sm btn-dark" type="button" data-pm-act="edit" data-id="${esc(p.id)}">${esc(t('role.view'))}</button>` : `
          ${statusActs(p)}
          <button class="btn btn-sm btn-dark" type="button" data-pm-act="edit" data-id="${esc(p.id)}">${esc(t('pm.edit'))}</button>
          ${p.kind ? '' : `<button class="btn btn-sm" type="button" data-pm-act="copy" data-id="${esc(p.id)}">${esc(t('pm.copy'))}</button>`}`}
        </div>
      </article>`;
  }

  // ---------- Change log ----------
  const LOG_WORDS = ['name', 'description', 'category', 'status', 'showAgainOn', 'stock', 'variantStock', 'lowStockAt', 'colors', 'addColors', 'sizes', 'addSizes', 'sides', 'process', 'methods', 'embroidery', 'prices'];
  // A new status is logged as what happened.
  const LOG_STATUS = { paused: 'pm.log.paused', 'stopped selling': 'pm.log.stopped', 'in the shop': 'pm.log.inShop' };
  function logWhat(what) {
    const s = String(what || '');
    let m = /^new product from (.+)$/.exec(s);
    if (m) return t('pm.log.newFrom', { name: tr((products().find((x) => x.id === m[1]) || {}).name) || m[1] });
    const fixed = { 'photo added': 'pm.log.photoAdded', 'photo removed': 'pm.log.photoRemoved', 'photos arranged': 'pm.log.photosArranged', deleted: 'pm.log.deleted', 'reset to the original': 'pm.log.reset' };
    if (fixed[s]) return t(fixed[s]);
    const parts = s.split(/,\s*/).filter(Boolean);
    if (parts.length && parts.every((x) => LOG_WORDS.includes(x) || LOG_STATUS[x])) {
      const said = parts.filter((x) => LOG_STATUS[x]).map((x) => t(LOG_STATUS[x]));
      const rest = parts.filter((x) => !LOG_STATUS[x]);
      if (rest.length) said.push(t('pm.log.changed', { what: rest.map((x) => t('pm.w.' + x)).join(POD.lang === 'ar' ? '، ' : ', ') }));
      return said.join(' · ');
    }
    return s;
  }
  function logHtml(onlyId) {
    const rows = ((S.data && S.data.log) || []).filter((l) => !onlyId || l.productId === onlyId);
    if (!rows.length) return `<p class="muted small">${esc(t('pm.log.none'))}</p>`;
    return `<ul class="pm-log-list">${rows.map((l) => {
      const p = products().find((x) => x.id === l.productId);
      return `<li><span class="pm-log-when">${esc(when(l.at))}</span>
        <span><b dir="auto">${esc(whoName(l.who))}</b>${l.approvedBy ? ` <span class="muted">(${esc(t('act.approvedBy', { name: `\u2068${whoName(l.approvedBy)}\u2069` }))})</span>` : ''} · ${onlyId ? '' : `${p && canEdit(p) ? `<button type="button" class="link-btn" data-pm-act="edit" data-id="${esc(l.productId)}">${esc(tr(p.name))}</button>` : `<bdi dir="ltr">${esc(l.productId)}</bdi>`} · `}${esc(logWhat(l.what))}</span></li>`;
    }).join('')}</ul>`;
  }
  function renderLog() {
    const el = document.getElementById('pm-log');
    if (el) el.innerHTML = logHtml();
  }

  // =====================================================================
  // Dialogs (pause, stop selling, new product, staff password)
  // =====================================================================
  function dialog(html, onSubmit, { wide = false, danger = false } = {}) {
    const d = document.createElement('dialog');
    d.className = 'pm-dlg' + (wide ? ' pm-dlg-wide' : '');
    d.innerHTML = `<form method="dialog" class="pm-dlg-form" novalidate>${html}
      <p class="pm-err" role="alert" hidden></p>
      <div class="pm-dlg-btns"><button class="btn" type="button" data-dlg-cancel>${esc(t('pm.cancel'))}</button><button class="btn ${danger ? 'pm-btn-danger' : 'btn-primary'}" type="submit" data-dlg-ok></button></div></form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    const err = d.querySelector('.pm-err');
    d.querySelector('[data-dlg-cancel]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = d.querySelector('[data-dlg-ok]');
      ok.disabled = true;
      err.hidden = true;
      try {
        if ((await onSubmit(form, d)) !== false) d.close();
      } catch (ex) {
        // Sent for an owner's approval: done here (the toast said so; nothing changes until it is approved).
        if (sentForApproval(ex)) return void d.close();
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        ok.disabled = false;
      }
    });
    d.showModal();
    return d;
  }

  /** Save a new status (and its pause details) from a dialog or a button. */
  async function saveStatus(p, body) {
    let P;
    try {
      P = await send('PUT', `/api/admin/catalog/${enc(p.id)}`, body);
    } catch (e) {
      // The day went by while the dialog was open (or the computer's clock is ahead of the shop's).
      if (e.code === 'badProductField' && /showAgainOn/.test(e.message)) throw new Error(t('pm.backOnPast'));
      throw e;
    }
    putProduct(P);
    reloadLater();
    return P;
  }

  /**
   * Pause: out of the shop for a while (customers see "back soon"), with a reason, a note and an
   * optional day it comes back by itself. Also changes the pause of a product already paused.
   */
  function pauseDialog(p, then) {
    const counted = countsStock(p);
    // Counted stock takes the product out of the shop by itself at 0: no "out of stock" pause.
    const reasons = ((S.data && S.data.hideReasons) || ['stock', 'season', 'quality', 'supplier', 'other']).filter((r) => !(counted && r === 'stock'));
    const cur = isPaused(p) ? p : null;
    const picked = cur && reasons.includes(cur.hiddenReason) ? cur.hiddenReason : reasons[0];
    const today = shopToday();
    const said = (v) => (!v ? t('pm.backOnHelp') : v < today ? t('pm.backOnPast') : t('pm.backOnSays', { date: dayText(v, { weekday: true }) }));
    const d = dialog(`
      <h3>${esc(t('pm.pauseTitle', { name: tr(p.name) }))}</h3>
      <p class="muted small">${esc(t('pm.pauseHelp'))}</p>
      <fieldset class="pm-reasons"><legend>${esc(t('pm.reason'))}</legend>
        ${reasons.map((r) => `<label class="pm-radio"><input type="radio" name="reason" value="${r}" ${r === picked ? 'checked' : ''}> ${esc(t('pm.reason.' + r))}</label>`).join('')}
      </fieldset>
      ${counted ? `<p class="muted small pm-dlg-hint">${esc(t('pm.noStockReason'))}</p>` : ''}
      <div class="field"><label for="pm-hide-note">${esc(t('pm.note'))}</label><input type="text" id="pm-hide-note" name="note" maxlength="200" placeholder="${esc(t('pm.notePh'))}" value="${esc(cur ? noteOf(cur) : '')}"></div>
      <div class="field pm-back-on"><label for="pm-back-on">${esc(t('pm.backOnLabel'))}</label>
        <div class="pm-date"><input type="date" id="pm-back-on" name="backOn" min="${esc(today)}" value="${esc((cur && cur.showAgainOn) || '')}"><button class="btn btn-sm" type="button" data-dlg-no-date ${cur && cur.showAgainOn ? '' : 'hidden'}>${esc(t('pm.noDate'))}</button></div>
        <span class="muted small pm-back-said" data-back-said aria-live="polite">${esc(said(cur && cur.showAgainOn))}</span></div>`, async (form) => {
      const day = form.backOn.value;
      if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < shopToday())) throw new Error(t('pm.backOnPast'));
      let note = form.note.value.trim();
      if (cur && note === t('pm.newNote') && cur.hiddenNote === NEW_NOTE) note = NEW_NOTE;
      const body = { status: 'hidden', hiddenReason: form.reason.value, hiddenNote: note };
      if (day) body.showAgainOn = day;
      const P = await saveStatus(p, body);
      toast(day ? t('pm.pausedUntil', { name: tr(P.name), date: dayText(day) }) : t('pm.pausedOk', { name: tr(P.name) }));
      if (then) then(P);
    });
    d.querySelector('[data-dlg-ok]').textContent = t(cur ? 'pm.savePause' : 'pm.pause');
    const input = d.querySelector('#pm-back-on');
    const clear = d.querySelector('[data-dlg-no-date]');
    const sync = () => {
      d.querySelector('[data-back-said]').textContent = said(input.value);
      clear.hidden = !input.value;
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    clear.addEventListener('click', () => { input.value = ''; sync(); input.focus(); });
  }

  /** Stop selling: the product moves to Archived. Nothing is deleted; it can be sold again any time. */
  function stopDialog(p, then) {
    const d = dialog(`
      <h3>${esc(t('pm.stopTitle', { name: tr(p.name) }))}</h3>
      <ul class="pm-stop-list">
        <li>${esc(t('pm.stop.archive'))}</li>
        <li>${esc(t('pm.stop.customers'))}</li>
        <li><b>${esc(t('pm.stop.kept'))}</b></li>
        <li>${esc(t('pm.stop.back'))}</li>
      </ul>
      ${isArchived(p) ? '' : `<p class="muted small pm-dlg-hint">${esc(t('pm.stop.pauseInstead'))} <button type="button" class="link-btn" data-dlg-pause>${esc(t('pm.stop.pauseBtn'))}</button></p>`}
      <div class="field"><label for="pm-stop-note">${esc(t('pm.note'))}</label><input type="text" id="pm-stop-note" name="note" maxlength="200" placeholder="${esc(t('pm.stopNotePh'))}"></div>`, async (form) => {
      const P = await saveStatus(p, { status: 'removed', hiddenNote: form.note.value.trim() });
      toast(t('pm.stoppedOk', { name: tr(P.name) }));
      if (then) then(P);
    }, { danger: true });
    d.querySelector('[data-dlg-ok]').textContent = t('pm.stopSelling');
    const pause = d.querySelector('[data-dlg-pause]');
    if (pause) pause.addEventListener('click', () => { d.close(); pauseDialog(p, then); });
  }

  /** Back in the shop: a paused product ("Show in the shop") or an archived one ("Sell again"). */
  async function showInShop(p, then) {
    const again = isArchived(p);
    try {
      const P = await saveStatus(p, { status: 'live' });
      toast(P.visible ? t(again ? 'pm.soldAgainOk' : 'pm.shownOk', { name: tr(P.name) }) : t('pm.shownButHidden', { why: whyHidden(P) }), P.visible ? undefined : 'error');
      if (then) then(P);
    } catch (e) {
      if (!sentForApproval(e)) toast(e.message, 'error');
    }
  }

  function uniqueId(base) {
    const ids = new Set(((S.data && S.data.products) || []).map((p) => p.id)); // deleted codes stay taken
    for (let i = 2; i < 999; i += 1) {
      const id = `${base}-${i}`.slice(0, 40);
      if (!ids.has(id)) return id;
    }
    return base + '-new';
  }

  /** Fields of a product's saved edit that a copy keeps (not its status, stock or photos). */
  const COPY_KEYS = ['description', 'category', 'colors', 'addColors', 'sizes', 'addSizes', 'sides', 'process', 'methods', 'embroidery'];

  function newDialog(from) {
    const tpls = products().filter((p) => p.builtIn && !p.kind);
    let pick = from ? (from.builtIn ? from.id : from.base) : '';
    let touched = false;
    const listHtml = (q) => {
      const nq = norm(q.trim());
      const rows = tpls.filter((p) => !nq || [p.id, p.name.en, p.name.ar].some((v) => norm(v).includes(nq)));
      return rows.length ? rows.map((p) => `
        <label class="pm-tpl ${pick === p.id ? 'is-on' : ''}"><input type="radio" name="tpl" value="${esc(p.id)}" ${pick === p.id ? 'checked' : ''}>
          <img src="${esc(picOf(p))}" alt="" loading="lazy"><span><b>${esc(tr(p.name))}</b><bdi class="pm-id" dir="ltr">${esc(p.id)}</bdi></span></label>`).join('')
        : `<p class="muted small">${esc(t('pm.none'))}</p>`;
    };
    const d = dialog(`
      <h3>${esc(t('pm.newTitle'))}</h3>
      <p class="muted small">${esc(t('pm.newHelp'))}</p>
      ${from && !from.builtIn ? `<p class="notice small">${esc(t('pm.copyOfAdded', { name: tr(from.name) }))}</p>` : ''}
      <div class="field"><label for="pm-tpl-q">${esc(t('pm.template'))}</label>
        <input type="search" id="pm-tpl-q" autocomplete="off" placeholder="${esc(t('pm.search'))}">
        <div class="pm-tpl-list" id="pm-tpl-list" role="radiogroup" aria-label="${esc(t('pm.template'))}">${listHtml('')}</div></div>
      <div class="pm-grid2">
        <div class="field"><label for="pm-new-ar">${esc(t('pm.f.nameAr'))}</label><input type="text" id="pm-new-ar" name="ar" maxlength="80" dir="rtl" required></div>
        <div class="field"><label for="pm-new-en">${esc(t('pm.f.nameEn'))}</label><input type="text" id="pm-new-en" name="en" maxlength="80" dir="ltr" required></div>
        <div class="field"><label for="pm-new-id">${esc(t('pm.code'))}</label><input type="text" id="pm-new-id" name="code" maxlength="40" dir="ltr" pattern="[a-z0-9][a-z0-9-]{0,39}" required autocapitalize="off" spellcheck="false"><span class="muted small">${esc(t('pm.codeHelp'))}</span></div>
      </div>`, async (form) => {
      const id = form.code.value.trim().toLowerCase();
      const tpl = (form.querySelector('input[name=tpl]:checked') || {}).value || pick;
      if (!tpl) throw new Error(t('pm.pickTemplate'));
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(t('pm.badCode'));
      const name = { en: form.en.value.trim(), ar: form.ar.value.trim() };
      if (!name.en || !name.ar) throw new Error(t('pm.needNames'));
      const body = { id, template: tpl, name };
      // "New product from this": keep this product's changes (colours, sizes, print setup...).
      if (from && from.edit) for (const k of COPY_KEYS) if (from.edit[k] !== undefined && (from.builtIn ? from.id : from.base) === tpl) body[k] = from.edit[k];
      if (from && from.pricesChanged && (from.builtIn ? from.id : from.base) === tpl) {
        body.prices = { basePrice: from.basePrice, extraSidePrice: from.extraSidePrice == null ? '' : from.extraSidePrice, sizes: Object.fromEntries(from.sizes.map((z) => [z.id, z.surcharge])) };
      }
      const P = await send('POST', '/api/admin/catalog', body);
      putProduct(P);
      if (P.warning) toast(t('pm.newWarning'), 'error');
      else toast(t('pm.newOk', { name: tr(P.name) }));
      reloadLater();
      openEdit(P.id, P);
    }, { wide: true });
    d.querySelector('[data-dlg-ok]').textContent = t('pm.create');
    const form = d.querySelector('form');
    const fill = () => {
      const p = tpls.find((x) => x.id === pick);
      if (!p) return;
      if (!touched) {
        const src = from && (from.builtIn ? from.id : from.base) === pick ? from : p;
        form.en.value = `${src.name.en} (new)`;
        form.ar.value = `${src.name.ar} (جديد)`;
        form.code.value = uniqueId(pick);
      }
    };
    fill();
    d.querySelector('#pm-tpl-q').addEventListener('input', (e) => { d.querySelector('#pm-tpl-list').innerHTML = listHtml(e.target.value); });
    d.querySelector('#pm-tpl-list').addEventListener('change', (e) => {
      if (e.target.name !== 'tpl') return;
      pick = e.target.value;
      d.querySelectorAll('.pm-tpl').forEach((l) => l.classList.toggle('is-on', l.querySelector('input').checked));
      fill();
    });
    ['en', 'ar', 'code'].forEach((k) => form[k].addEventListener('input', () => { touched = true; }));
    form.code.addEventListener('input', () => { form.code.value = form.code.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); });
    if (pick) setTimeout(() => { const el = d.querySelector('.pm-tpl.is-on'); if (el) el.scrollIntoView({ block: 'nearest' }); }, 0);
  }

  // =====================================================================
  // Staff accounts (owner only)
  // =====================================================================
  function genPassword() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const a = new Uint32Array(14);
    crypto.getRandomValues(a);
    return [...a].map((n) => abc[n % abc.length]).join('').replace(/^(.{4})(.{5})(.{5})$/, '$1-$2-$3');
  }
  async function loadStaff() {
    try {
      S.staff = (await api('/api/admin/staff')).staff;
    } catch (e) {
      S.staff = [];
      toast(e.message, 'error');
    }
    renderStaff();
  }
  function renderStaff() {
    const el = document.getElementById('pm-staff');
    if (!el) return;
    el.hidden = !(S.staffOpen && legacyStaff());
    if (el.hidden) return;
    if (!S.staff) {
      el.innerHTML = `<div class="card pm-staff"><p class="muted">${esc(t('pm.loading'))}</p></div>`;
      loadStaff();
      return;
    }
    const nw = S.newStaff;
    el.innerHTML = `
      <div class="card pm-staff">
        <h3>${esc(t('pm.staff.title'))}</h3>
        <p class="muted small">${esc(t('pm.staff.help'))}</p>
        ${nw ? `<div class="pm-staff-new notice"><b>${esc(t('pm.staff.share'))}</b>
          <div class="pm-cred"><span>${esc(t('pm.staff.username'))}: <code dir="ltr">${esc(nw.username)}</code></span><span>${esc(t('pm.staff.password'))}: <code dir="ltr">${esc(nw.password)}</code></span></div>
          <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm shrink" type="button" data-pm-act="copy-cred">${esc(t('pm.staff.copy'))}</button><button class="btn btn-sm shrink" type="button" data-pm-act="hide-cred">${esc(t('pm.staff.done'))}</button></div></div>` : ''}
        ${S.staff.length ? `<ul class="pm-staff-list">${S.staff.map((u) => `
          <li><div><b>${esc(u.name)}</b> <bdi class="pm-id" dir="ltr">${esc(u.username)}</bdi><div class="muted small">${esc(t('pm.staff.role'))}${esc(SEP())}${esc(t('pm.staff.since', { date: new Date(u.createdAt).toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }))}</div></div>
            <div class="pm-staff-acts"><button class="btn btn-sm" type="button" data-pm-act="staff-pw" data-id="${esc(u.id)}">${esc(t('pm.staff.changePw'))}</button><button class="btn btn-sm btn-danger" type="button" data-pm-act="staff-del" data-id="${esc(u.id)}">${esc(t('pm.staff.remove'))}</button></div></li>`).join('')}</ul>`
          : `<p class="muted small">${esc(t('pm.staff.none'))}</p>`}
        <form class="pm-staff-form" id="pm-staff-form" novalidate>
          <h4>${esc(t('pm.staff.add'))}</h4>
          <div class="pm-grid3">
            <div class="field"><label for="pm-st-name">${esc(t('pm.staff.name'))}</label><input type="text" id="pm-st-name" maxlength="60" required></div>
            <div class="field"><label for="pm-st-user">${esc(t('pm.staff.username'))}</label><input type="text" id="pm-st-user" maxlength="30" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="ahmed.products"></div>
            <div class="field"><label for="pm-st-pw">${esc(t('pm.staff.password'))}</label>
              <div class="pm-pw"><input type="text" id="pm-st-pw" minlength="10" maxlength="200" dir="ltr" autocomplete="new-password" required><button class="btn btn-sm shrink" type="button" data-pm-act="gen-pw" data-for="pm-st-pw">${esc(t('pm.staff.gen'))}</button></div>
              <span class="muted small">${esc(t('pm.staff.pwHelp'))}</span></div>
          </div>
          <p class="pm-err" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit">${esc(t('pm.staff.addBtn'))}</button>
        </form>
      </div>`;
    document.getElementById('pm-staff-form').addEventListener('submit', addStaff);
  }
  async function addStaff(e) {
    e.preventDefault();
    const f = e.target;
    const err = f.querySelector('.pm-err');
    const body = { name: f.querySelector('#pm-st-name').value.trim(), username: f.querySelector('#pm-st-user').value.trim().toLowerCase(), password: f.querySelector('#pm-st-pw').value };
    err.hidden = true;
    if (!body.name || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(body.username) || body.password.length < 10) {
      err.textContent = t('pm.staff.bad');
      err.hidden = false;
      return;
    }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await send('POST', '/api/admin/staff', body);
      S.newStaff = { username: body.username, password: body.password };
      toast(t('pm.staff.added', { name: body.name }));
      await loadStaff();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }
  function staffPwDialog(u) {
    const d = dialog(`
      <h3>${esc(t('pm.staff.pwTitle', { name: u.name }))}</h3>
      <p class="muted small">${esc(t('pm.staff.pwOut'))}</p>
      <div class="field"><label for="pm-st-pw2">${esc(t('pm.staff.newPw'))}</label>
        <div class="pm-pw"><input type="text" id="pm-st-pw2" name="pw" minlength="10" maxlength="200" dir="ltr" autocomplete="new-password" required><button class="btn btn-sm shrink" type="button" data-pm-act="gen-pw" data-for="pm-st-pw2">${esc(t('pm.staff.gen'))}</button></div>
        <span class="muted small">${esc(t('pm.staff.pwHelp'))}</span></div>`, async (form) => {
      const pw = form.pw.value;
      if (pw.length < 10) throw new Error(t('pm.staff.pwShort'));
      await send('PUT', `/api/admin/staff/${enc(u.id)}/password`, { password: pw });
      S.newStaff = { username: u.username, password: pw };
      toast(t('pm.staff.pwDone', { name: u.name }));
      renderStaff();
    });
    d.querySelector('[data-dlg-ok]').textContent = t('pm.staff.changePw');
    d.addEventListener('click', (e) => {
      const g = e.target.closest('[data-pm-act="gen-pw"]');
      if (g) d.querySelector('#' + g.dataset.for).value = genPassword();
    });
  }

  // =====================================================================
  // Edit page
  // =====================================================================
  async function openEdit(id, fresh) {
    if (!confirmLeave()) return;
    let P = fresh || products().find((p) => p.id === id);
    if (!P) {
      try { P = await api(`/api/admin/catalog/${enc(id)}`); } catch (e) { toast(e.message, 'error'); return; }
    }
    S.P = P;
    S.view = 'edit';
    S.dirty.clear();
    S.resets.clear();
    S.previewHex = null;
    initModels(P, SECTIONS);
    try { history.pushState({ pm: P.id }, '', '#product=' + enc(P.id)); } catch (e) { /* fine */ }
    renderEdit();
    window.scrollTo(0, 0);
    // The newest copy (another manager may have changed it).
    if (!fresh) {
      try {
        const latest = await api(`/api/admin/catalog/${enc(id)}`);
        if (S.view === 'edit' && S.P && S.P.id === latest.id && !S.dirty.size && latest.updatedAt !== P.updatedAt) {
          S.P = latest;
          putProduct(latest);
          initModels(latest, SECTIONS);
          renderEdit();
        }
      } catch (e) { /* keep the list copy */ }
    }
  }
  function confirmLeave() {
    if (S.view !== 'edit' || !S.dirty.size) return true;
    return confirm(t('pm.leaveConfirm'));
  }
  function backToList() {
    if (!confirmLeave()) return false;
    S.dirty.clear();
    S.P = null;
    renderList();
    load(true).then(() => S.view === 'list' && (renderRows(), renderLog())).catch(() => {});
    return true;
  }

  /** Build the editable copies of colours, sizes and sides from the product. */
  function initModels(P, which) {
    if (which.includes('colors')) {
      S.colors = P.colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, added: Boolean(c.added), state: c.off ? 'off' : c.soldOut ? 'soldOut' : 'on' }));
    }
    if (which.includes('sizes')) {
      const ed = (P.edit && P.edit.sizes) || {};
      S.sizes = P.sizes.map((z) => ({
        id: z.id, label: z.label, added: Boolean(z.added), state: z.off ? 'off' : z.soldOut ? 'soldOut' : 'on', surcharge: z.surcharge || 0, printScale: z.printScale || null,
        relabelled: Boolean(ed[z.id] && ed[z.id].label), labelEn: z.label.en, labelAr: z.label.ar,
      }));
    }
    if (which.includes('print')) {
      S.sides = {};
      for (const sd of P.sides) {
        S.sides[sd.id] = { x: sd.printArea.x, y: sd.printArea.y, w: sd.printArea.w, h: sd.printArea.h, widthCm: sd.printWidthCm, safeMm: sd.safeMm, bleedMm: sd.bleedMm, off: Boolean(sd.off) };
      }
    }
    if (which.includes('basics')) S.resets.clear();
  }

  const origSide = (P, id) => (P.original.sides || []).find((s) => s.id === id);
  /** "changed · reset" next to a field of a built-in product. */
  function mark(changed, resetKey) {
    if (!changed || !S.P.builtIn) return '';
    return `<span class="pm-chg"><span class="pm-chg-dot" aria-hidden="true"></span>${esc(t('pm.changed'))}${resetKey ? ` · <button type="button" class="link-btn" data-pm-reset="${esc(resetKey)}">${esc(t('pm.reset'))}</button>` : ''}</span>`;
  }
  const fieldId = (name) => 'pm-f-' + name.replace(/[^A-Za-z0-9_-]/g, '_');
  function fld(name, label, control, extra = '', cls = '') {
    return `<div class="field ${cls}"><div class="pm-lbl"><label for="${fieldId(name)}">${esc(label)}</label>${extra}</div>${control}</div>`;
  }
  const inp = (name, value, attrs = '') => `<input id="${fieldId(name)}" name="${esc(name)}" value="${esc(value == null ? '' : value)}" ${attrs}>`;

  function sec(name, title, help, body, { save = true } = {}) {
    const dirty = S.dirty.has(name);
    // Without catalog.edit the page is for looking: no Save, every box and button in the section off (the
    // prices have their own permission, prices.edit).
    const looking = !editing() && name !== 'prices';
    if (looking) save = false;
    return `<section class="card pm-sec" data-sec="${name}" id="pm-sec-${name}">
      <header class="pm-sec-head"><h3>${esc(title)}</h3>${help ? `<p class="muted small">${esc(help)}</p>` : ''}</header>
      <div class="pm-sec-body">${looking ? `<fieldset class="pm-ro" disabled>${body}</fieldset>` : body}</div>
      <p class="pm-err" role="alert" hidden></p>
      ${save ? `<div class="pm-sec-foot"><span class="pm-dirty small" ${dirty ? '' : 'hidden'}>${esc(t('pm.unsaved'))}</span><button class="btn" type="button" data-pm-undo="${name}" ${dirty ? '' : 'hidden'}>${esc(t('pm.discard'))}</button><button class="btn btn-primary" type="button" data-pm-save="${name}" ${dirty ? '' : 'disabled'}>${esc(t('pm.save'))}</button></div>` : ''}
    </section>`;
  }

  const SEC_RENDER = {
    basics: (P) => sec('basics', t('pm.s.basics'), '', basicsBody(P)),
    avail: (P) => sec('avail', t('pm.s.avail'), t('pm.s.availHelp'), availBody(P)),
    colors: (P) => sec('colors', t('pm.s.colors'), t('pm.s.colorsHelp'), colorsBody(P)),
    sizes: (P) => sec('sizes', t('pm.s.sizes'), t('pm.s.sizesHelp'), sizesBody(P)),
    // Selling prices: changed by those with prices.edit (owners, Finance); the others see them only.
    prices: (P) => sec('prices', t('pm.s.prices'), t(can('prices.edit') ? 'pm.s.pricesHelpOwner' : 'pm.s.pricesReadOnly'), pricesBody(P), { save: can('prices.edit') }),
    print: (P) => sec('print', t('pm.s.print'), t('pm.s.printHelp'), printBody(P)),
    tech: (P) => sec('tech', t('pm.s.tech'), '', techBody(P)),
    photos: (P) => sec('photos', t('pm.s.photos'), t('pm.s.photosHelp'), photosBody(P), { save: false }),
    danger: (P) => sec('danger', t('pm.s.danger'), '', dangerBody(P), { save: false }),
  };

  function headHtml(P) {
    const from = P.builtIn ? null : products().find((x) => x.id === P.base);
    return `
      <div class="card pm-ehead" id="pm-ehead">
        <button class="btn btn-sm pm-back" type="button" data-pm-act="back"><span aria-hidden="true">${back()}</span> ${esc(t('pm.backToList'))}</button>
        <div class="pm-ehead-main">
          <img src="${esc(picOf(P))}" alt="">
          <div class="pm-ehead-text">
            <h2>${esc(tr(P.name))}</h2>
            <div class="muted small"><bdi dir="ltr">${esc(P.id)}</bdi> · ${esc(catName(P.category))}${from ? ` · ${esc(t('pm.addedFrom', { name: tr(from.name) }))}` : ''}</div>
            <div class="pm-pills">${statusPill(P)}${stockPill(P)}${P.builtIn ? '' : pill('pm-pill-added', t('pm.added'))}</div>
            ${P.updatedAt ? `<div class="muted small">${esc(lastChange(P))}</div>` : ''}
          </div>
          <div class="pm-ehead-btns">
            ${P.visible && !P.kind ? `<a class="btn btn-sm" href="/product?id=${enc(P.id)}" target="_blank" rel="noopener">${esc(t('pm.viewShop'))}</a>` : ''}
            ${P.kind || !editing() ? '' : `<button class="btn btn-sm" type="button" data-pm-act="copy" data-id="${esc(P.id)}">${esc(t('pm.copy'))}</button>`}
          </div>
        </div>
      </div>`;
  }
  /** The sections on the edit page (stop selling / undo all only for those who change products). */
  const shownSections = () => SECTIONS.filter((s) => s !== 'danger' || editing());
  const jumpHtml = () => `<nav class="card pm-jump" aria-label="${esc(t('pm.sections'))}">${shownSections().map((s) => `<a href="#pm-sec-${s}" data-pm-jump="${s}">${esc(t('pm.s.' + s))}</a>`).join('')}</nav>`;
  function bannerHtml(P) {
    if (P.visible) return '';
    const neu = isNew(P);
    const arch = isArchived(P);
    const text = neu ? t('pm.newBanner') : arch ? t('pm.retiredBanner') : isOn(P) ? t('pm.liveButHidden', { why: whyHidden(P) }) : t('pm.hiddenBanner', { why: whyHidden(P) });
    const note = !neu && noteOf(P) ? `<div class="small">${esc(noteOf(P))}</div>` : '';
    const btn = !editing() ? '' : arch ? `<button class="btn btn-primary btn-sm" type="button" data-pm-act="sell-again">${esc(t('pm.sellAgain'))}</button>`
      : !isOn(P) ? `<button class="btn btn-primary btn-sm" type="button" data-pm-act="publish">${esc(t(neu ? 'pm.publishNew' : 'pm.show'))}</button>`
        : `<a class="btn btn-sm" href="#pm-sec-avail">${esc(t('pm.s.avail'))}</a>`;
    return `<div class="pm-banner ${neu ? 'is-new' : arch ? 'is-archived' : ''}" id="pm-banner" role="status"><div><b>${esc(text)}</b>${note}</div>${btn}</div>`;
  }

  function renderEdit() {
    const P = S.P;
    root.innerHTML = `
      <div class="pm-edit">
        ${headHtml(P)}
        ${jumpHtml()}
        <div id="pm-banner-slot">${bannerHtml(P)}</div>
        ${shownSections().map((s) => SEC_RENDER[s](P)).join('')}
        <section class="card pm-sec" id="pm-sec-log"><header class="pm-sec-head"><h3>${esc(t('pm.log.forProduct'))}</h3></header><div id="pm-plog">${logHtml(P.id)}</div></section>
      </div>`;
    drawAllSides();
    syncVariant();
  }
  /** After a save: redraw the header and every section without unsaved changes. */
  function refreshEdit(saved) {
    const P = S.P;
    const head = document.getElementById('pm-ehead');
    if (!head) return renderEdit();
    head.outerHTML = headHtml(P);
    document.getElementById('pm-banner-slot').innerHTML = bannerHtml(P);
    const redo = SECTIONS.filter((s) => s === saved || !S.dirty.has(s));
    initModels(P, redo);
    for (const s of redo) rerender(s);
    const l = document.getElementById('pm-plog');
    if (l) l.innerHTML = logHtml(P.id);
  }
  /** The status changed (pause, stop selling, back in the shop): redraw what shows it, nothing else. */
  function refreshStatus(P) {
    S.P = P;
    const head = document.getElementById('pm-ehead');
    if (!head) return renderEdit();
    head.outerHTML = headHtml(P);
    document.getElementById('pm-banner-slot').innerHTML = bannerHtml(P);
    const st = document.getElementById('pm-status');
    if (st) st.outerHTML = statusPanel(P);
    rerender('danger');
    const l = document.getElementById('pm-plog');
    if (l) l.innerHTML = logHtml(P.id);
    return undefined;
  }
  function rerender(name) {
    const el = document.getElementById('pm-sec-' + name);
    if (el) el.outerHTML = SEC_RENDER[name](S.P);
    if (name === 'print') drawAllSides(); // the boxes are placed after the section is drawn
    if (name === 'avail') syncVariant(); // the colours and totals of the stock grid
    showNums(document.getElementById('pm-sec-' + name));
  }
  function setDirty(name, on = true) {
    if (on) S.dirty.add(name); else S.dirty.delete(name);
    const el = document.getElementById('pm-sec-' + name);
    if (!el) return;
    const d = el.querySelector('.pm-dirty');
    if (d) d.hidden = !on;
    const u = el.querySelector('[data-pm-undo]');
    if (u) u.hidden = !on;
    const b = el.querySelector('[data-pm-save]');
    if (b) b.disabled = !on;
  }
  function secError(name, msg) {
    const el = document.getElementById('pm-sec-' + name);
    const e = el && el.querySelector(':scope > .pm-err');
    if (!e) return toast(msg, 'error');
    e.textContent = msg || '';
    e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  /** A box's value; a number box's as 0-9 text ("٢٧٠" → "270", '' when empty). */
  const val = (name) => {
    const el = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'radio') return (root.querySelector(`[name="${CSS.escape(name)}"]:checked`) || {}).value;
    if (el.hasAttribute('data-num')) return numText(el);
    return el.value;
  };

  // ---------- Number boxes ----------
  /*
   * Every number here (prices, size add-ons, stock, the print area, embroidery) is a text box with a number keyboard
   * ([data-num], as in admin.js): a type="number" box drops what an Arabic keyboard types (QA 25 Nov: "٢٧٠" left the
   * price box empty, and saving it put the original price back without a word). What is typed is read with
   * POD.latinDigits (Arabic-Indic and Persian digits, the Arabic decimal "٫"); grouping marks and spaces are left out.
   * data-min, data-max and data-whole keep the checks the number boxes had; data-need: an empty box is a mistake too.
   * A wrong box says why under it as it is typed, and its section isn't saved (nothing is sent) until it's right.
   * (admin.js checks the same boxes as they're typed, by the same rules but data-max: aria-invalid marks them here.)
   */
  const numText = (el) => POD.latinDigits(el.value).replace(/[\s\u066C\u200E\u200F]/g, '').replace(/\u2212/g, '-');
  /** What's wrong with a number box ('' when it's fine). */
  function numProblem(el) {
    const s = numText(el);
    const min = el.dataset.min != null ? Number(el.dataset.min) : null;
    if (!s) return el.hasAttribute('data-need') ? t(min > 0 ? 'pm.num.empty' : 'num.empty') : '';
    if (!/^-?\d*\.?\d+$/.test(s)) return t('num.bad');
    const v = Number(s);
    if (el.hasAttribute('data-whole') && !Number.isInteger(v)) return t('num.whole');
    if (min !== null && v < min) return t('num.min', { min: POD.num(min) });
    if (el.dataset.max != null && v > Number(el.dataset.max)) return t('pm.num.max', { max: POD.num(Number(el.dataset.max)) });
    return '';
  }
  /**
   * A number box's attributes: { min, max, whole (no fraction), need (not empty), neg (may be under 0: the phone
   * keyboard with a minus sign) }.
   */
  function numAttrs({ min = null, max = null, whole = false, need = false, neg = false } = {}) {
    const mode = neg ? '' : ` inputmode="${whole ? 'numeric' : 'decimal'}"`;
    return `type="text"${mode} autocomplete="off" spellcheck="false" dir="ltr" data-num${min !== null ? ` data-min="${min}"` : ''}${max !== null ? ` data-max="${max}"` : ''}${whole ? ' data-whole' : ''}${need ? ' data-need' : ''}`;
  }
  /**
   * What an emptied price box saves (QA 25 Nov: an emptied price went back to the original one without a word): the
   * original price, the original add-on, or a small pack following the base price again. '' for other boxes, and for
   * a box that was drawn empty (the extra side's "Empty = the shop's usual price" says it).
   */
  function emptyHint(el) {
    const P = S.P;
    const o = P && P.original && P.original.prices;
    if (!P || el.defaultValue === '' || !/^(basePrice|extraSidePrice|ps\.)/.test(el.name)) return '';
    if (el.name === 'basePrice' || el.name === 'extraSidePrice') {
      const v = o ? Number(o[el.name]) : NaN;
      return Number.isFinite(v) ? t('pm.empty.price', { price: POD.money(v) }) : t('pm.empty.original');
    }
    const id = el.name.slice(3);
    const z = P.sizes.find((x) => x.id === id);
    if (z && z.smallPack) return t('pm.empty.follows');
    const a = o && o.sizes ? Number(o.sizes[id]) : NaN;
    if (!Number.isFinite(a)) return t('pm.empty.original');
    return a ? t('pm.empty.addon', { amount: `${a > 0 ? '+' : ''}${POD.money(a)}` }) : t('pm.empty.noAddon');
  }
  /**
   * Say under a number box what's wrong with it, or what an emptied price box will do; the stock grid's boxes and its
   * "set all to" only turn red (with the reason as their tooltip: no room under them). Returns the problem ('' if none).
   */
  function showNum(el) {
    const bad = numProblem(el);
    el.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (el.classList.contains('pm-vs-in') || el.name === 'vsAll') {
      el.title = bad || el.getAttribute('aria-label') || '';
      return bad;
    }
    const text = bad || (numText(el) === '' ? emptyHint(el) : '');
    let note = el.nextElementSibling && el.nextElementSibling.classList.contains('pm-num-msg') ? el.nextElementSibling : null;
    if (text && !note) {
      note = document.createElement('span');
      note.className = 'pm-num-msg';
      note.id = `${el.id || fieldId(el.name)}-msg`;
      note.setAttribute('aria-live', 'polite');
      el.insertAdjacentElement('afterend', note);
      el.setAttribute('aria-describedby', note.id);
    }
    if (note) {
      note.textContent = text;
      note.hidden = !text;
      note.classList.toggle('is-bad', Boolean(bad));
    }
    return bad;
  }
  /** Bring every number box's message up to date (after a section is drawn, or the language changed). */
  const showNums = (where = root) => where && where.querySelectorAll('input[data-num]').forEach(showNum);
  /** A box's name as the admin reads it: its label, else its aria-label. */
  function boxName(el) {
    const l = el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return ((l && l.textContent) || el.getAttribute('aria-label') || '').trim();
  }
  /**
   * The first number box of a section with a mistake in it, as { el, msg } (null when all are right). Boxes that are
   * hidden, off or only helpers (data-no-dirty: "set all to", a new size's add-on) are not saved, so not checked.
   */
  function badNum(name) {
    const sec = document.getElementById('pm-sec-' + name);
    if (!sec) return null;
    for (const el of sec.querySelectorAll('input[data-num]')) {
      if (el.disabled || el.hasAttribute('data-no-dirty') || el.closest('[hidden], .is-hidden')) continue;
      const msg = showNum(el);
      if (msg) return { el, msg };
    }
    return null;
  }

  // ---------- a) Basics ----------
  function basicsBody(P) {
    const e = P.edit || {};
    const rd = S.resets.has('description');
    const rc = S.resets.has('category');
    const nameChanged = P.builtIn && (P.name.en !== P.original.name.en || P.name.ar !== P.original.name.ar);
    return `<div class="pm-grid2">
      ${fld('name.ar', t('pm.f.nameAr'), inp('name.ar', P.name.ar, 'type="text" maxlength="80" dir="rtl" required'), mark(nameChanged, 'name'))}
      ${fld('name.en', t('pm.f.nameEn'), inp('name.en', P.name.en, 'type="text" maxlength="80" dir="ltr" required'))}
      ${fld('desc.ar', t('pm.f.descAr'), `<textarea id="${fieldId('desc.ar')}" name="desc.ar" maxlength="1500" rows="3" dir="rtl" ${rd ? 'disabled' : ''}>${esc((P.description || {}).ar || '')}</textarea>`, rd ? `<span class="pm-chg">${esc(t('pm.willReset'))}</span>` : mark(e.description !== undefined, 'description'))}
      ${fld('desc.en', t('pm.f.descEn'), `<textarea id="${fieldId('desc.en')}" name="desc.en" maxlength="1500" rows="3" dir="ltr" ${rd ? 'disabled' : ''}>${esc((P.description || {}).en || '')}</textarea>`)}
      ${fld('category', t('pm.category'), `<select id="${fieldId('category')}" name="category" ${rc ? 'disabled' : ''}>${S.data.categories.map((c) => `<option value="${esc(c.id)}" ${P.category === c.id ? 'selected' : ''}>${esc(tr(c.name))}</option>`).join('')}</select>`, rc ? `<span class="pm-chg">${esc(t('pm.willReset'))}</span>` : mark(e.category !== undefined, 'category'))}
    </div>`;
  }
  function saveBasics(P) {
    const body = {};
    const name = { en: val('name.en').trim(), ar: val('name.ar').trim() };
    if (!name.en || !name.ar) throw new Error(t('pm.needNames'));
    if (name.en !== P.name.en || name.ar !== P.name.ar) {
      // Back to the name as written: clear the change instead of saving a copy of it.
      body.name = P.builtIn && name.en === P.original.name.en && name.ar === P.original.name.ar ? {} : name;
    }
    if (S.resets.has('description')) body.description = {};
    else {
      const d = { en: val('desc.en').trim(), ar: val('desc.ar').trim() };
      if (d.en !== ((P.description || {}).en || '') || d.ar !== ((P.description || {}).ar || '')) {
        if (!d.en || !d.ar) throw new Error(t('pm.needDesc'));
        body.description = d;
      }
    }
    if (S.resets.has('category')) body.category = '';
    else if (val('category') !== P.category) body.category = val('category');
    return body;
  }

  // ---------- b) Availability ----------
  /**
   * Where the product stands (In the shop / Paused / Stopped selling) and its buttons. They save
   * right away (with their dialogs); the section's Save button is for the stock below.
   */
  function statusPanel(P) {
    const st = isArchived(P) ? 'removed' : isPaused(P) ? 'hidden' : 'live';
    const lines = [];
    if (st === 'live') {
      lines.push(t('pm.status.liveHelp'));
      if (P.pausedUntilPassed) lines.push(t('pm.status.backSince', { date: dayText(P.showAgainOn) }));
    } else if (st === 'hidden') {
      lines.push(t(isNew(P) ? 'pm.status.newHelp' : 'pm.status.hiddenHelp'));
      lines.push(P.showAgainOn ? t('pm.status.backOn', { date: dayText(P.showAgainOn, { weekday: true }) }) : t('pm.status.noDay'));
    } else lines.push(t('pm.status.removedHelp'));
    const why = st === 'hidden' && P.hiddenReason && !isNew(P) ? t('pm.reason.' + P.hiddenReason) : '';
    const note = noteOf(P);
    const acts = st === 'removed' ? statusActs(P, 'btn')
      : st === 'hidden' ? `<button class="btn btn-primary" type="button" data-pm-act="show" data-id="${esc(P.id)}">${esc(t(isNew(P) ? 'pm.publishNew' : 'pm.show'))}</button>
        <button class="btn" type="button" data-pm-act="pause" data-id="${esc(P.id)}">${esc(t('pm.changePause'))}</button>
        <button class="btn pm-btn-stop" type="button" data-pm-act="stop" data-id="${esc(P.id)}">${esc(t('pm.stopSelling'))}</button>`
        : statusActs(P, 'btn');
    return `<div class="pm-state pm-state-${st}" id="pm-status">
      <div class="pm-state-text">
        <div class="pm-state-lbl">${esc(t('pm.status'))}</div>
        <div class="pm-state-name"><span class="pm-state-dot" aria-hidden="true"></span><b>${esc(t('pm.status.' + st))}</b>${why ? `<span class="pm-state-why">${esc(why)}</span>` : ''}</div>
        ${lines.map((l) => `<p class="small">${esc(l)}</p>`).join('')}
        ${note ? `<p class="small pm-note">${esc(t('pm.noteSaid', { note: '\u2068' + note + '\u2069' }))}</p>` : ''}
      </div>
      <div class="pm-state-acts">${acts}</div>
    </div>`;
  }
  function availBody(P) {
    const e = P.edit || {};
    const mode = stockModeOf(P);
    const why = isOn(P) && !P.visible ? `<p class="notice small">${esc(t('pm.liveButHidden', { why: whyHidden(P) }))}</p>` : '';
    return `
      ${statusPanel(P)}
      ${why}
      <div class="pm-stock">
        <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('pm.stockMode'))} ${mark(e.stock !== undefined || e.variantStock !== undefined, 'stock')}</legend>
          <div class="pm-modes" role="radiogroup">
            ${['none', 'whole', 'variant'].map((m) => `<label class="pm-mode"><input type="radio" name="stockMode" value="${m}" ${mode === m ? 'checked' : ''}><span>${esc(t('pm.sm.' + m))}</span></label>`).join('')}
          </div>
          <p class="muted small" data-pm-stock-help>${esc(stockHelp(mode))}</p>
        </fieldset>
        <div class="pm-vs" ${mode === 'variant' ? '' : 'hidden'}>${variantGrid(P)}</div>
        <div class="pm-grid2 pm-stock-fields" ${mode === 'none' ? 'hidden' : ''}>
          ${fld('stock', t('pm.stockNow'), inp('stock', P.stock !== null ? P.stock : '', numAttrs({ min: 0, whole: true, need: true })), '', 'pm-stock-whole' + (mode === 'whole' ? '' : ' is-hidden'))}
          ${fld('lowStockAt', t('pm.lowAt'), inp('lowStockAt', P.lowStockAt, numAttrs({ min: 0, whole: true })), '', '')}
        </div>
      </div>`;
  }
  const stockModeOf = (P) => (P.variantStock ? 'variant' : P.stock !== null ? 'whole' : 'none');
  const stockHelp = (mode) => t(mode === 'whole' ? 'pm.stockHelp' : 'pm.sm.' + mode + 'Help');
  const vsName = (cid, zid) => `vs.${cid}|${zid}`;
  /** Pieces per colour and size: a grid (colours down, sizes across), or a list when there's one colour or one size. */
  function variantGrid(P) {
    const colors = P.colors.filter((c) => !c.off);
    const sizes = P.sizes.filter((z) => !z.off);
    const vs = P.variantStock || {};
    const cell = (c, z) => {
      const v = vs[`${c.id}|${z.id}`];
      const label = t('pm.vs.cell', { colour: tr(c.name), size: tr(z.label) });
      return `<input class="pm-vs-in" name="${esc(vsName(c.id, z.id))}" value="${typeof v === 'number' ? v : ''}" ${numAttrs({ min: 0, whole: true })} aria-label="${esc(label)}" title="${esc(label)}" data-c="${esc(c.id)}" data-z="${esc(z.id)}">`;
    };
    const sw = (c) => `<span class="pm-sw pm-sw-sm" style="background:${esc(c.hex)}" aria-hidden="true"></span>`;
    const tools = `
      <div class="pm-vs-tools">
        <label class="pm-vs-all"><span>${esc(t('pm.vs.setAll'))}</span><input ${numAttrs({ min: 0, whole: true })} name="vsAll" data-no-dirty aria-label="${esc(t('pm.vs.setAll'))}"></label>
        <button type="button" class="btn btn-sm" data-pm-act="vs-all">${esc(t('pm.vs.apply'))}</button>
        <button type="button" class="btn btn-sm" data-pm-act="vs-clear">${esc(t('pm.vs.clear'))}</button>
      </div>`;
    const key = `<p class="pm-vs-key small"><span class="pm-key pm-key-out">${esc(t('pm.vs.keyOut'))}</span><span class="pm-key pm-key-low" data-pm-key-low>${esc(t('pm.vs.keyLow', { n: POD.num(P.lowStockAt) }))}</span><span class="pm-key pm-key-empty">${esc(t('pm.vs.keyEmpty'))}</span></p>`;
    const offNote = P.colors.some((c) => c.off) || P.sizes.some((z) => z.off) ? `<p class="muted small">${esc(t('pm.vs.onlyOn'))}</p>` : '';
    let body;
    if (colors.length > 1 && sizes.length > 1) {
      body = `<div class="pm-vs-scroll"><table class="pm-vs-grid">
        <thead><tr><th scope="col" class="pm-vs-corner"><span class="pm-vs-sr">${esc(t('pm.f.colour'))}</span></th>${sizes.map((z) => `<th scope="col"><bdi>${esc(tr(z.label))}</bdi></th>`).join('')}<th scope="col" class="pm-vs-tot">${esc(t('pm.vs.total'))}</th></tr></thead>
        <tbody>${colors.map((c) => `<tr><th scope="row"><span class="pm-vs-c">${sw(c)}<span>${esc(tr(c.name))}</span></span></th>${sizes.map((z) => `<td>${cell(c, z)}</td>`).join('')}<td class="pm-vs-tot" data-pm-rt="${esc(c.id)}"></td></tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">${esc(t('pm.vs.total'))}</th>${sizes.map((z) => `<td class="pm-vs-tot" data-pm-ct="${esc(z.id)}"></td>`).join('')}<td class="pm-vs-tot pm-vs-grand" data-pm-gt></td></tr></tfoot>
      </table></div>`;
    } else {
      // One colour (a list of sizes), one size (a list of colours), or just one of each.
      const rows = colors.length > 1 ? colors.map((c) => [c, sizes[0], `${sw(c)}<span>${esc(tr(c.name))}</span>`])
        : sizes.map((z) => [colors[0], z, `${sw(colors[0])}<span>${esc(sizes.length > 1 ? tr(z.label) : t('pm.vs.cell', { colour: tr(colors[0].name), size: tr(z.label) }))}</span>`]);
      body = `<div class="pm-vs-list">${rows.map(([c, z, label]) => `<label class="pm-vs-item"><span class="pm-vs-c">${label}</span>${cell(c, z)}</label>`).join('')}
        <div class="pm-vs-item pm-vs-sum"><span>${esc(t('pm.vs.total'))}</span><b data-pm-gt></b></div></div>`;
    }
    return `<h4 class="pm-vs-h">${esc(t('pm.vs.title'))}</h4>${tools}${body}${key}${offNote}`;
  }
  /** Colour the boxes (0 red, running low amber) and add up the rows and columns. */
  function syncVariant() {
    const box = root.querySelector('.pm-vs');
    if (!box) return;
    const lowRaw = val('lowStockAt');
    const low = /^\d+$/.test(lowRaw || '') ? Number(lowRaw) : 5;
    const rows = {};
    const cols = {};
    let grand = null;
    const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
    box.querySelectorAll('.pm-vs-in').forEach((el) => {
      // Any digits ("١٢" is 12); a wrong box is red, with the reason as its tooltip, and isn't counted.
      const raw = numText(el);
      const bad = showNum(el);
      const v = raw === '' || bad ? null : Number(raw);
      const ok = v !== null;
      el.classList.toggle('is-out', ok && v === 0);
      el.classList.toggle('is-low', ok && v > 0 && v <= low);
      el.classList.toggle('is-bad', Boolean(bad));
      if (!ok) return;
      add(rows, el.dataset.c, v);
      add(cols, el.dataset.z, v);
      grand = (grand || 0) + v;
    });
    const show = (v) => (v === undefined || v === null ? '—' : POD.num(v));
    box.querySelectorAll('[data-pm-rt]').forEach((el) => { el.textContent = show(rows[el.dataset.pmRt]); });
    box.querySelectorAll('[data-pm-ct]').forEach((el) => { el.textContent = show(cols[el.dataset.pmCt]); });
    box.querySelectorAll('[data-pm-gt]').forEach((el) => { el.textContent = show(grand); });
    const k = box.querySelector('[data-pm-key-low]');
    if (k) k.textContent = t('pm.vs.keyLow', { n: POD.num(low) });
  }
  /** The stock part of the section (the status buttons save on their own). */
  function saveAvail(P) {
    const body = {};
    const mode = val('stockMode');
    const lowOf = () => {
      const low = val('lowStockAt');
      if (low !== '' && (!Number.isInteger(Number(low)) || Number(low) < 0)) throw new Error(t('pm.badStock'));
      return low === '' || Number(low) === 5 ? null : Number(low);
    };
    if (mode === 'whole') {
      const n = val('stock');
      if (n === '' || !Number.isInteger(Number(n)) || Number(n) < 0) throw new Error(t('pm.badStock'));
      body.stock = Number(n);
      body.variantStock = null;
      body.lowStockAt = lowOf();
    } else if (mode === 'variant') {
      // Counts kept for colours or sizes that are off now stay as they are.
      const vs = {};
      const shown = new Set();
      root.querySelectorAll('.pm-vs .pm-vs-in').forEach((el) => {
        const k = `${el.dataset.c}|${el.dataset.z}`;
        shown.add(k);
        const raw = numText(el);
        if (raw === '') return;
        const v = Number(raw);
        if (!Number.isInteger(v) || v < 0) { el.focus(); throw new Error(t('pm.badStock')); }
        vs[k] = v;
      });
      if (!Object.keys(vs).length) throw new Error(t('pm.vs.empty'));
      for (const [k, v] of Object.entries(P.variantStock || {})) if (!shown.has(k)) vs[k] = v;
      body.stock = null;
      body.variantStock = vs;
      body.lowStockAt = lowOf();
    } else {
      body.stock = null;
      body.variantStock = null;
      body.lowStockAt = null;
    }
    return body;
  }

  // ---------- c) Colours ----------
  const seg = (name, state, { soldOut = true } = {}) => `
    <div class="pm-seg" role="radiogroup">
      ${['on', ...(soldOut ? ['soldOut'] : []), 'off'].map((s) => `<label class="pm-seg-opt pm-o-${s}"><input type="radio" name="${esc(name)}" value="${s}" ${state === s ? 'checked' : ''}><span>${esc(t('pm.o.' + s))}</span></label>`).join('')}
    </div>`;
  function colorsBody(P) {
    return `
      <div class="pm-opts">${S.colors.map((c) => `
        <div class="pm-opt ${c.state !== 'on' ? 'is-' + c.state : ''}" data-color="${esc(c.id)}">
          <span class="pm-sw" style="background:${esc(c.hex)}" aria-hidden="true"></span>
          <span class="pm-opt-name"><b>${esc(tr(c.name))}</b> ${c.added ? pill('pm-pill-added', t('pm.added')) : ''} ${mark(!c.added && c.state !== 'on', 'color:' + c.id)}</span>
          ${seg('c.' + c.id, c.state)}
          ${c.added ? `<button type="button" class="btn btn-sm btn-danger" data-pm-act="del-color" data-id="${esc(c.id)}">${esc(t('pm.delete'))}</button>` : ''}
        </div>`).join('')}
      </div>
      <details class="pm-add" ${S.addColorOpen ? 'open' : ''}>
        <summary>+ ${esc(t('pm.addColor'))}</summary>
        <div class="pm-add-grid">
          ${fld('nc.ar', t('pm.f.nameAr'), inp('nc.ar', '', 'type="text" maxlength="40" dir="rtl" data-no-dirty placeholder="زيتي"'))}
          ${fld('nc.en', t('pm.f.nameEn'), inp('nc.en', '', 'type="text" maxlength="40" dir="ltr" data-no-dirty placeholder="Olive"'))}
          ${fld('nc.hex', t('pm.f.colour'), `<div class="pm-hex"><input type="color" id="${fieldId('nc.hex')}" name="nc.hex" value="#6b7a3a" data-no-dirty><code dir="ltr" data-hex-out>#6b7a3a</code></div>`)}
          <div class="field pm-add-btn"><button type="button" class="btn" data-pm-act="add-color">${esc(t('pm.add'))}</button></div>
        </div>
        <p class="muted small">${esc(t('pm.addColorHelp'))}</p>
      </details>`;
  }
  function saveColors(P) {
    const added = S.colors.filter((c) => c.added);
    const colors = {};
    for (const c of S.colors) if (c.state !== 'on') colors[c.id] = c.state === 'off' ? { off: true } : { soldOut: true };
    if (S.colors.every((c) => c.state === 'off')) throw new Error(t('pm.needColor'));
    return { colors, addColors: added.map((c) => ({ id: c.id, name: c.name, hex: c.hex })) };
  }
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

  // ---------- d) Sizes ----------
  function sizesBody(P) {
    return `
      <div class="pm-opts">${S.sizes.map((z) => {
        const k = z.id;
        return `
        <div class="pm-opt pm-size ${z.state !== 'on' ? 'is-' + z.state : ''}" data-size="${esc(k)}">
          <span class="pm-size-id" dir="ltr">${esc(k)}</span>
          <div class="pm-size-labels">
            <input type="text" name="sl.ar.${esc(k)}" maxlength="40" dir="rtl" value="${esc(z.labelAr)}" placeholder="${esc(t('pm.asBuilt'))}" aria-label="${esc(t('pm.f.labelAr'))} ${esc(k)}">
            <input type="text" name="sl.en.${esc(k)}" maxlength="40" dir="ltr" value="${esc(z.labelEn)}" placeholder="${esc(t('pm.asBuilt'))}" aria-label="${esc(t('pm.f.labelEn'))} ${esc(k)}">
          </div>
          <span class="pm-addon" title="${esc(t('pm.addonHelp'))}">${z.surcharge ? esc((z.surcharge > 0 ? '+' : '') + POD.money(z.surcharge)) : esc(t('pm.noAddon'))}${z.printScale ? ` · ×${esc(fx(z.printScale))}` : ''}</span>
          ${seg('z.' + k, z.state)}
          <span class="pm-opt-flags">${z.added ? pill('pm-pill-added', t('pm.added')) : ''}${mark(!z.added && (z.state !== 'on' || z.relabelled), 'size:' + k)}</span>
          ${z.added ? `<button type="button" class="btn btn-sm btn-danger" data-pm-act="del-size" data-id="${esc(k)}">${esc(t('pm.delete'))}</button>` : ''}
        </div>`;
      }).join('')}
      </div>
      <p class="muted small">${esc(t('pm.sizesPriceNote'))} <a href="#pm-sec-prices">${esc(t('pm.s.prices'))}</a></p>
      <details class="pm-add" ${S.addSizeOpen ? 'open' : ''}>
        <summary>+ ${esc(t('pm.addSize'))}</summary>
        <div class="pm-add-grid">
          ${fld('ns.id', t('pm.f.sizeId'), inp('ns.id', '', 'type="text" maxlength="20" dir="ltr" data-no-dirty placeholder="4XL" autocapitalize="characters" spellcheck="false"'))}
          ${fld('ns.ar', t('pm.f.labelAr'), inp('ns.ar', '', 'type="text" maxlength="40" dir="rtl" data-no-dirty placeholder="4XL"'))}
          ${fld('ns.en', t('pm.f.labelEn'), inp('ns.en', '', 'type="text" maxlength="40" dir="ltr" data-no-dirty placeholder="4XL"'))}
          ${fld('ns.add', t('pm.f.addon'), inp('ns.add', '0', `${numAttrs({ neg: true })} data-no-dirty`))}
          ${fld('ns.scale', t('pm.f.scale'), inp('ns.scale', '', `${numAttrs({ min: 0.1, max: 10 })} data-no-dirty placeholder="1"`))}
          <div class="field pm-add-btn"><button type="button" class="btn" data-pm-act="add-size">${esc(t('pm.add'))}</button></div>
        </div>
        <p class="muted small">${esc(t('pm.addSizeHelp'))}</p>
      </details>`;
  }
  function readSizeLabels() {
    for (const z of S.sizes) {
      const ar = root.querySelector(`[name="${CSS.escape('sl.ar.' + z.id)}"]`);
      const en = root.querySelector(`[name="${CSS.escape('sl.en.' + z.id)}"]`);
      if (ar) z.labelAr = ar.value.trim();
      if (en) z.labelEn = en.value.trim();
    }
  }
  function saveSizes(P) {
    readSizeLabels();
    if (S.sizes.every((z) => z.state === 'off')) throw new Error(t('pm.needSize'));
    const sizes = {};
    const addSizes = [];
    for (const z of S.sizes) {
      const f = z.state === 'off' ? { off: true } : z.state === 'soldOut' ? { soldOut: true } : {};
      if (z.added) {
        if (!z.labelEn || !z.labelAr) throw new Error(t('pm.needLabels'));
        addSizes.push({ id: z.id, label: { en: z.labelEn, ar: z.labelAr }, surcharge: z.addedSurcharge != null ? z.addedSurcharge : z.surcharge, ...(z.printScale ? { printScale: z.printScale } : {}) });
      } else if (z.labelEn || z.labelAr) {
        if (!z.labelEn || !z.labelAr) throw new Error(t('pm.needLabels'));
        // Sent only when it differs from what the product shows, or when it was renamed before.
        const cur = P.sizes.find((x) => x.id === z.id).label;
        if (z.relabelled || z.labelEn !== cur.en || z.labelAr !== cur.ar) f.label = { en: z.labelEn, ar: z.labelAr };
      }
      if (Object.keys(f).length) sizes[z.id] = f;
    }
    return { sizes, addSizes };
  }

  // ---------- e) Prices ----------
  function pricesBody(P) {
    const multi = P.sides.length > 1;
    const html = `
      ${P.pricesChanged ? `<p class="pm-chg-line">${mark(true, 'prices')}<span class="muted small"> ${esc(t('pm.pricesChanged'))}</span></p>` : ''}
      <div class="pm-grid3">
        ${fld('basePrice', t('pm.basePrice'), inp('basePrice', P.basePrice, `${numAttrs({ min: 1 })} placeholder="${esc(t('pm.asBuilt'))}"`))}
        ${multi ? fld('extraSidePrice', t('pm.extraSide'), inp('extraSidePrice', P.extraSidePrice == null ? '' : P.extraSidePrice, `${numAttrs({ min: 0 })} placeholder="${esc(t('pm.shopDefault'))}"`), `<span class="muted small">${esc(t('pm.extraSideHelp'))}</span>`) : ''}
      </div>
      <div class="pm-price-table" role="table">
        <div class="pm-pt-row pm-pt-head" role="row"><span role="columnheader">${esc(t('pm.size'))}</span><span role="columnheader">${esc(t('pm.f.addon'))}</span><span role="columnheader">${esc(t('pm.finalPrice'))}</span></div>
        ${P.sizes.map((z) => `
        <div class="pm-pt-row ${z.off ? 'is-off' : ''}" role="row">
          <span role="cell"><b>${esc(tr(z.label))}</b> <bdi class="pm-id" dir="ltr">${esc(z.id)}</bdi></span>
          <span role="cell"><input ${numAttrs({ neg: true })} id="${fieldId('ps.' + z.id)}" name="ps.${esc(z.id)}" value="${esc(z.surcharge || 0)}" placeholder="${esc(t('pm.asBuilt'))}" aria-label="${esc(t('pm.f.addon'))} ${esc(tr(z.label))}"></span>
          <span role="cell" class="pm-final" data-final="${esc(z.id)}">${esc(POD.money((Number(P.basePrice) || 0) + (Number(z.surcharge) || 0)))}</span>
        </div>`).join('')}
      </div>
      <p class="muted small">${esc(t('pm.pricesEmpty'))}</p>
      <div data-pack-warn aria-live="polite">${packWarnHtml(POD_PACKS.cheaperBiggerPacks(P.sizes, Object.fromEntries(P.sizes.map((z) => [z.id, r2(P.basePrice + (Number(z.surcharge) || 0))]))))}</div>`;
    return can('prices.edit') ? html : html.replace(/<input /g, '<input disabled ');
  }
  function updateFinals() {
    const raw = val('basePrice');
    const P = S.P;
    // Each size's price once saved, worked out as the server will (public/js/pack-prices.js): a small pack
    // (1, 10, 25 copies) left as shown stays as it is (the owner's own price for it stays that price
    // whatever the product's price, and a pack that follows the product's price gets its share of the new
    // price, never under 1 EGP), and an emptied box goes back to the original price (shown: its box says so too).
    // The boxes as read (val: any digits); a size whose box, or the base price's, isn't a number shows "—" and
    // no warning (the box says what's wrong, and the section isn't saved until it's right).
    const sizes = Object.fromEntries(P.sizes.map((z) => [z.id, val('ps.' + z.id)]));
    const prices = POD_PACKS.savedPrices(P, P.original && P.original.prices, { basePrice: raw, sizes });
    const isNum = (v) => !v || /^-?\d*\.?\d+$/.test(v);
    for (const id of Object.keys(prices)) if (!isNum(raw) || !isNum(sizes[id])) prices[id] = null;
    root.querySelectorAll('[data-final]').forEach((el) => {
      const v = prices[el.dataset.final];
      el.textContent = v == null ? '—' : POD.money(v);
    });
    showPackWarnings(P, prices);
  }
  /** Bigger packs that would cost less than smaller ones at the prices typed (a warning: saving still works). */
  function showPackWarnings(P, prices) {
    const box = root.querySelector('[data-pack-warn]');
    if (box) box.innerHTML = packWarnHtml(POD_PACKS.cheaperBiggerPacks(P.sizes, prices));
  }
  /**
   * The owner's warning about packs priced the wrong way round (POD_PACKS.cheaperBiggerPacks), one line
   * each: "10 brochures (EGP 35) costs less than 1 brochure (EGP 40)". Also used by Accounts → Prices.
   */
  function packWarnHtml(list) {
    if (!can('prices.edit') || !list || !list.length) return '';
    const b = (s) => `<bdi>${esc(s)}</bdi>`;
    const line = (w) => t('pm.packWarn.line', { big: b(tr(w.bigger.label)), bigPrice: b(POD.money(w.bigger.price)), small: b(tr(w.smaller.label)), smallPrice: b(POD.money(w.smaller.price)) });
    return `<div class="pack-warn">
      <b class="pack-warn-title">${esc(t('pm.packWarn.title'))}</b>
      <ul>${list.map((w) => `<li>${line(w)}</li>`).join('')}</ul>
      <p class="small">${esc(t('pm.packWarn.help'))}</p>
    </div>`;
  }
  function savePrices(P) {
    const sizes = Object.fromEntries(P.sizes.map((z) => [z.id, val('ps.' + z.id) == null ? '' : val('ps.' + z.id)]));
    return { prices: { basePrice: val('basePrice'), extraSidePrice: val('extraSidePrice') == null ? '' : val('extraSidePrice'), sizes } };
  }

  // ---------- f) Print setup (visual print-area editor) ----------
  function sideChanged(P, sid) {
    const o = origSide(P, sid);
    const st = S.sides[sid];
    if (!o) return false;
    const a = o.printArea;
    return st.off || ['x', 'y', 'w', 'h'].some((k) => Math.abs(st[k] - a[k]) > 0.05) || Math.abs(st.widthCm - o.printWidthCm) > 0.01 || Math.abs(st.safeMm - o.safeMm) > 0.05 || Math.abs(st.bleedMm - o.bleedMm) > 0.05;
  }
  function printBody(P) {
    const colors = P.colors.filter((c) => !c.off);
    const hex = S.previewHex || firstHex(P);
    return `
      <div class="pm-preview-colors" role="group" aria-label="${esc(t('pm.previewColour'))}"><span class="muted small">${esc(t('pm.previewColour'))}</span>
        ${colors.slice(0, 14).map((c) => `<button type="button" class="pm-sw pm-sw-btn ${c.hex === hex ? 'is-on' : ''}" style="background:${esc(c.hex)}" data-pm-act="preview-hex" data-hex="${esc(c.hex)}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" aria-pressed="${c.hex === hex}"></button>`).join('')}
      </div>
      <div class="pm-sides">${P.sides.map((sd) => sideHtml(P, sd, hex)).join('')}</div>`;
  }
  function sideHtml(P, sd, hex) {
    const st = S.sides[sd.id];
    const o = origSide(P, sd.id) || { printArea: sd.printArea };
    const k = sd.id;
    const filled = POD.mockupUrl(sd, hex);
    const over = sd.overlay ? POD.mockupUrl(sd, hex, 'overlay') : '';
    const emb = P.embroidery && P.embroidery.side === k ? P.embroidery.area : null;
    const lock = S.lock[k] !== false;
    const corners = ['nw', 'ne', 'sw', 'se'];
    const edges = ['n', 's', 'e', 'w'];
    return `
      <div class="pm-side ${st.off ? 'is-off' : ''}" data-side="${esc(k)}">
        <div class="pm-side-head">
          <h4>${esc(tr(sd.name))}</h4>
          <label class="check"><input type="checkbox" name="on.${esc(k)}" ${st.off ? '' : 'checked'}> <span>${esc(t('pm.sideOn'))}</span></label>
          ${mark(sideChanged(P, k), 'side:' + k)}
        </div>
        <div class="pm-side-body">
          <div class="pm-pa-wrap">
            <svg class="pm-pa" viewBox="0 0 ${W} ${H}" data-side="${esc(k)}" role="img" aria-label="${esc(t('pm.paLabel', { side: tr(sd.name) }))}">
              <rect width="${W}" height="${H}" fill="#f3f4f6"/>
              ${filled ? `<image href="${esc(filled)}" width="${W}" height="${H}"/>` : ''}
              ${over ? `<image href="${esc(over)}" width="${W}" height="${H}"/>` : ''}
              <rect class="pm-pa-orig" x="${o.printArea.x}" y="${o.printArea.y}" width="${o.printArea.w}" height="${o.printArea.h}"/>
              ${emb ? `<rect class="pm-pa-emb" x="${emb.x}" y="${emb.y}" width="${emb.w}" height="${emb.h}"><title>${esc(t('pm.embArea'))}</title></rect>` : ''}
              <rect class="pm-pa-bleed" data-r="bleed"/>
              <rect class="pm-pa-box" data-r="box" data-drag="move" tabindex="0" aria-label="${esc(t('pm.paBox'))}"/>
              <rect class="pm-pa-safe" data-r="safe"/>
              ${edges.map((m) => `<g data-drag="${m}" class="pm-pa-h pm-pa-edge"><circle class="pm-pa-hit" r="22"/><rect class="pm-pa-dot" width="14" height="14" x="-7" y="-7" rx="3"/></g>`).join('')}
              ${corners.map((m) => `<g data-drag="${m}" class="pm-pa-h"><circle class="pm-pa-hit" r="24"/><circle class="pm-pa-dot" r="9"/></g>`).join('')}
            </svg>
            <div class="pm-pa-legend small muted"><span class="pm-lg pm-lg-box"></span>${esc(t('pm.lg.box'))} <span class="pm-lg pm-lg-safe"></span>${esc(t('pm.lg.safe'))} <span class="pm-lg pm-lg-orig"></span>${esc(t('pm.lg.orig'))}${emb ? ` <span class="pm-lg pm-lg-emb"></span>${esc(t('pm.lg.emb'))}` : ''}</div>
          </div>
          <div class="pm-side-fields">
            <div class="pm-grid4">
              ${['x', 'y', 'w', 'h'].map((q) => fld(`pa.${k}.${q}`, t('pm.pa.' + q), inp(`pa.${k}.${q}`, fx(st[q]), numAttrs({ min: q === 'w' || q === 'h' ? MIN : 0, max: q === 'x' || q === 'w' ? W : H })))).join('')}
            </div>
            <label class="check pm-lock"><input type="checkbox" data-lock="${esc(k)}" data-no-dirty ${lock ? 'checked' : ''}> <span>${esc(t('pm.keepShape'))}</span></label>
            <div class="pm-grid2">
              ${fld(`pw.${k}`, t('pm.printWidth'), inp(`pw.${k}`, fx(st.widthCm), numAttrs({ min: 0.5, max: 1000, need: true })))}
              <div class="field"><div class="pm-lbl"><span class="pm-lbl-text">${esc(t('pm.printHeight'))}</span></div><output class="pm-out" dir="ltr" data-phgt="${esc(k)}">${esc(fx(st.widthCm * st.h / st.w))}</output></div>
              ${fld(`safe.${k}`, t('pm.safe'), inp(`safe.${k}`, fx(st.safeMm), numAttrs({ min: 0, max: 200, need: true })))}
              ${fld(`bleed.${k}`, t('pm.bleed'), inp(`bleed.${k}`, fx(st.bleedMm), numAttrs({ min: 0, max: 50, need: true })))}
            </div>
            <p class="muted small">${esc(t('pm.printSizeHelp'))}</p>
          </div>
        </div>
      </div>`;
  }
  /** Put the side's box, margins and handles where its numbers say. */
  function drawSide(sid, skipInput) {
    const svg = root.querySelector(`svg.pm-pa[data-side="${CSS.escape(sid)}"]`);
    const st = S.sides[sid];
    if (!svg || !st) return;
    const upc = st.w / (st.widthCm || 1); // drawing units per cm
    const safe = (st.safeMm / 10) * upc;
    const bleed = (st.bleedMm / 10) * upc;
    const set = (el, x, y, w, h) => { el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', Math.max(0, w)); el.setAttribute('height', Math.max(0, h)); };
    set(svg.querySelector('[data-r=box]'), st.x, st.y, st.w, st.h);
    set(svg.querySelector('[data-r=safe]'), st.x + safe, st.y + safe, st.w - 2 * safe, st.h - 2 * safe);
    set(svg.querySelector('[data-r=bleed]'), st.x - bleed, st.y - bleed, st.w + 2 * bleed, st.h + 2 * bleed);
    svg.querySelector('[data-r=bleed]').style.display = bleed > 0.2 ? '' : 'none';
    svg.querySelector('[data-r=safe]').style.display = safe > 0.2 ? '' : 'none';
    const pos = { nw: [st.x, st.y], ne: [st.x + st.w, st.y], sw: [st.x, st.y + st.h], se: [st.x + st.w, st.y + st.h], n: [st.x + st.w / 2, st.y], s: [st.x + st.w / 2, st.y + st.h], e: [st.x + st.w, st.y + st.h / 2], w: [st.x, st.y + st.h / 2] };
    svg.querySelectorAll('[data-drag]').forEach((g) => {
      const p = pos[g.dataset.drag];
      if (p) g.setAttribute('transform', `translate(${p[0]} ${p[1]})`);
    });
    for (const q of ['x', 'y', 'w', 'h']) {
      const el = root.querySelector(`[name="${CSS.escape(`pa.${sid}.${q}`)}"]`);
      if (el && el !== skipInput) {
        el.value = fx(st[q]);
        showNum(el);
      }
    }
    const ph = root.querySelector(`[data-phgt="${CSS.escape(sid)}"]`);
    if (ph) ph.textContent = fx((st.widthCm * st.h) / st.w);
  }
  function drawAllSides() {
    if (S.sides) Object.keys(S.sides).forEach((sid) => drawSide(sid));
  }
  /** The box after dragging a handle by (dx, dy) drawing units, kept inside the drawing. */
  function moved(b0, mode, dx, dy, lock) {
    if (mode === 'move') return { x: clamp(b0.x + dx, 0, W - b0.w), y: clamp(b0.y + dy, 0, H - b0.h), w: b0.w, h: b0.h };
    const R = b0.x + b0.w;
    const B = b0.y + b0.h;
    let L = b0.x;
    let T = b0.y;
    let Rr = R;
    let Bb = B;
    if (mode.includes('w')) L = clamp(b0.x + dx, 0, R - MIN);
    if (mode.includes('e')) Rr = clamp(R + dx, L + MIN, W);
    if (mode.includes('n')) T = clamp(b0.y + dy, 0, B - MIN);
    if (mode.includes('s')) Bb = clamp(B + dy, T + MIN, H);
    let w = Rr - L;
    let h = Bb - T;
    if (lock && mode.length === 2) {
      const r = b0.w / b0.h;
      if (w / r > h) h = w / r; else w = h * r;
      const maxW = mode.includes('w') ? R : W - b0.x;
      const maxH = mode.includes('n') ? B : H - b0.y;
      if (w > maxW) { w = maxW; h = w / r; }
      if (h > maxH) { h = maxH; w = h * r; }
      if (w < MIN) { w = MIN; h = w / r; }
      if (h < MIN) { h = MIN; w = h * r; }
      L = mode.includes('w') ? R - w : b0.x;
      T = mode.includes('n') ? B - h : b0.y;
    }
    return { x: r1(L), y: r1(T), w: r1(Math.min(w, W - r1(L))), h: r1(Math.min(h, H - r1(T))) };
  }
  let drag = null;
  function svgPoint(svg, e) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function onPointerDown(e) {
    const h = e.target.closest && e.target.closest('svg.pm-pa [data-drag]');
    if (!h || (e.pointerType === 'mouse' && e.button !== 0) || !editing()) return;
    const svg = h.closest('svg');
    const sid = svg.dataset.side;
    const st = S.sides && S.sides[sid];
    if (!st || st.off) return;
    e.preventDefault();
    drag = { mode: h.dataset.drag, sid, svg, p0: svgPoint(svg, e), b0: { x: st.x, y: st.y, w: st.w, h: st.h }, pid: e.pointerId };
    try { svg.setPointerCapture(e.pointerId); } catch (ex) { /* fine */ }
    svg.classList.add('is-dragging');
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    const p = svgPoint(drag.svg, e);
    const st = S.sides[drag.sid];
    Object.assign(st, moved(drag.b0, drag.mode, p.x - drag.p0.x, p.y - drag.p0.y, S.lock[drag.sid] !== false));
    drawSide(drag.sid);
    setDirty('print');
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.svg.classList.remove('is-dragging');
    const sid = drag.sid;
    drag = null;
    updateSideMark(sid);
  }
  function updateSideMark(sid) {
    const head = root.querySelector(`.pm-side[data-side="${CSS.escape(sid)}"] .pm-side-head`);
    if (!head || !S.P) return;
    const old = head.querySelector('.pm-chg');
    const html = mark(sideChanged(S.P, sid), 'side:' + sid);
    if (old) old.remove();
    if (html) head.insertAdjacentHTML('beforeend', html);
  }
  function onBoxKey(e) {
    const box = e.target.closest && e.target.closest('svg.pm-pa [data-r=box]');
    if (!box || !editing()) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const sid = box.closest('svg').dataset.side;
    const st = S.sides[sid];
    if (st.off) return;
    Object.assign(st, moved({ ...st }, 'move', d[0], d[1], false));
    drawSide(sid);
    setDirty('print');
    updateSideMark(sid);
  }
  function onPrintInput(el, final) {
    const m = /^(pa|pw|safe|bleed|on)\.(.+?)(?:\.([xywh]))?$/.exec(el.name || '');
    if (!m) return false;
    const [, kind, sidRaw, q] = m;
    const sid = kind === 'pa' ? sidRaw : el.name.slice(kind.length + 1);
    const st = S.sides[sid];
    if (!st) return false;
    if (kind === 'on') {
      st.off = !el.checked;
      el.closest('.pm-side').classList.toggle('is-off', st.off);
    } else {
      // Any digits; a box that isn't a number moves nothing (it says why), and the area's boxes go back to it.
      const raw = numText(el);
      const v = Number(raw);
      if (!/^-?\d*\.?\d+$/.test(raw)) { if (final) drawSide(sid); return true; }
      if (kind === 'pa') {
        const box = { x: st.x, y: st.y, w: st.w, h: st.h };
        box[q] = v;
        box.w = clamp(box.w, MIN, W);
        box.h = clamp(box.h, MIN, H);
        box.x = clamp(box.x, 0, W - box.w);
        box.y = clamp(box.y, 0, H - box.h);
        Object.assign(st, box);
        drawSide(sid, final ? null : el);
      } else if (kind === 'pw') {
        if (v >= 0.5) st.widthCm = v;
        drawSide(sid);
      } else if (kind === 'safe') { st.safeMm = clamp(v, 0, 200); drawSide(sid); }
      else if (kind === 'bleed') { st.bleedMm = clamp(v, 0, 50); drawSide(sid); }
    }
    updateSideMark(sid);
    return true;
  }
  function savePrint(P) {
    const sides = {};
    for (const sd of P.sides) {
      const st = S.sides[sd.id];
      sides[sd.id] = { off: st.off, printWidthCm: r2(st.widthCm), safeMm: r2(st.safeMm), bleedMm: r2(st.bleedMm), area: { x: r2(st.x), y: r2(st.y), w: r2(st.w), h: r2(st.h) } };
    }
    if (P.sides.every((sd) => S.sides[sd.id].off)) throw new Error(t('pm.needSide'));
    return { sides };
  }

  // ---------- g) Technology & embroidery ----------
  function techBody(P) {
    const choices = P.processChoices || [P.process];
    const methods = P.methods || [P.process];
    const procChanged = P.process !== P.original.process || (P.original.methods || []).join() !== methods.join();
    const sp = P.embroiderySpec;
    const e = P.edit || {};
    return `
      <div class="pm-grid2">
        ${fld('process', t('pm.process'), `<select id="${fieldId('process')}" name="process" ${choices.length < 2 ? 'disabled' : ''}>${choices.map((c) => `<option value="${c}" ${P.process === c ? 'selected' : ''}>${esc(t('pm.proc.' + c))}</option>`).join('')}</select>`, mark(procChanged, 'process'))}
        ${choices.length > 1 ? `<fieldset class="pm-fs field"><legend class="pm-lbl">${esc(t('pm.methods'))}</legend>
          ${choices.map((c) => `<label class="check"><input type="checkbox" name="m.${c}" ${methods.includes(c) || P.process === c ? 'checked' : ''} ${P.process === c ? 'disabled' : ''}> <span>${esc(t('pm.proc.' + c))}</span></label>`).join('')}
          <p class="muted small">${esc(t(choices.includes('dtg') ? 'pm.methodsHelpGarment' : 'pm.methodsHelp'))}</p></fieldset>` : ''}
      </div>
      ${P.canEmbroider ? `
      <div class="pm-emb">
        <h4>${esc(t('pm.emb'))} ${mark(e.embroidery !== undefined, '')}</h4>
        <label class="check"><input type="checkbox" name="embOn" ${sp ? 'checked' : ''}> <span>${esc(t('pm.embOn'))}</span></label>
        <div class="pm-grid3 pm-emb-fields" ${sp ? '' : 'hidden'}>
          ${fld('embAt', t('pm.embAt'), `<select id="${fieldId('embAt')}" name="embAt">${['chest', 'center', 'top', 'same'].map((a) => `<option value="${a}" ${(sp ? sp.at : 'chest') === a ? 'selected' : ''}>${esc(t('pm.embAt.' + a))}</option>`).join('')}</select>`)}
          ${fld('embW', t('pm.embW'), inp('embW', sp && sp.at !== 'same' ? sp.cm[0] : 9, numAttrs({ min: 1, max: 40, need: true })), '', 'pm-emb-size')}
          ${fld('embH', t('pm.embH'), inp('embH', sp && sp.at !== 'same' ? sp.cm[1] : 9, numAttrs({ min: 1, max: 40, need: true })), '', 'pm-emb-size')}
          ${fld('embPrice', t('pm.embPrice'), inp('embPrice', sp ? sp.surcharge : 150, numAttrs({ min: 0, need: true })))}
          ${fld('embColors', t('pm.embColors'), inp('embColors', sp ? sp.maxColors : 6, numAttrs({ min: 1, max: 15, whole: true, need: true })))}
        </div>
      </div>` : ''}`;
  }
  function saveTech(P) {
    const body = {};
    const choices = P.processChoices || [P.process];
    if (choices.length > 1) {
      body.process = val('process');
      body.methods = choices.filter((c) => c === body.process || val('m.' + c));
    }
    if (P.canEmbroider) {
      if (!val('embOn')) body.embroidery = false;
      else {
        const at = val('embAt');
        const cmW = Number(val('embW'));
        const cmH = Number(val('embH'));
        if (at !== 'same' && !(cmW >= 1 && cmW <= 40 && cmH >= 1 && cmH <= 40)) throw new Error(t('pm.badEmb'));
        body.embroidery = { at, cm: at === 'same' ? [0, 0] : [cmW, cmH], surcharge: Number(val('embPrice')) || 0, maxColors: Number(val('embColors')) || 6 };
      }
    }
    return body;
  }

  // ---------- h) Photos ----------
  function photosBody(P) {
    const photos = P.photos || [];
    const max = (S.data && S.data.maxPhotos) || 12;
    const mainUrl = P.mainPhoto;
    const full = photos.length >= max;
    return `
      <div class="pm-drop ${full ? 'is-full' : ''}" data-pm-drop tabindex="-1">
        <input type="file" id="pm-file" accept="image/jpeg,image/png,image/webp" multiple hidden>
        <p><b>${esc(t(full ? 'pm.photosFull' : 'pm.dropHere'))}</b></p>
        <button type="button" class="btn" data-pm-act="pick-photos" ${full ? 'disabled' : ''}>${esc(t('pm.choosePhotos'))}</button>
        <p class="muted small">${esc(t('pm.photoLimit', { n: POD.num(photos.length), max: POD.num(max) }))}</p>
        <p class="small pm-upload-msg" aria-live="polite"></p>
      </div>
      ${photos.length ? `<ol class="pm-photos">${photos.map((ph, i) => {
        const main = ph.url === mainUrl;
        return `
        <li class="pm-ph ${main ? 'is-main' : ''}" draggable="true" data-photo="${esc(ph.id)}">
          <img src="${esc(ph.url)}" alt="${esc(t('pm.photoN', { n: POD.num(i + 1) }))}" loading="lazy" draggable="false">
          ${main ? `<span class="pm-main-badge">${esc(t('pm.mainPhoto'))}</span>` : ''}
          <div class="pm-ph-btns">
            <button type="button" class="btn btn-sm" data-ph="earlier" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('pm.earlier'))}" title="${esc(t('pm.earlier'))}">${back()}</button>
            ${main ? '' : `<button type="button" class="btn btn-sm" data-ph="main">${esc(t('pm.setMain'))}</button>`}
            <button type="button" class="btn btn-sm" data-ph="later" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="${esc(t('pm.later'))}" title="${esc(t('pm.later'))}">${fwd()}</button>
            <button type="button" class="btn btn-sm btn-danger" data-ph="del" aria-label="${esc(t('pm.delete'))}" title="${esc(t('pm.delete'))}">✕</button>
          </div>
        </li>`;
      }).join('')}</ol>` : `<p class="muted small">${esc(t('pm.noPhotos'))}</p>`}`;
  }
  async function uploadPhotos(files) {
    const P = S.P;
    const max = (S.data && S.data.maxPhotos) || 12;
    let room = max - (P.photos || []).length;
    const list = [...files];
    const msgEl = () => root.querySelector('.pm-upload-msg');
    const bad = list.filter((f) => !PHOTO_TYPES.includes(f.type) || f.size > 15 * 1024 * 1024);
    const ok = list.filter((f) => !bad.includes(f));
    if (bad.length) toast(POD.plural('pm.photoBadType', bad.length), 'error');
    if (!ok.length) return;
    if (ok.length > room) toast(t('pm.photoTooMany', { max: POD.num(max) }), 'error');
    const go = ok.slice(0, Math.max(0, room));
    secError('photos', '');
    let saved = 0;
    for (let i = 0; i < go.length; i += 1) {
      if (msgEl()) msgEl().textContent = t('pm.uploading', { i: POD.num(i + 1), n: POD.num(go.length) });
      try {
        S.P = await api(`/api/admin/catalog/${enc(P.id)}/photos`, { method: 'POST', headers: { 'Content-Type': go[i].type }, body: go[i] });
        putProduct(S.P);
        room -= 1;
        saved += 1;
      } catch (e) {
        // (Each photo sent for an owner's approval: the next one goes too.)
        if (sentForApproval(e)) continue;
        secError('photos', `${go[i].name}: ${e.message}`);
        break;
      }
    }
    if (S.view === 'edit') {
      refreshEdit('photos');
      // ("Saved" only for photos really added: ones sent for approval were said so already.)
      if (saved) toast(t('pm.photosDone'));
    }
    reloadLater();
  }
  async function photoAction(act, id) {
    const P = S.P;
    const ids = P.photos.map((p) => p.id);
    const i = ids.indexOf(id);
    try {
      if (act === 'del') {
        if (!confirm(t('pm.photoDelConfirm'))) return;
        S.P = await api(`/api/admin/catalog/${enc(P.id)}/photos/${enc(id)}`, { method: 'DELETE' });
      } else if (act === 'main') {
        S.P = await send('PUT', `/api/admin/catalog/${enc(P.id)}/photos`, { main: id });
      } else {
        const j = act === 'earlier' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        S.P = await send('PUT', `/api/admin/catalog/${enc(P.id)}/photos`, { order: ids });
      }
      putProduct(S.P);
      refreshEdit('photos');
      reloadLater();
    } catch (e) {
      if (!sentForApproval(e)) secError('photos', e.message);
    }
  }
  async function photoMove(id, beforeId) {
    const P = S.P;
    const ids = P.photos.map((p) => p.id).filter((x) => x !== id);
    const j = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(j < 0 ? ids.length : j, 0, id);
    if (ids.join() === P.photos.map((p) => p.id).join()) return;
    try {
      S.P = await send('PUT', `/api/admin/catalog/${enc(P.id)}/photos`, { order: ids });
      putProduct(S.P);
      refreshEdit('photos');
      reloadLater();
    } catch (e) {
      if (!sentForApproval(e)) secError('photos', e.message);
    }
  }

  // ---------- i) Stop selling / undo ----------
  // Products are never deleted (old orders, accounts and the change log keep naming them):
  // they are archived ("stop selling"), and can be sold again any time.
  function dangerBody(P) {
    const undo = P.builtIn ? `<div class="pm-danger"><div><b>${esc(t('pm.undoAll'))}</b><p class="muted small">${esc(t('pm.undoAllHelp'))}</p></div>
        <button type="button" class="btn btn-danger" data-pm-act="undo-all" ${P.edit ? '' : 'disabled'}>${esc(t('pm.undoAll'))}</button></div>` : '';
    const keep = isArchived(P)
      ? `<div class="pm-danger pm-danger-ok"><div><b>${esc(t('pm.sellAgain'))}</b><p class="muted small">${esc(t('pm.sellAgainHelp'))}</p></div>
        <button type="button" class="btn pm-btn-ok" data-pm-act="sell-again">${esc(t('pm.sellAgain'))}</button></div>`
      : `<div class="pm-danger"><div><b>${esc(t('pm.stopSelling'))}</b><p class="muted small">${esc(t('pm.stopHelp'))}</p></div>
        <button type="button" class="btn btn-danger" data-pm-act="stop">${esc(t('pm.stopSelling'))}</button></div>`;
    return `<div class="pm-dangers">${keep}${undo}</div>`;
  }

  // ---------- Saving a section ----------
  const SAVERS = { basics: saveBasics, avail: saveAvail, colors: saveColors, sizes: saveSizes, prices: savePrices, print: savePrint, tech: saveTech };
  async function save(name) {
    const P = S.P;
    secError(name, '');
    // A number box with a mistake in it: nothing is sent; the box says why, and so does the section.
    const bad = badNum(name);
    if (bad) {
      secError(name, `${boxName(bad.el)}: ${bad.msg}`);
      bad.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      bad.el.focus({ preventScroll: true });
      return;
    }
    let body;
    try {
      body = SAVERS[name](P);
    } catch (e) {
      secError(name, e.message);
      return;
    }
    if (!Object.keys(body).length) {
      setDirty(name, false);
      toast(t('pm.nothing'));
      return;
    }
    const btn = root.querySelector(`[data-pm-save="${name}"]`);
    if (btn) { btn.disabled = true; btn.textContent = t('pm.saving'); }
    try {
      S.P = await send('PUT', `/api/admin/catalog/${enc(P.id)}`, body);
      putProduct(S.P);
      setDirty(name, false);
      if (name === 'basics') S.resets.clear();
      if (name === 'sizes') S.addSizeOpen = false;
      if (name === 'colors') S.addColorOpen = false;
      refreshEdit(name);
      toast(t('pm.saved'));
      reloadLater();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = t('pm.save'); }
      // Sent for an owner's approval: the section keeps what was typed (it isn't live yet), but it's no longer
      // "unsaved" (Save again would only send the same request twice); a new change makes it so again.
      if (sentForApproval(e)) {
        setDirty(name, false);
        if (btn) btn.disabled = true;
        return;
      }
      secError(name, e.message);
    }
  }
  function undo(name) {
    setDirty(name, false);
    initModels(S.P, [name]);
    if (name === 'basics') S.resets.clear();
    rerender(name);
  }

  /** "reset" next to a changed field: put the original back into the form (saved with the section). */
  function reset(key) {
    const P = S.P;
    const [kind, id] = key.split(/:(.*)/s);
    let secName = null;
    if (kind === 'name') {
      root.querySelector('[name="name.en"]').value = P.original.name.en;
      root.querySelector('[name="name.ar"]').value = P.original.name.ar;
      secName = 'basics';
    } else if (kind === 'description' || kind === 'category') {
      S.resets.add(kind);
      secName = 'basics';
      setDirty(secName);
      rerender(secName);
      return;
    } else if (kind === 'stock') {
      root.querySelector('[name=stockMode][value=none]').checked = true;
      syncAvail();
      secName = 'avail';
    } else if (kind === 'color') {
      const c = S.colors.find((x) => x.id === id);
      if (c) c.state = 'on';
      secName = 'colors';
      setDirty(secName);
      rerender(secName);
      return;
    } else if (kind === 'size') {
      readSizeLabels();
      const z = S.sizes.find((x) => x.id === id);
      if (z) { z.state = 'on'; if (z.relabelled) { z.labelEn = ''; z.labelAr = ''; } }
      setDirty('sizes');
      rerender('sizes');
      return;
    } else if (kind === 'side') {
      const o = origSide(P, id);
      if (o) Object.assign(S.sides[id], { ...o.printArea, widthCm: o.printWidthCm, safeMm: o.safeMm, bleedMm: o.bleedMm, off: false });
      setDirty('print');
      rerender('print');
      drawAllSides();
      return;
    } else if (kind === 'process') {
      const sel = root.querySelector('[name=process]');
      sel.value = P.original.process;
      for (const c of P.processChoices) {
        const cb = root.querySelector(`[name="m.${c}"]`);
        if (cb) { cb.checked = (P.original.methods || []).includes(c) || c === P.original.process; cb.disabled = c === P.original.process; }
      }
      secName = 'tech';
    } else if (kind === 'prices') {
      root.querySelectorAll('#pm-sec-prices input[data-num]').forEach((el) => { el.value = ''; });
      updateFinals();
      showNums(document.getElementById('pm-sec-prices'));
      secName = 'prices';
    }
    if (secName) setDirty(secName);
  }
  function syncAvail() {
    const mode = val('stockMode') || 'none';
    const sf = root.querySelector('.pm-stock-fields');
    if (sf) sf.hidden = mode === 'none';
    const whole = root.querySelector('.pm-stock-whole');
    if (whole) whole.classList.toggle('is-hidden', mode !== 'whole');
    const vs = root.querySelector('.pm-vs');
    if (vs) vs.hidden = mode !== 'variant';
    const sh = root.querySelector('[data-pm-stock-help]');
    if (sh) sh.textContent = stockHelp(mode);
    if (mode === 'whole' && root.querySelector('[name=stock]').value === '') root.querySelector('[name=stock]').value = '0';
    syncVariant();
  }

  // =====================================================================
  // Events
  // =====================================================================
  function onClick(e) {
    const a = e.target.closest('[data-pm-act], [data-pm-save], [data-pm-undo], [data-pm-reset], [data-pm-filter], [data-ph], [data-pm-jump]');
    if (!a || !root.contains(a)) return;
    if (a.dataset.pmJump) {
      e.preventDefault();
      const el = document.getElementById('pm-sec-' + a.dataset.pmJump);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (a.dataset.pmFilter) {
      S.filter = a.dataset.pmFilter;
      renderRows();
      return;
    }
    if (a.dataset.pmSave) return save(a.dataset.pmSave);
    if (a.dataset.pmUndo) return undo(a.dataset.pmUndo);
    if (a.dataset.pmReset) return reset(a.dataset.pmReset);
    if (a.dataset.ph) {
      const li = a.closest('[data-photo]');
      return photoAction(a.dataset.ph, li.dataset.photo);
    }
    const act = a.dataset.pmAct;
    const id = a.dataset.id;
    const p = id ? products().find((x) => x.id === id) || (S.P && S.P.id === id ? S.P : null) : S.P;
    const afterQuick = (P) => {
      if (S.view === 'list') renderRows();
      else if (S.P && S.P.id === P.id) refreshStatus(P);
    };
    switch (act) {
      case 'new': return newDialog(null);
      case 'copy': return newDialog(p);
      case 'edit': return openEdit(id);
      case 'back': return backToList() && history.state && history.state.pm ? history.back() : undefined;
      case 'pause': return pauseDialog(p, afterQuick);
      case 'stop': return stopDialog(p, afterQuick);
      case 'show':
      case 'sell-again': return showInShop(p, afterQuick);
      case 'publish': return showInShop(S.P, afterQuick);
      case 'staff':
        S.staffOpen = !S.staffOpen;
        a.setAttribute('aria-expanded', S.staffOpen);
        return renderStaff();
      case 'gen-pw': {
        const el = document.getElementById(a.dataset.for);
        if (el) { el.value = genPassword(); el.type = 'text'; }
        return undefined;
      }
      case 'copy-cred': {
        const c = S.newStaff;
        const txt = `${location.origin}/admin\n${t('pm.staff.username')}: ${c.username}\n${t('pm.staff.password')}: ${c.password}`;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(t('pm.staff.copied')), () => toast(txt));
        return undefined;
      }
      case 'hide-cred':
        S.newStaff = null;
        return renderStaff();
      case 'staff-pw': return staffPwDialog(S.staff.find((u) => u.id === id));
      case 'staff-del': {
        const u = S.staff.find((x) => x.id === id);
        if (!u || !confirm(t('pm.staff.delConfirm', { name: u.name }))) return undefined;
        return api(`/api/admin/staff/${enc(id)}`, { method: 'DELETE' }).then(() => { toast(t('pm.staff.removed', { name: u.name })); return loadStaff(); }, (ex) => toast(ex.message, 'error'));
      }
      case 'preview-hex':
        S.previewHex = a.dataset.hex;
        rerender('print');
        drawAllSides();
        return undefined;
      case 'pick-photos': return root.querySelector('#pm-file').click();
      case 'add-color': return addColor();
      case 'del-color':
        S.colors = S.colors.filter((c) => c.id !== id);
        setDirty('colors');
        return rerender('colors');
      case 'add-size': return addSize();
      case 'del-size':
        readSizeLabels();
        S.sizes = S.sizes.filter((z) => z.id !== id);
        setDirty('sizes');
        return rerender('sizes');
      case 'vs-all': {
        const el = root.querySelector('[name=vsAll]');
        const n = el ? numText(el) : '';
        secError('avail', '');
        if (n === '') { secError('avail', t('pm.vs.needN')); if (el) el.focus(); return undefined; }
        if (!/^\d+$/.test(n)) return secError('avail', t('pm.badStock'));
        root.querySelectorAll('.pm-vs .pm-vs-in').forEach((x) => { x.value = String(Number(n)); });
        setDirty('avail');
        return syncVariant();
      }
      case 'vs-clear':
        root.querySelectorAll('.pm-vs .pm-vs-in').forEach((x) => { x.value = ''; });
        setDirty('avail');
        return syncVariant();
      case 'undo-all': return undoAll();
      default: return undefined;
    }
  }

  function addColor() {
    const ar = val('nc.ar').trim();
    const en = val('nc.en').trim();
    const hex = String(val('nc.hex') || '').toLowerCase();
    secError('colors', '');
    if (!ar || !en) return secError('colors', t('pm.needNames'));
    let id = slug(en) || 'colour';
    const taken = new Set(S.colors.map((c) => c.id));
    if (taken.has(id)) { let i = 2; while (taken.has(`${id}-${i}`)) i += 1; id = `${id}-${i}`; }
    S.colors.push({ id, name: { en, ar }, hex, added: true, state: 'on' });
    S.addColorOpen = true;
    setDirty('colors');
    rerender('colors');
    return undefined;
  }
  function addSize() {
    readSizeLabels();
    const id = val('ns.id').trim();
    const ar = val('ns.ar').trim() || id;
    const en = val('ns.en').trim() || id;
    const add = Number(val('ns.add') || 0);
    const scaleRaw = val('ns.scale');
    const scale = scaleRaw === '' ? null : Number(scaleRaw);
    secError('sizes', '');
    if (!/^[A-Za-z0-9][A-Za-z0-9x.-]{0,19}$/.test(id)) return secError('sizes', t('pm.badSizeId'));
    // The add-on and the print scale: any digits, and a wrong one says why (it used to read as nothing).
    for (const el of [root.querySelector('[name="ns.add"]'), root.querySelector('[name="ns.scale"]')]) {
      const msg = el && showNum(el);
      if (msg) {
        el.focus();
        return secError('sizes', `${boxName(el)}: ${msg}`);
      }
    }
    if (S.sizes.some((z) => z.id === id)) return secError('sizes', t('pm.sizeTaken'));
    if (!Number.isFinite(add)) return secError('sizes', t('pm.badPrice'));
    if (scale !== null && !(scale >= 0.1 && scale <= 10)) return secError('sizes', t('pm.badScale'));
    S.sizes.push({ id, label: { en, ar }, labelEn: en, labelAr: ar, added: true, state: 'on', surcharge: add, addedSurcharge: add, printScale: scale && scale !== 1 ? scale : null });
    S.addSizeOpen = true;
    setDirty('sizes');
    rerender('sizes');
    return undefined;
  }
  async function undoAll() {
    if (!confirm(t('pm.undoAllConfirm', { name: tr(S.P.name) }))) return;
    try {
      S.P = await api(`/api/admin/catalog/${enc(S.P.id)}`, { method: 'DELETE' });
      putProduct(S.P);
      S.dirty.clear();
      S.resets.clear();
      initModels(S.P, SECTIONS);
      renderEdit();
      toast(t('pm.undoAllDone'));
      reloadLater();
    } catch (e) {
      if (!sentForApproval(e)) secError('danger', e.message);
    }
  }
  function onInput(e) {
    const el = e.target;
    if (!root.contains(el)) return;
    if (el.id === 'pm-q') {
      S.q = el.value;
      renderRows();
      return;
    }
    if (el.dataset && el.dataset.lock) { S.lock[el.dataset.lock] = el.checked; return; }
    if (el.name === 'nc.hex') { const o = root.querySelector('[data-hex-out]'); if (o) o.textContent = el.value; }
    if (el.matches('input[data-num]')) showNum(el);
    if (el.dataset && el.dataset.noDirty !== undefined) return;
    const secEl = el.closest('[data-sec]');
    if (!secEl) return;
    const name = secEl.dataset.sec;
    if (name === 'print') onPrintInput(el, e.type === 'change');
    if (name === 'colors' && el.name.startsWith('c.')) {
      const c = S.colors.find((x) => 'c.' + x.id === el.name);
      if (c) { c.state = el.value; el.closest('.pm-opt').className = `pm-opt ${c.state !== 'on' ? 'is-' + c.state : ''}`; }
    }
    if (name === 'sizes' && el.name.startsWith('z.')) {
      const z = S.sizes.find((x) => 'z.' + x.id === el.name);
      if (z) { z.state = el.value; el.closest('.pm-opt').className = `pm-opt pm-size ${z.state !== 'on' ? 'is-' + z.state : ''}`; }
    }
    if (name === 'avail') syncAvail();
    if (name === 'prices') updateFinals();
    if (name === 'tech') {
      if (el.name === 'process') {
        root.querySelectorAll('#pm-sec-tech input[name^="m."]').forEach((cb) => {
          const c = cb.name.slice(2);
          cb.disabled = c === el.value;
          if (c === el.value) cb.checked = true;
        });
      }
      const ef = root.querySelector('.pm-emb-fields');
      if (ef) ef.hidden = !val('embOn');
      root.querySelectorAll('.pm-emb-size').forEach((f) => { f.hidden = val('embAt') === 'same'; });
    }
    if (name === 'photos' || name === 'danger') return;
    setDirty(name);
  }

  function onChange(e) {
    const el = e.target;
    if (!root.contains(el)) return;
    if (el.id === 'pm-cat') { S.cat = el.value; renderRows(); return; }
    // The search box was handled as it was typed. Redrawing the list again when it loses focus
    // (on the press of a row's button) would swallow that click.
    if (el.id === 'pm-q') return;
    if (el.id === 'pm-file') { if (el.files.length) uploadPhotos(el.files); el.value = ''; return; }
    if (el.closest('[data-sec="print"]') && el.name) {
      if (onPrintInput(el, true)) setDirty('print');
    } else onInput(e);
  }

  // Photos: drop files on the drop zone; drag thumbnails to reorder.
  let dragPhoto = null;
  function onDragOver(e) {
    if (!editing()) return;
    const zone = e.target.closest && e.target.closest('[data-pm-drop]');
    const li = e.target.closest && e.target.closest('.pm-ph');
    if (zone && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      zone.classList.add('is-over');
    } else if (li && dragPhoto) {
      e.preventDefault();
      root.querySelectorAll('.pm-ph.is-target').forEach((x) => x !== li && x.classList.remove('is-target'));
      li.classList.add('is-target');
    }
  }
  function onDragLeave(e) {
    const zone = e.target.closest && e.target.closest('[data-pm-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
  }
  function onDrop(e) {
    // (Looking only: a file dropped here is neither sent nor opened in the tab.)
    if (!editing()) return void e.preventDefault();
    const zone = e.target.closest && e.target.closest('[data-pm-drop]');
    const li = e.target.closest && e.target.closest('.pm-ph');
    if (zone && e.dataTransfer && e.dataTransfer.files.length) {
      e.preventDefault();
      zone.classList.remove('is-over');
      uploadPhotos(e.dataTransfer.files);
    } else if (li && dragPhoto) {
      e.preventDefault();
      const from = dragPhoto;
      dragPhoto = null;
      if (from !== li.dataset.photo) photoMove(from, li.dataset.photo);
    }
  }

  // =====================================================================
  // Public
  // =====================================================================
  function init(c) {
    ctx = c;
    root = document.getElementById('pm-root');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('keydown', onBoxKey);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragstart', (e) => {
      const li = e.target.closest && e.target.closest('.pm-ph');
      if (!li) return;
      dragPhoto = li.dataset.photo;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragPhoto); } catch (ex) { /* fine */ }
    });
    root.addEventListener('dragend', () => { dragPhoto = null; root.querySelectorAll('.is-target').forEach((x) => x.classList.remove('is-target')); });
    // Dropping a file outside the drop zone should not open it in the tab.
    document.addEventListener('dragover', (e) => { if (S.view === 'edit' && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (S.view === 'edit' && !(e.target.closest && e.target.closest('[data-pm-drop]'))) e.preventDefault(); });
    window.addEventListener('popstate', () => {
      if (S.view === 'edit' && !(history.state && history.state.pm)) {
        if (!backToList()) { try { history.pushState({ pm: S.P.id }, '', '#product=' + enc(S.P.id)); } catch (e) { /* fine */ } }
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (S.view === 'edit' && S.dirty.size) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /** The tab opened (or the 15 s refresh): load once, then leave the screen alone while it's in use. */
  async function show({ auto = false } = {}) {
    if (!root) return;
    if (auto) {
      // Quiet refresh of the list only (never while editing or typing).
      if (S.view !== 'list' || !S.data || Date.now() - S.loadedAt < 60000) return;
      const ae = document.activeElement;
      if (ae && root.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
      await load(true);
      renderRows();
      renderLog();
      return;
    }
    if (S.view === 'edit' && S.P) return;
    if (!S.data) renderList();
    await load(Boolean(S.data) && Date.now() - S.loadedAt > 60000);
    const m = /#product=([a-z0-9-]+)/.exec(location.hash);
    if (m && products().some((p) => p.id === m[1] && canEdit(p))) {
      history.replaceState(null, '', location.pathname + location.search);
      return openEdit(m[1]);
    }
    renderList();
    return undefined;
  }

  function onLang() {
    if (!root || !S.data) return;
    if (S.view === 'list') {
      renderList();
      return;
    }
    // Keep what was typed in sections not saved yet.
    const keep = {};
    root.querySelectorAll('[data-sec] [name]').forEach((el) => {
      const sname = el.closest('[data-sec]').dataset.sec;
      if (!S.dirty.has(sname)) return;
      if (el.type === 'radio') { if (el.checked) keep[el.name] = el.value; } else keep[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    if (S.sizes) readSizeLabels();
    renderEdit();
    for (const [k, v] of Object.entries(keep)) {
      root.querySelectorAll(`[name="${CSS.escape(k)}"]`).forEach((el) => {
        if (el.type === 'radio') el.checked = el.value === v;
        else if (el.type === 'checkbox') el.checked = v;
        else if (!/^(sl\.|pa\.|pw\.|safe\.|bleed\.)/.test(k)) el.value = v;
      });
    }
    if (S.dirty.has('avail')) syncAvail();
    if (S.dirty.has('prices')) updateFinals();
    drawAllSides();
    showNums();
  }

  function reset_() {
    S.data = null;
    S.P = null;
    S.view = 'list';
    S.staff = null;
    S.staffOpen = false;
    S.newStaff = null;
    S.dirty.clear();
    if (root) root.innerHTML = '';
  }

  window.AdminProducts = { init, show, onLang, reset: reset_, busy: () => S.view === 'edit' && S.dirty.size > 0, packWarnHtml };
})();
