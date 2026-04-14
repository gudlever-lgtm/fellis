import { useState, useEffect, useRef } from 'react'
import { apiServeAds, apiRecordAdImpression, apiRecordAdClick } from './api.js'
import { PT } from './data.js'

/**
 * AdBanner — renders a platform ad for a given placement.
 *
 * Props:
 *   placement   'feed' | 'sidebar' | 'stories'
 *   adsFree     boolean — if true, renders nothing
 *   currentUser optional user object (ads_free is checked server-side too)
 */

// Module-level in-flight deduplication — prevents N simultaneous fetches
// when multiple AdBanner instances mount at once (e.g. several feed slots).
// Does NOT cache results across renders; each interval tick fetches fresh data.
const _inflight = {} // placement → Promise | null

// Subscribers notified on invalidation so active AdBanner instances refetch immediately.
let _revision = 0
const _listeners = new Set()

// Call this after creating, deleting, or updating any ad so all active banners refetch.
export function invalidateAdCache() {
  Object.keys(_inflight).forEach(k => delete _inflight[k])
  _revision++
  _listeners.forEach(fn => fn(_revision))
}

async function fetchAds(placement) {
  // If a fetch is already in flight for this placement, reuse the same promise
  if (_inflight[placement]) return _inflight[placement]
  const promise = apiServeAds(placement).then(data => {
    delete _inflight[placement]
    return {
      ads: data?.ads || [],
      ads_free: data?.ads_free || false,
      refresh_interval: data?.refresh_interval || 300,
    }
  }).catch(() => {
    delete _inflight[placement]
    return { ads: [], refresh_interval: 300 }
  })
  _inflight[placement] = promise
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

    // Refetch immediately whenever invalidateAdCache() is called
    _listeners.add(load)
    return () => { cancelled = true; clearInterval(interval); _listeners.delete(load) }
  }, [placement, adsFree]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotate through multiple ads every 10 seconds when more than one is available
  useEffect(() => {
    if (ads.length <= 1) return
    const rotateInterval = setInterval(() => {
      setAdIndex(i => i + 1)
    }, 10000)
    return () => clearInterval(rotateInterval)
  }, [ads.length])

  const ad = ads[adIndex % (ads.length || 1)]

  useEffect(() => {
    if (!ad || impressedRef.current.has(ad.id)) return
    impressedRef.current.add(ad.id)
    apiRecordAdImpression(ad.id).catch(() => {})
  }, [ad])

  if (adsFree) {
    if (placement === 'feed') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0', margin: '4px 0' }}>
          <span style={{ fontSize: 11, color: '#b0c4b8', fontWeight: 600, letterSpacing: 0.3 }}>
            ✓ {PT[lang].adFreeZone}
          </span>
        </div>
      )
    }
    if (placement === 'sidebar') {
      return (
        <div style={{ border: '1px dashed #c8e6d4', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: '#2D6A4F', fontWeight: 600 }}>✓ {PT[lang].adFreeActiveLabel}</span>
        </div>
      )
    }
    return null
  }

  if (!ad) return null

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
              title={PT[lang].removeAds}
              style={{ background: 'none', border: '1px solid #ddd', borderRadius: 20, padding: '1px 7px', fontSize: 10, color: '#aaa', cursor: 'pointer', lineHeight: 1.6 }}
            >
              🚫 {PT[lang].adFree2}
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
              🚫 {PT[lang].adFree2}
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
            🚫 {PT[lang].adFree2}
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
