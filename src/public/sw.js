// fellis.eu — Service Worker
// Strategy:
//   - App shell (HTML, assets): Cache-first with background revalidation (stale-while-revalidate)
//   - API calls (/api/*): Network-only — never serve stale data from the cache
//   - Offline fallback: serve cached index.html for navigation requests when offline

const CACHE_NAME = 'fellis-shell-v1'

// Resources to precache on install (the app shell)
const PRECACHE_URLS = [
  '/',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  )
  // Activate the new SW immediately without waiting for old tabs to close
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Delete old caches from previous SW versions
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

  // Skip non-GET requests and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // API calls: always go to the network — never use cache
  if (url.pathname.startsWith('/api/')) return

  // Navigation requests (HTML pages): network-first, fall back to cached /
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.status === 200) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Static assets (JS, CSS, fonts, images): stale-while-revalidate
  // Only cache complete responses (status 200) — skip 206 Partial Content (media range requests)
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request)
      const networkFetch = fetch(request).then(res => {
        if (res.status === 200) cache.put(request, res.clone())
        return res
      }).catch(() => cached)
      return cached || networkFetch
    })
  )
})
