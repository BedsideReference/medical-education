/* Guide to Ventilation · installed-web-app update service worker · internal build v1.10.107 */
'use strict';

const BUILD = 'v1.10.107';
const CACHE_PREFIXES = ['ventilation-guide-', 'ventilation-guide-core-'];
const CACHE_NAME = `ventilation-guide-core-${BUILD}`;
const SCOPE_URL = new URL(self.registration.scope);
const CANONICAL_URL = new URL('mechanical-ventilation-teaching-reference.html', SCOPE_URL).href;
const VERSION_URL = new URL('ventilation-guide-version.json', SCOPE_URL).href;
const CORE_URLS = [
  CANONICAL_URL,
  VERSION_URL,
  new URL('manifest.webmanifest', SCOPE_URL).href,
  new URL('apple-touch-icon.png', SCOPE_URL).href,
  new URL('icon-192.png', SCOPE_URL).href,
  new URL('icon-512.png', SCOPE_URL).href,
  new URL('favicon-32.png', SCOPE_URL).href,
  new URL('og-card.png', SCOPE_URL).href
];

function cacheable(response) {
  return !!response && (response.ok || response.type === 'opaque');
}

function guideEntry(url) {
  if (!url || url.origin !== SCOPE_URL.origin) return false;
  if (url.searchParams.get('review') === '1') return false;
  const file = (url.pathname.split('/').pop() || '').toLowerCase();
  return file === 'mechanical-ventilation-teaching-reference.html' ||
    /^ventilation_guide_master_.*\.html$/i.test(file) ||
    /^ventilation_guide_chapter_6_revised_.*\.html$/i.test(file);
}

function canonicalRequest() {
  return new Request(CANONICAL_URL, { method:'GET', credentials:'same-origin' });
}

async function fetchFresh(url, options = {}) {
  const target = new URL(url);
  const sameOrigin = target.origin === SCOPE_URL.origin;
  return fetch(new Request(target.href, {
    method:'GET',
    credentials:sameOrigin ? 'same-origin' : 'omit',
    mode:sameOrigin ? 'same-origin' : 'cors',
    cache:'no-store',
    redirect:'follow',
    ...options
  }));
}

async function put(cache, key, response) {
  if (!cacheable(response)) return false;
  try { await cache.put(key, response.clone()); return true; } catch (_) { return false; }
}

async function cacheCanonical(cache) {
  const fresh = new URL(CANONICAL_URL);
  fresh.searchParams.set('__vg_build', BUILD);
  const response = await fetchFresh(fresh.href);
  if (!response.ok) throw new Error(`Canonical guide fetch failed: ${response.status}`);
  const probe = await response.clone().text();
  if (!probe.includes(`data-build="${BUILD}"`)) {
    throw new Error(`Deployment is not atomic: ${BUILD} worker saw a different guide build.`);
  }
  await put(cache, canonicalRequest(), response);
  return response;
}

async function seedCore() {
  const cache = await caches.open(CACHE_NAME);
  await cacheCanonical(cache);
  for (const url of CORE_URLS.slice(1)) {
    try {
      const response = await fetchFresh(url);
      await put(cache, new Request(url), response);
    } catch (_) {}
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await seedCore();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => CACHE_PREFIXES.some(prefix => name.startsWith(prefix)) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();

    // Force already-open old app shells to the stable current document. This
    // also updates clients that predate the new controllerchange listener.
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    await Promise.all(windows.map(async client => {
      try {
        const current = new URL(client.url);
        if (!guideEntry(current)) return;
        const target = new URL(CANONICAL_URL);
        target.searchParams.set('app-build', BUILD.replace(/^v/, ''));
        target.hash = current.hash || '';
        await client.navigate(target.href);
      } catch (_) {}
    }));
  })());
});

