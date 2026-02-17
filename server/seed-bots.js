import crypto from 'crypto'
import pool from './db.js'

// Two bot users that interact with posts
const BOTS = [
  {
    name: 'Anna Bot',
    handle: '@anna.bot',
    initials: 'AB',
    email: 'anna.bot@fellis.eu',
    bio_da: 'Jeg er en testbot! 🤖',
    bio_en: 'I am a test bot! 🤖',
    location: 'Botland, Danmark',
  },
  {
    name: 'Erik Bot',
    handle: '@erik.bot',
    initials: 'EB',
    email: 'erik.bot@fellis.eu',
    bio_da: 'Bot nr. 2 til test! 🤖',
    bio_en: 'Bot #2 for testing! 🤖',
    location: 'Botland, Danmark',
  },
]

const BOT_PASSWORD_HASH = crypto.createHash('sha256').update('bot123').digest('hex')

async function seedBots() {
  const conn = await pool.getConnection()
  try {
    const botIds = []

    // Create bot users
    for (const bot of BOTS) {
      const [result] = await conn.query(
        `INSERT INTO users (name, handle, initials, email, password_hash, bio_da, bio_en, location, join_date, photo_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [bot.name, bot.handle, bot.initials, bot.email, BOT_PASSWORD_HASH, bot.bio_da, bot.bio_en, bot.location, new Date().getFullYear().toString()]
      )
      let botId = result.insertId
      if (!botId) {
        const [rows] = await conn.query('SELECT id FROM users WHERE handle = ?', [bot.handle])
        botId = rows[0].id
      }
      botIds.push(botId)
      console.log(`Created bot: ${bot.name} (id=${botId})`)
    }

    // Get all existing user IDs to make bots friends with them
    const [allUsers] = await conn.query('SELECT id FROM users WHERE id NOT IN (?)', [botIds])
    for (const botId of botIds) {
      for (const user of allUsers) {
        await conn.query(
          'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
          [botId, user.id, Math.floor(Math.random() * 20) + 5, true]
        )
        await conn.query(
          'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
          [user.id, botId, Math.floor(Math.random() * 20) + 5, true]
        )
      }
    }
    console.log('Bots are now friends with all users')

    // Bot posts
    const botPosts = [
      {
        botIdx: 0,
        text_da: 'Hej alle sammen! Jeg er Anna Bot og jeg elsker at teste ting! 🤖✨ Hvem vil være venner?',
        text_en: 'Hello everyone! I am Anna Bot and I love testing things! 🤖✨ Who wants to be friends?',
        time_da: '30 minutter siden', time_en: '30 minutes ago', likes: 12,
      },
      {
        botIdx: 1,
        text_da: 'Erik Bot her! Fantastisk vejr i dag i Botland. Nogen der har lyst til en virtuel kaffe? ☕🤖',
        text_en: 'Erik Bot here! Fantastic weather today in Botland. Anyone fancy a virtual coffee? ☕🤖',
        time_da: '1 time siden', time_en: '1 hour ago', likes: 8,
      },
      {
        botIdx: 0,
        text_da: 'Lige opdaget fellis.eu — meget bedre end de store platforme! Data er trygt i EU 🇪🇺💚',
        text_en: 'Just discovered fellis.eu — much better than the big platforms! Data is safe in the EU 🇪🇺💚',
        time_da: '3 timer siden', time_en: '3 hours ago', likes: 25,
      },
    ]

    const postIds = []
    for (const p of botPosts) {
      const [result] = await conn.query(
        'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes) VALUES (?, ?, ?, ?, ?, ?)',
        [botIds[p.botIdx], p.text_da, p.text_en, p.time_da, p.time_en, p.likes]
      )
      postIds.push(result.insertId)
    }
    console.log(`Created ${botPosts.length} bot posts`)

    // Bots comment on existing posts from other users
    const [existingPosts] = await conn.query(
      'SELECT id, author_id FROM posts WHERE author_id NOT IN (?) ORDER BY created_at DESC LIMIT 5',
      [botIds]
    )

    const botComments = [
      { text_da: 'Fantastisk opslag! 🔥🤖', text_en: 'Amazing post! 🔥🤖' },
      { text_da: 'Helt enig! Godt sagt! 👏', text_en: 'Totally agree! Well said! 👏' },
      { text_da: 'Det her er så godt! Tak for at dele 💚', text_en: 'This is so good! Thanks for sharing 💚' },
      { text_da: 'Wow, det ser fantastisk ud! 😍', text_en: 'Wow, that looks amazing! 😍' },
      { text_da: 'Elsker det! Mere af det her! 🙌', text_en: 'Love it! More of this! 🙌' },
    ]

    let commentCount = 0
    for (let i = 0; i < existingPosts.length && i < botComments.length; i++) {
      const botId = botIds[i % 2]
      await conn.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
        [existingPosts[i].id, botId, botComments[i].text_da, botComments[i].text_en]
      )
      commentCount++
    }
    console.log(`Bots commented on ${commentCount} existing posts`)

    // Bots like existing posts
    let likeCount = 0
    for (const post of existingPosts) {
      for (const botId of botIds) {
        await conn.query(
          'INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)',
          [post.id, botId]
        )
        await conn.query(
          'UPDATE posts SET likes = likes + 1 WHERE id = ?',
          [post.id]
        )
        likeCount++
      }
    }
    console.log(`Bots liked ${likeCount} posts`)

    console.log('\n✅ Bots seeded! Login: anna.bot@fellis.eu / bot123 or erik.bot@fellis.eu / bot123')
    console.log('To remove bots: node --env-file=.env cleanup-bots.js')

  } finally {
    conn.release()
    await pool.end()
  }
}

seedBots().catch(err => { console.error('Bot seed failed:', err); process.exit(1) })
