'use strict';

const path = require('path');
const { createApp } = require('./src/app');
const { weakPassword } = require('./src/security');

const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = 'admin';
  console.warn('ADMIN_PASSWORD is not set; the production dashboard password is "admin". Set ADMIN_PASSWORD before going live.');
} else if (weakPassword(adminPassword)) {
  console.warn('ADMIN_PASSWORD is easy to guess. Use 16+ characters mixing letters, numbers and symbols.');
}

// One-time changes to the shop's ready designs (each runs once, then is remembered with the shop's data):
// 'pause-no-artwork': where the shop has designs drawn with real artwork (clothes, mugs, home...), only
// those are offered; designs made only of text, shapes and icons stay on the other products (business
// cards, invitations, laser pieces...), and the ones left with no product are paused. The owner changes
// either from the admin (Ready designs).
// Private preview: the real shop starts private the first time it runs with this (only invited people,
// the owner and staff get in; the owner opens it to everyone from the dashboard). PREVIEW_LOCK=off
// skips that for test copies (QA, local runs).
createApp({ dataDir, adminPassword, libraryOnce: ['pause-no-artwork', 'unpause-artwork-enough', 'freeze-text-rule'], previewStart: process.env.PREVIEW_LOCK !== 'off' }).listen(port, () => {
  console.log(`Print-on-demand shop running at http://localhost:${port}`);
  console.log(`Production dashboard:            http://localhost:${port}/admin`);
});
