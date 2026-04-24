import { useState, useEffect } from 'react'
import PostComposer from './PostComposer.jsx'
import {
  apiGetGroup, apiGetGroupPosts, apiCreateGroupPost, apiDeleteGroupPost,
  apiPinGroupPost, apiReactToGroupPost, apiLeaveGroup, apiJoinGroup,
  apiGetGroupMembers, apiUpdateGroupMemberRole, apiRemoveGroupMember,
  apiGetGroupEvents, apiRsvpGroupEvent,
} from './api.js'
import { getTranslations, nameToColor, getInitials } from './data.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

const TYPE_STYLE = {
  public:  { bg: '#E8F5E9', color: '#2E7D32' },
  private: { bg: '#FFF3E0', color: '#E65100' },
  hidden:  { bg: '#F3E5F5', color: '#6A1B9A' },
}

const REACTIONS = ['like', 'love', 'insightful']
const REACTION_EMOJI = { like: '👍', love: '❤️', insightful: '💡' }

const ROLE_STYLE = {
  admin:     { bg: '#FEE2E2', color: '#991B1B' },
  moderator: { bg: '#FEF3C7', color: '#92400E' },
  member:    { bg: '#F3F4F6', color: '#6B7280' },
}

const RSVP_STATUSES = ['going', 'maybe', 'notGoing']

function fmtDate(dateStr, lang) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(
    lang === 'da' ? 'da-DK' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  )
}

function fmtTime(dateStr, lang) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return lang === 'da' ? 'Lige nu' : 'Just now'
  if (diff < 3600) { const m = Math.floor(diff / 60); return lang === 'da' ? `${m}m siden` : `${m}m ago` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return lang === 'da' ? `${h}t siden` : `${h}h ago` }
  const d = Math.floor(diff / 86400)
  return lang === 'da' ? `${d}d siden` : `${d}d ago`
}

