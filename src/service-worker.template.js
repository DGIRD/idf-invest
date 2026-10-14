// Service worker Immo-Zen – généré au build.
// Stratégie : seuls les fichiers statiques de l'application sont mis en cache.
// Les appels à Supabase (données privées) ne sont JAMAIS mis en cache par le service worker.
const CACHE = 'immo-zen-__CACHE_VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API Supabase, CDN… : pas de cache
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'purge-private-cache') {
    // Rien de privé n'est stocké ici ; message conservé pour la symétrie avec la déconnexion.
    event.ports?.[0]?.postMessage('ok');
  }
});
