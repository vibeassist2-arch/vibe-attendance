const CACHE = "vibe-v202603091700"; // bumped

const FILES = ["./index.html", "./manifest.json"];

// Install — cache files but DO NOT skipWaiting automatically
// Skipping waiting immediately causes controllerchange → page reload → user kicked to login
// Instead, wait until the page explicitly asks (via SKIP_WAITING message or next open)
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES))
  );
  // Do NOT call self.skipWaiting() here — let the page control when to activate
});

// Activate — delete old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
    // No clients.claim() — avoids hijacking live sessions
  );
});

// Message — only skipWaiting when page explicitly asks (user tapped "Update ready" toast)
self.addEventListener("message", e => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (e.data?.type === "FLUSH_QUEUE") {
    flushPendingQueue();
  }
});

// Fetch — network first for HTML, cache first for assets
self.addEventListener("fetch", e => {
  if (e.request.url.includes("script.google.com")) return;

  const isHTML = e.request.destination === "document" ||
                 e.request.url.endsWith(".html") ||
                 e.request.url.endsWith("/");

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => {
        return cached || fetch(e.request)
          .then(res => {
            if (res && res.status === 200 && res.type === "basic") {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() => caches.match("./index.html"));
      })
    );
  }
});

self.addEventListener("sync", e => {
  if (e.tag === "vibe-sync") {
    e.waitUntil(flushPendingQueue());
  }
});

async function flushPendingQueue() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: "FLUSH_QUEUE" }));
}
