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

function formatPostTime(createdAt, lang) {
  const now = new Date()
  const created = new Date(createdAt)
  const diffMs = now - created
  if (diffMs < 60_000) return lang === 'da' ? 'Lige nu' : 'Just now'
  const locale = lang === 'da' ? 'da-DK' : 'en-US'
  const timeStr = created.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const today = now.toDateString() === created.toDateString()
  if (today) return timeStr
  const thisYear = now.getFullYear() === created.getFullYear()
  const dateStr = created.toLocaleDateString(locale, {
    day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' })
  })
  return `${dateStr} ${timeStr}`
}

function formatMsgTime(createdAt) {
  const now = new Date()
  const created = new Date(createdAt)
  const timeStr = `${created.getHours().toString().padStart(2, '0')}:${created.getMinutes().toString().padStart(2, '0')}`
  const today = now.toDateString() === created.toDateString()
  if (today) return timeStr
  const dateStr = created.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
  return `${dateStr} ${timeStr}`
}

import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import pool from './db.js'

// ── Mail transport (only active when MAIL_HOST is configured + nodemailer installed) ──
let mailer = null
if (process.env.MAIL_HOST) {
  try {
    const nodemailer = (await import('nodemailer')).default
    mailer = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587'),
      secure: process.env.MAIL_SECURE === 'true',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    })
  } catch {
    console.warn('nodemailer not installed — email sending disabled')
  }
}

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

// ── Events: schema init ──
async function initEvents() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS events (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      organizer_id INT(11) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT DEFAULT NULL,
      date DATETIME NOT NULL,
      location VARCHAR(255) DEFAULT NULL,
      event_type VARCHAR(50) DEFAULT NULL,
      ticket_url VARCHAR(500) DEFAULT NULL,
      cap INT(11) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS event_rsvps (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_id INT(11) NOT NULL,
      user_id INT(11) NOT NULL,
      status ENUM('going','maybe','notGoing') NOT NULL,
      dietary VARCHAR(255) DEFAULT NULL,
      plus_one TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_event_user (event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
    // Migrate: add columns that may be missing on existing installations
    await pool.query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS dietary VARCHAR(255) DEFAULT NULL`).catch(() => {})
    await pool.query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS plus_one TINYINT(1) DEFAULT 0`).catch(() => {})
  } catch (err) {
    console.error('initEvents error:', err.message)
  }
}

// ── Friend requests: schema init ──
async function initFriendRequests() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS friend_requests (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      from_user_id INT(11) NOT NULL,
      to_user_id INT(11) NOT NULL,
      status ENUM('pending','accepted','declined') DEFAULT 'pending',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      UNIQUE KEY unique_request (from_user_id, to_user_id),
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
    // Also add source column to friendships if missing (for Facebook tracking)
    await pool.query('ALTER TABLE friendships ADD COLUMN source VARCHAR(50) DEFAULT NULL').catch(() => {})
  } catch (err) {
    console.error('initFriendRequests error:', err.message)
  }
}

// ── Conversations: schema migration + 1:1 message backfill ──
async function initConversations() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) DEFAULT NULL,
      is_group TINYINT(1) DEFAULT 0,
      created_by INT(11) DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id INT(11) NOT NULL,
      user_id INT(11) NOT NULL,
      muted_until DATETIME DEFAULT NULL,
      joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
    // Add conversation_id column (safe — fails silently if already present)
    await pool.query('ALTER TABLE messages ADD COLUMN conversation_id INT(11) DEFAULT NULL AFTER id').catch(() => {})
    await pool.query('ALTER TABLE messages ADD INDEX idx_msg_conv (conversation_id)').catch(() => {})
    // Clean up broken 1:1 conversations created with null/missing participants
    await pool.query(`
      DELETE c FROM conversations c
      WHERE c.is_group = 0
        AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) < 2
        AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) = 0
    `).catch(() => {})
    // Migrate existing 1:1 messages to conversation records
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id IS NULL')
    if (cnt === 0) return
    const [pairs] = await pool.query(`
      SELECT LEAST(sender_id, receiver_id) as user1, GREATEST(sender_id, receiver_id) as user2
      FROM messages WHERE conversation_id IS NULL GROUP BY user1, user2`)
    for (const { user1, user2 } of pairs) {
      const [existing] = await pool.query(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
        JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
        WHERE c.is_group = 0 LIMIT 1`, [user1, user2])
      let convId
      if (existing.length > 0) {
        convId = existing[0].id
      } else {
        const [r] = await pool.query('INSERT INTO conversations (is_group, created_by) VALUES (0, ?)', [user1])
        convId = r.insertId
        await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
          [convId, user1, convId, user2])
      }
      await pool.query(`UPDATE messages SET conversation_id = ? WHERE conversation_id IS NULL
        AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
        [convId, user1, user2, user2, user1])
    }
    console.log('Conversations migration complete')
  } catch (err) {
    console.error('initConversations error:', err.message)
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

// ── Cookie helpers for persistent login ──
const COOKIE_NAME = 'fellis_sid'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  })
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

function getSessionIdFromRequest(req) {
  // Header takes priority, then cookie.
  // Guard against the literal strings "null"/"undefined" that JS sends when the
  // client calls fetch with headers: { 'X-Session-Id': null }.
  const fromHeader = req.headers['x-session-id']
  if (fromHeader && fromHeader !== 'null' && fromHeader !== 'undefined') return fromHeader
  // Parse cookie manually
  const cookies = req.headers.cookie
  if (!cookies) return null
  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE_NAME + '='))
  return match ? match.split('=')[1] : null
}

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

// Auto-migrations
pool.query('ALTER TABLE comments ADD COLUMN IF NOT EXISTS media JSON DEFAULT NULL')
  .catch(err => console.error('Migration (comments.media):', err.message))
pool.query("ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS reaction VARCHAR(10) DEFAULT '❤️'")
  .catch(err => console.error('Migration (post_likes.reaction):', err.message))
pool.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invitee_email VARCHAR(255) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.invitee_email):', err.message))
pool.query('ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20) DEFAULT NULL')
  .catch(err => console.error('Migration (marketplace_listings.contact_phone):', err.message))
pool.query('ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) DEFAULT NULL')
  .catch(err => console.error('Migration (marketplace_listings.contact_email):', err.message))
pool.query('ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS sold TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (marketplace_listings.sold):', err.message))
pool.query('ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS priceNegotiable TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (marketplace_listings.priceNegotiable):', err.message))

pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'privat'")
  .catch(err => console.error('Migration (users.mode):', err.message))
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(30) DEFAULT 'business'")
  .catch(err => console.error('Migration (users.plan):', err.message))

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
  const sessionId = getSessionIdFromRequest(req)
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

// ── Password policy ──────────────────────────────────────────────────────────

async function getPasswordPolicy() {
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name LIKE 'pwd_%'"
    )
    const s = {}
    for (const r of rows) s[r.key_name] = r.key_value
    return {
      min_length: Math.max(parseInt(s.pwd_min_length) || 6, 1),
      require_uppercase: s.pwd_require_uppercase === '1',
      require_lowercase: s.pwd_require_lowercase === '1',
      require_numbers: s.pwd_require_numbers === '1',
      require_symbols: s.pwd_require_symbols === '1',
    }
  } catch {
    return { min_length: 6, require_uppercase: false, require_lowercase: false, require_numbers: false, require_symbols: false }
  }
}

function validatePasswordStrength(password, policy, lang = 'da') {
  const errors = []
  if (password.length < policy.min_length)
    errors.push(lang === 'da' ? `Min. ${policy.min_length} tegn` : `Min. ${policy.min_length} characters`)
  if (policy.require_uppercase && !/[A-Z]/.test(password))
    errors.push(lang === 'da' ? 'Mindst ét stort bogstav' : 'At least one uppercase letter')
  if (policy.require_lowercase && !/[a-z]/.test(password))
    errors.push(lang === 'da' ? 'Mindst ét lille bogstav' : 'At least one lowercase letter')
  if (policy.require_numbers && !/[0-9]/.test(password))
    errors.push(lang === 'da' ? 'Mindst ét tal' : 'At least one number')
  if (policy.require_symbols && !/[^A-Za-z0-9]/.test(password))
    errors.push(lang === 'da' ? 'Mindst ét specialtegn (!@#$...)' : 'At least one symbol (!@#$...)')
  return errors
}

// GET /api/auth/password-policy — public, returns current requirements
app.get('/api/auth/password-policy', async (req, res) => {
  res.json(await getPasswordPolicy())
})

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
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, user.id, lang || 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ sessionId, userId: user.id })
  } catch (err) {
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/register — create account after migration
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, lang, inviteToken } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' })
  const regPolicy = await getPasswordPolicy()
  const regPwdErrors = validatePasswordStrength(password, regPolicy, lang || 'da')
  if (regPwdErrors.length > 0) return res.status(400).json({ error: regPwdErrors.join('. ') })
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
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, newUserId, lang || 'da', ua, ip]
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

    setSessionCookie(res, sessionId)
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
  const { token, password, lang: resetLang } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  const resetPolicy = await getPasswordPolicy()
  const resetPwdErrors = validatePasswordStrength(password, resetPolicy, resetLang || 'da')
  if (resetPwdErrors.length > 0) return res.status(400).json({ error: resetPwdErrors.join('. ') })
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
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ ok: true, sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' })
  }
})

// POST /api/auth/change-password — change password while logged in
app.post('/api/auth/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' })
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' })
  try {
    const [users] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.userId])
    if (!users.length) return res.status(404).json({ error: 'User not found' })
    const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex')
    if (currentHash !== users[0].password_hash) return res.status(401).json({ error: 'Current password is incorrect' })
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex')
    await pool.query('UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?', [newHash, newPassword, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId])
  clearSessionCookie(res)
  res.json({ ok: true })
})

// GET /api/auth/session — check if session is valid
app.get('/api/auth/session', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, handle, initials, avatar_url, plan FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = { ...users[0], plan: users[0].plan || 'business', is_admin: users[0].id === 1 }
    res.json({ user, lang: req.lang })
  } catch (err) {
    res.status(500).json({ error: 'Session check failed' })
  }
})

// ── Facebook OAuth ──

const FB_APP_ID = process.env.FB_APP_ID
const FB_APP_SECRET = process.env.FB_APP_SECRET
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://fellis.eu/api/auth/facebook/callback'
const FB_GRAPH_URL = 'https://graph.facebook.com/v21.0'

// Scopes: basic profile only — no extended permissions required, app can go Live without App Review
const FB_SCOPES = 'public_profile,email'

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
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, lang, ua, ip]
    )

    // Redirect to frontend — frontend will show consent dialog before importing
    setSessionCookie(res, sessionId)
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

