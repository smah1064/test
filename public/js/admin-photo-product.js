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

  /** The owner's "Dimensions checked" (asks first). Resolves with the product, or null when not confirmed. */
  async function check(api, P) {
    if (!confirm(t('dw.checkConfirm'))) return null;
    const r = await api(`/api/admin/catalog/${enc(P.id)}/drinkware/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return (r && r.product) || r;
  }

  window.AdminPhotoProduct = { open, sectionHtml, check, isDrinkware, needsCheck, readForm, parse };
})();
