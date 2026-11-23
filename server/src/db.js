const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

for (const dir of [config.dataDir, config.photoDir, config.reportDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  lat       REAL NOT NULL,
  lng       REAL NOT NULL,
  radius_m  REAL NOT NULL DEFAULT 150
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','admin')),
  password_hash TEXT NOT NULL,
  site_id       INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  device_id     TEXT,
  device_model  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('in','out')),
  ts          TEXT NOT NULL,           -- ISO-8601 UTC, server time
  local_date  TEXT NOT NULL,           -- YYYY-MM-DD in company time zone
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  accuracy_m  REAL,
  distance_m  REAL,
  site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  photo       TEXT NOT NULL,
  device_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance(user_id, local_date);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(local_date);

-- Every blocked punch is kept so admins can see who tried to cheat.
CREATE TABLE IF NOT EXISTS rejected_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL,
  reason    TEXT NOT NULL,
  code      TEXT NOT NULL,
  lat       REAL,
  lng       REAL,
  details   TEXT
);
CREATE INDEX IF NOT EXISTS idx_rej_ts ON rejected_attempts(ts);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Columns added after the first release
function addColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('sites', 'office_ips', "TEXT NOT NULL DEFAULT ''"); // office Wi-Fi public IPs / ranges
addColumn('attendance', 'ip', 'TEXT');
addColumn('attendance', 'via_network', 'INTEGER NOT NULL DEFAULT 0'); // 1 = verified on office Wi-Fi
addColumn('attendance', 'source', "TEXT NOT NULL DEFAULT 'app'"); // 'app' or 'web'

const DEFAULT_SETTINGS = {
  company_name: 'My Company',
  work_start: '09:00',
  work_end: '17:00',
  grace_minutes: '15',
  // JS weekday numbers: 0=Sun … 6=Sat. Change to "5,6" for a Fri/Sat weekend.
  weekend_days: '0,6',
  // Comma-separated YYYY-MM-DD dates that are not working days
  holidays: '',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function setSettings(values) {
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    for (const [k, v] of Object.entries(values)) {
      if (k in DEFAULT_SETTINGS) upd.run(String(v), k);
    }
  })();
  return getSettings();
}

// Create the first admin account if none exists.
const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
if (adminCount === 0) {
  db.prepare(
    "INSERT INTO users (emp_code, name, role, password_hash) VALUES (?, 'Administrator', 'admin', ?)"
  ).run(config.adminCode, bcrypt.hashSync(config.adminPassword, 10));
  console.warn(
    `[db] Created admin account "${config.adminCode}". Log in to the dashboard and change its password.`
  );
}

module.exports = { db, getSettings, setSettings };
