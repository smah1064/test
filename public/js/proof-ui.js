/* One proof, drawn the same way at checkout and on /proof: product, colour, size or pieces,
   every printed side (mockup + the print file on a checkerboard, physical size, trim/safe lines),
   book pages, the first rows of a name list, the automatic checks and whether our team checks it.
   Needs common.js (POD) and i18n-proof.js. */
(function () {
  'use strict';
  const { esc, t, tr } = POD;
  const cm = (inches) => POD.num(Math.round(inches * 2.54 * 10) / 10);

  /** Total pieces: copies, or the sum of the colour/size lines, else 1. */
  function pieces(proof) {
    const lines = qtyLines(proof);
    const fromLines = lines.reduce((n, l) => n + Number(l.qty), 0);
    return Math.max(1, Number(proof.copies) || fromLines || (proof.merge && proof.merge.count) || 1);
  }
  function qtyLines(proof) {
    return Array.isArray(proof.quantities) ? proof.quantities.filter((l) => l && Number(l.qty) > 0) : [];
  }
  /** Black: S×2 · M×5 (one line per colour), the same look as the cart. */
  function qtyHtml(lines) {
    const groups = new Map();
    for (const l of lines) {
      const c = l.color || {};
      const key = c.id || tr(c.name) || '';
      if (!groups.has(key)) groups.set(key, { color: c, lines: [] });
      groups.get(key).lines.push(l);
    }
    return `<div class="qty-break">${[...groups.values()].map((g) => `
      <div class="qty-line">${g.color.hex ? `<span class="qty-dot" style="background:${esc(g.color.hex)}"></span>` : ''}${tr(g.color.name) ? `<span class="qty-cname">${esc(tr(g.color.name))}:</span>` : ''}
        ${g.lines.map((l) => `<span class="qty-chip">${l.size && tr(l.size.label) ? `${esc(tr(l.size.label))}×` : '×'}<b>${esc(POD.num(Number(l.qty)))}</b></span>`).join('')}
      </div>`).join('')}</div>`;
  }

  /** "3 names" with the Arabic counting forms (2 / 3–10 / the rest). */
  const namesText = (n) => t(n === 2 ? 'proof.names.two' : n % 100 >= 3 && n % 100 <= 10 ? 'proof.names.few' : 'proof.names.many', { n: POD.num(n) });
  function checkText(c, sideNames) {
    const params = { ...(c.params || {}) };
    let key = 'pf.' + c.id;
    if (c.id === 'exportSize' && params.error) key = 'pf.exportSize.error';
    if (c.id === 'outsideSafe' && !Number(params.mm)) key = params.name ? 'pf.outsideSafe.named' : 'pf.outsideSafe.edge';
    if (Array.isArray(params.fonts)) params.fonts = params.fonts.join(POD.lang === 'ar' ? '، ' : ', ');
    // Photo numbers ("4, 8, 12") in the page's digits and list commas.
    if (typeof params.photos === 'string') params.photos = params.photos.split(/\s*,\s*/).filter(Boolean).map((n) => POD.num(Number(n))).join(POD.lang === 'ar' ? '، ' : ', ');
    // Low-resolution photos: Arabic counts (1 / 2 / 3–10 / more), English one / many.
    if (c.id === 'photoLowRes' && typeof params.count === 'number') {
      const n = params.count;
      const form = n === 1 ? 'one' : n === 2 ? 'two' : n % 100 >= 3 && n % 100 <= 10 ? 'few' : 'many';
      if (t(`pf.photoLowRes.${form}`) !== `pf.photoLowRes.${form}`) key = `pf.photoLowRes.${form}`;
    }
    if (typeof params.count === 'number') params.count = POD.num(params.count);
    for (const k of ['dpi', 'mm', 'percent', 'pt', 'widthPx', 'heightPx', 'expectedW', 'expectedH', 'minDpi']) {
      if (typeof params[k] === 'number') params[k] = POD.num(params[k]);
    }
    let msg = t(key, params);
    if (msg === key) msg = t('pf.unknown', { id: c.id });
    return c.side && sideNames[c.side] ? t('proof.onSide', { side: sideNames[c.side], msg }) : msg;
  }

  const ICON = {
    pass: '<path d="M20 6 9 17l-5-5"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
    fail: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  };
  const icon = (name) => `<svg class="pf-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  function reviewWhy(review) {
    const reasons = (review && Array.isArray(review.reasons) ? review.reasons : []).filter((r) => r !== 'preflight');
    const words = reasons.map((r) => { const k = 'proof.reason.' + r; const s = t(k); return s === k ? '' : s; }).filter(Boolean);
    return words.length ? `<span class="pf-why">${esc(t('proof.reviewWhy', { list: words.join(POD.lang === 'ar' ? '، ' : ', ') }))}</span>` : '';
  }

  /** The automatic check results in plain language (+ our team's review when needed). */
  function checksHtml(proof) {
    const pf = proof.preflight || { status: 'pass', checks: [] };
    const status = ['pass', 'warn', 'fail'].includes(pf.status) ? pf.status : 'pass';
    const sideNames = Object.fromEntries((proof.sides || []).map((s) => [s.id, tr(s.name)]));
    // 'skipped': nothing to check for this kind of product (books, DTF sheets).
    const checks = (Array.isArray(pf.checks) ? pf.checks : []).filter((c) => c && c.id !== 'skipped');
    const problems = checks.filter((c) => c.level === 'warn' || c.level === 'fail');
    const infos = checks.filter((c) => c.level !== 'warn' && c.level !== 'fail');
    const review = proof.review && proof.review.needed;
    // The editor and the server can find the same problem: say each thing once. A named edge warning covers the general one on that side.
    const named = new Set(checks.filter((c) => c.id === 'outsideSafe' && c.params && c.params.name).map((c) => c.side));
    const list = (arr) => {
      const seen = new Set();
      const lines = arr.filter((c) => !(c.id === 'outsideSafe' && !(c.params && c.params.name) && !Number(c.params && c.params.mm) && named.has(c.side)))
        .map((c) => ({ c, text: checkText(c, sideNames) })).filter((x) => !seen.has(x.text) && seen.add(x.text));
      return lines.length ? `<ul>${lines.map(({ c, text }) => `<li class="pf-li-${c.level === 'fail' ? 'fail' : c.level === 'warn' ? 'warn' : 'info'}">${esc(text)}</li>`).join('')}</ul>` : '';
    };
    const lead = { pass: 'proof.st.passText', warn: 'proof.st.warnText', fail: 'proof.st.failText' }[status];
    let out = `
      <div class="pf-box pf-${status}" role="group" aria-label="${esc(t('proof.checks'))}">
        ${icon(status)}
        <div>
          <strong class="pf-head">${esc(t('proof.st.' + status))}</strong>
          ${status === 'pass' && !problems.length ? `<p>${esc(t(lead))}</p>` : `<p>${esc(t(lead))}</p>${list(problems)}`}
          ${list(infos)}
          ${status === 'fail' && review ? `<p class="pf-review-line">${esc(t('proof.review'))} ${reviewWhy(proof.review)}</p>` : ''}
        </div>
      </div>`;
    if (review && status !== 'fail') {
      out += `<div class="pf-box pf-review" role="note">${icon('info')}<div><strong>${esc(t('proof.review'))}</strong> ${reviewWhy(proof.review)}</div></div>`;
    }
    return out;
  }

  function specHtml(proof) {
    const lines = qtyLines(proof);
    const n = pieces(proof);
    const names = proof.merge && proof.merge.count;
    const rows = [[t('proof.product'), esc(tr(proof.product && proof.product.name))]];
    if (lines.length > 1) {
      rows.push([t('proof.pieces'), `<span class="qty-pieces">${esc(POD.num(n))}</span>${qtyHtml(lines)}`]);
    } else {
      const one = lines[0];
      const color = (one && one.color) || proof.color || {};
      const size = (one && one.size) || proof.size || {};
      // Products with their own word for it (business cards and photos: "Paper").
      rows.push([proof.product && proof.product.colorLabel ? tr(proof.product.colorLabel) : t('proof.color'), `${color.hex ? `<span class="qty-dot" style="background:${esc(color.hex)}"></span> ` : ''}${esc(tr(color.name))}`]);
      if (tr(size.label)) rows.push([t('proof.size'), esc(tr(size.label))]);
      if (n > 1 && !names) rows.push([t('proof.pieces'), esc(POD.num(n))]);
    }
    if (names) rows.push([t('proof.copies'), esc(namesText(names))]);
    // Embroidered chest with a printed back: both ways are listed.
    const procs = [...new Set([proof.method === 'embroidery' ? 'embroidery' : proof.process, ...(proof.sides || []).map((s) => s.process)].filter(Boolean))]
      .map((p) => 'proof.process.' + p).filter((k) => t(k) !== k);
    if (procs.length) rows.push([t('proof.method'), esc(procs.map((k) => t(k)).join(' + '))]);
    return `<dl class="proof-spec">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }

  function sideHtml(proof, s) {
    const b = Number(s.bleedIn) || 0;
    const w = Number(s.widthIn) || 0;
    const h = Number(s.heightIn) || 0;
    const fullW = w + 2 * b;
    const fullH = h + 2 * b;
    // Only the embroidered side is stitched; a printed back is sized like any print.
    const emb = proof.method === 'embroidery' && (s.process ? s.process === 'embroidery' : !proof.embSide || s.id === proof.embSide);
    const name = tr(s.name);
    const product = tr(proof.product && proof.product.name);
    // Trim and safe lines only for edge-to-edge products (paper, cards): elsewhere the edge isn't cut.
    const safe = b > 0 ? Number(s.safeIn) || 0 : 0;
    const pct = (v, of) => `${(v / of * 100).toFixed(3)}%`;
    const guides = b > 0 && fullW && fullH ? `
      <span class="pf-trim" style="inset:${pct(b, fullH)} ${pct(b, fullW)}"></span>
      ${safe ? `<span class="pf-safe" style="inset:${pct(b + safe, fullH)} ${pct(b + safe, fullW)}"></span>` : ''}` : '';
    const sizeText = w && h ? t(emb ? 'proof.size.embroidery' : 'proof.size.cm', { w: cm(w), h: cm(h) }) : '';
    return `
      <figure class="proof-side">
        <div class="proof-pics">
          ${s.previewUrl ? `<div class="proof-pic"><span class="proof-cap">${esc(t('proof.onProduct'))}</span><div class="proof-mock"><img src="${esc(s.previewUrl)}" alt="${esc(t('proof.mockupAlt', { product, side: name }))}" loading="lazy"></div></div>` : ''}
          ${s.artworkUrl ? `<div class="proof-pic"><span class="proof-cap">${esc(t('proof.printFile'))}</span>
            <div class="proof-art-box"><a class="proof-art" href="${esc(s.artworkUrl)}" target="_blank" rel="noopener" title="${esc(t('proof.openFull'))}">
              <img src="${esc(s.artworkUrl)}" alt="${esc(t('proof.artAlt', { side: name }))}" loading="lazy">${guides}
            </a></div></div>` : ''}
        </div>
        <figcaption>
          <strong>${esc(name)}</strong>
          ${sizeText ? `<span class="proof-dim" dir="auto">${esc(sizeText)}</span>` : ''}
          ${b > 0 ? `<span class="proof-sub">${esc(t('proof.bleed', { b: cm(b) }))}</span>` : ''}
          ${s.widthPx && s.heightPx && s.dpi ? `<span class="proof-sub" dir="auto">${esc(t('proof.pixels', { w: POD.num(s.widthPx), h: POD.num(s.heightPx), dpi: POD.num(s.dpi) }))}</span>` : ''}
          ${s.artworkUrl ? `<a class="proof-sub" href="${esc(s.artworkUrl)}" target="_blank" rel="noopener">${esc(t('proof.openFull'))} <span aria-hidden="true">↗</span></a>` : ''}
        </figcaption>
      </figure>`;
  }

  function mergeHtml(merge) {
    if (!merge || !merge.count) return '';
    const cols = Array.isArray(merge.columns) ? merge.columns : [];
    const rows = Array.isArray(merge.sample) ? merge.sample.slice(0, 5) : [];
    const cell = (row, col, i) => (Array.isArray(row) ? row[i] : row && typeof row === 'object' ? row[col] : i === 0 ? row : '');
    return `
      <div class="proof-names">
        <h4>${esc(namesText(merge.count))}</h4>
        ${rows.length && cols.length ? `
          <p class="muted small">${esc(t('proof.namesFirst', { n: POD.num(rows.length) }))}</p>
          <div class="proof-table-wrap"><table class="proof-table">
            <thead><tr><th scope="col">${esc(t('proof.row'))}</th>${cols.map((c) => `<th scope="col"><bdi>${esc(c)}</bdi></th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, i) => `<tr><td>${esc(POD.num(i + 1))}</td>${cols.map((c, k) => `<td><bdi>${esc(cell(r, c, k) == null ? '' : cell(r, c, k))}</bdi></td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>` : ''}
      </div>`;
  }

  function pagesHtml(pages) {
    return `
      <div class="proof-pages-wrap">
        <h4>${esc(t('proof.pages'))}</h4>
        <ol class="proof-pages">${pages.map((url, i) => `
          <li><a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(t('proof.pageAlt', { n: POD.num(i + 1) }))}" loading="lazy"></a><span>${esc(t('proof.page', { n: POD.num(i + 1) }))}</span></li>`).join('')}
        </ol>
      </div>`;
  }

  /** The whole proof (no approval controls: each page adds its own). */
  function html(proof) {
    const pages = Array.isArray(proof.pages) && proof.pages.length ? proof.pages : null;
    const sides = Array.isArray(proof.sides) ? proof.sides : [];
    const anyBleed = sides.some((s) => Number(s.bleedIn) > 0);
    return `
      <div class="proof">
        <div class="proof-top">
          ${specHtml(proof)}
          ${proof.version ? `<span class="proof-ver">${esc(t('proof.version', { v: POD.num(proof.version) }))}</span>` : ''}
        </div>
        ${checksHtml(proof)}
        ${pages ? pagesHtml(pages) : `
          <h4 class="proof-h">${esc(t('proof.sides'))}</h4>
          <div class="proof-sides">${sides.map((s) => sideHtml(proof, s)).join('')}</div>
          ${proof.photos ? '' : `<p class="proof-legend"><span class="proof-chk" aria-hidden="true"></span>${esc(t('proof.checker'))}${anyBleed ? ` ${esc(t('proof.trimLegend'))}` : ''}</p>`}`}
        ${mergeHtml(proof.merge)}
      </div>`;
  }

  /** The screen-vs-ink limitation: always shown next to an approval. */
  function screenNote({ printColours = true } = {}) {
    return `<p class="proof-screen-note">${icon('info')}<span>${esc(t('proof.screenNote'))}${printColours ? ` ${esc(t('proof.printColoursNote'))}` : ''}</span></p>`;
  }

  window.PODProof = { html, screenNote, checksHtml, pieces };
})();
