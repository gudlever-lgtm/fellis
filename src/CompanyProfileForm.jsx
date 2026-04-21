import { useState } from 'react'
import { getTranslations } from './data.js'
import { apiCreateCompanyProfile } from './api.js'

const CATEGORIES = [
  'technology', 'retail', 'food_beverage', 'health', 'finance',
  'education', 'media', 'consulting', 'manufacturing', 'other',
]

const AMBER = '#D97706'
const AMBER_LIGHT = '#FFFBEB'
const AMBER_MID = '#FDE68A'
const AMBER_BORDER = '#FCD34D'
const AMBER_DARK = '#92400E'
const AMBER_TEXT = '#78350F'

export default function CompanyProfileForm({ lang, currentUser, initialData, onSuccess, onCancel }) {
  const t = getTranslations(lang)
  const tf = t.company?.form || {}
  const tc = t.company?.categories || {}

  const isEdit = !!initialData

  const [companyName, setCompanyName] = useState(initialData?.company_name || '')
  const [cvr, setCvr] = useState(initialData?.cvr || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [category, setCategory] = useState(initialData?.category || '')
  const [website, setWebsite] = useState(initialData?.website || '')
  const [logoUrl, setLogoUrl] = useState(initialData?.logo_url || '')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  if (currentUser?.mode !== 'business') {
    return (
      <div style={{ maxWidth: 560, margin: '40px auto', padding: '32px 24px', borderRadius: 16, background: AMBER_LIGHT, border: `2px solid ${AMBER_BORDER}`, textAlign: 'center' }}>
        <p style={{ color: AMBER_DARK, fontWeight: 700, fontSize: 15, margin: '0 0 16px' }}>
          {tf.guard_error || 'Business account required'}
        </p>
        <button onClick={onCancel} style={s.cancelBtn}>
          {tf.cancel || 'Cancel'}
        </button>
      </div>
    )
  }

  function validate() {
    const errs = {}
    if (!companyName.trim()) errs.company_name = tf.company_name_required || 'Company name is required'
    if (cvr && !/^\d{1,8}$/.test(cvr.trim())) errs.cvr = tf.cvr_format_error || 'CVR must be max 8 digits'
    if (!category) errs.category = tf.category_required || 'Please select a category'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSubmitting(true)
    setServerError('')
    const result = await apiCreateCompanyProfile({
      company_name: companyName.trim(),
      cvr: cvr.trim() || null,
      description: description.trim() || null,
      category,
      website: website.trim() || null,
      logo_url: logoUrl.trim() || null,
    })
    setSubmitting(false)
    if (!result || result.error) {
      setServerError(result?.error || 'Server error')
      return
    }
    onSuccess(result.profile)
  }

  const descCharsLeft = 500 - description.length

  return (
    <div style={s.page}>
      {/* Amber header banner */}
      <div style={s.banner}>
        <div style={s.bannerIcon}>🏢</div>
        <div>
          <h2 style={s.bannerTitle}>
            {companyName.trim() || tf.heading_placeholder || 'Your Company'}
          </h2>
          <p style={s.bannerSub}>
            {isEdit ? (tf.heading_edit || 'Edit Company') : (tf.heading || 'Create Company Profile')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={s.form} noValidate>

        {/* Company name */}
        <div style={s.field}>
          <label style={s.label}>
            {tf.company_name_label || 'Company name'} <span style={s.required}>*</span>
          </label>
          <input
            style={{ ...s.input, ...(errors.company_name ? s.inputError : {}) }}
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder={tf.company_name_placeholder || 'Enter company name…'}
            maxLength={255}
            autoFocus
          />
          {errors.company_name && <span style={s.errMsg}>{errors.company_name}</span>}
        </div>

        {/* Category */}
        <div style={s.field}>
          <label style={s.label}>
            {tf.category_label || 'Category'} <span style={s.required}>*</span>
          </label>
          <select
            style={{ ...s.input, ...s.select, ...(errors.category ? s.inputError : {}) }}
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="">{tf.category_placeholder || 'Select a category'}</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{tc[c] || c}</option>
            ))}
          </select>
          {errors.category && <span style={s.errMsg}>{errors.category}</span>}
        </div>

        {/* CVR */}
        <div style={s.field}>
          <label style={s.label}>{tf.cvr_label || 'CVR number'}</label>
          <input
            style={{ ...s.input, ...(errors.cvr ? s.inputError : {}) }}
            type="text"
            value={cvr}
            onChange={e => setCvr(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder={tf.cvr_placeholder || '12345678'}
            maxLength={8}
          />
          <span style={s.hint}>{tf.cvr_hint || 'Optional · Max 8 digits'}</span>
          {errors.cvr && <span style={s.errMsg}>{errors.cvr}</span>}
        </div>

        {/* Description */}
        <div style={s.field}>
          <label style={s.label}>{tf.description_label || 'Description'}</label>
          <textarea
            style={{ ...s.input, minHeight: 90, resize: 'vertical', ...(description.length > 500 ? s.inputError : {}) }}
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 500))}
            placeholder={tf.description_placeholder || 'Tell us about your company…'}
          />
          <span style={{ ...s.hint, color: descCharsLeft < 50 ? '#B45309' : '#9CA3AF' }}>
            {descCharsLeft} {tf.description_chars_left || 'characters left'}
          </span>
        </div>

        {/* Website */}
        <div style={s.field}>
          <label style={s.label}>{tf.website_label || 'Website'}</label>
          <input
            style={s.input}
            type="url"
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder={tf.website_placeholder || 'https://mycompany.com'}
          />
          <span style={s.hint}>{tf.website_hint || 'Must start with https://'}</span>
        </div>

        {/* Logo URL */}
        <div style={s.field}>
          <label style={s.label}>{tf.logo_url_label || 'Logo URL'}</label>
          <input
            style={s.input}
            type="text"
            value={logoUrl}
            onChange={e => setLogoUrl(e.target.value)}
            placeholder={tf.logo_url_placeholder || 'https://...'}
          />
          <span style={s.hint}>{tf.logo_url_hint || 'Phase 2: upload feature coming soon'}</span>
        </div>

        {serverError && (
          <p style={s.serverErr}>{serverError}</p>
        )}

        <div style={s.actions}>
          <button
            type="button"
            onClick={onCancel}
            style={s.cancelBtn}
            disabled={submitting}
          >
            {tf.cancel || 'Cancel'}
          </button>
          <button
            type="submit"
            style={{ ...s.submitBtn, opacity: submitting ? 0.7 : 1 }}
            disabled={submitting}
          >
            {submitting
              ? (tf.submitting || 'Saving…')
              : (tf.submit || 'Save company profile')}
          </button>
        </div>
      </form>
    </div>
  )
}

