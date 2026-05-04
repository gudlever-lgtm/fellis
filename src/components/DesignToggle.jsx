import useDesignToggle from '../hooks/useDesignToggle.js'
import { useLanguage } from '../i18n/LanguageContext.jsx'
import { getTranslations } from '../data.js'

export default function DesignToggle() {
  const { lang } = useLanguage()
  const { design, toggleDesign } = useDesignToggle()
  const t = getTranslations(lang)

  function handleClick() {
    toggleDesign()
    window.location.reload()
  }

  const label = design === 'classic'
    ? (t.designToggle?.testNew || 'Test det nye design')
    : (t.designToggle?.goClassic || 'Gå til klassisk design')

  return (
    <button className="design-toggle-btn" onClick={handleClick}>
      {label}
    </button>
  )
}
