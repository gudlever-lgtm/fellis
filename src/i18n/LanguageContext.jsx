import { createContext, useContext, useState } from 'react'
import { detectLanguage } from '../utils/detectLanguage.js'
import { apiSetLanguage } from '../api.js'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => detectLanguage())

  function setLanguage(newLang) {
    localStorage.setItem('lang', newLang)
    setLangState(newLang)
    // Best-effort: persist to session + users.preferred_lang on the server.
    // Failure is non-fatal — localStorage is the source of truth for the current session.
    apiSetLanguage(newLang).catch(() => {})
  }

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, setLang: setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
