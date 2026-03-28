import pool from './db.js'

async function cleanupMarketplace() {
  const conn = await pool.getConnection()
  try {
    // Count before
    const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM marketplace_listings')
    if (total === 0) {
      console.log('No marketplace listings found. Nothing to clean up.')
      return
    }
    console.log(`Found ${total} marketplace listings`)

    // Remove listing views first
    const [delViews] = await conn.query('DELETE FROM listing_views').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delViews.affectedRows} listing views`)

    // Remove all listings
    const [delListings] = await conn.query('DELETE FROM marketplace_listings')
    console.log(`Removed ${delListings.affectedRows} marketplace listings`)

    // Reset AUTO_INCREMENT
    await conn.query('ALTER TABLE marketplace_listings AUTO_INCREMENT = 1').catch(() => {})

    console.log('\n✅ All marketplace data cleaned up!')

  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupMarketplace().catch(err => { console.error('Cleanup failed:', err); process.exit(1) })
