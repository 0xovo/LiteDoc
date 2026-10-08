// A minimal Service Worker to satisfy PWA install requirements
const CACHE_NAME = 'litedoc-pwa-v2';

self.addEventListener('install', (event) => {
    // Cache the root only. './index.html' is the same 1 MB app under a second URL, so
    // precaching both downloaded the app twice more on every first visit.
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.add('./'))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
    );
});

self.addEventListener('fetch', (event) => {
    // Same-origin GETs only: CDN libraries and the sponsor ad go straight to the network.
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    // Network first (the HTTP cache turns repeat visits into cheap 304s); cache when offline.
    event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
});
