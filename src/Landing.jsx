import { useState, useCallback } from 'react'
import { nameToColor, getInitials } from './data.js'

// Placeholder friends for the invite step (migration wizard only)
const INVITE_FRIENDS = [
  { name: 'Ven 1', mutual: 5, online: false },
  { name: 'Ven 2', mutual: 3, online: true },
  { name: 'Ven 3', mutual: 8, online: false },
]
import { apiLogin, apiRegister, apiForgotPassword, apiResetPassword, getFacebookAuthUrl, apiSendInvites, apiGetInviteLink } from './api.js'

// ── Landing translations ──
const T = {
  da: {
    navBrand: 'fellis.eu',
    langToggle: 'EN',
    loginBtn: 'Log ind',
    headline: 'Flyt dit sociale liv til Europa',
    subtitle: 'Migrer dine Facebook-data sikkert til fellis.eu — den nye danske platform bygget til dig, ikke til annoncører.',
    cta: 'Kom i gang',
    fbCardTitle: 'Migrer fra Facebook',
    fbCardDesc: 'Importer dine opslag, fotos og venner sikkert til fellis.eu.',
    fbCardBtn: 'Kom i gang med Facebook',
    createCardTitle: 'Opret ny konto',
    createCardDesc: 'Start frisk på fellis.eu uden at importere fra Facebook.',
    createCardBtn: 'Opret konto',
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
    inviteLinkTitle: 'Del dit invitationslink',
    inviteLinkDesc: 'Del dette link med dine Facebook-venner, så I automatisk bliver forbundet på fellis.eu',
    copyLink: 'Kopier link',
    linkCopied: 'Kopieret!',
    shareOnFacebook: 'Del på Facebook',
    invitedBy: 'inviterer dig til fellis.eu',
    doneTitle: 'Velkommen til fellis.eu!',
    doneSubtitle: 'Din migrering er fuldført. Dit nye digitale hjem venter.',
    itemsMigrated: 'Elementer migreret',
    friendsInvited: 'Venner inviteret',
    viewProfile: 'Se din profil',
    tagProfile: 'Profil',
    tagFriends: '312 venner',
    tagPosts: '847 opslag',
    tagPhotos: '2.341 fotos',
    fbLoginTitle: 'Log ind på Facebook',
    fbEmail: 'E-mail eller telefonnummer',
    fbPassword: 'Adgangskode',
    fbLogin: 'Log ind',
    fbCancel: 'Annuller',
    fbForgot: 'Glemt adgangskode?',
    // Login modal
    loginTitle: 'Log ind på fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Adgangskode',
    loginSubmit: 'Log ind',
    loginCancel: 'Annuller',
    loginError: 'Ugyldig e-mail eller adgangskode',
    loginNoAccount: 'Har du ikke en konto?',
    loginSignup: 'Kom i gang',
    forgotPassword: 'Glemt adgangskode?',
    forgotTitle: 'Nulstil adgangskode',
    forgotEmail: 'Din e-mail',
    forgotSubmit: 'Send nulstilingslink',
    forgotSent: 'Nulstillingslink sendt!',
    forgotSetNew: 'Opret ny adgangskode',
    forgotNewPassword: 'Ny adgangskode (min. 6 tegn)',
    forgotConfirm: 'Gem adgangskode',
    forgotSuccess: 'Adgangskode opdateret! Du er nu logget ind.',
    forgotError: 'Kunne ikke nulstille adgangskode',
    forgotFbNote: 'Din konto blev oprettet via Facebook. Opret en adgangskode for at logge ind med e-mail.',
    forgotBack: 'Tilbage til login',
    // Register fields (step 4)
    registerTitle: 'Opret din fellis.eu konto',
    registerName: 'Fulde navn',
    registerEmail: 'E-mail',
    registerPassword: 'Vælg adgangskode (min. 6 tegn)',
    registerSubmit: 'Opret konto & gå til profil',
    registerError: 'Kunne ikke oprette konto',
    // Create account card (step 1)
    createAccountTitle: 'Opret konto direkte',
    createAccountDesc: 'Opret en konto uden Facebook — brug e-mail og adgangskode.',
    createAccountBtn: 'Opret konto',
    orDivider: 'eller',
  },
  en: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Log in',
    headline: 'Move your social life to Europe',
    subtitle: 'Securely migrate your Facebook data to fellis.eu — the new Danish platform built for you, not advertisers.',
    cta: 'Get started',
    fbCardTitle: 'Migrate from Facebook',
    fbCardDesc: 'Securely import your posts, photos and friends to fellis.eu.',
    fbCardBtn: 'Get started with Facebook',
    createCardTitle: 'Create new account',
    createCardDesc: 'Start fresh on fellis.eu without importing from Facebook.',
    createCardBtn: 'Create account',
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
    inviteLinkTitle: 'Share your invite link',
    inviteLinkDesc: 'Share this link with your Facebook friends so you automatically connect on fellis.eu',
    copyLink: 'Copy link',
    linkCopied: 'Copied!',
    shareOnFacebook: 'Share on Facebook',
    invitedBy: 'invites you to fellis.eu',
    doneTitle: 'Welcome to fellis.eu!',
    doneSubtitle: 'Your migration is complete. Your new digital home awaits.',
    itemsMigrated: 'Items migrated',
    friendsInvited: 'Friends invited',
    viewProfile: 'View your profile',
    tagProfile: 'Profile',
    tagFriends: '312 friends',
    tagPosts: '847 posts',
    tagPhotos: '2,341 photos',
    fbLoginTitle: 'Log in to Facebook',
    fbEmail: 'Email or phone number',
    fbPassword: 'Password',
    fbLogin: 'Log in',
    fbCancel: 'Cancel',
    fbForgot: 'Forgotten password?',
    // Login modal
    loginTitle: 'Log in to fellis.eu',
    loginEmail: 'Email',
    loginPassword: 'Password',
    loginSubmit: 'Log in',
    loginCancel: 'Cancel',
    loginError: 'Invalid email or password',
    loginNoAccount: "Don't have an account?",
    loginSignup: 'Get started',
    forgotPassword: 'Forgotten password?',
    forgotTitle: 'Reset password',
    forgotEmail: 'Your email',
    forgotSubmit: 'Send reset link',
    forgotSent: 'Reset link sent!',
    forgotSetNew: 'Set new password',
    forgotNewPassword: 'New password (min. 6 characters)',
    forgotConfirm: 'Save password',
    forgotSuccess: 'Password updated! You are now logged in.',
    forgotError: 'Could not reset password',
    forgotFbNote: 'Your account was created via Facebook. Set a password to log in with email.',
    forgotBack: 'Back to login',
    // Register fields (step 4)
    registerTitle: 'Create your fellis.eu account',
    registerName: 'Full name',
    registerEmail: 'Email',
    registerPassword: 'Choose a password (min. 6 characters)',
    registerSubmit: 'Create account & go to profile',
    registerError: 'Could not create account',
    // Create account card (step 1)
    createAccountTitle: 'Create account directly',
    createAccountDesc: 'Create an account without Facebook — use email and password.',
    createAccountBtn: 'Create account',
    orDivider: 'or',
  },
}

