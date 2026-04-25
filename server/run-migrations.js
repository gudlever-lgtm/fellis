#!/usr/bin/env node
// run-migrations.js — MySQL 8.4 / MariaDB compatible migration runner
// Usage: node --env-file=.env run-migrations.js
//
// Applies all incremental schema changes using the addCol() helper,
// which catches duplicate-column errors (errno 1060) instead of using
// MariaDB-only "ADD COLUMN IF NOT EXISTS" syntax.

import pool from './db.js'

async function addCol(table, col, def) {
  try {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`)
    console.log(`  + ${table}.${col}`)
  } catch (e) {
    if (e.errno === 1060) {
      console.log(`  ~ ${table}.${col} (already exists)`)
    } else {
      throw e
    }
  }
}

async function addIndex(table, name, def) {
  try {
    await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` ${def}`)
    console.log(`  + index ${table}.${name}`)
  } catch (e) {
    if (e.errno === 1061) {
      console.log(`  ~ index ${table}.${name} (already exists)`)
    } else {
      throw e
    }
  }
}

async function run() {
  console.log('Running fellis migrations...\n')

  // ── migrate-add-comment-media ──
  console.log('comments:')
  await addCol('comments', 'media', 'JSON DEFAULT NULL')

  // ── migrate-birthday ──
  console.log('users (birthday):')
  await addCol('users', 'birthday', 'DATE DEFAULT NULL')

  // ── migrate-gdpr ──
  console.log('posts (gdpr):')
  await addCol('posts', 'source', "VARCHAR(20) DEFAULT 'native'")
  console.log('friendships (gdpr):')
  await addCol('friendships', 'source', "VARCHAR(20) DEFAULT 'native'")
  console.log('users (gdpr):')
  await addCol('users', 'account_deletion_requested_at', 'TIMESTAMP NULL DEFAULT NULL')

  // ── migrate-group-suggestions ──
  console.log('conversations:')
  await addCol('conversations', 'is_group', 'TINYINT(1) DEFAULT 0')
  await addCol('conversations', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  await addCol('conversations', 'category', 'VARCHAR(100) DEFAULT NULL')
  await addCol('conversations', 'description_da', 'TEXT DEFAULT NULL')
  await addCol('conversations', 'description_en', 'TEXT DEFAULT NULL')

  // ── migrate-groups-extended ──
  console.log('conversations (groups-extended):')
  await addCol('conversations', 'slug', 'VARCHAR(200) DEFAULT NULL')
  await addCol('conversations', 'type', "ENUM('public','private','hidden') NOT NULL DEFAULT 'public'")
  await addCol('conversations', 'tags', 'JSON DEFAULT NULL')
  await addCol('conversations', 'cover_url', 'VARCHAR(500) DEFAULT NULL')

  // ── migrate-groups-status ──
  console.log('conversations (group_status):')
  await addCol('conversations', 'group_status', "ENUM('active','pending','rejected') DEFAULT 'active'")

  // ── migrate-group-admin ──
  console.log('conversations (is_frozen):')
  await addCol('conversations', 'is_frozen', 'TINYINT(1) NOT NULL DEFAULT 0')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_categories (
      id        INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug      VARCHAR(100) NOT NULL UNIQUE,
      name_da   VARCHAR(200) NOT NULL,
      name_en   VARCHAR(200) NOT NULL,
      sort_order INT NOT NULL DEFAULT 99
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`INSERT IGNORE INTO group_categories (slug, name_da, name_en, sort_order) VALUES
    ('interest','Interesse','Interest',1),('local','Lokal','Local',2),
    ('professional','Professionel','Professional',3),('event','Begivenhed','Event',4),('other','Andet','Other',5)`)

  // ── migrate-group-member-management ──
  console.log('conversation_participants (admin_muted_until):')
  await addCol('conversation_participants', 'admin_muted_until', 'DATETIME DEFAULT NULL')

  // ── migrate-interests ──
  console.log('users (interests):')
  await addCol('users', 'interests', 'JSON DEFAULT NULL')
  console.log('friendships (interests):')
  await addCol('friendships', 'is_family', 'TINYINT(1) NOT NULL DEFAULT 0')

  // ── migrate-password-plain ──
  console.log('users (password_plain):')
  await addCol('users', 'password_plain', 'VARCHAR(255) DEFAULT NULL')

  // ── migrate-user-settings ──
  console.log('users (privacy settings):')
  await addCol('users', 'profile_visibility', "ENUM('all','friends') NOT NULL DEFAULT 'all'")
  await addCol('users', 'friend_requests_from', "ENUM('all','fof') NOT NULL DEFAULT 'all'")

  // ── migrate-viral-growth ──
  console.log('users (viral growth):')
  await addCol('users', 'profile_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  await addCol('users', 'reputation_score', 'INT NOT NULL DEFAULT 0')
  await addCol('users', 'referral_count', 'INT NOT NULL DEFAULT 0')
  console.log('invitations (viral growth):')
  await addCol('invitations', 'invite_source', "ENUM('link','email','facebook','other') DEFAULT 'link'")
  await addCol('invitations', 'clicked_at', 'TIMESTAMP NULL DEFAULT NULL')
  await addCol('invitations', 'utm_source', 'VARCHAR(100) DEFAULT NULL')
  await addCol('invitations', 'utm_medium', 'VARCHAR(100) DEFAULT NULL')
  await addCol('invitations', 'utm_campaign', 'VARCHAR(100) DEFAULT NULL')
  await addCol('invitations', 'converted_at', 'TIMESTAMP NULL DEFAULT NULL')
  await addCol('invitations', 'referred_user_id', 'INT DEFAULT NULL')

  // ── migrate-add-invites (messages column) ──
  console.log('messages:')
  await addCol('messages', 'conversation_id', 'INT DEFAULT NULL')
  await addIndex('messages', 'idx_msg_conv', '(conversation_id)')

  // ── migrate-group-detail ──
  console.log('conversation_participants (group detail):')
  await addCol('conversation_participants', 'role', "ENUM('admin','moderator','member') DEFAULT 'member'")
  await addCol('conversation_participants', 'status', "ENUM('active','pending') DEFAULT 'active'")
  console.log('posts (group detail):')
  await addCol('posts', 'group_id', 'INT DEFAULT NULL')
  await addCol('posts', 'is_pinned', 'TINYINT(1) NOT NULL DEFAULT 0')
  await addIndex('posts', 'idx_posts_group_id', '(group_id)')
  console.log('post_likes (group detail):')
  await addCol('post_likes', 'reaction', "VARCHAR(20) DEFAULT 'like'")
  console.log('events (group detail):')
  await addCol('events', 'group_id', 'INT DEFAULT NULL')
  await addCol('events', 'start_time', 'DATETIME DEFAULT NULL')
  console.log('conversations (group detail):')
  await addCol('conversations', 'pinned_post_id', 'INT DEFAULT NULL')
  await addCol('conversations', 'member_count', 'INT NOT NULL DEFAULT 0')
  await addCol('conversations', 'post_count', 'INT NOT NULL DEFAULT 0')
  console.log('group_polls + group_poll_votes:')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_polls (
      id          INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id    INT(11) NOT NULL,
      question    VARCHAR(500) NOT NULL,
      options     JSON NOT NULL,
      ends_at     TIMESTAMP NULL DEFAULT NULL,
      created_by  INT(11) NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id)   REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_poll_votes (
      id         INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      poll_id    INT(11) NOT NULL,
      user_id    INT(11) NOT NULL,
      option_idx INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_gpoll_user (poll_id, user_id),
      FOREIGN KEY (poll_id)  REFERENCES group_polls(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ── auto-approve all pending groups (groups are now self-approved on creation) ──
  console.log('conversations (approve pending groups):')
  await pool.query(
    "UPDATE conversations SET group_status = 'active' WHERE is_group = 1 AND group_status = 'pending'"
  )

  console.log('\nAll migrations complete.')
  process.exit(0)
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
