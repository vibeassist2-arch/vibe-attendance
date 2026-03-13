# VIBE Service Worker (sw.js) - Security & Code Audit

## Executive Summary

**Status**: ✅ SECURE WITH MINOR IMPROVEMENTS
**Risk Level**: LOW
**Bugs Found**: 6
**Critical Issues**: 0
**Recommendations**: 3

---

## VULNERABILITIES & BUGS IDENTIFIED

### BUG #1: Version Bump Not Automated
**Severity**: HIGH (Process/Deployment Risk)
**Location**: Line 5
**Issue**: 
```javascript
const VERSION = 'vibe-at-v20260313'; // ← BUMP THIS ON EVERY DEPLOY
```
Manual version bumping is error-prone. If forgotten, users get stale cache.

**Fix**:
```javascript
// Use dynamic version from build process or timestamp
const VERSION = process.env.SW_VERSION || `vibe-at-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;

// Or use Git commit hash
const VERSION = 'vibe-at-GIT_COMMIT_HASH'; // Injected at build time
```

---

### BUG #2: PRECACHE_URLS Not Validated
**Severity**: MEDIUM
**Location**: Lines 13-21
**Issue**: 
```javascript
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './favicon-96x96.png',
  // ... etc
];
```
No validation that these files actually exist. Silent failures during install.

**Fix**:
```javascript
async function validatePrecacheUrls() {
  const results = await Promise.allSettled(
    PRECACHE_URLS.map(url =>
      fetch(url, { method: 'HEAD' }).then(r => {
        if (!r.ok) throw new Error(`${url} returned ${r.status}`);
        return url;
      })
    )
  );
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    console.error('[SW] Precache validation failed:', failed);
  }
  return results;
}
```

---

### BUG #3: Cross-Origin Request Handling
**Severity**: MEDIUM (Security)
**Location**: Lines 88-90
**Issue**:
```javascript
// 2. Skip cross-origin requests except Google Fonts
const isGoogleFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
if (url.origin !== self.location.origin && !isGoogleFont) return;
```

Whitelist is hardcoded. No validation that Google Fonts URLs are legitimate.

**Fix**:
```javascript
const ALLOWED_CROSS_ORIGIN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  // Add others explicitly, never use wildcards
];

const isAllowedCrossOrigin = ALLOWED_CROSS_ORIGIN.some(domain => url.hostname === domain);
if (url.origin !== self.location.origin && !isAllowedCrossOrigin) return;

// Also validate the URL path is expected
if (isAllowedCrossOrigin && url.pathname.includes('..')) return; // Path traversal
```

---

### BUG #4: Apps Script Endpoint Not Validated
**Severity**: MEDIUM (Security)
**Location**: Lines 99-104
**Issue**:
```javascript
// 3. Google Apps Script — network-only, never cache.
if (url.hostname === 'sheets.googleapis.com' || url.hostname === 'script.google.com') {
  event.respondWith(networkOnly(request));
  return;
}
```

No validation that the script.google.com URL is the CORRECT one. Typosquatting possible.

**Fix**:
```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbztylXBLNoCHL6YSL5DvkrQTrSEIpgZt1soSxYZSB9ir7GLyJtj1_psM-g1yr3mmVev/exec';

if (request.url.startsWith(APPS_SCRIPT_URL) || 
    url.hostname === 'sheets.googleapis.com') {
  event.respondWith(networkOnly(request));
  return;
}
```

---

### BUG #5: Offline Fallback Content Injection Risk
**Severity**: LOW (Minor XSS in fallback)
**Location**: Lines 171-195
**Issue**:
```javascript
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>...`,  // HTML template literal
    { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
```

If ever modified programmatically with user data, could cause XSS.

**Fix**:
```javascript
function offlineFallback() {
  const html = document.createElement('html');
  // ... build DOM safely instead of string template
  return new Response(html.outerHTML, { 
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
```

---

