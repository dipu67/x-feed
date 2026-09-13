// Service worker for x-feed PWA — Android notifications + offline shell.
// Android Chrome blocks `new Notification()` — it requires a service worker to
// call `self.registration.showNotification()` instead.

const CACHE_NAME = "x-feed-v1";
const SHELL = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  // Network-first for navigations/API, cache-first for static assets.
  if (e.request.mode === "navigate" || e.request.url.includes("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request)),
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request)),
    );
  }
});

self.addEventListener("push", (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? "New tweet", {
      body: data.body ?? "",
      icon: data.icon,
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url;
  if (url) {
    e.waitUntil(clients.openWindow(url));
  }
});
