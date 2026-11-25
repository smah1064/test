/* /proof?t=<token>: the customer checks a new proof from the shop and approves it or asks for changes. */
(async () => {
  'use strict';
  const { esc, t, tr } = POD;
  const content = document.getElementById('content');
  const token = new URLSearchParams(location.search).get('t') || '';
  // The customer's proof link carries the order's key (the shop's own copy doesn't).
  const linkKey = new URLSearchParams(location.search).get('k') || '';
  // view: 'loading' | 'gone' | 'failed' | 'replaced' | 'proof' | 'done'
  // 'replaced': the shop sent a newer proof while this page was open, so the answer could not be sent.
  // 'failed': the proof could not be loaded (no connection, the site busy): st.failure is the error, with "Try again".
  // error: the key of the text under "This proof link no longer works" (a key, so it follows a language switch).
  // editable: after "Request changes", the item is editor-made, so the customer can edit it themselves from the order page.
  const st = { view: 'loading', data: null, error: null, failure: null, rejecting: false, sending: false, result: null, formError: '', ok: false, comment: '', unsent: '', editable: false };

  const icon = (d) => `<svg class="pf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // The order page: with its key when this device has it (the customer's own orders); else their email's link or account opens it.
  const orderHref = (id) => POD.orderPath('order', id, POD.orderKey(id, linkKey));
  const orderLink = (d) => (d && d.order && d.order.id ? `<a class="btn btn-primary" href="${esc(orderHref(d.order.id))}">${esc(t('proofPage.toOrder'))}</a>` : '');
  const statusText = (s) => { const k = 'item.' + s; return t(k) === k ? s : t(k); };

  function goneHtml(text) {
    return `
      <div class="card empty" role="alert">
        <h1 style="font-size:22px">${esc(t('proofPage.gone'))}</h1>
        <p class="muted">${esc(text || t('proofPage.goneText'))}</p>
        <a class="btn" href="/">${esc(t('proofPage.home'))}</a>
      </div>`;
  }

  /** The answer could not be sent because this link was replaced by a newer proof:
   *  say so, keep what they typed (to copy), and lead to the order page. */
  function replacedHtml() {
    const d = st.data;
    const orderId = d && d.order && d.order.id;
    return `
      <div class="card" role="alert" style="margin:40px auto;max-width:620px;padding:24px;display:grid;gap:12px">
        <h1 style="font-size:22px;margin:0">${esc(t('proofPage.replaced'))}</h1>
        <p class="muted" style="margin:0;line-height:1.6">${esc(t(orderId ? 'proofPage.replacedText' : 'proofPage.replacedTextNoOrder'))}</p>
        ${st.unsent ? `
        <div style="display:grid;gap:6px">
          <label for="unsent" style="font-weight:600;font-size:14px">${esc(t('proofPage.unsent'))}</label>
          <textarea id="unsent" rows="4" readonly dir="auto">${esc(st.unsent)}</textarea>
          <div><button class="btn btn-sm" type="button" data-act="copy">${esc(t('proofPage.copy'))}</button></div>
        </div>` : ''}
        <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap">
          ${orderLink(d)}
          <a class="btn" href="/">${esc(t('proofPage.home'))}</a>
        </div>
      </div>`;
  }

  function decideHtml() {
    if (st.rejecting) {
      return `
        <form class="reject-box" id="reject-form" novalidate>
          <label for="comment">${esc(t('proofPage.comment'))}</label>
          <textarea id="comment" rows="4" maxlength="1000" placeholder="${esc(t('proofPage.commentPh'))}" aria-describedby="form-err"${st.formError ? ' aria-invalid="true"' : ''}>${esc(st.comment)}</textarea>
          <p class="form-err" id="form-err" role="alert">${esc(st.formError)}</p>
          <div class="row-btns">
            <button class="btn btn-primary" type="submit"${st.sending ? ' disabled' : ''}>${esc(t(st.sending ? 'proofPage.sending' : 'proofPage.send'))}</button>
            <button class="btn" type="button" data-act="cancel"${st.sending ? ' disabled' : ''}>${esc(t('proofPage.cancel'))}</button>
          </div>
        </form>`;
    }
    return `
      <label class="approve-check" for="ok"><input type="checkbox" id="ok"${st.ok ? ' checked' : ''} aria-describedby="form-err"><span>${esc(t('proof.ok'))}</span></label>
      <p class="form-err" id="form-err" role="alert">${esc(st.formError)}</p>
      <div class="decide-actions">
        <button class="btn btn-ok btn-lg" type="button" data-act="approve"${st.sending ? ' disabled' : ''}>${esc(t(st.sending ? 'proofPage.sending' : 'proofPage.approve'))}</button>
        <button class="btn btn-lg" type="button" data-act="reject"${st.sending ? ' disabled' : ''}>${esc(t('proofPage.reject'))}</button>
      </div>`;
  }

  function render() {
    if (st.view === 'loading') return;
    if (st.view === 'gone') {
      content.innerHTML = goneHtml(st.error && t(st.error));
      return;
    }
    if (st.view === 'failed') {
      const e = st.failure;
      content.innerHTML = `<div class="card empty" role="alert"><p>${esc(e.network ? t('msg.network') : e.message)}</p><button class="btn" type="button" data-act="reload">${esc(t('proof.retry'))}</button></div>`;
      return;
    }
    if (st.view === 'replaced') {
      content.innerHTML = replacedHtml();
      return;
    }
    const d = st.data;
    const head = `
      <div class="page-head">
        <h1>${esc(t('proofPage.title'))}</h1>
        <p><strong>${esc(t('proofPage.for', { n: d.order.number, pos: POD.num(d.item.position || 1), product: tr(d.item.productName || (d.proof.product && d.proof.product.name)) }))}</strong></p>
        <p class="muted">${esc(t('proofPage.intro'))}</p>
      </div>`;
    if (st.view === 'done') {
      const approved = st.result === 'approve';
      content.innerHTML = `${head}
        <div class="card proof-done ${approved ? 'approved' : 'rejected'}" role="status" tabindex="-1" id="done">
          ${icon(approved ? '<circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/>' : '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>')}
          <h2 style="font-size:20px">${esc(t(approved ? 'proofPage.doneApprove' : st.editable ? 'proofPage.doneRejectEdit' : 'proofPage.doneReject'))}</h2>
          ${!approved && st.editable && st.reviseLink ? `<a class="btn btn-primary" href="${esc(st.reviseLink)}">${esc(t('item.editResend'))}</a>` : !approved && st.editable ? `<a class="btn btn-primary" href="${esc(orderHref(d.order.id))}">${esc(t('proofPage.toOrderEdit'))}</a>` : orderLink(d)}
        </div>`;
      document.getElementById('done').focus();
      return;
    }
    const waiting = !d.status || d.status === 'awaiting_approval';
    // (Opened again after "Ask for changes": the item's edit link, as right after asking. QA 25 Nov.)
    const editAgain = (x) => {
      const rl = x.status === 'changes_requested' && typeof x.reviseLink === 'string' && /^\/editor\?design=[\w-]+&revise=[\w.-]+&rt=[\w-]+$/.test(x.reviseLink) ? x.reviseLink : null;
      const k = x.order && x.order.id ? POD.orderKey(x.order.id, linkKey) : '';
      return rl ? `<a class="btn btn-primary" href="${esc(rl + (k ? `&k=${encodeURIComponent(k)}` : ''))}">${esc(t('item.editResend'))}</a>` : '';
    };
    const focused = document.activeElement && document.activeElement.id;
    content.innerHTML = `${head}
      ${d.note ? `<div class="shop-note" role="note"><strong>${esc(t('proofPage.note'))}</strong><p dir="auto">${esc(d.note)}</p></div>` : ''}
      <section class="card proof-card" aria-labelledby="proof-h">
        <h2 id="proof-h" style="font-size:18px;margin:0">${esc(t('proof.title'))}</h2>
        ${PODProof.html(d.proof)}
      </section>
      <section class="card proof-card" style="margin-top:16px" aria-labelledby="decide-h">
        <h2 id="decide-h" style="font-size:18px;margin:0">${esc(t('proofPage.decide'))}</h2>
        ${PODProof.screenNote()}
        ${waiting && d.team ? `<p class="notice" role="status">${esc(t('proofPage.team'))}</p>` : waiting ? decideHtml() : `<p class="notice" role="status">${esc(t('proofPage.notWaiting', { status: statusText(d.status) }))}</p><div>${editAgain(d) || orderLink(d)}</div>`}
      </section>`;
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }

  async function send(decision, comment) {
    st.sending = true;
    st.formError = '';
    render();
    try {
      // (With the order's key when the link has it: a team member's own order, opened from its email, still decides.)
      const oid = st.data.order && st.data.order.id;
      const r = await POD.api('/api/proofs/' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(oid ? POD.orderHeaders(POD.orderKey(oid, linkKey)) : {}) },
        body: JSON.stringify(decision === 'reject' ? { decision, comment } : { decision, proofHash: st.data.proof.proofHash }),
      });
      if (r && r.orderId && st.data.order && !st.data.order.id) st.data.order.id = r.orderId;
      // Changes asked for: an editor-made item can be edited and sent again from the order page (as that page offers).
      if (decision === 'reject') st.editable = r && typeof r.editable === 'boolean' ? r.editable : await canEditOnOrderPage(r && r.orderId);
      // Straight to the editor for this item (works on any phone, also without the order's link); the key goes
      // along when this page has it, so the editor can go back to the order page afterwards.
      const rl = r && typeof r.reviseLink === 'string' && /^\/editor\?design=[\w-]+&revise=[\w.-]+&rt=[\w-]+$/.test(r.reviseLink) ? r.reviseLink : null;
      const k = st.data.order && st.data.order.id ? POD.orderKey(st.data.order.id, linkKey) : '';
      st.reviseLink = rl ? rl + (k ? `&k=${encodeURIComponent(k)}` : '') : null;
      Object.assign(st, { view: 'done', result: decision, sending: false });
    } catch (e) {
      st.sending = false;
      // The link stopped working while the page was open (a newer proof replaced it):
      // keep what they typed and point them to the order page.
      if (e.status === 404 || e.status === 410) Object.assign(st, { view: 'replaced', unsent: decision === 'reject' ? comment : '' });
      else if (e.status === 409) {
        // A newer proof was made meanwhile (or it was already decided): show what is current.
        POD.toast(e.message, 'error');
        await load();
        return;
      } else st.formError = e.message;
    }
    render();
  }

  /** Does the order page offer "Edit the design and send it again" for this item? (Same rule as that page.) */
  async function canEditOnOrderPage(orderId) {
    const id = orderId || (st.data.order && st.data.order.id);
    if (!id) return false;
    try {
      const o = await POD.api('/api/orders/' + encodeURIComponent(id), { headers: POD.orderHeaders(POD.orderKey(id, linkKey)) });
      const it = (o.items || []).find((x) => x.id === st.data.item.id);
      return Boolean(it && it.status === 'changes_requested' && it.kind === 'product' && /^[0-9a-f-]{36}$/i.test(it.designId || ''));
    } catch (e) {
      return false;
    }
  }

  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || st.sending) return;
    if (b.dataset.act === 'reload') {
      location.reload();
      return;
    }
    if (b.dataset.act === 'copy') {
      copyUnsent();
      return;
    }
    if (b.dataset.act === 'approve') {
      if (!st.ok) {
        st.formError = t('proofPage.needOk');
        render();
        document.getElementById('ok').focus();
        return;
      }
      send('approve');
    } else if (b.dataset.act === 'reject') {
      Object.assign(st, { rejecting: true, formError: '' });
      render();
      document.getElementById('comment').focus();
    } else if (b.dataset.act === 'cancel') {
      Object.assign(st, { rejecting: false, formError: '' });
      render();
      const r = content.querySelector('[data-act="reject"]');
      if (r) r.focus();
    }
  });
  async function copyUnsent() {
    const box = document.getElementById('unsent');
    try {
      await navigator.clipboard.writeText(st.unsent);
      POD.toast(t('proofPage.copied'));
    } catch (err) {
      // No clipboard access (http, old browser): select the text for a manual copy.
      box.focus();
      box.select();
      POD.toast(t('proofPage.copyFailed'), 'error');
    }
  }
  content.addEventListener('change', (e) => {
    if (e.target.id === 'ok') {
      st.ok = e.target.checked;
      if (st.ok && st.formError) { st.formError = ''; document.getElementById('form-err').textContent = ''; }
    }
  });
  content.addEventListener('input', (e) => { if (e.target.id === 'comment') st.comment = e.target.value; });
  content.addEventListener('submit', (e) => {
    if (e.target.id !== 'reject-form') return;
    e.preventDefault();
    const comment = st.comment.trim();
    // (Words or numbers, not only spaces or invisible marks: the shop needs to know what to change.)
    if (!/[\p{L}\p{N}]/u.test(comment.replace(/[\u061c\u0640\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ''))) {
      st.formError = t('proofPage.commentNeeded');
      render();
      document.getElementById('comment').focus();
      return;
    }
    send('reject', comment);
  });
  // A picture whose file is gone: keep the grey box, not a broken-image icon.
  content.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

  async function load() {
    if (!token) {
      Object.assign(st, { view: 'gone', error: 'proofPage.noToken' });
      return render();
    }
    try {
      const data = await POD.api('/api/proofs/' + encodeURIComponent(token), { headers: POD.orderHeaders(linkKey) });
      if (!data || !data.proof || !data.order) throw Object.assign(new Error(''), { status: 404 });
      Object.assign(st, { view: 'proof', data, error: null });
    } catch (e) {
      if (e.status === 404 || e.status === 410 || e.status === 400 || e.status === 403) Object.assign(st, { view: 'gone', error: null });
      else Object.assign(st, { view: 'failed', failure: e });
    }
    render();
  }
  await load();
  document.addEventListener('pod:langchange', render);
})();
