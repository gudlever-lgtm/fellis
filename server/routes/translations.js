import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const router = Router()

const VALID_LANGS = new Set(['da', 'en', 'de', 'es', 'fr', 'it', 'nl', 'no', 'pl', 'pt', 'sv'])
const VALID_FEATURES = new Set(['common', 'auth', 'feed', 'profile'])

router.get('/translations', async (req, res) => {
  const { lang, feature } = req.query

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
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Translation file not found' })
    }
    return res.status(500).json({ error: 'Could not read translation file' })
  }
})

export default router
