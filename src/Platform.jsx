import { useState, useCallback, useRef, useEffect } from 'react'
import { PT, nameToColor, getInitials } from './data.js'
import { apiFetchFeed, apiCreatePost, apiToggleLike, apiAddComment, apiEditPost, apiDeletePost, apiFetchProfile, apiFetchFriends, apiFetchMessages, apiSendMessage, apiUploadAvatar, apiCheckSession, apiDeleteFacebookData, apiDeleteAccount, apiExportData, apiGetConsentStatus, apiWithdrawConsent } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function Platform({ lang: initialLang, onLogout }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const [currentUser, setCurrentUser] = useState({ name: '', handle: '', initials: '' })
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const avatarMenuRef = useRef(null)
  const t = PT[lang]

  const toggleLang = useCallback(() => setLang(p => p === 'da' ? 'en' : 'da'), [])

  // Load current user from session
  useEffect(() => {
    apiCheckSession().then(data => {
      if (data?.user) {
        setCurrentUser(prev => ({ ...prev, ...data.user }))
      } else {
        // Session expired — log out
        onLogout()
      }
    }).catch(() => {
      onLogout()
    })
  }, [onLogout])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAvatarMenu) return
    const handleClick = (e) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target)) {
        setShowAvatarMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAvatarMenu])

  const navigateTo = useCallback((p) => {
    setPage(p)
    setShowAvatarMenu(false)
  }, [])

  const avatarSrc = currentUser.avatar_url
    ? (currentUser.avatar_url.startsWith('http') || currentUser.avatar_url.startsWith('blob:') ? currentUser.avatar_url : `${API_BASE}${currentUser.avatar_url}`)
    : null

  const menuT = lang === 'da' ? {
    viewProfile: 'Se profil',
    editProfile: 'Rediger profil',
    privacy: 'Privatliv & Data',
    logout: 'Log ud',
  } : {
    viewProfile: 'View profile',
    editProfile: 'Edit profile',
    privacy: 'Privacy & Data',
    logout: 'Log out',
  }

  return (
    <div className="platform">
      {/* Platform nav — only Feed, Friends, Messages in main tabs */}
      <nav className="p-nav">
        <div className="p-nav-left">
          <div className="nav-logo" style={{ cursor: 'pointer' }} onClick={() => navigateTo('feed')}>
            <div className="nav-logo-icon">F</div>
            {t.navBrand}
          </div>
        </div>
        <div className="p-nav-tabs">
          {['feed', 'friends', 'messages'].map(p => (
            <button
              key={p}
              className={`p-nav-tab${page === p ? ' active' : ''}`}
              onClick={() => navigateTo(p)}
            >
              <span className="p-nav-tab-icon">{p === 'feed' ? '🏠' : p === 'friends' ? '👥' : '💬'}</span>
              <span className="p-nav-tab-label">{t[p] || p}</span>
            </button>
          ))}
        </div>
        <div className="p-nav-right">
          <button className="lang-toggle" onClick={toggleLang}>{t.langToggle}</button>
          {/* Avatar with dropdown menu */}
          <div ref={avatarMenuRef} style={{ position: 'relative' }}>
            {avatarSrc ? (
              <img className="p-nav-avatar-img" src={avatarSrc} alt="" onClick={() => setShowAvatarMenu(v => !v)} />
            ) : (
              <div className="p-nav-avatar" style={{ background: nameToColor(currentUser.name), cursor: 'pointer' }} onClick={() => setShowAvatarMenu(v => !v)}>
                {currentUser.initials || getInitials(currentUser.name)}
              </div>
            )}
            {showAvatarMenu && (
              <div className="avatar-dropdown">
                <div className="avatar-dropdown-header">
                  <strong>{currentUser.name}</strong>
                  <span style={{ fontSize: 12, color: '#888' }}>{currentUser.handle}</span>
                </div>
                <div className="avatar-dropdown-divider" />
                <button className="avatar-dropdown-item" onClick={() => navigateTo('profile')}>
                  <span>👤</span> {menuT.viewProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('edit-profile')}>
                  <span>✏️</span> {menuT.editProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('privacy')}>
                  <span>🔒</span> {menuT.privacy}
                </button>
                <div className="avatar-dropdown-divider" />
                <button className="avatar-dropdown-item avatar-dropdown-danger" onClick={() => { setShowAvatarMenu(false); onLogout() }}>
                  <span>🚪</span> {menuT.logout}
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="p-content">
        {page === 'feed' && <FeedPage lang={lang} t={t} currentUser={currentUser} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} currentUser={currentUser} onUserUpdate={setCurrentUser} />}
        {page === 'edit-profile' && <EditProfilePage lang={lang} t={t} currentUser={currentUser} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} onMessage={() => navigateTo('messages')} />}
        {page === 'messages' && <MessagesPage lang={lang} t={t} currentUser={currentUser} />}
        {page === 'privacy' && <PrivacySection lang={lang} onLogout={onLogout} />}
      </div>
    </div>
  )
}

