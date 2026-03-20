import { useState, useEffect, useCallback } from 'react'
import { INTEREST_CATEGORIES } from './data.js'
import { apiGetInterestGraph, apiCorrectInterest, apiGetSignalStats } from './api.js'

const CONTEXTS = ['hobby', 'professional', 'purchase']

const CONTEXT_LABELS = {
  da: { hobby: 'Hobby', professional: 'Professionel', purchase: 'Køb & Forbrug' },
  en: { hobby: 'Hobby', professional: 'Professional', purchase: 'Shopping' },
}

const SIGNAL_LABELS = {
  da: {
    like: 'Likes', comment: 'Kommentarer', share: 'Delinger', click: 'Klik',
    dwell_short: 'Læst (kort)', dwell_long: 'Læst (længe)', scroll_past: 'Scrollet forbi',
    quick_close: 'Lukket hurtigt', block: 'Blokeret',
  },
  en: {
    like: 'Likes', comment: 'Comments', share: 'Shares', click: 'Clicks',
    dwell_short: 'Read (briefly)', dwell_long: 'Read (closely)', scroll_past: 'Scrolled past',
    quick_close: 'Closed quickly', block: 'Blocked',
  },
}

function getInterestMeta(slug) {
  return INTEREST_CATEGORIES.find(c => c.id === slug) || { id: slug, da: slug, en: slug, icon: '●' }
}

function WeightBar({ weight, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 8, background: '#e8f5e9', borderRadius: 4, position: 'relative' }}>
        <div style={{
          width: `${weight}%`, height: '100%', borderRadius: 4,
          background: weight >= 70 ? '#2D6A4F' : weight >= 40 ? '#52b788' : '#95d5b2',
          transition: 'width 0.3s ease',
        }} />
      </div>
      {!readOnly && (
        <input
          type="range" min={0} max={100} value={Math.round(weight)}
          onChange={e => onChange(parseInt(e.target.value))}
          style={{ width: 80, accentColor: '#2D6A4F', cursor: 'pointer' }}
        />
      )}
      <span style={{ fontSize: 13, color: '#555', width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(weight)}
      </span>
    </div>
  )
}

