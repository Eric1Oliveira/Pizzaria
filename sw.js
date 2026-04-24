// Service Worker — Casa José Silva Pizzaria
// Cache-first para assets estáticos, network-first para API

const CACHE_NAME = 'cjspizza-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/style.css',
  '/manifest.json',
  '/logo.png',
  '/Banner.png'
];

// Instalar: pré-cache dos assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

// Ativar: limpar caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first para estáticos, network-first para Supabase/API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar: extensões de browser, chrome-extension, etc.
  if (!url.protocol.startsWith('http')) return;

  // Network-first para Supabase, ViaCEP e APIs externas
  const isApi =
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('viacep.com.br') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com');

  if (isApi) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first para assets do próprio site
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
