import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGetMyAds, apiCreateAd, apiUpdateAd, apiPatchAd, apiDeleteAd, apiPayForAd, apiBoostPost, apiFetchUserPosts, apiUploadFile } from '../api.js'
import { formatPrice } from '../utils/currency.js'

const STATUS_COLORS = {
  active: { bg: '#D1FAE5', color: '#065F46' },
  draft: { bg: '#F3F4F6', color: '#374151' },
  paused: { bg: '#FEF3C7', color: '#92400E' },
  archived: { bg: '#FEE2E2', color: '#991B1B' },
}

export default function AdManager({ lang, t, currentUser }) {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [ownPosts, setOwnPosts] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showBoost, setShowBoost] = useState(false)
  const [activating, setActivating] = useState(null)
  const [boosting, setBoosting] = useState(null)
  const [statusChanging, setStatusChanging] = useState(null)
  const [editingAdId, setEditingAdId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', body: '', image_url: '', target_url: '',
    budget: '', target_interests: '', start_date: '', end_date: '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileInputRef = useRef(null)

  const handleImageUpload = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setUploading(true)
    const res = await apiUploadFile(file, 'post')
    setUploading(false)
    if (res?.url) {
      setForm(p => ({ ...p, image_url: res.url }))
    } else {
      setError(lang === 'da' ? 'Kunne ikke uploade billedet' : 'Could not upload image')
      setTimeout(() => setError(''), 4000)
    }
  }

  const handleImagePaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        handleImageUpload(item.getAsFile())
        return
      }
    }
    // plain text paste (URL) — let default behaviour handle it
  }

  const loadAds = useCallback(async () => {
    setLoading(true)
    const data = await apiGetMyAds()
    if (data?.ads) setAds(data.ads)
    setLoading(false)
  }, [])

  useEffect(() => { loadAds() }, [loadAds])

  // Load own posts for the "boost a post" section
  useEffect(() => {
    if (!currentUser?.id) return
    apiFetchUserPosts(currentUser.id).then(data => {
      const rows = data?.posts || data || []
      setOwnPosts(rows)
    }).catch(() => {})
  }, [currentUser?.id])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.title || !form.target_url) return setError(lang === 'da' ? 'Titel og destinations-URL er påkrævet' : 'Title and destination URL are required')
    setSaving(true)
    setError('')
    const payload = {
      title: form.title,
      body: form.body || undefined,
      image_url: form.image_url || undefined,
      target_url: form.target_url,
      budget: form.budget ? parseFloat(form.budget) : undefined,
      target_interests: form.target_interests
        ? form.target_interests.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    }
    const res = await apiCreateAd(payload)
    setSaving(false)
    if (res?.ad) {
      setAds(prev => [res.ad, ...prev])
      setForm({ title: '', body: '', image_url: '', target_url: '', budget: '', target_interests: '', start_date: '', end_date: '' })
      setShowCreate(false)
      setSuccess(lang === 'da' ? 'Annonce oprettet' : 'Ad created')
      setTimeout(() => setSuccess(''), 3000)
    } else {
      setError(lang === 'da' ? 'Kunne ikke oprette annonce' : 'Could not create ad')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(lang === 'da' ? 'Slet denne annonce?' : 'Delete this ad?')) return
    const res = await apiDeleteAd(id)
    if (res?.ok) setAds(prev => prev.filter(a => a.id !== id))
  }

  const handleActivate = async (id) => {
    setActivating(id)
    const res = await apiPayForAd(id)
    setActivating(null)
    if (res?.activated || res?.checkout_url) {
      if (res.checkout_url) {
        window.location.href = res.checkout_url
      } else {
        setAds(prev => prev.map(a => a.id === id ? { ...a, status: 'active', payment_status: 'paid' } : a))
        setSuccess(lang === 'da' ? 'Annonce aktiveret!' : 'Ad activated!')
        setTimeout(() => setSuccess(''), 3000)
      }
    } else {
      setError(lang === 'da' ? 'Aktivering mislykkedes' : 'Activation failed')
      setTimeout(() => setError(''), 4000)
    }
  }

  const handleStatusChange = async (id, newStatus) => {
    setStatusChanging(id)
    const res = await apiUpdateAd(id, { status: newStatus })
    setStatusChanging(null)
    if (res?.ad) {
      setAds(prev => prev.map(a => a.id === id ? res.ad : a))
    } else {
      setError(lang === 'da' ? 'Statusændring mislykkedes' : 'Status change failed')
      setTimeout(() => setError(''), 4000)
    }
  }

  const handleEditOpen = (ad) => {
    setEditingAdId(ad.id)
    setEditForm({
      title: ad.title || '',
      body: ad.body || '',
      image_url: ad.image_url || '',
      target_url: ad.target_url || '',
      budget: ad.budget != null ? String(ad.budget) : '',
      target_interests: Array.isArray(ad.target_interests) ? ad.target_interests.join(', ') : (ad.target_interests || ''),
      start_date: ad.start_date ? ad.start_date.slice(0, 10) : '',
      end_date: ad.end_date ? ad.end_date.slice(0, 10) : '',
    })
  }

  const handleEditSave = async (e, id) => {
    e.preventDefault()
    setEditSaving(true)
    const payload = {
      title: editForm.title || undefined,
      body: editForm.body || undefined,
      image_url: editForm.image_url || undefined,
      target_url: editForm.target_url || undefined,
      budget: editForm.budget ? parseFloat(editForm.budget) : undefined,
      target_interests: editForm.target_interests
        ? editForm.target_interests.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
      start_date: editForm.start_date || undefined,
      end_date: editForm.end_date || undefined,
    }
    const res = await apiPatchAd(id, payload)
    setEditSaving(false)
    if (res?.ad) {
      setAds(prev => prev.map(a => a.id === id ? res.ad : a))
      setEditingAdId(null)
      setSuccess(lang === 'da' ? 'Annonce gemt' : 'Ad saved')
      setTimeout(() => setSuccess(''), 3000)
    } else {
      setError(lang === 'da' ? 'Kunne ikke gemme ændringer' : 'Could not save changes')
      setTimeout(() => setError(''), 4000)
    }
  }

  const handleBoost = async (postId) => {
    setBoosting(postId)
    const res = await apiBoostPost(postId)
    setBoosting(null)
    if (res?.activated || res?.checkout_url) {
      if (res.checkout_url) {
        window.location.href = res.checkout_url
      } else {
        setSuccess(t.postBoosted || (lang === 'da' ? 'Opslag boosted!' : 'Post boosted!'))
        setTimeout(() => setSuccess(''), 3000)
        loadAds()
      }
      setShowBoost(false)
    } else {
      setError(lang === 'da' ? 'Boost mislykkedes' : 'Boost failed')
      setTimeout(() => setError(''), 4000)
    }
  }

  const statusLabel = (status) => {
    const map = { active: t.adActive, draft: t.adDraft, paused: t.adPaused, archived: t.adArchived }
    return map[status] || status
  }

  const s = {
    wrap: { maxWidth: 900, margin: '0 auto', paddingBottom: 40 },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    title: { fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: 0 },
    subtitle: { fontSize: 14, color: '#888', marginTop: 4 },
    btnPrimary: {
      padding: '9px 20px', borderRadius: 10, border: 'none',
      background: '#4338CA', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
    },
    btnSecondary: {
      padding: '9px 20px', borderRadius: 10,
      border: '1.5px solid #4338CA', background: '#EEF2FF',
      color: '#4338CA', fontWeight: 700, fontSize: 14, cursor: 'pointer',
    },
    btnRow: { display: 'flex', gap: 8, marginBottom: 16 },
    card: { background: '#fff', borderRadius: 14, border: '1px solid #E8E4DF', padding: '16px 20px', marginBottom: 12 },
    adRow: { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
    adInfo: { flex: 1, minWidth: 200 },
    adName: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' },
    adUrl: { fontSize: 12, color: '#888', marginBottom: 6 },
    badge: (status) => ({
      display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
      ...(STATUS_COLORS[status] || STATUS_COLORS.draft),
    }),
    stats: { display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' },
    stat: { textAlign: 'center' },
    statVal: { fontSize: 16, fontWeight: 800, color: '#1a1a1a', display: 'block' },
    statLabel: { fontSize: 11, color: '#888' },
    actions: { display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', marginTop: 8 },
    btnDanger: {
      padding: '6px 12px', borderRadius: 8,
      border: '1.5px solid #FCA5A5', background: '#FEF2F2',
      color: '#DC2626', fontWeight: 600, fontSize: 12, cursor: 'pointer',
    },
    btnActivate: {
      padding: '6px 14px', borderRadius: 8,
      border: 'none', background: '#4338CA',
      color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
    },
    btnEdit: {
      padding: '6px 12px', borderRadius: 8,
      border: '1.5px solid #D1D5DB', background: '#F9FAFB',
      color: '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer',
    },
    btnPause: {
      padding: '6px 12px', borderRadius: 8,
      border: '1.5px solid #FDE68A', background: '#FFFBEB',
      color: '#92400E', fontWeight: 600, fontSize: 12, cursor: 'pointer',
    },
    btnReactivate: {
      padding: '6px 12px', borderRadius: 8,
      border: '1.5px solid #6EE7B7', background: '#ECFDF5',
      color: '#065F46', fontWeight: 600, fontSize: 12, cursor: 'pointer',
    },
    btnArchive: {
      padding: '6px 12px', borderRadius: 8,
      border: '1.5px solid #FED7AA', background: '#FFF7ED',
      color: '#C2410C', fontWeight: 600, fontSize: 12, cursor: 'pointer',
    },
    formWrap: { background: '#fff', borderRadius: 14, border: '1px solid #E8E4DF', padding: '20px', marginBottom: 16 },
    formTitle: { fontSize: 16, fontWeight: 700, marginBottom: 14, color: '#1a1a1a' },
    formRow: { marginBottom: 12 },
    label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4 },
    input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
    twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    alert: (type) => ({
      padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12,
      background: type === 'error' ? '#FEF2F2' : '#D1FAE5',
      color: type === 'error' ? '#DC2626' : '#065F46',
      border: `1px solid ${type === 'error' ? '#FCA5A5' : '#6EE7B7'}`,
    }),
    empty: { textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 },
    spinner: { textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 },
    boostPost: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F0EDE8' },
    boostPostText: { fontSize: 13, color: '#333', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 },
  }

  return (
    <div style={s.wrap}>
      <div className="p-card" style={{ padding: '20px 20px 16px', marginBottom: 16 }}>
        <div style={s.header}>
          <div>
            <h2 style={s.title}>📢 {t.adManager}</h2>
            <p style={s.subtitle}>{t.adManagerSubtitle}</p>
          </div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btnPrimary} onClick={() => { setShowCreate(v => !v); setShowBoost(false) }}>
            {showCreate ? '✕' : '+ ' + t.createAd}
          </button>
          <button style={s.btnSecondary} onClick={() => { setShowBoost(v => !v); setShowCreate(false) }}>
            {showBoost ? '✕' : '🚀 ' + t.boostPost}
          </button>
        </div>
      </div>

      {error && <div style={s.alert('error')}>{error}</div>}
      {success && <div style={s.alert('success')}>{success}</div>}

      {/* Create form */}
      {showCreate && (
        <div style={s.formWrap}>
          <div style={s.formTitle}>{t.createAd}</div>
          <form onSubmit={handleCreate}>
            <div style={s.twoCol}>
              <div style={s.formRow}>
                <label style={s.label}>{t.adTitle} <span className="req">*</span></label>
                <input style={s.input} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
              </div>
              <div style={s.formRow}>
                <label style={s.label}>{t.adTargetUrl} <span className="req">*</span></label>
                <input style={s.input} type="url" value={form.target_url} onChange={e => setForm(p => ({ ...p, target_url: e.target.value }))} required />
              </div>
            </div>
            <div style={s.formRow}>
              <label style={s.label}>{t.adBody}</label>
              <input style={s.input} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
            </div>
            <div style={s.twoCol}>
              <div style={s.formRow}>
                <label style={s.label}>{t.adImageUrl}</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    style={{ ...s.input, flex: 1 }}
                    value={form.image_url}
                    placeholder={lang === 'da' ? 'Indsæt URL eller billede…' : 'Paste URL or image…'}
                    onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))}
                    onPaste={handleImagePaste}
                  />
                  <button
                    type="button"
                    title={lang === 'da' ? 'Upload fil' : 'Upload file'}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid #DDD', background: '#F9F9F9', cursor: 'pointer', fontSize: 16, flexShrink: 0, opacity: uploading ? 0.5 : 1 }}
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >{uploading ? '…' : '📁'}</button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = '' }}
                  />
                </div>
                {form.image_url && (
                  <img
                    src={form.image_url}
                    alt=""
                    style={{ marginTop: 6, maxHeight: 80, maxWidth: '100%', borderRadius: 6, objectFit: 'cover', border: '1px solid #E8E4DF' }}
                    onError={e => { e.target.style.display = 'none' }}
                    onLoad={e => { e.target.style.display = 'block' }}
                  />
                )}
              </div>
              <div style={s.formRow}>
                <label style={s.label}>{t.adBudget}</label>
                <input style={s.input} type="number" min="1" step="0.01" value={form.budget} onChange={e => setForm(p => ({ ...p, budget: e.target.value }))} />
              </div>
            </div>
            <div style={s.formRow}>
              <label style={s.label}>{t.adTargetInterests}</label>
              <input style={s.input} value={form.target_interests} onChange={e => setForm(p => ({ ...p, target_interests: e.target.value }))} placeholder={lang === 'da' ? 'f.eks. teknologi, design, sundhed' : 'e.g. technology, design, health'} />
            </div>
            <div style={s.twoCol}>
              <div style={s.formRow}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ ...s.label, margin: 0 }}>{t.adStartDate}</label>
                  <button type="button" style={{ fontSize: 11, fontWeight: 600, color: '#4338CA', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setForm(p => ({ ...p, start_date: new Date().toISOString().slice(0, 10) }))}>
                    {lang === 'da' ? 'I dag' : 'Today'}
                  </button>
                </div>
                <input style={s.input} type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div style={s.formRow}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ ...s.label, margin: 0 }}>{t.adEndDate}</label>
                  <button type="button" style={{ fontSize: 11, fontWeight: 600, color: '#4338CA', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => { const d = new Date(); d.setDate(d.getDate() + 30); setForm(p => ({ ...p, end_date: d.toISOString().slice(0, 10) })) }}>
                    +30 {lang === 'da' ? 'dage' : 'days'}
                  </button>
                </div>
                <input style={s.input} type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={s.btnPrimary} disabled={saving}>
                {saving ? '…' : t.createAd}
              </button>
              <button type="button" style={s.btnSecondary} onClick={() => setShowCreate(false)}>
                {lang === 'da' ? 'Annuller' : 'Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Boost post section */}
      {showBoost && (
        <div style={s.formWrap}>
          <div style={s.formTitle}>🚀 {t.boostPost}</div>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{t.boostPostDesc}</p>
          {ownPosts.length === 0 ? (
            <div style={s.empty}>{t.selectPostToBoost}</div>
          ) : (
            ownPosts.slice(0, 10).map(post => {
              const text = post.text?.[lang] || post.text?.da || ''
              return (
                <div key={post.id} style={s.boostPost}>
                  <span style={s.boostPostText}>{text.slice(0, 80) || `Post #${post.id}`}</span>
                  <button
                    style={{ ...s.btnPrimary, padding: '5px 14px', fontSize: 12 }}
                    disabled={boosting === post.id}
                    onClick={() => handleBoost(post.id)}
                  >
                    {boosting === post.id ? '…' : '🚀 ' + t.boostPost}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Ad list */}
      <div className="p-card" style={{ padding: '16px 20px' }}>
        {loading ? (
          <div style={s.spinner}>…</div>
        ) : ads.length === 0 ? (
          <div style={s.empty}>{lang === 'da' ? 'Ingen annoncer endnu. Opret din første annonce ovenfor.' : 'No ads yet. Create your first ad above.'}</div>
        ) : (
          ads.map(ad => {
            const ctr = ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : '0.0'
            const spentPct = ad.budget > 0 ? Math.min(100, Math.round((ad.spent / ad.budget) * 100)) : 0
            return (
              <div key={ad.id} style={s.card}>
                <div style={s.adRow}>
                  <div style={s.adInfo}>
                    <p style={s.adName}>
                      {ad.boosted_post_id ? '🚀 ' : '📢 '}
                      {ad.title}
                    </p>
                    <p style={s.adUrl}>{ad.target_url}</p>
                    <span style={s.badge(ad.status)}>{statusLabel(ad.status)}</span>
                    {ad.budget > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 3 }}>
                          <span>{t.adSpent}: {formatPrice(ad.spent || 0)}</span>
                          <span>{t.adBudgetLabel}: {formatPrice(ad.budget)}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${spentPct}%`, background: spentPct >= 90 ? '#EF4444' : '#4338CA', borderRadius: 4 }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={s.stats}>
                    <div style={s.stat}>
                      <span style={s.statVal}>{(ad.impressions || 0).toLocaleString()}</span>
                      <span style={s.statLabel}>{t.adImpressions}</span>
                    </div>
                    <div style={s.stat}>
                      <span style={s.statVal}>{(ad.clicks || 0).toLocaleString()}</span>
                      <span style={s.statLabel}>{t.adClicks}</span>
                    </div>
                    <div style={s.stat}>
                      <span style={s.statVal}>{ctr}%</span>
                      <span style={s.statLabel}>{t.adCTR}</span>
                    </div>
                    <div style={s.stat}>
                      <span style={s.statVal}>{(ad.reach || 0).toLocaleString()}</span>
                      <span style={s.statLabel}>{t.adReach}</span>
                    </div>
                  </div>
                  <div style={s.actions}>
                    {ad.status === 'draft' && (
                      <button style={s.btnActivate} disabled={activating === ad.id} onClick={() => handleActivate(ad.id)}>
                        {activating === ad.id ? (t.adActivating || '…') : t.activateAd}
                      </button>
                    )}
                    {ad.status === 'paused' && (
                      <button style={s.btnReactivate} disabled={statusChanging === ad.id} onClick={() => handleStatusChange(ad.id, 'active')}>
                        {statusChanging === ad.id ? '…' : t.reactivateAd}
                      </button>
                    )}
                    {ad.status === 'active' && (
                      <button style={s.btnPause} disabled={statusChanging === ad.id} onClick={() => handleStatusChange(ad.id, 'paused')}>
                        {statusChanging === ad.id ? '…' : t.pauseAd}
                      </button>
                    )}
                    {(ad.status === 'draft' || ad.status === 'paused') && (
                      <button style={s.btnEdit} onClick={() => editingAdId === ad.id ? setEditingAdId(null) : handleEditOpen(ad)}>
                        {editingAdId === ad.id ? (lang === 'da' ? 'Luk' : 'Close') : t.editAd}
                      </button>
                    )}
                    {(ad.status === 'active' || ad.status === 'paused') && (
                      <button style={s.btnArchive} disabled={statusChanging === ad.id} onClick={() => handleStatusChange(ad.id, 'archived')}>
                        {t.archiveAd}
                      </button>
                    )}
                    {(ad.status === 'draft' || ad.status === 'paused' || ad.status === 'archived') && (
                      <button style={s.btnDanger} onClick={() => handleDelete(ad.id)}>
                        {lang === 'da' ? 'Slet' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
                {editingAdId === ad.id && (
                  <form onSubmit={e => handleEditSave(e, ad.id)} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F0EDE8' }}>
                    <div style={s.twoCol}>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adTitle}</label>
                        <input style={s.input} value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} required />
                      </div>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adTargetUrl}</label>
                        <input style={s.input} type="url" value={editForm.target_url} onChange={e => setEditForm(p => ({ ...p, target_url: e.target.value }))} required />
                      </div>
                    </div>
                    <div style={s.formRow}>
                      <label style={s.label}>{t.adBody}</label>
                      <input style={s.input} value={editForm.body} onChange={e => setEditForm(p => ({ ...p, body: e.target.value }))} />
                    </div>
                    <div style={s.twoCol}>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adImageUrl}</label>
                        <input style={s.input} value={editForm.image_url} onChange={e => setEditForm(p => ({ ...p, image_url: e.target.value }))} />
                      </div>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adBudget}</label>
                        <input style={s.input} type="number" min="1" step="0.01" value={editForm.budget} onChange={e => setEditForm(p => ({ ...p, budget: e.target.value }))} />
                      </div>
                    </div>
                    <div style={s.twoCol}>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adStartDate}</label>
                        <input style={s.input} type="date" value={editForm.start_date} onChange={e => setEditForm(p => ({ ...p, start_date: e.target.value }))} />
                      </div>
                      <div style={s.formRow}>
                        <label style={s.label}>{t.adEndDate}</label>
                        <input style={s.input} type="date" value={editForm.end_date} onChange={e => setEditForm(p => ({ ...p, end_date: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" style={s.btnPrimary} disabled={editSaving}>
                        {editSaving ? '…' : t.adsSave}
                      </button>
                      <button type="button" style={s.btnSecondary} onClick={() => setEditingAdId(null)}>
                        {lang === 'da' ? 'Annuller' : 'Cancel'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
