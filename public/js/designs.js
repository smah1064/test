/* Ready-made designs shop: search, pick a category and a product; each card shows the design on its product. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);

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

  // (Without the designs there is nothing to search or filter: the tools come back with them.)
  const tools = [$('design-tools'), $('design-cats')];
  let catalog;
  let lib;
  try {
    [catalog, lib] = await loadOrRetry($('design-net'), () => Promise.all([POD.loadCatalog(), POD.api('/api/library')]).catch((e) => {
      tools.forEach((el) => { el.hidden = true; });
      throw e;
    }));
  } catch (e) {
    // Any other refusal (too many tries…): the site's own words.
    $('design-net').hidden = false;
    $('design-net').innerHTML = `<h2>${esc(e.message)}</h2>`;
    return;
  }
  tools.forEach((el) => { el.hidden = false; });
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
      // ("بابا نويل" is Santa, not dad: one word of its own, so a Father's Day search doesn't list Christmas. QA 25 Nov.)
      .replace(/(^| )بابا نويل(?= |$)/g, '$1santa')
      .trim();
    // Spelt with or without the long ي (تيشرت / تيشيرت).
    const loose = (s) => s.replace(/ي/g, '').replace(/ +/g, ' ');
    // The same thing said other ways, in both languages (two words keep their space; plurals are found anyway).
    const SAME = {
      tshirt: 'tshirt, t shirt, tee, tee shirt, shirt, تيشيرت, تي شيرت, تشيرت, قميص, قمصان',
      hoodie: 'hoodie, hoody, هودي',
      sweatshirt: 'sweatshirt, sweat shirt, سويتشيرت, سويت شيرت',
      cap: 'cap, hat, كاب, كاسكيت, قبعة, طاقية',
      mug: 'mug, cup, مج, مجات, مجين, ماج, كوب, كوباية, فنجان, فناجين',
      bag: 'bag, شنطة, شنط, كيس, اكياس',
      card: 'card, كارت, كروت, كارد, بطاقة',
      bizcard: 'business card, visit card, visiting card, بيزنس كارد, بيزنس كارت, بزنس كارد, بزنس كارت, كارت بيزنس, كارت بزنس, كروت بيزنس, كروت بزنس, كارت شخصي, كروت شخصية, كارت فيزيت',
      // (One word alone, as the English "business": everything for a business.)
      business: 'business, بيزنس, بزنس',
      catalog: 'catalog, catalogue, كتالوج, كاتلوج, كاتالوج, كتلوج',
      invitation: 'invitation, invite, دعوة',
      wedding: 'wedding, فرح, أفراح, زفاف, زواج, جواز',
      // (كرة as well as كورة, soccer as well as football, Egypt in English too, invoice and letterhead in Arabic. QA 26 Nov.)
      football: 'football, soccer, كورة, كرة, كرة القدم, كرة قدم',
      egypt: 'egypt, egyptian, مصر, مصري, مصرية',
      poster: 'poster, بوستر',
      notebook: 'notebook, note book, نوت بوك, نوتبوك, كشكول, كشاكيل',
      calendar: 'calendar, نتيجة, تقويم, نتايج',
      sticker: 'sticker, ستيكر, استيكر',
      pillow: 'pillow, cushion, pillowcase, pillow case, cushion cover, كوشن, مخدة, خدادية, وسادة, كيس مخدة',
      // (Not كانفاس or canvas alone: the tote bag and the pencil case are canvas too.)
      canvasprint: 'canvas print, wall canvas, لوحة كانفاس, تابلوه, تابلو',
      photobook: 'photo book, photobook, photo album, فوتو بوك, فوتوبوك, البوم صور',
      idcard: 'id card, id badge, name badge, badge, بادج, كارنيه',
      phonecase: 'phone case, phone cover, mobile case, mobile cover, جراب, جراب موبايل, كفر موبايل',
      christmas: 'christmas, xmas, كريسماس',
      santa: 'santa, santa claus, سانتا, سانتا كلوز',
      // (Arabic as found as English: هدية / هدايا / gift, قهوة / coffee, شاي / tea. QA 25 Nov.)
      gift: 'gift, gifts, present, هدية, هدايا, هديه',
      coffee: 'coffee, قهوة, قهوه, نسكافيه',
      tea: 'tea, شاي, شاى',
      birthday: 'birthday, عيد ميلاد',
      dog: 'dog, puppy, كلب, كلاب',
      cat: 'cat, kitten, قطة, قطط',
      kids: 'kids, kid, children, child, اطفال, طفل, ولاد, اولاد',
      // ("Mother's Day" is searched as "mother day": the 's is left out below.)
      mom: 'mom, mum, mommy, mummy, mama, mother, mother day, mothers day, ماما, الام, امي, عيد الام',
      dad: 'dad, daddy, papa, father, father day, fathers day, بابا, الاب, ابويا, عيد الاب',
      // (Valentine's Day, Teacher's Day, a new baby and the prayer mat (مصلية), in either language. QA 25 Nov.)
      valentine: 'valentine, valentines, valentine day, عيد الحب, عيد حب, فالنتاين, فلانتين',
      teacher: 'teacher, teachers day, teacher day, معلم, المعلم, عيد المعلم, مدرس, يوم المعلم',
      baby: 'baby, newborn, بيبي, نونو, مولود',
      prayermat: 'prayer mat, prayer rug, سجادة صلاة, مصلية, مصلاية',
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
    // The word after "the" / "for the" / "with the" / "and the" in front (التيشيرتات, للأفراح), when 3 letters or more
    // are left; after "the" / "for the", 2 are enough (الأم, للأب); "for" alone before an alef with 3 left (لأمي).
    // A word of 2 is only looked for with its article (للأب: الأب, as the shop's words list it): أب alone is also the
    // "up" of ليفل أب and ستارت أب. One of the shop's words of 2 (مج, الأم, الأب) also after "with the" / "and the"
    // (بالمج, والأب; not بالون or والده), and مج, a word of the shop alone, also without its article: المج, للمج, والمج
    // and بالمج find what مج finds.
    const article = (w) => {
      const m = /^(?:وال|بال|لل|ال)([ء-ي]{3,})$|^(?:لل|ال)([ء-ي]{2})$|^ل(ا[ء-ي]{2,})$|^(?:وال|بال)([ء-ي]{2})$/.exec(w);
      if (!m) return '';
      return m[4] ? (sameAs.has(m[4]) || sameAs.has(`ال${m[4]}`) ? m[4] : '') : m[1] || m[2] || m[3];
    };
    const bare = (w) => { const c = article(w); return !c ? [w] : c.length === 2 ? [w, `ال${c}`, ...(sameAs.has(c) ? [c] : [])] : [w, c]; };
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
      // (A lone "s" is the English 's: "mother's day" is "mother day".)
      const ws = norm(q).split(' ').filter((w, i) => w && !(w === 's' && i > 0));
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
    // An Arabic word of three letters (most Arabic words are built on three) inside a longer word is another word:
    // it counts at the start of a word only, and without its ي not at all, on both pages (كيس is not the كس of
    // اكسسوارات, ليل not the لل of للأعمال). One or two letters are a word still being typed: found as before.
    // The same rule for a word of two or three letters after its article (الأم, للأب, لأمي): that word after an article
    // (or none, for three letters) at the start of a word; one of the shop's words (الأم, الأب) as a whole word.
    // الأم is not in الامتحانات, للأب not in للأبد, الأب not in الأبعاد, لأمي (without its ي, لام) not in لاما.
    function hasShort(h, word, core, whole) {
      const end = whole || (core.length === 2 && (sameAs.has(core) || sameAs.has(`ال${core}`))) ? ' ' : '';
      const lc = loose(core);
      return ['', 'ال', 'لل', 'بال', 'وال'].some((p) => [word, core].some((w) => (p || w.length > 2) && h.text.includes(` ${p}${w}${end}`))
        || (lc.length > 2 && h.loose.includes(` ${p}${lc}${end}`)));
    }
    // start 'word': the words as whole words only (or another form, or what they name), to rank names: a mug (مج,
    // the same as كوب) before كوبونات, the cap (كاب) before للكابلز, whose words only start with what was typed.
    function has(h, term, start) {
      const whole = start === 'word';
      const core = article(term.word);
      if (core && core.length <= 3) {
        if (hasShort(h, term.word, core, whole)) return true;
        return term.forms.some((f) => h.text.includes(` ${f} `)) || term.concepts.some((c) => h.concepts.has(c));
      }
      const short = term.word.length === 3 && /^[ء-ي]+$/.test(term.word);
      const at = start || short ? ' ' : '';
      const end = whole ? ' ' : '';
      const lw = loose(term.word);
      const looseHit = h.looseAnywhere && !short && !whole ? h.loose.includes(at + lw) : lw.length > 2 && h.loose.includes(` ${lw}${end}`);
      if (term.word && (h.text.includes(at + term.word + end) || looseHit)) return true;
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
      return `<a class="card product-card design-card" href="/design?id=${encodeURIComponent(d.id)}${extra}" data-place="${esc(d.id)}">
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
      <h2>${state.q.trim() ? esc(t('designs.noMatch', { q: '\u0000' })).replace('\u0000', `<bdi>${esc(state.q.trim())}</bdi>`) : esc(t('designs.noMatchFilters'))}</h2>
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

  // ---------- Back to the same place ----------
  // Back from a design: the same place in the list. The browser can't put it back itself: the cards are drawn once the
  // designs have come, after it has tried (the page was still short, so it stayed at the top). So, as the product page
  // does for its ready designs, the place is kept in this history entry when a link is followed: where the page was,
  // and the design followed and its height on the screen, so the place holds even if what is above it is a little
  // taller or shorter by then. The search, the category and the product are in the address. (QA 26 Nov.)
  const back = (history.state && typeof history.state === 'object' && history.state.designs) || null;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const card = a.closest('[data-place]');
    const designs = { y: Math.round(window.scrollY), ...(card ? { place: card.dataset.place, top: Math.round(card.getBoundingClientRect().top) } : {}) };
    try { history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), designs }, ''); } catch (err) { /* not kept */ }
  });
  /** Once the cards are drawn: back to the design that was followed, at the same height, else to the same scroll. */
  function backToPlace() {
    if (!back || !(back.y > 0)) return;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    requestAnimationFrame(() => {
      const card = typeof back.place === 'string' && [...document.querySelectorAll('#design-grid [data-place]')].find((el) => el.dataset.place === back.place);
      const y = card && Number.isFinite(back.top) ? window.scrollY + card.getBoundingClientRect().top - back.top : back.y;
      window.scrollTo(0, Math.max(0, Math.min(Math.round(y), document.documentElement.scrollHeight)));
    });
  }

  renderProducts();
  render();
  showActiveChip();
  backToPlace();
  document.addEventListener('pod:langchange', () => {
    renderProducts();
    render();
  });
})();
