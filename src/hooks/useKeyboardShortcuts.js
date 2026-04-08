import { useEffect } from 'react'

/**
 * Global keyboard shortcuts for fellis platform navigation.
 * Only fires when focus is NOT in a text input/textarea.
 *
 * Shortcuts:
 *   G F  — Go to Feed
 *   G M  — Go to Messages
 *   G P  — Go to Profile
 *   G J  — Go to Jobs
 *   G E  — Go to Events
 *   G S  — Go to Search
 *   G N  — Toggle Notifications
 *   /    — Focus search input
 *   ?    — Show shortcut help
 */
export default function useKeyboardShortcuts({ onNavigate, onToggleNotifs, onFocusSearch, onShowHelp, enabled = true }) {
  useEffect(() => {
    if (!enabled) return
    let firstKey = null
    let firstKeyTimer = null

    const handler = (e) => {
      // Don't fire when user is typing
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return

      const key = e.key.toLowerCase()

      if (key === '/') {
        e.preventDefault()
        onFocusSearch?.()
        return
      }

      if (key === '?') {
        onShowHelp?.()
        return
      }

      // Two-key sequences starting with 'g'
      if (key === 'g' && !firstKey) {
        firstKey = 'g'
        firstKeyTimer = setTimeout(() => { firstKey = null }, 1000)
        return
      }

      if (firstKey === 'g') {
        clearTimeout(firstKeyTimer)
        firstKey = null
        const pageMap = { f: 'feed', m: 'messages', p: 'profile', j: 'jobs', e: 'events', s: 'search', n: 'notifications', b: 'badges', r: 'reels', k: 'marketplace' }
        if (pageMap[key]) {
          if (key === 'n') onToggleNotifs?.()
          else onNavigate?.(pageMap[key])
        }
        return
      }

      firstKey = null
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, onNavigate, onToggleNotifs, onFocusSearch, onShowHelp])
}
