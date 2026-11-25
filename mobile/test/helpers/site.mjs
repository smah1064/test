// Starts a private copy of the shop (the website in this repository) for the tests, on a free port, with its own
// empty data folder, the preview lock off and Google sign-in "configured" (so the account page shows the button).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function startSite() {
  if (!fs.existsSync(path.join(REPO, 'node_modules', 'express'))) {
    throw new Error(`The website's packages aren't installed: run "npm ci" in ${REPO}`);
  }
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebda3-app-test-'));
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    PREVIEW_LOCK: 'off',
    ADMIN_PASSWORD: 'test-only-Password-123!',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  };
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'BREVO_API_KEY', 'CALLMEBOT_APIKEY', 'SITE_URL']) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const origin = `http://localhost:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The shop stopped while starting:\n${log}`);
    try {
      const r = await fetch(origin + '/');
      if (r.ok) break;
    } catch { /* not yet */ }
    if (Date.now() - started > 60000) {
      child.kill();
      throw new Error(`The shop didn't start within 60 s:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    origin,
    log: () => log,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((r) => { child.once('exit', r); setTimeout(r, 5000); });
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
