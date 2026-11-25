// Checks the iPhone test app on a simulator (GitHub Actions, see .github/workflows/mobile-apps.yml):
//   node test/device/ios.mjs <simulator-udid> <App.app> [screenshots-dir]
// The app must be built with EBDA3_SITE_URL=http://localhost:3600. The checks read what the app asked the shop for
// (path and user agent), read the screen's text (macOS text recognition, test/device/ocr.swift) and keep
// screenshots; the app's own log is printed at the end.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, startShop, step } from './shop-proxy.mjs';

const [udid, app, shotsDir = 'screenshots'] = process.argv.slice(2);
if (!udid || !app) {
  console.error('Usage: node test/device/ios.mjs <simulator-udid> <App.app> [screenshots-dir]');
  process.exit(2);
}
const BUNDLE = 'me.ebda3.app';
const SITE = 'http://localhost:3600';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const appLog = path.join(os.tmpdir(), 'ebda3-ios-app.log');
fs.mkdirSync(shotsDir, { recursive: true });

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
const check = (ok, message) => {
  if (!ok) throw new Error(`Check failed: ${message}`);
  console.log(`  ✓ ${message}`);
};

// Text recognition for the screenshots (compiled once).
const ocrBin = path.join(os.tmpdir(), 'ebda3-ocr');
let ocrReady = false;
function screen(name) {
  const file = path.join(shotsDir, `iphone-${name}.png`);
  simctl('io', udid, 'screenshot', file);
  try {
    if (!ocrReady) {
      execFileSync('swiftc', ['-O', path.join(HERE, 'ocr.swift'), '-o', ocrBin], { stdio: 'inherit' });
      ocrReady = true;
    }
    const text = execFileSync(ocrBin, [file], { encoding: 'utf8' });
    console.log(`  [screen ${name}] ${text.trim().split('\n').join(' | ').slice(0, 600)}`);
    return text;
  } catch (e) {
    console.log(`  [screen ${name}] (no text recognition: ${e.message.split('\n')[0]})`);
    return '';
  }
}

async function screenShows(name, re, timeout = 20000) {
  const end = Date.now() + timeout;
  let text = '';
  for (let i = 1; Date.now() < end; i++) {
    text = screen(`${name}${i > 1 ? `-${i}` : ''}`);
    if (re.test(text)) return text;
    await sleep(3000);
  }
  throw new Error(`The screen didn't show ${re} within ${timeout / 1000} s`);
}

function openLink(url) {
  simctl('openurl', udid, url);
}

const shop = await startShop();
try {
  step('Install and start the app');
  simctl('install', udid, app);
  fs.rmSync(appLog, { force: true });
  let since = Date.now();
  simctl('launch', '--terminate-running-process', `--stdout=${appLog}`, `--stderr=${appLog}`, udid, BUNDLE);
  const home = await shop.waitFor(/^\/(\?|$)/, 'ios', { since, what: 'the home page' });
  check(/Ebda3App\/\d+\.\d+\.\d+ \(ios\)/.test(home.ua), `the app opened the shop with its user agent (${home.ua.slice(-28)})`);
  await shop.waitFor(/^\/app\/config\.json/, 'ios', { since, what: '/app/config.json (the page glue)' });
  check(true, 'the page glue runs (it asked for /app/config.json)');
  await sleep(4000);
  screen('1-home');

  step('A link that opens the app (me.ebda3.app://open?url=…/cart)');
  since = Date.now();
  openLink(`me.ebda3.app://open?url=${encodeURIComponent(SITE + '/cart')}`);
  try {
    await shop.waitFor(/^\/cart/, 'ios', { since, timeout: 30000, what: '/cart' });
  } catch (e) {
    screen('2-cart-missing');
    throw e;
  }
  check(true, 'the cart page opened in the app');
  await sleep(3000);
  screen('2-cart-from-link');

  step('No connection: the app\'s own page, then back by itself');
  await shop.down();
  openLink(`me.ebda3.app://open?url=${encodeURIComponent(SITE + '/designs')}`);
  const offline = await screenShows('3-no-connection', /No internet connection/i);
  check(/No internet connection/i.test(offline), 'the "no connection" page is shown');
  since = Date.now();
  await shop.up();
  await shop.waitFor(/^\/designs/, 'ios', { since, timeout: 40000, what: '/designs after the connection came back' });
  check(true, 'back on the page by itself once the shop answered (the offline page retried)');
  await sleep(3000);
  screen('4-back-online');

  step('The editor');
  since = Date.now();
  openLink(`me.ebda3.app://open?url=${encodeURIComponent(SITE + '/editor?product=tshirt')}`);
  await shop.waitFor(/^\/editor/, 'ios', { since, what: '/editor' });
  await sleep(6000);
  screen('5-editor');

  console.log('\nAll iPhone simulator checks passed.');
} catch (e) {
  console.error(`\n${e.stack || e.message}`);
  try {
    screen('failure');
  } catch { /* no screen */ }
  process.exitCode = 1;
} finally {
  await shop.stop();
  if (fs.existsSync(appLog)) {
    const lines = fs.readFileSync(appLog, 'utf8').split('\n').filter(Boolean);
    console.log(`\n--- the app's log (last ${Math.min(lines.length, 80)} of ${lines.length} lines) ---`);
    console.log(lines.slice(-80).join('\n'));
  }
}
