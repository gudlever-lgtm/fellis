import crypto from 'node:crypto'
import pool from './db.js'

const DEEPL_URL = 'https://api-free.deepl.com/v2/translate'

export const SUPPORTED_LANGS = new Set(['DA', 'EN', 'DE', 'FR', 'NL', 'SV', 'FI', 'NO', 'PL', 'ES', 'IT', 'PT'])

export async function translateText(text, targetLang) {
  const lang = targetLang.toUpperCase()
  if (!SUPPORTED_LANGS.has(lang)) throw new Error(`Unsupported language: ${targetLang}`)

  const sourceHash = crypto.createHash('sha256').update(text).digest('hex')

  try {
    const [[cached]] = await pool.query(
      'SELECT translated_text, detected_source_lang FROM translation_cache WHERE source_hash = ? AND target_lang = ?',
      [sourceHash, lang]
    )
    if (cached) return { translatedText: cached.translated_text, detectedSourceLang: cached.detected_source_lang }
  } catch (err) {
    console.error('[translateText] cache lookup failed:', err.message)
  }

  const apiKey = process.env.DEEPL_API_KEY
  if (!apiKey) throw new Error('DEEPL_API_KEY is not configured')

  const resp = await fetch(DEEPL_URL, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: [text], target_lang: lang }),
    signal: AbortSignal.timeout(8000),
  })

  if (!resp.ok) throw new Error(`DeepL error: ${resp.status}`)
  const { translations } = await resp.json()
  const { text: translatedText, detected_source_language: detectedSourceLang } = translations[0]

  try {
    await pool.query(
      `INSERT INTO translation_cache (source_hash, target_lang, translated_text, detected_source_lang)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), detected_source_lang = VALUES(detected_source_lang)`,
      [sourceHash, lang, translatedText, detectedSourceLang]
    )
  } catch (err) {
    console.error('[translateText] cache store failed:', err.message)
  }

  return { translatedText, detectedSourceLang }
}
