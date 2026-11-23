// Monthly attendance report: per-employee summary + per-day detail.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('./config');
const { db, getSettings } = require('./db');
const { localDate, localTime, minutesOfDay, parseHHMM, monthDays } = require('./util');

function createdLocalDate(createdAt) {
  // SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z');
  return isNaN(d) ? '0000-00-00' : localDate(d);
}

function buildMonthlyReport(ym) {
  const m = monthDays(ym);
  if (!m) throw new Error('month must be YYYY-MM');
  const s = getSettings();
  const startMin = parseHHMM(s.work_start) ?? 9 * 60;
  const endMin = parseHHMM(s.work_end) ?? 17 * 60;
  const grace = Number(s.grace_minutes) || 0;
  const weekend = new Set(String(s.weekend_days).split(',').map((x) => x.trim()).filter(Boolean).map(Number));
  const holidays = new Set(String(s.holidays).split(',').map((x) => x.trim()).filter(Boolean));
  const today = localDate();
  const first = m.days[0];
  const last = m.days[m.days.length - 1];

  const records = db
    .prepare('SELECT user_id, type, ts, local_date FROM attendance WHERE local_date BETWEEN ? AND ? ORDER BY ts')
    .all(first, last);
  const blocked = db
    .prepare(
      `SELECT r.user_id, COUNT(*) AS n FROM rejected_attempts r
        WHERE substr(r.ts, 1, 10) BETWEEN ? AND ? AND r.code IN ('DEV_MODE','MOCK_LOCATION','ROOTED','OUT_OF_RANGE','NOT_OFFICE_NETWORK')
        GROUP BY r.user_id`
    )
    .all(first, last);
  const blockedBy = new Map(blocked.map((r) => [r.user_id, r.n]));

  const userIdsWithRecords = new Set(records.map((r) => r.user_id));
  const employees = db
    .prepare(
      `SELECT u.id, u.emp_code, u.name, u.active, u.created_at, s.name AS site_name
         FROM users u LEFT JOIN sites s ON s.id = u.site_id
        WHERE u.role = 'employee' ORDER BY u.name`
    )
    .all()
    .filter((u) => u.active || userIdsWithRecords.has(u.id));

  // user_id -> date -> [records]
  const byUserDay = new Map();
  for (const r of records) {
    if (!byUserDay.has(r.user_id)) byUserDay.set(r.user_id, new Map());
    const days = byUserDay.get(r.user_id);
    if (!days.has(r.local_date)) days.set(r.local_date, []);
    days.get(r.local_date).push(r);
  }

  const summary = [];
  const daily = [];

  for (const u of employees) {
    const joined = createdLocalDate(u.created_at);
    const days = byUserDay.get(u.id) || new Map();
    const sum = {
      emp_code: u.emp_code,
      name: u.name,
      site: u.site_name || 'Any site',
      working_days: 0,
      present_days: 0,
      absent_days: 0,
      late_days: 0,
      late_minutes: 0,
      early_leave_days: 0,
      missing_checkouts: 0,
      worked_minutes: 0,
      offday_present_days: 0,
      blocked_attempts: blockedBy.get(u.id) || 0,
    };

    for (const date of m.days) {
      const [y, mo, d] = date.split('-').map(Number);
      const isOff = weekend.has(new Date(y, mo - 1, d).getDay()) || holidays.has(date);
      const isFuture = date > today;
      const beforeJoin = date < joined;
      const recs = days.get(date) || [];

      let firstIn = null;
      let lastOut = null;
      let worked = 0;
      let openIn = null;
      for (const r of recs) {
        const t = new Date(r.ts);
        if (r.type === 'in') {
          if (!firstIn) firstIn = t;
          openIn = t;
        } else if (openIn) {
          worked += (t - openIn) / 60000;
          lastOut = t;
          openIn = null;
        }
      }
      const missingOut = openIn !== null && date < today;

      let status;
      let lateBy = 0;
      if (firstIn) {
        if (isOff) {
          status = 'Present (off-day)';
          sum.offday_present_days++;
        } else {
          sum.working_days++;
          sum.present_days++;
          lateBy = Math.max(0, minutesOfDay(firstIn) - startMin);
          if (lateBy > grace) {
            status = 'Late';
            sum.late_days++;
            sum.late_minutes += lateBy;
          } else {
            status = 'Present';
            lateBy = 0;
          }
          if (lastOut && !openIn && minutesOfDay(lastOut) < endMin) sum.early_leave_days++;
        }
        sum.worked_minutes += worked;
        if (missingOut) sum.missing_checkouts++;
      } else if (isFuture) {
        status = '';
      } else if (beforeJoin) {
        status = 'Not yet employed';
      } else if (isOff) {
        status = holidays.has(date) ? 'Holiday' : 'Weekend';
      } else if (date === today) {
        status = 'Not checked in yet';
      } else {
        status = 'Absent';
        sum.working_days++;
        sum.absent_days++;
      }

      daily.push({
        emp_code: u.emp_code,
        name: u.name,
        date,
        status,
        first_in: firstIn ? localTime(firstIn) : '',
        last_out: lastOut ? localTime(lastOut) : '',
        worked_hours: worked ? +(worked / 60).toFixed(2) : 0,
        late_minutes: lateBy,
        punches: recs.length,
        note: missingOut ? 'No check-out' : '',
      });
    }

    sum.worked_hours = +(sum.worked_minutes / 60).toFixed(2);
    sum.avg_hours_per_day = sum.present_days ? +(sum.worked_hours / sum.present_days).toFixed(2) : 0;
    sum.attendance_rate = sum.working_days ? Math.round((sum.present_days / sum.working_days) * 100) : null;
    delete sum.worked_minutes;
    summary.push(sum);
  }

  const blockedList = db
    .prepare(
      `SELECT r.ts, u.emp_code, u.name, r.code, r.reason FROM rejected_attempts r
         JOIN users u ON u.id = r.user_id
        WHERE substr(r.ts, 1, 10) BETWEEN ? AND ? ORDER BY r.ts`
    )
    .all(first, last);

  return {
    month: ym,
    company_name: s.company_name,
    generated_at: new Date().toISOString(),
    settings: { work_start: s.work_start, work_end: s.work_end, grace_minutes: grace, weekend_days: s.weekend_days },
    summary,
    daily,
    blocked: blockedList,
  };
}

