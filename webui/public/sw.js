// Service worker for x-feed PWA — push notifications only. No fetch caching:
// the feed must always show the latest tweets, and caching caused stale
// lists to render before the fresh response arrived.

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  // Drop caches left behind by earlier versions of this worker.
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
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
  if (url) e.waitUntil(clients.openWindow(url));
});
