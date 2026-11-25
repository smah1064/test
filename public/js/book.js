/* Personalised book page: answer the questions, add a photo and crop the
 * face, flip through every page of the real book, add it to the cart. Pages
 * are drawn on the server, so the preview is exactly what gets printed. */
(async () => {
  const { t, tr, esc, money } = POD;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const catalog = await POD.loadCatalog();
  let book;
  try {
    book = await POD.api('/api/books/' + encodeURIComponent(params.get('b') || 'space-hero'));
  } catch (e) {
    $('bk-missing').hidden = false;
    return;
  }
  const product = catalog.products.find((p) => p.kind === 'book' && p.book === book.id);
  if (!product) {
    // Not in the shop, as on the product page: paused or sold out ("back soon", or the day it's back), or
    // stopped selling (similar products to pick instead). The shop says which (common.js: productState).
    const info = await POD.productState(book.product);
    const box = $('bk-missing');
    box.classList.add('unavail-box');
    const show = () => POD.showUnavailable(box, info, catalog);
    show();
    document.addEventListener('pod:langchange', show);
    return;
  }
  $('bk').hidden = false;
  // Every kids' book (story, colouring): one tap to the other.
  const allBooks = catalog.products.filter((p) => p.kind === 'book');
  function renderBookTabs() {
    $('bk-books').hidden = allBooks.length < 2;
    $('bk-books').innerHTML = allBooks.map((p) => `<a class="side-tab ${p.book === book.id ? 'active' : ''}" href="/book?b=${encodeURIComponent(p.book)}"${p.book === book.id ? ' aria-current="page"' : ''}>${esc(tr(p.name))}</a>`).join('');
  }
  renderBookTabs();
  document.addEventListener('pod:langchange', renderBookTabs);

  // ---------- State ----------
  const KEY = 'pod-book-' + book.id;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
  const state = {
    answers: saved.answers || {},
    lang: 'en', // books are printed in English
    size: product.sizes.find((s) => s.id === saved.size) || product.sizes[0],
    face: null, // data URL of the cropped face, when a new photo was chosen
    hasPhoto: false, // the server already has a photo for this book
    design: null, // { id, editToken, version, pages, ... }
    page: 0,
    aiConsent: !!saved.aiConsent,
    dirty: true,
    adding: false, // "Add to cart" is at work (the button waits)
    cartIndex: params.has('cart') ? Number(params.get('cart')) : null,
  };
  const remember = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ answers: state.answers, lang: state.lang, size: state.size.id, aiConsent: state.aiConsent })); } catch (e) { /* private mode */ }
  };

  // Re-open a book that is already in the cart.
  if (state.cartIndex !== null) {
    const item = POD.getCart()[state.cartIndex];
    if (item && item.bookId === book.id && item.editToken) {
      try {
        const d = await POD.api('/api/books/designs/' + encodeURIComponent(item.designId), { headers: { 'x-edit-token': item.editToken } });
        state.design = { ...d, editToken: item.editToken };
        state.answers = d.answers;
        state.aiConsent = !!d.aiConsent;
        state.size = product.sizes.find((s) => s.id === d.size.id) || state.size;
        state.hasPhoto = true;
        state.dirty = false;
      } catch (e) {
        state.cartIndex = null;
      }
    } else state.cartIndex = null;
  }

  // ---------- Form ----------
  const today = new Date().toISOString().slice(0, 10);
  // The books are printed in English: right-to-left letters (Arabic…) can't go in. Shown on every such
  // field as it is typed, and all of them at once when making the book.
  const RTL_RE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
  function markLatin(el) {
    if (!el || !el.dataset || !el.dataset.q || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.type === 'date') return false;
    const bad = RTL_RE.test(el.value || '');
    const field = el.closest('.field');
    let note = field && field.querySelector('.bk-latin-note');
    if (bad && field && !note) {
      note = document.createElement('p');
      note.className = 'bk-latin-note';
      note.setAttribute('role', 'alert');
      note.style.cssText = 'margin:4px 0 0;color:var(--bad);font-size:13px;font-weight:600';
      note.textContent = t('book.latinNote');
      field.appendChild(note);
    } else if (!bad && note) note.remove();
    el.setAttribute('aria-invalid', bad ? 'true' : 'false');
    el.style.borderColor = bad ? 'var(--bad)' : '';
    return bad;
  }
  /** Fields with right-to-left letters, as [question, element]. */
  const latinProblems = () => book.questions
    .filter((q) => q.type !== 'choice' && q.type !== 'date' && RTL_RE.test(String(state.answers[q.id] || '')))
    .map((q) => [q, document.querySelector(`#bk-questions [data-q="${q.id}"]`)]);
  function renderForm() {
    $('bk-title').textContent = tr(book.title).replace('{name}', () => state.answers.name || t('book.yourChild'));
    $('bk-blurb').textContent = tr(book.blurb);
    $('bk-questions').innerHTML = book.questions.map((q) => {
      const v = state.answers[q.id] || '';
      const label = `<label for="q-${q.id}">${esc(tr(q.label))}</label>`;
      if (q.type === 'choice') {
        return `<div class="field"><label>${esc(tr(q.label))}</label><div class="chips ${q.options[0].picture ? 'bk-pics' : ''}" data-choice="${q.id}">
          ${q.options.map((o) => `<button type="button" class="chip ${o.id === v ? 'active' : ''}" data-q="${q.id}" data-v="${esc(o.id)}">${o.picture ? `<img src="${esc(o.picture)}" alt="">` : ''}<span>${esc(tr(o.label))}</span></button>`).join('')}
        </div></div>`;
      }
      if (q.type === 'textarea') {
        return `<div class="field">${label}<textarea id="q-${q.id}" data-q="${q.id}" maxlength="${q.max}" rows="3" dir="auto" placeholder="${esc(t('book.dedicationHint'))}">${esc(v)}</textarea></div>`;
      }
      const type = q.type === 'date' ? 'date' : 'text';
      return `<div class="field">${label}<input id="q-${q.id}" data-q="${q.id}" type="${type}" ${type === 'date' ? `max="${today}" min="${esc(q.min || '1900-01-01')}"` : `maxlength="${q.max || 40}" dir="auto"`} value="${esc(v)}" placeholder="${q.placeholder ? esc(tr(q.placeholder)) : ''}"></div>`;
    }).join('');
    $('bk-questions').insertAdjacentHTML('afterbegin', `<p class="muted small bk-en-hint" style="margin:0 0 10px">${esc(t('book.englishHint'))}</p>`);
    $('bk-questions').querySelectorAll('input[data-q], textarea[data-q]').forEach(markLatin);
    $('bk-sizes').innerHTML = product.sizes.map((s) => `<button type="button" class="chip ${s.id === state.size.id ? 'active' : ''}" data-size="${s.id}">${esc(tr(s.label))}${POD.sizeNote(product, s) ? ` <span style="opacity:.7">${esc(POD.sizeNote(product, s))}</span>` : ''}</button>`).join('');
    $('bk-price').textContent = money(product.basePrice + state.size.surcharge);
    document.title = `${tr(product.name)} · ebda3`;
    renderButtons();
  }
  function renderButtons() {
    $('bk-make').textContent = t(state.design ? (state.dirty ? 'book.update' : 'book.updated') : 'book.make');
    $('bk-make').disabled = !!state.design && !state.dirty;
    $('bk-add').disabled = !state.design || !!state.adding;
    $('bk-add').textContent = t(state.cartIndex !== null ? 'cart.update' : 'design.add');
    $('bk-photo-empty').hidden = !!(state.face || state.hasPhoto);
    $('bk-photo-saved').hidden = !state.hasPhoto || !!state.face;
  }
  const changed = () => {
    state.dirty = true;
    remember();
    renderButtons();
    $('bk-title').textContent = tr(book.title).replace('{name}', () => state.answers.name || t('book.yourChild'));
  };

  $('bk-questions').addEventListener('input', (e) => {
    const q = e.target.dataset.q;
    if (!q || e.target.tagName === 'BUTTON') return;
    state.answers[q] = e.target.value;
    markLatin(e.target);
    changed();
  });
  $('bk-questions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]');
    if (!b) return;
    state.answers[b.dataset.q] = b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    changed();
  });
  $('bk-sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    state.size = product.sizes.find((s) => s.id === b.dataset.size);
    renderForm();
    changed();
  });

  // ---------- AI drawing (optional, needs the parent's consent) ----------
  $('bk-ai').hidden = !book.ai;
  $('bk-ai-ok').checked = state.aiConsent;
  $('bk-ai-ok').addEventListener('change', (e) => {
    state.aiConsent = e.target.checked;
    changed();
  });

  // ---------- Photo: crop the face into the oval ----------
  const cv = $('bk-canvas');
  const ctx = cv.getContext('2d');
  const crop = { img: null, zoom: 1, x: 0, y: 0 }; // x/y: image position of the oval's centre
  const OVAL_RY = 0.42;
  const OVAL_RX = OVAL_RY * 0.8;
  function base() { return Math.min(crop.img.naturalWidth, crop.img.naturalHeight); }
  function drawCrop() {
    if (!crop.img) return;
    const S = cv.width;
    const span = base() / crop.zoom; // image pixels across the circle
    const k = S / span;
    ctx.fillStyle = '#e9ecf1';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(crop.img, S / 2 - crop.x * k, S / 2 - crop.y * k, crop.img.naturalWidth * k, crop.img.naturalHeight * k);
    // Dim everything outside the face oval (hairline to chin).
    ctx.save();
    ctx.fillStyle = 'rgba(20,24,33,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.ellipse(S / 2, S / 2, S * OVAL_RX, S * OVAL_RY, 0, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, S * OVAL_RX, S * OVAL_RY, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Eye line guide.
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(S * (0.5 - OVAL_RX * 0.8), S * (0.5 - OVAL_RY * 0.12));
    ctx.lineTo(S * (0.5 + OVAL_RX * 0.8), S * (0.5 - OVAL_RY * 0.12));
    ctx.stroke();
    ctx.restore();
  }
  function clampCrop() {
    const half = base() / crop.zoom / 2;
    crop.x = Math.min(Math.max(crop.x, half), crop.img.naturalWidth - half);
    crop.y = Math.min(Math.max(crop.y, half), crop.img.naturalHeight - half);
  }
  /** The face oval's bounding box, 4:5, as a 720 x 900 JPEG. */
  function exportFace() {
    const out = document.createElement('canvas');
    out.width = 720;
    out.height = 900;
    const span = base() / crop.zoom; // image pixels across the square view
    const h = span * OVAL_RY * 2;
    const w = span * OVAL_RX * 2;
    out.getContext('2d').drawImage(crop.img, crop.x - w / 2, crop.y - h / 2, w, h, 0, 0, 720, 900);
    return out.toDataURL('image/jpeg', 0.9);
  }
  $('bk-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25e6) return POD.toast(t('book.badPhoto'), 'error');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      crop.img = img;
      crop.zoom = 2;
      crop.x = img.naturalWidth / 2;
      crop.y = img.naturalHeight * 0.4;
      $('bk-zoom').value = crop.zoom;
      clampCrop();
      $('bk-crop').hidden = false;
      drawCrop();
      state.face = 'pending';
      changed();
    };
    img.onerror = () => POD.toast(t('book.badPhoto'), 'error');
    img.src = url;
  });
  $('bk-zoom').addEventListener('input', (e) => {
    crop.zoom = Number(e.target.value);
    clampCrop();
    drawCrop();
    changed();
  });
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!crop.img) return;
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = (base() / crop.zoom) / cv.getBoundingClientRect().width;
    crop.x = drag.cx - (e.clientX - drag.x) * k;
    crop.y = drag.cy - (e.clientY - drag.y) * k;
    clampCrop();
    drawCrop();
  });
  const endDrag = () => {
    if (drag) changed();
    drag = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  // ---------- Pages ----------
  function pageUrl(n) {
    if (state.design) return `/api/books/designs/${state.design.id}/pages/${n}.jpg?v=${state.design.version}`;
    return `/api/books/${book.id}/sample/${n}.jpg?lang=${state.lang}`;
  }
  function showPage(n) {
    state.page = Math.max(0, Math.min(book.pages - 1, n));
    const img = $('bk-img');
    const url = pageUrl(state.page);
    if (img.getAttribute('src') !== url) {
      $('bk-spin').hidden = false;
      img.style.opacity = '.4';
      img.onload = img.onerror = () => { $('bk-spin').hidden = true; img.style.opacity = ''; };
      img.src = url;
    }
    img.alt = pageLabel(state.page);
    $('bk-count').textContent = t('book.pageOf', { n: POD.num(state.page + 1), total: POD.num(book.pages) });
    $('bk-prev').disabled = state.page === 0;
    $('bk-next').disabled = state.page === book.pages - 1;
    // The thumbnails' labels follow the language too (a language switch calls showPage, not renderThumbs).
    document.querySelectorAll('#bk-thumbs button').forEach((b, i) => {
      b.classList.toggle('active', i === state.page);
      b.setAttribute('aria-label', pageLabel(i));
    });
    $('bk-sample').hidden = !!state.design;
  }
  /** "Page 3 of the book" / "صفحة ٣ من الكتاب": page i (from 0) in the language on screen. */
  function pageLabel(i) {
    return t('book.pageAlt', { n: POD.num(i + 1) });
  }
  function renderThumbs() {
    $('bk-thumbs').innerHTML = Array.from({ length: book.pages }, (_, i) => `<button type="button" data-page="${i}" aria-label="${esc(pageLabel(i))}"><img loading="lazy" alt="" src="${pageUrl(i)}"></button>`).join('');
    showPage(state.page);
  }
  $('bk-prev').addEventListener('click', () => showPage(state.page - 1));
  $('bk-next').addEventListener('click', () => showPage(state.page + 1));
  $('bk-thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) showPage(Number(b.dataset.page));
  });
  // Swipe between pages on phones.
  let touchX = null;
  $('bk-img').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('bk-img').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 40) return;
    const forward = document.dir === 'rtl' ? dx > 0 : dx < 0;
    showPage(state.page + (forward ? 1 : -1));
  });

  // ---------- Make / update the book ----------
  const busy = (on, text) => {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  };
  function missing() {
    for (const q of book.questions) {
      if (q.required && !String(state.answers[q.id] || '').trim()) return tr(q.label);
    }
    if (!state.face && !state.hasPhoto) return t('book.photo');
    return null;
  }
  function dateProblem() {
    for (const q of book.questions) {
      const v = q.type === 'date' ? String(state.answers[q.id] || '') : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
      const min = q.min || '1900-01-01';
      if (v < min) return { q, message: t('book.dateTooOld', { field: tr(q.label), year: Number(min.slice(0, 4)) }) };
      if (v > new Date().toISOString().slice(0, 10)) return { q, message: t('book.dateFuture', { field: tr(q.label) }) };
    }
    return null;
  }
  async function make() {
    const rtl = latinProblems();
    if (rtl.length) {
      rtl.forEach(([, el]) => markLatin(el));
      POD.toast(t('book.latinFields', { fields: rtl.map(([q]) => tr(q.label)).join(POD.lang === 'ar' ? '، ' : ', ') }), 'error');
      const first = rtl[0][1];
      if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        first.focus({ preventScroll: true });
      }
      return false;
    }
    // The date box lets any year be typed: too early or not come yet, said as such.
    const bad = dateProblem();
    if (bad) {
      POD.toast(bad.message, 'error');
      const el = document.querySelector(`#bk-questions [data-q="${bad.q.id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
      return false;
    }
    const miss = missing();
    if (miss) {
      POD.toast(t('book.missing', { field: miss }), 'error');
      const q = book.questions.find((x) => tr(x.label) === miss);
      const el = q && document.querySelector(`[data-q="${q.id}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }
    busy(true, t(book.ai && state.aiConsent && (state.face || !state.design) ? 'book.drawing' : 'book.making'));
    try {
      const body = { answers: state.answers, lang: state.lang, size: state.size.id, aiConsent: !!(book.ai && state.aiConsent) };
      if (state.face) body.face = exportFace();
      let d;
      if (!state.design) {
        d = await POD.api(`/api/books/${book.id}/designs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        state.design = d;
      } else {
        d = await POD.api(`/api/books/designs/${state.design.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-edit-token': state.design.editToken }, body: JSON.stringify(body) });
        state.design = { ...d, editToken: state.design.editToken };
      }
      state.face = null;
      state.hasPhoto = true;
      state.dirty = false;
      // Opened from the cart: the saved book changed, so the cart line follows (cover, price, picture).
      const cart = POD.getCart();
      const line = state.cartIndex !== null ? cart[state.cartIndex] : cart.find((c) => c.designId === d.id);
      if (line && line.designId === d.id) {
        Object.assign(line, { sizeLabel: d.size.label, price: d.price, previewUrl: d.previewUrl });
        POD.setCart(cart);
      }
      if (book.ai && state.aiConsent && d.cartoon === 'failed') POD.toast(t('book.cartoonFailed'));
      if (book.ai && state.aiConsent && d.cartoon === 'limit') POD.toast(t('book.cartoonLimit'));
      $('bk-crop').hidden = true;
      renderButtons();
      renderThumbs();
      showPage(state.page);
      if (matchMedia('(max-width: 900px)').matches) window.scrollTo({ top: $('bk-img').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
      return true;
    } catch (e) {
      POD.toast(e.message, 'error');
      return false;
    } finally {
      busy(false);
    }
  }
  $('bk-make').addEventListener('click', make);
  // One book per tap: a second tap (double click, slow phone) while the first is still adding does
  // nothing, and a book already in the cart is updated where it is, never put in twice (checkout refuses
  // the same design twice).
  $('bk-add').addEventListener('click', async () => {
    if (state.adding) return;
    state.adding = true;
    renderButtons();
    let leaving = false;
    try {
      if (state.dirty && !(await make())) return;
      leaving = addToCart();
    } finally {
      if (!leaving) {
        state.adding = false;
        renderButtons();
      }
    }
  });
  // Back to this page from the cart (the browser kept it as it was): the button works again.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && state.adding) {
      state.adding = false;
      renderButtons();
    }
  });
  function addToCart() {
    const d = state.design;
    const cart = POD.getCart();
    const item = {
      designId: d.id,
      bookId: book.id,
      editToken: d.editToken,
      productId: d.productId,
      productName: d.productName,
      colorName: d.color.name,
      sizeLabel: d.size.label,
      sides: d.sides.map((s) => s.name),
      price: d.price,
      previewUrl: d.previewUrl,
      addedAt: new Date().toISOString(),
    };
    // The line of this very book wherever it is now (opened from the cart, or added a moment ago).
    const at = cart.findIndex((c) => c.designId === d.id);
    if (at >= 0) cart[at] = item;
    else cart.push(item);
    // The browser refused to keep the cart (storage blocked): stay here, the message says so.
    if (POD.setCart(cart) === false) return false;
    location.href = '/cart?added=1';
    return true;
  }

  renderForm();
  renderThumbs();
  document.addEventListener('pod:langchange', () => { renderForm(); showPage(state.page); });
})();
