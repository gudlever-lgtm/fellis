import { useState } from 'react'
import { PT } from './data.js'
import { apiUpdateUserType } from './api.js'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconPerson() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="12" r="7" fill="currentColor" opacity=".9" />
      <path d="M4 32c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".7" />
    </svg>
  )
}

function IconNetwork() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="4" fill="currentColor" />
      <circle cx="5"  cy="10" r="3" fill="currentColor" opacity=".8" />
      <circle cx="31" cy="10" r="3" fill="currentColor" opacity=".8" />
      <circle cx="5"  cy="26" r="3" fill="currentColor" opacity=".8" />
      <circle cx="31" cy="26" r="3" fill="currentColor" opacity=".8" />
      <line x1="18" y1="18" x2="5"  y2="10" stroke="currentColor" strokeWidth="1.8" opacity=".5" />
      <line x1="18" y1="18" x2="31" y2="10" stroke="currentColor" strokeWidth="1.8" opacity=".5" />
      <line x1="18" y1="18" x2="5"  y2="26" stroke="currentColor" strokeWidth="1.8" opacity=".5" />
      <line x1="18" y1="18" x2="31" y2="26" stroke="currentColor" strokeWidth="1.8" opacity=".5" />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="6"  y="10" width="24" height="22" rx="2" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="2" />
      <rect x="6"  y="4"  width="24" height="8"  rx="2" fill="currentColor" opacity=".6" />
      <rect x="11" y="18" width="4"  height="4"  rx="1" fill="currentColor" opacity=".8" />
      <rect x="21" y="18" width="4"  height="4"  rx="1" fill="currentColor" opacity=".8" />
      <rect x="14" y="26" width="8"  height="6"  rx="1" fill="currentColor" opacity=".8" />
    </svg>
  )
}

// ── Card config ───────────────────────────────────────────────────────────────

const CARDS = [
  {
    mode: 'private',
    icon: IconPerson,
    color: '#1877F2',
    colorLight: '#EBF5FF',
    colorMid: '#BFDBFE',
    borderColor: '#93C5FD',
    tKey: 'private',
    hasBadge: false,
  },
  {
    mode: 'network',
    icon: IconNetwork,
    color: '#0D9488',
    colorLight: '#F0FDFA',
    colorMid: '#99F6E4',
    borderColor: '#5EEAD4',
    tKey: 'network',
    hasBadge: true,
  },
  {
    mode: 'business',
    icon: IconBuilding,
    color: '#D97706',
    colorLight: '#FFFBEB',
    colorMid: '#FDE68A',
    borderColor: '#FCD34D',
    tKey: 'business',
    hasBadge: true,
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function UserTypeSelector({ lang, onComplete }) {
  const [loading, setLoading] = useState(null)
  const [error, setError]   = useState('')

  const t = (PT[lang] || PT.en || PT.da)?.onboarding || {}

  async function handleSelect(mode) {
    if (loading) return
    setLoading(mode)
    setError('')
    try {
      await apiUpdateUserType(mode)
    } catch {
      // Non-fatal — mode defaults to 'private' server-side
    }
    onComplete(mode)
  }

  const s = {
    wrap: {
      width: '100%',
      maxWidth: 840,
      margin: '0 auto',
      padding: '0 12px',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 16,
    },
    card: (color, colorLight, borderColor, active) => ({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 10,
      padding: '20px 20px 16px',
      borderRadius: 16,
      border: `2px solid ${active ? color : borderColor}`,
      background: colorLight,
      cursor: active ? 'wait' : 'pointer',
      textAlign: 'left',
      transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
      boxShadow: active ? `0 4px 20px ${color}33` : '0 1px 4px rgba(0,0,0,0.06)',
    }),
    iconWrap: (color) => ({
      width: 52,
      height: 52,
      borderRadius: 14,
      background: color + '18',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color,
    }),
    badge: (color, colorMid) => ({
      position: 'absolute',
      top: 14,
      right: 14,
      padding: '2px 9px',
      borderRadius: 20,
      background: colorMid,
      color,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.3,
    }),
    title: (color) => ({
      fontSize: 17,
      fontWeight: 700,
      color,
      margin: 0,
      lineHeight: 1.2,
    }),
    features: {
      margin: '2px 0 0',
      padding: '0 0 0 14px',
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
    },
    feat: {
      fontSize: 13,
      color: '#444',
      lineHeight: 1.4,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 6,
    },
    dot: (color) => ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
      marginTop: 5,
    }),
    cta: (color) => ({
      marginTop: 'auto',
      alignSelf: 'stretch',
      padding: '10px 0',
      borderRadius: 10,
      background: color,
      color: '#fff',
      fontWeight: 700,
      fontSize: 14,
      textAlign: 'center',
      border: 'none',
      cursor: 'pointer',
      letterSpacing: 0.2,
    }),
    err: {
      textAlign: 'center',
      color: '#e74c3c',
      fontSize: 13,
      marginTop: 8,
    },
  }

  return (
    <div style={s.wrap}>
      <div style={s.grid}>
        {CARDS.map(({ mode, icon: Icon, color, colorLight, colorMid, borderColor, tKey, hasBadge }) => {
          const tCard = t[tKey] || {}
          const isActive = loading === mode
          const features = [tCard.f1, tCard.f2, tCard.f3, tCard.f4].filter(Boolean)

          return (
            <div
              key={mode}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              style={s.card(color, colorLight, borderColor, isActive)}
              onClick={() => handleSelect(mode)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleSelect(mode)}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 6px 24px ${color}22` } }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = isActive ? `0 4px 20px ${color}33` : '0 1px 4px rgba(0,0,0,0.06)' }}
            >
              {hasBadge && tCard.badge && (
                <span style={s.badge(color, colorMid)}>{tCard.badge}</span>
              )}

              <div style={s.iconWrap(color)}>
                <Icon />
              </div>

              <p style={s.title(color)}>{tCard.title}</p>

              <ul style={s.features}>
                {features.map(f => (
                  <li key={f} style={s.feat}>
                    <span style={s.dot(color)} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                style={s.cta(color)}
                onClick={e => { e.stopPropagation(); handleSelect(mode) }}
                disabled={!!loading}
                aria-busy={isActive}
              >
                {isActive ? '…' : (t.cta || 'Vælg')}
              </button>
            </div>
          )
        })}
      </div>
      {error && <p style={s.err}>{error}</p>}
    </div>
  )
}
