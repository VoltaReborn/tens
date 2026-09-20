// sw.js — Tens smart cache with update-friendly network-first files
const CACHE_VERSION = 'v135';
const STATIC_CACHE = `tens-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tens-runtime-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const base = self.registration.scope;
    for (const rel of ASSETS) {
      const url = new URL(rel, base).toString();
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
        await cache.put(url, response.clone());
      } catch (err) {
        console.error('[SW] precache skipped:', url, '→', err.message);
      }
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => (name.startsWith('tens-static-') || name.startsWith('tens-runtime-')) && ![STATIC_CACHE, RUNTIME_CACHE].includes(name))
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

function isHTMLRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

function isNetworkFirstUrl(url, request) {
  return isHTMLRequest(request) || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.json');
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match(new URL('./index.html', self.registration.scope).toString());
    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirstUrl(url, request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request).catch(async () => {
    const runtime = await caches.open(RUNTIME_CACHE);
    const cached = await runtime.match(request);
    if (cached) return cached;
    const staticCache = await caches.open(STATIC_CACHE);
    return staticCache.match(new URL('./index.html', self.registration.scope).toString());
  }));
});
