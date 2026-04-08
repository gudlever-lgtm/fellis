// Resilient upload queue: persists pending post uploads to IndexedDB
// and retries them when the browser regains connectivity.
//
// Items survive page reloads, so an upload started on a flaky mobile
// connection can finish later — e.g. when the user reaches WiFi.
//
// Public events dispatched on window:
//   'fellis:upload-queue:update'    — fired after any queue mutation (detail: { count })
//   'fellis:upload-queue:success'   — fired when a queued item uploaded (detail: { id, post })
//   'fellis:upload-queue:fail'      — fired when a queued item permanently failed (detail: { id, error })

const DB_NAME = 'fellis_uploads'
const DB_VERSION = 1
const STORE = 'queued_posts'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE))
}

function emit(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  } catch {
    // ignore
  }
}

async function notifyUpdate() {
  try {
    const count = await queueSize()
    emit('fellis:upload-queue:update', { count })
  } catch {
    // ignore
  }
}

// Serialise a File so it can be stored in IndexedDB (File/Blob are structured-clonable)
function serialiseFile(f) {
  return { name: f.name, type: f.type, size: f.size, blob: f }
}

// Rehydrate a stored entry back into a File-like object
function deserialiseFile(s) {
  if (!s?.blob) return null
  // Use File constructor where available, otherwise Blob
  try {
    return new File([s.blob], s.name || 'file', { type: s.type || s.blob.type })
  } catch {
    return s.blob
  }
}

export async function enqueuePost(payload) {
  const store = await tx('readwrite')
  const entry = {
    createdAt: Date.now(),
    attempts: 0,
    payload: {
      text: payload.text || '',
      schedAt: payload.schedAt || null,
      categories: payload.categories || null,
      location: payload.location || null,
      taggedUsers: payload.taggedUsers || null,
      linkedContent: payload.linkedContent || null,
      files: (payload.files || []).map(serialiseFile),
    },
  }
  const id = await new Promise((resolve, reject) => {
    const req = store.add(entry)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  notifyUpdate()
  return id
}

export async function queueSize() {
  try {
    const store = await tx('readonly')
    return await new Promise((resolve, reject) => {
      const req = store.count()
      req.onsuccess = () => resolve(req.result || 0)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return 0
  }
}

async function listAll() {
  const store = await tx('readonly')
  return await new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

async function remove(id) {
  const store = await tx('readwrite')
  return await new Promise((resolve, reject) => {
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function update(entry) {
  const store = await tx('readwrite')
  return await new Promise((resolve, reject) => {
    const req = store.put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// Permanent failure: entries older than 7 days with too many attempts
const MAX_ATTEMPTS = 50
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let processing = false

/**
 * Attempts to upload every queued post. Safe to call multiple times;
 * only one run proceeds at a time. Callers can pass an uploader function
 * to avoid a circular import with api.js.
 */
export async function processQueue(uploader) {
  if (processing) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (typeof uploader !== 'function') return
  processing = true
  try {
    const entries = await listAll().catch(() => [])
    for (const entry of entries) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break
      const age = Date.now() - (entry.createdAt || 0)
      if (entry.attempts >= MAX_ATTEMPTS || age > MAX_AGE_MS) {
        await remove(entry.id).catch(() => {})
        emit('fellis:upload-queue:fail', { id: entry.id, error: 'expired' })
        continue
      }
      entry.attempts = (entry.attempts || 0) + 1
      await update(entry).catch(() => {})
      const files = entry.payload.files.map(deserialiseFile).filter(Boolean)
      try {
        const post = await uploader({
          text: entry.payload.text,
          files,
          schedAt: entry.payload.schedAt,
          categories: entry.payload.categories,
          location: entry.payload.location,
          taggedUsers: entry.payload.taggedUsers,
          linkedContent: entry.payload.linkedContent,
        })
        await remove(entry.id).catch(() => {})
        emit('fellis:upload-queue:success', { id: entry.id, post })
      } catch (err) {
        // Transient failure — keep entry, try again later
        if (err?.code === 'NETWORK_ERROR' || err?.code === 'TIMEOUT') {
          // stop processing further items if we are clearly offline
          if (typeof navigator !== 'undefined' && navigator.onLine === false) break
          continue
        }
        // Permanent failure (4xx/5xx, validation): drop the entry
        await remove(entry.id).catch(() => {})
        emit('fellis:upload-queue:fail', { id: entry.id, error: err?.message || 'upload_failed' })
      }
    }
  } finally {
    processing = false
    notifyUpdate()
  }
}

let listenersInstalled = false

/**
 * Registers window listeners to auto-drain the queue whenever the
 * browser reports it's back online. Safe to call multiple times.
 */
export function installAutoFlush(uploader) {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  const run = () => { processQueue(uploader) }
  window.addEventListener('online', run)
  // Also retry when the tab becomes visible again (mobile browsers often
  // suspend network activity in the background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run()
  })
  // Kick off an initial run shortly after install
  setTimeout(run, 1500)
}
