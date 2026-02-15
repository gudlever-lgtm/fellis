import express from 'express'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import multer from 'multer'
import pool from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.join(__dirname, 'uploads')

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const app = express()
app.use(express.json())

// ── Upload security ──

// Allowed MIME types (images + videos only)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
])

// File signatures (magic bytes) for validation
const MAGIC_BYTES = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { mime: 'video/mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // ftyp
  { mime: 'video/webm', bytes: [0x1A, 0x45, 0xDF, 0xA3] },
  { mime: 'video/quicktime', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
]

function validateMagicBytes(buffer, declaredMime) {
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset || 0
    if (buffer.length < offset + sig.bytes.length) continue
    const match = sig.bytes.every((b, i) => buffer[offset + i] === b)
    if (match) return true
  }
  return false
}

// Multer storage: random filename, no original name preserved
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '')
    const safeName = crypto.randomUUID() + (ext || '.bin')
    cb(null, safeName)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max
    files: 4,                    // max 4 files per post
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('File type not allowed'))
    }
    // Block path traversal in filename
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      return cb(new Error('Invalid filename'))
    }
    cb(null, true)
  },
})

// Serve uploads with security headers (no script execution, no sniffing)
app.use('/uploads', (req, res, next) => {
  // Block anything that isn't GET
  if (req.method !== 'GET') return res.status(405).end()
  // Prevent MIME sniffing and script execution
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  res.setHeader('Cache-Control', 'public, max-age=86400')
  next()
}, express.static(UPLOADS_DIR, {
  dotfiles: 'deny',        // No hidden files
  index: false,             // No directory listing
  extensions: false,        // No extension guessing
}))

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
    const [users] = await pool.query('SELECT id, name, handle, initials, avatar_url FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    res.json({ user: users[0], lang: req.lang })
  } catch (err) {
    res.status(500).json({ error: 'Session check failed' })
  }
})

// ── Facebook OAuth ──

const FB_APP_ID = process.env.FB_APP_ID
const FB_APP_SECRET = process.env.FB_APP_SECRET
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://fellis.eu/api/auth/facebook/callback'
const FB_GRAPH_URL = 'https://graph.facebook.com/v21.0'

// Scopes: read profile, friends list, posts, photos — NO write/delete permissions
const FB_SCOPES = 'public_profile,email,user_friends,user_posts,user_photos'

