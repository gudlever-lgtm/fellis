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
import helmet from 'helmet'
import { rateLimit as rlFactory, ipKeyGenerator } from 'express-rate-limit'
import pool from './db.js'
import { sendSms } from './sms.js'
import { validate, schemas } from './validation.js'
import { BADGES, BADGE_BY_ID, PLATFORM_LAUNCH_DATE, BADGE_AD_FREE_DAYS } from '../src/badges/badgeDefinitions.js'
import { evaluateBadges } from '../src/badges/badgeEngine.js'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from './livestream.js'
import { startRtmpServer, RTMP_PORT } from './rtmp.js'
import authRouter from './routes/auth.js'
import profileRouter from './routes/profile.js'
import usersRouter from './routes/users.js'
import feedRouter from './routes/feed.js'
import storiesRouter from './routes/stories.js'
import businessesRouter from './routes/businesses.js'
import eventsRouter from './routes/events.js'
import marketplaceRouter from './routes/marketplace.js'
import jobsRouter from './routes/jobs.js'
import reelsRouter from './routes/reels.js'
import messagesRouter from './routes/messages.js'
import groupsRouter from './routes/groups.js'
import notificationsRouter from './routes/notifications.js'
import paymentsRouter from './routes/payments.js'
import adminRouter from './routes/admin.js'
import miscRouter from './routes/misc.js'
import translationsRouter from './routes/translations.js'
import { reloadKeywordFilters as reloadSharedKeywordFilters } from './helpers.js'
import { ensureRuntimeColumns } from './ensure-columns.js'

