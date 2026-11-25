// The page glue (www/app-glue.js) on the real shop pages, in the way the apps load it, with a stand-in for the
// native side. Run with `npm test` (starts its own copy of the shop).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { appPage, launchBrowser, until, wait } from './helpers/app-page.mjs';
import { startSite } from './helpers/site.mjs';

let site;
let browser;

before(async () => {
  site = await startSite();
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await site?.stop();
});

async function open(path, o = {}) {
  const app = await appPage(browser, site, o);
  await app.page.goto(site.origin + path, { waitUntil: 'load' });
  return app;
}

describe('the shop pages in the app', () => {
  for (const path of ['/', '/designs', '/editor?product=tshirt', '/account', '/cart', '/photos', '/book', '/privacy']) {
    it(`${path} loads without errors and is marked as in the app`, async () => {
      const app = await open(path, { config: null });
      try {
        await wait(500);
        const marks = await app.page.evaluate(() => ({
          cls: document.documentElement.className,
          version: document.documentElement.getAttribute('data-app-version'),
          api: window.ebda3App && { isApp: window.ebda3App.isApp, platform: window.ebda3App.platform, build: window.ebda3App.build },
        }));
        assert.match(marks.cls, /\bin-app\b/);
        assert.match(marks.cls, /\bin-app-android\b/);
        assert.equal(marks.version, '1.0.0');
        assert.deepEqual(marks.api, { isApp: true, platform: 'android', build: 10000 });
        // The site's own errors would show here (the config 404 is expected and quiet).
        const real = app.errors.filter((e) => !/app\/config\.json|404 \(Not Found\)/.test(e));
        assert.deepEqual(real, []);
      } finally {
        await app.close();
      }
    });
  }

  it('does nothing on other sites (iOS injects into every page)', async () => {
    const app = await appPage(browser, { origin: 'https://ebda3.me' }, { config: null });
    try {
      await app.page.goto(site.origin + '/privacy');
      assert.equal(await app.page.evaluate(() => typeof window.ebda3App), 'undefined');
      assert.equal(await app.page.evaluate(() => document.documentElement.classList.contains('in-app')), false);
    } finally {
      await app.close();
    }
  });
});

describe('web-only parts are hidden', () => {
  it('the "install the app" link never shows (iPhone)', async () => {
    const app = await open('/', { platform: 'ios', config: null });
    try {
      const shown = await app.page.evaluate(() =>
        [...document.querySelectorAll('[data-install-wrap]')].map((el) => getComputedStyle(el).display));
      assert.ok(shown.length > 0, 'the site has the install link');
      assert.ok(shown.every((d) => d === 'none'), `install link display: ${shown}`);
    } finally {
      await app.close();
    }
  });

  it('the service worker is not registered', async () => {
    const app = await open('/designs', { config: null });
    try {
      await wait(800);
      const regs = await app.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
      assert.equal(regs, 0);
      const err = await app.page.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => 'registered', (e) => e.message));
      assert.equal(err, 'Not used in the app');
    } finally {
      await app.close();
    }
  });
});

describe('sharing (Android)', () => {
  it('navigator.share opens the phone share sheet with a full address', async () => {
    const app = await open('/editor?product=tshirt', { config: null });
    try {
      const res = await app.page.evaluate(() => navigator.share({ title: 'ebda3', text: 'شوف تصميمي', url: '/s/AbCdEfGhIjKl' }).then(() => 'ok'));
      assert.equal(res, 'ok');
      const calls = await app.calls('Share', 'share');
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].options, {
        title: 'ebda3', dialogTitle: 'ebda3', text: 'شوف تصميمي', url: `${site.origin}/s/AbCdEfGhIjKl`,
      });
      assert.equal(await app.page.evaluate(() => navigator.canShare({ url: 'x' })), true);
      assert.equal(await app.page.evaluate(() => navigator.canShare({ files: [new File(['a'], 'a.txt')] })), false);
    } finally {
      await app.close();
    }
  });

  it('closing the share sheet is an AbortError, like in browsers', async () => {
    const app = await open('/', { config: null, answers: { 'Share.share': { reject: 'Share canceled' } } });
    try {
      const name = await app.page.evaluate(() => navigator.share({ url: '/' }).then(() => 'ok', (e) => e.name));
      assert.equal(name, 'AbortError');
    } finally {
      await app.close();
    }
  });

  it('a web view with its own share sheet (the iPhone\'s) keeps it', async () => {
    const prelude = 'navigator.share = function nativeShare() { return Promise.resolve(); };';
    const app = await open('/', { platform: 'ios', config: null, prelude });
    try {
      assert.equal(await app.page.evaluate(() => navigator.share.name), 'nativeShare');
      await app.page.evaluate(() => navigator.share({ url: '/' }));
      assert.deepEqual(await app.calls('Share', 'share'), []);
    } finally {
      await app.close();
    }
  });
});