// GET /api/profile/:id — public profile (friend view)
app.get('/api/profile/:id', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
        (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count,
        (SELECT COUNT(*) FROM friendships f1
           JOIN friendships f2 ON f1.friend_id = f2.friend_id
           WHERE f1.user_id = ? AND f2.user_id = u.id) as mutual_count,
        (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = u.id) as is_friend
       FROM users u WHERE u.id = ?`,
      [req.userId, req.userId, targetId]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    // Log profile view (fire-and-forget, skip self-views)
    if (targetId !== req.userId) {
      pool.query('INSERT INTO profile_views (viewer_id, profile_id) VALUES (?, ?)', [req.userId, targetId]).catch(() => {})
    }
    res.json({
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      avatarUrl: u.avatar_url || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
      mutualCount: u.mutual_count || 0,
      isFriend: !!u.is_friend,
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
        u.email, u.facebook_id, u.password_hash, u.password_plain, u.created_at, u.interests,
        (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
       FROM users u WHERE u.id = ?`,
      [req.userId]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    let interests = []
    try { interests = u.interests ? (typeof u.interests === 'string' ? JSON.parse(u.interests) : u.interests) : [] } catch {}
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
      interests,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// PATCH /api/me/mode — update user mode (privat / business)
app.patch('/api/me/mode', authenticate, async (req, res) => {
  const { mode } = req.body
  if (!['privat', 'business'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' })
  try {
    await pool.query('UPDATE users SET mode = ? WHERE id = ?', [mode, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mode' })
  }
})

// PATCH /api/me/interests — save user interest categories (min 3)
app.patch('/api/me/interests', authenticate, async (req, res) => {
  const { interests } = req.body
  if (!Array.isArray(interests) || interests.length < 3) {
    return res.status(400).json({ error: 'At least 3 interests required' })
  }
  const VALID = ['musik','videnskab','nyheder','sport','teknologi','kunst','mad','rejser','film','politik','natur','gaming','sundhed','boger','humor','diy','okonomi','mode']
  const clean = interests.filter(i => VALID.includes(i))
  if (clean.length < 3) return res.status(400).json({ error: 'Invalid interest categories' })
  try {
    await pool.query('UPDATE users SET interests = ? WHERE id = ?', [JSON.stringify(clean), req.userId])
    res.json({ ok: true, interests: clean })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update interests' })
  }
})

// PATCH /api/friends/:id/family — mark/unmark a friend as family
app.patch('/api/friends/:id/family', authenticate, async (req, res) => {
  const friendId = parseInt(req.params.id)
  const { isFamily } = req.body
  if (typeof isFamily !== 'boolean') return res.status(400).json({ error: 'isFamily must be boolean' })
  try {
    // Update both directions of the bidirectional friendship
    await pool.query(
      'UPDATE friendships SET is_family = ? WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [isFamily ? 1 : 0, req.userId, friendId, friendId, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update family status' })
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

// PATCH /api/profile/email — change email address
app.patch('/api/profile/email', authenticate, async (req, res) => {
  const { newEmail, password } = req.body
  if (!newEmail || !password) return res.status(400).json({ error: 'newEmail and password required' })
  try {
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const hash = crypto.createHash('sha256').update(password).digest('hex')
    if (hash !== user.password_hash) return res.status(401).json({ error: 'Wrong password' })
    const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, req.userId])
    if (existing) return res.status(409).json({ error: 'Email already in use' })
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, req.userId])
    res.json({ ok: true, email: newEmail })
  } catch (err) {
    console.error('PATCH /api/profile/email error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/profile/password — change password
app.patch('/api/profile/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword, lang: chgLang } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' })
  const chgPolicy = await getPasswordPolicy()
  const chgPwdErrors = validatePasswordStrength(newPassword, chgPolicy, chgLang || 'da')
  if (chgPwdErrors.length > 0) return res.status(400).json({ error: chgPwdErrors.join('. ') })
  try {
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex')
    if (currentHash !== user.password_hash) return res.status(401).json({ error: 'Wrong current password' })
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex')
    await pool.query('UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?', [newHash, newPassword, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile/password error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Settings: Sessions ─────────────────────────────────────────────────────

// GET /api/settings/sessions — list all active sessions for current user
app.get('/api/settings/sessions', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  try {
    const [rows] = await pool.query(
      `SELECT id, lang, user_agent, ip_address, created_at, expires_at,
              (id = ?) AS is_current
       FROM sessions WHERE user_id = ? AND expires_at > NOW() AND id NOT LIKE 'reset:%'
       ORDER BY is_current DESC, created_at DESC`,
      [sessionId, req.userId]
    )
    res.json({ sessions: rows })
  } catch (err) {
    console.error('GET /api/settings/sessions error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/settings/sessions/:id — log out a specific session
app.delete('/api/settings/sessions/:id', authenticate, async (req, res) => {
  try {
    const [[session]] = await pool.query('SELECT user_id FROM sessions WHERE id = ?', [req.params.id])
    if (!session || session.user_id !== req.userId) return res.status(404).json({ error: 'Not found' })
    await pool.query('DELETE FROM sessions WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/settings/sessions/others — log out all other sessions
app.delete('/api/settings/sessions/others', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.userId, sessionId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Settings: Privacy ──────────────────────────────────────────────────────

// GET /api/settings/privacy
app.get('/api/settings/privacy', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT profile_visibility, friend_request_privacy FROM users WHERE id = ?',
      [req.userId]
    )
    res.json({
      profile_visibility: user?.profile_visibility || 'all',
      friend_request_privacy: user?.friend_request_privacy || 'all',
    })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/settings/privacy
app.patch('/api/settings/privacy', authenticate, async (req, res) => {
  const { profile_visibility, friend_request_privacy } = req.body
  const pv = ['all', 'friends'].includes(profile_visibility) ? profile_visibility : null
  const frp = ['all', 'friends_of_friends'].includes(friend_request_privacy) ? friend_request_privacy : null
  if (!pv && !frp) return res.status(400).json({ error: 'Nothing to update' })
  try {
    if (pv) await pool.query('UPDATE users SET profile_visibility = ? WHERE id = ?', [pv, req.userId])
    if (frp) await pool.query('UPDATE users SET friend_request_privacy = ? WHERE id = ?', [frp, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Settings: Skills ───────────────────────────────────────────────────────

// GET /api/skills/:userId — get skills + endorsement counts
app.get('/api/skills/:userId', authenticate, async (req, res) => {
  try {
    const [skills] = await pool.query(
      `SELECT s.id, s.name,
              COUNT(e.endorser_id) AS endorsement_count,
              MAX(e.endorser_id = ?) AS endorsed_by_me
       FROM user_skills s
       LEFT JOIN skill_endorsements e ON e.skill_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id, s.name
       ORDER BY s.display_order, s.id`,
      [req.userId, req.params.userId]
    )
    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/skills/:skillId/endorsers — names of people who endorsed
app.get('/api/skills/:skillId/endorsers', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM skill_endorsements e JOIN users u ON u.id = e.endorser_id
       WHERE e.skill_id = ?`,
      [req.params.skillId]
    )
    res.json({ endorsers: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/skills — add a skill (own profile)
app.post('/api/skills', authenticate, async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    const [existing] = await pool.query('SELECT COUNT(*) AS n FROM user_skills WHERE user_id = ?', [req.userId])
    if (existing[0].n >= 20) return res.status(400).json({ error: 'Max 20 skills' })
    const [result] = await pool.query(
      'INSERT INTO user_skills (user_id, name) VALUES (?, ?)',
      [req.userId, name.trim()]
    )
    res.json({ id: result.insertId, name: name.trim(), endorsement_count: 0, endorsed_by_me: false })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Skill already exists' })
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/skills/:id — remove a skill (own only, even with endorsements)
app.delete('/api/skills/:id', authenticate, async (req, res) => {
  try {
    const [[skill]] = await pool.query('SELECT user_id FROM user_skills WHERE id = ?', [req.params.id])
    if (!skill || skill.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM skill_endorsements WHERE skill_id = ?', [req.params.id])
    await pool.query('DELETE FROM user_skills WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/skills/:id/endorse — toggle endorse / unendorse
app.post('/api/skills/:id/endorse', authenticate, async (req, res) => {
  try {
    const [[skill]] = await pool.query('SELECT user_id FROM user_skills WHERE id = ?', [req.params.id])
    if (!skill) return res.status(404).json({ error: 'Not found' })
    if (skill.user_id === req.userId) return res.status(400).json({ error: 'Cannot endorse own skill' })
    const [[existing]] = await pool.query(
      'SELECT 1 FROM skill_endorsements WHERE skill_id = ? AND endorser_id = ?',
      [req.params.id, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM skill_endorsements WHERE skill_id = ? AND endorser_id = ?', [req.params.id, req.userId])
      res.json({ endorsed: false })
    } else {
      await pool.query('INSERT INTO skill_endorsements (skill_id, endorser_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ endorsed: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Feed routes ──

// In-memory cache for feed algorithm weights (TTL: 5 min)
let _feedWeightsCache = null
let _feedWeightsCacheTime = 0
async function getFeedWeights() {
  if (_feedWeightsCache && Date.now() - _feedWeightsCacheTime < 5 * 60 * 1000) return _feedWeightsCache
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('feed_weight_family','feed_weight_interest','feed_weight_recency')"
    )
    const w = { family: 1000, interest: 100, recency: 50 }
    for (const r of rows) {
      const k = r.key_name.replace('feed_weight_', '')
      const v = parseFloat(r.key_value)
      if (!isNaN(v) && v >= 0) w[k] = v
    }
    _feedWeightsCache = w
    _feedWeightsCacheTime = Date.now()
    return w
  } catch { return { family: 1000, interest: 100, recency: 50 } }
}

// Interest keyword map used for feed scoring
const INTEREST_KEYWORDS = {
  musik:      ['musik','sang','melodi','koncert','album','music','song','concert','spotify','artist','playliste','playlist'],
  videnskab:  ['videnskab','forskning','studie','science','research','experiment','eksperiment','studie','analyse'],
  nyheder:    ['nyheder','breaking','nyhed','news','aktuelt','headline','avis'],
  sport:      ['sport','fodbold','basket','tennis','løb','gym','træning','football','basketball','running','workout','kamp','turnering'],
  teknologi:  ['teknologi','tech','app','software','hardware','ai','computer','programmering','kode','code','robot','digitalt'],
  kunst:      ['kunst','maleri','udstilling','art','painting','exhibition','galleri','skulptur','tegning','design'],
  mad:        ['mad','opskrift','restaurant','food','recipe','cooking','dinner','aftensmad','morgenmad','bagning','baking'],
  rejser:     ['rejse','ferie','tur','travel','holiday','vacation','abroad','udland','flyver','hotel','destination'],
  film:       ['film','biograf','serie','movie','cinema','netflix','tv-serie','episode','premiere','streaming'],
  politik:    ['politik','valg','regering','politics','election','government','debat','ministeriet','parti'],
  natur:      ['natur','skov','strand','have','nature','forest','beach','garden','outdoor','vandring','hike'],
  gaming:     ['gaming','spil','game','playstation','xbox','nintendo','esport','streamer','twitch'],
  sundhed:    ['sundhed','helse','kost','motion','health','fitness','wellness','yoga','meditation','løber'],
  boger:      ['bog','bøger','læse','roman','book','books','reading','novel','bibliotek','forfatter','author'],
  humor:      ['sjov','griner','humor','funny','joke','lol','komedi','comedy','meme'],
  diy:        ['gør-det-selv','projekt','bygge','lave','diy','project','build','craft','håndværk','kreativt'],
  okonomi:    ['økonomi','aktier','investering','pension','finance','investment','stocks','budget','opsparing'],
  mode:       ['mode','tøj','stil','fashion','clothes','outfit','style','look','trends'],
}

function scorePost(post, userInterests, familySet, weights = { family: 1000, interest: 100, recency: 50 }) {
  let score = 0
  // Family posts get highest priority
  if (familySet.has(post.author_id)) score += weights.family
  // Interest keyword matching on bilingual text
  if (userInterests.length > 0) {
    const postText = ((post.text_da || '') + ' ' + (post.text_en || '')).toLowerCase()
    for (const interest of userInterests) {
      const keywords = INTEREST_KEYWORDS[interest] || []
      if (keywords.some(kw => postText.includes(kw))) score += weights.interest
    }
  }
  // Recency score: decay over 100× recency-weight hours
  const ageHours = (Date.now() - new Date(post.created_at).getTime()) / 3600000
  score += Math.max(0, weights.recency - ageHours * (weights.recency / 100))
  return score
}

// GET /api/feed — get posts with pagination (max 20 in DOM)
app.get('/api/feed', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    // Fetch user interests, family friends, and algorithm weights in parallel
    const [[userRows], [familyRows], weights] = await Promise.all([
      pool.query('SELECT interests FROM users WHERE id = ?', [req.userId]),
      pool.query('SELECT friend_id FROM friendships WHERE user_id = ? AND is_family = 1', [req.userId]).catch(() => [[]]),
      getFeedWeights(),
    ])
    let userInterests = []
    try { userInterests = userRows[0]?.interests ? (typeof userRows[0].interests === 'string' ? JSON.parse(userRows[0].interests) : userRows[0].interests) : [] } catch {}
    const familySet = new Set(familyRows.map(r => r.friend_id))

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM posts p
       WHERE p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)`,
      [req.userId, req.userId]
    )
    const total = countResult[0].total

    // Fetch a larger window to allow interest-based reordering, then slice
    const fetchLimit = Math.min(limit * 3, 150)
    const [posts] = await pool.query(
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at
       FROM posts p JOIN users u ON p.author_id = u.id
       WHERE p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, req.userId, fetchLimit, offset]
    )
    // Re-sort by interest score when user has interests or family friends set
    if (userInterests.length > 0 || familySet.size > 0) {
      posts.sort((a, b) => scorePost(b, userInterests, familySet, weights) - scorePost(a, userInterests, familySet, weights))
    }
    const pagedPosts = posts.slice(0, limit)
    const postIds = pagedPosts.map(p => p.id)
    let comments = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en, c.media
           FROM comments c JOIN users u ON c.author_id = u.id
           WHERE c.post_id IN (?)
           ORDER BY c.created_at ASC`,
          [postIds]
        )
        comments = rows
      } catch {
        // media column may not exist yet — fall back to query without it
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en
           FROM comments c JOIN users u ON c.author_id = u.id
           WHERE c.post_id IN (?)
           ORDER BY c.created_at ASC`,
          [postIds]
        )
        comments = rows
      }
    }
    // Fetch user's own likes (with reaction if column exists)
    let userLikes = []
    try {
      const [rows] = await pool.query('SELECT post_id, reaction FROM post_likes WHERE user_id = ?', [req.userId])
      userLikes = rows
    } catch {
      const [rows] = await pool.query('SELECT post_id FROM post_likes WHERE user_id = ?', [req.userId])
      userLikes = rows
    }
    const likedSet = new Set(userLikes.map(l => l.post_id))
    const userReactionMap = {}
    for (const l of userLikes) { if (l.reaction) userReactionMap[l.post_id] = l.reaction }

    // Fetch aggregated reaction counts for all posts
    let reactionRows = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT post_id, reaction, COUNT(*) as cnt FROM post_likes WHERE post_id IN (?) GROUP BY post_id, reaction ORDER BY cnt DESC`,
          [postIds]
        )
        reactionRows = rows
      } catch {}
    }
    const reactionsByPost = {}
    for (const r of reactionRows) {
      if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = []
      reactionsByPost[r.post_id].push({ emoji: r.reaction, count: Number(r.cnt) })
    }

    const commentsByPost = {}
    for (const c of comments) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = []
      let cMedia = null
      if (c.media) { try { cMedia = typeof c.media === 'string' ? JSON.parse(c.media) : c.media } catch {} }
      commentsByPost[c.post_id].push({ author: c.author, text: { da: c.text_da, en: c.text_en }, media: cMedia })
    }
    const result = pagedPosts.map(p => {
      let media = null
      if (p.media) {
        try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {}
      }
      return {
        id: p.id,
        author: p.author,
        authorId: p.author_id,
        isFamily: familySet.has(p.author_id),
        time: { da: formatPostTime(p.created_at, 'da'), en: formatPostTime(p.created_at, 'en') },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes,
        liked: likedSet.has(p.id),
        userReaction: userReactionMap[p.id] || null,
        reactions: reactionsByPost[p.id] || [],
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
    const now = new Date()
    res.json({
      id: result.insertId,
      author: users[0].name,
      time: { da: formatPostTime(now, 'da'), en: formatPostTime(now, 'en') },
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

// POST /api/feed/:id/like — toggle like or change reaction
app.post('/api/feed/:id/like', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  const reaction = req.body?.reaction || '❤️'
  try {
    const [existing] = await pool.query(
      'SELECT id, reaction FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    )
    if (existing.length > 0) {
      const cur = existing[0].reaction || '❤️'
      if (cur !== reaction) {
        // Change reaction without removing the like
        try {
          await pool.query('UPDATE post_likes SET reaction = ? WHERE post_id = ? AND user_id = ?', [reaction, postId, req.userId])
        } catch {} // reaction column not yet migrated
        return res.json({ liked: true, reaction })
      }
      // Same reaction — toggle off
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.userId])
      await pool.query('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId])
      res.json({ liked: false })
    } else {
      try {
        await pool.query('INSERT INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)', [postId, req.userId, reaction])
      } catch {
        await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.userId])
      }
      await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId])
      res.json({ liked: true, reaction })
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like' })
  }
})

// GET /api/feed/:id/likers — list of users who liked a post with their reaction
app.get('/api/feed/:id/likers', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url, COALESCE(pl.reaction, '❤️') as reaction
       FROM post_likes pl JOIN users u ON u.id = pl.user_id
       WHERE pl.post_id = ? ORDER BY pl.created_at DESC`,
      [postId])
    res.json(rows.map(r => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url, reaction: r.reaction })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load likers' })
  }
})

// POST /api/feed/:id/comment — add comment (with optional single media file)
app.post('/api/feed/:id/comment', authenticate, upload.single('media'), async (req, res) => {
  const text = (req.body.text || '').trim()
  if (!text && !req.file) return res.status(400).json({ error: 'Comment text or media required' })
  const postId = parseInt(req.params.id)
  let mediaJson = null
  if (req.file) {
    const header = Buffer.alloc(16)
    const fd = fs.openSync(req.file.path, 'r')
    fs.readSync(fd, header, 0, 16, 0)
    fs.closeSync(fd)
    if (!validateMagicBytes(header, req.file.mimetype)) {
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ error: 'File failed content validation' })
    }
    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
    mediaJson = JSON.stringify([{ url: `/uploads/${req.file.filename}`, type, mime: req.file.mimetype }])
  }
  try {
    try {
      await pool.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en, media) VALUES (?, ?, ?, ?, ?)',
        [postId, req.userId, text, text, mediaJson]
      )
    } catch {
      // media column not yet migrated — insert without it
      await pool.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
        [postId, req.userId, text, text]
      )
    }
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const media = mediaJson ? JSON.parse(mediaJson) : null
    res.json({ author: users[0].name, text: { da: text, en: text }, media })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// DELETE /api/feed/:id — delete own post
app.delete('/api/feed/:id', authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const [rows] = await pool.query('SELECT id FROM posts WHERE id = ? AND author_id = ?', [postId, req.userId])
    if (!rows.length) return res.status(403).json({ error: 'Not your post' })
    await pool.query('DELETE FROM posts WHERE id = ?', [postId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete post' })
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

// POST /api/invites — create individual invitations and send email if SMTP is configured
app.post('/api/invites', authenticate, async (req, res) => {
  const { friends } = req.body
  if (!friends?.length) return res.status(400).json({ error: 'No friends selected' })
  try {
    // Get inviter info and their personal invite link
    const [[inviter]] = await pool.query('SELECT name, invite_token FROM users WHERE id = ?', [req.userId])
    const siteBase = process.env.SITE_URL || 'https://fellis.eu'
    const created = []
    for (const friend of friends) {
      // friend can be a string (email) or object { name, email }
      const email = typeof friend === 'string' ? friend : (friend.email || null)
      const name  = typeof friend === 'string' ? null   : (friend.name  || null)
      const token = crypto.randomBytes(32).toString('hex')
      await pool.query(
        'INSERT INTO invitations (inviter_id, invite_token, invitee_name, invitee_email) VALUES (?, ?, ?, ?)',
        [req.userId, token, name || email, email]
      )
      const inviteUrl = `${siteBase}/?invite=${inviter.invite_token || token}`
      // Send email if SMTP is configured and we have a recipient address
      if (mailer && email) {
        const fromName = inviter.name || 'Fellis'
        const fromAddr = process.env.MAIL_FROM || process.env.MAIL_USER
        await mailer.sendMail({
          from: `"${fromName} via Fellis" <${fromAddr}>`,
          to: email,
          subject: `${inviter.name || 'En ven'} har inviteret dig til Fellis`,
          text: `Hej!\n\n${inviter.name || 'En ven'} vil gerne forbindes med dig på Fellis.\n\nKlik her for at oprette din konto:\n${inviteUrl}\n\nVenlig hilsen,\nFellis`,
          html: `<p>Hej!</p><p><strong>${inviter.name || 'En ven'}</strong> vil gerne forbindes med dig på <strong>Fellis</strong>.</p><p><a href="${inviteUrl}" style="background:#2D6A4F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Opret konto og forbind</a></p><p style="color:#888;font-size:12px">Eller kopier dette link: ${inviteUrl}</p>`,
        }).catch(err => console.error('Mail send error:', err.message))
      }
      created.push({ name: name || email, email, token })
    }
    res.json({ invitations: created, count: created.length, emailSent: !!(mailer) })
  } catch (err) {
    console.error('POST /api/invites error:', err.message)
    res.status(500).json({ error: 'Failed to create invitations' })
  }
})

// DELETE /api/invites/:id — withdraw a sent invitation
app.delete('/api/invites/:id', authenticate, async (req, res) => {
  try {
    const [[inv]] = await pool.query('SELECT inviter_id FROM invitations WHERE id = ?', [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Not found' })
    if (inv.inviter_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM invitations WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/invites error:', err.message)
    res.status(500).json({ error: 'Failed to cancel invitation' })
  }
})

// GET /api/invites — list invitations sent by current user
app.get('/api/invites', authenticate, async (req, res) => {
  try {
    const [invitations] = await pool.query(
      `SELECT i.id, i.invite_token, i.invitee_name, i.invitee_email, i.status, i.created_at,
              u.name as accepted_by_name
       FROM invitations i
       LEFT JOIN users u ON i.accepted_by = u.id
       WHERE i.inviter_id = ? AND i.status != 'accepted' AND (i.invitee_name IS NOT NULL OR i.invitee_email IS NOT NULL)
       ORDER BY i.created_at DESC`,
      [req.userId]
    )
    res.json(invitations.map(i => ({
      id: i.id,
      name: i.invitee_name || i.invitee_email || null,
      email: i.invitee_email || null,
      sentAt: i.created_at,
      status: i.status,
    })))
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

// POST /api/friends/request/:userId — send a connection request
app.post('/api/friends/request/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Invalid user' })
  try {
    const [target] = await pool.query('SELECT id, name FROM users WHERE id = ?', [targetId])
    if (!target.length) return res.status(404).json({ error: 'User not found' })
    // Already friends?
    const [already] = await pool.query('SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?', [req.userId, targetId])
    if (already.length) return res.status(409).json({ error: 'Already friends' })
    // Upsert: reset to pending if previously declined
    await pool.query(
      `INSERT INTO friend_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')
       ON DUPLICATE KEY UPDATE status = 'pending', created_at = CURRENT_TIMESTAMP()`,
      [req.userId, targetId]
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to send request' }) }
})

// GET /api/friends/requests — incoming pending requests + outgoing pending requests
app.get('/api/friends/requests', authenticate, async (req, res) => {
  try {
    const [incoming] = await pool.query(
      `SELECT fr.id, u.id as from_id, u.name as from_name, fr.created_at
       FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
       WHERE fr.to_user_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [req.userId]
    )
    const [outgoing] = await pool.query(
      `SELECT fr.id, u.id as to_id, u.name as to_name, fr.status
       FROM friend_requests fr JOIN users u ON u.id = fr.to_user_id
       WHERE fr.from_user_id = ? AND fr.status = 'pending'`,
      [req.userId]
    )
    res.json({ incoming, outgoing })
  } catch (err) { res.status(500).json({ error: 'Failed to load requests' }) }
})

// POST /api/friends/requests/:id/accept
app.post('/api/friends/requests/:id/accept', authenticate, async (req, res) => {
  const reqId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
      [reqId, req.userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Request not found' })
    const fromId = rows[0].from_user_id
    await pool.query(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`, [reqId])
    await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [req.userId, fromId])
    await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [fromId, req.userId])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to accept request' }) }
})

// POST /api/friends/requests/:id/decline
app.post('/api/friends/requests/:id/decline', authenticate, async (req, res) => {
  const reqId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
      [reqId, req.userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Request not found' })
    await pool.query(`UPDATE friend_requests SET status = 'declined' WHERE id = ?`, [reqId])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to decline request' }) }
})

// DELETE /api/friends/:userId — unfriend (mutual). Optional ?notify=1 sends a message.
app.delete('/api/friends/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Invalid user' })
  const notify = req.query.notify === '1'
  try {
    await pool.query('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.userId, targetId, targetId, req.userId])
    // Clean up any friend_requests between the two users
    await pool.query(
      `DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
      [req.userId, targetId, targetId, req.userId]
    )
    if (notify) {
      // Find or create 1:1 conversation and send a system-like message
      const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
      const [convRows] = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
         JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
         WHERE c.is_group = 0 LIMIT 1`, [req.userId, targetId]
      )
      let convId
      if (convRows.length) {
        convId = convRows[0].id
      } else {
        const [r] = await pool.query('INSERT INTO conversations (is_group, created_by) VALUES (0, ?)', [req.userId])
        convId = r.insertId
        await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
          [convId, req.userId, convId, targetId])
      }
      const msgDa = `${me.name} har fjernet dig som ven.`
      const msgEn = `${me.name} has removed you as a friend.`
      await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, receiver_id, text_da, text_en, time, created_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [convId, req.userId, targetId, msgDa, msgEn]
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to unfriend' }) }
})

// ── Conversation routes ──

// Helper: fetch a full conversation object for the current user
async function getConversationForUser(convId, userId, myName) {
  const [participants] = await pool.query(
    `SELECT u.id, u.name FROM users u
     JOIN conversation_participants cp ON cp.user_id = u.id
     WHERE cp.conversation_id = ?`, [convId])
  const [msgs] = await pool.query(
    `SELECT u.name as from_name, m.text_da, m.text_en, m.time, m.is_read, m.created_at
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 20`, [convId])
  msgs.reverse()
  const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?', [convId])
  const [[conv]] = await pool.query(
    `SELECT c.name, c.is_group, cp.muted_until FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
     WHERE c.id = ?`, [userId, convId])
  const unread = msgs.filter(m => !m.is_read && m.from_name !== myName).length
  const otherParticipant = participants.find(p => p.id !== userId)
  const fallbackName = msgs.find(m => m.from_name !== myName)?.from_name || null
  const displayName = conv.is_group
    ? (conv.name || participants.filter(p => p.id !== userId).map(p => p.name.split(' ')[0]).join(', '))
    : (otherParticipant?.name || fallbackName || 'Ukendt')
  return {
    id: convId,
    name: displayName,
    isGroup: conv.is_group === 1,
    groupName: conv.name,
    participants: participants.map(p => ({ id: p.id, name: p.name })),
    messages: msgs.map(m => ({ from: m.from_name, text: { da: m.text_da, en: m.text_en }, time: m.created_at ? formatMsgTime(m.created_at) : m.time })),
    totalMessages: total,
    unread,
    mutedUntil: conv.muted_until,
  }
}

// GET /api/conversations — all conversations for the current user
app.get('/api/conversations', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const [convRows] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
       ORDER BY (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) DESC,
                c.created_at DESC`, [req.userId])
    const result = []
    for (const { id } of convRows) {
      result.push(await getConversationForUser(id, req.userId, me.name))
    }
    res.json(result)
  } catch (err) {
    console.error('GET /api/conversations error:', err)
    res.status(500).json({ error: 'Failed to load conversations' })
  }
})

// GET /api/conversations/:id/messages/older — paginated older messages
app.get('/api/conversations/:id/messages/older', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  const limit = Math.min(parseInt(req.query.limit) || 20, 50)
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const [msgs] = await pool.query(
      `SELECT u.name as from_name, m.text_da, m.text_en, m.time, m.created_at
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [convId, limit, offset])
    msgs.reverse()
    res.json({ messages: msgs.map(m => ({ from: m.from_name, text: { da: m.text_da, en: m.text_en }, time: m.created_at ? formatMsgTime(m.created_at) : m.time })) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

// POST /api/conversations — create a new 1:1 or group conversation
app.post('/api/conversations', authenticate, async (req, res) => {
  const { participantIds, name, isGroup } = req.body
  if (!participantIds || !Array.isArray(participantIds) || !participantIds.length)
    return res.status(400).json({ error: 'participantIds required' })
  const validIds = participantIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
  if (!validIds.length) return res.status(400).json({ error: 'No valid participant IDs' })
  const allIds = [req.userId, ...validIds.filter(id => id !== req.userId)]
  try {
    // For 1:1: return existing conversation if found
    if (!isGroup && allIds.length === 2) {
      const otherId = allIds.find(id => id !== req.userId)
      const [existing] = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
         JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
         WHERE c.is_group = 0 LIMIT 1`, [req.userId, otherId])
      if (existing.length > 0) return res.json({ id: existing[0].id, exists: true })
    }
    const [r] = await pool.query(
      'INSERT INTO conversations (name, is_group, created_by) VALUES (?, ?, ?)',
      [name || null, isGroup ? 1 : 0, req.userId])
    const convId = r.insertId
    for (const uid of allIds)
      await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid])
    res.json({ id: convId, exists: false })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create conversation' })
  }
})

// POST /api/conversations/:id/messages — send a message
app.post('/api/conversations/:id/messages', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Message text required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const [others] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ? LIMIT 1',
      [convId, req.userId])
    const receiverId = others.length ? others[0].user_id : req.userId
    await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, receiver_id, text_da, text_en, time) VALUES (?, ?, ?, ?, ?, ?)',
      [convId, req.userId, receiverId, text, text, time])
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    res.json({ from: user.name, text: { da: text, en: text }, time: formatMsgTime(now) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// POST /api/conversations/:id/read — mark all messages in conversation as read for current user
app.post('/api/conversations/:id/read', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    await pool.query(
      'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?',
      [convId, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' })
  }
})

// POST /api/conversations/:id/invite — add participants to an existing conversation
app.post('/api/conversations/:id/invite', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { userIds } = req.body
  if (!userIds || !Array.isArray(userIds) || !userIds.length)
    return res.status(400).json({ error: 'userIds required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    for (const uid of userIds)
      await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid])
    // Promote to group if adding to a 1:1
    await pool.query('UPDATE conversations SET is_group = 1 WHERE id = ? AND is_group = 0', [convId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to invite participants' })
  }
})

// POST /api/conversations/:id/mute — mute for N minutes (null to unmute)
app.post('/api/conversations/:id/mute', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { minutes } = req.body
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const mutedUntil = (minutes && minutes > 0) ? new Date(Date.now() + minutes * 60 * 1000) : null
    await pool.query(
      'UPDATE conversation_participants SET muted_until = ? WHERE conversation_id = ? AND user_id = ?',
      [mutedUntil, convId, req.userId])
    res.json({ ok: true, mutedUntil })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mute conversation' })
  }
})

// DELETE /api/conversations/:id/leave — leave a group conversation
app.delete('/api/conversations/:id/leave', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave conversation' })
  }
})

// PATCH /api/conversations/:id — rename a group conversation
app.patch('/api/conversations/:id', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    await pool.query('UPDATE conversations SET name = ? WHERE id = ?', [name, convId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename conversation' })
  }
})

// ── Search ──

// GET /api/posts/:id — fetch a single post (for search result navigation)
app.get('/api/posts/:id', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [posts] = await pool.query(
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              (SELECT reaction FROM post_likes WHERE post_id = p.id AND user_id = ?) as userReaction
       FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      [req.userId, postId]
    )
    if (!posts.length) return res.status(404).json({ error: 'Post not found' })
    const post = posts[0]
    const [comments] = await pool.query(
      `SELECT u.name as author, c.text_da, c.text_en, c.media
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`, [postId]
    )
    const [rxRows] = await pool.query(
      'SELECT reaction, COUNT(*) as count FROM post_likes WHERE post_id = ? GROUP BY reaction', [postId]
    )
    res.json({
      id: post.id, author: post.author, authorId: post.author_id,
      text: { da: post.text_da, en: post.text_en },
      time: { da: post.time_da, en: post.time_en },
      likes: post.likes, liked: !!post.userReaction, userReaction: post.userReaction,
      reactions: Object.fromEntries(rxRows.map(r => [r.reaction, r.count])),
      media: post.media ? JSON.parse(post.media) : null,
      comments: comments.map(c => ({ author: c.author, text: { da: c.text_da, en: c.text_en }, media: c.media ? JSON.parse(c.media) : null })),
    })
  } catch (err) { res.status(500).json({ error: 'Failed to fetch post' }) }
})

// GET /api/users/search?q=... — search all users, includes friendship/request state
app.get('/api/users/search', authenticate, async (req, res) => {
  const { q } = req.query
  if (!q || q.trim().length < 2) return res.json([])
  const like = `%${q.trim()}%`
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_friend,
              COALESCE(f.is_online, 0) as online,
              COALESCE(f.mutual_count, 0) as mutual,
              (SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') as sent_request_id,
              (SELECT id FROM friend_requests WHERE from_user_id = u.id AND to_user_id = ? AND status = 'pending') as received_request_id
       FROM users u
       LEFT JOIN friendships f ON f.friend_id = u.id AND f.user_id = ?
       WHERE u.id != ? AND u.name LIKE ?
       ORDER BY is_friend DESC, u.name
       LIMIT 20`,
      [req.userId, req.userId, req.userId, req.userId, like]
    )
    res.json(users.map(u => ({
      ...u,
      is_friend: !!u.is_friend,
      online: !!u.online,
      sent_request_id: u.sent_request_id || null,
      received_request_id: u.received_request_id || null,
    })))
  } catch (err) { res.status(500).json({ error: 'User search failed' }) }
})

// GET /api/search?q=... — search posts and messages the current user is involved in
// Posts: authored by, liked by, or commented on by the user
// Messages: within conversations the user participates in
app.get('/api/search', authenticate, async (req, res) => {
  const { q } = req.query
  if (!q || q.trim().length < 2) return res.json({ posts: [], messages: [] })
  const like = `%${q.trim()}%`
  const uid = req.userId
  try {
    const [posts] = await pool.query(
      `SELECT DISTINCT p.id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
       LEFT JOIN comments co ON co.post_id = p.id AND co.author_id = ?
       WHERE (p.author_id = ? OR pl.user_id IS NOT NULL OR co.author_id IS NOT NULL)
         AND (p.text_da LIKE ? OR p.text_en LIKE ?)
       ORDER BY p.created_at DESC LIMIT 15`,
      [uid, uid, uid, like, like]
    )
    const [messages] = await pool.query(
      `SELECT m.id, m.conversation_id, u.name as from_name, m.text_da, m.text_en, m.time,
              c.is_group,
              COALESCE(c.name, (
                SELECT u2.name FROM users u2
                JOIN conversation_participants cp2 ON cp2.user_id = u2.id
                WHERE cp2.conversation_id = m.conversation_id AND u2.id != ? LIMIT 1
              )) as conv_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id IS NOT NULL
         AND (m.text_da LIKE ? OR m.text_en LIKE ?)
       ORDER BY m.created_at DESC LIMIT 15`,
      [uid, uid, like, like]
    )
    res.json({
      posts: posts.map(p => ({
        id: p.id,
        author: p.author,
        text: { da: p.text_da, en: p.text_en },
        time: { da: p.time_da, en: p.time_en },
      })),
      messages: messages.map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        convName: m.conv_name || m.from_name,
        isGroup: m.is_group === 1,
        from: m.from_name,
        text: { da: m.text_da, en: m.text_en },
        time: m.time,
      })),
    })
  } catch (err) {
    console.error('Search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ── Link preview proxy ──

function isSafeExternalUrl(urlStr) {
  let parsed
  try { parsed = new URL(urlStr) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost') return false
  if (host === '::1' || host === '[::1]') return false
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1]), parseInt(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
  }
  return true
}

function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}

function extractOgMeta(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m =
    html.match(new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${esc}["']`, 'i'))
  return m ? decodeHTMLEntities(m[1]) : null
}

// GET /api/link-preview?url=... — fetch Open Graph meta for any URL
app.get('/api/link-preview', authenticate, async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })
  if (!isSafeExternalUrl(url)) return res.status(400).json({ error: 'URL not allowed' })
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const response = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'fellis-link-preview/1.0', Accept: 'text/html' },
    })
    clearTimeout(timer)
    if (!response.ok) return res.json({ url })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return res.json({ url })
    const html = (await response.text()).slice(0, 60000) // only need <head>
    const title = extractOgMeta(html, 'og:title') ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null)
    const image = extractOgMeta(html, 'og:image')
    const description = extractOgMeta(html, 'og:description')
    const siteName = extractOgMeta(html, 'og:site_name') || new URL(url).hostname.replace(/^www\./, '')
    res.json({ url, title: title ? decodeHTMLEntities(title) : null, image, description, siteName })
  } catch {
    res.json({ url }) // silently return empty — preview just won't show
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

// ── Background bot activity — bots react to recent posts every few minutes ──
const BOT_HANDLES = ['@anna.bot', '@erik.bot']
const BOT_REACTIONS = ['❤️', '👍', '😄', '😮', '❤️', '👍', '❤️'] // weighted positive
async function runBotActivity() {
  try {
    const [bots] = await pool.query('SELECT id FROM users WHERE handle IN (?)', [BOT_HANDLES])
    if (bots.length === 0) return
    const botIds = bots.map(b => b.id)
    // Recent posts from the last 48 hours not yet liked by any bot
    const [posts] = await pool.query(
      `SELECT p.id FROM posts p
       WHERE p.author_id NOT IN (?) AND p.created_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)
         AND p.id NOT IN (SELECT post_id FROM post_likes WHERE user_id IN (?))
       ORDER BY RAND() LIMIT 5`,
      [botIds, botIds]
    )
    for (const post of posts) {
      for (const bot of bots) {
        if (Math.random() > 0.6) continue // 40% chance each bot reacts
        const reaction = BOT_REACTIONS[Math.floor(Math.random() * BOT_REACTIONS.length)]
        try {
          await pool.query('INSERT IGNORE INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)', [post.id, bot.id, reaction])
        } catch {
          await pool.query('INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)', [post.id, bot.id])
        }
        await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = ?', [post.id])
      }
    }
  } catch {}
}
// Run bot activity every 4 minutes with a 2-minute startup delay
setTimeout(() => {
  runBotActivity()
  setInterval(runBotActivity, 4 * 60 * 1000)
}, 2 * 60 * 1000)

// ── Marketplace ──────────────────────────────────────────────────────────────

async function initMarketplace() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_listings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      price VARCHAR(100) DEFAULT NULL,
      category VARCHAR(100) NOT NULL,
      location VARCHAR(255) DEFAULT NULL,
      description TEXT DEFAULT NULL,
      mobilepay VARCHAR(20) DEFAULT NULL,
      photos JSON DEFAULT NULL,
      boosted_until TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
  } catch (err) {
    console.error('initMarketplace error:', err.message)
  }
}

// MariaDB returns JSON columns as strings — parse them before sending to client
function parseListingPhotos(row) {
  if (!row) return row
  const photos = row.photos
  const base = { ...row, sellerId: row.user_id, seller: row.seller_name || row.seller }
  if (!photos) return { ...base, photos: [] }
  if (Array.isArray(photos)) return base
  try { return { ...base, photos: JSON.parse(photos) } } catch { return { ...base, photos: [] } }
}

app.get('/api/marketplace', authenticate, async (req, res) => {
  try {
    const { q, category, location } = req.query
    let sql = `SELECT l.*, u.name AS seller_name, u.handle AS seller_handle, u.avatar_url AS seller_avatar
               FROM marketplace_listings l JOIN users u ON l.user_id = u.id`
    const params = []
    const where = []
    if (q) { where.push('(l.title LIKE ? OR l.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    if (category) { where.push('l.category = ?'); params.push(category) }
    if (location) { where.push('l.location LIKE ?'); params.push(`%${location}%`) }
    if (where.length) sql += ' WHERE ' + where.join(' AND ')
    sql += ' ORDER BY (l.boosted_until > NOW()) DESC, l.created_at DESC'
    const [rows] = await pool.query(sql, params)
    res.json({ listings: rows.map(parseListingPhotos) })
  } catch (err) {
    console.error('GET /api/marketplace error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/marketplace/mine', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, u.name AS seller_name, u.handle AS seller_handle, u.avatar_url AS seller_avatar
       FROM marketplace_listings l JOIN users u ON l.user_id = u.id
       WHERE l.user_id = ? ORDER BY l.created_at DESC`, [req.userId])
    res.json({ listings: rows.map(parseListingPhotos) })
  } catch (err) {
    console.error('GET /api/marketplace/mine error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/marketplace', authenticate, upload.array('photos', 10), async (req, res) => {
  try {
    const { title, price, priceNegotiable, category, location, description, mobilepay, contact_phone, contact_email } = req.body
    if (!title || !category) return res.status(400).json({ error: 'Missing required fields' })
    const photos = (req.files || []).map(f => ({ url: `/uploads/${f.filename}`, type: 'image', mime: f.mimetype }))
    const [result] = await pool.query(
      `INSERT INTO marketplace_listings (user_id, title, price, priceNegotiable, category, location, description, mobilepay, contact_phone, contact_email, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, title, price || null, priceNegotiable === 'true' ? 1 : 0, category, location || null, description || null, mobilepay || null, contact_phone || null, contact_email || null, photos.length ? JSON.stringify(photos) : null]
    )
    const [[listing]] = await pool.query(
      `SELECT l.*, u.name AS seller_name, u.handle AS seller_handle FROM marketplace_listings l JOIN users u ON l.user_id = u.id WHERE l.id = ?`,
      [result.insertId]
    )
    res.json(parseListingPhotos(listing))
  } catch (err) {
    console.error('POST /api/marketplace error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/marketplace/:id', authenticate, upload.array('photos', 10), async (req, res) => {
  try {
    const { title, price, priceNegotiable, category, location, description, mobilepay, contact_phone, contact_email } = req.body
    console.log(`[PUT /api/marketplace/${req.params.id}] body fields:`, Object.keys(req.body), '| files:', (req.files || []).length)
    if (!title || !category) {
      console.error(`[PUT /api/marketplace/${req.params.id}] Missing required fields – title="${title}" category="${category}"`)
      return res.status(400).json({ error: 'Manglende påkrævede felter (titel/kategori)' })
    }
    const [[existing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    // Merge existing photos (kept by client) with any newly uploaded files
    let existingPhotos = []
    if (req.body.existingPhotos) {
      try { existingPhotos = JSON.parse(req.body.existingPhotos) } catch {}
    }
    const newPhotos = (req.files || []).map(f => ({ url: `/uploads/${f.filename}`, type: 'image', mime: f.mimetype }))
    const allPhotos = [...existingPhotos, ...newPhotos]
    const photosJson = allPhotos.length ? JSON.stringify(allPhotos) : null
    await pool.query(
      `UPDATE marketplace_listings SET title=?, price=?, priceNegotiable=?, category=?, location=?, description=?, mobilepay=?, contact_phone=?, contact_email=?, photos=? WHERE id=?`,
      [title, price || null, priceNegotiable === 'true' ? 1 : 0, category, location || null, description || null, mobilepay || null, contact_phone || null, contact_email || null, photosJson, req.params.id]
    )
    const [[listing]] = await pool.query(
      `SELECT l.*, u.name AS seller_name FROM marketplace_listings l JOIN users u ON l.user_id = u.id WHERE l.id = ?`,
      [req.params.id]
    )
    res.json(parseListingPhotos(listing))
  } catch (err) {
    console.error('PUT /api/marketplace/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/marketplace/:id', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM marketplace_listings WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/marketplace/:id/boost', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    // When Stripe is configured, create a Checkout session here
    // For now: set boosted_until to 7 days from now (free boost for testing)
    await pool.query('UPDATE marketplace_listings SET boosted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?', [req.params.id])
    res.json({ ok: true, boostedUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/marketplace/:id/sold', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE marketplace_listings SET sold = 1 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Companies & Jobs ──────────────────────────────────────────────────────────

async function initCompanies() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS companies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      handle VARCHAR(100) NOT NULL UNIQUE,
      tagline VARCHAR(255) DEFAULT NULL,
      description TEXT DEFAULT NULL,
      industry VARCHAR(100) DEFAULT NULL,
      size VARCHAR(50) DEFAULT NULL,
      website VARCHAR(500) DEFAULT NULL,
      color VARCHAR(20) DEFAULT '#1877F2',
      logo_url VARCHAR(500) DEFAULT NULL,
      followers_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_owner (owner_id),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('owner','admin','editor') NOT NULL DEFAULT 'editor',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_company_user (company_id, user_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_follows (
      company_id INT NOT NULL,
      user_id INT NOT NULL,
      followed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, user_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      author_id INT NOT NULL,
      text_da TEXT NOT NULL,
      text_en TEXT DEFAULT NULL,
      likes INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_company (company_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_post_likes (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      reaction VARCHAR(10) NOT NULL DEFAULT '❤️',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES company_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_post_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      author_id INT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_post (post_id),
      FOREIGN KEY (post_id) REFERENCES company_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      location VARCHAR(255) DEFAULT NULL,
      remote TINYINT(1) NOT NULL DEFAULT 0,
      type ENUM('fulltime','parttime','freelance','internship') NOT NULL DEFAULT 'fulltime',
      description TEXT DEFAULT NULL,
      requirements TEXT DEFAULT NULL,
      apply_link VARCHAR(500) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_company (company_id),
      INDEX idx_active (active),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS job_saves (
      job_id INT NOT NULL,
      user_id INT NOT NULL,
      saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, user_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    // Repair: ensure all companies have their owner in company_members
    // (may be missing if company was created before this table existed)
    await pool.query(`
      INSERT IGNORE INTO company_members (company_id, user_id, role)
      SELECT id, owner_id, 'owner' FROM companies WHERE owner_id > 0
    `)

    // Migrations: add new company profile columns if missing
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cvr VARCHAR(20) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_type VARCHAR(50) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS linkedin VARCHAR(500) DEFAULT NULL`)
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS founded_year SMALLINT DEFAULT NULL`)

    // Migrations: add new job columns if missing
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) DEFAULT NULL`)
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline DATE DEFAULT NULL`)

  } catch (err) {
    console.error('initCompanies error:', err.message)
  }
}

// GET /api/companies — companies the current user owns or follows
app.get('/api/companies', authenticate, async (req, res) => {
  try {
    const [owned] = await pool.query(
      `SELECT c.*, 'owner' AS role, 'owner' AS member_role, 1 AS is_following,
              (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count
       FROM companies c
       JOIN company_members cm ON cm.company_id = c.id AND cm.user_id = ? AND cm.role = 'owner'`,
      [req.userId]
    )
    const [following] = await pool.query(
      `SELECT c.*, 'following' AS role, NULL AS member_role, 1 AS is_following,
              (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count
       FROM companies c
       JOIN company_follows cf ON cf.company_id = c.id AND cf.user_id = ?
       WHERE c.id NOT IN (SELECT company_id FROM company_members WHERE user_id = ? AND role = 'owner')`,
      [req.userId, req.userId]
    )
    res.json({ companies: [...owned, ...following] })
  } catch (err) {
    console.error('GET /api/companies error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/all — discover all companies (with optional search)
app.get('/api/companies/all', authenticate, async (req, res) => {
  try {
    const { q } = req.query
    let sql = `SELECT c.*,
                 (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count,
                 (SELECT COUNT(*) > 0 FROM company_follows WHERE company_id = c.id AND user_id = ?) AS is_following,
                 (SELECT COUNT(*) > 0 FROM company_members WHERE company_id = c.id AND user_id = ? AND role = 'owner') AS is_owner
               FROM companies c`
    const params = [req.userId, req.userId]
    if (q) { sql += ' WHERE c.name LIKE ? OR c.tagline LIKE ? OR c.industry LIKE ?'; params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
    sql += ' ORDER BY followers_count DESC LIMIT 50'
    const [rows] = await pool.query(sql, params)
    res.json({ companies: rows })
  } catch (err) {
    console.error('GET /api/companies/all error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/companies — create a new company
app.post('/api/companies', authenticate, async (req, res) => {
  try {
    const { name, handle, tagline, description, industry, size, website, color,
            cvr, company_type, address, phone, email, linkedin, founded_year } = req.body
    if (!name || !handle) return res.status(400).json({ error: 'name and handle required' })
    const safeHandle = handle.startsWith('@') ? handle : `@${handle}`
    const [result] = await pool.query(
      `INSERT INTO companies (owner_id, name, handle, tagline, description, industry, size, website, color,
         cvr, company_type, address, phone, email, linkedin, founded_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, name, safeHandle, tagline || null, description || null,
        industry || null, size || null, website || null, color || '#1877F2',
        cvr || null, company_type || null, address || null, phone || null,
        email || null, linkedin || null, founded_year || null]
    )
    const companyId = result.insertId
    await pool.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES (?, ?, ?)',
      [companyId, req.userId, 'owner']
    )
    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [companyId])
    res.json({ ...company, role: 'owner', followers_count: 0 })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Handle already taken' })
    console.error('POST /api/companies error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/:id — company details + posts + jobs
app.get('/api/companies/:id', authenticate, async (req, res) => {
  try {
    const [[company]] = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count,
         (SELECT COUNT(*) > 0 FROM company_follows WHERE company_id = c.id AND user_id = ?) AS is_following,
         (SELECT role FROM company_members WHERE company_id = c.id AND user_id = ?) AS member_role
       FROM companies c WHERE c.id = ?`,
      [req.userId, req.userId, req.params.id]
    )
    if (!company) return res.status(404).json({ error: 'Not found' })

    const [posts] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id = ? ORDER BY cp.created_at DESC LIMIT 20`,
      [req.userId, req.params.id]
    )

    const [jobs] = await pool.query(
      `SELECT j.*,
              (SELECT COUNT(*) > 0 FROM job_saves WHERE job_id = j.id AND user_id = ?) AS saved
       FROM jobs j WHERE j.company_id = ? AND j.active = 1 ORDER BY j.created_at DESC`,
      [req.userId, req.params.id]
    )

    res.json({ company, posts, jobs })
  } catch (err) {
    console.error('GET /api/companies/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/companies/:id — update company
app.put('/api/companies/:id', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { name, tagline, description, industry, size, website, color,
            cvr, company_type, address, phone, email, linkedin, founded_year } = req.body
    await pool.query(
      `UPDATE companies SET name=?, tagline=?, description=?, industry=?, size=?, website=?, color=?,
         cvr=?, company_type=?, address=?, phone=?, email=?, linkedin=?, founded_year=? WHERE id=?`,
      [name, tagline || null, description || null, industry || null, size || null, website || null, color || '#1877F2',
       cvr || null, company_type || null, address || null, phone || null,
       email || null, linkedin || null, founded_year || null, req.params.id]
    )
    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.params.id])
    res.json(company)
  } catch (err) {
    console.error('PUT /api/companies/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/companies/:id/follow — follow or unfollow
app.post('/api/companies/:id/follow', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      'SELECT 1 FROM company_follows WHERE company_id = ? AND user_id = ?',
      [req.params.id, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM company_follows WHERE company_id = ? AND user_id = ?', [req.params.id, req.userId])
      res.json({ following: false })
    } else {
      await pool.query('INSERT IGNORE INTO company_follows (company_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ following: true })
    }
  } catch (err) {
    console.error('POST /api/companies/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/:id/members — list of company members with friendship status
app.get('/api/companies/:id/members', authenticate, async (req, res) => {
  try {
    const [members] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url,
              cm.role,
              (SELECT COUNT(*) > 0 FROM friendships WHERE user_id = ? AND friend_id = u.id) AS is_friend,
              (SELECT COUNT(*) > 0 FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') AS request_sent
       FROM company_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = ?
       ORDER BY FIELD(cm.role, 'owner', 'admin', 'editor'), u.name`,
      [req.userId, req.userId, req.params.id]
    )
    res.json({ members })
  } catch (err) {
    console.error('GET /api/companies/:id/members error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/:id/posts — paginated posts
app.get('/api/companies/:id/posts', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const offset = parseInt(req.query.offset) || 0
    const [posts] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id = ? ORDER BY cp.created_at DESC LIMIT ? OFFSET ?`,
      [req.userId, req.params.id, limit, offset]
    )
    res.json({ posts })
  } catch (err) {
    console.error('GET /api/companies/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/companies/:id/posts — create post
app.post('/api/companies/:id/posts', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { text_da, text_en } = req.body
    if (!text_da?.trim()) return res.status(400).json({ error: 'text_da required' })
    const [result] = await pool.query(
      'INSERT INTO company_posts (company_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
      [req.params.id, req.userId, text_da.trim(), (text_en || text_da).trim()]
    )
    const [[post]] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle, 0 AS liked, 0 AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id WHERE cp.id = ?`,
      [result.insertId]
    )
    res.json(post)
  } catch (err) {
    console.error('POST /api/companies/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/companies/:id/posts/:postId/like — like or unlike
app.post('/api/companies/:id/posts/:postId/like', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      'SELECT 1 FROM company_post_likes WHERE post_id = ? AND user_id = ?',
      [req.params.postId, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM company_post_likes WHERE post_id = ? AND user_id = ?', [req.params.postId, req.userId])
      await pool.query('UPDATE company_posts SET likes = GREATEST(likes - 1, 0) WHERE id = ?', [req.params.postId])
      res.json({ liked: false })
    } else {
      const reaction = req.body.reaction || '❤️'
      await pool.query('INSERT IGNORE INTO company_post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)', [req.params.postId, req.userId, reaction])
      await pool.query('UPDATE company_posts SET likes = likes + 1 WHERE id = ?', [req.params.postId])
      res.json({ liked: true })
    }
  } catch (err) {
    console.error('POST company post like error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/:id/posts/:postId/comments — get comments
app.get('/api/companies/:id/posts/:postId/comments', authenticate, async (req, res) => {
  try {
    const [comments] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle
       FROM company_post_comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [req.params.postId]
    )
    res.json({ comments })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/companies/:id/posts/:postId/comments — add comment
app.post('/api/companies/:id/posts/:postId/comments', authenticate, async (req, res) => {
  try {
    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ error: 'text required' })
    const [result] = await pool.query(
      'INSERT INTO company_post_comments (post_id, author_id, text) VALUES (?, ?, ?)',
      [req.params.postId, req.userId, text.trim()]
    )
    const [[comment]] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle
       FROM company_post_comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
      [result.insertId]
    )
    res.json(comment)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs — all active jobs (with optional filters)
app.get('/api/jobs', authenticate, async (req, res) => {
  try {
    const { q, type, remote, company_id } = req.query
    let sql = `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color, c.logo_url AS company_logo,
                 (SELECT COUNT(*) > 0 FROM job_saves WHERE job_id = j.id AND user_id = ?) AS saved
               FROM jobs j JOIN companies c ON c.id = j.company_id
               WHERE j.active = 1`
    const params = [req.userId]
    if (q) { sql += ' AND (j.title LIKE ? OR j.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`) }
    if (type) { sql += ' AND j.type = ?'; params.push(type) }
    if (remote === '1') { sql += ' AND j.remote = 1' }
    if (company_id) { sql += ' AND j.company_id = ?'; params.push(company_id) }
    sql += ' ORDER BY j.created_at DESC LIMIT 50'
    const [rows] = await pool.query(sql, params)
    res.json({ jobs: rows })
  } catch (err) {
    console.error('GET /api/jobs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs/saved — jobs the user has saved
app.get('/api/jobs/saved', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              1 AS saved
       FROM jobs j JOIN companies c ON c.id = j.company_id
       JOIN job_saves js ON js.job_id = j.id AND js.user_id = ?
       ORDER BY js.saved_at DESC`,
      [req.userId]
    )
    res.json({ jobs: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/jobs — create job (must be company member)
app.post('/api/jobs', authenticate, async (req, res) => {
  try {
    const { company_id, title, location, remote, type, description, requirements, apply_link, contact_email, deadline } = req.body
    if (!company_id || !title) return res.status(400).json({ error: 'company_id and title required' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [result] = await pool.query(
      `INSERT INTO jobs (company_id, title, location, remote, type, description, requirements, apply_link, contact_email, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_id, title, location || null, remote ? 1 : 0,
        type || 'fulltime', description || null, requirements || null,
        apply_link || null, contact_email || null, deadline || null]
    )
    const [[job]] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.color AS company_color, 0 AS saved
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
      [result.insertId]
    )
    res.json(job)
  } catch (err) {
    console.error('POST /api/jobs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/jobs/:id — update job
app.put('/api/jobs/:id', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { title, location, remote, type, description, requirements, apply_link, active, contact_email, deadline } = req.body
    await pool.query(
      'UPDATE jobs SET title=?, location=?, remote=?, type=?, description=?, requirements=?, apply_link=?, active=?, contact_email=?, deadline=? WHERE id=?',
      [title, location || null, remote ? 1 : 0, type || 'fulltime',
        description || null, requirements || null, apply_link || null,
        active !== undefined ? (active ? 1 : 0) : 1,
        contact_email || null, deadline || null, req.params.id]
    )
    const [[updated]] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.color AS company_color FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
      [req.params.id]
    )
    res.json(updated)
  } catch (err) {
    console.error('PUT /api/jobs/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/jobs/:id — delete (close) job
app.delete('/api/jobs/:id', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE jobs SET active = 0 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/jobs/:id/save — save or unsave job
app.post('/api/jobs/:id/save', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT 1 FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
    if (existing) {
      await pool.query('DELETE FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
      res.json({ saved: false })
    } else {
      await pool.query('INSERT IGNORE INTO job_saves (job_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ saved: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Admin settings ──────────────────────────────────────────────────────────

async function initAdminSettings() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_settings (
      key_name VARCHAR(100) NOT NULL PRIMARY KEY,
      key_value TEXT DEFAULT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
  } catch (err) {
    console.error('initAdminSettings error:', err.message)
  }
}

async function initSettingsSchema() {
  try {
    // Add user_agent and ip_address to sessions for session list display
    await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) DEFAULT NULL`)
    await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50) DEFAULT NULL`)
    await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)

    // Privacy settings columns on users
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility ENUM('all','friends') NOT NULL DEFAULT 'all'`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_request_privacy ENUM('all','friends_of_friends') NOT NULL DEFAULT 'all'`)

    // Skills tables
    await pool.query(`CREATE TABLE IF NOT EXISTS user_skills (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      display_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_skill (user_id, name),
      INDEX idx_us_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS skill_endorsements (
      skill_id INT NOT NULL,
      endorser_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (skill_id, endorser_id),
      FOREIGN KEY (skill_id) REFERENCES user_skills(id) ON DELETE CASCADE,
      FOREIGN KEY (endorser_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)

  } catch (err) {
    console.error('initSettingsSchema error:', err.message)
  }
}

async function initAnalytics() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      viewer_id INT NOT NULL,
      profile_id INT NOT NULL,
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pv_profile (profile_id, viewed_at),
      INDEX idx_pv_viewer (viewer_id),
      FOREIGN KEY (profile_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`)
  } catch (err) {
    console.error('initAnalytics error:', err.message)
  }
}

function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Not authenticated' })
  if (req.userId !== 1) return res.status(403).json({ error: 'Admin only' })
  next()
}

// GET /api/analytics — per-user analytics (real data from DB)
app.get('/api/analytics', authenticate, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90)

    // Profile views per day (sparse rows — gaps filled client-side)
    const [viewRows] = await pool.query(
      `SELECT DATE(viewed_at) as date, COUNT(*) as count
       FROM profile_views
       WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(viewed_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // New connections per day
    const [connRows] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM friendships
       WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // Top posts by engagement (likes + comments)
    const [topPosts] = await pool.query(
      `SELECT p.id,
              SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 60) as text,
              p.likes,
              COUNT(DISTINCT c.id) as comment_count,
              (p.likes + COUNT(DISTINCT c.id)) as engagement
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY p.id ORDER BY engagement DESC LIMIT 5`,
      [req.userId]
    )

    // Engagement received in period
    const [[engStats]] = await pool.query(
      `SELECT COALESCE(SUM(p.likes), 0) as likes_received,
              COUNT(DISTINCT c.id) as comments_received,
              COUNT(DISTINCT p.id) as post_count
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
         AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       WHERE p.author_id = ? AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days, req.userId, days]
    )

    // Engagement trend per day (comments on user's posts)
    const [engTrendRows] = await pool.query(
      `SELECT DATE(c.created_at) as date, COUNT(*) as count
       FROM comments c JOIN posts p ON c.post_id = p.id
       WHERE p.author_id = ? AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(c.created_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // Funnel: profile views → friend requests received → new connections
    const [[funnel]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM profile_views WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as views,
        (SELECT COUNT(*) FROM friend_requests WHERE to_user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as requests,
        (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as connections`,
      [req.userId, days, req.userId, days, req.userId, days]
    )

    // Total connections
    const [[{ total_connections }]] = await pool.query(
      'SELECT COUNT(*) as total_connections FROM friendships WHERE user_id = ?',
      [req.userId]
    )

    // Post type split: text-only vs with-media
    const [[postTypes]] = await pool.query(
      `SELECT
        SUM(CASE WHEN media IS NULL OR media = '[]' THEN 1 ELSE 0 END) as text_count,
        SUM(CASE WHEN media IS NOT NULL AND media != '[]' THEN 1 ELSE 0 END) as media_count
       FROM posts WHERE author_id = ?`,
      [req.userId]
    )

    res.json({
      days,
      views: viewRows,
      connections: connRows,
      topPosts: topPosts.map(p => ({
        label: (p.text || '').trim().slice(0, 50) || `Post #${p.id}`,
        value: Number(p.engagement),
      })),
      engagement: {
        likes: Number(engStats.likes_received),
        comments: Number(engStats.comments_received),
        posts: Number(engStats.post_count),
      },
      engTrend: engTrendRows,
      funnel: { views: Number(funnel.views), requests: Number(funnel.requests), connections: Number(funnel.connections) },
      totalConnections: Number(total_connections),
      postTypes: { text: Number(postTypes.text_count || 0), media: Number(postTypes.media_count || 0) },
    })
  } catch (err) {
    console.error('GET /api/analytics error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/settings — get Stripe config (admin only)
app.get('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT key_name, key_value FROM admin_settings')
    const settings = {}
    for (const row of rows) settings[row.key_name] = row.key_value
    // Mask secrets — return only whether they are set, not the actual values
    const masked = {}
    for (const [k, v] of Object.entries(settings)) {
      masked[k] = v ? (k.includes('secret') || k.includes('Secret') ? '••••••••' + v.slice(-4) : v) : ''
    }
    res.json({ settings: masked })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' })
  }
})

// POST /api/admin/settings — save Stripe config (admin only)
app.post('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['stripe_secret_key', 'stripe_pub_key', 'stripe_webhook_secret', 'stripe_price_pro_monthly', 'stripe_price_pro_yearly', 'stripe_price_boost', 'pwd_min_length', 'pwd_require_uppercase', 'pwd_require_lowercase', 'pwd_require_numbers', 'pwd_require_symbols']
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue
      // pwd_ keys are always saved (value can be '0'); skip only masked/empty Stripe secrets
      if (!key.startsWith('pwd_')) {
        if (!value || value === '••••••••' + (value || '').slice(-4)) continue // skip masked/empty
      }
      await pool.query('INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', [key, value])
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' })
  }
})

// GET /api/admin/stats — platform statistics (admin only)
app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[{ users }]] = await pool.query('SELECT COUNT(*) as users FROM users')
    const [[{ active_users }]] = await pool.query("SELECT COUNT(DISTINCT user_id) as active_users FROM sessions WHERE expires_at > NOW()")
    const [[{ posts }]] = await pool.query('SELECT COUNT(*) as posts FROM posts')
    const [[{ events }]] = await pool.query('SELECT COUNT(*) as events FROM events').catch(() => [[{ events: 0 }]])
    const [[{ listings }]] = await pool.query('SELECT COUNT(*) as listings FROM marketplace_listings WHERE sold = 0').catch(() => [[{ listings: 0 }]])
    const [[{ friendships }]] = await pool.query('SELECT COUNT(*) as friendships FROM friendships')
    const [[{ messages }]] = await pool.query('SELECT COUNT(*) as messages FROM messages')
    const [[{ new_users_7d }]] = await pool.query("SELECT COUNT(*) as new_users_7d FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)").catch(() => [[{ new_users_7d: 0 }]])
    const [[{ rsvps }]] = await pool.query("SELECT COUNT(*) as rsvps FROM event_rsvps WHERE status = 'going'").catch(() => [[{ rsvps: 0 }]])
    const [[{ users_privat }]] = await pool.query("SELECT COUNT(*) as users_privat FROM users WHERE mode = 'privat' OR mode IS NULL").catch(() => [[{ users_privat: 0 }]])
    const [[{ users_business }]] = await pool.query("SELECT COUNT(*) as users_business FROM users WHERE mode = 'business'").catch(() => [[{ users_business: 0 }]])
    const [[{ posts_business }]] = await pool.query("SELECT COUNT(*) as posts_business FROM posts p JOIN users u ON u.id = p.author_id WHERE u.mode = 'business'").catch(() => [[{ posts_business: 0 }]])
    const [[{ new_business_7d }]] = await pool.query("SELECT COUNT(*) as new_business_7d FROM users WHERE mode = 'business' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)").catch(() => [[{ new_business_7d: 0 }]])
    const [[{ active_business }]] = await pool.query("SELECT COUNT(DISTINCT s.user_id) as active_business FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.mode = 'business' AND s.expires_at > NOW()").catch(() => [[{ active_business: 0 }]])
    res.json({ users, active_users, posts, events, listings, friendships, messages, new_users_7d, rsvps, users_privat, users_business, posts_business, new_business_7d, active_business })
  } catch (err) {
    console.error('GET /api/admin/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/feed-weights — get current feed algorithm weights
app.get('/api/admin/feed-weights', authenticate, requireAdmin, async (req, res) => {
  const weights = await getFeedWeights()
  res.json({ weights })
})

// POST /api/admin/feed-weights — update feed algorithm weights
app.post('/api/admin/feed-weights', authenticate, requireAdmin, async (req, res) => {
  const { family, interest, recency } = req.body
  const entries = [['feed_weight_family', family], ['feed_weight_interest', interest], ['feed_weight_recency', recency]]
  try {
    for (const [key, value] of entries) {
      if (typeof value !== 'number' || value < 0) continue
      await pool.query(
        'INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)',
        [key, String(value)]
      )
    }
    _feedWeightsCache = null // invalidate cache so next feed request picks up new weights
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save feed weights' })
  }
})

// GET /api/admin/interest-stats — interest adoption statistics
app.get('/api/admin/interest-stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT interests FROM users WHERE interests IS NOT NULL')
    let withInterests = 0
    const counts = {}
    for (const row of rows) {
      let interests = []
      try { interests = typeof row.interests === 'string' ? JSON.parse(row.interests) : (row.interests || []) } catch {}
      if (interests.length >= 3) withInterests++
      for (const i of interests) counts[i] = (counts[i] || 0) + 1
    }
    const topInterests = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }))
    res.json({ withInterests, total: rows.length, topInterests })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load interest stats' })
  }
})

// ── Events API ──

// GET /api/events — list all events with RSVP counts and current user's RSVP
app.get('/api/events', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, u.name AS organizer_name,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'maybe') AS maybe_count,
        (SELECT GROUP_CONCAT(u2.name ORDER BY r2.created_at SEPARATOR ',')
          FROM event_rsvps r2 JOIN users u2 ON r2.user_id = u2.id
          WHERE r2.event_id = e.id AND r2.status = 'going') AS going_names,
        (SELECT GROUP_CONCAT(u3.name ORDER BY r3.created_at SEPARATOR ',')
          FROM event_rsvps r3 JOIN users u3 ON r3.user_id = u3.id
          WHERE r3.event_id = e.id AND r3.status = 'maybe') AS maybe_names,
        (SELECT r4.status FROM event_rsvps r4 WHERE r4.event_id = e.id AND r4.user_id = ?) AS my_rsvp
       FROM events e JOIN users u ON e.organizer_id = u.id
       ORDER BY e.date ASC`,
      [req.userId]
    )
    const events = rows.map(e => ({
      id: e.id,
      title: e.title,
      description: e.description,
      date: e.date,
      location: e.location,
      organizer: e.organizer_name,
      organizerId: e.organizer_id,
      eventType: e.event_type,
      ticketUrl: e.ticket_url,
      cap: e.cap,
      going: e.going_names ? e.going_names.split(',') : [],
      maybe: e.maybe_names ? e.maybe_names.split(',') : [],
      myRsvp: e.my_rsvp || null,
    }))
    res.json({ events })
  } catch (err) {
    console.error('GET /api/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/events — create event
app.post('/api/events', authenticate, async (req, res) => {
  try {
    const { title, description, date, location, eventType, ticketUrl, cap } = req.body
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' })
    const [result] = await pool.query(
      `INSERT INTO events (organizer_id, title, description, date, location, event_type, ticket_url, cap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, title, description || null, date, location || null, eventType || null, ticketUrl || null, cap || null]
    )
    const [[event]] = await pool.query(
      `SELECT e.*, u.name AS organizer_name FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = ?`,
      [result.insertId]
    )
    res.json({
      id: event.id, title: event.title, description: event.description,
      date: event.date, location: event.location, organizer: event.organizer_name,
      organizerId: event.organizer_id, eventType: event.event_type,
      ticketUrl: event.ticket_url, cap: event.cap, going: [], maybe: [], myRsvp: null,
    })
  } catch (err) {
    console.error('POST /api/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/events/:id/rsvp — set RSVP for current user
app.put('/api/events/:id/rsvp', authenticate, async (req, res) => {
  try {
    const { status, dietary, plusOne } = req.body
    const [[event]] = await pool.query('SELECT id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (status === null || status === undefined) {
      await pool.query('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, req.userId])
    } else {
      await pool.query(
        `INSERT INTO event_rsvps (event_id, user_id, status, dietary, plus_one) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), dietary = VALUES(dietary), plus_one = VALUES(plus_one)`,
        [req.params.id, req.userId, status, dietary || null, plusOne ? 1 : 0]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/events/:id/rsvp error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── User settings ──

// GET /api/me/sessions — list active sessions for the current user
app.get('/api/me/sessions', authenticate, async (req, res) => {
  const currentSessionId = getSessionIdFromRequest(req)
  try {
    const [sessions] = await pool.query(
      'SELECT id, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    )
    res.json(sessions.map(s => ({
      id: s.id,
      isCurrent: s.id === currentSessionId,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
    })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// DELETE /api/me/sessions/others — revoke all sessions except current
app.delete('/api/me/sessions/others', authenticate, async (req, res) => {
  const currentSessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.userId, currentSessionId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke sessions' })
  }
})

// DELETE /api/me/sessions/:id — revoke a specific session
app.delete('/api/me/sessions/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke session' })
  }
})

// POST /api/me/email — change email address
app.post('/api/me/email', authenticate, async (req, res) => {
  const { email } = req.body
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' })
  try {
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [email.trim().toLowerCase(), req.userId])
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in use' })
    res.status(500).json({ error: 'Failed to update email' })
  }
})

// GET /api/me/privacy — get privacy settings
app.get('/api/me/privacy', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT profile_visibility, friend_requests_from FROM users WHERE id = ?',
      [req.userId]
    )
    if (!users.length) return res.status(404).json({ error: 'User not found' })
    res.json({
      profile_visibility: users[0].profile_visibility || 'all',
      friend_requests_from: users[0].friend_requests_from || 'all',
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch privacy settings' })
  }
})

// PATCH /api/me/privacy — update privacy settings
app.patch('/api/me/privacy', authenticate, async (req, res) => {
  const { profile_visibility, friend_requests_from } = req.body
  const validVis = ['all', 'friends']
  const validReq = ['all', 'fof']
  if (profile_visibility && !validVis.includes(profile_visibility)) return res.status(400).json({ error: 'Invalid visibility' })
  if (friend_requests_from && !validReq.includes(friend_requests_from)) return res.status(400).json({ error: 'Invalid friend_requests_from' })
  try {
    const updates = []
    const vals = []
    if (profile_visibility) { updates.push('profile_visibility = ?'); vals.push(profile_visibility) }
    if (friend_requests_from) { updates.push('friend_requests_from = ?'); vals.push(friend_requests_from) }
    if (updates.length) {
      vals.push(req.userId)
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update privacy settings' })
  }
})

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error(`[multer error] ${req.method} ${req.path}: ${err.code} – ${err.message}`)
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 50 MB)' })
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 4)' })
    return res.status(400).json({ error: err.message })
  }
  if (err) {
    console.error(`[middleware error] ${req.method} ${req.path}: ${err.message}`)
    return res.status(400).json({ error: err.message })
  }
  next()
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`fellis.eu API running on http://localhost:${PORT}`)
  if (!FB_TOKEN_KEY) {
    console.warn('⚠️  WARNING: FB_TOKEN_ENCRYPTION_KEY not set. Facebook tokens will be stored unencrypted.')
    console.warn('   Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
  initEvents()
  initFriendRequests()
  initConversations()
  initMarketplace()
  initCompanies()
  initAdminSettings()
  initAnalytics()
  initSettingsSchema()
})