const SUMMARY_COLS = [
  ['emp_code', 'Employee code', 14],
  ['name', 'Name', 24],
  ['site', 'Site', 18],
  ['working_days', 'Working days', 13],
  ['present_days', 'Present', 10],
  ['absent_days', 'Absent', 10],
  ['attendance_rate', 'Attendance %', 13],
  ['late_days', 'Late days', 10],
  ['late_minutes', 'Late minutes', 13],
  ['early_leave_days', 'Left early', 11],
  ['missing_checkouts', 'No check-out', 13],
  ['worked_hours', 'Hours worked', 13],
  ['avg_hours_per_day', 'Avg hrs/day', 12],
  ['offday_present_days', 'Off-day work', 13],
  ['blocked_attempts', 'Blocked punches', 15],
];
const DAILY_COLS = [
  ['emp_code', 'Employee code', 14],
  ['name', 'Name', 24],
  ['date', 'Date', 12],
  ['status', 'Status', 18],
  ['first_in', 'First in', 10],
  ['last_out', 'Last out', 10],
  ['worked_hours', 'Hours', 8],
  ['late_minutes', 'Late (min)', 11],
  ['punches', 'Punches', 9],
  ['note', 'Note', 16],
];

async function reportToXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.company_name;
  wb.created = new Date();

  const addSheet = (title, cols, rows) => {
    const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map(([key, header, width]) => ({ key, header, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    for (const r of rows) ws.addRow(r);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };

  const sum = addSheet('Summary', SUMMARY_COLS, report.summary);
  sum.insertRow(1, [`${report.company_name} — Attendance report ${report.month}`]);
  sum.getRow(1).font = { bold: true, size: 14 };
  sum.views = [{ state: 'frozen', ySplit: 2 }];
  sum.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: SUMMARY_COLS.length } };

  const daily = addSheet('Daily detail', DAILY_COLS, report.daily);
  daily.eachRow((row, i) => {
    if (i === 1) return;
    const st = row.getCell('status').value;
    const color = st === 'Absent' ? 'FFFDE2E1' : st === 'Late' ? 'FFFFF2CC' : null;
    if (color) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });

  addSheet(
    'Blocked punches',
    [
      ['ts', 'Time (UTC)', 22],
      ['emp_code', 'Employee code', 14],
      ['name', 'Name', 24],
      ['code', 'Reason code', 16],
      ['reason', 'Message', 70],
    ],
    report.blocked
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function reportToCsv(report, which = 'summary') {
  const cols = which === 'daily' ? DAILY_COLS : SUMMARY_COLS;
  const rows = which === 'daily' ? report.daily : report.summary;
  const lines = [cols.map((c) => csvEscape(c[1])).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c[0]])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 (e.g. Arabic names) correctly
}

async function saveMonthlyReport(ym) {
  const report = buildMonthlyReport(ym);
  const file = path.join(config.reportDir, `attendance-${ym}.xlsx`);
  fs.writeFileSync(file, await reportToXlsx(report));
  return { report, file };
}

module.exports = { buildMonthlyReport, reportToXlsx, reportToCsv, saveMonthlyReport };