const s = {
  page: {
    maxWidth: 560,
    margin: '0 auto',
    paddingBottom: 32,
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '24px 24px 20px',
    background: `linear-gradient(135deg, ${AMBER} 0%, #F59E0B 100%)`,
    borderRadius: '16px 16px 0 0',
    color: '#fff',
  },
  bannerIcon: {
    fontSize: 36,
    lineHeight: 1,
    flexShrink: 0,
  },
  bannerTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: '#fff',
    lineHeight: 1.2,
  },
  bannerSub: {
    margin: '2px 0 0',
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: 500,
  },
  form: {
    background: '#fff',
    border: `1px solid ${AMBER_BORDER}`,
    borderTop: 'none',
    borderRadius: '0 0 16px 16px',
    padding: '24px 24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: AMBER_TEXT,
  },
  required: {
    color: '#EF4444',
    marginLeft: 2,
  },
  input: {
    padding: '9px 12px',
    borderRadius: 8,
    border: `1.5px solid ${AMBER_BORDER}`,
    fontSize: 14,
    color: '#1F2937',
    background: AMBER_LIGHT,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  select: {
    cursor: 'pointer',
    appearance: 'auto',
  },
  inputError: {
    borderColor: '#EF4444',
    background: '#FEF2F2',
  },
  hint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  errMsg: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: 600,
    marginTop: 2,
  },
  serverErr: {
    fontSize: 13,
    color: '#B91C1C',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: 8,
    padding: '8px 12px',
    margin: 0,
  },
  actions: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    paddingTop: 4,
  },
  cancelBtn: {
    padding: '9px 20px',
    borderRadius: 8,
    border: `1.5px solid ${AMBER_BORDER}`,
    background: '#fff',
    color: AMBER_DARK,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '9px 24px',
    borderRadius: 8,
    border: 'none',
    background: AMBER,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: `0 2px 8px ${AMBER}44`,
  },
}
