#!/usr/bin/env node
/**
 * fellis.eu — Index verification / audit tool
 *
 * Purpose: before any "missing index" migration lands, run this against the
 * live DB to see what indexes are actually there. Compares against a curated
 * list of expected indexes on hot tables (feed, messages, notifications …)
 * and prints three sections:
 *
 *   1. SHOW INDEX FROM <table> — raw listing for each audited table
 *   2. Expected vs. actual   — which expected indexes are present / missing
 *   3. Summary               — counts + exit code
 *
 * Usage:
 *   node --env-file=.env verify-indexes.js           # full report
 *   node --env-file=.env verify-indexes.js --missing # only the gap analysis
 *   node --env-file=.env verify-indexes.js --json    # machine-readable
 *
 * IMPORTANT: this script only reads (SHOW INDEX). It never adds, drops, or
 * alters an index. The gap analysis is advisory — a "missing" entry is an
 * input for a human decision, not a blind migration target, since:
 *   - Adding an index to a large hot table blocks writes on MySQL 5.7 and
 *     older, and can thrash replication lag on 8.x.
 *   - A composite index often makes a single-column one redundant.
 *   - Some expected shapes here are heuristics, not universally correct.
 * Cross-check each gap with EXPLAIN on real queries before writing a migrate-
 * *.sql file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
const MISSING_ONLY = FLAGS.includes('--missing')
const AS_JSON = FLAGS.includes('--json')

// Curated list of (table, columnSpec) expected to be indexed. columnSpec is
// the exact ordered column list on the index — order matters for composite
// keys since a left-prefix index on (a, b) covers WHERE a=? but not WHERE b=?.
//
// Derived from the highest-frequency WHERE/ORDER BY patterns in server/
// routes/. Not exhaustive — add entries as new hot paths appear.
const EXPECTED = [
  // posts — feed pagination (mode + created_at)
  { table: 'posts', cols: ['user_mode', 'created_at'], why: 'feed mode-filtered pagination' },
  { table: 'posts', cols: ['user_id', 'created_at'], why: 'profile post listing' },
  { table: 'posts', cols: ['scheduled_at'], why: 'scheduled-post publisher scan' },
  { table: 'posts', cols: ['share_token'], why: 'shared-post permalink lookup' },

  // comments
  { table: 'comments', cols: ['post_id', 'created_at'], why: 'comment thread per post' },
  { table: 'comments', cols: ['user_id'], why: 'comments by user' },

  // likes
  { table: 'post_likes', cols: ['post_id'], why: 'like count per post' },
  { table: 'post_likes', cols: ['user_id', 'post_id'], why: 'has-user-liked lookup' },

  // messages / conversations
  { table: 'messages', cols: ['conversation_id', 'created_at'], why: 'conversation history pagination' },
  { table: 'conversation_participants', cols: ['user_id'], why: 'list conversations for user' },
  { table: 'conversation_participants', cols: ['conversation_id', 'user_id'], why: 'membership lookup' },

  // notifications
  { table: 'notifications', cols: ['user_id', 'created_at'], why: 'notification inbox' },
  { table: 'notifications', cols: ['user_id', 'read_at'], why: 'unread-count query' },

  // sessions
  { table: 'sessions', cols: ['user_id'], why: 'list sessions for user' },
  { table: 'sessions', cols: ['expires_at'], why: 'expired-session cleanup sweep' },

  // friendships
  { table: 'friendships', cols: ['user_id'], why: 'friends of user' },
  { table: 'friendships', cols: ['friend_id'], why: 'reverse friend lookup' },

  // marketplace
  { table: 'marketplace_listings', cols: ['user_id', 'created_at'], why: 'user listings' },
  { table: 'marketplace_listings', cols: ['category', 'created_at'], why: 'category browse' },

  // jobs
  { table: 'jobs', cols: ['company_id'], why: 'jobs by company' },
  { table: 'job_applications', cols: ['job_id', 'user_id'], why: 'per-job applicant lookup' },
  { table: 'job_applications', cols: ['user_id'], why: 'applications by user' },

  // ads
  { table: 'ads', cols: ['paid_until'], why: 'active-ad selection window' },
  { table: 'ads', cols: ['user_id'], why: 'ads by user' },
  { table: 'ad_impressions', cols: ['ad_id', 'user_id'], why: 'impression dedupe' },

  // interest graph
  { table: 'interest_signals', cols: ['user_id', 'created_at'], why: 'recent signals per user' },
  { table: 'interest_scores', cols: ['user_id'], why: 'score lookup per user' },

  // reels
  { table: 'reels', cols: ['user_id', 'created_at'], why: 'reel listing per user' },
  { table: 'reel_likes', cols: ['reel_id'], why: 'reel like count' },
]

// Tables we want to SHOW INDEX on, even if not in EXPECTED — useful for a
// full picture.
const AUDIT_TABLES = Array.from(new Set([
  ...EXPECTED.map(e => e.table),
  'users', 'stories', 'events', 'event_rsvps', 'companies',
  'company_followers', 'skills', 'skill_endorsements',
  'moderation_reports', 'audit_log', 'interest_categories',
  'user_interests', 'badges', 'badge_earned',
])).sort()

// Normalise an index's column list into a JSON-stringified array so we can
// compare by identity.
function keyFor(cols) { return JSON.stringify(cols.map(c => c.toLowerCase())) }

// Given rows from SHOW INDEX, group columns by Key_name preserving Seq_in_index
// order, and return a Map<Key_name, string[]>.
function groupIndexes(rows) {
  const byName = new Map()
  for (const r of rows) {
    if (!byName.has(r.Key_name)) byName.set(r.Key_name, [])
    byName.get(r.Key_name).push({ seq: r.Seq_in_index, col: r.Column_name })
  }
  const out = new Map()
  for (const [name, parts] of byName) {
    parts.sort((a, b) => a.seq - b.seq)
    out.set(name, parts.map(p => p.col))
  }
  return out
}

// Does an existing index cover the expected column list as a left-prefix?
// A query on (a, b) is served by an index on (a, b) or (a, b, c), but not by
// (b, a) or (a, c, b).
function hasLeftPrefix(existing, expectedCols) {
  const k = keyFor(expectedCols)
  for (const cols of existing.values()) {
    if (cols.length < expectedCols.length) continue
    const prefix = cols.slice(0, expectedCols.length)
    if (keyFor(prefix) === k) return true
  }
  return false
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fellis_eu',
    multipleStatements: false,
  })

  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db')
  const [tablesRows] = await conn.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
    [db],
  )
  const existingTables = new Set(tablesRows.map(r => (r.TABLE_NAME || r.table_name)))

  const tableReport = []
  const gaps = []
  let checked = 0
  let satisfied = 0

  for (const table of AUDIT_TABLES) {
    if (!existingTables.has(table)) {
      tableReport.push({ table, missing: true, indexes: null })
      continue
    }
    const [idxRows] = await conn.query(`SHOW INDEX FROM \`${table}\``)
    const indexes = groupIndexes(idxRows)
    tableReport.push({ table, missing: false, indexes })

    for (const e of EXPECTED.filter(x => x.table === table)) {
      checked++
      if (hasLeftPrefix(indexes, e.cols)) {
        satisfied++
      } else {
        gaps.push(e)
      }
    }
  }

  await conn.end()

  if (AS_JSON) {
    const serial = {
      database: db,
      checked,
      satisfied,
      gaps,
      tables: tableReport.map(t => ({
        table: t.table,
        missing: t.missing,
        indexes: t.indexes ? Object.fromEntries(t.indexes) : null,
      })),
    }
    console.log(JSON.stringify(serial, null, 2))
    process.exit(gaps.length ? 1 : 0)
  }

  if (!MISSING_ONLY) {
    console.log(`\n── SHOW INDEX on \`${db}\` — ${AUDIT_TABLES.length} tables ──`)
    for (const t of tableReport) {
      if (t.missing) {
        console.log(`\n  ${t.table}  (table does not exist)`)
        continue
      }
      console.log(`\n  ${t.table}`)
      for (const [name, cols] of t.indexes) {
        console.log(`    ${name.padEnd(30)}  (${cols.join(', ')})`)
      }
    }
  }

  console.log(`\n── Expected-index gap analysis — ${checked} checks ──`)
  if (!gaps.length) {
    console.log('  ✅ All expected indexes are present.')
  } else {
    for (const g of gaps) {
      console.log(`  ⚠  ${g.table}(${g.cols.join(', ')})  — ${g.why}`)
    }
  }
  console.log(`\n── Summary: ${satisfied}/${checked} expected indexes present — ${gaps.length} gaps ──\n`)

  process.exit(gaps.length ? 1 : 0)
}

main().catch(err => {
  console.error('verify-indexes error:', err.message)
  process.exit(2)
})
