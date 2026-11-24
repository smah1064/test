/* /proof?t=<token>: the customer checks a new proof from the shop and approves it or asks for changes. */
(async () => {
  'use strict';
  const { esc, t, tr } = POD;
  const content = document.getElementById('content');
  const token = new URLSearchParams(location.search).get('t') || '';
  // view: 'loading' | 'gone' | 'proof' | 'done'
  const st = { view: 'loading', data: null, error: null, rejecting: false, sending: false, result: null, formError: '', ok: false, comment: '' };

  const icon = (d) => `<svg class="pf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const orderLink = (d) => (d && d.order && d.order.id ? `<a class="btn btn-primary" href="/order?id=${encodeURIComponent(d.order.id)}">${esc(t('proofPage.toOrder'))}</a>` : '');
  const statusText = (s) => { const k = 'item.' + s; return t(k) === k ? s : t(k); };

  function goneHtml(text) {
    return `
      <div class="card empty" role="alert">
        <h1 style="font-size:22px">${esc(t('proofPage.gone'))}</h1>
        <p class="muted">${esc(text || t('proofPage.goneText'))}</p>
        <a class="btn" href="/">${esc(t('proofPage.home'))}</a>
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
      content.innerHTML = goneHtml(st.error);
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
          <h2 style="font-size:20px">${esc(t(approved ? 'proofPage.doneApprove' : 'proofPage.doneReject'))}</h2>
          ${orderLink(d)}
        </div>`;
      document.getElementById('done').focus();
      return;
    }
    const waiting = !d.status || d.status === 'awaiting_approval';
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
        ${waiting ? decideHtml() : `<p class="notice" role="status">${esc(t('proofPage.notWaiting', { status: statusText(d.status) }))}</p><div>${orderLink(d)}</div>`}
      </section>`;
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }

  async function send(decision, comment) {
    st.sending = true;
    st.formError = '';
    render();
    try {
      await POD.api('/api/proofs/' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'reject' ? { decision, comment } : { decision, proofHash: st.data.proof.proofHash }),
      });
      Object.assign(st, { view: 'done', result: decision, sending: false });
    } catch (e) {
      st.sending = false;
      if (e.status === 404 || e.status === 410) Object.assign(st, { view: 'gone', error: null });
      else if (e.status === 409) {
        // A newer proof was made meanwhile (or it was already decided): show what is current.
        POD.toast(e.message, 'error');
        await load();
        return;
      } else st.formError = e.message;
    }
    render();
  }

  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || st.sending) return;
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
    if (!comment) {
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
      Object.assign(st, { view: 'gone', error: t('proofPage.noToken') });
      return render();
    }
    try {
      const data = await POD.api('/api/proofs/' + encodeURIComponent(token));
      if (!data || !data.proof || !data.order) throw Object.assign(new Error(''), { status: 404 });
      Object.assign(st, { view: 'proof', data, error: null });
    } catch (e) {
      if (e.status === 404 || e.status === 410 || e.status === 400 || e.status === 403) Object.assign(st, { view: 'gone', error: null });
      else {
        content.innerHTML = `<div class="card empty" role="alert"><p>${esc(e.message)}</p><button class="btn" type="button" id="reload">${esc(t('proof.retry'))}</button></div>`;
        document.getElementById('reload').addEventListener('click', () => location.reload());
        return;
      }
    }
    render();
  }
  await load();
  document.addEventListener('pod:langchange', render);
})();
