const jwt = require('jsonwebtoken');
const config = require('./config');
const { db } = require('./db');
const { t } = require('./i18n');

const DEVICE_COOKIE = 'att_device';

function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The phone/browser making the request: the app sends a header, the web page a cookie. */
function deviceIdOf(req) {
  return req.get('x-device-id') || readCookie(req, DEVICE_COOKIE);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: user.role === 'admin' ? '12h' : '30d',
  });
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: t(req, 'NOT_LOGGED_IN') });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: t(req, 'SESSION_EXPIRED') });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: t(req, 'ACCOUNT_DISABLED') });
    if (role && user.role !== role) return res.status(403).json({ error: t(req, 'NOT_ALLOWED') });

    // Employees may only use the phone their account is bound to.
    if (user.role === 'employee') {
      const deviceId = deviceIdOf(req);
      if (!deviceId || deviceId !== user.device_id) {
        return res.status(403).json({
          error: t(req, 'DEVICE_MISMATCH'),
          code: 'DEVICE_MISMATCH',
        });
      }
    }
    req.user = user;
    next();
  };
}

module.exports = { signToken, requireAuth, deviceIdOf, readCookie, DEVICE_COOKIE };
