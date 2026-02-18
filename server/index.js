import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import path from 'path'

// Load .env file manually (avoids Node --env-file flag issues with PM2)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
try {
  const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import pool from './db.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/fellis.eu/uploads'

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// ── GDPR Compliance: Token encryption (Art. 32 — security of processing) ──
// Facebook access tokens are encrypted at rest using AES-256-GCM.
// The encryption key MUST be set via FB_TOKEN_ENCRYPTION_KEY env var (32-byte hex).
const FB_TOKEN_KEY = process.env.FB_TOKEN_ENCRYPTION_KEY
  ? Buffer.from(process.env.FB_TOKEN_ENCRYPTION_KEY, 'hex')
  : null

function encryptToken(plaintext) {
  if (!FB_TOKEN_KEY || !plaintext) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', FB_TOKEN_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: base64(iv:tag:ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decryptToken(encoded) {
  if (!FB_TOKEN_KEY || !encoded) return encoded
  try {
    const buf = Buffer.from(encoded, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ciphertext = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', FB_TOKEN_KEY, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    // Fallback: token may not be encrypted yet (pre-migration data)
    return encoded
  }
}

// ── GDPR Compliance: Audit logging (Art. 30 — records of processing) ──
async function auditLog(userId, action, details = null, ipAddress = null) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, action, details ? JSON.stringify(details) : null, ipAddress]
    )
  } catch (err) {
    console.error('Audit log error:', err.message)
  }
}

// ── GDPR Compliance: Consent verification (Art. 6 & 7) ──
async function hasConsent(userId, consentType) {
  const [rows] = await pool.query(
    'SELECT id FROM gdpr_consent WHERE user_id = ? AND consent_type = ? AND consent_given = 1 AND withdrawn_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [userId, consentType]
  )
  return rows.length > 0
}

async function recordConsent(userId, consentType, ipAddress = null, userAgent = null) {
  await pool.query(
    'INSERT INTO gdpr_consent (user_id, consent_type, consent_given, ip_address, user_agent) VALUES (?, ?, 1, ?, ?)',
    [userId, consentType, ipAddress, userAgent]
  )
  await auditLog(userId, 'consent_given', { consent_type: consentType }, ipAddress)
}

async function withdrawConsent(userId, consentType, ipAddress = null) {
  await pool.query(
    'UPDATE gdpr_consent SET consent_given = 0, withdrawn_at = NOW() WHERE user_id = ? AND consent_type = ? AND consent_given = 1',
    [userId, consentType]
  )
  await auditLog(userId, 'consent_withdrawn', { consent_type: consentType }, ipAddress)
}

// Data retention: Facebook tokens expire after 90 days (configurable)
const FB_DATA_RETENTION_DAYS = parseInt(process.env.FB_DATA_RETENTION_DAYS || '90')

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
    const [users] = await pool.query('SELECT id, password_hash, password_plain FROM users WHERE email = ?', [email])
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' })
    const user = users[0]
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' })
    // Backfill password_plain if missing (for users created before this column existed)
    if (!user.password_plain) {
      await pool.query('UPDATE users SET password_plain = ? WHERE id = ?', [password, user.id])
    }
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
  const { name, email, password, lang, inviteToken } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  try {
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    const handle = '@' + name.toLowerCase().replace(/\s+/g, '.')
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase()
    const userInviteToken = crypto.randomBytes(32).toString('hex')
    const [result] = await pool.query(
      'INSERT INTO users (name, handle, initials, email, password_hash, password_plain, join_date, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, handle, initials, email, hash, password, new Date().toISOString(), userInviteToken]
    )
    const newUserId = result.insertId
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, newUserId, lang || 'da']
    )

    // If registered via invite link, auto-connect with inviter
    if (inviteToken) {
      try {
        const [inviter] = await pool.query('SELECT id FROM users WHERE invite_token = ?', [inviteToken])
        if (inviter.length > 0) {
          const inviterId = inviter[0].id
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, inviterId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [inviterId, newUserId])
        }
        const [invitation] = await pool.query(
          'SELECT id, inviter_id FROM invitations WHERE invite_token = ? AND status = ?',
          [inviteToken, 'pending']
        )
        if (invitation.length > 0) {
          const inviterId = invitation[0].inviter_id
          await pool.query('UPDATE invitations SET status = ?, accepted_by = ? WHERE id = ?', ['accepted', newUserId, invitation[0].id])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, inviterId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [inviterId, newUserId])
        }
      } catch (err) {
        console.error('Invite auto-connect error:', err)
      }
    }

    res.json({ sessionId, userId: newUserId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or handle already exists' })
    res.status(500).json({ error: 'Registration failed' })
  }
})

