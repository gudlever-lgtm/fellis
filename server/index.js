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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Migrate: add columns that may be missing on existing installations
    await pool.query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS dietary VARCHAR(255) DEFAULT NULL`).catch(() => {})
    await pool.query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS plus_one TINYINT(1) DEFAULT 0`).catch(() => {})
  } catch (err) {
    console.error('initEvents error:', err.message)
  }
}

// ── In-memory rate limiter (invite anti-abuse) ──
// Tracks {userId → {count, resetAt}} — resets every 15 minutes per user
const inviteRateLimit = new Map()
const INVITE_MAX_PER_WINDOW = 20   // max invites per 15-min window
const INVITE_WINDOW_MS = 15 * 60 * 1000

function checkInviteRateLimit(userId) {
  const now = Date.now()
  const entry = inviteRateLimit.get(userId)
  if (!entry || now > entry.resetAt) {
    inviteRateLimit.set(userId, { count: 1, resetAt: now + INVITE_WINDOW_MS })
    return true
  }
  if (entry.count >= INVITE_MAX_PER_WINDOW) return false
  entry.count++
  return true
}

// ── Viral growth: badge award helper ──
const BADGE_THRESHOLDS = [
  { type: 'first_invite',   threshold: 1  },
  { type: 'five_invites',   threshold: 5  },
  { type: 'ten_invites',    threshold: 10 },
  { type: 'twenty_invites', threshold: 20 },
  { type: 'fifty_invites',  threshold: 50 },
]

async function checkAndAwardBadges(userId) {
  try {
    const [[user]] = await pool.query('SELECT referral_count FROM users WHERE id = ?', [userId])
    if (!user) return []
    const count = user.referral_count
    const earned = []
    for (const badge of BADGE_THRESHOLDS) {
      if (count >= badge.threshold) {
        const [result] = await pool.query(
          'INSERT IGNORE INTO user_badges (user_id, reward_type) VALUES (?, ?)',
          [userId, badge.type]
        )
        if (result.affectedRows > 0) {
          earned.push(badge.type)
          // Add reputation points
          await pool.query(
            'UPDATE users u JOIN rewards r ON r.type = ? SET u.reputation_score = u.reputation_score + r.reward_points WHERE u.id = ?',
            [badge.type, userId]
          )
        }
      }
    }
    return earned
  } catch (err) {
    console.error('checkAndAwardBadges error:', err.message)
    return []
  }
}

