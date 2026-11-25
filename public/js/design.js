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
  // Only the products this design is offered on (the same check as the designs page, the product page and the editor).
  // Products the shop doesn't sell right now (admin → Products) are not in the catalogue, so not offered here.
  const fitting = catalog.products.filter((p) => !p.kind && POD.designFor(design, p));
  const products = fitting.length ? fitting : catalog.products.filter((p) => !p.kind && !(p.laser || p.pattern));
  if (!products.length) {
    const box = $('dp-missing');
    const show = () => {
      box.hidden = false;
      box.classList.add('unavail');
      box.innerHTML = `<h2>${esc(t('dp.noProducts'))}</h2><div class="unavail-actions"><a class="btn btn-primary" href="/designs">${esc(t('design.browse'))}</a><a class="btn" href="/#products">${esc(t('unavail.browse'))}</a></div>`;
    };
    show();
    document.addEventListener('pod:langchange', show);
    return;
  }
  // A link to a product the shop doesn't sell now (an old link, a paused product, one it stopped selling):
  // say so, and show another one (for one it stopped selling, a similar one: the same kind of product).
  const askedFor = params.get('product');
  const askedGone = Boolean(askedFor) && !products.some((p) => p.id === askedFor);
  // (A product in the shop that this design just isn't offered on: no reason to ask the shop why.)
  const gone = askedGone && !catalog.products.some((p) => p.id === askedFor) ? await POD.productState(askedFor) : null;
  let instead = null; // the similar product shown instead of one the shop stopped selling
  if (gone && gone.state === 'retired') {
    // The design's own product when it is that kind of product, else the first similar one it goes on.
    const like = POD.similarProducts({ products }, gone);
    if (like.same) instead = products.find((p) => p.id === design.product && p.category === gone.category) || like.list[0];
  }
  $('dp').hidden = false;
  const state = { product: null, color: null, size: null };
  // The design's own colour (a design for a black T-shirt: white ink), for products without that colour id.
  const isDark = (hex) => POD.luminance(hex) < 0.45;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dist = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);
  const own = catalog.products.find((p) => p.id === design.product);
  const ownColor = own && own.colors.find((c) => c.id === design.color);
  const ownHex = ownColor && (own.surface || ownColor.hex);
  /** The product's colour nearest the design's own, if the first colour is the wrong lightness for it. */
  function nearestOwn(product) {
    const first = product.colors.find((c) => POD.colorOk(product, c)) || POD.firstPick(product.colors);
    if (!ownHex || product.surface || isDark(first.hex) === isDark(ownHex)) return first;
    const alike = product.colors.filter((c) => POD.colorOk(product, c) && isDark(c.hex) === isDark(ownHex));
    return alike.length ? alike.reduce((best, c) => (dist(c.hex, ownHex) < dist(best.hex, ownHex) ? c : best)) : first;
  }
  function choose(productId, colorId) {
    state.product = products.find((p) => p.id === productId) || products.find((p) => p.id === design.product) || products[0];
    // Sold-out colours and sizes are listed (crossed out) but never chosen.
    const pickable = state.product.colors.filter((c) => POD.colorOk(state.product, c));
    state.color = pickable.find((c) => c.id === colorId) || pickable.find((c) => c.id === design.color) || nearestOwn(state.product);
    // A size sold out in this colour (stock per colour and size): the first size left in it instead.
    const ok = (s) => POD.sizeOk(state.product, state.color.id, s);
    const was = state.size;
    if (!was || !state.product.sizes.some((s) => s.id === was.id && ok(s))) {
      state.size = state.product.sizes.find(ok) || POD.firstPick(state.product.sizes);
      return was && state.size && was.id !== state.size.id && state.product.sizes.some((s) => s.id === was.id) ? was : null;
    }
    return null;
  }
  choose(instead ? instead.id : params.get('product'), params.get('color'));

  // ---------- Picture ----------
  let token = 0;
  let zoomReady = false; // hover / tap zoom on the picture, set up with the first picture
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
      cv = window.POD_PREVIEW.sizedPicture(cv, POD.sizeView(product, size.id), { whole: !product.photoChestCm });
      const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
      const old = $('dp-img').src;
      $('dp-img').src = URL.createObjectURL(blob);
      // Where the design is in the picture, for "Zoom to the design".
      $('dp-img').zoomFocus = cv.focus && typeof cv.focus === 'object' ? cv.focus : null;
      if (!zoomReady) {
        zoomReady = true;
        window.POD_PREVIEW.zoomable($('dp-img'));
      }

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
    $('dp-gone').hidden = !askedGone;
    const more = gone ? POD.similarHref(catalog, gone) : '/#products';
    $('dp-gone').innerHTML = askedGone ? `${esc(goneText())} <a href="${esc(more)}">${esc(gone ? POD.similarLabel(more) : t('unavail.browse'))}</a>` : '';
    $('dp-products').innerHTML = products.map((p) => `<button type="button" class="dp-product ${p.id === product.id ? 'active' : ''}" data-product="${esc(p.id)}" title="${esc(tr(p.name))}">
      <img alt="" loading="lazy" src="${esc(POD.productPicture(p))}" data-fallback="${esc(POD.thumbFallback(p))}"><span>${esc(tr(p.name))}</span></button>`).join('');
    $('dp-colors').innerHTML = product.colors.map((c) => (!POD.colorOk(product, c)
      ? `<button type="button" class="swatch sold-out" aria-disabled="true" data-sold="${esc(c.id)}" title="${esc(t('soldOutColor', { name: tr(c.name) }))}" aria-label="${esc(t('soldOutColor', { name: tr(c.name) }))}" style="background:${esc(c.hex)}"></button>`
      : `<button type="button" class="swatch ${c.id === color.id ? 'active' : ''}" data-color="${esc(c.id)}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" style="background:${esc(c.hex)}"></button>`)).join('');
    $('dp-color-name').textContent = tr(color.name);
    // Sizes sold out (in every colour, or in the chosen one when stock is counted per colour and size): crossed out.
    $('dp-sizes').innerHTML = product.sizes.map((s) => {
      if (POD.sizeOk(product, color.id, s)) {
        return `<button type="button" class="chip ${s.id === size.id ? 'active' : ''}" data-size="${esc(s.id)}" aria-pressed="${s.id === size.id}">${esc(tr(s.label))}${POD.sizeNote(product, s) ? ` <span style="opacity:.7">${esc(POD.sizeNote(product, s))}</span>` : ''}</button>`;
      }
      const why = s.soldOut ? t('soldOut') : t('soldOutCombo', { colour: tr(color.name), size: tr(s.label) });
      return `<button type="button" class="chip sold-out" aria-disabled="true" data-sold-size="${esc(s.id)}" title="${esc(why)}" aria-label="${esc(why)}"><span class="sold-label">${esc(tr(s.label))}</span> <span class="sold-tag">${esc(t('soldOut'))}</span></button>`;
    }).join('');
    // "Only n left": of the chosen colour in the chosen size, else of the whole product.
    const few = POD.comboFew(product, color.id, size.id) || product.fewLeft || 0;
    $('dp-few').hidden = !few;
    $('dp-few').textContent = few ? t('pp.fewLeft', { n: POD.num(few) }) : '';
    $('dp-price').textContent = money(product.basePrice + size.surcharge);
    $('dp-edit').href = `/editor?library=${encodeURIComponent(design.id)}&product=${product.id}&color=${color.id}`;
    document.title = `${tr(design.name)} · ${t('brand')}`;
    const active = $('dp-products').querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  /** Why the product in the link isn't shown: paused (back soon, or the day), stopped selling, or just not available. */
  function goneText() {
    const name = gone && gone.name ? tr(gone.name) : '';
    if (!name) return t('dp.productGone');
    if (gone.state === 'retired') return t(instead ? 'dp.productRetired' : 'dp.productRetiredOther', { name });
    const back = POD.backText(gone);
    return back ? t('dp.productPaused', { name, back }) : t('dp.productGone');
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
  // A product picture that can't be made: the drawn product.
  $('dp-products').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fallback) return;
    const fb = img.dataset.fallback;
    img.dataset.fallback = '';
    img.src = fb;
  }, true);
  $('dp-colors').addEventListener('click', (e) => {
    const sold = e.target.closest('[data-sold]');
    if (sold) {
      POD.toast(sold.title);
      return;
    }
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === state.color.id) return;
    const moved = choose(state.product.id, b.dataset.color);
    renderOptions();
    if (moved) POD.toast(t('sizeMovedTo', { size: tr(moved.label), to: tr(state.size.label) }));
    syncUrl();
    draw();
  });
  $('dp-sizes').addEventListener('click', (e) => {
    const sold = e.target.closest('[data-sold-size]');
    if (sold) {
      POD.toast(sold.title || t('soldOut'));
      return;
    }
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
      // Sold out or hidden since the page opened (POST /api/designs answers 409): the shop's list again.
      if (/Unavailable$/.test(e.code || '')) refreshCatalog();
    }
  });

  /** The shop's catalogue changed under the page: open it again on what can be ordered now. */
  function refreshCatalog() {
    setTimeout(() => location.reload(), 2500);
  }

  renderOptions();
  draw();
  document.addEventListener('pod:langchange', renderOptions);
})();
