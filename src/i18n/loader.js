const cache = new Map()

function getNestedValue(obj, keyPath) {
  if (!obj || typeof obj !== 'object') return undefined
  return keyPath.split('.').reduce((curr, key) => {
    return curr != null && typeof curr === 'object' ? curr[key] : undefined
  }, obj)
}

export async function loadTranslation(lang, feature) {
  const cacheKey = `${lang}:${feature}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  try {
    const mod = await import(`./${feature}/${lang}.json`)
    const translations = mod.default ?? mod
    cache.set(cacheKey, translations)
    return translations
  } catch {
    if (lang !== 'en') {
      return loadTranslation('en', feature)
    }
    cache.set(cacheKey, {})
    return {}
  }
}

export function resolveKey(translations, fallback, keyPath, lang, feature) {
  const val = getNestedValue(translations, keyPath)
  if (val !== undefined) return val

  if (fallback) {
    const fallbackVal = getNestedValue(fallback, keyPath)
    if (fallbackVal !== undefined) return fallbackVal
  }

  if (import.meta.env?.DEV) {
    console.warn(`[i18n] Missing key: "${keyPath}" (lang: ${lang}, feature: ${feature})`)
  }

  return keyPath
}
