import { useState } from 'react'
import { apiAssignAdfreedays, apiGetAdfreeAssignments } from '../api'

// Source-based visual theming
const SOURCE_THEME = {
  earned: {
    bg: '#e8f5e9',
    border: '#4caf50',
    badgeColor: '#388e3c',
    label: { da: '🏆 Optjent', en: '🏆 Earned' },
    activeBorder: '#2e7d32',
  },
  purchased: {
    bg: '#f3e5f5',
    border: '#9c27b0',
    badgeColor: '#7b1fa2',
    label: { da: '✨ Købt', en: '✨ Purchased' },
    activeBorder: '#6a1b9a',
  },
}

const s = {
  container: {
    padding: '16px',
  },
  bankSection: {
    backgroundColor: '#fff',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  bankIcon: { fontSize: '28px', lineHeight: 1 },
  bankText: { fontSize: '13px', color: '#666', margin: 0 },
  bankDays: { fontSize: '26px', fontWeight: 'bold', color: '#2196F3', lineHeight: 1 },
  legend: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#555',
  },
  legendDot: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    flexShrink: 0,
  },
  assignBox: {
    backgroundColor: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '16px',
  },
  assignTitle: { fontSize: '13px', fontWeight: '600', color: '#444', margin: '0 0 10px 0' },
  dateRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  dateField: { flex: 1, minWidth: '140px' },
  dateLabel: { fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' },
  dateInput: {
    width: '100%',
    padding: '7px 10px',
    border: '1px solid #ddd',
    borderRadius: '5px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  assignBtn: {
    padding: '8px 18px',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    alignSelf: 'flex-end',
  },
  preview: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#666',
  },
  error: {
    color: '#d32f2f',
    fontSize: '13px',
    padding: '8px 12px',
    backgroundColor: '#ffebee',
    borderRadius: '5px',
    marginTop: '10px',
  },
  success: {
    color: '#388e3c',
    fontSize: '13px',
    padding: '8px 12px',
    backgroundColor: '#e8f5e9',
    borderRadius: '5px',
    marginTop: '10px',
  },
  listTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#666',
    margin: '0 0 10px 0',
  },
  assignmentItem: {
    padding: '11px 14px',
    borderRadius: '7px',
    marginBottom: '8px',
    border: '2px solid transparent',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  assignmentDates: { fontSize: '14px', fontWeight: '600', color: '#222' },
  assignmentMeta: { fontSize: '12px', color: '#888', marginTop: '3px' },
  activePill: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#fff',
    whiteSpace: 'nowrap',
  },
  sourcePill: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  emptyState: {
    textAlign: 'center',
    padding: '24px 16px',
    color: '#aaa',
    fontSize: '14px',
    backgroundColor: '#fafafa',
    borderRadius: '7px',
  },
}

