// Checks the Android test app on an emulator (GitHub Actions, see .github/workflows/mobile-apps.yml):
//   node test/device/android.mjs <app.apk> [screenshots-dir]
// The app must be built with EBDA3_SITE_URL=http://10.0.2.2:3600 (the emulator's address for this computer).
// It drives the app with adb and looks inside its web view with Playwright; screenshots go to screenshots-dir.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { _android as android } from 'playwright';
import { sleep, startShop, step } from './shop-proxy.mjs';

const [apk, shotsDir = 'screenshots'] = process.argv.slice(2);
if (!apk) {
  console.error('Usage: node test/device/android.mjs <app.apk> [screenshots-dir]');
  process.exit(2);
}
const PKG = 'me.ebda3.app';
const SITE = 'http://10.0.2.2:3600';
fs.mkdirSync(shotsDir, { recursive: true });

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function shot(name) {
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(shotsDir, `android-${name}.png`), png);
}
/** Waits until the web view's address passes `test` (polling: a page that fails to load mustn't end the wait). */
async function waitUrl(page, test, timeout = 30000, what = 'the page') {
  const end = Date.now() + timeout;
  let url = '';
  while (Date.now() < end) {
    try {
      url = page.url();
      if (test(new URL(url))) return url;
    } catch { /* the page is changing */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what} (last address: ${url})`);
}

/** The app's lines from the phone's log (the app's own messages, the web view's and crashes). */
function appLog(max = 120) {
  try {
    const lines = adb('logcat', '-d', '-v', 'time', '-t', '5000').split('\n')
      .filter((l) => /Capacitor|Ebda3|chromium|AndroidRuntime|me\.ebda3\.app/.test(l));
    return `--- the app's log (last ${Math.min(lines.length, max)} of ${lines.length} lines) ---\n${lines.slice(-max).join('\n')}`;
  } catch (e) {
    return `(no log: ${e.message.split('\n')[0]})`;
  }
}

function check(ok, message) {
  if (!ok) throw new Error(`Check failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const shop = await startShop();
let device;
try {
  step('Install and start the app');
  adb('install', '-r', apk);
  adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS');
  const started = Date.now();
  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  // Up to 90 s: right after the emulator starts, its network may not be ready for the first try (the app then shows
  // its "no connection" page and comes back by itself).
  const home = await shop.waitFor(/^\/(\?|$)/, 'android', { since: started, timeout: 90000, what: 'the home page' });
  check(true, 'the app opened the shop with its own user agent');
  if (shop.requests.some((r) => r.at < home.at && /^\/favicon\.svg\?online=/.test(r.path))) {
    console.log('  (the first try had no connection yet: the app showed its "no connection" page and came back by itself)');
  }
  await shop.waitFor(/^\/app\/config\.json/, 'android', { since: started, what: '/app/config.json (the page glue)' });
  check(true, 'the page glue runs (it asked for /app/config.json)');

  step('Look inside the web view');
  [device] = await android.devices();
  check(!!device, 'Playwright sees the emulator');
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const page = await webview.page();
  await page.waitForLoadState('load');
  const info = await page.evaluate(() => ({
    app: window.ebda3App && { isApp: window.ebda3App.isApp, platform: window.ebda3App.platform, build: window.ebda3App.build },
    cls: document.documentElement.className,
    share: typeof navigator.share,
    capacitor: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Ebda3Shell),
  }));
  check(info.app && info.app.isApp && info.app.platform === 'android' && info.app.build >= 10000, `window.ebda3App ${JSON.stringify(info.app)}`);
  check(/\bin-app-android\b/.test(info.cls), 'the page is marked in-app-android');
  check(info.share === 'function', 'navigator.share is there (the phone share sheet)');
  check(info.capacitor, 'the app plugin Ebda3Shell is there');
  await sleep(1500);
  shot('1-home');

  step('A link that opens the app (me.ebda3.app://open?url=…/cart)');
  let since = Date.now();
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d',
    `me.ebda3.app://open?url=${encodeURIComponent(SITE + '/cart')}`, PKG);
  await shop.waitFor(/^\/cart/, 'android', { since, what: '/cart' });
  await waitUrl(page, (u) => u.pathname === '/cart', 20000, '/cart');
  check(true, 'the cart page opened in the app');
  await sleep(1500);
  shot('2-cart-from-link');

  step('The Back button goes to the previous page');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitUrl(page, (u) => u.pathname === '/', 20000, 'the home page');
  check(true, 'back on the home page');

  step('No connection: the app\'s own page, then back by itself');
  await shop.down();
  await page.evaluate(() => { setTimeout(() => { location.href = '/designs'; }, 0); });
  await waitUrl(page, (u) => u.origin === 'https://localhost' && u.pathname === '/offline.html' && u.searchParams.has('from'), 30000, 'the offline page');
  check(true, 'the "no connection" page is shown');
  await page.waitForLoadState('load').catch(() => {});
  const text = await page.textContent('body');
  check(/مفيش اتصال/.test(text) && /No internet connection/.test(text), 'in Arabic and English');
  await sleep(1000);
  shot('3-no-connection');
  since = Date.now();
  await shop.up();
  await shop.waitFor(/^\/designs/, 'android', { since, timeout: 40000, what: '/designs after the connection came back' });
  await waitUrl(page, (u) => u.pathname === '/designs', 20000, '/designs');
  check(true, 'back on the page by itself once the shop answered');
  await sleep(2500);
  shot('4-back-online');

  step('Back skips the "no connection" page');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitUrl(page, (u) => u.pathname === '/', 20000, 'the home page');
  check(true, 'back went to the home page, not to the "no connection" page');

  step('Saving a file the page makes (the editor\'s names example)');
  await page.goto(`${SITE}/editor?product=namelabels`);
  const example = page.locator('[data-merge="example"]');
  await example.waitFor({ state: 'attached', timeout: 30000 });
  await example.evaluate((el) => el.click());
  await page.waitForSelector('#e3a-toast.e3a-on', { timeout: 15000 });
  const toast = await page.textContent('#e3a-toast');
  check(/التنزيلات|Downloads/.test(toast), `the page says where it went: "${toast}"`);
  const downloads = adb('shell', 'ls', '/sdcard/Download/');
  check(/\.csv/.test(downloads), 'the file is in Downloads');
  shot('5-saved-file');

  step('Other sites open outside the page');
  since = Date.now();
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    a.id = 'e2e-ext';
    a.textContent = 'x';
    document.body.appendChild(a);
    a.click();
  });
  await sleep(3000);
  check(new URL(page.url()).pathname === '/editor', 'the shop page stayed where it was');
  const resumed = (adb('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=.*|mResumedActivity: .*/) || ['?'])[0];
  console.log(`  (on screen now: ${resumed.trim()})`);
  shot('6-outside-link');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');

  console.log('\nAll Android device checks passed.');
} catch (e) {
  console.error(`\n${e.stack || e.message}`);
  try {
    shot('failure');
  } catch { /* no screen */ }
  process.exitCode = 1;
} finally {
  console.log(`\n${appLog(process.exitCode ? 150 : 40)}`);
  await device?.close().catch(() => {});
  await shop.stop();
}
