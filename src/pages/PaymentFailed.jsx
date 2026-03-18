import CheckoutButton from '../components/PlanGate/CheckoutButton.jsx'
import { getTranslations } from '../data.js'

// Props: lang, plan, amount, currency, onNavigate
export default function PaymentFailed({ lang = 'da', plan = 'adfree', amount = 29, currency = 'DKK', onNavigate }) {
  const tr = getTranslations(lang)
  const t = {
    title: tr.paymentCancelledTitle,
    desc: tr.paymentCancelledDesc,
    retry: tr.paymentRetry,
    back: tr.paymentBackToFeed,
  }

  const s = {
    wrap: { maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '0 16px' },
    icon: { fontSize: 56, marginBottom: 12 },
    title: { fontSize: 26, fontWeight: 700, marginBottom: 8 },
    desc: { color: '#555', marginBottom: 32 },
    actions: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
    linkBtn: { background: 'none', border: 'none', color: '#1877F2', cursor: 'pointer', fontSize: 15, textDecoration: 'underline' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.icon}>❌</div>
      <h1 style={s.title}>{t.title}</h1>
      <p style={s.desc}>{t.desc}</p>
      <div style={s.actions}>
        <CheckoutButton plan={plan} amount={amount} currency={currency} label={t.retry} lang={lang} />
        <button style={s.linkBtn} onClick={() => onNavigate?.('feed')}>
          {t.back}
        </button>
      </div>
    </div>
  )
}
