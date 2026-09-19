const CACHE_NAME = 'arduinoblocks-v1.18';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// CDN externos a cachear (versionados para estabilidad)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-database-compat.js'
];

// Instalación: cachear todos los recursos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cachear assets locales primero
      const localPromise = cache.addAll(ASSETS_TO_CACHE).catch(() => {});
      // Cachear CDN assets (no bloquear si fallan)
      const cdnPromise = Promise.allSettled(
        CDN_ASSETS.map(url => cache.add(url))
      );
      return Promise.all([localPromise, cdnPromise]);
    })
  );
  self.skipWaiting();
});

// Activación: limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Stale-while-revalidate para assets, Network-first para datos
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No interceptar peticiones POST ni peticiones a Firebase Realtime Database
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('firebaseio.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Stale-while-revalidate: servir desde caché y actualizar en background
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse;
      }

      // No está en caché: ir a la red
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Si falla la red y no hay caché, devolver offline page si es HTML
        if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
