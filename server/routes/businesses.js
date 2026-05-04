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
  mailer,
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

router.get('/businesses', async (req, res) => {
  const { category, q, limit: limitRaw, offset: offsetRaw } = req.query
  const limit = Math.min(parseInt(limitRaw) || 20, 50)
  const offset = parseInt(offsetRaw) || 0
  // Optional auth — determine if caller is logged in
  let callerId = null
  try {
    const sessionId = getSessionIdFromRequest(req)
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
                u.follower_count, u.community_score, u.is_verified
         FROM users u
         WHERE ${where}
         ORDER BY u.is_verified DESC, u.community_score DESC, u.follower_count DESC
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
        isVerified: !!r.is_verified,
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


router.get('/businesses/suggested', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    // Try to match businesses by user's top interest slugs
    let rows = []
    const excludeSubquery = `
      AND u.id NOT IN (SELECT business_id FROM business_follows WHERE follower_id = ?)
      AND u.id NOT IN (
        SELECT friend_id FROM friendships WHERE user_id = ?
        UNION SELECT user_id FROM friendships WHERE friend_id = ?
      )`
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
           ${excludeSubquery}
         ORDER BY iss.weight DESC, u.community_score DESC
         LIMIT 10`,
        [req.userId, req.userId, req.userId, req.userId, req.userId]
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
             ${excludeSubquery}
           ORDER BY u.community_score DESC, u.follower_count DESC
           LIMIT 10`,
          [req.userId, req.userId, req.userId, req.userId]
        )
      } catch {
        ;[rows] = await pool.query(
          `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category,
                  u.business_website, u.business_hours, u.bio_da, u.bio_en,
                  0 AS follower_count, 0 AS community_score
           FROM users u
           WHERE u.mode = 'business' AND u.id != ?
             ${excludeSubquery}
           ORDER BY u.created_at DESC
           LIMIT 10`,
          [req.userId, req.userId, req.userId, req.userId]
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


router.get('/businesses/:handle', async (req, res) => {
  const handle = req.params.handle.startsWith('@') ? req.params.handle : '@' + req.params.handle
  // Optional auth
  let callerId = null
  try {
    const sessionId = getSessionIdFromRequest(req)
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


router.post('/businesses/:id/follow', authenticate, async (req, res) => {
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


router.delete('/businesses/:id/follow', authenticate, async (req, res) => {
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


router.post('/businesses/:id/contact', authenticate, writeLimit, async (req, res) => {
  try {
    const bizId = parseInt(req.params.id)
    const { topic, message } = req.body
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' })
    const [[biz]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    if (bizId === req.userId) return res.status(400).json({ error: 'Cannot contact yourself' })
    const [[sender]] = await pool.query('SELECT name, email FROM users WHERE id = ?', [req.userId])
    await pool.query(
      'INSERT INTO user_leads (business_user_id, sender_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?, ?)',
      [bizId, req.userId, sender.name, sender.email, topic?.trim() || null, message.trim()]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/businesses/:id/contact error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/businesses/:id/jobs', async (req, res) => {
  try {
    const bizId = parseInt(req.params.id)
    const [[biz]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    const [jobs] = await pool.query(
      `SELECT j.id, j.title, j.location, j.remote, j.type, j.description, j.created_at,
              c.name AS company_name, c.color AS company_color
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = ?
       WHERE j.active = 1
       ORDER BY j.created_at DESC LIMIT 20`,
      [bizId]
    )
    res.json({ jobs })
  } catch (err) {
    console.error('GET /api/businesses/:id/jobs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/businesses/:id/services', async (req, res) => {
  try {
    const [services] = await pool.query(
      'SELECT * FROM business_services WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
      [req.params.id]
    )
    res.json({ services })
  } catch (err) {
    console.error('GET /api/businesses/:id/services error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/businesses/:id/events', async (req, res) => {
  try {
    const bizId = parseInt(req.params.id)
    const [[biz]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    const [events] = await pool.query(
      `SELECT e.id, e.title, e.date, e.location, e.event_type, e.cover_url,
              (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS rsvp_count
       FROM events e WHERE e.organizer_id = ? AND e.date >= NOW()
       ORDER BY e.date ASC LIMIT 10`,
      [bizId]
    )
    res.json({ events })
  } catch (err) {
    console.error('GET /api/businesses/:id/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/businesses/:id/endorsements', async (req, res) => {
  try {
    const [skills] = await pool.query(
      `SELECT s.id, s.name, COUNT(e.endorser_id) AS endorsement_count
       FROM skills s LEFT JOIN skill_endorsements e ON e.skill_id = s.id
       WHERE s.user_id = ? GROUP BY s.id ORDER BY endorsement_count DESC, s.name ASC`,
      [req.params.id]
    )
    res.json({ endorsements: skills })
  } catch (err) {
    console.error('GET /api/businesses/:id/endorsements error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/businesses/:id/partner-request', authenticate, writeLimit, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id)
    if (partnerId === req.userId) return res.status(400).json({ error: 'Cannot partner with yourself' })
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    const [[target]] = await pool.query("SELECT id FROM users WHERE id = ? AND mode = 'business'", [partnerId])
    if (!target) return res.status(404).json({ error: 'Business not found' })
    // Check for existing request in either direction
    const [[existing]] = await pool.query(
      `SELECT id, status FROM business_partnerships
       WHERE (requester_id = ? AND partner_id = ?) OR (requester_id = ? AND partner_id = ?)`,
      [req.userId, partnerId, partnerId, req.userId]
    )
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already partners' })
      if (existing.status === 'pending') return res.status(409).json({ error: 'Request already sent' })
    }
    await pool.query(
      'INSERT INTO business_partnerships (requester_id, partner_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = "pending", updated_at = NOW()',
      [req.userId, partnerId]
    )
    // Notify target
    pool.query(
      `INSERT INTO notifications (user_id, type, actor_id, payload)
       VALUES (?, 'partner_request', ?, JSON_OBJECT('requester_id', ?))`,
      [partnerId, req.userId, req.userId]
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/businesses/:id/partner-request error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/businesses/:id/partners', async (req, res) => {
  try {
    const bizId = parseInt(req.params.id)
    const [partners] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category, u.is_verified
       FROM business_partnerships bp
       JOIN users u ON u.id = IF(bp.requester_id = ?, bp.partner_id, bp.requester_id)
       WHERE (bp.requester_id = ? OR bp.partner_id = ?) AND bp.status = 'accepted'
       ORDER BY bp.updated_at DESC LIMIT 20`,
      [bizId, bizId, bizId]
    )
    res.json({ partners })
  } catch (err) {
    console.error('GET /api/businesses/:id/partners error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/businesses/:id/inquiry', authenticate, writeLimit, async (req, res) => {
  try {
    const bizId = parseInt(req.params.id)
    if (bizId === req.userId) return res.status(400).json({ error: 'Cannot send inquiry to yourself' })
    const { subject, preferred_date, message } = req.body
    if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: 'Subject and message required' })
    const [[biz]] = await pool.query("SELECT id, name FROM users WHERE id = ? AND mode = 'business'", [bizId])
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    const [[sender]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    // Find or create a DM conversation between the two users
    const [[existingConv]] = await pool.query(
      `SELECT cv.id FROM conversations cv
       JOIN conversation_participants cp1 ON cp1.conversation_id = cv.id AND cp1.user_id = ?
       JOIN conversation_participants cp2 ON cp2.conversation_id = cv.id AND cp2.user_id = ?
       WHERE cv.is_group = 0 LIMIT 1`,
      [req.userId, bizId]
    )
    let convId
    if (existingConv) {
      convId = existingConv.id
    } else {
      const [convResult] = await pool.query(
        'INSERT INTO conversations (created_by, is_group) VALUES (?, 0)',
        [req.userId]
      )
      convId = convResult.insertId
      await pool.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
        [convId, req.userId, convId, bizId]
      )
    }
    // Format the inquiry as a structured message
    const dateText = preferred_date ? `\n📅 Ønsket dato / Preferred date: ${preferred_date}` : ''
    const inquiryText = `📋 Mødeforespørgsel / Meeting Request: ${subject.trim()}${dateText}\n\n${message.trim()}`
    await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
      [convId, req.userId, inquiryText]
    )
    await pool.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
      [convId]
    )
    // Notify the business
    pool.query(
      `INSERT INTO notifications (user_id, type, actor_id, payload)
       VALUES (?, 'inquiry', ?, JSON_OBJECT('conversation_id', ?, 'subject', ?))`,
      [bizId, req.userId, convId, subject.trim()]
    ).catch(() => {})
    res.json({ ok: true, conversation_id: convId })
  } catch (err) {
    console.error('POST /api/businesses/:id/inquiry error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
