import { useState, useEffect, useRef } from 'react'
import { apiGetPlatformAds, apiTrackPlatformAd } from '../api.js'

/**
 * AdSidebar — right-column display ads (zone=display), desktop only.
 *
 * Props:
 *   mode     'privat' | 'business'  — maps to 'common'/'business' for mode filter
 *   adsFree  boolean                — renders nothing when true
 */
export default function AdSidebar({ mode = 'privat', adsFree = false }) {
  const [ads, setAds] = useState([])
  const impressedRef = useRef(new Set())

  // Map platform mode names to ad mode values
  const adMode = mode === 'business' ? 'business' : 'common'

  useEffect(() => {
    if (adsFree) return
    let cancelled = false
    apiGetPlatformAds('display', adMode).then(data => {
      if (cancelled) return
      setAds(data?.ads || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [adMode, adsFree])

  // Fire impression for each ad once on mount/change
  useEffect(() => {
    for (const ad of ads) {
      if (impressedRef.current.has(ad.id)) continue
      impressedRef.current.add(ad.id)
      apiTrackPlatformAd(ad.id, 'impression').catch(() => {})
    }
  }, [ads])

  if (adsFree || ads.length === 0) return null

  return (
    // Hidden on mobile via inline media-aware style — no CSS file changes needed
    <aside style={{
      width: 240,
      flexShrink: 0,
      display: 'none', // overridden in CSS below via class
    }} className="ad-sidebar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 80 }}>
        {ads.map(ad => (
          <AdSidebarCard key={ad.id} ad={ad} />
        ))}
      </div>
      <style>{`
        @media (min-width: 1100px) { .ad-sidebar { display: block !important; } }
      `}</style>
    </aside>
  )
}

function AdSidebarCard({ ad }) {
  const handleClick = () => {
    apiTrackPlatformAd(ad.id, 'click').catch(() => {})
    const url = ad.link_url || ad.target_url
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E8E4DF',
        borderRadius: 10,
        padding: 14,
        cursor: 'pointer',
        fontSize: 13,
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>SPONSORERET</div>
      {ad.image_url && (
        <img
          src={ad.image_url}
          alt=""
          style={{ width: '100%', borderRadius: 8, marginBottom: 8, objectFit: 'cover', maxHeight: 120, display: 'block' }}
        />
      )}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#2D3436' }}>{ad.title}</div>
      {ad.body && <div style={{ color: '#666', fontSize: 12, lineHeight: 1.5 }}>{ad.body}</div>}
    </div>
  )
}
