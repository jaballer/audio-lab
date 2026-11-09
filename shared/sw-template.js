// The service worker, as a template: `vite.config.js` fills in the two lines below (the files to keep and a fingerprint
// of the build) and emits the result as `sw.js`. It is not imported by any page, and it runs in the worker, not the page.
//
// Everything the build makes is kept on install, so every page works offline. A new build installs next to the running
// one and waits: the page tells the person (see register-sw.js) and only switches when they press Reload, because a
// reload in the middle of playing would lose their place.

const PRECACHE = [];
const VERSION = "dev";

const CACHE_PREFIX = "audio-lab-";
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener("install", (event) => {
  // `cache: "reload"` so the files come from the server, not the browser's HTTP cache: GitHub Pages lets that cache keep
  // a page for ten minutes, and a stale index.html stored under the new version would name scripts that no longer exist.
  const requests = PRECACHE.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs come from the cache first. The query string is ignored so `keyboard.html?x` still finds the page.
// `Vary` is ignored too: the page's module scripts and stylesheets are requested in CORS mode, so they carry an Origin
// header the cached copies were not fetched with, and a host that answers `Vary: Origin` (Vite's preview server does)
// would make every one of them miss and fail offline. Everything kept is one same-origin static file, so there is only
// ever one version to match.
// Anything not kept (there is nothing else on this site) goes to the network.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, { ignoreSearch: true, ignoreVary: true }))
      .then((hit) => hit || fetch(request)),
  );
});

// Sent by the page when the person presses Reload on the update notice.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
