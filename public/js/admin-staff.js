/*
 * Admin → Staff & roles (owners): the team with each person's roles, editing a person, turning someone off (signed
 * out everywhere), a new one-time setup link (a forgotten password too), removing someone, and adding a person.
 * Nobody types a password for someone else: the person sets their own from a one-time link (48 hours), which the
 * owner sends by WhatsApp or copies. An owner can't take away their own owner role or turn themselves off.
 * Server: GET/POST /api/admin/staff, PATCH/DELETE /api/admin/staff/:id, POST /api/admin/staff/:id/setup-link.
 * admin.js calls AdminStaff.init({ api, access }) once, show({ auto }) when the tab opens or refreshes, onLang().
 */
window.AdminStaff = (() => {
  'use strict';

  const { esc, t } = POD;
  const $ = (id) => document.getElementById(id);
  const box = () => $('tab-staff');
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

  let cfg = null;
  let bound = false;
  const S = {
    staff: null, // GET /api/admin/staff
    error: '',
    editing: null, // the person whose edit panel is open
    link: null, // { id, name, username, url }: the setup link just made
    busy: new Set(),
    msg: {}, // person id -> { text, ok }
    sig: '',
  };

  const me = () => (cfg && cfg.access()) || {};
  /** The person signed in (their own row): by id when the session has it, else by username. */
  const isMe = (u) => {
    const a = me();
    return Boolean(a.id ? u.id === a.id : a.name && u.username === a.name);
  };
  /** A person's roles (an old product manager's account: the catalogue). */
  const rolesOf = (u) => (Array.isArray(u.roles) ? u.roles.filter((r) => AdminRoles.ROLES.includes(r)) : u.role === 'products' ? ['catalogue'] : []);
  const absLink = (link) => {
    try {
      return new URL(link, location.origin).href;
    } catch (e) {
      return String(link || '');
    }
  };
  const day = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };
  const rolePill = (r) => `<span class="ro-pill ro-role-${esc(r)}">${esc(t('role.' + r))}</span>`;

  // ---------- Drawing ----------
  function roleChecks(prefix, picked, lockOwner) {
    return AdminRoles.ROLES.map((r) => `
      <label class="st-check${lockOwner && r === 'owner' ? ' is-locked' : ''}">
        <input type="checkbox" name="${prefix}-role" value="${r}" ${picked.has(r) ? 'checked' : ''} ${lockOwner && r === 'owner' ? 'disabled' : ''}>
        <span><b>${esc(t('role.' + r))}</b><span class="muted small">${esc(t('role.' + r + '.help'))}</span></span>
      </label>`).join('');
  }
  function linkHtml() {
    const l = S.link;
    if (!l) return '';
    const text = t('staff.waText', { first: POD.firstName ? POD.firstName(l.name) : l.name, username: l.username, url: l.url });
    return `
      <div class="card ro-card st-link" id="st-link" role="status" tabindex="-1">
        <h2 class="ro-h">${esc(t('staff.linkTitle', { name: l.name }))}</h2>
        <p class="small">${esc(t('staff.linkHelp', { name: l.name }))}</p>
        <input type="text" readonly dir="ltr" id="st-link-url" value="${esc(l.url)}" aria-label="${esc(t('staff.linkTitle', { name: l.name }))}">
        <div class="st-link-btns">
          <a class="btn btn-sm btn-whatsapp" id="st-wa" target="_blank" rel="noopener" href="${esc('https://wa.me/?text=' + encodeURIComponent(text))}">${esc(t('staff.sendWa'))}</a>
          <button class="btn btn-sm" type="button" data-st-copy>${esc(t('staff.copy'))}</button>
          <button class="btn btn-sm" type="button" data-st-link-done>${esc(t('staff.done'))}</button>
        </div>
      </div>`;
  }
  function editHtml(u, mine) {
    const roles = new Set(rolesOf(u));
    const lock = mine && roles.has('owner');
    return `
      <form class="st-edit" data-st-edit="${esc(u.id)}" novalidate>
        <div class="field"><label for="st-e-name-${esc(u.id)}">${esc(t('staff.name'))}</label><input type="text" id="st-e-name-${esc(u.id)}" name="name" maxlength="60" dir="auto" value="${esc(u.name)}" required></div>
        <fieldset class="st-roles-pick"><legend>${esc(t('staff.roles'))}</legend>${roleChecks('st-e-' + u.id, roles, lock)}</fieldset>
        ${lock ? `<p class="muted small" style="margin:0">${esc(t('staff.selfOwner'))}</p>` : ''}
        <div class="st-edit-btns"><button class="btn btn-sm" type="button" data-st-act="cancel">${esc(t('staff.cancel'))}</button><button class="btn btn-sm btn-primary" type="submit" ${S.busy.has(u.id) ? 'disabled' : ''}>${esc(t('staff.save'))}</button></div>
      </form>`;
  }
  function rowHtml(u) {
    const mine = isMe(u);
    const off = u.active === false;
    const state = off ? 'off' : u.setupPending ? 'setup' : 'active';
    const busy = S.busy.has(u.id) ? 'disabled' : '';
    const m = S.msg[u.id];
    const facts = [u.lastSignIn ? t('staff.lastIn', { when: AdminRoles.cairoTime(u.lastSignIn) }) : t('staff.neverIn'), u.createdAt ? t('staff.since', { when: day(u.createdAt) }) : ''].filter(Boolean);
    return `
      <article class="card st-row${off ? ' is-off' : ''}" data-st-row="${esc(u.id)}">
        <div class="st-main">
          <div class="st-title"><strong dir="auto">${esc(u.name)}</strong> <bdi class="pm-id" dir="ltr">${esc(u.username)}</bdi>${mine ? ` <span class="ro-pill ro-pill-me">${esc(t('staff.you'))}</span>` : ''}</div>
          <div class="st-pills">${rolesOf(u).map(rolePill).join('')}<span class="ro-pill ro-st-${state}">${esc(t('staff.st.' + state))}</span></div>
          <div class="muted small">${esc(facts.join(POD.sep()))}</div>
        </div>
        <div class="st-acts">
          ${S.editing === u.id ? '' : `<button class="btn btn-sm" type="button" data-st-act="edit" ${busy}>${esc(t('staff.edit'))}</button>`}
          ${mine ? '' : `<button class="btn btn-sm" type="button" data-st-act="${off ? 'on' : 'off'}" ${busy}>${esc(t(off ? 'staff.turnOn' : 'staff.turnOff'))}</button>
          <button class="btn btn-sm" type="button" data-st-act="link" title="${esc(t('staff.newLinkHelp'))}" ${busy}>${esc(t('staff.newLink'))}</button>
          <button class="btn btn-sm btn-danger" type="button" data-st-act="remove" ${busy}>${esc(t('staff.remove'))}</button>`}
        </div>
        ${S.editing === u.id ? editHtml(u, mine) : ''}
        ${m ? `<p class="ro-msg ${m.ok ? 'ok' : 'bad'}" aria-live="polite">${esc(m.text)}</p>` : ''}
      </article>`;
  }
  /** The add form as typed (and the box with the cursor), kept when the tab is drawn again. */
  function typed() {
    const f = $('st-add');
    if (!f) return null;
    return {
      name: f.querySelector('#st-name').value,
      username: f.querySelector('#st-user').value,
      roles: new Set([...f.querySelectorAll('input[name="st-new-role"]:checked')].map((x) => x.value)),
      focus: document.activeElement && f.contains(document.activeElement) ? document.activeElement.id : '',
    };
  }
  function render() {
    const el = box();
    if (!el) return;
    const keep = typed() || { name: '', username: '', roles: new Set(), focus: '' };
    const list = S.staff;
    el.innerHTML = `
      <div class="card ro-card st-intro">
        <p class="small" style="margin:0">${esc(t('role.rule'))}</p>
      </div>
      ${linkHtml()}
      <form class="card ro-card st-add" id="st-add" novalidate>
        <h2 class="ro-h">${esc(t('staff.addTitle'))}</h2>
        <p class="muted small">${esc(t('staff.addHelp'))}</p>
        <div class="st-grid">
          <div class="field"><label for="st-name">${esc(t('staff.name'))}</label><input type="text" id="st-name" maxlength="60" dir="auto" autocomplete="off" required value="${esc(keep.name)}"></div>
          <div class="field"><label for="st-user">${esc(t('staff.username'))}</label><input type="text" id="st-user" maxlength="30" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="mostafa" value="${esc(keep.username)}"><span class="muted small">${esc(t('staff.usernameHelp'))}</span></div>
        </div>
        <fieldset class="st-roles-pick"><legend>${esc(t('staff.roles'))}</legend>${roleChecks('st-new', keep.roles, false)}</fieldset>
        <p class="ro-err" id="st-add-err" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">${esc(t('staff.add'))}</button>
      </form>
      <h2 class="ro-h st-list-h">${esc(t('staff.list'))}</h2>
      ${S.error ? `<p class="notice">${esc(S.error)}</p>` : ''}
      <div class="st-list">${!list ? `<div class="card empty"><p class="muted">${esc(t('pm.loading'))}</p></div>`
        : list.length ? list.map(rowHtml).join('') : `<div class="card empty"><p class="muted">${esc(t('staff.none'))}</p></div>`}</div>`;
    if (keep.focus && $(keep.focus)) $(keep.focus).focus({ preventScroll: true });
    S.sig = JSON.stringify(list);
  }

  // ---------- Server ----------
  async function load() {
    try {
      const r = await cfg.api('/api/admin/staff');
      S.staff = Array.isArray(r && r.staff) ? r.staff : [];
      S.error = '';
    } catch (e) {
      if (e.status === 401) throw e;
      S.error = e.message;
    }
  }
  const put = (u) => {
    if (!u || !S.staff) return;
    const k = S.staff.findIndex((x) => x.id === u.id);
    if (k >= 0) S.staff[k] = { ...S.staff[k], ...u };
    else S.staff.push(u);
  };
  async function act(id, what, row) {
    const u = (S.staff || []).find((x) => x.id === id);
    if (!u) return;
    if (what === 'edit') { S.editing = id; delete S.msg[id]; render(); const n = $(`st-e-name-${id}`); if (n) n.focus(); return; }
    if (what === 'cancel') { S.editing = null; render(); return; }
    if (what === 'off' && !confirm(t('staff.confirmOff', { name: u.name }))) return;
    if (what === 'remove' && !confirm(t('staff.confirmRemove', { name: u.name }))) return;
    if (what === 'link' && !confirm(t('staff.confirmLink', { name: u.name }))) return;
    S.busy.add(id);
    render();
    try {
      if (what === 'off' || what === 'on') {
        const r = await cfg.api(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ active: what === 'on' }) });
        // (The row as the server has it now: a colleague's role change shows, and the next edit starts from it. QA 25 Nov.)
        put((r && (r.user || (r.id ? r : null))) || { ...u, active: what === 'on' });
        S.msg[id] = { text: t(what === 'on' ? 'staff.onDone' : 'staff.offDone', { name: u.name }), ok: true };
      } else if (what === 'link') {
        const r = await cfg.api(`/api/admin/staff/${encodeURIComponent(id)}/setup-link`, { method: 'POST' });
        S.link = { id, name: u.name, username: u.username, url: absLink(r && r.setupLink) };
        delete S.msg[id];
      } else if (what === 'remove') {
        await cfg.api(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
        S.staff = S.staff.filter((x) => x.id !== id);
        if (S.link && S.link.id === id) S.link = null;
        POD.toast(t('staff.removed', { name: u.name }));
      }
    } catch (e) {
      if (e.status !== 401) S.msg[id] = { text: e.message, ok: false };
    }
    S.busy.delete(id);
    render();
    if (what === 'link' && S.link) focusLink();
    else if (row && row.isConnected) row.scrollIntoView({ block: 'nearest' });
  }
  function focusLink() {
    const l = $('st-link');
    if (!l) return;
    l.scrollIntoView({ block: 'start', behavior: 'smooth' });
    l.focus({ preventScroll: true });
  }
  async function saveEdit(form) {
    const id = form.dataset.stEdit;
    const u = (S.staff || []).find((x) => x.id === id);
    if (!u) return;
    const name = form.name.value.trim();
    const roles = [...form.querySelectorAll('input[type=checkbox]')].filter((x) => x.checked || (x.disabled && x.value === 'owner')).map((x) => x.value);
    if (!name) return void (S.msg[id] = { text: t('staff.bad'), ok: false }, render());
    if (!roles.length) return void (S.msg[id] = { text: t('staff.noRole'), ok: false }, render());
    // (Your own owner role stays, whatever the boxes say.)
    if (isMe(u) && rolesOf(u).includes('owner') && !roles.includes('owner')) roles.unshift('owner');
    // Only what was changed here goes: a colleague's change made meanwhile (a role taken away) isn't undone by
    // saving a name fix from a form opened earlier (QA 25 Nov).
    const same = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
    const body = {};
    if (name !== (u.name || '')) body.name = name;
    if (!same(roles, rolesOf(u))) body.roles = roles;
    if (!Object.keys(body).length) {
      S.editing = null;
      S.msg[id] = { text: t('staff.saved'), ok: true };
      return render();
    }
    S.busy.add(id);
    try {
      const r = await cfg.api(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) });
      put((r && (r.user || (r.id ? r : null))) || { ...u, ...body });
      S.editing = null;
      S.msg[id] = { text: t('staff.saved'), ok: true };
    } catch (e) {
      if (e.status !== 401) S.msg[id] = { text: e.message, ok: false };
    }
    S.busy.delete(id);
    render();
  }
  let adding = false;
  async function add(form) {
    if (adding) return;
    const err = $('st-add-err');
    const say = (m) => { err.textContent = m; err.hidden = !m; };
    const name = form.querySelector('#st-name').value.trim();
    const username = form.querySelector('#st-user').value.trim().toLowerCase();
    const roles = [...form.querySelectorAll('input[name="st-new-role"]:checked')].map((x) => x.value);
    if (!name || !USERNAME.test(username)) return void (say(t('staff.bad')), form.querySelector(name ? '#st-user' : '#st-name').focus());
    if (!roles.length) return void say(t('staff.noRole'));
    say('');
    adding = true;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await cfg.api('/api/admin/staff', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, username, roles }) });
      const user = (r && r.user) || { id: username, name, username, roles, active: true, setupPending: true, createdAt: new Date().toISOString() };
      put(user);
      S.link = { id: user.id, name: user.name || name, username: user.username || username, url: absLink(r && r.setupLink) };
      // A fresh form for the next person (also its defaults: a redraw while typing wrote the typed values into them).
      for (const i of form.querySelectorAll('input')) {
        if (i.type === 'checkbox') { i.checked = false; i.defaultChecked = false; } else { i.value = ''; i.defaultValue = ''; }
      }
      POD.toast(t('staff.added', { name: user.name || name }));
      render();
      focusLink();
    } catch (e) {
      if (e.status !== 401) say(e.message);
    } finally {
      adding = false;
      const b = $('st-add') && $('st-add').querySelector('[type=submit]');
      if (b) b.disabled = false;
    }
  }

  function bind() {
    const el = box();
    if (!el || bound) return;
    bound = true;
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-st-act]');
      if (a) {
        const row = a.closest('[data-st-row]');
        if (row) act(row.dataset.stRow, a.dataset.stAct, row);
        return;
      }
      if (e.target.closest('[data-st-copy]')) {
        const input = $('st-link-url');
        try {
          await navigator.clipboard.writeText(input.value);
        } catch (err) {
          input.select();
          document.execCommand('copy');
        }
        POD.toast(t('staff.copied'));
        return;
      }
      if (e.target.closest('[data-st-link-done]')) {
        S.link = null;
        render();
      }
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'st-add') add(e.target);
      else if (e.target.matches('[data-st-edit]')) saveEdit(e.target);
    });
    // Usernames: small letters as typed.
    el.addEventListener('input', (e) => {
      if (e.target.id === 'st-user') {
        const v = e.target.value.toLowerCase().replace(/\s+/g, '');
        if (v !== e.target.value) e.target.value = v;
      }
    });
  }

  return {
    init(c) {
      cfg = c;
      bind();
    },
    async show({ auto = false } = {}) {
      bind();
      // The 15-second refresh never redraws under the owner's hands (typing, an edit panel open).
      const el = box();
      if (auto && (S.editing || (el && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))) return;
      await load();
      if (auto && JSON.stringify(S.staff) === S.sig) return;
      render();
    },
    onLang() {
      if (box() && (S.staff || S.error)) render();
    },
    reset() {
      S.staff = null;
      S.error = '';
      S.editing = null;
      S.link = null;
      S.busy.clear();
      S.msg = {};
      S.sig = '';
      if (box()) box().innerHTML = '';
    },
  };
})();
