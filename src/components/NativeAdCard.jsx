import { useEffect, useRef } from 'react'
import { apiTrackPlatformAd } from '../api.js'

/**
 * NativeAdCard — renders a single native ad styled like organic feed content.
 * Fires impression on mount. Parent is responsible for fetching the ad.
 *
 * Props:
 *   ad   { id, title, image_url, link_url, target_url, body }
 */
export default function NativeAdCard({ ad }) {
  const impressedRef = useRef(false)

  useEffect(() => {
    if (!ad || impressedRef.current) return
    impressedRef.current = true
    apiTrackPlatformAd(ad.id, 'impression').catch(() => {})
  }, [ad])

  if (!ad) return null

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
        borderRadius: 12,
        padding: '16px 20px',
        margin: '8px 0',
        cursor: 'pointer',
        position: 'relative',
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      {/* Sponsoreret label — top-right, subtle */}
      <span style={{
        position: 'absolute', top: 10, right: 14,
        fontSize: 10, color: '#aaa', fontWeight: 600, letterSpacing: 0.5,
        background: '#f5f5f5', borderRadius: 4, padding: '2px 6px',
      }}>
        Sponsoreret
      </span>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {ad.image_url && (
          <img
            src={ad.image_url}
            alt=""
            style={{ width: 72, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#2D3436', paddingRight: 60 }}>{ad.title}</div>
          {ad.body && (
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {ad.body}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