// Step 1: Redirect user to Facebook login
app.get('/api/auth/facebook', (req, res) => {
  if (!FB_APP_ID) return res.status(500).json({ error: 'Facebook integration not configured' })
  const lang = req.query.lang || 'da'
  const state = crypto.randomUUID() + ':' + lang
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&scope=${FB_SCOPES}&state=${state}&response_type=code`
  res.redirect(url)
})

// Step 2: Facebook redirects back with auth code
app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect('/?fb_error=denied')
  const lang = state?.split(':')?.[1] || 'da'

  try {
    // Exchange code for access token
    const tokenRes = await fetch(
      `${FB_GRAPH_URL}/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&code=${code}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.redirect('/?fb_error=token')
    const fbToken = tokenData.access_token

    // Fetch Facebook profile
    const profileRes = await fetch(`${FB_GRAPH_URL}/me?fields=id,name,email,picture.width(200).height(200)&access_token=${fbToken}`)
    const fbProfile = await profileRes.json()
    if (!fbProfile.id) return res.redirect('/?fb_error=profile')

    // Check if user already exists (by email or facebook_id)
    let userId
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR facebook_id = ?', [fbProfile.email, fbProfile.id])

    if (existing.length > 0) {
      userId = existing[0].id
      // Update Facebook token for data refresh
      await pool.query('UPDATE users SET facebook_id = ?, fb_access_token = ? WHERE id = ?', [fbProfile.id, fbToken, userId])
    } else {
      // Create new user from Facebook data
      const handle = '@' + (fbProfile.name || 'user').toLowerCase().replace(/\s+/g, '.')
      const initials = (fbProfile.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase()
      const avatarUrl = fbProfile.picture?.data?.url || null
      const [result] = await pool.query(
        `INSERT INTO users (name, handle, initials, email, join_date, avatar_url, facebook_id, fb_access_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fbProfile.name, handle, initials, fbProfile.email || null, new Date().getFullYear().toString(), avatarUrl, fbProfile.id, fbToken]
      )
      userId = result.insertId
    }

    // Import Facebook data in the background (non-blocking)
    importFacebookData(userId, fbToken).catch(err => console.error('FB import error:', err))

    // Create session
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, userId, lang]
    )

    // Redirect to frontend with session
    res.redirect(`/?fb_session=${sessionId}&fb_lang=${lang}`)
  } catch (err) {
    console.error('Facebook callback error:', err)
    res.redirect('/?fb_error=server')
  }
})

// Import Facebook data into fellis DB (friends, posts, photos)
async function importFacebookData(userId, fbToken) {
  // Import friends (only those also on Facebook, read-only)
  try {
    const friendsRes = await fetch(`${FB_GRAPH_URL}/me/friends?fields=id,name,picture.width(100).height(100)&limit=500&access_token=${fbToken}`)
    const friendsData = await friendsRes.json()
    if (friendsData.data) {
      for (const friend of friendsData.data) {
        // Check if friend exists on fellis
        const [existing] = await pool.query('SELECT id FROM users WHERE facebook_id = ?', [friend.id])
        if (existing.length > 0) {
          // Add friendship if not exists
          await pool.query(
            'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)',
            [userId, existing[0].id]
          )
          await pool.query(
            'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)',
            [existing[0].id, userId]
          )
        }
      }
    }
  } catch (err) {
    console.error('FB friends import error:', err)
  }

  // Import posts (read-only — just copying text into fellis)
  try {
    const postsRes = await fetch(`${FB_GRAPH_URL}/me/posts?fields=message,created_time,full_picture&limit=100&access_token=${fbToken}`)
    const postsData = await postsRes.json()
    if (postsData.data) {
      for (const post of postsData.data) {
        if (!post.message) continue
        const created = new Date(post.created_time)
        const timeStr = created.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
        const timeStrEn = created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

        // Download image if present
        let mediaJson = null
        if (post.full_picture) {
          try {
            const imgRes = await fetch(post.full_picture)
            if (imgRes.ok) {
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
              const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : '.jpg'
              const filename = crypto.randomUUID() + ext
              const imgPath = path.join(UPLOADS_DIR, filename)
              const buffer = Buffer.from(await imgRes.arrayBuffer())
              fs.writeFileSync(imgPath, buffer)
              mediaJson = JSON.stringify([{ url: `/uploads/${filename}`, type: 'image', mime: contentType }])
            }
          } catch {}
        }

        await pool.query(
          'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, post.message, post.message, timeStr, timeStrEn, mediaJson]
        )
      }
    }
  } catch (err) {
    console.error('FB posts import error:', err)
  }

  // Import photos
  try {
    const photosRes = await fetch(`${FB_GRAPH_URL}/me/photos?type=uploaded&fields=images,name,created_time&limit=100&access_token=${fbToken}`)
    const photosData = await photosRes.json()
    if (photosData.data) {
      let photoCount = 0
      for (const photo of photosData.data) {
        const imgUrl = photo.images?.[0]?.source
        if (!imgUrl) continue
        try {
          const imgRes = await fetch(imgUrl)
          if (imgRes.ok) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
            const ext = contentType.includes('png') ? '.png' : '.gif' ? '.gif' : '.jpg'
            const filename = crypto.randomUUID() + ext
            const imgPath = path.join(UPLOADS_DIR, filename)
            const buffer = Buffer.from(await imgRes.arrayBuffer())
            fs.writeFileSync(imgPath, buffer)
            const caption = photo.name || ''
            const created = new Date(photo.created_time)
            const timeStr = created.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
            const timeStrEn = created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
            const mediaJson = JSON.stringify([{ url: `/uploads/${filename}`, type: 'image', mime: contentType }])
            await pool.query(
              'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media) VALUES (?, ?, ?, ?, ?, ?)',
              [userId, caption, caption, timeStr, timeStrEn, mediaJson]
            )
            photoCount++
          }
        } catch {}
      }
      if (photoCount > 0) {
        await pool.query('UPDATE users SET photo_count = photo_count + ? WHERE id = ?', [photoCount, userId])
      }
    }
  } catch (err) {
    console.error('FB photos import error:', err)
  }
}

// ── Profile routes ──

// GET /api/profile/:id
app.get('/api/profile/:id', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
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
      avatarUrl: u.avatar_url || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// GET /api/profile — current user profile
app.get('/api/profile', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
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
      avatarUrl: u.avatar_url || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// POST /api/profile/avatar — upload profile picture
app.post('/api/profile/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  // Validate magic bytes
  const header = Buffer.alloc(16)
  const fd = fs.openSync(req.file.path, 'r')
  fs.readSync(fd, header, 0, 16, 0)
  fs.closeSync(fd)
  if (!validateMagicBytes(header, req.file.mimetype)) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'File content does not match declared type' })
  }
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'Only image files allowed for profile picture' })
  }
  const avatarUrl = `/uploads/${req.file.filename}`
  try {
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.userId])
    res.json({ avatarUrl })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update avatar' })
  }
})

// ── Feed routes ──

// GET /api/feed — get all posts with comments and media
app.get('/api/feed', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT p.id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at
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
    const result = posts.map(p => {
      let media = null
      if (p.media) {
        try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {}
      }
      return {
        id: p.id,
        author: p.author,
        time: { da: p.time_da, en: p.time_en },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes,
        liked: likedSet.has(p.id),
        media,
        comments: commentsByPost[p.id] || [],
      }
    })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' })
  }
})

// POST /api/feed — create a new post (with optional media)
app.post('/api/feed', authenticate, upload.array('media', 4), async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Post text required' })

  // Validate magic bytes for each uploaded file
  const mediaUrls = []
  if (req.files?.length) {
    for (const file of req.files) {
      const buf = fs.readFileSync(file.path, { length: 16 })
      const header = Buffer.alloc(16)
      const fd = fs.openSync(file.path, 'r')
      fs.readSync(fd, header, 0, 16, 0)
      fs.closeSync(fd)
      if (!validateMagicBytes(header, file.mimetype)) {
        // Delete the suspicious file immediately
        fs.unlinkSync(file.path)
        return res.status(400).json({ error: `File "${file.originalname}" failed content validation` })
      }
      const type = file.mimetype.startsWith('video/') ? 'video' : 'image'
      mediaUrls.push({ url: `/uploads/${file.filename}`, type, mime: file.mimetype })
    }
  }

  try {
    const mediaJson = mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, text, text, 'Lige nu', 'Just now', mediaJson]
    )
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    res.json({
      id: result.insertId,
      author: users[0].name,
      time: { da: 'Lige nu', en: 'Just now' },
      text: { da: text, en: text },
      likes: 0, liked: false, comments: [],
      media: mediaUrls.length > 0 ? mediaUrls : null,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// POST /api/upload — standalone upload endpoint (for drag-and-drop preview)
app.post('/api/upload', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate magic bytes
  const header = Buffer.alloc(16)
  const fd = fs.openSync(req.file.path, 'r')
  fs.readSync(fd, header, 0, 16, 0)
  fs.closeSync(fd)
  if (!validateMagicBytes(header, req.file.mimetype)) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'File content does not match declared type' })
  }

  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
  res.json({ url: `/uploads/${req.file.filename}`, type, mime: req.file.mimetype })
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

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 50 MB)' })
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 4)' })
    return res.status(400).json({ error: err.message })
  }
  if (err) return res.status(400).json({ error: err.message })
  next()
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`fellis.eu API running on http://localhost:${PORT}`)
})
