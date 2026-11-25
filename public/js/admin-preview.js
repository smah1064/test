/*
 * Admin → Private preview (owner only): open the shop to everyone or keep it private, and the
 * people invited before it opens, each with a personal link (src/preview.js on the server).
 * admin.js calls AdminPreview.init({ api }) once, show() when the tab opens and onLang() on a
 * language switch. Everything it shows lives in #tab-preview.
 */
window.AdminPreview = (() => {
  const { t, esc } = POD;
  const $ = (id) => document.getElementById(id);
  let api = null;
  let data = null; // { on, people: [...] }
  let fresh = ''; // the person just invited: their row is highlighted
  let said = null; // the last message under the form: { text, bad, err } (kept through a language switch)
  let drawnIn = ''; // the language the tab was last drawn in

  const box = () => $('tab-preview');
  const when = (iso) => new Date(iso).toLocaleString(POD.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const waLink = (p) => `https://wa.me/?text=${encodeURIComponent(t('pv.message', { name: p.name, link: p.link }))}`;

  function render() {
    const root = box();
    if (!root || !data) return;
    const people = data.people || [];
    drawnIn = POD.lang;
    root.innerHTML = `
      <div class="card pv-head">
        <div class="pv-head-text">
          <h2>${esc(t('pv.title'))} <span class="pv-state ${data.on ? 'on' : 'off'}">${esc(t(data.on ? 'pv.stateOn' : 'pv.stateOff'))}</span></h2>
          <p class="muted small">${esc(t('pv.help'))}</p>
        </div>
        <button class="btn ${data.on ? 'btn-primary' : ''} shrink" type="button" data-pv-switch>${esc(t(data.on ? 'pv.openAll' : 'pv.makePrivate'))}</button>
      </div>
      <form class="card pv-add" id="pv-add">
        <h3>${esc(t('pv.addTitle'))}</h3>
        <div class="pv-add-row">
          <div class="field"><label for="pv-name">${esc(t('pv.name'))}</label><input type="text" id="pv-name" maxlength="60" dir="auto" required placeholder="${esc(t('pv.namePh'))}"></div>
          <div class="field pv-own"><label for="pv-own">${esc(t('pv.ownCode'))}</label><input type="text" id="pv-own" maxlength="40" dir="ltr" autocapitalize="characters" spellcheck="false" placeholder="${esc(t('pv.ownCodePh'))}"></div>
          <button class="btn btn-primary shrink" type="submit">${esc(t('pv.add'))}</button>
        </div>
        <p class="small pv-msg" id="pv-msg" role="status"></p>
      </form>
      <h3 class="pv-list-title">${esc(t('pv.people'))} <span class="muted">(${esc(POD.num(people.length))})</span></h3>
      <div class="queue-list" id="pv-list">
        ${people.length ? people.slice().reverse().map(row).join('') : `<div class="card empty small muted">${esc(t('pv.none'))}</div>`}
      </div>`;
  }
  function row(p) {
    const seen = p.lastSeen ? t('pv.lastSeen', { when: when(p.lastSeen) }) : t('pv.never');
    const visits = p.visits ? `${POD.sep()}${POD.plural('pv.visits', p.visits)}` : '';
    return `
      <div class="queue-row pv-row ${p.off ? 'is-off' : ''} ${p.id === fresh ? 'is-new' : ''}" data-id="${esc(p.id)}">
        <div class="pv-info">
          <strong dir="auto">${esc(p.name)}</strong>${p.off ? ` <span class="pv-off-tag">${esc(t('pv.offTag'))}</span>` : ''}
          <div class="muted small">${esc(t('pv.code'))}: <code dir="ltr">${esc(p.code)}</code>${esc(POD.sep())}${esc(seen)}${esc(visits)}</div>
          <div class="pv-link" dir="ltr">${esc(p.link)}</div>
        </div>
        <div class="pv-actions">
          ${p.off ? '' : `<button class="btn btn-sm" type="button" data-pv-copy>${esc(t('pv.copy'))}</button>
          <a class="btn btn-sm pv-wa" href="${esc(waLink(p))}" target="_blank" rel="noopener">${esc(t('pv.whatsapp'))}</a>`}
          <button class="btn btn-sm" type="button" data-pv-off="${p.off ? '' : '1'}">${esc(t(p.off ? 'pv.turnOn' : 'pv.turnOff'))}</button>
          <button class="btn btn-sm btn-danger" type="button" data-pv-remove>${esc(t('pv.remove'))}</button>
        </div>
      </div>`;
  }
  const say = (text, bad, key) => {
    said = { text, bad, key };
    const m = $('pv-msg');
    if (!m) return;
    m.textContent = key ? t(key) : text;
    m.classList.toggle('bad', Boolean(bad));
  };
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // (No clipboard permission: select it from a hidden field.)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function bind() {
    const root = box();
    if (!root || root.__bound) return;
    root.__bound = true;
    root.addEventListener('submit', async (e) => {
      if (e.target.id !== 'pv-add') return;
      e.preventDefault();
      const name = $('pv-name').value.trim();
      const code = $('pv-own').value.trim();
      if (!name) return;
      try {
        const p = await api('/api/admin/preview/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...(code ? { code } : {}) }) });
        fresh = p.id;
        data = await api('/api/admin/preview');
        render();
        say('', false, 'pv.added');
        if (await copy(p.link)) POD.toast(t('pv.copied'));
      } catch (err) {
        // (The shop's refusal comes in the language asked in: its code says it again after a switch.)
        say(err.message, true, err.code && window.POD_STRINGS && window.POD_STRINGS['pv.err.' + err.code] ? 'pv.err.' + err.code : null);
      }
    });
    root.addEventListener('click', async (e) => {
      const sw = e.target.closest('[data-pv-switch]');
      const r = e.target.closest('.pv-row');
      const p = r && (data.people || []).find((x) => x.id === r.dataset.id);
      try {
        if (sw) {
          const next = !data.on;
          if (!confirm(t(next ? 'pv.confirmPrivate' : 'pv.confirmOpen'))) return;
          data = await api('/api/admin/preview', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: next }) });
          render();
        } else if (p && e.target.closest('[data-pv-copy]')) {
          POD.toast(await copy(p.link) ? t('pv.copied') : p.link);
        } else if (p && e.target.closest('[data-pv-off]')) {
          const off = Boolean(e.target.closest('[data-pv-off]').dataset.pvOff);
          if (off && !confirm(t('pv.confirmOff', { name: p.name }))) return;
          await api(`/api/admin/preview/people/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ off }) });
          data = await api('/api/admin/preview');
          render();
        } else if (p && e.target.closest('[data-pv-remove]')) {
          if (!confirm(t('pv.confirmRemove', { name: p.name }))) return;
          data = await api(`/api/admin/preview/people/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
          render();
        }
      } catch (err) {
        POD.toast(err.message, 'error');
      }
    });
  }

  /** Draws the tab again keeping the invite form as it was: both boxes, the one being typed in (with
   * its cursor) and the last message. */
  function redrawKeepingForm() {
    const kept = ['pv-name', 'pv-own'].map((id) => {
      const el = $(id);
      if (!el) return null;
      const focused = document.activeElement === el;
      return { id, value: el.value, focused, start: focused ? el.selectionStart : null, end: focused ? el.selectionEnd : null, dir: focused ? el.selectionDirection : null };
    });
    render();
    for (const k of kept) {
      const el = k && $(k.id);
      if (!el) continue;
      el.value = k.value;
      if (k.focused) {
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(k.start, k.end, k.dir || 'none'); } catch (e) { /* (no cursor to put back) */ }
      }
    }
    if (said) say(said.text, said.bad, said.key);
  }

  return {
    init(c) {
      api = c.api;
    },
    async show() {
      bind();
      const before = data && JSON.stringify(data);
      data = await api('/api/admin/preview');
      // The 15-second refresh with nothing new: the tab stays exactly as it is.
      if (before === JSON.stringify(data) && drawnIn === POD.lang && $('pv-add')) return;
      // (Something changed while the admin was typing an invite: the form keeps what was typed.)
      redrawKeepingForm();
    },
    onLang() {
      // (What was typed and the last message stay.)
      redrawKeepingForm();
    },
  };
})();
