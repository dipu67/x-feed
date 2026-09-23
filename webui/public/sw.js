// Service worker for x-feed PWA — push notifications, offline feed cache, and
// network-first for auth/filter state. Android Chrome blocks `new Notification()`
// — notifications must go through `self.registration.showNotification()`.

const SHELL_CACHE = "x-feed-shell-v1";
const FEED_CACHE = "x-feed-feed-v1";
const SHELL = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
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
          names
            .filter((n) => n !== SHELL_CACHE && n !== FEED_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Stale-while-revalidate keeps the home page snappy when offline and bounds
  // the feed cache to the most recent 50 responses.
  if (url.pathname === "/feed" || url.pathname.startsWith("/feed?")) {
    e.respondWith(staleWhileRevalidate(e.request, FEED_CACHE, 50));
    return;
  }
  // Network-first for auth state and per-user filters so a freshly-logged-in
  // browser doesn't see stale "anonymous" data when the network is up.
  if (
    url.pathname === "/auth/me" ||
    url.pathname.startsWith("/filters") ||
    url.pathname.startsWith("/mute-keywords")
  ) {
    e.respondWith(networkFirst(e.request, SHELL_CACHE));
    return;
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
  if (url) e.waitUntil(clients.openWindow(url));
});

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        cache.put(request, res.clone());
        const keys = await cache.keys();
        while (keys.length > maxEntries) {
          await cache.delete(keys[0]);
          keys.shift();
        }
      }
      return res;
    })
    .catch(() => cached);
  return cached ?? (await network);
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}
