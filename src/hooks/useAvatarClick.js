import { useEffect, useRef } from 'react'

/**
 * useAvatarClick — fires onTrigger when any avatar element within containerRef
 * is clicked `threshold` times within `timeWindow` milliseconds.
 *
 * Avatar elements are detected by CSS class matching: p-avatar-sm, p-avatar-xs,
 * p-avatar-md, p-nav-avatar, p-profile-avatar.
 *
 * @param {React.RefObject} containerRef
 * @param {number} threshold   number of clicks required
 * @param {number} timeWindow  milliseconds
 * @param {() => void} onTrigger
 * @param {boolean} [enabled=true]
 */
export default function useAvatarClick(containerRef, threshold, timeWindow, onTrigger, enabled = true) {
  const clicksRef = useRef([])
  const onTriggerRef = useRef(onTrigger)
  onTriggerRef.current = onTrigger

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    const handler = (e) => {
      const target = e.target.closest(
        '.p-avatar-sm, .p-avatar-xs, .p-avatar-md, .p-nav-avatar, .p-profile-avatar, [data-avatar]'
      )
      if (!target) return

      const now = Date.now()
      clicksRef.current = [...clicksRef.current.filter(t => now - t < timeWindow), now]
      if (clicksRef.current.length >= threshold) {
        clicksRef.current = []
        onTriggerRef.current()
      }
    }

    container.addEventListener('click', handler)
    return () => container.removeEventListener('click', handler)
  }, [containerRef, threshold, timeWindow, enabled])
}
