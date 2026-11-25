// The app projects' settings: the app id, the shop address, the links that open the app, permissions, texts in
// both languages, the version in every place, and that the page glue stays compatible with older web views.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MOBILE } from './helpers/app-page.mjs';
import { buildNumber, bumpVersion, parseVersion, readVersion, syncPbxproj } from '../scripts/version.mjs';

const read = (rel) => fs.readFileSync(path.join(MOBILE, rel), 'utf8');
const require = createRequire(import.meta.url);

/** capacitor.config.ts as the Capacitor CLI reads it (TypeScript turned into CommonJS), with these env vars. */
function capacitorConfig(env = {}) {
  const ts = require('typescript');
  const js = ts.transpileModule(read('capacitor.config.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
  }).outputText;
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', '__dirname', 'process', js)(require, module, module.exports, MOBILE, process);
    return module.exports.default;
  } finally {
    for (const k of Object.keys(env)) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

describe('app settings (capacitor.config.ts)', () => {
  it('the store app shows https://ebda3.me, with no test-only settings', () => {
    const c = capacitorConfig({ EBDA3_SITE_URL: '' });
    assert.equal(c.appId, 'me.ebda3.app');
    assert.equal(c.appName, 'إبداع');
    assert.equal(c.server.url, 'https://ebda3.me');
    assert.equal(c.server.cleartext, false);
    assert.equal(c.server.errorPath, undefined, 'the app handles connection errors itself');
    assert.equal(c.android.webContentsDebuggingEnabled, false);
    assert.equal(c.ios.webContentsDebuggingEnabled, false);
    assert.equal(c.android.appendUserAgent, `Ebda3App/${readVersion()} (android)`);
    assert.equal(c.ios.appendUserAgent, `Ebda3App/${readVersion()} (ios)`);
    assert.equal(c.plugins.SystemBars.insetsHandling, 'disable');
  });

  it('a test build can point at a copy of the shop', () => {
    const c = capacitorConfig({ EBDA3_SITE_URL: 'http://10.0.2.2:3600/' });
    assert.equal(c.server.url, 'http://10.0.2.2:3600');
    assert.equal(c.server.cleartext, true);
    assert.equal(c.android.webContentsDebuggingEnabled, true);
    assert.throws(() => capacitorConfig({ EBDA3_SITE_URL: 'ftp://example.com' }), /http\(s\)/);
  });
});

describe('version', () => {
  it('works out the store build number', () => {
    assert.equal(buildNumber('1.0.0'), 10000);
    assert.equal(buildNumber('1.2.3'), 10203);
    assert.equal(buildNumber('12.99.99'), 129999);
    assert.throws(() => parseVersion('1.0'), /1\.2\.3/);
    assert.throws(() => parseVersion('1.100.0'), /99/);
    assert.throws(() => parseVersion('0.1.0'), /Major/);
  });

  it('bumps', () => {
    assert.equal(bumpVersion('1.0.0'), '1.0.1');
    assert.equal(bumpVersion('1.0.99'), '1.1.0');
    assert.equal(bumpVersion('1.99.99'), '2.0.0');
    assert.equal(bumpVersion('1.4.7', 'minor'), '1.5.0');
    assert.equal(bumpVersion('1.4.7', 'major'), '2.0.0');
    assert.ok(buildNumber(bumpVersion('1.0.99')) > buildNumber('1.0.99'));
  });

  it('the iOS project has the same version as package.json', () => {
    const out = execFileSync(process.execPath, ['scripts/version.mjs', 'check'], { cwd: MOBILE, encoding: 'utf8' });
    assert.match(out, /^ok/);
    const synced = syncPbxproj('MARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 1;\n', '2.3.4');
    assert.equal(synced, 'MARKETING_VERSION = 2.3.4;\nCURRENT_PROJECT_VERSION = 20304;\n');
  });
});

describe('Android project', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('shop links open the app (verified App Links), the dashboard and API don\'t', () => {
    assert.match(manifest, /android:autoVerify="true"/);
    assert.match(manifest, /android:host="ebda3\.me"/);
    assert.match(manifest, /android:host="www\.ebda3\.me"/);
    for (const p of ['/order', '/proof', '/invoice', '/s/', '/account', '/cart', '/design', '/editor']) {
      assert.match(manifest, new RegExp(`android:pathPrefix="${p}"`), p);
    }
    for (const p of ['/admin', '/api', '/auth', '/files', '/dl']) {
      assert.doesNotMatch(manifest, new RegExp(`android:path(Prefix)?="${p}`), p);
    }
    assert.match(manifest, /android:scheme="@string\/custom_url_scheme"/);
  });

  it('permissions: internet and notifications only', () => {
    const perms = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(perms, ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS']);
    assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
    assert.match(manifest, /android:allowBackup="false"/);
  });

  it('every text exists in Arabic (default) and English', () => {
    const names = (rel) => [...read(rel).matchAll(/<string name="([^"]+)"(?![^>]*translatable="false")/g)].map((m) => m[1]).sort();
    assert.deepEqual(names('android/app/src/main/res/values-en/strings.xml'), names('android/app/src/main/res/values/strings.xml'));
    assert.match(read('android/app/src/main/res/values/strings.xml'), /<string name="app_name">إبداع<\/string>/);
  });

  it('the pictures the manifest and themes use exist', () => {
    for (const f of ['drawable/ic_notification.xml', 'drawable/splash_icon.xml', 'drawable/ic_launcher_foreground.xml',
      'drawable/ic_launcher_monochrome.xml', 'mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-xxxhdpi/ic_launcher.png']) {
      assert.ok(fs.existsSync(path.join(MOBILE, 'android/app/src/main/res', f)), f);
    }
    assert.match(read('android/app/src/main/res/values/styles.xml'), /windowSplashScreenAnimatedIcon">@drawable\/splash_icon/);
  });

  it('versions come from package.json; release builds can\'t point at a test shop', () => {
    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /file\('\.\.\/\.\.\/package\.json'\)/);
    assert.match(gradle, /versionCode appVersionCode/);
    assert.match(gradle, /Release builds must use https:\/\/ebda3\.me/);
    assert.doesNotMatch(gradle, /storePassword\s+["']/, 'no passwords in the repository');
  });
});

describe('iOS project', () => {
  const plist = read('ios/App/App/Info.plist');
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');

  it('opens me.ebda3.app links, explains its permissions in both languages, Arabic first', () => {
    assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>me\.ebda3\.app<\/string>/);
    for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription']) {
      const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
      assert.ok(m, key);
      assert.match(m[1], /إبداع.*·.*ebda3/, `${key} in Arabic and English`);
    }
    assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>ar<\/string>/);
    assert.match(plist, /<key>Ebda3PushEnabled<\/key>\s*<false\/>/);
    assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    assert.doesNotMatch(plist, /UIMainStoryboardFile|UISceneStoryboardFile/);
  });

  it('universal links for both shop hosts', () => {
    const ent = read('ios/App/App/App.entitlements');
    assert.match(ent, /applinks:ebda3\.me/);
    assert.match(ent, /applinks:www\.ebda3\.me/);
  });

  it('the app\'s Swift files are built, iPhone only', () => {
    for (const f of ['ShellCore.swift', 'ShellPlugin.swift', 'ShellViewController.swift']) {
      assert.match(pbx, new RegExp(`\\/\\* ${f.replace('.', '\\.')} in Sources \\*\\/,`), f);
      assert.ok(fs.existsSync(path.join(MOBILE, 'ios/App/App/Shell', f)), f);
    }
    assert.equal((pbx.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length, 2);
    assert.equal((pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length, 2);
    assert.match(read('ios/App/App/SceneDelegate.swift'), /ShellViewController\(\)/);
  });

  it('Android and iPhone use the same plugin methods', () => {
    const swift = read('ios/App/App/Shell/ShellPlugin.swift');
    const java = read('android/app/src/main/java/me/ebda3/app/shell/ShellPlugin.java');
    const iosMethods = [...swift.matchAll(/CAPPluginMethod\(name: "([^"]+)"/g)].map((m) => m[1]).sort();
    const androidMethods = [...java.matchAll(/@PluginMethod\s+public void (\w+)\(/g)].map((m) => m[1]).sort();
    assert.deepEqual(iosMethods, androidMethods);
    const glue = read('www/app-glue.js');
    const used = [...new Set([...glue.matchAll(/'Ebda3Shell', '(\w+)'/g)].map((m) => m[1]))].sort();
    for (const m of used) assert.ok(androidMethods.includes(m), `the glue calls ${m}`);
  });
});

describe('the page glue', () => {
  it('uses only JavaScript that Android web views from Chrome 60 understand', () => {
    const code = read('www/app-glue.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(code, /\?\.|\?\?/, 'no ?. or ?? (Chrome 80+)');
    assert.doesNotMatch(code, /\bclass\s+\w+\s+extends\b.*#/, 'no private fields');
    assert.doesNotMatch(code, /`/, 'no template literals needed');
    assert.doesNotMatch(code, /\.(at|replaceAll|flatMap)\(/, 'no newer array/string methods');
    new Function(read('www/app-glue.js')); // parses
  });
});
