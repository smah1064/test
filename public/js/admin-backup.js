/*
 * Admin → Backups (owners only): one file with everything the shop has saved (orders, customers, designs and print
 * files, product photos, the activity log), made on the server in the background, then downloaded through a
 * signed link the browser saves itself (no size limit in the page; the download can be resumed).
 * Server: GET /api/admin/backups → { backups: [{ name, at, bytes }], making, error }, POST /api/admin/backups,
 * POST /api/admin/backups/:name/link → { url }, DELETE /api/admin/backups/:name (src/backup.js).
 * admin.js calls AdminBackup.init({ api }) once, show() when the tab opens and onLang() on a language switch.
 */
window.AdminBackup = (() => {
  'use strict';

  const { t, esc } = POD;
  const $ = (id) => document.getElementById(id);
  const box = () => $('tab-backup');
  let api = null;
  let data = null;
  let poll = null;
  let busy = false;

  /** 1.4 GB / 230 MB / 12 KB, with the page's digits. */
  function size(n) {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = Number(n) || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    const num = v >= 100 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${POD.num(num)} ${u[i]}`;
  }
  const pct = (m) => (m && m.total ? Math.min(99, Math.floor((m.done / m.total) * 100)) : 0);

  function render() {
    const root = box();
    if (!root || !data) return;
    const m = data.making;
    const list = data.backups || [];
    root.innerHTML = `
      <div class="card bk-head">
        <h2>${esc(t('bk.title'))}</h2>
        <p class="muted small">${esc(t('bk.help'))}</p>
        <p class="small bk-private">🔒 ${esc(t('bk.private'))}</p>
        <div class="bk-actions">
          <button class="btn btn-primary" type="button" data-bk-make ${m || busy ? 'disabled' : ''}>${esc(t('bk.make'))}</button>
          ${m ? `<span class="small bk-progress" role="status">${esc(m.elsewhere ? t('bk.makingElsewhere') : t('bk.making', { p: POD.num(pct(m)), files: POD.num(m.files || 0), size: size(m.total) }))}</span>` : ''}
        </div>
        ${m && !m.elsewhere ? `<div class="bk-bar" aria-hidden="true"><span style="width:${pct(m)}%"></span></div>` : ''}
        ${data.error && !m ? `<p class="notice small" role="alert">${esc(data.error.message || t('bk.failed'))}</p>` : ''}
      </div>
      <div class="queue-list" id="bk-list">
        ${list.length ? list.map((b) => `
          <div class="queue-row bk-row" data-name="${esc(b.name)}">
            <div>
              <strong>${esc(AdminRoles.cairoTime(b.at))}</strong>
              <div class="muted small" dir="ltr">${esc(b.name)} · ${esc(size(b.bytes))}</div>
            </div>
            <div class="bk-row-actions">
              <button class="btn btn-sm btn-primary" type="button" data-bk-get>⬇ ${esc(t('bk.download'))}</button>
              <button class="btn btn-sm" type="button" data-bk-del>${esc(t('houses.delete'))}</button>
            </div>
          </div>`).join('') : `<div class="card empty small muted">${esc(t('bk.none'))}</div>`}
      </div>
      <p class="muted small bk-note">${esc(t('bk.kept'))}</p>`;
  }

  async function load() {
    data = await api('/api/admin/backups');
    render();
    clearTimeout(poll);
    // (While one is being made: its progress every 2 seconds, until it is ready.)
    if (data.making && box() && !box().hidden) poll = setTimeout(() => load().catch(() => {}), 2000);
  }

  function bind() {
    const root = box();
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('click', async (e) => {
      const make = e.target.closest('[data-bk-make]');
      const get = e.target.closest('[data-bk-get]');
      const del = e.target.closest('[data-bk-del]');
      const name = (e.target.closest('[data-name]') || {}).dataset?.name;
      try {
        if (make && !busy) {
          busy = true;
          render();
          try {
            await api('/api/admin/backups', { method: 'POST', headers: { 'x-lang': POD.lang } });
          } finally {
            busy = false;
          }
          await load();
        } else if (get && name) {
          const r = await api(`/api/admin/backups/${encodeURIComponent(name)}/link`, { method: 'POST', headers: { 'x-lang': POD.lang } });
          // The browser saves it (its own downloads list, which can resume it).
          const a = Object.assign(document.createElement('a'), { href: r.url, download: name, rel: 'noopener' });
          document.body.appendChild(a);
          a.click();
          a.remove();
          POD.toast(t('bk.started'));
        } else if (del && name && confirm(t('bk.confirmDelete'))) {
          await api(`/api/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'x-lang': POD.lang } });
          await load();
        }
      } catch (err) {
        if (err && err.status === 401) throw err;
        POD.toast(err.message, 'error');
        load().catch(() => {});
      }
    });
  }

  return {
    init(c) {
      api = c.api;
      bind();
    },
    async show() {
      bind();
      await load();
    },
    onLang() {
      if (data) render();
    },
  };
})();
