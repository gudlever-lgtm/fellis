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

router.get('/groups/suggestions', authenticate, async (req, res) => {
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


router.post('/groups/:id/join', authenticate, async (req, res) => {
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


export default router
