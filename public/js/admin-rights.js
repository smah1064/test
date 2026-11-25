/*
 * Admin → Rights requests (owner only): people who say a design uses their work, sent from the /rights page
 * (POST /api/takedown). GET /api/admin/takedowns lists them newest first with the number still open; PATCH
 * /api/admin/takedowns/:id { status: 'new'|'done', note } marks one handled (or open again) with the owner's note.
 * admin.js calls AdminRights.init({ api, goToDesign }) once, show() when the tab opens (/admin#rights, the link in
 * the owner's WhatsApp alert), count() on the dashboard's refresh for the tab's badge, onLang() on a language
 * switch and reset() on signing out. Everything it shows lives in #tab-rights; everything the visitor typed is
 * escaped and shown as text (links only for an http(s) link, an email or a phone number).
 */
window.AdminRights = (() => {
  const { t, esc } = POD;
  const $ = (id) => document.getElementById(id);
  let api = null;
  let goToDesign = null;
  let data = null; // { takedowns, open }
  let error = '';
  let drawnSig = '';
  const notes = {}; // id -> note being typed (kept through a redraw)
  const msgs = {}; // id -> { text, ok }
  const busy = new Set();
  // Ready designs by id (for "Find it in Ready designs"), read when a request links to one.
  let designs = null;
  let designsAt = 0;

  const box = () => $('tab-rights');
  const isOpen = (r) => r.status !== 'done';

  // ---------- What the visitor typed, made useful ----------
  /** Any digits as 0-9, without the spaces, dashes and marks phones add. */
  const digitsOf = (s) => POD.latinDigits(s).replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2060-\u2069\u00a0]/g, '');
  /**
   * A phone number in the contact text: { tel, wa } (wa '' for a landline). Egyptian mobiles in any form
   * (010…, +20 10…, ٠١٠…), Egyptian landlines (02…), numbers with a country code (+971…, 00966…).
   */
  function phoneOf(text) {
    const d = digitsOf(text);
    let m = /^(?:\+|00)?(?:20)?0?(1[0125]\d{8})$/.exec(d);
    if (m) return { tel: '+20' + m[1], wa: '20' + m[1], shown: '0' + m[1] };
    m = /^(?:\+|00)([1-9]\d{7,14})$/.exec(d);
    if (m && !m[1].startsWith('20')) return { tel: '+' + m[1], wa: m[1], shown: '+' + m[1] };
    m = /^(?:(?:\+|00)20|0)([2-9]\d{7,8})$/.exec(d);
    if (m) return { tel: '+20' + m[1], wa: '', shown: '0' + m[1] };
    return null;
  }
  const EMAIL_RE = /[^\s@,;:<>()"'،؛]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g;
  /** The emails and phone numbers in "mona@x.com / 0100 123 4567". */
  function contactsOf(text) {
    const s = String(text || '');
    const emails = [...new Set(s.match(EMAIL_RE) || [])];
    const rest = s.replace(EMAIL_RE, ' ');
    const phones = [];
    for (const part of POD.latinDigits(rest).match(/[+]?\d[\d\s\-().\u200e\u200f]{6,}\d/g) || []) {
      const p = phoneOf(part);
      if (p && !phones.some((x) => x.tel === p.tel)) phones.push(p);
    }
    return { emails, phones };
  }
  /** An http(s) address (a bare "ebda3.me/design?id=…" too), or null for anything else (an order number…). */
  function urlOf(text) {
    const s = String(text || '').trim();
    if (!s || /\s/.test(s)) return null;
    const withScheme = /^https?:\/\//i.test(s) ? s : /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(s) ? 'https://' + s : '';
    if (!withScheme) return null;
    try {
      const u = new URL(withScheme);
      return /^https?:$/.test(u.protocol) ? u : null;
    } catch (e) {
      return null;
    }
  }
  /** A ready design of the shop the link points at (/design?id=…), when it is one. */
  function designOf(u) {
    if (!u || !designs) return null;
    if (!/^\/design(?:\.html)?\/?$/.test(u.pathname)) return null;
    return designs.get(u.searchParams.get('id') || '') || null;
  }
  const needDesigns = () => (data ? data.takedowns : []).some((r) => {
    const u = urlOf(r.link);
    return u && /^\/design(?:\.html)?\/?$/.test(u.pathname) && u.searchParams.get('id');
  });
  async function loadDesigns() {
    if (!needDesigns() || (designs && Date.now() - designsAt < 5 * 60e3)) return;
    try {
      const lib = await api('/api/admin/library');
      designs = new Map((lib.designs || []).map((d) => [d.id, { id: d.id, name: d.name, deleted: Boolean(d.deleted) }]));
      designsAt = Date.now();
    } catch (e) {
      if (e.status === 401) throw e;
    }
  }

  // ---------- Drawing ----------
  const shortLink = (s) => (s.length > 80 ? s.slice(0, 77) + '…' : s);
  function contactHtml(r) {
    const { emails, phones } = contactsOf(r.contact);
    const acts = [
      ...emails.map((e) => `<a class="btn btn-sm" href="mailto:${esc(encodeURIComponent(e).replace(/%40/g, '@'))}">✉️ ${esc(t('tk.email'))}</a>`),
      ...phones.flatMap((p) => [
        `<a class="btn btn-sm" href="tel:${esc(p.tel)}">📞 ${esc(t('tk.call'))} <bdi dir="ltr">${esc(p.shown)}</bdi></a>`,
        p.wa ? `<a class="btn btn-sm tk-wa" href="https://wa.me/${esc(p.wa)}" target="_blank" rel="noopener noreferrer">${esc(t('tk.whatsapp'))}</a>` : '',
      ]),
    ].filter(Boolean);
    return `${ltrText(r.contact)}${acts.length ? `<div class="tk-acts-inline">${acts.join('')}</div>` : ''}`;
  }
  /**
   * An email or a phone number as typed (the form's box is left to right): left to right on both pages, each
   * word isolated so "٠١٠ ١٢٣٤ ٥٦٧٨" keeps its order (Arabic-Indic digit groups otherwise swap places).
   * With Arabic words in it, its own direction.
   */
  function ltrText(s) {
    const str = String(s || '');
    if (/[\u0600-\u065F\u066E-\u06EF\u06FA-\u06FF]/.test(str)) return `<bdi dir="auto" class="tk-text">${esc(str)}</bdi>`;
    return `<bdi dir="ltr" class="tk-text">${str.split(/(\s+)/).map((x, i) => (i % 2 ? esc(x) : x ? `<bdi>${esc(x)}</bdi>` : '')).join('')}</bdi>`;
  }
  function linkHtml(r) {
    const u = urlOf(r.link);
    if (!u) return `<bdi dir="auto" class="tk-text">${esc(r.link)}</bdi>`;
    const d = designOf(u);
    return `<a class="tk-link" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr" title="${esc(t('tk.newTab'))}">${esc(shortLink(r.link))} ↗</a>${d ? `<div class="tk-acts-inline"><button class="btn btn-sm" type="button" data-tk-design="${esc(d.id)}">${esc(t('tk.findDesign', { name: POD.tr(d.name) || d.id }))}</button></div>` : ''}`;
  }
  function row(r) {
    const open = isOpen(r);
    const m = msgs[r.id];
    const note = notes[r.id] !== undefined ? notes[r.id] : r.note || '';
    const facts = [
      ['tk.from', `<bdi dir="auto" class="tk-text">${esc(r.name)}</bdi>`],
      ['tk.contact', contactHtml(r)],
      r.owner ? ['tk.owner', `<bdi dir="auto" class="tk-text">${esc(r.owner)}</bdi>`] : null,
      r.link ? ['tk.link', linkHtml(r)] : null,
    ].filter(Boolean);
    return `
      <article class="card tk-item ${open ? 'is-open' : 'is-done'}" id="tk-${esc(r.id)}" data-tk="${esc(r.id)}">
        <div class="tk-head">
          <span class="pill tk-state ${open ? 'tk-new' : 'tk-done'}">${esc(t(open ? 'tk.state.new' : 'tk.state.done'))}</span>
          <span class="muted small">${esc(t('tk.sent', { when: POD.date(r.at) }))}${!open && r.doneAt ? `${esc(POD.sep())}${esc(t('tk.doneAt', { when: POD.date(r.doneAt) }))}` : ''}</span>
        </div>
        <dl class="tk-facts">${facts.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`).join('')}</dl>
        <div class="tk-details-label muted small">${esc(t('tk.details'))}</div>
        <div class="tk-details" dir="auto">${esc(r.details)}</div>
        <div class="field tk-note"><label for="tk-note-${esc(r.id)}">${esc(t('tk.note'))}</label><textarea id="tk-note-${esc(r.id)}" rows="2" maxlength="1000" dir="auto" data-tk-note="${esc(r.id)}" placeholder="${esc(t('tk.notePh'))}">${esc(note)}</textarea></div>
        <div class="tk-acts">
          <button class="btn btn-sm" type="button" data-tk-save="${esc(r.id)}" ${busy.has(r.id) ? 'disabled' : ''}>${esc(t('tk.saveNote'))}</button>
          <button class="btn btn-sm ${open ? 'btn-primary' : ''}" type="button" data-tk-status="${open ? 'done' : 'new'}" data-tk-id="${esc(r.id)}" ${busy.has(r.id) ? 'disabled' : ''}>${esc(t(open ? 'tk.markDone' : 'tk.reopen'))}</button>
          <span class="small tk-msg ${m ? (m.ok ? 'ok' : 'bad') : ''}" role="status">${m ? esc(m.text) : ''}</span>
        </div>
      </article>`;
  }
  function render() {
    const root = box();
    if (!root) return;
    const list = data ? data.takedowns : [];
    const open = list.filter(isOpen);
    const done = list.filter((r) => !isOpen(r));
    drawnSig = sigOf();
    root.innerHTML = `
      <div class="card tk-intro">
        <h2>${esc(t('tk.tab'))}${data && data.open ? ` <span class="tk-open-n">${esc(POD.plural('tk.open', data.open))}</span>` : ''}</h2>
        <p class="muted small">${esc(t('tk.help'))}</p>
      </div>
      ${error ? `<p class="notice small">${esc(error)}</p>` : ''}
      ${!data ? '' : !list.length ? `<div class="card empty tk-empty"><p class="muted">${esc(t('tk.none'))}</p></div>` : `
        <h3 class="tk-group">${esc(t('tk.openHead'))} <span class="muted">(${esc(POD.num(open.length))})</span></h3>
        ${open.length ? `<div class="tk-list">${open.map(row).join('')}</div>` : `<p class="muted small tk-all-done">${esc(t('tk.allDone'))}</p>`}
        ${done.length ? `<h3 class="tk-group">${esc(t('tk.doneHead'))} <span class="muted">(${esc(POD.num(done.length))})</span></h3><div class="tk-list">${done.map(row).join('')}</div>` : ''}`}`;
    badge();
  }
  const sigOf = () => JSON.stringify([POD.lang, error, data, Object.keys(msgs).length, [...busy], designs ? designs.size : 0]);
  /** The tab's badge: how many are still open. */
  function badge() {
    const el = $('tk-count');
    if (!el) return;
    const n = data ? data.open : 0;
    el.hidden = !n;
    el.textContent = n ? POD.num(n) : '';
    el.title = n ? POD.plural('tk.open', n) : '';
  }

  async function load() {
    try {
      data = await api('/api/admin/takedowns');
      error = '';
    } catch (e) {
      if (e.status === 401 || e.ownerOnly) throw e;
      error = e.message || t('tk.loadFailed');
    }
  }
  /** A note box being typed in: the 15-second refresh leaves the tab as it is. */
  const typing = () => {
    const a = document.activeElement;
    return Boolean(a && a.matches && a.matches('[data-tk-note]') && box().contains(a));
  };

  async function patch(id, body, okText) {
    busy.add(id);
    delete msgs[id];
    render();
    try {
      const r = await api(`/api/admin/takedowns/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify(body) });
      const list = data.takedowns;
      const k = list.findIndex((x) => x.id === id);
      if (k >= 0) list[k] = r.takedown;
      data.open = list.filter(isOpen).length;
      delete notes[id];
      // (Marked handled or open again, the request moves to the other list: the message follows it, and a toast says it here.)
      msgs[id] = { text: t(okText), ok: true };
      if (body.status) POD.toast(t(okText));
    } catch (e) {
      msgs[id] = { text: e.message, ok: false };
      if (body.status) POD.toast(e.message, 'error');
    } finally {
      busy.delete(id);
    }
    render();
  }

  function init(opts) {
    api = opts.api;
    goToDesign = opts.goToDesign || null;
    const root = box();
    root.addEventListener('input', (e) => {
      const id = e.target.dataset && e.target.dataset.tkNote;
      if (id) notes[id] = e.target.value;
    });
    root.addEventListener('click', (e) => {
      const save = e.target.closest('[data-tk-save]');
      if (save) {
        const id = save.dataset.tkSave;
        const r = data && data.takedowns.find((x) => x.id === id);
        if (r) patch(id, { note: notes[id] !== undefined ? notes[id] : r.note || '' }, 'tk.noteSaved');
        return;
      }
      const st = e.target.closest('[data-tk-status]');
      if (st) {
        const id = st.dataset.tkId;
        const r = data && data.takedowns.find((x) => x.id === id);
        // The note typed so far goes with it.
        if (r) patch(id, { status: st.dataset.tkStatus, note: notes[id] !== undefined ? notes[id] : r.note || '' }, st.dataset.tkStatus === 'done' ? 'tk.doneSaved' : 'tk.reopened');
        return;
      }
      const des = e.target.closest('[data-tk-design]');
      if (des && goToDesign && designs) {
        const d = designs.get(des.dataset.tkDesign);
        if (d) goToDesign(d.id, { deleted: d.deleted });
      }
    });
  }
  return {
    init,
    async show({ auto = false } = {}) {
      if (auto && typing()) return;
      await load();
      await loadDesigns();
      // (The refresh redraws only when something changed, so a message or the scroll stays put.)
      if (auto && sigOf() === drawnSig) return;
      if (auto) for (const id of Object.keys(msgs)) delete msgs[id];
      render();
    },
    /** For the badge, on the dashboard's refresh (other tabs). */
    async count() {
      try {
        data = await api('/api/admin/takedowns');
      } catch (e) {
        if (e.status === 401) throw e;
      }
      badge();
    },
    onLang() {
      if (data || error) render();
      else badge();
    },
    badge,
    reset() {
      data = null;
      error = '';
      designs = null;
      drawnSig = '';
      for (const o of [notes, msgs]) for (const k of Object.keys(o)) delete o[k];
      badge();
      const root = box();
      if (root) root.innerHTML = '';
    },
  };
})();
