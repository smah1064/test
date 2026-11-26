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
// Which page is on screen: the app writes "Page shown: <address without query>" in its log (test builds, log tag
// Ebda3Shell). That is the truth; Playwright's view of the page can go stale when the web view switches between the
// shop and the app's own pages (another site), so Playwright is only used to run things inside a page, on a fresh
// connection (connectPage).
let context = null; // the web view's pages as Playwright sees them

async function connectPage() {
  if (device) await device.close().catch(() => {});
  [device] = await android.devices();
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const p = await webview.page();
  context = p.context();
  return p;
}

/** The pages the app showed, oldest first: [{ at (ms since 1970), url }]. */
function shownPages() {
  try {
    const out = adb('logcat', '-d', '-v', 'epoch', '-s', 'Ebda3Shell:D');
    return [...out.matchAll(/^\s*(\d+\.\d+)\s.*?Page shown: (\S+)/gm)].map((m) => ({ at: Number(m[1]) * 1000, url: m[2] }));
  } catch {
    return [];
  }
}

const shownList = (n = 8) => shownPages().slice(-n).map((p) => p.url).join(' → ') || '-';

// The phone's clock against this computer's (the log's times are the phone's).
let clockOffset = 0;
function measureClock() {
  try {
    const raw = adb('shell', 'date', '+%s%3N').trim();
    const ms = /^\d{13}$/.test(raw) ? Number(raw) : Number(adb('shell', 'date', '+%s').trim()) * 1000;
    if (Number.isFinite(ms) && ms > 0) clockOffset = ms - Date.now();
  } catch { /* assume the same clock */ }
}

/** Waits until a page the app showed after `since` (this computer's time, ms) is on screen and passes `test`. */
async function waitUrl(test, timeout = 30000, what = 'the page', since = 0) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const shown = shownPages();
    const last = shown[shown.length - 1];
    if (last && last.at >= since + clockOffset - 1500) {
      try {
        if (test(new URL(last.url))) return last.url;
      } catch { /* not an address */ }
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${what} (pages the app showed: ${shownList()})`);
}

/** The text on the phone's screen (Android's accessibility view, which includes the web view's text). */
async function screenText(tries = 4) {
  let error = '';
  for (let i = 0; i < tries; i++) {
    try {
      adb('shell', 'rm', '-f', '/sdcard/e2e-ui.xml');
      adb('shell', 'uiautomator', 'dump', '/sdcard/e2e-ui.xml');
      const xml = adb('shell', 'cat', '/sdcard/e2e-ui.xml');
      return [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]).join(' | ');
    } catch (e) {
      error = e.message.split('\n')[0]; // e.g. the screen was changing
      await sleep(1000);
    }
  }
  return `(no screen text: ${error})`;
}

/** Waits until the screen's text matches every pattern (the web view fills in its text for the reader a moment
 *  after it is first asked, so the first read can be empty). Returns the last text read. */
async function screenShows(patterns, timeout = 20000) {
  const end = Date.now() + timeout;
  let text = '';
  do {
    text = await screenText(1);
    if (patterns.every((re) => re.test(text))) return text;
    await sleep(1000);
  } while (Date.now() < end);
  return text;
}

/** Runs fn in the page, waiting out a page that is still loading (its old document can vanish mid-call). */
async function inPage(page, fn, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
      return await page.evaluate(fn);
    } catch (e) {
      if (i >= tries || !/context was destroyed|navigat|Target closed/i.test(e.message)) throw e;
      await sleep(500);
    }
  }
}

/** The app's lines from the phone's log (the app's own messages, the web view's and crashes). */
function appLog(max = 120) {
  try {
    const lines = adb('logcat', '-d', '-v', 'time').split('\n')
      .filter((l) => /Capacitor|Ebda3|chromium|AndroidRuntime|me\.ebda3\.app/.test(l) && !/AppsFilter/.test(l));
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
  try {
    adb('logcat', '-G', '16M'); // room for the whole check (the emulator logs a lot)
  } catch { /* keep the default size */ }
  adb('logcat', '-c');
  measureClock();
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
  let page = await connectPage();
  check(!!device, 'Playwright sees the emulator');
  await page.waitForLoadState('load');
  const info = await inPage(page, () => ({
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
  await waitUrl((u) => u.pathname === '/cart', 20000, '/cart', since);
  check(true, 'the cart page opened in the app');
  await sleep(1500);
  shot('2-cart-from-link');

  step('The Back button goes to the previous page');
  since = Date.now();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitUrl((u) => u.pathname === '/', 20000, 'the home page', since);
  check(true, 'back on the home page');

  step('No connection: the app\'s own page, then back by itself');
  await shop.down();
  since = Date.now();
  await inPage(page, () => { setTimeout(() => { location.href = '/designs'; }, 0); });
  await waitUrl((u) => u.origin === 'https://localhost' && u.pathname === '/offline.html', 30000, 'the offline page', since);
  check(true, 'the "no connection" page is shown');
  const words = await screenShows([/مفيش اتصال/, /No internet connection/]);
  check(/مفيش اتصال/.test(words) && /No internet connection/.test(words), 'it says so in Arabic and English (read from the screen)');
  shot('3-no-connection');
  since = Date.now();
  await shop.up();
  await shop.waitFor(/^\/designs/, 'android', { since, timeout: 40000, what: '/designs after the connection came back' });
  await waitUrl((u) => u.pathname === '/designs', 20000, '/designs', since);
  check(true, 'back on the page by itself once the shop answered');
  await sleep(2500);
  shot('4-back-online');

  step('Back skips the "no connection" page');
  since = Date.now();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitUrl((u) => u.pathname === '/', 20000, 'the home page', since);
  check(true, 'back went to the home page, not to the "no connection" page');

  step('Saving a file the page makes (the editor\'s names example)');
  page = await connectPage(); // a fresh view of the web view (see shownPages)
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
  await inPage(page, () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    a.id = 'e2e-ext';
    a.textContent = 'x';
    document.body.appendChild(a);
    a.click();
  });
  await sleep(3000);
  const after = shownPages().filter((p) => p.at >= since + clockOffset - 1500).map((p) => new URL(p.url).pathname);
  check(after.every((path) => path === '/editor'), `the shop page stayed where it was (pages shown since: ${after.join(', ') || 'none'})`);
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
  try {
    console.error(`Pages Playwright sees: ${context ? context.pages().map((p) => `${p.url()}${p.isClosed() ? ' (closed)' : ''}`).join(', ') : '-'}`);
    console.error(`Pages the app showed: ${shownList()}`);
    console.error(`Text on the screen: ${(await screenText(2)).slice(0, 800)}`);
  } catch { /* nothing more to tell */ }
  process.exitCode = 1;
} finally {
  console.log(`\n${appLog(process.exitCode ? 150 : 40)}`);
  await device?.close().catch(() => {});
  await shop.stop();
}
