// Opens the shop like the app does, in Playwright's Chromium: before any page script, a stand-in for the app's
// native side (fake-capacitor.js), the facts the app injects (window.__ebda3AppConfig) and the real page glue
// (www/app-glue.js) — the same order as in the apps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MOBILE = path.resolve(HERE, '..', '..');
export const GLUE = fs.readFileSync(path.join(MOBILE, 'www', 'app-glue.js'), 'utf8');
const FAKE = fs.readFileSync(path.join(HERE, 'fake-capacitor.js'), 'utf8');

export function launchBrowser() {
  return chromium.launch();
}

/**
 * @param {import('playwright').Browser} browser
 * @param {{origin: string}} site
 * @param {object} [o]
 * @param {'android'|'ios'} [o.platform]
 * @param {number} [o.build] the app's build number
 * @param {boolean} [o.push] push set up in the app
 * @param {object} [o.answers] what the fake native side answers (see fake-capacitor.js)
 * @param {object|null} [o.config] what /app/config.json returns (null: 404, undefined: the real site)
 * @param {'ar'|'en'} [o.lang] the site's language (localStorage pod-lang)
 * @param {object} [o.devices] requests to /api/app/devices are captured in this array when given
 * @param {string} [o.prelude] script run before the app's (e.g. what a web view already has)
 * @param {boolean} [o.capacitorLate] add the stand-in bridge after the glue instead of before
 */
export async function appPage(browser, site, o = {}) {
  const platform = o.platform || 'android';
  const device = platform === 'ios' ? devices['iPhone 13'] : devices['Pixel 7'];
  const context = await browser.newContext({ ...device, locale: 'ar-EG' });
  const appConfig = {
    platform,
    version: '1.0.0',
    build: o.build ?? 10000,
    siteOrigin: site.origin,
    appScheme: 'me.ebda3.app',
    push: !!o.push,
  };
  let prelude = `window.__answers = ${JSON.stringify(o.answers || {})};\n`;
  if (o.lang) prelude += `try { localStorage.setItem('pod-lang', ${JSON.stringify(o.lang)}); } catch (e) {}\n`;
  if (o.prelude) prelude += `${o.prelude}\n`;
  const injected = `window.__ebda3AppConfig = ${JSON.stringify(appConfig)};\n${GLUE}`;
  await context.addInitScript({
    // o.capacitorLate: the app's bridge script arrives after the glue (the glue must cope with either order).
    content: o.capacitorLate ? `${prelude}${injected}\n${FAKE}` : `${prelude}${FAKE}\n${injected}`,
  });
  if (o.config !== undefined) {
    await context.route('**/app/config.json', (route) =>
      o.config === null ? route.fulfill({ status: 404, body: 'Not found' }) : route.fulfill({ json: o.config }));
  }
  if (o.devices) {
    await context.route('**/api/app/devices', async (route) => {
      o.devices.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
      await route.fulfill({ status: 204, body: '' });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return {
    context,
    page,
    errors,
    calls: (plugin, method) =>
      page.evaluate(([p, m]) => (window.__calls || []).filter((c) => (!p || c.plugin === p) && (!m || c.method === m)), [plugin, method]),
    close: () => context.close(),
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until fn() returns something truthy (or fails after `timeout`). */
export async function until(fn, { timeout = 5000, every = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(every);
  }
}
