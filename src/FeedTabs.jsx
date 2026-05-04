import { useState } from 'react'
import { getTheme } from './userTypeTheme.js'

const SKELETON_COUNT = 3

function SkeletonCard() {
  return (
    <div className="feedtabs-skeleton">
      <div className="feedtabs-skel-header">
        <div className="feedtabs-skel feedtabs-skel-avatar" />
        <div className="feedtabs-skel-name-wrap">
          <div className="feedtabs-skel feedtabs-skel-name" />
          <div className="feedtabs-skel feedtabs-skel-time" />
        </div>
      </div>
      <div className="feedtabs-skel feedtabs-skel-line1" />
      <div className="feedtabs-skel feedtabs-skel-line2" />
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
      <div className="feedtabs-label-row">
        <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '0.02em' }}>
          {t?.feedModePrivat || 'Community'}
        </span>
      </div>
    )
  }

  if (viewerMode === 'business') {
    const biz = getTheme('business')
    return (
      <div className="feedtabs-bar">
        <button
          className="feedtabs-tab"
          style={{ background: biz.color, color: '#fff', borderBottom: `3px solid ${biz.color}` }}
          disabled
        >
          {t?.feedTab?.network || 'Network'}
        </button>
      </div>
    )
  }

  const tabs = ['private', 'network']

  return (
    <>
      <div className="feedtabs-bar">
        {tabs.map(tab => {
          const theme = getTheme(tab)
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className="feedtabs-tab"
              style={{
                background: isActive ? theme.color : '#fff',
                color: isActive ? '#fff' : theme.color,
                borderBottom: `3px solid ${isActive ? theme.color : 'transparent'}`,
              }}
            >
              {(tab === 'private' ? t?.feedModePrivat : t?.feedTab?.network) || tab}
            </button>
          )
        })}
      </div>
      {switching && (
        <div className="feedtabs-skeleton-wrap">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
    </>
  )
}
