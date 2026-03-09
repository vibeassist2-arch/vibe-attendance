const CACHE = "vibe-v202603091600"; // bumped — forces all users to get latest version
const FILES = ["./index.html", "./manifest.json"];

// Install — cache core files, activate immediately
self.addEventListener("install", e => {
  // Always skip waiting — activate new SW immediately on install.
  // The cache version bump above forces a full reload for all users.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES))
  );
});

// Activate — delete ALL old caches, then claim clients
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ) // No clients.claim() — avoids hijacking live page and wiping sessionStorage
  );
});

// Message — handle SKIP_WAITING from the page (triggers update + reload)
self.addEventListener("message", e => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (e.data?.type === "FLUSH_QUEUE") {
    flushPendingQueue();
  }
});

// Fetch — network first for HTML (so updates are always fresh),
//          cache first for everything else
self.addEventListener("fetch", e => {
  // Skip Google Sheets API calls — always go to network
  if (e.request.url.includes("script.google.com")) return;

  const isHTML = e.request.destination === "document" ||
                 e.request.url.endsWith(".html") ||
                 e.request.url.endsWith("/");

  if (isHTML) {
    // Network first for HTML — ensures users always get the latest version
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")) // offline fallback
    );
  } else {
    // Cache first for assets (fonts, icons etc.)
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

// Background sync — flush pending check-ins when back online
self.addEventListener("sync", e => {
  if (e.tag === "vibe-sync") {
    e.waitUntil(flushPendingQueue());
  }
});

async function flushPendingQueue() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: "FLUSH_QUEUE" }));
}
