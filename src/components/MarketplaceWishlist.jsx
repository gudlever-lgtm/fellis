import { useState, useEffect } from 'react'
import { apiGetSavedListings, apiUnsaveListing } from '../api.js'
import { formatPrice } from '../utils/currency.js'

export default function MarketplaceWishlist({ lang, onViewListing }) {
  const [listings, setListings] = useState(null)

  const t = lang === 'da'
    ? { title: 'Ønskeliste', empty: 'Ingen gemte annoncer.', remove: 'Fjern', loading: 'Henter…' }
    : { title: 'Wishlist', empty: 'No saved listings.', remove: 'Remove', loading: 'Loading…' }

  useEffect(() => {
    apiGetSavedListings().then(d => setListings(d?.listings || []))
  }, [])

  const handleRemove = async (id) => {
    await apiUnsaveListing(id)
    setListings(prev => prev.filter(l => l.id !== id))
  }

  if (!listings) return <div style={{ padding: 16, color: '#888' }}>{t.loading}</div>

  return (
    <div>
      <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>❤️ {t.title}</h3>
      {listings.length === 0
        ? <div style={{ color: '#888', fontSize: 14 }}>{t.empty}</div>
        : listings.map(l => (
          <div key={l.id} className="p-card" style={{ marginBottom: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            {l.photos?.[0] && (
              <img src={l.photos[0]} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                onClick={() => onViewListing?.(l.id)}
              >{l.title}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1877F2', marginTop: 2 }}>{formatPrice(l.price || l.price_eur)}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{l.seller_name}</div>
            </div>
            <button onClick={() => handleRemove(l.id)}
              style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#fee', color: '#c00', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
              {t.remove}
            </button>
          </div>
        ))
      }
    </div>
  )
}
