import { useState, useCallback, useEffect } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import { apiCheckSession, apiLogout, apiGiveConsent, apiGetInviteInfo } from './api.js'
import './App.css'

// ── Public Privacy Policy Page (/privacy) ──
// Accessible without login — used as the Facebook App privacy policy URL
function PublicPrivacyPage() {
  const [lang, setLang] = useState(() => {
    const stored = localStorage.getItem('fellis_lang')
    if (stored) return stored
    return navigator.language?.startsWith('da') ? 'da' : 'en'
  })
  const da = lang === 'da'

  const s = {
    page: { fontFamily: "'DM Sans', sans-serif", maxWidth: 720, margin: '0 auto', padding: '32px 20px 64px', color: '#2D3436' },
    nav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
    brand: { fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: '#2D6A4F', textDecoration: 'none' },
    langBtn: { background: 'none', border: '1px solid #ccc', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 },
    h1: { fontSize: 28, fontWeight: 700, marginBottom: 8 },
    sub: { fontSize: 15, color: '#666', marginBottom: 36 },
    section: { background: '#fff', border: '1px solid #E8E4DF', borderRadius: 12, padding: 24, marginBottom: 20 },
    h2: { fontSize: 17, fontWeight: 700, marginBottom: 10, color: '#2D3436' },
    p: { fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 8 },
    ul: { fontSize: 14, color: '#555', lineHeight: 1.8, paddingLeft: 22, marginTop: 8 },
    email: { color: '#2D6A4F', fontWeight: 600 },
    footer: { textAlign: 'center', fontSize: 13, color: '#999', marginTop: 40 },
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <a href="/" style={s.brand}>fellis.eu</a>
        <button style={s.langBtn} onClick={() => setLang(da ? 'en' : 'da')}>{da ? 'EN' : 'DA'}</button>
      </nav>

      <h1 style={s.h1}>{da ? 'Privatlivspolitik' : 'Privacy Policy'}</h1>
      <p style={s.sub}>{da ? 'Sidst opdateret: februar 2025' : 'Last updated: February 2025'}</p>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Om fellis.eu' : 'About fellis.eu'}</h2>
        <p style={s.p}>{da
          ? 'fellis.eu er en dansk social platform hostet i EU. Vi er forpligtet til at beskytte dine persondata i henhold til EU\'s General Data Protection Regulation (GDPR). Vi indsamler kun de data, der er nødvendige for at levere vores tjeneste, og vi sælger aldrig dine data til tredjeparter eller bruger dem til reklamer.'
          : 'fellis.eu is a Danish social platform hosted in the EU. We are committed to protecting your personal data under the EU General Data Protection Regulation (GDPR). We only collect data necessary to provide our service and never sell your data to third parties or use it for advertising.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Hvad vi indsamler' : 'What we collect'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>Kontooplysninger: navn, e-mail, profilbillede</li>
            <li>Indhold du opretter: opslag, kommentarer, beskeder</li>
            <li>Login via Facebook: navn og e-mail fra din offentlige profil (kun med dit samtykke)</li>
            <li>Tekniske data: session-ID (opbevares i din browser)</li>
          </> : <>
            <li>Account information: name, email, profile picture</li>
            <li>Content you create: posts, comments, messages</li>
            <li>Facebook login: name and email from your public profile (only with your consent)</li>
            <li>Technical data: session ID (stored in your browser)</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Hvorfor vi indsamler det' : 'Why we collect it'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>For at levere platformens funktionalitet (GDPR Art. 6(1)(b) — kontraktopfyldelse)</li>
            <li>For at administrere din konto og autentificere dig</li>
            <li>Vi sælger ALDRIG dine data eller bruger dem til reklamer</li>
          </> : <>
            <li>To provide platform functionality (GDPR Art. 6(1)(b) — contract performance)</li>
            <li>To manage your account and authenticate you</li>
            <li>We NEVER sell your data or use it for advertising</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Facebook-login' : 'Facebook login'}</h2>
        <p style={s.p}>{da
          ? 'Når du vælger at logge ind med Facebook, modtager vi dit navn og din e-mailadresse fra din offentlige Facebook-profil. Vi gemmer ikke dine Facebook-data ud over hvad der er nødvendigt for at oprette og administrere din konto. Vi anmoder kun om de tilladelser, der er nødvendige (public_profile og email).'
          : 'When you choose to log in with Facebook, we receive your name and email address from your public Facebook profile. We do not store your Facebook data beyond what is necessary to create and manage your account. We only request permissions that are necessary (public_profile and email).'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Opbevaring og sikkerhed' : 'Storage and security'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>Alle data opbevares på EU-servere i Danmark (Yggdrasil Cloud)</li>
            <li>Sessioner udløber automatisk efter 30 dage</li>
            <li>Du kan til enhver tid slette din konto og alle tilknyttede data</li>
          </> : <>
            <li>All data stored on EU servers in Denmark (Yggdrasil Cloud)</li>
            <li>Sessions expire automatically after 30 days</li>
            <li>You can delete your account and all associated data at any time</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Dine rettigheder (GDPR)' : 'Your rights (GDPR)'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>Ret til indsigt (Art. 15) — du kan se alle dine data</li>
            <li>Ret til berigtigelse (Art. 16) — du kan rette forkerte oplysninger</li>
            <li>Ret til sletning (Art. 17) — du kan slette din konto og alle data</li>
            <li>Ret til dataportabilitet (Art. 20) — du kan downloade dine data i JSON-format</li>
          </> : <>
            <li>Right of access (Art. 15) — you can view all your data</li>
            <li>Right to rectification (Art. 16) — you can correct inaccurate data</li>
            <li>Right to erasure (Art. 17) — you can delete your account and all data</li>
            <li>Right to data portability (Art. 20) — you can download your data in JSON format</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Kontakt' : 'Contact'}</h2>
        <p style={s.p}>{da
          ? 'Har du spørgsmål om denne privatlivspolitik eller ønsker du at udøve dine rettigheder, kan du kontakte os på:'
          : 'If you have questions about this privacy policy or wish to exercise your rights, contact us at:'
        }</p>
        <p style={{ ...s.p, ...s.email }}>privacy@fellis.eu</p>
        <p style={s.p}>{da
          ? 'Du kan også klage til Datatilsynet (www.datatilsynet.dk) hvis du mener, dine rettigheder er krænket.'
          : 'You can also file a complaint with the Danish Data Protection Agency (www.datatilsynet.dk) if you believe your rights have been violated.'
        }</p>
      </div>

      <div style={s.footer}>
        <p>fellis.eu — {da ? 'Dansk social platform hostet i EU' : 'Danish social platform hosted in the EU'}</p>
        <a href="/" style={{ color: '#2D6A4F', textDecoration: 'none' }}>{da ? '← Gå til fellis.eu' : '← Go to fellis.eu'}</a>
      </div>
    </div>
  )
}

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
  const [initialPostId, setInitialPostId] = useState(null)

  // On mount: check for Facebook OAuth callback, invite links, or validate existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const postId = params.get('post')
    if (postId) {
      setInitialPostId(parseInt(postId))
      window.history.replaceState({}, '', window.location.pathname)
    }
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
        <Platform lang={lang} onLogout={handleLogout} initialPostId={initialPostId} />
      </>
    )
  }

  return <Landing onEnterPlatform={handleEnterPlatform} inviteToken={inviteToken} inviterName={inviterName} />
}

function AppRoot() {
  if (window.location.pathname === '/privacy') return <PublicPrivacyPage />
  return <App />
}

export default AppRoot
