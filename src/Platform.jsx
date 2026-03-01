import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { PT, INTEREST_CATEGORIES, nameToColor, getInitials } from './data.js'
import { apiFetchFeed, apiCreatePost, apiGetPostLikers, apiToggleLike, apiAddComment, apiDeletePost, apiEditPost, apiFetchProfile, apiFetchFriends, apiFetchConversations, apiMarkConversationRead, apiSendConversationMessage, apiFetchOlderConversationMessages, apiCreateConversation, apiInviteToConversation, apiMuteConversation, apiLeaveConversation, apiRenameConversation, apiUploadAvatar, apiCheckSession, apiDeleteFacebookData, apiDeleteAccount, apiExportData, apiGetConsentStatus, apiWithdrawConsent, apiGetInviteLink, apiGetInvites, apiSendInvites, apiCancelInvite, apiLinkPreview, apiSearch, apiGetPost, apiSearchUsers, apiSendFriendRequest, apiFetchFriendRequests, apiAcceptFriendRequest, apiDeclineFriendRequest, apiUnfriend, apiFetchListings, apiFetchMyListings, apiCreateListing, apiUpdateListing, apiMarkListingSold, apiDeleteListing, apiBoostListing, apiRelistListing, apiGetAdminSettings, apiSaveAdminSettings, apiGetAdminStats, apiGetAnalytics, apiFetchEvents, apiCreateEvent, apiRsvpEvent, apiUpdateMode, apiUpdatePlan, apiUpdateInterests, apiGetFeedWeights, apiSaveFeedWeights, apiGetInterestStats, apiGetReferralDashboard, apiGetLeaderboard, apiGetBadges, apiToggleProfilePublic, apiTrackShare, apiGetAdminViralStats, apiGetGroupSuggestions, apiJoinGroup, apiFetchReels, apiUploadReel, apiToggleReelLike, apiFetchReelComments, apiAddReelComment, apiDeleteReel, apiFetchCalendarEvents, apiUpdateBirthday } from './api.js'
import ReelsPage from './Reels.jsx'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Mock notifications ──
function makeMockNotifs(mode) {
  const isBiz = mode === 'business'
  const base = [
    { id: 1, type: 'friend_request', actor: 'Liam Madsen', time: '2 min', read: false, targetPage: 'friends' },
    { id: 2, type: 'like', actor: 'Clara Johansen', time: '15 min', read: false, targetPage: 'feed', postId: 1 },
    { id: 3, type: 'comment', actor: 'Magnus Jensen', time: '1 t', read: false, targetPage: 'feed', postId: 2 },
    { id: 4, type: 'accepted', actor: 'Astrid Poulsen', time: '3 t', read: true, targetPage: 'friends' },
    { id: 5, type: 'group_post', actor: 'Emil Larsen', group: 'Designere i KBH', time: '5 t', read: true, targetPage: 'feed', postId: 3 },
  ]
  if (isBiz) {
    base.push(
      { id: 6, type: 'profile_view', actor: 'Freja Andersen', time: '8 t', read: true, targetPage: 'profile' },
      { id: 7, type: 'endorsement', actor: 'Noah Rasmussen', time: '1 d', read: true, targetPage: 'profile' },
    )
  }
  return base
}

