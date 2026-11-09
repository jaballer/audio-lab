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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
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
// Anything not kept (there is nothing else on this site) goes to the network.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(request)),
  );
});

// Sent by the page when the person presses Reload on the update notice.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