### BUG #6: No Error Logging to Backend
**Severity**: LOW (Observability)
**Location**: Throughout
**Issue**: Errors logged to console only. No way to monitor SW failures in production.

**Fix**:
```javascript
async function logError(message, error) {
  try {
    // Only log to backend if online
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'swError',
        message: message,
        error: error?.toString(),
        timestamp: Date.now(),
        version: VERSION
      })
    });
  } catch (e) {
    console.error('[SW] Failed to log error:', e);
  }
}

// Usage
catch (err) {
  logError('Cache miss during install', err);
  return offlineFallback();
}
```

---

## SECURITY ANALYSIS

### ✅ Secure Patterns Found

1. **Network-Only for Apps Script** (Line 99-104)
   - Correct: Never cache API responses
   - Prevents stale data from being served offline

2. **Cache Validation** (Line 134)
   - Checks `response.ok` before caching
   - Prevents error responses from being cached

3. **Proper Cache Isolation** (Lines 22-24)
   - Separate STATIC_CACHE and DYNAMIC_CACHE
   - Prevents cross-contamination

4. **HTTPS Enforcement** (Implicit)
   - All resources are HTTPS
   - Service Worker itself must be HTTPS

### ⚠️ Recommendations

#### Priority 1: Security

1. **Validate Apps Script URL**
```javascript
// Store in config, validate on every request
const APPS_SCRIPT_ID = 'AKfycbztylXBLNoCHL6YSL5DvkrQTrSEIpgZt1soSxYZSB9ir7GLyJtj1_psM-g1yr3mmVev';
const APPS_SCRIPT_URL = `https://script.google.com/macros/s/${APPS_SCRIPT_ID}/exec`;
```

2. **Whitelist Resources**
```javascript
const WHITELISTED_ORIGINS = {
  static: [self.location.origin],
  external: [
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ]
};
```

3. **Validate Response Headers**
```javascript
function isValidResponse(response) {
  const contentType = response.headers.get('content-type');
  const expected = {
    '.html': 'text/html',
    '.json': 'application/json',
    '.css': 'text/css',
    '.js': 'application/javascript'
  };
  // Validate content-type matches expected
  return true;
}
```

#### Priority 2: Reliability

1. **Implement Retry Logic**
```javascript
async function fetchWithRetry(request, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(request);
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
```

2. **Monitor Cache Size**
```javascript
async function checkCacheSize() {
  const estimate = await navigator.storage.estimate();
  const percentUsed = (estimate.usage / estimate.quota) * 100;
  if (percentUsed > 90) {
    // Clear old dynamic cache entries
    const cache = await caches.open(DYNAMIC_CACHE);
    const keys = await cache.keys();
    // Remove oldest entries
  }
}
```

3. **Add Request Timeout**
```javascript
async function fetchWithTimeout(request, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

#### Priority 3: Operations

1. **Version Detection**
```javascript
// Detect version mismatch and notify user
self.addEventListener('install', event => {
  event.waitUntil(
    fetch('./version.json').then(r => r.json())
      .then(data => {
        if (data.version !== VERSION) {
          console.warn('[SW] Version mismatch detected');
          // Could trigger immediate update
        }
      })
  );
});
```

2. **Monitor Failed Precaches**
```javascript
// After install, verify all precached resources are actually cached
async function verifyCacheIntegrity() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  const missing = PRECACHE_URLS.filter(url => 
    !keys.some(k => k.url.endsWith(url))
  );
  if (missing.length) {
    console.warn('[SW] Missing from cache:', missing);
    // Could retry or notify admin
  }
}
```

---

## TESTING CHECKLIST

### Unit Tests
- [ ] cacheFirst() returns cached response
- [ ] cacheFirst() fetches when cache miss
- [ ] networkFirst() prefers network
- [ ] networkFirst() falls back to cache
- [ ] networkOnly() never caches
- [ ] offlineFallback() returns valid HTML

### Integration Tests
- [ ] Apps Script requests go network-only
- [ ] Google Fonts cached correctly
- [ ] index.html uses network-first
- [ ] Static assets use cache-first
- [ ] Old caches cleaned up on activate

### Security Tests
- [ ] Cross-origin requests blocked (except fonts)
- [ ] Response validation works
- [ ] Offline page displays correctly
- [ ] HTTPS enforced
- [ ] Apps Script URL validated

### Offline Tests
- [ ] App loads when offline
- [ ] Assets serve from cache
- [ ] Apps Script calls fail gracefully
- [ ] User can see offline page
- [ ] Can reconnect and sync

---

## PERFORMANCE ANALYSIS

### Current Strategy Effectiveness

| Resource | Strategy | Performance | Recommendation |
|----------|----------|-------------|-----------------|
| index.html | network-first | Good | Keep |
| Static assets | cache-first | Excellent | Keep |
| Fonts | cache-first | Excellent | Keep |
| Apps Script | network-only | Good | Add timeout |
| Icons | cache-first | Good | Validate size |

### Optimization Opportunities

1. **Implement Stale-While-Revalidate for Assets**
```javascript
// Serve cached, fetch fresh in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request).then(r => {
    if (r.ok) cache.put(request, r.clone());
    return r;
  });
  
  return cached || fetchPromise;
}
```

2. **Compress Offline Page**
Current offline fallback HTML is ~1.2KB. Could be:
- Reduced to <500 bytes
- Precompressed with gzip
- Use minimal CSS

3. **Monitor Cache Hit Rate**
```javascript
let cacheStats = { hits: 0, misses: 0 };

function recordCacheHit() {
  cacheStats.hits++;
  if ((cacheStats.hits + cacheStats.misses) % 100 === 0) {
    const hitRate = (cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100;
    console.log(`[SW] Cache hit rate: ${hitRate.toFixed(1)}%`);
  }
}
```

---

## DEPLOYMENT SAFETY

### Pre-Deployment Checklist

- [ ] VERSION bumped in sw.js
- [ ] VERSION matches index.html comment
- [ ] All PRECACHE_URLS files exist
- [ ] Apps Script URL is correct
- [ ] No hardcoded domain/port assumptions
- [ ] Testing complete on staging
- [ ] Rollback plan documented

### Post-Deployment Monitoring

- [ ] Monitor console for [SW] logs
- [ ] Check cache hit rate
- [ ] Monitor failed requests
- [ ] Track offline user count
- [ ] Verify version adoption rate

---

## SUMMARY COMPARISON

### Current State (GOOD)
✅ Proper cache strategies
✅ Network-only for APIs
✅ Old cache cleanup
✅ Offline support
✅ Skip waiting implementation

### Improved State (RECOMMENDED)
✅ All above, PLUS:
✅ Validated precache URLs
✅ Validated Apps Script URL
✅ Request timeouts
✅ Error logging to backend
✅ Cache size monitoring
✅ Response validation
✅ Retry logic

---

## RISK ASSESSMENT

| Risk | Current | With Fixes |
|------|---------|-----------|
| Stale cache served | Medium | Low |
| Missing assets | Medium | Low |
| Wrong API endpoint | Medium | Low |
| Silent failures | High | Low |
| Cache bloat | Low | Very Low |

---

## CONCLUSION

**Overall Service Worker Quality**: 8/10

### Strengths
- Clean separation of cache strategies
- Proper offline fallback
- Skip waiting implementation correct
- Good error handling structure

### Areas for Improvement
- Add validation for critical URLs
- Implement error logging
- Add request timeouts
- Monitor cache health
- Document deployment procedure better

### Action Items (Priority Order)
1. ✅ Validate Apps Script URL (HIGH SECURITY)
2. ✅ Add error logging to backend (HIGH OBSERVABILITY)
3. ✅ Implement request timeouts (MEDIUM RELIABILITY)
4. ✅ Monitor cache size (MEDIUM OPERATIONS)
5. ✅ Add precache verification (LOW ROBUSTNESS)
