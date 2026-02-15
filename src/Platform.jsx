import { useState, useCallback, useRef, useEffect } from 'react'
import { FRIENDS, POSTS, CURRENT_USER, MESSAGE_THREADS, PT, nameToColor, getInitials } from './data.js'
import { apiFetchFeed, apiCreatePost, apiToggleLike, apiAddComment, apiFetchProfile, apiFetchFriends, apiFetchMessages, apiSendMessage, apiUploadAvatar, apiCheckSession } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function Platform({ lang: initialLang, onLogout }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const [currentUser, setCurrentUser] = useState(CURRENT_USER)
  const t = PT[lang]

  const toggleLang = useCallback(() => setLang(p => p === 'da' ? 'en' : 'da'), [])

  // Load current user from session
  useEffect(() => {
    apiCheckSession().then(data => {
      if (data?.user) {
        setCurrentUser(prev => ({ ...prev, ...data.user }))
      }
    })
  }, [])

  const avatarSrc = currentUser.avatar_url
    ? (currentUser.avatar_url.startsWith('http') || currentUser.avatar_url.startsWith('blob:') ? currentUser.avatar_url : `${API_BASE}${currentUser.avatar_url}`)
    : null

  return (
    <div className="platform">
      {/* Platform nav */}
      <nav className="p-nav">
        <div className="p-nav-left">
          <div className="nav-logo" style={{ cursor: 'pointer' }} onClick={() => setPage('feed')}>
            <div className="nav-logo-icon">F</div>
            {t.navBrand}
          </div>
        </div>
        <div className="p-nav-tabs">
          {['feed', 'friends', 'messages', 'profile'].map(p => (
            <button
              key={p}
              className={`p-nav-tab${page === p ? ' active' : ''}`}
              onClick={() => setPage(p)}
            >
              <span className="p-nav-tab-icon">{p === 'feed' ? '🏠' : p === 'friends' ? '👥' : p === 'messages' ? '💬' : '👤'}</span>
              <span className="p-nav-tab-label">{t[p] || t[p + 'Label'] || p}</span>
            </button>
          ))}
        </div>
        <div className="p-nav-right">
          <button className="lang-toggle" onClick={toggleLang}>{t.langToggle}</button>
          {avatarSrc ? (
            <img className="p-nav-avatar-img" src={avatarSrc} alt="" onClick={() => setPage('profile')} />
          ) : (
            <div className="p-nav-avatar" style={{ background: nameToColor(currentUser.name), cursor: 'pointer' }} onClick={() => setPage('profile')}>
              {currentUser.initials || getInitials(currentUser.name)}
            </div>
          )}
          <button className="logout-btn" onClick={onLogout} title={lang === 'da' ? 'Log ud' : 'Log out'}>
            {lang === 'da' ? 'Log ud' : 'Log out'}
          </button>
        </div>
      </nav>

      <div className="p-content">
        {page === 'feed' && <FeedPage lang={lang} t={t} currentUser={currentUser} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} currentUser={currentUser} onUserUpdate={setCurrentUser} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} onMessage={() => setPage('messages')} />}
        {page === 'messages' && <MessagesPage lang={lang} t={t} currentUser={currentUser} />}
      </div>
    </div>
  )
}

// ── Media display component ──
function PostMedia({ media }) {
  if (!media?.length) return null
  const count = media.length
  return (
    <div className={`p-post-media p-post-media-${Math.min(count, 4)}`}>
      {media.map((m, i) => {
        const src = m.url.startsWith('http') ? m.url : `${API_BASE}${m.url}`
        if (m.type === 'video') {
          return (
            <video key={i} className="p-media-item" controls preload="metadata" playsInline>
              <source src={src} type={m.mime} />
            </video>
          )
        }
        return <img key={i} className="p-media-item" src={src} alt="" loading="lazy" />
      })}
    </div>
  )
}

