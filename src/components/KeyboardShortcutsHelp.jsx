export default function KeyboardShortcutsHelp({ lang, onClose }) {
  const shortcuts = lang === 'da'
    ? [
        { keys: ['G', 'F'], label: 'Gå til Feed' },
        { keys: ['G', 'M'], label: 'Gå til Beskeder' },
        { keys: ['G', 'P'], label: 'Gå til Profil' },
        { keys: ['G', 'J'], label: 'Gå til Job' },
        { keys: ['G', 'E'], label: 'Gå til Arrangementer' },
        { keys: ['G', 'S'], label: 'Gå til Søgning' },
        { keys: ['G', 'N'], label: 'Åbn notifikationer' },
        { keys: ['G', 'R'], label: 'Gå til Reels' },
        { keys: ['G', 'K'], label: 'Gå til Markedsplads' },
        { keys: ['G', 'B'], label: 'Gå til Badges' },
        { keys: ['/'], label: 'Fokus søgefelt' },
        { keys: ['?'], label: 'Vis denne hjælp' },
      ]
    : [
        { keys: ['G', 'F'], label: 'Go to Feed' },
        { keys: ['G', 'M'], label: 'Go to Messages' },
        { keys: ['G', 'P'], label: 'Go to Profile' },
        { keys: ['G', 'J'], label: 'Go to Jobs' },
        { keys: ['G', 'E'], label: 'Go to Events' },
        { keys: ['G', 'S'], label: 'Go to Search' },
        { keys: ['G', 'N'], label: 'Open notifications' },
        { keys: ['G', 'R'], label: 'Go to Reels' },
        { keys: ['G', 'K'], label: 'Go to Marketplace' },
        { keys: ['G', 'B'], label: 'Go to Badges' },
        { keys: ['/'], label: 'Focus search' },
        { keys: ['?'], label: 'Show this help' },
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