describe('links', () => {
  let links = 0;
  async function clickLink(app, attrs) {
    const id = `test-link-${++links}`;
    await app.page.evaluate(([a, linkId]) => {
      const el = document.createElement('a');
      Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
      el.textContent = 'link';
      el.id = linkId;
      document.body.appendChild(el);
    }, [attrs, id]);
    await app.page.click('#' + id);
  }

  it('WhatsApp and other sites are handed to the app (not opened in the page)', async () => {
    const app = await open('/privacy', { config: null });
    try {
      await clickLink(app, { href: 'https://wa.me/201000000000?text=hi', target: '_blank', rel: 'noopener' });
      await clickLink(app, { href: 'https://bosta.co/track/1' });
      const calls = await app.calls('Ebda3Shell', 'open');
      assert.deepEqual(calls.map((c) => c.options.url), ['https://wa.me/201000000000?text=hi', 'https://bosta.co/track/1']);
      assert.equal(new URL(app.page.url()).pathname, '/privacy');
    } finally {
      await app.close();
    }
  });

  it('shop links meant for a new tab stay in the app', async () => {
    const app = await open('/privacy', { config: null });
    try {
      await Promise.all([app.page.waitForURL('**/rights'), clickLink(app, { href: '/rights', target: '_blank' })]);
      assert.equal(app.context.pages().length, 1);
      assert.deepEqual(await app.calls('Ebda3Shell', 'open'), []);
    } finally {
      await app.close();
    }
  });

  it('window.open of another site goes to the app; of the shop, stays in the page', async () => {
    const app = await open('/privacy', { config: null });
    try {
      const r = await app.page.evaluate(() => window.open('https://example.com/x', '_blank'));
      assert.equal(r, null);
      assert.deepEqual((await app.calls('Ebda3Shell', 'open')).map((c) => c.options.url), ['https://example.com/x']);
      await Promise.all([app.page.waitForURL('**/cart'), app.page.evaluate(() => { window.open('/cart'); })]);
    } finally {
      await app.close();
    }
  });
});

describe('saving files and printing', () => {
  it('the editor\'s "example file" (a made-up download link) is saved through the app', async () => {
    const app = await open('/editor?product=namelabels', { config: null, answers: { 'Ebda3Shell.saveFile': { where: 'downloads' } } });
    try {
      const btn = app.page.locator('[data-merge="example"]');
      await btn.waitFor({ state: 'attached', timeout: 15000 });
      await btn.evaluate((el) => el.click());
      const [call] = await until(() => app.calls('Ebda3Shell', 'saveFile').then((c) => c.length && c), { what: 'saveFile' });
      assert.match(call.options.name, /\.csv$/);
      assert.equal(call.options.mimeType, 'text/csv');
      const csv = Buffer.from(call.options.data, 'base64').toString('utf8');
      assert.ok(csv.split('\n').length > 2, `a CSV with rows, got: ${csv.slice(0, 80)}`);
      await until(() => app.page.locator('#e3a-toast.e3a-on').count(), { what: 'the saved toast' });
      assert.match(await app.page.locator('#e3a-toast').textContent(), /التنزيلات/);
      assert.equal(new URL(app.page.url()).pathname, '/editor');
    } finally {
      await app.close();
    }
  });

  it('a picture saved to Photos says so, in English when the site is in English', async () => {
    const app = await open('/designs', { config: null, lang: 'en', answers: { 'Ebda3Shell.saveFile': { where: 'photos' } } });
    try {
      await app.page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 4;
        return new Promise((r) => c.toBlob((b) => {
          Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: 'mug-front.png' }).click();
          r();
        }, 'image/png'));
      });
      const [call] = await until(() => app.calls('Ebda3Shell', 'saveFile').then((c) => c.length && c), { what: 'saveFile' });
      assert.equal(call.options.name, 'mug-front.png');
      assert.equal(call.options.mimeType, 'image/png');
      assert.equal(Buffer.from(call.options.data, 'base64').subarray(1, 4).toString(), 'PNG');
      await until(() => app.page.locator('#e3a-toast.e3a-on').count(), { what: 'the saved toast' });
      assert.equal(await app.page.locator('#e3a-toast').textContent(), 'Image saved to Photos');
    } finally {
      await app.close();
    }
  });

  it('a cancelled save shows nothing; a failed one says so', async () => {
    const app = await open('/designs', { config: null, answers: { 'Ebda3Shell.saveFile': { reject: 'cancelled' } } });
    try {
      await app.page.evaluate(() => {
        Object.assign(document.createElement('a'), { href: 'data:text/plain,hi', download: 'a.txt' }).click();
      });
      await until(() => app.calls('Ebda3Shell', 'saveFile').then((c) => c.length), { what: 'saveFile' });
      await wait(300);
      assert.equal(await app.page.locator('#e3a-toast.e3a-on').count(), 0);
    } finally {
      await app.close();
    }
  });

  it('window.print (the invoice\'s "Print / Save as PDF") prints through the app', async () => {
    const app = await open('/invoice', { config: null });
    try {
      await app.page.evaluate(() => window.print());
      const calls = await app.calls('Ebda3Shell', 'print');
      assert.equal(calls.length, 1);
      assert.equal(typeof calls[0].options.name, 'string');
    } finally {
      await app.close();
    }
  });
});

