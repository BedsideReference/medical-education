/* Service worker — Guide to Ventilation bedside reference.
   Strategy:
   - Precache the book shell, its inline figures, KaTeX, and icons on install (resilient: a single failure won't abort).
   - Same-origin GET: cache-first, fall back to network, then update the cache (stale-while-revalidate-ish).
   - Cross-origin GET (KaTeX CDN + fonts): cache-first runtime.
   - Navigation requests: fall back to the cached book when offline.
*/
var VERSION = 'vent-v1-2026-06-15';
var CORE_CACHE = 'core-' + VERSION;
var RUNTIME_CACHE = 'runtime-' + VERSION;

var CORE_ASSETS = [
  './',
  'mechanical-ventilation-teaching-reference.html',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'favicon-32.png',
  // Figures embedded inline in the book
  'fig_05_01_flow_volume_loops.png',
  'fig_07_01_pv_loop.png',
  'fig_07_02_mechanics_five_pressures.png',
  'fig_12_01_aprv_waveforms.png',
  'fig_29_01_cardiopulmonary_interactions.png',
  // Math typesetting (CDN)
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CORE_CACHE).then(function (cache) {
      // Cache each asset individually so one failure (e.g. a 404) does not abort the whole install.
      return Promise.allSettled(CORE_ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CORE_CACHE && key !== RUNTIME_CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// "Save for offline" — the page sends a list of URLs (the tap-to-load simulators,
// which are never fetched until tapped) to warm the runtime cache up front.
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'prefetch' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then(function (cache) {
        return Promise.allSettled(data.urls.map(function (u) {
          return fetch(new Request(u, { cache: 'reload' }))
            .then(function (res) { if (res && (res.ok || res.type === 'opaque')) return cache.put(u, res.clone()); })
            .catch(function () {});
        }));
      }).then(function (results) {
        var ok = results.filter(function (r) { return r.status === 'fulfilled'; }).length;
        if (event.source) event.source.postMessage({ type: 'prefetch-done', total: data.urls.length, ok: ok });
      })
    );
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // Navigations: try network first (fresh content), fall back to the cached book offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('mechanical-ventilation-teaching-reference.html') || caches.match('./');
        });
      })
    );
    return;
  }

  // Everything else: cache-first, then network (and populate runtime cache).
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Cache successful basic/cors/opaque responses for next time.
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});
