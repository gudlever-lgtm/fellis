import { PT } from '../data.js'
export default function KeyboardShortcutsHelp({ lang, onClose }) {
  const t = PT[lang]
  const shortcuts = [
    { keys: ['G', 'F'], label: t.shortcutGoFeed },
    { keys: ['G', 'M'], label: t.shortcutGoMessages },
    { keys: ['G', 'P'], label: t.shortcutGoProfile },
    { keys: ['G', 'J'], label: t.shortcutGoJobs },
    { keys: ['G', 'E'], label: t.shortcutGoEvents },
    { keys: ['G', 'S'], label: t.shortcutGoSearch },
    { keys: ['G', 'N'], label: t.shortcutOpenNotifications },
    { keys: ['G', 'R'], label: t.shortcutGoReels },
    { keys: ['G', 'K'], label: t.shortcutGoMarketplace },
    { keys: ['G', 'B'], label: t.shortcutGoBadges },
    { keys: ['/'], label: t.shortcutFocusSearch },
    { keys: ['?'], label: t.shortcutShowHelp },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={{ background: 'var(--card,#fff)', borderRadius: 20, padding: 28, width: 400, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>⌨️ {PT[lang].keyboardShortcuts}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888', padding: '2px 6px' }}>✕</button>
        </div>
        {shortcuts.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < shortcuts.length - 1 ? '1px solid var(--border,#f0f0f0)' : 'none' }}>
            <span style={{ fontSize: 14, color: 'var(--text,#333)' }}>{s.label}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {s.keys.map((k, j) => (
                <kbd key={j} style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 6, border: '1px solid #ccc', background: 'var(--bg,#f5f5f5)', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16, fontSize: 12, color: '#aaa' }}>
          {PT[lang].shortcutsDon}
        </div>
      </div>
    </div>
  )
}
