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
  /** Not in the shop (hidden, removed, out of stock, or an old link): say so and offer the catalogue. */
  function unavailable() {
    $('pp-missing').hidden = false;
    $('pp-missing').classList.add('unavail');
    $('pp-missing').innerHTML = `<div class="unavail-ico" aria-hidden="true">🛍️</div>
      <h2>${esc(t('unavail.title'))}</h2>
      <p class="muted">${esc(t('unavail.text'))}</p>
      <div class="unavail-actions"><a class="btn btn-primary" href="/#products">${esc(t('unavail.browse'))}</a><a class="btn" href="/designs">${esc(t('unavail.designs'))}</a></div>`;
    document.title = `${t('unavail.title')} · ${t('brand')}`;
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
    unavailable();
    document.addEventListener('pod:langchange', unavailable);
    return;
  }
  $('pp').hidden = false;

  // Sold-out colours are shown (crossed out) but can't be picked.
  // (With stock per colour and size, a colour with nothing left in any size counts as sold out.)
  const colorOk = (c) => POD.colorOk(product, c);
  let color = product.colors.find((c) => c.id === params.get('color') && colorOk(c)) || product.colors.find(colorOk) || POD.firstPick(product.colors);
  // Until the customer picks a colour, each ready design is shown (and ordered) on its own
  // colour where this product has it: a design for a black T-shirt (white ink) on the black mug.
  let picked = Boolean(product.colors.find((c) => c.id === params.get('color') && colorOk(c)));
  const isDark = (hex) => POD.luminance(hex) < 0.45;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dist = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);
  /** The colour a ready design is shown on: the picked one, else the design's own (or the nearest of the same lightness). */
  function colorFor(d) {
    if (picked) return color;
    const same = product.colors.find((c) => c.id === d.color && colorOk(c));
    if (same) return same;
    const own = catalog.products.find((p) => p.id === d.product);
    const ownColor = own && own.colors.find((c) => c.id === d.color);
    const hex = ownColor && (own.surface || ownColor.hex);
    if (!hex || product.surface || isDark(hex) === isDark(color.hex)) return color;
    const alike = product.colors.filter((c) => colorOk(c) && isDark(c.hex) === isDark(hex));
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
  // (Products the manager made from another one use that one's pictures.)
  const aid = POD.assetId(product);
  const life = (lifeAll[aid] && lifeAll[aid].file) ? lifeAll[aid] : null;
  const designed = (designedAll[aid] && designedAll[aid].file) ? designedAll[aid] : null;
  // The manager's own photos (admin → Products) come first, the chosen main one leading.
  const photos = (product.photos || []).filter((ph) => ph && ph.url);
  photos.sort((a, b) => (b.url === product.mainPhoto) - (a.url === product.mainPhoto));
  let view = params.get('color') ? 'plain' : photos.length ? 'photo0' : designed ? 'designed' : life ? 'life' : 'plain';
  const plainUrl = () => `/api/thumbs/${encodeURIComponent(product.id)}/${encodeURIComponent(color.id)}.webp`;
  // The real photo can't be made (a colour only this product has): the drawn product instead.
  $('pp-img').addEventListener('error', () => {
    const img = $('pp-img');
    if (img.dataset.fallback === img.src) return;
    const fb = POD.thumbFallback(product, color);
    if (fb && img.src !== fb) { img.dataset.fallback = fb; img.src = fb; }
  });
  function renderPicture() {
    const views = [
      ...photos.map((ph, i) => [`photo${i}`, ph.url, tr(ph.alt) || tr(product.name)]),
      designed && ['designed', designed.file, t('pp.viewDesigned')], life && ['life', life.file, t('pp.viewPrinted')], ['plain', plainUrl(), t('pp.viewPlain')],
    ].filter(Boolean);
    const cur = views.find((v) => v[0] === view) || views[views.length - 1];
    $('pp-img').src = cur[1];
    $('pp-img').alt = cur[0] === 'life' ? tr(life.alt) || tr(product.name) : tr(product.name);
    $('pp-img').classList.toggle('pp-life', cur[0] === 'life');
    $('pp-img').classList.toggle('pp-designed', cur[0] === 'designed');
    $('pp-img').classList.toggle('pp-own-photo', cur[0].startsWith('photo'));
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
    // Sizes: sold-out ones crossed out (sold out in every colour, or in the chosen one when stock is
    // counted per colour and size), and "only n left" next to the ones nearly gone in the chosen colour.
    // (Each size its own box, so a label in one language and the tag in the other keep their order.)
    const sizeText = (s) => {
      if (!POD.sizeOk(product, color.id, s)) {
        const why = s.soldOut ? t('soldOut') : t('soldOutCombo', { colour: tr(color.name), size: tr(s.label) });
        return `<span class="pp-size is-sold" title="${esc(why)}"><s>${esc(tr(s.label))}</s> <span class="sold-tag">${esc(t('soldOut'))}</span></span>`;
      }
      const few = POD.comboFew(product, color.id, s.id);
      return few
        ? `<span class="pp-size is-few" title="${esc(t('fewLeftCombo', { colour: tr(color.name), size: tr(s.label), n: POD.num(few) }))}">${esc(tr(s.label))} <span class="few-tag">${esc(t('pp.fewLeft', { n: POD.num(few) }))}</span></span>`
        : `<span class="pp-size">${esc(tr(s.label))}</span>`;
    };
    const sizeList = product.sizes.map(sizeText).join(' · ');
    const lone = product.sizes.length === 1 && (!POD.sizeOk(product, color.id, product.sizes[0]) || POD.comboFew(product, color.id, product.sizes[0].id));
    $('pp-sizes').innerHTML = product.sizes.length > 1 ? esc(t('pp.sizes', { list: '\u0000' })).replace('\u0000', sizeList)
      : lone ? sizeList : '';
    // A few pieces left (stock counted by the shop).
    $('pp-few').hidden = !product.fewLeft;
    $('pp-few').textContent = product.fewLeft ? t('pp.fewLeft', { n: POD.num(product.fewLeft) }) : '';
    renderPicture();
    $('pp-color-name').textContent = tr(color.name);
    $('pp-color-label').textContent = product.colorLabel ? `${tr(product.colorLabel)}:` : t('panel.colour');
    $('pp-swatches').innerHTML = product.colors.map((c) => (!colorOk(c)
      ? `<button type="button" class="swatch sold-out" aria-disabled="true" data-sold="${esc(c.id)}" title="${esc(t('soldOutColor', { name: tr(c.name) }))}" aria-label="${esc(t('soldOutColor', { name: tr(c.name) }))}" style="background:${esc(c.hex)}"></button>`
      : `<button type="button" class="swatch ${c.id === color.id ? 'active' : ''}" data-color="${esc(c.id)}" title="${esc(tr(c.name))}" aria-label="${esc(tr(c.name))}" style="background:${esc(c.hex)}"></button>`)).join('');
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
      $('pp-names-text').textContent = t(aid === 'bizcards' || aid === 'idcards' ? 'pp.namesTextCards' : 'pp.namesText');
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
    const sold = e.target.closest('[data-sold]');
    if (sold) {
      POD.toast(t('soldOutColor', { name: tr((product.colors.find((c) => c.id === sold.dataset.sold) || {}).name) }));
      return;
    }
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
