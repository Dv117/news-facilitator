/* =========================================================================
   NEWS FACILITATOR — Service Worker
   Estrategia:
   - App shell (HTML, CSS, JS, iconos): stale-while-revalidate.
   - Navegaciones: network-first con caída al index cacheado (modo offline).
   - Peticiones a otros dominios (feeds/proxies): no se interceptan.

   IMPORTANTE: al publicar cambios, sube VERSION aquí y APP_VERSION en
   app.js. Al activarse una versión nueva, este SW borra la caché vieja y
   recarga las pestañas abiertas, para que no haga falta Ctrl+F5.
   ========================================================================= */

const VERSION = 'news-facilitator-v1.2.0';
const CACHE_PREFIX = 'news-facilitator-';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // cache:'reload' salta la caché HTTP del navegador. Sin esto, si
      // instalas la versión nueva justo después de publicar, el navegador
      // puede guardar copias viejas de app.js y style.css.
      .then((cache) =>
        cache.addAll(ASSETS.map((path) => new Request(scopeUrl(path), { cache: 'reload' })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter(
        (key) => key.startsWith(CACHE_PREFIX) && key !== VERSION
      );

      await Promise.all(oldKeys.map((key) => caches.delete(key)));
      await self.clients.claim();

      // Solo si había una versión anterior: recarga las pestañas abiertas
      // una vez para que muestren el HTML/JS nuevos al instante.
      if (oldKeys.length) {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => {
          if ('navigate' in client) client.navigate(client.url).catch(() => {});
        });
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // feeds y proxies: red directa

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(scopeUrl('./index.html'), copy));
          return response;
        })
        .catch(() =>
          caches
            .match(scopeUrl('./index.html'))
            .then((cached) => cached || caches.match(scopeUrl('./')))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
