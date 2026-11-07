/**
 * Norfold background push worker.
 *
 * Deliberately does two things and nothing else: it shows a content-free
 * notification for a push the server sent, and it opens the right screen when
 * that notification is tapped. It never caches app assets, never proxies
 * fetches and never runs when the site has not been opted in.
 *
 * The payload is content-free by design: ids only, no sender name and no
 * message text, so nothing private is rendered by the operating system.
 */
/* eslint-env serviceworker */
/* global self, clients */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const wakeId = typeof payload.notificationId === "string" ? payload.notificationId : "";
  const request = payload.type === "CHAT_REQUEST";
  event.waitUntil(self.registration.showNotification(
    request ? "Message request" : "New message",
    {
      body: request ? "Open Norfold to view your requests." : "Open Norfold to read it.",
      tag: `norfold-chat-${conversationId || wakeId || "message"}`,
      icon: "/icons/findback-192.png",
      badge: "/icons/findback-192.png",
      // Replacing rather than stacking is what makes a burst readable.
      renotify: false,
      data: { conversationId, wakeId },
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.conversationId
    ? `/chats/${encodeURIComponent(data.conversationId)}`
    : "/chats";
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      client.postMessage({ type: "norfold:chat-notification", ...data });
      if ("focus" in client) { await client.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
