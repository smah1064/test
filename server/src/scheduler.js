// Generates last month's report on the 1st of every month, saves it to
// data/reports/, and emails it to REPORT_EMAILS when SMTP is configured.
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const config = require('./config');
const { saveMonthlyReport } = require('./report');
const { previousMonth } = require('./util');

async function runMonthlyReport(month = previousMonth()) {
  const { report, file } = await saveMonthlyReport(month);
  console.log(`[report] Saved ${file}`);

  if (config.smtp.host && config.reportEmails.length) {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    const s = report.summary;
    const totals = s.reduce(
      (a, r) => ({ absent: a.absent + r.absent_days, late: a.late + r.late_days, blocked: a.blocked + r.blocked_attempts }),
      { absent: 0, late: 0, blocked: 0 }
    );
    await transport.sendMail({
      from: config.smtp.from,
      to: config.reportEmails.join(','),
      subject: `${report.company_name} — attendance report ${month}`,
      text:
        `Attached is the attendance report for ${month}.\n\n` +
        `Employees: ${s.length}\nTotal absent days: ${totals.absent}\nTotal late days: ${totals.late}\n` +
        `Blocked punches (fake GPS / developer mode / out of range): ${totals.blocked}\n`,
      attachments: [{ filename: path.basename(file), path: file }],
    });
    console.log(`[report] Emailed to ${config.reportEmails.join(', ')}`);
  }
  return file;
}

function startScheduler() {
  cron.schedule(
    config.reportCron,
    () => runMonthlyReport().catch((e) => console.error('[report] Monthly report failed:', e)),
    { timezone: process.env.TZ || undefined }
  );
  console.log(`[report] Monthly report scheduled (${config.reportCron}, TZ=${process.env.TZ || 'system'})`);
}

module.exports = { startScheduler, runMonthlyReport };
