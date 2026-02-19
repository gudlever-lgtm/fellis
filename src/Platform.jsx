import { useState, useCallback, useRef, useEffect } from 'react'
import { PT, nameToColor, getInitials } from './data.js'
import { apiFetchFeed, apiCreatePost, apiToggleLike, apiAddComment, apiFetchProfile, apiFetchFriends, apiFetchConversations, apiSendConversationMessage, apiFetchOlderConversationMessages, apiCreateConversation, apiInviteToConversation, apiMuteConversation, apiLeaveConversation, apiRenameConversation, apiUploadAvatar, apiCheckSession, apiDeleteFacebookData, apiDeleteAccount, apiExportData, apiGetConsentStatus, apiWithdrawConsent, apiGetInviteLink, apiLinkPreview, apiSearch, apiGetPost, apiSearchUsers, apiSendFriendRequest, apiFetchFriendRequests, apiAcceptFriendRequest, apiDeclineFriendRequest } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function Platform({ lang: initialLang, onLogout }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const [currentUser, setCurrentUser] = useState({ name: '', handle: '', initials: '' })
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const [openConvId, setOpenConvId] = useState(null)
  const [highlightPostId, setHighlightPostId] = useState(null)
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
          <button
            className={`p-nav-search-btn${page === 'search' ? ' active' : ''}`}
            onClick={() => navigateTo('search')}
            title={t.search}
            aria-label={t.search}
          >🔍</button>
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
        {page === 'feed' && <FeedPage lang={lang} t={t} currentUser={currentUser} highlightPostId={highlightPostId} onHighlightCleared={() => setHighlightPostId(null)} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} currentUser={currentUser} onUserUpdate={setCurrentUser} />}
        {page === 'edit-profile' && <EditProfilePage lang={lang} t={t} currentUser={currentUser} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} onMessage={() => navigateTo('messages')} />}
        {page === 'messages' && <MessagesPage lang={lang} t={t} currentUser={currentUser} openConvId={openConvId} onConvOpened={() => setOpenConvId(null)} />}
        {page === 'privacy' && <PrivacySection lang={lang} onLogout={onLogout} />}
        {page === 'search' && (
          <SearchPage
            lang={lang}
            t={t}
            onNavigateToPost={(postId) => { setHighlightPostId(postId); navigateTo('feed') }}
            onNavigateToConv={(convId) => { setOpenConvId(convId); navigateTo('messages') }}
          />
        )}
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

// ── Link preview ──

const URL_RE = /https?:\/\/[^\s<>"']+/g
const previewCache = new Map()

function extractFirstUrl(text) {
  URL_RE.lastIndex = 0
  const m = URL_RE.exec(text)
  if (!m) return null
  return m[0].replace(/[.,!?;:)>]+$/, '')
}

function linkifyText(text) {
  const parts = []
  const re = /https?:\/\/[^\s<>"']+/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,!?;:)>]+$/, '')
    if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) })
    parts.push({ t: 'url', v: url })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: 'text', v: text.slice(last) })
  return parts
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]
      return u.searchParams.get('v')
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0]
  } catch {}
  return null
}

