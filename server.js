'use strict';

const path = require('path');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = 'admin';
  console.warn('ADMIN_PASSWORD is not set; the production dashboard password is "admin". Set ADMIN_PASSWORD before going live.');
}

createApp({ dataDir, adminPassword }).listen(port, () => {
  console.log(`Print-on-demand shop running at http://localhost:${port}`);
  console.log(`Production dashboard:            http://localhost:${port}/admin`);
});
