/* Ready-made designs shop: browse by category; each card shows the design on its product. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const [catalog, lib] = await Promise.all([POD.loadCatalog(), POD.api('/api/library')]);
  const products = catalog.products.filter((p) => !p.kind);
  let cat = new URLSearchParams(location.search).get('cat') || 'all';
  if (cat !== 'all' && !lib.categories.some((c) => c.id === cat)) cat = 'all';

  const pictures = new Map(); // design id -> object URL
  async function pictureFor(d) {
    if (d.preview) return d.preview;
    if (!pictures.has(d.id)) {
      pictures.set(d.id, (async () => {
        const product = products.find((p) => p.id === d.product) || products[0];
        const color = product.colors.find((c) => c.id === d.color) || product.colors[0];
        const st = await POD_RENDER.stage(d, product, product.sides[0], color);
        // Square picture around the print area, so the words read clearly on a small card.
        const zoom = ['mug', 'bottle', 'phonecase', 'notebook', 'poster', 'mousepad', 'cushion', 'magicmug', 'couplemugs', 'tumbler', 'coasters', 'tablecloth', 'prayermat', 'eidenvelopes', 'greetingcard', 'plaque', 'sign', 'deskmat', 'keychain', 'stickersheet', 'namelabels', 'lunchbag', 'pencilcase', 'bizcards', 'flyers', 'letterhead', 'dlenvelopes', 'logostickers', 'rollup', 'paperbags', 'invoicebook', 'idcards'].includes(product.id) ? 1.25 : 1.75;
        const cv = POD_RENDER.picture(st, 1.2, zoom);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.88));
        return URL.createObjectURL(blob);
      })().catch(() => null));
    }
    return pictures.get(d.id);
  }

  function render() {
    $('design-cats').innerHTML = [{ id: 'all', name: null }, ...lib.categories]
      .filter((c) => c.id === 'all' || lib.designs.some((d) => d.category === c.id))
      .map((c) => `<button class="chip ${c.id === cat ? 'active' : ''}" data-cat="${c.id}">${esc(c.name ? tr(c.name) : t('cat.all'))}</button>`).join('');
    const list = lib.designs.filter((d) => cat === 'all' || d.category === cat);
    $('design-grid').innerHTML = list.map((d) => {
      const product = products.find((p) => p.id === d.product) || products[0];
      return `<a class="card product-card design-card" href="/design?id=${encodeURIComponent(d.id)}">
        <div class="thumb"><img alt="${esc(tr(d.name))}" data-design="${esc(d.id)}"></div>
        <div class="body">
          <h3 dir="auto">${esc(tr(d.name))}</h3>
          <div class="foot"><span class="price">${esc(t('home.from', { price: money(product.basePrice) }))}</span><span class="muted small">${esc(tr((lib.categories.find((c) => c.id === d.category) || {}).name))}</span></div>
        </div>
      </a>`;
    }).join('') || `<p class="muted">${esc(t('designs.empty'))}</p>`;
    observe();
  }

  // Draw card pictures as they scroll into view, one at a time.
  let queue = Promise.resolve();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e) => { io.unobserve(e.target); load(e.target); });
  }, { rootMargin: '300px' }) : null;
  function load(img) {
    const d = lib.designs.find((x) => x.id === img.dataset.design);
    queue = queue.then(async () => {
      const url = await pictureFor(d);
      if (url) img.src = url;
    });
  }
  function observe() {
    document.querySelectorAll('#design-grid img[data-design]:not([src])').forEach((img) => (io ? io.observe(img) : load(img)));
  }

  $('design-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    history.replaceState(null, '', cat === 'all' ? '/designs' : `/designs?cat=${cat}`);
    render();
  });
  render();
  document.addEventListener('pod:langchange', render);
})();
