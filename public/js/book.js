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
  $('bk').hidden = false;

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
  function renderForm() {
    $('bk-title').textContent = book.title.en.replace('{name}', state.answers.name || 'Your child');
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
      return `<div class="field">${label}<input id="q-${q.id}" data-q="${q.id}" type="${type}" ${type === 'date' ? `max="${today}" min="1990-01-01"` : `maxlength="${q.max || 40}" dir="auto"`} value="${esc(v)}" placeholder="${q.placeholder ? esc(tr(q.placeholder)) : ''}"></div>`;
    }).join('');
    $('bk-sizes').innerHTML = product.sizes.map((s) => `<button type="button" class="chip ${s.id === state.size.id ? 'active' : ''}" data-size="${s.id}">${esc(tr(s.label))}${s.surcharge ? ` <span style="opacity:.7">+${esc(money(s.surcharge))}</span>` : ''}</button>`).join('');
    $('bk-price').textContent = money(product.basePrice + state.size.surcharge);
    document.title = `${tr(product.name)} · OneOff Print`;
    renderButtons();
  }
  function renderButtons() {
    $('bk-make').textContent = t(state.design ? (state.dirty ? 'book.update' : 'book.updated') : 'book.make');
    $('bk-make').disabled = !!state.design && !state.dirty;
    $('bk-add').disabled = !state.design;
    $('bk-add').textContent = t(state.cartIndex !== null ? 'cart.update' : 'design.add');
    $('bk-photo-empty').hidden = !!(state.face || state.hasPhoto);
    $('bk-photo-saved').hidden = !state.hasPhoto || !!state.face;
  }
  const changed = () => {
    state.dirty = true;
    remember();
    renderButtons();
    $('bk-title').textContent = book.title.en.replace('{name}', state.answers.name || 'Your child');
  };

  $('bk-questions').addEventListener('input', (e) => {
    const q = e.target.dataset.q;
    if (!q || e.target.tagName === 'BUTTON') return;
    state.answers[q] = e.target.value;
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
    img.alt = t('book.pageAlt', { n: state.page + 1 });
    $('bk-count').textContent = t('book.pageOf', { n: POD.num(state.page + 1), total: POD.num(book.pages) });
    $('bk-prev').disabled = state.page === 0;
    $('bk-next').disabled = state.page === book.pages - 1;
    document.querySelectorAll('#bk-thumbs button').forEach((b, i) => b.classList.toggle('active', i === state.page));
    $('bk-sample').hidden = !!state.design;
  }
  function renderThumbs() {
    $('bk-thumbs').innerHTML = Array.from({ length: book.pages }, (_, i) => `<button type="button" data-page="${i}" aria-label="${esc(t('book.pageAlt', { n: i + 1 }))}"><img loading="lazy" alt="" src="${pageUrl(i)}"></button>`).join('');
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
  async function make() {
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
      if (book.ai && state.aiConsent && d.cartoon === 'failed') POD.toast(t('book.cartoonFailed'));
      if (book.ai && state.aiConsent && d.cartoon === 'limit') POD.toast(t('book.cartoonLimit'));
      $('bk-crop').hidden = true;
      renderButtons();
      renderThumbs();
      showPage(state.page);
      if (matchMedia('(max-width: 900px)').matches) $('bk-img').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    } catch (e) {
      POD.toast(e.message, 'error');
      return false;
    } finally {
      busy(false);
    }
  }
  $('bk-make').addEventListener('click', make);
  $('bk-add').addEventListener('click', async () => {
    if (state.dirty && !(await make())) return;
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
    if (state.cartIndex !== null && cart[state.cartIndex]) cart[state.cartIndex] = item;
    else cart.push(item);
    POD.setCart(cart);
    location.href = '/cart?added=1';
  });

  renderForm();
  renderThumbs();
  document.addEventListener('pod:langchange', () => { renderForm(); showPage(state.page); });
})();
