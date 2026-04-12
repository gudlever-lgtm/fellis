import { useState, useEffect } from 'react'
import { PT } from '../data.js'
import { apiFacebookGetData, apiFacebookImport, apiFacebookDisconnect } from '../api.js'

// Fields that can be imported from Facebook, in display order
const IMPORTABLE_FIELDS = [
  { key: 'picture',  tKey: 'fb_field_photo' },
  { key: 'name',     tKey: 'fb_field_name' },
  { key: 'birthday', tKey: 'fb_field_birthday' },
  { key: 'location', tKey: 'fb_field_location' },
  { key: 'gender',   tKey: 'fb_field_gender' },
]

// Returns true if fbData has a value for the given importable field
function hasValue(field, fbData) {
  if (!fbData) return false
  if (field.key === 'picture')  return Boolean(fbData.picture?.data?.url)
  if (field.key === 'location') return Boolean(fbData.location?.name || fbData.hometown?.name)
  return Boolean(fbData[field.key])
}

export default function FacebookImport({ lang = 'da', user, onUpdate }) {
  const t = PT[lang] || PT.da

  // view: 'idle' | 'loading' | 'preview' | 'importing' | 'done' | 'error'
  const [view, setView]     = useState('idle')
  const [fbData, setFbData] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [errMsg, setErrMsg] = useState('')

  const isConnected = user?.fb_connected === 1

  // Detect OAuth redirect back from Facebook
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('fb') === 'connected') {
      // Strip the param without a page reload so Back button works cleanly
      const url = new URL(window.location.href)
      url.searchParams.delete('fb')
      window.history.replaceState({}, '', url)
      loadFbData()
    } else if (params.get('error')?.startsWith('fb_')) {
      const errParam = params.get('error')
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      window.history.replaceState({}, '', url)
      const msg = errParam === 'fb_state_invalid' ? t.fb_error_state : t.fb_error_generic
      setErrMsg(msg)
      setView('error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFbData() {
    setView('loading')
    setErrMsg('')
    const data = await apiFacebookGetData()
    if (!data || data.error) {
      setErrMsg(t.fb_error_generic)
      setView('error')
      return
    }
    setFbData(data)
    // Pre-select all available fields
    const available = IMPORTABLE_FIELDS.filter(f => hasValue(f, data)).map(f => f.key)
    setSelected(new Set(available))
    setView('preview')
  }

  async function handleImport() {
    setView('importing')
    const result = await apiFacebookImport([...selected])
    if (!result || result.error) {
      setErrMsg(t.fb_error_generic)
      setView('preview')
      return
    }
    setView('done')
    if (onUpdate) onUpdate(result.user)
  }

  async function handleDisconnect() {
    if (!window.confirm(t.fb_disconnect_confirm)) return
    const result = await apiFacebookDisconnect()
    if (!result || result.error) {
      setErrMsg(t.fb_error_generic)
      return
    }
    setFbData(null)
    setSelected(new Set())
    setErrMsg('')
    setView('idle')
    if (onUpdate) onUpdate({ fb_connected: 0 })
  }

  function toggleField(key) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleAll() {
    if (!fbData) return
    const available = IMPORTABLE_FIELDS.filter(f => hasValue(f, fbData)).map(f => f.key)
    setSelected(selected.size === available.length ? new Set() : new Set(available))
  }

  // ── Spinner (uses global .spinner class from App.css) ──
  const Spinner = ({ label }) => (
    <div style={s.spinnerWrap}>
      <div className="spinner" style={{ borderTopColor: '#1877F2' }} />
      {label && <div style={s.spinnerLabel}>{label}</div>}
    </div>
  )

  // ── Loading state ──────────────────────────────────────────────────────────
  if (view === 'loading') {
    return (
      <div style={s.container}>
        <Spinner label={t.fb_connecting} />
      </div>
    )
  }

  // ── Importing state ────────────────────────────────────────────────────────
  if (view === 'importing') {
    return (
      <div style={s.container}>
        <Spinner label={t.fb_importing} />
      </div>
    )
  }

  // ── Done state ─────────────────────────────────────────────────────────────
  if (view === 'done') {
    return (
      <div style={s.container}>
        <div style={s.successMsg}>{t.fb_success}</div>
        <button style={s.ghostBtn} onClick={handleDisconnect}>
          {t.fb_disconnect_btn}
        </button>
        {errMsg && <div style={s.errorMsg}>{errMsg}</div>}
      </div>
    )
  }

  // ── Preview / field-selection state ───────────────────────────────────────
  if (view === 'preview' && fbData) {
    const available = IMPORTABLE_FIELDS.filter(f => hasValue(f, fbData))
    return (
      <div style={s.container}>
        <div style={s.sectionTitle}>{t.fb_import_title}</div>

        {available.length > 1 && (
          <label style={s.selectAllRow}>
            <input
              type="checkbox"
              checked={selected.size === available.length}
              onChange={toggleAll}
            />
            <span>{t.fb_import_select_all}</span>
          </label>
        )}

        <div style={s.fieldList}>
          {available.map(f => (
            <label key={f.key} style={s.fieldRow}>
              <input
                type="checkbox"
                checked={selected.has(f.key)}
                onChange={() => toggleField(f.key)}
              />
              {f.key === 'picture' && fbData.picture?.data?.url && (
                <img
                  src={fbData.picture.data.url}
                  alt=""
                  style={s.thumb}
                  referrerPolicy="no-referrer"
                />
              )}
              <span style={s.fieldLabel}>{t[f.tKey]}</span>
              {f.key === 'name'     && <span style={s.fieldValue}>{fbData.name}</span>}
              {f.key === 'birthday' && <span style={s.fieldValue}>{fbData.birthday}</span>}
              {f.key === 'gender'   && <span style={s.fieldValue}>{fbData.gender}</span>}
              {f.key === 'location' && (
                <span style={s.fieldValue}>
                  {fbData.location?.name || fbData.hometown?.name}
                </span>
              )}
            </label>
          ))}
        </div>

        {errMsg && <div style={s.errorMsg}>{errMsg}</div>}

        <div style={s.btnRow}>
          <button
            style={{ ...s.primaryBtn, opacity: selected.size === 0 ? 0.5 : 1 }}
            disabled={selected.size === 0}
            onClick={handleImport}
          >
            {t.fb_import_btn}
          </button>
          <button style={s.ghostBtn} onClick={handleDisconnect}>
            {t.fb_disconnect_btn}
          </button>
        </div>
      </div>
    )
  }

  // ── Already connected (idle, after a previous import) ─────────────────────
  if (isConnected && view === 'idle') {
    return (
      <div style={s.container}>
        <div style={s.header}>
          <div style={s.fbLogo}>f</div>
          <div>
            <div style={s.sectionTitle}>{t.fb_connected_label}</div>
            {user.fb_connected_at && (
              <div style={s.subtitle}>
                {t.fb_last_sync}:{' '}
                {new Date(user.fb_connected_at).toLocaleDateString(
                  lang === 'da' ? 'da-DK' : 'en-US'
                )}
              </div>
            )}
          </div>
        </div>
        {errMsg && <div style={s.errorMsg}>{errMsg}</div>}
        <div style={s.btnRow}>
          <button style={s.primaryBtn} onClick={loadFbData}>
            {t.fb_resync_btn}
          </button>
          <button style={s.ghostBtn} onClick={handleDisconnect}>
            {t.fb_disconnect_btn}
          </button>
        </div>
      </div>
    )
  }

  // ── Default: not connected / error ────────────────────────────────────────
  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.fbLogo}>f</div>
        <div>
          <div style={s.sectionTitle}>{t.fb_connect_title}</div>
          <div style={s.subtitle}>{t.fb_connect_desc}</div>
        </div>
      </div>
      {errMsg && <div style={s.errorMsg}>{errMsg}</div>}
      <button
        style={s.primaryBtn}
        onClick={() => { window.location.href = '/api/auth/facebook' }}
      >
        {t.fb_connect_btn}
      </button>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  container: {
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    padding: '20px 24px',
    marginTop: 20,
    background: '#fff',
    maxWidth: 480,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  fbLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: '#1877F2',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1,
    flexShrink: 0,
    userSelect: 'none',
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 15,
    marginBottom: 2,
  },
  subtitle: {
    color: '#666',
    fontSize: 13,
    lineHeight: 1.4,
  },
  primaryBtn: {
    background: '#1877F2',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
    transition: 'background 0.15s',
  },
  ghostBtn: {
    background: 'none',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '10px 18px',
    cursor: 'pointer',
    fontSize: 14,
  },
  btnRow: {
    display: 'flex',
    gap: 10,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  fieldList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: '12px 0',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    fontSize: 14,
  },
  fieldLabel: {
    fontWeight: 500,
  },
  fieldValue: {
    color: '#777',
    fontSize: 13,
    marginLeft: 4,
  },
  selectAllRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 4,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
  },
  spinnerWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 0',
  },
  spinnerLabel: {
    color: '#666',
    fontSize: 13,
    marginTop: 6,
  },
  successMsg: {
    color: '#2D6A4F',
    fontWeight: 600,
    fontSize: 15,
    marginBottom: 14,
  },
  errorMsg: {
    color: '#c0392b',
    fontSize: 13,
    marginTop: 8,
  },
}
