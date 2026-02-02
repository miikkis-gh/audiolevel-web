const CACHE_NAME = 'audiolevel-v1';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls and WebSocket - always go to network
  if (url.pathname.startsWith('/api') || url.pathname === '/ws') {
    return;
  }

  // Skip audio file uploads/downloads
  if (request.headers.get('content-type')?.includes('audio')) {
    return;
  }

  // For app assets: try cache first, fall back to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Return cached, but also update cache in background
        event.waitUntil(
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {})
        );
        return cached;
      }

      // Not in cache, fetch from network
      return fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css') ||
          url.pathname.endsWith('.woff2') ||
          url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.svg')
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      });
    })
  );
});
