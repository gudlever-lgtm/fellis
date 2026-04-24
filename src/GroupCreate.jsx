import { useState, useRef } from 'react'
import { getTranslations } from './data.js'
import { apiCreateGroup, apiUploadGroupCover } from './api.js'

const CATEGORIES = ['interest', 'local', 'professional', 'event', 'other']
const TYPES = ['public', 'private', 'hidden']

function nameToSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function GroupCreate({ lang, onClose, onCreated }) {
  const t = getTranslations(lang)
  const g = t.groups || {}

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [type, setType] = useState('public')
  const [category, setCategory] = useState('interest')
  const [tags, setTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const fileRef = useRef(null)

  const handleNameChange = (e) => {
    const val = e.target.value
    setName(val)
    if (!slugEdited) setSlug(nameToSlug(val))
  }

  const handleSlugChange = (e) => {
    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    setSlugEdited(true)
  }

  const handleTagKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag) && tags.length < 20) {
      setTags(prev => [...prev, tag])
    }
    setTagInput('')
  }

  const removeTag = (tag) => setTags(prev => prev.filter(t => t !== tag))

  const handleCoverChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return
    setSubmitting(true)
    setError('')

    const res = await apiCreateGroup({ name: name.trim(), slug, description, type, category, tags })
    if (!res) {
      setError(g.errorGeneric)
      setSubmitting(false)
      return
    }

    if (coverFile && res.id) {
      await apiUploadGroupCover(res.id, coverFile)
    }

    setSubmitting(false)
    setSuccess(true)
    onCreated?.(res)
  }

  const s = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    modal: {
      background: '#fff',
      borderRadius: 18,
      padding: '28px 28px 24px',
      width: '100%',
      maxWidth: 500,
      maxHeight: '90vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    },
    title: { fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0 },
    label: { fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 6, display: 'block' },
    input: {
      width: '100%',
      padding: '10px 12px',
      borderRadius: 10,
      border: '1.5px solid #E0DDD8',
      fontSize: 14,
      outline: 'none',
      boxSizing: 'border-box',
    },
    textarea: {
      width: '100%',
      padding: '10px 12px',
      borderRadius: 10,
      border: '1.5px solid #E0DDD8',
      fontSize: 14,
      resize: 'vertical',
      minHeight: 80,
      outline: 'none',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
    slugRow: { fontSize: 12, color: '#888', marginTop: 4 },
    radioGroup: { display: 'flex', gap: 12, flexWrap: 'wrap' },
    radioLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' },
    select: {
      padding: '10px 12px',
      borderRadius: 10,
      border: '1.5px solid #E0DDD8',
      fontSize: 14,
      background: '#fff',
      outline: 'none',
      width: '100%',
    },
    tagsWrap: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      padding: '8px 10px',
      borderRadius: 10,
      border: '1.5px solid #E0DDD8',
      minHeight: 42,
      alignItems: 'center',
    },
    tag: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 12,
      fontWeight: 600,
      padding: '3px 9px',
      borderRadius: 20,
      background: '#EEF2FF',
      color: '#4338CA',
    },
    tagRemove: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: 13,
      color: '#888',
      padding: 0,
      lineHeight: 1,
    },
    tagInput: {
      border: 'none',
      outline: 'none',
      fontSize: 14,
      minWidth: 120,
      flex: 1,
      fontFamily: 'inherit',
    },
    coverArea: {
      border: '2px dashed #E0DDD8',
      borderRadius: 10,
      overflow: 'hidden',
      cursor: 'pointer',
      position: 'relative',
    },
    coverPreview: { width: '100%', height: 120, objectFit: 'cover', display: 'block' },
    coverPlaceholder: {
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: '#999',
      fontSize: 14,
    },
    errorMsg: {
      fontSize: 13,
      color: '#c00',
      background: '#fff5f5',
      border: '1px solid #fcc',
      borderRadius: 8,
      padding: '8px 12px',
    },
    successMsg: {
      fontSize: 14,
      color: '#2E7D32',
      background: '#E8F5E9',
      border: '1px solid #A5D6A7',
      borderRadius: 10,
      padding: '12px 16px',
      fontWeight: 600,
    },
    footer: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
    cancelBtn: {
      padding: '10px 20px',
      borderRadius: 10,
      border: '1.5px solid #E0DDD8',
      background: 'transparent',
      fontSize: 14,
      cursor: 'pointer',
    },
    submitBtn: {
      padding: '10px 22px',
      borderRadius: 10,
      border: 'none',
      background: '#4338CA',
      color: '#fff',
      fontSize: 14,
      fontWeight: 700,
      cursor: submitting ? 'default' : 'pointer',
      opacity: submitting ? 0.7 : 1,
    },
  }

  if (success) {
    return (
      <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
        <div style={s.modal}>
          <p style={s.title}>✓ {g.createTitle}</p>
          <p style={s.successMsg}>{g.pendingApproval}</p>
          <div style={s.footer}>
            <button style={s.submitBtn} onClick={onClose}>{g.cancel}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <form style={s.modal} onSubmit={handleSubmit}>
        <p style={s.title}>{g.createTitle}</p>

        <div>
          <label style={s.label}>{g.nameLabel} *</label>
          <input
            style={s.input}
            value={name}
            onChange={handleNameChange}
            placeholder={g.namePlaceholder}
            required
          />
          {slug && (
            <div style={s.slugRow}>
              fellis.eu/groups/<input
                style={{ ...s.input, display: 'inline', width: 'auto', padding: '2px 6px', fontSize: 12, marginLeft: 2 }}
                value={slug}
                onChange={handleSlugChange}
              />
            </div>
          )}
        </div>

        <div>
          <label style={s.label}>{g.descLabel}</label>
          <textarea
            style={s.textarea}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={g.descPlaceholder}
          />
        </div>

        <div>
          <label style={s.label}>{g.typeLabel}</label>
          <div style={s.radioGroup}>
            {TYPES.map(tp => (
              <label key={tp} style={s.radioLabel}>
                <input
                  type="radio"
                  name="group-type"
                  value={tp}
                  checked={type === tp}
                  onChange={() => setType(tp)}
                />
                {g.type?.[tp] || tp}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={s.label}>{g.categoryLabel}</label>
          <select style={s.select} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{g.category?.[cat] || cat}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={s.label}>{g.tagsLabel}</label>
          <div style={s.tagsWrap}>
            {tags.map(tag => (
              <span key={tag} style={s.tag}>
                {tag}
                <button type="button" style={s.tagRemove} onClick={() => removeTag(tag)}>✕</button>
              </span>
            ))}
            <input
              style={s.tagInput}
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? g.tagsPlaceholder : ''}
            />
          </div>
        </div>

        <div>
          <label style={s.label}>{g.coverLabel}</label>
          <div style={s.coverArea} onClick={() => fileRef.current?.click()}>
            {coverPreview
              ? <img src={coverPreview} alt="" style={s.coverPreview} />
              : (
                <div style={s.coverPlaceholder}>
                  📷 {g.coverUpload}
                </div>
              )
            }
            {coverPreview && (
              <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, fontWeight: 700, background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 6, padding: '3px 8px' }}>
                {g.coverChange}
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleCoverChange}
          />
        </div>

        {error && <p style={s.errorMsg}>{error}</p>}

        <div style={s.footer}>
          <button type="button" style={s.cancelBtn} onClick={onClose}>{g.cancel}</button>
          <button type="submit" style={s.submitBtn} disabled={submitting || !name.trim()}>
            {submitting ? '…' : g.submit}
          </button>
        </div>
      </form>
    </div>
  )
}
