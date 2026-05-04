import { useState, useEffect } from 'react'
import { getTranslations, getInitials, nameToColor } from './data.js'
import { apiGetDiscovery, apiFetchFriendSuggestions, apiGetTrendingTags, apiSendFriendRequest } from './api.js'

// ── Color tokens ────────────────────────────────────────────────────────────
const C = {
  navy:        '#1C2B3A',
  navyHover:   '#253849',
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

const CARDS_PER_PAGE = 2
const TOTAL_MATCHES = 24

// ── Sample fallback data ─────────────────────────────────────────────────────
const SAMPLE_FEED_CARDS = [
  {
    id: 1,
    initials: 'MR',
    avatarBg: '#4E7FA0',
    name: 'Mads Rohde',
    location: 'Copenhagen · 3 km away',
    match: 92,
    why: 'You both enjoy craft IPA, natural wine, and Sunday morning coffee rituals.',
    tags: [
      { label: '🍺 Craft IPA', shared: true },
      { label: '🍷 Natural wine', shared: true },
      { label: '☕ Specialty coffee', shared: true },
      { label: '🎸 Vinyl records', shared: false },
    ],
  },
  {
    id: 2,
    initials: 'SB',
    avatarBg: '#7A6BB5',
    name: 'Sofia Bergström',
    location: 'Malmö · 8 km away',
    match: 78,
    why: 'Shared interest in Japanese food, fermentation, and slow travel.',
    tags: [
      { label: '🍣 Japanese food', shared: true },
      { label: '🧪 Fermentation', shared: true },
      { label: '✈️ Slow travel', shared: false },
      { label: '🌿 Foraging', shared: false },
    ],
  },
  {
    id: 3,
    initials: 'JP',
    avatarBg: '#6B8B5A',
    name: 'Jonas P.',
    location: 'Copenhagen · 5 km away',
    match: 71,
    why: 'Shared love of specialty coffee, vinyl records, and live jazz.',
    tags: [
      { label: '☕ Specialty coffee', shared: true },
      { label: '🎷 Jazz', shared: true },
      { label: '🎸 Vinyl records', shared: false },
      { label: '🚲 Cycling', shared: false },
    ],
  },
  {
    id: 4,
    initials: 'AL',
    avatarBg: '#B08060',
    name: 'Astrid Larsen',
    location: 'Aarhus · 12 km away',
    match: 65,
    why: 'Both into foraging, natural wine, and Scandinavian design.',
    tags: [
      { label: '🌿 Foraging', shared: true },
      { label: '🍷 Natural wine', shared: true },
      { label: '🏛️ Design', shared: false },
      { label: '📚 Books', shared: false },
    ],
  },
]

const SAMPLE_BEST_MATCHES = [
  { initials: 'MR', bg: '#4E7FA0', name: 'Mads Rohde',      tags: 'IPA · wine',         pct: 92 },
  { initials: 'SB', bg: '#7A6BB5', name: 'Sofia Bergström', tags: 'sushi · slow travel', pct: 78 },
  { initials: 'JP', bg: '#6B8B5A', name: 'Jonas P.',        tags: 'coffee · vinyl',      pct: 71 },
]

const SAMPLE_TRENDING = [
  { icon: '🍺', label: 'Natural wine evenings', count: 24 },
  { icon: '🍣', label: 'Omakase Copenhagen',    count: 17 },
  { icon: '☕', label: 'Filter coffee mornings', count: 11 },
]

// ── Helper: map API discovery item to feed card shape ───────────────────────
function mapDiscoveryToCard(item, idx) {
  const name = item.name || 'Unknown'
  const matchScores = [88, 76, 69, 63, 57, 51]
  return {
    id: item.id || idx,
    initials: getInitials(name),
    avatarBg: nameToColor(name),
    name,
    location: item.location || '',
    match: matchScores[idx % matchScores.length],
    why: item.description_en || item.description_da || '',
    tags: [],
  }
}

function mapSuggestionToMatch(item, idx) {
  const name = item.name || 'Unknown'
  const pcts = [88, 76, 69]
  return {
    initials: getInitials(name),
    bg: nameToColor(name),
    name,
    tags: '',
    pct: pcts[idx % pcts.length],
  }
}

// ── Nav icons (stroke-only SVG) ──────────────────────────────────────────────
function IconHome() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3L21 9.5V20C21 20.6 20.6 21 20 21H15V16H9V21H4C3.4 21 3 20.6 3 20V9.5Z" />
    </svg>
  )
}