// ── Feed ──
function FeedPage({ lang, t, currentUser }) {
  const [posts, setPosts] = useState(POSTS)
  const [newPostText, setNewPostText] = useState('')
  const [mediaFiles, setMediaFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [likedPosts, setLikedPosts] = useState(new Set())
  const [expandedComments, setExpandedComments] = useState(new Set())
  const [commentTexts, setCommentTexts] = useState({})
  const fileInputRef = useRef(null)

  // Try loading feed from API
  useEffect(() => {
    apiFetchFeed().then(data => {
      if (data) {
        setPosts(data)
        setLikedPosts(new Set(data.filter(p => p.liked).map(p => p.id)))
      }
    })
  }, [])

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files).slice(0, 4)
    setMediaFiles(files)
    const previews = files.map(f => ({
      url: URL.createObjectURL(f),
      type: f.type.startsWith('video/') ? 'video' : 'image',
      name: f.name,
    }))
    setMediaPreviews(previews)
  }, [])

  const removeMedia = useCallback((idx) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== idx))
    setMediaPreviews(prev => {
      URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const handlePost = useCallback(() => {
    if (!newPostText.trim()) return
    const text = newPostText.trim()
    const files = mediaFiles.length > 0 ? mediaFiles : null
    apiCreatePost(text, files).then(data => {
      if (data) {
        setPosts(prev => [data, ...prev])
      } else {
        const localMedia = mediaPreviews.length > 0
          ? mediaPreviews.map(p => ({ url: p.url, type: p.type, mime: '' }))
          : null
        setPosts(prev => [{
          id: Date.now(),
          author: currentUser.name,
          time: { da: 'Lige nu', en: 'Just now' },
          text: { da: text, en: text },
          likes: 0, comments: [], media: localMedia,
        }, ...prev])
      }
    })
    setNewPostText('')
    setMediaFiles([])
    setMediaPreviews([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [newPostText, mediaFiles, mediaPreviews, currentUser.name])

  const toggleLike = useCallback((id) => {
    setLikedPosts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    apiToggleLike(id).catch(() => {})
  }, [])

  const toggleComments = useCallback((id) => {
    setExpandedComments(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const handleComment = useCallback((postId) => {
    const text = commentTexts[postId]
    if (!text?.trim()) return
    apiAddComment(postId, text.trim()).then(data => {
      const comment = data || { author: currentUser.name, text: { da: text, en: text } }
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p
        return { ...p, comments: [...p.comments, comment] }
      }))
    })
    setCommentTexts(prev => ({ ...prev, [postId]: '' }))
  }, [commentTexts, currentUser.name])

  return (
    <div className="p-feed">
      {/* New post */}
      <div className="p-card p-new-post">
        <div className="p-new-post-row">
          <div className="p-avatar-sm" style={{ background: nameToColor(currentUser.name) }}>
            {currentUser.initials || getInitials(currentUser.name)}
          </div>
          <input
            className="p-new-post-input"
            placeholder={t.newPost}
            value={newPostText}
            onChange={e => setNewPostText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePost()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button className="p-media-btn" onClick={() => fileInputRef.current?.click()} title={lang === 'da' ? 'Tilføj billede/video' : 'Add image/video'}>
            📷
          </button>
          <button className="p-post-btn" onClick={handlePost} disabled={!newPostText.trim()}>{t.post}</button>
        </div>
        {mediaPreviews.length > 0 && (
          <div className="p-media-previews">
            {mediaPreviews.map((p, i) => (
              <div key={i} className="p-media-preview">
                {p.type === 'video' ? (
                  <video src={p.url} className="p-media-preview-thumb" />
                ) : (
                  <img src={p.url} alt="" className="p-media-preview-thumb" />
                )}
                <button className="p-media-preview-remove" onClick={() => removeMedia(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Posts */}
      {posts.map(post => {
        const liked = likedPosts.has(post.id)
        const showComments = expandedComments.has(post.id)
        return (
          <div key={post.id} className="p-card p-post">
            <div className="p-post-header">
              <div className="p-avatar-sm" style={{ background: nameToColor(post.author) }}>
                {getInitials(post.author)}
              </div>
              <div>
                <div className="p-post-author">{post.author}</div>
                <div className="p-post-time">{post.time[lang]}</div>
              </div>
            </div>
            <div className="p-post-body">{post.text[lang]}</div>
            {post.media && <PostMedia media={post.media} />}
            <div className="p-post-stats">
              <span>{post.likes + (liked ? 1 : 0)} {t.like.toLowerCase()}</span>
              <span onClick={() => toggleComments(post.id)} style={{ cursor: 'pointer' }}>
                {post.comments.length} {t.comment.toLowerCase()}{post.comments.length !== 1 ? (lang === 'da' ? 'er' : 's') : ''}
              </span>
            </div>
            <div className="p-post-actions">
              <button className={`p-action-btn${liked ? ' liked' : ''}`} onClick={() => toggleLike(post.id)}>
                {liked ? '❤️' : '🤍'} {t.like}
              </button>
              <button className="p-action-btn" onClick={() => toggleComments(post.id)}>
                💬 {t.comment}
              </button>
              <button className="p-action-btn">↗ {t.share}</button>
            </div>
            {showComments && (
              <div className="p-comments">
                {post.comments.map((c, i) => (
                  <div key={i} className="p-comment">
                    <div className="p-avatar-xs" style={{ background: nameToColor(c.author) }}>
                      {getInitials(c.author)}
                    </div>
                    <div className="p-comment-bubble">
                      <span className="p-comment-author">{c.author}</span>
                      <span>{c.text[lang]}</span>
                    </div>
                  </div>
                ))}
                <div className="p-comment-input-row">
                  <div className="p-avatar-xs" style={{ background: nameToColor(currentUser.name) }}>
                    {currentUser.initials || getInitials(currentUser.name)}
                  </div>
                  <input
                    className="p-comment-input"
                    placeholder={t.writeComment}
                    value={commentTexts[post.id] || ''}
                    onChange={e => setCommentTexts(prev => ({ ...prev, [post.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleComment(post.id)}
                  />
                  <button className="p-send-btn" onClick={() => handleComment(post.id)}>{t.send}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Profile ──
function ProfilePage({ lang, t, currentUser, onUserUpdate }) {
  const [profile, setProfile] = useState({ ...CURRENT_USER, ...currentUser })
  const [userPosts, setUserPosts] = useState(POSTS.filter(p => p.author === CURRENT_USER.name))
  const avatarInputRef = useRef(null)

  useEffect(() => {
    apiFetchProfile().then(data => {
      if (data) {
        setProfile(data)
        if (data.avatar_url || data.avatarUrl) {
          onUserUpdate(prev => ({ ...prev, avatar_url: data.avatarUrl || data.avatar_url }))
        }
      }
    })
    apiFetchFeed().then(data => {
      if (data) setUserPosts(data.filter(p => p.author === (currentUser.name || CURRENT_USER.name)))
    })
  }, [currentUser.name, onUserUpdate])

  const handleAvatarUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Optimistic preview
    const previewUrl = URL.createObjectURL(file)
    setProfile(prev => ({ ...prev, avatarUrl: previewUrl }))
    onUserUpdate(prev => ({ ...prev, avatar_url: previewUrl }))
    try {
      const data = await apiUploadAvatar(file)
      if (data?.avatarUrl) {
        setProfile(prev => ({ ...prev, avatarUrl: data.avatarUrl }))
        onUserUpdate(prev => ({ ...prev, avatar_url: data.avatarUrl }))
      }
    } catch {
      // Keep the local preview even if server fails
    }
  }, [onUserUpdate])

  const avatarUrl = profile.avatarUrl || profile.avatar_url
  const avatarSrc = avatarUrl
    ? (avatarUrl.startsWith('http') || avatarUrl.startsWith('blob:') ? avatarUrl : `${API_BASE}${avatarUrl}`)
    : null

  return (
    <div className="p-profile">
      <div className="p-card p-profile-card">
        <div className="p-profile-banner" />
        <div className="p-profile-info">
          <div className="p-profile-avatar-wrapper" onClick={() => avatarInputRef.current?.click()} title={lang === 'da' ? 'Skift profilbillede' : 'Change profile picture'}>
            {avatarSrc ? (
              <img className="p-profile-avatar-img" src={avatarSrc} alt="" />
            ) : (
              <div className="p-profile-avatar" style={{ background: nameToColor(profile.name) }}>
                {profile.initials || getInitials(profile.name)}
              </div>
            )}
            <div className="p-profile-avatar-overlay">📷</div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: 'none' }}
              onChange={handleAvatarUpload}
            />
          </div>
          <h2 className="p-profile-name">{profile.name}</h2>
          <p className="p-profile-handle">{profile.handle}</p>
          <p className="p-profile-bio">{profile.bio?.[lang] || profile.bio?.da || ''}</p>
          <div className="p-profile-meta">
            <span>📍 {profile.location}</span>
            <span>📅 {t.joined} {profile.joinDate}</span>
          </div>
          <div className="p-profile-stats">
            <div className="p-profile-stat">
              <strong>{profile.postCount}</strong>
              <span>{t.postsLabel}</span>
            </div>
            <div className="p-profile-stat">
              <strong>{profile.friendCount}</strong>
              <span>{t.friendsLabel}</span>
            </div>
            <div className="p-profile-stat">
              <strong>{(profile.photoCount || 0).toLocaleString()}</strong>
              <span>{t.photosLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* User's posts */}
      <h3 className="p-section-title">{t.postsLabel}</h3>
      {userPosts.map(post => (
        <div key={post.id} className="p-card p-post">
          <div className="p-post-header">
            <div className="p-avatar-sm" style={{ background: nameToColor(post.author) }}>{getInitials(post.author)}</div>
            <div>
              <div className="p-post-author">{post.author}</div>
              <div className="p-post-time">{post.time[lang]}</div>
            </div>
          </div>
          <div className="p-post-body">{post.text[lang]}</div>
          {post.media && <PostMedia media={post.media} />}
          <div className="p-post-stats">
            <span>{post.likes} {t.like.toLowerCase()}</span>
            <span>{post.comments.length} {t.comment.toLowerCase()}{post.comments.length !== 1 ? (lang === 'da' ? 'er' : 's') : ''}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Friends ──
function FriendsPage({ lang, t, onMessage }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState(FRIENDS)

  useEffect(() => {
    apiFetchFriends().then(data => {
      if (data) setFriends(data)
    })
  }, [])

  const filtered = friends.filter(f => {
    if (filter === 'online' && !f.online) return false
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="p-friends-page">
      <div className="p-card">
        <h3 className="p-section-title" style={{ margin: '0 0 16px' }}>{t.friendsTitle}</h3>
        <input
          className="p-search-input"
          placeholder={t.searchFriends}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="p-filter-tabs">
          <button className={`p-filter-tab${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
            {t.allFriends} ({friends.length})
          </button>
          <button className={`p-filter-tab${filter === 'online' ? ' active' : ''}`} onClick={() => setFilter('online')}>
            {t.onlineFriends} ({friends.filter(f => f.online).length})
          </button>
        </div>
      </div>

      <div className="p-friends-grid">
        {filtered.map((friend, idx) => (
          <div key={idx} className="p-card p-friend-card">
            <div className="p-friend-card-top">
              <div className="p-avatar-md" style={{ background: nameToColor(friend.name) }}>
                {getInitials(friend.name)}
                {friend.online && <div className="online-dot" />}
              </div>
              <div className="p-friend-card-name">{friend.name}</div>
              <div className="p-friend-card-mutual">{friend.mutual} {t.mutualFriends}</div>
            </div>
            <button className="p-friend-msg-btn" onClick={onMessage}>
              💬 {t.message}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Messages ──
function MessagesPage({ lang, t, currentUser }) {
  const [activeThread, setActiveThread] = useState(0)
  const [threads, setThreads] = useState(MESSAGE_THREADS)
  const [newMsg, setNewMsg] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    apiFetchMessages().then(data => {
      if (data) setThreads(data)
    })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [threads, activeThread])

  const handleSend = useCallback(() => {
    if (!newMsg.trim()) return
    const text = newMsg.trim()
    setThreads(prev => prev.map((thread, i) => {
      if (i !== activeThread) return thread
      return {
        ...thread,
        messages: [...thread.messages, {
          from: currentUser.name,
          text: { da: text, en: text },
          time: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
        }],
        unread: 0,
      }
    }))
    setNewMsg('')
    apiSendMessage(activeThread + 1, text).catch(() => {})
  }, [newMsg, activeThread, currentUser.name])

  const thread = threads[activeThread]

  return (
    <div className="p-messages">
      <div className="p-msg-sidebar">
        <h3 className="p-msg-sidebar-title">{t.messagesTitle}</h3>
        {threads.map((th, i) => (
          <div
            key={i}
            className={`p-msg-thread${i === activeThread ? ' active' : ''}`}
            onClick={() => { setActiveThread(i); setThreads(prev => prev.map((t, j) => j === i ? { ...t, unread: 0 } : t)) }}
          >
            <div className="p-avatar-sm" style={{ background: nameToColor(th.friend) }}>
              {getInitials(th.friend)}
            </div>
            <div className="p-msg-thread-info">
              <div className="p-msg-thread-name">
                {th.friend}
                {th.unread > 0 && <span className="p-msg-badge">{th.unread}</span>}
              </div>
              <div className="p-msg-thread-preview">
                {th.messages[th.messages.length - 1].text[lang].slice(0, 40)}...
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-msg-main">
        <div className="p-msg-header">
          <div className="p-avatar-sm" style={{ background: nameToColor(thread.friend) }}>
            {getInitials(thread.friend)}
          </div>
          <span className="p-msg-header-name">{thread.friend}</span>
        </div>
        <div className="p-msg-body">
          {thread.messages.map((msg, i) => {
            const isMe = msg.from === currentUser.name
            return (
              <div key={i} className={`p-msg-bubble-row${isMe ? ' mine' : ''}`}>
                {!isMe && (
                  <div className="p-avatar-xs" style={{ background: nameToColor(msg.from) }}>
                    {getInitials(msg.from)}
                  </div>
                )}
                <div className={`p-msg-bubble${isMe ? ' mine' : ''}`}>
                  <div>{msg.text[lang]}</div>
                  <div className="p-msg-time">{msg.time}</div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-msg-input-row">
          <input
            className="p-msg-input"
            placeholder={t.typeMessage}
            value={newMsg}
            onChange={e => setNewMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
          />
          <button className="p-send-btn" onClick={handleSend}>{t.send}</button>
        </div>
      </div>
    </div>
  )
}