// MySQL 8.x compatible ADD COLUMN helper — ignores duplicate column error (errno 1060)
// SECURITY: Validates table and column names to prevent SQL injection
async function addCol(table, col, def) {
  // Whitelist table names used in migrations
  const VALID_TABLES = ['users', 'posts', 'comments', 'friendships', 'companies',
    'admin_ad_settings', 'admin_settings', 'reels', 'marketplace_listings', 'jobs',
    'shared_jobs', 'earned_badges', 'user_badges', 'badge_config', 'livestreams',
    'messages', 'conversations', 'sessions', 'invitations', 'post_likes',
    'reel_likes', 'reel_comments', 'stories', 'events', 'notifications',
    'conversation_participants', 'ads', 'subscriptions', 'job_saves',
    'event_rsvps', 'job_applications']

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

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`)
      return
    } catch (e) {
      if (e.errno === 1060) return // Column already exists — nothing to do
      if (e.errno === 1213 && attempt < 3) {
        // Deadlock — back off and retry (100ms, 200ms, 400ms)
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)))
        continue
      }
      console.error(`Migration (${table}.${col}):`, e.message)
      return // Log and swallow — non-fatal, column may already exist
    }
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
      // Force IPv4 — smtp.migadu.com has AAAA records but many VPS hosts have
      // no IPv6 route, causing ENETUNREACH followed by a 10-second timeout.
      family: 4,
    })
  } catch {
    console.warn('nodemailer not installed — email sending disabled')
  }
}

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/fellis.eu/uploads'
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || null

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

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
    // Also add source column to friendships if missing
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
    // Public group support
    await addCol('conversations', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0')
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
  if (process.env.NODE_ENV === 'test') return
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

const app = express()
app.set('trust proxy', 1)
app.use(helmet())
app.use(express.json({ limit: '1mb' }))

// ── Strip null bytes from request bodies ─────────────────────────────────
function stripNullBytes(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'string') obj[key] = obj[key].replace(/\0/g, '')
    else if (typeof obj[key] === 'object' && obj[key] !== null) stripNullBytes(obj[key])
  }
  return obj
}
app.use((req, _res, next) => { if (req.body) stripNullBytes(req.body); next() })

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
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, X-CSRF-Token, Authorization')
    res.set('Access-Control-Allow-Credentials', 'true')
    res.set('Access-Control-Max-Age', '86400') // 24 hours
  }
  // Always handle preflight
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Security headers ──────────────────────────────────────────────────────
// Permissions-Policy: only standardised, widely-recognised feature names.
// Experimental Privacy-Sandbox names (browsing-topics, attribution-reporting,
// interest-cohort, private-state-token-*, shared-storage, otp-credentials)
// are intentionally omitted — they cause "Unrecognized feature" browser
// warnings and have no stable specification yet.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), autoplay=(self), camera=(), display-capture=(), ' +
    'encrypted-media=(self), fullscreen=(self), geolocation=(), gyroscope=(), ' +
    'magnetometer=(), microphone=(), midi=(), payment=(self), ' +
    'picture-in-picture=(self), usb=(), web-share=(self), xr-spatial-tracking=()',
  )
  next()
})

// ── Rate limiting ─────────────────────────────────────────────────────────
// express-rate-limit for auth endpoints (survives process restarts in most cases)
// and an in-memory per-user limiter for write operations.

// Login / MFA: 5 per 15 minutes per IP
// In non-production, skip rate limiting for loopback IPs so E2E tests can
// exercise auth endpoints without exhausting the window.

function isLoopback(req) {
  const ip = req.ip
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}
function skipInDev(req) {
  return process.env.NODE_ENV !== 'production' && isLoopback(req)
}

const strictLimit = rlFactory({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — prøv igen om 15 minutter' },
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: skipInDev,
})

// Register: 3 per hour per IP
const registerLimit = rlFactory({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts — prøv igen om en time' },
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: skipInDev,
})

// General API: 100 per 15 minutes per IP
const generalLimit = rlFactory({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — prøv igen om lidt' },
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: (req) => req.method === 'GET' || req.path === '/api/health', // GET requests are read-only
})

// In-memory per-user write limiter (supplements express-rate-limit for authenticated ops)
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

// ── Global API rate limiting (100 write req / 15 min per IP) ─────────────
app.use('/api', generalLimit)

// ── CSRF protection — applied to all /api state-changing requests ─────────
// Skips GET/HEAD/OPTIONS automatically (see validateCsrf implementation).
// Cookie-based sessions are used, so CSRF is a real attack surface.
app.use('/api', validateCsrf)

// ── Mount route files ─────────────────────────────────────────────────────────
app.use('/api', authRouter)
app.use('/api', profileRouter)
app.use('/api', usersRouter)
app.use('/api', feedRouter)
app.use('/api', storiesRouter)
app.use('/api', businessesRouter)
app.use('/api', eventsRouter)
app.use('/api', marketplaceRouter)
app.use('/api', jobsRouter)
app.use('/api', reelsRouter)
app.use('/api', messagesRouter)
app.use('/api', groupsRouter)
app.use('/api', notificationsRouter)
app.use('/api', paymentsRouter)
app.use('/api', adminRouter)
app.use('/api', miscRouter)
app.use('/api', translationsRouter)


// ── Health check ─────────────────────────────────────────────────────────
const SERVER_START = Date.now()

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
    domain: process.env.NODE_ENV === 'production' ? '.fellis.eu' : undefined,
  })
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    domain: process.env.NODE_ENV === 'production' ? '.fellis.eu' : undefined,
  })
}

// ── CSRF Token Helpers ─────────────────────────────────────────────────────
// CSRF_SECRET must be stable across restarts — a new random key would
// invalidate all in-flight tokens every time PM2 restarts the process.
// Auto-generate once and persist to .env so subsequent restarts reuse it.
let CSRF_SECRET = process.env.CSRF_SECRET
if (!CSRF_SECRET) {
  CSRF_SECRET = crypto.randomBytes(32).toString('hex')
  try {
    const envPath = path.join(__dirname, '.env')
    fs.appendFileSync(envPath, `\nCSRF_SECRET=${CSRF_SECRET}\n`)
    console.log('✓ Generated CSRF_SECRET and saved to .env')
  } catch (e) {
    console.warn('⚠ Could not persist CSRF_SECRET to .env:', e.message)
  }
}

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

// Pre-authentication endpoints that must never require CSRF — users reach
// them before they have a valid session (or when their session has expired).
// A stale fellis_sid cookie must not block login/register.
const CSRF_EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-mfa',
  '/auth/logout',  // logout only clears the session — CSRF risk is negligible
  '/visit',
])

// CSRF validation middleware for state-changing requests
function validateCsrf(req, res, next) {
  // Skip CSRF for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

  // Skip CSRF for pre-auth endpoints — these are reachable without a valid
  // session, so requiring a CSRF token would create an unsolvable deadlock
  // for users whose session cookie has expired.
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next()

  const sessionId = getSessionIdFromRequest(req)
  // If no session, CSRF doesn't apply (no cookie to steal); authentication
  // middleware on each route will still reject unauthenticated requests.
  if (!sessionId) return next()

  const csrfToken = req.headers['x-csrf-token'] || req.body?.csrf_token
  if (!csrfToken) return res.status(403).json({ error: 'CSRF token required' })

  try {
    if (!verifyCsrfToken(sessionId, csrfToken)) {
      return res.status(403).json({ error: 'Invalid CSRF token' })
    }
    next()
  } catch (err) {
    // timingSafeEqual throws if buffer lengths differ (malformed token)
    res.status(403).json({ error: 'Invalid CSRF token' })
  }
}

// ── Input Length Helpers ──────────────────────────────────────────────────
function limitText(val, maxLen) {
  if (typeof val !== 'string') return val
  return val.slice(0, maxLen)
}

function validateMediaArray(media) {
  if (media === null || media === undefined) return null
  if (!Array.isArray(media)) return 'media must be an array'
  if (media.length > 10) return 'Too many media items (max 10)'
  const allowedTypes = ['image', 'video', 'audio', 'file']
  for (const item of media) {
    if (!item || typeof item !== 'object') return 'Invalid media item'
    if (typeof item.url !== 'string' || (!item.url.startsWith('/uploads/') && !item.url.startsWith('http'))) return 'Invalid media URL'
    if (!allowedTypes.includes(item.type)) return 'Invalid media type'
    if (typeof item.mime !== 'string') return 'Invalid media mime'
  }
  return null
}

// ── Audit Logging Helper ───────────────────────────────────────────────────
// Logs security-relevant events for compliance and monitoring
async function auditLog(req, action, resourceType = null, resourceId = null, {
  status = 'success',
  oldValue = null,
  newValue = null,
  details = null,
  userId: explicitUserId = undefined,
} = {}) {
  if (process.env.NODE_ENV === 'test') return
  // Skip during E2E smoke tests (deploy.sh post-deploy check) — but never in production
  if (process.env.NODE_ENV !== 'production' && req?.headers?.['x-e2e-test'] === '1') return
  // explicitUserId lets callers (e.g. login) pass the userId before req.userId is set,
  // avoiding { ...req } spread which drops Express prototype getters like req.ip
  const userId = explicitUserId !== undefined ? explicitUserId : (req.userId || null)
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
  { mime: 'image/avif', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // ftyp (ISO-BMFF)
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

// Hard ceiling for uploads — per-route limits are enforced via upload.array('field', N)
// and runtime validation against admin config. Kept generous so admin can configure up to 20.
const UPLOAD_FILES_CEILING = 20
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max
    files: UPLOAD_FILES_CEILING,
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

// Startup schema-sync (runs once at module load, non-fatal if any step fails)
ensureRuntimeColumns()
  .catch(err => console.error('ensureRuntimeColumns:', err.message))

// Reset ads_free for users with no active paid subscription AND no active earned-day assignment.
// Days sitting in the bank (adfree_days_bank) alone do NOT qualify — only activated assignments
// (adfree_day_assignments) or paid periods (adfree_purchased_periods) make a user ad-free.
pool.query(`
  UPDATE users SET ads_free = 0
  WHERE ads_free = 1
    AND id NOT IN (
      SELECT user_id FROM subscriptions
      WHERE status = 'paid'
        AND plan NOT IN ('ad_activation')
        AND (expires_at IS NULL OR expires_at > NOW())
    )
    AND id NOT IN (
      SELECT user_id FROM adfree_day_assignments
      WHERE start_date <= CURDATE() AND end_date >= CURDATE()
    )
    AND id NOT IN (
      SELECT user_id FROM adfree_purchased_periods
      WHERE start_date <= CURDATE() AND end_date >= CURDATE()
    )
`).catch(err => console.error('Migration (ads_free cleanup):', err.message))

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

// Sessions + moderation columns are included in ensureRuntimeColumns() above;
// they must exist before the login handler runs on legacy DBs without
// migrate-moderation.sql applied. The call is fire-and-forget but the
// underlying columns land before the first slow query in practice.

// Serve uploads with security headers (no script execution, no sniffing)
app.use('/uploads', (req, res, next) => {
  // Block anything that isn't GET
  if (req.method !== 'GET') return res.status(405).end()
  // Restrict script execution for uploaded files
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  res.setHeader('Cache-Control', 'public, max-age=86400')
  next()
}, express.static(UPLOADS_DIR, {
  dotfiles: 'deny',        // No hidden files
  index: false,             // No directory listing
  extensions: false,        // No extension guessing
}), (req, res) => res.status(404).end())

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

// ── Global CSRF enforcement for state-changing requests ──────────────────────
const CSRF_SKIP_PATHS = ['/api/auth/', '/api/mollie/payment/webhook', '/api/stream/auth', '/api/stream/end', '/api/visit']
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (CSRF_SKIP_PATHS.some(p => req.path.startsWith(p) || req.path === p)) return next()
  if (!getSessionIdFromRequest(req)) return next()
  validateCsrf(req, res, next)
})

// ── Public visit tracking ─────────────────────────────────────────────────────
// Tracks visits from all users (including unauthenticated) once per IP per day.
// Called by the frontend on app load so the visitors dashboard always has data.
const visitedAnonIps = new Set() // in-memory: anonymous IPs tracked this server process day

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

// ── Auth routes ──

// POST /api/auth/login — login with email + password (MFA-aware)


// POST /api/auth/forgot-password — request password reset link via email

// POST /api/auth/reset-password — set new password using reset token

// POST /api/auth/verify-mfa — verify SMS code and complete login

// POST /api/auth/enable-mfa — enable SMS MFA for current user (requires phone on account)

// POST /api/auth/disable-mfa — disable SMS MFA for current user

// POST /api/auth/send-enable-mfa — send SMS verification code to activate MFA (MFA not yet enabled)

// POST /api/auth/confirm-enable-mfa — verify SMS code and set mfa_enabled=1

// POST /api/auth/send-settings-mfa — send SMS MFA code for sensitive settings changes

// PATCH /api/profile/phone — update phone number for current user

// POST /api/auth/logout

// GET /api/csrf-token — get CSRF token for this session (must be authenticated)

// GET /api/auth/session — check if session is valid

// POST /api/user/onboarding/dismiss — mark onboarding checklist as dismissed

// ── OAuth CSRF state store — short-lived, in-memory ───────────────────────
// Keyed by random state string; each entry has { provider, createdAt }.
// Entries are consumed on first use and purged every 15 minutes.
const oauthStateTokens = new Map()
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000 // 10-minute TTL
  for (const [k, v] of oauthStateTokens) {
    if (v.createdAt < cutoff) oauthStateTokens.delete(k)
  }
}, 15 * 60 * 1000)

// ── Google OAuth ──

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://fellis.eu/api/auth/google/callback'



// ── LinkedIn OAuth ──

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://fellis.eu/api/auth/linkedin/callback'




// ── Profile routes ──

// GET /api/profile/:id — public profile (friend view)

// GET /api/profile/:id/photos — posts with images/video from a user (max 30)

// GET /api/profile/:id/posts — recent posts by a user (max 10)

// GET /api/profile — current user profile

// GET /api/user/handle/:handle — get user by handle (public, no auth required)

// PATCH /api/me/mode — update user mode (privat / business)

// PATCH /api/me/lang — update current session language

// PATCH /api/me/plan — update user plan (business only — business_pro removed)

// PATCH /api/me/interests — save user interest categories (min 3)

// PATCH /api/me/tags — save user tags (max 10, max 30 chars each)

// PATCH /api/me/profile-extended — update relationship_status + website

// PATCH /api/me/business-profile — update business-only profile fields

// ── Business Discovery ────────────────────────────────────────────────────────

// GET /api/businesses — paginated list of business accounts

// GET /api/businesses/suggested — businesses matched to user interests

// GET /api/businesses/:handle — public business profile

// POST /api/businesses/:id/follow — follow a business account

// DELETE /api/businesses/:id/follow — unfollow a business account

// POST /api/users/:id/follow — follow any user (standard or business)

// DELETE /api/users/:id/follow — unfollow a user

// GET /api/me/followers — users who follow me (user_follows + business_follows)

// GET /api/me/following — users and companies I follow

// POST /api/profile/avatar — upload profile picture

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

// PATCH /api/profile/password — change password (or set first password for imported users)

// ── Settings: Sessions ─────────────────────────────────────────────────────

// GET /api/settings/sessions — list all active sessions for current user

// DELETE /api/settings/sessions/others — log out all other sessions
// NOTE: must be defined BEFORE /:id to prevent "others" being caught as an id param

// DELETE /api/settings/sessions/:id — log out a specific session

// ── Settings: Privacy ──────────────────────────────────────────────────────

// GET /api/settings/privacy

// PATCH /api/settings/privacy

// ── Settings: Skills ───────────────────────────────────────────────────────

// GET /api/skills/:userId — get skills + endorsement counts

// GET /api/skills/:skillId/endorsers — names of people who endorsed

// POST /api/skills — add a skill (own profile)

// DELETE /api/skills/:id — remove a skill (own only, even with endorsements)

// POST /api/skills/:id/endorse — toggle endorse / unendorse

// ── Feed routes ──

// GET /api/linked-content?type=job|listing|event&id=:id — fetch preview card for tagged content

// GET /api/feed — cursor-based pagination (stable, no duplicate posts on new inserts)
// Query params:
//   cursor (optional) — ISO timestamp; load posts older than this (load-more / infinite scroll)
//   limit  (optional, max 50, default 20)
// Response: { posts, nextCursor }
//   nextCursor — ISO timestamp to pass as ?cursor= for the next page, or null if no more posts

// GET /api/feed/memories — posts by the current user from this same date in previous years

// POST /api/posts/:id/boost — business pays to boost a post as a sponsored ad

// POST /api/feed/preflight — check text against keyword filters without posting

// Cache for media_max_files admin setting (refreshed every 60s)
let _mediaMaxFilesCache = { value: 4, expiresAt: 0 }
async function getMediaMaxFiles() {
  const now = Date.now()
  if (now < _mediaMaxFilesCache.expiresAt) return _mediaMaxFilesCache.value
  try {
    const [rows] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'media_max_files'")
    const val = rows[0]?.key_value ? parseInt(rows[0].key_value, 10) : 4
    const clamped = Math.max(1, Math.min(val || 4, UPLOAD_FILES_CEILING))
    _mediaMaxFilesCache = { value: clamped, expiresAt: now + 60_000 }
    return clamped
  } catch {
    return _mediaMaxFilesCache.value
  }
}
// Invalidate the cache (called when admin updates settings)
function invalidateMediaMaxFilesCache() { _mediaMaxFilesCache.expiresAt = 0 }


// POST /api/feed — create a new post (with optional media)

// POST /api/upload — standalone upload endpoint (for drag-and-drop preview)

// POST /api/feed/:id/like — toggle like or change reaction

// GET /api/feed/:id/likers — list of users who liked a post with their reaction


// POST /api/comments/:id/like — toggle reaction on a comment (emoji optional, default ❤️)

// DELETE /api/feed/:id — delete own post


// GET /api/visitor-stats — aggregated visitor statistics (authenticated users)

// ── Invite routes ──

// GET /api/invite/:token — public: get inviter info from invite link

// GET /api/invites/link — get current user's personal invite link

// POST /api/invites — create individual invitations and send email if SMTP is configured

// DELETE /api/invites/:id — withdraw a sent invitation

// GET /api/invites — list invitations sent by current user

// ── Friends routes ──

// GET /api/friends — get current user's friends

// GET /api/friends/suggested — people you may know (friends of friends)

// POST /api/friends/request/:userId — send a connection request

// GET /api/friends/requests — incoming pending requests + outgoing pending requests

// POST /api/friends/requests/:id/accept

// POST /api/friends/requests/:id/decline

// DELETE /api/friends/request/:userId — cancel an outgoing pending friend request

// DELETE /api/friends/:userId — unfriend (mutual). Optional ?notify=1 sends a message.

// PATCH /api/friends/:userId/family — mark/unmark as family (for feed weighting)

// GET /api/conversations — all conversations for the current user

// GET /api/conversations/:id/messages — recent messages for a conversation

// GET /api/conversations/:id/messages/older — paginated older messages

// POST /api/conversations — create a new 1:1 or group conversation

// GET /api/sse — Server-Sent Events stream for real-time updates


// POST /api/conversations/:id/read — mark messages as read + update last_read_at for receipt

// POST /api/conversations/:id/invite — add participants to an existing conversation

// POST /api/conversations/:id/mute — mute for N minutes (null to unmute)

// DELETE /api/conversations/:id/leave — leave a group conversation

// PATCH /api/conversations/:id — rename a group conversation

// DELETE /api/conversations/:id/participants/:userId — remove a member (creator only)

// POST /api/conversations/:id/participants/:userId/mute — admin-mute a member (creator only)

// ── Search ──

// GET /api/posts/:id — fetch a single post (for search result navigation)

// GET /api/users/search?q=... — search all users, includes friendship/request state

// GET /api/search?q=... — search posts and messages the current user is involved in
// Posts: authored by, liked by, or commented on by the user
// Messages: within conversations the user participates in

// ── Link preview proxy ──

function isSafeExternalUrl(urlStr) {
  let parsed
  try { parsed = new URL(urlStr) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()

  // Block localhost and common aliases
  if (host === 'localhost') return false

  // Block all IPv6 private/loopback/link-local/ULA ranges
  // Strip brackets: [::1] → ::1
  const bare = host.startsWith('[') ? host.slice(1, -1) : host
  if (bare === '::1') return false                                   // loopback
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return false               // fe80::/10 link-local
  if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i.test(bare)) return false // fc00::/7 ULA
  if (/^ff[0-9a-f]{2}:/i.test(bare)) return false                  // ff00::/8 multicast
  if (/^::f{4}:/i.test(bare)) return false                          // IPv4-mapped ::ffff:
  if (bare === '::' || bare === '0:0:0:0:0:0:0:0') return false    // unspecified

  // Block IPv4 private/reserved ranges
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1]), parseInt(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
    if (a === 100 && b >= 64 && b <= 127) return false  // RFC 6598 shared address space
    if (a === 192 && b === 0 && parseInt(ipv4[3]) === 2) return false // TEST-NET
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

// ══════════════════════════════════════════════════════════════
// ── GDPR COMPLIANCE ENDPOINTS ──
// ══════════════════════════════════════════════════════════════

// POST /api/gdpr/consent — Record explicit consent
// GDPR Art. 6 & 7: Consent must be freely given, specific, informed, and unambiguous.

// GET /api/gdpr/consent — Check current consent status

// POST /api/gdpr/consent/withdraw — Withdraw consent (GDPR Art. 7(3))
// Withdrawing consent must be as easy as giving it.

// POST /api/gdpr/account/request-delete — Step 1: verify password and optionally send SMS MFA
// Returns { ok, mfa_required, has_password } so the client knows what step comes next.

// DELETE /api/gdpr/account — Full account deletion (GDPR Art. 17 — Right to be forgotten)
// Requires password (if set) and SMS MFA code (if enabled) in the request body.
// Deletes the user and ALL associated data. This is irreversible.

// GET /api/gdpr/export — Data portability (GDPR Art. 20)
// Returns all user data in a structured JSON format for download.

// ── Data Retention Cleanup (GDPR Art. 5(1)(e) — storage limitation) ──
// Runs periodically to purge stale data.
async function runDataRetentionCleanup() {
  try {
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

    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_categories (
      id          VARCHAR(64)  NOT NULL PRIMARY KEY,
      parent_id   VARCHAR(64)  DEFAULT NULL,
      da          VARCHAR(128) NOT NULL,
      en          VARCHAR(128) NOT NULL,
      icon        VARCHAR(8)   NOT NULL DEFAULT '📦',
      sort_order  INT          NOT NULL DEFAULT 0,
      active      TINYINT(1)   NOT NULL DEFAULT 1,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mcat_parent (parent_id),
      INDEX idx_mcat_active_sort (active, sort_order),
      CONSTRAINT fk_mcat_parent FOREIGN KEY (parent_id) REFERENCES marketplace_categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    const [[{ mcatCount }]] = await pool.query('SELECT COUNT(*) AS mcatCount FROM marketplace_categories')
    if (mcatCount === 0) {
      await pool.query(`INSERT IGNORE INTO marketplace_categories (id, parent_id, da, en, icon, sort_order) VALUES
        ('electronics', NULL, 'Elektronik', 'Electronics', '🖥️', 10),
        ('furniture',   NULL, 'Møbler & Indretning', 'Furniture & Decor', '🪑', 20),
        ('clothing',    NULL, 'Tøj & Mode', 'Clothing & Fashion', '👕', 30),
        ('sports',      NULL, 'Sport & Fritid', 'Sports & Outdoors', '⚽', 40),
        ('books',       NULL, 'Bøger & Medier', 'Books & Media', '📚', 50),
        ('garden',      NULL, 'Have & Udendørs', 'Garden & Outdoor', '🌱', 60),
        ('vehicles',    NULL, 'Biler & Transport', 'Vehicles & Transport', '🚗', 70),
        ('other',       NULL, 'Andet', 'Other', '📦', 900),
        ('electronics-phones',    'electronics', 'Mobiltelefoner', 'Mobile Phones', '📱', 11),
        ('electronics-computers', 'electronics', 'Computere & Tablets', 'Computers & Tablets', '💻', 12),
        ('electronics-audio',     'electronics', 'Lyd & Hovedtelefoner', 'Audio & Headphones', '🎧', 13),
        ('electronics-tv',        'electronics', 'TV & Skærme', 'TV & Monitors', '📺', 14),
        ('electronics-gaming',    'electronics', 'Gaming & Konsoller', 'Gaming & Consoles', '🎮', 15),
        ('electronics-cameras',   'electronics', 'Kameraer & Foto', 'Cameras & Photo', '📷', 16),
        ('electronics-smarthome', 'electronics', 'Smart hjem', 'Smart Home', '🏠', 17),
        ('furniture-sofa',    'furniture', 'Sofa & Lænestole', 'Sofas & Armchairs', '🛋️', 21),
        ('furniture-tables',  'furniture', 'Borde & Spisestuer', 'Tables & Dining', '🍽️', 22),
        ('furniture-beds',    'furniture', 'Senge & Soveværelse', 'Beds & Bedroom', '🛏️', 23),
        ('furniture-storage', 'furniture', 'Opbevaring & Reoler', 'Storage & Shelving', '🗄️', 24),
        ('furniture-lamps',   'furniture', 'Lamper & Belysning', 'Lamps & Lighting', '💡', 25),
        ('furniture-decor',   'furniture', 'Pynt & Indretning', 'Decor & Accents', '🖼️', 26),
        ('clothing-womens',  'clothing', 'Dametøj', 'Womens Clothing', '👗', 31),
        ('clothing-mens',    'clothing', 'Herretøj', 'Mens Clothing', '👔', 32),
        ('clothing-kids',    'clothing', 'Børnetøj', 'Kids Clothing', '👶', 33),
        ('clothing-shoes',   'clothing', 'Sko', 'Shoes', '👟', 34),
        ('clothing-bags',    'clothing', 'Tasker & Accessories', 'Bags & Accessories', '👜', 35),
        ('clothing-jewelry', 'clothing', 'Smykker & Ure', 'Jewelry & Watches', '💍', 36),
        ('sports-bicycles', 'sports', 'Cykler', 'Bicycles', '🚲', 41),
        ('sports-fitness',  'sports', 'Fitness & Træning', 'Fitness & Training', '🏋️', 42),
        ('sports-outdoor',  'sports', 'Outdoor & Camping', 'Outdoor & Camping', '⛺', 43),
        ('sports-water',    'sports', 'Vandsport', 'Water Sports', '🏄', 44),
        ('sports-winter',   'sports', 'Vintersport', 'Winter Sports', '⛷️', 45),
        ('sports-team',     'sports', 'Holdsport', 'Team Sports', '⚽', 46),
        ('books-fiction',    'books', 'Skønlitteratur', 'Fiction', '📖', 51),
        ('books-nonfiction', 'books', 'Faglitteratur', 'Non-fiction', '📘', 52),
        ('books-textbooks',  'books', 'Studiebøger', 'Textbooks', '🎓', 53),
        ('books-comics',     'books', 'Tegneserier & Manga', 'Comics & Manga', '💬', 54),
        ('books-music',      'books', 'Musik & Vinyl', 'Music & Vinyl', '🎵', 55),
        ('books-movies',     'books', 'Film & Serier', 'Movies & Series', '🎬', 56),
        ('garden-plants',     'garden', 'Planter & Blomster', 'Plants & Flowers', '🌸', 61),
        ('garden-tools',      'garden', 'Haveværktøj', 'Garden Tools', '🧰', 62),
        ('garden-furniture',  'garden', 'Havemøbler', 'Garden Furniture', '🪑', 63),
        ('garden-grills',     'garden', 'Grill & Udekøkken', 'Grills & Outdoor Kitchen', '🔥', 64),
        ('garden-playground', 'garden', 'Legeplads & Børn ude', 'Playground & Outdoor Kids', '🛝', 65),
        ('vehicles-cars',        'vehicles', 'Biler', 'Cars', '🚗', 71),
        ('vehicles-motorcycles', 'vehicles', 'Motorcykler & Scootere', 'Motorcycles & Scooters', '🏍️', 72),
        ('vehicles-bicycles',    'vehicles', 'Cykler', 'Bicycles', '🚲', 73),
        ('vehicles-parts',       'vehicles', 'Reservedele', 'Parts & Accessories', '🔧', 74),
        ('vehicles-boats',       'vehicles', 'Både & Vandfartøjer', 'Boats & Watercraft', '⛵', 75),
        ('vehicles-trailers',    'vehicles', 'Trailere & Campingvogne', 'Trailers & Caravans', '🚐', 76)`)
    }

    // Add columns that may be missing on older installs
    await addCol('marketplace_listings', 'priceNegotiable', 'TINYINT(1) DEFAULT 0')
    await addCol('marketplace_listings', 'sold', 'TINYINT(1) DEFAULT 0')
    await addCol('marketplace_listings', 'boosted_until', 'TIMESTAMP NULL DEFAULT NULL')
    await addCol('marketplace_listings', 'contact_phone', 'VARCHAR(50) DEFAULT NULL')
    await addCol('marketplace_listings', 'contact_email', 'VARCHAR(255) DEFAULT NULL')

    // Add subcategory column to marketplace_listings if missing
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_listings' AND COLUMN_NAME = 'subcategory'`
    )
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE marketplace_listings ADD COLUMN subcategory VARCHAR(64) DEFAULT NULL AFTER category, ADD INDEX idx_subcategory (subcategory)`)
    }
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



// GET /api/marketplace/boosted-feed — return active boosted listings for feed injection





// POST /api/marketplace/:id/view — record a listing view (skip owner, deduplicate per hour)

// GET /api/marketplace/stats — stats for current user's listings

// ── User follows (asymmetric, any user) ──────────────────────────────────────

const CREATE_USER_FOLLOWS = `CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INT NOT NULL,
  followee_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  KEY idx_uf_follower (follower_id),
  KEY idx_uf_followee (followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

async function initUserFollows() {
  try {
    await pool.query(CREATE_USER_FOLLOWS)
  } catch (err) {
    console.error('initUserFollows error:', err.message)
  }
}

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

// GET /api/companies/all — discover all companies (with optional search)


// GET /api/companies/:id — company details + posts + jobs

// PUT /api/companies/:id — update company

// DELETE /api/companies/:id — delete company (owner only)

// POST /api/companies/:id/follow — follow or unfollow

// GET /api/companies/:id/members — list of company members with friendship status

// POST /api/companies/:id/members — add member to company

// DELETE /api/companies/:id/members/:userId — remove member from company

// GET /api/companies/:id/followers — list of users following this company

// GET /api/companies/:id/posts — paginated posts

// GET /api/feed/company-posts — recent posts from all companies the user follows or owns
// Used to interleave company content chronologically in the main feed.
// Only returns posts created within the last 14 days so stale content doesn't reappear.


// POST /api/companies/:id/posts/:postId/like — like or unlike

// GET /api/companies/:id/posts/:postId/comments — get comments

// POST /api/companies/:id/posts/:postId/comments — add comment

// GET /api/jobs — all active jobs (with optional filters)

// GET /api/jobs/saved — jobs the user has saved

// PATCH /api/jobs/:id/track — set personal tracking status (private users)

// GET /api/jobs/tracked — jobs with a tracking status set by the user



// DELETE /api/jobs/:id — delete (close) job

// POST /api/jobs/:id/save — save or unsave job

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
      note TEXT NOT NULL,
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
    await addCol('users', 'follower_count', 'INT DEFAULT 0')
    await addCol('users', 'community_score', 'INT DEFAULT 0')
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

// GET /api/jobs/:id/applications — recruiter: list applicants (company admin/owner only)

// PATCH /api/jobs/:id/applications/:appId — recruiter: update applicant status

// POST /api/jobs/:id/share — share a job with another user

// DELETE /api/jobs/:id/share/:userId — unshare job

// GET /api/jobs/:id/shared-with — get list of users job is shared with (by current user)

// GET /api/jobs/shared — get jobs shared with me

// ── Contact Notes (CRM) ───────────────────────────────────────────────────────

// GET /api/contact-notes/:userId — get my private note for a specific contact

// PUT /api/contact-notes/:userId — save/update my private note for a contact

// GET /api/contact-notes — list all my notes (for "My notes" view)

// ── Scheduled Posts ───────────────────────────────────────────────────────────

// GET /api/feed/scheduled — list my scheduled posts

// PATCH /api/feed/scheduled/:id — reschedule or cancel a scheduled post

// ── Company Lead Capture ──────────────────────────────────────────────────────

// POST /api/companies/:id/leads — submit a lead form

// GET /api/companies/:id/leads — company admin: get all leads

// PATCH /api/companies/:id/leads/:leadId — update lead status

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
    await addCol('admin_ad_settings', 'adfree_annual_discount_pct', 'INT NOT NULL DEFAULT 0')
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


// GET /api/ads — list own ads (business) or all active ads (admin)

// GET /api/ads/mine — business user's own ads with full monetisation fields
// NOTE: must be registered BEFORE /api/ads/:id

// GET /api/pricing — public endpoint for displaying pricing on marketing pages (no auth required)

// GET /api/ads/price — public ad pricing for authenticated users (used in payment modal)
// NOTE: must be registered BEFORE /api/ads/:id to avoid Express matching "price" as :id

// GET /api/ads/:id — get single ad

// PUT /api/ads/:id — update ad

// PATCH /api/ads/:id — partial update of ad metadata (blocks placement/cpm_rate changes)

// DELETE /api/ads/:id — permanently delete ad (only allowed when status = 'draft')

// POST /api/ads/:id/pay — create Mollie payment to activate an ad

// POST /api/ads/:id/impression — record impression with CPM deduction and reach tracking

// POST /api/ads/:id/click — record click

// ── Ad-blocker-safe content endpoints ─────────────────────────────────────────
// Same logic as /api/ads?serve=1 / /api/ads/:id/impression / /api/ads/:id/click
// but under /api/content/* to avoid ad blocker filter lists.

// GET /api/content — serve ads for a given section (replaces /api/ads?serve=1&placement=X)

// POST /api/content/:id/view — record impression (replaces /api/ads/:id/impression)

// POST /api/content/:id/open — record click (replaces /api/ads/:id/click)

// ── Admin ad settings ─────────────────────────────────────────────────────────

// GET /api/admin/ad-settings — fetch ad pricing & display settings (admin only)

// PUT /api/admin/ad-settings — update ad pricing & display settings (admin only)

// GET /api/admin/ad-stats — per-placement impressions, clicks, CTR, count & revenue (admin only)

// (Stripe integration removed — platform uses Mollie for payments)

// GET /api/me/subscription — get current user's ads_free status + Mollie subscription details

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

// GET /api/currency/eur-dkk — live EUR→DKK rate for MobilePay conversion

// POST /api/mollie/payment/create — create a Mollie payment and return checkout URL

// POST /api/mollie/payment/webhook — Mollie webhook (always returns 200 so Mollie doesn't retry)

// GET /api/mollie/payment/status — current user's Mollie subscription status

// DELETE /api/mollie/subscription/cancel — cancel active recurring subscription

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
      chuck:    { globalEnabled: true, hintsEnabled: true, hintText: '↑↑↓↓←→←→ — klassisk!' },
      matrix:   { globalEnabled: true, hintsEnabled: true, hintText: 'Følg den hvide kanin' },
      flip:     { globalEnabled: true, hintsEnabled: true, hintText: 'Verden set fra en anden vinkel' },
      retro:    { globalEnabled: true, hintsEnabled: true, hintText: 'Tilbage til rødderne' },
      gravity:  { globalEnabled: true, hintsEnabled: true, hintText: 'Newton havde ret om feeds' },
      party:    { globalEnabled: true, hintsEnabled: true, hintText: 'Festen venter på dig' },
      rickroll: { globalEnabled: true, hintsEnabled: true, hintText: 'Nysgerrighed har en pris' },
      watcher:  { globalEnabled: true, hintsEnabled: true, hintText: 'Hvem kigger på hvem?' },
      riddler:  { globalEnabled: true, hintsEnabled: true, hintText: 'Spørgsmålet er svaret' },
      phantom:  { globalEnabled: true, hintsEnabled: true, hintText: 'Ikke alle besøgende er synlige' },
    }
    await pool.query(
      "INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('easter_egg_config', ?)",
      [JSON.stringify(defaultEggCfg)]
    )
    // Seed default livestream limits
    await pool.query(
      "INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('reel_max_duration_seconds', ?)",
      [String(LIVESTREAM_DEFAULTS.reel_max_duration_seconds)]
    )
    await pool.query(
      "INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('streaming_max_duration_seconds', ?)",
      [String(LIVESTREAM_DEFAULTS.streaming_max_duration_seconds)]
    )
    await pool.query(
      "INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('livestream_enabled', '0')"
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

// GET /api/analytics/visitor-stats — aggregated visitor statistics with date range

// GET /api/admin/settings — get platform config (admin only)

// ── Interest categories ───────────────────────────────────────────────────────
// GET /api/interest-categories — public list of active categories

// GET /api/admin/interest-categories — all categories including inactive (admin)

// POST /api/admin/interest-categories — create

// PUT /api/admin/interest-categories/:id — update

// DELETE /api/admin/interest-categories/:id — delete

// PATCH /api/admin/interest-categories/reorder — bulk update sort_order

// POST /api/admin/notify-all — broadcast a system notification to all (or targeted) users

// GET /api/admin/env-status — check which env vars are set (admin only, no values exposed)

// GET /api/admin/storage-stats — real-time uploads dir + DB size with configured limits (admin only)

// POST /api/admin/settings — save platform config (admin only)

// POST /api/admin/settings/reveal-key — verify admin password then return full key value

// GET /api/admin/mfa-users — list all users with MFA status (admin only)

// POST /api/admin/users/:userId/force-disable-mfa — force-disable MFA for a user (admin only)

// GET /api/admin/locked-users — list accounts locked due to brute-force (admin only)

// POST /api/admin/users/:userId/unlock — reset login lock for a user (admin only)

// ── Platform ads (admin-managed) ─────────────────────────────────────────────




// GET /api/admin/stats — platform statistics (admin only)

// GET /api/admin/stats/list — return a short list of records for a given stat type

// GET /api/admin/feed-weights — get current feed algorithm weights
// GET /api/admin/growth — daily new-user signups for the last N days (default 30)

// GET /api/admin/online-now — count of sessions active in the last 15 minutes

// GET /api/admin/banned-users — list all currently banned users

// GET /api/admin/users — search all users with full admin detail

// POST /api/admin/users/:id/force-logout — invalidate all sessions for a user

// DELETE /api/admin/users/:id — admin permanently deletes a user account

// GET /api/admin/audit-log — recent entries from audit_logs table


// POST /api/admin/feed-weights — update feed algorithm weights

// GET /api/admin/interest-stats — interest adoption statistics

// ── Events API ──

// GET /api/events — list all events with RSVP counts and current user's RSVP


// PUT /api/events/:id/rsvp — set RSVP for current user

// PATCH /api/events/:id — edit event (organizer only)

// DELETE /api/events/:id — delete event (organizer only)

// PATCH /api/profile/birthday — set or clear user's birthday

// ── Settings: Sessions ─────────────────────────────────────────────────────

// GET /api/calendar/events — fetch calendar data: friend birthdays + platform events


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

// POST /api/calendar/reminders — create a private reminder

// DELETE /api/calendar/reminders/:id — delete a reminder (owner only)


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
    // Live-reel columns (added by migrate-livereel-settings.sql; addCol here as safety net)
    await pool.query(`ALTER TABLE reels
      ADD COLUMN IF NOT EXISTS source      ENUM('upload','live') NOT NULL DEFAULT 'upload',
      ADD COLUMN IF NOT EXISTS title_da    VARCHAR(500) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS title_en    VARCHAR(500) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS shares_count INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tagged_users JSON DEFAULT NULL`).catch(() => {})
    // stream_key on users — unique token for RTMP authentication
    await pool.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_key VARCHAR(64) DEFAULT NULL'
    ).catch(() => {})
    // Livestreams table for tracking live recordings
    await pool.query(`CREATE TABLE IF NOT EXISTS livestreams (
      id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT          NOT NULL,
      started_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at       TIMESTAMP    NULL     DEFAULT NULL,
      recording_path VARCHAR(500) DEFAULT NULL,
      reel_file_url  VARCHAR(500) DEFAULT NULL,
      status         ENUM('live','ended','archived') NOT NULL DEFAULT 'live',
      INDEX idx_ls_user_id    (user_id),
      INDEX idx_ls_started_at (started_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(() => {})
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

// POST /api/reels — upload a reel

// POST /api/reels/:id/like — toggle like (supports reaction emoji)

// POST /api/reels/:id/share — increment share count

// GET /api/reels/:id/comments


// DELETE /api/reels/:id

// ── Viral Growth Routes ──

// GET /api/referrals/dashboard — referral stats + badges for current user

// GET /api/referrals/leaderboard — top inviters (public ranking)

// GET /api/badges — all badges available + which ones the user has earned

// GET /api/public/profile/:handle — public profile (no auth required)

// GET /api/public/post/:shareToken — public post view (no auth required)

// POST /api/posts/:id/share-token — generate/get share token for a post (makes it public)

// DELETE /api/posts/:id/share-token — revoke public access to a post

// PATCH /api/profile/public — toggle public profile visibility

// POST /api/share/track — track an external share event

// GET /api/admin/viral-stats — viral growth stats (admin only)

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

// POST /api/groups/:id/join — join a public group

// ── Heartbeat (online presence) ──────────────────────────────────────────────

// ── Config (public) ───────────────────────────────────────────────────────────



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


// POST /api/notifications/test — send a test notification to yourself (for debugging)


// GET /api/notifications/count — alias for unread-count (short form)



// GET /api/me/notification-preferences — get user's notification type preferences

// PUT /api/me/notification-preferences — save user's notification type preferences

// ── Feed category suggestion ──────────────────────────────────────────────────

// ── Jobs ──────────────────────────────────────────────────────────────────────

// ── CV Profile ────────────────────────────────────────────────────────────────
// GET /api/cv/profile — get full CV data for current user

// GET /api/cv/profile/:userId — public CV view (respects cv_public flag)

// PATCH /api/cv/visibility — toggle cv_public

// POST /api/cv/experience — add work experience entry

// PUT /api/cv/experience/:id — update work experience entry

// DELETE /api/cv/experience/:id — delete work experience entry

// POST /api/cv/education — add education entry

// PUT /api/cv/education/:id — update education entry

// DELETE /api/cv/education/:id — delete education entry

// GET /api/cv/languages — get user's language list

// POST /api/cv/languages — add a language

// PUT /api/cv/languages/:id — update language proficiency

// DELETE /api/cv/languages/:id — delete a language

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
reloadSharedKeywordFilters()

function checkKeywords(text) {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const f of keywordFilterCache) {
    if (lower.includes(f.keyword.toLowerCase())) return f
  }
  return null
}

// POST /api/users/:id/block — block a user

// DELETE /api/users/:id/block — unblock a user

// GET /api/me/blocks — get list of users I have blocked

// GET /api/admin/moderation/queue — get pending reports (moderator+)

// POST /api/admin/moderation/reports/:id/dismiss — dismiss a report

// POST /api/admin/moderation/content/remove — remove a post or comment

// POST /api/admin/moderation/users/:id/warn — issue a warning (strike)

// POST /api/admin/moderation/users/:id/suspend — suspend a user temporarily

// POST /api/admin/moderation/users/:id/ban — permanently ban a user

// POST /api/admin/moderation/users/:id/unban — lift a suspension or ban

// GET /api/admin/moderation/users — list users with moderation info (moderator+)

// GET /api/admin/moderation/keywords — list keyword filters

// POST /api/admin/moderation/keywords — add a keyword filter

// PATCH /api/admin/moderation/keywords/:id — update a keyword filter

// DELETE /api/admin/moderation/keywords/:id — remove a keyword filter

// GET /api/admin/moderation/actions — recent moderation audit log (moderator+)

// GET /api/admin/moderation/candidates — list moderator candidates

// PATCH /api/admin/moderation/users/:id/candidate — mark/unmark as moderator candidate

// ── User-facing moderator request flow ────────────────────────────────────────

// GET /api/moderation/my-request — get current user's own moderator request status

// POST /api/moderation/request — submit a moderator request

// DELETE /api/moderation/request — withdraw a moderator request

// ── Moderator management (admin, invite-only) ────────────────────────────────

// GET /api/admin/moderators — list current moderators

// POST /api/admin/moderators/:userId/grant — assign moderator status (invite)

// POST /api/admin/moderators/:userId/revoke — remove moderator status

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error(`[multer error] ${req.method} ${req.path}: ${err.code} – ${err.message}`)
    if (err.code === 'LIMIT_FILE_SIZE')  return res.status(413).json({ error: 'File too large (max 50 MB)' })
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files' })
    return res.status(400).json({ error: 'File upload error' })
  }
  if (err) {
    // Only expose safe, user-facing messages set by our own fileFilter callbacks.
    // All other internal errors get a generic response to avoid leaking details.
    const SAFE_MESSAGES = new Set(['File type not allowed', 'Invalid filename'])
    const msg = SAFE_MESSAGES.has(err.message) ? err.message : 'Bad request'
    console.error(`[middleware error] ${req.method} ${req.path}: ${err.message}`)
    return res.status(400).json({ error: msg })
  }
  next()
})

// Wildcard stub for client-only/unimplemented endpoints

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

// GET /api/easter-eggs — current user's discovered eggs from DB

// GET /api/admin/easter-eggs/config — fetch current admin egg config (admin only)

// PUT /api/admin/easter-eggs/config — save per-egg hint/enabled config (admin only)

// GET /api/easter-eggs/hints — public; returns eggs where admin enabled hints and set hint text

// GET /api/admin/easter-eggs/stats — per-egg stats (admin only)

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

// POST /api/badges/evaluate — compute stats, award new badges, return them

// GET /api/badges/earned — all earned badges for the current user

// GET /api/users/:id/badges — earned badges for any user (used for hover tooltips in feed)

// GET /api/badges/all — all badge definitions (for admin overview)

// ── Ad-Free Days: Badge-Based Rewards ─────────────────────────────────────────

// GET /api/adfree/bank — get user's banked ad-free days

// GET /api/adfree/assignments — get assigned ad-free date ranges (earned + purchased)

// GET /api/adfree/is-active — check if a specific date is ad-free (purchased priority)

// POST /api/adfree/assign — assign banked days to a date range

// GET /api/admin/badges/stats — admin badge statistics

// PATCH /api/admin/badges/:badgeId — enable/disable a badge

// Nominatim geocode proxy — avoids browser User-Agent restrictions and rate-limits by IP
let nominatimLastCall = 0

// Nominatim reverse geocode proxy — returns nearest address/venue for a lat/lng pair

// ── Business Features V2 ─────────────────────────────────────────────────────
// Adds: user leads, services catalog, partnerships, announcements, CVR verify

async function initBusinessFeaturesV2() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_user_id INT NOT NULL,
      sender_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      topic VARCHAR(200) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      status ENUM('new','responded','archived') NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ul_business (business_user_id),
      INDEX idx_ul_sender (sender_id),
      FOREIGN KEY (business_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS business_services (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name_da VARCHAR(200) NOT NULL,
      name_en VARCHAR(200) NOT NULL,
      description_da TEXT DEFAULT NULL,
      description_en TEXT DEFAULT NULL,
      price_from DECIMAL(10,2) DEFAULT NULL,
      price_to DECIMAL(10,2) DEFAULT NULL,
      image_url VARCHAR(500) DEFAULT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bs_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS business_partnerships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      requester_id INT NOT NULL,
      partner_id INT NOT NULL,
      status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bp_pair (requester_id, partner_id),
      INDEX idx_bp_requester (requester_id),
      INDEX idx_bp_partner (partner_id),
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await pool.query(`CREATE TABLE IF NOT EXISTS business_announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      author_id INT NOT NULL,
      title VARCHAR(300) NOT NULL,
      body TEXT NOT NULL,
      cta_url VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ba_author (author_id),
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

    await addCol('users', 'cvr_number', 'VARCHAR(20) DEFAULT NULL').catch(() => {})
    await addCol('users', 'is_verified', 'TINYINT(1) NOT NULL DEFAULT 0').catch(() => {})
    await addCol('users', 'cvr_company_name', 'VARCHAR(255) DEFAULT NULL').catch(() => {})
    // Service Spotlight: link a business_services entry to a feed post
    await pool.query(
      'ALTER TABLE posts ADD COLUMN IF NOT EXISTS linked_service_id INT DEFAULT NULL'
    ).catch(() => {
      // MySQL 8 < 8.0.29 doesn't support IF NOT EXISTS on ALTER TABLE ADD COLUMN
      return pool.query(
        'ALTER TABLE posts ADD COLUMN linked_service_id INT DEFAULT NULL'
      ).catch(() => {}) // ignore if already exists (errno 1060)
    })
  } catch (err) {
    console.error('initBusinessFeaturesV2 error:', err.message)
  }
}

