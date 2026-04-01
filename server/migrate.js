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
    multipleStatements: false,
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

  // MySQL error codes that mean "already done" — safe to skip
  const SKIP_CODES = new Set([
    1060, // Duplicate column name (ADD COLUMN but column already exists)
    1061, // Duplicate key name (ADD INDEX but index already exists)
    1050, // Table already exists (without IF NOT EXISTS)
    1091, // Can't DROP; column/key doesn't exist
    1068, // Multiple primary key defined
  ])

  // Split a SQL file into individual statements.
  // Uses a line-by-line parser so DELIMITER // blocks (used for stored
  // procedures) are handled correctly: while the delimiter is '//', internal
  // semicolons are treated as part of the statement body, not as terminators.
  function splitStatements(sql) {
    const stmts = []
    let delimiter = ';'
    let current = ''

    for (const line of sql.split(/\r?\n/)) {
      const trimmed = line.trim()

      // DELIMITER directive — switch the active delimiter, don't accumulate
      const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i)
      if (delimMatch) {
        delimiter = delimMatch[1]
        continue
      }

      current += (current ? '\n' : '') + line

      if (delimiter === ';') {
        // Normal mode: flush when line (minus inline comment) ends with ';'
        const stripped = trimmed.replace(/--.*$/, '').trimEnd()
        if (stripped.endsWith(';')) {
          const stmt = current.trim().replace(/;[\s]*$/, '').trim()
          if (stmt) stmts.push(stmt)
          current = ''
        }
      } else {
        // Custom delimiter mode (e.g. '//'):
        // flush when the line ends with the custom delimiter
        const esc = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(esc + '\\s*$').test(trimmed)) {
          const stmt = current.replace(new RegExp('\\s*' + esc + '\\s*$'), '').trim()
          if (stmt) stmts.push(stmt)
          current = ''
        }
      }
    }

    if (current.trim()) stmts.push(current.trim())
    return stmts
  }

  // MySQL 8 doesn't support ADD/CREATE INDEX/COLUMN IF NOT EXISTS or
  // DROP COLUMN/INDEX IF EXISTS (those are MariaDB extensions). Strip the
  // IF [NOT] EXISTS clause so the statement can run, then let the error-code
  // filter handle duplicates/missing items.
  function mysqlCompatible(stmt) {
    return stmt
      .replace(/\bADD COLUMN IF NOT EXISTS\b/gi, 'ADD COLUMN')
      .replace(/\bADD INDEX IF NOT EXISTS\b/gi, 'ADD INDEX')
      .replace(/\bADD KEY IF NOT EXISTS\b/gi, 'ADD KEY')
      .replace(/\bADD UNIQUE(?: INDEX| KEY)? IF NOT EXISTS\b/gi, m => m.replace(/ IF NOT EXISTS/i, ''))
      .replace(/\bCREATE INDEX IF NOT EXISTS\b/gi, 'CREATE INDEX')
      .replace(/\bCREATE UNIQUE INDEX IF NOT EXISTS\b/gi, 'CREATE UNIQUE INDEX')
      .replace(/\bDROP COLUMN IF EXISTS\b/gi, 'DROP COLUMN')
      .replace(/\bDROP INDEX IF EXISTS\b/gi, 'DROP INDEX')
      .replace(/\bDROP KEY IF EXISTS\b/gi, 'DROP KEY')
  }

  let ok = 0
  let failed = 0
  for (const file of pending) {
    const sql = readFileSync(path.join(__dirname, file), 'utf8')
    console.log(`  ▶  ${file}`)
    if (DRY_RUN) { ok++; continue }

    const stmts = splitStatements(sql)
    let fileFailed = false

    for (const rawStmt of stmts) {
      const stmt = mysqlCompatible(rawStmt)
      try {
        await conn.query(stmt)
      } catch (err) {
        if (SKIP_CODES.has(err.errno)) {
          // Already applied / already exists — not a real error
          continue
        }
        console.error(`     ❌ FAILED: ${err.message}`)
        console.error(`        Statement: ${stmt.slice(0, 120).replace(/\s+/g, ' ')}`)
        fileFailed = true
      }
    }

    if (!fileFailed) {
      await conn.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file])
      console.log(`     ✅ done`)
      ok++
    } else {
      failed++
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
