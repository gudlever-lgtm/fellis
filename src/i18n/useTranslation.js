import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from './LanguageContext.jsx'
import { loadTranslation, resolveKey } from './loader.js'

export function useTranslation(feature) {
  const { lang, setLanguage } = useLanguage()
  const [translations, setTranslations] = useState(null)
  const [fallback, setFallback] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [langTrans, enTrans] = await Promise.all([
        loadTranslation(lang, feature),
        lang !== 'en' ? loadTranslation('en', feature) : Promise.resolve(null),
      ])

      if (!cancelled) {
        setTranslations(langTrans)
        setFallback(enTrans)
      }
    }

    load()
    return () => { cancelled = true }
  }, [lang, feature])

  const t = useCallback((key) => {
    return resolveKey(translations, fallback, key, lang, feature)
  }, [translations, fallback, lang, feature])

  return { t, lang, setLanguage }
}
