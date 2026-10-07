const CACHE_PREFIX = "outdoor-learning-day-";
const CACHE_NAME = `${CACHE_PREFIX}v32`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./device-test.html",
  "./src/device-lab.js",
  "./src/device-test-data.js",
  "./src/device-test-store.js",
  "./src/device-test-views.js",
  "./src/device-test-controller.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/controller.js",
  "./src/store.js",
  "./src/page-models.js",
  "./src/formatting.js",
  "./src/views.js",
  "./src/operations.js",
  "./src/feedback.js",
  "./src/camera.js",
  "./src/check-in.js",
  "./src/photo-actions.js",
  "./src/data.js",
  "./src/geo.js",
  "./src/state.js",
  "./src/photos.js",
  "./public/icons/app-icon.svg",
  "./public/icons/app-icon-192.png",
  "./public/icons/app-icon-512.png",
  "./public/images/attractions/future-school.webp",
  "./public/images/attractions/sun-yat-sen.webp",
  "./public/images/attractions/lunjiao-cake.webp",
  "./public/images/attractions/shawan-town.webp",
  "./public/images/attractions/liugeng-hall.webp"
];

const scopeUrl = new URL(self.registration.scope);
const appIndexUrl = new URL("./index.html", scopeUrl).href;
const deviceTestUrl = new URL("./device-test.html", scopeUrl).href;
const staticAssetUrls = new Set(APP_SHELL.map((asset) => new URL(asset, scopeUrl).href));

function isWithinScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
}

self.addEventListener("install", (event) => {
  // A new worker must not populate its new cache with stale HTTP-cache assets.
  const freshShell = APP_SHELL.map((asset) => new Request(new URL(asset, scopeUrl), { cache: "reload" }));
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(freshShell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isWithinScope(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const isAppDocument = staticAssetUrls.has(url.href) && (url.pathname === scopeUrl.pathname || url.href === appIndexUrl || url.href === deviceTestUrl);
          if (isAppDocument && response.ok && response.headers.get("content-type")?.includes("text/html")) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(url.href === deviceTestUrl ? deviceTestUrl : appIndexUrl, copy)));
          }
          return response;
        })
        .catch(() => caches.match(url.href === deviceTestUrl ? deviceTestUrl : appIndexUrl))
    );
    return;
  }

  // Cache only known static files, never arbitrary responses or query-bearing URLs.
  if (!staticAssetUrls.has(url.href)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    })
  );
});
