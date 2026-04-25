import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from '../db.js'
import { getSessionIdFromRequest } from '../middleware.js'
import { translate } from '../translate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const router = Router()

const VALID_LANGS = new Set(['da', 'en', 'de', 'es', 'fi', 'fr', 'it', 'nl', 'no', 'pl', 'pt', 'sv'])
const VALID_FEATURES = new Set(['common', 'auth', 'feed', 'profile'])

// GET /api/translations?lang=en[&feature=auth]
// With feature: returns JSON file from src/i18n/<feature>/<lang>.json
// Without feature: returns all rows from translations_ui for lang (fallback to 'en')
router.get('/translations', async (req, res) => {
  const { lang, feature } = req.query

  if (feature) {
    if (!VALID_LANGS.has(lang)) {
      return res.status(400).json({ error: `Invalid lang — must be one of: ${[...VALID_LANGS].join(', ')}` })
    }
    if (!VALID_FEATURES.has(feature)) {
      return res.status(400).json({ error: `Unknown feature — must be one of: ${[...VALID_FEATURES].join(', ')}` })
    }
    const filePath = resolve(__dirname, '../../src/i18n', feature, `${lang}.json`)
    try {
      const content = await readFile(filePath, 'utf8')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.send(content)
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Translation file not found' })
      return res.status(500).json({ error: 'Could not read translation file' })
    }
    return
  }

  // DB-backed: missing or invalid lang defaults to 'en'
  const effectiveLang = VALID_LANGS.has(lang) ? lang : 'en'
  try {
    const [rows] = await pool.query(
      'SELECT `key`, value FROM translations_ui WHERE lang = ?',
      [effectiveLang]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'No translations found for language' })
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])))
  } catch (err) {
    console.error('[GET /api/translations]', err.message)
    res.status(500).json({ error: 'Could not load translations' })
  }
})

// POST /api/set-language { lang }
// Persists the chosen language to the current session and, if authenticated, to users.preferred_lang.
router.post('/set-language', async (req, res) => {
  const { lang } = req.body ?? {}
  if (!VALID_LANGS.has(lang)) {
    return res.status(400).json({ error: `Invalid lang — must be one of: ${[...VALID_LANGS].join(', ')}` })
  }
  const sessionId = getSessionIdFromRequest(req)
  if (sessionId) {
    try {
      await pool.query('UPDATE sessions SET lang = ? WHERE id = ?', [lang, sessionId])
      await pool.query(
        'UPDATE users u JOIN sessions s ON u.id = s.user_id SET u.preferred_lang = ? WHERE s.id = ?',
        [lang, sessionId]
      )
    } catch (err) {
      console.error('[POST /api/set-language] DB update failed:', err.message)
    }
  }
  res.json({ ok: true, lang })
})

// GET /api/content/:id?lang=en
// Returns post text in the requested language, translating via cache/LibreTranslate as needed.
// Platform primary language is 'da'; text_en is used directly when available.
router.get('/content/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'Invalid content id' })

  const requestedLang = VALID_LANGS.has(req.query.lang) ? req.query.lang : 'da'
  try {
    const [[post]] = await pool.query(
      'SELECT id, text_da, text_en FROM posts WHERE id = ?',
      [id]
    )
    if (!post) return res.status(404).json({ error: 'Content not found' })

    if (requestedLang === 'da') return res.json({ id, lang: 'da', text: post.text_da })
    if (requestedLang === 'en' && post.text_en) return res.json({ id, lang: 'en', text: post.text_en })

    const text = await translate(post.text_da, 'da', requestedLang)
    res.json({ id, lang: requestedLang, text })
  } catch (err) {
    console.error('[GET /api/content/:id]', err.message)
    res.status(500).json({ error: 'Could not fetch content' })
  }
})

export default router
