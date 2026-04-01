import { useState, useEffect } from 'react'
import { apiGetCompanyReviews, apiCreateCompanyReview, apiDeleteCompanyReview } from '../api.js'
import { nameToColor, getInitials } from '../data.js'

function StarRating({ value, onChange, readonly = false }) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          onClick={() => !readonly && onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          style={{ fontSize: 22, cursor: readonly ? 'default' : 'pointer', color: (hover || value) >= star ? '#f59e0b' : '#ddd', lineHeight: 1 }}
        >★</span>
      ))}
    </div>
  )
}

export default function CompanyReviews({ companyId, currentUserId, lang }) {
  const [data, setData] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? { title: 'Anmeldelser', write: 'Skriv anmeldelse', avg: 'gennemsnit', reviews: 'anmeldelser', save: 'Send', cancel: 'Annuller', titlePh: 'Overskrift (valgfri)', bodyPh: 'Del din oplevelse…', empty: 'Ingen anmeldelser endnu.', deleteOwn: 'Slet min anmeldelse', ratingReq: 'Vælg venligst en stjernebedømmelse' }
    : { title: 'Reviews', write: 'Write a review', avg: 'average', reviews: 'reviews', save: 'Submit', cancel: 'Cancel', titlePh: 'Title (optional)', bodyPh: 'Share your experience…', empty: 'No reviews yet.', deleteOwn: 'Delete my review', ratingReq: 'Please select a star rating' }

  const load = () => apiGetCompanyReviews(companyId).then(d => setData(d))

  useEffect(() => { load() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!rating) return alert(t.ratingReq)
    setSaving(true)
    await apiCreateCompanyReview(companyId, rating, title, body)
    await load()
    setShowForm(false)
    setRating(0)
    setTitle('')
    setBody('')
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm(PT[lang].deleteYourReview)) return
    await apiDeleteCompanyReview(companyId)
    load()
  }

  const myReview = data?.reviews?.find(r => r.user_id === currentUserId)
  const avgRating = parseFloat(data?.stats?.avg_rating || 0).toFixed(1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>⭐ {t.title}</h3>
        {data?.stats?.total > 0 && (
          <span style={{ fontSize: 14, color: '#888' }}>{avgRating} {t.avg} · {data.stats.total} {t.reviews}</span>
        )}
        {!myReview && (
          <button onClick={() => setShowForm(f => !f)}
            style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            {t.write}
          </button>
        )}
      </div>

      {showForm && (
        <div className="p-card" style={{ marginBottom: 14, padding: '16px 18px' }}>
          <div style={{ marginBottom: 12 }}>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <input
            placeholder={t.titlePh}
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
          />
          <textarea
            placeholder={t.bodyPh}
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              {saving ? '…' : t.save}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {!data && <div style={{ color: '#888', fontSize: 14 }}>…</div>}
      {data?.reviews?.length === 0 && <div style={{ color: '#888', fontSize: 14 }}>{t.empty}</div>}

      {data?.reviews?.map(review => (
        <div key={review.id} className="p-card" style={{ marginBottom: 10, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: nameToColor(review.reviewer_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {review.reviewer_avatar
                ? <img src={review.reviewer_avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : getInitials(review.reviewer_name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{review.reviewer_name}</div>
              <StarRating value={review.rating} readonly />
            </div>
            {review.user_id === currentUserId && (
              <button onClick={handleDelete}
                style={{ padding: '4px 10px', borderRadius: 7, border: 'none', background: '#fee', color: '#c00', cursor: 'pointer', fontSize: 12 }}>
                ✕
              </button>
            )}
          </div>
          {review.title && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{review.title}</div>}
          {review.body && <div style={{ fontSize: 14, color: '#444', lineHeight: 1.5 }}>{review.body}</div>}
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>{new Date(review.created_at).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US')}</div>
        </div>
      ))}
    </div>
  )
}
