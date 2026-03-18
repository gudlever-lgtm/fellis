import { useEffect, useRef } from 'react'

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]
const TIMEOUT_MS = 2000

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

      if (e.key === expected) {
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
        posRef.current = e.key === KONAMI[0] ? 1 : 0
        if (posRef.current > 0) timerRef.current = setTimeout(reset, TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timerRef.current)
    }
  }, [enabled])
}
