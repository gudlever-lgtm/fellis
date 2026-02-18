import { useState, useCallback, useEffect } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import { apiCheckSession, apiLogout, apiGiveConsent, apiGetInviteInfo } from './api.js'
import './App.css'

// GDPR Consent Dialog translations
const CONSENT_T = {
  da: {
    title: 'Samtykke til databehandling',
    intro: 'Før vi importerer dine Facebook-data, har vi brug for dit udtrykkelige samtykke i henhold til EU\'s GDPR-forordning.',
    whatWeImport: 'Hvad vi importerer:',
    item1: 'Dit navn og e-mail fra din Facebook-profil',
    item2: 'Dine opslag og fotos (kun med dit samtykke)',
    item3: 'Din venneliste (kun venner der allerede er på fellis.eu)',
    howWeProtect: 'Sådan beskytter vi dine data:',
    protect1: 'Alle data lagres krypteret i EU',
    protect2: 'Din Facebook-adgangstoken krypteres med AES-256',
    protect3: 'Du kan til enhver tid slette dine importerede data',
    protect4: 'Du kan eksportere alle dine data (GDPR Art. 20)',
    consentLabel: 'Jeg giver mit udtrykkelige samtykke til, at fellis.eu importerer og behandler mine Facebook-data som beskrevet ovenfor.',
    accept: 'Giv samtykke og importer',
    decline: 'Nej tak, fortsæt uden import',
    importing: 'Importerer...',
  },
  en: {
    title: 'Data Processing Consent',
    intro: 'Before we import your Facebook data, we need your explicit consent under the EU GDPR regulation.',
    whatWeImport: 'What we import:',
    item1: 'Your name and email from your Facebook profile',
    item2: 'Your posts and photos (only with your consent)',
    item3: 'Your friends list (only friends already on fellis.eu)',
    howWeProtect: 'How we protect your data:',
    protect1: 'All data stored encrypted in the EU',
    protect2: 'Your Facebook access token is encrypted with AES-256',
    protect3: 'You can delete your imported data at any time',
    protect4: 'You can export all your data (GDPR Art. 20)',
    consentLabel: 'I give my explicit consent for fellis.eu to import and process my Facebook data as described above.',
    accept: 'Give consent & import',
    decline: 'No thanks, continue without import',
    importing: 'Importing...',
  },
}

