/*
 * The إبداع apps' settings (Capacitor). Read by `npx cap sync`, which copies them into the Android and iOS projects.
 *
 * - The apps show the live shop: server.url. A test build can point at another copy of the shop with
 *   EBDA3_SITE_URL (e.g. http://10.0.2.2:3600 for the Android emulator, http://localhost:3600 for the iOS
 *   simulator); plain http is only allowed for such test builds.
 * - The version comes from package.json ("version"); the build number the stores need is worked out from it:
 *   1.2.3 → 10203 (see scripts/version.mjs). Bump the version with `npm run version:bump`.
 */
import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = typeof __dirname === 'string' ? __dirname : process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

const DEFAULT_SITE = 'https://ebda3.me';
const site = new URL(process.env.EBDA3_SITE_URL || DEFAULT_SITE);
if (site.protocol !== 'https:' && site.protocol !== 'http:') throw new Error(`EBDA3_SITE_URL must be http(s): ${site}`);
const siteUrl = site.origin;
const testSite = siteUrl !== DEFAULT_SITE;

const config: CapacitorConfig = {
  appId: 'me.ebda3.app',
  appName: 'إبداع',
  webDir: 'www',
  backgroundColor: '#FAFAF7',
  loggingBehavior: testSite ? 'debug' : 'none',
  server: {
    url: siteUrl,
    // Only for a test copy of the shop on this computer/emulator.
    cleartext: site.protocol === 'http:',
    // No server.errorPath: the app shows its own "no connection" page only for real connection errors, never
    // for the shop's own error pages (Capacitor's errorPath would also replace those).
  },
  android: {
    appendUserAgent: `Ebda3App/${pkg.version} (android)`,
    webContentsDebuggingEnabled: testSite,
  },
  ios: {
    appendUserAgent: `Ebda3App/${pkg.version} (ios)`,
    // The web view sits inside the screen's safe area (ShellViewController), so no inset adjustments.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    webContentsDebuggingEnabled: testSite,
  },
  plugins: {
    // The app keeps the shop inside the status and navigation bars itself (ShellPlugin), so the pages need no
    // safe-area handling; Capacitor's own handling is off.
    SystemBars: {
      insetsHandling: 'disable',
      style: 'LIGHT',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
