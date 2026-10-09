const CACHE_PREFIX = "outdoor-learning-day-";
const CACHE_NAME = `${CACHE_PREFIX}v62`;
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
  "./src/push-client.js",
  "./src/push-config.js",
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
  "./src/card-reflection.js",
  "./src/data.js",
  "./src/geo.js",
  "./src/state.js",
  "./src/photos.js",
  "./public/icons/app-icon.svg",
  "./public/icons/app-icon-192.png",
  "./public/icons/app-icon-512.png",
  "./public/images/attractions/departure-school.jpg",
  "./public/images/attractions/future-school.webp",
  "./public/images/attractions/sun-yat-sen.webp",
  "./public/images/attractions/lunjiao-cake.webp",
  "./public/images/attractions/shawan-town.webp",
  "./public/images/attractions/liugeng-hall.webp",
  "./public/documents/trip-booklet-2026.pdf"
];

const scopeUrl = new URL(self.registration.scope);
const appIndexUrl = new URL("./index.html", scopeUrl).href;
const deviceTestUrl = new URL("./device-test.html", scopeUrl).href;
const bookletUrl = new URL("./public/documents/trip-booklet-2026.pdf", scopeUrl).href;
const staticAssetUrls = new Set(APP_SHELL.map((asset) => new URL(asset, scopeUrl).href));

function isWithinScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
}

const notificationRoutes = new Set(["home", "itinerary", "attractions", "attraction/future-school", "attraction/sun-yat-sen", "attraction/lunjiao-cake", "attraction/shawan-town", "attraction/liugeng-hall"]);
const fallbackNotification = { id: "new-message", title: "戶外學習日", body: "收到新訊息，請開啟 App 查看。", route: "home" };
function safeNotificationText(value, limit) {
  return typeof value === "string" && Array.from(value).length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function notificationPayload(data) {
  try {
    const text = data?.text();
    if (typeof text !== "string" || text.length > 4096 || new TextEncoder().encode(text).byteLength > 4096) return fallbackNotification;
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)
      || !safeNotificationText(value.title, 80) || !value.title.trim().length
      || !safeNotificationText(value.body, 600) || !notificationRoutes.has(value.route)) return fallbackNotification;
    const proof = typeof value.registrationProof === "string" && /^1\.[1-9]\d{0,15}\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.[a-f0-9]{64}\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(value.registrationProof)
      && /^[a-f0-9]{64}$/.test(value.registrationOwner || "") && /^[a-f0-9]{64}$/.test(value.id)
      ? { proof: value.registrationProof, ownerHash: value.registrationOwner } : null;
    return { id: value.id, title: value.title, body: value.body, route: value.route, proof };
  } catch { return fallbackNotification; }
}
self.addEventListener("push", (event) => {
  const payload = notificationPayload(event.data);
  event.waitUntil((async () => {
  await self.registration.showNotification(payload.title, {
    body: payload.body, tag: `outdoor-learning-day-${payload.id}`, renotify: false,
    icon: new URL("./public/icons/app-icon-192.png", scopeUrl).href,
    data: { route: payload.route }
  });
  if (payload.proof) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      let url; try { url = new URL(client.url); } catch { continue; }
      if (!isWithinScope(url) || ![scopeUrl.pathname, new URL("./index.html", scopeUrl).pathname].includes(url.pathname)) continue;
      try { client.postMessage({ type: "push-registration-proof", id: payload.id, ...payload.proof }); } catch { /* Closing windows cannot leak or confirm a receipt. */ }
    }
  }
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = notificationRoutes.has(event.notification.data?.route) ? event.notification.data.route : "home";
  const destination = new URL("./", scopeUrl);
  destination.hash = route;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      let url;
      try { url = new URL(client.url); } catch { continue; }
      // Reuse this App's document, never another same-origin project or device lab.
      if (!isWithinScope(url) || ![scopeUrl.pathname, new URL("./index.html", scopeUrl).pathname].includes(url.pathname)) continue;
      try {
        const navigated = url.href === destination.href ? client : await client.navigate(destination.href);
        if (navigated) { await navigated.focus(); return; }
      } catch { /* A disappearing tab must not prevent opening the App. */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});

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
