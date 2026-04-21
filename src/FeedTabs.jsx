import { useState } from 'react'
import { getTheme } from './userTypeTheme.js'

const SKELETON_COUNT = 3

function SkeletonCard() {
  return (
    <div style={s.skeleton}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <div style={{ ...s.skel, width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ ...s.skel, width: '40%', height: 13, marginBottom: 6 }} />
          <div style={{ ...s.skel, width: '25%', height: 10 }} />
        </div>
      </div>
      <div style={{ ...s.skel, width: '90%', height: 12, marginBottom: 6 }} />
      <div style={{ ...s.skel, width: '70%', height: 12 }} />
    </div>
  )
}

export default function FeedTabs({ viewerMode, t, activeTab, onTabChange }) {
  const [switching, setSwitching] = useState(false)

  const handleTabChange = (tab) => {
    if (tab === activeTab) return
    setSwitching(true)
    onTabChange(tab)
    setTimeout(() => setSwitching(false), 400)
  }

  if (viewerMode === 'privat') {
    return (
      <div style={s.labelRow}>
        <span style={s.modeLabel}>{t?.feed?.label?.private || 'Private feed'}</span>
      </div>
    )
  }

  if (viewerMode === 'business') {
    const biz = getTheme('business')
    return (
      <div style={s.tabBar}>
        <button style={{ ...s.tab, background: biz.color, color: '#fff', borderBottom: `3px solid ${biz.color}` }} disabled>
          {t?.feed?.tab?.network || 'Network'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div style={s.tabBar}>
        {['private', 'network'].map(tab => {
          const theme = getTheme(tab)
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              style={{
                ...s.tab,
                background: isActive ? theme.color : '#fff',
                color: isActive ? '#fff' : theme.color,
                borderBottom: `3px solid ${isActive ? theme.color : 'transparent'}`,
              }}
            >
              {t?.feed?.tab?.[tab] || tab}
            </button>
          )
        })}
      </div>
      {switching && (
        <div style={s.skeletonWrap}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
    </>
  )
}

const s = {
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 12,
  },
  modeLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#6B7280',
    letterSpacing: '0.02em',
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 12,
    borderBottom: '2px solid #E5E7EB',
    paddingBottom: 0,
  },
  tab: {
    padding: '7px 18px',
    borderRadius: '8px 8px 0 0',
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.12s',
    outline: 'none',
    marginBottom: -2,
  },
  skeletonWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 16,
  },
  skeleton: {
    background: '#F9FAFB',
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    padding: '16px 20px',
  },
  skel: {
    background: 'linear-gradient(90deg, #E5E7EB 25%, #F3F4F6 50%, #E5E7EB 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
    borderRadius: 4,
  },
}
