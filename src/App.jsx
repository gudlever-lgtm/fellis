import { useState, useCallback, useEffect } from 'react'
import Landing from './Landing.jsx'
import Platform from './Platform.jsx'
import PublicBlogPage from './BlogPage.jsx'
import ForBusiness from './ForBusiness.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
import { apiCheckSession, apiLogout, apiGiveConsent, apiGetConsentStatus, apiGetInviteInfo, apiTrackVisit, apiGetCsrfToken, apiGetUserByHandle } from './api.js'
import { UI_LANGS, detectLangFromIP, getTranslations } from './data.js'
import { USER_LS_KEY } from './hooks/useEasterEggs.js'
import { useLanguage } from './i18n/LanguageContext.jsx'
import './App.css'

// ── Public Privacy Policy Page (/privacy) ──
function PublicPrivacyPage() {
  const { lang, setLanguage: setLang } = useLanguage()
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
        <select style={s.langBtn} value={lang} onChange={e => setLang(e.target.value)} aria-label="Language">{UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
      </nav>

      <h1 style={s.h1}>{da ? 'Privatlivspolitik' : 'Privacy Policy'}</h1>
      <p style={s.sub}>{da ? 'Sidst opdateret: april 2026' : 'Last updated: April 2026'}</p>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Om fellis.eu' : 'About fellis.eu'}</h2>
        <p style={s.p}>{da
          ? 'fellis.eu er en dansk social platform hostet i EU. Vi er forpligtet til at beskytte dine persondata i henhold til EU\'s General Data Protection Regulation (GDPR). Vi indsamler kun de data, der er nødvendige for at levere vores tjeneste, og vi sælger aldrig dine data til tredjeparter. Vi viser annoncer fra erhvervsbrugere registreret på platformen og bruger din aktivitet til at vise relevante annoncer — du kan til enhver tid opgradere til en reklamefri oplevelse.'
          : 'fellis.eu is a Danish social platform hosted in the EU. We are committed to protecting your personal data under the EU General Data Protection Regulation (GDPR). We only collect data necessary to provide our service and never sell your data to third parties. We show ads from businesses registered on our platform and use your activity to show relevant ads — you can upgrade to an ad-free experience at any time.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Hvad vi indsamler' : 'What we collect'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>Kontooplysninger: navn, e-mail, profilbillede</li>
            <li>Indhold du opretter: opslag, kommentarer, beskeder</li>
            <li>Tekniske data: session-ID (opbevares i din browser)</li>
            <li>Interessedata: din aktivitet på platformen (likes, kommentarer, visninger) bruges til at opbygge en interesseprofil</li>
            <li>Annonceeksponeringsdata: hvilke annoncer du er blevet vist (registreres internt til frekvensbegrænsning og fakturering)</li>
          </> : <>
            <li>Account information: name, email, profile picture</li>
            <li>Content you create: posts, comments, messages</li>
            <li>Technical data: session ID (stored in your browser)</li>
            <li>Interest data: your in-platform activity (likes, comments, views) used to build an interest profile</li>
            <li>Ad exposure data: which ads you have been shown (recorded internally for frequency capping and billing)</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Hvorfor vi indsamler det' : 'Why we collect it'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>For at levere platformens funktionalitet (GDPR Art. 6(1)(b) — kontraktopfyldelse)</li>
            <li>For at administrere din konto og autentificere dig</li>
            <li>For at vise relevante annoncer fra erhvervsbrugere på platformen (GDPR Art. 6(1)(f) — legitim interesse i at finansiere platformen)</li>
            <li>Vi sælger aldrig dine data til tredjeparter</li>
          </> : <>
            <li>To provide platform functionality (GDPR Art. 6(1)(b) — contract performance)</li>
            <li>To manage your account and authenticate you</li>
            <li>To show relevant ads from business users on the platform (GDPR Art. 6(1)(f) — legitimate interest in funding the platform)</li>
            <li>We never sell your data to third parties</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Reklamer og interesseprofil' : 'Advertising and interest profile'}</h2>
        <ul style={s.ul}>
          {da ? <>
            <li>Vi viser annoncer fra erhvervsbrugere registreret på fellis.eu — vi sælger ikke annoncevisninger til eksterne annoncenetværk.</li>
            <li>Din aktivitet på platformen (likes, kommentarer, visninger og negative interaktioner som at scrolle forbi eller blokere) genererer interessesignaler, der bruges til at opbygge en interesseprofil. Annoncører kan målrette annoncer mod bestemte interessekategorier.</li>
            <li>Vi registrerer internt, hvilke annoncer du er blevet vist, til frekvensbegrænsning og fakturering. Annoncører ser kun samlede statistikker (rækkevidde, visninger, klik) — aldrig din individuelle identitet.</li>
            <li>Du kan købe en reklamefri oplevelse via Indstillinger → Fakturering.</li>
          </> : <>
            <li>We show ads from business users registered on fellis.eu — we do not sell ad inventory to external advertising networks.</li>
            <li>Your in-platform activity (likes, comments, views, and negative interactions such as scrolling past or blocking) generates interest signals used to build an interest profile. Advertisers can target ads to specific interest categories.</li>
            <li>We record internally which ads you have been shown, for frequency capping and billing purposes. Advertisers only see aggregate statistics (reach, impressions, clicks) — never your individual identity.</li>
            <li>You can purchase an ad-free experience via Settings → Billing.</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'AI-assistance (Mistral AI)' : 'AI assistance (Mistral AI)'}</h2>
        <p style={s.p}>{da
          ? 'Når du bruger CV- eller ansøgningsgeneratoren, kan din profilering (navn, erhvervserfaring, uddannelse, sprog og færdigheder) sendes til Mistral AI (mistral.ai), en EU-baseret sprogmodel hostet i Frankrig. Denne funktion kræver et API-nøgle sat af platformadministratoren og er valgfri — den falder automatisk tilbage til skabelon-generering, hvis nøglen ikke er konfigureret. Mistral AI behandler dataene udelukkende for at generere tekst og gemmer dem ikke efter svaret er leveret.'
          : 'When you use the CV or cover letter generator, your profile data (name, work experience, education, languages and skills) may be sent to Mistral AI (mistral.ai), an EU-based language model hosted in France. This feature requires an API key set by the platform administrator and is optional — it falls back automatically to template generation if no key is configured. Mistral AI processes the data solely to generate text and does not retain it after the response is delivered.'
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

// ── Public Terms of Service Page (/terms) ──
// Accessible without login — used as the terms of service URL
function PublicTermsPage() {
  const { lang, setLanguage: setLang } = useLanguage()
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
        <select style={s.langBtn} value={lang} onChange={e => setLang(e.target.value)} aria-label="Language">{UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
      </nav>

      <h1 style={s.h1}>{da ? 'Servicevilkår' : 'Terms of Service'}</h1>
      <p style={s.sub}>{da ? 'Sidst opdateret: marts 2026' : 'Last updated: March 2026'}</p>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Om fellis.eu' : 'About fellis.eu'}</h2>
        <p style={s.p}>{da
          ? 'fellis.eu er en dansk social platform hostet i EU. Ved at oprette en konto eller bruge platformen accepterer du disse servicevilkår. Platformen drives af fellis.eu og er målrettet brugere i Danmark og EU.'
          : 'fellis.eu is a Danish social platform hosted in the EU. By creating an account or using the platform, you agree to these Terms of Service. The platform is operated by fellis.eu and is intended for users in Denmark and the EU.'
        }</p>
        <p style={s.p}>{da
          ? 'Platformen drives af gnf.dk — CVR: 16143103.'
          : 'The platform is operated by gnf.dk — CVR: 16143103.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Brug af platformen' : 'Use of the platform'}</h2>
        <p style={s.p}>{da ? 'Du må bruge fellis.eu til at:' : 'You may use fellis.eu to:'}</p>
        <ul style={s.ul}>
          {da ? <>
            <li>Oprette og administrere en personlig eller erhvervsmæssig profil</li>
            <li>Dele opslag, fotos og indhold med venner og følgere</li>
            <li>Kommunikere med andre brugere via beskeder</li>
            <li>Opdage begivenheder og markedspladsannoncer</li>
          </> : <>
            <li>Create and manage a personal or business profile</li>
            <li>Share posts, photos and content with friends and followers</li>
            <li>Communicate with other users via messages</li>
            <li>Discover events and marketplace listings</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Forbudt adfærd' : 'Prohibited conduct'}</h2>
        <p style={s.p}>{da ? 'Det er ikke tilladt at:' : 'You may not:'}</p>
        <ul style={s.ul}>
          {da ? <>
            <li>Dele ulovligt, stødende eller skadeligt indhold</li>
            <li>Chikanere, true eller mobbe andre brugere</li>
            <li>Oprette falske profiler eller udgive dig for at være andre</li>
            <li>Sprede spam, malware eller phishing-indhold</li>
            <li>Forsøge at tilgå andre brugeres konti eller platformens systemer uden tilladelse</li>
          </> : <>
            <li>Share illegal, offensive or harmful content</li>
            <li>Harass, threaten or bully other users</li>
            <li>Create fake profiles or impersonate others</li>
            <li>Spread spam, malware or phishing content</li>
            <li>Attempt to access other users&apos; accounts or platform systems without authorisation</li>
          </>}
        </ul>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Dit indhold' : 'Your content'}</h2>
        <p style={s.p}>{da
          ? 'Du bevarer ejerskabet af det indhold, du deler på fellis.eu. Ved at uploade indhold giver du fellis.eu en ikke-eksklusiv, vederlagsfri licens til at vise og distribuere det til andre brugere på platformen. Vi sælger eller deler ikke dit indhold med tredjeparter til kommercielle formål.'
          : 'You retain ownership of content you share on fellis.eu. By uploading content you grant fellis.eu a non-exclusive, royalty-free licence to display and distribute it to other users on the platform. We do not sell or share your content with third parties for commercial purposes.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Kontosuspension og sletning' : 'Account suspension and deletion'}</h2>
        <p style={s.p}>{da
          ? 'Vi forbeholder os retten til at suspendere eller slette konti, der overtræder disse vilkår. Du kan selv slette din konto og alle tilknyttede data til enhver tid via profilindstillingerne.'
          : 'We reserve the right to suspend or delete accounts that violate these Terms. You can delete your own account and all associated data at any time via profile settings.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Ansvarsfraskrivelse' : 'Disclaimer'}</h2>
        <p style={s.p}>{da
          ? 'fellis.eu leveres "som det er". Vi bestræber os på at holde platformen tilgængelig og sikker, men garanterer ikke uafbrudt drift. Vi er ikke ansvarlige for tab opstået som følge af brug af platformen eller indhold delt af andre brugere.'
          : 'fellis.eu is provided "as is". We strive to keep the platform available and secure but do not guarantee uninterrupted operation. We are not liable for losses arising from use of the platform or content shared by other users.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Lovvalg' : 'Governing law'}</h2>
        <p style={s.p}>{da
          ? 'Disse vilkår er underlagt dansk ret. Eventuelle tvister afgøres ved de danske domstole.'
          : 'These Terms are governed by Danish law. Any disputes shall be resolved by the Danish courts.'
        }</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>{da ? 'Kontakt' : 'Contact'}</h2>
        <p style={s.p}>{da
          ? 'Har du spørgsmål om disse servicevilkår, kan du kontakte os på:'
          : 'If you have questions about these Terms of Service, contact us at:'
        }</p>
        <p style={{ ...s.p, ...s.email }}>privacy@fellis.eu</p>
      </div>

      <div style={s.footer}>
        <p>fellis.eu — {da ? 'Dansk social platform hostet i EU' : 'Danish social platform hosted in the EU'}</p>
        <a href="/" style={{ color: '#2D6A4F', textDecoration: 'none' }}>{da ? '← Gå til fellis.eu' : '← Go to fellis.eu'}</a>
      </div>
    </div>
  )
}

// GDPR Consent Dialog translations
// Shown to existing users who haven't given data_processing consent yet
function GeneralConsentDialog({ lang, onAccept }) {
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const da = lang === 'da'
  return (
    <div className="modal-backdrop">
      <div className="fb-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="fb-modal-header" style={{ background: '#2D6A4F' }}>
          <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif" }}>fellis.eu — GDPR</div>
        </div>
        <div className="fb-modal-form" style={{ textAlign: 'left' }}>
          <h3 style={{ marginBottom: 8 }}>{da ? 'Samtykke til databehandling' : 'Data Processing Consent'}</h3>
          <p style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>
            {da
              ? 'fellis.eu behandler dine persondata for at levere platformens funktioner. Vi opbevarer dine data sikkert på EU-servere i Danmark og deler dem aldrig med tredjeparter til reklameformål.'
              : 'fellis.eu processes your personal data to deliver the platform\'s features. We store your data securely on EU servers in Denmark and never share it with third parties for advertising purposes.'}
          </p>
          <ul style={{ fontSize: 13, color: '#333', marginBottom: 16, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>{da ? 'Kontooplysninger: navn, e-mail, profilbillede' : 'Account info: name, email, profile picture'}</li>
            <li>{da ? 'Indhold du opretter: opslag, kommentarer, beskeder' : 'Content you create: posts, comments, messages'}</li>
            <li>{da ? 'Du kan til enhver tid slette din konto og alle data' : 'You can delete your account and all data at any time'}</li>
            <li>{da ? 'Du kan eksportere alle dine data (GDPR Art. 20)' : 'You can export all your data (GDPR Art. 20)'}</li>
          </ul>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2, accentColor: '#2D6A4F' }} />
            <span>
              {da ? 'Jeg accepterer behandling af mine persondata som beskrevet ovenfor og i ' : 'I accept the processing of my personal data as described above and in the '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#2D6A4F', fontWeight: 600 }}>
                {da ? 'privatlivspolitikken' : 'privacy policy'}
              </a>
              {' '}(GDPR Art. 6 & 7)
            </span>
          </label>
          <button
            className="fb-login-submit"
            style={{ background: checked ? '#2D6A4F' : '#ccc', width: '100%' }}
            disabled={!checked || loading}
            onClick={async () => { setLoading(true); await onAccept(); setLoading(false) }}
          >
            {loading ? '…' : (da ? 'Acceptér og fortsæt' : 'Accept and continue')}
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
  const { lang, setLanguage: setLang } = useLanguage()
  const t = getTranslations(lang)
  // GDPR: Show general data processing consent for existing users who haven't accepted yet
  const [showGeneralConsent, setShowGeneralConsent] = useState(false)
  const [inviteToken, setInviteToken] = useState(null)
  const [inviterName, setInviterName] = useState(null)
  const [inviterEmail, setInviterEmail] = useState(null)
  const [initialPostId, setInitialPostId] = useState(null)
  const [initialPage, setInitialPage] = useState(null)
  const [resetToken, setResetToken] = useState(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  // On first visit (no stored lang): detect language from IP geolocation
  useEffect(() => {
    if (!localStorage.getItem('lang')) {
      detectLangFromIP().then(detected => {
        if (detected && !localStorage.getItem('lang')) {
          setLang(detected)
        }
      })
    }
  }, [])

  // On mount: check for OAuth callback, invite links, or validate existing session
  useEffect(() => {
    apiTrackVisit()

    // Check for /@handle URL pattern (public profile)
    const handleMatch = window.location.pathname.match(/^\/@([^\/]+)(?:\/(.+))?$/)
    if (handleMatch) {
      const handle = handleMatch[1]
      const subpage = handleMatch[2] // 'cv' or undefined
      ;(async () => {
        try {
          const userData = await apiGetUserByHandle(handle)
          if (userData?.id) {
            // Store userId to show profile after auth check completes
            sessionStorage.setItem('fellis_profile_userId', userData.id)
            if (subpage) sessionStorage.setItem('fellis_profile_subpage', subpage)
            // Replace URL to clean it up
            window.history.replaceState({}, '', '/')
          }
        } catch (err) {
          // Handle not found — just proceed normally
          window.history.replaceState({}, '', '/')
        }
      })()
    }

    const params = new URLSearchParams(window.location.search)
    const postId = params.get('post')
    if (postId) {
      setInitialPostId(parseInt(postId))
      window.history.replaceState({}, '', window.location.pathname)
    }
    const molliePayment = params.get('mollie_payment')
    if (molliePayment === 'success') {
      setInitialPage('payment-success')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (molliePayment === 'failed' || molliePayment === 'cancel') {
      setInitialPage('payment-failed')
      window.history.replaceState({}, '', window.location.pathname)
    }
    const pageParam = params.get('page')
    if (pageParam) {
      setInitialPage(pageParam)
      params.delete('page')
      const remaining = params.toString()
      window.history.replaceState({}, '', remaining ? `${window.location.pathname}?${remaining}` : window.location.pathname)
    }
    // Returning from Google OAuth
    const googleSession = params.get('google_session')
    const googleConnected = params.get('google_connected')
    if (googleSession) {
      // Session stored in HTTP-only cookie
      localStorage.setItem('fellis_logged_in', 'true')
      // Fetch CSRF token before mounting platform — prevents 403s on the first
      // POST requests (heartbeat, ad impressions) that fire immediately on mount
      ;(async () => {
        const csrfData = await apiGetCsrfToken().catch(() => null)
        if (csrfData?.csrfToken) {
          localStorage.setItem('fellis_csrf_token', csrfData.csrfToken)
        }
        setView('platform')
        window.history.replaceState({}, '', window.location.pathname)
      })()
      return
    }
    if (googleConnected === '1') {
      window.history.replaceState({}, '', window.location.pathname)
    }

    // Returning from LinkedIn OAuth
    const linkedinSession = params.get('linkedin_session')
    const linkedinConnected = params.get('linkedin_connected')
    if (linkedinSession) {
      // Session stored in HTTP-only cookie
      localStorage.setItem('fellis_logged_in', 'true')
      // Fetch CSRF token before mounting platform — same fix as Google OAuth path
      ;(async () => {
        const csrfData = await apiGetCsrfToken().catch(() => null)
        if (csrfData?.csrfToken) {
          localStorage.setItem('fellis_csrf_token', csrfData.csrfToken)
        }
        setView('platform')
        window.history.replaceState({}, '', window.location.pathname)
      })()
      return
    }
    if (linkedinConnected === '1') {
      window.history.replaceState({}, '', window.location.pathname)
    }

    // Check for invite token in URL
    const invite = params.get('invite')
    if (invite) {
      setInviteToken(invite)
      localStorage.setItem('fellis_invite_token', invite)
      apiGetInviteInfo(invite).then(data => {
        if (data?.inviter?.name) {
          setInviterName(data.inviter.name)
          // Store for onboarding if user goes via OAuth (loses state after redirect)
          localStorage.setItem('fellis_invite_info_name', data.inviter.name)
        }
        if (data?.invitee_email) setInviterEmail(data.invitee_email)
      })
      window.history.replaceState({}, '', window.location.pathname)
    } else {
      const storedInvite = localStorage.getItem('fellis_invite_token')
      if (storedInvite) setInviteToken(storedInvite)
    }

    // Password reset link: ?reset_token=<raw token from email>
    const resetTokenParam = params.get('reset_token')
    if (resetTokenParam) {
      setResetToken(resetTokenParam)
      window.history.replaceState({}, '', window.location.pathname)
    }

    apiCheckSession().then(async data => {
      if (data && !data.__authError) {
        if (data.lang) setLang(data.lang)
        localStorage.setItem('fellis_logged_in', 'true')
        // Fetch CSRF token before mounting platform — avoids race where a POST
        // fires before the token is stored (same fix applied to handleEnterPlatform)
        const csrfData = await apiGetCsrfToken().catch(() => null)
        if (csrfData?.csrfToken) {
          localStorage.setItem('fellis_csrf_token', csrfData.csrfToken)
        }
        setView('platform')
        // Check if user has given data_processing consent — show dialog if not
        const consentData = await apiGetConsentStatus().catch(() => null)
        if (consentData && !consentData.data_processing?.given) {
          setShowGeneralConsent(true)
        }
      } else if (data?.__authError) {
        // Genuine 401/403 — session is invalid, clear it
        const hadSession = localStorage.getItem('fellis_logged_in') === 'true'
        localStorage.removeItem('fellis_logged_in')
        // Session cookie automatically managed by browser
        localStorage.removeItem('fellis_csrf_token')
        if (hadSession) setSessionExpired(true)
        setView('landing')
      } else {
        // null = network error or server unavailable — don't clear session,
        // just show landing so the user can retry
        setView('landing')
      }
    })
  }, [])

  const handleEnterPlatform = useCallback(async (selectedLang) => {
    setLang(selectedLang)
    localStorage.setItem('fellis_logged_in', 'true')

    localStorage.removeItem('fellis_invite_token')
    setInviteToken(null)
    setInviterName(null)
    // Fetch CSRF token before mounting platform — avoids race where heartbeat
    // fires before the token is stored (platform mounts and immediately POSTs)
    const csrfData = await apiGetCsrfToken().catch(() => null)
    if (csrfData?.csrfToken) {
      localStorage.setItem('fellis_csrf_token', csrfData.csrfToken)
    }
    setView('platform')
    // Check if existing user has given data_processing consent
    apiGetConsentStatus().then(data => {
      if (data && !data.data_processing?.given) setShowGeneralConsent(true)
    }).catch(() => {})
  }, [])

  const handleLogout = useCallback(() => {
    setView('landing')
    localStorage.removeItem('fellis_logged_in')
    localStorage.removeItem('lang')
    // Session cookie automatically managed by browser
    localStorage.removeItem('fellis_csrf_token')
    localStorage.removeItem(USER_LS_KEY)
    apiLogout().catch(() => {})
  }, [])

  if (view === 'platform') {
    return (
      <>
        {showGeneralConsent && (
          <GeneralConsentDialog
            lang={lang}
            onAccept={async () => {
              await apiGiveConsent(['data_processing']).catch(() => {})
              setShowGeneralConsent(false)
            }}
          />
        )}
        <Platform
          lang={lang}
          onLogout={handleLogout}
          initialPostId={initialPostId}
          initialPage={initialPage}
          initialProfileUserId={parseInt(sessionStorage.getItem('fellis_profile_userId') || '0') || null}
          initialProfileSubpage={sessionStorage.getItem('fellis_profile_subpage')}
        />
        <InstallPrompt lang={lang} />
      </>
    )
  }

  return (
    <>
      {sessionExpired && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10,
          background: '#1a1a2e', color: '#fff', borderRadius: 10,
          padding: '12px 18px', fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          maxWidth: 'calc(100vw - 32px)',
        }}>
          <span>🔒</span>
          <span>{t.yourSessionHasExpiredPleaseLogInAgain}</span>
          <button
            onClick={() => setSessionExpired(false)}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, lineHeight: 1, marginLeft: 4, padding: 0 }}
            aria-label="Luk"
          >✕</button>
        </div>
      )}
      <Landing onEnterPlatform={handleEnterPlatform} inviteToken={inviteToken} inviterName={inviterName} inviterEmail={inviterEmail} resetToken={resetToken} />
      <InstallPrompt lang={lang} />
    </>
  )
}

// ── Public Sales Terms Page (/salgsbetingelser) ──
function PublicSalgsbetingelserPage() {
  const { lang, setLanguage: setLang } = useLanguage()
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
    ol: { fontSize: 14, color: '#555', lineHeight: 1.8, paddingLeft: 22, marginTop: 8 },
    email: { color: '#2D6A4F', fontWeight: 600 },
    footer: { textAlign: 'center', fontSize: 13, color: '#999', marginTop: 40 },
    highlight: { background: '#F0FAF4', border: '1px solid #c3e6cb', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#2D6A4F', margin: '10px 0' },
    warn: { background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#795548', margin: '10px 0' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, margin: '10px 0' },
    th: { textAlign: 'left', fontWeight: 700, padding: '8px 10px', background: '#F7F4F0', border: '1px solid #E8E4DF' },
    td: { padding: '8px 10px', border: '1px solid #E8E4DF', color: '#555', verticalAlign: 'top' },
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <a href="/" style={s.brand}>fellis.eu</a>
        <select style={s.langBtn} value={lang} onChange={e => setLang(e.target.value)} aria-label="Language">{UI_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
      </nav>

      <h1 style={s.h1}>{da ? 'Salgsbetingelser' : 'Sales Terms'}</h1>
      <p style={s.sub}>{da ? 'Sidst opdateret: april 2026' : 'Last updated: April 2026'}</p>

      {/* 1. Sælger */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '1. Sælger' : '1. Seller'}</h2>
        <p style={s.p}>
          <strong>fellis.eu</strong><br />
          {da ? 'Drevet af' : 'Operated by'}: <strong>gnf.dk</strong><br />
          CVR: 16143103<br />
          E-mail: <a href="mailto:privacy@fellis.eu" style={s.email}>privacy@fellis.eu</a>
        </p>
        <p style={s.p}>{da
          ? 'Disse salgsbetingelser gælder for køb af digitale ydelser på fellis.eu og er udformet i overensstemmelse med Forbrugerombudsmandens retningslinjer for nethandel.'
          : 'These Sales Terms apply to purchases of digital services on fellis.eu and comply with the Danish Consumer Ombudsman\'s guidelines for online commerce.'
        }</p>
      </div>

      {/* 2. Ydelser og priser */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '2. Ydelser og priser' : '2. Services and prices'}</h2>
        <p style={s.p}>{da ? 'fellis.eu sælger følgende digitale ydelser:' : 'fellis.eu sells the following digital services:'}</p>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{da ? 'Ydelse' : 'Service'}</th>
              <th style={s.th}>{da ? 'Beskrivelse' : 'Description'}</th>
              <th style={s.th}>{da ? 'Pris (inkl. moms)' : 'Price (incl. VAT)'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={s.td}><strong>{da ? 'Reklamefri oplevelse – Privat' : 'Ad-free experience – Personal'}</strong></td>
              <td style={s.td}>{da ? 'Fjerner alle annoncer fra din feed, sidebar og stories. Gælder for personlige konti.' : 'Removes all ads from your feed, sidebar and stories. Applies to personal accounts.'}</td>
              <td style={s.td}>{da ? 'Fra 29,00 EUR / engangsbetaling (30 dages reklamefri adgang)\neller fra 29,00 EUR / md. (abonnement)\neller fra 290,00 EUR / år (abonnement)' : 'From EUR 29.00 / one-time (30 days ad-free access)\nor from EUR 29.00 / month\nor from EUR 290.00 / year'}</td>
            </tr>
            <tr>
              <td style={s.td}><strong>{da ? 'Reklamefri oplevelse – Business' : 'Ad-free experience – Business'}</strong></td>
              <td style={s.td}>{da ? 'Som ovenfor, men for erhvervskonti.' : 'As above, but for business accounts.'}</td>
              <td style={s.td}>{da ? 'Fra 49,00 EUR / engangsbetaling (30 dages reklamefri adgang)\neller fra 49,00 EUR / md. (abonnement)\neller fra 490,00 EUR / år (abonnement)' : 'From EUR 49.00 / one-time (30 days ad-free access)\nor from EUR 49.00 / month\nor from EUR 490.00 / year'}</td>
            </tr>
            <tr>
              <td style={s.td}><strong>{da ? 'Annoncering (business-konti)' : 'Advertising (business accounts)'}</strong></td>
              <td style={s.td}>{da ? 'Betalte annoncekampagner vist til brugere på platformen.' : 'Paid ad campaigns displayed to users on the platform.'}</td>
              <td style={s.td}>{da ? 'Variabel — se priser ved oprettelse' : 'Variable — see pricing when creating an ad'}</td>
            </tr>
          </tbody>
        </table>
        <div style={s.highlight}>{da
          ? 'Alle priser er angivet i EUR og er inklusiv dansk moms (25 %), medmindre andet fremgår. Den præcise pris fremgår altid på betalingssiden inden købet gennemføres.'
          : 'All prices are in EUR and include Danish VAT (25 %) unless otherwise stated. The exact price is always shown on the payment page before you complete the purchase.'
        }</div>
        <p style={s.p}>{da
          ? 'Priser kan justeres med mindst 30 dages varsel for abonnementer. En igangværende abonnementsperiode påvirkes ikke.'
          : 'Prices may be adjusted with at least 30 days\' notice for subscriptions. An ongoing subscription period is not affected.'
        }</p>
      </div>

      {/* 3. Betalingsbetingelser */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '3. Betalingsbetingelser' : '3. Payment terms'}</h2>
        <p style={s.p}>{da
          ? 'Betaling sker via betalingsgatewayen Mollie (EU-certificeret). Følgende betalingsmetoder er tilgængelige:'
          : 'Payment is processed through Mollie (EU-certified payment gateway). The following payment methods are available:'
        }</p>
        <ul style={s.ul}>
          <li>MobilePay {da ? '(kun for personlige konti)' : '(personal accounts only)'}</li>
          <li>Visa / Mastercard</li>
          <li>Apple Pay</li>
          <li>Google Pay</li>
        </ul>
        <p style={s.p}>{da
          ? 'Betalingen trækkes straks ved gennemførelse. For løbende abonnementer trækkes betalingen automatisk på fornyelsesdatoen. Du modtager en kvittering pr. e-mail. Dine betalingsoplysninger håndteres udelukkende af Mollie (PCI DSS).'
          : 'Payment is charged immediately upon completion. For recurring subscriptions, payment is charged automatically on the renewal date. You will receive a receipt by e-mail. Your payment information is handled exclusively by Mollie (PCI DSS).'
        }</p>
      </div>

      {/* 4. Levering */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '4. Levering' : '4. Delivery'}</h2>
        <p style={s.p}>{da
          ? 'Alle ydelser er digitale og leveres øjeblikkeligt efter betaling er bekræftet. Den reklamefrie oplevelse aktiveres automatisk på din konto.'
          : 'All services are digital and delivered instantly after payment is confirmed. The ad-free experience is automatically activated on your account.'
        }</p>
      </div>

      {/* 5. Fortrydelsesret */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '5. Fortrydelsesret' : '5. Right of withdrawal'}</h2>
        <div style={s.warn}><strong>{da ? 'Vigtig information om fortrydelsesret for digitale ydelser:' : 'Important: right of withdrawal for digital services:'}</strong><br /><br />
          {da
            ? 'I henhold til forbrugeraftalelovens § 18, stk. 2, nr. 13, bortfalder din fortrydelsesret, når du udtrykkeligt har samtykket til, at leveringen påbegyndes inden udløbet af fortrydelsesfristen, og du har bekræftet, at du derved mister din fortrydelsesret.'
            : 'Under the Danish Consumer Contracts Act § 18(2)(13), your right of withdrawal lapses when you have explicitly consented to delivery commencing before the withdrawal period expires, and confirmed that you thereby lose your right of withdrawal.'}
        </div>
        <p style={s.p}>{da
          ? 'Du vil blive bedt om at bekræfte dette på betalingssiden. Har du ikke givet samtykke, gælder den sædvanlige 14-dages fortrydelsesret — kontakt os på privacy@fellis.eu inden for 14 dage.'
          : 'You will be asked to confirm this on the payment page. If you have not given this consent, the standard 14-day right of withdrawal applies — contact us at privacy@fellis.eu within 14 days.'
        }</p>
      </div>

      {/* 6. Opsigelse */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '6. Opsigelse af abonnement' : '6. Subscription cancellation'}</h2>
        <p style={s.p}>{da
          ? 'Løbende abonnementer kan opsiges når som helst via Indstillinger → Betaling. Opsigelsen træder i kraft ved udløbet af den betalte periode — du bevarer adgangen frem til periodens udgang. Der refunderes ikke for resterende dage.'
          : 'Recurring subscriptions can be cancelled at any time via Settings → Billing. Cancellation takes effect at the end of the paid period — you retain access until then. No refund is issued for remaining days.'
        }</p>
      </div>

      {/* 7. Klager */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '7. Klager' : '7. Complaints'}</h2>
        <p style={s.p}>{da
          ? 'Kontakt os på privacy@fellis.eu. Vi bestræber os på at besvare inden for 5 hverdage. Kan vi ikke nå til enighed, kan du indbringe sagen for Center for Klageløsning (centerforklageloesning.dk) eller EU\'s online klageportal (ec.europa.eu/odr).'
          : 'Contact us at privacy@fellis.eu. We aim to respond within 5 business days. If we cannot reach an agreement, you may bring the case to Center for Klageløsning (centerforklageloesning.dk) or the EU\'s online dispute resolution portal (ec.europa.eu/odr).'
        }</p>
        <p style={{ ...s.p, ...s.email }}>privacy@fellis.eu</p>
      </div>

      {/* 8. Lovvalg */}
      <div style={s.section}>
        <h2 style={s.h2}>{da ? '8. Lovvalg og tvistbilæggelse' : '8. Governing law and dispute resolution'}</h2>
        <p style={s.p}>{da
          ? 'Disse salgsbetingelser er underlagt dansk ret. Eventuelle tvister afgøres ved de kompetente danske domstole eller et anerkendt klagenævn.'
          : 'These Sales Terms are governed by Danish law. Any disputes shall be settled by the competent Danish courts or a recognised complaints board.'
        }</p>
      </div>

      <div style={s.footer}>
        <p>fellis.eu — {da ? 'Dansk social platform hostet i EU' : 'Danish social platform hosted in the EU'}</p>
        <a href="/" style={{ color: '#2D6A4F', textDecoration: 'none' }}>{da ? '← Gå til fellis.eu' : '← Go to fellis.eu'}</a>
      </div>
    </div>
  )
}

function AppRoot() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (path === '/privacy') return <PublicPrivacyPage />
  if (path === '/terms') return <PublicTermsPage />
  if (path === '/salgsbetingelser') return <PublicSalgsbetingelserPage />
  if (path === '/blog' || window.location.pathname.startsWith('/blog/')) return <PublicBlogPage />
  if (path === '/for-business') return <ForBusiness />
  return <App />
}

export default AppRoot
