import { useInstallPrompt } from '../hooks/useInstallPrompt.js'
import { getTranslations } from '../data.js'

export default function InstallPrompt({ lang }) {
  const { canInstall, showIOSTip, triggerInstall, dismiss } = useInstallPrompt()
  const t = getTranslations(lang)

  if (!canInstall && !showIOSTip) return null

  const s = {
    banner: {
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9000,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: '#fff',
      border: '1px solid #E8E4DF',
      borderRadius: 16,
      padding: '12px 16px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      maxWidth: 'calc(100vw - 32px)',
      width: 380,
    },
    logo: {
      width: 40,
      height: 40,
      borderRadius: 10,
      flexShrink: 0,
      background: '#2D6A4F',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Playfair Display', serif",
      color: '#fff',
      fontSize: 18,
      fontWeight: 700,
    },
    text: { flex: 1, minWidth: 0 },
    title: {
      fontSize: 14,
      fontWeight: 600,
      color: '#2D3436',
      fontFamily: "'DM Sans', sans-serif",
      marginBottom: 2,
    },
    subtitle: {
      fontSize: 12,
      color: '#888',
      fontFamily: "'DM Sans', sans-serif",
    },
    installBtn: {
      flexShrink: 0,
      background: '#2D6A4F',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '7px 14px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
    },
    dismissBtn: {
      flexShrink: 0,
      background: 'none',
      border: 'none',
      color: '#bbb',
      cursor: 'pointer',
      fontSize: 18,
      lineHeight: 1,
      padding: '0 2px',
    },
  }

  return (
    <div style={s.banner} role="dialog" aria-label={t.installTitle}>
      <div style={s.logo}>f</div>
      <div style={s.text}>
        <div style={s.title}>{t.installTitle}</div>
        <div style={s.subtitle}>
          {showIOSTip ? t.installIOSTip : t.installSubtitle}
        </div>
      </div>
      {canInstall && (
        <button style={s.installBtn} onClick={triggerInstall}>
          {t.installBtn}
        </button>
      )}
      <button style={s.dismissBtn} onClick={dismiss} aria-label="Luk">✕</button>
    </div>
  )
}
