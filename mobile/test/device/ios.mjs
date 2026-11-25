// Checks the iPhone test app on a simulator (GitHub Actions, see .github/workflows/mobile-apps.yml):
//   node test/device/ios.mjs <simulator-udid> <App.app> [screenshots-dir]
// The app must be built with EBDA3_SITE_URL=http://localhost:3600. The simulator can't be looked into from here,
// so the checks read what the app asked the shop for (path and user agent) and take screenshots.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sleep, startShop, step } from './shop-proxy.mjs';

const [udid, app, shotsDir = 'screenshots'] = process.argv.slice(2);
if (!udid || !app) {
  console.error('Usage: node test/device/ios.mjs <simulator-udid> <App.app> [screenshots-dir]');
  process.exit(2);
}
const BUNDLE = 'me.ebda3.app';
const SITE = 'http://localhost:3600';
fs.mkdirSync(shotsDir, { recursive: true });

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
const shot = (name) => simctl('io', udid, 'screenshot', path.join(shotsDir, `iphone-${name}.png`));
const check = (ok, message) => {
  if (!ok) throw new Error(`Check failed: ${message}`);
  console.log(`  ✓ ${message}`);
};

const shop = await startShop();
try {
  step('Install and start the app');
  simctl('install', udid, app);
  let since = Date.now();
  simctl('launch', udid, BUNDLE);
  const home = await shop.waitFor(/^\/(\?|$)/, 'ios', { since, what: 'the home page' });
  check(/Ebda3App\/\d+\.\d+\.\d+ \(ios\)/.test(home.ua), `the app opened the shop with its user agent (${home.ua.slice(-28)})`);
  await shop.waitFor(/^\/app\/config\.json/, 'ios', { since, what: '/app/config.json (the page glue)' });
  check(true, 'the page glue runs (it asked for /app/config.json)');
  await sleep(4000);
  shot('1-home');

  step('A link that opens the app (me.ebda3.app://open?url=…/cart)');
  since = Date.now();
  simctl('openurl', udid, `me.ebda3.app://open?url=${encodeURIComponent(SITE + '/cart')}`);
  await shop.waitFor(/^\/cart/, 'ios', { since, what: '/cart' });
  check(true, 'the cart page opened in the app');
  await sleep(3000);
  shot('2-cart-from-link');

  step('No connection: the app\'s own page, then back by itself');
  await shop.down();
  simctl('openurl', udid, `me.ebda3.app://open?url=${encodeURIComponent(SITE + '/designs')}`);
  await sleep(6000);
  shot('3-no-connection');
  since = Date.now();
  await shop.up();
  await shop.waitFor(/^\/designs/, 'ios', { since, timeout: 40000, what: '/designs after the connection came back' });
  check(true, 'back on the page by itself once the shop answered (the offline page retried)');
  await sleep(3000);
  shot('4-back-online');

  step('The account page (sign-in) and the editor');
  since = Date.now();
  simctl('openurl', udid, `me.ebda3.app://open?url=${encodeURIComponent(SITE + '/editor?product=tshirt')}`);
  await shop.waitFor(/^\/editor/, 'ios', { since, what: '/editor' });
  await sleep(6000);
  shot('5-editor');

  console.log('\nAll iPhone simulator checks passed.');
} catch (e) {
  console.error(`\n${e.stack || e.message}`);
  try {
    shot('failure');
  } catch { /* no screen */ }
  process.exitCode = 1;
} finally {
  await shop.stop();
}