// POST /api/auth/forgot-password — request password reset (or set first password for FB users)
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })
  try {
    const [users] = await pool.query('SELECT id, name, facebook_id, password_hash FROM users WHERE email = ?', [email])
    if (users.length === 0) {
      // Don't reveal if user exists or not — always return success
      return res.json({ ok: true })
    }
    const user = users[0]
    const token = crypto.randomUUID()
    // Store reset token (reuse sessions table with a special prefix)
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [`reset:${token}`, user.id, 'da']
    )
    // In a real app, send email. For demo, return the token directly.
    res.json({ ok: true, resetToken: token, isFacebookUser: !!user.facebook_id, hasPassword: !!user.password_hash })
  } catch (err) {
    res.status(500).json({ error: 'Request failed' })
  }
})

// POST /api/auth/reset-password — set new password using reset token
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  try {
    const [rows] = await pool.query(
      'SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()',
      [`reset:${token}`]
    )
    if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset token' })
    const userId = rows[0].user_id
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    await pool.query('UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?', [hash, password, userId])
    // Clean up reset token
    await pool.query('DELETE FROM sessions WHERE id = ?', [`reset:${token}`])
    // Create a new login session
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, userId, 'da']
    )
    res.json({ ok: true, sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' })
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

// GDPR/Security: In-memory store for OAuth CSRF state tokens (short-lived)
const oauthStateTokens = new Map()

// Step 1: Redirect user to Facebook login
// GDPR Note: No data is collected at this step — user is simply redirected to Facebook.
app.get('/api/auth/facebook', (req, res) => {
  if (!FB_APP_ID) return res.status(500).json({ error: 'Facebook integration not configured' })
  const lang = req.query.lang || 'da'
  // Security: CSRF protection — generate a cryptographic state token and verify on callback
  const stateToken = crypto.randomUUID()
  oauthStateTokens.set(stateToken, { lang, created: Date.now() })
  // Clean up stale tokens (older than 10 minutes)
  for (const [key, val] of oauthStateTokens) {
    if (Date.now() - val.created > 600000) oauthStateTokens.delete(key)
  }
  const state = stateToken + ':' + lang
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&scope=${FB_SCOPES}&state=${state}&response_type=code`
  res.redirect(url)
})

// Step 2: Facebook redirects back with auth code
// GDPR Art. 6 & 7: User account is created but Facebook data import is DEFERRED
// until explicit consent is given via POST /api/gdpr/consent.
app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect('/?fb_error=denied')

  // Security: Validate CSRF state token
  const stateToken = state?.split(':')?.[0]
  const lang = state?.split(':')?.[1] || 'da'
  if (!stateToken || !oauthStateTokens.has(stateToken)) {
    console.error('OAuth CSRF validation failed: invalid state token')
    return res.redirect('/?fb_error=csrf')
  }
  oauthStateTokens.delete(stateToken)

  try {
    // Exchange code for access token
    const tokenRes = await fetch(
      `${FB_GRAPH_URL}/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&code=${code}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.redirect('/?fb_error=token')
    const fbToken = tokenData.access_token

    // GDPR Art. 5(1)(c) — Data minimization: Only fetch fields strictly needed for account creation
    const profileRes = await fetch(`${FB_GRAPH_URL}/me?fields=id,name,email,picture.width(200).height(200)&access_token=${fbToken}`)
    const fbProfile = await profileRes.json()
    if (!fbProfile.id) return res.redirect('/?fb_error=profile')

    // GDPR Art. 32 — Encrypt the token before storage
    const encryptedToken = encryptToken(fbToken)
    const tokenExpiry = new Date(Date.now() + FB_DATA_RETENTION_DAYS * 86400000).toISOString()

    // Check if user already exists (by email or facebook_id)
    let userId
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR facebook_id = ?', [fbProfile.email, fbProfile.id])

    if (existing.length > 0) {
      userId = existing[0].id
      // Update Facebook token (encrypted) for potential data refresh
      await pool.query(
        'UPDATE users SET facebook_id = ?, fb_access_token = ?, fb_token_expires_at = ? WHERE id = ?',
        [fbProfile.id, encryptedToken, tokenExpiry, userId]
      )
    } else {
      // Create new user from Facebook data (minimal: name, email, avatar only)
      const handle = '@' + (fbProfile.name || 'user').toLowerCase().replace(/\s+/g, '.')
      const initials = (fbProfile.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase()
      const avatarUrl = fbProfile.picture?.data?.url || null
      const userInviteToken = crypto.randomBytes(32).toString('hex')
      const [result] = await pool.query(
        `INSERT INTO users (name, handle, initials, email, join_date, avatar_url, facebook_id, fb_access_token, fb_token_expires_at, invite_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fbProfile.name, handle, initials, fbProfile.email || null, new Date().toISOString(), avatarUrl, fbProfile.id, encryptedToken, tokenExpiry, userInviteToken]
      )
      userId = result.insertId
    }

    // Audit log: Facebook authentication (no data import yet — that requires consent)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress
    await auditLog(userId, 'fb_auth_success', { facebook_id: fbProfile.id }, clientIp)

    // GDPR CHANGE: Do NOT import Facebook data here.
    // Data import is deferred until user gives explicit consent via POST /api/gdpr/consent.
    // The encrypted token is stored so import can happen after consent.

    // Create session
    const sessionId = crypto.randomUUID()
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [sessionId, userId, lang]
    )

    // Redirect to frontend — frontend will show consent dialog before importing
    res.redirect(`/?fb_session=${sessionId}&fb_lang=${lang}&fb_needs_consent=true`)
  } catch (err) {
    console.error('Facebook callback error:', err)
    res.redirect('/?fb_error=server')
  }
})

// Import Facebook data into fellis DB (friends, posts, photos)
// GDPR Art. 6 & 7: This function MUST only be called after verified consent.
// GDPR Art. 5(1)(c): Only imports data strictly necessary for app functionality.
async function importFacebookData(userId, fbToken) {
  await auditLog(userId, 'fb_import_start', { timestamp: new Date().toISOString() })

  let friendsImported = 0, postsImported = 0, photosImported = 0

  // Import friends — GDPR CHANGE: Only link friends who already have fellis accounts.
  // Creating placeholder accounts for third parties without their consent violates GDPR Art. 6.
  try {
    const friendsRes = await fetch(`${FB_GRAPH_URL}/me/friends?fields=id,name&limit=500&access_token=${fbToken}`)
    const friendsData = await friendsRes.json()
    if (friendsData.data) {
      for (const friend of friendsData.data) {
        // GDPR: Only create friendships with users who already exist on fellis
        // We cannot create accounts for third parties without their explicit consent
        const [existing] = await pool.query('SELECT id FROM users WHERE facebook_id = ?', [friend.id])
        if (existing.length > 0) {
          const friendUserId = existing[0].id
          await pool.query(
            'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, source) VALUES (?, ?, 0, ?)',
            [userId, friendUserId, 'facebook']
          )
          await pool.query(
            'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, source) VALUES (?, ?, 0, ?)',
            [friendUserId, userId, 'facebook']
          )
          friendsImported++
        }
      }
      await pool.query('UPDATE users SET friend_count = ? WHERE id = ?', [friendsImported, userId])
    }
  } catch (err) {
    console.error('FB friends import error:', err)
  }

  // Import posts — GDPR Art. 5(1)(c): Only text and single image per post
  try {
    const postsRes = await fetch(`${FB_GRAPH_URL}/me/posts?fields=message,created_time,full_picture&limit=100&access_token=${fbToken}`)
    const postsData = await postsRes.json()
    if (postsData.data) {
      for (const post of postsData.data) {
        if (!post.message) continue
        const created = new Date(post.created_time)
        const timeStr = created.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
        const timeStrEn = created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

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
          'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, post.message, post.message, timeStr, timeStrEn, mediaJson, 'facebook_post']
        )
        postsImported++
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
      for (const photo of photosData.data) {
        const imgUrl = photo.images?.[0]?.source
        if (!imgUrl) continue
        try {
          const imgRes = await fetch(imgUrl)
          if (imgRes.ok) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
            const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : '.jpg'
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
              'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [userId, caption, caption, timeStr, timeStrEn, mediaJson, 'facebook_photo']
            )
            photosImported++
          }
        } catch {}
      }
      if (photosImported > 0) {
        await pool.query('UPDATE users SET photo_count = photo_count + ? WHERE id = ?', [photosImported, userId])
      }
    }
  } catch (err) {
    console.error('FB photos import error:', err)
  }

  // Update import timestamp for data retention tracking
  await pool.query('UPDATE users SET fb_data_imported_at = NOW() WHERE id = ?', [userId])

  await auditLog(userId, 'fb_import_complete', {
    friends: friendsImported, posts: postsImported, photos: photosImported
  })
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
        u.email, u.facebook_id, u.password_hash, u.password_plain, u.created_at,
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
      email: u.email || null,
      loginMethod: u.facebook_id ? 'facebook' : 'email',
      hasPassword: !!u.password_hash,
      passwordHint: u.password_plain ? (u.password_plain[0] + '*'.repeat(Math.max(u.password_plain.length - 2, 0)) + (u.password_plain.length > 1 ? u.password_plain[u.password_plain.length - 1] : '')) : null,
      createdAt: u.created_at || u.join_date || null,
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

// GET /api/feed — get posts with pagination (max 20 in DOM)
app.get('/api/feed', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM posts p
       WHERE p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)`,
      [req.userId, req.userId]
    )
    const total = countResult[0].total

    const [posts] = await pool.query(
      `SELECT p.id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at
       FROM posts p JOIN users u ON p.author_id = u.id
       WHERE p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, req.userId, limit, offset]
    )
    const postIds = posts.map(p => p.id)
    const [comments] = postIds.length > 0
      ? await pool.query(
        `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en
         FROM comments c JOIN users u ON c.author_id = u.id
         WHERE c.post_id IN (?)
         ORDER BY c.created_at ASC`,
        [postIds]
      )
      : [[]]
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
    res.json({ posts: result, total, offset, limit })
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

// ── Invite routes ──

// GET /api/invite/:token — public: get inviter info from invite link
app.get('/api/invite/:token', async (req, res) => {
  const { token } = req.params
  try {
    const [users] = await pool.query(
      'SELECT id, name, avatar_url FROM users WHERE invite_token = ?',
      [token]
    )
    if (users.length > 0) {
      return res.json({ inviter: { name: users[0].name, avatarUrl: users[0].avatar_url } })
    }
    const [invitations] = await pool.query(
      `SELECT u.name, u.avatar_url FROM invitations i
       JOIN users u ON i.inviter_id = u.id
       WHERE i.invite_token = ? AND i.status = 'pending'`,
      [token]
    )
    if (invitations.length > 0) {
      return res.json({ inviter: { name: invitations[0].name, avatarUrl: invitations[0].avatar_url } })
    }
    res.status(404).json({ error: 'Invite not found' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invite' })
  }
})

// GET /api/invites/link — get current user's personal invite link
app.get('/api/invites/link', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT invite_token FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    let token = users[0].invite_token
    if (!token) {
      token = crypto.randomBytes(32).toString('hex')
      await pool.query('UPDATE users SET invite_token = ? WHERE id = ?', [token, req.userId])
    }
    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get invite link' })
  }
})

// POST /api/invites — create individual invitations for selected friends
app.post('/api/invites', authenticate, async (req, res) => {
  const { friends } = req.body
  if (!friends?.length) return res.status(400).json({ error: 'No friends selected' })
  try {
    const created = []
    for (const friend of friends) {
      const token = crypto.randomBytes(32).toString('hex')
      await pool.query(
        'INSERT INTO invitations (inviter_id, invite_token, invitee_name) VALUES (?, ?, ?)',
        [req.userId, token, friend.name || null]
      )
      created.push({ name: friend.name, token })
    }
    res.json({ invitations: created, count: created.length })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create invitations' })
  }
})

// GET /api/invites — list invitations sent by current user
app.get('/api/invites', authenticate, async (req, res) => {
  try {
    const [invitations] = await pool.query(
      `SELECT i.id, i.invite_token, i.invitee_name, i.status, i.created_at,
              u.name as accepted_by_name
       FROM invitations i
       LEFT JOIN users u ON i.accepted_by = u.id
       WHERE i.inviter_id = ?
       ORDER BY i.created_at DESC`,
      [req.userId]
    )
    res.json(invitations)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invitations' })
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

// GET /api/messages — get message threads (latest 20 messages per thread)
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
      const [totalResult] = await pool.query(
        `SELECT COUNT(*) as total FROM messages
         WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
        [req.userId, p.partner_id, p.partner_id, req.userId]
      )
      const totalMsgs = totalResult[0].total
      const [msgs] = await pool.query(
        `SELECT m.id, u_sender.name as from_name, m.text_da, m.text_en, m.time, m.is_read
         FROM messages m
         JOIN users u_sender ON m.sender_id = u_sender.id
         WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY m.created_at DESC
         LIMIT 20`,
        [req.userId, p.partner_id, p.partner_id, req.userId]
      )
      msgs.reverse() // Show oldest first within the window
      const [friendInfo] = await pool.query('SELECT id, name FROM users WHERE id = ?', [p.partner_id])
      const unread = msgs.filter(m => !m.is_read && m.from_name !== friendInfo[0].name).length
      threads.push({
        friendId: friendInfo[0].id,
        friend: friendInfo[0].name,
        messages: msgs.map(m => ({
          from: m.from_name,
          text: { da: m.text_da, en: m.text_en },
          time: m.time,
        })),
        totalMessages: totalMsgs,
        unread,
      })
    }
    res.json(threads)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

// GET /api/messages/:friendId/older?before=N — load older messages for a thread
app.get('/api/messages/:friendId/older', authenticate, async (req, res) => {
  const friendId = parseInt(req.params.friendId)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  const limit = Math.min(parseInt(req.query.limit) || 20, 50)
  try {
    const [msgs] = await pool.query(
      `SELECT m.id, u_sender.name as from_name, m.text_da, m.text_en, m.time
       FROM messages m
       JOIN users u_sender ON m.sender_id = u_sender.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, friendId, friendId, req.userId, limit, offset]
    )
    msgs.reverse()
    res.json({
      messages: msgs.map(m => ({
        from: m.from_name,
        text: { da: m.text_da, en: m.text_en },
        time: m.time,
      })),
    })
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

// ══════════════════════════════════════════════════════════════
// ── GDPR COMPLIANCE ENDPOINTS ──
// ══════════════════════════════════════════════════════════════

// POST /api/gdpr/consent — Record explicit consent and trigger Facebook data import
// GDPR Art. 6 & 7: Consent must be freely given, specific, informed, and unambiguous.
// This endpoint is called AFTER the user reviews the consent dialog on the frontend.
app.post('/api/gdpr/consent', authenticate, async (req, res) => {
  const { consent_types } = req.body // Array: ['facebook_import', 'data_processing']
  if (!consent_types || !Array.isArray(consent_types) || consent_types.length === 0) {
    return res.status(400).json({ error: 'consent_types array required' })
  }
  const validTypes = ['facebook_import', 'data_processing']
  for (const ct of consent_types) {
    if (!validTypes.includes(ct)) return res.status(400).json({ error: `Invalid consent type: ${ct}` })
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress
  const userAgent = req.headers['user-agent'] || null

  try {
    for (const ct of consent_types) {
      await recordConsent(req.userId, ct, clientIp, userAgent)
    }

    // If user consented to facebook_import, trigger the import now
    if (consent_types.includes('facebook_import')) {
      const [users] = await pool.query('SELECT fb_access_token FROM users WHERE id = ?', [req.userId])
      const encryptedToken = users[0]?.fb_access_token
      if (encryptedToken) {
        const fbToken = decryptToken(encryptedToken)
        // Import in background (non-blocking)
        importFacebookData(req.userId, fbToken).catch(err => console.error('FB import error:', err))
        res.json({ ok: true, import_started: true })
      } else {
        res.json({ ok: true, import_started: false, reason: 'no_facebook_token' })
      }
    } else {
      res.json({ ok: true, import_started: false })
    }
  } catch (err) {
    console.error('Consent recording error:', err)
    res.status(500).json({ error: 'Failed to record consent' })
  }
})

// GET /api/gdpr/consent — Check current consent status
app.get('/api/gdpr/consent', authenticate, async (req, res) => {
  try {
    const [consents] = await pool.query(
      'SELECT consent_type, consent_given, created_at, withdrawn_at FROM gdpr_consent WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    )
    // Return the latest consent status per type
    const status = {}
    for (const c of consents) {
      if (!status[c.consent_type]) {
        status[c.consent_type] = {
          given: c.consent_given === 1 && !c.withdrawn_at,
          date: c.created_at,
          withdrawn_at: c.withdrawn_at,
        }
      }
    }
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: 'Failed to check consent' })
  }
})

// POST /api/gdpr/consent/withdraw — Withdraw consent (GDPR Art. 7(3))
// Withdrawing consent must be as easy as giving it.
app.post('/api/gdpr/consent/withdraw', authenticate, async (req, res) => {
  const { consent_type } = req.body
  if (!consent_type) return res.status(400).json({ error: 'consent_type required' })

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress

  try {
    await withdrawConsent(req.userId, consent_type, clientIp)

    // If withdrawing facebook_import consent, also purge the Facebook token
    if (consent_type === 'facebook_import') {
      await pool.query(
        'UPDATE users SET fb_access_token = NULL, fb_token_expires_at = NULL WHERE id = ?',
        [req.userId]
      )
      await auditLog(req.userId, 'fb_token_purged', { reason: 'consent_withdrawn' }, clientIp)
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to withdraw consent' })
  }
})

// DELETE /api/gdpr/facebook-data — Right to erasure for Facebook-sourced data (GDPR Art. 17)
// Deletes all data that was imported from Facebook while preserving native content.
app.delete('/api/gdpr/facebook-data', authenticate, async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress

  try {
    await auditLog(req.userId, 'fb_data_delete_start', null, clientIp)

    // 1. Delete Facebook-sourced posts and their media files
    const [fbPosts] = await pool.query(
      "SELECT id, media FROM posts WHERE author_id = ? AND source IN ('facebook_post', 'facebook_photo')",
      [req.userId]
    )
    for (const post of fbPosts) {
      // Delete associated media files from disk
      if (post.media) {
        try {
          const mediaArr = typeof post.media === 'string' ? JSON.parse(post.media) : post.media
          for (const m of mediaArr) {
            if (m.url?.startsWith('/uploads/')) {
              const filePath = path.join(UPLOADS_DIR, path.basename(m.url))
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            }
          }
        } catch {}
      }
    }
    // Cascade: comments and likes on these posts are deleted via ON DELETE CASCADE
    if (fbPosts.length > 0) {
      await pool.query(
        "DELETE FROM posts WHERE author_id = ? AND source IN ('facebook_post', 'facebook_photo')",
        [req.userId]
      )
    }

    // 2. Delete Facebook-sourced friendships
    await pool.query(
      "DELETE FROM friendships WHERE (user_id = ? OR friend_id = ?) AND source = 'facebook'",
      [req.userId, req.userId]
    )

    // 3. Purge Facebook token and metadata
    await pool.query(
      'UPDATE users SET fb_access_token = NULL, fb_token_expires_at = NULL, fb_data_imported_at = NULL WHERE id = ?',
      [req.userId]
    )

    // 4. Withdraw any Facebook-related consent
    await withdrawConsent(req.userId, 'facebook_import', clientIp)

    await auditLog(req.userId, 'fb_data_delete_complete', {
      posts_deleted: fbPosts.length
    }, clientIp)

    res.json({ ok: true, deleted: { posts: fbPosts.length } })
  } catch (err) {
    console.error('Facebook data deletion error:', err)
    res.status(500).json({ error: 'Failed to delete Facebook data' })
  }
})

// DELETE /api/gdpr/account — Full account deletion (GDPR Art. 17 — Right to be forgotten)
// Deletes the user and ALL associated data. This is irreversible.
app.delete('/api/gdpr/account', authenticate, async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress

  try {
    // Log before deletion (user_id will be preserved in audit log for legal compliance)
    await auditLog(req.userId, 'account_delete_request', null, clientIp)

    // Delete uploaded media files owned by this user
    const [userPosts] = await pool.query('SELECT media FROM posts WHERE author_id = ?', [req.userId])
    for (const post of userPosts) {
      if (post.media) {
        try {
          const mediaArr = typeof post.media === 'string' ? JSON.parse(post.media) : post.media
          for (const m of mediaArr) {
            if (m.url?.startsWith('/uploads/')) {
              const filePath = path.join(UPLOADS_DIR, path.basename(m.url))
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            }
          }
        } catch {}
      }
    }

    // Delete avatar if it's a local upload
    const [userInfo] = await pool.query('SELECT avatar_url FROM users WHERE id = ?', [req.userId])
    if (userInfo[0]?.avatar_url?.startsWith('/uploads/')) {
      const avatarPath = path.join(UPLOADS_DIR, path.basename(userInfo[0].avatar_url))
      if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath)
    }

    // CASCADE DELETE: posts, comments, likes, messages, friendships, sessions, consent records
    // all have ON DELETE CASCADE foreign keys referencing users(id)
    await pool.query('DELETE FROM users WHERE id = ?', [req.userId])

    await auditLog(null, 'account_deleted', { former_user_id: req.userId }, clientIp)

    res.json({ ok: true })
  } catch (err) {
    console.error('Account deletion error:', err)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

// GET /api/gdpr/export — Data portability (GDPR Art. 20)
// Returns all user data in a structured JSON format for download.
app.get('/api/gdpr/export', authenticate, async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress

  try {
    await auditLog(req.userId, 'data_export_request', null, clientIp)

    const [users] = await pool.query(
      'SELECT id, name, handle, email, bio_da, bio_en, location, join_date, created_at FROM users WHERE id = ?',
      [req.userId]
    )
    const [posts] = await pool.query(
      'SELECT id, text_da, text_en, time_da, time_en, likes, source, created_at FROM posts WHERE author_id = ?',
      [req.userId]
    )
    const [comments] = await pool.query(
      'SELECT c.id, c.post_id, c.text_da, c.text_en, c.created_at FROM comments c WHERE c.author_id = ?',
      [req.userId]
    )
    const [friends] = await pool.query(
      'SELECT u.name, f.source, f.created_at FROM friendships f JOIN users u ON f.friend_id = u.id WHERE f.user_id = ?',
      [req.userId]
    )
    const [messages] = await pool.query(
      `SELECT u.name as partner, m.text_da, m.text_en, m.time, m.created_at,
              CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END as direction
       FROM messages m JOIN users u ON (CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) = u.id
       WHERE m.sender_id = ? OR m.receiver_id = ?`,
      [req.userId, req.userId, req.userId, req.userId]
    )
    const [consents] = await pool.query(
      'SELECT consent_type, consent_given, created_at, withdrawn_at FROM gdpr_consent WHERE user_id = ?',
      [req.userId]
    )

    const exportData = {
      export_date: new Date().toISOString(),
      export_format: 'GDPR Art. 20 Data Portability Export',
      user: users[0] || null,
      posts,
      comments,
      friends,
      messages,
      consent_history: consents,
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="fellis-data-export-${req.userId}-${Date.now()}.json"`)
    res.json(exportData)
  } catch (err) {
    console.error('Data export error:', err)
    res.status(500).json({ error: 'Failed to export data' })
  }
})

// ── Data Retention Cleanup (GDPR Art. 5(1)(e) — storage limitation) ──
// Runs periodically to purge expired Facebook tokens and stale data.
async function runDataRetentionCleanup() {
  try {
    // Purge expired Facebook tokens
    const [expired] = await pool.query(
      'SELECT id FROM users WHERE fb_token_expires_at IS NOT NULL AND fb_token_expires_at < NOW()'
    )
    if (expired.length > 0) {
      await pool.query(
        'UPDATE users SET fb_access_token = NULL, fb_token_expires_at = NULL WHERE fb_token_expires_at < NOW()'
      )
      for (const u of expired) {
        await auditLog(u.id, 'fb_token_expired_purge', { reason: 'data_retention_policy' })
      }
      console.log(`[GDPR Retention] Purged ${expired.length} expired Facebook tokens`)
    }

    // Purge expired sessions
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()')
  } catch (err) {
    console.error('[GDPR Retention] Cleanup error:', err)
  }
}

// Run cleanup every 6 hours
setInterval(runDataRetentionCleanup, 6 * 60 * 60 * 1000)
// Also run once on startup
runDataRetentionCleanup()

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
  if (!FB_TOKEN_KEY) {
    console.warn('⚠️  WARNING: FB_TOKEN_ENCRYPTION_KEY not set. Facebook tokens will be stored unencrypted.')
    console.warn('   Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
})
