// The app's "no connection" page (www/offline.html): goes back to the page that failed, by the button and by
// itself once the shop can be reached again; never goes anywhere but a web page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';
import { MOBILE, until } from './helpers/app-page.mjs';

const WWW = path.join(MOBILE, 'www');
let browser;
let app; // serves www/ like the app's local pages
let appOrigin;

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

const shop = (text) => (req, res) => {
  res.writeHead(200, { 'Content-Type': req.url.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' });
  res.end(req.url.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : `<!doctype html><title>${text}</title><p>${text}</p>`);
};

before(async () => {
  browser = await chromium.launch();
  app = await serve((req, res) => {
    const file = path.join(WWW, new URL(req.url, 'http://x').pathname);
    if (!file.startsWith(WWW) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  appOrigin = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await browser?.close();
  app?.close();
});

describe('the "no connection" page', () => {
  it('shows both languages and the brand mark, and "Try again" opens the page that failed', async () => {
    const shopSrv = await serve(shop('designs page'));
    const from = `http://127.0.0.1:${shopSrv.address().port}/designs?cat=ramadan`;
    const page = await browser.newPage();
    try {
      await page.goto(`${appOrigin}/offline.html?from=${encodeURIComponent(from)}`);
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

  it('goes back by itself once the shop answers again', async () => {
    const port = await freePort();
    const from = `http://127.0.0.1:${port}/account`;
    const page = await browser.newPage();
    let shopSrv;
    try {
      await page.goto(`${appOrigin}/offline.html?from=${encodeURIComponent(from)}`);
      await page.waitForTimeout(3500); // first check after 3 s: the shop is still down
      assert.match(page.url(), /offline\.html/);
      shopSrv = await serve(shop('account page'), port);
      await page.waitForURL(from, { timeout: 15000 });
    } finally {
      await page.close();
      shopSrv?.close();
    }
  });

  it('only ever goes to a web address', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${appOrigin}/index.html`);
      await page.goto(`${appOrigin}/offline.html?from=${encodeURIComponent('javascript:document.title="hacked"')}`);
      await Promise.all([page.waitForURL(`${appOrigin}/index.html`), page.click('#retry')]);
      assert.notEqual(await page.title(), 'hacked');
    } finally {
      await page.close();
    }
  });

  it('the "online" event makes it check at once', async () => {
    const shopSrv = await serve(shop('cart page'));
    const from = `http://127.0.0.1:${shopSrv.address().port}/cart`;
    const page = await browser.newPage();
    try {
      await page.goto(`${appOrigin}/offline.html?from=${encodeURIComponent(from)}`);
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