// ── Media display component ──
// ── Lightbox modal ──
function Lightbox({ src, type, mime, onClose }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={e => e.stopPropagation()}>
        {type === 'video' ? (
          <video className="lightbox-media" controls autoPlay playsInline>
            <source src={src} type={mime} />
          </video>
        ) : (
          <img className="lightbox-media" src={src} alt="" />
        )}
      </div>
      <button className="lightbox-close" onClick={onClose}>✕</button>
    </div>
  )
}

function PostMedia({ media }) {
  const [lightbox, setLightbox] = useState(null)
  if (!media?.length) return null
  const count = media.length
  return (
    <>
      <div className={`p-post-media p-post-media-${Math.min(count, 4)}`}>
        {media.map((m, i) => {
          const src = m.url.startsWith('http') ? m.url : `${API_BASE}${m.url}`
          if (m.type === 'video') {
            return (
              <video key={i} className="p-media-item" controls preload="metadata" playsInline
                onClick={() => setLightbox({ src, type: 'video', mime: m.mime })}>
                <source src={src} type={m.mime} />
              </video>
            )
          }
          return <img key={i} className="p-media-item p-media-clickable" src={src} alt="" loading="lazy"
            onClick={() => setLightbox({ src, type: 'image' })} />
        })}
      </div>
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}

// ── Feed ──
function FeedPage({ lang, t, currentUser }) {
  const [posts, setPosts] = useState([])
  const [newPostText, setNewPostText] = useState('')
  const [mediaFiles, setMediaFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [likedPosts, setLikedPosts] = useState(new Set())
  const [expandedComments, setExpandedComments] = useState(new Set())
  const [commentTexts, setCommentTexts] = useState({})
  const [commentMedia, setCommentMedia] = useState({})
  const [reactions, setReactions] = useState({})
  const [reactionPicker, setReactionPicker] = useState(null)
  const [postMenu, setPostMenu] = useState(null)
  const [editingPost, setEditingPost] = useState(null)
  const [editText, setEditText] = useState('')
  const pickerTimeout = useRef(null)
  const fileInputRef = useRef(null)
  const commentFileRefs = useRef({})

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

  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡']

  const toggleLike = useCallback((id) => {
    setReactions(prev => {
      if (prev[id]) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: '👍' }
    })
    setLikedPosts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    apiToggleLike(id).catch(() => {})
  }, [])

  const selectReaction = useCallback((postId, emoji) => {
    setReactions(prev => ({ ...prev, [postId]: emoji }))
    setLikedPosts(prev => {
      const next = new Set(prev)
      if (!next.has(postId)) {
        next.add(postId)
        apiToggleLike(postId).catch(() => {})
      }
      return next
    })
    setReactionPicker(null)
  }, [])

  const canEditDelete = useCallback((post) => {
    if (!post.isOwn) return false
    if (!post.createdAt) return true
    return Date.now() - new Date(post.createdAt).getTime() < 10 * 60 * 1000
  }, [])

  const handleEditPost = useCallback((post) => {
    setEditingPost(post.id)
    setEditText(post.text[lang] || post.text.da)
    setPostMenu(null)
  }, [lang])

  const handleSaveEdit = useCallback((postId) => {
    if (!editText.trim()) return
    apiEditPost(postId, editText.trim()).then(data => {
      if (data && !data.error) {
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, text: { da: editText.trim(), en: editText.trim() }, edited: true } : p))
      } else {
        alert(data?.error || (lang === 'da' ? 'Kunne ikke redigere' : 'Could not edit'))
      }
    })
    setEditingPost(null)
    setEditText('')
  }, [editText, lang])

  const handleDeletePost = useCallback((post) => {
    setPostMenu(null)
    const msg = lang === 'da' ? 'Er du sikker på du vil slette dette opslag?' : 'Are you sure you want to delete this post?'
    if (!confirm(msg)) return
    apiDeletePost(post.id).then(data => {
      if (data && !data.error) {
        setPosts(prev => prev.filter(p => p.id !== post.id))
      } else {
        alert(data?.error || (lang === 'da' ? 'Kunne ikke slette' : 'Could not delete'))
      }
    })
  }, [lang])

  const toggleComments = useCallback((id) => {
    setExpandedComments(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const handleCommentFileSelect = useCallback((postId, e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = {
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
      file,
    }
    setCommentMedia(prev => ({ ...prev, [postId]: preview }))
  }, [])

  const removeCommentMedia = useCallback((postId) => {
    setCommentMedia(prev => {
      if (prev[postId]) URL.revokeObjectURL(prev[postId].url)
      const next = { ...prev }
      delete next[postId]
      return next
    })
  }, [])

  const handleComment = useCallback((postId) => {
    const text = commentTexts[postId]
    const media = commentMedia[postId]
    if (!text?.trim() && !media) return
    const commentText = (text || '').trim()
    const localMedia = media ? [{ url: media.url, type: media.type, mime: '' }] : null
    apiAddComment(postId, commentText).then(data => {
      const comment = data || { author: currentUser.name, text: { da: commentText, en: commentText }, media: localMedia }
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p
        return { ...p, comments: [...p.comments, comment] }
      }))
    })
    setCommentTexts(prev => ({ ...prev, [postId]: '' }))
    setCommentMedia(prev => {
      const next = { ...prev }
      delete next[postId]
      return next
    })
    if (commentFileRefs.current[postId]) commentFileRefs.current[postId].value = ''
  }, [commentTexts, commentMedia, currentUser.name])

  return (
    <div className="p-feed">
      {/* New post */}
      <div className="p-card p-new-post">
        <div className="p-new-post-row">
          <div className="p-avatar-sm" style={{ background: nameToColor(currentUser.name) }}>
            {currentUser.initials || getInitials(currentUser.name)}
          </div>
          <div className="p-post-help-wrapper">
          <textarea
            className="p-new-post-input"
            placeholder={t.newPost}
            value={newPostText}
            rows={1}
            onChange={e => { setNewPostText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }}
            onPaste={e => {
              const items = Array.from(e.clipboardData?.items || [])
              const imageItems = items.filter(item => item.type.startsWith('image/'))
              if (imageItems.length > 0) {
                e.preventDefault()
                const files = imageItems.map(item => item.getAsFile()).filter(Boolean)
                setMediaFiles(prev => [...prev, ...files].slice(0, 4))
                setMediaPreviews(prev => [...prev, ...files.map(f => ({
                  url: URL.createObjectURL(f),
                  type: 'image',
                  name: f.name,
                }))].slice(0, 4))
              }
            }}
          />
          <div className="p-post-help-tip">
            <span className="p-post-help-icon">?</span>
            <div className="p-post-help-tooltip">
              {lang === 'da'
                ? '• Shift+Enter for linjeskift\n• Enter for at poste\n• Ctrl+V for at indsætte billeder\n• Op til 4 billeder/videoer\n• ••• på dine opslag: rediger/slet (10 min)'
                : '• Shift+Enter for new line\n• Enter to post\n• Ctrl+V to paste images\n• Up to 4 images/videos\n• ••• on your posts: edit/delete (10 min)'}
            </div>
          </div>
          </div>
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
              <div style={{ flex: 1 }}>
                <div className="p-post-author">{post.author}</div>
                <div className="p-post-time">
                  {post.time[lang]}
                  {post.edited && <span className="p-post-edited"> · {lang === 'da' ? 'redigeret' : 'edited'}</span>}
                </div>
              </div>
              {post.isOwn && canEditDelete(post) && (
                <div className="p-post-menu-wrapper">
                  <button className="p-post-menu-btn" onClick={() => setPostMenu(postMenu === post.id ? null : post.id)}>•••</button>
                  {postMenu === post.id && (
                    <div className="p-post-menu">
                      <button onClick={() => handleEditPost(post)}>{lang === 'da' ? 'Rediger opslag' : 'Edit post'}</button>
                      <button className="p-post-menu-delete" onClick={() => handleDeletePost(post)}>{lang === 'da' ? 'Slet opslag' : 'Delete post'}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {editingPost === post.id ? (
              <div className="p-post-edit">
                <textarea
                  className="p-post-edit-input"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  autoFocus
                />
                <div className="p-post-edit-actions">
                  <button className="p-post-edit-cancel" onClick={() => { setEditingPost(null); setEditText('') }}>{lang === 'da' ? 'Annuller' : 'Cancel'}</button>
                  <button className="p-post-edit-save" onClick={() => handleSaveEdit(post.id)}>{lang === 'da' ? 'Gem' : 'Save'}</button>
                </div>
              </div>
            ) : (
              <div className="p-post-body">{post.text[lang]}</div>
            )}
            {post.media && <PostMedia media={post.media} />}
            <div className="p-post-stats">
              <span>{liked && reactions[post.id] ? reactions[post.id] + ' ' : ''}{post.likes + (liked ? 1 : 0)} {t.like.toLowerCase()}</span>
              <span onClick={() => toggleComments(post.id)} style={{ cursor: 'pointer' }}>
                {post.comments.length} {t.comment.toLowerCase()}{post.comments.length !== 1 ? (lang === 'da' ? 'er' : 's') : ''}
              </span>
            </div>
            <div className="p-post-actions">
              <div className="p-like-wrapper"
                onMouseEnter={() => { pickerTimeout.current = setTimeout(() => setReactionPicker(post.id), 500) }}
                onMouseLeave={() => { clearTimeout(pickerTimeout.current); setReactionPicker(null) }}
              >
                {reactionPicker === post.id && (
                  <div className="p-reaction-picker">
                    {REACTIONS.map(emoji => (
                      <button key={emoji} className="p-reaction-emoji" onClick={() => selectReaction(post.id, emoji)}>{emoji}</button>
                    ))}
                  </div>
                )}
                <button className={`p-action-btn${liked ? ' liked' : ''}`} onClick={() => toggleLike(post.id)}>
                  {liked ? (reactions[post.id] || '👍') : '🤍'} {t.like}
                </button>
              </div>
              <button className="p-action-btn" onClick={() => toggleComments(post.id)}>
                💬 {t.comment}
              </button>
              <button className="p-action-btn" onClick={() => {
                const url = `${window.location.origin}/#post-${post.id}`
                if (navigator.share) {
                  navigator.share({ title: post.author, text: post.text[lang], url })
                } else {
                  navigator.clipboard.writeText(url).then(() => alert(lang === 'da' ? 'Link kopieret!' : 'Link copied!'))
                }
              }}>↗ {t.share}</button>
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
                      {c.media?.length > 0 && (
                        <div className="p-comment-media">
                          <PostMedia media={c.media} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {/* Comment media preview */}
                {commentMedia[post.id] && (
                  <div className="p-comment-media-preview">
                    {commentMedia[post.id].type === 'video' ? (
                      <video src={commentMedia[post.id].url} className="p-comment-media-thumb" />
                    ) : (
                      <img src={commentMedia[post.id].url} alt="" className="p-comment-media-thumb" />
                    )}
                    <button className="p-media-preview-remove" onClick={() => removeCommentMedia(post.id)}>✕</button>
                  </div>
                )}
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
                  <input
                    ref={el => commentFileRefs.current[post.id] = el}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
                    style={{ display: 'none' }}
                    onChange={e => handleCommentFileSelect(post.id, e)}
                  />
                  <button className="p-comment-media-btn" onClick={() => commentFileRefs.current[post.id]?.click()} title={lang === 'da' ? 'Tilføj billede/video' : 'Add image/video'}>
                    📷
                  </button>
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

// ── Profile (clean — read-only view) ──
function ProfilePage({ lang, t, currentUser, onUserUpdate }) {
  const [profile, setProfile] = useState({ ...currentUser })
  const [userPosts, setUserPosts] = useState([])
  const [showPassword, setShowPassword] = useState(false)

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
      if (data) setUserPosts(data.filter(p => p.author === currentUser.name))
    })
  }, [currentUser.name, onUserUpdate])

  const avatarUrl = profile.avatarUrl || profile.avatar_url
  const avatarSrc = avatarUrl
    ? (avatarUrl.startsWith('http') || avatarUrl.startsWith('blob:') ? avatarUrl : `${API_BASE}${avatarUrl}`)
    : null

  return (
    <div className="p-profile">
      <div className="p-card p-profile-card">
        <div className="p-profile-banner" />
        <div className="p-profile-info">
          <div className="p-profile-avatar-wrapper">
            {avatarSrc ? (
              <img className="p-profile-avatar-img" src={avatarSrc} alt="" />
            ) : (
              <div className="p-profile-avatar" style={{ background: nameToColor(profile.name) }}>
                {profile.initials || getInitials(profile.name)}
              </div>
            )}
          </div>
          <h2 className="p-profile-name">{profile.name}</h2>
          <p className="p-profile-handle">{profile.handle}</p>
          <p className="p-profile-bio">{profile.bio?.[lang] || profile.bio?.da || ''}</p>
          <div className="p-profile-meta">
            {profile.location && <span>📍 {profile.location}</span>}
            <span>📅 {t.joined} {profile.joinDate ? new Date(profile.joinDate).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
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

      {/* Login info */}
      <div className="p-card p-login-info-card">
        <h3 className="p-section-title">{t.loginInfo}</h3>
        <div className="p-login-info">
          <div className="p-login-info-row">
            <span className="p-login-info-label">{t.emailLabel}</span>
            <span className="p-login-info-value">{profile.email || '—'}</span>
          </div>
          <div className="p-login-info-row">
            <span className="p-login-info-label">{t.passwordLabel}</span>
            <span className="p-login-info-value p-password-value">
              {profile.hasPassword === false ? (
                <span className="p-password-not-set">{t.passwordNotSet}</span>
              ) : (
                <>
                  <span>{showPassword ? (profile.passwordHint || '••••••••••••') : '••••••••••••'}</span>
                  <button className="p-show-password-btn" onClick={() => setShowPassword(prev => !prev)}>
                    {showPassword ? t.hidePasswordHint : t.showPasswordHint}
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="p-login-info-row">
            <span className="p-login-info-label">{t.loginMethodLabel}</span>
            <span className="p-login-info-value">{profile.loginMethod === 'facebook' ? t.loginMethodFacebook : t.loginMethodEmail}</span>
          </div>
          <div className="p-login-info-row">
            <span className="p-login-info-label">{t.accountCreatedLabel}</span>
            <span className="p-login-info-value">{profile.createdAt ? new Date(profile.createdAt).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
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

// ── Edit Profile ──
function EditProfilePage({ lang, t, currentUser, onUserUpdate, onNavigate }) {
  const [profile, setProfile] = useState({ ...currentUser })
  const avatarInputRef = useRef(null)

  useEffect(() => {
    apiFetchProfile().then(data => {
      if (data) setProfile(data)
    })
  }, [])

  const handleAvatarUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setProfile(prev => ({ ...prev, avatarUrl: previewUrl }))
    onUserUpdate(prev => ({ ...prev, avatar_url: previewUrl }))
    try {
      const data = await apiUploadAvatar(file)
      if (data?.avatarUrl) {
        setProfile(prev => ({ ...prev, avatarUrl: data.avatarUrl }))
        onUserUpdate(prev => ({ ...prev, avatar_url: data.avatarUrl }))
      }
    } catch {}
  }, [onUserUpdate])

  const avatarUrl = profile.avatarUrl || profile.avatar_url
  const avatarSrc = avatarUrl
    ? (avatarUrl.startsWith('http') || avatarUrl.startsWith('blob:') ? avatarUrl : `${API_BASE}${avatarUrl}`)
    : null

  const editT = lang === 'da' ? {
    title: 'Rediger profil',
    avatarLabel: 'Profilbillede',
    avatarBtn: 'Skift billede',
    nameLabel: 'Navn',
    bioLabel: 'Bio',
    locationLabel: 'Lokation',
    back: 'Tilbage til profil',
  } : {
    title: 'Edit profile',
    avatarLabel: 'Profile picture',
    avatarBtn: 'Change picture',
    nameLabel: 'Name',
    bioLabel: 'Bio',
    locationLabel: 'Location',
    back: 'Back to profile',
  }

  const fieldStyle = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 16 }

  return (
    <div className="p-profile" style={{ maxWidth: 520 }}>
      <div className="p-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>{editT.title}</h2>

        {/* Avatar upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <div className="p-profile-avatar-wrapper" onClick={() => avatarInputRef.current?.click()} title={editT.avatarBtn} style={{ cursor: 'pointer' }}>
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
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{editT.avatarLabel}</div>
            <button
              style={{ marginTop: 4, padding: '6px 12px', borderRadius: 6, border: '1px solid #2D6A4F', background: '#fff', color: '#2D6A4F', cursor: 'pointer', fontSize: 13 }}
              onClick={() => avatarInputRef.current?.click()}
            >
              {editT.avatarBtn}
            </button>
          </div>
        </div>

        {/* Name (read-only for now) */}
        <label style={labelStyle}>{editT.nameLabel}</label>
        <input style={fieldStyle} value={profile.name || ''} readOnly />

        {/* Bio */}
        <label style={labelStyle}>{editT.bioLabel}</label>
        <textarea style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' }} value={profile.bio?.[lang] || profile.bio?.da || ''} readOnly />

        {/* Location */}
        <label style={labelStyle}>{editT.locationLabel}</label>
        <input style={fieldStyle} value={profile.location || ''} readOnly />

        <button
          style={{ marginTop: 24, padding: '10px 20px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          onClick={() => onNavigate('profile')}
        >
          {editT.back}
        </button>
      </div>
    </div>
  )
}

// ── GDPR Privacy & Data Management ──
// Full page for exercising GDPR rights and managing Facebook data
function PrivacySection({ lang, onLogout }) {
  const [loading, setLoading] = useState(null)
  const [message, setMessage] = useState('')
  const [consents, setConsents] = useState(null)

  // Load consent status on mount
  useEffect(() => {
    apiGetConsentStatus().then(data => {
      if (data) setConsents(data)
    })
  }, [])

  const t = lang === 'da' ? {
    // Page header
    title: 'Privatliv & Dataforvaltning',
    subtitle: 'Dine rettigheder i henhold til EU\'s GDPR-forordning og Facebooks platformvilkår',
    // Privacy notice (transparency — GDPR Art. 13 & 14)
    privacyTitle: 'Sådan behandler vi dine data',
    privacyIntro: 'fellis.eu er en dansk platform hostet i EU. Vi er forpligtet til at beskytte dine persondata i henhold til EU\'s General Data Protection Regulation (GDPR).',
    privacyWhatTitle: 'Hvad vi indsamler',
    privacyWhat: [
      'Kontooplysninger: navn, e-mail, profilbillede',
      'Indhold du opretter: opslag, kommentarer, beskeder',
      'Facebook-data (kun med dit samtykke): opslag, fotos, venneliste (kun eksisterende brugere)',
    ],
    privacyWhyTitle: 'Hvorfor vi indsamler det',
    privacyWhy: [
      'For at levere platformens funktionalitet',
      'For at migrere dit indhold fra Facebook (kun med samtykke)',
      'Vi sælger ALDRIG dine data eller bruger dem til reklamer',
    ],
    privacyStorageTitle: 'Opbevaring og sikkerhed',
    privacyStorage: [
      'Alle data opbevares på EU-servere (Danmark)',
      'Facebook-tokens krypteres med AES-256-GCM',
      'Facebook-tokens slettes automatisk efter 90 dage',
      'Sessioner udløber efter 30 dage',
    ],
    // Consent management
    consentTitle: 'Samtykke-status',
    consentFbImport: 'Facebook dataimport',
    consentDataProcessing: 'Generel databehandling',
    consentGiven: 'Samtykke givet',
    consentNotGiven: 'Intet samtykke',
    consentWithdrawn: 'Samtykke trukket tilbage',
    consentWithdrawBtn: 'Træk samtykke tilbage',
    consentWithdrawConfirm: 'Er du sikker på, at du vil trække dit samtykke tilbage? Din Facebook-token vil blive slettet.',
    consentDate: 'Givet den',
    // Facebook data
    fbTitle: 'Facebook-data',
    fbDesc: 'Data importeret fra din Facebook-konto. I henhold til Facebooks platformvilkår og GDPR har du fuld kontrol over disse data.',
    deleteFbBtn: 'Slet alle Facebook-data',
    deleteFbDesc: 'Fjerner alle opslag, fotos og venskaber importeret fra Facebook. Dine egne opslag oprettet på fellis.eu bevares.',
    confirmDeleteFb: 'Er du sikker? Alle dine importerede Facebook-opslag, fotos og venskaber vil blive slettet permanent. Dette kan ikke fortrydes.',
    // GDPR rights
    rightsTitle: 'Dine GDPR-rettigheder',
    rightExport: 'Ret til dataportabilitet (Art. 20)',
    rightExportDesc: 'Download alle dine data i et maskinlæsbart JSON-format.',
    exportBtn: 'Download mine data',
    rightErasure: 'Ret til sletning (Art. 17)',
    rightErasureDesc: 'Slet din konto og alle tilknyttede data permanent. Dette inkluderer alle opslag, kommentarer, beskeder, venskaber og uploadede filer.',
    deleteAccountBtn: 'Slet min konto permanent',
    confirmDeleteAccount: 'ADVARSEL: Dette sletter din konto og ALLE dine data permanent. Dette kan ikke fortrydes.\n\nDine opslag, kommentarer, beskeder, venskaber, uploadede filer og samtykkehistorik vil blive slettet.\n\nEr du helt sikker?',
    // Contact
    contactTitle: 'Kontakt databeskyttelsesansvarlig',
    contactDesc: 'Har du spørgsmål om dine data eller vil du udøve en rettighed, der ikke er dækket her, kan du kontakte os på:',
    contactEmail: 'privacy@fellis.eu',
    // Status
    done: 'Udført!',
    error: 'Der opstod en fejl. Prøv igen.',
  } : {
    // Page header
    title: 'Privacy & Data Management',
    subtitle: 'Your rights under the EU GDPR regulation and Facebook Platform Terms',
    // Privacy notice
    privacyTitle: 'How we handle your data',
    privacyIntro: 'fellis.eu is a Danish platform hosted in the EU. We are committed to protecting your personal data under the EU General Data Protection Regulation (GDPR).',
    privacyWhatTitle: 'What we collect',
    privacyWhat: [
      'Account information: name, email, profile picture',
      'Content you create: posts, comments, messages',
      'Facebook data (only with your consent): posts, photos, friends list (only existing users)',
    ],
    privacyWhyTitle: 'Why we collect it',
    privacyWhy: [
      'To provide the platform functionality',
      'To migrate your content from Facebook (only with consent)',
      'We NEVER sell your data or use it for advertising',
    ],
    privacyStorageTitle: 'Storage and security',
    privacyStorage: [
      'All data stored on EU servers (Denmark)',
      'Facebook tokens encrypted with AES-256-GCM',
      'Facebook tokens automatically deleted after 90 days',
      'Sessions expire after 30 days',
    ],
    // Consent management
    consentTitle: 'Consent Status',
    consentFbImport: 'Facebook data import',
    consentDataProcessing: 'General data processing',
    consentGiven: 'Consent given',
    consentNotGiven: 'No consent',
    consentWithdrawn: 'Consent withdrawn',
    consentWithdrawBtn: 'Withdraw consent',
    consentWithdrawConfirm: 'Are you sure you want to withdraw your consent? Your Facebook token will be deleted.',
    consentDate: 'Given on',
    // Facebook data
    fbTitle: 'Facebook Data',
    fbDesc: 'Data imported from your Facebook account. Under Facebook Platform Terms and GDPR, you have full control over this data.',
    deleteFbBtn: 'Delete all Facebook data',
    deleteFbDesc: 'Removes all posts, photos, and friendships imported from Facebook. Your own posts created on fellis.eu are preserved.',
    confirmDeleteFb: 'Are you sure? All your imported Facebook posts, photos, and friendships will be permanently deleted. This cannot be undone.',
    // GDPR rights
    rightsTitle: 'Your GDPR Rights',
    rightExport: 'Right to data portability (Art. 20)',
    rightExportDesc: 'Download all your data in a machine-readable JSON format.',
    exportBtn: 'Download my data',
    rightErasure: 'Right to erasure (Art. 17)',
    rightErasureDesc: 'Permanently delete your account and all associated data. This includes all posts, comments, messages, friendships, and uploaded files.',
    deleteAccountBtn: 'Delete my account permanently',
    confirmDeleteAccount: 'WARNING: This will permanently delete your account and ALL your data. This cannot be undone.\n\nYour posts, comments, messages, friendships, uploaded files, and consent history will be deleted.\n\nAre you absolutely sure?',
    // Contact
    contactTitle: 'Contact Data Protection Officer',
    contactDesc: 'If you have questions about your data or want to exercise a right not covered here, contact us at:',
    contactEmail: 'privacy@fellis.eu',
    // Status
    done: 'Done!',
    error: 'An error occurred. Please try again.',
  }

  const handleExport = async () => {
    setLoading('export')
    setMessage('')
    try {
      const data = await apiExportData()
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `fellis-data-export-${Date.now()}.json`
        a.click()
        URL.revokeObjectURL(url)
        setMessage(t.done)
      }
    } catch {
      setMessage(t.error)
    }
    setLoading(null)
  }

  const handleDeleteFb = async () => {
    if (!confirm(t.confirmDeleteFb)) return
    setLoading('deleteFb')
    setMessage('')
    try {
      await apiDeleteFacebookData()
      setMessage(t.done)
      // Refresh consent status
      const data = await apiGetConsentStatus()
      if (data) setConsents(data)
    } catch {
      setMessage(t.error)
    }
    setLoading(null)
  }

  const handleDeleteAccount = async () => {
    if (!confirm(t.confirmDeleteAccount)) return
    setLoading('deleteAccount')
    try {
      await apiDeleteAccount()
      localStorage.clear()
      window.location.href = '/'
    } catch {
      setMessage(t.error)
      setLoading(null)
    }
  }

  const handleWithdrawConsent = async (consentType) => {
    if (!confirm(t.consentWithdrawConfirm)) return
    setLoading('withdraw_' + consentType)
    setMessage('')
    try {
      await apiWithdrawConsent(consentType)
      setMessage(t.done)
      // Refresh consent status
      const data = await apiGetConsentStatus()
      if (data) setConsents(data)
    } catch {
      setMessage(t.error)
    }
    setLoading(null)
  }

  const sectionStyle = { background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #E8E4DF' }
  const sectionTitleStyle = { fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#2D3436' }
  const listStyle = { fontSize: 13, lineHeight: 1.8, color: '#555', paddingLeft: 20, margin: '8px 0 0' }
  const btnStyle = { padding: '12px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14, width: '100%', textAlign: 'left', display: 'block' }
  const dangerBtnStyle = { ...btnStyle, borderColor: '#e74c3c', color: '#e74c3c' }

  const consentLabel = (type) => type === 'facebook_import' ? t.consentFbImport : t.consentDataProcessing

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className="p-profile" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t.title}</h2>
      <p style={{ fontSize: 14, color: '#888', marginBottom: 20 }}>{t.subtitle}</p>

      {/* ── Privacy Notice (Transparency — GDPR Art. 13 & 14) ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.privacyTitle}</h3>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>{t.privacyIntro}</p>

        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 0 }}>{t.privacyWhatTitle}</p>
        <ul style={listStyle}>
          {t.privacyWhat.map((item, i) => <li key={i}>{item}</li>)}
        </ul>

        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 0, marginTop: 12 }}>{t.privacyWhyTitle}</p>
        <ul style={listStyle}>
          {t.privacyWhy.map((item, i) => <li key={i}>{item}</li>)}
        </ul>

        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 0, marginTop: 12 }}>{t.privacyStorageTitle}</p>
        <ul style={listStyle}>
          {t.privacyStorage.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>

      {/* ── Consent Management (GDPR Art. 7) ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.consentTitle}</h3>
        {consents ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['facebook_import', 'data_processing'].map(type => {
              const c = consents[type]
              const isGiven = c?.given
              const isWithdrawn = c?.withdrawn_at
              return (
                <div key={type} style={{ padding: 12, borderRadius: 8, border: '1px solid #E8E4DF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{consentLabel(type)}</div>
                    <div style={{ fontSize: 12, color: isGiven ? '#27ae60' : isWithdrawn ? '#e67e22' : '#999', marginTop: 2 }}>
                      {isGiven ? t.consentGiven : isWithdrawn ? t.consentWithdrawn : t.consentNotGiven}
                      {c?.date && <span style={{ color: '#aaa', marginLeft: 8 }}>{t.consentDate} {formatDate(c.date)}</span>}
                    </div>
                  </div>
                  {isGiven && (
                    <button
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e67e22', background: '#fff', color: '#e67e22', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                      disabled={loading === 'withdraw_' + type}
                      onClick={() => handleWithdrawConsent(type)}
                    >
                      {loading === 'withdraw_' + type ? '...' : t.consentWithdrawBtn}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#999' }}>...</p>
        )}
      </div>

      {/* ── Facebook Data Management ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.fbTitle}</h3>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>{t.fbDesc}</p>
        <button style={dangerBtnStyle} onClick={handleDeleteFb} disabled={loading === 'deleteFb'}>
          <strong>{loading === 'deleteFb' ? '...' : t.deleteFbBtn}</strong>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2, fontWeight: 400 }}>{t.deleteFbDesc}</div>
        </button>
      </div>

      {/* ── GDPR Rights (Art. 17 & 20) ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.rightsTitle}</h3>

        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t.rightExport}</p>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>{t.rightExportDesc}</p>
          <button style={btnStyle} onClick={handleExport} disabled={loading === 'export'}>
            <strong>{loading === 'export' ? '...' : t.exportBtn}</strong>
          </button>
        </div>

        <div style={{ borderTop: '1px solid #eee', paddingTop: 12, marginTop: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#c0392b' }}>{t.rightErasure}</p>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>{t.rightErasureDesc}</p>
          <button
            style={{ ...dangerBtnStyle, borderColor: '#c0392b', color: '#c0392b' }}
            onClick={handleDeleteAccount}
            disabled={loading === 'deleteAccount'}
          >
            <strong>{loading === 'deleteAccount' ? '...' : t.deleteAccountBtn}</strong>
          </button>
        </div>
      </div>

      {/* ── Contact DPO ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.contactTitle}</h3>
        <p style={{ fontSize: 13, color: '#555' }}>{t.contactDesc}</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#2D6A4F', marginTop: 4 }}>{t.contactEmail}</p>
      </div>

      {message && <p style={{ marginTop: 4, marginBottom: 16, fontSize: 13, textAlign: 'center', color: message === t.done ? '#27ae60' : '#e74c3c' }}>{message}</p>}
    </div>
  )
}

// ── Friends ──
function FriendsPage({ lang, t, onMessage }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState([])

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
  const [activeThread, setActiveThread] = useState(null)
  const [threads, setThreads] = useState([])
  const [friends, setFriends] = useState([])
  const [showFriendPicker, setShowFriendPicker] = useState(false)
  const [friendSearch, setFriendSearch] = useState('')
  const [newMsg, setNewMsg] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    apiFetchMessages().then(data => {
      if (data && data.length > 0) {
        setThreads(data)
        setActiveThread(0)
      }
    })
    apiFetchFriends().then(data => {
      if (data) setFriends(data)
    })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [threads, activeThread])

  const startConversation = useCallback((friend) => {
    const existingIdx = threads.findIndex(th => th.friendId === friend.id || th.friend === friend.name)
    if (existingIdx >= 0) {
      setActiveThread(existingIdx)
    } else {
      setThreads(prev => [...prev, { friend: friend.name, friendId: friend.id, messages: [], unread: 0 }])
      setActiveThread(threads.length)
    }
    setShowFriendPicker(false)
    setFriendSearch('')
  }, [threads])

  const handleSend = useCallback(() => {
    if (!newMsg.trim() || activeThread === null) return
    const text = newMsg.trim()
    const thread = threads[activeThread]
    const friendId = thread.friendId || (friends.find(f => f.name === thread.friend)?.id)
    setThreads(prev => prev.map((th, i) => {
      if (i !== activeThread) return th
      return {
        ...th,
        messages: [...th.messages, {
          from: currentUser.name,
          text: { da: text, en: text },
          time: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
        }],
        unread: 0,
      }
    }))
    setNewMsg('')
    if (friendId) apiSendMessage(friendId, text).catch(() => {})
  }, [newMsg, activeThread, threads, friends, currentUser.name])

  const thread = activeThread !== null ? threads[activeThread] : null
  const filteredFriends = friends.filter(f =>
    f.name.toLowerCase().includes(friendSearch.toLowerCase())
  )

  return (
    <div className="p-messages">
      <div className="p-msg-sidebar">
        <div className="p-msg-sidebar-header">
          <h3 className="p-msg-sidebar-title">{t.messagesTitle}</h3>
          <button className="p-msg-new-btn" onClick={() => setShowFriendPicker(!showFriendPicker)} title={t.newConversation || 'Ny samtale'}>+</button>
        </div>
        {showFriendPicker && (
          <div className="p-msg-friend-picker">
            <input
              className="p-msg-friend-search"
              placeholder={t.searchFriends}
              value={friendSearch}
              onChange={e => setFriendSearch(e.target.value)}
              autoFocus
            />
            <div className="p-msg-friend-list">
              {filteredFriends.map(friend => (
                <div key={friend.id} className="p-msg-friend-item" onClick={() => startConversation(friend)}>
                  <div className="p-avatar-xs" style={{ background: nameToColor(friend.name) }}>
                    {getInitials(friend.name)}
                  </div>
                  <span>{friend.name}</span>
                  {friend.online && <span className="p-msg-online-dot" />}
                </div>
              ))}
              {filteredFriends.length === 0 && (
                <div className="p-msg-no-friends">{lang === 'da' ? 'Ingen venner fundet' : 'No friends found'}</div>
              )}
            </div>
          </div>
        )}
        {threads.map((th, i) => (
          <div
            key={i}
            className={`p-msg-thread${i === activeThread ? ' active' : ''}`}
            onClick={() => { setActiveThread(i); setShowFriendPicker(false); setThreads(prev => prev.map((t, j) => j === i ? { ...t, unread: 0 } : t)) }}
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
                {th.messages.length > 0 ? th.messages[th.messages.length - 1].text[lang].slice(0, 40) + '...' : (lang === 'da' ? 'Start en samtale...' : 'Start a conversation...')}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-msg-main">
        {thread ? (
          <>
            <div className="p-msg-header">
              <div className="p-avatar-sm" style={{ background: nameToColor(thread.friend) }}>
                {getInitials(thread.friend)}
              </div>
              <span className="p-msg-header-name">{thread.friend}</span>
            </div>
            <div className="p-msg-body">
              {thread.messages.length === 0 && (
                <div className="p-msg-empty-thread">
                  <div className="p-avatar-lg" style={{ background: nameToColor(thread.friend), width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff', fontWeight: 700, margin: '0 auto 12px' }}>
                    {getInitials(thread.friend)}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{thread.friend}</div>
                  <div style={{ color: '#65676b', fontSize: 13, marginTop: 4 }}>
                    {lang === 'da' ? 'Send den første besked!' : 'Send the first message!'}
                  </div>
                </div>
              )}
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
          </>
        ) : (
          <div className="p-msg-empty-state">
            <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>{t.messagesTitle}</div>
            <div style={{ color: '#65676b', marginTop: 8 }}>
              {lang === 'da' ? 'Vælg en samtale eller start en ny' : 'Select a conversation or start a new one'}
            </div>
            <button className="p-msg-start-btn" onClick={() => setShowFriendPicker(true)}>
              {lang === 'da' ? 'Ny samtale' : 'New conversation'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
