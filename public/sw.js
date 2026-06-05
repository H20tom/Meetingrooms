/* ============================================================
   H20 Meetingroom — Service Worker (offline cache)
   ============================================================ */
const CACHE_VERSION = 'h20-meetingroom-v15';
const CORE = [
  './',
  './index.html',
  './tablet.html',
  './dashboard.html',
  './login.html',
  './admin.html',
  './styles.css',
  './app.js',
  './auth.js',
  './kiosk.js',
  './Logo H20 2026.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API-verzoeken NOOIT cachen: altijd live van de server (anders toont het
  // dashboard/tablet verouderde zaalstatus). Geen offline-fallback voor /api.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-first for same-origin HTML; cache-first for everything else
  if (req.mode === 'navigate' || (url.origin === location.origin && req.destination === 'document')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      if (url.origin === location.origin && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => m))
  );
});
