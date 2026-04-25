import { useLanguage } from '../i18n/LanguageContext.jsx'
import { UI_LANGS } from '../data.js'

// Dropdown that switches the app language without a page reload.
// Persists to localStorage immediately and to the server session via POST /api/set-language.
// Any component with a [lang] dependency in its useEffect will refetch automatically.
export default function LanguageSwitcher({ style }) {
  const { lang, setLang } = useLanguage()

  const s = {
    select: {
      background: 'none',
      border: '1px solid #D1CEC9',
      borderRadius: 6,
      padding: '4px 8px',
      fontSize: 13,
      cursor: 'pointer',
      color: '#2D3436',
      ...style,
    },
  }

  return (
    <select
      style={s.select}
      value={lang}
      onChange={e => setLang(e.target.value)}
      aria-label="Language"
    >
      {UI_LANGS.map(l => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  )
}
