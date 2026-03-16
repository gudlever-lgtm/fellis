import { useState, useCallback } from 'react'
import { apiPostEasterEggEvent } from '../api.js'

export const EGG_IDS = ['chuck', 'matrix', 'flip', 'retro', 'gravity', 'party', 'rickroll', 'watcher']

const EGG_DEFAULTS = {
  chuck:    { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  matrix:   { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  flip:     { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  retro:    { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  gravity:  { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  party:    { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  rickroll: { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
  watcher:  { discovered: false, enabled: true, activationCount: 0, firstDiscoveredAt: null },
}

export const USER_LS_KEY = 'fellis_easter_eggs'
export const ADMIN_LS_KEY = 'fellis_admin_easter_eggs'

export function loadEggs() {
  try {
    const stored = JSON.parse(localStorage.getItem(USER_LS_KEY) || '{}')
    const result = {}
    for (const id of EGG_IDS) result[id] = { ...EGG_DEFAULTS[id], ...stored[id] }
    return result
  } catch {
    return { ...EGG_DEFAULTS }
  }
}

export function loadAdminEggs() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_LS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveEggs(eggs) {
  try { localStorage.setItem(USER_LS_KEY, JSON.stringify(eggs)) } catch {}
}

// Post activation event to server (best-effort, fire-and-forget)
async function postEggEvent(eggId, event) {
  try {
    await apiPostEasterEggEvent(eggId, event)
  } catch {
    // TODO: queue failed events in localStorage and retry on next session
  }
}

/**
 * useEasterEggs — shared easter egg state.
 *
 * triggerEgg(id) — marks egg as discovered/activated, returns true if the egg
 *   should actually fire (i.e. is enabled by user AND not globally disabled by admin).
 * toggleEgg(id) — flip per-user enabled flag.
 * isEnabled(id) — check if egg will fire.
 */
export default function useEasterEggs() {
  const [eggs, setEggsState] = useState(loadEggs)

  const triggerEgg = useCallback((id, onPosted) => {
    // Read current values synchronously from localStorage so we always have fresh state
    const current = loadEggs()
    const adminConfig = loadAdminEggs()

    const egg = current[id] || { ...EGG_DEFAULTS[id] }
    const adminEgg = adminConfig[id] || {}

    // Respect global admin disable
    if (adminEgg.globalEnabled === false) return false
    // Respect per-user disable
    if (egg.enabled === false) return false

    const now = new Date().toISOString()
    const wasDiscovered = egg.discovered
    const updated = {
      ...current,
      [id]: {
        ...egg,
        discovered: true,
        activationCount: (egg.activationCount || 0) + 1,
        firstDiscoveredAt: egg.firstDiscoveredAt || now,
      },
    }
    saveEggs(updated)
    setEggsState(updated)
    // Call onPosted after the event is confirmed stored in DB — avoids race condition
    // with badge evaluation that reads from the same DB table
    postEggEvent(id, wasDiscovered ? 'activated' : 'discovered').then(() => {
      onPosted?.()
    })
    return true
  }, [])

  const toggleEgg = useCallback((id) => {
    setEggsState(prev => {
      const updated = { ...prev, [id]: { ...prev[id], enabled: !prev[id]?.enabled } }
      saveEggs(updated)
      return updated
    })
  }, [])

  const isEnabled = useCallback((id) => {
    const adminConfig = loadAdminEggs()
    if (adminConfig[id]?.globalEnabled === false) return false
    return eggs[id]?.enabled !== false
  }, [eggs])

  // Authoritative sync from server — resets discovered state to match DB, preserves enabled pref
  const syncFromServer = useCallback((serverEggs) => {
    const stored = loadEggs()
    const merged = {}
    for (const id of EGG_IDS) {
      const srv = serverEggs[id] || {}
      merged[id] = {
        ...EGG_DEFAULTS[id],
        enabled: stored[id]?.enabled !== undefined ? stored[id].enabled : true,
        discovered: Boolean(srv.discovered),
        activationCount: srv.activationCount || 0,
        firstDiscoveredAt: srv.firstDiscoveredAt || null,
      }
    }
    saveEggs(merged)
    setEggsState(merged)
  }, [])

  return { eggs, triggerEgg, toggleEgg, isEnabled, syncFromServer }
}
