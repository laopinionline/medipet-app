/* MEDIPaw — PWA del titular. Service worker: cachea el shell para arranque offline.
   CACHE VERSIONADO POR DEPLOY: al subir una versión nueva, BUMPEAR el número → install
   cachea el shell nuevo, skipWaiting activa ya, activate purga las caches viejas y
   clients.claim toma control (la página recarga por 'controllerchange'). Sin esto el
   deploy sirve la versión vieja por horas (lección MEDICAR).
   Firebase/gstatic/fonts (cross-origin) NO se cachean: van directo a la red. */
const CACHE = 'medipaw-socio-v6'; // ⬅️ BUMPEAR EN CADA DEPLOY del /socio/
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: solo GET same-origin. HTML (navegación) → NETWORK-FIRST (una carga fresca trae la
// última versión; offline → cache). Resto del shell → cache-first. Cross-origin → red directa.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase/gstatic/fonts → red directa
  const esHTML = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (esHTML) {
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{}); return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{}); return res; }))
  );
});
