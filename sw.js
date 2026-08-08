// FT2 mobile service worker. Scope = wherever it's served from — /m/ when the
// machine serves the app, or the site root (or a project subpath) on a static
// host in the standalone build. Everything below is scope-relative, so the same
// file works in both.
//
// Strategy: the app SHELL (html/js/icons/manifest) is cached so the PWA opens
// instantly, survives a flaky link, and — this is the point of the standalone
// build — opens at all when the MACHINE is off. Live DATA (/status, /ws, the
// camera stream, control POSTs) is NEVER cached: it's cross-origin in the
// standalone build and must always hit the network anyway, so telemetry is real.
// Bump SHELL_VERSION on every mobile build that changes shell assets.
const SHELL_VERSION = 'ft2m-shell-v3';   // v3: no-cache revalidation (2026-08-08)
const SHELL = [
  './',
  './index.html',
  './bundle.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only ever touch our own shell — i.e. GETs inside this worker's scope
  // (/m/ on the machine, the site root on a static host). Everything else —
  // API calls (/status, /auth, control POSTs), the /ws socket, the camera
  // stream, all of which are a different origin in the standalone build — goes
  // straight to the network, uncached. Non-GET is never cached either.
  const isShell = req.method === 'GET' && url.href.startsWith(self.registration.scope);
  if (!isShell) return; // default browser handling (network)
  // version.json is the update probe (standalone build) — always live, never
  // cached, or the app could never notice that a new build was published.
  if (url.pathname.endsWith('/version.json')) return;

  // Network-first for the shell so a fresh build is picked up when online, with
  // the cache as the offline fallback.
  //
  // `cache: 'no-cache'` is load-bearing: a plain fetch() is allowed to come from
  // the BROWSER's HTTP cache, and GitHub Pages serves these assets with a
  // ten-minute max-age. So "network-first" was quietly returning the previous
  // build for up to ten minutes after a publish — the operator updated the app,
  // saw no change, and the new buttons appeared by themselves several minutes
  // later (2026-08-08). no-cache still sends a CONDITIONAL request, so an
  // unchanged shell costs a 304 and no re-download; it just can't be answered
  // from a stale cache entry. (bundle.js has no content hash in its name, so
  // there is nothing else forcing revalidation.)
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(SHELL_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
  );
});
