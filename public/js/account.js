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
      if (me && before && before !== '1' && before !== me.id) await POD.drafts.clearLocal();
      if (me) localStorage.setItem('pod-acct', me.id);
      else localStorage.removeItem('pod-acct');
    } catch (e) { /* private mode */ }
    render();
  }

  // Back from Google / Facebook with a problem.
  const OAUTH_MSG = { failed: 'acct.oauthFailed', cancelled: 'acct.oauthCancelled', unavailable: 'acct.oauthUnavailable' };
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
      const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(t('acct.waReset', { login: $('fg-login').value }))}` : '';
      $('fg-msg').innerHTML = `${esc(t(r.byEmail ? 'acct.linkSent' : 'acct.noEmail'))}${wa ? ` <a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('acct.askWhatsApp'))}</a>` : ''}`;
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
    try { localStorage.removeItem('pod-acct'); } catch (e) { /* private mode */ }
    // Their drafts are on their account; nothing of theirs stays in this browser.
    await POD.drafts.clearLocal();
    render();
  });
  const STATUS = { received: 'queued', in_production: 'printing', shipped: 'shipped', delivered: 'delivered' };
  // "Order again" per order: { busy, added, skipped, error }, kept across re-renders.
  const reo = {};
  function reorderNotice(id) {
    const r = reo[id];
    if (!r) return '';
    if (r.error) return `<p class="notice reo-notice reo-bad" role="alert">${esc(r.error)}</p>`;
    if (!r.skipped) return '';
    return `
      <div class="notice reo-notice${r.added ? '' : ' reo-bad'}" role="status">
        <p>${esc(r.added ? t('track.reorderPartial', { n: POD.num(r.added) }) : t('track.reorderNone'))}</p>
        <ul>${PODAftercare.skippedLines(r.skipped).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${r.added ? `<a class="btn btn-sm btn-primary" href="/cart?added=1">${esc(t('track.goCart'))}</a>` : ''}
      </div>`;
  }
  function orderCard(o) {
    const href = `/order?id=${encodeURIComponent(o.id)}`;
    const busyNow = reo[o.id] && reo[o.id].busy;
    const pics = o.items.map((i) => i.sides && i.sides[0] && i.sides[0].previewUrl).filter(Boolean);
    return `
      <div class="card acct-order">
        <a class="acct-order-pics" href="${href}" tabindex="-1" aria-hidden="true">${pics.slice(0, 3).map((u) => `<img src="${esc(u)}" alt="">`).join('')}${pics.length > 3 ? `<span class="acct-order-more">+${esc(POD.num(pics.length - 3))}</span>` : ''}</a>
        <div class="acct-order-info">
          <a class="acct-order-title" href="${href}"><strong>${esc(t('order.title', { n: o.number }))}</strong></a> <span class="pill ${STATUS[o.status] || 'queued'}">${esc(t('order.' + o.status))}</span>
          <div class="muted small">${esc(POD.date(o.createdAt))} · ${esc(o.items.map((i) => tr(i.productName)).join(POD.lang === 'ar' ? '، ' : ', '))}</div>
          ${o.items.filter((i) => PODAftercare.showBreakdown(i)).map((i) => `<div class="acct-order-qty"><span class="acct-qty-name">${esc(tr(i.productName))}</span>${PODAftercare.qtyHtml(i, { inline: true })}</div>`).join('')}
        </div>
        <div class="acct-order-total">${esc(money(o.total))}</div>
        <div class="acct-order-actions">
          <a class="btn btn-sm" href="${href}">${esc(t('track.track'))}</a>
          <a class="btn btn-sm" href="/invoice?id=${encodeURIComponent(o.id)}">${esc(t('track.invoice'))}</a>
          <button class="btn btn-sm btn-primary" type="button" data-reorder="${esc(o.id)}"${busyNow ? ' disabled' : ''}>${esc(t(busyNow ? 'track.reordering' : 'track.reorder'))}</button>
        </div>
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
  $('v-orders').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reorder]');
    if (!b) return;
    const id = b.dataset.reorder;
    if (reo[id] && reo[id].busy) return;
    reo[id] = { busy: true };
    renderOrders();
    try {
      const r = await PODAftercare.reorder(id);
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
  /** The product drawn in the draft's colour, when the saved preview is missing. */
  function mockupFor(d) {
    const p = (catalog.products || []).find((x) => x.id === d.productId);
    if (!p || !p.sides || !p.sides[0]) return '';
    const c = (p.colors || []).find((x) => x.id === d.colorId) || (p.colors || [])[0];
    try { return POD.mockupUrl(p.sides[0], c ? c.hex : '#ffffff', 'full') || ''; } catch (e) { return ''; }
  }
  async function renderDrafts() {
    const box = $('v-drafts');
    if (!drafts) {
      box.innerHTML = `<div class="pv-loading"><div class="spinner"></div></div>`;
      try {
        drafts = (await POD.api('/api/account/drafts')).drafts || [];
      } catch (e) {
        box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
        return;
      }
      if (view !== 'drafts') return;
    }
    if (!drafts.length) {
      box.innerHTML = `<div class="card empty drafts-empty"><h3>${esc(t('acct.noDrafts'))}</h3><p class="muted">${esc(t('acct.noDraftsText'))}</p><a class="btn btn-primary" href="/#products">${esc(t('home.start'))}</a></div>`;
      return;
    }
    box.innerHTML = `
      <p class="acct-note">${esc(t('acct.draftsNote'))}</p>
      <div class="drafts-grid">${drafts.map((d) => {
        const edit = `/editor?product=${encodeURIComponent(d.productId)}`;
        const fallback = mockupFor(d);
        const src = d.previewUrl ? (d.previewUrl.includes('?') ? d.previewUrl : `${d.previewUrl}?v=${encodeURIComponent(d.savedAt || '')}`) : fallback;
        return `
        <div class="card draft-card">
          <a class="draft-pic" href="${esc(edit)}" tabindex="-1" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(fallback)}">` : ''}</a>
          <div class="draft-body">
            <strong>${esc(tr(d.productName) || d.productId)}</strong>
            <span class="muted small">${d.savedAt ? esc(t('acct.draftSaved', { date: POD.date(d.savedAt) })) : ''}</span>
            <div class="draft-actions">
              <a class="btn btn-sm btn-primary" href="${esc(edit)}">${esc(t('acct.continue'))}</a>
              <button class="btn btn-sm btn-danger" type="button" data-del-draft="${esc(d.productId)}">${esc(t('acct.deleteDraft'))}</button>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`;
  }
  // A preview that no longer loads: show the plain product instead.
  $('v-drafts').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const fb = img.dataset.fallback;
    img.dataset.fallback = '';
    if (fb) img.src = fb; else img.remove();
  }, true);
  $('v-drafts').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-draft]');
    if (!b) return;
    const id = b.dataset.delDraft;
    const d = drafts.find((x) => x.productId === id);
    if (!confirm(t('acct.deleteDraftConfirm', { name: d ? tr(d.productName) : id }))) return;
    b.disabled = true;
    try {
      await POD.api(`/api/account/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // The copy kept in this browser goes too, or the editor would bring it back.
      await POD.drafts.remove(id);
      drafts = drafts.filter((x) => x.productId !== id);
      POD.toast(t('acct.draftDeleted'));
      renderDrafts();
    } catch (err) {
      POD.toast(err.message, 'error');
      b.disabled = false;
    }
  });
  function renderProfile() {
    $('pf-name').value = me.name;
    $('pf-phone').value = me.phone || '';
    $('pf-email').value = me.email || '';
    const a = me.address || {};
    $('pf-gov').innerHTML = `<option value="">${esc(t('checkout.choose'))}</option>` + catalog.governorates.map((g) => `<option value="${g.id}">${esc(tr(g.name))}</option>`).join('');
    $('pf-gov').value = a.governorate || '';
    $('pf-city').value = a.city || '';
    $('pf-address').value = a.address || '';
    $('pf-notes').value = a.notes || '';
  }
  $('v-profile').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('v-profile'), async () => {
      me = (await POD.api('/api/account', json('PUT', { name: $('pf-name').value, phone: $('pf-phone').value, email: $('pf-email').value, address: { governorate: $('pf-gov').value, city: $('pf-city').value, address: $('pf-address').value, notes: $('pf-notes').value } }))).customer;
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
      const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(t('acct.waReset', { login: me.phone || me.email }))}` : '';
      $('pw-forgot-msg').innerHTML = me.email && r.byEmail
        ? esc(t('acct.linkSentTo', { email: me.email }))
        : `${esc(t('acct.noEmail'))}${wa ? ` <a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('acct.askWhatsApp'))}</a>` : ''}`;
    } catch (err) {
      POD.toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  });
  $('v-security').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('v-security'), async () => {
      await POD.api('/api/account/password', json('POST', { current: $('pw-cur').value, password: $('pw-new').value }));
      $('pw-cur').value = '';
      $('pw-new').value = '';
      POD.toast(t('acct.passwordChanged'));
      me.hasPassword = true;
      render();
    });
  });

  function render() {
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
    $('acct-hello').textContent = t('acct.hello', { name: me.name.split(' ')[0] });
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
    if (view === 'profile') renderProfile();
  }
  if (params.get('mode') === 'signup') showForm('f-up');
  if (params.get('welcome')) {
    view = 'profile';
    history.replaceState(null, '', '/account');
  }
  document.addEventListener('pod:langchange', render);
  await load();
})();
