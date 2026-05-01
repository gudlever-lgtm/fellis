import { useState, useCallback, useEffect, useRef } from 'react'
import { UI_LANGS, PT } from './data.js'
import { apiLogin, apiRegister, apiForgotPassword, apiResetPassword, apiVerifyMfa, apiGiveConsent } from './api.js'
import UserTypeSelector from './UserTypeSelector.jsx'
import { useTranslation } from './i18n/useTranslation.js'
import { loadTranslation } from './i18n/loader.js'

export default function Landing({ onEnterPlatform, inviteToken, inviterName, inviterEmail, resetToken }) {
  const { lang, setLanguage } = useTranslation('common')
  const [t, setT] = useState({})
  useEffect(() => { loadTranslation(lang, 'landing').then(setT) }, [lang])
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
  const [forgotFbNote, setForgotFbNote] = useState(false)
  // MFA state
  const [mfaUserId, setMfaUserId] = useState(null)
  const [mfaMethod, setMfaMethod] = useState('sms')
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
    setLanguage(code)
  }, [setLanguage])

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
        setMfaMethod(data.method || 'sms')
        setMfaCode('')
        setMfaError('')
      } else if (data?.error === 'social_login_only') {
        setLoginError(t.loginErrorSocialOnly)
      } else if (data?.status === 429) {
        setLoginError(t.loginErrorRateLimit)
      } else if (data === null || data?.status === 503 || data?.status >= 500) {
        setLoginError(t.loginErrorUnavailable)
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
      const data = await apiForgotPassword(forgotEmail.trim(), lang)
      if (data?.ok) {
        // Server sends an email with the reset link — show confirmation
        setForgotMode('email-sent')
      } else if (data?.status === 429) {
        setForgotError(t.forgotRateLimit)
      } else if (data?.error === 'email_send_failed') {
        setForgotError(t.forgotEmailFailed)
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
      const data = await apiResetPassword(forgotToken, forgotNewPw.trim(), lang)
      if (data?.sessionId) {
        setForgotMode('done')
        setTimeout(() => {
          setShowLoginModal(false)
          setForgotMode(null)
          onEnterPlatform(lang)
        }, 1500)
      } else if (data?.error === 'Invalid or expired reset token') {
        setForgotError(t.forgotTokenInvalid)
        setForgotMode('email')
        setForgotToken('')
      } else {
        setForgotError(data?.error || t.forgotError)
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
        const serverErr = regData?.error || ''
        let displayErr = t.registerError
        if (serverErr.toLowerCase().includes('already exists') || serverErr.toLowerCase().includes('duplicate')) {
          displayErr = t.registerErrorDuplicate
        } else if (serverErr.toLowerCase().includes('too many') || serverErr.toLowerCase().includes('rate')) {
          displayErr = t.registerErrorRateLimit
        } else if (serverErr && serverErr !== 'registration_failed') {
          // Password policy or other server-side message — show as-is (already in user's lang)
          displayErr = serverErr
        }
        setRegError(displayErr)
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
    <div className="app" style={{ minHeight: '100dvh', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
            {UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <a
            href="/for-business"
            style={{ fontSize: 14, color: '#2D6A4F', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            {PT[lang]?.forBusinessNavLink || PT.en.forBusinessNavLink}
          </a>
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
                  autoComplete="email"
                  autoFocus
                />
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t.loginPassword}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="fb-input"
                    autoComplete="current-password"
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
                <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>{mfaMethod === 'email' ? t.mfaDescEmail : t.mfaDesc}</p>
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
                  autoComplete="email"
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
                  autoComplete="new-password"
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '8px 16px', boxSizing: 'border-box', overflowX: 'hidden' }}>

          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, fontWeight: 700, margin: '0 0 4px' }}>{t.headline}</h1>
            <p style={{ fontSize: 14, color: '#6B6560', margin: 0, lineHeight: 1.4 }}>{t.subtitle}</p>
            <p style={{ fontSize: 13, color: '#888', margin: '6px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>{PT[lang]?.about_fellis_name_short || PT.en.about_fellis_name_short}</p>
          </div>

          {/* Two-card row: manifesto + registration */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'stretch', width: '100%', maxWidth: 860, flexWrap: 'wrap', justifyContent: 'center' }}>

          {/* Manifesto card */}
          <div style={{ flex: '1 1 280px', maxWidth: 380, border: '1px solid #C8DDD2', borderRadius: 14, padding: '28px 28px', boxSizing: 'border-box', background: '#F0FAF4', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
            <p style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.4, margin: 0, color: '#1a5c36' }}>{t.hero_intro}</p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: '#4a6b5c' }}>{t.manifestoLine3}</p>
            <div style={{ borderTop: '1px solid #C8DDD2', marginTop: 2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(t.manifestoWhys || []).map(({ icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.6, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.6, color: '#3a5a4a' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Registration form */}
          <form className="register-form" onSubmit={handleRegister} style={{ flex: '1 1 280px', border: '1px solid #E0DCD7', borderRadius: 14, padding: '16px 22px', maxWidth: 420, width: '100%', boxSizing: 'border-box', margin: 0, gap: 6 }}>
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
              autoComplete="email"
              required
            />
            <input
              ref={nameRef}
              type="text"
              placeholder={t.registerName}
              value={regName}
              onChange={e => setRegName(e.target.value)}
              className="register-input"
              autoComplete="name"
              required
            />
            <input
              type="password"
              placeholder={t.registerPassword}
              value={regPassword}
              onChange={e => setRegPassword(e.target.value)}
              className="register-input"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <input
              type="password"
              placeholder={t.registerPasswordRepeat}
              value={regPasswordRepeat}
              onChange={e => setRegPasswordRepeat(e.target.value)}
              className="register-input"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <PasswordStrengthIndicator password={regPassword} lang={lang} />
            {/* Math challenge — simple human verification */}
            <div style={{ marginTop: 2, marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 2 }}>
                {(t.registerMathChallenge || '').replace('{a}', mathChallenge.a).replace('{b}', mathChallenge.b)}
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
            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px 32px' }} disabled={regLoading}>
              {regLoading ? '...' : t.registerSubmit}
            </button>
          </form>
          </div>{/* end two-card row */}

          {/* Trust + services row — bottom */}
          <div style={{ marginTop: 12, width: '100%', maxWidth: 860, flexShrink: 0 }}>
            <div className="trust-row" style={{ marginTop: 0, gap: 24 }}>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🔒</div><span className="trust-label">{t.trustEncrypt}</span></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🇪🇺</div><a href="https://yggdrasilcloud.dk/" target="_blank" rel="noopener noreferrer" className="trust-label trust-link">{t.trustEU}</a></div>
              <div className="trust-item"><div className="trust-icon" style={{ fontSize: 15 }}>🛡️</div><span className="trust-label">{t.trustDelete}</span></div>
            </div>
            <div className="landing-services-row" style={{ marginTop: 6 }}>
              <span className="landing-services-label">{t.servicesLabel}:</span>
              {(t.services || []).map(svc => (
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
      {/* Step 5 — User type selector */}
      {step === 5 && (
        <div className="step-container" style={{ maxWidth: 900 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h2 style={{ margin: '0 0 8px' }}>{t.modeStepTitle}</h2>
            <p style={{ margin: 0, color: '#888', fontSize: 14 }}>{t.modeStepSubtitle}</p>
          </div>
          <UserTypeSelector
            lang={lang}
            onComplete={(mode) => {
              localStorage.setItem('fellis_mode', mode)
              onEnterPlatform(lang)
            }}
          />
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

