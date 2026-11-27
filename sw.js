/* NATEIVA — Service worker : ouverture instantanée sur téléphone.
   Stratégie « stale-while-revalidate » pour les fichiers de l'application
   (même origine, GET) : la version en mémoire du téléphone s'affiche tout de
   suite, et la version du serveur est téléchargée en arrière-plan pour la
   prochaine ouverture. Si la page a changé, l'application affiche le bandeau
   « Nouvelle version — toucher pour actualiser ».
   Jamais mis en cache : l'API (données), les autres sites (cartes, polices). */
'use strict';
const CACHE = 'nateiva-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function cacheKey(request) {
  // Page : une seule entrée. Fichiers versionnés (?v=…) : la version fait
  // partie de la clé — une nouvelle page ne reçoit jamais un ancien script.
  const url = new URL(request.url);
  if (request.mode === 'navigate') return new Request(url.origin + '/');
  const v = url.searchParams.get('v');
  return new Request(url.origin + url.pathname + (v ? '?v=' + v : ''));
}
async function pruneOldVersions(cache, key) {
  // Supprime les autres versions du même fichier (pas d'accumulation).
  const path = new URL(key.url).pathname;
  const keys = await cache.keys();
  await Promise.all(keys.filter((k) => new URL(k.url).pathname === path && k.url !== key.url).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // cartes, polices, API externe
  if (/^\/(api|napi)\b/.test(url.pathname) || url.pathname === '/sw.js') return;
  const isNav = req.mode === 'navigate';
  if (!isNav && !/\.(js|css|png|jpg|jpeg|svg|webp|ico|json|woff2?)$/.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = cacheKey(req);
    const cached = await cache.match(key);
    const network = fetch(req).then(async (res) => {
      if (res && res.ok && res.type === 'basic') {
        if (isNav && cached) {
          const oldTag = cached.headers.get('etag') || cached.headers.get('last-modified') || '';
          const newTag = res.headers.get('etag') || res.headers.get('last-modified') || '';
          if (oldTag && newTag && oldTag !== newTag) {
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach((c) => c.postMessage({ type: 'nateiva-update' }));
          }
        }
        await cache.put(key, res.clone());
        if (!isNav) await pruneOldVersions(cache, key);
      }
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Hors ligne — reconnectez-vous puis réessayez.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
