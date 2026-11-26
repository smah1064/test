'use strict';

/**
 * Admin routes for the editable words of uploaded designs (src/words.js). Mounted by src/app.js:
 *
 *   const words = require('./words-routes').mount(app, { library, guard: requireCatalog, HttpError });
 *   ... after a design is published from a zip: words.enqueue(designId);
 *
 *   GET  /api/admin/library/words      { enabled, dailyMax, usedToday, designs: { id: { status, error, at } } }
 *   POST /api/admin/library/:id/words  { action: 'retry' | 'keep' | 'use' } → { id, status, error, at }
 *
 * 'retry': try again (after a failure or "no words found"); 'keep': keep the original lettering (the picture as
 * uploaded); 'use': back to the editable words. Who may use them: src/roles.js (as for uploads).
 */
const express = require('express');
const words = require('./words');

const ACTIONS = new Set(['retry', 'keep', 'use']);

/**
 * deps: { library, guard (the admin gate), HttpError, queue? (a WordsQueue; made here when not given),
 * start? (look for work now and every minute; default true) }. Gives { enqueue(designId), queue }.
 */
function mount(app, { library, guard, HttpError, queue = null, start = true }) {
  const q = queue || words.createQueue({ library });
  app.get('/api/admin/library/words', guard, (req, res) => {
    res.json(q.state());
  });
  app.post('/api/admin/library/:id/words', guard, express.json({ limit: '1kb' }), (req, res) => {
    const action = String((req.body && req.body.action) || '');
    if (!ACTIONS.has(action)) throw new HttpError(400, 'badRequest');
    const id = String(req.params.id);
    const r = q.act(id, action);
    if (!r) throw new HttpError(404, 'wordsNotUploaded');
    if (r.refused) throw new HttpError(r.refused === 'badRequest' ? 400 : r.refused === 'wordsNotUploaded' ? 404 : 409, r.refused);
    const now = q.state().designs[id] || {};
    res.json({ id, status: now.status || r.status, error: now.error || null, at: now.at || null });
  });
  if (start) q.start();
  return { enqueue: (designId) => q.enqueue(designId), queue: q };
}

module.exports = { mount };
