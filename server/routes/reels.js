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
import { checkKeywords } from '../helpers.js'

const router = express.Router()

router.get('/reels', authenticate, async (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)
    const [rows] = await pool.query(
      `SELECT r.id, r.video_url, r.caption, r.views_count, r.created_at, r.tagged_users,
              COALESCE(r.source, 'upload') AS source, r.title_da, r.title_en,
              COALESCE(r.shares_count, 0) AS shares_count,
              u.id AS user_id, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
              COALESCE(u.mode, 'privat') AS user_mode,
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


router.post('/reels', authenticate, fileUploadLimit, reelUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' })
    const caption = (req.body.caption || '').trim().slice(0, 2000) || null
    await transcodeVideo(req.file.path)
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


router.post('/reels/:id/like', authenticate, writeLimit, async (req, res) => {
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


router.post('/reels/:id/share', authenticate, writeLimit, async (req, res) => {
  try {
    const reelId = parseInt(req.params.id)
    await pool.query('UPDATE reels SET shares_count = shares_count + 1 WHERE id = ?', [reelId])
    const [[row]] = await pool.query('SELECT shares_count FROM reels WHERE id = ?', [reelId])
    res.json({ shares_count: row?.shares_count ?? 0 })
  } catch (err) {
    console.error('POST /api/reels/:id/share error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/reels/:id/comments', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT rc.id, rc.user_id, rc.text, rc.created_at,
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


router.post('/reels/:id/comments', authenticate, writeLimit, async (req, res) => {
  try {
    const text = (req.body.text || '').trim()
    if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
    const clean = text.slice(0, 2000)
    const kw = checkKeywords(clean)
    if (kw?.action === 'block') return res.status(400).json({ error: 'blocked_keyword', keyword: kw.keyword })
    const [result] = await pool.query(
      'INSERT INTO reel_comments (reel_id, user_id, text) VALUES (?, ?, ?)',
      [req.params.id, req.userId, clean]
    )
    if (kw?.action === 'flag') {
      await pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, "reel_comment", ?, "keyword_flag", ?)',
        [req.userId, result.insertId, `Auto-flagged: keyword "${kw.keyword}"`]
      )
    }
    const [[comment]] = await pool.query(
      `SELECT rc.id, rc.user_id, rc.text, rc.created_at,
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


router.patch('/reels/:reelId/comments/:commentId', authenticate, writeLimit, async (req, res) => {
  const commentId = parseInt(req.params.commentId)
  if (isNaN(commentId)) return res.status(400).json({ error: 'Invalid comment ID' })
  try {
    const [[c]] = await pool.query('SELECT user_id FROM reel_comments WHERE id = ?', [commentId])
    if (!c) return res.status(404).json({ error: 'Not found' })
    if (c.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    const text = (req.body.text || '').trim().slice(0, 2000)
    if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
    await pool.query('UPDATE reel_comments SET text = ? WHERE id = ?', [text, commentId])
    res.json({ ok: true, text })
  } catch (err) {
    console.error('PATCH /api/reels/:reelId/comments/:commentId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/reels/:reelId/comments/:commentId', authenticate, async (req, res) => {
  const commentId = parseInt(req.params.commentId)
  if (isNaN(commentId)) return res.status(400).json({ error: 'Invalid comment ID' })
  try {
    const [[c]] = await pool.query('SELECT user_id FROM reel_comments WHERE id = ?', [commentId])
    if (!c) return res.status(404).json({ error: 'Not found' })
    if (c.user_id !== req.userId && !req.isModerator) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM reel_comments WHERE id = ?', [commentId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/reels/:reelId/comments/:commentId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/reels/:id', authenticate, async (req, res) => {
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


router.post('/reels/:id/share-to-feed', authenticate, writeLimit, async (req, res) => {
  try {
    const [[reel]] = await pool.query('SELECT * FROM reels WHERE id=? AND user_id=?', [req.params.id, req.userId])
    if (!reel) return res.status(403).json({ error: 'Forbidden' })
    const text = reel.caption || ''
    const media = JSON.stringify([{ type: 'video', url: reel.video_url }])
    const [r] = await pool.query(
      'INSERT INTO posts (user_id, text, media, created_at) VALUES (?,?,?,NOW())',
      [req.userId, text, media]
    )
    await pool.query('UPDATE reels SET shared_as_post_id=? WHERE id=?', [r.insertId, req.params.id])
    res.json({ ok: true, post_id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
