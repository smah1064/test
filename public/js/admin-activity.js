/*
 * Admin → Activity log: everything done in the admin, newest first — who, when (Cairo time, the page's digits),
 * what (the server's summary in the page's language) and the result (done, sent for approval, refused, failed),
 * with the emergency owner login marked. Owners see everyone's and can pick a person; the others see their own.
 * Filters: person and days (from / to). The latest 500 lines first, "Show older" for the next 500; "Export CSV"
 * writes every line of the chosen person and days (read page by page, at most 50,000 lines, said when cut).
 * Server: GET /api/admin/activity?who=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&before=<at>|<id> → { entries, more, next }
 * admin.js calls AdminActivity.init({ api, access }) once, show({ auto }) when the tab opens or refreshes.
 */
window.AdminActivity = (() => {
  'use strict';

  const { esc, t } = POD;
  const $ = (id) => document.getElementById(id);
  const box = () => $('tab-activity');
  const LIMIT = 500;
  const CSV_MAX = 50000;

  let cfg = null;
  let bound = false;
  const S = { entries: null, error: '', who: '', from: '', to: '', people: new Map(), staffRead: false, sig: '', more: false, next: '', older: false, busy: '' };

  const owner = () => Boolean(cfg && cfg.access() && cfg.access().owner);
  const backwards = () => Boolean(S.from && S.to && S.from > S.to);
  const roleNames = (roles) => (roles || []).filter((r) => AdminRoles.ROLES.includes(r)).map((r) => t('role.' + r)).join(POD.lang === 'ar' ? '، ' : ', ');
  const newestFirst = (list) => list.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  // ---------- Drawing ----------
  // The shared password's sign-in reads as the owner's emergency login, not its id.
  const nameOf = (w) => (!w ? '—' : w.id === 'owner' ? t('me.emergencyName') : [w.name || w.id || '—', w.username && w.username !== w.name ? `(${w.username})` : ''].filter(Boolean).join(' '));
  function rowHtml(e, own) {
    // (outcome 'failed': an approval whose change couldn't be applied.)
    const res = e.outcome === 'failed' ? 'failed' : AdminRoles.resultOf(e.status);
    // (Values someone typed come in isolates: their digits stay as typed, and a line that starts with one still
    // reads in its own words' direction, which dir="auto" would take from the typed value.)
    const what = AdminRoles.inLang(e.summary) || e.action || '';
    // (Who approved a change made by someone else; the method and address only go in the CSV.)
    const by = e.approvedByEmergency ? t('act.approvedBy', { name: t('me.emergencyName') }) : e.approvedBy ? t('act.approvedBy', { name: e.approvedBy }) : '';
    return `
      <tr class="act-row act-${res}">
        <td data-label="${esc(t('act.col.when'))}"><span class="act-when">${esc(AdminRoles.cairoTime(e.at))}</span></td>
        ${own ? `<td data-label="${esc(t('act.col.who'))}"><b dir="auto">${esc(nameOf(e.who))}</b>${e.roles && e.roles.length ? `<div class="muted small">${esc(roleNames(e.roles))}</div>` : ''}</td>` : ''}
        <td data-label="${esc(t('act.col.what'))}"><span dir="${POD.textDir(what)}">${esc(what)}</span>${by ? `<div class="muted small" dir="auto">${esc(by)}</div>` : ''}</td>
        <td data-label="${esc(t('act.col.result'))}"><span class="ro-pill act-pill-${res}">${esc(t('act.res.' + res))}</span>${e.approvalId ? ` <span class="ro-pill act-pill-approval">${esc(t('act.approval'))}</span>` : ''}${e.emergency ? ` <span class="ro-pill act-pill-emergency">${esc(t('act.emergency'))}</span>` : ''}</td>
      </tr>`;
  }
  function peopleOptions() {
    const list = [...S.people.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return `<option value="">${esc(t('act.everyone'))}</option>${list.map(([id, name]) => `<option value="${esc(id)}" ${S.who === id ? 'selected' : ''}>${esc(`⁨${name}⁩`)}</option>`).join('')}`;
  }
  function renderTable() {
    const own = owner();
    const wrap = $('act-table-wrap');
    if (!wrap) return;
    const list = S.entries ? newestFirst(S.entries) : null;
    // (When older lines aren't loaded yet the count says so: the list isn't the whole period.)
    $('act-count').textContent = list ? [POD.plural('act.count', list.length), S.more ? t('act.moreThere') : ''].filter(Boolean).join(' ') : '';
    $('act-csv').disabled = !list || !list.length || Boolean(S.busy);
    $('act-csv').textContent = t(S.busy === 'csv' ? 'act.csvBusy' : 'act.csv');
    wrap.innerHTML = S.error ? `<p class="notice" style="margin:12px">${esc(S.error)}</p>`
      : !list ? `<p class="muted" style="margin:12px">${esc(t('pm.loading'))}</p>`
        : !list.length ? `<p class="muted act-empty">${esc(t('act.none'))}</p>`
          : `<table class="orders act-table">
            <thead><tr><th>${esc(t('act.col.when'))}</th>${own ? `<th>${esc(t('act.col.who'))}</th>` : ''}<th>${esc(t('act.col.what'))}</th><th>${esc(t('act.col.result'))}</th></tr></thead>
            <tbody>${list.map((e) => rowHtml(e, own)).join('')}</tbody>
          </table>
          ${S.more ? `<p class="act-older"><button class="btn btn-sm" type="button" id="act-older" ${S.busy ? 'disabled' : ''}>${esc(t(S.busy === 'older' ? 'pm.loading' : 'act.older'))}</button></p>` : ''}`;
    S.sig = JSON.stringify(S.entries);
  }
  function render() {
    const el = box();
    if (!el) return;
    const own = owner();
    el.innerHTML = `
      <div class="card ro-card act-top">
        <p class="muted small" style="margin:0 0 10px">${esc(t(own ? 'act.help' : 'act.helpMine'))}</p>
        <div class="act-filters">
          ${own ? `<div class="field"><label for="act-who">${esc(t('act.who'))}</label><select id="act-who">${peopleOptions()}</select></div>` : ''}
          <div class="field"><label for="act-from">${esc(t('act.from'))}</label><input type="date" id="act-from" value="${esc(S.from)}"></div>
          <div class="field"><label for="act-to">${esc(t('act.to'))}</label><input type="date" id="act-to" value="${esc(S.to)}"></div>
          <div class="field act-csv-f"><button class="btn btn-sm" type="button" id="act-csv">${esc(t('act.csv'))}</button></div>
        </div>
        <p class="notice small" id="act-range" role="alert" ${backwards() ? '' : 'hidden'} style="margin:10px 0 0">${esc(t('acc.rangeBackwards'))}</p>
        <p class="muted small act-count" id="act-count" aria-live="polite"></p>
      </div>
      <div class="card act-card" id="act-table-wrap"></div>`;
    renderTable();
  }

  // ---------- Server ----------
  async function readPeople() {
    // Owners pick a person: the team (and anyone in the entries, e.g. someone removed since).
    if (!owner() || S.staffRead) return;
    S.staffRead = true;
    try {
      const r = await cfg.api('/api/admin/staff');
      for (const u of (r && r.staff) || []) if (u.id) S.people.set(u.id, u.name || u.username || u.id);
    } catch (e) {
      if (e.status === 401) throw e;
    }
  }
  /** One page of lines for the filters: the latest, or those older than `before` ("<at>|<id>"). */
  function page(before) {
    const q = new URLSearchParams();
    if (S.who && owner()) q.set('who', S.who);
    if (S.from) q.set('from', S.from);
    if (S.to) q.set('to', S.to);
    q.set('limit', String(LIMIT));
    if (before) q.set('before', before);
    return cfg.api(`/api/admin/activity?${q}`).then((r) => ({ entries: Array.isArray(r && r.entries) ? r.entries : [], more: Boolean(r && r.more && r.next), next: (r && r.next) || '' }));
  }
  const meet = (list) => { for (const e of list) if (e.who && e.who.id && !S.people.has(e.who.id)) S.people.set(e.who.id, nameOf(e.who)); };
  async function load() {
    if (backwards()) return;
    const filters = JSON.stringify([S.who, S.from, S.to]);
    try {
      const r = await page('');
      if (filters !== JSON.stringify([S.who, S.from, S.to])) return; // (the filters changed meanwhile: their own load draws)
      meet(r.entries);
      S.error = '';
      // A refresh after "Show older": the new lines join the top, the older pages stay.
      if (S.older && S.entries) {
        const have = new Set(S.entries.map((e) => e.id));
        S.entries = [...r.entries.filter((e) => !have.has(e.id)), ...S.entries];
        return;
      }
      S.entries = r.entries;
      S.more = r.more;
      S.next = r.next;
    } catch (e) {
      if (e.status === 401) throw e;
      S.error = e.message;
    }
  }
  async function loadOlder() {
    if (!S.more || !S.next || S.busy) return;
    const filters = JSON.stringify([S.who, S.from, S.to]);
    S.busy = 'older';
    renderTable();
    try {
      const r = await page(S.next);
      if (filters !== JSON.stringify([S.who, S.from, S.to])) return;
      meet(r.entries);
      const have = new Set((S.entries || []).map((e) => e.id));
      S.entries = [...(S.entries || []), ...r.entries.filter((e) => !have.has(e.id))];
      S.more = r.more;
      S.next = r.next;
      S.older = true;
    } catch (e) {
      if (e.status === 401) throw e;
      POD.toast(e.message, 'error');
    } finally {
      S.busy = '';
      renderTable();
    }
  }
  /** Every line for the chosen person and days, as a CSV file (the page's language; times in Cairo and in UTC). */
  async function exportCsv() {
    if (!S.entries || !S.entries.length || S.busy) return;
    let all = S.entries.slice();
    if (S.more) {
      // (The pages not loaded yet are read here, not added to the list on the screen.)
      S.busy = 'csv';
      renderTable();
      try {
        let next = S.next;
        const have = new Set(all.map((e) => e.id));
        while (next && all.length < CSV_MAX) {
          const r = await page(next);
          for (const e of r.entries) if (!have.has(e.id)) { have.add(e.id); all.push(e); }
          next = r.more ? r.next : '';
        }
        if (next || all.length > CSV_MAX) {
          all = newestFirst(all).slice(0, CSV_MAX);
          POD.toast(t('act.csvCut', { n: POD.num(CSV_MAX) }), 'error');
        }
      } catch (e) {
        if (e.status === 401) throw e;
        POD.toast(e.message, 'error');
        return;
      } finally {
        S.busy = '';
        renderTable();
      }
    }
    const labels = [t('act.csv.cairo'), t('act.csv.utc'), t('act.col.who'), t('act.csv.roles'), t('act.col.what'), t('act.col.result'), 'HTTP', t('act.csv.method'), t('act.csv.path'), t('act.approval'), t('act.emergency')];
    const csv = AdminRoles.toCsv(AdminRoles.activityRows(newestFirst(all), { lang: POD.lang, labels, result: (r) => t('act.res.' + r), role: (r) => t('role.' + r) }));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `activity-${AdminRoles.cairoDay()}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function bind() {
    const el = box();
    if (!el || bound) return;
    bound = true;
    el.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id !== 'act-who' && id !== 'act-from' && id !== 'act-to') return;
      S.who = $('act-who') ? $('act-who').value : '';
      S.from = $('act-from').value;
      S.to = $('act-to').value;
      $('act-range').hidden = !backwards();
      if (backwards()) return;
      S.entries = null;
      S.more = false;
      S.next = '';
      S.older = false;
      renderTable();
      load().then(renderTable).catch(() => {});
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('#act-csv')) exportCsv().catch(() => {});
      if (e.target.closest('#act-older')) loadOlder().catch(() => {});
    });
  }

  return {
    init(c) {
      cfg = c;
      bind();
    },
    async show({ auto = false } = {}) {
      bind();
      const el = box();
      if (auto && el && el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
      await readPeople();
      await load();
      if (auto && $('act-table-wrap')) {
        if (JSON.stringify(S.entries) !== S.sig) renderTable();
        return;
      }
      render();
    },
    onLang() {
      if (box() && (S.entries || S.error)) render();
    },
    reset() {
      S.entries = null;
      S.error = '';
      S.who = '';
      S.from = '';
      S.to = '';
      S.people.clear();
      S.staffRead = false;
      S.sig = '';
      S.more = false;
      S.next = '';
      S.older = false;
      S.busy = '';
      if (box()) box().innerHTML = '';
    },
  };
})();
