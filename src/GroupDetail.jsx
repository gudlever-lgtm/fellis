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
  const [reportTarget, setReportTarget] = useState(null)
  const [redFlagStatus, setRedFlagStatus] = useState('idle')
  const [redFlagReason, setRedFlagReason] = useState('')
  const [redFlagDetails, setRedFlagDetails] = useState('')
  const [likePopup, setLikePopup] = useState(null)
  const [expandedComments, setExpandedComments] = useState(new Set())

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
    return <div className="gd-center"><span style={{ fontSize: 14, color: '#aaa' }}>{g.loading}</span></div>
  }

  if (loadState === 'forbidden') {
    return (
      <div className="gd-center">
        <div className="gd-status-box">
          <span style={{ fontSize: 36 }}>🔒</span>
          <p style={{ fontSize: 15, color: '#555', margin: 0 }}>{g.forbidden}</p>
          <button style={sBackBtn} onClick={() => onNavigate?.('/groups')}>{g.back}</button>
        </div>
      </div>
    )
  }

  if (loadState === 'not_found' || !group) {
    return (
      <div className="gd-center">
        <div className="gd-status-box">
          <p style={{ fontSize: 15, color: '#555', margin: 0 }}>{g.notFound}</p>
          <button style={sBackBtn} onClick={() => onNavigate?.('/groups')}>{g.back}</button>
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
        <div className="gd-kw-overlay">
          <div className="gd-kw-modal">
            <div style={{ fontSize: 22, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>{t.keywordWarnTitle}</h3>
            {keywordWarning.category && (
              <div className="gd-kw-cat-row">
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
            <div className="gd-kw-actions">
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
      <div className="gd-header-wrap">
        {coverSrc
          ? <img src={coverSrc} alt="" className="gd-cover" />
          : <div className="gd-cover-placeholder" />
        }
        <button className="gd-back-float" onClick={() => onNavigate?.('/groups')}>
          ← {g.back}
        </button>
        <div className="gd-header-body">
          <div className="gd-header-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="gd-header-top">
                <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0, lineHeight: 1.2 }}>{group.name}</h1>
                <span className="gd-type-pill" style={{ background: typeMeta.bg, color: typeMeta.color }}>
                  {typeLabel}
                </span>
              </div>
              <div className="gd-header-meta">
                {group.category && (
                  <span className="gd-cat-pill">
                    {g.category?.[group.category] || group.category}
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#888' }}>
                  {'👥 '}{group.member_count}{' '}{group.member_count === 1 ? g.member : g.members}
                </span>
                <span style={{ fontSize: 12, color: '#888' }}>
                  {'· '}{groupFollowerCount}{' '}{g.followers || 'followers'}
                </span>
              </div>
            </div>
            <div className="gd-header-actions">
              {isAdmin && (
                <button style={sSettingsBtn} onClick={() => onNavigate?.(`/groups/${slug}/settings`)}>
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
                  style={sMuteBtn}
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
                <button style={sLeaveBtn} onClick={handleLeave}>{g.leave}</button>
              ) : membership.hasRequested ? (
                <button style={{ ...sJoinBtn, opacity: 0.6 }} disabled>{g.requestSent}</button>
              ) : !groupFollowing && group.type === 'public' ? (
                <button style={sJoinBtn} onClick={handleJoin}>{g.join}</button>
              ) : !groupFollowing && group.type === 'private' ? (
                <button style={sJoinBtn} onClick={handleRequestAccess}>{g.requestAccess}</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="gd-tab-bar">
        {TABS.map(key => (
          <button
            key={key}
            className={`gd-tab-btn${tab === key ? ' active' : ''}`}
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
      <div className="gd-tab-content">
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
              <div className="gd-pending-banner">{g.pendingApproval}</div>
            )}

            {feedLoading ? (
              <div className="gd-feed-empty">{g.loading}</div>
            ) : posts.length === 0 ? (
              <div className="gd-feed-empty">{g.noFeed}</div>
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
                  {!!post.is_pinned && <div className="gd-pin-label">{'📌 '}{g.pinPost}</div>}
                  <div className="p-post-header">
                    <div className="p-avatar-sm" style={{ background: nameToColor(post.author_name) }}>
                      {getInitials(post.author_name)}
                    </div>
                    <div className="gd-post-meta-col">
                      <div className="p-post-author">{post.author_name}</div>
                      <div className="p-post-time">{fmtTime(post.created_at, lang)}</div>
                    </div>
                    {(canPin || canDelete || canReport) && (
                      <div className="gd-post-actions-col">
                        {(canPin || canDelete) && (
                          <button
                            className="gd-icon-btn"
                            title={post.is_pinned ? g.unpinPost : g.pinPost}
                            onClick={() => handlePinPost(post)}
                          >
                            {post.is_pinned ? '📌' : '📍'}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="gd-icon-btn"
                            title={g.deletePost}
                            onClick={() => handleDeletePost(post.id)}
                          >
                            {'🗑️'}
                          </button>
                        )}
                        {canReport && (
                          <button
                            className="gd-icon-btn"
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
                    <div className="gd-media-grid">
                      {media.map((m, i) => {
                        const src = m.url.startsWith('http') ? m.url : `${API_BASE}${m.url}`
                        return m.type === 'video'
                          ? <video key={i} src={src} className="gd-media-img" controls />
                          : <img key={i} src={src} alt="" className="gd-media-img" />
                      })}
                    </div>
                  )}
                  {REACTIONS.some(r => (post.reactions?.[r] || 0) > 0) && (
                    <div className="gd-reactions-row">
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
                    <div className="gd-comment-row">
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
              <div className="gd-pending-requests">
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
                  {g.pendingRequests}{pendingMembers.length > 0 ? ` (${pendingMembers.length})` : ''}
                </div>
                {pendingLoading ? (
                  <div style={{ fontSize: 13, color: '#aaa' }}>{g.loading}</div>
                ) : pendingMembers.map(pm => (
                  <div key={pm.id} className="gd-pending-member-row">
                    <div className="gd-pending-avatar" style={{ background: nameToColor(pm.name) }}>
                      {pm.avatar_url
                        ? <img src={pm.avatar_url.startsWith('http') ? pm.avatar_url : `${API_BASE}${pm.avatar_url}`} alt="" />
                        : getInitials(pm.name)
                      }
                    </div>
                    <div className="gd-pending-member-name">{pm.name}</div>
                    <button style={sApproveMemberBtn} onClick={() => handleApproveMember(pm.id)}>
                      {g.approveMember}
                    </button>
                    <button style={sRejectMemberBtn} onClick={() => handleRejectMember(pm.id)}>
                      {g.rejectMember}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {membersLoading ? (
              <div className="gd-feed-empty">{g.loading}</div>
            ) : members.length === 0 ? (
              <div className="gd-feed-empty">{g.noMembers}</div>
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
                <div key={member.id} className="gd-member-row">
                  <div className="gd-member-avatar" style={{ background: nameToColor(member.name) }}>
                    {member.avatar_url
                      ? <img src={member.avatar_url.startsWith('http') ? member.avatar_url : `${API_BASE}${member.avatar_url}`} alt="" />
                      : getInitials(member.name)
                    }
                  </div>
                  <div className="gd-member-info">
                    <div className="gd-member-name">
                      {member.name}
                      {isMe && <span className="gd-me-tag"> (me)</span>}
                    </div>
                    <span className="gd-role-badge" style={{ background: roleMeta.bg, color: roleMeta.color }}>
                      {roleLabel}
                    </span>
                  </div>
                  {(canPromote || canDemote || canRemove) && (
                    <div className="gd-member-actions">
                      {canPromote && (
                        <button className="gd-member-btn" onClick={() => handlePromote(member.id)}>
                          {g.promote}
                        </button>
                      )}
                      {canDemote && (
                        <button className="gd-member-btn" onClick={() => handleDemote(member.id)}>
                          {g.demote}
                        </button>
                      )}
                      {canRemove && (
                        <button className="gd-member-btn gd-member-btn-danger" onClick={() => handleRemoveMember(member.id)}>
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
                  <div className="gd-event-form">
                    <input
                      className="gd-form-input"
                      placeholder={g.eventTitlePlaceholder}
                      value={eventTitle}
                      onChange={e => setEventTitle(e.target.value)}
                      maxLength={200}
                    />
                    <input
                      type="datetime-local"
                      lang={getLocale(lang)}
                      className="gd-form-input"
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
                    <div className="gd-form-actions">
                      <button style={{ ...sFormSubmitBtn, opacity: (!eventTitle.trim() || eventSaving) ? 0.6 : 1 }} onClick={handleCreateEvent} disabled={!eventTitle.trim() || eventSaving}>
                        {eventSaving ? '...' : g.createEventSubmit}
                      </button>
                      <button style={sFormCancelBtn} onClick={() => setShowEventForm(false)}>
                        {g.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={sAddDashedBtn} onClick={() => setShowEventForm(true)}>
                    {'+ '}{g.createEvent}
                  </button>
                )}
              </div>
            )}
            {eventsLoading ? (
              <div className="gd-feed-empty">{g.loading}</div>
            ) : events.length === 0 ? (
              <div className="gd-feed-empty">{g.noEvents}</div>
            ) : events.map(ev => {
              const goingCount = Number(ev.going_count) || 0
              const isExpired = ev.date && new Date(ev.date) < new Date()
              return (
                <div key={ev.id} className="gd-event-card" style={isExpired ? { opacity: 0.6 } : {}}>
                  <div className="gd-event-header">
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>{ev.title}</div>
                    {isExpired && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#f5e6e6', color: '#c0392b' }}>
                        {t.expired}
                      </span>
                    )}
                  </div>
                  <div className="gd-event-meta">
                    {ev.date && <span>{'📅 '}{fmtDate(ev.date, lang)}</span>}
                    {ev.location && <span>{'📍 '}{ev.location}</span>}
                    {goingCount > 0 && (
                      <span className="gd-going-badge">
                        {goingCount}{' '}{g.rsvpGoing.toLowerCase()}
                      </span>
                    )}
                  </div>
                  {!isExpired && (
                    <div className="gd-rsvp-row">
                      {RSVP_STATUSES.map(status => {
                        const active = ev.my_rsvp === status
                        const label = g[`rsvp${status.charAt(0).toUpperCase()}${status.slice(1)}`] || status
                        return (
                          <button
                            key={status}
                            className={`gd-rsvp-btn${active ? ' active' : ''}`}
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
                  <div className="gd-event-form">
                    <input
                      className="gd-form-input"
                      placeholder={g.pollQuestionPlaceholder}
                      value={pollQuestion}
                      onChange={e => setPollQuestion(e.target.value)}
                      maxLength={500}
                    />
                    {pollOptions.map((opt, i) => (
                      <div key={i} className="gd-poll-option-input-row">
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
                    <div className="gd-form-actions" style={{ marginTop: 4 }}>
                      <button style={{ ...sFormSubmitBtn, opacity: (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2 || pollSaving) ? 0.6 : 1 }} onClick={handleCreatePoll} disabled={!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2 || pollSaving}>
                        {pollSaving ? '...' : g.createPollSubmit}
                      </button>
                      <button style={sFormCancelBtn} onClick={() => setShowPollForm(false)}>
                        {g.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={sAddDashedBtn} onClick={() => setShowPollForm(true)}>
                    {'+ '}{g.createPoll}
                  </button>
                )}
              </div>
            )}
            {pollsLoading ? (
              <div className="gd-feed-empty">{g.loading}</div>
            ) : polls.length === 0 ? (
              <div className="gd-feed-empty">{g.noPolls}</div>
            ) : polls.map(poll => {
              const voted = poll.user_vote !== null && poll.user_vote !== undefined
              const ended = poll.ends_at && new Date(poll.ends_at) < new Date()
              const totalVotes = (poll.options || []).reduce((sum, o) => sum + (o.vote_count || 0), 0)
              return (
                <div key={poll.id} className="gd-poll-card">
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 }}>{poll.question}</div>
                  {ended && <div className="gd-poll-status-tag">{g.pollEnded}</div>}
                  {voted && !ended && <div className="gd-poll-status-tag gd-poll-voted-tag">{g.pollVoted}</div>}
                  <div className="gd-poll-options">
                    {(poll.options || []).map((opt, i) => {
                      const label = lang === 'da' ? opt.text_da : (opt.text_en || opt.text_da)
                      const pct = totalVotes > 0 ? Math.round(((opt.vote_count || 0) / totalVotes) * 100) : 0
                      const isChosen = poll.user_vote === i
                      if (voted || ended) {
                        return (
                          <div key={i} className="gd-poll-result-row">
                            <div className="gd-poll-result-label-row">
                              <span style={{ fontSize: 13, color: '#555', fontWeight: isChosen ? 700 : 500, ...(isChosen ? { color: '#4338CA' } : {}) }}>{label}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{pct}%</span>
                            </div>
                            <div className="gd-poll-bar-wrap">
                              <div className={`gd-poll-bar${isChosen ? ' chosen' : ''}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div style={{ fontSize: 11, color: '#aaa' }}>
                              {opt.vote_count || 0} {(opt.vote_count || 0) === 1 ? g.pollVote : g.pollVotes}
                            </div>
                          </div>
                        )
                      }
                      return (
                        <button
                          key={i}
                          className="gd-poll-option-btn"
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
          <div className="gd-about-section">
            {(group.description_da || group.description_en) && (
              <div>
                <div className="gd-about-label">{g.descLabel}</div>
                <p className="gd-about-text">
                  {lang === 'da' ? group.description_da : (group.description_en || group.description_da)}
                </p>
              </div>
            )}
            <div>
              <div className="gd-about-label">{g.typeLabel}</div>
              <span className="gd-type-pill" style={{ background: typeMeta.bg, color: typeMeta.color, fontSize: 12, padding: '4px 12px' }}>
                {typeLabel}
              </span>
            </div>
            {group.category && (
              <div>
                <div className="gd-about-label">{g.categoryLabel}</div>
                <span className="gd-cat-pill">{g.category?.[group.category] || group.category}</span>
              </div>
            )}
            {group.tags && group.tags.length > 0 && (
              <div>
                <div className="gd-about-label">{g.tagsLabel}</div>
                <div className="gd-tag-list">
                  {group.tags.map((tag, i) => (
                    <span key={i} className="gd-tag-pill">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="gd-about-label">{group.member_count === 1 ? g.member : g.members}</div>
              <div className="gd-about-text">{'👥 '}{group.member_count}</div>
            </div>
            {group.created_at && (
              <div>
                <div className="gd-about-label">{g.createdLabel}</div>
                <div className="gd-about-text">
                  {new Date(group.created_at).toLocaleDateString(
                    getLocale(lang),
                    { day: 'numeric', month: 'long', year: 'numeric' }
                  )}
                </div>
              </div>
            )}
            {membership.isMember && (
              <div>
                <div className="gd-about-label">{g.inviteLink}</div>
                <div className="gd-invite-row">
                  <span className="gd-invite-link-text">
                    {inviteLink ? `${window.location.origin}${inviteLink}` : '…'}
                  </span>
                  <button className={`gd-copy-btn${copyState ? ' done' : ''}`} onClick={handleCopyLink} disabled={!inviteLink}>
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
              <div key={report.report_id} className="gd-mod-report">
                <div className="gd-mod-meta">
                  🚩 {g.modReportedBy} <strong>{report.reporter_name}</strong>
                  {report.reason && <> · {g.modReason}: {report.reason}</>}
                  <span style={{ marginLeft: 8 }}>{fmtTime(report.reported_at, lang)}</span>
                </div>
                <div className="gd-mod-content">
                  <strong>{report.author_name}</strong>{report.author_handle ? ` @${report.author_handle}` : ''}: {(report.text_da || '').slice(0, 300)}
                </div>
                <div className="gd-mod-actions">
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
          className="gd-report-overlay"
          onClick={() => setReportTarget(null)}
        >
          <div className="gd-report-modal" onClick={e => e.stopPropagation()}>
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
                <label className="gd-report-label">{t.reportReasonLabel}</label>
                <select
                  className="gd-report-select"
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
                <label className="gd-report-label">{t.reportDetailsLabel}</label>
                <textarea
                  className="gd-report-textarea"
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
    <div className="gd-mute-overlay" onClick={onClose}>
      <div className="gd-mute-modal" onClick={e => e.stopPropagation()}>
        <div className="gd-mute-title">{isMuted ? g.unmuteGroup : g.muteTitle}</div>
        {options.map(o => (
          <button key={o.label} className="gd-mute-option" onClick={() => onMute(o.minutes)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Static button styles that include color/border (not purely layout)
const sBackBtn = { fontSize: 13, padding: '8px 20px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }
const sJoinBtn = { fontSize: 13, fontWeight: 700, padding: '7px 18px', borderRadius: 20, border: '1.5px solid #4338CA', background: '#4338CA', color: '#fff', cursor: 'pointer' }
const sLeaveBtn = { fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 20, border: '1.5px solid #D1D5DB', background: '#fff', color: '#666', cursor: 'pointer' }
const sSettingsBtn = { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, border: '1.5px solid #E8E4DF', background: '#F9F7F5', color: '#555', cursor: 'pointer' }
const sMuteBtn = { fontSize: 18, padding: '5px 8px', borderRadius: 20, border: '1.5px solid #E8E4DF', background: '#F9F7F5', cursor: 'pointer', lineHeight: 1 }
const sFormSubmitBtn = { padding: '8px 18px', borderRadius: 8, border: 'none', background: '#5B4FCF', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
const sFormCancelBtn = { padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#666' }
const sAddDashedBtn = { padding: '8px 16px', borderRadius: 8, border: '1.5px dashed #C7C0F5', background: '#F5F3FF', color: '#5B4FCF', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
const sApproveMemberBtn = { padding: '4px 12px', borderRadius: 6, border: 'none', background: '#5B4FCF', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const sRejectMemberBtn = { padding: '4px 12px', borderRadius: 6, border: '1px solid #DC2626', background: '#fff', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
