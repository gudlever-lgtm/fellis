import { useState } from 'react'
import CheckoutButton from '../components/PlanGate/CheckoutButton.jsx'

// Props: lang, plan, amount, currency, onNavigate
export default function PaymentFailed({ lang = 'da', plan = 'adfree', amount = 29, currency = 'DKK', onNavigate }) {
  const t = {
    da: {
      title: 'Betaling afbrudt',
      desc: 'Din betaling blev ikke gennemført. Du er ikke blevet opkrævet.',
      retry: 'Prøv igen',
      back: 'Gå tilbage til feed',
    },
    en: {
      title: 'Payment cancelled',
      desc: 'Your payment was not completed. You have not been charged.',
      retry: 'Try again',
      back: 'Back to feed',
    },
  }[lang] || {}

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
