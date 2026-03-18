import { useEffect, useRef } from 'react'

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]
const TIMEOUT_MS = 3000

/**
 * useKonamiCode — calls onActivate when the Konami code is entered anywhere on the page.
 * Uses position-based matching with a 2-second inter-key timeout so stale or
 * mistyped sequences don't interfere.
 * @param {() => void} onActivate
 * @param {boolean} [enabled=true]
 */
export default function useKonamiCode(onActivate, enabled = true) {
  const posRef = useRef(0)
  const timerRef = useRef(null)
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (!enabled) return

    const reset = () => { posRef.current = 0 }

    const handler = (e) => {
      const expected = KONAMI[posRef.current]

      if (e.key === expected || e.key.toLowerCase() === expected) {
        clearTimeout(timerRef.current)
        posRef.current++
        if (posRef.current === KONAMI.length) {
          posRef.current = 0
          onActivateRef.current()
        } else {
          timerRef.current = setTimeout(reset, TIMEOUT_MS)
        }
      } else if (posRef.current > 0) {
        // Mismatch — restart, but check if this key begins the sequence
        clearTimeout(timerRef.current)
        posRef.current = (e.key === KONAMI[0] || e.key.toLowerCase() === KONAMI[0]) ? 1 : 0
        if (posRef.current > 0) timerRef.current = setTimeout(reset, TIMEOUT_MS)
      }
    }

    // Use capture phase so arrow keys aren't consumed by scrollable elements first
    window.addEventListener('keydown', handler, { capture: true })
    return () => {
      window.removeEventListener('keydown', handler, { capture: true })
      clearTimeout(timerRef.current)
    }
  }, [enabled])
}
