import { useState } from 'react'
import { apiAssignAdfreedays, apiGetAdfreeAssignments } from '../api'
import { PT } from '../data'

const s = {
  container: {
    padding: '16px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  header: {
    marginBottom: '20px',
  },
  bankSection: {
    backgroundColor: '#fff',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '16px',
    border: '1px solid #e0e0e0',
  },
  bankText: {
    fontSize: '14px',
    color: '#666',
    margin: '0 0 8px 0',
  },
  bankDays: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#2196F3',
  },
  dateInputs: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  dateInput: {
    flex: 1,
    minWidth: '150px',
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  assignBtn: {
    padding: '8px 16px',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  assignBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    color: '#d32f2f',
    fontSize: '13px',
    padding: '8px 12px',
    backgroundColor: '#ffebee',
    borderRadius: '4px',
    marginBottom: '12px',
  },
  success: {
    color: '#388e3c',
    fontSize: '13px',
    padding: '8px 12px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    marginBottom: '12px',
  },
  assignmentsList: {
    marginTop: '20px',
  },
  assignmentItem: {
    backgroundColor: '#fff',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '8px',
    border: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assignmentActive: {
    borderColor: '#4caf50',
    backgroundColor: '#f1f8e9',
  },
  assignmentInfo: {
    flex: 1,
  },
  assignmentDates: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
  },
  assignmentMeta: {
    fontSize: '12px',
    color: '#999',
    marginTop: '4px',
  },
  assignmentBadge: {
    display: 'inline-block',
    backgroundColor: '#4caf50',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '3px',
    fontSize: '11px',
    fontWeight: '500',
  },
  emptyState: {
    textAlign: 'center',
    padding: '20px',
    color: '#999',
    fontSize: '14px',
  },
  loadingText: {
    color: '#999',
    fontSize: '13px',
    marginTop: '8px',
  },
}

export default function AdfreeCalendar({ bankDays = 0, assignments = [], onAssignmentChange, lang = 'da' }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const today = new Date().toISOString().split('T')[0]

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

    const daysNeeded = Math.floor((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1

    if (daysNeeded > bankDays) {
      setError(
        lang === 'da'
          ? `Du har kun ${bankDays} dage, men har brug for ${daysNeeded}`
          : `You only have ${bankDays} days, but need ${daysNeeded}`
      )
      return
    }

    setLoading(true)
    try {
      const result = await apiAssignAdfreedays(startDate, endDate)
      if (result?.success) {
        setSuccess(lang === 'da' ? '✓ Dage tildelt!' : '✓ Days assigned!')
        setStartDate('')
        setEndDate('')

        // Refresh assignments if callback provided
        if (onAssignmentChange) {
          const updated = await apiGetAdfreeAssignments()
          onAssignmentChange(updated?.assignments || [])
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

  const isActive = (assignment) => {
    return assignment.startDate <= today && today <= assignment.endDate
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    if (lang === 'da') {
      return d.toLocaleDateString('da-DK', { weekday: 'short', month: 'short', day: 'numeric' })
    } else {
      return d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })
    }
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#333' }}>
          {lang === 'da' ? '📅 Annoncefrie dage' : '📅 Ad-Free Days'}
        </h3>

        <div style={s.bankSection}>
          <p style={s.bankText}>{lang === 'da' ? 'Banked dage:' : 'Banked days:'}</p>
          <div style={s.bankDays}>{bankDays}</div>
        </div>

        {error && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}

        <div style={s.dateInputs}>
          <div style={{ flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              {lang === 'da' ? 'Fra dato' : 'Start date'}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={today}
              style={s.dateInput}
            />
          </div>
          <div style={{ flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
              {lang === 'da' ? 'Til dato' : 'End date'}
            </label>
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
            disabled={loading || !startDate || !endDate}
            style={{
              ...s.assignBtn,
              ...(loading || !startDate || !endDate ? s.assignBtnDisabled : {}),
            }}
          >
            {loading
              ? lang === 'da'
                ? 'Tildeler...'
                : 'Assigning...'
              : lang === 'da'
                ? 'Tildel'
                : 'Assign'}
          </button>
        </div>
      </div>

      {loading && <p style={s.loadingText}>{lang === 'da' ? 'Behandler...' : 'Processing...'}</p>}

      {assignments && assignments.length > 0 ? (
        <div style={s.assignmentsList}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#666' }}>
            {lang === 'da' ? 'Dine tildelte perioder' : 'Your assigned periods'}
          </h4>
          {assignments.map((a) => (
            <div key={a.id} style={{ ...s.assignmentItem, ...(isActive(a) ? s.assignmentActive : {}) }}>
              <div style={s.assignmentInfo}>
                <div style={s.assignmentDates}>
                  {formatDate(a.startDate)} – {formatDate(a.endDate)}
                </div>
                <div style={s.assignmentMeta}>
                  {a.daysUsed} {lang === 'da' ? 'dag(e)' : 'day(s)'} •{' '}
                  {lang === 'da'
                    ? new Date(a.createdAt).toLocaleDateString('da-DK')
                    : new Date(a.createdAt).toLocaleDateString('en-GB')}
                </div>
              </div>
              {isActive(a) && (
                <div style={s.assignmentBadge}>{lang === 'da' ? '✓ Aktiv' : '✓ Active'}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={s.emptyState}>{lang === 'da' ? 'Ingen tildelte perioder' : 'No assigned periods'}</div>
      )}
    </div>
  )
}
