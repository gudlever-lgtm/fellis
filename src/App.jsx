import { useState, useCallback } from 'react'
import './App.css'

// ── Translations ──
const T = {
  da: {
    navBrand: 'fellis.eu',
    langToggle: 'EN',
    headline: 'Flyt dit sociale liv til Europa',
    subtitle: 'Migrer dine Facebook-data sikkert til fellis.eu — den nye danske platform bygget til dig, ikke til annoncører.',
    cta: 'Kom i gang',
    trustEncrypt: 'End-to-end krypteret',
    trustEU: 'Hostet i EU',
    trustDelete: 'Data slettet efter migrering',
    step1: 'Forbind Facebook',
    step2: 'Vælg indhold',
    step3: 'Inviter venner',
    step4: 'Velkommen til fellis.eu',
    connectTitle: 'Forbind din Facebook-konto',
    connectSubtitle: 'Vi henter dine data sikkert og sletter dem fra vores servere efter migrering.',
    connectBtn: 'Forbind med Facebook',
    connecting: 'Forbinder...',
    connected: 'Forbundet!',
    friends: 'Venner',
    posts: 'Opslag',
    photos: 'Fotos',
    selectTitle: 'Vælg indhold der skal migreres',
    selectSubtitle: 'Vælg hvad du vil tage med til fellis.eu',
    profileInfo: 'Profiloplysninger',
    profileInfoDesc: 'Navn, bio, profilbillede',
    friendsList: 'Venneliste',
    friendsListDesc: '312 kontakter',
    postsPhotos: 'Opslag & fotos',
    postsPhotosDesc: '847 opslag og fotos',
    back: 'Tilbage',
    next: 'Næste',
    importing: 'Importerer dit indhold...',
    inviteTitle: 'Inviter dine venner',
    inviteSubtitle: 'Hjælp dine venner med at skifte til fellis.eu',
    selectAll: 'Vælg alle',
    deselectAll: 'Fravælg alle',
    mutualFriends: 'fælles venner',
    skip: 'Spring over',
    sendInvites: 'Send invitationer',
    sendingInvites: 'Sender invitationer...',
    doneTitle: 'Velkommen til fellis.eu!',
    doneSubtitle: 'Din migrering er fuldført. Dit nye digitale hjem venter.',
    itemsMigrated: 'Elementer migreret',
    friendsInvited: 'Venner inviteret',
    profilePreview: 'Din fellis.eu profil',
    viewProfile: 'Se din profil',
    tagProfile: 'Profil',
    tagFriends: '312 venner',
    tagPosts: '847 opslag',
    tagPhotos: '2.341 fotos',
  },
  en: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    headline: 'Move your social life to Europe',
    subtitle: 'Securely migrate your Facebook data to fellis.eu — the new Danish platform built for you, not advertisers.',
    cta: 'Get started',
    trustEncrypt: 'End-to-end encrypted',
    trustEU: 'EU hosted',
    trustDelete: 'Data deleted after migration',
    step1: 'Connect Facebook',
    step2: 'Select content',
    step3: 'Invite friends',
    step4: 'Welcome to fellis.eu',
    connectTitle: 'Connect your Facebook account',
    connectSubtitle: 'We securely fetch your data and delete it from our servers after migration.',
    connectBtn: 'Connect with Facebook',
    connecting: 'Connecting...',
    connected: 'Connected!',
    friends: 'Friends',
    posts: 'Posts',
    photos: 'Photos',
    selectTitle: 'Select content to migrate',
    selectSubtitle: 'Choose what to bring to fellis.eu',
    profileInfo: 'Profile info',
    profileInfoDesc: 'Name, bio, profile photo',
    friendsList: 'Friends list',
    friendsListDesc: '312 contacts',
    postsPhotos: 'Posts & photos',
    postsPhotosDesc: '847 posts and photos',
    back: 'Back',
    next: 'Next',
    importing: 'Importing your content...',
    inviteTitle: 'Invite your friends',
    inviteSubtitle: 'Help your friends switch to fellis.eu',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    mutualFriends: 'mutual friends',
    skip: 'Skip',
    sendInvites: 'Send invitations',
    sendingInvites: 'Sending invitations...',
    doneTitle: 'Welcome to fellis.eu!',
    doneSubtitle: 'Your migration is complete. Your new digital home awaits.',
    itemsMigrated: 'Items migrated',
    friendsInvited: 'Friends invited',
    profilePreview: 'Your fellis.eu profile',
    viewProfile: 'View your profile',
    tagProfile: 'Profile',
    tagFriends: '312 friends',
    tagPosts: '847 posts',
    tagPhotos: '2,341 photos',
  },
}

