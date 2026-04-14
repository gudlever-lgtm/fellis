import { useState } from 'react'
import { nameToColor, getInitials } from '../data.js'
import { apiFollowBusiness, apiUnfollowBusiness } from '../api.js'
import BusinessBadge from './BusinessBadge.jsx'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function BusinessCard({ biz, lang, t, onViewProfile }) {
  const [following, setFollowing] = useState(biz.isFollowing)
  const [followerCount, setFollowerCount] = useState(biz.followerCount || 0)
  const [busy, setBusy] = useState(false)

  const avatarSrc = biz.avatarUrl
    ? (biz.avatarUrl.startsWith('http') ? biz.avatarUrl : `${API_BASE}${biz.avatarUrl}`)
    : null

  const handleFollow = async (e) => {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    if (following) {
      const res = await apiUnfollowBusiness(biz.id)
      if (res !== null) { setFollowing(false); setFollowerCount(c => Math.max(0, c - 1)) }
    } else {
      const res = await apiFollowBusiness(biz.id)
      if (res !== null) { setFollowing(true); setFollowerCount(c => c + 1) }
    }
    setBusy(false)
  }

  const s = {
    card: {
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #E8E4DF',
      padding: '16px',
      cursor: 'pointer',
      transition: 'box-shadow 0.15s',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
    header: { display: 'flex', alignItems: 'flex-start', gap: 12 },
    avatar: {
      width: 48, height: 48, borderRadius: 12, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18, fontWeight: 700, color: '#fff',
      background: nameToColor(biz.name),
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 },
    info: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', margin: 0, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    handle: { fontSize: 12, color: '#888', marginTop: 1 },
    bio: { fontSize: 13, color: '#555', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
    meta: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#888' },
    followBtn: {
      fontSize: 12, fontWeight: 700,
      padding: '5px 14px', borderRadius: 20,
      cursor: busy ? 'default' : 'pointer',
      border: following ? '1.5px solid #C7D2FE' : '1.5px solid #4338CA',
      background: following ? '#EEF2FF' : '#4338CA',
      color: following ? '#4338CA' : '#fff',
      flexShrink: 0,
      transition: 'background 0.15s, color 0.15s',
      opacity: busy ? 0.7 : 1,
    },
  }

  const bio = biz.bio?.[lang] || biz.bio?.da || ''

  return (
    <div
      style={s.card}
      onClick={() => onViewProfile?.(biz)}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={s.header}>
        <div style={s.avatar}>
          {avatarSrc ? <img src={avatarSrc} alt="" style={s.avatarImg} /> : getInitials(biz.name)}
        </div>
        <div style={s.info}>
          <p style={s.name}>
            {biz.name}
            {biz.isVerified && <span style={{ fontSize: 11, color: '#6366F1', marginLeft: 5, fontWeight: 700 }}>✓</span>}
          </p>
          {biz.handle && <p style={s.handle}>@{biz.handle.replace(/^@/, '')}</p>}
          {biz.businessCategory && (
            <div style={{ marginTop: 4 }}>
              <BusinessBadge lang={lang} size="xs" />
              {' '}
              <span style={{ fontSize: 11, color: '#666' }}>{biz.businessCategory}</span>
            </div>
          )}
        </div>
      </div>

      {bio && <p style={s.bio}>{bio}</p>}

      <div style={s.footer}>
        <div style={s.meta}>
          <span>👥 {followerCount} {t.followers}</span>
          {biz.communityScore >= 10 && (
            <span title={t.communityScore}>⭐ {biz.communityScore}</span>
          )}
        </div>
        <button style={s.followBtn} onClick={handleFollow}>
          {following ? t.unfollowBusiness : t.followBusiness}
        </button>
      </div>
    </div>
  )
}
