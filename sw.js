/* ============================================================
   ArduinoBlocks TEC4 — Service Worker
   ------------------------------------------------------------
   La versión de la aplicación se define ÚNICAMENTE aquí, en
   CACHE_NAME. El chip del menú lateral la muestra de forma
   dinámica preguntando al SW (mensaje GET_VERSION), de modo
   que basta con subir el número de versión para actualizarla.
   ============================================================ */
const CACHE_NAME = 'arduinoblocks-v1.19';
const APP_VERSION = (CACHE_NAME.match(/-v(\d[\w.]*)$/) || [])[1] || CACHE_NAME;

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
      // Cachear assets locales primero (no bloquear si algún CDN falla)
      const localPromise = cache.addAll(ASSETS_TO_CACHE).catch(() => {});
      // Cachear CDN assets (no bloquear si fallan)
      const cdnPromise = Promise.allSettled(
        CDN_ASSETS.map((url) => cache.add(url))
      );
      return Promise.all([localPromise, cdnPromise]);
    })
  );
  self.skipWaiting();
});

// Activación: limpiar cachés antiguas
// Solo borrar cachés de esta propia app (por prefijo): no tocar las cachés
// del portal ni las de otras apps alojadas en subcarpetas del mismo dominio.
const esCachePropia = (cacheName) => cacheName.startsWith('arduinoblocks-');

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && esCachePropia(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
  console.log('[SW] Activado: v' + APP_VERSION + ' (caché ' + CACHE_NAME + ')');
});

// Comunicación con la página: versión dinámica para el chip del menú lateral.
// La página envía { type: 'GET_VERSION' } y el SW responde con la versión
// extraída de CACHE_NAME (fuente única de verdad de la versión).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', version: APP_VERSION };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(reply); // respuesta por MessageChannel (preferida)
    } else if (event.source) {
      event.source.postMessage(reply); // compatibilidad
    }
  }
});

// Fetch: stale-while-revalidate para assets, fallback offline para navegaciones
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return; // URL no válida: dejar pasar
  }

  // No interceptar peticiones a Firebase Realtime Database.
  // FIX: se excluían los dos dominios (el clásico firebaseio.com y el actual
  // *.firebasedatabase.app que usa esta app) para no romper la sincronización.
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Stale-while-revalidate: servir desde caché y actualizar en background
        revalidate(request);
        return cached;
      }

      // No está en caché: ir a la red
      return fetch(request)
        .then((networkResponse) => {
          // FIX: también cachear respuestas opacas (CDN sin CORS) para offline
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => offlineFallback(request, url));
    })
  );
});

// Revalidación en segundo plano (nunca genera rechazos sin capturar)
function revalidate(request) {
  fetch(request).then((networkResponse) => {
    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
      const clone = networkResponse.clone();
      caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, clone))
        .catch(() => {});
    }
  }).catch(() => {});
}

// Sin red ni caché: servir la app cacheada solo a navegaciones del PROPIO
// origen (FIX: antes podía devolverse index.html a peticiones de otros dominios)
function offlineFallback(request, url) {
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html');
  if (wantsHtml && url.origin === self.location.origin) {
    return caches.match('./index.html').then((page) => page || offlinePage());
  }
  return offlinePage();
}

function offlinePage() {
  return new Response(
    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Sin conexión</title></head>' +
    '<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#0f172a;background:#f8fafc">' +
    '<h1>Sin conexión</h1>' +
    '<p>No hay conexión a internet y este recurso no está en la caché.</p>' +
    '<p><button onclick="location.reload()" style="padding:.6rem 1.2rem;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">Reintentar</button></p>' +
    '</body></html>',
    { status: 504, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
