/* Ready-made design page: pick the product, colour and size, see it on the real
 * photo, and add it to the cart without opening the editor. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const catalog = await POD.loadCatalog();
  let design;
  let categories = [];
  try {
    [design, { categories }] = await Promise.all([POD.api('/api/library/' + encodeURIComponent(params.get('id') || '')), POD.api('/api/library')]);
  } catch (e) {
    $('dp-missing').hidden = false;
    return;
  }
  $('dp').hidden = false;

  // Only the products this design is offered on (the same check as the designs page, the product page and the editor).
  const fitting = catalog.products.filter((p) => !p.kind && POD.designFor(design, p));
  const products = fitting.length ? fitting : catalog.products.filter((p) => !p.kind);
  const state = { product: null, color: null, size: null };
  function choose(productId, colorId) {
    state.product = products.find((p) => p.id === productId) || products.find((p) => p.id === design.product) || products[0];
    state.color = state.product.colors.find((c) => c.id === colorId) || state.product.colors.find((c) => c.id === design.color) || state.product.colors[0];
    if (!state.size || !state.product.sizes.some((s) => s.id === state.size.id)) state.size = state.product.sizes[0];
  }
  choose(params.get('product'), params.get('color'));

  // ---------- Picture ----------
  let token = 0;
  let current = null; // { st, entry } for the preview window
  async function draw() {
    const my = ++token;
    $('dp-spin').hidden = false;
    $('dp-img').style.opacity = '.35';
    const { product, color, size } = state;
    const side = product.sides[0];
    try {
      const st = await POD_RENDER.stage(design, product, side, color, size.id);
      const entry = {
        side,
        rects: st.R,
        design: POD_RENDER.designLayer(st, 3),
        wrap: product.model && product.model.type === 'canvas' ? POD_RENDER.designLayer(st, 3, st.R.bleed) : null,
        designScale: 3,
        hasDesign: true,
        base: POD.mockupUrl(side, color.hex),
        hex: color.hex,
        overlay: side.overlay ? POD.mockupUrl(side, color.hex, 'overlay') : null,
      };
      const cfg = window.POD_PREVIEW.photoFor(product, side.id);
      let cv;
      try {
        cv = cfg ? await window.POD_PREVIEW.renderPhoto(product, entry, cfg, color.hex) : await window.POD_PREVIEW.renderRealistic(product, entry);
      } catch (e) {
        cv = POD_RENDER.picture(st, 1.6);
      }
      if (my !== token) return;
      // Garment sizes: smaller sizes show a smaller garment, like in the editor.
      cv = window.POD_PREVIEW.sizedPicture(cv, POD.sizeView(product, size.id));
      const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
      const old = $('dp-img').src;
      $('dp-img').src = URL.createObjectURL(blob);

      if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      current = { st, entry };
    } finally {
      if (my === token) {
        $('dp-spin').hidden = true;
        $('dp-img').style.opacity = '';
      }
    }
  }

  // ---------- Options ----------
  function renderOptions() {
    const { product, color, size } = state;
    const cat = categories.find((c) => c.id === design.category);
    $('dp-cat').textContent = cat ? tr(cat.name) : t('nav.designs');
    $('dp-cat').href = cat ? `/designs?cat=${cat.id}` : '/designs';
    $('dp-name').textContent = tr(design.name);
    $('dp-img').alt = t('design.imgAlt', { design: tr(design.name), product: tr(product.name) });
    $('dp-products').innerHTML = products.map((p) => `<button type="button" class="dp-product ${p.id === product.id ? 'active' : ''}" data-product="${p.id}" title="${esc(tr(p.name))}">
      <img alt="" loading="lazy" src="/api/thumbs/${p.id}/${p.colors[0].id}.webp"><span>${esc(tr(p.name))}</span></button>`).join('');
    $('dp-colors').innerHTML = product.colors.map((c) => `<button class="swatch ${c.id === color.id ? 'active' : ''}" data-color="${c.id}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" style="background:${c.hex}"></button>`).join('');
    $('dp-color-name').textContent = tr(color.name);
    $('dp-sizes').innerHTML = product.sizes.map((s) => `<button class="chip ${s.id === size.id ? 'active' : ''}" data-size="${s.id}">${esc(tr(s.label))}${s.surcharge ? ` <span style="opacity:.7">+${esc(money(s.surcharge))}</span>` : ''}</button>`).join('');
    $('dp-price').textContent = money(product.basePrice + size.surcharge);
    $('dp-edit').href = `/editor?library=${encodeURIComponent(design.id)}&product=${product.id}&color=${color.id}`;
    document.title = `${tr(design.name)} · ${t('brand')}`;
    const active = $('dp-products').querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function syncUrl() {
    history.replaceState(null, '', `/design?id=${encodeURIComponent(design.id)}&product=${state.product.id}&color=${state.color.id}`);
  }

  $('dp-products').addEventListener('click', (e) => {
    const b = e.target.closest('[data-product]');
    if (!b || b.dataset.product === state.product.id) return;
    choose(b.dataset.product, state.color.id);
    renderOptions();
    syncUrl();
    draw();
  });
  $('dp-colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === state.color.id) return;
    choose(state.product.id, b.dataset.color);
    renderOptions();
    syncUrl();
    draw();
  });
  $('dp-sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    if (b.dataset.size === state.size.id) return;
    state.size = state.product.sizes.find((s) => s.id === b.dataset.size);
    renderOptions();
    draw();
  });
  $('dp-preview').addEventListener('click', () => {
    if (!current) return;
    // The previews need every side of the product; the others are blank.
    const sides = state.product.sides.map((sd) => (sd.id === current.entry.side.id ? current.entry : POD_RENDER.emptyEntry(state.product, sd, state.color)));
    window.POD_PREVIEW.open({ product: state.product, color: state.color, sides, startSide: current.entry.side.id, viewScale: POD.sizeView(state.product, state.size.id) });
  });

  const busy = (on, text) => {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  };
  $('dp-add').addEventListener('click', async () => {
    const btn = $('dp-add');
    btn.disabled = true;
    busy(true, t('busy.preparing'));
    try {
      await POD_RENDER.addToCart({
        design, product: state.product, color: state.color, size: state.size,
        onProgress: (step) => busy(true, t(step === 'upload' ? 'busy.saving' : step === 'finish' ? 'busy.finishing' : 'busy.preparing')),
      });
      location.href = '/cart?added=1';
    } catch (e) {
      busy(false);
      btn.disabled = false;
      POD.toast(e.message, 'error');
    }
  });

  renderOptions();
  draw();
  document.addEventListener('pod:langchange', renderOptions);
})();
