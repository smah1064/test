// Loads configuration from environment variables (or a .env file).
// TZ must be applied before any Date is created so that "local" dates in
// reports match the company's time zone.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

if (process.env.COMPANY_TZ) process.env.TZ = process.env.COMPANY_TZ;

const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

// Which proxies may tell us the visitor's real address (X-Forwarded-For).
// This matters for the office Wi-Fi check: trusting the header from anyone
// would let a visitor claim any address. Default: only a proxy running on the
// same machine (Caddy/nginx in front of the server). On hosts like Render,
// Railway or Fly.io set TRUST_PROXY=1 (one proxy hop).
function parseTrustProxy(v) {
  if (v === undefined || v === '') return 'loopback';
  if (v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

const config = {
  port: num(process.env.PORT, 3000),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  jwtSecret: process.env.JWT_SECRET || '',
  dataDir,
  dbFile: path.join(dataDir, 'attendance.db'),
  photoDir: path.join(dataDir, 'photos'),
  reportDir: path.join(dataDir, 'reports'),

  // Anti-cheat thresholds
  maxGpsAccuracyM: num(process.env.MAX_GPS_ACCURACY_M, 100), // reject fixes less precise than this
  maxCaptureAgeSec: num(process.env.MAX_CAPTURE_AGE_SEC, 300), // selfie/GPS must be this fresh
  maxPhotoBytes: num(process.env.MAX_PHOTO_BYTES, 6 * 1024 * 1024),

  // First admin account, created on first start only
  adminCode: process.env.ADMIN_CODE || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // Monthly report email (optional)
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  reportEmails: (process.env.REPORT_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // 07:00 on the 1st of every month, company time zone
  reportCron: process.env.REPORT_CRON || '0 7 1 * *',
};

if (!config.jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  config.jwtSecret = 'dev-only-secret-change-me';
  console.warn('[config] JWT_SECRET not set — using an insecure development secret.');
}

module.exports = config;
