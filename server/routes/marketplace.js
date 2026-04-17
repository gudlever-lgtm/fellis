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
  parseBrowser, getGeoForIp, parseBrowser,
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

const router = express.Router()

// MariaDB returns JSON columns as strings — parse them before sending to client
function parseListingPhotos(row) {
  if (!row) return row
  const photos = row.photos
  const base = { ...row, sellerId: row.user_id, seller: row.seller_name || row.seller }
  if (!photos) return { ...base, photos: [] }
  if (Array.isArray(photos)) return base
  try { return { ...base, photos: JSON.parse(photos) } } catch { return { ...base, photos: [] } }
}

router.get('/marketplace', authenticate, async (req, res) => {
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


router.get('/marketplace/mine', authenticate, async (req, res) => {
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


router.post('/marketplace', authenticate, upload.array('photos', 10), async (req, res) => {
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
    // Notify subscribers whose keyword appears in title/description/category
    try {
      const haystack = `${title} ${description || ''} ${category}`.toLowerCase()
      const [alerts] = await pool.query(
        'SELECT DISTINCT user_id, keyword FROM marketplace_keyword_alerts WHERE user_id != ?',
        [req.userId]
      )
      const matched = alerts.filter(a => haystack.includes(a.keyword.toLowerCase()))
      for (const a of matched) {
        const msgDa = `Nyt opslag i markedet matcher "${a.keyword}": ${title}`
        const msgEn = `A new marketplace listing matches "${a.keyword}": ${title}`
        await createNotification(a.user_id, 'marketplace_keyword_match', msgDa, msgEn, req.userId, listing.seller_name)
      }
    } catch (e) { console.error('[marketplace keyword alerts]', e.message) }

    res.json(parseListingPhotos(listing))
  } catch (err) {
    console.error('POST /api/marketplace error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/marketplace/boosted-feed', authenticate, async (req, res) => {
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


router.put('/marketplace/:id', authenticate, upload.array('photos', 10), async (req, res) => {
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


router.delete('/marketplace/:id', authenticate, async (req, res) => {
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


router.post('/marketplace/:id/boost', authenticate, async (req, res) => {
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


router.post('/marketplace/:id/sold', authenticate, async (req, res) => {
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


router.post('/marketplace/:id/relist', authenticate, async (req, res) => {
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


router.post('/marketplace/:id/view', authenticate, async (req, res) => {
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


router.get('/marketplace/stats', authenticate, async (req, res) => {
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


router.post('/marketplace/:id/save', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query(
      'INSERT IGNORE INTO marketplace_saved (user_id, listing_id) VALUES (?,?)',
      [req.userId, req.params.id]
    )
    res.json({ ok: true, saved: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/marketplace/:id/save', authenticate, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM marketplace_saved WHERE user_id=? AND listing_id=?',
      [req.userId, req.params.id]
    )
    res.json({ ok: true, saved: false })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/marketplace/saved', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ml.*, ms.created_at AS saved_at,
              u.name AS seller_name, u.handle AS seller_handle, u.avatar_url AS seller_avatar
       FROM marketplace_saved ms
       JOIN marketplace_listings ml ON ml.id=ms.listing_id
       JOIN users u ON u.id=ml.user_id
       WHERE ms.user_id=? AND ml.status != 'sold'
       ORDER BY ms.created_at DESC
       LIMIT 100`,
      [req.userId]
    )
    res.json({ listings: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/marketplace/:id/offers', authenticate, writeLimit, async (req, res) => {
  try {
    const { amount, message } = req.body
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: 'Invalid amount' })
    const [[listing]] = await pool.query('SELECT user_id, title, status FROM marketplace_listings WHERE id=?', [req.params.id])
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.status === 'sold') return res.status(400).json({ error: 'Item already sold' })
    if (listing.user_id === req.userId) return res.status(400).json({ error: 'Cannot offer on own listing' })
    const [r] = await pool.query(
      'INSERT INTO marketplace_offers (listing_id, buyer_id, amount, message) VALUES (?,?,?,?)',
      [req.params.id, req.userId, parseFloat(amount), message || null]
    )
    // Notify seller
    const [[buyer]] = await pool.query('SELECT name FROM users WHERE id=?', [req.userId])
    await pool.query(
      `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, message_da, message_en)
       VALUES (?,?,?,?,?,?,?)`,
      [listing.user_id, 'marketplace_offer', req.userId, 'listing', req.params.id,
        `${buyer?.name || 'En bruger'} har sendt et bud på "${listing.title}"`,
        `${buyer?.name || 'Someone'} sent an offer on "${listing.title}"`]
    ).catch(() => {})
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    console.error('POST /api/marketplace/:id/offers error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/marketplace/:id/offers', authenticate, async (req, res) => {
  try {
    const [[listing]] = await pool.query('SELECT user_id FROM marketplace_listings WHERE id=?', [req.params.id])
    if (!listing) return res.status(404).json({ error: 'Not found' })
    // Seller sees all offers; buyers see their own
    let rows
    if (listing.user_id === req.userId) {
      ;[rows] = await pool.query(
        `SELECT mo.*, u.name AS buyer_name, u.avatar_url AS buyer_avatar
         FROM marketplace_offers mo JOIN users u ON u.id=mo.buyer_id
         WHERE mo.listing_id=? ORDER BY mo.created_at DESC`,
        [req.params.id]
      )
    } else {
      ;[rows] = await pool.query(
        'SELECT * FROM marketplace_offers WHERE listing_id=? AND buyer_id=? ORDER BY created_at DESC',
        [req.params.id, req.userId]
      )
    }
    res.json({ offers: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/marketplace/offers/:offerId', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    if (!['accepted', 'declined', 'withdrawn'].includes(status))
      return res.status(400).json({ error: 'Invalid status' })
    const [[offer]] = await pool.query(
      `SELECT mo.*, ml.user_id AS seller_id FROM marketplace_offers mo
       JOIN marketplace_listings ml ON ml.id=mo.listing_id
       WHERE mo.id=?`,
      [req.params.offerId]
    )
    if (!offer) return res.status(404).json({ error: 'Offer not found' })
    // Only seller can accept/decline; only buyer can withdraw
    if (status === 'withdrawn' && offer.buyer_id !== req.userId)
      return res.status(403).json({ error: 'Forbidden' })
    if (['accepted', 'declined'].includes(status) && offer.seller_id !== req.userId)
      return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE marketplace_offers SET status=? WHERE id=?', [status, req.params.offerId])
    // Notify buyer on accept/decline
    if (['accepted', 'declined'].includes(status)) {
      const [[seller]] = await pool.query('SELECT name FROM users WHERE id=?', [req.userId])
      const msgDa = status === 'accepted'
        ? `${seller?.name || 'Sælger'} accepterede dit bud`
        : `${seller?.name || 'Sælger'} afslog dit bud`
      const msgEn = status === 'accepted'
        ? `${seller?.name || 'Seller'} accepted your offer`
        : `${seller?.name || 'Seller'} declined your offer`
      await pool.query(
        `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, message_da, message_en)
         VALUES (?,?,?,?,?,?,?)`,
        [offer.buyer_id, `offer_${status}`, req.userId, 'offer', offer.id, msgDa, msgEn]
      ).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
