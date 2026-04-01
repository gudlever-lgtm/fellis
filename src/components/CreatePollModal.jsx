import { useState } from 'react'
import { apiCreatePoll } from '../api.js'

export default function CreatePollModal({ postId, lang, onClose, onCreated }) {
  const [options, setOptions] = useState(['', ''])
  const [endsIn, setEndsIn] = useState(24)
  const [saving, setSaving] = useState(false)
  const t = lang === 'da'
    ? { title: 'Tilføj afstemning', option: 'Valgmulighed', addOption: '+ Tilføj valgmulighed', duration: 'Varighed', hours: 'timer', save: 'Opret afstemning', cancel: 'Annuller', errMin: 'Minimum 2 valgmuligheder', errEmpty: 'Alle valgmuligheder skal udfyldes' }
    : { title: 'Add poll', option: 'Option', addOption: '+ Add option', duration: 'Duration', hours: 'hours', save: 'Create poll', cancel: 'Cancel', errMin: 'Minimum 2 options', errEmpty: 'All options must be filled in' }

  const handleSave = async () => {
    if (options.length < 2) return alert(t.errMin)
    if (options.some(o => !o.trim())) return alert(t.errEmpty)
    setSaving(true)
    const pollOptions = options.map(o => ({ da: o, en: o }))
    await apiCreatePoll(postId, pollOptions, endsIn)
    setSaving(false)
    onCreated?.()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--card,#fff)', borderRadius: 16, padding: 24, width: 380, maxWidth: '90vw' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>📊 {t.title}</h3>
        {options.map((opt, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14 }}
              placeholder={`${t.option} ${i + 1}`}
              value={opt}
              onChange={e => setOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
            />
            {options.length > 2 && (
              <button
                onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))}
                style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: '#fee', color: '#c00', cursor: 'pointer' }}
              >✕</button>
            )}
          </div>
        ))}
        {options.length < 4 && (
          <button
            onClick={() => setOptions(prev => [...prev, ''])}
            style={{ background: 'none', border: 'none', color: '#1877F2', cursor: 'pointer', fontSize: 14, marginBottom: 14, padding: 0 }}
          >{t.addOption}</button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: '#555' }}>{t.duration}:</label>
          <select
            value={endsIn}
            onChange={e => setEndsIn(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 13 }}
          >
            {[1, 6, 12, 24, 48, 72, 168].map(h => (
              <option key={h} value={h}>{h} {t.hours}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
          >{saving ? '…' : t.save}</button>
          <button
            onClick={onClose}
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}
          >{t.cancel}</button>
        </div>
      </div>
    </div>
  )
}