function IconDiscover() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function IconMessages() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15C21 15.5 20.8 16 20.4 16.4C20 16.8 19.5 17 19 17H7L3 21V5C3 4.5 3.2 4 3.6 3.6C4 3.2 4.5 3 5 3H19C19.5 3 20 3.2 20.4 3.6C20.8 4 21 4.5 21 5V15Z" />
    </svg>
  )
}

function IconProfile() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21V19C20 16.8 18.2 15 16 15H8C5.8 15 4 16.8 4 19V21" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2V4M12 20V22M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M2 12H4M20 12H22M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" />
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'home',     Icon: IconHome,     key: 'nsHome' },
  { id: 'discover', Icon: IconDiscover, key: 'nsDiscover' },
  { id: 'messages', Icon: IconMessages, key: 'nsMessages' },
  { id: 'profile',  Icon: IconProfile,  key: 'nsProfile' },
  { id: 'settings', Icon: IconSettings, key: 'nsSettings' },
]

// ── Toggle switch ────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  const s = {
    track: {
      width: 32,
      height: 18,
      borderRadius: 9,
      background: on ? C.green : '#D4CFC7',
      position: 'relative',
      cursor: 'pointer',
      transition: 'background 0.2s',
      flexShrink: 0,
    },
    thumb: {
      position: 'absolute',
      top: 2,
      left: on ? 14 : 2,
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: C.white,
      transition: 'left 0.2s',
      boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
    },
  }
  return (
    <div style={s.track} onClick={onChange} role="switch" aria-checked={on}>
      <div style={s.thumb} />
    </div>
  )
}

// ── Section title ────────────────────────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textHint, marginBottom: 12 }}>
      {children}
    </div>
  )
}

