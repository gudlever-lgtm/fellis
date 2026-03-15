import { useEffect, useRef } from 'react'

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]

/**
 * useKonamiCode — calls onActivate when the Konami code is entered anywhere on the page.
 * @param {() => void} onActivate
 * @param {boolean} [enabled=true]
 */
export default function useKonamiCode(onActivate, enabled = true) {
  const seqRef = useRef([])
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (!enabled) return
    const handler = (e) => {
      seqRef.current = [...seqRef.current, e.key].slice(-KONAMI.length)
      if (seqRef.current.join(',') === KONAMI.join(',')) {
        seqRef.current = []
        onActivateRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])
}
