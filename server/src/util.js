// Small helpers shared by routes and reports. All "local" values use the
// process time zone, which config.js sets from COMPANY_TZ.

const pad = (n) => String(n).padStart(2, '0');

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Great-circle distance in metres.
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// "2026-11" -> { year, month, days: ['2026-11-01', …] }
function monthDays(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const count = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= count; d++) days.push(`${year}-${pad(month)}-${pad(d)}`);
  return { year, month, days };
}

function previousMonth(d = new Date()) {
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${pad(p.getMonth() + 1)}`;
}

function toBool(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

module.exports = { localDate, localTime, minutesOfDay, parseHHMM, haversineM, monthDays, previousMonth, toBool, pad };
