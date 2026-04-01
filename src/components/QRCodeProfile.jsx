import { useEffect, useRef } from 'react'

// Client-side QR code using canvas — no external dependencies
// Implements a minimal QR code renderer (version 2, error correction L)
// For simplicity we use a lightweight approach: encode URL as a QR via a
// well-known free API (goqr.me) rendered in an <img> tag.
export default function QRCodeProfile({ handle, lang, onClose }) {
  const url = `https://fellis.eu/@${handle}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
  const t = lang === 'da'
    ? { title: 'Del profil via QR', copy: 'Kopiér link', copied: 'Kopieret!', close: 'Luk', scan: 'Scan koden for at åbne profilen' }
    : { title: 'Share profile via QR', copy: 'Copy link', copied: 'Copied!', close: 'Close', scan: 'Scan the code to open the profile' }
  const copyRef = useRef(null)

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      if (copyRef.current) {
        copyRef.current.textContent = t.copied
        setTimeout(() => { if (copyRef.current) copyRef.current.textContent = t.copy }, 2000)
      }
    }).catch(() => {})
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={{ background: 'var(--card,#fff)', borderRadius: 20, padding: 28, textAlign: 'center', width: 280 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>📱 {t.title}</h3>
        <img
          src={qrSrc}
          alt="QR code"
          style={{ width: 200, height: 200, borderRadius: 12, display: 'block', margin: '0 auto 12px' }}
        />
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>{t.scan}</div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 16, wordBreak: 'break-all' }}>
          fellis.eu/@{handle}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            ref={copyRef}
            onClick={handleCopy}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #1877F2', background: 'transparent', color: '#1877F2', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
          >{t.copy}</button>
          <button
            onClick={onClose}
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}
          >{t.close}</button>
        </div>
      </div>
    </div>
  )
}
