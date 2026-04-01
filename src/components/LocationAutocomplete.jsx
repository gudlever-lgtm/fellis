import { useState, useRef, useEffect } from 'react'
import { apiGeocode } from '../api.js'

/**
 * LocationAutocomplete — OpenStreetMap/Nominatim location picker.
 *
 * Props:
 *   value       string          — current text value (controlled)
 *   onChange    fn(text)        — called on every keystroke
 *   onSelect    fn({name, lat, lng}) — called when user picks a result;
 *               if omitted, onChange(display_name) is called instead
 *   lang        'da'|'en'
 *   placeholder string
 *   required    bool
 *   style       object          — extra styles on the wrapper div
 *   inputStyle  object          — extra styles on the <input>
 */
export default function LocationAutocomplete({
  value = '',
  onChange,
  onSelect,
  lang = 'da',
  placeholder,
  required = false,
  style,
  inputStyle,
}) {
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const debounce = useRef(null)
  const wrapRef = useRef(null)

  const ph = placeholder ?? (PT[lang].searchLocation)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleChange = (e) => {
    const q = e.target.value
    onChange(q)
    setResults([])
    clearTimeout(debounce.current)
    if (q.length < 2) { setSearching(false); setOpen(false); return }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      const res = await apiGeocode(q, lang)
      setResults(res || [])
      setSearching(false)
      setOpen(true)
    }, 400)
  }

  const handlePick = (r) => {
    const name = r.display_name.split(',').slice(0, 2).join(',').trim()
    if (onSelect) {
      onSelect({ name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) })
    } else {
      onChange(name)
    }
    setOpen(false)
    setResults([])
  }

  const handleClear = () => {
    onChange('')
    if (onSelect) onSelect(null)
    setResults([])
    setOpen(false)
  }

  const s = {
    wrap: { position: 'relative', ...style },
    inputRow: { display: 'flex', alignItems: 'center', gap: 4 },
    input: {
      flex: 1, padding: '8px 10px', borderRadius: 8,
      border: '1px solid #DDD', fontSize: 14, outline: 'none',
      boxSizing: 'border-box', width: '100%',
      ...inputStyle,
    },
    clearBtn: {
      padding: '6px 8px', background: 'none', border: 'none',
      cursor: 'pointer', color: '#aaa', fontSize: 15, lineHeight: 1, flexShrink: 0,
    },
    dropdown: {
      position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
      background: '#fff', border: '1px solid #DDD', borderRadius: 10,
      boxShadow: '0 4px 18px rgba(0,0,0,0.13)', zIndex: 500, overflow: 'hidden',
    },
    row: {
      display: 'block', width: '100%', textAlign: 'left',
      padding: '9px 14px', background: 'none', border: 'none',
      borderBottom: '1px solid #F0EDE8', cursor: 'pointer',
      fontSize: 13, color: '#333', lineHeight: 1.4,
    },
    searching: { padding: '10px 14px', fontSize: 13, color: '#aaa' },
    attribution: {
      padding: '4px 10px', fontSize: 10, color: '#bbb', textAlign: 'right',
      borderTop: '1px solid #F0EDE8',
    },
  }

  return (
    <div ref={wrapRef} style={s.wrap}>
      <div style={s.inputRow}>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={ph}
          required={required}
          autoComplete="off"
          style={s.input}
        />
        {value && (
          <button type="button" onClick={handleClear} style={s.clearBtn} title={PT[lang].clear}>✕</button>
        )}
      </div>

      {open && (results.length > 0 || searching) && (
        <div style={s.dropdown}>
          {searching && <div style={s.searching}>…</div>}
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => handlePick(r)}
              style={{ ...s.row, borderBottom: i < results.length - 1 ? '1px solid #F0EDE8' : 'none' }}
            >
              📍 {r.display_name}
            </button>
          ))}
          <div style={s.attribution}>
            © <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" style={{ color: '#bbb' }}>OpenStreetMap</a>
          </div>
        </div>
      )}
    </div>
  )
}
