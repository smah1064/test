const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, requireAuth } = require('../auth');
const { t } = require('../i18n');

const router = express.Router();

// Simple in-memory brute-force guard: 10 failed attempts per code per 15 min.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyFailures(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return f.count >= 10;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

router.post('/login', (req, res) => {
  const { emp_code, password, device_id, device_model, portal } = req.body || {};
  if (!emp_code || !password) return res.status(400).json({ error: t(req, 'CODE_PASSWORD_REQUIRED') });
  const key = String(emp_code).toLowerCase();
  if (tooManyFailures(key)) return res.status(429).json({ error: t(req, 'TOO_MANY_ATTEMPTS') });

  const user = db.prepare('SELECT * FROM users WHERE emp_code = ?').get(String(emp_code).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    recordFailure(key);
    return res.status(401).json({ error: t(req, 'WRONG_CREDENTIALS') });
  }
  if (!user.active) return res.status(403).json({ error: t(req, 'ACCOUNT_DISABLED') });
  failures.delete(key);

  if (portal === 'admin' && user.role !== 'admin') {
    return res.status(403).json({ error: 'This account is not an admin' });
  }

  if (user.role === 'employee') {
    if (!device_id) return res.status(400).json({ error: t(req, 'USE_MOBILE_APP') });
    if (!user.device_id) {
      // First login: bind the account to this phone.
      db.prepare('UPDATE users SET device_id = ?, device_model = ? WHERE id = ?').run(
        String(device_id),
        device_model ? String(device_model).slice(0, 120) : null,
        user.id
      );
      user.device_id = device_id;
    } else if (user.device_id !== device_id) {
      return res.status(403).json({
        error: t(req, 'DEVICE_MISMATCH'),
        code: 'DEVICE_MISMATCH',
      });
    }
  }

  res.json({
    token: signToken(user),
    user: { id: user.id, emp_code: user.emp_code, name: user.name, role: user.role },
  });
});

router.post('/change-password', requireAuth(), (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (!bcrypt.compareSync(String(current_password || ''), req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
