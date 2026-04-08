import { useState } from 'react'
import { apiMakeOffer } from '../api.js'
import { formatPrice } from '../utils/currency.js'

export default function MakeOfferModal({ listing, lang, onClose, onSent }) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const t = lang === 'da'
    ? { title: 'Send bud', amountLabel: 'Dit bud (EUR)', messagePh: 'Besked til sælger (valgfri)', send: 'Send bud', cancel: 'Annuller', listingPrice: 'Pris', sent: 'Bud sendt!', sentDesc: 'Sælger vil modtage en notifikation.' }
    : { title: 'Make an offer', amountLabel: 'Your offer (EUR)', messagePh: 'Message to seller (optional)', send: 'Send offer', cancel: 'Cancel', listingPrice: 'Listed price', sent: 'Offer sent!', sentDesc: 'The seller will be notified.' }

  const handleSend = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    setSending(true)
    await apiMakeOffer(listing.id, amt, message)
    setSent(true)
    setSending(false)
    onSent?.()
    setTimeout(onClose, 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--card,#fff)', borderRadius: 16, padding: 24, width: 380, maxWidth: '90vw' }}>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{t.sent}</div>
            <div style={{ color: '#888', fontSize: 14 }}>{t.sentDesc}</div>
          </div>
        ) : (
          <>
            <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>💸 {t.title}</h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
              {t.listingPrice}: <strong>{formatPrice(listing.price || listing.price_eur)}</strong>
            </div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>{t.amountLabel}</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 16, marginBottom: 14, boxSizing: 'border-box' }}
            />
            <textarea
              placeholder={t.messagePh}
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, resize: 'none', marginBottom: 16, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSend} disabled={sending || !amount}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
                {sending ? '…' : t.send}
              </button>
              <button onClick={onClose}
                style={{ padding: '11px 18px', borderRadius: 10, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
                {t.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
