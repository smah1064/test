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
  let catalogIds = null; // the products the shop sells right now (Set of ids), once loaded
  let catalogNow = null; // and the catalogue itself (for similar products)
  const urls = [];
  // Products not in the shop (paused, sold out, stopped selling): why, from the shop (common.js: productState).
  const states = new Map();
  const stateOf = (id) => states.get(id) || null;
  /** Ask the shop about the products in `ids` that aren't in the catalogue (each once per page). */
  async function learnStates(ids) {
    if (!catalogIds) return;
    const ask = [...new Set(ids.filter((id) => id && !catalogIds.has(id) && !states.has(id)))];
    await Promise.all(ask.map((id) => POD.productState(id).then((info) => { states.set(id, info); })));
  }
  /** The note on a saved design whose product isn't sold now: back soon (or the day), or no longer sold. */
  function unavailNote(info, ready) {
    if (info && info.state === 'retired') return t(ready ? 'saved.retiredReady' : 'saved.retired');
    if (info && info.backOn && (info.state === 'paused' || info.state === 'soldOut')) return t('saved.pausedOn', { date: POD.backOnDay(info.backOn) });
    if (info && (info.state === 'paused' || info.state === 'soldOut')) return t('saved.paused');
    return t('saved.unavailable');
  }
  /** A product like one the shop stopped selling that opens in the editor (the same kind of product), if any. */
  function similarFor(info) {
    if (!info || info.state !== 'retired' || !catalogNow) return null;
    const { list } = POD.similarProducts({ products: (catalogNow.products || []).filter((p) => !p.kind) }, info, 1);
    return list[0] || null;
  }

  /** The unfinished designs (newest first); asked for once per page, again after a change. */
  function loadDrafts(force) {
    if (force || !draftsPromise) {
      draftsPromise = (async () => {
        const [list, catalog] = await Promise.all([POD.drafts.list().catch(() => []), POD.loadCatalog().catch(() => ({ products: [] }))]);
        while (urls.length) URL.revokeObjectURL(urls.pop());
        if (catalog.products && catalog.products.length) {
          catalogIds = new Set(catalog.products.map((x) => x.id));
          catalogNow = catalog;
        }
        // Products the shop doesn't sell right now (not in the catalogue): their names and why, for their drafts.
        await learnStates(list.map((d) => d.productId));
        return list.map((d) => {
          const p = (catalog.products || []).find((x) => x.id === d.productId);
          if (!p) {
            // A product the shop doesn't sell right now (admin → Products): kept, with a note instead of a card.
            if (!catalogIds) return null; // the catalogue didn't load: nothing to say about it
            let src = d.previewUrl || '';
            if (!src && d.preview instanceof Blob) {
              src = URL.createObjectURL(d.preview);
              urls.push(src);
            }
            const info = stateOf(d.productId);
            return { ...d, product: null, name: (info && info.name) || null, unavailable: true, src, fallback: '' };
          }
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
   * opts.onChange(): after something was removed;
   * opts.compact: one short line (title, what is in it, "Show them") that opens the whole list in place (the cart).
   */
  async function render(box, opts = {}) {
    if (!box) return;
    const saved = POD.getSaved();
    const drafts = await loadDrafts();
    // Ready items of products not sold now: why (asked once per product).
    await learnStates(saved.map((it) => it.productId));
    const n = saved.length + drafts.length;
    box.hidden = !n && !opts.showEmpty;
    box.__opts = opts;
    if (!n) {
      box.innerHTML = opts.showEmpty ? `<div class="empty saved-empty"><h3>${esc(t('saved.empty'))}</h3><p class="muted">${esc(t('saved.emptyText'))}</p><a class="btn btn-primary" href="/#products">${esc(t('home.start'))}</a></div>` : '';
      return;
    }
    const meta = opts.meta || ((it) => [tr(it.colorName), tr(it.sizeLabel)].filter(Boolean).map(esc).join(POD.sep()));
    const price = opts.price || ((it) => esc(money(it.price)));
    // A ready item whose product isn't sold now: the shop's reason (opts.unavailable, from the cart's prices) or
    // the note for it (back soon, or no longer sold).
    const gone = (it) => Boolean(catalogIds && it.productId && !catalogIds.has(it.productId));
    const note = (it) => {
      const info = gone(it) ? stateOf(it.productId) : null;
      // A product not in the shop: the note for a saved design (the cart's words speak of the cart).
      if (info) return unavailNote(info, true);
      return (opts.unavailable && opts.unavailable(it)) || '';
    };
    // No longer sold: "Move to cart" would only block the order.
    const retired = (it) => { const info = gone(it) ? stateOf(it.productId) : null; return Boolean(info && info.state === 'retired'); };
    // No longer sold: a link to similar products in the shop.
    const moreLink = (it) => {
      const info = gone(it) ? stateOf(it.productId) : null;
      if (!info || info.state !== 'retired') return '';
      const href = POD.similarHref(catalogNow, info);
      return `<a class="btn btn-sm" href="${esc(href)}">${esc(POD.similarLabel(href))}</a>`;
    };
    const ready = saved.map((it) => `
      <div class="cart-item saved-item${note(it) ? ' is-unavailable' : ''}">
        <img src="${esc(it.previewUrl)}" alt="${esc(t('cart.preview', { product: tr(it.productName) }))}" loading="lazy">
        <div>
          <h3>${esc(tr(it.productName))} ${note(it) ? `<span class="saved-state blocked">${esc(t('cart.blocked'))}</span>` : `<span class="saved-state ready">${esc(t('saved.readyTag'))}</span>`}</h3>
          <div class="meta">${meta(it)}</div>
          ${note(it) ? `<p class="unavail-note" role="note">${esc(note(it))}</p>` : ''}
          <div class="actions">
            ${retired(it) ? '' : `<button class="btn btn-sm ${note(it) ? '' : 'btn-primary'}" type="button" data-to-cart="${esc(it.designId)}">${esc(t('cart.moveToCart'))}</button>`}
            ${moreLink(it)}
            <button class="btn btn-sm btn-danger" type="button" data-saved-remove="${esc(it.designId)}">${esc(t('cart.remove'))}</button>
          </div>
        </div>
        <div class="price">${price(it)}</div>
      </div>`).join('');
    const unfinished = drafts.map((d) => {
      if (d.unavailable) {
        // Paused: kept until it's back. No longer sold: start again on a similar product (the editor can't
        // move a design off a product the shop no longer has, so the picture stays here to go by).
        const info = stateOf(d.productId);
        const like = similarFor(info);
        return `
      <div class="cart-item saved-item is-unavailable">
        ${d.src ? `<img src="${esc(d.src)}" alt="" loading="lazy">` : '<div class="saved-noimg" aria-hidden="true"></div>'}
        <div>
          <h3>${esc(d.name ? tr(d.name) : t('saved.unknownProduct'))} <span class="saved-state draft">${esc(t('saved.draftTag'))}</span></h3>
          <p class="unavail-note" role="note">${esc(unavailNote(info, false))}</p>
          <div class="meta">${d.savedAt ? esc(t('acct.draftSaved', { date: POD.date(d.savedAt) })) : ''}</div>
          <div class="actions">
            ${like ? `<a class="btn btn-sm btn-primary" href="/editor?product=${esc(encodeURIComponent(like.id))}" title="${esc(t('saved.toSimilarTitle', { name: tr(like.name) }))}">${esc(t('saved.toSimilar'))}</a>` : ''}
            <button class="btn btn-sm btn-danger" type="button" data-del-draft="${esc(d.productId)}">${esc(t('cart.remove'))}</button>
          </div>
        </div>
        <div class="price"></div>
      </div>`;
      }
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
    const list = `
      ${saved.length ? `<h3 class="saved-group">${esc(t('saved.ready', { n: POD.num(saved.length) }))}</h3>${ready}` : ''}
      ${drafts.length ? `<h3 class="saved-group">${esc(t('saved.unfinished', { n: POD.num(drafts.length) }))}</h3>${unfinished}` : ''}`;
    box.classList.toggle('saved-compact', Boolean(opts.compact));
    if (opts.compact) {
      // "My saved designs (2)" · "T-shirt، Mug · ready to order" · "Show them": the list opens under it.
      const open = Boolean(box.__open);
      const listId = (box.id || 'saved') + '-list';
      box.innerHTML = `
      <div class="saved-line">
        <div class="saved-line-text">
          <h2 class="saved-title">${esc(t('saved.title', { n: POD.num(n) }))}</h2>
          <p class="muted small saved-sum">${esc(summary(saved, drafts))}</p>
        </div>
        <button class="btn btn-sm saved-open" type="button" data-saved-open aria-expanded="${open}" aria-controls="${esc(listId)}">${esc(t(open ? 'saved.hide' : 'saved.show'))}</button>
      </div>
      <div class="saved-list" id="${esc(listId)}"${open ? '' : ' hidden'}>
        <p class="muted small">${esc(t(opts.note || 'saved.note'))}</p>
        ${open ? list : ''}
      </div>`;
    } else {
      box.innerHTML = `
      <h2 class="saved-title">${esc(t('saved.title', { n: POD.num(n) }))}</h2>
      <p class="muted small">${esc(t(opts.note || 'saved.note'))}</p>
      ${list}`;
    }
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
        const toggle = e.target.closest('[data-saved-open]');
        if (toggle) {
          box.__open = !box.__open;
          await render(box, o);
          const again = box.querySelector('[data-saved-open]');
          if (again) again.focus({ preventScroll: true });
          return;
        }
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
          if (!confirm(t('acct.deleteDraftConfirm', { name: d && d.product ? tr(d.product.name) : d && d.name ? tr(d.name) : d ? t('saved.unknownProduct') : id }))) return;
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

  /** "T-shirt، Mug +1 more · ready to order": the first names, and what they are when they are all of one kind. */
  function summary(saved, drafts) {
    const names = [...new Set([
      ...saved.map((it) => tr(it.productName)),
      ...drafts.map((d) => (d.product ? tr(d.product.name) : d.name ? tr(d.name) : t('saved.unknownProduct'))),
    ].filter(Boolean))];
    let out = names.slice(0, 2).join(POD.lang === 'ar' ? '، ' : ', ');
    if (names.length > 2) out += ' ' + t('saved.sumMore', { n: names.length - 2 });
    const kind = !drafts.length ? t('saved.sumReady') : !saved.length ? t('saved.sumDraft') : '';
    return kind ? `${out}${POD.sep()}${kind}` : out;
  }

  return { render, loadDrafts };
})();