// ── Feed card ────────────────────────────────────────────────────────────────
function FeedCard({ card, t, onConnect }) {
  const [hovered, setHovered] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleConnect = async () => {
    if (connected || busy) return
    setBusy(true)
    await onConnect(card.id)
    setConnected(true)
    setBusy(false)
  }

  const s = {
    card: {
      background: C.white,
      borderRadius: 14,
      border: `0.5px solid ${hovered ? '#C8BFB0' : C.sandBorder}`,
      padding: 20,
      transition: 'border-color 0.15s',
    },
    header: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: '50%',
      background: card.avatarBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 15,
      fontWeight: 600,
      color: C.white,
      flexShrink: 0,
    },
    nameBlock: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: 500, color: C.textPrimary, lineHeight: 1.3 },
    location: { fontSize: 12, color: C.textFaint, marginTop: 2 },
    matchBlock: { textAlign: 'right', flexShrink: 0 },
    matchPct: { fontSize: 18, fontWeight: 500, color: C.greenDark, lineHeight: 1 },
    matchBar: { width: 72, height: 4, background: C.sandBorder, borderRadius: 2, marginTop: 5 },
    matchFill: { height: 4, background: C.green, borderRadius: 2, width: `${card.match}%` },
    whyLabel: {
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: C.textHint,
      marginBottom: 5,
    },
    whyText: { fontSize: 13, color: C.textMuted, lineHeight: 1.5, marginBottom: 12 },
    tags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
    tag: (shared) => ({
      padding: '4px 10px',
      borderRadius: 20,
      fontSize: 12,
      background: shared ? C.greenBg : C.sandMid,
      color: shared ? C.greenDark : C.textMuted,
      border: `0.5px solid ${shared ? C.greenBorder : '#D4CFC7'}`,
    }),
    actions: { display: 'flex', gap: 8 },
    btnConnect: {
      flex: 1,
      padding: '9px 0',
      background: connected ? C.greenDark : C.navy,
      color: '#C8BFB0',
      border: 'none',
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 500,
      cursor: connected || busy ? 'default' : 'pointer',
      transition: 'background 0.15s',
      opacity: busy ? 0.7 : 1,
    },
    btnSave: {
      padding: '9px 18px',
      background: 'transparent',
      border: `0.5px solid #D4CFC7`,
      borderRadius: 9,
      fontSize: 13,
      color: C.textFaint,
      cursor: 'pointer',
    },
  }

  return (
    <div
      style={s.card}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={s.header}>
        <div style={s.avatar}>{card.initials}</div>
        <div style={s.nameBlock}>
          <div style={s.name}>{card.name}</div>
          {card.location && <div style={s.location}>{card.location}</div>}
        </div>
        <div style={s.matchBlock}>
          <div style={s.matchPct}>{card.match}%</div>
          <div style={s.matchBar}><div style={s.matchFill} /></div>
        </div>
      </div>

      {card.why && (
        <>
          <div style={s.whyLabel}>{t.nsWhyYouMatch}</div>
          <div style={s.whyText}>{card.why}</div>
        </>
      )}

      {card.tags.length > 0 && (
        <div style={s.tags}>
          {card.tags.map((tag, i) => (
            <span key={i} style={s.tag(tag.shared)}>{tag.label}</span>
          ))}
        </div>
      )}

      <div style={s.actions}>
        <button style={s.btnConnect} onClick={handleConnect} disabled={connected || busy}>
          {t.nsConnect}
        </button>
        <button style={s.btnSave}>{t.nsSave}</button>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function NewStyle({ lang = 'da' }) {
  const t = getTranslations(lang)

  const [feedCards, setFeedCards]     = useState(SAMPLE_FEED_CARDS)
  const [bestMatches, setBestMatches] = useState(SAMPLE_BEST_MATCHES)
  const [trending, setTrending]       = useState(SAMPLE_TRENDING)
  const [page, setPage]               = useState(1)
  const [activeNav, setActiveNav]     = useState('discover')
  const [toggles, setToggles]         = useState({
    profileVisibility: true,
    showLocation: false,
    matchingActive: true,
  })

  useEffect(() => {
    Promise.all([
      apiGetDiscovery(),
      apiFetchFriendSuggestions(),
      apiGetTrendingTags(),
    ]).then(([discovery, suggestions, tags]) => {
      const items = discovery?.suggestions || (Array.isArray(discovery) ? discovery : null)
      if (items?.length) {
        setFeedCards(items.slice(0, 6).map(mapDiscoveryToCard))
      }
      if (Array.isArray(suggestions) && suggestions.length) {
        setBestMatches(suggestions.slice(0, 3).map(mapSuggestionToMatch))
      }
      if (Array.isArray(tags) && tags.length) {
        setTrending(tags.slice(0, 3).map((item, i) => ({
          icon: ['🍺', '🍣', '☕'][i] || '🏷️',
          label: item.tag || item.name || '',
          count: Number(item.count) || 0,
        })))
      }
    })
  }, [])

  const totalPages  = Math.max(1, Math.ceil(feedCards.length / CARDS_PER_PAGE))
  const visibleCards = feedCards.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE)

  const showingText = (t.nsShowingOf || 'Showing {n} of {total}')
    .replace('{n}', Math.min(page * CARDS_PER_PAGE, feedCards.length))
    .replace('{total}', TOTAL_MATCHES)

  const handleConnect = async (cardId) => {
    await apiSendFriendRequest(cardId).catch(() => {})
  }

  const togglePrivacy = (key) => setToggles(prev => ({ ...prev, [key]: !prev[key] }))

  // ── styles ────────────────────────────────────────────────────────────────
  const s = {
    root: {
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: 400,
    },

    // Left sidebar
    sidebar: {
      width: 200,
      flexShrink: 0,
      background: C.navy,
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 0',
    },
    logo: {
      fontFamily: "'Playfair Display', serif",
      fontSize: 22,
      color: '#C8BFB0',
      padding: '0 20px',
      marginBottom: 32,
      letterSpacing: '-0.01em',
    },
    logoAccent: { color: C.green },
    nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' },
    navItem: (active, hovered) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      borderRadius: 9,
      fontSize: 14,
      cursor: 'pointer',
      background: active ? 'rgba(107,184,158,0.15)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
      color: active ? C.green : hovered ? '#C8BFB0' : '#7A8F9E',
      transition: 'background 0.12s, color 0.12s',
      userSelect: 'none',
    }),
    privacyBadge: {
      margin: '20px 16px 0',
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      background: '#1E3828',
      borderRadius: 20,
      padding: '6px 11px',
    },
    privacyDot: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: C.green,
      flexShrink: 0,
    },
    privacyLabel: { fontSize: 12, color: '#8FB8A2', lineHeight: 1.3 },

    // Center feed
    feed: {
      flex: 1,
      background: C.sand,
      overflowY: 'auto',
      padding: '28px 24px',
    },
    feedHeader: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 22,
    },
    feedTitle: {
      fontFamily: "'Playfair Display', serif",
      fontSize: 20,
      color: C.textPrimary,
      marginBottom: 4,
    },
    feedSubtitle: { fontSize: 13, color: C.textFaint },
    pagination: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
    pageBtn: (disabled) => ({
      width: 28,
      height: 28,
      border: `0.5px solid #D4CFC7`,
      borderRadius: 7,
      background: C.white,
      color: disabled ? '#D4CFC7' : C.textMuted,
      fontSize: 14,
      cursor: disabled ? 'default' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    }),
    pageLabel: { fontSize: 13, color: C.textMuted, minWidth: 32, textAlign: 'center' },

    cards: { display: 'flex', flexDirection: 'column', gap: 14 },

    divider: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: '22px 0',
    },
    dividerLine: { flex: 1, height: '0.5px', background: C.sandBorder },
    dividerLabel: { fontSize: 12, color: C.textHint, whiteSpace: 'nowrap' },

    // Right sidebar
    right: {
      width: 232,
      flexShrink: 0,
      background: C.white,
      borderLeft: `0.5px solid ${C.sandBorder}`,
      overflowY: 'auto',
      padding: '24px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
    },

    // Best matches
    matchRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      borderBottom: `0.5px solid #F0ECE5`,
    },
    matchAvatar: (bg) => ({
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 600,
      color: C.white,
      flexShrink: 0,
    }),
    matchName: { fontSize: 13, fontWeight: 500, color: C.textPrimary, lineHeight: 1.2 },
    matchTags: { fontSize: 11, color: C.textFaint },
    matchPct: { fontSize: 13, fontWeight: 500, color: C.greenDark, marginLeft: 'auto', flexShrink: 0 },

    // Trending
    trendRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '9px 0',
      borderBottom: `0.5px solid #F0ECE5`,
    },
    trendIcon: { fontSize: 15, flexShrink: 0 },
    trendLabel: { fontSize: 12, color: C.textMuted, flex: 1, lineHeight: 1.3 },
    trendCount: { fontSize: 12, color: C.textHint, flexShrink: 0 },

    // Suggested panel
    suggestedPanel: {
      background: C.greenPanel,
      border: `0.5px solid #C8DDCF`,
      borderRadius: 10,
      padding: 13,
    },
    suggestedLabel: { fontSize: 11, fontWeight: 500, color: C.greenDark, marginBottom: 6 },
    suggestedText: { fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 },
    suggestedFooter: { fontSize: 11, fontStyle: 'italic', color: C.textFaint },

    // Privacy panel
    privacyPanel: {
      background: C.sand,
      border: `0.5px solid ${C.sandBorder}`,
      borderRadius: 10,
      padding: 13,
    },
    privacyRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '7px 0',
    },
    privacyRowLabel: { fontSize: 12, color: C.textMuted },
    visibilityRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 10,
      marginTop: 4,
      borderTop: `0.5px solid ${C.sandBorder}`,
    },
    visibilityLabel: { fontSize: 12, color: C.textFaint },
    visibilityValue: { fontSize: 12, fontWeight: 700, color: C.greenDark },
  }

  return (
    <div style={s.root}>
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          fell<span style={s.logoAccent}>i</span>s
        </div>

        <nav style={s.nav}>
          {NAV_ITEMS.map(({ id, Icon, key }) => (
            <NavItem
              key={id}
              id={id}
              active={activeNav === id}
              label={t[key] || key}
              Icon={Icon}
              onClick={() => setActiveNav(id)}
              s={s}
            />
          ))}
        </nav>

        <div style={s.privacyBadge}>
          <div style={s.privacyDot} />
          <span style={s.privacyLabel}>{t.nsDataStaysInEurope}</span>
        </div>
      </aside>

      {/* ── Center feed ───────────────────────────────────────────────────── */}
      <main style={s.feed}>
        <div style={s.feedHeader}>
          <div>
            <div style={s.feedTitle}>{t.nsYourMatches}</div>
            <div style={s.feedSubtitle}>
              {showingText} — {t.nsBasedOnTaste}
            </div>
          </div>
          <div style={s.pagination}>
            <button
              style={s.pageBtn(page <= 1)}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous"
            >
              ‹
            </button>
            <span style={s.pageLabel}>{page} / {totalPages}</span>
            <button
              style={s.pageBtn(page >= totalPages)}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next"
            >
              ›
            </button>
          </div>
        </div>

        <div style={s.cards}>
          {visibleCards.slice(0, 1).map(card => (
            <FeedCard key={card.id} card={card} t={t} onConnect={handleConnect} />
          ))}

          {visibleCards.length > 1 && (
            <>
              <div style={s.divider}>
                <div style={s.dividerLine} />
                <span style={s.dividerLabel}>{t.nsDividerLabel}</span>
                <div style={s.dividerLine} />
              </div>
              {visibleCards.slice(1).map(card => (
                <FeedCard key={card.id} card={card} t={t} onConnect={handleConnect} />
              ))}
            </>
          )}
        </div>
      </main>

      {/* ── Right sidebar ─────────────────────────────────────────────────── */}
      <aside style={s.right}>

        {/* Best matches */}
        <section>
          <SectionTitle>{t.nsBestMatches}</SectionTitle>
          {bestMatches.map((m, i) => (
            <div key={i} style={{ ...s.matchRow, ...(i === bestMatches.length - 1 ? { borderBottom: 'none' } : {}) }}>
              <div style={s.matchAvatar(m.bg)}>{m.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.matchName}>{m.name}</div>
                {m.tags && <div style={s.matchTags}>{m.tags}</div>}
              </div>
              <div style={s.matchPct}>{m.pct}%</div>
            </div>
          ))}
        </section>

        {/* Trending */}
        <section>
          <SectionTitle>{t.nsTrendingInYourTaste}</SectionTitle>
          {trending.map((item, i) => (
            <div key={i} style={{ ...s.trendRow, ...(i === trending.length - 1 ? { borderBottom: 'none' } : {}) }}>
              <span style={s.trendIcon}>{item.icon}</span>
              <span style={s.trendLabel}>{item.label}</span>
              <span style={s.trendCount}>+{item.count}</span>
            </div>
          ))}
        </section>

        {/* Suggested for you */}
        <section>
          <SectionTitle>{t.nsSuggestedForYou}</SectionTitle>
          <div style={s.suggestedPanel}>
            <div style={s.suggestedLabel}>{t.nsSuggestedForYou}</div>
            <div style={s.suggestedText}>{t.nsSuggestedText}</div>
            <div style={s.suggestedFooter}>{t.nsBasedOnTasteProfile}</div>
          </div>
        </section>

        {/* Privacy controls */}
        <section>
          <SectionTitle>{t.nsPrivacyControls}</SectionTitle>
          <div style={s.privacyPanel}>
            {[
              { key: 'profileVisibility', label: t.nsProfileVisibility },
              { key: 'showLocation',      label: t.nsShowLocation },
              { key: 'matchingActive',    label: t.nsMatchingActive },
            ].map(({ key, label }) => (
              <div key={key} style={s.privacyRow}>
                <span style={s.privacyRowLabel}>{label}</span>
                <Toggle on={toggles[key]} onChange={() => togglePrivacy(key)} />
              </div>
            ))}
            <div style={s.visibilityRow}>
              <span style={s.visibilityLabel}>{t.nsVisibility}:</span>
              <span style={s.visibilityValue}>{t.nsConnectionsOnly}</span>
            </div>
          </div>
        </section>

      </aside>
    </div>
  )
}

// ── NavItem extracted to avoid stale closure issues ──────────────────────────
function NavItem({ id, active, label, Icon, onClick, s }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={s.navItem(active, hovered)}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon />
      <span>{label}</span>
    </div>
  )
}