export default function Landing({ onEnterPlatform, inviteToken, inviterName }) {
  const [lang, setLang] = useState('da')
  const [step, setStep] = useState(0)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [selectedContent, setSelectedContent] = useState({ profile: true, friends: true, posts: true })
  const [importLoading, setImportLoading] = useState(false)
  const [selectedFriends, setSelectedFriends] = useState(new Set(INVITE_FRIENDS.map((_, i) => i)))
  const [inviteLoading, setInviteLoading] = useState(false)
  const [invitedCount, setInvitedCount] = useState(0)
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false)
  const [inviteLink, setInviteLink] = useState('')

  // Login modal state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(null) // null | 'email' | 'reset' | 'done'
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotToken, setForgotToken] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotFbNote, setForgotFbNote] = useState(false)

  // Direct signup (skipping Facebook migration)
  const [directSignup, setDirectSignup] = useState(false)

  // Register state (step 4)
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)

  const t = T[lang]

  const toggleLang = useCallback(() => setLang(p => p === 'da' ? 'en' : 'da'), [])

  // ── Login handler ──
  const handleLogin = useCallback(async (e) => {
    e.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError(t.loginError)
      return
    }
    setLoginLoading(true)
    setLoginError('')
    try {
      const data = await apiLogin(loginEmail.trim(), loginPassword.trim(), lang)
      if (data?.sessionId) {
        setShowLoginModal(false)
        onEnterPlatform(lang)
      } else {
        setLoginError(t.loginError)
      }
    } catch {
      setLoginError(t.loginError)
    }
    setLoginLoading(false)
  }, [loginEmail, loginPassword, lang, t, onEnterPlatform])

  // ── Forgot password handlers ──
  const handleForgotSubmitEmail = useCallback(async (e) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    setForgotError('')
    try {
      const data = await apiForgotPassword(forgotEmail.trim())
      if (data?.resetToken) {
        setForgotToken(data.resetToken)
        setForgotFbNote(data.isFacebookUser && !data.hasPassword)
        setForgotMode('reset')
      } else {
        setForgotError(t.forgotError)
      }
    } catch {
      setForgotError(t.forgotError)
    }
    setForgotLoading(false)
  }, [forgotEmail, t])

  const handleForgotResetPw = useCallback(async (e) => {
    e.preventDefault()
    if (!forgotNewPw.trim() || forgotNewPw.length < 6) {
      setForgotError(lang === 'da' ? 'Adgangskode skal være mindst 6 tegn' : 'Password must be at least 6 characters')
      return
    }
    setForgotLoading(true)
    setForgotError('')
    try {
      const data = await apiResetPassword(forgotToken, forgotNewPw.trim())
      if (data?.sessionId) {
        setForgotMode('done')
        setTimeout(() => {
          setShowLoginModal(false)
          setForgotMode(null)
          onEnterPlatform(lang)
        }, 1500)
      } else {
        setForgotError(t.forgotError)
      }
    } catch {
      setForgotError(t.forgotError)
    }
    setForgotLoading(false)
  }, [forgotToken, forgotNewPw, lang, t, onEnterPlatform])

  const openForgotPassword = useCallback(() => {
    setForgotMode('email')
    setForgotEmail(loginEmail)
    setForgotError('')
    setForgotNewPw('')
    setForgotFbNote(false)
  }, [loginEmail])

  const closeForgotPassword = useCallback(() => {
    setForgotMode(null)
    setForgotError('')
  }, [])

  // ── Register handler (step 4 done) ──
  const handleRegister = useCallback(async (e) => {
    e.preventDefault()
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      setRegError(t.registerError)
      return
    }
    if (regPassword.length < 6) {
      setRegError(lang === 'da' ? 'Adgangskode skal være mindst 6 tegn' : 'Password must be at least 6 characters')
      return
    }
    setRegLoading(true)
    setRegError('')
    try {
      const data = await apiRegister(regName.trim(), regEmail.trim(), regPassword.trim(), lang, inviteToken || undefined)
      if (data?.sessionId) {
        onEnterPlatform(lang)
      } else {
        // Server not running — enter demo mode
        onEnterPlatform(lang)
      }
    } catch {
      setRegError(t.registerError)
      setRegLoading(false)
    }
  }, [regName, regEmail, regPassword, lang, t, onEnterPlatform, inviteToken])

  // Redirect to real Facebook OAuth
  const handleFbClick = useCallback(() => {
    window.location.href = getFacebookAuthUrl(lang)
  }, [lang])

  const handleContentNext = useCallback(() => {
    setImportLoading(true)
    apiGetInviteLink().then(data => { if (data?.token) setInviteLink(`https://fellis.eu/?invite=${data.token}`) })
    setTimeout(() => { setImportLoading(false); setStep(3) }, 1800)
  }, [])

  const toggleFriend = useCallback((idx) => {
    setSelectedFriends(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  const toggleAllFriends = useCallback(() => {
    setSelectedFriends(prev => prev.size === INVITE_FRIENDS.length ? new Set() : new Set(INVITE_FRIENDS.map((_, i) => i)))
  }, [])

  const handleSendInvites = useCallback(async () => {
    setInviteLoading(true)
    const count = selectedFriends.size
    const friendsList = Array.from(selectedFriends).map(idx => ({ name: INVITE_FRIENDS[idx].name }))
    try {
      await apiSendInvites(friendsList)
    } catch {
      // Continue even if API fails (demo mode)
    }
    setTimeout(() => { setInviteLoading(false); setInvitedCount(count); setStep(4) }, 2000)
  }, [selectedFriends])

  const handleSkip = useCallback(() => { setInvitedCount(0); setStep(4) }, [])

  const migratedCount = (selectedContent.profile ? 1 : 0) + (selectedContent.friends ? 312 : 0) + (selectedContent.posts ? 847 : 0)

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-logo-icon">F</div>
          {t.navBrand}
        </div>
        <div className="nav-right-group">
          <button className="lang-toggle" onClick={toggleLang}>{t.langToggle}</button>
          <button className="login-btn" onClick={() => { setShowLoginModal(true); setLoginError(''); setLoginEmail(''); setLoginPassword('') }}>
            {t.loginBtn}
          </button>
        </div>
      </nav>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="modal-backdrop" onClick={() => { setShowLoginModal(false); setForgotMode(null) }}>
          <div className="fb-modal" onClick={e => e.stopPropagation()}>
            <div className="fb-modal-header" style={{ background: '#2D6A4F' }}>
              <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif" }}>fellis.eu</div>
            </div>

            {/* Normal login */}
            {!forgotMode && (
              <form className="fb-modal-form" onSubmit={handleLogin}>
                <h3>{t.loginTitle}</h3>
                <input
                  type="email"
                  placeholder={t.loginEmail}
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="fb-input"
                  autoFocus
                />
                <input
                  type="password"
                  placeholder={t.loginPassword}
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  className="fb-input"
                />
                {loginError && <div className="fb-error">{loginError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={loginLoading}>
                  {loginLoading ? '...' : t.loginSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={openForgotPassword}>{t.forgotPassword}</button>
                <div className="fb-forgot-link" style={{ marginTop: 8 }}>
                  {t.loginNoAccount}{' '}
                  <span style={{ color: '#2D6A4F', cursor: 'pointer', fontWeight: 600 }} onClick={() => { setShowLoginModal(false); setDirectSignup(true); setStep(4) }}>
                    {t.loginSignup}
                  </span>
                </div>
              </form>
            )}

            {/* Forgot password: enter email */}
            {forgotMode === 'email' && (
              <form className="fb-modal-form" onSubmit={handleForgotSubmitEmail}>
                <h3>{t.forgotTitle}</h3>
                <input
                  type="email"
                  placeholder={t.forgotEmail}
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  className="fb-input"
                  autoFocus
                />
                {forgotError && <div className="fb-error">{forgotError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={forgotLoading}>
                  {forgotLoading ? '...' : t.forgotSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={closeForgotPassword}>{t.forgotBack}</button>
              </form>
            )}

            {/* Forgot password: set new password */}
            {forgotMode === 'reset' && (
              <form className="fb-modal-form" onSubmit={handleForgotResetPw}>
                <h3>{t.forgotSetNew}</h3>
                {forgotFbNote && <div className="fb-info-note">{t.forgotFbNote}</div>}
                <input
                  type="password"
                  placeholder={t.forgotNewPassword}
                  value={forgotNewPw}
                  onChange={e => setForgotNewPw(e.target.value)}
                  className="fb-input"
                  autoFocus
                  minLength={6}
                />
                {forgotError && <div className="fb-error">{forgotError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={forgotLoading}>
                  {forgotLoading ? '...' : t.forgotConfirm}
                </button>
                <button type="button" className="fb-forgot" onClick={closeForgotPassword}>{t.forgotBack}</button>
              </form>
            )}

            {/* Forgot password: success */}
            {forgotMode === 'done' && (
              <div className="fb-modal-form" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
                <p style={{ color: '#2D6A4F', fontWeight: 600 }}>{t.forgotSuccess}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Invite banner (shown when arriving via invite link) */}
      {inviterName && step === 0 && (
        <div className="invite-banner">
          <div className="invite-banner-text">
            <strong>{inviterName}</strong> {t.invitedBy}
          </div>
        </div>
      )}

      {/* Landing */}
      {step === 0 && (
        <div className="landing">
          <h1>{t.headline}</h1>
          <p className="landing-subtitle">{t.subtitle}</p>
          <div className="landing-cards">
            {/* Facebook migration card */}
            <div className="landing-card landing-card-fb">
              <div className="landing-card-visual">
                <div className="brand-box brand-fb" style={{ width: 56, height: 56, fontSize: 22 }}>f</div>
                <div className="dots-container" style={{ gap: 6 }}>
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <div className="brand-box brand-some" style={{ width: 56, height: 56, fontSize: 22 }}>F</div>
              </div>
              <h3>{t.fbCardTitle}</h3>
              <p>{t.fbCardDesc}</p>
              <button className="landing-card-btn landing-card-btn-fb" onClick={() => setStep(1)}>{t.fbCardBtn}</button>
            </div>
            {/* Create account card */}
            <div className="landing-card landing-card-create">
              <div className="landing-card-visual">
                <div className="brand-box brand-some" style={{ width: 72, height: 72, fontSize: 28 }}>F</div>
              </div>
              <h3>{t.createCardTitle}</h3>
              <p>{t.createCardDesc}</p>
              <button className="landing-card-btn landing-card-btn-create" onClick={() => { setDirectSignup(true); setStep(4) }}>{t.createCardBtn}</button>
            </div>
          </div>
          <div className="trust-row">
            <div className="trust-item"><div className="trust-icon">🔒</div><span className="trust-label">{t.trustEncrypt}</span></div>
            <div className="trust-item"><div className="trust-icon">🇪🇺</div><a href="https://yggdrasilcloud.dk/" target="_blank" rel="noopener noreferrer" className="trust-label trust-link">{t.trustEU}</a></div>
            <div className="trust-item"><div className="trust-icon">🗑️</div><span className="trust-label">{t.trustDelete}</span></div>
          </div>
        </div>
      )}

      {step >= 1 && !directSignup && <ProgressBar step={step} t={t} />}

      {/* Step 1 — Connect Facebook or Create Account */}
      {step === 1 && (
        <div className="step-container">
          <h2>{t.connectTitle}</h2>
          <p className="step-subtitle">{t.connectSubtitle}</p>
          <div className="step1-options">
            <div className="step1-card">
              <div className="step1-card-icon" style={{ background: '#EBF4FF' }}>f</div>
              <h4>{t.connectBtn}</h4>
              <p className="step1-card-desc">{lang === 'da'
                ? 'Importer dine data fra Facebook automatisk.'
                : 'Automatically import your data from Facebook.'
              }</p>
              <button className="fb-btn" onClick={handleFbClick}>
                <span className="fb-icon">f</span>
                {t.connectBtn}
              </button>
            </div>
            <div className="step1-divider">
              <span>{t.orDivider}</span>
            </div>
            <div className="step1-card">
              <div className="step1-card-icon" style={{ background: '#F0FAF4' }}>✉</div>
              <h4>{t.createAccountTitle}</h4>
              <p className="step1-card-desc">{t.createAccountDesc}</p>
              <button className="btn-primary" style={{ width: '100%' }} onClick={() => { setDirectSignup(true); setStep(4) }}>
                {t.createAccountBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="step-container">
          {importLoading ? (
            <div className="loading-overlay"><div className="spinner" /><p className="loading-text">{t.importing}</p></div>
          ) : (
            <>
              <h2>{t.selectTitle}</h2>
              <p className="step-subtitle">{t.selectSubtitle}</p>
              <div className="content-cards">
                <ContentCard icon="👤" title={t.profileInfo} desc={t.profileInfoDesc} selected={selectedContent.profile} onToggle={() => setSelectedContent(s => ({ ...s, profile: !s.profile }))} />
                <ContentCard icon="👥" title={t.friendsList} desc={t.friendsListDesc} selected={selectedContent.friends} onToggle={() => setSelectedContent(s => ({ ...s, friends: !s.friends }))} />
                <ContentCard icon="📸" title={t.postsPhotos} desc={t.postsPhotosDesc} selected={selectedContent.posts} onToggle={() => setSelectedContent(s => ({ ...s, posts: !s.posts }))} />
              </div>
              <div className="btn-row">
                <button className="btn-secondary" onClick={() => setStep(1)}>{t.back}</button>
                <button className="btn-primary" onClick={handleContentNext}>{t.next}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="step-container">
          {inviteLoading ? (
            <div className="loading-overlay"><div className="spinner" /><p className="loading-text">{t.sendingInvites}</p></div>
          ) : (
            <>
              <h2>{t.inviteTitle}</h2>
              <p className="step-subtitle">{t.inviteSubtitle}</p>

              {/* Shareable invite link section */}
              <div className="invite-link-section">
                <h4 className="invite-link-title">{t.inviteLinkTitle}</h4>
                <p className="invite-link-desc">{t.inviteLinkDesc}</p>
                <div className="invite-link-row">
                  <input
                    className="invite-link-input"
                    value={inviteLink || `https://fellis.eu/?invite=…`}
                    readOnly
                    onClick={e => e.target.select()}
                  />
                  <button
                    className="invite-link-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink || '').catch(() => {})
                      setInviteLinkCopied(true)
                      setTimeout(() => setInviteLinkCopied(false), 2000)
                    }}
                  >
                    {inviteLinkCopied ? t.linkCopied : t.copyLink}
                  </button>
                </div>
                <button
                  className="fb-share-btn"
                  onClick={() => {
                    const shareUrl = encodeURIComponent(inviteLink || 'https://fellis.eu')
                    window.open(
                      `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
                      'facebook-share',
                      'width=580,height=400'
                    )
                  }}
                >
                  <span className="fb-icon">f</span>
                  {t.shareOnFacebook}
                </button>
              </div>

              <div className="invite-divider">
                <span>{lang === 'da' ? 'eller vælg venner' : 'or select friends'}</span>
              </div>

              <div className="friends-header">
                <span style={{ fontSize: 14, color: '#6B6560' }}>{selectedFriends.size} / {INVITE_FRIENDS.length}</span>
                <button className="select-all-btn" onClick={toggleAllFriends}>
                  {selectedFriends.size === INVITE_FRIENDS.length ? t.deselectAll : t.selectAll}
                </button>
              </div>
              <div className="friends-list">
                {INVITE_FRIENDS.map((friend, idx) => (
                  <div key={idx} className={`friend-item${selectedFriends.has(idx) ? ' selected' : ''}`} onClick={() => toggleFriend(idx)}>
                    <div className="friend-avatar" style={{ background: nameToColor(friend.name) }}>
                      {getInitials(friend.name)}
                      {friend.online && <div className="online-dot" />}
                    </div>
                    <div className="friend-info">
                      <div className="friend-name">{friend.name}</div>
                      <div className="friend-mutual">{friend.mutual} {t.mutualFriends}</div>
                    </div>
                    <input type="checkbox" className="friend-check" checked={selectedFriends.has(idx)} onChange={() => toggleFriend(idx)} onClick={e => e.stopPropagation()} />
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn-secondary" onClick={handleSkip}>{t.skip}</button>
                <button className="btn-primary" onClick={handleSendInvites}>{t.sendInvites} ({selectedFriends.size})</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4 — Done + Register */}
      {step === 4 && (
        <div className="step-container done-page">
          {!directSignup && (
            <>
              <div className="done-checkmark">✓</div>
              <h2>{t.doneTitle}</h2>
              <p className="step-subtitle">{t.doneSubtitle}</p>
              <div className="done-stats">
                <div className="stat-item"><div className="stat-number">{migratedCount.toLocaleString()}</div><div className="stat-label">{t.itemsMigrated}</div></div>
                <div className="stat-item"><div className="stat-number">{invitedCount}</div><div className="stat-label">{t.friendsInvited}</div></div>
              </div>
            </>
          )}

          {/* Registration form */}
          <form className="register-form" onSubmit={handleRegister}>
            <h3 className="register-title">{t.registerTitle}</h3>
            <input
              type="text"
              placeholder={t.registerName}
              value={regName}
              onChange={e => setRegName(e.target.value)}
              className="register-input"
              required
            />
            <input
              type="email"
              placeholder={t.registerEmail}
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
              className="register-input"
              required
            />
            <input
              type="password"
              placeholder={t.registerPassword}
              value={regPassword}
              onChange={e => setRegPassword(e.target.value)}
              className="register-input"
              minLength={6}
              required
            />
            {regError && <div className="fb-error">{regError}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={regLoading}>
              {regLoading ? '...' : t.registerSubmit}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function ProgressBar({ step, t }) {
  const steps = [t.step1, t.step2, t.step3, t.step4]
  return (
    <div className="progress-bar">
      {steps.map((label, i) => {
        const num = i + 1
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <div className="progress-connector" style={{ background: step > num ? '#40916C' : step >= num ? '#2D6A4F' : '#E8E4DF' }} />}
            <div className={`progress-step${step > num ? ' completed' : ''}${step === num ? ' active' : ''}`}>
              <div className="progress-dot">{step > num ? '✓' : num}</div>
              <span>{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ContentCard({ icon, title, desc, selected, onToggle }) {
  return (
    <div className={`content-card${selected ? ' selected' : ''}`} onClick={onToggle}>
      <div className="card-icon">{icon}</div>
      <div className="card-text"><h4>{title}</h4><p>{desc}</p></div>
      <input type="checkbox" className="card-check" checked={selected} onChange={onToggle} onClick={e => e.stopPropagation()} />
    </div>
  )
}
