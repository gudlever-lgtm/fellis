import crypto from 'node:crypto'
import pool from './db.js'

export async function translate(text, sourceLang, targetLang) {
  const hash = crypto.createHash('sha256').update(text).digest('hex')

  const [[cached]] = await pool.query(
    'SELECT translated_text FROM translation_cache WHERE original_text_hash = ? AND source_lang = ? AND target_lang = ?',
    [hash, sourceLang, targetLang]
  )
  if (cached) return cached.translated_text

  const baseUrl = process.env.LIBRETRANSLATE_URL
  if (!baseUrl) throw new Error('LIBRETRANSLATE_URL not configured')

  const resp = await fetch(`${baseUrl}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' }),
  })
  if (!resp.ok) throw new Error(`LibreTranslate error: ${resp.status}`)
  const data = await resp.json()
  const translated = data.translatedText

  await pool.query(
    `INSERT INTO translation_cache (original_text_hash, source_lang, target_lang, translated_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text)`,
    [hash, sourceLang, targetLang, translated]
  )
  return translated
}
