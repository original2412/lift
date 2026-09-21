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

// ---- rest-over alert while the app is in the background ----
// The page's own timers stop when it's backgrounded, so the page hands the
// end time to the worker. A pending waitUntil() keeps the worker alive until
// then — Chrome caps that at ~5 minutes per event. Each new schedule/cancel
// bumps restGen so a superseded timer does nothing.
let restGen = 0;

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'skipWaiting') { self.skipWaiting(); return; }
  if (!d || typeof d !== 'object') return;
  if (d.type === 'rest-cancel') { restGen++; return; }
  if (d.type !== 'rest-schedule') return;

  const gen = ++restGen;
  const wait = Math.max(0, d.endsAt - Date.now());
  e.waitUntil(new Promise((resolve) => {
    setTimeout(() => {
      if (gen !== restGen) { resolve(); return; }
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((list) => {
          // an open, visible app plays its own chime
          if (list.some((c) => c.visibilityState === 'visible')) return;
          return self.registration.showNotification('Rest over — next set', {
            body: d.body || '',
            tag: 'rest',
            renotify: true,
            silent: false,
            vibrate: [300, 120, 300, 120, 300],
            icon: 'icons/icon-192.png'
          });
        })
        .then(resolve, resolve);
    }, wait);
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./#/workout');
    })
  );
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
    // 'no-store' bypasses the browser's own HTTP cache too — GitHub Pages
    // sends Cache-Control: max-age=600, which would otherwise make a
    // "network-first" fetch silently return a stale same-tab response.
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
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
