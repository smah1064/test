/* Product page: start a design from scratch, or pick one of the ready-made
 * designs (shown on this product, in the chosen colour) to order as it is or
 * to edit in the editor. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let catalog;
  let lib;
  try {
    [catalog, lib] = await Promise.all([POD.loadCatalog(), POD.api('/api/library')]);
    const forThis = catalog.products.find((p) => p.id === params.get('id'));
    if (forThis) lib.designs = lib.designs.filter((d) => POD.designFor(d, forThis));
  } catch (e) {
    $('pp-missing').hidden = false;
    return;
  }
  const product = catalog.products.find((p) => p.id === params.get('id'));
  if (product && product.kind === 'book') {
    location.replace(`/book?b=${encodeURIComponent(product.book)}`);
    return;
  }
  if (product && product.kind === 'photoset') {
    location.replace('/photos');
    return;
  }
  if (!product) {
    $('pp-missing').hidden = false;
    return;
  }
  $('pp').hidden = false;

  let color = product.colors.find((c) => c.id === params.get('color')) || product.colors[0];
  // Until the customer picks a colour, each ready design is shown (and ordered) on its own
  // colour where this product has it: a design for a black T-shirt (white ink) on the black mug.
  let picked = Boolean(product.colors.find((c) => c.id === params.get('color')));
  const isDark = (hex) => POD.luminance(hex) < 0.45;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dist = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);
  /** The colour a ready design is shown on: the picked one, else the design's own (or the nearest of the same lightness). */
  function colorFor(d) {
    if (picked) return color;
    const same = product.colors.find((c) => c.id === d.color);
    if (same) return same;
    const own = catalog.products.find((p) => p.id === d.product);
    const ownColor = own && own.colors.find((c) => c.id === d.color);
    const hex = ownColor && (own.surface || ownColor.hex);
    if (!hex || product.surface || isDark(hex) === isDark(color.hex)) return color;
    const alike = product.colors.filter((c) => isDark(c.hex) === isDark(hex));
    return alike.length ? alike.reduce((best, c) => (dist(c.hex, hex) < dist(best.hex, hex) ? c : best)) : color;
  }
  let cat = 'all';
  let hasDraft = false;
  try {
    // (Reading window.indexedDB throws when site data is blocked: caught below.)
    const d = POD.drafts && window.indexedDB ? await POD.drafts.get(product.id) : null;
    hasDraft = Boolean(d && d.designs && Object.values(d.designs).some((o) => o && o.length));
  } catch (e) {
    hasDraft = false;
  }

  const pictures = new Map(); // design id + colour -> object URL
  function pictureFor(d) {
    const c = colorFor(d);
    const key = `${d.id}:${c.id}`;
    if (!pictures.has(key)) {
      pictures.set(key, (async () => {
        const st = await POD_RENDER.stage(d, product, product.sides[0], c);
        const cv = await POD_RENDER.productPicture(st, 1.2); // the whole product, framed close round it
        const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.88));
        return URL.createObjectURL(blob);
      })().catch(() => null));
    }
    return pictures.get(key);
  }

  // The lifestyle photo (the product printed with a design, styled): shown first when there is one;
  // the plain product in the chosen colour next to it (public/img/lifestyle/index.json).
  // Also the product printed with a ready design on light grey (public/img/designed/index.json), shown first.
  const loadJson = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      return r.ok ? await r.json() : {};
    } catch (e) {
      return {};
    }
  };
  const [lifeAll, designedAll] = await Promise.all([loadJson('/img/lifestyle/index.json'), loadJson('/img/designed/index.json')]);
  const life = (lifeAll[product.id] && lifeAll[product.id].file) ? lifeAll[product.id] : null;
  const designed = (designedAll[product.id] && designedAll[product.id].file) ? designedAll[product.id] : null;
  let view = params.get('color') ? 'plain' : designed ? 'designed' : life ? 'life' : 'plain';
  const plainUrl = () => `/api/thumbs/${encodeURIComponent(product.id)}/${encodeURIComponent(color.id)}.webp`;
  function renderPicture() {
    const views = [designed && ['designed', designed.file, t('pp.viewDesigned')], life && ['life', life.file, t('pp.viewPrinted')], ['plain', plainUrl(), t('pp.viewPlain')]].filter(Boolean);
    const cur = views.find((v) => v[0] === view) || views[views.length - 1];
    $('pp-img').src = cur[1];
    $('pp-img').alt = cur[0] === 'life' ? tr(life.alt) || tr(product.name) : tr(product.name);
    $('pp-img').classList.toggle('pp-life', cur[0] === 'life');
    $('pp-img').classList.toggle('pp-designed', cur[0] === 'designed');
    $('pp-gallery').hidden = views.length < 2;
    $('pp-gallery').innerHTML = views.length < 2 ? '' : views
      .map(([v, src, label]) => `<button type="button" class="pp-thumb ${v === cur[0] ? 'active' : ''} ${v !== 'plain' ? 'is-life' : ''}" data-view="${v}" aria-pressed="${v === cur[0]}" aria-label="${esc(label)}" title="${esc(label)}"><img src="${esc(src)}" alt=""></button>`).join('');
  }
  $('pp-gallery').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    renderPicture();
  });
  const q = (c = color) => `product=${encodeURIComponent(product.id)}&color=${encodeURIComponent(c.id)}`;
  function renderInfo() {
    document.title = `${tr(product.name)} · ${t('brand')}`;
    $('pp-name').textContent = tr(product.name);
    $('pp-desc').textContent = tr(product.description);
    $('pp-price').textContent = t('home.from', { price: money(product.basePrice) });
    $('pp-sizes').textContent = product.sizes.length > 1 ? t('pp.sizes', { list: product.sizes.map((s) => tr(s.label)).join(' · ') }) : '';
    renderPicture();
    $('pp-color-name').textContent = tr(color.name);
    $('pp-color-label').textContent = product.colorLabel ? `${tr(product.colorLabel)}:` : t('panel.colour');
    $('pp-swatches').innerHTML = product.colors.map((c) => `<button type="button" class="swatch ${c.id === color.id ? 'active' : ''}" data-color="${esc(c.id)}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" style="background:${esc(c.hex)}"></button>`).join('');
    $('pp-scratch').href = `/editor?${q()}`;
    // Embroidery on garments, caps, totes and aprons.
    $('pp-emb').hidden = !product.embroidery;
    if (product.embroidery) {
      $('pp-emb').href = `/editor?${q()}&method=embroidery`;
      $('pp-emb-text').textContent = t('pp.embText', { price: money(product.embroidery.surcharge) });
    }
    $('pp-scratch-title').textContent = t(hasDraft ? 'pp.continue' : 'pp.scratch');
    // Products that print a list of names (variable data).
    $('pp-names').hidden = !product.merge;
    if (product.merge) {
      $('pp-names').href = `/editor?${q()}&names=1`;
      $('pp-names-text').textContent = t(product.id === 'bizcards' || product.id === 'idcards' ? 'pp.namesTextCards' : 'pp.namesText');
    }
  }

  function renderDesigns() {
    // No ready designs for this product (bookmarks, banners...): no "pick a ready design" choice or section.
    const none = !lib.designs.length;
    $('pp-ready').hidden = none;
    document.querySelectorAll('.pp-choice[href="#pp-ready"]').forEach((a) => { a.hidden = none; });
    if (none) return;
    const used = lib.categories.filter((c) => lib.designs.some((d) => d.category === c.id));
    $('pp-cats').innerHTML = [{ id: 'all', name: null }, ...used]
      .map((c) => `<button class="chip ${c.id === cat ? 'active' : ''}" data-cat="${c.id}">${esc(c.name ? tr(c.name) : t('cat.all'))}</button>`).join('');
    const list = lib.designs.filter((d) => cat === 'all' || d.category === cat);
    $('pp-grid').innerHTML = list.map((d) => `
      <div class="card product-card design-card pp-design">
        <a class="thumb" href="/design?id=${encodeURIComponent(d.id)}&${q(colorFor(d))}"><img alt="${esc(tr(d.name))}" data-design="${esc(d.id)}"></a>
        <div class="body">
          <h3 dir="auto">${esc(tr(d.name))}</h3>
          <div class="pp-actions">
            <a class="btn btn-sm btn-primary" href="/design?id=${encodeURIComponent(d.id)}&${q(colorFor(d))}">${esc(t('pp.order'))}</a>
            <a class="btn btn-sm" href="/editor?library=${encodeURIComponent(d.id)}&${q(colorFor(d))}">✏️ ${esc(t('pp.edit'))}</a>
          </div>
        </div>
      </div>`).join('') || `<p class="muted">${esc(t('designs.empty'))}</p>`;
    observe();
  }

  // Draw card pictures as they scroll into view, one at a time.
  let queue = Promise.resolve();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e) => { io.unobserve(e.target); load(e.target); });
  }, { rootMargin: '300px' }) : null;
  let shown = 0; // bumped when the colour changes: pictures still queued for the old one are skipped
  function load(img) {
    const d = lib.designs.find((x) => x.id === img.dataset.design);
    const want = shown;
    queue = queue.then(async () => {
      if (!img.isConnected || want !== shown) return;
      const url = await pictureFor(d);
      if (url && img.isConnected && want === shown) img.src = url;
    });
  }
  function observe() {
    document.querySelectorAll('#pp-grid img[data-design]:not([src])').forEach((img) => (io ? io.observe(img) : load(img)));
  }

  $('pp-swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === color.id) return;
    color = product.colors.find((c) => c.id === b.dataset.color) || color;
    picked = true;
    shown++;
    view = 'plain'; // a colour picked: show the product in that colour
    history.replaceState(null, '', `/product?id=${encodeURIComponent(product.id)}&color=${encodeURIComponent(color.id)}`);
    renderInfo();
    renderDesigns();
  });
  $('pp-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    renderDesigns();
  });
  renderInfo();
  renderDesigns();
  document.addEventListener('pod:langchange', () => { renderInfo(); renderDesigns(); });
})();
