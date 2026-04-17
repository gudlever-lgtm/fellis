import pool from './db.js'

const BOT_HANDLES = ['@anna.bot', '@erik.bot', '@maria.bot', '@nordbot.aps']
const RETENTION_DAYS = 90

async function cleanupAuditLog() {
  const conn = await pool.getConnection()
  try {
    // Collect bot user IDs
    const [bots] = await conn.query('SELECT id FROM users WHERE handle IN (?)', [BOT_HANDLES])
    const botIds = bots.map(b => b.id)

    // Collect E2E test user IDs
    const [e2eUsers] = await conn.query(
      "SELECT id FROM users WHERE email LIKE 'e2e.test.%@fellis-test.invalid'"
    )
    const e2eIds = e2eUsers.map(u => u.id)

    const testIds = [...new Set([...botIds, ...e2eIds])]

    let totalDeleted = 0

    // Delete test-user entries from both audit tables
    if (testIds.length > 0) {
      const [r1] = await conn.query('DELETE FROM audit_log WHERE user_id IN (?)', [testIds])
      const [r2] = await conn.query('DELETE FROM audit_logs WHERE user_id IN (?)', [testIds])
      const n = r1.affectedRows + r2.affectedRows
      if (n > 0) console.log(`Removed ${n} audit entries for ${testIds.length} test/bot user(s)`)
      totalDeleted += n
    }

    // Enforce retention policy: delete entries older than RETENTION_DAYS days
    const [r3] = await conn.query(
      'DELETE FROM audit_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [RETENTION_DAYS]
    )
    const [r4] = await conn.query(
      'DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [RETENTION_DAYS]
    )
    const aged = r3.affectedRows + r4.affectedRows
    if (aged > 0) console.log(`Removed ${aged} audit entries older than ${RETENTION_DAYS} days`)
    totalDeleted += aged

    if (totalDeleted === 0) {
      console.log('Audit log is already clean — nothing to remove.')
    } else {
      console.log(`\n✅ Audit log cleanup complete — ${totalDeleted} entries removed.`)
    }
  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupAuditLog().catch(err => { console.error('Audit log cleanup failed:', err); process.exit(1) })
