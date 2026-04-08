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

  console.log('\nAll migrations complete.')
  process.exit(0)
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
