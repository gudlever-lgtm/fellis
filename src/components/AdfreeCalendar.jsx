import { useState, useEffect, useRef } from 'react'
import { apiAssignAdfreedays, apiGetAdfreeAssignments } from '../api'

// Date input with dd-mm-yyyy format and a calendar popup
function DateInput({ value, onChange, style, lang = 'da', minDate = '', align = 'left' }) {
  const toDisplay = (iso) => (iso ? iso.split('-').reverse().join('-') : '')
  const toIso = (disp) => {
    const m = disp.match(/^(\d{2})-(\d{2})-(\d{4})$/)
    return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
  }

  const [text, setText] = useState(() => toDisplay(value))
  const [open, setOpen] = useState(false)
  const initD = value ? new Date(value + 'T00:00:00') : new Date()
  const [calYear, setCalYear] = useState(initD.getFullYear())
  const [calMonth, setCalMonth] = useState(initD.getMonth())
  const ref = useRef(null)

  useEffect(() => {
    const expected = toDisplay(value)
    if (text !== expected) setText(expected)
    if (value) {
      const d = new Date(value + 'T00:00:00')
      setCalYear(d.getFullYear())
      setCalMonth(d.getMonth())
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleTextChange = (e) => {
    let raw = e.target.value.replace(/[^\d-]/g, '')
    if (/^\d{2}$/.test(raw) && text.length === 1) raw += '-'
    if (/^\d{2}-\d{2}$/.test(raw) && text.length === 4) raw += '-'
    setText(raw)
    const iso = toIso(raw)
    if (iso) onChange(iso)
    else if (!raw) onChange('')
  }

  const selectDay = (day) => {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (minDate && iso < minDate) return
    onChange(iso)
    setOpen(false)
  }

  const prevMonth = () => calMonth === 0 ? (setCalYear(y => y - 1), setCalMonth(11)) : setCalMonth(m => m - 1)
  const nextMonth = () => calMonth === 11 ? (setCalYear(y => y + 1), setCalMonth(0)) : setCalMonth(m => m + 1)

  const firstDayMon = (new Date(calYear, calMonth, 1).getDay() + 6) % 7
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const cells = [...Array(firstDayMon).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const todayIso = new Date().toLocaleDateString('sv-SE')
  const monthNames = lang === 'da'
    ? ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december']
    : ['January','February','March','April','May','June','July','August','September','October','November','December']
  const weekDays = lang === 'da' ? ['Ma','Ti','On','To','Fr','Lø','Sø'] : ['Mo','Tu','We','Th','Fr','Sa','Su']

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        placeholder="dd-mm-yyyy"
        value={text}
        style={{ ...style, cursor: 'pointer' }}
        onChange={handleTextChange}
        onFocus={() => setOpen(true)}
        maxLength={10}
        inputMode="numeric"
        readOnly
        onClick={() => setOpen(o => !o)}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', ...(align === 'right' ? { right: 0 } : { left: 0 }), zIndex: 9999,
          background: '#fff', border: '1px solid #ddd', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)', padding: '10px 8px', width: 230,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button onMouseDown={e => { e.preventDefault(); prevMonth() }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 6px', color: '#555' }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{monthNames[calMonth]} {calYear}</span>
            <button onMouseDown={e => { e.preventDefault(); nextMonth() }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 6px', color: '#555' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
            {weekDays.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#aaa', paddingBottom: 2 }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isSelected = iso === value
              const isToday = iso === todayIso
              const disabled = minDate && iso < minDate
              return (
                <div
                  key={i}
                  onMouseDown={e => { e.preventDefault(); if (!disabled) selectDay(day) }}
                  style={{
                    textAlign: 'center', padding: '5px 2px', borderRadius: 5, fontSize: 12,
                    cursor: disabled ? 'default' : 'pointer',
                    background: isSelected ? '#2196F3' : isToday ? '#e3f2fd' : 'transparent',
                    color: isSelected ? '#fff' : disabled ? '#ccc' : isToday ? '#1565c0' : '#222',
                    fontWeight: isSelected || isToday ? 700 : 400,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!disabled && !isSelected) e.currentTarget.style.background = '#f0f0f0' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isToday ? '#e3f2fd' : 'transparent' }}
                >
                  {day}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  container: { padding: '16px' },
  bankSection: {
    backgroundColor: '#fff',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #e0e0e0',
  },
  bankDays: { fontSize: '26px', fontWeight: 'bold', color: '#2196F3', lineHeight: 1 },
  bankText: { fontSize: '13px', color: '#666', margin: 0 },
  legend: { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#555' },
  legendDot: { width: '12px', height: '12px', borderRadius: '3px', flexShrink: 0 },
  assignBox: { backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' },
  assignTitle: { fontSize: '13px', fontWeight: '600', color: '#444', margin: '0 0 10px 0' },
  dateRow: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' },
  dateField: { flex: 1, minWidth: '140px' },
  dateLabel: { fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' },
  dateInput: { width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px', boxSizing: 'border-box' },
  assignBtn: { padding: '8px 18px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap' },
  preview: { marginTop: '8px', fontSize: '12px', color: '#666' },
  error: { color: '#d32f2f', fontSize: '13px', padding: '8px 12px', backgroundColor: '#ffebee', borderRadius: '5px', marginTop: '10px' },
  success: { color: '#388e3c', fontSize: '13px', padding: '8px 12px', backgroundColor: '#e8f5e9', borderRadius: '5px', marginTop: '10px' },
  listTitle: { fontSize: '13px', fontWeight: '600', color: '#666', margin: '0 0 10px 0' },
  assignmentItem: { padding: '11px 14px', borderRadius: '7px', marginBottom: '8px', border: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  assignmentDates: { fontSize: '14px', fontWeight: '600', color: '#222' },
  assignmentMeta: { fontSize: '12px', color: '#888', marginTop: '3px' },
  activePill: { display: 'inline-block', padding: '3px 9px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', color: '#fff', whiteSpace: 'nowrap', backgroundColor: '#4caf50' },
  sourcePill: { display: 'inline-block', padding: '3px 9px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' },
  emptyState: { textAlign: 'center', padding: '24px 16px', color: '#aaa', fontSize: '14px', backgroundColor: '#fafafa', borderRadius: '7px' },
}

export default function AdfreeCalendar({ bankDays = 0, assignments = [], onAssignmentChange, lang = 'da' }) {
  const [startDate, setStartDate] = useState('') // YYYY-MM-DD
  const [endDate, setEndDate] = useState('')     // YYYY-MM-DD
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const today = new Date().toLocaleDateString('sv-SE')

  const daysNeeded = startDate && endDate && startDate <= endDate
    ? Math.floor((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1
    : 0

  const handleAssign = async () => {
    setError('')
    setSuccess('')

    if (!startDate || !endDate) {
      setError(lang === 'da' ? 'Vælg både start- og slutdato' : 'Select both start and end dates')
      return
    }
    if (startDate > endDate) {
      setError(lang === 'da' ? 'Startdato skal være før slutdato' : 'Start date must be before end date')
      return
    }
    if (daysNeeded > bankDays) {
      setError(lang === 'da' ? `Du har kun ${bankDays} dag(e) men perioden kræver ${daysNeeded}` : `You only have ${bankDays} day(s) but need ${daysNeeded}`)
      return
    }

    setLoading(true)
    try {
      const result = await apiAssignAdfreedays(startDate, endDate)
      if (result?.success) {
        setSuccess(lang === 'da' ? `✓ ${daysNeeded} dag(e) tildelt!` : `✓ ${daysNeeded} day(s) assigned!`)
        setStartDate('')
        setEndDate('')
        if (onAssignmentChange) {
          const updated = await apiGetAdfreeAssignments()
          onAssignmentChange(updated?.assignments || [], updated?.newBank)
        }
      } else {
        setError(result?.error || (lang === 'da' ? 'Noget gik galt' : 'Something went wrong'))
      }
    } catch (err) {
      setError(lang === 'da' ? 'Fejl ved tildeling' : 'Error assigning days')
    } finally {
      setLoading(false)
    }
  }

  const isActive = (a) => a.startDate <= today && today <= a.endDate
  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const hasPurchased = assignments.some(a => a.source === 'purchased')
  const hasEarned = assignments.some(a => a.source === 'earned')

  return (
    <div style={s.container}>
      {/* Bank balance */}
      <div style={s.bankSection}>
        <div style={s.bankDays}>{bankDays}</div>
        <p style={s.bankText}>
          {lang === 'da' ? 'Optjente dage i banken' : 'Earned days in bank'}
        </p>
      </div>

      {/* Legend */}
      {(hasPurchased || hasEarned) && (
        <div style={s.legend}>
          {hasEarned && (
            <div style={s.legendItem}>
              <div style={{ ...s.legendDot, backgroundColor: '#4caf50' }} />
              {lang === 'da' ? 'Optjent via badges' : 'Earned via badges'}
            </div>
          )}
          {hasPurchased && (
            <div style={s.legendItem}>
              <div style={{ ...s.legendDot, backgroundColor: '#9c27b0' }} />
              {lang === 'da' ? 'Købt via abonnement' : 'Purchased via subscription'}
            </div>
          )}
        </div>
      )}

      {/* Assign form — only shown when the bank has days available */}
      {bankDays > 0 && <div style={s.assignBox}>
        <p style={s.assignTitle}>{lang === 'da' ? '📅 Tildel banked dage' : '📅 Assign banked days'}</p>
        <div style={s.dateRow}>
          <div style={s.dateField}>
            <label style={s.dateLabel}>{lang === 'da' ? 'Fra dato' : 'Start date'}</label>
            <DateInput value={startDate} onChange={setStartDate} style={s.dateInput} lang={lang} minDate={today} />
          </div>
          <div style={s.dateField}>
            <label style={s.dateLabel}>{lang === 'da' ? 'Til dato' : 'End date'}</label>
            <DateInput value={endDate} onChange={setEndDate} style={s.dateInput} lang={lang} minDate={startDate || today} align="right" />
          </div>
          <button onClick={handleAssign} disabled={loading || !startDate || !endDate || daysNeeded > bankDays} style={{ ...s.assignBtn, opacity: (loading || !startDate || !endDate || daysNeeded > bankDays) ? 0.5 : 1, cursor: (loading || !startDate || !endDate || daysNeeded > bankDays) ? 'not-allowed' : 'pointer' }}>
            {loading ? (lang === 'da' ? 'Tildeler…' : 'Assigning…') : (lang === 'da' ? 'Tildel' : 'Assign')}
          </button>
        </div>
        {daysNeeded > 0 && <p style={{ ...s.preview, color: daysNeeded > bankDays ? '#d32f2f' : '#388e3c' }}>{lang === 'da' ? `${daysNeeded} dag(e) nødvendige · ${bankDays} tilgængelige` : `${daysNeeded} day(s) needed · ${bankDays} available`}</p>}
        {error && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}
      </div>}

      {/* Assignments list */}
      {assignments.length > 0 ? (
        <>
          <p style={s.listTitle}>{lang === 'da' ? 'Dine ad-frie perioder' : 'Your ad-free periods'}</p>
          {assignments.map((a) => {
            const theme = a.source === 'purchased' ? { bg: '#f3e5f5', border: '#9c27b0', label: lang === 'da' ? '✨ Købt' : '✨ Purchased' } : { bg: '#e8f5e9', border: '#4caf50', label: lang === 'da' ? '🏆 Optjent' : '🏆 Earned' }
            const active = isActive(a)
            return (
              <div key={`${a.source}-${a.id}`} style={{ ...s.assignmentItem, backgroundColor: theme.bg, borderColor: active ? theme.border : '#ddd', borderWidth: active ? '2px' : '1px' }}>
                <div>
                  <div style={s.assignmentDates}>{formatDate(a.startDate)} – {formatDate(a.endDate)}</div>
                  <div style={s.assignmentMeta}>{a.daysUsed} {lang === 'da' ? 'dag(e)' : 'day(s)'} · <span style={{ ...s.sourcePill, color: theme.border }}>{theme.label}</span></div>
                </div>
                {active && <div style={s.activePill}>{lang === 'da' ? '✓ Aktiv' : '✓ Active'}</div>}
              </div>
            )
          })}
        </>
      ) : (
        <div style={s.emptyState}>{lang === 'da' ? 'Ingen perioder endnu. Optjen badges for at banke dage!' : 'No periods yet. Earn badges to bank days!'}</div>
      )}
    </div>
  )
}
