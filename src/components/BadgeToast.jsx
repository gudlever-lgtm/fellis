import { useState, useEffect, useCallback, useRef } from 'react'

const badgeToastStyles = `
  .badge-toast-container {
    position: fixed;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    padding: 0 16px;
    max-width: 100%;
    width: 100%;
    box-sizing: border-box;
  }

  .badge-toast {
    width: 100%;
    max-width: 340px;
  }

  @media (max-width: 699px) {
    .badge-toast {
      max-width: calc(100vw - 32px);
    }
  }
`

const TIER_COLORS = {
  1: { bg: '#7C4A0040', border: '#CD7F32', label: '#CD7F32' },  // bronze
  2: { bg: '#80808040', border: '#A8A9AD', label: '#A8A9AD' },  // silver
  3: { bg: '#B8860B40', border: '#FFD700', label: '#FFD700' },  // gold
  0: { bg: '#2D1B6940', border: '#9D4EDD', label: '#9D4EDD' },  // easter egg — purple
}

const TIER_LABEL = {
  da: { 1: 'Bronze', 2: 'Sølv', 3: 'Guld', 0: '🥚 Hemmeligt' },
  en: { 1: 'Bronze', 2: 'Silver', 3: 'Gold', 0: '🥚 Secret' },
}

function Toast({ badge, lang, onDone }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    const hideTimer = setTimeout(() => setVisible(false), 4000)
    const doneTimer = setTimeout(onDone, 4600)
    return () => { clearTimeout(hideTimer); clearTimeout(doneTimer) }
  }, [onDone])

  const colors = TIER_COLORS[badge.tier] ?? TIER_COLORS[1]
  const tierLabel = (TIER_LABEL[lang] ?? TIER_LABEL.da)[badge.tier]

  return (
    <div
      className="badge-toast"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--card-bg, #fff)',
        border: `2px solid ${colors.border}`,
        borderRadius: 14,
        boxShadow: `0 4px 24px rgba(0,0,0,0.18), 0 0 0 4px ${colors.bg}`,
        padding: '12px 18px',
        minWidth: 280,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>{badge.icon}</div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: colors.label, marginBottom: 2 }}>
          {lang === 'da' ? '🏅 Badge optjent' : '🏅 Badge earned'} · {tierLabel}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #111)', lineHeight: 1.2 }}>
          {badge.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #666)', marginTop: 2, lineHeight: 1.3 }}>
          {badge.description}
        </div>
        {badge.adfreeAdded > 0 && (
          <div style={{ fontSize: 11, fontWeight: 600, color: '#2196F3', marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(33, 150, 243, 0.2)' }}>
            📅 {badge.adfreeAdded} {lang === 'da' ? 'dag(e) banked!' : 'day(s) banked!'}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * BadgeToastQueue — renders queued badge award notifications, one at a time
 * with a 2-second gap between consecutive badges.
 *
 * Usage:
 *   const badgeQueue = useRef(null)
 *   <BadgeToastQueue ref={badgeQueue} lang={lang} />
 *   badgeQueue.current?.addBadges(newBadgesArray)
 */
export default function BadgeToastQueue({ lang, queueRef }) {
  const [queue, setQueue] = useState([])
  const [current, setCurrent] = useState(null)
  const gapTimer = useRef(null)

  // Expose addBadges via queueRef
  useEffect(() => {
    if (queueRef) {
      queueRef.current = {
        addBadges: (badges) => {
          if (!badges?.length) return
          setQueue(prev => [...prev, ...badges])
        },
      }
    }
    return () => {
      if (queueRef) queueRef.current = null
    }
  }, [queueRef])

  const showNext = useCallback(() => {
    setQueue(prev => {
      if (!prev.length) { setCurrent(null); return prev }
      const [next, ...rest] = prev
      gapTimer.current = setTimeout(() => {
        setCurrent(next)
      }, current ? 600 : 0)
      setCurrent(null)
      return rest
    })
  }, [current])

  // Kick off processing whenever queue grows and nothing is showing
  useEffect(() => {
    if (!current && queue.length > 0) {
      clearTimeout(gapTimer.current)
      const [next, ...rest] = queue
      gapTimer.current = setTimeout(() => setCurrent(next), 200)
      setQueue(rest)
    }
    return () => clearTimeout(gapTimer.current)
  }, [queue, current]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null

  return (
    <>
      <style>{badgeToastStyles}</style>
      <div className="badge-toast-container">
        <Toast key={current.id + current.awardedAt} badge={current} lang={lang} onDone={showNext} />
      </div>
    </>
  )
}
