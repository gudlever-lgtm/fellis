import { useState, useCallback, useEffect, useRef } from 'react'
import { SUPPORTED_LANGS, detectLang, PT } from './data.js'
import { apiLogin, apiRegister, apiForgotPassword, apiResetPassword, apiVerifyMfa, apiGiveConsent } from './api.js'

// ── Landing translations ──
const T = {
  da: {
    navBrand: 'fellis.eu',
    langToggle: 'EN',
    loginBtn: 'Log ind',
    headline: 'Flyt dit sociale liv til Europa',
    subtitle: 'fellis.eu — den nye europæiske platform bygget til dig, ikke til annoncører.',
    cta: 'Kom i gang',
    createCardTitle: 'Opret ny konto',
    createCardDesc: 'Start frisk på fellis.eu med e-mail og adgangskode.',
    createCardBtn: 'Opret konto',
    trustEncrypt: 'End-to-end krypteret',
    trustEU: 'Hostet i EU',
    trustDelete: 'Fuld kontrol over dine data',
    servicesLabel: 'Bygget på europæiske tjenester',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Betaling', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (CV / ansøgning)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Inviter dine venner',
    inviteSubtitle: 'Hjælp dine venner med at skifte til fellis.eu',
    selectAll: 'Vælg alle',
    deselectAll: 'Fravælg alle',
    mutualFriends: 'fælles venner',
    skip: 'Spring over',
    sendInvites: 'Send invitationer',
    sendingInvites: 'Sender invitationer...',
    inviteLinkTitle: 'Del dit invitationslink',
    inviteLinkDesc: 'Del dette link med dine venner, så I automatisk bliver forbundet på fellis.eu',
    copyLink: 'Kopier link',
    linkCopied: 'Kopieret!',
    invitedBy: 'inviterer dig til fellis.eu',
    doneTitle: 'Velkommen til fellis.eu!',
    doneSubtitle: 'Din konto er klar. Dit nye digitale hjem venter.',
    viewProfile: 'Se din profil',
    back: 'Tilbage',
    // Login modal
    loginTitle: 'Log ind på fellis.eu',
    loginEmail: 'E-mail',
    loginPassword: 'Adgangskode',
    loginSubmit: 'Log ind',
    loginCancel: 'Annuller',
    loginError: 'Ugyldig e-mail eller adgangskode',
    loginErrorSocialOnly: 'Denne konto er oprettet via Google eller LinkedIn. Brug den tilsvarende login-knap.',
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
    forgotBack: 'Tilbage til login',
    forgotEmailSent: 'Tjek din e-mail for et nulstillingslink.',
    mfaTitle: 'To-faktor-godkendelse',
    mfaDesc: 'Vi har sendt en 6-cifret kode til dit telefonnummer.',
    mfaCode: 'Engangskode',
    mfaSubmit: 'Bekræft',
    mfaError: 'Ugyldig eller udløbet kode',
    mfaBack: 'Tilbage til login',
    // Register fields (step 4)
    registerTitle: 'Opret din fellis.eu konto',
    registerName: 'Fulde navn',
    registerEmail: 'E-mail',
    registerEmailRepeat: 'Gentag e-mail',
    registerEmailMismatch: 'E-mail adresserne stemmer ikke overens',
    registerPassword: 'Vælg adgangskode (min. 6 tegn)',
    registerPasswordRepeat: 'Gentag adgangskode',
    registerPasswordMismatch: 'Adgangskoderne stemmer ikke overens',
    registerMathChallenge: (a, b) => `Hvad er ${a} + ${b}?`,
    registerMathError: 'Forkert svar — prøv igen',
    registerSubmit: 'Opret konto & gå til profil',
    registerError: 'Kunne ikke oprette konto',
    registerGdpr: 'Jeg accepterer behandling af mine persondata i henhold til fellis.eu\'s',
    registerGdprLink: 'privatlivspolitik',
    registerGdprRequired: 'Du skal acceptere privatlivspolitikken for at oprette en konto',
    // Mode selector (step 5)
    modeStepTitle: 'Vælg din kontotype',
    modeStepSubtitle: 'Du kan altid skifte den i dine profilindstillinger.',
    modeCommon: 'Privat',
    modeBusiness: 'Erhverv',
    modeCommonDesc: 'Til personlig brug, familie og fællesskab. Venner, opslag og begivenheder.',
    modeBusinessDesc: 'Til professionelt netværk og virksomhedsnærvær. Forbindelser, branchebegivenheder og virksomhedssider.',
    modeCommonFeatures: ['Venner & fællesskab', 'Familie-venlige indstillinger', 'Personlige begivenheder'],
    modeBusinessFeatures: ['Professionelle forbindelser', 'Virksomhedssider', 'Konferencer & webinarer'],
    modeSelectBtn: 'Kom i gang',
  },
  en: {
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    loginBtn: 'Log in',
    headline: 'Move your social life to Europe',
    subtitle: 'fellis.eu — the new European platform built for you, not advertisers.',
    cta: 'Get started',
    createCardTitle: 'Create new account',
    createCardDesc: 'Start fresh on fellis.eu with email and password.',
    createCardBtn: 'Create account',
    trustEncrypt: 'End-to-end encrypted',
    trustEU: 'EU hosted',
    trustDelete: 'Full control over your data',
    servicesLabel: 'Built on European services',
    services: [
      { flag: '🇩🇰', name: 'Yggdrasil Cloud', role: 'Hosting', url: 'https://yggdrasilcloud.dk/' },
      { flag: '🇸🇪', name: '46elks', role: 'SMS / MFA', url: 'https://46elks.com/' },
      { flag: '🇳🇱', name: 'Mollie', role: 'Payments', url: 'https://www.mollie.com/' },
      { flag: '🇫🇷', name: 'Mistral AI', role: 'AI (CV / cover letter)', url: 'https://mistral.ai/' },
    ],
    inviteTitle: 'Invite your friends',
    inviteSubtitle: 'Help your friends switch to fellis.eu',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    mutualFriends: 'mutual friends',
    skip: 'Skip',
    sendInvites: 'Send invitations',
    sendingInvites: 'Sending invitations...',
    inviteLinkTitle: 'Share your invite link',
    inviteLinkDesc: 'Share this link with your friends so you automatically connect on fellis.eu',
    copyLink: 'Copy link',
    linkCopied: 'Copied!',
    invitedBy: 'invites you to fellis.eu',
    doneTitle: 'Welcome to fellis.eu!',
    doneSubtitle: 'Your account is ready. Your new digital home awaits.',
    viewProfile: 'View your profile',
    back: 'Back',
    // Login modal
    loginTitle: 'Log in to fellis.eu',
    loginEmail: 'Email',
    loginPassword: 'Password',
    loginSubmit: 'Log in',
    loginCancel: 'Cancel',
    loginError: 'Invalid email or password',
    loginErrorSocialOnly: 'This account was created via Google or LinkedIn. Please use the corresponding login button.',
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
    forgotBack: 'Back to login',
    forgotEmailSent: 'Check your email for a reset link.',
    mfaTitle: 'Two-factor authentication',
    mfaDesc: 'We sent a 6-digit code to your phone number.',
    mfaCode: 'One-time code',
    mfaSubmit: 'Verify',
    mfaError: 'Invalid or expired code',
    mfaBack: 'Back to login',
    // Register fields (step 4)
    registerTitle: 'Create your fellis.eu account',
    registerName: 'Full name',
    registerEmail: 'Email',
    registerEmailRepeat: 'Repeat email',
    registerEmailMismatch: 'Email addresses do not match',
    registerPassword: 'Choose a password (min. 6 characters)',
    registerPasswordRepeat: 'Repeat password',
    registerPasswordMismatch: 'Passwords do not match',
    registerMathChallenge: (a, b) => `What is ${a} + ${b}?`,
    registerMathError: 'Wrong answer — please try again',
    registerSubmit: 'Create account & go to profile',
    registerError: 'Could not create account',
    registerGdpr: 'I accept the processing of my personal data in accordance with fellis.eu\'s',
    registerGdprLink: 'privacy policy',
    registerGdprRequired: 'You must accept the privacy policy to create an account',
    // Mode selector (step 5)
    modeStepTitle: 'Choose your account type',
    modeStepSubtitle: 'You can always change this in your profile settings.',
    modeCommon: 'Personal',
    modeBusiness: 'Business',
    modeCommonDesc: 'For personal use, family, and community. Friends, posts, and events.',
    modeBusinessDesc: 'For professional networking and company presence. Connections, industry events, and company pages.',
    modeCommonFeatures: ['Friends & community', 'Family-friendly settings', 'Personal events'],
    modeBusinessFeatures: ['Professional connections', 'Company pages', 'Conferences & webinars'],
    modeSelectBtn: 'Get started',
  },
}