// Run all schema-init functions BEFORE app.listen() so that ALTER TABLE
// metadata locks are fully released before the server accepts any HTTP traffic.
// Requests arriving while an ALTER TABLE holds a lock on e.g. `users` would
// hang indefinitely — moving inits before listen() eliminates that window.

// ── API 404 catch-all (must be before SPA fallback) ──
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'))
})

const PORT = process.env.PORT || 3001
;(async () => {
  await initNotifications()
  await initEvents()
  await initFriendRequests()
  await initConversations()
  await initMarketplace()
  await initCompanies()
  await initMollie()
  await initAdminSettings()
  await initAnalytics()
  await initSettingsSchema()
  await initSiteVisits()
  await initViralGrowth()
  await initReels()
  await initAds()
  await initAdminAdSettings()
  await initBusinessFeatures()
  await initBusinessFeaturesV2()
  await initEasterEggs()
  await initBadges()
  await initStoriesHashtags()
  await initSignalEngine()
  // RTMP is handled by mediamtx (external service on port 1935).
  // node-media-server startup is intentionally disabled to avoid port conflicts.
  console.log('fellis.eu startup init complete')

  app.listen(PORT, () => {
    console.log(`fellis.eu API running on http://localhost:${PORT}`)
  })
})().catch(err => {
  console.error('Startup init error — server will NOT start:', err)
  process.exit(1)
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

// DELETE /api/stories/:id — delete own story

// ── Explore ───────────────────────────────────────────────────────────────────
// GET /api/explore/trending-tags — top 10 hashtags last 48 hours

// GET /api/explore/trending — alias for trending-tags (short form)

// GET /api/explore/feed — trending posts platform-wide (excluding own posts)

// GET /api/users/suggested — 6 users not followed, sorted by follower count + shared interests

// GET /api/feed/suggested-posts — posts from non-friends ranked by tag overlap
// Primary signal: hashtags the current user has used in their own posts.
// Falls back to engagement-based ranking when the user has no hashtag history.

// ── Signal Engine — API endpoints ────────────────────────────────────────────

// POST /api/signals — batch ingest behavioral signals from the frontend
// Body: { signals: [{ signal_type, source_type?, source_id?, interest_slugs?, context? }] }
// If interest_slugs is omitted and source_type='post', categories are resolved server-side.

// GET /api/me/interest-graph — user's full interest graph with computed weights

// PATCH /api/me/interest-graph/:slug — user manually corrects an interest weight

// GET /api/me/interest-graph/signal-stats — recent signal counts for transparency UI

// ── Livestream admin settings ─────────────────────────────────────────────────

// ── Stream key endpoints ──────────────────────────────────────────────────────

// GET /api/me/stream-key — get (or auto-generate) the caller's RTMP stream key

// POST /api/me/stream-key/regenerate — issue a new stream key (invalidates old one)

// GET /api/livestream/status — public: is live streaming enabled on this platform?

// GET /api/admin/livestream/settings — get streaming + reel duration limits + enabled flag

// POST /api/admin/livestream/settings — update streaming + reel duration limits + enabled flag

// GET /api/admin/livestream/stats — real livestream statistics (admin only)

// ── mediamtx / RTMP streaming routes ─────────────────────────────────────────

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/var/recordings'

/**
 * Generate a random 32-character hex stream key.
 */
function generateStreamKey() {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * POST /api/stream/auth
 * Called by mediamtx on_publish hook when a client starts publishing.
 * Body (mediamtx v3): { action, id, name, query, sourceType, sourceID }
 * The `name` field is the RTMP path, which equals the user's stream_key.
 *
 * Returns 200 to allow the stream, 401 to reject it.
 */

/**
 * POST /api/stream/end
 * Called by mediamtx on_done hook when a publisher disconnects.
 * Body: { action, id, name, ... }  — `name` equals the stream_key.
 *
 * Updates livestreams, triggers ffmpeg encode, inserts reel.
 */

/**
 * GET /api/stream/active
 * Returns currently active streams from mediamtx, enriched with user info.
 * Requires authentication.
 */

/**
 * GET /api/stream/key
 * Returns the current user's stream key, creating one if it doesn't exist yet.
 */

/**
 * POST /api/stream/key/regenerate
 * Generates a new random stream key for the authenticated user.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ── NEW FEATURES ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Run migration for new feature tables on startup
async function initNewFeatures() {
  try {
    const migPath = path.join(__dirname, 'migrate-new-features.sql')
    if (!fs.existsSync(migPath)) return
    const sql = fs.readFileSync(migPath, 'utf8')
    // Split on semicolons, filter empties and comments
    const statements = sql.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 5 && !s.startsWith('--'))
    for (const stmt of statements) {
      await pool.query(stmt).catch(() => {}) // ignore if already exists
    }
  } catch (err) {
    console.warn('initNewFeatures:', err.message)
  }
}
initNewFeatures()

// ── Share / Repost ────────────────────────────────────────────────────────────



// ── Saved posts / Bookmarks ───────────────────────────────────────────────────




// ── Polls ─────────────────────────────────────────────────────────────────────




// ── Nested comment replies ────────────────────────────────────────────────────



// ── Message reactions ─────────────────────────────────────────────────────────



// ── Profile cover photo ───────────────────────────────────────────────────────

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg'
      cb(null, `cover_${req.userId}_${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'))
    cb(null, true)
  },
})



// ── Pinned post ───────────────────────────────────────────────────────────────


// ── Hashtag follows ───────────────────────────────────────────────────────────




// ── Story highlights ──────────────────────────────────────────────────────────






// ── Story reactions ───────────────────────────────────────────────────────────



// ── Event ICS export ──────────────────────────────────────────────────────────


// ── Marketplace wishlist ──────────────────────────────────────────────────────




// ── Marketplace price offers ──────────────────────────────────────────────────




// ── Job alerts ────────────────────────────────────────────────────────────────




// ── Marketplace keyword alerts ───────────────────────────────────────────────





// ── Company reviews ───────────────────────────────────────────────────────────




// ── Company business hours ────────────────────────────────────────────────────



// ── Company Q&A ───────────────────────────────────────────────────────────────





// ── Profile portfolio ─────────────────────────────────────────────────────────






// ── Post → reel conversion ────────────────────────────────────────────────────


// ── Reel → feed share ─────────────────────────────────────────────────────────


// ── Blog ─────────────────────────────────────────────────────────────────────








// ── Discovery Feed Cards ───────────────────────────────────────────────────────

// GET /api/feed/discovery — 3–5 mixed suggestions (users, businesses, groups) not yet followed

// ── Business Features V2 Routes ──────────────────────────────────────────────

// ── Feature 1: User Leads / Contact inbox for business accounts ──

// POST /api/businesses/:id/contact — submit an inquiry to a business-mode user

// GET /api/me/business-leads — get incoming leads for my business account

// PATCH /api/me/business-leads/:id — update lead status

// ── Feature 2: Jobs linked to business profile ──

// GET /api/businesses/:id/jobs — jobs from companies the business user manages

// ── Feature 3: Business verification (CVR) ──

// Validate a CVR number using the Danish modulo-11 checksum algorithm.
// Weights: 2 7 6 5 4 3 2 1 — sum of (digit * weight) must be divisible by 11.
// This confirms the number is a mathematically valid CVR without any external call.
function isValidCVRChecksum(cvr) {
  const weights = [2, 7, 6, 5, 4, 3, 2, 1]
  const digits = cvr.split('').map(Number)
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  return sum % 11 === 0
}

// Helper: look up a CVR number against the Danish registry (cvrapi.dk)
// Returns: { name, city, industry } on success
//          'unavailable'  for any non-positive result (404, 429, 5xx, network error, missing data)
// NOTE: cvrapi.dk has incomplete coverage (e.g. foreign entities / UE type are not indexed),
// so a 404 from their API does NOT mean the CVR is invalid — treat all failures as unconfirmed.
async function lookupCVR(cvr) {
  const token = process.env.CVRAPI_TOKEN
  const url = `https://cvrapi.dk/api?country=dk&search=${encodeURIComponent(cvr)}&useragent=fellis.eu${token ? `&token=${encodeURIComponent(token)}` : ''}`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`lookupCVR: HTTP ${res.status} from cvrapi.dk for CVR ${cvr}`)
      return { unavailable: true, status: res.status }
    }

    const data = await res.json()
    console.log(`lookupCVR: cvrapi.dk response for ${cvr}:`, JSON.stringify(data).slice(0, 200))

    if (data.error && data.error !== false) return { unavailable: true, status: 200, apiError: data.error }
    if (!data.name) return { unavailable: true, status: 200, apiError: 'no name' }

    return { name: data.name, city: data.city || null, industry: data.industrydesc || null }
  } catch (err) {
    console.warn(`lookupCVR: fetch failed for CVR ${cvr}:`, err.message)
    return { unavailable: true, status: 0, apiError: err.message }
  }
}

// GET /api/me/verify-business/lookup?cvr=XXXXXXXX — preview company name before submitting

// POST /api/me/verify-business — submit CVR for verification
// Auto-approves when registry confirms the CVR; falls back to pending when API is unavailable.

// GET /api/admin/verify-business — list verified businesses (admin overview)

// POST /api/admin/verify-business/:userId — manually override verification status

// ── Feature 4: Follower Broadcast Announcements ──

// POST /api/me/announcements — create an announcement (business accounts only)

// GET /api/me/announcements — get my own announcements

// GET /api/announcements — get announcements from businesses I follow

// DELETE /api/me/announcements/:id — delete an announcement

// ── Feature 5: Product / Services Catalog ──

// GET /api/businesses/:id/services — public services list for a business

// GET /api/me/services — get my services

// POST /api/me/services — create a service

// PUT /api/me/services/:id — update a service

// DELETE /api/me/services/:id — delete a service

// ── Feature 6: Business Event Promotion ──

// GET /api/businesses/:id/events — events organised by this business user

// ── Feature 7: Analytics Depth — follower growth + best post times ──

// GET /api/me/analytics/follower-growth — follower count per day for last N days

// GET /api/me/analytics/best-times — engagement heatmap by hour/day of week

// ── Feature 8: Service Endorsements (reuse skill_endorsements) ──

// GET /api/businesses/:id/endorsements — skills + endorsement counts for a business user

// ── Feature 9: B2B Partner Connections ──

// POST /api/businesses/:id/partner-request — send a B2B partner request

// GET /api/me/partner-requests — incoming pending B2B partner requests

// PATCH /api/me/partner-requests/:id — accept or decline a B2B partner request

// GET /api/me/partners — my accepted B2B partners

// DELETE /api/me/partners/:partnerId — remove a B2B partner

// GET /api/businesses/:id/partners — public partner list for a business profile

// ── Feature 10: Appointment / Inquiry via DM ──

// POST /api/businesses/:id/inquiry — send a meeting request (creates a DM conversation)
