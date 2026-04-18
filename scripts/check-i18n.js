#!/usr/bin/env node
/**
 * Missing key detector for the JSON-based i18n system.
 * Run: node scripts/check-i18n.js
 *
 * For each feature folder under src/i18n/ that contains JSON translation files:
 *   - Uses en.json as the reference key set
 *   - Compares all other language files against the reference recursively
 *   - Prints any keys missing in any language file
 *
 * Exit code 1 if any mismatches are found (CI-friendly).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const i18nDir = resolve(__dir, '../src/i18n')

const GREEN = '\x1b[32m'
const RED   = '\x1b[31m'
const RESET = '\x1b[0m'

const ALL_LANGS = ['da', 'en', 'de', 'es', 'fr', 'it', 'nl', 'no', 'pl', 'pt', 'sv']
const REFERENCE_LANG = 'en'

function getLeafKeys(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...getLeafKeys(v, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

let totalMissing = 0
let featuresChecked = 0

const entries = readdirSync(i18nDir).sort()

for (const entry of entries) {
  const entryPath = join(i18nDir, entry)
  if (!statSync(entryPath).isDirectory()) continue

  const refPath = join(entryPath, `${REFERENCE_LANG}.json`)
  if (!existsSync(refPath)) continue

  featuresChecked++

  let refKeys = []
  try {
    const raw = readFileSync(refPath, 'utf8')
    refKeys = getLeafKeys(JSON.parse(raw))
  } catch (err) {
    console.error(`${RED}[${entry}] Could not read ${REFERENCE_LANG}.json: ${err.message}${RESET}`)
    totalMissing++
    continue
  }

  const refSet = new Set(refKeys)
  let featureOk = true

  for (const lang of ALL_LANGS) {
    if (lang === REFERENCE_LANG) continue

    const langPath = join(entryPath, `${lang}.json`)
    if (!existsSync(langPath)) {
      console.log(`${RED}[${entry}] Missing file: ${lang}.json${RESET}`)
      totalMissing++
      featureOk = false
      continue
    }

    let langKeys = []
    try {
      const raw = readFileSync(langPath, 'utf8')
      langKeys = getLeafKeys(JSON.parse(raw))
    } catch (err) {
      console.error(`${RED}[${entry}] Could not read ${lang}.json: ${err.message}${RESET}`)
      totalMissing++
      featureOk = false
      continue
    }

    const langSet = new Set(langKeys)
    const missingInLang = refKeys.filter(k => !langSet.has(k))
    const extraInLang   = langKeys.filter(k => !refSet.has(k))

    if (missingInLang.length > 0) {
      console.log(`${RED}[${entry}/${lang}] Missing keys (${missingInLang.length}):${RESET}`)
      for (const k of missingInLang) console.log(`  - ${k}`)
      totalMissing += missingInLang.length
      featureOk = false
    }

    if (extraInLang.length > 0) {
      console.log(`${RED}[${entry}/${lang}] Extra keys not in ${REFERENCE_LANG}.json (${extraInLang.length}):${RESET}`)
      for (const k of extraInLang) console.log(`  + ${k}`)
      totalMissing += extraInLang.length
      featureOk = false
    }
  }

  if (featureOk) {
    console.log(`${GREEN}[${entry}] ✓ All ${ALL_LANGS.length} language files in sync (${refKeys.length} keys)${RESET}`)
  }
}

console.log()
if (featuresChecked === 0) {
  console.log(`${RED}✗ No feature folders with JSON translation files found under src/i18n/${RESET}`)
  process.exit(1)
} else if (totalMissing > 0) {
  console.log(`${RED}✗ ${totalMissing} missing/extra key(s) found across ${featuresChecked} feature(s)${RESET}`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All ${featuresChecked} feature translation files are in sync across ${ALL_LANGS.length} languages${RESET}`)
}
