import { useState, useEffect } from 'react'
import { apiGetJobAlerts, apiCreateJobAlert, apiDeleteJobAlert } from '../api.js'

export default function JobAlertsPanel({ lang }) {
  const [alerts, setAlerts] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? {
        title: 'Job-adviseringer', addBtn: '+ Ny advisering', empty: 'Ingen job-adviseringer endnu.',
        queryLabel: 'Søgeord', locationLabel: 'Placering', freqLabel: 'Frekvens',
        daily: 'Daglig', weekly: 'Ugentlig', save: 'Gem', cancel: 'Annuller',
        delete: 'Slet', loading: 'Henter…', queryPh: 'f.eks. "designer"', locationPh: 'f.eks. "København"',
      }
    : {
        title: 'Job alerts', addBtn: '+ New alert', empty: 'No job alerts yet.',
        queryLabel: 'Keywords', locationLabel: 'Location', freqLabel: 'Frequency',
        daily: 'Daily', weekly: 'Weekly', save: 'Save', cancel: 'Cancel',
        delete: 'Delete', loading: 'Loading…', queryPh: 'e.g. "designer"', locationPh: 'e.g. "Copenhagen"',
      }

  useEffect(() => {
    apiGetJobAlerts().then(d => setAlerts(d?.alerts || []))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await apiCreateJobAlert(query, location, '', frequency)
    const d = await apiGetJobAlerts()
    setAlerts(d?.alerts || [])
    setShowForm(false)
    setQuery('')
    setLocation('')
    setFrequency('weekly')
    setSaving(false)
  }

  const handleDelete = async (id) => {
    await apiDeleteJobAlert(id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  if (!alerts) return <div style={{ color: '#888', padding: 16 }}>{t.loading}</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔔 {t.title}</h3>
        <button onClick={() => setShowForm(f => !f)}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
          {t.addBtn}
        </button>
      </div>

      {showForm && (
        <div className="p-card" style={{ marginBottom: 14, padding: '16px 18px' }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4, fontWeight: 600 }}>{t.queryLabel}</label>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.queryPh}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4, fontWeight: 600 }}>{t.locationLabel}</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder={t.locationPh}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4, fontWeight: 600 }}>{t.freqLabel}</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', fontSize: 14 }}>
              <option value="daily">{t.daily}</option>
              <option value="weekly">{t.weekly}</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              {saving ? '…' : t.save}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {alerts.length === 0 && !showForm && (
        <div style={{ color: '#888', fontSize: 14 }}>{t.empty}</div>
      )}

      {alerts.map(alert => (
        <div key={alert.id} className="p-card" style={{ marginBottom: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{alert.query || '(alle job)'}</div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {alert.location && <span>{alert.location} · </span>}
              {alert.frequency === 'daily' ? t.daily : t.weekly}
            </div>
          </div>
          <button onClick={() => handleDelete(alert.id)}
            style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#fee', color: '#c00', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {t.delete}
          </button>
        </div>
      ))}
    </div>
  )
}
