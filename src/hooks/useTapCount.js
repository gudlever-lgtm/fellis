import { useEffect, useRef } from 'react'

/**
 * useTapCount — fires callbacks based on exact tap/click count within a window.
 * After the last tap, waits settleMs before committing — so 3 taps vs 5 taps
 * are distinct as long as the user pauses naturally after the final tap.
 *
 * Works for both mouse clicks and touch (via the synthetic click event).
 *
 * @param {React.RefObject} ref
 * @param {{ [count: number]: () => void }} handlers  e.g. { 2: onDouble, 3: onTriple }
 * @param {number} [windowMs=3000]   max gap between first and last tap
 * @param {number} [settleMs=600]    silence after last tap before committing
 * @param {boolean} [enabled=true]
 */
export default function useTapCount(ref, handlers, windowMs = 3000, settleMs = 600, enabled = true) {
  const tapsRef = useRef([])
  const settleRef = useRef(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const commit = () => {
      const count = tapsRef.current.length
      tapsRef.current = []
      const cb = handlersRef.current[count]
      if (cb) cb()
    }

    const handler = () => {
      const now = Date.now()
      tapsRef.current = [...tapsRef.current.filter(t => now - t < windowMs), now]
      clearTimeout(settleRef.current)
      settleRef.current = setTimeout(commit, settleMs)
    }

    el.addEventListener('click', handler)
    return () => {
      el.removeEventListener('click', handler)
      clearTimeout(settleRef.current)
    }
  }, [ref, windowMs, settleMs, enabled])
}
