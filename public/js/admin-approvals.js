/*
 * Admin → Approvals (owners) / My requests (everyone else).
 * Changes a non-owner makes to products or money wait here until an owner approves or rejects them (with an
 * optional note); after approving, the result shows (live now, or failed with the reason). The others see their
 * own requests with what happened to each, and can cancel one still waiting.
 * Server: GET /api/admin/approvals?status=pending|all, POST /api/admin/approvals/:id/approve|reject { note },
 * DELETE /api/admin/approvals/:id (the requester cancels).
 * admin.js calls AdminApprovals.init({ api, access, counted }) once (counted(n): the tab's badge), then
 * show({ auto }) when the tab opens or refreshes, onLang(), reset().
 */
window.AdminApprovals = (() => {
  'use strict';

  const { esc, t } = POD;
  const $ = (id) => document.getElementById(id);
  const box = () => $('tab-approvals');
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  let cfg = null;
  let bound = false;
  const S = {
    view: 'pending', // owners: 'pending' (waiting first) or 'all'
    list: null,
    error: '',
    decided: new Map(), // id -> approval decided here: stays on screen with its result until the tab is opened again
    note: {}, // id -> note typed
    msg: {}, // id -> { text, ok }
    busy: new Set(),
    sig: '',
  };

  const owner = () => Boolean(cfg && cfg.access() && cfg.access().owner);
  const inLang = (v) => AdminRoles.inLang(v);
  const when = (iso) => AdminRoles.cairoTime(iso);
  const roleNames = (roles) => (roles || []).filter((r) => AdminRoles.ROLES.includes(r)).map((r) => t('role.' + r)).join(POD.lang === 'ar' ? '، ' : ', ');
  /** Waiting ones first, then the newest. */
  const order = (a, b) => (open(a) !== open(b) ? (open(a) ? -1 : 1) : String(b.at || '').localeCompare(String(a.at || '')));
  function shown() {
    const list = (S.list || []).map((a) => S.decided.get(a.id) || a);
    // Decided here while "Waiting" is shown: kept on screen with the result.
    for (const [id, a] of S.decided) if (!list.some((x) => x.id === id)) list.push(a);
    return list.sort(order);
  }
  // (Still to decide: waiting ones, and ones that failed when approved: those can be approved again or refused.)
  const open = (a) => a.status === 'pending' || a.status === 'failed' || a.status === 'applying';
  const waitingCount = () => shown().filter(open).length;

  // ---------- Drawing ----------
  function decidedHtml(a) {
    // (The shared password's sign-in: "Owner (emergency login)", not its id.)
    const by = a.decidedBy && (a.decidedBy.id === 'owner' ? t('me.emergencyName') : a.decidedBy.name);
    const status = t('ap.st.' + a.status);
    // (The name in its own direction: "Nour نور" next to the date stays in one piece.)
    const line = by ? t('ap.decidedBy', { status, name: `\u2068${by}\u2069`, when: when(a.decidedAt) }) : a.decidedAt ? `${status}${POD.sep()}${when(a.decidedAt)}` : status;
    return `
      <div class="ap-result">
        <p class="small ap-decided">${esc(line)}</p>
        ${a.note ? `<p class="small ap-note" dir="auto">${esc(t('ap.ownerNote', { note: inLang(a.note) }))}</p>` : ''}
        ${a.error ? `<p class="small ap-error" dir="auto">${esc(t('ap.error', { error: inLang(a.error) }))}</p>` : ''}
      </div>`;
  }
  function decideHtml(a) {
    const id = esc(a.id);
    const busy = S.busy.has(a.id) ? 'disabled' : '';
    return `
      <div class="ap-decide">
        <label class="small" for="ap-note-${id}"><b>${esc(t('ap.note'))}</b></label>
        <textarea id="ap-note-${id}" data-ap-note="${id}" rows="2" maxlength="500" dir="auto" placeholder="${esc(t('ap.notePh'))}">${esc(S.note[a.id] || '')}</textarea>
        <div class="ap-btns">
          <button class="btn btn-primary" type="button" data-ap-act="approve" data-ap-id="${id}" ${busy}>✓ ${esc(t('ap.approve'))}</button>
          <button class="btn" type="button" data-ap-act="reject" data-ap-id="${id}" ${busy}>✕ ${esc(t('ap.reject'))}</button>
        </div>
      </div>`;
  }
  function itemHtml(a) {
    const st = ['pending', 'approved', 'rejected', 'cancelled', 'failed'].includes(a.status) ? a.status : 'pending';
    const mine = !owner();
    // The values asked for, field by field (server: changes); older answers: the details text.
    const changes = Array.isArray(a.changes) && a.changes.length
      ? `<dl class="ap-changes">${a.changes.map((c) => `<dt>${esc(inLang(c.field))}</dt><dd dir="auto">${esc(inLang(c.value))}</dd>`).join('')}</dl>` : '';
    const details = changes ? '' : inLang(a.details);
    const m = S.msg[a.id];
    const roles = roleNames(a.roles);
    return `
      <article class="card ap-item ap-st-${st}" id="ap-${esc(a.id)}" data-ap="${esc(a.id)}">
        <div class="ap-head">
          <span class="ro-pill ap-pill-${st}">${esc(t('ap.st.' + st))}</span>
          ${mine ? '' : `<b dir="auto">${esc((a.by && a.by.name) || '')}</b>${roles ? `<span class="muted small">${esc(roles)}</span>` : ''}`}
          <span class="muted small ap-when">${esc(t('ap.sentAt', { when: when(a.at) }))}</span>
        </div>
        <p class="ap-summary" dir="auto">${esc(inLang(a.summary) || a.action || '')}</p>
        ${a.changedSince && open(a) ? `<p class="small ap-changed" role="note">⚠ ${esc(t('ap.changedSince'))}</p>` : ''}
        ${a.thumb && /^data:image\/webp;base64,/.test(a.thumb) ? `<button type="button" class="ap-thumb-btn" data-ap-zoom aria-pressed="false" title="${esc(t('ap.photoZoom'))}"><img class="ap-thumb" src="${esc(a.thumb)}" alt="${esc(t('ap.photoAlt'))}" loading="lazy"></button>` : ''}
        ${changes ? `<div class="ap-details"><div class="muted small">${esc(t('ap.details'))}</div>${changes}</div>` : ''}
        ${details ? `<div class="ap-details"><div class="muted small">${esc(t('ap.details'))}</div><div class="ap-details-text" dir="auto">${esc(details)}</div></div>` : ''}
        ${st !== 'pending' ? decidedHtml(a) : ''}
        ${!open(a) ? '' : mine ? `<div class="ap-btns"><button class="btn btn-sm" type="button" data-ap-act="cancel" data-ap-id="${esc(a.id)}" ${S.busy.has(a.id) ? 'disabled' : ''}>${esc(t('ap.cancel'))}</button></div>` : decideHtml(a)}
        ${m ? `<p class="ro-msg ${m.ok ? 'ok' : 'bad'}" aria-live="polite">${esc(m.text)}</p>` : ''}
      </article>`;
  }
  function render() {
    const el = box();
    if (!el) return;
    const own = owner();
    const list = shown();
    const n = waitingCount();
    const chips = own ? `<div class="chips ap-chips" role="group">${['pending', 'all'].map((v) => `<button type="button" class="chip ${S.view === v ? 'active' : ''}" data-ap-view="${v}" aria-pressed="${S.view === v}">${esc(t('ap.f.' + v))}${v === 'pending' ? ` <span class="rd-chip-n">${esc(POD.num(n))}</span>` : ''}</button>`).join('')}</div>` : '';
    const empty = own ? (S.view === 'pending' ? 'ap.none' : 'ap.noneAll') : 'ap.noneMine';
    el.innerHTML = `
      <div class="card ro-card ap-top">
        <p class="muted small" style="margin:0 0 ${own ? '10px' : '0'}">${esc(t(own ? 'ap.help' : 'ap.helpMine'))}</p>
        ${chips}
      </div>
      ${S.error ? `<p class="notice">${esc(S.error)}</p>` : ''}
      <div class="ap-list">${!S.list && !S.error ? `<div class="card empty"><p class="muted">${esc(t('pm.loading'))}</p></div>`
        : list.length ? list.map(itemHtml).join('') : `<div class="card empty ap-empty"><p class="muted">${esc(t(empty))}</p></div>`}</div>`;
    S.sig = JSON.stringify(S.list);
  }

  // ---------- Server ----------
  async function load() {
    const status = owner() ? S.view : 'all';
    try {
      const r = await cfg.api(`/api/admin/approvals?status=${status}`);
      S.list = Array.isArray(r && r.approvals) ? r.approvals : [];
      S.error = '';
    } catch (e) {
      if (e.status === 401) throw e;
      S.error = e.message;
    }
    if (S.list && cfg.counted) cfg.counted(waitingCount());
  }
  async function act(id, what) {
    const a = shown().find((x) => x.id === id);
    if (!a || S.busy.has(id)) return;
    if (what === 'cancel' && !confirm(t('ap.confirmCancel'))) return;
    const note = (S.note[id] || '').trim();
    S.busy.add(id);
    S.msg[id] = { text: t('ap.working'), ok: true };
    render();
    try {
      const r = what === 'cancel'
        ? await cfg.api(`/api/admin/approvals/${encodeURIComponent(id)}`, { method: 'DELETE' })
        : await cfg.api(`/api/admin/approvals/${encodeURIComponent(id)}/${what}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(note ? { note } : {}) });
      const next = (r && r.approval) || { ...a, status: what === 'approve' ? 'approved' : what === 'reject' ? 'rejected' : 'cancelled' };
      S.decided.set(id, { ...a, ...next });
      delete S.note[id];
      // After approving: live now, or approved but it failed (with the reason).
      S.msg[id] = next.status === 'failed'
        ? { text: t('ap.failed', { error: inLang(next.error) || '—' }), ok: false }
        : { text: t(next.status === 'approved' ? 'ap.approved' : next.status === 'rejected' ? 'ap.rejected' : 'ap.cancelled'), ok: next.status !== 'failed' };
    } catch (e) {
      if (e.status !== 401) S.msg[id] = { text: e.message, ok: false };
    }
    S.busy.delete(id);
    render();
    if (cfg.counted) cfg.counted(waitingCount());
  }

  function bind() {
    const el = box();
    if (!el || bound) return;
    bound = true;
    el.addEventListener('click', (e) => {
      const v = e.target.closest('[data-ap-view]');
      if (v && v.dataset.apView !== S.view) {
        S.view = v.dataset.apView;
        S.decided.clear();
        S.list = null;
        render();
        load().then(render).catch(() => {});
        return;
      }
      // A waiting photo: tap to see it bigger, tap again for the small one.
      const z = e.target.closest('[data-ap-zoom]');
      if (z) {
        z.setAttribute('aria-pressed', String(z.classList.toggle('big')));
        return;
      }
      const b = e.target.closest('[data-ap-act]');
      if (b) act(b.dataset.apId, b.dataset.apAct);
    });
    el.addEventListener('input', (e) => {
      const id = e.target.dataset && e.target.dataset.apNote;
      if (id) S.note[id] = e.target.value;
    });
  }

  return {
    init(c) {
      cfg = c;
      bind();
    },
    async show({ auto = false } = {}) {
      bind();
      // (A note being typed: the 15-second refresh leaves the tab as it is.)
      const el = box();
      if (auto && el && el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
      // Opened again: what was decided before is read from the server like the rest.
      if (!auto) {
        S.decided.clear();
        S.msg = {};
      }
      await load();
      if (auto && JSON.stringify(S.list) === S.sig) return;
      render();
    },
    onLang() {
      if (box() && (S.list || S.error)) render();
    },
    reset() {
      S.view = 'pending';
      S.list = null;
      S.error = '';
      S.decided.clear();
      S.note = {};
      S.msg = {};
      S.busy.clear();
      S.sig = '';
      if (box()) box().innerHTML = '';
    },
  };
})();