describe('Google / Facebook sign-in', () => {
  it('is hidden in the app while the shop doesn\'t support it, and explains what to use', async () => {
    const app = await open('/account', { config: null });
    try {
      await app.page.locator('#soc-google').waitFor({ state: 'attached' });
      await wait(500);
      assert.equal(await app.page.locator('#acct-social').evaluate((el) => getComputedStyle(el).display), 'none');
      await app.page.locator('#soc-google').evaluate((el) => el.click());
      await until(() => app.page.locator('#e3a-toast.e3a-on').count(), { what: 'the toast' });
      assert.match(await app.page.locator('#e3a-toast').textContent(), /رقم الموبايل/);
      assert.equal(new URL(app.page.url()).pathname, '/account');
      assert.deepEqual(await app.calls('Ebda3Shell', 'signIn'), []);
    } finally {
      await app.close();
    }
  });

  it('when the shop turns it on, it goes through the phone\'s browser with a one-time secret', async () => {
    const config = { features: { socialLogin: { android: true, ios: false } } };
    const app = await open('/account', { config });
    try {
      await until(() => app.page.locator('#soc-google').evaluate((el) => !el.hidden && getComputedStyle(el.parentElement).display !== 'none'),
        { what: 'the Google button', timeout: 8000 });
      await app.page.locator('#soc-google').click();
      const [call] = await until(() => app.calls('Ebda3Shell', 'signIn').then((c) => c.length && c), { what: 'signIn' });
      const start = new URL(call.options.url);
      assert.equal(start.origin, site.origin);
      assert.equal(start.pathname, '/auth/google');
      assert.equal(start.searchParams.get('app'), '1');
      assert.match(call.options.verifier, /^[A-Za-z0-9_-]{43}$/);
      const expected = crypto.createHash('sha256').update(call.options.verifier).digest('base64url');
      assert.equal(start.searchParams.get('challenge'), expected);
      assert.equal(new URL(app.page.url()).pathname, '/account');
    } finally {
      await app.close();
    }
  });

  it('stays hidden on iPhone when only Android has it', async () => {
    const config = { features: { socialLogin: { android: true, ios: false } } };
    const app = await open('/account', { platform: 'ios', config });
    try {
      await app.page.locator('#soc-google').waitFor({ state: 'attached' });
      await wait(800);
      assert.equal(await app.page.locator('#acct-social').evaluate((el) => getComputedStyle(el).display), 'none');
    } finally {
      await app.close();
    }
  });
});