export default function AdfreeCalendar({ bankDays = 0, assignments = [], onAssignmentChange, lang = 'da' }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  // Calculate days needed for the selected range
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
      setError(
        lang === 'da'
          ? `Du har kun ${bankDays} dag(e) men perioden kræver ${daysNeeded}`
          : `You only have ${bankDays} day(s) but the period requires ${daysNeeded}`
      )
      return
    }

    setLoading(true)
    try {
      const result = await apiAssignAdfreedays(startDate, endDate)
      if (result?.success) {
        setSuccess(
          lang === 'da'
            ? `✓ ${daysNeeded} dag(e) tildelt! ${result.newBank} dage tilbage i banken.`
            : `✓ ${daysNeeded} day(s) assigned! ${result.newBank} days left in bank.`
        )
        setStartDate('')
        setEndDate('')
        if (onAssignmentChange) {
          const updated = await apiGetAdfreeAssignments()
          onAssignmentChange(updated?.assignments || [], updated?.bankDays ?? result.newBank)
        }
      } else {
        setError(result?.error || (lang === 'da' ? 'Noget gik galt' : 'Something went wrong'))
      }
    } catch {
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
        <div style={s.bankIcon}>🪙</div>
        <div>
          <div style={s.bankDays}>{bankDays}</div>
          <p style={s.bankText}>
            {lang === 'da' ? 'Optjente dage i banken' : 'Earned days in bank'}
          </p>
        </div>
      </div>

      {/* Legend — shown if both types exist */}
      {(hasPurchased || hasEarned) && (
        <div style={s.legend}>
          {hasEarned && (
            <div style={s.legendItem}>
              <div style={{ ...s.legendDot, backgroundColor: SOURCE_THEME.earned.border }} />
              {lang === 'da' ? 'Optjent via badges' : 'Earned via badges'}
            </div>
          )}
          {hasPurchased && (
            <div style={s.legendItem}>
              <div style={{ ...s.legendDot, backgroundColor: SOURCE_THEME.purchased.border }} />
              {lang === 'da' ? 'Købt via abonnement' : 'Purchased via subscription'}
            </div>
          )}
        </div>
      )}

      {/* Assign form */}
      <div style={s.assignBox}>
        <p style={s.assignTitle}>
          {lang === 'da' ? '📅 Tildel dine banked dage' : '📅 Assign your banked days'}
        </p>
        <div style={s.dateRow}>
          <div style={s.dateField}>
            <label style={s.dateLabel}>{lang === 'da' ? 'Fra dato' : 'Start date'}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={today}
              style={s.dateInput}
            />
          </div>
          <div style={s.dateField}>
            <label style={s.dateLabel}>{lang === 'da' ? 'Til dato' : 'End date'}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || today}
              style={s.dateInput}
            />
          </div>
          <button
            onClick={handleAssign}
            disabled={loading || !startDate || !endDate || daysNeeded > bankDays}
            style={{
              ...s.assignBtn,
              opacity: (loading || !startDate || !endDate || daysNeeded > bankDays) ? 0.5 : 1,
              cursor: (loading || !startDate || !endDate || daysNeeded > bankDays) ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? (lang === 'da' ? 'Tildeler…' : 'Assigning…')
              : (lang === 'da' ? 'Tildel' : 'Assign')}
          </button>
        </div>

        {daysNeeded > 0 && (
          <p style={{ ...s.preview, color: daysNeeded > bankDays ? '#d32f2f' : '#388e3c' }}>
            {lang === 'da'
              ? `${daysNeeded} dag(e) nødvendige · ${bankDays} tilgængelige`
              : `${daysNeeded} day(s) needed · ${bankDays} available`}
          </p>
        )}
        {error && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}
      </div>

      {/* Assignments list */}
      {assignments.length > 0 ? (
        <>
          <p style={s.listTitle}>
            {lang === 'da' ? 'Dine ad-frie perioder' : 'Your ad-free periods'}
          </p>
          {assignments.map((a) => {
            const theme = SOURCE_THEME[a.source] || SOURCE_THEME.earned
            const active = isActive(a)
            return (
              <div
                key={`${a.source}-${a.id}`}
                style={{
                  ...s.assignmentItem,
                  backgroundColor: theme.bg,
                  borderColor: active ? theme.activeBorder : theme.border,
                  borderWidth: active ? '2px' : '1px',
                }}
              >
                <div>
                  <div style={s.assignmentDates}>
                    {formatDate(a.startDate)} – {formatDate(a.endDate)}
                  </div>
                  <div style={s.assignmentMeta}>
                    {a.daysUsed} {lang === 'da' ? 'dag(e)' : 'day(s)'}
                    {' · '}
                    <span style={{ ...s.sourcePill, color: theme.badgeColor }}>
                      {theme.label[lang]}
                    </span>
                  </div>
                </div>
                {active && (
                  <div style={{ ...s.activePill, backgroundColor: theme.activeBorder }}>
                    {lang === 'da' ? '✓ Aktiv' : '✓ Active'}
                  </div>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <div style={s.emptyState}>
          {lang === 'da'
            ? 'Ingen perioder endnu. Optjen badges for at banke dage!'
            : 'No periods yet. Earn badges to bank days!'}
        </div>
      )}
    </div>
  )
}