// ── Viral growth: schema init ──
async function initViralGrowth() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS referrals (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      referrer_id INT(11) NOT NULL,
      referred_id INT(11) NOT NULL,
      invitation_id INT(11) DEFAULT NULL,
      invite_source ENUM('link','email','facebook','other') DEFAULT 'link',
      utm_source VARCHAR(100) DEFAULT NULL,
      utm_campaign VARCHAR(100) DEFAULT NULL,
      converted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      UNIQUE KEY unique_referral (referrer_id, referred_id),
      FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS rewards (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(50) NOT NULL UNIQUE,
      title_da VARCHAR(200) NOT NULL,
      title_en VARCHAR(200) NOT NULL,
      description_da TEXT NOT NULL,
      description_en TEXT NOT NULL,
      icon VARCHAR(10) NOT NULL DEFAULT '🏆',
      threshold INT(11) NOT NULL DEFAULT 1,
      reward_points INT(11) NOT NULL DEFAULT 10
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS user_badges (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      reward_type VARCHAR(50) NOT NULL,
      earned_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      UNIQUE KEY unique_user_badge (user_id, reward_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS share_events (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) DEFAULT NULL,
      share_type ENUM('post','profile','invite') NOT NULL DEFAULT 'invite',
      target_id INT(11) DEFAULT NULL,
      platform VARCHAR(50) DEFAULT NULL,
      utm_campaign VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // Seed reward catalog (idempotent via INSERT IGNORE)
    await pool.query(`INSERT IGNORE INTO rewards (type, title_da, title_en, description_da, description_en, icon, threshold, reward_points) VALUES
      ('first_invite',    'Første invitation',  'First Invite',       'Du har inviteret din første ven til fellis.eu',       'You invited your first friend to fellis.eu',       '🌱', 1,  10),
      ('five_invites',    'Social ambassadør',  'Social Ambassador',  'Du har fået 5 venner til at tilmelde sig fellis.eu',  '5 friends joined fellis.eu through your invite',  '🌟', 5,  50),
      ('ten_invites',     'Fellis-mester',      'Fellis Master',      'Du har fået 10 venner til at tilmelde sig fellis.eu', '10 friends joined fellis.eu through your invite', '🏆', 10, 100),
      ('twenty_invites',  'Vækst-champion',     'Growth Champion',    'Utroligt — 20 venner har tilmeldt sig via dig!',      'Incredible — 20 friends joined via your invite!', '🚀', 20, 250),
      ('fifty_invites',   'Fellis-legende',     'Fellis Legend',      'Du er en legende — 50 tilmeldinger via dig!',        'You are a legend — 50 sign-ups via your invite!', '👑', 50, 1000)`)
  } catch (err) {
    console.error('initViralGrowth error:', err.message)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id INT(11) NOT NULL,
      user_id INT(11) NOT NULL,
      muted_until DATETIME DEFAULT NULL,
      joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
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

// ── SSE: real-time push to connected clients ──────────────────────────────
// Map<userId, Set<res>> — one user may have multiple tabs open
const sseClients = new Map()

function sseAdd(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set())
  sseClients.get(userId).add(res)
}
function sseRemove(userId, res) {
  sseClients.get(userId)?.delete(res)
}
function sseBroadcast(userId, data) {
  const clients = sseClients.get(userId)
  if (!clients || clients.size === 0) return
  const payload = `data: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try { res.write(payload) } catch { sseRemove(userId, res) }
  }
}

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
  // Header takes priority, then cookie, then query param (for SSE/EventSource).
  // Guard against the literal strings "null"/"undefined" that JS sends when the
  // client calls fetch with headers: { 'X-Session-Id': null }.
  const fromHeader = req.headers['x-session-id']
  if (fromHeader && fromHeader !== 'null' && fromHeader !== 'undefined') return fromHeader
  // Parse cookie manually
  const cookies = req.headers.cookie
  if (cookies) {
    const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE_NAME + '='))
    if (match) return match.split('=')[1]
  }
  // Query param fallback — used by EventSource (cannot set custom headers)
  const fromQuery = req.query.sid
  if (fromQuery && fromQuery !== 'null' && fromQuery !== 'undefined') return fromQuery
  return null
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
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_free TINYINT(1) NOT NULL DEFAULT 0")
  .catch(err => console.error('Migration (users.ads_free):', err.message))
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100) DEFAULT NULL")
  .catch(err => console.error('Migration (users.stripe_customer_id):', err.message))
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_free_sub_id VARCHAR(200) DEFAULT NULL")
  .catch(err => console.error('Migration (users.ads_free_sub_id):', err.message))

// ── Viral growth auto-migrations ──
pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.profile_public):', err.message))
pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_score INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.reputation_score):', err.message))
pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.referral_count):', err.message))
pool.query("ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invite_source ENUM('link','email','facebook','other') DEFAULT 'link'")
  .catch(err => console.error('Migration (invitations.invite_source):', err.message))
pool.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.utm_source):', err.message))
pool.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.utm_campaign):', err.message))
pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) DEFAULT NULL')
  .catch(err => console.error('Migration (posts.share_token):', err.message))
pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_public TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (posts.is_public):', err.message))
pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_count INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (posts.share_count):', err.message))

// ── Group suggestions auto-migrations ──
pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_public TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (conversations.is_public):', err.message))
pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.category):', err.message))
pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description_da TEXT DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.description_da):', err.message))
pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description_en TEXT DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.description_en):', err.message))

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

// ── Browser / OS parsing ──────────────────────────────────────────────────
function parseBrowser(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' }
  let browser = 'Other'
  if (/Edg\/|Edge\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera\//.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'
  else if (/MSIE|Trident/.test(ua)) browser = 'IE'
  let os = 'Other'
  if (/Windows/.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Macintosh|Mac OS/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  return { browser, os }
}

// ── Geo IP lookup (ip-api.com, free tier, cached) ───────────────────────
const geoCache = new Map()
async function getGeoForIp(ip) {
  if (!ip) return { country: null, country_code: null, city: null }
  const clean = ip.replace(/^::ffff:/, '')
  if (clean === '127.0.0.1' || clean === '::1' || clean.startsWith('192.168.') || clean.startsWith('10.') || clean.startsWith('172.'))
    return { country: 'Lokal', country_code: 'XX', city: 'Lokal' }
  if (geoCache.has(clean)) return geoCache.get(clean)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    const r = await fetch(`http://ip-api.com/json/${clean}?fields=status,country,countryCode,city`, { signal: ctrl.signal })
    clearTimeout(timer)
    const d = await r.json()
    if (d.status === 'success') {
      const result = { country: d.country, country_code: d.countryCode, city: d.city }
      geoCache.set(clean, result)
      return result
    }
  } catch {}
  return { country: null, country_code: null, city: null }
}

// ── Auth middleware ──
const visitedSessions = new Set() // in-memory: sessions tracked this server process day
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
    // Check if account is banned or suspended
    const [statusRows] = await pool.query(
      'SELECT status, suspended_until, is_moderator FROM users WHERE id = ?', [req.userId]
    ).catch(() => pool.query('SELECT status, suspended_until FROM users WHERE id = ?', [req.userId]))
    if (statusRows.length > 0) {
      req.isModerator = Boolean(statusRows[0].is_moderator) || req.userId === 1
      const { status: userStatus, suspended_until } = statusRows[0]
      if (userStatus === 'banned') return res.status(403).json({ error: 'Account banned' })
      if (userStatus === 'suspended' && suspended_until && new Date(suspended_until) > new Date()) {
        return res.status(403).json({ error: 'Account suspended', suspended_until })
      }
      // Auto-lift expired suspensions
      if (userStatus === 'suspended' && (!suspended_until || new Date(suspended_until) <= new Date())) {
        pool.query('UPDATE users SET status = "active", suspended_until = NULL WHERE id = ?', [req.userId]).catch(() => {})
      }
    }

    // Track site visit once per session per calendar day
    const todayKey = `${sessionId}:${new Date().toISOString().slice(0, 10)}`
    if (!visitedSessions.has(todayKey)) {
      visitedSessions.add(todayKey)
      const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
      const ua = req.headers['user-agent'] || null
      const { browser, os } = parseBrowser(ua)
      // Async geo lookup — don't await, fire-and-forget
      getGeoForIp(ip).then(geo => {
        pool.query(
          `INSERT INTO site_visits (session_id, ip_address, user_agent, browser, os, country, country_code, city)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, ip || null, ua, browser, os, geo.country, geo.country_code, geo.city]
        ).catch(() => {})
      }).catch(() => {})
    }

    next()
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// ── Public visit tracking ─────────────────────────────────────────────────────
// Tracks visits from all users (including unauthenticated) once per IP per day.
// Called by the frontend on app load so the visitors dashboard always has data.
const visitedAnonIps = new Set() // in-memory: anonymous IPs tracked this server process day
app.post('/api/visit', async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    const today = new Date().toISOString().slice(0, 10)
    const key = `${ip}:${today}`
    if (ip && !visitedAnonIps.has(key)) {
      visitedAnonIps.add(key)
      const ua = req.headers['user-agent'] || null
      const { browser, os } = parseBrowser(ua)
      const sessionId = getSessionIdFromRequest(req) || `anon:${ip}`
      getGeoForIp(ip).then(geo => {
        pool.query(
          `INSERT INTO site_visits (session_id, ip_address, user_agent, browser, os, country, country_code, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, ip || null, ua, browser, os, geo.country, geo.country_code, geo.city]
        ).catch(() => {})
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

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

    // If registered via invite link, auto-connect with inviter + record referral
    if (inviteToken) {
      try {
        let referrerId = null
        let invitationId = null
        let inviteSource = 'link'

        // Check personal invite token (user.invite_token)
        const [inviter] = await pool.query('SELECT id FROM users WHERE invite_token = ?', [inviteToken])
        if (inviter.length > 0) {
          referrerId = inviter[0].id
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, referrerId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [referrerId, newUserId])
        }

        // Check per-email invitation token
        const [invitation] = await pool.query(
          'SELECT id, inviter_id, invite_source FROM invitations WHERE invite_token = ? AND status = ?',
          [inviteToken, 'pending']
        )
        if (invitation.length > 0) {
          referrerId = invitation[0].inviter_id
          invitationId = invitation[0].id
          inviteSource = invitation[0].invite_source || 'email'
          await pool.query('UPDATE invitations SET status = ?, accepted_by = ? WHERE id = ?', ['accepted', newUserId, invitationId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, referrerId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [referrerId, newUserId])
        }

        // Record referral and award badges to inviter
        if (referrerId) {
          await pool.query(
            'INSERT IGNORE INTO referrals (referrer_id, referred_id, invitation_id, invite_source) VALUES (?, ?, ?, ?)',
            [referrerId, newUserId, invitationId, inviteSource]
          )
          await pool.query('UPDATE users SET referral_count = referral_count + 1 WHERE id = ?', [referrerId])
          await checkAndAwardBadges(referrerId)
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
    const [users] = await pool.query('SELECT id, name, handle, initials, avatar_url, plan, mode, ads_free, is_moderator FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = { ...users[0], plan: users[0].plan || 'business', mode: users[0].mode || 'privat', ads_free: Boolean(users[0].ads_free), is_admin: users[0].id === 1, is_moderator: Boolean(users[0].is_moderator) || users[0].id === 1 }
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
        u.email, u.facebook_id, u.password_hash, u.password_plain, u.created_at, u.birthday,
        u.profile_public, u.reputation_score, u.referral_count, u.interests,
        (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
       FROM users u WHERE u.id = ?`,
      [req.userId]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    let interests = []
    try { interests = typeof u.interests === 'string' ? JSON.parse(u.interests) : (u.interests || []) } catch {}
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
      birthday: u.birthday || null,
      profile_public: !!u.profile_public,
      reputationScore: Number(u.reputation_score || 0),
      referralCount: Number(u.referral_count || 0),
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

// PATCH /api/me/lang — update current session language
app.patch('/api/me/lang', authenticate, async (req, res) => {
  const { lang } = req.body
  if (!['da', 'en'].includes(lang)) return res.status(400).json({ error: 'Invalid lang' })
  const sessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('UPDATE sessions SET lang = ? WHERE id = ?', [lang, sessionId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lang' })
  }
})

// PATCH /api/me/plan — update user plan (business only — business_pro removed)
app.patch('/api/me/plan', authenticate, async (req, res) => {
  const { plan } = req.body
  if (!['business'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' })
  try {
    await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' })
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

// PATCH /api/profile/password — change password (or set first password for imported users)
app.patch('/api/profile/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword, lang: chgLang } = req.body
  if (!newPassword) return res.status(400).json({ error: 'newPassword required' })
  const chgPolicy = await getPasswordPolicy()
  const chgPwdErrors = validatePasswordStrength(newPassword, chgPolicy, chgLang || 'da')
  if (chgPwdErrors.length > 0) return res.status(400).json({ error: chgPwdErrors.join('. ') })
  try {
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    // If user has no password yet (imported from Facebook), allow setting without current password
    if (user.password_hash) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword required' })
      const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex')
      if (currentHash !== user.password_hash) return res.status(401).json({ error: 'Wrong current password' })
    }
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

// DELETE /api/settings/sessions/others — log out all other sessions
// NOTE: must be defined BEFORE /:id to prevent "others" being caught as an id param
app.delete('/api/settings/sessions/others', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.userId, sessionId])
    res.json({ ok: true })
  } catch (err) {
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
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at, p.edited_at
       FROM posts p JOIN users u ON p.author_id = u.id
       WHERE p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, req.userId, limit, offset]
    )
    const postIds = posts.map(p => p.id)
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
    const result = posts.map(p => {
      let media = null
      if (p.media) {
        try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {}
      }
      return {
        id: p.id,
        author: p.author,
        authorId: p.author_id,
        time: { da: formatPostTime(p.created_at, 'da'), en: formatPostTime(p.created_at, 'en') },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes,
        liked: likedSet.has(p.id),
        userReaction: userReactionMap[p.id] || null,
        reactions: reactionsByPost[p.id] || [],
        media,
        comments: commentsByPost[p.id] || [],
        createdAtRaw: p.created_at,
        edited: !!p.edited_at,
      }
    })
    // Track post views (fire-and-forget)
    if (result.length && req.userId) {
      const viewValues = result.map(p => [p.id, req.userId])
      pool.query(
        `INSERT INTO post_views (post_id, viewer_id, view_count)
         VALUES ${viewValues.map(() => '(?,?,1)').join(',')}
         ON DUPLICATE KEY UPDATE view_count = view_count + 1, last_viewed_at = NOW()`,
        viewValues.flat()
      ).catch(() => {})
    }
    res.json({ posts: result, total, offset, limit })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' })
  }
})

// POST /api/feed/preflight — check text against keyword filters without posting
app.post('/api/feed/preflight', authenticate, (req, res) => {
  const { text } = req.body
  if (!text) return res.json({ ok: true })
  const kw = checkKeywords(text)
  if (!kw) return res.json({ ok: true })
  res.json({ ok: kw.action !== 'block', flagged: kw.action === 'flag', blocked: kw.action === 'block', keyword: kw.keyword, category: kw.category || null, notes: kw.notes || null })
})

// POST /api/feed — create a new post (with optional media)
app.post('/api/feed', authenticate, upload.array('media', 4), async (req, res) => {
  const { text } = req.body
  if (!text && !req.files?.length) return res.status(400).json({ error: 'Post text or media required' })

  // Keyword filter check
  const kw = checkKeywords(text)
  if (kw?.action === 'block') return res.status(400).json({ error: 'Post indeholder forbudt indhold / Post contains prohibited content' })
  // flag: allow post but auto-create a report for admin review
  const autoFlagKeyword = kw?.action === 'flag' ? kw.keyword : null

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
    const postId = result.insertId
    // Auto-flag: create a pending report for admin review
    if (autoFlagKeyword) {
      pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'post', postId, 'keyword_flag', `Auto-flagged: keyword "${autoFlagKeyword}"`]
      ).catch(() => {})
    }
    res.json({
      id: postId,
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
  // Keyword filter check
  const kwc = checkKeywords(text)
  if (kwc?.action === 'block') return res.status(400).json({ error: 'Kommentar indeholder forbudt indhold / Comment contains prohibited content' })
  const autoFlagKeywordComment = kwc?.action === 'flag' ? kwc.keyword : null
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
    const [rows2] = await pool.query('SELECT LAST_INSERT_ID() as id')
    const commentId = rows2[0].id
    if (autoFlagKeywordComment) {
      pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'comment', commentId, 'keyword_flag', `Auto-flagged: keyword "${autoFlagKeywordComment}"`]
      ).catch(() => {})
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

// PATCH /api/feed/:id — edit own post (within 1 hour of creation)
app.patch('/api/feed/:id', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  try {
    const postId = parseInt(req.params.id)
    const [[post]] = await pool.query(
      'SELECT id, author_id, created_at FROM posts WHERE id = ?', [postId]
    )
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Not your post' })
    const ageMs = Date.now() - new Date(post.created_at).getTime()
    if (ageMs > 60 * 60 * 1000) return res.status(403).json({ error: 'Edit window expired (1 hour)' })
    await pool.query(
      'UPDATE posts SET text_da = ?, text_en = ?, edited_at = NOW() WHERE id = ?',
      [text.trim(), text.trim(), postId]
    )
    res.json({ ok: true, text: text.trim() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to edit post' })
  }
})

// GET /api/visitor-stats — aggregated visitor statistics (authenticated users)
app.get('/api/visitor-stats', authenticate, async (req, res) => {
  try {
    const [browsers] = await pool.query(
      `SELECT browser, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND browser != 'Unknown'
       GROUP BY browser ORDER BY count DESC`
    )
    const [oses] = await pool.query(
      `SELECT os, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY os ORDER BY count DESC`
    )
    const [countries] = await pool.query(
      `SELECT country, country_code, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND country_code IS NOT NULL AND country_code != 'XX'
       GROUP BY country_code, country ORDER BY count DESC LIMIT 30`
    )
    const [daily] = await pool.query(
      `SELECT DATE(visited_at) AS date, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(visited_at) ORDER BY date ASC`
    )
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM site_visits')
    res.json({ browsers, oses, countries, daily, total })
  } catch (err) {
    console.error('GET /api/visitor-stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
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
      created.push({ name: name || email, email, token, inviteUrl })
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

// GET /api/sse — Server-Sent Events stream for real-time updates
app.get('/api/sse', authenticate, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  })
  res.flushHeaders()
  res.write(': connected\n\n')
  sseAdd(req.userId, res)
  // Heartbeat every 25 s to keep the connection alive
  const hb = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(hb) }
  }, 25_000)
  req.on('close', () => {
    clearInterval(hb)
    sseRemove(req.userId, res)
  })
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
    const [participants] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [convId])
    const receiverId = participants.find(p => p.user_id !== req.userId)?.user_id ?? req.userId
    await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, receiver_id, text_da, text_en, time) VALUES (?, ?, ?, ?, ?, ?)',
      [convId, req.userId, receiverId, text, text, time])
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const msg = { from: user.name, text: { da: text, en: text }, time: formatMsgTime(now) }
    // Push the new message to all other participants via SSE
    for (const { user_id } of participants) {
      if (user_id !== req.userId) sseBroadcast(user_id, { type: 'message', convId, msg })
    }
    res.json(msg)
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
      `SELECT u.id, u.name, u.handle, u.avatar_url,
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
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

app.post('/api/marketplace/:id/relist', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE marketplace_listings SET sold = 0, created_at = NOW() WHERE id = ?', [req.params.id])
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('owner','admin','editor') NOT NULL DEFAULT 'editor',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_company_user (company_id, user_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_follows (
      company_id INT NOT NULL,
      user_id INT NOT NULL,
      followed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, user_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_post_likes (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      reaction VARCHAR(10) NOT NULL DEFAULT '❤️',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES company_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS company_post_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      author_id INT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_post (post_id),
      FOREIGN KEY (post_id) REFERENCES company_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS job_saves (
      job_id INT NOT NULL,
      user_id INT NOT NULL,
      saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, user_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

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

// GET /api/companies/:id/followers — list of users following this company
app.get('/api/companies/:id/followers', authenticate, async (req, res) => {
  try {
    const [followers] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM company_follows cf JOIN users u ON u.id = cf.user_id
       WHERE cf.company_id = ?
       ORDER BY u.name ASC LIMIT 100`,
      [req.params.id]
    )
    res.json({ followers })
  } catch (err) {
    console.error('GET /api/companies/:id/followers error:', err.message)
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

// ── Ads ──────────────────────────────────────────────────────────────────────

async function initAds() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      advertiser_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT DEFAULT NULL,
      image_url VARCHAR(500) DEFAULT NULL,
      target_url VARCHAR(500) NOT NULL,
      status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
      placement ENUM('feed','sidebar','stories') NOT NULL DEFAULT 'feed',
      impressions INT NOT NULL DEFAULT 0,
      clicks INT NOT NULL DEFAULT 0,
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
      stripe_session_id VARCHAR(200) DEFAULT NULL,
      paid_at DATETIME DEFAULT NULL,
      paid_amount DECIMAL(10,2) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ads_advertiser (advertiser_id),
      INDEX idx_ads_status_placement (status, placement),
      FOREIGN KEY (advertiser_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Migrate existing installs
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid'`).catch(() => {})
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(200) DEFAULT NULL`).catch(() => {})
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS paid_at DATETIME DEFAULT NULL`).catch(() => {})
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) DEFAULT NULL`).catch(() => {})
    // Daily stats table
    await pool.query(`CREATE TABLE IF NOT EXISTS ad_stats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ad_id INT NOT NULL,
      stat_date DATE NOT NULL,
      impressions INT NOT NULL DEFAULT 0,
      clicks INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_ad_date (ad_id, stat_date),
      FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initAds error:', err.message)
  }
}

async function initAdminAdSettings() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_ad_settings (
      id INT NOT NULL DEFAULT 1 PRIMARY KEY,
      adfree_price_private DECIMAL(10,2) NOT NULL DEFAULT 29.00,
      adfree_price_business DECIMAL(10,2) NOT NULL DEFAULT 49.00,
      ad_price_cpm DECIMAL(10,2) NOT NULL DEFAULT 50.00,
      ad_price_period DECIMAL(10,2) NOT NULL DEFAULT 200.00,
      ad_period_days INT NOT NULL DEFAULT 30,
      currency VARCHAR(10) NOT NULL DEFAULT 'DKK',
      max_ads_feed INT NOT NULL DEFAULT 3,
      max_ads_sidebar INT NOT NULL DEFAULT 2,
      max_ads_stories INT NOT NULL DEFAULT 1,
      refresh_interval_seconds INT NOT NULL DEFAULT 300,
      ads_enabled TINYINT(1) NOT NULL DEFAULT 1,
      stripe_price_adfree_private VARCHAR(100) DEFAULT NULL,
      stripe_price_adfree_business VARCHAR(100) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      updated_by INT DEFAULT NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Ensure a default row always exists
    await pool.query(`INSERT IGNORE INTO admin_ad_settings (id) VALUES (1)`)
    // Migrate existing installs
    await pool.query(`ALTER TABLE admin_ad_settings ADD COLUMN IF NOT EXISTS ad_price_period DECIMAL(10,2) NOT NULL DEFAULT 200.00`).catch(() => {})
    await pool.query(`ALTER TABLE admin_ad_settings ADD COLUMN IF NOT EXISTS ad_period_days INT NOT NULL DEFAULT 30`).catch(() => {})
  } catch (err) {
    console.error('initAdminAdSettings error:', err.message)
  }
}

// Require business mode helper
function requireBusiness(req, res, next) {
  if (!req.userMode || req.userMode !== 'business') {
    return res.status(403).json({ error: 'Business account required' })
  }
  next()
}

// Middleware to attach userMode to req
async function attachUserMode(req, res, next) {
  try {
    if (req.userId) {
      const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
      req.userMode = user?.mode || 'privat'
    }
  } catch {}
  next()
}

// POST /api/ads/upload-image — upload an ad image, returns { url }
app.post('/api/ads/upload-image', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' })
  res.json({ url: `/uploads/${req.file.filename}` })
})

// POST /api/ads — create ad (business only)
app.post('/api/ads', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  const { title, body, image_url, image_display_width, image_display_height, target_url, placement = 'feed', start_date, end_date } = req.body
  if (!title || !target_url) return res.status(400).json({ error: 'title and target_url required' })
  try {
    const [result] = await pool.query(
      'INSERT INTO ads (advertiser_id, title, body, image_url, image_display_width, image_display_height, target_url, placement, start_date, end_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [req.userId, title, body || null, image_url || null, image_display_width || null, image_display_height || null, target_url, placement, start_date || null, end_date || null]
    )
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [result.insertId])
    res.status(201).json({ ad })
  } catch (err) {
    console.error('POST /api/ads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/ads — list own ads (business) or all active ads (admin)
app.get('/api/ads', authenticate, async (req, res) => {
  try {
    let rows
    if (req.query.admin === '1') {
      // Admin listing — requires admin
      const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.userId])
      if (!user || req.userId !== 1) return res.status(403).json({ error: 'Admin only' })
      ;[rows] = await pool.query(
        `SELECT a.*, u.name AS advertiser_name FROM ads a JOIN users u ON u.id = a.advertiser_id ORDER BY a.created_at DESC`
      )
    } else if (req.query.serve === '1') {
      // Serve ads — fetch enabled ad for placement (respects ads_enabled setting)
      const [[settings]] = await pool.query('SELECT ads_enabled, max_ads_feed, max_ads_sidebar, max_ads_stories, refresh_interval_seconds FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
      if (!settings || !settings.ads_enabled) return res.json({ ads: [] })
      // Check if user is ads_free
      const [[userRow]] = await pool.query('SELECT ads_free FROM users WHERE id = ?', [req.userId])
      if (userRow?.ads_free) return res.json({ ads: [], ads_free: true })
      const placement = req.query.placement || 'feed'
      const limitMap = { feed: settings.max_ads_feed, sidebar: settings.max_ads_sidebar, stories: settings.max_ads_stories }
      const limit = limitMap[placement] || 1
      ;[rows] = await pool.query(
        `SELECT * FROM ads WHERE status = 'active' AND placement = ? AND (start_date IS NULL OR start_date <= CURDATE()) AND (end_date IS NULL OR end_date >= CURDATE()) ORDER BY RAND() LIMIT ?`,
        [placement, limit]
      )
      return res.json({ ads: rows, refresh_interval: settings.refresh_interval_seconds })
    } else {
      // Business user's own ads
      ;[rows] = await pool.query('SELECT * FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC', [req.userId])
    }
    res.json({ ads: rows })
  } catch (err) {
    console.error('GET /api/ads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/ads/:id — get single ad
app.get('/api/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    res.json({ ad })
  } catch (err) {
    console.error('GET /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/ads/:id — update ad
app.put('/api/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    const { title, body, image_url, image_display_width, image_display_height, target_url, status, placement, start_date, end_date } = req.body
    const VALID_STATUS = ['draft', 'active', 'paused', 'archived']
    const VALID_PLACEMENT = ['feed', 'sidebar', 'stories']
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    if (placement && !VALID_PLACEMENT.includes(placement)) return res.status(400).json({ error: 'Invalid placement' })
    await pool.query(
      'UPDATE ads SET title=COALESCE(?,title), body=COALESCE(?,body), image_url=COALESCE(?,image_url), image_display_width=?, image_display_height=?, target_url=COALESCE(?,target_url), status=COALESCE(?,status), placement=COALESCE(?,placement), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date) WHERE id=?',
      [title||null, body||null, image_url||null, image_display_width||null, image_display_height||null, target_url||null, status||null, placement||null, start_date||null, end_date||null, req.params.id]
    )
    const [[updated]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    res.json({ ad: updated })
  } catch (err) {
    console.error('PUT /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/ads/:id — permanently delete ad
app.delete('/api/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM ads WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/ads/:id/impression — record impression
app.post('/api/ads/:id/impression', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT id FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    await pool.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [req.params.id])
    await pool.query(
      'INSERT INTO ad_stats (ad_id, stat_date, impressions) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE impressions = impressions + 1',
      [req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/impression error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/ads/:id/click — record click
app.post('/api/ads/:id/click', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT id FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id])
    await pool.query(
      'INSERT INTO ad_stats (ad_id, stat_date, clicks) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE clicks = clicks + 1',
      [req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/click error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/ads/:id/stats — daily impressions + clicks for last N days
app.get('/api/ads/:id/stats', authenticate, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const days = Math.min(parseInt(req.query.days || '30'), 90)
    const [[ad]] = await pool.query('SELECT advertiser_id FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    const [rows] = await pool.query(
      `SELECT stat_date AS date, impressions, clicks FROM ad_stats
       WHERE ad_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY stat_date ASC`,
      [adId, days]
    )
    res.json({ stats: rows })
  } catch (err) {
    console.error('GET /api/ads/:id/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Admin ad settings ─────────────────────────────────────────────────────────

// GET /api/admin/ad-settings — fetch ad pricing & display settings (admin only)
app.get('/api/admin/ad-settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM admin_ad_settings WHERE id = 1')
    if (!row) return res.status(404).json({ error: 'Settings not found' })
    res.json({ settings: row })
  } catch (err) {
    console.error('GET /api/admin/ad-settings error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/admin/ad-settings — update ad pricing & display settings (admin only)
app.put('/api/admin/ad-settings', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['adfree_price_private', 'adfree_price_business', 'ad_price_cpm', 'ad_price_period', 'ad_period_days', 'currency', 'max_ads_feed', 'max_ads_sidebar', 'max_ads_stories', 'refresh_interval_seconds', 'ads_enabled', 'stripe_price_adfree_private', 'stripe_price_adfree_business']
  const updates = {}
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key]
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' })
  try {
    const [[existing]] = await pool.query('SELECT id FROM admin_ad_settings WHERE id = 1')
    if (!existing) return res.status(404).json({ error: 'Settings not found' })
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ')
    await pool.query(
      `UPDATE admin_ad_settings SET ${setClauses}, updated_by = ? WHERE id = 1`,
      [...Object.values(updates), req.userId]
    )
    const [[row]] = await pool.query('SELECT * FROM admin_ad_settings WHERE id = 1')
    res.json({ settings: row })
  } catch (err) {
    console.error('PUT /api/admin/ad-settings error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Stripe — ads_free subscription ───────────────────────────────────────────

async function getStripe() {
  try {
    const [[row]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'stripe_secret_key'")
    if (!row?.key_value || row.key_value.startsWith('••')) return null
    const { default: Stripe } = await import('stripe')
    return new Stripe(row.key_value, { apiVersion: '2024-06-20' })
  } catch { return null }
}

// POST /api/admin/stripe/test — verify that the configured Stripe secret key is valid
app.post('/api/admin/stripe/test', authenticate, requireAdmin, async (req, res) => {
  try {
    // Step 1: check what is actually in the DB
    const [[row]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'stripe_secret_key'").catch(() => [[null]])
    if (!row || !row.key_value) return res.json({ ok: false, error: 'Ingen nøgle gemt i databasen. Udfyld feltet og gem.' })
    if (row.key_value.startsWith('••')) return res.json({ ok: false, error: 'Databasen indeholder en maskeret nøgle. Skriv den rigtige nøgle i feltet og gem igen.' })
    // Step 2: initialise Stripe with the stored key
    let stripe
    try {
      const { default: Stripe } = await import('stripe')
      stripe = new Stripe(row.key_value, { apiVersion: '2024-06-20' })
    } catch (e) {
      return res.json({ ok: false, error: `Stripe-pakke fejl: ${e.message}` })
    }
    // Step 3: lightweight API call — balance works for all key types
    const balance = await stripe.balance.retrieve()
    res.json({ ok: true, livemode: balance.livemode, key_hint: row.key_value.slice(0, 8) + '…' })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// POST /api/stripe/checkout/adfree — create Stripe checkout for ads_free sub
app.post('/api/stripe/checkout/adfree', authenticate, async (req, res) => {
  try {
    const stripe = await getStripe()
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })

    const [[user]] = await pool.query('SELECT name, email, mode, ads_free, stripe_customer_id FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.ads_free) return res.status(400).json({ error: 'Already ad-free' })

    const [[adSettings]] = await pool.query('SELECT adfree_price_private, adfree_price_business, currency, stripe_price_adfree_private, stripe_price_adfree_business FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])

    const isBusinessMode = user.mode === 'business'
    const priceId = isBusinessMode ? adSettings?.stripe_price_adfree_business : adSettings?.stripe_price_adfree_private

    if (!priceId) return res.status(503).json({ error: 'Ad-free price not configured in admin panel' })

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name })
      customerId = customer.id
      await pool.query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, req.userId])
    }

    const origin = req.headers.origin || 'https://fellis.eu'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?adfree=success`,
      cancel_url: `${origin}/?adfree=cancel`,
      metadata: { user_id: String(req.userId), type: 'adfree' },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('POST /api/stripe/checkout/adfree error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/stripe/checkout/ad-campaign — one-time payment to activate an ad for a period
app.post('/api/stripe/checkout/ad-campaign', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    const { ad_id } = req.body
    if (!ad_id) return res.status(400).json({ error: 'ad_id required' })

    const [[ad]] = await pool.query('SELECT id, title, advertiser_id FROM ads WHERE id = ?', [ad_id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId) return res.status(403).json({ error: 'Not your ad' })

    const [[adSettings]] = await pool.query('SELECT ad_price_period, ad_period_days, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const price = parseFloat(adSettings?.ad_price_period ?? 200)
    const days = parseInt(adSettings?.ad_period_days ?? 30)
    const currency = (adSettings?.currency || 'DKK').toLowerCase()

    const stripe = await getStripe()
    if (!stripe) {
      // Stripe not configured — activate directly (dev/demo mode)
      const startDate = new Date().toISOString().slice(0, 10)
      const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
      await pool.query(
        `UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_amount = ?, start_date = ?, end_date = ? WHERE id = ?`,
        [price, startDate, endDate, ad_id]
      )
      return res.json({ activated: true })
    }

    const [[user]] = await pool.query('SELECT name, email, stripe_customer_id FROM users WHERE id = ?', [req.userId])
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name })
      customerId = customer.id
      await pool.query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, req.userId])
    }

    const origin = req.headers.origin || 'https://fellis.eu'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(price * 100),
          product_data: { name: `Annonce: ${ad.title} (${days} dage)` },
        },
      }],
      success_url: `${origin}/?ad_payment=success&ad_id=${ad_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?ad_payment=cancel&ad_id=${ad_id}`,
      metadata: { user_id: String(req.userId), type: 'ad-campaign', ad_id: String(ad_id), period_days: String(days), paid_amount: String(price) },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('POST /api/stripe/checkout/ad-campaign error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/ads/:id/verify-payment — verify Stripe session and activate ad (called on success redirect)
app.post('/api/ads/:id/verify-payment', authenticate, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const { session_id } = req.body
    if (!session_id) return res.status(400).json({ error: 'session_id required' })

    const [[ad]] = await pool.query('SELECT id, advertiser_id, payment_status FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    // Already activated (webhook may have fired already)
    if (ad.payment_status === 'paid') return res.json({ ok: true, already_active: true })

    const stripe = await getStripe()
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })

    const session = await stripe.checkout.sessions.retrieve(session_id)
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed' })

    // Activate the ad
    const meta = session.metadata || {}
    const days = parseInt(meta.period_days || '30')
    const paidAmount = parseFloat(meta.paid_amount || '0')
    const startDate = new Date().toISOString().slice(0, 10)
    const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    await pool.query(
      `UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_amount = ?, stripe_session_id = ?, start_date = ?, end_date = ? WHERE id = ?`,
      [paidAmount, session_id, startDate, endDate, adId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/verify-payment error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/stripe/webhook — Stripe webhook handler (raw body needed)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = await getStripe()
    if (!stripe) return res.status(200).send('ok')

    const [[secretRow]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'stripe_webhook_secret'").catch(() => [[null]])
    const sig = req.headers['stripe-signature']

    let event
    if (secretRow?.key_value && sig) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secretRow.key_value)
      } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`)
      }
    } else {
      event = JSON.parse(req.body.toString())
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      if (session.metadata?.type === 'adfree' && session.metadata?.user_id) {
        const subId = session.subscription
        await pool.query(
          'UPDATE users SET ads_free = 1, ads_free_sub_id = ? WHERE id = ?',
          [subId, parseInt(session.metadata.user_id)]
        )
      }
      if (session.metadata?.type === 'ad-campaign' && session.metadata?.ad_id) {
        const adId = parseInt(session.metadata.ad_id)
        const days = parseInt(session.metadata.period_days || '30')
        const paidAmount = parseFloat(session.metadata.paid_amount || '0')
        const startDate = new Date().toISOString().slice(0, 10)
        const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
        await pool.query(
          `UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_amount = ?, stripe_session_id = ?, start_date = ?, end_date = ? WHERE id = ?`,
          [paidAmount, session.id, startDate, endDate, adId]
        )
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      // Cancel ads_free when subscription ends
      await pool.query('UPDATE users SET ads_free = 0, ads_free_sub_id = NULL WHERE ads_free_sub_id = ?', [sub.id])
    }

    res.json({ received: true })
  } catch (err) {
    console.error('POST /api/stripe/webhook error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/me/subscription — get current user's ads_free status
app.get('/api/me/subscription', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT ads_free, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const [[adSettings]] = await pool.query('SELECT adfree_price_private, adfree_price_business, currency, ads_enabled FROM admin_ad_settings WHERE id = 1').catch(() => [[{ adfree_price_private: 29, adfree_price_business: 49, currency: 'DKK', ads_enabled: 1 }]])
    const price = user.mode === 'business' ? adSettings?.adfree_price_business : adSettings?.adfree_price_private
    res.json({ ads_free: Boolean(user.ads_free), price: price || 29, currency: adSettings?.currency || 'DKK', ads_enabled: Boolean(adSettings?.ads_enabled) })
  } catch (err) {
    console.error('GET /api/me/subscription error:', err.message)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS skill_endorsements (
      skill_id INT NOT NULL,
      endorser_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (skill_id, endorser_id),
      FOREIGN KEY (skill_id) REFERENCES user_skills(id) ON DELETE CASCADE,
      FOREIGN KEY (endorser_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

  } catch (err) {
    console.error('initSettingsSchema error:', err.message)
  }
}

async function initSiteVisits() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS site_visits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      ip_address VARCHAR(50) DEFAULT NULL,
      user_agent VARCHAR(500) DEFAULT NULL,
      browser VARCHAR(50) DEFAULT NULL,
      os VARCHAR(50) DEFAULT NULL,
      country VARCHAR(100) DEFAULT NULL,
      country_code VARCHAR(2) DEFAULT NULL,
      city VARCHAR(100) DEFAULT NULL,
      visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sv_visited (visited_at),
      INDEX idx_sv_country (country_code),
      INDEX idx_sv_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Add edited_at column to posts if not present
    await pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP NULL DEFAULT NULL')
  } catch (err) {
    console.error('initSiteVisits error:', err.message)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initAnalytics error:', err.message)
  }
}

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

function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Not authenticated' })
  if (req.userId !== 1) return res.status(403).json({ error: 'Admin only' })
  next()
}

function requireModerator(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Not authenticated' })
  if (!req.isModerator) return res.status(403).json({ error: 'Moderator only' })
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

// GET /api/analytics/visitor-stats — aggregated visitor statistics with date range
app.get('/api/analytics/visitor-stats', authenticate, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90)

    // site_visits queries — may fail if table not yet created (race on startup)
    let browsers = [], oses = [], countries = [], daily = [], total = 0
    try {
      ;[browsers] = await pool.query(
        `SELECT browser, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND browser != 'Unknown'
         GROUP BY browser ORDER BY count DESC`,
        [days]
      )
      ;[oses] = await pool.query(
        `SELECT os, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY os ORDER BY count DESC`,
        [days]
      )
      ;[countries] = await pool.query(
        `SELECT country, country_code, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND country_code IS NOT NULL AND country_code != 'XX'
         GROUP BY country_code, country ORDER BY count DESC LIMIT 30`,
        [days]
      )
      ;[daily] = await pool.query(
        `SELECT DATE(visited_at) AS date, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(visited_at) ORDER BY date ASC`,
        [days]
      )
      ;[[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM site_visits')
    } catch (e) {
      console.error('visitor-stats site_visits query error:', e.message)
    }

    // profile_views queries — separate try/catch so site stats still work if table missing
    let myProfileViews = 0, myProfileViewsDaily = []
    try {
      ;[[{ myProfileViews }]] = await pool.query(
        'SELECT COUNT(*) AS myProfileViews FROM profile_views WHERE profile_id = ?',
        [req.userId]
      )
      ;[myProfileViewsDaily] = await pool.query(
        `SELECT DATE(viewed_at) AS date, COUNT(*) AS count FROM profile_views
         WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(viewed_at) ORDER BY date ASC`,
        [req.userId, days]
      )
    } catch (e) {
      console.error('visitor-stats profile_views query error:', e.message)
    }

    res.json({ browsers, oses, countries, daily, total, myProfileViews, myProfileViewsDaily })
  } catch (err) {
    console.error('GET /api/analytics/visitor-stats error:', err.message)
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
  const allowed = ['stripe_secret_key', 'stripe_pub_key', 'stripe_webhook_secret', 'stripe_price_pro_monthly', 'stripe_price_pro_yearly', 'stripe_price_boost', 'stripe_price_adfree_private', 'stripe_price_adfree_business', 'pwd_min_length', 'pwd_require_uppercase', 'pwd_require_lowercase', 'pwd_require_numbers', 'pwd_require_symbols']
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue
      // pwd_ keys are always saved (value can be '0'); skip only masked/empty Stripe secrets
      if (!key.startsWith('pwd_')) {
        if (!value || value === '••••••••' + (value || '').slice(-4)) continue // skip masked/empty
      }
      await pool.query('INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', [key, value])
      // Sync adfree price IDs to admin_ad_settings so the checkout flow can use them
      if (key === 'stripe_price_adfree_private' || key === 'stripe_price_adfree_business') {
        await pool.query(`UPDATE admin_ad_settings SET ${key} = ? WHERE id = 1`, [value]).catch(() => {})
      }
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
    _feedWeightsCache = null
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

// PATCH /api/events/:id — edit event (organizer only)
app.patch('/api/events/:id', authenticate, async (req, res) => {
  try {
    const [[event]] = await pool.query('SELECT organizer_id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (event.organizer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    const { title, description, date, location, eventType, ticketUrl, cap } = req.body
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' })
    await pool.query(
      `UPDATE events SET title=?, description=?, date=?, location=?, event_type=?, ticket_url=?, cap=? WHERE id=?`,
      [title, description || null, date, location || null, eventType || null, ticketUrl || null, cap || null, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/events/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/events/:id — delete event (organizer only)
app.delete('/api/events/:id', authenticate, async (req, res) => {
  try {
    const [[event]] = await pool.query('SELECT organizer_id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (event.organizer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/events/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/profile/birthday — set or clear user's birthday
app.patch('/api/profile/birthday', authenticate, async (req, res) => {
  try {
    const { birthday } = req.body
    // Accepts ISO date string 'YYYY-MM-DD' or null to clear
    const value = birthday ? birthday : null
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return res.status(400).json({ error: 'Invalid date format, use YYYY-MM-DD' })
    }
    await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [value, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile/birthday error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Settings: Sessions ─────────────────────────────────────────────────────

// GET /api/calendar/events — fetch calendar data: friend birthdays + platform events
app.get('/api/calendar/events', authenticate, async (req, res) => {
  try {
    // Get birthday of friends + the current user
    const [birthdayRows] = await pool.query(
      `SELECT u.id, u.name, u.initials, u.avatar_url, u.birthday
       FROM users u
       WHERE u.birthday IS NOT NULL
         AND (
           u.id = ?
           OR u.id IN (
             SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END
             FROM friendships WHERE user_id = ? OR friend_id = ?
           )
         )`,
      [req.userId, req.userId, req.userId, req.userId]
    )
    const birthdays = birthdayRows.map(u => ({
      userId: u.id,
      name: u.name,
      initials: u.initials,
      avatarUrl: u.avatar_url,
      date: u.birthday, // full YYYY-MM-DD stored, client uses MM-DD for yearly repeat
    }))

    // Get platform events
    const [eventRows] = await pool.query(
      `SELECT e.id, e.title, e.date, e.location, e.event_type,
        (SELECT r.status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS my_rsvp
       FROM events e ORDER BY e.date ASC`,
      [req.userId]
    )
    const events = eventRows.map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      location: e.location,
      eventType: e.event_type,
      myRsvp: e.my_rsvp || null,
    }))

    res.json({ birthdays, events })
  } catch (err) {
    console.error('GET /api/calendar/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


// ── Reels ──────────────────────────────────────────────────────────────────

const reelUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
    if (!allowed.has(file.mimetype)) return cb(new Error('Only video files are allowed'))
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      return cb(new Error('Invalid filename'))
    }
    cb(null, true)
  },
})

async function initReels() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS reels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      video_url VARCHAR(500) NOT NULL,
      caption TEXT DEFAULT NULL,
      views_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS reel_likes (
      reel_id INT NOT NULL,
      user_id INT NOT NULL,
      reaction VARCHAR(10) DEFAULT '❤️',
      PRIMARY KEY (reel_id, user_id),
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`ALTER TABLE reel_likes ADD COLUMN IF NOT EXISTS reaction VARCHAR(10) DEFAULT '❤️'`).catch(() => {})
    await pool.query(`CREATE TABLE IF NOT EXISTS reel_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reel_id INT NOT NULL,
      user_id INT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initReels error:', err.message)
  }
}

// GET /api/reels — paginated feed
app.get('/api/reels', authenticate, async (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)
    const [rows] = await pool.query(
      `SELECT r.id, r.video_url, r.caption, r.views_count, r.created_at,
              u.id AS user_id, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
              COUNT(DISTINCT rl.user_id) AS likes_count,
              EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = r.id AND user_id = ?) AS liked_by_me,
              (SELECT reaction FROM reel_likes WHERE reel_id = r.id AND user_id = ?) AS my_reaction,
              COUNT(DISTINCT rc.id) AS comments_count
       FROM reels r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN reel_likes rl ON rl.reel_id = r.id
       LEFT JOIN reel_comments rc ON rc.reel_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, req.userId, limit, offset]
    )
    res.json({ reels: rows.map(r => ({ ...r, liked_by_me: !!r.liked_by_me, my_reaction: r.my_reaction || null })) })
  } catch (err) {
    console.error('GET /api/reels error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/reels — upload a reel
app.post('/api/reels', authenticate, reelUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' })
    const caption = (req.body.caption || '').trim().slice(0, 2000) || null
    const videoUrl = `/uploads/${req.file.filename}`
    const [result] = await pool.query(
      'INSERT INTO reels (user_id, video_url, caption) VALUES (?, ?, ?)',
      [req.userId, videoUrl, caption]
    )
    const [[reel]] = await pool.query(
      `SELECT r.id, r.video_url, r.caption, r.views_count, r.created_at,
              u.id AS user_id, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
              0 AS likes_count, 0 AS liked_by_me, 0 AS comments_count
       FROM reels r JOIN users u ON r.user_id = u.id WHERE r.id = ?`,
      [result.insertId]
    )
    res.status(201).json({ reel })
  } catch (err) {
    console.error('POST /api/reels error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/reels/:id/like — toggle like (supports reaction emoji)
app.post('/api/reels/:id/like', authenticate, async (req, res) => {
  try {
    const reelId = parseInt(req.params.id)
    const reaction = (req.body?.reaction || '❤️').slice(0, 10)
    const [[existing]] = await pool.query(
      'SELECT reaction FROM reel_likes WHERE reel_id = ? AND user_id = ?',
      [reelId, req.userId]
    )
    if (existing) {
      if (existing.reaction === reaction) {
        // Same reaction → unlike
        await pool.query('DELETE FROM reel_likes WHERE reel_id = ? AND user_id = ?', [reelId, req.userId])
        const [[{ likes_count }]] = await pool.query(
          'SELECT COUNT(*) AS likes_count FROM reel_likes WHERE reel_id = ?', [reelId])
        return res.json({ liked: false, likes_count, reaction: null })
      } else {
        // Different reaction → update
        await pool.query('UPDATE reel_likes SET reaction=? WHERE reel_id=? AND user_id=?', [reaction, reelId, req.userId])
      }
    } else {
      await pool.query('INSERT INTO reel_likes (reel_id, user_id, reaction) VALUES (?, ?, ?)', [reelId, req.userId, reaction])
    }
    const [[{ likes_count }]] = await pool.query(
      'SELECT COUNT(*) AS likes_count FROM reel_likes WHERE reel_id = ?', [reelId]
    )
    res.json({ liked: true, likes_count, reaction })
  } catch (err) {
    console.error('POST /api/reels/:id/like error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/reels/:id/comments
app.get('/api/reels/:id/comments', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT rc.id, rc.text, rc.created_at,
              u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar
       FROM reel_comments rc JOIN users u ON rc.user_id = u.id
       WHERE rc.reel_id = ?
       ORDER BY rc.created_at ASC`,
      [req.params.id]
    )
    res.json({ comments: rows })
  } catch (err) {
    console.error('GET /api/reels/:id/comments error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/reels/:id/comments
app.post('/api/reels/:id/comments', authenticate, async (req, res) => {
  try {
    const text = (req.body.text || '').trim()
    if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
    const [result] = await pool.query(
      'INSERT INTO reel_comments (reel_id, user_id, text) VALUES (?, ?, ?)',
      [req.params.id, req.userId, text.slice(0, 2000)]
    )
    const [[comment]] = await pool.query(
      `SELECT rc.id, rc.text, rc.created_at,
              u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar
       FROM reel_comments rc JOIN users u ON rc.user_id = u.id WHERE rc.id = ?`,
      [result.insertId]
    )
    res.status(201).json({ comment })
  } catch (err) {
    console.error('POST /api/reels/:id/comments error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/reels/:id
app.delete('/api/reels/:id', authenticate, async (req, res) => {
  try {
    const [[reel]] = await pool.query('SELECT user_id FROM reels WHERE id = ?', [req.params.id])
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    if (reel.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM reels WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/reels/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Viral Growth Routes ──

// GET /api/referrals/dashboard — referral stats + badges for current user
app.get('/api/referrals/dashboard', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    // Referral stats
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?) as total_accepted,
        (SELECT COUNT(*) FROM invitations WHERE inviter_id = ?) as total_invited,
        (SELECT referral_count FROM users WHERE id = ?) as referral_count,
        (SELECT reputation_score FROM users WHERE id = ?) as reputation_score`,
      [req.userId, req.userId, req.userId, req.userId]
    )

    // Earned badges with reward details
    const [badges] = await pool.query(
      `SELECT ub.reward_type, ub.earned_at,
              r.icon, r.title_da, r.title_en, r.description_da, r.description_en, r.threshold, r.reward_points
       FROM user_badges ub JOIN rewards r ON r.type = ub.reward_type
       WHERE ub.user_id = ?
       ORDER BY r.threshold ASC`,
      [req.userId]
    )

    // Recent successful referrals (who joined via this user's invite)
    const [recent] = await pool.query(
      `SELECT u.name, u.handle, u.avatar_url, r.converted_at, r.invite_source
       FROM referrals r JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = ?
       ORDER BY r.converted_at DESC LIMIT 10`,
      [req.userId]
    )

    // Next milestone
    const referralCount = Number(stats.referral_count || 0)
    const nextMilestone = BADGE_THRESHOLDS.find(b => b.threshold > referralCount) || null
    const conversionRate = stats.total_invited > 0
      ? Math.round((referralCount / Number(stats.total_invited)) * 100)
      : 0

    res.json({
      totalInvited: Number(stats.total_invited || 0),
      totalAccepted: referralCount,
      conversionRate,
      reputationScore: Number(stats.reputation_score || 0),
      badges: badges.map(b => ({
        type: b.reward_type,
        icon: b.icon,
        title: lang === 'da' ? b.title_da : b.title_en,
        description: lang === 'da' ? b.description_da : b.description_en,
        earnedAt: b.earned_at,
        threshold: b.threshold,
        points: b.reward_points,
      })),
      recentReferrals: recent.map(r => ({
        name: r.name,
        handle: r.handle,
        avatarUrl: r.avatar_url,
        joinedAt: r.converted_at,
        source: r.invite_source,
      })),
      nextMilestone: nextMilestone
        ? { type: nextMilestone.type, target: nextMilestone.threshold, current: referralCount, remaining: nextMilestone.threshold - referralCount }
        : null,
    })
  } catch (err) {
    console.error('GET /api/referrals/dashboard error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/referrals/leaderboard — top inviters (public ranking)
app.get('/api/referrals/leaderboard', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, u.referral_count, u.reputation_score,
              (SELECT ub.reward_type FROM user_badges ub JOIN rewards r ON r.type = ub.reward_type
               WHERE ub.user_id = u.id ORDER BY r.threshold DESC LIMIT 1) as top_badge_type,
              (SELECT r2.icon FROM rewards r2 WHERE r2.type = (
               SELECT ub2.reward_type FROM user_badges ub2 JOIN rewards r3 ON r3.type = ub2.reward_type
               WHERE ub2.user_id = u.id ORDER BY r3.threshold DESC LIMIT 1)) as top_badge_icon
       FROM users u
       WHERE u.referral_count > 0
       ORDER BY u.referral_count DESC, u.reputation_score DESC
       LIMIT 20`
    )
    res.json(rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      name: r.name,
      handle: r.handle,
      avatarUrl: r.avatar_url,
      referralCount: Number(r.referral_count),
      reputationScore: Number(r.reputation_score),
      topBadge: r.top_badge_type ? { type: r.top_badge_type, icon: r.top_badge_icon } : null,
      isMe: r.id === req.userId,
    })))
  } catch (err) {
    console.error('GET /api/referrals/leaderboard error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/badges — all badges available + which ones the user has earned
app.get('/api/badges', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [all] = await pool.query('SELECT * FROM rewards ORDER BY threshold ASC')
    const [earned] = await pool.query('SELECT reward_type, earned_at FROM user_badges WHERE user_id = ?', [req.userId])
    const earnedMap = new Map(earned.map(e => [e.reward_type, e.earned_at]))
    const [[user]] = await pool.query('SELECT referral_count FROM users WHERE id = ?', [req.userId])
    const referralCount = Number(user?.referral_count || 0)
    res.json(all.map(r => ({
      type: r.type,
      icon: r.icon,
      title: lang === 'da' ? r.title_da : r.title_en,
      description: lang === 'da' ? r.description_da : r.description_en,
      threshold: r.threshold,
      points: r.reward_points,
      earned: earnedMap.has(r.type),
      earnedAt: earnedMap.get(r.type) || null,
      progress: Math.min(referralCount, r.threshold),
    })))
  } catch (err) {
    console.error('GET /api/badges error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/public/profile/:handle — public profile (no auth required)
app.get('/api/public/profile/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.startsWith('@') ? req.params.handle : '@' + req.params.handle
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.bio_da, u.bio_en, u.location, u.avatar_url, u.join_date,
              u.profile_public, u.reputation_score, u.referral_count,
              (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
              (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND is_public = 1) as public_post_count
       FROM users u WHERE u.handle = ?`,
      [handle]
    )
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' })
    const user = rows[0]
    if (!user.profile_public) return res.status(403).json({ error: 'Profile is private' })

    // Public posts for this profile
    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              p.share_token, p.share_count, p.created_at
       FROM posts p WHERE p.author_id = ? AND p.is_public = 1
       ORDER BY p.created_at DESC LIMIT 10`,
      [user.id]
    )

    res.json({
      id: user.id,
      name: user.name,
      handle: user.handle,
      bio: { da: user.bio_da, en: user.bio_en },
      location: user.location,
      avatarUrl: user.avatar_url,
      joinDate: user.join_date,
      friendCount: Number(user.friend_count),
      publicPostCount: Number(user.public_post_count),
      reputationScore: Number(user.reputation_score),
      posts: posts.map(p => ({
        id: p.id,
        text: { da: p.text_da, en: p.text_en },
        time: { da: p.time_da, en: p.time_en },
        likes: p.likes,
        media: p.media,
        shareToken: p.share_token,
        shareCount: p.share_count,
        createdAt: p.created_at,
      })),
    })
  } catch (err) {
    console.error('GET /api/public/profile/:handle error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/public/post/:shareToken — public post view (no auth required)
app.get('/api/public/post/:shareToken', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              p.share_token, p.share_count, p.created_at, p.is_public,
              u.id as author_id, u.name as author_name, u.handle as author_handle,
              u.avatar_url as author_avatar, u.profile_public,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.share_token = ?`,
      [req.params.shareToken]
    )
    if (!rows.length) return res.status(404).json({ error: 'Post not found' })
    const post = rows[0]
    if (!post.is_public) return res.status(403).json({ error: 'Post is not public' })

    // Increment share view count
    await pool.query('UPDATE posts SET share_count = share_count + 1 WHERE share_token = ?', [req.params.shareToken])

    res.json({
      id: post.id,
      text: { da: post.text_da, en: post.text_en },
      time: { da: post.time_da, en: post.time_en },
      likes: post.likes,
      media: post.media,
      shareToken: post.share_token,
      shareCount: post.share_count,
      commentCount: Number(post.comment_count),
      createdAt: post.created_at,
      author: {
        id: post.author_id,
        name: post.author_name,
        handle: post.author_handle,
        avatarUrl: post.author_avatar,
        profilePublic: !!post.profile_public,
      },
    })
  } catch (err) {
    console.error('GET /api/public/post/:shareToken error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/posts/:id/share-token — generate/get share token for a post (makes it public)
app.post('/api/posts/:id/share-token', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [[post]] = await pool.query('SELECT id, author_id, share_token, is_public FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    let shareToken = post.share_token
    if (!shareToken) {
      shareToken = crypto.randomBytes(16).toString('hex')
      await pool.query('UPDATE posts SET share_token = ?, is_public = 1 WHERE id = ?', [shareToken, postId])
    } else if (!post.is_public) {
      await pool.query('UPDATE posts SET is_public = 1 WHERE id = ?', [postId])
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    res.json({ shareToken, shareUrl: `${siteUrl}/p/${shareToken}` })
  } catch (err) {
    console.error('POST /api/posts/:id/share-token error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/posts/:id/share-token — revoke public access to a post
app.delete('/api/posts/:id/share-token', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [[post]] = await pool.query('SELECT author_id FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE posts SET is_public = 0 WHERE id = ?', [postId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/profile/public — toggle public profile visibility
app.patch('/api/profile/public', authenticate, async (req, res) => {
  const { isPublic } = req.body
  if (typeof isPublic !== 'boolean') return res.status(400).json({ error: 'isPublic must be boolean' })
  try {
    await pool.query('UPDATE users SET profile_public = ? WHERE id = ?', [isPublic ? 1 : 0, req.userId])
    res.json({ ok: true, isPublic })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/share/track — track an external share event
app.post('/api/share/track', authenticate, async (req, res) => {
  const { shareType, targetId, platform, utmCampaign } = req.body
  const validTypes = ['post', 'profile', 'invite']
  if (!validTypes.includes(shareType)) return res.status(400).json({ error: 'Invalid share type' })
  try {
    await pool.query(
      'INSERT INTO share_events (user_id, share_type, target_id, platform, utm_campaign) VALUES (?, ?, ?, ?, ?)',
      [req.userId, shareType, targetId || null, platform || null, utmCampaign || null]
    )
    // Increment post share count if applicable
    if (shareType === 'post' && targetId) {
      await pool.query('UPDATE posts SET share_count = share_count + 1 WHERE id = ? AND author_id = ?', [targetId, req.userId])
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/viral-stats — viral growth stats (admin only)
app.get('/api/admin/viral-stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30')
    const [[inviteStats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM invitations WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as invites_sent,
        (SELECT COUNT(*) FROM invitations WHERE status = 'accepted' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as invites_accepted,
        (SELECT COUNT(*) FROM referrals WHERE converted_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as referrals_converted,
        (SELECT COUNT(*) FROM share_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as shares_tracked,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as new_users`,
      [days, days, days, days, days]
    )

    // Viral coefficient = avg referrals per user who registered via invite
    const [[vcStats]] = await pool.query(
      `SELECT
        COUNT(DISTINCT referrer_id) as active_referrers,
        COUNT(*) as total_referrals
       FROM referrals WHERE converted_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    )
    const viralCoefficient = vcStats.active_referrers > 0
      ? (vcStats.total_referrals / vcStats.active_referrers).toFixed(2)
      : 0

    // Top inviters
    const [topInviters] = await pool.query(
      `SELECT u.name, u.handle, u.referral_count,
              COUNT(r.id) as period_referrals
       FROM users u JOIN referrals r ON r.referrer_id = u.id
       WHERE r.converted_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY u.id ORDER BY period_referrals DESC LIMIT 10`,
      [days]
    )

    // Share breakdown by platform
    const [sharePlatforms] = await pool.query(
      `SELECT platform, COUNT(*) as count
       FROM share_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY platform ORDER BY count DESC`,
      [days]
    )

    // Daily invite trend
    const [dailyTrend] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as invites_sent,
              SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
       FROM invitations WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [days]
    )

    res.json({
      days,
      invitesSent: Number(inviteStats.invites_sent || 0),
      invitesAccepted: Number(inviteStats.invites_accepted || 0),
      referralsConverted: Number(inviteStats.referrals_converted || 0),
      sharesTracked: Number(inviteStats.shares_tracked || 0),
      newUsers: Number(inviteStats.new_users || 0),
      conversionRate: inviteStats.invites_sent > 0
        ? Math.round((inviteStats.invites_accepted / inviteStats.invites_sent) * 100)
        : 0,
      viralCoefficient: Number(viralCoefficient),
      topInviters: topInviters.map(u => ({ name: u.name, handle: u.handle, total: Number(u.referral_count), period: Number(u.period_referrals) })),
      sharePlatforms: sharePlatforms.map(p => ({ platform: p.platform || 'unknown', count: Number(p.count) })),
      dailyTrend,
    })
  } catch (err) {
    console.error('GET /api/admin/viral-stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/invites — override to add rate limiting
// (Patches the existing POST /api/invites with rate limit check by registering a pre-middleware)
// NOTE: Rate limit is enforced via checkInviteRateLimit called inside the existing route handler.
// We add a global check middleware specifically for this path:
app.use('/api/invites', (req, res, next) => {
  if (req.method !== 'POST') return next()
  // Rate limit check requires userId — get it from session first
  const sessionId = req.headers['x-session-id'] || req.cookies?.fellis_session_id
  if (!sessionId) return next() // Let authenticate handle it
  // Async session lookup just for rate limiting (non-blocking failure)
  pool.query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId])
    .then(([rows]) => {
      if (rows.length && !checkInviteRateLimit(rows[0].user_id)) {
        return res.status(429).json({ error: 'Too many invitations sent. Please wait 15 minutes.' })
      }
      next()
    })
    .catch(() => next())
})

// ── Group Suggestion Routes ──

// GET /api/groups/suggestions — suggested public groups for the current user
// Collaborative filtering: groups shared by user's group-mates score highest;
// falls back to most popular public groups when user has no memberships yet.
app.get('/api/groups/suggestions', authenticate, async (req, res) => {
  try {
    const [suggestions] = await pool.query(
      `SELECT c.id, c.name, c.category, c.description_da, c.description_en,
              COUNT(DISTINCT cp2.user_id) AS shared_members,
              (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) AS member_count
       FROM conversations c
       JOIN conversation_participants cp2 ON cp2.conversation_id = c.id
       WHERE c.is_public = 1
         AND c.is_group = 1
         AND c.id NOT IN (
           SELECT conversation_id FROM conversation_participants WHERE user_id = ?
         )
         AND cp2.user_id IN (
           SELECT cp3.user_id FROM conversation_participants cp3
           WHERE cp3.conversation_id IN (
             SELECT conversation_id FROM conversation_participants WHERE user_id = ?
           )
           AND cp3.user_id != ?
         )
       GROUP BY c.id
       ORDER BY shared_members DESC, member_count DESC
       LIMIT 5`,
      [req.userId, req.userId, req.userId]
    )

    if (suggestions.length === 0) {
      // No collaborative matches — show most popular public groups
      const [popular] = await pool.query(
        `SELECT c.id, c.name, c.category, c.description_da, c.description_en,
                0 AS shared_members,
                COUNT(cp.user_id) AS member_count
         FROM conversations c
         LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
         WHERE c.is_public = 1
           AND c.is_group = 1
           AND c.id NOT IN (
             SELECT conversation_id FROM conversation_participants WHERE user_id = ?
           )
         GROUP BY c.id
         ORDER BY member_count DESC
         LIMIT 5`,
        [req.userId]
      )
      return res.json({ suggestions: popular })
    }

    res.json({ suggestions })
  } catch (err) {
    console.error('GET /api/groups/suggestions error:', err)
    res.status(500).json({ error: 'Failed to load group suggestions' })
  }
})

// POST /api/groups/:id/join — join a public group
app.post('/api/groups/:id/join', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_public = 1 AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found or not public' })
    await pool.query(
      'INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
      [groupId, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/join error:', err)
    res.status(500).json({ error: 'Failed to join group' })
  }
})

// ── Heartbeat (online presence) ──────────────────────────────────────────────
app.post('/api/me/heartbeat', authenticate, async (req, res) => {
  pool.query('UPDATE users SET last_active = NOW() WHERE id = ?', [req.userId]).catch(() => {})
  res.json({ ok: true })
})

// ── Profile update ────────────────────────────────────────────────────────────
app.patch('/api/profile', authenticate, async (req, res) => {
  const { name, bio_da, bio_en, location } = req.body
  try {
    const fields = [], vals = []
    if (name !== undefined)     { fields.push('name = ?');     vals.push(name.trim()) }
    if (bio_da !== undefined)   { fields.push('bio_da = ?');   vals.push(bio_da) }
    if (bio_en !== undefined)   { fields.push('bio_en = ?');   vals.push(bio_en) }
    if (location !== undefined) { fields.push('location = ?'); vals.push(location) }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
    vals.push(req.userId)
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals)
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile error:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// ── Config (public) ───────────────────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('stripe_pub_key')"
    )
    const cfg = {}
    for (const r of rows) cfg[r.key_name] = r.key_value
    if (process.env.FB_APP_ID) {
      cfg.fb_app_id = process.env.FB_APP_ID
      cfg.facebookEnabled = true
    }
    res.json({ config: cfg, facebookEnabled: !!process.env.FB_APP_ID })
  } catch { res.json({ config: {}, facebookEnabled: false }) }
})

// ── Changelog ─────────────────────────────────────────────────────────────────
app.get('/api/changelog', authenticate, async (req, res) => {
  res.json({ entries: [] })
})

// ── Notifications ─────────────────────────────────────────────────────────────
async function initNotifications() {
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    message_da TEXT NOT NULL,
    message_en TEXT NOT NULL,
    link VARCHAR(500) DEFAULT NULL,
    read_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(() => {})
}

async function createNotification(userId, type, messageDa, messageEn, link = null) {
  await pool.query(
    'INSERT INTO notifications (user_id, type, message_da, message_en, link) VALUES (?, ?, ?, ?, ?)',
    [userId, type, messageDa, messageEn, link]
  ).catch(err => console.error('createNotification error:', err.message))
}

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, type, message_da, message_en, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    )
    res.json({ notifications: rows })
  } catch {
    res.json({ notifications: [] })
  }
})

app.post('/api/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?', [req.params.id, req.userId]).catch(() => {})
  res.json({ ok: true })
})

app.post('/api/notifications/read-all', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.userId]).catch(() => {})
  res.json({ ok: true })
})

// ── Feed category suggestion ──────────────────────────────────────────────────
app.get('/api/feed/suggest-category', authenticate, async (req, res) => {
  const text = (req.query.text || '').toLowerCase()
  const MAP = [
    { keywords: ['mad', 'opskrift', 'food', 'recipe', 'pizza', 'kaffe', 'coffee'], cat: 'mad' },
    { keywords: ['musik', 'music', 'sang', 'song', 'band', 'concert', 'koncert'], cat: 'musik' },
    { keywords: ['rejse', 'travel', 'ferie', 'vacation', 'hotel', 'fly', 'flight'], cat: 'rejser' },
    { keywords: ['film', 'movie', 'serie', 'netflix', 'tv'], cat: 'film' },
    { keywords: ['teknologi', 'tech', 'ai', 'software', 'computer', 'kode', 'code'], cat: 'teknologi' },
    { keywords: ['sport', 'fodbold', 'football', 'løb', 'run', 'træning', 'workout'], cat: 'sundhed' },
    { keywords: ['kunst', 'art', 'maleri', 'painting', 'design', 'foto', 'photo'], cat: 'kunst' },
    { keywords: ['gaming', 'game', 'spil', 'playstation', 'xbox', 'pc'], cat: 'gaming' },
    { keywords: ['politik', 'politics', 'valg', 'election', 'regering', 'government'], cat: 'politik' },
    { keywords: ['natur', 'nature', 'skov', 'forest', 'dyr', 'animal', 'plante', 'plant'], cat: 'natur' },
    { keywords: ['bog', 'book', 'læs', 'read', 'roman', 'novel'], cat: 'boger' },
    { keywords: ['økonomi', 'finance', 'aktie', 'stock', 'invest', 'penge', 'money'], cat: 'okonomi' },
    { keywords: ['humor', 'sjov', 'funny', 'joke', 'griner', 'laugh'], cat: 'humor' },
    { keywords: ['mode', 'fashion', 'tøj', 'clothes', 'outfit', 'style'], cat: 'mode' },
    { keywords: ['diy', 'gør-det-selv', 'byg', 'build', 'reparér', 'fix'], cat: 'diy' },
  ]
  const match = MAP.find(m => m.keywords.some(kw => text.includes(kw)))
  res.json({ category: match ? match.cat : null })
})

// ── Jobs ──────────────────────────────────────────────────────────────────────
app.get('/api/jobs/mine', authenticate, async (req, res) => {
  res.json({ jobs: [] })
})

// ── Google Photos (stub) ──────────────────────────────────────────────────────
app.post('/api/providers/google-photos/download', authenticate, async (req, res) => {
  res.status(501).json({ error: 'Google Photos integration not configured on this server' })
})

// ── Post insights (real data) ─────────────────────────────────────────────────
app.get('/api/posts/:id/insights', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  if (isNaN(postId)) return res.status(400).json({ error: 'Invalid post ID' })
  try {
    const [[post]] = await pool.query(
      'SELECT id, likes FROM posts WHERE id = ? AND author_id = ?',
      [postId, req.userId]
    )
    if (!post) return res.status(403).json({ error: 'Not your post' })

    const [[views]] = await pool.query(
      'SELECT COUNT(*) AS reach, COALESCE(SUM(view_count), 0) AS impressions FROM post_views WHERE post_id = ?',
      [postId]
    )
    const [[cmt]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM comments WHERE post_id = ?',
      [postId]
    )
    let shares = 0
    try {
      const [[sh]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM share_tracks WHERE target_id = ? AND share_type = 'post'",
        [postId]
      )
      shares = Number(sh.cnt)
    } catch { shares = 0 }

    res.json({
      reach: Number(views.reach),
      impressions: Number(views.impressions),
      likes: post.likes || 0,
      comments: Number(cmt.cnt),
      shares,
    })
  } catch (err) {
    console.error('GET /api/posts/:id/insights error:', err)
    res.status(500).json({ error: 'Failed to load insights' })
  }
})

// ── Moderation ────────────────────────────────────────────────────────────────

// In-memory keyword filter cache (reloaded on change)
let keywordFilterCache = []
async function reloadKeywordFilters() {
  try {
    const [rows] = await pool.query('SELECT keyword, action, category, notes FROM keyword_filters')
    keywordFilterCache = rows
  } catch { keywordFilterCache = [] }
}
reloadKeywordFilters()

function checkKeywords(text) {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const f of keywordFilterCache) {
    if (lower.includes(f.keyword.toLowerCase())) return f
  }
  return null
}

// POST /api/users/:id/block — block a user
app.post('/api/users/:id/block', authenticate, async (req, res) => {
  const blockedId = parseInt(req.params.id)
  if (isNaN(blockedId) || blockedId === req.userId) return res.status(400).json({ error: 'Invalid user' })
  try {
    await pool.query(
      'INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)',
      [req.userId, blockedId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/users/:id/block error:', err)
    res.status(500).json({ error: 'Failed to block user' })
  }
})

// DELETE /api/users/:id/block — unblock a user
app.delete('/api/users/:id/block', authenticate, async (req, res) => {
  const blockedId = parseInt(req.params.id)
  if (isNaN(blockedId)) return res.status(400).json({ error: 'Invalid user' })
  try {
    await pool.query(
      'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?',
      [req.userId, blockedId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/users/:id/block error:', err)
    res.status(500).json({ error: 'Failed to unblock user' })
  }
})

// GET /api/me/blocks — get list of users I have blocked
app.get('/api/me/blocks', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, ub.created_at AS blocked_at
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = ?
       ORDER BY ub.created_at DESC`,
      [req.userId]
    )
    res.json({ blocks: rows })
  } catch (err) {
    console.error('GET /api/me/blocks error:', err)
    res.status(500).json({ error: 'Failed to load blocks' })
  }
})

// POST /api/reports — submit a report
app.post('/api/reports', authenticate, async (req, res) => {
  const { target_type, target_id, reason, details } = req.body
  if (!['post', 'comment', 'user'].includes(target_type)) return res.status(400).json({ error: 'Invalid target_type' })
  if (!target_id || !reason) return res.status(400).json({ error: 'target_id and reason required' })
  try {
    // Prevent duplicate reports from same user on same target
    const [existing] = await pool.query(
      'SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = "pending"',
      [req.userId, target_type, target_id]
    )
    if (existing.length > 0) return res.json({ ok: true, duplicate: true })
    await pool.query(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
      [req.userId, target_type, target_id, reason, details || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/reports error:', err)
    res.status(500).json({ error: 'Failed to submit report' })
  }
})

// GET /api/admin/moderation/queue — get pending reports (moderator+)
app.get('/api/admin/moderation/queue', authenticate, requireModerator, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
              u.name AS reporter_name, u.handle AS reporter_handle
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT 100`
    )
    // For each report, fetch a preview of the target
    const enriched = await Promise.all(rows.map(async (r) => {
      let preview = null
      try {
        if (r.target_type === 'post') {
          const [[p]] = await pool.query('SELECT p.text_da, p.text_en, u.name AS author FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?', [r.target_id])
          preview = p || null
        } else if (r.target_type === 'comment') {
          const [[c]] = await pool.query('SELECT c.text_da, c.text_en, u.name AS author, c.post_id FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?', [r.target_id])
          preview = c || null
        } else if (r.target_type === 'user') {
          const [[u]] = await pool.query('SELECT name, handle, status, strike_count FROM users WHERE id = ?', [r.target_id])
          preview = u || null
        }
      } catch { /* ignore */ }
      return { ...r, preview }
    }))
    res.json({ reports: enriched })
  } catch (err) {
    console.error('GET /api/admin/moderation/queue error:', err)
    res.status(500).json({ error: 'Failed to load moderation queue' })
  }
})

// POST /api/admin/moderation/reports/:id/dismiss — dismiss a report
app.post('/api/admin/moderation/reports/:id/dismiss', authenticate, requireModerator, async (req, res) => {
  const reportId = parseInt(req.params.id)
  if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid report ID' })
  try {
    await pool.query(
      'UPDATE reports SET status = "dismissed", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [req.userId, reportId]
    )
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, action_type, target_id, reason) VALUES (?, "dismiss_report", ?, ?)',
      [req.userId, reportId, req.body.reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/reports/:id/dismiss error:', err)
    res.status(500).json({ error: 'Failed to dismiss report' })
  }
})

// POST /api/admin/moderation/content/remove — remove a post or comment
app.post('/api/admin/moderation/content/remove', authenticate, requireModerator, async (req, res) => {
  const { type, target_id, report_id, reason } = req.body
  if (!['post', 'comment'].includes(type) || !target_id) return res.status(400).json({ error: 'Invalid type or target_id' })
  try {
    const table = type === 'post' ? 'posts' : 'comments'
    await pool.query(`DELETE FROM ${table} WHERE id = ?`, [target_id])
    if (report_id) {
      await pool.query(
        'UPDATE reports SET status = "actioned", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
        [req.userId, report_id]
      )
    }
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, action_type, target_type, target_id, reason) VALUES (?, "remove_content", ?, ?, ?)',
      [req.userId, type, target_id, reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/content/remove error:', err)
    res.status(500).json({ error: 'Failed to remove content' })
  }
})

// POST /api/admin/moderation/users/:id/warn — issue a warning (strike)
app.post('/api/admin/moderation/users/:id/warn', authenticate, requireModerator, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' })
  const { reason, report_id } = req.body
  try {
    await pool.query(
      'UPDATE users SET strike_count = strike_count + 1, last_strike_at = NOW() WHERE id = ?',
      [targetId]
    )
    if (report_id) {
      await pool.query(
        'UPDATE reports SET status = "actioned", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
        [req.userId, report_id]
      )
    }
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type, reason) VALUES (?, ?, "warn", ?)',
      [req.userId, targetId, reason || null]
    )
    // Send warning email if mailer is configured
    if (mailer) {
      const [[u]] = await pool.query('SELECT email, name FROM users WHERE id = ?', [targetId]).catch(() => [[null]])
      if (u?.email) {
        mailer.sendMail({
          to: u.email,
          subject: 'Advarsel fra fellis.eu / Warning from fellis.eu',
          text: `Hej ${u.name},\n\nDu har modtaget en advarsel på fellis.eu.\nÅrsag: ${reason || 'Brud på fællesskabsreglerne'}\n\nVenlig hilsen,\nfellis.eu\n\n---\n\nHi ${u.name},\n\nYou have received a warning on fellis.eu.\nReason: ${reason || 'Community guidelines violation'}\n\nBest regards,\nfellis.eu`,
        }).catch(() => {})
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/users/:id/warn error:', err)
    res.status(500).json({ error: 'Failed to warn user' })
  }
})

// POST /api/admin/moderation/users/:id/suspend — suspend a user temporarily
app.post('/api/admin/moderation/users/:id/suspend', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' })
  const { days = 7, reason, report_id } = req.body
  const suspendedUntil = new Date(Date.now() + days * 86400_000)
  try {
    await pool.query(
      'UPDATE users SET status = "suspended", suspended_until = ?, strike_count = strike_count + 1, last_strike_at = NOW() WHERE id = ?',
      [suspendedUntil, targetId]
    )
    // Invalidate all sessions for this user
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetId])
    if (report_id) {
      await pool.query(
        'UPDATE reports SET status = "actioned", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
        [req.userId, report_id]
      )
    }
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type, reason) VALUES (?, ?, "suspend", ?)',
      [req.userId, targetId, reason || null]
    )
    if (mailer) {
      const [[u]] = await pool.query('SELECT email, name FROM users WHERE id = ?', [targetId]).catch(() => [[null]])
      if (u?.email) {
        mailer.sendMail({
          to: u.email,
          subject: 'Konto suspenderet / Account suspended — fellis.eu',
          text: `Hej ${u.name},\n\nDin konto er blevet suspenderet i ${days} dage.\nÅrsag: ${reason || 'Brud på fællesskabsreglerne'}\n\nVenlig hilsen,\nfellis.eu\n\n---\n\nHi ${u.name},\n\nYour account has been suspended for ${days} days.\nReason: ${reason || 'Community guidelines violation'}\n\nBest regards,\nfellis.eu`,
        }).catch(() => {})
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/users/:id/suspend error:', err)
    res.status(500).json({ error: 'Failed to suspend user' })
  }
})

// POST /api/admin/moderation/users/:id/ban — permanently ban a user
app.post('/api/admin/moderation/users/:id/ban', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (isNaN(targetId) || targetId === req.userId) return res.status(400).json({ error: 'Invalid user ID' })
  const { reason, report_id } = req.body
  try {
    await pool.query('UPDATE users SET status = "banned" WHERE id = ?', [targetId])
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetId])
    if (report_id) {
      await pool.query(
        'UPDATE reports SET status = "actioned", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
        [req.userId, report_id]
      )
    }
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type, reason) VALUES (?, ?, "ban", ?)',
      [req.userId, targetId, reason || null]
    )
    if (mailer) {
      const [[u]] = await pool.query('SELECT email, name FROM users WHERE id = ?', [targetId]).catch(() => [[null]])
      if (u?.email) {
        mailer.sendMail({
          to: u.email,
          subject: 'Konto lukket / Account banned — fellis.eu',
          text: `Hej ${u.name},\n\nDin konto er blevet permanent lukket.\nÅrsag: ${reason || 'Brud på fællesskabsreglerne'}\n\nVenlig hilsen,\nfellis.eu\n\n---\n\nHi ${u.name},\n\nYour account has been permanently banned.\nReason: ${reason || 'Community guidelines violation'}\n\nBest regards,\nfellis.eu`,
        }).catch(() => {})
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/users/:id/ban error:', err)
    res.status(500).json({ error: 'Failed to ban user' })
  }
})

// POST /api/admin/moderation/users/:id/unban — lift a suspension or ban
app.post('/api/admin/moderation/users/:id/unban', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' })
  try {
    await pool.query(
      'UPDATE users SET status = "active", suspended_until = NULL WHERE id = ?',
      [targetId]
    )
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type) VALUES (?, ?, "unban")',
      [req.userId, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderation/users/:id/unban error:', err)
    res.status(500).json({ error: 'Failed to unban user' })
  }
})

// GET /api/admin/moderation/users — list users with moderation info (moderator+)
app.get('/api/admin/moderation/users', authenticate, requireModerator, async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : '%'
    const [rows] = await pool.query(
      `SELECT id, name, handle, email, status, strike_count, suspended_until, last_strike_at, created_at,
              moderator_candidate, moderator_candidate_note
       FROM users
       WHERE (name LIKE ? OR handle LIKE ? OR email LIKE ?)
       ORDER BY strike_count DESC, created_at DESC
       LIMIT 100`,
      [q, q, q]
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/users error:', err)
    res.status(500).json({ error: 'Failed to load users' })
  }
})

// GET /api/admin/moderation/keywords — list keyword filters
app.get('/api/admin/moderation/keywords', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, keyword, action, category, notes, created_at FROM keyword_filters ORDER BY created_at DESC')
    res.json({ keywords: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/keywords error:', err)
    res.status(500).json({ error: 'Failed to load keyword filters' })
  }
})

// POST /api/admin/moderation/keywords — add a keyword filter
app.post('/api/admin/moderation/keywords', authenticate, requireAdmin, async (req, res) => {
  const { keyword, action = 'flag', category = 'other', notes } = req.body
  const validActions = ['flag', 'block']
  const validCategories = ['profanity', 'hate_speech', 'sexual', 'violence', 'drugs', 'harassment', 'spam', 'other']
  if (!keyword || !validActions.includes(action) || !validCategories.includes(category)) return res.status(400).json({ error: 'keyword, valid action, and valid category required' })
  try {
    await pool.query(
      'INSERT INTO keyword_filters (keyword, action, category, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      [keyword.trim().toLowerCase(), action, category, notes?.trim() || null, req.userId]
    )
    await reloadKeywordFilters()
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Keyword already exists' })
    console.error('POST /api/admin/moderation/keywords error:', err)
    res.status(500).json({ error: 'Failed to add keyword filter' })
  }
})

// PATCH /api/admin/moderation/keywords/:id — update a keyword filter
app.patch('/api/admin/moderation/keywords/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' })
  const { keyword, action, category, notes } = req.body
  const validActions = ['flag', 'block']
  const validCategories = ['profanity', 'hate_speech', 'sexual', 'violence', 'drugs', 'harassment', 'spam', 'other']
  if (!keyword || !validActions.includes(action) || !validCategories.includes(category)) return res.status(400).json({ error: 'keyword, valid action, and valid category required' })
  try {
    await pool.query(
      'UPDATE keyword_filters SET keyword = ?, action = ?, category = ?, notes = ? WHERE id = ?',
      [keyword.trim().toLowerCase(), action, category, notes?.trim() || null, id]
    )
    await reloadKeywordFilters()
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/admin/moderation/keywords/:id error:', err)
    res.status(500).json({ error: 'Failed to update keyword filter' })
  }
})

// DELETE /api/admin/moderation/keywords/:id — remove a keyword filter
app.delete('/api/admin/moderation/keywords/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' })
  try {
    await pool.query('DELETE FROM keyword_filters WHERE id = ?', [id])
    await reloadKeywordFilters()
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/admin/moderation/keywords/:id error:', err)
    res.status(500).json({ error: 'Failed to delete keyword filter' })
  }
})

// GET /api/admin/moderation/actions — recent moderation audit log (moderator+)
app.get('/api/admin/moderation/actions', authenticate, requireModerator, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ma.id, ma.action_type, ma.target_type, ma.target_id, ma.reason, ma.created_at,
              a.name AS admin_name,
              tu.name AS target_user_name, tu.handle AS target_user_handle
       FROM moderation_actions ma
       JOIN users a ON a.id = ma.admin_id
       LEFT JOIN users tu ON tu.id = ma.target_user_id
       ORDER BY ma.created_at DESC
       LIMIT 200`
    )
    res.json({ actions: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/actions error:', err)
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

// GET /api/admin/moderation/candidates — list moderator candidates
app.get('/api/admin/moderation/candidates', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, handle, email, status, strike_count, moderator_candidate_note, moderator_candidate_at, created_at
       FROM users
       WHERE moderator_candidate = 1
       ORDER BY moderator_candidate_at DESC`
    )
    res.json({ candidates: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/candidates error:', err)
    res.status(500).json({ error: 'Failed to load candidates' })
  }
})

// PATCH /api/admin/moderation/users/:id/candidate — mark/unmark as moderator candidate
app.patch('/api/admin/moderation/users/:id/candidate', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' })
  const { is_candidate, note } = req.body
  try {
    await pool.query(
      `UPDATE users SET moderator_candidate = ?, moderator_candidate_note = ?, moderator_candidate_at = ? WHERE id = ?`,
      [is_candidate ? 1 : 0, is_candidate ? (note || null) : null, is_candidate ? new Date() : null, id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/admin/moderation/users/:id/candidate error:', err)
    res.status(500).json({ error: 'Failed to update candidate status' })
  }
})

// ── Moderator management (admin, invite-only) ────────────────────────────────

// GET /api/admin/moderators — list current moderators
app.get('/api/admin/moderators', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, handle, email, created_at FROM users WHERE is_moderator = 1 ORDER BY name ASC`
    )
    res.json({ moderators: rows })
  } catch (err) {
    console.error('GET /api/admin/moderators error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/admin/moderators/:userId/grant — assign moderator status (invite)
app.post('/api/admin/moderators/:userId/grant', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (!targetId || targetId === 1) return res.status(400).json({ error: 'Invalid target' })
  try {
    const [[user]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [targetId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    await pool.query('UPDATE users SET is_moderator = 1, moderator_candidate = 0 WHERE id = ?', [targetId])
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type) VALUES (?, ?, "grant_moderator")',
      [req.userId, targetId]
    )
    await createNotification(
      targetId, 'moderator_granted',
      'Du er nu moderator på fellis.eu 🛡️',
      'You are now a moderator on fellis.eu 🛡️',
      '/moderation'
    )
    if (mailer && user.email) {
      mailer.sendMail({
        to: user.email,
        subject: 'Du er nu moderator på fellis.eu',
        text: `Hej ${user.name},\n\nDu er nu moderator på fellis.eu.\n\nSom moderator kan du behandle rapporter, fjerne indhold og advare brugere. Log ind og find "Moderation" i menuen.\n\nVenlig hilsen,\nfellis.eu\n\n---\n\nHi ${user.name},\n\nYou are now a moderator on fellis.eu.\n\nAs a moderator you can handle reports, remove content, and warn users. Log in and find "Moderation" in the menu.\n\nBest regards,\nfellis.eu`,
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderators/:userId/grant error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/admin/moderators/:userId/revoke — remove moderator status
app.post('/api/admin/moderators/:userId/revoke', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (!targetId) return res.status(400).json({ error: 'Invalid target' })
  try {
    await pool.query('UPDATE users SET is_moderator = 0 WHERE id = ?', [targetId])
    await pool.query(
      'INSERT INTO moderation_actions (admin_id, target_user_id, action_type) VALUES (?, ?, "revoke_moderator")',
      [req.userId, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderators/:userId/revoke error:', err.message)
    res.status(500).json({ error: 'Server error' })
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

// Wildcard stub for client-only/unimplemented endpoints
app.all('/api/stub/:fn', authenticate, (req, res) => res.json({ ok: true }))

// Prevent unhandled promise rejections from crashing the process (PM2 would
// restart, dropping all live SSE connections in the process).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (caught at process level):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (caught at process level):', err)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`fellis.eu API running on http://localhost:${PORT}`)
  if (!FB_TOKEN_KEY) {
    console.warn('⚠️  WARNING: FB_TOKEN_ENCRYPTION_KEY not set. Facebook tokens will be stored unencrypted.')
    console.warn('   Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
  initNotifications()
  initEvents()
  initFriendRequests()
  initConversations()
  initMarketplace()
  initCompanies()
  initAdminSettings()
  initAnalytics()
  initSettingsSchema()
  initSiteVisits()
  initViralGrowth()
  initReels()
  initAds()
  initAdminAdSettings()
})

app.all('/api/stub/:fn', authenticate, (req, res) => res.json({ ok: true }))

app.post('/api/upload/file', authenticate, (req, res) => res.json({ ok: true, url: null }))
