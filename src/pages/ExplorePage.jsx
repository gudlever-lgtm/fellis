import { useState, useEffect, useRef, useCallback } from 'react'
import { nameToColor, getInitials, PT } from '../data.js'
import { apiGetTrendingTags, apiGetExploreFeed, apiGetSuggestedUsers, apiSendFriendRequest, apiGetExploreGroupPosts, apiReportContent } from '../api.js'

const FILTERS = ['all', 'images']

function timeAgo(dateStr, lang) {
  const t = PT[lang]
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return t.justNow
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m}${t.timeAgoMinutes}` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h}${t.timeAgoHours}` }
  const d = Math.floor(diff / 86400)
  return `${d}${d !== 1 ? t.timeAgoDaysPlural : t.timeAgoDays}`
}

function PostCard({ post, lang, onViewProfile, onReport, onImageClick }) {
  const text = post.text?.[lang] || post.text?.da || ''
  const time = post.created_at ? timeAgo(post.created_at, lang) : (post.time?.[lang] || post.time?.da || '')
  const media = post.media || []

  return (
    <div className="p-card p-post">
      <div className="p-post-header">
        <div
          className="p-avatar-sm"
          style={{ background: nameToColor(post.author || ''), cursor: onViewProfile ? 'pointer' : 'default' }}
          onClick={() => onViewProfile && post.author_id && onViewProfile(post.author_id)}
        >
          {post.avatar_url
            ? <img src={post.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : (post.initials || getInitials(post.author || ''))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="p-post-author"
            style={onViewProfile ? { cursor: 'pointer' } : {}}
            onClick={() => onViewProfile && post.author_id && onViewProfile(post.author_id)}
          >
            {post.author}
          </div>
          <div className="p-post-time">{time}</div>
        </div>
        {onReport && (
          <button
            onClick={() => onReport(post.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 14, padding: '2px 6px', borderRadius: 6, flexShrink: 0 }}
            title={PT[lang].redFlagTitlePost}
          >
            🚩
          </button>
        )}
      </div>
      {text && <div className="p-post-body">{text}</div>}
      {media.length > 0 && (
        <div className={`p-post-media p-post-media-${Math.min(media.length, 4)}`} style={{ marginTop: 8 }}>
          {media.slice(0, 4).map((m, i) => (
            <div key={i} className="p-media-item">
              {m.type === 'video'
                ? <video src={m.url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} onClick={() => onImageClick && onImageClick(m.url)} />}
            </div>
          ))}
        </div>
      )}
      <div className="p-post-stats" style={{ marginTop: 10, fontSize: 13, color: '#A09890', display: 'flex', gap: 12 }}>
        <span>{post.likes} {PT[lang].likes}</span>
        {post.comment_count > 0 && <span>{post.comment_count} {PT[lang].reelsComments}</span>}
      </div>
    </div>
  )
}

function SuggestedCard({ user, lang, onViewProfile }) {
  const [following, setFollowing] = useState(false)

  const handleFollow = async () => {
    await apiSendFriendRequest(user.id)
    setFollowing(true)
  }

  return (
    <div className="explore-suggested-card">
      <div
        className="p-avatar-md"
        style={{ background: nameToColor(user.name || ''), cursor: 'pointer' }}
        onClick={() => onViewProfile && onViewProfile(user.id)}
      >
        {user.avatar_url
          ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          : (user.initials || getInitials(user.name || ''))}
      </div>
      <div className="explore-suggested-name">{user.name}</div>
      <div className="explore-suggested-followers">
        {user.follower_count} {PT[lang].friends2}
        {user.shared_interests > 0 && ` · ${user.shared_interests} ${PT[lang].shared3}`}
      </div>
      <button
        className={`explore-follow-btn${following ? ' following' : ''}`}
        onClick={handleFollow}
        disabled={following}
      >
        {following ? (PT[lang].requestSent) : (PT[lang].addFriend)}
      </button>
    </div>
  )
}

function GroupPostCard({ post, lang, onViewProfile, onNavigate, onReport, onImageClick }) {
  const text = post.text?.[lang] || post.text?.da || ''
  const time = post.created_at ? timeAgo(post.created_at, lang) : ''
  const media = post.media || []
  const da = lang === 'da'

  return (
    <div className="p-card p-post">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <button
          onClick={() => onNavigate && post.group_slug && onNavigate(`/groups/${post.group_slug}`)}
          style={{ background: '#f0f7f4', border: 'none', borderRadius: 12, padding: '3px 10px', fontSize: 12, color: '#2D6A4F', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          🫂 {post.group_name}
        </button>
      </div>
      <div className="p-post-header">
        <div
          className="p-avatar-sm"
          style={{ background: nameToColor(post.author || ''), cursor: onViewProfile ? 'pointer' : 'default' }}
          onClick={() => onViewProfile && post.author_id && onViewProfile(post.author_id)}
        >
          {post.avatar_url
            ? <img src={post.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : (post.initials || getInitials(post.author || ''))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="p-post-author"
            style={onViewProfile ? { cursor: 'pointer' } : {}}
            onClick={() => onViewProfile && post.author_id && onViewProfile(post.author_id)}
          >
            {post.author}
          </div>
          <div className="p-post-time">{time}</div>
        </div>
        {onReport && (
          <button
            onClick={() => onReport(post.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 14, padding: '2px 6px', borderRadius: 6, flexShrink: 0 }}
            title={PT[lang].redFlagTitlePost}
          >
            🚩
          </button>
        )}
      </div>
      {text && <div className="p-post-body">{text}</div>}
      {media.length > 0 && (
        <div className={`p-post-media p-post-media-${Math.min(media.length, 4)}`} style={{ marginTop: 8 }}>
          {media.slice(0, 4).map((m, i) => (
            <div key={i} className="p-media-item">
              {m.type === 'video'
                ? <video src={m.url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} onClick={() => onImageClick && onImageClick(m.url)} />}
            </div>
          ))}
        </div>
      )}
      <div className="p-post-stats" style={{ marginTop: 10, fontSize: 13, color: '#A09890', display: 'flex', gap: 12 }}>
        <span>{post.likes} {PT[lang].likes}</span>
        {post.comment_count > 0 && <span>{post.comment_count} {PT[lang].reelsComments}</span>}
      </div>
      <button
        onClick={() => onNavigate && post.group_slug && onNavigate(`/groups/${post.group_slug}`)}
        style={{ marginTop: 8, background: 'none', border: '1px solid #d4e9de', borderRadius: 8, padding: '5px 12px', fontSize: 12, color: '#2D6A4F', cursor: 'pointer', width: '100%' }}
      >
        {da ? 'Se gruppe' : 'View group'} →
      </button>
    </div>
  )
}

export default function ExplorePage({ lang, currentUser, onViewProfile, onNavigate }) {
  const da = lang === 'da'
  const t = {
    title: da ? 'Udforsk' : 'Explore',
    trendingTags: da ? 'Populære emner' : 'Trending topics',
    suggestedProfiles: da ? 'Foreslåede profiler' : 'Suggested profiles',
    groupPosts: da ? 'Fra offentlige grupper' : 'From public groups',
    filter: {
      all: da ? 'Alt' : 'All',
      images: da ? 'Billeder' : 'Images',
    },
    loadMore: da ? 'Hent flere' : 'Load more',
    noMore: da ? 'Ikke flere opslag' : 'No more posts',
    loading: da ? 'Henter...' : 'Loading...',
    activeTag: da ? 'Viser' : 'Showing',
    clearTag: da ? 'Vis alt' : 'Show all',
  }

  const [tags, setTags] = useState([])
  const [suggested, setSuggested] = useState([])
  const [groupPosts, setGroupPosts] = useState([])
  const [activeTag, setActiveTag] = useState(null)
  const [filter, setFilter] = useState('all')
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef(null)

  // Lightbox state
  const [lightboxUrl, setLightboxUrl] = useState(null)

  // Red flag modal state
  const [reportPostId, setReportPostId] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportStatus, setReportStatus] = useState('idle') // idle | submitting | done | duplicate

  const openReport = currentUser ? (id) => { setReportPostId(id); setReportReason(''); setReportDetails(''); setReportStatus('idle') } : null

  // Fetch trending tags, suggested users, and group posts on mount
  useEffect(() => {
    apiGetTrendingTags().then(d => setTags(Array.isArray(d) ? d : []))
    apiGetSuggestedUsers(6).then(d => setSuggested(Array.isArray(d) ? d : []))
    apiGetExploreGroupPosts().then(d => setGroupPosts(Array.isArray(d?.posts) ? d.posts : []))
  }, [])

  const fetchPosts = useCallback(async (reset = false) => {
    if (loading) return
    setLoading(true)
    const data = await apiGetExploreFeed(reset ? null : cursor, filter, activeTag)
    if (data) {
      const newPosts = data.posts || []
      setPosts(prev => reset ? newPosts : [...prev, ...newPosts])
      setCursor(data.nextCursor)
      setHasMore(!!data.nextCursor)
    } else {
      setHasMore(false)
    }
    setLoading(false)
  }, [filter, activeTag, cursor, loading])

  // Reset when filter or tag changes
  useEffect(() => {
    setPosts([])
    setCursor(null)
    setHasMore(true)
    setLoading(false)
  }, [filter, activeTag])

  // Initial load after reset
  useEffect(() => {
    fetchPosts(true)
  }, [filter, activeTag])  // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading) fetchPosts(false)
    }, { threshold: 0.5 })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loading, fetchPosts])

  const pt = PT[lang]

  return (
    <div className="explore-page">
      <h2 style={{ margin: '16px 0 4px', fontSize: 20, fontWeight: 700 }}>🧭 {t.title}</h2>

      {/* Trending hashtags */}
      {tags.length > 0 && (
        <>
          <div className="explore-section-title">{t.trendingTags}</div>
          <div className="explore-tags-bar">
            {tags.map(tag => (
              <button
                key={tag.tag}
                className={`explore-tag-pill${activeTag === tag.tag ? ' active' : ''}`}
                onClick={() => setActiveTag(activeTag === tag.tag ? null : tag.tag)}
              >
                #{tag.tag}
                <span style={{ fontSize: 11, opacity: 0.75, marginLeft: 4 }}>{tag.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Active tag banner */}
      {activeTag && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0', fontSize: 13, color: '#2D6A4F', fontWeight: 600 }}>
          <span>{t.activeTag}: #{activeTag}</span>
          <button
            onClick={() => setActiveTag(null)}
            style={{ background: 'none', border: '1px solid #b7dfc9', borderRadius: 12, padding: '2px 10px', fontSize: 12, color: '#2D6A4F', cursor: 'pointer' }}
          >
            {t.clearTag}
          </button>
        </div>
      )}

      {/* Suggested profiles */}
      {suggested.length > 0 && (
        <>
          <div className="explore-section-title">{t.suggestedProfiles}</div>
          <div className="explore-suggested-grid">
            {suggested.map(u => (
              <SuggestedCard key={u.id} user={u} lang={lang} onViewProfile={onViewProfile} />
            ))}
          </div>
        </>
      )}

      {/* Public group posts based on user interests */}
      {groupPosts.length > 0 && (
        <>
          <div className="explore-section-title">{t.groupPosts}</div>
          {groupPosts.map(post => (
            <GroupPostCard key={post.id} post={post} lang={lang} onViewProfile={onViewProfile} onNavigate={onNavigate} onReport={openReport} onImageClick={setLightboxUrl} />
          ))}
        </>
      )}

      {/* Feed filter pills */}
      <div className="explore-filter-row">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`explore-filter-btn${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t.filter[f]}
          </button>
        ))}
      </div>

      {/* Explore feed */}
      {posts.map(post => (
        <PostCard key={post.id} post={post} lang={lang} onViewProfile={onViewProfile} onReport={openReport} onImageClick={setLightboxUrl} />
      ))}

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#A09890', fontSize: 14 }}>
          {t.loading}
        </div>
      )}
      {!loading && !hasMore && posts.length > 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#A09890', fontSize: 13 }}>
          {t.noMore}
        </div>
      )}
      <div ref={sentinelRef} style={{ height: 4 }} />

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 8, objectFit: 'contain', boxShadow: '0 8px 48px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            style={{ position: 'fixed', top: 20, right: 24, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, fontSize: 20, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >✕</button>
        </div>
      )}

      {/* Red Flag modal */}
      {reportPostId !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setReportPostId(null)}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{pt.redFlagTitlePost}</h3>
            {reportStatus === 'done' && <div style={{ color: '#2D6A4F', fontWeight: 600, marginBottom: 12 }}>✓ {pt.reportDone}</div>}
            {reportStatus === 'duplicate' && <div style={{ color: '#888', marginBottom: 12 }}>{pt.reportDuplicate}</div>}
            {reportStatus !== 'done' && (
              <form onSubmit={async e => {
                e.preventDefault()
                if (!reportReason) return
                setReportStatus('submitting')
                const data = await apiReportContent('post', reportPostId, reportReason, reportDetails).catch(() => null)
                if (data?.duplicate) { setReportStatus('duplicate'); return }
                setReportStatus('done')
                setTimeout(() => setReportPostId(null), 1800)
              }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>{pt.reportReasonLabel}</label>
                <select
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', marginBottom: 12 }}
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  <option value="spam">{pt.reportReasonSpam}</option>
                  <option value="hate">{pt.reportReasonHate}</option>
                  <option value="harassment">{pt.reportReasonHarassment}</option>
                  <option value="misinformation">{pt.reportReasonMisinformation}</option>
                  <option value="violence">{pt.reportReasonViolence}</option>
                  <option value="nudity">{pt.reportReasonNudity}</option>
                  <option value="other">{pt.reportReasonOther}</option>
                </select>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>{pt.reportDetailsLabel}</label>
                <textarea
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', marginBottom: 14 }}
                  value={reportDetails}
                  onChange={e => setReportDetails(e.target.value)}
                  placeholder={pt.reportDetailsPlaceholder}
                  maxLength={500}
                />
                <div>
                  <button type="submit" style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: '#E07A5F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }} disabled={!reportReason || reportStatus === 'submitting'}>
                    {reportStatus === 'submitting' ? '…' : pt.reportSubmit}
                  </button>
                  <button type="button" style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #E8E4DF', background: 'none', fontSize: 14, cursor: 'pointer', marginLeft: 8 }} onClick={() => setReportPostId(null)}>
                    {pt.cancel}
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
