/* My account: sign in / sign up, previous orders and their status, profile and
 * delivery address, password. The session is an httpOnly cookie set by the server. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const catalog = await POD.loadCatalog().catch(() => ({ governorates: [] }));
  let me = null;
  let orders = null;

  async function load() {
    try {
      me = (await POD.api('/api/account')).customer;
    } catch (e) {
      me = null;
    }
    try { if (me) localStorage.setItem('pod-acct', '1'); else localStorage.removeItem('pod-acct'); } catch (e) { /* private mode */ }
    render();
  }

  // ---------- Signed out ----------
  function showForm(id) {
    for (const f of ['f-in', 'f-up', 'f-forgot', 'f-reset']) $(f).hidden = f !== id;
    document.querySelectorAll('[data-acct-tab]').forEach((b) => b.classList.toggle('active', (b.dataset.acctTab === 'in' && id === 'f-in') || (b.dataset.acctTab === 'up' && id === 'f-up')));
  }
  document.querySelectorAll('[data-acct-tab]').forEach((b) => b.addEventListener('click', () => showForm(b.dataset.acctTab === 'up' ? 'f-up' : 'f-in')));
  $('forgot-open').addEventListener('click', () => { $('fg-login').value = $('in-login').value; showForm('f-forgot'); });
  const busy = (form, on) => form.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  async function submit(form, fn) {
    busy(form, true);
    try {
      await fn();
    } catch (e) {
      POD.toast(e.message, 'error');
    } finally {
      busy(form, false);
    }
  }
  $('f-in').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-in'), async () => {
      await POD.api('/api/account/login', json('POST', { login: $('in-login').value, password: $('in-pass').value }));
      $('in-pass').value = '';
      await afterSignIn();
    });
  });
  $('f-up').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-up'), async () => {
      await POD.api('/api/account/signup', json('POST', { name: $('up-name').value, phone: $('up-phone').value, email: $('up-email').value, password: $('up-pass').value }));
      $('up-pass').value = '';
      POD.toast(t('acct.welcome'));
      await afterSignIn();
    });
  });
  $('f-forgot').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-forgot'), async () => {
      const r = await POD.api('/api/account/forgot', json('POST', { login: $('fg-login').value }));
      const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(t('acct.waReset', { login: $('fg-login').value }))}` : '';
      $('fg-msg').innerHTML = `${esc(t(r.byEmail ? 'acct.linkSent' : 'acct.noEmail'))}${wa ? ` <a class="btn btn-sm btn-whatsapp" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('acct.askWhatsApp'))}</a>` : ''}`;
    });
  });
  $('f-reset').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('f-reset'), async () => {
      await POD.api('/api/account/reset', json('POST', { token: params.get('reset'), password: $('rs-pass').value }));
      history.replaceState(null, '', '/account');
      POD.toast(t('acct.passwordChanged'));
      await afterSignIn();
    });
  });
  async function afterSignIn() {
    orders = null;
    // Came here from checkout: go back there.
    if (params.get('next') === 'cart') {
      location.href = '/cart';
      return;
    }
    await load();
  }

  // ---------- Signed in ----------
  let view = 'orders';
  document.querySelectorAll('[data-acct-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.acctView; render(); }));
  $('logout').addEventListener('click', async () => {
    await POD.api('/api/account/logout', { method: 'POST' }).catch(() => {});
    me = null;
    orders = null;
    try { localStorage.removeItem('pod-acct'); } catch (e) { /* private mode */ }
    render();
  });
  const STATUS = { received: 'queued', in_production: 'printing', shipped: 'shipped' };
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
    $('v-orders').innerHTML = orders.length ? orders.map((o) => `
      <a class="card acct-order" href="/order?id=${encodeURIComponent(o.id)}">
        <div class="acct-order-pics">${o.items.slice(0, 3).map((i) => `<img src="${esc(i.sides[0].previewUrl)}" alt="">`).join('')}</div>
        <div class="acct-order-info">
          <strong>${esc(t('order.title', { n: o.number }))}</strong> <span class="pill ${STATUS[o.status] || 'queued'}">${esc(t('order.' + o.status))}</span>
          <div class="muted small">${esc(POD.date(o.createdAt))} · ${esc(o.items.map((i) => tr(i.productName)).join('، '))}</div>
        </div>
        <div class="acct-order-total">${esc(money(o.total))}</div>
      </a>`).join('') : `<div class="card empty"><h3>${esc(t('acct.noOrders'))}</h3><a class="btn btn-primary" href="/#products">${esc(t('home.start'))}</a></div>`;
  }
  function renderProfile() {
    $('pf-name').value = me.name;
    $('pf-phone').value = me.phone;
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
      me = (await POD.api('/api/account', json('PUT', { name: $('pf-name').value, email: $('pf-email').value, address: { governorate: $('pf-gov').value, city: $('pf-city').value, address: $('pf-address').value, notes: $('pf-notes').value } }))).customer;
      POD.toast(t('houses.saved'));
      render();
    });
  });
  $('v-security').addEventListener('submit', (e) => {
    e.preventDefault();
    submit($('v-security'), async () => {
      await POD.api('/api/account/password', json('POST', { current: $('pw-cur').value, password: $('pw-new').value }));
      $('pw-cur').value = '';
      $('pw-new').value = '';
      POD.toast(t('acct.passwordChanged'));
    });
  });

  function render() {
    $('acct-out').hidden = Boolean(me);
    $('acct-in').hidden = !me;
    if (!me) {
      if (params.get('reset')) showForm('f-reset');
      else if ($('f-in').hidden && $('f-up').hidden && $('f-forgot').hidden) showForm('f-in');
      return;
    }
    $('acct-hello').textContent = t('acct.hello', { name: me.name.split(' ')[0] });
    document.querySelectorAll('[data-acct-view]').forEach((b) => b.classList.toggle('active', b.dataset.acctView === view));
    $('v-orders').hidden = view !== 'orders';
    $('v-profile').hidden = view !== 'profile';
    $('v-security').hidden = view !== 'security';
    if (view === 'orders') renderOrders();
    if (view === 'profile') renderProfile();
  }
  if (params.get('mode') === 'signup') showForm('f-up');
  document.addEventListener('pod:langchange', render);
  await load();
})();
