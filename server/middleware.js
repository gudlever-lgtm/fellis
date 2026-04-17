import { fileURLToPath } from 'url'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { rateLimit as rlFactory, ipKeyGenerator } from 'express-rate-limit'
import pool from './db.js'
import { sendSms } from './sms.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Server start time ──
const SERVER_START = Date.now()

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

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return xff.split(',')[0].trim()
  // RFC 7239 Forwarded header (lighttpd proxy.forwarded = ( "for" => 1 ))
  // Format: "for=1.2.3.4" or "for=\"[2001:db8::1]\""
  const fwd = req.headers['forwarded']
  if (fwd) {
    const m = fwd.match(/(?:^|[,\s])for=(?:"?\[?)([0-9a-fA-F.:]+)/i)
    if (m?.[1]) return m[1]
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1'
}

function isLoopback(req) {
  const ip = getClientIp(req)
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
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  skip: skipInDev,
})

// Register: 3 per hour per IP
const registerLimit = rlFactory({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts — prøv igen om en time' },
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  skip: skipInDev,
})

// General API: 100 per 15 minutes per IP
const generalLimit = rlFactory({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — prøv igen om lidt' },
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
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

const visitedAnonIps = new Set() // in-memory: anonymous IPs tracked this server process day

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

const oauthStateTokens = new Map()
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000 // 10-minute TTL
  for (const [k, v] of oauthStateTokens) {
    if (v.createdAt < cutoff) oauthStateTokens.delete(k)
  }
}, 15 * 60 * 1000)


// ── Mollie ───────────────────────────────────────────────────────────────────
async function getMollieKey() {
  // 1. DB admin_settings takes priority — respects keys set via admin UI without server restart
  try {
    const [[row]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'mollie_api_key'")
    if (row?.key_value && !row.key_value.includes('•')) return row.key_value
  } catch {}
  // 2. Process env (set at startup from .env file)
  const envKey = (process.env.MOLLIE_API_KEY || '').replace(/^["']|["']$/g, '').trim()
  if (envKey) return envKey
  // 3. Re-read .env file directly as fallback (handles PM2 env not updating)
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

// EUR/DKK exchange rate cache — MobilePay only accepts DKK
let _eurDkkRate = null
let _eurDkkCachedAt = 0
const EUR_DKK_CACHE_TTL = 3600 * 1000 // 1 hour

async function fetchEurDkkRate() {
  if (_eurDkkRate && Date.now() - _eurDkkCachedAt < EUR_DKK_CACHE_TTL) return _eurDkkRate
  const resp = await fetch('https://api.frankfurter.app/latest?from=EUR&to=DKK', { signal: AbortSignal.timeout(5000) })
  if (!resp.ok) throw new Error(`Exchange rate API returned ${resp.status}`)
  const data = await resp.json()
  const rate = data?.rates?.DKK
  if (!rate || typeof rate !== 'number') throw new Error('No DKK rate in response')
  _eurDkkRate = rate
  _eurDkkCachedAt = Date.now()
  return rate
}


// ── Exports ──────────────────────────────────────────────────────────────────
export {
  // Time formatters
  formatPostTime, formatMsgTime,
  
  // Auth/session
  getSessionIdFromRequest, setSessionCookie, clearSessionCookie,
  generateCsrfToken, verifyCsrfToken, validateCsrf, CSRF_EXEMPT_PATHS,
  authenticate,
  
  // Rate limiters
  strictLimit, registerLimit, writeLimit, fileUploadLimit, generalLimit,
  
  // Authorization middleware
  requireAdmin, requireModerator, requireBusiness, attachUserMode,
  
  // Upload middleware
  upload, uploadDoc, reelUpload, coverUpload,
  storage, UPLOAD_FILES_CEILING,
  
  // Signal engine
  applySignals, autoSignalPost, SIGNAL_VALUES, CONTEXT_MULTIPLIERS,
  
  // Rate limit helpers
  checkInviteRateLimit, checkForgotRateLimit,
  
  // Badge helpers
  checkAndAwardBadges, BADGE_THRESHOLDS,
  
  // GDPR helpers
  auditLogGdpr, hasConsent, recordConsent, withdrawConsent,
  
  // Audit log
  auditLog,
  
  // SSE
  sseClients, sseAdd, sseRemove, sseBroadcast,
  
  // Geo/browser
  parseBrowser, getGeoForIp,
  
  // Notifications
  createNotification,
  
  // Password/validation
  getPasswordPolicy, validatePasswordStrength,
  validateMagicBytes, ALLOWED_MIME_TYPES, ALLOWED_DOC_MIME_TYPES,
  
  // Constants
  UPLOADS_DIR, MISTRAL_API_KEY,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  COOKIE_NAME, SERVER_START,
  
  // State
  visitedSessions, visitedAnonIps, oauthStateTokens,
  
  // Mailer
  mailer,

  // Mollie + currency
  getMollieKey, getMollieClient, fetchEurDkkRate,
}
