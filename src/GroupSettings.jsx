import { useState, useEffect, useRef } from 'react'
import { apiGetGroup, apiUpdateGroupSettings, apiDeleteOwnGroup, apiUploadGroupCover } from './api.js'
import { getTranslations } from './data.js'

const VALID_TYPES = ['public', 'private', 'hidden']
const VALID_CATEGORIES = ['interest', 'local', 'professional', 'event', 'other']

export default function GroupSettings({ slug, lang, onNavigate }) {
  const t = getTranslations(lang)
  const g = t?.groups || {}

  const [group, setGroup] = useState(null)
  const [loadState, setLoadState] = useState('loading')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('public')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverMsg, setCoverMsg] = useState(null)
  const [typeTooltip, setTypeTooltip] = useState(false)
  const [catTooltip, setCatTooltip] = useState(false)
  const coverInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    apiGetGroup(slug).then(data => {
      if (cancelled) return
      if (!data || data.error) { setLoadState('not_found'); return }
      setGroup(data)
      setName(data.name || '')
      setDescription(data.description_da || data.description || '')
      setType(data.type || 'public')
      setCategory(data.category || '')
      setLoadState('ready')
    })
    return () => { cancelled = true }
  }, [slug])

  const handleSave = async () => {
    if (!name.trim() || !group) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const res = await apiUpdateGroupSettings(group.id, {
      name: name.trim(),
      description,
      type,
      category: category || undefined,
    })
    setSaving(false)
    if (res?.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError(g.errorGeneric)
    }
  }

  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !group) return
    setCoverUploading(true)
    setCoverMsg(null)
    const res = await apiUploadGroupCover(group.id, file)
    setCoverUploading(false)
    if (res?.coverUrl) {
      setGroup(prev => ({ ...prev, cover_url: res.coverUrl }))
      setCoverMsg('ok')
    } else {
      setCoverMsg('err')
    }
    setTimeout(() => setCoverMsg(null), 3000)
    e.target.value = ''
  }

  const handleDelete = async () => {
    if (!group) return
    if (!window.confirm(g.deleteGroupConfirm)) return
    setDeleting(true)
    const res = await apiDeleteOwnGroup(group.id)
    setDeleting(false)
    if (res?.ok) {
      onNavigate?.('/groups')
    } else {
      setError(g.errorGeneric)
    }
  }

  const s = {
    wrap: { maxWidth: 600, margin: '0 auto', padding: '20px 16px' },
    back: { background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 4 },
    title: { fontSize: 20, fontWeight: 700, color: '#1A1A1A', marginBottom: 24 },
    section: { background: '#fff', borderRadius: 12, border: '1px solid #E8E4DF', padding: '20px', marginBottom: 16 },
    label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
    textarea: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, outline: 'none', resize: 'vertical', minHeight: 80, boxSizing: 'border-box' },
    select: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E8E4DF', fontSize: 14, outline: 'none', background: '#fff', boxSizing: 'border-box' },
    row: { marginBottom: 16 },
    saveBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#5B4FCF', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
    savedMsg: { color: '#2E7D32', fontSize: 13, marginLeft: 12 },
    errorMsg: { color: '#C62828', fontSize: 13, marginTop: 8 },
    dangerSection: { background: '#FFF5F5', borderRadius: 12, border: '1.5px solid #FECACA', padding: '20px', marginBottom: 16 },
    dangerTitle: { fontSize: 15, fontWeight: 700, color: '#991B1B', marginBottom: 12 },
    deleteBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#DC2626', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: deleting ? 0.6 : 1 },
    coverPreview: { width: '100%', height: 120, borderRadius: 8, objectFit: 'cover', marginBottom: 8, display: 'block' },
    coverPlaceholder: { width: '100%', height: 120, borderRadius: 8, background: 'linear-gradient(135deg,#5B4FCF 0%,#8B7FE8 100%)', marginBottom: 8 },
    coverBtn: { padding: '8px 16px', borderRadius: 8, border: '1.5px solid #5B4FCF', background: '#fff', color: '#5B4FCF', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
    labelRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
    infoBtn: { background: 'none', border: '1.5px solid #aaa', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', color: '#777', lineHeight: '15px', padding: 0, flexShrink: 0 },
    tooltip: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: '#111', color: '#eee', fontSize: 12, lineHeight: 1.5, padding: '8px 12px', borderRadius: 8, zIndex: 50, pointerEvents: 'none', width: 240, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', whiteSpace: 'pre-wrap' },
  }

  if (loadState === 'loading') {
    return <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{g.loading}</div>
  }
  if (loadState === 'not_found') {
    return <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>{g.notFound}</div>
  }

  return (
    <div style={s.wrap}>
      <button style={s.back} onClick={() => onNavigate?.(`/groups/${slug}`)}>
        {'← '}{g.back}
      </button>
      <div style={s.title}>{g.settingsTitle}</div>

      <div style={s.section}>
        <div style={s.row}>
          <label style={s.label}>{g.coverLabel}</label>
          {group?.cover_url
            ? <img src={group.cover_url} alt="" style={s.coverPreview} />
            : <div style={s.coverPlaceholder} />
          }
          <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload} />
          <button style={s.coverBtn} onClick={() => coverInputRef.current?.click()} disabled={coverUploading}>
            {coverUploading ? '...' : (group?.cover_url ? g.coverChange : g.coverUpload)}
          </button>
          {coverMsg === 'ok' && <span style={{ color: '#2E7D32', fontSize: 13, marginLeft: 10 }}>✓ {g.coverUploadDone}</span>}
          {coverMsg === 'err' && <span style={{ color: '#C62828', fontSize: 13, marginLeft: 10 }}>{g.coverUploadError}</span>}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.row}>
          <label style={s.label}>{g.nameLabel}</label>
          <input style={s.input} value={name} onChange={e => setName(e.target.value)} maxLength={100} />
        </div>
        <div style={s.row}>
          <label style={s.label}>{g.descLabel}</label>
          <textarea style={s.textarea} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
        </div>
        <div style={s.row}>
          <div style={s.labelRow}>
            <span style={{ ...s.label, marginBottom: 0 }}>{g.typeLabel}</span>
            <div style={{ position: 'relative' }}>
              <button style={s.infoBtn} onMouseEnter={() => setTypeTooltip(true)} onMouseLeave={() => setTypeTooltip(false)}>?</button>
              {typeTooltip && <div style={s.tooltip}>{g.typeTooltip}</div>}
            </div>
          </div>
          <select style={s.select} value={type} onChange={e => setType(e.target.value)}>
            {VALID_TYPES.map(tp => (
              <option key={tp} value={tp}>{g.type?.[tp] || tp}</option>
            ))}
          </select>
        </div>
        <div style={{ ...s.row, marginBottom: 0 }}>
          <div style={s.labelRow}>
            <span style={{ ...s.label, marginBottom: 0 }}>{g.categoryLabel}</span>
            <div style={{ position: 'relative' }}>
              <button style={s.infoBtn} onMouseEnter={() => setCatTooltip(true)} onMouseLeave={() => setCatTooltip(false)}>?</button>
              {catTooltip && <div style={s.tooltip}>{g.categoryTooltip}</div>}
            </div>
          </div>
          <select style={s.select} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">{g.allCategories}</option>
            {VALID_CATEGORIES.map(c => (
              <option key={c} value={c}>{g.category?.[c] || c}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <button style={s.saveBtn} onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? '...' : g.saveSettings}
        </button>
        {saved && <span style={s.savedMsg}>✓ {g.settingsSaved}</span>}
      </div>

      {error && <div style={s.errorMsg}>{error}</div>}

      <div style={s.dangerSection}>
        <div style={s.dangerTitle}>{g.dangerZone}</div>
        <button style={s.deleteBtn} onClick={handleDelete} disabled={deleting}>
          {deleting ? '...' : g.deleteGroup}
        </button>
      </div>
    </div>
  )
}
