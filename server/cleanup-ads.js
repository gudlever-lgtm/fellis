import pool from './db.js'

// Removes all platform ads (banners) and user adfree/subscription data.
// Does NOT delete admin_ad_settings (pricing/config) or adfree_badge_mappings (badge config).
// Pass --reset-settings to also reset admin_ad_settings to defaults.

const resetSettings = process.argv.includes('--reset-settings')

async function cleanupAds() {
  const conn = await pool.getConnection()
  try {
    // Remove platform ads (the actual banner ads shown to users)
    const [delAds] = await conn.query('DELETE FROM platform_ads').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delAds.affectedRows} platform ads`)
    await conn.query('ALTER TABLE platform_ads AUTO_INCREMENT = 1').catch(() => {})

    // Remove adfree purchased periods
    const [delPeriods] = await conn.query('DELETE FROM adfree_purchased_periods').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delPeriods.affectedRows} adfree purchased periods`)

    // Remove adfree day assignments (earned days from badges etc.)
    const [delAssignments] = await conn.query('DELETE FROM adfree_day_assignments').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delAssignments.affectedRows} adfree day assignments`)

    // Remove adfree days bank (accumulated balances)
    const [delBank] = await conn.query('DELETE FROM adfree_days_bank').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delBank.affectedRows} adfree days bank entries`)

    // Clear adfree_active_until on all users
    await conn.query('UPDATE users SET adfree_active_until = NULL WHERE adfree_active_until IS NOT NULL').catch(() => {})
    console.log('Reset adfree_active_until on all users')

    // Remove Mollie/payment subscriptions
    const [delSubs] = await conn.query('DELETE FROM subscriptions').catch(() => [{ affectedRows: 0 }])
    console.log(`Removed ${delSubs.affectedRows} payment subscriptions`)

    if (resetSettings) {
      await conn.query(`
        UPDATE admin_ad_settings SET
          adfree_price_private = 29.00,
          adfree_price_business = 49.00,
          ad_price_cpm = 50.00,
          currency = 'EUR',
          max_ads_feed = 3,
          max_ads_sidebar = 2,
          max_ads_stories = 1,
          refresh_interval_seconds = 300,
          ads_enabled = 1,
          boost_price = 9.00,
          stripe_price_adfree_private = NULL,
          stripe_price_adfree_business = NULL
        WHERE id = 1
      `).catch(() => {})
      console.log('Reset admin_ad_settings to defaults')
    } else {
      console.log('(Skipping admin_ad_settings reset — pass --reset-settings to include)')
    }

    console.log('\n✅ All ad data cleaned up!')

  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupAds().catch(err => { console.error('Cleanup failed:', err); process.exit(1) })
