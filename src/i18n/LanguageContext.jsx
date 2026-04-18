import { createContext, useContext, useState } from 'react'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem('fellis_lang') || 'da'
  )

  function setLanguage(newLang) {
    localStorage.setItem('fellis_lang', newLang)
    setLangState(newLang)
  }

  return (
    <LanguageContext.Provider value={{ lang, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
