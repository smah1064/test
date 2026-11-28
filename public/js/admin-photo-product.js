/*
 * Admin → Products → New product → "From measurements (cups, tumblers)" ("New product from photo", slice 1), and the
 * Measurements section on a drinkware product's edit page.
 *
 * The form takes a round cup's typed measurements in mm (kind, handle, height, top and bottom diameters, print band,
 * material; seam gap and safe margin under "More settings"), draws the cup from the side and its flat print template
 * (a fan when tapered, a rectangle when straight; public/js/drinkware-geom.js does the maths), and creates a hidden
 * catalogue product (POST /api/admin/photo-products/from-measurements) or re-measures one
 * (PUT /api/admin/catalog/:id/drinkware). The server checks everything again; the checks here only say early what it
 * would refuse. Digits may be typed with an Arabic or Persian keyboard, and "12,5" / "١٢٫٥" are 12.5.
 *
 * admin-products.js uses:
 *   AdminPhotoProduct.open({ api, can, product?, uniqueId, templateOf, onSaved(P, created) })
 *   AdminPhotoProduct.sectionHtml(P, { editing, owner })   the Measurements section's body
 *   AdminPhotoProduct.check(api, P) -> Promise<P>           the owner's "Dimensions checked"
 *   AdminPhotoProduct.isDrinkware(P), AdminPhotoProduct.needsCheck(P)
 * Slice 2 ("From photos (cups, tumblers)"), further down:
 *   AdminPhotoProduct.openShoot({ api, can, sid?, uniqueId, onCreated(P) })   the photo wizard (new, or carry on)
 *   AdminPhotoProduct.listShoots(api) -> Promise<[shoot]>, shootsHtml(list)    open shoots to carry on with
 *   AdminPhotoProduct.check(api, P) on a product made from photos opens the overlay check instead of asking.
 * A staff member's change answers "sent for an owner's approval" (an error marked `pending`): the form closes, nothing
 * is taken for the saved product (the toast said so already).
 */
