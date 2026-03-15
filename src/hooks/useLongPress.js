import { useEffect, useRef } from 'react'

/**
 * useLongPress — fires onTrigger when ref element is held for holdMs.
 * On touch devices, suppresses the synthetic click event that follows,
 * so the element's regular onClick is not triggered after a long-press.
 *
 * @param {React.RefObject} ref
 * @param {number} holdMs
 * @param {() => void} onTrigger
 * @param {boolean} [enabled=true]
 */
export default function useLongPress(ref, holdMs, onTrigger, enabled = true) {
  const timerRef = useRef(null)
  const firedRef = useRef(false)
  const onTriggerRef = useRef(onTrigger)
  onTriggerRef.current = onTrigger

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const start = (e) => {
      if (e.touches && e.touches.length !== 1) return
      firedRef.current = false
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        onTriggerRef.current()
      }, holdMs)
    }

    const cancel = () => {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // Suppress the synthetic click that follows a touch long-press
    const suppressClick = (e) => {
      if (firedRef.current) {
        firedRef.current = false
        e.stopPropagation()
        e.preventDefault()
      }
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', cancel)
    el.addEventListener('touchcancel', cancel)
    el.addEventListener('touchmove', cancel)
    el.addEventListener('click', suppressClick, true)

    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchend', cancel)
      el.removeEventListener('touchcancel', cancel)
      el.removeEventListener('touchmove', cancel)
      el.removeEventListener('click', suppressClick, true)
      cancel()
    }
  }, [ref, holdMs, enabled])
}
