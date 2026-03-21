// fellis.eu — Service Worker
// Strategy:
//   - App shell (HTML, assets): Cache-first with background revalidation (stale-while-revalidate)
//   - API calls (/api/*): Network-only — never serve stale data from the cache
//   - Offline fallback: serve cached index.html for navigation requests when offline

// Bump version string when deploying a breaking change to force cache eviction
const CACHE_NAME = 'fellis-shell-v2'

// Resources to precache on install (the app shell)
const PRECACHE_URLS = [
  '/',
]

// Paths the SW must never cache — sw.js itself must always be fetched fresh
// so the browser can detect updates. Uploads are large and user-specific.
const NEVER_CACHE = ['/sw.js', '/uploads/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  )
  // Activate the new SW immediately without waiting for old tabs to close
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Delete all caches from previous SW versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Never intercept: API calls, the SW file itself, and user uploads
  if (
    url.pathname.startsWith('/api/') ||
    NEVER_CACHE.some(p => url.pathname.startsWith(p))
  ) return

  // Navigation requests (HTML pages): network-first, offline fallback to cached /
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Only cache complete responses — 206 Partial Content is not cacheable
          if (res.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, res.clone()))
          }
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Static assets (JS, CSS, fonts, images): stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request)
      const networkFetch = fetch(request).then(res => {
        // Only cache status 200 — never cache 206 Partial Content (range requests)
        if (res.status === 200) cache.put(request, res.clone())
        return res
      }).catch(() => cached)
      // Return cached immediately if available; network updates it in background
      return cached || networkFetch
    })
  )
})
