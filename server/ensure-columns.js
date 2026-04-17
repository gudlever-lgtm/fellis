// Runtime schema-patch helper.
//
// Historically, `server/index.js` carried a long pile of fire-and-forget
// ADD COLUMN calls that ran at module load to bring legacy DBs in sync with
// the code. That pile has been extracted here so index.js stays focused on
// routing/startup wiring. The actual source of truth for new environments is
// still schema.sql + the migrate-*.sql files; this module only patches old
// installs where a proper migration was never authored.
//
// addCol() is exported for the handful of sites that still call it inline
// from async route handlers (e.g. safety-net column adds before a feature
// runs). New code should prefer a migrate-*.sql file over calling addCol().

import pool from './db.js'

// Whitelist tables that runtime addCol is allowed to touch. Matches the list
// used previously in index.js — keep in sync when new tables are added.
const VALID_TABLES = new Set([
  'users', 'posts', 'comments', 'friendships', 'companies',
  'admin_ad_settings', 'admin_settings', 'reels', 'marketplace_listings', 'jobs',
  'shared_jobs', 'earned_badges', 'user_badges', 'badge_config', 'livestreams',
  'messages', 'conversations', 'sessions', 'invitations', 'post_likes',
  'reel_likes', 'reel_comments', 'stories', 'events', 'notifications',
  'conversation_participants', 'ads', 'subscriptions', 'job_saves',
  'event_rsvps', 'job_applications',
])

const ALLOWED_KEYWORDS = [
  'varchar', 'int', 'bigint', 'timestamp', 'boolean', 'text', 'datetime',
  'decimal', 'not null', 'null', 'default', 'unique', 'current_timestamp',
]

export async function addCol(table, col, def) {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`)
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
    throw new Error(`Invalid column name: ${col}`)
  }
  const defLower = def.toLowerCase()
  const isValid = ALLOWED_KEYWORDS.some(kw => defLower.includes(kw)) &&
                  !def.includes(';') && !def.includes('--') && !def.includes('/*')
  if (!isValid) {
    throw new Error(`Invalid column definition: ${def}`)
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`)
      return
    } catch (e) {
      if (e.errno === 1060) return // Column already exists — nothing to do
      if (e.errno === 1213 && attempt < 3) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)))
        continue
      }
      console.error(`Migration (${table}.${col}):`, e.message)
      return
    }
  }
}

// Columns that must be brought in sync at startup on legacy DBs. Ordering
// within groups preserves the original sequence from index.js so any implicit
// ordering assumptions (e.g. sessions columns before first login request)
// still hold.
const RUNTIME_COLUMNS = [
  // Auto-migrations
  ['comments', 'media', 'JSON DEFAULT NULL'],
  ['post_likes', 'reaction', "VARCHAR(10) DEFAULT '❤️'"],
  ['invitations', 'invitee_email', 'VARCHAR(255) DEFAULT NULL'],
  ['marketplace_listings', 'contact_phone', 'VARCHAR(20) DEFAULT NULL'],
  ['marketplace_listings', 'contact_email', 'VARCHAR(255) DEFAULT NULL'],
  ['marketplace_listings', 'sold', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['marketplace_listings', 'priceNegotiable', 'TINYINT(1) NOT NULL DEFAULT 0'],

  ['users', 'mode', "VARCHAR(20) DEFAULT 'privat'"],
  ['users', 'plan', "VARCHAR(30) DEFAULT 'business'"],
  ['users', 'ads_free', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'stripe_customer_id', 'VARCHAR(100) DEFAULT NULL'],
  ['users', 'ads_free_sub_id', 'VARCHAR(200) DEFAULT NULL'],
  ['users', 'cv_public', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'phone', 'VARCHAR(20) DEFAULT NULL'],
  ['users', 'password_plain', 'VARCHAR(255) DEFAULT NULL'],
  ['users', 'mfa_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'mfa_code', 'VARCHAR(64) DEFAULT NULL'],
  ['users', 'mfa_code_expires', 'DATETIME DEFAULT NULL'],
  ['users', 'failed_login_attempts', 'INT DEFAULT 0'],
  ['users', 'locked_until', 'TIMESTAMP NULL DEFAULT NULL'],

  // Viral growth
  ['users', 'profile_public', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'reputation_score', 'INT(11) NOT NULL DEFAULT 0'],
  ['users', 'referral_count', 'INT(11) NOT NULL DEFAULT 0'],
  ['invitations', 'invite_source', "ENUM('link','email','facebook','other') DEFAULT 'link'"],
  ['invitations', 'utm_source', 'VARCHAR(100) DEFAULT NULL'],
  ['invitations', 'utm_campaign', 'VARCHAR(100) DEFAULT NULL'],
  ['posts', 'share_token', 'VARCHAR(64) DEFAULT NULL'],
  ['posts', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['posts', 'share_count', 'INT(11) NOT NULL DEFAULT 0'],
  ['posts', 'tagged_users', 'JSON DEFAULT NULL'],
  ['posts', 'linked_type', 'VARCHAR(20) DEFAULT NULL'],
  ['posts', 'linked_id', 'INT DEFAULT NULL'],
  ['posts', 'scheduled_at', 'TIMESTAMP NULL DEFAULT NULL'],
  ['reels', 'tagged_users', 'JSON DEFAULT NULL'],

  // Group suggestions
  ['conversations', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['conversations', 'category', 'VARCHAR(100) DEFAULT NULL'],
  ['conversations', 'description_da', 'TEXT DEFAULT NULL'],
  ['conversations', 'description_en', 'TEXT DEFAULT NULL'],
  ['messages', 'media', 'JSON DEFAULT NULL'],

  // Columns needed by login handler — must exist before first request
  ['sessions', 'user_agent', 'VARCHAR(500) DEFAULT NULL'],
  ['sessions', 'ip_address', 'VARCHAR(50) DEFAULT NULL'],
  ['users', 'failed_login_attempts', 'INT NOT NULL DEFAULT 0'],
  ['users', 'locked_until', 'DATETIME DEFAULT NULL'],

  // Moderation
  ['users', 'status', "ENUM('active','suspended','banned') NOT NULL DEFAULT 'active'"],
  ['users', 'strike_count', 'INT NOT NULL DEFAULT 0'],
  ['users', 'suspended_until', 'DATETIME DEFAULT NULL'],
  ['users', 'last_strike_at', 'DATETIME DEFAULT NULL'],
  ['users', 'is_moderator', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'moderator_candidate', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'moderator_candidate_note', 'TEXT DEFAULT NULL'],
  ['users', 'moderator_candidate_at', 'DATETIME DEFAULT NULL'],
]

export async function ensureRuntimeColumns() {
  for (const [table, col, def] of RUNTIME_COLUMNS) {
    await addCol(table, col, def)
  }
}
