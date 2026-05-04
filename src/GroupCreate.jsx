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

  if (success) {
    return (
      <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
        <div className="modal-box">
          <p style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>✓ {g.createTitle}</p>
          <p className="gcreate-success-msg">{g.pendingApproval}</p>
          <div className="modal-footer">
            <button className="gcreate-submit-btn" onClick={onClose}>{g.cancel}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <form className="modal-box" onSubmit={handleSubmit}>
        <p style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>{g.createTitle}</p>

        <div>
          <label className="gcreate-label">{g.nameLabel} *</label>
          <input
            className="gcreate-input"
            value={name}
            onChange={handleNameChange}
            placeholder={g.namePlaceholder}
            required
          />
          {slug && (
            <div className="gcreate-slug-row">
              fellis.eu/groups/<input
                className="gcreate-input gcreate-slug-input"
                value={slug}
                onChange={handleSlugChange}
              />
            </div>
          )}
        </div>

        <div>
          <label className="gcreate-label">{g.descLabel}</label>
          <textarea
            className="gcreate-textarea"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={g.descPlaceholder}
          />
        </div>

        <div>
          <label className="gcreate-label">{g.typeLabel}</label>
          <div className="gcreate-radio-group">
            {TYPES.map(tp => (
              <label key={tp} className="gcreate-radio-label">
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
          <label className="gcreate-label">{g.categoryLabel}</label>
          <select className="gcreate-select" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{g.category?.[cat] || cat}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="gcreate-label">{g.tagsLabel}</label>
          <div className="gcreate-tags-wrap">
            {tags.map(tag => (
              <span key={tag} className="gcreate-tag">
                {tag}
                <button type="button" className="gcreate-tag-remove" onClick={() => removeTag(tag)}>✕</button>
              </span>
            ))}
            <input
              className="gcreate-tag-input"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? g.tagsPlaceholder : ''}
            />
          </div>
        </div>

        <div>
          <label className="gcreate-label">{g.coverLabel}</label>
          <div className="gcreate-cover-area" onClick={() => fileRef.current?.click()}>
            {coverPreview
              ? <img src={coverPreview} alt="" className="gcreate-cover-preview" />
              : (
                <div className="gcreate-cover-placeholder">
                  📷 {g.coverUpload}
                </div>
              )
            }
            {coverPreview && (
              <div className="gcreate-cover-change-badge">
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

        {error && <p className="gcreate-error-msg">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="gcreate-cancel-btn" onClick={onClose}>{g.cancel}</button>
          <button
            type="submit"
            className="gcreate-submit-btn"
            style={{ cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            disabled={submitting || !name.trim()}
          >
            {submitting ? '…' : g.submit}
          </button>
        </div>
      </form>
    </div>
  )
}
