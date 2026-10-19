const CACHE_PREFIX = "outdoor-learning-day-";
const CACHE_NAME = `${CACHE_PREFIX}v152`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./device-test.html",
  "./src/device-lab.js",
  "./src/device-rehearsal.js",
  "./src/device-test-data.js",
  "./src/device-test-store.js",
  "./src/device-test-views.js",
  "./src/device-test-controller.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./rehearsal.webmanifest",
  "./src/rehearsal-upload.js",
  "./src/app.js",
  "./src/app-settings.js", "./src/local-font.js",
  "./src/student-identity.js", "./src/student-login-controller.js", "./src/student-login-view.js", "./src/check-in-sync.js",
  "./src/check-in-card.js", "./src/check-in-card-controller.js",
  "./src/vendor/fontkit-1.1.1.js",
  "./src/vendor/fontkit-LICENSE.txt",
  "./src/vendor/noto-sans-hk-regular.js",
  "./src/vendor/NotoSansHK-LICENSE.txt",
  "./src/vendor/pako-1.0.11.js",
  "./src/vendor/pako-LICENSE.txt",
  "./src/vendor/README.txt",

  "./src/controller.js",
  "./src/routes.js",
  "./src/memory-controller.js",
  "./src/photo-export-controller.js",
  "./src/view-components.js",
  "./src/home-views.js",
  "./src/itinerary-views.js",
  "./src/memory-views.js",
  "./src/export-views.js",
  "./src/store.js",
  "./src/page-models.js",
  "./src/formatting.js",
  "./src/views.js",
  "./src/operations.js",
  "./src/feedback.js",
  "./src/camera.js",
  "./src/check-in.js",
  "./src/photo-actions.js",
  "./src/photo-archive.js",
  "./src/data.js",
  "./src/geo.js",
  "./src/state.js",
  "./src/photos.js",
  "./public/icons/app-icon.svg",
  "./public/icons/app-icon-192.png",
  "./public/icons/app-icon-512.png",
  "./public/images/school-logo.jpg",
  "./public/images/attractions/future-school.webp",
  "./public/images/attractions/sun-yat-sen.webp",
  "./public/images/attractions/lunjiao-cake.webp",
  "./public/images/attractions/shawan-town.webp",
  "./public/images/attractions/liugeng-hall.webp",
  "./public/images/introduction/dongguan-map.png",
  "./public/images/introduction/zhongshan-statue.jpg",
  "./public/images/introduction/sun-yat-sen-residence.jpg",
  "./public/images/introduction/liugeng-hall.png",
  "./public/images/introduction/shawan-town.jpg",
  "./public/images/introduction/lunjiao-cake.jpg",
  "./public/images/introduction/future-school-logo.png",
  "./public/images/introduction/future-school-group.jpg",
  "./public/images/introduction/future-school-visit.jpg",
  "./public/images/introduction/future-school-craft.jpg",
  "./public/documents/trip-booklet-2026.pdf"
];

const scopeUrl = new URL(self.registration.scope);
const appIndexUrl = new URL("./index.html", scopeUrl).href;
const deviceTestUrl = new URL("./device-test.html", scopeUrl).href;
const bookletUrl = new URL("./public/documents/trip-booklet-2026.pdf", scopeUrl).href;
const staticAssetUrls = new Set(APP_SHELL.map((asset) => new URL(asset, scopeUrl).href));
// Exact versioned entry URLs bypass old workers; their offline bytes stay under
// canonical whitelist keys. Never cache query-bearing responses.
const versionedAssets = new Map(["src/app.js", "src/device-lab.js", "src/app-settings.js", "styles.css"].map(asset => [
  new URL(`${asset}?v=${CACHE_NAME.slice(CACHE_PREFIX.length)}`, scopeUrl).href, new URL(asset, scopeUrl).href
]));
const fontRetryAssets = new Set(["src/vendor/fontkit-1.1.1.js", "src/vendor/noto-sans-hk-regular.js"]
  .map(asset => new URL(asset, scopeUrl).href));

function isWithinScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
}

self.addEventListener("install", (event) => {
  // A new worker must not populate its new cache with stale HTTP-cache assets.
  const freshShell = APP_SHELL.map((asset) => new Request(new URL(asset, scopeUrl), { cache: "reload" }));
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(freshShell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Retirement only: do not request permission, subscribe or contact the old API.
  event.waitUntil(Promise.resolve().then(async () => {
    try {
      const subscription = await self.registration.pushManager?.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch { /* The retired backend cannot send; keep offline activation available. */ }
  }));
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
  const fontAsset = new URL(url.pathname, url.origin).href;
  const versionedAsset = versionedAssets.get(url.href)
    || (/^\?font-retry=[1-9]\d*$/.test(url.search) && fontRetryAssets.has(fontAsset) ? fontAsset : null);
  if (versionedAsset) {
    event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(versionedAsset))
      .then(cached => cached || fetch(versionedAsset, { cache: "reload" })));
    return;
  }

  // Native PDF viewers navigate too. Serve the approved PDF, never the HTML fallback.
  if (request.mode === "navigate" && url.pathname === new URL(bookletUrl).pathname) {
    if (url.href !== bookletUrl) return; // Query-bearing copies stay outside the cache.
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(bookletUrl)).then((cached) => cached || fetch(request)));
    return;
  }

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
        // Diagnostics uses a query, but must still open the isolated device shell
        // offline. Never cache a query-bearing response or substitute the real App.
        .catch(() => caches.match(url.pathname === new URL(deviceTestUrl).pathname ? deviceTestUrl : appIndexUrl))
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