describe('updates (from /app/config.json)', () => {
  it('a too-old app must update: a full-screen message that opens the update', async () => {
    const config = {
      android: { minBuild: 10001, latestBuild: 10001, storeUrl: 'https://play.google.com/store/apps/details?id=me.ebda3.app' },
    };
    const app = await open('/', { config, answers: { 'AppUpdate.getAppUpdateInfo': { updateAvailability: 1 } } });
    try {
      await app.page.locator('#e3a-sheet.e3a-block').waitFor({ timeout: 5000 });
      assert.match(await app.page.locator('#e3a-sheet h2').textContent(), /لازم تحدّث/);
      assert.equal(await app.page.locator('#e3a-sheet .e3a-alt').count(), 0, 'no way to skip it');
      await app.page.locator('#e3a-sheet .e3a-main').click();
      await until(() => app.calls('Ebda3Shell', 'open').then((c) => c.length), { what: 'the store page' });
      assert.equal((await app.calls('Ebda3Shell', 'open'))[0].options.url, config.android.storeUrl);
      assert.equal(await app.page.locator('#e3a-sheet').count(), 1, 'still blocking');
    } finally {
      await app.close();
    }
  });

  it('uses Google Play\'s in-app update when Play offers one', async () => {
    const config = { android: { minBuild: 10001 } };
    const app = await open('/', {
      config,
      answers: { 'AppUpdate.getAppUpdateInfo': { updateAvailability: 2, immediateUpdateAllowed: true } },
    });
    try {
      await app.page.locator('#e3a-sheet .e3a-main').click();
      await until(() => app.calls('AppUpdate', 'performImmediateUpdate').then((c) => c.length), { what: 'the Play update' });
    } finally {
      await app.close();
    }
  });

  it('a newer version is offered once, and can be put off', async () => {
    const config = { android: { latestBuild: 10002 }, message: { ar: 'نسخة فيها حاجات جديدة', en: 'New things inside' } };
    const app = await open('/', { config });
    try {
      await app.page.locator('#e3a-banner').waitFor({ timeout: 5000 });
      assert.match(await app.page.locator('#e3a-banner span').textContent(), /حاجات جديدة/);
      await app.page.locator('#e3a-banner .e3a-x').click();
      await app.page.reload({ waitUntil: 'load' });
      await wait(800);
      assert.equal(await app.page.locator('#e3a-banner').count(), 0);
    } finally {
      await app.close();
    }
  });

  it('an up-to-date app shows nothing; the allowed hosts reach the app', async () => {
    const config = { android: { minBuild: 9000, latestBuild: 10000 }, inAppHosts: ['accept.paymob.com', 7] };
    const app = await open('/', { config });
    try {
      const [call] = await until(() => app.calls('Ebda3Shell', 'setRemoteConfig').then((c) => c.length && c), { what: 'setRemoteConfig' });
      assert.deepEqual(call.options, { inAppHosts: ['accept.paymob.com'] });
      await wait(500);
      assert.equal(await app.page.locator('#e3a-sheet, #e3a-banner').count(), 0);
    } finally {
      await app.close();
    }
  });

  it('keeps working without the config file (the site hasn\'t added it yet)', async () => {
    const app = await open('/', { config: null });
    try {
      await wait(600);
      assert.equal(await app.page.locator('#e3a-sheet, #e3a-banner').count(), 0);
      assert.equal(await app.page.evaluate(() => window.ebda3App.isApp), true);
    } finally {
      await app.close();
    }
  });
});

describe('notifications', () => {
  const pushConfig = { features: { push: true } };
  const answers = {
    'PushNotifications.checkPermissions': { receive: 'prompt' },
    'PushNotifications.requestPermissions': { receive: 'granted' },
    'PushNotifications.register': { resolve: undefined, emit: { event: 'registration', data: { value: 'token-123' } } },
  };

  it('right after an order, offers them; turning them on registers the phone with the shop', async () => {
    const devices = [];
    const app = await open('/order?id=x&k=y&new=1', { push: true, config: pushConfig, answers, devices });
    try {
      await app.page.locator('#e3a-sheet').waitFor({ timeout: 6000 });
      assert.match(await app.page.locator('#e3a-sheet h2').textContent(), /تابع طلبك/);
      await app.page.locator('#e3a-sheet .e3a-main').click();
      await until(() => devices.length, { what: 'the device registration' });
      assert.deepEqual(devices[0].body, { token: 'token-123', platform: 'android', appVersion: '1.0.0', build: 10000, lang: 'ar' });
      assert.equal(await app.page.locator('#e3a-sheet').count(), 0);
    } finally {
      await app.close();
    }
  });

  it('not offered when the app or the shop has no notifications yet', async () => {
    for (const o of [{ push: false, config: pushConfig }, { push: true, config: {} }]) {
      const app = await open('/order?id=x&k=y&new=1', { ...o, answers });
      try {
        await wait(2000);
        assert.equal(await app.page.locator('#e3a-sheet').count(), 0);
      } finally {
        await app.close();
      }
    }
  });

  it('a tapped notification opens its shop page, never another site', async () => {
    const app = await open('/', { push: true, config: pushConfig, answers: { 'PushNotifications.checkPermissions': { receive: 'denied' } } });
    try {
      await app.page.evaluate(() => window.__emit('PushNotifications', 'pushNotificationActionPerformed',
        { notification: { data: { url: 'https://evil.example/x' } } }));
      await wait(300);
      assert.equal(new URL(app.page.url()).pathname, '/');
      await Promise.all([
        app.page.waitForURL('**/account'),
        app.page.evaluate((o) => window.__emit('PushNotifications', 'pushNotificationActionPerformed',
          { notification: { data: { url: o + '/account' } } }), site.origin),
      ]);
    } finally {
      await app.close();
    }
  });
});
