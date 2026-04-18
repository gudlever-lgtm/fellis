#!/usr/bin/env node
/**
 * Missing key detector for the JSON-based i18n system.
 * Run: node scripts/check-i18n.js
 *
 * For each feature folder under src/i18n/ that contains da.json + en.json:
 *   - Compares all leaf keys recursively
 *   - Prints any keys present in one language but missing in the other
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

  const daPath = join(entryPath, 'da.json')
  const enPath = join(entryPath, 'en.json')

  if (!existsSync(daPath) && !existsSync(enPath)) continue

  featuresChecked++

  let daKeys = []
  let enKeys = []

  try {
    const raw = readFileSync(daPath, 'utf8')
    daKeys = getLeafKeys(JSON.parse(raw))
  } catch (err) {
    console.error(`${RED}[${entry}] Could not read da.json: ${err.message}${RESET}`)
    totalMissing++
    continue
  }

  try {
    const raw = readFileSync(enPath, 'utf8')
    enKeys = getLeafKeys(JSON.parse(raw))
  } catch (err) {
    console.error(`${RED}[${entry}] Could not read en.json: ${err.message}${RESET}`)
    totalMissing++
    continue
  }

  const daSet = new Set(daKeys)
  const enSet = new Set(enKeys)

  const missingInEn = daKeys.filter(k => !enSet.has(k))
  const missingInDa = enKeys.filter(k => !daSet.has(k))

  if (missingInEn.length > 0) {
    console.log(`${RED}[${entry}] Missing in en.json (${missingInEn.length}):${RESET}`)
    for (const k of missingInEn) console.log(`  - ${k}`)
    totalMissing += missingInEn.length
  }

  if (missingInDa.length > 0) {
    console.log(`${RED}[${entry}] Missing in da.json (${missingInDa.length}):${RESET}`)
    for (const k of missingInDa) console.log(`  - ${k}`)
    totalMissing += missingInDa.length
  }

  if (missingInEn.length === 0 && missingInDa.length === 0) {
    console.log(`${GREEN}[${entry}] ✓ da.json and en.json are in sync (${daKeys.length} keys)${RESET}`)
  }
}

console.log()
if (featuresChecked === 0) {
  console.log(`${RED}✗ No feature folders with JSON translation files found under src/i18n/${RESET}`)
  process.exit(1)
} else if (totalMissing > 0) {
  console.log(`${RED}✗ ${totalMissing} missing key(s) found across ${featuresChecked} feature(s)${RESET}`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All ${featuresChecked} feature translation files are in sync${RESET}`)
}
