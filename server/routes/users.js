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

const router = express.Router()

router.post('/user/onboarding/dismiss', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query('UPDATE users SET onboarding_dismissed = 1 WHERE id = ?', [req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to dismiss onboarding' })
  }
})


router.get('/user/handle/:handle', async (req, res) => {
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


router.post('/users/:id/follow', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot follow yourself' })
  try {
    const [[target]] = await pool.query('SELECT id FROM users WHERE id = ?', [targetId])
    if (!target) return res.status(404).json({ error: 'User not found' })
    await pool.query('INSERT IGNORE INTO user_follows (follower_id, followee_id) VALUES (?, ?)', [req.userId, targetId])
    res.json({ following: true })
  } catch (err) {
    console.error('POST /api/users/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/users/:id/follow', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    await pool.query('DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?', [req.userId, targetId])
    res.json({ following: false })
  } catch (err) {
    console.error('DELETE /api/users/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/friends/suggested', authenticate, async (req, res) => {
  try {
    const [suggestions] = await pool.query(
      `SELECT
         u.id, u.name, u.avatar_url, u.handle,
         COUNT(DISTINCT fof.user_id) AS mutual_count
       FROM friendships fof
       JOIN users u ON u.id = fof.friend_id
       WHERE fof.user_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
         AND fof.friend_id != ?
         AND fof.friend_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
         AND fof.friend_id NOT IN (SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending')
         AND fof.friend_id NOT IN (SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending')
       GROUP BY u.id
       ORDER BY mutual_count DESC
       LIMIT 30`,
      [req.userId, req.userId, req.userId, req.userId, req.userId]
    )
    res.json(suggestions)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load suggestions' })
  }
})


router.post('/friends/request/:userId', authenticate, writeLimit, async (req, res) => {
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


router.get('/friends/requests', authenticate, async (req, res) => {
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


router.post('/friends/requests/:id/accept', authenticate, writeLimit, async (req, res) => {
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


router.post('/friends/requests/:id/decline', authenticate, writeLimit, async (req, res) => {
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


router.delete('/friends/request/:userId', authenticate, async (req, res) => {
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


router.delete('/friends/:userId', authenticate, async (req, res) => {
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


router.patch('/friends/:userId/family', authenticate, async (req, res) => {
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


router.get('/users/search', authenticate, async (req, res) => {
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


router.post('/users/:id/block', authenticate, async (req, res) => {
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


router.delete('/users/:id/block', authenticate, async (req, res) => {
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


router.get('/users/:id/badges', authenticate, async (req, res) => {
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


router.get('/users/suggested', authenticate, async (req, res) => {
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
          AND u.email NOT LIKE 'e2e.test.%@fellis-test.invalid'
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
          AND u.email NOT LIKE 'e2e.test.%@fellis-test.invalid'
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


router.get('/users/:userId/story-highlights', authenticate, async (req, res) => {
  try {
    const [highlights] = await pool.query(
      'SELECT * FROM story_highlights WHERE user_id=? ORDER BY created_at DESC',
      [req.params.userId]
    )
    for (const h of highlights) {
      const [items] = await pool.query(
        `SELECT shi.story_id, s.content_text, s.bg_color, s.created_at
         FROM story_highlight_items shi
         JOIN stories s ON s.id=shi.story_id
         WHERE shi.highlight_id=?
         ORDER BY s.created_at DESC`,
        [h.id]
      )
      h.stories = items
    }
    res.json({ highlights })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/users/:userId/portfolio', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM user_portfolio WHERE user_id=? ORDER BY sort_order ASC, created_at DESC',
      [req.params.userId]
    )
    res.json({ items: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
