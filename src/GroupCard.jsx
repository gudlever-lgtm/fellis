import { useState } from 'react'
import { getTranslations } from './data.js'
import { apiJoinGroup, apiFollowGroup, apiUnfollowGroup } from './api.js'

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
  const [following, setFollowing] = useState(group.isFollowing || false)
  const [followerCount, setFollowerCount] = useState(Number(group.followerCount) || 0)
  const [followBusy, setFollowBusy] = useState(false)

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

  const handleFollow = async (e) => {
    e.stopPropagation()
    if (followBusy) return
    setFollowBusy(true)
    if (following) {
      const res = await apiUnfollowGroup(group.id)
      if (res !== null) { setFollowing(false); setFollowerCount(c => Math.max(0, c - 1)) }
    } else {
      const res = await apiFollowGroup(group.id)
      if (res !== null) { setFollowing(true); setFollowerCount(c => c + 1) }
    }
    setFollowBusy(false)
  }

  const actionButton = () => {
    if (group.type === 'hidden') {
      return <span style={{ fontSize: 22 }} title={g.locked || typeLabel}>🔒</span>
    }
    if (joined) {
      return (
        <button className="gc-action-btn" style={actionBtnStyle()} disabled>
          {`✓ ${g.joined}`}
        </button>
      )
    }
    if (group.type === 'private') {
      return (
        <button className="gc-action-btn" style={actionBtnStyle()} onClick={handleAction} disabled={busy || requested}>
          {requested ? `✓ ${g.requestSent}` : g.requestAccess}
        </button>
      )
    }
    return (
      <button className="gc-action-btn" style={actionBtnStyle()} onClick={handleAction} disabled={busy}>
        {g.followGroup || g.join}
      </button>
    )
  }

  const actionBtnStyle = () => ({
    cursor: busy || joined || requested ? 'default' : 'pointer',
    border: joined || requested ? '1.5px solid #C7D2FE' : '1.5px solid #4338CA',
    background: joined || requested ? '#EEF2FF' : '#4338CA',
    color: joined || requested ? '#4338CA' : '#fff',
    opacity: busy ? 0.7 : 1,
  })

  const followBtnStyle = () => ({
    cursor: followBusy ? 'default' : 'pointer',
    border: following ? '1.5px solid #C7D2FE' : '1.5px solid #6366F1',
    background: following ? '#EEF2FF' : '#fff',
    color: following ? '#4338CA' : '#6366F1',
    opacity: followBusy ? 0.7 : 1,
  })

  return (
    <div
      className="gc-card"
      onClick={() => onNavigate?.(`/groups/${group.slug}`)}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {coverSrc
        ? <img src={coverSrc} alt="" className="gc-cover" />
        : <div className="gc-cover-placeholder" />
      }
      <div className="gc-body">
        <div className="gc-header">
          <h3 className="gc-name">{group.name}</h3>
          <span className="gc-type-pill" style={{ background: typeMeta.bg, color: typeMeta.color }}>{typeLabel}</span>
        </div>
        <div className="gc-meta">
          {group.category && <span className="gc-cat-pill">{group.category}</span>}
          <span>👥 {memberCount} {memberCount === 1 ? g.member : g.members}</span>
          {followerCount > 0 && (
            <span>· {followerCount} {g.followers || 'followers'}</span>
          )}
        </div>
        {group.description && <p className="gc-desc">{group.description}</p>}
        <div className="gc-footer">
          <div className="gc-footer-actions">
            {!joined && !following && actionButton()}
            {group.type !== 'hidden' && !joined && (
              <button
                className="gc-follow-btn"
                style={followBtnStyle()}
                onClick={handleFollow}
                disabled={followBusy}
              >
                {following ? `✓ ${g.unfollowGroup || g.followingGroup}` : `+ ${g.followGroup || 'Follow'}`}
              </button>
            )}
            {joined && actionButton()}
          </div>
        </div>
      </div>
    </div>
  )
}
