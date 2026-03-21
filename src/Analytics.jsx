import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import { apiGetAnalytics } from './api.js'

// ── Deterministic pseudo-random (seeded) ──
function seed(s) {
  const x = Math.sin(s + 1) * 10000
  return x - Math.floor(x)
}

// ── Mock data generators ──
function generateDays(days, base, amplitude, noiseScale, seedOffset) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - i))
    const wave = Math.sin(i * 0.3) * amplitude
    const noise = (seed(i * 7 + seedOffset) - 0.5) * noiseScale
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.max(0, Math.round(base + wave + noise)),
    }
  })
}

function generateFollowerGrowth(days) {
  let count = 847
  return Array.from({ length: days }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - i))
    const daily = Math.round((seed(i * 13 + 3) - 0.35) * 18)
    count = Math.max(800, count + daily)
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: count,
    }
  })
}

function generateHeatmap() {
  const peakHours = [9, 10, 11, 12, 13, 17, 18, 19, 20, 21]
  const peakDays = [0, 1, 2, 3, 4] // Mon–Fri
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const dayF = peakDays.includes(d) ? 1 : 0.35
      const hourF = peakHours.includes(h) ? 1 : 0.15
      return Math.max(0, Math.round(dayF * hourF * 85 + seed(d * 24 + h) * 25))
    })
  )
}

// ── Loading fallback for top posts (while API data loads) ──
const TOP_POSTS_LOADING = [
  { text: '…', reach: null, likes: null, comments: null, shares: null },
  { text: '…', reach: null, likes: null, comments: null, shares: null },
  { text: '…', reach: null, likes: null, comments: null, shares: null },
]

