/* Shared design page: friends see the design and approve it or suggest a change. */
(async () => {
  const { t, tr, esc } = POD;
  const $ = (id) => document.getElementById(id);
  const id = (location.pathname.match(/^\/s\/([A-Za-z0-9_-]{12})$/) || [])[1] || new URLSearchParams(location.search).get('id') || '';
  let share;
  try {
    share = await POD.api('/api/shares/' + encodeURIComponent(id));
  } catch (e) {
    $('share-missing').hidden = false;
    return;
  }
  $('share-body').hidden = false;
  let side = share.sides[0].id;
  const voted = (() => { try { return localStorage.getItem('pod-voted:' + share.id); } catch (e) { return null; } })();

  function when(iso) {
    try {
      return new Intl.DateTimeFormat(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  }
  function render() {
    $('share-sub').textContent = `${tr(share.productName)} · ${tr(share.color.name)} · ${tr(share.size.label)}`;
    $('share-tabs').innerHTML = share.sides.length > 1
      ? share.sides.map((s) => `<button class="side-tab ${s.id === side ? 'active' : ''}" data-side="${esc(s.id)}">${esc(tr(s.name))}</button>`).join('')
      : '';
    const cur = share.sides.find((s) => s.id === side);
    $('share-img').src = cur.preview;
    $('share-img').alt = t('share.previewAlt', { product: tr(share.productName) });
    const fb = share.feedback || [];
    $('share-replies').innerHTML = fb.length
      ? fb.slice().reverse().map((f) => `<li class="${f.vote === 'up' ? 'up' : 'change'}">
          <strong>${f.vote === 'up' ? '👍 ' + esc(t('share.approved')) : '✏️ ' + esc(t('share.wantsChange'))}</strong>
          ${f.comment ? `<p dir="auto">${esc(f.comment)}</p>` : ''}
          <span class="muted small">${f.name ? `<bdi>${esc(f.name)}</bdi> · ` : ''}${esc(when(f.at))}</span>
        </li>`).join('')
      : `<li class="muted small">${esc(t('share.noReplies'))}</li>`;
    $('share-open').href = '/editor?share=' + encodeURIComponent(share.id);
    if (voted) {
      $('vote-up').disabled = true;
      $('vote-change').disabled = true;
      $('share-thanks').hidden = false;
      $('share-thanks').textContent = t('share.thanks');
    }
  }
  let sending = false;
  async function send(vote, comment, name) {
    if (sending) return; // a double click sends one vote
    sending = true;
    $('vote-up').disabled = true;
    $('vote-change').disabled = true;
    try {
      share = await POD.api(`/api/shares/${encodeURIComponent(share.id)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote, comment, name }),
      });
    } catch (e) {
      $('vote-up').disabled = false;
      $('vote-change').disabled = false;
      throw e;
    } finally {
      sending = false;
    }
    try { localStorage.setItem('pod-voted:' + share.id, vote); } catch (e) { /* private mode */ }
    $('change-form').hidden = true;
    $('vote-up').disabled = true;
    $('vote-change').disabled = true;
    $('share-thanks').hidden = false;
    $('share-thanks').textContent = t('share.thanks');
    render();
  }

  $('share-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-side]');
    if (!b) return;
    side = b.dataset.side;
    render();
  });
  $('vote-up').addEventListener('click', async () => {
    try { await send('up', '', $('fb-name').value); } catch (err) { POD.toast(err.message, 'error'); }
  });
  $('vote-change').addEventListener('click', () => {
    $('change-form').hidden = false;
    $('fb-comment').focus();
  });
  $('change-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const comment = $('fb-comment').value.trim();
    if (!comment) return $('fb-comment').focus();
    try { await send('change', comment, $('fb-name').value); } catch (err) { POD.toast(err.message, 'error'); }
  });
  render();
  document.addEventListener('pod:langchange', render);
})();
