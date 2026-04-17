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

// Returns the UTC Date corresponding to next midnight in Europe/Copenhagen timezone
function nextMidnightCopenhagen() {
  const tz = 'Europe/Copenhagen'
  const now = new Date()
  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now)
  const [y, m, d] = todayStr.split('-').map(Number)
  const nextDayMidnightUTC = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0))
  const hourInCopenhagen = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
      .format(nextDayMidnightUTC)
  ) % 24
  return new Date(nextDayMidnightUTC.getTime() - hourInCopenhagen * 3_600_000)
}

router.get('/stories/feed', authenticate, async (req, res) => {
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


router.post('/stories', authenticate, async (req, res) => {
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


router.delete('/stories/:id', authenticate, async (req, res) => {
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


router.post('/story-highlights', authenticate, writeLimit, async (req, res) => {
  try {
    const { title, cover_emoji } = req.body
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' })
    const [r] = await pool.query(
      'INSERT INTO story_highlights (user_id, title, cover_emoji) VALUES (?,?,?)',
      [req.userId, title.trim(), cover_emoji || '⭐']
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/story-highlights/:id/stories/:storyId', authenticate, writeLimit, async (req, res) => {
  try {
    const [[hl]] = await pool.query('SELECT user_id FROM story_highlights WHERE id=?', [req.params.id])
    if (!hl || hl.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query(
      'INSERT IGNORE INTO story_highlight_items (highlight_id, story_id) VALUES (?,?)',
      [req.params.id, req.params.storyId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/story-highlights/:id', authenticate, async (req, res) => {
  try {
    const [[hl]] = await pool.query('SELECT user_id FROM story_highlights WHERE id=?', [req.params.id])
    if (!hl || hl.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM story_highlights WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/stories/:id/react', authenticate, writeLimit, async (req, res) => {
  try {
    const { emoji } = req.body
    if (!emoji) return res.status(400).json({ error: 'Emoji required' })
    const [[story]] = await pool.query('SELECT user_id FROM stories WHERE id=?', [req.params.id])
    if (!story) return res.status(404).json({ error: 'Story not found' })
    await pool.query(
      'INSERT INTO story_reactions (story_id, user_id, emoji) VALUES (?,?,?) ON DUPLICATE KEY UPDATE emoji=VALUES(emoji)',
      [req.params.id, req.userId, emoji]
    )
    // Notify story author
    if (story.user_id !== req.userId) {
      const [[reactor]] = await pool.query('SELECT name FROM users WHERE id=?', [req.userId])
      await pool.query(
        `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, message_da, message_en)
         VALUES (?,?,?,?,?,?,?)`,
        [story.user_id, 'story_reaction', req.userId, 'story', req.params.id,
          `${reactor?.name || 'En bruger'} reagerede på din historie med ${emoji}`,
          `${reactor?.name || 'Someone'} reacted to your story with ${emoji}`]
      ).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/stories/:id/reactions', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sr.emoji, u.id AS user_id, u.name, u.avatar_url
       FROM story_reactions sr JOIN users u ON u.id=sr.user_id
       WHERE sr.story_id=? ORDER BY sr.created_at DESC`,
      [req.params.id]
    )
    res.json({ reactions: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
