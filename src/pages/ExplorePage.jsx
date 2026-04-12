import { useState, useEffect, useRef, useCallback } from 'react'
import { nameToColor, getInitials, PT } from '../data.js'
import { apiGetTrendingTags, apiGetExploreFeed, apiGetSuggestedUsers, apiSendFriendRequest } from '../api.js'

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

function PostCard({ post, lang, onViewProfile }) {
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
        <div>
          <div
            className="p-post-author"
            style={onViewProfile ? { cursor: 'pointer' } : {}}
            onClick={() => onViewProfile && post.author_id && onViewProfile(post.author_id)}
          >
            {post.author}
          </div>
          <div className="p-post-time">{time}</div>
        </div>
      </div>
      {text && <div className="p-post-body">{text}</div>}
      {media.length > 0 && (
        <div className={`p-post-media p-post-media-${Math.min(media.length, 4)}`} style={{ marginTop: 8 }}>
          {media.slice(0, 4).map((m, i) => (
            <div key={i} className="p-media-item">
              {m.type === 'video'
                ? <video src={m.url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
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

export default function ExplorePage({ lang, onViewProfile }) {
  const da = lang === 'da'
  const t = {
    title: da ? 'Udforsk' : 'Explore',
    trendingTags: da ? 'Populære emner' : 'Trending topics',
    suggestedProfiles: da ? 'Foreslåede profiler' : 'Suggested profiles',
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
  const [activeTag, setActiveTag] = useState(null)
  const [filter, setFilter] = useState('all')
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef(null)

  // Fetch trending tags + suggested on mount
  useEffect(() => {
    apiGetTrendingTags().then(d => setTags(Array.isArray(d) ? d : []))
    apiGetSuggestedUsers(6).then(d => setSuggested(Array.isArray(d) ? d : []))
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
        <PostCard key={post.id} post={post} lang={lang} onViewProfile={onViewProfile} />
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
    </div>
  )
}
