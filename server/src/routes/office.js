// Office connector: a page (or script) on a computer in the office reports
// the office's current internet address, so offices whose provider changes
// the address ("dynamic IP") still get the office Wi-Fi check.
const express = require('express');
const { db } = require('../db');
const { clientIp, isPrivate, recordConnectorPing } = require('../network');

const router = express.Router();

// POST /api/office-ping  { token }   (token also accepted as ?token= for scripts)
router.post('/', (req, res) => {
  const token = String((req.body && req.body.token) || req.query.token || '');
  if (token.length < 20) return res.status(400).json({ error: 'Missing connector token' });
  const site = db.prepare('SELECT * FROM sites WHERE connector_token = ?').get(token);
  if (!site) return res.status(404).json({ error: 'This connector link is not valid any more. Ask the admin for the new link.' });

  const ip = clientIp(req);
  if (isPrivate(ip)) {
    return res.status(400).json({
      error: `The server sees a private address (${ip}), not the office's internet address. Check TRUST_PROXY on the server.`,
    });
  }
  const now = Date.now();
  const { list, isNew } = recordConnectorPing(site, ip, now);
  db.transaction(() => {
    db.prepare('UPDATE sites SET connector_ips = ?, connector_seen_at = ? WHERE id = ?').run(
      JSON.stringify(list), new Date(now).toISOString(), site.id
    );
    if (isNew) {
      db.prepare("INSERT INTO network_changes (site_id, ts, ip, how) VALUES (?, ?, ?, 'connector')").run(
        site.id, new Date(now).toISOString(), ip
      );
    }
  })();
  res.json({ ok: true, site: site.name, ip, changed: isNew, interval_sec: 60 });
});

module.exports = router;