export default function Platform({ lang: initialLang, onLogout, initialPostId }) {
  const [lang, setLang] = useState(initialLang || 'da')
  const [page, setPage] = useState('feed')
  const [currentUser, setCurrentUser] = useState({ name: '', handle: '', initials: '' })
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const [openConvId, setOpenConvId] = useState(null)
  const [highlightPostId, setHighlightPostId] = useState(null)

  // React to initialPostId prop (set async in App after URL parse)
  useEffect(() => {
    if (initialPostId) setHighlightPostId(initialPostId)
  }, [initialPostId])
  const [viewUserId, setViewUserId] = useState(null)
  const [mode, setMode] = useState(() => {
    const stored = localStorage.getItem('fellis_mode') || 'privat'
    if (stored === 'common') { localStorage.setItem('fellis_mode', 'privat'); return 'privat' }
    return stored
  })
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [notifs, setNotifs] = useState(() => {
    const storedMode = localStorage.getItem('fellis_mode') || 'privat'
    const readIds = new Set(JSON.parse(localStorage.getItem('fellis_notifs_read') || '[]'))
    return makeMockNotifs(storedMode === 'common' ? 'privat' : storedMode).map(n => readIds.has(n.id) ? { ...n, read: true } : n)
  })
  const [showModeModal, setShowModeModal] = useState(false)
  const [plan, setPlan] = useState('business') // set from server session; 'business_pro' = paid tier
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('fellis_dark') === '1')
  const avatarMenuRef = useRef(null)
  const notifRef = useRef(null)
  const t = PT[lang]

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
    localStorage.setItem('fellis_dark', darkMode ? '1' : '0')
  }, [darkMode])

  const unreadCount = notifs.filter(n => !n.read).length

  const switchMode = (newMode) => {
    // 'business_pro' is a UI-only tier key: mode=business + plan=business_pro
    if (newMode === 'business_pro') {
      if (plan !== 'business_pro') {
        setShowModeModal(false)
        setShowUpgradeModal(true)
        return
      }
      newMode = 'business' // already pro, just ensure mode is business
    }
    setMode(newMode)
    localStorage.setItem('fellis_mode', newMode)
    const savedReadIds = new Set(JSON.parse(localStorage.getItem('fellis_notifs_read') || '[]'))
    setNotifs(makeMockNotifs(newMode).map(n => savedReadIds.has(n.id) ? { ...n, read: true } : n))
    setShowModeModal(false)
    // Sync mode to server so admin stats can segment by mode
    const serverMode = newMode === 'business' ? 'business' : 'privat'
    apiUpdateMode(serverMode).catch(() => {})
  }

  const markAllRead = () => {
    setNotifs(prev => {
      const all = prev.map(n => ({ ...n, read: true }))
      localStorage.setItem('fellis_notifs_read', JSON.stringify(all.map(n => n.id)))
      return all
    })
  }

  const toggleLang = useCallback(() => setLang(p => p === 'da' ? 'en' : 'da'), [])

  // Load current user from session — mode and plan are authoritative from server
  useEffect(() => {
    apiCheckSession().then(data => {
      if (data?.user) {
        setCurrentUser(prev => ({ ...prev, ...data.user }))
        if (data.user.plan) setPlan(data.user.plan)
        // Mode from server is authoritative — sync to localStorage
        if (data.user.mode) {
          setMode(data.user.mode)
          localStorage.setItem('fellis_mode', data.user.mode)
        } else {
          // Fallback: sync localStorage → server
          apiUpdateMode(mode === 'business' ? 'business' : 'privat').catch(() => {})
        }
      } else {
        onLogout()
      }
    }).catch(() => {
      onLogout()
    })
  }, [onLogout]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const [navParam, setNavParam] = useState(null)
  const savedFeedScroll = useRef(0)

  const navigateTo = useCallback((p, param = null) => {
    if (p !== 'feed') savedFeedScroll.current = window.scrollY
    setPage(p)
    setNavParam(param)
    setShowAvatarMenu(false)
  }, [])

  // Restore feed scroll position synchronously before paint (when returning to feed)
  useLayoutEffect(() => {
    if (page === 'feed' && savedFeedScroll.current > 0) {
      window.scrollTo(0, savedFeedScroll.current)
    }
  }, [page])

  const avatarSrc = currentUser.avatar_url
    ? (currentUser.avatar_url.startsWith('http') || currentUser.avatar_url.startsWith('blob:') ? currentUser.avatar_url : `${API_BASE}${currentUser.avatar_url}`)
    : null

  const menuT = lang === 'da' ? {
    viewProfile: 'Se profil',
    editProfile: 'Rediger profil',
    settings: 'Indstillinger',
    analytics: 'Analyser',
    privacy: 'Privatliv & Data',
    logout: 'Log ud',
  } : {
    viewProfile: 'View profile',
    editProfile: 'Edit profile',
    settings: 'Settings',
    analytics: 'Analytics',
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
          {['feed', 'reels', 'friends', 'messages', 'events', 'calendar', 'marketplace', ...(mode === 'business' ? ['jobs', 'analytics'] : []), 'company'].map(p => (
            <button
              key={p}
              className={`p-nav-tab${page === p ? ' active' : ''}`}
              onClick={() => navigateTo(p)}
            >
              <span className="p-nav-tab-icon">
                {p === 'feed' ? '🏠' : p === 'reels' ? '🎬' : p === 'friends' ? '👥' : p === 'messages' ? '💬' : p === 'events' ? '📅' : p === 'calendar' ? '🗓️' : p === 'marketplace' ? '🛍️' : p === 'analytics' ? '📊' : p === 'company' ? '🏢' : p === 'admin' ? '⚙️' : '💼'}
              </span>
              <span className="p-nav-tab-label">
                {p === 'friends'
                  ? (mode === 'business' ? t.connectionsLabel : t.friends)
                  : p === 'analytics' ? t.analyticsNav
                  : p === 'company' ? t.companies
                  : p === 'admin' ? t.adminTitle
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
                onMarkRead={(id) => setNotifs(prev => {
                  const next = prev.map(n => n.id === id ? { ...n, read: true } : n)
                  localStorage.setItem('fellis_notifs_read', JSON.stringify(next.filter(n => n.read).map(n => n.id)))
                  return next
                })}
                onNavigate={(pg, postId) => {
                  if (postId) { setHighlightPostId(postId) }
                  navigateTo(pg)
                  setShowNotifPanel(false)
                }}
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
                    {mode === 'privat' ? t.modeCommonTag : plan === 'business_pro' ? t.modeBusinessProTag : t.modeBusinessTag}
                  </span>
                </div>
                <div className="avatar-dropdown-divider" />
                <button className="avatar-dropdown-item" onClick={() => navigateTo('profile')}>
                  <span>👤</span> {menuT.viewProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('edit-profile')}>
                  <span>✏️</span> {menuT.editProfile}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('settings')}>
                  <span>⚙️</span> {menuT.settings}
                </button>
                <button className="avatar-dropdown-item" onClick={() => navigateTo('privacy')}>
                  <span>🔒</span> {menuT.privacy}
                </button>
                {currentUser.is_admin && (
                  <button className="avatar-dropdown-item" onClick={() => navigateTo('admin')}>
                    <span>⚙️</span> {t.adminTitle}
                  </button>
                )}
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
        <div style={{ display: page === 'feed' ? '' : 'none' }}>
          <FeedPage lang={lang} t={t} currentUser={currentUser} mode={mode} highlightPostId={highlightPostId} onHighlightCleared={() => setHighlightPostId(null)}
            onViewProfile={(uid) => { setViewUserId(uid); navigateTo('view-profile') }}
            onViewOwnProfile={() => navigateTo('profile')}
            onNavigate={navigateTo}
          />
        </div>
        {page === 'reels' && <ReelsPage t={t} currentUser={currentUser} />}
        {page === 'profile' && <ProfilePage lang={lang} t={t} currentUser={currentUser} mode={mode} plan={plan} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'view-profile' && viewUserId && <FriendProfilePage userId={viewUserId} lang={lang} t={t} currentUser={currentUser} onBack={() => navigateTo('feed')} onMessage={async (prof) => { const data = await apiCreateConversation([prof.id], null, false, false).catch(() => null); if (data?.id) setOpenConvId(data.id); navigateTo('messages') }} />}
        {page === 'edit-profile' && <EditProfilePage lang={lang} t={t} currentUser={currentUser} mode={mode} onUserUpdate={setCurrentUser} onNavigate={navigateTo} />}
        {page === 'friends' && <FriendsPage lang={lang} t={t} mode={mode} onMessage={async (friend) => {
          if (friend?.id) {
            const data = await apiCreateConversation([friend.id], null, false, false).catch(() => null)
            if (data?.id) setOpenConvId(data.id)
          }
          navigateTo('messages')
        }} />}
        <div style={{ display: page === 'messages' ? '' : 'none' }}>
          <MessagesPage lang={lang} t={t} currentUser={currentUser} mode={mode} openConvId={openConvId} onConvOpened={() => setOpenConvId(null)} />
        </div>
        {page === 'events' && <EventsPage lang={lang} t={t} currentUser={currentUser} mode={mode} />}
        {page === 'calendar' && <CalendarPage lang={lang} t={t} currentUser={currentUser} />}
        {page === 'marketplace' && <MarketplacePage lang={lang} t={t} currentUser={currentUser} onContactSeller={async (sellerId) => {
          const numId = parseInt(sellerId)
          if (numId > 0 && !isNaN(numId) && numId !== currentUser.id) {
            const data = await apiCreateConversation([numId], null, false, false).catch(() => null)
            if (data?.id) setOpenConvId(data.id)
          }
          navigateTo('messages')
        }} />}
        {page === 'jobs' && <JobsPage lang={lang} t={t} currentUser={currentUser} mode={mode} />}
        {page === 'company' && <CompanyListPage lang={lang} t={t} currentUser={currentUser} mode={mode} onNavigate={navigateTo} initialCompanyId={navParam?.companyId} />}
        {page === 'analytics' && <AnalyticsPage lang={lang} t={t} currentUser={currentUser} plan={plan} onUpgrade={() => setShowUpgradeModal(true)} />}
        {page === 'settings' && <SettingsPage lang={lang} t={t} currentUser={currentUser} mode={mode} onUserUpdate={setCurrentUser} onNavigate={navigateTo} onLogout={onLogout} onOpenModeModal={() => setShowModeModal(true)} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />}
        {page === 'privacy' && <PrivacySection lang={lang} onLogout={onLogout} />}
        {page === 'visitors' && <VisitorStatsPage lang={lang} />}
        {page === 'admin' && currentUser.is_admin && <AdminPage lang={lang} t={t} />}
        {page === 'search' && (
          <SearchPage
            lang={lang}
            t={t}
            mode={mode}
            onNavigateToPost={(postId) => { setHighlightPostId(postId); navigateTo('feed') }}
            onNavigateToConv={(convId) => { setOpenConvId(convId); navigateTo('messages') }}
            onNavigateToCompany={(id) => navigateTo('company', id ? { companyId: id } : null)}
          />
        )}
      </div>

      {/* Mode switch modal */}
      {showUpgradeModal && (
        <UpgradeModal lang={lang} t={t} onUpgrade={() => {
          setPlan('business_pro')
          setShowUpgradeModal(false)
          setMode('business')
          localStorage.setItem('fellis_mode', 'business')
          const savedReadIds = new Set(JSON.parse(localStorage.getItem('fellis_notifs_read') || '[]'))
          setNotifs(makeMockNotifs('business').map(n => savedReadIds.has(n.id) ? { ...n, read: true } : n))
          apiUpdateMode('business').catch(() => {})
          apiUpdatePlan('business_pro').catch(() => {})
        }} onClose={() => setShowUpgradeModal(false)} />
      )}
      {showModeModal && (() => {
        const currentTier = mode === 'privat' ? 'privat' : plan === 'business_pro' ? 'business_pro' : 'business'
        const currentLabel = currentTier === 'privat' ? t.modeCommon : currentTier === 'business_pro' ? t.modeBusinessPro : t.modeBusiness
        return (
          <div className="modal-backdrop" onClick={() => setShowModeModal(false)}>
            <div className="mode-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>{t.modeTitle}</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#888' }}>{t.modeCurrentLabel}: <strong>{currentLabel}</strong></p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { key: 'privat', label: t.modeCommon, icon: '🏠', desc: t.modeCommonDesc, badge: null },
                  { key: 'business', label: t.modeBusiness, icon: '💼', desc: t.modeBusinessDesc, badge: lang === 'da' ? 'Gratis' : 'Free' },
                  { key: 'business_pro', label: t.modeBusinessPro, icon: '🚀', desc: t.modeBusinessProDesc, badge: lang === 'da' ? 'Betalt' : 'Paid' },
                ].map(({ key, label, icon, desc, badge }) => {
                  const isActive = key === currentTier
                  return (
                    <button
                      key={key}
                      onClick={() => switchMode(key)}
                      className={`mode-card${isActive ? ' mode-card-active' : ''}`}
                      style={{ flex: '1 1 140px', minWidth: 130 }}
                    >
                      <span style={{ fontSize: 28 }}>{icon}</span>
                      <strong style={{ fontSize: 14 }}>{label}</strong>
                      {badge && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: key === 'business_pro' ? '#2D6A4F' : '#e8f5ee', color: key === 'business_pro' ? '#fff' : '#2D6A4F', fontWeight: 700 }}>{badge}</span>}
                      <span style={{ fontSize: 11, color: '#777', lineHeight: 1.4 }}>{desc}</span>
                      {isActive && <span className="mode-card-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Fixed status bar at bottom */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
        borderTop: '1px solid #E8E4DF',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20,
        padding: '0 24px', height: 36, fontSize: 12, color: '#888',
      }}>
        <button
          onClick={() => navigateTo('visitors')}
          title={lang === 'da' ? 'Besøgsstatistik' : 'Visitor statistics'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, color: '#2D6A4F' }}
        >
          🌍 <span style={{ fontSize: 11, fontWeight: 600 }}>{lang === 'da' ? 'Besøgende' : 'Visitors'}</span>
        </button>
        <span style={{ color: '#ccc' }}>|</span>
        <span>© {new Date().getFullYear()} fellis.eu — {lang === 'da' ? 'Privat. EU-hostet. GDPR-klar.' : 'Private. EU-hosted. GDPR-ready.'}</span>
      </div>
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
            onClick={() => { onMarkRead(n.id); onNavigate(n.targetPage, n.postId) }}
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

// ── Reels strip shown at top of feed ──────────────────────────────────────────
function ReelsStrip({ lang, t, onNavigate }) {
  const [reels, setReels] = useState([])

  useEffect(() => {
    apiFetchReels(0, 3).then(data => { if (data?.reels?.length) setReels(data.reels) })
  }, [])

  if (!reels.length) return null

  const API_BASE = import.meta.env.VITE_API_URL || ''

  const s = {
    wrap: {
      padding: '12px 0 4px',
      marginBottom: 8,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
      padding: '0 2px',
    },
    label: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #111)' },
    seeAll: {
      background: 'none',
      border: 'none',
      color: '#1877F2',
      fontSize: 13,
      cursor: 'pointer',
      fontWeight: 600,
      padding: 0,
    },
    row: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 8,
    },
    card: {
      position: 'relative',
      borderRadius: 12,
      overflow: 'hidden',
      aspectRatio: '9/16',
      background: '#111',
      cursor: 'pointer',
    },
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      pointerEvents: 'none',
    },
    playIcon: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.25)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      pointerEvents: 'none',
    },
    overlay: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      padding: '20px 6px 6px',
      background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
      pointerEvents: 'none',
    },
    author: {
      fontSize: 11,
      fontWeight: 600,
      color: '#fff',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.label}>{t.reels}</span>
        <button style={s.seeAll} onClick={() => onNavigate('reels')}>
          {lang === 'da' ? 'Se alle' : 'See all'} →
        </button>
      </div>
      <div style={s.row}>
        {reels.map(reel => (
          <div key={reel.id} style={s.card} onClick={() => onNavigate('reels')} title={reel.caption || reel.author_name}>
            <video
              src={`${API_BASE}${reel.video_url}`}
              style={s.video}
              muted
              preload="metadata"
              playsInline
            />
            <div style={s.playIcon}>▶</div>
            <div style={s.overlay}>
              <div style={s.author}>{reel.author_name}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FeedPage({ lang, t, currentUser, mode, highlightPostId, onHighlightCleared, onViewProfile, onViewOwnProfile, onNavigate }) {
  const [posts, setPosts] = useState([])
  const [pinnedPost, setPinnedPost] = useState(null)
  const pinnedRef = useRef(null)
  const [insightsPostId, setInsightsPostId] = useState(null)
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
  const [likersModal, setLikersModal] = useState(null) // { postId, likers } | null
  const [commentTexts, setCommentTexts] = useState({})
  const [commentMedia, setCommentMedia] = useState({})
  const [sharePopup, setSharePopup] = useState(null)      // postId of open popup
  const [sharePopupFriends, setSharePopupFriends] = useState(null) // null = not loaded yet
  const [shareSentTo, setShareSentTo] = useState(null)   // friendId just messaged
  const [postExpanded, setPostExpanded] = useState(false)
  const [mediaPopup, setMediaPopup] = useState(false)
  const [postMenu, setPostMenu] = useState(null)       // postId with open options menu
  const [hiddenPosts, setHiddenPosts] = useState(new Set()) // locally hidden post ids
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const feedMention = useMention(sharePopupFriends || [])
  const commentFileRefs = useRef({})
  const [commentMediaPopup, setCommentMediaPopup] = useState(null) // postId of open popup
  const bottomSentinelRef = useRef(null)
  const topSentinelRef = useRef(null)
  const feedContainerRef = useRef(null)
  const [feedSelectedEvent, setFeedSelectedEvent] = useState(null)
  const [feedRsvpMap, setFeedRsvpMap] = useState({})
  const [feedRsvpExtras, setFeedRsvpExtras] = useState({})
  const { rels } = useContactRelationships()
  const CP_FEED_DEFAULT_COMMENTS = [
    { id: 1, author: 'Mia Skov', text: 'Spændende mulighed!' },
    { id: 2, author: 'Jonas Holm', text: 'Sender ansøgning i dag 🙌' },
    { id: 3, author: 'Rikke Dahl', text: 'Godt at se jer vokse!' },
  ]
  const CP_FEED_MOCK_LIKERS = [
    { id: null, name: 'Mia Skov', reaction: '❤️' },
    { id: null, name: 'Jonas Holm', reaction: '❤️' },
    { id: null, name: 'Rikke Dahl', reaction: '❤️' },
    { id: null, name: 'Louise Bak', reaction: '❤️' },
    { id: null, name: 'Thomas Ravn', reaction: '❤️' },
    { id: null, name: 'Emma Lund', reaction: '❤️' },
    { id: null, name: 'Søren Vik', reaction: '🎉' },
    { id: null, name: 'Astrid Poulsen', reaction: '❤️' },
    { id: null, name: 'Henrik Dalgaard', reaction: '👍' },
    { id: null, name: 'Camilla Frost', reaction: '❤️' },
    { id: null, name: 'Nikolaj Bach', reaction: '❤️' },
    { id: null, name: 'Anne-Marie Holm', reaction: '❤️' },
    { id: null, name: 'Peter Nygaard', reaction: '❤️' },
    { id: null, name: 'Sara Bonde', reaction: '❤️' },
  ]
  const [cpFeedPosts, setCpFeedPosts] = useState([])
  const [cpFeedExpanded, setCpFeedExpanded] = useState(new Set())
  const [cpFeedCommentTexts, setCpFeedCommentTexts] = useState({})
  const [cpFeedCommentLists, setCpFeedCommentLists] = useState({})
  const [feedEvents, setFeedEvents] = useState([])
  const feedDbEventIds = new Set(feedEvents.map(e => e.id))
  const [editingPostId, setEditingPostId] = useState(null)
  const [editPostText, setEditPostText] = useState('')
  const [groupSuggestions, setGroupSuggestions] = useState([])
  const [joinedGroupIds, setJoinedGroupIds] = useState(new Set())
  const [dismissedGroupIds, setDismissedGroupIds] = useState(new Set())

  const handleJoinGroup = async (groupId) => {
    setJoinedGroupIds(prev => new Set([...prev, groupId]))
    await apiJoinGroup(groupId).catch(() => {})
  }

  const handleFeedRsvp = (eventId, status) => {
    const newStatus = feedRsvpMap[eventId] === status ? null : status
    setFeedRsvpMap(prev => ({ ...prev, [eventId]: newStatus }))
    if (feedDbEventIds.has(eventId)) apiRsvpEvent(eventId, newStatus, {}).catch(() => {})
  }

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
    apiFetchEvents().then(data => {
      if (data?.events?.length) {
        setFeedEvents(data.events)
        const map = {}
        data.events.forEach(e => { if (e.myRsvp) map[e.id] = e.myRsvp })
        setFeedRsvpMap(map)
      }
    })
    // Load dynamic group suggestions
    apiGetGroupSuggestions().then(data => {
      if (data?.suggestions?.length) setGroupSuggestions(data.suggestions)
    })

    // Load recent company posts from followed companies
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const allCompanies = data.companies || []
        const followed = allCompanies.filter(c => c.is_following || c.role === 'following' || c.member_role === 'owner' || c.role === 'owner')
        if (!followed.length) return
        return fetch(`/api/companies/${followed[0].id}/posts?limit=2`, { credentials: 'include' })
          .then(r => r.json())
          .then(pd => {
            setCpFeedPosts((pd.posts || []).map(p => ({ ...p, company: followed[0] })))
          })
      })
      .catch(() => {})
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
    if (!newPostText.trim() && !mediaFiles.length) return
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

  const openLikersModal = useCallback((postId) => {
    setLikersModal({ postId, likers: null })
    apiGetPostLikers(postId).then(data => {
      setLikersModal(prev => prev?.postId === postId ? { postId, likers: data || [] } : prev)
    }).catch(() => {
      setLikersModal(prev => prev?.postId === postId ? { postId, likers: [] } : prev)
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

  const [copyLinkDone, setCopyLinkDone] = useState(null) // postId that was just copied
  const handleCopyLink = useCallback(async (post) => {
    const url = `${window.location.origin}/?post=${post.id}`
    try { await navigator.clipboard.writeText(url) } catch {}
    setCopyLinkDone(post.id)
    setTimeout(() => { setCopyLinkDone(null); setSharePopup(null) }, 1200)
  }, [])

  const handleShareToFriend = useCallback(async (post, friendId) => {
    const text = post.text[lang] || post.text.da || ''
    const msg = `${post.author}: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}" — fellis.eu`
    const conv = await apiCreateConversation([friendId], null, false, false).catch(() => null)
    if (conv?.id) await apiSendConversationMessage(conv.id, msg).catch(() => {})
    setShareSentTo(friendId)
    setTimeout(() => { setSharePopup(null); setShareSentTo(null) }, 1200)
  }, [lang])

  const handleDeletePost = useCallback(async (postId) => {
    setPostMenu(null)
    await apiDeletePost(postId).catch(() => {})
    setPosts(prev => prev.filter(p => p.id !== postId))
  }, [])

  const handleStartEditPost = useCallback((post) => {
    setPostMenu(null)
    setEditingPostId(post.id)
    setEditPostText(post.text?.[lang] || post.text?.da || '')
  }, [lang])

  const handleSaveEditPost = useCallback(async (postId) => {
    if (!editPostText.trim()) return
    const data = await apiEditPost(postId, editPostText.trim()).catch(() => null)
    if (data?.ok) {
      setPosts(prev => prev.map(p => p.id === postId
        ? { ...p, text: { da: data.text, en: data.text }, edited: true }
        : p))
    }
    setEditingPostId(null)
    setEditPostText('')
  }, [editPostText])

  const handleHidePost = useCallback((postId) => {
    setHiddenPosts(prev => new Set([...prev, postId]))
    setPostMenu(null)
  }, [])

  const handleUnfriendFromPost = useCallback(async (post) => {
    setPostMenu(null)
    if (!post.authorId) return
    await apiUnfriend(post.authorId).catch(() => {})
    setPosts(prev => prev.filter(p => p.authorId !== post.authorId))
  }, [])

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
    if (!pinnedPost) return
    const timer = setTimeout(() => {
      pinnedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
    return () => clearTimeout(timer)
  }, [pinnedPost])

  const pageNum = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-feed" ref={feedContainerRef}>
      {/* Likers modal */}
      {likersModal && (
        <div className="modal-backdrop" onClick={() => setLikersModal(null)}>
          <div className="p-msg-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="p-msg-modal-header">
              <span>{lang === 'da' ? 'Reaktioner' : 'Reactions'}</span>
              <button className="p-msg-modal-close" onClick={() => setLikersModal(null)}>✕</button>
            </div>
            <div className="p-msg-modal-list">
              {likersModal.likers === null
                ? <div style={{ padding: '16px', textAlign: 'center', color: '#aaa' }}>…</div>
                : likersModal.likers.length === 0
                  ? <div style={{ padding: '16px', textAlign: 'center', color: '#aaa' }}>{lang === 'da' ? 'Ingen reaktioner endnu' : 'No reactions yet'}</div>
                  : likersModal.likers.map((liker, i) => (
                    <div key={liker.id ?? `mock-${i}`} className="p-msg-modal-item" style={{ cursor: liker.id ? 'pointer' : 'default' }}
                      onClick={() => { if (liker.id) { setLikersModal(null); onViewProfile(liker.id) } }}>
                      <div className="p-avatar-sm" style={{ background: nameToColor(liker.name) }}>
                        {getInitials(liker.name)}
                      </div>
                      <span className="p-msg-modal-name">{liker.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 20 }}>{liker.reaction}</span>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}
      {/* Reels strip */}
      <ReelsStrip lang={lang} t={t} onNavigate={onNavigate} />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Media attachment popup */}
                <div className="p-media-popup-wrap">
                  <button
                    className={`p-media-popup-btn${mediaPopup ? ' active' : ''}`}
                    onMouseDown={e => e.preventDefault()}
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
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="p-input-hint-wrap">
                  <span className="p-input-hint-icon">?</span>
                  <span className="p-input-hint-tooltip">{t.postInputHint}</span>
                </span>
                <button className="p-post-btn" onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={!newPostText.trim() && !mediaPreviews.length}>{t.post}</button>
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
              <span>{lang === 'da' ? 'Vist opslag' : 'Linked post'}</span>
              <button className="p-post-pinned-close" onClick={() => { setPinnedPost(null); onHighlightCleared?.() }}>✕</button>
            </div>
            <div className="p-card p-post p-post-pinned p-post-highlighted">
              <div className="p-post-header">
                <div className="p-avatar-sm" style={{ background: nameToColor(post.author) }}>{getInitials(post.author)}</div>
                <div><div className="p-post-author">{post.author}</div><div className="p-post-time">{post.time?.[lang]}</div></div>
              </div>
              <div className="p-post-text">{post.text[lang]}</div>
              {post.media?.length > 0 && <PostMedia media={post.media} />}
            </div>
          </div>
        )
      })()}

      {/* Company posts feed items — shown chronologically within the feed */}
      {cpFeedPosts.map(post => {
        const cp = post.company
        const liked = !!post.liked
        const showComments = cpFeedExpanded.has(post.id)
        const postText = lang === 'da' ? (post.text_da || post.text_en) : (post.text_en || post.text_da)
        const timeAgo = new Date(post.created_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short' })
        const toggleLike = () => {
          fetch(`/api/companies/${cp.id}/posts/${post.id}/like`, { method: 'POST', credentials: 'include' })
            .then(r => r.json())
            .then(data => setCpFeedPosts(prev => prev.map(p => p.id === post.id
              ? { ...p, liked: data.liked ? 1 : 0, likes: data.liked ? p.likes + 1 : Math.max(0, p.likes - 1) }
              : p)))
            .catch(() => {})
        }
        const toggleComments = () => {
          setCpFeedExpanded(prev => { const n = new Set(prev); n.has(post.id) ? n.delete(post.id) : n.add(post.id); return n })
          if (!cpFeedCommentLists[post.id]) {
            fetch(`/api/companies/${cp.id}/posts/${post.id}/comments`, { credentials: 'include' })
              .then(r => r.json())
              .then(data => setCpFeedCommentLists(prev => ({ ...prev, [post.id]: data.comments || [] })))
              .catch(() => {})
          }
        }
        const sendComment = () => {
          const text = cpFeedCommentTexts[post.id]?.trim()
          if (!text) return
          fetch(`/api/companies/${cp.id}/posts/${post.id}/comments`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then(r => r.json())
            .then(comment => {
              setCpFeedCommentLists(prev => ({ ...prev, [post.id]: [...(prev[post.id] || []), comment] }))
              setCpFeedPosts(prev => prev.map(p => p.id === post.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p))
              setCpFeedCommentTexts(prev => ({ ...prev, [post.id]: '' }))
            })
            .catch(() => {})
        }
        return (
          <div key={post.id} className="p-card p-post">
            <div className="p-post-header">
              <div className="p-company-logo-sm" style={{ background: cp.color, borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>
                {cp.name[0]}
              </div>
              <div>
                <button className="p-post-author" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.textDecorationColor = 'currentColor'}
                  onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}
                  onClick={() => onNavigate('company', { companyId: cp.id })}>{cp.name}</button>
                <div className="p-post-time" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="p-event-type-badge" style={{ padding: '1px 6px', fontSize: 10 }}>{t.companyFeedLabel}</span>
                  <span>{timeAgo}</span>
                </div>
              </div>
            </div>
            <div className="p-post-text">{postText}</div>
            <div className="p-post-stats">
              <span style={{ cursor: 'pointer' }} onClick={toggleComments}>{post.likes} {t.like.toLowerCase()}</span>
              <span style={{ cursor: 'pointer' }} onClick={toggleComments}>{post.comment_count || 0} {t.comment.toLowerCase()}{lang === 'da' ? 'er' : 's'}</span>
            </div>
            <div className="p-post-actions">
              <button className={`p-action-btn${liked ? ' liked' : ''}`} onClick={() => { if (!showComments) toggleComments(); toggleLike() }}>
                {liked ? '❤️' : '🤍'} {t.like}
              </button>
              <button className="p-action-btn" onClick={toggleComments}>💬 {t.comment}</button>
            </div>
            {showComments && (
              <div className="p-comments">
                {(cpFeedCommentLists[post.id] || []).map(c => (
                  <div key={c.id} className="p-comment">
                    <div className="p-comment-bubble">
                      <span className="p-comment-author">{c.author_name}</span> {c.text}
                    </div>
                  </div>
                ))}
                <div className="p-comment-input-row">
                  <input className="p-comment-input" placeholder={t.writeComment}
                    value={cpFeedCommentTexts[post.id] || ''}
                    onChange={e => setCpFeedCommentTexts(prev => ({ ...prev, [post.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && sendComment()} />
                  <button className="p-send-btn" onClick={sendComment}>{t.send}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Event activity feed items — upcoming events only (not expired) */}
      {offset === 0 && feedEvents.filter(ev => new Date(ev.date) > new Date()).slice(0, 2).map((ev, idx) => {
        const item = { id: `ea${idx}`, event: ev, verb: idx === 0 ? 'going' : 'created',
          actor: ev.going?.[0] || ev.organizer,
          time: { da: 'For nylig', en: 'Recently' } }
        return item
      }).map(item => {
        const title = typeof item.event.title === 'string' ? item.event.title : (item.event.title[lang] || item.event.title.da)
        const loc = typeof item.event.location === 'string' ? item.event.location : (item.event.location[lang] || item.event.location.da)
        const action = item.verb === 'going' ? t.eventFeedRsvpd : t.eventFeedCreated
        return (
          <div key={item.id} className="p-card p-post p-event-feed-card" style={{ cursor: 'pointer' }} onClick={() => setFeedSelectedEvent(item.event)}>
            <div className="p-post-header">
              <div className="p-avatar-sm" style={{ background: nameToColor(item.actor) }}>{getInitials(item.actor)}</div>
              <div>
                <div className="p-post-author">{item.actor} <span style={{ fontWeight: 400, color: '#888' }}>{action}</span></div>
                <div className="p-post-time">{item.time[lang]}</div>
              </div>
              <span className="p-event-type-badge" style={{ marginLeft: 'auto' }}>{t.eventFeedLabel}</span>
            </div>
            <div className="p-event-feed-body" style={{ alignItems: 'flex-start' }}>
              <div className="p-event-date-col" style={{ minWidth: 54, flexDirection: 'row', alignItems: 'baseline', gap: 3, padding: '6px 8px' }}>
                <span className="p-event-day" style={{ fontSize: 17, lineHeight: 1 }}>{new Date(item.event.date).getDate()}</span>
                <span className="p-event-month">{new Date(item.event.date).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { month: 'short' }).toUpperCase()}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 13, color: '#777' }}>📍 {loc}</div>
                <div style={{ fontSize: 12, color: '#aaa', marginTop: 2, marginBottom: 10 }}>
                  ✅ {item.event.going.length} {t.eventAttendees}
                </div>
                <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  {[
                    { key: 'going', icon: '✅', label: t.eventGoing },
                    { key: 'maybe', icon: '❓', label: t.eventMaybe },
                    { key: 'notGoing', icon: '❌', label: t.eventNotGoing },
                  ].map(({ key, icon, label }) => {
                    const isActive = feedRsvpMap[item.event.id] === key
                    return (
                      <button key={key} onClick={() => handleFeedRsvp(item.event.id, key)} title={label}
                        style={{ background: isActive ? '#2D6A4F' : '#f0f0f0', color: isActive ? '#fff' : '#777', border: `1.5px solid ${isActive ? '#2D6A4F' : '#e0e0e0'}`, borderRadius: 6, fontSize: 11, padding: '3px 8px', cursor: 'pointer', fontWeight: isActive ? 700 : 400, transition: 'all 0.12s' }}>
                        {icon} {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Dynamic group suggestion card — shown on first page when suggestions exist */}
      {offset === 0 && (() => {
        const visible = groupSuggestions.filter(g => !dismissedGroupIds.has(g.id) && !joinedGroupIds.has(g.id))
        if (!visible.length) return null
        return (
          <div className="p-card p-post" style={{ background: 'linear-gradient(135deg, #f0faf4 0%, #fff 100%)', border: '1.5px solid #d4edda' }}>
            <div className="p-post-header">
              <div className="p-avatar-sm" style={{ background: '#2D6A4F', fontSize: 13, fontWeight: 900, letterSpacing: '-0.5px', flexShrink: 0 }}>
                f
              </div>
              <div style={{ flex: 1 }}>
                <div className="p-post-author">fellis.eu</div>
                <div className="p-post-time">{t.groupSuggestionsSubtitle}</div>
              </div>
              <span style={{ fontSize: 11, color: '#2D6A4F', fontWeight: 700, background: '#d4edda', padding: '3px 8px', borderRadius: 20 }}>
                💡 {lang === 'da' ? 'Forslag' : 'Suggested'}
              </span>
            </div>
            <div style={{ marginTop: 10 }}>
              {visible.slice(0, 3).map((group, idx) => (
                <div key={group.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: idx > 0 ? '1px solid #eef5f0' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>
                      👥 {group.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {Number(group.shared_members) > 0 ? t.groupSuggestionFriendsBased : t.groupSuggestionPopular}
                      {' · '}
                      {group.member_count} {Number(group.member_count) === 1 ? t.groupMember : t.groupMembers}
                    </div>
                    {(lang === 'da' ? group.description_da : group.description_en) && (
                      <div style={{ fontSize: 12, color: '#555', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lang === 'da' ? group.description_da : group.description_en}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setDismissedGroupIds(prev => new Set([...prev, group.id]))}
                      style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, fontSize: 12, padding: '5px 10px', cursor: 'pointer', color: '#888' }}
                    >
                      {t.groupSuggestionDismiss}
                    </button>
                    <button
                      onClick={() => handleJoinGroup(group.id)}
                      style={{ background: '#2D6A4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '5px 12px', cursor: 'pointer' }}
                    >
                      {t.groupJoin}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Posts — max PAGE_SIZE in DOM */}
      {posts.filter(post => !hiddenPosts.has(post.id)).map(post => {
        const liked = likedPosts.has(post.id)
        const showComments = expandedComments.has(post.id)
        const isOwn = post.author === currentUser.name
        const menuOpen = postMenu === post.id
        return (
          <div key={post.id} className="p-card p-post">
            <div className="p-post-header">
              <div
                className="p-avatar-sm"
                style={{ background: nameToColor(post.author), cursor: 'pointer' }}
                onClick={() => isOwn ? onViewOwnProfile?.() : (post.authorId && onViewProfile?.(post.authorId))}
              >
                {getInitials(post.author)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    className="p-post-author"
                    style={{ cursor: 'pointer' }}
                    onClick={() => isOwn ? onViewOwnProfile?.() : (post.authorId && onViewProfile?.(post.authorId))}
                  >{post.author}</div>
                  {(() => {
                    const relType = !isOwn && post.authorId && rels[String(post.authorId)]
                    // Use server-supplied isFamily if local rels don't reflect it yet
                    const effectiveRelType = relType || (!isOwn && post.isFamily ? 'family' : null)
                    if (!effectiveRelType) return null
                    if (mode === 'business' && effectiveRelType === 'family') return null
                    const label = { family: t.relFamily, colleague: t.relColleague, close: t.relCloseFriend, neighbor: t.relNeighbor }[effectiveRelType]
                    if (!label) return null
                    const color = mode === 'business'
                      ? { colleague: '#1877F2', close: '#2D6A4F', neighbor: '#7C6F64' }[effectiveRelType] || '#888'
                      : { family: '#E07B39', colleague: '#1877F2', close: '#2D6A4F', neighbor: '#7C6F64' }[effectiveRelType] || '#888'
                    return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: color + '18', color, letterSpacing: '0.02em', flexShrink: 0 }}>{label}</span>
                  })()}
                </div>
                <div className="p-post-time">{post.time[lang]}</div>
              </div>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setPostMenu(p => p === post.id ? null : post.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 18, lineHeight: 1, padding: '0 4px', borderRadius: 4 }}
                  title={lang === 'da' ? 'Valgmuligheder' : 'Options'}
                >···</button>
                {menuOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setPostMenu(null)} />
                    <div style={{ position: 'absolute', right: 0, top: '110%', background: '#fff', border: '1px solid #E8E4DF', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 180, overflow: 'hidden' }}>
                      {isOwn ? (
                        <>
                          {(() => {
                            const canEdit = post.createdAtRaw
                              ? (Date.now() - new Date(post.createdAtRaw).getTime() < 60 * 60 * 1000)
                              : false
                            return canEdit ? (
                              <button className="p-post-menu-item" onClick={() => handleStartEditPost(post)}>
                                ✏️ {lang === 'da' ? 'Rediger opslag' : 'Edit post'}
                              </button>
                            ) : null
                          })()}
                          <button className="p-post-menu-item danger" onClick={() => handleDeletePost(post.id)}>
                            🗑️ {lang === 'da' ? 'Slet opslag' : 'Delete post'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="p-post-menu-item" onClick={() => handleHidePost(post.id)}>
                            🙈 {lang === 'da' ? 'Skjul opslag' : 'Hide post'}
                          </button>
                          {post.authorId && (
                            <button className="p-post-menu-item danger" onClick={() => handleUnfriendFromPost(post)}>
                              👋 {lang === 'da' ? `Ophæv venskab med ${post.author.split(' ')[0]}` : `Unfriend ${post.author.split(' ')[0]}`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            {editingPostId === post.id ? (
              <div style={{ marginTop: 8 }}>
                <textarea
                  value={editPostText}
                  onChange={e => setEditPostText(e.target.value)}
                  style={{ width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: 8, border: '1px solid #2D6A4F', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => handleSaveEditPost(post.id)} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    {lang === 'da' ? 'Gem' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingPostId(null); setEditPostText('') }} style={{ padding: '7px 18px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', color: '#444', cursor: 'pointer', fontSize: 13 }}>
                    {lang === 'da' ? 'Annuller' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <PostText text={post.text} lang={lang} />
                {post.edited && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{lang === 'da' ? '(redigeret)' : '(edited)'}</div>}
              </>
            )}
            {post.media && <PostMedia media={post.media} />}
            <div className="p-post-stats">
              <span className="p-reaction-summary" onClick={() => openLikersModal(post.id)} style={{ cursor: 'pointer' }}>
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
                  onClick={() => {
                    if (!expandedComments.has(post.id)) toggleComments(post.id)
                    liked ? toggleLike(post.id) : setLikePopup(p => p === post.id ? null : post.id)
                  }}
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
                      <button className="p-share-option" onClick={() => handleCopyLink(post)} style={copyLinkDone === post.id ? { color: '#2D6A4F', fontWeight: 700 } : {}}>
                        {copyLinkDone === post.id ? `✅ ${lang === 'da' ? 'Kopieret!' : 'Copied!'}` : `🔗 ${lang === 'da' ? 'Kopiér link' : 'Copy link'}`}
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
              {mode === 'business' && post.author === currentUser.name && (
                <button className="p-action-btn p-action-btn-insights" onClick={() => setInsightsPostId(p => p === post.id ? null : post.id)}>
                  📊 {t.analyticsPostInsights}
                </button>
              )}
            </div>
            {insightsPostId === post.id && mode === 'business' && (
              <PostInsightsPanel t={t} post={post} onClose={() => setInsightsPostId(null)} />
            )}
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

      {/* Feed event detail modal */}
      {feedSelectedEvent && (() => {
        const getT = (e) => typeof e.title === 'string' ? e.title : (e.title?.[lang] || e.title?.da || '')
        const getD = (e) => typeof e.description === 'string' ? e.description : (e.description?.[lang] || e.description?.da || '')
        const getL = (e) => typeof e.location === 'string' ? e.location : (e.location?.[lang] || e.location?.da || '')
        const fmtD = (iso) => new Date(iso).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        const evTypeLabel = (type) => ({ conference: t.eventTypeConference, webinar: t.eventTypeWebinar, workshop: t.eventTypeWorkshop, meetup: t.eventTypeMeetup })[type] || null
        return (
          <EventDetailModal
            event={feedSelectedEvent}
            t={t}
            lang={lang}
            mode={mode}
            myRsvp={feedRsvpMap[feedSelectedEvent.id]}
            extras={feedRsvpExtras[feedSelectedEvent.id] || {}}
            onRsvp={(s) => handleFeedRsvp(feedSelectedEvent.id, s)}
            onExtrasChange={(ex) => setFeedRsvpExtras(prev => ({ ...prev, [feedSelectedEvent.id]: ex }))}
            onClose={() => setFeedSelectedEvent(null)}
            getTitle={getT}
            getDesc={getD}
            getLocation={getL}
            formatDate={fmtD}
            eventTypeLabel={evTypeLabel}
          />
        )
      })()}
    </div>
  )
}

// ── Profile mock photos (FB import + local) ──
const MOCK_FB_PHOTOS = [
  { id: 1, source: 'facebook', caption: { da: 'Sommerferie på Bornholm', en: 'Summer holiday on Bornholm' }, color: '#4ECDC4' },
  { id: 2, source: 'facebook', caption: { da: 'Designkonference 2025', en: 'Design conference 2025' }, color: '#FF6B6B' },
  { id: 3, source: 'facebook', caption: { da: 'Nyt kontor — første dag!', en: 'New office — first day!' }, color: '#FFD166' },
  { id: 4, source: 'facebook', caption: { da: 'Påskefrokost med familien', en: 'Easter lunch with the family' }, color: '#95E1D3' },
  { id: 5, source: 'facebook', caption: { da: 'Kvindernes internationale kampdag', en: "International Women's Day" }, color: '#F38181' },
  { id: 6, source: 'facebook', caption: { da: 'Valentinsdag ❤️', en: 'Valentine\'s Day ❤️' }, color: '#FCE38A' },
  { id: 7, source: 'fellis', caption: { da: 'Mit designprojekt', en: 'My design project' }, color: '#EAFFD0' },
  { id: 8, source: 'fellis', caption: { da: 'Vinter i København', en: 'Winter in Copenhagen' }, color: '#C4F1F9' },
  { id: 9, source: 'facebook', caption: { da: 'Juleaften 🎄', en: 'Christmas Eve 🎄' }, color: '#A29BFE' },
]

// ── Profile (clean — read-only view) ──
function ProfilePage({ lang, t, currentUser, mode, plan, onUserUpdate, onNavigate }) {
  const [profile, setProfile] = useState({ ...currentUser })
  const [userPosts, setUserPosts] = useState([])
  const [familyGroups, setFamilyGroups] = useState([])
  const [familyFriends, setFamilyFriends] = useState([])
  const [profileTab, setProfileTab] = useState('about')
  const [myCompanies, setMyCompanies] = useState([])
  const [interests, setInterests] = useState([])
  const [interestsSaving, setInterestsSaving] = useState(false)
  const [interestsSavedMsg, setInterestsSavedMsg] = useState('')
  const [parachordEnabled, setParachordEnabled] = useState(() => localStorage.getItem('fellis_parachord_enabled') !== 'false')
  const [profilePublic, setProfilePublic] = useState(false)
  const [profilePublicSaving, setProfilePublicSaving] = useState(false)
  const { rels } = useContactRelationships()

  const handleParachordToggle = () => {
    const next = !parachordEnabled
    setParachordEnabled(next)
    localStorage.setItem('fellis_parachord_enabled', next ? 'true' : 'false')
  }

  useEffect(() => {
    apiFetchProfile().then(data => {
      if (data) {
        setProfile(data)
        if (data.interests?.length) setInterests(data.interests)
        if (data.profile_public !== undefined) setProfilePublic(!!data.profile_public)
        if (data.avatar_url || data.avatarUrl) {
          onUserUpdate(prev => ({ ...prev, avatar_url: data.avatarUrl || data.avatar_url }))
        }
      }
    })
    apiFetchFeed(0, 100).then(data => {
      const posts = data?.posts || data || []
      setUserPosts(posts.filter(p => p.author === currentUser.name))
    })
    if (mode === 'privat') {
      apiFetchConversations().then(convs => {
        if (convs) setFamilyGroups(convs.filter(c => c.isFamilyGroup))
      })
      apiFetchFriends().then(data => {
        if (data) setFamilyFriends((data.friends || data || []).filter(f => rels[String(f.id)] === 'family'))
      })
    }
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setMyCompanies((data.companies || []).filter(c => c.member_role === 'owner')))
      .catch(() => {})
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <h2 className="p-profile-name" style={{ margin: 0 }}>{profile.name}</h2>
            {mode === 'business' && <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: plan === 'business_pro' ? '#2D6A4F' : '#F0FAF4',
              color: plan === 'business_pro' ? '#fff' : '#2D6A4F',
              border: plan === 'business_pro' ? 'none' : '1px solid #2D6A4F',
              flexShrink: 0,
            }}>
              {plan === 'business_pro' ? 'Business Pro ⚡' : 'Business'}
            </span>}
          </div>
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

      {/* Profile tabs */}
      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`p-filter-tab${profileTab === 'about' ? ' active' : ''}`} onClick={() => setProfileTab('about')}>{t.profileTabAbout}</button>
        <button className={`p-filter-tab${profileTab === 'posts' ? ' active' : ''}`} onClick={() => setProfileTab('posts')}>{t.profileTabPosts}{userPosts.length > 0 ? ` (${userPosts.length})` : ''}</button>
        <button className={`p-filter-tab${profileTab === 'photos' ? ' active' : ''}`} onClick={() => setProfileTab('photos')}>{t.profileTabPhotos} ({MOCK_FB_PHOTOS.length})</button>
      </div>

      {/* About tab */}
      {profileTab === 'about' && (<>

        {/* Interests card */}
        <div className="p-card p-login-info-card" style={{ marginBottom: 16 }}>
          <h3 className="p-section-title">🎯 {t.interestsSectionTitle}</h3>
          {interests.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {interests.map(id => {
                const cat = INTEREST_CATEGORIES.find(c => c.id === id)
                return cat ? (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, fontSize: 13, background: '#F0FAF4', color: '#2D6A4F', border: '2px solid #2D6A4F', fontWeight: 600 }}>
                    <span>{cat.icon}</span><span>{cat[lang] || cat.da}</span>
                  </span>
                ) : null
              })}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>{lang === 'da' ? 'Ingen interesser valgt endnu.' : 'No interests selected yet.'}</p>
          )}
          <button onClick={() => onNavigate('edit-profile')} style={{ marginTop: 12, padding: '6px 16px', borderRadius: 8, border: '1px solid #2D6A4F', background: '#fff', color: '#2D6A4F', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            ✏️ {lang === 'da' ? 'Rediger interesser' : 'Edit interests'}
          </button>
        </div>

        <div className="p-card p-login-info-card" style={{ marginBottom: 16 }}>
          <h3 className="p-section-title">🌐 {t.referralDashPublicProfile}</h3>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{t.referralDashPublicProfileDesc}</p>
          <div className="p-login-info-row" style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
            <span className="p-login-info-label" style={{ flex: 1 }}>
              {profilePublic ? `✅ ${t.referralDashPublicOn}` : `🔒 ${t.referralDashPublicOff}`}
            </span>
            <button
              onClick={async () => {
                if (profilePublicSaving) return
                setProfilePublicSaving(true)
                const next = !profilePublic
                const res = await apiToggleProfilePublic(next)
                if (res?.ok !== false) setProfilePublic(next)
                setProfilePublicSaving(false)
              }}
              style={{
                position: 'relative', width: 40, height: 22, borderRadius: 11,
                background: profilePublic ? '#52B788' : '#ccc',
                border: 'none', cursor: profilePublicSaving ? 'wait' : 'pointer', flexShrink: 0,
                transition: 'background 0.2s',
              }}
              title={t.referralDashPublicProfile}
            >
              <span style={{
                position: 'absolute', top: 3, left: profilePublic ? 20 : 3,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </button>
          </div>
          {profilePublic && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0faf5', borderRadius: 8, fontSize: 12, color: '#40916C' }}>
              🔗 {lang === 'da' ? 'Din offentlige profil: ' : 'Your public profile: '}
              <strong>{window.location.origin}/profil/{(profile.handle || '').replace('@', '')}</strong>
            </div>
          )}
        </div>

        <div className="p-card p-login-info-card" style={{ marginBottom: 16 }}>
          <h3 className="p-section-title">🎵 {t.parachordSettingsTitle}</h3>
          <div className="p-login-info">
            <div className="p-login-info-row" style={{ alignItems: 'center' }}>
              <span className="p-login-info-label" style={{ flex: 1 }}>{t.parachordToggleLabel}</span>
              <button
                onClick={handleParachordToggle}
                style={{
                  position: 'relative', width: 40, height: 22, borderRadius: 11,
                  background: parachordEnabled ? '#52B788' : '#ccc',
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                  transition: 'background 0.2s',
                }}
                title={t.parachordToggleLabel}
              >
                <span style={{
                  position: 'absolute', top: 3, left: parachordEnabled ? 20 : 3,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>
          </div>
        </div>

        {mode === 'privat' && (
          <div className="p-card p-family-section" style={{ marginBottom: 16 }}>
            <h3 className="p-section-title" style={{ margin: '0 0 4px' }}>🏡 {t.familySection}</h3>
            <p className="p-family-section-desc">{t.familySectionDesc}</p>
            {familyFriends.length === 0 && familyGroups.length === 0 ? (
              <div className="p-family-empty">{lang === 'da' ? 'Ingen familiemedlemmer endnu. Mærk venner som Familie i din venneliste.' : 'No family members yet. Tag friends as Family in your friends list.'}</div>
            ) : (
              <>
                {familyFriends.length > 0 && (
                  <div style={{ marginBottom: familyGroups.length > 0 ? 12 : 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      {lang === 'da' ? 'Familiemedlemmer' : 'Family members'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {familyFriends.map(f => {
                        const friendAvatarSrc = f.avatarUrl || f.avatar_url
                          ? (f.avatarUrl || f.avatar_url).startsWith('http') ? (f.avatarUrl || f.avatar_url) : `${API_BASE}${f.avatarUrl || f.avatar_url}`
                          : null
                        return (
                          <div key={f.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56 }}>
                            {friendAvatarSrc ? (
                              <img src={friendAvatarSrc} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e8f5e9' }} />
                            ) : (
                              <div style={{ width: 44, height: 44, borderRadius: '50%', background: nameToColor(f.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', border: '2px solid #e8f5e9' }}>
                                {getInitials(f.name)}
                              </div>
                            )}
                            <span style={{ fontSize: 11, color: '#444', textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name.split(' ')[0]}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {familyGroups.length > 0 && (
                  <div>
                    {familyFriends.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 8px' }}>{lang === 'da' ? 'Familiegrupper' : 'Family groups'}</div>}
                    {familyGroups.map(g => (
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
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {myCompanies.length > 0 && (
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
            {myCompanies.map(c => (
              <div key={c.id} className="p-company-mini-card" onClick={() => onNavigate?.('company', { companyId: c.id })}>
                <div className="p-company-logo-sm" style={{ background: c.color }}>{c.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{c.industry} · {(c.followers_count || 0)} {t.companyFollowers}</div>
                </div>
                <span className="p-company-role-badge">{t.companyRoleOwner}</span>
              </div>
            ))}
          </div>
        )}
      </>)}

      {/* Posts tab */}
      {profileTab === 'posts' && (
        userPosts.length === 0
          ? <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>📭 {lang === 'da' ? 'Ingen opslag endnu' : 'No posts yet'}</div>
          : userPosts.map(post => (
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
          ))
      )}

      {/* Photos tab */}
      {profileTab === 'photos' && (
        <div className="p-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 className="p-section-title" style={{ margin: 0 }}>{t.profileTabPhotos}</h3>
            <span style={{ fontSize: 12, color: '#888' }}>
              {t.profilePhotosFacebook}: {MOCK_FB_PHOTOS.filter(p => p.source === 'facebook').length}
            </span>
          </div>
          {MOCK_FB_PHOTOS.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: '40px 0' }}>{t.profileNoPhotos}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {MOCK_FB_PHOTOS.map(photo => (
                <div key={photo.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: photo.color, cursor: 'pointer', minHeight: 90 }}>
                  {photo.source === 'facebook' && (
                    <div style={{ position: 'absolute', top: 4, left: 4, background: '#1877F2', color: '#fff', borderRadius: 4, fontSize: 10, padding: '1px 5px', fontWeight: 700, lineHeight: 1.4 }}>f</div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 10, padding: '4px 6px', lineHeight: 1.3 }}>
                    {photo.caption[lang]}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Edit Profile ──
function EditProfilePage({ lang, t, currentUser, mode, onUserUpdate, onNavigate }) {
  const [profile, setProfile] = useState({ ...currentUser })
  const avatarInputRef = useRef(null)
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState(null)
  const [currentPwdError, setCurrentPwdError] = useState(null)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  // Interests state
  const [interests, setInterests] = useState([])
  const [interestsSaving, setInterestsSaving] = useState(false)
  const [interestsSavedMsg, setInterestsSavedMsg] = useState('')
  const [birthday, setBirthday] = useState(currentUser.birthday || '')
  const [birthdaySaveStatus, setBirthdaySaveStatus] = useState(null) // null | 'saving' | 'saved' | 'error'

  useEffect(() => {
    apiFetchProfile().then(data => {
      if (data) {
        setProfile(data)
        if (data.interests?.length) setInterests(data.interests)
        setBirthday(data.birthday || '')
      }
    })
  }, [])

  const handleSaveBirthday = async () => {
    setBirthdaySaveStatus('saving')
    const val = birthday.trim() || null
    const res = await apiUpdateBirthday(val)
    if (res?.ok) {
      setBirthdaySaveStatus('saved')
      setTimeout(() => setBirthdaySaveStatus(null), 2000)
    } else {
      setBirthdaySaveStatus('error')
    }
  }

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

  const hasPassword = !!profile?.hasPassword

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (hasPassword && !currentPassword) {
      setCurrentPwdError(lang === 'da' ? 'Indtast din nuværende adgangskode' : 'Enter your current password')
      return
    }
    if (!newPassword || !confirmPassword) return
    if (newPassword !== confirmPassword) return // inline match indicator already shows the error
    setPasswordLoading(true); setPasswordMsg(null); setCurrentPwdError(null)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(hasPassword ? { currentPassword } : {}), newPassword, lang }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          setCurrentPwdError(lang === 'da' ? 'Forkert adgangskode' : 'Wrong password')
        } else {
          setPasswordMsg({ ok: false, text: data.error })
        }
        return
      }
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setCurrentPwdError(null)
      setPasswordMsg({ ok: true, text: t.settingsSaved })
    } catch { setPasswordMsg({ ok: false, text: lang === 'da' ? 'Netværksfejl' : 'Network error' }) }
    finally { setPasswordLoading(false) }
  }

  const editT = lang === 'da' ? {
    title: 'Rediger profil',
    avatarLabel: 'Profilbillede',
    avatarBtn: 'Skift billede',
    nameLabel: 'Navn',
    bioLabel: 'Bio',
    locationLabel: 'Lokation',
    back: 'Tilbage til profil',
    skillsSection: 'Kompetencer',
    passwordTitle: hasPassword ? 'Skift adgangskode' : 'Opret adgangskode',
    passwordNote: 'Opret din fellis-adgangskode for at logge ind næste gang.',
    currentPwd: 'Nuværende adgangskode',
    newPwd: hasPassword ? 'Ny adgangskode' : 'Adgangskode',
    confirmPwd: 'Bekræft adgangskode',
    savePwd: hasPassword ? 'Gem adgangskode' : 'Opret adgangskode',
  } : {
    title: 'Edit profile',
    avatarLabel: 'Profile picture',
    avatarBtn: 'Change picture',
    nameLabel: 'Name',
    bioLabel: 'Bio',
    locationLabel: 'Location',
    back: 'Back to profile',
    skillsSection: 'Skills',
    passwordTitle: hasPassword ? 'Change password' : 'Create password',
    passwordNote: 'Create your fellis password to log in next time.',
    currentPwd: 'Current password',
    newPwd: hasPassword ? 'New password' : 'Password',
    confirmPwd: 'Confirm password',
    savePwd: hasPassword ? 'Save password' : 'Create password',
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

        {/* Birthday */}
        <label style={labelStyle}>{t.birthdayLabel}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...fieldStyle, flex: 1 }}
            type="date"
            value={birthday}
            onChange={e => { setBirthday(e.target.value); setBirthdaySaveStatus(null) }}
            max={new Date().toISOString().slice(0, 10)}
          />
          <button
            type="button"
            onClick={handleSaveBirthday}
            disabled={birthdaySaveStatus === 'saving'}
            style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: birthdaySaveStatus === 'saved' ? '#40916C' : '#2D6A4F', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {birthdaySaveStatus === 'saving' ? '…' : birthdaySaveStatus === 'saved' ? t.birthdaySaved : t.birthdaySave}
          </button>
          {birthday && (
            <button
              type="button"
              onClick={() => { setBirthday(''); setBirthdaySaveStatus(null) }}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', background: 'none', fontSize: 13, cursor: 'pointer', color: '#888' }}
              title={t.birthdayClear}
            >✕</button>
          )}
        </div>

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

        {/* Skills management */}
        {mode === 'business' && (
          <div style={{ margin: '28px 0 0', borderTop: '2px solid #eee', paddingTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#2D6A4F', marginBottom: 12 }}>🏅 {editT.skillsSection}</div>
            <SkillsSection profile={profile} t={t} lang={lang} isOwn={true} />
          </div>
        )}

        {/* Password change section */}
        <div style={{ marginTop: 28, borderTop: '2px solid #eee', paddingTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 12 }}>🔑 {editT.passwordTitle}</div>
          <form onSubmit={handleChangePassword}>
              {!hasPassword && (
                <p style={{ margin: '0 0 12px', fontSize: 13, color: '#888', background: '#F9F9F9', borderRadius: 8, padding: '10px 12px' }}>
                  {editT.passwordNote}
                </p>
              )}
              {hasPassword && (<>
                <label style={labelStyle}>{editT.currentPwd}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...fieldStyle, paddingRight: 44, borderColor: currentPwdError ? '#c0392b' : undefined }}
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => { setCurrentPassword(e.target.value); if (currentPwdError) setCurrentPwdError(null) }}
                    onBlur={() => { if (!currentPassword) setCurrentPwdError(lang === 'da' ? 'Påkrævet' : 'Required') }}
                    required
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowCurrent(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>{showCurrent ? '🙈' : '👁️'}</button>
                </div>
                {currentPwdError && <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#c0392b' }}>✗ {currentPwdError}</div>}
              </>)}
              <label style={labelStyle}>{editT.newPwd}</label>
              <div style={{ position: 'relative' }}>
                <input style={{ ...fieldStyle, paddingRight: 44 }} type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="••••••••" />
                <button type="button" onClick={() => setShowNew(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>{showNew ? '🙈' : '👁️'}</button>
              </div>
              <PasswordStrengthIndicator password={newPassword} lang={lang} />
              <label style={labelStyle}>{editT.confirmPwd}</label>
              <div style={{ position: 'relative' }}>
                <input style={{ ...fieldStyle, paddingRight: 44 }} type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required placeholder="••••••••" />
                <button type="button" onClick={() => setShowConfirm(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>{showConfirm ? '🙈' : '👁️'}</button>
              </div>
              {confirmPassword.length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: newPassword === confirmPassword ? '#2D6A4F' : '#c0392b' }}>
                  <span style={{ fontSize: 13 }}>{newPassword === confirmPassword ? '✓' : '✗'}</span>
                  <span>{lang === 'da' ? (newPassword === confirmPassword ? 'Adgangskoderne stemmer overens' : 'Adgangskoderne stemmer ikke overens') : (newPassword === confirmPassword ? 'Passwords match' : 'Passwords do not match')}</span>
                </div>
              )}
              {passwordMsg && <div style={{ marginTop: 8, fontSize: 13, color: passwordMsg.ok ? '#2D6A4F' : '#c0392b', fontWeight: 600 }}>{passwordMsg.ok ? '✓' : '✗'} {passwordMsg.text}</div>}
              <button type="submit" disabled={passwordLoading} style={{ marginTop: 12, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: passwordLoading ? 0.7 : 1 }}>
                {editT.savePwd}
              </button>
            </form>
        </div>

        {/* Interests picker */}
        <div className="p-card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>🎯 {t.interestsSectionTitle}</h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>{t.interestsSectionDesc}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {INTEREST_CATEGORIES.map(cat => {
              const selected = interests.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setInterestsSavedMsg(''); setInterests(prev => selected ? prev.filter(i => i !== cat.id) : [...prev, cat.id]) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                    border: selected ? '2px solid #2D6A4F' : '2px solid #ddd',
                    background: selected ? '#F0FAF4' : '#fafafa',
                    color: selected ? '#2D6A4F' : '#555', fontWeight: selected ? 700 : 400,
                  }}
                >
                  <span>{cat.icon}</span><span>{cat[lang] || cat.da}</span>
                </button>
              )
            })}
          </div>
          {interestsSavedMsg ? (
            <div style={{ fontSize: 13, color: '#2D6A4F', fontWeight: 600, marginBottom: 4 }}>{interestsSavedMsg}</div>
          ) : interests.length < 3 ? (
            <div style={{ fontSize: 12, color: '#e53935', marginBottom: 4 }}>{t.interestsMin3}</div>
          ) : null}
          <button
            type="button"
            disabled={interestsSaving || interests.length < 3}
            onClick={async () => {
              setInterestsSaving(true)
              setInterestsSavedMsg('')
              const res = await apiUpdateInterests(interests)
              setInterestsSaving(false)
              if (res?.ok) { setInterestsSavedMsg(t.interestsSaved); setTimeout(() => setInterestsSavedMsg(''), 3000) }
            }}
            style={{ padding: '7px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: interests.length >= 3 ? '#2D6A4F' : '#ccc', color: '#fff', border: 'none', cursor: interests.length >= 3 ? 'pointer' : 'not-allowed' }}
          >
            {interestsSaving ? '...' : t.interestsSave}
          </button>
        </div>

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

// ── Settings Page ─────────────────────────────────────────────────────────────
function SettingsPage({ lang, t, currentUser, mode, onUserUpdate, onNavigate, onLogout, onOpenModeModal, darkMode, onToggleDark }) {
  const [tab, setTab] = useState('konto')

  const fS = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lS = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 14 }
  const tabLabels = { konto: t.settingsKonto, privatliv: t.settingsPrivatliv, sessions: t.settingsSessions, sprog: t.settingsSprog }

  return (
    <div className="p-events" style={{ maxWidth: 600 }}>
      <h2 className="p-section-title" style={{ margin: '0 0 16px' }}>⚙️ {t.settings}</h2>
      <div className="p-filter-tabs" style={{ marginBottom: 20 }}>
        {Object.entries(tabLabels).map(([key, label]) => (
          <button key={key} className={`p-filter-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'konto' && <SettingsKonto lang={lang} t={t} currentUser={currentUser} mode={mode} fS={fS} lS={lS} onNavigate={onNavigate} onOpenModeModal={onOpenModeModal} />}
      {tab === 'privatliv' && <SettingsPrivatliv lang={lang} t={t} fS={fS} lS={lS} />}
      {tab === 'sessions' && <SettingsSessions lang={lang} t={t} onLogout={onLogout} />}
      {tab === 'sprog' && <SettingsSprog lang={lang} t={t} darkMode={darkMode} onToggleDark={onToggleDark} />}
    </div>
  )
}

function PasswordStrengthIndicator({ password, lang }) {
  const [policy, setPolicy] = useState(null)
  useEffect(() => {
    fetch('/api/auth/password-policy').then(r => r.ok ? r.json() : null).then(p => { if (p) setPolicy(p) }).catch(() => {})
  }, [])

  if (!password) return null

  const minLen = policy?.min_length || 8
  const checks = [
    { ok: password.length >= minLen, da: `Min. ${minLen} tegn`, en: `Min. ${minLen} characters` },
    ...(policy?.require_uppercase ? [{ ok: /[A-Z]/.test(password), da: 'Stort bogstav (A–Z)', en: 'Uppercase (A–Z)' }] : [{ ok: /[A-Z]/.test(password), da: 'Stort bogstav (A–Z)', en: 'Uppercase (A–Z)' }]),
    ...(policy?.require_lowercase !== false ? [{ ok: /[a-z]/.test(password), da: 'Lille bogstav (a–z)', en: 'Lowercase (a–z)' }] : []),
    ...(policy?.require_numbers !== false   ? [{ ok: /[0-9]/.test(password), da: 'Tal (0–9)', en: 'Number (0–9)' }] : []),
    ...(policy?.require_symbols ? [{ ok: /[^A-Za-z0-9]/.test(password), da: 'Specialtegn (!@#…)', en: 'Symbol (!@#…)' }] : []),
  ]

  const passed = checks.filter(c => c.ok).length
  const ratio = checks.length ? passed / checks.length : 0
  const barColor = ratio < 0.4 ? '#e74c3c' : ratio < 0.75 ? '#f39c12' : '#2D6A4F'
  const barLabel = ratio < 0.4
    ? (lang === 'da' ? 'Svag' : 'Weak')
    : ratio < 0.75
    ? (lang === 'da' ? 'Middel' : 'Fair')
    : (lang === 'da' ? 'Stærk' : 'Strong')

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#eee', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${ratio * 100}%`, background: barColor, borderRadius: 3, transition: 'width 0.25s, background 0.25s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: barColor, minWidth: 36 }}>{barLabel}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.ok ? '#2D6A4F' : '#999' }}>
            <span style={{ fontSize: 13, width: 16, textAlign: 'center', lineHeight: 1 }}>{c.ok ? '✓' : '○'}</span>
            <span>{lang === 'da' ? c.da : c.en}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsKonto({ lang, t, currentUser, mode, fS, lS, onNavigate, onOpenModeModal }) {
  const [profile, setProfile] = useState(null)
  const [newEmail, setNewEmail] = useState(currentUser?.email || '')
  const [emailPassword, setEmailPassword] = useState('')
  const [showEmailPw, setShowEmailPw] = useState(false)
  const [emailMsg, setEmailMsg] = useState(null)
  const [emailLoading, setEmailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/profile', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setProfile(data); setNewEmail(data.email || '') })
      .catch(() => {})
  }, [])

  const handleChangeEmail = async (e) => {
    e.preventDefault()
    if (!newEmail.trim() || !emailPassword) return
    setEmailLoading(true); setEmailMsg(null)
    try {
      const res = await fetch('/api/profile/email', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail: newEmail.trim(), password: emailPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setEmailMsg({ ok: false, text: data.error }); return }
      setEmailPassword('')
      setEmailMsg({ ok: true, text: t.settingsSaved })
    } catch { setEmailMsg({ ok: false, text: lang === 'da' ? 'Netværksfejl' : 'Network error' }) }
    finally { setEmailLoading(false) }
  }

  return (
    <div className="p-card" style={{ padding: 24 }}>
      {profile?.createdAt && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>
          {lang === 'da' ? 'Konto oprettet' : 'Account created'}: <strong style={{ color: '#444' }}>{new Date(profile.createdAt).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>
        </div>
      )}

      {/* Change email */}
      <form onSubmit={handleChangeEmail} style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 4 }}>{lang === 'da' ? 'E-mail' : 'Email'}</div>
        <label style={lS}>{lang === 'da' ? 'Ny e-mail' : 'New email'}</label>
        <input style={fS} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required />
        <label style={lS}>{t.settingsEmailConfirm}</label>
        <div style={{ position: 'relative' }}>
          <input style={{ ...fS, paddingRight: 44 }} type={showEmailPw ? 'text' : 'password'} value={emailPassword} onChange={e => setEmailPassword(e.target.value)} required placeholder="••••••••" />
          <button type="button" onClick={() => setShowEmailPw(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>{showEmailPw ? '🙈' : '👁️'}</button>
        </div>
        {emailMsg && <div style={{ marginTop: 8, fontSize: 13, color: emailMsg.ok ? '#2D6A4F' : '#c0392b', fontWeight: 600 }}>{emailMsg.ok ? '✓' : '✗'} {emailMsg.text}</div>}
        <button type="submit" disabled={emailLoading} style={{ marginTop: 12, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: emailLoading ? 0.7 : 1 }}>
          {t.settingsSaveEmail}
        </button>
      </form>

      {/* Password — link to Edit Profile */}
      <div style={{ borderTop: '1px solid #eee', paddingTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 8 }}>{lang === 'da' ? 'Adgangskode' : 'Password'}</div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          {lang === 'da'
            ? 'Skift adgangskode under din profilredigering.'
            : 'Change your password under profile editing.'}
        </div>
        <button
          onClick={() => onNavigate('edit-profile')}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #2D6A4F', background: '#fff', color: '#2D6A4F', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          ✏️ {lang === 'da' ? 'Gå til Rediger profil' : 'Go to Edit profile'}
        </button>
      </div>

      {/* Account type / mode switch */}
      <div style={{ borderTop: '1px solid #eee', paddingTop: 20, marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 4 }}>💼 {lang === 'da' ? 'Kontotype' : 'Account type'}</div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          {lang === 'da'
            ? `Nuværende kontotype: ${mode === 'business' ? 'Erhverv' : 'Privat'}. Skift for at tilpasse oplevelsen til dit behov.`
            : `Current account type: ${mode === 'business' ? 'Business' : 'Personal'}. Switch to tailor the experience to your needs.`}
        </div>
        <button
          onClick={onOpenModeModal}
          style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #2D6A4F', background: '#fff', color: '#2D6A4F', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          {t.modeSwitch}
        </button>
      </div>
    </div>
  )
}

function SettingsPrivatliv({ lang, t, fS, lS }) {
  const [profileVis, setProfileVis] = useState('all')
  const [friendReqPrivacy, setFriendReqPrivacy] = useState('all')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    fetch('/api/settings/privacy', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setProfileVis(data.profile_visibility || 'all'); setFriendReqPrivacy(data.friend_request_privacy || 'all'); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const save = async () => {
    setMsg(null)
    try {
      const res = await fetch('/api/settings/privacy', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_visibility: profileVis, friend_request_privacy: friendReqPrivacy }),
      })
      if (!res.ok) throw new Error()
      setMsg({ ok: true, text: t.settingsSaved })
    } catch { setMsg({ ok: false, text: lang === 'da' ? 'Fejl' : 'Error' }) }
  }

  if (loading) return <div className="p-card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>⏳</div>

  const radioStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', padding: '8px 0' }

  return (
    <div className="p-card" style={{ padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 12 }}>{t.settingsProfileVisibility}</div>
      {[['all', t.settingsVisAll], ['friends', t.settingsVisFriends]].map(([val, label]) => (
        <label key={val} style={radioStyle}>
          <input type="radio" name="pv" value={val} checked={profileVis === val} onChange={() => setProfileVis(val)} />
          {label}
        </label>
      ))}

      <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginTop: 20, marginBottom: 12 }}>{t.settingsFriendReqPrivacy}</div>
      {[['all', t.settingsReqAll], ['friends_of_friends', t.settingsReqFriends]].map(([val, label]) => (
        <label key={val} style={radioStyle}>
          <input type="radio" name="frp" value={val} checked={friendReqPrivacy === val} onChange={() => setFriendReqPrivacy(val)} />
          {label}
        </label>
      ))}

      {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.ok ? '#2D6A4F' : '#c0392b', fontWeight: 600 }}>{msg.ok ? '✓' : '✗'} {msg.text}</div>}
      <button onClick={save} style={{ marginTop: 20, padding: '9px 22px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        {lang === 'da' ? 'Gem indstillinger' : 'Save settings'}
      </button>
    </div>
  )
}

function SettingsSessions({ lang, t, onLogout }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch('/api/settings/sessions', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setSessions(data.sessions || []); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const deleteSession = (id) => {
    fetch(`/api/settings/sessions/${id}`, { method: 'DELETE', credentials: 'include' })
      .then(() => load())
      .catch(() => {})
  }

  const deleteOthers = () => {
    fetch('/api/settings/sessions/others', { method: 'DELETE', credentials: 'include' })
      .then(() => load())
      .catch(() => {})
  }

  const parseBrowserFromUA = (ua) => {
    if (!ua) return { browser: lang === 'da' ? 'Ukendt' : 'Unknown', os: '' }
    let browser = 'Other'
    if (/Edg\/|Edge\//.test(ua)) browser = 'Edge'
    else if (/OPR\/|Opera\//.test(ua)) browser = 'Opera'
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
    else if (/Firefox\//.test(ua)) browser = 'Firefox'
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'
    let os = ''
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
    else if (/Android/.test(ua)) os = 'Android'
    else if (/Windows/.test(ua)) os = 'Windows'
    else if (/Macintosh|Mac OS/.test(ua)) os = 'macOS'
    else if (/Linux/.test(ua)) os = 'Linux'
    return { browser, os }
  }

  const deviceIcon = (ua) => {
    if (/iPhone|iPad|iPod|Android/.test(ua || '')) return '📱'
    if (/Macintosh|Mac OS/.test(ua || '')) return '💻'
    return '🖥️'
  }

  const others = sessions.filter(s => !s.is_current)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {loading ? (
        <div className="p-card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>⏳</div>
      ) : sessions.map(s => {
        const { browser, os } = parseBrowserFromUA(s.user_agent)
        const createdDate = s.created_at ? new Date(s.created_at) : null
        const expiresDate = s.expires_at ? new Date(s.expires_at) : null
        const locale = lang === 'da' ? 'da-DK' : 'en-US'
        const fmtDate = (d) => d ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
        return (
        <div key={s.id} className="p-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>{deviceIcon(s.user_agent)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{browser}{os ? ` · ${os}` : ''}</span>
              {!!s.is_current && <span style={{ fontSize: 11, background: '#F0FAF4', color: '#2D6A4F', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>{t.settingsSessionsCurrent}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {s.ip_address && <span>🌐 {s.ip_address}</span>}
              {createdDate && <span>🕐 {lang === 'da' ? 'Oprettet' : 'Created'}: {fmtDate(createdDate)}</span>}
              {expiresDate && <span>⏳ {lang === 'da' ? 'Udløber' : 'Expires'}: {fmtDate(expiresDate)}</span>}
              {s.lang && <span>🗣️ {s.lang === 'da' ? 'Dansk' : 'English'}</span>}
            </div>
          </div>
          {!s.is_current && (
            <button onClick={() => deleteSession(s.id)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              {t.settingsSessionsLogoutOne}
            </button>
          )}
        </div>
        )
      })}
      {others.length > 0 && (
        <button onClick={deleteOthers} style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {t.settingsSessionsLogoutOthers}
        </button>
      )}
      {!loading && sessions.length === 0 && (
        <div className="p-card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>{t.settingsSessionsEmpty}</div>
      )}
    </div>
  )
}

function SettingsSprog({ lang, t, darkMode, onToggleDark }) {
  const switchLang = (newLang) => {
    fetch('/api/me/lang', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: newLang }),
    }).catch(() => {})
    // Reload to apply language change
    window.location.reload()
  }

  const radioStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', padding: '8px 0' }

  return (
    <div className="p-card" style={{ padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🌐 {t.settingsLanguage}</div>
      {[['da', '🇩🇰 Dansk'], ['en', '🇬🇧 English']].map(([val, label]) => (
        <label key={val} style={radioStyle}>
          <input type="radio" name="lang" value={val} checked={lang === val} onChange={() => { if (lang !== val) switchLang(val) }} />
          {label}
        </label>
      ))}

      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 24, marginBottom: 12 }}>🌙 {t.settingsDarkMode}</div>
      <div className="dark-mode-toggle" onClick={onToggleDark}>
        <div className={`dark-mode-toggle-track${darkMode ? ' on' : ''}`}>
          <div className="dark-mode-toggle-thumb" />
        </div>
        <span style={{ fontSize: 14 }}>{darkMode ? (lang === 'da' ? 'Aktiveret' : 'Enabled') : (lang === 'da' ? 'Deaktiveret' : 'Disabled')}</span>
      </div>
    </div>
  )
}

// ── Visitor Statistics Page ─────────────────────────────────────────────────
const COUNTRY_CENTROIDS = {
  'DK':[56.3,9.5],'DE':[51.2,10.5],'US':[37.1,-95.7],'GB':[55.4,-3.4],
  'FR':[46.2,2.2],'SE':[62.0,15.0],'NO':[65.0,13.0],'FI':[64.0,26.0],
  'NL':[52.3,5.3],'PL':[51.9,19.1],'IT':[41.9,12.6],'ES':[40.5,-3.7],
  'JP':[36.2,138.3],'CN':[35.9,104.2],'AU':[-25.3,133.8],'BR':[-14.2,-51.9],
  'IN':[20.6,78.9],'RU':[61.5,105.3],'CA':[56.1,-106.4],'MX':[23.6,-102.6],
  'AR':[-38.4,-63.6],'ZA':[-30.6,22.9],'EG':[26.8,30.8],'NG':[9.1,8.7],
  'KR':[35.9,127.8],'SG':[1.3,103.8],'AE':[23.4,53.8],'TR':[38.9,35.2],
  'SA':[23.9,45.1],'ID':[-0.8,113.9],'TH':[15.9,100.9],'PH':[12.9,121.8],
  'UA':[48.4,31.2],'PT':[39.4,-8.2],'BE':[50.5,4.5],'CH':[46.8,8.2],
  'AT':[47.5,14.6],'CZ':[49.8,15.5],'HU':[47.2,19.5],'RO':[45.9,24.9],
  'GR':[39.1,21.8],'IL':[31.5,34.8],'PK':[30.4,69.3],'BD':[23.7,90.4],
  'VN':[14.1,108.3],'MY':[4.2,101.9],'NZ':[-40.9,172.7],'IR':[32.4,53.7],
  'IQ':[33.2,43.7],'KE':[-0.0,37.9],'MA':[31.8,-7.1],'TN':[34.0,9.0],
  'SK':[48.7,19.7],'HR':[45.1,15.2],'RS':[44.0,21.0],'BG':[42.7,25.5],
}

function MiniWorldMap({ countries }) {
  const W = 800, H = 380
  const toXY = (lat, lng) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H]
  const maxCount = Math.max(1, ...countries.map(c => c.count))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', borderRadius: 10, border: '1px solid #E8E4DF' }}>
      <rect width={W} height={H} fill="#C8DFF4" />
      <g fill="#D4E6B5" stroke="#B5C99A" strokeWidth="0.6">
        <path d="M80,58 L120,38 L180,33 L240,48 L270,78 L262,128 L242,160 L222,190 L200,220 L178,240 L158,230 L138,210 L128,180 L98,158 L78,138 L68,108 Z" />
        <path d="M148,222 L180,210 L212,222 L232,252 L242,292 L232,332 L210,372 L190,384 L168,370 L154,338 L138,298 L138,258 Z" />
        <path d="M338,58 L382,48 L422,54 L442,80 L432,112 L410,122 L388,116 L368,112 L348,120 L338,110 L328,90 Z" />
        <path d="M328,128 L362,118 L402,124 L432,140 L452,172 L462,212 L452,262 L432,312 L400,346 L370,356 L340,340 L320,300 L310,260 L310,212 L320,170 Z" />
        <path d="M432,48 L502,38 L582,33 L652,38 L722,48 L762,78 L772,118 L752,158 L722,178 L682,190 L642,184 L602,190 L562,200 L532,190 L502,170 L472,150 L452,128 L440,98 Z" />
        <path d="M418,28 L502,22 L602,18 L702,24 L782,40 L792,70 L762,80 L700,68 L650,63 L580,58 L500,53 L440,53 Z" />
        <path d="M548,152 L592,158 L622,172 L652,182 L672,192 L660,212 L630,222 L600,216 L568,200 L548,184 Z" />
        <path d="M598,258 L650,248 L712,254 L742,276 L752,312 L740,342 L710,358 L670,362 L630,352 L598,330 L583,298 L583,273 Z" />
        <path d="M192,18 L252,13 L282,24 L288,50 L270,70 L238,80 L208,74 L192,54 Z" />
        <path d="M728,78 L746,73 L756,88 L752,106 L734,112 L722,94 Z" />
        <path d="M332,63 L346,58 L352,70 L346,82 L334,82 L328,72 Z" />
        <path d="M362,33 L386,23 L402,30 L408,52 L396,66 L380,70 L362,58 Z" />
        <path d="M742,328 L756,322 L762,338 L756,352 L744,350 L740,336 Z" />
        <path d="M446,293 L454,283 L462,294 L460,316 L452,320 L444,310 Z" />
      </g>
      {countries.map(d => {
        const coords = COUNTRY_CENTROIDS[d.country_code]
        if (!coords) return null
        const [x, y] = toXY(coords[0], coords[1])
        const r = Math.max(5, Math.min(22, 5 + (d.count / maxCount) * 17))
        return (
          <g key={d.country_code}>
            <circle cx={x} cy={y} r={r} fill="rgba(45,106,79,0.70)" stroke="#fff" strokeWidth={1.5} />
            {d.count > 1 && <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={r > 11 ? 9 : 7} fontWeight="700">{d.count}</text>}
          </g>
        )
      })}
    </svg>
  )
}

function VisitorStatsPage({ lang }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/visitor-stats', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setStats(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const t = lang === 'da' ? {
    title: 'Besøgende',
    subtitle: 'Oversigt over besøg på platformen',
    totalVisits: 'Besøg i alt',
    browsers: 'Browsere',
    os: 'Operativsystemer',
    countries: 'Lande',
    map: 'Besøgende på verdenskortet',
    daily: 'Daglige besøg (30 dage)',
    noData: 'Ingen data endnu',
  } : {
    title: 'Visitors',
    subtitle: 'Platform visit overview',
    totalVisits: 'Total visits',
    browsers: 'Browsers',
    os: 'Operating systems',
    countries: 'Countries',
    map: 'Visitors on world map',
    daily: 'Daily visits (30 days)',
    noData: 'No data yet',
  }

  const BarChart = ({ data, label }) => {
    const maxVal = Math.max(1, ...data.map(d => d.count))
    return (
      <div className="p-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 14 }}>{label}</div>
        {data.length === 0
          ? <div style={{ fontSize: 13, color: '#aaa' }}>{t.noData}</div>
          : data.map(d => (
            <div key={d.browser || d.os || d.country} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{d.browser || d.os || d.country}</span>
                <span style={{ color: '#888', fontWeight: 600 }}>{d.count}</span>
              </div>
              <div style={{ height: 8, background: '#EEE', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#2D6A4F', borderRadius: 4, width: `${(d.count / maxVal) * 100}%`, transition: 'width 0.5s' }} />
              </div>
            </div>
          ))
        }
      </div>
    )
  }

  if (loading) return <div className="p-card" style={{ padding: 40, textAlign: 'center', color: '#888' }}>⏳</div>

  const dailyMax = Math.max(1, ...(stats?.daily || []).map(d => d.count))

  return (
    <div className="p-events" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 className="p-section-title" style={{ margin: '0 0 4px' }}>🌍 {t.title}</h2>
        <div style={{ fontSize: 13, color: '#888' }}>{t.subtitle}</div>
      </div>

      {/* Total */}
      <div className="p-card" style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>👁️</div>
        <div>
          <div style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>{t.totalVisits}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#2D6A4F' }}>{stats?.total ?? 0}</div>
        </div>
      </div>

      {/* Daily chart */}
      <div className="p-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 14 }}>📅 {t.daily}</div>
        {!stats?.daily?.length
          ? <div style={{ fontSize: 13, color: '#aaa' }}>{t.noData}</div>
          : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
              {stats.daily.map(d => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', background: '#2D6A4F', borderRadius: '3px 3px 0 0', height: `${Math.max(2, (d.count / dailyMax) * 70)}px` }} title={`${d.date}: ${d.count}`} />
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Map */}
      <div className="p-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 14 }}>🗺️ {t.map}</div>
        {!stats?.countries?.length
          ? <div style={{ fontSize: 13, color: '#aaa' }}>{t.noData}</div>
          : <MiniWorldMap countries={stats.countries} />
        }
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <BarChart data={stats?.browsers || []} label={`🌐 ${t.browsers}`} />
        <BarChart data={stats?.oses || []} label={`💻 ${t.os}`} />
      </div>

      {/* Country table */}
      <BarChart
        data={(stats?.countries || []).slice(0, 15).map(c => ({ ...c, browser: `${c.country || c.country_code}` }))}
        label={`🌍 ${t.countries}`}
      />
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

// ── Friend Profile (full page) ──
function FriendProfilePage({ userId, lang, t, currentUser, onBack, onMessage }) {
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!userId) return
    apiFetchProfile(userId).then(data => { if (data) setProfile(data) })
  }, [userId])

  const avatarSrc = profile?.avatarUrl
    ? (profile.avatarUrl.startsWith('http') ? profile.avatarUrl : `${API_BASE}${profile.avatarUrl}`)
    : null

  return (
    <div className="p-profile">
      <button onClick={onBack} style={{ marginBottom: 16, background: 'none', border: 'none', color: '#2D6A4F', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
        ← {lang === 'da' ? 'Tilbage' : 'Back'}
      </button>
      {!profile ? (
        <div className="p-card" style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>…</div>
      ) : (
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
            {profile.handle && <p className="p-profile-handle">@{profile.handle}</p>}
            {profile.bio?.[lang] && <p className="p-profile-bio">{profile.bio[lang]}</p>}
            <div className="p-profile-meta">
              {profile.location && <span>📍 {profile.location}</span>}
              {profile.joinDate && <span>📅 {lang === 'da' ? 'Medlem siden' : 'Joined'} {new Date(profile.joinDate).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { year: 'numeric', month: 'long' })}</span>}
            </div>
            <div className="p-friend-profile-stats" style={{ justifyContent: 'center', marginTop: 12 }}>
              <div className="p-friend-profile-stat"><strong>{profile.friendCount}</strong><span>{t.friendsLabel}</span></div>
              {profile.mutualCount > 0 && <div className="p-friend-profile-stat"><strong>{profile.mutualCount}</strong><span>{t.mutualFriends}</span></div>}
              <div className="p-friend-profile-stat"><strong>{profile.postCount}</strong><span>{t.postsLabel}</span></div>
            </div>
            {profile.isFriend && (
              <button className="p-friend-msg-btn" style={{ marginTop: 16 }} onClick={() => onMessage(profile)}>
                💬 {t.message}
              </button>
            )}
          </div>
        </div>
      )}
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
                <button className="p-friend-msg-btn" style={{ marginTop: 16 }} onClick={() => { onClose(); onMessage(profile) }}>
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

// ── Referral Dashboard (Viral Growth) ──
function ReferralDashboard({ t, lang, referralData, badges, leaderboard, inviteLink }) {
  const [copiedShareLink, setCopiedShareLink] = useState(null)
  const siteUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://fellis.eu')

  const copyLink = (link) => {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopiedShareLink(link)
    setTimeout(() => setCopiedShareLink(null), 2000)
  }

  const shareOn = (platform, url, text) => {
    const encoded = encodeURIComponent(url)
    const encodedText = encodeURIComponent(text || '')
    let shareUrl = ''
    if (platform === 'facebook') shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encoded}`
    else if (platform === 'twitter') shareUrl = `https://twitter.com/intent/tweet?url=${encoded}&text=${encodedText}`
    else if (platform === 'linkedin') shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`
    else if (platform === 'whatsapp') shareUrl = `https://wa.me/?text=${encodedText}%20${encoded}`
    if (shareUrl) window.open(shareUrl, '_blank', 'width=600,height=400,noopener,noreferrer')
    apiTrackShare('invite', null, platform).catch(() => {})
  }

  const s = {
    wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 },
    statCard: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 12px', textAlign: 'center' },
    statNum: { fontSize: 28, fontWeight: 700, color: '#1877F2', lineHeight: 1.1 },
    statLabel: { fontSize: 12, color: '#666', marginTop: 4 },
    card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: 16 },
    cardTitle: { fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1a1a1a' },
    badgeGrid: { display: 'flex', flexWrap: 'wrap', gap: 10 },
    badge: (earned) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 16px', borderRadius: 12, border: `2px solid ${earned ? '#1877F2' : '#e0e0e0'}`, background: earned ? '#EBF4FF' : '#f8f8f8', opacity: earned ? 1 : 0.55, minWidth: 90, textAlign: 'center' }),
    badgeIcon: { fontSize: 28 },
    badgeTitle: (earned) => ({ fontSize: 11, fontWeight: 700, color: earned ? '#1877F2' : '#888' }),
    badgeProgress: { fontSize: 10, color: '#999' },
    progressBar: (pct) => ({ height: 6, borderRadius: 3, background: '#e0e0e0', overflow: 'hidden', position: 'relative', marginTop: 4 }),
    progressFill: (pct) => ({ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(pct, 100)}%`, background: '#1877F2', borderRadius: 3 }),
    leaderRow: (isMe) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0f0f0', background: isMe ? '#EBF4FF' : 'transparent', borderRadius: isMe ? 8 : 0, paddingLeft: isMe ? 8 : 0 }),
    rank: { width: 26, textAlign: 'center', fontWeight: 700, color: '#888', fontSize: 13 },
    rankTop: (n) => ({ color: n === 1 ? '#f5a623' : n === 2 ? '#aaa' : n === 3 ? '#cd7f32' : '#888' }),
    shareRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
    shareBtn: (color) => ({ padding: '7px 14px', borderRadius: 8, border: 'none', background: color, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }),
    recentRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f5f5f5' },
  }

  const rd = referralData
  const conversionPct = rd ? rd.conversionRate : 0

  return (
    <div style={s.wrap}>

      {/* Stats overview */}
      <div className="p-card">
        <div style={s.cardTitle}>📊 {t.referralDashStats}</div>
        <div style={s.statsGrid}>
          <div style={s.statCard}>
            <div style={s.statNum}>{rd ? rd.totalInvited : '—'}</div>
            <div style={s.statLabel}>{t.referralDashInvited}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statNum}>{rd ? rd.totalAccepted : '—'}</div>
            <div style={s.statLabel}>{t.referralDashAccepted}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statNum}>{rd ? `${conversionPct}%` : '—'}</div>
            <div style={s.statLabel}>{t.referralDashConversion}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statNum}>{rd ? rd.reputationScore : '—'}</div>
            <div style={s.statLabel}>{t.referralDashReputation}</div>
          </div>
        </div>

        {/* Next milestone progress */}
        {rd?.nextMilestone && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>
              🎯 {t.referralDashNextMilestone}: <strong>{rd.nextMilestone.current}</strong> / {rd.nextMilestone.target} {t.referralDashAccepted.toLowerCase()} ({rd.nextMilestone.remaining} {lang === 'da' ? 'mangler' : 'remaining'})
            </div>
            <div style={s.progressBar()}>
              <div style={s.progressFill(Math.round((rd.nextMilestone.current / rd.nextMilestone.target) * 100))} />
            </div>
          </div>
        )}
      </div>

      {/* Share invite link */}
      <div className="p-card">
        <div style={s.cardTitle}>🔗 {t.inviteLinkTitle || t.referralDashShareLink}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input readOnly value={inviteLink || `${siteUrl}/?invite=…`} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, color: '#444', background: '#fafafa' }} />
          <button className="p-btn-primary" onClick={() => copyLink(inviteLink)} style={{ whiteSpace: 'nowrap', padding: '8px 14px', fontSize: 13 }}>
            {copiedShareLink === inviteLink ? t.referralDashShareCopied : t.referralDashShareCopy}
          </button>
        </div>
        <div style={s.shareRow}>
          <button style={s.shareBtn('#1877F2')} onClick={() => shareOn('facebook', inviteLink, lang === 'da' ? 'Kom med på fellis.eu — Danmarks private sociale netværk!' : 'Join me on fellis.eu — Denmark\'s privacy-first social network!')}>
            f {t.referralDashShareFb}
          </button>
          <button style={s.shareBtn('#000')} onClick={() => shareOn('twitter', inviteLink, lang === 'da' ? 'Tilmeld dig fellis.eu med mit link!' : 'Join fellis.eu with my invite link!')}>
            𝕏 {t.referralDashShareTwitter}
          </button>
          <button style={s.shareBtn('#0A66C2')} onClick={() => shareOn('linkedin', inviteLink, '')}>
            in {t.referralDashShareLinkedIn}
          </button>
          <button style={s.shareBtn('#25D366')} onClick={() => shareOn('whatsapp', inviteLink, lang === 'da' ? 'Kom med på fellis.eu!' : 'Join me on fellis.eu!')}>
            💬 {t.referralDashShareWhatsApp}
          </button>
        </div>
      </div>

      {/* Badges */}
      <div className="p-card">
        <div style={s.cardTitle}>🏅 {t.referralDashBadgesTitle}</div>
        {!badges ? (
          <div style={{ color: '#888', fontSize: 13 }}>{lang === 'da' ? 'Indlæser…' : 'Loading…'}</div>
        ) : (
          <div style={s.badgeGrid}>
            {badges.map(b => (
              <div key={b.type} style={s.badge(b.earned)} title={b.description}>
                <span style={s.badgeIcon}>{b.icon}</span>
                <span style={s.badgeTitle(b.earned)}>{b.title}</span>
                {!b.earned && (
                  <>
                    <span style={s.badgeProgress}>{b.progress} {t.referralDashProgress} {b.threshold}</span>
                    <div style={s.progressBar()}>
                      <div style={s.progressFill(Math.round((b.progress / b.threshold) * 100))} />
                    </div>
                  </>
                )}
                {b.earned && <span style={{ fontSize: 10, color: '#40916C', fontWeight: 700 }}>+{b.points} pt</span>}
              </div>
            ))}
          </div>
        )}
        {badges && badges.length === 0 && (
          <p style={{ color: '#888', fontSize: 13 }}>{t.referralDashNoBadges}</p>
        )}
      </div>

      {/* Recent referrals */}
      <div className="p-card">
        <div style={s.cardTitle}>👥 {t.referralDashRecentTitle}</div>
        {!rd ? (
          <div style={{ color: '#888', fontSize: 13 }}>{lang === 'da' ? 'Indlæser…' : 'Loading…'}</div>
        ) : rd.recentReferrals.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>{t.referralDashNoRecent}</p>
        ) : (
          rd.recentReferrals.map((r, i) => (
            <div key={i} style={s.recentRow}>
              <div className="p-avatar-sm" style={{ background: nameToColor(r.name) }}>{getInitials(r.name)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#999' }}>{r.handle}</div>
              </div>
              <div style={{ fontSize: 11, color: '#aaa' }}>
                {new Date(r.joinedAt).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Leaderboard */}
      <div className="p-card">
        <div style={s.cardTitle}>🏆 {t.referralDashLeaderboard}</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>{t.referralDashLeaderboardDesc}</div>
        {!leaderboard ? (
          <div style={{ color: '#888', fontSize: 13 }}>{lang === 'da' ? 'Indlæser…' : 'Loading…'}</div>
        ) : leaderboard.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>{lang === 'da' ? 'Endnu ingen på leaderboardet.' : 'No one on the leaderboard yet.'}</p>
        ) : (
          leaderboard.map(entry => (
            <div key={entry.id} style={s.leaderRow(entry.isMe)}>
              <div style={{ ...s.rank, ...s.rankTop(entry.rank) }}>
                {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`}
              </div>
              <div className="p-avatar-sm" style={{ background: nameToColor(entry.name) }}>{getInitials(entry.name)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: entry.isMe ? 700 : 500, fontSize: 13 }}>
                  {entry.name} {entry.isMe && <span style={{ fontSize: 11, color: '#1877F2' }}>{t.referralDashYou}</span>}
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>{entry.handle}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#1877F2', fontSize: 14 }}>{entry.referralCount}</div>
                {entry.topBadge && <span style={{ fontSize: 16 }}>{entry.topBadge.icon}</span>}
              </div>
            </div>
          ))
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
  const [invites, setInvites] = useState(null) // null = not yet loaded
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteEmailSending, setInviteEmailSending] = useState(false)
  const [inviteEmailSentOk, setInviteEmailSentOk] = useState(false)
  const [referralData, setReferralData] = useState(null)
  const [badges, setBadges] = useState(null)
  const [leaderboard, setLeaderboard] = useState(null)
  const searchTimerRef = useRef(null)
  const { rels, setRel } = useContactRelationships()
  const REL_OPTS = [
    { key: 'family', label: t.relFamily },
    { key: 'colleague', label: t.relColleague },
    { key: 'close', label: t.relCloseFriend },
    { key: 'neighbor', label: t.relNeighbor },
  ]

  const refreshAll = useCallback(() => {
    apiFetchFriends().then(data => {
      if (data) setFriends(data)
    })
    apiFetchFriendRequests().then(data => {
      if (data) {
        setRequests(data)
      } else {
        // Demo fallback: mirrors the mock notification for Liam Madsen
        setRequests({ incoming: [{ id: 'mock-req-1', from_id: 'mock-liam', from_name: 'Liam Madsen' }], outgoing: [] })
      }
    })
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

  const filtered = (filter === 'invites' || filter === 'viral') ? [] : friends.filter(f => filter === 'all' || f.online)

  const handleCopyInvite = useCallback(() => {
    navigator.clipboard.writeText(inviteLink).catch(() => {})
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }, [inviteLink])

  const handleFbShare = useCallback(() => {
    const shareUrl = encodeURIComponent(inviteLink || 'https://fellis.eu')
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`, 'facebook-share', 'width=580,height=400')
  }, [inviteLink])

  const handleSendEmailInvite = useCallback(async (e) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviteEmailSending(true)
    await apiSendInvites([inviteEmail.trim()]).catch(() => {})
    // Optimistically add to outgoing list
    setInvites(prev => {
      const list = prev || []
      return [{ id: `local-${Date.now()}`, email: inviteEmail.trim(), sentAt: new Date().toISOString(), status: 'pending' }, ...list]
    })
    setInviteEmail('')
    setInviteEmailSending(false)
    setInviteEmailSentOk(true)
    setTimeout(() => setInviteEmailSentOk(false), 3000)
  }, [inviteEmail])

  const handleCancelInvite = useCallback(async (invId, lang) => {
    const msg = lang === 'da' ? 'Trække invitationen tilbage?' : 'Withdraw this invitation?'
    if (!window.confirm(msg)) return
    // Optimistic removal
    setInvites(prev => (prev || []).filter(inv => inv.id !== invId))
    // If it's a real DB id (number), call the API
    if (typeof invId === 'number' || (typeof invId === 'string' && !invId.startsWith('mock-') && !invId.startsWith('local-'))) {
      await apiCancelInvite(invId).catch(() => {})
    }
  }, [])

  // Load invites on mount so the count is visible in the tab label
  useEffect(() => {
    if (invites !== null) return
    apiGetInvites()
      .then(data => {
        if (data && (Array.isArray(data) ? data.length : data?.invites?.length)) {
          setInvites(Array.isArray(data) ? data : (data?.invites || []))
        } else {
          setInvites([])
        }
      })
      .catch(() => setInvites([]))
  }, [invites])

  // Load referral dashboard when viral tab is opened
  useEffect(() => {
    if (filter !== 'viral') return
    if (!referralData) apiGetReferralDashboard().then(d => { if (d) setReferralData(d) })
    if (!badges) apiGetBadges().then(d => { if (d) setBadges(d) })
    if (!leaderboard) apiGetLeaderboard().then(d => { if (d) setLeaderboard(d) })
  }, [filter, referralData, badges, leaderboard])

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
          onMessage={(prof) => { setViewProfileId(null); onMessage(prof) }}
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

      {/* Invite friends card – email + link + Facebook */}
      <div className="p-card p-invite-card">
        <h3 className="p-section-title" style={{ margin: '0 0 6px' }}>
          {lang === 'da' ? 'Inviter venner' : 'Invite friends'}
        </h3>
        <p className="p-invite-desc">
          {lang === 'da'
            ? 'Inviter via e-mail eller del dit link – I bliver automatisk forbundet, når de tilmelder sig.'
            : 'Invite by email or share your link – you will be automatically connected when they sign up.'}
        </p>
        <form className="p-invite-email-form" onSubmit={handleSendEmailInvite} style={{ marginBottom: 8 }}>
          <input
            className="p-invite-email-input"
            type="email"
            placeholder={t.invitesSendPlaceholder}
            value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setInviteEmailSentOk(false) }}
            disabled={inviteEmailSending}
            required
          />
          <button className="p-invite-email-btn" type="submit" disabled={inviteEmailSending || !inviteEmail.trim()}>
            {inviteEmailSending ? t.invitesSending : t.invitesSendBtn}
          </button>
        </form>
        {inviteEmailSentOk && <div className="p-invite-sent-ok">✓ {t.invitesSentOk}</div>}
        <div className="p-invite-link-row" style={{ marginBottom: 8 }}>
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

      {/* Incoming connection requests (only on non-invites tabs; shown inside Invitations tab too) */}
      {filter !== 'invites' && requests.incoming.length > 0 && (
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
              <span className="p-filter-online-dot" /> {t.onlineFriends} ({friends.filter(f => f.online).length})
            </button>
            <button className={`p-filter-tab${filter === 'invites' ? ' active' : ''}`} onClick={() => setFilter('invites')}>
              ✉️ {t.invitesTab}{invites !== null && invites.length > 0 ? ` (${invites.length})` : ''}
            </button>
            <button className={`p-filter-tab${filter === 'viral' ? ' active' : ''}`} onClick={() => setFilter('viral')}>
              🚀 {t.referralDashViralTitle}
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
                    <button className="p-friend-msg-btn" style={{ flex: 1 }} onClick={() => onMessage(user)}>💬 {t.message}</button>
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
      ) : filter === 'invites' ? (
        <div className="p-invites-page">

          {/* ── Incoming connection requests ── */}
          <div className="p-card p-invites-section">
            <h3 className="p-invites-section-title">{t.invitesIncomingTitle}</h3>
            {requests.incoming.length === 0 ? (
              <div className="p-invites-empty">{t.invitesIncomingEmpty}</div>
            ) : (
              <div className="p-invites-list">
                {requests.incoming.map(req => (
                  <div key={req.id} className="p-invite-row">
                    <div className="p-avatar-sm" style={{ background: nameToColor(req.from_name) }}>
                      {getInitials(req.from_name)}
                    </div>
                    <div className="p-invite-row-info">
                      <div className="p-invite-row-name">{req.from_name}</div>
                      <div className="p-invite-row-meta">{lang === 'da' ? 'Vil gerne forbindes med dig' : 'Wants to connect with you'}</div>
                    </div>
                    <div className="p-invite-row-actions">
                      <button className="p-freq-accept-btn" onClick={() => handleAccept(req.id)}>{t.acceptRequest}</button>
                      <button className="p-freq-decline-btn" onClick={() => handleDecline(req.id)}>{t.declineRequest}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Outgoing invitations ── */}
          <div className="p-card p-invites-section">
            <h3 className="p-invites-section-title">{t.invitesSentTitle}</h3>
            {(() => {
              const pending = (invites || []).filter(inv => inv.status !== 'joined' && inv.status !== 'accepted')
              if (invites === null) return <div className="p-invites-empty">…</div>
              if (pending.length === 0) return <div className="p-invites-empty">✉️ {t.invitesNoSent}</div>
              return (
              <div className="p-invites-list">
                {pending.map((inv, i) => (
                  <div key={inv.id || i} className="p-invite-row">
                    <div className="p-avatar-sm" style={{ background: nameToColor(inv.name || inv.email || '?') }}>
                      {(inv.name || inv.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="p-invite-row-info">
                      <div className="p-invite-row-name">{inv.name || inv.email}</div>
                      {inv.sentAt && (
                        <div className="p-invite-row-meta">{t.invitesSentLabel}: {new Date(inv.sentAt).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      )}
                    </div>
                    <div className="p-invite-row-actions">
                      <span className="p-invite-status-badge">{t.invitesPending}</span>
                      <button className="p-invite-cancel-btn" onClick={() => handleCancelInvite(inv.id || i, lang)} title={t.invitesCancelBtn}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              )
            })()}
          </div>
        </div>
      ) : filter === 'viral' ? (
        <ReferralDashboard t={t} lang={lang} referralData={referralData} badges={badges} leaderboard={leaderboard} inviteLink={inviteLink} />
      ) : (
        <div className="p-friends-grid">
          {filtered.map((friend) => (
            <div key={friend.id} className="p-card p-friend-card">
              <div className="p-friend-card-top" style={{ cursor: 'pointer' }} onClick={() => setViewProfileId(friend.id)}>
                <div className="p-avatar-md" style={{ background: nameToColor(friend.name) }}>
                  {getInitials(friend.name)}
                  {friend.online && <div className="online-dot" />}
                </div>
                <div className="p-friend-card-name">{friend.name}</div>
                <div className={`p-friend-card-status${friend.online ? ' online' : ''}`}>
                  {friend.online ? (lang === 'da' ? 'Online' : 'Online') : (lang === 'da' ? 'Offline' : 'Offline')}
                </div>
                {rels[String(friend.id)] ? (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#EBF4FF', color: '#1877F2', fontWeight: 600 }}>
                    {REL_OPTS.find(r => r.key === rels[String(friend.id)])?.label}
                  </span>
                ) : (
                  <div className="p-friend-card-mutual">{friend.mutual} {t.mutualFriends}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="p-friend-msg-btn" style={{ flex: 1 }} onClick={() => onMessage(friend)}>
                  💬 {t.message}
                </button>
                <div className="p-friend-menu-wrap" style={{ position: 'relative' }}>
                  <button className="p-friend-menu-btn" onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === friend.id ? null : friend.id) }}>•••</button>
                  {openMenuId === friend.id && (
                    <div className="p-friend-menu" onClick={e => e.stopPropagation()}>
                      <button className="p-friend-menu-item" onClick={() => { setOpenMenuId(null); setViewProfileId(friend.id) }}>
                        👤 {lang === 'da' ? 'Vis profil' : 'View profile'}
                      </button>
                      <button className="p-friend-menu-item" onClick={() => { setOpenMenuId(null); onMessage(friend) }}>
                        💬 {t.message}
                      </button>
                      <div className="p-friend-menu-item" style={{ cursor: 'default' }}>
                        <span style={{ fontSize: 12, color: '#888', marginBottom: 2, display: 'block' }}>
                          {lang === 'da' ? 'Relation' : 'Relationship'}
                        </span>
                        <select
                          value={rels[String(friend.id)] || ''}
                          onChange={e => {
                            const val = e.target.value || null
                            setRel(friend.id, val)
                            // Sync family status to server for feed algorithm
                            apiToggleFamilyFriend(friend.id, val === 'family').catch(() => {})
                          }}
                          style={{ width: '100%', fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#fafafa' }}
                        >
                          <option value="">{t.relNone}</option>
                          {REL_OPTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </div>
                      <button className="p-friend-menu-item p-friend-menu-danger" onClick={() => { setOpenMenuId(null); setUnfriendTarget({ id: friend.id, name: friend.name }) }}>
                        {t.unfriend}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-friends-empty">
              <span className="p-friends-empty-icon">👥</span>
              <p>
                {filter === 'online'
                  ? (lang === 'da' ? 'Ingen venner er online lige nu' : 'No friends are online right now')
                  : (lang === 'da' ? 'Du har endnu ingen venner på fellis' : 'You have no friends on fellis yet')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Messages ──
const MSG_PAGE_SIZE = 20

// ── Contact relationship tags (persisted in localStorage) ──
function useContactRelationships() {
  const [rels, setRels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fellis_contact_rels') || '{}') } catch { return {} }
  })
  const setRel = (friendId, rel) => {
    setRels(prev => {
      const next = rel ? { ...prev, [String(friendId)]: rel } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== String(friendId)))
      localStorage.setItem('fellis_contact_rels', JSON.stringify(next))
      return next
    })
  }
  return { rels, setRel }
}

// ── New Conversation / New Group Modal ──
function NewConvModal({ t, lang, mode, friends, existingParticipantIds = [], isGroupMode, onClose, onCreate }) {
  const [selected, setSelected] = useState([])
  const [groupName, setGroupName] = useState('')
  const [search, setSearch] = useState('')
  const [isFamilyGroup, setIsFamilyGroup] = useState(false)
  const [relFilter, setRelFilter] = useState('all')
  const { rels, setRel } = useContactRelationships()

  const REL_OPTS = [
    { key: 'family', label: t.relFamily },
    { key: 'colleague', label: t.relColleague },
    { key: 'close', label: t.relCloseFriend },
    { key: 'neighbor', label: t.relNeighbor },
  ]

  const eligible = friends.filter(f =>
    !existingParticipantIds.includes(f.id) &&
    f.name.toLowerCase().includes(search.toLowerCase()) &&
    (relFilter === 'all' || rels[String(f.id)] === relFilter)
  )
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // Allow multi-select in both modes — if >1 selected in 1:1 mode, auto-create a group
  const effectiveGroupMode = isGroupMode || selected.length > 1
  const canCreate = selected.length >= 1

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-msg-modal" onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>{isGroupMode ? t.newGroupTitle : t.newConvTitle}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        {effectiveGroupMode && (
          <input
            className="p-msg-modal-input"
            placeholder={t.groupNamePlaceholder}
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
          />
        )}
        {effectiveGroupMode && mode === 'privat' && (
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
        {/* Relationship filter chips */}
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px 6px', flexWrap: 'wrap', borderBottom: '1px solid #f0f0f0' }}>
          {[{ key: 'all', label: t.relFilterAll }, ...REL_OPTS].map(r => (
            <button
              key={r.key}
              onClick={() => setRelFilter(r.key)}
              style={{ fontSize: 11, padding: '2px 9px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: relFilter === r.key ? '#2D6A4F' : '#f0f0f0',
                color: relFilter === r.key ? '#fff' : '#555',
                fontWeight: relFilter === r.key ? 600 : 400 }}
            >{r.label}</button>
          ))}
        </div>
        <div className="p-msg-modal-list">
          {eligible.map(f => {
            const relKey = rels[String(f.id)] || ''
            const relLabel = REL_OPTS.find(r => r.key === relKey)?.label
            return (
              <label key={f.id} className={`p-msg-modal-item${selected.includes(f.id) ? ' selected' : ''}`}>
                <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} style={{ display: 'none' }} />
                <div className="p-avatar-sm" style={{ background: nameToColor(f.name), flexShrink: 0 }}>{getInitials(f.name)}</div>
                <span className="p-msg-modal-name">{f.name}</span>
                {relLabel && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#EBF4FF', color: '#1877F2', fontWeight: 600, flexShrink: 0 }}>{relLabel}</span>}
                <select
                  value={relKey}
                  onClick={e => e.stopPropagation()}
                  onChange={e => { e.stopPropagation(); setRel(f.id, e.target.value || null) }}
                  style={{ fontSize: 11, border: '1px solid #e0e0e0', borderRadius: 6, padding: '2px 4px', color: '#888', background: '#fafafa', cursor: 'pointer', flexShrink: 0, marginLeft: 'auto' }}
                  title={t.relLabel}
                >
                  <option value="">{t.relNone}</option>
                  {REL_OPTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {selected.includes(f.id) && <span className="p-msg-modal-check">✓</span>}
              </label>
            )
          })}
          {eligible.length === 0 && <div className="p-msg-modal-empty">{lang === 'da' ? 'Ingen venner fundet' : 'No friends found'}</div>}
        </div>
        <div className="p-msg-modal-footer">
          <button className="p-msg-modal-btn secondary" onClick={onClose}>{t.cancel}</button>
          <button
            className="p-msg-modal-btn primary"
            disabled={!canCreate}
            onClick={() => onCreate(selected, effectiveGroupMode ? (groupName || null) : null, effectiveGroupMode, effectiveGroupMode ? isFamilyGroup : false)}
          >
            {effectiveGroupMode ? (isFamilyGroup ? `🏡 ${t.createGroup}` : t.createGroup) : t.startConv}
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
  const [companyMatches, setCompanyMatches] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults(null); setCompanyMatches([]); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const [data, compData] = await Promise.all([
          apiSearch(query.trim()),
          fetch(`/api/companies/all?q=${encodeURIComponent(query.trim())}`, { credentials: 'include' })
            .then(r => r.json()).catch(() => ({ companies: [] })),
        ])
        setResults(data || { posts: [], messages: [] })
        setCompanyMatches(compData.companies || [])
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

  const hasPosts = results?.posts?.length > 0
  const hasMessages = results?.messages?.length > 0
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
              <div key={c.id} className="p-search-result" onClick={() => onNavigateToCompany(c.id)}>
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
                  <div className="p-search-result-text">{excerpt(post.text[lang], query.trim())}</div>
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
                    {excerpt(msg.text[lang], query.trim())}
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

  // Open a specific conversation when navigated from elsewhere (search, contact seller, etc.)
  useEffect(() => {
    if (!openConvId) return
    const idx = conversations.findIndex(c => c.id === openConvId)
    if (idx >= 0) { setActiveConv(idx); onConvOpened?.(); return }
    // Conversation not in list yet (e.g. just created) — refetch and retry
    apiFetchConversations().then(data => {
      if (!data) return
      setConversations(data)
      const i = data.findIndex(c => c.id === openConvId)
      if (i >= 0) { setActiveConv(i); onConvOpened?.() }
    })
  }, [openConvId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setConversations(prev => {
      const conv = prev[i]
      if (conv?.unread > 0 && conv?.id) apiMarkConversationRead(conv.id).catch(() => {})
      return prev.map((c, j) => j === i ? { ...c, unread: 0 } : c)
    })
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
                    {c.unread > 0 && <span className="p-msg-badge" title={lang === 'da' ? `${c.unread} ulæste beskeder` : `${c.unread} unread messages`}>{c.unread}</span>}
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
                    <div style={{ whiteSpace: 'pre-wrap' }}>{linkifyText(msg.text[lang] || '').map((p, pi) =>
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
  const [rsvpMap, setRsvpMap] = useState({})
  const [rsvpExtras, setRsvpExtras] = useState({}) // { [eventId]: { dietary, plusOne } }
  const [shareEventId, setShareEventId] = useState(null)
  const [friends, setFriends] = useState([])

  useEffect(() => {
    apiFetchFriends().then(data => { if (data) setFriends(data) })
    apiFetchEvents().then(data => {
      if (data?.events) {
        // Use only real DB events (no mock placeholders) so count matches admin stats
        setEvents(data.events.length ? data.events : MOCK_EVENTS)
        const map = {}
        data.events.forEach(e => { if (e.myRsvp) map[e.id] = e.myRsvp })
        setRsvpMap(prev => ({ ...prev, ...map }))
      }
    })
  }, [])

  const handleRsvp = (eventId, status) => {
    const newStatus = rsvpMap[eventId] === status ? null : status
    setRsvpMap(prev => ({ ...prev, [eventId]: newStatus }))
    apiRsvpEvent(eventId, newStatus, rsvpExtras[eventId] || {}).catch(() => {})
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
            const isExpired = new Date(ev.date) < new Date()
            return (
              <div key={ev.id} className="p-card p-event-card" onClick={() => setSelectedEvent(ev)} style={isExpired ? { opacity: 0.65 } : {}}>
                <div className="p-event-card-body">
                  <div className="p-event-date-col">
                    <div className="p-event-month">{new Date(ev.date).toLocaleString(lang === 'da' ? 'da-DK' : 'en-US', { month: 'short' }).toUpperCase()}</div>
                    <div className="p-event-day">{new Date(ev.date).getDate()}</div>
                  </div>
                  <div className="p-event-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h3 className="p-event-title">{getEventTitle(ev)}</h3>
                      {typeLabel && <span className="p-event-type-badge">{typeLabel}</span>}
                      {isExpired && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#f5e6e6', color: '#c0392b' }}>{lang === 'da' ? 'Udløbet' : 'Expired'}</span>}
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
                    {!isExpired && [
                      { key: 'going', label: t.eventGoing, icon: '✓' },
                      { key: 'maybe', label: t.eventMaybe, icon: '~' },
                      { key: 'notGoing', label: t.eventNotGoing, icon: '✗' },
                    ].map(({ key, label, icon }) => (
                      <button
                        key={key}
                        className={`p-event-rsvp-btn${myRsvp === key ? ' active' : ''}`}
                        onClick={() => handleRsvp(ev.id, key)}
                        title={label}
                      >{icon}</button>
                    ))}
                    {!isExpired && <button
                      className="p-event-rsvp-btn"
                      title={t.eventShareWith}
                      onClick={e => { e.stopPropagation(); setShareEventId(ev.id) }}
                      style={{ fontSize: 12 }}
                    >📤</button>}
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
          onCreate={async (ev) => {
            const saved = await apiCreateEvent({
              title: typeof ev.title === 'string' ? ev.title : (ev.title?.da || ev.title?.en || ''),
              description: typeof ev.description === 'string' ? ev.description : (ev.description?.da || ''),
              date: ev.date,
              location: typeof ev.location === 'string' ? ev.location : (ev.location?.da || ''),
              eventType: ev.eventType || null,
              ticketUrl: ev.ticketUrl || null,
              cap: ev.cap || null,
            }).catch(() => null)
            setEvents(prev => [saved || ev, ...prev])
            setShowCreate(false)
          }}
        />
      )}

      {/* Share event modal */}
      {shareEventId && (
        <ShareEventModal
          event={events.find(e => e.id === shareEventId)}
          friends={friends}
          t={t}
          lang={lang}
          getTitle={getEventTitle}
          onClose={() => setShareEventId(null)}
        />
      )}
    </div>
  )
}

function ShareEventModal({ event, friends, t, lang, getTitle, onClose }) {
  const [selected, setSelected] = useState([])
  const [shared, setShared] = useState(false)
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const handleShare = () => {
    setShared(true)
    setTimeout(onClose, 1800)
  }
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  if (!event) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-msg-modal" onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>📤 {t.eventShareWith}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '8px 16px 10px', fontSize: 13, color: '#555', borderBottom: '1px solid #eee', fontWeight: 500 }}>
          {getTitle(event)}
        </div>
        {shared ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: '#2D6A4F', fontWeight: 600, fontSize: 15 }}>
            ✅ {t.eventShared}
          </div>
        ) : (<>
          <div className="p-msg-modal-list">
            {friends.length === 0 && <div className="p-msg-modal-empty">{lang === 'da' ? 'Ingen venner fundet' : 'No friends found'}</div>}
            {friends.map(f => (
              <label key={f.id} className={`p-msg-modal-item${selected.includes(f.id) ? ' selected' : ''}`}>
                <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} style={{ display: 'none' }} />
                <div className="p-avatar-sm" style={{ background: nameToColor(f.name), flexShrink: 0 }}>{getInitials(f.name)}</div>
                <span className="p-msg-modal-name">{f.name}</span>
                {selected.includes(f.id) && <span className="p-msg-modal-check">✓</span>}
              </label>
            ))}
          </div>
          <div className="p-msg-modal-footer">
            <button className="p-msg-modal-btn secondary" onClick={onClose}>{t.cancel}</button>
            <button
              className="p-msg-modal-btn primary"
              disabled={selected.length === 0}
              onClick={handleShare}
            >
              📤 {t.eventShareConfirm}{selected.length > 0 ? ` (${selected.length})` : ''}
            </button>
          </div>
        </>)}
      </div>
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
  const isExpired = new Date(event.date) < new Date()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-event-detail-modal" onClick={e => e.stopPropagation()} style={isExpired ? { opacity: 0.75 } : {}}>
        <button className="lightbox-close" style={{ position: 'absolute', top: 12, right: 16 }} onClick={onClose}>✕</button>

        {typeLabel && <div className="p-event-type-badge" style={{ marginBottom: 8 }}>{typeLabel}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{getTitle(event)}</h2>
          {isExpired && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: '#f5e6e6', color: '#c0392b' }}>{lang === 'da' ? 'Udløbet' : 'Expired'}</span>}
        </div>

        <div className="p-event-meta" style={{ marginBottom: 12 }}>
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {getLocation(event)}</span>
          <span>👤 {t.eventOrganizer}: <strong>{event.organizer}</strong></span>
          {event.cap && <span>🔢 max {event.cap} {t.eventAttendees}</span>}
          {event.ticketUrl && <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>🎟 {t.eventTicketUrl}</a>}
        </div>

        <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6, marginBottom: 20 }}>{getDesc(event)}</p>

        {/* RSVP */}
        <div className="p-event-detail-rsvp" style={isExpired ? { pointerEvents: 'none' } : {}}>
          {['going', 'maybe', 'notGoing'].map(s => {
            const label = t[`event${s.charAt(0).toUpperCase() + s.slice(1)}`]
            const icon = s === 'going' ? '✅' : s === 'maybe' ? '❓' : '❌'
            return (
              <button
                key={s}
                className={`p-event-rsvp-full-btn${myRsvp === s ? ' active' : ''}`}
                onClick={() => onRsvp(s)}
                disabled={isExpired}
              >
                {icon} {label}
              </button>
            )
          })}
        </div>

        {/* Common-mode extras */}
        {myRsvp && myRsvp !== 'notGoing' && mode === 'privat' && (
          <div style={{ marginTop: 16, padding: 16, background: '#F9F9F9', borderRadius: 10 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t.eventDietary}</label>
            <input
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }}
              placeholder={lang === 'da' ? 'f.eks. vegetar, nøddeallergi...' : 'e.g. vegetarian, nut allergy...'}
              value={extras.dietary || ''}
              onChange={e => onExtrasChange({ ...extras, dietary: e.target.value })}
              readOnly={isExpired}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: isExpired ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={!!extras.plusOne} onChange={e => onExtrasChange({ ...extras, plusOne: e.target.checked })} disabled={isExpired} />
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
function SkillsSection({ profile, t, lang, isOwn }) {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [newSkill, setNewSkill] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [endorsersPopup, setEndorsersPopup] = useState(null) // { skillId, names }
  const [endorsersLoading, setEndorsersLoading] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    fetch(`/api/skills/${profile.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setSkills(data.skills || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [profile?.id])

  const endorse = (skillId) => {
    fetch(`/api/skills/${skillId}/endorse`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setSkills(prev => prev.map(s => s.id === skillId
          ? { ...s, endorsed_by_me: data.endorsed ? 1 : 0, endorsement_count: s.endorsement_count + (data.endorsed ? 1 : -1) }
          : s))
      })
      .catch(() => {})
  }

  const addSkill = () => {
    const name = newSkill.trim()
    if (!name || skills.length >= 20) return
    fetch('/api/skills', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then(r => r.json())
      .then(skill => { setSkills(prev => [...prev, skill]); setNewSkill(''); setShowAdd(false) })
      .catch(() => {})
  }

  const removeSkill = (skillId) => {
    fetch(`/api/skills/${skillId}`, { method: 'DELETE', credentials: 'include' })
      .then(() => setSkills(prev => prev.filter(s => s.id !== skillId)))
      .catch(() => {})
  }

  const showEndorsers = (skillId) => {
    if (endorsersPopup?.skillId === skillId) { setEndorsersPopup(null); return }
    setEndorsersLoading(true)
    fetch(`/api/skills/${skillId}/endorsers`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setEndorsersPopup({ skillId, endorsers: data.endorsers || [] }); setEndorsersLoading(false) })
      .catch(() => setEndorsersLoading(false))
  }

  if (loading) return <div style={{ margin: '12px 0', color: '#888', fontSize: 13 }}>⏳</div>
  if (skills.length === 0 && !isOwn) return null

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 8 }}>{t.skills}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {skills.map(skill => {
          const count = Number(skill.endorsement_count) || 0
          const myEndorsement = !!skill.endorsed_by_me
          const showPopup = endorsersPopup?.skillId === skill.id
          return (
            <div key={skill.id}>
              <div className="p-skill-row">
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{skill.name}</span>
                  {count > 0 && (
                    <button
                      onClick={() => showEndorsers(skill.id)}
                      style={{ fontSize: 12, color: '#2D6A4F', marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                    >
                      {count} {t.endorsements}
                    </button>
                  )}
                </div>
                {!isOwn && (
                  <button
                    className={`p-endorse-btn${myEndorsement ? ' endorsed' : ''}`}
                    onClick={() => endorse(skill.id)}
                  >
                    {myEndorsement ? `✓ ${t.endorsed}` : t.endorse}
                  </button>
                )}
                {isOwn && (
                  <button
                    onClick={() => removeSkill(skill.id)}
                    title={t.removeSkill}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#c0392b', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}
                  >✕</button>
                )}
              </div>
              {showPopup && (
                <div style={{ marginTop: 4, padding: '10px 14px', background: '#F8F9FA', borderRadius: 8, fontSize: 12, color: '#555' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.skillEndorsersTitle}:</div>
                  {endorsersLoading ? '⏳' : (endorsersPopup.endorsers.length === 0
                    ? (lang === 'da' ? 'Ingen endnu' : 'None yet')
                    : endorsersPopup.endorsers.map(e => (
                        <span key={e.id} style={{ display: 'inline-block', marginRight: 8, marginBottom: 4, background: '#fff', border: '1px solid #eee', borderRadius: 20, padding: '2px 10px' }}>
                          {e.name}
                        </span>
                      ))
                  )}
                </div>
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

// ── Company Pages (data loaded from /api/companies and /api/jobs) ──

function CompanyListPage({ lang, t, currentUser, mode, onNavigate, initialCompanyId }) {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tab, setTab] = useState('my')
  const [openedFromFeed, setOpenedFromFeed] = useState(false)
  const [discoverCompanies, setDiscoverCompanies] = useState([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverSearch, setDiscoverSearch] = useState('')

  const loadCompanies = () => {
    setLoading(true)
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setCompanies(data.companies || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { loadCompanies() }, [])

  useEffect(() => {
    if (!initialCompanyId || loading) return
    const found = companies.find(c => c.id === initialCompanyId)
    if (found) {
      setSelectedCompany(found)
      setOpenedFromFeed(true)
    } else {
      fetch(`/api/companies/${initialCompanyId}`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => { if (data.company) { setSelectedCompany(data.company); setOpenedFromFeed(true) } })
        .catch(() => {})
    }
  }, [initialCompanyId, companies, loading])

  const myCompanies = companies.filter(c => {
    const r = c.member_role || c.role
    return r === 'owner' || r === 'admin' || r === 'editor'
  })
  const followingCompanies = companies.filter(c =>
    (c.is_following || c.role === 'following') && !myCompanies.find(m => m.id === c.id)
  )
  const displayCompanies = tab === 'my' ? myCompanies : followingCompanies

  const toggleFollow = (id) => {
    fetch(`/api/companies/${id}/follow`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setCompanies(prev => prev.map(c => c.id === id ? {
          ...c,
          is_following: data.following,
          followers_count: data.following ? (c.followers_count || 0) + 1 : Math.max(0, (c.followers_count || 0) - 1),
        } : c))
        setDiscoverCompanies(prev => prev.map(c => c.id === id ? {
          ...c,
          is_following: data.following,
          followers_count: data.following ? (c.followers_count || 0) + 1 : Math.max(0, (c.followers_count || 0) - 1),
        } : c))
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (tab !== 'discover') return
    setDiscoverLoading(true)
    const params = discoverSearch ? `?q=${encodeURIComponent(discoverSearch)}` : ''
    fetch(`/api/companies/all${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setDiscoverCompanies(data.companies || []); setDiscoverLoading(false) })
      .catch(() => setDiscoverLoading(false))
  }, [tab, discoverSearch])

  if (selectedCompany) {
    return (
      <CompanyDetailView
        company={selectedCompany}
        t={t}
        lang={lang}
        mode={mode}
        currentUser={currentUser}
        isOwner={selectedCompany.member_role === 'owner'}
        onBack={() => {
          if (openedFromFeed && onNavigate) { onNavigate('feed') }
          else { setSelectedCompany(null); setOpenedFromFeed(false); loadCompanies() }
        }}
        onFollow={() => toggleFollow(selectedCompany.id)}
        isFollowing={!!selectedCompany.is_following}
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
        <button className={`p-filter-tab${tab === 'discover' ? ' active' : ''}`} onClick={() => setTab('discover')}>
          {t.discoverCompanies}
        </button>
      </div>

      {tab === 'discover' ? (
        <>
          <input
            className="p-search-input"
            style={{ marginBottom: 16, width: '100%', boxSizing: 'border-box' }}
            placeholder={t.companySearchPlaceholder}
            value={discoverSearch}
            onChange={e => setDiscoverSearch(e.target.value)}
          />
          {discoverLoading ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>⏳</div>
          ) : discoverCompanies.length === 0 ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              {lang === 'da' ? 'Ingen virksomheder fundet.' : 'No companies found.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {discoverCompanies.map(company => {
                const isMember = myCompanies.some(m => m.id === company.id)
                return (
                  <div key={company.id} className="p-card p-company-card" style={{ cursor: 'pointer' }}>
                    <div className="p-company-logo" style={{ background: company.color }} onClick={() => setSelectedCompany(company)}>{company.name[0]}</div>
                    <div className="p-company-card-body" onClick={() => setSelectedCompany(company)} style={{ flex: 1, minWidth: 0 }}>
                      <h3 className="p-company-name">{company.name}</h3>
                      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{company.tagline}</div>
                      <div style={{ fontSize: 12, color: '#999' }}>
                        🏭 {company.industry} · {(company.followers_count || 0).toLocaleString()} {t.companyFollowers}
                      </div>
                    </div>
                    {!isMember && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleFollow(company.id) }}
                        className={company.is_following ? 'p-friend-msg-btn' : 'p-friend-add-btn p-friend-msg-btn'}
                        style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, flexShrink: 0, width: 'auto' }}
                      >
                        {company.is_following ? `✓ ${t.companyUnfollow}` : t.companyFollow}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : loading ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>⏳</div>
      ) : displayCompanies.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          🏢 {tab === 'my'
            ? (lang === 'da' ? 'Du administrerer ingen sider endnu.' : 'You don\'t manage any pages yet.')
            : (lang === 'da' ? 'Du følger ingen sider endnu.' : 'You don\'t follow any pages yet.')
          }
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayCompanies.map(company => {
            const isMember = myCompanies.some(m => m.id === company.id)
            return (
              <div key={company.id} className="p-card p-company-card" style={{ cursor: 'pointer' }}>
                <div className="p-company-logo" style={{ background: company.color }} onClick={() => setSelectedCompany(company)}>{company.name[0]}</div>
                <div className="p-company-card-body" onClick={() => setSelectedCompany(company)} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h3 className="p-company-name">{company.name}</h3>
                    {company.role === 'owner' && <span className="p-company-role-badge">{t.companyRoleOwner}</span>}
                    {company.role === 'admin' && <span className="p-company-role-badge">{t.companyRoleAdmin}</span>}
                    {company.role === 'editor' && <span className="p-company-role-badge" style={{ background: '#FFF3CD', color: '#856404' }}>{t.companyRoleEditor}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{company.tagline}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    🏭 {company.industry} · 👥 {company.size} · {(company.followers_count || 0).toLocaleString()} {t.companyFollowers}
                  </div>
                </div>
                {tab === 'following' && !isMember && (
                  <button
                    onClick={e => { e.stopPropagation(); toggleFollow(company.id) }}
                    className="p-friend-msg-btn"
                    style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, flexShrink: 0, width: 'auto' }}
                  >
                    ✓ {t.companyUnfollow}
                  </button>
                )}
              </div>
            )
          })}
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
  const [cpMediaFiles, setCpMediaFiles] = useState([])
  const [cpMediaPreviews, setCpMediaPreviews] = useState([])
  const [cpMediaPopup, setCpMediaPopup] = useState(false)
  const cpFileInputRef = useRef(null)
  const [companyPosts, setCompanyPosts] = useState([])
  const [companyJobs, setCompanyJobs] = useState([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [expandedCompanyComments, setExpandedCompanyComments] = useState(new Set())
  const [companyCommentInputs, setCompanyCommentInputs] = useState({})
  const [companyCommentLists, setCompanyCommentLists] = useState({})
  const [companyMembers, setCompanyMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberConnectState, setMemberConnectState] = useState({}) // userId → 'sent'|'friend'
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [showFollowersPopup, setShowFollowersPopup] = useState(false)
  const [followers, setFollowers] = useState(null)

  useEffect(() => {
    setPostsLoading(true)
    fetch(`/api/companies/${company.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setCompanyPosts(data.posts || [])
        setCompanyJobs(data.jobs || [])
        setPostsLoading(false)
      })
      .catch(() => setPostsLoading(false))
  }, [company.id])

  useEffect(() => {
    if (tab !== 'members') return
    if (companyMembers.length > 0) return
    setMembersLoading(true)
    fetch(`/api/companies/${company.id}/members`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const members = data.members || []
        setCompanyMembers(members)
        const state = {}
        members.forEach(m => {
          if (m.is_friend) state[m.id] = 'friend'
          else if (m.request_sent) state[m.id] = 'sent'
        })
        setMemberConnectState(state)
        setMembersLoading(false)
      })
      .catch(() => setMembersLoading(false))
  }, [tab, company.id])

  const connectWithMember = (userId) => {
    fetch(`/api/friends/request/${userId}`, { method: 'POST', credentials: 'include' })
      .then(() => setMemberConnectState(prev => ({ ...prev, [userId]: 'sent' })))
      .catch(() => {})
  }

  const toggleCompanyLike = (postId) => {
    fetch(`/api/companies/${company.id}/posts/${postId}/like`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setCompanyPosts(prev => prev.map(p => p.id === postId
          ? { ...p, liked: data.liked ? 1 : 0, likes: data.liked ? p.likes + 1 : Math.max(0, p.likes - 1) }
          : p))
      })
      .catch(() => {})
  }

  const toggleCompanyComments = (postId) => {
    setExpandedCompanyComments(prev => { const n = new Set(prev); n.has(postId) ? n.delete(postId) : n.add(postId); return n })
    if (!companyCommentLists[postId]) {
      fetch(`/api/companies/${company.id}/posts/${postId}/comments`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => setCompanyCommentLists(prev => ({ ...prev, [postId]: data.comments || [] })))
        .catch(() => {})
    }
  }

  const addCompanyComment = (postId) => {
    const text = companyCommentInputs[postId]?.trim()
    if (!text) return
    fetch(`/api/companies/${company.id}/posts/${postId}/comments`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(r => r.json())
      .then(comment => {
        setCompanyCommentLists(prev => ({ ...prev, [postId]: [...(prev[postId] || []), comment] }))
        setCompanyPosts(prev => prev.map(p => p.id === postId ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p))
        setCompanyCommentInputs(prev => ({ ...prev, [postId]: '' }))
      })
      .catch(() => {})
  }

  const handleCpFileSelect = (e) => {
    const files = Array.from(e.target.files).slice(0, 4)
    setCpMediaFiles(files)
    setCpMediaPreviews(files.map(f => ({
      url: URL.createObjectURL(f),
      type: f.type.startsWith('video/') ? 'video' : 'image',
      name: f.name,
    })))
  }
  const removeCpMedia = (idx) => {
    setCpMediaFiles(prev => prev.filter((_, i) => i !== idx))
    setCpMediaPreviews(prev => { URL.revokeObjectURL(prev[idx].url); return prev.filter((_, i) => i !== idx) })
  }

  const postCompany = () => {
    if (!newPost.trim()) return
    fetch(`/api/companies/${company.id}/posts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_da: newPost.trim(), text_en: newPost.trim() }),
    })
      .then(r => r.json())
      .then(post => {
        setCompanyPosts(prev => [post, ...prev])
        setNewPost('')
        setCpMediaFiles([])
        setCpMediaPreviews([])
        if (cpFileInputRef.current) cpFileInputRef.current.value = ''
      })
      .catch(() => {})
  }

  return (
    <div className="p-events" style={{ maxWidth: 720 }}>
      <button onClick={onBack} style={{ marginBottom: 16, background: 'none', border: 'none', color: '#2D6A4F', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
        ← {lang === 'da' ? 'Tilbage' : 'Back'}
      </button>

      {/* Company header */}
      <div className="p-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="p-company-logo" style={{ background: company.color, width: 72, height: 72, fontSize: 30, borderRadius: 16 }}>{company.name[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>{company.name}</h2>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{company.tagline}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, color: '#888', marginBottom: 12 }}>
              {company.industry && <span>🏭 {company.industry}</span>}
              {company.size && <span>👥 {company.size} {lang === 'da' ? 'medarbejdere' : 'employees'}</span>}
              {company.website && <span>🌐 <a href={company.website} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>{company.website.replace('https://', '').replace('http://', '')}</a></span>}
              <button
                onClick={() => {
                  setShowFollowersPopup(true)
                  if (!followers) {
                    fetch(`/api/companies/${company.id}/followers`, { credentials: 'include' })
                      .then(r => r.json())
                      .then(d => setFollowers(d.followers || []))
                      .catch(() => setFollowers([]))
                  }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontSize: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                title={lang === 'da' ? 'Se følgere' : 'View followers'}
              >
                ❤️ {(company.followers_count || 0).toLocaleString()} {t.companyFollowers}
              </button>
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
        {['posts', 'members', 'about', 'jobs'].map(tp => (
          <button key={tp} className={`p-filter-tab${tab === tp ? ' active' : ''}`} onClick={() => setTab(tp)}>
            {tp === 'posts' ? t.companyPosts : tp === 'members' ? t.companyMembers : tp === 'about' ? t.companyAbout : t.jobs}
            {tp === 'jobs' && companyJobs.length > 0 && <span style={{ marginLeft: 4, fontSize: 11 }}>({companyJobs.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'posts' && (
        <>
          {(isOwner || company.role === 'admin' || company.role === 'editor') && (
            <div className="p-card" style={{ marginBottom: 12 }}>
              <input ref={cpFileInputRef} type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
                multiple style={{ display: 'none' }} onChange={handleCpFileSelect} />
              <div className="p-new-post-row">
                <div style={{ width: 36, height: 36, borderRadius: 8, background: company.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>
                  {company.name[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <textarea
                    className="p-new-post-textarea"
                    placeholder={t.companyPost}
                    value={newPost}
                    onChange={e => setNewPost(e.target.value)}
                  />
                </div>
              </div>
              {cpMediaPreviews.length > 0 && (
                <div className="p-media-previews">
                  {cpMediaPreviews.map((p, i) => (
                    <div key={i} className="p-media-preview">
                      {p.type === 'video'
                        ? <video src={p.url} className="p-media-preview-thumb" />
                        : <img src={p.url} alt="" className="p-media-preview-thumb" />}
                      <button className="p-media-preview-remove" onClick={() => removeCpMedia(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-new-post-actions">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="p-media-popup-wrap">
                    <button
                      className={`p-media-popup-btn${cpMediaPopup ? ' active' : ''}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setCpMediaPopup(p => !p)}
                      title={lang === 'da' ? 'Tilføj medie' : 'Add media'}
                    >
                      +
                    </button>
                    {cpMediaPopup && (
                      <>
                        <div className="p-share-backdrop" onClick={() => setCpMediaPopup(false)} />
                        <div className="p-share-popup p-media-popup">
                          <button className="p-share-option" onMouseDown={e => e.preventDefault()} onClick={() => { cpFileInputRef.current?.click(); setCpMediaPopup(false) }}>
                            <span className="p-media-popup-icon">🖼️</span>
                            {lang === 'da' ? 'Galleri' : 'Gallery'}
                          </button>
                          <button className="p-share-option" onMouseDown={e => e.preventDefault()} onClick={() => { setCpMediaPopup(false); openCamera(handleCpFileSelect) }}>
                            <span className="p-media-popup-icon">📷</span>
                            {lang === 'da' ? 'Kamera' : 'Camera'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <button
                  className="p-post-btn"
                  disabled={!newPost.trim() && !cpMediaPreviews.length}
                  onClick={postCompany}
                >
                  {lang === 'da' ? 'Opslå' : 'Post'}
                </button>
              </div>
            </div>
          )}
          {postsLoading ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>⏳</div>
          ) : companyPosts.length === 0 ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>
              {lang === 'da' ? 'Ingen opslag endnu.' : 'No posts yet.'}
            </div>
          ) : companyPosts.map(post => {
            const liked = !!post.liked
            const commentCount = post.comment_count || 0
            const showComments = expandedCompanyComments.has(post.id)
            const postText = lang === 'da' ? (post.text_da || post.text_en) : (post.text_en || post.text_da)
            const timeAgo = new Date(post.created_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short' })
            return (
              <div key={post.id} className="p-card p-post" style={{ marginBottom: 12 }}>
                <div className="p-post-header">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: company.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>{company.name[0]}</div>
                  <div>
                    <div className="p-post-author">{company.name}</div>
                    <div className="p-post-time">{timeAgo}</div>
                  </div>
                </div>
                <div className="p-post-text">{postText}</div>
                <div className="p-post-stats">
                  <span onClick={() => toggleCompanyComments(post.id)} style={{ cursor: 'pointer' }}>{post.likes} {t.like.toLowerCase()}</span>
                  <span onClick={() => toggleCompanyComments(post.id)} style={{ cursor: 'pointer' }}>{commentCount} {t.comment.toLowerCase()}{lang === 'da' ? 'er' : 's'}</span>
                </div>
                <div className="p-post-actions">
                  <button className={`p-action-btn${liked ? ' liked' : ''}`} onClick={() => {
                    if (!showComments) toggleCompanyComments(post.id)
                    toggleCompanyLike(post.id)
                  }}>
                    {liked ? '❤️' : '🤍'} {t.like}
                  </button>
                  <button className="p-action-btn" onClick={() => toggleCompanyComments(post.id)}>
                    💬 {t.comment}
                  </button>
                </div>
                {showComments && (
                  <div className="p-comments">
                    {(companyCommentLists[post.id] || []).map(c => (
                      <div key={c.id} className="p-comment">
                        <div className="p-comment-bubble">
                          <span className="p-comment-author">{c.author_name}</span> {c.text}
                        </div>
                      </div>
                    ))}
                    <div className="p-comment-input-row">
                      <input className="p-comment-input" placeholder={t.writeComment}
                        value={companyCommentInputs[post.id] || ''}
                        onChange={e => setCompanyCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && addCompanyComment(post.id)} />
                      <button className="p-send-btn" onClick={() => addCompanyComment(post.id)}>{t.send}</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {tab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {membersLoading ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>⏳</div>
          ) : companyMembers.length === 0 ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>{t.companyNoMembers}</div>
          ) : companyMembers.map(member => {
            const connectStatus = memberConnectState[member.id]
            const isSelf = member.id === currentUser?.id
            const avatarSrc = member.avatar_url
              ? (member.avatar_url.startsWith('http') ? member.avatar_url : `/uploads/${member.avatar_url}`)
              : null
            return (
              <div key={member.id} className="p-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <div className="p-avatar-sm" style={{ background: nameToColor(member.name), flexShrink: 0 }}>
                  {avatarSrc ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : getInitials(member.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{member.name}</div>
                  {member.handle && <div style={{ fontSize: 12, color: '#888' }}>@{member.handle}</div>}
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                    {member.role === 'owner' ? t.companyRoleOwner : member.role === 'admin' ? t.companyRoleAdmin : t.companyRoleEditor}
                  </div>
                </div>
                {!isSelf && (
                  connectStatus === 'friend' ? (
                    <span style={{ fontSize: 12, color: '#2D6A4F', fontWeight: 600 }}>✓ {mode === 'business' ? t.connectionsLabel : t.friendsLabel}</span>
                  ) : connectStatus === 'sent' ? (
                    <span style={{ fontSize: 12, color: '#888' }}>{t.requestSent}</span>
                  ) : (
                    <button className="p-friend-add-btn p-friend-msg-btn" style={{ padding: '6px 14px', fontSize: 13 }}
                      onClick={() => connectWithMember(member.id)}>
                      + {mode === 'business' ? t.connectBtn : t.addFriend}
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'about' && (
        <div className="p-card">
          <h4 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>{lang === 'da' ? 'Om' : 'About'} {company.name}</h4>
          {company.description && (
            <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6, margin: '0 0 16px' }}>{company.description}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
            {company.company_type && (
              <div><span style={{ color: '#888' }}>{t.companyType}:</span> <strong>{company.company_type}</strong></div>
            )}
            {company.cvr && (
              <div><span style={{ color: '#888' }}>{t.companyCvr}:</span> <strong>{company.cvr}</strong></div>
            )}
            {company.founded_year && (
              <div><span style={{ color: '#888' }}>{t.companyFoundedYear}:</span> <strong>{company.founded_year}</strong></div>
            )}
            {company.industry && (
              <div><span style={{ color: '#888' }}>{t.companyIndustry}:</span> <strong>{company.industry}</strong></div>
            )}
            {company.size && (
              <div><span style={{ color: '#888' }}>{t.companySize}:</span> <strong>{company.size}</strong></div>
            )}
            {company.address && (
              <div style={{ gridColumn: 'span 2' }}><span style={{ color: '#888' }}>📍 {t.companyAddress}:</span> <strong>{company.address}</strong></div>
            )}
            {company.phone && (
              <div><span style={{ color: '#888' }}>📞 {t.companyPhone}:</span> <a href={`tel:${company.phone}`} style={{ color: '#1877F2' }}>{company.phone}</a></div>
            )}
            {company.email && (
              <div><span style={{ color: '#888' }}>✉️ {t.companyEmail}:</span> <a href={`mailto:${company.email}`} style={{ color: '#1877F2' }}>{company.email}</a></div>
            )}
            {company.website && (
              <div><span style={{ color: '#888' }}>🌐 {t.companyWebsite}:</span> <a href={company.website} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>{company.website.replace(/^https?:\/\//, '')}</a></div>
            )}
            {company.linkedin && (
              <div><span style={{ color: '#888' }}>LinkedIn:</span> <a href={company.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#1877F2' }}>{lang === 'da' ? 'Profil' : 'Profile'}</a></div>
            )}
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isOwner && (
            <button
              onClick={() => setShowCreateJobModal(true)}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, alignSelf: 'flex-start' }}
            >
              + {t.createJob}
            </button>
          )}
          {postsLoading ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>⏳</div>
          ) : companyJobs.length === 0 ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 32, color: '#888' }}>{t.jobNoJobs}</div>
          ) : companyJobs.map(job => (
            <JobCard key={job.id} job={{ ...job, companyName: company.name, companyColor: company.color, company_name: company.name, company_color: company.color }} t={t} lang={lang}
              onSaveToggle={(id, saved) => setCompanyJobs(prev => prev.map(j => j.id === id ? { ...j, saved } : j))} />
          ))}
        </div>
      )}

      {/* Create Job Modal from Company Page */}
      {showCreateJobModal && (
        <CreateJobModal
          t={t}
          lang={lang}
          companies={[{ id: company.id, name: company.name }]}
          onClose={() => setShowCreateJobModal(false)}
          onCreate={(job) => {
            setCompanyJobs(prev => [{ ...job, company_name: company.name, company_color: company.color }, ...prev])
            setShowCreateJobModal(false)
          }}
        />
      )}

      {/* Followers Popup */}
      {showFollowersPopup && (
        <div className="modal-backdrop" onClick={() => setShowFollowersPopup(false)}>
          <div className="p-card" onClick={e => e.stopPropagation()} style={{ padding: 24, maxWidth: 400, width: '90%', maxHeight: '70vh', overflowY: 'auto', borderRadius: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>❤️ {lang === 'da' ? 'Følgere' : 'Followers'} ({company.followers_count || 0})</h3>
              <button onClick={() => setShowFollowersPopup(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>✕</button>
            </div>
            {!followers ? (
              <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>⏳</div>
            ) : followers.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>{lang === 'da' ? 'Ingen følgere endnu' : 'No followers yet'}</div>
            ) : followers.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #F0EDE9' }}>
                <div className="p-avatar-sm" style={{ background: nameToColor(f.name), flexShrink: 0 }}>{getInitials(f.name)}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                  {f.handle && <div style={{ fontSize: 12, color: '#888' }}>{f.handle}</div>}
                </div>
              </div>
            ))}
          </div>
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
  const [cvr, setCvr] = useState('')
  const [companyType, setCompanyType] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [foundedYear, setFoundedYear] = useState('')

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fS = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lS = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 14 }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const handle = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const res = await fetch('/api/companies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          handle: `@${handle}`,
          tagline: tagline.trim() || null,
          website: website.trim() || null,
          industry: industry.trim() || null,
          size: size || null,
          description: description.trim() || null,
          color: nameToColor(name),
          cvr: cvr.trim() || null,
          company_type: companyType || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          linkedin: linkedin.trim() || null,
          founded_year: foundedYear ? Number(foundedYear) : null,
        }),
      })
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Fejl'); return }
      const company = await res.json()
      onCreate({ ...company, member_role: 'owner', followers_count: 0 })
    } catch { alert(lang === 'da' ? 'Netværksfejl' : 'Network error') }
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lS}>{t.companyCvr}</label>
              <input style={fS} value={cvr} onChange={e => setCvr(e.target.value)} placeholder="12345678" />
            </div>
            <div>
              <label style={lS}>{t.companyType}</label>
              <select style={fS} value={companyType} onChange={e => setCompanyType(e.target.value)}>
                <option value="">—</option>
                {(t.companyTypes || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <label style={lS}>{t.companyIndustry}</label>
          <input style={fS} value={industry} onChange={e => setIndustry(e.target.value)} placeholder={lang === 'da' ? 'f.eks. Software & SaaS' : 'e.g. Software & SaaS'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lS}>{t.companySize}</label>
              <select style={fS} value={size} onChange={e => setSize(e.target.value)}>
                <option value="">—</option>
                {(t.companySizes || ['1–10', '11–50', '51–200', '201–500', '500+']).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={lS}>{t.companyFoundedYear}</label>
              <input style={fS} type="number" value={foundedYear} onChange={e => setFoundedYear(e.target.value)} placeholder="2010" min="1800" max={new Date().getFullYear()} />
            </div>
          </div>
          <label style={lS}>{t.companyAddress}</label>
          <input style={fS} value={address} onChange={e => setAddress(e.target.value)} placeholder={lang === 'da' ? 'Adresse, By' : 'Address, City'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lS}>{t.companyPhone}</label>
              <input style={fS} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+45 12 34 56 78" />
            </div>
            <div>
              <label style={lS}>{t.companyEmail}</label>
              <input style={fS} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="info@firma.dk" />
            </div>
          </div>
          <label style={lS}>{t.companyWebsite}</label>
          <input style={fS} type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
          <label style={lS}>{t.companyLinkedin}</label>
          <input style={fS} value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/company/..." />
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
function JobCard({ job, t, lang, onSaveToggle }) {
  const [isSaved, setIsSaved] = useState(!!job.saved)
  const companyName = job.company_name || job.companyName || ''
  const companyColor = job.company_color || job.companyColor || '#1877F2'
  const title = typeof job.title === 'string' ? job.title : (job.title?.[lang] || job.title?.da || '')
  const desc = typeof job.description === 'string' ? job.description : (job.description?.[lang] || job.description?.da || '')
  const reqs = typeof job.requirements === 'string' ? job.requirements : (job.requirements?.[lang] || job.requirements?.da || '')
  const applyLink = job.apply_link || job.applyLink || ''
  const postedDate = job.created_at ? new Date(job.created_at).toLocaleDateString() : (job.postedDate || '')
  const typeLabels = { fulltime: t.jobTypeFullTime, parttime: t.jobTypePartTime, freelance: t.jobTypeFreelance, internship: t.jobTypeInternship }

  const toggleSave = () => {
    fetch(`/api/jobs/${job.id}/save`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setIsSaved(data.saved)
        onSaveToggle?.(job.id, data.saved)
      })
      .catch(() => {})
  }

  return (
    <div className="p-card p-job-card">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: companyColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 20, flexShrink: 0 }}>
          {companyName[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
            {companyName} · {job.location}
            {!!job.remote && <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#F0FAF4', color: '#2D6A4F', fontWeight: 600 }}>{t.jobRemote}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="p-event-type-badge">{typeLabels[job.type] || job.type}</span>
            <span style={{ fontSize: 12, color: '#999' }}>{postedDate}</span>
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
          {job.deadline && (
            <div style={{ fontSize: 12, color: '#c0392b', fontWeight: 600, marginBottom: 8 }}>
              ⏳ {t.jobDeadline}: {new Date(job.deadline).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {applyLink && (
              <a
                href={applyLink.startsWith('http') ? applyLink : `mailto:${applyLink}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-events-create-btn"
                style={{ textDecoration: 'none', display: 'inline-block', padding: '8px 18px', fontSize: 13 }}
              >
                {t.jobApply} →
              </a>
            )}
            {job.contact_email && (
              <a
                href={`mailto:${job.contact_email}`}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', color: '#555', fontWeight: 600, fontSize: 13, textDecoration: 'none', display: 'inline-block' }}
              >
                ✉️ {t.jobContact}
              </a>
            )}
            <button
              onClick={toggleSave}
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
  const [jobs, setJobs] = useState([])
  const [savedJobs, setSavedJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [filterType, setFilterType] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [myCompanies, setMyCompanies] = useState([])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterKeyword) params.set('q', filterKeyword)
    if (filterType) params.set('type', filterType)
    setLoading(true)
    fetch(`/api/jobs?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setJobs(data.jobs || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filterKeyword, filterType])

  useEffect(() => {
    if (tab === 'saved') {
      fetch('/api/jobs/saved', { credentials: 'include' })
        .then(r => r.json())
        .then(data => setSavedJobs(data.jobs || []))
        .catch(() => {})
    }
  }, [tab])

  useEffect(() => {
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setMyCompanies((data.companies || []).filter(c => c.member_role === 'owner' || c.member_role === 'admin')))
      .catch(() => {})
  }, [])

  const displayJobs = tab === 'saved' ? savedJobs : jobs.filter(j => {
    if (filterLocation && !j.location?.toLowerCase().includes(filterLocation.toLowerCase()) && !j.remote) return false
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
          {t.savedJobs} ({savedJobs.length})
        </button>
      </div>

      {loading ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>⏳</div>
      ) : displayJobs.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>{t.jobNoJobs}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayJobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              t={t}
              lang={lang}
              onSaveToggle={(id, saved) => {
                setJobs(prev => prev.map(j => j.id === id ? { ...j, saved } : j))
                setSavedJobs(prev => saved ? [...prev, job] : prev.filter(j => j.id !== id))
              }}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateJobModal
          t={t}
          lang={lang}
          companies={myCompanies}
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
  const [contactEmail, setContactEmail] = useState('')
  const [deadline, setDeadline] = useState('')

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fS = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lS = { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, marginTop: 14 }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: Number(companyId) || companies[0]?.id,
          title: title.trim(),
          location: location.trim() || null,
          remote,
          type,
          description: description.trim() || null,
          requirements: requirements.trim() || null,
          apply_link: applyLink.trim() || null,
          contact_email: contactEmail.trim() || null,
          deadline: deadline || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Fejl'); return }
      const job = await res.json()
      onCreate(job)
    } catch { alert(lang === 'da' ? 'Netværksfejl' : 'Network error') }
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
          <input style={fS} value={applyLink} onChange={e => setApplyLink(e.target.value)} placeholder="https://..." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lS}>{t.jobContactEmail}</label>
              <input style={fS} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="job@firma.dk" />
            </div>
            <div>
              <label style={lS}>{t.jobDeadline}</label>
              <input style={fS} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 }}>{t.eventCancel}</button>
            <button type="submit" style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{t.jobPost}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Marketplace ──
const MARKETPLACE_CATEGORIES = [
  { key: 'electronics', icon: '🖥️', labelKey: 'marketplaceCatElectronics' },
  { key: 'furniture',   icon: '🪑', labelKey: 'marketplaceCatFurniture' },
  { key: 'clothing',    icon: '👕', labelKey: 'marketplaceCatClothing' },
  { key: 'sports',      icon: '⚽', labelKey: 'marketplaceCatSports' },
  { key: 'books',       icon: '📚', labelKey: 'marketplaceCatBooks' },
  { key: 'garden',      icon: '🌱', labelKey: 'marketplaceCatGarden' },
  { key: 'vehicles',    icon: '🚗', labelKey: 'marketplaceCatVehicles' },
  { key: 'other',       icon: '📦', labelKey: 'marketplaceCatOther' },
]

const MOCK_LISTINGS = [
  { id: 1, title: { da: 'iPhone 13 Pro — næsten ny', en: 'iPhone 13 Pro — nearly new' }, price: 3200, priceNegotiable: false, description: { da: 'Sælger min iPhone 13 Pro 256GB. Ingen ridser, altid haft cover og skærmbeskytter. Original æske medfølger.', en: 'Selling my iPhone 13 Pro 256GB. No scratches, always had a case and screen protector. Original box included.' }, category: 'electronics', location: 'Frederiksberg', photos: [], seller: 'Magnus Jensen', sellerId: 'mock-magnus', postedAt: '2026-02-18', sold: false, mobilepay: '20123456' },
  { id: 2, title: { da: 'IKEA KALLAX hylde 2×4 — hvid', en: 'IKEA KALLAX shelf unit 2×4 — white' }, price: 450, priceNegotiable: true, description: { da: 'Velholdt KALLAX hylde med 8 rum. Afhentes i Valby.', en: 'Well-kept KALLAX shelf with 8 compartments. Pick-up in Valby.' }, category: 'furniture', location: 'Valby, København', photos: [], seller: 'Clara Johansen', sellerId: 'mock-clara', postedAt: '2026-02-17', sold: false, mobilepay: '31456789' },
  { id: 3, title: { da: 'Vintage vinterjjakke — str. M', en: 'Vintage winter jacket — size M' }, price: 280, priceNegotiable: true, description: { da: 'Fed vintage jakke fra 90erne. Str. M, svarer til 38–40.', en: 'Cool vintage jacket from the 90s. Size M, fits 38–40.' }, category: 'clothing', location: 'Nørrebro, København', photos: [], seller: 'Astrid Poulsen', sellerId: 'mock-astrid', postedAt: '2026-02-15', sold: false },
  { id: 4, title: { da: 'Trek MTB cykel — 26 tommer', en: 'Trek MTB bicycle — 26 inch' }, price: 1800, priceNegotiable: false, description: { da: 'Trek Marlin 5, 2020-model. Ny kæde og bremser i 2025. Sælges pga. opgradering.', en: 'Trek Marlin 5, 2020 model. New chain and brakes in 2025. Selling due to upgrade.' }, category: 'sports', location: 'Aarhus C', photos: [], seller: 'Emil Larsen', sellerId: 'mock-emil', postedAt: '2026-02-14', sold: false },
  { id: 5, title: { da: 'Harry Potter — komplet boksæt (DA)', en: 'Harry Potter — complete box set (DK edition)' }, price: 150, priceNegotiable: false, description: { da: 'Alle 7 bøger på dansk i original boks. Lidt slidte, men komplette.', en: 'All 7 books in Danish in original box. Slightly worn but complete.' }, category: 'books', location: 'Odense', photos: [], seller: 'Alma Hansen', sellerId: 'mock-alma', postedAt: '2026-02-13', sold: true },
  { id: 6, title: { da: 'Weber kuglegrill — 57 cm', en: 'Weber kettle grill — 57 cm' }, price: 600, priceNegotiable: true, description: { da: 'Weber One-Touch 57 cm. Brugt 2 sæsoner, ellers i perfekt stand.', en: 'Weber One-Touch 57cm. Used 2 seasons, otherwise in perfect condition.' }, category: 'garden', location: 'Hellerup', photos: [], seller: 'Liam Madsen', sellerId: 'mock-liam', postedAt: '2026-02-12', sold: false },
]

function MarketplacePage({ lang, t, currentUser, onContactSeller }) {
  const [tab, setTab] = useState('browse')
  const [listings, setListings] = useState(MOCK_LISTINGS)
  const [myListings, setMyListings] = useState([])
  const [filters, setFilters] = useState({ category: '', location: '', q: '' })
  const [selectedListing, setSelectedListing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editListing, setEditListing] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [boostedIds, setBoostedIds] = useState({})
  const [boostMsg, setBoostMsg] = useState(null)
  const [formError, setFormError] = useState(null)

  const catIcon = (key) => MARKETPLACE_CATEGORIES.find(c => c.key === key)?.icon || '📦'
  const catLabel = (key) => { const f = MARKETPLACE_CATEGORIES.find(c => c.key === key); return f ? `${f.icon} ${t[f.labelKey] || key}` : key }
  const listingTitle = (l) => typeof l.title === 'string' ? l.title : (l.title?.[lang] || l.title?.da || '')
  const listingDesc  = (l) => typeof l.description === 'string' ? l.description : (l.description?.[lang] || l.description?.da || '')

  useEffect(() => {
    apiFetchListings(filters).then(data => {
      const apiListings = data?.listings || (Array.isArray(data) ? data : null)
      if (apiListings) {
        // Merge: real DB listings first, then mock placeholders not already in DB (by id)
        const apiIds = new Set(apiListings.map(l => l.id))
        setListings([...apiListings, ...MOCK_LISTINGS.filter(m => !apiIds.has(m.id))])
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'mine') return
    apiFetchMyListings().then(data => { if (data?.listings || Array.isArray(data)) setMyListings(data?.listings || data) })
  }, [tab])

  const filtered = listings.filter(l => {
    if (l.sold) return false  // hide sold listings in Browse
    if (filters.category && l.category !== filters.category) return false
    if (filters.location && !l.location?.toLowerCase().includes(filters.location.toLowerCase())) return false
    if (filters.q) {
      const q = filters.q.toLowerCase()
      if (!listingTitle(l).toLowerCase().includes(q) && !listingDesc(l).toLowerCase().includes(q)) return false
    }
    return true
  })

  const handleCreate = async (formData, localListing) => {
    const result = await apiCreateListing(formData)
    const newL = result?.id ? result : { ...localListing, id: Date.now(), seller: currentUser.name, sellerId: currentUser.id, postedAt: new Date().toISOString().slice(0, 10), sold: false }
    setListings(prev => [newL, ...prev])
    setMyListings(prev => [newL, ...prev])
    setShowForm(false)
  }

  const handleUpdate = async (id, formData, localListing) => {
    try {
      setFormError(null)
      const result = await apiUpdateListing(id, formData)
      const updated = result || localListing
      setListings(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
      setMyListings(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
      setShowForm(false)
      setEditListing(null)
    } catch (err) {
      console.error('handleUpdate error:', err)
      setFormError(err.message || 'Der skete en fejl – prøv igen')
    }
  }

  const handleMarkSold = async (id) => {
    await apiMarkListingSold(id)
    setListings(prev => prev.map(l => l.id === id ? { ...l, sold: true } : l))
    setMyListings(prev => prev.map(l => l.id === id ? { ...l, sold: true } : l))
  }

  const handleRelist = async (id) => {
    await apiRelistListing(id)
    const today = new Date().toISOString().slice(0, 10)
    setListings(prev => prev.map(l => l.id === id ? { ...l, sold: false, postedAt: today } : l))
    setMyListings(prev => prev.map(l => l.id === id ? { ...l, sold: false, postedAt: today } : l))
  }

  const handleDelete = async (id) => {
    await apiDeleteListing(id)
    setListings(prev => prev.filter(l => l.id !== id))
    setMyListings(prev => prev.filter(l => l.id !== id))
    setDeleteConfirmId(null)
  }

  const handleBoost = async (id) => {
    const res = await apiBoostListing(id).catch(() => null)
    if (res?.checkoutUrl) {
      window.location.href = res.checkoutUrl
    } else {
      // Stripe not yet configured — show info message
      setBoostedIds(prev => ({ ...prev, [id]: true }))
      setBoostMsg(t.marketplaceBoostSuccess)
      setTimeout(() => setBoostMsg(null), 4000)
    }
  }

  const displayListings = tab === 'mine' ? myListings : filtered

  return (
    <div className="p-marketplace">
      {boostMsg && (
        <div style={{ background: '#40916C', color: '#fff', padding: '10px 16px', borderRadius: 8, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
          {boostMsg}
        </div>
      )}
      <div className="p-marketplace-header">
        <h2 className="p-section-title" style={{ margin: 0 }}>{t.marketplaceTitle}</h2>
        <button className="p-marketplace-create-btn" onClick={() => { setEditListing(null); setFormError(null); setShowForm(true) }}>
          {t.marketplaceCreateBtn}
        </button>
      </div>

      <div className="p-filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`p-filter-tab${tab === 'browse' ? ' active' : ''}`} onClick={() => setTab('browse')}>
          🔍 {t.marketplaceBrowse}
        </button>
        <button className={`p-filter-tab${tab === 'mine' ? ' active' : ''}`} onClick={() => setTab('mine')}>
          📋 {t.marketplaceMyListings}
        </button>
      </div>

      {tab === 'browse' && (
        <div className="p-marketplace-filters">
          <div style={{ position: 'relative' }}>
            <input
              className="p-search-input p-marketplace-search"
              style={{ width: '100%', boxSizing: 'border-box', paddingRight: filters.q ? 32 : undefined }}
              placeholder={t.marketplaceSearchPlaceholder}
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            />
            {filters.q && (
              <button onClick={() => setFilters(f => ({ ...f, q: '' }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: 2 }}>✕</button>
            )}
          </div>
          <div className="p-marketplace-filter-row">
            <select
              className="p-marketplace-select"
              value={filters.category}
              onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
            >
              <option value="">{t.marketplaceFilterAll}</option>
              {MARKETPLACE_CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.icon} {t[c.labelKey]}</option>
              ))}
            </select>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                className="p-marketplace-location-input"
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: filters.location ? 32 : 12 }}
                placeholder={lang === 'da' ? '📍 By eller område...' : '📍 City or area...'}
                value={filters.location}
                onChange={e => setFilters(f => ({ ...f, location: e.target.value }))}
              />
              {filters.location && (
                <button onClick={() => setFilters(f => ({ ...f, location: '' }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: 2 }}>✕</button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'mine' && myListings.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🛍️</div>
          <div style={{ marginBottom: 16 }}>{t.marketplaceNoMyListings}</div>
          <button className="p-marketplace-create-btn" onClick={() => { setEditListing(null); setFormError(null); setShowForm(true) }}>
            {t.marketplaceCreateFirst}
          </button>
        </div>
      ) : displayListings.length === 0 ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          🔍 {t.marketplaceNoListings}
        </div>
      ) : (
        <div className="p-marketplace-grid">
          {displayListings.map(listing => (
            <div
              key={listing.id}
              className={`p-card p-listing-card${listing.sold ? ' p-listing-sold' : ''}`}
              onClick={() => setSelectedListing(listing)}
            >
              <div className="p-listing-photo-wrap">
                {listing.photos?.length > 0 ? (
                  <img
                    className="p-listing-photo"
                    src={listing.photos[0].url || listing.photos[0]}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="p-listing-photo-placeholder">{catIcon(listing.category)}</div>
                )}
                {listing.sold && <div className="p-listing-sold-badge">{t.marketplaceSold}</div>}
                {boostedIds[listing.id] && <div className="p-listing-sold-badge" style={{ background: '#F4A261' }}>{t.marketplaceBoosted}</div>}
              </div>
              <div className="p-listing-body">
                <div className="p-listing-price">
                  {listing.priceNegotiable
                    ? t.marketplacePriceNegotiable
                    : `${listing.price.toLocaleString()} ${lang === 'da' ? 'kr.' : 'DKK'}`}
                </div>
                <div className="p-listing-title">{listingTitle(listing)}</div>
                <div className="p-listing-meta">
                  <span>{catLabel(listing.category)}</span>
                  <span>📍 {listing.location}</span>
                  <span style={{ color: '#aaa' }}>👤 {listing.seller}</span>
                </div>
                {tab === 'mine' && (
                  <div className="p-listing-actions" onClick={e => e.stopPropagation()}>
                    {!listing.sold && !boostedIds[listing.id] && (
                      <button className="p-listing-action-btn" style={{ color: '#F4A261', borderColor: '#F4A261' }} onClick={() => handleBoost(listing.id)}>
                        {t.marketplaceBoostBtn}
                      </button>
                    )}
                    {!listing.sold && (
                      <button className="p-listing-action-btn" onClick={() => handleMarkSold(listing.id)}>
                        ✓ {t.marketplaceMarkSold}
                      </button>
                    )}
                    {listing.sold && (
                      <button className="p-listing-action-btn" style={{ color: '#2D6A4F', borderColor: '#2D6A4F' }} onClick={() => handleRelist(listing.id)}>
                        ↺ {lang === 'da' ? 'Genopslå' : 'Relist'}
                      </button>
                    )}
                    <button className="p-listing-action-btn" onClick={() => { setEditListing(listing); setFormError(null); setShowForm(true) }}>
                      ✏️ {t.marketplaceEdit}
                    </button>
                    <button className="p-listing-action-btn danger" onClick={() => setDeleteConfirmId(listing.id)}>
                      🗑 {t.marketplaceDelete}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteConfirmId && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="p-msg-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="p-msg-modal-header">
              <span>{t.marketplaceDelete}</span>
              <button className="p-msg-modal-close" onClick={() => setDeleteConfirmId(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555' }}>{t.marketplaceDeleteConfirm}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="p-msg-modal-btn secondary" onClick={() => setDeleteConfirmId(null)}>{t.marketplaceCancel}</button>
                <button className="p-msg-modal-btn primary" style={{ background: '#C0392B' }} onClick={() => handleDelete(deleteConfirmId)}>
                  {t.marketplaceDelete}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedListing && (
        <ListingDetailModal
          listing={selectedListing}
          t={t}
          lang={lang}
          currentUser={currentUser}
          catLabel={catLabel}
          catIcon={catIcon}
          listingTitle={listingTitle}
          listingDesc={listingDesc}
          onClose={() => setSelectedListing(null)}
          onContactSeller={onContactSeller}
          onEdit={() => {
            setEditListing(selectedListing)
            setFormError(null)
            setShowForm(true)
            setSelectedListing(null)
          }}
          onMarkSold={async () => {
            await handleMarkSold(selectedListing.id)
            setSelectedListing(null) // close modal — listing disappears from browse
          }}
        />
      )}

      {showForm && (
        <ListingFormModal
          t={t}
          lang={lang}
          listing={editListing}
          listingTitle={listingTitle}
          listingDesc={listingDesc}
          formError={formError}
          onClose={() => { setShowForm(false); setEditListing(null); setFormError(null) }}
          onSubmit={editListing ? handleUpdate : handleCreate}
        />
      )}
    </div>
  )
}

function ListingDetailModal({ listing, t, lang, currentUser, catLabel, catIcon, listingTitle, listingDesc, onClose, onContactSeller, onEdit, onMarkSold }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const isOwn = listing.seller === currentUser?.name || listing.sellerId === currentUser?.id

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-listing-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="p-listing-detail-close" onClick={onClose}>✕</button>
        {listing.photos?.length > 0 ? (
          <div className={`p-post-media p-post-media-${Math.min(listing.photos.length, 4)} p-listing-detail-photos`}>
            {listing.photos.slice(0, 4).map((p, i) => (
              <img key={i} className="p-media-item" src={p.url || p} alt="" loading="lazy" />
            ))}
          </div>
        ) : (
          <div className="p-listing-detail-no-photo">
            <span style={{ fontSize: 56 }}>{catIcon(listing.category)}</span>
          </div>
        )}
        <div className="p-listing-detail-body">
          {listing.sold ? <div className="p-listing-sold-badge p-listing-sold-badge-lg">{t.marketplaceSold}</div> : null}
          <div className="p-listing-detail-price">
            {listing.priceNegotiable
              ? t.marketplacePriceNegotiable
              : `${listing.price.toLocaleString()} ${lang === 'da' ? 'kr.' : 'DKK'}`}
          </div>
          <h2 className="p-listing-detail-title">{listingTitle(listing)}</h2>
          <div className="p-listing-detail-meta">
            <span>{catLabel(listing.category)}</span>
            <span>📍 {listing.location}</span>
            {listing.postedAt && <span>📅 {listing.postedAt}</span>}
          </div>
          {/* Seller info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#F7F5F2', borderRadius: 10, marginTop: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#2D6A4F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
              {listing.seller?.[0]?.toUpperCase() || '?'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A' }}>{listing.seller}</div>
              <div style={{ fontSize: 12, color: '#aaa' }}>{lang === 'da' ? 'Sælger' : 'Seller'}{listing.postedAt ? ` · ${listing.postedAt}` : ''}</div>
            </div>
          </div>
          {listingDesc(listing) && <p className="p-listing-detail-desc">{listingDesc(listing)}</p>}

          {/* Owner actions */}
          {isOwn && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                className="p-marketplace-create-btn"
                style={{ flex: 1, justifyContent: 'center', background: '#fff', color: '#2D6A4F', border: '1.5px solid #2D6A4F' }}
                onClick={() => { onEdit?.(); }}
              >
                ✏️ {lang === 'da' ? 'Rediger' : 'Edit'}
              </button>
              {!listing.sold && (
                <button
                  className="p-marketplace-create-btn"
                  style={{ flex: 1, justifyContent: 'center', background: '#fff', color: '#E07B39', border: '1.5px solid #E07B39' }}
                  onClick={() => { onMarkSold?.(); }}
                >
                  ✅ {lang === 'da' ? 'Marker som solgt' : 'Mark as sold'}
                </button>
              )}
            </div>
          )}

          {/* Contact section for other users */}
          {!isOwn && !listing.sold && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {/* Primary: Fellis messages — always default for public listings */}
              {typeof listing.sellerId === 'number' && listing.sellerId > 0 ? (
                <button
                  className="p-marketplace-create-btn"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => { onContactSeller(listing.sellerId); onClose() }}
                >
                  💬 {t.marketplaceContactSeller}
                </button>
              ) : (
                <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13, padding: '4px 0' }}>
                  {lang === 'da' ? 'Sælgeren er ikke på Fellis' : 'Seller is not on Fellis'}
                </div>
              )}
              {/* Additional contact options */}
              {(listing.mobilepay || listing.contact_phone || listing.contact_email) && (
                <div style={{ borderTop: '1px solid #f0ebe5', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginBottom: 2 }}>
                    {lang === 'da' ? 'Andre kontaktmuligheder' : 'Other contact options'}
                  </div>
                  {listing.mobilepay && (
                    <a href={`mobilepay://send?phone=${listing.mobilepay}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, border: '2px solid #5A78FF', color: '#5A78FF', fontWeight: 700, fontSize: 14, textDecoration: 'none', background: '#fff' }}>
                      📱 MobilePay · {listing.mobilepay}
                    </a>
                  )}
                  {listing.contact_phone && (
                    <a href={`tel:${listing.contact_phone}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, border: '1.5px solid #ddd', color: '#333', fontWeight: 600, fontSize: 14, textDecoration: 'none', background: '#fff' }}>
                      📞 {listing.contact_phone}
                    </a>
                  )}
                  {listing.contact_email && (
                    <a href={`mailto:${listing.contact_email}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, border: '1.5px solid #ddd', color: '#333', fontWeight: 600, fontSize: 14, textDecoration: 'none', background: '#fff' }}>
                      ✉️ {listing.contact_email}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ListingFormModal({ t, lang, listing, listingTitle, listingDesc, formError, onClose, onSubmit }) {
  const isEdit = !!listing
  const sanitize = (v) => (!v || v === '[object Object]') ? '' : v
  const [title, setTitle]           = useState(isEdit ? sanitize(listingTitle(listing)) : '')
  const [price, setPrice]           = useState(isEdit ? (listing.price || '') : '')
  const [negotiable, setNegotiable] = useState(isEdit ? !!listing.priceNegotiable : false)
  const [category, setCategory]     = useState(isEdit ? (listing.category || '') : '')
  const [location, setLocation]     = useState(isEdit ? (listing.location || '') : '')
  const [description, setDescription] = useState(isEdit ? sanitize(listingDesc(listing)) : '')
  const [mobilepay, setMobilepay]   = useState(isEdit ? (listing.mobilepay || '') : '')
  const [phone, setPhone]           = useState(isEdit ? (listing.contact_phone || '') : '')
  const [contactEmail, setContactEmail] = useState(isEdit ? (listing.contact_email || '') : '')
  const [photoFiles, setPhotoFiles] = useState([])
  const [photoPreviews, setPhotoPreviews] = useState(
    isEdit ? (listing.photos || []).map(p => p.url || p) : []
  )
  const fileInputRef = useRef(null)

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files).slice(0, 4 - photoPreviews.length)
    if (!files.length) return
    setPhotoFiles(prev => [...prev, ...files].slice(0, 4))
    setPhotoPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))].slice(0, 4))
  }

  const removePhoto = (i) => {
    const url = photoPreviews[i]
    setPhotoPreviews(prev => prev.filter((_, idx) => idx !== i))
    if (url?.startsWith('blob:')) {
      // photoFiles only holds NEW files; find this file's index by counting blob URLs before i
      const fileIdx = photoPreviews.slice(0, i).filter(u => u.startsWith('blob:')).length
      setPhotoFiles(prev => prev.filter((_, idx) => idx !== fileIdx))
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim() || (!negotiable && !price) || !category || !location.trim()) return
    const localListing = {
      title: { da: title, en: title },
      price: negotiable ? 0 : Number(price),
      priceNegotiable: negotiable,
      category,
      location,
      description: { da: description, en: description },
      photos: photoPreviews.map(url => ({ url })),
      mobilepay: mobilepay.trim() || null,
      contact_phone: phone.trim() || null,
      contact_email: contactEmail.trim() || null,
    }
    const formData = new FormData()
    formData.append('title', title)
    formData.append('price', negotiable ? 0 : price)
    formData.append('priceNegotiable', negotiable)
    formData.append('category', category)
    formData.append('location', location)
    formData.append('description', description)
    if (mobilepay.trim()) formData.append('mobilepay', mobilepay.trim())
    if (phone.trim()) formData.append('contact_phone', phone.trim())
    if (contactEmail.trim()) formData.append('contact_email', contactEmail.trim())
    if (isEdit) {
      // Tell server which existing photos to keep — append BEFORE file uploads so multer parses it first
      const existingPhotos = photoPreviews
        .filter(url => !url.startsWith('blob:'))
        .map(url => ({ url, type: 'image' }))
      formData.append('existingPhotos', JSON.stringify(existingPhotos))
    }
    photoFiles.forEach(f => formData.append('photos', f))
    if (isEdit) {
      onSubmit(listing.id, formData, localListing)
    } else {
      onSubmit(formData, localListing)
    }
  }

  const fS = { width: '100%', padding: '8px 10px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }
  const lS = { fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-listing-form-modal" onClick={e => e.stopPropagation()}>
        <div className="p-msg-modal-header">
          <span>{isEdit ? t.marketplaceEditTitle : t.marketplaceFormTitle}</span>
          <button className="p-msg-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px', overflowY: 'auto', maxHeight: 'calc(90vh - 60px)' }}>
          <label style={lS}>{t.marketplaceFieldTitle}</label>
          <input style={fS} value={title} onChange={e => setTitle(e.target.value)} placeholder={lang === 'da' ? 'Hvad sælger du?' : 'What are you selling?'} required />

          <label style={lS}>{t.marketplaceFieldCategory}</label>
          <select style={fS} value={category} onChange={e => setCategory(e.target.value)} required>
            <option value="">{lang === 'da' ? 'Vælg kategori...' : 'Choose category...'}</option>
            {MARKETPLACE_CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>{c.icon} {t[c.labelKey]}</option>
            ))}
          </select>

          <label style={lS}>{t.marketplaceFieldPrice}</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <input
              style={{ ...fS, marginBottom: 0, flex: 1 }}
              type="number"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder={lang === 'da' ? 'f.eks. 500' : 'e.g. 500'}
              disabled={negotiable}
              required={!negotiable}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" checked={negotiable} onChange={e => setNegotiable(e.target.checked)} />
              {t.marketplaceFieldNegotiable}
            </label>
          </div>

          <label style={lS}>{t.marketplaceFieldLocation}</label>
          <input style={fS} value={location} onChange={e => setLocation(e.target.value)} placeholder={lang === 'da' ? 'f.eks. Nørrebro, København' : 'e.g. Nørrebro, Copenhagen'} required />

          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <label style={lS}>{lang === 'da' ? 'Ekstra kontaktmuligheder (valgfrit)' : 'Extra contact options (optional)'}</label>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              {lang === 'da' ? '💬 Fellis beskeder er standard — tilføj ekstra muligheder nedenfor hvis ønsket' : '💬 Fellis messages is the default — add extra options below if desired'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📱</span>
            <input style={{ ...fS, marginBottom: 0, flex: 1 }} value={mobilepay} onChange={e => setMobilepay(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={lang === 'da' ? 'MobilePay (f.eks. 20123456)' : 'MobilePay (e.g. 20123456)'} maxLength={8} inputMode="numeric" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📞</span>
            <input style={{ ...fS, marginBottom: 0, flex: 1 }} value={phone} onChange={e => setPhone(e.target.value)} placeholder={lang === 'da' ? 'Telefonnummer (valgfrit)' : 'Phone number (optional)'} inputMode="tel" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>✉️</span>
            <input style={{ ...fS, marginBottom: 0, flex: 1 }} value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder={lang === 'da' ? 'E-mailadresse (valgfrit)' : 'Email address (optional)'} type="email" />
          </div>

          <label style={lS}>{t.marketplaceFieldDescription}</label>
          <textarea style={{ ...fS, minHeight: 80, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder={lang === 'da' ? 'Beskriv varen...' : 'Describe the item...'} />

          <label style={lS}>{t.marketplaceFieldPhotos}</label>
          <div className="p-listing-photo-upload-row">
            {photoPreviews.map((src, i) => (
              <div key={i} className="p-listing-upload-thumb">
                <img src={src} alt="" />
                <button type="button" className="p-listing-upload-remove" onClick={() => removePhoto(i)}>✕</button>
              </div>
            ))}
            {photoPreviews.length < 4 && (
              <button type="button" className="p-listing-upload-add" onClick={() => fileInputRef.current?.click()}>
                <span>📷</span>
                <span>{lang === 'da' ? 'Tilføj foto' : 'Add photo'}</span>
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handlePhotos} />

          {formError && (
            <div style={{ background: '#fff0f0', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#c0392b' }}>
              ⚠️ {formError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 }}>{t.marketplaceCancel}</button>
            <button type="submit" style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: '#2D6A4F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              {isEdit ? t.marketplaceSaveEdit : t.marketplacePublish}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ── Analytics helpers ──────────────────────
// ─────────────────────────────────────────────

function seededRand(seed) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff }
}

function genViews(days, base, seed) {
  const r = seededRand(seed)
  return Array.from({ length: days }, (_, i) => Math.round(base + r() * base * 0.6 - base * 0.3 + Math.sin(i / 3) * base * 0.2))
}

function MiniLineChart({ data, color = '#1877F2', height = 80 }) {
  if (!data || data.length < 2) return null
  const w = 280, h = height
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 20) + 10
    const y = h - 10 - ((v - min) / range) * (h - 20)
    return `${x},${y}`
  })
  const area = `M${pts.join('L')}L${(data.length - 1) / (data.length - 1) * (w - 20) + 10},${h}L10,${h}Z`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="lc-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#lc-grad)" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {pts.map((pt, i) => i === data.length - 1 ? (
        <circle key={i} cx={pt.split(',')[0]} cy={pt.split(',')[1]} r="3" fill={color} />
      ) : null)}
    </svg>
  )
}

function HBarChart({ items, color = '#1877F2' }) {
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <div className="p-analytics-hbar-list">
      {items.map((item, i) => (
        <div key={i} className="p-analytics-hbar-row">
          <div className="p-analytics-hbar-label">{item.label}</div>
          <div className="p-analytics-hbar-track">
            <div className="p-analytics-hbar-fill" style={{ width: `${(item.value / max) * 100}%`, background: color }} />
          </div>
          <div className="p-analytics-hbar-val">{item.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="p-analytics-stat-card">
      <div className="p-analytics-stat-value" style={{ color }}>{value}</div>
      <div className="p-analytics-stat-label">{label}</div>
      {sub && <div className="p-analytics-stat-sub">{sub}</div>}
    </div>
  )
}

function HeatmapGrid({ lang }) {
  const days = lang === 'da' ? ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const hours = ['8', '10', '12', '14', '16', '18', '20']
  const r = seededRand(42)
  const heat = days.map(() => hours.map(() => r()))
  const peak = (d, h) => heat[d][h]
  return (
    <div className="p-analytics-heatmap">
      <div className="p-analytics-heatmap-inner">
        <div className="p-analytics-heatmap-row p-analytics-heatmap-header">
          <div className="p-analytics-heatmap-corner" />
          {hours.map(h => <div key={h} className="p-analytics-heatmap-cell p-analytics-heatmap-hour">{h}h</div>)}
        </div>
        {days.map((d, di) => (
          <div key={d} className="p-analytics-heatmap-row">
            <div className="p-analytics-heatmap-cell p-analytics-heatmap-day">{d}</div>
            {hours.map((h, hi) => {
              const v = peak(di, hi)
              const opacity = 0.1 + v * 0.85
              return <div key={hi} className="p-analytics-heatmap-cell p-analytics-heatmap-dot" style={{ background: `rgba(24,119,242,${opacity.toFixed(2)})` }} title={`${d} ${h}h`} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ── PostInsightsPanel ────────────────────────
// ─────────────────────────────────────────────

function PostInsightsPanel({ t, post, onClose }) {
  const r = seededRand((post.id || 1) * 7)
  const reach = Math.round((post.likes || 1) * (12 + r() * 30))
  const impressions = Math.round(reach * (1.4 + r() * 0.8))
  const shares = post.comments?.length ? Math.round(post.comments.length * (0.5 + r() * 2)) : Math.round(r() * 8)
  return (
    <div className="p-post-insights-panel">
      <div className="p-post-insights-header">
        <span>📊 {t.analyticsPostInsightsTitle}</span>
        <button className="p-post-insights-close" onClick={onClose}>✕</button>
      </div>
      <div className="p-post-insights-stats">
        <div className="p-post-insights-stat">
          <div className="p-post-insights-num">{reach.toLocaleString()}</div>
          <div className="p-post-insights-lbl">{t.analyticsInsightReach}</div>
        </div>
        <div className="p-post-insights-stat">
          <div className="p-post-insights-num">{impressions.toLocaleString()}</div>
          <div className="p-post-insights-lbl">{t.analyticsInsightImpressions}</div>
        </div>
        <div className="p-post-insights-stat">
          <div className="p-post-insights-num">{post.likes || 0}</div>
          <div className="p-post-insights-lbl">{t.analyticsInsightLikes}</div>
        </div>
        <div className="p-post-insights-stat">
          <div className="p-post-insights-num">{post.comments?.length || 0}</div>
          <div className="p-post-insights-lbl">{t.analyticsInsightComments}</div>
        </div>
        <div className="p-post-insights-stat">
          <div className="p-post-insights-num">{shares}</div>
          <div className="p-post-insights-lbl">{t.analyticsInsightShares}</div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ── PlanGate ─────────────────────────────────
// ─────────────────────────────────────────────

function PlanGate({ plan, required = 'business_pro', t, onUpgrade, children }) {
  const locked = plan !== required
  if (!locked) return children
  return (
    <div className="p-plan-gate">
      <div className="p-plan-gate-blur">{children}</div>
      <div className="p-plan-gate-overlay">
        <div className="p-plan-gate-lock">🔒</div>
        <div className="p-plan-gate-msg">{t.analyticsLockedMsg}</div>
        <button className="p-plan-gate-btn" onClick={onUpgrade}>{t.analyticsLockedBtn}</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ── UpgradeModal ──────────────────────────────
// ─────────────────────────────────────────────

function UpgradeModal({ lang, t, onUpgrade, onClose }) {
  const features = lang === 'da'
    ? ['Målgruppeindsigt & demografi', 'Indholdsanalyse & trends', 'Virksomhedsside-statistik', 'Forbindelsestragt', 'Branche-benchmarking', 'CSV / PDF export', 'Datointerval-selector']
    : ['Audience insights & demographics', 'Content analysis & trends', 'Company page statistics', 'Connection funnel', 'Industry benchmarking', 'CSV / PDF export', 'Date range selector']
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="p-upgrade-modal" onClick={e => e.stopPropagation()}>
        <div className="p-upgrade-modal-header">
          <span className="p-upgrade-plan-badge">{t.analyticsPlanBadge}</span>
          <button className="p-upgrade-modal-close" onClick={onClose}>✕</button>
        </div>
        <h2 className="p-upgrade-modal-title">{t.analyticsUpgradeTitle}</h2>
        <p className="p-upgrade-modal-desc">{t.analyticsUpgradeDesc}</p>
        <ul className="p-upgrade-features">
          {features.map((f, i) => <li key={i}>✓ {f}</li>)}
        </ul>
        <button className="p-upgrade-btn" onClick={onUpgrade}>{t.analyticsUpgradeBtn}</button>
        <button className="p-upgrade-cancel" onClick={onClose}>{t.analyticsUpgradeCancel}</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ── AnalyticsPage ─────────────────────────────
// ─────────────────────────────────────────────

const ANALYTICS_RANGES = [7, 30, 90]

function AnalyticsPage({ lang, t, currentUser, plan, onUpgrade }) {
  const [range, setRange] = useState(30)
  const [analytics, setAnalytics] = useState(null)

  useEffect(() => {
    setAnalytics(null)
    apiGetAnalytics(range).then(data => setAnalytics(data)).catch(() => {})
  }, [range])

  // Convert sparse {date, count} rows into a dense array covering the last `days` days
  const fillDays = useCallback((rows, days) => {
    const map = {}
    ;(rows || []).forEach(r => { map[(r.date || '').slice(0, 10)] = Number(r.count) })
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i))
      return map[d.toISOString().slice(0, 10)] || 0
    })
  }, [])

  // ── Time series ── (real when loaded, seeded fallback while loading)
  const profileViews = analytics ? fillDays(analytics.views, range) : genViews(range, 0, 999)
  const connViews    = analytics ? fillDays(analytics.connections, range) : genViews(range, 0, 777)
  const engTrend     = analytics ? fillDays(analytics.engTrend, range) : genViews(range, 0, 333)

  const totalViews = profileViews.reduce((a, b) => a + b, 0)
  const totalConns = connViews.reduce((a, b) => a + b, 0)

  const eng = analytics?.engagement
  const avgEngRate = eng
    ? (eng.posts > 0 ? ((eng.likes + eng.comments) / eng.posts).toFixed(1) : '0.0')
    : '–'

  // Top posts: real data; empty-state message when user has no posts yet
  const topPosts = analytics?.topPosts?.length
    ? analytics.topPosts
    : analytics
      ? [{ label: lang === 'da' ? 'Ingen opslag endnu' : 'No posts yet', value: 0 }]
      : [{ label: '…', value: 0 }]

  // ── Funnel (real) ──
  const fv = analytics?.funnel
  const funnelViews = fv ? fv.views : totalViews
  const funnelReqs  = fv ? fv.requests : 0
  const funnelConns = fv ? fv.connections : 0
  const maxF = Math.max(funnelViews, 1)
  const funnelData = [
    { label: t.analyticsFunnelViews,    value: funnelViews, pct: 100 },
    { label: t.analyticsFunnelRequests, value: funnelReqs,  pct: Math.max(funnelReqs > 0 ? Math.round((funnelReqs / maxF) * 100) : 0, funnelReqs > 0 ? 8 : 0) },
    { label: t.analyticsFunnelAccepted, value: funnelConns, pct: Math.max(funnelConns > 0 ? Math.round((funnelConns / maxF) * 100) : 0, funnelConns > 0 ? 4 : 0) },
  ]

  // ── Post types (real) ──
  const pt = analytics?.postTypes
  const postTypeItems = pt && (pt.text + pt.media) > 0
    ? [
        { label: lang === 'da' ? 'Tekst' : 'Text', value: pt.text },
        { label: lang === 'da' ? 'Medie' : 'Media', value: pt.media },
      ].filter(i => i.value > 0)
    : [
        { label: lang === 'da' ? 'Tekst' : 'Text', value: 6.1 },
        { label: lang === 'da' ? 'Billede' : 'Image', value: 8.4 },
        { label: lang === 'da' ? 'Video' : 'Video', value: 11.2 },
      ]

  // ── Audience demographics — estimated (no demographic fields in profiles yet) ──
  const industryData = [
    { label: lang === 'da' ? 'Teknologi' : 'Technology', value: 34 },
    { label: lang === 'da' ? 'Marketing' : 'Marketing', value: 22 },
    { label: lang === 'da' ? 'Finans' : 'Finance', value: 17 },
    { label: lang === 'da' ? 'Sundhed' : 'Healthcare', value: 14 },
    { label: lang === 'da' ? 'Andet' : 'Other', value: 13 },
  ]
  const cityData = [
    { label: 'København', value: 412 },
    { label: 'Aarhus', value: 187 },
    { label: 'Odense', value: 98 },
    { label: 'Aalborg', value: 74 },
    { label: 'Esbjerg', value: 31 },
  ]
  const seniorityData = [
    { label: lang === 'da' ? 'Senior' : 'Senior', value: 38 },
    { label: lang === 'da' ? 'Leder' : 'Manager', value: 27 },
    { label: lang === 'da' ? 'Direktør' : 'Director', value: 18 },
    { label: lang === 'da' ? 'Junior' : 'Junior', value: 17 },
  ]
  const growthSource = [
    { label: lang === 'da' ? 'Søgning' : 'Search', value: 41 },
    { label: lang === 'da' ? 'Forslag' : 'Suggestions', value: 33 },
    { label: lang === 'da' ? 'Opslag' : 'Posts', value: 26 },
  ]
  const topics = [
    { label: '#innovation', value: 12.3 },
    { label: '#leadership', value: 9.7 },
    { label: '#startup', value: 8.1 },
    { label: '#ai', value: 14.5 },
    { label: '#fellis', value: 6.2 },
  ]
  const competitors = [
    { label: lang === 'da' ? 'Dig' : 'You', value: 4.7, color: '#1877F2' },
    { label: lang === 'da' ? 'Branchegennemsnit' : 'Industry avg', value: 3.2, color: '#aaa' },
    { label: lang === 'da' ? 'Top 10%' : 'Top 10%', value: 7.9, color: '#2D6A4F' },
  ]

  // Total connections (real)
  const totalConnectionsVal = analytics?.totalConnections ?? currentUser?.friendCount ?? 0

  function exportCSV() {
    const rows = [['Date', 'Profile Views', 'New Connections']]
    const today = new Date()
    profileViews.forEach((v, i) => {
      const d = new Date(today); d.setDate(today.getDate() - (profileViews.length - 1 - i))
      rows.push([d.toISOString().slice(0, 10), v, connViews[i]])
    })
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `fellis-analytics-${range}d.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-analytics">
      {/* Header */}
      <div className="p-analytics-header">
        <h2 className="p-analytics-title">{t.analyticsTitle}</h2>
        <div className="p-analytics-controls">
          <div className="p-analytics-range-tabs">
            {ANALYTICS_RANGES.map(r => (
              <button key={r} className={`p-analytics-range-btn${range === r ? ' active' : ''}`} onClick={() => setRange(r)}>
                {r === 7 ? t.analyticsRange7 : r === 30 ? t.analyticsRange30 : t.analyticsRange90}
              </button>
            ))}
          </div>
          {plan === 'business_pro' && (
            <div className="p-analytics-export-btns">
              <button className="p-analytics-export-btn" onClick={exportCSV}>{t.analyticsExportCSV}</button>
            </div>
          )}
        </div>
      </div>

      {plan === 'business_pro' && (
        <div className="p-plan-badge-bar">
          <span className="p-upgrade-plan-badge">{t.analyticsPlanBadge} ✓</span>
        </div>
      )}

      {/* ── Free tier ── */}
      <div className="p-analytics-section">
        <div className="p-analytics-section-title">{t.analyticsProfileViews}</div>
        <div className="p-analytics-stat-row">
          <StatCard label={t.analyticsProfileViews} value={totalViews.toLocaleString()} sub={`${range}d`} color="#1877F2" />
          <StatCard label={t.analyticsFollowerGrowth} value={totalConns > 0 ? `+${totalConns}` : '0'} sub={`${range}d`} color="#2D6A4F" />
          <StatCard label={t.analyticsEngRate} value={avgEngRate} color="#F4A261" />
        </div>
        <div className="p-analytics-chart-wrap">
          <MiniLineChart data={profileViews} color="#1877F2" height={100} />
        </div>
      </div>

      <div className="p-analytics-section">
        <div className="p-analytics-section-title">{t.analyticsTopPosts}</div>
        <HBarChart items={topPosts} color="#1877F2" />
      </div>

      {/* ── Paid tier ── */}
      <PlanGate plan={plan} t={t} onUpgrade={onUpgrade}>
        <div className="p-analytics-section">
          <div className="p-analytics-section-title">{t.analyticsAudienceTitle} <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>{lang === 'da' ? '(estimeret)' : '(estimated)'}</span></div>
          <div className="p-analytics-subsection-grid">
            <div>
              <div className="p-analytics-subsection-label">{t.analyticsAudienceIndustry}</div>
              <HBarChart items={industryData} color="#1877F2" />
            </div>
            <div>
              <div className="p-analytics-subsection-label">{t.analyticsAudienceCities}</div>
              <HBarChart items={cityData} color="#2D6A4F" />
            </div>
          </div>
          <div className="p-analytics-subsection-grid" style={{ marginTop: 16 }}>
            <div>
              <div className="p-analytics-subsection-label">{t.analyticsAudienceSeniority}</div>
              <HBarChart items={seniorityData} color="#F4A261" />
            </div>
            <div>
              <div className="p-analytics-subsection-label">{t.analyticsAudienceGrowthSource}</div>
              <HBarChart items={growthSource} color="#7E57C2" />
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <div className="p-analytics-subsection-label">
              {t.analyticsAudienceBestTime}
              <span style={{ fontSize: 10, color: '#a07000', background: '#fff8e1', border: '1px solid #f0cc60', borderRadius: 3, padding: '1px 5px', marginLeft: 6, fontWeight: 500 }}>
                {lang === 'da' ? 'demodata' : 'demo data'}
              </span>
            </div>
            <HeatmapGrid lang={lang} />
          </div>
        </div>

        <div className="p-analytics-section">
          <div className="p-analytics-section-title">{t.analyticsContentTitle}</div>
          <div className="p-analytics-subsection-label">{t.analyticsContentPostType}</div>
          <HBarChart items={postTypeItems} color="#1877F2" />
          <div className="p-analytics-subsection-label" style={{ marginTop: 16 }}>
            {t.analyticsContentTopics}
            <span style={{ fontSize: 10, color: '#a07000', background: '#fff8e1', border: '1px solid #f0cc60', borderRadius: 3, padding: '1px 5px', marginLeft: 6, fontWeight: 500 }}>
              {lang === 'da' ? 'demodata' : 'demo data'}
            </span>
          </div>
          <HBarChart items={topics.map(p => ({ label: p.label, value: p.value }))} color="#F4A261" />
          <div className="p-analytics-subsection-label" style={{ marginTop: 16 }}>{t.analyticsContentEngTrend}</div>
          <div className="p-analytics-chart-wrap">
            <MiniLineChart data={engTrend.some(v => v > 0) ? engTrend : genViews(range, 2, 333)} color="#F4A261" height={80} />
          </div>
        </div>

        <div className="p-analytics-section">
          <div className="p-analytics-section-title">{t.analyticsFunnelTitle}</div>
          <div className="p-analytics-funnel">
            {funnelData.map((step, i) => (
              <div key={i} className="p-analytics-funnel-step" style={{ width: `${step.pct + 40}%` }}>
                <div className="p-analytics-funnel-bar" style={{ background: i === 0 ? '#1877F2' : i === 1 ? '#4aa3f7' : '#2D6A4F' }}>
                  <span>{step.label}</span>
                  <strong>{step.value.toLocaleString()}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-analytics-section">
          <div className="p-analytics-section-title">{t.analyticsCompetitorTitle}</div>
          <HBarChart items={competitors.map(c => ({ label: c.label, value: c.value }))} color="#1877F2" />
          <p style={{ fontSize: 12, color: '#aaa', margin: '8px 0 0' }}>
            {lang === 'da' ? 'Baseret på anonymiserede branchedata.' : 'Based on anonymised industry data.'}
          </p>
        </div>

        <div className="p-analytics-section">
          <div className="p-analytics-section-title">{t.analyticsCompanyTitle}</div>
          <div className="p-analytics-stat-row">
            <StatCard label={lang === 'da' ? 'Forbindelser i alt' : 'Total connections'} value={totalConnectionsVal.toLocaleString()} sub={lang === 'da' ? 'total' : 'total'} color="#1877F2" />
            <StatCard label={lang === 'da' ? 'Nye forbindelser' : 'New connections'} value={totalConns > 0 ? `+${totalConns}` : '0'} sub={`${range}d`} color="#2D6A4F" />
            <StatCard label={lang === 'da' ? 'Opslag i perioden' : 'Posts in period'} value={eng?.posts ?? '–'} color="#F4A261" />
          </div>
          <div className="p-analytics-chart-wrap" style={{ marginTop: 12 }}>
            <MiniLineChart data={connViews.some(v => v > 0) ? connViews : genViews(range, 1, 555)} color="#2D6A4F" height={80} />
          </div>
        </div>
      </PlanGate>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Admin Page ───────────────────────────────────────────────────────────────

// ── Calendar helpers ──────────────────────────────────────────────────────────

function computeEaster(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function lastSundayOf(year, month0) {
  const d = new Date(year, month0 + 1, 0)
  while (d.getDay() !== 0) d.setDate(d.getDate() - 1)
  return d
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDanishHolidays(year, lang) {
  const easter = computeEaster(year)
  const holidays = []
  const add = (d, da, en) => holidays.push({ date: isoDate(d), label: { da, en } })

  add(new Date(year, 0, 1), 'Nytårsdag', "New Year's Day")
  add(addDays(easter, -3), 'Skærtorsdag', 'Maundy Thursday')
  add(addDays(easter, -2), 'Langfredag', 'Good Friday')
  add(easter, 'Påskedag', 'Easter Sunday')
  add(addDays(easter, 1), '2. Påskedag', 'Easter Monday')
  add(new Date(year, 4, 1), '1. maj', 'Workers Day')
  add(addDays(easter, 39), 'Kristi Himmelfartsdag', 'Ascension Day')
  add(addDays(easter, 49), 'Pinsedag', 'Whit Sunday')
  add(addDays(easter, 50), '2. Pinsedag', 'Whit Monday')
  add(new Date(year, 5, 5), 'Grundlovsdag', 'Constitution Day')
  add(new Date(year, 11, 24), 'Juleaften', 'Christmas Eve')
  add(new Date(year, 11, 25), '1. juledag', 'Christmas Day')
  add(new Date(year, 11, 26), '2. juledag', 'Boxing Day')

  // DST changes (separate from public holidays)
  const dstSpring = lastSundayOf(year, 2) // last Sunday in March
  const dstFall = lastSundayOf(year, 9)   // last Sunday in October
  holidays.push({ date: isoDate(dstSpring), label: { da: 'Sommertid — ur frem 1 time', en: 'Summer time — clocks forward 1 hour' }, dst: 'spring' })
  holidays.push({ date: isoDate(dstFall), label: { da: 'Vintertid — ur tilbage 1 time', en: 'Winter time — clocks back 1 hour' }, dst: 'fall' })

  return holidays
}

function CalendarPage({ lang, t, currentUser }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState(null)
  const [calData, setCalData] = useState({ birthdays: [], events: [] })

  useEffect(() => {
    apiFetchCalendarEvents().then(data => { if (data) setCalData(data) })
  }, [])

  const holidays = getDanishHolidays(year, lang)

  // Build lookup maps keyed by 'YYYY-MM-DD'
  const holidayMap = {}
  holidays.forEach(h => {
    if (!holidayMap[h.date]) holidayMap[h.date] = []
    holidayMap[h.date].push(h)
  })

  const birthdayMap = {}
  calData.birthdays.forEach(b => {
    // b.date is 'YYYY-MM-DD' from DB — match only MM-DD for current year
    const mmdd = b.date ? b.date.slice(5) : null
    if (!mmdd) return
    const key = `${year}-${mmdd}`
    if (!birthdayMap[key]) birthdayMap[key] = []
    birthdayMap[key].push(b)
  })

  const eventMap = {}
  calData.events.forEach(e => {
    if (!e.date) return
    const key = e.date.slice(0, 10)
    if (!eventMap[key]) eventMap[key] = []
    eventMap[key].push(e)
  })

  // Calendar grid: weeks start on Monday
  const firstOfMonth = new Date(year, month, 1)
  const dowFirst = (firstOfMonth.getDay() + 6) % 7 // Mon=0 … Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((dowFirst + daysInMonth) / 7) * 7
  const cells = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - dowFirst + 1
    cells.push(dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null)
  }

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1); setSelectedDay(null) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1); setSelectedDay(null) }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDay(today.getDate()) }

  const selectedDateKey = selectedDay ? `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}` : null
  const selectedHolidays = selectedDateKey ? (holidayMap[selectedDateKey] || []) : []
  const selectedBirthdays = selectedDateKey ? (birthdayMap[selectedDateKey] || []) : []
  const selectedEvents = selectedDateKey ? (eventMap[selectedDateKey] || []) : []
  const hasSelected = selectedHolidays.length > 0 || selectedBirthdays.length > 0 || selectedEvents.length > 0

  const s = {
    page: { maxWidth: 700, margin: '0 auto', padding: '24px 16px' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    title: { fontSize: 22, fontWeight: 700, margin: 0 },
    navBtn: { background: 'none', border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 18, color: 'var(--text, #111)' },
    todayBtn: { background: 'none', border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text, #111)', marginLeft: 8 },
    monthLabel: { fontSize: 18, fontWeight: 700, minWidth: 180, textAlign: 'center' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
    dayHeader: { textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #888)', padding: '4px 0', textTransform: 'uppercase' },
    dayCell: (isToday, isSelected, isOtherMonth) => ({
      minHeight: 64,
      borderRadius: 8,
      padding: '6px 4px 4px',
      cursor: isOtherMonth ? 'default' : 'pointer',
      background: isSelected ? '#1877F2' : isToday ? '#e8f0fe' : 'var(--card-bg, #fff)',
      border: isToday && !isSelected ? '2px solid #1877F2' : '1px solid var(--border, #eee)',
      transition: 'background 0.15s',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    }),
    dayNum: (isSelected) => ({ fontSize: 14, fontWeight: 700, color: isSelected ? '#fff' : 'inherit', lineHeight: 1 }),
    dots: { display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' },
    dot: (color) => ({ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }),
    panel: { marginTop: 20, background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 12, padding: '16px 20px' },
    panelTitle: { fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--text, #111)' },
    item: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
    itemDot: (color) => ({ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }),
    itemLabel: { fontSize: 14, color: 'var(--text, #111)' },
    avatar: (color) => ({ width: 28, height: 28, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }),
    legend: { display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' },
    legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted, #888)' },
  }

  const HOLIDAY_COLOR = '#1877F2'
  const DST_COLOR = '#F59E0B'
  const BIRTHDAY_COLOR = '#E07A5F'
  const EVENT_COLOR = '#6C63FF'

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h2 style={s.title}>{t.calendarTitle}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button style={s.navBtn} onClick={prevMonth} title="Forrige måned">‹</button>
          <span style={s.monthLabel}>{t.calendarMonths[month]} {year}</span>
          <button style={s.navBtn} onClick={nextMonth} title="Næste måned">›</button>
          <button style={s.todayBtn} onClick={goToday}>{t.calendarToday}</button>
        </div>
      </div>

      {/* Weekday headers */}
      <div style={s.grid}>
        {t.calendarWeekdays.map(d => (
          <div key={d} style={s.dayHeader}>{d}</div>
        ))}

        {/* Day cells */}
        {cells.map((dayNum, i) => {
          if (!dayNum) return <div key={i} />
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
          const isToday = year === today.getFullYear() && month === today.getMonth() && dayNum === today.getDate()
          const isSelected = selectedDay === dayNum
          const hols = holidayMap[dateKey] || []
          const bdays = birthdayMap[dateKey] || []
          const evts = eventMap[dateKey] || []

          return (
            <div
              key={i}
              style={s.dayCell(isToday, isSelected, false)}
              onClick={() => setSelectedDay(isSelected ? null : dayNum)}
            >
              <span style={s.dayNum(isSelected)}>{dayNum}</span>
              <div style={s.dots}>
                {hols.map((h, j) => (
                  <span key={j} style={s.dot(h.dst ? DST_COLOR : HOLIDAY_COLOR)} title={h.label[lang]} />
                ))}
                {bdays.map((b, j) => (
                  <span key={j} style={s.dot(BIRTHDAY_COLOR)} title={b.name} />
                ))}
                {evts.map((e, j) => (
                  <span key={j} style={s.dot(EVENT_COLOR)} title={typeof e.title === 'string' ? e.title : (e.title[lang] || e.title.da)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={s.legend}>
        <div style={s.legendItem}><span style={{ ...s.dot(HOLIDAY_COLOR), width: 10, height: 10 }} />{t.calendarHolidays}</div>
        <div style={s.legendItem}><span style={{ ...s.dot(DST_COLOR), width: 10, height: 10 }} />Sommer-/vintertid</div>
        <div style={s.legendItem}><span style={{ ...s.dot(BIRTHDAY_COLOR), width: 10, height: 10 }} />{t.calendarBirthdays}</div>
        <div style={s.legendItem}><span style={{ ...s.dot(EVENT_COLOR), width: 10, height: 10 }} />{t.calendarEvents}</div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div style={s.panel}>
          <div style={s.panelTitle}>
            {selectedDateKey && new Date(selectedDateKey + 'T12:00:00').toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {!hasSelected && (
            <p style={{ color: 'var(--text-muted, #888)', fontSize: 14, margin: 0 }}>{t.calendarNothingToday}</p>
          )}
          {selectedHolidays.map((h, i) => (
            <div key={i} style={s.item}>
              <span style={s.itemDot(h.dst ? DST_COLOR : HOLIDAY_COLOR)} />
              <span style={s.itemLabel}>{h.label[lang]}</span>
            </div>
          ))}
          {selectedBirthdays.map((b, i) => {
            const color = nameToColor(b.name)
            const age = b.date ? year - parseInt(b.date.slice(0, 4)) : null
            return (
              <div key={i} style={s.item}>
                {b.avatarUrl
                  ? <img src={b.avatarUrl.startsWith('http') ? b.avatarUrl : `${API_BASE}${b.avatarUrl}`} alt={b.name} style={{ ...s.avatar(color), objectFit: 'cover' }} />
                  : <div style={s.avatar(color)}>{b.initials}</div>
                }
                <span style={s.itemLabel}>
                  {b.userId === currentUser.id ? t.calendarBirthdayMe : b.name}
                  {age !== null && age > 0 ? ` — ${age} ${lang === 'da' ? 'år' : 'years old'}` : ''}
                </span>
              </div>
            )
          })}
          {selectedEvents.map((e, i) => {
            const title = typeof e.title === 'string' ? e.title : (e.title?.[lang] || e.title?.da || '')
            return (
              <div key={i} style={s.item}>
                <span style={s.itemDot(EVENT_COLOR)} />
                <span style={s.itemLabel}>{title}{e.location ? ` — ${e.location}` : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Admin Page ───────────────────────────────────────────────────────────────

// ── Admin: Viral Growth Stats ──
function AdminViralStats({ viralStats, viralDays, setViralDays, lang }) {
  const da = lang === 'da'
  const vs = viralStats
  const sCard = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 12px', textAlign: 'center' }
  const sNum = { fontSize: 26, fontWeight: 700, lineHeight: 1.1 }
  const sLabel = { fontSize: 12, color: '#666', marginTop: 4 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Period selector */}
      <div className="p-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>{da ? 'Periode:' : 'Period:'}</span>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setViralDays(d)}
            style={{ padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${viralDays === d ? '#1877F2' : '#ddd'}`,
              background: viralDays === d ? '#EBF4FF' : '#fff', color: viralDays === d ? '#1877F2' : '#555',
              fontWeight: viralDays === d ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
            {d} {da ? 'dage' : 'days'}
          </button>
        ))}
      </div>

      {!vs ? (
        <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          {da ? 'Henter viral statistik…' : 'Loading viral statistics…'}
        </div>
      ) : (
        <>
          {/* Core KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            {[
              { icon: '📨', num: vs.invitesSent,        label: da ? 'Invitationer sendt'     : 'Invitations sent',    color: '#1877F2' },
              { icon: '✅', num: vs.invitesAccepted,    label: da ? 'Accepteret'             : 'Accepted',            color: '#40916C' },
              { icon: `${vs.conversionRate}%`, num: null, label: da ? 'Konverteringsrate'   : 'Conversion rate',     color: '#E07A5F', big: true },
              { icon: '🔁', num: vs.viralCoefficient,  label: da ? 'Viral koefficient (K)' : 'Viral coefficient (K)', color: '#6C63FF' },
              { icon: '🔗', num: vs.sharesTracked,      label: da ? 'Deling sporet'          : 'Shares tracked',      color: '#3D405B' },
              { icon: '🆕', num: vs.newUsers,           label: da ? 'Nye brugere'            : 'New users',           color: '#2D6A4F' },
            ].map((item, i) => (
              <div key={i} style={sCard}>
                <div style={{ ...sNum, color: item.color }}>{item.big ? item.icon : (item.num ?? '—')}</div>
                {item.big && <div style={{ fontSize: 11, color: item.color, fontWeight: 700 }}>{da ? 'konvertering' : 'conversion'}</div>}
                <div style={sLabel}>{item.label}</div>
              </div>
            ))}
          </div>

          {/* Viral coefficient explanation */}
          <div className="p-card" style={{ background: Number(vs.viralCoefficient) >= 1 ? '#F0FAF4' : '#FFFBEB', border: `1px solid ${Number(vs.viralCoefficient) >= 1 ? '#b7dfca' : '#fde68a'}` }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              {Number(vs.viralCoefficient) >= 1 ? '🚀' : '📈'} {da ? 'Viral koefficient (K-faktor)' : 'Viral coefficient (K-factor)'}
              <span style={{ marginLeft: 10, fontSize: 22, fontWeight: 800, color: Number(vs.viralCoefficient) >= 1 ? '#40916C' : '#d97706' }}>
                K = {vs.viralCoefficient}
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#555', margin: 0, lineHeight: 1.6 }}>
              {da
                ? `K-faktoren måler, hvor mange nye brugere hver eksisterende bruger i gennemsnit bringer med sig. K ≥ 1 betyder eksponentiel vækst — platformen vokser af sig selv. K = ${vs.viralCoefficient} i de seneste ${vs.days} dage.`
                : `The K-factor measures how many new users each existing user recruits on average. K ≥ 1 means exponential growth — the platform grows on its own. K = ${vs.viralCoefficient} over the last ${vs.days} days.`}
            </p>
          </div>

          {/* Top inviters */}
          {vs.topInviters?.length > 0 && (
            <div className="p-card">
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>🏆 {da ? 'Top-inviters (perioden)' : 'Top inviters (period)'}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {vs.topInviters.map((u, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: i === 0 ? '#FFFBEB' : 'transparent' }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: '#999' }}>{u.handle}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1877F2' }}>{u.period} {da ? 'denne periode' : 'this period'}</div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>{u.total} {da ? 'i alt' : 'total'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Share platform breakdown */}
          {vs.sharePlatforms?.length > 0 && (
            <div className="p-card">
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>📡 {da ? 'Deling pr. platform' : 'Shares by platform'}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {vs.sharePlatforms.map((p, i) => {
                  const icons = { facebook: '📘', twitter: '🐦', linkedin: '🔵', whatsapp: '💬', unknown: '🔗' }
                  const total = vs.sharePlatforms.reduce((a, b) => a + b.count, 0)
                  const pct = Math.round((p.count / total) * 100)
                  return (
                    <div key={i} style={{ padding: '8px 16px', borderRadius: 10, background: '#f5f5f5', textAlign: 'center', minWidth: 80 }}>
                      <div style={{ fontSize: 20 }}>{icons[p.platform] || '🔗'}</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{p.count}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{p.platform} ({pct}%)</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Admin: Security & GDPR Tab ──
function AdminSecurityGdpr({ viralStats, lang }) {
  const da = lang === 'da'

  const section = (icon, title, children) => (
    <div className="p-card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>{icon} {title}</h3>
      {children}
    </div>
  )

  const row = (label, value, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #f0f0f0', gap: 12 }}>
      <span style={{ fontSize: 13, color: '#555', fontWeight: 500, flex: '0 0 auto', maxWidth: '50%' }}>{label}</span>
      <span style={{ fontSize: 13, color: color || '#1a1a1a', fontWeight: color ? 600 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  )

  const badge = (text, ok) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 12,
      background: ok ? '#F0FAF4' : '#FFF5F5', color: ok ? '#2D6A4F' : '#C0392B',
      border: `1px solid ${ok ? '#b7dfca' : '#f5b7b1'}`, fontSize: 12, fontWeight: 600, marginRight: 6, marginBottom: 4 }}>
      {ok ? '✓' : '✗'} {text}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* GDPR Compliance status */}
      {section('🇪🇺', da ? 'GDPR-overholdelse' : 'GDPR Compliance', (
        <div>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 12, lineHeight: 1.6 }}>
            {da
              ? 'Det virale vækst-system er designet med GDPR som fundament (Forordning 2016/679). Nedenfor er en oversigt over, hvordan persondata behandles og beskyttes.'
              : 'The viral growth system is designed with GDPR as its foundation (Regulation 2016/679). Below is an overview of how personal data is processed and protected.'}
          </p>
          <div style={{ marginBottom: 10 }}>
            {badge(da ? 'Dataminimering (Art. 5)' : 'Data minimisation (Art. 5)', true)}
            {badge(da ? 'Formålsbegrænsning (Art. 5)' : 'Purpose limitation (Art. 5)', true)}
            {badge(da ? 'Opbevaringsbegrænsning (Art. 5)' : 'Storage limitation (Art. 5)', true)}
            {badge(da ? 'Integritet & fortrolighed (Art. 32)' : 'Integrity & confidentiality (Art. 32)', true)}
            {badge(da ? 'Ret til sletning (Art. 17)' : 'Right to erasure (Art. 17)', true)}
            {badge(da ? 'Ret til dataportabilitet (Art. 20)' : 'Right to portability (Art. 20)', true)}
            {badge(da ? 'ON DELETE CASCADE' : 'ON DELETE CASCADE', true)}
          </div>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
            {da
              ? 'Al data slettes automatisk via CASCADE-constraints, når en bruger sletter sin konto (GDPR Art. 17 — ret til sletning).'
              : 'All data is automatically deleted via CASCADE constraints when a user deletes their account (GDPR Art. 17 — right to erasure).'}
          </p>
        </div>
      ))}

      {/* Data inventory */}
      {section('🗃️', da ? 'Datakatalog — virale vækst-tabeller' : 'Data inventory — viral growth tables', (
        <div>
          {[
            {
              table: 'referrals',
              purpose: da ? 'Sporingsrekord: hvem inviterede hvem' : 'Tracking: who invited whom',
              fields: da ? 'referrer_id, referred_id, invite_source, utm_source, converted_at' : 'referrer_id, referred_id, invite_source, utm_source, converted_at',
              retention: da ? 'Livslangt (konto) — slettes ved konto-sletning' : 'Account lifetime — deleted on account deletion',
              lawful: da ? 'Legitim interesse (Art. 6(1)(f)) — viral vækst' : 'Legitimate interest (Art. 6(1)(f)) — viral growth',
            },
            {
              table: 'user_badges',
              purpose: da ? 'Optjente gamification-badges pr. bruger' : 'Gamification badges earned per user',
              fields: 'user_id, reward_type, earned_at',
              retention: da ? 'Livslangt (konto) — slettes ved konto-sletning' : 'Account lifetime — deleted on account deletion',
              lawful: da ? 'Kontrakt (Art. 6(1)(b)) — del af platformsservice' : 'Contract (Art. 6(1)(b)) — part of platform service',
            },
            {
              table: 'share_events',
              purpose: da ? 'Anonym aggregeret tracking af ekstern deling' : 'Anonymous aggregated tracking of external shares',
              fields: da ? 'user_id (nullable), share_type, platform, utm_campaign, created_at' : 'user_id (nullable), share_type, platform, utm_campaign, created_at',
              retention: da ? 'Permanent (aggregeret) — user_id = NULL ved konto-sletning' : 'Permanent (aggregated) — user_id = NULL on account deletion',
              lawful: da ? 'Legitim interesse (Art. 6(1)(f)) — analytics' : 'Legitimate interest (Art. 6(1)(f)) — analytics',
            },
            {
              table: 'rewards',
              purpose: da ? 'Badge-katalog (ikke persondata)' : 'Badge catalog (not personal data)',
              fields: 'type, title, description, icon, threshold, reward_points',
              retention: da ? 'Permanent — systemdata, ingen personoplysninger' : 'Permanent — system data, no personal info',
              lawful: da ? 'Ikke persondata — GDPR finder ikke anvendelse' : 'Not personal data — GDPR does not apply',
            },
          ].map((item, i) => (
            <div key={i} style={{ marginBottom: 16, padding: 14, background: '#f9f9f9', borderRadius: 10, border: '1px solid #ebebeb' }}>
              <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#1877F2', marginBottom: 8 }}>📋 {item.table}</div>
              {row(da ? 'Formål' : 'Purpose', item.purpose)}
              {row(da ? 'Felter' : 'Fields', item.fields, '#555')}
              {row(da ? 'Opbevaringstid' : 'Retention', item.retention)}
              {row(da ? 'Retsgrundlag' : 'Legal basis', item.lawful, '#2D6A4F')}
            </div>
          ))}
        </div>
      ))}

      {/* Security controls */}
      {section('🛡️', da ? 'Tekniske sikkerhedsforanstaltninger' : 'Technical security controls', (
        <div>
          {[
            {
              control: da ? 'Rate limiting — invitationer' : 'Rate limiting — invitations',
              detail: da ? 'Maks. 20 invitationer pr. 15 min pr. bruger (in-memory). Forhindrer spam og misbrug. HTTP 429 returneres ved overskridelse.' : 'Max 20 invitations per 15 min per user (in-memory). Prevents spam and abuse. HTTP 429 returned on violation.',
              status: true,
            },
            {
              control: da ? 'Engangstoken for invitationer' : 'One-time invitation tokens',
              detail: da ? 'Hvert e-mail-invitations-token er et kryptografisk tilfældigt 32-byte hex-token. Markeres som "accepted" ved første brug og kan ikke genbruges.' : 'Each email invitation token is a cryptographically random 32-byte hex token. Marked as "accepted" on first use and cannot be reused.',
              status: true,
            },
            {
              control: da ? 'Offentlige opslag: share_token' : 'Public posts: share_token',
              detail: da ? 'Del-links er 16-byte kryptografisk tilfældige tokens (128-bit entropi). Kan tilbagekaldes af forfatteren via DELETE /api/posts/:id/share-token, som sætter is_public = 0.' : 'Share links are 16-byte cryptographically random tokens (128-bit entropy). Can be revoked by the author via DELETE /api/posts/:id/share-token, setting is_public = 0.',
              status: true,
            },
            {
              control: da ? 'Offentlig profil: eksplicit samtykke' : 'Public profile: explicit consent',
              detail: da ? 'Profiler er private som standard (profile_public = 0). Brugeren skal aktivt slå offentlig profil til. Kan deaktiveres igen til enhver tid.' : 'Profiles are private by default (profile_public = 0). User must actively enable public profile. Can be disabled again at any time.',
              status: true,
            },
            {
              control: da ? 'share_events.user_id er nullable' : 'share_events.user_id is nullable',
              detail: da ? 'Delings-events bevares til aggregeret analytics, men user_id sættes til NULL ved konto-sletning (ON DELETE SET NULL). Data er dermed anonym efter sletning.' : 'Share events are retained for aggregated analytics, but user_id is set to NULL on account deletion (ON DELETE SET NULL). Data is anonymous after deletion.',
              status: true,
            },
            {
              control: da ? 'Autorisering på alle write-endpoints' : 'Authorization on all write endpoints',
              detail: da ? 'Alle POST/PATCH/DELETE-endpoints kræver gyldig session (authenticate middleware). Ejerskab valideres eksplicit: share-token og profil-toggle kan kun ændres af den pågældende bruger.' : 'All POST/PATCH/DELETE endpoints require a valid session (authenticate middleware). Ownership is explicitly validated: share tokens and profile toggle can only be changed by the owning user.',
              status: true,
            },
            {
              control: da ? 'UTM-parametre: ingen PII' : 'UTM parameters: no PII',
              detail: da ? 'UTM-felter (utm_source, utm_campaign) gemmes som tekst og må ikke indeholde personoplysninger. Dette håndhæves ikke teknisk — det er en operationel instruks.' : 'UTM fields (utm_source, utm_campaign) are stored as text and must not contain personal information. This is not technically enforced — it is an operational instruction.',
              status: false,
            },
          ].map((item, i) => (
            <div key={i} style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 10, background: item.status ? '#F0FAF4' : '#FFFBEB', border: `1px solid ${item.status ? '#b7dfca' : '#fde68a'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{item.status ? '✅' : '⚠️'}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: item.status ? '#2D6A4F' : '#92400e' }}>{item.control}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#555', lineHeight: 1.6 }}>{item.detail}</p>
            </div>
          ))}
        </div>
      ))}

      {/* Viral stats summary in security context */}
      {viralStats && section('📊', da ? 'Aktuel datamængde (viral vækst)' : 'Current data volume (viral growth)', (
        <div>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            {da
              ? `Nedenstående data er indsamlet i de seneste ${viralStats.days} dage og udgør grundlaget for det virale vækst-system.`
              : `The data below was collected over the last ${viralStats.days} days and forms the basis of the viral growth system.`}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {[
              { label: da ? 'Invitationer sendt' : 'Invitations sent', value: viralStats.invitesSent },
              { label: da ? 'Konverterede referrals' : 'Converted referrals', value: viralStats.referralsConverted },
              { label: da ? 'Share-events sporet' : 'Share events tracked', value: viralStats.sharesTracked },
              { label: da ? 'Nye brugere' : 'New users', value: viralStats.newUsers },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: 'center', padding: '12px 10px', background: '#f5f5f5', borderRadius: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1877F2' }}>{item.value ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>{item.label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#999', marginTop: 12, margin: '12px 0 0' }}>
            {da
              ? '⚖️ Retsgrundlag: Legitim interesse (GDPR Art. 6(1)(f)) — optimering af platformsvækst. Alle data behandles i EU og er underlagt dansk lovgivning.'
              : '⚖️ Legal basis: Legitimate interest (GDPR Art. 6(1)(f)) — platform growth optimisation. All data is processed in the EU and subject to Danish law.'}
          </p>
        </div>
      ))}

      {/* Brugerrettigheder */}
      {section('👤', da ? 'Brugerrettigheder & udøvelse' : 'User rights & exercise', (
        <div>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 12, lineHeight: 1.6 }}>
            {da
              ? 'Brugere kan til enhver tid udøve følgende rettigheder — tilgængelige direkte i platformen under Profil → Privatliv & data:'
              : 'Users can exercise the following rights at any time — available directly in the platform under Profile → Privacy & data:'}
          </p>
          {[
            { right: da ? '📥 Ret til indsigt (Art. 15)' : '📥 Right of access (Art. 15)', how: da ? 'Profil → Eksportér data (JSON)' : 'Profile → Export data (JSON)', endpoint: 'GET /api/gdpr/export' },
            { right: da ? '🗑️ Ret til sletning (Art. 17)' : '🗑️ Right to erasure (Art. 17)', how: da ? 'Profil → Slet konto — sletter ALT inkl. referrals, badges, share_events' : 'Profile → Delete account — deletes ALL incl. referrals, badges, share_events', endpoint: 'DELETE /api/gdpr/account' },
            { right: da ? '🔒 Ret til begrænsning (Art. 18)' : '🔒 Right to restrict (Art. 18)', how: da ? 'Deaktiver offentlig profil / tilbagekald del-links' : 'Disable public profile / revoke share links', endpoint: 'PATCH /api/profile/public' },
            { right: da ? '📤 Dataportabilitet (Art. 20)' : '📤 Data portability (Art. 20)', how: da ? 'Eksport i JSON-format via Profil → Data & privatliv' : 'Export in JSON format via Profile → Data & privacy', endpoint: 'GET /api/gdpr/export' },
            { right: da ? '↩️ Tilbagetræk samtykke (Art. 7)' : '↩️ Withdraw consent (Art. 7)', how: da ? 'Profil → Administrér samtykker' : 'Profile → Manage consents', endpoint: 'POST /api/gdpr/consent/withdraw' },
          ].map((item, i) => (
            <div key={i} style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 8, background: '#f9f9f9', border: '1px solid #ebebeb' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{item.right}</div>
              <div style={{ fontSize: 12, color: '#555' }}>{item.how}</div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#888', marginTop: 2 }}>{item.endpoint}</div>
            </div>
          ))}
        </div>
      ))}

      {/* DPO contact */}
      <div className="p-card" style={{ background: '#F0F7FF', border: '1px solid #BDD8F9' }}>
        <div style={{ fontSize: 13, color: '#2C4A6E', lineHeight: 1.7 }}>
          <strong>ℹ️ {da ? 'Databeskyttelsesansvarlig (DPO)' : 'Data Protection Officer (DPO)'}</strong><br />
          {da
            ? 'Hvis en bruger ønsker at udøve sine rettigheder eller har spørgsmål til databehandlingen, skal de kontakte platformen via de GDPR-endpoints, der er eksponeret i appen. Platformen er forpligtet til at svare inden 30 dage (GDPR Art. 12).'
            : 'If a user wishes to exercise their rights or has questions about data processing, they should contact the platform via the GDPR endpoints exposed in the app. The platform is obligated to respond within 30 days (GDPR Art. 12).'}
        </div>
      </div>
    </div>
  )
}

function AdminPage({ lang, t }) {
  const STRIPE_FIELDS = [
    { key: 'stripe_secret_key', label: t.adminStripeSecretKey, type: 'password', placeholder: 'sk_live_...' },
    { key: 'stripe_pub_key', label: t.adminStripePubKey, type: 'text', placeholder: 'pk_live_...' },
    { key: 'stripe_webhook_secret', label: t.adminStripeWebhookSecret, type: 'password', placeholder: 'whsec_...' },
    { key: 'stripe_price_pro_monthly', label: t.adminStripePriceProMonthly, type: 'text', placeholder: 'price_...' },
    { key: 'stripe_price_pro_yearly', label: t.adminStripePriceProYearly, type: 'text', placeholder: 'price_...' },
    { key: 'stripe_price_boost', label: t.adminStripePriceBoost, type: 'text', placeholder: 'price_...' },
  ]

  const [adminTab, setAdminTab] = useState('stats')
  const [form, setForm] = useState({
    stripe_secret_key: '', stripe_pub_key: '', stripe_webhook_secret: '',
    stripe_price_pro_monthly: '', stripe_price_pro_yearly: '', stripe_price_boost: '',
    pwd_min_length: '6', pwd_require_uppercase: '0', pwd_require_lowercase: '0',
    pwd_require_numbers: '0', pwd_require_symbols: '0',
  })
  const [status, setStatus] = useState('idle') // idle | saving | saved
  const [stats, setStats] = useState(null)
  const [weights, setWeights] = useState({ family: 1000, interest: 100, recency: 50 })
  const [weightStatus, setWeightStatus] = useState('idle')
  const [interestStats, setInterestStats] = useState(null)
  const [viralStats, setViralStats] = useState(null)
  const [viralDays, setViralDays] = useState(30)

  useEffect(() => {
    apiGetAdminSettings().then(data => {
      if (data?.settings) setForm(prev => ({ ...prev, ...data.settings }))
    })
    apiGetAdminStats().then(data => { if (data) setStats(data) })
    apiGetFeedWeights().then(data => { if (data?.weights) setWeights(data.weights) })
    apiGetInterestStats().then(data => { if (data) setInterestStats(data) })
  }, [])

  useEffect(() => {
    if (adminTab === 'viral' || adminTab === 'security') {
      apiGetAdminViralStats(viralDays).then(data => { if (data) setViralStats(data) })
    }
  }, [adminTab, viralDays])

  const handleSave = async (e) => {
    e.preventDefault()
    setStatus('saving')
    await apiSaveAdminSettings(form).catch(() => {})
    setStatus('saved')
    setTimeout(() => setStatus('idle'), 3000)
  }

  const fS = { width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 0 }
  const lS = { fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' }

  const statItems = stats ? [
    { icon: '👥', label: lang === 'da' ? 'Brugere i alt' : 'Total users', value: stats.users },
    { icon: '🟢', label: lang === 'da' ? 'Aktive sessioner' : 'Active sessions', value: stats.active_users },
    { icon: '🆕', label: lang === 'da' ? 'Nye brugere (7 dage)' : 'New users (7 days)', value: stats.new_users_7d },
    { icon: '📝', label: lang === 'da' ? 'Opslag i alt' : 'Total posts', value: stats.posts },
    { icon: '💬', label: lang === 'da' ? 'Beskeder i alt' : 'Total messages', value: stats.messages },
    { icon: '📅', label: lang === 'da' ? 'Begivenheder' : 'Events', value: stats.events },
    { icon: '✅', label: lang === 'da' ? 'Tilmeldinger (going)' : 'Event RSVPs (going)', value: stats.rsvps },
    { icon: '🛍️', label: lang === 'da' ? 'Aktive annoncer' : 'Active listings', value: stats.listings },
    { icon: '🤝', label: lang === 'da' ? 'Forbindelser' : 'Friendships', value: stats.friendships },
  ] : []

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700 }}>⚙️ {t.adminTitle}</h2>

      <div className="p-filter-tabs" style={{ marginBottom: 20 }}>
        <button className={`p-filter-tab${adminTab === 'stats' ? ' active' : ''}`} onClick={() => setAdminTab('stats')}>
          📊 {lang === 'da' ? 'Status' : 'Overview'}
        </button>
        <button className={`p-filter-tab${adminTab === 'feed' ? ' active' : ''}`} onClick={() => setAdminTab('feed')}>
          🎯 {t.adminFeedTab}
        </button>
        <button className={`p-filter-tab${adminTab === 'viral' ? ' active' : ''}`} onClick={() => setAdminTab('viral')}>
          🚀 {lang === 'da' ? 'Viral vækst' : 'Viral growth'}
        </button>
        <button className={`p-filter-tab${adminTab === 'stripe' ? ' active' : ''}`} onClick={() => setAdminTab('stripe')}>
          💳 {t.adminStripeTitle}
        </button>
        <button className={`p-filter-tab${adminTab === 'security' ? ' active' : ''}`} onClick={() => setAdminTab('security')}>
          🔒 {lang === 'da' ? 'Sikkerhed & GDPR' : 'Security & GDPR'}
        </button>
      </div>

      {adminTab === 'stats' && (
        <div>
          {!stats ? (
            <div className="p-card" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              {lang === 'da' ? 'Henter statistik…' : 'Loading statistics…'}
            </div>
          ) : (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {statItems.map(s => (
                <div key={s.label} className="p-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
                  <div style={{ fontSize: 32, marginBottom: 6 }}>{s.icon}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#2D6A4F', marginBottom: 4 }}>{s.value ?? '—'}</div>
                  <div style={{ fontSize: 12, color: '#888', fontWeight: 500 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Mode segmentation */}
            <div className="p-card" style={{ marginTop: 16, padding: '20px 24px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>
                {lang === 'da' ? '📊 Brugere pr. tilstand' : '📊 Users by mode'}
              </h3>
              {(() => {
                const privat = stats.users_privat ?? 0
                const business = stats.users_business ?? 0
                const total = privat + business || 1
                const pctPrivat = Math.round((privat / total) * 100)
                const pctBusiness = 100 - pctPrivat
                return (
                  <div>
                    {/* User count split */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                      <div style={{ flex: 1, background: '#F0FAF4', border: '1px solid #b7dfca', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#2D6A4F' }}>{privat}</div>
                        <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>🏠 {lang === 'da' ? 'Privat' : 'Private'} ({pctPrivat}%)</div>
                      </div>
                      <div style={{ flex: 1, background: '#EBF4FF', border: '1px solid #b3d4f5', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#1877F2' }}>{business}</div>
                        <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>💼 Business ({pctBusiness}%)</div>
                      </div>
                    </div>
                    <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', background: '#f5f0eb', marginBottom: 16 }}>
                      <div style={{ width: `${pctPrivat}%`, background: '#2D6A4F', transition: 'width 0.4s' }} />
                      <div style={{ width: `${pctBusiness}%`, background: '#1877F2', transition: 'width 0.4s' }} />
                    </div>
                    {/* Business-specific stats */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1877F2', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      💼 {lang === 'da' ? 'Business statistik' : 'Business metrics'}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {[
                        { label: lang === 'da' ? 'Opslag' : 'Posts', value: stats.posts_business ?? '—' },
                        { label: lang === 'da' ? 'Nye (7 dage)' : 'New (7 days)', value: stats.new_business_7d ?? '—' },
                        { label: lang === 'da' ? 'Aktive nu' : 'Active now', value: stats.active_business ?? '—' },
                      ].map(s => (
                        <div key={s.label} style={{ flex: 1, background: '#f5f9ff', border: '1px solid #d0e4f8', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#1877F2' }}>{s.value}</div>
                          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
            </>
          )}
        </div>
      )}

      {adminTab === 'feed' && (
        <div>
          {/* Algorithm weight sliders */}
          <div className="p-card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>🎛️ {t.adminFeedWeightsTitle}</h3>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>{t.adminFeedWeightsDesc}</p>
            {[
              { key: 'family',   label: t.adminFeedWeightFamily,   color: '#E07B39', max: 2000 },
              { key: 'interest', label: t.adminFeedWeightInterest,  color: '#2D6A4F', max: 500  },
              { key: 'recency',  label: t.adminFeedWeightRecency,   color: '#1877F2', max: 200  },
            ].map(({ key, label, color, max }) => (
              <div key={key} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color, minWidth: 48, textAlign: 'right' }}>{weights[key]}</span>
                </div>
                <input
                  type="range" min={0} max={max} step={key === 'recency' ? 5 : 50}
                  value={weights[key]}
                  onChange={e => setWeights(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                  style={{ width: '100%', accentColor: color }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa', marginTop: 2 }}>
                  <span>0</span><span>{max}</span>
                </div>
              </div>
            ))}
            <button
              disabled={weightStatus === 'saving'}
              onClick={async () => {
                setWeightStatus('saving')
                await apiSaveFeedWeights(weights).catch(() => {})
                setWeightStatus('saved')
                setTimeout(() => setWeightStatus('idle'), 3000)
              }}
              style={{
                padding: '8px 22px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                background: weightStatus === 'saved' ? '#40916C' : '#2D6A4F', color: '#fff',
              }}
            >
              {weightStatus === 'saving' ? t.adminFeedWeightsSaving : weightStatus === 'saved' ? t.adminFeedWeightsSaved : t.adminFeedWeightsSave}
            </button>
          </div>

          {/* Interest adoption statistics */}
          <div className="p-card">
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>📈 {t.adminInterestStatsTitle}</h3>
            {!interestStats ? (
              <div style={{ color: '#888', fontSize: 13 }}>{lang === 'da' ? 'Henter…' : 'Loading…'}</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
                  <div style={{ flex: 1, background: '#F0FAF4', border: '1px solid #b7dfca', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#2D6A4F' }}>{interestStats.withInterests}</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{t.adminInterestStatsUsers}</div>
                  </div>
                  <div style={{ flex: 1, background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#555' }}>{interestStats.total}</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{lang === 'da' ? 'Brugere i alt' : 'Total users'}</div>
                  </div>
                  <div style={{ flex: 1, background: '#FFF8F2', border: '1px solid #f2d2b5', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#E07B39' }}>
                      {interestStats.total > 0 ? Math.round((interestStats.withInterests / interestStats.total) * 100) : 0}%
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{lang === 'da' ? 'Andel' : 'Adoption'}</div>
                  </div>
                </div>
                {interestStats.topInterests.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 10 }}>{t.adminInterestStatsTop}</div>
                    {interestStats.topInterests.slice(0, 10).map(({ id, count }) => {
                      const cat = INTEREST_CATEGORIES.find(c => c.id === id)
                      const maxCount = interestStats.topInterests[0].count || 1
                      return (
                        <div key={id} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 13 }}>
                            <span>{cat?.icon} {cat?.[lang] || id}</span>
                            <span style={{ fontWeight: 700, color: '#2D6A4F' }}>{count}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: '#e8e4df', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round((count / maxCount) * 100)}%`, background: '#2D6A4F', borderRadius: 3, transition: 'width 0.4s' }} />
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {adminTab === 'viral' && (
        <AdminViralStats viralStats={viralStats} viralDays={viralDays} setViralDays={setViralDays} lang={lang} />
      )}

      {adminTab === 'security' && (
        <AdminSecurityGdpr viralStats={viralStats} lang={lang} />
      )}

      {adminTab === 'stripe' && (
        <div className="p-card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>💳 {t.adminStripeTitle}</h3>
          <div style={{ background: '#F0F7FF', border: '1px solid #BDD8F9', borderRadius: 8, padding: '12px 14px', marginBottom: 20, fontSize: 13, lineHeight: 1.6, color: '#2C4A6E' }}>
            ℹ️ {t.adminStripeInfoCard}
          </div>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {STRIPE_FIELDS.map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label style={lS}>{label}</label>
                  <input
                    style={fS}
                    type={type}
                    placeholder={placeholder}
                    value={form[key] || ''}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>
              <button
                type="submit"
                disabled={status === 'saving'}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: status === 'saved' ? '#40916C' : '#2D6A4F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                {status === 'saving' ? t.adminSaving : status === 'saved' ? t.adminSaved : t.adminSave}
              </button>
            </div>
          </form>
        </div>
      )}

      {adminTab === 'security' && (
        <div className="p-card" style={{ marginBottom: 20, padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>🔒 {lang === 'da' ? 'Adgangskodepolitik' : 'Password policy'}</h3>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666' }}>
            {lang === 'da' ? 'Krav der gælder ved oprettelse, nulstilling og skift af adgangskode.' : 'Requirements enforced on registration, reset, and password change.'}
          </p>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lS}>{lang === 'da' ? 'Minimumslængde' : 'Minimum length'}</label>
                <input
                  style={{ ...fS, width: 120 }}
                  type="number" min="4" max="64"
                  value={form.pwd_min_length || '6'}
                  onChange={e => setForm(prev => ({ ...prev, pwd_min_length: e.target.value }))}
                />
              </div>
              {[
                { key: 'pwd_require_uppercase', da: 'Kræv stort bogstav (A–Z)', en: 'Require uppercase letter (A–Z)' },
                { key: 'pwd_require_lowercase', da: 'Kræv lille bogstav (a–z)', en: 'Require lowercase letter (a–z)' },
                { key: 'pwd_require_numbers',   da: 'Kræv tal (0–9)',           en: 'Require number (0–9)' },
                { key: 'pwd_require_symbols',   da: 'Kræv specialtegn (!@#$…)', en: 'Require symbol (!@#$…)' },
              ].map(({ key, da, en }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={form[key] === '1'}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.checked ? '1' : '0' }))}
                    style={{ width: 16, height: 16, accentColor: '#2D6A4F', cursor: 'pointer' }}
                  />
                  {lang === 'da' ? da : en}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>
              <button
                type="submit"
                disabled={status === 'saving'}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: status === 'saved' ? '#40916C' : '#2D6A4F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                {status === 'saving' ? t.adminSaving : status === 'saved' ? t.adminSaved : t.adminSave}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
