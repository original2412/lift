/* Lift service worker — offline-first app shell */
const CACHE = 'lift-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/utils.js',
  './js/db.js',
  './js/seed.js',
  './js/store.js',
  './js/ui.js',
  './js/charts.js',
  './js/views/home.js',
  './js/views/routine-edit.js',
  './js/views/workout.js',
  './js/views/history.js',
  './js/views/exercises.js',
  './js/views/stats.js',
  './js/views/settings.js',
  './js/router.js',
  './js/app.js',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell (HTML/JS/CSS/manifest): network-first, so a deploy reaches
  // users on their very next load instead of waiting on a cache-version
  // bump. Falls back to the last cached copy when offline.
  const isShellFile = req.mode === 'navigate' || /\.(js|css|webmanifest)$/.test(url.pathname);
  if (isShellFile) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  // Everything else (exercise photos, icons): cache-first — these don't
  // change once shipped, so prefer speed and offline reliability.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
