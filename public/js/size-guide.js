/**
 * Size guide for the clothing (owner, 28 Nov 2026: prepaid, printed to order, so the size must be right first time).
 * PODSizeGuide.link(product)   -> a "Size guide" button (HTML) or '' when the product has no guide
 * PODSizeGuide.open(product, { current, onPick }) -> the window: the measurements (cm, approximate), how to measure,
 *   the fit note and the size finder; "Choose M" calls onPick('M') when given.
 * PODSizeGuide.suggest(guide, { height, weight }) -> the size the finder suggests (the same rule as src/size-guide.js).
 * Strings: public/js/i18n-size-guide.js. Buttons with data-size-guide open it (wired by the page with wire()).
 */
(function () {
  const { t, tr, esc } = window.POD;
  const num = (v) => (window.POD.num ? window.POD.num(v) : String(v));
  const has = (product) => Boolean(product && product.sizeGuide && product.sizeGuide.rows && product.sizeGuide.rows.length);

  function suggest(g, by) {
    if (!g || !by) return null;
    const h = Number(by.height);
    if (!Number.isFinite(h) || h <= 0) return null;
    // (Numbers no real person has get no size. QA 28 Nov.)
    const R = g.range || {};
    if (R.height && (h < R.height[0] || h > R.height[1])) return null;
    const ids = g.rows.map((r) => r.id);
    if (g.finder === 'kids') {
      const list = ids.filter((id) => g.heights && g.heights[id]);
      return list.find((id) => h <= g.heights[id][1]) || (list.length ? list[list.length - 1] : null);
    }
    const w = Number(by.weight);
    if (!Number.isFinite(w) || w <= 0) return null;
    if (R.weight && (w < R.weight[0] || w > R.weight[1])) return null;
    if (g.kidsSize && ids.includes(g.kidsSize) && h < 150 && w < 45) return g.kidsSize;
    const list = ids.filter((id) => g.bands && g.bands[id]);
    if (!list.length) return null;
    const pick = (key, v) => {
      const i = list.findIndex((id) => v <= g.bands[id][key][1]);
      return i === -1 ? list.length - 1 : i;
    };
    return list[Math.max(pick('weight', w), pick('height', h))];
  }

  const sizeLabel = (product, id) => {
    const s = product.sizes.find((z) => z.id === id);
    return s ? tr(s.label) : id;
  };

  function link(product) {
    if (!has(product)) return '';
    return `<button type="button" class="link-btn sg-link" data-size-guide="${esc(product.id)}">📏 ${esc(t('sg.link'))}</button>`;
  }

  let box = null;
  let lastFocus = null;
  function close() {
    if (!box) return;
    box.remove();
    box = null;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(product, { current = null, onPick = null } = {}) {
    if (!has(product)) return;
    close();
    lastFocus = document.activeElement;
    const g = product.sizeGuide;
    const cell = (v) => (v == null ? '–' : `<bdi dir="ltr">${esc(typeof v === 'number' ? num(v) : String(v).replace(/\d+/g, (d) => num(Number(d))))}</bdi>`);
    const head = `<tr><th scope="col">${esc(t('sg.size'))}</th>${g.cols.map((c) => `<th scope="col">${esc(t('sg.col.' + c))}</th>`).join('')}</tr>`;
    const body = g.rows.map((r) => `<tr${r.id === current ? ' class="sg-current"' : ''} data-sg-row="${esc(r.id)}"><th scope="row">${esc(sizeLabel(product, r.id))}</th>${g.cols.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('');
    const kids = g.finder === 'kids';
    box = document.createElement('div');
    box.className = 'pv-modal sg-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'sg-title');
    box.innerHTML = `
      <div class="sg-box">
        <div class="sg-head"><h3 id="sg-title">${esc(t('sg.title', { name: tr(product.name) }))}</h3><button type="button" class="btn btn-sm" data-sg-close>${esc(t('sg.close'))}</button></div>
        <div class="sg-body">
          <p class="sg-fit"><strong>${esc(t('sg.fit'))}:</strong> ${esc(tr(g.fit))}</p>
          <div class="sg-table-wrap"><table class="sg-table">${head}${body}</table></div>
          <p class="muted small">${esc(t('sg.cm'))}</p>
          <details class="sg-how"><summary>${esc(t('sg.how'))}</summary><ul>${g.cols.map((c) => `<li>${esc(t('sg.how.' + c))}</li>`).join('')}</ul></details>
          <form class="sg-finder" novalidate>
            <h4>${esc(t('sg.finder'))}</h4>
            <div class="sg-fields">
              <label>${esc(t(kids ? 'sg.childHeight' : 'sg.height'))} <input type="text" inputmode="numeric" autocomplete="off" maxlength="5" dir="ltr" name="height" required></label>
              ${kids ? '' : `<label>${esc(t('sg.weight'))} <input type="text" inputmode="numeric" autocomplete="off" maxlength="5" dir="ltr" name="weight" required></label>`}
              <button type="submit" class="btn btn-sm btn-primary">${esc(t('sg.suggest'))}</button>
            </div>
            <p class="sg-result" role="status" aria-live="polite"></p>
          </form>
          <p class="sg-note small">${esc(t('sg.noReturn'))}</p>
        </div>
      </div>`;
    document.body.appendChild(box);
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-sg-close]')) { close(); return; }
      const use = e.target.closest('[data-sg-use]');
      if (use && onPick) {
        const id = use.dataset.sgUse;
        onPick(id);
        box.querySelectorAll('[data-sg-row]').forEach((r) => r.classList.toggle('sg-current', r.dataset.sgRow === id));
        box.querySelector('.sg-result').textContent = t('sg.chosen', { size: sizeLabel(product, id) });
      }
    });
    box.querySelector('.sg-finder').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      // Arabic-Indic (٠-٩) and Persian (۰-۹) digits, as phones in Egypt type them, and a comma for a decimal point.
      const latin = (v) => String(v || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٫,]/g, '.').trim();
      const by = { height: latin(f.height.value), weight: f.weight ? latin(f.weight.value) : null };
      const out = box.querySelector('.sg-result');
      box.querySelectorAll('[data-sg-row]').forEach((r) => r.classList.remove('sg-hint'));
      const typed = (v) => v !== '' && v != null;
      if (!typed(by.height) || (!kids && !typed(by.weight))) { out.textContent = t(kids ? 'sg.needHeight' : 'sg.needBoth'); return; }
      const id = suggest(g, by);
      // Typed, but not a real height or weight (letters, 50 cm, 300 kg): said so, nothing suggested.
      if (!id) { out.textContent = t(kids ? 'sg.checkHeight' : 'sg.checkBoth'); return; }
      const label = sizeLabel(product, id);
      out.innerHTML = `${esc(t('sg.result', { size: label }))}${onPick ? ` <button type="button" class="btn btn-sm" data-sg-use="${esc(id)}">${esc(t('sg.use', { size: label }))}</button>` : ''}`;
      box.querySelectorAll('[data-sg-row]').forEach((r) => r.classList.toggle('sg-hint', r.dataset.sgRow === id));
    });
    const first = box.querySelector('[data-sg-close]');
    if (first) first.focus();
  }

  /** Opens the guide from any [data-size-guide] button inside root. */
  function wire(root, getProduct, opts = {}) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-size-guide]');
      if (!b) return;
      e.preventDefault();
      const p = getProduct(b.dataset.sizeGuide);
      if (p) open(p, typeof opts === 'function' ? opts(p) : opts);
    });
  }

  window.PODSizeGuide = { has, link, open, close, suggest, wire };
})();
