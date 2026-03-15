import { useEffect, useState } from 'react'

const FALLBACK_JOKE = "Chuck Norris can divide by zero."

/**
 * ChuckBanner — overlays the bottom status bar with a Chuck Norris joke.
 * Dismisses on click or Escape key. Fetches joke from chucknorris.io.
 */
export default function ChuckBanner({ onDismiss }) {
  const [joke, setJoke] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('https://api.chucknorris.io/jokes/random')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { if (!cancelled) setJoke(data?.value || FALLBACK_JOKE) })
      .catch(() => { if (!cancelled) setJoke(FALLBACK_JOKE) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)',
        borderTop: '2px solid #c0681a',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 44, cursor: 'pointer',
        boxShadow: '0 -2px 12px rgba(192,104,26,0.15)',
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>🤜</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#c0681a', flexShrink: 0, letterSpacing: 0.5 }}>
        CHUCK NORRIS
      </span>
      <span style={{ color: '#333', fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {joke ?? '…'}
      </span>
      <span style={{ fontSize: 13, color: '#bbb', flexShrink: 0 }}>✕</span>
    </div>
  )
}
