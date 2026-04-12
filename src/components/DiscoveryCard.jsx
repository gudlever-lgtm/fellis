import { useState } from 'react'
import { getTranslations, nameToColor, getInitials } from '../data.js'

const TYPE_ICONS = { user: '👤', business: '🏢', group: '💬' }

export default function DiscoveryCard({ suggestion, lang }) {
  const t = getTranslations(lang)
  const [followed, setFollowed] = useState(false)
  const [busy, setBusy] = useState(false)

  const { id, type, name, avatar, description_da, description_en, follower_count } = suggestion
  const description = lang === 'da' ? description_da : (description_en || description_da)
  const truncated = description && description.length > 100
    ? description.slice(0, 100).trimEnd() + '…'
    : description

  const typeLabel = type === 'user'
    ? t.discoveryTypeUser
    : type === 'business'
      ? t.discoveryTypeBusiness
      : t.discoveryTypeGroup

  const followerLabel = (() => {
    const n = Number(follower_count) || 0
    if (type === 'group') return `${n} ${n === 1 ? t.discoveryMember : t.discoveryMembers}`
    return `${n} ${n === 1 ? t.discoveryFollower : t.discoveryFollowers}`
  })()

  const handleFollow = async () => {
    if (followed || busy) return
    setBusy(true)
    try {
      if (type === 'user') {
        await fetch(`/api/friends/request/${id}`, { method: 'POST', credentials: 'same-origin' })
      } else if (type === 'business') {
        await fetch(`/api/businesses/${id}/follow`, { method: 'POST', credentials: 'same-origin' })
      } else {
        await fetch(`/api/groups/${id}/join`, { method: 'POST', credentials: 'same-origin' })
      }
      setFollowed(true)
    } catch { /* network */ }
    setBusy(false)
  }

  const s = {
    card: {
      background: 'linear-gradient(135deg, #f0faf4 0%, #fff 100%)',
      border: '2px solid #52B788',
      borderRadius: 14,
      padding: '14px 16px',
    },
    badge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 11,
      fontWeight: 700,
      color: '#2D6A4F',
      background: '#d4edda',
      padding: '3px 9px',
      borderRadius: 20,
      marginBottom: 10,
    },
    header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: type === 'group' ? 10 : '50%',
      background: nameToColor(name || ''),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      fontWeight: 700,
      color: '#fff',
      flexShrink: 0,
      overflow: 'hidden',
    },
    name: { fontWeight: 700, fontSize: 14, color: '#1a1a1a', lineHeight: 1.2 },
    typePill: {
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 600,
      color: '#555',
      background: '#f0f0ec',
      borderRadius: 20,
      padding: '2px 7px',
      marginTop: 2,
    },
    description: { fontSize: 13, color: '#555', lineHeight: 1.5, marginBottom: 10 },
    footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    followers: { fontSize: 12, color: '#aaa' },
    btn: {
      padding: '6px 16px',
      borderRadius: 8,
      border: '1.5px solid #2D6A4F',
      background: followed ? '#2D6A4F' : 'transparent',
      color: followed ? '#fff' : '#2D6A4F',
      fontSize: 13,
      fontWeight: 700,
      cursor: followed || busy ? 'default' : 'pointer',
      transition: 'all 0.15s',
      opacity: busy ? 0.7 : 1,
    },
  }

  return (
    <div style={s.card}>
      <div style={s.badge}>
        {t.discoveryBadge}
      </div>
      <div style={s.header}>
        <div style={s.avatar}>
          {avatar
            ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : type === 'group'
              ? TYPE_ICONS.group
              : getInitials(name || '')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.name}>{name}</div>
          <span style={s.typePill}>{TYPE_ICONS[type]} {typeLabel}</span>
        </div>
      </div>
      {truncated && <div style={s.description}>{truncated}</div>}
      <div style={s.footer}>
        <span style={s.followers}>{followerLabel}</span>
        <button style={s.btn} onClick={handleFollow} disabled={followed || busy}>
          {followed ? t.discoveryFollowing : t.discoveryFollow}
        </button>
      </div>
    </div>
  )
}
