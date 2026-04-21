import { getTheme, CONTEXT_TO_THEME } from './userTypeTheme.js'

export default function PostComposer({
  activeContext,
  t,
  lang,
  value,
  onChange,
  onSubmit,
  submitting,
  children,
}) {
  const theme = getTheme(CONTEXT_TO_THEME[activeContext] || 'private')

  const postingInLabel = t?.composer?.posting_in?.[activeContext]
    || `${activeContext}`

  const placeholder = t?.composer?.placeholder || "What's on your mind?"
  const submitLabel = t?.composer?.submit || 'Post'

  return (
    <div style={{ ...s.wrap, borderTop: `3px solid ${theme.color}`, background: theme.colorLight }}>
      <div style={{ ...s.contextPill, background: theme.badgeBg, color: theme.badgeText, borderColor: theme.color }}>
        {postingInLabel}
      </div>
      <textarea
        style={{ ...s.textarea, borderColor: theme.color }}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        rows={3}
        lang={lang}
      />
      {children}
      <div style={s.footer}>
        <button
          onClick={onSubmit}
          disabled={submitting || !value?.trim()}
          style={{
            ...s.submitBtn,
            background: theme.color,
            opacity: (submitting || !value?.trim()) ? 0.6 : 1,
            cursor: (submitting || !value?.trim()) ? 'not-allowed' : 'pointer',
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

const s = {
  wrap: {
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    padding: '14px 16px',
    marginBottom: 16,
  },
  contextPill: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 20,
    padding: '3px 12px',
    marginBottom: 10,
    border: '1.5px solid',
    letterSpacing: '0.02em',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1.5px solid',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
    outline: 'none',
    lineHeight: 1.5,
    background: '#fff',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  submitBtn: {
    padding: '8px 22px',
    borderRadius: 8,
    border: 'none',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    transition: 'opacity 0.15s',
  },
}
