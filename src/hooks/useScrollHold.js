import { useEffect, useRef } from 'react'

/**
 * useScrollHold — fires onTrigger when sentinelRef element has been
 * continuously visible for at least holdMs milliseconds.
 *
 * @param {React.RefObject} sentinelRef
 * @param {number} holdMs
 * @param {() => void} onTrigger
 * @param {boolean} [enabled=true]
 */
export default function useScrollHold(sentinelRef, holdMs, onTrigger, enabled = true) {
  const timerRef = useRef(null)
  const onTriggerRef = useRef(onTrigger)
  onTriggerRef.current = onTrigger

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !enabled) return

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        timerRef.current = setTimeout(() => onTriggerRef.current(), holdMs)
      } else {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      }
    }, { threshold: 0.5 })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [sentinelRef, holdMs, enabled])
}
