import { useState } from 'react'
import { getTranslations } from './data.js'
import { apiJoinGroup } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

const TYPE_STYLE = {
  public:  { bg: '#E8F5E9', color: '#2E7D32' },
  private: { bg: '#FFF3E0', color: '#E65100' },
  hidden:  { bg: '#F3E5F5', color: '#6A1B9A' },
}

export default function GroupCard({ group, lang, onNavigate }) {
  const t = getTranslations(lang)
  const g = t.groups || {}
  const [joined, setJoined] = useState(group.isMember || false)
  const [requested, setRequested] = useState(group.hasRequested || false)
  const [busy, setBusy] = useState(false)

  const coverSrc = group.coverUrl
    ? (group.coverUrl.startsWith('http') ? group.coverUrl : `${API_BASE}${group.coverUrl}`)
    : null

  const typeKey = group.type === 'hidden' ? 'hidden' : group.type === 'private' ? 'private' : 'public'
  const typeMeta = TYPE_STYLE[typeKey]
  const typeLabel = g.type?.[typeKey] || typeKey
  const memberCount = Number(group.memberCount) || 0

  const handleAction = async (e) => {
    e.stopPropagation()
    if (busy || joined || requested || group.type === 'hidden') return
    setBusy(true)
    const res = await apiJoinGroup(group.id)
    if (res !== null) {
      if (group.type === 'private') setRequested(true)
      else setJoined(true)
    }
    setBusy(false)
  }

  const s = {
    card: {
      background: '#fff',
      borderRadius: 14,
      border: '1px solid #E8E4DF',
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'box-shadow 0.15s',
      display: 'flex',
      flexDirection: 'column',
    },
    cover: { width: '100%', height: 110, objectFit: 'cover', display: 'block', flexShrink: 0 },
    coverPlaceholder: {
      width: '100%',
      height: 110,
      background: 'linear-gradient(135deg, #E8E4DF 0%, #CFC9C0 100%)',
      flexShrink: 0,
    },
    body: { padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
    header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    name: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', margin: 0, lineHeight: 1.3, flex: 1, minWidth: 0 },
    typePill: {
      fontSize: 10,
      fontWeight: 700,
      padding: '3px 8px',
      borderRadius: 20,
      background: typeMeta.bg,
      color: typeMeta.color,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    },
    meta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888', flexWrap: 'wrap' },
    categoryPill: {
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 20,
      background: '#F0EDE8',
      color: '#666',
    },
    desc: {
      fontSize: 13,
      color: '#555',
      lineHeight: 1.5,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      margin: 0,
    },
    footer: { marginTop: 'auto', paddingTop: 4 },
    actionBtn: {
      fontSize: 13,
      fontWeight: 700,
      padding: '7px 18px',
      borderRadius: 20,
      cursor: busy || joined || requested ? 'default' : 'pointer',
      border: joined || requested ? '1.5px solid #C7D2FE' : '1.5px solid #4338CA',
      background: joined || requested ? '#EEF2FF' : '#4338CA',
      color: joined || requested ? '#4338CA' : '#fff',
      opacity: busy ? 0.7 : 1,
      transition: 'background 0.15s, color 0.15s',
    },
    lockIcon: { fontSize: 22 },
  }

  const actionButton = () => {
    if (group.type === 'hidden') {
      return <span style={s.lockIcon} title={g.locked || typeLabel}>🔒</span>
    }
    if (joined) {
      return (
        <button style={s.actionBtn} disabled>
          {`✓ ${g.followingGroup || g.joined}`}
        </button>
      )
    }
    if (group.type === 'private') {
      return (
        <button style={s.actionBtn} onClick={handleAction} disabled={busy || requested}>
          {requested ? `✓ ${g.requestSent}` : g.requestAccess}
        </button>
      )
    }
    return (
      <button style={s.actionBtn} onClick={handleAction} disabled={busy}>
        {g.followGroup || g.join}
      </button>
    )
  }

  return (
    <div
      style={s.card}
      onClick={() => onNavigate?.(`/groups/${group.slug}`)}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {coverSrc
        ? <img src={coverSrc} alt="" style={s.cover} />
        : <div style={s.coverPlaceholder} />
      }
      <div style={s.body}>
        <div style={s.header}>
          <h3 style={s.name}>{group.name}</h3>
          <span style={s.typePill}>{typeLabel}</span>
        </div>
        <div style={s.meta}>
          {group.category && <span style={s.categoryPill}>{group.category}</span>}
          <span>👥 {memberCount} {memberCount === 1 ? g.member : g.members}</span>
        </div>
        {group.description && <p style={s.desc}>{group.description}</p>}
        <div style={s.footer}>{actionButton()}</div>
      </div>
    </div>
  )
}
