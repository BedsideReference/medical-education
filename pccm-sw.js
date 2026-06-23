/* Service worker — PCCM Learning Log (isolated to the pccm-app/ scope).
   Strategy:
   - Precache the app shell + icons on install.
   - Navigations: serve cached index.html when offline (app-shell fallback).
   - Same-origin GET: stale-while-revalidate (fast load, refresh in background).
   Bump VERSION to force clients to pick up a new build.
*/
var VERSION = 'pccm-v1-2026-06-22';
var CACHE = 'pccm-' + VERSION;
var ASSETS = [
  './',
  './index.html',
  './pccm.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // resilient: don't let one missing asset abort the install
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // App-shell fallback for navigations (offline returns the cached app)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // Same-origin: stale-while-revalidate
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || net;
      })
    );
  }
});
