'use strict';

// QA tester 1 (25 Nov, 08:01–09:26): uploads are checked before they are read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../src/app');

test('a file sent to a made-up design is refused before its body is read (no memory held)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    // Says 100 MB, sends 1 KB and waits: the answer must come without the rest.
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'PUT', path: '/api/designs/00000000-0000-4000-8000-000000000000/files/front-print.png', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 100 * 1024 * 1024, 'X-Upload-Token': 'nope' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
        req.destroy();
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET' && e.code !== 'EPIPE') reject(e); });
      req.write(Buffer.alloc(1024));
      setTimeout(() => reject(new Error('no answer before the body was sent')), 4000);
    });
    assert.strictEqual(status, 404);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
