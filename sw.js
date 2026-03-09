const CACHE = "vibe-v20260310.1";
const FILES = [
  "./index.html",
  "./manifest.json"
];
// INSTALL: Pre-cache the App Shell
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES))
      .catch(err => console.error("Pre-cache failed:", err))
  );
});
// ACTIVATE: Cleanup old versions and take control
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});
// FETCH
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Bypass caching for the Google Sheets API
  if (url.hostname.includes("script.google.com")) return;
  const isHTML =
    event.request.destination === "document" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("/");
  if (isHTML) {
    // NETWORK-FIRST (with Cache Fallback)
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(res => res || caches.match("./index.html"))
        )
    );
  } else {
    // CACHE-FIRST (with Network Fallback)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            if (response && response.ok &&
               (response.type === "basic" || response.type === "cors")) {
              const clone = response.clone();
              caches.open(CACHE).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match(event.request));
      })
    );
  }
});
// MESSAGE: SKIP_WAITING (on-demand update) + FLUSH_QUEUE (notify clients)
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "FLUSH_QUEUE") event.waitUntil(notifyClientsToFlush());
});
// BACKGROUND SYNC: Triggered by browser when connectivity returns
self.addEventListener("sync", event => {
  if (event.tag === "vibe-sync") {
    event.waitUntil(notifyClientsToFlush());
  }
});
// Notify all clients to flush their pending queue
async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: "FLUSH_QUEUE" }));
}