export default function InterestGraphPage({ lang, t, currentUser }) {
  const da = lang === 'da'
  const [activeCtx, setActiveCtx] = useState('hobby')
  const [scores, setScores] = useState([])
  const [explicit, setExplicit] = useState([])
  const [signalStats, setSignalStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [saving, setSaving] = useState({})
  const [pendingWeights, setPendingWeights] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [graph, stats] = await Promise.all([apiGetInterestGraph(), apiGetSignalStats()])
    if (graph) {
      setScores(graph.scores || [])
      setExplicit(graph.explicit || [])
    }
    if (stats) setSignalStats(stats.stats || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filteredScores = scores
    .filter(s => s.context === activeCtx && s.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  const handleWeightChange = (slug, weight) => {
    setPendingWeights(p => ({ ...p, [`${slug}:${activeCtx}`] : weight }))
  }

  const handleSave = async (slug) => {
    const key = `${slug}:${activeCtx}`
    const weight = pendingWeights[key]
    if (weight === undefined) return
    setSaving(s => ({ ...s, [key]: true }))
    await apiCorrectInterest(slug, weight, activeCtx)
    setSaving(s => ({ ...s, [key]: false }))
    setPendingWeights(p => { const n = { ...p }; delete n[key]; return n })
    await load()
  }

  const getWeight = (slug) => {
    const key = `${slug}:${activeCtx}`
    if (pendingWeights[key] !== undefined) return pendingWeights[key]
    const s = filteredScores.find(x => x.interest_slug === slug)
    return s ? s.weight : 0
  }

  // Signal stats grouped by interest
  const statsByInterest = {}
  for (const s of signalStats) {
    if (!statsByInterest[s.interest_slug]) statsByInterest[s.interest_slug] = []
    statsByInterest[s.interest_slug].push(s)
  }

  const s = {
    page: { maxWidth: 680, margin: '0 auto', padding: '24px 16px' },
    header: { marginBottom: 24 },
    title: { fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: 0 },
    subtitle: { fontSize: 14, color: '#666', marginTop: 4, lineHeight: 1.5 },
    tabs: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
    tab: (active) => ({
      padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
      background: active ? '#2D6A4F' : '#f0f0f0', color: active ? '#fff' : '#444',
    }),
    scoreRow: {
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      background: '#fff', borderRadius: 10, marginBottom: 8,
      border: '1px solid #e8f5e9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    },
    icon: { fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0 },
    name: { fontSize: 14, fontWeight: 600, color: '#1a1a1a', width: 130, flexShrink: 0 },
    saveBtn: (has) => ({
      padding: '4px 12px', borderRadius: 6, border: 'none', cursor: has ? 'pointer' : 'default',
      background: has ? '#2D6A4F' : '#e0e0e0', color: has ? '#fff' : '#aaa',
      fontSize: 12, fontWeight: 600, flexShrink: 0,
    }),
    emptyState: { textAlign: 'center', padding: '40px 0', color: '#888' },
    notice: {
      background: '#f0f7f4', border: '1px solid #b7e4c7', borderRadius: 10,
      padding: '14px 16px', fontSize: 13, color: '#2D6A4F', lineHeight: 1.6, marginTop: 24,
    },
    statsToggle: {
      marginTop: 16, fontSize: 13, color: '#2D6A4F', fontWeight: 600,
      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    },
    statRow: {
      display: 'flex', justifyContent: 'space-between', padding: '6px 0',
      borderBottom: '1px solid #f0f0f0', fontSize: 13,
    },
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h2 style={s.title}>
          {da ? '🧠 Din interessegraf' : '🧠 Your Interest Graph'}
        </h2>
        <p style={s.subtitle}>
          {da
            ? 'Fellis lærer dine interesser at kende ud fra din adfærd — hvad du læser, liker og kommenterer. Du kan altid justere eller korrigere det, vi har lært om dig.'
            : 'Fellis learns your interests from your behaviour — what you read, like and comment on. You can always adjust or correct what we have learned about you.'}
        </p>
      </div>

      <div style={s.tabs}>
        {CONTEXTS.map(ctx => (
          <button key={ctx} style={s.tab(activeCtx === ctx)} onClick={() => setActiveCtx(ctx)}>
            {CONTEXT_LABELS[lang]?.[ctx] || ctx}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.emptyState}>{da ? 'Henter…' : 'Loading…'}</div>
      ) : filteredScores.length === 0 ? (
        <div style={s.emptyState}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {da ? 'Ingen data endnu' : 'No data yet'}
          </div>
          <div style={{ fontSize: 13 }}>
            {da
              ? 'Brug platformen lidt mere — like opslag, skriv kommentarer, og din graf vil begynde at tage form.'
              : 'Use the platform a bit more — like posts, write comments, and your graph will start taking shape.'}
          </div>
        </div>
      ) : (
        filteredScores.map(score => {
          const meta = getInterestMeta(score.interest_slug)
          const key = `${score.interest_slug}:${activeCtx}`
          const hasPending = pendingWeights[key] !== undefined
          const isSaving = saving[key]
          const w = getWeight(score.interest_slug)

          return (
            <div key={key} style={s.scoreRow}>
              <span style={s.icon}>{meta.icon}</span>
              <span style={s.name}>{meta[lang] || meta.da}</span>
              <WeightBar
                weight={w}
                onChange={(v) => handleWeightChange(score.interest_slug, v)}
              />
              <button
                style={s.saveBtn(hasPending)}
                disabled={!hasPending || isSaving}
                onClick={() => handleSave(score.interest_slug)}
              >
                {isSaving ? '…' : (da ? 'Gem' : 'Save')}
              </button>
              {score.explicit_set ? (
                <span title={da ? 'Manuelt sat' : 'Manually set'} style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>✎</span>
              ) : null}
            </div>
          )
        })
      )}

      <button style={s.statsToggle} onClick={() => setShowStats(v => !v)}>
        {showStats
          ? (da ? '▲ Skjul signalhistorik' : '▲ Hide signal history')
          : (da ? '▼ Vis signalhistorik (30 dage)' : '▼ Show signal history (30 days)')}
      </button>

      {showStats && (
        <div style={{ marginTop: 12, background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '12px 16px' }}>
          {signalStats.length === 0 ? (
            <div style={{ fontSize: 13, color: '#888' }}>
              {da ? 'Ingen signaler registreret endnu.' : 'No signals recorded yet.'}
            </div>
          ) : (
            Object.entries(statsByInterest).map(([slug, rows]) => {
              const meta = getInterestMeta(slug)
              return (
                <div key={slug} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {meta.icon} {meta[lang] || meta.da}
                  </div>
                  {rows.map(r => (
                    <div key={r.signal_type} style={s.statRow}>
                      <span>{SIGNAL_LABELS[lang]?.[r.signal_type] || r.signal_type}</span>
                      <span style={{ fontWeight: 600, color: '#2D6A4F' }}>×{r.cnt}</span>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      )}

      <div style={s.notice}>
        🔒 {da
          ? 'Råsignaler slettes automatisk efter 90 dage (GDPR). Kun de beregnede scorer bevares. Du kan til enhver tid slette din konto og alle data fra Indstillinger → Privatliv.'
          : 'Raw signals are automatically deleted after 90 days (GDPR). Only the computed scores are kept. You can delete your account and all data at any time from Settings → Privacy.'}
      </div>
    </div>
  )
}
