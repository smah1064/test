// For the device checks: a copy of the shop behind a small proxy on a fixed port that (1) remembers every request
// (path and user agent), so a check can tell what the app on the phone did, and (2) can be switched off and on,
// so the phone sees "no connection" (connection refused) and then the shop again.
import http from 'node:http';
import { startSite } from '../helpers/site.mjs';

export async function startShop({ port = 3600, host = '127.0.0.1' } = {}) {
  const site = await startSite();
  const target = new URL(site.origin);
  const requests = [];
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    requests.push({ at: Date.now(), method: req.method, path: req.url, ua: req.headers['user-agent'] || '' });
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await listen();

  return {
    origin: `http://${host}:${port}`,
    requests,
    /** Requests (since `since`) whose path matches and that came from the app (its user agent). */
    fromApp(pathRe, platform, since = 0) {
      return requests.filter((r) => r.at >= since && pathRe.test(r.path) && r.ua.includes('Ebda3App/') && r.ua.includes(`(${platform})`));
    },
    async waitFor(pathRe, platform, { since = 0, timeout = 60000, what } = {}) {
      const end = Date.now() + timeout;
      for (;;) {
        const hit = this.fromApp(pathRe, platform, since);
        if (hit.length) return hit[0];
        if (Date.now() > end) {
          const seen = requests.slice(-15).map((r) => `${r.method} ${r.path} [${r.ua.slice(-40)}]`).join('\n  ');
          throw new Error(`The app didn't ask for ${what || pathRe} within ${timeout / 1000} s. Last requests:\n  ${seen}`);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    },
    /** No connection: stop listening and drop open connections. */
    async down() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        for (const s of sockets) s.destroy();
      });
    },
    up: listen,
    async stop() {
      await this.down().catch(() => {});
      await site.stop();
    },
  };
}

export function step(name) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`\n[${t}] ${name}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
