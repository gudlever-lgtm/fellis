import { useState, useEffect } from 'react'
import { apiGetGroup, apiUpdateGroupSettings, apiDeleteOwnGroup } from './api.js'
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
          <label style={s.label}>{g.nameLabel}</label>
          <input style={s.input} value={name} onChange={e => setName(e.target.value)} maxLength={100} />
        </div>
        <div style={s.row}>
          <label style={s.label}>{g.descLabel}</label>
          <textarea style={s.textarea} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
        </div>
        <div style={s.row}>
          <label style={s.label}>{g.typeLabel}</label>
          <select style={s.select} value={type} onChange={e => setType(e.target.value)}>
            {VALID_TYPES.map(tp => (
              <option key={tp} value={tp}>{g.type?.[tp] || tp}</option>
            ))}
          </select>
        </div>
        <div style={{ ...s.row, marginBottom: 0 }}>
          <label style={s.label}>{g.categoryLabel}</label>
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
