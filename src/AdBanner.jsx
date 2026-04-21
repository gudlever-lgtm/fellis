import { useState, useEffect } from 'react'
import { apiFetchAdBanner } from './api.js'
import { PT } from './data.js'
import THEMES from './userTypeTheme.js'

/**
 * AdBanner — renders a platform ad for a given placement.
 *
 * Props:
 *   placement     'feed' | 'sidebar' | 'stories'
 *   adsFree       boolean — legacy flag, treated same as hasAdFree
 *   hasAdFree     boolean — if true, renders nothing
 *   viewerMode    'privat' | 'private' | 'business' | 'network'
 *   activeContext 'social' | 'professional' | 'business'
 */

// Subscribers notified on invalidation so active AdBanner instances refetch immediately.
const _listeners = new Set()

export function invalidateAdCache() {
  _listeners.forEach(fn => fn())
}

export const UPSELL_KEY = 'fellis_upsell_dismissed'

export function UpsellCard({ t, lang, onGoAdFree, onDismiss }) {
  const n = THEMES.network
  const label = t?.ads?.upsell_text || 'Try fellis without ads'
  const cta = t?.ads?.upsell_cta || 'Go ad-free'
  const dismiss = t?.ads?.upsell_dismiss || 'No thanks'
  return (
    <div style={{ background: n.colorLight, border: `1.5px solid ${n.avatarBg}`, borderRadius: 12, padding: '14px 16px', margin: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: n.colorDark, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onGoAdFree} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: n.color, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{cta}</button>
        <button onClick={onDismiss} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${n.avatarBg}`, background: '#fff', color: n.colorDark, fontSize: 12, cursor: 'pointer' }}>{dismiss}</button>
      </div>
    </div>
  )
}

export default function AdBanner({ placement = 'feed', adsFree = false, hasAdFree = false, viewerMode, activeContext, onGoAdFree, lang = 'da', t }) {
  const [ad, setAd] = useState(null)

  const isBusinessMode = viewerMode === 'business'
  const isProfessionalContext = activeContext === 'professional' || activeContext === 'business'
  const shouldHide = hasAdFree || adsFree || isBusinessMode || isProfessionalContext

  useEffect(() => {
    if (shouldHide) return
    let cancelled = false

    const load = () => {
      apiFetchAdBanner().then(data => {
        if (cancelled) return
        setAd(data || null)
      })
    }

    load()
    const interval = setInterval(load, 300 * 1000)
    _listeners.add(load)
    return () => { cancelled = true; clearInterval(interval); _listeners.delete(load) }
  }, [shouldHide])

  if (shouldHide) return null
  if (!ad) return null

  const sponsoredLabel = t?.ads?.label || PT[lang]?.ads?.label || 'Sponsoreret'
  const goAdFreeLabel = t?.ads?.upsell_cta || 'Go ad-free'

  const handleClick = () => {
    if (ad.link_url) window.open(ad.link_url, '_blank', 'noopener,noreferrer')
  }

  if (placement === 'feed') {
    return (
      <div
        style={{
          background: '#f9f6f2',
          border: '1px solid #e8e4df',
          borderRadius: 12,
          padding: '12px 16px',
          margin: '8px 0',
          cursor: ad.link_url ? 'pointer' : 'default',
          position: 'relative',
        }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClick()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {ad.image_url && (
            <img
              src={ad.image_url}
              alt=""
              style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{ad.label}</div>
          </div>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600, letterSpacing: 0.5 }}>{sponsoredLabel}</span>
          {onGoAdFree && (
            <button
              onClick={e => { e.stopPropagation(); onGoAdFree() }}
              style={{ background: 'none', border: '1px solid #ddd', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#aaa', cursor: 'pointer', lineHeight: 1.6 }}
            >
              🚫 {goAdFreeLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (placement === 'sidebar') {
    return (
      <div
        style={{
          background: '#fff',
          border: '1px solid #e8e4df',
          borderRadius: 10,
          padding: 14,
          cursor: ad.link_url ? 'pointer' : 'default',
          fontSize: 13,
        }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClick()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>{sponsoredLabel.toUpperCase()}</span>
          {onGoAdFree && (
            <button onClick={e => { e.stopPropagation(); onGoAdFree() }}
              style={{ background: 'none', border: '1px solid #eee', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#aaa', cursor: 'pointer' }}>
              🚫 {goAdFreeLabel}
            </button>
          )}
        </div>
        {ad.image_url && (
          <img src={ad.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 8, objectFit: 'cover', maxHeight: 120 }} />
        )}
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{ad.label}</div>
      </div>
    )
  }

  // stories
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #2D6A4F, #1877F2)',
        borderRadius: 12,
        padding: '16px 20px',
        color: '#fff',
        cursor: ad.link_url ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, opacity: 0.7 }}>{sponsoredLabel.toUpperCase()}</span>
        {onGoAdFree && (
          <button onClick={e => { e.stopPropagation(); onGoAdFree() }}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#fff', cursor: 'pointer' }}>
            🚫 {goAdFreeLabel}
          </button>
        )}
      </div>
      {ad.image_url && (
        <img src={ad.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 10, objectFit: 'cover', maxHeight: 160 }} />
      )}
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{ad.label}</div>
    </div>
  )
}
