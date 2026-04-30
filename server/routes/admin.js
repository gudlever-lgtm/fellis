import express from 'express'
import pool from '../db.js'
import { sendSms } from '../sms.js'
import { validate, schemas } from '../validation.js'
import { BADGES, BADGE_BY_ID, PLATFORM_LAUNCH_DATE, BADGE_AD_FREE_DAYS } from '../../src/badges/badgeDefinitions.js'
import { evaluateBadges } from '../../src/badges/badgeEngine.js'
import {
  authenticate, writeLimit, fileUploadLimit, strictLimit, registerLimit,
  requireAdmin, requireModerator, requireBusiness, attachUserMode,
  upload, uploadDoc, reelUpload, coverUpload,
  formatPostTime, formatMsgTime, applySignals, autoSignalPost,
  checkInviteRateLimit, checkForgotRateLimit, checkAndAwardBadges,
  createNotification, auditLog, auditLogGdpr, hasConsent, recordConsent, withdrawConsent,
  getSessionIdFromRequest, setSessionCookie, clearSessionCookie, generateCsrfToken,
  validateMagicBytes, validatePasswordStrength, getPasswordPolicy,
  sseBroadcast, sseAdd, sseRemove, sseClients,
  parseBrowser, getGeoForIp,
  UPLOADS_DIR, MISTRAL_API_KEY, UPLOAD_FILES_CEILING,
  mailer, oauthStateTokens,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  COOKIE_NAME, SERVER_START, visitedSessions, visitedAnonIps,
} from '../middleware.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from '../livestream.js'
import { invalidateMediaMaxFilesCache, reloadKeywordFilters, callMistral } from '../helpers.js'

const router = express.Router()

// Feed weight cache (admin routes only)
let _feedWeightsCache = null
let _feedWeightsCacheTime = 0
async function getFeedWeights() {
  if (_feedWeightsCache && Date.now() - _feedWeightsCacheTime < 5 * 60 * 1000) return _feedWeightsCache
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('feed_weight_family','feed_weight_interest','feed_weight_recency','feed_weight_engagement')"
    )
    const w = { family: 1000, interest: 100, recency: 50, engagement: 10 }
    for (const r of rows) {
      const k = r.key_name.replace('feed_weight_', '')
      const v = parseFloat(r.key_value)
      if (!isNaN(v) && v >= 0) w[k] = v
    }
    _feedWeightsCache = w
    _feedWeightsCacheTime = Date.now()
    return w
  } catch { return { family: 1000, interest: 100, recency: 50, engagement: 10 } }
}

