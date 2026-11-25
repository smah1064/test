/*
 * Admin → Ready designs → Upload designs (zip), for the owner and product managers.
 * A zip of design pictures goes up (POST /api/admin/library/uploads, the raw zip); the server reads each
 * picture and suggests products. Here each design is checked (name, category, products, the colour it is
 * shown on) with previews drawn by the shop's own renderer, then published (POST …/:batch/publish).
 * Uploads not finished yet are listed so the work can be picked up again or discarded.
 * admin.js calls AdminUploads.init({ api, token, signOut, renderer, categories, published }) once,
 * show({ auto }) when the Ready designs tab loads or refreshes, and onLang() on a language switch.
 * Everything it shows lives in #lib-up (and the bigger preview, a dialog).
 */
window.AdminUploads = (() => {
  const { t, tr, esc } = POD;
  const $ = (id) => document.getElementById(id);
  const BASE = '/api/admin/library/uploads';
  const MAX_BYTES = 600 * 2 ** 20; // (the server's limit too)
  const PIECES_FROM = 8 * 2 ** 20; // bigger zips go up in pieces
  const SHOWN = 10; // suggestions shown before "More suggestions"
  const STRIP = 3; // previews per design
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const STORE = 'pod-up-edits:'; // + batch id: the changes made so far (this browser)

  let cfg = null;
  let catalog = null;
  const S = {
    batches: null, // open uploads (summaries), null until read
    listErr: '',
    batch: null, // the upload being checked
    up: null, // the upload under way: { xhr, name, loaded, total, reading }
    msg: null, // { text (a string, or a function for the page's language), bad, list } under the uploader or the review's title
    busy: false, // publishing or discarding
    drag: 0,
  };
  const ed = new Map(); // item id -> { name: { en, ar }, category, products, extra, color, skip, more }
  const itemErr = new Map(); // item id -> why it can't be published: 'noProducts', or the server's code (last try)

  const root = () => $('lib-up');
  const has = (key) => Boolean(window.POD_STRINGS && window.POD_STRINGS[key]);
  const iso = (s) => `⁨${s}⁩`; // a file or product name inside a sentence in the other direction
  const pics = (n) => POD.plural('up.pics', n);
  const designs = (n) => POD.plural('rd.n', n);
  const mb = (bytes) => POD.num(Math.max(0.1, bytes / 2 ** 20));
  const pct = (x) => new Intl.NumberFormat(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { style: 'percent' }).format(x);
  const when = (iso8601) => {
    try {
      return new Date(iso8601).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };
  const who = (by) => (!by || by === 'owner' ? t('up.byOwner') : by);

  // ---------- Products ----------
  const products = () => (catalog ? catalog.products.filter((p) => !p.kind) : []);
  const prod = (id) => (catalog ? catalog.products.find((p) => p.id === id) : null);
  const prodName = (id) => {
    const p = prod(id);
    return p ? tr(p.name) : id;
  };
  /** The suggestions for products the shop sells now (all of them while the catalogue isn't read). */
  const suggestions = (item) => (item.suggestions || []).filter((s) => !catalog || prod(s.productId));
  const sugFor = (item, pid) => (item.suggestions || []).find((s) => s.productId === pid) || null;

  // ---------- The name in each language ----------
  // Arabic letters (with the presentation forms): they never belong in the English name, which the English shop shows.
  const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  /**
   * The name the shop made from the file name, in the box of its own language: an Arabic file name ("فانوس")
   * goes in the Arabic box only and a Latin one ("Happy cat") in the English box only. A name already made in
   * both languages ("Design 12" / "تصميم 12") stays as it is.
   */
  function nameBoxes(name) {
    const en = String((name && name.en) || '');
    const ar = String((name && name.ar) || '');
    if (en !== ar) return { en, ar };
    if (ARABIC.test(en)) return { en: '', ar };
    if (/[A-Za-z]/.test(en)) return { en, ar: '' };
    return { en, ar };
  }
  /** The name sent when publishing (both boxes emptied: the one made from the file name). */
  function sentName(item) {
    const e = E(item);
    const en = e.name.en.trim();
    const ar = e.name.ar.trim();
    return en || ar ? { en, ar } : nameBoxes(item.name);
  }
  /** Why a design's English name can't be published ('' when it can): Arabic letters in it, or none at all. */
  function nameProblem(item) {
    const { en } = sentName(item);
    return ARABIC.test(en) ? 'nameEnArabic' : !en ? 'nameEnMissing' : '';
  }
  const NAME_CODES = ['nameEnArabic', 'nameEnMissing'];

  // ---------- Changes made here (kept in this browser until published or discarded) ----------
  function E(item) {
    if (!ed.has(item.id)) {
      ed.set(item.id, {
        name: nameBoxes(item.name),
        category: item.category || 'other',
        products: (item.picked || []).slice(),
        extra: [],
        color: { ...(item.color || {}) },
        skip: false,
        more: false,
      });
    }
    return ed.get(item.id);
  }
  let saveTimer = null;
  /** Keep the changes now (before leaving the upload); save() keeps them a moment after typing stops. */
  function writeEdits() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const b = S.batch;
    if (!b) return;
    const out = {};
    for (const it of b.items) {
      const e = ed.get(it.id);
      if (e) out[it.id] = { name: e.name, category: e.category, products: e.products, extra: e.extra, color: e.color, skip: e.skip };
    }
    try { localStorage.setItem(STORE + b.id, JSON.stringify(out)); } catch (err) { /* not kept */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeEdits, 300);
  }
  function restore(b) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE + b.id) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    for (const it of b.items) {
      const s = saved[it.id];
      if (!s || typeof s !== 'object') continue;
      const e = E(it);
      // (Kept before names went in their own language's box: the file name in both is split the same way.)
      if (s.name && typeof s.name === 'object') e.name = nameBoxes({ en: String(s.name.en || ''), ar: String(s.name.ar || '') });
      if (typeof s.category === 'string') e.category = s.category;
      if (Array.isArray(s.products)) e.products = s.products.filter((x) => typeof x === 'string');
      if (Array.isArray(s.extra)) e.extra = s.extra.filter((x) => typeof x === 'string');
      if (s.color && typeof s.color === 'object') e.color = { ...e.color, ...s.color };
      e.skip = Boolean(s.skip);
    }
  }
  function forget(id) {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { localStorage.removeItem(STORE + id); } catch (err) { /* nothing kept */ }
  }

  // ---------- Drawing ----------
  function render() {
    const box = root();
    if (!box) return;
    box.innerHTML = S.batch ? reviewHtml() : homeHtml();
    if (S.batch) observeStrips(box);
  }
  function msgHtml() {
    const m = S.msg;
    if (!m) return '<p class="up-msg" role="status"></p>';
    return `<p class="up-msg${m.bad ? ' bad' : ''}" role="${m.bad ? 'alert' : 'status'}">${esc(typeof m.text === 'function' ? m.text() : m.text)}${m.list ? ` <button type="button" class="btn btn-sm" data-up-list>${esc(t('up.seeList'))}</button>` : ''}</p>`;
  }
  function homeHtml() {
    return `<section class="card up-card" aria-labelledby="up-title">
        <h2 id="up-title">${esc(t('up.title'))}</h2>
        <p class="muted small up-help">${esc(t('up.help'))}</p>
        ${S.up ? progressHtml() : `<div class="up-drop" data-up-drop>
          <input type="file" id="up-file" class="up-sr" accept=".zip,application/zip,application/x-zip-compressed" tabindex="-1" aria-hidden="true">
          <button type="button" class="btn btn-primary shrink" data-up-choose>${esc(t('up.choose'))}</button>
          <span class="muted small up-drop-text">${esc(t('up.drop'))}</span>
        </div>`}
        ${msgHtml()}
        <div id="up-open-box">${openHtml()}</div>
      </section>`;
  }
  /** What the bar shows: the zip going up, then the server reading its pictures (counted for a big zip). */
  function phase(u) {
    if (u.batchId) {
      const frac = u.count ? Math.min(1, u.done / u.count) : 0;
      return { busy: false, frac, text: t('up.readingN', { done: POD.num(u.done), total: POD.num(u.count) }) };
    }
    if (u.reading) return { busy: true, frac: 0, text: t('up.reading') };
    const frac = u.total ? Math.min(1, u.loaded / u.total) : 0;
    return { busy: false, frac, text: t('up.sending', { name: iso(u.name), done: mb(u.loaded), total: mb(u.total), pct: pct(frac) }) };
  }
  function progressHtml() {
    const p = phase(S.up);
    return `<div class="up-progress">
        <div class="up-prog-text" id="up-prog-text" aria-live="polite">${esc(p.text)}</div>
        <div class="up-track${p.busy ? ' is-busy' : ''}" id="up-track" role="progressbar" aria-label="${esc(t('up.progress'))}" aria-valuemin="0" aria-valuemax="100"${p.busy ? ` aria-valuetext="${esc(p.text)}"` : ` aria-valuenow="${Math.round(p.frac * 100)}"`}><span class="up-fill" style="width:${(p.frac * 100).toFixed(1)}%"></span></div>
        <button type="button" class="btn btn-sm" data-up-cancel>${esc(t('up.cancel'))}</button>
      </div>`;
  }
  /** Just the numbers while the zip goes up or is read (no redraw: the Cancel button keeps its focus). */
  function paintProgress() {
    const u = S.up;
    const txt = $('up-prog-text');
    const track = $('up-track');
    const p = u && phase(u);
    if (!u || !txt || !track || track.classList.contains('is-busy') !== p.busy) return render();
    txt.textContent = p.text;
    track.setAttribute('aria-valuenow', String(Math.round(p.frac * 100)));
    track.firstElementChild.style.width = `${(p.frac * 100).toFixed(1)}%`;
  }
  const failText = (code) => t(has('up.fail.' + code) ? 'up.fail.' + code : 'up.fail.zipBad');
  /** A big zip being read on the server (it carries on if this page closes): follow it until it's ready. */
  function followReading(id) {
    const tick = async () => {
      if (!S.up || S.up.batchId !== id) return;
      try {
        const { batch: b } = await cfg.api(`${BASE}/${encodeURIComponent(id)}`);
        if (!S.up || S.up.batchId !== id) return;
        if (b.status === 'reading') {
          S.up.done = b.done || 0;
          S.up.count = b.total || S.up.count;
          paintProgress();
          setTimeout(tick, 1500);
          return;
        }
        S.up = null;
        S.batches = null;
        if (b.status === 'failed') {
          await cfg.api(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
          S.msg = { text: () => failText(b.code), bad: true };
          render();
          return;
        }
        S.msg = { text: () => POD.plural('up.ready', (b.items || []).length, { file: iso(b.file || id) }), bad: false };
        openBatch(b);
      } catch (err) {
        if (err.status === 401) return;
        if (err.status === 404) {
          S.up = null;
          S.msg = { text: () => t('up.gone'), bad: true };
          render();
          return;
        }
        setTimeout(tick, 4000); // (a network blip: try again)
      }
    };
    setTimeout(tick, 1200);
  }
  /** Cancel while the pictures are read: the upload is discarded. */
  async function stopReading() {
    const id = S.up && S.up.batchId;
    S.up = null;
    await cfg.api(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    S.msg = { text: () => t('up.cancelled'), bad: false };
    S.batches = null;
    render();
    loadList({ quiet: true }).catch(() => {});
  }
  function openHtml() {
    if (S.listErr) return `<div class="up-open"><p class="up-msg bad" role="alert">${esc(t('up.loadFail', { error: S.listErr }))} <button type="button" class="btn btn-sm" data-up-reload>${esc(t('up.retry'))}</button></p></div>`;
    const list = S.batches || [];
    if (!list.length) return '';
    return `<div class="up-open">
        <h3>${esc(t('up.openTitle'))}</h3>
        <p class="muted small">${esc(t('up.openHelp'))}</p>
        <div class="up-open-list">${list.map((b) => `<div class="up-open-row">
            <div class="up-open-info"><strong dir="auto">${esc(b.file || b.id)}</strong>
              <div class="muted small">${esc([b.status === 'reading' ? t('up.readingRow', { done: POD.num(b.done || 0), total: POD.num(b.total || 0) }) : b.status === 'failed' ? failText(b.code) : pics(Number(b.count) || 0), t('up.by', { who: who(b.by) }), when(b.createdAt)].filter(Boolean).join(POD.sep()))}</div></div>
            <div class="up-open-acts">
              ${b.status === 'failed' ? '' : `<button type="button" class="btn btn-sm btn-dark" data-up-open="${esc(b.id)}" ${S.busy || S.up ? 'disabled' : ''}>${esc(t('up.continue'))}</button>`}
              <button type="button" class="btn btn-sm btn-danger" data-up-discard="${esc(b.id)}" ${S.busy || S.up ? 'disabled' : ''} aria-label="${esc(`${t('up.discard')}: ${b.file || b.id}`)}">${esc(t('up.discard'))}</button>
            </div>
          </div>`).join('')}</div>
      </div>`;
  }

  // ---------- Checking an upload ----------
  function reviewHtml() {
    const b = S.batch;
    const back = POD.lang === 'ar' ? '→' : '←';
    return `<section class="card up-card up-rhead" aria-labelledby="up-title">
        <div class="up-rh-top">
          <button type="button" class="btn btn-sm" data-up-back><span aria-hidden="true">${back}</span> ${esc(t('up.back'))}</button>
          <h2 id="up-title">${esc(t('up.reviewTitle'))}</h2>
          <div class="muted small up-rh-file"><strong dir="auto">${esc(b.file || b.id)}</strong>${esc(POD.sep())}${esc([pics(b.items.length), t('up.by', { who: who(b.by) }), when(b.createdAt)].filter(Boolean).join(POD.sep()))}</div>
        </div>
        <p class="muted small up-help">${esc(t('up.reviewHelp'))}</p>
        <div class="up-rh-acts">
          <button type="button" class="btn btn-sm" data-up-pickall ${S.busy ? 'disabled' : ''}>${esc(t('up.pickAll'))}</button>
          <button type="button" class="btn btn-sm btn-danger up-danger" data-up-discard="${esc(b.id)}" ${S.busy ? 'disabled' : ''}>${esc(t('up.discardBatch'))}</button>
        </div>
        ${msgHtml()}
      </section>
      <div class="up-items">${b.items.map(itemHtml).join('')}</div>
      ${skippedHtml()}
      <div class="up-bar" id="up-bar">${barHtml()}</div>`;
  }
  function categoryOptions(e) {
    const cats = (cfg.categories && cfg.categories()) || [];
    const opts = cats.map((c) => `<option value="${esc(c.id)}"${c.id === e.category ? ' selected' : ''}>${esc(tr(c.name))}</option>`);
    if (!cats.some((c) => c.id === e.category)) opts.push(`<option value="${esc(e.category)}" selected>${esc(e.category === 'other' ? t('up.catOther') : e.category)}</option>`);
    return opts.join('');
  }
  function itemHtml(item) {
    const e = E(item);
    const id = esc(item.id);
    const name = tr(e.name) || e.name.en || e.name.ar || t('up.untitled');
    const meta = [item.w && item.h ? t('up.px', { w: item.w, h: item.h }) : '', t(item.transparent ? 'up.cutout' : 'up.full')].filter(Boolean).join(POD.sep());
    const err = errText(item.id);
    return `<article class="card up-item${e.skip ? ' is-skipped' : ''}${err ? ' is-bad' : ''}" data-up-item="${id}" aria-label="${esc(name)}">
        <div class="up-pic${item.transparent ? ' is-cut' : ''}${item.transparent && item.ink === 'light' ? ' is-light' : ''}"><img src="${esc(item.web)}" alt="" loading="lazy" decoding="async"></div>
        <div class="up-info">
          <div class="up-top">
            <bdi class="up-path" dir="ltr">${esc(item.path || '')}</bdi>
            ${e.skip ? `<span class="up-skip-tag">${esc(t('up.skipTag'))}</span>` : ''}
            <label class="check up-skip"><input type="checkbox" data-up-skip ${e.skip ? 'checked' : ''}> ${esc(t('up.skip'))}</label>
          </div>
          <div class="muted small up-meta">${esc(meta)}</div>
        </div>
        <div class="up-fields">
          <div class="field"><label for="up-ar-${id}">${esc(t('up.nameAr'))}</label><input type="text" id="up-ar-${id}" data-up-name="ar" dir="rtl" maxlength="60" value="${esc(e.name.ar)}"></div>
          <div class="field"><label for="up-en-${id}">${esc(t('up.nameEn'))}</label><input type="text" id="up-en-${id}" data-up-name="en" dir="ltr" maxlength="60" lang="en" value="${esc(e.name.en)}"${NAME_CODES.includes(itemErr.get(item.id)) ? ' aria-invalid="true"' : ''}></div>
          <div class="field up-cat"><label for="up-cat-${id}">${esc(t('up.category'))}</label><select id="up-cat-${id}" data-up-cat>${categoryOptions(e)}</select></div>
        </div>
        <fieldset class="up-prods" data-up-prods>${prodsHtml(item)}</fieldset>
        <div class="up-strip" data-up-strip>${stripHtml(item)}</div>
        <p class="up-err" role="alert">${esc(err)}</p>
      </article>`;
  }

  /**
   * How sharp the picture prints on a product it wasn't suggested for: filling 92% of the main print
   * area, as published designs are placed (the server gives this for the suggested ones).
   */
  function dpiOn(item, pid) {
    if (item.dpiFor && Number(item.dpiFor[pid])) return Number(item.dpiFor[pid]);
    const p = prod(pid);
    const side = p && p.sides && p.sides[0];
    const px = Array.isArray(item.printPx) ? item.printPx : [item.w, item.h];
    if (!side || !side.printWidthIn || !side.printArea || !(px[0] > 0) || !(px[1] > 0)) return 0;
    const wIn = side.printWidthIn;
    const hIn = side.printHeightIn || (wIn * side.printArea.h) / side.printArea.w;
    return Math.round(Math.max(px[0] / (0.92 * wIn), px[1] / (0.92 * hIn)));
  }
  /** Why a product is suggested, in a few words ("cut-out artwork · shape fits"). */
  function whyText(s, item, pid) {
    if (!s) {
      const dpi = dpiOn(item, pid);
      return [t('up.notSuggested'), dpi && dpi < 100 ? t('up.why.lowRes', { dpi: Math.round(dpi) }) : ''].filter(Boolean).join(POD.sep());
    }
    const words = (s.reasons || []).filter((r) => has('up.why.' + r)).map((r) => t('up.why.' + r, r === 'lowRes' ? { dpi: Math.round(Number(s.dpi) || 0) } : undefined));
    if (!s.ok && !(s.reasons || []).includes('lowRes')) words.unshift(t('up.warn'));
    return words.join(POD.sep());
  }
  function chipHtml(item, e, pid, s) {
    const on = e.products.includes(pid);
    const dpi = s ? 0 : dpiOn(item, pid);
    const warn = s ? !s.ok || (s.reasons || []).includes('inkClash') : Boolean(dpi && dpi < 100);
    const why = whyText(s, item, pid);
    return `<button type="button" class="up-chip${on ? ' on' : ''}${warn ? ' warn' : ''}${s ? '' : ' extra'}" data-up-prod="${esc(pid)}" aria-pressed="${on}">
        <span class="up-tick" aria-hidden="true">${on ? '✓' : ''}</span>
        <span class="up-chip-text"><span class="up-chip-name">${esc(prodName(pid))}</span>${why ? `<span class="up-why">${warn ? '⚠ ' : ''}${esc(why)}</span>` : ''}</span>
      </button>`;
  }
  function prodsHtml(item) {
    const e = E(item);
    const sugg = suggestions(item);
    const shown = sugg.filter((s, i) => e.more || i < SHOWN || e.products.includes(s.productId));
    const hidden = sugg.length - shown.length;
    const inSugg = new Set(sugg.map((s) => s.productId));
    // Products ticked by hand that aren't suggested, then any other product the shop sells.
    const extra = [...new Set([...e.extra, ...e.products.filter((p) => !inSugg.has(p))])];
    const listed = new Set([...inSugg, ...extra]);
    const cats = (catalog && catalog.categories) || [];
    const rest = products().filter((p) => !listed.has(p.id));
    const groups = cats.map((c) => [c, rest.filter((p) => p.category === c.id)]).filter(([, l]) => l.length);
    const loose = rest.filter((p) => !cats.some((c) => c.id === p.category));
    const opt = (p) => `<option value="${esc(p.id)}">${esc(tr(p.name))}</option>`;
    const add = rest.length ? `<select class="up-add" data-up-add aria-label="${esc(t('up.addHint'))}">
        <option value="">${esc(t('up.addProduct'))}</option>
        ${groups.map(([c, l]) => `<optgroup label="${esc(tr(c.name))}">${l.map(opt).join('')}</optgroup>`).join('')}${loose.map(opt).join('')}
      </select>` : '';
    const n = e.products.length;
    return `<legend>${esc(t('up.products'))} <span class="muted">${esc(POD.plural('up.nPicked', n))}</span></legend>
      <div class="up-chips">
        ${shown.map((s) => chipHtml(item, e, s.productId, s)).join('')}
        ${extra.map((pid) => chipHtml(item, e, pid, null)).join('')}
        ${hidden > 0 || (e.more && sugg.length > SHOWN) ? `<button type="button" class="up-more" data-up-more aria-expanded="${e.more}">${esc(e.more ? t('up.lessSugg') : t('up.moreSugg', { n: hidden }))}</button>` : ''}
        ${add}
      </div>
      ${n || e.skip ? '' : `<p class="up-noprod">${esc(t('up.noProducts'))}</p>`}`;
  }

  // ---------- Previews (the shop's renderer, one at a time, only for designs on screen) ----------
  const picMap = new Map(); // key -> promise of { thumb, crop, full } or null
  const picDone = new Map(); // the same once drawn
  const blobUrls = [];
  const colourOf = (item, pid) => {
    const p = prod(pid);
    if (!p) return null;
    const want = E(item).color[pid];
    return p.colors.find((c) => c.id === want && POD.canPick(c)) || POD.firstPick(p.colors);
  };
  const picKey = (item, pid) => {
    const c = colourOf(item, pid);
    return `${item.id}|${pid}|${c ? c.id : ''}`;
  };
  const shrink = (cv, size) => {
    const k = Math.min(1, size / Math.max(cv.width, cv.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cv.width * k));
    out.height = Math.max(1, Math.round(cv.height * k));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, out.width, out.height);
    return out;
  };
  const blobUrl = (cv) => new Promise((resolve, reject) => cv.toBlob((b) => {
    if (!b) return reject(new Error('export'));
    const u = URL.createObjectURL(b);
    blobUrls.push(u);
    resolve(u);
  }, 'image/webp', 0.86));
  /** The design object the shop's renderer takes: the picture alone, fitted in the print area. */
  const designOf = (item, product, color) => ({
    id: 'up-' + item.id,
    kind: 'template',
    items: [{ kind: 'image', src: item.web, fit: 0.92, x: 0.5, y: 0.5, w: 0.92 }],
    aspect: 0.75,
    product: product.id,
    color: color.id,
  });
  async function draw(item, pid) {
    await cfg.renderer();
    if (!catalog) catalog = await POD.loadCatalog();
    const product = prod(pid);
    const color = colourOf(item, pid);
    if (!product || !color) return null;
    const st = await POD_RENDER.stage(designOf(item, product, color), product, product.sides[0], color);
    try {
      if (!st.objects.length) return null; // the picture didn't load
      const a = st.R.trim;
      const crop = POD_RENDER.picture(st, 420 / Math.min(POD_RENDER.W, POD_RENDER.H, Math.max(a.w, a.h) * 1.15), 1.15);
      const full = await POD_RENDER.productPicture(st, 0.9);
      return { thumb: await blobUrl(shrink(full, 224)), crop: await blobUrl(crop), full: await blobUrl(full) };
    } finally {
      st.canvas.dispose();
    }
  }
  function pic(item, pid) {
    const key = picKey(item, pid);
    if (!picMap.has(key)) {
      picMap.set(key, draw(item, pid).catch(() => null).then((p) => {
        picDone.set(key, p);
        return p;
      }));
    }
    return picMap.get(key);
  }
  function clearPics() {
    picMap.clear();
    picDone.clear();
    want.clear();
    while (blobUrls.length) URL.revokeObjectURL(blobUrls.pop());
  }
  function stripHtml(item) {
    const e = E(item);
    if (!e.products.length) return `<p class="muted small up-strip-none">${esc(t('up.previewNone'))}</p>`;
    const name = tr(e.name) || t('up.untitled');
    const shots = e.products.slice(0, STRIP).map((pid) => {
      const key = picKey(item, pid);
      const p = picDone.get(key);
      const inner = !picDone.has(key) ? '<span class="up-wait" aria-hidden="true"></span>'
        : p ? `<img src="${esc(p.thumb)}" alt="">` : `<span class="up-nopic">${esc(t('up.previewFail'))}</span>`;
      return `<button type="button" class="up-shot" data-up-view="${esc(pid)}" aria-label="${esc(t('up.bigger', { name, product: prodName(pid) }))}">
          <span class="up-shot-pic">${inner}</span><span class="up-shot-name">${esc(prodName(pid))}</span></button>`;
    });
    const more = e.products.length - STRIP;
    if (more > 0) {
      shots.push(`<button type="button" class="up-shot up-shot-more" data-up-view="${esc(e.products[STRIP])}" aria-label="${esc(t('up.bigger', { name, product: prodName(e.products[STRIP]) }))}">
          <span class="up-shot-pic">${esc(t('up.previewMore', { n: more }))}</span><span class="up-shot-name">${esc(t('up.otherProducts'))}</span></button>`);
    }
    return shots.join('');
  }
  const needsPics = (item) => E(item).products.slice(0, STRIP).some((pid) => !picDone.has(picKey(item, pid)));
  const want = new Set();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const card = en.target.closest('[data-up-item]');
      if (!card) continue;
      if (en.isIntersecting) want.add(card.dataset.upItem);
      else want.delete(card.dataset.upItem);
    }
    pump();
  }, { rootMargin: '300px 0px' }) : null;
  function observeStrips(box) {
    if (io) io.disconnect();
    box.querySelectorAll('[data-up-item]').forEach((card) => {
      const item = itemById(card.dataset.upItem);
      if (item && needsPics(item)) watch(card);
    });
  }
  function watch(card) {
    const strip = card.querySelector('[data-up-strip]');
    if (!strip) return;
    if (io) {
      io.unobserve(strip);
      io.observe(strip);
    } else {
      want.add(card.dataset.upItem);
      pump();
    }
  }
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (want.size && S.batch) {
        const id = want.values().next().value;
        want.delete(id);
        const item = itemById(id);
        if (!item) continue;
        for (const pid of E(item).products.slice(0, STRIP)) {
          if (picDone.has(picKey(item, pid))) continue;
          await pic(item, pid);
          await new Promise((r) => setTimeout(r, 0)); // typing and clicks go in between
        }
        paintStrip(id);
      }
    } finally {
      pumping = false;
    }
  }

  // ---------- Parts of a card redrawn after a change ----------
  const itemById = (id) => (S.batch ? S.batch.items.find((i) => i.id === id) : null);
  const cardOf = (id) => root() && root().querySelector(`[data-up-item="${CSS.escape(id)}"]`);
  function paintStrip(id) {
    const item = itemById(id);
    const card = cardOf(id);
    if (!item || !card) return;
    const strip = card.querySelector('[data-up-strip]');
    const html = stripHtml(item);
    if (strip.__html !== html) {
      strip.innerHTML = html;
      strip.__html = html;
    }
    if (needsPics(item)) watch(card);
  }
  /** Redraw a card's products, keeping the focus on the same control. */
  function paintProds(id, focus) {
    const item = itemById(id);
    const card = cardOf(id);
    if (!item || !card) return;
    const box = card.querySelector('[data-up-prods]');
    box.innerHTML = prodsHtml(item);
    if (focus) {
      const el = box.querySelector(focus) || box.querySelector('[data-up-add]') || box.querySelector('[data-up-prod]');
      if (el) el.focus();
    }
  }
  function paintCardState(id) {
    const item = itemById(id);
    const card = cardOf(id);
    if (!item || !card) return;
    const e = E(item);
    const err = errText(id);
    card.classList.toggle('is-skipped', e.skip);
    card.classList.toggle('is-bad', Boolean(err));
    card.querySelector('.up-err').textContent = err;
    const enBox = card.querySelector('[data-up-name="en"]');
    if (enBox) {
      if (NAME_CODES.includes(itemErr.get(id))) enBox.setAttribute('aria-invalid', 'true');
      else enBox.removeAttribute('aria-invalid');
    }
    const tag = card.querySelector('.up-skip-tag');
    if (e.skip && !tag) card.querySelector('.up-skip').insertAdjacentHTML('beforebegin', `<span class="up-skip-tag">${esc(t('up.skipTag'))}</span>`);
    if (!e.skip && tag) tag.remove();
  }
  function barHtml() {
    const items = S.batch.items;
    const go = items.filter((i) => !E(i).skip).length;
    const off = items.length - go;
    return `<span class="up-bar-what" aria-live="polite">${esc(off ? t('up.summary', { what: designs(go), skipped: designs(off) }) : t('up.summaryAll', { what: designs(go) }))}</span>
      <button type="button" class="btn btn-primary" data-up-publish ${S.busy || !go ? 'disabled' : ''}>${esc(S.busy ? t('up.publishing') : t('up.publish', { n: go }))}</button>`;
  }
  function paintBar() {
    const bar = $('up-bar');
    if (bar && S.batch) bar.innerHTML = barHtml();
  }
  /** The long side a picture needs (MIN_SIDE in src/design-upload.js). */
  const MIN_SIDE = 600;
  /**
   * Why a file of the zip wasn't used. Too small: its size, and when that was the drawing inside a bigger picture (the
   * empty margins round it left out), the picture's too (QA 25 Nov: a 2400 px picture was called "under 600 px").
   */
  function skipWhy(s) {
    const px = (v) => Number.isInteger(v) && v > 0;
    if (s.reason === 'tooSmall' && px(s.w) && px(s.h)) {
      const size = { w: s.w, h: s.h, min: MIN_SIDE };
      return px(s.pictureW) && px(s.pictureH) ? t('up.reason.tooSmallInside', { ...size, pw: s.pictureW, ph: s.pictureH }) : t('up.reason.tooSmallSize', size);
    }
    return t(has('up.reason.' + s.reason) ? 'up.reason.' + s.reason : 'up.reason.other', { min: MIN_SIDE });
  }
  function skippedHtml() {
    const list = (S.batch && S.batch.skipped) || [];
    if (!list.length) return '';
    return `<details class="card up-skipped">
        <summary>${esc(t('up.skippedFiles', { n: list.length }))}</summary>
        <ul>${list.map((s) => `<li><bdi dir="ltr">${esc(s.path || '')}</bdi>: ${esc(skipWhy(s))}</li>`).join('')}</ul>
      </details>`;
  }
  function say(text, bad, list) {
    S.msg = text ? { text, bad: Boolean(bad), list: Boolean(list) } : null;
    const box = root();
    const old = box && box.querySelector('.up-msg');
    if (old && !old.closest('.up-open')) old.outerHTML = msgHtml();
    else render();
  }

  // ---------- Server ----------
  async function loadList({ quiet = false } = {}) {
    try {
      const r = await cfg.api(BASE);
      const next = Array.isArray(r && r.batches) ? r.batches : [];
      const changed = JSON.stringify(next) !== JSON.stringify(S.batches) || S.listErr;
      S.batches = next;
      S.listErr = '';
      if (changed || !quiet) paintList(quiet);
    } catch (err) {
      if (err.status === 401 || err.ownerOnly) throw err;
      S.listErr = err.message;
      paintList(quiet);
    }
  }
  /** Just the list of open uploads (the 15-second refresh doesn't redraw under the admin's hands). */
  function paintList(quiet) {
    if (S.batch) return;
    const el = $('up-open-box');
    if (!el) return render();
    if (quiet && el.contains(document.activeElement)) return;
    el.innerHTML = openHtml();
  }
  async function openBatch(b) {
    writeEdits();
    if (S.batch && S.batch.id !== b.id) clearPics();
    ed.clear();
    itemErr.clear();
    S.batch = b;
    S.batch.items = Array.isArray(b.items) ? b.items : [];
    restore(S.batch);
    if (!catalog) catalog = await POD.loadCatalog().catch(() => null);
    render();
    const box = root();
    if (box) {
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const h = box.querySelector('#up-title');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
  }
  async function continueBatch(id, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await cfg.api(`${BASE}/${encodeURIComponent(id)}`);
      S.msg = null;
      if (r.batch.status === 'reading') {
        S.up = { batchId: id, name: r.batch.file || id, done: r.batch.done || 0, count: r.batch.total || 0, reading: true };
        render();
        followReading(id);
        return;
      }
      await openBatch(r.batch);
    } catch (err) {
      if (btn) btn.disabled = false;
      if (err.status === 401) return;
      say(err.status === 404 ? () => t('up.gone') : err.message, true);
      if (err.status === 404) loadList();
    }
  }
  async function discard(id, btn) {
    const b = S.batch && S.batch.id === id ? S.batch : (S.batches || []).find((x) => x.id === id);
    const file = (b && (b.file || b.id)) || id;
    if (!confirm(t('up.confirmDiscard', { file: iso(file) }))) return;
    S.busy = true;
    if (btn) btn.disabled = true;
    if (S.batch) paintBar();
    try {
      await cfg.api(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      S.busy = false;
      done(id, () => t('up.discarded', { file: iso(file) }));
    } catch (err) {
      S.busy = false;
      if (btn) btn.disabled = false;
      if (S.batch) paintBar();
      if (err.status === 404) done(id, () => t('up.gone'));
      else if (err.status !== 401) POD.toast(err.message, 'error');
    }
  }
  /** An upload is finished with (discarded, gone, or all published): back to the uploader. */
  function done(id, text, list) {
    forget(id);
    if (S.batch && S.batch.id === id) {
      S.batch = null;
      ed.clear();
      itemErr.clear();
      clearPics();
    }
    if (S.batches) S.batches = S.batches.filter((x) => x.id !== id);
    S.msg = text ? { text, bad: false, list: Boolean(list) } : null;
    render();
    const choose = root() && root().querySelector('[data-up-choose]');
    if (choose) choose.focus({ preventScroll: true });
    loadList({ quiet: true }).catch(() => {});
  }

  /** Why a design can't be published, in the page's language ('' when it can). */
  function errText(id) {
    const code = itemErr.get(id);
    if (!code) return '';
    return code === 'noProducts' ? t('up.noProducts') : t(has('up.code.' + code) ? 'up.code.' + code : 'up.code.other');
  }
  async function publish() {
    const b = S.batch;
    const list = b.items.filter((i) => !E(i).skip);
    if (!list.length) return say(() => t('up.nothing'), true);
    itemErr.clear();
    // Every design going in the shop needs a product (or "Don't publish").
    const noProd = list.filter((i) => !E(i).products.length);
    if (noProd.length) {
      noProd.forEach((i) => itemErr.set(i.id, 'noProducts'));
      b.items.forEach((i) => paintCardState(i.id));
      say(() => t('up.needProducts', { what: designs(noProd.length) }), true);
      const first = cardOf(noProd[0].id);
      if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const el = first.querySelector('[data-up-prod], [data-up-add]');
        if (el) el.focus({ preventScroll: true });
      }
      return;
    }
    // The English shop shows the English name: it is needed, in English letters (an Arabic file name only
    // fills the Arabic box).
    const noName = list.filter((i) => nameProblem(i));
    if (noName.length) {
      noName.forEach((i) => itemErr.set(i.id, nameProblem(i)));
      b.items.forEach((i) => paintCardState(i.id));
      say(() => t('up.needNameEn', { what: designs(noName.length) }), true);
      const first = cardOf(noName[0].id);
      if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const el = first.querySelector('[data-up-name="en"]');
        if (el) el.focus({ preventScroll: true });
      }
      return;
    }
    S.busy = true;
    paintBar();
    try {
      const body = {
        items: list.map((i) => {
          const e = E(i);
          const color = {};
          for (const pid of e.products) {
            const c = colourOf(i, pid);
            if (c) color[pid] = c.id;
            else if (e.color[pid]) color[pid] = e.color[pid];
          }
          // (A name emptied in both languages keeps the one made from the file name, in its own language.)
          return { id: i.id, name: sentName(i), category: e.category, products: e.products.slice(), color };
        }),
      };
      const r = await cfg.api(`${BASE}/${encodeURIComponent(b.id)}/publish`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      const published = new Set(((r && r.published) || []).map((p) => p.itemId));
      for (const s of (r && r.skipped) || []) itemErr.set(s.itemId, String(s.code || ''));
      if (published.size && cfg.published) cfg.published();
      b.items = b.items.filter((i) => !published.has(i.id));
      for (const id of published) ed.delete(id);
      save();
      const failed = ((r && r.skipped) || []).length;
      const left = b.items.filter((i) => E(i).skip).length;
      if (!b.items.length) {
        S.busy = false;
        return done(b.id, () => `${t('up.allDone', { file: iso(b.file || b.id) })} ${POD.plural('up.published', published.size)}`, true);
      }
      S.msg = {
        text: () => [published.size ? POD.plural('up.published', published.size) : '', failed ? POD.plural('up.notPublished', failed) : '', left ? POD.plural('up.leftOver', left) : ''].filter(Boolean).join(' '),
        bad: Boolean(failed),
        list: Boolean(published.size),
      };
      S.busy = false;
      render();
      if (published.size) POD.toast(POD.plural('up.published', published.size));
      const h = root().querySelector('#up-title');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); root().scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    } catch (err) {
      S.busy = false;
      paintBar();
      if (err.status === 401) return;
      // A staff member's designs wait for an owner's approval: said in plain words, the review stays as it is.
      if (err.pending) {
        // The designs that can't be published are marked now, as for a direct publish.
        const no = err.skipped || [];
        for (const s of no) itemErr.set(s.itemId, String(s.code || ''));
        if (no.length) render();
        return say(() => [AdminRoles.pendingText(err.approval), no.length ? POD.plural('up.notPublished', no.length) : ''].filter(Boolean).join(' '), Boolean(no.length));
      }
      if (err.status === 404) return done(b.id, () => t('up.gone'));
      say(err.message, true);
    }
  }

  // ---------- Uploading the zip ----------
  /** The server's answer once the zip is up: being read (follow it), read (check it), or refused. */
  function landed(status, body, name, finish) {
    if (status === 401) {
      S.up = null;
      render();
      cfg.signOut(body && body.error);
      return;
    }
    // Sent for an owner's approval (HTTP 202 { pending, approval }): said once, the same as every admin change.
    if (window.AdminRoles && AdminRoles.isPending(body)) {
      S.up = null;
      AdminRoles.announce(AdminRoles.pendingError(body.approval));
      S.msg = { text: () => AdminRoles.pendingText(body.approval), bad: false };
      render();
      return;
    }
    if (status === 202 && body && body.batch) {
      const b = body.batch;
      S.up = { batchId: b.id, name, done: b.done || 0, count: b.total || 0, reading: true };
      paintProgress();
      followReading(b.id);
      return;
    }
    if (status >= 200 && status < 300 && body && body.batch) {
      S.up = null;
      S.batches = null;
      const b = body.batch;
      S.msg = { text: () => POD.plural('up.ready', (b.items || []).length, { file: iso(b.file || name) }), bad: false };
      openBatch(b);
      return;
    }
    finish((body && body.error) || (() => t(status ? 'up.failed' : 'msg.network', { status })));
  }
  const upFinish = (text) => {
    S.up = null;
    if (text) S.msg = { text, bad: true };
    render();
    const choose = root() && root().querySelector('[data-up-choose]');
    if (choose && text) choose.focus();
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** One request of a piece-by-piece upload: { status, body } (status 0: no connection, -1: cancelled). */
  function send(method, url, body, onProgress) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      if (S.up) S.up.xhr = xhr;
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.token());
      xhr.setRequestHeader('x-lang', POD.lang);
      if (body) xhr.setRequestHeader('Content-Type', body instanceof Blob ? 'application/octet-stream' : 'application/json');
      if (onProgress) xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded); });
      xhr.addEventListener('load', () => {
        let b = null;
        try { b = JSON.parse(xhr.responseText); } catch (e) { b = null; }
        resolve({ status: xhr.status, body: b });
      });
      xhr.addEventListener('error', () => resolve({ status: 0, body: null }));
      xhr.addEventListener('abort', () => resolve({ status: -1, body: null }));
      xhr.send(body instanceof Blob ? body : body ? JSON.stringify(body) : null);
    });
  }
  /**
   * A big zip goes up in pieces, each its own short request (the hosting stops any request after
   * 2 minutes); a piece lost to a dropped connection is sent again, from where the server says.
   */
  async function sendInPieces(file) {
    S.up = { name: file.name, loaded: 0, total: file.size, reading: false, xhr: null, pieces: true };
    S.msg = null;
    render();
    const mine = S.up;
    let r = await send('POST', `${BASE}/start`, { size: file.size, name: file.name });
    if (S.up !== mine) return; // cancelled
    if (r.status !== 201 || !r.body || !r.body.id) return landed(r.status, r.body, file.name, upFinish);
    const id = r.body.id;
    const piece = Number(r.body.piece) || 8 * 2 ** 20;
    mine.uploadId = id;
    let at = 0;
    let tries = 0;
    while (at < file.size) {
      const from = at;
      r = await send('PUT', `${BASE}/${encodeURIComponent(id)}/piece?at=${at}`, file.slice(at, Math.min(file.size, at + piece)), (n) => {
        if (S.up !== mine) return;
        mine.loaded = from + n;
        paintProgress();
      });
      if (S.up !== mine) return; // cancelled
      if ((r.status === 200 || r.status === 409) && r.body && Number.isInteger(r.body.received)) {
        at = r.body.received;
        tries = 0;
        mine.loaded = at;
        paintProgress();
        continue;
      }
      if ((r.status === 0 || r.status >= 500) && tries < 6) {
        tries++;
        await wait(1500 * tries); // (the connection dropped: the same piece again)
        if (S.up !== mine) return;
        continue;
      }
      return landed(r.status, r.body, file.name, upFinish);
    }
    mine.loaded = file.size;
    mine.reading = true;
    paintProgress();
    for (tries = 0; ; tries++) {
      r = await send('POST', `${BASE}/${encodeURIComponent(id)}/finish`);
      if (S.up !== mine) return;
      if (r.status !== 0 || tries >= 4) break;
      await wait(2000);
    }
    landed(r.status, r.body, file.name, upFinish);
  }
  /** Cancel while the pieces go up: the half-sent upload goes. */
  function stopPieces() {
    const u = S.up;
    S.up = null;
    if (u.xhr) u.xhr.abort();
    if (u.uploadId) cfg.api(`${BASE}/${encodeURIComponent(u.uploadId)}`, { method: 'DELETE' }).catch(() => {});
    S.msg = { text: () => t('up.cancelled'), bad: false };
    render();
    const choose = root() && root().querySelector('[data-up-choose]');
    if (choose) choose.focus();
  }
  function startUpload(file) {
    if (!file || S.up || S.batch) return;
    if (!/\.zip$/i.test(file.name) && !/zip/i.test(file.type || '')) return say(() => t('up.notZip', { name: iso(file.name) }), true);
    if (file.size > MAX_BYTES) return say(() => t('up.tooBig', { size: mb(file.size) }), true);
    if (file.size > PIECES_FROM) return void sendInPieces(file);
    const xhr = new XMLHttpRequest();
    S.up = { xhr, name: file.name, loaded: 0, total: file.size, reading: false };
    S.msg = null;
    xhr.open('POST', BASE);
    xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.token());
    xhr.setRequestHeader('x-lang', POD.lang);
    xhr.setRequestHeader('Content-Type', 'application/zip');
    // The zip's name for the list of uploads (a header only carries plain ASCII: anything else is URL-encoded).
    xhr.setRequestHeader('x-file-name', /^[\x20-\x24\x26-\x7e]*$/.test(file.name) ? file.name : encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (e) => {
      if (!S.up || S.up.xhr !== xhr) return;
      if (e.lengthComputable) {
        S.up.loaded = e.loaded;
        S.up.total = e.total;
      }
      paintProgress();
    });
    xhr.upload.addEventListener('load', () => {
      if (!S.up || S.up.xhr !== xhr) return;
      S.up.loaded = S.up.total;
      S.up.reading = true;
      paintProgress();
    });
    xhr.addEventListener('load', () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
      landed(xhr.status, body, file.name, upFinish);
    });
    xhr.addEventListener('error', () => upFinish(() => t('msg.network')));
    xhr.addEventListener('abort', () => {
      S.up = null;
      S.msg = { text: () => t('up.cancelled'), bad: false };
      render();
      const choose = root() && root().querySelector('[data-up-choose]');
      if (choose) choose.focus();
    });
    xhr.send(file);
    render();
  }

  // ---------- Bigger preview ----------
  let viewer = null;
  const V = { item: '', pid: '' };
  function drawViewer() {
    const item = itemById(V.item);
    if (!viewer || !item) return;
    const e = E(item);
    const p = prod(V.pid);
    const name = tr(e.name) || t('up.untitled');
    const key = picKey(item, V.pid);
    const d = picDone.get(key);
    const colours = p ? p.colors.filter((c) => POD.canPick(c)) : [];
    const cur = colourOf(item, V.pid);
    const title = t('up.on', { name: iso(name), product: iso(prodName(V.pid)) });
    viewer.setAttribute('aria-label', title);
    viewer.innerHTML = `<div class="rd-viewer-box">
        <div class="rd-viewer-head"><strong>${esc(title)}</strong><button type="button" class="btn btn-sm" data-up-close>${esc(t('up.close'))}</button></div>
        ${e.products.length > 1 ? `<div class="up-vprods" role="group" aria-label="${esc(t('up.products'))}">${e.products.map((pid) => `<button type="button" class="chip${pid === V.pid ? ' active' : ''}" data-up-vprod="${esc(pid)}" aria-pressed="${pid === V.pid}">${esc(prodName(pid))}</button>`).join('')}</div>` : ''}
        <div class="rd-viewer-pics${d ? ' two' : ''}">${d ? [d.crop, d.full].map((u) => `<img src="${esc(u)}" alt="">`).join('') : `<p class="muted">${esc(t(picDone.has(key) ? 'up.previewFail' : 'rd.loading'))}</p>`}</div>
        ${colours.length > 1 ? `<div class="up-colours" role="group" aria-label="${esc(t('up.colour'))}"><span>${esc(t('up.colour'))}</span>${colours.map((c) => `<button type="button" class="up-swatch" data-up-colour="${esc(c.id)}" style="background:${esc(c.hex)}" aria-pressed="${Boolean(cur && cur.id === c.id)}" aria-label="${esc(tr(c.name))}" title="${esc(tr(c.name))}"></button>`).join('')}</div>` : ''}
      </div>`;
  }
  async function showViewer(itemId, pid, focusSel) {
    const item = itemById(itemId);
    if (!item) return;
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'rd-viewer up-viewer';
      viewer.addEventListener('click', (e) => {
        if (e.target === viewer || e.target.closest('[data-up-close]')) return viewer.close();
        const vp = e.target.closest('[data-up-vprod]');
        if (vp) return void showViewer(V.item, vp.dataset.upVprod, `[data-up-vprod="${CSS.escape(vp.dataset.upVprod)}"]`);
        const sw = e.target.closest('[data-up-colour]');
        if (sw) {
          const it = itemById(V.item);
          if (!it) return;
          E(it).color[V.pid] = sw.dataset.upColour;
          save();
          paintStrip(it.id);
          showViewer(V.item, V.pid, `[data-up-colour="${CSS.escape(sw.dataset.upColour)}"]`);
        }
      });
      document.body.appendChild(viewer);
    }
    V.item = itemId;
    V.pid = pid;
    const refocus = () => {
      const el = focusSel && viewer.querySelector(focusSel);
      if (el) el.focus();
    };
    drawViewer();
    if (!viewer.open) viewer.showModal();
    refocus();
    const key = picKey(item, pid);
    if (!picDone.has(key)) {
      await pic(item, pid);
      if (viewer.open && V.item === itemId && V.pid === pid) {
        drawViewer();
        refocus();
      }
      paintStrip(itemId);
    }
  }

  // ---------- Events ----------
  function bind() {
    const box = root();
    if (!box || box.__bound) return;
    box.__bound = true;
    window.addEventListener('pagehide', writeEdits); // (typed just before closing the page)
    box.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el || el.disabled) return;
      const card = el.closest('[data-up-item]');
      const item = card && itemById(card.dataset.upItem);
      if (el.matches('[data-up-choose]')) return void ($('up-file') && $('up-file').click());
      if (el.matches('[data-up-cancel]')) return void (S.up && (S.up.batchId ? stopReading() : S.up.pieces ? stopPieces() : S.up.xhr.abort()));
      if (el.matches('[data-up-reload]')) return void loadList().catch(() => {});
      if (el.matches('[data-up-open]')) return void continueBatch(el.dataset.upOpen, el);
      if (el.matches('[data-up-discard]')) return void discard(el.dataset.upDiscard, el);
      if (el.matches('[data-up-list]')) {
        const list = $('lib-list');
        if (list) list.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (el.matches('[data-up-back]')) {
        writeEdits();
        S.batch = null;
        S.msg = null;
        ed.clear();
        itemErr.clear();
        clearPics();
        render();
        loadList({ quiet: true }).catch(() => {});
        const h = root().querySelector('[data-up-choose]');
        if (h) h.focus();
        return;
      }
      if (el.matches('[data-up-pickall]')) return void pickAll();
      if (el.matches('[data-up-publish]')) return void publish();
      if (!item) return;
      const ie = E(item);
      if (el.matches('[data-up-prod]')) {
        const pid = el.dataset.upProd;
        const on = !ie.products.includes(pid);
        ie.products = on ? [...ie.products, pid] : ie.products.filter((x) => x !== pid);
        if (on && !sugFor(item, pid) && !ie.extra.includes(pid)) ie.extra.push(pid);
        if (on && itemErr.get(item.id) === 'noProducts') itemErr.delete(item.id);
        save();
        paintProds(item.id, `[data-up-prod="${CSS.escape(pid)}"]`);
        paintStrip(item.id);
        paintCardState(item.id);
        return;
      }
      if (el.matches('[data-up-more]')) {
        ie.more = !ie.more;
        paintProds(item.id, '[data-up-more]');
        return;
      }
      if (el.matches('[data-up-view]')) showViewer(item.id, el.dataset.upView);
    });
    box.addEventListener('change', (e) => {
      const el = e.target;
      if (el.id === 'up-file') {
        const f = el.files && el.files[0];
        el.value = '';
        if (f) startUpload(f);
        return;
      }
      const card = el.closest('[data-up-item]');
      const item = card && itemById(card.dataset.upItem);
      if (!item) return;
      const ie = E(item);
      if (el.matches('[data-up-skip]')) {
        ie.skip = el.checked;
        itemErr.delete(item.id);
        save();
        paintCardState(item.id);
        paintProds(item.id);
        paintBar();
      } else if (el.matches('[data-up-cat]')) {
        ie.category = el.value;
        save();
      } else if (el.matches('[data-up-add]') && el.value) {
        const pid = el.value;
        if (!ie.extra.includes(pid)) ie.extra.push(pid);
        if (!ie.products.includes(pid)) ie.products.push(pid);
        if (itemErr.get(item.id) === 'noProducts') itemErr.delete(item.id);
        save();
        paintProds(item.id, '[data-up-add]');
        paintStrip(item.id);
        paintCardState(item.id);
      }
    });
    box.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches('[data-up-name]')) return;
      const item = itemById(el.closest('[data-up-item]').dataset.upItem);
      if (!item) return;
      E(item).name[el.dataset.upName] = el.value;
      save();
      // Arabic letters typed in the English name: said at once on the card. (An empty English name only when
      // publishing; a name message from then goes as soon as the name is right.)
      const code = itemErr.get(item.id);
      if (!code || NAME_CODES.includes(code)) {
        const p = nameProblem(item);
        if (p === 'nameEnArabic' || (p && code)) itemErr.set(item.id, p);
        else itemErr.delete(item.id);
        if (itemErr.get(item.id) !== code) paintCardState(item.id);
      }
    });
    // Dropping a zip anywhere on the uploader.
    const dropZone = () => box.querySelector('[data-up-drop]');
    const canDrop = (e) => !S.batch && !S.up && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    box.addEventListener('dragenter', (e) => {
      if (!canDrop(e)) return;
      e.preventDefault();
      S.drag += 1;
      const z = dropZone();
      if (z) {
        z.classList.add('is-drag');
        z.querySelector('.up-drop-text').textContent = t('up.dropNow');
      }
    });
    box.addEventListener('dragover', (e) => {
      if (!canDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    const unDrag = (all) => {
      S.drag = all ? 0 : Math.max(0, S.drag - 1);
      const z = dropZone();
      if (z && !S.drag) {
        z.classList.remove('is-drag');
        z.querySelector('.up-drop-text').textContent = t('up.drop');
      }
    };
    box.addEventListener('dragleave', (e) => { if (canDrop(e)) unDrag(false); });
    box.addEventListener('drop', (e) => {
      if (!canDrop(e)) return;
      e.preventDefault();
      unDrag(true);
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) startUpload(f);
    });
  }

  function pickAll() {
    const items = S.batch.items;
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const changed = items.filter((i) => !same(E(i).products, i.picked || []));
    if (!changed.length) return say(() => t('up.pickedAll'));
    if (!confirm(t('up.confirmPickAll', { what: designs(changed.length) }))) return;
    for (const i of items) {
      const e = E(i);
      e.products = (i.picked || []).slice();
      e.extra = [];
      if (itemErr.get(i.id) === 'noProducts') itemErr.delete(i.id);
    }
    save();
    S.msg = { text: () => t('up.pickedAll'), bad: false };
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    const btn = root().querySelector('[data-up-pickall]');
    if (btn) btn.focus({ preventScroll: true });
  }

  return {
    init(c) {
      cfg = c;
    },
    /** The Ready designs tab opened (or its 15-second refresh): the uploads not finished yet. */
    async show({ auto = false } = {}) {
      bind();
      if (!catalog) POD.loadCatalog().then((c) => { catalog = c; }).catch(() => {});
      const box = root();
      if (!box) return;
      if (S.batch || S.up) {
        if (!box.firstElementChild) render();
        return;
      }
      if (!box.firstElementChild) render();
      await loadList({ quiet: auto });
    },
    onLang() {
      const box = root();
      if (!box || !box.firstElementChild) return;
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      if (viewer && viewer.open) drawViewer();
    },
    /** Signed out: nothing of the last person's work stays on screen. */
    reset() {
      clearTimeout(saveTimer);
      if (S.up) S.up.xhr.abort();
      S.up = null;
      S.batch = null;
      S.batches = null;
      S.msg = null;
      ed.clear();
      itemErr.clear();
      clearPics();
      if (viewer && viewer.open) viewer.close();
      const box = root();
      if (box) box.innerHTML = '';
    },
  };
})();
