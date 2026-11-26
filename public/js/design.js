/* Ready-made design page: pick the product, colour and size, see it on the real
 * photo, and add it to the cart without opening the editor. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // ---------- No connection ----------
  // What the page needs didn't come (no signal, or the site busy): "No connection" and "Try again" in `box`, in the
  // page's language, until it does. A "not found" from the site is not a connection problem: thrown as it is.
  const noConnection = (e) => !(e && e.status) || e.status >= 500;
  async function loadOrRetry(box, load) {
    let last = null;
    for (;;) {
      try {
        const out = await load();
        box.hidden = true;
        box.innerHTML = '';
        return out;
      } catch (e) {
        if (!noConnection(e)) throw e;
        // The same failure again although the site answers now (a product list kept from before): the page again.
        if (e === last) {
          location.reload();
          return new Promise(() => {});
        }
        await tryAgain(box, Boolean(last));
        last = e;
      }
    }
  }
  /** "No connection" with "Try again" in `box`; resolves once it is tapped and the site answers. */
  function tryAgain(box, focus) {
    return new Promise((resolve) => {
      const paint = () => {
        box.innerHTML = `<h2>${esc(t('net.title'))}</h2><p class="muted">${esc(t('net.text'))}</p><button type="button" class="btn btn-primary" data-net-retry>${esc(t('net.retry'))}</button>`;
      };
      let busy = false;
      const click = async (e) => {
        if (busy || !e.target.closest('[data-net-retry]')) return;
        busy = true;
        const back = await fetch('/api/products', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);
        busy = false;
        if (!back) {
          POD.toast(t('net.still'), 'error');
          return;
        }
        box.removeEventListener('click', click);
        document.removeEventListener('pod:langchange', paint);
        box.innerHTML = '<div class="spinner"></div>';
        resolve();
      };
      paint();
      box.setAttribute('role', 'alert');
      box.hidden = false;
      box.addEventListener('click', click);
      document.addEventListener('pod:langchange', paint);
      if (focus) box.querySelector('[data-net-retry]').focus();
    });
  }

  let catalog;
  let design;
  let categories = [];
  try {
    // No design named (/design, /design?id=): "this design isn't available", as for an unknown one (an empty id asked
    // the server for the whole list and showed a blank, orderable T-shirt. QA 26 Nov).
    if (!(params.get('id') || '').trim()) throw new Error('no design');
    [catalog, design, { categories }] = await loadOrRetry($('dp-net'), () => Promise.all([POD.loadCatalog(), POD.api('/api/library/' + encodeURIComponent(params.get('id') || '')), POD.api('/api/library')]));
    if (!design || !design.id || !Array.isArray(design.items)) throw new Error('no design');
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
  // Clothes (two sizes or more): the size the customer picked (a tap, or a link with &size=). Until then no size
  // looks picked ("Pick your size" by the sizes; the picture and the price use the first one meanwhile), and
  // "Add to cart" asks which one (never ordered silently in the first size), as the editor does.
  let pickedSize = null;
  {
    const asked = state.product.sizes.find((s) => s.id === params.get('size') && POD.sizeOk(state.product, state.color.id, s));
    if (asked) {
      state.size = asked;
      pickedSize = asked.id;
    }
  }
  const asksSize = () => state.product.category === 'apparel' && state.product.sizes.length > 1;
  /** The size shown is the customer's: picked by them, or the only choice (not clothes, or one size). */
  const sizeChosen = () => !asksSize() || pickedSize === state.size.id;
  const needsSize = () => !sizeChosen();
  const sizeParam = () => (pickedSize && pickedSize === state.size.id ? `&size=${encodeURIComponent(state.size.id)}` : '');
  // A design with places for the customer's own details ({Name}, {Phone}…) would print those words as they are:
  // they are filled in in the editor (which refuses them too), so it is never added to the cart from here.
  const textsOf = (list) => (list || []).flatMap((o) => (!o || typeof o !== 'object' ? []
    : Array.isArray(o.objects) ? textsOf(o.objects)
      : o.kind === 'text' || /text/i.test(o.type || '') ? [String(o.text || '')] : []));
  const hasFields = textsOf([...(design.items || []), ...(design.objects || [])]).some((s) => /\{\s*[\p{L}\p{N}_][^{}\n]{0,39}\}/u.test(s));

  // ---------- The customer's own name ----------
  // A design showing a sample name ("LAILA", "آدم", "The MAHMOUDS": the texts marked sampleName in the shop's
  // designs) has a box for each one above "Add to cart". What is typed replaces the sample in the picture, in the
  // cart and in the print files (all made from personal()); a box left empty keeps the sample, and Add to cart
  // then asks once (askName) before printing it as it is.
  const D = window.POD_DESIGN;
  const samples = hasFields ? [] : D.sampleNames(design);
  const names = samples.map(() => ''); // what is typed in each box
  let keepSamples = false; // "Order it with LAILA" chosen (until a name is typed)
  /** The design as it will be printed: with the customer's names. */
  const personal = () => D.withNames(design, names);
  const typed = (s, k) => D.cleanName(names[k], s.max);
  /** A name longer than its place: only its first whole words are printed (D.cleanName); said under the boxes. */
  const cutShort = () => samples.some((s, k) => typed(s, k) !== D.cleanName(names[k], Infinity));
  /** The sample names nobody replaced (their box left empty). */
  const unchanged = () => samples.filter((s, k) => !typed(s, k));
  const namesKey = () => samples.map(typed).join('\n');
  /** The names for the editor's link (in the order of the samples; empty keeps one). */
  const nameParams = () => (samples.some(typed) ? samples.map((s, k) => `&name=${encodeURIComponent(typed(s, k))}`).join('') : '');
  /** A box's label: the kind of name; two of a kind by language (Arabic / English), else numbered. */
  function nameLabel(s) {
    const label = t(`design.name.${s.role}`);
    const twins = samples.filter((x) => x.role === s.role);
    if (twins.length < 2) return label;
    const ar = (x) => D.ARABIC_RE.test(x.sample);
    if (twins.length === 2 && ar(twins[0]) !== ar(twins[1])) return t(ar(s) ? 'design.name.inArabic' : 'design.name.inEnglish', { label });
    return t('design.name.nth', { label, n: twins.indexOf(s) + 1 });
  }
  /** An empty box shows its sample the way it reads; once typed in, the box follows what is typed. */
  const boxDir = (input, s) => { input.dir = input.value.trim() ? 'auto' : D.ARABIC_RE.test(s.sample) ? 'rtl' : 'ltr'; };
  function renderNames() {
    const box = $('dp-names');
    box.hidden = !samples.length;
    if (!samples.length) return;
    if (!box.firstChild) {
      box.innerHTML = samples.map((s, k) => `<div class="field"><label for="dp-name-${k}"></label>`
        // (The box takes more than fits, so a long name is never cut inside a word: cleanName keeps whole words.)
        + `<input type="text" id="dp-name-${k}" data-name="${k}" maxlength="${s.max + 30}" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" aria-describedby="dp-names-hint"${s.caps ? ' class="dp-caps"' : ''}></div>`).join('')
        // (Phones: the big picture is above, out of sight while typing; a small copy of the design here.)
        + '<img class="dp-names-peek" id="dp-names-peek" alt="" aria-hidden="true"><p class="muted small" id="dp-names-hint"></p>'
        + '<p class="small dp-names-long" id="dp-names-long" role="status" hidden></p>'
        + '<p class="small dp-names-long" id="dp-names-cut" role="status" hidden></p>';
    }
    samples.forEach((s, k) => {
      const input = $(`dp-name-${k}`);
      input.previousElementSibling.textContent = nameLabel(s);
      input.placeholder = s.sample;
      boxDir(input, s);
    });
    $('dp-names-hint').textContent = t('design.name.hint');
    $('dp-names-long').textContent = t('design.name.long');
    $('dp-names-cut').textContent = t('design.name.cut');
    $('dp-names-cut').hidden = !cutShort();
  }
  let nameTimer = null;
  let drawnNames = null; // the names in the picture now
  $('dp-names').addEventListener('input', (e) => {
    const k = Number(e.target.dataset.name);
    if (!samples[k]) return;
    names[k] = e.target.value;
    keepSamples = false;
    boxDir(e.target, samples[k]);
    $('dp-names-cut').hidden = !cutShort();
    $('dp-edit').href = editHref();
    // The picture follows once typing pauses.
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      if (namesKey() !== drawnNames) draw();
    }, 350);
  });

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
    drawnNames = namesKey();
    try {
      const st = await POD_RENDER.stage(personal(), product, side, color, size.id);
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
      if (samples.length) {
        // A name much longer than the sample is set smaller to fit its place (public/js/templates.js, fitName): said under the box.
        $('dp-names-long').hidden = !st.objects.some((o) => o.nameScale && o.nameScale < 0.7);
        const peek = await new Promise((r) => POD_RENDER.picture(st, 1.5, 1.08).toBlob(r, 'image/webp', 0.9));
        if (my !== token) return;
        const was = $('dp-names-peek').src;
        $('dp-names-peek').src = URL.createObjectURL(peek);
        if (was.startsWith('blob:')) URL.revokeObjectURL(was);
      }
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
    // Clothes: no size marked until the customer picks one.
    const chosen = sizeChosen();
    $('dp-sizes').innerHTML = product.sizes.map((s) => {
      if (POD.sizeOk(product, color.id, s)) {
        const on = chosen && s.id === size.id;
        return `<button type="button" class="chip ${on ? 'active' : ''}" data-size="${esc(s.id)}" aria-pressed="${on}">${esc(tr(s.label))}${POD.sizeNote(product, s) ? ` <span style="opacity:.7">${esc(POD.sizeNote(product, s))}</span>` : ''}</button>`;
      }
      const why = s.soldOut ? t('soldOut') : t('soldOutCombo', { colour: tr(color.name), size: tr(s.label) });
      return `<button type="button" class="chip sold-out" aria-disabled="true" data-sold-size="${esc(s.id)}" title="${esc(why)}" aria-label="${esc(why)}"><span class="sold-label">${esc(tr(s.label))}</span> <span class="sold-tag">${esc(t('soldOut'))}</span></button>`;
    }).join('');
    $('dp-size-hint').hidden = chosen;
    // "Only n left": of the chosen colour in the chosen size (once a size is picked), else of the whole product.
    const few = (chosen && POD.comboFew(product, color.id, size.id)) || product.fewLeft || 0;
    $('dp-few').hidden = !few;
    $('dp-few').textContent = few ? t('pp.fewLeft', { n: POD.num(few) }) : '';
    $('dp-price').textContent = money(product.basePrice + size.surcharge);
    $('dp-edit').href = editHref();
    // A design that is one picture (no words to change): "Make it yours in the editor".
    const hasWords = (design.items || []).some((i) => i.kind === 'text') || (design.objects || []).some((o) => /text/i.test(o.type || ''));
    // Places for the customer's details: no "Add to cart"; the way to the editor is the main button.
    $('dp-add').hidden = hasFields;
    $('dp-fill').hidden = !hasFields;
    $('dp-edit').classList.toggle('btn-primary', hasFields);
    $('dp-edit').classList.toggle('btn-lg', hasFields);
    $('dp-edit').dataset.i18n = hasFields ? 'design.fillIn' : hasWords ? 'design.customize' : 'design.customizePic';
    $('dp-edit').textContent = t($('dp-edit').dataset.i18n);
    document.title = `${tr(design.name)} · ${t('brand')}`;
    const active = $('dp-products').querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  /** The editor, on this product, colour and size, with the names typed here. */
  function editHref() {
    return `/editor?library=${encodeURIComponent(design.id)}&product=${state.product.id}&color=${state.color.id}${sizeParam()}${nameParams()}`;
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
    history.replaceState(null, '', `/design?id=${encodeURIComponent(design.id)}&product=${state.product.id}&color=${state.color.id}${sizeParam()}`);
  }

  $('dp-products').addEventListener('click', (e) => {
    const b = e.target.closest('[data-product]');
    if (!b || b.dataset.product === state.product.id) return;
    choose(b.dataset.product, state.color.id);
    // The size the customer picked stays picked on another product that has it (left in this colour).
    const again = pickedSize && state.product.sizes.find((s) => s.id === pickedSize && POD.sizeOk(state.product, state.color.id, s));
    if (again) state.size = again;
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
    // When the size shown is sold out in this colour: clothes, the customer's size is un-picked ("pick another"), or,
    // with none picked yet, the first one left is used without a word; other products: the next size, said.
    const hadPicked = Boolean(moved) && pickedSize === moved.id;
    if (hadPicked && asksSize()) pickedSize = null;
    renderOptions();
    if (moved && asksSize()) {
      if (hadPicked) POD.toast(t('sizeSoldOutPick', { size: tr(moved.label) }));
    } else if (moved) POD.toast(t('sizeMovedTo', { size: tr(moved.label), to: tr(state.size.label) }));
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
    // (Tapping the size already shown picks it too.)
    pickedSize = b.dataset.size;
    if (b.dataset.size === state.size.id) {
      renderOptions();
      syncUrl();
      return;
    }
    state.size = state.product.sizes.find((s) => s.id === b.dataset.size);
    renderOptions();
    syncUrl();
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
  // ---------- Clothes: "Which size?" before adding (the editor's question, in its words) ----------
  function askSize() {
    const box = $('size-ask');
    $('size-ask-chips').innerHTML = state.product.sizes.filter((s) => POD.sizeOk(state.product, state.color.id, s))
      .map((s) => `<button type="button" class="chip" data-ask-size="${esc(s.id)}">${esc(tr(s.label))}${POD.sizeNote(state.product, s) ? ` <span style="opacity:.7">${esc(POD.sizeNote(state.product, s))}</span>` : ''}</button>`).join('');
    box.hidden = false;
    const first = box.querySelector('[data-ask-size]');
    if (first) first.focus();
  }
  function closeAsk() {
    $('size-ask').hidden = true;
    $('dp-add').focus();
  }
  $('size-ask').addEventListener('click', (e) => {
    if (e.target.id === 'size-ask' || e.target.closest('#size-ask-cancel')) {
      closeAsk();
      return;
    }
    const b = e.target.closest('[data-ask-size]');
    const size = b && state.product.sizes.find((s) => s.id === b.dataset.askSize);
    if (!size) return;
    $('size-ask').hidden = true;
    const changed = size.id !== state.size.id;
    state.size = size;
    pickedSize = size.id;
    renderOptions();
    syncUrl();
    if (changed) draw();
    addOrAsk();
  });

  // ---------- A sample name left as it is: "Put your own name?" (after the size, never with it) ----------
  /** “LAILA”, or “Ahmed” and “Sara”: the samples as the sentence quotes them. */
  function sampleList(list) {
    const ar = POD.lang === 'ar';
    const quoted = list.map((s) => (ar ? `«\u2068${s.sample}\u2069»` : `“\u2068${s.sample}\u2069”`));
    try {
      return new Intl.ListFormat(ar ? 'ar' : 'en', { type: 'conjunction' }).format(quoted);
    } catch (e) {
      return quoted.join(ar ? ' و' : ' & ');
    }
  }
  function askName() {
    const list = sampleList(unchanged());
    $('name-ask-note').textContent = t('design.nameAsk.text', { name: list });
    $('name-ask-keep').textContent = t('design.nameAsk.keep', { name: list });
    $('name-ask').hidden = false;
    $('name-ask-write').focus();
  }
  function closeNameAsk(focus = $('dp-add')) {
    $('name-ask').hidden = true;
    focus.focus();
  }
  $('name-ask').addEventListener('click', (e) => {
    if (e.target.id === 'name-ask') {
      closeNameAsk();
      return;
    }
    if (e.target.closest('#name-ask-write')) {
      // To the first box still showing its sample.
      const first = unchanged()[0];
      closeNameAsk($(`dp-name-${Math.max(0, samples.indexOf(first))}`));
      return;
    }
    if (e.target.closest('#name-ask-keep')) {
      keepSamples = true;
      closeNameAsk();
      addToCart();
    }
  });
  // (The keyboard stays in the question while it is open.)
  $('name-ask').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...$('name-ask').querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement);
    e.preventDefault();
    buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  });
  /** Add to the cart, or first ask about a sample name nobody replaced. */
  function addOrAsk() {
    if (unchanged().length && !keepSamples) {
      askName();
      return;
    }
    addToCart();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('size-ask').hidden) closeAsk();
    if (!$('name-ask').hidden) closeNameAsk();
  });

  $('dp-add').addEventListener('click', () => {
    if (hasFields) return;
    if (needsSize()) {
      askSize();
      return;
    }
    addOrAsk();
  });
  async function addToCart() {
    const btn = $('dp-add');
    if (btn.disabled || hasFields) return;
    btn.disabled = true;
    busy(true, t('busy.preparing'));
    try {
      await POD_RENDER.addToCart({
        design: personal(), product: state.product, color: state.color, size: state.size,
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
  }

  /** The shop's catalogue changed under the page: open it again on what can be ordered now. */
  function refreshCatalog() {
    setTimeout(() => location.reload(), 2500);
  }

  renderOptions();
  renderNames();
  draw();
  document.addEventListener('pod:langchange', () => {
    renderOptions();
    renderNames();
  });
})();
