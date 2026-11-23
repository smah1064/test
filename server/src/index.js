const path = require('path');
const express = require('express');
const config = require('./config');
require('./db');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/attendance', require('./routes/attendance'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Admin dashboard (static single-page app)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Server error' });
  });
  return app;
}

if (require.main === module) {
  const { startScheduler, runMonthlyReport } = require('./scheduler');
  if (process.argv[2] === 'report') {
    // Manual run: node src/index.js report 2026-10
    runMonthlyReport(process.argv[3]).then((f) => {
      console.log(f);
      process.exit(0);
    });
  } else {
    createApp().listen(config.port, () => {
      console.log(`Attendance server on http://localhost:${config.port}  (dashboard: /)`);
      startScheduler();
    });
  }
}

module.exports = { createApp };
