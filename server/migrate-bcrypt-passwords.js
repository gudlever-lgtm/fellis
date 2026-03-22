/**
 * migrate-bcrypt-passwords.js
 *
 * Converts all user passwords to bcrypt hashes.
 *
 * Priority:
 *   1. If password_hash already starts with $2 → skip (already bcrypt)
 *   2. If password_plain exists → bcrypt it, store in password_hash
 *   3. If password_hash exists but isn't bcrypt → bcrypt it (treats it as plaintext)
 *
 * Run: node --env-file=.env migrate-bcrypt-passwords.js
 */

import bcrypt from 'bcrypt'
import pool from './db.js'

const BCRYPT_ROUNDS = 10

async function run() {
  const [users] = await pool.query(
    'SELECT id, email, password_hash, password_plain FROM users'
  )

  console.log(`Found ${users.length} users`)

  let skipped = 0
  let migrated = 0
  let noPassword = 0

  for (const user of users) {
    // Already bcrypt — skip
    if (user.password_hash && user.password_hash.startsWith('$2')) {
      skipped++
      continue
    }

    // Determine the plaintext to hash
    const plaintext = user.password_plain || user.password_hash

    if (!plaintext) {
      console.log(`  SKIP  user ${user.id} (${user.email}) — no password at all`)
      noPassword++
      continue
    }

    const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS)
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hash, user.id]
    )
    console.log(`  OK    user ${user.id} (${user.email})`)
    migrated++
  }

  console.log(`\nDone. Migrated: ${migrated}, Already bcrypt: ${skipped}, No password: ${noPassword}`)
  await pool.end()
}

run().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
