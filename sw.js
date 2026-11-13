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
let slowUntil = 0;   // while this is in the future, answer from the cache first

// A redirected response cannot answer a page load, so rebuild it as a plain one.
function tidy(res) {
  if (!res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(url, tidy(res));
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

async function fromCache(cache, req) {
  return (await cache.match(req.url, { ignoreSearch: true })) ||
    (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req.url, { cache: 'no-cache' }).then((raw) => {
    const res = tidy(raw);
    if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  });

  // On a slow connection, answer from the cache at once and refresh in the background.
  if (Date.now() < slowUntil) {
    const quick = await fromCache(cache, req);
    if (quick) { network.catch(() => {}); return quick; }
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000));
  let res = null;
  try { res = await Promise.race([network, timeout]); } catch (err) { res = null; }
  if (res === 'timeout') { slowUntil = Date.now() + 60000; res = null; }
  if (res && res.ok) return res;
  const hit = await fromCache(cache, req);
  if (hit) { network.catch(() => {}); return hit; }
  return res || network;
}
