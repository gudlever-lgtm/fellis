import { useState, useCallback, useRef, useEffect } from 'react'
import { PT, nameToColor, getInitials } from './data.js'
import { apiFetchFeed, apiCreatePost, apiToggleLike, apiAddComment, apiFetchProfile, apiFetchFriends, apiFetchConversations, apiSendConversationMessage, apiFetchOlderConversationMessages, apiCreateConversation, apiInviteToConversation, apiMuteConversation, apiLeaveConversation, apiRenameConversation, apiUploadAvatar, apiCheckSession, apiDeleteFacebookData, apiDeleteAccount, apiExportData, apiGetConsentStatus, apiWithdrawConsent, apiGetInviteLink, apiLinkPreview, apiSearch, apiGetPost, apiSearchUsers, apiSendFriendRequest, apiFetchFriendRequests, apiAcceptFriendRequest, apiDeclineFriendRequest, apiUnfriend } from './api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Mock notifications ──
function makeMockNotifs(mode) {
  const isBiz = mode === 'business'
  const base = [
    { id: 1, type: 'friend_request', actor: 'Liam Madsen', time: '2 min', read: false, targetPage: 'friends' },
    { id: 2, type: 'like', actor: 'Clara Johansen', time: '15 min', read: false, targetPage: 'feed' },
    { id: 3, type: 'comment', actor: 'Magnus Jensen', time: '1 t', read: false, targetPage: 'feed' },
    { id: 4, type: 'accepted', actor: 'Astrid Poulsen', time: '3 t', read: true, targetPage: 'friends' },
    { id: 5, type: 'group_post', actor: 'Emil Larsen', group: 'Designere i KBH', time: '5 t', read: true, targetPage: 'feed' },
  ]
  if (isBiz) {
    base.push(
      { id: 6, type: 'profile_view', actor: 'Freja Andersen', time: '8 t', read: true, targetPage: 'profile' },
      { id: 7, type: 'endorsement', actor: 'Noah Rasmussen', time: '1 d', read: true, targetPage: 'profile' },
    )
  }
  return base
}

export default function Platform({ lang: initialLang, onLogout }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const [currentUser, setCurrentUser] = useState({ name: '', handle: '', initials: '' })
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const [openConvId, setOpenConvId] = useState(null)
  const [highlightPostId, setHighlightPostId] = useState(null)
  const [mode, setMode] = useState(() => localStorage.getItem('fellis_mode') || 'common')
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [notifs, setNotifs] = useState(() => makeMockNotifs(localStorage.getItem('fellis_mode') || 'common'))
  const [showModeModal, setShowModeModal] = useState(false)
  const avatarMenuRef = useRef(null)
  const notifRef = useRef(null)
  const t = PT[lang]

  const unreadCount = notifs.filter(n => !n.read).length

  const switchMode = (newMode) => {
    setMode(newMode)
    localStorage.setItem('fellis_mode', newMode)
    setNotifs(makeMockNotifs(newMode))
    setShowModeModal(false)
  }

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })))

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!showAvatarMenu && !showNotifPanel) return
    const handleClick = (e) => {
      if (showAvatarMenu && avatarMenuRef.current && !avatarMenuRef.current.contains(e.target)) {
        setShowAvatarMenu(false)
      }
      if (showNotifPanel && notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifPanel(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAvatarMenu, showNotifPanel])

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
          {['feed', 'friends', 'messages', 'events', ...(mode === 'business' ? ['jobs'] : [])].map(p => (
            <button
              key={p}
              className={`p-nav-tab${page === p ? ' active' : ''}`}
              onClick={() => navigateTo(p)}
            >
              <span className="p-nav-tab-icon">
                {p === 'feed' ? '🏠' : p === 'friends' ? '👥' : p === 'messages' ? '💬' : p === 'events' ? '📅' : '💼'}
              </span>
              <span className="p-nav-tab-label">
                {p === 'friends'
                  ? (mode === 'business' ? t.connectionsLabel : t.friends)
                  : (t[p] || p)}
              </span>
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

          {/* Notification bell */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button
              className="p-nav-notif-btn"
              onClick={() => { setShowNotifPanel(v => !v); setShowAvatarMenu(false) }}
              aria-label={t.notifications}
              title={t.notifications}
            >
              🔔
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
            </button>
            {showNotifPanel && (
              <NotificationsPanel
                notifs={notifs}
                t={t}
                lang={lang}
                mode={mode}
                onMarkAllRead={markAllRead}
                onMarkRead={(id) => setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))}
                onNavigate={(pg) => { navigateTo(pg); setShowNotifPanel(false) }}
              />
            )}
          </div>

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
                  <span style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                    {mode === 'business' ? t.modeBusinessTag : t.modeCommonTag}
                  </span>
                </div>
                <div className="avatar-dropdown-divider" />
                <button className="avatar-dropdown-item" onClick={() => navigateTo('profile')}>
                  <span>👤</span> {menuT.viewProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('edit-profile')}>
                  <span>✏️</span> {menuT.editProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => { setShowAvatarMenu(false); setShowModeModal(true) }}>
                  <span>{mode === 'business' ? '💼' : '🏠'}</span> {t.modeSwitch}
                </button>
                {mode === 'business' && (
                  <button className="avatar-dropdown-item" onClick={() => navigateTo('company')}>
                    <span>🏢</span> {t.companies}
                  </button>
                )}
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
        {page === 'feed' && <FeedPage lang={lang} t={t} currentUser={currentUser} mode={mode} highlightPostId={highlightPostId} onHighlightCleared={() => setHighlightPostId(null)} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} currentUser={currentUser} mode={mode} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'edit-profile' && <EditProfilePage lang={lang} t={t} currentUser={currentUser} mode={mode} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} mode={mode} onMessage={() => navigateTo('messages')} />}
        {page === 'messages' && <MessagesPage lang={lang} t={t} currentUser={currentUser} mode={mode} openConvId={openConvId} onConvOpened={() => setOpenConvId(null)} />}
        {page === 'events' && <EventsPage lang={lang} t={t} currentUser={currentUser} mode={mode} />}
        {page === 'jobs' && <JobsPage lang={lang} t={t} currentUser={currentUser} mode={mode} />}
        {page === 'company' && <CompanyListPage lang={lang} t={t} currentUser={currentUser} mode={mode} onNavigate={navigateTo} />}
        {page === 'privacy' && <PrivacySection lang={lang} onLogout={onLogout} />}
        {page === 'search' && (
          <SearchPage
            lang={lang}
            t={t}
            mode={mode}
            onNavigateToPost={(postId) => { setHighlightPostId(postId); navigateTo('feed') }}
            onNavigateToConv={(convId) => { setOpenConvId(convId); navigateTo('messages') }}
            onNavigateToCompany={() => navigateTo('company')}
          />
        )}
      </div>

      {/* Mode switch modal */}
      {showModeModal && (
        <div className="modal-backdrop" onClick={() => setShowModeModal(false)}>
          <div className="mode-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>{t.modeTitle}</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#888' }}>{t.modeCurrentLabel}: <strong>{mode === 'business' ? t.modeBusiness : t.modeCommon}</strong></p>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { key: 'common', label: t.modeCommon, icon: '🏠', desc: t.modeCommonDesc },
                { key: 'business', label: t.modeBusiness, icon: '💼', desc: t.modeBusinessDesc },
              ].map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  onClick={() => switchMode(key)}
                  className={`mode-card${mode === key ? ' mode-card-active' : ''}`}
                >
                  <span style={{ fontSize: 28 }}>{icon}</span>
                  <strong style={{ fontSize: 15 }}>{label}</strong>
                  <span style={{ fontSize: 12, color: '#777', lineHeight: 1.4 }}>{desc}</span>
                  {mode === key && <span className="mode-card-check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Notifications Panel ──
function NotificationsPanel({ notifs, t, lang, mode, onMarkAllRead, onMarkRead, onNavigate }) {
  const getLabel = (n) => {
    switch (n.type) {
      case 'friend_request': return mode === 'business' ? t.notifConnectionRequest : t.notifFriendRequest
      case 'like': return t.notifLike
      case 'comment': return t.notifComment
      case 'accepted': return mode === 'business' ? t.notifConnectionAccepted : t.notifAccepted
      case 'group_post': return `${t.notifGroupPost} "${n.group}"`
      case 'profile_view': return t.notifProfileView
      case 'endorsement': return t.notifEndorsement
      default: return ''
    }
  }
  const unread = notifs.filter(n => !n.read).length
  return (
    <div className="notif-panel">
      <div className="notif-panel-header">
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t.notifications}</span>
        {unread > 0 && (
          <button className="notif-mark-all" onClick={onMarkAllRead}>{t.markAllRead}</button>
        )}
      </div>
      <div className="notif-list">
        {notifs.length === 0 ? (
          <div className="notif-empty">{t.noNotifications}</div>
        ) : notifs.map(n => (
          <div
            key={n.id}
            className={`notif-item${n.read ? '' : ' notif-item-unread'}`}
            onClick={() => { onMarkRead(n.id); onNavigate(n.targetPage) }}
          >
            <div className="notif-item-dot" style={{ opacity: n.read ? 0 : 1 }} />
            <div className="notif-item-body">
              <span className="notif-actor">{n.actor}</span>
              {' '}
              <span>{getLabel(n)}</span>
            </div>
            <div className="notif-item-time">{n.time}</div>
          </div>
        ))}
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
  const re = /https?:\/\/[^\s<>"']+|@[A-Za-zÀ-ÖØ-öø-ÿ]\w*/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
    if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) })
    if (raw.startsWith('@')) {
      parts.push({ t: 'mention', v: raw })
    } else {
      const url = raw.replace(/[.,!?;:)>]+$/, '')
      parts.push({ t: 'url', v: url })
    }
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
            : p.t === 'mention'
              ? <span key={i} className="p-mention">{p.v}</span>
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

// ── @mention autocomplete ──────────────────────────────────────────────────
function useMention(friends) {
  const [query, setQuery] = useState(null) // null = closed
  const [selIdx, setSelIdx] = useState(0)
  const filtered = query !== null
    ? friends.filter(f => f.name.toLowerCase().startsWith(query.toLowerCase()))
    : []

  const detect = useCallback((text, cursor) => {
    const before = text.slice(0, cursor)
    const m = before.match(/@([^\s@]*)$/)
    if (m) { setQuery(m[1]); setSelIdx(0) } else setQuery(null)
  }, [])

  const close = useCallback(() => setQuery(null), [])

  const handleKey = useCallback((e, onInsert) => {
    if (query === null || !filtered.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, filtered.length - 1)); return true }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)); return true }
    if (e.key === 'Enter')     { e.preventDefault(); onInsert(filtered[selIdx]); return true }
    if (e.key === 'Escape')    { setQuery(null); return true }
    return false
  }, [query, filtered, selIdx])

  const buildText = useCallback((text, cursor, friend) => {
    const before = text.slice(0, cursor)
    const atIdx = before.lastIndexOf('@')
    const firstName = friend.name.split(' ')[0]
    const newText = before.slice(0, atIdx) + '@' + firstName + ' ' + text.slice(cursor)
    setQuery(null)
    return { text: newText, cursor: atIdx + firstName.length + 2 }
  }, [])

  return { query, filtered, selIdx, detect, close, handleKey, buildText }
}

