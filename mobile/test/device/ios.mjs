// Checks the iPhone test app on a simulator (GitHub Actions, see .github/workflows/mobile-apps.yml):
//   node test/device/ios.mjs <simulator-udid> <App.app> [screenshots-dir]
// The app must be built with EBDA3_SITE_URL=http://localhost:3600. The checks read what the app asked the shop for
// (path and user agent), read the screen's text (macOS text recognition, test/device/ocr.swift) and keep
// screenshots; the app's own output and its lines in the simulator's log are printed at the end.
import { execFileSync, spawn } from 'node:child_process';
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

// The app's own output (its console), kept while it runs.
let appOutput = '';
let appProcess = null;
function launchApp() {
  appProcess?.kill();
  appOutput = '';
  appProcess = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', udid, BUNDLE], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  appProcess.stdout.on('data', (d) => { appOutput += d; });
  appProcess.stderr.on('data', (d) => { appOutput += d; });
}

/** The app's lines in the simulator's log (its messages, and the system's about its links). */
function systemLog() {
  try {
    const out = execFileSync('xcrun', ['simctl', 'spawn', udid, 'log', 'show', '--last', '15m', '--style', 'compact',
      '--predicate', 'process == "App" OR eventMessage CONTAINS[c] "me.ebda3.app"'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const lines = out.split('\n').filter((l) => /Ebda3Shell|me\.ebda3\.app|⚡️|[Ee]rror|[Ff]ault/.test(l));
    return `--- the simulator's log (last ${Math.min(lines.length, 100)} of ${lines.length} lines) ---\n${lines.slice(-100).join('\n')}`;
  } catch (e) {
    return `(no simulator log: ${e.message.split('\n')[0]})`;
  }
}

const shop = await startShop();
let linkNote = '';
try {
  step('Install and start the app');
  simctl('install', udid, app);
  let since = Date.now();
  launchApp();
  const home = await shop.waitFor(/^\/(\?|$)/, 'ios', { since, timeout: 90000, what: 'the home page' });
  check(/Ebda3App\/\d+\.\d+\.\d+ \(ios\)/.test(home.ua), `the app opened the shop with its user agent (${home.ua.slice(-28)})`);
  await shop.waitFor(/^\/app\/config\.json/, 'ios', { since, what: '/app/config.json (the page glue)' });
  check(true, 'the page glue runs (it asked for /app/config.json)');
  await sleep(4000);
  screen('1-home');

  step('No connection when the app starts: its own page, then back by itself');
  await shop.down();
  launchApp(); // starts the app again
  const offline = await screenShows('2-no-connection', /No internet connection/i, 45000);
  check(/No internet connection/i.test(offline), `the "no connection" page is shown${/مفيش|اتصال/.test(offline) ? ' (Arabic and English)' : ''}`);
  since = Date.now();
  await shop.up();
  await shop.waitFor(/^\/(\?|$)/, 'ios', { since, timeout: 45000, what: 'the home page after the connection came back' });
  check(true, 'back on the shop by itself once it answered (the app checked the connection for the page)');
  await sleep(3000);
  screen('3-back-online');

  step('A link that opens the app (me.ebda3.app://open?url=…/cart)');
  since = Date.now();
  openLink(`me.ebda3.app://open?url=${encodeURIComponent(SITE + '/cart')}`);
  const cart = await shop.waitFor(/^\/cart/, 'ios', { since, timeout: 20000, what: '/cart' }).catch(() => null);
  if (cart) {
    check(true, 'the cart page opened in the app');
    await sleep(3000);
    screen('4-cart-from-link');

    step('The editor');
    since = Date.now();
    openLink(`me.ebda3.app://open?url=${encodeURIComponent(SITE + '/editor?product=tshirt')}`);
    await shop.waitFor(/^\/editor/, 'ios', { since, what: '/editor' });
    await sleep(6000);
    screen('5-editor');
  } else {
    const text = screen('4-cart-missing');
    if (!(/\bOpen\b/.test(text) && /\bCancel\b/.test(text))) {
      throw new Error("The app didn't open /cart from the link (see the screen's text and the logs below)");
    }
    linkNote = 'links from outside the app not checked: the simulator asks "Open in …?" first, and nobody can tap it here';
    console.log(`  – ${linkNote} (the link rules have their own Swift tests; Android checks links on the emulator)`);
  }

  console.log(`\nAll iPhone simulator checks passed${linkNote ? ` (${linkNote})` : ''}.`);
} catch (e) {
  console.error(`\n${e.stack || e.message}`);
  try {
    screen('failure');
  } catch { /* no screen */ }
  process.exitCode = 1;
} finally {
  await shop.stop();
  const lines = appOutput.split(/\r?\n/).filter(Boolean);
  console.log(`\n--- the app's output (last ${Math.min(lines.length, 80)} of ${lines.length} lines) ---`);
  console.log(lines.slice(-80).join('\n'));
  console.log(`\n${systemLog()}`);
  appProcess?.kill();
}
