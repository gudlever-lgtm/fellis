import { useState, useEffect, useRef } from 'react'
import MediaPickerButton from './components/MediaPickerButton.jsx'
import LocationAutocomplete from './components/LocationAutocomplete.jsx'
import {
  apiGetGroup, apiGetGroupPosts, apiCreateGroupPost, apiDeleteGroupPost,
  apiPinGroupPost, apiReactToGroupPost, apiLeaveGroup, apiJoinGroup,
  apiGetGroupMembers, apiUpdateGroupMemberRole, apiRemoveGroupMember,
  apiGetGroupPendingMembers, apiApproveGroupMember, apiRejectGroupMember,
  apiGetGroupEvents, apiCreateGroupEvent, apiRsvpGroupEvent,
  apiGetGroupPolls, apiCreateGroupPoll, apiVoteGroupPoll, apiGetGroupInviteLink,
  apiMuteConversation,
  apiGetGroupModerationReports, apiDismissGroupReport,
  apiPreflightPost,
  apiFollowGroup, apiUnfollowGroup,
  apiReportContent,
} from './api.js'
import { getTranslations, nameToColor, getInitials } from './data.js'
import { getLocale } from './utils/dateFormat.js'

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
    getLocale(lang),
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
  const [groupFollowing, setGroupFollowing] = useState(false)
  const [groupFollowerCount, setGroupFollowerCount] = useState(0)
  const [groupFollowBusy, setGroupFollowBusy] = useState(false)
  const [tab, setTab] = useState('feed')
  const [posts, setPosts] = useState([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [composerMedia, setComposerMedia] = useState(null)
  const [composerPreviews, setComposerPreviews] = useState([])
  const composerTextareaRef = useRef(null)
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [pendingMembers, setPendingMembers] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [polls, setPolls] = useState([])
  const [pollsLoading, setPollsLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState(null)
  const [copyState, setCopyState] = useState(false)
  const [keywordWarning, setKeywordWarning] = useState(null)
  const [muteOpen, setMuteOpen] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [eventSaving, setEventSaving] = useState(false)
  const [showPollForm, setShowPollForm] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollSaving, setPollSaving] = useState(false)
  const [modReports, setModReports] = useState([])
  const [modLoading, setModLoading] = useState(false)
  const [reportTarget, setReportTarget] = useState(null) // { type: 'post'|'group', id: number } | null
  const [redFlagStatus, setRedFlagStatus] = useState('idle') // idle | submitting | done | duplicate
  const [redFlagReason, setRedFlagReason] = useState('')
  const [redFlagDetails, setRedFlagDetails] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setGroup(null)
    setPosts([])
    setMembers([])
    setPendingMembers([])
    setEvents([])
    setPolls([])
    apiGetGroup(slug).then(data => {
      if (cancelled) return
      if (!data) { setLoadState('not_found'); return }
      if (data.error === 'forbidden') { setLoadState('forbidden'); return }
      if (data.error) { setLoadState('not_found'); return }
      setGroup(data)
      setGroupFollowing(Boolean(data.is_following))
      setGroupFollowerCount(Number(data.follower_count) || 0)
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

  const handleMediaFiles = (files) => {
    const file = files[0]
    if (!file) return
    if (composerMedia) URL.revokeObjectURL(composerPreviews[0]?.url)
    const url = URL.createObjectURL(file)
    const type = file.type.startsWith('video/') ? 'video' : 'image'
    setComposerMedia(file)
    setComposerPreviews([{ url, type }])
    setComposerExpanded(true)
  }

  const handleRemoveMedia = () => {
    if (composerPreviews[0]?.url) URL.revokeObjectURL(composerPreviews[0].url)
    setComposerMedia(null)
    setComposerPreviews([])
  }

  const doCreatePost = async (text, media) => {
    const res = await apiCreateGroupPost(group.id, text, media || undefined)
    if (res) {
      setPosts(prev => [res, ...prev])
      setComposerText('')
      if (composerPreviews[0]?.url) URL.revokeObjectURL(composerPreviews[0].url)
      setComposerPreviews([])
      setComposerMedia(null)
      setComposerExpanded(false)
    }
  }

  const handleCreatePost = async () => {
    if (!composerText.trim() || composerSubmitting) return
    const text = composerText.trim()
    setComposerSubmitting(true)
    const check = await apiPreflightPost(text)
    setComposerSubmitting(false)
    if (check?.blocked) return
    if (check?.flagged) {
      setKeywordWarning({ keyword: check.keyword, category: check.category, notes: check.notes, text, media: composerMedia })
      return
    }
    setComposerSubmitting(true)
    await doCreatePost(text, composerMedia)
    setComposerSubmitting(false)
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
    const myRole = group.membership?.role
    if (myRole === 'admin' || myRole === 'moderator') {
      setPendingLoading(true)
      apiGetGroupPendingMembers(group.id).then(data => {
        setPendingLoading(false)
        if (data?.pending) setPendingMembers(data.pending)
      })
    }
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

  const handleApproveMember = async (userId) => {
    const res = await apiApproveGroupMember(group.id, userId)
    if (res?.ok) {
      const approved = pendingMembers.find(m => m.id === userId)
      setPendingMembers(prev => prev.filter(m => m.id !== userId))
      if (approved) {
        setMembers(prev => [...prev, { ...approved, role: 'member' }])
        setGroup(prev => ({ ...prev, member_count: prev.member_count + 1 }))
      }
    }
  }

  const handleRejectMember = async (userId) => {
    const res = await apiRejectGroupMember(group.id, userId)
    if (res?.ok) setPendingMembers(prev => prev.filter(m => m.id !== userId))
  }

  useEffect(() => {
    if (tab !== 'polls' || loadState !== 'ready' || !group) return
    setPollsLoading(true)
    apiGetGroupPolls(group.slug).then(data => {
      setPollsLoading(false)
      if (data?.polls) setPolls(data.polls)
    })
  }, [tab, loadState, group?.id, group?.slug])

  useEffect(() => {
    if (tab !== 'about' || loadState !== 'ready' || !group?.membership?.isMember) return
    apiGetGroupInviteLink(group.slug).then(data => {
      if (data?.link) setInviteLink(data.link)
    })
  }, [tab, loadState, group?.id, group?.slug, group?.membership?.isMember])

  useEffect(() => {
    if (tab !== 'moderation' || loadState !== 'ready') return
    setModLoading(true)
    apiGetGroupModerationReports(group.id).then(data => {
      setModReports(data?.reports || [])
      setModLoading(false)
    })
  }, [tab, loadState, group?.id])

  const handleVote = async (poll, optionIdx) => {
    setPolls(prev => prev.map(p => {
      if (p.id !== poll.id) return p
      const newOptions = (p.options || []).map((opt, i) => ({
        ...opt,
        vote_count: i === optionIdx ? (opt.vote_count || 0) + 1 : (opt.vote_count || 0),
      }))
      return { ...p, user_vote: optionIdx, options: newOptions }
    }))
    await apiVoteGroupPoll(group.slug, poll.id, optionIdx)
  }

  const toggleComments = (postId) => {
    setExpandedComments(prev => {
      const next = new Set(prev)
      next.has(postId) ? next.delete(postId) : next.add(postId)
      return next
    })
  }

  const handleCopyLink = () => {
    if (!inviteLink) return
    const full = `${window.location.origin}${inviteLink}`
    navigator.clipboard.writeText(full).then(() => {
      setCopyState(true)
      setTimeout(() => setCopyState(false), 2000)
    })
  }

  const handleMute = async (minutes) => {
    if (!group) return
    const result = await apiMuteConversation(group.id, minutes)
    if (result) {
      setGroup(prev => ({ ...prev, mutedUntil: result.mutedUntil }))
    }
    setMuteOpen(false)
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

  const handleCreateEvent = async () => {
    if (!eventTitle.trim() || eventSaving) return
    setEventSaving(true)
    const res = await apiCreateGroupEvent(group.slug, eventTitle.trim(), eventDate || null, eventLocation.trim() || null)
    setEventSaving(false)
    if (res?.id) {
      setEvents(prev => [...prev, { ...res, going_count: 0, my_rsvp: null }])
      setEventTitle('')
      setEventDate('')
      setEventLocation('')
      setShowEventForm(false)
    }
  }

  const handleCreatePoll = async () => {
    const cleanOpts = pollOptions.map(o => o.trim()).filter(Boolean)
    if (!pollQuestion.trim() || cleanOpts.length < 2 || pollSaving) return
    setPollSaving(true)
    const res = await apiCreateGroupPoll(group.slug, pollQuestion.trim(), cleanOpts, null)
    setPollSaving(false)
    if (res?.id) {
      setPolls(prev => [res, ...prev])
      setPollQuestion('')
      setPollOptions(['', ''])
      setShowPollForm(false)
    }
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

  const openReport = (type, id) => {
    setReportTarget({ type, id })
    setRedFlagStatus('idle')
    setRedFlagReason('')
    setRedFlagDetails('')
  }

  // ── Group ready ───────────────────────────────────────────────────────────

  const { membership } = group
  const isCreator = group.created_by === currentUser?.id
  const isAdmin = membership.role === 'admin' || (membership.role === 'moderator' && isCreator)
  const isMod = membership.role === 'admin' || membership.role === 'moderator'
  const isMuted = group.mutedUntil && new Date(group.mutedUntil) > new Date()

  const typeKey = group.type || 'public'
  const typeMeta = TYPE_STYLE[typeKey] || TYPE_STYLE.public
  const typeLabel = g.type?.[typeKey] || typeKey

  const coverSrc = group.cover_url
    ? (group.cover_url.startsWith('http') ? group.cover_url : `${API_BASE}${group.cover_url}`)
    : null

  const TABS = ['feed', 'members', 'events', 'polls', 'about', ...(isMod ? ['moderation'] : [])]
  const TAB_LABEL = {
    feed: g.feed,
    members: g.membersTab,
    events: g.events,
    polls: g.polls,
    about: g.about,
    moderation: g.moderationTab,
  }

  return (
    <div style={s.page}>
      {keywordWarning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px 28px 24px', maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 22, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>{t.keywordWarnTitle}</h3>
            {keywordWarning.category && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ background: '#F4C26A', color: '#5a3e00', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                  {t.kwCategories?.[keywordWarning.category] || keywordWarning.category}
                </span>
              </div>
            )}
            <p style={{ margin: '0 0 12px', fontSize: 14, color: '#555', lineHeight: 1.5 }}>
              {t.keywordWarnBody?.replace('{kw}', keywordWarning.keyword)}
            </p>
            {keywordWarning.notes && (
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#8B4513', background: '#FFF8F0', border: '1px solid #F4C26A', borderRadius: 8, padding: '10px 14px', lineHeight: 1.5 }}>
                {keywordWarning.notes}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setKeywordWarning(null)}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #ddd', background: '#f5f5f5', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                {t.keywordWarnEdit}
              </button>
              <button
                onClick={async () => {
                  const { text, media } = keywordWarning
                  setKeywordWarning(null)
                  setComposerSubmitting(true)
                  await doCreatePost(text, media)
                  setComposerSubmitting(false)
                }}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                {t.keywordWarnContinue}
              </button>
            </div>
          </div>
        </div>
      )}
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
                <span style={s.metaText}>
                  {'· '}{groupFollowerCount}{' '}{g.followers || 'followers'}
                </span>
              </div>
            </div>
            <div style={s.headerActions}>
              {isAdmin && (
                <button style={s.settingsBtn} onClick={() => onNavigate?.(`/groups/${slug}/settings`)}>
                  {'⚙️ '}{g.settings}
                </button>
              )}
              {currentUser && !isAdmin && (
                <button
                  style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #E8E4DF', background: 'none', cursor: 'pointer', color: '#888' }}
                  onClick={() => openReport('group', group.id)}
                  title={t.redFlagTitleGroup}
                >
                  {t.redFlag}
                </button>
              )}
              {membership.isMember && (
                <button
                  style={s.muteBtn}
                  onClick={() => setMuteOpen(true)}
                  title={isMuted ? g.unmuteGroup : g.muteGroup}
                >
                  {isMuted ? '🔔' : '🔕'}
                </button>
              )}
              {group.type !== 'hidden' && !membership.isMember && (
                <button
                  style={{
                    fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 20,
                    border: groupFollowing ? '1.5px solid #C7D2FE' : '1.5px solid #6366F1',
                    background: groupFollowing ? '#EEF2FF' : '#fff',
                    color: groupFollowing ? '#4338CA' : '#6366F1',
                    cursor: groupFollowBusy ? 'default' : 'pointer',
                    opacity: groupFollowBusy ? 0.7 : 1,
                  }}
                  disabled={groupFollowBusy}
                  onClick={async () => {
                    if (groupFollowBusy) return
                    setGroupFollowBusy(true)
                    if (groupFollowing) {
                      const res = await apiUnfollowGroup(group.id)
                      if (res !== null) { setGroupFollowing(false); setGroupFollowerCount(c => Math.max(0, c - 1)) }
                    } else {
                      const res = await apiFollowGroup(group.id)
                      if (res !== null) { setGroupFollowing(true); setGroupFollowerCount(c => c + 1) }
                    }
                    setGroupFollowBusy(false)
                  }}
                >
                  {groupFollowing ? `✓ ${g.unfollowGroup || g.followingGroup}` : `+ ${g.followGroup}`}
                </button>
              )}
              {membership.isMember ? (
                <button style={s.leaveBtn} onClick={handleLeave}>{g.leave}</button>
              ) : membership.hasRequested ? (
                <button style={{ ...s.joinBtn, opacity: 0.6 }} disabled>{g.requestSent}</button>
              ) : !groupFollowing && group.type === 'public' ? (
                <button style={s.joinBtn} onClick={handleJoin}>{g.join}</button>
              ) : !groupFollowing && group.type === 'private' ? (
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
            {key === 'moderation' && modReports.length > 0 && (
              <span style={{ marginLeft: 5, background: '#E07A5F', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
                {modReports.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={s.tabContent}>
        {tab === 'feed' && (
          <div>
            {membership.isMember && (
              <div className="p-card p-new-post" style={{ marginBottom: 16 }}>
                {!composerExpanded && !composerText && !composerPreviews.length ? (
                  <div className="p-new-post-row p-new-post-collapsed">
                    <div
                      className="p-avatar-sm"
                      style={{ background: nameToColor(currentUser?.name || ''), cursor: 'pointer' }}
                      onClick={() => { setComposerExpanded(true); setTimeout(() => composerTextareaRef.current?.focus(), 0) }}
                    >
                      {getInitials(currentUser?.name || '')}
                    </div>
                    <div
                      className="p-new-post-prompt"
                      onClick={() => { setComposerExpanded(true); setTimeout(() => composerTextareaRef.current?.focus(), 0) }}
                    >
                      {g.writePost || (lang === 'da' ? 'Skriv et opslag til gruppen...' : 'Write a post for the group...')}
                    </div>
                    <MediaPickerButton
                      lang={lang}
                      onFiles={files => { setComposerExpanded(true); handleMediaFiles(files) }}
                      multiple={false}
                      direction="down"
                    />
                  </div>
                ) : (
                  <>
                    <div className="p-new-post-row" style={{ position: 'relative' }}>
                      <div className="p-avatar-sm" style={{ background: nameToColor(currentUser?.name || '') }}>
                        {getInitials(currentUser?.name || '')}
                      </div>
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setComposerText(''); handleRemoveMedia(); setComposerExpanded(false) }}
                        style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#aaa', lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                      >✕</button>
                      <textarea
                        ref={composerTextareaRef}
                        className="p-new-post-textarea"
                        placeholder={g.writePost || (lang === 'da' ? 'Skriv et opslag til gruppen...' : 'Write a post for the group...')}
                        value={composerText}
                        onChange={e => { setComposerText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                        onBlur={e => { if (!composerText.trim() && !composerPreviews.length && !e.relatedTarget) setComposerExpanded(false) }}
                        autoFocus={composerExpanded && !composerText}
                        lang={lang}
                      />
                    </div>
                    {composerPreviews.length > 0 && (
                      <div className="p-media-previews">
                        {composerPreviews.map((p, i) => (
                          <div key={i} className="p-media-preview">
                            {p.type === 'video'
                              ? <video src={p.url} className="p-media-preview-thumb" />
                              : <img src={p.url} alt="" className="p-media-preview-thumb" />}
                            <button className="p-media-preview-remove" onClick={handleRemoveMedia}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="p-new-post-actions">
                      <div className="p-new-post-toolbar-left">
                        <MediaPickerButton
                          lang={lang}
                          onFiles={handleMediaFiles}
                          multiple={false}
                        />
                      </div>
                      <button
                        className="p-post-btn"
                        onClick={handleCreatePost}
                        disabled={composerSubmitting || !composerText.trim()}
                      >
                        {g.post || (lang === 'da' ? 'Post' : 'Post')}
                      </button>
                    </div>
                  </>
                )}
              </div>
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
              const canReport = !isOwn && !!currentUser
              let media = []
              if (post.media) {
                try {
                  const raw = typeof post.media === 'string' ? JSON.parse(post.media) : post.media
                  if (Array.isArray(raw)) {
                    media = raw
                      .map(m => m && typeof m === 'object' ? m : (m ? { url: m } : null))
                      .filter(m => m?.url)
                      .map(m => ({ url: m.url, type: m.type || (/\.(mp4|webm|ogg|mov)$/i.test(m.url) ? 'video' : 'image') }))
                  }
                } catch {}
              }
              return (
                <div
                  key={post.id}
                  className="p-card p-post"
                  style={{
                    borderLeft: `4px solid ${nameToColor(post.author_name)}`,
                    marginBottom: 12,
                    ...(post.is_pinned ? { background: '#F5F3FF' } : {}),
                  }}
                >
                  {!!post.is_pinned && <div style={s.pinLabel}>{'📌 '}{g.pinPost}</div>}
                  <div className="p-post-header">
                    <div className="p-avatar-sm" style={{ background: nameToColor(post.author_name) }}>
                      {getInitials(post.author_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="p-post-author">{post.author_name}</div>
                      <div className="p-post-time">{fmtTime(post.created_at, lang)}</div>
                    </div>
                    {(canPin || canDelete || canReport) && (
                      <div style={{ position: 'relative' }}>
                        {(canPin || canDelete) && (
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
                        {canReport && (
                          <button
                            style={s.iconBtn}
                            title={t.redFlagTitlePost}
                            onClick={() => openReport('post', post.id)}
                          >
                            {'🚩'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="p-post-text">{text}</p>
                  {media.length > 0 && (
                    <div style={s.mediaGrid}>
                      {media.map((m, i) => {
                        const src = m.url.startsWith('http') ? m.url : `${API_BASE}${m.url}`
                        return m.type === 'video'
                          ? <video key={i} src={src} style={s.mediaImg} controls />
                          : <img key={i} src={src} alt="" style={s.mediaImg} />
                      })}
                    </div>
                  )}
                  {REACTIONS.some(r => (post.reactions?.[r] || 0) > 0) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px', borderBottom: '1px solid #F0EDE8', flexWrap: 'wrap' }}>
                      {REACTIONS.filter(r => (post.reactions?.[r] || 0) > 0).map(r => (
                        <span key={r} style={{ fontSize: 14 }}>
                          {REACTION_EMOJI[r]} <span style={{ fontSize: 12, color: '#888' }}>{post.reactions[r]}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="p-post-actions">
                    <div className="p-reaction-wrap" style={{ position: 'relative' }}>
                      <button
                        className={`p-action-btn${post.my_reaction ? ' liked' : ''}`}
                        onClick={() => setLikePopup(p => p === post.id ? null : post.id)}
                      >
                        {post.my_reaction ? REACTION_EMOJI[post.my_reaction] : '🤍'} {t.like || (lang === 'da' ? 'Synes godt om' : 'Like')}
                      </button>
                      {likePopup === post.id && (
                        <>
                          <div className="p-share-backdrop" onClick={() => setLikePopup(null)} />
                          <div className="p-reaction-popup">
                            {REACTIONS.map(r => (
                              <button
                                key={r}
                                className="p-reaction-btn"
                                title={g[`react${r.charAt(0).toUpperCase() + r.slice(1)}`] || r}
                                onClick={() => { handleReact(post, r); setLikePopup(null) }}
                              >
                                {REACTION_EMOJI[r]}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <button className="p-action-btn" onClick={() => toggleComments(post.id)}>
                      💬 {t.comment || (lang === 'da' ? 'Kommentar' : 'Comment')}
                    </button>
                    <button
                      className="p-action-btn"
                      onClick={() => {
                        const url = `${window.location.origin}/groups/${group.slug}`
                        navigator.clipboard.writeText(url).catch(() => {})
                      }}
                    >
                      ↗ {t.share || (lang === 'da' ? 'Del' : 'Share')}
                    </button>
                    <button
                      className="p-action-btn"
                      onClick={() => {
                        setPosts(prev => prev.map(p =>
                          p.id === post.id ? { ...p, _saved: !p._saved } : p
                        ))
                      }}
                    >
                      {post._saved ? '🔖' : '📌'} {t.save || (lang === 'da' ? 'Gem' : 'Save')}
                    </button>
                  </div>
                  {expandedComments.has(post.id) && (
                    <div style={{ borderTop: '1px solid #F0EDE8', paddingTop: 10, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div className="p-avatar-sm" style={{ background: nameToColor(currentUser?.name || ''), flexShrink: 0, fontSize: 11 }}>
                        {getInitials(currentUser?.name || '')}
                      </div>
                      <input
                        className="p-comment-input"
                        placeholder={lang === 'da' ? 'Skriv en kommentar... — @ mention, # tag' : 'Write a comment... — @ mention, # tag'}
                        style={{ flex: 1 }}
                      />
                      <button style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: '#2D6A4F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                        {lang === 'da' ? 'Send' : 'Send'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {tab === 'members' && (
          <div>
            {isMod && (pendingLoading || pendingMembers.length > 0) && (
              <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
                  {g.pendingRequests}{pendingMembers.length > 0 ? ` (${pendingMembers.length})` : ''}
                </div>
                {pendingLoading ? (
                  <div style={{ fontSize: 13, color: '#aaa' }}>{g.loading}</div>
                ) : pendingMembers.map(pm => (
                  <div key={pm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: nameToColor(pm.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, overflow: 'hidden' }}>
                      {pm.avatar_url
                        ? <img src={pm.avatar_url.startsWith('http') ? pm.avatar_url : `${API_BASE}${pm.avatar_url}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : getInitials(pm.name)
                      }
                    </div>
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{pm.name}</div>
                    <button style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#5B4FCF', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} onClick={() => handleApproveMember(pm.id)}>
                      {g.approveMember}
                    </button>
                    <button style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #DC2626', background: '#fff', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} onClick={() => handleRejectMember(pm.id)}>
                      {g.rejectMember}
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            {isMod && (
              <div style={{ marginBottom: 16 }}>
                {showEventForm ? (
                  <div style={{ background: '#fff', border: '1px solid #E8E4DF', borderRadius: 12, padding: 16 }}>
                    <input
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
                      placeholder={g.eventTitlePlaceholder}
                      value={eventTitle}
                      onChange={e => setEventTitle(e.target.value)}
                      maxLength={200}
                    />
                    <input
                      type="datetime-local"
                      lang={getLocale(lang)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
                      value={eventDate}
                      onChange={e => setEventDate(e.target.value)}
                    />
                    <LocationAutocomplete
                      value={eventLocation}
                      onChange={setEventLocation}
                      onSelect={loc => loc && setEventLocation(loc.name)}
                      lang={lang}
                      placeholder={g.eventLocationPlaceholder}
                      inputStyle={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#5B4FCF', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: (!eventTitle.trim() || eventSaving) ? 0.6 : 1 }} onClick={handleCreateEvent} disabled={!eventTitle.trim() || eventSaving}>
                        {eventSaving ? '...' : g.createEventSubmit}
                      </button>
                      <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#666' }} onClick={() => setShowEventForm(false)}>
                        {g.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px dashed #C7C0F5', background: '#F5F3FF', color: '#5B4FCF', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={() => setShowEventForm(true)}>
                    {'+ '}{g.createEvent}
                  </button>
                )}
              </div>
            )}
            {eventsLoading ? (
              <div style={s.feedEmpty}>{g.loading}</div>
            ) : events.length === 0 ? (
              <div style={s.feedEmpty}>{g.noEvents}</div>
            ) : events.map(ev => {
              const goingCount = Number(ev.going_count) || 0
              const isExpired = ev.date && new Date(ev.date) < new Date()
              return (
                <div key={ev.id} style={{ ...s.eventCard, ...(isExpired ? { opacity: 0.6 } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={s.eventTitle}>{ev.title}</div>
                    {isExpired && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#f5e6e6', color: '#c0392b' }}>
                        {t.expired}
                      </span>
                    )}
                  </div>
                  <div style={s.eventMeta}>
                    {ev.date && <span>{'📅 '}{fmtDate(ev.date, lang)}</span>}
                    {ev.location && <span>{'📍 '}{ev.location}</span>}
                    {goingCount > 0 && (
                      <span style={s.goingBadge}>
                        {goingCount}{' '}{g.rsvpGoing.toLowerCase()}
                      </span>
                    )}
                  </div>
                  {!isExpired && (
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
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'polls' && (
          <div>
            {isMod && (
              <div style={{ marginBottom: 16 }}>
                {showPollForm ? (
                  <div style={{ background: '#fff', border: '1px solid #E8E4DF', borderRadius: 12, padding: 16 }}>
                    <input
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
                      placeholder={g.pollQuestionPlaceholder}
                      value={pollQuestion}
                      onChange={e => setPollQuestion(e.target.value)}
                      maxLength={500}
                    />
                    {pollOptions.map((opt, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <input
                          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 13, boxSizing: 'border-box' }}
                          placeholder={`${g.pollOptionPlaceholder} ${i + 1}`}
                          value={opt}
                          onChange={e => setPollOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
                          maxLength={200}
                        />
                        {pollOptions.length > 2 && (
                          <button style={{ padding: '0 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#999', fontSize: 16 }} onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))}>×</button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 6 && (
                      <button style={{ fontSize: 12, color: '#5B4FCF', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12, padding: 0 }} onClick={() => setPollOptions(prev => [...prev, ''])}>
                        {'+ '}{g.pollAddOption}
                      </button>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#5B4FCF', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2 || pollSaving) ? 0.6 : 1 }} onClick={handleCreatePoll} disabled={!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2 || pollSaving}>
                        {pollSaving ? '...' : g.createPollSubmit}
                      </button>
                      <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#666' }} onClick={() => setShowPollForm(false)}>
                        {g.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px dashed #C7C0F5', background: '#F5F3FF', color: '#5B4FCF', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={() => setShowPollForm(true)}>
                    {'+ '}{g.createPoll}
                  </button>
                )}
              </div>
            )}
            {pollsLoading ? (
              <div style={s.feedEmpty}>{g.loading}</div>
            ) : polls.length === 0 ? (
              <div style={s.feedEmpty}>{g.noPolls}</div>
            ) : polls.map(poll => {
              const voted = poll.user_vote !== null && poll.user_vote !== undefined
              const ended = poll.ends_at && new Date(poll.ends_at) < new Date()
              const totalVotes = (poll.options || []).reduce((sum, o) => sum + (o.vote_count || 0), 0)
              return (
                <div key={poll.id} style={s.pollCard}>
                  <div style={s.pollQuestion}>{poll.question}</div>
                  {ended && <div style={s.pollStatusTag}>{g.pollEnded}</div>}
                  {voted && !ended && <div style={{ ...s.pollStatusTag, ...s.pollVotedTag }}>{g.pollVoted}</div>}
                  <div style={s.pollOptions}>
                    {(poll.options || []).map((opt, i) => {
                      const label = lang === 'da' ? opt.text_da : (opt.text_en || opt.text_da)
                      const pct = totalVotes > 0 ? Math.round(((opt.vote_count || 0) / totalVotes) * 100) : 0
                      const isChosen = poll.user_vote === i
                      if (voted || ended) {
                        return (
                          <div key={i} style={s.pollResultRow}>
                            <div style={s.pollResultLabelRow}>
                              <span style={{ ...s.pollResultLabel, ...(isChosen ? s.pollResultLabelChosen : {}) }}>{label}</span>
                              <span style={s.pollResultPct}>{pct}%</span>
                            </div>
                            <div style={s.pollBarWrap}>
                              <div style={{ ...s.pollBar, width: `${pct}%`, ...(isChosen ? s.pollBarChosen : {}) }} />
                            </div>
                            <div style={s.pollVoteCount}>
                              {opt.vote_count || 0} {(opt.vote_count || 0) === 1 ? g.pollVote : g.pollVotes}
                            </div>
                          </div>
                        )
                      }
                      return (
                        <button
                          key={i}
                          style={s.pollOptionBtn}
                          disabled={!!ended}
                          onClick={() => handleVote(poll, i)}
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

        {tab === 'about' && (
          <div style={s.aboutSection}>
            {(group.description_da || group.description_en) && (
              <div style={s.aboutBlock}>
                <div style={s.aboutLabel}>{g.descLabel}</div>
                <p style={s.aboutText}>
                  {lang === 'da' ? group.description_da : (group.description_en || group.description_da)}
                </p>
              </div>
            )}
            <div style={s.aboutBlock}>
              <div style={s.aboutLabel}>{g.typeLabel}</div>
              <span style={{ ...s.typePill, background: typeMeta.bg, color: typeMeta.color, fontSize: 12, padding: '4px 12px' }}>
                {typeLabel}
              </span>
            </div>
            {group.category && (
              <div style={s.aboutBlock}>
                <div style={s.aboutLabel}>{g.categoryLabel}</div>
                <span style={s.categoryPill}>{g.category?.[group.category] || group.category}</span>
              </div>
            )}
            {group.tags && group.tags.length > 0 && (
              <div style={s.aboutBlock}>
                <div style={s.aboutLabel}>{g.tagsLabel}</div>
                <div style={s.tagList}>
                  {group.tags.map((tag, i) => (
                    <span key={i} style={s.tagPill}>{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div style={s.aboutBlock}>
              <div style={s.aboutLabel}>{group.member_count === 1 ? g.member : g.members}</div>
              <div style={s.aboutText}>{'👥 '}{group.member_count}</div>
            </div>
            {group.created_at && (
              <div style={s.aboutBlock}>
                <div style={s.aboutLabel}>{g.createdLabel}</div>
                <div style={s.aboutText}>
                  {new Date(group.created_at).toLocaleDateString(
                    getLocale(lang),
                    { day: 'numeric', month: 'long', year: 'numeric' }
                  )}
                </div>
              </div>
            )}
            {membership.isMember && (
              <div style={s.aboutBlock}>
                <div style={s.aboutLabel}>{g.inviteLink}</div>
                <div style={s.inviteRow}>
                  <span style={s.inviteLinkText}>
                    {inviteLink ? `${window.location.origin}${inviteLink}` : '…'}
                  </span>
                  <button style={{ ...s.copyBtn, ...(copyState ? s.copyBtnDone : {}) }} onClick={handleCopyLink} disabled={!inviteLink}>
                    {copyState ? g.linkCopied : g.copyLink}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'moderation' && isMod && (
          <div>
            {modLoading ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#888' }}>{g.loading}</div>
            ) : modReports.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#888' }}>✅ {g.modNoReports}</div>
            ) : modReports.map(report => (
              <div key={report.report_id} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', marginBottom: 12, border: '1px solid #E8E4DF' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  🚩 {g.modReportedBy} <strong>{report.reporter_name}</strong>
                  {report.reason && <> · {g.modReason}: {report.reason}</>}
                  <span style={{ marginLeft: 8 }}>{fmtTime(report.reported_at, lang)}</span>
                </div>
                <div style={{ background: '#f9f7f5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12, color: '#444' }}>
                  <strong>{report.author_name}</strong>{report.author_handle ? ` @${report.author_handle}` : ''}: {(report.text_da || '').slice(0, 300)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #E8E4DF', fontSize: 13, cursor: 'pointer', background: '#fff' }}
                    onClick={async () => {
                      await apiDismissGroupReport(group.id, report.report_id)
                      setModReports(prev => prev.filter(r => r.report_id !== report.report_id))
                    }}
                  >
                    {g.modDismiss}
                  </button>
                  <button
                    style={{ padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 13, cursor: 'pointer', background: '#E07A5F', color: '#fff', fontWeight: 600 }}
                    onClick={async () => {
                      if (!window.confirm(g.modConfirmRemove)) return
                      await apiDeleteGroupPost(group.id, report.post_id)
                      setModReports(prev => prev.filter(r => r.report_id !== report.report_id))
                      setPosts(prev => prev.filter(p => p.id !== report.post_id))
                    }}
                  >
                    {g.modRemovePost}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {muteOpen && (
        <GroupMuteModal g={g} isMuted={isMuted} onClose={() => setMuteOpen(false)} onMute={handleMute} />
      )}
      {reportTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setReportTarget(null)}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{reportTarget.type === 'group' ? t.redFlagTitleGroup : t.redFlagTitlePost}</h3>
            {redFlagStatus === 'done' && <div style={{ color: '#2D6A4F', fontWeight: 600, marginBottom: 12 }}>✓ {t.reportDone}</div>}
            {redFlagStatus === 'duplicate' && <div style={{ color: '#888', marginBottom: 12 }}>{t.reportDuplicate}</div>}
            {redFlagStatus !== 'done' && (
              <form onSubmit={async e => {
                e.preventDefault()
                if (!redFlagReason) return
                setRedFlagStatus('submitting')
                const data = await apiReportContent(reportTarget.type, reportTarget.id, redFlagReason, redFlagDetails).catch(() => null)
                if (data?.duplicate) { setRedFlagStatus('duplicate'); return }
                setRedFlagStatus('done')
                setTimeout(() => setReportTarget(null), 1800)
              }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>{t.reportReasonLabel}</label>
                <select
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', marginBottom: 12 }}
                  value={redFlagReason}
                  onChange={e => setRedFlagReason(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  <option value="spam">{t.reportReasonSpam}</option>
                  <option value="hate">{t.reportReasonHate}</option>
                  <option value="harassment">{t.reportReasonHarassment}</option>
                  <option value="misinformation">{t.reportReasonMisinformation}</option>
                  <option value="violence">{t.reportReasonViolence}</option>
                  <option value="nudity">{t.reportReasonNudity}</option>
                  <option value="other">{t.reportReasonOther}</option>
                </select>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>{t.reportDetailsLabel}</label>
                <textarea
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', marginBottom: 14 }}
                  value={redFlagDetails}
                  onChange={e => setRedFlagDetails(e.target.value)}
                  placeholder={t.reportDetailsPlaceholder}
                  maxLength={500}
                />
                <div>
                  <button type="submit" style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: '#E07A5F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }} disabled={!redFlagReason || redFlagStatus === 'submitting'}>
                    {redFlagStatus === 'submitting' ? '…' : t.reportSubmit}
                  </button>
                  <button type="button" style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #E8E4DF', background: 'none', fontSize: 14, cursor: 'pointer', marginLeft: 8 }} onClick={() => setReportTarget(null)}>
                    {t.cancel}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GroupMuteModal({ g, isMuted, onClose, onMute }) {
  const options = [
    { label: g.mute1h, minutes: 60 },
    { label: g.mute8h, minutes: 480 },
    { label: g.mute24h, minutes: 1440 },
    { label: g.mute1w, minutes: 10080 },
    { label: g.muteOff, minutes: null },
  ]
  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={e => e.stopPropagation()}>
        <div style={ms.title}>{isMuted ? g.unmuteGroup : g.muteTitle}</div>
        {options.map(o => (
          <button key={o.label} style={ms.option} onClick={() => onMute(o.minutes)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const ms = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: 14, padding: '18px 0 8px',
    minWidth: 240, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  },
  title: {
    fontSize: 13, fontWeight: 700, color: '#888',
    padding: '0 20px 10px', borderBottom: '1px solid #F0EDE8',
  },
  option: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '12px 20px', border: 'none', background: 'none',
    fontSize: 15, color: '#1a1a1a', cursor: 'pointer',
  },
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
  muteBtn: { fontSize: 18, padding: '5px 8px', borderRadius: 20, border: '1.5px solid #E8E4DF', background: '#F9F7F5', cursor: 'pointer', lineHeight: 1 },
  tabBar: { display: 'flex', gap: 0, padding: '0 20px', background: '#fff', borderBottom: '1px solid #E8E4DF', overflowX: 'auto' },
  tabBtn: { fontSize: 13, fontWeight: 600, padding: '10px 14px', border: 'none', borderBottom: '2px solid transparent', background: 'none', color: '#888', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.15s' },
  tabActive: { color: '#4338CA', borderBottom: '2px solid #4338CA' },
  tabContent: { padding: '16px 20px' },
  feedEmpty: { textAlign: 'center', color: '#bbb', fontSize: 14, padding: '40px 0' },
  pendingBanner: { fontSize: 13, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', marginBottom: 16 },
  pinLabel: { fontSize: 11, color: '#4338CA', marginBottom: 6, fontWeight: 700 },
  mediaGrid: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  mediaImg: { maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'cover' },
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
  // Polls tab
  pollCard: {
    background: '#fff', borderRadius: 12, border: '1px solid #E8E4DF',
    padding: '16px', marginBottom: 12,
  },
  pollQuestion: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 },
  pollStatusTag: {
    display: 'inline-block', fontSize: 11, fontWeight: 700,
    padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280',
    marginBottom: 12,
  },
  pollVotedTag: { background: '#DCFCE7', color: '#166534' },
  pollOptions: { display: 'flex', flexDirection: 'column', gap: 8 },
  pollOptionBtn: {
    fontSize: 14, fontWeight: 600, padding: '10px 16px', borderRadius: 8,
    border: '1.5px solid #D1D5DB', background: '#F9FAFB', color: '#374151',
    cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, border-color 0.15s',
  },
  pollResultRow: { marginBottom: 8 },
  pollResultLabelRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  pollResultLabel: { fontSize: 13, color: '#555', fontWeight: 500 },
  pollResultLabelChosen: { fontWeight: 700, color: '#4338CA' },
  pollResultPct: { fontSize: 13, fontWeight: 700, color: '#1a1a1a' },
  pollBarWrap: { height: 8, background: '#F0EDE8', borderRadius: 4, overflow: 'hidden', marginBottom: 3 },
  pollBar: { height: '100%', background: '#C7D2FE', borderRadius: 4, transition: 'width 0.3s ease' },
  pollBarChosen: { background: '#4338CA' },
  pollVoteCount: { fontSize: 11, color: '#aaa' },
  // About tab
  aboutSection: { display: 'flex', flexDirection: 'column', gap: 20 },
  aboutBlock: {},
  aboutLabel: { fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 },
  aboutText: { fontSize: 14, color: '#333', lineHeight: 1.6, margin: 0 },
  tagList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tagPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#F0EDE8', color: '#555' },
  inviteRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  inviteLinkText: {
    fontSize: 13, color: '#555', background: '#F9F7F5',
    border: '1px solid #E8E4DF', borderRadius: 8,
    padding: '7px 12px', flex: 1, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  copyBtn: {
    fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8,
    border: '1.5px solid #4338CA', background: '#fff', color: '#4338CA',
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s',
  },
  copyBtnDone: { background: '#4338CA', color: '#fff' },
}
