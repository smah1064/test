/* My account: sign in / sign up, previous orders (track, invoice, order again),
 * drafts saved to the account, profile and delivery address, password.
 * The session is an httpOnly cookie set by the server. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const catalog = await POD.loadCatalog().catch(() => ({ governorates: [] }));
  let me = null;
  let orders = null;
  let drafts = null;
  let providers = {};

  async function load() {
    try {
      const r = await POD.api('/api/account');
      me = r.customer;
      providers = r.providers || {};
    } catch (e) {
      me = null;
    }
    try {
      const before = localStorage.getItem('pod-acct');
      // Someone else signed in on this browser: the last customer's drafts kept here go.
      // Someone else signed in, or the last customer's session ended without signing out (a shared
      // phone): nothing of theirs stays here (drafts, cart, photos, a storybook's answers).
      if (before && before !== '1' && (!me || before !== me.id)) {
        await POD.drafts.clearLocal();
        POD.forgetPersonal();
      }
      if (me) localStorage.setItem('pod-acct', me.id);
      else localStorage.removeItem('pod-acct');
    } catch (e) { /* private mode */ }
    render();
  }

  // Back from Google / Facebook with a problem.
  const OAUTH_MSG = { failed: 'acct.oauthFailed', cancelled: 'acct.oauthCancelled', unavailable: 'acct.oauthUnavailable', wait: 'acct.oauthWait' };
  if (OAUTH_MSG[params.get('oauth')]) {
    POD.toast(t(OAUTH_MSG[params.get('oauth')]), params.get('oauth') === 'cancelled' ? undefined : 'error');
    const u = new URL(location.href);
    u.searchParams.delete('oauth');
    history.replaceState(null, '', u.pathname + u.search);
  }
  function renderSocial() {
    const next = params.get('next') === 'cart' ? '?next=cart' : '';
    let any = false;
    for (const name of ['google', 'facebook']) {
      const a = $('soc-' + name);
      a.hidden = !providers[name];
      a.href = `/auth/${name}${next}`;
      any ||= Boolean(providers[name]);
    }
    $('acct-social').hidden = !any;
  }

  // ---------- Signed out ----------
  function showForm(id) {
    for (const f of ['f-in', 'f-up', 'f-forgot', 'f-reset']) $(f).hidden = f !== id;
    document.querySelectorAll('[data-acct-tab]').forEach((b) => b.classList.toggle('active', (b.dataset.acctTab === 'in' && id === 'f-in') || (b.dataset.acctTab === 'up' && id === 'f-up')));
  }
  document.querySelectorAll('[data-acct-tab]').forEach((b) => b.addEventListener('click', () => showForm(b.dataset.acctTab === 'up' ? 'f-up' : 'f-in')));
  $('forgot-open').addEventListener('click', () => { $('fg-login').value = $('in-login').value; showForm('f-forgot'); });
  const busy = (form, on) => form.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  // The CAPTCHA of each form starts when the customer starts filling it in.
  const caps = { 'f-in': POD.captcha($('cap-in')), 'f-up': POD.captcha($('cap-up')), 'f-forgot': POD.captcha($('cap-fg')) };
  for (const [id, cap] of Object.entries(caps)) $(id).addEventListener('focusin', () => cap.prepare(), { once: true });
  // Messages under a form are drawn by a function, so a language switch draws them again in the new language
  // (they stayed in the old one. QA 26 Nov). A message from the server is shown in our words when we have them,
  // otherwise it goes on a switch (it would stay in the old language).
  const msgPaint = new Map();
  function showMsg(id, paint) {
    msgPaint.set(id, paint);
    paint($(id));
  }
  document.addEventListener('pod:langchange', () => msgPaint.forEach((paint, id) => { if (!$(id).hidden && $(id).textContent.trim()) paint($(id)); }));
  const SERVER_WORDS = { acctWrongCurrent: 'acct.wrongCurrent', acctPasswordShort: 'acct.passwordShort' };
  function serverMsg(err) {
    const key = err && SERVER_WORDS[err.code];
    let first = true;
    return (el) => {
      if (key) el.textContent = t(key);
      else if (first) el.textContent = err.message;
      else { el.textContent = ''; el.hidden = true; }
      first = false;
    };
  }
  async function submit(form, fn) {
    busy(form, true);
    const cap = caps[form.id];
    try {
      const captchaToken = cap ? await cap.token() : null;
      await fn(captchaToken ? { captchaToken } : {});
    } catch (e) {
      POD.toast(e.message, 'error');
    } finally {
      if (cap) cap.reset();
      busy(form, false);
    }
  }
  $('f-in').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-in'), async (cap) => {
      await POD.api('/api/account/login', json('POST', { login: $('in-login').value, password: $('in-pass').value, ...cap }));
      $('in-pass').value = '';
      await afterSignIn();
    });
  });
  $('f-up').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-up'), async (cap) => {
      await POD.api('/api/account/signup', json('POST', { name: $('up-name').value, phone: $('up-phone').value, email: $('up-email').value, password: $('up-pass').value, ...cap }));
      $('up-pass').value = '';
      POD.toast(t('acct.welcome'));
      await afterSignIn();
    });
  });
  $('f-forgot').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-forgot'), async (cap) => {
      const r = await POD.api('/api/account/forgot', json('POST', { login: $('fg-login').value, ...cap }));
      const login = $('fg-login').value;
      showMsg('fg-msg', (el) => {
        const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(t('acct.waReset', { login }))}` : '';
        el.innerHTML = `${esc(t(r.byEmail ? 'acct.linkSent' : 'acct.noEmail'))}${wa ? ` <a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('acct.askWhatsApp'))}</a>` : ''}`;
      });
    });
  });
  $('f-reset').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-reset'), async () => {
      await POD.api('/api/account/reset', json('POST', { token: params.get('reset'), password: $('rs-pass').value }));
      $('rs-pass').value = '';
      // The link is used up: back to the account page (signed in now, with the new password).
      params.delete('reset');
      history.replaceState(null, '', '/account');
      POD.toast(t('acct.passwordChanged'));
      await afterSignIn();
    });
  });
  async function afterSignIn() {
    orders = null;
    drafts = null;
    // Who is signed in now (and the last customer's drafts in this browser cleared) before going anywhere.
    await load();
    // Came here from checkout: go back there.
    if (params.get('next') === 'cart') location.href = '/cart';
  }

  // ---------- Signed in ----------
  const VIEWS = ['orders', 'drafts', 'profile', 'security'];
  let view = VIEWS.includes(params.get('view')) ? params.get('view') : 'orders';
  document.querySelectorAll('[data-acct-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.acctView;
    // Drafts change from other devices: fetch them again each time the tab is opened.
    if (view === 'drafts') drafts = null;
    render();
  }));
  $('logout').addEventListener('click', async () => {
    await POD.api('/api/account/logout', { method: 'POST' }).catch(() => {});
    me = null;
    orders = null;
    drafts = null;
    try { localStorage.removeItem('pod-acct'); localStorage.removeItem('pod-cart-base'); } catch (e) { /* private mode */ }
    // Their drafts are on their account; nothing of theirs stays in this browser
    // (a shared family phone): no drafts, no cart, no checkout choices, no photos or storybook answers,
    // nothing typed in the forms.
    await POD.drafts.clearLocal();
    POD.forgetPersonal();
    document.querySelectorAll('#acct-out input').forEach((i) => { if (i.type !== 'checkbox' && i.type !== 'hidden') i.value = ''; });
    const toasts = document.getElementById('toast-root');
    if (toasts) toasts.innerHTML = '';
    showForm('f-in');
    render();
  });
  const STATUS = { received: 'queued', in_production: 'printing', shipped: 'shipped', delivered: 'delivered' };
  // "Order again" per order: { busy, added, skipped, error, pick (item ids being ticked) }, kept across re-renders.
  const reo = {};
  /** "Which items do you want again?" for an order with several items: every item ticked to start with. */
  function pickHtml(o) {
    const pick = reo[o.id].pick;
    return `
      <div class="reo-pick" role="group" aria-label="${esc(t('track.reorderPick'))}">
        <h3>${esc(t('track.reorderPick'))}</h3>
        <ul>${o.items.map((item, i) => `
          <li><label><input type="checkbox" data-pick="${esc(item.id)}" data-order="${esc(o.id)}"${pick.has(item.id) ? ' checked' : ''}>
            <span>${esc(POD.num(i + 1))}. <bdi>${esc(PODAftercare.pickText(item))}</bdi></span></label></li>`).join('')}</ul>
        <div class="row">
          <button class="btn btn-sm btn-primary" type="button" data-reorder-picked="${esc(o.id)}"${pick.size ? '' : ' disabled'}>${esc(t('track.reorderAdd', { n: POD.num(pick.size) }))}</button>
          <button class="btn btn-sm" type="button" data-reorder-cancel="${esc(o.id)}">${esc(t('track.reorderCancel'))}</button>
        </div>
      </div>`;
  }
  function reorderNotice(id) {
    const r = reo[id];
    if (!r) return '';
    if (r.error) return `<p class="notice reo-notice reo-bad" role="alert">${esc(r.error)}</p>`;
    if (!r.skipped) return '';
    return `
      <div class="notice reo-notice${r.added ? '' : ' reo-bad'}" role="status">
        <p>${esc(r.added ? POD.plural('track.reorderPartial', r.added) : t('track.reorderNone'))}</p>
        <ul>${PODAftercare.skippedLines(r.skipped).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${r.added ? `<a class="btn btn-sm btn-primary" href="/cart?added=1">${esc(t('track.goCart'))}</a>` : ''}
      </div>`;
  }
  function orderCard(o) {
    const href = POD.orderPath('order', o.id, o.key);
    const busyNow = reo[o.id] && reo[o.id].busy;
    const pics = o.items.map((i) => i.sides && i.sides[0] && i.sides[0].previewUrl).filter(Boolean);
    return `
      <div class="card acct-order">
        <a class="acct-order-pics" href="${href}" tabindex="-1" aria-hidden="true">${pics.slice(0, 3).map((u) => `<img src="${esc(u)}" alt="">`).join('')}${pics.length > 3 ? `<span class="acct-order-more">+${esc(POD.num(pics.length - 3))}</span>` : ''}</a>
        <div class="acct-order-info">
          <a class="acct-order-title" href="${href}"><strong>${esc(t('order.title', { n: POD.orderNo(o.number) }))}</strong></a> <span class="pill ${STATUS[o.status] || 'queued'}">${esc(t('order.' + (o.status === 'in_review' && (o.items || []).some((i) => i.status === 'awaiting_approval' || i.status === 'changes_requested') ? 'waiting_you' : o.status)))}</span>
          <div class="muted small">${esc(POD.date(o.createdAt))}${esc(POD.sep())}${esc(o.items.map((i) => tr(i.productName)).join(POD.lang === 'ar' ? '، ' : ', '))}</div>
          ${o.items.filter((i) => PODAftercare.showBreakdown(i)).map((i) => `<div class="acct-order-qty"><span class="acct-qty-name">${esc(tr(i.productName))}</span>${PODAftercare.qtyHtml(i, { inline: true })}</div>`).join('')}
        </div>
        <div class="acct-order-total">${esc(money(o.total))}</div>
        <div class="acct-order-actions">
          <a class="btn btn-sm" href="${href}">${esc(t('track.track'))}</a>
          <a class="btn btn-sm" href="${esc(POD.orderPath('invoice', o.id, o.key))}">${esc(t('track.invoice'))}</a>
          <button class="btn btn-sm btn-primary" type="button" data-reorder="${esc(o.id)}"${busyNow ? ' disabled' : ''}>${esc(t(busyNow ? 'track.reordering' : 'track.reorder'))}</button>
        </div>
        ${reo[o.id] && reo[o.id].pick ? pickHtml(o) : ''}
        ${reorderNotice(o.id)}
      </div>`;
  }
  async function renderOrders() {
    if (!orders) {
      $('v-orders').innerHTML = `<div class="pv-loading"><div class="spinner"></div></div>`;
      try {
        orders = (await POD.api('/api/account/orders')).orders;
      } catch (e) {
        $('v-orders').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
        return;
      }
    }
    $('v-orders').innerHTML = orders.length ? orders.map(orderCard).join('') : `<div class="card empty"><h3>${esc(t('acct.noOrders'))}</h3><a class="btn btn-primary" href="/#products">${esc(t('home.start'))}</a></div>`;
  }
  // A preview whose file is gone: keep the grey box, not a broken-image icon.
  $('v-orders').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/%3E'; }, true);
  $('v-orders').addEventListener('change', (e) => {
    const box = e.target.closest('[data-pick]');
    const r = box && reo[box.dataset.order];
    if (!r || !r.pick) return;
    if (box.checked) r.pick.add(box.dataset.pick);
    else r.pick.delete(box.dataset.pick);
    const add = $('v-orders').querySelector(`[data-reorder-picked="${CSS.escape(box.dataset.order)}"]`);
    if (add) {
      add.textContent = t('track.reorderAdd', { n: POD.num(r.pick.size) });
      add.disabled = !r.pick.size;
    }
  });
  $('v-orders').addEventListener('click', async (e) => {
    const cancel = e.target.closest('[data-reorder-cancel]');
    if (cancel) {
      delete reo[cancel.dataset.reorderCancel];
      renderOrders();
      return;
    }
    const picked = e.target.closest('[data-reorder-picked]');
    const b = picked || e.target.closest('[data-reorder]');
    if (!b) return;
    const id = picked ? picked.dataset.reorderPicked : b.dataset.reorder;
    if (reo[id] && reo[id].busy) return;
    const o = (orders || []).find((x) => x.id === id);
    // Several items: first the list to tick ("Order again" again closes it).
    if (!picked && o && o.items.length > 1) {
      if (reo[id] && reo[id].pick) delete reo[id];
      else reo[id] = { pick: new Set(o.items.map((it) => it.id)) };
      renderOrders();
      return;
    }
    const itemIds = picked && reo[id] && reo[id].pick ? [...reo[id].pick] : undefined;
    if (picked && !(itemIds && itemIds.length)) return;
    reo[id] = { busy: true };
    renderOrders();
    try {
      const r = await PODAftercare.reorder(id, itemIds && o && itemIds.length < o.items.length ? itemIds : undefined, o && o.key);
      if (r.added && !r.skipped.length) {
        location.href = '/cart?added=1';
        return;
      }
      reo[id] = { added: r.added, skipped: r.skipped };
    } catch (err) {
      reo[id] = { error: err.message };
    }
    renderOrders();
  });

  // ---------- Drafts saved to the account ----------
  async function renderDrafts() {
    // "My saved designs": the same list as under the cart (ready to order, and not finished yet).
    const box = $('v-drafts');
    box.classList.add('card', 'saved-box', 'acct-saved');
    if (!drafts) {
      box.innerHTML = `<div class="pv-loading"><div class="spinner"></div></div>`;
      await PODSaved.loadDrafts(true);
      drafts = [];
      if (view !== 'drafts') return;
    }
    await PODSaved.render(box, { showEmpty: true, note: 'saved.noteAccount', onToCart: () => { location.href = '/cart'; }, onChange: renderDrafts });
    box.hidden = view !== 'drafts';
  }
  // The account the profile form was last filled from: until it changes (saved, signed in again),
  // a language switch only redraws the form's words and keeps what the customer typed, as the checkout does.
  let profileFrom = null;
  /** The governorates in the page's language, with this one chosen. */
  function renderGovernorates(chosen) {
    $('pf-gov').innerHTML = `<option value="">${esc(t('checkout.choose'))}</option>` + catalog.governorates.map((g) => `<option value="${g.id}">${esc(tr(g.name))}</option>`).join('');
    $('pf-gov').value = chosen || '';
  }
  function renderProfile({ keepTyped = false } = {}) {
    if (keepTyped && profileFrom === me) {
      renderGovernorates($('pf-gov').value);
      return;
    }
    profileFrom = me;
    $('pf-name').value = me.name;
    $('pf-phone').value = me.phone || '';
    $('pf-email').value = me.email || '';
    const a = me.address || {};
    renderGovernorates(a.governorate);
    $('pf-city').value = a.city || '';
    $('pf-address').value = a.address || '';
    $('pf-notes').value = a.notes || '';
  }
  $('v-profile').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('v-profile'), async () => {
      try {
        me = (await POD.api('/api/account', json('PUT', { name: $('pf-name').value, phone: $('pf-phone').value, email: $('pf-email').value, address: { governorate: $('pf-gov').value, city: $('pf-city').value, address: $('pf-address').value, notes: $('pf-notes').value } }))).customer;
      } catch (err) {
        // The site's words for these are for signing up ("…Sign in instead"): this customer is signed in already.
        const taken = { acctPhoneTaken: ['acct.phoneUsedOther', 'pf-phone'], acctEmailTaken: ['acct.emailUsedOther', 'pf-email'] }[err.code];
        if (!taken) throw err;
        $(taken[1]).focus();
        throw new Error(t(taken[0]));
      }
      POD.toast(t('houses.saved'));
      render();
    });
  });
  // Signed in but the current password is forgotten: a reset link to the account's email.
  $('pw-forgot').addEventListener('click', async () => {
    const b = $('pw-forgot');
    b.disabled = true;
    try {
      const r = await POD.api('/api/account/forgot', json('POST', { login: me.email || me.phone }));
      const { email, phone } = me;
      showMsg('pw-forgot-msg', (el) => {
        const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(t('acct.waReset', { login: phone || email }))}` : '';
        el.innerHTML = email && r.byEmail
          ? esc(t('acct.linkSentTo', { email }))
          : `${esc(t('acct.noEmail'))}${wa ? ` <a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('acct.askWhatsApp'))}</a>` : ''}`;
      });
    } catch (err) {
      POD.toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });
  // Delete my account: with the password (or, with no password, ticking that they're sure). Its own form, so its
  // Delete button and Enter in its password box do the same, and Enter never sends "Change password" with empty boxes.
  $('del-open').addEventListener('click', () => {
    $('del-box').hidden = false;
    $('del-pw-field').hidden = !me.hasPassword;
    $('del-msg').hidden = true;
    (me.hasPassword ? $('del-pw') : $('del-sure')).focus();
  });
  $('del-cancel').addEventListener('click', () => { $('del-box').hidden = true; $('del-pw').value = ''; $('del-sure').checked = false; });
  $('del-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const say = (paint) => showMsg('del-msg', (el) => { el.hidden = false; paint(el); });
    if (!$('del-sure').checked) return say((el) => { el.textContent = t('acct.deleteTick'); });
    if (me.hasPassword && !$('del-pw').value) return say((el) => { el.textContent = t('acct.deleteNeedPw'); });
    $('del-go').disabled = true;
    try {
      await POD.api('/api/account/delete', json('POST', me.hasPassword ? { password: $('del-pw').value } : { confirm: true }));
      try { localStorage.removeItem('pod-acct'); } catch (e) { /* private mode */ }
      alert(t('acct.deleted'));
      location.href = '/';
    } catch (err) {
      const paint = serverMsg(err);
      say((el) => paint(el));
    } finally {
      $('del-go').disabled = false;
    }
  });
  $('pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('pw-form'), async () => {
      await POD.api('/api/account/password', json('POST', { current: $('pw-cur').value, password: $('pw-new').value }));
      $('pw-cur').value = '';
      $('pw-new').value = '';
      POD.toast(t('acct.passwordChanged'));
      me.hasPassword = true;
      render();
    });
  });

  /** keepTyped: only the words change (a language switch); what is typed in the profile form stays. */
  function render({ keepTyped = false } = {}) {
    // A reset link opens the "choose a new password" form, also when someone is already
    // signed in on this browser (the link may even be for another account).
    const resetting = Boolean(params.get('reset'));
    $('acct-out').hidden = Boolean(me) && !resetting;
    $('acct-in').hidden = !me || resetting;
    renderSocial();
    // Signed in: no "sign in / create an account" choices around the reset form.
    document.querySelector('#acct-out .acct-tabs').hidden = Boolean(me && resetting);
    if (me && resetting) $('acct-social').hidden = true;
    let keep = $('rs-keep');
    if (me && resetting && !keep) {
      keep = Object.assign(document.createElement('button'), { type: 'button', id: 'rs-keep', className: 'link-btn small' });
      keep.style.marginTop = '10px';
      keep.addEventListener('click', () => {
        params.delete('reset');
        const u = new URL(location.href);
        u.searchParams.delete('reset');
        history.replaceState(null, '', u.pathname + u.search);
        render();
      });
      $('f-reset').append(keep);
    }
    if (keep) {
      keep.hidden = !(me && resetting);
      keep.textContent = t('acct.resetKeep');
    }
    if (!me || resetting) {
      // Guests: the orders placed from this phone or computer, to find them again.
      $('device-orders').innerHTML = me ? '' : PODAftercare.deviceOrdersHtml();
      if (resetting) showForm('f-reset');
      else if ($('f-in').hidden && $('f-up').hidden && $('f-forgot').hidden) showForm('f-in');
      return;
    }
    // (A first name of two words, عبد الرحمن, kept on one line: never "أهلًا، عبد" above "الرحمن".)
    $('acct-hello').textContent = t('acct.hello', { name: POD.firstName(me.name).replace(/ /g, '\u00a0') });
    document.querySelectorAll('[data-acct-view]').forEach((b) => b.classList.toggle('active', b.dataset.acctView === view));
    $('v-orders').hidden = view !== 'orders';
    $('v-drafts').hidden = view !== 'drafts';
    $('v-profile').hidden = view !== 'profile';
    $('v-security').hidden = view !== 'security';
    // Accounts made with Google/Facebook: no mobile number yet, maybe no password.
    $('acct-phone-note').hidden = Boolean(me.phone);
    $('pw-cur-field').hidden = !me.hasPassword;
    // Signed in with Google and no password yet: they can just choose one.
    $('pw-nopass').hidden = me.hasPassword;
    $('pw-forgot-box').hidden = !me.hasPassword;
    $('pw-submit').textContent = t(me.hasPassword ? 'acct.changePassword' : 'acct.setPassword');
    if (view === 'orders') renderOrders();
    if (view === 'drafts') renderDrafts();
    if (view === 'profile') renderProfile({ keepTyped });
  }
  if (params.get('mode') === 'signup') showForm('f-up');
  if (params.get('welcome')) {
    view = 'profile';
    history.replaceState(null, '', '/account');
  }
  document.addEventListener('pod:langchange', () => render({ keepTyped: true }));
  await load();
})();
