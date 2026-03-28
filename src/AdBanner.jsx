import { useState, useEffect, useRef } from 'react'
import { apiServeAds, apiRecordAdImpression, apiRecordAdClick } from './api.js'

/**
 * AdBanner — renders a platform ad for a given placement.
 *
 * Props:
 *   placement   'feed' | 'sidebar' | 'stories'
 *   adsFree     boolean — if true, renders nothing
 *   currentUser optional user object (ads_free is checked server-side too)
 */

// Module-level ad cache — shared across all AdBanner instances with same placement.
// Avoids N simultaneous requests when multiple ad slots render at once (e.g. feed).
const _adCache = {} // placement → { ads, refresh_interval, fetchedAt, promise }

// Call this after creating, deleting, or updating any ad so the next render re-fetches.
export function invalidateAdCache() {
  Object.keys(_adCache).forEach(k => delete _adCache[k])
}

async function fetchAds(placement) {
  const now = Date.now()
  const cached = _adCache[placement]
  // Return cached data if still fresh (within 90% of the refresh interval)
  if (cached && !cached.promise) {
    const ttl = (cached.refresh_interval || 300) * 900 // 90% of interval in ms
    if (now - cached.fetchedAt < ttl) return cached
  }
  // If a fetch is already in flight, share that promise instead of firing another
  if (cached?.promise) return cached.promise
  const promise = apiServeAds(placement).then(data => {
    const result = {
      ads: data?.ads || [],
      ads_free: data?.ads_free || false,
      refresh_interval: data?.refresh_interval || 300,
      fetchedAt: Date.now(),
      promise: null,
    }
    _adCache[placement] = result
    return result
  }).catch(() => {
    delete _adCache[placement]
    return { ads: [], refresh_interval: 300, fetchedAt: Date.now(), promise: null }
  })
  _adCache[placement] = { ...cached, promise }
  return promise
}

export default function AdBanner({ placement = 'feed', adsFree = false, onGoAdFree, lang = 'da' }) {
  const [ads, setAds] = useState([])
  const [refreshInterval, setRefreshInterval] = useState(300)
  const [adIndex, setAdIndex] = useState(0)
  const impressedRef = useRef(new Set())

  useEffect(() => {
    if (adsFree) return

    let cancelled = false
    const load = () => {
      fetchAds(placement).then(data => {
        if (cancelled) return
        if (data?.ads_free) { setAds([]); return }
        setAds(data.ads || [])
        if (data?.refresh_interval) setRefreshInterval(data.refresh_interval)
        setAdIndex(0)
      })
    }

    load()
    const interval = setInterval(load, refreshInterval * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [placement, adsFree]) // eslint-disable-line react-hooks/exhaustive-deps

  const ad = ads[adIndex % (ads.length || 1)]

  useEffect(() => {
    if (!ad || impressedRef.current.has(ad.id)) return
    impressedRef.current.add(ad.id)
    apiRecordAdImpression(ad.id).catch(() => {})
  }, [ad])

  if (adsFree || !ad) return null

  const handleClick = () => {
    apiRecordAdClick(ad.id).catch(() => {})
    if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer')
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
          cursor: 'pointer',
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
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{ad.title}</div>
            {ad.body && <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>{ad.body}</div>}
          </div>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600, letterSpacing: 0.5 }}>Sponsoreret</span>
          {onGoAdFree && (
            <button
              onClick={e => { e.stopPropagation(); onGoAdFree() }}
              title={lang === 'da' ? 'Fjern annoncer' : 'Remove ads'}
              style={{ background: 'none', border: '1px solid #ddd', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#aaa', cursor: 'pointer', lineHeight: 1.6 }}
            >
              🚫 {lang === 'da' ? 'Reklamefri' : 'Ad-free'}
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
          cursor: 'pointer',
          fontSize: 13,
        }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClick()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>SPONSORERET</span>
          {onGoAdFree && (
            <button onClick={e => { e.stopPropagation(); onGoAdFree() }}
              style={{ background: 'none', border: '1px solid #eee', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#aaa', cursor: 'pointer' }}>
              🚫 {lang === 'da' ? 'Reklamefri' : 'Ad-free'}
            </button>
          )}
        </div>
        {ad.image_url && (
          <img src={ad.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 8, objectFit: 'cover', maxHeight: 120 }} />
        )}
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{ad.title}</div>
        {ad.body && <div style={{ color: '#666', fontSize: 12, lineHeight: 1.5 }}>{ad.body}</div>}
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
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, opacity: 0.7 }}>SPONSORERET</span>
        {onGoAdFree && (
          <button onClick={e => { e.stopPropagation(); onGoAdFree() }}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#fff', cursor: 'pointer' }}>
            🚫 {lang === 'da' ? 'Reklamefri' : 'Ad-free'}
          </button>
        )}
      </div>
      {ad.image_url && (
        <img src={ad.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 10, objectFit: 'cover', maxHeight: 160 }} />
      )}
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{ad.title}</div>
      {ad.body && <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>{ad.body}</div>}
    </div>
  )
}
