// ── VIBE Attendance Tracker — Service Worker ──────────────────────────────────
// Version: bump this string to force cache refresh on deploy
const VERSION = 'vibe-at-v1';

const STATIC_CACHE  = `${VERSION}-static`;
const DYNAMIC_CACHE = `${VERSION}-dynamic`;
const QUEUE_KEY     = 'vibe-sync-queue';

// Files to pre-cache on install (shell + assets)
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './favicon-96x96.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './screenshot-mobile.png',
  './screenshot-desktop.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn(`[SW] Pre-cache miss: ${url}`, err))
        )
      );
    }).then(() => {
      console.log(`[SW] ${VERSION} installed`);
      return self.skipWaiting(); // activate immediately on first install
    })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => { console.log(`[SW] Deleting old cache: ${k}`); return caches.delete(k); })
      )
    ).then(() => {
      console.log(`[SW] ${VERSION} activated`);
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET requests (POST to Google Sheets etc.) — let them go straight to network
  if (request.method !== 'GET') return;

  // 2. Skip cross-origin requests except Google Fonts
  const isGoogleFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isGoogleFont) return;

  // 3. Google Sheets API — network-first, no cache (always need fresh data)
  if (url.hostname === 'sheets.googleapis.com' || url.hostname === 'script.google.com') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 4. Google Fonts — cache-first (they never change for the same URL)
  if (isGoogleFont) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5. App shell (index.html) — network-first so updates land immediately,
  //    fall back to cache when offline
  if (url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 6. Static assets (icons, screenshots, manifest) — cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

/** Cache-first: serve from cache; fetch & store if missing */
async function cacheFirst(request, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return offlineFallback();
  }
}

/** Network-first: fetch live; fall back to cache when offline */
async function networkFirst(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request)
                || await caches.match(request);  // also check static cache
    return cached || offlineFallback();
  }
}

/** Minimal offline page returned when nothing is cached */
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline — Attendance Tracker</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sora',sans-serif,system-ui;background:#0b0f1a;color:#e8eaf6;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center}
  .wrap{max-width:360px}
  .icon{font-size:4rem;margin-bottom:1.2rem}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:.6rem}
  p{color:#7a8bad;font-size:.95rem;line-height:1.6;margin-bottom:1.8rem}
  button{padding:.8rem 2rem;background:#4f8ef7;color:#fff;border:none;border-radius:10px;
         font-size:.95rem;font-weight:600;cursor:pointer;font-family:inherit}
  button:active{opacity:.8}
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">📡</div>
    <h1>You're offline</h1>
    <p>Attendance Tracker needs a connection to sync data.<br>
       Check your network and try again.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
// Fired by the browser when connectivity is restored (if Background Sync API is supported)
self.addEventListener('sync', event => {
  if (event.tag === 'vibe-flush') {
    event.waitUntil(notifyClientsToFlush());
  }
});

async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'FLUSH_QUEUE' }));
}

// ── MESSAGE HANDLER ───────────────────────────────────────────────────────────
// Handles SKIP_WAITING message sent by the update toast in index.html
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — activating new SW');
    self.skipWaiting();
  }
});