function MentionDropdown({ filtered, selIdx, onSelect }) {
  if (!filtered.length) return null
  return (
    <div className="p-mention-dropdown">
      {filtered.map((f, i) => (
        <div key={f.id}
          className={'p-mention-item' + (i === selIdx ? ' p-mention-item--sel' : '')}
          onMouseDown={e => { e.preventDefault(); onSelect(f) }}>
          <span className="p-mention-av" style={{ background: nameToColor(f.name) }}>
            {getInitials(f.name)}
          </span>
          <span className="p-mention-name">{f.name}</span>
        </div>
      ))}
    </div>
  )
}

function FeedPage({ lang, t, currentUser, highlightPostId, onHighlightCleared }) {
  const [posts, setPosts] = useState([])
  const [pinnedPost, setPinnedPost] = useState(null)
  const pinnedRef = useRef(null)
  const [viewProfileId, setViewProfileId] = useState(null)
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
  const feedMention = useMention(sharePopupFriends || [])
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

  const handleFeedPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean).slice(0, 4)
    if (files.length === 0) return
    setMediaFiles(prev => [...prev, ...files].slice(0, 4))
    setMediaPreviews(prev => [...prev, ...files.map(f => ({
      url: URL.createObjectURL(f), type: 'image', name: f.name || 'image.png',
    }))].slice(0, 4))
    setPostExpanded(true)
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
        setPosts(prev => [data, ...prev].slice(0, PAGE_SIZE))
        setTotal(prev => prev + 1)
      } else {
        const localMedia = mediaPreviews.length > 0
          ? mediaPreviews.map(p => ({ url: p.url, type: p.type, mime: '' }))
          : null
        setPosts(prev => [{
          id: Date.now(),
          author: currentUser.name,
          time: { da: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }), en: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
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
      {viewProfileId && (
        <FriendProfileModal
          userId={viewProfileId}
          lang={lang}
          t={t}
          onClose={() => setViewProfileId(null)}
          onMessage={() => setViewProfileId(null)}
        />
      )}
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
              <div style={{ position: 'relative', flex: 1 }}>
                {feedMention.query !== null && (
                  <MentionDropdown
                    filtered={feedMention.filtered}
                    selIdx={feedMention.selIdx}
                    onSelect={f => {
                      const cursor = textareaRef.current?.selectionStart ?? newPostText.length
                      const { text, cursor: newCursor } = feedMention.buildText(newPostText, cursor, f)
                      setNewPostText(text)
                      setTimeout(() => {
                        if (textareaRef.current) {
                          textareaRef.current.focus()
                          textareaRef.current.setSelectionRange(newCursor, newCursor)
                          textareaRef.current.style.height = 'auto'
                          textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
                        }
                      }, 0)
                    }}
                  />
                )}
                <textarea
                  ref={textareaRef}
                  className="p-new-post-textarea"
                  placeholder={t.newPost}
                  value={newPostText}
                  onChange={e => {
                    setNewPostText(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                    feedMention.detect(e.target.value, e.target.selectionStart)
                    if (e.target.value.includes('@') && sharePopupFriends === null) {
                      apiFetchFriends().then(d => { if (d) setSharePopupFriends(d) })
                    }
                  }}
                  onKeyDown={e => {
                    if (feedMention.handleKey(e, f => {
                      const cursor = textareaRef.current?.selectionStart ?? newPostText.length
                      const { text, cursor: nc } = feedMention.buildText(newPostText, cursor, f)
                      setNewPostText(text)
                      setTimeout(() => {
                        if (textareaRef.current) {
                          textareaRef.current.focus()
                          textareaRef.current.setSelectionRange(nc, nc)
                        }
                      }, 0)
                    })) return
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() }
                  }}
                  onPaste={handleFeedPaste}
                  onFocus={() => setPostExpanded(true)}
                  onBlur={() => {
                    if (!newPostText.trim() && !mediaPreviews.length) setPostExpanded(false)
                    feedMention.close()
                  }}
                  autoFocus={postExpanded && !newPostText}
                />
              </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="p-input-hint-wrap">
                  <span className="p-input-hint-icon">?</span>
                  <span className="p-input-hint-tooltip">{t.postInputHint}</span>
                </span>
                <button className="p-post-btn" onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={!newPostText.trim()}>{t.post}</button>
              </div>
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

      {/* Company post feed item */}
      {offset === 0 && MOCK_COMPANIES[0] && (
        <div className="p-card p-post">
          <div className="p-post-header">
            <div className="p-company-logo-sm" style={{ background: MOCK_COMPANIES[0].color, borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>
              {MOCK_COMPANIES[0].name[0]}
            </div>
            <div>
              <div className="p-post-author">{MOCK_COMPANIES[0].name}</div>
              <div className="p-post-time" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="p-event-type-badge" style={{ padding: '1px 6px', fontSize: 10 }}>{t.companyFeedLabel}</span>
                <span>{lang === 'da' ? '1 t siden' : '1 hr ago'}</span>
              </div>
            </div>
          </div>
          <div className="p-post-text">
            {lang === 'da'
              ? `Vi søger en dygtig UX Designer til vores team i København. Se vores ledige stillinger og lær mere om vores kultur. 🚀`
              : `We're looking for a talented UX Designer to join our team in Copenhagen. Check out our open positions and learn more about our culture. 🚀`
            }
          </div>
          <div className="p-post-actions">
            <button className="p-post-action-btn">❤️ {lang === 'da' ? 'Synes godt om' : 'Like'} (14)</button>
            <button className="p-post-action-btn">💬 {lang === 'da' ? 'Kommentar' : 'Comment'} (3)</button>
            <button className="p-post-action-btn">🔗 {lang === 'da' ? 'Følg siden' : 'Follow page'}</button>
          </div>
        </div>
      )}

      {/* Event activity feed items — shown when at top of feed */}
      {offset === 0 && [
        { id: 'ea1', actor: 'Magnus Jensen', verb: 'going', event: MOCK_EVENTS[0], time: { da: '35 min siden', en: '35 min ago' } },
        { id: 'ea2', actor: 'Freja Andersen', verb: 'created', event: MOCK_EVENTS[1], time: { da: '3 t siden', en: '3 hrs ago' } },
      ].map(item => {
        const title = typeof item.event.title === 'string' ? item.event.title : (item.event.title[lang] || item.event.title.da)
        const loc = typeof item.event.location === 'string' ? item.event.location : (item.event.location[lang] || item.event.location.da)
        const action = item.verb === 'going' ? t.eventFeedRsvpd : t.eventFeedCreated
        return (
          <div key={item.id} className="p-card p-post p-event-feed-card">
            <div className="p-post-header">
              <div className="p-avatar-sm" style={{ background: nameToColor(item.actor) }}>{getInitials(item.actor)}</div>
              <div>
                <div className="p-post-author">{item.actor} <span style={{ fontWeight: 400, color: '#888' }}>{action}</span></div>
                <div className="p-post-time">{item.time[lang]}</div>
              </div>
              <span className="p-event-type-badge" style={{ marginLeft: 'auto' }}>{t.eventFeedLabel}</span>
            </div>
            <div className="p-event-feed-body">
              <div className="p-event-date-col" style={{ minWidth: 44 }}>
                <div className="p-event-month">{new Date(item.event.date).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { month: 'short' }).toUpperCase()}</div>
                <div className="p-event-day">{new Date(item.event.date).getDate()}</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 13, color: '#777' }}>📍 {loc}</div>
                <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                  ✅ {item.event.going.length} {t.eventAttendees}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Posts — max PAGE_SIZE in DOM */}
      {posts.map(post => {
        const liked = likedPosts.has(post.id)
        const showComments = expandedComments.has(post.id)
        return (
          <div key={post.id} className="p-card p-post">
            <div className="p-post-header">
              <div
                className="p-avatar-sm"
                style={{ background: nameToColor(post.author), cursor: post.authorId && post.author !== currentUser.name ? 'pointer' : 'default' }}
                onClick={() => post.authorId && post.author !== currentUser.name && setViewProfileId(post.authorId)}
              >
                {getInitials(post.author)}
              </div>
              <div>
                <div
                  className="p-post-author"
                  style={{ cursor: post.authorId && post.author !== currentUser.name ? 'pointer' : 'default' }}
                  onClick={() => post.authorId && post.author !== currentUser.name && setViewProfileId(post.authorId)}
                >{post.author}</div>
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
                {post.familyGroupId ? (
                  <button className="p-action-btn p-action-btn-family-locked" disabled title={t.familyPostNotShareable}>
                    🏡 {t.share}
                  </button>
                ) : (
                <button className={`p-action-btn${sharePopup === post.id ? ' active' : ''}`} onClick={() => toggleSharePopup(post.id)}>
                  ↗ {t.share}
                </button>
                )}
                {!post.familyGroupId && sharePopup === post.id && (
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
function ProfilePage({ lang, t, currentUser, mode, onUserUpdate, onNavigate }) {
  const [profile, setProfile] = useState({ ...currentUser })
  const [userPosts, setUserPosts] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const [familyGroups, setFamilyGroups] = useState([])

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
    if (mode === 'common') {
      apiFetchConversations().then(convs => {
        if (convs) setFamilyGroups(convs.filter(c => c.isFamilyGroup))
      })
    }
  }, [currentUser.name, mode, onUserUpdate])

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
            {mode === 'business' && profile.jobTitle && <span>💼 {profile.jobTitle}{profile.company ? ` · ${profile.company}` : ''}</span>}
            {mode === 'business' && profile.industry && <span>🏭 {profile.industry}</span>}
            {profile.location && <span>📍 {profile.location}</span>}
            <span>📅 {t.joined} {profile.joinDate ? new Date(profile.joinDate).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
          {mode === 'business' && (
            <SkillsSection profile={profile} t={t} lang={lang} isOwn={true} />
          )}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: mode === 'business' ? '#EBF4FF' : '#F0FAF4', color: mode === 'business' ? '#1877F2' : '#2D6A4F' }}>
              {mode === 'business' ? t.modeBusinessTag : t.modeCommonTag}
            </span>
          </div>
          <div className="p-profile-stats">
            <div className="p-profile-stat">
              <strong>{profile.postCount}</strong>
              <span>{t.postsLabel}</span>
            </div>
            <div className="p-profile-stat">
              <strong>{profile.friendCount}</strong>
              <span>{mode === 'business' ? t.connectionsLabel : t.friendsLabel}</span>
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

      {/* Family section (common mode) */}
      {mode === 'common' && (
        <div className="p-card p-family-section" style={{ marginBottom: 16 }}>
          <h3 className="p-section-title" style={{ margin: '0 0 4px' }}>🏡 {t.familySection}</h3>
          <p className="p-family-section-desc">{t.familySectionDesc}</p>
          {familyGroups.length === 0 ? (
            <div className="p-family-empty">{t.familyNoGroups}</div>
          ) : (
            familyGroups.map(g => (
              <div key={g.id} className="p-family-group-row">
                <div className="p-family-group-icon">🏡</div>
                <div className="p-family-group-info">
                  <span className="p-family-group-name">{g.name || t.familyGroup}</span>
                  <span className="p-family-group-meta">{g.participants.length} {t.participants}</span>
                </div>
                <div className="p-family-group-avatars">
                  {g.participants.slice(0, 4).map(p => (
                    <div key={p.id} className="p-avatar-xs p-family-avatar" style={{ background: nameToColor(p.name) }}>{getInitials(p.name)}</div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Company pages (business mode) */}
      {mode === 'business' && (
        <div className="p-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 className="p-section-title" style={{ margin: 0 }}>🏢 {t.companies}</h3>
            <button
              style={{ fontSize: 13, color: '#2D6A4F', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => onNavigate?.('company')}
            >
              {t.myCompanies} →
            </button>
          </div>
          {MOCK_COMPANIES.filter(c => c.role === 'owner').map(c => (
            <div key={c.id} className="p-company-mini-card" onClick={() => onNavigate?.('company')}>
              <div className="p-company-logo-sm" style={{ background: c.color }}>{c.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{c.industry} · {c.followers} {t.companyFollowers}</div>
              </div>
              <span className="p-company-role-badge">{t.companyRoleOwner}</span>
            </div>
          ))}
        </div>
      )}

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
function EditProfilePage({ lang, t, currentUser, mode, onUserUpdate, onNavigate }) {
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

        {/* Business-only fields */}
        {mode === 'business' && (
          <>
            <div style={{ margin: '20px 0 12px', borderTop: '1px solid #eee', paddingTop: 16, fontSize: 13, fontWeight: 700, color: '#2D6A4F' }}>
              💼 {t.modeBusiness}
            </div>
            <label style={labelStyle}>{t.titleLabel}</label>
            <input
              style={fieldStyle}
              placeholder={lang === 'da' ? 'f.eks. Senior Designer' : 'e.g. Senior Designer'}
              value={profile.jobTitle || ''}
              onChange={e => setProfile(p => ({ ...p, jobTitle: e.target.value }))}
            />
            <label style={labelStyle}>{t.companyLabel}</label>
            <input
              style={fieldStyle}
              placeholder={lang === 'da' ? 'Virksomhedsnavn' : 'Company name'}
              value={profile.company || ''}
              onChange={e => setProfile(p => ({ ...p, company: e.target.value }))}
            />
            <label style={labelStyle}>{t.industryLabel}</label>
            <input
              style={fieldStyle}
              placeholder={lang === 'da' ? 'f.eks. Design & Teknologi' : 'e.g. Design & Technology'}
              value={profile.industry || ''}
              onChange={e => setProfile(p => ({ ...p, industry: e.target.value }))}
            />
            <label style={labelStyle}>{t.skillsLabel}</label>
            <input
              style={fieldStyle}
              placeholder={lang === 'da' ? 'f.eks. UX, Figma, React (komma-adskilt)' : 'e.g. UX, Figma, React (comma-separated)'}
              value={profile.skills || ''}
              onChange={e => setProfile(p => ({ ...p, skills: e.target.value }))}
            />
          </>
        )}

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

// ── Friend Profile Modal ──
function FriendProfileModal({ userId, lang, t, onClose, onMessage }) {
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!userId) return
    apiFetchProfile(userId).then(data => { if (data) setProfile(data) })
  }, [userId])

  if (!userId) return null

  const avatarSrc = profile?.avatarUrl
    ? (profile.avatarUrl.startsWith('http') ? profile.avatarUrl : `${API_BASE}${profile.avatarUrl}`)
    : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-friend-profile-modal" onClick={e => e.stopPropagation()}>
        <button className="p-msg-modal-close p-friend-profile-close" onClick={onClose}>✕</button>
        {!profile ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>…</div>
        ) : (
          <>
            <div className="p-friend-profile-banner" />
            <div className="p-friend-profile-body">
              <div className="p-friend-profile-avatar-wrap">
                {avatarSrc ? (
                  <img className="p-friend-profile-avatar-img" src={avatarSrc} alt="" />
                ) : (
                  <div className="p-friend-profile-avatar" style={{ background: nameToColor(profile.name) }}>
                    {profile.initials || getInitials(profile.name)}
                  </div>
                )}
              </div>
              <h2 className="p-friend-profile-name">{profile.name}</h2>
              {profile.handle && <p className="p-friend-profile-handle">@{profile.handle}</p>}
              {profile.bio?.[lang] && <p className="p-friend-profile-bio">{profile.bio[lang]}</p>}
              <div className="p-friend-profile-meta">
                {profile.location && <span>📍 {profile.location}</span>}
                {profile.joinDate && (
                  <span>📅 {lang === 'da' ? 'Medlem siden' : 'Joined'} {new Date(profile.joinDate).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long' })}</span>
                )}
              </div>
              <div className="p-friend-profile-stats">
                <div className="p-friend-profile-stat">
                  <strong>{profile.friendCount}</strong>
                  <span>{t.friendsLabel}</span>
                </div>
                {profile.mutualCount > 0 && (
                  <div className="p-friend-profile-stat">
                    <strong>{profile.mutualCount}</strong>
                    <span>{t.mutualFriends}</span>
                  </div>
                )}
                <div className="p-friend-profile-stat">
                  <strong>{profile.postCount}</strong>
                  <span>{t.postsLabel}</span>
                </div>
              </div>
              {profile.isFriend && (
                <button className="p-friend-msg-btn" style={{ marginTop: 16 }} onClick={() => { onClose(); onMessage() }}>
                  💬 {t.message}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Friends ──
function FriendsPage({ lang, t, mode, onMessage }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [searchResults, setSearchResults] = useState(null)
  const [sentIds, setSentIds] = useState({})
  const [inviteLink, setInviteLink] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [openMenuId, setOpenMenuId] = useState(null) // friend card •••
  const [unfriendTarget, setUnfriendTarget] = useState(null) // { id, name }
  const [viewProfileId, setViewProfileId] = useState(null)
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

  // Close •••menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

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
      setSentIds(prev => ({ ...prev, [userId]: 'sent' }))
      apiFetchFriendRequests().then(data => { if (data) setRequests(data) })
    }
  }, [])

  const handleAccept = useCallback(async (reqId) => {
    await apiAcceptFriendRequest(reqId)
    refreshAll()
  }, [refreshAll])

  const handleDecline = useCallback(async (reqId) => {
    await apiDeclineFriendRequest(reqId)
    setRequests(prev => ({ ...prev, incoming: prev.incoming.filter(r => r.id !== reqId) }))
  }, [])

  const handleUnfriend = useCallback(async (notify) => {
    if (!unfriendTarget) return
    await apiUnfriend(unfriendTarget.id, notify)
    setUnfriendTarget(null)
    refreshAll()
  }, [unfriendTarget, refreshAll])

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
  const outgoingTargetIds = new Set(requests.outgoing.map(r => r.to_id))

  return (
    <div className="p-friends-page">
      {viewProfileId && (
        <FriendProfileModal
          userId={viewProfileId}
          lang={lang}
          t={t}
          onClose={() => setViewProfileId(null)}
          onMessage={() => { setViewProfileId(null); onMessage() }}
        />
      )}
      {/* Unfriend confirm modal */}
      {unfriendTarget && (
        <div className="modal-backdrop" onClick={() => setUnfriendTarget(null)}>
          <div className="p-msg-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="p-msg-modal-header">
              <span>{t.unfriendConfirm}</span>
              <button className="p-msg-modal-close" onClick={() => setUnfriendTarget(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: 12, fontSize: 14, color: '#555' }}>
                <strong>{unfriendTarget.name}</strong>
              </div>
              <button
                className="p-friend-msg-btn"
                style={{ marginBottom: 8, textAlign: 'left' }}
                onClick={() => handleUnfriend(false)}
              >
                🔇 {t.unfriendSilent}
              </button>
              <button
                className="p-friend-msg-btn p-friend-add-btn"
                style={{ textAlign: 'left' }}
                onClick={() => handleUnfriend(true)}
              >
                ✉ {t.unfriendNotify}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <button className="p-freq-accept-btn" onClick={() => handleAccept(req.id)}>{t.acceptRequest}</button>
                  <button className="p-freq-decline-btn" onClick={() => handleDecline(req.id)}>{t.declineRequest}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-card">
        <h3 className="p-section-title" style={{ margin: '0 0 16px' }}>
          {isSearching ? t.findPeople : (mode === 'business' ? t.connectionsTitle : t.friendsTitle)}
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
              {mode === 'business' ? t.allConnections : t.allFriends} ({friends.length})
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
                  {isFriend && <div className="p-friend-card-mutual">✓ {mode === 'business' ? t.allConnections : t.allFriends}</div>}
                </div>
                {isFriend ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="p-friend-msg-btn" style={{ flex: 1 }} onClick={onMessage}>💬 {t.message}</button>
                    <div className="p-friend-menu-wrap" style={{ position: 'relative' }}>
                      <button className="p-friend-menu-btn" onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === user.id ? null : user.id) }}>•••</button>
                      {openMenuId === user.id && (
                        <div className="p-friend-menu" onClick={e => e.stopPropagation()}>
                          <button className="p-friend-menu-item" onClick={() => { setOpenMenuId(null); setViewProfileId(user.id) }}>
                            👤 {lang === 'da' ? 'Vis profil' : 'View profile'}
                          </button>
                          <button className="p-friend-menu-item p-friend-menu-danger" onClick={() => { setOpenMenuId(null); setUnfriendTarget({ id: user.id, name: user.name }) }}>
                            {t.unfriend}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : incomingReq ? (
                  <div className="p-freq-inline-actions">
                    <span className="p-freq-label">{t.requestReceived}</span>
                    <button className="p-freq-accept-btn" onClick={() => handleAccept(incomingReq.id)}>{t.acceptRequest}</button>
                    <button className="p-freq-decline-btn" onClick={() => handleDecline(incomingReq.id)}>{t.declineRequest}</button>
                  </div>
                ) : hasSentRequest ? (
                  <button className="p-friend-msg-btn p-friend-sent-btn" disabled>✉ {t.requestSent}</button>
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
          {filtered.map((friend) => (
            <div key={friend.id} className="p-card p-friend-card">
              <div className="p-friend-card-top">
                <div className="p-avatar-md" style={{ background: nameToColor(friend.name) }}>
                  {getInitials(friend.name)}
                  {friend.online && <div className="online-dot" />}
                </div>
                <div className="p-friend-card-name">{friend.name}</div>
                <div className="p-friend-card-mutual">{friend.mutual} {t.mutualFriends}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="p-friend-msg-btn" style={{ flex: 1 }} onClick={onMessage}>
                  💬 {t.message}
                </button>
                <div className="p-friend-menu-wrap" style={{ position: 'relative' }}>
                  <button className="p-friend-menu-btn" onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === friend.id ? null : friend.id) }}>•••</button>
                  {openMenuId === friend.id && (
                    <div className="p-friend-menu" onClick={e => e.stopPropagation()}>
                      <button className="p-friend-menu-item" onClick={() => { setOpenMenuId(null); setViewProfileId(friend.id) }}>
                        👤 {lang === 'da' ? 'Vis profil' : 'View profile'}
                      </button>
                      <button className="p-friend-menu-item" onClick={() => { setOpenMenuId(null); onMessage() }}>
                        💬 {t.message}
                      </button>
                      <button className="p-friend-menu-item p-friend-menu-danger" onClick={() => { setOpenMenuId(null); setUnfriendTarget({ id: friend.id, name: friend.name }) }}>
                        {t.unfriend}
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
function NewConvModal({ t, lang, mode, friends, existingParticipantIds = [], isGroupMode, onClose, onCreate }) {
  const [selected, setSelected] = useState([])
  const [groupName, setGroupName] = useState('')
  const [search, setSearch] = useState('')
  const [isFamilyGroup, setIsFamilyGroup] = useState(false)

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
        {isGroupMode && mode === 'common' && (
          <label className={`p-family-group-toggle${isFamilyGroup ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={isFamilyGroup}
              onChange={e => setIsFamilyGroup(e.target.checked)}
              style={{ display: 'none' }}
            />
            <span className="p-family-toggle-icon">🏡</span>
            <div className="p-family-toggle-text">
              <span className="p-family-toggle-label">{t.familyGroupToggle}</span>
              <span className="p-family-toggle-info">{t.familyGroupInfo}</span>
            </div>
            <span className={`p-family-toggle-check${isFamilyGroup ? ' on' : ''}`}>{isFamilyGroup ? '✓' : ''}</span>
          </label>
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
            onClick={() => onCreate(selected, isGroupMode ? (groupName || null) : null, isGroupMode, isGroupMode ? isFamilyGroup : false)}
          >
            {isGroupMode ? (isFamilyGroup ? `🏡 ${t.createGroup}` : t.createGroup) : t.startConv}
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
function SearchPage({ lang, t, mode, onNavigateToPost, onNavigateToConv, onNavigateToCompany }) {
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
  const companyMatches = q.length >= 2
    ? MOCK_COMPANIES.filter(c =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.industry.toLowerCase().includes(q.toLowerCase()) ||
        c.tagline.toLowerCase().includes(q.toLowerCase())
      )
    : []
  const hasCompanies = companyMatches.length > 0
  const empty = results && !hasPosts && !hasMessages && !hasCompanies

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

      {/* Company results (always shown if match, no API needed) */}
      {hasCompanies && (
        <div className="p-search-results" style={{ marginBottom: 8 }}>
          <section className="p-search-section">
            <h3 className="p-search-section-title">
              <span>🏢</span> {t.companies}
              <span className="p-search-count">{companyMatches.length}</span>
            </h3>
            {companyMatches.map(c => (
              <div key={c.id} className="p-search-result" onClick={onNavigateToCompany}>
                <div className="p-search-result-top">
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{c.name[0]}</div>
                  <span className="p-search-result-author">{c.name}</span>
                  <span className="p-search-result-time">{c.industry}</span>
                  <span className="p-search-result-arrow">→</span>
                </div>
                <div className="p-search-result-text" style={{ paddingLeft: 36, color: '#888' }}>
                  {c.tagline} · {c.followers} {t.companyFollowers}
                </div>
              </div>
            ))}
          </section>
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

function MessagesPage({ lang, t, currentUser, mode, openConvId, onConvOpened }) {
  const [activeConv, setActiveConv] = useState(0)
  const [conversations, setConversations] = useState([])
  const [friends, setFriends] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | 'newGroup' | 'invite' | 'mute' | 'rename'
  const [showConvMenu, setShowConvMenu] = useState(false)
  const [deleteConvId, setDeleteConvId] = useState(null) // id to confirm delete
  const messagesEndRef = useRef(null)
  const msgInputRef = useRef(null)
  const msgBodyRef = useRef(null)
  const msgMention = useMention(friends)
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

  useEffect(() => {
    if (!newMsg && msgInputRef.current) {
      msgInputRef.current.style.height = 'auto'
    }
  }, [newMsg])

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
  const handleCreate = async (selectedIds, groupName, isGroup, isFamilyGroup = false) => {
    setModal(null)
    const data = await apiCreateConversation(selectedIds, groupName, isGroup, isFamilyGroup)
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
          <span className="p-msg-sidebar-title-icon" title={t.messagesTitle}>💬</span>
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
            <div key={c.id} id={`conv-${c.id}`} className="p-msg-thread-wrap">
              {deleteConvId === c.id && (
                <div className="p-msg-delete-confirm" onClick={e => e.stopPropagation()}>
                  <span>{lang === 'da' ? `Slet "${c.name}"?` : `Delete "${c.name}"?`}</span>
                  <button className="p-msg-delete-yes" onClick={async () => {
                    await apiLeaveConversation(deleteConvId)
                    setConversations(prev => prev.filter(x => x.id !== deleteConvId))
                    setDeleteConvId(null)
                    setActiveConv(0)
                  }}>
                    {lang === 'da' ? 'Slet' : 'Delete'}
                  </button>
                  <button className="p-msg-delete-no" onClick={() => setDeleteConvId(null)}>
                    {lang === 'da' ? 'Annuller' : 'Cancel'}
                  </button>
                </div>
              )}
            <div
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
                    {c.isFamilyGroup && <span className="p-msg-family-badge" title={t.familyGroup}>🏡</span>}
                    {cIsMuted && <span className="p-msg-muted-icon" title={t.mutedLabel}>🔕</span>}
                    {c.unread > 0 && <span className="p-msg-badge">{c.unread}</span>}
                  </span>
                </div>
                <div className="p-msg-thread-preview">
                  {lastMsg ? `${c.isGroup ? lastMsg.from.split(' ')[0] + ': ' : ''}${lastMsg.text[lang]}`.slice(0, 42) : ''}
                </div>
              </div>
              <button
                className="p-msg-thread-delete"
                title={lang === 'da' ? 'Slet chat' : 'Delete chat'}
                onClick={e => { e.stopPropagation(); setDeleteConvId(c.id) }}
              >🗑</button>
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
                {conv.isFamilyGroup && <span className="p-msg-family-badge p-msg-family-badge-header" title={t.familyGroup}>🏡</span>}
                {isMuted && <span className="p-msg-muted-icon" title={t.mutedLabel} style={{ marginLeft: 6 }}>🔕</span>}
              </span>
              {conv.isGroup && (
                <span className="p-msg-header-sub">
                  {conv.isFamilyGroup ? `${t.familyGroup} · ` : ''}{conv.participants.length} {t.participants}
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
                    <div>{linkifyText(msg.text[lang] || '').map((p, pi) =>
                      p.t === 'url'
                        ? <a key={pi} href={p.v} target="_blank" rel="noopener noreferrer" className="post-link">{p.v}</a>
                        : p.t === 'mention'
                          ? <span key={pi} className="p-mention">{p.v}</span>
                          : <span key={pi}>{p.v}</span>
                    )}</div>
                    <div className="p-msg-time">{msg.time}</div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-msg-input-row">
            <span className="p-input-hint-wrap">
              <span className="p-input-hint-icon">?</span>
              <span className="p-input-hint-tooltip">{t.msgInputHint}</span>
            </span>
            <div style={{ position: 'relative', flex: 1 }}>
              {msgMention.query !== null && (
                <MentionDropdown
                  filtered={msgMention.filtered}
                  selIdx={msgMention.selIdx}
                  onSelect={f => {
                    const cursor = msgInputRef.current?.selectionStart ?? newMsg.length
                    const { text, cursor: nc } = msgMention.buildText(newMsg, cursor, f)
                    setNewMsg(text)
                    setTimeout(() => {
                      if (msgInputRef.current) {
                        msgInputRef.current.focus()
                        msgInputRef.current.setSelectionRange(nc, nc)
                      }
                    }, 0)
                  }}
                />
              )}
              <textarea
                ref={msgInputRef}
                className="p-msg-input"
                placeholder={t.typeMessage}
                value={newMsg}
                rows={1}
                onChange={e => {
                  setNewMsg(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                  msgMention.detect(e.target.value, e.target.selectionStart)
                }}
                onKeyDown={e => {
                  if (msgMention.handleKey(e, f => {
                    const cursor = msgInputRef.current?.selectionStart ?? newMsg.length
                    const { text, cursor: nc } = msgMention.buildText(newMsg, cursor, f)
                    setNewMsg(text)
                    setTimeout(() => {
                      if (msgInputRef.current) {
                        msgInputRef.current.focus()
                        msgInputRef.current.setSelectionRange(nc, nc)
                      }
                    }, 0)
                  })) return
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
                onBlur={() => setTimeout(() => msgMention.close(), 150)}
              />
            </div>
            <button className="p-send-btn" onClick={handleSend}>{t.send}</button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {(modal === 'new' || modal === 'newGroup') && (
        <NewConvModal
          t={t}
          lang={lang}
          mode={mode}
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

// ── Events ──
const MOCK_EVENTS = [
  {
    id: 1,
    title: { da: 'Designere i KBH — Sommermøde', en: 'Designers in CPH — Summer Meetup' },
    date: '2026-03-15T18:00:00',
    location: 'Café Nørreport, København',
    description: { da: 'Månedligt netværksmøde for designere i Storkøbenhavn. Alle er velkomne — uanset erfaring!', en: 'Monthly networking meetup for designers in Greater Copenhagen. Everyone welcome — regardless of experience!' },
    organizer: 'Sofie Nielsen',
    cover: null,
    going: ['Magnus Jensen', 'Clara Johansen', 'Emil Larsen', 'Alma Hansen'],
    maybe: ['Astrid Poulsen', 'Liam Madsen'],
    eventType: null,
    ticketUrl: '',
    cap: null,
  },
  {
    id: 2,
    title: { da: 'UX & AI — Fremtidens brugeroplevelse', en: 'UX & AI — The Future of User Experience' },
    date: '2026-04-02T09:00:00',
    location: 'Copenhagen Business School, Frederiksberg',
    description: { da: 'Konference om, hvordan kunstig intelligens ændrer UX-designet. Oplæg fra brancheledere og workshops.', en: 'Conference on how artificial intelligence is changing UX design. Keynotes from industry leaders and workshops.' },
    organizer: 'Freja Andersen',
    cover: null,
    going: ['Sofie Nielsen', 'Viktor Mortensen', 'Noah Rasmussen'],
    maybe: ['Ida Pedersen'],
    eventType: 'conference',
    ticketUrl: 'https://example.com/tickets',
    cap: 200,
  },
  {
    id: 3,
    title: { da: 'Kvartalsvis brunch i Vesterbro', en: 'Quarterly brunch in Vesterbro' },
    date: '2026-03-22T10:30:00',
    location: 'Værnedamsvej 7, København V',
    description: { da: 'Hyggeligt brunchmøde for nærområdets beboere. Medbring noget at spise og dele!', en: 'Cosy brunch gathering for local residents. Bring something to eat and share!' },
    organizer: 'Alma Hansen',
    cover: null,
    going: ['Oscar Christensen', 'Clara Johansen', 'Magnus Jensen', 'Sofie Nielsen', 'Ida Pedersen'],
    maybe: [],
    eventType: null,
    ticketUrl: '',
    cap: null,
  },
  {
    id: 4,
    title: { da: 'Webinar: Bygning af skalerbare React-apps', en: 'Webinar: Building Scalable React Apps' },
    date: '2026-04-10T14:00:00',
    location: { da: 'Online (Zoom)', en: 'Online (Zoom)' },
    description: { da: 'Gratis webinar for frontend-udviklere om best practices for store React-projekter.', en: 'Free webinar for frontend developers on best practices for large React projects.' },
    organizer: 'Emil Larsen',
    cover: null,
    going: ['Sofie Nielsen', 'Liam Madsen', 'Astrid Poulsen'],
    maybe: ['Viktor Mortensen', 'Noah Rasmussen', 'Magnus Jensen'],
    eventType: 'webinar',
    ticketUrl: 'https://example.com/register',
    cap: 500,
  },
]

function EventsPage({ lang, t, currentUser, mode }) {
  const [tab, setTab] = useState('my')
  const [events, setEvents] = useState(MOCK_EVENTS)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [rsvpMap, setRsvpMap] = useState({ 1: 'going', 3: 'going' })
  const [rsvpExtras, setRsvpExtras] = useState({}) // { [eventId]: { dietary, plusOne } }

  const handleRsvp = (eventId, status) => {
    setRsvpMap(prev => ({ ...prev, [eventId]: prev[eventId] === status ? null : status }))
  }

  const getEventTitle = (e) => typeof e.title === 'string' ? e.title : (e.title[lang] || e.title.da)
  const getEventDesc = (e) => typeof e.description === 'string' ? e.description : (e.description[lang] || e.description.da)
  const getEventLocation = (e) => typeof e.location === 'string' ? e.location : (e.location[lang] || e.location.da)

  const myEvents = events.filter(e => rsvpMap[e.id] || e.organizer === currentUser.name)
  const discoverEvents = events.filter(e => !rsvpMap[e.id] && e.organizer !== currentUser.name)
  const displayEvents = tab === 'my' ? myEvents : discoverEvents

  const formatDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const eventTypeLabel = (type) => {
    const map = { conference: t.eventTypeConference, webinar: t.eventTypeWebinar, workshop: t.eventTypeWorkshop, meetup: t.eventTypeMeetup }
    return map[type] || null
  }

  return (
    <div className="p-events">
      {/* Header */}
      <div className="p-events-header">
        <h2 className="p-section-title" style={{ margin: 0 }}>{t.eventsTitle}</h2>
        <button className="p-events-create-btn" onClick={() => setShowCreate(true)}>
          + {t.createEvent}
        </button>
      </div>

      {/* Tabs */}
      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`p-filter-tab${tab === 'my' ? ' active' : ''}`} onClick={() => setTab('my')}>
          {t.myEvents} ({myEvents.length})
        </button>
        <button className={`p-filter-tab${tab === 'discover' ? ' active' : ''}`} onClick={() => setTab('discover')}>
          {t.discoverEvents} ({discoverEvents.length})
        </button>
      </div>

      {/* Event list */}
      {displayEvents.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          📅 {t.eventNoUpcoming}
        </div>
      ) : (
        <div className="p-events-list">
          {displayEvents.map(ev => {
            const myRsvp = rsvpMap[ev.id]
            const typeLabel = ev.eventType ? eventTypeLabel(ev.eventType) : null
            return (
              <div key={ev.id} className="p-card p-event-card" onClick={() => setSelectedEvent(ev)}>
                <div className="p-event-card-body">
                  <div className="p-event-date-col">
                    <div className="p-event-month">{new Date(ev.date).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { month: 'short' }).toUpperCase()}</div>
                    <div className="p-event-day">{new Date(ev.date).getDate()}</div>
                  </div>
                  <div className="p-event-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h3 className="p-event-title">{getEventTitle(ev)}</h3>
                      {typeLabel && <span className="p-event-type-badge">{typeLabel}</span>}
                    </div>
                    <div className="p-event-meta">
                      <span>📍 {getEventLocation(ev)}</span>
                      <span>🕐 {formatDate(ev.date)}</span>
                    </div>
                    <div className="p-event-meta" style={{ color: '#888' }}>
                      <span>✅ {ev.going.length} {t.eventAttendees}</span>
                      {ev.maybe.length > 0 && <span>❓ {ev.maybe.length} {t.eventMaybes}</span>}
                      {ev.cap && <span>🔢 max {ev.cap}</span>}
                    </div>
                  </div>
                  <div className="p-event-rsvp-col" onClick={e => e.stopPropagation()}>
                    {['going', 'maybe', 'notGoing'].map(s => (
                      <button
                        key={s}
                        className={`p-event-rsvp-btn${myRsvp === s ? ' active' : ''}`}
                        onClick={() => handleRsvp(ev.id, s)}
                        title={t[`event${s.charAt(0).toUpperCase() + s.slice(1)}`]}
                      >
                        {s === 'going' ? '✅' : s === 'maybe' ? '❓' : '❌'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          t={t}
          lang={lang}
          mode={mode}
          myRsvp={rsvpMap[selectedEvent.id]}
          extras={rsvpExtras[selectedEvent.id] || {}}
          onRsvp={(s) => handleRsvp(selectedEvent.id, s)}
          onExtrasChange={(ex) => setRsvpExtras(prev => ({ ...prev, [selectedEvent.id]: ex }))}
          onClose={() => setSelectedEvent(null)}
          getTitle={getEventTitle}
          getDesc={getEventDesc}
          getLocation={getEventLocation}
          formatDate={formatDate}
          eventTypeLabel={eventTypeLabel}
        />
      )}

      {/* Create event modal */}
      {showCreate && (
        <CreateEventModal
          t={t}
          lang={lang}
          mode={mode}
          currentUser={currentUser}
          onClose={() => setShowCreate(false)}
          onCreate={(ev) => { setEvents(prev => [ev, ...prev]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function EventDetailModal({ event, t, lang, mode, myRsvp, extras, onRsvp, onExtrasChange, onClose, getTitle, getDesc, getLocation, formatDate, eventTypeLabel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const typeLabel = event.eventType ? eventTypeLabel(event.eventType) : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-event-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="lightbox-close" style={{ position: 'absolute', top: 12, right: 16 }} onClick={onClose}>✕</button>

        {typeLabel && <div className="p-event-type-badge" style={{ marginBottom: 8 }}>{typeLabel}</div>}
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>{getTitle(event)}</h2>

        <div className="p-event-meta" style={{ marginBottom: 12 }}>
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {getLocation(event)}</span>
          <span>👤 {t.eventOrganizer}: <strong>{event.organizer}</strong></span>
          {event.cap && <span>🔢 max {event.cap} {t.eventAttendees}</span>}
          {event.ticketUrl && <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>🎟 {t.eventTicketUrl}</a>}
        </div>

        <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6, marginBottom: 20 }}>{getDesc(event)}</p>

        {/* RSVP */}
        <div className="p-event-detail-rsvp">
          {['going', 'maybe', 'notGoing'].map(s => {
            const label = t[`event${s.charAt(0).toUpperCase() + s.slice(1)}`]
            const icon = s === 'going' ? '✅' : s === 'maybe' ? '❓' : '❌'
            return (
              <button
                key={s}
                className={`p-event-rsvp-full-btn${myRsvp === s ? ' active' : ''}`}
                onClick={() => onRsvp(s)}
              >
                {icon} {label}
              </button>
            )
          })}
        </div>

        {/* Common-mode extras */}
        {myRsvp && myRsvp !== 'notGoing' && mode === 'common' && (
          <div style={{ marginTop: 16, padding: 16, background: '#F9F9F9', borderRadius: 10 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t.eventDietary}</label>
            <input
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }}
              placeholder={lang === 'da' ? 'f.eks. vegetar, nøddeallergi...' : 'e.g. vegetarian, nut allergy...'}
              value={extras.dietary || ''}
              onChange={e => onExtrasChange({ ...extras, dietary: e.target.value })}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!extras.plusOne} onChange={e => onExtrasChange({ ...extras, plusOne: e.target.checked })} />
              {t.eventPlusOne}
            </label>
          </div>
        )}

        {/* Attendees */}
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>✅ {t.eventGoing} ({event.going.length})</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {event.going.map(name => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#F0FAF4', borderRadius: 20, fontSize: 13 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: nameToColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700 }}>
                  {getInitials(name)}
                </div>
                {name}
              </div>
            ))}
          </div>
          {event.maybe.length > 0 && (
            <>
              <h4 style={{ margin: '14px 0 10px', fontSize: 14, fontWeight: 700 }}>❓ {t.eventMaybe} ({event.maybe.length})</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {event.maybe.map(name => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#FFF8E7', borderRadius: 20, fontSize: 13 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: nameToColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700 }}>
                      {getInitials(name)}
                    </div>
                    {name}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateEventModal({ t, lang, mode, currentUser, onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [eventType, setEventType] = useState('')
  const [ticketUrl, setTicketUrl] = useState('')
  const [cap, setCap] = useState('')

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fieldStyle = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 14 }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim() || !date || !location.trim()) return
    const newEvent = {
      id: Date.now(),
      title: { da: title, en: title },
      date,
      location,
      description: { da: description, en: description },
      organizer: currentUser.name,
      cover: null,
      going: [currentUser.name],
      maybe: [],
      eventType: eventType || null,
      ticketUrl,
      cap: cap ? parseInt(cap) : null,
    }
    onCreate(newEvent)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-event-create-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{t.createEvent}</h3>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t.eventTitle} *</label>
          <input style={fieldStyle} value={title} onChange={e => setTitle(e.target.value)} required
            placeholder={lang === 'da' ? 'Begivenhedens navn' : 'Event name'} />

          <label style={labelStyle}>{t.eventDate} *</label>
          <input style={fieldStyle} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required />

          <label style={labelStyle}>{t.eventLocation} *</label>
          <input style={fieldStyle} value={location} onChange={e => setLocation(e.target.value)} required
            placeholder={lang === 'da' ? 'Adresse eller "Online"' : 'Address or "Online"'} />

          <label style={labelStyle}>{t.eventDescription}</label>
          <textarea style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)}
            placeholder={lang === 'da' ? 'Beskriv begivenheden...' : 'Describe the event...'} />

          {/* Business-only fields */}
          {mode === 'business' && (
            <>
              <label style={labelStyle}>{t.eventType}</label>
              <select style={fieldStyle} value={eventType} onChange={e => setEventType(e.target.value)}>
                <option value="">—</option>
                <option value="conference">{t.eventTypeConference}</option>
                <option value="webinar">{t.eventTypeWebinar}</option>
                <option value="workshop">{t.eventTypeWorkshop}</option>
                <option value="meetup">{t.eventTypeMeetup}</option>
              </select>

              <label style={labelStyle}>{t.eventTicketUrl}</label>
              <input style={fieldStyle} type="url" value={ticketUrl} onChange={e => setTicketUrl(e.target.value)}
                placeholder="https://..." />

              <label style={labelStyle}>{t.eventCap}</label>
              <input style={fieldStyle} type="number" min="1" value={cap} onChange={e => setCap(e.target.value)}
                placeholder={t.eventCapPlaceholder} />
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
              {t.eventCancel}
            </button>
            <button type="submit"
              style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              {t.eventCreate}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Skills & Endorsements ──
const MOCK_SKILL_ENDORSEMENTS = {
  'UX Design': ['Magnus Jensen', 'Freja Andersen', 'Emil Larsen'],
  'Figma': ['Clara Johansen', 'Astrid Poulsen'],
  'React': ['Viktor Mortensen', 'Noah Rasmussen', 'Magnus Jensen', 'Emil Larsen'],
}

function SkillsSection({ profile, t, lang, isOwn }) {
  const [skills, setSkills] = useState(() => {
    const raw = profile.skills || 'UX Design, Figma, React'
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  })
  const [endorsements, setEndorsements] = useState(MOCK_SKILL_ENDORSEMENTS)
  const [myEndorsed, setMyEndorsed] = useState(new Set())
  const [newSkill, setNewSkill] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const endorse = (skill) => {
    if (myEndorsed.has(skill)) return
    setMyEndorsed(prev => new Set([...prev, skill]))
    setEndorsements(prev => ({
      ...prev,
      [skill]: [...(prev[skill] || []), lang === 'da' ? 'Dig' : 'You'],
    }))
  }

  const addSkill = () => {
    const s = newSkill.trim()
    if (!s || skills.includes(s) || skills.length >= 20) return
    setSkills(prev => [...prev, s])
    setNewSkill('')
    setShowAdd(false)
  }

  if (skills.length === 0 && !isOwn) return null

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 8 }}>{t.skills}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {skills.map(skill => {
          const count = (endorsements[skill] || []).length
          const myEndorsement = myEndorsed.has(skill)
          return (
            <div key={skill} className="p-skill-row">
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{skill}</span>
                {count > 0 && (
                  <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
                    {count} {t.endorsements}
                  </span>
                )}
              </div>
              {!isOwn && (
                <button
                  className={`p-endorse-btn${myEndorsement ? ' endorsed' : ''}`}
                  onClick={() => endorse(skill)}
                  disabled={myEndorsement}
                >
                  {myEndorsement ? `✓ ${t.endorsed}` : t.endorse}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {isOwn && (
        showAdd ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13 }}
              placeholder={t.skillPlaceholder}
              value={newSkill}
              onChange={e => setNewSkill(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill() } if (e.key === 'Escape') setShowAdd(false) }}
              autoFocus
            />
            <button onClick={addSkill} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        ) : (
          <button
            style={{ marginTop: 10, fontSize: 13, color: '#2D6A4F', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => { if (skills.length >= 20) return; setShowAdd(true) }}
          >
            {skills.length >= 20 ? t.maxSkillsReached : `+ ${t.addSkill}`}
          </button>
        )
      )}
    </div>
  )
}

// ── Company Pages ──
const MOCK_COMPANIES = [
  {
    id: 1,
    name: 'Designlab Studio',
    tagline: 'Vi skaber digitale oplevelser der rykker',
    website: 'https://designlab.dk',
    industry: 'Design & Teknologi',
    size: '11–50',
    description: 'Designlab Studio er et dansk designbureau specialiseret i brugeroplevelse og digital produktudvikling. Vi arbejder med startups og etablerede virksomheder.',
    followers: 847,
    role: 'owner',
    color: '#2D6A4F',
    posts: [
      { id: 'cp1', text: { da: 'Vi søger en dygtig UX Designer til vores team i København. 🚀', en: 'We\'re looking for a talented UX Designer to join our Copenhagen team. 🚀' }, time: { da: '1 t siden', en: '1 hr ago' }, likes: 14, comments: 3 },
      { id: 'cp2', text: { da: 'Spændende samarbejde annonceret med Yggdrasil Cloud! Vi glæder os til at bygge fremtiden af dansk tech. 🇩🇰', en: 'Exciting partnership announced with Yggdrasil Cloud! Looking forward to building the future of Danish tech. 🇩🇰' }, time: { da: '2 d siden', en: '2 days ago' }, likes: 62, comments: 11 },
    ],
    jobs: [1],
  },
  {
    id: 2,
    name: 'NordTech A/S',
    tagline: 'Scandinavian software for global markets',
    website: 'https://nordtech.dk',
    industry: 'Software & SaaS',
    size: '51–200',
    description: 'NordTech bygger skalerbare softwareløsninger til mellemstore virksomheder i Norden og Europa. Grundlagt i 2018.',
    followers: 2341,
    role: 'following',
    color: '#1877F2',
    posts: [
      { id: 'cp3', text: { da: 'Vores Q1 rapport er ude — rekordvækst på 43% YoY! Tak til alle vores fantastiske kunder og medarbejdere. 📈', en: 'Our Q1 report is out — record growth of 43% YoY! Thanks to all our amazing customers and employees. 📈' }, time: { da: '3 d siden', en: '3 days ago' }, likes: 198, comments: 27 },
    ],
    jobs: [2],
  },
]

const MOCK_JOBS = [
  {
    id: 1,
    companyId: 1,
    companyName: 'Designlab Studio',
    companyColor: '#2D6A4F',
    title: { da: 'Senior UX Designer', en: 'Senior UX Designer' },
    location: 'København, Danmark',
    remote: true,
    type: 'fulltime',
    description: { da: 'Vi søger en erfaren UX Designer til at lede brugeroplevelsesdesign på tværs af vores produkter. Du vil arbejde tæt med produktteamet og kunder.', en: 'We\'re looking for an experienced UX Designer to lead user experience design across our products. You\'ll work closely with the product team and clients.' },
    requirements: { da: '5+ års erfaring med UX design\nSolid portefølje med case studies\nErfaring med Figma og prototyping\nFlydende dansk og engelsk', en: '5+ years of UX design experience\nSolid portfolio with case studies\nExperience with Figma and prototyping\nFluent Danish and English' },
    applyLink: 'jobs@designlab.dk',
    postedDate: '2026-02-10',
    saved: false,
  },
  {
    id: 2,
    companyId: 2,
    companyName: 'NordTech A/S',
    companyColor: '#1877F2',
    title: { da: 'Frontend Udviklere (React)', en: 'Frontend Developer (React)' },
    location: 'Aarhus, Danmark',
    remote: false,
    type: 'fulltime',
    description: { da: 'NordTech søger dygtige React-udviklere til vores voksende produktteam i Aarhus. Du vil arbejde på vores kerneplatform med moderne teknologier.', en: 'NordTech is looking for skilled React developers for our growing product team in Aarhus. You\'ll work on our core platform with modern technologies.' },
    requirements: { da: '3+ års React-erfaring\nKendskab til TypeScript\nErfaring med REST APIs og GraphQL\nGodt kendskab til git og CI/CD', en: '3+ years React experience\nKnowledge of TypeScript\nExperience with REST APIs and GraphQL\nGood knowledge of git and CI/CD' },
    applyLink: 'https://nordtech.dk/jobs',
    postedDate: '2026-02-15',
    saved: false,
  },
]

function CompanyListPage({ lang, t, currentUser, mode, onNavigate }) {
  const [companies, setCompanies] = useState(MOCK_COMPANIES)
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tab, setTab] = useState('my')
  const [followMap, setFollowMap] = useState(() => {
    const m = {}
    MOCK_COMPANIES.forEach(c => { m[c.id] = c.role === 'following' || c.role === 'owner' })
    return m
  })

  const myCompanies = companies.filter(c => c.role === 'owner' || c.role === 'admin' || c.role === 'editor')
  const followingCompanies = companies.filter(c => c.role === 'following')

  const displayCompanies = tab === 'my' ? myCompanies : followingCompanies

  const toggleFollow = (id) => {
    setFollowMap(prev => ({ ...prev, [id]: !prev[id] }))
    setCompanies(prev => prev.map(c => c.id === id ? {
      ...c,
      role: followMap[id] ? null : 'following',
      followers: followMap[id] ? c.followers - 1 : c.followers + 1,
    } : c))
  }

  if (selectedCompany) {
    return (
      <CompanyDetailView
        company={selectedCompany}
        t={t}
        lang={lang}
        mode={mode}
        currentUser={currentUser}
        isOwner={selectedCompany.role === 'owner'}
        onBack={() => setSelectedCompany(null)}
        onFollow={() => toggleFollow(selectedCompany.id)}
        isFollowing={followMap[selectedCompany.id]}
      />
    )
  }

  return (
    <div className="p-events" style={{ maxWidth: 720 }}>
      <div className="p-events-header">
        <h2 className="p-section-title" style={{ margin: 0 }}>🏢 {t.companies}</h2>
        <button className="p-events-create-btn" onClick={() => setShowCreate(true)}>
          + {t.createCompany}
        </button>
      </div>

      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`p-filter-tab${tab === 'my' ? ' active' : ''}`} onClick={() => setTab('my')}>
          {t.myCompanies} ({myCompanies.length})
        </button>
        <button className={`p-filter-tab${tab === 'following' ? ' active' : ''}`} onClick={() => setTab('following')}>
          {t.followingCompanies} ({followingCompanies.length})
        </button>
      </div>

      {displayCompanies.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          🏢 {tab === 'my'
            ? (lang === 'da' ? 'Du administrerer ingen sider endnu.' : 'You don\'t manage any pages yet.')
            : (lang === 'da' ? 'Du følger ingen sider endnu.' : 'You don\'t follow any pages yet.')
          }
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayCompanies.map(company => (
            <div key={company.id} className="p-card p-company-card" onClick={() => setSelectedCompany(company)}>
              <div className="p-company-logo" style={{ background: company.color }}>{company.name[0]}</div>
              <div className="p-company-card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 className="p-company-name">{company.name}</h3>
                  {company.role === 'owner' && <span className="p-company-role-badge">{t.companyRoleOwner}</span>}
                  {company.role === 'admin' && <span className="p-company-role-badge">{t.companyRoleAdmin}</span>}
                  {company.role === 'editor' && <span className="p-company-role-badge" style={{ background: '#FFF3CD', color: '#856404' }}>{t.companyRoleEditor}</span>}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{company.tagline}</div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  🏭 {company.industry} · 👥 {company.size} · {company.followers.toLocaleString()} {t.companyFollowers}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCompanyModal
          t={t}
          lang={lang}
          currentUser={currentUser}
          onClose={() => setShowCreate(false)}
          onCreate={(c) => { setCompanies(prev => [c, ...prev]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function CompanyDetailView({ company, t, lang, mode, currentUser, isOwner, onBack, onFollow, isFollowing }) {
  const [tab, setTab] = useState('posts')
  const [newPost, setNewPost] = useState('')
  const [companyPosts, setCompanyPosts] = useState(company.posts || [])

  const postCompany = () => {
    if (!newPost.trim()) return
    setCompanyPosts(prev => [{
      id: `cp${Date.now()}`,
      text: { da: newPost, en: newPost },
      time: { da: 'Lige nu', en: 'Just now' },
      likes: 0,
      comments: 0,
    }, ...prev])
    setNewPost('')
  }

  const companyJobs = MOCK_JOBS.filter(j => j.companyId === company.id)

  return (
    <div className="p-events" style={{ maxWidth: 720 }}>
      <button onClick={onBack} style={{ marginBottom: 16, background: 'none', border: 'none', color: '#2D6A4F', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
        ← {lang === 'da' ? 'Tilbage' : 'Back'}
      </button>

      {/* Company header */}
      <div className="p-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="p-company-logo" style={{ background: company.color, width: 72, height: 72, fontSize: 30, borderRadius: 16 }}>{company.name[0]}</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>{company.name}</h2>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{company.tagline}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, color: '#888', marginBottom: 12 }}>
              <span>🏭 {company.industry}</span>
              <span>👥 {company.size} {lang === 'da' ? 'medarbejdere' : 'employees'}</span>
              <span>🌐 <a href={company.website} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>{company.website.replace('https://', '')}</a></span>
              <span>❤️ {company.followers.toLocaleString()} {t.companyFollowers}</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {!isOwner && (
                <button
                  onClick={onFollow}
                  className={isFollowing ? 'p-friend-msg-btn' : 'p-friend-add-btn p-friend-msg-btn'}
                  style={{ padding: '8px 20px', borderRadius: 8 }}
                >
                  {isFollowing ? `✓ ${t.companyUnfollow}` : t.companyFollow}
                </button>
              )}
              {isOwner && (
                <span className="p-company-role-badge" style={{ alignSelf: 'center', padding: '6px 14px', fontSize: 13 }}>
                  {t.companyRoleOwner}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        {['posts', 'about', 'jobs'].map(tp => (
          <button key={tp} className={`p-filter-tab${tab === tp ? ' active' : ''}`} onClick={() => setTab(tp)}>
            {tp === 'posts' ? t.companyPosts : tp === 'about' ? t.companyAbout : t.jobs}
            {tp === 'jobs' && companyJobs.length > 0 && <span style={{ marginLeft: 4, fontSize: 11 }}>({companyJobs.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'posts' && (
        <>
          {(isOwner || company.role === 'admin' || company.role === 'editor') && (
            <div className="p-card" style={{ marginBottom: 12 }}>
              <textarea
                className="p-post-textarea"
                placeholder={t.companyPost}
                value={newPost}
                onChange={e => setNewPost(e.target.value)}
                style={{ minHeight: 80, marginBottom: 10 }}
              />
              <button
                className="p-post-submit-btn"
                disabled={!newPost.trim()}
                onClick={postCompany}
                style={{ padding: '8px 20px' }}
              >
                {t.companyPosts}
              </button>
            </div>
          )}
          {companyPosts.map(post => (
            <div key={post.id} className="p-card p-post" style={{ marginBottom: 12 }}>
              <div className="p-post-header">
                <div style={{ width: 36, height: 36, borderRadius: 8, background: company.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>{company.name[0]}</div>
                <div>
                  <div className="p-post-author">{company.name}</div>
                  <div className="p-post-time">{post.time[lang]}</div>
                </div>
              </div>
              <div className="p-post-text">{post.text[lang] || post.text.da}</div>
              <div className="p-post-stats">
                <span>{post.likes} {t.like.toLowerCase()}{post.likes !== 1 && lang === 'da' ? 'r' : ''}</span>
                <span>{typeof post.comments === 'number' ? post.comments : post.comments?.length} {t.comment.toLowerCase()}{lang === 'da' ? 'er' : 's'}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'about' && (
        <div className="p-card">
          <h4 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Om {company.name}</h4>
          <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6, margin: 0 }}>{company.description}</p>
        </div>
      )}

      {tab === 'jobs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {companyJobs.length === 0 ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>{t.jobNoJobs}</div>
          ) : companyJobs.map(job => (
            <JobCard key={job.id} job={job} t={t} lang={lang} />
          ))}
        </div>
      )}
    </div>
  )
}

function CreateCompanyModal({ t, lang, currentUser, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [size, setSize] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fS = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lS = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 14 }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreate({
      id: Date.now(),
      name: name.trim(),
      tagline: tagline.trim(),
      website: website.trim(),
      industry: industry.trim(),
      size,
      description: description.trim(),
      followers: 1,
      role: 'owner',
      color: nameToColor(name),
      posts: [],
      jobs: [],
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-event-create-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>🏢 {t.createCompany}</h3>
        <form onSubmit={handleSubmit}>
          <label style={lS}>{t.companyName} *</label>
          <input style={fS} value={name} onChange={e => setName(e.target.value)} required placeholder="Acme Corp" />
          <label style={lS}>{t.companyTagline}</label>
          <input style={fS} value={tagline} onChange={e => setTagline(e.target.value)} placeholder={lang === 'da' ? 'Kort slogan...' : 'Short tagline...'} />
          <label style={lS}>{t.companyWebsite}</label>
          <input style={fS} type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
          <label style={lS}>{t.companyIndustry}</label>
          <input style={fS} value={industry} onChange={e => setIndustry(e.target.value)} placeholder={lang === 'da' ? 'f.eks. Software & SaaS' : 'e.g. Software & SaaS'} />
          <label style={lS}>{t.companySize}</label>
          <select style={fS} value={size} onChange={e => setSize(e.target.value)}>
            <option value="">—</option>
            {(t.companySizes || ['1–10', '11–50', '51–200', '201–500', '500+']).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={lS}>{t.companyDescription}</label>
          <textarea style={{ ...fS, minHeight: 80, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder={lang === 'da' ? 'Beskriv virksomheden...' : 'Describe the company...'} />
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 }}>{t.companyCancel}</button>
            <button type="submit" style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{t.companyCreate}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Jobs ──
function JobCard({ job, t, lang, onSave, saved }) {
  const [isSaved, setIsSaved] = useState(saved || job.saved)
  const title = typeof job.title === 'string' ? job.title : (job.title[lang] || job.title.da)
  const desc = typeof job.description === 'string' ? job.description : (job.description[lang] || job.description.da)
  const reqs = typeof job.requirements === 'string' ? job.requirements : (job.requirements[lang] || job.requirements.da)
  const typeLabels = { fulltime: t.jobTypeFullTime, parttime: t.jobTypePartTime, freelance: t.jobTypeFreelance, internship: t.jobTypeInternship }

  return (
    <div className="p-card p-job-card">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: job.companyColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 20, flexShrink: 0 }}>
          {job.companyName[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
            {job.companyName} · {job.location}
            {job.remote && <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#F0FAF4', color: '#2D6A4F', fontWeight: 600 }}>{t.jobRemote}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="p-event-type-badge">{typeLabels[job.type] || job.type}</span>
            <span style={{ fontSize: 12, color: '#999' }}>{job.postedDate}</span>
          </div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.5, margin: '0 0 10px' }}>{desc.slice(0, 200)}{desc.length > 200 ? '…' : ''}</p>
          {reqs && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: 13, color: '#2D6A4F', fontWeight: 600, cursor: 'pointer' }}>
                {lang === 'da' ? 'Krav' : 'Requirements'}
              </summary>
              <pre style={{ fontSize: 12, color: '#555', whiteSpace: 'pre-wrap', marginTop: 8, fontFamily: 'inherit', lineHeight: 1.6 }}>{reqs}</pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href={job.applyLink.startsWith('http') ? job.applyLink : `mailto:${job.applyLink}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-events-create-btn"
              style={{ textDecoration: 'none', display: 'inline-block', padding: '8px 18px', fontSize: 13 }}
            >
              {t.jobApply} →
            </a>
            <button
              onClick={() => setIsSaved(v => !v)}
              style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${isSaved ? '#2D6A4F' : '#ddd'}`, background: isSaved ? '#F0FAF4' : '#fff', color: isSaved ? '#2D6A4F' : '#555', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              {isSaved ? `★ ${t.jobSaved}` : `☆ ${t.jobSave}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function JobsPage({ lang, t, currentUser, mode }) {
  const [jobs, setJobs] = useState(MOCK_JOBS)
  const [savedIds, setSavedIds] = useState(new Set())
  const [tab, setTab] = useState('all')
  const [filterType, setFilterType] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = jobs.filter(j => {
    const title = typeof j.title === 'string' ? j.title : (j.title[lang] || j.title.da)
    const desc = typeof j.description === 'string' ? j.description : (j.description[lang] || j.description.da)
    if (filterType && j.type !== filterType) return false
    if (filterLocation && !j.location.toLowerCase().includes(filterLocation.toLowerCase()) && !j.remote) return false
    if (filterKeyword && !title.toLowerCase().includes(filterKeyword.toLowerCase()) && !desc.toLowerCase().includes(filterKeyword.toLowerCase())) return false
    if (tab === 'saved') return savedIds.has(j.id)
    return true
  })

  return (
    <div className="p-events" style={{ maxWidth: 720 }}>
      <div className="p-events-header">
        <h2 className="p-section-title" style={{ margin: 0 }}>💼 {t.jobsTitle}</h2>
        <button className="p-events-create-btn" onClick={() => setShowCreate(true)}>
          + {t.createJob}
        </button>
      </div>

      {/* Filters */}
      <div className="p-card" style={{ marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          className="p-search-input"
          style={{ flex: 2, minWidth: 120 }}
          placeholder={t.jobSearchKeyword}
          value={filterKeyword}
          onChange={e => setFilterKeyword(e.target.value)}
        />
        <input
          className="p-search-input"
          style={{ flex: 1, minWidth: 100 }}
          placeholder={t.jobSearchLocation}
          value={filterLocation}
          onChange={e => setFilterLocation(e.target.value)}
        />
        <select
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', color: '#444' }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">{t.jobSearchType}</option>
          <option value="fulltime">{t.jobTypeFullTime}</option>
          <option value="parttime">{t.jobTypePartTime}</option>
          <option value="freelance">{t.jobTypeFreelance}</option>
          <option value="internship">{t.jobTypeInternship}</option>
        </select>
      </div>

      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`p-filter-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
          {lang === 'da' ? 'Alle job' : 'All jobs'} ({jobs.length})
        </button>
        <button className={`p-filter-tab${tab === 'saved' ? ' active' : ''}`} onClick={() => setTab('saved')}>
          {t.savedJobs} ({savedIds.size})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>{t.jobNoJobs}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              t={t}
              lang={lang}
              saved={savedIds.has(job.id)}
              onSave={(id, v) => setSavedIds(prev => { const n = new Set(prev); v ? n.add(id) : n.delete(id); return n })}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateJobModal
          t={t}
          lang={lang}
          companies={MOCK_COMPANIES.filter(c => c.role === 'owner' || c.role === 'admin')}
          onClose={() => setShowCreate(false)}
          onCreate={(job) => { setJobs(prev => [job, ...prev]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function CreateJobModal({ t, lang, companies, onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')
  const [location, setLocation] = useState('')
  const [remote, setRemote] = useState(false)
  const [type, setType] = useState('fulltime')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [applyLink, setApplyLink] = useState('')

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fS = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lS = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 14 }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim() || !location.trim()) return
    const company = companies.find(c => c.id === Number(companyId)) || companies[0]
    onCreate({
      id: Date.now(),
      companyId: company?.id,
      companyName: company?.name || '',
      companyColor: company?.color || '#2D6A4F',
      title: { da: title, en: title },
      location,
      remote,
      type,
      description: { da: description, en: description },
      requirements: { da: requirements, en: requirements },
      applyLink,
      postedDate: new Date().toISOString().slice(0, 10),
      saved: false,
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-event-create-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>💼 {t.createJob}</h3>
        <form onSubmit={handleSubmit}>
          {companies.length > 0 && (
            <>
              <label style={lS}>{t.companies}</label>
              <select style={fS} value={companyId} onChange={e => setCompanyId(e.target.value)}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>
          )}
          <label style={lS}>{t.jobTitle} *</label>
          <input style={fS} value={title} onChange={e => setTitle(e.target.value)} required placeholder={lang === 'da' ? 'f.eks. Senior Designer' : 'e.g. Senior Designer'} />
          <label style={lS}>{t.jobLocation} *</label>
          <input style={fS} value={location} onChange={e => setLocation(e.target.value)} required placeholder={lang === 'da' ? 'By, Land eller "Remote"' : 'City, Country or "Remote"'} />
          <label style={{ ...lS, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} />
            {t.jobRemote}
          </label>
          <label style={lS}>{t.jobType}</label>
          <select style={fS} value={type} onChange={e => setType(e.target.value)}>
            <option value="fulltime">{t.jobTypeFullTime}</option>
            <option value="parttime">{t.jobTypePartTime}</option>
            <option value="freelance">{t.jobTypeFreelance}</option>
            <option value="internship">{t.jobTypeInternship}</option>
          </select>
          <label style={lS}>{t.jobDescription}</label>
          <textarea style={{ ...fS, minHeight: 80, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder={lang === 'da' ? 'Beskriv stillingen...' : 'Describe the position...'} />
          <label style={lS}>{t.jobRequirements}</label>
          <textarea style={{ ...fS, minHeight: 60, resize: 'vertical' }} value={requirements} onChange={e => setRequirements(e.target.value)} placeholder={lang === 'da' ? 'Krav til ansøgeren...' : 'Requirements for applicants...'} />
          <label style={lS}>{t.jobApplyLink}</label>
          <input style={fS} value={applyLink} onChange={e => setApplyLink(e.target.value)} placeholder={lang === 'da' ? 'Link eller e-mail' : 'Link or email'} />
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 }}>{t.eventCancel}</button>
            <button type="submit" style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{t.jobPost}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
