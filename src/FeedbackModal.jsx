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

  const s = {
    backdrop: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    },
    modal: {
      background: 'var(--color-card, #fff)', borderRadius: 14, padding: 24,
      width: '100%', maxWidth: 480, position: 'relative', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    },
    closeBtn: {
      position: 'absolute', top: 12, right: 14, background: 'none', border: 'none',
      fontSize: 18, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4,
    },
    title: { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--color-text, #111)' },
    subtitle: { margin: '0 0 18px', fontSize: 13, color: '#666', lineHeight: 1.5 },
    label: { fontSize: 12, fontWeight: 600, color: '#666', display: 'block', marginBottom: 5 },
    input: {
      width: '100%', padding: '9px 12px', border: '1px solid #E8E4DF', borderRadius: 8,
      fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
      background: 'var(--color-input-bg, #fff)', color: 'var(--color-text, #111)',
    },
    typeBtn: (active) => ({
      padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
      fontSize: 13, fontWeight: active ? 700 : 500,
      background: active ? '#2D6A4F' : '#f0f0ec',
      color: active ? '#fff' : '#444',
      transition: 'all 0.15s',
    }),
    submitBtn: (disabled) => ({
      padding: '9px 22px', borderRadius: 8, border: 'none', background: '#2D6A4F',
      color: '#fff', fontWeight: 700, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }),
  }

  return (
    <div style={s.backdrop} onClick={handleClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <button style={s.closeBtn} onClick={handleClose} aria-label="Luk">✕</button>
        <h2 style={s.title}>💬 {t.aboutFeedbackTitle}</h2>
        <p style={s.subtitle}>{t.aboutFeedbackSubtitle}</p>

        {status === 'done' ? (
          <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 15, color: '#2D6A4F', fontWeight: 600 }}>
            ✓ {t.aboutFeedbackDone}
            <div style={{ marginTop: 16 }}>
              <button style={s.submitBtn(false)} onClick={handleClose}>{t.close || 'Luk'}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <div style={s.label}>{t.aboutFeedbackTypeLabel}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { key: 'bug', label: `🐛 ${t.aboutFeedbackTypeBug}` },
                  { key: 'missing', label: `🔍 ${t.aboutFeedbackTypeMissing}` },
                  { key: 'suggestion', label: `💡 ${t.aboutFeedbackTypeSuggestion}` },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFbType(opt.key)}
                    style={s.typeBtn(fbType === opt.key)}
                  >{opt.label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>{t.aboutFeedbackTitleLabel}</label>
              <input
                style={s.input}
                value={fbTitle}
                onChange={e => { setFbTitle(e.target.value); if (status === 'error') setStatus('idle') }}
                placeholder={t.aboutFeedbackTitlePlaceholder}
                maxLength={200}
                required
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>{t.aboutFeedbackDescLabel}</label>
              <textarea
                style={{ ...s.input, minHeight: 90, resize: 'vertical' }}
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
              disabled={status === 'sending' || !fbTitle.trim() || !fbDesc.trim()}
              style={s.submitBtn(status === 'sending' || !fbTitle.trim() || !fbDesc.trim())}
            >
              {status === 'sending' ? '…' : t.aboutFeedbackSubmit}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
