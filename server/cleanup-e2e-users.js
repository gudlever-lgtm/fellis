import pool from './db.js'

// Deletes all leftover E2E test users (email pattern: e2e.test.*@fellis-test.invalid)
// and all data associated with them via ON DELETE CASCADE foreign keys.
//
// Usage:
//   cd server && npm run cleanup-e2e

async function cleanupE2eUsers() {
  const conn = await pool.getConnection()
  try {
    const [users] = await conn.query(
      "SELECT id, name, email, created_at FROM users WHERE email LIKE 'e2e.test.%@fellis-test.invalid' ORDER BY created_at"
    )

    if (users.length === 0) {
      console.log('No leftover E2E test users found.')
      return
    }

    console.log(`Found ${users.length} leftover E2E test user(s):`)
    for (const u of users) {
      console.log(`  #${u.id}  ${u.name}  <${u.email}>  joined ${u.created_at}`)
    }

    const [result] = await conn.query(
      "DELETE FROM users WHERE email LIKE 'e2e.test.%@fellis-test.invalid'"
    )
    console.log(`\nDeleted ${result.affectedRows} user(s) and all associated data (cascaded).`)
    console.log('\n✅ E2E user cleanup complete!')
  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupE2eUsers().catch(err => { console.error('Cleanup failed:', err); process.exit(1) })
