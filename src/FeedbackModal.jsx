import { useState } from 'react'
import { apiSubmitFeedback } from './api.js'

export default function FeedbackModal({ open, onClose, t }) {
  const [fbType, setFbType] = useState('bug')
  const [fbTitle, setFbTitle] = useState('')
  const [fbDesc, setFbDesc] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | done | error

  if (!open) return null

  const reset = () => {
    setFbType('bug')
    setFbTitle('')
    setFbDesc('')
    setStatus('idle')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!fbTitle.trim() || !fbDesc.trim()) return
    setStatus('sending')
    const res = await apiSubmitFeedback(fbType, fbTitle.trim(), fbDesc.trim())
    if (res?.ok) {
      setStatus('done')
      setFbTitle('')
      setFbDesc('')
    } else {
      setStatus('error')
    }
  }

  const typeBtnStyle = (active) => ({
    fontWeight: active ? 700 : 500,
    background: active ? '#2D6A4F' : '#f0f0ec',
    color: active ? '#fff' : '#444',
  })

  const submitDisabled = status === 'sending' || !fbTitle.trim() || !fbDesc.trim()

  return (
    <div className="feedback-overlay" onClick={handleClose}>
      <div className="feedback-modal" onClick={e => e.stopPropagation()}>
        <button className="feedback-close-btn" onClick={handleClose} aria-label="Luk">✕</button>
        <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--color-text, #111)' }}>💬 {t.aboutFeedbackTitle}</h2>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#666', lineHeight: 1.5 }}>{t.aboutFeedbackSubtitle}</p>

        {status === 'done' ? (
          <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 15, color: '#2D6A4F', fontWeight: 600 }}>
            ✓ {t.aboutFeedbackDone}
            <div style={{ marginTop: 16 }}>
              <button
                className="feedback-submit-btn"
                style={{ cursor: 'pointer' }}
                onClick={handleClose}
              >
                {t.close || 'Luk'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <div className="feedback-label">{t.aboutFeedbackTypeLabel}</div>
              <div className="feedback-type-row">
                {[
                  { key: 'bug', label: `🐛 ${t.aboutFeedbackTypeBug}` },
                  { key: 'missing', label: `🔍 ${t.aboutFeedbackTypeMissing}` },
                  { key: 'suggestion', label: `💡 ${t.aboutFeedbackTypeSuggestion}` },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFbType(opt.key)}
                    className="feedback-type-btn"
                    style={typeBtnStyle(fbType === opt.key)}
                  >{opt.label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="feedback-label">{t.aboutFeedbackTitleLabel}</label>
              <input
                className="feedback-input"
                value={fbTitle}
                onChange={e => { setFbTitle(e.target.value); if (status === 'error') setStatus('idle') }}
                placeholder={t.aboutFeedbackTitlePlaceholder}
                maxLength={200}
                required
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="feedback-label">{t.aboutFeedbackDescLabel}</label>
              <textarea
                className="feedback-input"
                style={{ minHeight: 90, resize: 'vertical' }}
                value={fbDesc}
                onChange={e => { setFbDesc(e.target.value); if (status === 'error') setStatus('idle') }}
                placeholder={t.aboutFeedbackDescPlaceholder}
                rows={4}
                required
              />
            </div>

            {status === 'error' && (
              <div style={{ fontSize: 13, color: '#C0392B', marginBottom: 10 }}>{t.aboutFeedbackError}</div>
            )}

            <button
              type="submit"
              disabled={submitDisabled}
              className="feedback-submit-btn"
              style={{ cursor: submitDisabled ? 'not-allowed' : 'pointer', opacity: submitDisabled ? 0.6 : 1 }}
            >
              {status === 'sending' ? '…' : t.aboutFeedbackSubmit}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
