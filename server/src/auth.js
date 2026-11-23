const jwt = require('jsonwebtoken');
const config = require('./config');
const { db } = require('./db');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: user.role === 'admin' ? '12h' : '30d',
  });
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account disabled' });
    if (role && user.role !== role) return res.status(403).json({ error: 'Not allowed' });

    // Employees may only use the phone their account is bound to.
    if (user.role === 'employee') {
      const deviceId = req.get('x-device-id');
      if (!deviceId || deviceId !== user.device_id) {
        return res.status(403).json({
          error: 'This account is registered to another phone. Ask your admin to reset your device.',
          code: 'DEVICE_MISMATCH',
        });
      }
    }
    req.user = user;
    next();
  };
}

module.exports = { signToken, requireAuth };
