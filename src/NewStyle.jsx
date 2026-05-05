import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTranslations, getInitials, nameToColor } from './data.js'
import {
  apiGetDiscovery,
  apiFetchFriendSuggestions,
  apiGetTrendingTags,
  apiGetNotificationPreferences,
  apiSaveNotificationPreferences,
} from './api.js'

// ── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  navy:        '#1C2B3A',
  sand:        '#F5F3EE',
  sandBorder:  '#E2DDD5',
  sandMid:     '#EDE9E2',
  white:       '#FFFFFF',
  green:       '#6BB89E',
  greenDark:   '#3B6E5A',
  greenBg:     '#EAF4EF',
  greenBorder: '#B8DDD0',
  greenPanel:  '#F0F7F4',
  textPrimary: '#1C2B3A',
  textMuted:   '#5C6E7B',
  textFaint:   '#8A9BAB',
  textHint:    '#B0A898',
}

// ── Sample fallback data ──────────────────────────────────────────────────────
const SAMPLE_BEST_MATCHES = [
  { id: null, initials: 'MR', bg: '#4E7FA0', name: 'Mads Rohde',      tags: 'IPA · wine',         pct: 92 },
  { id: null, initials: 'SB', bg: '#7A6BB5', name: 'Sofia Bergström', tags: 'sushi · slow travel', pct: 78 },
  { id: null, initials: 'JP', bg: '#6B8B5A', name: 'Jonas P.',        tags: 'coffee · vinyl',      pct: 71 },
]

const SAMPLE_TRENDING = [
  { icon: '🍺', label: 'Natural wine evenings', count: 24 },
  { icon: '🍣', label: 'Omakase Copenhagen',    count: 17 },
  { icon: '☕', label: 'Filter coffee mornings', count: 11 },
]

const PSEUDO_PCTS = [92, 88, 84, 78, 74, 71, 68, 65]

function pseudoPct(id, idx) {
  const n = typeof id === 'number' ? id : (String(id || idx).split('').reduce((a, c) => a + c.charCodeAt(0), 0))
  return PSEUDO_PCTS[(n + idx) % PSEUDO_PCTS.length]
}

