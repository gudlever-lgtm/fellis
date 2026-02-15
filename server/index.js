import express from 'express'
import crypto from 'crypto'
import pool from './db.js'

const app = express()
app.use(express.json())

// ── Auth middleware ──
async function authenticate(req, res, next) {
  const sessionId = req.headers['x-session-id']
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const [rows] = await pool.query(
      'SELECT s.user_id, s.lang FROM sessions s WHERE s.id = ? AND s.expires_at > NOW()',
      [sessionId]
    )
    if (rows.length === 0) return res.status(401).json({ error: 'Session expired' })
    req.userId = rows[0].user_id
    req.lang = rows[0].lang
    next()
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// ── Auth routes ──

// POST /api/auth/login — login with email + password
app.post('/api/auth/login', async (req, res) => {
  const { email, password, lang } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  try {
    const [users] = await pool.query('SELECT id, password_hash FROM users WHERE email = ?', [email])
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' })
    const user = users[0]
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' })
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, user.id, lang || 'da']
    )
    res.json({ sessionId, userId: user.id })
  } catch (err) {
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/register — create account after migration
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, lang } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  try {
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    const handle = '@' + name.toLowerCase().replace(/\s+/g, '.')
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase()
    const [result] = await pool.query(
      'INSERT INTO users (name, handle, initials, email, password_hash, join_date) VALUES (?, ?, ?, ?, ?, ?)',
      [name, handle, initials, email, hash, new Date().getFullYear().toString()]
    )
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, result.insertId, lang || 'da']
    )
    res.json({ sessionId, userId: result.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or handle already exists' })
    res.status(500).json({ error: 'Registration failed' })
  }
})

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const sessionId = req.headers['x-session-id']
  await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId])
  res.json({ ok: true })
})

// GET /api/auth/session — check if session is valid
app.get('/api/auth/session', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, handle, initials FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    res.json({ user: users[0], lang: req.lang })
  } catch (err) {
    res.status(500).json({ error: 'Session check failed' })
  }
})

// ── Profile routes ──

// GET /api/profile/:id
app.get('/api/profile/:id', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count,
        (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
       FROM users u WHERE u.id = ?`,
      [req.params.id]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    res.json({
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// GET /api/profile — current user profile
app.get('/api/profile', authenticate, async (req, res) => {
  req.params.id = req.userId
  // Reuse the :id handler logic
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count,
        (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
       FROM users u WHERE u.id = ?`,
      [req.userId]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    res.json({
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// ── Feed routes ──

// GET /api/feed — get all posts with comments
app.get('/api/feed', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT p.id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.created_at
       FROM posts p JOIN users u ON p.author_id = u.id
       ORDER BY p.created_at DESC`
    )
    const [comments] = await pool.query(
      `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en
       FROM comments c JOIN users u ON c.author_id = u.id
       ORDER BY c.created_at ASC`
    )
    const [userLikes] = await pool.query(
      'SELECT post_id FROM post_likes WHERE user_id = ?',
      [req.userId]
    )
    const likedSet = new Set(userLikes.map(l => l.post_id))
    const commentsByPost = {}
    for (const c of comments) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = []
      commentsByPost[c.post_id].push({ author: c.author, text: { da: c.text_da, en: c.text_en } })
    }
    const result = posts.map(p => ({
      id: p.id,
      author: p.author,
      time: { da: p.time_da, en: p.time_en },
      text: { da: p.text_da, en: p.text_en },
      likes: p.likes,
      liked: likedSet.has(p.id),
      comments: commentsByPost[p.id] || [],
    }))
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' })
  }
})

// POST /api/feed — create a new post
app.post('/api/feed', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Post text required' })
  try {
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en) VALUES (?, ?, ?, ?, ?)',
      [req.userId, text, text, 'Lige nu', 'Just now']
    )
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    res.json({
      id: result.insertId,
      author: users[0].name,
      time: { da: 'Lige nu', en: 'Just now' },
      text: { da: text, en: text },
      likes: 0, liked: false, comments: [],
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// POST /api/feed/:id/like — toggle like
app.post('/api/feed/:id/like', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [existing] = await pool.query(
      'SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    )
    if (existing.length > 0) {
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.userId])
      await pool.query('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId])
      res.json({ liked: false })
    } else {
      await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.userId])
      await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId])
      res.json({ liked: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like' })
  }
})

// POST /api/feed/:id/comment — add comment
app.post('/api/feed/:id/comment', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Comment text required' })
  const postId = parseInt(req.params.id)
  try {
    await pool.query(
      'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
      [postId, req.userId, text, text]
    )
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    res.json({ author: users[0].name, text: { da: text, en: text } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// ── Friends routes ──

// GET /api/friends — get current user's friends
app.get('/api/friends', authenticate, async (req, res) => {
  try {
    const [friends] = await pool.query(
      `SELECT u.id, u.name, f.mutual_count as mutual, f.is_online as online
       FROM friendships f JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ?
       ORDER BY u.name`,
      [req.userId]
    )
    res.json(friends.map(f => ({ ...f, online: !!f.online })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load friends' })
  }
})

// ── Messages routes ──

// GET /api/messages — get message threads
app.get('/api/messages', authenticate, async (req, res) => {
  try {
    // Get all unique conversation partners
    const [partners] = await pool.query(
      `SELECT DISTINCT
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as partner_id
       FROM messages WHERE sender_id = ? OR receiver_id = ?`,
      [req.userId, req.userId, req.userId]
    )
    const threads = []
    for (const p of partners) {
      const [msgs] = await pool.query(
        `SELECT m.id, u_sender.name as from_name, m.text_da, m.text_en, m.time, m.is_read
         FROM messages m
         JOIN users u_sender ON m.sender_id = u_sender.id
         WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY m.created_at ASC`,
        [req.userId, p.partner_id, p.partner_id, req.userId]
      )
      const [friendInfo] = await pool.query('SELECT name FROM users WHERE id = ?', [p.partner_id])
      const unread = msgs.filter(m => !m.is_read && m.from_name !== 'Sofie Nielsen').length
      threads.push({
        friend: friendInfo[0].name,
        messages: msgs.map(m => ({
          from: m.from_name,
          text: { da: m.text_da, en: m.text_en },
          time: m.time,
        })),
        unread,
      })
    }
    res.json(threads)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

// POST /api/messages/:friendId — send a message
app.post('/api/messages/:friendId', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Message text required' })
  try {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, text_da, text_en, time) VALUES (?, ?, ?, ?, ?)',
      [req.userId, req.params.friendId, text, text, time]
    )
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    res.json({ from: users[0].name, text: { da: text, en: text }, time })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`fellis.eu API running on http://localhost:${PORT}`)
})
