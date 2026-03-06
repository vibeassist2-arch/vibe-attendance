const CACHE = "vibe-v1";
const FILES = ["./index.html", "./manifest.json"];

// Install — cache core files
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES))
  );
});

// Activate — clear old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache first, fallback to network, fallback to index.html
self.addEventListener("fetch", e => {
  // Skip Google Sheets API calls — always go network
  if (e.request.url.includes("script.google.com")) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request)
        .then(res => {
          // Cache new successful responses
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

// Background sync — flush pending check-ins when back online
self.addEventListener("sync", e => {
  if (e.tag === "vibe-sync") {
    e.waitUntil(flushPendingQueue());
  }
});

async function flushPendingQueue() {
  // Notify all open clients to flush their queue
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: "FLUSH_QUEUE" }));
}
