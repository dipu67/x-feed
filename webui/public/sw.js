// Minimal service worker for showing system notifications on Android Chrome.
// Android blocks `new Notification()` — it requires a service worker to call
// `self.registration.showNotification()` instead.

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