// ── Fake friends data ──
const FRIENDS = [
  { name: 'Sofie Nielsen', mutual: 24, online: true },
  { name: 'Magnus Jensen', mutual: 18, online: true },
  { name: 'Freja Andersen', mutual: 31, online: false },
  { name: 'Emil Larsen', mutual: 12, online: true },
  { name: 'Ida Pedersen', mutual: 27, online: false },
  { name: 'Oscar Christensen', mutual: 9, online: true },
  { name: 'Alma Hansen', mutual: 22, online: true },
  { name: 'Viktor Mortensen', mutual: 15, online: false },
  { name: 'Clara Johansen', mutual: 33, online: true },
  { name: 'Noah Rasmussen', mutual: 7, online: false },
  { name: 'Astrid Poulsen', mutual: 19, online: true },
  { name: 'Liam Madsen', mutual: 11, online: false },
]

// Deterministic color from name
function nameToColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = ['#2D6A4F', '#40916C', '#52B788', '#1877F2', '#6C63FF', '#E07A5F', '#D4A574', '#81B29A', '#3D405B', '#F2CC8F']
  return colors[Math.abs(hash) % colors.length]
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('')
}

// ── App ──
function App() {
  const [lang, setLang] = useState('da')
  const [step, setStep] = useState(0) // 0=landing, 1-4=steps
  const [fbConnecting, setFbConnecting] = useState(false)
  const [fbConnected, setFbConnected] = useState(false)
  const [selectedContent, setSelectedContent] = useState({ profile: true, friends: true, posts: true })
  const [importLoading, setImportLoading] = useState(false)
  const [selectedFriends, setSelectedFriends] = useState(new Set(FRIENDS.map((_, i) => i)))
  const [inviteLoading, setInviteLoading] = useState(false)
  const [invitedCount, setInvitedCount] = useState(0)

  const t = T[lang]

  const toggleLang = useCallback(() => {
    setLang(prev => prev === 'da' ? 'en' : 'da')
  }, [])

  // Facebook connect simulation
  const handleFbConnect = useCallback(() => {
    setFbConnecting(true)
    setTimeout(() => {
      setFbConnecting(false)
      setFbConnected(true)
      setTimeout(() => setStep(2), 800)
    }, 2000)
  }, [])

  // Content selection next
  const handleContentNext = useCallback(() => {
    setImportLoading(true)
    setTimeout(() => {
      setImportLoading(false)
      setStep(3)
    }, 1800)
  }, [])

  // Toggle friend selection
  const toggleFriend = useCallback((idx) => {
    setSelectedFriends(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleAllFriends = useCallback(() => {
    setSelectedFriends(prev => {
      if (prev.size === FRIENDS.length) return new Set()
      return new Set(FRIENDS.map((_, i) => i))
    })
  }, [])

  // Send invitations
  const handleSendInvites = useCallback(() => {
    setInviteLoading(true)
    const count = selectedFriends.size
    setTimeout(() => {
      setInviteLoading(false)
      setInvitedCount(count)
      setStep(4)
    }, 2000)
  }, [selectedFriends.size])

  // Skip invites
  const handleSkip = useCallback(() => {
    setInvitedCount(0)
    setStep(4)
  }, [])

  // Reset demo
  const handleReset = useCallback(() => {
    setStep(0)
    setFbConnecting(false)
    setFbConnected(false)
    setSelectedContent({ profile: true, friends: true, posts: true })
    setImportLoading(false)
    setSelectedFriends(new Set(FRIENDS.map((_, i) => i)))
    setInviteLoading(false)
    setInvitedCount(0)
  }, [])

  // Calculate migrated items count
  const migratedCount = (selectedContent.profile ? 1 : 0) + (selectedContent.friends ? 312 : 0) + (selectedContent.posts ? 847 : 0)

  // ── Render ──
  return (
    <div className="app">
      {/* Nav */}
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-logo-icon">F</div>
          {t.navBrand}
        </div>
        <button className="lang-toggle" onClick={toggleLang}>
          {t.langToggle}
        </button>
      </nav>

      {/* Landing */}
      {step === 0 && (
        <div className="landing">
          <div className="migration-visual">
            <div className="brand-box brand-fb">f</div>
            <div className="dots-container">
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
            </div>
            <div className="brand-box brand-some">F</div>
          </div>
          <h1>{t.headline}</h1>
          <p className="landing-subtitle">{t.subtitle}</p>
          <button className="cta-btn" onClick={() => setStep(1)}>
            {t.cta}
          </button>
          <div className="trust-row">
            <div className="trust-item">
              <div className="trust-icon">🔒</div>
              <span className="trust-label">{t.trustEncrypt}</span>
            </div>
            <div className="trust-item">
              <div className="trust-icon">🇪🇺</div>
              <span className="trust-label">{t.trustEU}</span>
            </div>
            <div className="trust-item">
              <div className="trust-icon">🗑️</div>
              <span className="trust-label">{t.trustDelete}</span>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar (steps 1-4) */}
      {step >= 1 && <ProgressBar step={step} t={t} />}

      {/* Step 1: Connect Facebook */}
      {step === 1 && (
        <div className="step-container">
          <h2>{t.connectTitle}</h2>
          <p className="step-subtitle">{t.connectSubtitle}</p>

          {fbConnecting ? (
            <div className="loading-overlay">
              <div className="spinner" />
              <p className="loading-text">{t.connecting}</p>
            </div>
          ) : fbConnected ? (
            <div className="connected-state">
              <div className="checkmark-circle">✓</div>
              <p className="connected-label">{t.connected}</p>
              <div className="stats-row">
                <div className="stat-item">
                  <div className="stat-number">312</div>
                  <div className="stat-label">{t.friends}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">847</div>
                  <div className="stat-label">{t.posts}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">2.341</div>
                  <div className="stat-label">{t.photos}</div>
                </div>
              </div>
            </div>
          ) : (
            <button className="fb-btn" onClick={handleFbConnect}>
              <span className="fb-icon">f</span>
              {t.connectBtn}
            </button>
          )}
        </div>
      )}

      {/* Step 2: Select content */}
      {step === 2 && (
        <div className="step-container">
          {importLoading ? (
            <div className="loading-overlay">
              <div className="spinner" />
              <p className="loading-text">{t.importing}</p>
            </div>
          ) : (
            <>
              <h2>{t.selectTitle}</h2>
              <p className="step-subtitle">{t.selectSubtitle}</p>
              <div className="content-cards">
                <ContentCard
                  icon="👤"
                  title={t.profileInfo}
                  desc={t.profileInfoDesc}
                  selected={selectedContent.profile}
                  onToggle={() => setSelectedContent(s => ({ ...s, profile: !s.profile }))}
                />
                <ContentCard
                  icon="👥"
                  title={t.friendsList}
                  desc={t.friendsListDesc}
                  selected={selectedContent.friends}
                  onToggle={() => setSelectedContent(s => ({ ...s, friends: !s.friends }))}
                />
                <ContentCard
                  icon="📸"
                  title={t.postsPhotos}
                  desc={t.postsPhotosDesc}
                  selected={selectedContent.posts}
                  onToggle={() => setSelectedContent(s => ({ ...s, posts: !s.posts }))}
                />
              </div>
              <div className="btn-row">
                <button className="btn-secondary" onClick={() => { setStep(1); setFbConnected(false) }}>
                  {t.back}
                </button>
                <button className="btn-primary" onClick={handleContentNext}>
                  {t.next}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Invite friends */}
      {step === 3 && (
        <div className="step-container">
          {inviteLoading ? (
            <div className="loading-overlay">
              <div className="spinner" />
              <p className="loading-text">{t.sendingInvites}</p>
            </div>
          ) : (
            <>
              <h2>{t.inviteTitle}</h2>
              <p className="step-subtitle">{t.inviteSubtitle}</p>
              <div className="friends-header">
                <span style={{ fontSize: 14, color: '#6B6560' }}>
                  {selectedFriends.size} / {FRIENDS.length}
                </span>
                <button className="select-all-btn" onClick={toggleAllFriends}>
                  {selectedFriends.size === FRIENDS.length ? t.deselectAll : t.selectAll}
                </button>
              </div>
              <div className="friends-list">
                {FRIENDS.map((friend, idx) => (
                  <div
                    key={idx}
                    className={`friend-item${selectedFriends.has(idx) ? ' selected' : ''}`}
                    onClick={() => toggleFriend(idx)}
                  >
                    <div className="friend-avatar" style={{ background: nameToColor(friend.name) }}>
                      {getInitials(friend.name)}
                      {friend.online && <div className="online-dot" />}
                    </div>
                    <div className="friend-info">
                      <div className="friend-name">{friend.name}</div>
                      <div className="friend-mutual">{friend.mutual} {t.mutualFriends}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="friend-check"
                      checked={selectedFriends.has(idx)}
                      onChange={() => toggleFriend(idx)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn-secondary" onClick={handleSkip}>
                  {t.skip}
                </button>
                <button className="btn-primary" onClick={handleSendInvites}>
                  {t.sendInvites} ({selectedFriends.size})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Done */}
      {step === 4 && (
        <div className="step-container done-page">
          <div className="done-checkmark">✓</div>
          <h2>{t.doneTitle}</h2>
          <p className="step-subtitle">{t.doneSubtitle}</p>
          <div className="done-stats">
            <div className="stat-item">
              <div className="stat-number">{migratedCount.toLocaleString()}</div>
              <div className="stat-label">{t.itemsMigrated}</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">{invitedCount}</div>
              <div className="stat-label">{t.friendsInvited}</div>
            </div>
          </div>
          <div className="profile-preview">
            <div className="preview-header">
              <div className="preview-avatar">SN</div>
              <div>
                <div className="preview-name">Sofie Nielsen</div>
                <div className="preview-handle">@sofie.nielsen</div>
              </div>
            </div>
            <div className="preview-tags">
              {selectedContent.profile && <span className="preview-tag">{t.tagProfile}</span>}
              {selectedContent.friends && <span className="preview-tag">{t.tagFriends}</span>}
              {selectedContent.posts && <span className="preview-tag">{t.tagPosts}</span>}
              {selectedContent.posts && <span className="preview-tag">{t.tagPhotos}</span>}
            </div>
          </div>
          <button className="btn-primary" onClick={handleReset}>
            {t.viewProfile}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Progress Bar ──
function ProgressBar({ step, t }) {
  const steps = [t.step1, t.step2, t.step3, t.step4]
  return (
    <div className="progress-bar">
      {steps.map((label, i) => {
        const num = i + 1
        const isCompleted = step > num
        const isActive = step === num
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && (
              <div
                className="progress-connector"
                style={{ background: step > num ? '#40916C' : step >= num ? '#2D6A4F' : '#E8E4DF' }}
              />
            )}
            <div className={`progress-step${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`}>
              <div className="progress-dot">
                {isCompleted ? '✓' : num}
              </div>
              <span>{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Content Card ──
function ContentCard({ icon, title, desc, selected, onToggle }) {
  return (
    <div className={`content-card${selected ? ' selected' : ''}`} onClick={onToggle}>
      <div className="card-icon">{icon}</div>
      <div className="card-text">
        <h4>{title}</h4>
        <p>{desc}</p>
      </div>
      <input
        type="checkbox"
        className="card-check"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export default App
