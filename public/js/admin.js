/* Production dashboard: works through the print queue one item at a time. */
(function () {
  'use strict';

  const { esc, money, toast, t, tr } = POD;
  // The password is sent once to sign in; after that a session token is used.
  const KEY = 'pod-admin-token';
  const $ = (id) => document.getElementById(id);
  // Arabic lists with numbers: a "·" next to Arabic-Indic digits reads as the zero "٠" ("١٣ طلب · ١٣ منتج" looks like
  // "١٣ طلب ٠١٣ منتج"), so the Arabic page separates them with the Arabic comma. English keeps the dot.
  const SEP = () => (POD.lang === 'ar' ? '، ' : ' · ');
  /** A text from the strings with "·" between numbers: the same, Arabic comma in Arabic. */
  const listed = (s) => (POD.lang === 'ar' ? String(s).replace(/ · /g, '، ') : String(s));
  /*
   * Number boxes ([data-num]: coupons, expenses, the shipping cost in admin.html; Accounts' real costs and the
   * prices & costs table drawn below) are text boxes with a number keyboard: a number box drops what an Arabic
   * keyboard types ("١٥", "٢٫٥") and stays empty, which read as 0 or deleted a saved cost. What is typed is read
   * with POD.latinDigits (Arabic-Indic and Persian digits, the Arabic decimal "٫"); grouping marks and spaces are
   * left out. data-min and data-whole keep the checks the number boxes had (shown when the form is sent);
   * data-need: an empty box is a mistake too (never taken as 0).
   */
  const numText = (el) => POD.latinDigits(el.value).replace(/[\s\u066C\u200E\u200F]/g, '').replace(/\u2212/g, '-');
  function numProblem(el) {
    const s = numText(el);
    if (!s) return el.hasAttribute('data-need') ? t('num.empty') : '';
    if (!/^-?\d*\.?\d+$/.test(s)) return t('num.bad');
    const v = Number(s);
    if (el.hasAttribute('data-whole') && !Number.isInteger(v)) return t('num.whole');
    if (el.dataset.min != null && v < Number(el.dataset.min)) return t('num.min', { min: POD.num(Number(el.dataset.min)) });
    return '';
  }
  /** Check a number box now (the browser shows the message when its form is sent); true when it is fine. */
  const checkNum = (el) => {
    el.setCustomValidity(numProblem(el));
    return el.checkValidity();
  };
  /** A number box's value: '' when empty, else the number as 0-9 text ("١٥٫٥" → "15.5"). */
  const numValue = (el) => numText(el);
  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('input[data-num]')) checkNum(e.target);
  });
  /**
   * Forms that add something (a ready design, an expense, a coupon): one request at a time. While it is out the
   * form's button is off and another submit (a double-click, Enter pressed again) is ignored, so nothing is saved
   * twice (QA 25 Nov: a double-click added the expense twice and counted it twice in the net profit).
   */
  const sending = new WeakSet();
  async function sendOnce(form, work) {
    if (sending.has(form)) return false;
    sending.add(form);
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await work();
      return true;
    } finally {
      sending.delete(form);
      buttons.forEach((b) => { b.disabled = false; });
    }
  }
  /**
   * A string as HTML with some of its values (names a customer or the owner typed) each in its own direction:
   * "Print Co." keeps its dot and "عيد Eid" its order inside a line of the other language (QA 25 Nov).
   */
  function tIsolated(key, params, own) {
    const marks = Object.keys(own).map((k, n) => [k, `\u0001${n}\u0001`]);
    let html = esc(listed(t(key, { ...params, ...Object.fromEntries(marks) })));
    for (const [k, m] of marks) html = html.replace(m, `<bdi dir="auto">${esc(own[k])}</bdi>`);
    return html;
  }
  try { sessionStorage.removeItem('pod-admin-password'); } catch (e) { /* old versions kept the password */ }
  let token = sessionStorage.getItem(KEY) || '';
  const authHeader = () => ({ Authorization: 'Bearer ' + token });
  /*
   * Who is signed in and what they may do (public/js/admin-roles.js): the session's roles and permissions.
   * An answer from before roles (no perms): the owner can do everything, a product manager ('products') has
   * the catalogue (Products and Ready designs), as before. role: 'owner', or 'staff' for everyone else.
   */
  const ROLE_KEY = 'pod-admin-role';
  let role = '';
  let who = '';
  let access = null; // AdminRoles.access(session)
  let sessionAt = 0;
  const can = (perm) => AdminRoles.can(access, perm);
  /** The only admin routes an old product manager's token may use (the owner's answer 401 and would sign them out). */
  const staffRoute = (url) => /^\/api\/admin\/(session|logout|catalog|library)(\/|\?|$)/.test(url) && !/^\/api\/admin\/library\/settings/.test(url);
  /** Until the page knows who is signed in, and for an old product manager's sign-in, only those routes are called. */
  const mayCall = (url) => staffRoute(url) || Boolean(access && (access.system || access.owner));
  let tab = 'queue';
  let lastQueue = null;
  let lastOrders = null;
  let lastFilm = null;
  const filmPicked = new Set();
  const filmSeen = new Set();
  let filmMsg = '';

  /** Express orders: the order's delivery (on the item, else from the orders list), and a small pill for job cards. */
  let ordersFetchedAt = 0;
  const deliveryOf = (item) => item.delivery || (lastOrders && (lastOrders.find((o) => o.id === item.orderId) || {}).delivery) || null;
  function expressPill(item) {
    const d = deliveryOf(item);
    if (!d || d.speed !== 'express') return '';
    return ` <span class="pill dlv-express-pill" title="${esc(t('delivery.by', { date: POD.day(d.by) }))}">${esc(d.by ? listed(t('admin.expressBy', { date: day(d.by) })) : t('delivery.express'))}</span>`;
  }
  /** The customer asked at checkout for one sample first (printed and checked before the rest). */
  const wantsSample = (item) => Boolean(item && (item.sample === true || (item.approval && item.approval.sample === true)));
  function samplePill(item) {
    return wantsSample(item) ? ` <span class="pill sample-pill" title="${esc(t('admin.sampleHelp'))}">${esc(t('admin.samplePill'))}</span>` : '';
  }
  /** Job lists don't carry the order's delivery: read the orders once (again when a new order shows up). */
  async function ensureOrders(items) {
    if (!can('orders.view')) return false; // (Catalogue's Review: no orders list)
    const known = new Set((lastOrders || []).map((o) => o.id));
    if (lastOrders && items.every((i) => !i || !i.orderId || known.has(i.orderId))) return false;
    if (Date.now() - ordersFetchedAt < 30000) return false;
    ordersFetchedAt = Date.now();
    try {
      lastOrders = (await adminApi('/api/admin/orders')).orders;
      return true;
    } catch (e) {
      if (e.status === 401) throw e;
      return false;
    }
  }

  function renderFilm(items) {
    for (const id of [...filmPicked]) if (!items.some((i) => i.id === id)) filmPicked.delete(id);
    $('film-list').innerHTML = items.length
      ? items.map((it) => `
        <label class="card queue-row film-row">
          <input type="checkbox" data-film="${it.id}" ${filmPicked.has(it.id) || (!it.filmBatch && !filmSeen.has(it.id)) ? 'checked' : ''}>
          <img src="${esc(it.sides[0].previewUrl)}" alt="" ${zoomAttr(it)}>
          <div>
            <strong>${esc(tr(it.productName))}</strong> ${pill(it.status)}${expressPill(it)}${samplePill(it)}${piecesPill(it)} ${it.filmBatch ? `<span class="pill printed">${esc(t('admin.onFilm', { id: it.filmBatch.id }))}</span>` : ''}
            <div class="muted small">${esc([it.orderNumber, t('admin.spec.itemOf', { i: it.position, n: it.of }), ...colourSizeText(it), it.sides.map((sd) => `${tr(sd.name)} ${t('admin.cmSize', { w: POD.num(sd.widthIn * 2.54), h: POD.num(sd.heightIn * 2.54) })}`).join(' + ')].join(SEP()))}</div>
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
    // Until we know who is signed in, and for an old product manager's sign-in, owner-only routes are never called.
    if (!mayCall(url)) {
      const err = new Error(t('pm.ownerOnly'));
      err.status = 403;
      err.ownerOnly = true;
      throw err;
    }
    let body;
    try {
      body = await POD.api(url, { ...options, headers: { ...(options.headers || {}), ...authHeader() } });
    } catch (e) {
      if (e.status === 401) signOut(e.message);
      throw e;
    }
    // A staff member's change to products or money waits for an owner (HTTP 202 { pending, approval }): said once
    // ("Sent to an owner for approval"), and thrown as an error marked `pending`, so no caller takes the answer for
    // the saved thing and the form stays as typed (the change isn't live).
    return AdminRoles.settle(body);
  }
  /** A change sent for an owner's approval (see adminApi): not a failure, nothing more to say. */
  const sentForApproval = (e) => AdminRoles.isPendingError(e);

  function signOut(message) {
    const wasIn = Boolean(token);
    if (token) fetch('/api/admin/logout', { method: 'POST', headers: authHeader() }).catch(() => {});
    token = '';
    role = '';
    who = '';
    access = null;
    sessionAt = 0;
    sessionStorage.removeItem(KEY);
    try { sessionStorage.removeItem('pod-admin-tab'); } catch (e) { /* private mode */ }
    sessionStorage.removeItem(ROLE_KEY);
    if (window.AdminProducts) AdminProducts.reset();
    if (window.AdminUploads) AdminUploads.reset();
    if (window.AdminRights) AdminRights.reset();
    for (const m of [window.AdminStaff, window.AdminApprovals, window.AdminActivity, window.AdminOrderFilters]) if (m) m.reset();
    applyRole();
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
      // A username: the person's own login. None: the shared owner password (the emergency owner login).
      const username = $('username').value.trim().toLowerCase();
      const res = await POD.api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(username ? { username, password: $('password').value } : { password: $('password').value }),
      });
      token = res.token;
      sessionStorage.setItem(KEY, token);
      // (Whether email is set up: right away, not only after a reload.)
      if (typeof res.emailReady === 'boolean') emailReady = res.emailReady;
      setAccess(res, res.shown || res.name || username);
      sessionAt = Date.now();
      $('password').value = '';
      $('weak-pw').hidden = !(role === 'owner' && res.weakPassword);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('logout').addEventListener('click', () => {
    if (window.AdminProducts && AdminProducts.busy() && !confirm(t('pm.leaveConfirm'))) return;
    signOut();
  });

  /** Who is signed in, from the sign-in answer or the session: the tabs and the screens follow. */
  function setAccess(session, fallbackName) {
    access = AdminRoles.access(session, fallbackName);
    role = access.owner ? 'owner' : 'staff';
    who = access.shown;
    sessionStorage.setItem(ROLE_KEY, role);
    applyRole();
  }
  const roleNames = (roles) => roles.map((r) => t('role.' + r)).join(POD.lang === 'ar' ? '، ' : ', ');
  /** Parts of the page (admin.html) that change things, and the permission each needs. */
  const STATIC_PERMS = [['lib-add', 'library.edit'], ['house-form', 'houses.edit'], ['cp-form', 'coupons.edit'], ['acc-exp-form', 'expenses.edit'], ['acc-ship-save', 'costs.edit'], ['notify-card', 'settings']];
  /**
   * The tabs this person may use (the others are hidden), who is signed in ("Mostafa · Catalogue"), the emergency
   * owner login's warning, and the parts of the screens that need a permission to change things.
   */
  function applyRole() {
    document.querySelectorAll('[data-tab]').forEach((b) => { b.hidden = !AdminRoles.tabAllowed(access, b.dataset.tab); });
    // (An old owner sign-in, the shared password before roles: no name to show, as before.)
    const named = Boolean(access && (access.system || !access.owner));
    // (The emergency login is the shared owner password, not a person.)
    const name = !access ? '' : access.emergency ? t('me.emergencyName') : access.shown || t('role.owner');
    // (The name in its own direction: "Mostafa مصطفى" stays in one piece next to the roles.)
    const whoText = !named ? '' : access.emergency ? name : t('me.who', { name: `\u2068${name}\u2069`, roles: roleNames(access.roles) });
    $('me-menu').hidden = !named;
    if (!named) $('me-menu').open = false;
    $('admin-who').textContent = whoText;
    $('me-who').textContent = whoText;
    $('me-btn').title = whoText || t('me.menu');
    // Personal logins change their own password; the shared emergency password is changed on the server.
    $('me-pw').hidden = !(access && access.system && !access.emergency);
    $('emergency-bar').hidden = !(access && access.emergency);
    // Approvals for owners, "My requests" for the others.
    const apLabel = $('ap-tab-label');
    apLabel.dataset.i18n = access && !access.owner ? 'ap.mine' : 'ap.tab';
    apLabel.textContent = t(apLabel.dataset.i18n);
    if (tab === 'approvals') showTab(tab);
    renderApprovalsBadge();
    // Forms that change things: only for those who may (the shop's shipping cost: seen by all of Accounts).
    for (const [id, perm] of STATIC_PERMS) $(id).hidden = !can(perm);
    $('acc-ship-cost').disabled = !can('costs.edit');
    // (Reset links are the owners': the team's help says who makes one.)
    const prHelp = $('acc-prices-help');
    if (prHelp) {
      prHelp.dataset.i18n = can('prices.edit') ? 'acc.pricesHelp' : 'acc.pricesHelpTeam';
      prHelp.textContent = t(prHelp.dataset.i18n);
    }
    const cuHelp = $('cu-help');
    if (cuHelp) {
      cuHelp.dataset.i18n = can('customers.contact') ? 'cu.help' : 'cu.helpTeam';
      cuHelp.textContent = t(cuHelp.dataset.i18n);
    }
    if (lastLibrary) renderLibRule();
    if (access && !access.owner) $('weak-pw').hidden = true;
    if (access && !AdminRoles.tabAllowed(access, tab)) {
      const next = AdminRoles.pickTab(access, tab);
      if (next) showTab(next);
    }
  }
  /** The Approvals tab's badge: changes waiting for an owner (owners), or the person's own waiting requests. */
  function renderApprovalsBadge() {
    const el = $('ap-count');
    const n = AdminRoles.badgeCount(access);
    el.hidden = !n;
    el.textContent = n ? POD.num(n) : '';
    el.title = n ? POD.plural('ap.count', n) : '';
  }
  /** Who is signed in (the roles are kept on the server with the token); read again now and then (badge, roles). */
  async function loadSession() {
    const r = await adminApi('/api/admin/session');
    // The person's own name, as after signing in ("Mostafa مصطفى", not the username "mostafa").
    if (typeof r.emailReady === 'boolean') emailReady = r.emailReady;
    setAccess(r, r.shown || r.name);
    sessionAt = Date.now();
    $('weak-pw').hidden = !(role === 'owner' && r.weakPassword);
  }

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    if (tab === 'products' && b.dataset.tab !== 'products' && window.AdminProducts && AdminProducts.busy() && !confirm(t('pm.leaveConfirm'))) return;
    showTab(b.dataset.tab);
    refresh().catch((e) => { if (e && !e.ownerOnly && e.status !== 401) toast(e.message, 'error'); });
  }));
  function showTab(next) {
    tab = next;
    // (Kept for this browser tab: a reload opens the same tab, when this person may open it.)
    try { sessionStorage.setItem('pod-admin-tab', tab); } catch (e) { /* private mode */ }
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    $('tab-products').hidden = tab !== 'products';
    // (The heading says which tab is open: its button's own words, except the queue and products.)
    const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
    const tabKey = tabBtn && (tabBtn.dataset.i18n || (tabBtn.querySelector('[data-i18n]') || {}).dataset?.i18n);
    $('dash-title').dataset.i18n = tab === 'products' ? 'pm.pageTitle' : tab === 'queue' || !tabKey ? 'admin.queueTitle' : tabKey;
    $('dash-title').textContent = t($('dash-title').dataset.i18n);
    $('tab-queue').hidden = tab !== 'queue';
    $('tab-orders').hidden = tab !== 'orders';
    $('tab-review').hidden = tab !== 'review';
    $('tab-film').hidden = tab !== 'film';
    $('tab-library').hidden = tab !== 'library';
    $('tab-houses').hidden = tab !== 'houses';
    $('tab-accounts').hidden = tab !== 'accounts';
    $('tab-coupons').hidden = tab !== 'coupons';
    $('tab-customers').hidden = tab !== 'customers';
    $('tab-preview').hidden = tab !== 'preview';
    $('tab-rights').hidden = tab !== 'rights';
    $('tab-staff').hidden = tab !== 'staff';
    $('tab-approvals').hidden = tab !== 'approvals';
    $('tab-activity').hidden = tab !== 'activity';
    $('tab-backup').hidden = tab !== 'backup';
    // /admin#rights (the link in the owner's alert for a rights request) opens Rights requests; the address
    // follows that tab, so a reload stays on it and leaving it doesn't come back to it.
    if (tab === 'rights' && location.hash !== '#rights') history.replaceState(null, '', '#rights');
    else if (tab !== 'rights' && location.hash === '#rights') history.replaceState(null, '', location.pathname + location.search);
  }

  const NEXT = {
    queued: { status: 'printing', label: 'admin.start' },
    printing: { status: 'printed', label: 'admin.markPrinted' },
    printed: { status: 'shipped', label: 'admin.markShipped' },
  };
  // Items the shop or the customer still has to approve: never printable.
  const IN_REVIEW = new Set(['review', 'awaiting_approval', 'changes_requested']);
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
  /** "1,200 copies" for packs (200 cards + 1000 cards), else "2 pieces" (QA 25 Nov). */
  const countText = (item) => {
    const copies = POD.packCopies ? POD.packCopies(qtyLines(item)) : null;
    return copies != null ? POD.plural(POD.packWord ? POD.packWord(qtyLines(item)) : 'qty.copies', copies) : piecesText(piecesOf(item));
  };
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
      ${item.merge || item.kind === 'photoset' ? '' : `<div class="qty-names-note">${esc(t('adminQty.sameArt'))}</div>`}`;
  }
  /** Short form for lists: ● Black: S×2 M×5 L×3 · ● White: M×2. */
  function qtySummary(item) {
    return `<div class="qty-sum">${qtyGroups(item).map((g) => `<span class="qty-grp">${swatch(g.color)}<b>${esc(tr(g.color.name))}${tr(g.color.name) ? ':' : ''}</b>${g.lines.map((l) => `<span class="qty-chip">${esc(sizeName(l))}×<b>${esc(POD.num(Number(l.qty)))}</b></span>`).join('')}</span>`).join('')}</div>`;
  }
  const piecesPill = (item) => (hasQty(item) ? ` <span class="qty-pieces">${esc(countText(item))}</span>` : '');
  /** "Black · M" for one piece, or nothing when the summary below lists the colours and sizes. */
  const colourSizeText = (item) => (hasQty(item) ? [] : [tr(item.color.name), tr(item.size.label)]);
  const anyDark = (item) => (qtyLines(item).length ? qtyLines(item).some((l) => l.color && isDark(l.color.hex)) : isDark(item.color.hex));

  /** One line the customer typed (Arabic, English or both): its own direction, so it is never scrambled. */
  const line = (v) => `<bdi dir="auto">${esc(v)}</bdi>`;
  /** The same for plain text (a <select>'s options can't hold a <bdi>): "Print Co." between isolating marks. */
  const isolate = (v) => `\u2068${v}\u2069`;
  function address(c) {
    if (c.governorate || c.address) {
      // City and governorate with the page's comma: "Dokki, Giza" / «الدقي، الجيزة» (not "Dokki، Giza" in English).
      // (Only the city typed by the customer is isolated: «Maadi، القاهرة» reads city then governorate in Arabic too,
      // as on the invoice. QA 26 Nov.)
      const place = [c.city ? line(c.city) : '', c.governorateName ? esc(tr(c.governorateName)) : ''].filter(Boolean).join(POD.lang === 'ar' ? '، ' : ', ');
      return [...[c.name, c.address].filter(Boolean).map(line), place, ...(c.notes ? [line(`(${c.notes})`)] : [])].filter(Boolean).join('<br>');
    }
    // Orders placed before the Egypt checkout.
    return [c.name, c.address1, c.address2, [c.city, c.region, c.postalCode].filter(Boolean).join(' '), c.country].filter(Boolean).map(line).join('<br>');
  }

  function redrawLine(item) {
    const r = item.redraw;
    if (!r) return esc(t('admin.redraw.off'));
    if (r.status === 'off' && r.reason === 'aiOff') return esc(t('admin.redraw.offAi'));
    const line = esc(t('admin.redraw.' + r.status, { done: POD.num(r.done || 0), total: POD.num(r.total || 0) }));
    const kept = r.failed && r.failed.length ? `${SEP()}${esc(POD.plural('admin.redraw.kept', r.failed.length))}` : '';
    const again = ['done', 'failed'].includes(r.status) ? ` <button class="btn btn-sm" data-redraw="${esc(item.id)}">${esc(t('admin.redraw.again'))}</button>` : '';
    return line + kept + again;
  }
  function placementText(o) {
    const parts = [];
    if (o.y) parts.push(t(o.y > 0 ? 'area.lower' : 'area.higher', { n: POD.num(Math.abs(o.y)) }));
    if (o.x) parts.push(t(o.x > 0 ? 'area.right' : 'area.left', { n: POD.num(Math.abs(o.x)) }));
    return parts.join(POD.lang === 'ar' ? ' و' : ', ');
  }
  /**
   * How the item is made (as src/dispatch.js processesOf): embroidery with a printed side (the back, or the
   * front next to the stitches) is ['embroidery', 'dtg'], so the print isn't missed; otherwise its one process.
   * (Each side of an embroidery design records its own process; older ones were embroidery only.)
   */
  function processesOf(item, sides = item.sides) {
    if (item.method !== 'embroidery') return item.process ? [item.process] : [];
    return ['embroidery', ...new Set((sides || []).map((s) => s && s.process).filter((p) => p && p !== 'embroidery'))];
  }
  /** "Embroidery + DTG print" / «تطريز + طباعة DTG». */
  const methodBoth = (procs) => t('admin.methodBoth', { print: procs.filter((p) => p !== 'embroidery').map((p) => (hasStr('method.' + p) ? t('method.' + p) : p.toUpperCase())).join(' + ') });
  /**
   * A thread colour's name in the page's language: «دهبي» / "Gold" (QA 25 Nov: "Red / Gold / Lime" in Arabic).
   * The names are the shades of src/embroidery.js THREADS (js/i18n-admin-threads.js); an item keeps the English one.
   */
  const threadName = (c) => (c && hasStr('thread.' + c.name) ? t('thread.' + c.name) : String((c && c.name) || ''));
  function spec(item) {
    const c = item.customer;
    return `
      <dl class="spec">
        <dt>${esc(t('admin.spec.order'))}</dt><dd>${esc(item.orderNumber)}${SEP()}${esc(t('admin.spec.itemOf', { i: item.position, n: item.of }))}</dd>
        <dt>${esc(t('admin.spec.product'))}</dt><dd>${esc(tr(item.productName))}</dd>
        ${hasQty(item) ? `<dt>${esc(t('adminQty.title'))}</dt><dd class="qty-dd">${qtyTable(item)}</dd>` : `<dt>${esc(t('admin.spec.colourSize'))}</dt><dd>${esc(tr(item.color.name))} <span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(item.color.hex)}"></span>${SEP()}${esc(tr(item.size.label))}</dd>`}
        ${item.kind === 'photoset' ? `<dt>${esc(t('fmt.photos-zip'))}</dt><dd>${esc(listed(t('admin.photoFiles', { n: counted('admin.photos', (item.photos || []).length), prints: counted('admin.prints', (item.photos || []).reduce((n, p) => n + p.copies, 0)) })))}${SEP()}${esc(t('admin.photoSpec'))}${item.sides[0] && item.sides[0].dpi && item.sides[0].dpi < 150 ? `<div class="small" style="color:var(--warn);margin-top:4px">⚠ ${esc(t('admin.photoLowRes'))}</div>` : ''}</dd>` : item.sides.map((s) => `<dt>${esc(t('admin.spec.print', { side: tr(s.name) }))}</dt><dd><bdi dir="ltr">${cm(s.widthIn)} × ${cm(s.heightIn)} cm (${s.widthIn} × ${s.heightIn} in)</bdi>${s.bleedIn ? ` <bdi>${esc(t('admin.bleed', { mm: String(Math.round(s.bleedIn * 25.4)) /* in 0-9 like the sizes and pixels beside it (QA 25 Nov: ٣ next to 20.3 and 300) */ }))}</bdi>` : ''}${SEP()}<bdi dir="ltr">${s.widthPx} × ${s.heightPx} px · ${s.dpi} DPI · sRGB</bdi>${s.offsetCm ? `<div class="placement-note">📍 ${esc(t('admin.placement', { v: placementText(s.offsetCm) }))}</div>` : ''}</dd>`).join('')}
        ${item.emb ? `<dt>${esc(t('admin.emb'))}</dt><dd>
          <div><strong>${esc(listed(t('admin.embSummary', { n: POD.num(item.emb.stitches), c: POD.plural('emb.threads', item.emb.colors.length), w: item.emb.widthMm, h: item.emb.heightMm })))}</strong></div>
          <ol class="emb-threads">${item.emb.colors.map((c) => `<li><span class="dot" style="display:inline-block;vertical-align:middle;background:${esc(c.hex)}"></span> ${esc(threadName(c))} <span class="muted">(<bdi dir="ltr">${esc(c.hex)}</bdi>${SEP()}${esc(POD.num(c.stitches))})</span></li>`).join('')}</ol>
          ${(item.emb.warnings || []).filter((w) => w !== 'empty').map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(t('admin.embWarn.' + w))}</div>`).join('')}
        </dd>` : ''}
        ${item.merge ? `<dt>${esc(t('admin.mergeCopies'))}</dt><dd><strong>${esc(t('admin.mergeSpec', { n: POD.num(item.merge.count), cols: item.merge.columns.join(', ') }))}</strong></dd>` : ''}
        ${item.pattern ? `<dt>${esc(t('admin.pattern'))}</dt><dd><strong>${esc(t('admin.patternSpec', { tile: item.pattern.tileCm, repeat: t('pat.' + item.pattern.repeat), w: item.pattern.fabricCm[0], h: item.pattern.fabricCm[1] }))}</strong></dd>` : ''}
        ${item.process ? `<dt>${esc(t('admin.method'))}</dt><dd>
          ${(item.methods || []).length > 1 ? `<div class="btn-group" style="max-width:180px;margin-bottom:6px">${item.methods.map((m) => `<button class="btn btn-sm ${m === item.process ? 'active' : ''}" data-item="${item.id}" data-method="${m}">${esc(t('method.' + m))}</button>`).join('')}</div>` : ''}
          ${processesOf(item).length > 1
    ? `<div class="method-both"><strong>${esc(methodBoth(processesOf(item)))}</strong></div>${processesOf(item).map((p) => `<div class="method-step">${esc(t('process.' + p))}</div>`).join('')}`
    : esc(t(item.kind === 'photoset' ? 'process.photo' : item.kind === 'book' ? 'process.book' : 'process.' + item.process))}
          ${processesOf(item).includes('dtg') && anyDark(item) ? `<div class="small" style="color:var(--warn);margin-top:4px">${esc(t('admin.darkHint'))}</div>` : ''}
          ${item.filmBatch ? `<div><span class="pill printed">${esc(t('admin.onFilm', { id: item.filmBatch.id }))}</span></div>` : ''}
        </dd>` : ''}
        ${item.kind === 'book' ? `<dt>${esc(t('admin.bookFiles'))}</dt><dd>${redrawLine(item)}</dd>` : ''}
        ${item.kind === 'gangsheet' && item.sides[0] ? `<dt>${esc(t('admin.spec.print', { side: tr(item.sides[0].name) }))}</dt><dd>${esc(listed(t('admin.sheetInfo', { w: POD.num(item.sides[0].widthIn * 2.54), l: POD.num(Math.round(item.sides[0].heightIn * 2.54)), n: POD.num(item.pieces || 0), dpi: item.sides[0].dpi || '?' })))}</dd>` : ''}
        <dt>${esc(t('admin.spec.shipTo'))}</dt><dd>${address(c)}</dd>
        ${c.phone ? `<dt>${esc(t('admin.spec.phone'))}</dt><dd><a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a></dd>` : ''}
        ${c.email ? `<dt>${esc(t('admin.spec.email'))}</dt><dd><bdi dir="ltr">${esc(c.email)}</bdi></dd>` : ''}
        ${payLines(item)}
      </dl>`;
  }
  /**
   * How the order is paid, and the coupon. The amounts only when the answer has them: people without
   * orders.amounts (Operations) get no totals or discounts, and never see "EGP NaN".
   */
  function payLines(item) {
    const total = AdminRoles.isAmount(item.orderTotal) ? money(item.orderTotal) : '';
    const p = item.payment;
    let html = '';
    if (p && p.status === 'paid') html = `<dt>${esc(t('admin.spec.payment'))}</dt><dd><span class="pill pay-paid">${esc(t('admin.paidPill'))}</span>${total ? ` ${esc(t('admin.paidNothing', { amount: total }))}` : ''}</dd>`;
    else if (p && p.method === 'cod') html = `<dt>${esc(t('admin.spec.payment'))}</dt><dd>${esc(total ? t('admin.collect', { amount: total }) : t('ship.cod'))}</dd>`;
    if (item.coupon) html += `<dt>${esc(t('coupon.discount'))}</dt><dd><bdi dir="ltr">${esc(item.coupon.code)}</bdi>${AdminRoles.isAmount(item.coupon.discount) ? `${SEP()}-${esc(money(item.coupon.discount))}` : ''}</dd>`;
    return html;
  }

  const RECOMMENDED = { dtg: 'png', dtf: 'dtf-film', sublimation: 'png-mirror', uv: 'pdf', paper: 'pdf-marks', canvas: 'pdf', textile: 'png', embroidery: 'dst', engrave: 'laser-svg', lasercut: 'laser-svg' };
  const FORMATS_BY_METHOD = {
    dtg: ['png', 'dtg-white', 'pdf', 'tiff'],
    dtf: ['dtf-film', 'dtf-pdf', 'png', 'pdf'],
    sublimation: ['png-mirror', 'png', 'pdf', 'tiff'],
    uv: ['pdf', 'png', 'pdf-marks', 'tiff'],
    paper: ['pdf-marks', 'pdf', 'tiff', 'png'],
    canvas: ['pdf', 'tiff', 'png', 'pdf-marks'],
    textile: ['png', 'tiff', 'pdf'],
    embroidery: ['dst', 'stitches', 'png', 'pdf'],
    engrave: ['laser-svg', 'engrave-png', 'cut-svg', 'png'],
    lasercut: ['laser-svg', 'cut-svg', 'png'],
  };
  const isDark = (hex) => {
    const n = parseInt(String(hex || '#ffffff').slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.5;
  };
  function printFiles(item, s) {
    if (!can('files')) return '';
    if (item.kind === 'book') {
      return `
        <div class="print-files-block"><div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.bookFiles'))}</div><div class="print-files">
          ${['book-pdf', 'proof'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div></div>`;
    }
    if (item.kind === 'photoset') {
      const prints = (item.photos || []).reduce((n, p) => n + p.copies, 0);
      return `
        <div class="print-files-block"><div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.photoFiles', { n: counted('admin.photos', (item.photos || []).length), prints: counted('admin.prints', prints) }))}</div><div class="print-files">
          ${['photos-zip', 'proof'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div></div>`;
    }
    if (item.kind === 'gangsheet') {
      return `
        <div class="print-files-block"><div class="print-files">
          ${['sheet-pdf', 'sheet-pdf-plain', 'proof'].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div></div>`;
    }
    // Embroidered chest with a printed back: each side gets the files for how it is made.
    const proc = s.process || item.process;
    const rec = RECOMMENDED[proc] || 'png';
    const formats = (FORMATS_BY_METHOD[proc] || ['png', 'pdf', 'pdf-marks', 'png-mirror', 'tiff']).concat(s.hasSvg ? ['svg'] : []);
    // Name list: every copy with its own name. Shown once (with the first side); the side files below show copy 1.
    const mergeBlock = item.merge && item.sides[0] === s ? `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(listed(t('admin.mergeFiles', { n: POD.num(item.merge.count) })))}</div>
        <div class="print-files">
          ${mergeFormats(item).map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div>
      </div>` : '';
    // Booklets: every page together, in reading order or imposed for folding and stapling (shown with the first page).
    const bookletBlock = item.paged && item.sides[0] === s ? `
      <div class="print-files-block">
        <div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('admin.bookletFiles', { n: POD.num(item.sides.length) }))}</div>
        <div class="print-files">
          ${['booklet-imposed', 'booklet-pdf', ...(item.pdfSource ? ['source-pdf'] : [])].map((f, k) => `<button class="btn btn-sm ${k === 0 ? 'btn-primary' : ''}" data-download="${esc(s.printUrl)}?format=${f}">⬇ ${esc(t('fmt.' + f))}${k === 0 ? ` <span class="rec">· ${esc(t('admin.recommended'))}</span>` : ''}</button>`).join('')}
        </div>
      </div>` : '';
    return mergeBlock + bookletBlock + `
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
  const printPdfKey = (item) => (item.merge ? 'merge-pdf-marks' : item.kind === 'book' ? 'book-pdf' : item.kind === 'gangsheet' ? 'sheet-pdf' : item.kind === 'photoset' ? 'photos-zip' : 'pdf');
  /** Name-list files; garments (DTF / DTG) also get the names alone, to print over a plain base. */
  function mergeFormats(item) {
    return ['merge-pdf-marks', 'merge-pdf', 'merge-zip', 'merge-csv', ...(['dtf', 'dtg'].includes(item.process) ? ['merge-names-zip'] : [])];
  }
  /** "3 صور", "11 نسخة", "1 photo" (Arabic: 1, 2, 3–10, the rest). */
  function counted(base, n) {
    const k = n % 100;
    return t(`${base}.${n === 1 ? 'one' : n === 2 ? 'two' : k >= 3 && k <= 10 ? 'few' : 'many'}`, { n: POD.num(n) });
  }
  function sendFormats(item) {
    if (item.kind === 'book') return ['book-pdf', 'preview-pdf', 'proof'];
    if (item.merge) return [...mergeFormats(item), 'preview-pdf'];
    if (item.kind === 'photoset') return ['photos-zip', 'proof'];
    if (item.kind === 'gangsheet') return ['sheet-pdf', 'sheet-pdf-plain', 'preview-pdf', 'proof'];
    const procs = [...new Set([item.process, ...item.sides.map((sd) => sd.process)].filter(Boolean))];
    if (item.paged) return ['booklet-imposed', 'booklet-pdf', ...(item.pdfSource ? ['source-pdf'] : []), 'preview-pdf'];
    const more = procs.flatMap((p) => FORMATS_BY_METHOD[p] || ['png', 'pdf-marks', 'png-mirror', 'tiff']).concat(item.sides.some((sd) => sd.hasSvg) ? ['svg'] : []);
    return [...new Set(['pdf', 'preview-pdf', ...more, ...(item.pattern ? ['repeat'] : [])])];
  }
  function sendDefaults(item) {
    const houseId = (housesData && (housesData.productHouses[item.productId] || (housesData.houses[0] && housesData.houses[0].id))) || '';
    const house = findHouse(houseId);
    // Only files offered for this item (photo sets have no preview PDF).
    const offered = sendFormats(item);
    // Embroidery goes as the stitch file with the picture of the stitches (a DST only marks where the thread
    // changes; the picture shows the colours, which the message lists too); a print PDF only when something is
    // printed too. Booklets go imposed.
    const stitched = item.sides.filter((sd) => (sd.process || item.process) === 'embroidery').length;
    const printedToo = item.sides.length > stitched;
    const main = item.paged ? ['booklet-imposed'] : [...(stitched ? ['dst', 'stitches'] : []), ...(!stitched || printedToo ? [printPdfKey(item)] : [])];
    return { houseId, channel: house ? house.prefer : 'email', formats: new Set([...main, 'preview-pdf'].filter((f) => offered.includes(f))), note: '', msg: '', busy: false };
  }
  const when = (iso) => new Date(iso).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function sendHistory(item) {
    const list = (item.sends || []).slice(-3).reverse();
    if (!list.length) return '';
    // (The printing house's name in its own direction: "Print Co." keeps its dot on an Arabic page.)
    return `<div class="send-history">${list.map((x) => `<div>📤 ${tIsolated('houses.sentLine', { channel: t(x.channel === 'email' ? 'houses.byEmail' : 'houses.byWhatsApp'), date: when(x.at) }, { house: x.houseName })}</div>`).join('')}</div>`;
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
            <select data-send-house="${item.id}">${housesData.houses.map((h) => `<option value="${esc(h.id)}" ${h.id === st.houseId ? 'selected' : ''}>${esc(isolate(h.name))}${h.id === def ? `${esc(SEP())}${esc(t('houses.default'))}` : ''}</option>`).join('')}</select>
          </div>
          <div class="field"><label>${esc(t('houses.via'))}</label><div class="chip-row">${ch('email', Boolean(house && house.email))}${ch('whatsapp', Boolean(house && house.whatsapp))}</div></div>
        </div>
        ${emailOff ? `<p class="notice small" style="margin:0 0 10px">${esc(t(access && access.owner ? 'houses.emailOff' : 'houses.emailOffTeam'))}</p>` : ''}
        <div class="field"><label>${esc(t('houses.files'))}</label>
          <div class="send-files">${sendFormats(item).map((f) => `<label class="check-chip"><input type="checkbox" data-send-format="${item.id}" value="${f}" ${st.formats.has(f) ? 'checked' : ''}> ${esc(t('fmt.' + f))}</label>`).join('')}</div>
        </div>
        <div class="field"><label>${esc(t('houses.note'))}</label><textarea rows="2" maxlength="500" dir="auto" data-send-note="${item.id}">${esc(st.note)}</textarea></div>
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
    if (!st || !item || st.busy) return;
    // Open the WhatsApp window now (browsers block it after waiting for the server).
    const win = st.channel === 'whatsapp' ? window.open('about:blank', '_blank') : null;
    st.busy = true;
    st.msg = '';
    rerenderQueue();
    try {
      const r = await adminApi(`/api/admin/items/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang },
        body: JSON.stringify({ houseId: st.houseId, channel: st.channel, formats: [...st.formats].filter((f) => sendFormats(item).includes(f)), note: st.note }),
      });
      item.sends = r.item.sends;
      const house = findHouse(st.houseId);
      if (r.whatsappUrl) {
        if (win) { win.opener = null; win.location.href = r.whatsappUrl; }
        st.msg = `<span style="color:var(--ok);font-weight:600">${tIsolated('houses.sentWhatsApp', {}, { house: house ? house.name : '' })}</span> <a class="btn btn-sm" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">${esc(t('houses.openWhatsApp'))}</a>`;
      } else {
        st.msg = `<span style="color:var(--ok);font-weight:600">${tIsolated('houses.sentEmail', {}, { house: house ? house.name : '' })}</span>`;
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
  // WhatsApp needs a mobile number with its country code. The server checks it (src/dispatch.js
  // whatsappDigits); here the form says what's wrong with the usual mistakes.
  function waProblem(v) {
    const d = String(v || '').replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) & 0xf)).replace(/[^\d+]/g, '');
    if (!d) return '';
    if (/^(?:0|(?:\+|00)?200?)[2-9]\d{7,8}$/.test(d) && !/^(?:\+|00)?20?0?1[0125]\d{8}$/.test(d)) return 'landline'; // 02…, 03…, +20 2…
    if (/^[2-9]\d{6,9}$/.test(d)) return 'local'; // no country code
    return '';
  }
  /** A number saved before the check (e.g. 1001234567, 0225551234): wa.me can't open it. */
  const waSavedBad = (digits) => Boolean(digits) && (!/^[1-9]\d{7,14}$/.test(digits) || /^1[0125]\d{8}$/.test(digits) || (/^20/.test(digits) && !/^201[0125]\d{8}$/.test(digits)));
  const houseMapTyped = {}; // product id -> house picked, waiting for an owner's approval
  function renderHouses(d) {
    $('houses-email-off').hidden = d.email;
    const uses = (id) => Object.values(d.productHouses).filter((h) => h === id).length;
    $('house-list').innerHTML = d.houses.length
      ? d.houses.map((h) => `
        <div class="card house-row">
          <div>
            <strong>${line(h.name)}</strong> <span class="pill queued">${esc(t(h.prefer === 'email' ? 'houses.byEmail' : 'houses.byWhatsApp'))}</span>
            <div class="muted small">${[h.email ? `✉️ <bdi dir="ltr">${esc(h.email)}</bdi>` : '', h.whatsapp ? `💬 <bdi dir="ltr">+${esc(h.whatsapp)}</bdi>${waSavedBad(h.whatsapp) ? ` <span class="pill wa-bad-pill">${esc(t('houses.waCheck'))}</span>` : ''}` : '', esc(t(uses(h.id) === 1 ? 'houses.product1' : 'houses.products', { n: POD.num(uses(h.id)) }))].filter(Boolean).join(SEP())}</div>
            ${h.notes ? `<div class="muted small">${line(h.notes)}</div>` : ''}
          </div>
          ${can('houses.edit') ? `<div class="row" style="gap:8px;flex:0 0 auto">
            <button class="btn btn-sm" type="button" data-house-edit="${esc(h.id)}">${esc(t('houses.edit'))}</button>
            <button class="btn btn-sm" type="button" data-house-del="${esc(h.id)}">${esc(t('houses.delete'))}</button>
          </div>` : ''}
        </div>`).join('')
      : `<p class="muted">${esc(t('houses.empty'))}</p>`;
    // (A choice sent for an owner's approval stays picked until it is decided.)
    const picked = (pid) => (pid in houseMapTyped ? houseMapTyped[pid] : d.productHouses[pid] || '');
    const opts = (pid) => `<option value="">${esc(t('houses.unset'))}</option>${d.houses.map((h) => `<option value="${esc(h.id)}" ${picked(pid) === h.id ? 'selected' : ''}>${esc(isolate(h.name))}</option>`).join('')}`;
    $('house-map').innerHTML = d.categories.map((c) => {
      const prods = d.products.filter((p) => p.category === c.id);
      if (!prods.length) return '';
      // An archived product ("stop selling") is only listed while a house is still set for it.
      return `<h3 class="house-map-cat">${esc(tr(c.name))}</h3><div class="house-map-grid">${prods.map((p) => `
        <label class="house-map-row"><span>${esc(tr(p.name))}${p.archived ? ` <span class="pill queued" title="${esc(t('pm.arch.houseHelp'))}">${esc(t('pm.arch.tag'))}</span>` : ''}</span><select data-map-product="${esc(p.id)}" ${d.houses.length && can('houses.edit') ? '' : 'disabled'}>${opts(p.id)}</select></label>`).join('')}</div>`;
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
    const wa = waProblem(body.whatsapp);
    if (wa) {
      $('house-msg').textContent = t(wa === 'landline' ? 'houses.waLandline' : 'houses.waLocal');
      $('house-wa').focus();
      return;
    }
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
      // A number saved before the check goes back without the "+", so saving turns it into a proper one (or says what's wrong).
      $('house-wa').value = h.whatsapp ? (waSavedBad(h.whatsapp) ? '' : '+') + h.whatsapp : '';
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
      delete houseMapTyped[pid];
      housesData.productHouses = r.productHouses;
      renderHouses(housesData);
      toast(t('houses.saved'));
    } catch (err) {
      if (sentForApproval(err)) houseMapTyped[pid] = e.target.value;
      else toast(err.message, 'error');
    }
  });

  /** The customer's design (all sides / book pages) as one PDF, to check or send them. */
  function previewFile(item) {
    const s = item.sides[0];
    if (!s || !s.printUrl || !can('files')) return '';
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
    if (IN_REVIEW.has(item.status)) return row(item);
    const next = NEXT[item.status];
    return `
      <div class="card now-printing">
        <div class="previews">${item.sides.map((s) => `<img src="${esc(s.previewUrl)}" alt="${esc(tr(s.name))}" data-zoom="${esc(JSON.stringify([s.previewUrl]))}">`).join('')}</div>
        <div>
          ${pill(item.status)}${expressPill(item)}${samplePill(item)}${importBadge(item)}${piecesPill(item)}
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
          ${backPanel(item)}
        </div>
      </div>`;
  }
  // ---------- An approved job that can't be printed as it is: back to Review (owner's request, 25 Nov) ----------
  // From the press or the waiting list: the reason (for the team) is required. In Review the shop then fixes the file
  // (the customer approves the new proof, with a note of what changed) or asks the customer for a change.
  const backOpen = new Set();
  const backMsg = {};
  const backBusy = new Set();
  function backPanel(item) {
    if (!can('review.work') || !['queued', 'printing'].includes(item.status)) return '';
    const id = esc(item.id);
    const m = backMsg[item.id];
    if (!backOpen.has(item.id)) {
      return `<div class="back-review">${m ? msgHtml(m) : ''}<button class="btn btn-sm" type="button" data-back-open="${id}">⚠ ${esc(t('back.open'))}</button></div>`;
    }
    return `
      <div class="back-review card" role="group" aria-labelledby="back-h-${id}" style="margin-top:10px;padding:12px">
        <h4 id="back-h-${id}" style="margin:0 0 4px">${esc(t('back.title'))}</h4>
        <p class="muted small" style="margin:0 0 8px">${esc(t('back.help'))}</p>
        <label class="small" for="back-why-${id}"><b>${esc(t('back.why'))}</b></label>
        <textarea id="back-why-${id}" data-back-why="${id}" rows="2" maxlength="1000" dir="auto" placeholder="${esc(t('back.whyPh'))}" style="width:100%">${esc(backWhy[item.id] || '')}</textarea>
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
          <button class="btn btn-sm btn-primary" type="button" data-back-send="${id}" ${backBusy.has(item.id) ? 'disabled' : ''}>${esc(t('back.send'))}</button>
          <button class="btn btn-sm" type="button" data-back-cancel="${id}">${esc(t('back.cancel'))}</button>
        </div>
        ${m ? msgHtml(m) : ''}
      </div>`;
  }
  const backWhy = {};
  document.addEventListener('input', (e) => {
    const id = e.target && e.target.dataset && e.target.dataset.backWhy;
    if (id) backWhy[id] = e.target.value;
  });
  document.addEventListener('click', async (e) => {
    const openB = e.target.closest('[data-back-open]');
    const cancel = e.target.closest('[data-back-cancel]');
    const send = e.target.closest('[data-back-send]');
    if (!openB && !cancel && !send) return;
    const id = (openB || cancel || send).dataset.backOpen || (openB || cancel || send).dataset.backCancel || (openB || cancel || send).dataset.backSend;
    if (openB) { backOpen.add(id); delete backMsg[id]; }
    if (cancel) { backOpen.delete(id); delete backMsg[id]; }
    if (send) {
      const why = (backWhy[id] || '').trim();
      if (!why) {
        backMsg[id] = { text: t('back.whyNeeded'), ok: false };
      } else if (!backBusy.has(id)) {
        backBusy.add(id);
        if (lastQueue) renderQueue(lastQueue);
        try {
          const r = await adminApi(`/api/admin/items/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', note: why }) });
          backOpen.delete(id);
          delete backWhy[id];
          // Sent to a printing house or on a DTF film already: said, so it is stopped there too.
          const warn = (r.warnings || []).map((w) => (w.kind === 'house' ? t('back.warnHouse', { house: w.house, date: POD.date(w.at) }) : t('back.warnFilm', { film: w.film }))).join(' ');
          toast(warn ? `${t('back.done')} ${warn}` : t('back.done'), warn ? 'error' : undefined);
          delete backMsg[id];
          loadReviewCount();
          await refresh();
        } catch (err) {
          backMsg[id] = { text: err.message, ok: false };
        }
        backBusy.delete(id);
      }
    }
    if (lastQueue) renderQueue(lastQueue);
    const box = document.getElementById('back-why-' + id);
    if (openB && box) box.focus();
  });

  /** Imported design: a badge, and where it came from (the customer confirmed the rights). */
  const importBadge = (item) => (item.imports && item.imports.length ? ` <span class="pill import-pill" title="${esc(t('admin.imported.title'))}">${esc(t('admin.imported'))}</span>` : '');
  const importInfo = (item) => (item.imports && item.imports.length
    ? `<div class="import-info small"><strong>${esc(t('admin.imported.from'))}</strong> ${item.imports.map((u) => { const label = esc(u.length > 70 ? u.slice(0, 67) + '…' : u); return /^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr">${label}</a>` : `<span dir="ltr">${label}</span>`; }).join('<br>')}<div class="muted">${esc(t('admin.imported.rights', { date: POD.date(item.rightsConfirmedAt || item.orderedAt) }))}</div></div>`
    : '');

  function row(item) {
    if (IN_REVIEW.has(item.status)) return reviewQueueRow(item);
    const next = NEXT[item.status];
    const isOpen = open.has(item.id);
    return `
      <div class="card queue-row ${isOpen ? 'is-open' : ''}">
        <img src="${esc(item.sides[0].previewUrl)}" alt="" ${zoomAttr(item)}>
        <div>
          <strong>${esc(tr(item.productName))}</strong> ${pill(item.status)}${expressPill(item)}${samplePill(item)}${importBadge(item)}${piecesPill(item)}
          <div class="muted small">${esc([item.orderNumber, t('admin.spec.itemOf', { i: item.position, n: item.of }), ...colourSizeText(item), item.sides.map((s) => tr(s.name)).join(' + ')].join(SEP()))}</div>
          ${hasQty(item) ? qtySummary(item) : ''}
        </div>
        <div class="queue-actions">
          <button class="btn btn-sm" data-toggle-item="${item.id}">${esc(t(isOpen ? 'admin.hideDetails' : 'admin.details'))}</button>
          ${sendButton(item)}
          <button class="btn btn-sm ${item.status === 'queued' ? 'btn-primary' : ''}" data-item="${item.id}" data-status="${next.status}">${esc(t(next.label))}</button>
        </div>
        ${isOpen ? `<div class="queue-details">${spec(item)}${importInfo(item)}${item.sides.map((s) => printFiles(item, s)).join('')}${previewFile(item)}${backPanel(item)}</div>` : ''}
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
    renderReviewNotice();
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
  let emailReady = null; // email sending set up (from the session: the team can't read the notifications card)
  const shipOpen = new Set(); // order ids whose shipping box is open
  const shipDraft = {}; // order id -> unsaved field values
  const shipMsg = {}; // order id -> { text, ok }
  const SHIP_FIELDS = ['courier', 'trackingNumber', 'trackingUrl', 'eta'];
  const COURIERS = () => ['Bosta', 'Aramex', t('ship.courier.egyptPost'), 'Mylerz', 'J&T Express', 'SMSA', 'DHL', t('ship.courier.own')];
  const isDelivered = (o) => o.status === 'delivered' || Boolean(o.shipment && o.shipment.deliveredAt);
  const isShipped = (o) => isDelivered(o) || o.status === 'shipped' || Boolean(o.shipment && o.shipment.shippedAt);
  const orderState = (o) => (isDelivered(o) ? 'delivered' : o.status);
  const statusPill = (s) => `<span class="pill ${s === 'delivered' ? 'delivered' : s === 'shipped' ? 'shipped' : s === 'received' ? 'queued' : s === 'in_review' ? 'review' : 'printing'}">${esc(t('ship.status.' + s))}</span>`;
  const isPaid = (o) => Boolean(o.payment && o.payment.status === 'paid');
  const payPill = (o) => `<span class="pill ${isPaid(o) ? 'pay-paid' : 'pay-pending'}">${esc(t(isPaid(o) ? 'ship.paid' : 'ship.unpaid'))}</span>`;
  /** A calendar day (YYYY-MM-DD) as the dashboard shows days: "Thu 26 Nov"; withYear adds the year when it isn't this year. */
  const day = (ymd, withYear = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ymd || '';
    const year = withYear && Number(ymd.slice(0, 4)) !== new Date().getFullYear();
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  };
  const shipValue = (o, k) => {
    const v = shipDraft[o.id] && shipDraft[o.id][k] !== undefined ? shipDraft[o.id][k] : (o.shipment && o.shipment[k]) || '';
    return k === 'trackingNumber' ? trackingText(v) : v;
  };
  const TIMELINE_STEPS = ['placed', 'production', 'printed', 'shipped', 'delivered'];
  function timelineOf(o) {
    if (Array.isArray(o.timeline) && o.timeline.length) return o.timeline;
    // Older server answers without a timeline: what we know.
    const sh = o.shipment || {};
    return TIMELINE_STEPS.map((step) => ({ step, at: step === 'placed' ? o.createdAt : step === 'shipped' ? sh.shippedAt || null : step === 'delivered' ? sh.deliveredAt || null : null }));
  }
  /** A tracking number in 0-9 ("٧٧٨٨-AB" typed on an Arabic keyboard is 7788-AB for the courier and the English email). */
  const trackingText = (v) => POD.latinDigits(v);
  /**
   * Courier · tracking number · delivered / expected day, each part in its own direction (QA 25 Nov: in one <bdi>
   * "Bosta بوسطة", "7788-AB" and the date ran into each other: "AB · Delivered … 11:15-٧٧٨٨ · Bosta بوسطة").
   */
  function shipNote(o) {
    const sh = o.shipment || {};
    const bits = [];
    if (sh.courier) bits.push(`<bdi dir="auto">${esc(sh.courier)}</bdi>`);
    if (sh.trackingNumber) bits.push(`<bdi dir="ltr">${esc(trackingText(sh.trackingNumber))}</bdi>`);
    if (isDelivered(o) && sh.deliveredAt) bits.push(`<bdi>${esc(t('ship.deliveredOn', { date: POD.date(sh.deliveredAt) }))}</bdi>`);
    else if (isShipped(o) && sh.eta) bits.push(`<bdi>${esc(t('ship.etaShort', { date: day(sh.eta) }))}</bdi>`);
    return bits.length ? `<span class="ship-note">${bits.join(esc(SEP()))}</span>` : '';
  }
  function shipBox(o) {
    const id = esc(o.id);
    // Shipping work for orders.work (Finance sees orders read-only); the invoice and the customer's order page
    // show the amounts (only for orders.amounts).
    const work = can('orders.work');
    const field = (k, type, extra = '') => `<div class="field"><label for="ship-${k}-${id}">${esc(t('ship.' + k))}</label><input type="${type}" id="ship-${k}-${id}" data-ship-field="${k}" data-order="${id}" value="${esc(shipValue(o, k))}" ${extra}${work ? '' : ' disabled'}></div>`;
    const steps = timelineOf(o).map((s) => `<li class="${s.at ? 'done' : ''}"><b>${esc(t('ship.step.' + s.step))}</b><span>${esc(s.at ? POD.date(s.at) : t('ship.notYet'))}</span></li>`).join('');
    const m = shipMsg[o.id];
    const email = o.customer && o.customer.email;
    const hint = isShipped(o) ? '' : `<p class="muted small" style="margin:0">${esc(!email ? t('ship.noEmailHint') : (notifySt ? !notifySt.customerEmail : emailReady === false) ? t('ship.emailOffHint', { email }) : t('ship.emailHint', { email }))}</p>`;
    return `<div class="ship-box" data-ship-box="${id}">
      <div class="ship-head">
        <h3>${esc(t('ship.title', { number: o.number }))}</h3>
        ${statusPill(orderState(o))}
        <div class="ship-links">
          ${can('orders.amounts') ? `<button class="btn btn-sm" type="button" data-team-view="invoice" data-order="${id}">${esc(t('ship.invoice'))}</button>` : ''}
          <button class="btn btn-sm" type="button" data-team-view="order" data-order="${id}" title="${esc(t('ship.orderPageHint'))}">${esc(t('ship.orderPage'))}</button>
        </div>
      </div>
      <div><div class="muted small" style="margin-bottom:6px">${esc(t('ship.timeline'))}</div><ol class="ship-steps">${steps}</ol></div>
      <div class="ship-fields">
        ${field('courier', 'text', `list="ship-couriers" maxlength="60" autocomplete="off" placeholder="${esc(t('ship.courierPh'))}"`)}
        ${field('trackingNumber', 'text', 'maxlength="80" dir="ltr" autocomplete="off"')}
        ${field('trackingUrl', 'url', 'maxlength="500" dir="ltr" placeholder="https://…"')}
        ${field('eta', 'date', 'dir="ltr"')}
      </div>
      ${work ? hint : ''}
      <div class="ship-actions">
        ${work ? `<button class="btn btn-sm" data-ship-save="${id}">${esc(t('ship.save'))}</button>
        ${isShipped(o) ? '' : `<button class="btn btn-sm btn-primary" data-ship-shipped="${id}">${esc(t('ship.markShipped'))}</button>`}
        ${isDelivered(o)
          ? `<button class="btn btn-sm" data-ship-delivered="${id}" data-value="">${esc(t('ship.undoDelivered'))}</button>`
          : `<button class="btn btn-sm ${isShipped(o) ? 'btn-primary' : ''}" data-ship-delivered="${id}" data-value="1">${esc(t('ship.markDelivered'))}</button>`}` : ''}
        <span class="ship-msg ${m ? (m.wait ? 'wait' : m.ok ? 'ok' : 'bad') : ''}" aria-live="polite">${m ? esc(m.text) : ''}</span>
      </div>
      <div class="ship-pay">
        <strong>${esc(t('ship.payment'))}:</strong> <span>${esc(t('ship.cod'))}</span> ${payPill(o)}
        ${can('payments') ? `<button class="btn btn-sm" data-pay="${id}" data-value="${isPaid(o) ? 'pending' : 'paid'}">${esc(t(isPaid(o) ? 'ship.markUnpaid' : 'ship.markPaid'))}</button>` : ''}
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
    // Search, status chips and filters (admin-order-filters.js): the orders to draw, 50 at a time.
    const shown = AdminOrderFilters.view(orders);
    $('ship-couriers').innerHTML = COURIERS().map((c) => `<option value="${esc(c)}"></option>`).join('');
    const col = (k) => esc(t('admin.col.' + k));
    // The Total column only when the answer has totals (people without orders.amounts get none: no empty column).
    const totals = orders.length ? AdminRoles.anyAmount(orders, 'total') : can('orders.amounts');
    const cols = totals ? 6 : 5;
    $('orders-total-col').hidden = !totals;
    $('orders').innerHTML = shown.length ? shown.map((o) => `
      <tr class="order-row ${shipOpen.has(o.id) ? 'open' : ''}">
        <td data-label="${col('order')}"><strong>${esc(o.number)}</strong>${o.delivery && o.delivery.speed === 'express' ? ` <span class="pill dlv-express-pill">${esc(t('delivery.express'))}</span>` : ''}<div class="muted small">${esc(POD.date(o.createdAt))}</div>${o.delivery ? `<div class="muted small">${esc(t('delivery.by', { date: POD.day(o.delivery.by) }))}</div>` : ''}</td>
        <td data-label="${col('customer')}">${line(o.customer.name)}<div class="muted small"><bdi dir="ltr">${esc(o.customer.phone || o.customer.email || '')}</bdi></div><div class="muted small">${esc(tr(o.customer.governorateName) || '')}</div></td>
        <td data-label="${col('items')}"><div class="mini-items">${o.items.map((i) => IN_REVIEW.has(i.status)
          ? `<span class="rv-mini" title="${esc(tr(i.productName))}: ${esc(t('admin.status.' + i.status))}"><img src="${esc(i.sides[0].previewUrl)}" alt="" ${zoomAttr(i)}><span class="rv-mini-flag" aria-hidden="true">!</span></span>`
          : `<img src="${esc(i.sides[0].previewUrl)}" title="${esc(tr(i.productName))}: ${esc(t('admin.status.' + i.status))}" alt="" ${zoomAttr(i)}>`).join('')}</div>${orderReview(o)}${orderQty(o)}</td>
        ${totals ? `<td data-label="${col('total')}">${AdminRoles.isAmount(o.total) ? esc(money(o.total)) : '—'}</td>` : ''}
        <td data-label="${col('status')}"><div class="order-state">${statusPill(orderState(o))} ${payPill(o)}${shipNote(o)}</div>
          <button class="btn btn-sm ship-toggle" data-ship-toggle="${esc(o.id)}" aria-expanded="${shipOpen.has(o.id)}">${esc(t('ship.manage'))} ${shipOpen.has(o.id) ? '▴' : '▾'}</button></td>
        <td data-label="${esc(t('notify.col'))}">${notifyCell(o.notifications, o.createdAt)}</td>
      </tr>${shipOpen.has(o.id) ? `<tr class="ship-row"><td colspan="${cols}">${shipBox(o)}</td></tr>` : ''}`).join('') : `<tr><td colspan="${cols}" class="muted">${orders.length ? AdminOrderFilters.emptyHtml() : esc(t('admin.noOrders'))}</td></tr>`;
  }
  const orderById = (id) => lastOrders && lastOrders.find((o) => o.id === id);
  const rerenderOrders = () => lastOrders && renderOrders(lastOrders);
  AdminOrderFilters.mount({ rerender: rerenderOrders, state: orderState, amounts: () => can('orders.amounts') });
  $('orders').addEventListener('input', (e) => {
    const f = e.target.closest('[data-ship-field]');
    if (!f) return;
    // The tracking number in 0-9 as it is typed (the cursor stays where it was: each digit is one character).
    if (f.dataset.shipField === 'trackingNumber' && trackingText(f.value) !== f.value) {
      const [a, b] = [f.selectionStart, f.selectionEnd];
      f.value = trackingText(f.value);
      try { f.setSelectionRange(a, b); } catch (err) { /* (no cursor) */ }
    }
    (shipDraft[f.dataset.order] ||= {})[f.dataset.shipField] = f.value;
    const msg = f.closest('.ship-box').querySelector('.ship-msg');
    if (msg && shipMsg[f.dataset.order]) { delete shipMsg[f.dataset.order]; msg.textContent = ''; msg.className = 'ship-msg'; }
  });
  function shipFieldsOf(id) {
    const out = {};
    for (const k of SHIP_FIELDS) {
      const el = document.getElementById(`ship-${k}-${id}`);
      if (el) out[k] = (k === 'trackingNumber' ? trackingText(el.value) : el.value).trim() || null;
    }
    return out;
  }
  /** An order's items that are not printed yet, numbered as in the order: "1. T-shirt (Queued), 2. Mug (Printing)". */
  function unprintedList(o) {
    return o.items.map((i, k) => ({ i, k })).filter(({ i }) => i.status !== 'printed' && i.status !== 'shipped')
      .map(({ i, k }) => `${o.items.length > 1 ? `${POD.num(k + 1)}. ` : ''}${tr(i.productName)} (${t('admin.status.' + i.status)})`)
      .join(POD.lang === 'ar' ? '، ' : ', ');
  }
  /**
   * "Mark shipped" or "Mark delivered" on an order with items not printed yet: asked first, naming them, and saying
   * when the customer gets the "on its way" email (QA 25 Nov: "Mark delivered" moved a queued and a printing item
   * to shipped and delivered without a word). Items still in review: the server refuses by itself.
   */
  function confirmUnprinted(o, deliver) {
    if (!o || o.items.some((i) => IN_REVIEW.has(i.status))) return true;
    const list = unprintedList(o);
    if (!list) return true;
    const email = !isShipped(o) && o.customer && o.customer.email;
    const mail = email && (notifySt ? notifySt.customerEmail : emailReady !== false) ? `\n\n${t('ship.mailToo', { email })}` : '';
    return confirm(`${t('ship.notPrintedList', { list })}\n\n${t(deliver ? 'ship.notPrintedDeliver' : 'ship.notPrintedShip')}${mail}`);
  }
  async function saveShipment(id, extra, doneKey, btn) {
    const o = orderById(id);
    if (!o) return;
    // (Only the fields changed here, against what this page last read: a colleague's correction to another field stays.)
    const typed = shipFieldsOf(id);
    const was = o.shipment || {};
    const changed = Object.fromEntries(Object.entries(typed).filter(([k, v]) => String(v == null ? '' : v) !== String(was[k] == null ? '' : was[k])));
    const body = { ...changed, ...extra };
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
      shipMsg[id] = { text: err.message, ok: false, wait: sentForApproval(err) };
    }
    rerenderOrders();
  }
  $('orders').addEventListener('click', async (e) => {
    // The order page (or invoice) as the customer sees it: a link that works for 30 minutes, amounts only for
    // people allowed them (the order's own key never reaches the dashboard). The tab opens with the tap itself
    // (a pop-up blocker lets that through), then goes to the link once it is made.
    const tv = e.target.closest('[data-team-view]');
    if (tv) {
      const w = window.open('', '_blank');
      try { if (w) w.opener = null; } catch (err) { /* (some browsers) */ }
      try {
        const r = await adminApi(`/api/admin/orders/${encodeURIComponent(tv.dataset.order)}/team-view`, { method: 'POST' });
        const url = tv.dataset.teamView === 'invoice' ? r.invoice : r.link;
        if (!url || !/^\/(order|invoice)\?/.test(url)) throw new Error(t('msg.requestFailed', { status: 403 }));
        if (w && !w.closed) w.location.href = url;
        else location.href = url;
      } catch (err) {
        if (w && !w.closed) w.close();
        POD.toast(err.message, 'error');
      }
      return;
    }
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
      if (!confirmUnprinted(orderById(shipped.dataset.shipShipped), false)) return;
      return saveShipment(shipped.dataset.shipShipped, { shipped: true }, 'ship.shippedDone', shipped);
    }
    const del = e.target.closest('[data-ship-delivered]');
    if (del) {
      const on = Boolean(del.dataset.value);
      // Delivered also marks every item shipped and sends the "on its way" email: asked first like "Mark shipped".
      if (on && !confirmUnprinted(orderById(del.dataset.shipDelivered), true)) return;
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
        shipMsg[id] = { text: err.message, ok: false, wait: sentForApproval(err) };
      }
      rerenderOrders();
    }
  });
  // ---------- Ready-made designs: pause / show in the shop, delete / bring back ----------
  // GET /api/admin/library: { categories, settings: { textOnlyLimited }, designs } (deleted ones too).
  // The list is drawn again when a filter changes; after an action only the rows that changed are
  // redrawn and stay where they are (a design shown again doesn't jump out of "Paused" while reviewing).
  let lastLibrary = null;
  const LIB = { view: 'all', q: '', cat: '', art: '', sort: 'new', ids: [], html: new Map(), picked: new Set(), sig: '', drawn: false, ruleBusy: false, bulkBusy: false };
  const libById = new Map();
  const libHay = new Map();
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  /** live: in the shop; paused; deleted; none: not paused but on no product (see the row's note). */
  const libState = (d) => (d.deleted ? 'deleted' : d.hidden ? 'paused' : Array.isArray(d.products) && !d.products.length ? 'none' : 'live');
  const LIB_VIEWS = {
    all: (d) => !d.deleted,
    live: (d) => libState(d) === 'live',
    paused: (d) => libState(d) === 'paused',
    none: (d) => libState(d) === 'none',
    deleted: (d) => Boolean(d.deleted),
    uploaded: (d) => !d.deleted && Boolean(d.uploaded), // from Upload designs (zip)
    week: (d) => !d.deleted && Boolean(d.addedOn) && d.addedOn >= libWeekAgo(), // added in the last 7 days
  };
  /** The day 6 days ago (YYYY-MM-DD): with today, the last 7 days. */
  const libWeekAgo = () => {
    const d = new Date(Date.now() - 6 * 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  /** "25 Nov" / «٢٥ نوفمبر» (with the year when it isn't this year). */
  const libAddedDay = (ymd) => {
    try {
      const d = new Date(ymd + 'T12:00:00Z');
      const year = d.getUTCFullYear() !== new Date().getFullYear();
      return d.toLocaleDateString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
    } catch (e) {
      return ymd;
    }
  };
  /** The list in the order picked: newest or oldest added first (undated last), or by name. Ties keep their order. */
  function libSorted(list) {
    if (LIB.sort === 'name') {
      const coll = new Intl.Collator(POD.lang === 'ar' ? 'ar' : 'en', { sensitivity: 'base', numeric: true });
      return list.slice().sort((a, b) => coll.compare(tr(a.name), tr(b.name)));
    }
    const dir = LIB.sort === 'old' ? 1 : -1;
    return list.slice().sort((a, b) => (!a.addedOn || !b.addedOn ? Boolean(b.addedOn) - Boolean(a.addedOn) : a.addedOn === b.addedOn ? 0 : (a.addedOn < b.addedOn ? -1 : 1) * dir));
  }
  // Search ignores case, Arabic short vowels and tatweel, the alef / yaa / taa marbuta spellings and digit styles (as /designs).
  // (The vowels' range stops at U+065F: the Arabic-Indic digits U+0660-U+0669 right after it are turned into 0-9, not dropped.)
  const libNorm = (s) => String(s || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const libSig = (lib) => JSON.stringify([lib.settings || null, lib.categories.length, lib.designs.map((d) => [d.id, d.hidden, d.deleted, d.limited, d.product, d.color, (d.products || []).join(' '), d.addedOn])]);
  // ---------- Editable words in uploaded designs ----------
  // GET /api/admin/library/words: { enabled, dailyMax, usedToday, designs: { id: { status, error, at } } }, status
  // 'queued' | 'working' | 'ready' | 'none' | 'failed' | 'kept' | 'off' (src/words.js). Read with the list; a row's
  // line (and its picture, drawn with or without the words as text) is redrawn when its status changes.
  const LIB_WORDS = { map: new Map(), info: null };
  async function loadLibWords() {
    if (!can('library.view')) return;
    let w;
    try {
      w = await adminApi('/api/admin/library/words');
    } catch (e) {
      return; // (an older server: no line)
    }
    const before = LIB_WORDS.map;
    LIB_WORDS.info = { enabled: Boolean(w.enabled), dailyMax: Number(w.dailyMax) || 0, usedToday: Number(w.usedToday) || 0 };
    LIB_WORDS.map = new Map(Object.entries(w.designs || {}));
    for (const [id, x] of LIB_WORDS.map) {
      const was = before.get(id);
      if (!was || was.status === x.status) continue;
      // The picture shows the words as text (ready) or as drawn: draw it again.
      for (const key of [...libPics.keys()].filter((k) => k.startsWith(id + '|'))) {
        libPics.delete(key);
        libPicDone.delete(key);
      }
    }
    if (LIB.drawn && tab === 'library') patchLibRows();
  }
  const LIB_WORDS_WHY = { key: 'key', busy: 'busy', timeout: 'busy', badPicture: 'picture', tooBig: 'picture' };
  function libWordsHtml(d) {
    const w = d.uploaded && !d.deleted ? LIB_WORDS.map.get(d.id) : null;
    if (!w || !w.status) return '';
    const up = can('uploads');
    const btn = (act, key) => (up ? `<button type="button" class="btn btn-sm rd-words-btn" data-rd-words="${act}" data-id="${esc(d.id)}">${esc(t(key))}</button>` : '');
    const info = LIB_WORDS.info || {};
    const capped = w.status === 'queued' && info.dailyMax > 0 && info.usedToday >= info.dailyMax;
    const why = w.status === 'failed' && LIB_WORDS_WHY[w.error] ? ` (${esc(t('rd.words.why.' + LIB_WORDS_WHY[w.error]))})` : '';
    const line = {
      ready: [esc(t('rd.words.ready')), btn('keep', 'rd.words.keep')],
      queued: [esc(t(capped ? 'rd.words.waitDay' : 'rd.words.working')), ''],
      working: [esc(t('rd.words.working')), ''],
      none: [esc(t('rd.words.none')), ''],
      failed: [esc(t('rd.words.failed')) + why, btn('retry', 'rd.words.retry')],
      kept: [esc(t('rd.words.kept')), btn('use', 'rd.words.use')],
      // (The key's name is English in the Arabic line too.)
      off: [esc(t('rd.words.off', { key: '\u0000' })).replace('\u0000', '<bdi dir="ltr">GEMINI_API_KEY</bdi>'), ''],
    }[w.status];
    if (!line) return '';
    return `<div class="small rd-words rd-words-${esc(w.status)}"><span>${line[0]}</span>${line[1]}</div>`;
  }
  async function libWordsAct(btn) {
    const d = libById.get(btn.dataset.id);
    const action = btn.dataset.rdWords;
    if (!d) return;
    const name = tr(d.name);
    btn.disabled = true;
    try {
      const r = await adminApi(`/api/admin/library/${encodeURIComponent(d.id)}/words`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action }) });
      toast(t(action === 'keep' ? 'rd.words.keptOk' : r.status === 'ready' ? 'rd.words.readyOk' : 'rd.words.workingOk', { name }));
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      return;
    }
    // The design's picture changed (with or without the words as text): the list, then the lines.
    try {
      renderLibrary(await adminApi('/api/admin/library'), { auto: true });
    } catch (e) { /* the next refresh */ }
    await loadLibWords();
  }
  const libWhat = (n) => POD.plural('rd.n', n);

  function setLibrary(lib) {
    lastLibrary = lib;
    libById.clear();
    libHay.clear();
    for (const d of lib.designs) {
      libById.set(d.id, d);
      // Name in both languages, the code, and the words printed on the design.
      const words = [d.id, d.name && d.name.en, d.name && d.name.ar, ...(d.items || []).filter((i) => i.kind === 'text').map((i) => String(i.text || '').replace(/\{[^{}]*\}/g, ' '))];
      libHay.set(d.id, ` ${libNorm(words.join(' '))} `);
    }
  }
  /**
   * Draw the tab. On the 15-second refresh (auto) nothing is redrawn unless a design changed (then only
   * the rows that changed); otherwise the list follows the filters again.
   */
  function renderLibrary(lib, { auto = false } = {}) {
    const sig = libSig(lib);
    const same = sig === LIB.sig;
    setLibrary(lib);
    LIB.sig = sig;
    renderLibRule();
    if (auto && LIB.drawn) {
      if (!same) patchLibRows();
      return;
    }
    const sel = $('lib-cat');
    const keep = sel.value;
    sel.innerHTML = lib.categories.map((c) => `<option value="${esc(c.id)}">${esc(tr(c.name))}</option>`).join('');
    if (keep) sel.value = keep;
    const fc = $('lib-fcat');
    fc.innerHTML = `<option value="">${esc(t('rd.allCats'))}</option>` + lib.categories.map((c) => `<option value="${esc(c.id)}">${esc(tr(c.name))}</option>`).join('');
    fc.value = LIB.cat;
    if (fc.value !== LIB.cat) LIB.cat = '';
    $('lib-fart').value = LIB.art;
    renderLibRows();
    // Product names for the rows' notes (the pictures need the catalogue too).
    if (!libCatalog) {
      POD.loadCatalog().then((c) => {
        if (libCatalog) return;
        libCatalog = c;
        if (tab === 'library') patchLibRows();
      }).catch(() => {});
    }
  }
  function renderLibRule() {
    const s = can('settings') ? lastLibrary.settings : null; // the switch is the owner's (settings)
    $('lib-rule').hidden = !s;
    if (!s) return;
    if (!LIB.ruleBusy) $('lib-limit').checked = Boolean(s.textOnlyLimited);
    const limited = lastLibrary.designs.filter((d) => d.limited && !d.deleted && !d.hidden);
    $('lib-rule-now').textContent = s.textOnlyLimited
      ? t('rd.ruleNow', { limited: libWhat(limited.filter((d) => d.products.length).length), none: libWhat(limited.filter((d) => !d.products.length).length) })
      : '';
  }
  /** The designs matching the search, category and artwork filters (the chips count within these). */
  function libScoped() {
    const terms = libNorm(LIB.q).split(' ').filter(Boolean);
    return lastLibrary.designs.filter((d) => (!LIB.cat || d.category === LIB.cat)
      && (!LIB.art || (LIB.art === 'yes') === Boolean(d.artwork))
      && terms.every((w) => libHay.get(d.id).includes(w)));
  }
  function renderLibRows() {
    if (!lastLibrary) return;
    if (!LIB_VIEWS[LIB.view]) LIB.view = 'all';
    const list = libSorted(libScoped().filter(LIB_VIEWS[LIB.view]));
    LIB.ids = list.map((d) => d.id);
    const ids = new Set(LIB.ids);
    for (const id of [...LIB.picked]) if (!ids.has(id)) LIB.picked.delete(id);
    LIB.html.clear();
    if (libIO) libIO.disconnect();
    libWant.clear();
    const box = $('lib-list');
    box.innerHTML = list.length ? list.map((d) => {
      const h = libRowHtml(d);
      LIB.html.set(d.id, h);
      return h;
    }).join('') : libEmptyHtml();
    LIB.drawn = true;
    observeLibPics(box);
    renderLibChips();
    renderLibBar();
  }
  /** Redraw the rows on screen that changed; a deleted one leaves the list (and one brought back leaves Deleted). */
  function patchLibRows() {
    const box = $('lib-list');
    const els = new Map([...box.querySelectorAll('[data-rd-row]')].map((el) => [el.dataset.rdRow, el]));
    const keep = [];
    for (const id of LIB.ids) {
      const d = libById.get(id);
      const el = els.get(id);
      if (!d || (LIB.view === 'deleted') !== Boolean(d.deleted)) {
        if (el) { if (libIO) libIO.unobserve(el); el.remove(); }
        LIB.html.delete(id);
        LIB.picked.delete(id);
        libWant.delete(id);
        continue;
      }
      keep.push(id);
      if (el) patchLibRow(id, el);
    }
    LIB.ids = keep;
    if (!keep.length) box.innerHTML = libEmptyHtml();
    observeLibPics(box);
    renderLibChips();
    renderLibBar();
  }
  function patchLibRow(id, el = $('lib-list').querySelector(`[data-rd-row="${CSS.escape(id)}"]`)) {
    const d = libById.get(id);
    if (!el || !d) return;
    const h = libRowHtml(d);
    if (h === LIB.html.get(id)) return;
    if (libIO) libIO.unobserve(el);
    el.outerHTML = h;
    LIB.html.set(id, h);
    const now = $('lib-list').querySelector(`[data-rd-row="${CSS.escape(id)}"]`);
    if (now && now.hasAttribute('data-rd-need')) observeLibPics(now.parentNode, now);
  }

  function renderLibChips() {
    const scoped = libScoped();
    const n = {};
    for (const v of Object.keys(LIB_VIEWS)) n[v] = scoped.filter(LIB_VIEWS[v]).length;
    // "New this week", "Uploaded" and "On no product" (not paused, but the rule or the catalogue leaves them nowhere) only when there are some.
    const some = new Set(['week', 'uploaded', 'none']);
    $('lib-chips').innerHTML = ['all', 'week', 'uploaded', 'live', 'paused', 'none', 'deleted'].filter((v) => !some.has(v) || n[v] || LIB.view === v)
      .map((v) => `<button type="button" class="chip rd-chip-${v} ${LIB.view === v ? 'active' : ''}" data-rd-filter="${v}" aria-pressed="${LIB.view === v}">${esc(t('rd.f.' + v))} <span class="rd-chip-n">${esc(POD.num(n[v]))}</span></button>`).join('');
    const total = lastLibrary.designs.filter((d) => !d.deleted).length;
    $('lib-count').textContent = LIB.view === 'deleted' ? t('rd.countDeleted', { what: libWhat(LIB.ids.length) }) : t('rd.count', { what: libWhat(LIB.ids.length), total: POD.num(total) });
  }

  // ---------- One row ----------
  const libPill = (cls, text) => `<span class="rd-pill rd-pill-${cls}">${esc(text)}</span>`;
  const libCatName = (id) => tr((lastLibrary.categories.find((c) => c.id === id) || {}).name || id);
  /** The products a design is offered on, by name when the shop's catalogue is loaded (for the pictures). */
  function libProductList(d) {
    const names = libCatalog ? d.products.map((id) => (libCatalog.products.find((p) => p.id === id) || {}).name).filter(Boolean).map(tr) : [];
    if (names.length !== d.products.length || !names.length) return POD.plural('rd.p', d.products.length);
    const shown = names.slice(0, 3).join(POD.lang === 'ar' ? '، ' : ', ');
    return names.length > 3 ? `${shown} ${t('rd.more', { n: POD.num(names.length - 3) })}` : shown;
  }
  function libNote(d, st) {
    if (st === 'deleted') return t(d.hidden ? 'rd.backPaused' : 'rd.backLive');
    if (st === 'none') return t(d.limited ? 'rd.noneLimited' : 'rd.noneSold');
    if (st === 'paused' && d.limited && !d.products.length) return t('rd.pausedLimited');
    if (st === 'live' && d.limited) return t('rd.limited', { list: libProductList(d) });
    return '';
  }
  function libRowHtml(d) {
    const st = libState(d);
    const name = tr(d.name);
    const note = libNote(d, st);
    const id = esc(d.id);
    const need = !d.preview && !libPicDone.has(libPicKey(d));
    const edit = can('library.edit');
    const openLink = st === 'live' ? `<a class="btn btn-sm" href="/design?id=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(t('rd.open'))} ↗</a>` : '';
    const acts = !edit ? openLink : st === 'deleted'
      ? `<button class="btn btn-sm btn-dark" type="button" data-rd-act="back" data-id="${id}">${esc(t('rd.back'))}</button>`
      : `${openLink}
        ${st === 'paused'
    ? `<button class="btn btn-sm rd-btn-show" type="button" data-rd-act="show" data-id="${id}">${esc(t('rd.show'))}</button>`
    : `<button class="btn btn-sm" type="button" data-rd-act="pause" data-id="${id}">${esc(t('rd.pause'))}</button>`}
        <button class="btn btn-sm btn-danger" type="button" data-rd-act="delete" data-id="${id}">${esc(t('rd.delete'))}</button>`;
    return `<article class="card rd-row rd-is-${st}${LIB.picked.has(d.id) ? ' is-picked' : ''}" data-rd-row="${id}"${need ? ' data-rd-need' : ''}>
        ${edit ? `<input type="checkbox" class="rd-pick" data-rd-pick="${id}" ${LIB.picked.has(d.id) ? 'checked' : ''} aria-label="${esc(t('rd.pick', { name }))}">` : '<span class="rd-pick" aria-hidden="true"></span>'}
        <button type="button" class="rd-thumb" data-rd-view="${id}" aria-label="${esc(t('rd.bigger', { name }))}">${libPicHtml(d)}</button>
        <div class="rd-main">
          <div class="rd-title"><strong dir="auto">${esc(name)}</strong> <bdi class="rd-id" dir="ltr">${id}</bdi></div>
          <div class="muted small">${esc([libCatName(d.category), d.uploaded ? t('rd.uploadedBy', { who: !d.by || d.by === 'owner' ? t('up.byOwner') : d.by }) : t(d.custom ? 'rd.yours' : 'rd.starter'), d.addedOn ? t('rd.added', { date: libAddedDay(d.addedOn) }) : ''].filter(Boolean).join(SEP()))}</div>
          <div class="rd-pills">${libPill(st, t('rd.st.' + st))}${d.artwork ? libPill('art', t('rd.withArt')) : libPill('text', t('rd.textOnly'))}</div>
          ${note ? `<div class="small rd-note rd-note-${st}">${esc(note)}</div>` : ''}
          ${libWordsHtml(d)}
        </div>
        <div class="rd-acts">${acts}</div>
      </article>`;
  }
  function libEmptyHtml() {
    const filtered = Boolean(LIB.q.trim() || LIB.cat || LIB.art);
    return `<div class="card rd-empty"><p>${esc(t(LIB.view === 'deleted' && !filtered ? 'rd.noneDeleted' : 'rd.none'))}</p>${filtered ? `<button type="button" class="btn btn-sm" data-rd-clear>${esc(t('rd.clear'))}</button>` : ''}</div>`;
  }

  // ---------- Pictures ----------
  // The owner's designs have a preview PNG. The starter ones are drawn here with the shop's own renderer
  // (design-render.js, loaded the first time it's needed), only for the rows on screen, one at a time, and
  // kept: a close-up for the row, and the close-up plus the whole product (as the shop shows it) to zoom.
  let libCatalog = null;
  let libRenderer = null;
  function loadLibRenderer() {
    if (window.POD_RENDER) return Promise.resolve();
    if (!libRenderer) {
      // The same version stamp as this page's own scripts, so a deploy never mixes old and new files.
      const own = document.querySelector('script[src*="/js/admin.js"]');
      const v = (own && (own.getAttribute('src').match(/[?&]v=([^&#]+)/) || [])[1]) || '';
      const files = ['/vendor/fabric-5.3.0.min.js', '/js/fabric-ext.js', '/js/templates.js', '/js/stickers.js', '/js/photo-mockups.js', '/js/design-render.js'];
      libRenderer = files.reduce((p, src) => p.then(() => (src.includes('fabric-5') && window.fabric ? null : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = v ? `${src}?v=${encodeURIComponent(v)}` : src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('script'));
        document.head.appendChild(s);
      }))), Promise.resolve()).catch((e) => {
        libRenderer = null;
        throw e;
      });
    }
    return libRenderer;
  }
  const libPics = new Map(); // picture key -> promise of { thumb, crop, full } (URLs), or null
  const libPicDone = new Map(); // the same, once drawn
  // Where a design is shown can change with the text-only rule (product, colour).
  const libPicKey = (d) => `${d.id}|${d.product}|${d.color}`;
  const libShrink = (cv, size) => {
    const k = Math.min(1, size / Math.max(cv.width, cv.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cv.width * k));
    out.height = Math.max(1, Math.round(cv.height * k));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, out.width, out.height);
    return out;
  };
  const libBlobUrl = (cv) => new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('export'))), 'image/webp', 0.86));
  async function drawLibPic(d) {
    await loadLibRenderer();
    if (!libCatalog) {
      libCatalog = await POD.loadCatalog();
      if (LIB.drawn && tab === 'library') patchLibRows(); // product names in the rows' notes
    }
    const products = libCatalog.products.filter((p) => !p.kind);
    const product = products.find((p) => p.id === d.product) || products.find((p) => (d.products || []).includes(p.id));
    if (product) {
      try {
        const color = product.colors.find((c) => c.id === d.color && POD.canPick(c)) || POD.firstPick(product.colors);
        const st = await POD_RENDER.stage(d, product, product.sides[0], color);
        try {
          const a = st.R.trim;
          const crop = POD_RENDER.picture(st, 420 / Math.min(POD_RENDER.W, POD_RENDER.H, Math.max(a.w, a.h) * 1.15), 1.15);
          const full = await POD_RENDER.productPicture(st, 0.9);
          return { thumb: await libBlobUrl(libShrink(crop, 144)), crop: await libBlobUrl(crop), full: await libBlobUrl(full) };
        } finally {
          st.canvas.dispose();
        }
      } catch (e) { /* the layout alone below */ }
    }
    // None of its products on sale (or the product picture failed): the layout alone, on white.
    const url = await window.POD_DESIGN.templateThumb({ id: d.id, items: d.items, aspect: d.aspect });
    return { thumb: url, crop: url, full: null };
  }
  function libPic(d) {
    const key = libPicKey(d);
    if (!libPics.has(key)) {
      libPics.set(key, (d.kind === 'template' ? drawLibPic(d) : Promise.resolve(null)).catch(() => null).then((p) => {
        libPicDone.set(key, p);
        return p;
      }));
    }
    return libPics.get(key);
  }
  const libZoomUrls = (d) => {
    if (d.preview) return [d.preview];
    const p = libPicDone.get(libPicKey(d));
    return p ? [p.crop, p.full].filter(Boolean) : [];
  };
  function libPicHtml(d) {
    if (d.preview) return `<img src="${esc(d.preview)}" alt="" loading="lazy" decoding="async" data-zoom="${esc(JSON.stringify([d.preview]))}">`;
    const key = libPicKey(d);
    if (!libPicDone.has(key)) return '<span class="rd-ph rd-ph-wait" aria-hidden="true"></span>';
    const p = libPicDone.get(key);
    return p ? `<img src="${esc(p.thumb)}" alt="" data-zoom="${esc(JSON.stringify(libZoomUrls(d)))}">` : '<span class="rd-ph" aria-hidden="true">Aa</span>';
  }
  // Rows waiting for a picture that are on screen (or nearly), drawn in the order they come.
  const libWant = new Set();
  const libIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) libWant.add(e.target.dataset.rdRow);
      else libWant.delete(e.target.dataset.rdRow);
    }
    pumpLibPics();
  }, { rootMargin: '300px 0px' }) : null;
  function observeLibPics(root, only) {
    const rows = only ? [only] : root.querySelectorAll('[data-rd-row][data-rd-need]');
    rows.forEach((el) => (libIO ? libIO.observe(el) : libWant.add(el.dataset.rdRow)));
    if (!libIO) pumpLibPics();
  }
  let libPumping = false;
  async function pumpLibPics() {
    if (libPumping) return;
    libPumping = true;
    try {
      while (libWant.size) {
        const id = libWant.values().next().value;
        libWant.delete(id);
        const d = libById.get(id);
        if (!d) continue;
        if (!libPicDone.has(libPicKey(d))) {
          await libPic(d);
          await new Promise((r) => setTimeout(r, 0)); // scrolling and clicks go in between
        }
        if (tab === 'library') patchLibRow(id);
      }
    } finally {
      libPumping = false;
    }
  }
  // A bigger picture (any screen; on a computer the picture also grows on hover).
  let libViewer = null;
  async function openLibViewer(id) {
    const d = libById.get(id);
    if (!d) return;
    if (!libViewer) {
      libViewer = document.createElement('dialog');
      libViewer.className = 'rd-viewer';
      libViewer.addEventListener('click', (e) => { if (e.target === libViewer || e.target.closest('[data-rd-close]')) libViewer.close(); });
      document.body.appendChild(libViewer);
    }
    const draw = () => {
      const urls = libZoomUrls(d);
      const waiting = !d.preview && !libPicDone.has(libPicKey(d));
      const st = libState(d);
      libViewer.setAttribute('aria-label', tr(d.name));
      libViewer.innerHTML = `<div class="rd-viewer-box">
          <div class="rd-viewer-head"><strong dir="auto">${esc(tr(d.name))}</strong>${libPill(st, t('rd.st.' + st))}<button type="button" class="btn btn-sm" data-rd-close>${esc(t('rd.close'))}</button></div>
          <div class="rd-viewer-pics${urls.length > 1 ? ' two' : ''}">${urls.length ? urls.map((u) => `<img src="${esc(u)}" alt="">`).join('') : `<p class="muted">${esc(t(waiting ? 'rd.loading' : 'rd.picFail'))}</p>`}</div>
        </div>`;
    };
    libViewer.dataset.id = id;
    draw();
    if (!libViewer.open) libViewer.showModal();
    if (!d.preview && !libPicDone.has(libPicKey(d))) {
      await libPic(d);
      if (libViewer.open && libViewer.dataset.id === id) draw();
      patchLibRow(id);
    }
  }

  // ---------- Several at once: the ticked ones, else all shown ----------
  const LIB_BODY = { pause: { hidden: true }, show: { hidden: false }, delete: { deleted: true }, back: { deleted: false } };
  /** Which of `list` an action changes. */
  const libFor = (act, list) => list.filter((d) => (act === 'back' ? d.deleted : !d.deleted && (act === 'delete' || (act === 'pause') === !d.hidden)));
  /**
   * Next to the count: "Tick all shown" and the actions on all shown. Ticked rows get their own bar,
   * kept at the bottom of the screen while the list scrolls.
   */
  function renderLibBar() {
    if (!can('library.edit')) {
      $('lib-all').innerHTML = '';
      $('lib-bar').hidden = true;
      return;
    }
    const shown = LIB.ids.map((id) => libById.get(id)).filter(Boolean);
    const picked = shown.filter((d) => LIB.picked.has(d.id));
    const btn = (act, key, n, cls = '') => (n ? `<button type="button" class="btn btn-sm ${cls}" data-rd-bulk="${act}" ${LIB.bulkBusy ? 'disabled' : ''}>${esc(t(key, { n: POD.num(n) }))}</button>` : '');
    $('lib-all').innerHTML = shown.length ? `<label class="check rd-pickall"><input type="checkbox" data-rd-pickall ${picked.length === shown.length ? 'checked' : ''}> ${esc(t('rd.pickAll'))}</label>
      ${picked.length ? '' : `${btn('pause', 'rd.bulk.pause', libFor('pause', shown).length)}
        ${btn('show', 'rd.bulk.show', libFor('show', shown).length, 'rd-btn-show')}
        ${btn('back', 'rd.bulk.back', libFor('back', shown).length, 'btn-dark')}`}` : '';
    const bar = $('lib-bar');
    bar.hidden = !picked.length;
    bar.innerHTML = picked.length ? `<span class="rd-bar-what">${esc(t('rd.picked', { what: libWhat(picked.length) }))}</span>
      <div class="rd-bar-acts">
        ${btn('pause', 'rd.pick.pause', libFor('pause', picked).length)}
        ${btn('show', 'rd.pick.show', libFor('show', picked).length, 'rd-btn-show')}
        ${btn('delete', 'rd.pick.delete', libFor('delete', picked).length, 'btn-danger')}
        ${btn('back', 'rd.pick.back', libFor('back', picked).length, 'btn-dark')}
        <button type="button" class="btn btn-sm" data-rd-bulk="unpick">${esc(t('rd.unpick'))}</button>
      </div>` : '';
  }
  async function libBulk(act) {
    const shown = LIB.ids.map((id) => libById.get(id)).filter(Boolean);
    const picked = shown.filter((d) => LIB.picked.has(d.id));
    const ids = libFor(act, picked.length ? picked : shown).map((d) => d.id);
    if (!ids.length || !confirm(t(`rd.confirm.${act}.${ids.length === 1 ? 'one' : 'other'}`, { what: libWhat(ids.length) }))) return;
    LIB.bulkBusy = true;
    renderLibBar();
    try {
      const r = await adminApi('/api/admin/library', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ ids, ...LIB_BODY[act] }) });
      LIB.picked.clear();
      renderLibrary(await adminApi('/api/admin/library'));
      const none = act === 'show' ? ids.filter((id) => libById.has(id) && libState(libById.get(id)) === 'none').length : 0;
      toast(none ? t('rd.done.showSomeNone', { what: libWhat(r.changed), none: POD.num(none) }) : t('rd.done.' + act, { what: libWhat(r.changed) }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      LIB.bulkBusy = false;
      renderLibBar();
    }
  }

  // ---------- Events ----------
  async function libAct(btn) {
    const d = libById.get(btn.dataset.id);
    const act = btn.dataset.rdAct;
    if (!d || !LIB_BODY[act]) return;
    const name = tr(d.name);
    if (act === 'delete' && !confirm(t('rd.confirmDelete', { name }))) return;
    btn.disabled = true;
    try {
      if (act === 'delete') await adminApi('/api/admin/library/' + encodeURIComponent(d.id), { method: 'DELETE' });
      else await adminApi('/api/admin/library/' + encodeURIComponent(d.id), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(LIB_BODY[act]) });
      Object.assign(d, LIB_BODY[act]);
      LIB.sig = libSig(lastLibrary);
      patchLibRows();
      toast(act === 'pause' ? t('rd.pausedOk', { name })
        : act === 'show' ? t(libState(d) === 'none' ? 'rd.shownNone' : 'rd.shownOk', { name })
          : act === 'delete' ? t('rd.deletedOk', { name })
            : t(d.hidden ? 'rd.backOkPaused' : 'rd.backOkLive', { name }));
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
    // Read the list again (the counts, and anything another admin changed). The products that show only
    // picture designs are a fixed list, so pausing or deleting one design never moves the others.
    adminApi('/api/admin/library').then((lib) => tab === 'library' && renderLibrary(lib, { auto: true })).catch(() => {});
  }
  $('lib-list').addEventListener('click', (e) => {
    const view = e.target.closest('[data-rd-view]');
    if (view) return void openLibViewer(view.dataset.rdView);
    if (e.target.closest('[data-rd-clear]')) {
      LIB.q = '';
      LIB.cat = '';
      LIB.art = '';
      $('lib-q').value = '';
      $('lib-fcat').value = '';
      $('lib-fart').value = '';
      renderLibRows();
      return;
    }
    const words = e.target.closest('[data-rd-words]');
    if (words) return void libWordsAct(words);
    const btn = e.target.closest('[data-rd-act]');
    if (btn) libAct(btn);
  });
  $('lib-list').addEventListener('change', (e) => {
    const box = e.target.closest('[data-rd-pick]');
    if (!box) return;
    if (box.checked) LIB.picked.add(box.dataset.rdPick);
    else LIB.picked.delete(box.dataset.rdPick);
    box.closest('[data-rd-row]').classList.toggle('is-picked', box.checked);
    renderLibBar();
  });
  /** Tick (or untick) every row shown. */
  function libPickAll(on) {
    LIB.picked = new Set(on ? LIB.ids : []);
    $('lib-list').querySelectorAll('[data-rd-pick]').forEach((x) => { x.checked = on; x.closest('[data-rd-row]').classList.toggle('is-picked', on); });
    renderLibBar();
  }
  ['lib-all', 'lib-bar'].forEach((box) => {
    $(box).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rd-bulk]');
      if (!b) return;
      if (b.dataset.rdBulk === 'unpick') libPickAll(false);
      else libBulk(b.dataset.rdBulk);
    });
    $(box).addEventListener('change', (e) => { if (e.target.matches('[data-rd-pickall]')) libPickAll(e.target.checked); });
  });
  $('lib-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rd-filter]');
    if (!b || b.dataset.rdFilter === LIB.view) return;
    LIB.view = b.dataset.rdFilter;
    LIB.picked.clear();
    renderLibRows();
  });
  /** Rights requests → "Find it in Ready designs": the list searched for that design (in Deleted when it was deleted). */
  async function goToLibraryDesign(id, { deleted = false } = {}) {
    LIB.q = String(id).slice(0, 60);
    LIB.cat = '';
    LIB.art = '';
    LIB.view = deleted ? 'deleted' : 'all';
    LIB.picked.clear();
    $('lib-q').value = LIB.q;
    $('lib-fcat').value = '';
    $('lib-fart').value = '';
    showTab('library');
    try {
      await refresh();
    } catch (e) {
      if (e && !e.ownerOnly && e.status !== 401) toast(e.message, 'error');
    }
    // The list, with the search box above it.
    $('lib-q').closest('.card').scrollIntoView({ block: 'start' });
  }
  let libTyping = null;
  $('lib-q').addEventListener('input', () => {
    clearTimeout(libTyping);
    libTyping = setTimeout(() => {
      LIB.q = $('lib-q').value.slice(0, 60);
      if (lastLibrary) renderLibRows();
    }, 200);
  });
  $('lib-fcat').addEventListener('change', (e) => {
    LIB.cat = e.target.value;
    if (lastLibrary) renderLibRows();
  });
  $('lib-sort').addEventListener('change', (e) => {
    LIB.sort = e.target.value;
    if (lastLibrary) renderLibRows();
  });
  $('lib-fart').addEventListener('change', (e) => {
    LIB.art = e.target.value;
    if (lastLibrary) renderLibRows();
  });
  $('lib-limit').addEventListener('change', async (e) => {
    const box = e.target;
    const on = box.checked;
    LIB.ruleBusy = true;
    box.disabled = true;
    $('lib-rule-now').textContent = t('rd.saving');
    try {
      await adminApi('/api/admin/library/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ textOnlyLimited: on }) });
      LIB.ruleBusy = false;
      renderLibrary(await adminApi('/api/admin/library'));
      toast(t(on ? 'rd.ruleOn' : 'rd.ruleOff'));
    } catch (err) {
      box.checked = !on;
      toast(err.message, 'error');
    } finally {
      LIB.ruleBusy = false;
      box.disabled = false;
      if (lastLibrary) renderLibRule();
    }
  });
  // (One at a time: a double-click added the design twice.)
  $('lib-add').addEventListener('submit', (e) => {
    e.preventDefault();
    sendOnce($('lib-add'), async () => {
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
        renderLibrary(await adminApi('/api/admin/library'));
      } catch (err) {
        // (Sent for an owner's approval: said in plain words, the boxes keep what was typed.)
        msg.style.color = sentForApproval(err) ? '' : '#c92a2a';
        msg.textContent = err.message;
      }
    });
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

  async function refresh({ auto = false } = {}) {
    if (!token) {
      $('login').hidden = false;
      return;
    }
    if (!access) await loadSession();
    // Now and then the session again: the badge on Approvals, and roles an owner changed meanwhile.
    else if (auto && Date.now() - sessionAt > 30000) await loadSession();
    // Only the tabs this person has (the first of them when the one asked for isn't theirs).
    const allowed = AdminRoles.pickTab(access, tab);
    if (allowed && allowed !== tab) showTab(allowed);
    if (tab === 'products') {
      $('login').hidden = true;
      $('dash').hidden = false;
      $('logout').hidden = false;
      await AdminProducts.show({ auto });
      return;
    }
    if (tab === 'queue') {
      // Don't redraw while the admin is typing in a send form, or the reason a job goes back to Review (QA 25 Nov).
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.send-panel, .back-review') && lastQueue) return;
      if (!housesData) housesData = await adminApi('/api/admin/houses').catch(() => null);
      const q = await adminApi('/api/admin/queue');
      await ensureOrders([...q.printing, ...q.waiting, ...q.toShip]);
      renderQueue((lastQueue = q));
    } else if (tab === 'review') await loadReview();
    else if (tab === 'houses') renderHouses((housesData = await adminApi('/api/admin/houses')));
    else if (tab === 'accounts') await refreshAccounts({ auto: true });
    else if (tab === 'coupons') renderCoupons((couponData = await adminApi('/api/admin/coupons')));
    else if (tab === 'customers') await loadCustomers();
    else if (tab === 'preview') await AdminPreview.show();
    else if (tab === 'backup') await AdminBackup.show();
    else if (tab === 'rights') await AdminRights.show({ auto });
    else if (tab === 'film') {
      const items = (await adminApi('/api/admin/dtf-items')).items;
      await ensureOrders(items);
      renderFilm((lastFilm = items));
    }
    else if (tab === 'library') {
      renderLibrary(await adminApi('/api/admin/library'), { auto });
      await loadLibWords();
      // Upload designs (zip): for those who may upload.
      if (can('uploads')) await AdminUploads.show({ auto }).catch((e) => { if (e.status === 401) throw e; });
      else $('lib-up').innerHTML = '';
    }
    else if (tab === 'staff') await AdminStaff.show({ auto });
    else if (tab === 'approvals') await AdminApprovals.show({ auto });
    else if (tab === 'activity') await AdminActivity.show({ auto });
    else {
      // Don't redraw while the admin is typing in a shipping box.
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.ship-box') && lastOrders) return;
      renderOrders((lastOrders = (await adminApi('/api/admin/orders')).orders));
      if (can('settings')) renderNotifyStatus();
    }
    $('login').hidden = true;
    $('dash').hidden = false;
    $('logout').hidden = false;
    if (tab !== 'review' && can('review.view')) loadReviewCount();
    // The Rights requests tab's badge: how many are still open (for those who handle them).
    if (tab !== 'rights' && can('rights')) AdminRights.count().catch(() => {});
  }

  document.addEventListener('pod:langchange', () => {
    applyRole();
    if (tab === 'products' && window.AdminProducts) AdminProducts.onLang();
    if (tab === 'preview' && window.AdminPreview) AdminPreview.onLang();
    if (tab === 'backup' && window.AdminBackup) AdminBackup.onLang();
    if (tab === 'rights') AdminRights.onLang();
    else AdminRights.badge();
    if (tab === 'queue' && lastQueue) renderQueue(lastQueue);
    if (tab === 'orders' && lastOrders) { renderOrders(lastOrders); if (can('settings')) renderNotifyStatus(); }
    if (tab === 'review' && reviewData) renderReview();
    renderReviewCount();
    if (tab === 'film' && lastFilm) renderFilm(lastFilm);
    if (tab === 'library' && lastLibrary) renderLibrary(lastLibrary);
    if (tab === 'library') AdminUploads.onLang();
    if (tab === 'houses' && housesData) renderHouses(housesData);
    if (tab === 'accounts') renderAccounts();
    if (tab === 'coupons' && couponData) renderCoupons(couponData);
    if (tab === 'customers' && customerData) renderCustomers(customerData);
    if (tab === 'staff') AdminStaff.onLang();
    if (tab === 'approvals') AdminApprovals.onLang();
    if (tab === 'activity') AdminActivity.onLang();
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
      const msg = link ? t('cu.waText', { name: POD.firstName ? POD.firstName(c.name) : c.name.split(' ')[0], url: link.url }) : '';
      return `
      <div class="card queue-row cu-row">
        <div style="min-width:0;overflow-wrap:anywhere">
          <strong>${line(c.name)}</strong>
          ${c.linked.google ? '<span class="pill">Google</span>' : ''}${c.linked.facebook ? '<span class="pill">Facebook</span>' : ''}${c.hasPassword ? '' : `<span class="pill queued">${esc(t('cu.noPassword'))}</span>`}
          <div class="muted small"><bdi dir="ltr">${esc(c.phone || '—')}</bdi>${SEP()}<bdi dir="ltr">${esc(c.email || '—')}</bdi>${SEP()}${esc(t('cu.since', { date: POD.date(c.createdAt) }))}</div>
          <div class="small">${esc(listed(AdminRoles.isAmount(c.spent) ? t('cu.orders', { n: POD.num(c.orders), total: money(c.spent) }) : t('role.cuOrders', { n: POD.num(c.orders) })))}${c.lastOrder ? `${SEP()}${esc(t('cu.last', { date: POD.date(c.lastOrder) }))}` : ''}</div>
          ${link ? `<div class="cu-link small"><div class="muted">${esc(t('cu.linkReady'))}</div><input type="text" readonly dir="ltr" value="${esc(link.url)}" data-cu-copy="${esc(c.id)}">
            <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
              <button class="btn btn-sm" type="button" data-cu-copybtn="${esc(c.id)}">${esc(t('cu.copy'))}</button>
              ${link.whatsapp ? `<a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(link.whatsapp + '?text=' + encodeURIComponent(msg))}">${esc(t('cu.sendWa'))}</a>` : ''}
              ${c.email ? `<a class="btn btn-sm" href="${esc('mailto:' + c.email + '?subject=' + encodeURIComponent(t('cu.mailSubject')) + '&body=' + encodeURIComponent(msg))}">${esc(t('cu.sendMail'))}</a>` : ''}
            </div></div>` : ''}
        </div>
        ${can('customers.contact') ? `<div class="queue-actions"><button class="btn btn-sm" type="button" data-cu-reset="${esc(c.id)}">${esc(t('cu.resetBtn'))}</button></div>` : ''}
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
  const acc = { view: 'overview', period: 'month', from: '', to: '', report: null, pricing: null, openOrders: new Set(), openSizes: new Set(), edits: {}, typed: {}, shipTyped: false };
  // The shop's day is Cairo's, whatever the admin's computer clock says (periods, the CSV name, today's date).
  const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ymd = (d) => CAIRO_DAY.format(d);
  function periodRange(p) {
    const today = ymd(new Date());
    const [Y, M] = today.split('-').map(Number);
    const p2 = (n) => String(n).padStart(2, '0');
    if (p === 'month') return [`${Y}-${p2(M)}-01`, today];
    if (p === 'lastMonth') {
      const [ly, lm] = M === 1 ? [Y - 1, 12] : [Y, M - 1];
      return [`${ly}-${p2(lm)}-01`, `${ly}-${p2(lm)}-${p2(new Date(Date.UTC(ly, lm, 0)).getUTCDate())}`];
    }
    if (p === 'year') return [`${Y}-01-01`, today];
    if (p === 'custom') return [acc.from, acc.to];
    return ['', ''];
  }
  const rangeQuery = () => { const [f, to] = periodRange(acc.period); return `from=${encodeURIComponent(f || '')}&to=${encodeURIComponent(to || '')}`; };
  /** The custom period's start is after its end (QA 25 Nov: every total just read 0). */
  const rangeBackwards = () => acc.period === 'custom' && Boolean(acc.from && acc.to) && acc.from > acc.to;
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
  function renderAccounts(opts) {
    $('acc-overview').hidden = acc.view !== 'overview';
    $('acc-prices').hidden = acc.view !== 'prices';
    $('acc-expenses').hidden = acc.view !== 'expenses';
    document.querySelectorAll('[data-acc-view]').forEach((b) => b.classList.toggle('active', b.dataset.accView === acc.view));
    if (acc.view === 'prices') renderPrices();
    else if (acc.report) { renderOverview(opts); renderExpenses(); }
  }
  // The real-cost boxes of the orders: saving one never redraws a box the admin is typing in (QA: the
  // second order got the "1" of "130"). Until the admin leaves the boxes, the totals, the order rows and
  // the other boxes follow in place; the full table once nothing is typed or still saving.
  const COST_BOX = '[data-acc-item-cost], [data-acc-ship]';
  let costSaving = 0;
  const typingCost = () => {
    const a = document.activeElement;
    return !!(a && a.matches && a.matches(COST_BOX) && $('acc-orders').contains(a));
  };
  function updateOrdersInPlace() {
    const box = $('acc-orders');
    const shown = [...box.querySelectorAll('[data-acc-order]')].map((b) => b.dataset.accOrder);
    // Orders came or went: that waits for the full table.
    if (shown.join() !== acc.report.orders.map((o) => o.id).join()) return;
    const a = document.activeElement;
    for (const o of acc.report.orders) {
      const main = box.querySelector(`[data-acc-order="${CSS.escape(o.id)}"]`).closest('tr');
      const tmp = document.createElement('tbody');
      tmp.innerHTML = orderRow(o);
      const [newMain, newDetail] = tmp.rows;
      const oldDetail = main.nextElementSibling && main.nextElementSibling.classList.contains('acc-detail') ? main.nextElementSibling : null;
      if (!!oldDetail !== !!newDetail) return;
      main.replaceWith(newMain);
      if (!oldDetail) continue;
      if (!oldDetail.contains(a)) { oldDetail.replaceWith(newDetail); continue; }
      // The line being typed in keeps its box; its words (estimate or real) follow.
      const olds = [...oldDetail.querySelectorAll('.acc-cost-line')];
      const news = [...newDetail.querySelectorAll('.acc-cost-line')];
      if (olds.length !== news.length) return;
      olds.forEach((ol, n) => {
        if (!ol.contains(a)) return ol.replaceWith(news[n]);
        [...ol.children].forEach((c, k) => { if (!c.contains(a) && news[n].children[k]) c.replaceWith(news[n].children[k].cloneNode(true)); });
      });
    }
  }
  function renderOverview({ keepBoxes = false } = {}) {
    const r = acc.report;
    const tt = r.totals;
    $('acc-periods').innerHTML = ['month', 'lastMonth', 'year', 'all', 'custom']
      .map((p) => `<button class="chip ${acc.period === p ? 'active' : ''}" data-acc-period="${p}" type="button">${esc(t('acc.period.' + p))}</button>`).join('');
    $('acc-custom').hidden = acc.period !== 'custom';
    // Custom days the wrong way round: say so (and offer to swap them), not just zeros everywhere.
    $('acc-range-msg').hidden = !rangeBackwards();
    $('acc-missing').hidden = !tt.missingCosts;
    $('acc-missing').textContent = POD.plural('acc.missing', tt.missingCosts);
    const tile = (label, value, extra, c = '') => `<div class="card stat acc-stat ${c}"><b>${esc(value)}</b><span>${esc(label)}</span>${extra ? `<small class="muted">${esc(extra)}</small>` : ''}</div>`;
    $('acc-stats').innerHTML = [
      tile(t('acc.revenue'), money(tt.revenue), listed(t('acc.revenueSub', { orders: POD.num(tt.orders), items: POD.num(tt.items) }))),
      tile(t('acc.itemCost'), money(tt.itemCost), t('acc.itemCostSub')),
      tile(t('acc.shippingCost'), money(tt.shippingCost), t('acc.shipCharged', { v: money(tt.shippingCharged) })),
      tile(t('acc.grossProfit'), money(tt.grossProfit), t('acc.margin', { v: POD.num(tt.margin) }), cls(tt.grossProfit)),
      tile(t('acc.expensesTotal'), money(tt.expenses), ''),
      tile(t('acc.netProfit'), money(tt.netProfit), '', cls(tt.netProfit)),
      tile(t('acc.collected'), money(tt.collected), t('acc.pending', { v: money(tt.pending) })),
    ].join('');
    if (acc.pricing && document.activeElement !== $('acc-ship-cost') && !acc.shipTyped) $('acc-ship-cost').value = acc.pricing.settings.shippingCost || 0;
    $('acc-products').innerHTML = r.products.length
      ? `<thead><tr><th>${esc(t('acc.col.product'))}</th><th>${esc(t('acc.col.units'))}</th><th>${esc(t('acc.col.sales'))}</th><th>${esc(t('acc.col.cost'))}</th><th>${esc(t('acc.col.profit'))}</th></tr></thead><tbody>${r.products.map((p) => `
        <tr><td>${esc(tr(p.productName))}</td><td>${POD.num(p.units)}</td><td>${money(p.sales)}</td><td>${money(p.cost)}</td><td class="${cls(p.profit)}">${money(p.profit)}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noOrders'))}</td></tr></tbody>`;
    // While a cost box is typed in (or one is still saving), the table follows in place.
    if (keepBoxes && (typingCost() || costSaving)) {
      updateOrdersInPlace();
      acc.redrawOrders = true;
      return;
    }
    acc.redrawOrders = false;
    $('acc-orders').innerHTML = r.orders.length
      ? `<thead><tr><th>${esc(t('admin.col.order'))}</th><th>${esc(t('acc.col.items'))}</th><th>${esc(t('acc.col.total'))}</th><th>${esc(t('acc.col.cost'))}</th><th>${esc(t('acc.col.ship'))}</th><th>${esc(t('acc.col.profit'))}</th><th></th></tr></thead><tbody>${r.orders.map(orderRow).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noOrders'))}</td></tr></tbody>`;
  }
  const SRC = { actual: 'acc.src.actual', order: 'acc.src.order', current: 'acc.src.current' };
  /** A real cost as typed and sent for an owner's approval (kept in its box until decided), else the saved one. */
  const typedCost = (key, saved) => (key in acc.typed ? acc.typed[key] : saved);
  function orderRow(o) {
    const costsRo = can('costs.edit') ? '' : ' disabled';
    const open = acc.openOrders.has(o.id);
    const main = `<tr class="${open ? 'is-open' : ''}">
      <td><strong>${esc(o.number)}</strong><div class="muted small">${esc(POD.date(o.createdAt))}${SEP()}${esc(t(o.status === 'shipped' ? 'acc.shipped' : 'acc.open'))}</div></td>
      <td>${o.items.map((i) => esc(tr(i.productName))).join('<br>')}</td>
      <td>${money(o.total)}<div class="muted small">${esc(t('acc.inclShip', { v: money(o.shipping) }))}</div></td>
      <td>${money(o.itemCost)}</td><td>${money(o.shippingCost)}</td>
      <td class="${cls(o.profit)}"><strong>${money(o.profit)}</strong></td>
      <td><button class="btn btn-sm" type="button" data-acc-order="${o.id}">${esc(t(open ? 'acc.close' : 'acc.editCosts'))}</button></td></tr>`;
    if (!open) return main;
    const items = o.items.map((i) => `
      <div class="acc-cost-line">
        <span>${esc(tr(i.productName))}${SEP()}${esc(tr(i.size && i.size.label))}${i.sides > 1 ? `${SEP()}${esc(t('acc.sides', { n: POD.num(i.sides) }))}` : ''}${SEP()}${money(i.price)}</span>
        <span class="muted small">${i.costParts ? esc(t('acc.parts', { blank: money(i.costParts.blank), print: money(i.costParts.print), other: money(i.costParts.other) }) + (Number(i.costParts.embroidery) ? t('acc.partsEmb', { emb: money(i.costParts.embroidery) }) : '')) : ''} (${esc(t(SRC[i.costSource]))})</span>
        <label class="small">${esc(t('acc.realCost'))} <input type="text" inputmode="decimal" autocomplete="off" data-num data-min="0" dir="ltr" value="${esc(typedCost('item:' + i.id, i.costSource === 'actual' ? i.cost : ''))}" placeholder="${i.cost}" data-acc-item-cost="${i.id}"${costsRo}></label>
      </div>`).join('');
    return main + `<tr class="acc-detail"><td colspan="7">
      ${items}
      <div class="acc-cost-line"><span>${esc(t('acc.col.ship'))}</span><span class="muted small">${esc(t(o.shippingCostSet ? 'acc.src.actual' : 'acc.src.default'))}</span>
        <label class="small">${esc(t('acc.realShip'))} <input type="text" inputmode="decimal" autocomplete="off" data-num data-min="0" dir="ltr" value="${esc(typedCost('ship:' + o.id, o.shippingCostSet ? o.shippingCost : ''))}" placeholder="${o.shippingCost}" data-acc-ship="${o.id}"${costsRo}></label></div>
      <p class="muted small" style="margin:6px 0 0">${esc(t('acc.realHelp'))}</p>
    </td></tr>`;
  }
  function renderExpenses() {
    const r = acc.report;
    const [f, to] = periodRange(acc.period);
    // Days as the rest of the dashboard shows them ("Sun 1 Nov to Wed 25 Nov"), not raw YYYY-MM-DD.
    const range = f || to ? ` (${t('acc.periodDays', { from: f ? day(f, true) : '…', to: to ? day(to, true) : '…' })})` : '';
    $('acc-exp-period').textContent = t('acc.expPeriod', { period: t('acc.period.' + acc.period) + range, total: money(r.totals.expenses) }) + (rangeBackwards() ? ` ${t('acc.rangeBackwards')}` : '');
    if (!$('exp-cat').options.length) $('exp-cat').innerHTML = (r.categories || []).map((c) => `<option value="${c}">${esc(t('acc.cat.' + c))}</option>`).join('');
    else [...$('exp-cat').options].forEach((o) => { o.textContent = t('acc.cat.' + o.value); });
    if (!$('exp-date').value) $('exp-date').value = ymd(new Date());
    $('acc-exp-list').innerHTML = r.expenses.length
      ? `<thead><tr><th>${esc(t('acc.date'))}</th><th>${esc(t('acc.category'))}</th><th>${esc(t('acc.description'))}</th><th>${esc(t('acc.amount'))}</th><th></th></tr></thead><tbody>${r.expenses.map((e) => `
        <tr><td>${esc(day(e.date, true))}</td><td>${esc(t('acc.cat.' + e.category))}</td><td class="acc-exp-desc">${line(e.description)}</td><td>${money(e.amount)}</td><td>${can('expenses.edit') ? `<button class="btn btn-sm" type="button" data-exp-del="${e.id}">${esc(t('houses.delete'))}</button>` : ''}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="muted">${esc(t('acc.noExpenses'))}</td></tr></tbody>`;
  }
  /*
   * Prices & costs: number boxes like the others ([data-num], any digits). What the owner types is kept as typed
   * (acc.edits) and read with priceNum; an empty or wrong box is never taken as 0 (QA: an emptied cost counted as
   * 0 in the profit): the profit shows "—" and saving says which box to fix. Sizes' amounts may be below 0.
   */
  const priceMin = (key) => (key === 'basePrice' ? 1 : /^size(cost)?:/.test(key) ? -100000 : 0);
  /** A box as typed (or a saved number) as a number: '' when empty, NaN when it isn't a number. */
  const priceNum = (raw) => {
    if (typeof raw === 'number') return raw;
    const s = POD.latinDigits(raw).replace(/[\s\u066C\u200E\u200F]/g, '').replace(/\u2212/g, '-');
    return s === '' ? '' : /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  };
  /** What's wrong with a typed price or cost ('' when fine), as its box would say it. */
  const priceProblem = (key, raw) => (typeof raw === 'number' ? '' : numProblem({ value: String(raw), dataset: { min: String(priceMin(key)) }, hasAttribute: (a) => a === 'data-need' }));
  function renderPrices() {
    const d = acc.pricing;
    if (!d) return;
    // Selling prices for prices.edit, costs for costs.edit (the others see them only).
    const may = (key) => can(/^(basePrice|extraSidePrice|size:)/.test(key) ? 'prices.edit' : 'costs.edit');
    const field = (pid, key, value, extra = '') => `<input type="text" inputmode="decimal" autocomplete="off" data-num data-need data-min="${priceMin(key)}" dir="ltr" value="${esc(String(value))}" data-price-field="${esc(pid)}" data-key="${esc(key)}" ${extra}${may(key) ? '' : ' disabled'}>`;
    $('acc-price-list').innerHTML = d.categories.map((c) => {
      const prods = d.products.filter((p) => p.category === c.id);
      if (!prods.length) return '';
      return `<h3 class="house-map-cat">${esc(tr(c.name))}</h3><div class="card" style="overflow-x:auto"><table class="orders acc-table acc-prices">
        <thead><tr><th>${esc(t('acc.col.product'))}</th><th>${esc(t('acc.col.price'))}</th><th>${esc(t('acc.col.extraSide'))}</th><th>${esc(t('acc.col.blank'))}</th><th>${esc(t('acc.col.print1'))}</th><th>${esc(t('acc.col.printN'))}</th><th>${esc(t('acc.col.embroidery'))}</th><th>${esc(t('acc.col.other'))}</th><th>${esc(t('acc.col.unitProfit'))}</th><th></th></tr></thead>
        <tbody>${prods.map((p) => priceRow(p, field)).join('')}</tbody></table></div>`;
    }).join('');
    // Boxes typed in before (redrawn): still say what's wrong with them.
    $('acc-price-list').querySelectorAll('input[data-num]').forEach(checkNum);
  }
  function priceRow(p, field) {
    const e = acc.edits[p.id];
    const v = (k, def) => (e && e[k] !== undefined ? e[k] : def);
    // (The first regular pack: a 1-copy pack's price and cost per copy are another matter.)
    const ref = p.sizes.find((z) => z.id === p.refSize) || p.sizes[0];
    const parts = [v('basePrice', p.basePrice), v('size:' + ref.id, ref.surcharge), v('blank', p.costs.blank), v('sizecost:' + ref.id, ref.costExtra), v('printFirst', p.costs.printFirst), v('other', p.costs.other)].map(priceNum);
    // A box left empty or not a number: no profit (it isn't 0).
    const known = parts.every(Number.isFinite);
    const price = parts[0] + parts[1];
    const cost = parts[2] + parts[3] + parts[4] + parts[5];
    const profit = price - cost;
    const margin = price ? Math.round((profit / price) * 1000) / 10 : 0;
    const multi = p.sideCount > 1;
    const sizesOpen = acc.openSizes.has(p.id);
    const changed = e && Object.keys(e).length;
    let html = `<tr class="${changed ? 'is-edited' : ''}">
      <td><strong>${esc(tr(p.name))}</strong>${p.costsSet ? '' : `<div class="small" style="color:var(--danger,#c0392b)">${esc(t('acc.noCosts'))}</div>`}
        ${p.sizes.length > 1 ? `<div><button class="link-btn small" type="button" data-acc-sizes="${p.id}">${esc(t(sizesOpen ? 'acc.hideSizes' : 'acc.sizes', { n: POD.num(p.sizes.length) }))}</button></div>` : ''}</td>
      <td>${field(p.id, 'basePrice', v('basePrice', p.basePrice))}</td>
      <td>${multi ? field(p.id, 'extraSidePrice', v('extraSidePrice', p.extraSidePrice)) : '<span class="muted">—</span>'}</td>
      <td>${field(p.id, 'blank', v('blank', p.costs.blank))}</td>
      <td>${field(p.id, 'printFirst', v('printFirst', p.costs.printFirst))}</td>
      <td>${multi ? field(p.id, 'printExtra', v('printExtra', p.costs.printExtra)) : '<span class="muted">—</span>'}</td>
      <td>${p.embroidered ? field(p.id, 'embroidery', v('embroidery', p.costs.embroidery || 0)) : '<span class="muted">—</span>'}</td>
      <td>${field(p.id, 'other', v('other', p.costs.other))}</td>
      <td class="${(p.costsSet || changed) && known ? cls(profit) : ''}">${(p.costsSet || changed) && known ? `<strong>${money(profit)}</strong><div class="muted small">${esc(t('acc.marginShort', { v: POD.num(margin) }))}</div>` : '<span class="muted">—</span>'}</td>
      <td>${can('prices.edit') || can('costs.edit') ? `<button class="btn btn-sm ${changed ? 'btn-primary' : ''}" type="button" data-price-save="${p.id}" ${changed ? '' : 'disabled'}>${esc(t('houses.save'))}</button>` : ''}</td></tr>`;
    if (sizesOpen) {
      html += `<tr class="acc-detail"><td colspan="10"><div class="acc-sizes">${p.sizes.map((sz) => `
        <div class="acc-size"><strong>${esc(tr(sz.label))}</strong>
          <label class="small">${esc(t('acc.sizePrice'))} ${field(p.id, 'size:' + sz.id, v('size:' + sz.id, sz.surcharge))}</label>
          <label class="small">${esc(t('acc.sizeCost'))} ${field(p.id, 'sizecost:' + sz.id, v('sizecost:' + sz.id, sz.costExtra))}</label>
        </div>`).join('')}</div><p class="muted small" style="margin:6px 0 0">${esc(t('acc.sizesHelp'))}</p></td></tr>`;
    }
    // Products sold in small packs: a warning when a bigger pack would cost less than a smaller one.
    if (p.sizes.some((z) => z.smallPack)) {
      const warn = packWarnings(p);
      html += `<tr class="acc-pack-warn" data-pack-warn="${esc(p.id)}" ${warn ? '' : 'hidden'}><td colspan="10" aria-live="polite">${warn}</td></tr>`;
    }
    return html;
  }
  /**
   * Bigger packs that cost less than smaller ones at the row's prices as they will be saved (as they are
   * now when nothing is typed), worked out as the server will (public/js/pack-prices.js): a warning under
   * the product's row, saving still works.
   */
  function packWarnings(p) {
    if (!window.POD_PACKS || !window.AdminProducts) return '';
    const e = acc.edits[p.id] || {};
    // (As typed, any digits; a box that isn't a number yet counts as it was.)
    const v = (k, def) => (e[k] !== undefined && Number.isFinite(priceNum(e[k])) ? priceNum(e[k]) : def);
    // (Which small packs have the owner's own price: the row doesn't say, so it's read from their amounts.)
    const now = POD_PACKS.withOwnPrices(p, p.defaults);
    const prices = POD_PACKS.savedPrices(now, p.defaults, { basePrice: v('basePrice', p.basePrice), sizes: Object.fromEntries(p.sizes.map((z) => [z.id, v('size:' + z.id, z.surcharge)])) });
    return AdminProducts.packWarnHtml(POD_PACKS.cheaperBiggerPacks(p.sizes, prices));
  }

  /** A price or cost that can't be saved: its box (the sizes opened when it's a size's) says why. */
  function showPriceProblem(pid, key, msg) {
    const find = () => $('acc-price-list').querySelector(`[data-price-field="${CSS.escape(pid)}"][data-key="${CSS.escape(key)}"]`);
    if (!find() && !acc.openSizes.has(pid)) {
      acc.openSizes.add(pid);
      renderPrices();
    }
    const el = find();
    toast(msg, 'error');
    if (!el) return;
    el.setCustomValidity(msg);
    el.focus();
    el.reportValidity();
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
    if (e.target.closest('#acc-range-swap')) {
      [acc.from, acc.to] = [acc.to, acc.from];
      $('acc-from').value = acc.from;
      $('acc-to').value = acc.to;
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
      // A box emptied or not a number: say so at the box, save nothing (never 0 in its place).
      const bad = Object.keys(ed).find((k) => priceProblem(k, ed[k]));
      if (bad) return void showPriceProblem(p.id, bad, priceProblem(bad, ed[bad]));
      // Boxes not changed here keep what is saved now (read again just before saving): a colleague's new price isn't
      // undone by a cost changed on a page opened earlier (QA 25 Nov).
      let now = p;
      try {
        const fresh = await adminApi('/api/admin/pricing');
        now = (fresh && Array.isArray(fresh.products) && fresh.products.find((x) => x.id === p.id)) || p;
      } catch (err) { if (err.status === 401) return; }
      const v = (k, def) => (ed[k] !== undefined ? priceNum(ed[k]) : def);
      const pSizes = (id) => (now.sizes || []).find((x) => x.id === id) || p.sizes.find((x) => x.id === id) || {};
      const body = {
        basePrice: v('basePrice', now.basePrice), extraSidePrice: v('extraSidePrice', now.extraSidePrice),
        sizes: Object.fromEntries(p.sizes.map((s) => [s.id, v('size:' + s.id, pSizes(s.id).surcharge)])),
        costs: {
          blank: v('blank', now.costs.blank), printFirst: v('printFirst', now.costs.printFirst), printExtra: v('printExtra', now.costs.printExtra), other: v('other', now.costs.other),
          ...(p.embroidered ? { embroidery: v('embroidery', now.costs.embroidery || 0) } : {}),
          sizes: Object.fromEntries(p.sizes.map((s) => [s.id, v('sizecost:' + s.id, pSizes(s.id).costExtra)])),
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
    // Kept as typed (any digits): an emptied box stays empty, it isn't 0.
    (acc.edits[pid] ||= {})[el.dataset.key] = el.value;
    // Update just the profit cell and the save button, without losing the cursor.
    const p = acc.pricing.products.find((x) => x.id === pid);
    const tr0 = el.closest('tr').classList.contains('acc-detail') ? el.closest('tr').previousElementSibling : el.closest('tr');
    const tmp = document.createElement('tbody');
    tmp.innerHTML = priceRow(p, (a, b, c, d = '') => `<input value="${esc(String(c))}" ${d}>`);
    // (The profit cell is the one before the save button. Since the embroidery column came in, the 8th cell
    // is the packaging cost box: redrawing that one swapped it for a plain box whose typing didn't count.)
    const PROFIT = tr0.cells.length - 2;
    tr0.cells[PROFIT].innerHTML = tmp.rows[0].cells[PROFIT].innerHTML;
    tr0.cells[PROFIT].className = tmp.rows[0].cells[PROFIT].className;
    const btn = tr0.querySelector('[data-price-save]');
    if (btn) {
      btn.disabled = false;
      btn.classList.add('btn-primary');
    }
    tr0.classList.add('is-edited');
    // The pack-price warning follows the prices as typed.
    const warnRow = $('tab-accounts').querySelector(`[data-pack-warn="${CSS.escape(pid)}"]`);
    if (warnRow) {
      const warn = packWarnings(p);
      warnRow.hidden = !warn;
      warnRow.cells[0].innerHTML = warn;
    }
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
    // A wrong number is not saved (it used to read as empty and delete the saved cost): the box says why.
    if (!checkNum(el)) {
      toast(el.validationMessage, 'error');
      return;
    }
    // The value as typed now (any digits): the admin may already be typing in the next box. Emptied: the
    // estimate again, as the help under the boxes says.
    const typed = numValue(el);
    const value = typed === '' ? null : Number(typed);
    const typedKey = itemId ? 'item:' + itemId : 'ship:' + orderId;
    costSaving++;
    let saved = false;
    let reset = false;
    try {
      if (itemId) await adminApi(`/api/admin/items/${encodeURIComponent(itemId)}/cost`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ actualCost: value }) });
      else await adminApi(`/api/admin/orders/${encodeURIComponent(orderId)}/shipping-cost`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ actualShipping: value }) });
      saved = true;
      delete acc.typed[typedKey];
      // (Enter in the box: done with it. Another box clicked meanwhile keeps its focus.)
      if (document.activeElement === el) el.blur();
      toast(t('houses.saved'));
      acc.report = await adminApi(`/api/admin/accounts?${rangeQuery()}`);
    } catch (err) {
      // Sent for an owner's approval: the box goes back to the saved cost (it hasn't changed yet; the request
      // waits in My requests), so a refused one is never left looking like the cost.
      if (sentForApproval(err)) {
        delete acc.typed[typedKey];
        if (document.activeElement === el) el.blur();
        reset = true;
      } else toast(err.message, 'error');
    } finally {
      costSaving--;
    }
    if (saved) renderAccounts({ keepBoxes: true });
    else if (reset && !costSaving) renderOverview();
    else if (acc.redrawOrders && !typingCost() && !costSaving) renderOverview();
  });
  // Left the cost boxes (not for another one): the table catches up.
  $('tab-accounts').addEventListener('focusout', (e) => {
    if (!e.target.matches || !e.target.matches(COST_BOX) || (e.relatedTarget && e.relatedTarget.matches && e.relatedTarget.matches(COST_BOX))) return;
    setTimeout(() => {
      if (acc.redrawOrders && acc.report && !typingCost() && !costSaving && acc.view === 'overview') renderOverview();
    }, 0);
  });
  $('acc-ship-save').addEventListener('click', async () => {
    if (!checkNum($('acc-ship-cost'))) return void $('acc-ship-cost').reportValidity();
    try {
      const st = await adminApi('/api/admin/accounts/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ shippingCost: Number(numValue($('acc-ship-cost'))) }) });
      acc.shipTyped = false;
      if (acc.pricing) acc.pricing.settings = st;
      toast(t('houses.saved'));
      await refreshAccounts();
    } catch (err) {
      if (sentForApproval(err)) {
        acc.shipTyped = false;
        await refreshAccounts();
      } else toast(err.message, 'error');
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
  // (One at a time: a double-click saved the expense twice and counted it twice in the net profit.)
  $('acc-exp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendOnce($('acc-exp-form'), async () => {
      try {
        await adminApi('/api/admin/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ date: $('exp-date').value, category: $('exp-cat').value, description: $('exp-desc').value, amount: Number(numValue($('exp-amount'))) }) });
        // A fresh form for the next one (its amount box isn't marked as wrong), on the same day and type.
        const keep = [$('exp-date').value, $('exp-cat').value];
        $('acc-exp-form').reset();
        [$('exp-date').value, $('exp-cat').value] = keep;
        $('exp-msg').textContent = t('houses.saved');
        setTimeout(() => { $('exp-msg').textContent = ''; }, 2500);
        await refreshAccounts();
      } catch (err) {
        $('exp-msg').textContent = err.message;
      }
    });
  });

  // ---------- Coupons ----------
  let couponData = null;
  const cpPicked = new Set();
  // The form has no product picker: a coupon limited to some products keeps that list when edited.
  let cpProducts = [];
  // Products the shop stopped selling (archived) are named as such.
  const cpList = (ids, from) => ids.map((id) => {
    const x = from.find((y) => y.id === id) || {};
    return tr(x.name || id) + (x.archived ? ` (${t('pm.arch.tag')})` : '');
  }).join(POD.lang === 'ar' ? '، ' : ', ');
  function cpProductsNote() {
    let el = $('cp-prod-note');
    if (!el) {
      el = document.createElement('p');
      el.id = 'cp-prod-note';
      el.className = 'notice small';
      el.style.margin = '6px 0 0';
      $('cp-cats').parentNode.appendChild(el);
    }
    el.hidden = !cpProducts.length;
    el.textContent = cpProducts.length && couponData ? t('cp.keepProducts', { list: cpList(cpProducts, couponData.products) }) : '';
  }
  function couponSummary(c) {
    const parts = [c.type === 'percent' ? t('cp.sumPercent', { v: POD.num(c.value) }) : c.type === 'fixed' ? t('cp.sumFixed', { v: money(c.value) }) : t('cp.freeship')];
    if (c.maxDiscount) parts.push(t('cp.sumMax', { v: money(c.maxDiscount) }));
    if (c.minOrder) parts.push(t('cp.sumMin', { v: money(c.minOrder) }));
    // (Days in the page language, and in Arabic the arrow points the way it reads: "١ ديسمبر ← ٣١ ديسمبر". QA 25 Nov.)
    if (c.startsOn || c.endsOn) parts.push(`${c.startsOn ? day(c.startsOn, true) : '…'} ${POD.lang === 'ar' ? '←' : '→'} ${c.endsOn ? day(c.endsOn, true) : '…'}`);
    if (c.perCustomer) parts.push(t('cp.sumPer', { n: POD.num(c.perCustomer) }));
    // Limited to some products and / or categories: name them in the page language.
    const only = [(c.products || []).length ? cpList(c.products, couponData.products) : '', c.categories.length ? cpList(c.categories, couponData.categories) : ''].filter(Boolean);
    if (only.length) parts.push(t('cp.sumOnly', { list: only.join(POD.lang === 'ar' ? '، ' : ', ') }));
    return parts.join(SEP());
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
          ${(c.waiting || []).map((w) => `<div class="small" data-cp-waiting><span class="pill queued">${esc(t('ap.waitingHere'))}</span> ${esc(tr(w.summary))}</div>`).join('')}
          <div class="muted small">${esc(couponSummary(c))}</div>
          <div class="small">${esc(listed(t('cp.usage', { n: POD.num(c.uses), max: c.maxUses ? POD.num(c.maxUses) : '∞', v: money(c.discountGiven) })))}</div>
          ${c.note ? `<div class="muted small">${line(c.note)}</div>` : ''}
        </div>
        ${can('coupons.edit') ? `<div class="row" style="gap:8px;flex:0 0 auto">
          <button class="btn btn-sm" type="button" data-cp-toggle="${esc(c.id)}">${esc(t(c.active ? 'cp.pause' : 'cp.resume'))}</button>
          <button class="btn btn-sm" type="button" data-cp-edit="${esc(c.id)}">${esc(t('houses.edit'))}</button>
          <button class="btn btn-sm" type="button" data-cp-del="${esc(c.id)}">${esc(t('houses.delete'))}</button>
        </div>` : ''}
      </div>`;
    }).join('') : `<p class="muted">${esc(t('cp.empty'))}</p>`;
    cpProductsNote();
    cpTypeChanged();
  }
  function cpTypeChanged() {
    const type = $('cp-type').value;
    $('cp-value-f').hidden = type === 'freeship';
    $('cp-max-f').hidden = type !== 'percent';
    const lab = $('cp-value-f').querySelector('label');
    lab.textContent = t(type === 'percent' ? 'cp.valuePercent' : 'cp.valueFixed');
    // The number boxes checked again after the form was filled in, emptied or a box hidden (not sent then).
    $('cp-form').querySelectorAll('input[data-num]').forEach((el) => el.setCustomValidity(el.closest('[hidden]') ? '' : numProblem(el)));
  }
  $('cp-type').addEventListener('change', cpTypeChanged);
  // The coupon as it was when its edit form opened: only what changed is sent (a colleague's pause made meanwhile
  // isn't undone by saving a note from a form opened earlier. QA 25 Nov).
  let cpEditing = null;
  const cpNorm = (v) => (v === undefined || v === null || v === '' ? null : Array.isArray(v) ? [...v].map(String).sort() : typeof v === 'number' ? v : String(v));
  function resetCouponForm() {
    cpEditing = null;
    $('cp-form').reset();
    $('cp-id').value = '';
    $('cp-active').checked = true;
    cpPicked.clear();
    $('cp-cats').querySelectorAll('input').forEach((i) => { i.checked = false; });
    cpProducts = [];
    cpProductsNote();
    $('cp-cancel').hidden = true;
    $('cp-form-title').textContent = t('cp.addTitle');
    cpTypeChanged();
  }
  $('cp-cancel').addEventListener('click', resetCouponForm);
  $('cp-cats').addEventListener('change', (e) => { if (e.target.dataset.cpCat !== undefined) { if (e.target.checked) cpPicked.add(e.target.value); else cpPicked.delete(e.target.value); } });
  // (One at a time: a double-click sent the coupon twice, and the second answer said its code was taken.)
  $('cp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendOnce($('cp-form'), async () => {
      const id = $('cp-id').value;
      const body = {
        code: $('cp-code').value, type: $('cp-type').value, value: numValue($('cp-value')), maxDiscount: numValue($('cp-max')), minOrder: numValue($('cp-min')),
        maxUses: numValue($('cp-uses')), perCustomer: numValue($('cp-per')), startsOn: $('cp-start').value, endsOn: $('cp-end').value,
        categories: [...cpPicked], products: id ? cpProducts : [], active: $('cp-active').checked, note: $('cp-note').value,
      };
      if (id && cpEditing && cpEditing.id === id) {
        for (const k of Object.keys(body)) if (JSON.stringify(cpNorm(body[k])) === JSON.stringify(cpNorm(cpEditing[k]))) delete body[k];
        // (The value goes with its type: a percent and an amount aren't the same number.)
        if ('type' in body && !('value' in body)) body.value = numValue($('cp-value'));
        if (!Object.keys(body).length) {
          resetCouponForm();
          $('cp-msg').textContent = t('houses.saved');
          setTimeout(() => { $('cp-msg').textContent = ''; }, 2500);
          return;
        }
      }
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
  });
  $('cp-list').addEventListener('click', async (e) => {
    const find = (id) => couponData.coupons.find((c) => c.id === id);
    const ed = e.target.closest('[data-cp-edit]');
    const del = e.target.closest('[data-cp-del]');
    const tog = e.target.closest('[data-cp-toggle]');
    try {
      if (ed) {
        const c = find(ed.dataset.cpEdit);
        cpEditing = JSON.parse(JSON.stringify(c)); // what the form started from (only changes are sent)
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
        cpProducts = (c.products || []).slice();
        cpProductsNote();
        $('cp-cancel').hidden = false;
        $('cp-form-title').textContent = t('cp.editTitle');
        cpTypeChanged();
        $('cp-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (tog) {
        const c = find(tog.dataset.cpToggle);
        await adminApi(`/api/admin/coupons/${encodeURIComponent(c.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ active: !c.active }) }); // (only the switch: QA 25 Nov)
        renderCoupons((couponData = await adminApi('/api/admin/coupons')));
      } else if (del && confirm(t('cp.confirmDelete', { code: find(del.dataset.cpDel).code }))) {
        await adminApi(`/api/admin/coupons/${encodeURIComponent(del.dataset.cpDel)}`, { method: 'DELETE' });
        renderCoupons((couponData = await adminApi('/api/admin/coupons')));
      }
    } catch (err) {
      toast(err.message, 'error');
      // Sent for an owner's approval: the row now says it's waiting (so it isn't pressed again).
      if (err && err.pending) adminApi('/api/admin/coupons').then((d) => renderCoupons((couponData = d))).catch(() => {});
    }
  });

  // ---------- Review: complex or flagged jobs, checked by the shop before printing ----------
  let reviewData = null; // { items } from GET /api/admin/review, oldest first
  let reviewCount = null; // null until the list has loaded once
  let reviewError = '';
  let rvScrollTo = null;
  const rvOpen = new Set(); // item ids whose details are open
  const rvNote = {}; // item id -> unsent note to the customer
  const rvMsg = {}; // item id -> { text, ok }
  const rvSideMsg = {}; // `${item id}:${side id}` -> { text, ok }
  const rvLink = {}; // item id -> proof link returned by "resend"
  const rvBusy = new Set();
  const hasStr = (k) => Boolean(window.POD_STRINGS[k]);
  const byAgeRv = (a, b) => String(a.orderedAt || '').localeCompare(String(b.orderedAt || '')) || (a.position || 0) - (b.position || 0);
  const proofOf = (item) => (item && item.proof) || {};
  const rvSides = (item) => (proofOf(item).sides && proofOf(item).sides.length ? proofOf(item).sides : (item && item.sides) || []);
  const rvReasons = (item) => [...new Set([...((item.review && item.review.reasons) || []), ...((proofOf(item).review && proofOf(item).review.reasons) || [])])];
  const rvFind = (id) => reviewData && reviewData.items.find((i) => i.id === id);
  const mm = (inches) => Math.round(inches * 25.4 * 10) / 10;
  const absLink = (link) => { try { return new URL(link, location.origin).href; } catch (e) { return link; } };

  function setReview(items) {
    reviewData = { items: items.slice().sort(byAgeRv) };
    reviewCount = reviewData.items.length;
  }
  // (A corrected file being chosen: the file window is open, so the card isn't drawn again under it and the file
  // chosen isn't lost. Two minutes at most. QA 25 Nov.)
  let rvPickingAt = 0;
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#rv-list [data-rv-file], #rv-list [data-rv-photo], #rv-list .rv-photo-row label')) rvPickingAt = Date.now(); }, true);
  document.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#rv-list [data-rv-file], #rv-list [data-rv-photo]')) rvPickingAt = 0; }, true);
  window.addEventListener('focus', () => { setTimeout(() => { rvPickingAt = 0; }, 1500); });
  async function loadReview() {
    // Don't redraw while the admin is typing a note, or choosing a file.
    const ae = document.activeElement;
    if (reviewData && ae && ae.closest && ae.closest('#rv-list') && ae.tagName === 'TEXTAREA') return;
    if (reviewData && rvPickingAt && Date.now() - rvPickingAt < 120000) return;
    try {
      const items = (await adminApi('/api/admin/review')).items || [];
      await ensureOrders(items);
      setReview(items);
      reviewError = '';
    } catch (err) {
      if (err.status === 401) throw err;
      reviewError = err.message || t('rv.loadFailed');
    }
    renderReview();
    renderReviewCount();
  }
  async function loadReviewCount() {
    try {
      setReview((await adminApi('/api/admin/review')).items || []);
    } catch (e) { /* not available or signed out: no badge */ }
    renderReviewCount();
    renderReviewNotice();
  }
  function renderReviewCount() {
    const el = $('rv-count');
    if (!el) return;
    el.hidden = !reviewCount;
    el.textContent = reviewCount ? POD.num(reviewCount) : '';
    el.title = reviewCount ? POD.plural('rv.count', reviewCount) : '';
  }
  /** On the print queue: how many jobs wait for review (they are not in the queue until approved). */
  function renderReviewNotice() {
    const el = $('rv-queue-note');
    if (!el) return;
    el.innerHTML = reviewCount
      ? `<div class="notice rv-queue-notice"><span>${esc(POD.plural('rv.queueNotice', reviewCount))}</span><button class="btn btn-sm" type="button" data-go-tab="review">${esc(t('rv.goReview'))}</button></div>`
      : '';
  }
  /** An item in the print queue that still needs approval: a badge and a link, no print buttons. */
  function reviewQueueRow(item) {
    return `
      <div class="card queue-row rv-qrow">
        <img src="${esc(item.sides[0].previewUrl)}" alt="" ${zoomAttr(item)}>
        <div>
          <strong>${esc(tr(item.productName))}</strong> ${pill(item.status)} <span class="pill rv-noprint">${esc(t('rv.notPrintable'))}</span>${expressPill(item)}${samplePill(item)}${piecesPill(item)}
          <div class="muted small">${esc([item.orderNumber, t('admin.spec.itemOf', { i: item.position, n: item.of }), ...colourSizeText(item)].join(SEP()))}</div>
        </div>
        <div class="queue-actions">${can('review.view') ? `<button class="btn btn-sm" type="button" data-rv-goto="${esc(item.id)}">${esc(t('rv.goReview'))}</button>` : ''}</div>
      </div>`;
  }
  /** Orders table: items waiting for review or the customer's approval. */
  function orderReview(o) {
    const waiting = o.items.filter((i) => IN_REVIEW.has(i.status));
    if (!waiting.length) return '';
    return `<div class="rv-order-note">${waiting.map((i) => `<span class="rv-order-item"><span class="pill ${esc(i.status)}">${o.items.length > 1 ? esc(POD.num(i.position)) + '. ' : ''}${esc(t('admin.status.' + i.status))}</span>${can('review.view') ? `<button class="btn btn-sm" type="button" data-rv-goto="${esc(i.id)}">${esc(t('rv.goReview'))}</button>` : ''}</span>`).join('')}</div>`;
  }

  function reasonText(item, r) {
    if (r === 'reopened') {
      // (Sent to a printing house or on a DTF film when it came back: said here until it's dealt with.)
      const ws = (item.review && Array.isArray(item.review.reopenWarnings) ? item.review.reopenWarnings : []).map((w) => (w.kind === 'house' ? t('back.warnHouse', { house: w.house, date: POD.date(w.at) }) : t('back.warnFilm', { film: w.film })));
      return [t('rv.reason.reopened', { why: (item.review && item.review.reopenReason) || '' }), ...ws.map((x) => `⚠ ${x}`)].join(' ');
    }
    const m = proofOf(item).merge || item.merge;
    if (r === 'nameList' && m && m.count) return `${t('rv.reason.nameList')}${SEP()}${t('rv.copies', { n: POD.num(m.count) })}`;
    if (r === 'bulk') return `${t('rv.reason.bulk')}${SEP()}${countText(item)}`;
    return hasStr('rv.reason.' + r) ? t('rv.reason.' + r) : r;
  }
  function renderReview() {
    const el = $('rv-list');
    if (!reviewData) {
      el.innerHTML = reviewError ? `<p class="notice">${esc(reviewError)}</p>` : '';
      return;
    }
    const items = reviewData.items;
    el.innerHTML = (reviewError ? `<p class="notice small">${esc(reviewError)}</p>` : '')
      + (items.length ? items.map(rvRow).join('') : `<div class="card empty rv-empty"><p class="muted">${esc(t('rv.empty'))}</p></div>`);
    if (rvScrollTo) {
      const target = document.getElementById('rv-' + rvScrollTo);
      if (target) target.scrollIntoView({ block: 'start' });
      rvScrollTo = null;
    }
  }
  function rvRow(item) {
    const isOpen = rvOpen.has(item.id);
    const c = item.customer || {};
    const thumb = (rvSides(item)[0] || {}).previewUrl || (item.sides && item.sides[0] && item.sides[0].previewUrl) || '';
    const m = proofOf(item).merge || item.merge;
    return `
      <article class="card rv-item ${isOpen ? 'is-open' : ''}" id="rv-${esc(item.id)}">
        <div class="rv-head">
          ${thumb ? `<img class="rv-thumb" src="${esc(thumb)}" alt="" ${item.sides ? zoomAttr(item) : ''}>` : '<span class="rv-thumb"></span>'}
          <div class="rv-sum">
            <div class="rv-line"><strong>${esc(item.orderNumber || '')}</strong> <span class="muted small">${esc(t('admin.spec.itemOf', { i: item.position, n: item.of }))}</span> ${pill(item.status)}${expressPill(item)}${samplePill(item)}</div>
            <div class="rv-line"><b>${esc(tr(item.productName))}</b>${SEP()}${esc(m && m.count ? t('rv.copies', { n: POD.num(m.count) }) : countText(item))}</div>
            <div class="rv-line small">${c.name ? line(c.name) : ''} ${c.phone || c.email ? `<bdi dir="ltr" class="muted">${esc(c.phone || c.email)}</bdi>` : ''}</div>
            <ul class="rv-reasons">${rvReasons(item).map((r) => `<li class="rv-reason rv-r-${esc(r)}">${esc(reasonText(item, r))}</li>`).join('')}</ul>
            <div class="muted small">${esc(t('rv.ordered', { date: when(item.orderedAt) }))}</div>
          </div>
          <button class="btn btn-sm rv-toggle" type="button" data-rv-toggle="${esc(item.id)}" aria-expanded="${isOpen}">${esc(t(isOpen ? 'rv.close' : 'rv.open'))} ${isOpen ? '▴' : '▾'}</button>
        </div>
        ${isOpen ? rvDetail(item) : ''}
      </article>`;
  }

  function rvDetail(item) {
    const proof = proofOf(item);
    const sides = rvSides(item);
    const color = proof.color || item.color || {};
    const size = proof.size || item.size || {};
    const process = proof.process || item.process;
    // Embroidery with a printed side: both, each with how it's made.
    const procs = processesOf({ method: proof.method === 'embroidery' ? 'embroidery' : item.method, process }, sides);
    const facts = [
      [t('rv.product'), esc(tr((proof.product && proof.product.name) || item.productName))],
      hasQty(item) ? [t('adminQty.title'), qtySummary(item)] : [t('rv.colourSize'), `${color.hex ? `<span class="qty-dot" style="background:${esc(color.hex)}"></span>` : ''}${esc(tr(color.name))}${SEP()}${esc(tr(size.label))}`],
      procs.length > 1 ? [t('rv.method'), `<strong>${esc(methodBoth(procs))}</strong>${procs.filter((p) => hasStr('process.' + p)).map((p) => `<div class="method-step">${esc(t('process.' + p))}</div>`).join('')}`]
        : process && hasStr('process.' + process) ? [t('rv.method'), esc(t('process.' + process))] : null,
    ].filter(Boolean);
    return `
      <div class="rv-detail">
        <p class="rv-status-help rv-st-${esc(item.status)}">${esc(hasStr('rv.statusHelp.' + item.status) ? t('rv.statusHelp.' + item.status) : '')}</p>
        ${rvComment(item)}
        <div class="rv-grid">
          <section class="rv-proof">
            <h3>${esc(t('rv.proof'))} ${proof.version ? `<span class="pill queued">${esc(t('rv.version', { v: proof.version }))}</span>` : ''}</h3>
            <dl class="rv-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
            ${proof.pages && proof.pages.length ? rvPages(proof.pages) : ''}
            <div class="rv-mockups">${sides.filter((s) => s.previewUrl).map((s) => `<figure><img src="${esc(s.previewUrl)}" alt="" loading="lazy" data-zoom="${esc(JSON.stringify([s.previewUrl]))}"><figcaption>${esc(t('rv.mockup'))} · ${esc(tr(s.name))}</figcaption></figure>`).join('')}</div>
            ${sides.map((s) => rvArtwork(s)).join('')}
            <p class="rv-screen-note small">${esc(t('rv.screenNote'))}</p>
          </section>
          <div class="rv-aside">
            ${rvChecks(item)}
            ${proof.merge || item.merge ? rvNames(item) : ''}
            ${rvHistory(item)}
            ${rvActions(item)}
            ${item.kind === 'book' || proof.pages || item.kind === 'photoset' ? rvPhotos(item) : rvReplace(item)}
            ${rvLinkBox(item)}
          </div>
        </div>
      </div>`;
  }
  function rvPages(pages) {
    const shown = pages.slice(0, 12);
    return `<div class="rv-pages-wrap"><div class="small muted" style="font-weight:700;margin-bottom:6px">${esc(t('rv.pages'))}</div>
      <div class="rv-pages">${shown.map((u, k) => `<figure><img src="${esc(u)}" alt="" loading="lazy" data-zoom="${esc(JSON.stringify([u]))}"><figcaption>${esc(POD.num(k + 1))}</figcaption></figure>`).join('')}</div>
      ${pages.length > shown.length ? `<div class="muted small">${esc(t('rv.morePages', { n: POD.num(pages.length - shown.length) }))}</div>` : ''}</div>`;
  }
  /**
   * One printed side: the print file on a checkerboard with the trim and safe lines, then its sizes. (This card is
   * the owner's check, in the page's language and digits like the rest of Review; the job card for the print floor
   * keeps its sizes in 0-9, see cm above. In the page's direction too: "١٢٠٠ × ١٦٠٠" forced left to right reads
   * 1600 × 1200.)
   */
  function rvArtwork(s) {
    const b = Number(s.bleedIn) || 0;
    const safe = Number(s.safeIn) || 0;
    const w = Number(s.widthIn) || 0;
    const h = Number(s.heightIn) || 0;
    const W = w + 2 * b || 1;
    const H = h + 2 * b || 1;
    const r = (x, y, rw, rh, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(0, rw)}" height="${Math.max(0, rh)}" vector-effect="non-scaling-stroke"/>`;
    const board = s.artworkUrl ? `
      <div class="rv-board" style="aspect-ratio:${W} / ${H};width:min(100%, ${Math.max(120, Math.round((340 * W) / H))}px)">
        <img src="${esc(s.artworkUrl)}" alt="${esc(t('rv.artwork', { side: tr(s.name) }))}" loading="lazy">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${r(b, b, w, h, 'rv-trim')}${safe ? r(b + safe, b + safe, w - 2 * safe, h - 2 * safe, 'rv-safe') : ''}</svg>
      </div>
      <div class="rv-legend small"><span><i class="rv-key rv-key-trim"></i>${esc(t('rv.legendTrim'))}</span>${safe ? `<span><i class="rv-key rv-key-safe"></i>${esc(t('rv.legendSafe'))}</span>` : ''}</div>` : '';
    const extra = [b ? t('rv.bleed', { mm: mm(b) }) : '', safe ? t('rv.safe', { mm: mm(safe) }) : ''].filter(Boolean).join(SEP());
    return `
      <figure class="rv-art">
        <figcaption><b>${esc(t('rv.artwork', { side: tr(s.name) }))}</b></figcaption>
        ${board}
        <dl class="rv-dims small">
          ${w && h ? `<dt>${esc(t('rv.size'))}</dt><dd>${esc(t('rv.sizeLine', { w: Number(cm(w)), h: Number(cm(h)), wi: Math.round(w * 100) / 100, hi: Math.round(h * 100) / 100 }))}${extra ? `<div class="muted">${esc(extra)}</div>` : ''}</dd>` : ''}
          ${s.widthPx && s.heightPx ? `<dt>DPI · px</dt><dd>${esc(t('rv.resolution', { dpi: s.dpi || '?', w: s.widthPx, h: s.heightPx }))}</dd>` : ''}
        </dl>
      </figure>`;
  }
  /**
   * A print check in the page's words and digits: numbers stay numbers, so t() writes them as ١٢٣ on the Arabic
   * page like the rest of the card (QA 25 Nov: "1200 × 1600 px", "139 DPI" inside Arabic sentences).
   */
  function checkText(c) {
    const p = {};
    const n = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
    for (const [k, v] of Object.entries(c.params || {})) p[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? POD.num(x) : x)).join(POD.lang === 'ar' ? '، ' : ', ') : n(v);
    // (Touching the edge, 0 mm: said in words, as the proof page does, not "closer than 0 mm", QA 25 Nov.)
    const key = c.id === 'outsideSafe' && !Number((c.params || {}).mm) ? ((c.params || {}).name ? 'pf.outsideSafe.named' : 'pf.outsideSafe.edge') : 'pf.' + c.id;
    return hasStr(key) ? t(key, p) : hasStr('pf.' + c.id) ? t('pf.' + c.id, p) : t('pf.unknown', { id: c.id });
  }
  function rvChecks(item) {
    const pf = item.preflight || proofOf(item).preflight;
    const checks = (pf && pf.checks) || [];
    const rank = { fail: 0, warn: 1, info: 2 };
    const list = checks.slice().sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
    const sideName = (id) => { const s = rvSides(item).find((x) => x.id === id); return s ? tr(s.name) : id; };
    return `
      <section class="rv-box">
        <h3>${esc(t('rv.checks'))} ${pf && pf.status ? `<span class="rv-pf rv-pf-${esc(pf.status)}">${esc(t('rv.pf.' + pf.status))}</span>` : ''}</h3>
        ${!pf ? `<p class="muted small">${esc(t('rv.checksNone'))}</p>` : !list.length ? `<p class="small rv-ok">✓ ${esc(t('rv.checksPass'))}</p>` : `
        <ul class="rv-checks">${list.map((c) => `
          <li class="rv-check rv-lv-${esc(c.level)}"><span class="rv-lv">${esc(hasStr('rv.level.' + c.level) ? t('rv.level.' + c.level) : c.level)}</span><span class="rv-check-text">${c.side ? `<b>${esc(sideName(c.side))}:</b> ` : ''}${esc(checkText(c))}</span></li>`).join('')}
        </ul>`}
      </section>`;
  }
  /** The newest note: the customer's comment when they asked for changes, or the shop's note to them. */
  function rvLastNote(item) {
    const list = item.approvals || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i] || {};
      if (a.by === 'customer' && a.action === 'rejected') return a.note ? { who: 'customer', note: a.note, at: a.at } : null;
      if (a.by === 'shop' && a.action === 'changes' && a.note && !a.side) return { who: 'shop', note: a.note, at: a.at };
      if (a.action === 'approved') return null;
    }
    return null;
  }
  function rvComment(item) {
    const n = rvLastNote(item);
    if (!n) return '';
    return `<blockquote class="rv-comment rv-comment-${n.who}"><div class="small"><b>${esc(t(n.who === 'customer' ? 'rv.customerComment' : 'rv.shopNote'))}</b>${n.at ? `${SEP()}<span class="muted">${esc(when(n.at))}</span>` : ''}</div><p dir="auto">${esc(n.note)}</p></blockquote>`;
  }
  function rvHistory(item) {
    const list = (item.approvals || []).slice().reverse();
    const isReplace = (a) => a.by === 'shop' && a.action === 'changes' && a.side;
    const sideName = (id) => { const s = rvSides(item).find((x) => x.id === id); return s ? tr(s.name) : id; };
    const what = (a) => (isReplace(a) ? `${t('rv.action.replaced')} · ${sideName(a.side)}` : hasStr('rv.action.' + a.action) ? t('rv.action.' + a.action) : a.action || '');
    const by = (a) => [hasStr('rv.by.' + a.by) ? t('rv.by.' + a.by) : a.by || '', a.via && hasStr('rv.via.' + a.via) ? t('rv.via.' + a.via) : ''].filter(Boolean).join(' ');
    return `
      <section class="rv-box">
        <h3>${esc(t('rv.history'))}</h3>
        ${list.length ? `
        <table class="rv-history">
          <thead><tr><th>${esc(t('rv.col.action'))}</th><th>${esc(t('rv.col.by'))}</th><th>${esc(t('rv.col.when'))}</th><th>${esc(t('rv.col.version'))}</th><th>${esc(t('rv.col.note'))}</th></tr></thead>
          <tbody>${list.map((a) => `
            <tr class="rv-h-${esc(a.action)}">
              <td data-label="${esc(t('rv.col.action'))}"><span><b>${esc(what(a))}</b>${a.sample ? ` <span class="pill rv-sample">${esc(t('rv.sampleAsked'))}</span>` : ''}</span></td>
              <td data-label="${esc(t('rv.col.by'))}"><span>${esc(by(a))}</span></td>
              <td data-label="${esc(t('rv.col.when'))}"><span>${a.at ? esc(when(a.at)) : '—'}</span></td>
              <td data-label="${esc(t('rv.col.version'))}"><span>${a.version != null ? esc(/^\d+$/.test(String(a.version)) ? POD.num(Number(a.version)) : String(a.version)) : '—'}</span></td>
              <td data-label="${esc(t('rv.col.note'))}"><span dir="auto">${a.note ? esc(a.note) : '<span class="muted">—</span>'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<p class="muted small">${esc(t('rv.historyNone'))}</p>`}
      </section>`;
  }
  function rvNames(item) {
    const m = { ...(item.merge || {}), ...(proofOf(item).merge || {}) };
    const cols = m.columns || [];
    const rows = (m.sample || []).slice(0, 3);
    const cell = (row, col, k) => (Array.isArray(row) ? row[k] : row && typeof row === 'object' ? row[col] : k === 0 ? row : '');
    const printUrl = item.sides && item.sides[0] && item.sides[0].printUrl;
    return `
      <section class="rv-box">
        <h3>${esc(t('rv.nameList'))}</h3>
        <p class="small" style="margin:0 0 8px">${esc(t('rv.nameListInfo', { n: POD.num(m.count || 0), cols: cols.join(', ') }))}</p>
        ${rows.length && cols.length ? `
        <div class="rv-names-wrap"><div class="muted small">${esc(t('rv.nameListFirst'))}</div>
          <table class="rv-names"><thead><tr><th>#</th>${cols.map((c) => `<th dir="auto">${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((row, i) => `<tr><td>${esc(POD.num(i + 1))}</td>${cols.map((c, k) => `<td dir="auto">${esc(cell(row, c, k) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </div>` : ''}
        ${printUrl ? `<button class="btn btn-sm" type="button" data-download="${esc(printUrl)}?format=merge-csv">⬇ ${esc(t('rv.csv'))}</button>` : ''}
      </section>`;
  }
  const msgHtml = (m) => (m ? `<p class="rv-msg ${m.ok ? 'ok' : 'bad'}" aria-live="polite">${esc(m.text)}</p>` : '<p class="rv-msg" aria-live="polite"></p>');
  function rvActions(item) {
    if (!can('review.work')) return `<section class="rv-box rv-decide"><h3>${esc(t('rv.actions'))}</h3><p class="muted small rv-readonly">${esc(t('role.reviewReadOnly'))}</p></section>`;
    const id = esc(item.id);
    const busy = rvBusy.has(item.id);
    const v = proofOf(item).version;
    return `
      <section class="rv-box rv-decide">
        <h3>${esc(t('rv.actions'))}</h3>
        ${item.status === 'awaiting_approval' ? `<p class="muted small">${esc(t('rv.awaitingNote', { v: v || '' }))}</p>` : ''}
        ${item.status !== 'awaiting_approval' && !customerApproved(item) ? `<p class="rv-hint small">${esc(t('rv.notYetApproved'))}</p>` : ''}
        <label class="small" for="rv-note-${id}"><b>${esc(t('rv.note'))}</b></label>
        <textarea id="rv-note-${id}" data-rv-note="${id}" rows="3" maxlength="1000" dir="auto" placeholder="${esc(t('rv.notePh'))}">${esc(rvNote[item.id] || '')}</textarea>
        <div class="rv-btns">
          <button class="btn btn-primary" type="button" data-rv-act="approve" data-rv-id="${id}" ${busy ? 'disabled' : ''}>✓ ${esc(t('rv.approve'))}</button>
          ${item.kind && item.kind !== 'product' ? '' : `<button class="btn" type="button" data-rv-act="changes" data-rv-id="${id}" ${busy ? 'disabled' : ''}>✎ ${esc(t('rv.askChanges'))}</button>`}
        </div>
        ${rvShopEdit(item)}
        ${msgHtml(rvMsg[item.id])}
      </section>`;
  }
  /**
   * The shop edits the design itself (owner's request, 25 Nov): the editor opens with the job's design; saved, it goes
   * to the customer to approve, or prints without asking (an owner's decision; anyone else asks an owner).
   */
  function rvShopEdit(item) {
    if ((item.kind && item.kind !== 'product') || !/^[0-9a-f-]{36}$/i.test(item.designId || '') || !item.orderId) return '';
    if (item.shopEditWaiting) return `<p class="rv-hint small">⏳ ${esc(t('rv.shopEditWaiting', { by: item.shopEditWaiting.by || '—' }))}</p>`;
    return `
        <div class="rv-shopedit" style="margin-top:10px">
          <button class="btn" type="button" data-rv-shopedit="${esc(item.id)}" ${rvBusy.has(item.id) ? 'disabled' : ''}>🖌 ${esc(t('rv.shopEdit'))}</button>
          <p class="muted small" style="margin:4px 0 0">${esc(t(access && access.owner ? 'rv.shopEditHelp' : 'rv.shopEditHelpTeam'))}</p>
        </div>`;
  }
  /** Did the customer approve exactly the files that are there now? (Else approving sends them the proof first.) */
  const customerApproved = (item) => Boolean(item.approval && item.filesMatchApproval !== false && (!proofOf(item).proofHash || item.approval.proofHash === proofOf(item).proofHash));
  function rvReplace(item) {
    if (item.kind === 'gangsheet' || !can('review.work')) return '';
    const sides = rvSides(item).filter((s) => s.widthPx && s.heightPx);
    if (!sides.length) return '';
    // Name lists: the item data doesn't say which sides carry the names (the server refuses those),
    // so no replacement upload at all; the customer corrects the list or the design.
    if (proofOf(item).merge || item.merge) {
      return `
      <section class="rv-box">
        <h3>${esc(t('rv.replace'))}</h3>
        <p class="muted small rv-replace-names" style="margin:0">${esc(t('rv.replaceNamesNote'))}</p>
      </section>`;
    }
    const busy = rvBusy.has(item.id);
    return `
      <section class="rv-box">
        <h3>${esc(t('rv.replace'))}</h3>
        <p class="muted small" style="margin:0 0 8px">${esc(t('rv.replaceHelp'))}</p>
        ${sides.map((s) => `
          <div class="rv-up">
            <label class="btn btn-sm rv-file ${busy ? 'is-busy' : ''}">
              <input class="rv-file-input" type="file" accept="image/png" data-rv-file="${esc(item.id)}" data-rv-side="${esc(s.id)}" ${busy ? 'disabled' : ''}>
              ⬆ ${esc(t('rv.replaceSide', { side: tr(s.name), w: s.widthPx, h: s.heightPx }))}
            </label>
            ${rvSideMsg[item.id + ':' + s.id] ? msgHtml(rvSideMsg[item.id + ':' + s.id]) : ''}
          </div>`).join('')}
      </section>`;
  }
  function rvLinkBox(item) {
    const id = esc(item.id);
    const link = rvLink[item.id] || item.proofLink;
    // Waiting for the customer's changes: their own "edit it and send it again" link, to pass on by WhatsApp
    // (a customer with no email). It opens that item in the editor only: no amounts, nothing else of the order.
    const edit = item.status === 'changes_requested' && typeof item.reviseLink === 'string' && /^\/editor\?/.test(item.reviseLink) ? item.reviseLink : null;
    return `
      <section class="rv-box">
        <h3>${esc(t('rv.link'))}</h3>
        ${link ? `<div class="rv-link"><input type="text" readonly dir="ltr" id="rv-link-${id}" value="${esc(absLink(link))}" aria-label="${esc(t('rv.link'))}"><button class="btn btn-sm" type="button" data-rv-copy="${id}">${esc(t('rv.copy'))}</button></div>
          <p class="muted small" style="margin:4px 0 0">${esc(t('rv.linkForCustomer'))}</p>` : edit ? '' : `<p class="muted small">${esc(t('rv.linkNone'))}</p>`}
        ${edit ? `<p class="small" style="margin:8px 0 4px"><b>${esc(t('rv.editLink'))}</b></p>
          <div class="rv-link"><input type="text" readonly dir="ltr" id="rv-link-edit-${id}" value="${esc(absLink(edit))}" aria-label="${esc(t('rv.editLink'))}"><button class="btn btn-sm" type="button" data-rv-copy="edit-${id}">${esc(t('rv.copy'))}</button></div>
          <p class="muted small" style="margin:4px 0 0">${esc(t('rv.editLinkHelp'))}</p>` : ''}
        ${!can('review.work') ? '' : item.status === 'awaiting_approval'
          ? `<button class="btn btn-sm" type="button" data-rv-act="resend" data-rv-id="${id}" ${rvBusy.has(item.id) ? 'disabled' : ''}>↻ ${esc(t('rv.resend'))}</button>`
          : `<p class="muted small" style="margin:0">${esc(t('rv.resendWhen'))}</p>`}
        ${rvMsg['link:' + item.id] ? msgHtml(rvMsg['link:' + item.id]) : ''}
      </section>`;
  }

  /** Put an item from an action's answer into the list (it leaves the list once printable). */
  function rvApply(id, r) {
    const fresh = r && (r.item && r.item.id ? r.item : r.id ? r : null);
    if (!fresh || !reviewData) return false;
    const list = reviewData.items;
    const k = list.findIndex((i) => i.id === id);
    if (!IN_REVIEW.has(fresh.status)) {
      if (k >= 0) list.splice(k, 1);
      rvOpen.delete(id);
    } else if (k >= 0) list[k] = { ...list[k], ...fresh };
    else list.push(fresh);
    reviewCount = list.length;
    return true;
  }
  async function rvAfter(id, r) {
    if (!rvApply(id, r)) {
      // The answer was only a status: read the list again.
      try { setReview((await adminApi('/api/admin/review')).items || []); } catch (e) { /* keep what we have */ }
    }
    renderReviewCount();
  }
  async function rvAction(id, act) {
    const note = (rvNote[id] || '').trim();
    const msgKey = act === 'resend' ? 'link:' + id : id;
    const waitingChanges = act === 'approve' && (rvFind(id) || {}).status === 'changes_requested';
    if ((act === 'changes' || waitingChanges) && !note) {
      rvMsg[id] = { text: t(waitingChanges ? 'rv.changesApproveNote' : 'rv.noteRequired'), ok: false };
      renderReview();
      const ta = document.getElementById('rv-note-' + id);
      if (ta) ta.focus();
      return;
    }
    rvBusy.add(id);
    rvMsg[msgKey] = { text: t('rv.working'), ok: true };
    renderReview();
    try {
      if (act === 'resend') {
        const r = await adminApi(`/api/admin/items/${encodeURIComponent(id)}/resend-proof`, { method: 'POST', headers: { 'x-lang': POD.lang } });
        if (r && r.proofLink) {
          rvLink[id] = r.proofLink;
          const it = rvFind(id);
          if (it) it.proofLink = r.proofLink;
        }
        rvMsg[msgKey] = { text: t('rv.resent'), ok: true };
      } else {
        const r = await adminApi(`/api/admin/items/${encodeURIComponent(id)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang },
          body: JSON.stringify({ action: act, ...(note ? { note } : {}) }),
        });
        await rvAfter(id, r);
        delete rvNote[id];
        // Approving files the customer has not approved sends them the proof first.
        const done = t(act === 'changes' ? 'rv.changesSent' : r && r.status === 'awaiting_approval' ? 'rv.approvedProofSent' : 'rv.approved');
        rvMsg[msgKey] = { text: done, ok: true };
        toast(done);
      }
    } catch (err) {
      rvMsg[msgKey] = { text: err.message, ok: false };
    }
    rvBusy.delete(id);
    renderReview();
  }
  /** Width and height from a PNG's header (no need to decode a big print file). */
  async function pngSize(file) {
    const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (head.length < 24 || !sig.every((x, i) => head[i] === x)) return null;
    const dv = new DataView(head.buffer);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  /**
   * Photo prints and kids' books (not made in the editor; owner's decision, 25 Nov): the team puts in a better photo
   * (usually from the customer by WhatsApp), with the note of what changed; the customer approves the new proof.
   * (Each photo's size in brackets: after "·" it read as one number in Arabic, "صورة ١ · ١٠" as "١٠٠١". QA 25 Nov.)
   */
  function rvPhotos(item) {
    const isBook = item.kind === 'book';
    if (!can('review.work') || !(isBook || item.kind === 'photoset')) return '';
    const photos = isBook ? [{ n: 'face' }] : (proofOf(item).photos || []);
    if (!photos.length) return '';
    const id = esc(item.id);
    const busy = rvBusy.has(item.id);
    return `
      <section class="rv-box rv-photos">
        <h3>${esc(t(isBook ? 'rv.photoBookTitle' : 'rv.photoTitle'))}</h3>
        <p class="muted small" style="margin:0 0 8px">${esc(t(isBook ? 'rv.photoBookHelp' : 'rv.photoHelp'))}</p>
        ${photos.slice(0, 60).map((p) => {
          const key = item.id + ':photo:' + p.n;
          return `
          <div class="rv-photo-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0">
            ${p.url ? `<img src="${esc(p.url)}" alt="" width="48" height="48" style="object-fit:cover;border-radius:6px" loading="lazy">` : ''}
            <span class="small">${esc(isBook ? t('rv.photoChild') : t('rv.photoN', { n: POD.num(p.n) }))}${p.size && p.size.label ? ` <bdi>(${esc(tr(p.size.label))})</bdi>` : ''}</span>
            <label class="btn btn-sm${busy ? ' disabled' : ''}">${esc(t('rv.photoReplace'))}<input type="file" accept="image/*" hidden data-rv-photo="${id}" data-rv-n="${esc(String(p.n))}" ${busy ? 'disabled' : ''}></label>
            ${rvSideMsg[key] ? msgHtml(rvSideMsg[key]) : ''}
          </div>`;
        }).join('')}
      </section>`;
  }
  async function rvPhotoUpload(input) {
    const id = input.dataset.rvPhoto;
    const n = input.dataset.rvN;
    const file = input.files && input.files[0];
    input.value = '';
    const item = rvFind(id);
    if (!file || !item) return;
    const key = id + ':photo:' + n;
    const fail = (text) => { rvSideMsg[key] = { text, ok: false }; renderReview(); };
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) return fail(t('rv.photoNotImage'));
    const changeNote = (rvNote[id] || '').trim();
    if (!changeNote) return fail(t('rv.replaceNoteNeeded'));
    const nextV = (Number(proofOf(item).version) || 0) + 1;
    if (!confirm(t('rv.replaceConfirm', { v: nextV }))) { delete rvSideMsg[key]; renderReview(); return; }
    rvBusy.add(id);
    rvSideMsg[key] = { text: t('rv.replaceUploading'), ok: true };
    renderReview();
    try {
      const r = await adminApi(`/api/admin/items/${encodeURIComponent(id)}/photo/${encodeURIComponent(n)}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-lang': POD.lang, 'x-review-note': encodeURIComponent(changeNote) },
        body: file,
      });
      delete rvNote[id];
      await rvAfter(id, r);
      const v = proofOf(rvFind(id)).version || nextV;
      rvSideMsg[key] = { text: t('rv.replaceDone', { v }), ok: true };
      toast(t('rv.replaceDone', { v }));
    } catch (err) {
      rvSideMsg[key] = { text: err.message, ok: false };
    }
    rvBusy.delete(id);
    renderReview();
  }
  async function rvUpload(input) {
    const id = input.dataset.rvFile;
    const sideId = input.dataset.rvSide;
    const file = input.files && input.files[0];
    input.value = '';
    const item = rvFind(id);
    const side = item && rvSides(item).find((s) => s.id === sideId);
    if (!file || !side) return;
    const key = id + ':' + sideId;
    const fail = (text) => { rvSideMsg[key] = { text, ok: false }; renderReview(); };
    let size = null;
    try { size = await pngSize(file); } catch (e) { return fail(t('rv.replaceUnreadable')); }
    if (!size) return fail(t('rv.replaceNotPng'));
    if (size.w !== Number(side.widthPx) || size.h !== Number(side.heightPx)) {
      return fail(t('rv.replaceBadSize', { w: size.w, h: size.h, side: tr(side.name), ew: side.widthPx, eh: side.heightPx }));
    }
    // What was changed, for the customer (with the new proof): required, so they know what to look at.
    const changeNote = (rvNote[id] || '').trim();
    if (!changeNote) return fail(t('rv.replaceNoteNeeded'));
    const nextV = (Number(proofOf(item).version) || 0) + 1;
    if (!confirm(t('rv.replaceConfirm', { v: nextV }))) { delete rvSideMsg[key]; renderReview(); return; }
    rvBusy.add(id);
    rvSideMsg[key] = { text: t('rv.replaceUploading'), ok: true };
    renderReview();
    try {
      const r = await adminApi(`/api/admin/items/${encodeURIComponent(id)}/replacement/${encodeURIComponent(sideId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'x-lang': POD.lang, 'x-review-note': encodeURIComponent(changeNote) },
        body: file,
      });
      // (Sent with this file: the next side or decision needs its own note. QA 25 Nov.)
      delete rvNote[id];
      await rvAfter(id, r);
      const v = proofOf(rvFind(id)).version || nextV;
      rvSideMsg[key] = { text: t('rv.replaceDone', { v }), ok: true };
      toast(t('rv.replaceDone', { v }));
    } catch (err) {
      rvSideMsg[key] = { text: err.message, ok: false };
    }
    rvBusy.delete(id);
    renderReview();
  }
  $('rv-list').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-rv-toggle]');
    if (tog) {
      const id = tog.dataset.rvToggle;
      if (rvOpen.has(id)) rvOpen.delete(id);
      else rvOpen.add(id);
      renderReview();
      return;
    }
    const act = e.target.closest('[data-rv-act]');
    if (act) return rvAction(act.dataset.rvId, act.dataset.rvAct);
    // (A new tab of this window: it keeps this tab's sign-in, which the editor uses to save.)
    const se = e.target.closest('[data-rv-shopedit]');
    if (se) {
      const it = rvFind(se.dataset.rvShopedit);
      if (it) window.open(`/editor?design=${encodeURIComponent(it.designId)}&shopEdit=${encodeURIComponent(it.orderId)}.${encodeURIComponent(it.id)}`, '_blank');
      return;
    }
    const copy = e.target.closest('[data-rv-copy]');
    if (copy) {
      const input = document.getElementById('rv-link-' + copy.dataset.rvCopy);
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (err) {
        input.select();
        document.execCommand('copy');
      }
      toast(t('rv.copied'));
    }
  });
  $('rv-list').addEventListener('input', (e) => {
    const id = e.target.dataset && e.target.dataset.rvNote;
    if (id) rvNote[id] = e.target.value;
  });
  $('rv-list').addEventListener('change', (e) => {
    if (e.target.matches('[data-rv-file]')) rvUpload(e.target);
    if (e.target.matches('[data-rv-photo]')) rvPhotoUpload(e.target);
  });
  // "Open in Review" from the print queue and the orders table.
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-rv-goto]');
    if (!go) return;
    rvOpen.add(go.dataset.rvGoto);
    rvScrollTo = go.dataset.rvGoto;
    document.querySelector('[data-tab="review"]').click();
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
    zoom.classList.toggle('two', urls.length === 2);
    zoom.classList.toggle('many', urls.length > 2);
    // Booklets: the pages wrap into rows sized to fit the window; past 12, the first 11 and "+N pages".
    const MAXZ = 12;
    const shown = urls.length > MAXZ ? urls.slice(0, MAXZ - 1) : urls;
    const tiles = shown.length + (urls.length > MAXZ ? 1 : 0);
    if (urls.length > 2) {
      const cols = Math.min(tiles, Math.max(2, Math.ceil(Math.sqrt(tiles * 1.4))));
      const rows = Math.ceil(tiles / cols);
      const w = Math.min(220, (innerWidth * 0.9 - 16 - 8 * (cols - 1)) / cols);
      const h = Math.min(w * 1.3, (innerHeight * 0.88 - 16 - 8 * (rows - 1)) / rows);
      zoom.style.setProperty('--zoom-w', `${Math.floor(w)}px`);
      zoom.style.setProperty('--zoom-h', `${Math.floor(h)}px`);
      zoom.style.setProperty('--zoom-cols', String(cols));
    }
    zoom.innerHTML = shown.map((u) => `<img src="${esc(u)}" alt="">`).join('') + (urls.length > MAXZ ? `<span class="zoom-more">${esc(t('admin.zoomMore', { n: POD.num(urls.length - shown.length) }))}</span>` : '');
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
        const res = await fetch(dl.dataset.download, { headers: { ...authHeader(), 'x-lang': POD.lang } });
        if (!res.ok) {
          // 409 notApproved: the file is not (or no longer) the one the customer approved.
          const body = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
          throw new Error((body && body.error) || t(res.status === 409 ? 'rv.notApproved' : 'admin.downloadFailed'));
        }
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
      // (from: the status this list shows; if a colleague moved the job meanwhile, the server says so.)
      const shown = itemById(btn.dataset.item);
      await adminApi('/api/admin/items/' + encodeURIComponent(btn.dataset.item), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status, ...(shown && shown.status ? { from: shown.status } : {}) }),
      });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      if (err.status === 409) refresh().catch(() => {});
    }
  });

  AdminProducts.init({ api: adminApi, role: () => role, can, legacyOwner: () => Boolean(access && access.owner && !access.system) });
  AdminPreview.init({ api: adminApi });
  AdminBackup.init({ api: adminApi });
  // ("Find it in Ready designs" only for those who see that tab.)
  AdminRights.init({ api: adminApi, library: () => can('library.view'), goToDesign: (id, o) => (can('library.view') ? goToLibraryDesign(id, o) : undefined) });
  AdminStaff.init({ api: adminApi, access: () => access });
  AdminApprovals.init({
    api: adminApi,
    access: () => access,
    // The badge follows what the list says is waiting.
    counted: (n) => {
      if (!access) return;
      if (access.owner) access.pendingApprovals = n;
      else access.myPending = n;
      renderApprovalsBadge();
    },
  });
  AdminActivity.init({ api: adminApi, access: () => access });
  // A change sent for an owner's approval: one more of "My requests" on the tab's badge.
  AdminRoles.onPending(() => {
    if (!access || access.owner) return;
    access.myPending += 1;
    renderApprovalsBadge();
  });
  AdminUploads.init({
    api: adminApi,
    token: () => token,
    signOut,
    renderer: loadLibRenderer,
    categories: () => (lastLibrary ? lastLibrary.categories : []),
    // New designs published: the list below shows them.
    published: () => adminApi('/api/admin/library').then((lib) => tab === 'library' && renderLibrary(lib)).then(() => tab === 'library' && loadLibWords()).catch(() => {}),
  });
  // /admin#rights: the owner's WhatsApp / email alert for a rights request opens Rights requests (a product
  // manager is sent to their own tabs as usual once the page knows who is signed in).
  const tabFromHash = () => (location.hash === '#rights' ? 'rights' : '');
  const savedTab = (() => { try { return sessionStorage.getItem('pod-admin-tab') || ''; } catch (e) { return ''; } })();
  if (tabFromHash()) showTab(tabFromHash());
  else if (savedTab && savedTab !== tab && document.querySelector(`[data-tab="${savedTab}"]`)) showTab(savedTab);
  window.addEventListener('hashchange', () => {
    const want = tabFromHash();
    if (want && want !== tab && AdminRoles.tabAllowed(access, want)) document.querySelector(`[data-tab="${want}"]`).click();
  });

  // ---------- My account: who is signed in, change my password ----------
  document.addEventListener('click', (e) => {
    if ($('me-menu').open && !e.target.closest('#me-menu')) $('me-menu').open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('me-menu').open) {
      $('me-menu').open = false;
      const s = $('me-menu').querySelector('summary');
      if (s) s.focus();
    }
  });
  $('me-pw').addEventListener('click', () => {
    $('me-menu').open = false;
    passwordDialog();
  });
  /** Change my own password (personal logins; not the shared emergency owner password). */
  function passwordDialog() {
    const d = document.createElement('dialog');
    d.className = 'pm-dlg me-dlg';
    d.innerHTML = `<form class="pm-dlg-form" novalidate>
        <h3>${esc(t('me.changePw'))}</h3>
        <p class="muted small">${esc(t('me.pwHelp'))}</p>
        <input type="text" name="username" autocomplete="username" value="${esc((access && access.name) || '')}" hidden>
        <div class="field"><label for="me-cur">${esc(t('me.current'))}</label><input type="password" id="me-cur" name="current" autocomplete="current-password" dir="ltr" maxlength="200" required></div>
        <div class="field"><label for="me-new">${esc(t('me.new'))}</label><input type="password" id="me-new" name="password" autocomplete="new-password" dir="ltr" minlength="10" maxlength="200" required></div>
        <div class="field"><label for="me-new2">${esc(t('me.again'))}</label><input type="password" id="me-new2" name="again" autocomplete="new-password" dir="ltr" maxlength="200" required></div>
        <p class="ro-err" role="alert" hidden></p>
        <div class="pm-dlg-btns"><button class="btn" type="button" data-me-cancel>${esc(t('me.cancel'))}</button><button class="btn btn-primary" type="submit">${esc(t('me.save'))}</button></div>
      </form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    const err = d.querySelector('.ro-err');
    const say = (m) => { err.textContent = m; err.hidden = !m; };
    form.addEventListener('input', () => say(''));
    d.querySelector('[data-me-cancel]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = form.current.value;
      const password = form.password.value;
      if (!current) return void (say(t('me.needCurrent')), form.current.focus());
      if (password.length < 10) return void (say(t('me.pwShort')), form.password.focus());
      if (password !== form.again.value) return void (say(t('me.pwMismatch')), form.again.focus());
      say('');
      const ok = form.querySelector('[type=submit]');
      ok.disabled = true;
      try {
        const r = await adminApi('/api/admin/me/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, password }) });
        // A new password signs out every other browser: this one carries on with the new sign-in it got back.
        if (r && typeof r.token === 'string' && r.token) {
          token = r.token;
          sessionStorage.setItem(KEY, token);
        }
        d.close();
        toast(t('me.pwDone'));
      } catch (ex) {
        if (ex.status !== 401) say(ex.message);
      } finally {
        ok.disabled = false;
      }
    });
    d.showModal();
    form.current.focus();
  }

  // ---------- Setting a password from the one-time link (/admin?setup=TOKEN) ----------
  const setupToken = (() => { try { return new URLSearchParams(location.search).get('setup') || ''; } catch (e) { return ''; } })();
  function showSetup() {
    $('login').hidden = true;
    $('dash').hidden = true;
    $('setup').hidden = false;
    $('setup-pw').focus();
  }
  $('setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('setup-pw').value;
    const say = (m) => { $('setup-err').textContent = m; $('setup-err').hidden = !m; };
    if (pw.length < 10) return void (say(t('me.pwShort')), $('setup-pw').focus());
    if (pw !== $('setup-pw2').value) return void (say(t('me.pwMismatch')), $('setup-pw2').focus());
    say('');
    const btn = $('setup').querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await POD.api('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: setupToken, password: pw }) });
      const username = (r && r.username) || '';
      $('setup-pw').value = '';
      $('setup-pw2').value = '';
      $('setup').hidden = true;
      $('setup-done').hidden = false;
      // (The username in its own direction inside the Arabic sentence.)
      $('setup-done-text').textContent = t('setup.done', { username: `\u2068${username}\u2069` });
      $('setup-go').dataset.username = username;
      // The link is used up: a reload shows the sign-in, not the form again.
      try { history.replaceState(null, '', location.pathname); } catch (err) { /* the address keeps it */ }
    } catch (ex) {
      // An expired or used link (or one that never was): ask for a new one. A password the server refuses: its words.
      // (Too many tries: the server's own "wait" message, not "the link expired".)
      say(ex.status >= 400 && ex.status < 500 && ex.status !== 429 && !/password/i.test(ex.code || '') ? t('setup.bad') : ex.message);
    } finally {
      btn.disabled = false;
    }
  });
  // "Go to sign in": the sign-in form here, with the username filled in.
  $('setup-go').addEventListener('click', (e) => {
    e.preventDefault();
    $('setup-done').hidden = true;
    $('username').value = $('setup-go').dataset.username || '';
    $('login').hidden = false;
    $('password').focus();
  });

  if (setupToken) {
    showSetup();
  } else {
    // Who is signed in first (a product manager's page must never call the owner's routes), then the tab.
    refresh().catch(() => {});
  }
  setInterval(() => !document.hidden && token && $('setup').hidden && $('setup-done').hidden && refresh({ auto: true }).catch(() => {}), 15000);
})();
