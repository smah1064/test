/*
 * "My saved designs": one list, shown the same way under the cart and in the
 * account, of everything the customer kept to come back to:
 *  - ready to order: finished designs taken out of the cart ("save for later"),
 *    moved back to the cart with one tap;
 *  - not finished yet: designs started in the editor (kept per product, in this
 *    browser and, when signed in, on the account), opened again to carry on.
 */
window.PODSaved = (() => {
  const { t, tr, esc, money } = POD;
  let draftsPromise = null;
  const urls = [];

  /** The unfinished designs (newest first); asked for once per page, again after a change. */
  function loadDrafts(force) {
    if (force || !draftsPromise) {
      draftsPromise = (async () => {
        const [list, catalog] = await Promise.all([POD.drafts.list().catch(() => []), POD.loadCatalog().catch(() => ({ products: [] }))]);
        while (urls.length) URL.revokeObjectURL(urls.pop());
        return list.map((d) => {
          const p = (catalog.products || []).find((x) => x.id === d.productId);
          if (!p) return null;
          const c = (p.colors || []).find((x) => x.id === d.colorId) || (p.colors || [])[0];
          let fallback = '';
          try { fallback = POD.mockupUrl(p.sides[0], c ? c.hex : '#ffffff', 'full') || ''; } catch (e) { /* no drawing */ }
          let src = d.previewUrl || '';
          if (!src && d.preview instanceof Blob) {
            src = URL.createObjectURL(d.preview);
            urls.push(src);
          }
          return { ...d, product: p, color: c, src: src || fallback, fallback };
        }).filter(Boolean);
      })();
    }
    return draftsPromise;
  }

  /**
   * Draws the list into `box` (a section; hidden when there is nothing saved).
   * opts.meta / opts.price: how a ready item's details and price are written (the cart has its own);
   * opts.onToCart(designId): after a ready item went back to the cart;
   * opts.onChange(): after something was removed.
   */
  async function render(box, opts = {}) {
    if (!box) return;
    const saved = POD.getSaved();
    const drafts = await loadDrafts();
    const n = saved.length + drafts.length;
    box.hidden = !n && !opts.showEmpty;
    box.__opts = opts;
    if (!n) {
      box.innerHTML = opts.showEmpty ? `<div class="empty saved-empty"><h3>${esc(t('saved.empty'))}</h3><p class="muted">${esc(t('saved.emptyText'))}</p><a class="btn btn-primary" href="/#products">${esc(t('home.start'))}</a></div>` : '';
      return;
    }
    const meta = opts.meta || ((it) => [tr(it.colorName), tr(it.sizeLabel)].filter(Boolean).map(esc).join(' · '));
    const price = opts.price || ((it) => esc(money(it.price)));
    const ready = saved.map((it) => `
      <div class="cart-item saved-item">
        <img src="${esc(it.previewUrl)}" alt="${esc(t('cart.preview', { product: tr(it.productName) }))}" loading="lazy">
        <div>
          <h3>${esc(tr(it.productName))} <span class="saved-state ready">${esc(t('saved.readyTag'))}</span></h3>
          <div class="meta">${meta(it)}</div>
          <div class="actions">
            <button class="btn btn-sm btn-primary" type="button" data-to-cart="${esc(it.designId)}">${esc(t('cart.moveToCart'))}</button>
            <button class="btn btn-sm btn-danger" type="button" data-saved-remove="${esc(it.designId)}">${esc(t('cart.remove'))}</button>
          </div>
        </div>
        <div class="price">${price(it)}</div>
      </div>`).join('');
    const unfinished = drafts.map((d) => {
      const edit = `/editor?product=${encodeURIComponent(d.productId)}`;
      return `
      <div class="cart-item saved-item">
        <a href="${esc(edit)}" tabindex="-1" aria-hidden="true">${d.src ? `<img src="${esc(d.src)}" alt="" loading="lazy" data-fallback="${esc(d.fallback)}">` : ''}</a>
        <div>
          <h3>${esc(tr(d.product.name))} <span class="saved-state draft">${esc(t('saved.draftTag'))}</span></h3>
          <div class="meta">${d.savedAt ? esc(t('acct.draftSaved', { date: POD.date(d.savedAt) })) : ''}</div>
          <div class="actions">
            <a class="btn btn-sm btn-primary" href="${esc(edit)}">${esc(t('saved.continue'))}</a>
            <button class="btn btn-sm btn-danger" type="button" data-del-draft="${esc(d.productId)}">${esc(t('cart.remove'))}</button>
          </div>
        </div>
        <div class="price"></div>
      </div>`;
    }).join('');
    box.innerHTML = `
      <h2 class="saved-title">${esc(t('saved.title', { n: POD.num(n) }))}</h2>
      <p class="muted small">${esc(t(opts.note || 'saved.note'))}</p>
      ${saved.length ? `<h3 class="saved-group">${esc(t('saved.ready', { n: POD.num(saved.length) }))}</h3>${ready}` : ''}
      ${drafts.length ? `<h3 class="saved-group">${esc(t('saved.unfinished', { n: POD.num(drafts.length) }))}</h3>${unfinished}` : ''}`;
    if (!box.__wired) {
      box.__wired = true;
      // A preview that no longer loads: the plain product instead.
      box.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName !== 'IMG' || !img.dataset.fallback) return;
        const fb = img.dataset.fallback;
        img.dataset.fallback = '';
        img.src = fb;
      }, true);
      box.addEventListener('click', async (e) => {
        const o = box.__opts || {};
        const back = e.target.closest('[data-to-cart]');
        const del = e.target.closest('[data-saved-remove]');
        const draft = e.target.closest('[data-del-draft]');
        if (back) {
          POD.moveItem(back.dataset.toCart, false);
          POD.updateCartBadge && POD.updateCartBadge();
          if (o.onToCart) o.onToCart(back.dataset.toCart);
          else render(box, o);
        } else if (del) {
          POD.setSaved(POD.getSaved().filter((it) => it.designId !== del.dataset.savedRemove));
          if (o.onChange) o.onChange(); else render(box, o);
        } else if (draft) {
          const id = draft.dataset.delDraft;
          const d = (await loadDrafts()).find((x) => x.productId === id);
          if (!confirm(t('acct.deleteDraftConfirm', { name: d ? tr(d.product.name) : id }))) return;
          draft.disabled = true;
          // From this browser and the account (the editor would bring it back otherwise).
          await POD.drafts.remove(id);
          await loadDrafts(true);
          POD.toast(t('acct.draftDeleted'));
          if (o.onChange) o.onChange(); else render(box, o);
        }
      });
    }
  }

  return { render, loadDrafts };
})();
