// Service Worker para PWA
const CACHE_NAME = 'psicologa-app-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/cooperativa urbanos.png',
  '/manifest.json'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Estrategia: Network First, luego Cache
// No interceptar peticiones al backend: dejarlas pasar para evitar errores CORS en consola
const API_HOST = 'psicologa-backend.onrender.com';
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // No tocar peticiones al API (cross-origin): el navegador las hace desde la página y CORS funciona bien
  if (url.hostname === API_HOST) {
    return;
  }
  
  // Para otros recursos (mismo origen), usar Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si la respuesta es válida, clonarla y guardarla en cache
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // Si falla la red, intentar desde el cache
        return caches.match(event.request);
      })
  );
});

