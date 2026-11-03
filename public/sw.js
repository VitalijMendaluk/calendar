self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || "Нагадування про консультацію";
  const options = {
    body: payload.body || "За 30 хвилин починається консультація.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "consultation-reminder",
    renotify: true,
    data: { url: payload.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