(function () {
  'use strict';

  const { esc, t } = POD;
  const enc = encodeURIComponent;
  const G = () => window.POD_DRINKGEOM;
  const KINDS = ['tumbler', 'cup', 'mug', 'bottle'];
  const MATERIALS = ['gloss', 'matte', 'metal'];
  const sentForApproval = (e) => Boolean(window.AdminRoles && AdminRoles.isPendingError(e));

  // ---------- Numbers ----------
  /** What was typed as 0-9 text: Arabic/Persian digits, "٫", "," or "،" as the decimal point; spaces and marks out. */
  const numText = (v) => POD.latinDigits(v).replace(/[\s٬‎‏؜]/g, '').replace(/[,،]/g, '.');
  /** A typed number, or NaN ('' → null). */
  function parse(v) {
    const s = numText(v);
    if (!s) return null;
    return /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const n = (v) => POD.num(r1(v));
  const mm = (v) => t('dw.mm', { n: n(v) });

  // ---------- The measurements ----------
  const FIELDS = {
    height: 'dw.height', top: 'dw.topDia', bottom: 'dw.bottomDia', bandTop: 'dw.bandTop', bandH: 'dw.bandH',
    hw: 'dw.handleW', hy0: 'dw.handleY0', hy1: 'dw.handleY1', gap: 'dw.gap', safe: 'dw.safe',
  };
  const fieldLabel = (k) => t(FIELDS[k]).replace(/\s*\((mm|مم)\)\s*$/, '');

  /**
   * Read the form into the measurements and what's wrong with them:
   * { m: { kind, material, handle, h, top, bottom, bandTop, bandH, gap, safe, hw, hy0, hy1 }, problems: [{ text, fix }],
   *   cupOk (the cup can be drawn), fan (null until everything is right) }.
   */
  function readForm(form) {
    const v = (k) => parse(form.elements[k] ? form.elements[k].value : '');
    const m = {
      kind: (form.querySelector('input[name=kind]:checked') || {}).value || 'tumbler',
      material: (form.querySelector('input[name=material]:checked') || {}).value || 'gloss',
      handle: (form.querySelector('input[name=handle]:checked') || {}).value === 'yes',
    };
    const problems = [];
    const need = ['height', 'top', 'bottom', 'bandTop', 'bandH', 'gap', 'safe', ...(m.handle ? ['hw', 'hy0', 'hy1'] : [])];
    const bad = new Set();
    for (const k of need) {
      m[k] = v(k);
      if (m[k] === null || Number.isNaN(m[k])) {
        bad.add(k);
        problems.push({ key: k, text: t('dw.e.num', { field: fieldLabel(k), why: m[k] === null ? t('pm.num.empty') : t('num.bad') }) });
      }
    }
    const ok = (...ks) => ks.every((k) => !bad.has(k));
    let cupOk = ok('height', 'top', 'bottom');
    if (ok('height') && (m.height < 30 || m.height > 400)) { problems.push({ key: 'height', text: t('dw.e.height') }); cupOk = false; }
    if (ok('top', 'bottom') && [m.top, m.bottom].some((d) => d < 20 || d > 200)) { problems.push({ key: 'top', text: t('dw.e.dia') }); cupOk = false; }
    if (cupOk && Math.abs(m.top - m.bottom) / m.height > 0.5) { problems.push({ key: 'bottom', text: t('dw.e.taper') }); cupOk = false; }
    let bandOk = cupOk && ok('bandTop', 'bandH');
    if (ok('bandH') && m.bandH < 10) { problems.push({ key: 'bandH', text: t('dw.e.bandSmall') }); bandOk = false; }
    if (cupOk && ok('bandTop', 'bandH') && m.bandTop + m.bandH > m.height + 1e-6) {
      problems.push({ key: 'bandH', text: t('dw.e.bandOut', { end: n(m.bandTop + m.bandH), h: n(m.height) }), fix: 'band' });
      bandOk = false;
    }
    let handleOk = true;
    if (m.handle) {
      handleOk = ok('hw', 'hy0', 'hy1') && m.hw >= 5 && m.hw <= 120 && m.hy1 - m.hy0 >= 5 && (!ok('height') || m.hy1 <= m.height);
      if (ok('hw', 'hy0', 'hy1') && !handleOk) problems.push({ key: 'hw', text: t('dw.e.handle') });
    }
    let gapOk = ok('gap', 'safe');
    if (gapOk && (m.gap > 50 || m.safe > 20)) { problems.push({ key: 'gap', text: t('dw.e.gap') }); gapOk = false; }
    let fan = null;
    if (bandOk && handleOk && gapOk && G()) {
      try {
        fan = G().fanOf(printOf(m), handleOf(m));
      } catch (e) {
        problems.push({ key: 'gap', text: t('dw.e.nothing') });
      }
      // (The same rule as the server: at least 20 mm to print each way inside the safe margin. QA 28 Nov.)
      if (fan && (fan.Wrect - 2 * (m.safe || 0) < 20 || fan.Hrect - 2 * (m.safe || 0) < 20)) {
        problems.push({ key: 'gap', text: t('dw.e.noRoom') });
        fan = null;
      }
    }
    return { m, problems, cupOk, fan };
  }
  /** The diameter at y mm below the rim (straight along the side). */
  const diaAt = (m, y) => m.top + (m.bottom - m.top) * (y / m.height);
  const printOf = (m) => ({ topMm: m.bandTop, heightMm: m.bandH, d1Mm: diaAt(m, m.bandTop), d2Mm: diaAt(m, m.bandTop + m.bandH), gapMm: m.gap, safeMm: m.safe });
  const handleOf = (m) => (m.handle ? { widthMm: m.hw, y0Mm: m.hy0, y1Mm: m.hy1 } : null);

  /** The measurements of a drinkware product (P.drinkware) as the form's values. */
  function fromSpec(dw) {
    const d = dw.dims || {};
    const p = dw.print || {};
    const h = dw.handle;
    return {
      kind: dw.kind, material: dw.material, handle: Boolean(h), h: d.heightMm, top: d.topDiaMm, bottom: d.bottomDiaMm,
      bandTop: p.topMm, bandH: p.heightMm, gap: p.gapMm == null ? 5 : p.gapMm, safe: p.safeMm == null ? 3 : p.safeMm,
      hw: h ? h.widthMm : '', hy0: h ? h.y0Mm : '', hy1: h ? h.y1Mm : '',
    };
  }

  // ---------- Drawings ----------
  /**
   * The cup from the side (inline SVG, 300 × 300): its outline, the print band (the part past the bottom in red),
   * the handle, and the height and diameters.
   */
  function sideSvg(m, { small = false } = {}) {
    const VW = 300;
    const VH = 300;
    const label = esc(t('dw.drawSideAlt'));
    if (!(m.height > 0 && m.top > 0 && m.bottom > 0)) {
      return `<svg class="dw-svg dw-side" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${label}"><rect class="dw-paper" width="${VW}" height="${VH}" rx="12"/></svg>`;
    }
    const k = Math.min(150 / Math.max(m.top, m.bottom), 210 / m.height);
    const cx = 150;
    const y0 = 44;
    const Y = (y) => y0 + y * k;
    const X = (y, side) => cx + side * (diaAt(m, y) * k) / 2;
    const quad = (ya, yb) => `M${X(ya, -1).toFixed(1)} ${Y(ya).toFixed(1)} L${X(ya, 1).toFixed(1)} ${Y(ya).toFixed(1)} L${X(yb, 1).toFixed(1)} ${Y(yb).toFixed(1)} L${X(yb, -1).toFixed(1)} ${Y(yb).toFixed(1)} Z`;
    const hgt = m.height;
    let band = '';
    if (m.bandTop >= 0 && m.bandH > 0 && Number.isFinite(m.bandTop + m.bandH)) {
      const a = Math.min(m.bandTop, hgt);
      const b = Math.min(m.bandTop + m.bandH, hgt);
      if (b > a) band += `<path class="dw-band" d="${quad(a, b)}"/>`;
      const over = m.bandTop + m.bandH - hgt;
      if (over > 0.01) {
        const top = Math.max(m.bandTop, hgt);
        const w = (diaAt(m, hgt) * k) / 2;
        band += `<rect class="dw-over" x="${(cx - w).toFixed(1)}" y="${Y(top).toFixed(1)}" width="${(2 * w).toFixed(1)}" height="${(Math.min(over, hgt) * k).toFixed(1)}"/>`;
      }
    }
    let handle = '';
    if (m.handle && m.hy1 > m.hy0 && m.hy0 >= 0) {
      const a = Math.min(m.hy0, hgt);
      const b = Math.min(m.hy1, hgt);
      const ext = Math.max(26, (Y(b) - Y(a)) * 0.6);
      const xa = X(a, 1);
      const xb = X(b, 1);
      handle = `<path class="dw-handle" d="M${xa.toFixed(1)} ${Y(a).toFixed(1)} C${(xa + ext).toFixed(1)} ${Y(a).toFixed(1)} ${(xb + ext).toFixed(1)} ${Y(b).toFixed(1)} ${xb.toFixed(1)} ${Y(b).toFixed(1)}"/>`;
    }
    const left = Math.min(X(0, -1), X(hgt, -1)) - 16;
    const dims = small ? '' : `
      <g class="dw-dim">
        <path d="M${left} ${Y(0)} V${Y(hgt)} M${left - 4} ${Y(0)} h8 M${left - 4} ${Y(hgt)} h8"/>
        <text x="${left - 8}" y="${(Y(0) + Y(hgt)) / 2}" transform="rotate(-90 ${left - 8} ${(Y(0) + Y(hgt)) / 2})" text-anchor="middle">${esc(mm(hgt))}</text>
        <path d="M${X(0, -1)} ${y0 - 12} H${X(0, 1)} M${X(0, -1)} ${y0 - 16} v8 M${X(0, 1)} ${y0 - 16} v8"/>
        <text x="${cx}" y="${y0 - 20}" text-anchor="middle">${esc(t('dw.dia', { n: n(m.top) }))}</text>
        <path d="M${X(hgt, -1)} ${Y(hgt) + 12} H${X(hgt, 1)} M${X(hgt, -1)} ${Y(hgt) + 8} v8 M${X(hgt, 1)} ${Y(hgt) + 8} v8"/>
        <text x="${cx}" y="${Y(hgt) + 28}" text-anchor="middle">${esc(t('dw.dia', { n: n(m.bottom) }))}</text>
      </g>`;
    return `<svg class="dw-svg dw-side" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${label}">
      <rect class="dw-paper" width="${VW}" height="${VH}" rx="12"/>
      <path class="dw-cup" d="${quad(0, hgt)}"/>
      ${band}${handle}
      <path class="dw-rim" d="M${X(0, -1)} ${Y(0)} H${X(0, 1)}"/>
      ${dims}
    </svg>`;
  }

  /** The flat print template (inline SVG, 320 × 230): the fan or rectangle, a few guide lines, its width and height. */
  function fanSvg(fan, { small = false } = {}) {
    const VW = 320;
    const VH = 230;
    const label = esc(t('dw.drawFanAlt'));
    if (!fan) return `<svg class="dw-svg dw-fan" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${label}"><rect class="dw-paper" width="${VW}" height="${VH}" rx="12"/><text class="dw-wait" x="${VW / 2}" y="${VH / 2}" text-anchor="middle">${esc(t('dw.fixFirst'))}</text></svg>`;
    const k = Math.min(250 / fan.W, 160 / fan.H);
    const ox = 46 + (250 - fan.W * k) / 2; // (room on the left for the height)
    const oy = 24 + (160 - fan.H * k) / 2;
    const P = (u, v) => {
      const [x, y] = G().fanXY(u, v, fan);
      return `${(ox + x * k).toFixed(1)} ${(oy + y * k).toFixed(1)}`;
    };
    const N = fan.template === 'fan' ? 48 : 1;
    const run = (f) => Array.from({ length: N + 1 }, (_, i) => f(i / N));
    const outline = `M${run((s) => P(s, 0)).join(' L')} L${P(1, 1)} L${run((s) => P(1 - s, 1)).join(' L')} Z`;
    const guides = [0.25, 0.5, 0.75].map((u) => `M${P(u, 0)} L${P(u, 1)}`).join(' ') + ` M${run((s) => P(s, 0.5)).join(' L')}`;
    const bx = ox + fan.W * k;
    const by = oy + fan.H * k;
    const dims = small ? '' : `
      <g class="dw-dim">
        <path d="M${ox.toFixed(1)} ${(by + 12).toFixed(1)} H${bx.toFixed(1)} M${ox.toFixed(1)} ${(by + 8).toFixed(1)} v8 M${bx.toFixed(1)} ${(by + 8).toFixed(1)} v8"/>
        <text x="${((ox + bx) / 2).toFixed(1)}" y="${(by + 27).toFixed(1)}" text-anchor="middle">${esc(mm(fan.W))}</text>
        <path d="M${(ox - 10).toFixed(1)} ${oy.toFixed(1)} V${by.toFixed(1)} M${(ox - 14).toFixed(1)} ${oy.toFixed(1)} h8 M${(ox - 14).toFixed(1)} ${by.toFixed(1)} h8"/>
        <text x="${(ox - 16).toFixed(1)}" y="${((oy + by) / 2).toFixed(1)}" transform="rotate(-90 ${(ox - 16).toFixed(1)} ${((oy + by) / 2).toFixed(1)})" text-anchor="middle">${esc(mm(fan.H))}</text>
      </g>`;
    return `<svg class="dw-svg dw-fan" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${label}">
      <rect class="dw-paper" width="${VW}" height="${VH}" rx="12"/>
      <path class="dw-tpl" d="${outline}"/>
      <path class="dw-guide" d="${guides}"/>
      ${dims}
    </svg>`;
  }

  /** The template's numbers under its drawing, and the "narrows by N%" line. */
  function fanFacts(fan) {
    if (!fan) return '';
    const row = (k, v) => `<div><dt>${esc(t(k))}</dt><dd><bdi>${esc(v)}</bdi></dd></div>`;
    const box = (w, h) => t('dw.boxVal', { w: n(w), h: n(h) });
    const rows = fan.template === 'fan'
      ? row('dw.outerR', mm(fan.Ro)) + row('dw.innerR', mm(fan.Ri)) + row('dw.sweep', t('dw.deg', { n: n((fan.theta * 180) / Math.PI) })) + row('dw.box', box(fan.W, fan.H))
      : row('dw.box', box(fan.W, fan.H));
    const sq = fan.template === 'fan' ? G().squeezePct(fan) : 0;
    return `<p class="dw-kindline small"><b>${esc(t(fan.template === 'fan' ? 'dw.fanKind' : 'dw.rectKind'))}</b></p>
      <dl class="dw-facts" data-dw-facts>${rows}${row('dw.design', box(fan.Wrect, fan.Hrect))}</dl>
      ${fan.template === 'fan' ? `<p class="dw-squeeze small" data-dw-squeeze>${esc(t(fan.wideTop ? 'dw.narrowBottom' : 'dw.narrowTop', { n: POD.num(sq) }))}</p>` : ''}`;
  }

  // ---------- The form ----------
  const numInput = (name, value, extra = '') => `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" dir="ltr" id="dw-${name}" name="${name}" value="${esc(value == null ? '' : String(value))}" data-dw-num ${extra}>`;
  const field = (name, label, control, help = '') => `<div class="field"><label for="dw-${name}">${esc(t(label))}</label>${control}${help ? `<span class="muted small">${esc(help)}</span>` : ''}</div>`;
  const radios = (name, list, picked, word, fixed = false) => `<div class="dw-radios" role="radiogroup">${list.map((v) => `<label class="pm-radio"><input type="radio" name="${name}" value="${v}" ${v === picked ? 'checked' : ''}${fixed && v !== picked ? ' disabled' : ''}> ${esc(t(word(v)))}</label>`).join('')}</div>`;

  /**
   * Open the form. product: a drinkware product to re-measure (else a new one). uniqueId(base): a free product code.
   * templateOf(id): the template product (its name and price for the hints). onSaved(P, created).
   */
  function open({ api, can = () => true, product = null, uniqueId = (b) => b, templateOf = () => null, onSaved = () => {} }) {
    const editing = Boolean(product && product.drinkware);
    const start = editing ? fromSpec(product.drinkware) : { kind: 'tumbler', material: 'metal', handle: false, h: '', top: '', bottom: '', bandTop: '', bandH: '', gap: 5, safe: 3, hw: '', hy0: '', hy1: '' };
    const prices = can('prices.edit');
    const d = document.createElement('dialog');
    d.className = 'pm-dlg pm-dlg-wide dw-dlg';
    d.setAttribute('aria-labelledby', 'dw-title');
    d.innerHTML = `<form method="dialog" class="pm-dlg-form dw-form" novalidate>
      <h3 id="dw-title">${esc(editing ? t('dw.titleEdit', { name: POD.tr(product.name) }) : t('dw.title'))}</h3>
      <p class="muted small">${esc(t(editing ? 'dw.helpEdit' : 'dw.help'))}</p>
      <div class="dw-layout">
        <div class="dw-fields">
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.kind'))}</legend>${radios('kind', KINDS, start.kind, (v) => 'dw.k.' + v)}</fieldset>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.sizes'))}</legend>
            <div class="dw-grid3">
              ${field('height', 'dw.height', numInput('height', start.h, 'required'))}
              ${field('top', 'dw.topDia', numInput('top', start.top, 'required'))}
              ${field('bottom', 'dw.bottomDia', numInput('bottom', start.bottom, 'required'))}
            </div>
            <p class="muted small dw-help">${esc(t('dw.diaHelp'))}</p>
          </fieldset>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.band'))}</legend>
            <div class="pm-grid2">
              ${field('bandTop', 'dw.bandTop', numInput('bandTop', start.bandTop, 'required'))}
              ${field('bandH', 'dw.bandH', numInput('bandH', start.bandH, 'required'))}
            </div>
          </fieldset>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.handle'))}</legend>
            ${radios('handle', ['no', 'yes'], start.handle ? 'yes' : 'no', (v) => (v === 'yes' ? 'dw.handleYes' : 'dw.handleNo'), editing)}
            ${editing ? `<p class="muted small dw-help">${esc(t('dw.handleFixed'))}</p>` : ''}
            <div class="dw-handle-fields" data-dw-handle ${start.handle ? '' : 'hidden'}>
              <div class="dw-grid3">
                ${field('hw', 'dw.handleW', numInput('hw', start.hw))}
                ${field('hy0', 'dw.handleY0', numInput('hy0', start.hy0))}
                ${field('hy1', 'dw.handleY1', numInput('hy1', start.hy1))}
              </div>
              <p class="muted small dw-help">${esc(t('dw.handleHelp'))}</p>
            </div>
          </fieldset>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.material'))}</legend>${radios('material', MATERIALS, start.material, (v) => 'dw.m.' + v)}</fieldset>
          <details class="dw-adv" ${editing && (Number(start.gap) !== 5 || Number(start.safe) !== 3) ? 'open' : ''}><summary>${esc(t('dw.advanced'))}</summary>
            <div class="pm-grid2">
              ${field('gap', 'dw.gap', numInput('gap', start.gap), t('dw.gapHelp'))}
              ${field('safe', 'dw.safe', numInput('safe', start.safe), t('dw.safeHelp'))}
            </div>
          </details>
          ${editing ? '' : `<fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.product'))}</legend>
            <div class="pm-grid2">
              <div class="field"><label for="dw-ar">${esc(t('pm.f.nameAr'))}</label><input type="text" id="dw-ar" name="ar" maxlength="80" dir="rtl" required></div>
              <div class="field"><label for="dw-en">${esc(t('pm.f.nameEn'))}</label><input type="text" id="dw-en" name="en" maxlength="80" dir="ltr" required></div>
              <div class="field"><label for="dw-id">${esc(t('pm.code'))}</label><input type="text" id="dw-id" name="code" maxlength="40" dir="ltr" autocapitalize="off" spellcheck="false" required><span class="muted small">${esc(t('pm.codeHelp'))}</span></div>
              ${prices ? field('price', 'dw.price', numInput('price', ''), '') : ''}
            </div>
          </fieldset>`}
        </div>
        <div class="dw-draw" aria-live="polite">
          <figure class="dw-fig"><figcaption class="pm-lbl">${esc(t('dw.drawSide'))}</figcaption><div data-dw-side></div>
            <div class="dw-legend small muted"><span class="dw-lg dw-lg-band"></span>${esc(t('dw.lgBand'))}<span data-dw-lg-handle hidden><span class="dw-lg dw-lg-handle"></span>${esc(t('dw.lgHandle'))}</span></div></figure>
          <figure class="dw-fig"><figcaption class="pm-lbl">${esc(t('dw.drawFan'))}</figcaption><div data-dw-fan></div><div data-dw-facts-slot></div></figure>
          <ul class="dw-problems" data-dw-problems hidden></ul>
        </div>
      </div>
      <p class="pm-err" role="alert" hidden></p>
      <div class="pm-dlg-btns"><button class="btn" type="button" data-dlg-cancel>${esc(t('pm.cancel'))}</button><button class="btn btn-primary" type="submit" data-dlg-ok>${esc(t(editing ? 'dw.saveEdit' : 'dw.create'))}</button></div>
    </form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    const err = d.querySelector('.pm-err');
    let state = null;

    // New product: the code follows the kind (tumbler-2, mug-3...) until it's typed; the price hint names the template.
    let codeTyped = false;
    const tplId = () => (form.querySelector('input[name=handle]:checked').value === 'yes' ? 'mug' : 'tumbler');
    const syncProduct = () => {
      if (editing) return;
      if (!codeTyped) form.code.value = uniqueId(form.querySelector('input[name=kind]:checked').value);
      const pr = form.elements.price;
      if (pr) {
        const tp = templateOf(tplId());
        let help = pr.parentElement.querySelector('.muted');
        if (!help) { help = document.createElement('span'); help.className = 'muted small'; pr.insertAdjacentElement('afterend', help); }
        help.textContent = tp ? t('dw.priceHelp', { name: POD.tr(tp.name) }) : '';
        pr.placeholder = tp && tp.basePrice != null ? POD.num(tp.basePrice) : '';
      }
    };

    const redraw = () => {
      state = readForm(form);
      const { m, problems, fan } = state;
      d.querySelector('[data-dw-handle]').hidden = !m.handle;
      d.querySelector('[data-dw-lg-handle]').hidden = !m.handle;
      d.querySelector('[data-dw-side]').innerHTML = sideSvg(state.cupOk ? m : {});
      d.querySelector('[data-dw-fan]').innerHTML = fanSvg(fan);
      d.querySelector('[data-dw-facts-slot]').innerHTML = fanFacts(fan);
      // Only the boxes already typed in are marked wrong (an empty form isn't a list of mistakes).
      const shown = problems.filter((p) => { const el = form.elements[p.key]; return !el || el.value.trim() !== '' || el.dataset.touched; });
      for (const el of form.querySelectorAll('[data-dw-num]')) el.setAttribute('aria-invalid', shown.some((p) => p.key === el.name) ? 'true' : 'false');
      const list = d.querySelector('[data-dw-problems]');
      const html = shown.map((p) => `<li>${esc(p.text)}${p.fix === 'band' ? ` <button type="button" class="btn btn-sm" data-dw-fix="band">${esc(t('dw.e.bandFit'))}</button>` : ''}</li>`).join('');
      // (Unchanged: left alone, so a button in it isn't replaced between a press and its click.)
      if (list.dataset.html !== html) { list.innerHTML = html; list.dataset.html = html; }
      list.hidden = !shown.length;
    };

    form.addEventListener('input', (e) => {
      if (e.target.name === 'code') { codeTyped = true; form.code.value = form.code.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
      redraw();
    });
    let materialPicked = editing;
    form.addEventListener('change', (e) => {
      if (e.target.name === 'material') materialPicked = true;
      if (e.target.name === 'kind' && !editing) {
        // A mug has a handle; a tumbler is usually stainless steel (until a material is picked).
        if (e.target.value === 'mug') form.querySelector('input[name=handle][value=yes]').checked = true;
        if (!materialPicked) form.querySelector(`input[name=material][value=${e.target.value === 'tumbler' ? 'metal' : 'gloss'}]`).checked = true;
      }
      if (e.target.name === 'kind' || e.target.name === 'handle') syncProduct();
      if (e.target.matches('[data-dw-num]')) e.target.dataset.touched = '1';
      redraw();
    });
    d.addEventListener('click', (e) => {
      const fix = e.target.closest('[data-dw-fix]');
      if (fix && state) {
        const { m } = state;
        form.elements.bandH.value = String(r1(Math.max(0, m.height - m.bandTop)));
        redraw();
        form.elements.bandH.focus();
      }
    });
    d.querySelector('[data-dlg-cancel]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('[data-dw-num]').forEach((el) => { el.dataset.touched = '1'; });
      redraw();
      const ok = d.querySelector('[data-dlg-ok]');
      err.hidden = true;
      const fail = (msg) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); };
      const { m, problems, fan } = state;
      if (problems.length || !fan) return fail(problems.length ? problems[0].text : t('dw.fixFirst'));
      const body = {
        kind: m.kind,
        handle: handleOf(m),
        typed: { heightMm: m.height, topDiaMm: m.top, bottomDiaMm: m.bottom, printTopMm: m.bandTop, printHeightMm: m.bandH },
        material: m.material,
        gapMm: m.gap,
        safeMm: m.safe,
      };
      if (!editing) {
        const id = form.code.value.trim().toLowerCase();
        const name = { en: form.en.value.trim(), ar: form.ar.value.trim() };
        if (!name.en || !name.ar) return fail(t('pm.needNames'));
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return fail(t('pm.badCode'));
        Object.assign(body, { id, name });
        if (form.elements.price) {
          const price = parse(form.elements.price.value);
          if (Number.isNaN(price)) return fail(t('dw.e.price'));
          if (price !== null) body.price = price;
        }
      }
      ok.disabled = true;
      try {
        const url = editing ? `/api/admin/catalog/${enc(product.id)}/drinkware` : '/api/admin/photo-products/from-measurements';
        const r = await api(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const P = (r && r.product) || r;
        d.close();
        if (r && r.warning) POD.toast(t('dw.priceWarning'), 'error');
        else POD.toast(editing ? t(r && r.paused ? 'dw.savedPaused' : 'dw.savedOk') : t('dw.createdOk', { name: POD.tr(P.name) }));
        onSaved(P, !editing);
      } catch (ex) {
        // Sent for an owner's approval: done here (the toast said so; nothing changes until it is approved).
        if (sentForApproval(ex)) return void d.close();
        fail(ex.message);
      } finally {
        ok.disabled = false;
      }
      return undefined;
    });

    syncProduct();
    redraw();
    d.showModal();
    return d;
  }

  // ---------- The product's Measurements section ----------
  const isDrinkware = (P) => Boolean(P && P.drinkware);
  const needsCheck = (P) => isDrinkware(P) && !P.drinkware.checkedAt;
  const whenText = (iso) => (iso ? new Date(iso).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const whoText = (w) => (w === 'owner' ? t('pm.who.owner') : w || '—');

  /** The section's body: the values, small drawings, the check, and the workshop files. */
  function sectionHtml(P, { editing = false, owner = false } = {}) {
    const dw = P.drinkware;
    const m = fromSpec(dw);
    const mm2 = { ...m, height: m.h };
    let fan = null;
    try { fan = G() && dw.print ? G().fanOf(dw.print, dw.handle) : null; } catch (e) { fan = null; }
    const row = (k, v) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`;
    const base = `/api/admin/catalog/${enc(P.id)}`;
    const checked = dw.checkedAt
      ? `<p class="dw-checked" data-dw-checked><span aria-hidden="true">✓</span> ${esc(t('dw.checkedBy', { who: '⁨' + whoText(dw.checkedBy) + '⁩', when: whenText(dw.checkedAt) }))}</p>`
      : isPhotoProduct(P)
        ? `<div class="dw-check-box" data-dw-unchecked data-pp-overlay-box>
          <p><b>${esc(t(owner ? 'pp.ov.box' : 'dw.notChecked'))}</b></p>
          ${owner ? `<button class="btn btn-primary" type="button" data-pm-act="dw-check" data-pp-overlay>${esc(t('pp.ov.open'))}</button>` : ''}
        </div>`
        : `<div class="dw-check-box" data-dw-unchecked>
          <p><b>${esc(t(owner ? 'dw.checkHelp' : 'dw.notChecked'))}</b></p>
          ${owner ? `<button class="btn btn-primary" type="button" data-pm-act="dw-check">${esc(t('dw.check'))}</button>` : ''}
        </div>`;
    return `<div class="dw-sec">
      <div class="dw-sec-grid">
        <dl class="dw-vals">
          ${row('dw.v.kind', t('dw.k.' + (KINDS.includes(m.kind) ? m.kind : 'tumbler')))}
          ${row('dw.v.cup', t('dw.v.cupVal', { h: n(m.h), top: n(m.top), bottom: n(m.bottom) }))}
          ${row('dw.v.band', t('dw.v.bandVal', { h: n(m.bandH), top: n(m.bandTop) }))}
          ${m.handle ? row('dw.v.handle', t('dw.v.handleVal', { w: n(m.hw), y0: n(m.hy0), y1: n(m.hy1) })) : ''}
          ${row('dw.v.material', t('dw.m.' + (MATERIALS.includes(m.material) ? m.material : 'gloss')))}
          ${row('dw.v.gap', t('dw.v.gapVal', { gap: n(m.gap), safe: n(m.safe) }))}
        </dl>
        <div class="dw-sec-draw">${sideSvg(mm2, { small: true })}${fanSvg(fan, { small: true })}</div>
      </div>
      ${fanFacts(fan)}
      ${editing ? `<p><button class="btn" type="button" data-pm-act="dw-remeasure">${esc(t('dw.change'))}</button></p>` : ''}
      ${checked}
      <h4 class="dw-files-h">${esc(t('dw.files'))}</h4>
      <div class="dw-files">
        <button class="btn btn-sm" type="button" data-download="${esc(base)}/template.pdf" data-dw-file="template.pdf">⬇ ${esc(t('dw.templatePdf'))}</button>
        <button class="btn btn-sm" type="button" data-download="${esc(base)}/template.svg" data-dw-file="template.svg">⬇ ${esc(t('dw.templateSvg'))}</button>
        <button class="btn btn-sm" type="button" data-download="${esc(base)}/spec.pdf" data-dw-file="spec.pdf">⬇ ${esc(t('dw.specPdf'))}</button>
      </div>
      <p class="muted small">${esc(t('dw.filesHelp'))}</p>
    </div>`;
  }

  /**
   * The owner's "Dimensions checked". A product made from photos: the overlay check (the drawing over its photo);
   * else asks first. Resolves with the product, or null when not confirmed.
   */
  async function check(api, P) {
    if (isPhotoProduct(P)) return overlayCheck(api, P);
    if (!confirm(t('dw.checkConfirm'))) return null;
    const r = await api(`/api/admin/catalog/${enc(P.id)}/drinkware/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return (r && r.product) || r;
  }


  // =====================================================================
  // Slice 2: a new cup from PHOTOS. The calibration card, the shot list (each photo checked at once), the typed
  // measurements beside the photo's, the drawing on the straightened front photo, the hidden product; and the owner's
  // overlay check on the product page. Every step is saved to the shoot (db.productShoots) so it can be carried on
  // later, from the New product dialog.
  //   Browser maths: public/js/calib-detect.js (POD_CALIB), public/js/drinkware-measure.js (POD_DWMEASURE).
  //   Server: /api/admin/photo-products… (src/photo-product-routes.js).
  // Images are { data: Uint8ClampedArray RGBA, width, height } (canvas ImageData) throughout.
  // =====================================================================
  const CAL = () => window.POD_CALIB;
  const MEAS = () => window.POD_DWMEASURE;
  const SHOOTS = '/api/admin/photo-products';
  const VIEWS = ['front', 'side', 'back', 'top', 'bottom', 'threeq', 'print', 'surface'];
  const DETECT_VIEWS = ['front', 'side', 'print'];
  const STEPS = ['start', 'shots', 'measure', 'build', 'product'];
  const MAX_PX = 3000; // the photo sent: ≤ 3000 px on its long side, JPEG
  const RECT_PX_PER_MM = 5; // the straightened front photo (front.webp: ≤ 1000 px wide)
  const FRONT_MAX_W = 1000;
  const FRONT_MAX_H = 2000;
  const WARN_PCT = 2;
  const shootOf = (r) => (r && r.shoot) || r;
  const tick = () => new Promise((res) => setTimeout(res, 30)); // let the page paint a "busy" state first

  // ---------- Fetching with the admin's sign-in (pictures can't go through api(), which reads JSON) ----------
  function authHeaders() {
    let tok = '';
    try { tok = sessionStorage.getItem('pod-admin-token') || ''; } catch (e) { tok = ''; }
    return { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'x-lang': POD.lang };
  }
  async function fetchBlob(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: authHeaders() });
    if (!res.ok) {
      const body = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
      const e = new Error((body && body.error) || t('msg.requestFailed', { status: res.status }));
      e.status = res.status;
      throw e;
    }
    return res.blob();
  }

  // ---------- Pictures ----------
  /** A photo file or blob drawn on a canvas, at most `max` px on its long side (the browser turns it upright). */
  async function canvasOf(blob, max = Infinity) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch (e) { throw new Error(t('pp.e.notImage')); }
      const w0 = img.naturalWidth;
      const h0 = img.naturalHeight;
      if (!w0 || !h0) throw new Error(t('pp.e.notImage'));
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k));
      c.height = Math.max(1, Math.round(h0 * k));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const pixelsOf = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const blobOf = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('pp.e.notImage')))), type, q));
  function canvasFromPixels(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const id = new ImageData(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), img.width, img.height);
    c.getContext('2d').putImageData(id, 0, 0);
    return c;
  }
  /** A 0/1 mask as a black and white picture (white = the cup). */
  function maskCanvas(mask) {
    const c = document.createElement('canvas');
    c.width = mask.width;
    c.height = mask.height;
    const g = c.getContext('2d');
    const id = g.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i += 1) {
      const v = mask.data[i] ? 255 : 0;
      id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  /** A cut-out picture (white or opaque = the cup) as a 0/1 mask of w × h. */
  function maskFromPicture(c, w, h) {
    const s = document.createElement('canvas');
    s.width = w;
    s.height = h;
    const g = s.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    let opaque = true;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) { opaque = false; break; }
    for (let i = 0; i < out.length; i += 1) {
      const lum = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      out[i] = (opaque ? lum : d[i * 4 + 3] * (lum > 0 ? 1 : 0)) > 127 ? 1 : 0;
    }
    return { data: out, width: w, height: h };
  }
  function maskBox(mask) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let n = 0;
    for (let y = 0; y < mask.height; y += 1) {
      const row = y * mask.width;
      for (let x = 0; x < mask.width; x += 1) {
        if (!mask.data[row + x]) continue;
        n += 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return n ? { x0, y0, x1, y1, n } : null;
  }

  // ---------- The card ----------
  /** What the browser keeps of a card found on a photo (sent to the shoot; the server checks it). */
  const cardForShoot = (c, method) => ({
    corners: c.corners.map(([x, y]) => [r1(x), r1(y)]),
    method,
    rmsPx: c.rmsPx == null ? null : Math.round(c.rmsPx * 100) / 100,
    pxPerMm: Math.round(c.pxPerMm * 1000) / 1000,
    wb: (c.wb || [1, 1, 1]).map((v) => Math.round(v * 1000) / 1000),
    tiltDeg: c.tiltDeg == null ? null : r1(c.tiltDeg),
    ...(c.lowAccuracy ? { lowAccuracy: true } : {}),
    // (Kept so a session carried on later needn't find the card again.)
    ...(Array.isArray(c.H) && c.H.length === 9 && Array.isArray(c.Hinv) && c.Hinv.length === 9 ? { H: c.H.slice(), Hinv: c.Hinv.slice() } : {}),
  });
  /** The server's build warnings (src/photo-product-routes.js compose) in words. */
  const WARN_KEYS = ['heightDiff', 'topDiff', 'bottomDiff', 'profileFar', 'curvedBody', 'noFrontCard', 'lowAccuracy', 'noFrontPhoto'];
  const warnText = (x) => (WARN_KEYS.includes(x) ? t('pp.w.' + x) : typeof x === 'string' ? x : (x && (x.text || x.message)) || '');
  /** A saved card in other millimetres (mm_old = f · mm_new): H takes the scale, the corners stay. */
  function rescaleCard(c, f) {
    const out = { ...c, pxPerMm: Math.round(c.pxPerMm * f * 10000) / 10000 };
    if (Array.isArray(c.H) && c.H.length === 9 && Array.isArray(c.Hinv) && c.Hinv.length === 9) {
      const H = c.H.slice();
      const Hi = c.Hinv.slice();
      for (const r of [0, 1, 2]) { H[r * 3] *= f; H[r * 3 + 1] *= f; }
      for (const k of [0, 1, 2, 3, 4, 5]) Hi[k] /= f;
      Object.assign(out, { H, Hinv: Hi });
    }
    return out;
  }
  const whyText = (reason) => t('pp.why.' + (['notFound', 'blurry', 'tilted', 'tooDark', 'tooBright'].includes(reason) ? reason : 'other'));

  // ---------- Framing diagrams: the card standing beside the cup, the phone in front ----------
  /**
   * Two small drawings side by side: from above (the cup, the card at its centre line, the phone ≥ 1 m away) and what
   * the photo looks like (the cup with the card standing upright beside it). LTR drawing in both languages (a plan).
   */
  function diagramSvg(view) {
    const cardLine = view !== 'surface' && view !== 'top' && view !== 'bottom';
    const label = esc(t('pp.diagramAlt', { view: t('pp.v.' + view) }));
    // From above: cup at (60, 34), card to its left on the same line, the phone below (or diagonal for 3/4).
    const phone = view === 'threeq' ? [104, 92] : [60, 96];
    const handleAng = { front: -90, side: 0, back: 90, threeq: -90, print: -90 }[view];
    const plan = view === 'top' || view === 'bottom'
      ? `<circle class="pp-d-cup" cx="60" cy="56" r="17"/>${view === 'bottom' ? '<circle class="pp-d-cupin" cx="60" cy="56" r="11"/>' : ''}
         <rect class="pp-d-phone" x="48" y="10" width="24" height="13" rx="3"/><path class="pp-d-ray" d="M60 24 V36"/>`
      : `<path class="pp-d-axis" d="M8 34 H112"/>
         <circle class="pp-d-cup" cx="60" cy="34" r="15"/>
         ${handleAng == null ? '' : `<path class="pp-d-handle" d="M${(60 + 15 * Math.cos((handleAng * Math.PI) / 180)).toFixed(1)} ${(34 - 15 * Math.sin((handleAng * Math.PI) / 180)).toFixed(1)} l${(9 * Math.cos((handleAng * Math.PI) / 180)).toFixed(1)} ${(-9 * Math.sin((handleAng * Math.PI) / 180)).toFixed(1)}"/>`}
         ${cardLine ? '<rect class="pp-d-card" x="14" y="31.5" width="28" height="5" rx="1"/>' : ''}
         <rect class="pp-d-phone" x="${phone[0] - 11}" y="${phone[1] - 6}" width="22" height="12" rx="3" ${view === 'threeq' ? `transform="rotate(-35 ${phone[0]} ${phone[1]})"` : ''}/>
         <path class="pp-d-ray" d="M${phone[0]} ${phone[1] - 8} L${view === 'threeq' ? '72 44' : '60 52'}"/>
         ${view === 'surface' ? '' : `<text class="pp-d-txt" x="${view === 'threeq' ? 6 : 68}" y="${view === 'threeq' ? 80 : 74}" direction="ltr" text-anchor="start">${esc(t('pp.dDist'))}</text>
           <text class="pp-d-txt" x="${view === 'threeq' ? 6 : 68}" y="${view === 'threeq' ? 90 : 84}" direction="ltr" text-anchor="start">${esc(t('pp.dZoom'))}</text>`}`;
    // The photo: cup (tapered) with the card upright beside it, its 4 black corners; a dashed line at mid-height.
    const card = cardLine ? `<g class="pp-d-cardup"><rect x="132" y="22" width="40" height="40" rx="2"/>
        <rect class="pp-d-fp" x="135" y="25" width="7" height="7"/><rect class="pp-d-fp" x="162" y="25" width="7" height="7"/>
        <rect class="pp-d-fp" x="135" y="52" width="7" height="7"/><rect class="pp-d-fp" x="162" y="52" width="7" height="7"/>
        <path class="pp-d-chk" d="M145 36 h12 v4 h-12 z M151 40 h6 v4 h-6 z"/></g>` : '';
    const close = view === 'print' || view === 'surface';
    const cup = view === 'top' || view === 'bottom'
      ? `<ellipse class="pp-d-cup" cx="${cardLine ? 196 : 170}" cy="42" rx="22" ry="22"/><ellipse class="pp-d-cupin" cx="${cardLine ? 196 : 170}" cy="42" rx="15" ry="15"/>`
      : close
        ? `<path class="pp-d-cup" d="M${cardLine ? 176 : 132} 8 H218 V78 H${cardLine ? 180 : 134} Z"/><path class="pp-d-band" d="M${cardLine ? 178 : 133} 22 H218 V62 H${cardLine ? 179.5 : 134} Z"/>`
        : `<path class="pp-d-cup" d="M180 18 H214 L210 62 H184 Z"/><ellipse class="pp-d-rim" cx="197" cy="18" rx="17" ry="3"/>
           ${view === 'side' ? '<path class="pp-d-handle" d="M213 26 c12 0 12 24 -2 26"/>' : ''}
           ${view === 'threeq' ? '<path class="pp-d-handle" d="M182 26 c-9 2 -9 22 2 24"/>' : ''}`;
    const mid = cardLine && !close && view !== 'top' && view !== 'bottom' ? '<path class="pp-d-mid" d="M126 40 H224"/>' : '';
    return `<svg class="pp-diagram" viewBox="0 0 232 100" role="img" aria-label="${label}" dir="ltr">
      <rect class="pp-d-paper" x="1" y="1" width="118" height="98" rx="8"/>
      <rect class="pp-d-paper pp-d-photo" x="124" y="1" width="107" height="98" rx="8"/>
      ${plan}${card}${cup}${mid}
      ${cardLine && !close ? `<path class="pp-d-table" d="M126 63 H229"/>` : ''}
    </svg>`;
  }

  // ---------- The wizard ----------
  /** The step to carry on from, for a shoot as saved. */
  function stepOf(sh) {
    if (!sh) return 'start';
    if (sh.status === 'built') return 'product';
    if (sh.status === 'measured') return 'build';
    return shotsDone(sh, Boolean(sh.handle)) ? 'measure' : 'shots';
  }
  const hasCard = (sh, v) => Boolean(sh && sh.shots && sh.shots[v] && sh.shots[v].card && sh.shots[v].card.corners);
  const hasShot = (sh, v) => Boolean(sh && sh.shots && sh.shots[v] && (sh.shots[v].file || sh.shots[v].w));
  const shotsDone = (sh, handle) => hasCard(sh, 'front') && (!handle || hasCard(sh, 'side'));
  const shotFile = (sh, v) => (sh.shots[v] && sh.shots[v].file) || `${v}.jpg`;

  /**
   * Open the wizard: a new shoot, or `sid` to carry on with one.
   * onCreated(P): the hidden product was made (the caller opens its page).
   */
  async function openShoot({ api, can = () => true, sid = null, uniqueId = (b) => b, onCreated = () => {}, onChanged = () => {} }) {
    if (!CAL()) { POD.toast(t('pp.e.tools'), 'error'); return null; }
    let sh = null;
    if (sid) {
      try { sh = shootOf(await api(`${SHOOTS}/${enc(sid)}`)); } catch (e) { POD.toast(e.message, 'error'); return null; }
    }
    // What this browser has worked out (not saved: made again from the saved shoot when carried on).
    const W = {
      step: stepOf(sh),
      pics: {}, // view -> canvas (the photo as sent)
      cards: {}, // view -> the full card found (with H, Hinv)
      tiles: {}, // view -> { state, why, low }
      front: null, // { rect, mask, meas, source:'server'|'local', box }
      side: null, // { rect, mask, meas }
      measureErr: '',
      busy: 0,
      built: null,
    };
    const d = document.createElement('dialog');
    d.className = 'pm-dlg pp-dlg';
    d.setAttribute('aria-labelledby', 'pp-title');
    d.innerHTML = `<div class="pp-wrap">
      <header class="pp-head">
        <div class="pp-head-row"><h3 id="pp-title">${esc(t('pp.title'))}</h3>
          <button class="btn btn-sm pp-x" type="button" data-pp-close title="${esc(t('pp.close'))}">${esc(t('pp.closeShort'))}</button></div>
        <ol class="pp-steps" data-pp-steps></ol>
      </header>
      <div class="pp-body" data-pp-body></div>
      <p class="pm-err pp-err" role="alert" hidden></p>
      <footer class="pp-foot">
        <button class="btn" type="button" data-pp-back>${esc(t('pp.back'))}</button>
        <span class="pp-saved small muted" data-pp-saved aria-live="polite"></span>
        <button class="btn btn-primary" type="button" data-pp-next>${esc(t('pp.next'))}</button>
      </footer>
    </div>`;
    document.body.appendChild(d);
    const body = d.querySelector('[data-pp-body]');
    const errEl = d.querySelector('.pp-err');
    const savedEl = d.querySelector('[data-pp-saved]');
    const fail = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; if (msg) errEl.scrollIntoView({ block: 'nearest' }); };
    const saved = (busy) => { savedEl.textContent = busy ? t('pp.saving') : sh ? '✓ ' + t('pp.saved') : ''; };
    const keep = (r) => { const s = shootOf(r); if (s && s.id) sh = s; saved(false); onChanged(sh); return sh; };
    const put = async (patch) => { saved(true); return keep(await api(`${SHOOTS}/${enc(sh.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })); };

    function renderSteps() {
      const at = STEPS.indexOf(W.step);
      d.querySelector('[data-pp-steps]').innerHTML = STEPS.map((s, i) => `<li class="${i < at ? 'is-done' : i === at ? 'is-on' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="pp-step-n">${POD.num(i + 1)}</span><span class="pp-step-t">${esc(t('pp.s.' + s))}</span></li>`).join('');
      d.querySelector('[data-pp-back]').hidden = at === 0;
      const next = d.querySelector('[data-pp-next]');
      next.textContent = t(W.step === 'build' ? 'pp.build' : W.step === 'product' ? 'pp.create' : 'pp.next');
      next.dataset.ppNext = W.step;
    }
    function render() {
      fail('');
      renderSteps();
      body.innerHTML = STEP_HTML[W.step]();
      body.dataset.step = W.step;
      saved(false);
      if (STEP_AFTER[W.step]) STEP_AFTER[W.step]();
    }
    const go = (step) => { W.step = step; render(); body.scrollTop = 0; d.querySelector('.pp-wrap').scrollTop = 0; };

    // ----- Step 1: get ready -----
    const kindNow = () => (sh ? sh.kind : (d.querySelector('input[name=pp-kind]:checked') || {}).value || 'tumbler');
    const handleNow = () => (sh ? Boolean(sh.handle) : (d.querySelector('input[name=pp-handle]:checked') || {}).value === 'yes');
    const STEP_HTML = {};
    const STEP_AFTER = {};
    STEP_HTML.start = () => {
      const kind = sh ? sh.kind : 'tumbler';
      const line = sh && sh.cardScale ? r1(sh.cardScale * 100) : '';
      const rad = (name, list, picked, word) => `<div class="dw-radios" role="radiogroup">${list.map((v) => `<label class="pm-radio"><input type="radio" name="${name}" value="${v}" ${v === picked ? 'checked' : ''} ${sh && v !== picked ? 'disabled' : ''}> ${esc(t(word(v)))}</label>`).join('')}</div>`;
      return `<p class="muted small">${esc(t('pp.startHelp'))}</p>
        <div class="pp-start">
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.kind'))}</legend>${rad('pp-kind', KINDS, kind, (v) => 'dw.k.' + v)}
            <div class="pp-gap"></div>${rad('pp-handle', ['no', 'yes'], sh && sh.handle ? 'yes' : 'no', (v) => (v === 'yes' ? 'dw.handleYes' : 'dw.handleNo'))}
            ${sh ? `<p class="muted small dw-help">${esc(t('pp.kindFixed'))}</p>` : ''}</fieldset>
          <section class="pp-box"><h4>${esc(t('pp.cardH'))}</h4><p class="small">${esc(t('pp.cardHelp'))}</p>
            <button class="btn" type="button" data-download="${SHOOTS}/card.pdf" data-pp-card>⬇ ${esc(t('pp.cardPdf'))}</button></section>
          <section class="pp-box"><h4>${esc(t('pp.rulerH'))}</h4><p class="small">${esc(t('pp.rulerHelp'))}</p>
            <div class="field pp-ruler"><label for="pp-ruler">${esc(t('pp.rulerLabel'))}</label>
              <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" dir="ltr" id="pp-ruler" name="ruler" value="${esc(String(line))}" placeholder="100"></div>
            <p class="small pp-ruler-say" data-pp-ruler-say aria-live="polite"></p></section>
          <section class="pp-box pp-setup"><h4>${esc(t('pp.setupH'))}</h4>
            <div class="pp-setup-grid">${diagramSvg('front')}<ul class="small"><li>${esc(t('pp.setup1'))}</li><li>${esc(t('pp.setup2'))}</li><li>${esc(t('pp.setup3'))}</li></ul></div></section>
        </div>`;
    };
    const rulerVal = () => parse(d.querySelector('#pp-ruler') ? d.querySelector('#pp-ruler').value : '');
    STEP_AFTER.start = () => {
      const say = () => {
        const v = rulerVal();
        const el = d.querySelector('[data-pp-ruler-say]');
        el.textContent = v >= 95 && v <= 105 ? (Math.abs(v - 100) < 0.25 ? t('pp.rulerOk') : t('pp.rulerScaled', { n: POD.num(r1(v)) })) : '';
      };
      d.querySelector('#pp-ruler').addEventListener('input', say);
      say();
      if (!sh) {
        d.querySelectorAll('input[name=pp-kind]').forEach((el) => el.addEventListener('change', () => { if (el.checked && el.value === 'mug') d.querySelector('input[name=pp-handle][value=yes]').checked = true; }));
      }
    };
    async function nextStart() {
      const v = rulerVal();
      if (!(v >= 95 && v <= 105)) { d.querySelector('#pp-ruler').setAttribute('aria-invalid', 'true'); throw new Error(t('pp.e.ruler')); }
      const cardScale = Math.round((v / 100) * 10000) / 10000;
      if (!sh) keep(await api(SHOOTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kindNow(), handle: handleNow() }) }));
      if (sh.cardScale !== cardScale) {
        // Cards found already were measured in the old scale's millimetres: the same corners, other millimetres.
        const f = (sh.cardScale || 1) / cardScale;
        const shots = {};
        for (const v of VIEWS) if (hasCard(sh, v)) shots[v] = { card: rescaleCard(sh.shots[v].card, f) };
        await put({ cardScale, ...(Object.keys(shots).length ? { shots } : {}) });
        W.cards = {};
        W.front = null;
        W.side = null;
      }
      go('shots');
    }

    // ----- Step 2: the photos -----
    const tileState = (v) => {
      const T = W.tiles[v];
      if (T) return T;
      if (hasCard(sh, v)) return { state: 'ok', low: Boolean(sh.shots[v].card.lowAccuracy), tap: sh.shots[v].card.method === 'tap' };
      if (hasShot(sh, v)) return { state: DETECT_VIEWS.includes(v) ? 'retake' : 'saved', why: DETECT_VIEWS.includes(v) ? whyText('notFound') : '' };
      return { state: 'empty' };
    };
    function badgeHtml(v) {
      const T = tileState(v);
      const txt = {
        empty: t('pp.st.empty'),
        prep: t('pp.st.prep'),
        upload: t('pp.st.upload'),
        check: t('pp.st.check'),
        ok: T.low ? t('pp.st.low') : T.tap ? t('pp.st.okTap') : t('pp.st.ok'),
        saved: t('pp.st.saved'),
        retake: t('pp.st.retake', { why: T.why || '' }),
        fail: t('pp.st.fail', { why: T.why || '' }),
      }[T.state];
      const icon = { ok: '✓', saved: '✓', retake: '!', fail: '!', prep: '…', upload: '…', check: '…', empty: '' }[T.state];
      return `<span class="pp-badge is-${T.state}${T.low ? ' is-low' : ''}" data-pp-badge="${T.state}">${icon ? `<b aria-hidden="true">${icon}</b> ` : ''}${esc(txt)}</span>`;
    }
    const needed = (v) => v === 'front' || (v === 'side' && sh && sh.handle);
    function tileHtml(v) {
      const T = tileState(v);
      const busy = ['prep', 'upload', 'check'].includes(T.state);
      const taken = hasShot(sh, v) || W.pics[v];
      return `<article class="pp-tile is-${T.state}" data-pp-tile="${v}" aria-busy="${busy}">
        <div class="pp-tile-top"><h4>${esc(t('pp.v.' + v))}</h4><span class="pp-need ${needed(v) ? 'is-need' : ''}">${esc(t(needed(v) ? 'pp.needed' : 'pp.optional'))}</span></div>
        <div class="pp-tile-figs">${diagramSvg(v)}${taken ? `<div class="pp-thumb" data-pp-thumb="${v}"></div>` : ''}</div>
        <p class="small pp-how">${esc(t('pp.h.' + v))}</p>
        <div class="pp-tile-state" aria-live="polite">${badgeHtml(v)}</div>
        <div class="pp-tile-btns">
          <label class="btn ${taken ? '' : 'btn-primary'} pp-take ${busy ? 'is-disabled' : ''}"><input class="pp-file" type="file" accept="image/*" capture="environment" data-pp-file="${v}" ${busy ? 'disabled' : ''}>${esc(t(taken ? 'pp.retakeBtn' : 'pp.take'))}</label>
          ${DETECT_VIEWS.includes(v) && taken && !busy && T.state !== 'ok' ? `<button class="btn" type="button" data-pp-tap="${v}">${esc(t('pp.tapBtn'))}</button>` : ''}
        </div>
      </article>`;
    }
    STEP_HTML.shots = () => `<p class="muted small">${esc(t('pp.shotsHelp'))}</p><div class="pp-tiles">${VIEWS.map(tileHtml).join('')}</div>`;
    const thumbUrls = {};
    async function showThumb(v) {
      const slot = d.querySelector(`[data-pp-thumb="${v}"]`);
      if (!slot) return;
      try {
        if (!thumbUrls[v]) {
          const c = W.pics[v] || (await picOf(v));
          const s = document.createElement('canvas');
          const k = 240 / Math.max(c.width, c.height);
          s.width = Math.round(c.width * k);
          s.height = Math.round(c.height * k);
          s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
          thumbUrls[v] = URL.createObjectURL(await blobOf(s, 'image/jpeg', 0.8));
        }
        slot.innerHTML = `<img src="${thumbUrls[v]}" alt="">`;
      } catch (e) { /* the diagram stays */ }
    }
    STEP_AFTER.shots = () => { for (const v of VIEWS) if (d.querySelector(`[data-pp-thumb="${v}"]`)) showThumb(v); };
    const redrawTile = (v) => {
      const el = d.querySelector(`[data-pp-tile="${v}"]`);
      if (!el || W.step !== 'shots') return;
      el.outerHTML = tileHtml(v);
      showThumb(v);
    };
    const setTile = (v, T) => { W.tiles[v] = T; redrawTile(v); };
    /** The photo as sent (from this browser, or fetched back from the shoot). */
    async function picOf(v) {
      if (W.pics[v]) return W.pics[v];
      const blob = await fetchBlob(`${SHOOTS}/${enc(sh.id)}/files/${enc(shotFile(sh, v))}`);
      W.pics[v] = await canvasOf(blob);
      return W.pics[v];
    }
    /** The card on a photo (found again when the shoot was carried on: the corners saved, H worked out again). */
    async function cardOf(v) {
      if (W.cards[v]) return W.cards[v];
      if (!hasCard(sh, v)) return null;
      const saved1 = sh.shots[v].card;
      if (Array.isArray(saved1.H) && saved1.H.length === 9 && Array.isArray(saved1.Hinv) && saved1.Hinv.length === 9) {
        W.cards[v] = { ok: true, ...saved1, wb: saved1.wb || [1, 1, 1] };
        return W.cards[v];
      }
      const img = pixelsOf(await picOf(v));
      let c = saved1.method === 'tap' ? CAL().fromTaps(img, saved1.corners, { cardScale: sh.cardScale || 1 }) : CAL().detectCard(img, { cardScale: sh.cardScale || 1 });
      if (!c || !c.ok) c = CAL().fromTaps(img, saved1.corners, { cardScale: sh.cardScale || 1 });
      if (!c || !c.ok) return null;
      W.cards[v] = c;
      return c;
    }
    async function takePhoto(v, file) {
      if (!file) return;
      W.busy += 1;
      thumbUrls[v] = null;
      setTile(v, { state: 'prep' });
      try {
        await tick();
        const c = await canvasOf(file, MAX_PX);
        const blob = await blobOf(c, 'image/jpeg', 0.9);
        W.pics[v] = c;
        setTile(v, { state: 'upload' });
        keep(await api(`${SHOOTS}/${enc(sh.id)}/shots/${v}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }));
        // A new photo of the front or side: what was measured on the old one goes.
        delete W.cards[v];
        if (v === 'front') W.front = null;
        if (v === 'side') W.side = null;
        if (!DETECT_VIEWS.includes(v)) return void setTile(v, { state: 'saved' });
        setTile(v, { state: 'check' });
        await tick();
        const card = CAL().detectCard(pixelsOf(c), { cardScale: sh.cardScale || 1 });
        if (card && card.ok) {
          W.cards[v] = card;
          await put({ shots: { [v]: { card: cardForShoot(card, 'auto') } } });
          setTile(v, { state: 'ok' });
        } else {
          setTile(v, { state: 'retake', why: whyText(card && card.reason) });
        }
      } catch (e) {
        setTile(v, { state: 'fail', why: e.message });
      } finally {
        W.busy -= 1;
      }
    }
    async function tapCorners(v) {
      const c = await picOf(v);
      const card = await tapDialog(c, sh.cardScale || 1);
      if (!card) return;
      W.cards[v] = card;
      if (v === 'front') W.front = null;
      if (v === 'side') W.side = null;
      await put({ shots: { [v]: { card: cardForShoot(card, 'tap') } } });
      setTile(v, { state: 'ok', tap: true, low: Boolean(card.lowAccuracy) });
    }
    function nextShots() {
      if (W.busy) throw new Error(t('pp.e.busy'));
      if (!hasCard(sh, 'front')) throw new Error(t('pp.e.needFront'));
      if (sh.handle && !hasCard(sh, 'side')) throw new Error(t('pp.e.needSide'));
      go('measure');
    }

    // ----- Step 3: measurements -----
    /** The cup on a photo: cut out (the server's, else against the plain background), straightened, measured. */
    async function measureView(v) {
      if (!MEAS()) throw new Error(t('pp.e.tools'));
      const card = await cardOf(v);
      if (!card) throw new Error(t('pp.e.needFront'));
      const pic = await picOf(v);
      const img = pixelsOf(pic);
      let mask = null;
      let source = 'server';
      // The server's cut-out (in the photo's own pixels): one made already, else ask for one (the answer is the
      // mask itself). Off or busy (503): cut out here against the plain background.
      const cut = sh.cutouts && sh.cutouts[v];
      try {
        const blob = cut && cut.at && sh.shots[v] && cut.at >= (sh.shots[v].at || '')
          ? await fetchBlob(`${SHOOTS}/${enc(sh.id)}/files/${v}-cutout.png`)
          : await fetchBlob(`${SHOOTS}/${enc(sh.id)}/cutout/${v}`, { method: 'POST' });
        mask = maskFromPicture(await canvasOf(blob), img.width, img.height);
      } catch (e) {
        mask = null;
      }
      const okMask = (m) => { const b = m && maskBox(m); return b && b.n > img.width * img.height * 0.005 && b.n < img.width * img.height * 0.7 ? b : null; };
      if (!okMask(mask)) {
        source = 'local';
        mask = MEAS().maskFromBackground(img, { card });
      }
      const box = okMask(mask);
      if (!box) throw new Error(t('pp.e.noCup'));
      // The cup's box in card millimetres, with room round it; straightened into the card's plane.
      const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => CAL().imageToCard(card.Hinv, x, y));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const wMm = Math.max(...xs) - Math.min(...xs);
      const hMm = Math.max(...ys) - Math.min(...ys);
      const pad = Math.max(8, wMm * 0.15);
      const roi = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: wMm + 2 * pad, h: hMm + 2 * pad };
      const pxPerMm = Math.min(RECT_PX_PER_MM, FRONT_MAX_W / roi.w, FRONT_MAX_H / roi.h);
      const rect = MEAS().rectify(img, card, { pxPerMm, roi });
      const rmask = MEAS().rectifyMask ? MEAS().rectifyMask(mask, card, rect) : rectifyMask(mask, card, rect);
      const mo = { pxPerMm: rect.pxPerMm, offsetMm: rect.offsetMm, card };
      const meas = v === 'side' ? MEAS().measureSide(rect.img, rmask, mo) : MEAS().measureFront(rect.img, rmask, mo);
      if (!meas || !(v === 'side' || meas.heightMm > 0)) throw new Error(t('pp.e.noCup'));
      return { rect, mask: rmask, meas, source, low: Boolean(card.lowAccuracy) };
    }
    /** The cut-out, sampled into the straightened photo's pixels (nearest: it is 0/1). */
    function rectifyMask(mask, card, rect) {
      const { width: w, height: h } = rect.img;
      const out = new Uint8Array(w * h);
      const [ox, oy] = rect.offsetMm || [0, 0];
      const k = rect.pxPerMm;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const [ix, iy] = CAL().cardToImage(card.H, ox + (x + 0.5) / k, oy + (y + 0.5) / k);
          const sx = Math.floor(ix);
          const sy = Math.floor(iy);
          if (sx >= 0 && sy >= 0 && sx < mask.width && sy < mask.height) out[y * w + x] = mask.data[sy * mask.width + sx];
        }
      }
      return { data: out, width: w, height: h };
    }
    async function runMeasure() {
      W.measureErr = '';
      try {
        await tick();
        if (!W.front) W.front = await measureView('front');
        if (!W.side && hasCard(sh, 'side')) {
          try { W.side = await measureView('side'); } catch (e) { W.side = { err: e.message }; }
        }
      } catch (e) {
        W.measureErr = e.message;
      }
    }
    const TYPED_ROWS = [['height', 'heightMm', 'dw.height'], ['top', 'topDiaMm', 'dw.topDia'], ['bottom', 'bottomDiaMm', 'dw.bottomDia']];
    const HANDLE_ROWS = [['hw', 'widthMm', 'dw.handleW'], ['hy0', 'y0Mm', 'dw.handleY0'], ['hy1', 'y1Mm', 'dw.handleY1']];
    const typedOf = () => {
      const ty = (sh && sh.typed) || {};
      const h = ty.handle && typeof ty.handle === 'object' ? ty.handle : {};
      return { height: ty.heightMm, top: ty.topDiaMm, bottom: ty.bottomDiaMm, bandTop: ty.printTopMm, bandH: ty.printHeightMm, hw: h.widthMm, hy0: h.y0Mm, hy1: h.y1Mm };
    };
    const photoVals = () => {
      const f = W.front && W.front.meas;
      const hd = W.side && W.side.meas && W.side.meas.handle;
      return { height: f && f.heightMm, top: f && f.topDiaMm, bottom: f && f.bottomDiaMm, hw: hd && hd.widthMm, hy0: hd && hd.y0Mm, hy1: hd && hd.y1Mm };
    };
    const ppNum = (name, value) => `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" dir="ltr" id="pp-m-${name}" name="${name}" value="${esc(value == null ? '' : String(value))}" data-pp-num>`;
    const ppField = (name, label, value) => `<div class="field"><label for="pp-m-${name}">${esc(t(label))}</label>${ppNum(name, value)}</div>`;
    const pctOf = (typed, photo) => (typed > 0 && photo > 0 ? ((photo - typed) / typed) * 100 : null);
    function mRow([k, , label], typed, photo) {
      const p = pctOf(parse(String(typed == null ? '' : typed)), photo);
      const warn = p != null && Math.abs(p) > WARN_PCT;
      return `<div class="pp-mrow ${warn ? 'is-warn' : ''}" data-pp-row="${k}">
        <label class="pp-mlabel" for="pp-m-${k}">${esc(t(label).replace(/\s*\((mm|مم)\)\s*$/, ''))}</label>
        <div class="pp-mtyped">${ppNum(k, typed)}</div>
        <div class="pp-mphoto"><span class="pp-mlbl-sm">${esc(t('pp.col.photo'))}</span>${photo > 0 ? `<bdi data-pp-photo="${k}">${esc(mm(photo))}</bdi> <button class="btn btn-sm" type="button" data-pp-use="${k}" title="${esc(t('pp.useTitle'))}">${esc(t('pp.use'))}</button>` : `<span class="muted">${esc(t('pp.noPhotoVal'))}</span>`}</div>
        <div class="pp-mdiff" data-pp-diff="${k}"><span class="pp-mlbl-sm">${esc(t('pp.col.diff'))}</span>${p == null ? '<span class="muted">—</span>' : `<bdi dir="ltr">${esc((p > 0 ? '+' : p < 0 ? '−' : '') + POD.num(r1(Math.abs(p))) + '%')}</bdi>`}</div>
      </div>`;
    }
    STEP_HTML.measure = () => {
      if (!W.front && !W.measureErr) return `<div class="pp-wait" data-pp-wait><span class="pp-spin" aria-hidden="true"></span> ${esc(t('pp.cutting'))}</div>`;
      const ph = photoVals();
      const ty = W.form || typedOf();
      // The handle is hard to measure with a ruler: its boxes start from the side photo when empty.
      if (!W.form && sh.handle && ty.hw == null && ph.hw > 0) Object.assign(ty, { hw: r1(ph.hw), hy0: r1(ph.hy0), hy1: r1(ph.hy1) });
      const f = W.front && W.front.meas;
      const handle = Boolean(sh.handle);
      const head = `<div class="pp-mrow pp-mhead" aria-hidden="true"><span></span><span>${esc(t('pp.col.typed'))}</span><span>${esc(t('pp.col.photo'))}</span><span>${esc(t('pp.col.diff'))}</span></div>`;
      const sideNote = handle && W.side && !W.side.err && !(W.side.meas && W.side.meas.handle) ? `<p class="small pp-note">${esc(t('pp.noHandleFound'))}</p>` : '';
      return `<p class="muted small">${esc(t('pp.measureHelp'))}</p>
        ${W.measureErr ? `<div class="pp-note is-bad" data-pp-measure-err><p>${esc(t('pp.e.measure', { why: W.measureErr }))}</p><p>${esc(t('pp.typedOnly'))}</p>
          <div class="pp-row-btns"><button class="btn btn-sm" type="button" data-pp-remeasure>${esc(t('pp.retry'))}</button><button class="btn btn-sm" type="button" data-pp-goto="shots">${esc(t('pp.toShots'))}</button></div></div>` : ''}
        <form class="pp-mform" novalidate data-pp-mform>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.sizes'))}</legend>
            <div class="pp-mtable">${head}${TYPED_ROWS.map((r) => mRow(r, ty[r[0]], ph[r[0]])).join('')}</div>
            <p class="small pp-note is-warn" data-pp-diffwarn hidden>${esc(t('pp.diffWarn'))}</p>
            <p class="muted small dw-help">${esc(t('dw.diaHelp'))}</p>
            ${f && Math.abs(f.leanDeg || 0) >= 0.5 ? `<p class="muted small">${esc(t('pp.lean', { n: POD.num(r1(Math.abs(f.leanDeg))) }))}</p>` : ''}
          </fieldset>
          <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.band'))}</legend>
            <div class="pm-grid2">
              ${ppField('bandTop', 'dw.bandTop', ty.bandTop)}
              ${ppField('bandH', 'dw.bandH', ty.bandH)}
            </div>
            <p class="muted small dw-help">${esc(t('pp.bandPhoto'))}</p>
            <p class="small pp-note is-warn" data-pp-curved hidden></p>
          </fieldset>
          ${handle ? `<fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.handle'))}</legend>
            <div class="pp-mtable">${head}${HANDLE_ROWS.map((r) => mRow(r, ty[r[0]], ph[r[0]])).join('')}</div>${sideNote}
            <p class="muted small dw-help">${esc(t('dw.handleHelp'))}</p></fieldset>` : ''}
        </form>`;
    };
    STEP_AFTER.measure = () => {
      if (!W.front && !W.measureErr) { runMeasure().then(() => { if (W.step === 'measure') render(); }); return; }
      refreshMeasure();
    };
    const formVals = () => {
      const f = d.querySelector('[data-pp-mform]');
      const o = {};
      if (f) for (const el of f.querySelectorAll('[data-pp-num]')) o[el.name] = el.value;
      return o;
    };
    function refreshMeasure() {
      const vals = formVals();
      W.form = vals;
      const ph = photoVals();
      let any = false;
      for (const [k] of [...TYPED_ROWS, ...HANDLE_ROWS]) {
        const row = d.querySelector(`[data-pp-row="${k}"]`);
        if (!row) continue;
        const p = pctOf(parse(vals[k] || ''), ph[k]);
        const warn = p != null && Math.abs(p) > WARN_PCT;
        any = any || warn;
        row.classList.toggle('is-warn', warn);
        d.querySelector(`[data-pp-diff="${k}"]`).innerHTML = `<span class="pp-mlbl-sm">${esc(t('pp.col.diff'))}</span>${p == null ? '<span class="muted">—</span>' : `<bdi dir="ltr">${esc((p > 0 ? '+' : p < 0 ? '−' : '') + POD.num(r1(Math.abs(p))) + '%')}</bdi>`}`;
      }
      d.querySelector('[data-pp-diffwarn]').hidden = !any;
      // A curved side inside the print band: said (the fan is exact only on a straight cone).
      const cur = d.querySelector('[data-pp-curved]');
      const f = W.front && W.front.meas;
      const bt = parse(vals.bandTop || '');
      const bh = parse(vals.bandH || '');
      let lin = null;
      if (f && f.profile && bt >= 0 && bh > 0 && MEAS().bandLinearityMm) {
        try { lin = MEAS().bandLinearityMm(f.profile, { topMm: bt, heightMm: bh }); } catch (e) { lin = null; }
      }
      cur.hidden = !(lin > 0.5);
      if (lin > 0.5) cur.textContent = t('pp.curved', { n: POD.num(r1(lin)) });
      W.linearity = lin;
    }
    /** The typed measurements, checked like the slice-1 form (the server checks them again). */
    function typedFromForm() {
      const vals = formVals();
      const fake = { elements: {}, querySelector: (sel) => {
        if (sel.startsWith('input[name=kind]')) return { value: sh.kind };
        if (sel.startsWith('input[name=material]')) return { value: sh.material || 'gloss' };
        if (sel.startsWith('input[name=handle]')) return { value: sh.handle ? 'yes' : 'no' };
        return null;
      } };
      for (const [k, v] of Object.entries(vals)) fake.elements[k] = { value: v };
      fake.elements.gap = { value: '5' };
      fake.elements.safe = { value: '3' };
      const st = readForm(fake);
      return st;
    }
    async function nextMeasure() {
      d.querySelectorAll('[data-pp-num]').forEach((el) => { el.dataset.touched = '1'; });
      const st = typedFromForm();
      for (const el of d.querySelectorAll('[data-pp-num]')) el.setAttribute('aria-invalid', st.problems.some((p) => p.key === el.name) ? 'true' : 'false');
      if (st.problems.length) throw new Error(st.problems[0].text);
      const { m } = st;
      const typed = { heightMm: m.height, topDiaMm: m.top, bottomDiaMm: m.bottom, printTopMm: m.bandTop, printHeightMm: m.bandH, handle: handleOf(m) };
      const patch = { typed };
      const measured = measuredBlock();
      if (measured) patch.measured = measured;
      await put(patch);
      go('build');
    }
    /** What the photos measured, for the shoot (the server compares it with the typed numbers). */
    function measuredBlock() {
      const f = W.front && W.front.meas;
      if (!f) return null;
      const hd = W.side && W.side.meas && W.side.meas.handle;
      const prof = (f.profile || []).slice(0, 64).map(([y, r]) => [r1(y), r1(r)]);
      return {
        heightMm: r1(f.heightMm), topDiaMm: r1(f.topDiaMm), bottomDiaMm: r1(f.bottomDiaMm), profile: prof,
        handle: hd ? { y0Mm: r1(hd.y0Mm), y1Mm: r1(hd.y1Mm), widthMm: r1(hd.widthMm) } : null,
        bandLinearityMm: W.linearity == null ? null : Math.min(50, Math.round(W.linearity * 100) / 100),
        ...(Number.isFinite(f.leanDeg) ? { leanDeg: Math.max(-45, Math.min(45, Math.round(f.leanDeg * 100) / 100)) } : {}),
        front: frontGeom(),
      };
    }
    /** The straightened front photo's geometry (front.webp's own pixels). */
    function frontGeom() {
      const F = W.front;
      if (!F) return null;
      const g = { pxPerMm: Math.round(F.rect.pxPerMm * 10000) / 10000, axisXpx: Math.round(F.meas.axisXpx * 100) / 100, rimYpx: Math.round(F.meas.rimYpx * 100) / 100 };
      if (F.meas.baseYpx > F.meas.rimYpx) g.baseYpx = Math.round(F.meas.baseYpx * 100) / 100;
      return g;
    }

    // ----- Step 4: the drawing -----
    const frontUrl = { url: '', of: null };
    function frontPicUrl() {
      if (frontUrl.of !== W.front) {
        if (frontUrl.url) URL.revokeObjectURL(frontUrl.url);
        frontUrl.url = '';
        frontUrl.of = W.front;
      }
      return frontUrl.url;
    }
    /** The straightened front photo with the cut-out outline, the print band and the handle zone (SVG over it). */
    function buildDrawing() {
      const F = W.front;
      const ty = sh.typed || {};
      const { width: w, height: h } = F.rect.img;
      const k = F.rect.pxPerMm;
      const m = F.meas;
      const outline = (m.outline || []).map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L');
      const prof = m.profile || [];
      const rAt = (y) => (G() && prof.length ? G().radiusAt(prof, y) : null);
      const xL = (y) => m.axisXpx - (rAt(y) == null ? 0 : rAt(y) * k);
      const xR = (y) => m.axisXpx + (rAt(y) == null ? 0 : rAt(y) * k);
      const Y = (y) => m.rimYpx + y * k;
      let band = '';
      if (ty.printHeightMm > 0) {
        const a = ty.printTopMm;
        const b = ty.printTopMm + ty.printHeightMm;
        const N = 12;
        const ys = Array.from({ length: N + 1 }, (_, i) => a + ((b - a) * i) / N);
        band = `<path class="pp-o-band" d="M${ys.map((y) => `${r1(xL(y))} ${r1(Y(y))}`).join(' L')} L${ys.reverse().map((y) => `${r1(xR(y))} ${r1(Y(y))}`).join(' L')} Z"/>`;
      }
      let hz = '';
      const hd = ty.handle && typeof ty.handle === 'object' ? ty.handle : null;
      if (hd) {
        const x = xR((hd.y0Mm + hd.y1Mm) / 2);
        hz = `<rect class="pp-o-handle" x="${r1(x + 4)}" y="${r1(Y(hd.y0Mm))}" width="${r1(Math.max(12, hd.widthMm * k * 0.6))}" height="${r1((hd.y1Mm - hd.y0Mm) * k)}" rx="6"/>`;
      }
      const sw = Math.max(2, w / 300);
      return `<svg class="pp-photo-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t('pp.frontAlt'))}" style="--pp-sw:${sw}px" data-pp-front-svg>
        <image href="${esc(frontPicUrl())}" width="${w}" height="${h}" data-pp-front-img/>
        ${band}${hz}
        ${outline ? `<path class="pp-o-halo" d="M${outline} Z"/><path class="pp-o-outline" d="M${outline} Z"/>` : ''}
        <path class="pp-o-axis" d="M${r1(m.axisXpx)} ${r1(Y(0) - 10 * k)} V${r1(Y(ty.heightMm || m.heightMm) + 10 * k)}"/>
      </svg>`;
    }
    STEP_HTML.build = () => {
      if (!W.front && !W.measureErr) return `<div class="pp-wait" data-pp-wait><span class="pp-spin" aria-hidden="true"></span> ${esc(t('pp.measuring'))}</div>`;
      const mat = sh.material || (sh.kind === 'tumbler' ? 'metal' : 'gloss');
      const ty = sh.typed || {};
      const tm = { height: ty.heightMm, top: ty.topDiaMm, bottom: ty.bottomDiaMm, bandTop: ty.printTopMm, bandH: ty.printHeightMm, gap: 5, safe: 3, handle: Boolean(ty.handle), hw: ty.handle && ty.handle.widthMm, hy0: ty.handle && ty.handle.y0Mm, hy1: ty.handle && ty.handle.y1Mm };
      let fan = null;
      try { fan = G() ? G().fanOf(printOf(tm), handleOf(tm)) : null; } catch (e) { fan = null; }
      const W2 = W.built;
      const warns = W2 && W2.warnings && W2.warnings.length ? `<div class="pp-note is-warn" data-pp-warnings><b>${esc(t('pp.warnings'))}</b><ul>${W2.warnings.map((x) => `<li>${esc(warnText(x))}</li>`).join('')}</ul></div>` : '';
      return `<p class="muted small">${esc(t('pp.buildHelp'))}</p>
        <div class="pp-build">
          <figure class="pp-fig">${W.front ? buildDrawing() : `<p class="pp-note is-bad">${esc(t('pp.e.measure', { why: W.measureErr }))}</p>`}
            ${W.front ? `<figcaption class="small muted">${esc(t(W.front.source === 'server' ? 'pp.cutServer' : 'pp.cutLocal'))}</figcaption>
            <div class="dw-legend small muted"><span class="pp-lg pp-lg-outline"></span>${esc(t('pp.lgOutline'))}<span class="pp-lg pp-lg-band"></span>${esc(t('pp.lgBand'))}${ty.handle ? `<span class="pp-lg pp-lg-handle"></span>${esc(t('pp.lgHandle'))}` : ''}</div>` : ''}</figure>
          <div class="pp-build-side">
            <fieldset class="pm-fs"><legend class="pm-lbl">${esc(t('dw.material'))}</legend><div class="dw-radios" role="radiogroup">${MATERIALS.map((v) => `<label class="pm-radio"><input type="radio" name="pp-material" value="${v}" ${v === mat ? 'checked' : ''}> ${esc(t('dw.m.' + v))}</label>`).join('')}</div></fieldset>
            <figure class="dw-fig"><figcaption class="pm-lbl">${esc(t('dw.drawFan'))}</figcaption>${fanSvg(fan)}${fanFacts(fan)}</figure>
            ${warns}
          </div>
        </div>`;
    };
    STEP_AFTER.build = () => {
      if (!W.front && !W.measureErr) { runMeasure().then(() => { if (W.step === 'build') render(); }); return; }
      if (W.front && !frontPicUrl()) {
        blobOf(canvasFromPixels(W.front.rect.img), 'image/jpeg', 0.88).then((b) => {
          frontUrl.url = URL.createObjectURL(b);
          const im = d.querySelector('[data-pp-front-img]');
          if (im) im.setAttribute('href', frontUrl.url);
        }).catch(() => {});
      }
    };
    async function nextBuild() {
      const material = (d.querySelector('input[name=pp-material]:checked') || {}).value || 'gloss';
      const btn = d.querySelector('[data-pp-next]');
      btn.textContent = t('pp.building');
      // The straightened front photo and its cut-out (the shop's realistic preview uses them later).
      if (W.front) {
        const pic = await blobOf(canvasFromPixels(W.front.rect.img), 'image/jpeg', 0.9);
        const msk = await blobOf(maskCanvas(W.front.mask), 'image/png');
        saved(true);
        keep(await api(`${SHOOTS}/${enc(sh.id)}/assets/front.webp`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: pic }));
        keep(await api(`${SHOOTS}/${enc(sh.id)}/assets/front-mask.png`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: msk }));
      }
      const patch = { material };
      const measured = measuredBlock();
      if (measured) patch.measured = measured;
      await put(patch);
      const r = await api(`${SHOOTS}/${enc(sh.id)}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      keep(r);
      W.built = { warnings: (r && r.warnings) || (sh && sh.warnings) || [], fan: r && r.fan };
      POD.toast(t('pp.builtOk'));
      go('product');
    }

    // ----- Step 5: the product -----
    STEP_HTML.product = () => {
      const prices = can('prices.edit');
      const W2 = W.built || { warnings: sh.warnings || [] };
      const warns = W2 && W2.warnings && W2.warnings.length ? `<div class="pp-note is-warn" data-pp-warnings><b>${esc(t('pp.warnings'))}</b><ul>${W2.warnings.map((x) => `<li>${esc(warnText(x))}</li>`).join('')}</ul></div>` : '';
      return `<p class="muted small">${esc(t('pp.productHelp'))}</p>${warns}
        <form class="pp-pform" novalidate data-pp-pform>
          <div class="pm-grid2">
            <div class="field"><label for="pp-ar">${esc(t('pm.f.nameAr'))}</label><input type="text" id="pp-ar" name="ar" maxlength="80" dir="rtl" required></div>
            <div class="field"><label for="pp-en">${esc(t('pm.f.nameEn'))}</label><input type="text" id="pp-en" name="en" maxlength="80" dir="ltr" required></div>
            <div class="field"><label for="pp-id">${esc(t('pm.code'))}</label><input type="text" id="pp-id" name="code" maxlength="40" dir="ltr" autocapitalize="off" spellcheck="false" required value="${esc(uniqueId(sh.kind || 'tumbler'))}"><span class="muted small">${esc(t('pm.codeHelp'))}</span></div>
            ${prices ? `<div class="field"><label for="pp-price">${esc(t('dw.price'))}</label><input type="text" inputmode="decimal" autocomplete="off" dir="ltr" id="pp-price" name="price"></div>` : ''}
          </div>
        </form>`;
    };
    STEP_AFTER.product = () => {
      const code = d.querySelector('#pp-id');
      code.addEventListener('input', () => { code.value = code.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); });
    };
    async function nextProduct() {
      const f = d.querySelector('[data-pp-pform]');
      const id = f.code.value.trim().toLowerCase();
      const name = { en: f.en.value.trim(), ar: f.ar.value.trim() };
      if (!name.en || !name.ar) throw new Error(t('pm.needNames'));
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(t('pm.badCode'));
      const bodyP = { id, name, ...(sh.rev ? { rev: sh.rev } : {}) };
      if (f.elements.price) {
        const price = parse(f.elements.price.value);
        if (Number.isNaN(price)) throw new Error(t('dw.e.price'));
        if (price !== null) bodyP.price = price;
      }
      const r = await api(`${SHOOTS}/${enc(sh.id)}/product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyP) });
      const P = (r && r.product) || r;
      d.close();
      if (r && r.warning) POD.toast(t('dw.priceWarning'), 'error');
      else POD.toast(t('pp.createdOk', { name: POD.tr(P.name) }));
      onCreated(P);
    }

    // ----- Moving between steps -----
    const NEXT = { start: nextStart, shots: nextShots, measure: nextMeasure, build: nextBuild, product: nextProduct };
    const BACK = { shots: 'start', measure: 'shots', build: 'measure', product: 'build' };
    d.addEventListener('click', async (e) => {
      const nx = e.target.closest('[data-pp-next]');
      if (nx) {
        nx.disabled = true;
        fail('');
        try {
          await NEXT[W.step]();
        } catch (ex) {
          if (sentForApproval(ex)) return void d.close();
          fail(ex.message);
          renderSteps();
        } finally {
          nx.disabled = false;
          saved(false);
        }
        return undefined;
      }
      if (e.target.closest('[data-pp-back]')) return go(BACK[W.step] || 'start');
      if (e.target.closest('[data-pp-close]')) return d.close();
      const tap = e.target.closest('[data-pp-tap]');
      if (tap) {
        try { await tapCorners(tap.dataset.ppTap); } catch (ex) { fail(ex.message); }
        return undefined;
      }
      const use = e.target.closest('[data-pp-use]');
      if (use) {
        const k = use.dataset.ppUse;
        const v = photoVals()[k];
        const el = d.querySelector(`#pp-m-${k}`);
        if (el && v > 0) { el.value = String(r1(v)); refreshMeasure(); }
        return undefined;
      }
      if (e.target.closest('[data-pp-remeasure]')) { W.front = null; W.side = null; W.measureErr = ''; return render(); }
      const gt = e.target.closest('[data-pp-goto]');
      if (gt) return go(gt.dataset.ppGoto);
      return undefined;
    });
    d.addEventListener('change', (e) => {
      const f = e.target.closest('[data-pp-file]');
      if (f) takePhoto(f.dataset.ppFile, f.files && f.files[0]);
    });
    d.addEventListener('input', (e) => { if (e.target.matches('[data-pp-num]')) refreshMeasure(); });
    d.addEventListener('cancel', (e) => { if (W.busy) e.preventDefault(); });
    d.addEventListener('close', () => {
      for (const u of Object.values(thumbUrls)) if (u) URL.revokeObjectURL(u);
      if (frontUrl.url) URL.revokeObjectURL(frontUrl.url);
      d.remove();
    });
    render();
    d.showModal();
    return d;
  }

  // ---------- Tapping the card's 4 corners, with a magnifier ----------
  /** Resolves with the card worked out from 4 taps (POD_CALIB.fromTaps), or null when cancelled. */
  function tapDialog(pic, cardScale) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'pm-dlg pp-tap-dlg';
      d.setAttribute('aria-labelledby', 'pp-tap-title');
      d.innerHTML = `<div class="pp-tap-wrap">
        <div class="pp-tap-head"><h3 id="pp-tap-title">${esc(t('pp.tapTitle'))}</h3><b class="pp-tap-count" data-pp-count aria-live="polite"></b></div>
        <p class="small muted">${esc(t('pp.tapHelp'))}</p>
        <div class="pp-tap-stage" data-pp-stage dir="ltr"><canvas data-pp-tapimg></canvas><svg class="pp-tap-marks" data-pp-marks></svg><canvas class="pp-loupe" data-pp-loupe width="150" height="150" hidden></canvas></div>
        <p class="pm-err" role="alert" hidden></p>
        <div class="pp-tap-btns">
          <button class="btn" type="button" data-pp-tcancel>${esc(t('pm.cancel'))}</button>
          <button class="btn" type="button" data-pp-tundo>${esc(t('pp.tapUndo'))}</button>
          <button class="btn btn-primary" type="button" data-pp-tuse disabled>${esc(t('pp.tapUse'))}</button>
        </div></div>`;
      document.body.appendChild(d);
      const stage = d.querySelector('[data-pp-stage]');
      const cv = d.querySelector('[data-pp-tapimg]');
      const marks = d.querySelector('[data-pp-marks]');
      const loupe = d.querySelector('[data-pp-loupe]');
      const err = d.querySelector('.pm-err');
      // The photo drawn at the stage's width (sharp on a Retina screen).
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const k0 = Math.min(1, 2000 / Math.max(pic.width, pic.height));
      cv.width = Math.round(pic.width * k0);
      cv.height = Math.round(pic.height * k0);
      cv.getContext('2d').drawImage(pic, 0, 0, cv.width, cv.height);
      marks.setAttribute('viewBox', `0 0 ${pic.width} ${pic.height}`);
      // The whole photo on the screen: as wide as the dialog, or as tall as there is room for.
      const fit = () => {
        const room = stage.parentElement.clientWidth - 28;
        const tall = Math.max(240, window.innerHeight - 250);
        stage.style.width = Math.floor(Math.min(room, (tall * pic.width) / pic.height)) + 'px';
      };
      window.addEventListener('resize', fit);
      const taps = [];
      let result = null;
      const drawMarks = () => {
        const rr = Math.max(pic.width, pic.height) / 90;
        marks.innerHTML = taps.map(([x, y], i) => `<g class="pp-tap-mark"><circle cx="${x}" cy="${y}" r="${rr}"/><path d="M${x - rr * 1.6} ${y} H${x + rr * 1.6} M${x} ${y - rr * 1.6} V${y + rr * 1.6}"/><text x="${x + rr * 1.4}" y="${y - rr * 1.4}" font-size="${rr * 2.2}">${POD.num(i + 1)}</text></g>`).join('');
        d.querySelector('[data-pp-count]').textContent = t('pp.tapCount', { n: POD.num(taps.length) });
        d.querySelector('[data-pp-tuse]').disabled = taps.length !== 4;
      };
      /** The photo pixel under a pointer. */
      const at = (e) => {
        const b = cv.getBoundingClientRect();
        return [((e.clientX - b.left) / b.width) * pic.width, ((e.clientY - b.top) / b.height) * pic.height, e.clientX - stage.getBoundingClientRect().left, e.clientY - stage.getBoundingClientRect().top];
      };
      const showLoupe = (e) => {
        const [x, y, sx, sy] = at(e);
        const b = cv.getBoundingClientRect();
        const zoom = 4 * (b.width / pic.width); // 4× what is on the screen
        const size = 150;
        const src = size / zoom;
        loupe.width = size * dpr;
        loupe.height = size * dpr;
        const g = loupe.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, size, size);
        g.imageSmoothingEnabled = false;
        g.drawImage(pic, x - src / 2, y - src / 2, src, src, 0, 0, size, size);
        g.strokeStyle = '#e0301e';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(size / 2, 0); g.lineTo(size / 2, size / 2 - 8); g.moveTo(size / 2, size / 2 + 8); g.lineTo(size / 2, size);
        g.moveTo(0, size / 2); g.lineTo(size / 2 - 8, size / 2); g.moveTo(size / 2 + 8, size / 2); g.lineTo(size, size / 2);
        g.stroke();
        // Above the finger (beside it near the top), inside the stage.
        const sw = stage.clientWidth;
        let lx = sx - size / 2;
        let ly = sy - size - 40;
        if (ly < 0) { ly = sy + 40; }
        lx = Math.max(0, Math.min(sw - size, lx));
        loupe.style.width = size + 'px';
        loupe.style.height = size + 'px';
        loupe.style.left = lx + 'px';
        loupe.style.top = ly + 'px';
        loupe.hidden = false;
      };
      let down = false;
      stage.addEventListener('pointerdown', (e) => {
        if (taps.length >= 4 || e.button > 0) return;
        down = true;
        try { stage.setPointerCapture(e.pointerId); } catch (ex) { /* old browser */ }
        if (e.pointerType !== 'mouse') showLoupe(e);
        e.preventDefault();
      });
      stage.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') { if (taps.length < 4) showLoupe(e); } });
      stage.addEventListener('pointerleave', () => { if (!down) loupe.hidden = true; });
      const place = (e) => {
        if (!down) return;
        down = false;
        loupe.hidden = true;
        const [x, y] = at(e);
        if (x < 0 || y < 0 || x > pic.width || y > pic.height) return;
        taps.push([x, y]);
        err.hidden = true;
        drawMarks();
      };
      stage.addEventListener('pointerup', place);
      stage.addEventListener('pointercancel', () => { down = false; loupe.hidden = true; });
      d.querySelector('[data-pp-tundo]').addEventListener('click', () => { taps.pop(); err.hidden = true; drawMarks(); });
      d.querySelector('[data-pp-tcancel]').addEventListener('click', () => d.close());
      d.querySelector('[data-pp-tuse]').addEventListener('click', () => {
        const img = pixelsOf(pic);
        let c = null;
        try { c = CAL().fromTaps(img, taps.map(([x, y]) => [x, y]), { cardScale }); } catch (ex) { c = { ok: false, reason: 'notFound' }; }
        if (c && c.ok) { result = c; d.close(); return; }
        err.textContent = t('pp.tapFail', { why: whyText(c && c.reason) });
        err.hidden = false;
      });
      d.addEventListener('close', () => { window.removeEventListener('resize', fit); d.remove(); resolve(result); });
      drawMarks();
      d.showModal();
      fit();
    });
  }

  // ---------- Open shoots (to carry on with) ----------
  async function listShoots(api) {
    const r = await api(SHOOTS);
    const list = Array.isArray(r) ? r : (r && (r.shoots || r.list)) || [];
    return list.filter((s) => s && s.id && s.status !== 'product');
  }
  function shootsHtml(list) {
    if (!list.length) return '';
    return `<div class="pp-resume"><p class="pm-lbl">${esc(t('pp.resumeTitle'))}</p><ul>${list.map((s) => `<li>
      <span class="small">${esc(t('pp.resumeRow', { kind: t('dw.k.' + (KINDS.includes(s.kind) ? s.kind : 'tumbler')), when: whenText(s.createdAt), step: t('pp.stepName.' + (stepOf(s) === 'start' ? 'shots' : stepOf(s))) }))}</span>
      <button class="btn btn-sm" type="button" data-pp-resume="${esc(s.id)}">${esc(t('pp.resume'))}</button></li>`).join('')}</ul></div>`;
  }

  // ---------- The owner's overlay check (a product made from photos) ----------
  const isPhotoProduct = (P) => Boolean(P && P.drinkware && P.drinkware.photo && P.drinkware.photo.front);
  /**
   * The traced drawing over the real front photo: outline, print band and a test grid (rings every 10 mm, lines every
   * 30° round the cup), semi-transparent; nudges for the centre line, the top edge and the size.
   * Resolves with the checked product, or null when closed.
   */
  function overlayCheck(api, P) {
    return new Promise((resolve) => {
      const dw = P.drinkware;
      const F = dw.photo.front;
      const base = { axisXpx: F.axisXpx, rimYpx: F.rimYpx, pxPerMm: F.pxPerMm };
      const cur = { ...base };
      const dims = dw.dims || {};
      const pr = dw.print || {};
      const prof = Array.isArray(dw.profile) && dw.profile.length >= 2 ? dw.profile : [[0, dims.topDiaMm / 2], [dims.heightMm, dims.bottomDiaMm / 2]];
      const rAt = (y) => (G() ? G().radiusAt(prof, y) : dims.topDiaMm / 2 + ((dims.bottomDiaMm - dims.topDiaMm) / 2) * (y / dims.heightMm));
      const src = `/catalog-shots/${enc(P.id)}/${(dw.photo.files && dw.photo.files.find((f) => /^front\.\w+$/.test(f))) || 'front.webp'}${dw.assetsVer ? `?v=${enc(dw.assetsVer)}` : ''}`;
      const d = document.createElement('dialog');
      d.className = 'pm-dlg pp-ov-dlg';
      d.setAttribute('aria-labelledby', 'pp-ov-title');
      // Left/right and up/down on the photo, whatever the page's direction (the photo isn't mirrored).
      const nudge = (key, a, b, la, lb) => `<div class="pp-nudge" role="group" aria-label="${esc(t(key))}"><span class="pp-nudge-l">${esc(t(key))}</span>
        <span class="pp-nudge-btns" dir="ltr"><button class="btn btn-sm" type="button" data-pp-nudge="${a}">${esc(t(la))}</button><button class="btn btn-sm" type="button" data-pp-nudge="${b}">${esc(t(lb))}</button></span></div>`;
      d.innerHTML = `<div class="pp-ov-wrap">
        <div class="pp-head-row"><h3 id="pp-ov-title">${esc(t('pp.ov.title'))}</h3><button class="btn btn-sm" type="button" data-pp-ovclose>${esc(t('pp.closeShort'))}</button></div>
        <p class="small muted">${esc(t('pp.ov.help'))}</p>
        <div class="pp-ov-grid">
          <figure class="pp-ov-fig"><svg class="pp-photo-svg" viewBox="0 0 ${F.w} ${F.h}" role="img" aria-label="${esc(t('pp.ov.alt'))}" data-pp-ov-svg style="--pp-sw:${Math.max(2, F.w / 300)}px">
            <image href="${esc(src)}" width="${F.w}" height="${F.h}" data-pp-ov-img/><g class="pp-ov-draw" data-pp-ov-draw></g></svg>
            <div class="dw-legend small muted"><span class="pp-lg pp-lg-outline"></span>${esc(t('pp.lgOutline'))}<span class="pp-lg pp-lg-band"></span>${esc(t('pp.lgBand'))}<span class="pp-lg pp-lg-grid"></span>${esc(t('pp.ov.lgGrid'))}</div>
            <p class="pm-err" data-pp-ov-imgerr hidden>${esc(t('pp.ov.noPhoto'))}</p></figure>
          <div class="pp-ov-tools">
            <label class="pp-ov-op"><span>${esc(t('pp.ov.opacity'))}</span><input type="range" min="0" max="100" value="70" data-pp-opacity dir="ltr"></label>
            ${nudge('pp.ov.axis', 'axis-', 'axis+', 'pp.ov.left', 'pp.ov.right')}
            ${nudge('pp.ov.rim', 'rim-', 'rim+', 'pp.ov.up', 'pp.ov.down')}
            ${nudge('pp.ov.scale', 'scale-', 'scale+', 'pp.ov.smaller', 'pp.ov.bigger')}
            <p class="small muted" data-pp-moved aria-live="polite"></p>
            <button class="btn btn-sm" type="button" data-pp-ovreset>${esc(t('pp.ov.reset'))}</button>
          </div>
        </div>
        <p class="pm-err" role="alert" data-pp-ov-err hidden></p>
        <div class="pm-dlg-btns"><button class="btn btn-primary" type="button" data-pp-ovok>${esc(t('pp.ov.ok'))}</button></div>
      </div>`;
      document.body.appendChild(d);
      const draw = () => {
        const k = cur.pxPerMm;
        const X = (y, s) => cur.axisXpx + s * rAt(y) * k;
        const Y = (y) => cur.rimYpx + y * k;
        const N = 32;
        const H = dims.heightMm;
        const ys = Array.from({ length: N + 1 }, (_, i) => (H * i) / N);
        const outline = `M${ys.map((y) => `${r1(X(y, -1))} ${r1(Y(y))}`).join(' L')} L${ys.slice().reverse().map((y) => `${r1(X(y, 1))} ${r1(Y(y))}`).join(' L')} Z`;
        let band = '';
        let grid = '';
        if (pr.heightMm > 0) {
          const a = pr.topMm;
          const b = pr.topMm + pr.heightMm;
          const bs = Array.from({ length: 13 }, (_, i) => a + ((b - a) * i) / 12);
          band = `M${bs.map((y) => `${r1(X(y, -1))} ${r1(Y(y))}`).join(' L')} L${bs.slice().reverse().map((y) => `${r1(X(y, 1))} ${r1(Y(y))}`).join(' L')} Z`;
          // Rings every 10 mm and lines every 30° round the cup, as a design would wrap.
          for (let y = a; y <= b + 1e-6; y += 10) grid += `M${r1(X(y, -1))} ${r1(Y(y))} H${r1(X(y, 1))} `;
          for (let deg = -60; deg <= 60; deg += 30) {
            const s = Math.sin((deg * Math.PI) / 180);
            grid += `M${bs.map((y) => `${r1(cur.axisXpx + s * rAt(y) * k)} ${r1(Y(y))}`).join(' L')} `;
          }
        }
        d.querySelector('[data-pp-ov-draw]').innerHTML = `${band ? `<path class="pp-o-band" d="${band}"/><path class="pp-o-grid" d="${grid}"/>` : ''}<path class="pp-o-halo" d="${outline}"/><path class="pp-o-outline" d="${outline}"/>
          <path class="pp-o-axis" d="M${r1(cur.axisXpx)} ${r1(Y(-8))} V${r1(Y(H + 8))}"/>`;
        const moved = cur.axisXpx !== base.axisXpx || cur.rimYpx !== base.rimYpx || cur.pxPerMm !== base.pxPerMm;
        d.querySelector('[data-pp-moved]').textContent = moved ? t('pp.ov.moved', {
          a: POD.num(r1((cur.axisXpx - base.axisXpx) / base.pxPerMm)), r: POD.num(r1((cur.rimYpx - base.rimYpx) / base.pxPerMm)), s: POD.num(r1((cur.pxPerMm / base.pxPerMm - 1) * 100)),
        }) : '';
      };
      const setOpacity = (v) => { d.querySelector('[data-pp-ov-draw]').style.opacity = String(v / 100); };
      d.querySelector('[data-pp-opacity]').addEventListener('input', (e) => setOpacity(Number(e.target.value)));
      d.querySelector('[data-pp-ov-img]').addEventListener('error', () => { d.querySelector('[data-pp-ov-imgerr]').hidden = false; });
      d.addEventListener('click', async (e) => {
        const nb = e.target.closest('[data-pp-nudge]');
        if (nb) {
          const step = 0.5 * base.pxPerMm; // half a millimetre
          const [what, sign] = [nb.dataset.ppNudge.slice(0, -1), nb.dataset.ppNudge.endsWith('+') ? 1 : -1];
          if (what === 'axis') cur.axisXpx = Math.min(F.w, Math.max(0, r1(cur.axisXpx + sign * step)));
          if (what === 'rim') cur.rimYpx = Math.min(F.h, Math.max(0, r1(cur.rimYpx + sign * step)));
          if (what === 'scale') cur.pxPerMm = Math.round(Math.min(base.pxPerMm * 1.1, Math.max(base.pxPerMm * 0.9, cur.pxPerMm * (1 + sign * 0.005))) * 1000) / 1000;
          draw();
          return;
        }
        if (e.target.closest('[data-pp-ovreset]')) { Object.assign(cur, base); draw(); return; }
        if (e.target.closest('[data-pp-ovclose]')) { d.close(); return; }
        const ok = e.target.closest('[data-pp-ovok]');
        if (ok) {
          ok.disabled = true;
          const er = d.querySelector('[data-pp-ov-err]');
          er.hidden = true;
          try {
            const r = await api(`/api/admin/catalog/${enc(P.id)}/drinkware/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: { ...cur } }) });
            d.dataset.done = '1';
            d.close();
            resolve((r && r.product) || r);
          } catch (ex) {
            if (sentForApproval(ex)) { d.close(); return; }
            er.textContent = ex.message;
            er.hidden = false;
          } finally {
            ok.disabled = false;
          }
        }
      });
      d.addEventListener('close', () => { d.remove(); if (!d.dataset.done) resolve(null); });
      setOpacity(70);
      draw();
      d.showModal();
    });
  }

  window.AdminPhotoProduct = { open, sectionHtml, check, isDrinkware, needsCheck, readForm, parse, openShoot, listShoots, shootsHtml, overlayCheck, isPhotoProduct, diagramSvg };
})();
