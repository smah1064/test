/* Rights holders ask for a design to be taken down. */
(() => {
  const $ = (id) => document.getElementById(id);
  $('tk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('tk-form').querySelector('button');
    btn.disabled = true;
    try {
      await POD.api('/api/takedown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('tk-name').value, contact: $('tk-contact').value, owner: $('tk-owner').value, link: $('tk-link').value, details: $('tk-details').value }),
      });
      $('tk-form').hidden = true;
      $('tk-done').hidden = false;
    } catch (err) {
      POD.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
