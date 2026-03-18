import { useEffect, useState } from 'react'
import { apiGetMollieStatus } from '../api.js'
import { getTranslations } from '../data.js'

export default function PaymentSuccess({ lang = 'da', onNavigate }) {
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGetMollieStatus().then(data => {
      setSub(data)
      setLoading(false)
    })
  }, [])

  const tr = getTranslations(lang)
  const t = {
    title: tr.paymentSuccessTitle,
    thanks: tr.paymentSuccessThanks,
    plan: tr.paymentPlanLabel,
    status: tr.paymentStatusLabel,
    expires: tr.paymentExpiresLabel,
    dashboard: tr.paymentGoToDashboard,
    loading: tr.paymentLoading,
    paid: tr.paymentPaidStatus,
  }

  const s = {
    wrap: { maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '0 16px' },
    icon: { fontSize: 56, marginBottom: 12 },
    title: { fontSize: 26, fontWeight: 700, marginBottom: 8 },
    sub: { color: '#555', marginBottom: 24 },
    card: { background: '#f6fef9', border: '1.5px solid #40916c', borderRadius: 12, padding: '20px 24px', marginBottom: 24, textAlign: 'left' },
    row: { display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 },
    label: { color: '#888' },
    value: { fontWeight: 600 },
    btn: { padding: '11px 28px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.icon}>✅</div>
      <h1 style={s.title}>{t.title}</h1>
      <p style={s.sub}>{t.thanks}</p>

      {loading ? (
        <p style={{ color: '#888' }}>{t.loading}</p>
      ) : sub ? (
        <div style={s.card}>
          <div style={s.row}>
            <span style={s.label}>{t.plan}</span>
            <span style={s.value}>{sub.plan || '—'}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>{t.status}</span>
            <span style={s.value}>{sub.status === 'paid' ? t.paid : sub.status || '—'}</span>
          </div>
          {sub.expires_at && (
            <div style={s.row}>
              <span style={s.label}>{t.expires}</span>
              <span style={s.value}>{new Date(sub.expires_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US')}</span>
            </div>
          )}
        </div>
      ) : null}

      <button style={s.btn} onClick={() => onNavigate?.('feed')}>
        {t.dashboard}
      </button>
    </div>
  )
}
