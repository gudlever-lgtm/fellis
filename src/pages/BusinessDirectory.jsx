import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGetBusinesses, apiGetSuggestedBusinesses } from '../api.js'
import { PT } from '../data.js'
import BusinessCard from '../components/BusinessCard.jsx'

const CATEGORIES = [
  'IT & Software', 'Design', 'Detailhandel', 'Restauration', 'Sundhed',
  'Finans', 'Uddannelse', 'Ejendom', 'Transport', 'Marketing',
]

export default function BusinessDirectory({ lang, t, onViewProfile }) {
  const [businesses, setBusinesses] = useState([])
  const [suggested, setSuggested] = useState([])
  const [loading, setLoading] = useState(true)
  const [suggestedLoading, setSuggestedLoading] = useState(true)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const searchTimer = useRef(null)
  const LIMIT = 20

  const fetchBusinesses = useCallback(async (newQ, newCat, newOffset, append = false) => {
    setLoading(true)
    const data = await apiGetBusinesses({ q: newQ, category: newCat, limit: LIMIT, offset: newOffset })
    if (data?.businesses) {
      setBusinesses(prev => append ? [...prev, ...data.businesses] : data.businesses)
      setHasMore(data.businesses.length === LIMIT)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchBusinesses('', '', 0, false)
    apiGetSuggestedBusinesses().then(data => {
      if (Array.isArray(data)) setSuggested(data.slice(0, 6))
      setSuggestedLoading(false)
    }).catch(() => setSuggestedLoading(false))
  }, [fetchBusinesses])

  const handleSearch = (value) => {
    setQ(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setOffset(0)
      fetchBusinesses(value, category, 0, false)
    }, 350)
  }

  const handleCategory = (cat) => {
    const next = cat === category ? '' : cat
    setCategory(next)
    setOffset(0)
    fetchBusinesses(q, next, 0, false)
  }

  const handleLoadMore = () => {
    const next = offset + LIMIT
    setOffset(next)
    fetchBusinesses(q, category, next, true)
  }

  const s = {
    wrap: { maxWidth: 900, margin: localStorage.getItem('fellis_design') === 'new' ? 0 : '0 auto', padding: '0 0 40px' },
    header: { marginBottom: 20 },
    title: { fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: 0 },
    subtitle: { fontSize: 14, color: '#888', marginTop: 4 },
    searchRow: { display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' },
    searchInput: {
      flex: 1, padding: '10px 14px', borderRadius: 10,
      border: '1px solid #E0DDD8', fontSize: 14, outline: 'none',
    },
    catWrap: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
    catBtn: (active) => ({
      fontSize: 12, fontWeight: 600,
      padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
      border: active ? '1.5px solid #4338CA' : '1.5px solid #E0DDD8',
      background: active ? '#EEF2FF' : '#fafafa',
      color: active ? '#4338CA' : '#666',
    }),
    section: { marginBottom: 28 },
    sectionTitle: { fontSize: 15, fontWeight: 700, color: '#333', marginBottom: 12 },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: 12,
    },
    empty: { textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 },
    loadMore: {
      display: 'block', margin: '20px auto 0',
      padding: '10px 28px', borderRadius: 10,
      border: '1.5px solid #4338CA', background: '#EEF2FF',
      color: '#4338CA', fontWeight: 700, fontSize: 14, cursor: 'pointer',
    },
    spinner: { textAlign: 'center', padding: '32px 0', color: '#aaa', fontSize: 14 },
  }

  return (
    <div style={s.wrap}>
      <div className="p-card" style={{ padding: '20px 20px 16px', marginBottom: 16 }}>
        <div style={s.header}>
          <h2 style={s.title}>🏢 {t.businessDirectory}</h2>
          <p style={s.subtitle}>{PT[lang].discoverAndFollowBusinessesOnFellisEu}</p>
        </div>

        {/* Search */}
        <div style={s.searchRow}>
          <input
            type="search"
            value={q}
            onChange={e => handleSearch(e.target.value)}
            placeholder={t.searchBusinesses}
            style={s.searchInput}
          />
        </div>

        {/* Category filter */}
        <div style={s.catWrap}>
          {CATEGORIES.map(cat => (
            <button key={cat} style={s.catBtn(category === cat)} onClick={() => handleCategory(cat)}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Suggested section — only when no active filter */}
      {!q && !category && suggested.length > 0 && (
        <div className="p-card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={s.sectionTitle}>✨ {t.suggestedBusinesses}</div>
          {suggestedLoading ? (
            <div style={s.spinner}>…</div>
          ) : (
            <div style={s.grid}>
              {suggested.map(biz => (
                <BusinessCard key={biz.id} biz={biz} lang={lang} t={t} onViewProfile={onViewProfile} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* All / filtered results */}
      <div className="p-card" style={{ padding: '16px 20px' }}>
        <div style={s.sectionTitle}>
          {q || category
            ? (PT[lang].results)
            : (PT[lang].allBusinesses)}
        </div>
        {loading && businesses.length === 0 ? (
          <div style={s.spinner}>…</div>
        ) : businesses.length === 0 ? (
          <div style={s.empty}>{t.noBusinessesFound}</div>
        ) : (
          <>
            <div style={s.grid}>
              {businesses.map(biz => (
                <BusinessCard key={biz.id} biz={biz} lang={lang} t={t} onViewProfile={onViewProfile} />
              ))}
            </div>
            {hasMore && (
              <button style={s.loadMore} onClick={handleLoadMore} disabled={loading}>
                {loading ? '…' : (PT[lang].reelsLoadMore)}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
