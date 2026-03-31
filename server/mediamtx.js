/**
 * mediamtx.js — Wrapper for the mediamtx REST API (http://localhost:9997).
 *
 * mediamtx runs as a separate systemd service:
 *   RTMP  port 1935
 *   WebRTC port 8889
 *   API   port 9997
 */

const MEDIAMTX_API = 'http://localhost:9997'

/**
 * List all active (and inactive) stream paths from mediamtx.
 * Returns an array of path objects (mediamtx v3 /v3/paths/list).
 * Returns [] if mediamtx is unreachable.
 */
export async function listActivePaths() {
  try {
    const res = await fetch(`${MEDIAMTX_API}/v3/paths/list`)
    if (!res.ok) return []
    const data = await res.json()
    return data.items ?? []
  } catch {
    return []
  }
}

/**
 * Kick the publisher on the given stream path.
 * Returns true if mediamtx accepted the request, false otherwise.
 * @param {string} pathName — the stream path / stream key
 */
export async function kickPublisher(pathName) {
  try {
    const res = await fetch(
      `${MEDIAMTX_API}/v3/paths/kick/${encodeURIComponent(pathName)}`,
      { method: 'POST' }
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * Get stats / metadata for a single stream path.
 * Returns the mediamtx path object or null if not found / unreachable.
 * @param {string} pathName — the stream path / stream key
 */
export async function getStreamStats(pathName) {
  try {
    const res = await fetch(
      `${MEDIAMTX_API}/v3/paths/get/${encodeURIComponent(pathName)}`
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