router.get('/admin/ad-settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM admin_ad_settings WHERE id = 1')
    if (!row) return res.status(404).json({ error: 'Settings not found' })
    res.json({ settings: row })
  } catch (err) {
    console.error('GET /api/admin/ad-settings error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/admin/ad-settings', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['adfree_price_private', 'adfree_price_business', 'ad_price_cpm', 'boost_price', 'currency', 'max_ads_feed', 'max_ads_sidebar', 'max_ads_stories', 'refresh_interval_seconds', 'ads_enabled', 'adfree_recurring_pct', 'ad_recurring_pct', 'adfree_annual_discount_pct']
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


router.get('/admin/ad-stats', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/settings', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/interest-categories', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM interest_categories ORDER BY sort_order, da'
    )
    res.json({ categories: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


router.post('/admin/interest-categories', authenticate, requireAdmin, async (req, res) => {
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


router.put('/admin/interest-categories/:id', authenticate, requireAdmin, async (req, res) => {
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


router.delete('/admin/interest-categories/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM interest_categories WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


router.patch('/admin/interest-categories/reorder', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/notify-all', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/env-status', authenticate, requireAdmin, async (req, res) => {
  const ENV_VARS = [
    'MOLLIE_API_KEY',
    'MAIL_HOST', 'MAIL_USER',
    '46ELKS_USERNAME',
    'MISTRAL_API_KEY',
    'UPLOADS_DIR',
  ]
  const status = {}
  for (const v of ENV_VARS) status[v] = !!process.env[v]
  // OAuth providers: require both ID and secret to be considered configured
  status['GOOGLE_OAUTH'] = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  status['LINKEDIN_OAUTH'] = !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
  res.json({ status })
})


router.get('/admin/storage-stats', authenticate, requireAdmin, async (req, res) => {
  async function getDirSize(dirPath) {
    let total = 0
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          total += await getDirSize(fullPath)
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(fullPath)
          total += stat.size
        }
      }
    } catch {}
    return total
  }
  try {
    const uploadsDir = process.env.UPLOADS_DIR || '/var/www/fellis.eu/uploads'
    const uploadsBytes = await getDirSize(uploadsDir)
    const [[dbRow]] = await pool.query(
      `SELECT SUM(data_length + index_length) AS size_bytes FROM information_schema.tables WHERE table_schema = DATABASE()`
    )
    const dbBytes = Number(dbRow?.size_bytes || 0)
    const [rows] = await pool.query(
      `SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('uploads_max_gb', 'db_max_gb')`
    )
    const settings = Object.fromEntries(rows.map(r => [r.key_name, r.key_value]))
    res.json({
      uploads_bytes: uploadsBytes,
      db_bytes: dbBytes,
      uploads_max_gb: settings.uploads_max_gb || '100',
      db_max_gb: settings.db_max_gb || '10',
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get storage stats' })
  }
})


router.post('/admin/settings', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['pwd_min_length', 'pwd_require_uppercase', 'pwd_require_lowercase', 'pwd_require_numbers', 'pwd_require_symbols', 'media_max_files', 'marketplace_max_photos', 'registration_open', 'mollie_api_key', 'uploads_max_gb', 'db_max_gb', 'feedback_placement']
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue
      // pwd_, media_, registration_, uploads_, db_ keys are always saved (value can be '0'/'')
      const alwaysSave = key.startsWith('pwd_') || key.startsWith('media_') || key.startsWith('registration_') || key.startsWith('uploads_') || key.startsWith('db_') || key === 'feedback_placement'
      if (!alwaysSave) {
        if (!value || value === '••••••••' + (value || '').slice(-4)) continue // skip masked/empty
        if (key === 'mollie_api_key' && value.includes('•')) continue // skip masked display value
      }
      await pool.query('INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', [key, value])
    }
    // Invalidate cached settings so new values take effect immediately
    invalidateMediaMaxFilesCache()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' })
  }
})


router.post('/admin/settings/reveal-key', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/mfa-users', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/users/:userId/force-disable-mfa', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/locked-users', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/users/:userId/unlock', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/platform-ads', authenticate, requireAdmin, async (req, res) => {
  try {
    const [ads] = await pool.query(
      'SELECT * FROM platform_ads ORDER BY created_at DESC'
    ).catch(() => [[]])
    res.json({ ads })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/platform-ads', authenticate, requireAdmin, async (req, res) => {
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


router.put('/admin/platform-ads/:id', authenticate, requireAdmin, async (req, res) => {
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


router.delete('/admin/platform-ads/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    await pool.query('DELETE FROM platform_ads WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/stats/list', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/growth', authenticate, requireAdmin, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90)
  try {
    const [rows] = await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) as count
       FROM users
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [days]
    )
    // Fill in zeros for days with no signups
    const map = {}
    for (const r of rows) map[r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10)] = Number(r.count)
    const result = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      result.push({ day: key, count: map[key] || 0 })
    }
    res.json({ days: result })
  } catch (err) {
    console.error('GET /api/admin/growth error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/online-now', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[{ online }]] = await pool.query(
      "SELECT COUNT(DISTINCT user_id) as online FROM sessions WHERE last_active >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)"
    ).catch(async () => {
      // Fallback: last_active column may not exist — count sessions created/refreshed recently
      const [[r]] = await pool.query(
        "SELECT COUNT(DISTINCT user_id) as online FROM sessions WHERE expires_at > NOW()"
      )
      return [[r]]
    })
    res.json({ online: Number(online) })
  } catch (err) {
    console.error('GET /api/admin/online-now error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/banned-users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.email, u.mode, u.strike_count,
              ma.reason, ma.created_at as banned_at, ma.actor_id,
              admin_u.name as banned_by
       FROM users u
       LEFT JOIN moderation_actions ma ON ma.target_user_id = u.id AND ma.action_type = 'ban'
         AND ma.created_at = (SELECT MAX(ma2.created_at) FROM moderation_actions ma2 WHERE ma2.target_user_id = u.id AND ma2.action_type = 'ban')
       LEFT JOIN users admin_u ON admin_u.id = ma.actor_id
       WHERE u.status = 'banned'
       ORDER BY ma.created_at DESC`
    ).catch(async () => {
      // Fallback if moderation_actions doesn't have the expected columns
      const [r] = await pool.query(
        `SELECT id, name, handle, email, mode, strike_count FROM users WHERE status = 'banned' ORDER BY id DESC`
      )
      return [r]
    })
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/admin/banned-users error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : '%'
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.email, u.mode, u.plan, u.status,
              u.strike_count, u.suspended_until, u.is_moderator,
              u.mfa_enabled, u.created_at,
              (u.id = 1) AS is_admin,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions,
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS post_count
       FROM users u
       WHERE (u.name LIKE ? OR u.handle LIKE ? OR u.email LIKE ? OR u.id = ?)
       ORDER BY u.created_at DESC
       LIMIT 50`,
      [q, q, q, parseInt(req.query.q) || 0]
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/admin/users error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/users/:id/force-logout', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (!targetId) return res.status(400).json({ error: 'Invalid user id' })
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetId])
    await auditLog(req, 'admin_force_logout', 'user', targetId)
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/users/:id/force-logout error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (!targetId) return res.status(400).json({ error: 'Invalid user id' })
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot delete your own account' })
  try {
    const [[user]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [targetId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    await auditLog(req, 'admin_delete_user', 'user', targetId, { details: { name: user.name, email: user.email } })
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetId])
    await pool.query('DELETE FROM users WHERE id = ?', [targetId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/admin/users/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/audit-log', authenticate, requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200)
  const offset = parseInt(req.query.offset) || 0
  const { action, userId } = req.query
  try {
    const conditions = []
    const params = []
    if (action) { conditions.push('al.action = ?'); params.push(action) }
    if (userId) { conditions.push('al.user_id = ?'); params.push(parseInt(userId)) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query(
      `SELECT al.id, al.user_id, u.name as user_name, u.email as user_email,
              al.action, al.resource_type, al.resource_id,
              al.status, al.ip_address, al.created_at,
              al.details
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM audit_logs al ${where}`,
      params
    )
    res.json({ rows, total: Number(total), limit, offset })
  } catch (err) {
    console.error('GET /api/admin/audit-log error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/feed-weights', authenticate, requireAdmin, async (req, res) => {
  const weights = await getFeedWeights()
  res.json({ weights })
})


router.post('/admin/feed-weights', authenticate, requireAdmin, async (req, res) => {
  const { family, interest, recency, engagement } = req.body
  const entries = [['feed_weight_family', family], ['feed_weight_interest', interest], ['feed_weight_recency', recency], ['feed_weight_engagement', engagement]]
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


router.get('/admin/interest-stats', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/viral-stats', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/feedback', authenticate, requireAdmin, async (req, res) => {
  const status = req.query.status || null
  try {
    const where = status ? 'WHERE f.status = ?' : ''
    const params = status ? [status] : []
    const [rows] = await pool.query(
      `SELECT f.id, f.type, f.title, f.description, f.status, f.admin_note,
              f.created_at, f.updated_at, u.name AS user_name, u.handle AS user_handle
       FROM platform_feedback f
       JOIN users u ON u.id = f.user_id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT 200`,
      params
    )
    res.json({ feedback: rows })
  } catch (err) {
    console.error('GET /api/admin/feedback error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/admin/feedback/:id', authenticate, requireAdmin, async (req, res) => {
  const { status, admin_note } = req.body
  const validStatuses = ['new', 'reviewing', 'planned', 'done', 'declined']
  if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const fields = []
    const params = []
    if (status) { fields.push('status = ?'); params.push(status) }
    if (admin_note !== undefined) { fields.push('admin_note = ?'); params.push(admin_note || null) }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
    params.push(req.params.id)
    await pool.query(`UPDATE platform_feedback SET ${fields.join(', ')} WHERE id = ?`, params)
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/admin/feedback/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/moderation/queue', authenticate, requireModerator, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
              u.name AS reporter_name, u.handle AS reporter_handle
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN posts p ON p.id = r.target_id AND r.target_type = 'post'
       LEFT JOIN comments c ON c.id = r.target_id AND r.target_type = 'comment'
       LEFT JOIN posts cp ON cp.id = c.post_id
       WHERE r.status = 'pending'
         AND (r.target_type != 'post' OR p.group_id IS NULL)
         AND (r.target_type != 'comment' OR cp.group_id IS NULL)
       ORDER BY r.created_at ASC
       LIMIT 100`
    )
    // For each report, fetch a preview of the target
    const enriched = await Promise.all(rows.map(async (r) => {
      let preview = null
      try {
        if (r.target_type === 'post') {
          const [[p]] = await pool.query('SELECT p.text_da, p.text_en, p.user_mode, u.name AS author FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?', [r.target_id])
          preview = p || null
          // Non-admins cannot act on business posts — skip them
          if (p?.user_mode === 'business' && !req.adminRole) return null
        } else if (r.target_type === 'comment') {
          const [[c]] = await pool.query('SELECT c.text_da, c.text_en, u.name AS author, c.post_id FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?', [r.target_id])
          preview = c || null
        } else if (r.target_type === 'reel_comment') {
          const [[rc]] = await pool.query('SELECT rc.text AS text_da, rc.text AS text_en, u.name AS author, rc.reel_id FROM reel_comments rc JOIN users u ON u.id = rc.user_id WHERE rc.id = ?', [r.target_id])
          preview = rc || null
        } else if (r.target_type === 'message') {
          const [[m]] = await pool.query('SELECT m.text_da, m.text_en, u.name AS author, m.conversation_id FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?', [r.target_id])
          preview = m || null
        } else if (r.target_type === 'user') {
          const [[u]] = await pool.query('SELECT name, handle, status, strike_count FROM users WHERE id = ?', [r.target_id])
          preview = u || null
        }
      } catch { /* ignore */ }
      return { ...r, preview }
    }))
    res.json({ reports: enriched.filter(Boolean) })
  } catch (err) {
    console.error('GET /api/admin/moderation/queue error:', err)
    res.status(500).json({ error: 'Failed to load moderation queue' })
  }
})


router.post('/admin/moderation/reports/:id/dismiss', authenticate, requireModerator, async (req, res) => {
  const reportId = parseInt(req.params.id)
  if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid report ID' })
  try {
    // Business post reports require admin
    const [[report]] = await pool.query('SELECT target_type, target_id FROM reports WHERE id = ?', [reportId])
    if (report?.target_type === 'post') {
      const [[post]] = await pool.query('SELECT user_mode FROM posts WHERE id = ?', [report.target_id])
      if (post?.user_mode === 'business' && !req.adminRole) {
        return res.status(403).json({ error: 'admin_required_for_business_posts' })
      }
    }
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


const MODERATED_TABLES = ['posts', 'comments', 'reels', 'stories', 'events', 'marketplace_listings', 'jobs', 'company_posts', 'conversations']

router.get('/admin/moderation/flagged', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT q.table_name, q.id, q.mod_note, q.created_at, q.user_id,
              u.name AS username, u.email
       FROM (
         SELECT 'posts' AS table_name, id, mod_note, created_at, author_id AS user_id FROM posts WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'comments', id, mod_note, created_at, author_id FROM comments WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'reels', id, mod_note, created_at, user_id FROM reels WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'stories', id, mod_note, created_at, user_id FROM stories WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'events', id, mod_note, created_at, organizer_id FROM events WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'marketplace_listings', id, mod_note, created_at, user_id FROM marketplace_listings WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'jobs', id, mod_note, created_at, NULL FROM jobs WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'company_posts', id, mod_note, created_at, author_id FROM company_posts WHERE mod_status = 'flagged'
         UNION ALL
         SELECT 'conversations', id, mod_note, created_at, created_by FROM conversations WHERE mod_status = 'flagged' AND is_group = 1
       ) q
       LEFT JOIN users u ON u.id = q.user_id
       ORDER BY q.created_at DESC
       LIMIT 50`
    )
    res.json({ flagged: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/flagged error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/admin/moderation/:table/:id', authenticate, requireAdmin, async (req, res) => {
  const { table, id } = req.params
  const { status, note } = req.body
  if (!MODERATED_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' })
  if (!['active', 'removed'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  const numId = parseInt(id)
  if (isNaN(numId)) return res.status(400).json({ error: 'Invalid id' })
  try {
    await pool.query(
      `UPDATE \`${table}\` SET mod_status = ?, mod_note = ?, mod_reviewed_by = ?, mod_reviewed_at = NOW() WHERE id = ?`,
      [status, note || null, req.userId, numId]
    )
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
       VALUES (?, 'moderation_decision', ?, ?, ?)`,
      [req.userId, table, numId, JSON.stringify({ table, id: numId, status, note })]
    )
    const [[updated]] = await pool.query(`SELECT * FROM \`${table}\` WHERE id = ?`, [numId])
    res.json({ ok: true, updated })
  } catch (err) {
    console.error('PATCH /api/admin/moderation/:table/:id error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/moderation/content/remove', authenticate, requireModerator, async (req, res) => {
  const { type, target_id, report_id, reason } = req.body
  if (!['post', 'comment', 'reel_comment'].includes(type) || !target_id) return res.status(400).json({ error: 'Invalid type or target_id' })
  try {
    // Business post moderation requires admin
    if (type === 'post') {
      const [[post]] = await pool.query('SELECT user_mode FROM posts WHERE id = ?', [target_id])
      if (post?.user_mode === 'business' && !req.adminRole) {
        return res.status(403).json({ error: 'admin_required_for_business_posts' })
      }
    }
    const tableMap = { post: 'posts', comment: 'comments', reel_comment: 'reel_comments' }
    await pool.query(`DELETE FROM ${tableMap[type]} WHERE id = ?`, [target_id])
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


router.post('/admin/moderation/users/:id/warn', authenticate, requireModerator, async (req, res) => {
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


router.post('/admin/moderation/users/:id/suspend', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/moderation/users/:id/ban', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/moderation/users/:id/unban', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/moderation/users', authenticate, requireModerator, async (req, res) => {
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


router.get('/admin/moderation/keywords', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, keyword, action, category, notes, created_at FROM keyword_filters ORDER BY created_at DESC')
    res.json({ keywords: rows })
  } catch (err) {
    console.error('GET /api/admin/moderation/keywords error:', err)
    res.status(500).json({ error: 'Failed to load keyword filters' })
  }
})


router.post('/admin/moderation/keywords', authenticate, requireAdmin, async (req, res) => {
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


router.patch('/admin/moderation/keywords/:id', authenticate, requireAdmin, async (req, res) => {
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


router.delete('/admin/moderation/keywords/:id', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/moderation/actions', authenticate, requireModerator, async (req, res) => {
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


router.get('/admin/moderation/candidates', authenticate, requireAdmin, async (req, res) => {
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


router.patch('/admin/moderation/users/:id/candidate', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/moderators', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/moderators/:userId/grant', authenticate, requireAdmin, async (req, res) => {
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


router.post('/admin/moderators/:userId/revoke', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/easter-eggs/config', authenticate, requireAdmin, async (req, res) => {
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


router.put('/admin/easter-eggs/config', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/easter-eggs/stats', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/badges/stats', authenticate, requireAdmin, async (req, res) => {
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


router.patch('/admin/badges/:badgeId', authenticate, requireAdmin, async (req, res) => {
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


router.get('/admin/livestream/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('streaming_max_duration_seconds','reel_max_duration_seconds','livestream_enabled')"
    )
    const settings = {
      streaming_max_duration_seconds: LIVESTREAM_DEFAULTS.streaming_max_duration_seconds,
      reel_max_duration_seconds: LIVESTREAM_DEFAULTS.reel_max_duration_seconds,
      livestream_enabled: false,
    }
    for (const row of rows) {
      if (row.key_name === 'livestream_enabled') {
        settings.livestream_enabled = row.key_value === '1'
      } else {
        const v = parseInt(row.key_value, 10)
        if (Number.isFinite(v) && v > 0) settings[row.key_name] = v
      }
    }
    // Check whether ffmpeg is available on this server
    let ffmpegAvailable = false
    try {
      await import('child_process').then(({ execFile }) =>
        new Promise(resolve => execFile('ffmpeg', ['-version'], resolve))
      )
      ffmpegAvailable = true
    } catch { ffmpegAvailable = false }

    // Check whether mediamtx is running (probes its REST API on port 9997)
    let mediamtxAvailable = false
    try {
      const r = await fetch('http://localhost:9997/v3/paths/list', { signal: AbortSignal.timeout(1500) })
      mediamtxAvailable = r.ok
    } catch { mediamtxAvailable = false }

    const siteUrl  = process.env.SITE_URL || 'https://fellis.eu'
    const rtmpHost = (() => { try { return new URL(siteUrl).hostname } catch { return 'localhost' } })()
    res.json({
      settings,
      server: { ffmpeg: ffmpegAvailable, mediamtx: mediamtxAvailable, rtmp_port: RTMP_PORT, rtmp_url: `rtmp://${rtmpHost}:${RTMP_PORT}/live` },
    })
  } catch (err) {
    console.error('GET /api/admin/livestream/settings error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/livestream/settings', authenticate, requireAdmin, async (req, res) => {
  const { streaming_max_duration_seconds, reel_max_duration_seconds, livestream_enabled } = req.body
  const toSave = []
  const streamSecs = parseInt(streaming_max_duration_seconds, 10)
  const reelSecs   = parseInt(reel_max_duration_seconds, 10)
  if (Number.isFinite(streamSecs) && streamSecs > 0) toSave.push(['streaming_max_duration_seconds', String(streamSecs)])
  if (Number.isFinite(reelSecs)   && reelSecs   > 0) toSave.push(['reel_max_duration_seconds',      String(reelSecs)])
  if (livestream_enabled !== undefined) toSave.push(['livestream_enabled', livestream_enabled ? '1' : '0'])
  if (toSave.length === 0) return res.status(400).json({ error: 'No valid settings provided' })
  try {
    for (const [key, value] of toSave) {
      await pool.query(
        'INSERT INTO admin_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)',
        [key, value]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/livestream/settings error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/livestream/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    // Aggregate counts
    const [[counts]] = await pool.query(`
      SELECT
        COUNT(*)                                                      AS total_streams,
        SUM(status = 'live')                                          AS currently_live,
        SUM(status = 'ended')                                         AS ended_streams,
        SUM(status = 'archived')                                      AS archived_streams,
        SUM(started_at >= NOW() - INTERVAL 7  DAY)                   AS streams_7d,
        SUM(started_at >= NOW() - INTERVAL 30 DAY)                   AS streams_30d,
        SUM(reel_file_url IS NOT NULL)                                AS with_reel,
        ROUND(AVG(TIMESTAMPDIFF(SECOND, started_at,
          COALESCE(ended_at, NOW()))), 0)                             AS avg_duration_seconds,
        ROUND(SUM(TIMESTAMPDIFF(SECOND, started_at,
          COALESCE(ended_at, NOW()))), 0)                             AS total_duration_seconds
      FROM livestreams
    `)

    // Recent 20 streams with user info
    const [recent] = await pool.query(`
      SELECT ls.id, ls.status, ls.started_at, ls.ended_at, ls.reel_file_url,
             TIMESTAMPDIFF(SECOND, ls.started_at, COALESCE(ls.ended_at, NOW())) AS duration_seconds,
             u.id AS user_id, u.name AS user_name, u.handle AS user_handle, u.avatar_url
      FROM livestreams ls
      JOIN users u ON ls.user_id = u.id
      ORDER BY ls.started_at DESC
      LIMIT 20
    `)

    // Daily stream count for last 30 days
    const [daily] = await pool.query(`
      SELECT DATE(started_at) AS day, COUNT(*) AS count
      FROM livestreams
      WHERE started_at >= NOW() - INTERVAL 30 DAY
      GROUP BY DATE(started_at)
      ORDER BY day ASC
    `)

    res.json({
      counts: {
        total_streams:        Number(counts.total_streams        || 0),
        currently_live:       Number(counts.currently_live       || 0),
        ended_streams:        Number(counts.ended_streams        || 0),
        archived_streams:     Number(counts.archived_streams     || 0),
        streams_7d:           Number(counts.streams_7d           || 0),
        streams_30d:          Number(counts.streams_30d          || 0),
        with_reel:            Number(counts.with_reel            || 0),
        avg_duration_seconds: Number(counts.avg_duration_seconds || 0),
        total_duration_seconds: Number(counts.total_duration_seconds || 0),
      },
      recent,
      daily,
    })
  } catch (err) {
    console.error('GET /api/admin/livestream/stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/blog', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.slug, p.title_da, p.title_en, p.summary_da, p.summary_en,
              p.body_da, p.body_en, p.cover_image, p.published, p.published_at, p.created_at,
              u.name AS author_name
       FROM blog_posts p
       LEFT JOIN users u ON u.id = p.author_id
       ORDER BY p.created_at DESC`
    )
    res.json({ posts: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/blog', authenticate, requireAdmin, writeLimit, async (req, res) => {
  try {
    const { slug, title_da, title_en, summary_da, summary_en, body_da, body_en, cover_image, published } = req.body
    if (!slug?.trim()) return res.status(400).json({ error: 'Slug required' })
    if (!title_da?.trim() && !title_en?.trim()) return res.status(400).json({ error: 'Title required' })
    const publishedAt = published ? new Date() : null
    const [r] = await pool.query(
      `INSERT INTO blog_posts (slug, title_da, title_en, summary_da, summary_en, body_da, body_en, cover_image, author_id, published, published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [slug.trim(), title_da || '', title_en || '', summary_da || null, summary_en || null,
       body_da || '', body_en || '', cover_image || null, req.userId, published ? 1 : 0, publishedAt]
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Slug already exists' })
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/admin/blog/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { slug, title_da, title_en, summary_da, summary_en, body_da, body_en, cover_image, published } = req.body
    const [[existing]] = await pool.query('SELECT id, published, published_at FROM blog_posts WHERE id=?', [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const publishedAt = published && !existing.published ? new Date() : (published ? existing.published_at : null)
    await pool.query(
      `UPDATE blog_posts SET slug=?, title_da=?, title_en=?, summary_da=?, summary_en=?,
       body_da=?, body_en=?, cover_image=?, published=?, published_at=?, updated_at=NOW()
       WHERE id=?`,
      [slug, title_da || '', title_en || '', summary_da || null, summary_en || null,
       body_da || '', body_en || '', cover_image || null, published ? 1 : 0, publishedAt, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Slug already exists' })
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/admin/blog/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM blog_posts WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/blog/translate', authenticate, requireAdmin, async (req, res) => {
  try {
    const { text, from, to } = req.body
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
    if (!['da', 'en'].includes(from) || !['da', 'en'].includes(to) || from === to) {
      return res.status(400).json({ error: 'Invalid language pair' })
    }
    const langNames = { da: 'Danish', en: 'English' }
    const result = await callMistral(
      `You are a professional translator. Translate the given text from ${langNames[from]} to ${langNames[to]}. Return only the translated text, no explanations.`,
      text.trim()
    )
    if (!result) return res.status(503).json({ error: 'Translation unavailable' })
    res.json({ text: result })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/verify-business', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, handle, cvr_number, cvr_company_name, is_verified, created_at
       FROM users WHERE mode = 'business' AND cvr_number IS NOT NULL
       ORDER BY is_verified DESC, created_at DESC LIMIT 100`
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/admin/verify-business error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/admin/verify-business/:userId', authenticate, requireAdmin, writeLimit, async (req, res) => {
  try {
    const { approved } = req.body
    const targetUserId = parseInt(req.params.userId, 10)
    await pool.query('UPDATE users SET is_verified = ? WHERE id = ?', [approved ? 1 : 0, targetUserId])
    await auditLog(req, 'cvr_verification_admin_override', 'user', targetUserId, {
      status: 'success',
      newValue: { is_verified: approved ? 1 : 0 },
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/verify-business/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/admin/flagged', authenticate, requireAdmin, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT 'post' AS content_type, p.id AS content_id,
        COALESCE(p.text_da, '') AS text,
        u.name AS author, u.handle,
        ml.reason, ml.confidence, p.created_at
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN moderation_log ml
         ON ml.content_type = 'post' AND ml.content_id = p.id AND ml.result = 'flagged'
       WHERE p.flagged = 1
       ORDER BY p.created_at DESC
       LIMIT 200`
    )
    const [comments] = await pool.query(
      `SELECT 'comment' AS content_type, c.id AS content_id,
        COALESCE(c.text_da, '') AS text,
        u.name AS author, u.handle,
        ml.reason, ml.confidence, c.created_at
       FROM comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN moderation_log ml
         ON ml.content_type = 'comment' AND ml.content_id = c.id AND ml.result = 'flagged'
       WHERE c.flagged = 1
       ORDER BY c.created_at DESC
       LIMIT 200`
    )
    const items = [...posts, ...comments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    res.json({ items })
  } catch (err) {
    console.error('GET /api/admin/flagged error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/admin/moderate-action', authenticate, requireAdmin, async (req, res) => {
  const { contentType, contentId, action } = req.body || {}
  if (!['post', 'comment'].includes(contentType)) return res.status(400).json({ error: 'Invalid contentType' })
  const id = parseInt(contentId)
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid contentId' })
  if (!['approve', 'remove'].includes(action)) return res.status(400).json({ error: 'Invalid action' })

  const table = contentType === 'post' ? 'posts' : 'comments'
  try {
    if (action === 'approve') {
      await pool.query(`UPDATE \`${table}\` SET flagged = 0 WHERE id = ?`, [id])
    } else {
      await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id])
    }
    pool.query(
      'INSERT INTO moderation_log (content_type, content_id, result, reason, confidence) VALUES (?, ?, ?, ?, ?)',
      [contentType, id, action === 'approve' ? 'safe' : 'blocked', `Admin ${action}`, 'high']
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/admin/moderate-action error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
