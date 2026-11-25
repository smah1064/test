// The app's "no connection" page (www/offline.html): goes back to the page that failed, by the button and by
// itself once the app says the shop can be reached again; never goes anywhere but a web page.
//
// As in the app, the page and the shop are different sites here (the page at app.test, the shop at 127.0.0.1 or
// localhost) and the shop sends its real security headers, so the page can't read the shop's answers itself. It asks
// the app instead: on Android with a request to its own address ("online-check", answered here the way the Android
// app answers it), on iPhone with a message ("ebda3Online").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';
import { MOBILE, until } from './helpers/app-page.mjs';
import { startSite } from './helpers/site.mjs';

const WWW = path.join(MOBILE, 'www');
const APP_HOST = 'app.test';
let browser;
let app; // serves www/ like the app's local pages and answers "online-check" like the Android app
let appOrigin;
let site = null; // the shop the app checks (in the app: the shop address it was built for)
let checks = 0; // how many times a page asked the app

function serve(handler, port = 0) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// The shop's own headers (src/security.js): other sites can't read its answers.
const SHOP_HEADERS = { 'Cross-Origin-Resource-Policy': 'same-site', 'Cross-Origin-Opener-Policy': 'same-origin' };
const shop = (text) => (req, res) => {
  const svg = new URL(req.url, 'http://x').pathname.endsWith('.svg');
  res.writeHead(200, { ...SHOP_HEADERS, 'Content-Type': svg ? 'image/svg+xml' : 'text/html; charset=utf-8' });
  res.end(svg ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : `<!doctype html><title>${text}</title><p>${text}</p>`);
};

/** What the Android app does for "online-check": does the shop answer at all? */
async function shopAnswers() {
  if (!site) return false;
  try {
    await fetch(`${site}/favicon.svg?online=${Date.now()}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

const offlineUrl = (from) => `${appOrigin}/offline.html?from=${encodeURIComponent(from)}`;

before(async () => {
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1`] });
  app = await serve(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/online-check') {
      checks++;
      const online = await shopAnswers();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ online }));
    }
    const file = path.join(WWW, pathname);
    if (!file.startsWith(WWW) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  appOrigin = `http://${APP_HOST}:${app.address().port}`;
});

after(async () => {
  await browser?.close();
  app?.close();
});

describe('the "no connection" page', () => {
  it('shows both languages and the brand mark, and "Try again" opens the page that failed', async () => {
    const shopSrv = await serve(shop('designs page'));
    site = `http://127.0.0.1:${shopSrv.address().port}`;
    const from = `${site}/designs?cat=ramadan`;
    const page = await browser.newPage();
    try {
      await page.goto(offlineUrl(from));
      assert.match(await page.textContent('h1'), /مفيش اتصال/);
      assert.match(await page.textContent('.en'), /No internet connection/);
      assert.equal(await page.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), true);
      await Promise.all([page.waitForURL(from), page.click('#retry')]);
      assert.equal(await page.textContent('p'), 'designs page');
    } finally {
      await page.close();
      shopSrv.close();
    }
  });

  it('goes back by itself once the app says the shop answers again', async () => {
    const port = await freePort();
    site = `http://127.0.0.1:${port}`;
    const from = `${site}/account`;
    const page = await browser.newPage();
    let shopSrv;
    try {
      const asked = checks;
      await page.goto(offlineUrl(from));
      await page.waitForTimeout(3500); // first check after 3 s: the shop is still down
      assert.match(page.url(), /offline\.html/);
      assert.ok(checks > asked, 'the page asked the app');
      shopSrv = await serve(shop('account page'), port);
      await page.waitForURL(from, { timeout: 15000 });
    } finally {
      await page.close();
      shopSrv?.close();
    }
  });

  it('with a copy of the real shop: the page can\'t read the shop itself, and the app\'s check brings it back', async () => {
    const real = await startSite();
    site = real.origin;
    const from = `${real.origin}/designs`;
    const page = await browser.newPage();
    try {
      await page.goto(offlineUrl(from));
      // Why the page asks the app: the shop doesn't let another site read its answers (the old way never came back).
      const direct = await page.evaluate(
        (origin) => fetch(`${origin}/favicon.svg?direct=1`, { mode: 'no-cors', cache: 'no-store' }).then(() => 'read', () => 'blocked'),
        real.origin,
      );
      assert.equal(direct, 'blocked');
      await page.waitForURL(from, { timeout: 15000 });
      assert.match(await page.title(), /إبداع|ebda3/i);
    } finally {
      await page.close();
      await real.stop();
    }
  });

  it('on iPhone it asks the app with a message', async () => {
    const shopSrv = await serve(shop('cart page'));
    site = null; // the Android way would never say "online"
    const from = `http://127.0.0.1:${shopSrv.address().port}/cart`;
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.__asked = [];
      window.__online = false;
      window.webkit = {
        messageHandlers: {
          ebda3Online: {
            postMessage(m) {
              window.__asked.push(m);
              return Promise.resolve(window.__online);
            },
          },
        },
      };
    });
    const page = await context.newPage();
    try {
      const asked = checks;
      await page.goto(offlineUrl(from));
      await until(() => page.evaluate(() => window.__asked.length > 0), { timeout: 6000, what: 'the page to ask the app' });
      assert.match(page.url(), /offline\.html/);
      await page.evaluate(() => {
        window.__online = true;
        window.dispatchEvent(new Event('online'));
      });
      await page.waitForURL(from, { timeout: 5000 });
      assert.equal(checks, asked, 'no Android request on iPhone');
    } finally {
      await context.close();
      shopSrv.close();
    }
  });

  it('stays while the app says no, or gives no answer', async () => {
    site = `http://127.0.0.1:${await freePort()}`; // nothing there
    const from = `${site}/orders`;
    const page = await browser.newPage();
    try {
      await page.goto(offlineUrl(from));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(1500);
      assert.match(page.url(), /offline\.html/);
      await page.route('**/online-check*', (route) => route.fulfill({ status: 404, body: 'Not found' }));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(1500);
      assert.match(page.url(), /offline\.html/);
    } finally {
      await page.close();
    }
  });

  it('only ever goes to a web address', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${appOrigin}/index.html`);
      await page.goto(offlineUrl('javascript:document.title="hacked"'));
      await Promise.all([page.waitForURL(`${appOrigin}/index.html`), page.click('#retry')]);
      assert.notEqual(await page.title(), 'hacked');
    } finally {
      await page.close();
    }
  });

  it('the "online" event makes it check at once', async () => {
    const shopSrv = await serve(shop('cart page'));
    site = `http://127.0.0.1:${shopSrv.address().port}`;
    const from = `${site}/cart`;
    const page = await browser.newPage();
    try {
      await page.goto(offlineUrl(from));
      const started = Date.now();
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForURL(from, { timeout: 2500 });
      assert.ok(Date.now() - started < 2500);
    } finally {
      await page.close();
      shopSrv.close();
    }
  });
});

describe('app files', () => {
  it('the local pages the app serves exist', async () => {
    for (const f of ['offline.html', 'brand-mark.svg', 'app-glue.js', 'index.html']) {
      assert.ok(fs.existsSync(path.join(WWW, f)), `www/${f}`);
    }
    await until(() => true);
  });
});