export default function GroupDetail({ slug, lang, currentUser, onNavigate }) {
  const t = getTranslations(lang)
  const g = t?.groups || {}

  const [group, setGroup] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [tab, setTab] = useState('feed')
  const [posts, setPosts] = useState([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const [composerMedia, setComposerMedia] = useState(null)
  const [composerPreview, setComposerPreview] = useState(null)
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setGroup(null)
    setPosts([])
    apiGetGroup(slug).then(data => {
      if (cancelled) return
      if (!data) { setLoadState('not_found'); return }
      if (data.error === 'forbidden') { setLoadState('forbidden'); return }
      if (data.error) { setLoadState('not_found'); return }
      setGroup(data)
      setLoadState('ready')
    })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (loadState !== 'ready' || !group) return
    setFeedLoading(true)
    apiGetGroupPosts(group.id).then(data => {
      setFeedLoading(false)
      if (data?.posts) setPosts(data.posts)
    })
  }, [loadState, group?.id])

  const handleJoin = async () => {
    if (!group) return
    const res = await apiJoinGroup(group.id)
    if (res !== null) {
      setGroup(prev => ({
        ...prev,
        member_count: prev.member_count + 1,
        membership: { isMember: true, role: 'member', hasRequested: false },
      }))
    }
  }

  const handleRequestAccess = () => {
    setGroup(prev => ({
      ...prev,
      membership: { ...prev.membership, hasRequested: true },
    }))
  }

  const handleLeave = async () => {
    if (!window.confirm(g.leaveConfirm)) return
    const res = await apiLeaveGroup(group.id)
    if (res !== null) onNavigate?.('/groups')
  }

  const handleMediaChange = (e) => {
    const file = e.target.files?.[0] || null
    if (composerPreview) URL.revokeObjectURL(composerPreview)
    if (file) {
      setComposerMedia(file)
      setComposerPreview(URL.createObjectURL(file))
    } else {
      setComposerMedia(null)
      setComposerPreview(null)
    }
  }

  const handleCreatePost = async () => {
    if (!composerText.trim() || composerSubmitting) return
    setComposerSubmitting(true)
    const res = await apiCreateGroupPost(group.id, composerText.trim(), composerMedia || undefined)
    setComposerSubmitting(false)
    if (res) {
      setPosts(prev => [res, ...prev])
      setComposerText('')
      if (composerPreview) { URL.revokeObjectURL(composerPreview); setComposerPreview(null) }
      setComposerMedia(null)
    }
  }

  const handleDeletePost = async (postId) => {
    if (!window.confirm(g.confirmDeletePost)) return
    const res = await apiDeleteGroupPost(group.id, postId)
    if (res !== null) setPosts(prev => prev.filter(p => p.id !== postId))
  }

  const handlePinPost = async (post) => {
    const newPinned = !post.is_pinned
    const res = await apiPinGroupPost(group.id, post.id, newPinned)
    if (res !== null) {
      setPosts(prev =>
        prev
          .map(p => {
            if (newPinned) return { ...p, is_pinned: p.id === post.id ? 1 : 0 }
            return p.id === post.id ? { ...p, is_pinned: 0 } : p
          })
          .sort((a, b) => b.is_pinned - a.is_pinned || new Date(b.created_at) - new Date(a.created_at))
      )
    }
  }

  const handleReact = async (post, reaction) => {
    const nextReaction = post.my_reaction === reaction ? null : reaction
    setPosts(prev => prev.map(p => {
      if (p.id !== post.id) return p
      const r = { ...p.reactions }
      if (p.my_reaction) {
        r[p.my_reaction] = Math.max(0, (r[p.my_reaction] || 1) - 1)
        if (!r[p.my_reaction]) delete r[p.my_reaction]
      }
      if (nextReaction) r[nextReaction] = (r[nextReaction] || 0) + 1
      return { ...p, my_reaction: nextReaction, reactions: r }
    }))
    await apiReactToGroupPost(group.id, post.id, reaction)
  }

  useEffect(() => {
    if (tab !== 'members' || loadState !== 'ready' || !group) return
    setMembersLoading(true)
    apiGetGroupMembers(group.id).then(data => {
      setMembersLoading(false)
      if (data?.members) setMembers(data.members)
    })
  }, [tab, loadState, group?.id])

  useEffect(() => {
    if (tab !== 'events' || loadState !== 'ready' || !group) return
    setEventsLoading(true)
    apiGetGroupEvents(group.slug).then(data => {
      setEventsLoading(false)
      if (data?.events) setEvents(data.events)
    })
  }, [tab, loadState, group?.id, group?.slug])

  const handlePromote = async (userId) => {
    const res = await apiUpdateGroupMemberRole(group.id, userId, 'moderator')
    if (res) setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: 'moderator' } : m))
  }

  const handleDemote = async (userId) => {
    const res = await apiUpdateGroupMemberRole(group.id, userId, 'member')
    if (res) setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: 'member' } : m))
  }

  const handleRemoveMember = async (userId) => {
    if (!window.confirm(g.removeMember)) return
    const res = await apiRemoveGroupMember(group.id, userId)
    if (res) {
      setMembers(prev => prev.filter(m => m.id !== userId))
      setGroup(prev => ({ ...prev, member_count: Math.max(0, prev.member_count - 1) }))
    }
  }

  const handleRsvp = async (ev, status) => {
    const prev = ev.my_rsvp
    const wasGoing = prev === 'going'
    const willBeGoing = status === 'going'
    const goingDelta = (willBeGoing ? 1 : 0) - (wasGoing ? 1 : 0)
    setEvents(prevEvs => prevEvs.map(e =>
      e.id !== ev.id ? e : { ...e, my_rsvp: status, going_count: Number(e.going_count) + goingDelta }
    ))
    await apiRsvpGroupEvent(group.slug, ev.id, status)
  }

  // ── Status screens ────────────────────────────────────────────────────────

  if (loadState === 'loading') {
    return <div style={s.center}><span style={s.loadingText}>{g.loading}</span></div>
  }

  if (loadState === 'forbidden') {
    return (
      <div style={s.center}>
        <div style={s.statusBox}>
          <span style={{ fontSize: 36 }}>🔒</span>
          <p style={s.statusText}>{g.forbidden}</p>
          <button style={s.backBtn} onClick={() => onNavigate?.('/groups')}>{g.back}</button>
        </div>
      </div>
    )
  }

  if (loadState === 'not_found' || !group) {
    return (
      <div style={s.center}>
        <div style={s.statusBox}>
          <p style={s.statusText}>{g.notFound}</p>
          <button style={s.backBtn} onClick={() => onNavigate?.('/groups')}>{g.back}</button>
        </div>
      </div>
    )
  }

  // ── Group ready ───────────────────────────────────────────────────────────

  const { membership } = group
  const isAdmin = membership.role === 'admin'
  const isMod = membership.role === 'admin' || membership.role === 'moderator'

  const typeKey = group.type || 'public'
  const typeMeta = TYPE_STYLE[typeKey] || TYPE_STYLE.public
  const typeLabel = g.type?.[typeKey] || typeKey

  const coverSrc = group.cover_url
    ? (group.cover_url.startsWith('http') ? group.cover_url : `${API_BASE}${group.cover_url}`)
    : null

  const TABS = ['feed', 'members', 'events', 'polls', 'about']
  const TAB_LABEL = {
    feed: g.feed,
    members: g.membersTab,
    events: g.events,
    polls: g.polls,
    about: g.about,
  }

  const composerT = {
    composer: {
      posting_in: { social: '' },
      placeholder: g.writePost || '',
      submit: g.post || '',
    },
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.headerWrap}>
        {coverSrc
          ? <img src={coverSrc} alt="" style={s.cover} />
          : <div style={s.coverPlaceholder} />
        }
        <button style={s.backBtnFloat} onClick={() => onNavigate?.('/groups')}>
          ← {g.back}
        </button>
        <div style={s.headerBody}>
          <div style={s.headerRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.headerTop}>
                <h1 style={s.groupName}>{group.name}</h1>
                <span style={{ ...s.typePill, background: typeMeta.bg, color: typeMeta.color }}>
                  {typeLabel}
                </span>
              </div>
              <div style={s.headerMeta}>
                {group.category && (
                  <span style={s.categoryPill}>
                    {g.category?.[group.category] || group.category}
                  </span>
                )}
                <span style={s.metaText}>
                  {'👥 '}{group.member_count}{' '}{group.member_count === 1 ? g.member : g.members}
                </span>
              </div>
            </div>
            <div style={s.headerActions}>
              {isAdmin && (
                <button style={s.settingsBtn} onClick={() => onNavigate?.(`/groups/${slug}/settings`)}>
                  {'⚙️ '}{g.settings}
                </button>
              )}
              {membership.isMember ? (
                <button style={s.leaveBtn} onClick={handleLeave}>{g.leave}</button>
              ) : membership.hasRequested ? (
                <button style={{ ...s.joinBtn, opacity: 0.6 }} disabled>{g.requestSent}</button>
              ) : group.type === 'public' ? (
                <button style={s.joinBtn} onClick={handleJoin}>{g.join}</button>
              ) : group.type === 'private' ? (
                <button style={s.joinBtn} onClick={handleRequestAccess}>{g.requestAccess}</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={s.tabBar}>
        {TABS.map(key => (
          <button
            key={key}
            style={{ ...s.tabBtn, ...(tab === key ? s.tabActive : {}) }}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key] || key}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={s.tabContent}>
        {tab === 'feed' && (
          <div>
            {membership.isMember && (
              <PostComposer
                activeContext="social"
                t={composerT}
                lang={lang}
                value={composerText}
                onChange={setComposerText}
                onSubmit={handleCreatePost}
                submitting={composerSubmitting}
              >
                <div style={s.mediaRow}>
                  <label style={s.mediaLabel}>
                    {'📎'}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      style={{ display: 'none' }}
                      onChange={handleMediaChange}
                    />
                  </label>
                  {composerPreview && (
                    <div style={s.previewWrap}>
                      <img src={composerPreview} alt="" style={s.previewImg} />
                      <button
                        style={s.removeMedia}
                        onClick={() => {
                          URL.revokeObjectURL(composerPreview)
                          setComposerMedia(null)
                          setComposerPreview(null)
                        }}
                      >
                        {'×'}
                      </button>
                    </div>
                  )}
                </div>
              </PostComposer>
            )}

            {membership.hasRequested && !membership.isMember && (
              <div style={s.pendingBanner}>{g.pendingApproval}</div>
            )}

            {feedLoading ? (
              <div style={s.feedEmpty}>{g.loading}</div>
            ) : posts.length === 0 ? (
              <div style={s.feedEmpty}>{g.noFeed}</div>
            ) : posts.map(post => {
              const text = lang === 'da' ? post.text_da : (post.text_en || post.text_da)
              const isOwn = post.author_id === currentUser?.id
              const canDelete = isOwn || isMod
              const canPin = isMod
              let media = []
              if (post.media) {
                try { media = JSON.parse(post.media) } catch {}
                if (!Array.isArray(media)) media = []
              }
              return (
                <div key={post.id} style={{ ...s.postCard, ...(post.is_pinned ? s.pinnedCard : {}) }}>
                  {post.is_pinned && <div style={s.pinLabel}>{'📌'}</div>}
                  <div style={s.postHeader}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: nameToColor(post.author_name), color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700,
                    }}>
                      {getInitials(post.author_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.authorName}>{post.author_name}</div>
                      <div style={s.postTime}>{fmtTime(post.created_at, lang)}</div>
                    </div>
                    <div style={s.postMenuRow}>
                      {canPin && (
                        <button
                          style={s.iconBtn}
                          title={post.is_pinned ? g.unpinPost : g.pinPost}
                          onClick={() => handlePinPost(post)}
                        >
                          {post.is_pinned ? '📌' : '📍'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          style={s.iconBtn}
                          title={g.deletePost}
                          onClick={() => handleDeletePost(post.id)}
                        >
                          {'🗑️'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={s.postText}>{text}</p>
                  {media.length > 0 && (
                    <div style={s.mediaGrid}>
                      {media.map((url, i) => (
                        <img
                          key={i}
                          src={url.startsWith('http') ? url : `${API_BASE}${url}`}
                          alt=""
                          style={s.mediaImg}
                        />
                      ))}
                    </div>
                  )}
                  <div style={s.reactRow}>
                    {REACTIONS.map(r => {
                      const count = post.reactions?.[r] || 0
                      const active = post.my_reaction === r
                      return (
                        <button
                          key={r}
                          style={{ ...s.reactBtn, ...(active ? s.reactActive : {}) }}
                          title={g[`react${r.charAt(0).toUpperCase() + r.slice(1)}`] || r}
                          onClick={() => handleReact(post, r)}
                        >
                          {REACTION_EMOJI[r]}{count > 0 ? ` ${count}` : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {tab === 'members' && (
          <div>
            {membersLoading ? (
              <div style={s.feedEmpty}>{g.loading}</div>
            ) : members.length === 0 ? (
              <div style={s.feedEmpty}>{g.noMembers}</div>
            ) : members.map(member => {
              const isMe = member.id === currentUser?.id
              const roleMeta = ROLE_STYLE[member.role] || ROLE_STYLE.member
              const roleLabel = g.role?.[member.role] || member.role
              const canPromote = isAdmin && !isMe && member.role === 'member'
              const canDemote = isAdmin && !isMe && member.role === 'moderator'
              const canRemove = !isMe && member.role !== 'admin' && (
                isAdmin || (isMod && member.role === 'member')
              )
              return (
                <div key={member.id} style={s.memberRow}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                    background: nameToColor(member.name), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, overflow: 'hidden',
                  }}>
                    {member.avatar_url
                      ? <img src={member.avatar_url.startsWith('http') ? member.avatar_url : `${API_BASE}${member.avatar_url}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(member.name)
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.memberName}>
                      {member.name}
                      {isMe && <span style={s.meTag}> (me)</span>}
                    </div>
                    <span style={{ ...s.roleBadge, background: roleMeta.bg, color: roleMeta.color }}>
                      {roleLabel}
                    </span>
                  </div>
                  {(canPromote || canDemote || canRemove) && (
                    <div style={s.memberActions}>
                      {canPromote && (
                        <button style={s.memberBtn} onClick={() => handlePromote(member.id)}>
                          {g.promote}
                        </button>
                      )}
                      {canDemote && (
                        <button style={s.memberBtn} onClick={() => handleDemote(member.id)}>
                          {g.demote}
                        </button>
                      )}
                      {canRemove && (
                        <button style={{ ...s.memberBtn, ...s.memberBtnDanger }} onClick={() => handleRemoveMember(member.id)}>
                          {g.removeMember}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'events' && (
          <div>
            {eventsLoading ? (
              <div style={s.feedEmpty}>{g.loading}</div>
            ) : events.length === 0 ? (
              <div style={s.feedEmpty}>{g.noEvents}</div>
            ) : events.map(ev => {
              const goingCount = Number(ev.going_count) || 0
              return (
                <div key={ev.id} style={s.eventCard}>
                  <div style={s.eventTitle}>{ev.title}</div>
                  <div style={s.eventMeta}>
                    {ev.date && <span>{'📅 '}{fmtDate(ev.date, lang)}</span>}
                    {ev.location && <span>{'📍 '}{ev.location}</span>}
                    {goingCount > 0 && (
                      <span style={s.goingBadge}>
                        {goingCount}{' '}{g.rsvpGoing.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <div style={s.rsvpRow}>
                    {RSVP_STATUSES.map(status => {
                      const active = ev.my_rsvp === status
                      const label = g[`rsvp${status.charAt(0).toUpperCase()}${status.slice(1)}`] || status
                      return (
                        <button
                          key={status}
                          style={{ ...s.rsvpBtn, ...(active ? s.rsvpBtnActive : {}) }}
                          onClick={() => handleRsvp(ev, status)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {(tab === 'polls' || tab === 'about') && <div />}
      </div>
    </div>
  )
}

const s = {
  page: { maxWidth: 680, margin: '0 auto', paddingBottom: 48 },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, padding: 24 },
  statusBox: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  loadingText: { fontSize: 14, color: '#aaa' },
  statusText: { fontSize: 15, color: '#555', margin: 0 },
  backBtn: { fontSize: 13, padding: '8px 20px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' },
  headerWrap: { position: 'relative' },
  cover: { width: '100%', height: 200, objectFit: 'cover', display: 'block' },
  coverPlaceholder: { width: '100%', height: 200, background: 'linear-gradient(135deg, #E8E4DF 0%, #CFC9C0 100%)' },
  backBtnFloat: {
    position: 'absolute', top: 12, left: 12,
    fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 20,
    border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer',
  },
  headerBody: { padding: '16px 20px 12px', background: '#fff', borderBottom: '1px solid #E8E4DF' },
  headerRow: { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  headerTop: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  groupName: { fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0, lineHeight: 1.2 },
  typePill: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  categoryPill: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#F0EDE8', color: '#666' },
  metaText: { fontSize: 12, color: '#888' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  joinBtn: { fontSize: 13, fontWeight: 700, padding: '7px 18px', borderRadius: 20, border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff', cursor: 'pointer' },
  leaveBtn: { fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 20, border: '1.5px solid #D1D5DB', background: '#fff', color: '#666', cursor: 'pointer' },
  settingsBtn: { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, border: '1.5px solid #E8E4DF', background: '#F9F7F5', color: '#555', cursor: 'pointer' },
  tabBar: { display: 'flex', gap: 0, padding: '0 20px', background: '#fff', borderBottom: '1px solid #E8E4DF', overflowX: 'auto' },
  tabBtn: { fontSize: 13, fontWeight: 600, padding: '10px 14px', border: 'none', borderBottom: '2px solid transparent', background: 'none', color: '#888', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.15s' },
  tabActive: { color: '#4338CA', borderBottom: '2px solid #4338CA' },
  tabContent: { padding: '16px 20px' },
  feedEmpty: { textAlign: 'center', color: '#bbb', fontSize: 14, padding: '40px 0' },
  pendingBanner: { fontSize: 13, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', marginBottom: 16 },
  postCard: { background: '#fff', borderRadius: 12, border: '1px solid #E8E4DF', padding: '14px 16px', marginBottom: 12 },
  pinnedCard: { border: '1px solid #C7D2FE', background: '#F5F3FF' },
  pinLabel: { fontSize: 11, color: '#4338CA', marginBottom: 6, fontWeight: 700 },
  postHeader: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  authorName: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  postTime: { fontSize: 11, color: '#bbb', marginTop: 2 },
  postMenuRow: { display: 'flex', gap: 2, marginLeft: 'auto', flexShrink: 0 },
  iconBtn: { fontSize: 15, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', opacity: 0.65, lineHeight: 1 },
  postText: { fontSize: 14, color: '#333', lineHeight: 1.6, margin: '0 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  mediaGrid: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  mediaImg: { maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'cover' },
  reactRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  reactBtn: { fontSize: 13, padding: '4px 10px', borderRadius: 20, border: '1px solid #E8E4DF', background: '#fff', cursor: 'pointer', color: '#555' },
  reactActive: { background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4338CA' },
  mediaRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  mediaLabel: { fontSize: 18, cursor: 'pointer', padding: '4px 8px', borderRadius: 8, border: '1px solid #E8E4DF', background: '#F9F7F5', userSelect: 'none' },
  previewWrap: { position: 'relative', display: 'inline-block' },
  previewImg: { height: 60, borderRadius: 6, objectFit: 'cover' },
  removeMedia: {
    position: 'absolute', top: -5, right: -5,
    width: 18, height: 18, borderRadius: '50%',
    border: 'none', background: '#333', color: '#fff',
    fontSize: 12, cursor: 'pointer', lineHeight: 1, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  // Members tab
  memberRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 0', borderBottom: '1px solid #F0EDE8',
  },
  memberName: { fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 },
  meTag: { fontWeight: 400, color: '#aaa', fontSize: 12 },
  roleBadge: {
    display: 'inline-block', fontSize: 11, fontWeight: 700,
    padding: '2px 8px', borderRadius: 20,
  },
  memberActions: { display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' },
  memberBtn: {
    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
    border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  memberBtnDanger: { borderColor: '#FECACA', color: '#DC2626', background: '#FFF5F5' },
  // Events tab
  eventCard: {
    background: '#fff', borderRadius: 12, border: '1px solid #E8E4DF',
    padding: '14px 16px', marginBottom: 12,
  },
  eventTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 },
  eventMeta: {
    display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12,
    fontSize: 13, color: '#666',
  },
  goingBadge: {
    fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
    background: '#E8F5E9', color: '#2E7D32',
  },
  rsvpRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  rsvpBtn: {
    fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 20,
    border: '1.5px solid #D1D5DB', background: '#fff', color: '#555', cursor: 'pointer',
    transition: 'all 0.15s',
  },
  rsvpBtnActive: { background: '#4338CA', borderColor: '#4338CA', color: '#fff' },
}
