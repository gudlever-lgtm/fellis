#!/usr/bin/env node
// Fetches LDNOOBW word lists (da + en) and inserts them into keyword_filters.
// Words are set to 'flag' by default — review and change to 'block' in admin panel.
//
// Usage:
//   node --env-file=.env import-keyword-lists.js
//   node --env-file=.env import-keyword-lists.js --dry-run

import { createPool } from 'mysql2/promise'

const DRY_RUN = process.argv.includes('--dry-run')

const LISTS = [
  { lang: 'da', url: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/da', category: 'profanity', notes: 'LDNOOBW open-source ordliste (dansk)' },
  { lang: 'en', url: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en', category: 'profanity', notes: 'LDNOOBW open-source word list (English)' },
]

async function fetchWords(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const text = await res.text()
  return text.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
}

async function main() {
  const pool = createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'fellis_eu',
  })

  let totalInserted = 0
  let totalSkipped  = 0

  for (const { lang, url, category, notes } of LISTS) {
    console.log(`\nFetching ${lang.toUpperCase()} list from LDNOOBW…`)
    const words = await fetchWords(url)
    console.log(`  ${words.length} words found`)

    for (const word of words) {
      if (DRY_RUN) {
        console.log(`  [dry-run] would insert: "${word}" (flag, ${category})`)
        totalInserted++
        continue
      }
      try {
        const [result] = await pool.query(
          'INSERT INTO keyword_filters (keyword, action, category, notes) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE keyword=keyword',
          [word, 'flag', category, notes]
        )
        if (result.affectedRows > 0 && result.warningStatus === 0) totalInserted++
        else totalSkipped++
      } catch (err) {
        console.warn(`  skipped "${word}": ${err.message}`)
        totalSkipped++
      }
    }
  }

  if (!DRY_RUN) await pool.end()

  console.log(`\nDone.`)
  console.log(`  Inserted: ${totalInserted}`)
  console.log(`  Skipped (already exists): ${totalSkipped}`)
  console.log(`\nAll words imported with action='flag'.`)
  console.log(`Review in admin panel and change critical words to action='block'.`)
}

main().catch(err => { console.error(err); process.exit(1) })