async function navigationResponse(requestUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await cacheCanonical(cache);
    if (requestUrl.pathname !== new URL(CANONICAL_URL).pathname) {
      return Response.redirect(CANONICAL_URL, 302);
    }
    return response;
  } catch (_) {
    const cached = await cache.match(canonicalRequest(), { ignoreSearch:true });
    if (cached) {
      if (requestUrl.pathname !== new URL(CANONICAL_URL).pathname) {
        return Response.redirect(CANONICAL_URL, 302);
      }
      return cached;
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide unavailable offline</title><style>body{font-family:system-ui;padding:2rem;max-width:42rem;margin:auto;line-height:1.5}</style><h1>Guide unavailable offline</h1><p>Reconnect once and open the current Guide to Ventilation so the newest build can be saved.</p>',
      { status:503, headers:{ 'Content-Type':'text/html; charset=utf-8' } }
    );
  }
}

async function isGuideClient(clientId) {
  if (!clientId) return false;
  try {
    const client = await self.clients.get(clientId);
    return !!client && guideEntry(new URL(client.url));
  } catch (_) { return false; }
}

function isKnownGuideAsset(url) {
  if (CORE_URLS.includes(url.href)) return true;
  if (url.origin === SCOPE_URL.origin && /\/fonts\//i.test(url.pathname)) return true;
  return /(^|\.)cdn\.jsdelivr\.net$/i.test(url.hostname) && /katex/i.test(url.pathname);
}

async function assetResponse(event, url) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const shouldOwn = isKnownGuideAsset(url) || await isGuideClient(event.clientId);
  if (!shouldOwn) return fetch(request);

  const networkFirst = url.href === VERSION_URL || /manifest\.webmanifest$/i.test(url.pathname);
  if (networkFirst) {
    try {
      const response = await fetchFresh(url.href);
      await put(cache, request, response);
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch:true });
      if (cached) return cached;
      throw error;
    }
  }

  const cached = await cache.match(request, { ignoreSearch:false });
  if (cached) {
    event.waitUntil((async () => {
      try {
        const response = await fetchFresh(url.href);
        await put(cache, request, response);
      } catch (_) {}
    })());
    return cached;
  }

  const response = await fetch(request);
  await put(cache, request, response);
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  if (request.mode === 'navigate') {
    if (!guideEntry(url)) return;
    event.respondWith(navigationResponse(url));
    return;
  }

  event.respondWith(assetResponse(event, url).catch(() => new Response('', { status:504, statusText:'Offline' })));
});

function normalizePrefetchUrl(raw, sourceUrl) {
  const absolute = new URL(raw, sourceUrl);
  if (guideEntry(absolute)) return CANONICAL_URL;
  return absolute.href;
}

self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'skip-waiting' || data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (data.type === 'get-version' || data.type === 'GET_VERSION') {
    const payload = { type:'vent-guide-version', build:BUILD, cache:CACHE_NAME, canonical:CANONICAL_URL };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
    else if (event.source && typeof event.source.postMessage === 'function') event.source.postMessage(payload);
    return;
  }

  if (data.type !== 'prefetch' || !Array.isArray(data.urls)) return;
  const requestId = data.id || null;
  const sourceUrl = event.source && event.source.url ? event.source.url : self.registration.scope;

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = [...new Set(data.urls
      .filter(value => typeof value === 'string' && value)
      .map(value => { try { return normalizePrefetchUrl(value, sourceUrl); } catch (_) { return null; } })
      .filter(Boolean))];
    let ok = 0;
    let failed = 0;

    for (const href of urls) {
      try {
        const absolute = new URL(href);
        if (!/^https?:$/.test(absolute.protocol)) { failed += 1; continue; }
        const sameOrigin = absolute.origin === SCOPE_URL.origin;
        const request = new Request(absolute.href, {
          method:'GET',
          mode:sameOrigin ? 'same-origin' : 'cors',
          credentials:sameOrigin ? 'same-origin' : 'omit',
          cache:'reload'
        });
        const response = await fetch(request);
        if (!cacheable(response)) { failed += 1; continue; }
        const key = absolute.href === CANONICAL_URL ? canonicalRequest() : request;
        await cache.put(key, response.clone());
        ok += 1;
      } catch (_) { failed += 1; }
    }

    const payload = { type:'prefetch-done', id:requestId, ok, failed, total:urls.length, build:BUILD };
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage(payload);
    } else {
      const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      clients.forEach(client => client.postMessage(payload));
    }
  })());
});
