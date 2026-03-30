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
import bcrypt from 'bcrypt'
import fs from 'fs'
import multer from 'multer'
import pool from './db.js'
import { sendSms } from './sms.js'
import { BADGES, BADGE_BY_ID, PLATFORM_LAUNCH_DATE, BADGE_AD_FREE_DAYS } from '../src/badges/badgeDefinitions.js'
import { evaluateBadges } from '../src/badges/badgeEngine.js'

// MySQL 8.x compatible ADD COLUMN helper — ignores duplicate column error (errno 1060)
// SECURITY: Validates table and column names to prevent SQL injection
async function addCol(table, col, def) {
  // Whitelist table names used in migrations
  const VALID_TABLES = ['users', 'posts', 'comments', 'friendships', 'companies',
    'admin_ad_settings', 'admin_settings', 'reels', 'marketplace_listings', 'jobs',
    'shared_jobs', 'earned_badges', 'user_badges', 'badge_config']

  // Validate table name
  if (!VALID_TABLES.includes(table)) {
    throw new Error(`Invalid table name: ${table}`)
  }

  // Validate column name: alphanumeric + underscore only
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
    throw new Error(`Invalid column name: ${col}`)
  }

  // Validate column definition: basic check for common SQL keywords
  const def_lower = def.toLowerCase()
  const ALLOWED_KEYWORDS = ['varchar', 'int', 'bigint', 'timestamp', 'boolean', 'text', 'datetime',
    'decimal', 'not null', 'null', 'default', 'unique', 'current_timestamp']
  const isValid = ALLOWED_KEYWORDS.some(kw => def_lower.includes(kw)) &&
                  !def.includes(';') && !def.includes('--') && !def.includes('/*')

  if (!isValid) {
    throw new Error(`Invalid column definition: ${def}`)
  }

  try {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`)
  } catch (e) {
    if (e.errno !== 1060) throw e
  }
}

// ── Account Lockout — brute force protection ───────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MINUTES = 15

// ── Signal Engine — constants ─────────────────────────────────────────────────
const SIGNAL_VALUES = {
  click: 3, dwell_short: 5, dwell_long: 10,
  like: 8, comment: 12, share: 15,
  scroll_past: -1, quick_close: -3, block: -20,
}
const CONTEXT_MULTIPLIERS = { professional: 1.4, hobby: 1.0, purchase: 1.6 }

// Apply signals to interest_scores using the scoring formula:
// new_weight = old_weight + (signal_value × context_multiplier) × (1 − saturation)
// Saturation = current_weight/100, preventing weight from exceeding 100.
// Negative signals can reduce weight toward 0 but never below it.
async function applySignals(userId, signals) {
  // signals: [{ interest_slug, signal_type, context? }]
  const grouped = {}
  for (const s of signals) {
    const ctx = s.context || 'hobby'
    const key = `${s.interest_slug}:${ctx}`
    if (!grouped[key]) grouped[key] = { interest_slug: s.interest_slug, context: ctx, totalDelta: 0 }
    const sv = SIGNAL_VALUES[s.signal_type] ?? 0
    const cm = CONTEXT_MULTIPLIERS[ctx] ?? 1.0
    grouped[key].totalDelta += sv * cm
  }
  for (const { interest_slug, context, totalDelta } of Object.values(grouped)) {
    try {
      // Frequency cap: if >10 signals of any type from this user+interest in last hour, throttle
      const [[cap]] = await pool.query(
        `SELECT COUNT(*) as cnt FROM interest_signals
         WHERE user_id=? AND interest_slug=? AND created_at > NOW() - INTERVAL 1 HOUR`,
        [userId, interest_slug]
      )
      const effectiveDelta = cap.cnt >= 10 ? totalDelta * 0.1 : totalDelta
      const [[cur]] = await pool.query(
        'SELECT weight FROM interest_scores WHERE user_id=? AND interest_slug=? AND context=?',
        [userId, interest_slug, context]
      ).catch(() => [[null]])
      const oldWeight = cur ? cur.weight : 0
      // Saturation for positive signals; for negative signals allow decay freely
      const saturation = effectiveDelta > 0 ? oldWeight / 100 : 0
      const newWeight = Math.max(0, Math.min(100, oldWeight + effectiveDelta * (1 - saturation)))
      await pool.query(
        `INSERT INTO interest_scores (user_id, interest_slug, context, weight, last_signal_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE weight=?, last_signal_at=NOW()`,
        [userId, interest_slug, context, newWeight, newWeight]
      )
    } catch (err) {
      // Table may not exist yet on first boot before initSignalEngine runs — ignore silently
    }
  }
}

// Fire-and-forget signal helper: looks up post categories and generates signals server-side
function autoSignalPost(userId, postId, signalType) {
  pool.query('SELECT categories FROM posts WHERE id=?', [postId])
    .then(([[post]]) => {
      if (!post?.categories) return
      let cats
      try { cats = JSON.parse(post.categories) } catch { return }
      if (!Array.isArray(cats) || cats.length === 0) return
      const sv = SIGNAL_VALUES[signalType] ?? 0
      if (sv === 0) return
      const values = cats.map(slug => [userId, slug, signalType, sv, 'hobby', 'post', postId])
      pool.query(
        'INSERT INTO interest_signals (user_id, interest_slug, signal_type, signal_value, context, source_type, source_id) VALUES ?',
        [values]
      ).catch(() => {})
      applySignals(userId, cats.map(slug => ({ interest_slug: slug, signal_type: signalType, context: 'hobby' }))).catch(() => {})
    })
    .catch(() => {})
}

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
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || null

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
    await addCol('event_rsvps', 'dietary', 'VARCHAR(255) DEFAULT NULL').catch(() => {})
    await addCol('event_rsvps', 'plus_one', 'TINYINT(1) DEFAULT 0').catch(() => {})
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

// ── In-memory rate limiter (forgot-password anti-abuse) ──
// Tracks {email → {count, resetAt}} — max 3 requests per email per hour
const forgotRateLimit = new Map()
const FORGOT_MAX = 3
const FORGOT_WINDOW_MS = 60 * 60 * 1000

function checkForgotRateLimit(email) {
  const key = email.toLowerCase()
  const now = Date.now()
  const entry = forgotRateLimit.get(key)
  if (!entry || now > entry.resetAt) {
    forgotRateLimit.set(key, { count: 1, resetAt: now + FORGOT_WINDOW_MS })
    return true
  }
  if (entry.count >= FORGOT_MAX) return false
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
    await pool.query('ALTER TABLE friendships ADD COLUMN is_family TINYINT(1) NOT NULL DEFAULT 0').catch(() => {})
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
    // Read receipts: track when each participant last read the conversation
    await addCol('conversation_participants', 'last_read_at', 'TIMESTAMP NULL DEFAULT NULL')
    // Admin mute: conversation creator can mute individual members
    await addCol('conversation_participants', 'admin_muted_until', 'DATETIME DEFAULT NULL')
    // Family group flag
    await addCol('conversations', 'is_family_group', 'TINYINT(1) NOT NULL DEFAULT 0')
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
async function auditLogGdpr(userId, action, details = null, ipAddress = null) {
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
  await auditLogGdpr(userId, 'consent_given', { consent_type: consentType }, ipAddress)
}

async function withdrawConsent(userId, consentType, ipAddress = null) {
  await pool.query(
    'UPDATE gdpr_consent SET consent_given = 0, withdrawn_at = NOW() WHERE user_id = ? AND consent_type = ? AND consent_given = 1',
    [userId, consentType]
  )
  await auditLogGdpr(userId, 'consent_withdrawn', { consent_type: consentType }, ipAddress)
}

// Data retention: Facebook tokens expire after 90 days (configurable)
const FB_DATA_RETENTION_DAYS = parseInt(process.env.FB_DATA_RETENTION_DAYS || '90')

const app = express()
app.use(express.json())

// ── CORS Configuration — explicit whitelist ────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://fellis.eu',
  'https://www.fellis.eu',
  'http://localhost:5173',    // Vite dev server
  'http://localhost:3000',    // Alternative dev server
  process.env.SITE_URL,       // From environment
].filter(Boolean)

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, Authorization')
    res.set('Access-Control-Allow-Credentials', 'true')
    res.set('Access-Control-Max-Age', '86400') // 24 hours
  }
  // Always handle preflight
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Rate limiting — in-memory, per IP + per user ──────────────────────────
// Buckets: Map<key, { count, resetAt }>
const _rl = new Map()
function rateLimit({ windowMs = 60_000, max = 60, keyFn = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const key = keyFn(req)
    const now = Date.now()
    let bucket = _rl.get(key)
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs }
      _rl.set(key, bucket)
    }
    bucket.count++
    if (bucket.count > max) {
      res.set('Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
      return res.status(429).json({ error: 'Too many requests — prøv igen om lidt' })
    }
    next()
  }
}
// Purge stale buckets every 5 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _rl) { if (now > v.resetAt) _rl.delete(k) }
}, 5 * 60_000)

// Strict limiter for auth + write endpoints: 30 req/min per IP
const strictLimit = rateLimit({ windowMs: 60_000, max: 30 })
// Standard limiter for general write endpoints: 60 req/min per user id (falls back to IP)
const writeLimit = rateLimit({
  windowMs: 60_000, max: 60,
  keyFn: (req) => (req.userId ? `u:${req.userId}` : req.ip),
})
// File upload limiter: 10 uploads/hour per user (to prevent DoS/storage exhaustion)
const fileUploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  keyFn: (req) => (req.userId ? `u:${req.userId}` : req.ip),
  message: 'Too many file uploads — max 10 per hour'
})

// ── Serve built frontend (assets/, index.html, public/) ───────────────────
const FRONTEND_ROOT = path.resolve(__dirname, '..')
app.use(express.static(FRONTEND_ROOT, { index: false }))

// ── Health check ─────────────────────────────────────────────────────────
const SERVER_START = Date.now()
app.get('/api/health', async (_req, res) => {
  let dbOk = false
  try {
    await pool.query('SELECT 1')
    dbOk = true
  } catch {}
  const uptimeSec = Math.floor((Date.now() - SERVER_START) / 1000)
  const status = dbOk ? 200 : 503
  res.status(status).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'error',
    uptime_sec: uptimeSec,
    ts: new Date().toISOString(),
  })
})

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
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

// ── CSRF Token Helpers ─────────────────────────────────────────────────────
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex')

function generateCsrfToken(sessionId) {
  // Generate CSRF token: HMAC-SHA256(session_id, secret)
  return crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(sessionId)
    .digest('hex')
}

function verifyCsrfToken(sessionId, token) {
  // Timing-safe comparison
  const expected = generateCsrfToken(sessionId)
  return crypto.timingSafeEqual(
    Buffer.from(token || ''),
    Buffer.from(expected)
  ).valueOf()
}

// CSRF validation middleware for state-changing requests
function validateCsrf(req, res, next) {
  // Skip CSRF for GET/HEAD/OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

  const sessionId = getSessionIdFromRequest(req)
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })

  const csrfToken = req.headers['x-csrf-token'] || req.body?.csrf_token
  if (!csrfToken) return res.status(403).json({ error: 'CSRF token required' })

  try {
    if (!verifyCsrfToken(sessionId, csrfToken)) {
      return res.status(403).json({ error: 'Invalid CSRF token' })
    }
    next()
  } catch (err) {
    // Timing safe comparison may fail if token is malformed
    res.status(403).json({ error: 'Invalid CSRF token' })
  }
}

// ── Audit Logging Helper ───────────────────────────────────────────────────
// Logs security-relevant events for compliance and monitoring
async function auditLog(req, action, resourceType = null, resourceId = null, {
  status = 'success',
  oldValue = null,
  newValue = null,
  details = null,
} = {}) {
  const userId = req.userId || null
  const ipAddress = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
  const userAgent = req.headers?.['user-agent'] || null

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        resourceType,
        resourceId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress,
        userAgent,
        status,
        details ? JSON.stringify(details) : null,
      ]
    )
  } catch (err) {
    console.error(`[AUDIT LOG ERROR] ${action}:`, err.message)
    // Don't throw — logging failures shouldn't break the main operation
  }
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

const ALLOWED_DOC_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
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

const uploadDoc = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOC_MIME_TYPES.has(file.mimetype)) return cb(new Error('File type not allowed'))
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) return cb(new Error('Invalid filename'))
    cb(null, true)
  },
})

// Auto-migrations
addCol('comments', 'media', 'JSON DEFAULT NULL')
  .catch(err => console.error('Migration (comments.media):', err.message))
addCol('post_likes', 'reaction', "VARCHAR(10) DEFAULT '❤️'")
  .catch(err => console.error('Migration (post_likes.reaction):', err.message))
addCol('invitations', 'invitee_email', 'VARCHAR(255) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.invitee_email):', err.message))
addCol('marketplace_listings', 'contact_phone', 'VARCHAR(20) DEFAULT NULL')
  .catch(err => console.error('Migration (marketplace_listings.contact_phone):', err.message))
addCol('marketplace_listings', 'contact_email', 'VARCHAR(255) DEFAULT NULL')
  .catch(err => console.error('Migration (marketplace_listings.contact_email):', err.message))
addCol('marketplace_listings', 'sold', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (marketplace_listings.sold):', err.message))
addCol('marketplace_listings', 'priceNegotiable', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (marketplace_listings.priceNegotiable):', err.message))

addCol('users', 'fb_token_expires_at', 'DATETIME DEFAULT NULL')
  .catch(err => console.error('Migration (users.fb_token_expires_at):', err.message))
addCol('users', 'fb_data_imported_at', 'DATETIME DEFAULT NULL')
  .catch(err => console.error('Migration (users.fb_data_imported_at):', err.message))
addCol('users', 'mode', "VARCHAR(20) DEFAULT 'privat'")
  .catch(err => console.error('Migration (users.mode):', err.message))
addCol('users', 'plan', "VARCHAR(30) DEFAULT 'business'")
  .catch(err => console.error('Migration (users.plan):', err.message))
addCol('users', 'ads_free', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.ads_free):', err.message))
addCol('users', 'stripe_customer_id', 'VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (users.stripe_customer_id):', err.message))
addCol('users', 'ads_free_sub_id', 'VARCHAR(200) DEFAULT NULL')
  .catch(err => console.error('Migration (users.ads_free_sub_id):', err.message))
addCol('users', 'cv_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.cv_public):', err.message))
addCol('users', 'phone', 'VARCHAR(20) DEFAULT NULL')
  .catch(err => console.error('Migration (users.phone):', err.message))
addCol('users', 'password_plain', 'VARCHAR(255) DEFAULT NULL')
  .catch(err => console.error('Migration (users.password_plain):', err.message))
addCol('users', 'mfa_enabled', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.mfa_enabled):', err.message))
addCol('users', 'mfa_code', 'VARCHAR(64) DEFAULT NULL')
  .catch(err => console.error('Migration (users.mfa_code):', err.message))
addCol('users', 'mfa_code_expires', 'DATETIME DEFAULT NULL')
  .catch(err => console.error('Migration (users.mfa_code_expires):', err.message))
addCol('users', 'failed_login_attempts', 'INT DEFAULT 0')
  .catch(err => console.error('Migration (users.failed_login_attempts):', err.message))
addCol('users', 'locked_until', 'TIMESTAMP NULL DEFAULT NULL')
  .catch(err => console.error('Migration (users.locked_until):', err.message))
// Reset ads_free for users with no active Mollie adfree subscription (clears stale Stripe flags).
pool.query(`
  UPDATE users SET ads_free = 0
  WHERE ads_free = 1
    AND id NOT IN (
      SELECT user_id FROM subscriptions
      WHERE status = 'paid'
        AND plan NOT IN ('ad_activation')
        AND (expires_at IS NULL OR expires_at > NOW())
    )
`).catch(err => console.error('Migration (ads_free cleanup):', err.message))

// ── Viral growth auto-migrations ──
addCol('users', 'profile_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.profile_public):', err.message))
addCol('users', 'reputation_score', 'INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.reputation_score):', err.message))
addCol('users', 'referral_count', 'INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.referral_count):', err.message))
addCol('invitations', 'invite_source', "ENUM('link','email','facebook','other') DEFAULT 'link'")
  .catch(err => console.error('Migration (invitations.invite_source):', err.message))
addCol('invitations', 'utm_source', 'VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.utm_source):', err.message))
addCol('invitations', 'utm_campaign', 'VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (invitations.utm_campaign):', err.message))
addCol('posts', 'share_token', 'VARCHAR(64) DEFAULT NULL')
  .catch(err => console.error('Migration (posts.share_token):', err.message))
addCol('posts', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (posts.is_public):', err.message))
addCol('posts', 'share_count', 'INT(11) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (posts.share_count):', err.message))
// Tagging people + linking content to posts
addCol('posts', 'tagged_users', 'JSON DEFAULT NULL')
  .catch(err => console.error('Migration (posts.tagged_users):', err.message))
addCol('posts', 'linked_type', 'VARCHAR(20) DEFAULT NULL')
  .catch(err => console.error('Migration (posts.linked_type):', err.message))
addCol('posts', 'linked_id', 'INT DEFAULT NULL')
  .catch(err => console.error('Migration (posts.linked_id):', err.message))
// Tagging people in reels
addCol('reels', 'tagged_users', 'JSON DEFAULT NULL')
  .catch(err => console.error('Migration (reels.tagged_users):', err.message))

// ── Group suggestions auto-migrations ──
addCol('conversations', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (conversations.is_public):', err.message))
addCol('conversations', 'category', 'VARCHAR(100) DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.category):', err.message))
addCol('conversations', 'description_da', 'TEXT DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.description_da):', err.message))
addCol('conversations', 'description_en', 'TEXT DEFAULT NULL')
  .catch(err => console.error('Migration (conversations.description_en):', err.message))

// Platform ads table
pool.query(`CREATE TABLE IF NOT EXISTS platform_ads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  image_url VARCHAR(2000) DEFAULT NULL,
  link_url VARCHAR(2000) NOT NULL,
  zone VARCHAR(50) DEFAULT 'display',
  mode VARCHAR(20) DEFAULT 'all',
  status ENUM('active','inactive') DEFAULT 'active',
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`).catch(err => console.error('Migration (platform_ads table):', err.message))

// Columns needed by login handler — must exist before first request
addCol('sessions', 'user_agent', 'VARCHAR(500) DEFAULT NULL')
  .catch(err => console.error('Migration (sessions.user_agent):', err.message))
addCol('sessions', 'ip_address', 'VARCHAR(50) DEFAULT NULL')
  .catch(err => console.error('Migration (sessions.ip_address):', err.message))
addCol('users', 'failed_login_attempts', 'INT NOT NULL DEFAULT 0')
  .catch(err => console.error('Migration (users.failed_login_attempts):', err.message))
addCol('users', 'locked_until', 'DATETIME DEFAULT NULL')
  .catch(err => console.error('Migration (users.locked_until):', err.message))

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

    // Load admin role from admin_roles table (replaces hardcoded user.id === 1)
    const [adminRows] = await pool.query(
      'SELECT role FROM admin_roles WHERE user_id = ?', [req.userId]
    ).catch(() => []) // Silently fail if table doesn't exist yet
    req.adminRole = adminRows.length > 0 ? adminRows[0].role : null
    // Backward compatibility: Grant super_admin to original admin
    if (req.userId === 1 && !req.adminRole) req.adminRole = 'super_admin'

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

// POST /api/auth/login — login with email + password (MFA-aware)
app.post('/api/auth/login', strictLimit, async (req, res) => {
  const { email, password, lang } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?', [email]
    )
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' })
    const user = users[0]

    // Check if account is locked due to brute force attempts
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000)
      return res.status(429).json({
        error: `Account locked due to too many failed login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`
      })
    }

    // Verify password (support bcrypt, legacy SHA-256, and legacy plaintext)
    let passwordValid = false
    if (user.password_hash && user.password_hash.startsWith('$2')) {
      // Bcrypt hash — try direct compare first
      passwordValid = await bcrypt.compare(password, user.password_hash)
      if (!passwordValid) {
        // Fallback: previous migration may have stored bcrypt(sha256(password))
        const sha256hex = crypto.createHash('sha256').update(password).digest('hex')
        passwordValid = await bcrypt.compare(sha256hex, user.password_hash)
        if (passwordValid) {
          // Re-hash properly as bcrypt(plaintext) going forward
          const bcryptHash = await bcrypt.hash(password, 10)
          await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcryptHash, user.id])
        }
      }
    } else if (user.password_hash && /^[0-9a-f]{64}$/.test(user.password_hash)) {
      // Legacy SHA-256 hash — verify and migrate to bcrypt
      const sha256 = crypto.createHash('sha256').update(password).digest('hex')
      passwordValid = sha256 === user.password_hash
      console.log(`[LOGIN DEBUG] sha256 match: ${passwordValid}`)
      if (passwordValid) {
        const bcryptHash = await bcrypt.hash(password, 10)
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcryptHash, user.id])
      }
    } else if (user.password_plain === password) {
      // Legacy plaintext match — migrate to bcrypt and clear plaintext
      passwordValid = true
      const bcryptHash = await bcrypt.hash(password, 10)
      await pool.query('UPDATE users SET password_hash = ?, password_plain = NULL WHERE id = ?', [bcryptHash, user.id])
    }

    if (!passwordValid) {
      // Increment failed login attempts (columns may not exist on older installs — ignore errors)
      const newAttempts = (user.failed_login_attempts || 0) + 1

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        await pool.query(
          'UPDATE users SET failed_login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [newAttempts, LOCKOUT_DURATION_MINUTES, user.id]
        ).catch(() => {})
        // Audit log: account locked
        await auditLog({ ...req, userId: user.id }, 'login_failed_account_locked', 'user', user.id, {
          status: 'failure',
          details: { attempts: newAttempts, reason: 'brute_force_protection' }
        })
        return res.status(429).json({
          error: `Too many failed login attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes.`
        })
      } else {
        await pool.query(
          'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
          [newAttempts, user.id]
        ).catch(() => {})
        // Audit log: failed login attempt
        await auditLog({ ...req, userId: user.id }, 'login_failed', 'user', user.id, {
          status: 'failure',
          details: { attempts: newAttempts, remaining_before_lockout: MAX_LOGIN_ATTEMPTS - newAttempts }
        })
        return res.status(401).json({ error: 'Invalid credentials' })
      }
    }

    // Password valid: reset failed attempts counter (columns may not exist on older installs)
    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id])
      .catch(() => {}) // ignore if columns don't exist yet

    // MFA: if enabled and user has a phone number, send SMS code
    if (user.mfa_enabled && user.phone) {
      const rawCode = String(Math.floor(100000 + Math.random() * 900000))
      const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
      await pool.query(
        'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
        [hashedCode, user.id]
      )
      const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
      if (!smsSent) {
        console.error(`MFA SMS failed to send for user ${user.id} — 46elks may not be configured`)
        return res.status(503).json({ error: 'SMS service unavailable — could not send verification code' })
      }
      return res.json({ mfa_required: true, userId: user.id })
    }

    // No MFA — create session immediately
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    // Try with user_agent/ip_address columns; fall back if they don't exist yet
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, user.id, lang || 'da', ua, ip]
    ).catch(() =>
      pool.query(
        'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
        [sessionId, user.id, lang || 'da']
      )
    )
    setSessionCookie(res, sessionId)
    // Audit log: successful login
    await auditLog(
      { ...req, userId: user.id },
      'login',
      'user',
      user.id,
      { status: 'success', details: { mfa_enabled: !!user.mfa_enabled } }
    )
    res.json({ sessionId, userId: user.id })
  } catch (err) {
    console.error('[/api/auth/login] 500 error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/register — create account after migration
app.post('/api/auth/register', strictLimit, async (req, res) => {
  const { name, email, password, lang, inviteToken } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' })
  const regPolicy = await getPasswordPolicy()
  const regPwdErrors = validatePasswordStrength(password, regPolicy, lang || 'da')
  if (regPwdErrors.length > 0) return res.status(400).json({ error: regPwdErrors.join('. ') })
  try {
    const bcryptHash = await bcrypt.hash(password, 10)
    const handle = '@' + name.toLowerCase().replace(/\s+/g, '.')
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase()
    const userInviteToken = crypto.randomBytes(32).toString('hex')
    const [result] = await pool.query(
      'INSERT INTO users (name, handle, initials, email, password_hash, join_date, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, handle, initials, email, bcryptHash, new Date().toISOString(), userInviteToken]
    )
    const newUserId = result.insertId
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, newUserId, lang || 'da', ua, ip]
    ).catch(() =>
      pool.query(
        'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
        [sessionId, newUserId, lang || 'da']
      )
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
          // Notify inviter that their invitation was accepted
          const [[newUser]] = await pool.query('SELECT name FROM users WHERE id = ?', [newUserId]).catch(() => [[null]])
          if (newUser) {
            createNotification(referrerId, 'friend_accepted',
              `${newUser.name} accepterede din invitation og er nu din ven`,
              `${newUser.name} accepted your invitation and is now your friend`,
              newUserId, newUser.name
            )
          }
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

// POST /api/auth/forgot-password — request password reset link via email
app.post('/api/auth/forgot-password', strictLimit, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })

  // Rate limit: max 3 requests per email per hour
  if (!checkForgotRateLimit(email)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  try {
    const [users] = await pool.query(
      'SELECT id, name, facebook_id, password_hash FROM users WHERE email = ?', [email]
    )
    // Always return success to avoid leaking whether the email exists
    if (users.length === 0) return res.json({ ok: true })

    const user = users[0]
    // Generate a cryptographically random token and store its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')
    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
      [hashedToken, user.id]
    )

    const siteBase = process.env.SITE_URL || 'https://fellis.eu'
    const resetUrl = `${siteBase}/?reset_token=${rawToken}`

    if (mailer) {
      const fromAddr = process.env.MAIL_FROM || process.env.MAIL_USER
      await mailer.sendMail({
        from: `"Fellis" <${fromAddr}>`,
        to: email,
        subject: 'Nulstil din adgangskode / Reset your password',
        text: `Hej ${user.name},\n\nKlik her for at nulstille din adgangskode (linket udløber om 1 time):\n${resetUrl}\n\nHvis du ikke bad om dette, kan du ignorere denne e-mail.\n\nVenlig hilsen,\nFellis`,
        html: `<p>Hej <strong>${user.name}</strong>,</p><p>Klik her for at nulstille din adgangskode (linket udløber om 1 time):</p><p><a href="${resetUrl}" style="background:#2D6A4F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Nulstil adgangskode</a></p><p style="color:#888;font-size:12px">Eller kopier dette link: ${resetUrl}</p><p style="color:#888;font-size:12px">Hvis du ikke bad om dette, kan du ignorere denne e-mail.</p>`,
      }).catch(err => console.error('Reset mail error:', err.message))
    } else {
      // Dev fallback: log the token (never expose in production without MAIL_HOST)
      console.info(`[dev] Password reset link for ${email}: ${resetUrl}`)
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Request failed' })
  }
})

// POST /api/auth/reset-password — set new password using reset token
app.post('/api/auth/reset-password', strictLimit, async (req, res) => {
  const { token, password, lang: resetLang } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  const resetPolicy = await getPasswordPolicy()
  const resetPwdErrors = validatePasswordStrength(password, resetPolicy, resetLang || 'da')
  if (resetPwdErrors.length > 0) return res.status(400).json({ error: resetPwdErrors.join('. ') })
  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [hashedToken]
    )
    if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset token' })
    const userId = rows[0].id
    const bcryptHash = await bcrypt.hash(password, 10)
    // Update password and clear reset token atomically
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [bcryptHash, userId]
    )
    // Create a new login session
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, resetLang || 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ ok: true, sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' })
  }
})

// POST /api/auth/verify-mfa — verify SMS code and complete login
app.post('/api/auth/verify-mfa', strictLimit, async (req, res) => {
  const { userId, code, lang } = req.body
  if (!userId || !code) return res.status(400).json({ error: 'userId and code required' })
  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND mfa_code_expires > NOW()',
      [userId]
    )
    if (rows.length === 0) return res.status(400).json({ error: 'Code expired or user not found' })
    const hashedCode = crypto.createHash('sha256').update(String(code)).digest('hex')
    const [valid] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND mfa_code = ?',
      [userId, hashedCode]
    )
    if (valid.length === 0) return res.status(401).json({ error: 'Invalid code' })
    // Clear MFA code and create session
    await pool.query(
      'UPDATE users SET mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [userId]
    )
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, lang || 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'MFA verification failed' })
  }
})

// POST /api/auth/enable-mfa — enable SMS MFA for current user (requires phone on account)
app.post('/api/auth/enable-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT phone FROM users WHERE id = ?', [req.userId])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' })
    if (!rows[0].phone) return res.status(400).json({ error: 'A phone number is required to enable MFA' })
    await pool.query('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [req.userId])
    // Audit log: MFA enabled
    await auditLog(req, 'mfa_enable', 'user', req.userId, { status: 'success' })
    res.json({ ok: true, mfa_enabled: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable MFA' })
  }
})

// POST /api/auth/disable-mfa — disable SMS MFA for current user
app.post('/api/auth/disable-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET mfa_enabled = 0, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?',
      [req.userId]
    )
    // Audit log: MFA disabled
    await auditLog(req, 'mfa_disable', 'user', req.userId, { status: 'success' })
    res.json({ ok: true, mfa_enabled: false })
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable MFA' })
  }
})

// POST /api/auth/send-settings-mfa — send SMS MFA code for sensitive settings changes
app.post('/api/auth/send-settings-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT phone, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.mfa_enabled) return res.status(400).json({ error: 'MFA not enabled' })
    if (!user.phone) return res.status(400).json({ error: 'No phone number on account' })
    const rawCode = String(Math.floor(100000 + Math.random() * 900000))
    const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
    await pool.query(
      'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
      [hashedCode, req.userId]
    )
    const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
    if (!smsSent) {
      console.error(`Settings MFA SMS failed to send for user ${req.userId} — 46elks may not be configured`)
      return res.status(503).json({ error: 'SMS service unavailable — could not send verification code' })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send MFA code' })
  }
})

// PATCH /api/profile/phone — update phone number for current user
app.patch('/api/profile/phone', authenticate, async (req, res) => {
  const { phone } = req.body
  // Allow clearing phone (empty string → null), or set a new number
  const cleaned = phone ? phone.trim() : null
  // Basic E.164 validation if provided
  if (cleaned && !/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format, e.g. +4512345678' })
  }
  try {
    // If clearing the phone number, also disable MFA to avoid locked-out state
    if (!cleaned) {
      await pool.query('UPDATE users SET phone = NULL, mfa_enabled = 0, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [req.userId])
    } else {
      await pool.query('UPDATE users SET phone = ? WHERE id = ?', [cleaned, req.userId])
    }
    res.json({ ok: true, phone: cleaned })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update phone number' })
  }
})

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId])
  clearSessionCookie(res)
  res.json({ ok: true })
})

// GET /api/csrf-token — get CSRF token for this session (must be authenticated)
app.get('/api/csrf-token', authenticate, async (req, res) => {
  try {
    const sessionId = getSessionIdFromRequest(req)
    if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })
    const csrfToken = generateCsrfToken(sessionId)
    res.json({ csrfToken })
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate CSRF token' })
  }
})

// GET /api/auth/session — check if session is valid
app.get('/api/auth/session', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, handle, initials, avatar_url, mode, ads_free, is_moderator FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    // Compute ads_free dynamically: today must fall within an active earned-day assignment
    // OR an active purchased period — never rely on the static users.ads_free column
    const today = new Date().toISOString().split('T')[0]
    const [[activeRow]] = await pool.query(`
      SELECT (
        (SELECT COUNT(*) FROM adfree_day_assignments
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
        (SELECT COUNT(*) FROM adfree_purchased_periods
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
      ) AS total
    `, [req.userId, today, today, req.userId, today, today]).catch(() => [[{ total: 0 }]])
    const ads_free = (activeRow?.total ?? 0) > 0
    const user = { ...users[0], mode: users[0].mode || 'privat', ads_free, is_admin: users[0].id === 1, is_moderator: Boolean(users[0].is_moderator) || users[0].id === 1 }
    res.json({ user, lang: req.lang })
  } catch (err) {
    res.status(500).json({ error: 'Session check failed' })
  }
})

// ── Google OAuth ──

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://fellis.eu/api/auth/google/callback'

