import pool from './db.js'

const BOT_HANDLES = ['@anna.bot', '@erik.bot', '@maria.bot', '@nordbot.aps']

async function cleanupBots() {
  const conn = await pool.getConnection()
  try {
    const [bots] = await conn.query('SELECT id, name FROM users WHERE handle IN (?)', [BOT_HANDLES])
    if (bots.length === 0) {
      console.log('No bots found. Nothing to clean up.')
      return
    }

    const botIds = bots.map(b => b.id)
    console.log(`Found ${bots.length} bots: ${bots.map(b => b.name).join(', ')}`)

    // Remove bot likes on reels
    await conn.query('DELETE FROM reel_likes WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot reel comments
    await conn.query('DELETE FROM reel_comments WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot reels (and their likes/comments via FK cascade)
    const [botReels] = await conn.query('SELECT id FROM reels WHERE user_id IN (?)', [botIds]).catch(() => [[]])
    if (botReels.length > 0) {
      const reelIds = botReels.map(r => r.id)
      await conn.query('DELETE FROM reel_likes WHERE reel_id IN (?)', [reelIds]).catch(() => {})
      await conn.query('DELETE FROM reel_comments WHERE reel_id IN (?)', [reelIds]).catch(() => {})
      await conn.query('DELETE FROM reels WHERE id IN (?)', [reelIds]).catch(() => {})
      console.log(`Removed ${botReels.length} bot reels`)
    }

    // Remove bot post views
    await conn.query('DELETE FROM post_views WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot likes and restore like counts
    const [botLikes] = await conn.query('SELECT post_id FROM post_likes WHERE user_id IN (?)', [botIds])
    for (const like of botLikes) {
      await conn.query('UPDATE posts SET likes = GREATEST(likes - 1, 0) WHERE id = ?', [like.post_id])
    }
    await conn.query('DELETE FROM post_likes WHERE user_id IN (?)', [botIds])
    console.log(`Removed ${botLikes.length} bot likes`)

    // Remove bot comments
    const [delComments] = await conn.query('DELETE FROM comments WHERE author_id IN (?)', [botIds])
    console.log(`Removed ${delComments.affectedRows} bot comments`)

    // Remove bot posts (and their comments/likes)
    const [botPosts] = await conn.query('SELECT id FROM posts WHERE author_id IN (?)', [botIds])
    if (botPosts.length > 0) {
      const postIds = botPosts.map(p => p.id)
      await conn.query('DELETE FROM post_views WHERE post_id IN (?)', [postIds]).catch(() => {})
      await conn.query('DELETE FROM post_hashtags WHERE post_id IN (?)', [postIds]).catch(() => {})
      await conn.query('DELETE FROM comments WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM post_likes WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM posts WHERE id IN (?)', [postIds])
      console.log(`Removed ${botPosts.length} bot posts (with their comments/likes)`)
    }

    // Remove bot marketplace listings
    const [delListings] = await conn.query('DELETE FROM marketplace_listings WHERE user_id IN (?)', [botIds])
    console.log(`Removed ${delListings.affectedRows} bot marketplace listings`)

    // Remove bot companies (cascade removes members, follows, posts, jobs, etc.)
    const [botCompanies] = await conn.query('SELECT id FROM companies WHERE owner_id IN (?)', [botIds])
    if (botCompanies.length > 0) {
      const cIds = botCompanies.map(c => c.id)
      await conn.query('DELETE FROM job_saves WHERE job_id IN (SELECT id FROM jobs WHERE company_id IN (?))', [cIds])
      await conn.query('DELETE FROM shared_jobs WHERE job_id IN (SELECT id FROM jobs WHERE company_id IN (?))', [cIds]).catch(() => {})
      await conn.query('DELETE FROM jobs WHERE company_id IN (?)', [cIds])
      await conn.query('DELETE FROM company_post_comments WHERE post_id IN (SELECT id FROM company_posts WHERE company_id IN (?))', [cIds])
      await conn.query('DELETE FROM company_post_likes WHERE post_id IN (SELECT id FROM company_posts WHERE company_id IN (?))', [cIds])
      await conn.query('DELETE FROM company_posts WHERE company_id IN (?)', [cIds])
      await conn.query('DELETE FROM company_follows WHERE company_id IN (?)', [cIds])
      await conn.query('DELETE FROM company_members WHERE company_id IN (?)', [cIds])
      await conn.query('DELETE FROM companies WHERE id IN (?)', [cIds])
      console.log(`Removed ${botCompanies.length} bot companies`)
    }
    // Also remove bot memberships/follows in other companies
    await conn.query('DELETE FROM company_members WHERE user_id IN (?)', [botIds])
    await conn.query('DELETE FROM company_follows WHERE user_id IN (?)', [botIds])
    // Remove bot company post comments/likes (on any company)
    await conn.query('DELETE FROM company_post_comments WHERE author_id IN (?)', [botIds])
    await conn.query('DELETE FROM company_post_likes WHERE user_id IN (?)', [botIds])
    // Remove job saves by bots
    await conn.query('DELETE FROM job_saves WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot stories
    await conn.query('DELETE FROM stories WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot messages
    const [delMsgs] = await conn.query('DELETE FROM messages WHERE sender_id IN (?) OR receiver_id IN (?)', [botIds, botIds])
    console.log(`Removed ${delMsgs.affectedRows} bot messages`)

    // Remove bot conversation participation (and conversations created solely by bots)
    const [botConvs] = await conn.query('SELECT id FROM conversations WHERE created_by IN (?)', [botIds]).catch(() => [[]])
    if (botConvs.length > 0) {
      const convIds = botConvs.map(c => c.id)
      await conn.query('DELETE FROM messages WHERE conversation_id IN (?)', [convIds]).catch(() => {})
      await conn.query('DELETE FROM conversation_participants WHERE conversation_id IN (?)', [convIds]).catch(() => {})
      await conn.query('DELETE FROM conversations WHERE id IN (?)', [convIds])
      console.log(`Removed ${botConvs.length} bot-created conversations`)
    }
    await conn.query('DELETE FROM conversation_participants WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove friend requests to/from bots
    const [delRequests] = await conn.query(
      'DELETE FROM friend_requests WHERE from_user_id IN (?) OR to_user_id IN (?)',
      [botIds, botIds]
    )
    console.log(`Removed ${delRequests.affectedRows} bot friend requests`)

    // Remove bot friendships
    const [delFriends] = await conn.query('DELETE FROM friendships WHERE user_id IN (?) OR friend_id IN (?)', [botIds, botIds])
    console.log(`Removed ${delFriends.affectedRows} bot friendships`)

    // Remove bot interest signals and scores
    await conn.query('DELETE FROM interest_signals WHERE user_id IN (?)', [botIds]).catch(() => {})
    await conn.query('DELETE FROM interest_scores WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove notifications about or caused by bots
    await conn.query('DELETE FROM notifications WHERE user_id IN (?)', [botIds]).catch(() => {})
    await conn.query('DELETE FROM notification_preferences WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot invitations
    await conn.query('DELETE FROM invitations WHERE inviter_id IN (?)', [botIds]).catch(() => {})

    // Remove bot GDPR consent records
    await conn.query('DELETE FROM gdpr_consent WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot user blocks
    await conn.query('DELETE FROM user_blocks WHERE blocker_id IN (?) OR blocked_id IN (?)', [botIds, botIds]).catch(() => {})

    // Remove reports by or against bots
    await conn.query('DELETE FROM reports WHERE reporter_id IN (?) OR reported_user_id IN (?)', [botIds, botIds]).catch(() => {})
    await conn.query('DELETE FROM moderation_actions WHERE target_user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot CV/profile data
    await conn.query('DELETE FROM work_experience WHERE user_id IN (?)', [botIds]).catch(() => {})
    await conn.query('DELETE FROM education WHERE user_id IN (?)', [botIds]).catch(() => {})

    // Remove bot sessions
    await conn.query('DELETE FROM sessions WHERE user_id IN (?)', [botIds])

    // Remove bot users
    await conn.query('DELETE FROM users WHERE id IN (?)', [botIds])
    console.log(`Removed ${bots.length} bot users`)

    console.log('\n✅ All bot data cleaned up!')

  } finally {
    conn.release()
    await pool.end()
  }
}

cleanupBots().catch(err => { console.error('Cleanup failed:', err); process.exit(1) })
