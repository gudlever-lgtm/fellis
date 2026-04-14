import pool from './db.js'

const SEED_EMAIL_PATTERN = '%@fellis.eu'

async function unseed() {
  const conn = await pool.getConnection()
  try {
    const [users] = await conn.query('SELECT id, name, email FROM users WHERE email LIKE ?', [SEED_EMAIL_PATTERN])
    if (users.length === 0) {
      console.log('No seed users found. Nothing to remove.')
      return
    }
    const ids = users.map(u => u.id)
    console.log(`Found ${users.length} seed users: ${users.map(u => u.email).join(', ')}`)

    // Ads by seed users
    const [delAds] = await conn.query('DELETE FROM ads WHERE advertiser_id IN (?)', [ids])
    console.log(`Removed ${delAds.affectedRows} ads`)

    // Messages
    const [delMsgs] = await conn.query('DELETE FROM messages WHERE sender_id IN (?) OR receiver_id IN (?)', [ids, ids])
    console.log(`Removed ${delMsgs.affectedRows} messages`)

    // Conversations created by seed users
    const [seedConvs] = await conn.query('SELECT id FROM conversations WHERE created_by IN (?)', [ids]).catch(() => [[]])
    if (seedConvs.length > 0) {
      const convIds = seedConvs.map(c => c.id)
      await conn.query('DELETE FROM messages WHERE conversation_id IN (?)', [convIds]).catch(() => {})
      await conn.query('DELETE FROM conversation_participants WHERE conversation_id IN (?)', [convIds]).catch(() => {})
      await conn.query('DELETE FROM conversations WHERE id IN (?)', [convIds])
      console.log(`Removed ${seedConvs.length} conversations`)
    }
    await conn.query('DELETE FROM conversation_participants WHERE user_id IN (?)', [ids]).catch(() => {})

    // Comments and reactions by seed users
    await conn.query('DELETE FROM comment_reactions WHERE user_id IN (?)', [ids]).catch(() => {})
    const [delComments] = await conn.query('DELETE FROM comments WHERE author_id IN (?)', [ids])
    console.log(`Removed ${delComments.affectedRows} comments`)

    // Posts by seed users (clear child rows first)
    const [seedPosts] = await conn.query('SELECT id FROM posts WHERE author_id IN (?)', [ids])
    if (seedPosts.length > 0) {
      const postIds = seedPosts.map(p => p.id)
      await conn.query('DELETE FROM post_views WHERE post_id IN (?)', [postIds]).catch(() => {})
      await conn.query('DELETE FROM post_hashtags WHERE post_id IN (?)', [postIds]).catch(() => {})
      await conn.query('DELETE FROM comment_reactions WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (?))', [postIds]).catch(() => {})
      await conn.query('DELETE FROM comments WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM post_likes WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM posts WHERE id IN (?)', [postIds])
      console.log(`Removed ${seedPosts.length} posts`)
    }

    // Likes/views left on other users' content
    await conn.query('DELETE FROM post_likes WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM post_views WHERE user_id IN (?)', [ids]).catch(() => {})

    // Friendships and friend requests
    const [delFriends] = await conn.query('DELETE FROM friendships WHERE user_id IN (?) OR friend_id IN (?)', [ids, ids])
    console.log(`Removed ${delFriends.affectedRows} friendships`)
    await conn.query('DELETE FROM friend_requests WHERE from_user_id IN (?) OR to_user_id IN (?)', [ids, ids]).catch(() => {})

    // Notifications and sessions
    await conn.query('DELETE FROM notifications WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM notification_preferences WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM sessions WHERE user_id IN (?)', [ids])

    // Misc profile data
    await conn.query('DELETE FROM user_interests WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM interest_signals WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM interest_scores WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM skills WHERE user_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM user_blocks WHERE blocker_id IN (?) OR blocked_id IN (?)', [ids, ids]).catch(() => {})
    await conn.query('DELETE FROM invitations WHERE inviter_id IN (?)', [ids]).catch(() => {})
    await conn.query('DELETE FROM gdpr_consent WHERE user_id IN (?)', [ids]).catch(() => {})

    // Users
    const [delUsers] = await conn.query('DELETE FROM users WHERE id IN (?)', [ids])
    console.log(`Removed ${delUsers.affectedRows} seed users`)

    console.log('\n✅ Seed data removed.')
  } finally {
    conn.release()
    await pool.end()
  }
}

unseed().catch(err => { console.error('Unseed failed:', err); process.exit(1) })