// ── Nav icons ─────────────────────────────────────────────────────────────────
function IconHome()     { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3L21 9.5V20C21 20.6 20.6 21 20 21H15V16H9V21H4C3.4 21 3 20.6 3 20V9.5Z" /></svg> }
function IconDiscover() { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M16.2 7.8L14.1 14.1L7.8 16.2L9.9 9.9Z" /></svg> }
function IconMessages() { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15C21 15.5 20.8 16 20.4 16.4C20 16.8 19.5 17 19 17H7L3 21V5C3 4.5 3.2 4 3.6 3.6C4 3.2 4.5 3 5 3H19C19.5 3 20 3.2 20.4 3.6C20.8 4 21 4.5 21 5V15Z" /></svg> }
function IconFriends()  { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4" /><path d="M3 21V19C3 16.8 4.8 15 7 15H11C13.2 15 15 16.8 15 19V21" /><path d="M16 3.1C17.8 3.6 19 5.3 19 7.1C19 8.9 17.8 10.5 16 11M21 21V19C21 17.2 19.8 15.6 18 15.1" /></svg> }
function IconProfile()  { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21V19C20 16.8 18.2 15 16 15H8C5.8 15 4 16.8 4 19V21" /><circle cx="12" cy="7" r="4" /></svg> }
function IconExplore()  { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21L16.65 16.65" /></svg> }
function IconEvents()   { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2V6M8 2V6M3 10H21" /></svg> }
function IconMarket()   { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V6L18 2H6Z" /><path d="M3 6H21M16 10C16 12.2 14.2 14 12 14C9.8 14 8 12.2 8 10" /></svg> }
function IconSettings() { return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2V4M12 20V22M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M2 12H4M20 12H22M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" /></svg> }

// pathname → nav id
function pathnameToNav(pathname) {
  if (!pathname || pathname === '/') return 'home'
  const seg = pathname.split('/').filter(Boolean)[0]
  const map = { explore: 'discover', messages: 'messages', friends: 'friends', profile: 'profile', 'edit-profile': 'profile', settings: 'settings', events: 'events', marketplace: 'market' }
  return map[seg] || seg
}

const NAV_ITEMS = [
  { id: 'home',     Icon: IconHome,     labelKey: 'nsHome',     href: '/' },
  { id: 'discover', Icon: IconDiscover, labelKey: 'nsDiscover', href: '/explore' },
  { id: 'messages', Icon: IconMessages, labelKey: 'nsMessages', href: '/messages' },
  { id: 'friends',  Icon: IconFriends,  labelKey: 'nsFriends',  href: '/friends' },
  { id: 'events',   Icon: IconEvents,   labelKey: 'nsEvents',   href: '/events' },
  { id: 'market',   Icon: IconMarket,   labelKey: 'nsMarket',   href: '/marketplace' },
  { id: 'profile',  Icon: IconProfile,  labelKey: 'nsProfile',  href: '/profile' },
  { id: 'settings', Icon: IconSettings, labelKey: 'nsSettings', href: '/settings' },
]

// ── NavItem ───────────────────────────────────────────────────────────────────
function NavItem({ active, label, Icon, onClick }) {
  const [hov, setHov] = useState(false)
  const s = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9,
    fontSize: 14, cursor: 'pointer', userSelect: 'none',
    background: active ? 'rgba(107,184,158,0.15)' : hov ? 'rgba(255,255,255,0.06)' : 'transparent',
    color: active ? C.green : hov ? '#C8BFB0' : '#7A8F9E',
    transition: 'background 0.12s, color 0.12s',
  }
  return (
    <div style={s} onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <Icon /><span>{label}</span>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on, onChange, busy }) {
  return (
    <div
      style={{ width: 32, height: 18, borderRadius: 9, background: on ? C.green : '#D4CFC7', position: 'relative', cursor: busy ? 'default' : 'pointer', transition: 'background 0.2s', flexShrink: 0, opacity: busy ? 0.6 : 1 }}
      onClick={busy ? undefined : onChange}
      role="switch" aria-checked={on}
    >
      <div style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: C.white, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }} />
    </div>
  )
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textHint, marginBottom: 12 }}>{children}</div>
}

// ── Shell wrapper ─────────────────────────────────────────────────────────────
export default function NewStyle({ children, onExitShell }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const lang      = localStorage.getItem('lang') || 'da'
  const t         = getTranslations(lang)

  const activeNav = pathnameToNav(location.pathname)

  const [bestMatches, setBestMatches] = useState(SAMPLE_BEST_MATCHES)
  const [trending, setTrending]       = useState(SAMPLE_TRENDING)
  const [toggles, setToggles]         = useState({ profileVisibility: true, showLocation: false, matchingActive: true })
  const [toggleBusy, setToggleBusy]   = useState({})

  // Fetch right-sidebar data once
  useEffect(() => {
    Promise.all([
      apiFetchFriendSuggestions(),
      apiGetTrendingTags(),
    ]).then(([suggestions, tags]) => {
      if (Array.isArray(suggestions) && suggestions.length) {
        setBestMatches(suggestions.slice(0, 3).map((u, i) => ({
          id: u.id,
          initials: getInitials(u.name || ''),
          bg: nameToColor(u.name || ''),
          name: u.name || '',
          tags: '',
          pct: pseudoPct(u.id, i),
          avatar: u.avatar_url || null,
        })))
      }
      if (Array.isArray(tags) && tags.length) {
        setTrending(tags.slice(0, 3).map((item, i) => ({
          icon: ['🍺', '🍣', '☕'][i] || '🏷️',
          label: item.tag || item.name || '',
          count: Number(item.count) || 0,
        })))
      }
    })
    apiGetNotificationPreferences().then(prefs => {
      if (!prefs) return
      setToggles(prev => ({
        profileVisibility: prefs.profile_visibility ?? prev.profileVisibility,
        showLocation:      prefs.show_location      ?? prev.showLocation,
        matchingActive:    prefs.matching_active     ?? prev.matchingActive,
      }))
    })
  }, [])

  const handleToggle = async (key) => {
    const next = { ...toggles, [key]: !toggles[key] }
    setToggles(next)
    setToggleBusy(prev => ({ ...prev, [key]: true }))
    await apiSaveNotificationPreferences({ profile_visibility: next.profileVisibility, show_location: next.showLocation, matching_active: next.matchingActive }).catch(() => {})
    setToggleBusy(prev => ({ ...prev, [key]: false }))
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s = {
    root:  { display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" },

    // Left sidebar
    sidebar: { width: 200, flexShrink: 0, background: C.navy, display: 'flex', flexDirection: 'column', padding: '24px 0', overflowY: 'auto' },
    logo: { fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#C8BFB0', padding: '0 20px', marginBottom: 28, letterSpacing: '-0.01em', cursor: 'pointer', userSelect: 'none' },
    logoAccent: { color: C.green },
    nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' },
    exitBtn: { margin: '12px 14px 0', fontSize: 11, fontWeight: 600, color: '#7A8F9E', background: 'transparent', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap' },
    privacyBadge: { margin: '16px 14px 0', display: 'flex', alignItems: 'center', gap: 7, background: '#1E3828', borderRadius: 20, padding: '6px 11px' },
    privacyDot: { width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 },
    privacyLabel: { fontSize: 11, color: '#8FB8A2', lineHeight: 1.3 },

    // Center
    center: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

    // Right sidebar
    right: { width: 232, flexShrink: 0, background: C.white, borderLeft: `0.5px solid ${C.sandBorder}`, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 24 },

    matchRow: (last) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: last ? 'none' : `0.5px solid #F0ECE5`, cursor: 'pointer' }),
    matchAvatar: (bg) => ({ width: 32, height: 32, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: C.white, flexShrink: 0, overflow: 'hidden' }),
    matchName: { fontSize: 13, fontWeight: 500, color: C.textPrimary, lineHeight: 1.2 },
    matchTags: { fontSize: 11, color: C.textFaint },
    matchPct:  { fontSize: 13, fontWeight: 500, color: C.greenDark, marginLeft: 'auto', flexShrink: 0 },

    trendRow: (last) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: last ? 'none' : `0.5px solid #F0ECE5`, cursor: 'pointer' }),
    trendIcon: { fontSize: 15, flexShrink: 0 },
    trendLabel: { fontSize: 12, color: C.textMuted, flex: 1, lineHeight: 1.3 },
    trendCount: { fontSize: 12, color: C.textHint, flexShrink: 0 },

    suggestedPanel: { background: C.greenPanel, border: `0.5px solid #C8DDCF`, borderRadius: 10, padding: 13 },
    suggestedLabel: { fontSize: 11, fontWeight: 500, color: C.greenDark, marginBottom: 6 },
    suggestedText:  { fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 },
    suggestedFooter:{ fontSize: 11, fontStyle: 'italic', color: C.textFaint },

    privacyPanel: { background: C.sand, border: `0.5px solid ${C.sandBorder}`, borderRadius: 10, padding: 13 },
    privacyRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' },
    privacyLabel2:{ fontSize: 12, color: C.textMuted },
    visRow:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTop: `0.5px solid ${C.sandBorder}` },
    visLabel:     { fontSize: 12, color: C.textFaint },
    visValue:     { fontSize: 12, fontWeight: 700, color: C.greenDark },
  }

  const privacyRows = [
    { key: 'profileVisibility', label: t.nsProfileVisibility  || 'Profile visibility' },
    { key: 'showLocation',      label: t.nsShowLocation       || 'Show location' },
    { key: 'matchingActive',    label: t.nsMatchingActive     || 'Matching active' },
  ]

  return (
    <div style={s.root}>
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside style={s.sidebar}>
        <div style={s.logo} onClick={() => navigate('/')}>
          fell<span style={s.logoAccent}>i</span>s
        </div>

        <nav style={s.nav}>
          {NAV_ITEMS.map(({ id, Icon, labelKey, href }) => {
            const label = t[labelKey] || labelKey
            return (
              <NavItem
                key={id}
                active={activeNav === id}
                label={label}
                Icon={Icon}
                onClick={() => navigate(href)}
              />
            )
          })}
        </nav>

        <button
          style={s.exitBtn}
          onClick={() => { onExitShell?.(); window.location.reload() }}
        >
          ← {lang === 'da' ? 'Gammelt design' : 'Classic design'}
        </button>

        <div style={s.privacyBadge}>
          <div style={s.privacyDot} />
          <span style={s.privacyLabel}>{t.nsDataStaysInEurope || 'Data stays in Europe'}</span>
        </div>
      </aside>

      {/* ── Center — Platform content ──────────────────────────────────────── */}
      <div style={s.center}>
        {children}
      </div>

      {/* ── Right sidebar ─────────────────────────────────────────────────── */}
      <aside style={s.right}>

        <section>
          <SectionTitle>{t.nsBestMatches || 'Best matches'}</SectionTitle>
          {bestMatches.map((m, i) => (
            <div
              key={i}
              style={s.matchRow(i === bestMatches.length - 1)}
              onClick={() => m.id && navigate(`/profile/${m.id}`)}
            >
              <div style={s.matchAvatar(m.bg)}>
                {m.avatar
                  ? <img src={m.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : m.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.matchName}>{m.name}</div>
                {m.tags && <div style={s.matchTags}>{m.tags}</div>}
              </div>
              <div style={s.matchPct}>{m.pct}%</div>
            </div>
          ))}
        </section>

        <section>
          <SectionTitle>{t.nsTrendingInYourTaste || 'Trending in your taste'}</SectionTitle>
          {trending.map((item, i) => (
            <div
              key={i}
              style={s.trendRow(i === trending.length - 1)}
              onClick={() => navigate(`/explore?tag=${encodeURIComponent(item.label)}`)}
            >
              <span style={s.trendIcon}>{item.icon}</span>
              <span style={s.trendLabel}>{item.label}</span>
              <span style={s.trendCount}>+{item.count}</span>
            </div>
          ))}
        </section>

        <section>
          <SectionTitle>{t.nsSuggestedForYou || 'Suggested for you'}</SectionTitle>
          <div style={s.suggestedPanel}>
            <div style={s.suggestedLabel}>{t.nsSuggestedForYou || 'Suggested for you'}</div>
            <div style={s.suggestedText}>{t.nsSuggestedText || 'We found users with strong taste overlaps with you.'}</div>
            <div style={s.suggestedFooter}>{t.nsBasedOnTasteProfile || 'Based on your taste profile — not your behaviour'}</div>
          </div>
        </section>

        <section>
          <SectionTitle>{t.nsPrivacyControls || 'Privacy controls'}</SectionTitle>
          <div style={s.privacyPanel}>
            {privacyRows.map(({ key, label }) => (
              <div key={key} style={s.privacyRow}>
                <span style={s.privacyLabel2}>{label}</span>
                <Toggle on={toggles[key]} onChange={() => handleToggle(key)} busy={!!toggleBusy[key]} />
              </div>
            ))}
            <div style={s.visRow}>
              <span style={s.visLabel}>{t.nsVisibility || 'Visibility'}:</span>
              <span style={s.visValue}>{t.nsConnectionsOnly || 'Connections only'}</span>
            </div>
          </div>
        </section>

      </aside>
    </div>
  )
}
