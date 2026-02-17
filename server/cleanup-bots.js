import pool from './db.js'

const BOT_HANDLES = ['@anna.bot', '@erik.bot']

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
      await conn.query('DELETE FROM comments WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM post_likes WHERE post_id IN (?)', [postIds])
      await conn.query('DELETE FROM posts WHERE id IN (?)', [postIds])
      console.log(`Removed ${botPosts.length} bot posts (with their comments/likes)`)
    }

    // Remove bot messages
    const [delMsgs] = await conn.query('DELETE FROM messages WHERE sender_id IN (?) OR receiver_id IN (?)', [botIds, botIds])
    console.log(`Removed ${delMsgs.affectedRows} bot messages`)

    // Remove bot friendships
    const [delFriends] = await conn.query('DELETE FROM friendships WHERE user_id IN (?) OR friend_id IN (?)', [botIds, botIds])
    console.log(`Removed ${delFriends.affectedRows} bot friendships`)

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
