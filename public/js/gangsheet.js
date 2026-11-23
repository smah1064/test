/* DTF gang sheet builder: upload designs, set size and copies, and see them
 * nested on the film with the price by length. The server re-runs the same
 * nesting (public/js/nesting.js) to price the sheet. */
(async function () {
  'use strict';

  const { t, esc, money, toast } = POD;
  const $ = (id) => document.getElementById(id);
  const catalog = await POD.loadCatalog();
  const G = catalog.gangsheet;
  const MAX_TRIM_PIXELS = 40e6; // trimming needs a canvas; iPhones cap canvases at ~16.7 MP
  let items = [];
  let layout = null;

  function renderLead() {
    $('gang-lead').textContent = t('gang.lead', { w: G.rollWidthCm, price: money(G.pricePerMeter), min: G.minLengthCm });
  }

  // ---------- Images ----------
  const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('msg.badImage')));
    img.src = url;
  });
  const toBlob = (c) => new Promise((resolve) => c.toBlob(resolve, 'image/png'));

  /** Look for transparency and the visible area on a small copy of the image. */
  function analyse(img) {
    const s = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width;
    let y0 = c.height;
    let x1 = -1;
    let y1 = -1;
    let transparent = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const a = d[(y * c.width + x) * 4 + 3];
        if (a < 250) transparent++;
        if (a > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { hasAlpha: true, empty: true };
    const pad = 1;
    return {
      hasAlpha: transparent > c.width * c.height * 0.02,
      bbox: {
        x: Math.max(0, Math.floor((x0 - pad) / s)),
        y: Math.max(0, Math.floor((y0 - pad) / s)),
        w: Math.min(img.naturalWidth, Math.ceil((x1 - x0 + 1 + 2 * pad) / s)),
        h: Math.min(img.naturalHeight, Math.ceil((y1 - y0 + 1 + 2 * pad) / s)),
      },
    };
  }

  /** Crop empty transparent edges (they would waste film). */
  async function trim(img, info) {
    const b = info.bbox;
    if (!b || (b.w >= img.naturalWidth - 2 && b.h >= img.naturalHeight - 2) || img.naturalWidth * img.naturalHeight > MAX_TRIM_PIXELS) return null;
    const c = document.createElement('canvas');
    c.width = b.w;
    c.height = b.h;
    c.getContext('2d').drawImage(img, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    return toBlob(c);
  }

  async function makeItem(file, name) {
    const type = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
    let blob = file;
    let url = URL.createObjectURL(file);
    let img = await loadImage(url);
    const info = analyse(img);
    let trimmed = false;
    let outType = type;
    if (info.hasAlpha && !info.empty) {
      const cropped = await trim(img, info);
      if (cropped) {
        URL.revokeObjectURL(url);
        blob = cropped;
        outType = 'png';
        url = URL.createObjectURL(blob);
        img = await loadImage(url);
        trimmed = true;
      }
    }
    // Start at the size that gives 300 DPI, capped at 25 cm wide and at least 4 cm.
    const native = (img.naturalWidth / G.recommendedDpi) * 2.54;
    const wCm = Math.round(Math.min(25, Math.max(4, native)) * 10) / 10;
    const ratio = img.naturalHeight / img.naturalWidth;
    return { name: name.replace(/\.[^.]+$/, '').slice(0, 60), blob, type: outType, url, img, pxW: img.naturalWidth, pxH: img.naturalHeight, ratio, wCm, hCm: Math.round(wCm * ratio * 10) / 10, qty: 1, hasAlpha: info.hasAlpha, trimmed };
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        toast(t('msg.badType'), 'error');
        continue;
      }
      if (file.size > 60 * 1024 * 1024) {
        toast(t('msg.tooBig'), 'error');
        continue;
      }
      if (items.length >= G.maxImages) break;
      try {
        items.push(await makeItem(file, file.name));
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    render();
  }

  async function removeBg(i) {
    const it = items[i];
    busy(true, t('busy.removingBg'));
    try {
      const blob = await window.POD_FX.removeBackground(it.img);
      if (!blob) return toast(t('msg.removeBgNone'), 'error');
      const fresh = await makeItem(new File([blob], it.name + '.png', { type: 'image/png' }), it.name);
      URL.revokeObjectURL(it.url);
      items[i] = { ...fresh, wCm: it.wCm, hCm: Math.round(it.wCm * fresh.ratio * 10) / 10, qty: it.qty };
      render();
    } finally {
      busy(false);
    }
  }

  // ---------- Layout & price (same rules as the server) ----------
  function computeLayout() {
    const pieces = [];
    items.forEach((it, i) => {
      for (let c = 0; c < it.qty; c++) pieces.push({ id: `${i}:${c}`, w: it.wCm, h: it.hCm });
    });
    if (!pieces.length) return null;
    const wide = items.find((it) => Math.min(it.wCm, it.hCm) > G.rollWidthCm);
    if (wide) return { error: t('gang.tooWide', { name: wide.name, w: G.rollWidthCm }) };
    const { placements, length } = POD_NEST.pack(pieces, G.rollWidthCm, G.gapCm);
    const lengthCm = Math.max(G.minLengthCm, Math.ceil((length + G.gapCm) / G.stepCm) * G.stepCm);
    if (lengthCm > G.maxLengthCm) return { error: t('gang.tooLong') };
    const area = items.reduce((s, it) => s + it.wCm * it.hCm * it.qty, 0);
    return {
      placements: placements.map((p) => ({ ...p, item: Number(String(p.id).split(':')[0]) })),
      lengthCm,
      price: Math.round((lengthCm / 100) * G.pricePerMeter),
      pieces: pieces.length,
      used: Math.round((area / (G.rollWidthCm * lengthCm)) * 100),
    };
  }

  const dpiOf = (it) => Math.round(Math.min(it.pxW / (it.wCm / 2.54), it.pxH / (it.hCm / 2.54)));

  /** Draw the film: checkerboard for transparency, 10 cm ruler marks, every placed copy. */
  function drawSheet(canvas, lay, pxPerCm) {
    const W = Math.round(G.rollWidthCm * pxPerCm);
    const H = Math.round(lay.lengthCm * pxPerCm);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const cell = Math.max(6, Math.round(pxPerCm));
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        ctx.fillStyle = (x / cell + y / cell) % 2 ? '#eceef2' : '#f8f9fb';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(28,126,214,.35)';
    ctx.fillStyle = 'rgba(28,126,214,.7)';
    ctx.font = `${Math.max(9, pxPerCm * 1.6)}px system-ui, sans-serif`;
    for (let cm = 10; cm < lay.lengthCm; cm += 10) {
      const y = cm * pxPerCm;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W * 0.04, y);
      ctx.stroke();
      if (cm % 50 === 0) ctx.fillText(`${cm}`, 2, y - 2);
    }
    for (const p of lay.placements) {
      const it = items[p.item];
      ctx.save();
      if (p.rotated) {
        ctx.translate((p.x + p.w) * pxPerCm, p.y * pxPerCm);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(it.img, 0, 0, it.wCm * pxPerCm, it.hCm * pxPerCm);
      } else {
        ctx.drawImage(it.img, p.x * pxPerCm, p.y * pxPerCm, p.w * pxPerCm, p.h * pxPerCm);
      }
      ctx.restore();
    }
  }

  // ---------- UI ----------
  function render() {
    renderLead();
    $('gang-items').innerHTML = items.length
      ? items.map((it, i) => {
          const dpi = dpiOf(it);
          const cls = dpi >= 250 ? 'good' : dpi >= G.minDpi ? 'ok' : 'low';
          return `
          <div class="gang-item" data-i="${i}">
            <div class="gang-thumb"><img src="${it.url}" alt=""></div>
            <div class="gang-fields">
              <div class="gang-name" dir="auto">${esc(it.name)}</div>
              <div class="gang-inputs">
                <label>${esc(t('gang.width'))}<input type="number" min="1" max="${G.rollWidthCm}" step="0.5" value="${it.wCm}" data-f="w"></label>
                <label>${esc(t('gang.height'))}<input type="number" min="1" step="0.5" value="${it.hCm}" data-f="h"></label>
                <label>${esc(t('gang.qty'))}<input type="number" min="1" max="${G.maxCopies}" step="1" value="${it.qty}" data-f="q"></label>
              </div>
              <div class="gang-meta">
                <span class="quality ${cls}">${dpi} DPI</span>
                ${it.trimmed ? `<span class="muted small">✂ ${esc(t('gang.trimmed'))}</span>` : ''}
                ${!it.hasAlpha ? `<span class="small" style="color:var(--warn)">${esc(t('gang.solidBg'))}</span>` : ''}
              </div>
              <div class="gang-actions">
                ${!it.hasAlpha ? `<button class="btn btn-sm" data-act="bg">✦ ${esc(t('gang.removeBg'))}</button>` : ''}
                <button class="btn btn-sm btn-danger" data-act="del">${esc(t('gang.delete'))}</button>
              </div>
            </div>
          </div>`;
        }).join('')
      : `<p class="muted">${esc(t('gang.empty'))}</p>`;
    renderSheet();
  }

  let sheetTimer = 0;
  function renderSheet() {
    cancelAnimationFrame(sheetTimer);
    sheetTimer = requestAnimationFrame(() => {
      layout = computeLayout();
      const err = layout && layout.error;
      $('gang-error').hidden = !err;
      $('gang-error').textContent = err || '';
      $('gang-add').disabled = !layout || !!err;
      if (!layout || err) {
        $('gang-price').textContent = money(0);
        $('gang-size').textContent = '';
        $('gang-pieces').textContent = '';
        const c = $('gang-preview');
        c.width = 0;
        c.height = 0;
        return;
      }
      $('gang-price').textContent = money(layout.price);
      $('gang-size').textContent = t('gang.size', { w: POD.num(G.rollWidthCm), l: POD.num(layout.lengthCm) });
      $('gang-pieces').textContent = t('gang.pieces', { n: POD.num(layout.pieces), used: POD.num(layout.used) });
      const wrap = $('gang-preview').parentElement;
      drawSheet($('gang-preview'), layout, Math.max(3, (wrap.clientWidth - 2) / G.rollWidthCm));
    });
  }

  $('gang-items').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || !e.target.dataset.f) return;
    const it = items[Number(row.dataset.i)];
    const v = Number(e.target.value);
    if (!(v > 0)) return;
    if (e.target.dataset.f === 'w') {
      it.wCm = v;
      it.hCm = Math.round(v * it.ratio * 10) / 10;
      row.querySelector('[data-f="h"]').value = it.hCm;
    } else if (e.target.dataset.f === 'h') {
      it.hCm = v;
      it.wCm = Math.round((v / it.ratio) * 10) / 10;
      row.querySelector('[data-f="w"]').value = it.wCm;
    } else {
      it.qty = Math.min(G.maxCopies, Math.max(1, Math.floor(v)));
    }
    const dpi = dpiOf(it);
    const badge = row.querySelector('.quality');
    badge.textContent = `${dpi} DPI`;
    badge.className = 'quality ' + (dpi >= 250 ? 'good' : dpi >= G.minDpi ? 'ok' : 'low');
    renderSheet();
  });
  $('gang-items').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('[data-i]').dataset.i);
    if (btn.dataset.act === 'del') {
      URL.revokeObjectURL(items[i].url);
      items.splice(i, 1);
      render();
    }
    if (btn.dataset.act === 'bg') removeBg(i);
  });
  $('gang-file').addEventListener('change', (e) => {
    addFiles([...e.target.files]);
    e.target.value = '';
  });
  const dz = $('gang-drop');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
  window.addEventListener('resize', renderSheet);

  function busy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  }

  $('gang-add').addEventListener('click', async () => {
    if (!layout || layout.error) return;
    if (items.some((it) => dpiOf(it) < G.minDpi) && !confirm(t('gang.lowres', { dpi: G.minDpi }))) return;
    busy(true, t('busy.saving'));
    try {
      const created = await POD.api('/api/gangsheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((it) => ({ name: it.name, wCm: it.wCm, hCm: it.hCm, qty: it.qty, type: it.type })) }),
      });
      const preview = document.createElement('canvas');
      drawSheet(preview, layout, Math.min(8, 2400 / layout.lengthCm));
      const files = { 'front-preview.png': await toBlob(preview) };
      items.forEach((it, i) => (files[`src-${i}.${it.type}`] = it.blob));
      let done = 0;
      busy(true, t('busy.uploading', { n: 0, total: created.files.length }));
      await Promise.all(created.files.map(async (name) => {
        const res = await fetch(`/api/designs/${created.id}/files/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'x-upload-token': created.uploadToken, 'x-lang': POD.lang, 'Content-Type': 'application/octet-stream' },
          body: files[name],
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
        busy(true, t('busy.uploading', { n: ++done, total: created.files.length }));
      }));
      busy(true, t('busy.finishing'));
      const design = await POD.api(`/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
      const cart = POD.getCart();
      cart.push({
        designId: design.id,
        productId: design.productId,
        productName: design.productName,
        colorName: design.color.name,
        sizeLabel: design.size.label,
        sides: [t('gang.pieces', { n: layout.pieces, used: layout.used })],
        price: design.price,
        previewUrl: design.previewUrl,
        addedAt: new Date().toISOString(),
      });
      POD.setCart(cart);
      location.href = '/cart?added=1';
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy(false);
    }
  });

  document.addEventListener('pod:langchange', render);
  render();
  window.__gang = { get items() { return items; }, get layout() { return layout; } };
})();
