/* Ready-made designs shop: search, pick a category and a product; each card shows the design on its product. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const [catalog, lib] = await Promise.all([POD.loadCatalog(), POD.api('/api/library')]);
  const products = catalog.products.filter((p) => !p.kind);
  const productById = (id) => products.find((p) => p.id === id);

  // ---------- Which designs fit which product ----------
  // The shop sends each design's products (its subject, the print area's shape
  // and name fields decide them: src/library.js); the product page and the
  // editor use the same check, so all three show the same designs.
  const fitting = new Map(); // product id -> Set of design ids
  for (const p of products) {
    const ids = new Set(lib.designs.filter((d) => POD.designFor(d, p)).map((d) => d.id));
    if (ids.size) fitting.set(p.id, ids);
  }
  // Designs whose products the shop doesn't sell right now (admin → Products) are left out.
  lib.designs = lib.designs.filter((d) => products.some((p) => fitting.has(p.id) && fitting.get(p.id).has(d.id)));
  /** The first product (in catalogue order) a design is shown on. */
  const firstFor = (d) => products.find((p) => fitting.has(p.id) && fitting.get(p.id).has(d.id));

  // ---------- Search ----------
  // search-kit:start (the same lines are in public/index.html and public/js/designs.js; test/search-kit.test.js checks both)
  // Forgiving search: what the typed words find, plus plurals (hoodies, تيشيرتات), one word or two (t-shirt, tshirt),
  // both spellings of تيشيرت, and the shop's words for the same thing in either language (mug, مج, كوباية).
  const SEARCH = (() => {
    // Ignore case, Arabic short vowels and tatweel (U+064B-U+065F stops before the Arabic-Indic digits U+0660-U+0669),
    // the alef / yaa / taa marbuta spellings, and Arabic-Indic / Persian digits (100 typed in Arabic digits finds 100).
    const norm = (s) => String(s || '').toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    // Spelt with or without the long ي (تيشرت / تيشيرت).
    const loose = (s) => s.replace(/ي/g, '').replace(/ +/g, ' ');
    // The same thing said other ways, in both languages (two words keep their space; plurals are found anyway).
    const SAME = {
      tshirt: 'tshirt, t shirt, tee, tee shirt, shirt, تيشيرت, تي شيرت, تشيرت',
      hoodie: 'hoodie, hoody, هودي',
      sweatshirt: 'sweatshirt, sweat shirt, سويتشيرت, سويت شيرت',
      cap: 'cap, hat, كاب, كاسكيت, قبعة, طاقية',
      mug: 'mug, cup, مج, مجات, مجين, ماج, كوب, كوباية',
      bag: 'bag, شنطة, شنط',
      card: 'card, كارت, كروت, كارد, بطاقة',
      bizcard: 'business card, visit card, visiting card, بيزنس كارد, كارت بيزنس, كارت شخصي, كروت شخصية, كارت فيزيت',
      invitation: 'invitation, invite, دعوة',
      wedding: 'wedding, فرح, أفراح, زفاف',
      poster: 'poster, بوستر',
      notebook: 'notebook, note book, كشكول, كشاكيل',
      calendar: 'calendar, نتيجة, تقويم, نتايج',
      sticker: 'sticker, ستيكر, استيكر',
      pillow: 'pillow, cushion, مخدة, خدادية, وسادة',
      phonecase: 'phone case, phone cover, mobile case, mobile cover, جراب, جراب موبايل, كفر موبايل',
      christmas: 'christmas, xmas, كريسماس',
      birthday: 'birthday, عيد ميلاد',
      dog: 'dog, puppy, كلب, كلاب',
      cat: 'cat, kitten, قطة, قطط',
    };
    const sameAs = new Map();
    for (const [k, list] of Object.entries(SAME)) for (const w of list.split(',')) sameAs.set(norm(w), k);
    /** A word and what else it may be written as: the singular of a plural (hoodies, boxes, puppies, wolves,
        تيشيرتات, مدرسين, ستيكرز) and a word without its taa marbuta (شنطة → شنط finds شنط ورق). */
    function forms(w) {
      const out = [w];
      if (/^[a-z]+$/.test(w) && w.length > 3) {
        if (w.length > 4 && w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
        if (w.length > 4 && w.endsWith('ves')) out.push(w.slice(0, -3) + 'f', w.slice(0, -3) + 'fe');
        if (/(s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
        if (/[^siu]s$/.test(w)) out.push(w.slice(0, -1));
      } else if (/^[\u0621-\u064A]+$/.test(w)) {
        if (w.endsWith('ات') && w.length >= 5) out.push(w.slice(0, -2), w.slice(0, -2) + 'ه');
        if ((w.endsWith('ين') || w.endsWith('ون')) && w.length >= 6) out.push(w.slice(0, -2));
        if (w.endsWith('ز') && w.length >= 5) out.push(w.slice(0, -1));
        if (w.endsWith('ه') && w.length >= 4) out.push(w.slice(0, -1));
      }
      return [...new Set(out)];
    }
    // The word without "the" / "for the" / "with the" in front (التيشيرتات, للأفراح), when 3 letters or more are left.
    const bare = (w) => { const m = /^(?:وال|بال|لل|ال)(.{3,})$/.exec(w); return m ? [w, m[1]] : [w]; };
    const allForms = (w) => [...new Set(bare(w).flatMap(forms))];
    const conceptsOf = (w) => [...new Set(allForms(w).map((f) => sameAs.get(f)).filter(Boolean))];
    /** Two words that name one thing: "t shirt", "business cards", "بيزنس كارد". */
    function pairConcepts(a, b) {
      const out = new Set();
      for (const x of allForms(a)) {
        for (const y of forms(b)) {
          for (const k of [`${x} ${y}`, x + y]) if (sameAs.has(k)) out.add(sameAs.get(k));
        }
      }
      return [...out];
    }
    /** A text to search in: its words (as before), the other forms of its words, and the things they name.
        looseAnywhere: a typed word without its ي is looked for anywhere, however short (as the home page always
        did); otherwise at the start of a word and with three letters or more, so تيشرت finds تيشيرت but رسم does
        not find كريسماس (كرسماس) and في does not find every ف. */
    function index(text, looseAnywhere) {
      const ws = norm(text).split(' ').filter(Boolean);
      const extra = new Set();
      const concepts = new Set();
      ws.forEach((w, i) => {
        for (const f of allForms(w)) if (f !== w) extra.add(f);
        for (const c of conceptsOf(w)) concepts.add(c);
        if (i + 1 < ws.length) for (const c of pairConcepts(w, ws[i + 1])) concepts.add(c);
      });
      const all = ` ${ws.join(' ')} ${[...extra].join(' ')} `;
      return { text: all, loose: loose(all), concepts, looseAnywhere: Boolean(looseAnywhere) };
    }
    /** The words of a search: each as typed, its other forms and what it names; two words that name one thing
        ("t shirts", "بيزنس كارد") also count as one. */
    function query(q) {
      const ws = norm(q).split(' ').filter(Boolean);
      const one = (w) => ({ word: w, forms: allForms(w).filter((f) => f !== w), concepts: conceptsOf(w) });
      const terms = [];
      for (let i = 0; i < ws.length; i++) {
        const both = i + 1 < ws.length ? pairConcepts(ws[i], ws[i + 1]) : [];
        if (both.length) {
          terms.push({ word: '', forms: forms(ws[i] + ws[i + 1]), concepts: both, or: [one(ws[i]), one(ws[i + 1])] });
          i++;
        } else terms.push(one(ws[i]));
      }
      return terms;
    }
    // A word as typed is found anywhere in a word, as before (with start: at the start of one, to rank names).
    // Its other forms only as whole words ("dogs" → dog, not dogma; "cars" → car, not card), or by what it names.
    function has(h, term, start) {
      const at = start ? ' ' : '';
      const lw = loose(term.word);
      const looseHit = h.looseAnywhere ? h.loose.includes(at + lw) : lw.length > 2 && h.loose.includes(` ${lw}`);
      if (term.word && (h.text.includes(at + term.word) || looseHit)) return true;
      if (term.forms.some((f) => h.text.includes(` ${f} `) || h.loose.includes(` ${loose(f)} `))) return true;
      return term.concepts.some((c) => h.concepts.has(c)) || Boolean(term.or && term.or.every((x) => has(h, x, start)));
    }
    /** Every word of the search is in the indexed text. */
    const match = (h, terms, start) => terms.every((term) => has(h, term, start));
    return { norm, loose, forms, index, query, match };
  })();
  // search-kit:end
  const both = (v) => (v && typeof v === 'object' ? [v.en, v.ar] : [v]);
  const catById = new Map(lib.categories.map((c) => [c.id, c]));
  const haystack = new Map(lib.designs.map((d) => {
    const words = [
      ...both(d.name),
      ...both((catById.get(d.category) || {}).name),
      ...(Array.isArray(d.tags) ? d.tags : d.tags && typeof d.tags === 'object' ? [...(d.tags.en || []), ...(d.tags.ar || [])] : []),
      // The words printed on the design (not the {Name} fields filled from a list).
      ...(d.items || []).filter((i) => i.kind === 'text').map((i) => String(i.text || '').replace(/\{[^{}]*\}/g, ' ')),
    ];
    return [d.id, SEARCH.index(words.join(' '))];
  }));
  const matches = (d, terms) => SEARCH.match(haystack.get(d.id), terms);

  // ---------- State (kept in the address, so Back returns to the same list) ----------
  const params = new URLSearchParams(location.search);
  const state = {
    cat: params.get('cat') || 'all',
    q: (params.get('q') || '').slice(0, 60),
    product: params.get('product') || '',
  };
  if (state.cat !== 'all' && !lib.categories.some((c) => c.id === state.cat)) state.cat = 'all';
  if (state.product && !fitting.has(state.product)) state.product = '';
  function saveUrl() {
    const u = new URLSearchParams();
    if (state.cat !== 'all') u.set('cat', state.cat);
    if (state.product) u.set('product', state.product);
    if (state.q.trim()) u.set('q', state.q.trim());
    const s = u.toString();
    history.replaceState(history.state, '', s ? `/designs?${s}` : '/designs');
  }

  // ---------- Pictures ----------
  const shownOn = (d) => productById(state.product) || (fitting.has(d.product) && fitting.get(d.product).has(d.id) && productById(d.product)) || firstFor(d) || products[0];
  const pictures = new Map(); // design id + product id -> promise of an image URL
  const ready = new Map(); // the same, once drawn
  function pictureFor(d, product) {
    const key = `${d.id}:${product.id}`;
    if (d.preview && product.id === d.product) return Promise.resolve(d.preview);
    if (!pictures.has(key)) {
      pictures.set(key, (async () => {
        // Designs the owner added keep their objects on the server: fetch them to place on another product.
        const full = d.kind === 'objects' ? await POD.api('/api/library/' + encodeURIComponent(d.id)) : d;
        const color = product.colors.find((c) => c.id === d.color && POD.canPick(c)) || POD.firstPick(product.colors);
        const st = await POD_RENDER.stage(full, product, product.sides[0], color);
        // The whole product with the design, framed close round the product.
        const cv = await POD_RENDER.productPicture(st, 1.2);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.88));
        const url = URL.createObjectURL(blob);
        ready.set(key, url);
        return url;
      })().catch(() => null));
    }
    return pictures.get(key);
  }

  // ---------- Page ----------
  function countText(n) {
    const key = n === 1 ? 'one' : n === 2 ? 'two' : POD.lang === 'ar' && n % 100 >= 3 && n % 100 <= 10 ? 'few' : 'many';
    return t(`designs.count.${key}`, { n: POD.num(n) });
  }
  function renderProducts() {
    const sel = $('design-product');
    const groups = catalog.categories
      .map((c) => ({ c, list: products.filter((p) => p.category === c.id && fitting.has(p.id)) }))
      .filter((g) => g.list.length);
    sel.innerHTML = `<option value="">${esc(t('designs.allProducts'))}</option>` + groups.map((g) => `<optgroup label="${esc(tr(g.c.name))}">${g.list.map((p) => `<option value="${esc(p.id)}">${esc(tr(p.name))}</option>`).join('')}</optgroup>`).join('');
    sel.value = state.product;
  }

  function render() {
    const terms = SEARCH.query(state.q);
    const okProduct = state.product ? fitting.get(state.product) : null;
    const forProduct = lib.designs.filter((d) => !okProduct || okProduct.has(d.id));
    // Category chips: the ones with designs for the chosen product.
    const cats = lib.categories.filter((c) => forProduct.some((d) => d.category === c.id));
    if (state.cat !== 'all' && !cats.some((c) => c.id === state.cat)) state.cat = 'all';
    $('design-cats').innerHTML = [{ id: 'all', name: null }, ...cats]
      .map((c) => `<button type="button" class="chip ${c.id === state.cat ? 'active' : ''}" data-cat="${c.id}" aria-pressed="${c.id === state.cat}">${esc(c.name ? tr(c.name) : t('cat.all'))}</button>`).join('');
    let list = forProduct.filter((d) => (state.cat === 'all' || d.category === state.cat) && (!terms.length || matches(d, terms)));
    // Designs made for the chosen product come first.
    if (state.product) list = [...list.filter((d) => d.product === state.product), ...list.filter((d) => d.product !== state.product)];

    const product = productById(state.product);
    // (No count over the empty state: it says so itself.)
    $('design-count').textContent = !list.length ? '' : product ? t('designs.countOn', { count: countText(list.length), product: tr(product.name) }) : countText(list.length);
    const extra = state.product ? `&product=${encodeURIComponent(state.product)}` : '';
    $('design-grid').innerHTML = list.map((d) => {
      const on = shownOn(d);
      const src = d.preview && on.id === d.product ? d.preview : ready.get(`${d.id}:${on.id}`);
      return `<a class="card product-card design-card" href="/design?id=${encodeURIComponent(d.id)}${extra}">
        <div class="thumb"><img alt="${esc(tr(d.name))}" data-design="${esc(d.id)}"${src ? ` src="${esc(src)}"` : ''}></div>
        <div class="body">
          <h3 dir="auto">${esc(tr(d.name))}</h3>
          <div class="foot"><span class="price">${esc(t('home.from', { price: money(POD.fromPrice(on)) }))}</span><span class="muted small">${esc(tr((catById.get(d.category) || {}).name))}</span></div>
        </div>
      </a>`;
    }).join('') || emptyState(terms);
    observe();
  }

  function emptyState(terms) {
    const btns = [];
    if (state.q.trim()) btns.push(`<button type="button" class="btn btn-primary" data-clear="q">${esc(t('designs.clearSearch'))}</button>`);
    if (state.cat !== 'all') btns.push(`<button type="button" class="btn" data-clear="cat">${esc(t('designs.allCats'))}</button>`);
    if (state.product) btns.push(`<button type="button" class="btn" data-clear="product">${esc(t('designs.anyProduct'))}</button>`);
    // Typed a product name ("mug", "تيشيرت")? Offer the designs on that product.
    const named = terms.length ? products.filter((p) => fitting.has(p.id) && p.id !== state.product && SEARCH.match(SEARCH.index(`${p.name.en} ${p.name.ar}`), terms)).slice(0, 6) : [];
    return `<div class="card empty design-empty">
      <h2>${esc(state.q.trim() ? t('designs.noMatch', { q: state.q.trim() }) : t('designs.noMatchFilters'))}</h2>
      <p class="muted">${esc(t('designs.noMatchHint'))}</p>
      <div class="design-empty-actions">${btns.join('')}</div>
      ${named.length ? `<p class="design-empty-products"><span class="muted small">${esc(t('designs.productHint'))}</span> ${named.map((p) => `<button type="button" class="chip" data-show-product="${esc(p.id)}">${esc(tr(p.name))}</button>`).join(' ')}</p>` : ''}
    </div>`;
  }

  // Draw card pictures as they scroll into view, one at a time.
  let queue = Promise.resolve();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e) => { io.unobserve(e.target); load(e.target); });
  }, { rootMargin: '300px' }) : null;
  function load(img) {
    const d = lib.designs.find((x) => x.id === img.dataset.design);
    queue = queue.then(async () => {
      if (!img.isConnected) return; // the list changed before its turn
      const url = await pictureFor(d, shownOn(d));
      if (url && img.isConnected) img.src = url;
    });
  }
  function observe() {
    if (io) io.disconnect();
    document.querySelectorAll('#design-grid img[data-design]:not([src])').forEach((img) => (io ? io.observe(img) : load(img)));
  }

  // Keep the chosen chip in view when the chips scroll in one row (phones).
  function showActiveChip() {
    const box = $('design-cats');
    const chip = box.querySelector('.chip.active');
    if (!chip || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    if (c.left < b.left || c.right > b.right) box.scrollBy({ left: c.left + c.width / 2 - (b.left + b.width / 2) });
  }

  function update() {
    saveUrl();
    render();
  }

  // ---------- Events ----------
  const qInput = $('design-q');
  qInput.value = state.q;
  let typing = null;
  qInput.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = qInput.value.slice(0, 60);
      update();
    }, 250);
  });
  $('design-tools').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(typing);
    state.q = qInput.value.slice(0, 60);
    update();
    qInput.blur(); // closes the phone keyboard so the results show
  });
  $('design-product').addEventListener('change', (e) => {
    state.product = e.target.value;
    update();
  });
  $('design-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.cat = b.dataset.cat;
    update();
    showActiveChip();
  });
  $('design-grid').addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    const show = e.target.closest('[data-show-product]');
    if (!clear && !show) return;
    if (show) {
      state.product = show.dataset.showProduct;
      state.q = '';
    } else if (clear.dataset.clear === 'q') state.q = '';
    else if (clear.dataset.clear === 'cat') state.cat = 'all';
    else state.product = '';
    qInput.value = state.q;
    $('design-product').value = state.product;
    update();
    if (clear && clear.dataset.clear === 'q') qInput.focus();
  });
  // Coming Back to the page: the browser may refill the boxes; the address is what counts.
  window.addEventListener('pageshow', () => {
    qInput.value = state.q;
    $('design-product').value = state.product;
  });

  renderProducts();
  render();
  showActiveChip();
  document.addEventListener('pod:langchange', () => {
    renderProducts();
    render();
  });
})();
