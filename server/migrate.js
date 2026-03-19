#!/usr/bin/env node
/**
 * fellis.eu — Database Migration Runner
 *
 * Applies all unapplied migrate-*.sql files in alphabetical order.
 * Tracks applied migrations in a `_migrations` table so each file runs only once.
 *
 * Usage:
 *   node --env-file=.env migrate.js          # apply pending migrations
 *   node --env-file=.env migrate.js --status  # list applied / pending migrations
 *   node --env-file=.env migrate.js --dry-run # show what would run without applying
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load .env manually (same pattern as server/index.js) ──────────────────
try {
  const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

import mysql from 'mysql2/promise'

const FLAGS = process.argv.slice(2)
const STATUS_ONLY = FLAGS.includes('--status')
const DRY_RUN = FLAGS.includes('--dry-run')

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fellis_eu',
    multipleStatements: true,
  })

  // Ensure tracking table exists
  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Load already-applied migrations
  const [applied] = await conn.query('SELECT name FROM _migrations ORDER BY name')
  const appliedSet = new Set(applied.map(r => r.name))

  // Discover migration files (alphabetical = chronological by filename convention)
  const files = readdirSync(__dirname)
    .filter(f => f.startsWith('migrate-') && f.endsWith('.sql'))
    .sort()

  if (STATUS_ONLY) {
    console.log('\n── Migration status ───────────────────────────────')
    for (const f of files) {
      const status = appliedSet.has(f) ? '✅ applied' : '⏳ pending'
      console.log(`  ${status}  ${f}`)
    }
    console.log()
    await conn.end()
    return
  }

  const pending = files.filter(f => !appliedSet.has(f))

  if (!pending.length) {
    console.log('✅ All migrations already applied — nothing to do.')
    await conn.end()
    return
  }

  console.log(`\n── Running ${pending.length} pending migration(s) ─────────`)
  if (DRY_RUN) console.log('   (dry-run — no changes will be made)\n')

  let ok = 0
  let failed = 0
  for (const file of pending) {
    const sql = readFileSync(path.join(__dirname, file), 'utf8')
    console.log(`  ▶  ${file}`)
    if (DRY_RUN) { ok++; continue }
    try {
      await conn.query(sql)
      await conn.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file])
      console.log(`     ✅ done`)
      ok++
    } catch (err) {
      console.error(`     ❌ FAILED: ${err.message}`)
      failed++
      // Continue with remaining migrations — partial runs are safe because
      // each file is only re-tried on the next run if it was not recorded.
    }
  }

  console.log(`\n── Summary: ${ok} applied, ${failed} failed ─────────────\n`)
  await conn.end()
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Migration runner error:', err.message)
  process.exit(1)
})
