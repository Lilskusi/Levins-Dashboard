/* Service Worker: macht das Dashboard schnell und offline startklar.
   Wenn du Dateien änderst und hochlädst, erhöhe die Zahl bei CACHE (v1 -> v2),
   dann holen sich alle Geräte sicher die neue Version. */
const CACHE = 'levins-dashboard-v5';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Eigene Dateien: sofort aus dem Cache zeigen und im Hintergrund aktualisieren.
// Fremde Adressen (zum Beispiel das Wetter) gehen direkt ins Netz.
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        const network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          return cached || cache.match('index.html');
        });
        return cached || network;
      });
    })
  );
});
