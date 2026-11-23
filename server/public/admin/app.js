// Admin dashboard — vanilla JS single-page app.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // Times are shown in the company's time zone (COMPANY_TZ on the server), not the browser's.
  let companyTz;
  const tzOpt = () => (companyTz ? { timeZone: companyTz } : {});
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...tzOpt() });
  const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', ...tzOpt() });
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let token = null;
  try { token = localStorage.getItem('att_admin_token'); } catch {}
  let sitesCache = [];

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      headers: { authorization: token ? `Bearer ${token}` : '', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { logout(); throw new Error('Session expired'); }
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : res;
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
  async function download(url, fallbackName) {
    const res = await fetch('/api' + url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return toast('Download failed');
    const name = /filename="?([^"]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const photoUrls = new Map();
  async function photoUrl(id) {
    if (!photoUrls.has(id)) {
      photoUrls.set(id, fetch(`/api/admin/attendance/${id}/photo`, { headers: { authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : '')));
    }
    return photoUrls.get(id);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  // ---------- Modal ----------
  const modal = $('#modal');
  function openModal(html, onSubmit) {
    $('#modal-body').innerHTML = html;
    const form = $('form', modal);
    if (form && onSubmit) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('.error', form);
        try {
          await onSubmit(Object.fromEntries(new FormData(form)));
          modal.close();
        } catch (ex) { if (err) err.textContent = ex.message; }
      });
    }
    $$('[data-close]', modal).forEach((b) => b.addEventListener('click', () => modal.close()));
    modal.showModal();
  }

  // ---------- Auth ----------
  function showApp(on) {
    $('#login-view').classList.toggle('hidden', on);
    $('#app-view').classList.toggle('hidden', !on);
  }
  function logout() {
    token = null;
    try { localStorage.removeItem('att_admin_token'); } catch {}
    showApp(false);
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    $('#login-error').textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, portal: 'admin' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      token = data.token;
      try { localStorage.setItem('att_admin_token', token); } catch {}
      start();
    } catch (ex) { $('#login-error').textContent = ex.message; }
  });
  $('#logout-btn').addEventListener('click', logout);
  $('#pw-btn').addEventListener('click', () =>
    openModal(
      `<form><h3>Change password</h3>
        <label>Current password<input type="password" name="current_password" required></label>
        <label>New password<input type="password" name="new_password" minlength="6" required></label>
        <p class="error"></p>
        <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      async (v) => { await api('POST', '/auth/change-password', v); toast('Password changed'); }
    )
  );

  // ---------- Tabs ----------
  const loaders = {};
  function showTab(name) {
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
    $$('main > section').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== name));
    try { localStorage.setItem('att_tab', name); } catch {}
    loaders[name]?.().catch((e) => toast(e.message));
  }
  $$('#nav a').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.tab)));

  const tiles = (el, items) => {
    el.innerHTML = items.map(([v, l]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  };

  // ---------- Today ----------
  $('#day-input').value = today();
  $('#day-input').addEventListener('change', () => loaders.today());
  loaders.today = async () => {
    const data = await api('GET', `/admin/attendance?date=${$('#day-input').value}`);
    const s = data.stats;
    tiles($('#day-tiles'), [
      [s.present, 'Checked in today'],
      [s.currently_in, 'Currently at work'],
      [Math.max(0, s.total_employees - s.present), 'Not checked in'],
      [s.total_employees, 'Active employees'],
    ]);
    const t = $('#day-table');
    t.innerHTML = `<thead><tr><th>Selfie</th><th>Time</th><th>Employee</th><th>Type</th><th>Location</th><th>Verified by</th><th class="num">Distance</th><th class="num">GPS ±</th><th>Map</th></tr></thead><tbody>${
      data.records.length
        ? data.records.map((r) => `<tr>
          <td><img class="thumb" data-photo="${r.id}" alt="Selfie of ${esc(r.name)}"></td>
          <td>${fmtTime(r.ts)}</td>
          <td><strong>${esc(r.name)}</strong><br><span class="muted">${esc(r.emp_code)}</span></td>
          <td>${r.type === 'in' ? '<span class="badge ok">Check in</span>' : '<span class="badge info">Check out</span>'}</td>
          <td>${esc(r.site_name || '—')}</td>
          <td>${r.via_network ? '<span class="badge ok">Office Wi-Fi</span>' : '<span class="badge info">GPS</span>'}
            <br><span class="muted">${r.source === 'web' ? 'Web page' : 'App'}</span></td>
          <td class="num">${r.distance_m ?? '—'} m</td>
          <td class="num">${r.accuracy_m ? Math.round(r.accuracy_m) + ' m' : '—'}</td>
          <td><a target="_blank" rel="noopener" href="https://maps.google.com/?q=${r.lat},${r.lng}">Open</a></td></tr>`).join('')
        : '<tr><td colspan="9" class="empty">No check-ins on this day.</td></tr>'
    }</tbody>`;
    $$('img[data-photo]', t).forEach(async (img) => {
      img.src = await photoUrl(img.dataset.photo);
      img.addEventListener('click', () => {
        const row = data.records.find((r) => String(r.id) === img.dataset.photo);
        openModal(`<h3>${esc(row.name)} — ${row.type === 'in' ? 'check in' : 'check out'} ${fmtDateTime(row.ts)}</h3>
          <img class="full" src="${img.src}" alt="Selfie"><div class="modal-actions"><button class="btn" data-close>Close</button></div>`);
      });
    });
  };

  // ---------- Report ----------
  const monthNow = today().slice(0, 7);
  $('#month-input').value = monthNow;
  $('#month-input').addEventListener('change', () => loaders.report());
  const m = () => $('#month-input').value;
  $('#dl-xlsx').addEventListener('click', () => download(`/admin/reports/monthly?month=${m()}&format=xlsx`, `attendance-${m()}.xlsx`));
  $('#dl-csv').addEventListener('click', () => download(`/admin/reports/monthly?month=${m()}&format=csv`, `attendance-${m()}.csv`));
  $('#dl-csv-daily').addEventListener('click', () => download(`/admin/reports/monthly?month=${m()}&format=csv&sheet=daily`, `attendance-${m()}-daily.csv`));
  loaders.report = async () => {
    const [r, archive] = await Promise.all([api('GET', `/admin/reports/monthly?month=${m()}`), api('GET', '/admin/reports/archive')]);
    $('#report-note').textContent = `Work hours ${r.settings.work_start}–${r.settings.work_end}, ${r.settings.grace_minutes} min grace. ` +
      (m() === monthNow ? 'Month in progress — counts are up to today.' : '');
    const tot = r.summary.reduce((a, x) => ({
      present: a.present + x.present_days, absent: a.absent + x.absent_days, late: a.late + x.late_days,
      hours: a.hours + x.worked_hours, blocked: a.blocked + x.blocked_attempts,
    }), { present: 0, absent: 0, late: 0, hours: 0, blocked: 0 });
    tiles($('#report-tiles'), [
      [r.summary.length, 'Employees'], [tot.present, 'Days present'], [tot.absent, 'Days absent'],
      [tot.late, 'Late arrivals'], [Math.round(tot.hours), 'Hours worked'], [tot.blocked, 'Blocked punches'],
    ]);
    const rate = (x) => x.attendance_rate === null ? '—'
      : `<span class="badge ${x.attendance_rate >= 95 ? 'ok' : x.attendance_rate >= 80 ? 'warn' : 'bad'}">${x.attendance_rate}%</span>`;
    $('#report-table').innerHTML = `<thead><tr><th>Employee</th><th class="num">Working days</th><th class="num">Present</th><th class="num">Absent</th><th>Rate</th>
      <th class="num">Late</th><th class="num">Late min</th><th class="num">Left early</th><th class="num">No check-out</th><th class="num">Hours</th><th class="num">Avg/day</th><th class="num">Blocked</th></tr></thead><tbody>${
      r.summary.length ? r.summary.map((x) => `<tr>
        <td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.emp_code)} · ${esc(x.site)}</span></td>
        <td class="num">${x.working_days}</td><td class="num">${x.present_days}</td><td class="num">${x.absent_days}</td><td>${rate(x)}</td>
        <td class="num">${x.late_days}</td><td class="num">${x.late_minutes}</td><td class="num">${x.early_leave_days}</td>
        <td class="num">${x.missing_checkouts}</td><td class="num">${x.worked_hours}</td><td class="num">${x.avg_hours_per_day}</td>
        <td class="num">${x.blocked_attempts ? `<span class="badge bad">${x.blocked_attempts}</span>` : 0}</td></tr>`).join('')
      : '<tr><td colspan="12" class="empty">No employees yet.</td></tr>'}</tbody>`;
    $('#archive-table').innerHTML = `<thead><tr><th>Month</th><th>File</th><th></th></tr></thead><tbody>${
      archive.length ? archive.map((a) => `<tr><td>${esc(a.month)}</td><td>${esc(a.file)}</td>
        <td><button class="btn small" data-file="${esc(a.file)}">Download</button></td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">No automatic reports yet — the first one appears on the 1st of next month.</td></tr>'}</tbody>`;
    $$('#archive-table [data-file]').forEach((b) => b.addEventListener('click', () => download(`/admin/reports/archive/${b.dataset.file}`, b.dataset.file)));
  };

  // ---------- Employees ----------
  const siteOptions = (sel) => `<option value="">Any location</option>` +
    sitesCache.map((s) => `<option value="${s.id}" ${String(sel) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  loaders.employees = async () => {
    const [emps, sites] = await Promise.all([api('GET', '/admin/employees'), api('GET', '/admin/sites')]);
    sitesCache = sites;
    const t = $('#emp-table');
    t.innerHTML = `<thead><tr><th>Employee</th><th>Role</th><th>Location</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
      emps.map((u) => `<tr>
        <td><strong>${esc(u.name)}</strong><br><span class="muted">${esc(u.emp_code)}</span></td>
        <td>${u.role === 'admin' ? '<span class="badge info">Admin</span>' : 'Employee'}</td>
        <td>${u.role === 'admin' ? '—' : esc(u.site_name || 'Any location')}</td>
        <td>${u.role === 'admin' ? '—' : u.device_bound ? `<span class="badge ok">Registered</span> <span class="muted">${esc(u.device_model || '')}</span>` : '<span class="badge warn">Not registered</span>'}</td>
        <td>${u.active ? '<span class="badge ok">Active</span>' : '<span class="badge bad">Disabled</span>'}</td>
        <td><div class="actions">
          <button class="btn small" data-act="edit" data-id="${u.id}">Edit</button>
          ${u.role === 'employee' && u.device_bound ? `<button class="btn small" data-act="device" data-id="${u.id}">Reset phone</button>` : ''}
          <button class="btn small" data-act="pw" data-id="${u.id}">Reset password</button>
          <button class="btn small ${u.active ? 'danger' : ''}" data-act="toggle" data-id="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
        </div></td></tr>`).join('')}</tbody>`;
    $$('[data-act]', t).forEach((b) => b.addEventListener('click', () => empAction(b.dataset.act, emps.find((u) => String(u.id) === b.dataset.id))));
  };
  async function empAction(act, u) {
    if (act === 'edit') {
      openModal(`<form><h3>Edit ${esc(u.name)}</h3>
        <label>Name<input name="name" value="${esc(u.name)}" required></label>
        ${u.role === 'employee' ? `<label>Work location<select name="site_id">${siteOptions(u.site_id)}</select></label>` : ''}
        <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      async (v) => { await api('PUT', `/admin/employees/${u.id}`, { name: v.name, ...(u.role === 'employee' ? { site_id: v.site_id || null } : {}) }); loaders.employees(); });
    } else if (act === 'device') {
      if (!confirm(`Reset the registered phone for ${u.name}? They can then log in on a new phone.`)) return;
      await api('PUT', `/admin/employees/${u.id}`, { reset_device: true });
      toast('Phone reset — the next phone they log in with will be registered.');
      loaders.employees();
    } else if (act === 'pw') {
      openModal(`<form><h3>New password for ${esc(u.name)}</h3>
        <label>New password<input name="password" minlength="6" required></label>
        <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      async (v) => { await api('PUT', `/admin/employees/${u.id}`, { password: v.password }); toast('Password updated'); });
    } else if (act === 'toggle') {
      try { await api('PUT', `/admin/employees/${u.id}`, { active: !u.active }); } catch (e) { return toast(e.message); }
      loaders.employees();
    }
  }
  $('#add-emp').addEventListener('click', async () => {
    sitesCache = await api('GET', '/admin/sites');
    openModal(`<form><h3>Add employee</h3>
      <label>Employee code (used to log in)<input name="emp_code" required></label>
      <label>Full name<input name="name" required></label>
      <label>Password<input name="password" minlength="6" required></label>
      <label>Work location<select name="site_id">${siteOptions('')}</select></label>
      <label>Role<select name="role"><option value="employee">Employee (mobile app)</option><option value="admin">Admin (dashboard)</option></select></label>
      <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`,
    async (v) => { await api('POST', '/admin/employees', { ...v, site_id: v.site_id || null }); toast('Employee added'); loaders.employees(); });
  });

  // ---------- Sites ----------
  loaders.sites = async () => {
    sitesCache = await api('GET', '/admin/sites');
    const t = $('#site-table');
    t.innerHTML = `<thead><tr><th>Name</th><th>Coordinates</th><th class="num">Radius</th><th>Check-in requires</th><th>Map</th><th>Actions</th></tr></thead><tbody>${
      sitesCache.length ? sitesCache.map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</td>
        <td class="num">${s.radius_m} m</td>
        <td>${networkCell(s)}</td><td><a target="_blank" rel="noopener" href="https://maps.google.com/?q=${s.lat},${s.lng}">Open</a></td>
        <td><div class="actions"><button class="btn small" data-edit="${s.id}">Edit</button><button class="btn small" data-conn="${s.id}">Office connector</button><button class="btn small danger" data-del="${s.id}">Delete</button></div></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No locations yet. Add your office so employees can check in.</td></tr>'}</tbody>`;
    $$('[data-edit]', t).forEach((b) => b.addEventListener('click', () => siteForm(sitesCache.find((s) => String(s.id) === b.dataset.edit))));
    $$('[data-conn]', t).forEach((b) => b.addEventListener('click', () => connectorDialog(sitesCache.find((s) => String(s.id) === b.dataset.conn))));
    $$('[data-del]', t).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this location? Employees assigned to it will be able to check in at any location.')) return;
      await api('DELETE', `/admin/sites/${b.dataset.del}`);
      loaders.sites();
    }));
  };
  // Connector is "online" if it reported in the last 5 minutes.
  const connectorOnline = (s) => s.connector_seen_at && Date.now() - new Date(s.connector_seen_at) < 5 * 60 * 1000;
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDateTime(iso);
  };
  function connectorBadge(s) {
    const addrs = (s.connector_addresses || []).map((a) => a.ip).join(', ');
    if (!s.connector_seen_at) return '<span class="badge warn">Connector not started</span>';
    if (connectorOnline(s)) return `<span class="badge ok">Connector online</span> <span class="muted">${esc(addrs)}</span>`;
    return `<span class="badge bad">Connector offline</span> <span class="muted">last report ${esc(ago(s.connector_seen_at))}</span>`;
  }
  function networkCell(s) {
    const parts = [];
    if (s.office_ips) parts.push(`<span class="badge ok">Office Wi-Fi</span> <span class="muted">${esc(s.office_ips)}</span>`);
    if (s.connector_token) parts.push(connectorBadge(s));
    return parts.length ? parts.join('<br>') : '<span class="badge warn">GPS only</span>';
  }

  function connectorDialog(s) {
    const link = s.connector_token ? `${location.origin}/office.html#${s.connector_token}` : '';
    const script = s.connector_token
      ? `curl -fsS -X POST -H "content-type: application/json" -d "{\"token\":\"${s.connector_token}\"}" ${location.origin}/api/office-ping`
      : '';
    openModal(`<h3>Office connector — ${esc(s.name)}</h3>
      <p class="muted">For offices whose internet address changes (dynamic IP). Open the link below on any computer in the office that stays on —
        a reception PC, a tablet or a mini-PC. It tells the server the office's current address every minute, so the office Wi-Fi check keeps working
        when the address changes.</p>
      ${s.connector_token ? `
        <div>${connectorBadge(s)}</div>
        <label>Connector link — open it on the office computer
          <input readonly value="${esc(link)}" id="conn-link"></label>
        <div class="actions"><button type="button" class="btn" id="conn-copy">Copy link</button></div>
        <p class="muted">Keep this link private: anyone who has it can make their own internet address count as the office.
          Every new office address is listed under <strong>Security alerts → Office address changes</strong>.</p>
        <details><summary class="muted">Prefer a script? (Windows Task Scheduler, cron, router)</summary>
          <p class="muted">Run this every minute on a computer in the office instead of keeping the page open:</p>
          <input readonly value="${esc(script)}"></details>
        <div class="modal-actions">
          <button type="button" class="btn danger" id="conn-off">Turn off</button>
          <button type="button" class="btn" id="conn-new">Replace link</button>
          <button type="button" class="btn primary" data-close>Done</button>
        </div>`
      : `<div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="button" class="btn primary" id="conn-new">Create connector link</button>
        </div>`}`);
    $('#conn-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { $('#conn-link').select(); }
    });
    $('#conn-new')?.addEventListener('click', async () => {
      if (s.connector_token && !confirm('Replace the link? The old link stops working; open the new one on the office computer.')) return;
      const updated = await api('POST', `/admin/sites/${s.id}/connector`);
      await loaders.sites();
      modal.close();
      connectorDialog(updated);
    });
    $('#conn-off')?.addEventListener('click', async () => {
      if (!confirm('Turn off the connector? Check-ins will then only be checked against the addresses entered on the location.')) return;
      await api('DELETE', `/admin/sites/${s.id}/connector`);
      modal.close();
      loaders.sites();
    });
  }

  function siteForm(s = {}) {
    openModal(`<form><h3>${s.id ? 'Edit' : 'Add'} location</h3>
      <label>Name<input name="name" value="${esc(s.name || '')}" required></label>
      <label>Latitude<input name="lat" type="number" step="any" value="${s.lat ?? ''}" required></label>
      <label>Longitude<input name="lng" type="number" step="any" value="${s.lng ?? ''}" required></label>
      <label>Allowed radius (metres)<input name="radius_m" type="number" min="10" max="5000" value="${s.radius_m ?? 150}" required></label>
      <p class="muted">Tip: in Google Maps, right-click the building and click the coordinates to copy them. Or stand at the site and use your location.</p>
      <button type="button" class="btn" id="use-loc">Use my current location</button>
      <label>Office Wi-Fi (public internet address)
        <textarea name="office_ips" rows="2" placeholder="e.g. 203.0.113.7">${esc(s.office_ips || '')}</textarea></label>
      <p class="muted">When filled in, check-ins at this location are only accepted from this network. Stand in the office, connect to its Wi-Fi and click
        the button below. Add several separated by commas if the office has more than one internet line.
        If your router has <strong>dynamic DNS</strong>, enter its name instead (e.g. <code>myoffice.ddns.net</code>).
        If the address changes and you have no dynamic DNS, leave this empty and use <strong>Office connector</strong> on the Locations page.
        Leave empty (and no connector) for GPS-only sites.</p>
      <button type="button" class="btn" id="use-net">Use this network</button>
      <p class="muted" id="net-note"></p>
      <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    async (v) => { await api(s.id ? 'PUT' : 'POST', s.id ? `/admin/sites/${s.id}` : '/admin/sites', v); loaders.sites(); });
    $('#use-net').addEventListener('click', async () => {
      const r = await api('GET', '/admin/my-ip');
      if (r.private) {
        // Never add a private address: employees' requests would never match it.
        $('#net-note').textContent = `Not added: ${r.ip} is a private address, not the office's internet address. Either you are on the same network as the server, or the server is behind a proxy it doesn't trust (see TRUST_PROXY in the README).`;
        return;
      }
      const box = $('[name=office_ips]', modal);
      const list = box.value.split(/[\s,;]+/).filter(Boolean);
      if (!list.includes(r.suggestion)) list.push(r.suggestion);
      box.value = list.join(', ');
      $('#net-note').textContent = `Added ${r.suggestion}. Make sure you are on the office Wi-Fi (not mobile data or a VPN).`;
    });
    $('#use-loc').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location not available in this browser');
      navigator.geolocation.getCurrentPosition(
        (p) => { $('[name=lat]', modal).value = p.coords.latitude.toFixed(6); $('[name=lng]', modal).value = p.coords.longitude.toFixed(6); },
        (e) => toast(e.message), { enableHighAccuracy: true, timeout: 15000 });
    });
  }
  $('#add-site').addEventListener('click', () => siteForm());

  // ---------- Alerts ----------
  const CODE_LABEL = {
    DEV_MODE: ['Developer mode on', 'bad'], MOCK_LOCATION: ['Fake GPS', 'bad'], ROOTED: ['Rooted / jailbroken', 'bad'],
    OUT_OF_RANGE: ['Outside location', 'warn'], NOT_OFFICE_NETWORK: ['Not on office Wi-Fi', 'warn'], LOW_ACCURACY: ['Weak GPS', 'info'], STALE: ['Old selfie', 'info'],
  };
  loaders.alerts = async () => {
    const rows = await api('GET', '/admin/rejected');
    $('#alert-table').innerHTML = `<thead><tr><th>When</th><th>Employee</th><th>Reason</th><th>Message</th><th>Map</th></tr></thead><tbody>${
      rows.length ? rows.map((r) => { const [l, c] = CODE_LABEL[r.code] || [r.code, 'info']; return `<tr>
        <td>${fmtDateTime(r.ts)}</td><td><strong>${esc(r.name || '—')}</strong><br><span class="muted">${esc(r.emp_code || '')}</span></td>
        <td><span class="badge ${c}">${esc(l)}</span></td><td>${esc(r.reason)}</td>
        <td>${r.lat != null ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${r.lat},${r.lng}">Open</a>` : '—'}</td></tr>`; }).join('')
      : '<tr><td colspan="5" class="empty">No blocked punches. 👍</td></tr>'}</tbody>`;
    const changes = await api('GET', '/admin/network-changes');
    $('#netchange-table').innerHTML = `<thead><tr><th>When</th><th>Location</th><th>New office address</th></tr></thead><tbody>${
      changes.length ? changes.map((c) => `<tr><td>${fmtDateTime(c.ts)}</td><td>${esc(c.site_name || '—')}</td><td>${esc(c.ip)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">No changes reported by an office connector.</td></tr>'}</tbody>`;
  };

  // ---------- Settings ----------
  $('#weekend-days').innerHTML = DAY_NAMES.map((d, i) => `<label><input type="checkbox" value="${i}"> ${d}</label>`).join('');
  loaders.settings = async () => {
    const s = await api('GET', '/admin/settings');
    const f = $('#settings-form');
    for (const k of ['company_name', 'work_start', 'work_end', 'grace_minutes']) f.elements[k].value = s[k];
    f.elements.holidays.value = (s.holidays || '').split(',').filter(Boolean).join('\n');
    const wk = new Set((s.weekend_days || '').split(',').filter(Boolean));
    $$('#weekend-days input').forEach((c) => (c.checked = wk.has(c.value)));
  };
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      company_name: f.elements.company_name.value, work_start: f.elements.work_start.value, work_end: f.elements.work_end.value,
      grace_minutes: f.elements.grace_minutes.value, holidays: f.elements.holidays.value,
      weekend_days: $$('#weekend-days input:checked').map((c) => c.value).join(','),
    };
    try {
      const s = await api('PUT', '/admin/settings', body);
      $('#brand').textContent = s.company_name;
      toast('Settings saved');
    } catch (ex) { toast(ex.message); }
  });

  // ---------- Start ----------
  async function start() {
    showApp(true);
    try {
      const s = await api('GET', '/admin/settings');
      $('#brand').textContent = s.company_name;
      companyTz = s.timezone || undefined;
      if (s.today) $('#day-input').value = s.today;
    } catch { return; }
    let tab = 'today';
    try { tab = localStorage.getItem('att_tab') || 'today'; } catch {}
    showTab(loaders[tab] ? tab : 'today');
  }
  if (token) start(); else showApp(false);
})();