function LinkPreview({ url }) {
  const cached = previewCache.get(url)
  const [data, setData] = useState(cached ?? null)
  const [ytExpanded, setYtExpanded] = useState(false)
  const ytId = extractYouTubeId(url)

  useEffect(() => {
    if (ytId || cached !== undefined) return
    apiLinkPreview(url).then(d => {
      previewCache.set(url, d ?? null)
      if (d) setData(d)
    })
  }, [url, ytId, cached])

  if (ytId) {
    return (
      <div className="link-preview link-preview-yt">
        {ytExpanded ? (
          <div className="link-preview-yt-embed">
            <iframe
              src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen loading="lazy"
            />
          </div>
        ) : (
          <div className="link-preview-yt-thumb" onClick={() => setYtExpanded(true)}>
            <img src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`} alt="" loading="lazy" />
            <div className="link-preview-play">▶</div>
          </div>
        )}
      </div>
    )
  }

  if (!data || (!data.title && !data.image)) return null
  return (
    <a className="link-preview link-preview-og" href={url} target="_blank" rel="noopener noreferrer">
      {data.image && <img className="link-preview-og-img" src={data.image} alt="" loading="lazy" />}
      <div className="link-preview-og-body">
        {data.siteName && <div className="link-preview-og-site">{data.siteName}</div>}
        {data.title && <div className="link-preview-og-title">{data.title}</div>}
        {data.description && <div className="link-preview-og-desc">{data.description}</div>}
      </div>
    </a>
  )
}

function PostText({ text, lang }) {
  const str = text[lang] || text.da || ''
  const parts = linkifyText(str)
  const firstUrl = parts.find(p => p.t === 'url')?.v
  return (
    <>
      <div className="p-post-body">
        {parts.map((p, i) =>
          p.t === 'url'
            ? <a key={i} href={p.v} target="_blank" rel="noopener noreferrer" className="post-link">{p.v}</a>
            : <span key={i}>{p.v}</span>
        )}
      </div>
      {firstUrl && <LinkPreview url={firstUrl} />}
    </>
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

// ── Camera helper — must be in DOM before .click() for iOS Safari capture to work ──
function openCamera(onFile) {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = 'image/*,video/*'
  inp.setAttribute('capture', 'environment')
  inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
  document.body.appendChild(inp)
  const cleanup = () => { if (inp.parentNode) inp.parentNode.removeChild(inp) }
  inp.addEventListener('change', (e) => { onFile(e); cleanup() }, { once: true })
  inp.addEventListener('cancel', cleanup, { once: true })
  inp.click()
}

// ── Reaction emojis ──
const REACTIONS = [
  { emoji: '👍', label: { da: 'Synes godt om', en: 'Like' } },
  { emoji: '❤️', label: { da: 'Elsker', en: 'Love' } },
  { emoji: '😄', label: { da: 'Haha', en: 'Haha' } },
  { emoji: '😮', label: { da: 'Wow', en: 'Wow' } },
  { emoji: '😢', label: { da: 'Trist', en: 'Sad' } },
  { emoji: '😡', label: { da: 'Vred', en: 'Angry' } },
]

// ── Feed ──
const PAGE_SIZE = 20

function FeedPage({ lang, t, currentUser, highlightPostId, onHighlightCleared }) {
  const [posts, setPosts] = useState([])
  const [pinnedPost, setPinnedPost] = useState(null)
  const pinnedRef = useRef(null)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadingPage, setLoadingPage] = useState(false)
  const isFetchingRef = useRef(false)   // ref guard — avoids stale closure in observers
  const offsetRef = useRef(0)           // mirrors offset state for stable observer callbacks
  const totalRef = useRef(0)            // mirrors total state for stable observer callbacks
  const [newPostText, setNewPostText] = useState('')
  const [mediaFiles, setMediaFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [likedPosts, setLikedPosts] = useState(new Set())
  const [reactions, setReactions] = useState({})   // postId → emoji
  const [likePopup, setLikePopup] = useState(null) // postId with open reaction popup
  const [expandedComments, setExpandedComments] = useState(new Set())
  const [commentTexts, setCommentTexts] = useState({})
  const [commentMedia, setCommentMedia] = useState({})
  const [sharePopup, setSharePopup] = useState(null)      // postId of open popup
  const [sharePopupFriends, setSharePopupFriends] = useState(null) // null = not loaded yet
  const [shareSentTo, setShareSentTo] = useState(null)   // friendId just messaged
  const [postExpanded, setPostExpanded] = useState(false)
  const [mediaPopup, setMediaPopup] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const commentFileRefs = useRef({})
  const [commentMediaPopup, setCommentMediaPopup] = useState(null) // postId of open popup
  const bottomSentinelRef = useRef(null)
  const topSentinelRef = useRef(null)
  const feedContainerRef = useRef(null)

  // Fetch a page of posts — stable callback (empty deps), guards via ref
  const fetchPage = useCallback(async (newOffset, direction) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setLoadingPage(true)
    const data = await apiFetchFeed(newOffset, PAGE_SIZE)
    if (data?.posts) {
      const container = feedContainerRef.current
      // Capture scroll height BEFORE React flushes the DOM update
      const prevScrollHeight = container?.scrollHeight ?? 0
      setPosts(data.posts)
      setTotal(data.total)
      setOffset(newOffset)
      setLikedPosts(new Set(data.posts.filter(p => p.liked).map(p => p.id)))
      setReactions(Object.fromEntries(data.posts.filter(p => p.userReaction).map(p => [p.id, p.userReaction])))
      offsetRef.current = newOffset
      totalRef.current = data.total
      if (container) {
        if (direction === 'down') {
          container.scrollTop = 0
        } else if (direction === 'up') {
          // After DOM paints: jump to the position that puts the user
          // at the bottom of the newly loaded page so they can keep scrolling up
          requestAnimationFrame(() => {
            if (feedContainerRef.current) {
              feedContainerRef.current.scrollTop =
                feedContainerRef.current.scrollHeight - prevScrollHeight
            }
          })
        }
      }
    }
    setLoadingPage(false)
    isFetchingRef.current = false
  }, []) // stable — all mutable reads go through refs

  // Initial load
  useEffect(() => {
    apiFetchFeed(0, PAGE_SIZE).then(data => {
      if (data?.posts) {
        setPosts(data.posts)
        setTotal(data.total)
        totalRef.current = data.total
        setLikedPosts(new Set(data.posts.filter(p => p.liked).map(p => p.id)))
        setReactions(Object.fromEntries(data.posts.filter(p => p.userReaction).map(p => [p.id, p.userReaction])))
      }
    })
  }, [])

  // Bottom sentinel — load next page
  // Depends only on `offset` (to re-observe when sentinel mounts/unmounts) and
  // `fetchPage` (stable). Reads current values via refs inside the callback.
  useEffect(() => {
    const el = bottomSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting &&
          !isFetchingRef.current &&
          offsetRef.current + PAGE_SIZE < totalRef.current) {
        fetchPage(offsetRef.current + PAGE_SIZE, 'down')
      }
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [offset, fetchPage]) // offset: sentinel mounts when offset changes; fetchPage: stable

  // Top sentinel — load previous page
  useEffect(() => {
    const el = topSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting &&
          !isFetchingRef.current &&
          offsetRef.current > 0) {
        fetchPage(Math.max(0, offsetRef.current - PAGE_SIZE), 'up')
      }
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [offset, fetchPage]) // offset: sentinel mounts/unmounts; fetchPage: stable

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
        setPosts(prev => [data, ...prev].slice(0, PAGE_SIZE))
        setTotal(prev => prev + 1)
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
        }, ...prev].slice(0, PAGE_SIZE))
        setTotal(prev => prev + 1)
      }
    })
    setNewPostText('')
    setMediaFiles([])
    setMediaPreviews([])
    setPostExpanded(false)
    setMediaPopup(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [newPostText, mediaFiles, mediaPreviews, currentUser.name])

  const toggleLike = useCallback((id, emoji) => {
    const isLiked = likedPosts.has(id)
    const prevEmoji = reactions[id] || '❤️'
    const nextEmoji = emoji || '❤️'

    let action // 'add' | 'remove' | 'change'
    if (!isLiked) action = 'add'
    else if (emoji && emoji !== prevEmoji) action = 'change'
    else action = 'remove'

    // Update liked set
    setLikedPosts(prev => {
      const next = new Set(prev)
      if (action === 'remove') next.delete(id); else next.add(id)
      return next
    })

    // Update user's reaction
    if (action === 'remove') {
      setReactions(r => { const n = { ...r }; delete n[id]; return n })
    } else {
      setReactions(r => ({ ...r, [id]: nextEmoji }))
    }

    // Optimistic update to aggregated reaction counts
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p
      const reacts = (p.reactions || []).map(r => ({ ...r }))
      if (action === 'remove' || action === 'change') {
        const i = reacts.findIndex(r => r.emoji === prevEmoji)
        if (i >= 0) { if (reacts[i].count > 1) reacts[i].count--; else reacts.splice(i, 1) }
      }
      if (action === 'add' || action === 'change') {
        const i = reacts.findIndex(r => r.emoji === nextEmoji)
        if (i >= 0) reacts[i].count++; else reacts.push({ emoji: nextEmoji, count: 1 })
      }
      return { ...p, likes: action === 'add' ? p.likes + 1 : action === 'remove' ? p.likes - 1 : p.likes, reactions: reacts }
    }))

    apiToggleLike(id, action === 'remove' ? null : nextEmoji).catch(() => {})
    setLikePopup(null)
  }, [likedPosts, reactions])

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

  const toggleSharePopup = useCallback(async (postId) => {
    if (sharePopup === postId) { setSharePopup(null); return }
    setShareSentTo(null)
    setSharePopup(postId)
    if (sharePopupFriends === null) {
      const data = await apiFetchFriends()
      setSharePopupFriends(data || [])
    }
  }, [sharePopup, sharePopupFriends])

  const handleCopyLink = useCallback(async (post) => {
    const text = post.text[lang] || post.text.da || ''
    try { await navigator.clipboard.writeText(`${text}\n\n${window.location.origin}`) } catch {}
    setSharePopup(null)
  }, [lang])

  const handleShareToFriend = useCallback(async (post, friendId) => {
    const text = post.text[lang] || post.text.da || ''
    const msg = `${post.author}: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}" — fellis.eu`
    await apiSendMessage(friendId, msg)
    setShareSentTo(friendId)
    setTimeout(() => { setSharePopup(null); setShareSentTo(null) }, 1200)
  }, [lang])

  const handleComment = useCallback((postId) => {
    const text = commentTexts[postId]
    const media = commentMedia[postId]
    if (!text?.trim() && !media) return
    const commentText = (text || '').trim()
    const localMedia = media ? [{ url: media.url, type: media.type, mime: '' }] : null
    apiAddComment(postId, commentText, media?.file ?? null).then(data => {
      // Use server response but fall back to local; always show local media preview
      const comment = data
        ? { ...data, media: data.media ?? localMedia }
        : { author: currentUser.name, text: { da: commentText, en: commentText }, media: localMedia }
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p
        return { ...p, comments: [...p.comments, comment] }
      }))
    })
    setCommentTexts(prev => ({ ...prev, [postId]: '' }))
    setCommentMedia(prev => { const n = { ...prev }; delete n[postId]; return n })
    setCommentMediaPopup(null)
    if (commentFileRefs.current[postId]) commentFileRefs.current[postId].value = ''
  }, [commentTexts, commentMedia, currentUser.name])

  // Fetch and pin the specific post from a search result click
  useEffect(() => {
    if (!highlightPostId) { setPinnedPost(null); return }
    apiGetPost(highlightPostId).then(post => {
      if (!post) return
      setPinnedPost(post)
      if (post.liked || post.userReaction) {
        setLikedPosts(prev => { const s = new Set(prev); s.add(post.id); return s })
        if (post.userReaction) setReactions(prev => ({ ...prev, [post.id]: post.userReaction }))
      }
    })
  }, [highlightPostId])

  useEffect(() => {
    if (pinnedPost && pinnedRef.current) {
      pinnedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [pinnedPost])

  const pageNum = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-feed" ref={feedContainerRef}>
      {/* New post */}
      <div className="p-card p-new-post">
        {/* Hidden file input — gallery only */}
        <input ref={fileInputRef} type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
          multiple style={{ display: 'none' }} onChange={handleFileSelect} />

        {/* Collapsed prompt — click anywhere to expand */}
        {!postExpanded && !newPostText && !mediaPreviews.length ? (
          <div className="p-new-post-row p-new-post-collapsed" onClick={() => { setPostExpanded(true); setTimeout(() => textareaRef.current?.focus(), 0) }}>
            <div className="p-avatar-sm" style={{ background: nameToColor(currentUser.name) }}>
              {currentUser.initials || getInitials(currentUser.name)}
            </div>
            <div className="p-new-post-prompt">{t.newPost}</div>
          </div>
        ) : (
          /* Expanded composer */
          <>
            <div className="p-new-post-row">
              <div className="p-avatar-sm" style={{ background: nameToColor(currentUser.name) }}>
                {currentUser.initials || getInitials(currentUser.name)}
              </div>
              <textarea
                ref={textareaRef}
                className="p-new-post-textarea"
                placeholder={t.newPost}
                value={newPostText}
                onChange={e => {
                  setNewPostText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = e.target.scrollHeight + 'px'
                }}
                onFocus={() => setPostExpanded(true)}
                onBlur={() => { if (!newPostText.trim() && !mediaPreviews.length) setPostExpanded(false) }}
                autoFocus={postExpanded && !newPostText}
              />
            </div>
            {mediaPreviews.length > 0 && (
              <div className="p-media-previews">
                {mediaPreviews.map((p, i) => (
                  <div key={i} className="p-media-preview">
                    {p.type === 'video'
                      ? <video src={p.url} className="p-media-preview-thumb" />
                      : <img src={p.url} alt="" className="p-media-preview-thumb" />}
                    <button className="p-media-preview-remove" onClick={() => removeMedia(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="p-new-post-actions">
              {/* Media attachment popup */}
              <div className="p-media-popup-wrap">
                <button
                  className={`p-media-popup-btn${mediaPopup ? ' active' : ''}`}
                  onMouseDown={e => e.preventDefault()} // keep textarea focus
                  onClick={() => setMediaPopup(p => !p)}
                  title={lang === 'da' ? 'Tilføj medie' : 'Add media'}
                >
                  +
                </button>
                {mediaPopup && (
                  <>
                    <div className="p-share-backdrop" onClick={() => setMediaPopup(false)} />
                    <div className="p-share-popup p-media-popup">
                      <button className="p-share-option" onMouseDown={e => e.preventDefault()} onClick={() => { fileInputRef.current?.click(); setMediaPopup(false) }}>
                        <span className="p-media-popup-icon">🖼️</span>
                        {lang === 'da' ? 'Galleri' : 'Gallery'}
                      </button>
                      <button className="p-share-option" onMouseDown={e => e.preventDefault()} onClick={() => { setMediaPopup(false); openCamera(handleFileSelect) }}>
                        <span className="p-media-popup-icon">📷</span>
                        {lang === 'da' ? 'Kamera' : 'Camera'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button className="p-post-btn" onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={!newPostText.trim()}>{t.post}</button>
            </div>
          </>
        )}
      </div>

      {/* Top sentinel — triggers loading previous page */}
      {offset > 0 && (
        <div ref={topSentinelRef} className="p-feed-sentinel">
          {loadingPage && <div className="p-feed-loading">{lang === 'da' ? 'Indlæser...' : 'Loading...'}</div>}
        </div>
      )}

      {/* Pinned search result */}
      {pinnedPost && (() => {
        const post = pinnedPost
        const liked = likedPosts.has(post.id)
        const showComments = expandedComments.has(post.id)
        return (
          <div ref={pinnedRef}>
            <div className="p-post-pinned-banner">
              <span>📍 {lang === 'da' ? 'Søgeresultat' : 'Search result'}</span>
              <button className="p-post-pinned-close" onClick={() => { setPinnedPost(null); onHighlightCleared?.() }}>✕</button>
            </div>
            <div className="p-card p-post p-post-pinned">
              <div className="p-post-header">
                <div className="p-avatar-sm" style={{ background: nameToColor(post.author) }}>{getInitials(post.author)}</div>
                <div><div className="p-post-author">{post.author}</div><div className="p-post-time">{post.time?.[lang]}</div></div>
              </div>
              <div className="p-post-text">{post.text[lang]}</div>
              {post.media?.length > 0 && (
                <div className={`p-post-media p-post-media-${Math.min(post.media.length, 4)}`}>
                  {post.media.slice(0, 4).map((m, mi) => <MediaItem key={mi} item={m} />)}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Posts — max PAGE_SIZE in DOM */}
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
            <PostText text={post.text} lang={lang} />
            {post.media && <PostMedia media={post.media} />}
            <div className="p-post-stats">
              <span className="p-reaction-summary">
                {post.reactions?.length > 0
                  ? post.reactions.slice(0, 3).map(r => (
                      <span key={r.emoji} className="p-reaction-tally">{r.emoji} {r.count}</span>
                    ))
                  : `${post.likes} ${t.like.toLowerCase()}`
                }
              </span>
              <span onClick={() => toggleComments(post.id)} style={{ cursor: 'pointer' }}>
                {post.comments.length} {t.comment.toLowerCase()}{post.comments.length !== 1 ? (lang === 'da' ? 'er' : 's') : ''}
              </span>
            </div>
            <div className="p-post-actions">
              <div className="p-reaction-wrap">
                <button
                  className={`p-action-btn${liked ? ' liked' : ''}`}
                  onClick={() => liked ? toggleLike(post.id) : setLikePopup(p => p === post.id ? null : post.id)}
                >
                  {liked ? (reactions[post.id] || '❤️') : '🤍'} {t.like}
                </button>
                {likePopup === post.id && (
                  <>
                    <div className="p-share-backdrop" onClick={() => setLikePopup(null)} />
                    <div className="p-reaction-popup">
                      {REACTIONS.map(r => (
                        <button key={r.emoji} className="p-reaction-btn" title={r.label[lang]}
                          onClick={() => toggleLike(post.id, r.emoji)}>
                          {r.emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button className="p-action-btn" onClick={() => toggleComments(post.id)}>
                💬 {t.comment}
              </button>
              <div className="p-share-wrap">
                <button className={`p-action-btn${sharePopup === post.id ? ' active' : ''}`} onClick={() => toggleSharePopup(post.id)}>
                  ↗ {t.share}
                </button>
                {sharePopup === post.id && (
                  <>
                    <div className="p-share-backdrop" onClick={() => setSharePopup(null)} />
                    <div className="p-share-popup">
                      <button className="p-share-option" onClick={() => handleCopyLink(post)}>
                        🔗 {lang === 'da' ? 'Kopiér link' : 'Copy link'}
                      </button>
                      <div className="p-share-divider" />
                      <div className="p-share-section-label">{lang === 'da' ? 'Send til ven' : 'Send to friend'}</div>
                      {sharePopupFriends === null && (
                        <div className="p-share-loading">{lang === 'da' ? 'Indlæser…' : 'Loading…'}</div>
                      )}
                      {sharePopupFriends?.length === 0 && (
                        <div className="p-share-empty">{lang === 'da' ? 'Ingen venner endnu' : 'No friends yet'}</div>
                      )}
                      {sharePopupFriends?.length > 0 && (
                        <div className="p-share-friends-list">
                          {sharePopupFriends.map(f => (
                            <button key={f.id} className="p-share-option p-share-friend" onClick={() => handleShareToFriend(post, f.id)}>
                              <div className="p-avatar-xs" style={{ background: nameToColor(f.name) }}>{getInitials(f.name)}</div>
                              <span className="p-share-friend-name">{f.name}</span>
                              {shareSentTo === f.id && <span className="p-share-sent">✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
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
                  {/* Hidden file input — gallery only */}
                  <input ref={el => commentFileRefs.current[post.id] = el} type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
                    style={{ display: 'none' }} onChange={e => handleCommentFileSelect(post.id, e)} />
                  <input
                    className="p-comment-input"
                    placeholder={t.writeComment}
                    value={commentTexts[post.id] || ''}
                    onChange={e => setCommentTexts(prev => ({ ...prev, [post.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleComment(post.id)}
                  />
                  {/* Media attachment popup */}
                  <div className="p-media-popup-wrap">
                    <button
                      className={`p-media-popup-btn${commentMediaPopup === post.id ? ' active' : ''}`}
                      onClick={() => setCommentMediaPopup(p => p === post.id ? null : post.id)}
                      title={lang === 'da' ? 'Tilføj medie' : 'Add media'}
                    >+</button>
                    {commentMediaPopup === post.id && (
                      <>
                        <div className="p-share-backdrop" onClick={() => setCommentMediaPopup(null)} />
                        <div className="p-share-popup p-media-popup p-media-popup-right">
                          <button className="p-share-option" onClick={() => { commentFileRefs.current[post.id]?.click(); setCommentMediaPopup(null) }}>
                            <span className="p-media-popup-icon">🖼️</span>
                            {lang === 'da' ? 'Galleri' : 'Gallery'}
                          </button>
                          <button className="p-share-option" onClick={() => { setCommentMediaPopup(null); openCamera(e => handleCommentFileSelect(post.id, e)) }}>
                            <span className="p-media-popup-icon">📷</span>
                            {lang === 'da' ? 'Kamera' : 'Camera'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button className="p-send-btn" onClick={() => handleComment(post.id)}>{t.send}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Bottom sentinel — triggers loading next page */}
      {offset + PAGE_SIZE < total && (
        <div ref={bottomSentinelRef} className="p-feed-sentinel">
          {loadingPage && <div className="p-feed-loading">{lang === 'da' ? 'Indlæser...' : 'Loading...'}</div>}
        </div>
      )}

      {/* Page indicator */}
      {totalPages > 1 && (
        <div className="p-feed-page-indicator">
          {pageNum} / {totalPages}
        </div>
      )}
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
    apiFetchFeed(0, 100).then(data => {
      const posts = data?.posts || data || []
      setUserPosts(posts.filter(p => p.author === currentUser.name))
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
    // Hosting card
    hostingTitle: 'Hosting og datasuverænitet',
    hostingProvider: 'Yggdrasil Cloud',
    hostingProviderUrl: 'https://yggdrasilcloud.dk/',
    hostingIntro: 'fellis.eu er hostet hos Yggdrasil Cloud — en dansk cloud-udbyder med servere placeret i Danmark.',
    hostingWhyTitle: 'Hvorfor EU-hosting er vigtigt',
    hostingWhy: [
      'Dine data forlader aldrig EU — de opbevares fysisk i Danmark og er underlagt dansk og europæisk lovgivning.',
      'EU\'s GDPR-forordning giver dig som borger stærke rettigheder over dine persondata, herunder ret til indsigt, rettelse, sletning og dataportabilitet.',
      'Til forskel fra platforme hostet i USA eller andre tredjelande er dine data ikke underlagt lovgivning som FISA 702, CLOUD Act eller lignende overvågningsbestemmelser.',
      'Danske datacentre opererer under strenge europæiske standarder for sikkerhed, miljø og energieffektivitet.',
    ],
    hostingRightsTitle: 'Dine fordele ved EU-hosting',
    hostingRights: [
      'Fuld GDPR-beskyttelse — dine data behandles i overensstemmelse med verdens strengeste persondatalovgivning.',
      'Ingen overførsel til tredjelande — dine data deles ikke med myndigheder uden for EU uden retsgrundlag.',
      'Datatilsynet (den danske databeskyttelsesmyndighed) fører tilsyn med behandlingen af dine data.',
      'Du har altid ret til at klage til Datatilsynet, hvis du mener, dine rettigheder er krænket.',
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
    // Hosting card
    hostingTitle: 'Hosting and data sovereignty',
    hostingProvider: 'Yggdrasil Cloud',
    hostingProviderUrl: 'https://yggdrasilcloud.dk/',
    hostingIntro: 'fellis.eu is hosted by Yggdrasil Cloud — a Danish cloud provider with servers located in Denmark.',
    hostingWhyTitle: 'Why EU hosting matters',
    hostingWhy: [
      'Your data never leaves the EU — it is physically stored in Denmark and subject to Danish and European law.',
      'The EU GDPR regulation gives you as a citizen strong rights over your personal data, including the right to access, rectification, erasure, and data portability.',
      'Unlike platforms hosted in the USA or other third countries, your data is not subject to legislation such as FISA 702, the CLOUD Act, or similar surveillance provisions.',
      'Danish data centers operate under strict European standards for security, environment, and energy efficiency.',
    ],
    hostingRightsTitle: 'Your benefits from EU hosting',
    hostingRights: [
      'Full GDPR protection — your data is processed in accordance with the world\'s strictest personal data legislation.',
      'No transfers to third countries — your data is not shared with authorities outside the EU without a legal basis.',
      'The Danish Data Protection Agency (Datatilsynet) supervises the processing of your data.',
      'You always have the right to file a complaint with the Danish Data Protection Agency if you believe your rights have been violated.',
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

      </div>

      {/* ── Storage & Security — own card ── */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{t.privacyStorageTitle}</h3>
        <ul style={listStyle}>
          {t.privacyStorage.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>

      {/* ── Hosting & Data Sovereignty — own card ── */}
      <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, #F0FAF4 0%, #fff 100%)', borderColor: '#d0e8d8' }}>
        <h3 style={sectionTitleStyle}>{t.hostingTitle}</h3>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
          {t.hostingIntro}{' '}
          <a href={t.hostingProviderUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2D6A4F', fontWeight: 600 }}>
            {t.hostingProvider} &#8599;
          </a>
        </p>

        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 0 }}>{t.hostingWhyTitle}</p>
        <ul style={listStyle}>
          {t.hostingWhy.map((item, i) => <li key={i}>{item}</li>)}
        </ul>

        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 0, marginTop: 12 }}>{t.hostingRightsTitle}</p>
        <ul style={listStyle}>
          {t.hostingRights.map((item, i) => <li key={i}>{item}</li>)}
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
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [searchResults, setSearchResults] = useState(null) // null = no search active
  // sentIds: userId → requestId (or true if accepted)
  const [sentIds, setSentIds] = useState({})
  const [inviteLink, setInviteLink] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const searchTimerRef = useRef(null)

  const refreshAll = useCallback(() => {
    apiFetchFriends().then(data => { if (data) setFriends(data) })
    apiFetchFriendRequests().then(data => { if (data) setRequests(data) })
  }, [])

  useEffect(() => {
    refreshAll()
    apiGetInviteLink().then(data => {
      if (data?.token) setInviteLink(`https://fellis.eu/?invite=${data.token}`)
    })
  }, [refreshAll])

  // Debounced user search
  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    if (search.trim().length < 2) { setSearchResults(null); return }
    searchTimerRef.current = setTimeout(async () => {
      const data = await apiSearchUsers(search.trim())
      if (data) setSearchResults(data)
    }, 320)
    return () => clearTimeout(searchTimerRef.current)
  }, [search])

  const handleSendRequest = useCallback(async (userId) => {
    const res = await apiSendFriendRequest(userId)
    if (res?.ok) {
      // optimistic: mark as sent (we don't have the DB id yet, use placeholder)
      setSentIds(prev => ({ ...prev, [userId]: 'sent' }))
      // refresh to get real request id
      apiFetchFriendRequests().then(data => { if (data) setRequests(data) })
    }
  }, [])

  const handleAccept = useCallback(async (reqId) => {
    await apiAcceptFriendRequest(reqId)
    refreshAll()
  }, [refreshAll])

  const handleDecline = useCallback(async (reqId) => {
    await apiDeclineFriendRequest(reqId)
    setRequests(prev => ({
      ...prev,
      incoming: prev.incoming.filter(r => r.id !== reqId),
    }))
  }, [])

  const filtered = friends.filter(f => filter === 'all' || f.online)

  const handleCopyInvite = useCallback(() => {
    navigator.clipboard.writeText(inviteLink).catch(() => {})
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }, [inviteLink])

  const handleFbShare = useCallback(() => {
    const shareUrl = encodeURIComponent(inviteLink || 'https://fellis.eu')
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`, 'facebook-share', 'width=580,height=400')
  }, [inviteLink])

  const isSearching = search.trim().length >= 2
  // Build a set of outgoing target user ids for quick lookup
  const outgoingTargetIds = new Set(requests.outgoing.map(r => r.to_id))

  return (
    <div className="p-friends-page">
      {/* Invite friends card */}
      <div className="p-card p-invite-card">
        <h3 className="p-section-title" style={{ margin: '0 0 8px' }}>
          {lang === 'da' ? 'Inviter venner fra Facebook' : 'Invite friends from Facebook'}
        </h3>
        <p className="p-invite-desc">
          {lang === 'da'
            ? 'Del dit link med Facebook-venner — I bliver automatisk forbundet, når de tilmelder sig.'
            : 'Share your link with Facebook friends — you will be automatically connected when they sign up.'}
        </p>
        <div className="p-invite-link-row">
          <input
            className="p-invite-link-input"
            value={inviteLink || 'https://fellis.eu/?invite=...'}
            readOnly
            onClick={e => e.target.select()}
          />
          <button className="p-invite-copy-btn" onClick={handleCopyInvite}>
            {inviteCopied ? (lang === 'da' ? 'Kopieret!' : 'Copied!') : (lang === 'da' ? 'Kopier' : 'Copy')}
          </button>
        </div>
        <button className="p-fb-share-btn" onClick={handleFbShare}>
          <span className="fb-icon">f</span>
          {lang === 'da' ? 'Del på Facebook' : 'Share on Facebook'}
        </button>
      </div>

      {/* Incoming connection requests */}
      {requests.incoming.length > 0 && (
        <div className="p-card p-friend-requests-card">
          <h3 className="p-section-title" style={{ margin: '0 0 12px' }}>
            {t.incomingRequests} ({requests.incoming.length})
          </h3>
          <div className="p-friend-requests-list">
            {requests.incoming.map(req => (
              <div key={req.id} className="p-friend-request-row">
                <div className="p-avatar-sm" style={{ background: nameToColor(req.from_name) }}>
                  {getInitials(req.from_name)}
                </div>
                <div className="p-friend-request-name">{req.from_name}</div>
                <div className="p-friend-request-actions">
                  <button className="p-freq-accept-btn" onClick={() => handleAccept(req.id)}>
                    {t.acceptRequest}
                  </button>
                  <button className="p-freq-decline-btn" onClick={() => handleDecline(req.id)}>
                    {t.declineRequest}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-card">
        <h3 className="p-section-title" style={{ margin: '0 0 16px' }}>
          {isSearching ? t.findPeople : t.friendsTitle}
        </h3>
        <input
          className="p-search-input"
          placeholder={t.searchFriends}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {!isSearching && (
          <div className="p-filter-tabs">
            <button className={`p-filter-tab${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
              {t.allFriends} ({friends.length})
            </button>
            <button className={`p-filter-tab${filter === 'online' ? ' active' : ''}`} onClick={() => setFilter('online')}>
              {t.onlineFriends} ({friends.filter(f => f.online).length})
            </button>
          </div>
        )}
      </div>

      {isSearching ? (
        <div className="p-friends-grid">
          {(searchResults || []).map((user) => {
            const isFriend = user.is_friend
            const hasSentRequest = outgoingTargetIds.has(user.id) || sentIds[user.id]
            const incomingReq = requests.incoming.find(r => r.from_id === user.id)
            return (
              <div key={user.id} className="p-card p-friend-card">
                <div className="p-friend-card-top">
                  <div className="p-avatar-md" style={{ background: nameToColor(user.name) }}>
                    {getInitials(user.name)}
                    {user.online && <div className="online-dot" />}
                  </div>
                  <div className="p-friend-card-name">{user.name}</div>
                  {isFriend && <div className="p-friend-card-mutual">✓ {t.allFriends}</div>}
                </div>
                {isFriend ? (
                  <button className="p-friend-msg-btn" onClick={onMessage}>
                    💬 {t.message}
                  </button>
                ) : incomingReq ? (
                  <div className="p-freq-inline-actions">
                    <span className="p-freq-label">{t.requestReceived}</span>
                    <button className="p-freq-accept-btn" onClick={() => handleAccept(incomingReq.id)}>{t.acceptRequest}</button>
                    <button className="p-freq-decline-btn" onClick={() => handleDecline(incomingReq.id)}>{t.declineRequest}</button>
                  </div>
                ) : hasSentRequest ? (
                  <button className="p-friend-msg-btn p-friend-sent-btn" disabled>
                    ✉ {t.requestSent}
                  </button>
                ) : (
                  <button className="p-friend-msg-btn p-friend-add-btn" onClick={() => handleSendRequest(user.id)}>
                    ➕ {t.connectRequest}
                  </button>
                )}
              </div>
            )
          })}
          {searchResults !== null && searchResults.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '24px', color: 'var(--color-muted)' }}>
              {lang === 'da' ? 'Ingen brugere fundet' : 'No users found'}
            </div>
          )}
        </div>
      ) : (
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
      )}
    </div>
  )
}

// ── Messages ──
const MSG_PAGE_SIZE = 20

// ── New Conversation / New Group Modal ──
function NewConvModal({ t, lang, friends, existingParticipantIds = [], isGroupMode, onClose, onCreate }) {
  const [selected, setSelected] = useState([])
  const [groupName, setGroupName] = useState('')
  const [search, setSearch] = useState('')

  const eligible = friends.filter(f =>
    !existingParticipantIds.includes(f.id) &&
    f.name.toLowerCase().includes(search.toLowerCase())
  )
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const canCreate = isGroupMode ? selected.length >= 1 : selected.length === 1

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-msg-modal" onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>{isGroupMode ? t.newGroupTitle : t.newConvTitle}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        {isGroupMode && (
          <input
            className="p-msg-modal-input"
            placeholder={t.groupNamePlaceholder}
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
          />
        )}
        <input
          className="p-msg-modal-input"
          placeholder={t.searchFriends}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        <div className="p-msg-modal-list">
          {eligible.map(f => (
            <label key={f.id} className={`p-msg-modal-item${selected.includes(f.id) ? ' selected' : ''}`}>
              <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} style={{ display: 'none' }} />
              <div className="p-avatar-sm" style={{ background: nameToColor(f.name), flexShrink: 0 }}>{getInitials(f.name)}</div>
              <span className="p-msg-modal-name">{f.name}</span>
              {selected.includes(f.id) && <span className="p-msg-modal-check">✓</span>}
            </label>
          ))}
          {eligible.length === 0 && <div className="p-msg-modal-empty">{lang === 'da' ? 'Ingen venner fundet' : 'No friends found'}</div>}
        </div>
        <div className="p-msg-modal-footer">
          <button className="p-msg-modal-btn secondary" onClick={onClose}>{t.cancel}</button>
          <button
            className="p-msg-modal-btn primary"
            disabled={!canCreate}
            onClick={() => onCreate(selected, isGroupMode ? (groupName || null) : null, isGroupMode)}
          >
            {isGroupMode ? t.createGroup : t.startConv}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Conversation Header Menu ──
function ConvMenu({ t, lang, conv, onClose, onInvite, onMute, onRename, onLeave }) {
  const isMuted = conv.mutedUntil && new Date(conv.mutedUntil) > new Date()

  return (
    <div className="p-msg-conv-menu" onClick={e => e.stopPropagation()}>
      <button className="p-msg-conv-menu-item" onClick={() => { onInvite(); onClose() }}>
        <span>👤+</span> {t.invitePeople}
      </button>
      {conv.isGroup && (
        <button className="p-msg-conv-menu-item" onClick={() => { onRename(); onClose() }}>
          <span>✏️</span> {t.renameGroup}
        </button>
      )}
      <button className="p-msg-conv-menu-item" onClick={() => { onMute(); onClose() }}>
        <span>{isMuted ? '🔔' : '🔕'}</span> {isMuted ? t.unmuteConv : t.muteConv}
      </button>
      {conv.isGroup && (
        <button className="p-msg-conv-menu-item danger" onClick={() => { onLeave(); onClose() }}>
          <span>🚪</span> {t.leaveGroup}
        </button>
      )}
    </div>
  )
}

// ── Mute Duration Picker ──
function MuteModal({ t, onClose, onMute }) {
  const options = [
    { label: t.mute1h, minutes: 60 },
    { label: t.mute8h, minutes: 480 },
    { label: t.mute24h, minutes: 1440 },
    { label: t.mute1w, minutes: 10080 },
    { label: t.muteOff, minutes: null },
  ]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-msg-modal" style={{ maxWidth: 320 }} onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>{t.muteTitle}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="p-msg-modal-list">
          {options.map(o => (
            <button key={o.label} className="p-msg-modal-item mute-option" onClick={() => { onMute(o.minutes); onClose() }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Rename Group Modal ──
function RenameModal({ t, current, onClose, onRename }) {
  const [name, setName] = useState(current || '')
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-msg-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>{t.renameTitle}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        <input
          className="p-msg-modal-input"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          onKeyDown={e => e.key === 'Enter' && name.trim() && onRename(name.trim())}
        />
        <div className="p-msg-modal-footer">
          <button className="p-msg-modal-btn secondary" onClick={onClose}>{t.cancel}</button>
          <button className="p-msg-modal-btn primary" disabled={!name.trim()} onClick={() => onRename(name.trim())}>
            {t.renameBtn}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Search ──
function SearchPage({ lang, t, onNavigateToPost, onNavigateToConv }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // { posts, messages } | null
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults(null); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await apiSearch(query.trim())
        setResults(data || { posts: [], messages: [] })
      } finally {
        setLoading(false)
      }
    }, 320)
    return () => { clearTimeout(timer); setLoading(false) }
  }, [query])

  // Highlight matching text in an excerpt
  const excerpt = (text, q) => {
    if (!text) return null
    const qi = text.toLowerCase().indexOf(q.toLowerCase())
    if (qi === -1) return <span>{text.slice(0, 120)}{text.length > 120 ? '…' : ''}</span>
    const start = Math.max(0, qi - 35)
    const end = Math.min(text.length, qi + q.length + 65)
    return (
      <>
        {start > 0 && '…'}
        {text.slice(start, qi)}
        <mark className="p-search-hl">{text.slice(qi, qi + q.length)}</mark>
        {text.slice(qi + q.length, end)}
        {end < text.length && '…'}
      </>
    )
  }

  const q = query.trim()
  const hasPosts = results?.posts?.length > 0
  const hasMessages = results?.messages?.length > 0
  const empty = results && !hasPosts && !hasMessages

  return (
    <div className="p-search-page">
      {/* Search bar */}
      <div className="p-search-bar">
        <span className="p-search-bar-icon">🔍</span>
        <input
          ref={inputRef}
          className="p-search-bar-input"
          type="text"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
        />
        {query && <button className="p-search-bar-clear" onClick={() => { setQuery(''); setResults(null) }}>✕</button>}
      </div>

      {/* States */}
      {!query && <p className="p-search-hint">{t.searchHint}</p>}
      {loading && <div className="p-search-status">{lang === 'da' ? 'Søger…' : 'Searching…'}</div>}
      {empty && !loading && (
        <div className="p-search-status">
          {lang === 'da' ? `Ingen resultater for "${q}"` : `No results for "${q}"`}
        </div>
      )}

      {/* Results */}
      {(hasPosts || hasMessages) && (
        <div className="p-search-results">
          {hasPosts && (
            <section className="p-search-section">
              <h3 className="p-search-section-title">
                <span>📝</span> {t.searchPostsTitle}
                <span className="p-search-count">{results.posts.length}</span>
              </h3>
              {results.posts.map(post => (
                <div key={post.id} className="p-search-result" onClick={() => onNavigateToPost(post.id)}>
                  <div className="p-search-result-top">
                    <div className="p-avatar-xs" style={{ background: nameToColor(post.author), flexShrink: 0 }}>
                      {getInitials(post.author)}
                    </div>
                    <span className="p-search-result-author">{post.author}</span>
                    <span className="p-search-result-time">{post.time?.[lang]}</span>
                    <span className="p-search-result-arrow">→</span>
                  </div>
                  <div className="p-search-result-text">{excerpt(post.text[lang], q)}</div>
                </div>
              ))}
            </section>
          )}
          {hasMessages && (
            <section className="p-search-section">
              <h3 className="p-search-section-title">
                <span>💬</span> {t.searchMessagesTitle}
                <span className="p-search-count">{results.messages.length}</span>
              </h3>
              {results.messages.map(msg => (
                <div key={msg.id} className="p-search-result" onClick={() => onNavigateToConv(msg.conversationId)}>
                  <div className="p-search-result-top">
                    <div className="p-avatar-xs" style={{ background: nameToColor(msg.convName), flexShrink: 0 }}>
                      {getInitials(msg.convName)}
                    </div>
                    <span className="p-search-result-author">{msg.convName}</span>
                    <span className="p-search-result-time">{msg.time}</span>
                    <span className="p-search-result-arrow">→</span>
                  </div>
                  <div className="p-search-result-text">
                    <span className="p-search-result-from">{msg.from}: </span>
                    {excerpt(msg.text[lang], q)}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function MessagesPage({ lang, t, currentUser, openConvId, onConvOpened }) {
  const [activeConv, setActiveConv] = useState(0)
  const [conversations, setConversations] = useState([])
  const [friends, setFriends] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | 'newGroup' | 'invite' | 'mute' | 'rename'
  const [showConvMenu, setShowConvMenu] = useState(false)
  const messagesEndRef = useRef(null)
  const msgBodyRef = useRef(null)
  const topMsgSentinelRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    apiFetchConversations().then(data => { if (data) setConversations(data) })
    apiFetchFriends().then(data => { if (data) setFriends(data) })
  }, [])

  // Open a specific conversation when navigated from search
  useEffect(() => {
    if (!openConvId || !conversations.length) return
    const idx = conversations.findIndex(c => c.id === openConvId)
    if (idx >= 0) { setActiveConv(idx); onConvOpened?.() }
  }, [openConvId, conversations])

  // Close conv menu on outside click
  useEffect(() => {
    if (!showConvMenu) return
    const handle = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowConvMenu(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showConvMenu])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations, activeConv])

  // Infinite scroll — load older messages at top
  useEffect(() => {
    const el = topMsgSentinelRef.current
    if (!el) return
    const conv = conversations[activeConv]
    if (!conv || conv.messages.length >= (conv.totalMessages || 0)) return
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loadingOlder) return
      setLoadingOlder(true)
      const prevScrollHeight = msgBodyRef.current?.scrollHeight || 0
      const data = await apiFetchOlderConversationMessages(conv.id, conv.messages.length, MSG_PAGE_SIZE)
      if (data?.messages?.length > 0) {
        setConversations(prev => prev.map((c, i) => {
          if (i !== activeConv) return c
          const combined = [...data.messages, ...c.messages]
          return { ...c, messages: combined.length > 40 ? combined.slice(0, 40) : combined }
        }))
        requestAnimationFrame(() => {
          if (msgBodyRef.current) {
            msgBodyRef.current.scrollTop = msgBodyRef.current.scrollHeight - prevScrollHeight
          }
        })
      }
      setLoadingOlder(false)
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [activeConv, conversations, loadingOlder])

  const handleSend = useCallback(() => {
    if (!newMsg.trim()) return
    const text = newMsg.trim()
    const conv = conversations[activeConv]
    const time = new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
    setConversations(prev => prev.map((c, i) => {
      if (i !== activeConv) return c
      const msgs = [...c.messages, { from: currentUser.name, text: { da: text, en: text }, time }]
      return { ...c, messages: msgs.length > MSG_PAGE_SIZE ? msgs.slice(-MSG_PAGE_SIZE) : msgs,
        totalMessages: (c.totalMessages || c.messages.length) + 1, unread: 0 }
    }))
    setNewMsg('')
    if (conv?.id) apiSendConversationMessage(conv.id, text).catch(() => {})
  }, [newMsg, activeConv, conversations, currentUser.name])

  const selectConv = useCallback((i) => {
    setActiveConv(i)
    setShowConvMenu(false)
    setConversations(prev => prev.map((c, j) => j === i ? { ...c, unread: 0 } : c))
  }, [])

  // Create new 1:1 or group
  const handleCreate = async (selectedIds, groupName, isGroup) => {
    setModal(null)
    const data = await apiCreateConversation(selectedIds, groupName, isGroup)
    if (data?.id) {
      // Refresh conversations
      const updated = await apiFetchConversations()
      if (updated) {
        setConversations(updated)
        const idx = updated.findIndex(c => c.id === data.id)
        setActiveConv(idx >= 0 ? idx : 0)
      }
    }
  }

  // Invite more people to the active conversation
  const handleInvite = async (selectedIds) => {
    setModal(null)
    const conv = conversations[activeConv]
    if (!conv) return
    await apiInviteToConversation(conv.id, selectedIds)
    const updated = await apiFetchConversations()
    if (updated) {
      setConversations(updated)
      const idx = updated.findIndex(c => c.id === conv.id)
      setActiveConv(idx >= 0 ? idx : 0)
    }
  }

  // Mute
  const handleMute = async (minutes) => {
    const conv = conversations[activeConv]
    if (!conv) return
    const result = await apiMuteConversation(conv.id, minutes)
    if (result) {
      setConversations(prev => prev.map((c, i) =>
        i === activeConv ? { ...c, mutedUntil: result.mutedUntil } : c))
    }
  }

  // Rename
  const handleRename = async (name) => {
    setModal(null)
    const conv = conversations[activeConv]
    if (!conv) return
    await apiRenameConversation(conv.id, name)
    setConversations(prev => prev.map((c, i) =>
      i === activeConv ? { ...c, name, groupName: name } : c))
  }

  // Leave group
  const handleLeave = async () => {
    const conv = conversations[activeConv]
    if (!conv || !window.confirm(t.leaveConfirm)) return
    await apiLeaveConversation(conv.id)
    const updated = await apiFetchConversations()
    setConversations(updated || [])
    setActiveConv(0)
  }

  const conv = conversations[activeConv]
  const isMuted = conv?.mutedUntil && new Date(conv.mutedUntil) > new Date()

  // Friends not yet in this conversation (for invite)
  const nonParticipants = friends.filter(f => !conv?.participants?.some(p => p.id === f.id))

  return (
    <div className="p-messages" onClick={() => showConvMenu && setShowConvMenu(false)}>
      {/* ── Sidebar ── */}
      <div className="p-msg-sidebar">
        <div className="p-msg-sidebar-header">
          <h3 className="p-msg-sidebar-title">{t.messagesTitle}</h3>
          <div className="p-msg-sidebar-actions">
            <button className="p-msg-icon-btn" title={t.newMessage} onClick={() => setModal('new')}>✏️</button>
            <button className="p-msg-icon-btn" title={t.newGroup} onClick={() => setModal('newGroup')}>👥</button>
          </div>
        </div>

        {conversations.length === 0 && (
          <div className="p-msg-empty-sidebar">{lang === 'da' ? 'Ingen samtaler endnu' : 'No conversations yet'}</div>
        )}

        {conversations.map((c, i) => {
          const lastMsg = c.messages[c.messages.length - 1]
          const cIsMuted = c.mutedUntil && new Date(c.mutedUntil) > new Date()
          return (
            <div
              key={c.id}
              className={`p-msg-thread${i === activeConv ? ' active' : ''}`}
              onClick={() => selectConv(i)}
            >
              {/* Avatar: stacked initials for group, single for 1:1 */}
              {c.isGroup ? (
                <div className="p-msg-group-avatar">
                  {c.participants.slice(0, 2).map((p, pi) => (
                    <div key={p.id} className="p-msg-group-avatar-chip" style={{ background: nameToColor(p.name), zIndex: 2 - pi, marginLeft: pi > 0 ? -10 : 0 }}>
                      {getInitials(p.name)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-avatar-sm" style={{ background: nameToColor(c.name), flexShrink: 0 }}>
                  {getInitials(c.name)}
                </div>
              )}
              <div className="p-msg-thread-info">
                <div className="p-msg-thread-name">
                  <span>{c.name}</span>
                  <span className="p-msg-thread-badges">
                    {cIsMuted && <span className="p-msg-muted-icon" title={t.mutedLabel}>🔕</span>}
                    {c.unread > 0 && <span className="p-msg-badge">{c.unread}</span>}
                  </span>
                </div>
                <div className="p-msg-thread-preview">
                  {lastMsg ? `${c.isGroup ? lastMsg.from.split(' ')[0] + ': ' : ''}${lastMsg.text[lang]}`.slice(0, 42) : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Main chat area ── */}
      {!conv ? (
        <div className="p-msg-main p-msg-main-empty">
          <div className="p-empty-state">{t.noMessages}</div>
        </div>
      ) : (
        <div className="p-msg-main">
          {/* Header */}
          <div className="p-msg-header">
            {conv.isGroup ? (
              <div className="p-msg-group-avatar" style={{ flexShrink: 0 }}>
                {conv.participants.slice(0, 2).map((p, pi) => (
                  <div key={p.id} className="p-msg-group-avatar-chip" style={{ background: nameToColor(p.name), zIndex: 2 - pi, marginLeft: pi > 0 ? -10 : 0, width: 32, height: 32, fontSize: 11 }}>
                    {getInitials(p.name)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-avatar-sm" style={{ background: nameToColor(conv.name), flexShrink: 0 }}>
                {getInitials(conv.name)}
              </div>
            )}
            <div className="p-msg-header-info">
              <span className="p-msg-header-name">
                {conv.name}
                {isMuted && <span className="p-msg-muted-icon" title={t.mutedLabel} style={{ marginLeft: 6 }}>🔕</span>}
              </span>
              {conv.isGroup && (
                <span className="p-msg-header-sub">
                  {conv.participants.length} {t.participants}
                </span>
              )}
            </div>
            {/* Conversation menu */}
            <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
              <button
                className="p-msg-icon-btn"
                title={t.convMenu}
                onClick={e => { e.stopPropagation(); setShowConvMenu(v => !v) }}
              >•••</button>
              {showConvMenu && (
                <ConvMenu
                  t={t}
                  lang={lang}
                  conv={conv}
                  onClose={() => setShowConvMenu(false)}
                  onInvite={() => setModal('invite')}
                  onMute={() => setModal('mute')}
                  onRename={() => setModal('rename')}
                  onLeave={handleLeave}
                />
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="p-msg-body" ref={msgBodyRef}>
            {conv.messages.length < (conv.totalMessages || 0) && (
              <div ref={topMsgSentinelRef} className="p-feed-sentinel">
                {loadingOlder && <div className="p-feed-loading">{lang === 'da' ? 'Indlæser ældre...' : 'Loading older...'}</div>}
              </div>
            )}
            {conv.messages.map((msg, i) => {
              const isMe = msg.from === currentUser.name
              return (
                <div key={i} className={`p-msg-bubble-row${isMe ? ' mine' : ''}`}>
                  {!isMe && (
                    <div className="p-avatar-xs" style={{ background: nameToColor(msg.from), flexShrink: 0 }}>
                      {getInitials(msg.from)}
                    </div>
                  )}
                  <div className={`p-msg-bubble${isMe ? ' mine' : ''}`}>
                    {conv.isGroup && !isMe && (
                      <div className="p-msg-sender-name">{msg.from.split(' ')[0]}</div>
                    )}
                    <div>{msg.text[lang]}</div>
                    <div className="p-msg-time">{msg.time}</div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
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
      )}

      {/* ── Modals ── */}
      {(modal === 'new' || modal === 'newGroup') && (
        <NewConvModal
          t={t}
          lang={lang}
          friends={friends}
          existingParticipantIds={[]}
          isGroupMode={modal === 'newGroup'}
          onClose={() => setModal(null)}
          onCreate={handleCreate}
        />
      )}
      {modal === 'invite' && conv && (
        <NewConvModal
          t={{ ...t, newConvTitle: t.inviteTitle, startConv: t.inviteBtn, newGroupTitle: t.inviteTitle, createGroup: t.inviteBtn }}
          lang={lang}
          friends={nonParticipants}
          existingParticipantIds={conv.participants.map(p => p.id)}
          isGroupMode={true}
          onClose={() => setModal(null)}
          onCreate={(ids) => handleInvite(ids)}
        />
      )}
      {modal === 'mute' && <MuteModal t={t} onClose={() => setModal(null)} onMute={handleMute} />}
      {modal === 'rename' && conv && (
        <RenameModal t={t} current={conv.groupName} onClose={() => setModal(null)} onRename={handleRename} />
      )}
    </div>
  )
}
