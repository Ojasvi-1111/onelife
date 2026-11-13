// OneLife service worker.
// Network first, cache as fallback: the app works offline and picks up
// new versions the next time it is opened with a connection.
const CACHE = 'onelife-cache-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/board.css', 'css/sheets.css', 'css/screens.css',
  'js/app.js', 'js/icons.js', 'js/time.js', 'js/db.js', 'js/store.js',
  'js/sessions.js', 'js/dayclose.js', 'js/urgency.js', 'js/layout.js',
  'js/board.js', 'js/form.js', 'js/detail.js', 'js/celebrate.js',
  'js/done.js', 'js/settings.js',
  'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req.url, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  let res = null;
  try { res = await Promise.race([network, timeout]); } catch (err) { res = null; }
  if (res && res.ok) return res;
  const hit = (await cache.match(req.url, { ignoreSearch: true })) ||
    (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
  if (hit) { network.catch(() => {}); return hit; }
  return res || network;
}
