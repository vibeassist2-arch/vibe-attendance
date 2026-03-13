// ── VIBE Attendance Tracker — Service Worker ──────────────────────────────────
// ⚠️  DEPLOY CHECKLIST — must do ALL three steps on every deploy:
//   1. Bump VERSION below (e.g. v2 → v3, or use date: vYYYYMMDD)
//   2. Upload this sw.js to the server
//   3. Upload the updated index.html
// Forgetting to bump VERSION means users keep getting the old cached app shell.
const VERSION = 'vibe-at-v20260313'; // ← BUMP THIS ON EVERY DEPLOY

const STATIC_CACHE  = `${VERSION}-static`;
const DYNAMIC_CACHE = `${VERSION}-dynamic`;
// Note: queue is managed entirely in index.html localStorage — SW only signals clients to flush

// Files to pre-cache on install (shell + critical assets only)
// NOTE: screenshots are intentionally excluded — they are large files only used
// in the PWA install prompt splash screen and are not needed for app functionality.
// They will be fetched and cached on-demand by the cacheFirst handler if ever needed.
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './favicon-96x96.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  // Do NOT call skipWaiting() here.
  // index.html sends SKIP_WAITING only when the user taps the update toast.
  // Calling skipWaiting() at install time would force the new SW to take over
  // mid-session, triggering a controllerchange → page reload on active users.
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      // Use Promise.allSettled directly on cache.add() — don't attach
      // inner .catch() that swallows errors before allSettled can see them.
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).then(
            () => ({ url, status: 'cached' }),
            err => { console.warn(`[SW] Pre-cache miss: ${url}`, err); return { url, status: 'skipped' }; }
          )
        )
      );
    }).then(results => {
      const skipped = results.filter(r => r.value?.status === 'skipped').map(r => r.value?.url);
      if (skipped.length) console.warn(`[SW] ${VERSION} installed — ${skipped.length} asset(s) not cached:`, skipped);
      else console.log(`[SW] ${VERSION} installed — all assets cached`);
      // Do NOT skipWaiting() — wait for user to tap the update toast
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

  // 3. Google Apps Script — network-only, never cache.
  // Apps Script responses must never be cached — stale responses
  // (including error payloads) served offline would corrupt sync logic.
  if (url.hostname === 'sheets.googleapis.com' || url.hostname === 'script.google.com') {
    event.respondWith(networkOnly(request));
    return;
  }

  // 4. Google Fonts — cache-first (they never change for the same URL)
  if (isGoogleFont) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5. App shell (index.html) — network-first so updates land immediately,
  //    fall back to cache when offline.
  // FIX Bug 6: Removed url.pathname.endsWith('/') — it matches ANY sub-path
  // ending in '/' (e.g. /admin/) which is overly broad. Only match exact root.
  if (url.pathname.endsWith('index.html') || url.pathname === '/') {
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
    // Cross-origin (opaque) responses have status 0 and ok=false,
    // but are still valid and cacheable. Accept status 0 for fonts/cross-origin assets.
    if (response.ok || response.status === 0) cache.put(request, response.clone());
    return response;
  } catch {
    // BUG FIX: Only return the HTML offline fallback page for navigation requests.
    // For sub-resources (fonts, icons, images, scripts) returning an HTML page
    // would cause the browser to receive the wrong content-type, log CORS errors,
    // and potentially break rendering. For non-navigation assets, return a
    // minimal typed error response so the browser handles the failure gracefully.
    if (request.destination === 'document') {
      return offlineFallback();
    }
    // For fonts: browser falls back to system font automatically — no response needed
    // For images/icons: browser shows broken image — acceptable offline behaviour
    // Return a 503 with no body so the browser knows the request failed cleanly
    return new Response('', {
      status: 503,
      statusText: 'Service Unavailable — offline'
    });
  }
}

/** Network-only: no caching at all — used for Apps Script API calls */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    // Return a JSON error so callers get a parseable failure, not an HTML offline page
    return new Response(JSON.stringify({ ok: false, error: 'offline' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    });
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
  // FIX Bug 5: Explicit status + statusText so consumers can distinguish this
  // synthetic response from a real server response
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline — Attendance Tracker</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sora',sans-serif,system-ui;background:#f8fafc;color:#1e293b;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center}
  .wrap{max-width:360px}
  .icon{font-size:4rem;margin-bottom:1.2rem}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:.6rem}
  p{color:#64748b;font-size:.95rem;line-height:1.6;margin-bottom:1.8rem}
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
    { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
// Fired by the browser when connectivity is restored (if Background Sync API is supported)
self.addEventListener('sync', event => {
  if (event.tag === 'vibe-sync') {
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
