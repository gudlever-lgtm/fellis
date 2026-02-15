import { useState, useCallback, useRef, useEffect } from 'react'
import { FRIENDS, POSTS, CURRENT_USER, MESSAGE_THREADS, PT, nameToColor, getInitials } from './data.js'

export default function Platform({ lang: initialLang, onBackToLanding }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const t = PT[lang]

  const toggleLang = useCallback(() => setLang(p => p === 'da' ? 'en' : 'da'), [])

  return (
    <div className="platform">
      {/* Platform nav */}
      <nav className="p-nav">
        <div className="p-nav-left">
          <div className="nav-logo" onClick={onBackToLanding} style={{ cursor: 'pointer' }}>
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
          <div className="p-nav-avatar" style={{ background: nameToColor(CURRENT_USER.name) }}>
            {CURRENT_USER.initials}
          </div>
        </div>
      </nav>

      <div className="p-content">
        {page === 'feed' && <FeedPage lang={lang} t={t} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} onMessage={() => setPage('messages')} />}
        {page === 'messages' && <MessagesPage lang={lang} t={t} />}
      </div>
    </div>
  )
}

// ── Feed ──
function FeedPage({ lang, t }) {
  const [posts, setPosts] = useState(POSTS)
  const [newPostText, setNewPostText] = useState('')
  const [likedPosts, setLikedPosts] = useState(new Set())
  const [expandedComments, setExpandedComments] = useState(new Set())
  const [commentTexts, setCommentTexts] = useState({})

  const handlePost = useCallback(() => {
    if (!newPostText.trim()) return
    const newPost = {
      id: Date.now(),
      author: CURRENT_USER.name,
      time: { da: 'Lige nu', en: 'Just now' },
      text: { da: newPostText, en: newPostText },
      likes: 0,
      comments: [],
    }
    setPosts(prev => [newPost, ...prev])
    setNewPostText('')
  }, [newPostText])

  const toggleLike = useCallback((id) => {
    setLikedPosts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p
      return {
        ...p,
        comments: [...p.comments, { author: CURRENT_USER.name, text: { da: text, en: text } }],
      }
    }))
    setCommentTexts(prev => ({ ...prev, [postId]: '' }))
  }, [commentTexts])

  return (
    <div className="p-feed">
      {/* New post */}
      <div className="p-card p-new-post">
        <div className="p-new-post-row">
          <div className="p-avatar-sm" style={{ background: nameToColor(CURRENT_USER.name) }}>
            {CURRENT_USER.initials}
          </div>
          <input
            className="p-new-post-input"
            placeholder={t.newPost}
            value={newPostText}
            onChange={e => setNewPostText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePost()}
          />
          <button className="p-post-btn" onClick={handlePost} disabled={!newPostText.trim()}>{t.post}</button>
        </div>
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
                  <div className="p-avatar-xs" style={{ background: nameToColor(CURRENT_USER.name) }}>
                    {CURRENT_USER.initials}
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
function ProfilePage({ lang, t }) {
  return (
    <div className="p-profile">
      <div className="p-card p-profile-card">
        <div className="p-profile-banner" />
        <div className="p-profile-info">
          <div className="p-profile-avatar" style={{ background: nameToColor(CURRENT_USER.name) }}>
            {CURRENT_USER.initials}
          </div>
          <h2 className="p-profile-name">{CURRENT_USER.name}</h2>
          <p className="p-profile-handle">{CURRENT_USER.handle}</p>
          <p className="p-profile-bio">{CURRENT_USER.bio[lang]}</p>
          <div className="p-profile-meta">
            <span>📍 {CURRENT_USER.location}</span>
            <span>📅 {t.joined} {CURRENT_USER.joinDate}</span>
          </div>
          <div className="p-profile-stats">
            <div className="p-profile-stat">
              <strong>{CURRENT_USER.postCount}</strong>
              <span>{t.postsLabel}</span>
            </div>
            <div className="p-profile-stat">
              <strong>{CURRENT_USER.friendCount}</strong>
              <span>{t.friendsLabel}</span>
            </div>
            <div className="p-profile-stat">
              <strong>{CURRENT_USER.photoCount.toLocaleString()}</strong>
              <span>{t.photosLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* User's posts */}
      <h3 className="p-section-title">{t.postsLabel}</h3>
      {POSTS.filter(p => p.author === CURRENT_USER.name).map(post => (
        <div key={post.id} className="p-card p-post">
          <div className="p-post-header">
            <div className="p-avatar-sm" style={{ background: nameToColor(post.author) }}>{getInitials(post.author)}</div>
            <div>
              <div className="p-post-author">{post.author}</div>
              <div className="p-post-time">{post.time[lang]}</div>
            </div>
          </div>
          <div className="p-post-body">{post.text[lang]}</div>
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

  const filtered = FRIENDS.filter(f => {
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
            {t.allFriends} ({FRIENDS.length})
          </button>
          <button className={`p-filter-tab${filter === 'online' ? ' active' : ''}`} onClick={() => setFilter('online')}>
            {t.onlineFriends} ({FRIENDS.filter(f => f.online).length})
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
function MessagesPage({ lang, t }) {
  const [activeThread, setActiveThread] = useState(0)
  const [threads, setThreads] = useState(MESSAGE_THREADS)
  const [newMsg, setNewMsg] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [threads, activeThread])

  const handleSend = useCallback(() => {
    if (!newMsg.trim()) return
    setThreads(prev => prev.map((thread, i) => {
      if (i !== activeThread) return thread
      return {
        ...thread,
        messages: [...thread.messages, {
          from: CURRENT_USER.name,
          text: { da: newMsg, en: newMsg },
          time: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
        }],
        unread: 0,
      }
    }))
    setNewMsg('')
  }, [newMsg, activeThread])

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
            const isMe = msg.from === CURRENT_USER.name
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
