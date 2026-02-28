const CACHE_NAME = 'fellis-v1'
const STATIC_ASSETS = [
  '/',
  '/assets/app.js',
  '/assets/index.css'
]

// Cache statiske assets ved installation
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// Ryd gamle caches ved aktivering
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// Network-first for API, cache-first for statiske filer
self.addEventListener('fetch', event => {
  const { request } = event

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // API-kald: netværk først, fallback til cache
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Uploads/media: netværk først, cache for offline
  if (request.url.includes('/uploads/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          return response
        })
        return cached || fetchPromise
      })
    )
    return
  }

  // Statiske assets: cache først, netværk som fallback
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request))
  )
})
