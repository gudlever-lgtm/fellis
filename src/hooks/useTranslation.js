import { useState, useRef } from 'react'
import { useLanguage } from '../i18n/LanguageContext.jsx'
import { loadTranslation, resolveKey } from '../i18n/loader.js'

// Returns t(key, namespace='common') that resolves keys from JSON files in
// src/i18n/{namespace}/{lang}.json with a fallback chain: lang → 'en' → key.
// Translations load asynchronously on first use per namespace and trigger a re-render.
export function useTranslation() {
  const { lang, setLanguage } = useLanguage()
  const [, forceUpdate] = useState(0)
  // Per-instance cache: "namespace:lang" → translations object | null (loading)
  const cache = useRef({})

  function t(key, namespace = 'common') {
    const lk = `${namespace}:${lang}`
    const ek = `${namespace}:en`

    if (!(lk in cache.current)) {
      cache.current[lk] = null // mark as loading to prevent duplicate requests
      const loads = [loadTranslation(lang, namespace)]
      if (lang !== 'en') loads.push(loadTranslation('en', namespace))
      Promise.all(loads).then(([trans, enTrans]) => {
        cache.current[lk] = trans
        if (enTrans) cache.current[ek] = enTrans
        forceUpdate(n => n + 1)
      })
    }

    return resolveKey(
      cache.current[lk] ?? null,
      lang !== 'en' ? (cache.current[ek] ?? null) : null,
      key,
      lang,
      namespace,
    )
  }

  return { t, lang, setLang: setLanguage }
}
