import crypto from 'node:crypto'
import pool from './db.js'

const DEEPL_URL = 'https://api-free.deepl.com/v2/translate'

export async function translate(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${text}:${sourceLang}:${targetLang}`)
    .digest('hex')

  try {
    const [[cached]] = await pool.query(
      'SELECT translated_text FROM translation_cache WHERE cache_key = ?',
      [cacheKey]
    )
    if (cached) return cached.translated_text
  } catch (err) {
    console.error('[translate] cache lookup failed:', err.message)
  }

  try {
    const resp = await fetch(DEEPL_URL, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        source_lang: sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) throw new Error(`DeepL error: ${resp.status}`)
    const { translations } = await resp.json()
    const translated = translations[0].text

    await pool.query(
      `INSERT INTO translation_cache (cache_key, source_lang, target_lang, original_text, translated_text)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text)`,
      [cacheKey, sourceLang, targetLang, text, translated]
    )
    return translated
  } catch (err) {
    console.error('[translate] DeepL call failed:', err.message)
    return text
  }
}