export default function Landing({ onEnterPlatform, inviteToken, inviterName, inviterEmail, resetToken }) {
  const [lang, setLang] = useState(() => detectLang())
  const [step, setStep] = useState(4) // Go directly to registration
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false)
  const [inviteLink, setInviteLink] = useState('')

  // Login modal state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(null) // null | 'email' | 'reset' | 'done'
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotToken, setForgotToken] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  // MFA state
  const [mfaUserId, setMfaUserId] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaError, setMfaError] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  // Mode selection (step 5)
  const [pendingEnter, setPendingEnter] = useState(false)

  // Register state (step 4) — pre-fill email from email invite if available
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState(inviterEmail || '')
  const [regPassword, setRegPassword] = useState('')
  const [regPasswordRepeat, setRegPasswordRepeat] = useState('')
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [gdprAccepted, setGdprAccepted] = useState(false)
  // Anti-bot: math challenge
  const [mathChallenge] = useState(() => {
    const a = Math.floor(Math.random() * 9) + 1
    const b = Math.floor(Math.random() * 9) + 1
    return { a, b, answer: a + b }
  })
  const [mathAnswer, setMathAnswer] = useState('')
  // Anti-bot: honeypot field (must remain empty)
  const [honeypot, setHoneypot] = useState('')
  // Refs for smart focus
  const emailRef = useRef(null)
  const nameRef = useRef(null)

  const t = T[lang]

  // Pre-fill email when invite info arrives asynchronously
  useEffect(() => {
    if (inviterEmail && !regEmail) setRegEmail(inviterEmail)
  }, [inviterEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open password reset form when arriving from email reset link
  useEffect(() => {
    if (resetToken) {
      setForgotToken(resetToken)
      setForgotMode('reset')
      setShowLoginModal(true)
    }
  }, [resetToken])

  // Smart focus: when step 4 becomes active, focus email (if empty) or name (if email pre-filled)
  useEffect(() => {
    if (step === 4) {
      setTimeout(() => {
        if (regEmail) nameRef.current?.focus()
        else emailRef.current?.focus()
      }, 50)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeLang = useCallback((code) => {
    localStorage.setItem('fellis_lang', code)
    setLang(code)
  }, [])

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
      } else if (data?.mfa_required && data?.userId) {
        setMfaUserId(data.userId)
        setMfaCode('')
        setMfaError('')
      } else if (data?.error === 'social_login_only') {
        setLoginError(t.loginErrorSocialOnly)
      } else {
        setLoginError(t.loginError)
      }
    } catch {
      setLoginError(t.loginError)
    }
    setLoginLoading(false)
  }, [loginEmail, loginPassword, lang, t, onEnterPlatform])

  // ── MFA handler ──
  const handleMfaVerify = useCallback(async (e) => {
    e.preventDefault()
    if (!mfaCode.trim()) return
    setMfaLoading(true)
    setMfaError('')
    try {
      const data = await apiVerifyMfa(mfaUserId, mfaCode.trim(), lang)
      if (data?.sessionId) {
        setMfaUserId(null)
        setShowLoginModal(false)
        onEnterPlatform(lang)
      } else {
        setMfaError(t.mfaError)
      }
    } catch {
      setMfaError(t.mfaError)
    }
    setMfaLoading(false)
  }, [mfaUserId, mfaCode, lang, t, onEnterPlatform])

  // ── Forgot password handlers ──
  const handleForgotSubmitEmail = useCallback(async (e) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    setForgotError('')
    try {
      const data = await apiForgotPassword(forgotEmail.trim())
      if (data?.ok) {
        // Server sends an email with the reset link — show confirmation
        setForgotMode('email-sent')
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
      setForgotError(PT[lang].passwordMustBeAtLeast6Characters)
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
    // Anti-bot: honeypot must be empty
    if (honeypot) return
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      setRegError(t.registerError)
      return
    }
    if (regPassword.length < 6) {
      setRegError(PT[lang].passwordMustBeAtLeast6Characters)
      return
    }
    if (regPassword !== regPasswordRepeat) {
      setRegError(t.registerPasswordMismatch)
      return
    }
    if (!gdprAccepted) {
      setRegError(t.registerGdprRequired)
      return
    }
    if (parseInt(mathAnswer, 10) !== mathChallenge.answer) {
      setRegError(t.registerMathError)
      return
    }
    setRegLoading(true)
    setRegError('')
    try {
      const regData = await apiRegister(regName.trim(), regEmail.trim(), regPassword.trim(), lang, inviteToken || undefined)
      if (!regData?.sessionId) {
        setRegError(regData?.error || t.registerError)
        setRegLoading(false)
        return
      }
      await apiGiveConsent(['data_processing']).catch(() => {})
      // Flag for onboarding tour (only for new registrations)
      localStorage.setItem('fellis_onboarding', '1')
      if (inviterName) localStorage.setItem('fellis_onboarding_inviter', inviterName)
      // Show mode selector before entering platform
      setPendingEnter(true)
      setStep(5)
    } catch {
      setRegError(t.registerError)
      setRegLoading(false)
    }
  }, [regName, regEmail, regPassword, regPasswordRepeat, honeypot, gdprAccepted, mathAnswer, mathChallenge, lang, t, inviteToken, inviterName])

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-logo">
          <img src="/fellis-logo.jpg" className="nav-logo-icon" alt="" />
          <div className="nav-logo-text">
            <span className="nav-logo-brand">{t.navBrand}</span>
            <span className="nav-logo-tagline">Connect. Share. Discover.</span>
          </div>
        </div>
        <div className="nav-right-group">
          <select className="lang-toggle" value={lang} onChange={e => changeLang(e.target.value)} aria-label="Language">
            {SUPPORTED_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button className="login-btn" onClick={() => { setShowLoginModal(true); setLoginError(''); setLoginEmail(''); setLoginPassword('') }}>
            {t.loginBtn}
          </button>
        </div>
      </nav>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="modal-backdrop">
          <div className="fb-modal">
            <div className="fb-modal-header" style={{ background: '#2D6A4F', position: 'relative' }}>
              <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif" }}>fellis.eu</div>
              <button
                type="button"
                onClick={() => { setShowLoginModal(false); setForgotMode(null); setMfaUserId(null) }}
                style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer', opacity: 0.8, padding: '2px 6px' }}
                aria-label="Close"
              >&#x2715;</button>
            </div>

            {/* Normal login */}
            {!forgotMode && !mfaUserId && (
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
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t.loginPassword}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="fb-input"
                    style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 2, display: 'flex', alignItems: 'center' }}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
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

            {/* MFA: enter SMS code */}
            {mfaUserId && !forgotMode && (
              <form className="fb-modal-form" onSubmit={handleMfaVerify}>
                <h3>{t.mfaTitle}</h3>
                <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>{t.mfaDesc}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder={t.mfaCode}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="fb-input"
                  autoFocus
                />
                {mfaError && <div className="fb-error">{mfaError}</div>}
                <button type="submit" className="fb-login-submit" style={{ background: '#2D6A4F' }} disabled={mfaLoading}>
                  {mfaLoading ? '...' : t.mfaSubmit}
                </button>
                <button type="button" className="fb-forgot" onClick={() => setMfaUserId(null)}>{t.mfaBack}</button>
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

            {/* Forgot password: email sent confirmation */}
            {forgotMode === 'email-sent' && (
              <div className="fb-modal-form" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✉</div>
                <p style={{ color: '#2D6A4F', fontWeight: 600 }}>{t.forgotEmailSent}</p>
                <button type="button" className="fb-forgot" style={{ marginTop: 16 }} onClick={closeForgotPassword}>{t.forgotBack}</button>
              </div>
            )}

            {/* Forgot password: success (after reset via URL) */}
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
      {inviterName && step === 4 && (
        <div className="invite-banner">
          <div className="invite-banner-text">
            <strong>{inviterName}</strong> {t.invitedBy}
          </div>
        </div>
      )}

      {/* Landing — full viewport layout */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 57px)', padding: '12px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>

          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <h1 className="landing-vh-h1" style={{ fontSize: 32, lineHeight: 1.2, fontWeight: 700, margin: '0 0 6px' }}>{t.headline}</h1>
            <p style={{ fontSize: 15, color: '#6B6560', margin: 0, lineHeight: 1.5 }}>{t.subtitle}</p>
          </div>

          {/* Registration form */}
          <form className="register-form" onSubmit={handleRegister} style={{ border: '1px solid #E0DCD7', borderRadius: 14, padding: '18px 22px', maxWidth: 420, width: '100%', boxSizing: 'border-box', margin: 0, gap: 8 }}>
            <h3 className="register-title" style={{ marginBottom: 2 }}>{t.registerTitle}</h3>
            {/* Honeypot — hidden from users, filled only by bots */}
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
              autoComplete="off"
            />
            <input
              ref={emailRef}
              type="email"
              placeholder={t.registerEmail}
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
              className="register-input"
              required
            />
            <input
              ref={nameRef}
              type="text"
              placeholder={t.registerName}
              value={regName}
              onChange={e => setRegName(e.target.value)}
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
            <input
              type="password"
              placeholder={t.registerPasswordRepeat}
              value={regPasswordRepeat}
              onChange={e => setRegPasswordRepeat(e.target.value)}
              className="register-input"
              minLength={6}
              required
            />
            <PasswordStrengthIndicator password={regPassword} lang={lang} />
            {/* Math challenge — simple human verification */}
            <div style={{ marginTop: 2, marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 2 }}>
                {t.registerMathChallenge(mathChallenge.a, mathChallenge.b)}
              </label>
              <input
                type="number"
                placeholder="?"
                value={mathAnswer}
                onChange={e => setMathAnswer(e.target.value)}
                className="register-input"
                required
                style={{ marginTop: 0 }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 4, cursor: 'pointer', fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={gdprAccepted}
                onChange={e => { setGdprAccepted(e.target.checked); if (e.target.checked) setRegError('') }}
                style={{ marginTop: 2, flexShrink: 0, accentColor: '#2D6A4F' }}
              />
              <span>
                {t.registerGdpr}{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#2D6A4F', fontWeight: 600 }}>
                  {t.registerGdprLink}
                </a>
                {' '}(GDPR Art. 6 & 7)
              </span>
            </label>
            {regError && <div className="fb-error">{regError}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={regLoading}>
              {regLoading ? '...' : t.registerSubmit}
            </button>
          </form>

          {/* Trust + services row — bottom */}
          <div style={{ marginTop: 16, width: '100%', maxWidth: 700 }}>
            <div className="trust-row" style={{ marginTop: 0, gap: 28 }}>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 16 }}>🔒</div><span className="trust-label">{t.trustEncrypt}</span></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 16 }}>🇪🇺</div><a href="https://yggdrasilcloud.dk/" target="_blank" rel="noopener noreferrer" className="trust-label trust-link">{t.trustEU}</a></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 16 }}>🛡️</div><span className="trust-label">{t.trustDelete}</span></div>
            </div>
            <div className="landing-services-row" style={{ marginTop: 10 }}>
              <span className="landing-services-label">{t.servicesLabel}:</span>
              {t.services.map(svc => (
                <a key={svc.name} href={svc.url} target="_blank" rel="noopener noreferrer" className="landing-service-chip">
                  <span>{svc.flag}</span>
                  <span className="landing-service-chip-name">{svc.name}</span>
                  <span className="landing-service-chip-role">{svc.role}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Step 5 — Mode selector */}
      {step === 5 && (
        <div className="step-container" style={{ maxWidth: 560 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h2 style={{ margin: '0 0 8px' }}>{t.modeStepTitle}</h2>
            <p style={{ margin: 0, color: '#888', fontSize: 14 }}>{t.modeStepSubtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { key: 'common', label: t.modeCommon, icon: '🏠', desc: t.modeCommonDesc, features: t.modeCommonFeatures, color: '#2D6A4F', bg: '#F0FAF4' },
              { key: 'business', label: t.modeBusiness, icon: '💼', desc: t.modeBusinessDesc, features: t.modeBusinessFeatures, color: '#1877F2', bg: '#EBF4FF' },
            ].map(({ key, label, icon, desc, features, color, bg }) => (
              <button
                key={key}
                onClick={() => {
                  localStorage.setItem('fellis_mode', key)
                  onEnterPlatform(lang)
                }}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 10, padding: 24, borderRadius: 16, border: `2px solid ${color}`,
                  background: bg, cursor: 'pointer', textAlign: 'left', transition: 'transform 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'none'}
              >
                <span style={{ fontSize: 36 }}>{icon}</span>
                <strong style={{ fontSize: 18, color }}>{label}</strong>
                <span style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>{desc}</span>
                <ul style={{ margin: '4px 0 0', padding: '0 0 0 16px', fontSize: 12, color: '#666', lineHeight: 1.8 }}>
                  {features.map(f => <li key={f}>{f}</li>)}
                </ul>
                <span style={{ marginTop: 8, alignSelf: 'stretch', padding: '10px', borderRadius: 10, background: color, color: '#fff', fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
                  {t.modeSelectBtn} →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PasswordStrengthIndicator({ password, lang }) {
  const [policy, setPolicy] = useState(null)
  useEffect(() => {
    fetch('/api/auth/password-policy').then(r => r.ok ? r.json() : null).then(p => { if (p) setPolicy(p) }).catch(() => {})
  }, [])

  if (!password) return null

  const minLen = policy?.min_length || 6
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
    ? (PT[lang].weak)
    : ratio < 0.75
    ? (PT[lang].fair)
    : (PT[lang].strong)

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
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

