import { useEffect, useRef } from 'react'

/**
 * useKeySequence — fires onMatch when the given key sequence is pressed
 * within the specified time window.
 *
 * @param {string} sequence  e.g. 'gg' or 'party'
 * @param {() => void} onMatch
 * @param {number} [timeWindow=2000]  milliseconds
 * @param {boolean} [enabled=true]
 */
export default function useKeySequence(sequence, onMatch, timeWindow = 2000, enabled = true) {
  const pressesRef = useRef([])
  const onMatchRef = useRef(onMatch)
  onMatchRef.current = onMatch

  useEffect(() => {
    if (!enabled) return
    const keys = sequence.toLowerCase().split('')

    const handler = (e) => {
      const key = e.key.toLowerCase()
      const now = Date.now()
      const recent = [
        ...pressesRef.current.filter(p => now - p.t < timeWindow),
        { k: key, t: now },
      ].slice(-keys.length)
      pressesRef.current = recent

      if (recent.length === keys.length && recent.map(p => p.k).join('') === keys.join('')) {
        pressesRef.current = []
        onMatchRef.current()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [sequence, timeWindow, enabled])
}
