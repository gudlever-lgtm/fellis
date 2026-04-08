import { useState, useEffect } from 'react'
import { apiGetCompanyHours, apiSaveCompanyHours } from '../api.js'

const DAY_NAMES = {
  da: ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
}

function isOpenNow(hours) {
  if (!hours?.length) return null
  const now = new Date()
  const dow = (now.getDay() + 6) % 7 // 0=Mon
  const day = hours.find(h => h.day_of_week === dow)
  if (!day || day.is_closed) return false
  if (!day.open_time || !day.close_time) return null
  const [oh, om] = day.open_time.split(':').map(Number)
  const [ch, cm] = day.close_time.split(':').map(Number)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  return nowMins >= oh * 60 + om && nowMins < ch * 60 + cm
}

export default function CompanyBusinessHours({ companyId, isMember, lang }) {
  const [hours, setHours] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [saving, setSaving] = useState(false)

  const t = lang === 'da'
    ? { title: 'Åbningstider', edit: 'Rediger', save: 'Gem', cancel: 'Annuller', closed: 'Lukket', openNow: 'Åben nu', closedNow: 'Lukket nu' }
    : { title: 'Business hours', edit: 'Edit', save: 'Save', cancel: 'Cancel', closed: 'Closed', openNow: 'Open now', closedNow: 'Closed now' }

  useEffect(() => {
    apiGetCompanyHours(companyId).then(d => {
      const data = d?.hours || []
      setHours(data)
      // Fill in missing days
      const filled = Array.from({ length: 7 }, (_, i) => {
        const existing = data.find(h => h.day_of_week === i)
        return existing || { day_of_week: i, open_time: '09:00', close_time: '17:00', is_closed: 0 }
      })
      setDraft(filled)
    })
  }, [companyId])

  const handleSave = async () => {
    setSaving(true)
    await apiSaveCompanyHours(companyId, draft)
    const d = await apiGetCompanyHours(companyId)
    setHours(d?.hours || [])
    setEditing(false)
    setSaving(false)
  }

  const openStatus = isOpenNow(hours)
  const days = lang === 'da' ? DAY_NAMES.da : DAY_NAMES.en

  if (!hours) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🕐 {t.title}</h3>
        {openStatus === true && <span style={{ fontSize: 12, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{t.openNow}</span>}
        {openStatus === false && <span style={{ fontSize: 12, background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{t.closedNow}</span>}
        {isMember && !editing && (
          <button onClick={() => setEditing(true)}
            style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
            {t.edit}
          </button>
        )}
      </div>

      {!editing ? (
        <div>
          {hours.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>—</div>}
          {hours.map(h => (
            <div key={h.day_of_week} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border,#f0f0f0)', fontSize: 14 }}>
              <span style={{ fontWeight: 500 }}>{days[h.day_of_week]}</span>
              <span style={{ color: h.is_closed ? '#888' : '#222' }}>
                {h.is_closed ? t.closed : `${h.open_time?.slice(0, 5)} – ${h.close_time?.slice(0, 5)}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {draft.map((h, i) => (
            <div key={h.day_of_week} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 90, fontWeight: 500, fontSize: 13 }}>{days[h.day_of_week]}</span>
              <input type="checkbox" checked={!h.is_closed}
                onChange={e => setDraft(prev => prev.map((d, j) => j === i ? { ...d, is_closed: e.target.checked ? 0 : 1 } : d))} />
              {!h.is_closed && (
                <>
                  <input type="time" value={h.open_time || '09:00'}
                    onChange={e => setDraft(prev => prev.map((d, j) => j === i ? { ...d, open_time: e.target.value } : d))}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border,#ddd)', fontSize: 13 }} />
                  <span>–</span>
                  <input type="time" value={h.close_time || '17:00'}
                    onChange={e => setDraft(prev => prev.map((d, j) => j === i ? { ...d, close_time: e.target.value } : d))}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border,#ddd)', fontSize: 13 }} />
                </>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              {saving ? '…' : t.save}
            </button>
            <button onClick={() => setEditing(false)}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border,#ddd)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
