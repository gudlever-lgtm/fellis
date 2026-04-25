import { useState, useEffect } from 'react'
import { getTheme } from '../userTypeTheme.js'
import { formatPrice } from '../utils/currency.js'
import { getLocale } from '../utils/dateFormat.js'
import { apiFetchPaymentFeatures, apiStartFeaturePayment, apiCancelFeaturePayment } from '../api.js'

const FEATURE_IDS = ['ad_free', 'analytics', 'profile_boost', 'direct_message', 'multi_admin', 'ad_campaigns']

function subtitleKey(mode) {
  if (mode === 'business') return 'business'
  if (mode === 'network') return 'network'
  return 'private'
}

export default function FeaturesPage({ currentUser, lang, t, onNavigate }) {
  const mode = currentUser?.mode || 'privat'
  const theme = getTheme(mode)
  const tf = t?.features || {}

  const [features, setFeatures] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [banner, setBanner] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [activating, setActivating] = useState(null)
  const [cancelling, setCancelling] = useState(null)

  async function loadFeatures() {
    setLoading(true)
    setError(false)
    const data = await apiFetchPaymentFeatures()
    if (!data || !data.features) {
      setError(true)
    } else {
      setFeatures(data.features)
    }
    setLoading(false)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const paymentStatus = params.get('payment')
    const featureParam = params.get('feature')
    if (paymentStatus === 'success' || paymentStatus === 'failed') {
      setBanner({ type: paymentStatus, feature: featureParam })
      params.delete('payment')
      params.delete('feature')
      const remaining = params.toString()
      window.history.replaceState({}, '', remaining ? `${window.location.pathname}?${remaining}` : window.location.pathname)
    }
    loadFeatures()
  }, [])

  async function handleActivate(f) {
    setActivating(f.id)
    const data = await apiStartFeaturePayment(f.id)
    setActivating(null)
    if (data?.checkout_url) {
      window.location.href = data.checkout_url
    }
  }

  async function handleCancel(f) {
    setCancelling(f.id)
    await apiCancelFeaturePayment(f.id)
    setCancelling(null)
    setConfirming(null)
    await loadFeatures()
  }

  const s = {
    page: { maxWidth: 900, margin: '0 auto', padding: '24px 16px' },
    header: { marginBottom: 28 },
    title: { fontSize: 26, fontWeight: 700, color: theme.color, margin: '0 0 6px' },
    subtitle: { fontSize: 15, color: theme.color, margin: 0 },
    banner: (type) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderRadius: 10, marginBottom: 20,
      background: type === 'success' ? '#e8f5e9' : '#fdecea',
      border: `1px solid ${type === 'success' ? '#a5d6a7' : '#ef9a9a'}`,
      color: type === 'success' ? '#2e7d32' : '#c62828',
      fontSize: 14,
    }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
    card: { border: `1.5px solid ${theme.color}`, background: theme.colorLight, borderRadius: 12, padding: 20, position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 },
    cardTitle: { fontWeight: 700, fontSize: 16, margin: 0, color: '#1a1a1a' },
    cardDesc: { fontSize: 13, color: '#555', margin: 0, flexGrow: 1 },
    badge: { position: 'absolute', top: 12, right: 12, background: '#2e7d32', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 },
    expires: { fontSize: 12, color: '#388e3c' },
    price: { fontSize: 14, fontWeight: 600, color: theme.color },
    btnActivate: { background: theme.color, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
    btnCancel: { background: 'transparent', color: theme.color, border: `1.5px solid ${theme.color}`, borderRadius: 8, padding: '7px 15px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
    skeleton: { background: '#e0e0e0', borderRadius: 8, animation: 'pulse 1.4s ease-in-out infinite' },
    error: { textAlign: 'center', padding: '40px 0', color: '#c62828' },
    retryBtn: { marginTop: 12, background: theme.color, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    dialog: { background: '#fff', borderRadius: 14, padding: 28, maxWidth: 340, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' },
    dialogText: { fontSize: 15, marginBottom: 20 },
    dialogBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  }

  const dateFmt = new Intl.DateTimeFormat(getLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' })
  const perMonth = tf.price_per_month || '/md'

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>{tf.page_title || 'Funktioner'}</h1>
        <p style={s.subtitle}>{tf.subtitle?.[subtitleKey(mode)] || ''}</p>
      </div>

      {banner && (
        <div style={s.banner(banner.type)}>
          <span>{banner.type === 'success' ? (tf.payment_success || '') : (tf.payment_failed || '')}</span>
          <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'inherit' }}>×</button>
        </div>
      )}

      {error && (
        <div style={s.error}>
          <div>{tf.loading_error || 'Kunne ikke hente funktioner — prøv igen'}</div>
          <button onClick={loadFeatures} style={s.retryBtn}>{tf.retry || 'Prøv igen'}</button>
        </div>
      )}

      {loading && !error && (
        <div style={s.grid}>
          {FEATURE_IDS.map(id => (
            <div key={id} style={{ ...s.card, background: '#f0f0f0', border: '1.5px solid #e0e0e0' }}>
              <div style={{ ...s.skeleton, height: 18, width: '60%' }} />
              <div style={{ ...s.skeleton, height: 13, width: '90%', marginTop: 4 }} />
              <div style={{ ...s.skeleton, height: 13, width: '75%' }} />
              <div style={{ ...s.skeleton, height: 34, width: 120, marginTop: 6, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && features && (
        <div style={s.grid}>
          {features.map(f => {
            const tFeature = tf[f.id] || {}
            const isActivating = activating === f.id
            const isCancelling = cancelling === f.id
            const expiresDate = f.expires_at ? dateFmt.format(new Date(f.expires_at)) : null
            const priceStr = `${formatPrice(f.price)}${perMonth}`
            return (
              <div key={f.id} style={s.card}>
                {f.active && <span style={s.badge}>{tf.badge_active || 'Aktiv'}</span>}
                <div style={s.cardTitle}>{tFeature.name || f.id}</div>
                <div style={s.cardDesc}>{tFeature.description || ''}</div>
                <div style={s.price}>{priceStr}</div>
                {f.active && expiresDate && (
                  <div style={s.expires}>{tf.renews_on || 'Fornyes'} {expiresDate}</div>
                )}
                {f.active ? (
                  <button
                    style={{ ...s.btnCancel, opacity: isCancelling ? 0.6 : 1 }}
                    disabled={isCancelling}
                    onClick={() => setConfirming(f)}
                  >
                    {tf.btn_cancel || 'Annullér'}
                  </button>
                ) : (
                  <button
                    style={{ ...s.btnActivate, opacity: isActivating ? 0.6 : 1 }}
                    disabled={isActivating}
                    onClick={() => handleActivate(f)}
                  >
                    {tf.btn_activate || 'Aktivér'} — {priceStr}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirming && (
        <div style={s.overlay} onClick={() => setConfirming(null)}>
          <div style={s.dialog} onClick={e => e.stopPropagation()}>
            <div style={s.dialogText}>{tf.btn_cancel_confirm || 'Er du sikker på, at du vil annullere denne funktion?'}</div>
            <div style={s.dialogBtns}>
              <button style={{ ...s.btnCancel, fontSize: 13 }} onClick={() => setConfirming(null)}>
                {t?.back || 'Tilbage'}
              </button>
              <button
                style={{ ...s.btnActivate, background: '#c62828', fontSize: 13, opacity: cancelling === confirming.id ? 0.6 : 1 }}
                disabled={cancelling === confirming.id}
                onClick={() => handleCancel(confirming)}
              >
                {tf.btn_cancel || 'Annullér'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
