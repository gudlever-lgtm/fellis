import { useState } from 'react'
import { apiCreateMolliePayment } from '../../api.js'

// Props: plan (string), amount (number), label (string), currency (string), lang (string)
export default function CheckoutButton({ plan, amount, label, currency = 'DKK', lang = 'da' }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const s = {
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 22px',
      borderRadius: 8,
      border: 'none',
      background: '#1877F2',
      color: '#fff',
      fontWeight: 600,
      fontSize: 15,
      cursor: loading ? 'not-allowed' : 'pointer',
      opacity: loading ? 0.7 : 1,
      transition: 'opacity 0.15s',
    },
    error: {
      marginTop: 8,
      color: '#e03131',
      fontSize: 13,
    },
  }

  async function handleClick() {
    setError(null)
    setLoading(true)
    try {
      const result = await apiCreateMolliePayment(plan, amount, currency)
      if (!result?.checkoutUrl) {
        setError(PT[lang].mollieCheckoutError)
        return
      }
      window.location.href = result.checkoutUrl
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button style={s.btn} onClick={handleClick} disabled={loading}>
        {loading ? (PT[lang].mollieCheckoutLoading) : label}
      </button>
      {error && <p style={s.error}>{error}</p>}
    </div>
  )
}