app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google integration not configured' })
  const state = crypto.randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

app.get('/api/auth/google/callback', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.redirect('/?error=google_not_configured')
  const { code, error } = req.query
  if (error || !code) return res.redirect('/?error=google_denied')
  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/?error=google_token_failed')
    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const gUser = await userRes.json()
    if (!gUser.sub) return res.redirect('/?error=google_userinfo_failed')

    const sessionId = getSessionIdFromRequest(req)
    if (sessionId) {
      // Logged-in user: connect Google to existing account
      const [[sess]] = await pool.query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId])
      if (sess) {
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [gUser.sub, sess.user_id])
        return res.redirect('/?google_connected=1')
      }
    }
    // Not logged in: login or register via Google
    const [[existing]] = await pool.query('SELECT id FROM users WHERE google_id = ?', [gUser.sub])
    let userId
    if (existing) {
      userId = existing.id
    } else if (gUser.email) {
      const [[byEmail]] = await pool.query('SELECT id FROM users WHERE email = ?', [gUser.email])
      if (byEmail) {
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [gUser.sub, byEmail.id])
        userId = byEmail.id
      } else {
        // Create new account
        const handle = (gUser.email.split('@')[0] + Math.floor(Math.random() * 1000)).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30)
        const name = gUser.name || gUser.email.split('@')[0]
        const [ins] = await pool.query(
          'INSERT INTO users (name, handle, email, google_id, avatar_url, interests, created_at) VALUES (?,?,?,?,?,?,NOW())',
          [name, handle, gUser.email, gUser.sub, gUser.picture || null, JSON.stringify([])]
        )
        userId = ins.insertId
      }
    } else {
      return res.redirect('/?error=google_no_email')
    }
    // Create session
    const newSessId = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', [newSessId, userId, expiresAt])
    res.redirect(`/?google_session=${newSessId}`)
  } catch (err) {
    console.error('Google OAuth callback error:', err.message)
    res.redirect('/?error=google_error')
  }
})

// ── LinkedIn OAuth ──

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://fellis.eu/api/auth/linkedin/callback'

app.get('/api/auth/linkedin', (req, res) => {
  if (!LINKEDIN_CLIENT_ID) return res.status(500).json({ error: 'LinkedIn integration not configured' })
  const state = crypto.randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    scope: 'openid profile email',
    state,
  })
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`)
})

app.get('/api/auth/linkedin/callback', async (req, res) => {
  if (!LINKEDIN_CLIENT_ID) return res.redirect('/?error=linkedin_not_configured')
  const { code, error } = req.query
  if (error || !code) return res.redirect('/?error=linkedin_denied')
  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: LINKEDIN_REDIRECT_URI,
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/?error=linkedin_token_failed')
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const lUser = await userRes.json()
    if (!lUser.sub) return res.redirect('/?error=linkedin_userinfo_failed')

    const sessionId = getSessionIdFromRequest(req)
    if (sessionId) {
      const [[sess]] = await pool.query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId])
      if (sess) {
        await pool.query('UPDATE users SET linkedin_id = ? WHERE id = ?', [lUser.sub, sess.user_id])
        return res.redirect('/?linkedin_connected=1')
      }
    }
    const [[existing]] = await pool.query('SELECT id FROM users WHERE linkedin_id = ?', [lUser.sub])
    let userId
    if (existing) {
      userId = existing.id
    } else if (lUser.email) {
      const [[byEmail]] = await pool.query('SELECT id FROM users WHERE email = ?', [lUser.email])
      if (byEmail) {
        await pool.query('UPDATE users SET linkedin_id = ? WHERE id = ?', [lUser.sub, byEmail.id])
        userId = byEmail.id
      } else {
        const handle = (lUser.email.split('@')[0] + Math.floor(Math.random() * 1000)).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30)
        const [ins] = await pool.query(
          'INSERT INTO users (name, handle, email, linkedin_id, avatar_url, interests, created_at) VALUES (?,?,?,?,?,?,NOW())',
          [lUser.name || lUser.email.split('@')[0], handle, lUser.email, lUser.sub, lUser.picture || null, JSON.stringify([])]
        )
        userId = ins.insertId
      }
    } else {
      return res.redirect('/?error=linkedin_no_email')
    }
    const newSessId = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', [newSessId, userId, expiresAt])
    res.redirect(`/?linkedin_session=${newSessId}`)
  } catch (err) {
    console.error('LinkedIn OAuth callback error:', err.message)
    res.redirect('/?error=linkedin_error')
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
    await auditLogGdpr(userId, 'fb_auth_success', { facebook_id: fbProfile.id }, clientIp)

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
  await auditLogGdpr(userId, 'fb_import_start', { timestamp: new Date().toISOString() })

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

  await auditLogGdpr(userId, 'fb_import_complete', {
    friends: friendsImported, posts: postsImported, photos: photosImported
  })
}

// ── Profile routes ──

// GET /api/profile/:id — public profile (friend view)
app.get('/api/profile/:id', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    let users
    try {
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
          u.industry, u.seniority, u.job_title, u.company,
          u.mode, u.follower_count, u.community_score,
          u.business_category, u.business_website, u.business_hours,
          u.business_description_da, u.business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count,
          (SELECT COUNT(*) FROM friendships f1
             JOIN friendships f2 ON f1.friend_id = f2.friend_id
             WHERE f1.user_id = ? AND f2.user_id = u.id) as mutual_count,
          (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = u.id) as is_friend,
          (SELECT COUNT(*) FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') as request_sent
         FROM users u WHERE u.id = ?`,
        [req.userId, req.userId, req.userId, targetId]
      )
    } catch {
      // Phase 1/2 migration columns not yet applied — fall back without them
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
          u.industry, u.seniority, u.job_title, u.company,
          u.mode,
          0 AS follower_count, 0 AS community_score,
          NULL AS business_category, NULL AS business_website, NULL AS business_hours,
          NULL AS business_description_da, NULL AS business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count,
          (SELECT COUNT(*) FROM friendships f1
             JOIN friendships f2 ON f1.friend_id = f2.friend_id
             WHERE f1.user_id = ? AND f2.user_id = u.id) as mutual_count,
          (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = u.id) as is_friend,
          (SELECT COUNT(*) FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') as request_sent
         FROM users u WHERE u.id = ?`,
        [req.userId, req.userId, req.userId, targetId]
      )
    }
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    // Check block status separately (user_blocks table is optional — added via migrate-moderation.sql)
    let isBlocked = false
    try {
      const [[blockRow]] = await pool.query(
        'SELECT COUNT(*) as cnt FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?',
        [req.userId, targetId]
      )
      isBlocked = blockRow.cnt > 0
    } catch { /* table not yet created */ }
    // Log profile view (fire-and-forget, skip self-views)
    // source_post_id tracks which post led to the visit (for analytics)
    if (targetId !== req.userId) {
      const sourcePostId = parseInt(req.query.source_post_id) || null
      pool.query(
        'INSERT INTO profile_views (viewer_id, profile_id, source_post_id) VALUES (?, ?, ?)',
        [req.userId, targetId, sourcePostId]
      ).catch(() => {})
    }
    // Fetch earned badges for the target user
    let badges = []
    try {
      const lang = req.lang || 'da'
      const [badgeRows] = await pool.query(
        'SELECT badge_id, awarded_at FROM earned_badges WHERE user_id = ? ORDER BY awarded_at ASC',
        [targetId]
      )
      badges = badgeRows.map(r => {
        const def = BADGE_BY_ID[r.badge_id]
        if (!def) return null
        return { id: r.badge_id, icon: def.icon, name: def.name[lang] || def.name.da, tier: def.tier, awardedAt: r.awarded_at }
      }).filter(Boolean)
    } catch { /* badges table may not exist yet */ }
    const profilePayload = {
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      avatarUrl: u.avatar_url || null,
      mode: u.mode || 'privat',
      industry: u.industry || null,
      seniority: u.seniority || null,
      jobTitle: u.job_title || null,
      company: u.company || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
      mutualCount: u.mutual_count || 0,
      isFriend: !!u.is_friend,
      requestSent: !!u.request_sent,
      isBlocked,
      badges,
    }
    if (u.mode === 'business') {
      profilePayload.businessCategory = u.business_category || null
      profilePayload.businessWebsite = u.business_website || null
      profilePayload.businessHours = u.business_hours || null
      profilePayload.businessDescription = { da: u.business_description_da || '', en: u.business_description_en || '' }
      profilePayload.followerCount = Number(u.follower_count || 0)
      profilePayload.communityScore = Number(u.community_score || 0)
      // Check if the requesting user is following this business
      let isFollowing = false
      try {
        const [[fRow]] = await pool.query(
          'SELECT 1 FROM business_follows WHERE follower_id = ? AND business_id = ?',
          [req.userId, targetId]
        )
        isFollowing = !!fRow
      } catch {}
      profilePayload.isFollowing = isFollowing
    }
    res.json(profilePayload)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// GET /api/profile/:id/photos — posts with images/video from a user (max 30)
app.get('/api/profile/:id/photos', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT id, media, created_at
       FROM posts
       WHERE author_id = ? AND media IS NOT NULL AND media != 'null' AND scheduled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 30`,
      [targetId]
    )
    const photos = []
    for (const row of rows) {
      let media = []
      try { media = JSON.parse(row.media) || [] } catch { continue }
      for (const m of media) {
        if (m?.url) photos.push({ postId: row.id, url: m.url, type: m.type || 'image', created_at: row.created_at })
      }
    }
    res.json(photos.slice(0, 30))
  } catch (err) {
    console.error('GET /api/profile/:id/photos error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/profile/:id/posts — recent posts by a user (max 10)
app.get('/api/profile/:id/posts', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.likes, p.created_at,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
       FROM posts p
       WHERE p.author_id = ? AND p.scheduled_at IS NULL
       ORDER BY p.created_at DESC LIMIT 10`,
      [targetId]
    )
    res.json(rows.map(p => {
      let media = []
      try { media = JSON.parse(p.media) || [] } catch { /* ignore */ }
      return { id: p.id, text_da: p.text_da, text_en: p.text_en, media, likes: p.likes, comment_count: p.comment_count, created_at: p.created_at }
    }))
  } catch (err) {
    console.error('GET /api/profile/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/profile — current user profile
app.get('/api/profile', authenticate, async (req, res) => {
  try {
    let users
    try {
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
          u.email, u.facebook_id, u.google_id, u.linkedin_id, u.password_hash, u.password_plain, u.created_at, u.birthday,
          u.profile_public, u.reputation_score, u.referral_count, u.interests, u.tags,
          u.relationship_status, u.website,
          u.phone, u.mfa_enabled,
          u.industry, u.seniority, u.job_title, u.company,
          u.mode,
          u.business_category, u.business_website, u.business_hours,
          u.business_description_da, u.business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
         FROM users u WHERE u.id = ?`,
        [req.userId]
      )
    } catch {
      // Phase 1 migration columns not yet applied — fall back without business_* columns
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url,
          u.email, u.facebook_id, u.google_id, u.linkedin_id, u.password_hash, u.password_plain, u.created_at, u.birthday,
          u.profile_public, u.reputation_score, u.referral_count, u.interests, u.tags,
          u.relationship_status, u.website,
          u.phone, u.mfa_enabled,
          u.industry, u.seniority, u.job_title, u.company,
          u.mode,
          NULL AS business_category, NULL AS business_website, NULL AS business_hours,
          NULL AS business_description_da, NULL AS business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
         FROM users u WHERE u.id = ?`,
        [req.userId]
      )
    }
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    let interests = []
    try { interests = typeof u.interests === 'string' ? JSON.parse(u.interests) : (u.interests || []) } catch {}
    let tags = []
    try { tags = typeof u.tags === 'string' ? JSON.parse(u.tags) : (u.tags || []) } catch {}
    const payload = {
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      avatarUrl: u.avatar_url || null,
      mode: u.mode || 'privat',
      industry: u.industry || null,
      seniority: u.seniority || null,
      jobTitle: u.job_title || null,
      company: u.company || null,
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
      interests, tags,
      relationship_status: u.relationship_status || null,
      website: u.website || null,
      connectedProviders: {
        facebook: !!u.facebook_id,
        google: !!u.google_id,
        linkedin: !!u.linkedin_id,
      },
      phone: u.phone || null,
      mfaEnabled: !!u.mfa_enabled,
    }
    if (u.mode === 'business') {
      payload.businessCategory = u.business_category || null
      payload.businessWebsite = u.business_website || null
      payload.businessHours = u.business_hours || null
      payload.businessDescription = { da: u.business_description_da || '', en: u.business_description_en || '' }
    }
    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// GET /api/user/handle/:handle — get user by handle (public, no auth required)
app.get('/api/user/handle/:handle', async (req, res) => {
  const handle = req.params.handle.toLowerCase()
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name FROM users u WHERE LOWER(u.handle) = ?`,
      [handle]
    )
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    res.json({ id: users[0].id })
  } catch (err) {
    console.error('GET /api/user/handle/:handle error:', err.message)
    res.status(500).json({ error: 'Server error' })
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
  const VALID_LANGS = ['da','en','de','fr','es','it','nl','sv','no','fi','pl','pt','ro','hu','cs','sk','hr','bg','el','lt','lv','et','sl','mt','ga','lb']
  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: 'Invalid lang' })
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

// PATCH /api/me/tags — save user tags (max 10, max 30 chars each)
app.patch('/api/me/tags', authenticate, async (req, res) => {
  const { tags } = req.body
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' })
  const clean = tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10)
  try {
    await pool.query('UPDATE users SET tags = ? WHERE id = ?', [JSON.stringify(clean), req.userId])
    res.json({ ok: true, tags: clean })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tags' })
  }
})