function ConsentDialog({ lang, onConsent, onDecline }) {
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const t = CONSENT_T[lang] || CONSENT_T.da

  const handleAccept = async () => {
    if (!checked) return
    setLoading(true)
    try {
      await onConsent()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="fb-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="fb-modal-header" style={{ background: '#2D6A4F' }}>
          <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif" }}>fellis.eu — GDPR</div>
        </div>
        <div className="fb-modal-form" style={{ textAlign: 'left' }}>
          <h3 style={{ marginBottom: 8 }}>{t.title}</h3>
          <p style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>{t.intro}</p>

          <p style={{ fontWeight: 600, marginBottom: 4 }}>{t.whatWeImport}</p>
          <ul style={{ fontSize: 13, color: '#333', marginBottom: 12, paddingLeft: 20 }}>
            <li>{t.item1}</li>
            <li>{t.item2}</li>
            <li>{t.item3}</li>
          </ul>

          <p style={{ fontWeight: 600, marginBottom: 4 }}>{t.howWeProtect}</p>
          <ul style={{ fontSize: 13, color: '#333', marginBottom: 16, paddingLeft: 20 }}>
            <li>{t.protect1}</li>
            <li>{t.protect2}</li>
            <li>{t.protect3}</li>
            <li>{t.protect4}</li>
          </ul>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{t.consentLabel}</span>
          </label>

          <button
            className="fb-login-submit"
            style={{ background: checked ? '#2D6A4F' : '#ccc', width: '100%', marginBottom: 8 }}
            disabled={!checked || loading}
            onClick={handleAccept}
          >
            {loading ? t.importing : t.accept}
          </button>
          <button
            className="fb-forgot"
            style={{ width: '100%', textAlign: 'center' }}
            onClick={onDecline}
          >
            {t.decline}
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [view, setView] = useState(() => {
    return localStorage.getItem('fellis_logged_in') ? 'platform' : 'landing'
  })
  const [lang, setLang] = useState(() => {
    return localStorage.getItem('fellis_lang') || 'da'
  })
  // GDPR: Show consent dialog after Facebook OAuth before importing data
  const [showConsent, setShowConsent] = useState(false)
  const [inviteToken, setInviteToken] = useState(null)
  const [inviterName, setInviterName] = useState(null)

  // On mount: check for Facebook OAuth callback, invite links, or validate existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fbSession = params.get('fb_session')
    const fbLang = params.get('fb_lang')
    const fbNeedsConsent = params.get('fb_needs_consent')

    if (fbSession) {
      // Returning from Facebook OAuth — store session
      localStorage.setItem('fellis_session_id', fbSession)
      localStorage.setItem('fellis_logged_in', 'true')
      if (fbLang) {
        localStorage.setItem('fellis_lang', fbLang)
        setLang(fbLang)
      }
      // GDPR: Show consent dialog before importing data
      if (fbNeedsConsent === 'true') {
        setShowConsent(true)
      }
      setView('platform')
      // Clean up URL params
      window.history.replaceState({}, '', window.location.pathname)
      return
    }

    // Check for invite token in URL
    const invite = params.get('invite')
    if (invite) {
      setInviteToken(invite)
      localStorage.setItem('fellis_invite_token', invite)
      apiGetInviteInfo(invite).then(data => {
        if (data?.inviter?.name) {
          setInviterName(data.inviter.name)
        }
      })
      window.history.replaceState({}, '', window.location.pathname)
    } else {
      const storedInvite = localStorage.getItem('fellis_invite_token')
      if (storedInvite) setInviteToken(storedInvite)
    }

    const fbError = params.get('fb_error')
    if (fbError) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    apiCheckSession().then(data => {
      if (data) {
        setView('platform')
        if (data.lang) setLang(data.lang)
        localStorage.setItem('fellis_logged_in', 'true')
      } else {
        // Session expired or invalid — clear and go to landing
        localStorage.removeItem('fellis_logged_in')
        localStorage.removeItem('fellis_session_id')
        setView('landing')
      }
    })
  }, [])

  const handleEnterPlatform = useCallback((selectedLang) => {
    setLang(selectedLang)
    setView('platform')
    localStorage.setItem('fellis_logged_in', 'true')
    localStorage.setItem('fellis_lang', selectedLang)
    localStorage.removeItem('fellis_invite_token')
    setInviteToken(null)
    setInviterName(null)
  }, [])

  const handleLogout = useCallback(() => {
    setView('landing')
    localStorage.removeItem('fellis_logged_in')
    localStorage.removeItem('fellis_lang')
    localStorage.removeItem('fellis_session_id')
    apiLogout().catch(() => {})
  }, [])

  // GDPR: Handle consent acceptance — triggers Facebook data import
  const handleConsentAccept = useCallback(async () => {
    await apiGiveConsent(['facebook_import', 'data_processing'])
    setShowConsent(false)
  }, [])

  // GDPR: Handle consent decline — user continues without Facebook data import
  const handleConsentDecline = useCallback(() => {
    setShowConsent(false)
  }, [])

  if (view === 'platform') {
    return (
      <>
        {showConsent && (
          <ConsentDialog
            lang={lang}
            onConsent={handleConsentAccept}
            onDecline={handleConsentDecline}
          />
        )}
        <Platform lang={lang} onLogout={handleLogout} />
      </>
    )
  }

  return <Landing onEnterPlatform={handleEnterPlatform} inviteToken={inviteToken} inviterName={inviterName} />
}

export default App
