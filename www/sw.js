// TankFiles offline helper (the iPhone home-screen app, and the website on any phone).
// Everything the game loads is kept in a cache. The game starts straight from the cache (fast, works with no internet)
// while a fresh copy is fetched in the background - so a new version shows up the NEXT time the game opens.
const CACHE = 'tankfiles-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css', 'lib/peerjs.min.js',
  'js/store.js', 'js/sfx.js', 'js/levels.js', 'js/custom.js', 'js/game.js', 'js/net.js', 'js/editor.js', 'js/versus.js', 'js/ui.js',
  'img/icon-192.png', 'img/icon-512.png', 'img/title-tank.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;       // PeerJS, api.ipify etc. go to the internet as normal
  if (req.headers.has('range')) return;                                    // music streaming: let the browser handle it
  e.respondWith(caches.open(CACHE).then(async c => {
    const key = url.pathname.endsWith('/') ? req.url.split('?')[0] : req;     // ?iphone=1 etc. still opens the cached page
    const hit = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then(r => { if (r && r.ok && r.status === 200) c.put(key, r.clone()).catch(() => {}); return r; }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || new Response('Offline', { status: 503 });
  }));
});