// PATCH /api/me/profile-extended — update relationship_status + website
app.patch('/api/me/profile-extended', authenticate, async (req, res) => {
  const { relationship_status, website } = req.body
  const VALID_REL = ['single','in_relationship','married','engaged','open','prefer_not']
  const fields = [], vals = []
  if (relationship_status !== undefined) {
    const rel = VALID_REL.includes(relationship_status) ? relationship_status : null
    fields.push('relationship_status = ?'); vals.push(rel)
  }
  if (website !== undefined) {
    const url = website ? String(website).trim().slice(0, 300) : null
    fields.push('website = ?'); vals.push(url)
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
  try {
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...vals, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// PATCH /api/me/business-profile — update business-only profile fields
app.patch('/api/me/business-profile', authenticate, async (req, res) => {
  const { business_category, business_website, business_hours, business_description_da, business_description_en } = req.body
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    if (business_website) {
      try { new URL(business_website) } catch {
        return res.status(400).json({ error: 'Invalid URL' })
      }
    }
    await pool.query(
      `UPDATE users SET
        business_category = ?,
        business_website = ?,
        business_hours = ?,
        business_description_da = ?,
        business_description_en = ?
       WHERE id = ?`,
      [
        business_category || null,
        business_website || null,
        business_hours || null,
        business_description_da || null,
        business_description_en || null,
        req.userId,
      ]
    )
    res.json({
      ok: true,
      businessCategory: business_category || null,
      businessWebsite: business_website || null,
      businessHours: business_hours || null,
      businessDescription: {
        da: business_description_da || '',
        en: business_description_en || '',
      },
    })
  } catch (err) {
    console.error('PATCH /api/me/business-profile error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Business Discovery ────────────────────────────────────────────────────────

// GET /api/businesses — paginated list of business accounts
app.get('/api/businesses', async (req, res) => {
  const { category, q, limit: limitRaw, offset: offsetRaw } = req.query
  const limit = Math.min(parseInt(limitRaw) || 20, 50)
  const offset = parseInt(offsetRaw) || 0
  // Optional auth — determine if caller is logged in
  let callerId = null
  try {
    const sessionId = req.cookies?.fellis_sid
    if (sessionId) {
      const [[sess]] = await pool.query(
        'SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()',
        [sessionId]
      )
      if (sess) callerId = sess.user_id
    }
  } catch {}
  try {
    const conditions = ["u.mode = 'business'"]
    const params = []
    if (category) { conditions.push('u.business_category = ?'); params.push(category) }
    if (q) { conditions.push('(u.name LIKE ? OR u.business_category LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    const where = conditions.join(' AND ')
    let rows
    try {
      ;[rows] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                u.business_website, u.business_hours, u.bio_da, u.bio_en,
                u.follower_count, u.community_score
         FROM users u
         WHERE ${where}
         ORDER BY u.community_score DESC, u.follower_count DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )
    } catch {
      // Phase 2 migration not yet applied — fall back without new columns
      ;[rows] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                u.business_website, u.business_hours, u.bio_da, u.bio_en,
                0 AS follower_count, 0 AS community_score
         FROM users u
         WHERE ${where}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )
    }
    let followedSet = new Set()
    if (callerId && rows.length) {
      const ids = rows.map(r => r.id)
      const [fRows] = await pool.query(
        `SELECT business_id FROM business_follows WHERE follower_id = ? AND business_id IN (?)`,
        [callerId, ids]
      ).catch(() => [[]])
      followedSet = new Set(fRows.map(r => r.business_id))
    }
    res.json({
      businesses: rows.map(r => ({
        id: r.id, name: r.name, handle: r.handle,
        avatarUrl: r.avatar_url || null,
        businessCategory: r.business_category || null,
        businessWebsite: r.business_website || null,
        businessHours: r.business_hours || null,
        bio: { da: r.bio_da || '', en: r.bio_en || '' },
        followerCount: Number(r.follower_count || 0),
        communityScore: Number(r.community_score || 0),
        isFollowing: followedSet.has(r.id),
      })),
      total: rows.length,
      limit,
      offset,
    })
  } catch (err) {
    console.error('GET /api/businesses error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/businesses/suggested — businesses matched to user interests
app.get('/api/businesses/suggested', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    // Try to match businesses by user's top interest slugs
    let rows = []
    try {
      ;[rows] = await pool.query(
        `SELECT DISTINCT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                u.business_website, u.business_hours, u.bio_da, u.bio_en,
                u.follower_count, u.community_score
         FROM users u
         JOIN interest_scores iss ON iss.user_id = ?
           AND (u.business_category LIKE CONCAT('%', iss.interest_slug, '%')
                OR iss.interest_slug LIKE CONCAT('%', u.business_category, '%'))
         WHERE u.mode = 'business'
           AND u.id != ?
           AND iss.weight > 10
         ORDER BY iss.weight DESC, u.community_score DESC
         LIMIT 10`,
        [req.userId, req.userId]
      )
    } catch {}
    // Fall back to top businesses by community_score (graceful if Phase 2 migration not yet run)
    if (!rows.length) {
      try {
        ;[rows] = await pool.query(
          `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                  u.business_website, u.business_hours, u.bio_da, u.bio_en,
                  u.follower_count, u.community_score
           FROM users u
           WHERE u.mode = 'business' AND u.id != ?
           ORDER BY u.community_score DESC, u.follower_count DESC
           LIMIT 10`,
          [req.userId]
        )
      } catch {
        ;[rows] = await pool.query(
          `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                  u.business_website, u.business_hours, u.bio_da, u.bio_en,
                  0 AS follower_count, 0 AS community_score
           FROM users u
           WHERE u.mode = 'business' AND u.id != ?
           ORDER BY u.created_at DESC
           LIMIT 10`,
          [req.userId]
        )
      }
    }
    const ids = rows.map(r => r.id)
    let followedSet = new Set()
    if (ids.length) {
      const [fRows] = await pool.query(
        'SELECT business_id FROM business_follows WHERE follower_id = ? AND business_id IN (?)',
        [req.userId, ids]
      ).catch(() => [[]])
      followedSet = new Set(fRows.map(r => r.business_id))
    }
    res.json(rows.map(r => ({
      id: r.id, name: r.name, handle: r.handle,
      avatarUrl: r.avatar_url || null,
      businessCategory: r.business_category || null,
      businessWebsite: r.business_website || null,
      businessHours: r.business_hours || null,
      bio: { da: r.bio_da || '', en: r.bio_en || '' },
      followerCount: Number(r.follower_count || 0),
      communityScore: Number(r.community_score || 0),
      isFollowing: followedSet.has(r.id),
    })))
  } catch (err) {
    console.error('GET /api/businesses/suggested error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/businesses/:handle — public business profile
app.get('/api/businesses/:handle', async (req, res) => {
  const handle = req.params.handle.startsWith('@') ? req.params.handle : '@' + req.params.handle
  // Optional auth
  let callerId = null
  try {
    const sessionId = req.cookies?.fellis_sid
    if (sessionId) {
      const [[sess]] = await pool.query(
        'SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()',
        [sessionId]
      )
      if (sess) callerId = sess.user_id
    }
  } catch {}
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, u.bio_da, u.bio_en, u.location, u.join_date,
              u.business_category, u.business_website, u.business_hours,
              u.business_description_da, u.business_description_en,
              u.follower_count, u.community_score, u.mode
       FROM users u WHERE u.handle = ? AND u.mode = 'business'`,
      [handle]
    )
    if (!rows.length) return res.status(404).json({ error: 'Business not found' })
    const biz = rows[0]
    // Recent posts
    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at
       FROM posts p WHERE p.author_id = ? AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
       ORDER BY p.created_at DESC LIMIT 5`,
      [biz.id]
    )
    let isFollowing = false
    if (callerId) {
      const [[fRow]] = await pool.query(
        'SELECT 1 FROM business_follows WHERE follower_id = ? AND business_id = ?',
        [callerId, biz.id]
      ).catch(() => [[null]])
      isFollowing = !!fRow
    }
    res.json({
      id: biz.id, name: biz.name, handle: biz.handle,
      avatarUrl: biz.avatar_url || null,
      bio: { da: biz.bio_da || '', en: biz.bio_en || '' },
      location: biz.location || null,
      joinDate: biz.join_date,
      businessCategory: biz.business_category || null,
      businessWebsite: biz.business_website || null,
      businessHours: biz.business_hours || null,
      businessDescription: { da: biz.business_description_da || '', en: biz.business_description_en || '' },
      followerCount: Number(biz.follower_count || 0),
      communityScore: Number(biz.community_score || 0),
      isFollowing,
      posts: posts.map(p => ({
        id: p.id,
        text: { da: p.text_da, en: p.text_en },
        time: { da: p.time_da, en: p.time_en },
        likes: p.likes,
        media: p.media,
        createdAt: p.created_at,
      })),
    })
  } catch (err) {
    console.error('GET /api/businesses/:handle error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/businesses/:id/follow — follow a business account
app.post('/api/businesses/:id/follow', authenticate, async (req, res) => {
  const bizId = parseInt(req.params.id)
  try {
    const [[biz]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    try {
      await pool.query(
        'INSERT INTO business_follows (follower_id, business_id) VALUES (?, ?)',
        [req.userId, bizId]
      )
      await pool.query('UPDATE users SET follower_count = follower_count + 1 WHERE id = ?', [bizId])
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.json({ following: true }) // already following — idempotent
      throw e
    }
    res.json({ following: true })
  } catch (err) {
    console.error('POST /api/businesses/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/businesses/:id/follow — unfollow a business account
app.delete('/api/businesses/:id/follow', authenticate, async (req, res) => {
  const bizId = parseInt(req.params.id)
  try {
    const [[biz]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    const [result] = await pool.query(
      'DELETE FROM business_follows WHERE follower_id = ? AND business_id = ?',
      [req.userId, bizId]
    )
    if (result.affectedRows > 0) {
      await pool.query('UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = ?', [bizId])
    }
    res.json({ following: false })
  } catch (err) {
    console.error('DELETE /api/businesses/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/profile/avatar — upload profile picture
app.post('/api/profile/avatar', authenticate, fileUploadLimit, upload.single('avatar'), async (req, res) => {
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

// Helper: verify a settings MFA code (returns true if valid or MFA not enabled, false if invalid)
async function verifySettingsMfaCode(userId, mfaCode) {
  const [[user]] = await pool.query(
    'SELECT mfa_enabled, mfa_code, mfa_code_expires FROM users WHERE id = ?', [userId]
  )
  if (!user || !user.mfa_enabled) return true // MFA not enabled — no check needed
  if (!mfaCode) return false
  if (!user.mfa_code || !user.mfa_code_expires) return false
  if (new Date(user.mfa_code_expires) < new Date()) return false
  const hashed = crypto.createHash('sha256').update(String(mfaCode)).digest('hex')
  if (hashed !== user.mfa_code) return false
  // Clear the code so it can only be used once
  await pool.query('UPDATE users SET mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [userId])
  return true
}

// PATCH /api/profile/email — change email address
app.patch('/api/profile/email', authenticate, async (req, res) => {
  const { newEmail, password, mfaCode } = req.body
  if (!newEmail || !password) return res.status(400).json({ error: 'newEmail and password required' })
  try {
    const [[user]] = await pool.query('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const passwordMatch = user.password_hash && await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) return res.status(401).json({ error: 'Wrong password' })
    // MFA check
    if (user.mfa_enabled) {
      if (!mfaCode) return res.status(403).json({ error: 'mfa_required' })
      const mfaOk = await verifySettingsMfaCode(req.userId, mfaCode)
      if (!mfaOk) return res.status(401).json({ error: 'Invalid or expired MFA code' })
    }
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
  const { currentPassword, newPassword, lang: chgLang, mfaCode } = req.body
  if (!newPassword) return res.status(400).json({ error: 'newPassword required' })
  const chgPolicy = await getPasswordPolicy()
  const chgPwdErrors = validatePasswordStrength(newPassword, chgPolicy, chgLang || 'da')
  if (chgPwdErrors.length > 0) return res.status(400).json({ error: chgPwdErrors.join('. ') })
  try {
    const [[user]] = await pool.query('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    // If user has no password yet (imported from Facebook), allow setting without current password
    if (user.password_hash) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword required' })
      const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash)
      if (!passwordMatch) return res.status(401).json({ error: 'Wrong current password' })
    }
    // MFA check
    if (user.mfa_enabled) {
      if (!mfaCode) return res.status(403).json({ error: 'mfa_required' })
      const mfaOk = await verifySettingsMfaCode(req.userId, mfaCode)
      if (!mfaOk) return res.status(401).json({ error: 'Invalid or expired MFA code' })
    }
    const newHash = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.userId])
    // Audit log: password changed
    await auditLog(req, 'password_change', 'user', req.userId, { status: 'success' })
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
      `SELECT profile_visibility, friend_request_privacy, post_default_visibility,
              message_privacy, comment_privacy, searchable, show_online_status,
              analytics_opt_out, allow_tagging, friend_list_visibility
       FROM users WHERE id = ?`,
      [req.userId]
    )
    res.json({
      profile_visibility:       user?.profile_visibility       || 'all',
      friend_request_privacy:   user?.friend_request_privacy   || 'all',
      post_default_visibility:  user?.post_default_visibility  || 'all',
      message_privacy:          user?.message_privacy          || 'all',
      comment_privacy:          user?.comment_privacy          || 'all',
      searchable:               user?.searchable               ?? 1,
      show_online_status:       user?.show_online_status       ?? 1,
      analytics_opt_out:        user?.analytics_opt_out        ?? 0,
      allow_tagging:            user?.allow_tagging            ?? 1,
      friend_list_visibility:   user?.friend_list_visibility   || 'all',
    })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/settings/privacy
app.patch('/api/settings/privacy', authenticate, async (req, res) => {
  const {
    profile_visibility, friend_request_privacy, post_default_visibility,
    message_privacy, comment_privacy, searchable, show_online_status,
    analytics_opt_out, allow_tagging, friend_list_visibility,
  } = req.body
  const fields = []
  const vals = []
  const enumCol = (v, allowed, col) => { if (allowed.includes(v)) { fields.push(`${col} = ?`); vals.push(v) } }
  const boolCol = (v, col) => { if (v !== undefined) { fields.push(`${col} = ?`); vals.push(v ? 1 : 0) } }
  enumCol(profile_visibility,      ['all','friends'],                          'profile_visibility')
  enumCol(friend_request_privacy,  ['all','friends_of_friends'],               'friend_request_privacy')
  enumCol(post_default_visibility, ['all','friends','only_me'],                'post_default_visibility')
  enumCol(message_privacy,         ['all','friends'],                          'message_privacy')
  enumCol(comment_privacy,         ['all','friends'],                          'comment_privacy')
  enumCol(friend_list_visibility,  ['all','friends','only_me'],                'friend_list_visibility')
  boolCol(searchable,        'searchable')
  boolCol(show_online_status,'show_online_status')
  boolCol(analytics_opt_out, 'analytics_opt_out')
  boolCol(allow_tagging,     'allow_tagging')
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
  try {
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...vals, req.userId])
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

// GET /api/linked-content?type=job|listing|event&id=:id — fetch preview card for tagged content
app.get('/api/linked-content', authenticate, async (req, res) => {
  const { type, id } = req.query
  if (!type || !id) return res.status(400).json({ error: 'type and id required' })
  const numId = parseInt(id)
  if (!numId) return res.status(400).json({ error: 'invalid id' })
  try {
    if (type === 'job') {
      const [[row]] = await pool.query(
        `SELECT j.id, j.title, j.location, j.remote, j.type as job_type, c.name as company_name, c.color as company_color
         FROM jobs j JOIN companies c ON j.company_id = c.id WHERE j.id = ? AND j.active = 1`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      return res.json({ type: 'job', item: row })
    }
    if (type === 'listing') {
      const [[row]] = await pool.query(
        `SELECT id, title, price, category, location, photos FROM marketplace_listings WHERE id = ? AND sold = 0`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      let photos = null
      try { photos = row.photos ? (typeof row.photos === 'string' ? JSON.parse(row.photos) : row.photos) : null } catch {}
      return res.json({ type: 'listing', item: { ...row, photos } })
    }
    if (type === 'event') {
      const [[row]] = await pool.query(
        `SELECT e.id, e.title, e.date, e.location, e.event_type, e.cover_url, u.name as organizer
         FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = ?`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      return res.json({ type: 'event', item: row })
    }
    res.status(400).json({ error: 'unknown type' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/feed — cursor-based pagination (stable, no duplicate posts on new inserts)
// Query params:
//   cursor (optional) — ISO timestamp; load posts older than this (load-more / infinite scroll)
//   limit  (optional, max 50, default 20)
// Response: { posts, nextCursor }
//   nextCursor — ISO timestamp to pass as ?cursor= for the next page, or null if no more posts
app.get('/api/feed', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    // cursor = ISO timestamp of the oldest post already seen; null = load from the top
    const cursor = req.query.cursor || null

    const cursorFilter = cursor ? 'AND p.created_at < ?' : ''
    const cursorParams = cursor ? [new Date(cursor)] : []

    let posts
    try {
      ;[posts] = await pool.query(
        `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.categories, p.created_at, p.edited_at,
                p.place_name, p.geo_lat, p.geo_lng, p.tagged_users, p.linked_type, p.linked_id,
                (SELECT COUNT(*) FROM earned_badges WHERE user_id = p.author_id) as author_badge_count
         FROM posts p JOIN users u ON p.author_id = u.id
         WHERE (p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?))
           AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
           ${cursorFilter}
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [req.userId, req.userId, ...cursorParams, limit]
      )
    } catch {
      ;[posts] = await pool.query(
        `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.categories, p.created_at, p.edited_at,
                NULL as place_name, NULL as geo_lat, NULL as geo_lng,
                NULL as tagged_users, NULL as linked_type, NULL as linked_id,
                0 as author_badge_count
         FROM posts p JOIN users u ON p.author_id = u.id
         WHERE (p.author_id = ? OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?))
           AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
           ${cursorFilter}
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [req.userId, req.userId, ...cursorParams, limit]
      )
    }
    const postIds = posts.map(p => p.id)
    let comments = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en, c.media,
                  COUNT(cl.id) AS likes,
                  MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked,
                  MAX(CASE WHEN cl.user_id = ? THEN cl.reaction ELSE NULL END) AS my_reaction
           FROM comments c
           JOIN users u ON c.author_id = u.id
           LEFT JOIN comment_likes cl ON cl.comment_id = c.id
           WHERE c.post_id IN (?)
           GROUP BY c.id, c.post_id, u.name, c.text_da, c.text_en, c.media
           ORDER BY c.created_at ASC`,
          [req.userId, req.userId, postIds]
        )
        comments = rows
      } catch {
        // media/reaction column may not exist yet — fall back
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en,
                  COUNT(cl.id) AS likes,
                  MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked
           FROM comments c
           JOIN users u ON c.author_id = u.id
           LEFT JOIN comment_likes cl ON cl.comment_id = c.id
           WHERE c.post_id IN (?)
           GROUP BY c.id, c.post_id, u.name, c.text_da, c.text_en
           ORDER BY c.created_at ASC`,
          [req.userId, postIds]
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
      commentsByPost[c.post_id].push({ id: c.id, author: c.author, text: { da: c.text_da, en: c.text_en }, media: cMedia, likes: Number(c.likes || 0), liked: !!c.liked, reaction: c.my_reaction || null })
    }
    const result = posts.map(p => {
      let media = null
      if (p.media) {
        try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {}
      }
      let categories = null
      if (p.categories) {
        try { categories = typeof p.categories === 'string' ? JSON.parse(p.categories) : p.categories } catch {}
      }
      let taggedUsers = null
      if (p.tagged_users) {
        try { taggedUsers = typeof p.tagged_users === 'string' ? JSON.parse(p.tagged_users) : p.tagged_users } catch {}
      }
      return {
        id: p.id,
        author: p.author,
        authorId: p.author_id,
        authorMode: p.author_mode || 'privat',
        time: { da: formatPostTime(p.created_at, 'da'), en: formatPostTime(p.created_at, 'en') },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes,
        liked: likedSet.has(p.id),
        userReaction: userReactionMap[p.id] || null,
        reactions: reactionsByPost[p.id] || [],
        media,
        categories,
        comments: commentsByPost[p.id] || [],
        createdAtRaw: p.created_at,
        edited: !!p.edited_at,
        authorBadgeCount: p.author_badge_count || 0,
        placeName: p.place_name || null,
        geoLat: p.geo_lat || null,
        geoLng: p.geo_lng || null,
        taggedUsers,
        linkedType: p.linked_type || null,
        linkedId: p.linked_id || null,
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

    // Inject boosted posts at positions 5 and 15 for non-adfree users (first page only, no cursor)
    if (!cursor && result.length > 0) {
      try {
        const todayFeed = new Date().toISOString().split('T')[0]
        const [[adFreeRow]] = await pool.query(`
          SELECT (
            (SELECT COUNT(*) FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
            (SELECT COUNT(*) FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
          ) AS total
        `, [req.userId, todayFeed, todayFeed, req.userId, todayFeed, todayFeed]).catch(() => [[{ total: 0 }]])
        const isAdFree = (adFreeRow?.total ?? 0) > 0

        if (!isAdFree) {
          const [boostedAds] = await pool.query(
            `SELECT a.id as ad_id, a.boosted_post_id,
                    p.id, p.author_id, u.name as author, u.mode as author_mode,
                    p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.created_at,
                    p.tagged_users, p.linked_type, p.linked_id
             FROM ads a
             JOIN posts p ON p.id = a.boosted_post_id
             JOIN users u ON u.id = p.author_id
             WHERE a.status = 'active' AND a.boosted_post_id IS NOT NULL
               AND (a.start_date IS NULL OR a.start_date <= CURDATE())
               AND (a.end_date IS NULL OR a.end_date >= CURDATE())
             ORDER BY RAND() LIMIT 2`
          ).catch(() => [[]])
          const boostedPosts = (Array.isArray(boostedAds) ? boostedAds : []).map(b => ({
            id: b.id,
            author: b.author,
            authorId: b.author_id,
            authorMode: b.author_mode || 'business',
            time: { da: formatPostTime(b.created_at, 'da'), en: formatPostTime(b.created_at, 'en') },
            text: { da: b.text_da, en: b.text_en },
            likes: b.likes,
            liked: false, userReaction: null, reactions: [],
            media: (() => { try { return b.media ? (typeof b.media === 'string' ? JSON.parse(b.media) : b.media) : [] } catch { return [] } })(),
            categories: [], comments: [], createdAtRaw: b.created_at, edited: false, authorBadgeCount: 0,
            placeName: null, geoLat: null, geoLng: null, taggedUsers: null, linkedType: null, linkedId: null,
            isSponsored: true, adId: b.ad_id,
          }))
          if (boostedPosts[0] && result.length >= 5) result.splice(4, 0, boostedPosts[0])
          if (boostedPosts[1] && result.length >= 16) result.splice(15, 0, boostedPosts[1])
        }
      } catch { /* boosted injection is non-critical */ }
    }

    // nextCursor = created_at of the oldest post in this page (use as ?cursor= to load the next page)
    // null when fewer posts were returned than requested — no more pages exist
    const nextCursor = result.length === limit
      ? result[result.length - 1].createdAtRaw?.toISOString?.() ?? new Date(result[result.length - 1].createdAtRaw).toISOString()
      : null
    res.json({ posts: result, nextCursor })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' })
  }
})

// GET /api/feed/memories — posts by the current user from this same date in previous years
app.get('/api/feed/memories', authenticate, async (req, res) => {
  try {
    const now = new Date()
    const month = now.getMonth() + 1 // 1-based
    const day = now.getDate()

    const [rows] = await pool.query(
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en,
              p.likes, p.media, p.created_at,
              YEAR(p.created_at) as post_year,
              (? - YEAR(p.created_at)) as years_ago
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = ?
         AND MONTH(p.created_at) = ?
         AND DAY(p.created_at) = ?
         AND YEAR(p.created_at) < ?
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [now.getFullYear(), req.userId, month, day, now.getFullYear()]
    )

    const memories = rows.map(p => ({
      id: p.id,
      authorId: p.author_id,
      author: p.author,
      text: { da: p.text_da, en: p.text_en },
      time: { da: p.time_da, en: p.time_en },
      likes: p.likes || 0,
      media: (() => { try { return p.media ? JSON.parse(p.media) : [] } catch { return [] } })(),
      createdAt: p.created_at,
      yearsAgo: p.years_ago,
    }))

    res.json({ memories })
  } catch (err) {
    console.error('GET /api/feed/memories error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/posts/:id/boost — business pays to boost a post as a sponsored ad
app.post('/api/posts/:id/boost', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const [[post]] = await pool.query('SELECT id, author_id FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'You can only boost your own posts' })

    const [[settings]] = await pool.query('SELECT post_boost_price, post_boost_days, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const boostPrice = parseFloat(settings?.post_boost_price) || 19
    const boostDays = parseInt(settings?.post_boost_days) || 7
    const currency = settings?.currency || 'EUR'

    const endDate = new Date()
    endDate.setDate(endDate.getDate() + boostDays)

    const mollie = await getMollieClient()
    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'

    // Create the boost ad record
    const [[adSettings]] = await pool.query('SELECT ad_price_cpm FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const cpmRate = parseFloat(adSettings?.ad_price_cpm) || 50
    const [result] = await pool.query(
      `INSERT INTO ads (advertiser_id, title, target_url, placement, start_date, end_date, cpm_rate, boosted_post_id, budget)
       VALUES (?, ?, ?, 'feed', NOW(), ?, ?, ?, ?)`,
      [req.userId, `Boosted post #${postId}`, `/post/${postId}`, endDate, cpmRate, postId, boostPrice]
    )
    const adId = result.insertId

    if (!mollie) {
      // Dev fallback: activate immediately
      await pool.query(
        "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = ? WHERE id = ?",
        [endDate, adId]
      )
      await pool.query(
        'INSERT INTO subscriptions (user_id, plan, status, ad_id) VALUES (?, ?, ?, ?)',
        [req.userId, 'post_boost', 'paid', adId]
      )
      return res.json({ activated: true, ad_id: adId, checkout_url: null })
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    const payment = await mollie.payments.create({
      amount: { currency, value: boostPrice.toFixed(2) },
      description: `fellis.eu — post boost #${postId}`,
      redirectUrl: `${origin}/?mollie_payment=success&plan=post_boost&ad_id=${adId}`,
      webhookUrl: `${siteUrl}/api/mollie/payment/webhook`,
      metadata: { user_id: String(req.userId), plan: 'post_boost', ad_id: String(adId) },
    })
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, payment.id, 'post_boost', payment.status, adId]
    )
    res.json({ checkout_url: payment.getCheckoutUrl(), ad_id: adId, activated: false })
  } catch (err) {
    console.error('POST /api/posts/:id/boost error:', err.message)
    res.status(500).json({ error: 'Server error' })
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
app.post('/api/feed', authenticate, writeLimit, upload.array('media', 4), async (req, res) => {
  const { text, scheduled_at, place_name, geo_lat, geo_lng } = req.body
  const rawCats = req.body.categories
  const categories = rawCats ? (typeof rawCats === 'string' ? JSON.parse(rawCats) : rawCats) : null
  const rawTagged = req.body.tagged_users
  const taggedUsers = rawTagged ? (typeof rawTagged === 'string' ? JSON.parse(rawTagged) : rawTagged) : null
  const linkedType = req.body.linked_type || null
  const linkedId = req.body.linked_id ? parseInt(req.body.linked_id) : null
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
    const categoriesJson = Array.isArray(categories) && categories.length > 0 ? JSON.stringify(categories) : null
    const scheduledDate = scheduled_at ? new Date(scheduled_at) : null
    if (scheduledDate && isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Invalid scheduled_at' })
    const placeName = typeof place_name === 'string' ? place_name.slice(0, 255) : null
    const lat = geo_lat ? parseFloat(geo_lat) : null
    const lng = geo_lng ? parseFloat(geo_lng) : null
    const taggedJson = Array.isArray(taggedUsers) && taggedUsers.length > 0 ? JSON.stringify(taggedUsers) : null
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, scheduled_at, categories, place_name, geo_lat, geo_lng, tagged_users, linked_type, linked_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, text, text, 'Lige nu', 'Just now', mediaJson, scheduledDate, categoriesJson, placeName, lat, lng, taggedJson, linkedType, linkedId]
    ).catch(() =>
      pool.query(
        'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, scheduled_at, categories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.userId, text, text, 'Lige nu', 'Just now', mediaJson, scheduledDate, categoriesJson]
      )
    )
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const now = new Date()
    const postId = result.insertId
    // Extract and store hashtags (max 10)
    if (text) {
      const tags = [...new Set((text.match(/#([\wæøåÆØÅ]{1,99})/g) || []).map(t => t.slice(1).toLowerCase()))].slice(0, 10)
      if (tags.length > 0) {
        pool.query(
          `INSERT IGNORE INTO post_hashtags (post_id, tag) VALUES ${tags.map(() => '(?,?)').join(',')}`,
          tags.flatMap(tag => [postId, tag])
        ).catch(() => {})
      }
    }
    // Auto-flag: create a pending report for admin review
    if (autoFlagKeyword) {
      pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'post', postId, 'keyword_flag', `Auto-flagged: keyword "${autoFlagKeyword}"`]
      ).catch(() => {})
    }
    // Business community score: increment when a business user publishes a post
    pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [req.userId]).catch(() => {})
    if (scheduledDate) {
      return res.json({ id: postId, scheduled: true, scheduledAt: scheduledDate })
    }
    res.json({
      id: postId,
      author: users[0].name,
      time: { da: formatPostTime(now, 'da'), en: formatPostTime(now, 'en') },
      text: { da: text, en: text },
      likes: 0, liked: false, comments: [],
      media: mediaUrls.length > 0 ? mediaUrls : null,
      categories: categoriesJson ? JSON.parse(categoriesJson) : null,
      location: lat ? { lat, lng, name: placeName } : null,
      tagged_users: taggedJson ? JSON.parse(taggedJson) : null,
      linked_type: linkedType || null,
      linked_id: linkedId || null,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// POST /api/upload — standalone upload endpoint (for drag-and-drop preview)
app.post('/api/upload', authenticate, fileUploadLimit, upload.single('file'), async (req, res) => {
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
  // Audit log: file uploaded
  await auditLog(req, 'file_upload', 'file', null, {
    status: 'success',
    details: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      type: type
    }
  })
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
      // Notify post author (not self)
      const [[post]] = await pool.query('SELECT user_id, categories FROM posts WHERE id = ?', [postId]).catch(() => [[null]])
      if (post && post.user_id !== req.userId) {
        const [[liker]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
        if (liker) {
          const emoji = reaction || '❤️'
          createNotification(post.user_id, 'like',
            `${liker.name} reagerede ${emoji} på dit opslag`,
            `${liker.name} reacted ${emoji} to your post`,
            req.userId, liker.name, postId
          )
        }
      }
      autoSignalPost(req.userId, postId, 'like')
      // Business community score: author gains +1 when their post receives a like
      if (post) pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [post.user_id]).catch(() => {})
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
app.post('/api/feed/:id/comment', authenticate, writeLimit, upload.single('media'), async (req, res) => {
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
    // Notify post author (not self)
    const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]).catch(() => [[null]])
    if (post && post.user_id !== req.userId) {
      createNotification(post.user_id, 'comment',
        `${users[0].name} kommenterede dit opslag`,
        `${users[0].name} commented on your post`,
        req.userId, users[0].name, postId
      )
    }
    autoSignalPost(req.userId, postId, 'comment')
    // Business community score: increment when a business user adds a comment
    pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [req.userId]).catch(() => {})
    res.json({ author: users[0].name, text: { da: text, en: text }, media })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// POST /api/comments/:id/like — toggle reaction on a comment (emoji optional, default ❤️)
app.post('/api/comments/:id/like', authenticate, async (req, res) => {
  const commentId = parseInt(req.params.id)
  const emoji = (req.body?.emoji || '❤️').slice(0, 8)
  try {
    const [existing] = await pool.query(
      'SELECT id, reaction FROM comment_likes WHERE comment_id = ? AND user_id = ?',
      [commentId, req.userId]
    )
    if (existing.length) {
      const prev = existing[0].reaction || '❤️'
      if (prev === emoji) {
        // Same emoji → unlike
        await pool.query('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?', [commentId, req.userId])
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', [commentId])
        return res.json({ liked: false, reaction: null, likes: n })
      }
      // Different emoji → update reaction
      await pool.query('UPDATE comment_likes SET reaction = ? WHERE comment_id = ? AND user_id = ?', [emoji, commentId, req.userId])
    } else {
      await pool.query(
        'INSERT INTO comment_likes (comment_id, user_id, reaction) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reaction = VALUES(reaction)',
        [commentId, req.userId, emoji]
      ).catch(() =>
        // reaction column may not exist yet on old installs
        pool.query('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)', [commentId, req.userId])
      )
    }
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', [commentId])
    res.json({ liked: true, reaction: emoji, likes: n })
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle comment like' })
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
      const [insertResult] = await pool.query(
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
      created.push({ id: insertResult.insertId, name: name || email, email, token, inviteUrl })
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
       WHERE i.inviter_id = ? AND (i.invitee_name IS NOT NULL OR i.invitee_email IS NOT NULL)
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
      `SELECT u.id, u.name, f.mutual_count as mutual,
              (u.last_active IS NOT NULL AND u.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) as online
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
app.post('/api/friends/request/:userId', authenticate, writeLimit, async (req, res) => {
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
    const [[sender]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
    if (sender) {
      createNotification(targetId, 'friend_request',
        `${sender.name} har sendt dig en venneanmodning`,
        `${sender.name} sent you a friend request`,
        req.userId, sender.name
      )
    }
    // Also broadcast a friend_request SSE event so recipient's Friends page refreshes live
    sseBroadcast(targetId, { type: 'friend_request' })
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
    const [[acceptor]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
    if (acceptor) {
      createNotification(fromId, 'friend_accepted',
        `${acceptor.name} accepterede din venneanmodning`,
        `${acceptor.name} accepted your friend request`,
        req.userId, acceptor.name
      )
    }
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
    const fromId = rows[0].from_user_id
    await pool.query(`UPDATE friend_requests SET status = 'declined' WHERE id = ?`, [reqId])
    const [[decliner]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
    if (decliner) {
      createNotification(fromId, 'friend_declined',
        `${decliner.name} har afvist din venneanmodning`,
        `${decliner.name} declined your friend request`,
        req.userId, decliner.name
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to decline request' }) }
})

// DELETE /api/friends/request/:userId — cancel an outgoing pending friend request
app.delete('/api/friends/request/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Invalid user' })
  try {
    await pool.query(
      `DELETE FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
      [req.userId, targetId]
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Failed to cancel request' }) }
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

// PATCH /api/friends/:userId/family — mark/unmark as family (for feed weighting)
app.patch('/api/friends/:userId/family', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  const { is_family } = req.body
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' })
  try {
    await pool.query(
      'UPDATE friendships SET is_family = ? WHERE user_id = ? AND friend_id = ?',
      [is_family ? 1 : 0, req.userId, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Conversation routes ──

// Helper: fetch a full conversation object for the current user
async function getConversationForUser(convId, userId, myName) {
  const [participants] = await pool.query(
    `SELECT u.id, u.name, cp.last_read_at FROM users u
     JOIN conversation_participants cp ON cp.user_id = u.id
     WHERE cp.conversation_id = ?`, [convId])
  // admin_muted_until is loaded separately — safe fallback if column doesn't exist yet
  const [adminMutes] = await pool.query(
    `SELECT user_id, admin_muted_until FROM conversation_participants WHERE conversation_id = ?`, [convId]
  ).catch(() => [[]])
  const adminMuteMap = Object.fromEntries(adminMutes.map(r => [r.user_id, r.admin_muted_until ?? null]))
  const [msgs] = await pool.query(
    `SELECT m.id, u.name as from_name, m.text_da, m.text_en, m.time, m.is_read, m.created_at
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 20`, [convId])
  msgs.reverse()
  const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?', [convId])
  const [[conv]] = await pool.query(
    `SELECT c.name, c.is_group, c.is_family_group, c.created_by, cp.muted_until FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
     WHERE c.id = ?`, [userId, convId])
  const unread = msgs.filter(m => !m.is_read && m.from_name !== myName).length
  const otherParticipant = participants.find(p => p.id !== userId)
  const fallbackName = msgs.find(m => m.from_name !== myName)?.from_name || null
  const displayName = conv.is_group
    ? (conv.name || participants.filter(p => p.id !== userId).map(p => p.name.split(' ')[0]).join(', '))
    : (otherParticipant?.name || fallbackName || 'Ukendt')
  // Build read receipts for other participants (not the requesting user)
  const readReceipts = participants
    .filter(p => p.id !== userId && p.last_read_at)
    .map(p => ({ userId: p.id, name: p.name, lastReadAt: p.last_read_at }))
  return {
    id: convId,
    name: displayName,
    isGroup: conv.is_group === 1,
    isFamilyGroup: conv.is_family_group === 1,
    groupName: conv.name,
    createdBy: conv.created_by,
    participants: participants.map(p => ({
      id: p.id,
      name: p.name,
      adminMutedUntil: adminMuteMap[p.id] ?? null,
    })),
    messages: msgs.map(m => ({
      id: m.id,
      from: m.from_name,
      text: { da: m.text_da, en: m.text_en },
      time: m.created_at ? formatMsgTime(m.created_at) : m.time,
      createdAtRaw: m.created_at,
    })),
    totalMessages: total,
    unread,
    mutedUntil: conv.muted_until,
    readReceipts,
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
app.post('/api/conversations', authenticate, writeLimit, async (req, res) => {
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
app.post('/api/conversations/:id/messages', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Message text required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    // Check if sender is admin-muted (column may not exist on older installs)
    const [muteCheck] = await pool.query(
      'SELECT admin_muted_until FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId]
    ).catch(() => [[{}]])
    if (muteCheck[0]?.admin_muted_until && new Date(muteCheck[0].admin_muted_until) > new Date())
      return res.status(403).json({ error: 'You are muted in this conversation', mutedUntil: muteCheck[0].admin_muted_until })
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const [participants] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [convId])
    const receiverId = participants.find(p => p.user_id !== req.userId)?.user_id ?? req.userId
    const [ins] = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, receiver_id, text_da, text_en, time) VALUES (?, ?, ?, ?, ?, ?)',
      [convId, req.userId, receiverId, text, text, time])
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const msg = { id: ins.insertId, from: user.name, text: { da: text, en: text }, time: formatMsgTime(now), createdAtRaw: now.toISOString() }
    // Push the new message to all other participants via SSE + create notification
    const [[conv]] = await pool.query('SELECT name, is_group FROM conversations WHERE id = ?', [convId]).catch(() => [[null]])
    for (const { user_id } of participants) {
      if (user_id !== req.userId) {
        sseBroadcast(user_id, { type: 'message', convId, msg })
        const msgDa = conv?.is_group && conv?.name
          ? `${user.name} sendte en besked i ${conv.name}`
          : `${user.name} sendte dig en besked`
        const msgEn = conv?.is_group && conv?.name
          ? `${user.name} sent a message in ${conv.name}`
          : `${user.name} sent you a message`
        createNotification(user_id, 'new_message', msgDa, msgEn, req.userId, user.name, convId)
      }
    }
    res.json(msg)
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// POST /api/conversations/:id/read — mark messages as read + update last_read_at for receipt
app.post('/api/conversations/:id/read', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    await pool.query(
      'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?',
      [convId, req.userId])
    await pool.query(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [convId, req.userId]
    ).catch(() => {}) // column may not exist on older installs — safe to ignore
    // Push read receipt to other participants via SSE so they see ✓✓ instantly
    const [participants] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [convId])
    const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    for (const { user_id } of participants) {
      if (user_id !== req.userId) {
        sseBroadcast(user_id, {
          type: 'read_receipt',
          convId,
          userId: req.userId,
          name: me.name,
          lastReadAt: new Date().toISOString(),
        })
      }
    }
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

// DELETE /api/conversations/:id/participants/:userId — remove a member (creator only)
app.delete('/api/conversations/:id/participants/:userId', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId) || targetId === req.userId)
    return res.status(400).json({ error: 'Invalid target user' })
  try {
    const [[conv]] = await pool.query('SELECT created_by FROM conversations WHERE id = ?', [convId])
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    if (conv.created_by !== req.userId) return res.status(403).json({ error: 'Only the conversation creator can remove members' })
    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, targetId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove participant' })
  }
})

// POST /api/conversations/:id/participants/:userId/mute — admin-mute a member (creator only)
app.post('/api/conversations/:id/participants/:userId/mute', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId) || targetId === req.userId)
    return res.status(400).json({ error: 'Invalid target user' })
  const { minutes } = req.body
  try {
    const [[conv]] = await pool.query('SELECT created_by FROM conversations WHERE id = ?', [convId])
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    if (conv.created_by !== req.userId) return res.status(403).json({ error: 'Only the conversation creator can mute members' })
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, targetId])
    if (!check.length) return res.status(404).json({ error: 'User is not a participant' })
    const adminMutedUntil = (minutes && minutes > 0) ? new Date(Date.now() + minutes * 60 * 1000) : null
    await pool.query(
      'UPDATE conversation_participants SET admin_muted_until = ? WHERE conversation_id = ? AND user_id = ?',
      [adminMutedUntil, convId, targetId])
    res.json({ ok: true, adminMutedUntil })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mute participant' })
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
              (u.last_active IS NOT NULL AND u.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) as online,
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
    await pool.query(`CREATE TABLE IF NOT EXISTS listing_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_id INT NOT NULL,
      viewer_id INT NOT NULL,
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_listing_id (listing_id),
      INDEX idx_viewer_id (viewer_id),
      FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
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

// GET /api/marketplace/stats — stats for the current user's own listings
app.get('/api/marketplace/stats', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(sold = 0) AS active,
         SUM(sold = 1) AS sold,
         SUM(boosted_until > NOW() AND sold = 0) AS boosted
       FROM marketplace_listings WHERE user_id = ?`,
      [req.userId]
    )
    res.json({
      total:   Number(row.total   || 0),
      active:  Number(row.active  || 0),
      sold:    Number(row.sold    || 0),
      boosted: Number(row.boosted || 0),
    })
  } catch (err) {
    console.error('GET /api/marketplace/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/marketplace/boosted-feed — return active boosted listings for feed injection
app.get('/api/marketplace/boosted-feed', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.id, l.title, l.price, l.priceNegotiable, l.category, l.location, l.photos,
              u.name AS seller_name, u.avatar_url AS seller_avatar
       FROM marketplace_listings l
       JOIN users u ON l.user_id = u.id
       WHERE l.boosted_until > NOW() AND l.sold = 0
       ORDER BY RAND()
       LIMIT 5`
    )
    res.json({ listings: rows.map(parseListingPhotos) })
  } catch (err) {
    console.error('GET /api/marketplace/boosted-feed error:', err.message)
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
    const listingId = parseInt(req.params.id)
    const [[existing]] = await pool.query('SELECT user_id, title FROM marketplace_listings WHERE id = ?', [listingId])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    // Use Mollie if configured
    const mollie = await getMollieClient()
    if (mollie) {
      const [[adS]] = await pool.query('SELECT boost_price, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
      const boostPrice = parseFloat(adS?.boost_price) || 9
      const currency = adS?.currency || 'EUR'

      const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
      const siteUrl = process.env.SITE_URL || origin
      const redirectUrl = `${origin}/?mollie_payment=success&plan=boost&listing_id=${listingId}`
      const webhookUrl = `${siteUrl}/api/mollie/payment/webhook`

      const payment = await mollie.payments.create({
        amount: { currency, value: boostPrice.toFixed(2) },
        description: `fellis.eu — Boost: ${existing.title}`,
        redirectUrl,
        webhookUrl,
        metadata: { user_id: String(req.userId), plan: 'boost', listing_id: String(listingId) },
      })

      const checkoutUrl = payment._links?.checkout?.href
      if (!checkoutUrl) return res.status(500).json({ error: 'Mollie returnerede ingen checkout-URL.' })

      await pool.query(
        'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id) VALUES (?, ?, ?, ?, ?)',
        [req.userId, payment.id, 'boost', 'open', listingId]
      ).catch(() => {})

      return res.json({ checkoutUrl, paymentId: payment.id })
    }

    // Mollie not configured — free boost for development/testing
    await pool.query('UPDATE marketplace_listings SET boosted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?', [listingId])
    createNotification(req.userId, 'listing_boosted',
      `Din annonce "${existing.title}" er nu boostet i 7 dage`,
      `Your listing "${existing.title}" is now boosted for 7 days`,
      req.userId, null
    )
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

// POST /api/marketplace/:id/view — record a listing view (skip owner, deduplicate per hour)
app.post('/api/marketplace/:id/view', authenticate, async (req, res) => {
  try {
    const listingId = parseInt(req.params.id)
    const [[listing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id = ?', [listingId])
    if (!listing) return res.status(404).json({ error: 'Not found' })
    if (listing.user_id === req.userId) return res.json({ ok: true }) // don't count owner views
    await pool.query(
      `INSERT INTO listing_views (listing_id, viewer_id)
       SELECT ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM listing_views
         WHERE listing_id = ? AND viewer_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       )`,
      [listingId, req.userId, listingId, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/marketplace/:id/view error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/marketplace/stats — stats for current user's listings
app.get('/api/marketplace/stats', authenticate, async (req, res) => {
  try {
    const [[overview]] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sold = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN sold = 1 THEN 1 ELSE 0 END) AS sold_count,
        SUM(CASE WHEN boosted_until > NOW() THEN 1 ELSE 0 END) AS boosted
       FROM marketplace_listings WHERE user_id = ?`,
      [req.userId]
    )
    const [[viewStats]] = await pool.query(
      `SELECT
        COUNT(*) AS total_views,
        SUM(CASE WHEN lv.viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS views_last_7_days,
        SUM(CASE WHEN lv.viewed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS views_today
       FROM listing_views lv
       JOIN marketplace_listings l ON lv.listing_id = l.id
       WHERE l.user_id = ?`,
      [req.userId]
    )
    const [topListings] = await pool.query(
      `SELECT l.id, l.title, l.sold, l.category, COUNT(lv.id) AS views
       FROM marketplace_listings l
       LEFT JOIN listing_views lv ON l.id = lv.listing_id
       WHERE l.user_id = ?
       GROUP BY l.id, l.title, l.sold, l.category
       ORDER BY views DESC, l.created_at DESC`,
      [req.userId]
    )
    const [categories] = await pool.query(
      `SELECT category, COUNT(*) AS count
       FROM marketplace_listings WHERE user_id = ?
       GROUP BY category ORDER BY count DESC`,
      [req.userId]
    )
    const [viewTrend] = await pool.query(
      `SELECT DATE(lv.viewed_at) AS date, COUNT(*) AS views
       FROM listing_views lv
       JOIN marketplace_listings l ON lv.listing_id = l.id
       WHERE l.user_id = ? AND lv.viewed_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       GROUP BY DATE(lv.viewed_at)
       ORDER BY date ASC`,
      [req.userId]
    )
    res.json({
      overview: {
        total: Number(overview.total) || 0,
        active: Number(overview.active) || 0,
        sold: Number(overview.sold_count) || 0,
        boosted: Number(overview.boosted) || 0,
      },
      views: {
        total: Number(viewStats.total_views) || 0,
        last7Days: Number(viewStats.views_last_7_days) || 0,
        today: Number(viewStats.views_today) || 0,
      },
      topListings: topListings.map(l => ({
        id: l.id, title: l.title, sold: !!l.sold, category: l.category, views: Number(l.views) || 0,
      })),
      categories: categories.map(c => ({ category: c.category, count: Number(c.count) })),
      viewTrend: viewTrend.map(r => ({ date: r.date, views: Number(r.views) })),
    })
  } catch (err) {
    console.error('GET /api/marketplace/stats error:', err.message)
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
      track_status VARCHAR(30) DEFAULT NULL,
      PRIMARY KEY (job_id, user_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await addCol('job_saves', 'track_status', 'VARCHAR(30) DEFAULT NULL')

    // Repair: ensure all companies have their owner in company_members
    // (may be missing if company was created before this table existed)
    await pool.query(`
      INSERT IGNORE INTO company_members (company_id, user_id, role)
      SELECT id, owner_id, 'owner' FROM companies WHERE owner_id > 0
    `)

    // Migrations: add new company profile columns if missing
    await addCol('companies', 'cvr', 'VARCHAR(20) DEFAULT NULL')
    await addCol('companies', 'company_type', 'VARCHAR(50) DEFAULT NULL')
    await addCol('companies', 'address', 'VARCHAR(255) DEFAULT NULL')
    await addCol('companies', 'phone', 'VARCHAR(50) DEFAULT NULL')
    await addCol('companies', 'email', 'VARCHAR(255) DEFAULT NULL')
    await addCol('companies', 'linkedin', 'VARCHAR(500) DEFAULT NULL')
    await addCol('companies', 'founded_year', 'SMALLINT DEFAULT NULL')

    // Migrations: add new job columns if missing
    await addCol('jobs', 'contact_email', 'VARCHAR(255) DEFAULT NULL')
    await addCol('jobs', 'deadline', 'DATE DEFAULT NULL')

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
            cvr, company_type, address, phone, email, linkedin, founded_year, logo_url } = req.body
    if (!name || !handle) return res.status(400).json({ error: 'name and handle required' })
    const safeHandle = handle.startsWith('@') ? handle : `@${handle}`
    const [result] = await pool.query(
      `INSERT INTO companies (owner_id, name, handle, tagline, description, industry, size, website, color,
         cvr, company_type, address, phone, email, linkedin, founded_year, logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, name, safeHandle, tagline || null, description || null,
        industry || null, size || null, website || null, color || '#1877F2',
        cvr || null, company_type || null, address || null, phone || null,
        email || null, linkedin || null, founded_year || null, logo_url || null]
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
              (SELECT COUNT(*) > 0 FROM job_saves WHERE job_id = j.id AND user_id = ?) AS saved,
              (SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.job_id = j.id) AS share_count
       FROM jobs j
       WHERE j.company_id = ? AND j.active = 1
       ORDER BY j.created_at DESC`,
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

// DELETE /api/companies/:id — delete company (owner only)
app.delete('/api/companies/:id', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role = 'owner'",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })

    // Delete company and all related data
    await pool.query('DELETE FROM company_members WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM company_follows WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM jobs WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM companies WHERE id = ?', [req.params.id])

    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/companies/:id error:', err.message)
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

// POST /api/companies/:id/members — add member to company
app.post('/api/companies/:id/members', authenticate, async (req, res) => {
  try {
    // Check if requester is owner or admin
    const [[isOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' })

    const { user_id, role } = req.body
    if (!user_id || !role) return res.status(400).json({ error: 'Missing user_id or role' })

    // Find user by ID or email
    let [[user]] = await pool.query('SELECT id FROM users WHERE id = ? OR email = ?', [user_id, user_id])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Add member
    await pool.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = ?',
      [req.params.id, user.id, role, role]
    )

    // Return member with info
    const [[member]] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, cm.role
       FROM company_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = ? AND cm.user_id = ?`,
      [req.params.id, user.id]
    )
    res.json(member)
  } catch (err) {
    console.error('POST /api/companies/:id/members error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/companies/:id/members/:userId — remove member from company
app.delete('/api/companies/:id/members/:userId', authenticate, async (req, res) => {
  try {
    // Check if requester is owner or admin
    const [[isOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' })

    // Don't allow removing the owner
    const [[isTargetOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role = 'owner'",
      [req.params.id, req.params.userId]
    )
    if (isTargetOwner) return res.status(400).json({ error: 'Cannot remove owner' })

    // Remove member
    await pool.query(
      'DELETE FROM company_members WHERE company_id = ? AND user_id = ?',
      [req.params.id, req.params.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/companies/:id/members/:userId error:', err.message)
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

// GET /api/feed/company-posts — recent posts from all companies the user follows or owns
// Used to interleave company content chronologically in the main feed.
// Only returns posts created within the last 14 days so stale content doesn't reappear.
app.get('/api/feed/company-posts', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT cp.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              u.name AS author_name,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp
       JOIN companies c ON c.id = cp.company_id
       JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id IN (
         SELECT company_id FROM company_follows WHERE user_id = ?
         UNION
         SELECT company_id FROM company_members WHERE user_id = ?
       )
       AND cp.created_at >= NOW() - INTERVAL 14 DAY
       ORDER BY cp.created_at DESC
       LIMIT 20`,
      [req.userId, req.userId, req.userId]
    )
    res.json({ posts })
  } catch (err) {
    console.error('GET /api/feed/company-posts error:', err.message)
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
              1 AS saved, js.track_status
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

// PATCH /api/jobs/:id/track — set personal tracking status (private users)
app.patch('/api/jobs/:id/track', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['not_applied', 'applied', 'interview', 'offer', 'hired', 'rejected', 'not_interested']
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    // Ensure a save row exists
    await pool.query(
      'INSERT INTO job_saves (job_id, user_id, track_status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE track_status = VALUES(track_status)',
      [req.params.id, req.userId, status || null]
    )
    res.json({ ok: true, status: status || null })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs/tracked — jobs with a tracking status set by the user
app.get('/api/jobs/tracked', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              1 AS saved, js.track_status
       FROM jobs j JOIN companies c ON c.id = j.company_id
       JOIN job_saves js ON js.job_id = j.id AND js.user_id = ?
       WHERE js.track_status IS NOT NULL
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
    const [[existing]] = await pool.query('SELECT track_status FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
    if (existing) {
      // Only unsave if no tracking status set (or force=true)
      if (existing.track_status && !req.body.force) {
        // Has tracking status: just clear the saved flag conceptually but keep tracking
        res.json({ saved: false, track_status: existing.track_status })
      } else {
        await pool.query('DELETE FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
        res.json({ saved: false })
      }
    } else {
      await pool.query('INSERT IGNORE INTO job_saves (job_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ saved: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Business Features: Job Applications, Contact Notes, Scheduled Posts, Company Leads ──

async function initBusinessFeatures() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS job_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      job_id INT NOT NULL,
      applicant_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      message TEXT DEFAULT NULL,
      cv_url VARCHAR(500) DEFAULT NULL,
      application_letter_url VARCHAR(500) DEFAULT NULL,
      status ENUM('pending','reviewed','shortlisted','rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_job_applicant (job_id, applicant_id),
      INDEX idx_ja_job (job_id),
      INDEX idx_ja_applicant (applicant_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await addCol('job_applications', 'application_letter_url', 'VARCHAR(500) DEFAULT NULL')
      .catch(() => {})
    await pool.query(`CREATE TABLE IF NOT EXISTS work_experience (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      company VARCHAR(200) NOT NULL,
      title VARCHAR(200) NOT NULL,
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      is_current TINYINT(1) NOT NULL DEFAULT 0,
      description TEXT DEFAULT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_we_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS education (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      institution VARCHAR(200) NOT NULL,
      degree VARCHAR(200) DEFAULT NULL,
      field VARCHAR(200) DEFAULT NULL,
      start_year SMALLINT DEFAULT NULL,
      end_year SMALLINT DEFAULT NULL,
      description TEXT DEFAULT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ed_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS user_languages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      language VARCHAR(100) NOT NULL,
      proficiency ENUM('basic','conversational','professional','fluent','native') NOT NULL DEFAULT 'conversational',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_language (user_id, language),
      INDEX idx_ul_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS contact_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      author_id INT NOT NULL,
      contact_id INT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cn_author_contact (author_id, contact_id),
      INDEX idx_cn_author (author_id),
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS company_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      topic VARCHAR(200) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      status ENUM('new','responded','archived') NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cl_company (company_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initBusinessFeatures error:', err.message)
  }
}

async function initSettingsSchema() {
  try {
    // Add session display columns (MySQL 8 compatible via addCol)
    await addCol('sessions', 'user_agent', 'VARCHAR(500) DEFAULT NULL')
    await addCol('sessions', 'ip_address', 'VARCHAR(50) DEFAULT NULL')
    await addCol('sessions', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
    // Privacy settings
    await addCol('users', 'profile_visibility', "ENUM('all','friends') NOT NULL DEFAULT 'all'")
    await addCol('users', 'friend_request_privacy', "ENUM('all','friends_of_friends') NOT NULL DEFAULT 'all'")
    await addCol('users', 'post_default_visibility', "ENUM('all','friends','only_me') NOT NULL DEFAULT 'all'")
    await addCol('users', 'message_privacy', "ENUM('all','friends') NOT NULL DEFAULT 'all'")
    await addCol('users', 'comment_privacy', "ENUM('all','friends') NOT NULL DEFAULT 'all'")
    await addCol('users', 'searchable', 'TINYINT(1) NOT NULL DEFAULT 1')
    await addCol('users', 'show_online_status', 'TINYINT(1) NOT NULL DEFAULT 1')
    await addCol('users', 'analytics_opt_out', 'TINYINT(1) NOT NULL DEFAULT 0')
    await addCol('users', 'allow_tagging', 'TINYINT(1) NOT NULL DEFAULT 1')
    await addCol('users', 'friend_list_visibility', "ENUM('all','friends','only_me') NOT NULL DEFAULT 'all'")
    // Extended profile fields
    await addCol('users', 'tags', 'JSON DEFAULT NULL')
    await addCol('users', 'relationship_status', "ENUM('single','in_relationship','married','engaged','open','prefer_not') DEFAULT NULL")
    await addCol('users', 'website', 'VARCHAR(300) DEFAULT NULL')
    // OAuth provider IDs
    await addCol('users', 'google_id', 'VARCHAR(100) DEFAULT NULL')
    await addCol('users', 'linkedin_id', 'VARCHAR(100) DEFAULT NULL')
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
    await addCol('posts', 'edited_at', 'TIMESTAMP NULL DEFAULT NULL')
  } catch (err) {
    console.error('initSiteVisits error:', err.message)
  }
}

// ── Signal Engine — DB init ───────────────────────────────────────────────────
async function initSignalEngine() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS interest_signals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      interest_slug VARCHAR(50) NOT NULL,
      signal_type ENUM('click','dwell_short','dwell_long','like','comment','share','scroll_past','quick_close','block') NOT NULL,
      signal_value TINYINT NOT NULL,
      context ENUM('professional','hobby','purchase') NOT NULL DEFAULT 'hobby',
      source_type VARCHAR(50) DEFAULT NULL,
      source_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_is_user (user_id),
      INDEX idx_is_user_interest (user_id, interest_slug),
      INDEX idx_is_cleanup (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS interest_scores (
      user_id INT NOT NULL,
      interest_slug VARCHAR(50) NOT NULL,
      context ENUM('professional','hobby','purchase') NOT NULL DEFAULT 'hobby',
      weight FLOAT NOT NULL DEFAULT 0,
      explicit_set TINYINT(1) NOT NULL DEFAULT 0,
      last_signal_at TIMESTAMP DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, interest_slug, context),
      INDEX idx_iscores_user_weight (user_id, weight),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // Interest categories — admin-managed list used in profile interests picker
    await pool.query(`CREATE TABLE IF NOT EXISTS interest_categories (
      id         VARCHAR(64)  NOT NULL PRIMARY KEY,
      da         VARCHAR(128) NOT NULL,
      en         VARCHAR(128) NOT NULL,
      icon       VARCHAR(8)   NOT NULL DEFAULT '⭐',
      sort_order INT          NOT NULL DEFAULT 0,
      active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    // Seed only if table is empty
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM interest_categories')
    if (cnt === 0) {
      await pool.query(`INSERT IGNORE INTO interest_categories (id, da, en, icon, sort_order) VALUES
        ('musik','Musik','Music','🎵',10),('koncerter','Koncerter & Livemusik','Concerts & Live Music','🎸',11),
        ('podcasts','Podcasts','Podcasts','🎙️',12),('opera','Opera & Klassisk musik','Opera & Classical Music','🎻',13),
        ('dans','Dans','Dance','💃',14),('film','Film & TV','Film & TV','🎬',20),
        ('anime','Anime & Manga','Anime & Manga','🎌',21),('tegneserier','Tegneserier','Comics','💬',22),
        ('stand-up','Stand-up komik','Stand-up Comedy','🎤',23),('festivals','Festivaler & Events','Festivals & Events','🎪',24),
        ('braetspil','Brætspil','Board Games','🎲',25),('gaming','Gaming','Gaming','🎮',30),
        ('e-sport','E-sport','E-sports','🏆',31),('sport','Sport','Sports','⚽',40),
        ('fodbold','Fodbold','Football','⚽',41),('basketball','Basketball','Basketball','🏀',42),
        ('tennis','Tennis','Tennis','🎾',43),('golf','Golf','Golf','⛳',44),
        ('cykling','Cykling','Cycling','🚴',45),('loeb','Løb','Running','🏃',46),
        ('svoemning','Svømning','Swimming','🏊',47),('fitness','Fitness & Træning','Fitness & Training','🏋️',48),
        ('yoga','Yoga','Yoga','🧘',49),('kampsport','Kampsport','Martial Arts','🥋',50),
        ('ski','Ski & Wintersport','Skiing & Winter Sports','⛷️',51),('surfing','Surfing','Surfing','🏄',52),
        ('klatring','Klatring','Climbing','🧗',53),('vandring','Vandring','Hiking','🥾',54),
        ('natur','Natur','Nature','🌿',60),('friluftsliv','Friluftsliv','Outdoor Life','🏕️',61),
        ('camping','Camping','Camping','⛺',62),('fiskeri','Fiskeri','Fishing','🎣',63),
        ('jagt','Jagt','Hunting','🦌',64),('hunde','Hunde','Dogs','🐕',65),
        ('katte','Katte','Cats','🐈',66),('kaeledyr','Kæledyr','Pets','🐾',67),
        ('mad','Mad','Food','🍕',70),('madlavning','Madlavning','Cooking','👨‍🍳',71),
        ('bagvaerk','Bagværk & Kage','Baking & Cake','🍰',72),('grillmad','Grillmad & BBQ','BBQ & Grilling','🔥',73),
        ('vegansk','Vegansk & Plantebaseret','Vegan & Plant-based','🥗',74),('vin','Vin','Wine','🍷',75),
        ('ol','Øl & Craft beer','Beer & Craft Beer','🍺',76),('kaffe','Kaffe','Coffee','☕',77),
        ('rejser','Rejser','Travel','✈️',80),('teknologi','Teknologi','Technology','💻',90),
        ('ai','Kunstig intelligens','Artificial Intelligence','🤖',91),('programmering','Programmering','Programming','👨‍💻',92),
        ('cybersikkerhed','Cybersikkerhed','Cybersecurity','🔐',93),('blockchain','Blockchain','Blockchain','⛓️',94),
        ('robotik','Robotik','Robotics','🦾',95),('gadgets','Gadgets','Gadgets','📱',96),
        ('rum','Rumfart & Astronomi','Space & Astronomy','🌌',97),('videnskab','Videnskab','Science','🔬',100),
        ('uddannelse','Uddannelse','Education','🎓',101),('matematik','Matematik','Mathematics','🔢',102),
        ('historie','Historie','History','🏺',103),('psykologi','Psykologi','Psychology','🧠',104),
        ('filosofi','Filosofi','Philosophy','🤔',105),('sprog','Sprog & Lingvistik','Languages & Linguistics','🗣️',106),
        ('jura','Jura','Law','⚖️',107),('kunst','Kunst','Art','🎨',110),
        ('fotografering','Fotografering','Photography','📷',111),('video','Video & Film','Video & Filmmaking','🎥',112),
        ('design','Design','Design','🖌️',113),('arkitektur','Arkitektur','Architecture','🏛️',114),
        ('skrivning','Skrivning & Forfatterskab','Writing & Authorship','✍️',115),
        ('animation','Animation','Animation','🎞️',116),('haandvaerk','Håndværk & Kreativitet','Crafts & Creativity','🧵',117),
        ('teater','Teater & Scenekunst','Theatre & Performing Arts','🎭',118),
        ('kunstmuseer','Kunstmuseer & Gallerier','Art Museums & Galleries','🖼️',119),
        ('bolig','Bolig & Ejendom','Housing & Property','🏠',120),('have','Have & Planter','Garden & Plants','🌱',121),
        ('indretning','Indretning & Boligindretning','Interior Design','🛋️',122),
        ('baeredygtighed','Bæredygtighed','Sustainability','♻️',123),('diy','Gør-det-selv','DIY','🔨',124),
        ('erhverv','Erhverv & Business','Business','💼',130),('ivaerksaetter','Iværksætter','Entrepreneurship','🚀',131),
        ('ledelse','Ledelse & Management','Leadership & Management','👔',132),
        ('marketing','Marketing','Marketing','📣',133),('salg','Salg','Sales','🤝',134),
        ('hr','HR & Personale','HR & People','👥',135),('startup','Startup','Startup','💡',136),
        ('ejendomme','Ejendomme','Real Estate','🏢',137),('okonomi','Økonomi','Finance','💰',140),
        ('investering','Investering','Investing','📈',141),('kryptovaluta','Kryptovaluta','Cryptocurrency','🪙',142),
        ('personlig-okonomi','Personlig økonomi','Personal Finance','💳',143),
        ('sundhed','Sundhed','Health','💪',150),('mental-sundhed','Mental sundhed','Mental Health','🧘',151),
        ('kost','Kost & Ernæring','Nutrition & Diet','🥑',152),
        ('meditation','Meditation & Mindfulness','Meditation & Mindfulness','🕯️',153),
        ('alternativ-medicin','Naturmedicin','Alternative Medicine','🌿',154),
        ('familie','Familie','Family','👨‍👩‍👧‍👦',160),('boern','Børn & Forældre','Children & Parenting','👶',161),
        ('dating','Dating & Kærlighed','Dating & Love','❤️',162),('minimalisme','Minimalisme','Minimalism','✨',163),
        ('hygge','Hygge','Hygge','🕯️',164),('biler','Biler','Cars','🚗',170),
        ('elbiler','Elbiler','Electric Cars','⚡',171),('motorcykler','Motorcykler','Motorcycles','🏍️',172),
        ('tog','Tog & Jernbane','Trains & Railways','🚂',173),('nyheder','Nyheder','News','📰',180),
        ('politik','Politik','Politics','🏛️',181),('frivillighed','Frivillighed','Volunteering','🫶',182),
        ('aktivisme','Aktivisme','Activism','✊',183),('lokalsamfund','Lokalsamfund','Local Community','🏘️',184),
        ('religion','Religion & Spiritualitet','Religion & Spirituality','🙏',185),
        ('dansk-kultur','Dansk kultur','Danish Culture','🇩🇰',186),
        ('nordisk-kultur','Nordisk kultur','Nordic Culture','🌍',187),
        ('mode','Mode','Fashion','👗',190),('humor','Humor','Humor','😄',191),
        ('boger','Bøger','Books','📚',192)`)
    }

    // Daily decay: reduce weights by 0.5% for interests with no signal in the last 24 hours
    setInterval(async () => {
      try {
        await pool.query(`
          UPDATE interest_scores
          SET weight = GREATEST(0, weight * 0.995)
          WHERE (last_signal_at IS NULL OR last_signal_at < NOW() - INTERVAL 24 HOUR)
            AND weight > 0
        `)
      } catch (err) { console.error('Interest decay error:', err.message) }
    }, 24 * 60 * 60 * 1000)

    // GDPR cleanup: raw signals deleted after 90 days, only scores are kept
    setInterval(async () => {
      try {
        await pool.query('DELETE FROM interest_signals WHERE created_at < NOW() - INTERVAL 90 DAY')
      } catch (err) { console.error('Signal GDPR cleanup error:', err.message) }
    }, 24 * 60 * 60 * 1000)
  } catch (err) {
    console.error('initSignalEngine error:', err.message)
  }
}

// POST /api/jobs/:id/apply — submit a job application (with optional CV + application letter)
app.post('/api/jobs/:id/apply', authenticate, uploadDoc.fields([{ name: 'cv', maxCount: 1 }, { name: 'application_letter', maxCount: 1 }]), async (req, res) => {
  try {
    const { name, email, message } = req.body
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' })
    const [[job]] = await pool.query("SELECT id FROM jobs WHERE id = ? AND status = 'open'", [req.params.id])
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const cvFile = req.files?.cv?.[0]
    const letterFile = req.files?.application_letter?.[0]
    const cvUrl = cvFile ? `/uploads/${cvFile.filename}` : null
    const letterUrl = letterFile ? `/uploads/${letterFile.filename}` : null
    await pool.query(
      'INSERT INTO job_applications (job_id, applicant_id, name, email, message, cv_url, application_letter_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, req.userId, name, email, message || null, cvUrl, letterUrl]
    )
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already applied' })
    console.error('POST /api/jobs/:id/apply error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs/:id/applications — recruiter: list applicants (company admin/owner only)
app.get('/api/jobs/:id/applications', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT id, company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin','editor')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [applications] = await pool.query(
      `SELECT ja.*, u.handle AS applicant_handle
       FROM job_applications ja JOIN users u ON u.id = ja.applicant_id
       WHERE ja.job_id = ? ORDER BY ja.created_at DESC`,
      [req.params.id]
    )
    res.json({ applications })
  } catch (err) {
    console.error('GET /api/jobs/:id/applications error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/jobs/:id/applications/:appId — recruiter: update applicant status
app.patch('/api/jobs/:id/applications/:appId', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['pending', 'reviewed', 'shortlisted', 'rejected']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const [[job]] = await pool.query('SELECT id, company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin','editor')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE job_applications SET status = ? WHERE id = ? AND job_id = ?', [status, req.params.appId, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/jobs/:id/applications/:appId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/jobs/:id/share — share a job with another user
app.post('/api/jobs/:id/share', authenticate, async (req, res) => {
  try {
    const { userId: recipientId } = req.body
    if (!recipientId) return res.status(400).json({ error: 'userId required' })
    if (recipientId === req.userId) return res.status(400).json({ error: 'Cannot share with yourself' })

    // Verify job exists
    const [[job]] = await pool.query('SELECT title FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Job not found' })

    // Verify recipient exists
    const [[recipient]] = await pool.query('SELECT id FROM users WHERE id = ?', [recipientId])
    if (!recipient) return res.status(404).json({ error: 'User not found' })

    // Get current user name for notification
    const [[currentUser]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const senderName = currentUser?.name || 'Someone'

    // Create or update share record
    try {
      await pool.query(
        `INSERT INTO shared_jobs (job_id, shared_by_user_id, shared_with_user_id)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE shared_at = NOW()`,
        [req.params.id, req.userId, recipientId]
      )
    } catch (e) {
      // Table may not exist yet, skip
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }

    // Send notification to recipient
    const jobTitle = typeof job.title === 'object' ? (job.title.da || job.title.en || job.title) : job.title
    await createNotification(
      recipientId,
      'job_shared',
      `${senderName} har delt jobbet "${jobTitle}" med dig`,
      `${senderName} shared the job "${jobTitle}" with you`,
      req.userId,
      senderName,
      null
    )

    res.json({ ok: true, jobId: req.params.id, sharedWith: recipientId })
  } catch (err) {
    console.error('POST /api/jobs/:id/share error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/jobs/:id/share/:userId — unshare job
app.delete('/api/jobs/:id/share/:userId', authenticate, async (req, res) => {
  try {
    try {
      await pool.query(
        'DELETE FROM shared_jobs WHERE job_id = ? AND shared_by_user_id = ? AND shared_with_user_id = ?',
        [req.params.id, req.userId, req.params.userId]
      )
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/jobs/:id/share/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs/:id/shared-with — get list of users job is shared with (by current user)
app.get('/api/jobs/:id/shared-with', authenticate, async (req, res) => {
  try {
    let sharedWith = []
    try {
      const [rows] = await pool.query(`
        SELECT u.id, u.name, u.handle
        FROM shared_jobs sj
        JOIN users u ON sj.shared_with_user_id = u.id
        WHERE sj.job_id = ? AND sj.shared_by_user_id = ?
        ORDER BY sj.shared_at DESC
      `, [req.params.id, req.userId])
      sharedWith = rows || []
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ sharedWith })
  } catch (err) {
    console.error('GET /api/jobs/:id/shared-with error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/jobs/shared — get jobs shared with me
app.get('/api/jobs/shared', authenticate, async (req, res) => {
  try {
    let sharedJobs = []
    try {
      const [rows] = await pool.query(`
        SELECT DISTINCT j.*, u.name as shared_by_name
        FROM jobs j
        JOIN shared_jobs sj ON j.id = sj.job_id
        JOIN users u ON sj.shared_by_user_id = u.id
        WHERE sj.shared_with_user_id = ?
        ORDER BY sj.shared_at DESC
      `, [req.userId])
      sharedJobs = rows || []
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ jobs: sharedJobs })
  } catch (err) {
    console.error('GET /api/jobs/shared error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Contact Notes (CRM) ───────────────────────────────────────────────────────

// GET /api/contact-notes/:userId — get my private note for a specific contact
app.get('/api/contact-notes/:userId', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT note, updated_at FROM contact_notes WHERE author_id = ? AND contact_id = ?',
      [req.userId, req.params.userId]
    )
    res.json({ note: row?.note || '', updatedAt: row?.updated_at || null })
  } catch (err) {
    console.error('GET /api/contact-notes/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/contact-notes/:userId — save/update my private note for a contact
app.put('/api/contact-notes/:userId', authenticate, async (req, res) => {
  try {
    const { note } = req.body
    if (note === undefined) return res.status(400).json({ error: 'note required' })
    if (!note.trim()) {
      await pool.query('DELETE FROM contact_notes WHERE author_id = ? AND contact_id = ?', [req.userId, req.params.userId])
      return res.json({ ok: true })
    }
    await pool.query(
      `INSERT INTO contact_notes (author_id, contact_id, note) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE note = VALUES(note), updated_at = NOW()`,
      [req.userId, req.params.userId, note.trim()]
    )
    const [[row]] = await pool.query(
      'SELECT updated_at FROM contact_notes WHERE author_id = ? AND contact_id = ?',
      [req.userId, req.params.userId]
    )
    res.json({ ok: true, updatedAt: row?.updated_at || null })
  } catch (err) {
    console.error('PUT /api/contact-notes/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/contact-notes — list all my notes (for "My notes" view)
app.get('/api/contact-notes', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cn.contact_id, cn.note, cn.updated_at, u.name AS contact_name, u.handle AS contact_handle, u.avatar_url AS contact_avatar
       FROM contact_notes cn JOIN users u ON u.id = cn.contact_id
       WHERE cn.author_id = ? AND cn.note != '' ORDER BY cn.updated_at DESC`,
      [req.userId]
    )
    res.json({ notes: rows })
  } catch (err) {
    console.error('GET /api/contact-notes error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Scheduled Posts ───────────────────────────────────────────────────────────

// GET /api/feed/scheduled — list my scheduled posts
app.get('/api/feed/scheduled', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.scheduled_at
       FROM posts p WHERE p.author_id = ? AND p.scheduled_at > NOW()
       ORDER BY p.scheduled_at ASC`,
      [req.userId]
    )
    const result = posts.map(p => {
      let media = null
      if (p.media) { try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {} }
      return { id: p.id, text: { da: p.text_da, en: p.text_en }, media, scheduledAt: p.scheduled_at }
    })
    res.json({ posts: result })
  } catch (err) {
    console.error('GET /api/feed/scheduled error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/feed/scheduled/:id — reschedule or cancel a scheduled post
app.patch('/api/feed/scheduled/:id', authenticate, async (req, res) => {
  try {
    const { scheduled_at } = req.body
    const [[post]] = await pool.query('SELECT id FROM posts WHERE id = ? AND author_id = ? AND scheduled_at > NOW()', [req.params.id, req.userId])
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' })
    if (!scheduled_at) {
      // Cancel: set scheduled_at to null so post publishes immediately
      await pool.query('UPDATE posts SET scheduled_at = NULL WHERE id = ?', [req.params.id])
    } else {
      await pool.query('UPDATE posts SET scheduled_at = ? WHERE id = ?', [new Date(scheduled_at), req.params.id])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/feed/scheduled/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Company Lead Capture ──────────────────────────────────────────────────────

// POST /api/companies/:id/leads — submit a lead form
app.post('/api/companies/:id/leads', authenticate, async (req, res) => {
  try {
    const { name, email, topic, message } = req.body
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email required' })
    const [[company]] = await pool.query('SELECT id FROM companies WHERE id = ?', [req.params.id])
    if (!company) return res.status(404).json({ error: 'Company not found' })
    await pool.query(
      'INSERT INTO company_leads (company_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, name.trim(), email.trim(), topic?.trim() || null, message?.trim() || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/companies/:id/leads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/companies/:id/leads — company admin: get all leads
app.get('/api/companies/:id/leads', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [leads] = await pool.query(
      'SELECT * FROM company_leads WHERE company_id = ? ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json({ leads })
  } catch (err) {
    console.error('GET /api/companies/:id/leads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/companies/:id/leads/:leadId — update lead status
app.patch('/api/companies/:id/leads/:leadId', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['new', 'responded', 'archived']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE company_leads SET status = ? WHERE id = ? AND company_id = ?', [status, req.params.leadId, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/companies/:id/leads/:leadId error:', err.message)
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ads_advertiser (advertiser_id),
      INDEX idx_ads_status_placement (status, placement),
      FOREIGN KEY (advertiser_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await addCol('ads', 'paid_until', 'DATETIME DEFAULT NULL')
    await addCol('ads', 'payment_status', "VARCHAR(32) DEFAULT 'unpaid'")
    await addCol('ads', 'paid_amount', 'DECIMAL(10,2) DEFAULT NULL')
    await addCol('ads', 'paid_at', 'DATETIME DEFAULT NULL')
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
      currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
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
    // Ensure columns exist on older installs
    await addCol('admin_ad_settings', 'ads_enabled', 'TINYINT(1) NOT NULL DEFAULT 1')
    await addCol('admin_ad_settings', 'ad_price_cpm', 'DECIMAL(10,2) NOT NULL DEFAULT 50.00')
    await addCol('admin_ad_settings', 'max_ads_feed', 'INT NOT NULL DEFAULT 3')
    await addCol('admin_ad_settings', 'max_ads_sidebar', 'INT NOT NULL DEFAULT 2')
    await addCol('admin_ad_settings', 'max_ads_stories', 'INT NOT NULL DEFAULT 1')
    await addCol('admin_ad_settings', 'refresh_interval_seconds', 'INT NOT NULL DEFAULT 300')
    await addCol('admin_ad_settings', 'adfree_recurring_pct', 'INT NOT NULL DEFAULT 100')
    await addCol('admin_ad_settings', 'ad_recurring_pct', 'INT NOT NULL DEFAULT 100')
    await addCol('admin_ad_settings', 'boost_price', 'DECIMAL(10,2) NOT NULL DEFAULT 9.00')
    // Ensure a default row always exists
    await pool.query(`INSERT IGNORE INTO admin_ad_settings (id) VALUES (1)`)
    // Fix NULL ads_enabled on existing rows (should default to enabled)
    await pool.query(`UPDATE admin_ad_settings SET ads_enabled = 1 WHERE id = 1 AND ads_enabled IS NULL`).catch(() => {})
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

// POST /api/ads — create ad (business only)
app.post('/api/ads', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  const { title, body, image_url, target_url, placement = 'feed', start_date, end_date, budget, target_interests } = req.body
  if (!title || !target_url) return res.status(400).json({ error: 'title and target_url required' })
  try {
    // Snapshot current CPM rate at ad creation time
    const [[settings]] = await pool.query('SELECT ad_price_cpm FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const cpmRate = parseFloat(settings?.ad_price_cpm) || 50
    const budgetVal = budget ? parseFloat(budget) : null
    const interestsVal = target_interests ? JSON.stringify(target_interests) : null
    const [result] = await pool.query(
      'INSERT INTO ads (advertiser_id, title, body, image_url, target_url, placement, start_date, end_date, budget, cpm_rate, target_interests) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.userId, title, body || null, image_url || null, target_url, placement, start_date || null, end_date || null, budgetVal, cpmRate, interestsVal]
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
      // Check if user is ads_free for today (period-based, not stale column)
      const todayAd = new Date().toISOString().split('T')[0]
      const [[adFreeRow]] = await pool.query(`
        SELECT (
          (SELECT COUNT(*) FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
          (SELECT COUNT(*) FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
        ) AS total
      `, [req.userId, todayAd, todayAd, req.userId, todayAd, todayAd]).catch(() => [[{ total: 0 }]])
      if ((adFreeRow?.total ?? 0) > 0) return res.json({ ads: [], ads_free: true })
      const placement = req.query.placement || 'feed'
      // All ads run across all placements — no placement filter
      const limitMap = { feed: settings.max_ads_feed, sidebar: settings.max_ads_sidebar, stories: settings.max_ads_stories, reels: settings.max_ads_feed }
      const limit = limitMap[placement] || 1
      ;[rows] = await pool.query(
        `SELECT * FROM ads WHERE status = 'active' AND (start_date IS NULL OR start_date <= CURDATE()) AND (end_date IS NULL OR end_date >= CURDATE()) ORDER BY RAND() LIMIT ?`,
        [limit]
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

// GET /api/ads/mine — business user's own ads with full monetisation fields
// NOTE: must be registered BEFORE /api/ads/:id
app.get('/api/ads/mine', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    let rows
    try {
      ;[rows] = await pool.query(
        `SELECT id, title, body, image_url, target_url, placement, status, start_date, end_date,
                budget, spent, cpm_rate, reach, impressions, clicks, boosted_post_id,
                target_interests, payment_status, paid_until, created_at
         FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC`,
        [req.userId]
      )
    } catch {
      // Phase 3 migration not yet applied — fall back without new columns
      ;[rows] = await pool.query(
        `SELECT id, title, body, image_url, target_url, placement, status, start_date, end_date,
                NULL AS budget, 0 AS spent, NULL AS cpm_rate, 0 AS reach,
                impressions, clicks, NULL AS boosted_post_id,
                NULL AS target_interests, payment_status, paid_until, created_at
         FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC`,
        [req.userId]
      )
    }
    res.json({ ads: rows })
  } catch (err) {
    console.error('GET /api/ads/mine error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/ads/price — public ad pricing for authenticated users (used in payment modal)
// NOTE: must be registered BEFORE /api/ads/:id to avoid Express matching "price" as :id
app.get('/api/ads/price', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT ad_price_cpm, ad_recurring_pct, boost_price, currency FROM admin_ad_settings WHERE id = 1')
    const adPrice = parseFloat(row?.ad_price_cpm) || 50
    const adRecurringPct = parseInt(row?.ad_recurring_pct ?? 100)
    const adRecurringPrice = Math.round(adPrice * adRecurringPct / 100 * 100) / 100
    const boostPrice = parseFloat(row?.boost_price) || 9
    res.json({ ad_price_cpm: adPrice, ad_recurring_price: adRecurringPrice, ad_recurring_pct: adRecurringPct, boost_price: boostPrice, currency: row?.currency || 'EUR' })
  } catch (err) {
    console.error('GET /api/ads/price error:', err.message)
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
    const { title, body, image_url, target_url, status, placement, start_date, end_date } = req.body
    const VALID_STATUS = ['draft', 'active', 'paused', 'archived']
    const VALID_PLACEMENT = ['feed', 'sidebar', 'stories']
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    if (placement && !VALID_PLACEMENT.includes(placement)) return res.status(400).json({ error: 'Invalid placement' })
    // Block date changes when ad is within its paid period (prevents circumventing payment)
    const isPaidAndActive = ad.paid_until && new Date(ad.paid_until) > new Date()
    if (isPaidAndActive && (start_date !== undefined || end_date !== undefined)) {
      return res.status(403).json({ error: 'Cannot change dates while ad is within paid period' })
    }
    // Allow reactivation of a paid ad without requiring payment (server trusts paid_until)
    await pool.query(
      'UPDATE ads SET title=COALESCE(?,title), body=COALESCE(?,body), image_url=COALESCE(?,image_url), target_url=COALESCE(?,target_url), status=COALESCE(?,status), placement=COALESCE(?,placement), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date) WHERE id=?',
      [title||null, body||null, image_url||null, target_url||null, status||null, placement||null, start_date||null, end_date||null, req.params.id]
    )
    const [[updated]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    res.json({ ad: updated })
  } catch (err) {
    console.error('PUT /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/ads/:id — partial update of ad metadata (blocks placement/cpm_rate changes)
app.patch('/api/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    const { title, body, image_url, target_url, start_date, end_date, budget, target_interests } = req.body
    // placement and cpm_rate cannot be changed via PATCH — use PUT for admin changes
    await pool.query(
      `UPDATE ads SET
        title = COALESCE(?,title), body = COALESCE(?,body),
        image_url = COALESCE(?,image_url), target_url = COALESCE(?,target_url),
        start_date = COALESCE(?,start_date), end_date = COALESCE(?,end_date),
        budget = COALESCE(?,budget),
        target_interests = COALESCE(?,target_interests)
       WHERE id = ?`,
      [title||null, body||null, image_url||null, target_url||null,
       start_date||null, end_date||null,
       budget != null ? parseFloat(budget) : null,
       target_interests ? JSON.stringify(target_interests) : null,
       req.params.id]
    )
    const [[updated]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    res.json({ ad: updated })
  } catch (err) {
    console.error('PATCH /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/ads/:id — permanently delete ad (only allowed when status = 'draft')
app.delete('/api/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    if (ad.status !== 'draft' && req.userId !== 1) return res.status(409).json({ error: 'Only draft ads can be deleted' })
    await pool.query('DELETE FROM ads WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/ads/:id/pay — create Mollie payment to activate an ad
app.post('/api/ads/:id/pay', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    const [[settings]] = await pool.query('SELECT ad_price_cpm, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const cpmRate = parseFloat(ad.cpm_rate || settings?.ad_price_cpm) || 50
    const budget = parseFloat(ad.budget) || cpmRate // default to 1 CPM unit
    const currency = settings?.currency || 'EUR'
    const amount = budget.toFixed(2)

    const mollie = await getMollieClient()
    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
    if (!mollie) {
      // Dev fallback: immediately activate without payment
      await pool.query(
        "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ?",
        [adId]
      )
      await pool.query(
        'INSERT INTO subscriptions (user_id, plan, status, ad_id) VALUES (?, ?, ?, ?)',
        [req.userId, 'ad_activation', 'paid', adId]
      )
      return res.json({ activated: true, checkout_url: null })
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    const payment = await mollie.payments.create({
      amount: { currency, value: amount },
      description: `fellis.eu — annonce aktivering #${adId}`,
      redirectUrl: `${origin}/?mollie_payment=success&plan=ad_activation&ad_id=${adId}`,
      webhookUrl: `${siteUrl}/api/mollie/payment/webhook`,
      metadata: { user_id: String(req.userId), plan: 'ad_activation', ad_id: String(adId) },
    })
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, payment.id, 'ad_activation', payment.status, adId]
    )
    res.json({ checkout_url: payment.getCheckoutUrl(), activated: false })
  } catch (err) {
    console.error('POST /api/ads/:id/pay error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/ads/:id/impression — record impression with CPM deduction and reach tracking
app.post('/api/ads/:id/impression', authenticate, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const [[ad]] = await pool.query('SELECT id, cpm_rate, budget, spent, status FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })

    // Dedup: one impression per user per ad per hour (graceful if migration not yet run)
    let isDuplicate = false
    try {
      const hourBucket = new Date()
      hourBucket.setMinutes(0, 0, 0)
      try {
        await pool.query(
          'INSERT INTO ad_impressions (ad_id, user_id, hour_bucket) VALUES (?, ?, ?)',
          [adId, req.userId, hourBucket]
        )
      } catch (dupErr) {
        if (dupErr.code === 'ER_DUP_ENTRY') { isDuplicate = true }
        else if (dupErr.code !== 'ER_NO_SUCH_TABLE') throw dupErr
      }
      if (isDuplicate) return res.json({ ok: true, duplicate: true })

      // reach = count distinct users who have seen this ad
      const [[{ rc }]] = await pool.query('SELECT COUNT(DISTINCT user_id) AS rc FROM ad_impressions WHERE ad_id = ?', [adId])
      await pool.query('UPDATE ads SET reach = ? WHERE id = ?', [rc, adId])
    } catch { /* ad_impressions table not yet migrated — skip dedup and reach */ }

    // Increment impressions
    await pool.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [adId])

    // CPM spend deduction
    if (ad.cpm_rate && ad.cpm_rate > 0) {
      const costPerImpression = parseFloat(ad.cpm_rate) / 1000
      await pool.query(
        'UPDATE ads SET spent = spent + ? WHERE id = ?',
        [costPerImpression, adId]
      )
      // Autopause when spent >= budget
      if (ad.budget && ad.budget > 0) {
        const newSpent = parseFloat(ad.spent) + costPerImpression
        if (newSpent >= parseFloat(ad.budget)) {
          await pool.query("UPDATE ads SET status = 'paused' WHERE id = ? AND status = 'active'", [adId])
        }
      }
    }

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
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/click error:', err.message)
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
  const allowed = ['adfree_price_private', 'adfree_price_business', 'ad_price_cpm', 'boost_price', 'currency', 'max_ads_feed', 'max_ads_sidebar', 'max_ads_stories', 'refresh_interval_seconds', 'ads_enabled', 'adfree_recurring_pct', 'ad_recurring_pct']
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

// GET /api/admin/ad-stats — per-placement impressions, clicks, CTR, count & revenue (admin only)
app.get('/api/admin/ad-stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT placement,
              COUNT(*) AS total_count,
              SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
              SUM(CASE WHEN payment_status = 'paid' THEN COALESCE(paid_amount, 0) ELSE 0 END) AS total_paid,
              SUM(impressions) AS impressions,
              SUM(clicks) AS clicks
       FROM ads
       WHERE status != 'archived'
       GROUP BY placement`
    )
    const stats = rows.map(r => ({
      placement: r.placement,
      total_count: Number(r.total_count) || 0,
      paid_count: Number(r.paid_count) || 0,
      total_paid: Number(r.total_paid) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      ctr: r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : '0.00',
    }))
    res.json({ stats })
  } catch (err) {
    console.error('GET /api/admin/ad-stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// (Stripe integration removed — platform uses Mollie for payments)

// GET /api/me/subscription — get current user's ads_free status + Mollie subscription details
app.get('/api/me/subscription', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT ads_free, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const [[adSettings]] = await pool.query('SELECT adfree_price_private, adfree_price_business, adfree_recurring_pct, currency, ads_enabled FROM admin_ad_settings WHERE id = 1').catch(() => [[{ adfree_price_private: 29, adfree_price_business: 49, adfree_recurring_pct: 100, currency: 'EUR', ads_enabled: 1 }]])
    const price = parseFloat(user.mode === 'business' ? adSettings?.adfree_price_business : adSettings?.adfree_price_private) || 29
    const recurringPct = parseInt(adSettings?.adfree_recurring_pct ?? 100)
    const recurringPrice = Math.round(price * recurringPct / 100 * 100) / 100

    // Include Mollie subscription status
    const [[sub]] = await pool.query(
      `SELECT plan, status, expires_at, recurring, mollie_subscription_id
       FROM subscriptions WHERE user_id = ? AND plan != 'ad_activation'
       ORDER BY recurring DESC, created_at DESC LIMIT 1`,
      [req.userId]
    ).catch(() => [[null]])

    res.json({
      ads_free: Boolean(user.ads_free),
      price,
      recurring_price: recurringPrice,
      recurring_pct: recurringPct,
      currency: adSettings?.currency || 'EUR',
      ads_enabled: Boolean(adSettings?.ads_enabled),
      plan: sub?.plan || null,
      status: sub?.status || null,
      expires_at: sub?.expires_at || null,
      recurring: Boolean(sub?.recurring),
      has_subscription: !!sub?.mollie_subscription_id,
    })
  } catch (err) {
    console.error('GET /api/me/subscription error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Mollie — subscription payments ──────────────────────────────────────────

async function initMollie() {
  try {
    // Create subscriptions table if it doesn't exist
    await pool.query(`CREATE TABLE IF NOT EXISTS subscriptions (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id           INT UNSIGNED NOT NULL,
      mollie_payment_id VARCHAR(64) DEFAULT NULL,
      plan              VARCHAR(32) NOT NULL DEFAULT 'adfree',
      status            VARCHAR(32) NOT NULL DEFAULT 'open',
      expires_at        DATETIME DEFAULT NULL,
      created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_id (user_id),
      KEY idx_mollie_payment_id (mollie_payment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Ensure columns exist (idempotent for existing installs)
    await addCol('subscriptions', 'mollie_payment_id', 'VARCHAR(64) DEFAULT NULL')
    await addCol('subscriptions', 'plan', "VARCHAR(32) NOT NULL DEFAULT 'adfree'")
    await addCol('subscriptions', 'status', "VARCHAR(32) NOT NULL DEFAULT 'open'")
    await addCol('subscriptions', 'expires_at', 'DATETIME DEFAULT NULL')
    await addCol('subscriptions', 'ad_id', 'INT DEFAULT NULL')
    await addCol('subscriptions', 'recurring', 'TINYINT(1) NOT NULL DEFAULT 0')
    await addCol('subscriptions', 'mollie_subscription_id', 'VARCHAR(64) DEFAULT NULL')
    await addCol('users', 'mollie_customer_id', 'VARCHAR(64) DEFAULT NULL')
  } catch (err) {
    console.error('initMollie:', err.message)
  }
}

async function getMollieKey() {
  // 1. Process env (set at startup from .env file)
  const envKey = (process.env.MOLLIE_API_KEY || '').replace(/^["']|["']$/g, '').trim()
  if (envKey) return envKey
  // 2. Re-read .env file directly as fallback (handles PM2 env not updating)
  try {
    const { readFileSync } = await import('fs')
    const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      if (trimmed.slice(0, idx).trim() === 'MOLLIE_API_KEY') {
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
        if (val) return val
      }
    }
  } catch {}
  // 3. DB admin_settings fallback
  try {
    const [[row]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'mollie_api_key'")
    if (row?.key_value && !row.key_value.startsWith('••')) return row.key_value
  } catch {}
  return null
}

async function getMollieClient() {
  const key = await getMollieKey()
  if (!key) return null
  try {
    const { createMollieClient } = await import('@mollie/api-client')
    return createMollieClient({ apiKey: key })
  } catch (err) {
    console.error('getMollieClient import error:', err.message)
    return null
  }
}

// POST /api/mollie/payment/create — create a Mollie payment and return checkout URL
app.post('/api/mollie/payment/create', authenticate, async (req, res) => {
  try {
    const { plan, currency: reqCurrency, ad_id: adId, recurring = false } = req.body || {}
    if (!plan) return res.status(400).json({ error: 'Missing required field: plan' })

    const mollie = await getMollieClient()
    if (!mollie) return res.status(503).json({ error: 'Mollie ikke konfigureret — sæt MOLLIE_API_KEY i server/.env eller i Betalingskonfiguration under Admin' })

    const [[user]] = await pool.query('SELECT id, email, name, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Resolve amount from admin_ad_settings
    let resolvedAmount = null
    let resolvedCurrency = reqCurrency || 'EUR'
    const [[adS]] = await pool.query('SELECT adfree_price_private, adfree_price_business, adfree_recurring_pct, ad_price_cpm, ad_recurring_pct, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    resolvedCurrency = adS?.currency || 'EUR'
    if (plan === 'adfree') {
      const oneTimePrice = parseFloat(user.mode === 'business' ? adS?.adfree_price_business : adS?.adfree_price_private) || 29
      if (recurring) {
        const pct = parseInt(adS?.adfree_recurring_pct ?? 100)
        resolvedAmount = Math.round(oneTimePrice * pct / 100 * 100) / 100
      } else {
        resolvedAmount = oneTimePrice
      }
    } else if (plan === 'ad_activation') {
      const oneTimePrice = parseFloat(adS?.ad_price_cpm) || 50
      if (recurring) {
        const pct = parseInt(adS?.ad_recurring_pct ?? 100)
        resolvedAmount = Math.round(oneTimePrice * pct / 100 * 100) / 100
      } else {
        resolvedAmount = oneTimePrice
      }
    }
    if (!resolvedAmount || isNaN(resolvedAmount) || resolvedAmount <= 0) resolvedAmount = 29

    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
    const siteUrl = process.env.SITE_URL || origin
    const adIdParam = adId ? `&ad_id=${adId}` : ''
    const recurringParam = recurring ? '&recurring=1' : ''
    const redirectUrl = `${origin}/?mollie_payment=success&plan=${encodeURIComponent(plan)}${adIdParam}${recurringParam}`
    const webhookUrl = `${siteUrl}/api/mollie/payment/webhook`

    // For recurring: get or create a Mollie customer to enable mandate/subscription
    let mollieCustomerId = null
    if (recurring) {
      const [[userRow]] = await pool.query('SELECT mollie_customer_id, email, name FROM users WHERE id = ?', [req.userId])
      mollieCustomerId = userRow?.mollie_customer_id
      if (!mollieCustomerId) {
        const customer = await mollie.customers.create({ name: userRow?.name || 'fellis user', email: userRow?.email || '' })
        mollieCustomerId = customer.id
        await pool.query('UPDATE users SET mollie_customer_id = ? WHERE id = ?', [mollieCustomerId, req.userId]).catch(() => {})
      }
    }

    const paymentParams = {
      amount: { currency: resolvedCurrency, value: resolvedAmount.toFixed(2) },
      description: `fellis.eu — ${plan}${recurring ? ' (abonnement)' : ''}`,
      redirectUrl,
      webhookUrl,
      metadata: { user_id: String(req.userId), plan, recurring: String(!!recurring), ...(adId ? { ad_id: String(adId) } : {}) },
    }
    if (recurring && mollieCustomerId) {
      paymentParams.customerId = mollieCustomerId
      paymentParams.sequenceType = 'first'
    }

    const payment = await mollie.payments.create(paymentParams)

    const checkoutUrl = payment._links?.checkout?.href
    if (!checkoutUrl) {
      console.error('POST /api/mollie/payment/create: no checkout URL in response', JSON.stringify(payment._links))
      return res.status(500).json({ error: 'Mollie returnerede ingen checkout-URL. Prøv igen.' })
    }

    // Record the pending payment in the subscriptions table
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id, recurring) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, payment.id, plan, 'open', adId || null, recurring ? 1 : 0]
    ).catch(() =>
      pool.query('INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status) VALUES (?, ?, ?, ?)',
        [req.userId, payment.id, plan, 'open'])
    )
    // Mark the ad as payment pending immediately when checkout is initiated
    if (plan === 'ad_activation' && adId) {
      await pool.query(
        "UPDATE ads SET payment_status = 'pending' WHERE id = ? AND advertiser_id = ?",
        [adId, req.userId]
      ).catch(() => {})
    }

    res.json({ checkoutUrl, paymentId: payment.id })
  } catch (err) {
    console.error('POST /api/mollie/payment/create error:', err.message, err.stack)
    // Surface Mollie API error details if available
    const mollieMsg = err.message || ''
    res.status(500).json({ error: mollieMsg || 'Server error' })
  }
})

// POST /api/mollie/payment/webhook — Mollie webhook (always returns 200 so Mollie doesn't retry)
app.post('/api/mollie/payment/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  // Always respond 200 immediately — Mollie retries if we don't
  res.status(200).send('OK')
  try {
    const id = req.body?.id || req.query?.id
    if (!id || typeof id !== 'string' || !id.startsWith('tr_')) {
      console.warn('Mollie webhook: invalid or missing payment id:', id)
      return
    }

    const mollie = await getMollieClient()
    if (!mollie) { console.error('Mollie webhook: client unavailable'); return }

    const payment = await mollie.payments.get(id)

    // Subscription renewal payments from Mollie have a subscriptionId but no matching row by payment id.
    // Find sub by mollie_subscription_id first, then fall back to mollie_payment_id.
    let sub = null
    if (payment.subscriptionId) {
      const [[bySub]] = await pool.query('SELECT * FROM subscriptions WHERE mollie_subscription_id = ?', [payment.subscriptionId])
      sub = bySub || null
    }
    if (!sub) {
      const [[byPay]] = await pool.query('SELECT * FROM subscriptions WHERE mollie_payment_id = ?', [id])
      sub = byPay || null
    }
    if (!sub) { console.warn('Mollie webhook: no subscription row for payment', id); return }

    const status = payment.status // 'open','pending','authorized','expired','canceled','failed','paid'
    const expiresAt = status === 'paid' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null

    // For renewal payments (subscriptionId present) insert a new row rather than overwriting the original
    if (payment.subscriptionId && sub.mollie_subscription_id) {
      if (status === 'paid') {
        await pool.query(
          'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id, recurring, mollie_subscription_id, expires_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
          [sub.user_id, id, sub.plan, 'paid', sub.ad_id || null, sub.mollie_subscription_id, expiresAt]
        ).catch(() => {})
      }
    } else {
      await pool.query(
        'UPDATE subscriptions SET status = ?, expires_at = ? WHERE mollie_payment_id = ?',
        [status, expiresAt, id]
      )
    }

    if (status === 'paid') {
      const isRecurringFirstPayment = sub.recurring && !sub.mollie_subscription_id
      const adId = sub.ad_id || payment.metadata?.ad_id
      const paidAmount = parseFloat(payment.amount?.value) || null

      if (sub.plan === 'ad_activation') {
        // Activate the ad and extend paid_until
        if (adId) await pool.query(
          "UPDATE ads SET status = 'active', paid_until = DATE_ADD(NOW(), INTERVAL 30 DAY), payment_status = 'paid', paid_amount = ?, paid_at = NOW() WHERE id = ?",
          [paidAmount, adId]
        ).catch(() =>
          pool.query("UPDATE ads SET status = 'active', paid_until = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ?", [adId])
        )
      } else if (sub.plan === 'boost') {
        // Boost the marketplace listing for 7 days
        const listingId = sub.ad_id || payment.metadata?.listing_id
        if (listingId) {
          await pool.query(
            'UPDATE marketplace_listings SET boosted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?',
            [listingId]
          ).catch(() => {})
          const [[listing]] = await pool.query('SELECT title, user_id FROM marketplace_listings WHERE id = ?', [listingId]).catch(() => [[null]])
          if (listing) {
            createNotification(sub.user_id, 'listing_boosted',
              `Din annonce "${listing.title}" er nu boostet i 7 dage`,
              `Your listing "${listing.title}" is now boosted for 7 days`,
              sub.user_id, null
            )
          }
        }
      } else if (sub.plan === 'post_boost') {
        // Activate the boosted post ad
        const adId = sub.ad_id || payment.metadata?.ad_id
        if (adId) {
          const [[adRow]] = await pool.query('SELECT boosted_post_id FROM ads WHERE id = ?', [adId]).catch(() => [[null]])
          await pool.query(
            "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?",
            [adId]
          ).catch(() => {})
          if (adRow?.boosted_post_id) {
            createNotification(sub.user_id, 'post_boosted',
              `Dit opslag er nu boostet i 7 dage`,
              `Your post is now boosted for 7 days`,
              sub.user_id, null
            )
          }
        }
      } else {
        // adfree plan: set flag and record a purchased period
        await pool.query('UPDATE users SET ads_free = 1 WHERE id = ?', [sub.user_id])
        if (sub.plan === 'adfree') {
          const periodStart = new Date().toISOString().split('T')[0]
          const periodEnd = expiresAt ? expiresAt.toISOString().split('T')[0] : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          await pool.query(
            `INSERT INTO adfree_purchased_periods (user_id, start_date, end_date, subscription_id)
             VALUES (?, ?, ?, ?)`,
            [sub.user_id, periodStart, periodEnd, sub.id]
          ).catch(() => {}) // table may not exist on old installs until migration runs
        }
      }

      // After first payment of a recurring plan: create a Mollie Subscription
      if (isRecurringFirstPayment && payment.customerId) {
        try {
          const interval = sub.plan === 'ad_activation' ? '30 days' : '1 month'
          const mollieSubscription = await mollie.customers.subscriptions.create(payment.customerId, {
            amount: { currency: payment.amount.currency, value: payment.amount.value },
            interval,
            description: `fellis.eu — ${sub.plan} (abonnement)`,
            webhookUrl: `${process.env.SITE_URL || 'https://fellis.eu'}/api/mollie/payment/webhook`,
            metadata: { user_id: String(sub.user_id), plan: sub.plan, ...(adId ? { ad_id: String(adId) } : {}) },
          })
          await pool.query(
            'UPDATE subscriptions SET mollie_subscription_id = ? WHERE id = ?',
            [mollieSubscription.id, sub.id]
          ).catch(() => {})
          await pool.query(
            'UPDATE users SET mollie_customer_id = ? WHERE id = ?',
            [payment.customerId, sub.user_id]
          ).catch(() => {})
        } catch (subErr) {
          console.error('Mollie subscription create error:', subErr.message)
        }
      }
    } else if (['expired', 'canceled', 'failed'].includes(status)) {
      if (sub.plan === 'ad_activation' || sub.plan === 'post_boost') {
        const adId = sub.ad_id || payment.metadata?.ad_id
        if (adId) await pool.query(
          "UPDATE ads SET payment_status = 'failed' WHERE id = ? AND payment_status != 'paid'",
          [adId]
        ).catch(() => {})
      } else if (sub.plan !== 'boost') {
        // boost failures have no side-effects to revert
        const [[active]] = await pool.query(
          "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'paid' AND (expires_at IS NULL OR expires_at > NOW()) AND mollie_payment_id != ? LIMIT 1",
          [sub.user_id, id]
        )
        if (!active) {
          await pool.query('UPDATE users SET ads_free = 0 WHERE id = ?', [sub.user_id])
        }
      }
    }
  } catch (err) {
    console.error('POST /api/mollie/payment/webhook error:', err.message)
  }
})

// GET /api/mollie/payment/status — current user's Mollie subscription status
app.get('/api/mollie/payment/status', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT ads_free, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Get the most recent active or pending subscription (prefer recurring+active)
    const [[sub]] = await pool.query(
      `SELECT plan, status, expires_at, recurring, mollie_subscription_id
       FROM subscriptions WHERE user_id = ?
       ORDER BY recurring DESC, created_at DESC LIMIT 1`,
      [req.userId]
    )

    res.json({
      ads_free: Boolean(user.ads_free),
      plan: sub?.plan || null,
      status: sub?.status || null,
      expires_at: sub?.expires_at || null,
      recurring: Boolean(sub?.recurring),
      has_subscription: !!sub?.mollie_subscription_id,
    })
  } catch (err) {
    console.error('GET /api/mollie/payment/status error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/mollie/subscription/cancel — cancel active recurring subscription
app.delete('/api/mollie/subscription/cancel', authenticate, async (req, res) => {
  try {
    const [[sub]] = await pool.query(
      `SELECT s.*, u.mollie_customer_id FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ? AND s.mollie_subscription_id IS NOT NULL
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.userId]
    )
    if (!sub) return res.status(404).json({ error: 'No active subscription found' })

    const mollie = await getMollieClient()
    if (!mollie) return res.status(503).json({ error: 'Payment provider unavailable' })

    if (sub.mollie_customer_id && sub.mollie_subscription_id) {
      await mollie.customers.subscriptions.cancel(sub.mollie_subscription_id, { customerId: sub.mollie_customer_id })
        .catch(err => console.warn('Mollie subscription cancel warning:', err.message))
    }

    await pool.query(
      "UPDATE subscriptions SET status = 'canceled' WHERE mollie_subscription_id = ?",
      [sub.mollie_subscription_id]
    )

    // Revoke ads_free if no other active subscription remains
    if (sub.plan !== 'ad_activation') {
      const [[active]] = await pool.query(
        "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'paid' AND (expires_at IS NULL OR expires_at > NOW()) AND mollie_subscription_id != ? LIMIT 1",
        [req.userId, sub.mollie_subscription_id]
      )
      if (!active) await pool.query('UPDATE users SET ads_free = 0 WHERE id = ?', [req.userId])
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/mollie/subscription/cancel error:', err.message)
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

    // Seed default easter egg config (only if none exists yet)
    const defaultEggCfg = {
      chuck:    { globalEnabled: true, hintsEnabled: true,  hintText: 'har en mening' },
      matrix:   { globalEnabled: true, hintsEnabled: false, hintText: '' },
      flip:     { globalEnabled: true, hintsEnabled: false, hintText: '' },
      retro:    { globalEnabled: true, hintsEnabled: false, hintText: '' },
      gravity:  { globalEnabled: true, hintsEnabled: true,  hintText: 'G G' },
      party:    { globalEnabled: true, hintsEnabled: false, hintText: '' },
      rickroll: { globalEnabled: true, hintsEnabled: true,  hintText: 'Going down!' },
      watcher:  { globalEnabled: true, hintsEnabled: false, hintText: '' },
      riddler:  { globalEnabled: true, hintsEnabled: false, hintText: '' },
      phantom:  { globalEnabled: true, hintsEnabled: false, hintText: '' },
    }
    await pool.query(
      "INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('easter_egg_config', ?)",
      [JSON.stringify(defaultEggCfg)]
    )
  } catch (err) {
    console.error('initAdminSettings error:', err.message)
  }
}

async function initAnalytics() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      viewer_id INT NOT NULL,
      profile_id INT NOT NULL,
      source_post_id INT DEFAULT NULL,
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pv_profile (profile_id, viewed_at),
      INDEX idx_pv_viewer (viewer_id),
      INDEX idx_pv_source_post (source_post_id),
      FOREIGN KEY (profile_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    // Add source_post_id to existing installs (ignore if already exists)
    await pool.query(`ALTER TABLE profile_views ADD COLUMN IF NOT EXISTS source_post_id INT DEFAULT NULL`).catch(() => {})
    // Add audience insight columns to users (ignore if already exists)
    await pool.query(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS industry  VARCHAR(100) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS seniority VARCHAR(50)  DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS job_title VARCHAR(100) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS company   VARCHAR(100) DEFAULT NULL`).catch(() => {})
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
  // Allow super_admin or admin roles (backward compat: user ID 1 always admin)
  if (req.userId !== 1 && (!req.adminRole || !['super_admin', 'admin'].includes(req.adminRole))) {
    return res.status(403).json({ error: 'Admin only' })
  }
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

    // Best time to post: engagement (likes + comments) per day-of-week × hour
    // MOD(DAYOFWEEK+5,7) maps Sun=1→6, Mon=2→0, …, Sat=7→5
    const [heatmapRows] = await pool.query(
      `SELECT MOD(DAYOFWEEK(p.created_at) + 5, 7) AS day_idx,
              HOUR(p.created_at) AS hour_idx,
              SUM(p.likes) + COUNT(DISTINCT c.id) AS weight
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY day_idx, hour_idx`,
      [req.userId]
    )
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
    heatmapRows.forEach(r => { heatmap[r.day_idx][r.hour_idx] = Number(r.weight) })

    // Hashtag performance: parse hashtags from post text, sum engagement
    const [postTextsForTags] = await pool.query(
      `SELECT COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), '') AS text,
              p.likes + COUNT(DISTINCT c.id) AS engagement
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY p.id`,
      [req.userId]
    )
    const hashtagMap = {}
    const tagRe = /#[\w\u00C0-\u024F]+/g
    postTextsForTags.forEach(row => {
      const tags = (row.text || '').match(tagRe) || []
      tags.forEach(tag => {
        const key = tag.toLowerCase()
        hashtagMap[key] = (hashtagMap[key] || 0) + Number(row.engagement)
      })
    })
    const hashtagPerformance = Object.entries(hashtagMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    // Audience locations: locations of the user's connections
    const [locationRows] = await pool.query(
      `SELECT u.location, COUNT(*) AS count
       FROM friendships f
       JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
       WHERE (f.user_id = ? OR f.friend_id = ?)
         AND u.location IS NOT NULL AND u.location != ''
       GROUP BY u.location ORDER BY count DESC LIMIT 5`,
      [req.userId, req.userId, req.userId]
    )
    const locTotal = locationRows.reduce((s, r) => s + Number(r.count), 0) || 1
    const audienceLocations = locationRows.map(r => ({
      label: r.location,
      pct: Math.round((Number(r.count) / locTotal) * 100),
    }))

    // Audience growth source: invite-based vs. organic connections
    const [[growthStats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM friendships WHERE user_id = ?) AS total_conns,
        (SELECT COUNT(*) FROM invitations WHERE inviter_id = ? AND status = 'accepted') AS via_invite`,
      [req.userId, req.userId]
    )
    const totalC = Number(growthStats.total_conns)
    const viaInvite = Math.min(Number(growthStats.via_invite), totalC)
    const organic = totalC - viaInvite

    // Industry distribution of connections (requires migrate-audience-insights.sql)
    let industryDist = []
    try {
      const [industryRows] = await pool.query(
        `SELECT u.industry, COUNT(*) AS count
         FROM friendships f
         JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
         WHERE (f.user_id = ? OR f.friend_id = ?)
           AND u.industry IS NOT NULL AND u.industry != ''
         GROUP BY u.industry ORDER BY count DESC LIMIT 8`,
        [req.userId, req.userId, req.userId]
      )
      const indTotal = industryRows.reduce((s, r) => s + Number(r.count), 0) || 1
      industryDist = industryRows.map(r => ({
        label: r.industry,
        pct: Math.round((Number(r.count) / indTotal) * 100),
      }))
    } catch { /* column not yet added */ }

    // Seniority distribution of connections (requires migrate-audience-insights.sql)
    let seniorityDist = []
    try {
      const [seniorityRows] = await pool.query(
        `SELECT u.seniority, COUNT(*) AS count
         FROM friendships f
         JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
         WHERE (f.user_id = ? OR f.friend_id = ?)
           AND u.seniority IS NOT NULL AND u.seniority != ''
         GROUP BY u.seniority ORDER BY count DESC`,
        [req.userId, req.userId, req.userId]
      )
      const senTotal = seniorityRows.reduce((s, r) => s + Number(r.count), 0) || 1
      seniorityDist = seniorityRows.map(r => ({
        label: r.seniority,
        pct: Math.round((Number(r.count) / senTotal) * 100),
      }))
    } catch { /* column not yet added */ }

    // Posts driving profile visits (requires migrate-audience-insights.sql)
    let postsDrivingVisits = []
    try {
      const [drivingRows] = await pool.query(
        `SELECT p.id,
                SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 50) AS text,
                COUNT(*) AS visits
         FROM profile_views pv
         JOIN posts p ON p.id = pv.source_post_id
         WHERE pv.profile_id = ?
           AND pv.source_post_id IS NOT NULL
           AND pv.viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY pv.source_post_id ORDER BY visits DESC LIMIT 5`,
        [req.userId, days]
      )
      postsDrivingVisits = drivingRows.map(r => ({
        label: (r.text || '').trim().slice(0, 40) || `Post #${r.id}`,
        value: Number(r.visits),
      }))
    } catch { /* column not yet added */ }

    // Platform average new connections per user per day (for competitor benchmarking)
    let platformAvgConnGrowth = []
    try {
      const [platformRows] = await pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS total_new
         FROM friendships
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [days]
      )
      const [[{ user_count }]] = await pool.query('SELECT COUNT(*) AS user_count FROM users')
      const uc = Math.max(Number(user_count), 1)
      platformAvgConnGrowth = platformRows.map(r => ({
        date: r.date.toISOString().slice(0, 10),
        value: Math.round((Number(r.total_new) / uc) * 10) / 10,
      }))
    } catch { /* ignore */ }

    // Business-specific stats (only for business mode users)
    let businessStats = null
    try {
      const [[userMode]] = await pool.query('SELECT mode, follower_count, community_score FROM users WHERE id = ?', [req.userId])
      if (userMode?.mode === 'business') {
        // Follower growth per day + 7d/30d aggregates
        const [followerGrowth] = await pool.query(
          `SELECT DATE(created_at) AS date, COUNT(*) AS new_followers
           FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY DATE(created_at) ORDER BY date ASC`,
          [req.userId, days]
        ).catch(() => [[]])

        const [[follower7d]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        const [[follower30d]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        const [[totalFollowers]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ?',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        // Ad performance summary (with paid_until and is_active)
        const [adPerf] = await pool.query(
          `SELECT id, title, status, impressions, clicks, reach, spent, budget, cpm_rate, boosted_post_id, paid_until, created_at
           FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC LIMIT 10`,
          [req.userId]
        ).catch(() => [[]])

        // Post boost aggregate stats
        const [[boostAgg]] = await pool.query(
          `SELECT
            SUM(CASE WHEN status = 'active' AND (paid_until IS NULL OR paid_until > NOW()) THEN 1 ELSE 0 END) AS active_count,
            COALESCE(SUM(impressions), 0) AS total_impressions
           FROM ads WHERE advertiser_id = ? AND boosted_post_id IS NOT NULL`,
          [req.userId]
        ).catch(() => [[{ active_count: 0, total_impressions: 0 }]])

        // Post boost per-item list
        const [boostStats] = await pool.query(
          `SELECT a.id, a.boosted_post_id, a.impressions, a.clicks, a.reach, a.spent, a.status, a.paid_until,
                  SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 50) AS post_text
           FROM ads a LEFT JOIN posts p ON p.id = a.boosted_post_id
           WHERE a.advertiser_id = ? AND a.boosted_post_id IS NOT NULL
           ORDER BY a.created_at DESC LIMIT 5`,
          [req.userId]
        ).catch(() => [[]])

        businessStats = {
          followerCount: Number(totalFollowers?.cnt || userMode.follower_count || 0),
          communityScore: Number(userMode.community_score || 0),
          followerGrowth,
          followerStats: {
            total_followers: Number(totalFollowers?.cnt || 0),
            new_followers_7d: Number(follower7d?.cnt || 0),
            new_followers_30d: Number(follower30d?.cnt || 0),
          },
          adPerformance: (Array.isArray(adPerf) ? adPerf : []).map(a => ({
            id: a.id,
            title: a.title,
            status: a.status,
            impressions: Number(a.impressions || 0),
            clicks: Number(a.clicks || 0),
            reach: Number(a.reach || 0),
            spent: parseFloat(a.spent || 0),
            budget: a.budget ? parseFloat(a.budget) : null,
            ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0,
            paid_until: a.paid_until ? new Date(a.paid_until).toISOString() : null,
            is_active: a.status === 'active' && (!a.paid_until || new Date(a.paid_until) > new Date()),
            isBoostedPost: !!a.boosted_post_id,
          })),
          postBoostStats: {
            boosted_posts_active: Number(boostAgg?.active_count || 0),
            total_boosted_impressions: Number(boostAgg?.total_impressions || 0),
            items: (Array.isArray(boostStats) ? boostStats : []).map(b => ({
              adId: b.id,
              postId: b.boosted_post_id,
              postText: b.post_text || `Post #${b.boosted_post_id}`,
              impressions: Number(b.impressions || 0),
              clicks: Number(b.clicks || 0),
              reach: Number(b.reach || 0),
              spent: parseFloat(b.spent || 0),
              status: b.status,
              paid_until: b.paid_until ? new Date(b.paid_until).toISOString() : null,
            })),
          },
        }
      }
    } catch { /* business stats are non-critical */ }

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
      heatmap,
      hashtagPerformance,
      audienceLocations,
      growthSource: { viaInvite, organic, total: totalC },
      industryDist,
      seniorityDist,
      postsDrivingVisits,
      platformAvgConnGrowth,
      businessStats,
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

// GET /api/admin/settings — get platform config (admin only)
app.get('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT key_name, key_value FROM admin_settings')
    const settings = {}
    for (const row of rows) settings[row.key_name] = row.key_value
    // Overlay env vars so the admin form pre-populates them
    if (process.env.MOLLIE_API_KEY && !settings.mollie_api_key) {
      settings.mollie_api_key = process.env.MOLLIE_API_KEY
    }
    // Mask secrets — show first 4 chars for API keys, fully mask other secrets
    const API_KEY_FIELDS = ['mollie_api_key']
    const masked = {}
    for (const [k, v] of Object.entries(settings)) {
      if (!v) { masked[k] = ''; continue }
      if (API_KEY_FIELDS.includes(k)) {
        masked[k] = v.slice(0, 4) + '•'.repeat(Math.max(0, v.length - 4))
      } else if (k.includes('secret') || k.includes('Secret')) {
        masked[k] = '••••••••' + v.slice(-4)
      } else {
        masked[k] = v
      }
    }
    res.json({ settings: masked })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' })
  }
})

// ── Interest categories ───────────────────────────────────────────────────────
// GET /api/interest-categories — public list of active categories
app.get('/api/interest-categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, da, en, icon FROM interest_categories WHERE active = 1 ORDER BY sort_order, da'
    )
    res.json({ categories: rows })
  } catch {
    res.json({ categories: [] })
  }
})

// GET /api/admin/interest-categories — all categories including inactive (admin)
app.get('/api/admin/interest-categories', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM interest_categories ORDER BY sort_order, da'
    )
    res.json({ categories: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/interest-categories — create
app.post('/api/admin/interest-categories', authenticate, requireAdmin, async (req, res) => {
  const { id, da, en, icon, sort_order = 0, active = 1 } = req.body
  if (!id || !da || !en) return res.status(400).json({ error: 'id, da, en required' })
  const safeId = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)
  try {
    await pool.query(
      'INSERT INTO interest_categories (id, da, en, icon, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)',
      [safeId, da.slice(0, 128), en.slice(0, 128), (icon || '⭐').slice(0, 8), sort_order, active ? 1 : 0]
    )
    res.json({ ok: true, id: safeId })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/admin/interest-categories/:id — update
app.put('/api/admin/interest-categories/:id', authenticate, requireAdmin, async (req, res) => {
  const { da, en, icon, sort_order, active } = req.body
  try {
    await pool.query(
      'UPDATE interest_categories SET da=?, en=?, icon=?, sort_order=?, active=? WHERE id=?',
      [da, en, icon || '⭐', sort_order ?? 0, active ? 1 : 0, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/interest-categories/:id — delete
app.delete('/api/admin/interest-categories/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM interest_categories WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/interest-categories/reorder — bulk update sort_order
app.patch('/api/admin/interest-categories/reorder', authenticate, requireAdmin, async (req, res) => {
  const { order } = req.body // array of ids in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' })
  try {
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE interest_categories SET sort_order=? WHERE id=?', [i * 10, order[i]])
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/notify-all — broadcast a system notification to all (or targeted) users
app.post('/api/admin/notify-all', authenticate, requireAdmin, async (req, res) => {
  const { message_da, message_en, target = 'all' } = req.body
  if (!message_da?.trim() || !message_en?.trim()) return res.status(400).json({ error: 'message_da and message_en required' })
  try {
    let userRows
    if (target === 'business') {
      ;[userRows] = await pool.query("SELECT id FROM users WHERE account_mode = 'business' AND deleted_at IS NULL")
    } else {
      ;[userRows] = await pool.query('SELECT id FROM users WHERE deleted_at IS NULL')
    }
    for (const u of userRows) {
      await createNotification(u.id, 'system', message_da.trim(), message_en.trim())
    }
    res.json({ ok: true, sent: userRows.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/env-status — check which env vars are set (admin only, no values exposed)
app.get('/api/admin/env-status', authenticate, requireAdmin, async (req, res) => {
  const ENV_VARS = [
    'MOLLIE_API_KEY',
    'FB_APP_ID', 'FB_APP_SECRET', 'FB_TOKEN_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
    'MAIL_HOST', 'MAIL_USER',
    '46ELKS_USERNAME',
    'MISTRAL_API_KEY',
    'UPLOADS_DIR',
  ]
  const status = {}
  for (const v of ENV_VARS) status[v] = !!process.env[v]
  res.json({ status })
})

// POST /api/admin/settings — save platform config (admin only)
app.post('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['pwd_min_length', 'pwd_require_uppercase', 'pwd_require_lowercase', 'pwd_require_numbers', 'pwd_require_symbols', 'media_max_files', 'marketplace_max_photos', 'registration_open', 'mollie_api_key']
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue
      // pwd_, media_, registration_ keys are always saved (value can be '0'/'')
      const alwaysSave = key.startsWith('pwd_') || key.startsWith('media_') || key.startsWith('registration_') || key === 'mollie_api_key'
      if (!alwaysSave) {
        if (!value || value === '••••••••' + (value || '').slice(-4)) continue // skip masked/empty
      }
      await pool.query('INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', [key, value])
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' })
  }
})

// POST /api/admin/settings/reveal-key — verify admin password then return full key value
app.post('/api/admin/settings/reveal-key', authenticate, requireAdmin, async (req, res) => {
  const REVEALABLE = ['mollie_api_key']
  const { key_name, password } = req.body
  if (!key_name || !password) return res.status(400).json({ error: 'key_name and password required' })
  if (!REVEALABLE.includes(key_name)) return res.status(403).json({ error: 'Not revealable' })
  try {
    // Verify admin password
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.userId])
    const passwordMatch = await bcrypt.compare(password, user?.password_hash || '')
    if (!passwordMatch) return res.status(401).json({ error: 'Forkert adgangskode' })
    // Return full value: env var or DB
    let value = null
    if (key_name === 'mollie_api_key') value = process.env.MOLLIE_API_KEY || null
    if (!value) {
      const [[row]] = await pool.query('SELECT key_value FROM admin_settings WHERE key_name = ?', [key_name])
      value = row?.key_value || null
    }
    if (!value) return res.status(404).json({ error: 'Nøgle ikke sat' })
    res.json({ value })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/mfa-users — list all users with MFA status (admin only)
app.get('/api/admin/mfa-users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email,
        CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END AS has_phone,
        mfa_enabled,
        CASE WHEN mfa_code_expires > NOW() THEN 1 ELSE 0 END AS pending_code,
        created_at
       FROM users
       ORDER BY mfa_enabled DESC, name ASC`
    )
    res.json({ users: rows.map(u => ({
      id: u.id, name: u.name, email: u.email,
      hasPhone: !!u.has_phone, mfaEnabled: !!u.mfa_enabled,
      pendingCode: !!u.pending_code, createdAt: u.created_at,
    })) })
  } catch (err) {
    console.error('GET /api/admin/mfa-users error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/admin/users/:userId/force-disable-mfa — force-disable MFA for a user (admin only)
app.post('/api/admin/users/:userId/force-disable-mfa', authenticate, requireAdmin, async (req, res) => {
  const { userId } = req.params
  try {
    const [[user]] = await pool.query('SELECT id, name FROM users WHERE id = ?', [userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    await pool.query(
      'UPDATE users SET mfa_enabled = 0, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?',
      [userId]
    )
    // Audit log: admin force-disabled MFA for user
    await auditLog(req, 'admin_force_disable_mfa', 'user', parseInt(userId), {
      status: 'success',
      details: { target_user: user.name, reason: 'admin_action' }
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/users/:userId/force-disable-mfa error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/locked-users — list accounts locked due to brute-force (admin only)
app.get('/api/admin/locked-users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, failed_login_attempts, locked_until
       FROM users
       WHERE locked_until IS NOT NULL AND locked_until > NOW()
       ORDER BY locked_until DESC`
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/admin/locked-users error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/admin/users/:userId/unlock — reset login lock for a user (admin only)
app.post('/api/admin/users/:userId/unlock', authenticate, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })
  try {
    const [[user]] = await pool.query('SELECT id, name FROM users WHERE id = ?', [userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [userId])
    await auditLog(req, 'admin_unlock_account', 'user', userId, {
      status: 'success',
      details: { target_user: user.name, reason: 'admin_manual_unlock' }
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/users/:userId/unlock error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Platform ads (admin-managed) ─────────────────────────────────────────────
app.get('/api/admin/platform-ads', authenticate, requireAdmin, async (req, res) => {
  try {
    const [ads] = await pool.query(
      'SELECT * FROM platform_ads ORDER BY created_at DESC'
    ).catch(() => [[]])
    res.json({ ads })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/admin/platform-ads', authenticate, requireAdmin, async (req, res) => {
  const { title, image_url, link_url, zone, mode, active, start_date, end_date } = req.body
  if (!title || !link_url) return res.status(400).json({ error: 'title and link_url required' })
  try {
    const [result] = await pool.query(
      'INSERT INTO platform_ads (title, image_url, link_url, zone, mode, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, image_url || null, link_url, zone || 'display', mode || 'all', active ? 'active' : 'inactive', start_date || null, end_date || null]
    )
    res.json({ ok: true, id: result.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/admin/platform-ads/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { title, image_url, link_url, zone, mode, active, start_date, end_date } = req.body
  if (!title || !link_url) return res.status(400).json({ error: 'title and link_url required' })
  try {
    await pool.query(
      'UPDATE platform_ads SET title=?, image_url=?, link_url=?, zone=?, mode=?, status=?, start_date=?, end_date=? WHERE id=?',
      [title, image_url || null, link_url, zone || 'display', mode || 'all', active ? 'active' : 'inactive', start_date || null, end_date || null, id]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/admin/platform-ads/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    await pool.query('DELETE FROM platform_ads WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
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
    const [[{ friendships }]] = await pool.query('SELECT FLOOR(COUNT(*)/2) as friendships FROM friendships')
    const [[{ messages }]] = await pool.query('SELECT COUNT(*) as messages FROM messages')
    const [[{ new_users_7d }]] = await pool.query("SELECT COUNT(*) as new_users_7d FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)").catch(() => [[{ new_users_7d: 0 }]])
    const [[{ rsvps }]] = await pool.query("SELECT COUNT(*) as rsvps FROM event_rsvps WHERE status = 'going'").catch(() => [[{ rsvps: 0 }]])
    const [[{ users_privat }]] = await pool.query("SELECT COUNT(*) as users_privat FROM users WHERE mode != 'business' OR mode IS NULL").catch(() => [[{ users_privat: 0 }]])
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

// GET /api/admin/stats/list — return a short list of records for a given stat type
app.get('/api/admin/stats/list', authenticate, requireAdmin, async (req, res) => {
  const { type } = req.query
  try {
    let rows = []
    if (type === 'users' || type === 'new_users_7d') {
      const where = type === 'new_users_7d' ? "WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)" : ''
      ;[rows] = await pool.query(`SELECT id, name, email, mode, created_at FROM users u ${where} ORDER BY created_at DESC LIMIT 20`)
    } else if (type === 'active_users') {
      ;[rows] = await pool.query("SELECT u.id, u.name, u.email, u.mode, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > NOW() ORDER BY s.expires_at DESC LIMIT 20")
    } else if (type === 'posts') {
      ;[rows] = await pool.query("SELECT p.id, u.name AS author, COALESCE(p.text_da, p.text_en, '') AS text, p.created_at FROM posts p JOIN users u ON u.id = p.author_id ORDER BY p.created_at DESC LIMIT 20")
    } else if (type === 'events') {
      ;[rows] = await pool.query("SELECT e.id, e.title, e.date, u.name AS organizer FROM events e JOIN users u ON u.id = e.organizer_id ORDER BY e.date DESC LIMIT 20").catch(() => [rows])
    } else if (type === 'listings') {
      ;[rows] = await pool.query("SELECT l.id, l.title, l.price, l.category, u.name AS seller, l.created_at FROM marketplace_listings l JOIN users u ON u.id = l.user_id WHERE l.sold = 0 ORDER BY l.created_at DESC LIMIT 20").catch(() => [rows])
    } else if (type === 'friendships') {
      ;[rows] = await pool.query("SELECT f.id, a.name AS user1, b.name AS user2, f.created_at FROM friendships f JOIN users a ON a.id = f.user_id JOIN users b ON b.id = f.friend_id WHERE f.user_id < f.friend_id ORDER BY f.created_at DESC LIMIT 20").catch(() => [rows])
    } else if (type === 'messages') {
      ;[rows] = await pool.query("SELECT m.id, u.name AS sender, SUBSTRING(m.text_da, 1, 60) AS preview, m.created_at FROM messages m JOIN users u ON u.id = m.sender_id ORDER BY m.created_at DESC LIMIT 20").catch(() => [rows])
    }
    res.json({ type, rows })
  } catch (err) {
    console.error('GET /api/admin/stats/list error:', err.message)
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
      createdAt: e.created_at,
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
    const { title, description, date, location, eventType, ticketUrl, cap, coverUrl } = req.body
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' })
    const [result] = await pool.query(
      `INSERT INTO events (organizer_id, title, description, date, location, event_type, ticket_url, cap, cover_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, title, description || null, date, location || null, eventType || null, ticketUrl || null, cap || null, coverUrl || null]
    )
    const [[event]] = await pool.query(
      `SELECT e.*, u.name AS organizer_name FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = ?`,
      [result.insertId]
    )
    res.json({
      id: event.id, title: event.title, description: event.description,
      date: event.date, location: event.location, organizer: event.organizer_name,
      organizerId: event.organizer_id, eventType: event.event_type,
      ticketUrl: event.ticket_url, cap: event.cap, coverUrl: event.cover_url,
      going: [], maybe: [], myRsvp: null,
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
      if (status === 'going' || status === 'maybe') {
        const [[ev]] = await pool.query('SELECT organizer_id, title FROM events WHERE id = ?', [req.params.id]).catch(() => [[null]])
        if (ev && ev.organizer_id !== req.userId) {
          const [[rsvper]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
          if (rsvper) {
            const statusDa = status === 'going' ? 'deltager' : 'måske deltager'
            const statusEn = status === 'going' ? 'is going' : 'might attend'
            createNotification(ev.organizer_id, 'event_rsvp',
              `${rsvper.name} ${statusDa} til "${ev.title}"`,
              `${rsvper.name} ${statusEn} "${ev.title}"`,
              req.userId, rsvper.name
            )
          }
        }
      }
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


// ── Calendar: Private Reminders ─────────────────────────────────────────────

// Ensure table exists (idempotent)
;(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      date DATE NOT NULL,
      title VARCHAR(255) NOT NULL,
      note TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_date (user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (e) { console.error('calendar_reminders init:', e.message) }
})()

// GET /api/calendar/reminders — list all reminders for the authenticated user
app.get('/api/calendar/reminders', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, date, title, note FROM calendar_reminders WHERE user_id = ? ORDER BY date',
      [req.userId]
    )
    // Format DATE as YYYY-MM-DD without timezone conversion (DATE columns are always local)
    const reminders = rows.map(r => {
      let dateStr = String(r.date).slice(0, 10)
      // If it's a Date object, use getUTC* to avoid timezone shifts
      if (r.date instanceof Date) {
        dateStr = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}-${String(r.date.getUTCDate()).padStart(2, '0')}`
      }
      return { ...r, date: dateStr }
    })
    res.json({ reminders })
  } catch (err) {
    console.error('GET /api/calendar/reminders error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/calendar/reminders — create a private reminder
app.post('/api/calendar/reminders', authenticate, async (req, res) => {
  const { date, title, note } = req.body
  if (!date || !title || !title.trim()) return res.status(400).json({ error: 'date and title are required' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format' })
  try {
    const [result] = await pool.query(
      'INSERT INTO calendar_reminders (user_id, date, title, note) VALUES (?, ?, ?, ?)',
      [req.userId, date, title.trim().slice(0, 255), (note || '').trim().slice(0, 1000) || null]
    )
    res.json({ id: result.insertId, date, title: title.trim(), note: (note || '').trim() || null })
  } catch (err) {
    console.error('POST /api/calendar/reminders error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/calendar/reminders/:id — delete a reminder (owner only)
app.delete('/api/calendar/reminders/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid id' })
  try {
    const [result] = await pool.query(
      'DELETE FROM calendar_reminders WHERE id = ? AND user_id = ?',
      [id, req.userId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/calendar/reminders/:id error:', err.message)
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
    await addCol('reel_likes', 'reaction', "VARCHAR(10) DEFAULT '❤️'")
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
      `SELECT r.id, r.video_url, r.caption, r.views_count, r.created_at, r.tagged_users,
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
    res.json({ reels: rows.map(r => {
      let tagged = null
      try { tagged = r.tagged_users ? (typeof r.tagged_users === 'string' ? JSON.parse(r.tagged_users) : r.tagged_users) : null } catch {}
      return { ...r, liked_by_me: !!r.liked_by_me, my_reaction: r.my_reaction || null, tagged_users: tagged }
    }) })
  } catch (err) {
    console.error('GET /api/reels error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/reels — upload a reel
app.post('/api/reels', authenticate, fileUploadLimit, reelUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' })
    const caption = (req.body.caption || '').trim().slice(0, 2000) || null
    const videoUrl = `/uploads/${req.file.filename}`
    const rawTagged = req.body.tagged_users
    const taggedUsers = rawTagged ? (() => { try { return JSON.parse(rawTagged) } catch { return null } })() : null
    const taggedJson = Array.isArray(taggedUsers) && taggedUsers.length > 0 ? JSON.stringify(taggedUsers) : null
    const [result] = await pool.query(
      'INSERT INTO reels (user_id, video_url, caption, tagged_users) VALUES (?, ?, ?, ?)',
      [req.userId, videoUrl, caption, taggedJson]
    ).catch(() =>
      pool.query('INSERT INTO reels (user_id, video_url, caption) VALUES (?, ?, ?)', [req.userId, videoUrl, caption])
    )
    const [[reel]] = await pool.query(
      `SELECT r.id, r.video_url, r.caption, r.views_count, r.created_at, r.tagged_users,
              u.id AS user_id, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
              0 AS likes_count, 0 AS liked_by_me, 0 AS comments_count
       FROM reels r JOIN users u ON r.user_id = u.id WHERE r.id = ?`,
      [result.insertId]
    )
    let tagged = null
    try { tagged = reel.tagged_users ? (typeof reel.tagged_users === 'string' ? JSON.parse(reel.tagged_users) : reel.tagged_users) : null } catch {}
    res.status(201).json({ reel: { ...reel, tagged_users: tagged } })
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
              u.mode,
              u.business_category, u.business_website, u.business_hours,
              u.business_description_da, u.business_description_en,
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

    const publicProfile = {
      id: user.id,
      name: user.name,
      handle: user.handle,
      bio: { da: user.bio_da, en: user.bio_en },
      location: user.location,
      avatarUrl: user.avatar_url,
      joinDate: user.join_date,
      mode: user.mode || 'privat',
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
    }
    if (user.mode === 'business') {
      publicProfile.businessCategory = user.business_category || null
      publicProfile.businessWebsite = user.business_website || null
      publicProfile.businessHours = user.business_hours || null
      publicProfile.businessDescription = { da: user.business_description_da || '', en: user.business_description_en || '' }
    }
    res.json(publicProfile)
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
      autoSignalPost(req.userId, targetId, 'share')
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
  recordLoginDay(req.userId).catch(() => {})
  res.json({ ok: true })
})

// ── Profile update ────────────────────────────────────────────────────────────
app.patch('/api/profile', authenticate, async (req, res) => {
  const { name, bio_da, bio_en, location, industry, seniority, job_title, company } = req.body
  try {
    const fields = [], vals = []
    if (name !== undefined)      { fields.push('name = ?');      vals.push(name.trim()) }
    if (bio_da !== undefined)    { fields.push('bio_da = ?');    vals.push(bio_da) }
    if (bio_en !== undefined)    { fields.push('bio_en = ?');    vals.push(bio_en) }
    if (location !== undefined)  { fields.push('location = ?');  vals.push(location) }
    if (industry !== undefined)  { fields.push('industry = ?');  vals.push(industry ? String(industry).trim().slice(0, 100) : null) }
    if (seniority !== undefined) { fields.push('seniority = ?'); vals.push(seniority || null) }
    if (job_title !== undefined) { fields.push('job_title = ?'); vals.push(job_title ? String(job_title).trim().slice(0, 100) : null) }
    if (company !== undefined)   { fields.push('company = ?');   vals.push(company ? String(company).trim().slice(0, 100) : null) }
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
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('media_max_files','marketplace_max_photos')"
    )
    const cfg = {}
    for (const r of rows) cfg[r.key_name] = r.key_value
    if (cfg.media_max_files) cfg.mediaMaxFiles = parseInt(cfg.media_max_files, 10) || 4
    if (cfg.marketplace_max_photos) cfg.marketplaceMaxPhotos = parseInt(cfg.marketplace_max_photos, 10) || 4
    res.json({ config: cfg, facebookEnabled: !!process.env.FB_APP_ID })
  } catch { res.json({ config: {}, facebookEnabled: false }) }
})

// ── Changelog ─────────────────────────────────────────────────────────────────
const CHANGELOG_ENTRIES = [
  { date: '2026-03', icon: '📄', da: 'CV-profil og jobansøgning — tilføj erhvervserfaring, uddannelse og sprog til din profil og vedhæft CV og ansøgningsbrev direkte i jobopslag. AI-assistance via Mistral hjælper dig med at skrive dem.', en: 'CV profile and job applications — add work experience, education and languages to your profile and attach a CV and cover letter directly in job listings. AI assistance via Mistral helps you write them.' },
  { date: '2026-03', icon: '🌍', da: 'Flersproget infrastruktur — sitet er klar til nye sprog', en: 'Multi-language infrastructure — site is ready for new languages' },
  { date: '2026-03', icon: '💳', da: 'Mollie betalingsgateway — betal for reklamefrit abonnement via MobilePay, Visa, Mastercard m.fl.', en: 'Mollie payment gateway — pay for ad-free subscription via MobilePay, Visa, Mastercard etc.' },
  { date: '2026-03', icon: '🕰️', da: 'Memories — "På denne dag": se dine opslag fra tidligere år', en: 'Memories — "On this day": see your posts from previous years' },
  { date: '2026-02', icon: '🏢', da: 'Business-tilstand — skift til businesskonto og få adgang til ekstra funktioner', en: 'Business mode — switch to a business account and unlock extra features' },
  { date: '2026-02', icon: '💼', da: 'Stillingsopslag — businessbrugere kan oprette og administrere jobs direkte på platformen', en: 'Job listings — business users can create and manage job posts directly on the platform' },
  { date: '2026-02', icon: '📅', da: 'Planlagte opslag — opret opslag og planlæg dem til fremtidig publicering', en: 'Scheduled posts — create posts and schedule them for future publishing' },
  { date: '2026-02', icon: '🤝', da: 'CRM-noter — tilføj private noter til dine forbindelser', en: 'CRM notes — add private notes to your connections' },
  { date: '2026-01', icon: '🖼️', da: 'Medier i beskeder — send billeder og filer direkte i samtaler', en: 'Media in messages — send images and files directly in conversations' },
  { date: '2026-01', icon: '📊', da: 'Analytics-dashboard — businessbrugere får indsigt i profilvisninger og engagement', en: 'Analytics dashboard — business users get insights into profile views and engagement' },
  { date: '2025-12', icon: '🛡️', da: 'Moderationssystem — rapportér indhold, keywordfiltre og moderatorroller', en: 'Moderation system — report content, keyword filters and moderator roles' },
  { date: '2025-12', icon: '🔔', da: 'In-app notifikationer og email-notifikationer ved vigtige hændelser', en: 'In-app and email notifications for important events' },
  { date: '2025-11', icon: '🏷️', da: 'Feed-kategorier — kategorisér opslag og filtrer feedet efter kategori', en: 'Feed categories — categorise posts and filter the feed by category' },
]
app.get('/api/changelog', authenticate, async (req, res) => {
  const lang = req.query.lang || 'da'
  const entries = CHANGELOG_ENTRIES.map(e => ({
    date: e.date,
    icon: e.icon,
    text: lang === 'en' ? e.en : e.da,
  }))
  res.json({ entries })
})

// ── Notifications ─────────────────────────────────────────────────────────────
async function initNotifications() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      type VARCHAR(50) NOT NULL,
      message_da TEXT NOT NULL,
      message_en TEXT NOT NULL,
      link VARCHAR(500) DEFAULT NULL,
      read_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
      INDEX idx_user_created (user_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INT(11) NOT NULL,
      type VARCHAR(50) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // Auto-migrate: inspect actual columns and fix any schema mismatches
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' ORDER BY ORDINAL_POSITION"
    )
    const colMap = Object.fromEntries(cols.map(c => [c.COLUMN_NAME, c]))

    // message_da / message_en (old schema may have used 'message')
    if (!colMap['message_da']) {
      if (colMap['message']) {
        await pool.query('ALTER TABLE notifications CHANGE message message_da TEXT NOT NULL')
        console.log('✓ notifications: renamed message → message_da')
      } else {
        await pool.query('ALTER TABLE notifications ADD COLUMN message_da TEXT NOT NULL AFTER type')
        console.log('✓ notifications: added message_da')
      }
    }
    if (!colMap['message_en']) {
      await pool.query('ALTER TABLE notifications ADD COLUMN message_en TEXT NOT NULL AFTER message_da')
      console.log('✓ notifications: added message_en')
    }
    // actor_id / actor_name / post_id — add if missing, fix nullability if needed
    if (!colMap['actor_id']) {
      await pool.query('ALTER TABLE notifications ADD COLUMN actor_id INT(11) DEFAULT NULL')
      console.log('✓ notifications: added actor_id')
    } else if (colMap['actor_id'].IS_NULLABLE === 'NO') {
      await pool.query('ALTER TABLE notifications MODIFY actor_id INT(11) DEFAULT NULL')
      console.log('✓ notifications: actor_id made nullable')
    }
    if (!colMap['actor_name']) {
      await pool.query('ALTER TABLE notifications ADD COLUMN actor_name VARCHAR(255) DEFAULT NULL')
      console.log('✓ notifications: added actor_name')
    } else if (colMap['actor_name'].IS_NULLABLE === 'NO') {
      await pool.query('ALTER TABLE notifications MODIFY actor_name VARCHAR(255) DEFAULT NULL')
      console.log('✓ notifications: actor_name made nullable')
    }
    if (!colMap['post_id']) {
      await pool.query('ALTER TABLE notifications ADD COLUMN post_id INT(11) DEFAULT NULL')
      console.log('✓ notifications: added post_id')
    }
    // is_read — add if missing (old schema used read_at instead)
    if (!colMap['is_read']) {
      await pool.query('ALTER TABLE notifications ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0')
      if (colMap['read_at']) {
        // Migrate existing read state from read_at → is_read
        await pool.query('UPDATE notifications SET is_read = 1 WHERE read_at IS NOT NULL')
        console.log('✓ notifications: added is_read, migrated from read_at')
      } else {
        console.log('✓ notifications: added is_read')
      }
    }

    const [[nRow]] = await pool.query('SELECT COUNT(*) as c FROM notifications')
    const [[pRow]] = await pool.query('SELECT COUNT(*) as c FROM notification_preferences')
    console.log(`✓ notifications table OK (${nRow.c} rows), notification_preferences OK (${pRow.c} rows)`)
  } catch (err) {
    console.error('✗ initNotifications FAILED:', err.message)
  }
}

// actorId / actorName: who triggered the notification (nullable for system notifications)
// postId: related post, if any
async function createNotification(userId, type, messageDa, messageEn, actorId = null, actorName = null, postId = null) {
  try {
    const [prefs] = await pool.query(
      'SELECT type FROM notification_preferences WHERE user_id = ? AND type IN (?, "all") AND enabled = 0',
      [userId, type]
    ).catch(() => [[]])
    if (prefs.length > 0) return

    await pool.query(
      'INSERT INTO notifications (user_id, type, message_da, message_en, actor_id, actor_name, post_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, type, messageDa, messageEn, actorId || null, actorName || null, postId || null]
    )
    sseBroadcast(userId, { type: 'notification' })
  } catch (err) {
    console.error('[createNotification] type=%s user=%d error: %s', type, userId, err.message)
  }
}

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, type, message_da, message_en, actor_id, actor_name, post_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    )
    res.json({ notifications: rows })
  } catch (err) {
    console.error('[GET /api/notifications]', err.message)
    res.json({ notifications: [] })
  }
})

// POST /api/notifications/test — send a test notification to yourself (for debugging)
app.post('/api/notifications/test', authenticate, async (req, res) => {
  const steps = []
  try {
    // 1. Check table exists
    const [[tbl]] = await pool.query("SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notifications'")
    steps.push({ step: 'table_exists', ok: tbl.c > 0 })
    if (!tbl.c) {
      return res.json({ ok: false, steps, error: 'notifications table does not exist — run migrate-notifications.sql' })
    }
    // 2. Insert test notification
    const [ins] = await pool.query(
      'INSERT INTO notifications (user_id, type, message_da, message_en, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, 'test', '🔔 Test notifikation — virker!', '🔔 Test notification — works!', req.userId, 'Test']
    )
    steps.push({ step: 'insert', ok: true, insertId: ins.insertId })
    // 3. Read it back
    const [[row]] = await pool.query('SELECT id, type, message_da FROM notifications WHERE id = ?', [ins.insertId])
    steps.push({ step: 'readback', ok: !!row, row })
    // 4. Broadcast SSE
    sseBroadcast(req.userId, { type: 'notification' })
    steps.push({ step: 'sse_broadcast', ok: true, sseClients: sseClients.get(req.userId)?.size ?? 0 })
    res.json({ ok: true, steps })
  } catch (err) {
    steps.push({ step: 'error', message: err.message })
    res.json({ ok: false, steps, error: err.message })
  }
})

app.get('/api/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.userId]
    )
    res.json({ count: Number(row.count) })
  } catch {
    res.json({ count: 0 })
  }
})

app.post('/api/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.userId]).catch(() => {})
  res.json({ ok: true })
})

app.post('/api/notifications/read-all', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.userId]).catch(() => {})
  res.json({ ok: true })
})

// GET /api/me/notification-preferences — get user's notification type preferences
app.get('/api/me/notification-preferences', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT type, enabled FROM notification_preferences WHERE user_id = ?',
      [req.userId]
    )
    const prefs = {}
    for (const r of rows) prefs[r.type] = Boolean(r.enabled)
    res.json({ prefs })
  } catch {
    res.json({ prefs: {} })
  }
})

// PUT /api/me/notification-preferences — save user's notification type preferences
app.put('/api/me/notification-preferences', authenticate, async (req, res) => {
  const { prefs } = req.body
  if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'Invalid prefs' })
  try {
    for (const [type, enabled] of Object.entries(prefs)) {
      const val = enabled ? 1 : 0
      await pool.query(
        'INSERT INTO notification_preferences (user_id, type, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = ?',
        [req.userId, type, val, val]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/me/notification-preferences]', err.message)
    res.status(500).json({ error: 'Server error' })
  }
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
  try {
    const [rows] = await pool.query(`
      SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color, c.logo_url AS company_logo,
             (SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.job_id = j.id) AS share_count
      FROM jobs j
      JOIN companies c ON c.id = j.company_id
      JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = ? AND cm.role IN ('owner','admin','editor')
      ORDER BY j.created_at DESC
    `, [req.userId])
    res.json({ jobs: rows || [] })
  } catch (err) {
    console.error('GET /api/jobs/mine error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CV Profile ────────────────────────────────────────────────────────────────
// GET /api/cv/profile — get full CV data for current user
app.get('/api/cv/profile', authenticate, async (req, res) => {
  try {
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, sort_order ASC, start_date DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY sort_order ASC, start_year DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const me = await pool.query(
      'SELECT job_title, company, industry, seniority, skills, bio_da, bio_en, name, location FROM users WHERE id = ?',
      [req.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    // cv_public fetched separately — column may not exist on all installs yet
    const cvPublic = await pool.query('SELECT cv_public FROM users WHERE id = ?', [req.userId])
      .then(([[row]]) => row?.cv_public ?? 0).catch(() => 0)
    res.json({ experience, education: edu, languages, profile: { ...me, cv_public: cvPublic } })
  } catch (err) {
    console.error('GET /api/cv/profile error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/cv/profile/:userId — public CV view (respects cv_public flag)
app.get('/api/cv/profile/:userId', authenticate, async (req, res) => {
  try {
    const [[owner]] = await pool.query(
      'SELECT id FROM users WHERE id = ?', [req.params.userId]
    )
    if (!owner) return res.status(404).json({ error: 'Not found' })
    const cvPublic = await pool.query('SELECT cv_public FROM users WHERE id = ?', [req.params.userId])
      .then(([[row]]) => row?.cv_public ?? 0).catch(() => 0)
    if (!cvPublic && req.userId !== Number(req.params.userId)) {
      return res.status(403).json({ error: 'Profile not public' })
    }
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, sort_order ASC, start_date DESC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY sort_order ASC, start_year DESC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const profile = await pool.query(
      'SELECT job_title, company, industry, seniority, skills, bio_da, bio_en, name, location FROM users WHERE id = ?',
      [req.params.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    res.json({ experience, education: edu, languages, profile: { ...profile, cv_public: cvPublic } })
  } catch (err) {
    console.error('GET /api/cv/profile/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/cv/visibility — toggle cv_public
app.patch('/api/cv/visibility', authenticate, async (req, res) => {
  try {
    const { cv_public } = req.body
    await pool.query('UPDATE users SET cv_public = ? WHERE id = ?', [cv_public ? 1 : 0, req.userId])
    res.json({ ok: true, cv_public: !!cv_public })
  } catch (err) {
    console.error('PATCH /api/cv/visibility error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/cv/experience — add work experience entry
app.post('/api/cv/experience', authenticate, async (req, res) => {
  try {
    const { company, title, start_date, end_date, is_current, description, sort_order } = req.body
    if (!company || !title) return res.status(400).json({ error: 'Company and title required' })
    const [result] = await pool.query(
      'INSERT INTO work_experience (user_id, company, title, start_date, end_date, is_current, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, company, title, start_date || null, (is_current ? null : end_date || null), is_current ? 1 : 0, description || null, sort_order || 0]
    )
    const [[entry]] = await pool.query('SELECT * FROM work_experience WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    console.error('POST /api/cv/experience error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/cv/experience/:id — update work experience entry
app.put('/api/cv/experience/:id', authenticate, async (req, res) => {
  try {
    const { company, title, start_date, end_date, is_current, description, sort_order } = req.body
    if (!company || !title) return res.status(400).json({ error: 'Company and title required' })
    await pool.query(
      'UPDATE work_experience SET company=?, title=?, start_date=?, end_date=?, is_current=?, description=?, sort_order=? WHERE id=? AND user_id=?',
      [company, title, start_date || null, (is_current ? null : end_date || null), is_current ? 1 : 0, description || null, sort_order || 0, req.params.id, req.userId]
    )
    const [[entry]] = await pool.query('SELECT * FROM work_experience WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) {
    console.error('PUT /api/cv/experience/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/cv/experience/:id — delete work experience entry
app.delete('/api/cv/experience/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM work_experience WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/experience/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/cv/education — add education entry
app.post('/api/cv/education', authenticate, async (req, res) => {
  try {
    const { institution, degree, field, start_year, end_year, description, sort_order } = req.body
    if (!institution) return res.status(400).json({ error: 'Institution required' })
    const [result] = await pool.query(
      'INSERT INTO education (user_id, institution, degree, field, start_year, end_year, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, institution, degree || null, field || null, start_year || null, end_year || null, description || null, sort_order || 0]
    )
    const [[entry]] = await pool.query('SELECT * FROM education WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    console.error('POST /api/cv/education error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/cv/education/:id — update education entry
app.put('/api/cv/education/:id', authenticate, async (req, res) => {
  try {
    const { institution, degree, field, start_year, end_year, description, sort_order } = req.body
    if (!institution) return res.status(400).json({ error: 'Institution required' })
    await pool.query(
      'UPDATE education SET institution=?, degree=?, field=?, start_year=?, end_year=?, description=?, sort_order=? WHERE id=? AND user_id=?',
      [institution, degree || null, field || null, start_year || null, end_year || null, description || null, sort_order || 0, req.params.id, req.userId]
    )
    const [[entry]] = await pool.query('SELECT * FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) {
    console.error('PUT /api/cv/education/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/cv/education/:id — delete education entry
app.delete('/api/cv/education/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/education/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/cv/languages — get user's language list
app.get('/api/cv/languages', authenticate, async (req, res) => {
  try {
    const [languages] = await pool.query('SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC', [req.userId])
    res.json({ languages })
  } catch (err) {
    console.error('GET /api/cv/languages error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/cv/languages — add a language
app.post('/api/cv/languages', authenticate, async (req, res) => {
  try {
    const { language, proficiency } = req.body
    if (!language) return res.status(400).json({ error: 'Language required' })
    const valid = ['basic', 'conversational', 'professional', 'fluent', 'native']
    const prof = valid.includes(proficiency) ? proficiency : 'conversational'
    const [result] = await pool.query(
      'INSERT INTO user_languages (user_id, language, proficiency) VALUES (?, ?, ?)',
      [req.userId, language.trim(), prof]
    )
    const [[entry]] = await pool.query('SELECT * FROM user_languages WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Language already added' })
    console.error('POST /api/cv/languages error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/cv/languages/:id — update language proficiency
app.put('/api/cv/languages/:id', authenticate, async (req, res) => {
  try {
    const { proficiency } = req.body
    const valid = ['basic', 'conversational', 'professional', 'fluent', 'native']
    if (!valid.includes(proficiency)) return res.status(400).json({ error: 'Invalid proficiency' })
    await pool.query('UPDATE user_languages SET proficiency = ? WHERE id = ? AND user_id = ?', [proficiency, req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/cv/languages/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/cv/languages/:id — delete a language
app.delete('/api/cv/languages/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_languages WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/languages/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Mistral AI helper ─────────────────────────────────────────────────────────
async function callMistral(systemPrompt, userPrompt) {
  if (!MISTRAL_API_KEY) return null
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    }),
  })
  if (!resp.ok) { console.error('Mistral error:', resp.status, await resp.text()); return null }
  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

// POST /api/cv/generate — generate CV text + cover letter (AI-powered if MISTRAL_API_KEY set, else template)
app.post('/api/cv/generate', authenticate, async (req, res) => {
  try {
    const { job_id, type } = req.body // type: 'cv' | 'letter' | 'both'
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, start_date DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY start_year DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT language, proficiency FROM user_languages WHERE user_id = ? ORDER BY proficiency DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const me = await pool.query(
      'SELECT name, job_title, company, industry, seniority, skills, bio_da, bio_en, location FROM users WHERE id = ?',
      [req.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    let job = null
    if (job_id) {
      const [[j]] = await pool.query('SELECT title, description, requirements, company_id FROM jobs WHERE id = ?', [job_id]).catch(() => [[null]])
      if (j) {
        const [[c]] = await pool.query('SELECT name FROM companies WHERE id = ?', [j.company_id]).catch(() => [[null]])
        job = { ...j, company_name: c?.name || '' }
      }
    }

    const skillsList = me.skills ? me.skills.split(',').map(s => s.trim()).filter(Boolean) : []
    const langList = languages.map(l => `${l.language} (${l.proficiency})`).join(', ')
    const hasProfile = !!(experience.length || edu.length || skillsList.length)

    // ── Build structured profile summary (used by both AI and template paths) ──
    const profileSummary = [
      `Name: ${me.name || ''}`,
      me.location ? `Location: ${me.location}` : '',
      me.job_title ? `Current title: ${[me.seniority, me.job_title].filter(Boolean).join(' ')}` : '',
      me.company ? `Current company: ${me.company}` : '',
      me.industry ? `Industry: ${me.industry}` : '',
      (me.bio_da || me.bio_en) ? `Bio: ${me.bio_da || me.bio_en}` : '',
      skillsList.length ? `Skills: ${skillsList.join(', ')}` : '',
      langList ? `Languages: ${langList}` : '',
      experience.length ? '\nWork experience:\n' + experience.map(e => {
        const from = e.start_date ? new Date(e.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : ''
        const to = e.is_current ? 'present' : (e.end_date ? new Date(e.end_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '')
        return `  - ${e.title} at ${e.company}${from || to ? ` (${[from, to].filter(Boolean).join(' – ')})` : ''}${e.description ? ': ' + e.description : ''}`
      }).join('\n') : '',
      edu.length ? '\nEducation:\n' + edu.map(e =>
        `  - ${[e.degree, e.field].filter(Boolean).join(', ')}${e.degree || e.field ? ' at ' : ''}${e.institution}${e.start_year || e.end_year ? ` (${[e.start_year, e.end_year].filter(Boolean).join('–')})` : ''}`
      ).join('\n') : '',
    ].filter(Boolean).join('\n')

    const jobContext = job ? [
      `Job title: ${typeof job.title === 'string' ? job.title : job.title?.da || ''}`,
      `Company: ${job.company_name}`,
      job.description ? `Description: ${job.description}` : '',
      job.requirements ? `Requirements: ${job.requirements}` : '',
    ].filter(Boolean).join('\n') : ''

    let cvText = ''
    let letterText = ''

    // ── CV generation ─────────────────────────────────────────────────────────
    if (!type || type === 'cv' || type === 'both') {
      if (MISTRAL_API_KEY && hasProfile) {
        const system = `You are a professional CV writer. Write a clean, concise, professional CV in the same language as the user's profile (use Danish if bio/name suggests Danish, otherwise English). Format in plain text with clear sections. Be specific and impactful, not generic. Output only the CV text, nothing else.`
        const prompt = `Write a professional CV for this person:\n\n${profileSummary}${jobContext ? `\n\nTargeted at this job:\n${jobContext}` : ''}`
        const aiResult = await callMistral(system, prompt)
        cvText = aiResult || buildTemplateCV(me, experience, edu, skillsList, langList)
      } else {
        cvText = buildTemplateCV(me, experience, edu, skillsList, langList)
      }
    }

    // ── Cover letter generation ───────────────────────────────────────────────
    if (type === 'letter' || type === 'both') {
      if (MISTRAL_API_KEY && hasProfile) {
        const jobTitle = job ? (typeof job.title === 'string' ? job.title : job.title?.da || '') : ''
        const companyName = job?.company_name || ''
        const system = `You are an expert cover letter writer. Write a compelling, personalized cover letter in Danish (always use Danish unless the job posting is clearly in English). It should be warm, confident, and specific — not generic. 3–4 paragraphs. Output only the letter text, nothing else.`
        const prompt = [
          `Write a cover letter for this applicant:`,
          profileSummary,
          jobContext ? `\nThey are applying for:\n${jobContext}` : '',
          `\nToday's date: ${new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          `Address it to: ${companyName || 'the hiring team'}`,
          jobTitle ? `Position applied for: ${jobTitle}` : '',
        ].filter(Boolean).join('\n')
        const aiResult = await callMistral(system, prompt)
        letterText = aiResult || buildTemplateLetter(me, experience, skillsList, langList, job)
      } else {
        letterText = buildTemplateLetter(me, experience, skillsList, langList, job)
      }
    }

    res.json({ cv: cvText, letter: letterText, hasProfile, aiPowered: !!(MISTRAL_API_KEY && hasProfile) })
  } catch (err) {
    console.error('POST /api/cv/generate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

function buildTemplateCV(me, experience, edu, skillsList, langList) {
  let t = `# ${me.name || ''}\n`
  if (me.location) t += `📍 ${me.location}\n`
  if (me.job_title || me.company) t += `💼 ${[me.job_title, me.company].filter(Boolean).join(' · ')}\n`
  t += '\n'
  if (me.bio_da || me.bio_en) t += `## Om mig\n${me.bio_da || me.bio_en}\n\n`
  if (experience.length) {
    t += `## Erhvervserfaring\n`
    for (const e of experience) {
      const from = e.start_date ? new Date(e.start_date).toLocaleDateString('da-DK', { year: 'numeric', month: 'short' }) : ''
      const to = e.is_current ? 'nu' : (e.end_date ? new Date(e.end_date).toLocaleDateString('da-DK', { year: 'numeric', month: 'short' }) : '')
      t += `\n### ${e.title} — ${e.company}\n`
      if (from || to) t += `_${[from, to].filter(Boolean).join(' – ')}_\n`
      if (e.description) t += `${e.description}\n`
    }
    t += '\n'
  }
  if (edu.length) {
    t += `## Uddannelse\n`
    for (const e of edu) {
      t += `\n### ${[e.degree, e.field].filter(Boolean).join(', ') || e.institution}\n`
      if (e.degree || e.field) t += `${e.institution}\n`
      if (e.start_year || e.end_year) t += `_${[e.start_year, e.end_year].filter(Boolean).join('–')}_\n`
      if (e.description) t += `${e.description}\n`
    }
    t += '\n'
  }
  if (skillsList.length) t += `## Kompetencer\n${skillsList.join(' · ')}\n\n`
  if (langList) t += `## Sprog\n${langList}\n\n`
  return t
}

function buildTemplateLetter(me, experience, skillsList, langList, job) {
  const jobTitle = job ? (typeof job.title === 'string' ? job.title : job.title?.da || '') : '[Stilling]'
  const companyName = job?.company_name || '[Virksomhed]'
  const today = new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })
  let t = `${me.location || ''}, ${today}\n\nKære ${companyName},\n\n`
  t += `Jeg ansøger hermed om stillingen som ${jobTitle}. `
  if (me.job_title || me.seniority) {
    t += `Som ${[me.seniority, me.job_title].filter(Boolean).join(' ')}${me.company ? ` hos ${me.company}` : ''} bringer jeg relevant erfaring til rollen.\n\n`
  }
  if (experience.length) t += `I min rolle som ${experience[0].title} hos ${experience[0].company} har jeg opnået solid erfaring inden for ${me.industry || 'branchen'}. `
  if (skillsList.length) t += `Mine kernekompetencer inkluderer ${skillsList.slice(0, 4).join(', ')}. `
  t += `\n\nJeg er motiveret af [udfyld din motivation] og ser frem til muligheden for at bidrage til ${companyName}.\n\nVenlig hilsen,\n${me.name || ''}\n`
  if (langList) t += `\n---\n_Sprog: ${langList}_\n`
  return t
}

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
        "SELECT COUNT(*) AS cnt FROM share_events WHERE target_id = ? AND share_type = 'post'",
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
    // Signal: down-weight interests associated with blocked user's posts
    const [blockedPosts] = await pool.query(
      'SELECT id FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 20',
      [blockedId]
    ).catch(() => [[]])
    for (const p of blockedPosts) {
      autoSignalPost(req.userId, p.id, 'block')
    }
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
    // Audit log: content removed by moderator
    await auditLog(req, 'moderation_remove_content', type, parseInt(target_id), {
      status: 'success',
      details: { report_id: report_id || null, reason: reason || null }
    })
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
    createNotification(targetId, 'moderation',
      `Du har modtaget en advarsel på fellis.eu${reason ? `: ${reason}` : ''}`,
      `You have received a warning on fellis.eu${reason ? `: ${reason}` : ''}`,
      req.userId, 'fellis.eu'
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
    // Audit log: user warned by moderator
    await auditLog(req, 'moderation_warn_user', 'user', targetId, {
      status: 'success',
      details: { report_id: report_id || null, reason: reason || null }
    })
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
    createNotification(targetId, 'moderation',
      `Din konto er suspenderet i ${days} dage${reason ? `. Årsag: ${reason}` : ''}`,
      `Your account has been suspended for ${days} days${reason ? `. Reason: ${reason}` : ''}`,
      req.userId, 'fellis.eu'
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
    // Audit log: user suspended by admin
    await auditLog(req, 'moderation_suspend_user', 'user', targetId, {
      status: 'success',
      details: { days: days, report_id: report_id || null, reason: reason || null, suspended_until: suspendedUntil.toISOString() }
    })
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
    // Audit log: user banned by admin
    await auditLog(req, 'moderation_ban_user', 'user', targetId, {
      status: 'success',
      details: { report_id: report_id || null, reason: reason || null, permanent: true }
    })
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
    // When denying (is_candidate=false with a note), prefix note with [denied] so user sees denial state
    const storedNote = is_candidate ? (note || null) : (note ? `[denied] ${note}` : null)
    await pool.query(
      `UPDATE users SET moderator_candidate = ?, moderator_candidate_note = ?, moderator_candidate_at = NOW() WHERE id = ?`,
      [is_candidate ? 1 : 0, storedNote, id]
    )
    if (!is_candidate) {
      createNotification(id, 'mod_result',
        `Din ansøgning om moderatorstatus er afvist${note ? `. Begrundelse: ${note}` : ''}`,
        `Your moderator application was denied${note ? `. Reason: ${note}` : ''}`,
        req.userId, 'fellis.eu'
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/admin/moderation/users/:id/candidate error:', err)
    res.status(500).json({ error: 'Failed to update candidate status' })
  }
})

// ── User-facing moderator request flow ────────────────────────────────────────

// GET /api/moderation/my-request — get current user's own moderator request status
app.get('/api/moderation/my-request', authenticate, async (req, res) => {
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
    await addCol('reel_likes', 'reaction', "VARCHAR(10) DEFAULT '❤️'").catch(() => {})
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
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/moderation/request — submit a moderator request
app.post('/api/moderation/request', authenticate, async (req, res) => {
  const { reason } = req.body
  try {
    await pool.query(
      'UPDATE users SET moderator_candidate = 1, moderator_candidate_note = ?, moderator_candidate_at = NOW() WHERE id = ?',
      [reason || '', req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/moderation/request — withdraw a moderator request
app.delete('/api/moderation/request', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET moderator_candidate = 0, moderator_candidate_note = NULL, moderator_candidate_at = NULL WHERE id = ?',
      [req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
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
      req.userId, 'fellis.eu'
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

// ── Easter Eggs ──────────────────────────────────────────────────────────────

async function initEasterEggs() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS easter_egg_events (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     INT UNSIGNED NOT NULL,
      egg_id      VARCHAR(32)  NOT NULL,
      event       VARCHAR(32)  NOT NULL DEFAULT 'activated',
      activated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_egg (user_id, egg_id),
      KEY idx_egg_event (egg_id, event)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initEasterEggs:', err.message)
  }
}

// POST /api/easter-eggs/event — record an egg activation (authenticated)
app.post('/api/easter-eggs/event', authenticate, async (req, res) => {
  try {
    const { eggId, event = 'activated' } = req.body || {}
    if (!eggId) return res.status(400).json({ error: 'Missing eggId' })
    const validEvents = ['discovered', 'activated']
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Invalid event' })
    await pool.query(
      'INSERT INTO easter_egg_events (user_id, egg_id, event) VALUES (?, ?, ?)',
      [req.userId, eggId, event]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/easter-eggs/event error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/easter-eggs — current user's discovered eggs from DB
app.get('/api/easter-eggs', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT egg_id,
              SUM(IF(event='discovered',1,0)) AS discovered_count,
              SUM(1) AS activation_count,
              MIN(IF(event='discovered', activated_at, NULL)) AS first_discovered_at
       FROM easter_egg_events WHERE user_id = ?
       GROUP BY egg_id`,
      [req.userId]
    )
    const eggs = {}
    for (const r of rows) {
      eggs[r.egg_id] = {
        discovered: r.discovered_count > 0,
        activationCount: Number(r.activation_count),
        firstDiscoveredAt: r.first_discovered_at || null,
      }
    }
    res.json({ eggs })
  } catch (err) {
    console.error('GET /api/easter-eggs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/easter-eggs/config — fetch current admin egg config (admin only)
app.get('/api/admin/easter-eggs/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      "SELECT key_value FROM admin_settings WHERE key_name = 'easter_egg_config'"
    ).catch(() => [[null]])
    const cfg = row ? JSON.parse(row.key_value || '{}') : {}
    res.json({ config: cfg })
  } catch (err) {
    console.error('GET /api/admin/easter-eggs/config error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/admin/easter-eggs/config — save per-egg hint/enabled config (admin only)
app.put('/api/admin/easter-eggs/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const cfg = req.body || {}
    await pool.query(
      "INSERT INTO admin_settings (key_name, key_value) VALUES ('easter_egg_config', ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)",
      [JSON.stringify(cfg)]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/admin/easter-eggs/config error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/easter-eggs/hints — public; returns eggs where admin enabled hints and set hint text
app.get('/api/easter-eggs/hints', async (req, res) => {
  const DEFAULT_HINTS = [
    { id: 'chuck',    hint: 'har en mening' },
    { id: 'gravity',  hint: 'G G' },
    { id: 'rickroll', hint: 'Going down!' },
  ]
  try {
    const [[row]] = await pool.query(
      "SELECT key_value FROM admin_settings WHERE key_name = 'easter_egg_config'"
    ).catch(() => [[null]])
    const cfg = row ? JSON.parse(row.key_value || '{}') : {}
    const hints = []
    for (const [eggId, ec] of Object.entries(cfg)) {
      if (ec.hintsEnabled && ec.hintText?.trim()) {
        hints.push({ id: eggId, hint: ec.hintText.trim() })
      }
    }
    res.json({ hints: hints.length ? hints : DEFAULT_HINTS })
  } catch (err) {
    console.error('GET /api/easter-eggs/hints error:', err.message)
    res.json({ hints: DEFAULT_HINTS })
  }
})

// GET /api/admin/easter-eggs/stats — per-egg stats (admin only)
app.get('/api/admin/easter-eggs/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    // All events per egg (total activations + unique users)
    const [allRows] = await pool.query(`
      SELECT egg_id, COUNT(*) AS total_activations, COUNT(DISTINCT user_id) AS unique_discoverers
      FROM easter_egg_events
      GROUP BY egg_id
    `)
    // Discovery timing stats (only from 'discovered' events)
    const [discRows] = await pool.query(`
      SELECT
        e.egg_id,
        MIN(TIMESTAMPDIFF(SECOND, u.created_at, e.activated_at)) AS min_seconds,
        MAX(TIMESTAMPDIFF(SECOND, u.created_at, e.activated_at)) AS max_seconds,
        AVG(TIMESTAMPDIFF(SECOND, u.created_at, e.activated_at)) AS avg_seconds
      FROM easter_egg_events e
      JOIN users u ON u.id = e.user_id
      WHERE e.event = 'discovered'
      GROUP BY e.egg_id
    `)
    const discMap = {}
    for (const r of discRows) discMap[r.egg_id] = r
    const stats = allRows.map(r => ({
      egg_id: r.egg_id,
      total_activations: Number(r.total_activations),
      unique_discoverers: Number(r.unique_discoverers),
      min_seconds: discMap[r.egg_id]?.min_seconds ?? null,
      max_seconds: discMap[r.egg_id]?.max_seconds ?? null,
      avg_seconds: discMap[r.egg_id]?.avg_seconds ?? null,
    }))
    res.json({ stats })
  } catch (err) {
    console.error('GET /api/admin/easter-eggs/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Badge reward system ───────────────────────────────────────────────────────

async function initBadges() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS earned_badges (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      badge_id VARCHAR(100) NOT NULL,
      awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_badge_def (user_id, badge_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS badge_config (
      badge_id VARCHAR(100) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS user_login_days (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      login_date DATE NOT NULL,
      UNIQUE KEY unique_user_date (user_id, login_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // comment_likes — used for the "Contributor" badge + comment like UI
    await pool.query(`CREATE TABLE IF NOT EXISTS comment_likes (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      comment_id INT(11) NOT NULL,
      user_id INT(11) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_comment_like (comment_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // adfree_days_bank — user's banked ad-free days (earned via badges)
    await pool.query(`CREATE TABLE IF NOT EXISTS adfree_days_bank (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      days_banked INT NOT NULL DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_bank (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // adfree_day_assignments — date ranges assigned from the bank (source: earned)
    await pool.query(`CREATE TABLE IF NOT EXISTS adfree_day_assignments (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      days_used INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_dates (user_id, start_date, end_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // adfree_purchased_periods — ad-free periods from paid Mollie subscriptions (source: purchased)
    await pool.query(`CREATE TABLE IF NOT EXISTS adfree_purchased_periods (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      subscription_id INT(11) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_dates (user_id, start_date, end_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    // Add adfree_active_until column to users if not present
    await addCol('users', 'adfree_active_until', 'DATETIME DEFAULT NULL')
  } catch (err) {
    console.error('initBadges error:', err.message)
  }
}

// Compute user stats needed for badge evaluation
async function computeUserStats(userId) {
  const [[user]] = await pool.query(
    `SELECT created_at, name, bio_da, bio_en, location, avatar_url FROM users WHERE id = ?`, [userId]
  )
  if (!user) return null

  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM posts WHERE author_id = ?) AS postCount,
      (SELECT COUNT(*) FROM comments WHERE author_id = ?) AS commentCount,
      (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.author_id = ?) AS likesReceived,
      (SELECT COUNT(*) FROM post_likes WHERE user_id = ?) AS likesSentCount,
      (SELECT COUNT(*) FROM friendships WHERE user_id = ?) AS followingCount,
      (SELECT COUNT(*) FROM friendships WHERE friend_id = ?) AS followerCount,
      (SELECT COUNT(*) FROM friendships f1 WHERE f1.user_id = ? AND EXISTS(
        SELECT 1 FROM friendships f2 WHERE f2.user_id = f1.friend_id AND f2.friend_id = ?
      )) AS mutualFollowCount,
      (SELECT COUNT(DISTINCT profile_id) FROM profile_views WHERE viewer_id = ?) AS profilesVisited,
      (SELECT COALESCE(COUNT(*), 0) FROM share_events s WHERE s.user_id = ? AND s.share_type = 'post') +
      COALESCE((SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.shared_by_user_id = ?), 0) AS shareCount,
      (SELECT COUNT(*) FROM posts WHERE author_id = ? AND likes >= 10) AS postsWithTenPlusLikes,
      (SELECT COALESCE(MAX(likes), 0) FROM posts WHERE author_id = ?) AS maxLikesOnSinglePost,
      (SELECT COUNT(DISTINCT cl.comment_id) FROM comment_likes cl JOIN comments c ON c.id = cl.comment_id WHERE c.author_id = ?) AS commentsWithLikes,
      (SELECT COUNT(*) FROM friendships f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ?
        AND f.created_at <= DATE_ADD(u.created_at, INTERVAL 7 DAY)) AS followersJoinedWithinFirstWeek
  `, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId])

  // Reel stats
  const [[reelStats]] = await pool.query(`
    SELECT
      COUNT(*) AS reelCount,
      COALESCE(SUM(views_count), 0) AS reelViewsTotal
    FROM reels WHERE user_id = ?
  `, [userId])
  const [[reelLikeRow]] = await pool.query(`
    SELECT COUNT(*) AS reelLikesReceived
    FROM reel_likes rl JOIN reels r ON r.id = rl.reel_id
    WHERE r.user_id = ?
  `, [userId])

  // Active months: distinct YYYY-MM with at least 1 post or comment in the last 6 months
  const [[{ activeMonths }]] = await pool.query(`
    SELECT COUNT(DISTINCT ym) AS activeMonths FROM (
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym
      FROM posts WHERE author_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      UNION ALL
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym
      FROM comments WHERE author_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    ) sub
  `, [userId, userId])

  // Login streak from user_login_days
  const [loginDays] = await pool.query(
    'SELECT login_date FROM user_login_days WHERE user_id = ? ORDER BY login_date DESC',
    [userId]
  )
  const totalLoginDays = loginDays.length
  let loginStreakDays = 0
  if (loginDays.length) {
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const todayStr = today.toISOString().slice(0, 10)
    const yestStr = yesterday.toISOString().slice(0, 10)
    const dates = loginDays.map(d => {
      const v = d.login_date
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      return String(v).slice(0, 10)
    })
    if (dates[0] === todayStr || dates[0] === yestStr) {
      loginStreakDays = 1
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]); prev.setDate(prev.getDate() - 1)
        const prevStr = prev.toISOString().slice(0, 10)
        if (dates[i] === prevStr) loginStreakDays++
        else break
      }
    }
  }

  // Easter egg stats from server-side events
  const [eggRows] = await pool.query(`
    SELECT egg_id,
           COUNT(*) AS total_count,
           SUM(IF(event='discovered',1,0)) AS discovered_count,
           MIN(IF(event='discovered', activated_at, NULL)) AS first_discovered_at
    FROM easter_egg_events WHERE user_id = ?
    GROUP BY egg_id
  `, [userId])

  const eggDiscovered = []
  const eggActivationCounts = {}
  const eggFirstDiscoveredAt = {}
  for (const r of eggRows) {
    eggActivationCounts[r.egg_id] = Number(r.total_count)
    if (r.discovered_count > 0) {
      eggDiscovered.push(r.egg_id)
      eggFirstDiscoveredAt[r.egg_id] = r.first_discovered_at
    }
  }

  const profileComplete = !!(
    user.name?.trim() &&
    (user.bio_da?.trim() || user.bio_en?.trim()) &&
    user.location?.trim() &&
    user.avatar_url?.trim()
  )

  return {
    accountCreatedAt: user.created_at,
    platformLaunchDate: PLATFORM_LAUNCH_DATE,
    postCount: Number(counts.postCount || 0),
    commentCount: Number(counts.commentCount || 0),
    likesReceived: Number(counts.likesReceived || 0),
    likesSentCount: Number(counts.likesSentCount || 0),
    followingCount: Number(counts.followingCount || 0),
    followerCount: Number(counts.followerCount || 0),
    mutualFollowCount: Number(counts.mutualFollowCount || 0),
    profilesVisited: Number(counts.profilesVisited || 0),
    shareCount: Number(counts.shareCount || 0),
    reelCount: Number(reelStats?.reelCount || 0),
    reelViewsTotal: Number(reelStats?.reelViewsTotal || 0),
    reelLikesReceived: Number(reelLikeRow?.reelLikesReceived || 0),
    postsWithTenPlusLikes: Number(counts.postsWithTenPlusLikes || 0),
    maxLikesOnSinglePost: Number(counts.maxLikesOnSinglePost || 0),
    commentsWithLikes: Number(counts.commentsWithLikes || 0),
    followersJoinedWithinFirstWeek: Number(counts.followersJoinedWithinFirstWeek || 0),
    loginStreakDays,
    totalLoginDays,
    activeMonths: Number(activeMonths || 0),
    profileComplete,
    easterEggs: {
      discovered: eggDiscovered,
      activationCounts: eggActivationCounts,
      firstDiscoveredAt: eggFirstDiscoveredAt,
    },
  }
}

// Record today as a login day (called from heartbeat + session check)
async function recordLoginDay(userId) {
  try {
    await pool.query(
      'INSERT IGNORE INTO user_login_days (user_id, login_date) VALUES (?, CURDATE())',
      [userId]
    )
  } catch { /* non-fatal */ }
}

// POST /api/badges/evaluate — compute stats, award new badges, return them
app.post('/api/badges/evaluate', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    await recordLoginDay(userId)

    const stats = await computeUserStats(userId)
    if (!stats) return res.json({ newBadges: [] })

    // Get already-earned badge IDs
    const [earnedRows] = await pool.query(
      'SELECT badge_id FROM earned_badges WHERE user_id = ?', [userId]
    )
    const earnedIds = earnedRows.map(r => r.badge_id)

    // Get disabled badge IDs
    const [disabledRows] = await pool.query(
      'SELECT badge_id FROM badge_config WHERE enabled = 0'
    )
    const disabledIds = disabledRows.map(r => r.badge_id)

    const newIds = evaluateBadges(stats, earnedIds, disabledIds)
    if (!newIds.length) return res.json({ newBadges: [] })

    const lang = req.lang || 'da'
    const now = new Date()
    const newBadges = []

    for (const badgeId of newIds) {
      try {
        await pool.query(
          'INSERT IGNORE INTO earned_badges (user_id, badge_id, awarded_at) VALUES (?, ?, ?)',
          [userId, badgeId, now]
        )
        const def = BADGE_BY_ID[badgeId]
        if (def) {
          const badge = {
            id: badgeId,
            name: def.name[lang] || def.name.da,
            description: def.description[lang] || def.description.da,
            tier: def.tier,
            category: def.category,
            icon: def.icon,
            awardedAt: now,
          }

          // Award ad-free days if this badge has a day value
          const daysToAward = BADGE_AD_FREE_DAYS[badgeId] || 0
          if (daysToAward > 0) {
            await pool.query(
              `INSERT INTO adfree_days_bank (user_id, days_banked, last_updated)
               VALUES (?, ?, NOW())
               ON DUPLICATE KEY UPDATE
               days_banked = days_banked + VALUES(days_banked),
               last_updated = NOW()`,
              [userId, daysToAward]
            )
            badge.adfreeAdded = daysToAward
          }

          newBadges.push(badge)
        }
      } catch { /* INSERT IGNORE handles duplicates */ }
    }

    res.json({ newBadges })
  } catch (err) {
    console.error('POST /api/badges/evaluate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/badges/earned — all earned badges for the current user
app.get('/api/badges/earned', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [rows] = await pool.query(
      'SELECT badge_id, awarded_at FROM earned_badges WHERE user_id = ? ORDER BY awarded_at ASC',
      [req.userId]
    )
    const badges = rows.map(r => {
      const def = BADGE_BY_ID[r.badge_id]
      if (!def) return null
      return {
        id: r.badge_id,
        name: def.name[lang] || def.name.da,
        description: def.description[lang] || def.description.da,
        tier: def.tier,
        category: def.category,
        icon: def.icon,
        awardedAt: r.awarded_at,
      }
    }).filter(Boolean)
    res.json({ badges })
  } catch (err) {
    console.error('GET /api/badges/earned error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/users/:id/badges — earned badges for any user (used for hover tooltips in feed)
app.get('/api/users/:id/badges', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' })
  try {
    const lang = req.lang || 'da'
    const [rows] = await pool.query(
      'SELECT badge_id FROM earned_badges WHERE user_id = ? ORDER BY awarded_at ASC',
      [targetId]
    )
    const badges = rows.map(r => {
      const def = BADGE_BY_ID[r.badge_id]
      if (!def) return null
      return {
        id: r.badge_id,
        icon: def.icon,
        name: def.name[lang] || def.name.da,
        description: (def.description?.[lang] || def.description?.da) || null,
        tier: def.tier,
      }
    }).filter(Boolean)
    res.json({ badges })
  } catch {
    res.json({ badges: [] })
  }
})

// GET /api/badges/all — all badge definitions (for admin overview)
app.get('/api/badges/all', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [disabledRows] = await pool.query('SELECT badge_id FROM badge_config WHERE enabled = 0')
    const disabledSet = new Set(disabledRows.map(r => r.badge_id))
    const defs = BADGES.map(b => ({
      id: b.id,
      name: b.name[lang] || b.name.da,
      description: b.description[lang] || b.description.da,
      tier: b.tier,
      category: b.category,
      icon: b.icon,
      enabled: !disabledSet.has(b.id),
    }))
    res.json({ badges: defs })
  } catch (err) {
    console.error('GET /api/badges/all error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Ad-Free Days: Badge-Based Rewards ─────────────────────────────────────────

// GET /api/adfree/bank — get user's banked ad-free days
app.get('/api/adfree/bank', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const [rows] = await pool.query(
      'SELECT days_banked, last_updated FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )
    const bankDays = rows.length > 0 ? rows[0].days_banked : 0
    const lastUpdated = rows.length > 0 ? rows[0].last_updated : null
    res.json({ bankDays, lastUpdated })
  } catch (err) {
    console.error('GET /api/adfree/bank error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/adfree/assignments — get assigned ad-free date ranges (earned + purchased)
app.get('/api/adfree/assignments', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { startDate, endDate } = req.query
    const today = new Date().toISOString().split('T')[0]

    // Get earned assignments
    let earnedQuery = 'SELECT id, start_date, end_date, days_used, created_at FROM adfree_day_assignments WHERE user_id = ?'
    const earnedParams = [userId]
    if (startDate) { earnedQuery += ' AND end_date >= ?'; earnedParams.push(startDate) }
    if (endDate) { earnedQuery += ' AND start_date <= ?'; earnedParams.push(endDate) }
    earnedQuery += ' ORDER BY start_date DESC'

    const [earnedRows] = await pool.query(earnedQuery, earnedParams)

    // Get purchased assignments (may not exist on old installs)
    let purchasedRows = []
    try {
      let purchasedQuery = 'SELECT id, start_date, end_date, DATEDIFF(end_date, start_date) + 1 AS days_used, created_at FROM adfree_purchased_periods WHERE user_id = ?'
      const purchasedParams = [userId]
      if (startDate) { purchasedQuery += ' AND end_date >= ?'; purchasedParams.push(startDate) }
      if (endDate) { purchasedQuery += ' AND start_date <= ?'; purchasedParams.push(endDate) }
      purchasedQuery += ' ORDER BY start_date DESC'
      ;[purchasedRows] = await pool.query(purchasedQuery, purchasedParams)
    } catch (e) { /* table may not exist yet */ }

    // Map to response format — use local-time getters to avoid UTC offset shifting dates
    const localDateStr = (d) => {
      if (!d) return null
      const dt = d instanceof Date ? d : new Date(d)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    const toAssignment = (r, source) => ({
      id: r.id,
      source,
      startDate: localDateStr(r.start_date),
      endDate: localDateStr(r.end_date),
      daysUsed: r.days_used,
      createdAt: r.created_at,
    })

    const assignments = [
      ...earnedRows.map(r => toAssignment(r, 'earned')),
      ...purchasedRows.map(r => toAssignment(r, 'purchased')),
    ].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))

    // Find active period (purchased takes priority if multiple)
    let activePeriod = null
    for (const a of assignments) {
      if (a.startDate <= today && today <= a.endDate) {
        if (!activePeriod || a.source === 'purchased') activePeriod = a
      }
    }

    res.json({ assignments, activePeriod })
  } catch (err) {
    console.error('GET /api/adfree/assignments error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/adfree/is-active — check if a specific date is ad-free (purchased priority)
app.get('/api/adfree/is-active', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { date } = req.query
    if (!date) return res.status(400).json({ error: 'date parameter required' })

    // Check purchased first (higher priority)
    let purchasedRows = []
    try {
      ;[purchasedRows] = await pool.query(
        `SELECT 1 FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?`,
        [userId, date, date]
      )
    } catch (e) { /* table may not exist */ }

    if (purchasedRows.length > 0) {
      return res.json({ isAdFree: true, source: 'purchased' })
    }

    const [earnedRows] = await pool.query(
      `SELECT 1 FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?`,
      [userId, date, date]
    )

    res.json({ isAdFree: earnedRows.length > 0, source: earnedRows.length > 0 ? 'earned' : null })
  } catch (err) {
    console.error('GET /api/adfree/is-active error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/adfree/assign — assign banked days to a date range
app.post('/api/adfree/assign', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { startDate, endDate } = req.body

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required' })
    }

    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must be <= endDate' })
    }

    // Calculate days needed
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysNeeded = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1

    // Check if user has enough days in bank
    const [bankRows] = await pool.query(
      'SELECT days_banked FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )

    const bankDays = bankRows.length > 0 ? bankRows[0].days_banked : 0
    if (bankDays < daysNeeded) {
      return res.status(400).json({
        error: 'Insufficient ad-free days',
        available: bankDays,
        needed: daysNeeded,
      })
    }

    // Create assignment
    const now = new Date()
    const [result] = await pool.query(
      `INSERT INTO adfree_day_assignments (user_id, start_date, end_date, days_used, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, startDate, endDate, daysNeeded, now]
    )

    // Deduct from bank
    await pool.query(
      `UPDATE adfree_days_bank SET days_banked = days_banked - ?, last_updated = NOW()
       WHERE user_id = ?`,
      [daysNeeded, userId]
    )

    // If assignment covers today, set ads_free = 1
    const today = new Date().toISOString().split('T')[0]
    if (startDate <= today && today <= endDate) {
      await pool.query(
        'UPDATE users SET ads_free = 1, adfree_active_until = ? WHERE id = ?',
        [new Date(endDate + ' 23:59:59'), userId]
      )
    }

    // Get updated bank
    const [newBankRows] = await pool.query(
      'SELECT days_banked FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )
    const newBank = newBankRows.length > 0 ? newBankRows[0].days_banked : 0

    const assignment = {
      id: result.insertId,
      startDate,
      endDate,
      daysUsed: daysNeeded,
      createdAt: now,
    }

    res.json({ success: true, newBank, assignment })
  } catch (err) {
    console.error('POST /api/adfree/assign error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/admin/badges/stats — admin badge statistics
app.get('/api/admin/badges/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    let totalUsers = 0
    try {
      ;[[{ totalUsers }]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users WHERE is_bot = 0 OR is_bot IS NULL')
    } catch {
      ;[[{ totalUsers }]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users')
    }
    let awardCounts = []
    try {
      ;[awardCounts] = await pool.query(`
        SELECT badge_id, COUNT(*) AS awarded_count FROM earned_badges
        GROUP BY badge_id ORDER BY awarded_count DESC
      `)
    } catch { /* earned_badges table may not exist */ }
    let disabledRows = []
    try {
      ;[disabledRows] = await pool.query('SELECT badge_id FROM badge_config WHERE enabled = 0')
    } catch { /* badge_config table may not exist */ }
    const disabledSet = new Set(disabledRows.map(r => r.badge_id))

    const stats = BADGES.map(b => {
      const row = awardCounts.find(r => r.badge_id === b.id)
      const count = row ? Number(row.awarded_count) : 0
      return {
        id: b.id,
        name: b.name[lang] || b.name.da,
        tier: b.tier,
        category: b.category,
        icon: b.icon,
        enabled: !disabledSet.has(b.id),
        awardedCount: count,
        awardedPct: totalUsers > 0 ? Math.round((count / totalUsers) * 1000) / 10 : 0,
      }
    })

    const sorted = [...stats].sort((a, b) => b.awardedCount - a.awardedCount)
    res.json({
      stats,
      totalUsers: Number(totalUsers),
      topEarned: sorted.slice(0, 5),
      rarest: sorted.filter(s => s.awardedCount > 0).slice(-5).reverse(),
    })
  } catch (err) {
    console.error('GET /api/admin/badges/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/admin/badges/:badgeId — enable/disable a badge
app.patch('/api/admin/badges/:badgeId', authenticate, requireAdmin, async (req, res) => {
  const { badgeId } = req.params
  if (!BADGE_BY_ID[badgeId]) return res.status(404).json({ error: 'Unknown badge' })
  const enabled = req.body.enabled !== false
  try {
    if (enabled) {
      await pool.query('DELETE FROM badge_config WHERE badge_id = ?', [badgeId])
    } else {
      await pool.query(
        'INSERT INTO badge_config (badge_id, enabled) VALUES (?, 0) ON DUPLICATE KEY UPDATE enabled = 0',
        [badgeId]
      )
    }
    res.json({ ok: true, badgeId, enabled })
  } catch (err) {
    console.error('PATCH /api/admin/badges/:badgeId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Nominatim geocode proxy — avoids browser User-Agent restrictions and rate-limits by IP
let nominatimLastCall = 0
app.get('/api/geocode', async (req, res) => {
  const q = req.query.q
  const lang = req.query.lang || 'da'
  if (!q || q.length < 2) return res.json([])
  const now = Date.now()
  const wait = 1100 - (now - nominatimLastCall)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  nominatimLastCall = Date.now()
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=${lang}`
    const r = await fetch(url, { headers: { 'User-Agent': 'fellis.eu/1.0 (contact@fellis.eu)' } })
    if (!r.ok) return res.status(r.status).json([])
    const data = await r.json()
    res.json(data)
  } catch {
    res.status(502).json([])
  }
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
  initMollie()
  initAdminSettings()
  initAnalytics()
  initSettingsSchema()
  initSiteVisits()
  initViralGrowth()
  initReels()
  initAds()
  initAdminAdSettings()
  initBusinessFeatures()
  initEasterEggs()
  initBadges()
  initStoriesHashtags()
  initSignalEngine()
})

app.all('/api/stub/:fn', authenticate, (req, res) => res.json({ ok: true }))

app.post('/api/upload/file', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
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
  } catch (err) {
    console.error('POST /api/upload/file error:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// ── Stories + Hashtags: schema init ──────────────────────────────────────────
async function initStoriesHashtags() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS stories (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT(11) NOT NULL,
      content_text TEXT NOT NULL,
      bg_color VARCHAR(7) NOT NULL DEFAULT '#2D6A4F',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP() + INTERVAL 24 HOUR),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await pool.query(`CREATE TABLE IF NOT EXISTS post_hashtags (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_id INT(11) NOT NULL,
      tag VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      INDEX idx_tag (tag),
      INDEX idx_created (created_at),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  } catch (err) {
    console.error('initStoriesHashtags error:', err.message)
  }
}

// ── Stories ───────────────────────────────────────────────────────────────────
// GET /api/stories/feed — active stories (not expired) from self + friends
app.get('/api/stories/feed', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.user_id, s.content_text, s.bg_color, s.created_at, s.expires_at,
             u.name, u.avatar_url, u.initials
      FROM stories s
      JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > NOW()
        AND (
          s.user_id = ?
          OR s.user_id IN (
            SELECT friend_id FROM friendships WHERE user_id = ?
          )
        )
      ORDER BY s.user_id = ? DESC, s.created_at DESC
    `, [req.userId, req.userId, req.userId])
    // Group by user: one entry per user (latest story)
    const seen = new Set()
    const grouped = []
    for (const r of rows) {
      if (!seen.has(r.user_id)) {
        seen.add(r.user_id)
        grouped.push(r)
      }
    }
    res.json(grouped)
  } catch (err) {
    console.error('GET /api/stories/feed error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Returns the UTC Date corresponding to next midnight in Europe/Copenhagen timezone
function nextMidnightCopenhagen() {
  const tz = 'Europe/Copenhagen'
  const now = new Date()
  // Today's date string in Copenhagen (e.g. '2026-03-15')
  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now)
  const [y, m, d] = todayStr.split('-').map(Number)
  // Midnight UTC for the next calendar day in Copenhagen
  const nextDayMidnightUTC = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0))
  // Hour in Copenhagen when it's midnight UTC on that date (= the UTC offset)
  const hourInCopenhagen = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
      .format(nextDayMidnightUTC)
  ) % 24
  // Subtract offset to get midnight Copenhagen in UTC
  return new Date(nextDayMidnightUTC.getTime() - hourInCopenhagen * 3_600_000)
}

// POST /api/stories — create a new story
app.post('/api/stories', authenticate, async (req, res) => {
  const { content_text, bg_color } = req.body
  if (!content_text || !content_text.trim()) return res.status(400).json({ error: 'content_text required' })
  const color = /^#[0-9A-Fa-f]{6}$/.test(bg_color) ? bg_color : '#2D6A4F'
  const expiresAt = nextMidnightCopenhagen()
  try {
    const [result] = await pool.query(
      'INSERT INTO stories (user_id, content_text, bg_color, expires_at) VALUES (?, ?, ?, ?)',
      [req.userId, content_text.trim().slice(0, 280), color, expiresAt]
    )
    const [[story]] = await pool.query(
      'SELECT s.*, u.name, u.avatar_url, u.initials FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [result.insertId]
    )
    res.json(story)
  } catch (err) {
    console.error('POST /api/stories error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/stories/:id — delete own story
app.delete('/api/stories/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [[story]] = await pool.query('SELECT user_id FROM stories WHERE id = ?', [id])
    if (!story) return res.status(404).json({ error: 'Story not found' })
    if (story.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM stories WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/stories/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Explore ───────────────────────────────────────────────────────────────────
// GET /api/explore/trending-tags — top 10 hashtags last 48 hours
app.get('/api/explore/trending-tags', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT tag, COUNT(*) AS count
      FROM post_hashtags
      WHERE created_at > NOW() - INTERVAL 48 HOUR
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `)
    res.json(rows)
  } catch (err) {
    console.error('GET /api/explore/trending-tags error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/explore/feed — trending posts from non-followed users
app.get('/api/explore/feed', authenticate, async (req, res) => {
  const cursor = req.query.cursor ? parseFloat(req.query.cursor) : null
  const filter = req.query.filter || 'all'   // all | images | video | reels
  const limit = 20
  try {
    // Build media-type filter clause
    let mediaFilter = ''
    if (filter === 'images') mediaFilter = `AND JSON_LENGTH(p.media) > 0 AND NOT JSON_CONTAINS(p.media, '"video"', '$[0].type')`
    else if (filter === 'video') mediaFilter = `AND JSON_LENGTH(p.media) > 0 AND JSON_CONTAINS(p.media, '"video"', '$[0].type')`
    else if (filter === 'reels') {
      // Reels are a separate content type (not linked to posts) — return empty
      return res.json({ posts: [], nextCursor: null })
    }

    // Cursor is the trending_score of the last item
    const cursorClause = cursor !== null ? `HAVING trending_score < ${parseFloat(cursor)}` : ''

    const [rows] = await pool.query(`
      SELECT
        p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
        p.likes, p.media, p.categories, p.created_at,
        u.name AS author, u.avatar_url, u.initials,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        (p.likes + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) * 2)
          / POW(TIMESTAMPDIFF(HOUR, p.created_at, NOW()) + 1, 1.2) AS trending_score
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.author_id != ?
        AND p.author_id NOT IN (
          SELECT friend_id FROM friendships WHERE user_id = ?
        )
        AND p.scheduled_at IS NULL
        ${mediaFilter}
      ${cursorClause}
      ORDER BY trending_score DESC
      LIMIT ?
    `, [req.userId, req.userId, limit])

    const posts = rows.map(r => ({
      id: r.id,
      author: r.author,
      author_id: r.author_id,
      avatar_url: r.avatar_url,
      initials: r.initials,
      text: { da: r.text_da, en: r.text_en },
      time: { da: r.time_da, en: r.time_en },
      likes: r.likes,
      comment_count: r.comment_count,
      media: r.media ? JSON.parse(r.media) : null,
      categories: r.categories ? JSON.parse(r.categories) : null,
      created_at: r.created_at,
      trending_score: parseFloat(r.trending_score) || 0,
    }))

    const nextCursor = posts.length === limit ? posts[posts.length - 1].trending_score : null
    res.json({ posts, nextCursor })
  } catch (err) {
    console.error('GET /api/explore/feed error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/users/suggested — 6 users not followed, sorted by follower count + shared interests
app.get('/api/users/suggested', authenticate, async (req, res) => {
  const limit = parseInt(req.query.limit) || 6
  try {
    let rows
    try {
      ;[rows] = await pool.query(`
        SELECT
          u.id, u.name, u.handle, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM friendships f2 WHERE f2.friend_id = u.id) AS follower_count,
          (
            SELECT COUNT(*)
            FROM user_interests ui1
            JOIN user_interests ui2 ON ui1.interest = ui2.interest
            WHERE ui1.user_id = ? AND ui2.user_id = u.id
          ) AS shared_interests
        FROM users u
        WHERE u.id != ?
          AND u.id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND u.id NOT IN (SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending')
        ORDER BY shared_interests DESC, follower_count DESC
        LIMIT ?
      `, [req.userId, req.userId, req.userId, req.userId, limit])
    } catch {
      // Fallback if user_interests table doesn't exist
      ;[rows] = await pool.query(`
        SELECT
          u.id, u.name, u.handle, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM friendships f2 WHERE f2.friend_id = u.id) AS follower_count,
          0 AS shared_interests
        FROM users u
        WHERE u.id != ?
          AND u.id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND u.id NOT IN (SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending')
        ORDER BY follower_count DESC
        LIMIT ?
      `, [req.userId, req.userId, req.userId, limit])
    }
    res.json(rows)
  } catch (err) {
    console.error('GET /api/users/suggested error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/feed/suggested-posts — posts from non-friends ranked by tag overlap
// Primary signal: hashtags the current user has used in their own posts.
// Falls back to engagement-based ranking when the user has no hashtag history.
app.get('/api/feed/suggested-posts', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 40)
  const excludeIds = (req.query.exclude_ids || '')
    .split(',').map(s => parseInt(s)).filter(n => !isNaN(n) && n > 0)

  try {
    // Try tag-overlap ranking first (requires post_hashtags table)
    let rows = []
    try {
      const excludeClause = excludeIds.length
        ? `AND p.id NOT IN (${excludeIds.map(() => '?').join(',')})`
        : ''

      ;[rows] = await pool.query(`
        SELECT
          p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
          p.likes, p.media, p.categories, p.created_at,
          u.name AS author, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          COALESCE(td.overlap, 0) AS tag_overlap,
          td.matching_tags
        FROM posts p
        JOIN users u ON u.id = p.author_id
        LEFT JOIN (
          SELECT ph2.post_id,
            COUNT(DISTINCT ph2.tag) AS overlap,
            GROUP_CONCAT(DISTINCT ph2.tag ORDER BY ph2.tag SEPARATOR ',') AS matching_tags
          FROM post_hashtags ph2
          WHERE ph2.tag IN (
            SELECT DISTINCT ph1.tag
            FROM post_hashtags ph1
            WHERE ph1.post_id IN (
              SELECT id FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 50
            )
          )
          GROUP BY ph2.post_id
        ) AS td ON td.post_id = p.id
        WHERE p.author_id != ?
          AND p.author_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND p.scheduled_at IS NULL
          AND p.created_at > NOW() - INTERVAL 60 DAY
          ${excludeClause}
        ORDER BY td.overlap DESC, p.likes DESC, p.created_at DESC
        LIMIT ?
      `, [req.userId, req.userId, req.userId, ...excludeIds, limit])
    } catch {
      // post_hashtags table missing — fall back to popularity
    }

    // If tag-overlap returned nothing (no hashtags used), fall back to popularity
    if (!rows.length) {
      const excludeClause = excludeIds.length
        ? `AND p.id NOT IN (${excludeIds.map(() => '?').join(',')})`
        : ''
      ;[rows] = await pool.query(`
        SELECT
          p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
          p.likes, p.media, p.categories, p.created_at,
          u.name AS author, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          0 AS tag_overlap, NULL AS matching_tags
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.author_id != ?
          AND p.author_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND p.scheduled_at IS NULL
          AND p.created_at > NOW() - INTERVAL 60 DAY
          ${excludeClause}
        ORDER BY p.likes DESC, p.created_at DESC
        LIMIT ?
      `, [req.userId, req.userId, ...excludeIds, limit])
    }

    const posts = rows.map(r => ({
      id: r.id,
      author: r.author,
      author_id: r.author_id,
      avatar_url: r.avatar_url,
      initials: r.initials,
      text: { da: r.text_da, en: r.text_en },
      time: { da: r.time_da, en: r.time_en },
      likes: r.likes,
      comment_count: r.comment_count,
      media: r.media ? JSON.parse(r.media) : null,
      categories: r.categories ? JSON.parse(r.categories) : null,
      tag_overlap: r.tag_overlap || 0,
      matching_tags: r.matching_tags ? r.matching_tags.split(',').slice(0, 3) : [],
    }))

    res.json({ posts })
  } catch (err) {
    console.error('GET /api/feed/suggested-posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Signal Engine — API endpoints ────────────────────────────────────────────

// POST /api/signals — batch ingest behavioral signals from the frontend
// Body: { signals: [{ signal_type, source_type?, source_id?, interest_slugs?, context? }] }
// If interest_slugs is omitted and source_type='post', categories are resolved server-side.
app.post('/api/signals', authenticate, async (req, res) => {
  try {
    const raw = req.body.signals
    if (!Array.isArray(raw) || raw.length === 0) return res.json({ ok: true, processed: 0 })
    if (raw.length > 100) return res.status(400).json({ error: 'Too many signals per batch (max 100)' })

    const expanded = []
    for (const s of raw) {
      if (!SIGNAL_VALUES[s.signal_type] && SIGNAL_VALUES[s.signal_type] !== 0) continue
      let slugs = Array.isArray(s.interest_slugs) ? s.interest_slugs : []
      if (slugs.length === 0 && s.source_type === 'post' && s.source_id) {
        try {
          const [[post]] = await pool.query('SELECT categories FROM posts WHERE id=?', [parseInt(s.source_id)])
          if (post?.categories) slugs = JSON.parse(post.categories) || []
        } catch {}
      }
      const ctx = ['professional', 'hobby', 'purchase'].includes(s.context) ? s.context : 'hobby'
      const sv = SIGNAL_VALUES[s.signal_type]
      for (const slug of slugs) {
        expanded.push({
          user_id: req.userId, interest_slug: slug, signal_type: s.signal_type,
          signal_value: sv, context: ctx,
          source_type: s.source_type || null, source_id: s.source_id ? parseInt(s.source_id) : null,
        })
      }
    }

    if (expanded.length > 0) {
      const values = expanded.map(s => [
        s.user_id, s.interest_slug, s.signal_type, s.signal_value, s.context, s.source_type, s.source_id
      ])
      await pool.query(
        'INSERT INTO interest_signals (user_id, interest_slug, signal_type, signal_value, context, source_type, source_id) VALUES ?',
        [values]
      )
      await applySignals(req.userId, expanded)
    }

    res.json({ ok: true, processed: expanded.length })
  } catch (err) {
    console.error('POST /api/signals error:', err.message)
    res.status(500).json({ error: 'Failed to ingest signals' })
  }
})

// GET /api/me/interest-graph — user's full interest graph with computed weights
app.get('/api/me/interest-graph', authenticate, async (req, res) => {
  try {
    const [scores] = await pool.query(`
      SELECT interest_slug, context, weight, explicit_set, last_signal_at, updated_at
      FROM interest_scores
      WHERE user_id = ?
      ORDER BY weight DESC
    `, [req.userId])

    // Seed explicit interests with initial score 50 if not yet tracked
    const [[user]] = await pool.query('SELECT interests FROM users WHERE id=?', [req.userId]).catch(() => [[null]])
    const explicit = user?.interests ? (Array.isArray(user.interests) ? user.interests : JSON.parse(user.interests)) : []

    const scoreMap = new Set(scores.map(s => `${s.interest_slug}:${s.context}`))
    const missing = []
    for (const slug of explicit) {
      if (!scoreMap.has(`${slug}:hobby`)) {
        missing.push({ user_id: req.userId, interest_slug: slug, context: 'hobby', weight: 50, explicit_set: 1 })
      }
    }
    if (missing.length > 0) {
      const vals = missing.map(m => [m.user_id, m.interest_slug, m.context, m.weight, m.explicit_set])
      await pool.query(
        'INSERT IGNORE INTO interest_scores (user_id, interest_slug, context, weight, explicit_set) VALUES ?',
        [vals]
      )
      // Re-fetch after seeding
      const [fresh] = await pool.query(
        'SELECT interest_slug, context, weight, explicit_set, last_signal_at, updated_at FROM interest_scores WHERE user_id=? ORDER BY weight DESC',
        [req.userId]
      )
      return res.json({ scores: fresh, explicit })
    }

    res.json({ scores, explicit })
  } catch (err) {
    console.error('GET /api/me/interest-graph error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/me/interest-graph/:slug — user manually corrects an interest weight
app.patch('/api/me/interest-graph/:slug', authenticate, async (req, res) => {
  try {
    const { slug } = req.params
    const { weight, context = 'hobby' } = req.body
    if (typeof weight !== 'number' || weight < 0 || weight > 100) {
      return res.status(400).json({ error: 'weight must be a number between 0 and 100' })
    }
    const ctx = ['professional', 'hobby', 'purchase'].includes(context) ? context : 'hobby'
    await pool.query(
      `INSERT INTO interest_scores (user_id, interest_slug, context, weight, explicit_set, last_signal_at)
       VALUES (?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE weight=?, explicit_set=1, last_signal_at=NOW()`,
      [req.userId, slug, ctx, weight, weight]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/me/interest-graph/:slug error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/me/interest-graph/signal-stats — recent signal counts for transparency UI
app.get('/api/me/interest-graph/signal-stats', authenticate, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT interest_slug, signal_type, COUNT(*) as cnt, MAX(created_at) as last_at
      FROM interest_signals
      WHERE user_id = ? AND created_at > NOW() - INTERVAL 30 DAY
      GROUP BY interest_slug, signal_type
      ORDER BY cnt DESC
    `, [req.userId])
    res.json({ stats })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'))
})