// ── SVG Line Chart ──
function LineChart({ data, color = '#2D6A4F', h = 90 }) {
  if (!data || data.length < 2) return null
  const vals = data.map(d => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 400

  const pts = data.map((d, i) => [
    (i / (data.length - 1)) * W,
    h - ((d.value - min) / range) * (h - 20) - 10,
  ])
  const ptStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaStr = `0,${h} ${ptStr} ${W},${h}`

  const step = Math.max(1, Math.ceil(data.length / 6))

  return (
    <div style={{ position: 'relative', paddingLeft: 28 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, fontSize: 10, color: '#aaa', lineHeight: 1 }}>{max.toLocaleString()}</div>
      <div style={{ position: 'absolute', bottom: 20, left: 0, fontSize: 10, color: '#aaa', lineHeight: 1 }}>{min.toLocaleString()}</div>
      <svg viewBox={`0 0 ${W} ${h + 22}`} style={{ width: '100%', height: h + 22 }}>
        {[0.25, 0.5, 0.75].map(t => {
          const y = h - t * (h - 20) - 10
          return <line key={t} x1={0} y1={y} x2={W} y2={y} stroke="#f0f0f0" strokeWidth="1" />
        })}
        <polygon points={areaStr} fill={color} fillOpacity="0.08" />
        <polyline points={ptStr} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) =>
          i % step === 0 || i === data.length - 1
            ? <circle key={i} cx={x} cy={y} r="3" fill={color} />
            : null
        )}
        {data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d, _, arr) => {
          const idx = data.indexOf(d)
          const x = (idx / (data.length - 1)) * W
          return (
            <text key={idx} x={x} y={h + 18} textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'} fontSize="9" fill="#aaa">
              {d.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ── SVG Dual Line Chart (for competitor view) ──
function DualLineChart({ data, color1 = '#2D6A4F', color2 = '#E07A5F', h = 90 }) {
  if (!data || data.length < 2) return null
  const allVals = data.flatMap(d => [d.you, d.industry])
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const range = max - min || 1
  const W = 400

  const line = (key) => data.map((d, i) => [
    (i / (data.length - 1)) * W,
    h - ((d[key] - min) / range) * (h - 20) - 10,
  ]).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%', height: h }}>
      {[0.25, 0.5, 0.75].map(t => {
        const y = h - t * (h - 20) - 10
        return <line key={t} x1={0} y1={y} x2={W} y2={y} stroke="#f0f0f0" strokeWidth="1" />
      })}
      <polyline points={line('you')} fill="none" stroke={color1} strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points={line('industry')} fill="none" stroke={color2} strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
    </svg>
  )
}

// ── SVG Bar Chart ──
function BarChart({ data, color = '#2D6A4F', h = 90 }) {
  if (!data || !data.length) return null
  const max = Math.max(...data.map(d => d.value))
  const W = 400
  const barW = (W / data.length) * 0.6
  const gap = W / data.length

  return (
    <svg viewBox={`0 0 ${W} ${h + 22}`} style={{ width: '100%', height: h + 22 }}>
      {data.map((d, i) => {
        const bh = Math.max(4, (d.value / max) * (h - 16))
        const x = i * gap + (gap - barW) / 2
        const y = h - bh
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx="3" fill={color} fillOpacity="0.82" />
            <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="9" fill={color} fontWeight="600">
              {d.value.toLocaleString()}
            </text>
            <text x={x + barW / 2} y={h + 16} textAnchor="middle" fontSize="9" fill="#888">
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Horizontal Bar Chart ──
function HBarChart({ data, color = '#2D6A4F', valueKey = 'pct', suffix = '' }) {
  const max = Math.max(...data.map(d => d[valueKey] ?? d.value ?? d.pct))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const val = d[valueKey] ?? d.value ?? d.pct
        const pct = (val / max) * 100
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 120, fontSize: 12, color: '#555', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.label}
            </div>
            <div style={{ flex: 1, height: 20, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: '#333', fontWeight: 600, minWidth: 44, textAlign: 'right' }}>
              {typeof val === 'number' && val > 999 ? val.toLocaleString() : val}{suffix}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Posting Heatmap ──
function PostingHeatmap({ data, lang }) {
  const days = lang === 'da'
    ? ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const max = Math.max(...data.flat(), 1)

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `36px repeat(24, minmax(16px, 1fr))`, gap: 2, minWidth: 540 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ fontSize: 9, textAlign: 'center', color: '#aaa', lineHeight: 1.4 }}>{h}</div>
        ))}
        {data.map((row, di) => (
          <Fragment key={di}>
            <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', color: '#666', fontWeight: 500 }}>{days[di]}</div>
            {row.map((val, hi) => {
              const intensity = val / max
              return (
                <div
                  key={hi}
                  title={`${val} engagements at ${hi}:00`}
                  style={{
                    height: 18,
                    borderRadius: 2,
                    background: intensity > 0.04
                      ? `rgba(45, 106, 79, ${0.12 + intensity * 0.88})`
                      : '#f2f2f2',
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: '#888' }}>
        <span>{lang === 'da' ? 'Lavt' : 'Low'}</span>
        {[0.1, 0.3, 0.55, 0.8, 1].map(v => (
          <div key={v} style={{ width: 14, height: 14, borderRadius: 2, background: `rgba(45,106,79,${0.12 + v * 0.88})` }} />
        ))}
        <span>{lang === 'da' ? 'Højt' : 'High'}</span>
      </div>
    </div>
  )
}

// ── Funnel Chart ──
function FunnelChart({ data }) {
  const max = data[0]?.value || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {data.map((item, i) => {
        const pct = (item.value / max) * 100
        return (
          <Fragment key={i}>
            <div style={{
              width: `${pct}%`,
              minWidth: 160,
              background: `rgba(45, 106, 79, ${1 - i * 0.28})`,
              color: '#fff',
              borderRadius: i === 0 ? '8px 8px 0 0' : i === data.length - 1 ? '0 0 8px 8px' : '2px',
              padding: '12px 16px',
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 600,
              transition: 'width 0.4s ease',
            }}>
              {item.label}: {item.value.toLocaleString()}
            </div>
            {i < data.length - 1 && (
              <div style={{ fontSize: 11, color: '#888', padding: '3px 0' }}>
                ↓ {Math.round(data[i + 1].value / item.value * 100)}% {data[0].label === 'Profile views' ? 'conversion' : ''}
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

// ── PlanGate — blurs content for non-Pro users ──
export function PlanGate({ plan, currentPlan, children, onUpgrade, lang }) {
  if (currentPlan === plan) return children

  const label = lang === 'da' ? 'Opgrader til Business Pro' : 'Upgrade to Business Pro'

  return (
    <div style={{ position: 'relative', minHeight: 80 }}>
      <div style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.7 }}>
        {children}
      </div>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.65)',
        borderRadius: 8, gap: 10,
      }}>
        <div style={{ fontSize: 28 }}>🔒</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#2D3436', textAlign: 'center', padding: '0 16px' }}>{label}</div>
        <button
          onClick={onUpgrade}
          style={{
            background: '#2D6A4F', color: '#fff', border: 'none',
            borderRadius: 20, padding: '10px 22px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ⚡ {label}
        </button>
      </div>
    </div>
  )
}

// ── Upgrade Modal ──
function UpgradeModal({ lang, onUpgrade, onClose }) {
  const t = lang === 'da' ? {
    title: 'Opgrader til Business Pro',
    subtitle: 'Lås op for avancerede analyser og indsigter',
    features: [
      '📊 Målgruppeanalyse og demografier',
      '⏰ Heatmap: bedste tidspunkt at opslå',
      '🎯 Indholdsperformance pr. opslags-type',
      '🔗 Forbindelsestragt og lead-indsigter',
      '📈 Anonymiseret konkurrentbenchmarking',
      '📥 Eksporter data som CSV eller PDF',
    ],
    btn: 'Aktiver Business Pro (Demo)',
    cancel: 'Annuller',
    note: 'Ingen rigtig betaling kræves — dette er en demo',
  } : {
    title: 'Upgrade to Business Pro',
    subtitle: 'Unlock advanced analytics and insights',
    features: [
      '📊 Audience insights & demographics',
      '⏰ Best time to post heatmap',
      '🎯 Content performance by post type',
      '🔗 Connection funnel & lead insights',
      '📈 Anonymized competitor benchmarking',
      '📥 Export data as CSV or PDF',
    ],
    btn: 'Activate Business Pro (Demo)',
    cancel: 'Cancel',
    note: 'No real payment required — this is a demo',
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="fb-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="fb-modal-header" style={{ background: 'linear-gradient(135deg, #2D6A4F, #40916C)' }}>
          <div className="fb-modal-logo" style={{ color: '#fff', fontFamily: "'Playfair Display', serif", letterSpacing: 0.5 }}>
            fellis.eu — Business Pro ⚡
          </div>
        </div>
        <div className="fb-modal-form">
          <h3 style={{ marginBottom: 4 }}>{t.title}</h3>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 18 }}>{t.subtitle}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
            {t.features.map((f, i) => (
              <div key={i} style={{ fontSize: 14, padding: '9px 14px', background: '#F0FAF4', borderRadius: 8, borderLeft: '3px solid #2D6A4F' }}>
                {f}
              </div>
            ))}
          </div>
          <button
            className="fb-login-submit"
            style={{ background: '#2D6A4F', width: '100%', marginBottom: 10 }}
            onClick={onUpgrade}
          >
            {t.btn}
          </button>
          <button className="fb-forgot" style={{ width: '100%', textAlign: 'center' }} onClick={onClose}>
            {t.cancel}
          </button>
          <p style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 10 }}>{t.note}</p>
        </div>
      </div>
    </div>
  )
}

// ── Date range selector ──
function DateRangeSelector({ value, onChange, lang }) {
  const opts = lang === 'da'
    ? [{ v: 7, l: '7 dage' }, { v: 30, l: '30 dage' }, { v: 90, l: '90 dage' }]
    : [{ v: 7, l: '7 days' }, { v: 30, l: '30 days' }, { v: 90, l: '90 days' }]
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: '#888', marginRight: 4 }}>{lang === 'da' ? 'Periode:' : 'Range:'}</span>
      {opts.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: '6px 16px', borderRadius: 20,
            border: value === o.v ? '2px solid #2D6A4F' : '1px solid #ddd',
            background: value === o.v ? '#F0FAF4' : '#fff',
            color: value === o.v ? '#2D6A4F' : '#666',
            fontWeight: value === o.v ? 700 : 400,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

// ── Stat card ──
function StatCard({ label, value, delta, color = '#2D6A4F' }) {
  return (
    <div style={{
      flex: 1, minWidth: 130,
      background: '#fff', borderRadius: 10, padding: '16px 18px',
      border: '1px solid #E8E4DF',
    }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      {delta !== undefined && (
        <div style={{ fontSize: 12, color: delta >= 0 ? '#27ae60' : '#e74c3c', marginTop: 4 }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
        </div>
      )}
    </div>
  )
}

// ── Post Insights Panel (inline on feed posts) ──
export function PostInsightsPanel({ post, lang, onClose }) {
  const reach = Math.round(post.likes * 28 + post.comments.length * 12 + 180 + seed((post.id || 1) * 3) * 120)
  const shares = Math.round(reach * 0.025)

  const t = lang === 'da' ? {
    title: 'Opslags-indsigt',
    reach: 'Rækkevidde (unikke visninger)',
    likes: 'Synes godt om',
    comments: 'Kommentarer',
    shares: 'Delinger',
    close: 'Luk',
    note: 'Estimeret rækkevidde baseret på engagement',
  } : {
    title: 'Post Insights',
    reach: 'Reach (unique views)',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    close: 'Close',
    note: 'Estimated reach based on engagement',
  }

  return (
    <div style={{
      background: '#F0FAF4', borderRadius: 10, padding: '14px 16px',
      border: '1px solid #b3dfc5', marginTop: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#2D6A4F' }}>📊 {t.title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        {[
          { label: t.reach, value: reach.toLocaleString(), icon: '👁' },
          { label: t.likes, value: post.likes, icon: '❤️' },
          { label: t.comments, value: post.comments.length, icon: '💬' },
          { label: t.shares, value: shares, icon: '↗' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center', padding: '10px 4px', background: '#fff', borderRadius: 8, border: '1px solid #E8E4DF' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2D6A4F' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>* {t.note}</p>
    </div>
  )
}

// ── Main Analytics Page ──
export default function AnalyticsPage({ lang, currentPlan, onUpgradePlan }) {
  const [dateRange, setDateRange] = useState(30)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [analyticsData, setAnalyticsData] = useState(null)

  // Fetch real analytics data from the server whenever the date range changes
  useEffect(() => {
    setAnalyticsData(null)
    apiGetAnalytics(dateRange).then(data => setAnalyticsData(data)).catch(() => {})
  }, [dateRange])

  // Fill sparse {date, count} API rows into a dense per-day array
  const fillDays = useCallback((rows, days) => {
    const map = {}
    ;(rows || []).forEach(r => { map[(r.date || '').slice(0, 10)] = Number(r.count) })
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i))
      return {
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: map[d.toISOString().slice(0, 10)] || 0,
      }
    })
  }, [])

  // Profile views: real API data (seeded fallback while loading)
  const profileViews = useMemo(
    () => analyticsData ? fillDays(analyticsData.views, dateRange) : generateDays(dateRange, 130, 45, 60, 1),
    [analyticsData, dateRange, fillDays]
  )

  // New connections per day: real API data (seeded fallback while loading)
  const connGrowth = useMemo(
    () => analyticsData ? fillDays(analyticsData.connections, dateRange) : generateDays(dateRange, 5, 2, 4, 7),
    [analyticsData, dateRange, fillDays]
  )

  // Engagement trend: real API data (seeded fallback while loading)
  const engRate = useMemo(
    () => analyticsData
      ? fillDays(analyticsData.engTrend, dateRange)
      : profileViews.map((pv, i) => ({ label: pv.label, value: parseFloat((3.5 + seed(i * 17 + 5) * 4).toFixed(1)) })),
    [analyticsData, dateRange, fillDays, profileViews]
  )


  // Heatmap: real API data when loaded; seeded fallback while loading
  const heatmapData = useMemo(
    () => analyticsData?.heatmap || generateHeatmap(),
    [analyticsData]
  )

  // Top posts: real API data when loaded; loading skeleton while fetching; empty state if no posts
  const topPostsData = useMemo(() => {
    if (analyticsData?.topPosts?.length) {
      // API returns {label, value} — label=post text, value=total engagement count
      return analyticsData.topPosts.map(p => ({ text: p.label, reach: p.value, likes: null, comments: null, shares: null }))
    }
    if (analyticsData) return [] // loaded, but user has no posts yet
    return TOP_POSTS_LOADING // skeleton while loading
  }, [analyticsData])

  // Funnel: real API data when available; null while loading
  const funnelData = useMemo(() => {
    const fv = analyticsData?.funnel
    if (!fv) return null
    return lang === 'da'
      ? [
          { label: 'Profilvisninger', value: fv.views },
          { label: 'Forbindelsesanmodninger', value: fv.requests },
          { label: 'Accepteret', value: fv.connections },
        ]
      : [
          { label: 'Profile views', value: fv.views },
          { label: 'Connection requests', value: fv.requests },
          { label: 'Accepted', value: fv.connections },
        ]
  }, [analyticsData, lang])

  // Post types: real API data (text vs. media); null = backend returned nothing yet
  const postTypeData = useMemo(() => {
    const pt = analyticsData?.postTypes
    if (pt && (pt.text + pt.media) > 0) {
      return [
        { label: lang === 'da' ? 'Tekst' : 'Text', value: pt.text },
        { label: lang === 'da' ? 'Medie' : 'Media', value: pt.media },
      ].filter(d => d.value > 0)
    }
    return null // no real data available yet
  }, [analyticsData, lang])

  // KPI aggregates from real data
  const totalViews = profileViews.reduce((s, d) => s + d.value, 0)
  const totalConns = connGrowth.reduce((s, d) => s + d.value, 0)
  const eng = analyticsData?.engagement
  const avgEngRate = eng
    ? (eng.posts > 0 ? ((eng.likes + eng.comments) / eng.posts).toFixed(1) : '0.0')
    : '–'

  const handleUpgrade = () => {
    onUpgradePlan('business_pro')
    setShowUpgrade(false)
  }

  const handleExportCSV = () => {
    const rows = [
      ['Date', 'Profile Views', 'New Connections'],
      ...profileViews.map((pv, i) => [pv.label, pv.value, connGrowth[i]?.value ?? '']),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fellis-analytics-${dateRange}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPDF = () => window.print()


  // Audience locations: real API data (friends' locations); fallback to demo
  const audienceLocations = useMemo(() => {
    if (analyticsData?.audienceLocations?.length) return analyticsData.audienceLocations
    return null
  }, [analyticsData])

  // Hashtag performance: real API data; fallback to demo while loading
  const hashtagData = useMemo(() => {
    if (analyticsData?.hashtagPerformance?.length) return analyticsData.hashtagPerformance
    return null
  }, [analyticsData])

  // Growth source: real invite vs. organic connection data
  const growthSourceData = useMemo(() => {
    const gs = analyticsData?.growthSource
    if (gs && gs.total > 0) {
      const items = []
      if (gs.organic > 0) items.push({ label: lang === 'da' ? 'Organisk' : 'Organic', value: gs.organic, pct: Math.round((gs.organic / gs.total) * 100) })
      if (gs.viaInvite > 0) items.push({ label: lang === 'da' ? 'Via invitationer' : 'Via invites', value: gs.viaInvite, pct: Math.round((gs.viaInvite / gs.total) * 100) })
      if (items.length) return items
    }
    return null
  }, [analyticsData, lang])

  // Industry distribution of connections (real DB data)
  const industryDistData = useMemo(() => {
    if (analyticsData?.industryDist?.length) return analyticsData.industryDist
    return null
  }, [analyticsData])

  // Seniority distribution of connections (real DB data)
  const seniorityDistData = useMemo(() => {
    if (analyticsData?.seniorityDist?.length) return analyticsData.seniorityDist
    return null
  }, [analyticsData])

  // Posts driving profile visits (real DB data — source_post_id tracking)
  const postsDrivingVisitsData = useMemo(() => {
    if (analyticsData?.postsDrivingVisits?.length) return analyticsData.postsDrivingVisits
    return null
  }, [analyticsData])

  // Competitor benchmarking: platform avg new connections per user per day
  const compData = useMemo(() => {
    const platformAvg = analyticsData?.platformAvgConnGrowth
    if (platformAvg?.length) {
      // Both arrays cover the same date range with the same number of days — align by position
      return connGrowth.map((fg, i) => ({
        label: fg.label,
        you: fg.value,
        industry: platformAvg[i]?.value ?? 0,
      }))
    }
    // No platform avg yet — single-line chart only
    return connGrowth.map(fg => ({ label: fg.label, you: fg.value, industry: null }))
  }, [analyticsData, connGrowth])

  const card = {
    background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16,
    border: '1px solid #E8E4DF',
  }
  const sTitle = { fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#2D3436' }
  const sub = { fontSize: 12, color: '#888', marginBottom: 16 }

  const isPro = currentPlan === 'business_pro'

  const t = lang === 'da' ? {
    title: 'Analyser',
    subtitle: 'Business-analyser for din konto',
    planFree: 'Business',
    planPro: 'Business Pro ⚡',
    upgradeBanner: 'Du er på gratis Business-niveau. Opgrader til Pro for avancerede indsigter.',
    upgradeBtn: 'Opgrader nu',
    profileViews: 'Profilvisninger',
    pvDesc: 'Unikke profilvisninger i perioden',
    connGrowth: 'Nye forbindelser',
    connGrowthDesc: 'Nye forbindelser accepteret i perioden',
    topPosts: 'Top 5 opslag',
    tpDesc: 'Sorteret efter samlet engagement',
    reach: 'engagement',
    noPostsYet: 'Ingen opslag endnu',
    audience: 'Målgruppeanalyse',
    industryDist: 'Branchefordeling',
    topLoc: 'Top 5 lokationer',
    seniority: 'Anciennitetsfordeling',
    bestTime: 'Bedste tidspunkt at opslå',
    bestTimeDesc: 'Heatmap — mørkere felt = mere engagement',
    growthSrc: 'Vækstkilder',
    contentPerf: 'Indholdsperformance',
    postType: 'Sammenligning af opslags-typer (engagement)',
    hashtagPerf: 'Emne / hashtag-performance',
    engTrend: 'Engagementstrend over tid',
    funnel: 'Forbindelsestragt',
    funnelDesc: 'Fra profilvisning til accepteret forbindelsesanmodning',
    postsDriving: 'Opslag der driver profilbesøg',
    competitor: 'Konkurrentbenchmarking',
    compFollower: 'Forbindelsesvækst — dig vs. platformsgennemsnit',
    compNote: '* Platformslinjen er et gennemsnit af nye forbindelser pr. bruger pr. dag på fellis.eu.',
    youLabel: 'Dig',
    industryLabel: 'Platforms-gns.',
    exportTitle: 'Eksporter data',
    exportCSV: 'Download CSV',
    exportPDF: 'Download PDF',
    loading: 'Henter…',
    noDataYet: 'Ingen data endnu — udfyld din profil og opret forbindelser for at se indsigter her.',
    avgEng: 'Gns. engagement/opslag',
    newConns: 'nye forbindelser',
  } : {
    title: 'Analytics',
    subtitle: 'Business analytics for your account',
    planFree: 'Business',
    planPro: 'Business Pro ⚡',
    upgradeBanner: 'You are on the free Business tier. Upgrade to Pro to unlock advanced insights.',
    upgradeBtn: 'Upgrade now',
    profileViews: 'Profile Views',
    pvDesc: 'Unique profile views in the selected period',
    connGrowth: 'New Connections',
    connGrowthDesc: 'New connections accepted in the period',
    topPosts: 'Top 5 Posts',
    tpDesc: 'Sorted by total engagement',
    reach: 'engagement',
    noPostsYet: 'No posts yet',
    audience: 'Audience Insights',
    industryDist: 'Industry Distribution',
    topLoc: 'Top 5 Locations',
    seniority: 'Seniority Distribution',
    bestTime: 'Best Time to Post',
    bestTimeDesc: 'Heatmap — darker = more engagement from your audience',
    growthSrc: 'Audience Growth Source',
    contentPerf: 'Content Performance',
    postType: 'Post type comparison (engagement)',
    hashtagPerf: 'Topic / hashtag performance',
    engTrend: 'Engagement trend over time',
    funnel: 'Connection Funnel',
    funnelDesc: 'From profile view to accepted connection request',
    postsDriving: 'Posts driving profile visits',
    competitor: 'Competitor Benchmarking',
    compFollower: 'Connection growth — you vs. platform average',
    compNote: '* The platform line is the average new connections per user per day on fellis.eu.',
    youLabel: 'You',
    industryLabel: 'Platform avg.',
    exportTitle: 'Export Data',
    exportCSV: 'Download CSV',
    exportPDF: 'Download PDF',
    loading: 'Loading…',
    noDataYet: 'No data yet — fill in your profile and make connections to see insights here.',
    avgEng: 'Avg. engagement/post',
    newConns: 'new connections',
  }

  return (
    <div className="p-profile" style={{ maxWidth: 720 }}>
      {showUpgrade && <UpgradeModal lang={lang} onUpgrade={handleUpgrade} onClose={() => setShowUpgrade(false)} />}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t.title}</h2>
          <p style={{ fontSize: 14, color: '#888' }}>{t.subtitle}</p>
        </div>
        <span style={{
          padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700,
          background: isPro ? '#2D6A4F' : '#F0FAF4',
          color: isPro ? '#fff' : '#2D6A4F',
          border: isPro ? 'none' : '1.5px solid #2D6A4F',
          alignSelf: 'flex-start',
        }}>
          {isPro ? t.planPro : t.planFree}
        </span>
      </div>

      {/* ── Upgrade banner (free tier) ── */}
      {!isPro && (
        <div style={{
          background: 'linear-gradient(135deg, #F0FAF4, #E8F5E9)',
          border: '1px solid #b3dfc5', borderRadius: 12, padding: '14px 18px',
          marginBottom: 16, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 14, color: '#2D6A4F' }}>⚡ {t.upgradeBanner}</span>
          <button
            onClick={() => setShowUpgrade(true)}
            style={{
              background: '#2D6A4F', color: '#fff', border: 'none',
              borderRadius: 20, padding: '8px 20px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            {t.upgradeBtn}
          </button>
        </div>
      )}

      {/* ── Date range ── */}
      <div style={{ ...card, padding: '12px 20px' }}>
        <DateRangeSelector value={dateRange} onChange={setDateRange} lang={lang} />
      </div>

      {/* ── KPI row — real API data ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label={t.profileViews} value={analyticsData ? totalViews.toLocaleString() : t.loading} />
        <StatCard label={t.connGrowth} value={analyticsData ? (totalConns > 0 ? `+${totalConns}` : '0') : t.loading} color="#40916C" />
        <StatCard label={t.avgEng} value={avgEngRate} color="#6C63FF" />
      </div>

      {/* ── FREE: Profile Views (real SQL data) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.profileViews}</h3>
        <p style={sub}>{t.pvDesc}</p>
        <LineChart data={profileViews} />
      </div>

      {/* ── FREE: New Connections (real SQL data) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.connGrowth}</h3>
        <p style={sub}>{t.connGrowthDesc}</p>
        <LineChart data={connGrowth} color="#40916C" />
      </div>

      {/* ── FREE: Top 5 Posts (real SQL data) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.topPosts}</h3>
        <p style={sub}>{t.tpDesc}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topPostsData.length === 0
            ? <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' }}>{t.noPostsYet}</p>
            : topPostsData.map((post, i) => (
              <div key={i} style={{
                padding: '12px 14px', borderRadius: 9, border: '1px solid #E8E4DF',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#eee',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: i < 3 ? '#333' : '#888',
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.text}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 5, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
                    <span>⚡ {post.reach.toLocaleString()} {t.reach}</span>
                    {post.likes !== null && <span>❤️ {post.likes}</span>}
                    {post.comments !== null && <span>💬 {post.comments}</span>}
                    {post.shares !== null && <span>↗ {post.shares}</span>}
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── PRO: Audience Insights ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.audience}</h3>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#444' }}>{t.industryDist}</p>
              {industryDistData
                ? <HBarChart data={industryDistData} valueKey="pct" suffix="%" />
                : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#444' }}>{t.topLoc}</p>
              {audienceLocations
                ? <HBarChart data={audienceLocations} valueKey="pct" suffix="%" color="#40916C" />
                : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}
            </div>
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#444' }}>{t.seniority}</p>
          {seniorityDistData
            ? <HBarChart data={seniorityDistData} valueKey="pct" suffix="%" color="#6C63FF" />
            : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}
        </PlanGate>
      </div>

      {/* ── PRO: Best Time to Post (real data: engagement by day × hour of user's posts) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.bestTime}</h3>
        <p style={sub}>{t.bestTimeDesc}</p>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          <PostingHeatmap data={heatmapData} lang={lang} />
        </PlanGate>
      </div>

      {/* ── PRO: Audience Growth Source (real: invite vs organic connections) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.growthSrc}</h3>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          {growthSourceData
            ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {growthSourceData.map((s, i) => (
                  <div key={i} style={{
                    flex: 1, minWidth: 100, padding: '16px 12px',
                    borderRadius: 10, border: '1px solid #E8E4DF', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#2D6A4F' }}>{s.pct}%</div>
                    <div style={{ fontSize: 13, color: '#555', marginTop: 4, fontWeight: 500 }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>+{s.value} {lang === 'da' ? 'forbindelser' : 'connections'}</div>
                  </div>
                ))}
              </div>
            )
            : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}
        </PlanGate>
      </div>

      {/* ── PRO: Content Performance ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.contentPerf}</h3>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#444' }}>{t.postType}</p>
          {postTypeData
            ? <BarChart data={postTypeData} />
            : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}

          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, marginTop: 24, color: '#444' }}>{t.hashtagPerf}</p>
          {hashtagData
            ? <HBarChart data={hashtagData} valueKey="value" color="#6C63FF" />
            : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}

          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, marginTop: 24, color: '#444' }}>{t.engTrend}</p>
          <LineChart data={engRate} color="#E07A5F" />
        </PlanGate>
      </div>

      {/* ── PRO: Connection Funnel (real SQL data) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.funnel}</h3>
        <p style={sub}>{t.funnelDesc}</p>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          {funnelData
            ? <FunnelChart data={funnelData} />
            : <p style={{ fontSize: 13, color: '#aaa' }}>{t.loading}</p>}
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, marginTop: 24, color: '#444' }}>{t.postsDriving}</p>
          {postsDrivingVisitsData
            ? <HBarChart data={postsDrivingVisitsData} valueKey="value" color="#D4A574" />
            : <p style={{ fontSize: 13, color: '#aaa' }}>{analyticsData ? t.noDataYet : t.loading}</p>}
        </PlanGate>
      </div>

      {/* ── PRO: Competitor Benchmarking (you vs. platform average) ── */}
      <div style={card}>
        <h3 style={sTitle}>{t.competitor}</h3>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#444' }}>{t.compFollower}</p>
          {compData.some(d => d.industry !== null)
            ? <>
                <DualLineChart data={compData.map(d => ({ ...d, industry: d.industry ?? 0 }))} />
                <div style={{ display: 'flex', gap: 20, fontSize: 12, marginTop: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 20, height: 3, background: '#2D6A4F', borderRadius: 2 }} />
                    {t.youLabel}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 20, height: 2, borderTop: '2px dashed #E07A5F' }} />
                    {t.industryLabel}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 14 }}>{t.compNote}</p>
              </>
            : <>
                <LineChart data={connGrowth} />
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>{t.compNote}</p>
              </>}
        </PlanGate>
      </div>

      {/* ── PRO: Export (exports real profile-views + connections data) ── */}
      <div style={card}>
        <h3 style={{ ...sTitle, marginBottom: 14 }}>{t.exportTitle}</h3>
        <PlanGate plan="business_pro" currentPlan={currentPlan} onUpgrade={() => setShowUpgrade(true)} lang={lang}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={handleExportCSV}
              style={{
                padding: '11px 22px', borderRadius: 8,
                border: '1.5px solid #2D6A4F', background: '#F0FAF4',
                color: '#2D6A4F', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              📥 {t.exportCSV}
            </button>
            <button
              onClick={handleExportPDF}
              style={{
                padding: '11px 22px', borderRadius: 8,
                border: '1px solid #aaa', background: '#fff',
                color: '#555', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              📄 {t.exportPDF}
            </button>
          </div>
        </PlanGate>
      </div>
    </div>
  )
}
