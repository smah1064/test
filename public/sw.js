/*
 * إبداع as an app on the phone's home screen (the site installed): this worker only steps in when a page can't
 * be reached at all (no connection), and shows the shop's "no connection" page instead of the browser's.
 * Nothing else is kept: pages, orders, prices and pictures always come from the shop (no stale copies), and
 * every other request (files, the shop's answers) goes to the network as if the worker weren't there.
 * Served by the app at /sw.js (no-cache, see src/app.js); a new VERSION replaces the kept page.
 */
'use strict';

const VERSION = 'v1';
const CACHE = `ebda3-${VERSION}`;
const OFFLINE = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ebda3-') && key !== CACHE) await caches.delete(key);
    // (The page is asked for while the worker starts: no wait added to opening a page.)
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return; // everything else: as without the worker
  event.respondWith((async () => {
    try {
      const early = await event.preloadResponse;
      if (early) return early;
      return await fetch(req);
    } catch (err) {
      const kept = await caches.match(OFFLINE, { cacheName: CACHE });
      return kept || Response.error();
    }
  })());
});
